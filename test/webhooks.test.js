import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createAudit } from '../src/audit.js';
import { IgError } from '../src/errors.js';
import { createEventLog } from '../src/events.js';
import { createState } from '../src/state.js';
import {
  createWebhookHandler,
  parseEvents,
  readRawBody,
  verifyChallenge,
  verifySignature,
} from '../src/webhooks.js';

const APP_SECRET = 'app-secret-for-tests';
const VERIFY_TOKEN = 'verify-token-for-tests';
// The owner's igUserId: a string of digits, as the handler requires.
const OWNER_ID = '1784100000000001';
const T0 = Date.parse('2026-10-20T12:00:00.000Z');
const FIVE_MINUTES_MS = 5 * 60 * 1000;

// The header value as Meta sends it: sha256= then the hex HMAC-SHA256 of the raw body.
function sign(rawBody, secret = APP_SECRET) {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function bodyOf(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

// A message from a user. The timestamp is in milliseconds, as Meta sends it.
function inbound(mid, { senderId = 'user-1', text = `hello ${mid}`, timestamp = T0 } = {}) {
  return { sender: { id: senderId }, recipient: { id: 'owner-1' }, timestamp, message: { mid, text } };
}

// One messaging item that carries the given event key, such as read, reaction or postback.
function messagingEvent(key, value) {
  return { sender: { id: 'user-1' }, recipient: { id: 'owner-1' }, timestamp: T0, [key]: value };
}

function messagingPayload(...messaging) {
  return { object: 'instagram', entry: [{ id: 'owner-1', time: T0, messaging }] };
}

function changesPayload(...changes) {
  return { object: 'instagram', entry: [{ id: 'owner-1', time: T0, changes }] };
}

// A temporary directory that is removed when the test ends.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-webhooks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Opens the handler over the files in dir: the state, the events and the audit log. A second open over the same dir is
// a restart.
async function openHandler(dir, clock) {
  const state = await createState({ file: join(dir, 'state.json') });
  const events = createEventLog({ file: join(dir, 'events.jsonl'), state, now: () => clock.now });
  const audit = createAudit({ file: join(dir, 'audit.jsonl'), now: () => clock.now });
  const handle = createWebhookHandler({
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    owner: OWNER_ID,
    events,
    audit,
    now: () => clock.now,
  });
  return { handle, events, audit };
}

// A handler over a real event log, a real state file and a real audit file, in a new directory. The clock is a value
// the test moves.
async function handlerOver(t) {
  const dir = tempDir(t);
  const clock = { now: T0 };
  return { clock, ...(await openHandler(dir, clock)) };
}

// A POST as Meta sends it, signed over the raw body. Pass another signature to test a bad one.
function signedPost(rawBody, { signature = sign(rawBody) } = {}) {
  return { method: 'POST', headers: { 'x-hub-signature-256': signature }, query: {}, rawBody };
}

function storedEvents(events) {
  return events.pending({ limit: 100 }).events;
}

// A readable stream over the given chunks, as an in-memory request body.
function bodyStream(chunks) {
  return Readable.from(chunks);
}

test('handshake echoes hub.challenge when the verify token matches', () => {
  const query = { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' };
  assert.deepStrictEqual(verifyChallenge(query, { verifyToken: VERIFY_TOKEN }), { status: 200, body: '1158201444' });
});

test('handshake returns 403 for a wrong verify token', () => {
  for (const token of ['wrong-token', VERIFY_TOKEN.slice(1), `${VERIFY_TOKEN} `, '']) {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '1158201444' };
    assert.equal(verifyChallenge(query, { verifyToken: VERIFY_TOKEN }).status, 403, `token "${token}"`);
  }
  const noToken = { 'hub.mode': 'subscribe', 'hub.challenge': '1158201444' };
  assert.equal(verifyChallenge(noToken, { verifyToken: VERIFY_TOKEN }).status, 403);
});

test('handshake refuses a wrong mode, a repeated parameter, a missing challenge and an empty configured token', () => {
  const good = { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '42' };
  const options = { verifyToken: VERIFY_TOKEN };
  assert.equal(verifyChallenge({ ...good, 'hub.mode': 'unsubscribe' }, options).status, 403);
  assert.equal(verifyChallenge({ ...good, 'hub.verify_token': [VERIFY_TOKEN, VERIFY_TOKEN] }, options).status, 403);
  assert.equal(verifyChallenge({ ...good, 'hub.challenge': undefined }, options).status, 403);
  assert.equal(verifyChallenge({ ...good, 'hub.verify_token': '' }, { verifyToken: '' }).status, 403);
});

test('the handshake through the handler echoes the challenge, and refuses a wrong verify token', async (t) => {
  const { handle } = await handlerOver(t);
  const query = (token) => ({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '777' });
  assert.deepStrictEqual(await handle({ method: 'GET', headers: {}, query: query(VERIFY_TOKEN) }), {
    status: 200,
    body: '777',
  });
  assert.deepStrictEqual(await handle({ method: 'GET', headers: {}, query: query('wrong-token') }), {
    status: 403,
    body: 'Forbidden',
  });
});

test('signature check accepts the HMAC of the raw body and rejects a tampered body', () => {
  const rawBody = bodyOf(messagingPayload(inbound('m1')));
  const signatureHeader = sign(rawBody);
  assert.equal(verifySignature({ rawBody, signatureHeader, appSecret: APP_SECRET }), true);
  const tampered = Buffer.from(rawBody.toString('utf8').replace('hello m1', 'hello m2'), 'utf8');
  assert.equal(verifySignature({ rawBody: tampered, signatureHeader, appSecret: APP_SECRET }), false);
  const otherSecret = sign(rawBody, 'another-secret');
  assert.equal(verifySignature({ rawBody, signatureHeader: otherSecret, appSecret: APP_SECRET }), false);
});

test('signature check refuses a missing header, a header without the prefix, and a header of another length', () => {
  const rawBody = bodyOf(messagingPayload(inbound('m1')));
  const hex = sign(rawBody).slice('sha256='.length);
  const options = { rawBody, appSecret: APP_SECRET };
  assert.equal(verifySignature({ ...options, signatureHeader: undefined }), false);
  assert.equal(verifySignature({ ...options, signatureHeader: hex }), false);
  assert.equal(verifySignature({ ...options, signatureHeader: `sha256=${hex}00` }), false);
  assert.equal(verifySignature({ ...options, signatureHeader: 'sha256=' }), false);
});

test('duplicate delivery stores one event', async (t) => {
  const { handle, events } = await handlerOver(t);
  const rawBody = bodyOf(messagingPayload(inbound('m1')));
  assert.deepStrictEqual(await handle(signedPost(rawBody)), { status: 200, body: 'EVENT_RECEIVED' });
  assert.deepStrictEqual(await handle(signedPost(rawBody)), { status: 200, body: 'EVENT_RECEIVED' });
  const [stored] = storedEvents(events);
  assert.deepStrictEqual(storedEvents(events).map((event) => event.id), ['m1']);
  assert.equal(stored.kind, 'message');
  assert.equal(stored.senderId, 'user-1');
  assert.equal(stored.text, 'hello m1');

  // A message repeated inside one delivery is stored once as well.
  await handle(signedPost(bodyOf(messagingPayload(inbound('m2'), inbound('m2')))));
  assert.deepStrictEqual(storedEvents(events).map((event) => event.id), ['m1', 'm2']);
});

test('dedupe holds across a restart', async (t) => {
  const dir = tempDir(t);
  const clock = { now: T0 };
  const before = await openHandler(dir, clock);
  const rawBody = bodyOf(messagingPayload(inbound('m1')));
  await before.handle(signedPost(rawBody));
  // A restart is a new state, event log and audit log over the same files.
  const after = await openHandler(dir, clock);
  assert.deepStrictEqual(await after.handle(signedPost(rawBody)), { status: 200, body: 'EVENT_RECEIVED' });
  assert.deepStrictEqual(storedEvents(after.events).map((event) => event.id), ['m1']);
});

test('echo and self messages are not stored as inbound', async (t) => {
  const echo = { ...inbound('m-echo'), message: { mid: 'm-echo', text: 'sent by the owner', is_echo: true } };
  const self = { ...inbound('m-self'), message: { mid: 'm-self', text: 'sent by this account', is_self: true } };
  // The flag on the item itself is read too.
  const itemEcho = { ...inbound('m-item-echo'), is_echo: true };
  const all = messagingPayload(echo, self, itemEcho);
  assert.deepStrictEqual(parseEvents(all), { events: [], unknown: 0, unstoredMentions: [], oddFlags: [] });
  const { handle, events } = await handlerOver(t);
  assert.deepStrictEqual(await handle(signedPost(bodyOf(all))), {
    status: 200,
    body: 'EVENT_RECEIVED',
  });
  assert.deepStrictEqual(storedEvents(events), []);
});

test('deleted and edited messages are counted as unknown', async (t) => {
  const deleted = { ...inbound('m-del'), message: { mid: 'm-del', text: 'gone', is_deleted: true } };
  const edited = {
    sender: { id: 'user-1' },
    recipient: { id: 'owner-1' },
    timestamp: T0,
    message_edit: { mid: 'm-edit', text: 'changed', num_edit: 1 },
  };
  const deletedItem = { ...inbound('m-del2'), is_deleted: true };
  const all = messagingPayload(deleted, edited, deletedItem);
  assert.deepStrictEqual(parseEvents(all), { events: [], unknown: 3, unstoredMentions: [], oddFlags: [] });
  const { handle, events } = await handlerOver(t);
  await handle(signedPost(bodyOf(all)));
  assert.deepStrictEqual(storedEvents(events), []);
});

test('bad signature returns 403 and stores nothing', async (t) => {
  const { handle, events } = await handlerOver(t);
  const rawBody = bodyOf(messagingPayload(inbound('m1')));
  const wrongSecret = await handle(signedPost(rawBody, { signature: sign(rawBody, 'wrong-secret') }));
  assert.deepStrictEqual(wrongSecret, { status: 403, body: 'Forbidden' });
  const tampered = bodyOf(messagingPayload(inbound('m1', { text: 'changed in transit' })));
  const tamperedBody = await handle(signedPost(tampered, { signature: sign(rawBody) }));
  assert.deepStrictEqual(tamperedBody, { status: 403, body: 'Forbidden' });
  const unsigned = await handle({ method: 'POST', headers: {}, query: {}, rawBody });
  assert.equal(unsigned.status, 403);
  assert.deepStrictEqual(storedEvents(events), []);
});

test('a flag with a non-boolean value makes the item unknown and audited, and the item is not skipped', async (t) => {
  const odd = { ...inbound('m-odd'), message: { mid: 'm-odd', text: 'a real message', is_self: 'false' } };
  const parsed = parseEvents(messagingPayload(odd));
  assert.deepStrictEqual(parsed.events, []);
  assert.equal(parsed.unknown, 1);
  assert.deepStrictEqual(parsed.oddFlags, [{ id: 'm-odd', flag: 'is_self' }]);
  // A boolean false is an ordinary value, and so is a null message_edit, which is not an edit. Both are stored.
  const normal = {
    ...inbound('m-normal'),
    message: { mid: 'm-normal', text: 'fine', is_self: false, is_echo: false },
    message_edit: null,
  };
  assert.deepStrictEqual(parseEvents(messagingPayload(normal)).events.map((event) => event.id), ['m-normal']);

  const { handle, events, audit } = await handlerOver(t);
  await handle(signedPost(bodyOf(messagingPayload(odd))));
  assert.deepStrictEqual(storedEvents(events), []);
  const lines = audit.read({ limit: 100 });
  const flagged = lines.find((line) => line.target === 'm-odd');
  assert.equal(flagged.action, 'webhook.event_skipped');
  assert.deepStrictEqual(flagged.detail, { reason: 'non_boolean_flag', flag: 'is_self' });
  const [delivery] = lines.filter((line) => line.action === 'webhook.delivery');
  assert.equal(delivery.detail.unknown, 1);
});

test('comments and mentions are stored with their kinds', async (t) => {
  const { handle, events } = await handlerOver(t);
  const comment = {
    field: 'comments',
    value: { id: 'c1', from: { id: 'user-2', username: 'fan' }, text: 'nice post', media: { id: 'media-1' } },
  };
  const mention = {
    field: 'mentions',
    value: { comment_id: 'c2', media_id: 'media-1', from: { id: 'user-3' }, text: '@owner look' },
  };
  await handle(signedPost(bodyOf(changesPayload(comment, mention))));
  assert.deepStrictEqual(
    storedEvents(events).map((event) => [event.kind, event.id, event.senderId, event.receivedAt]),
    [
      // Changed in the P4 fix (item 3). Old assertions (removed): ['comment', 'c1', ...] and ['mention', 'c2', ...]. New: the stored
      // ids are kind-qualified, so a comment and a mention with the same raw id are distinct events.
      ['comment', 'comment:c1', 'user-2', new Date(T0).toISOString()],
      ['mention', 'mention:c2', 'user-3', new Date(T0).toISOString()],
    ],
  );
});

test('a mention without a sender is counted and audited with its kind and media id, and is not stored', async (t) => {
  const mention = { field: 'mentions', value: { comment_id: 'c7', media_id: 'media-9', text: '@owner look' } };
  const parsed = parseEvents(changesPayload(mention));
  assert.deepStrictEqual(parsed.events, []);
  assert.deepStrictEqual(parsed.unstoredMentions, [{ mediaId: 'media-9', commentId: 'c7' }]);
  assert.equal(parsed.unknown, 0);

  const { handle, events, audit } = await handlerOver(t);
  await handle(signedPost(bodyOf(changesPayload(mention))));
  assert.deepStrictEqual(storedEvents(events), []);
  const lines = audit.read({ limit: 100 });
  const skipped = lines.find((line) => line.action === 'webhook.event_skipped');
  assert.equal(skipped.detail.kind, 'mention');
  assert.equal(skipped.detail.mediaId, 'media-9');
  assert.equal(skipped.detail.reason, 'no_sender');
  const [delivery] = lines.filter((line) => line.action === 'webhook.delivery');
  assert.deepStrictEqual(delivery.detail, { unknown: 0, futureSkipped: 0, mentionsUnstored: 1, ownerSkipped: 0 });
});

test('an owner message is not stored and is audited', async (t) => {
  const { handle, events, audit } = await handlerOver(t);
  const own = inbound('m-own', { senderId: OWNER_ID, text: 'words from the owner' });
  assert.deepStrictEqual(await handle(signedPost(bodyOf(messagingPayload(own)))), {
    status: 200,
    body: 'EVENT_RECEIVED',
  });
  assert.deepStrictEqual(storedEvents(events), []);
  assert.equal(events.hasId('m-own', 'message'), false);
  const lines = audit.read({ limit: 100 });
  const skipped = lines.filter((line) => line.action === 'webhook.event_skipped');
  assert.deepStrictEqual(skipped.map((line) => [line.target, line.detail.kind, line.detail.reason]), [
    ['m-own', 'message', 'owner_sender'],
  ]);
  const [delivery] = lines.filter((line) => line.action === 'webhook.delivery');
  assert.equal(delivery.detail.ownerSkipped, 1);
  assert.equal(JSON.stringify(lines).includes('words from the owner'), false);
});

test('an owner comment or mention is not stored and is audited', async (t) => {
  const { handle, events, audit } = await handlerOver(t);
  const comment = {
    field: 'comments',
    value: { id: 'c-own', from: { id: OWNER_ID, username: 'owner' }, text: 'owner reply' },
  };
  const mention = {
    field: 'mentions',
    value: { comment_id: 'c-own-2', media_id: 'media-1', from: { id: OWNER_ID }, text: '@owner tag' },
  };
  await handle(signedPost(bodyOf(changesPayload(comment, mention))));
  assert.deepStrictEqual(storedEvents(events), []);
  const lines = audit.read({ limit: 100 });
  const skipped = lines.filter((line) => line.action === 'webhook.event_skipped');
  assert.deepStrictEqual(skipped.map((line) => [line.target, line.detail.kind, line.detail.reason]), [
    ['c-own', 'comment', 'owner_sender'],
    ['c-own-2', 'mention', 'owner_sender'],
  ]);
  const [delivery] = lines.filter((line) => line.action === 'webhook.delivery');
  assert.equal(delivery.detail.ownerSkipped, 2);
  assert.equal(JSON.stringify(lines).includes('owner reply'), false);
});

test('a message from another account is still stored, and is not counted as an owner skip', async (t) => {
  const { handle, events, audit } = await handlerOver(t);
  await handle(signedPost(bodyOf(messagingPayload(inbound('m-other', { senderId: 'user-9' })))));
  assert.deepStrictEqual(storedEvents(events).map((event) => [event.id, event.senderId]), [['m-other', 'user-9']]);
  const [delivery] = audit.read({ limit: 100 }).filter((line) => line.action === 'webhook.delivery');
  assert.equal(delivery.detail.ownerSkipped, 0);
});

test('a handler built with an owner that is not a string of digits throws CONFIG', () => {
  const events = { hasId: () => false, append: () => {} };
  const audit = { record: () => {} };
  for (const owner of [undefined, '', '   ', '1784 100', '17841x', 'owner-1', 1784100000000001]) {
    assert.throws(
      () => createWebhookHandler({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, owner, events, audit }),
      (error) => error instanceof IgError && error.kind === 'CONFIG',
      `owner ${JSON.stringify(owner)}`,
    );
  }
});

test('the handler refuses to build without an app secret, a verify token or an audit log', () => {
  const events = { hasId: () => false, append: () => {} };
  const audit = { record: () => {} };
  const isConfigError = (error) => error instanceof IgError && error.kind === 'CONFIG';
  for (const appSecret of [undefined, '', '   ']) {
    assert.throws(
      () => createWebhookHandler({ appSecret, verifyToken: VERIFY_TOKEN, events, audit }),
      isConfigError,
      `app secret ${JSON.stringify(appSecret)}`,
    );
  }
  for (const verifyToken of [undefined, '', '   ']) {
    assert.throws(
      () => createWebhookHandler({ appSecret: APP_SECRET, verifyToken, events, audit }),
      isConfigError,
      `verify token ${JSON.stringify(verifyToken)}`,
    );
  }
  assert.throws(
    () => createWebhookHandler({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, owner: OWNER_ID, events }),
    TypeError,
  );
  assert.equal(
    typeof createWebhookHandler({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, owner: OWNER_ID, events, audit }),
    'function',
  );
});

test('a mention is keyed by its comment, so two mentions on one post are two events', () => {
  const mentions = [
    { field: 'mentions', value: { comment_id: 'c2', media_id: 'media-1', from: { id: 'user-3' }, text: 'a' } },
    { field: 'mentions', value: { comment_id: 'c3', media_id: 'media-1', from: { id: 'user-4' }, text: 'b' } },
    { field: 'mentions', value: { media_id: 'media-2', from: { id: 'user-5' }, text: 'c' } },
  ];
  assert.deepStrictEqual(parseEvents(changesPayload(...mentions)).events.map((event) => event.id), [
    'c2',
    'c3',
    'media-2',
  ]);
});

test("receivedAt is the message's own timestamp, not the time of receipt", async (t) => {
  const { handle, events, clock } = await handlerOver(t);
  const sentAt = T0 - 60 * 60 * 1000;
  clock.now = T0;
  await handle(signedPost(bodyOf(messagingPayload(inbound('m1', { timestamp: sentAt })))));
  assert.equal(storedEvents(events)[0].receivedAt, new Date(sentAt).toISOString());
  const [parsed] = parseEvents(messagingPayload(inbound('m2', { timestamp: sentAt }))).events;
  assert.equal(parsed.receivedAt, new Date(sentAt).toISOString());
});

// Changed in the P4 review fix (M-7). Old assertion (removed): the delivery answers 200 EVENT_RECEIVED, so Meta does not retry.
// New: the delivery answers 503, so the sender retries it later. The event stays out of the log; the normal event is stored.
test('a message over five minutes ahead is answered 503, is not stored, is counted and is audited without its text', async (t) => {
  const { handle, events, audit } = await handlerOver(t);
  const ahead = T0 + FIVE_MINUTES_MS + 1000;
  const rawBody = bodyOf(
    messagingPayload(inbound('m-ahead', { timestamp: ahead, text: 'words not for the log' }), inbound('m-ok')),
  );
  assert.deepStrictEqual(await handle(signedPost(rawBody)), { status: 503, body: 'Retry later' });
  assert.deepStrictEqual(storedEvents(events).map((event) => event.id), ['m-ok']);

  const lines = audit.read({ limit: 100 });
  const skipped = lines.filter((line) => line.action === 'webhook.event_skipped');
  assert.deepStrictEqual(skipped.map((line) => [line.target, line.detail.kind, line.detail.reason]), [
    ['m-ahead', 'message', 'received_time_ahead'],
  ]);
  const [delivery] = lines.filter((line) => line.action === 'webhook.delivery');
  assert.deepStrictEqual(delivery.detail, { unknown: 0, futureSkipped: 1, mentionsUnstored: 0, ownerSkipped: 0 });
  assert.equal(JSON.stringify(lines).includes('words not for the log'), false);
});

test('reactions, reads, postbacks and comments without a sender are counted as unknown', () => {
  const messaging = [
    messagingEvent('reaction', { mid: 'm1', action: 'react', reaction: 'love' }),
    messagingEvent('read', { mid: 'm1' }),
    messagingEvent('postback', { mid: 'm1', title: 'Go', payload: 'GO' }),
  ];
  const parsed = parseEvents(messagingPayload(...messaging));
  assert.deepStrictEqual(parsed.events, []);
  assert.equal(parsed.unknown, 3);
  const commentWithoutSender = { field: 'comments', value: { id: 'c9', text: 'no sender' } };
  const liveComment = { field: 'live_comments', value: { id: 'c10', text: 'live', from: { id: 'user-2' } } };
  const commentsParsed = parseEvents(changesPayload(commentWithoutSender, liveComment));
  assert.deepStrictEqual(commentsParsed.events, []);
  assert.equal(commentsParsed.unknown, 2);
});

test('an attachment-only message, such as an image, is stored as a message with empty text', async (t) => {
  const image = {
    ...inbound('m-img'),
    message: { mid: 'm-img', attachments: [{ type: 'image', payload: { url: 'https://example.test/photo.jpg' } }] },
  };
  // A message whose text is present but is not a string is still unknown.
  const numeric = { ...inbound('m-num'), message: { mid: 'm-num', text: 42 } };
  const parsed = parseEvents(messagingPayload(image, numeric));
  assert.deepStrictEqual(parsed.events.map((event) => [event.kind, event.id, event.text]), [['message', 'm-img', '']]);
  assert.equal(parsed.unknown, 1);

  const { handle, events } = await handlerOver(t);
  await handle(signedPost(bodyOf(messagingPayload(image))));
  assert.deepStrictEqual(storedEvents(events).map((event) => [event.kind, event.id, event.text]), [
    ['message', 'm-img', ''],
  ]);
});

test('a payload without an entry list, or with invalid JSON, is refused with 400 and stores nothing', async (t) => {
  assert.throws(
    () => parseEvents({ object: 'instagram' }),
    (error) => error instanceof IgError && error.kind === 'VALIDATION',
  );
  const { handle, events } = await handlerOver(t);
  assert.deepStrictEqual(await handle(signedPost(bodyOf({ object: 'instagram' }))), {
    status: 400,
    body: 'Bad Request',
  });
  assert.deepStrictEqual(await handle(signedPost(Buffer.from('not json', 'utf8'))), {
    status: 400,
    body: 'Bad Request',
  });
  assert.deepStrictEqual(storedEvents(events), []);
});

test('a method other than GET or POST is refused with 405', async (t) => {
  const { handle } = await handlerOver(t);
  assert.deepStrictEqual(await handle({ method: 'PUT', headers: {}, query: {}, rawBody: Buffer.alloc(0) }), {
    status: 405,
    body: 'Method Not Allowed',
  });
});

test('the signature header is found whatever the case of its name', async (t) => {
  const { handle, events } = await handlerOver(t);
  const rawBody = bodyOf(messagingPayload(inbound('m1')));
  const result = await handle({
    method: 'POST',
    headers: { 'X-Hub-Signature-256': sign(rawBody) },
    query: {},
    rawBody,
  });
  assert.equal(result.status, 200);
  assert.deepStrictEqual(storedEvents(events).map((event) => event.id), ['m1']);
});

test('readRawBody resolves with the whole body as a Buffer', async () => {
  const body = await readRawBody(bodyStream([Buffer.from('ab'), Buffer.from('cd')]), 10);
  assert.ok(Buffer.isBuffer(body));
  assert.equal(body.toString('utf8'), 'abcd');
  const empty = await readRawBody(bodyStream([]), 10);
  assert.ok(Buffer.isBuffer(empty));
  assert.equal(empty.length, 0);
});

test('a body of exactly the limit is read, and one byte more is refused with status 413', async () => {
  const exact = await readRawBody(bodyStream([Buffer.from('ab'), Buffer.from('cd')]), 4);
  assert.equal(exact.toString('utf8'), 'abcd');
  await assert.rejects(readRawBody(bodyStream([Buffer.from('ab'), Buffer.from('cde')]), 4), (error) => {
    return error.status === 413;
  });
});

test('a stream many times the limit is cut off before its end', async () => {
  const chunkSize = 100;
  const chunkCount = 10000;
  const limit = 1000;
  let pulled = 0;
  const stream = new Readable({
    highWaterMark: chunkSize,
    read() {
      if (pulled === chunkCount) {
        this.push(null);
        return;
      }
      pulled += 1;
      this.push(Buffer.alloc(chunkSize, 0x61));
    },
  });
  await assert.rejects(readRawBody(stream, limit), (error) => error.status === 413);
  // The body is 1,000,000 bytes. Reading stops once twice the limit has arrived, about 20 chunks.
  assert.ok(pulled < 100, `${pulled} of ${chunkCount} chunks were read`);
  // A late error on the request after the 413 is absorbed, not thrown as an unhandled error.
  assert.doesNotThrow(() => stream.emit('error', new Error('late failure')));
});

test('the limit counts bytes, not characters', async () => {
  // The e-acute character is two bytes in UTF-8, so it is over a limit of one.
  await assert.rejects(readRawBody(bodyStream(['é']), 1), (error) => error.status === 413);
  assert.equal((await readRawBody(bodyStream(['é']), 2)).toString('utf8'), 'é');
});

test('a stream error rejects with that error', async () => {
  const failing = new Readable({
    read() {
      this.destroy(new Error('connection reset'));
    },
  });
  await assert.rejects(readRawBody(failing, 10), /connection reset/);
});

test('readRawBody refuses a limit that is not a whole number of bytes', async () => {
  for (const limit of [-1, 1.5, '10', undefined, Number.NaN]) {
    await assert.rejects(readRawBody(bodyStream([]), limit), TypeError, `limit ${String(limit)}`);
  }
});

// Added in P4 (item 14). The webhook reads a time in the same forms as the messaging reads: an ISO time with a zone (Z, +hh:mm and
// +hhmm), a Unix number in seconds or in milliseconds, and a numeric string of either. Each form gives the same ISO time.
test('a webhook time is read in each accepted form, and a value that is not a time is unknown', () => {
  const want = '2026-10-20T12:00:00.000Z';
  const seconds = Date.parse(want) / 1000;
  const forms = [
    '2026-10-20T12:00:00Z',
    '2026-10-20T12:00:00.000Z',
    '2026-10-20T14:00:00+02:00',
    '2026-10-20T12:00:00+0000',
    seconds,
    Date.parse(want),
    String(seconds),
    String(Date.parse(want)),
  ];
  for (const created of forms) {
    const payload = {
      object: 'instagram',
      entry: [{ id: 'owner-1', time: T0, changes: [{ field: 'comments', value: { id: 'c-1', from: { id: 'user-1' }, text: 'hi', created_time: created } }] }],
    };
    const parsed = parseEvents(payload);
    assert.equal(parsed.events.length, 1, `form ${String(created)}`);
    assert.equal(parsed.events[0].receivedAt, want, `form ${String(created)}`);
  }
  // A messaging timestamp in seconds is read in the same way.
  const messaging = parseEvents({ object: 'instagram', entry: [{ id: 'owner-1', messaging: [inbound('m-sec', { timestamp: seconds })] }] });
  assert.equal(messaging.events[0].receivedAt, want);
  // Values that are not usable are unknown, not guessed: zero, a negative number, an impossible day, and text.
  for (const bad of [0, -5, '2026-02-30T12:00:00Z', 'not a time', '', true]) {
    const parsed = parseEvents({
      object: 'instagram',
      entry: [{ id: 'owner-1', time: T0, changes: [{ field: 'comments', value: { id: 'c-bad', from: { id: 'user-1' }, text: 'hi', created_time: bad } }] }],
    });
    assert.equal(parsed.events.length, 0, `bad ${String(bad)}`);
    assert.equal(parsed.unknown, 1, `bad ${String(bad)}`);
  }
});

// Added in P4 (A-22). A comment and a mention with the same id are both stored, once each, at the handler.
test('a comment and a mention with the same id are both stored once each', async (t) => {
  const { handle, events } = await handlerOver(t);
  const payload = {
    object: 'instagram',
    entry: [
      {
        id: OWNER_ID,
        time: T0,
        changes: [
          { field: 'comments', value: { id: 'same-1', from: { id: 'user-1' }, text: 'nice' } },
          { field: 'mentions', value: { comment_id: 'same-1', media_id: 'media-9', from: { id: 'user-1' }, text: 'hi' } },
        ],
      },
    ],
  };
  const body = bodyOf(payload);
  assert.equal((await handle(signedPost(body))).status, 200);
  assert.deepEqual(storedEvents(events).map((e) => [e.kind, e.id]), [
    // Changed in the P4 fix (item 3). Old assertion (removed): [['comment', 'same-1'], ['mention', 'same-1']]. New: each stored id is
    // kind-qualified, so the two events have distinct ids.
    ['comment', 'comment:same-1'],
    ['mention', 'mention:same-1'],
  ]);
  assert.equal((await handle(signedPost(body))).status, 200);
  assert.equal(storedEvents(events).length, 2, 'a redelivery stores neither again');
});

// Added in P4 (A-23). A request that has already ended, or has been destroyed or closed, is refused at once, rather than waiting
// for an end or close event that will not come.
// The timeout makes a regression fail, rather than hang: without the check, readRawBody waits for an event that already came.
test('readRawBody refuses a request that has ended, or is destroyed or closed, without waiting', { timeout: 5000 }, async () => {
  const ended = Readable.from([]);
  ended.resume();
  await new Promise((resolve) => ended.once('end', resolve));
  await assert.rejects(readRawBody(ended, 10), /closed before its body was read/);
  const destroyed = Readable.from(['x']);
  destroyed.destroy();
  await assert.rejects(readRawBody(destroyed, 10), /closed before its body was read/);
  // A stream's closed flag is a getter, so a plain object stands in for a request whose close has happened.
  const closedFlag = { closed: true, destroyed: false, readableEnded: false, on() {}, off() {} };
  await assert.rejects(readRawBody(closedFlag, 10), /closed before its body was read/);
});

// P4 review M-7. The sender's retry is what stores the event. Once the clock is within five minutes of the stamp, the same
// delivery is stored and answered 200, and the event that was stored with the first attempt is skipped, not stored twice.
test('a future-stamped event is stored by the retry once it is no longer ahead, and is stored once', async (t) => {
  const { clock, handle, events } = await handlerOver(t);
  const ahead = T0 + FIVE_MINUTES_MS + 60 * 1000;
  const rawBody = bodyOf(messagingPayload(inbound('m-ahead', { timestamp: ahead }), inbound('m-ok')));
  assert.equal((await handle(signedPost(rawBody))).status, 503);
  assert.deepStrictEqual(storedEvents(events).map((event) => event.id), ['m-ok']);
  clock.now = T0 + 2 * 60 * 1000;
  assert.deepStrictEqual(await handle(signedPost(rawBody)), { status: 200, body: 'EVENT_RECEIVED' });
  assert.deepStrictEqual(storedEvents(events).map((event) => event.id), ['m-ok', 'm-ahead'], 'each event is stored once');
});

// P4 review M-7. A delivery whose events are all within five minutes is answered 200 as before.
test('a delivery with only normal events still gets 200', async (t) => {
  const { handle, events } = await handlerOver(t);
  const rawBody = bodyOf(messagingPayload(inbound('m-1', { timestamp: T0 - 60 * 1000 }), inbound('m-2')));
  assert.deepStrictEqual(await handle(signedPost(rawBody)), { status: 200, body: 'EVENT_RECEIVED' });
  assert.deepStrictEqual(storedEvents(events).map((event) => event.id), ['m-1', 'm-2']);
});

// P4 review M-10. During a STATE_CORRUPT stop, an inbound event is stored. The event log is a file of its own, so it does not
// depend on the state file, and the stop does not block a write to it. Whether the event is notified or answered is decided by the
// service (see test/service.test.js), not here.
test('during a STATE_CORRUPT stop, an inbound event is stored', async (t) => {
  const dir = tempDir(t);
  const clock = { now: T0 };
  const stop = { stopped: true, kind: 'STATE_CORRUPT', detail: 'state file unreadable', since: new Date(T0).toISOString() };
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ stop }));
  const state = await createState({ file: join(dir, 'state.json') });
  assert.equal(state.get('stop', null).kind, 'STATE_CORRUPT');
  const events = createEventLog({ file: join(dir, 'events.jsonl'), state, now: () => clock.now });
  const audit = createAudit({ file: join(dir, 'audit.jsonl'), now: () => clock.now });
  const handle = createWebhookHandler({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, owner: OWNER_ID, events, audit, now: () => clock.now });
  const rawBody = bodyOf(messagingPayload(inbound('m-during-stop', { text: 'hello during the stop' })));
  assert.deepStrictEqual(await handle(signedPost(rawBody)), { status: 200, body: 'EVENT_RECEIVED' });
  assert.deepStrictEqual(storedEvents(events).map((event) => [event.id, event.text]), [['m-during-stop', 'hello during the stop']]);
});

// P4 review, inbound wiring. The notify step is called once for each event that is stored. A skipped event (the owner's own, or one
// already stored) is not notified, and a notify that throws or rejects does not change the answer or stop the delivery.
test('notify is called once for each stored event, and a failing notify does not change the answer', async (t) => {
  const dir = tempDir(t);
  const clock = { now: T0 };
  const state = await createState({ file: join(dir, 'state.json') });
  const events = createEventLog({ file: join(dir, 'events.jsonl'), state, now: () => clock.now });
  const audit = createAudit({ file: join(dir, 'audit.jsonl'), now: () => clock.now });
  const notified = [];
  const handle = createWebhookHandler({
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    owner: OWNER_ID,
    events,
    audit,
    now: () => clock.now,
    notify: (event) => {
      notified.push(event.id);
      if (event.id === 'm-throws') throw new Error('boom');
      if (event.id === 'm-rejects') return Promise.reject(Object.assign(new Error('refused'), { kind: 'STOPPED' }));
      return undefined;
    },
  });
  const body = bodyOf(
    messagingPayload(inbound('m-1'), inbound('m-owner', { senderId: OWNER_ID }), inbound('m-throws'), inbound('m-rejects')),
  );
  assert.deepStrictEqual(await handle(signedPost(body)), { status: 200, body: 'EVENT_RECEIVED' });
  assert.equal((await handle(signedPost(body))).status, 200, 'a redelivery is answered too');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(notified, ['m-1', 'm-throws', 'm-rejects'], 'the owner and the redelivered events are not notified');
  const failures = audit.read({ limit: 100 }).filter((line) => line.action === 'webhook.notify');
  assert.deepStrictEqual(failures.map((line) => [line.target, line.detail.kind]), [
    ['m-throws', 'error'],
    ['m-rejects', 'STOPPED'],
  ]);
});

// ---------- A-11 (2026-10-23): the handshake through the handler ----------

test('a GET through the handler answers only a matching handshake, and stores and audits nothing', async (t) => {
  const { handle, events, audit } = await handlerOver(t);
  const query = { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'challenge-42' };
  assert.deepStrictEqual(await handle({ method: 'GET', headers: {}, query }), { status: 200, body: 'challenge-42' });
  const refused = [
    { ...query, 'hub.mode': 'unsubscribe' },
    { ...query, 'hub.verify_token': 'wrong-token' },
    { ...query, 'hub.challenge': undefined },
    { ...query, 'hub.verify_token': [VERIFY_TOKEN, VERIFY_TOKEN] },
  ];
  for (const refusedQuery of refused) {
    assert.deepStrictEqual(await handle({ method: 'GET', headers: {}, query: refusedQuery }), {
      status: 403,
      body: 'Forbidden',
    });
  }
  assert.deepStrictEqual(storedEvents(events), []);
  assert.deepStrictEqual(audit.read({ limit: 100 }), []);
});
