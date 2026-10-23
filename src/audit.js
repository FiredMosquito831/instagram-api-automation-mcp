// The audit log: one redacted JSON line per action, appended to a file. When the file reaches rotateBytes (50 MB), it is
// rotated to file.1, and the older rotations move up. Only the last keepRotations rotations are kept (file.1 to
// file.10 by default). read() streams the files in chunks, so a large file is never read whole, and it counts the lines
// that are not JSON objects, which it skips. scanSince streams the lines from a given time on, for the caps rebuild
// (P4 review M-11). It reads every retained file and tests each line by its own time, so the order of the lines does not matter
// (P4 final N-3).

import * as nodeFs from 'node:fs';
import { dirname } from 'node:path';
import { redact } from './redact.js';
import { isPlainObject } from './util/object.js';

const DEFAULT_LIMIT = 100;
const DEFAULT_ROTATE_BYTES = 50 * 1024 * 1024;
const DEFAULT_KEEP_ROTATIONS = 10;
const DEFAULT_CHUNK_BYTES = 64 * 1024;

// A positive whole number, or a TypeError that names the argument.
function wholeAtLeast(value, min, name) {
  if (!Number.isSafeInteger(value) || value < min) throw new TypeError(`${name} must be a whole number of ${min} or more`);
  return value;
}

export function createAudit({
  file,
  now = () => Date.now(),
  fs = nodeFs,
  rotateBytes = DEFAULT_ROTATE_BYTES,
  keepRotations = DEFAULT_KEEP_ROTATIONS,
  chunkBytes = DEFAULT_CHUNK_BYTES,
} = {}) {
  if (typeof file !== 'string' || file.trim() === '') throw new TypeError('createAudit needs a file path');
  if (typeof now !== 'function') throw new TypeError('createAudit needs now as a function');
  wholeAtLeast(rotateBytes, 1, 'createAudit rotateBytes');
  wholeAtLeast(keepRotations, 1, 'createAudit keepRotations');
  wholeAtLeast(chunkBytes, 1, 'createAudit chunkBytes');

  const rotated = (n) => `${file}.${n}`;

  // Moves the file to file.1 when it has reached rotateBytes. The oldest rotation, file.<keepRotations>, is dropped first.
  function rotateIfFull() {
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).size < rotateBytes) return;
    if (fs.existsSync(rotated(keepRotations))) fs.rmSync(rotated(keepRotations), { force: true });
    for (let n = keepRotations - 1; n >= 1; n -= 1) {
      if (fs.existsSync(rotated(n))) fs.renameSync(rotated(n), rotated(n + 1));
    }
    fs.renameSync(file, rotated(1));
  }

  // Calls take with the bytes of each line of one file. The file is streamed in chunks of chunkBytes, so it is never read whole.
  function forEachLine(path, take) {
    const fd = fs.openSync(path, 'r');
    try {
      const chunk = Buffer.alloc(chunkBytes);
      let carry = Buffer.alloc(0);
      for (;;) {
        const got = fs.readSync(fd, chunk, 0, chunkBytes, null);
        if (got === 0) break;
        carry = Buffer.concat([carry, chunk.subarray(0, got)]);
        let start = 0;
        for (let nl = carry.indexOf(0x0a, start); nl !== -1; nl = carry.indexOf(0x0a, start)) {
          take(carry.subarray(start, nl));
          start = nl + 1;
        }
        carry = carry.subarray(start);
      }
      take(carry);
    } finally {
      fs.closeSync(fd);
    }
  }

  // Streams one file in chunks of chunkBytes. It keeps the last n entries that are JSON objects. A line that is not a JSON
  // object, including one cut short by a crash, is skipped and counted.
  function readTail(path, n) {
    const entries = [];
    let skipped = 0;
    forEachLine(path, (bytes) => {
      const text = bytes.toString('utf8').trim();
      if (text === '') return;
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        skipped += 1;
        return;
      }
      if (!isPlainObject(value)) {
        skipped += 1;
        return;
      }
      entries.push(value);
      if (entries.length > n) entries.shift();
    });
    return { entries, skipped };
  }

  // Calls visit with each entry whose at time is at or after since (epoch milliseconds). Every retained file is read, newest first,
  // and each line is tested by its own at time, so the lines need no order: a clock step back, or a rotation whose lines are newer
  // than the newest file's first line, is counted in full (P4 final N-3). The cost is a read of every retained file, which happens
  // once at a recovery start. A line that is not a JSON object, or whose at is not a time, is counted as damaged and skipped. Returns
  // the number of damaged lines and the number of entries visited. The caller gets the entries as they are stored, so it must not
  // print them.
  function scanSince(since, visit) {
    if (!Number.isFinite(since)) throw new TypeError('an audit scan needs since as a time in milliseconds');
    let damaged = 0;
    let visited = 0;
    const paths = [file];
    for (let n = 1; n <= keepRotations; n += 1) paths.push(rotated(n));
    for (const path of paths) {
      if (!fs.existsSync(path)) continue;
      forEachLine(path, (bytes) => {
        const text = bytes.toString('utf8').trim();
        if (text === '') return;
        let value;
        try {
          value = JSON.parse(text);
        } catch {
          damaged += 1;
          return;
        }
        const at = isPlainObject(value) && typeof value.at === 'string' ? Date.parse(value.at) : Number.NaN;
        if (!Number.isFinite(at)) {
          damaged += 1;
          return;
        }
        if (at >= since) {
          visited += 1;
          visit(value);
        }
      });
    }
    return { damaged, visited };
  }

  // Returns the last `limit` entries, oldest first, with secrets masked, and the number of lines that were skipped. The
  // newest file is read first, then the rotations, only as far as the limit needs. A line that does not parse, or that is
  // not a JSON object, is skipped and counted, and the rest are kept.
  function readCounted({ limit = DEFAULT_LIMIT } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new TypeError('audit read needs a limit of 0 or more');
    }
    const out = [];
    let skipped = 0;
    const paths = [file];
    for (let n = 1; n <= keepRotations; n += 1) paths.push(rotated(n));
    for (const path of paths) {
      const remaining = limit - out.length;
      if (remaining <= 0) break;
      if (!fs.existsSync(path)) continue;
      const part = readTail(path, remaining);
      skipped += part.skipped;
      out.unshift(...part.entries);
    }
    return { entries: redact(out), skipped };
  }

  return {
    // Appends one line. Every line has the same six fields, and a field that is not given is null. A full file is rotated
    // first.
    record(entry) {
      if (typeof entry?.action !== 'string' || entry.action.trim() === '') {
        throw new TypeError('an audit entry needs an action');
      }
      const line = redact({
        at: new Date(now()).toISOString(),
        action: entry.action,
        target: entry.target ?? null,
        route: entry.route ?? null,
        outcome: entry.outcome ?? null,
        detail: entry.detail ?? null,
      });
      fs.mkdirSync(dirname(file), { recursive: true });
      rotateIfFull();
      fs.appendFileSync(file, `${JSON.stringify(line)}\n`, 'utf8');
    },
    // Returns the last `limit` entries, oldest first, with secrets masked, and the count of skipped lines.
    readCounted,
    // Returns the last `limit` entries, oldest first, with secrets masked. A line that does not parse is skipped.
    read: (options) => readCounted(options).entries,
    // Streams the entries at or after since (milliseconds) to visit, and returns the damaged and visited counts (see scanSince).
    scanSince,
  };
}
