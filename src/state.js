// The service state: a JSON object of keys and values, kept in one file. save() replaces that file atomically.

import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { IgError } from './errors.js';
import { activeOf, entryOf, readStops, recordOf, withStop } from './stops.js';
import { ACKED_KEY, ISSUED_KEY, LAST_SEQ_KEY, STOP_KEY } from './util/state-keys.js';
import { isPlainObject } from './util/object.js';

// The keys STOP_KEY, ISSUED_KEY, ACKED_KEY and LAST_SEQ_KEY are defined once in src/util/state-keys.js.
// Set when the event cursors are unknown: a cursor was damaged here, or the event log found the cursors lost (P4 review N-1). The
// event log holds pending and ack while it is set, and starts the cursors again after a confirmed clear. The value is { reason, since }.
export const CURSORS_LOST_KEY = 'events.cursorsLost';
// The file system calls that the atomic write and the copy use. A test may pass its own, to record or fail a call.
const NODE_FS = { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync };

// Refuses any value that JSON would change: NaN and Infinity become null, undefined is dropped, holes become null,
// and a cycle or a non-plain object does not round trip.
function assertJsonValue(value, key, path = new Set()) {
  const refuse = () =>
    new TypeError(`the value for ${key} must be JSON: no undefined, NaN, Infinity, cycles or class instances`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw refuse();
    return;
  }
  if (typeof value !== 'object' || path.has(value)) throw refuse();
  const isArray = Array.isArray(value);
  if (!isArray && Object.getPrototypeOf(value) !== Object.prototype) throw refuse();
  path.add(value);
  // Index by index, so that a hole in an array is read as undefined and refused.
  const items = isArray ? Array.from({ length: value.length }, (_, index) => value[index]) : Object.values(value);
  for (const item of items) assertJsonValue(item, key, path);
  path.delete(value);
}

function assertKey(key) {
  if (typeof key !== 'string' || key === '') throw new TypeError('a state key must be a non-empty string');
}

// A copy made through JSON, so that a caller cannot change a stored value without calling set().
function copyJson(value) {
  return JSON.parse(JSON.stringify(value));
}

// Returns the object, or null when the text is not a JSON object.
function parseState(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isPlainObject(parsed) ? parsed : null;
}

// Writes text to file through file.tmp, flushed to disk, then renamed over file. A reader sees the old file or the
// new one, never a part of the new one. fsImpl supplies the file system calls (NODE_FS by default).
export function writeFileAtomic(file, text, fsImpl = NODE_FS) {
  fsImpl.mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    const fd = fsImpl.openSync(tmp, 'w');
    try {
      fsImpl.writeFileSync(fd, text, 'utf8');
      fsImpl.fsyncSync(fd);
    } finally {
      fsImpl.closeSync(fd);
    }
    fsImpl.renameSync(tmp, file);
  } catch (err) {
    // The error that matters is the one from the write, so a failed cleanup is ignored.
    try {
      fsImpl.rmSync(tmp, { force: true });
    } catch {
      // Left in place. The next save overwrites it.
    }
    throw err;
  }
}

// Puts memory back to a saved image: the JSON text of the state as it was last written to the file.
function restoreImage(data, image) {
  data.clear();
  for (const [key, value] of Object.entries(JSON.parse(image))) data.set(key, value);
}

// The name for a corrupt copy: file.corrupt, then file.corrupt.1, file.corrupt.2 and so on, so that an earlier copy is never
// overwritten. A name that is still taken after many tries is refused.
function corruptCopyName(file) {
  let name = `${file}.corrupt`;
  for (let n = 1; existsSync(name); n += 1) {
    if (n > 1000) throw new IgError('CONFIG', 'too many corrupt copies of the state file exist; move them aside first');
    name = `${file}.corrupt.${n}`;
  }
  return name;
}

// A whole number of 0 or more, or null when the value is not one.
const wholeOrNull = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

// Repairs the event cursors (P4 review I-3 residual, N-1). A cursor is damaged when it is not a whole number. A damaged events.acked
// or events.issued is removed, not reset: its value is unknown, so no reset to zero is made (a reset would move the acked position
// back and redeliver acked events). The event cursors are then marked unknown (CURSORS_LOST_KEY), and the event log holds pending and
// ack until the owner clears the stop. events.issued is raised to events.acked when it is below it: that moves no cursor backwards.
// A damaged events.lastSeq is removed: the next seq is taken from the highest of the cursors and the event file, so no seq is
// reused. Returns the names of the cursors that changed, or an empty list when no cursor is damaged.
function repairCursors(data) {
  const changed = [];
  for (const key of [ACKED_KEY, ISSUED_KEY]) {
    if (data.has(key) && wholeOrNull(data.get(key)) === null) {
      data.delete(key);
      changed.push(key);
    }
  }
  if (changed.length > 0) data.set(CURSORS_LOST_KEY, { reason: 'damaged event cursor', since: new Date().toISOString() });
  const ackedValue = wholeOrNull(data.get(ACKED_KEY)) ?? 0;
  const issuedValue = wholeOrNull(data.get(ISSUED_KEY)) ?? 0;
  if (ackedValue > issuedValue) {
    data.set(ISSUED_KEY, ackedValue);
    if (!changed.includes(ISSUED_KEY)) changed.push(ISSUED_KEY);
  }
  if (data.has(LAST_SEQ_KEY) && wholeOrNull(data.get(LAST_SEQ_KEY)) === null) {
    data.delete(LAST_SEQ_KEY);
    changed.push(LAST_SEQ_KEY);
  }
  return changed;
}

// The stop that a damaged state starts with. It is a stop, so the service starts stopped (O-3): outbound is refused, and only
// ig_stop_clear with confirm true clears it.
function corruptStop(detail) {
  return recordOf([entryOf('STATE_CORRUPT', detail, new Date().toISOString())]);
}

// The stops that a stored stop record holds. A record that cannot be read holds none here: the guard then reads it as damage (O-3).
function storedStopsOf(value) {
  if (value === undefined) return [];
  try {
    return readStops(value);
  } catch {
    return [];
  }
}

// Copies the damaged file aside. Returns true when the copy exists. A copy that cannot be made is not an error here: the
// repaired state is then held in memory, and no save replaces the damaged file until the copy has been made (P4 review M-5).
function copyAside(fsImpl, file, name) {
  try {
    fsImpl.copyFileSync(file, name);
    return true;
  } catch {
    return false;
  }
}

// Loads the state from file. A missing file gives an empty state. A file that does not hold a JSON object is copied to
// file.corrupt (or the next free numbered name), and the state starts empty with a stop under the key stop. A file whose event
// cursors are damaged is copied aside the same way, and its cursors are repaired (see repairCursors). A stop is set under the key
// stop when none is stored, or when a stored rate limit would let a repair be undone (P4 review I-1). Each stop is written to the
// file at once, so that a restart does not forget it. movedAside holds the copy's path, or null. The repairs are recorded as
// notices (see drainNotices).
export async function createState({ file, fs: fsImpl = NODE_FS } = {}) {
  if (typeof file !== 'string' || file.trim() === '') throw new TypeError('createState needs a file path');
  let text = null;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw new IgError('CONFIG', `state file could not be read (${err.code ?? 'error'})`);
  }
  // True when there is no state file at all (P4 review, lost-state rebuild).
  const missing = text === null;
  const data = new Map();
  const notices = [];
  let movedAside = null;
  // True when the file was read but could not be parsed. Its counters and token record are lost (P4 review M-11), so the
  // service rebuilds the counters from the audit file.
  let unreadable = false;
  // The copy that still has to be made before the damaged file is replaced. Set only when the copy failed at load.
  let pendingCopy = null;
  // Writes the repaired state, unless the damaged file has no copy yet. A write that fails is kept in memory, and the next save
  // writes it.
  const writeRepaired = () => {
    if (pendingCopy !== null) return;
    try {
      writeFileAtomic(file, `${JSON.stringify(Object.fromEntries(data), null, 2)}\n`, fsImpl);
    } catch {
      // Kept in memory. The next save writes it.
    }
  };
  if (text !== null) {
    const parsed = parseState(text);
    if (parsed === null) {
      unreadable = true;
      const name = corruptCopyName(file);
      data.set(STOP_KEY, corruptStop(`state file unreadable; moved aside to ${basename(name)}`));
      if (copyAside(fsImpl, file, name)) movedAside = name;
      else pendingCopy = name;
      writeRepaired();
    } else {
      for (const [key, value] of Object.entries(parsed)) data.set(key, value);
      const changed = repairCursors(data);
      if (changed.length > 0) {
        const name = corruptCopyName(file);
        // The STATE_CORRUPT stop is added to the stops already held, so none is lost (P4 fix round 2, N-13). The active stop is the highest
        // rank, and of equal rank the stored one stays active, so a stored halting stop is kept, and a stored rate limit is replaced (I-1).
        const previousStops = storedStopsOf(data.get(STOP_KEY));
        const previous = activeOf(previousStops)?.kind ?? null;
        const nextStops = withStop(
          previousStops,
          entryOf('STATE_CORRUPT', `event cursors damaged; state copied aside to ${basename(name)}`, new Date().toISOString()),
        );
        data.set(STOP_KEY, recordOf(nextStops));
        const active = activeOf(nextStops).kind;
        if (copyAside(fsImpl, file, name)) movedAside = name;
        else pendingCopy = name;
        notices.push({
          action: 'state.repair',
          target: null,
          outcome: 'repaired',
          detail: {
            cursors: changed,
            stopReplaced: previous !== null && previous !== active ? previous : null,
            note: changed.some((key) => key === ACKED_KEY || key === ISSUED_KEY)
              ? 'damaged event cursors were removed and the event cursors are unknown; pending and ack are held until the owner clears the stop'
              : 'a damaged event counter was removed; the acked and issued cursors are intact',
          },
        });
        writeRepaired();
      }
    }
  }
  // The last saved image: the content of the file as it was loaded, or the state that was just written.
  let saved = JSON.stringify(Object.fromEntries(data));
  return {
    // The path that a damaged file was copied to, or null when no copy exists yet. It is for logging in this process. The stop
    // under the key stop is what survives a restart.
    get movedAside() {
      return movedAside;
    },
    // True when the state file could not be parsed at load. The data held in it is then lost, except for the stop.
    get unreadable() {
      return unreadable;
    },
    // True when there was no state file at load. Its counters and token record are then gone too.
    get missing() {
      return missing;
    },
    get(key, fallback) {
      assertKey(key);
      return data.has(key) ? copyJson(data.get(key)) : fallback;
    },
    set(key, value) {
      assertKey(key);
      assertJsonValue(value, key);
      data.set(key, copyJson(value));
    },
    // The keys that start with prefix, in order. Used to prune state that has gone stale.
    keys(prefix = '') {
      if (typeof prefix !== 'string') throw new TypeError('a key prefix must be a string');
      return [...data.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    // Removes a key. The removal is kept when save() writes the file; a failed save restores the key.
    delete(key) {
      assertKey(key);
      data.delete(key);
    },
    // Writes each queued notice with write(notice), and drops a notice only after write returns. A write that throws stops the drain,
    // and the notices not yet written stay queued for the next drain (P4 review M-2).
    drainNotices(write) {
      while (notices.length > 0) {
        write(notices[0]);
        notices.shift();
      }
    },
    // Synchronous, so that the event log, which is synchronous too, can save right after a change. If the write fails,
    // memory goes back to the last saved image before the error is rethrown. A change that is not on disk is not used. A damaged
    // file is never replaced before its copy exists: a save first makes the copy, and throws when it cannot (P4 review M-5).
    save() {
      const object = Object.fromEntries(data);
      if (pendingCopy !== null) {
        try {
          fsImpl.copyFileSync(file, pendingCopy);
        } catch (err) {
          throw new IgError('CONFIG', `the damaged state file could not be copied aside (${err.code ?? 'error'})`);
        }
        movedAside = pendingCopy;
        pendingCopy = null;
      }
      try {
        writeFileAtomic(file, `${JSON.stringify(object, null, 2)}\n`, fsImpl);
      } catch (err) {
        restoreImage(data, saved);
        throw err;
      }
      saved = JSON.stringify(object);
    },
  };
}
