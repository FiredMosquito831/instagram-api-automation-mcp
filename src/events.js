// The inbound event log. Each event is one JSON line. Callers take events in batches with pending() and acknowledge
// them with a cursor. Nothing here sends anything.
//
// Dedupe. An event is known by its kind and its raw id (A-22), so a comment and a mention with the same id are two events. The
// known keys are kept in memory and in a small index file in the data directory (event-ids.jsonl, A-6). Each key is kept for 90 days
// from the time the event log received it, which is longer than the 30-day event retention, so a redelivery of a purged event is
// refused for 90 days, and after that the key is pruned and the id is new again. The time of a key is its receipt time when the index
// recorded it. A key that the log learns without a record (after a crash between the event write and the index write, or from an
// index rebuilt from the event file) starts at the time the log loaded it. That time is later than the receipt, so such a key stays
// known for at least 90 days (P4 review M-3).
// hasId reads only memory (A-9); the index file is read once, at start, and it is rewritten only when it is pruned or rebuilt.
// A damaged or missing index is rebuilt from its valid lines and from the event file, with a notice for the audit log (P4 fix).
// The event cursors are unknown after a state loss, or after a damaged acked or issued position. While they are unknown and the stop
// holds, pending and ack are refused with STOPPED and a reason that names the loss, and nothing is delivered. A confirmed clear starts
// the cursors again at zero: the next pending carries a notice, and each event keeps its id, so a consumer dedupes by id (P4 final N-1).

import * as nodeFs from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isRealDate } from './calendar.js';
import { IgError } from './errors.js';
import { maskRegistered, redact } from './redact.js';
import { CURSORS_LOST_KEY, writeFileAtomic } from './state.js';
import { ACKED_KEY, ISSUED_KEY, LAST_SEQ_KEY } from './util/state-keys.js';
import { clockMs } from './util/clock.js';
import { MAX_FUTURE_MS } from './util/time.js';
import { isPlainObject, isState } from './util/object.js';

const KINDS = ['message', 'comment', 'mention', 'unknown'];
const ACTIONS = ['reply', 'ignore', 'escalate'];
const DEFAULT_LIMIT = 20;
const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// MAX_FUTURE_MS, the allowance for a received time ahead of the clock, is defined in src/util/time.js. It stays exported here.
export { MAX_FUTURE_MS };
// The window in which a received event's key is remembered, in days. It is longer than the 30-day event retention (A-6).
const DEDUPE_DAYS = 90;
// The dedupe window in milliseconds. The poller uses it to refuse a message older than the window (P4 review I-2).
export const DEDUPE_MS = DEDUPE_DAYS * DAY_MS;
const DEFAULT_INDEX_FILE = 'event-ids.jsonl';
// The note that the first pending after a confirmed clear carries (P4 review N-1). Every event keeps its id, so a consumer dedupes by it.
// The reset to zero is the owner-decided exception to "the cursors never move backwards" (P4 fix round 2, N-14): a missed inbound
// message is treated as worse than a duplicate.
const CURSOR_RESET_NOTE =
  'the event cursors were started again after a state loss, so events from the start of the event file are delivered again, each with its id; dedupe by id. This is the owner-decided exception to the rule that the cursors never move backwards: a missed inbound message is treated as worse than a duplicate';
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const readKey = (senderId) => `dm.read.${senderId}`;
const keyOf = (kind, id) => `${kind}:${id}`;
// The kinds whose stored id carries the kind as a prefix (comment:<id>, mention:<id>). A comment and a mention with the same raw
// id are then two events with two distinct ids, so eventsDecide on one does not reach the other (P4 fix). A message id is
// stored as it arrives, because message ids do not share a space with comment or mention ids.
const QUALIFIED_KINDS = new Set(['comment', 'mention', 'unknown']);
const storedIdOf = (kind, id) => (QUALIFIED_KINDS.has(kind) ? `${kind}:${id}` : id);
// The raw id of a stored event: its id without the kind prefix. An event stored before the prefix existed has none, and its id
// is read as it is.
function rawIdOf(event) {
  const prefix = `${event.kind}:`;
  return QUALIFIED_KINDS.has(event.kind) && event.id.startsWith(prefix) ? event.id.slice(prefix.length) : event.id;
}

// A caller's input is refused with VALIDATION. A stored value or line that is wrong is refused with CONFIG.
function invalid(message) {
  return new IgError('VALIDATION', message);
}

function storeError(message) {
  return new IgError('CONFIG', message);
}

// A file-system error is wrapped as a CONFIG error with a fixed kind. The message names the operation and the file's role,
// and the error code, but never the path or the file's contents (A-5).
function io(label, operation, action) {
  try {
    return action();
  } catch (err) {
    if (err instanceof IgError) throw err;
    throw storeError(`the ${label} could not be ${operation} (${err?.code ?? 'error'})`);
  }
}

function requireText(value, what) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${what} must be a non-empty string`);
  return value;
}

function checkKind(kind) {
  if (!KINDS.includes(kind)) throw invalid(`kind must be one of ${KINDS.join(', ')}`);
  return kind;
}

// The time in milliseconds of an ISO 8601 string with a zone, or NaN. The calendar date must exist (see calendar.js), because
// Date.parse rolls an impossible day forward. Out-of-range hours, minutes and seconds are already NaN from Date.parse.
function parseIsoTime(value) {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) return Number.NaN;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!isRealDate(year, month, day)) return Number.NaN;
  return Date.parse(value);
}

function isStoredDecision(value) {
  return (
    isPlainObject(value) &&
    ACTIONS.includes(value.action) &&
    (value.draft === null || typeof value.draft === 'string') &&
    !Number.isNaN(parseIsoTime(value.at))
  );
}

// Checks every field of a stored event, so that a wrong type or an unknown status is refused, not read as valid.
function isStoredEvent(value) {
  return (
    isPlainObject(value) &&
    Number.isSafeInteger(value.seq) &&
    value.seq >= 1 &&
    typeof value.id === 'string' &&
    value.id.trim() !== '' &&
    KINDS.includes(value.kind) &&
    typeof value.senderId === 'string' &&
    value.senderId.trim() !== '' &&
    typeof value.text === 'string' &&
    !Number.isNaN(parseIsoTime(value.receivedAt)) &&
    value.untrusted === true &&
    ((value.status === 'new' && value.decision === null) ||
      (value.status === 'handled' && isStoredDecision(value.decision)))
  );
}

// Parses one line of JSON, or returns undefined when the text is not JSON.
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Returns the event on one line, or null when the text does not hold a stored event.
function parseEvent(text) {
  const value = parseJson(text);
  return isStoredEvent(value) ? value : null;
}

// The first line of a file may be a header, {"lastSeq": N}. It records the highest seq the file has held, so that the
// events removed by purge do not leave their seqs free for reuse. Returns N, or null when the text is not a header.
function parseHeader(text) {
  const value = parseJson(text);
  if (!isPlainObject(value) || !Object.hasOwn(value, 'lastSeq') || Object.keys(value).length !== 1) return null;
  return Number.isSafeInteger(value.lastSeq) && value.lastSeq >= 0 ? value.lastSeq : null;
}

// Reads the event file, with the events in seq order. highWater is the seq in the header, or 0 when there is none. A
// last line that does not parse is torn, as a crash leaves it: it is left out, and tornAt is the byte offset where it
// starts, so that append can remove it. A last line that parses but has no newline is kept, and unterminated is set, so
// that append starts on a new line. Any other damaged line is refused, because a crash can tear only the last line.
function readStore(file, fs) {
  if (!io('event file', 'read', () => fs.existsSync(file))) {
    return { events: [], highWater: 0, tornAt: null, unterminated: false };
  }
  const buffer = io('event file', 'read', () => fs.readFileSync(file));
  // The byte offset just after the last newline. Offsets come from the bytes, not from re-encoding the text.
  const cut = buffer.lastIndexOf(0x0a) + 1;
  const complete = buffer.subarray(0, cut).toString('utf8').split('\n');
  complete.pop();
  const events = [];
  let highWater = 0;
  let last = 0;
  let sawLine = false;
  complete.forEach((line, index) => {
    if (line.trim() === '') return;
    const isFirst = !sawLine;
    sawLine = true;
    if (isFirst) {
      const header = parseHeader(line);
      if (header !== null) {
        highWater = header;
        return;
      }
    }
    const event = parseEvent(line);
    if (event === null || event.seq <= last) {
      throw storeError(`the event file has a damaged or out-of-order line at line ${index + 1}`);
    }
    events.push(event);
    last = event.seq;
  });
  const tail = buffer.subarray(cut).toString('utf8');
  let tornAt = null;
  let unterminated = false;
  if (tail !== '') {
    const event = parseEvent(tail);
    if (event === null) {
      tornAt = cut;
    } else if (event.seq <= last) {
      throw storeError('the event file has a damaged or out-of-order last line');
    } else {
      events.push(event);
      unterminated = true;
    }
  }
  return { events, highWater, tornAt, unterminated };
}

// The highest seq that the file holds, from its header or from its events.
function fileHighWater(store) {
  return store.events.reduce((max, event) => Math.max(max, event.seq), store.highWater);
}

// Writes the whole event file again, atomically. Used when an event changes or is purged. The header keeps highWater,
// so that a purge does not lower the highest seq the file has held.
function writeEvents(file, events, highWater, fs) {
  const header = highWater > 0 ? `${JSON.stringify({ lastSeq: highWater })}\n` : '';
  io('event file', 'rewritten', () =>
    writeFileAtomic(file, header + events.map((event) => `${JSON.stringify(event)}\n`).join(''), fs),
  );
}

// Appends text to the file, and flushes it to the disk before it returns. A caller that answers after this returns has
// an event that survives a power loss. The order of the calls is open, write, fsync, close (A-7).
function appendText(label, file, text, fs) {
  io(label, 'appended to', () => {
    const fd = fs.openSync(file, 'a');
    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  });
}

// A whole number from the state. A missing key gives 0. Any other value is refused, not coerced.
function storedWhole(state, key) {
  const value = state.get(key, 0);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw storeError(`${key} in the state file must be a whole number of 0 or more`);
  }
  return value;
}

// True when the state holds any of the three event cursors. A healthy state holds one once an event is stored.
function anyCursor(state) {
  return [ISSUED_KEY, ACKED_KEY, LAST_SEQ_KEY].some((key) => state.get(key, undefined) !== undefined);
}

// A whole number, or 0 when the value is not one. Used for the cursors that a reset keeps.
const wholeOrZero = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

// The issued and acked positions, and the last seq saved with the state. acked can never be above issued.
function readCursors(state) {
  const issued = storedWhole(state, ISSUED_KEY);
  const acked = storedWhole(state, ACKED_KEY);
  if (acked > issued) throw storeError(`${ACKED_KEY} is greater than ${ISSUED_KEY} in the state file`);
  const lastSeq = storedWhole(state, LAST_SEQ_KEY);
  return { issued, acked, lastSeq };
}

// A cursor is base64url of 'c' and the seq. Only the exact encoding is accepted, so each seq has one cursor.
function encodeCursor(seq) {
  return Buffer.from(`c${seq}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  const refuse = () => invalid('the cursor is not valid');
  if (typeof cursor !== 'string' || !/^[\w-]+$/.test(cursor)) throw refuse();
  const match = /^c([1-9]\d*)$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  const seq = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(seq) || encodeCursor(seq) !== cursor) throw refuse();
  return seq;
}

// Event text is untrusted and may hold a secret, so every event handed out is redacted. The stored event is unchanged. A comment or
// a mention carries targetId, its raw Graph id, which the comment tools take (P4 review I-5). The stored id is the kind-qualified one.
function output(event) {
  const shown = event.kind === 'comment' || event.kind === 'mention' ? { ...event, targetId: rawIdOf(event) } : event;
  return redact(shown);
}

// The highest seq of each sender's events.
function latestSeqBySender(events) {
  const latest = new Map();
  for (const event of events) latest.set(event.senderId, Math.max(latest.get(event.senderId) ?? 0, event.seq));
  return latest;
}

// The fields that a caller may supply. receivedAt defaults to the clock. A supplied receivedAt must be an ISO time
// with a zone, and it may not be later than the clock plus MAX_FUTURE_MS. A registered secret in the text is masked
// before the text is stored.
function newEventFields(input, clock) {
  if (!isPlainObject(input)) throw invalid('an event must be an object');
  const id = requireText(input.id, 'event id');
  const senderId = requireText(input.senderId, 'sender id');
  if (!KINDS.includes(input.kind)) throw invalid(`kind must be one of ${KINDS.join(', ')}`);
  if (typeof input.text !== 'string') throw invalid('text must be a string');
  let receivedMs = clock;
  if (input.receivedAt !== undefined) {
    receivedMs = parseIsoTime(input.receivedAt);
    if (Number.isNaN(receivedMs)) throw invalid('receivedAt must be an ISO 8601 time with a zone');
    if (receivedMs > clock + MAX_FUTURE_MS) throw invalid('receivedAt is too far in the future');
  }
  return {
    id,
    kind: input.kind,
    senderId,
    text: maskRegistered(input.text),
    receivedAt: new Date(receivedMs).toISOString(),
  };
}

// The dedupe index. Each line is {"key":"<kind>:<id>","at":"<ISO>"}, where at is the time the key was received. Returns the
// keys (with their times in milliseconds), and whether the file is damaged: a line that is not a key line, or a last line
// that is not ended by a newline (a torn write). A damaged index is not trusted: createEventLog quarantines it and rebuilds it
// from the event file, and it writes a notice for the audit log (P4 fix).
function loadIndex(file, fs) {
  const entries = new Map();
  if (!io('dedupe index', 'read', () => fs.existsSync(file))) return { entries, damaged: false, missing: true, empty: false };
  const text = io('dedupe index', 'read', () => fs.readFileSync(file, 'utf8'));
  // A zero-length index is a missing one, so it is rebuilt the same way, with its own reason in the notice (P4 final N-5).
  if (text.trim() === '') return { entries, damaged: false, missing: true, empty: true };
  const parts = text.split('\n');
  const torn = parts[parts.length - 1] !== '';
  let damaged = 0;
  for (const line of parts) {
    if (line.trim() === '') continue;
    const value = parseJson(line);
    const at = isPlainObject(value) && typeof value.key === 'string' ? Date.parse(value.at) : Number.NaN;
    if (!Number.isFinite(at) || value.key.trim() === '') {
      damaged += 1;
      continue;
    }
    entries.set(value.key, at);
  }
  return { entries, damaged: damaged > 0 || torn, missing: false, empty: false };
}

// The name for a quarantined copy of the index: event-ids.jsonl.corrupt, then .corrupt.1 and so on, so that an earlier copy is
// never overwritten (P4 fix).
function quarantineName(file, fs) {
  let name = `${file}.corrupt`;
  for (let n = 1; io('dedupe index', 'read', () => fs.existsSync(name)); n += 1) {
    if (n > 1000) throw storeError('too many quarantined copies of the dedupe index exist; move them aside first');
    name = `${file}.corrupt.${n}`;
  }
  return name;
}

// Writes the whole index again, atomically. The keys are written in the order they were received.
function writeIndex(file, known, fs) {
  const lines = [...known].map(([key, at]) => `${JSON.stringify({ key, at: new Date(at).toISOString() })}\n`);
  io('dedupe index', 'rewritten', () => writeFileAtomic(file, lines.join(''), fs));
}

// Builds the event log over a file and a state. The state holds events.issued, events.acked, events.lastSeq and the
// read markers dm.read.<senderId>. The constructor reads the stored cursors and the event file, so a bad one stops the
// log at startup. dedupeFile is the dedupe index (by default event-ids.jsonl beside the event file). fs supplies the file
// system calls (node:fs by default), so that a test can count reads or record the order of the calls.
export function createEventLog({
  file,
  state,
  retentionDays = DEFAULT_RETENTION_DAYS,
  now = () => Date.now(),
  fs = nodeFs,
  dedupeFile,
  isStopped = () => false,
} = {}) {
  if (typeof isStopped !== 'function') throw new TypeError('createEventLog needs isStopped as a function when it is given');
  if (typeof file !== 'string' || file.trim() === '') throw new TypeError('createEventLog needs a file path');
  if (!isState(state)) throw new TypeError('createEventLog needs a state with get, set and save');
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new TypeError('createEventLog needs retentionDays above 0');
  }
  if (typeof now !== 'function') throw new TypeError('createEventLog needs now as a function');
  if (dedupeFile !== undefined && (typeof dedupeFile !== 'string' || dedupeFile.trim() === '')) {
    throw new TypeError('createEventLog needs the dedupe index path when it is given');
  }
  const indexFile = dedupeFile ?? join(dirname(file), DEFAULT_INDEX_FILE);
  readCursors(state);
  const initial = readStore(file, fs);

  // The notices for the owner's audit log. The event log has no audit writer of its own, so the poller writes them (drainNotices).
  const notices = [];
  // inFile holds the keys of the events in the event file now, which are known for as long as they are stored, whatever their
  // age. known holds every key, with the time it was received, in milliseconds (see the header for how that time is set).
  const inFile = new Set();
  for (const event of initial.events) inFile.add(keyOf(event.kind, rawIdOf(event)));
  const loadedAt = clockMs(now);
  // The marker that the cursors are unknown, as this process holds it (P4 fix round 2, N-11). A save that fails restores the last saved
  // image (state.js), which may not hold a marker that was only set in memory, so the marker is held here as well, and set in the state
  // again after a failed save. A cleared marker is stored as null.
  const storedMarker = state.get(CURSORS_LOST_KEY, undefined);
  let heldMarker = storedMarker === null ? undefined : storedMarker;
  function setMarker(value) {
    heldMarker = value;
    state.set(CURSORS_LOST_KEY, value ?? null);
    try {
      state.save();
    } catch {
      // The state is restored to the last saved image, so the marker is set again in memory, and the next save writes it. The hold
      // is kept in process by heldMarker, so the save failure is not raised here.
      state.set(CURSORS_LOST_KEY, value ?? null);
    }
  }
  // The cursors are lost when the state holds none of them while the event file holds events: the state was unreadable or missing,
  // since a healthy state has events.lastSeq once any event is stored. The loss is marked, and pending and ack are held until the owner
  // clears the stop (P4 review N-1). A marker that is already there is kept.
  if (heldMarker === undefined && initial.events.length > 0 && !anyCursor(state)) {
    setMarker({ reason: 'the state file was unreadable or missing', since: new Date(loadedAt).toISOString() });
  }
  const index = loadIndex(indexFile, fs);
  let known;
  if (index.damaged || (index.missing && initial.events.length > 0)) {
    // A damaged index is not trusted, so no purged id is refused on its word. It is quarantined under a numbered name. It is then
    // rebuilt from its valid lines, which keep their receipt times, and from the event file, whose ids the log has no receipt time for.
    // An id on a damaged line is known only when the event file still holds it. A missing index, with events in the file, is rebuilt
    // the same way, and the notice says which case it was (P4 review M-3, M-8).
    const quarantined = index.missing ? null : quarantineName(indexFile, fs);
    if (quarantined !== null) io('dedupe index', 'quarantined', () => fs.renameSync(indexFile, quarantined));
    known = new Map(index.entries);
    let keysFromFile = 0;
    for (const event of initial.events) {
      const key = keyOf(event.kind, rawIdOf(event));
      if (!known.has(key)) {
        known.set(key, loadedAt);
        keysFromFile += 1;
      }
    }
    notices.push({
      action: 'events.index',
      target: null,
      outcome: 'rebuilt',
      detail: {
        reason: index.missing ? (index.empty ? 'index empty' : 'index missing') : 'index damaged',
        keysFromIndex: index.entries.size,
        keysFromFile,
        quarantined: quarantined === null ? null : basename(quarantined),
        note: 'ids on damaged lines are known only when the event file holds them',
      },
    });
    writeIndex(indexFile, known, fs);
  } else {
    known = index.entries;
    for (const event of initial.events) {
      const key = keyOf(event.kind, rawIdOf(event));
      if (!known.has(key)) known.set(key, loadedAt);
    }
    if (pruneKnown()) writeIndex(indexFile, known, fs);
  }
  // Keys received more than DEDUPE_MS ago, and no longer in the event file, are dropped from memory.
  function pruneKnown() {
    const cutoff = clockMs(now) - DEDUPE_MS;
    let changed = false;
    for (const [key, at] of known) {
      if (at < cutoff && !inFile.has(key)) {
        known.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  // Whether a key is known in memory: it is in the event file, or it was received within the dedupe window.
  function hasKey(key, clock) {
    const at = known.get(key);
    if (at === undefined) return false;
    return inFile.has(key) || at >= clock - DEDUPE_MS;
  }

  // Stores a new event with status new and the next seq, and returns the stored copy. A repeated kind and id is refused, so
  // callers check hasId first. Each call runs without yielding, so two calls in this process cannot store one event twice.
  function append(input) {
    const clock = clockMs(now);
    const fields = newEventFields(input, clock);
    const store = readStore(file, fs);
    const key = keyOf(fields.kind, fields.id);
    if (store.events.some((event) => event.kind === fields.kind && rawIdOf(event) === fields.id) || hasKey(key, clock)) {
      throw invalid('an event with this kind and id is already stored or was received within the dedupe window');
    }
    const { issued, acked, lastSeq } = readCursors(state);
    // The next seq is above every seq that the state, the file or the header records, so no seq is ever reused.
    const seq = Math.max(lastSeq, issued, acked, fileHighWater(store)) + 1;
    // The stored id is kind-qualified for a comment or a mention (comment:<id>), so the id names one event (P4 fix).
    const event = { seq, ...fields, id: storedIdOf(fields.kind, fields.id), status: 'new', decision: null, untrusted: true };
    // The seq is saved before the event is written, so a failed save leaves no event behind.
    state.set(LAST_SEQ_KEY, seq);
    state.save();
    io('event file', 'created', () => fs.mkdirSync(dirname(file), { recursive: true }));
    if (store.tornAt !== null) io('event file', 'rewritten', () => fs.truncateSync(file, store.tornAt));
    appendText('event file', file, `${store.unterminated ? '\n' : ''}${JSON.stringify(event)}\n`, fs);
    // The key is known from here on. It is recorded in the index after the event itself is on disk.
    known.set(key, clock);
    inFile.add(key);
    appendText('dedupe index', indexFile, `${JSON.stringify({ key, at: new Date(clock).toISOString() })}\n`, fs);
    return output(event);
  }

  // The marker that the cursors are unknown, or undefined. It is the marker this process holds (heldMarker), so a save that failed and
  // restored the state cannot drop it.
  function unknownMarker() {
    return heldMarker ?? undefined;
  }

  // The refusal while the cursors are unknown and the stop holds. Its reason names the state loss or the damaged cursor.
  function holdError(marker) {
    return new IgError(
      'STOPPED',
      `the event cursors are unknown (${marker.reason}), so events are held until the owner clears the stop with ig_stop_clear`,
    );
  }

  // Starts the cursors again after a confirmed clear (P4 review N-1). The acked position goes to zero, so every event in the file is
  // delivered again, each with the id it had. issued and lastSeq keep the highest value known or in the file, so no seq is reused and
  // an ack of an old cursor is still accepted. The reset is saved before anything is delivered. A save that fails restores the last
  // saved image (state.js), which holds the marker and the cursors as they were: the reset is then undone, this call throws CONFIG,
  // and nothing is delivered. The next pending repeats the reset and carries the notice (P4 fix round 2, N-11).
  function resetCursors(marker) {
    const high = fileHighWater(readStore(file, fs));
    const issued = Math.max(wholeOrZero(state.get(ISSUED_KEY, undefined)), high);
    const lastSeq = Math.max(wholeOrZero(state.get(LAST_SEQ_KEY, undefined)), high);
    state.set(ISSUED_KEY, issued);
    state.set(ACKED_KEY, 0);
    state.set(LAST_SEQ_KEY, lastSeq);
    state.set(CURSORS_LOST_KEY, null);
    try {
      state.save();
    } catch {
      setMarker(marker);
      throw new IgError(
        'CONFIG',
        'the event cursors could not be started again, because the state file could not be written; events stay held and the next pending tries again',
      );
    }
    heldMarker = null;
    notices.push({ action: 'events.cursors', target: null, outcome: 'reset', detail: { reason: marker.reason, acked: 0, issued } });
    return { kind: 'cursors_reset', reason: marker.reason, note: CURSOR_RESET_NOTE };
  }

  // The notice that the next successful pending carries after a reset. Null when there is none.
  let resetNotice = null;

  // Returns the next events after the acked position, at most limit of them, and a cursor for the last one. The
  // highest seq handed out is kept in events.issued, so that ack can refuse a cursor that was never issued.
  function pending({ limit = DEFAULT_LIMIT } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw invalid('limit must be a whole number of 1 or more');
    // While the cursors are unknown, nothing is delivered (P4 review N-1). After a confirmed clear, the cursors are started again
    // here, and this call carries the notice.
    const marker = unknownMarker();
    if (marker !== undefined) {
      if (isStopped()) throw holdError(marker);
      resetNotice = resetCursors(marker);
    }
    const { issued, acked } = readCursors(state);
    const batch = readStore(file, fs).events.filter((event) => event.seq > acked).slice(0, limit);
    const page = { events: [], nextCursor: null };
    if (batch.length > 0) {
      const last = batch[batch.length - 1].seq;
      if (last > issued) {
        state.set(ISSUED_KEY, last);
        state.save();
      }
      page.events = batch.map((event) => output(event));
      page.nextCursor = encodeCursor(last);
    }
    const notice = resetNotice;
    resetNotice = null;
    return notice === null ? page : { ...page, notice };
  }

  // Acknowledges every event up to the cursor. A cursor above events.issued is refused. events.acked never moves back. While the
  // cursors are unknown, the ack is refused: with the stop held, with the state loss as the reason; after a clear, until pending has
  // started the cursors again (P4 review N-1).
  function ack(cursor) {
    const marker = unknownMarker();
    if (marker !== undefined) {
      if (isStopped()) throw holdError(marker);
      throw invalid('the event cursors were started again after a state loss; read the pending events first, which carries the notice');
    }
    const seq = decodeCursor(cursor);
    const { issued, acked } = readCursors(state);
    if (seq > issued) throw invalid('the cursor has not been issued');
    if (seq > acked) {
      state.set(ACKED_KEY, seq);
      state.save();
    }
  }

  // Records a decision and an optional draft, and marks the event handled. Nothing is sent, and the cursor does not
  // move. A later decision replaces an earlier one. The id is the stored id: a comment or a mention is kind-qualified
  // (comment:<id>), so it names one event. An event stored before the prefix existed is matched by its id as it is. An id that
  // more than one stored event has is still refused, which can only be an old pair of events that shared a raw id.
  function decide(id, decision) {
    requireText(id, 'event id');
    if (!isPlainObject(decision) || !ACTIONS.includes(decision.action)) {
      throw invalid(`action must be one of ${ACTIONS.join(', ')}`);
    }
    const draft = decision.draft ?? null;
    if (draft !== null && typeof draft !== 'string') throw invalid('draft must be a string');
    // A registered secret in the draft is masked before the draft is stored, as it is in inbound text.
    const storedDraft = draft === null ? null : maskRegistered(draft);
    const store = readStore(file, fs);
    const matches = store.events.flatMap((event, index) => (event.id === id ? [index] : []));
    if (matches.length === 0) throw invalid('no stored event has that id');
    if (matches.length > 1) throw invalid('more than one stored event has that id, so the decision cannot choose one');
    const index = matches[0];
    const event = {
      ...store.events[index],
      status: 'handled',
      decision: { action: decision.action, draft: storedDraft, at: new Date(clockMs(now)).toISOString() },
    };
    store.events[index] = event;
    writeEvents(file, store.events, fileHighWater(store), fs);
    return output(event);
  }

  // Whether an event of this kind and id is known: it is stored, or it was received within the dedupe window. Reads memory
  // only, so it does not read the event file (A-9).
  function hasId(id, kind) {
    requireText(id, 'event id');
    checkKind(kind);
    return hasKey(keyOf(kind, id), clockMs(now));
  }

  // The newest receivedAt of a sender's events, or null when there are none. With a kind, only events of that kind count:
  // the 24-hour DM window uses 'message', so a comment or mention from the same user does not open it.
  function lastInboundAt(senderId, { kind } = {}) {
    requireText(senderId, 'sender id');
    if (kind !== undefined) checkKind(kind);
    let newest = null;
    for (const event of readStore(file, fs).events) {
      if (event.senderId !== senderId) continue;
      if (kind !== undefined && event.kind !== kind) continue;
      if (newest === null || Date.parse(event.receivedAt) > Date.parse(newest)) newest = event.receivedAt;
    }
    return newest;
  }

  // Marks every event of a sender as read, by storing the sender's latest seq.
  function markRead(senderId) {
    requireText(senderId, 'sender id');
    const latest = latestSeqBySender(readStore(file, fs).events).get(senderId) ?? 0;
    state.set(readKey(senderId), latest);
    state.save();
  }

  // The senders with an event above their read marker, ordered by each sender's newest event, oldest first.
  function unreadSenders() {
    const unread = [];
    for (const [senderId, seq] of latestSeqBySender(readStore(file, fs).events)) {
      if (seq > storedWhole(state, readKey(senderId))) unread.push({ senderId, seq });
    }
    return unread.sort((a, b) => a.seq - b.seq).map((entry) => entry.senderId);
  }

  // Removes events that are handled, acknowledged and older than retentionDays. Events that are still pending, or
  // that are not yet acknowledged, are kept. Returns how many were removed. The header keeps the highest seq. A removed
  // event's key stays in the dedupe index for DEDUPE_DAYS after it was received, and then it is pruned.
  function purge() {
    const { acked } = readCursors(state);
    const cutoff = clockMs(now) - retentionDays * DAY_MS;
    const store = readStore(file, fs);
    const removedEvents = store.events.filter(
      (event) => event.status === 'handled' && event.seq <= acked && Date.parse(event.receivedAt) < cutoff,
    );
    const gone = new Set(removedEvents);
    const kept = store.events.filter((event) => !gone.has(event));
    if (removedEvents.length > 0) writeEvents(file, kept, fileHighWater(store), fs);
    for (const event of removedEvents) inFile.delete(keyOf(event.kind, rawIdOf(event)));
    if (pruneKnown()) writeIndex(indexFile, known, fs);
    return { removed: removedEvents.length };
  }

  // Writes each queued notice with write(notice), such as an index rebuild for the audit log. A notice is dropped only after write
  // returns. A write that throws stops the drain, and the notices not yet written stay queued (P4 review M-2).
  function drainNotices(write) {
    while (notices.length > 0) {
      write(notices[0]);
      notices.shift();
    }
  }

  // The receipt time of the stored comment or mention with this raw id, or null when none is stored. It is the comment's own time,
  // which the private-reply rebuild uses for the 7-day window (P4 review N-2).
  function receivedAtOf(rawId) {
    const match = readStore(file, fs).events.find(
      (event) => (event.kind === 'comment' || event.kind === 'mention') && rawIdOf(event) === rawId,
    );
    return match === undefined ? null : match.receivedAt;
  }

  return {
    append,
    pending,
    ack,
    lastInboundAt,
    hasId,
    decide,
    markRead,
    unreadSenders,
    purge,
    drainNotices,
    receivedAtOf,
    // True while the event cursors are unknown (a state loss, or a damaged cursor), until a confirmed clear and the next pending.
    cursorsUnknown: () => unknownMarker() !== undefined,
  };
}
