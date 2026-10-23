import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudit } from '../src/audit.js';
import { ConfigError } from '../src/config.js';
import { IgError } from '../src/errors.js';
import { createEventLog } from '../src/events.js';
import { createGuard } from '../src/guard.js';
import { createPoller } from '../src/poller.js';
import { createState } from '../src/state.js';

const OWNER = '17841400000000001';
const USER = '17841400000000002';
const LIST = `${OWNER}/conversations`;
const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SENTINEL = 'LEAK-CHECK-7731';

const iso = (ms) => new Date(ms).toISOString();
// The zone form that Graph writes on a message time: +0000, not +00:00.
const graphTime = (ms) => iso(ms).replace(/\.\d{3}Z$/, '+0000');

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-poller-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A conversation as the fake Graph holds it: an id, an updated time, and the ids of its messages, newest first.
function conversation(id, { updatedTime = iso(NOW - HOUR), messageIds = [] } = {}) {
  return { id, updatedTime, messageIds };
}

// A message as a message read returns it. The text is absent for an attachment-only message when text is null.
function rawMessage(id, { from = USER, text = 'hello', at = NOW - MINUTE } = {}) {
  const raw = {
    id,
    created_time: graphTime(at),
    from: { id: from },
    to: { data: [{ id: from === OWNER ? USER : OWNER }] },
  };
  if (text !== null) raw.message = text;
  return raw;
}

// A fake Graph reader. Its world holds the owner's conversations and the message records. It answers get only. A write
// is recorded in writes, and no test expects one. log holds every read and every sleep, in order. A path in failures
// throws the error it holds.
// Changed in P4: the thread read is the messages edge, GET {conversation}/messages, with the fields in the page, and the
// lists are paged by an offset cursor with paging.next (the way the P3 paged readers expect them). A thread's failures and
// the before hook are keyed by the conversation id, as before. The path that is recorded in reads is the request path.
const MESSAGES_EDGE = '/messages';
const PAGE_OF = (rows, query) => {
  const limit = query?.limit ?? 100;
  const offset = query?.after === undefined ? 0 : Number(String(query.after).slice(1));
  const items = rows.slice(offset, offset + limit);
  const more = offset + limit < rows.length;
  return {
    data: items,
    ...(more ? { paging: { cursors: { after: `o${offset + limit}` }, next: 'https://graph.example/next' } } : {}),
  };
};
// The conversation ids of the reads of a thread's messages edge, in order: the thread reads of a tick.
const threads = (reads) =>
  reads.filter((p) => p.endsWith(MESSAGES_EDGE)).map((p) => p.slice(0, -MESSAGES_EDGE.length));

function fakeGraph({ conversations = [], messages = {} } = {}) {
  // before, when set, runs before each read, with the conversation id, so that a test can change state during a tick.
  const world = { conversations, messages, failures: new Map(), before: null };
  const log = [];
  const reads = [];
  const queries = [];
  const writes = [];
  const get = async (path, query) => {
    log.push(`get ${path}`);
    reads.push(path);
    queries.push({ path, query });
    const id = path.endsWith(MESSAGES_EDGE) ? path.slice(0, -MESSAGES_EDGE.length) : path;
    if (world.before !== null) world.before(id);
    if (world.failures.has(id)) throw world.failures.get(id);
    if (path === LIST) {
      const rows = world.conversations.map((c) => ({
        id: c.id,
        ...(c.updatedTime === undefined ? {} : { updated_time: c.updatedTime }),
      }));
      return { data: PAGE_OF(rows, query), usage: null };
    }
    const thread = world.conversations.find((c) => c.id === id);
    if (thread !== undefined && path.endsWith(MESSAGES_EDGE)) {
      const page = PAGE_OF(thread.messageIds.map((mid) => world.messages[mid]), query);
      return { data: page, usage: null };
    }
    if (Object.hasOwn(world.messages, path)) return { data: world.messages[path], usage: null };
    throw new Error(`unexpected read of ${path}`);
  };
  const refuse = async (path) => {
    writes.push(path);
    throw new Error(`the poller must not write: ${path}`);
  };
  return { client: { get, post: refuse, del: refuse }, world, log, reads, queries, writes };
}

// A poller over a real state, event log, audit log and guard, in a directory. The clock is the value now. The sleep is
// logged into graph.log, so that a test can see the spacing.
async function setup(t, graph, { poll = {}, dir = tempDir(t), onInbound, threadMaxItems } = {}) {
  const clock = { now: NOW };
  const delivered = [];
  const state = await createState({ file: join(dir, 'state.json') });
  const eventsFile = join(dir, 'events.jsonl');
  const events = createEventLog({ file: eventsFile, state, now: () => clock.now });
  const audit = createAudit({ file: join(dir, 'audit.jsonl'), now: () => clock.now });
  const guard = createGuard({ owner: { igUserId: OWNER }, state, now: () => clock.now, eventsFile });
  const poller = createPoller({
    getClient: () => graph.client,
    owner: OWNER,
    events,
    state,
    guard,
    audit,
    config: { poll: { intervalMs: 60000, maxThreadsPerTick: 20, spacingMs: 600, ...poll } },
    sleep: async (ms) => {
      graph.log.push(`sleep ${ms}`);
    },
    now: () => clock.now,
    onInbound: onInbound ?? ((event) => delivered.push(event)),
    threadMaxItems,
  });
  return { dir, clock, state, events, audit, guard, poller, delivered };
}

const auditLines = (h) => h.audit.read({ limit: 1000 });

// A Graph error of a stop kind, on the list read. The tick halts, the stop is set through the guard and saved in the
// state, the audit line carries the kind and the action only, and a later tick makes no request.
async function checkHalt(t, kind, code) {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  graph.world.failures.set(LIST, new IgError(kind, `${SENTINEL} from the response`, { code }));
  const h = await setup(t, graph);
  assert.equal((await h.poller.tick()).status, 'halted');
  const stop = h.guard.stopStatus();
  assert.deepEqual([stop.stopped, stop.kind], [true, kind]);
  assert.equal(h.state.get('stop', null).kind, kind, 'the stop is saved to the state');
  assert.equal(JSON.stringify(stop).includes(SENTINEL), false, 'the stop detail holds no message text');
  const halt = auditLines(h).find((e) => e.outcome === 'halted');
  assert.deepEqual([halt.action, halt.detail], ['poll.list', kind]);
  assert.equal(JSON.stringify(auditLines(h)).includes(SENTINEL), false, 'the audit line holds no message text');
  const readsBefore = graph.reads.length;
  graph.world.failures.delete(LIST);
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.equal(graph.reads.length, readsBefore, 'a halted poller makes no call');
  return { graph, h };
}

test('poll dedupes on message id across ticks', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph);
  assert.equal((await h.poller.tick()).status, 'ok');
  // The thread changes, but the same message is still on its first page, so it is read again and not stored twice.
  graph.world.conversations[0].updatedTime = iso(NOW - 10 * MINUTE);
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.deepEqual(h.events.pending({ limit: 100 }).events.map((e) => e.id), ['m_1']);
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_1']);
  assert.equal(threads(graph.reads).filter((id) => id === 't_1').length, 2, 'the changed thread is read on both ticks');
  // A message already stored is skipped before the append, so it is not refused and audited as a skip.
  assert.deepEqual(auditLines(h).filter((e) => e.action === 'poll.skip'), []);
  assert.deepEqual(graph.writes, []);
});

test('owner-sent messages are not stored', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1', 'm_2'] })],
    messages: { m_1: rawMessage('m_1', { from: OWNER, text: 'sent by the owner' }), m_2: rawMessage('m_2') },
  });
  const h = await setup(t, graph);
  await h.poller.tick();
  assert.deepEqual(h.events.pending({ limit: 100 }).events.map((e) => e.id), ['m_2']);
  assert.equal(h.events.hasId('m_1', 'message'), false);
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_2']);
});

test('only changed threads are read', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph);
  await h.poller.tick();
  assert.equal(h.state.get('poll.seen.t_1', null), iso(NOW - HOUR));
  const before = graph.reads.length;
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.deepEqual(graph.reads.slice(before), [LIST], 'an unchanged thread is not read');
});

test('calls are spaced by poll.spacingMs', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1', 'm_2'] })],
    messages: { m_1: rawMessage('m_1'), m_2: rawMessage('m_2') },
  });
  const h = await setup(t, graph, { poll: { spacingMs: 900 } });
  await h.poller.tick();
  // Every read waits 900 ms first: the list, and the thread's messages edge. The two messages come in one page (P4).
  // Old assertion (removed): graph.log deepEqual the list, t_1, m_1 and m_2, each preceded by a 900 ms sleep (eight entries).
  assert.deepEqual(graph.log, ['sleep 900', `get ${LIST}`, 'sleep 900', 'get t_1/messages']);
});

test('maxThreadsPerTick is honoured', async (t) => {
  const graph = fakeGraph({
    conversations: [
      conversation('t_a', { updatedTime: iso(NOW - 3 * HOUR), messageIds: ['m_a'] }),
      conversation('t_b', { updatedTime: iso(NOW - 2 * HOUR), messageIds: ['m_b'] }),
      conversation('t_c', { updatedTime: iso(NOW - HOUR), messageIds: ['m_c'] }),
    ],
    messages: { m_a: rawMessage('m_a'), m_b: rawMessage('m_b'), m_c: rawMessage('m_c') },
  });
  const h = await setup(t, graph, { poll: { maxThreadsPerTick: 2 } });
  const result = await h.poller.tick();
  assert.equal(result.threadsRead, 2);
  // Old assertion (removed): graph.reads.filter((p) => p.startsWith('t_')) deepEqual ['t_c', 't_b'].
  assert.deepEqual(threads(graph.reads), ['t_c', 't_b'], 'the most recent threads first');
  assert.equal(h.state.get('poll.seen.t_a', null), null, 'the thread over the limit waits for a later tick');
});

test('RATE_LIMITED doubles the interval', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  graph.world.failures.set(LIST, new IgError('RATE_LIMITED', 'too many calls', { code: 4 }));
  const h = await setup(t, graph);
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    const result = await h.poller.tick();
    seen.push([result.status, result.intervalMs]);
  }
  assert.deepEqual(seen, [
    ['backoff', 120000],
    ['backoff', 240000],
    ['backoff', 480000],
    ['backoff', 600000],
    ['backoff', 600000],
  ], 'the interval doubles and stops at 10 minutes');
  assert.deepEqual(graph.reads, [LIST, LIST, LIST, LIST, LIST], 'a rate-limited tick reads no thread');
  assert.deepEqual(graph.writes, []);
  assert.equal(auditLines(h).at(-1).outcome, 'backoff');
  assert.equal(auditLines(h).at(-1).detail, 'RATE_LIMITED');
  // The stop goes through the guard and is saved. The poller does not halt on it.
  const stop = h.guard.stopStatus();
  assert.deepEqual([stop.stopped, stop.kind], [true, 'RATE_LIMITED']);
  assert.equal(h.state.get('stop', null).kind, 'RATE_LIMITED', 'the stop is saved to the state');

  graph.world.failures.delete(LIST);
  const clean = await h.poller.tick();
  assert.deepEqual([clean.status, clean.intervalMs], ['ok', 60000], 'a clean tick returns to poll.intervalMs');
  // Old assertion (removed): graph.reads.slice(-2) deepEqual ['t_1', 'm_1'].
  assert.deepEqual(graph.reads.slice(-2), [LIST, 't_1/messages'], 'the poller keeps reading after a rate limit');
});

test('AUTH_EXPIRED stops the poller and sets the stop state', async (t) => {
  await checkHalt(t, 'AUTH_EXPIRED', 190);
});

test('CHECKPOINT stops the poller and sets the stop state', async (t) => {
  await checkHalt(t, 'CHECKPOINT', 2);
});

test('ACTION_BLOCKED stops the poller and sets the stop state', async (t) => {
  await checkHalt(t, 'ACTION_BLOCKED', 368);
});

test('a persisted halt holds after a restart', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  graph.world.failures.set(LIST, new IgError('CHECKPOINT', 'checkpoint required', { code: 2 }));
  const first = await setup(t, graph);
  await first.poller.tick();
  graph.world.failures.delete(LIST);
  // A fresh state read from the file, as a restart would see it.
  const onDisk = await createState({ file: join(first.dir, 'state.json') });
  assert.equal(onDisk.get('stop', null).kind, 'CHECKPOINT');
  const readsBefore = graph.reads.length;
  const second = await setup(t, graph, { dir: first.dir });
  assert.equal((await second.poller.tick()).status, 'halted');
  assert.equal(graph.reads.length, readsBefore, 'the restarted poller makes no call');
});

test('a cleared stop resumes the poller without a restart', async (t) => {
  const { graph, h } = await checkHalt(t, 'CHECKPOINT', 2);
  assert.equal(h.guard.clearStop(true), 'cleared');
  assert.equal((await h.poller.tick()).status, 'ok');
  // Old assertion (removed): graph.reads.slice(-3) deepEqual [LIST, 't_1', 'm_1'].
  assert.deepEqual(graph.reads.slice(-2), [LIST, 't_1/messages'], 'the resumed tick reads the list and the thread');
  assert.equal(h.events.pending({ limit: 10 }).events.length, 1);
});

test('an API_ERROR on the list is audited and the poller goes on', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  graph.world.failures.set(LIST, new IgError('API_ERROR', 'server error', { status: 500 }));
  const h = await setup(t, graph);
  assert.equal((await h.poller.tick()).status, 'error');
  assert.equal(h.guard.stopStatus().stopped, false, 'an API_ERROR sets no stop');
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.outcome, e.detail]), [['poll.list', 'error', 'API_ERROR']]);
  graph.world.failures.delete(LIST);
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.equal(h.events.pending({ limit: 10 }).events.length, 1);
});

// Changed in P4. A Unix number in seconds is a time the P3 reader accepts, so it is stored, and a value that is not a time is
// malformed. Old assertions (removed): the message m_bad was the value '1792583940', and the audit line was poll.skip m_bad
// VALIDATION. New assertions: a value that is not a time is skipped inside the reader, counted, and audited with the kind and
// the count; the other message is stored.
test('a created_time that does not parse is skipped and audited', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_bad', 'm_1'] })],
    messages: {
      m_bad: { ...rawMessage('m_bad'), created_time: 'not a time' },
      m_1: rawMessage('m_1'),
    },
  });
  const h = await setup(t, graph);
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_1']);
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.messages', 't_1', 'skipped', { kind: 'API_ERROR', count: 1 }],
  ]);
});

test('onInbound is called once per new event', async (t) => {
  const graph = fakeGraph({
    conversations: [
      // Graph lists the newest message first, and the most recently updated thread is read first.
      conversation('t_1', { updatedTime: iso(NOW - 2 * HOUR), messageIds: ['m_2', 'm_1'] }),
      conversation('t_2', { updatedTime: iso(NOW - HOUR), messageIds: ['m_3'] }),
    ],
    messages: {
      m_1: rawMessage('m_1', { at: NOW - 3 * MINUTE }),
      m_2: rawMessage('m_2', { at: NOW - 2 * MINUTE }),
      m_3: rawMessage('m_3', { at: NOW - MINUTE }),
    },
  });
  const h = await setup(t, graph);
  await h.poller.tick();
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_3', 'm_1', 'm_2']);
  for (const c of graph.world.conversations) c.updatedTime = iso(NOW - MINUTE);
  await h.poller.tick();
  assert.equal(h.delivered.length, 3, 'a second read of the same messages announces nothing new');
});

test('a failing thread is audited and the tick goes on to the next thread', async (t) => {
  const graph = fakeGraph({
    conversations: [
      conversation('t_a', { updatedTime: iso(NOW - 2 * HOUR), messageIds: ['m_a'] }),
      conversation('t_b', { updatedTime: iso(NOW - HOUR), messageIds: ['m_b'] }),
    ],
    messages: { m_a: rawMessage('m_a'), m_b: rawMessage('m_b') },
  });
  graph.world.failures.set('t_a', new IgError('API_ERROR', 'server error', { status: 500 }));
  const h = await setup(t, graph);
  const result = await h.poller.tick();
  assert.equal(result.status, 'ok');
  assert.equal(result.errors, 1);
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_b']);
  assert.equal(h.state.get('poll.seen.t_a', null), null, 'the failed thread is read again on the next tick');
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.detail]), [['poll.messages', 't_a', 'API_ERROR']]);
});

// Changed in fix round 3 (m-2). The endpoint gives a conversation with no updated time updatedTime null, so the list is
// not refused. Old assertions (removed): status 'error'; reads equal [LIST]; the last audit line is poll.list API_ERROR.
// New assertions below. The stored value makes the check a real one: null must not compare as changed.
test('a conversation with null updatedTime is not read, is audited, and the other conversations are read', async (t) => {
  const bad = conversation('t_bad', { messageIds: ['m_bad'] });
  delete bad.updatedTime;
  const graph = fakeGraph({
    conversations: [bad, conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_bad: rawMessage('m_bad'), m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph);
  h.state.set('poll.seen.t_bad', iso(NOW - 2 * HOUR));
  h.state.save();
  const result = await h.poller.tick();
  assert.equal(result.status, 'ok');
  // Old assertion (removed): graph.reads.filter((p) => p.startsWith('t_')) deepEqual ['t_1'].
  assert.deepEqual(threads(graph.reads), ['t_1'], 'the null conversation is not read');
  assert.equal(h.state.get('poll.seen.t_bad', null), iso(NOW - 2 * HOUR), 'a null time does not replace the stored value');
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_1']);
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.skip', 't_bad', 'skipped', 'VALIDATION'],
  ]);
});

test('audit lines carry the kind and the action, never the message text', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  graph.world.failures.set('t_1', new IgError('API_ERROR', `the thread said ${SENTINEL}`));
  const h = await setup(t, graph);
  await h.poller.tick();
  assert.equal(JSON.stringify(auditLines(h)).includes(SENTINEL), false);
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.messages', 't_1', 'error', 'API_ERROR'],
  ]);
});

test('a message with no text is stored with empty text and the Graph time as receivedAt', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1', { text: null }) },
  });
  const h = await setup(t, graph);
  await h.poller.tick();
  const [event] = h.events.pending({ limit: 10 }).events;
  assert.equal(event.text, '');
  assert.equal(event.receivedAt, iso(NOW - MINUTE));
});

test('a lost state does not store a message twice', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const first = await setup(t, graph);
  await first.poller.tick();
  // The state file is lost and the events file survives. The thread looks changed again, so the message is read again.
  rmSync(join(first.dir, 'state.json'));
  const second = await setup(t, graph, { dir: first.dir });
  // A lost state halts the poller (Task 17 I-2): no read and no second store. After ig_stop_clear, the poller resumes and
  // the dedupe holds.
  assert.equal((await second.poller.tick()).status, 'halted');
  assert.equal(second.events.pending({ limit: 10 }).events.length, 1);
  assert.deepEqual(second.delivered, []);
  second.guard.clearStop(true);
  assert.equal((await second.poller.tick()).status, 'ok');
  assert.equal(second.events.pending({ limit: 10 }).events.length, 1);
});

// Changed in P4. Old assertion (removed): the events are ids.slice(0, 20), the first 20 of 25, because the old read took 20.
// New assertion: the messages edge takes up to 100 a page, so all 25 come in one request and all 25 are stored.
test('a thread of 25 is read in one request, and all 25 are stored', async (t) => {
  const ids = Array.from({ length: 25 }, (_, i) => `m_${String(i + 1).padStart(2, '0')}`);
  const messages = Object.fromEntries(ids.map((id, i) => [id, rawMessage(id, { at: NOW - (30 - i) * MINUTE })]));
  const graph = fakeGraph({ conversations: [conversation('t_1', { messageIds: ids })], messages });
  const h = await setup(t, graph);
  await h.poller.tick();
  assert.deepEqual(threads(graph.reads), ['t_1'], 'one thread read');
  assert.deepEqual(h.events.pending({ limit: 100 }).events.map((e) => e.id), ids);
});

// Changed in P4 (A-26). Old assertions (removed): the future message is audited at once as poll.skip VALIDATION, and the
// thread is marked read. New assertions: the message is held. It is not stored, nothing is audited yet, the thread is not
// marked read, and the thread is read again on the next tick. The rest of the thread is stored.
test('a message stamped more than five minutes ahead is held, and its thread is read again on the next tick', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_2', 'm_1'] })],
    messages: {
      m_1: rawMessage('m_1', { at: NOW - MINUTE }),
      m_2: rawMessage('m_2', { at: NOW + 10 * MINUTE }),
    },
  });
  const h = await setup(t, graph);
  const first = await h.poller.tick();
  assert.equal(first.status, 'ok');
  assert.equal(first.futureHeld, 1);
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_1']);
  assert.deepEqual(auditLines(h), [], 'a held message is not audited yet');
  assert.equal(h.state.get('poll.seen.t_1', null), null, 'the thread is not marked read');
  await h.poller.tick();
  assert.deepEqual(threads(graph.reads), ['t_1', 't_1'], 'the thread is read again on the next tick');
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_1'], 'nothing is stored twice');
});

// A-26: a held message is stored once its time is within the allowance, and the thread is then marked read.
test('a held message is stored once its time is within the allowance', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_2'] })],
    messages: { m_2: rawMessage('m_2', { at: NOW + 10 * MINUTE }) },
  });
  const h = await setup(t, graph);
  await h.poller.tick();
  assert.equal(h.events.pending({ limit: 10 }).events.length, 0);
  h.clock.now = NOW + 10 * MINUTE;
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.deepEqual(h.events.pending({ limit: 10 }).events.map((e) => e.id), ['m_2']);
  assert.equal(h.state.get('poll.future.m_2', null), null, 'the held record is cleared once the message is stored');
  assert.equal(h.state.get('poll.seen.t_1', null), iso(NOW - HOUR), 'the thread is marked read');
});

// A-26: a message still ahead after 24 hours is audited as poll.skip with reason future-time, and dropped from the retry.
test('a message still ahead of the clock after 24 hours is audited as future-time and dropped from the retry', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_far'] })],
    messages: { m_far: rawMessage('m_far', { at: NOW + 2 * 24 * HOUR }) },
  });
  const h = await setup(t, graph);
  await h.poller.tick();
  // The first tick held the message. The tick 25 hours later finds it still ahead, after more than 24 hours, and drops it.
  h.clock.now = NOW + 25 * HOUR;
  await h.poller.tick();
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.skip', 'm_far', 'skipped', 'future-time'],
  ]);
  assert.equal(h.state.get('poll.seen.t_1', null), iso(NOW - HOUR), 'the thread is marked read once the message is dropped');
  const readsBefore = graph.reads.length;
  h.clock.now = NOW + 26 * HOUR;
  await h.poller.tick();
  assert.equal(graph.reads.slice(readsBefore).includes('t_1/messages'), false, 'the dropped thread is not read again');
  assert.equal(auditLines(h).length, 1, 'the drop is audited once');
});

test('a callback that throws does not stop the tick', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1', 'm_2'] })],
    messages: { m_1: rawMessage('m_1'), m_2: rawMessage('m_2') },
  });
  let calls = 0;
  const h = await setup(t, graph, {
    onInbound: () => {
      calls += 1;
      throw new Error('callback failed');
    },
  });
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.equal(calls, 2);
  assert.equal(h.events.pending({ limit: 10 }).events.length, 2, 'the events are stored before the callback runs');
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.detail]), [
    ['poll.notify', 'CALLBACK_ERROR'],
    ['poll.notify', 'CALLBACK_ERROR'],
  ]);
});

test('a tick is refused while another tick is running', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph);
  const first = h.poller.tick();
  const second = await h.poller.tick();
  assert.equal(second.status, 'in_progress');
  assert.equal((await first).status, 'ok');
  assert.equal(graph.reads.filter((p) => p === LIST).length, 1);
});

// Changed in P4 (I-3, P3 paging). Old assertion (removed): a full page of 100 conversations writes a truncated line. New
// assertion: a full page is not truncated when the list has no next page. The list asks for pages of 100.
test('a full page of conversations with no more pages is not truncated', async (t) => {
  const rows = Array.from({ length: 100 }, (_, i) =>
    conversation(`t_${i}`, { updatedTime: iso(NOW - (i + 1) * MINUTE) }),
  );
  const graph = fakeGraph({ conversations: rows });
  const h = await setup(t, graph);
  await h.poller.tick();
  assert.equal(graph.queries[0].query.limit, 100, 'the list asks for a page of 100');
  assert.deepEqual(auditLines(h), []);
});

// P4: a list with more pages than the reader takes (10 pages of 100) is audited as truncated, with the reader's reason.
test('a conversation list with more pages than the read takes is audited as truncated', async (t) => {
  const rows = Array.from({ length: 1100 }, (_, i) => conversation(`c_${i}`, { updatedTime: iso(NOW - (i + 1) * MINUTE) }));
  const graph = fakeGraph({ conversations: rows });
  const h = await setup(t, graph);
  await h.poller.tick();
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.outcome, e.detail]), [
    ['poll.list', 'truncated', { reason: 'more pages exist beyond the page limit', returned: 1000 }],
  ]);
});

// P4 (A-30, continuation). A thread of 25 read 20 at a time: the first tick stores 20, audits the truncation, and keeps a
// cursor; the next tick continues from the cursor, stores the other 5, and marks the thread read.
test('a thread longer than one read is continued from its cursor on the next tick', async (t) => {
  const ids = Array.from({ length: 25 }, (_, i) => `m_${String(i + 1).padStart(2, '0')}`);
  const messages = Object.fromEntries(ids.map((id, i) => [id, rawMessage(id, { at: NOW - (30 - i) * MINUTE })]));
  const graph = fakeGraph({ conversations: [conversation('t_1', { messageIds: ids })], messages });
  const h = await setup(t, graph, { threadMaxItems: 20 });
  await h.poller.tick();
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.messages', 't_1', 'truncated', { reason: 'more items exist beyond the item limit', returned: 20 }],
  ]);
  assert.equal(h.state.get('poll.after.t_1', null), 'o20', 'the cursor of the first message not read');
  assert.equal(h.state.get('poll.seen.t_1', null), null, 'the thread is not marked read while it is partly read');
  await h.poller.tick();
  assert.deepEqual(h.events.pending({ limit: 100 }).events.map((e) => e.id), ids);
  assert.equal(h.state.get('poll.after.t_1', null), null, 'the cursor is cleared when the thread is done');
  assert.equal(h.state.get('poll.seen.t_1', null), iso(NOW - HOUR), 'the thread is marked read once it is done');
});

// Added in fix round 2 (I-1): an impossible day is refused by the event log, so the poller skips the message and audits it.
test('an impossible calendar day in created_time is skipped and audited, and nothing is stored', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_feb', 'm_1'] })],
    messages: {
      m_feb: { ...rawMessage('m_feb'), created_time: '2026-02-30T12:00:00+0000' },
      m_1: rawMessage('m_1'),
    },
  });
  const h = await setup(t, graph);
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.equal(h.events.hasId('m_feb', 'message'), false);
  assert.deepEqual(h.events.pending({ limit: 10 }).events.map((e) => e.id), ['m_1']);
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_1']);
  // Changed in P4. Old assertion (removed): [['poll.skip', 'm_feb', 'skipped', 'VALIDATION']], from the event log. New
  // assertion: the reader refuses the impossible day as a malformed time, so the skip is counted in the thread's read.
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.messages', 't_1', 'skipped', { kind: 'API_ERROR', count: 1 }],
  ]);
});

// Changed in fix round 3 (m-3). The endpoint gives a message with no created_time createdTime null, so the thread is not
// failed. Old assertions (removed): result.errors 1; no event stored; the audit line is poll.messages t_1 error API_ERROR.
// New assertions below.
test('a thread with one message lacking created_time stores the other messages, and audits the skipped one', async (t) => {
  const missing = rawMessage('m_missing');
  delete missing.created_time;
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_missing', 'm_1'] })],
    messages: { m_missing: missing, m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph);
  const result = await h.poller.tick();
  assert.equal(result.errors, 0, 'the thread is read, not failed');
  assert.deepEqual(h.events.pending({ limit: 10 }).events.map((e) => e.id), ['m_1'], 'nothing is stored at the clock time');
  assert.equal(h.state.get('poll.seen.t_1', null), iso(NOW - HOUR), 'the thread is marked read');
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.skip', 'm_missing', 'skipped', 'VALIDATION'],
  ]);
});

// Added in fix round 2 (m-1). The endpoint gives a blank created_time createdTime null, and the poller's check skips it.
test('a blank created_time is skipped and audited as poll.skip', async (t) => {
  const blank = { ...rawMessage('m_blank'), created_time: '   ' };
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_blank', 'm_1'] })],
    messages: { m_blank: blank, m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph);
  await h.poller.tick();
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_1']);
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.skip', 'm_blank', 'skipped', 'VALIDATION'],
  ]);
});

// Added in fix round 2 (I-2). The poller observes RATE_LIMITED, then CHECKPOINT. The guard replaces the stored kind.
test('a CHECKPOINT observed over a stored RATE_LIMITED replaces it, and the owner clear removes it', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  graph.world.failures.set(LIST, new IgError('RATE_LIMITED', 'too many calls', { code: 4 }));
  const h = await setup(t, graph);
  assert.equal((await h.poller.tick()).status, 'backoff');
  assert.equal(h.guard.stopStatus().kind, 'RATE_LIMITED');
  graph.world.failures.set(LIST, new IgError('CHECKPOINT', 'checkpoint required', { code: 2 }));
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.equal(h.guard.stopStatus().kind, 'CHECKPOINT');
  const onDisk = await createState({ file: join(h.dir, 'state.json') });
  assert.equal(onDisk.get('stop', null).kind, 'CHECKPOINT', 'the replacement is saved');
  // The test's reading of "clear the stop": a preview clear changes nothing, and a confirmed clear removes the stop.
  assert.equal(h.guard.clearStop(false), 'preview');
  assert.equal(h.guard.stopStatus().kind, 'CHECKPOINT');
  assert.equal(h.guard.clearStop(true), 'cleared');
  assert.equal(h.guard.stopStatus().stopped, false);
});

// Added in fix round 2 (I-2). Another caller stores a CHECKPOINT while the older thread is being read, and that read then
// fails with RATE_LIMITED. The guard keeps the CHECKPOINT, and the poller still audits the RATE_LIMITED it observed. (Since
// F-3 the guard is asked before each thread, so a CHECKPOINT stored during the newer thread stops the tick first; see the
// tests below.)
test('a RATE_LIMITED observed under a stored CHECKPOINT is audited and does not replace it', async (t) => {
  const graph = fakeGraph({
    conversations: [
      conversation('t_new', { updatedTime: iso(NOW - MINUTE), messageIds: ['m_new'] }),
      conversation('t_old', { updatedTime: iso(NOW - HOUR), messageIds: ['m_old'] }),
    ],
    messages: { m_new: rawMessage('m_new'), m_old: rawMessage('m_old') },
  });
  graph.world.failures.set('t_old', new IgError('RATE_LIMITED', 'too many calls', { code: 4 }));
  const h = await setup(t, graph);
  graph.world.before = (path) => {
    if (path === 't_old') h.guard.stop('CHECKPOINT', 'stored by another caller');
  };
  assert.equal((await h.poller.tick()).status, 'backoff');
  assert.equal(h.guard.stopStatus().kind, 'CHECKPOINT');
  // The stop_kept line is written when the guard keeps the stored kind, and the backoff line follows it.
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.messages', 't_old', 'stop_kept', { observed: 'RATE_LIMITED', stored: 'CHECKPOINT' }],
    ['poll.messages', 't_old', 'backoff', 'RATE_LIMITED'],
  ]);
});

// F-3 (Task 11 m-5). The guard is asked before each thread, so a halting stop stored during one thread stops the tick
// before the next thread is read, and no request is made for that thread.
test('a halting stop stored during one thread stops the tick before the next thread is read (F-3, m-5)', async (t) => {
  const graph = fakeGraph({
    conversations: [
      conversation('t_new', { updatedTime: iso(NOW - MINUTE), messageIds: ['m_new'] }),
      conversation('t_old', { updatedTime: iso(NOW - HOUR), messageIds: ['m_old'] }),
    ],
    messages: { m_new: rawMessage('m_new'), m_old: rawMessage('m_old') },
  });
  const h = await setup(t, graph);
  graph.world.before = (path) => {
    if (path === 't_new') h.guard.stop('CHECKPOINT', 'stored by another caller');
  };
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.equal(graph.reads.includes('t_old'), false, 'the older thread is not read');
  assert.equal(h.guard.stopStatus().kind, 'CHECKPOINT');
});

// F-3 (Task 11 m-4). A halt is released when the stored stop changes to one that does not halt, with no tick in between.
test('a halt does not outlast its stop: a clear, then a RATE_LIMITED stop, lets the poller read again (F-3, m-4)', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_a', { updatedTime: iso(NOW - MINUTE), messageIds: ['m_a'] })],
    messages: { m_a: rawMessage('m_a') },
  });
  const h = await setup(t, graph);
  h.guard.stop('CHECKPOINT', 'checkpoint required');
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.equal(h.guard.clearStop(true), 'cleared');
  h.guard.stop('RATE_LIMITED', 'too many calls');
  const readsBefore = graph.reads.length;
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.ok(graph.reads.length > readsBefore, 'the poller reads again');
});

// F-3 (Task 11 m-7). A stored STATE_LOST or STATE_CORRUPT halts the poller, which makes no request until the stop is cleared.
test('a stored STATE_LOST or STATE_CORRUPT halts the poller, with no request (F-3, m-7)', async (t) => {
  for (const kind of ['STATE_LOST', 'STATE_CORRUPT']) {
    const graph = fakeGraph({
      conversations: [conversation('t_a', { updatedTime: iso(NOW - MINUTE), messageIds: ['m_a'] })],
      messages: { m_a: rawMessage('m_a') },
    });
    const h = await setup(t, graph);
    h.guard.stop(kind, 'test');
    assert.equal((await h.poller.tick()).status, 'halted', kind);
    assert.deepEqual(graph.reads, [], kind);
  }
});

// F-3 (Task 11 m-7). A RATE_LIMITED that a thread read returns backs the poller off, sets the stop, and ends the tick.
test('a RATE_LIMITED from one thread backs the poller off, sets the stop, and ends the tick (F-3, m-7)', async (t) => {
  const graph = fakeGraph({
    conversations: [
      conversation('t_new', { updatedTime: iso(NOW - MINUTE), messageIds: ['m_new'] }),
      conversation('t_old', { updatedTime: iso(NOW - HOUR), messageIds: ['m_old'] }),
    ],
    messages: { m_new: rawMessage('m_new'), m_old: rawMessage('m_old') },
  });
  graph.world.failures.set('t_new', new IgError('RATE_LIMITED', 'too many calls', { code: 4 }));
  const h = await setup(t, graph);
  assert.equal((await h.poller.tick()).status, 'backoff');
  assert.equal(h.guard.stopStatus().kind, 'RATE_LIMITED');
  assert.equal(graph.reads.includes('t_old'), false, 'the tick ends at the backoff');
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.messages', 't_new', 'backoff', 'RATE_LIMITED'],
  ]);
});

// Added in fix round 2 (m-7). A save that fails still stops this process, and the failure is audited.
test('a stop that cannot be saved still halts this process and is audited', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  graph.world.failures.set(LIST, new IgError('CHECKPOINT', 'checkpoint required', { code: 2 }));
  const h = await setup(t, graph);
  const stateFile = join(h.dir, 'state.json');
  mkdirSync(`${stateFile}.tmp`);
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.outcome, e.detail]), [
    ['poll.list', 'stop_not_saved', 'CHECKPOINT'],
    ['poll.list', 'halted', 'CHECKPOINT'],
  ]);
  const readsBefore = graph.reads.length;
  graph.world.failures.delete(LIST);
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.equal(graph.reads.length, readsBefore, 'the halt holds in this process');
  rmSync(`${stateFile}.tmp`, { recursive: true, force: true });
  assert.equal(h.guard.stopStatus().kind, 'CHECKPOINT');
});

// Task 17 I-2: STATE_LOST halts the poller, as STATE_CORRUPT does. A halted poller makes no request until ig_stop_clear.
test('a stored STATE_LOST stop halts reads until it is cleared', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph);
  h.guard.stop('STATE_LOST', 'events file holds data but the state has no events.lastSeq');
  const readsBefore = graph.reads.length;
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.equal(graph.reads.length, readsBefore, 'a halted poller makes no request');
  assert.deepEqual(h.events.pending({ limit: 10 }).events.map((e) => e.id), []);
  assert.equal(h.guard.stopStatus().kind, 'STATE_LOST', 'the poller does not clear the stop');
  h.guard.clearStop(true);
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.deepEqual(h.events.pending({ limit: 10 }).events.map((e) => e.id), ['m_1']);
});

// Task 17 I-2: STATE_CORRUPT halts the poller the same way.
test('a stored STATE_CORRUPT stop halts reads until it is cleared', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph);
  h.guard.stop('STATE_CORRUPT', 'state file unreadable; moved aside');
  const readsBefore = graph.reads.length;
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.equal(graph.reads.length, readsBefore, 'a halted poller makes no request');
  h.guard.clearStop(true);
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.deepEqual(h.events.pending({ limit: 10 }).events.map((e) => e.id), ['m_1']);
});

// Added in fix round 4 (N-2). An earlier RATE_LIMITED stop is held unsaved. The poller then observes CHECKPOINT, which ranks
// higher, so it replaces the stop in memory, and the save of CHECKPOINT fails. The failed save is named CHECKPOINT, the kind
// the guard holds. The brief's example (naming RATE_LIMITED) cannot hold under the severity rule, because the CHECKPOINT
// replaces the unsaved RATE_LIMITED before the save, so the save that fails is the CHECKPOINT's.
test('a failed save is named by the kind the guard holds, and the in-process halt holds', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph);
  const stateFile = join(h.dir, 'state.json');
  mkdirSync(`${stateFile}.tmp`);
  assert.throws(() => h.guard.stop('RATE_LIMITED', 'stored earlier'), (err) => err.kind === 'CONFIG');
  graph.world.failures.set(LIST, new IgError('CHECKPOINT', 'checkpoint required', { code: 2 }));
  const readsBefore = graph.reads.length;
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.outcome, e.detail]), [
    ['poll.list', 'stop_not_saved', 'CHECKPOINT'],
    ['poll.list', 'halted', 'CHECKPOINT'],
  ]);
  // The halt holds in this process while the save is still blocked: the next tick makes no request.
  graph.world.failures.delete(LIST);
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.equal(graph.reads.length, readsBefore + 1, 'only the failing list read was made');
  rmSync(`${stateFile}.tmp`, { recursive: true, force: true });
  assert.equal(h.guard.stopStatus().kind, 'CHECKPOINT');
});

// Added in fix round 4 (N-2). Another caller stores CHECKPOINT unsaved during the tick. The older thread then fails with
// RATE_LIMITED. That RATE_LIMITED ranks lower, so the guard keeps CHECKPOINT, and the save that fails is the CHECKPOINT's.
// The audit names the stored kind, and the observed kind is named on its own lines.
test('a failed save of a stored stop is named by its kind when a different kind was observed', async (t) => {
  const graph = fakeGraph({
    conversations: [
      conversation('t_new', { updatedTime: iso(NOW - MINUTE), messageIds: ['m_new'] }),
      conversation('t_old', { updatedTime: iso(NOW - HOUR), messageIds: ['m_old'] }),
    ],
    messages: { m_new: rawMessage('m_new'), m_old: rawMessage('m_old') },
  });
  graph.world.failures.set('t_old', new IgError('RATE_LIMITED', 'too many calls', { code: 4 }));
  const h = await setup(t, graph);
  const stateFile = join(h.dir, 'state.json');
  graph.world.before = (path) => {
    if (path !== 't_old') return;
    mkdirSync(`${stateFile}.tmp`);
    try {
      h.guard.stop('CHECKPOINT', 'stored by another caller');
    } catch {
      // The save is blocked, so the CHECKPOINT is held unsaved in this process.
    }
  };
  assert.equal((await h.poller.tick()).status, 'backoff');
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.messages', 't_old', 'stop_not_saved', 'CHECKPOINT'],
    ['poll.messages', 't_old', 'stop_kept', { observed: 'RATE_LIMITED', stored: 'CHECKPOINT' }],
    ['poll.messages', 't_old', 'backoff', 'RATE_LIMITED'],
  ]);
  graph.world.before = null;
  const readsBefore = graph.reads.length;
  assert.equal((await h.poller.tick()).status, 'halted', 'the in-process CHECKPOINT halts the next tick');
  assert.equal(graph.reads.length, readsBefore, 'a halted poller makes no call');
  rmSync(`${stateFile}.tmp`, { recursive: true, force: true });
});

// P4 (A-24). A thread that fails is backed off for 1, 2, 4 ... ticks, so the other thread gets the one slot. The schedule is
// fixed here: the failing thread is read on ticks 1, 3 and 6, and the healthy one on tick 2. Once the failure clears, the
// thread is read on its retry tick (11) and its backoff ends.
test('a failing thread does not take every slot across ticks', async (t) => {
  const graph = fakeGraph({
    conversations: [
      conversation('t_bad', { updatedTime: iso(NOW - MINUTE), messageIds: ['m_bad'] }),
      conversation('t_ok', { updatedTime: iso(NOW - HOUR), messageIds: ['m_ok'] }),
    ],
    messages: { m_bad: rawMessage('m_bad'), m_ok: rawMessage('m_ok') },
  });
  graph.world.failures.set('t_bad', new IgError('API_ERROR', 'server error', { status: 500 }));
  const h = await setup(t, graph, { poll: { maxThreadsPerTick: 1 } });
  const results = [];
  for (let i = 0; i < 6; i += 1) results.push(await h.poller.tick());
  assert.deepEqual(threads(graph.reads), ['t_bad', 't_ok', 't_bad', 't_bad'], 'the schedule of reads');
  assert.equal(results[1].backedOff, 1, 'the failing thread is in backoff on tick 2');
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_ok']);
  // The third failure (tick 6) backs the thread off for 4 ticks, so its retry is tick 11. The failure clears before then.
  graph.world.failures.delete('t_bad');
  const later = [];
  for (let i = 0; i < 5; i += 1) later.push(await h.poller.tick());
  assert.deepEqual(threads(graph.reads).slice(4), ['t_bad'], 'the thread is read again on its retry tick, tick 11');
  assert.equal(later[4].status, 'ok');
  assert.equal(h.state.get('poll.seen.t_bad', null), iso(NOW - MINUTE), 'a clean read clears the backoff and marks the thread read');
});

// P4 (A-28). A conversation that has not been listed for 30 days is pruned from the state: its seen value, its listed time and
// its continuation cursor. A conversation listed 29 days ago is kept.
test('a poll.seen entry older than 30 days is pruned', async (t) => {
  const graph = fakeGraph({ conversations: [conversation('t_1', { messageIds: [] })] });
  const h = await setup(t, graph);
  h.state.set('poll.seen.t_gone', iso(NOW - 40 * DAY));
  h.state.set('poll.listed.t_gone', iso(NOW - 31 * DAY));
  h.state.set('poll.after.t_gone', 'o20');
  h.state.set('poll.seen.t_recent', iso(NOW - 40 * DAY));
  h.state.set('poll.listed.t_recent', iso(NOW - 29 * DAY));
  h.state.save();
  await h.poller.tick();
  assert.deepEqual(h.state.keys('poll.seen.'), ['poll.seen.t_1', 'poll.seen.t_recent']);
  assert.deepEqual(h.state.keys('poll.after.'), []);
  assert.equal(h.state.get('poll.listed.t_1', null), iso(NOW), 'a listed conversation is stamped with the tick time');
});

// P4 (O-3). A damaged state file starts the service stopped with STATE_CORRUPT: outbound is refused, the poller is halted and
// makes no request, and a read still works. Only ig_stop_clear with confirm clears it, and then the poller reads again.
test('a damaged state file starts stopped with STATE_CORRUPT, and the poller makes no request', async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ 'events.issued': 2, 'events.acked': 9 }));
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph, { dir });
  assert.equal(h.guard.stopStatus().kind, 'STATE_CORRUPT');
  assert.throws(() => h.guard.assertNotStopped(), (err) => err.kind === 'STOPPED');
  assert.deepEqual(h.events.pending({ limit: 10 }).events, [], 'a read still works');
  assert.equal((await h.poller.tick()).status, 'halted');
  assert.deepEqual(graph.reads, [], 'no request is made while the stop holds');
  assert.equal(h.guard.clearStop(true), 'cleared');
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.deepEqual(threads(graph.reads), ['t_1']);
});

// P4 fix (item 1). A thread that holds a message stamped ahead of the clock is deferred: it does not take the only slot, so the second
// thread is read in the same tick. The deferred thread is read on later ticks, after the others, and stored once its message is within
// the allowance.
test('a thread holding a future message does not take the only slot from a second thread', async (t) => {
  const graph = fakeGraph({
    conversations: [
      conversation('t_future', { updatedTime: iso(NOW - MINUTE), messageIds: ['m_future'] }),
      conversation('t_plain', { updatedTime: iso(NOW - HOUR), messageIds: ['m_plain'] }),
    ],
    messages: { m_future: rawMessage('m_future', { at: NOW + 10 * MINUTE }), m_plain: rawMessage('m_plain') },
  });
  const h = await setup(t, graph, { poll: { maxThreadsPerTick: 1 } });
  const first = await h.poller.tick();
  assert.equal(first.status, 'ok');
  assert.equal(first.futureHeld, 1);
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_plain'], 'the second thread is read in the same tick');
  assert.deepEqual(threads(graph.reads), ['t_future', 't_plain']);
  assert.equal(h.state.get('poll.deferred.t_future', null), true, 'the holding thread is deferred');
  // On the next tick the second thread is seen, and the deferred thread is read after the others.
  await h.poller.tick();
  assert.deepEqual(threads(graph.reads).slice(2), ['t_future']);
  // Within the allowance, the message is stored, and the thread is no longer deferred.
  h.clock.now = NOW + 10 * MINUTE;
  await h.poller.tick();
  assert.deepEqual(h.delivered.map((e) => e.id), ['m_plain', 'm_future']);
  assert.equal(h.state.get('poll.deferred.t_future', null), null);
});

// P4 fix (item 2), at the poller. A damaged dedupe index is quarantined and rebuilt, the rebuild is written to the audit log, and a
// message still in the event file is refused as a duplicate.
test('a damaged dedupe index causes a rebuild that is audited, and a message still in the event file is not stored again', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const first = await setup(t, graph);
  await first.poller.tick();
  assert.equal(first.events.pending({ limit: 10 }).events.length, 1);
  appendFileSync(join(first.dir, 'event-ids.jsonl'), 'damaged line\n');
  // The thread changes, so it is read again and m_1 is the one message already in the event file.
  graph.world.conversations[0].updatedTime = iso(NOW - 10 * MINUTE);
  const second = await setup(t, graph, { dir: first.dir });
  await second.poller.tick();
  assert.deepEqual(
    auditLines(second).filter((e) => e.action === 'events.index').map((e) => [e.outcome, e.detail.quarantined]),
    [['rebuilt', 'event-ids.jsonl.corrupt']],
  );
  assert.equal(existsSync(join(first.dir, 'event-ids.jsonl.corrupt')), true, 'the damaged index is kept');
  assert.equal(second.events.pending({ limit: 10 }).events.length, 1, 'the message is not stored again');
  assert.deepEqual(second.delivered, [], 'the message is not announced again');
});

// P4 fix (item 4). A backoff recorded before a restart is still in force after it: the thread is not read until its retry tick, and
// the tick number is the same across the restart.
test('a backoff recorded before a restart is still in force after it', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_bad', { messageIds: ['m_bad'] })],
    messages: { m_bad: rawMessage('m_bad') },
  });
  graph.world.failures.set('t_bad', new IgError('API_ERROR', 'server error', { status: 500 }));
  const first = await setup(t, graph);
  await first.poller.tick();
  assert.deepEqual(threads(graph.reads), ['t_bad'], 'tick 1 reads the thread, which fails');
  assert.equal(first.state.get('poll.backoff.t_bad', null).retryAt, 3, 'the retry is on tick 3');
  graph.world.failures.delete('t_bad');
  // A restart: a new state, event log and poller over the same files. The failure has cleared, but the backoff holds.
  const second = await setup(t, graph, { dir: first.dir });
  await second.poller.tick();
  assert.deepEqual(threads(graph.reads), ['t_bad'], 'tick 2, after the restart, does not read the backed-off thread');
  await second.poller.tick();
  assert.deepEqual(threads(graph.reads), ['t_bad', 't_bad'], 'tick 3 retries it');
  assert.equal(second.state.get('poll.seen.t_bad', null), iso(NOW - HOUR), 'a clean read clears the backoff');
  assert.equal(second.state.get('poll.backoff.t_bad', null), null);
});

// P4 review I-2. A message older than the dedupe window is not stored, and the skips of a thread are audited once, with the count and no
// text. A message inside the window is stored.
test('a message older than 90 days in a changed thread is not stored, and the audit line carries no text', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_old', 'm_recent'] })],
    messages: {
      m_old: rawMessage('m_old', { at: NOW - 91 * DAY, text: 'SENTINEL-OLD-TEXT-4471' }),
      m_recent: rawMessage('m_recent', { at: NOW - 80 * DAY }),
    },
  });
  const h = await setup(t, graph);
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.deepEqual(h.events.pending({ limit: 10 }).events.map((e) => e.id), ['m_recent']);
  assert.equal(h.events.hasId('m_old', 'message'), false);
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.target, e.outcome, e.detail]), [
    ['poll.skip', 't_1', 'skipped', { reason: 'older-than-window', count: 1 }],
  ]);
  assert.equal(JSON.stringify(auditLines(h)).includes('SENTINEL-OLD-TEXT-4471'), false, 'the audit line carries no text');
});

// P4 review I-4. Deferred threads have a budget of their own, equal to maxThreadsPerTick: with ten deferred threads and a budget of two,
// only two are read per tick.
test('with ten deferred threads and a budget of two, only two are read per tick', async (t) => {
  const conversations = Array.from({ length: 10 }, (_, i) =>
    conversation(`t_${i}`, { updatedTime: iso(NOW - (i + 1) * MINUTE), messageIds: [`m_${i}`] }),
  );
  const messages = Object.fromEntries(conversations.map((c, i) => [`m_${i}`, rawMessage(`m_${i}`)]));
  const graph = fakeGraph({ conversations, messages });
  const h = await setup(t, graph, { poll: { maxThreadsPerTick: 2 } });
  for (const c of conversations) h.state.set(`poll.deferred.${c.id}`, true);
  h.state.save();
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.equal(threads(graph.reads).length, 2, 'two deferred threads are read');
  assert.equal((await h.poller.tick()).status, 'ok');
  assert.equal(threads(graph.reads).length, 4, 'the next two are read on the next tick');
});

// P4 review M-6. A dropped future message stays dropped when its time passes: it is not stored, and its drop is audited once.
test('a dropped future message is not stored when its time passes, and its drop is audited once', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_far'] })],
    messages: { m_far: rawMessage('m_far', { at: NOW + 2 * DAY }) },
  });
  const h = await setup(t, graph);
  await h.poller.tick();
  h.clock.now = NOW + 25 * HOUR;
  await h.poller.tick();
  // A month later the thread changes again. The message is now in the past, inside the window, and it is not stored.
  h.clock.now = NOW + 31 * DAY;
  graph.world.conversations[0].updatedTime = iso(NOW + 31 * DAY - MINUTE);
  await h.poller.tick();
  assert.equal(h.events.hasId('m_far', 'message'), false);
  assert.equal(h.events.pending({ limit: 10 }).events.length, 0);
  assert.deepEqual(auditLines(h).map((e) => [e.action, e.detail]), [['poll.skip', 'future-time']], 'the drop is audited once');
});

// P4 review M-1 (an accepted reading, pinned here). A conversation that is still listed keeps its seen value, however old it is: A-28
// prunes by the time since a conversation was last listed, not by the age of the seen value.
test('a listed conversation keeps a seen value of any age (A-28 prunes by listing, M-1)', async (t) => {
  const old = iso(NOW - 400 * DAY);
  const graph = fakeGraph({ conversations: [conversation('t_1', { updatedTime: old, messageIds: [] })] });
  const h = await setup(t, graph);
  h.state.set('poll.seen.t_1', old);
  h.state.save();
  await h.poller.tick();
  assert.equal(h.state.get('poll.seen.t_1', null), old, 'the seen value of a listed conversation is kept');
});

// A poller with inert dependencies, for the checks that run when it is built.
function buildWith(overrides = {}) {
  return createPoller({
    getClient: () => null,
    owner: OWNER,
    events: { hasId: () => false, append: () => null, drainNotices: () => {} },
    state: { get: () => null, set: () => {}, save: () => {}, delete: () => {}, keys: () => [], drainNotices: () => {} },
    guard: { stop: () => {}, stopStatus: () => ({ stopped: false, kind: null }) },
    audit: { record: () => {} },
    config: { poll: { intervalMs: 60000, maxThreadsPerTick: 20, spacingMs: 600 } },
    sleep: async () => {},
    now: () => NOW,
    onInbound: () => {},
    ...overrides,
  });
}

test('poll settings outside their bounds are refused with the field name', () => {
  const valid = { intervalMs: 60000, maxThreadsPerTick: 20, spacingMs: 600 };
  assert.doesNotThrow(() => buildWith({ config: { poll: valid } }));
  const refused = [
    [{ ...valid, intervalMs: 0 }, 'poll.intervalMs'],
    [{ ...valid, intervalMs: '60000' }, 'poll.intervalMs'],
    [{ ...valid, intervalMs: 2147483648 }, 'poll.intervalMs'],
    [{ ...valid, maxThreadsPerTick: 0 }, 'poll.maxThreadsPerTick'],
    [{ ...valid, maxThreadsPerTick: 2.5 }, 'poll.maxThreadsPerTick'],
    [{ ...valid, spacingMs: 599 }, 'poll.spacingMs'],
    [{ ...valid, spacingMs: Number.NaN }, 'poll.spacingMs'],
    [{ ...valid, timeout: 5 }, 'poll.timeout'],
    [undefined, 'poll'],
  ];
  for (const [poll, field] of refused) {
    assert.throws(
      () => buildWith({ config: { poll } }),
      (err) => err instanceof ConfigError && err.field === field,
      `refused: ${field}`,
    );
  }
});

test('createPoller refuses a missing audit log, guard, owner or sleep', () => {
  assert.throws(() => buildWith({ audit: undefined }), TypeError);
  assert.throws(() => buildWith({ guard: {} }), TypeError);
  assert.throws(() => buildWith({ owner: 'owner-1' }), TypeError);
  assert.throws(() => buildWith({ sleep: undefined }), TypeError);
});

// ---------- A-11 (2026-10-23): the timer code and a restart ----------

const MAX_TIMER_MS = 2147483647;

// Replaces the global setTimeout and clearTimeout for one test. The poller takes no timer injection, so start and stop call
// the globals when they run. Each timer is recorded and is not run by Node: fire() runs the one live timer by hand, and waits
// for its callback. The globals are put back when the test ends.
function fakeTimers(t) {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const live = new Map();
  const made = [];
  const cleared = [];
  globalThis.setTimeout = (fn, ms, ...args) => {
    const handle = { id: made.length + 1 };
    live.set(handle, { fn, args });
    made.push({ handle, ms });
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    cleared.push(handle);
    live.delete(handle);
  };
  t.after(() => {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  });
  return {
    made,
    cleared,
    live,
    async fire() {
      assert.equal(live.size, 1, 'exactly one timer is live');
      const [[handle, timer]] = [...live.entries()];
      live.delete(handle);
      await timer.fn(...timer.args);
    },
  };
}

// Replaces process.emitWarning for one test, and returns the messages it was given.
function captureWarnings(t) {
  const real = process.emitWarning;
  const messages = [];
  process.emitWarning = (warning) => {
    messages.push(String(warning));
  };
  t.after(() => {
    process.emitWarning = real;
  });
  return messages;
}

test('start schedules one timer, due at once; a second start adds none; stop clears that timer', async (t) => {
  const timers = fakeTimers(t);
  const h = await setup(t, fakeGraph({ conversations: [] }));
  h.poller.start();
  assert.deepEqual(timers.made.map((timer) => timer.ms), [0]);
  h.poller.start();
  assert.equal(timers.made.length, 1, 'a second start while running adds no timer');
  h.poller.stop();
  assert.deepEqual(timers.cleared, [timers.made[0].handle], 'stop clears the timer that start made');
  assert.equal(timers.live.size, 0, 'no timer is left after stop');
  h.poller.stop();
  assert.equal(timers.cleared.length, 1, 'a second stop clears nothing');
});

test('a tick that throws does not stop the loop: the next timer is set at the interval, and the tick after it reads', async (t) => {
  const timers = fakeTimers(t);
  const warnings = captureWarnings(t);
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph, { poll: { intervalMs: 60000 } });
  // The first tick throws at its first step, before it reads anything.
  const drain = h.events.drainNotices;
  let failures = 1;
  h.events.drainNotices = (write) => {
    if (failures > 0) {
      failures -= 1;
      throw new Error(SENTINEL);
    }
    return drain(write);
  };
  h.poller.start();
  await timers.fire();
  assert.deepEqual(warnings, ['poll tick failed (Error)'], 'the warning carries the error name only');
  assert.equal(warnings.join('').includes(SENTINEL), false);
  assert.deepEqual(timers.made.map((timer) => timer.ms), [0, 60000], 'the loop set its next timer at the interval');
  await timers.fire();
  assert.deepEqual(threads(graph.reads), ['t_1'], 'the tick after the failure read the thread');
  assert.deepEqual(h.delivered.map((event) => event.id), ['m_1']);
  h.poller.stop();
  assert.equal(timers.live.size, 0);
});

test('stop during a tick: the tick finishes, and no timer is set after it', async (t) => {
  const timers = fakeTimers(t);
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const h = await setup(t, graph);
  graph.world.before = () => h.poller.stop();
  h.poller.start();
  await timers.fire();
  assert.equal(timers.live.size, 0, 'no timer is set after the stop');
  assert.equal(timers.made.length, 1, 'only the timer that start made');
  assert.deepEqual(h.delivered.map((event) => event.id), ['m_1'], 'the tick that was running finished');
});

test('no timer is longer than 2147483647 ms, and the largest allowed interval is used as it is', async (t) => {
  const timers = fakeTimers(t);
  const h = await setup(t, fakeGraph({ conversations: [] }), { poll: { intervalMs: MAX_TIMER_MS } });
  h.poller.start();
  await timers.fire();
  await timers.fire();
  assert.deepEqual(timers.made.map((timer) => timer.ms), [0, MAX_TIMER_MS, MAX_TIMER_MS]);
  assert.ok(timers.made.every((timer) => timer.ms <= MAX_TIMER_MS));
  h.poller.stop();
});

test('after a RATE_LIMITED the next timer is the doubled interval', async (t) => {
  const timers = fakeTimers(t);
  const graph = fakeGraph({ conversations: [] });
  graph.world.failures.set(LIST, new IgError('RATE_LIMITED', 'slow down', { status: 429 }));
  const h = await setup(t, graph, { poll: { intervalMs: 60000 } });
  h.poller.start();
  await timers.fire();
  assert.deepEqual(timers.made.map((timer) => timer.ms), [0, 120000]);
  h.poller.stop();
});

test('a message stored before a restart is not stored again by a poller over the same files', async (t) => {
  const graph = fakeGraph({
    conversations: [conversation('t_1', { messageIds: ['m_1'] })],
    messages: { m_1: rawMessage('m_1') },
  });
  const first = await setup(t, graph);
  assert.equal((await first.poller.tick()).status, 'ok');
  // The restart is a new state, event log, audit log, guard and poller over the same files. The thread changes, and its
  // first page still holds m_1, so the new poller reads the thread again and must not store m_1 a second time.
  graph.world.conversations[0].updatedTime = iso(NOW - 10 * MINUTE);
  const second = await setup(t, graph, { dir: first.dir });
  assert.equal((await second.poller.tick()).status, 'ok');
  assert.deepEqual(threads(graph.reads), ['t_1', 't_1'], 'the thread is read on both sides of the restart');
  assert.deepEqual(second.delivered, [], 'nothing is announced after the restart');
  assert.deepEqual(second.events.pending({ limit: 100 }).events.map((event) => event.id), ['m_1']);
  assert.deepEqual(graph.writes, []);
});
