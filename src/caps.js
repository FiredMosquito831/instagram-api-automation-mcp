// The outbound caps, the usage throttle, and the busy results they give. Counts are kept in the state under caps.<name>,
// as lists of the times of each action. check() changes nothing. record() stores the action and saves it at once, so a
// caller records an action before it sends the request: if the save fails, record() throws and the request is not sent.
// Nothing is queued. A limit that is reached gives a busy result, with the time when that limit next clears.

import { randomUUID } from 'node:crypto';
import { IgError } from './errors.js';
import { clockMs } from './util/clock.js';
import { isPlainObject, isState } from './util/object.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// The reads of another account (business discovery, mentioned media and hashtag search). A read counts only toward its own
// bucket: it is not an outbound action, so it neither waits for the outbound spacing nor counts toward the outbound total
// (P2-I2). Its own bucket still applies.
const READ_ACTIONS = new Set(['business_discovery', 'mentioned_media', 'hashtag']);
// The state key of the one-reply flag (P4 fix round 2, the one-reply gap). It is set when a scan of the audit file for the one-reply records
// fails, and it clears only when a scan succeeds. A confirmed clear of the stop does not clear it.
export const ONE_REPLY_UNKNOWN_KEY = 'oneReplyUnknown';
// A private reply can be sent within 7 days of its comment (the window that service.js checks). Its one-reply record is rebuilt
// from the audit lines within that window of the comment (P4 review N-2).
const PRIVATE_REPLY_WINDOW_MS = 7 * DAY_MS;

export const ACTION_NAMES = Object.freeze([
  'outbound',
  'like',
  'unlike',
  'follow',
  'unfollow',
  'owner_dm',
  'auto_reply',
  'publish',
  'comment_reply',
  'comment_hide',
  'comment_delete',
  'profile_edit',
  'private_reply',
  'hashtag',
  'business_discovery',
  'mentioned_media',
]);

// The counter that an action also counts toward, besides outbound. An action with null counts toward outbound only.
// The likes counter is shared by like and unlike.
const BUCKET_OF = Object.freeze({
  outbound: null,
  like: 'likes',
  unlike: 'likes',
  follow: 'follows',
  unfollow: 'unfollows',
  owner_dm: 'owner_dm',
  auto_reply: 'auto_reply',
  publish: 'publish',
  comment_reply: null,
  comment_hide: null,
  comment_delete: null,
  profile_edit: null,
  // A private reply is a DM that the owner sends, so it counts toward the owner DM limit as well.
  private_reply: 'owner_dm',
  hashtag: 'hashtag',
  business_discovery: 'business_discovery',
  mentioned_media: 'mentioned_media',
});

// The audit feature that service.js writes for each outbound action and each lookup, with the caps action that it counts as. The
// lookups of business discovery and mentioned media write an audit line with their action and outcome and no identifier, so
// they are rebuilt too. A lookup made before that line was added wrote none, and is not counted.
const AUDIT_FEATURES = Object.freeze({
  publishMedia: 'publish',
  commentReply: 'comment_reply',
  commentHide: 'comment_hide',
  commentDelete: 'comment_delete',
  like: 'like',
  unlike: 'unlike',
  dmSend: 'owner_dm',
  privateReply: 'private_reply',
  mediaDelete: 'outbound',
  follow: 'follow',
  unfollow: 'unfollow',
  profileEdit: 'profile_edit',
  autoReply: 'auto_reply',
  hashtagSearch: 'hashtag',
  businessDiscovery: 'business_discovery',
  mentionedMedia: 'mentioned_media',
});

// Every cap that the rules below read, with the smallest value it may have.
const REQUIRED_CAPS = Object.freeze([
  ['minSpacingMs', 0],
  ['dailyTotal', 0],
  ['likes.perHour', 0],
  ['likes.perDay', 0],
  ['follows.perDay', 0],
  ['unfollows.perDay', 0],
  ['ownerDms.perDay', 0],
  ['autoReplies.perConversationHours', 1],
  ['autoReplies.perDay', 0],
  ['publishing.perDayLocal', 0],
  ['hashtags.perWeek', 0],
  ['hashtags.windowDays', 1],
  ['businessDiscovery.perDay', 0],
  ['mentionedMedia.perDay', 0],
]);

// A hashtag is letters, digits or underscores, from 1 to 100 characters, after a leading # is removed and case is folded.
const TAG = /^[\p{L}\p{N}_]{1,100}$/u;

// A caller's input that is refused. It is VALIDATION, so that a bad call is never read as a busy result.
function invalid(message) {
  return new IgError('VALIDATION', message);
}

function busy(reason, retryAfterMs) {
  return { ok: false, reason, retryAfterMs };
}

// The rules for each counter, built from the caps. A rule with perSender counts one sender's conversation. A rule with
// distinctTag counts unique tags, so that a tag used twice in the window counts once.
function rulesFor(caps) {
  return {
    outbound: [{ name: 'day', windowMs: DAY_MS, limit: caps.dailyTotal, what: 'outbound actions per day' }],
    likes: [
      { name: 'hour', windowMs: HOUR_MS, limit: caps.likes.perHour, what: 'likes per hour' },
      { name: 'day', windowMs: DAY_MS, limit: caps.likes.perDay, what: 'likes per day' },
    ],
    follows: [{ name: 'day', windowMs: DAY_MS, limit: caps.follows.perDay, what: 'follows per day' }],
    unfollows: [{ name: 'day', windowMs: DAY_MS, limit: caps.unfollows.perDay, what: 'unfollows per day' }],
    owner_dm: [{ name: 'day', windowMs: DAY_MS, limit: caps.ownerDms.perDay, what: 'owner DMs per day' }],
    auto_reply: [
      {
        name: 'conversation',
        windowMs: caps.autoReplies.perConversationHours * HOUR_MS,
        limit: 1,
        perSender: true,
        what: 'auto-replies per conversation',
      },
      { name: 'day', windowMs: DAY_MS, limit: caps.autoReplies.perDay, what: 'auto-replies per day' },
    ],
    publish: [{ name: 'day', windowMs: DAY_MS, limit: caps.publishing.perDayLocal, what: 'publishes per day' }],
    hashtag: [
      {
        name: 'week',
        windowMs: caps.hashtags.windowDays * DAY_MS,
        limit: caps.hashtags.perWeek,
        distinctTag: true,
        what: 'unique hashtags per week',
      },
    ],
    // The discovery lookups of other accounts. Each is capped per day, and each lookup counts as one action.
    business_discovery: [
      { name: 'day', windowMs: DAY_MS, limit: caps.businessDiscovery.perDay, what: 'business discoveries per day' },
    ],
    mentioned_media: [
      { name: 'day', windowMs: DAY_MS, limit: caps.mentionedMedia.perDay, what: 'mentioned media lookups per day' },
    ],
  };
}

// Checks the action and its options. The sender is needed for auto_reply and the tag for hashtag; a missing one is
// refused, because the rule cannot be applied without it.
function describe(action, opts) {
  if (!ACTION_NAMES.includes(action)) throw invalid('unknown outbound action');
  const options = opts === undefined ? {} : opts;
  if (!isPlainObject(options)) throw invalid('the options of an action must be an object');
  let senderId = null;
  let tag = null;
  if (action === 'auto_reply') {
    // The trimmed id is the conversation, so that ' abc ' and 'abc' share one count.
    senderId = typeof options.senderId === 'string' ? options.senderId.trim() : '';
    if (senderId === '') throw invalid('an auto-reply needs a senderId string');
  }
  if (action === 'hashtag') {
    if (typeof options.tag !== 'string') throw invalid('a hashtag search needs a tag string');
    tag = options.tag.trim().replace(/^#+/, '').toLowerCase();
    if (!TAG.test(tag)) throw invalid('a hashtag must be letters, digits or underscores, 1 to 100 characters');
  }
  return { name: action, bucket: BUCKET_OF[action], senderId, tag };
}

// The verdict of one rule, given the counter's entries inside its longest window. Null means the rule allows the action.
// A limit of 0 is taken as switched off, so it is busy for the whole window.
function verdictFor(rule, entries, req, t) {
  // A limit of 0 is checked first, so that a repeated tag under a zero limit is refused too.
  if (rule.limit === 0) return busy(`${rule.what} is switched off`, rule.windowMs);
  const inWindow = entries.filter((entry) => t - entry.at < rule.windowMs);
  let times;
  if (rule.perSender) {
    times = inWindow.filter((entry) => entry.senderId === req.senderId).map((entry) => entry.at);
  } else if (rule.distinctTag) {
    if (inWindow.some((entry) => entry.tag === req.tag)) return null;
    const latest = new Map();
    for (const entry of inWindow) latest.set(entry.tag, Math.max(latest.get(entry.tag) ?? -Infinity, entry.at));
    times = [...latest.values()].sort((a, b) => a - b);
  } else {
    times = inWindow.map((entry) => entry.at);
  }
  if (times.length < rule.limit) return null;
  // The entry at this index must leave the window before the count falls below the limit.
  const clears = times[times.length - rule.limit] + rule.windowMs;
  return busy(`${rule.what} reached the limit of ${rule.limit}`, clears - t);
}

// Builds the caps over a state. caps is the caps section of the config. now returns milliseconds.
export function createCaps({ caps, state, now = () => Date.now() } = {}) {
  if (!isPlainObject(caps)) throw new TypeError('createCaps needs the caps section of the config');
  for (const [path, min] of REQUIRED_CAPS) {
    const value = path.split('.').reduce((node, key) => (isPlainObject(node) ? node[key] : undefined), caps);
    if (!Number.isSafeInteger(value) || value < min) {
      throw new TypeError(`createCaps needs ${path} as a whole number of ${min} or more`);
    }
  }
  if (!isState(state)) throw new TypeError('createCaps needs a state with get, set and save');
  if (typeof now !== 'function') throw new TypeError('createCaps needs now as a function');

  const rules = rulesFor(caps);
  const minSpacingMs = caps.minSpacingMs;
  const clock = () => clockMs(now);
  const windowOf = (bucket) => Math.max(...rules[bucket].map((rule) => rule.windowMs));

  // The stored entries of a counter. A value that is not a list of entries is refused, not read.
  function entriesOf(bucket) {
    const value = state.get(`caps.${bucket}`, []);
    const valid =
      Array.isArray(value) &&
      value.every(
        (entry) =>
          isPlainObject(entry) &&
          Number.isFinite(entry.at) &&
          (bucket !== 'auto_reply' || typeof entry.senderId === 'string') &&
          (bucket !== 'hashtag' || typeof entry.tag === 'string'),
      );
    if (!valid) throw new IgError('CONFIG', `caps.${bucket} in the state file is not valid`);
    return value;
  }

  // The entries of a counter that are inside its longest window, oldest first.
  function live(bucket, t) {
    return entriesOf(bucket)
      .filter((entry) => t - entry.at < windowOf(bucket))
      .sort((a, b) => a.at - b.at);
  }

  // The verdict of one checked action at the time t. check() and record() both use it, so a count is never saved over a limit.
  function verdictOf(req, t) {
    const outbound = live('outbound', t);
    if (!READ_ACTIONS.has(req.name)) {
      if (outbound.length > 0 && minSpacingMs > 0) {
        const wait = outbound[outbound.length - 1].at + minSpacingMs - t;
        if (wait > 0) return busy(`outbound actions need ${minSpacingMs} ms between them`, wait);
      }
      for (const rule of rules.outbound) {
        const verdict = verdictFor(rule, outbound, req, t);
        if (verdict) return verdict;
      }
    }
    if (req.bucket !== null) {
      const entries = live(req.bucket, t);
      for (const rule of rules[req.bucket]) {
        const verdict = verdictFor(rule, entries, req, t);
        if (verdict) return verdict;
      }
    }
    return { ok: true };
  }

  function check(action, opts) {
    return verdictOf(describe(action, opts), clock());
  }

  // Counts an action that is about to be sent. The verdict is run again here, at the same time as the count, and a limit
  // throws CAP_EXCEEDED, so no count is saved over a limit whichever caller made it. The count is saved at once, and a
  // failed save throws, so that the caller does not send the request.
  function record(action, opts) {
    const req = describe(action, opts);
    const t = clock();
    const verdict = verdictOf(req, t);
    if (!verdict.ok) throw new IgError('CAP_EXCEEDED', `the action is over a limit, so it was not counted: ${verdict.reason}`);
    // The id of this count. A release removes exactly the entries that carry it, so no other count is touched.
    const id = randomUUID();
    // A read writes its own bucket only, so it does not count toward the outbound total (P2-I2).
    const writes = new Map();
    if (!READ_ACTIONS.has(req.name)) writes.set('outbound', [...live('outbound', t), { at: t, id }]);
    if (req.bucket !== null) {
      const entry = { at: t, id };
      if (req.senderId !== null) entry.senderId = req.senderId;
      if (req.tag !== null) entry.tag = req.tag;
      writes.set(req.bucket, [...live(req.bucket, t), entry]);
    }
    try {
      for (const [bucket, list] of writes) state.set(`caps.${bucket}`, list);
      state.save();
    } catch (err) {
      throw new IgError('CONFIG', `the action could not be counted (${err.code ?? 'error'}); do not send it`);
    }
    return id;
  }

  // Removes the count that record made for one action, because the action never reached Graph: a failure before any request
  // was sent. Only the entries that carry the id are removed. A failed save throws CONFIG and the count stays, so a failed
  // release is never read as a released count (fail closed).
  function release(id, action, opts) {
    if (typeof id !== 'string' || id === '') throw invalid('release needs the id that record returned');
    const req = describe(action, opts);
    const buckets = req.bucket === null ? ['outbound'] : ['outbound', req.bucket];
    const writes = buckets.map((bucket) => [bucket, entriesOf(bucket).filter((entry) => entry.id !== id)]);
    try {
      for (const [bucket, list] of writes) state.set(`caps.${bucket}`, list);
      state.save();
    } catch (err) {
      throw new IgError('CONFIG', `the count could not be released (${err.code ?? 'error'}); it stays counted`);
    }
  }

  // The count and the limit of each rule, for status output. Per-sender rules are left out, because they have no total.
  function usage() {
    const t = clock();
    const out = {};
    for (const [bucket, list] of Object.entries(rules)) {
      const entries = live(bucket, t);
      out[bucket] = {};
      for (const rule of list) {
        if (rule.perSender) continue;
        const inWindow = entries.filter((entry) => t - entry.at < rule.windowMs);
        const used = rule.distinctTag ? new Set(inWindow.map((entry) => entry.tag)).size : inWindow.length;
        out[bucket][rule.name] = { used, limit: rule.limit };
      }
    }
    return out;
  }

  return { check, record, release, usage };
}

// Rebuilds the counters of a state that was lost, from the audit lines of the outbound actions (P4 review M-11). A line counts
// when its action is in AUDIT_FEATURES and its outcome is ok or error. An error line counts as well: a pre-send failure
// released its count when it happened, but the audit line does not say so, so the rebuild over-counts there. That is the fail-
// closed side. A line is kept in a counter while it is inside that counter's longest window, measured from now, as live()
// measures it. A line whose sender or tag cannot be used is counted as unusable and is not put in its counter. The counters
// are written to the state; the caller saves it, so that a save that fails can be kept in process (P4 review M-5). Returns the
// entries kept per counter, the damaged audit lines, the unusable lines, the counted action lines and the longest window in
// milliseconds. The one-reply records of the comments are not part of this rebuild (see rebuildPrivateReplies).
export function rebuildCapsFromAudit({ caps, state, audit, now = () => Date.now() } = {}) {
  if (!isPlainObject(caps)) throw new TypeError('rebuildCapsFromAudit needs the caps section of the config');
  if (!isState(state)) throw new TypeError('rebuildCapsFromAudit needs a state with get, set and save');
  if (typeof audit?.scanSince !== 'function') throw new TypeError('rebuildCapsFromAudit needs an audit log with scanSince');
  if (typeof now !== 'function') throw new TypeError('rebuildCapsFromAudit needs now as a function');

  const rules = rulesFor(caps);
  const windowOf = (bucket) => Math.max(...rules[bucket].map((rule) => rule.windowMs));
  const longest = Math.max(...Object.keys(rules).map(windowOf));
  const t = clockMs(now);
  const lists = new Map();
  const add = (bucket, entry) => {
    if (!lists.has(bucket)) lists.set(bucket, []);
    lists.get(bucket).push(entry);
  };
  let actions = 0;
  let unusable = 0;
  // The one-reply records are not rebuilt here: they are a scan of their own (rebuildPrivateReplies), so a failed scan here does not
  // drop them (P4 fix round 2, N-10).
  const { damaged } = audit.scanSince(t - longest, (line) => {
    if (!Object.hasOwn(AUDIT_FEATURES, line.action)) return;
    if (line.outcome !== 'ok' && line.outcome !== 'error') return;
    const action = AUDIT_FEATURES[line.action];
    const at = Date.parse(line.at);
    const id = `audit:${actions}`;
    actions += 1;
    if (!READ_ACTIONS.has(action)) add('outbound', { at, id });
    const bucket = BUCKET_OF[action];
    if (bucket === null) return;
    const entry = { at, id };
    if (action === 'auto_reply') {
      const senderId = typeof line.target === 'string' ? line.target.trim() : '';
      if (senderId === '') {
        unusable += 1;
        return;
      }
      entry.senderId = senderId;
    }
    if (action === 'hashtag') {
      const tag = typeof line.target === 'string' ? line.target.trim().replace(/^#+/, '').toLowerCase() : '';
      if (!TAG.test(tag)) {
        unusable += 1;
        return;
      }
      entry.tag = tag;
    }
    add(bucket, entry);
  });

  const counted = {};
  // The kept entries of each counter are returned too, so that a caller whose save fails can set them again (P4 fix round 2, N-11).
  const entries = {};
  for (const [bucket, list] of lists) {
    const kept = list.filter((entry) => t - entry.at < windowOf(bucket)).sort((a, b) => a.at - b.at);
    if (kept.length === 0) continue;
    counted[bucket] = kept.length;
    entries[bucket] = kept;
    state.set(`caps.${bucket}`, kept);
  }
  return { counted, damaged, unusable, actions, windowMs: longest, entries };
}

// Rebuilds the one-reply record of each comment from the privateReply audit lines (P4 review N-2). It is a scan of its own, so that a
// failed caps scan does not drop these records (P4 fix round 2, N-10). A line is kept when the comment's stored time is unknown, and
// when it is within 7 days of that time. The earliest kept line gives the record's time, in the shape that service.js checks. A line
// whose target is not a comment id is counted as unusable. It throws when the audit cannot be read. The damaged lines of the scan are
// returned as damaged: a damaged line may be a private reply, so the caller treats any damaged line as an unknown scan (P5a round 1, I-1).
// commentTimeOf(commentId) gives a comment's stored time as ISO text, or null.
export function rebuildPrivateReplies({ audit, now = () => Date.now(), commentTimeOf = () => null } = {}) {
  if (typeof audit?.scanSince !== 'function') throw new TypeError('rebuildPrivateReplies needs an audit log with scanSince');
  if (typeof now !== 'function') throw new TypeError('rebuildPrivateReplies needs now as a function');
  if (typeof commentTimeOf !== 'function') throw new TypeError('rebuildPrivateReplies needs commentTimeOf as a function');
  const t = clockMs(now);
  const earliestOf = new Map();
  let unusable = 0;
  // The damaged lines of the scan are returned too (P5a round 1, I-1). A damaged line may be a private reply that the scan could not read,
  // so a caller treats any damaged line as an unknown scan. The scan reads every retained file, so the count covers all of them.
  const scan = audit.scanSince(t - PRIVATE_REPLY_WINDOW_MS, (line) => {
    if (line.action !== 'privateReply' || (line.outcome !== 'ok' && line.outcome !== 'error')) return;
    if (typeof line.target !== 'string' || !/^\d+$/.test(line.target)) {
      unusable += 1;
      return;
    }
    const at = Date.parse(line.at);
    const commentIso = commentTimeOf(line.target);
    const commentMs = commentIso === null ? Number.NaN : Date.parse(commentIso);
    if (Number.isFinite(commentMs) && Math.abs(at - commentMs) > PRIVATE_REPLY_WINDOW_MS) return;
    const earliest = earliestOf.get(line.target);
    if (earliest === undefined || at < earliest) earliestOf.set(line.target, at);
  });
  const privateReplies = {};
  for (const [commentId, at] of earliestOf) {
    privateReplies[commentId] = { at: new Date(at).toISOString(), preSendFailures: 0, released: false };
  }
  return { privateReplies, unusable, damaged: scan?.damaged ?? 0 };
}

// The usage throttle. usage is the X-App-Usage object of a response, with numeric total_time and total_cputime. When
// either reaches thresholdPercent, the gate stays busy for busyMs from that reading. Only a new reading arms the window:
// a reading is new when it is a different object from the last one seen, or when its numbers differ from the last
// ones seen. So a caller that passes the stored reading on every check does not re-arm the window, and a busy call
// (which sends nothing) is not held on a reading that is never refreshed. A caller passes a new object for each
// response, and reads are not gated, so they refresh the reading. A missing reading (no response yet) passes. A reading
// of the wrong shape is refused with VALIDATION.
export function createUsageGate({ thresholdPercent, busyMs, now = () => Date.now() } = {}) {
  if (!Number.isInteger(thresholdPercent) || thresholdPercent < 1 || thresholdPercent > 100) {
    throw new TypeError('createUsageGate needs thresholdPercent as a whole number from 1 to 100');
  }
  if (!Number.isSafeInteger(busyMs) || busyMs < 0) {
    throw new TypeError('createUsageGate needs busyMs as a whole number of 0 or more');
  }
  if (typeof now !== 'function') throw new TypeError('createUsageGate needs now as a function');
  let highAt = null;
  // The last reading seen: the object, and its numbers at the time it was seen.
  let last = null;

  function readingOf(usage) {
    if (!isPlainObject(usage)) throw invalid('the usage reading must be an object');
    for (const key of ['total_time', 'total_cputime']) {
      const value = usage[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw invalid(`the usage reading needs ${key} as a number of 0 or more`);
      }
    }
    return usage;
  }

  return {
    check(usage) {
      const t = clockMs(now);
      if (usage !== undefined && usage !== null) {
        const reading = readingOf(usage);
        const isNew =
          last === null ||
          last.ref !== usage ||
          last.total_time !== reading.total_time ||
          last.total_cputime !== reading.total_cputime;
        if (isNew) {
          last = { ref: usage, total_time: reading.total_time, total_cputime: reading.total_cputime };
          if (reading.total_time >= thresholdPercent || reading.total_cputime >= thresholdPercent) highAt = t;
        }
      }
      if (highAt !== null && t - highAt < busyMs) {
        return {
          ok: false,
          retryAfterMs: highAt + busyMs - t,
          reason: `the app usage reached ${thresholdPercent} percent within the last ${busyMs} ms`,
        };
      }
      return { ok: true };
    },
  };
}
