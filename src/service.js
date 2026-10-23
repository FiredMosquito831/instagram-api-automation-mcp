// The service core. It joins the modules below into the operations that the HTTP API, the MCP server and the setup commands
// call. Every outbound operation goes through runOutbound, which runs its checks in one fixed order. A read goes through
// readCall: it gives a clean IgError and never changes the stop state. Nothing here waits in a queue, and nothing here
// writes a token to a file.

import { open as openFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IgError, busyResult } from './errors.js';
import { redact } from './redact.js';
import { canRefresh, expiryStatus, refreshToken, tokenAgeHours } from './token.js';
import { checkId } from './graph/endpoints/common.js';
import {
  commentDelete,
  commentHide,
  commentParentMedia,
  commentReply,
  commentsList,
  commentTimestamp,
  ownedMediaIds,
} from './graph/endpoints/comments.js';
import { FIELDS_PATTERN, USERNAME_PATTERN, businessDiscovery, hashtagSearch } from './graph/endpoints/discovery.js';
import { accountInsights, mediaInsights } from './graph/endpoints/insights.js';
import { like, unlike } from './graph/endpoints/likes.js';
import {
  checkMediaUrl,
  checkPublish,
  storyKindOf,
  contentPublishingLimit,
  mediaDelete,
  mediaGet,
  mediaList,
  mentionedMedia,
  parseCarouselItem,
  publishCarousel,
  publishImage,
  publishReel,
  publishStory,
  resolveMediaDir,
  resolveMediaFile,
} from './graph/endpoints/media.js';
import {
  messageWindowOpen,
  privateReply,
  privateReplyOpen,
  readConversations,
  readThread,
  sendMessage,
} from './graph/endpoints/messaging.js';
import { profileGet } from './graph/endpoints/profile.js';
import { isoOf } from './util/time.js';
import { isPlainObject } from './util/object.js';
import { unofficialRouteStop } from './unofficial-session.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// The project root: the folder above src/, which a relative media.dir is resolved against (cli.js resolves dataDir the same way).
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MEDIA_FS = Object.freeze({ realpath, stat, open: openFile });
const TOKEN_TTL_MS = 60 * DAY_MS;
const DM_TEXT_BYTES = 1000;
// The read limits (see src/graph/paging.js and the README). Each request asks for one page of this many rows. A read goes
// on to the next page only while paging.next is present, up to 10 pages and 1000 items.
const OWNED_PAGE = 100;
// The largest page the endpoint allows (P3 fix round, ruling 2). Old value (removed): 25.
const COMMENT_PAGE = 100;
// The most messages that one thread read returns: the default, and the most that a caller may ask for.
const DM_MESSAGES_MAX = 1000;
const CONVERSATION_PAGE = 100;
const REPLIED_LIMIT = 500;
// The closed sets that the service accepts. The tool registry (src/tools.js) lists the same values as its enums, and a test
// checks that the two match.
export const PUBLISH_KINDS = Object.freeze(['image', 'reel', 'carousel', 'story']);
export const LIKE_KINDS = Object.freeze(['media', 'comment']);
// The decisions an event may take. events.js keeps the same list for storage, and the service refuses any other value first.
export const EVENT_DECISIONS = Object.freeze(['reply', 'ignore', 'escalate']);
// The stops that pause a token refresh (O-6). Any other stop does not pause it.
const PAUSE_KINDS = new Set(['CHECKPOINT', 'ACTION_BLOCKED']);
const HASHTAG = /^[\p{L}\p{N}_]{1,100}$/u;
// The features that need a business or creator account, through a route that is not unofficial.
const OFFICIAL = new Set([
  'publishMedia',
  'commentReply',
  'commentHide',
  'commentDelete',
  'like',
  'unlike',
  'dmSend',
  'privateReply',
  'mediaDelete',
  'hashtagSearch',
  'businessDiscovery',
  'autoReply',
]);
const UNOFFICIAL = new Set(['follow', 'unfollow', 'profileEdit']);
// The features that need the Facebook Login token. A like uses the Facebook client when routes.likes.loginProduct says so.
const FACEBOOK = new Set(['mediaDelete', 'hashtagSearch', 'businessDiscovery']);
const RULE_KEYS = Object.freeze(['keyword', 'reply']);

const invalid = (message) => new IgError('VALIDATION', message);
const refuse = (kind, message) => new IgError(kind, message);
const untrusted = (value) => ({ ...value, untrusted: true });

// A text that is not blank, and at most limitBytes UTF-8 bytes when a limit is given.
function checkText(text, name, limitBytes = null) {
  if (typeof text !== 'string' || text.trim() === '') throw invalid(`${name} must be a non-empty string`);
  if (limitBytes !== null && Buffer.byteLength(text) > limitBytes) {
    throw invalid(`${name} is ${Buffer.byteLength(text)} bytes; the limit is ${limitBytes}`);
  }
  return text;
}

// The name of an error, reduced to letters, digits and underscores, so that no message text can reach a warning through it.
// A name getter that throws is read as no name, so the audit path never throws.
function errorName(err) {
  let raw = '';
  try {
    raw = typeof err?.name === 'string' ? err.name : '';
  } catch {
    raw = '';
  }
  const name = raw.replace(/[^A-Za-z0-9_]/g, '').slice(0, 64);
  return name === '' ? 'error' : name;
}

// The kind, and the Graph code when there is one. It is the only text the audit takes from an error: never the message.
function errorDetail(err) {
  const kind = err instanceof IgError ? err.kind : 'UNEXPECTED';
  const code = err instanceof IgError ? err.details?.code : null;
  return code === null || code === undefined ? kind : `${kind} code ${code}`;
}

// The detail of a stop: the HTTP status, the Graph code and the subcode. It carries no message text.
function stopDetail(err) {
  const { status = null, code = null, subcode = null } = err.details ?? {};
  return `HTTP ${status ?? 'none'}, code ${code ?? 'none'}, subcode ${subcode ?? 'none'}`;
}

// A failure that happened before any request reached Graph. The client marks it with details.preSend (see client.js). Only
// such a failure is known not to have been sent, so only it can be released and sent again.
function isPreSend(err) {
  return err instanceof IgError && err.kind === 'API_ERROR' && err.details?.preSend === true;
}

// A failed write may or may not have reached Graph. Its error is never retried here, and the caller is told so. A failure
// before any request was sent is the one case that is known: the message says so, and the action may be sent again.
function unknownOutcome(err, feature, retryLeft = null, earlierReached = false) {
  if (!(err instanceof IgError)) return new IgError('API_ERROR', `${feature} failed unexpectedly; it was not retried`);
  if (err.kind !== 'API_ERROR') return err;
  // The message names only the request that failed. A pre-send failure of a reservation is one retry; the second is final.
  if (isPreSend(err)) {
    // An earlier request of the same action reached Graph, so the action is not one that failed before any request. Its count
    // stays counted, and the error is not reported as pre-send for the action (P2F-M3).
    if (earlierReached) {
      const text =
        `the request for ${feature} failed before it reached Instagram, but an earlier request of the same action ` +
        'had reached it, so its count stays counted';
      return new IgError('API_ERROR', text, { ...err.details, preSend: false });
    }
    const text =
      retryLeft === false
        ? `the request for ${feature} failed before it reached Instagram; the one retry is used up, so it is not sent again`
        : `the request for ${feature} failed before it reached Instagram; it can be sent again`;
    return new IgError('API_ERROR', text, err.details);
  }
  return new IgError('API_ERROR', `${feature} may or may not have reached Instagram; it was not retried`, err.details);
}

// Watches the requests that one action makes through its client (P2F-M3). A request that gets an answer from Graph has reached
// it. So has a request that fails with anything other than a pre-send failure: its outcome is unknown, so it counts as reached
// (fail closed). A pre-send failure has not reached Graph. Only the requests of perform are watched; the reads before it are not.
function watchRequests(igc) {
  const watch = { reached: false };
  if (igc === null || igc === undefined) return { client: igc, watch };
  const track = async (call) => {
    try {
      const value = await call();
      watch.reached = true;
      return value;
    } catch (err) {
      if (!isPreSend(err)) watch.reached = true;
      throw err;
    }
  };
  const client = {
    get: (...args) => track(() => igc.get(...args)),
    post: (...args) => track(() => igc.post(...args)),
    del: (...args) => track(() => igc.del(...args)),
  };
  return { client, watch };
}

// Every method takes one object of arguments, or nothing. Anything else, null included, is VALIDATION, and the method does not
// run. onInbound is left as it is: its argument is an event from the poller or the webhook, and it never rejects.
function wrapArguments(methods) {
  const wrapped = {};
  for (const [name, method] of Object.entries(methods)) {
    if (name === 'onInbound') {
      wrapped[name] = method;
      continue;
    }
    wrapped[name] = (args) => {
      if (args !== undefined && !isPlainObject(args)) {
        return Promise.reject(invalid(`${name} takes one object of arguments`));
      }
      return method(args === undefined ? {} : args);
    };
  }
  return wrapped;
}

// A read that fails with something other than an IgError is an API_ERROR, so every read gives a clean error.
function readError(err) {
  if (err instanceof IgError) return err;
  return new IgError('API_ERROR', 'the Graph read failed');
}

// Checks each dependency has the functions the service calls, so a missing one is a clear startup error.
function need(value, names, what) {
  if (value === null || typeof value !== 'object') throw new TypeError(`createService needs ${what}`);
  for (const name of names) {
    if (typeof value[name] !== 'function') throw new TypeError(`createService needs ${what} with ${name}`);
  }
}

// The owner's auto-reply rules: each has a keyword and a reply. Anything else is refused at startup.
function checkRules(rules) {
  if (!Array.isArray(rules)) throw new IgError('CONFIG', 'autoReply.rules must be a list');
  return rules.map((rule, index) => {
    const name = `autoReply.rules[${index}]`;
    if (!isPlainObject(rule) || Object.keys(rule).some((key) => !RULE_KEYS.includes(key))) {
      throw new IgError('CONFIG', `${name} must hold only keyword and reply`);
    }
    if (typeof rule.keyword !== 'string' || rule.keyword.trim() === '') {
      throw new IgError('CONFIG', `${name}.keyword must be a non-empty string`);
    }
    if (typeof rule.reply !== 'string' || rule.reply.trim() === '') {
      throw new IgError('CONFIG', `${name}.reply must be a non-empty string`);
    }
    if (Buffer.byteLength(rule.reply) > DM_TEXT_BYTES) {
      throw new IgError('CONFIG', `${name}.reply is over ${DM_TEXT_BYTES} bytes`);
    }
    return { keyword: rule.keyword, reply: rule.reply };
  });
}

// Holds the usage of the last Graph response. buildServe makes one and gives it to the service and to the poller's client,
// so each reading reaches the usage gate at once. The holder is not a property of the service object.
export function createUsageHolder() {
  let last;
  return {
    record(usage) {
      last = usage;
    },
    reading() {
      return last;
    },
  };
}

// Builds the service. config is the full config. state, events, caps, usageGate, guard, audit, unofficial and secrets are
// the modules of this project. getClient(loginProduct, { onUsage }) returns a Promise of a Graph client; the caller passes
// onUsage to createGraphClient, which calls it with each response's usage. usageHolder receives those readings (see
// createUsageHolder). now returns epoch milliseconds. mediaFs is the file system of media.dir ({ realpath, stat }, as
// node:fs/promises), and mediaFetch is the fetch that checks a publishing URL with HEAD. projectRoot is the folder that a
// relative media.dir is resolved against; by default it is the project root, as dataDir is.
export function createService({
  config,
  state,
  events,
  caps,
  usageGate,
  guard,
  audit,
  unofficial,
  secrets,
  getClient,
  usageHolder = createUsageHolder(),
  now = () => Date.now(),
  mediaFs = DEFAULT_MEDIA_FS,
  mediaFetch = (url, init) => globalThis.fetch(url, init),
  projectRoot = PROJECT_ROOT,
} = {}) {
  if (!isPlainObject(config) || !isPlainObject(config.owner)) throw new TypeError('createService needs the config');
  if (typeof config.owner.igUserId !== 'string' || config.owner.igUserId.trim() === '') {
    throw new TypeError('createService needs config.owner.igUserId as a string');
  }
  if (!isPlainObject(config.routes) || !isPlainObject(config.routes.unofficial) || !isPlainObject(config.routes.likes)) {
    throw new TypeError('createService needs config.routes with unofficial and likes');
  }
  if (!Number.isSafeInteger(config.caps?.usageBusyMs) || config.caps.usageBusyMs < 0) {
    throw new TypeError('createService needs config.caps.usageBusyMs as a whole number of 0 or more');
  }
  if (typeof config.autoReply?.enabled !== 'boolean') throw new TypeError('createService needs autoReply.enabled');
  const rules = checkRules(config.autoReply.rules);
  need(state, ['get', 'set', 'save'], 'a state');
  need(events, ['pending', 'ack', 'decide', 'lastInboundAt', 'markRead', 'unreadSenders', 'purge'], 'an event log');
  need(caps, ['check', 'record', 'usage'], 'caps');
  need(usageGate, ['check'], 'a usage gate');
  need(guard, ['assertNotStopped', 'stop', 'clearStop', 'stopStatus', 'gate', 'shouldStop'], 'a guard');
  need(audit, ['record'], 'an audit log');
  need(unofficial, ['forFeature'], 'an unofficial registry');
  need(secrets, ['source', 'set'], 'secrets');
  need(usageHolder, ['record', 'reading'], 'a usage holder');
  if (typeof getClient !== 'function') throw new TypeError('createService needs getClient as a function');
  if (typeof now !== 'function') throw new TypeError('createService needs now as a function');
  need(mediaFs, ['realpath', 'stat', 'open'], 'a media file system');
  if (typeof mediaFetch !== 'function') throw new TypeError('createService needs mediaFetch as a function');
  if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) {
    throw new TypeError('createService needs projectRoot as an absolute path');
  }

  const owner = config.owner.igUserId;
  const usageBusyMs = config.caps.usageBusyMs;
  // Each client gets the holder's record function, so the usage object of every response reaches the holder exactly as the
  // client gave it.
  const client = (product) => getClient(product, { onUsage: (usage) => usageHolder.record(usage) });

  // Writes one key of the state and saves it. A failed save is refused, so the caller does not act on it.
  function writeState(key, value) {
    state.set(key, value);
    try {
      state.save();
    } catch {
      throw new IgError('CONFIG', `${key} could not be saved to the state file`);
    }
  }

  // The one-reply flag, as this process holds it (P5a round 1, M-R1-2). It is read from the state at start, and set here by
  // setOneReplyUnknown. A save that fails and restores the state cannot drop it from the process, so privateReply still refuses.
  let oneReplyHeld = state.get('oneReplyUnknown', null);

  // The flag for a private reply whose audit line could not be written: a sent reply whose line is missing, or a failed attempt whose line is
  // missing (P5a round 1, I-1). The flag keeps its first time. It is saved on its own first, so a later failed save cannot drop it. A save that
  // fails keeps it in process. It never throws: the reply it follows has been sent, or may have been.
  function setOneReplyUnknown(reason) {
    const flag = { oneReplyUnknown: true, since: oneReplyHeld?.since ?? isoOf(now()), reason };
    oneReplyHeld = flag;
    state.set('oneReplyUnknown', flag);
    try {
      state.save();
    } catch {
      state.set('oneReplyUnknown', flag);
    }
  }

  function stateObject(key) {
    const value = state.get(key, {});
    if (!isPlainObject(value)) throw new IgError('CONFIG', `${key} in the state file is not valid`);
    return value;
  }

  function autoReplyEnabled() {
    const stored = state.get('autoReply.enabled', undefined);
    if (stored === undefined) return config.autoReply.enabled === true;
    return stored === true;
  }

  // The answered events: { id, preSendFailures, released }. A plain id, from an older state file, reads as an entry with no
  // failures. A released entry lets the one retry through; any other entry is an answer already given (P2-M2).
  function repliedList() {
    const value = state.get('autoReply.replied', []);
    if (!Array.isArray(value)) throw new IgError('CONFIG', 'autoReply.replied in the state file is not valid');
    return value.map((entry) => {
      if (typeof entry === 'string') return { id: entry, preSendFailures: 0, released: false };
      if (!isPlainObject(entry) || typeof entry.id !== 'string') {
        throw new IgError('CONFIG', 'autoReply.replied in the state file is not valid');
      }
      return { id: entry.id, preSendFailures: entry.preSendFailures ?? 0, released: entry.released === true };
    });
  }

  function repliedEntry(eventId) {
    return repliedList().find((entry) => entry.id === eventId);
  }

  function writeRepliedEntry(entry) {
    const others = repliedList().filter((item) => item.id !== entry.id);
    writeState('autoReply.replied', [...others, entry].slice(-REPLIED_LIMIT));
  }

  function tokenRecord() {
    const value = state.get('token', undefined);
    if (value === undefined) return null;
    if (
      !isPlainObject(value) ||
      typeof value.obtainedAt !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      !Array.isArray(value.scopes)
    ) {
      throw new IgError('CONFIG', 'the token record in the state file is not valid');
    }
    return value;
  }

  // The stop is observed on an error that stops outbound actions, so it is set through the guard, which saves it. A failed
  // save is not raised over the original error: the stop still holds in this process, and the save is retried later.
  function observe(err) {
    if (guard.shouldStop(err)) {
      try {
        guard.stop(err.kind, stopDetail(err));
      } catch {
        // Held in this process; the next assertNotStopped call saves it again.
      }
    }
    return err;
  }

  // The audit line is best effort: a failed write never changes the outcome of the action. It is not silent either. A failed
  // write emits one warning that carries the error name only, never the message, the entry, a target or a path.
  // Writes an audit line, best effort. Returns true when the line was written, and false when it was not (P5a round 1, I-1: a private
  // reply whose line is missing makes the one-reply records unknown).
  function safeAudit(entry) {
    try {
      audit.record(entry);
      return true;
    } catch (err) {
      process.emitWarning(`audit line not written (${errorName(err)})`);
      return false;
    }
  }

  function productOf(feature) {
    if (feature === 'like' || feature === 'unlike') return config.routes.likes.loginProduct;
    if (FACEBOOK.has(feature)) return 'facebook';
    return 'instagram';
  }

  function facebookTokenPresent() {
    const source = secrets.source('facebook_token');
    return source === 'env' || source === 'keyring';
  }

  // The route check. An unknown feature is refused, not passed. Official features need a business or creator account.
  function assertRoute(feature) {
    if (UNOFFICIAL.has(feature)) {
      const route = config.routes.unofficial;
      if (route.enabled !== true || route.acknowledged !== true) {
        throw refuse('ROUTE_DISABLED', 'unofficial features are off; routes.unofficial needs enabled and acknowledged');
      }
      // A failed restore of the unofficial session stops this route only. The account stops and the official routes are not checked here.
      const stop = unofficialRouteStop(state);
      if (stop !== null) {
        throw new IgError(
          'STOPPED',
          `the unofficial route is stopped (${stop.kind}); run ig routes login-unofficial again`,
          { kind: stop.kind, route: 'unofficial', since: stop.since ?? null },
        );
      }
      return;
    }
    if (!OFFICIAL.has(feature)) throw refuse('ROUTE_DISABLED', `the route for ${String(feature)} is not known`);
    // Only a business or creator account may use the official features. Config already limits the value to these three.
    if (config.owner.accountType !== 'business' && config.owner.accountType !== 'creator') {
      throw refuse('ROUTE_DISABLED', 'official features need a business or creator account');
    }
    if (productOf(feature) === 'facebook' && !facebookTokenPresent()) {
      throw refuse('ROUTE_DISABLED', 'no Facebook token is stored, so this feature is refused');
    }
  }

  // The usage hold. A reading that is missing, or that could not be read, refuses the call. Otherwise the usage gate
  // decides, with the app reading only (the gate rejects the business shape).
  function usageHold() {
    const latest = usageHolder.reading();
    const app = latest?.app;
    if (isPlainObject(app)) {
      const verdict = usageGate.check(app);
      return verdict.ok ? null : busyResult(verdict);
    }
    const reason =
      latest?.unreadable !== undefined
        ? `the usage header ${latest.unreadable} could not be read; outbound calls wait`
        : 'no app usage reading yet; outbound calls wait for a Graph response that gives one';
    return busyResult({ reason, retryAfterMs: usageBusyMs });
  }

  // The early usage refusal (see runOutbound). It refuses only on a known app reading that the gate holds. A missing reading or
  // an unreadable one gives null, so the reads go ahead.
  function earlyUsageHold() {
    const app = usageHolder.reading()?.app;
    if (!isPlainObject(app)) return null;
    const verdict = usageGate.check(app);
    return verdict.ok ? null : busyResult(verdict);
  }

  // The window check for a direct message. It is local: no request is made. Only the last inbound MESSAGE counts; a comment
  // or a mention from the same user does not open the window. dmSend's preflight and the auto-reply both call this.
  function requireOpenWindow(senderId) {
    const lastInboundAt = events.lastInboundAt(senderId, { kind: 'message' });
    const open = messageWindowOpen({ lastInboundAt, now: now() });
    if (!open) throw refuse('WINDOW_CLOSED', 'the last inbound message from this user is 24 hours old or more');
  }

  // The owned media ids, read page by page up to the read limit. The result is { ids, truncated, reason }. A failure that is
  // not a stop refuses the call.
  async function ownedSetOf(igc) {
    try {
      return await ownedMediaIds(igc, { limit: OWNED_PAGE });
    } catch (err) {
      if (guard.shouldStop(err)) throw err;
      throw refuse('OWNER_MISMATCH', 'the owner media could not be read, so ownership is not confirmed');
    }
  }

  // The refusal for a media id that is not among the owner media read. A truncated list is named, because a media beyond
  // the read limit is refused for that reason, and not because it is not the owner's.
  function notOwnedMessage(owned, subject) {
    return owned.truncated
      ? `${subject} is not among the owner media read, and the owner media list was truncated at its read limit, so it is refused`
      : `${subject} is not one of the owner media read, so it is refused`;
  }

  async function requireOwnedMedia(mediaId) {
    const owned = await ownedSetOf(await client('instagram'));
    if (!owned.ids.has(mediaId)) throw refuse('OWNER_MISMATCH', notOwnedMessage(owned, 'the media'));
  }

  // The parent media of a comment, which must be one of the owner's media. Returns the parent's id.
  async function ownedParentOf(commentId) {
    const igc = await client('instagram');
    let parent;
    try {
      parent = await commentParentMedia(igc, { commentId });
    } catch (err) {
      if (guard.shouldStop(err)) throw err;
      throw refuse('OWNER_MISMATCH', 'the parent media of the comment could not be read, so the comment is refused');
    }
    const owned = await ownedSetOf(igc);
    if (!owned.ids.has(parent)) throw refuse('OWNER_MISMATCH', notOwnedMessage(owned, "the comment's media"));
    return parent;
  }

  // The comment's own time, from its timestamp field. Only a stop error is passed on. Any other failure refuses the private
  // reply, because the 7-day window cannot be confirmed without the time (fail closed).
  async function commentTimeOf(igc, commentId) {
    try {
      return await commentTimestamp(igc, { commentId });
    } catch (err) {
      if (guard.shouldStop(err)) throw err;
      throw refuse('WINDOW_CLOSED', 'the comment time could not be read, so the 7-day window is not confirmed');
    }
  }

  // Releases a count made by record, when the action failed before any request reached Graph. A failure after an earlier
  // request of the same action reached Graph keeps the count (P2F-M3). A failed release throws CONFIG, which is swallowed
  // here: the count stays counted (fail closed).
  function releaseOnPreSend(err, token, action, args, earlierReached = false) {
    if (!isPreSend(err) || earlierReached) return;
    try {
      caps.release(token, action, args);
    } catch {
      // The count stays counted; the next attempt is refused by the caps as it would be after any counted failure.
    }
  }

  // The owner's usage reading for a like on media (O-11). With no reading in this process, one cheap read (the owner
  // profile) makes it. A failure of that read refuses the like with the read's error kind, so the like is not sent.
  async function ensureUsageReading() {
    if (isPlainObject(usageHolder.reading()?.app)) return;
    await readCall('instagram', (igc) => profileGet(igc));
  }

  // The stop that pauses a token refresh (O-6), or null. A refresh that is paused makes no request.
  function refreshPause() {
    const stop = guard.stopStatus();
    return stop.stopped && PAUSE_KINDS.has(stop.kind) ? stop : null;
  }

  function pauseReason(stop) {
    return `the token refresh is paused while ${stop.kind} stands; clear the stop with ig_stop_clear to resume it`;
  }

  // Releases the reservation of a comment after a pre-send failure. The first failure releases it for one more attempt; the
  // second keeps it, and the one retry is used up. Returns true when the one retry is still to come (P2-M2).
  function releasePrivateReply(commentId) {
    const replies = { ...stateObject('private_replies') };
    const previous = replies[commentId] ?? { at: isoOf(now()), preSendFailures: 0 };
    const failures = (previous.preSendFailures ?? 0) + 1;
    replies[commentId] = { at: previous.at, preSendFailures: failures, released: failures === 1 };
    writeState('private_replies', replies);
    return failures === 1;
  }

  // Releases the answered mark of an event after a pre-send failure, with the same one-retry rule (P2-M2). Returns true when
  // the one retry is still to come.
  function releaseReplied(eventId) {
    const previous = repliedEntry(eventId) ?? { id: eventId, preSendFailures: 0, released: false };
    const failures = previous.preSendFailures + 1;
    writeRepliedEntry({ id: eventId, preSendFailures: failures, released: failures === 1 });
    return failures === 1;
  }

  // Records the private reply before it is sent, so that a second one is refused. The check and the write are one
  // synchronous step, so two calls in this process cannot both pass. The reservation is { at, preSendFailures, released }:
  // a reservation that is not released refuses another attempt; a pre-send failure releases it for one more attempt (P2-M2).
  function reservePrivateReply(commentId) {
    const replies = stateObject('private_replies');
    const previous = replies[commentId];
    if (previous !== undefined && previous.released !== true) {
      throw refuse('CAP_EXCEEDED', 'this comment already has a private reply; only one is allowed per comment');
    }
    writeState('private_replies', {
      ...replies,
      [commentId]: { at: isoOf(now()), preSendFailures: previous?.preSendFailures ?? 0, released: false },
    });
  }

  async function requireQuota(igc) {
    const since = Math.floor((now() - DAY_MS) / 1000);
    const { quotaTotal, quotaUsage } = await contentPublishingLimit(igc, { igUserId: owner, since });
    if (quotaUsage >= quotaTotal) {
      throw refuse('CAP_EXCEEDED', `the publishing quota is used up (${quotaUsage} of ${quotaTotal} in 24 hours)`);
    }
  }

  // The audit line of a refused publish (P6 review M-9): the action, the kind as the target, the outcome refused and the reason
  // kind. It never carries a path, a caption or a URL.
  function refusedPublish(kind, reason) {
    safeAudit({
      action: 'publishMedia',
      target: PUBLISH_KINDS.includes(kind) ? kind : null,
      route: null,
      outcome: 'refused',
      detail: reason,
    });
  }

  // The publish call for a kind, with the URLs that resolveMedia checked. A single-media publish has url; a carousel has items.
  function publishBy(kind, igc, { url, items, caption, mediaKind }) {
    if (kind === 'image') return publishImage(igc, { igUserId: owner, imageUrl: url, caption });
    if (kind === 'reel') return publishReel(igc, { igUserId: owner, videoUrl: url, caption });
    if (kind === 'story') {
      return mediaKind === 'image'
        ? publishStory(igc, { igUserId: owner, imageUrl: url })
        : publishStory(igc, { igUserId: owner, videoUrl: url });
    }
    return publishCarousel(igc, { igUserId: owner, items, caption });
  }

  // The public base URL of the owner's host, or null when it is not set. A file publish is refused without it (checkPublish).
  function mediaBaseUrl() {
    const base = config.media?.publicBaseUrl;
    return typeof base === 'string' ? base : null;
  }

  // Resolves the inputs of a publish into the URLs that Graph will fetch, and the audit entries of its files. A file is checked
  // (its path, its real path under media.dir, its extension, its size, and the SHA-256 of its contents), and then its URL is
  // checked with HEAD (or with the one-byte GET fallback). A direct URL is checked the same way and has no audit entry. No
  // file is copied, and no request reaches Graph here. Runs in the preflight, so each check comes before the first Graph request.
  async function resolveMedia({ kind, url, file, urls, files, publicBaseUrl, storyImages }) {
    const mediaDir = () => resolveMediaDir(config.media.dir, projectRoot);
    // One source: a file under media.dir, or a direct URL. Returns the URL that Graph will fetch, and the file's audit entry.
    async function sourceUrl({ mediaKind, url: directUrl, file: fileName }) {
      if (fileName !== undefined) {
        const resolved = await resolveMediaFile({ fs: mediaFs, mediaDir: mediaDir(), file: fileName, mediaKind, publicBaseUrl });
        await checkMediaUrl({ fetchImpl: mediaFetch, url: resolved.url, mediaKind, size: resolved.size });
        return { fetchable: resolved.url, entry: { name: fileName, sha256: resolved.sha256 } };
      }
      await checkMediaUrl({ fetchImpl: mediaFetch, url: directUrl, mediaKind });
      return { fetchable: directUrl, entry: null };
    }
    if (kind !== 'carousel') {
      const mediaKind = kind === 'story' ? storyKindOf({ file, url, storyImages }) : kind === 'image' ? 'image' : 'video';
      const source = await sourceUrl({ mediaKind, url, file });
      return { url: source.fetchable, audit: source.entry === null ? [] : [source.entry], mediaKind };
    }
    const source = files === undefined ? 'urls' : 'files';
    const list = source === 'files' ? files : urls;
    const items = [];
    const audit = [];
    for (let index = 0; index < list.length; index += 1) {
      const child = parseCarouselItem(list[index], index, source);
      const checked = await sourceUrl({
        mediaKind: child.mediaKind,
        url: source === 'urls' ? child.value : undefined,
        file: source === 'files' ? child.value : undefined,
      });
      items.push(child.mediaKind === 'image' ? { imageUrl: checked.fetchable } : { videoUrl: checked.fetchable });
      if (checked.entry !== null) audit.push(checked.entry);
    }
    return { items, audit };
  }

  // The detail of a publish's audit line: the relative name and the SHA-256 of each file, in order. It never carries the
  // caption, and never a path beyond the relative name. Null when the publish has no file.
  function publishAuditDetail(audit) {
    if (audit.length === 0) return null;
    return audit.map(({ name, sha256 }) => `file ${name} sha256 ${sha256}`).join('; ');
  }

  // Every outbound action, in this order:
  //  1. the stop check; 2. the route; 3. the client (no request); 4. the confirm gate (a preview makes no request);
  //  5. an early caps check, and the usage hold on a known high reading (no read, no count), so a busy call makes no read;
  //  6. the owner check and the preflight (reads, no count); 7. the stop check, the caps check and the usage hold again,
  //  with caps.record, saved, before the request, all in one synchronous block; 8. perform; on error, the stop check, then
  //  the audit line. A busy result records nothing.
  async function runOutbound({
    action,
    feature,
    target = null,
    args = {},
    confirm,
    ownerCheck = null,
    preflight = null,
    preSendRelease = null,
    auditDetail = null,
    perform,
  }) {
    guard.assertNotStopped();
    assertRoute(feature);
    const unofficialFeature = UNOFFICIAL.has(feature);
    const product = unofficialFeature ? null : productOf(feature);
    const route = unofficialFeature ? 'unofficial' : product;
    // The client is made here; an unofficial feature has none. The adapter is resolved inside perform, so a preview, which
    // makes no request, never reaches the registry and never throws NOT_SUPPORTED.
    const ctx = { client: product === null ? null : await client(product) };
    if (guard.gate(confirm) === 'preview') return { preview: true, action, target };
    // An early refusal, made before any Graph read of the owner or the quota: a busy call makes no read. It records nothing,
    // and it is not the authoritative check; the checks below run again after the reads. The usage part refuses only on a
    // known reading that is high. With no reading, or an unreadable one, the reads go ahead, because they are what gives
    // a reading, and the authoritative hold after them decides.
    const early = caps.check(action, args);
    if (!early.ok) return busyResult(early);
    if (!unofficialFeature) {
      const heldEarly = earlyUsageHold();
      if (heldEarly !== null) return heldEarly;
    }
    try {
      if (ownerCheck) await ownerCheck(ctx);
      if (preflight) await preflight(ctx);
    } catch (err) {
      throw observe(err);
    }
    // The authoritative block: the stop check, the caps check, the usage hold and caps.record run in this order with no await
    // between them, so the verdict cannot change before the count is saved. A stop set during the reads above stops the
    // action here, and a refused stop records nothing.
    guard.assertNotStopped();
    const counted = caps.check(action, args);
    if (!counted.ok) return busyResult(counted);
    // The usage header comes from Graph responses, so the hold applies to official actions only. An unofficial action
    // makes no Graph request, and it has no header to read.
    if (!unofficialFeature) {
      const held = usageHold();
      if (held !== null) return held;
    }
    const token = caps.record(action, args);
    // The requests that perform makes are watched. A pre-send failure after an earlier request of this action reached Graph
    // (a publish whose container was made, for example) keeps its counts (P2F-M3).
    const sent = watchRequests(ctx.client);
    // The detail of the audit lines of this action, when the action has one (a publish's files). Read after the preflight.
    const detailOf = () => (auditDetail === null ? null : auditDetail());
    let result;
    try {
      result = await perform({ client: sent.client });
    } catch (err) {
      const failure = observe(err);
      const earlierReached = sent.watch.reached;
      // A failure before any request reached Graph is not an action. Its count is released, and the reservation the action
      // holds is released too. A pre-send failure after an earlier request reached Graph keeps both, as does every other
      // failure: the block stands (fail closed).
      releaseOnPreSend(failure, token, action, args, earlierReached);
      // The release says whether the one retry is still to come. A failed release keeps the reservation, so no retry is allowed.
      let retryLeft = null;
      if (isPreSend(failure) && !earlierReached && preSendRelease !== null) {
        try {
          retryLeft = preSendRelease() === true;
        } catch {
          retryLeft = false;
        }
      }
      const errorLineWritten = safeAudit({
        action: feature,
        target,
        route,
        outcome: 'error',
        detail: [detailOf(), errorDetail(failure)].filter((part) => part !== null).join('; '),
      });
      if (feature === 'privateReply' && !errorLineWritten) {
        setOneReplyUnknown('the audit line of a private reply that failed could not be written');
      }
      throw unknownOutcome(failure, feature, retryLeft, earlierReached);
    }
    // The write has happened and is counted, so a failing audit line must not turn it into a reported failure (a retry
    // would send it again). The audit line is best effort here, as on the error path.
    const okLineWritten = safeAudit({ action: feature, target, route, outcome: 'ok', detail: detailOf() });
    // A private reply that was sent, and whose audit line could not be written, leaves the one-reply records unknown (P5a round 1, I-1).
    if (feature === 'privateReply' && !okLineWritten) {
      setOneReplyUnknown('the audit line of a sent private reply could not be written');
    }
    return redact(result);
  }

  // The stop codes that a read sets, as the global constraints name them. AUTH_EXPIRED on a read is clean and sets nothing:
  // the brief pins that, and the owner clears it with a new token. The other three are account signals, so a read that
  // gets one stops outbound actions, through guard.stop, like any other call does.
  const READ_STOP_KINDS = new Set(['CHECKPOINT', 'ACTION_BLOCKED', 'RATE_LIMITED']);

  // A read: the client for the product, then the call. A failure is a clean IgError. The stop is set only for the codes in
  // READ_STOP_KINDS.
  async function readCall(product, fn) {
    let igc;
    try {
      igc = await client(product);
    } catch (err) {
      throw readError(err);
    }
    return readWith(igc, fn);
  }

  // The read itself, with a client already in hand. A stop code of a read is observed here.
  async function readWith(igc, fn) {
    try {
      return redact(await fn(igc));
    } catch (err) {
      if (err instanceof IgError && READ_STOP_KINDS.has(err.kind)) observe(err);
      throw readError(err);
    }
  }

  // A lookup of another account (P2-I2). It refuses under any held stop, and it obtains its client first, so a failed client
  // build spends no count (P2-M1). It then counts toward its own bucket only, and reads. A pre-send failure releases the count.
  // A busy result is returned as it is, and records nothing. The wrap runs on a successful result only. A lookup with a feature
  // writes one audit line for its outcome, with its action and no identifier (P4 review, lost-state rebuild), so the caps can be
  // rebuilt from the audit file. A hashtag search writes its own line, with the tag, and passes no feature.
  async function lookup({ product, bucket, opts = {}, wrap = (value) => value, fn, feature = null }) {
    guard.assertNotStopped();
    let igc;
    try {
      igc = await client(product);
    } catch (err) {
      throw readError(err);
    }
    const counted = caps.check(bucket, opts);
    if (!counted.ok) return busyResult(counted);
    const token = caps.record(bucket, opts);
    try {
      const value = wrap(await readWith(igc, fn));
      if (feature !== null) safeAudit({ action: feature, target: null, route: product, outcome: 'ok', detail: null });
      return value;
    } catch (err) {
      releaseOnPreSend(err, token, bucket, opts);
      if (feature !== null) safeAudit({ action: feature, target: null, route: product, outcome: 'error', detail: errorDetail(err) });
      throw err;
    }
  }

  // The token expiry, or a null reading with a warning when the time cannot be read (P2-M6). The status still reports.
  function expiryOrNull(expiresAt, at) {
    try {
      return expiryStatus({ expiresAt, now: at });
    } catch {
      return { daysLeft: null, warning: 'the expiry time cannot be read' };
    }
  }

  // The token age in hours, or null when the obtained time cannot be read.
  function ageOrNull(obtainedAt, at) {
    try {
      return tokenAgeHours({ obtainedAt, now: at });
    } catch {
      return null;
    }
  }

  // The auto-reply rule for a text: the first rule whose keyword is in the text, ignoring case. Undefined when none is.
  function matchRule(text) {
    const lower = text.toLowerCase();
    return rules.find((rule) => lower.includes(rule.keyword.toLowerCase()));
  }

  function autoReplyTo(event, rule) {
    return runOutbound({
      action: 'auto_reply',
      feature: 'autoReply',
      target: event.senderId,
      args: { senderId: event.senderId },
      confirm: true,
      preflight: () => requireOpenWindow(event.senderId),
      preSendRelease: () => releaseReplied(event.id),
      perform: ({ client: igc }) => {
        // The event is marked before the send, so a redelivered event is never answered twice. A retry keeps its failure count.
        const previous = repliedEntry(event.id);
        writeRepliedEntry({ id: event.id, preSendFailures: previous?.preSendFailures ?? 0, released: false });
        return sendMessage(igc, { igUserId: owner, recipientId: event.senderId, text: rule.reply });
      },
    });
  }

  // The inbound hook. It never rejects, because the poller does not wait for it. Every event that is not answered is
  // audited with the sender and the time, never the text.
  async function handleInbound(event) {
    if (!isPlainObject(event) || typeof event.senderId !== 'string' || typeof event.id !== 'string') {
      safeAudit({ action: 'inbound', target: null, route: null, outcome: 'skipped', detail: 'MALFORMED' });
      return;
    }
    const sender = event.senderId;
    const when = typeof event.receivedAt === 'string' ? event.receivedAt : 'unknown time';
    const skip = (reason) =>
      safeAudit({ action: 'inbound', target: sender, route: null, outcome: 'skipped', detail: `${reason}; received ${when}` });
    if (sender === owner) return skip('OWNER');
    if (event.kind !== 'message') return skip('NOT_A_MESSAGE');
    // The notify step checks the stop (P4 review M-10). While any stop holds, nothing is notified and no reply is sent. The event
    // itself is already stored, because the event log does not depend on the state file, and runOutbound refuses a reply under
    // the stop as well.
    const stop = guard.stopStatus();
    if (stop.stopped) return skip(`STOPPED: ${stop.kind}`);
    if (!autoReplyEnabled()) return skip('AUTO_REPLY_OFF');
    if (typeof event.text !== 'string' || event.text.trim() === '') return skip('EMPTY_TEXT');
    const rule = matchRule(event.text);
    if (rule === undefined) return skip('NO_RULE');
    const answered = repliedEntry(event.id);
    if (answered !== undefined && !answered.released) {
      return skip(answered.preSendFailures >= 2 ? 'RETRY_USED_UP' : 'ALREADY_HANDLED');
    }
    try {
      const result = await autoReplyTo(event, rule);
      if (result?.busy) skip(`BUSY: ${result.reason}`);
    } catch (err) {
      skip(err instanceof IgError ? err.kind : 'UNEXPECTED');
    }
  }

  return wrapArguments({
    // ----- Status and admin -----
    async status() {
      return redact({
        accountType: config.owner.accountType,
        stop: guard.stopStatus(),
        routes: {
          unofficial: { enabled: config.routes.unofficial.enabled, acknowledged: config.routes.unofficial.acknowledged },
          likesLoginProduct: config.routes.likes.loginProduct,
        },
        autoReply: { enabled: autoReplyEnabled() },
        refreshPaused: refreshPause() !== null,
        // Set when the state file was unreadable at start: which counters were rebuilt and from what, and that the token record
        // is empty (P4 review M-11). Null when no recovery was needed.
        recovery: state.get('recovery', null),
        // The one-reply flag: set when the audit file could not be read for the one-reply records, with its time and reason. It stays set
        // through a confirmed clear, and a later start that reads the audit file clears it (P4 fix round 2).
        oneReplyUnknown: oneReplyHeld ?? state.get('oneReplyUnknown', null),
      });
    },

    async capsStatus() {
      return caps.usage();
    },

    async stopStatus() {
      return guard.stopStatus();
    },

    async stopClear({ confirm } = {}) {
      const result = guard.clearStop(confirm);
      if (result === 'cleared') safeAudit({ action: 'stopClear', target: null, route: null, outcome: 'ok', detail: null });
      // A confirmed clear ends the recovery that the stop began: the recovery record is cleared, so its start note is not shown again
      // (P4 final N-8). A save that fails is refused, so the owner can confirm the clear again.
      // The one-reply flag is not cleared here: a confirmed clear of the stop does not lift the private-reply refusal that the flag causes.
      // Only a later start that reads the audit file clears it (P4 fix round 2, the one-reply gap).
      if (result !== 'preview' && state.get('recovery', null) !== null) {
        state.set('recovery', null);
        try {
          state.save();
        } catch {
          throw new IgError('CONFIG', 'the recovery record could not be cleared; confirm ig_stop_clear again');
        }
      }
      return { result };
    },

    // The expiry of the token, the days left, a warning under 7 days, and whether a refresh is paused (O-6).
    async tokenStatus() {
      const pause = refreshPause();
      const refreshPaused = pause !== null;
      const refreshPauseReason = refreshPaused ? pauseReason(pause) : null;
      const record = tokenRecord();
      if (record === null) {
        return {
          known: false,
          ageHours: null,
          expiresAt: null,
          daysLeft: null,
          // The instruction stays while the token record is absent, so a confirmed clear of the recovery does not remove it (P4 fix
          // round 2, N-12). ig auth login writes the record again.
          warning: 'the token record is empty; run ig auth login to write it again',
          canRefresh: false,
          refreshPaused,
          refreshPauseReason,
        };
      }
      const at = now();
      const expiry = expiryOrNull(record.expiresAt, at);
      return {
        known: true,
        ageHours: ageOrNull(record.obtainedAt, at),
        expiresAt: record.expiresAt,
        daysLeft: expiry.daysLeft,
        warning: expiry.warning,
        canRefresh: canRefresh({ obtainedAt: record.obtainedAt, expiresAt: record.expiresAt, now: at, scopes: record.scopes }),
        refreshPaused,
        refreshPauseReason,
      };
    },

    // Refreshes the owner token when canRefresh allows it. The new token is stored in the secrets and its record is
    // updated with an expiry 60 days out. The token is never returned.
    async tokenRefresh() {
      // Under CHECKPOINT or ACTION_BLOCKED the refresh is paused: no request is made, and the caller is told why (O-6).
      const pause = refreshPause();
      if (pause !== null) {
        safeAudit({ action: 'tokenRefresh', target: null, route: 'instagram', outcome: 'paused', detail: pause.kind });
        return { paused: true, reason: pauseReason(pause) };
      }
      const record = tokenRecord();
      if (record === null) throw invalid('no token record exists, so the token age cannot be checked');
      const at = now();
      const allowed = canRefresh({
        obtainedAt: record.obtainedAt,
        expiresAt: record.expiresAt,
        now: at,
        scopes: record.scopes,
      });
      if (!allowed) {
        throw invalid('the token cannot be refreshed yet: it must be at least 24 hours old, not expired, and hold instagram_business_basic');
      }
      let refreshed;
      try {
        refreshed = await refreshToken({ client: await client('instagram'), loginProduct: 'instagram' });
      } catch (err) {
        // A refresh changes the token, so a stop error on it (error 190 included) sets the stop, as a write does. Then it
        // is rethrown.
        throw observe(readError(err));
      }
      secrets.set('owner_token', refreshed.token);
      writeState('token', { obtainedAt: isoOf(at), expiresAt: isoOf(at + TOKEN_TTL_MS), scopes: record.scopes });
      safeAudit({ action: 'tokenRefresh', target: null, route: 'instagram', outcome: 'ok', detail: null });
      return { refreshed: true, expiresAt: isoOf(at + TOKEN_TTL_MS) };
    },

    // Turns auto-replies on or off. Without confirm true it previews and changes nothing.
    async autoReplySet({ enabled, confirm } = {}) {
      if (typeof enabled !== 'boolean') throw invalid('enabled must be true or false');
      if (guard.gate(confirm) === 'preview') return { preview: true, action: 'auto_reply_set', target: null };
      writeState('autoReply.enabled', enabled);
      safeAudit({ action: 'autoReplySet', target: null, route: null, outcome: 'ok', detail: `enabled=${enabled}` });
      return { enabled };
    },

    // ----- Reads -----
    async profileGet() {
      return readCall('instagram', (igc) => profileGet(igc));
    },

    async mediaList({ limit, after } = {}) {
      return readCall('instagram', (igc) => mediaList(igc, { limit, after }));
    },

    async mediaGet({ mediaId } = {}) {
      checkId(mediaId, 'mediaId');
      return readCall('instagram', async (igc) => {
        await requireOwnedMedia(mediaId);
        return mediaGet(igc, { mediaId });
      });
    },

    async insightsAccount({ metrics, period } = {}) {
      return readCall('instagram', (igc) => accountInsights(igc, { igUserId: owner, metrics, period }));
    },

    async insightsMedia({ mediaId, metrics } = {}) {
      checkId(mediaId, 'mediaId');
      return readCall('instagram', async (igc) => {
        await requireOwnedMedia(mediaId);
        return mediaInsights(igc, { mediaId, metrics });
      });
    },

    // Mentions are other accounts' media by definition, so no owner check applies. The caption is untrusted.
    // The mentions are other accounts' media. Each lookup counts toward its own daily cap of 50 (O-4), and not toward the
    // outbound spacing or total (P2-I2).
    async mentionedMedia({ mediaId } = {}) {
      checkId(mediaId, 'mediaId');
      return lookup({
        product: 'instagram',
        bucket: 'mentioned_media',
        wrap: untrusted,
        fn: (igc) => mentionedMedia(igc, { igUserId: owner, mediaId }),
        feature: 'mentionedMedia',
      });
    },

    // The comments on one of the owner's media, read page by page up to the read limit. truncated is set when a next page
    // exists beyond that limit, and reason says so; it does not follow the length of a page (A-15).
    async commentsList({ mediaId, limit = COMMENT_PAGE } = {}) {
      checkId(mediaId, 'mediaId');
      return readCall('instagram', async (igc) => {
        await requireOwnedMedia(mediaId);
        const page = await commentsList(igc, { mediaId, limit });
        return { comments: page.items.map(untrusted), truncated: page.truncated, reason: page.reason };
      });
    },

    // The owner's conversations, read page by page up to the read limit. A malformed conversation is skipped and counted.
    async dmConversations() {
      return readCall('instagram', async (igc) => {
        const page = await readConversations(igc, { igUserId: owner, limit: CONVERSATION_PAGE });
        return {
          conversations: page.items,
          skippedConversations: page.skippedConversations,
          truncated: page.truncated,
          reason: page.reason,
        };
      });
    },

    // The messages of the conversation with a recipient, read page by page up to limit messages (1 to 1000, default 1000).
    // The conversation is the first valid one that the lookup finds, reading pages within the bound until it finds one or
    // runs out (M-3); with no match the list is empty. Each message is untrusted. A malformed message is skipped and counted
    // in skippedMessages. truncated says whether more messages exist beyond the read, and reason names the bound that stopped
    // it. nextAfter is the cursor to continue from, when more remain past the bound: pass it as after to read on (M-4).
    async dmMessages({ recipientId, limit, after } = {}) {
      checkId(recipientId, 'recipientId');
      const wanted = limit ?? DM_MESSAGES_MAX;
      if (!Number.isInteger(wanted) || wanted < 1 || wanted > DM_MESSAGES_MAX) {
        throw invalid(`limit must be a whole number from 1 to ${DM_MESSAGES_MAX}`);
      }
      if (after !== undefined && (typeof after !== 'string' || after === '')) {
        throw invalid('after must be a non-empty cursor string when it is given');
      }
      return readCall('instagram', async (igc) => {
        // One valid conversation is enough, so the lookup stops at the first one, and a page of malformed rows does not end it.
        const found = await readConversations(igc, { igUserId: owner, userId: recipientId, maxItems: 1 });
        const skippedConversations = found.skippedConversations;
        if (found.items.length === 0) {
          return { messages: [], skippedMessages: 0, skippedConversations, truncated: false, reason: null, nextAfter: null };
        }
        const thread = await readThread(igc, { conversationId: found.items[0].id, maxItems: wanted, after });
        return {
          messages: thread.items.map(untrusted),
          skippedMessages: thread.skippedMessages,
          skippedConversations,
          truncated: thread.truncated,
          reason: thread.reason,
          nextAfter: thread.nextAfter,
        };
      });
    },

    async dmUnread() {
      return { senders: events.unreadSenders() };
    },

    async dmMarkRead({ senderId } = {}) {
      checkId(senderId, 'senderId');
      events.markRead(senderId);
      return { senderId, marked: true };
    },

    // A hashtag search counts toward the hashtag cap, so it obeys the stop, and each counted search has an audit line. A
    // busy result records nothing, so it has no line. A failed lookup is an error, never a no-match.
    async hashtagSearch({ q } = {}) {
      if (typeof q !== 'string' || !HASHTAG.test(q)) {
        throw invalid('q must be 1 to 100 letters, digits or underscores, without the #');
      }
      assertRoute('hashtagSearch');
      guard.assertNotStopped();
      const tag = q.toLowerCase();
      try {
        return await lookup({
          product: 'facebook',
          bucket: 'hashtag',
          opts: { tag },
          wrap: (result) => {
            safeAudit({ action: 'hashtagSearch', target: tag, route: 'facebook', outcome: 'ok', detail: null });
            return result;
          },
          fn: (igc) => hashtagSearch(igc, { igUserId: owner, q }),
        });
      } catch (err) {
        const failure =
          err instanceof IgError && err.kind === 'API_ERROR'
            ? new IgError('API_ERROR', 'the hashtag lookup failed; this is not a no-match', err.details)
            : err;
        safeAudit({ action: 'hashtagSearch', target: tag, route: 'facebook', outcome: 'error', detail: errorDetail(failure) });
        throw failure;
      }
    },

    // A lookup of another account's public profile. Each lookup counts toward the daily cap of 50 (O-4). A lookup with a bad
    // username or fields is refused before it is counted.
    async businessDiscovery({ username, fields } = {}) {
      assertRoute('businessDiscovery');
      if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
        throw invalid('username must be 1 to 30 letters, digits, periods or underscores');
      }
      if (typeof fields !== 'string' || !FIELDS_PATTERN.test(fields)) {
        throw invalid('fields must be comma-joined lowercase field names');
      }
      return lookup({
        product: 'facebook',
        bucket: 'business_discovery',
        wrap: untrusted,
        fn: (igc) => businessDiscovery(igc, { igUserId: owner, username, fields }),
        feature: 'businessDiscovery',
      });
    },

    // ----- Events. None of these sends anything. -----
    async eventsPending({ limit } = {}) {
      const page = events.pending({ limit });
      // The notice is set only by the first pending after a confirmed clear of a state loss (P4 final N-1).
      const notice = page.notice === undefined ? {} : { notice: page.notice };
      return redact({ events: page.events.map(untrusted), nextCursor: page.nextCursor, ...notice });
    },

    async eventsAck({ cursor } = {}) {
      events.ack(cursor);
      return { acknowledged: true };
    },

    // Records a decision and an optional draft. The audit line names the decision, never the draft.
    async eventsDecide({ eventId, decision, draft } = {}) {
      if (!EVENT_DECISIONS.includes(decision)) throw invalid(`decision must be one of ${EVENT_DECISIONS.join(', ')}`);
      const event = events.decide(eventId, { action: decision, draft });
      safeAudit({ action: 'eventsDecide', target: eventId, route: null, outcome: 'ok', detail: `decision=${decision}` });
      return redact(untrusted(event));
    },

    async eventsPurge() {
      const { removed } = events.purge();
      safeAudit({ action: 'eventsPurge', target: null, route: null, outcome: 'ok', detail: `removed=${removed}` });
      return { removed };
    },

    // ----- Outbound: official -----
    // A publish takes one source: url or file for image, reel and story, and urls or files for a carousel. A file is a path
    // under media.dir, served by the owner's host at media.publicBaseUrl; it is never copied. The checks that need no read
    // run before the count (checkPublish), and the reads and HEAD checks run in the preflight, before the first Graph
    // request (the quota read included). A failed check refuses the publish with no count spent.
    async publishMedia({ kind, url, file, urls, files, caption, confirm } = {}) {
      // reached: the request part has begun. A refusal before it writes one audit line here; an error from the request part is
      // audited by runOutbound, so it is not written twice.
      let reached = false;
      try {
        if (!PUBLISH_KINDS.includes(kind)) throw invalid(`kind must be one of ${PUBLISH_KINDS.join(', ')}`);
        const publicBaseUrl = mediaBaseUrl();
        const storyImages = config.story?.images === true;
        const allowedHosts = config.media?.allowedHosts ?? [];
        checkPublish({ kind, url, file, urls, files, caption, publicBaseUrl, storyImages, allowedHosts });
        let resolved = null;
        const result = await runOutbound({
          action: 'publish',
          feature: 'publishMedia',
          target: kind,
          args: {},
          confirm,
          preflight: async ({ client: igc }) => {
            resolved = await resolveMedia({ kind, url, file, urls, files, publicBaseUrl, storyImages });
            await requireQuota(igc);
          },
          auditDetail: () => (resolved === null ? null : publishAuditDetail(resolved.audit)),
          perform: ({ client: igc }) => {
            reached = true;
            return publishBy(kind, igc, { ...resolved, caption });
          },
        });
        // A busy result is a refusal too: the publish did not run, and nothing was counted.
        if (result !== null && typeof result === 'object' && result.busy === true) refusedPublish(kind, 'BUSY');
        return result;
      } catch (err) {
        if (!reached) refusedPublish(kind, err instanceof IgError ? err.kind : 'UNEXPECTED');
        throw err;
      }
    },

    async commentReply({ commentId, text, confirm } = {}) {
      checkId(commentId, 'commentId');
      checkText(text, 'text');
      return runOutbound({
        action: 'comment_reply',
        feature: 'commentReply',
        target: commentId,
        args: {},
        confirm,
        ownerCheck: () => ownedParentOf(commentId),
        perform: ({ client: igc }) => commentReply(igc, { commentId, text }),
      });
    },

    async commentHide({ commentId, hide, confirm } = {}) {
      checkId(commentId, 'commentId');
      if (hide !== true && hide !== false) throw invalid('hide must be true or false');
      return runOutbound({
        action: 'comment_hide',
        feature: 'commentHide',
        target: commentId,
        args: {},
        confirm,
        ownerCheck: () => ownedParentOf(commentId),
        perform: ({ client: igc }) => commentHide(igc, { commentId, hide }),
      });
    },

    async commentDelete({ commentId, confirm } = {}) {
      checkId(commentId, 'commentId');
      return runOutbound({
        action: 'comment_delete',
        feature: 'commentDelete',
        target: commentId,
        args: {},
        confirm,
        ownerCheck: () => ownedParentOf(commentId),
        perform: ({ client: igc }) => commentDelete(igc, { commentId }),
      });
    },

    // A like or unlike on a comment checks the comment's parent media, which must be the owner's (the comments of other
    // accounts' posts are not acted on). A like or unlike on a media goes to any named target, within the caps.
    async like({ targetId, kind, confirm } = {}) {
      checkId(targetId, 'targetId');
      if (!LIKE_KINDS.includes(kind)) throw invalid("kind must be 'media' or 'comment'");
      return runOutbound({
        action: 'like',
        feature: 'like',
        target: targetId,
        args: {},
        confirm,
        ownerCheck: kind === 'comment' ? () => ownedParentOf(targetId) : null,
        preflight: kind === 'media' ? ensureUsageReading : null,
        perform: ({ client: igc }) => like(igc, { igUserId: owner, targetId, kind }),
      });
    },

    async unlike({ targetId, kind, confirm } = {}) {
      checkId(targetId, 'targetId');
      if (!LIKE_KINDS.includes(kind)) throw invalid("kind must be 'media' or 'comment'");
      return runOutbound({
        action: 'unlike',
        feature: 'unlike',
        target: targetId,
        args: {},
        confirm,
        ownerCheck: kind === 'comment' ? () => ownedParentOf(targetId) : null,
        preflight: kind === 'media' ? ensureUsageReading : null,
        perform: ({ client: igc }) => unlike(igc, { igUserId: owner, targetId, kind }),
      });
    },

    // A direct message. The window is checked before the request, and the text is checked against the byte limit first.
    async dmSend({ recipientId, text, confirm } = {}) {
      checkId(recipientId, 'recipientId');
      checkText(text, 'text', DM_TEXT_BYTES);
      return runOutbound({
        action: 'owner_dm',
        feature: 'dmSend',
        target: recipientId,
        args: {},
        confirm,
        preflight: () => requireOpenWindow(recipientId),
        perform: ({ client: igc }) => sendMessage(igc, { igUserId: owner, recipientId, text }),
      });
    },

    // A private reply: one per comment, and only within 7 days of the comment. Both refusals are made before any request.
    async privateReply({ commentId, text, confirm } = {}) {
      checkId(commentId, 'commentId');
      checkText(text, 'text', DM_TEXT_BYTES);
      // The one-reply records could not be rebuilt from the audit file (P4 fix round 2, N-10). A second reply to a comment that already has one
      // cannot then be refused locally, so no private reply is sent while the flag oneReplyUnknown is set. The flag is held through a confirmed
      // clear of the stop, and only a later start that reads the audit file clears it (the one-reply gap). The refusal names the cause, and no
      // request is made. The flag key is ONE_REPLY_UNKNOWN_KEY in src/caps.js.
      // The process holds the flag too, so a state that no longer holds it (after a failed save) does not lift the refusal (P5a round 1, M-R1-2).
      const oneReplyUnknown = oneReplyHeld ?? state.get('oneReplyUnknown', null);
      if (oneReplyUnknown !== null) {
        throw refuse('STOPPED', `private replies are refused: ${oneReplyUnknown.reason}; a later start that reads the audit file clears this refusal`);
      }
      return runOutbound({
        action: 'private_reply',
        feature: 'privateReply',
        target: commentId,
        args: {},
        confirm,
        preflight: async ({ client: igc }) => {
          const record = stateObject('private_replies')[commentId];
          if (record !== undefined && record.released !== true) {
            throw refuse(
              'CAP_EXCEEDED',
              (record.preSendFailures ?? 0) >= 2
                ? 'the private reply failed twice before it reached Instagram, and the one retry is used up'
                : 'this comment already has a private reply; only one is allowed per comment',
            );
          }
          // A comment on another account's post is refused first; then the comment's own time decides the window.
          await ownedParentOf(commentId);
          const createdAt = await commentTimeOf(igc, commentId);
          let open;
          try {
            open = privateReplyOpen({ commentCreatedAt: createdAt, now: now() });
          } catch {
            throw refuse('WINDOW_CLOSED', 'the comment time is not a readable time, so the 7-day window is not confirmed');
          }
          if (!open) throw refuse('WINDOW_CLOSED', 'the comment is more than 7 days old');
        },
        preSendRelease: () => releasePrivateReply(commentId),
        perform: ({ client: igc }) => {
          reservePrivateReply(commentId);
          return privateReply(igc, { igUserId: owner, commentId, text });
        },
      });
    },

    async mediaDelete({ mediaId, confirm } = {}) {
      checkId(mediaId, 'mediaId');
      return runOutbound({
        action: 'outbound',
        feature: 'mediaDelete',
        target: mediaId,
        args: {},
        confirm,
        ownerCheck: () => requireOwnedMedia(mediaId),
        perform: ({ client: igc }) => mediaDelete(igc, { mediaId }),
      });
    },

    // ----- Outbound: unofficial, gated by route -----
    async follow({ userId, confirm } = {}) {
      checkId(userId, 'userId');
      return runOutbound({
        action: 'follow',
        feature: 'follow',
        target: userId,
        args: {},
        confirm,
        perform: () => unofficial.forFeature('follow').follow(userId),
      });
    },

    async unfollow({ userId, confirm } = {}) {
      checkId(userId, 'userId');
      return runOutbound({
        action: 'unfollow',
        feature: 'unfollow',
        target: userId,
        args: {},
        confirm,
        perform: () => unofficial.forFeature('unfollow').unfollow(userId),
      });
    },

    async profileEdit({ fields, confirm } = {}) {
      if (!isPlainObject(fields)) throw invalid('fields must be an object');
      return runOutbound({
        action: 'profile_edit',
        feature: 'profileEdit',
        target: null,
        args: {},
        confirm,
        perform: () => unofficial.forFeature('profileEdit').profileEdit(fields),
      });
    },

    // The inbound hook. It is async, and it never rejects.
    async onInbound(event) {
      try {
        await handleInbound(event);
      } catch (err) {
        safeAudit({ action: 'inbound', target: null, route: null, outcome: 'error', detail: errorDetail(err) });
      }
    },
  });
}
