import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createEventLog } from '../src/events.js';
import { checkId } from '../src/graph/endpoints/common.js';
import { registerSecret } from '../src/redact.js';
import { createState } from '../src/state.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-20T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
// A cursor written out by hand from the documented format: base64url of 'c' followed by the seq.
const cursorFor = (seq) => Buffer.from(`c${seq}`).toString('base64url');

// A temporary directory that is removed when the test ends.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-events-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A new event file and a loaded state. No event log is built yet.
async function freshFiles(t) {
  const dir = tempDir(t);
  const file = join(dir, 'events.jsonl');
  const stateFile = join(dir, 'state.json');
  const state = await createState({ file: stateFile });
  return { file, stateFile, state };
}

// A new event log over a new state, with a clock that the test controls.
async function setup(t, { retentionDays = 30 } = {}) {
  const { file, stateFile, state } = await freshFiles(t);
  const clock = { now: T0 };
  const log = createEventLog({ file, state, retentionDays, now: () => clock.now });
  return { file, stateFile, state, log, clock };
}

function message(id, senderId = 'sender-a', text = `hello ${id}`) {
  return { id, kind: 'message', senderId, text };
}

test('append assigns increasing seq, and pending returns events after the acked position', async (t) => {
  const { log } = await setup(t);
  assert.equal(log.append(message('m1')).seq, 1);
  assert.equal(log.append(message('m2')).seq, 2);
  assert.equal(log.append(message('m3')).seq, 3);
  const first = log.pending({ limit: 2 });
  assert.deepStrictEqual(first.events.map((event) => event.seq), [1, 2]);
  log.ack(first.nextCursor);
  assert.deepStrictEqual(log.pending({ limit: 10 }).events.map((event) => event.id), ['m3']);
});

test('a stored event has the documented fields, and receivedAt defaults to the clock', async (t) => {
  const { log, clock } = await setup(t);
  clock.now = T0 + 1000;
  log.append(message('m1'));
  assert.deepStrictEqual(log.pending({ limit: 10 }).events, [
    {
      seq: 1,
      id: 'm1',
      kind: 'message',
      senderId: 'sender-a',
      text: 'hello m1',
      receivedAt: '2026-10-20T12:00:01.000Z',
      status: 'new',
      decision: null,
      untrusted: true,
    },
  ]);
});

test('ack refuses an unissued cursor', async (t) => {
  const { log, state } = await setup(t);
  for (const id of ['m1', 'm2', 'm3']) log.append(message(id));
  log.pending({ limit: 2 });
  assert.throws(() => log.ack(cursorFor(3)), { kind: 'VALIDATION' });
  assert.equal(state.get('events.acked', 0), 0);
  log.ack(cursorFor(2));
  assert.equal(state.get('events.acked'), 2);
});

test('ack never moves backwards', async (t) => {
  const { log, state } = await setup(t);
  for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) log.append(message(id));
  log.pending({ limit: 5 });
  log.ack(cursorFor(5));
  log.ack(cursorFor(3));
  assert.equal(state.get('events.acked'), 5);
});

test('pending never lowers events.issued', async (t) => {
  const { log, state } = await setup(t);
  for (const id of ['m1', 'm2', 'm3']) log.append(message(id));
  log.pending({ limit: 3 });
  log.pending({ limit: 1 });
  assert.equal(state.get('events.issued'), 3);
  log.ack(cursorFor(3));
  assert.equal(state.get('events.acked'), 3);
});

test('ack and pending refuse a malformed cursor or limit', async (t) => {
  const { log } = await setup(t);
  for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) log.append(message(id));
  log.pending({ limit: 5 });
  // 'YzV' names seq 5, which is issued, so only the check on its exact encoding can refuse it.
  const cursors = [
    '',
    'not base64!',
    cursorFor(0),
    'YzU=',
    'YzV',
    Buffer.from('c05').toString('base64url'),
    Buffer.from('x1').toString('base64url'),
    Buffer.from('c9007199254740993').toString('base64url'),
    5,
    null,
  ];
  for (const cursor of cursors) assert.throws(() => log.ack(cursor), { kind: 'VALIDATION' }, String(cursor));
  for (const limit of [0, -1, 1.5, '5', null]) {
    assert.throws(() => log.pending({ limit }), { kind: 'VALIDATION' }, String(limit));
  }
  assert.doesNotThrow(() => log.ack(cursorFor(5)));
});

test('truncated last JSONL line is skipped and the rest is kept', async (t) => {
  const { file, log } = await setup(t);
  log.append(message('m1', 'sender-a'));
  log.append(message('m2', 'sender-b'));
  appendFileSync(file, '{"seq":3,"id":"m3","senderId":"sender-c","kind":"mes');
  assert.deepStrictEqual(log.pending({ limit: 10 }).events.map((event) => event.id), ['m1', 'm2']);
  assert.equal(log.hasId('m3', 'message'), false);
  assert.equal(log.lastInboundAt('sender-c'), null);
  assert.notEqual(log.lastInboundAt('sender-b'), null);
});

test('append after a torn last line keeps the new event on its own line', async (t) => {
  const { file, log } = await setup(t);
  log.append(message('m1'));
  appendFileSync(file, '{"seq":2,"id":"torn"');
  assert.equal(log.append(message('m2')).seq, 2);
  assert.deepStrictEqual(
    log.pending({ limit: 10 }).events.map((event) => [event.seq, event.id]),
    [
      [1, 'm1'],
      [2, 'm2'],
    ],
  );
  assert.equal(readFileSync(file, 'utf8').includes('torn'), false);
});

test('a complete last line without a newline is kept, and the next append starts a new line', async (t) => {
  const { file, log } = await setup(t);
  log.append(message('m1'));
  writeFileSync(file, readFileSync(file, 'utf8').trimEnd());
  assert.deepStrictEqual(log.pending({ limit: 10 }).events.map((event) => event.id), ['m1']);
  assert.equal(log.append(message('m2')).seq, 2);
  assert.deepStrictEqual(log.pending({ limit: 10 }).events.map((event) => event.id), ['m1', 'm2']);
});

test('a damaged terminated line is refused, even when it is the last line', async (t) => {
  const { file, state, log } = await setup(t);
  log.append(message('m1'));
  appendFileSync(file, 'this is not json\n');
  assert.throws(() => log.pending({ limit: 10 }), { kind: 'CONFIG' });
  assert.throws(() => log.append(message('m2')), { kind: 'CONFIG' });
  assert.throws(() => createEventLog({ file, state, now: () => T0 }), { kind: 'CONFIG' });
  assert.equal(readFileSync(file, 'utf8').includes('m2'), false);
});

// Task 3 M-1: a damaged line followed by a valid line is refused too, not skipped.
test('a damaged line followed by a valid line is refused, not skipped', async (t) => {
  const { file, log } = await setup(t);
  log.append(message('m1'));
  const firstLine = readFileSync(file, 'utf8')
    .split('\n')
    .find((line) => line.includes('"m1"'));
  assert.ok(firstLine !== undefined, 'the stored line for m1 is found');
  appendFileSync(file, 'this is not json\n');
  appendFileSync(file, `${firstLine}\n`);
  assert.throws(() => log.pending({ limit: 10 }), { kind: 'CONFIG' });
});

test('hasId finds a stored id for dedupe', async (t) => {
  const { log } = await setup(t);
  log.append(message('m1'));
  assert.equal(log.hasId('m1', 'message'), true);
  assert.equal(log.hasId('m2', 'message'), false);
});

test('lastInboundAt returns the newest receivedAt for a sender', async (t) => {
  const { log } = await setup(t);
  log.append({ ...message('m1', 'sender-a'), receivedAt: '2026-10-20T10:00:00.000Z' });
  log.append({ ...message('m2', 'sender-b'), receivedAt: '2026-10-20T11:00:00.000Z' });
  log.append({ ...message('m3', 'sender-a'), receivedAt: '2026-10-20T09:00:00.000Z' });
  assert.equal(log.lastInboundAt('sender-a'), '2026-10-20T10:00:00.000Z');
  assert.equal(log.lastInboundAt('nobody'), null);
});

test('lastInboundAt with a kind counts only events of that kind', async (t) => {
  const { log } = await setup(t);
  log.append({ ...message('m1', 'sender-a'), receivedAt: '2026-10-20T10:00:00.000Z' });
  log.append({ id: 'c1', kind: 'comment', senderId: 'sender-a', text: 'nice', receivedAt: '2026-10-20T11:00:00.000Z' });
  assert.equal(log.lastInboundAt('sender-a'), '2026-10-20T11:00:00.000Z', 'with no kind, the newest event of any kind');
  assert.equal(log.lastInboundAt('sender-a', { kind: 'message' }), '2026-10-20T10:00:00.000Z');
  assert.equal(log.lastInboundAt('sender-a', { kind: 'comment' }), '2026-10-20T11:00:00.000Z');
  assert.equal(log.lastInboundAt('sender-a', { kind: 'mention' }), null);
  assert.throws(() => log.lastInboundAt('sender-a', { kind: 'bogus' }), { kind: 'VALIDATION' });
});

test('purge removes only handled events older than retentionDays', async (t) => {
  const { file, log } = await setup(t, { retentionDays: 30 });
  log.append({ ...message('old-undecided'), receivedAt: iso(T0 - 40 * DAY_MS) });
  log.append({ ...message('old-decided'), receivedAt: iso(T0 - 40 * DAY_MS) });
  // Exactly 30 days old is not older than 30 days, so it is kept.
  log.append({ ...message('edge-decided'), receivedAt: iso(T0 - 30 * DAY_MS) });
  log.append({ ...message('recent-decided'), receivedAt: iso(T0 - 1 * DAY_MS) });
  log.pending({ limit: 10 });
  log.ack(cursorFor(4));
  for (const id of ['old-decided', 'edge-decided', 'recent-decided']) log.decide(id, { action: 'ignore' });
  assert.deepStrictEqual(log.purge(), { removed: 1 });
  // Changed in P4 (A-6). Old assertion (removed): assert.equal(log.hasId('old-decided', 'message'), false). New assertion: a
  // purged event is still known for 90 days after it was received, so a redelivery of it is refused.
  assert.equal(log.hasId('old-decided', 'message'), true);
  assert.equal(log.hasId('old-undecided', 'message'), true);
  assert.equal(log.hasId('edge-decided', 'message'), true);
  assert.equal(log.hasId('recent-decided', 'message'), true);
  assert.equal(existsSync(`${file}.tmp`), false);
});

test('purge keeps a decided old event until it is acknowledged', async (t) => {
  const { log } = await setup(t);
  log.append({ ...message('m1'), receivedAt: iso(T0 - 40 * DAY_MS) });
  log.decide('m1', { action: 'ignore' });
  assert.deepStrictEqual(log.purge(), { removed: 0 });
  log.pending({ limit: 10 });
  log.ack(cursorFor(1));
  assert.deepStrictEqual(log.purge(), { removed: 1 });
  // Changed in P4 (A-6). Old assertion (removed): assert.equal(log.hasId('m1', 'message'), false). New assertion: the purged
  // event is still known for 90 days after it was received.
  assert.equal(log.hasId('m1', 'message'), true);
});

test('decide records the decision and does not change the cursor', async (t) => {
  const { log, state, clock } = await setup(t);
  log.append(message('m1'));
  log.append(message('m2'));
  log.pending({ limit: 2 });
  log.ack(cursorFor(1));
  const before = { issued: state.get('events.issued'), acked: state.get('events.acked') };
  clock.now = T0 + 5000;
  const decided = log.decide('m2', { action: 'reply', draft: 'Thanks!' });
  assert.equal(decided.status, 'handled');
  assert.equal(decided.text, 'hello m2');
  assert.deepStrictEqual(decided.decision, { action: 'reply', draft: 'Thanks!', at: '2026-10-20T12:00:05.000Z' });
  assert.deepStrictEqual({ issued: state.get('events.issued'), acked: state.get('events.acked') }, before);
  // The decision is stored, not only returned.
  const [stored] = log.pending({ limit: 10 }).events;
  assert.equal(stored.id, 'm2');
  assert.equal(stored.status, 'handled');
  assert.deepStrictEqual(stored.decision, { action: 'reply', draft: 'Thanks!', at: '2026-10-20T12:00:05.000Z' });
});

test('decide refuses an unknown id, an unknown action and a non-text draft', async (t) => {
  const { log } = await setup(t);
  log.append(message('m1'));
  assert.throws(() => log.decide('nope', { action: 'ignore' }), { kind: 'VALIDATION' });
  assert.throws(() => log.decide('m1', { action: 'send' }), { kind: 'VALIDATION' });
  assert.throws(() => log.decide('m1', { action: 'reply', draft: 5 }), { kind: 'VALIDATION' });
  assert.throws(() => log.decide('m1'), { kind: 'VALIDATION' });
});

test('markRead moves the sender out of unreadSenders', async (t) => {
  const { log } = await setup(t);
  log.append(message('m1', 'sender-a'));
  log.append(message('m2', 'sender-b'));
  log.append(message('m3', 'sender-a'));
  assert.deepStrictEqual(log.unreadSenders().sort(), ['sender-a', 'sender-b']);
  log.markRead('sender-a');
  assert.deepStrictEqual(log.unreadSenders(), ['sender-b']);
  log.append(message('m4', 'sender-a'));
  assert.deepStrictEqual(log.unreadSenders().sort(), ['sender-a', 'sender-b']);
});

// Added in fix round 2 (I-1). Date.parse rolls an impossible day forward, so the day is checked before the value is used.
test('append refuses a calendar day that does not exist, and accepts a leap day', async (t) => {
  const { log, clock } = await setup(t);
  for (const receivedAt of ['2026-02-30T12:00:00+00:00', '2026-09-31T12:00:00+00:00', '2026-02-29T12:00:00+00:00']) {
    assert.throws(
      () => log.append({ ...message('m-impossible'), receivedAt }),
      (error) => error.kind === 'VALIDATION',
      receivedAt,
    );
  }
  assert.equal(log.hasId('m-impossible', 'message'), false, 'nothing is stored for an impossible day');
  // 2028 is a leap year, so 29 February exists and is stored as the time that was sent. The clock is moved there, so
  // that the time is not refused as too far in the future.
  clock.now = Date.parse('2028-03-01T00:00:00.000Z');
  const stored = log.append({ ...message('m-leap'), receivedAt: '2028-02-29T12:00:00+00:00' });
  assert.equal(stored.receivedAt, '2028-02-29T12:00:00.000Z');
});

// Added in fix round 4 (N-1). A day of 00, a month outside 1 to 12, and a day past the end of its month are all refused.
test('append refuses a day of 00, a month outside 1 to 12, and a day past the end of its month', async (t) => {
  const { log, clock } = await setup(t);
  for (const receivedAt of [
    '2026-02-00T12:00:00+00:00',
    '2026-00-15T12:00:00+00:00',
    '2026-13-15T12:00:00+00:00',
    '2026-04-31T12:00:00+00:00',
    '2026-02-29T12:00:00+00:00',
  ]) {
    assert.throws(
      () => log.append({ ...message('m-bad'), receivedAt }),
      (error) => error.kind === 'VALIDATION',
      receivedAt,
    );
  }
  assert.equal(log.hasId('m-bad', 'message'), false, 'nothing is stored for an impossible date');
  clock.now = Date.parse('2028-03-01T00:00:00.000Z');
  const stored = log.append({ ...message('m-leap'), receivedAt: '2028-02-29T12:00:00+00:00' });
  assert.equal(stored.receivedAt, '2028-02-29T12:00:00.000Z');
});

test('append refuses an invalid event and a repeated id', async (t) => {
  const { log } = await setup(t);
  log.append(message('m1'));
  const invalid = [
    { ...message('m2'), kind: 'post' },
    { ...message('m2'), text: 42 },
    { ...message('m2'), id: '' },
    { ...message('m2'), senderId: undefined },
    { ...message('m2'), receivedAt: 'yesterday' },
    { ...message('m2'), receivedAt: iso(T0 + 10 * 60 * 1000) },
    message('m1'),
  ];
  for (const event of invalid) assert.throws(() => log.append(event), { kind: 'VALIDATION' });
  // A received time a few minutes ahead is allowed, for clock skew.
  assert.equal(log.append({ ...message('m3'), receivedAt: iso(T0 + 2 * 60 * 1000) }).seq, 2);
  assert.deepStrictEqual(log.pending({ limit: 10 }).events.map((event) => event.id), ['m1', 'm3']);
});

test('a stored value that is out of range or of the wrong type is rejected, not coerced', async (t) => {
  const refused = [
    ['events.acked', '2'],
    ['events.issued', null],
    ['events.acked', -1],
    ['events.issued', 1.5],
    ['events.issued', Number.MAX_SAFE_INTEGER + 2],
  ];
  for (const [key, value] of refused) {
    const { file, state } = await freshFiles(t);
    state.set(key, value);
    assert.throws(() => createEventLog({ file, state, now: () => T0 }), { kind: 'CONFIG' }, key);
  }
  const ahead = await freshFiles(t);
  ahead.state.set('events.issued', 2);
  ahead.state.set('events.acked', 3);
  assert.throws(() => createEventLog({ file: ahead.file, state: ahead.state, now: () => T0 }), { kind: 'CONFIG' });
  const sound = await freshFiles(t);
  sound.state.set('events.issued', 3);
  sound.state.set('events.acked', 3);
  assert.doesNotThrow(() => createEventLog({ file: sound.file, state: sound.state, now: () => T0 }));
  const { log, state } = await setup(t);
  log.append(message('m1'));
  state.set('dm.read.sender-a', -1);
  assert.throws(() => log.unreadSenders(), { kind: 'CONFIG' });
});

test('pending returns redacted text, and the file keeps inbound text as written', async (t) => {
  const { file, log } = await setup(t);
  log.append(message('m1', 'sender-a', "Can we talk at 5? It's fine. access_token=EAAB-live-token-0001"));
  const [event] = log.pending({ limit: 10 }).events;
  assert.equal(event.text.includes('EAAB-live-token-0001'), false);
  assert.equal(event.text, "Can we talk at 5? It's fine. access_token=[redacted]");
  assert.equal(readFileSync(file, 'utf8').includes("Can we talk at 5? It's fine."), true);
});

test('pending masks a registered secret that appears in event text', async (t) => {
  registerSecret('EAAB-events-registered-0002');
  const { log } = await setup(t);
  log.append(message('m1', 'sender-a', 'my token is EAAB-events-registered-0002'));
  assert.equal(log.pending({ limit: 10 }).events[0].text, 'my token is [redacted]');
});

test('bad constructor arguments are refused with TypeError', async (t) => {
  const { file, state } = await freshFiles(t);
  assert.throws(() => createEventLog({ state, now: () => T0 }), TypeError);
  assert.throws(() => createEventLog({ file, now: () => T0 }), TypeError);
  assert.throws(() => createEventLog({ file, state, retentionDays: 0, now: () => T0 }), TypeError);
  assert.throws(() => createEventLog({ file, state, now: 'later' }), TypeError);
});

test('a failed save leaves memory equal to disk for ack, pending and markRead', async (t) => {
  const { stateFile, state, log } = await setup(t);
  for (const id of ['m1', 'm2', 'm3']) log.append(message(id));
  // A save fails while its temporary file cannot be created. The block makes that happen, and unblock lifts it.
  const block = () => mkdirSync(`${stateFile}.tmp`);
  const unblock = () => rmSync(`${stateFile}.tmp`, { recursive: true, force: true });
  // Loads the state from disk, and checks that memory holds the same value as the disk for each key.
  const assertMatchesDisk = async (keys) => {
    const onDisk = await createState({ file: stateFile });
    for (const key of keys) assert.deepStrictEqual(state.get(key), onDisk.get(key), key);
  };

  block();
  assert.throws(() => log.pending({ limit: 3 }));
  await assertMatchesDisk(['events.issued', 'events.acked']);
  unblock();

  assert.deepStrictEqual(log.pending({ limit: 3 }).events.map((event) => event.id), ['m1', 'm2', 'm3']);
  block();
  assert.throws(() => log.ack(cursorFor(2)));
  await assertMatchesDisk(['events.issued', 'events.acked']);
  unblock();
  // The failed ack left acked at 0, so no event is skipped.
  assert.deepStrictEqual(log.pending({ limit: 10 }).events.map((event) => event.id), ['m1', 'm2', 'm3']);

  block();
  assert.throws(() => log.markRead('sender-a'));
  await assertMatchesDisk(['dm.read.sender-a']);
  unblock();
  assert.deepStrictEqual(log.unreadSenders(), ['sender-a']);
});

test('cursors and read markers survive a new event log over the same files', async (t) => {
  const { file, stateFile, log } = await setup(t);
  log.append(message('m1', 'sender-a'));
  log.append(message('m2', 'sender-b'));
  log.append(message('m3', 'sender-a'));
  log.pending({ limit: 3 });
  log.ack(cursorFor(2));
  log.markRead('sender-a');
  const reopened = createEventLog({ file, state: await createState({ file: stateFile }), now: () => T0 });
  assert.deepStrictEqual(reopened.pending({ limit: 10 }).events.map((event) => event.id), ['m3']);
  assert.deepStrictEqual(reopened.unreadSenders(), ['sender-b']);
});

test('after a state loss the next seq is above every purged seq', async (t) => {
  const { file, stateFile, state, log } = await setup(t);
  for (const id of ['m1', 'm2', 'm3']) log.append({ ...message(id), receivedAt: iso(T0 - 40 * DAY_MS) });
  log.pending({ limit: 3 });
  log.ack(cursorFor(3));
  for (const id of ['m1', 'm2', 'm3']) log.decide(id, { action: 'ignore' });
  assert.equal(state.get('events.lastSeq'), 3);
  assert.deepStrictEqual(log.purge(), { removed: 3 });
  // The state file is lost, and events.lastSeq with it. The events file alone must stop a seq from being reused.
  rmSync(stateFile);
  const reopened = createEventLog({ file, state: await createState({ file: stateFile }), now: () => T0 });
  assert.equal(reopened.append(message('m4')).seq, 4);
});

test('the next seq is above the saved events.lastSeq', async (t) => {
  const { state, log } = await setup(t);
  // The events file holds no event with seq 5, but the state records that seq 5 was assigned.
  state.set('events.lastSeq', 5);
  state.save();
  assert.equal(log.append(message('m1')).seq, 6);
});

test('a registered secret is masked in the stored line, and ordinary text is unchanged', async (t) => {
  registerSecret('EAAB-stored-line-0003');
  const { file, log } = await setup(t);
  log.append(message('m1', 'sender-a', 'token EAAB-stored-line-0003 here'));
  log.append(message('m2', 'sender-a', 'Can we talk at 5?'));
  const stored = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(stored[0].text, 'token [redacted] here');
  assert.equal(stored[1].text, 'Can we talk at 5?');
  assert.equal(readFileSync(file, 'utf8').includes('EAAB-stored-line-0003'), false);
});

test('a registered secret in a draft is masked in the stored line; ordinary draft text is unchanged', async (t) => {
  registerSecret('EAAB-draft-line-0004');
  const { file, log } = await setup(t);
  log.append(message('m1'));
  log.append(message('m2'));
  const masked = log.decide('m1', { action: 'reply', draft: 'Use EAAB-draft-line-0004 today' });
  log.decide('m2', { action: 'reply', draft: 'Thanks, see you at 5.' });
  assert.equal(masked.decision.draft, 'Use [redacted] today');
  // A header line may come first after a rewrite, so only the lines that hold an event are read.
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const stored = lines.filter((line) => 'id' in line);
  assert.equal(stored[0].decision.draft, 'Use [redacted] today');
  assert.equal(stored[1].decision.draft, 'Thanks, see you at 5.');
  assert.equal(readFileSync(file, 'utf8').includes('EAAB-draft-line-0004'), false);
});

// A file system that wraps node:fs. Each call is recorded in calls with the path it touched: a file descriptor is mapped back to
// the path it was opened on. A hook may throw for a call, and it is given the call name and the path. It is passed to
// createEventLog, so the tests can count reads, record the order of the calls, and make a call fail (P4).
function wrappedFs({ fail = null, calls = [] } = {}) {
  const fs = { ...nodeFs };
  const fdPath = new Map();
  const record = (name, path) => {
    calls.push({ name, path });
    const error = fail?.(name, path);
    if (error) throw error;
  };
  fs.openSync = (path, ...rest) => {
    record('openSync', path);
    const fd = nodeFs.openSync(path, ...rest);
    fdPath.set(fd, path);
    return fd;
  };
  fs.writeFileSync = (target, ...rest) => {
    const path = typeof target === 'number' ? fdPath.get(target) : target;
    record('writeFileSync', path);
    return nodeFs.writeFileSync(target, ...rest);
  };
  fs.fsyncSync = (fd) => {
    record('fsyncSync', fdPath.get(fd));
    return nodeFs.fsyncSync(fd);
  };
  fs.closeSync = (fd) => {
    record('closeSync', fdPath.get(fd));
    fdPath.delete(fd);
    return nodeFs.closeSync(fd);
  };
  for (const name of ['readFileSync', 'existsSync']) {
    fs[name] = (path, ...rest) => {
      record(name, path);
      return nodeFs[name](path, ...rest);
    };
  }
  return { fs, calls };
}

// Changed in P4 (A-6). A purged event is still refused as a duplicate on a redelivery within 90 days. After 91 days it is
// new again. The limit is 90 days from when the event was received, which is longer than the 30-day retention.
test('a purged event redelivered after 31 days is not stored again; after 91 days it is treated as new', async (t) => {
  const { log, clock, file } = await setup(t, { retentionDays: 30 });
  log.append({ ...message('m1'), receivedAt: iso(T0) });
  log.pending({ limit: 10 });
  log.ack(cursorFor(1));
  log.decide('m1', { action: 'ignore' });
  clock.now = T0 + 31 * DAY_MS;
  assert.deepStrictEqual(log.purge(), { removed: 1 });
  assert.equal(log.pending({ limit: 10 }).events.length, 0, 'the event is gone from the file');
  // A redelivery after 31 days is a duplicate: it is not stored again.
  assert.equal(log.hasId('m1', 'message'), true);
  assert.throws(() => log.append({ ...message('m1'), receivedAt: iso(T0) }), (error) => error.kind === 'VALIDATION');
  assert.equal(log.pending({ limit: 10 }).events.length, 0);
  // After 91 days from receipt, the key has been pruned, so the same id is new and is stored.
  clock.now = T0 + 91 * DAY_MS;
  assert.equal(log.hasId('m1', 'message'), false);
  const stored = log.append({ ...message('m1'), receivedAt: iso(clock.now) });
  assert.equal(stored.id, 'm1');
  assert.equal(readFileSync(file, 'utf8').includes('"id":"m1"'), true);
});

// Changed in P4 (A-9). hasId reads memory only: the event file is read once at start, and not on each call.
test('hasId does not read the event file on each call', async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'events.jsonl');
  const state = await createState({ file: join(dir, 'state.json') });
  const { fs, calls } = wrappedFs();
  const log = createEventLog({ file, state, now: () => T0, fs });
  log.append(message('m1'));
  calls.length = 0;
  for (let i = 0; i < 50; i += 1) log.hasId(i % 2 === 0 ? 'm1' : 'missing', 'message');
  assert.equal(calls.filter((call) => call.path === file).length, 0, 'no call touches the event file');
});

// Added in P4 (A-5). A file-system error becomes an IgError with a fixed kind. The message names the operation and the code,
// and it does not name the path.
test('a file-system error from the event file becomes an IgError that names the operation, not the path', async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'events.jsonl');
  const state = await createState({ file: join(dir, 'state.json') });
  const denied = Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' });
  const { fs } = wrappedFs({ fail: (name, path) => (name === 'openSync' && path === file ? denied : null) });
  const log = createEventLog({ file, state, now: () => T0, fs });
  let caught = null;
  try {
    log.append(message('m1'));
  } catch (error) {
    caught = error;
  }
  assert.ok(caught !== null);
  assert.equal(caught.name, 'IgError');
  assert.equal(caught.kind, 'CONFIG');
  assert.match(caught.message, /appended to/);
  assert.match(caught.message, /EACCES/);
  assert.equal(caught.message.includes(file), false, 'the message does not name the path');
  assert.equal(caught.message.includes(dir), false);
});

// Added in P4 (A-7). Append flushes the event to disk before it returns: fsync is called after the write and before close.
test('append calls fsync before it returns', async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'events.jsonl');
  const state = await createState({ file: join(dir, 'state.json') });
  const { fs, calls } = wrappedFs();
  const log = createEventLog({ file, state, now: () => T0, fs });
  log.append(message('m1'));
  const order = calls.filter((call) => call.path === file).map((call) => call.name);
  const open = order.indexOf('openSync');
  const fsync = order.indexOf('fsyncSync', open);
  const close = order.indexOf('closeSync', open);
  assert.ok(open !== -1 && fsync > open && close > fsync, `order was ${order.join(', ')}`);
});

// Changed in the P4 fix (item 3). The stored id of a comment or a mention carries its kind, so the two events with one raw id have
// two distinct ids, and a decision on one does not reach the other. Old assertions (removed): the two ids were both 'x1', and
// decide('x1') was refused as ambiguous. New assertions below. The cursor format is unchanged.
test('a comment and a mention with the same raw id are two events with distinct ids, and decide on one does not change the other', async (t) => {
  const { log } = await setup(t);
  log.append({ id: 'x1', kind: 'comment', senderId: 'u1', text: 'nice' });
  log.append({ id: 'x1', kind: 'mention', senderId: 'u1', text: 'hi' });
  const [comment, mention] = log.pending({ limit: 10 }).events;
  assert.deepEqual([comment.kind, comment.id, mention.kind, mention.id], ['comment', 'comment:x1', 'mention', 'mention:x1']);
  assert.throws(() => log.append({ id: 'x1', kind: 'comment', senderId: 'u1', text: 'again' }), (error) => error.kind === 'VALIDATION');
  assert.equal(log.hasId('x1', 'comment'), true);
  assert.equal(log.hasId('x1', 'mention'), true);
  assert.equal(log.hasId('x1', 'unknown'), false);
  // The raw id names no stored event now, so it is refused, not chosen between.
  assert.throws(() => log.decide('x1', { action: 'ignore' }), (error) => error.kind === 'VALIDATION');
  log.decide('comment:x1', { action: 'ignore' });
  const after = log.pending({ limit: 10 }).events;
  assert.deepEqual(after.map((e) => [e.id, e.status]), [
    ['comment:x1', 'handled'],
    ['mention:x1', 'new'],
  ]);
});

// Changed in the P4 fix (item 2). A damaged dedupe index is not trusted. The index is quarantined under a numbered name and rebuilt
// from the event file, and the rebuild is queued as a notice for the audit log. An id that is still in the event file is refused as a
// duplicate. Old assertions (removed): a damaged line was skipped, and the other keys were kept, so hasId('kept') and hasId('also')
// were true. New assertions: the damaged index is quarantined, the notice is queued once, and only the event file's ids are known.
test('a damaged dedupe index is quarantined and rebuilt from the event file, the rebuild is recorded, and an id still in the event file is refused', async (t) => {
  const { log: first, file, state } = await setup(t);
  first.append(message('m1'));
  const indexFile = join(dirname(file), 'event-ids.jsonl');
  appendFileSync(indexFile, 'not a key line at all\n');
  const log = createEventLog({ file, state, now: () => T0 });
  assert.equal(existsSync(`${indexFile}.corrupt`), true, 'the damaged index is kept as a copy');
  // Changed in the P4 review fix (M-2, M-3). Old assertions (removed): log.takeNotices() returned the notice and emptied the queue;
  // detail.keys was 1. New: the notices are drained through a write callback, and the detail counts the keys the rebuild kept from the
  // valid lines (1, the m1 line) and from the event file (0, m1 is already known).
  const notices = [];
  log.drainNotices((notice) => notices.push(notice));
  assert.equal(notices.length, 1);
  assert.deepEqual([notices[0].action, notices[0].outcome], ['events.index', 'rebuilt']);
  assert.equal(notices[0].detail.quarantined, 'event-ids.jsonl.corrupt');
  assert.deepEqual([notices[0].detail.keysFromIndex, notices[0].detail.keysFromFile], [1, 0]);
  log.drainNotices((notice) => notices.push(notice));
  assert.equal(notices.length, 1, 'a notice is written once');
  assert.equal(log.hasId('m1', 'message'), true, 'an id still in the event file is refused as a duplicate');
  assert.throws(() => log.append(message('m1')), (error) => error.kind === 'VALIDATION');
  assert.equal(log.pending({ limit: 10 }).events.length, 1);
  assert.equal(readFileSync(indexFile, 'utf8').includes('not a key line'), false, 'the rebuilt index holds no damaged line');
});

// P4 review I-3. A repaired event cursor never re-delivers an event that was acked: the repair raises events.issued and keeps events.acked.
test('a repaired cursor never re-delivers an event that was acked', async (t) => {
  const { log, file, stateFile } = await setup(t);
  for (let i = 1; i <= 9; i += 1) log.append(message(`m${i}`));
  log.ack(log.pending({ limit: 20 }).nextCursor);
  const onDisk = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(onDisk['events.acked'], 9);
  onDisk['events.issued'] = 2;
  writeFileSync(stateFile, JSON.stringify(onDisk));
  const repaired = await createState({ file: stateFile });
  assert.equal(repaired.get('events.issued', undefined), 9);
  assert.equal(repaired.get('events.acked', undefined), 9);
  const reopened = createEventLog({ file, state: repaired, now: () => T0 });
  assert.deepEqual(reopened.pending({ limit: 20 }).events, [], 'no acked event is delivered again');
});

// P4 review M-3. The rebuild keeps the valid lines of a damaged index, with their receipt times, so an id purged 40 days ago is still
// refused.
test('a rebuild keeps the valid lines of a damaged index, so an id purged 40 days ago is still refused', async (t) => {
  const { file, state } = await setup(t);
  const indexFile = join(dirname(file), 'event-ids.jsonl');
  writeFileSync(indexFile, `${JSON.stringify({ key: 'message:old-purged', at: iso(T0 - 40 * DAY_MS) })}\nnot a key line\n`);
  const log = createEventLog({ file, state, now: () => T0 });
  const notices = [];
  log.drainNotices((notice) => notices.push(notice));
  assert.deepEqual([notices[0].detail.keysFromIndex, notices[0].detail.keysFromFile], [1, 0]);
  assert.equal(log.hasId('old-purged', 'message'), true);
});

// P4 review M-8. A missing index, with events in the event file, is rebuilt from the event file, and the rebuild is recorded.
test('a missing dedupe index with events in the event file is rebuilt from the event file, and the rebuild is recorded', async (t) => {
  const { log: first, file, state } = await setup(t);
  first.append(message('m1'));
  const indexFile = join(dirname(file), 'event-ids.jsonl');
  rmSync(indexFile);
  const log = createEventLog({ file, state, now: () => T0 });
  const notices = [];
  log.drainNotices((notice) => notices.push(notice));
  assert.equal(notices[0].detail.reason, 'index missing');
  assert.deepEqual([notices[0].detail.keysFromIndex, notices[0].detail.keysFromFile], [0, 1]);
  assert.equal(log.hasId('m1', 'message'), true);
  assert.equal(existsSync(indexFile), true, 'the index is written again');
});

// P4 review M-2, at the event log. A notice whose write fails stays queued.
test('an event-log notice whose write fails stays queued for the next drain', async (t) => {
  const { log: first, file, state } = await setup(t);
  first.append(message('m1'));
  appendFileSync(join(dirname(file), 'event-ids.jsonl'), 'damaged\n');
  const log = createEventLog({ file, state, now: () => T0 });
  assert.throws(() => log.drainNotices(() => {
    throw new Error('audit unavailable');
  }));
  const notices = [];
  log.drainNotices((notice) => notices.push(notice));
  assert.equal(notices.length, 1, 'the notice was not lost');
});

// P4 review I-5. A comment or a mention event carries its raw Graph id as targetId, and the comment tools take it.
test('a comment event carries its raw Graph id as targetId, which passes the digit check of the comment tools', async (t) => {
  const { log } = await setup(t);
  log.append({ id: '17870913679156914', kind: 'comment', senderId: 'u1', text: 'nice' });
  log.append({ id: '17870913679156914', kind: 'mention', senderId: 'u1', text: 'hi' });
  log.append(message('m1'));
  const [comment, mention, dm] = log.pending({ limit: 10 }).events;
  assert.equal(comment.id, 'comment:17870913679156914', 'the stored id is kind-qualified');
  assert.equal(comment.targetId, '17870913679156914');
  assert.equal(mention.targetId, '17870913679156914');
  assert.equal(dm.targetId, undefined, 'a message has no targetId');
  assert.doesNotThrow(() => checkId(comment.targetId, 'commentId'));
});

// P4 final N-1. An unreadable state, after acked 9, holds pending and ack, and the refusal names the state loss. A confirmed clear starts
// the cursors again: the next pending carries the notice, every event keeps the id it had, and the consumer dedupes by id.
test('an unreadable state with acked 9 holds pending and ack; the clear starts from zero with the notice; the event ids are the same as before', async (t) => {
  const { file, stateFile, state } = await freshFiles(t);
  const log = createEventLog({ file, state, now: () => T0 });
  for (let i = 1; i <= 9; i += 1) log.append(message(`m${i}`));
  const first = log.pending({ limit: 20 });
  log.ack(first.nextCursor);
  const idsBefore = first.events.map((event) => event.id);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8'))['events.acked'], 9);

  writeFileSync(stateFile, '{ not json');
  const damaged = await createState({ file: stateFile });
  assert.equal(damaged.unreadable, true);
  const isStopped = () => damaged.get('stop', null)?.stopped === true;
  const held = createEventLog({ file, state: damaged, now: () => T0, isStopped });
  assert.equal(held.cursorsUnknown(), true, 'the loss of the cursors is marked');
  assert.throws(
    () => held.pending({ limit: 20 }),
    (err) => err.kind === 'STOPPED' && /the state file was unreadable or missing/.test(err.message),
    'pending is refused with the state loss as the reason',
  );
  assert.throws(() => held.ack(first.nextCursor), (err) => err.kind === 'STOPPED');

  damaged.set('stop', { stopped: false, kind: null, detail: null, since: null });
  assert.throws(() => held.ack(first.nextCursor), (err) => err.kind === 'VALIDATION', 'an ack before the reset is refused');
  const cleared = held.pending({ limit: 20 });
  assert.deepEqual(cleared.events.map((event) => event.id), idsBefore, 'the event ids are the same as before');
  assert.equal(cleared.notice.kind, 'cursors_reset');
  assert.match(cleared.notice.note, /dedupe by id/);
  assert.equal(held.pending({ limit: 20 }).notice, undefined, 'the notice is carried once');
  held.ack(cleared.nextCursor);
  assert.equal(held.cursorsUnknown(), false);
  assert.deepEqual(held.pending({ limit: 20 }).events, [], 'nothing is delivered again after the ack');
  const notices = [];
  held.drainNotices((notice) => notices.push([notice.action, notice.outcome]));
  assert.deepEqual(notices, [['events.cursors', 'reset']], 'the reset is queued for the audit log');
});

// P4 final N-1 and the I-3 residual. A damaged acked position in the state holds pending and ack until the clear. It is not reset to zero
// while the stop holds, so no acked event is delivered before the owner clears the stop.
test('a damaged acked cursor holds pending and ack until the clear, and no acked event is delivered before it', async (t) => {
  const { file, stateFile, state } = await freshFiles(t);
  const log = createEventLog({ file, state, now: () => T0 });
  for (let i = 1; i <= 3; i += 1) log.append(message(`m${i}`));
  log.ack(log.pending({ limit: 20 }).nextCursor);
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  writeFileSync(stateFile, JSON.stringify({ ...saved, 'events.acked': '3' }));
  const damaged = await createState({ file: stateFile });
  const isStopped = () => damaged.get('stop', null)?.stopped === true;
  const held = createEventLog({ file, state: damaged, now: () => T0, isStopped });
  assert.equal(held.cursorsUnknown(), true);
  assert.throws(() => held.pending({ limit: 20 }), (err) => err.kind === 'STOPPED');
  damaged.set('stop', { stopped: false, kind: null, detail: null, since: null });
  const cleared = held.pending({ limit: 20 });
  assert.deepEqual(cleared.events.map((event) => event.id), ['m1', 'm2', 'm3'], 'the cursors start again after the clear');
  assert.equal(cleared.notice.reason, 'damaged event cursor');
});

// P4 final N-5. A zero-length dedupe index with events in the event file is rebuilt from the file, and the rebuild is reported in the
// same notice as a missing or damaged index, with the reason index empty. With no events, a zero-length index gives no notice.
test('a zero-length dedupe index with events in the event file gives the rebuild notice', async (t) => {
  const { file, state } = await freshFiles(t);
  const log = createEventLog({ file, state, now: () => T0 });
  log.append(message('m1'));
  writeFileSync(join(dirname(file), 'event-ids.jsonl'), '');
  const rebuilt = createEventLog({ file, state, now: () => T0 });
  const notices = [];
  rebuilt.drainNotices((notice) => notices.push(notice));
  assert.deepEqual(notices.map((notice) => [notice.action, notice.outcome, notice.detail.reason]), [
    ['events.index', 'rebuilt', 'index empty'],
  ]);
  assert.equal(rebuilt.hasId('m1', 'message'), true);
});

test('a zero-length dedupe index with an empty event file gives no notice', async (t) => {
  const { file, state } = await freshFiles(t);
  writeFileSync(join(dirname(file), 'event-ids.jsonl'), '');
  const log = createEventLog({ file, state, now: () => T0 });
  const notices = [];
  log.drainNotices((notice) => notices.push(notice));
  assert.deepEqual(notices, []);
});

// P4 fix round 2, N-11. A save that fails during the reset restores the last saved image, which still holds the marker. The reset is undone
// in memory, the call throws CONFIG, and nothing is delivered. The next pending repeats the reset, and carries the notice. The notice names
// the owner-decided exception to the rule that the cursors never move backwards (N-14).
test('a failed save during the reset delivers nothing, and the next pending repeats the reset with the notice (N-11, N-14)', async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'events.jsonl');
  const stateFile = join(dir, 'state.json');
  const seed = await createState({ file: stateFile });
  const writer = createEventLog({ file, state: seed, now: () => T0 });
  for (let i = 1; i <= 3; i += 1) writer.append(message(`m${i}`));
  // A readable state with a clear record and no cursor keys, over the event file that holds three events.
  writeFileSync(stateFile, JSON.stringify({ stop: { stopped: false, kind: null, detail: null, since: null, stops: [] } }));
  const failing = { on: false };
  const fsSwitch = {
    ...nodeFs,
    openSync: (path, flags, ...rest) => {
      if (failing.on && flags === 'w') throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      return nodeFs.openSync(path, flags, ...rest);
    },
  };
  const stopped = { value: false };
  const state = await createState({ file: stateFile, fs: fsSwitch });
  const log = createEventLog({ file, state, now: () => T0, isStopped: () => stopped.value });
  assert.equal(log.cursorsUnknown(), true);
  failing.on = true;
  assert.throws(() => log.pending({ limit: 20 }), (err) => err.kind === 'CONFIG', 'the reset is not saved, so the call throws');
  assert.equal(log.cursorsUnknown(), true, 'the hold is still in process');
  failing.on = false;
  const page = log.pending({ limit: 20 });
  assert.deepEqual(page.events.map((event) => event.id), ['m1', 'm2', 'm3'], 'the events are delivered once the reset is saved');
  assert.equal(page.notice.kind, 'cursors_reset');
  assert.match(page.notice.note, /owner-decided exception to the rule that the cursors never move backwards/);
  assert.equal(log.pending({ limit: 20 }).notice, undefined, 'the notice is carried once');
});

// P4 fix round 2, N-11. A marker save that fails at load is held in process, not dropped with the restored image. After the clear, the first
// pending starts the cursors again and carries the notice, and nothing is delivered before the clear.
test('a marker save that fails is held in process: nothing is delivered before the clear, and the first pending after it carries the notice (N-11)', async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'events.jsonl');
  const stateFile = join(dir, 'state.json');
  const seed = await createState({ file: stateFile });
  const writer = createEventLog({ file, state: seed, now: () => T0 });
  for (let i = 1; i <= 2; i += 1) writer.append(message(`m${i}`));
  writeFileSync(stateFile, JSON.stringify({ stop: { stopped: false, kind: null, detail: null, since: null, stops: [] } }));
  const failing = { on: true };
  const fsSwitch = {
    ...nodeFs,
    openSync: (path, flags, ...rest) => {
      if (failing.on && flags === 'w') throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      return nodeFs.openSync(path, flags, ...rest);
    },
  };
  const stopped = { value: true };
  const state = await createState({ file: stateFile, fs: fsSwitch });
  const log = createEventLog({ file, state, now: () => T0, isStopped: () => stopped.value });
  assert.equal(log.cursorsUnknown(), true, 'the marker is held although its save failed');
  assert.throws(() => log.pending({ limit: 20 }), (err) => err.kind === 'STOPPED', 'nothing is delivered while the stop holds');
  failing.on = false;
  stopped.value = false;
  const page = log.pending({ limit: 20 });
  assert.equal(page.notice.kind, 'cursors_reset', 'the notice is still given after the clear');
  assert.deepEqual(page.events.map((event) => event.id), ['m1', 'm2']);
});

// ---------- A-11 (2026-10-23): dedupe across a restart ----------

test('dedupe holds across a restart: a new event log over the same files refuses the same id', async (t) => {
  const { file, stateFile, log } = await setup(t);
  log.append(message('m1'));
  const reopened = createEventLog({ file, state: await createState({ file: stateFile }), now: () => T0 });
  assert.equal(reopened.hasId('m1', 'message'), true);
  assert.throws(() => reopened.append(message('m1')), { kind: 'VALIDATION' });
  assert.deepEqual(reopened.pending({ limit: 10 }).events.map((event) => event.id), ['m1'], 'the refused append stored nothing');
  assert.equal(readFileSync(file, 'utf8').split('\n').filter((line) => line.includes('"id":"m1"')).length, 1);
});

test('a purged event id is still refused after a restart, inside the dedupe window', async (t) => {
  const { file, stateFile, log } = await setup(t, { retentionDays: 30 });
  log.append(message('m1'));
  log.pending({ limit: 10 });
  log.ack(cursorFor(1));
  log.decide('m1', { action: 'ignore' });
  // Thirty-one days on, the purge removes the event from the event file. The dedupe index keeps its key for 90 days.
  const later = T0 + 31 * DAY_MS;
  const purging = createEventLog({ file, state: await createState({ file: stateFile }), retentionDays: 30, now: () => later });
  assert.deepEqual(purging.purge(), { removed: 1 });
  const restarted = createEventLog({
    file,
    state: await createState({ file: stateFile }),
    retentionDays: 30,
    now: () => later + DAY_MS,
  });
  assert.equal(restarted.hasId('m1', 'message'), true, 'the key is known after the restart');
  assert.throws(() => restarted.append(message('m1')), { kind: 'VALIDATION' });
  assert.deepEqual(restarted.pending({ limit: 10 }).events, [], 'nothing is redelivered');
});
