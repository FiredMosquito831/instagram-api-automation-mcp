// The poller. On each tick it lists the owner's conversations through the paged reader (readConversations: up to 100 a page,
// and up to 1000 conversations), reads each changed thread's messages through the messages edge (readThread), and stores
// each inbound message once in the event log. It only reads: the client it uses offers get and nothing else, so no write can
// be made through it. Its writes go to the event log, the state and the audit log.
//
// A thread is changed when its updated_time differs from the value stored under poll.seen.<id>. Every read waits poll.spacingMs
// first. The selection has two budgets (P4 review I-4). Normal threads, the most recently updated first, take a slot each, up to
// maxThreadsPerTick. A thread that holds a message stamped ahead of the clock is deferred, and it takes no slot. Deferred threads are
// read after the others, from a budget of their own, also maxThreadsPerTick. The first pass stops after 2 * maxThreadsPerTick reads,
// so a list with many held threads cannot take the whole tick.
//
// The rules that go beyond the brief are kept here in the code, so each one can be found and reversed:
//   A-24: a thread that fails is backed off for 1, 2, 4 ... up to 32 ticks, so the other threads get the slots. A thread that
//         reads cleanly clears its backoff. The backoff is kept in the state (poll.backoff.<id>), with the tick counter
//         (poll.tick), so a restart keeps it.
//   A-26: a message stamped more than five minutes ahead of the clock is held: it is not stored, and its thread is not
//         marked read, so the thread is read again on the next tick. After 24 hours from its first sighting it is audited
//         as poll.skip with reason future-time, and it is dropped from the retry. The dropped record is kept for the dedupe
//         window, so the message is not stored when its time passes (P4 review M-6).
//   I-2:  a message whose created time is older than the dedupe window is not stored, because the window is the only memory of
//         a purged message. Its skips are audited once per thread and read, with the count and the reason, and no text.
//   A-28: state for a conversation that has not been listed for 30 days is pruned: its seen value, its listed time, its
//         continuation cursor, its backoff and its deferral. Future records are pruned on their own rules (see stampAndPrune).
//   A-30 (continuation): a thread that has more messages than one read takes keeps a cursor (poll.after.<id>), and the next
//         tick continues from it, so an older message is not lost. The thread is not marked read until the cursor is done.

import { ConfigError } from './config.js';
import { ACCOUNT_STOP_KINDS, IgError } from './errors.js';
import { DEDUPE_MS, MAX_FUTURE_MS } from './events.js';
import { readConversations, readThread } from './graph/endpoints/messaging.js';
import { MAX_TIMER_MS } from './util/clock.js';
import { isoOf } from './util/time.js';
import { isPlainObject } from './util/object.js';

const SEEN_PREFIX = 'poll.seen.';
const LISTED_PREFIX = 'poll.listed.';
const AFTER_PREFIX = 'poll.after.';
const FUTURE_PREFIX = 'poll.future.';
// The tick counter and the per-thread backoff and deferral (P4 fix): kept in the state, so a restart keeps them.
const TICK_KEY = 'poll.tick';
const BACKOFF_PREFIX = 'poll.backoff.';
const DEFERRED_PREFIX = 'poll.deferred.';
const MAX_BACKOFF_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SEEN_RETENTION_MS = 30 * DAY_MS;
const FUTURE_HOLD_MS = 24 * HOUR_MS;
const MAX_THREAD_BACKOFF_TICKS = 32;
const UNKNOWN_KIND = 'UNKNOWN';
// The stops that halt the poller. A RATE_LIMITED stop backs the poller off, and it does not halt it. STATE_CORRUPT and
// STATE_LOST halt it too: the poller cannot trust its dedupe and stop state, so it makes no request until the owner clears
// the stop with ig_stop_clear.
const HALTING = new Set(['AUTH_EXPIRED', 'CHECKPOINT', 'ACTION_BLOCKED', 'STATE_CORRUPT', 'STATE_LOST']);
const ACTION_LIST = 'poll.list';
const ACTION_MESSAGES = 'poll.messages';
const ACTION_SKIP = 'poll.skip';
const ACTION_NOTIFY = 'poll.notify';
// The conversations list asks for pages of this size. The paged reader follows the pages, up to its own bounds.
const CONVERSATION_PAGE = 100;
const DEFAULT_THREAD_ITEMS = 1000;
const MAX_THREAD_ITEMS = 1000;
// The bounds of each poll setting, inclusive. A value outside them is refused when the poller is built.
const BOUNDS = Object.freeze({
  intervalMs: [1000, MAX_TIMER_MS],
  maxThreadsPerTick: [1, 100],
  spacingMs: [600, 60000],
});

// Reads config.poll. Each setting must be a whole number inside its bounds, and an unknown setting is refused.
function readPollSettings(config) {
  const poll = config?.poll;
  if (!isPlainObject(poll)) throw new ConfigError('poll', 'must be an object');
  for (const key of Object.keys(poll)) {
    if (!Object.hasOwn(BOUNDS, key)) throw new ConfigError(`poll.${key}`, 'is not a known poll setting');
  }
  const settings = {};
  for (const [key, [min, max]] of Object.entries(BOUNDS)) {
    const value = poll[key];
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new ConfigError(`poll.${key}`, `must be a whole number from ${min} to ${max}`);
    }
    settings[key] = value;
  }
  return settings;
}

// The detail of a stop: the kind, the HTTP status and the Graph code. It carries no message text, so no secret can reach it.
function stopDetail(kind, err) {
  const { status = null, code = null } = err.details ?? {};
  return `${kind} from Graph (HTTP ${status ?? 'none'}, code ${code ?? 'none'})`;
}

function hasTime(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// The time in milliseconds, or -Infinity when the text is not a time, so that the sort order is the same on every tick.
function timeOf(value) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

const newestFirst = (a, b) => timeOf(b.updatedTime) - timeOf(a.updatedTime);
const oldestFirst = (a, b) => timeOf(a.createdTime) - timeOf(b.createdTime);

const seenKey = (conversationId) => `${SEEN_PREFIX}${conversationId}`;
const listedKey = (conversationId) => `${LISTED_PREFIX}${conversationId}`;
const afterKey = (conversationId) => `${AFTER_PREFIX}${conversationId}`;
const futureKey = (messageId) => `${FUTURE_PREFIX}${messageId}`;
const backoffKey = (conversationId) => `${BACKOFF_PREFIX}${conversationId}`;
const deferredKey = (conversationId) => `${DEFERRED_PREFIX}${conversationId}`;
// The time of a stored ISO text, in milliseconds, or NaN.
const parseIso = (value) => (typeof value === 'string' ? Date.parse(value) : Number.NaN);

// A client for the reads. Each call waits spacingMs first, so every Graph read is spaced, including the page reads that the
// paged readers make one after another. It has get and nothing else.
function spacedReader(client, sleep, spacingMs) {
  if (client === null || typeof client !== 'object' || typeof client.get !== 'function') {
    throw new IgError('CONFIG', 'the Graph client has no get method');
  }
  return {
    async get(path, query) {
      await sleep(spacingMs);
      return client.get(path, query);
    },
  };
}

// The counts of one tick, all zero.
function emptyCounts() {
  return {
    threadsRead: 0,
    appended: 0,
    errors: 0,
    skippedMessages: 0,
    skippedConversations: 0,
    futureHeld: 0,
    backedOff: 0,
  };
}

// Builds the poller. config is the full config (config.poll is read). owner is the owner's igUserId. getClient returns the
// Graph client, and sleep, now and onInbound are injected. audit records each failure and each skipped message. threadMaxItems
// is the most messages one thread read takes in a tick (1 to 1000, 1000 by default). Returns { tick, start, stop }.
export function createPoller({
  getClient,
  owner,
  events,
  state,
  guard,
  config,
  sleep,
  now,
  audit,
  onInbound,
  threadMaxItems = DEFAULT_THREAD_ITEMS,
} = {}) {
  if (typeof getClient !== 'function') throw new TypeError('createPoller needs getClient as a function');
  if (typeof owner !== 'string' || !/^\d+$/.test(owner)) {
    throw new TypeError('createPoller needs the owner igUserId as a string of digits');
  }
  if (typeof events?.hasId !== 'function' || typeof events?.append !== 'function' || typeof events?.drainNotices !== 'function') {
    throw new TypeError('createPoller needs an event log with hasId, append and drainNotices');
  }
  if (
    typeof state?.get !== 'function' ||
    typeof state?.set !== 'function' ||
    typeof state?.save !== 'function' ||
    typeof state?.delete !== 'function' ||
    typeof state?.keys !== 'function' ||
    typeof state?.drainNotices !== 'function'
  ) {
    throw new TypeError('createPoller needs a state with get, set, save, delete, keys and drainNotices');
  }
  if (typeof guard?.stop !== 'function' || typeof guard?.stopStatus !== 'function') {
    throw new TypeError('createPoller needs a guard with stop and stopStatus');
  }
  if (typeof audit?.record !== 'function') throw new TypeError('createPoller needs an audit log with record');
  if (typeof sleep !== 'function') throw new TypeError('createPoller needs sleep as a function');
  if (typeof now !== 'function') throw new TypeError('createPoller needs now as a function');
  if (typeof onInbound !== 'function') throw new TypeError('createPoller needs onInbound as a function');
  if (!Number.isSafeInteger(threadMaxItems) || threadMaxItems < 1 || threadMaxItems > MAX_THREAD_ITEMS) {
    throw new TypeError(`createPoller needs threadMaxItems from 1 to ${MAX_THREAD_ITEMS}`);
  }
  const poll = readPollSettings(config);

  // The interval in use. It doubles after a rate limit, up to 10 minutes, and returns to poll.intervalMs after a clean tick.
  let intervalMs = poll.intervalMs;
  let halted = false;
  let running = false;
  let ticking = false;
  let timer = null;
  // The number of the tick that is running. It is kept in the state (TICK_KEY), so a backoff's retry tick means the same tick
  // after a restart.
  let tickNo = 0;

  // The halt follows the guard on every check. A halting stop that the guard holds halts the poller, including one that was
  // saved by an earlier process. The halt is released when the stored stop is cleared, and also when the stored stop is one
  // that does not halt (RATE_LIMITED), so an old halt cannot outlast the stop that caused it. While halted, no request is
  // made.
  function isHalted() {
    const stop = guard.stopStatus();
    halted = stop.stopped === true && HALTING.has(stop.kind);
    return halted;
  }

  // Records a failed read and returns what the tick does next: 'continue', 'backoff' or 'halted'. A stop code is set
  // through the guard, which saves it. The audit line carries the kind and the action, never the message text.
  function handleFailure(err, action, target) {
    const kind = err instanceof IgError ? err.kind : UNKNOWN_KIND;
    if (ACCOUNT_STOP_KINDS.has(kind)) {
      let saved = true;
      try {
        guard.stop(kind, stopDetail(kind, err));
      } catch {
        // The guard holds the stop for this process even when its save failed, so the stop still applies here.
        saved = false;
      }
      // The stop the guard holds now. When a save fails, that save can be for an earlier unsaved stop of another kind, so
      // the failed save is named by the kind the guard holds, not by the observed kind.
      const held = guard.stopStatus().kind;
      if (!saved) audit.record({ action, target, outcome: 'stop_not_saved', detail: held });
      // The guard keeps a stored stop that ranks higher than this one. That is audited too, so no observed stop is silent.
      if (held !== kind) audit.record({ action, target, outcome: 'stop_kept', detail: { observed: kind, stored: held } });
      if (kind === 'RATE_LIMITED') {
        intervalMs = Math.max(intervalMs, Math.min(intervalMs * 2, MAX_BACKOFF_MS));
        audit.record({ action, target, outcome: 'backoff', detail: kind });
        return 'backoff';
      }
      halted = true;
      audit.record({ action, target, outcome: 'halted', detail: kind });
      return 'halted';
    }
    audit.record({ action, target, outcome: 'error', detail: kind });
    return 'continue';
  }

  // The backoff of a thread that failed: its failure count, and the tick it is retried on. It is in the state, so a restart keeps
  // it (P4 fix). A value that is not a backoff record is read as no backoff.
  function backoffOf(conversationId) {
    const value = state.get(backoffKey(conversationId), null);
    return isPlainObject(value) && Number.isSafeInteger(value.count) && Number.isSafeInteger(value.retryAt) ? value : null;
  }

  // The tick a thread may be read on again: 0 when it is not in backoff.
  function retryTickOf(conversationId) {
    return backoffOf(conversationId)?.retryAt ?? 0;
  }

  // A thread that failed is retried after 1, 2, 4 ... ticks, up to MAX_THREAD_BACKOFF_TICKS (A-24). The record is written, then the
  // state is saved, as the rest of the state is.
  function noteThreadFailure(conversationId) {
    const count = (backoffOf(conversationId)?.count ?? 0) + 1;
    const waitTicks = Math.min(2 ** (count - 1), MAX_THREAD_BACKOFF_TICKS);
    state.set(backoffKey(conversationId), { count, retryAt: tickNo + waitTicks + 1 });
    state.save();
  }

  // A thread that reads cleanly has its backoff cleared.
  function clearBackoff(conversationId) {
    if (state.get(backoffKey(conversationId), null) === null) return;
    state.delete(backoffKey(conversationId));
    state.save();
  }

  // Whether a thread holds a future-stamped message, so that it is deferred (P4 fix, item 1).
  function isDeferred(conversationId) {
    return state.get(deferredKey(conversationId), null) === true;
  }

  // The tick counter of the state, from the last tick that ran; 0 before the first.
  function persistedTick() {
    const value = state.get(TICK_KEY, 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  // Writes the notices of the event log to the audit log, such as an index rebuild (P4 fix, item 2). It runs at the start of every
  // tick, before the halt check, so that a notice is written even while the poller is halted.
  function writeNotice(notice) {
    audit.record({ action: notice.action, target: notice.target, outcome: notice.outcome, detail: notice.detail });
  }
  function drainNotices() {
    events.drainNotices(writeNotice);
    state.drainNotices(writeNotice);
  }

  // The stored cursor of a thread that is partly read, or undefined. A value that is not text is ignored, so the thread is read
  // from its newest message.
  function afterCursorOf(conversationId) {
    const value = state.get(afterKey(conversationId), null);
    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  // The record of a held future message, or null: its first sighting in ms, and whether it was dropped.
  function futureRecordOf(messageId) {
    const value = state.get(futureKey(messageId), null);
    if (!isPlainObject(value) || typeof value.dropped !== 'boolean' || Number.isNaN(parseIso(value.first))) return null;
    return { first: parseIso(value.first), dropped: value.dropped, createdAt: parseIso(value.createdAt) };
  }

  // Holds a message stamped ahead of the clock (A-26). The first sighting is saved in the state, so the 24 hours are counted
  // across ticks and across restarts. After 24 hours it is audited as poll.skip with reason future-time, and it is dropped:
  // the record stays with dropped true, so a later read of the thread does not start the 24 hours again. Returns 'held' or
  // 'dropped'.
  function futureHold(messageId, createdTime) {
    const record = futureRecordOf(messageId);
    const nowMs = now();
    if (record === null) {
      state.set(futureKey(messageId), { first: isoOf(nowMs), dropped: false, createdAt: createdTime });
      state.save();
      return 'held';
    }
    if (record.dropped) return 'dropped';
    if (nowMs - record.first < FUTURE_HOLD_MS) return 'held';
    state.set(futureKey(messageId), { first: isoOf(record.first), dropped: true, createdAt: createdTime });
    state.save();
    audit.record({ action: ACTION_SKIP, target: messageId, outcome: 'skipped', detail: 'future-time' });
    return 'dropped';
  }

  // Removes the future record of a message that is now stored, or that is no longer ahead of the clock.
  function clearFuture(messageId) {
    if (state.get(futureKey(messageId), null) === null) return;
    state.delete(futureKey(messageId));
    state.save();
  }

  // Stores the new messages of one thread, oldest first. Returns true when a message is held back (A-26), so that the thread
  // is not marked read. A message that the event log refuses is audited and skipped, so one bad message does not hold its
  // thread back. A message already stored is not stored again. The owner's own messages are not stored.
  function storeMessages(messages, appended, counts, conversationId) {
    let held = false;
    let aged = 0;
    for (const message of messages.slice().sort(oldestFirst)) {
      if (message.fromId === owner) continue;
      if (events.hasId(message.id, 'message')) continue;
      // A message with no time is refused, not stored at the clock time. The endpoint gives an absent or blank created_time
      // as null, so this check skips that message, and the rest of its thread is still stored.
      if (!hasTime(message.createdTime)) {
        audit.record({ action: ACTION_SKIP, target: message.id, outcome: 'skipped', detail: 'VALIDATION' });
        continue;
      }
      const createdMs = Date.parse(message.createdTime);
      // A message older than the dedupe window is never stored (P4 review I-2): the window is the only memory of a purged message, so
      // storing one again would deliver it twice. The skips of a thread are audited as one line with the count, below. A line per
      // message would be written on every read of a long thread.
      if (now() - createdMs > DEDUPE_MS) {
        aged += 1;
        continue;
      }
      // A message dropped as a future message is never stored, even when its time has passed (P4 review M-6).
      if (futureRecordOf(message.id)?.dropped === true) continue;
      if (createdMs > now() + MAX_FUTURE_MS) {
        if (futureHold(message.id, message.createdTime) === 'held') {
          held = true;
          counts.futureHeld += 1;
        }
        continue;
      }
      clearFuture(message.id);
      try {
        appended.push(
          events.append({
            id: message.id,
            kind: 'message',
            senderId: message.fromId,
            text: message.text ?? '',
            receivedAt: message.createdTime,
          }),
        );
      } catch (err) {
        if (!(err instanceof IgError) || err.kind !== 'VALIDATION') throw err;
        audit.record({ action: ACTION_SKIP, target: message.id, outcome: 'skipped', detail: err.kind });
      }
    }
    if (aged > 0) {
      audit.record({
        action: ACTION_SKIP,
        target: conversationId,
        outcome: 'skipped',
        detail: { reason: 'older-than-window', count: aged },
      });
    }
    return held;
  }

  // Announces each event once, after it is stored. A callback that throws is audited, and the tick goes on.
  function announce(appended) {
    for (const event of appended) {
      try {
        onInbound(event);
      } catch {
        audit.record({ action: ACTION_NOTIFY, target: null, outcome: 'error', detail: 'CALLBACK_ERROR' });
      }
    }
  }

  // Removes the state of a conversation that has gone stale (A-28).
  function removeConversation(conversationId) {
    state.delete(seenKey(conversationId));
    state.delete(listedKey(conversationId));
    state.delete(afterKey(conversationId));
    state.delete(backoffKey(conversationId));
    state.delete(deferredKey(conversationId));
  }

  // Stamps the conversations that the list returned with the time they were listed, and prunes the state of those not listed
  // for 30 days (A-28). It also prunes future records older than 30 days. A seen value with no listed time gets one now, so
  // that it ages out 30 days from now.
  function stampAndPrune(listedIds, nowMs) {
    const nowIso = isoOf(nowMs);
    for (const id of listedIds) state.set(listedKey(id), nowIso);
    for (const key of state.keys(LISTED_PREFIX)) {
      const id = key.slice(LISTED_PREFIX.length);
      if (listedIds.has(id)) continue;
      const listed = parseIso(state.get(key, null));
      if (Number.isNaN(listed)) state.set(key, nowIso);
      else if (nowMs - listed > SEEN_RETENTION_MS) removeConversation(id);
    }
    for (const key of state.keys(SEEN_PREFIX)) {
      const id = key.slice(SEEN_PREFIX.length);
      if (!listedIds.has(id) && state.get(listedKey(id), null) === null) state.set(listedKey(id), nowIso);
    }
    // A backoff or a deferral for a conversation that is no longer listed is dropped with it.
    for (const prefix of [BACKOFF_PREFIX, DEFERRED_PREFIX]) {
      for (const key of state.keys(prefix)) {
        if (!listedIds.has(key.slice(prefix.length))) state.delete(key);
      }
    }
    // A future record is pruned on its own rules. A dropped one is kept for the dedupe window, measured from the message's own
    // time, because the message can still be read in its thread (P4 review M-6). A held one that never reached a drop is pruned
    // after 30 days.
    for (const key of state.keys(FUTURE_PREFIX)) {
      const record = futureRecordOf(key.slice(FUTURE_PREFIX.length));
      if (record === null) state.delete(key);
      else if (record.dropped) {
        if (Number.isNaN(record.createdAt) || nowMs - record.createdAt > DEDUPE_MS) state.delete(key);
      } else if (nowMs - record.first > SEEN_RETENTION_MS) state.delete(key);
    }
    state.save();
  }

  // Reads one thread and commits what it found: the messages, the cursor, the seen value or the deferral, and the backoff. It
  // returns { stop, held }. stop is the status to end the tick with, or null to carry on. held is true when the thread holds a
  // message stamped ahead of the clock, so the thread is deferred and does not take a slot (P4 fix, item 1).
  async function readThreadOnce(client, conversation, counts, readThisTick) {
    // The guard is asked before each thread, so a halting stop that was set during this tick, by a write or by another caller,
    // stops the remaining reads at once.
    if (isHalted()) return { stop: 'halted', held: false };
    readThisTick.add(conversation.id);
    const appended = [];
    let failure = null;
    let continued = false;
    try {
      const after = afterCursorOf(conversation.id);
      continued = after !== undefined;
      const page = await readThread(client, { conversationId: conversation.id, maxItems: threadMaxItems, after });
      counts.skippedMessages += page.skippedMessages;
      // The reader counts only rows that fail the shape check, and it reports them as API_ERROR (messaging.js, readRow). So the kind
      // written here is the reader's only skip kind, not a literal chosen here (P4 review M-4).
      if (page.skippedMessages > 0) {
        audit.record({
          action: ACTION_MESSAGES,
          target: conversation.id,
          outcome: 'skipped',
          detail: { kind: 'API_ERROR', count: page.skippedMessages },
        });
      }
      // A read that stops before the end of the thread keeps its cursor, and the next tick continues from it.
      if (page.truncated) {
        audit.record({
          action: ACTION_MESSAGES,
          target: conversation.id,
          outcome: 'truncated',
          detail: { reason: page.reason, returned: page.items.length },
        });
      }
      const held = storeMessages(page.items, appended, counts, conversation.id);
      const continuing = page.truncated && typeof page.nextAfter === 'string';
      if (continuing) state.set(afterKey(conversation.id), page.nextAfter);
      else if (state.get(afterKey(conversation.id), null) !== null) state.delete(afterKey(conversation.id));
      if (held) state.set(deferredKey(conversation.id), true);
      else if (state.get(deferredKey(conversation.id), null) !== null) state.delete(deferredKey(conversation.id));
      if (!held && !continuing) state.set(seenKey(conversation.id), conversation.updatedTime);
      state.save();
      counts.threadsRead += 1;
      clearBackoff(conversation.id);
      counts.appended += appended.length;
      announce(appended);
      return { stop: null, held };
    } catch (err) {
      failure = err;
    }
    // Events stored before a failure are still announced, so that a later failure does not lose them.
    counts.appended += appended.length;
    announce(appended);
    counts.errors += 1;
    // A cursor that failed to read is dropped, so the thread is read again from its newest message.
    if (continued && state.get(afterKey(conversation.id), null) !== null) {
      state.delete(afterKey(conversation.id));
      state.save();
    }
    const next = handleFailure(failure, ACTION_MESSAGES, conversation.id);
    if (next !== 'continue') return { stop: next, held: false };
    noteThreadFailure(conversation.id);
    return { stop: null, held: false };
  }

  // One tick. A clean tick returns the interval to poll.intervalMs (A-29: here, not in finish).
  //
  // The selection (P4 fix, item 1). The changed threads are read newest first, and up to maxThreadsPerTick of them take a slot.
  // A thread that holds a message stamped ahead of the clock is deferred: it does not take a slot, so the threads after it are read
  // in the same tick. A deferred thread is read after the others on every later tick, until its message is within tolerance or is
  // dropped after 24 hours.
  async function runTick() {
    tickNo = persistedTick() + 1;
    // The tick number is written with the next save of the state, which every tick makes when it stamps the list. A tick that
    // stops before that save does not write it, and the number is the same as the one a later save writes.
    state.set(TICK_KEY, tickNo);
    const counts = emptyCounts();
    let client;
    let listed;
    try {
      client = spacedReader(await getClient(), sleep, poll.spacingMs);
      listed = await readConversations(client, { igUserId: owner, limit: CONVERSATION_PAGE });
    } catch (err) {
      const next = handleFailure(err, ACTION_LIST, null);
      return finish(next === 'continue' ? 'error' : next, counts);
    }
    counts.skippedConversations = listed.skippedConversations;
    if (listed.skippedConversations > 0) {
      audit.record({
        action: ACTION_LIST,
        target: null,
        outcome: 'skipped',
        detail: { kind: 'API_ERROR', count: listed.skippedConversations },
      });
    }
    // A list that stops before the end lists only its first pages. The conversations beyond them are not read this tick.
    if (listed.truncated) {
      audit.record({
        action: ACTION_LIST,
        target: null,
        outcome: 'truncated',
        detail: { reason: listed.reason, returned: listed.items.length },
      });
    }
    const conversations = listed.items;
    const listedIds = new Set(conversations.map((conversation) => conversation.id));
    stampAndPrune(listedIds, now());
    // A conversation with no updated time (null) is skipped and audited. It is never read as changed, and the others are
    // still read.
    for (const conversation of conversations) {
      if (!hasTime(conversation.updatedTime)) {
        audit.record({ action: ACTION_SKIP, target: conversation.id, outcome: 'skipped', detail: 'VALIDATION' });
      }
    }
    const eligible = conversations.filter(
      (conversation) =>
        hasTime(conversation.updatedTime) && state.get(seenKey(conversation.id), null) !== conversation.updatedTime,
    );
    const ready = eligible.filter((conversation) => retryTickOf(conversation.id) <= tickNo);
    counts.backedOff = eligible.length - ready.length;
    const deferredIds = new Set(
      ready.filter((conversation) => isDeferred(conversation.id)).map((conversation) => conversation.id),
    );
    const normal = ready.filter((conversation) => !deferredIds.has(conversation.id)).sort(newestFirst);
    const later = ready.filter((conversation) => deferredIds.has(conversation.id)).sort(newestFirst);
    const readThisTick = new Set();
    let slots = poll.maxThreadsPerTick;
    let firstPassReads = 0;
    for (const conversation of normal) {
      if (slots === 0 || firstPassReads >= 2 * poll.maxThreadsPerTick) break;
      const step = await readThreadOnce(client, conversation, counts, readThisTick);
      if (step.stop !== null) return finish(step.stop, counts);
      firstPassReads += 1;
      // A thread that holds a future message does not take a slot, so the next thread is read in this tick.
      if (!step.held) slots -= 1;
    }
    // The deferred threads have a budget of their own, equal to maxThreadsPerTick (P4 review I-4).
    let deferredBudget = poll.maxThreadsPerTick;
    for (const conversation of later) {
      if (deferredBudget === 0) break;
      if (readThisTick.has(conversation.id)) continue;
      const step = await readThreadOnce(client, conversation, counts, readThisTick);
      if (step.stop !== null) return finish(step.stop, counts);
      deferredBudget -= 1;
    }
    intervalMs = poll.intervalMs;
    return finish('ok', counts);
  }

  // The summary of a tick. It only reports; the interval is reset by runTick.
  function finish(status, counts) {
    return { status, ...counts, intervalMs, at: isoOf(now()) };
  }

  // One read of the owner's conversations and of the changed threads. It returns a summary. It makes no request while the
  // poller is halted, and it is refused while another tick is running.
  async function tick() {
    drainNotices();
    if (isHalted()) return finish('halted', emptyCounts());
    if (ticking) return finish('in_progress', emptyCounts());
    ticking = true;
    try {
      return await runTick();
    } finally {
      ticking = false;
    }
  }

  function schedule(ms) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(runScheduled, ms);
  }

  // Runs one tick, then schedules the next at the interval in use. The interval can change after a rate limit, so it is
  // read after each tick. A halted poller keeps its timer, and each tick checks the guard, so a cleared stop resumes it.
  async function runScheduled() {
    timer = null;
    if (!running) return;
    try {
      await tick();
    } catch (err) {
      // A tick that throws, such as a failed audit write, does not stop the loop. The reads are read-only, so the next
      // tick is safe. The warning carries the error name only.
      process.emitWarning(`poll tick failed (${err?.name ?? 'error'})`);
    }
    if (running) schedule(intervalMs);
  }

  // Starts the loop. The first tick runs at once.
  function start() {
    if (running) return;
    running = true;
    schedule(0);
  }

  function stop() {
    running = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return { tick, start, stop };
}
