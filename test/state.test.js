import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFsForState from 'node:fs';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createState } from '../src/state.js';

// A temporary directory that is removed when the test ends.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('values set before save are loaded by a new state object', async (t) => {
  const file = join(tempDir(t), 'state.json');
  const state = await createState({ file });
  assert.equal(state.get('missing', 'fallback'), 'fallback');
  state.set('caps.likes', { perHour: 3 });
  state.set('flag', true);
  state.save();
  const again = await createState({ file });
  assert.deepStrictEqual(again.get('caps.likes'), { perHour: 3 });
  assert.equal(again.get('flag'), true);
});

test('state save is atomic: the file parses after save(), and no .tmp file remains', async (t) => {
  const file = join(tempDir(t), 'state.json');
  const state = await createState({ file });
  state.set('a', 1);
  state.save();
  assert.deepStrictEqual(JSON.parse(readFileSync(file, 'utf8')), { a: 1 });
  assert.equal(existsSync(`${file}.tmp`), false);
});

test('a save that fails leaves the previous state file in place', async (t) => {
  const file = join(tempDir(t), 'state.json');
  const state = await createState({ file });
  state.set('version', 1);
  state.save();
  state.set('version', 2);
  // The temporary file cannot be created, so the save must fail and the old file must be untouched.
  mkdirSync(`${file}.tmp`);
  assert.throws(() => state.save());
  assert.deepStrictEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1 });
});

test('a failed save restores memory to the last saved image', async (t) => {
  const file = join(tempDir(t), 'state.json');
  const state = await createState({ file });
  state.set('version', 1);
  state.save();
  state.set('version', 2);
  state.set('added', true);
  mkdirSync(`${file}.tmp`);
  assert.throws(() => state.save());
  // Memory matches the disk again: the unsaved change is gone, and the saved value is back.
  assert.equal(state.get('version'), 1);
  assert.equal(state.get('added', 'absent'), 'absent');
});

test('save creates the folder when it is missing', async (t) => {
  const file = join(tempDir(t), 'data', 'state.json');
  const state = await createState({ file });
  state.set('a', 1);
  state.save();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).a, 1);
});

test('corrupt state file is moved aside and loads empty', async (t) => {
  const file = join(tempDir(t), 'state.json');
  writeFileSync(file, '{"events.acked": 4');
  const state = await createState({ file });
  assert.equal(state.get('events.acked', 0), 0);
  assert.equal(readFileSync(`${file}.corrupt`, 'utf8'), '{"events.acked": 4');
  assert.equal(state.movedAside, `${file}.corrupt`);
});

test('a corrupt state file leaves a stop record on disk at once, and a new load reports it', async (t) => {
  const file = join(tempDir(t), 'state.json');
  writeFileSync(file, '{"events.acked": 4');
  const before = Date.now();
  const state = await createState({ file });
  const after = Date.now();
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(onDisk.stop.stopped, true);
  assert.equal(onDisk.stop.kind, 'STATE_CORRUPT');
  assert.equal(onDisk.stop.detail, 'state file unreadable; moved aside to state.json.corrupt');
  assert.match(onDisk.stop.since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Date.parse(onDisk.stop.since) >= before && Date.parse(onDisk.stop.since) <= after);
  assert.equal(readFileSync(`${file}.corrupt`, 'utf8'), '{"events.acked": 4');
  assert.equal(state.movedAside, `${file}.corrupt`);
  // A restart before any save still sees the stop, and nothing was moved aside this time.
  const restarted = await createState({ file });
  assert.equal(restarted.get('stop').kind, 'STATE_CORRUPT');
  assert.equal(restarted.get('stop').stopped, true);
  assert.equal(restarted.movedAside, null);
});

test('a state file that parses but is not an object is also moved aside', async (t) => {
  const dir = tempDir(t);
  for (const [index, text] of ['[1,2]', '"text"', 'null', '7'].entries()) {
    const file = join(dir, `state-${index}.json`);
    writeFileSync(file, text);
    const state = await createState({ file });
    assert.equal(state.get('anything', 'empty'), 'empty');
    assert.equal(readFileSync(`${file}.corrupt`, 'utf8'), text);
  }
});

test('a missing state file loads empty and reports nothing moved aside', async (t) => {
  const state = await createState({ file: join(tempDir(t), 'state.json') });
  assert.equal(state.get('x', 'empty'), 'empty');
  assert.equal(state.movedAside, null);
});

test('set refuses a value that JSON would change silently, and a bad key', async (t) => {
  const state = await createState({ file: join(tempDir(t), 'state.json') });
  assert.throws(() => state.set('n', Number.NaN), TypeError);
  assert.throws(() => state.set('n', Infinity), TypeError);
  assert.throws(() => state.set('u', undefined), TypeError);
  assert.throws(() => state.set('d', new Date(0)), TypeError);
  assert.throws(() => state.set('h', [1, , 3]), TypeError);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => state.set('c', cycle), TypeError);
  assert.throws(() => state.set('', 1), TypeError);
  assert.equal(state.get('n', 'unset'), 'unset');
});

test('get returns a copy, so changing it does not change the stored value', async (t) => {
  const state = await createState({ file: join(tempDir(t), 'state.json') });
  state.set('list', [1]);
  state.get('list').push(2);
  assert.deepStrictEqual(state.get('list'), [1]);
});

// F-28 (Task 3 M-5). A second corrupt state file gets a numbered copy name, and the first copy is kept.
test('a second corrupt state file is copied to a numbered name, and the first copy is kept (F-28)', async (t) => {
  const file = join(tempDir(t), 'state.json');
  writeFileSync(file, '{"first": 1');
  const first = await createState({ file });
  assert.equal(first.movedAside, `${file}.corrupt`);
  writeFileSync(file, '{"second": 2');
  const second = await createState({ file });
  assert.equal(second.movedAside, `${file}.corrupt.1`);
  assert.equal(readFileSync(`${file}.corrupt`, 'utf8'), '{"first": 1', 'the first copy is kept');
  assert.equal(readFileSync(`${file}.corrupt.1`, 'utf8'), '{"second": 2');
});

// Added in P4. keys lists the keys with a prefix, and delete removes a key when the state is saved.
test('keys lists the keys with a prefix, and delete removes a key on save', async (t) => {
  const file = join(tempDir(t), 'state.json');
  const state = await createState({ file });
  state.set('poll.seen.t_1', 'a');
  state.set('poll.seen.t_2', 'b');
  state.set('poll.listed.t_1', 'c');
  assert.deepEqual(state.keys('poll.seen.'), ['poll.seen.t_1', 'poll.seen.t_2']);
  state.delete('poll.seen.t_1');
  assert.equal(state.get('poll.seen.t_1', null), null);
  state.save();
  const reloaded = await createState({ file });
  assert.deepEqual(reloaded.keys('poll.'), ['poll.listed.t_1', 'poll.seen.t_2']);
});

// Added in P4 (O-3). Event cursors that cannot be read (here acked above issued, and a text value) are damage. The file is copied
// aside, the cursors are repaired so that none moves backwards, and a STATE_CORRUPT stop is stored when no stop is.
test('damaged event cursors are copied aside, repaired, and a STATE_CORRUPT stop is stored', async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'state.json');
  writeFileSync(file, JSON.stringify({ 'events.issued': 2, 'events.acked': 5, 'caps.x': [] }));
  const state = await createState({ file });
  assert.equal(state.movedAside, `${file}.corrupt`);
  assert.equal(existsSync(`${file}.corrupt`), true, 'the damaged file is kept as a copy');
  // Changed in the P4 review fix (I-3). Old assertions (removed): events.acked and events.issued were both removed. New: no cursor
  // moves backwards. events.acked stays at 5, and events.issued is raised to 5.
  assert.equal(state.get('events.acked', undefined), 5);
  assert.equal(state.get('events.issued', undefined), 5);
  assert.equal(state.get('caps.x', null) !== null, true, 'other keys are kept');
  const stop = state.get('stop', null);
  assert.equal(stop.kind, 'STATE_CORRUPT');
  assert.equal(stop.stopped, true);
  // The repair is on disk, so a restart reads the same stop and the same cursor.
  const restarted = await createState({ file });
  assert.equal(restarted.get('stop', null).kind, 'STATE_CORRUPT');
  // Changed in the P4 review fix (I-3). Old assertion (removed): restarted.get('events.acked') was undefined.
  assert.equal(restarted.get('events.acked', undefined), 5);
});

// P4 review I-3. The repair moves no cursor backwards, and it records what it did in a notice.
test('a repair raises events.issued to events.acked, and records the repair as a notice', async (t) => {
  const file = join(tempDir(t), 'state.json');
  writeFileSync(file, JSON.stringify({ 'events.issued': 2, 'events.acked': 9 }));
  const state = await createState({ file });
  assert.equal(state.get('events.issued', undefined), 9);
  assert.equal(state.get('events.acked', undefined), 9);
  const notices = [];
  state.drainNotices((notice) => notices.push(notice));
  assert.deepEqual(notices.map((n) => [n.action, n.outcome, n.detail.cursors]), [['state.repair', 'repaired', ['events.issued']]]);
  assert.equal(notices[0].detail.stopReplaced, null, 'no stored stop was replaced');
});

// P4 review I-1. A repair over a stored non-halting stop (RATE_LIMITED) sets STATE_CORRUPT, and the change is recorded.
test('a repair over a stored RATE_LIMITED sets STATE_CORRUPT, and the notice records the replaced stop', async (t) => {
  const file = join(tempDir(t), 'state.json');
  const stop = { stopped: true, kind: 'RATE_LIMITED', detail: 'code 4', since: '2026-10-21T10:00:00.000Z' };
  writeFileSync(file, JSON.stringify({ 'events.issued': 2, 'events.acked': 9, stop }));
  const state = await createState({ file });
  assert.equal(state.get('stop', null).kind, 'STATE_CORRUPT');
  const notices = [];
  state.drainNotices((notice) => notices.push(notice));
  assert.equal(notices[0].detail.stopReplaced, 'RATE_LIMITED');
  assert.equal((await createState({ file })).get('stop', null).kind, 'STATE_CORRUPT', 'the replacement is on disk');
});

// P4 review I-1. A repair does not replace a stored halting stop: it is kept.
test('a repair keeps a stored halting stop', async (t) => {
  const file = join(tempDir(t), 'state.json');
  const stop = { stopped: true, kind: 'CHECKPOINT', detail: 'checkpoint', since: '2026-10-21T10:00:00.000Z' };
  writeFileSync(file, JSON.stringify({ 'events.issued': 2, 'events.acked': 9, stop }));
  const state = await createState({ file });
  assert.equal(state.get('stop', null).kind, 'CHECKPOINT');
});

// P4 review M-2. A notice is dropped only after its write returns, so a failed write leaves it for the next drain.
test('a notice whose write fails stays queued for the next drain', async (t) => {
  const file = join(tempDir(t), 'state.json');
  writeFileSync(file, JSON.stringify({ 'events.issued': 2, 'events.acked': 9 }));
  const state = await createState({ file });
  assert.throws(() => state.drainNotices(() => {
    throw new Error('audit unavailable');
  }));
  const notices = [];
  state.drainNotices((notice) => notices.push(notice));
  assert.equal(notices.length, 1, 'the notice was not lost');
  state.drainNotices((notice) => notices.push(notice));
  assert.equal(notices.length, 1, 'a written notice is not written again');
});

// P4 review M-5. A damaged file whose copy aside fails does not stop the start. The repaired state is kept in memory, the damaged
// file is not replaced, and a save makes the copy first. A save that cannot make the copy throws, so the stop is kept in process.
test('a copy aside that fails does not stop the start, and no save replaces the damaged file before its copy exists', async (t) => {
  const file = join(tempDir(t), 'state.json');
  const damaged = JSON.stringify({ 'events.issued': 2, 'events.acked': 9 });
  writeFileSync(file, damaged);
  let failures = 2;
  const fs = {
    ...nodeFsForState,
    copyFileSync: (from, to) => {
      if (failures > 0) {
        failures -= 1;
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      return copyFileSync(from, to);
    },
  };
  const state = await createState({ file, fs });
  assert.equal(state.get('stop', null).kind, 'STATE_CORRUPT', 'the start is stopped, not refused');
  assert.equal(state.movedAside, null, 'no copy exists yet');
  assert.equal(readFileSync(file, 'utf8'), damaged, 'the damaged file is not replaced');
  assert.throws(() => state.save(), (err) => err.kind === 'CONFIG', 'a save that cannot copy the damaged file is refused');
  assert.equal(readFileSync(file, 'utf8'), damaged, 'still not replaced');
  state.save();
  assert.equal(state.movedAside, `${file}.corrupt`, 'the copy exists after the next save');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).stop.kind, 'STATE_CORRUPT');
});

// Added in P4 (O-3). A text cursor is damage too, and a stop that is already stored is kept.
test('a text cursor is damage, and a stored stop is kept when the cursors are repaired', async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'state.json');
  const stop = { stopped: true, kind: 'AUTH_EXPIRED', detail: 'code 190', since: '2026-10-21T10:00:00.000Z' };
  writeFileSync(file, JSON.stringify({ 'events.lastSeq': 'seven', stop }));
  const state = await createState({ file });
  assert.equal(state.get('events.lastSeq', undefined), undefined);
  assert.equal(state.get('stop', null).kind, 'AUTH_EXPIRED', 'the stored stop is not replaced by STATE_CORRUPT');
});

// P4 review M-11. The state tells the service when its file could not be parsed, so that the counters are rebuilt. A file that
// parses, or a file that is not there, is not unreadable.
test('unreadable is true only when the state file could not be parsed', async (t) => {
  const dir = tempDir(t);
  const garbled = join(dir, 'garbled.json');
  writeFileSync(garbled, '{ not json');
  assert.equal((await createState({ file: garbled })).unreadable, true);
  const parsed = join(dir, 'parsed.json');
  writeFileSync(parsed, JSON.stringify({ 'caps.likes': [] }));
  assert.equal((await createState({ file: parsed })).unreadable, false);
  assert.equal((await createState({ file: join(dir, 'missing.json') })).unreadable, false);
});

// P4 review, lost-state rebuild. missing is true only when there is no state file at all.
test('missing is true only when there is no state file', async (t) => {
  const dir = tempDir(t);
  assert.equal((await createState({ file: join(dir, 'absent.json') })).missing, true);
  const present = join(dir, 'present.json');
  writeFileSync(present, '{}');
  assert.equal((await createState({ file: present })).missing, false);
});

// P4 final N-1 and the I-3 residual. A damaged acked position is removed, not reset to zero, and the cursors are marked unknown, so the
// event log holds pending and ack. A reset to zero would move the acked position back and redeliver acked events.
test('a damaged acked cursor is removed and marks the cursors unknown; it is not reset to zero', async (t) => {
  const file = join(tempDir(t), 'state.json');
  writeFileSync(file, JSON.stringify({ 'events.issued': 9, 'events.acked': '9' }));
  const state = await createState({ file });
  assert.equal(state.get('events.acked', undefined), undefined, 'the damaged value is removed, not replaced by 0');
  assert.equal(state.get('events.issued', undefined), 9);
  assert.equal(state.get('events.cursorsLost', undefined).reason, 'damaged event cursor');
  const notices = [];
  state.drainNotices((notice) => notices.push(notice));
  assert.equal(notices[0].detail.note.includes('no cursor was moved backwards'), false, 'the note no longer claims that');
  assert.match(notices[0].detail.note, /cursors are unknown/);
});

// P4 final N-1. A damaged events.lastSeq alone leaves the acked and issued cursors intact, so no cursor is marked unknown.
test('a damaged events.lastSeq alone is removed and leaves the cursors intact, with no unknown marker', async (t) => {
  const file = join(tempDir(t), 'state.json');
  writeFileSync(file, JSON.stringify({ 'events.issued': 9, 'events.acked': 4, 'events.lastSeq': 'nine' }));
  const state = await createState({ file });
  assert.equal(state.get('events.lastSeq', undefined), undefined);
  assert.equal(state.get('events.acked', undefined), 4);
  assert.equal(state.get('events.cursorsLost', undefined), undefined);
  const notices = [];
  state.drainNotices((notice) => notices.push(notice));
  assert.equal(notices[0].detail.note, 'a damaged event counter was removed; the acked and issued cursors are intact');
});
