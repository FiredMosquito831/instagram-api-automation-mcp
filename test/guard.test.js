import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventLog } from '../src/events.js';
import { IgError, mapGraphError } from '../src/errors.js';
import { createGuard } from '../src/guard.js';
import { registerSecret } from '../src/redact.js';
import { createState } from '../src/state.js';

const START = Date.UTC(2026, 9, 20, 12, 0, 0);
const OWNER = { igUserId: '17841400000000001' };

// A temporary directory that is removed when the test ends.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-guard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeClock(start = START) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

// The paths of one service: the state file and the events file, in one directory.
function paths(t) {
  const dir = tempDir(t);
  return { state: join(dir, 'state.json'), events: join(dir, 'events.jsonl') };
}

function guardOver(state, file, clock = fakeClock()) {
  return createGuard({ owner: OWNER, state, now: clock.now, eventsFile: file.events });
}

function stopped(guard) {
  assert.throws(() => guard.assertNotStopped(), (error) => error instanceof IgError && error.kind === 'STOPPED');
}

test('an owner mismatch throws OWNER_MISMATCH, and the owner passes', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  assert.equal(guard.assertOwner('17841400000000001'), undefined);
  assert.throws(
    () => guard.assertOwner('17841400000000002'),
    (error) => error instanceof IgError && error.kind === 'OWNER_MISMATCH',
  );
  // A number is not the owner's string id, so it is refused too.
  assert.throws(() => guard.assertOwner(17841400000000001), (error) => error.kind === 'OWNER_MISMATCH');
});

test('error 190 sets stop state: shouldStop is true for AUTH_EXPIRED, and assertNotStopped throws STOPPED', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  const error = mapGraphError({ status: 400, body: { error: { code: 190, message: 'expired' } } });
  assert.equal(error.kind, 'AUTH_EXPIRED');
  assert.equal(guard.shouldStop(error), true);
  guard.stop('AUTH_EXPIRED', 'code 190');
  stopped(guard);
  assert.equal(guard.stopStatus().kind, 'AUTH_EXPIRED');
});

test('rate limit sets stop state: shouldStop is true for RATE_LIMITED, including code 80002', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  assert.equal(guard.shouldStop(mapGraphError({ status: 429, body: {} })), true);
  assert.equal(guard.shouldStop(mapGraphError({ status: 400, body: { error: { code: 80002 } } })), true);
});

test('shouldStop is false for an error that does not stop outbound actions', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  assert.equal(guard.shouldStop(mapGraphError({ status: 400, body: { error: { code: 100 } } })), false);
  assert.equal(guard.shouldStop(new Error('plain')), false);
  assert.equal(guard.shouldStop(undefined), false);
});

test('stop state survives a restart: a new guard over the same state file still refuses', async (t) => {
  const file = paths(t);
  const first = guardOver(await createState({ file: file.state }), file);
  first.stop('CHECKPOINT', 'checkpoint required');
  const second = guardOver(await createState({ file: file.state }), file);
  stopped(second);
  assert.equal(second.stopStatus().kind, 'CHECKPOINT');
});

// Changed in the P4 fix round 2 (N-13). Old assertion (removed): the record's keys are exactly detail, kind, since, stopped. New: the
// record also holds the list stops, with the one stop observed (its kind, detail, since and rank). The top-level fields are unchanged.
test('a stop is saved at once, in the shape { stopped, kind, detail, since, stops } under the key stop', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  guard.stop('RATE_LIMITED', 'code 4');
  const onDisk = JSON.parse(readFileSync(file.state, 'utf8')).stop;
  assert.deepStrictEqual(Object.keys(onDisk).sort(), ['detail', 'kind', 'since', 'stopped', 'stops']);
  assert.deepStrictEqual(onDisk.stops.map((entry) => [entry.kind, entry.rank]), [['RATE_LIMITED', 2]]);
  assert.equal(onDisk.stopped, true);
  assert.equal(onDisk.kind, 'RATE_LIMITED');
  assert.equal(onDisk.detail, 'code 4');
  assert.equal(onDisk.since, new Date(START).toISOString());
});

test('gate returns preview when confirm is absent and execute when it is true, and refuses other values', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  assert.equal(guard.gate(), 'preview');
  assert.equal(guard.gate(false), 'preview');
  assert.equal(guard.gate(true), 'execute');
  assert.throws(() => guard.gate('yes'), (error) => error.kind === 'VALIDATION');
});

test('clearStop needs confirm: without it nothing changes, and with it the stop is cleared and saved', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  guard.stop('AUTH_EXPIRED', 'code 190');
  assert.equal(guard.clearStop(), 'preview');
  assert.equal(guard.clearStop(false), 'preview');
  stopped(guard);
  assert.throws(() => guard.clearStop('yes'), (error) => error.kind === 'VALIDATION');
  assert.equal(guard.clearStop(true), 'cleared');
  assert.equal(guard.stopStatus().stopped, false);
  assert.equal(guard.assertNotStopped(), undefined);
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().stopped, false);
});

test('clearStop with nothing stopped returns not_stopped and writes nothing', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  assert.equal(guard.clearStop(true), 'not_stopped');
  assert.equal(existsSync(file.state), false);
});

// Changed in fix round 2 (I-2): this test pinned the first-kept rule. Old assertion: the stored kind stays RATE_LIMITED.
// New assertion: AUTH_EXPIRED ranks higher than RATE_LIMITED, so it replaces it.
test('a stop of higher severity replaces the stored kind', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  guard.stop('RATE_LIMITED', 'first');
  guard.stop('AUTH_EXPIRED', 'second');
  assert.equal(guard.stopStatus().kind, 'AUTH_EXPIRED');
});

test('a CHECKPOINT after a stored RATE_LIMITED replaces it, and the replacement survives a reload', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  guard.stop('RATE_LIMITED', 'code 4');
  guard.stop('CHECKPOINT', 'checkpoint required');
  assert.equal(guard.stopStatus().kind, 'CHECKPOINT');
  assert.equal(JSON.parse(readFileSync(file.state, 'utf8')).stop.kind, 'CHECKPOINT');
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'CHECKPOINT');
  assert.equal(restarted.stopStatus().detail, 'checkpoint required');
});

test('a RATE_LIMITED after a stored CHECKPOINT does not replace it', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  guard.stop('CHECKPOINT', 'checkpoint required');
  guard.stop('RATE_LIMITED', 'code 4');
  assert.equal(guard.stopStatus().kind, 'CHECKPOINT');
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'CHECKPOINT');
});

test('an equal rank keeps the stored record, with its detail and since', async (t) => {
  const file = paths(t);
  const clock = fakeClock();
  const guard = guardOver(await createState({ file: file.state }), file, clock);
  guard.stop('RATE_LIMITED', 'first');
  const since = guard.stopStatus().since;
  clock.advance(60000);
  guard.stop('RATE_LIMITED', 'second');
  assert.deepEqual([guard.stopStatus().detail, guard.stopStatus().since], ['first', since]);
  guard.stop('AUTH_EXPIRED', 'auth first');
  guard.stop('CHECKPOINT', 'checkpoint second');
  assert.deepEqual([guard.stopStatus().kind, guard.stopStatus().detail], ['AUTH_EXPIRED', 'auth first']);
  const restarted = guardOver(await createState({ file: file.state }), file, clock);
  assert.equal(restarted.stopStatus().detail, 'auth first');
});

test('an unknown kind never replaces a stored stop', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  guard.stop('RATE_LIMITED', 'code 4');
  assert.throws(() => guard.stop('RATE_LIMIT', 'typo'), (error) => error.kind === 'VALIDATION');
  assert.equal(guard.stopStatus().kind, 'RATE_LIMITED');
});

test('a replacement whose save fails still stops this process, and is saved on the next call', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  guard.stop('RATE_LIMITED', 'code 4');
  mkdirSync(`${file.state}.tmp`);
  assert.throws(() => guard.stop('CHECKPOINT', 'checkpoint'), (error) => error.kind === 'CONFIG');
  assert.equal(guard.stopStatus().kind, 'CHECKPOINT');
  rmSync(`${file.state}.tmp`, { recursive: true, force: true });
  assert.throws(
    () => guard.assertNotStopped(),
    (error) => error.kind === 'STOPPED' && error.details.saved === true,
  );
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'CHECKPOINT');
});

test('an unknown stop kind is refused, but the stop is still recorded under ACTION_BLOCKED', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  assert.throws(() => guard.stop('RATE_LIMIT', 'typo'), (error) => error.kind === 'VALIDATION');
  const status = guard.stopStatus();
  assert.equal(status.stopped, true);
  assert.equal(status.kind, 'ACTION_BLOCKED');
  assert.match(status.detail, /not recognised/);
  stopped(guard);
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'ACTION_BLOCKED');
});

test('a non-string stop detail is recorded as text, and the stop is kept', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  assert.doesNotThrow(() => guard.stop('RATE_LIMITED', 12345));
  assert.equal(guard.stopStatus().detail, '12345');
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'RATE_LIMITED');
});

test('a clock value outside the Date range still records the stop, with a valid time', async (t) => {
  const file = paths(t);
  const broken = createGuard({ owner: OWNER, state: await createState({ file: file.state }), now: () => 1e20, eventsFile: file.events });
  assert.doesNotThrow(() => broken.stop('CHECKPOINT', 'checkpoint'));
  assert.match(broken.stopStatus().since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'CHECKPOINT');
});

test('a stop is recorded even when the clock throws', async (t) => {
  const file = paths(t);
  const state = await createState({ file: file.state });
  const broken = createGuard({
    owner: OWNER,
    state,
    now: () => {
      throw new Error('clock failed');
    },
    eventsFile: file.events,
  });
  assert.doesNotThrow(() => broken.stop('AUTH_EXPIRED', 'code 190'));
  assert.equal(broken.stopStatus().kind, 'AUTH_EXPIRED');
  assert.match(broken.stopStatus().since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('assertNotStopped retries a stop whose save failed, and the stop is saved once the save succeeds', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  mkdirSync(`${file.state}.tmp`);
  assert.throws(() => guard.stop('RATE_LIMITED', 'code 17'), (error) => error.kind === 'CONFIG');
  // The retry fails while the blocker is in place, and the call still refuses, with saved false.
  assert.throws(
    () => guard.assertNotStopped(),
    (error) => error.kind === 'STOPPED' && error.details.saved === false,
  );
  assert.equal(existsSync(file.state), false);
  rmSync(`${file.state}.tmp`, { recursive: true, force: true });
  assert.throws(
    () => guard.assertNotStopped(),
    (error) => error.kind === 'STOPPED' && error.details.saved === true,
  );
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'RATE_LIMITED');
});

test('a stop detail is redacted and kept under 200 characters', async (t) => {
  const file = paths(t);
  registerSecret('guard-test-secret-value');
  const guard = guardOver(await createState({ file: file.state }), file);
  guard.stop('ACTION_BLOCKED', `code 368 with guard-test-secret-value ${'x'.repeat(500)}`);
  const { detail } = guard.stopStatus();
  assert.equal(detail.includes('guard-test-secret-value'), false);
  assert.ok(detail.length <= 200, `detail is ${detail.length} characters`);
  // The clipped detail is stored, so the next start still reads a valid record.
  const restarted = guardOver(await createState({ file: file.state }), file);
  stopped(restarted);
});

test('STATE_CORRUPT: a corrupt state file stops the guard, and the stop survives a restart', async (t) => {
  const file = paths(t);
  writeFileSync(file.state, 'not json at all');
  const state = await createState({ file: file.state });
  const guard = guardOver(state, file);
  stopped(guard);
  assert.equal(guard.stopStatus().kind, 'STATE_CORRUPT');
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'STATE_CORRUPT');
});

test('STATE_LOST: an events file with a header and no state file stops the guard, until ig_stop_clear', async (t) => {
  const file = paths(t);
  // A header shows the events file has held events; with the state file gone, the guard must not run.
  writeFileSync(file.events, '{"lastSeq":5}\n');
  const guard = guardOver(await createState({ file: file.state }), file);
  stopped(guard);
  assert.equal(guard.stopStatus().kind, 'STATE_LOST');
  // Still stopped after a restart, because the stop was saved.
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'STATE_LOST');
  assert.equal(restarted.clearStop(true), 'cleared');
  // Once cleared, a restart does not stop again, even though the state still has no events.lastSeq.
  const afterClear = guardOver(await createState({ file: file.state }), file);
  assert.equal(afterClear.stopStatus().stopped, false);
});

test('STATE_LOST also holds for an events file with events and no header, as an append leaves it', async (t) => {
  const file = paths(t);
  const clock = fakeClock();
  const state = await createState({ file: file.state });
  const events = createEventLog({ file: file.events, state, now: clock.now });
  events.append({ id: 'm1', kind: 'message', senderId: 'u1', text: 'hello' });
  unlinkSync(file.state);
  const guard = guardOver(await createState({ file: file.state }), file, clock);
  assert.equal(guard.stopStatus().kind, 'STATE_LOST');
});

test('STATE_LOST also holds for an events file with a header, as a decide or a purge leaves it', async (t) => {
  const file = paths(t);
  const clock = fakeClock();
  const state = await createState({ file: file.state });
  const events = createEventLog({ file: file.events, state, now: clock.now });
  events.append({ id: 'm1', kind: 'message', senderId: 'u1', text: 'hello' });
  events.decide('m1', { action: 'ignore' });
  unlinkSync(file.state);
  const guard = guardOver(await createState({ file: file.state }), file, clock);
  assert.equal(guard.stopStatus().kind, 'STATE_LOST');
});

test('a fresh install, with no state file and no events file, is not stopped', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  assert.equal(guard.stopStatus().stopped, false);
  assert.equal(guard.assertNotStopped(), undefined);
});

test('a state that holds events.lastSeq with an events file is not stopped', async (t) => {
  const file = paths(t);
  const clock = fakeClock();
  const state = await createState({ file: file.state });
  const events = createEventLog({ file: file.events, state, now: clock.now });
  events.append({ id: 'm1', kind: 'message', senderId: 'u1', text: 'hello' });
  const guard = guardOver(await createState({ file: file.state }), file, clock);
  assert.equal(guard.stopStatus().stopped, false);
});

test('a failed save still leaves this process stopped, and the error is raised', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  // A directory named like the temporary file makes the save fail.
  mkdirSync(`${file.state}.tmp`);
  assert.throws(() => guard.stop('RATE_LIMITED', 'code 17'), (error) => error.kind === 'CONFIG');
  stopped(guard);
});

test('a stop whose save failed is saved again by the next stop call', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  mkdirSync(`${file.state}.tmp`);
  assert.throws(() => guard.stop('RATE_LIMITED', 'code 17'), (error) => error.kind === 'CONFIG');
  rmSync(`${file.state}.tmp`, { recursive: true, force: true });
  guard.stop('RATE_LIMITED', 'code 17');
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'RATE_LIMITED');
});

// Changed in P4 (O-3). Old assertion (removed): assert.throws(() => guardOver(state, file), kind CONFIG), so the guard refused
// to start. New assertion: the guard starts stopped with STATE_CORRUPT, the record is saved, and it survives a restart.
test('a malformed stop record in the state file starts the guard stopped with STATE_CORRUPT (O-3)', async (t) => {
  const file = paths(t);
  writeFileSync(file.state, JSON.stringify({ stop: { stopped: 'yes', kind: 'NOPE', detail: null, since: null } }));
  const state = await createState({ file: file.state });
  const guard = guardOver(state, file);
  assert.deepEqual([guard.stopStatus().stopped, guard.stopStatus().kind], [true, 'STATE_CORRUPT']);
  assert.throws(() => guard.assertNotStopped(), (error) => error.kind === 'STOPPED');
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'STATE_CORRUPT');
});

test('createGuard refuses an owner with no igUserId and an events file path that is missing', async (t) => {
  const file = paths(t);
  const state = await createState({ file: file.state });
  const clock = fakeClock();
  assert.throws(() => createGuard({ owner: {}, state, now: clock.now, eventsFile: file.events }), TypeError);
  assert.throws(() => createGuard({ owner: OWNER, state, now: clock.now }), TypeError);
});

// F-1 (Task 4 M-1, Task 3 O-2). A deleted state file, with no events file, is STATE_LOST when the audit file holds lines.
test('STATE_LOST: a deleted state file with audit lines and no events file stops the guard (F-1)', async (t) => {
  const file = paths(t);
  const auditFile = join(file.state, '..', 'audit.jsonl');
  writeFileSync(auditFile, '{"action":"stopClear","outcome":"ok"}\n');
  const guard = createGuard({
    owner: OWNER,
    state: await createState({ file: file.state }),
    now: fakeClock().now,
    eventsFile: file.events,
    auditFile,
  });
  assert.equal(guard.stopStatus().kind, 'STATE_LOST');
  stopped(guard);
});

// F-1. An audit file that holds only white space is no evidence, so the guard starts clear.
test('an audit file with only white space is no evidence, and the guard starts clear (F-1)', async (t) => {
  const file = paths(t);
  const auditFile = join(file.state, '..', 'audit.jsonl');
  writeFileSync(auditFile, '  \n');
  const guard = createGuard({
    owner: OWNER,
    state: await createState({ file: file.state }),
    now: fakeClock().now,
    eventsFile: file.events,
    auditFile,
  });
  assert.equal(guard.stopStatus().stopped, false);
});

// F-1. The audit path, when given, must be a non-blank string.
test('createGuard refuses an audit path that is blank (F-1)', async (t) => {
  const file = paths(t);
  const state = await createState({ file: file.state });
  assert.throws(() => createGuard({ owner: OWNER, state, now: fakeClock().now, eventsFile: file.events, auditFile: '  ' }), TypeError);
});

// F-31 (Task 4 N-2). A null stop detail is stored as the text 'null', and a missing one as ''.
test('a null stop detail is stored as the text null, and a missing one as empty text (F-31)', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  guard.stop('RATE_LIMITED', null);
  assert.equal(guard.stopStatus().detail, 'null');
  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().detail, 'null');
  guard.clearStop(true);
  guard.stop('CHECKPOINT');
  assert.equal(guard.stopStatus().detail, '');
});

// F-32 (Task 4 M-9). A detail that cannot be converted to text is stored as empty text, and the stop is still kept.
test('a stop detail that cannot be converted to text is stored as empty text, and the stop is kept (F-32)', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  const unconvertible = Object.create(null);
  assert.doesNotThrow(() => guard.stop('AUTH_EXPIRED', unconvertible));
  assert.equal(guard.stopStatus().detail, '');
  assert.equal(guard.stopStatus().kind, 'AUTH_EXPIRED');
  assert.equal(guardOver(await createState({ file: file.state }), file).stopStatus().kind, 'AUTH_EXPIRED');
});

// P4 review I-1. STATE_CORRUPT and STATE_LOST rank above RATE_LIMITED, so a rate limit observed later does not replace them, and the
// stop is still there after a restart.
test('a stored STATE_CORRUPT or STATE_LOST stays when RATE_LIMITED is observed, and after a restart', async (t) => {
  for (const kind of ['STATE_CORRUPT', 'STATE_LOST']) {
    const file = paths(t);
    const guard = guardOver(await createState({ file: file.state }), file);
    guard.stop(kind, 'damaged state');
    guard.stop('RATE_LIMITED', 'code 4');
    assert.equal(guard.stopStatus().kind, kind, kind);
    const restarted = guardOver(await createState({ file: file.state }), file);
    assert.equal(restarted.stopStatus().kind, kind, `${kind} after a restart`);
  }
});

// P4 final N-7. The state stops and the account stops share rank 3, above RATE_LIMITED (rank 2). A stored CHECKPOINT is not replaced
// by a lower rate limit, and a stored STATE_CORRUPT is not replaced by a CHECKPOINT of equal rank: the first stop is kept.
test('a stored CHECKPOINT is not replaced by a rate limit, and a stored STATE_CORRUPT is kept against an equal-rank CHECKPOINT (N-7)', async (t) => {
  const first = paths(t);
  const checkpoint = guardOver(await createState({ file: first.state }), first);
  checkpoint.stop('CHECKPOINT', 'checkpoint required');
  checkpoint.stop('RATE_LIMITED', 'code 4');
  assert.equal(checkpoint.stopStatus().kind, 'CHECKPOINT', 'the lower rate limit does not replace it');

  const second = paths(t);
  const corrupt = guardOver(await createState({ file: second.state }), second);
  corrupt.stop('STATE_CORRUPT', 'state file unreadable');
  corrupt.stop('CHECKPOINT', 'checkpoint required');
  assert.equal(corrupt.stopStatus().kind, 'STATE_CORRUPT', 'an equal rank keeps the stored stop');
  assert.equal(corrupt.stopStatus().detail, 'state file unreadable', 'and its detail');
});

// P4 final N-7. The state stops rank with the account stops, so they are equal to each other and above RATE_LIMITED.
test('STATE_LOST and STATE_CORRUPT rank with the account stops, above RATE_LIMITED (N-7)', async (t) => {
  for (const state of ['STATE_LOST', 'STATE_CORRUPT']) {
    const file = paths(t);
    const guard = guardOver(await createState({ file: file.state }), file);
    guard.stop(state, 'damaged state');
    guard.stop('AUTH_EXPIRED', 'code 190');
    assert.equal(guard.stopStatus().kind, state, `${state} is kept against an equal-rank AUTH_EXPIRED`);
  }
});

// P4 fix round 2, N-13. Every observed stop is stored: a RATE_LIMITED then a CHECKPOINT are both held. The active stop is the CHECKPOINT
// (the higher rank). The status shows the list. A confirmed clear removes both, on disk and after a restart.
test('a RATE_LIMITED then a CHECKPOINT are both stored; the active kind is CHECKPOINT; the clear removes both (N-13)', async (t) => {
  const file = paths(t);
  const guard = guardOver(await createState({ file: file.state }), file);
  guard.stop('RATE_LIMITED', 'code 4');
  const status = guard.stop('CHECKPOINT', 'checkpoint required');
  assert.equal(status.kind, 'CHECKPOINT');
  assert.deepStrictEqual(status.stops.map((entry) => [entry.kind, entry.rank]), [
    ['RATE_LIMITED', 2],
    ['CHECKPOINT', 3],
  ]);
  const onDisk = JSON.parse(readFileSync(file.state, 'utf8')).stop;
  assert.equal(onDisk.kind, 'CHECKPOINT');
  assert.equal(onDisk.stops.length, 2, 'both are on disk');

  const restarted = guardOver(await createState({ file: file.state }), file);
  assert.equal(restarted.stopStatus().kind, 'CHECKPOINT');
  assert.equal(restarted.stopStatus().stops.length, 2, 'both survive a restart');
  assert.equal(restarted.clearStop(true), 'cleared');
  assert.equal(restarted.stopStatus().stopped, false);
  assert.deepStrictEqual(restarted.stopStatus().stops, []);

  const afterClear = guardOver(await createState({ file: file.state }), file);
  assert.equal(afterClear.stopStatus().stopped, false);
  assert.deepStrictEqual(JSON.parse(readFileSync(file.state, 'utf8')).stop.stops, [], 'the clear removed both on disk');
});

// P4 fix round 2, N-13. A record of the older shape, with no list, is read as a list of its one stop.
test('a stored record of the older shape, with no list, is read as a list of its one stop (N-13)', async (t) => {
  const file = paths(t);
  writeFileSync(file.state, JSON.stringify({ stop: { stopped: true, kind: 'CHECKPOINT', detail: 'checkpoint', since: new Date(START).toISOString() } }));
  const guard = guardOver(await createState({ file: file.state }), file);
  assert.equal(guard.stopStatus().kind, 'CHECKPOINT');
  assert.deepStrictEqual(guard.stopStatus().stops.map((entry) => entry.kind), ['CHECKPOINT']);
});

// P4 fix round 2, N-13. A stored list whose top-level stop is not its active entry is damage, so the guard starts stopped with STATE_CORRUPT.
test('a stored list whose top-level stop is not its active entry is read as damage, and STATE_CORRUPT starts the guard (N-13)', async (t) => {
  const file = paths(t);
  const since = new Date(START).toISOString();
  const stops = [
    { kind: 'RATE_LIMITED', detail: 'code 4', since, rank: 2 },
    { kind: 'CHECKPOINT', detail: 'checkpoint', since, rank: 3 },
  ];
  writeFileSync(file.state, JSON.stringify({ stop: { stopped: true, kind: 'RATE_LIMITED', detail: 'code 4', since, stops } }));
  const guard = guardOver(await createState({ file: file.state }), file);
  assert.equal(guard.stopStatus().kind, 'STATE_CORRUPT');
});
