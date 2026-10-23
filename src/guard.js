// The owner guard and the stop state. The stop record is kept in the state under the key stop: the active stop in the top-level
// fields { stopped, kind, detail, since }, and every observed stop that is not yet cleared in the list stops (see stops.js, P4 fix
// round 2 N-13). It survives a restart. Only clearStop(true) clears it. Every change to the stop is saved at once. The in-process copy
// changes before the save, so a failed save still stops this process, and the error is raised so that the caller knows the stop was
// not written.

import { existsSync, readFileSync } from 'node:fs';
import { ACCOUNT_STOP_KINDS, IgError } from './errors.js';
import { redact } from './redact.js';
import { MAX_DETAIL, STOP_KINDS, activeOf, entryOf, readStops, recordOf, withStop } from './stops.js';
import { LAST_SEQ_KEY, STOP_KEY } from './util/state-keys.js';
import { isPlainObject, isState } from './util/object.js';

export { STOP_KINDS };

// The stop key and the last event seq key are defined in src/util/state-keys.js. The seq is written by the event log
// (src/events.js); it is read here, and never written.
const CLEAR = Object.freeze({ stopped: false, kind: null, detail: null, since: null });

// The time of a stop, as ISO text. A clock that throws, or a value that is not a valid Date, falls back to the process
// clock, so that the stop is still recorded with a valid time.
function stopTime(now) {
  let date = new Date(Number.NaN);
  try {
    const ms = now();
    if (typeof ms === 'number') date = new Date(ms);
  } catch {
    // The fallback below is used.
  }
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString();
}

function isWholeNumber(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// A confirm must be true, false or absent. Any other value is refused, not read as true or as false.
function confirmed(value) {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  throw new IgError('VALIDATION', 'confirm must be true or false');
}

// The detail is free text, so it is redacted and kept to MAX_DETAIL characters. A missing detail (undefined) is ''. A null
// detail is 'null'. A detail that is not a string is converted with String(), and one that cannot be converted becomes ''.
// The stop is never refused for its detail: a refused stop would not be recorded. Callers pass codes, not response text.
function detailText(detail) {
  if (detail === undefined) return '';
  if (detail === null) return 'null';
  let text;
  try {
    text = typeof detail === 'string' ? detail : String(detail);
  } catch {
    text = '';
  }
  return redact(text).slice(0, MAX_DETAIL);
}

// The active stop, as the view that the guard reads: { stopped, kind, detail, since }, or clear when no stop is held.
function viewOf(stops) {
  const active = activeOf(stops);
  if (active === null) return { ...CLEAR };
  return { stopped: true, kind: active.kind, detail: active.detail, since: active.since };
}

// Whether a file holds any data: at least one character that is not white space. A file that cannot be read stops the
// guard. The label names the file in the error.
function fileHoldsData(file, label) {
  let text;
  try {
    if (!existsSync(file)) return false;
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new IgError('CONFIG', `the ${label} file could not be read (${err.code ?? 'error'})`);
  }
  return text.trim() !== '';
}

// The events file holds a header, or at least one event line. A header is written only by a purge or a decision, so an
// events file with events alone must count too.
const eventsHoldData = (file) => fileHoldsData(file, 'events');

// The audit file is evidence too: a state file that is deleted while an events file is absent still leaves audit lines.
// Without an audit file path, the audit is not read.
const auditHoldsData = (file) => file !== undefined && fileHoldsData(file, 'audit');

// Builds the guard over a state that is already loaded. owner is the owner section of the config. eventsFile is the
// events file path, and auditFile, when given, is the audit file path. At startup the guard reads the stop from the state.
// If there is no stop at all, and the events or the audit file holds data, but the state has no events.lastSeq, the state
// was lost, so the guard starts stopped with STATE_LOST. Returns { assertOwner, assertNotStopped, stop, clearStop,
// stopStatus, gate, shouldStop }; each is documented below.
export function createGuard({ owner, state, now = () => Date.now(), eventsFile, auditFile } = {}) {
  if (!isPlainObject(owner) || typeof owner.igUserId !== 'string' || owner.igUserId.trim() === '') {
    throw new TypeError('createGuard needs an owner with an igUserId string');
  }
  if (!isState(state)) throw new TypeError('createGuard needs a state with get, set and save');
  if (typeof now !== 'function') throw new TypeError('createGuard needs now as a function');
  if (typeof eventsFile !== 'string' || eventsFile.trim() === '') {
    throw new TypeError('createGuard needs the events file path');
  }
  if (auditFile !== undefined && (typeof auditFile !== 'string' || auditFile.trim() === '')) {
    throw new TypeError('createGuard needs the audit file path when it is given');
  }
  const ownerId = owner.igUserId;

  // The stops held in this process, in the order observed (N-13). The active stop is the view the guard reads. unsaved is true while
  // a stop set in this process has not reached the state file, because its save failed.
  const stored = state.get(STOP_KEY, undefined);
  let stops = [];
  let unsaved = false;
  if (stored !== undefined) {
    try {
      stops = readStops(stored);
    } catch {
      // A stored stop that cannot be read back is damage. The service starts stopped with STATE_CORRUPT (O-3): outbound is
      // refused and the poller is halted, and only ig_stop_clear with confirm true clears it. The record is saved below.
      stops = [entryOf('STATE_CORRUPT', detailText('the stored stop cannot be read back'), stopTime(now))];
      unsaved = true;
    }
  }
  let current = viewOf(stops);

  // Saves the stop record to the state. A failed save leaves the state as it was before, and raises an error.
  function persist(record) {
    try {
      state.set(STOP_KEY, record);
      state.save();
    } catch (err) {
      throw new IgError('CONFIG', `the stop state could not be saved (${err.code ?? 'error'})`);
    }
  }

  // Saves a stop whose earlier save failed. A failure is not raised here: the stop still holds in this process, and the
  // save is tried again on the next call.
  function retrySave() {
    try {
      persist(recordOf(stops));
      unsaved = false;
    } catch {
      // Still unsaved.
    }
  }

  // A STATE_CORRUPT stop from an unreadable stored stop is saved at once. A failed save keeps it in process.
  if (unsaved) retrySave();

  if (
    stored === undefined &&
    !isWholeNumber(state.get(LAST_SEQ_KEY, undefined)) &&
    (eventsHoldData(eventsFile) || auditHoldsData(auditFile))
  ) {
    const detail = detailText('the events file holds data, but the state has no events.lastSeq');
    stops = withStop(stops, entryOf('STATE_LOST', detail, stopTime(now)));
    current = viewOf(stops);
    persist(recordOf(stops));
  }

  // The active stop, and every stop held, with its kind, its time and its rank. The list is what ig_status shows (N-13).
  function stopStatus() {
    return redact({
      ...current,
      stops: stops.map((entry) => ({ kind: entry.kind, detail: entry.detail, since: entry.since, rank: entry.rank })),
    });
  }

  return {
    // Refuses an action for any account but the owner. A non-string id is not the owner's id, so it is refused too.
    assertOwner(igUserId) {
      if (typeof igUserId !== 'string' || igUserId !== ownerId) {
        throw new IgError('OWNER_MISMATCH', 'the account is not the owner account');
      }
    },

    // Throws STOPPED while a stop is in place. A stop whose save failed is saved again first. The details carry the kind,
    // the time and whether the stop is saved, not the detail text.
    assertNotStopped() {
      if (unsaved) retrySave();
      if (current.stopped) {
        throw new IgError('STOPPED', `outbound actions are stopped (${current.kind})`, {
          kind: current.kind,
          since: current.since,
          saved: !unsaved,
        });
      }
    },

    // Records a stop and saves it. Every observed stop is kept in the list, whatever its rank, so none is lost (N-13). A kind that is
    // already held keeps its first time and detail. The active stop is the highest rank, and of equal rank the first observed stays
    // active (see STOP_RANK). A stop whose earlier save failed is saved again here. An unknown kind is recorded as ACTION_BLOCKED when
    // no stop is held, never adds to a held list, and is then refused with VALIDATION. A detail that is not a string is recorded as
    // its String() value.
    stop(kind, detail) {
      const known = STOP_KINDS.includes(kind);
      const text = detailText(detail);
      if (known) {
        const next = withStop(stops, entryOf(kind, text, stopTime(now)));
        if (next !== stops) {
          stops = next;
          unsaved = true;
        }
      } else if (!current.stopped) {
        const label = 'stop kind not recognised';
        stops = withStop(stops, entryOf('ACTION_BLOCKED', detailText(text === '' ? label : `${label}; ${text}`), stopTime(now)));
        unsaved = true;
      }
      current = viewOf(stops);
      if (unsaved) {
        persist(recordOf(stops));
        unsaved = false;
      }
      if (!known) {
        throw new IgError('VALIDATION', 'the stop kind is not a known stop kind; it was recorded as ACTION_BLOCKED');
      }
      return stopStatus();
    },

    // Clears every stop held. Without confirm true the result is 'preview' and nothing changes. The result is 'cleared' when a
    // stop was in place, and 'not_stopped' when there was none. A failed save keeps the stops.
    clearStop(confirm) {
      if (!confirmed(confirm)) return 'preview';
      if (!current.stopped) return 'not_stopped';
      persist(recordOf([]));
      stops = [];
      current = { ...CLEAR };
      unsaved = false;
      return 'cleared';
    },

    stopStatus,

    // 'execute' only when confirm is true. Anything else gets a preview, and no request is made.
    gate(confirm) {
      return confirmed(confirm) ? 'execute' : 'preview';
    },

    // True for an error that must stop outbound actions until the owner clears the stop.
    shouldStop(error) {
      return error instanceof IgError && ACCOUNT_STOP_KINDS.has(error.kind);
    },
  };
}
