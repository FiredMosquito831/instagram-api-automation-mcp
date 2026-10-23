import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFsForAudit from 'node:fs';
import { existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudit } from '../src/audit.js';
import { redact, registerSecret } from '../src/redact.js';

const TOKEN = 'EAAB-secret-value-123';

// A temporary directory that is removed when the test ends.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-audit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('audit lines never contain access_token', (t) => {
  const file = join(tempDir(t), 'audit.jsonl');
  const audit = createAudit({ file, now: () => 0 });
  audit.record({
    action: 'like',
    target: 'media_1',
    route: 'official',
    outcome: 'ok',
    detail: { access_token: TOKEN, note: `access_token=${TOKEN}` },
  });
  assert.equal(readFileSync(file, 'utf8').includes(TOKEN), false);
});

test('each line has the six fields, at comes from the clock, and missing fields are null', (t) => {
  const file = join(tempDir(t), 'audit.jsonl');
  const audit = createAudit({ file, now: () => Date.parse('2026-10-20T12:00:00.000Z') });
  audit.record({ action: 'dm_send' });
  const text = readFileSync(file, 'utf8');
  assert.equal(text.endsWith('\n'), true);
  assert.equal(text.trimEnd().split('\n').length, 1);
  assert.deepStrictEqual(JSON.parse(text), {
    at: '2026-10-20T12:00:00.000Z',
    action: 'dm_send',
    target: null,
    route: null,
    outcome: null,
    detail: null,
  });
});

test('record creates the folder when it is missing', (t) => {
  const file = join(tempDir(t), 'logs', 'nested', 'audit.jsonl');
  createAudit({ file, now: () => 0 }).record({ action: 'like' });
  assert.equal(JSON.parse(readFileSync(file, 'utf8').trim()).action, 'like');
});

test('read returns the last entries, oldest first, and an empty list when no file exists', (t) => {
  const file = join(tempDir(t), 'audit.jsonl');
  const audit = createAudit({ file, now: () => 0 });
  assert.deepStrictEqual(audit.read(), []);
  for (const action of ['one', 'two', 'three', 'four']) audit.record({ action });
  assert.deepStrictEqual(
    audit.read({ limit: 2 }).map((entry) => entry.action),
    ['three', 'four'],
  );
  assert.equal(audit.read().length, 4);
  assert.deepStrictEqual(audit.read({ limit: 0 }), []);
});

test('read skips a truncated last line and keeps the rest', (t) => {
  const file = join(tempDir(t), 'audit.jsonl');
  writeFileSync(file, '{"action":"like"}\n{"action":"fo');
  const actions = createAudit({ file, now: () => 0 })
    .read()
    .map((entry) => entry.action);
  assert.deepStrictEqual(actions, ['like']);
});

test('read redacts lines that were written with a secret', (t) => {
  const file = join(tempDir(t), 'audit.jsonl');
  writeFileSync(file, `${JSON.stringify({ action: 'x', detail: { access_token: TOKEN } })}\n`);
  const entries = createAudit({ file, now: () => 0 }).read();
  assert.equal(JSON.stringify(entries).includes(TOKEN), false);
});

test('bad arguments are rejected with TypeError', (t) => {
  const file = join(tempDir(t), 'audit.jsonl');
  const audit = createAudit({ file, now: () => 0 });
  assert.throws(() => audit.record({ detail: 'no action' }), TypeError);
  assert.throws(() => audit.read({ limit: '5' }), TypeError);
  assert.throws(() => createAudit({}), TypeError);
  assert.throws(() => createAudit({ file, now: 'later' }), TypeError);
});

test('audit read output is stable under redaction', (t) => {
  const file = join(tempDir(t), 'audit.jsonl');
  const audit = createAudit({ file, now: () => 0 });
  audit.record({ action: 'x', detail: 'x access_token=abc&y=1 Authorization: Bearer EAAB123.xyz' });
  const once = audit.read();
  assert.equal(once[0].detail, 'x access_token=[redacted]&y=1 Authorization: Bearer [redacted]');
  assert.deepStrictEqual(redact(once), once);
});

test('audit masks a registered secret that appears as a bare value in a detail', (t) => {
  registerSecret('EAAB-audit-bare-1');
  const file = join(tempDir(t), 'audit.jsonl');
  const audit = createAudit({ file, now: () => 0 });
  audit.record({ action: 'dm_send', detail: 'token EAAB-audit-bare-1' });
  assert.equal(readFileSync(file, 'utf8').includes('EAAB-audit-bare-1'), false);
  assert.equal(audit.read()[0].detail, 'token [redacted]');
});

// Added in P4 (A-4). A line that is not a JSON object is skipped and counted, and the objects are kept, in order.
test('a non-object JSON line is skipped and counted, and the objects are kept', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'audit.jsonl');
  const lines = [
    JSON.stringify({ action: 'one', at: 'x' }),
    '[1,2]',
    '42',
    '"text"',
    'null',
    '{"truncated": ',
    JSON.stringify({ action: 'two', at: 'x' }),
  ];
  writeFileSync(file, `${lines.join('\n')}\n`);
  const audit = createAudit({ file });
  const { entries, skipped } = audit.readCounted({ limit: 10 });
  assert.deepEqual(entries.map((e) => e.action), ['one', 'two']);
  assert.equal(skipped, 5, 'the array, the number, the string, the null and the cut-short line are counted');
});

// Added in P4 (A-4). A file is read in chunks, not all at once. The chunk size is set small, so the file takes many reads, and
// each read is no bigger than a chunk. The last entries are still the right ones.
test('a large audit file is read in chunks, and the last entries are the right ones', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'audit.jsonl');
  const lines = Array.from({ length: 300 }, (_, i) => JSON.stringify({ action: `a${i}`, detail: 'x'.repeat(40) }));
  writeFileSync(file, `${lines.join('\n')}\n`);
  const sizes = [];
  const fs = {
    ...nodeFsForAudit,
    readSync: (fd, buffer, offset, length, position) => {
      const got = nodeFsForAudit.readSync(fd, buffer, offset, length, position);
      sizes.push(got);
      return got;
    },
  };
  const audit = createAudit({ file, fs, chunkBytes: 256 });
  const entries = audit.read({ limit: 3 });
  assert.deepEqual(entries.map((e) => e.action), ['a297', 'a298', 'a299']);
  assert.ok(sizes.length > 20, `read in ${sizes.length} chunks`);
  assert.ok(sizes.every((size) => size <= 256), 'no read is bigger than a chunk');
});

// Added in P4 (A-28). A file that reaches the rotation size is moved to file.1, and the next line starts a new file.
test('an audit file at the rotation size rotates to file.1 before the next line is written', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'audit.jsonl');
  // A threshold of 1 byte rotates the file before every write after the first, so each rotation holds one line.
  const audit = createAudit({ file, rotateBytes: 1 });
  for (let i = 0; i < 4; i += 1) audit.record({ action: `line-${i}`, detail: 'x'.repeat(60) });
  assert.equal(existsSync(`${file}.1`), true, 'the full file was rotated');
  const current = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.equal(current.length, 1, 'the current file holds only the line written after the last rotation');
  assert.deepEqual(
    audit.read({ limit: 10 }).map((e) => e.action),
    ['line-0', 'line-1', 'line-2', 'line-3'],
    'read goes on into the rotated file',
  );
});

// Added in P4 (A-28). Only the last keepRotations rotations are kept: file.1 to file.10 by default.
test('only the last ten rotations are kept', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'audit.jsonl');
  const audit = createAudit({ file, rotateBytes: 50 });
  for (let i = 0; i < 13; i += 1) audit.record({ action: `r${i}`, detail: 'x'.repeat(40) });
  for (let n = 1; n <= 10; n += 1) assert.equal(existsSync(`${file}.${n}`), true, `file.${n} exists`);
  assert.equal(existsSync(`${file}.11`), false, 'the eleventh rotation is not kept');
  // The newest rotation is file.1, so it holds a later line than file.10.
  const newest = JSON.parse(readFileSync(`${file}.1`, 'utf8').split('\n')[0]).action;
  const oldest = JSON.parse(readFileSync(`${file}.10`, 'utf8').split('\n')[0]).action;
  assert.deepEqual([oldest, newest], ['r2', 'r11']);
});

// Added in P4 (A-28). An audit file over 50 MB rotates at the default size. The file is made large with truncate, so no
// 50 MB is written by the test.
test('an audit file over 50 MB rotates at the default size', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'audit.jsonl');
  writeFileSync(file, '{"action":"old"}\n');
  truncateSync(file, 50 * 1024 * 1024 + 1);
  const audit = createAudit({ file });
  audit.record({ action: 'new' });
  assert.equal(existsSync(`${file}.1`), true);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8').trim()).action, 'new');
});

// P4 review M-11. scanSince visits only the entries at or after the given time, across the newest file and a rotation, and it
// counts the damaged lines it reads.
test('scanSince visits the entries at or after a time, across a rotation, and counts the damaged lines', (t) => {
  const file = join(tempDir(t), 'audit.jsonl');
  const line = (at, action = 'like') => JSON.stringify({ at, action, outcome: 'ok', target: null, route: null, detail: null });
  writeFileSync(`${file}.1`, `${line('2026-10-20T09:00:00.000Z')}\nnot json\n`);
  writeFileSync(
    file,
    [line('2026-10-20T10:30:00.000Z'), line('2026-10-20T11:00:00.000Z'), 'damaged line', line('2026-10-20T11:30:00.000Z'), ''].join('\n'),
  );
  const audit = createAudit({ file, now: () => 0 });
  const seen = [];
  const result = audit.scanSince(Date.parse('2026-10-20T10:00:00.000Z'), (entry) => seen.push(entry.at));
  assert.deepEqual(seen, ['2026-10-20T10:30:00.000Z', '2026-10-20T11:00:00.000Z', '2026-10-20T11:30:00.000Z']);
  assert.deepEqual(result, { damaged: 2, visited: 3 }, 'the damaged line of the newest file and the damaged line of the rotation are both counted');
});

// Changed in the P4 final round (N-3). Old test (removed): 'scanSince does not read a rotation once the newest file starts before the
// time', with the assertion { damaged: 0, visited: 1 } and the message 'the rotation with the damaged line is not read'. That early stop
// assumed the lines were in time order. New: every retained file is read, so the damaged line of the rotation is counted, and the
// entry in the rotation before the time is not visited.
test('scanSince reads every retained file, so a rotation with lines out of time order is counted in full', (t) => {
  const file = join(tempDir(t), 'audit.jsonl');
  const line = (at) => JSON.stringify({ at, action: 'like', outcome: 'ok', target: null, route: null, detail: null });
  writeFileSync(`${file}.1`, `${line('2026-10-20T08:00:00.000Z')}\nnot json at all\n`);
  writeFileSync(file, [line('2026-10-20T09:50:00.000Z'), line('2026-10-20T10:20:00.000Z')].join('\n') + '\n');
  const audit = createAudit({ file, now: () => 0 });
  const seen = [];
  const result = audit.scanSince(Date.parse('2026-10-20T10:00:00.000Z'), (entry) => seen.push(entry.at));
  assert.deepEqual(seen, ['2026-10-20T10:20:00.000Z']);
  assert.deepEqual(result, { damaged: 1, visited: 1 }, 'the damaged line of the rotation is counted');
});

// P4 final N-3. Lines that are out of time order count the same as the same lines in order: each line is tested by its own time.
test('an out-of-order audit file counts the same as the ordered one', (t) => {
  const line = (at) => JSON.stringify({ at, action: 'like', outcome: 'ok', target: null, route: null, detail: null });
  const times = ['2026-10-20T10:05:00.000Z', '2026-10-20T11:00:00.000Z', '2026-10-20T09:00:00.000Z', '2026-10-20T10:50:00.000Z'];
  const scanned = (dir, lines) => {
    const file = join(dir, 'audit.jsonl');
    writeFileSync(file, lines.map(line).join('\n') + '\n');
    const seen = [];
    const result = createAudit({ file, now: () => 0 }).scanSince(Date.parse('2026-10-20T10:00:00.000Z'), (entry) => seen.push(entry.at));
    return { seen: seen.sort(), result };
  };
  const ordered = scanned(tempDir(t), [...times].sort());
  const reversed = scanned(tempDir(t), [...times].reverse());
  assert.deepEqual(reversed, ordered);
  assert.deepEqual(ordered.seen, ['2026-10-20T10:05:00.000Z', '2026-10-20T10:50:00.000Z', '2026-10-20T11:00:00.000Z']);
});

// P4 final N-3. A backward clock step can leave a rotation with lines inside the window while the newest file starts before it. Those
// lines are counted (the old early stop skipped them).
test('a rotation that holds an in-window line is read even when the newest file starts before the window', (t) => {
  const file = join(tempDir(t), 'audit.jsonl');
  const line = (at) => JSON.stringify({ at, action: 'like', outcome: 'ok', target: null, route: null, detail: null });
  writeFileSync(`${file}.1`, `${line('2026-10-20T10:30:00.000Z')}\n`);
  writeFileSync(file, `${line('2026-10-20T09:50:00.000Z')}\n`);
  const seen = [];
  const result = createAudit({ file, now: () => 0 }).scanSince(Date.parse('2026-10-20T10:00:00.000Z'), (entry) => seen.push(entry.at));
  assert.deepEqual(seen, ['2026-10-20T10:30:00.000Z']);
  assert.deepEqual(result, { damaged: 0, visited: 1 });
});
