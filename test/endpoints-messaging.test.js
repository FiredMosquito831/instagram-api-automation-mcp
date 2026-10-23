import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphClient } from '../src/graph/client.js';
import {
  conversationsList,
  conversationMessages,
  readConversations,
  readThread,
  sendMessage,
  privateReply,
  messageWindowOpen,
  privateReplyOpen,
} from '../src/graph/endpoints/messaging.js';

const IG_USER = '17841400000000001';
const RECIPIENT = '17841400000000002';
const COMMENT = '17870913679156914';
const CONVERSATION = 't_1234567890';
const SENT_ID = 'aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDAwMDAwMDAwMDI';
const MESSAGE_FIELDS = 'id,created_time,from,to,message';
const GRAPH_TIME = '2026-10-20T10:00:00+0000';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const NOW = Date.parse('2026-10-21T12:00:00.000Z');

const iso = (ms) => new Date(ms).toISOString();

// A fake client. It answers each call from a queue, in order, and records every call. An Error in the queue is thrown.
// Each answer has the shape of the real client: { data, usage }. The recorded options are the third argument of post,
// so a write that passed retryPost would show up in the test.
function fakeClient(queue) {
  const calls = [];
  const pending = [...queue];
  const answer = (method, path, record) => {
    calls.push({ method, path, ...record });
    if (pending.length === 0) throw new Error(`unexpected ${method} ${path}`);
    const next = pending.shift();
    if (next instanceof Error) throw next;
    return { data: next, usage: null };
  };
  return {
    calls,
    get: async (path, query) => answer('GET', path, { query }),
    post: async (path, body, options) => answer('POST', path, { body, options }),
    del: async (path, query) => answer('DELETE', path, { query }),
  };
}

test('sendMessage refuses text over 1000 bytes before any request', async () => {
  const client = fakeClient([]);
  const send = (text) => sendMessage(client, { igUserId: IG_USER, recipientId: RECIPIENT, text });
  await assert.rejects(send('a'.repeat(1001)), { kind: 'VALIDATION' });
  // 501 copies of a two-byte character is 1002 bytes, though it is only 501 characters.
  await assert.rejects(send('é'.repeat(501)), { kind: 'VALIDATION' });
  // 251 four-byte emoji is 1004 bytes.
  await assert.rejects(send('😀'.repeat(251)), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0, 'no request is made for an over-long text');
});

test('sendMessage accepts text of exactly 1000 bytes', async () => {
  const client = fakeClient([{ recipient_id: RECIPIENT, message_id: SENT_ID }, { recipient_id: RECIPIENT, message_id: SENT_ID }]);
  await sendMessage(client, { igUserId: IG_USER, recipientId: RECIPIENT, text: 'a'.repeat(1000) });
  await sendMessage(client, { igUserId: IG_USER, recipientId: RECIPIENT, text: 'é'.repeat(500) });
  assert.equal(client.calls.length, 2);
});

test('sendMessage posts the recipient and text as json, with no retryPost', async () => {
  const client = fakeClient([{ recipient_id: RECIPIENT, message_id: SENT_ID }]);
  const result = await sendMessage(client, { igUserId: IG_USER, recipientId: RECIPIENT, text: 'Hello' });
  assert.equal(client.calls[0].method, 'POST');
  assert.equal(client.calls[0].path, `${IG_USER}/messages`);
  assert.deepEqual(client.calls[0].body, { json: { recipient: { id: RECIPIENT }, message: { text: 'Hello' } } });
  assert.equal(client.calls[0].options, undefined, 'a write never passes retryPost');
  assert.deepEqual(result, { messageId: SENT_ID, recipientId: RECIPIENT });
});

test('sendMessage refuses a send that Graph does not confirm', async () => {
  // The success marker is message_id. A response without it, or with no body at all, is API_ERROR.
  for (const answer of [{ recipient_id: RECIPIENT }, { success: true }, null, { message_id: '' }]) {
    const client = fakeClient([answer]);
    await assert.rejects(
      sendMessage(client, { igUserId: IG_USER, recipientId: RECIPIENT, text: 'Hello' }),
      { kind: 'API_ERROR' },
    );
  }
});

test('sendMessage refuses blank text and bad ids before any request', async () => {
  const client = fakeClient([]);
  await assert.rejects(sendMessage(client, { igUserId: IG_USER, recipientId: RECIPIENT, text: '   ' }), { kind: 'VALIDATION' });
  await assert.rejects(sendMessage(client, { igUserId: IG_USER, recipientId: RECIPIENT, text: 42 }), { kind: 'VALIDATION' });
  await assert.rejects(sendMessage(client, { igUserId: IG_USER, recipientId: 17841400000000002, text: 'hi' }), { kind: 'VALIDATION' });
  await assert.rejects(sendMessage(client, { igUserId: 'owner', recipientId: RECIPIENT, text: 'hi' }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

test('conversationsList requests platform=instagram', async () => {
  const client = fakeClient([{ data: [{ id: CONVERSATION, updated_time: GRAPH_TIME }] }]);
  const result = await conversationsList(client, { igUserId: IG_USER });
  assert.equal(client.calls[0].method, 'GET');
  assert.equal(client.calls[0].path, `${IG_USER}/conversations`);
  assert.deepEqual(client.calls[0].query, { platform: 'instagram', limit: 20 });
  assert.deepEqual(result, [{ id: CONVERSATION, updatedTime: GRAPH_TIME }]);
});

test('conversationsList adds user_id when a user is given', async () => {
  const client = fakeClient([{ data: [] }]);
  const result = await conversationsList(client, { igUserId: IG_USER, userId: RECIPIENT, limit: 5 });
  assert.deepEqual(client.calls[0].query, { platform: 'instagram', limit: 5, user_id: RECIPIENT });
  assert.deepEqual(result, []);
});

test('conversationsList refuses bad ids and limits before any request', async () => {
  const client = fakeClient([]);
  await assert.rejects(conversationsList(client, { igUserId: 'owner' }), { kind: 'VALIDATION' });
  await assert.rejects(conversationsList(client, { igUserId: IG_USER, userId: 17841400000000002 }), { kind: 'VALIDATION' });
  await assert.rejects(conversationsList(client, { igUserId: IG_USER, userId: null }), { kind: 'VALIDATION' });
  await assert.rejects(conversationsList(client, { igUserId: IG_USER, limit: 0 }), { kind: 'VALIDATION' });
  await assert.rejects(conversationsList(client, { igUserId: IG_USER, limit: 101 }), { kind: 'VALIDATION' });
  await assert.rejects(conversationsList(client, { igUserId: IG_USER, limit: '5' }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

// Changed in fix round 3: a row without an updated time is no longer refused. Old assertion (removed):
//   await assert.rejects(conversationsList(fakeClient([{ data: [{ id: CONVERSATION }] }]), { igUserId: IG_USER }), { kind: 'API_ERROR' });
// New assertion: the row is returned with updatedTime null.
test('conversationsList refuses a row without an id, and gives a row without an updated time a null updatedTime', async () => {
  await assert.rejects(conversationsList(fakeClient([{ data: [{ updated_time: GRAPH_TIME }] }]), { igUserId: IG_USER }), { kind: 'API_ERROR' });
  await assert.rejects(conversationsList(fakeClient([{}]), { igUserId: IG_USER }), { kind: 'API_ERROR' });
  const result = await conversationsList(fakeClient([{ data: [{ id: CONVERSATION }] }]), { igUserId: IG_USER });
  assert.deepEqual(result, [{ id: CONVERSATION, updatedTime: null }]);
});

// Added in fix round 3 (m-2). One bad row does not stop the others.
test('a list with one conversation lacking updated_time returns the other conversations', async () => {
  const client = fakeClient([
    {
      data: [
        { id: 'c1', updated_time: GRAPH_TIME },
        { id: 'c2' },
        { id: 'c3', updated_time: '   ' },
        { id: 'c4', updated_time: GRAPH_TIME },
      ],
    },
  ]);
  const result = await conversationsList(client, { igUserId: IG_USER });
  assert.deepEqual(result, [
    { id: 'c1', updatedTime: GRAPH_TIME },
    { id: 'c2', updatedTime: null },
    { id: 'c3', updatedTime: null },
    { id: 'c4', updatedTime: GRAPH_TIME },
  ]);
  // A present time that is not text is still refused, because it cannot be read as a time.
  await assert.rejects(
    conversationsList(fakeClient([{ data: [{ id: 'c5', updated_time: 1729450000 }] }]), { igUserId: IG_USER }),
    { kind: 'API_ERROR' },
  );
});

test('conversationMessages reads the message ids, then each message, at most 20', async () => {
  const ids = Array.from({ length: 25 }, (_, i) => `m${i + 1}`);
  const client = fakeClient([
    { messages: { data: ids.map((id) => ({ id })) } },
    ...ids.slice(0, 20).map((id) => ({
      id,
      created_time: GRAPH_TIME,
      from: { id: RECIPIENT, username: 'fan' },
      to: { data: [{ id: IG_USER, username: 'owner' }] },
      message: `text ${id}`,
    })),
  ]);
  const result = await conversationMessages(client, { conversationId: CONVERSATION });
  assert.equal(client.calls.length, 21, 'one read of the conversation and twenty message reads');
  assert.equal(client.calls[0].path, CONVERSATION);
  assert.deepEqual(client.calls[0].query, { fields: 'messages' });
  for (const call of client.calls.slice(1)) assert.deepEqual(call.query, { fields: MESSAGE_FIELDS });
  assert.deepEqual(client.calls.slice(1).map((call) => call.path), ids.slice(0, 20));
  assert.equal(result.length, 20);
  assert.deepEqual(result[0], { id: 'm1', createdTime: GRAPH_TIME, fromId: RECIPIENT, toId: IG_USER, text: 'text m1' });
});

// Added in fix round 3 (m-3). One message with no created time does not fail its thread: that message has createdTime null.
test('a thread with one message lacking created_time returns the other messages, and that one has createdTime null', async () => {
  const client = fakeClient([
    { messages: { data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] } },
    { id: 'm1', from: { id: RECIPIENT }, to: { data: [{ id: IG_USER }] }, message: 'no time' },
    { id: 'm2', created_time: GRAPH_TIME, from: { id: RECIPIENT }, to: { data: [{ id: IG_USER }] }, message: 'two' },
    { id: 'm3', created_time: '  ', from: { id: RECIPIENT }, to: { data: [{ id: IG_USER }] }, message: 'blank time' },
  ]);
  const result = await conversationMessages(client, { conversationId: CONVERSATION });
  assert.deepEqual(result.map((m) => [m.id, m.createdTime]), [
    ['m1', null],
    ['m2', GRAPH_TIME],
    ['m3', null],
  ]);
  assert.equal(result[1].text, 'two');
  // A created time that is present but is not text is still refused, as before.
  const notText = fakeClient([
    { messages: { data: [{ id: 'm4' }] } },
    { id: 'm4', created_time: 1729450000, from: { id: RECIPIENT }, to: { data: [{ id: IG_USER }] }, message: 'x' },
  ]);
  await assert.rejects(conversationMessages(notText, { conversationId: CONVERSATION }), { kind: 'API_ERROR' });
});

test('conversationMessages refuses a limit over 20 or a non-integer limit before any request', async () => {
  const client = fakeClient([]);
  for (const limit of [0, 21, 1.5, '5']) {
    await assert.rejects(conversationMessages(client, { conversationId: CONVERSATION, limit }), { kind: 'VALIDATION' });
  }
  assert.equal(client.calls.length, 0);
});

test('conversationMessages refuses a conversation with no messages edge, or a message with no sender', async () => {
  await assert.rejects(conversationMessages(fakeClient([{}]), { conversationId: CONVERSATION }), { kind: 'API_ERROR' });
  const noSender = fakeClient([
    { messages: { data: [{ id: 'm1' }] } },
    { id: 'm1', created_time: GRAPH_TIME, message: 'hi' },
  ]);
  await assert.rejects(conversationMessages(noSender, { conversationId: CONVERSATION }), { kind: 'API_ERROR' });
});

test('privateReply sends recipient comment_id', async () => {
  const client = fakeClient([{ recipient_id: RECIPIENT, message_id: SENT_ID }]);
  const result = await privateReply(client, { igUserId: IG_USER, commentId: COMMENT, text: 'Thanks for asking!' });
  assert.equal(client.calls[0].method, 'POST');
  assert.equal(client.calls[0].path, `${IG_USER}/messages`);
  assert.deepEqual(client.calls[0].body, {
    json: { recipient: { comment_id: COMMENT }, message: { text: 'Thanks for asking!' } },
  });
  assert.equal(client.calls[0].options, undefined, 'a write never passes retryPost');
  assert.deepEqual(result, { messageId: SENT_ID, commentId: COMMENT });
});

test('privateReply applies the same 1000-byte limit before any request', async () => {
  const client = fakeClient([]);
  await assert.rejects(privateReply(client, { igUserId: IG_USER, commentId: COMMENT, text: 'a'.repeat(1001) }), { kind: 'VALIDATION' });
  await assert.rejects(privateReply(client, { igUserId: IG_USER, commentId: COMMENT, text: 'é'.repeat(501) }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

test('privateReply refuses a reply that Graph does not confirm, and bad input before any request', async () => {
  await assert.rejects(
    privateReply(fakeClient([{ recipient_id: RECIPIENT }]), { igUserId: IG_USER, commentId: COMMENT, text: 'hi' }),
    { kind: 'API_ERROR' },
  );
  const client = fakeClient([]);
  await assert.rejects(privateReply(client, { igUserId: IG_USER, commentId: 'abc', text: 'hi' }), { kind: 'VALIDATION' });
  await assert.rejects(privateReply(client, { igUserId: IG_USER, commentId: COMMENT, text: '  ' }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

test('messageWindowOpen is true just inside 24 hours and false at 24 hours', () => {
  assert.equal(messageWindowOpen({ lastInboundAt: iso(NOW - DAY_MS + 1), now: NOW }), true);
  assert.equal(messageWindowOpen({ lastInboundAt: iso(NOW - DAY_MS), now: NOW }), false);
});

test('messageWindowOpen is false when there is no inbound message', () => {
  assert.equal(messageWindowOpen({ lastInboundAt: null, now: NOW }), false);
});

test('messageWindowOpen refuses a future, unreadable or non-string time rather than guessing', () => {
  assert.throws(() => messageWindowOpen({ lastInboundAt: iso(NOW + 1000), now: NOW }), { kind: 'VALIDATION' });
  assert.throws(() => messageWindowOpen({ lastInboundAt: 'yesterday', now: NOW }), { kind: 'VALIDATION' });
  assert.throws(() => messageWindowOpen({ lastInboundAt: NOW - 1, now: NOW }), { kind: 'VALIDATION' });
  assert.throws(() => messageWindowOpen({ lastInboundAt: iso(NOW), now: '2026-10-21' }), { kind: 'VALIDATION' });
  assert.throws(() => messageWindowOpen({ lastInboundAt: iso(NOW), now: Number.NaN }), { kind: 'VALIDATION' });
  assert.throws(() => messageWindowOpen({ lastInboundAt: undefined, now: NOW }), { kind: 'VALIDATION' });
});

test('privateReplyOpen is true just inside 7 days and false at 7 days', () => {
  assert.equal(privateReplyOpen({ commentCreatedAt: iso(NOW - WEEK_MS + 1), now: NOW }), true);
  assert.equal(privateReplyOpen({ commentCreatedAt: iso(NOW - WEEK_MS), now: NOW }), false);
});

test('privateReplyOpen is false when the comment time is unknown, and refuses a future one', () => {
  assert.equal(privateReplyOpen({ commentCreatedAt: null, now: NOW }), false);
  assert.throws(() => privateReplyOpen({ commentCreatedAt: iso(NOW + 1000), now: NOW }), { kind: 'VALIDATION' });
});

test('the windows read the Graph timestamp form (+0000) and the ISO form (+00:00)', () => {
  // Graph writes comment times as 2026-10-14T12:00:00+0000, which is exactly 7 days before NOW.
  assert.equal(privateReplyOpen({ commentCreatedAt: '2026-10-14T12:00:01+0000', now: NOW }), true);
  assert.equal(privateReplyOpen({ commentCreatedAt: '2026-10-14T12:00:00+0000', now: NOW }), false);
  assert.equal(messageWindowOpen({ lastInboundAt: '2026-10-20T12:00:01+00:00', now: NOW }), true);
});

// The real client, over a fake fetch that makes no network call. A send that fails with a status the client retries for
// reads (500 or 429) is still sent once, because a send is a write and the client retries only when retryPost is true.
test('a send that fails with a retryable status is sent once, through the real client', async () => {
  const config = {
    graph: { version: 'v26.0', instagramBase: 'https://graph.instagram.com', facebookBase: 'https://graph.facebook.com' },
  };
  for (const [status, kind] of [
    [500, 'API_ERROR'],
    [429, 'RATE_LIMITED'],
  ]) {
    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ error: { message: 'try later', code: 2 } }), {
        status,
        headers: { 'content-type': 'application/json', 'retry-after': '1' },
      });
    };
    const client = createGraphClient({ config, loginProduct: 'instagram', token: 'test-token', fetchImpl, sleep: async () => {} });
    await assert.rejects(sendMessage(client, { igUserId: IG_USER, recipientId: RECIPIENT, text: 'Hello' }), { kind });
    assert.equal(requests.length, 1, `HTTP ${status} is not retried for a send`);
    assert.equal(requests[0].init.method, 'POST');
    assert.equal(requests[0].url, `https://graph.instagram.com/v26.0/${IG_USER}/messages`);
    assert.deepEqual(JSON.parse(requests[0].init.body), { recipient: { id: RECIPIENT }, message: { text: 'Hello' } });
  }
});

// A day that its month does not have is refused. Date.parse would move it to a later date, so the time would read as more
// recent than it is. The message names the field and does not repeat the value.
test('an impossible calendar day is refused, not moved to a later date', () => {
  for (const value of ['2026-09-31T12:00:00+0000', '2026-04-31T12:00:00Z']) {
    assert.throws(
      () => privateReplyOpen({ commentCreatedAt: value, now: NOW }),
      (err) =>
        err.kind === 'VALIDATION' &&
        err.message.includes('commentCreatedAt') &&
        err.message.includes('not a real calendar date') &&
        !err.message.includes(value),
    );
  }
});

test('February 29 is refused in a common year and accepted in a leap year', () => {
  assert.throws(() => messageWindowOpen({ lastInboundAt: '2026-02-29T12:00:00Z', now: NOW }), { kind: 'VALIDATION' });
  assert.equal(messageWindowOpen({ lastInboundAt: '2028-02-29T12:00:00Z', now: Date.parse('2028-02-29T13:00:00Z') }), true);
});

test('a window check given an impossible lastInboundAt throws, rather than reading open', () => {
  // Read as 1 October, this time is 23 hours old at now, so the window would read open. It must throw instead.
  const now = Date.parse('2026-10-02T11:00:00Z');
  assert.throws(() => messageWindowOpen({ lastInboundAt: '2026-09-31T12:00:00Z', now }), { kind: 'VALIDATION' });
});

// Added in fix round 4 (N-1). A month of 00 or 13, and a day of 00, are refused by the calendar check, before Date.parse
// is used. The message names the calendar check, so the test fails if the lower bounds are missing.
test('a month outside 1 to 12, or a day of 00, is refused as not a real calendar date; 2028-02-29 is accepted', () => {
  const now = Date.parse('2028-03-01T00:00:00Z');
  for (const value of ['2026-02-00T12:00:00+00:00', '2026-00-15T12:00:00+00:00', '2026-13-15T12:00:00+00:00', '2026-04-31T12:00:00+00:00', '2026-02-29T12:00:00+00:00']) {
    assert.throws(
      () => messageWindowOpen({ lastInboundAt: value, now }),
      (err) => err.kind === 'VALIDATION' && err.message.includes('not a real calendar date'),
      value,
    );
  }
  assert.equal(messageWindowOpen({ lastInboundAt: '2028-02-29T12:00:00+00:00', now: Date.parse('2028-02-29T13:00:00Z') }), true);
});

// ---------- P2 (2026-10-22) ----------

test('A-18 a conversation id made only of dots is refused locally with VALIDATION, and no request is made', async () => {
  const client = fakeClient([]);
  for (const conversationId of ['.', '..', '...']) {
    await assert.rejects(conversationMessages(client, { conversationId }), { kind: 'VALIDATION' }, conversationId);
  }
  assert.equal(client.calls.length, 0);
});

test('A-18 a message id from a response that is made only of dots is API_ERROR', async () => {
  const client = fakeClient([{ messages: { data: [{ id: '...' }] } }]);
  await assert.rejects(conversationMessages(client, { conversationId: CONVERSATION }), { kind: 'API_ERROR' });
});

test('A-13 the messaging endpoints refuse a null options argument with VALIDATION, and make no request', async () => {
  const client = fakeClient([]);
  await assert.rejects(conversationsList(client, null), { kind: 'VALIDATION' });
  await assert.rejects(conversationMessages(client, null), { kind: 'VALIDATION' });
  await assert.rejects(sendMessage(client, null), { kind: 'VALIDATION' });
  await assert.rejects(privateReply(client, null), { kind: 'VALIDATION' });
  assert.throws(() => messageWindowOpen(null), { kind: 'VALIDATION' });
  assert.throws(() => privateReplyOpen(null), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

// ---------- P3 (2026-10-22) ----------

const UNIX_SECONDS = 1792663200; // 2026-10-22T10:00:00Z
const UNIX_MS = 1792663200000;
const INSTANT_ISO = '2026-10-22T10:00:00.000Z';
const SENDER = { from: { id: RECIPIENT }, to: { data: [{ id: IG_USER }] } };

// A message row as the messages edge returns it, with the message fields in the page (P3, one request per page).
const edgeRow = (id) => ({ id, created_time: UNIX_SECONDS, ...SENDER, message: id });

test('A-25 the four time forms of one instant give the same ISO string in UTC, for a conversation and a message', async () => {
  const forms = ['2026-10-22T10:00:00Z', '2026-10-22T10:00:00+0000', UNIX_SECONDS, UNIX_MS, String(UNIX_SECONDS), String(UNIX_MS)];
  for (const updated_time of forms) {
    const result = await readConversations(fakeClient([{ data: [{ id: CONVERSATION, updated_time }] }]), { igUserId: IG_USER });
    assert.deepEqual(result.items, [{ id: CONVERSATION, updatedTime: INSTANT_ISO }], `updated_time ${JSON.stringify(updated_time)}`);
  }
  for (const created_time of forms) {
    const client = fakeClient([{ data: [{ id: 'm1', created_time, ...SENDER, message: 'hi' }] }]);
    const thread = await readThread(client, { conversationId: CONVERSATION });
    assert.equal(thread.items[0].createdTime, INSTANT_ISO, `created_time ${JSON.stringify(created_time)}`);
    assert.equal(client.calls.length, 1, 'the page is one request, with no per-message read');
  }
});

test('A-25 a time that is not a number, a numeric string or an ISO time with a zone is malformed: skipped and counted', async () => {
  const bad = [
    {},
    true,
    [],
    -5,
    0,
    Number.NaN,
    9e15,
    400000000000,
    'yesterday',
    '2026-10-22T10:00:00',
    '1e12',
    '-1792663200',
    ' 1792663200',
    '2026-02-30T10:00:00Z',
  ];
  for (const updated_time of bad) {
    const result = await readConversations(
      fakeClient([{ data: [{ id: 'bad', updated_time }, { id: 'good', updated_time: UNIX_SECONDS }] }]),
      { igUserId: IG_USER },
    );
    assert.deepEqual(result.items, [{ id: 'good', updatedTime: INSTANT_ISO }], `updated_time ${String(updated_time)}`);
    assert.equal(result.skippedConversations, 1, `updated_time ${String(updated_time)}`);
  }
});

test('A-21 one malformed message in a page gives the other messages and skippedMessages 1, and never stores a guessed time', async () => {
  const client = fakeClient([
    {
      data: [
        { id: 'm1', created_time: UNIX_SECONDS, ...SENDER, message: 'one' },
        { id: 'm2', created_time: 'yesterday', ...SENDER, message: 'two' },
        { id: 'm3', created_time: '2026-10-22T10:00:01Z', ...SENDER, message: 'three' },
      ],
    },
  ]);
  const thread = await readThread(client, { conversationId: CONVERSATION });
  assert.deepEqual(thread.items.map((m) => m.id), ['m1', 'm3']);
  assert.equal(thread.skippedMessages, 1);
  assert.equal(thread.truncated, false);
  assert.equal(thread.reason, null);
  assert.equal(client.calls.length, 1, 'one page is one request');
});

test('A-21 a message with no sender, and a row with an unusable id, are skipped and counted, and the page is kept', async () => {
  const client = fakeClient([
    {
      data: [
        { id: 'm1', created_time: UNIX_SECONDS, to: { data: [{ id: IG_USER }] }, message: 'no sender' },
        { id: '...', created_time: UNIX_SECONDS, ...SENDER, message: 'dots' },
        { id: 'm3', created_time: UNIX_SECONDS, ...SENDER, message: 'ok' },
      ],
    },
  ]);
  const thread = await readThread(client, { conversationId: CONVERSATION });
  assert.deepEqual(thread.items.map((m) => m.id), ['m3']);
  assert.equal(thread.skippedMessages, 2);
  assert.equal(client.calls.length, 1);
});

test('A-21 a message with no created_time keeps createdTime null, and is not counted as skipped', async () => {
  const client = fakeClient([{ data: [{ id: 'm1', ...SENDER, message: 'no time' }] }]);
  const thread = await readThread(client, { conversationId: CONVERSATION });
  assert.deepEqual(thread.items, [{ id: 'm1', createdTime: null, fromId: RECIPIENT, toId: IG_USER, text: 'no time' }]);
  assert.equal(thread.skippedMessages, 0);
});

// Changed in the P3 fix round (ruling 1) and the per-message change. The cursor goes on the messages edge, and the edge
// returns the message fields itself, so one page is one request. Old requests (removed): GET {conversation} with
// fields=messages, the same node with after on the second page, and then one GET per message id. New requests: GET
// {conversation}/messages with fields=id,created_time,from,to,message and limit=100, with after on the next page, and no
// per-id read. The pages are merged in the order Graph returns them.
test('readThread follows the messages edge with the after cursor, merges the pages in order, and never requests the next link', async () => {
  const next = 'https://graph.instagram.com/v26.0/t_1234567890/messages?fields=id&after=e2&access_token=SECRET';
  const client = fakeClient([
    { data: [edgeRow('m1'), edgeRow('m2')], paging: { next, cursors: { after: 'e2' } } },
    { data: [edgeRow('m3')] },
  ]);
  const thread = await readThread(client, { conversationId: CONVERSATION });
  assert.deepEqual(
    client.calls.map((call) => [call.path, call.query]),
    [
      [`${CONVERSATION}/messages`, { fields: MESSAGE_FIELDS, limit: 100 }],
      [`${CONVERSATION}/messages`, { fields: MESSAGE_FIELDS, limit: 100, after: 'e2' }],
    ],
  );
  assert.deepEqual(thread.items.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal(thread.truncated, false);
  assert.equal(JSON.stringify(client.calls).includes('access_token'), false, 'no token appears in any request');
  assert.equal(JSON.stringify(client.calls).includes('SECRET'), false);
});

test('P3 one page is one request: a thread of 250 messages across three pages makes three requests and no per-id request', async () => {
  const client = fakeClient([
    {
      data: Array.from({ length: 100 }, (_, i) => edgeRow(`a${i}`)),
      paging: { next: 'https://x?access_token=SECRET', cursors: { after: 'c1' } },
    },
    {
      data: Array.from({ length: 100 }, (_, i) => edgeRow(`b${i}`)),
      paging: { next: 'https://x?access_token=SECRET', cursors: { after: 'c2' } },
    },
    { data: Array.from({ length: 50 }, (_, i) => edgeRow(`c${i}`)) },
  ]);
  const thread = await readThread(client, { conversationId: CONVERSATION });
  assert.equal(client.calls.length, 3, 'three edge requests');
  assert.ok(client.calls.every((call) => call.path === `${CONVERSATION}/messages`), 'no per-id request');
  assert.deepEqual(client.calls.map((call) => call.query.after), [undefined, 'c1', 'c2']);
  assert.equal(thread.items.length, 250);
  assert.equal(thread.items[0].id, 'a0');
  assert.equal(thread.items[249].id, 'c49');
  assert.equal(thread.truncated, false);
});

test('P3 a malformed item in a page is skipped and counted, and the rest of the page is kept', async () => {
  const client = fakeClient([
    { data: [edgeRow('m1'), { id: 'm2', created_time: 'yesterday', ...SENDER, message: 'bad' }, edgeRow('m3')] },
  ]);
  const thread = await readThread(client, { conversationId: CONVERSATION });
  assert.deepEqual(thread.items.map((m) => m.id), ['m1', 'm3']);
  assert.equal(thread.skippedMessages, 1);
  assert.equal(client.calls.length, 1);
});

test('readThread stops at maxItems and reports truncated; a maxItems outside 1 to 1000 is refused before any request', async () => {
  const client = fakeClient([{ data: [edgeRow('m1'), edgeRow('m2')] }]);
  const thread = await readThread(client, { conversationId: CONVERSATION, maxItems: 1 });
  assert.deepEqual(thread.items.map((m) => m.id), ['m1']);
  assert.equal(thread.truncated, true);
  assert.equal(thread.reason, 'more items exist beyond the item limit');
  const none = fakeClient([]);
  for (const maxItems of [0, 1001, 1.5, '5', null]) {
    await assert.rejects(readThread(none, { conversationId: CONVERSATION, maxItems }), { kind: 'VALIDATION' }, `maxItems ${String(maxItems)}`);
  }
  assert.equal(none.calls.length, 0);
});

test('readConversations follows paging.next, keeps limit and user_id on every page, and never requests the next link', async () => {
  const client = fakeClient([
    {
      data: [{ id: 'c1', updated_time: UNIX_SECONDS }],
      paging: { next: 'https://graph.instagram.com/v26.0/x?access_token=SECRET', cursors: { after: 'k2' } },
    },
    { data: [{ id: 'c2', updated_time: UNIX_SECONDS }] },
  ]);
  const result = await readConversations(client, { igUserId: IG_USER, userId: RECIPIENT, limit: 1 });
  assert.deepEqual(client.calls.map((call) => call.query), [
    { platform: 'instagram', limit: 1, user_id: RECIPIENT },
    { platform: 'instagram', limit: 1, user_id: RECIPIENT, after: 'k2' },
  ]);
  assert.deepEqual(result.items.map((c) => c.id), ['c1', 'c2']);
  assert.equal(result.truncated, false);
  assert.equal(JSON.stringify(client.calls).includes('SECRET'), false);
});

test('a malformed conversation row is skipped and counted in skippedConversations, and the others are kept', async () => {
  const client = fakeClient([
    { data: [{ id: 'c1', updated_time: UNIX_SECONDS }, { updated_time: UNIX_SECONDS }, { id: 'c3', updated_time: UNIX_SECONDS }, 'not-an-object'] },
  ]);
  const result = await readConversations(client, { igUserId: IG_USER });
  assert.deepEqual(result.items.map((c) => c.id), ['c1', 'c3']);
  assert.equal(result.skippedConversations, 2);
});

test('the first-page conversationMessages read still refuses a whole thread on a structurally malformed message, as the poller expects until P4', async () => {
  // A message with no sender cannot be classified, so the first-page read refuses the thread (as before P3). Its time is not
  // checked here: the first-page read passes a time through as text, and the poller's event log decides.
  const client = fakeClient([
    { messages: { data: [{ id: 'm1' }, { id: 'm2' }] } },
    { id: 'm1', created_time: UNIX_SECONDS, ...SENDER, message: 'one' },
    { id: 'm2', created_time: 'yesterday', to: { data: [{ id: IG_USER }] }, message: 'two' },
  ]);
  await assert.rejects(conversationMessages(client, { conversationId: CONVERSATION }), { kind: 'API_ERROR' });
});

test('the first-page conversationMessages read passes a time through as text, for the poller to decide', async () => {
  const client = fakeClient([
    { messages: { data: [{ id: 'm1' }] } },
    { id: 'm1', created_time: 'yesterday', ...SENDER, message: 'one' },
  ]);
  const result = await conversationMessages(client, { conversationId: CONVERSATION });
  assert.equal(result[0].createdTime, 'yesterday');
});

// Ruling 2 (P3 fix round): the paged reads ask for the largest page the endpoint allows, 100. Old defaults (removed): 20 for
// readConversations; readThread had no page size and read the conversation node. Changed in the per-message round: the
// edge query is fields=id,created_time,from,to,message (old: fields=id).
test('P3 fix the paged conversation and message reads ask for pages of 100 by default', async () => {
  const conversations = fakeClient([{ data: [{ id: CONVERSATION, updated_time: UNIX_SECONDS }] }]);
  await readConversations(conversations, { igUserId: IG_USER });
  assert.deepEqual(conversations.calls[0].query, { platform: 'instagram', limit: 100 });
  const thread = fakeClient([{ data: [] }]);
  await readThread(thread, { conversationId: CONVERSATION });
  assert.deepEqual(thread.calls[0].query, { fields: MESSAGE_FIELDS, limit: 100 });
});

// M-4 (P3 review): each page is asked only for the items still wanted, so a bound falls at a page end and gives nextAfter.
// Old behaviour (removed): every page asked for 100, so a bound of 150 stopped inside the second page with no cursor.
test('M-4 readThread asks each page only for the items still wanted, so a bound ends at a page end and gives nextAfter', async () => {
  const client = fakeClient([
    {
      data: Array.from({ length: 100 }, (_, i) => edgeRow(`a${i}`)),
      paging: { cursors: { after: 'c1' }, next: 'https://x?access_token=SECRET' },
    },
    {
      data: Array.from({ length: 50 }, (_, i) => edgeRow(`b${i}`)),
      paging: { cursors: { after: 'c2' }, next: 'https://x?access_token=SECRET' },
    },
  ]);
  const thread = await readThread(client, { conversationId: CONVERSATION, maxItems: 150 });
  assert.deepEqual(
    client.calls.map((call) => call.query),
    [
      { fields: MESSAGE_FIELDS, limit: 100 },
      { fields: MESSAGE_FIELDS, limit: 50, after: 'c1' },
    ],
  );
  assert.equal(thread.items.length, 150);
  assert.deepEqual([thread.truncated, thread.reason, thread.nextAfter], [true, 'more items exist beyond the item limit', 'c2']);
  assert.equal(JSON.stringify(client.calls).includes('SECRET'), false);
});

// M-4 (P3 review): readThread starts from the after cursor it is given, and refuses an after that is not a cursor string.
test('M-4 readThread starts from the after cursor it is given, and refuses an after that is not a cursor string', async () => {
  const client = fakeClient([{ data: [edgeRow('m9')] }]);
  const thread = await readThread(client, { conversationId: CONVERSATION, after: 'k7' });
  assert.deepEqual(client.calls[0].query, { fields: MESSAGE_FIELDS, limit: 100, after: 'k7' });
  assert.deepEqual(thread.items.map((m) => m.id), ['m9']);
  const none = fakeClient([]);
  for (const after of ['', 5]) {
    await assert.rejects(readThread(none, { conversationId: CONVERSATION, after }), { kind: 'VALIDATION' }, `after ${String(after)}`);
  }
  assert.equal(none.calls.length, 0);
});
