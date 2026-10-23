import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createCaps, createUsageGate } from '../src/caps.js';
import { DEFAULT_CAPS } from '../src/config.js';
import { IgError, mapGraphError } from '../src/errors.js';
import { createGuard } from '../src/guard.js';
import { createService, createUsageHolder } from '../src/service.js';
import { MEDIA_DIR, MIB, OUTSIDE_DIR, fakeHost, fakeMediaFs, inMedia, sha256Hex } from './fixtures/media-fakes.js';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const OWNER = '17841400000000001';
const OTHER = '17841400000000002';
const MEDIA = '17900000000000001';
const OTHER_MEDIA = '17900000000000002';
const COMMENT = '17870913679156914';
const REPLY = '17870913679156999';
const CONTAINER = '17900000000000111';
const PUBLISHED = '17900000000000222';
const RULES = [{ keyword: 'price', reply: 'The price is in our bio.' }];
// The events file of every test. It does not exist, so the guard starts with no startup stop.
const MISSING_FILE = join(import.meta.dirname, 'no-such-folder', 'events.jsonl');

const iso = (ms) => new Date(ms).toISOString();
// Graph writes a comment time with a +0000 zone, not a colon.
const graphTime = (ms) => `${iso(ms).slice(0, 19)}+0000`;
const graphError = (status, code, message) => mapGraphError({ status, body: { error: { code, message } } });
const kindIs = (kind) => (err) => err instanceof IgError && err.kind === kind;
const lowUsage = () => ({ app: { total_time: 5, total_cputime: 5 }, business: null });
const unreadableUsage = () => ({ app: null, business: null, unreadable: 'x-app-usage' });

function makeClock(start = NOW) {
  let at = start;
  return { now: () => at, advance: (ms) => { at += ms; } };
}

// A state with get, set and save. A failed save is set by failSave. Each save is counted.
function fakeState(initial = {}) {
  const data = new Map(Object.entries(structuredClone(initial)));
  const state = {
    data,
    saves: 0,
    failSave: false,
    get(key, fallback) {
      return data.has(key) ? structuredClone(data.get(key)) : fallback;
    },
    set(key, value) {
      data.set(key, structuredClone(value));
    },
    save() {
      if (state.failSave) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      state.saves += 1;
    },
  };
  return state;
}

// The event log, as the service uses it. Each call is recorded. inbound maps a sender to the time of the last inbound.
function fakeEvents(options = {}) {
  const calls = [];
  const events = {
    calls,
    // inbound holds the time of each sender's last inbound message; otherInbound, of the last comment or mention. With
    // kind 'message' only the messages count. With no kind, the newest event of either kind counts, as the real log does.
    inbound: { ...(options.inbound ?? {}) },
    otherInbound: { ...(options.otherInbound ?? {}) },
    pendingEvents: options.pending ?? [],
    nextCursor: options.nextCursor ?? null,
    unread: options.unread ?? [],
    lastInboundAt(senderId, opts = {}) {
      calls.push(['lastInboundAt', senderId, opts]);
      const message = events.inbound[senderId] ?? null;
      if (opts.kind === 'message') return message;
      const other = events.otherInbound[senderId] ?? null;
      if (message === null || other === null) return message ?? other;
      return Date.parse(other) > Date.parse(message) ? other : message;
    },
    pending(opts) {
      calls.push(['pending', opts]);
      return { events: events.pendingEvents, nextCursor: events.nextCursor };
    },
    ack(cursor) {
      calls.push(['ack', cursor]);
    },
    decide(id, decision) {
      calls.push(['decide', id, decision]);
      return { id, status: 'handled', text: 'stored text', decision: { ...decision, at: iso(NOW) }, untrusted: true };
    },
    markRead(senderId) {
      calls.push(['markRead', senderId]);
    },
    unreadSenders() {
      calls.push(['unreadSenders']);
      return events.unread;
    },
    purge() {
      calls.push(['purge']);
      return { removed: 2 };
    },
  };
  return events;
}

function fakeAudit() {
  const entries = [];
  return {
    entries,
    record(entry) {
      if (typeof entry?.action !== 'string') throw new TypeError('an audit entry needs an action');
      entries.push(structuredClone(entry));
    },
  };
}

// The secrets, as the service asks about them: the source of each name, and set.
function fakeSecrets(sources = {}) {
  const secrets = {
    sources: { ...sources },
    writes: [],
    source(name) {
      return secrets.sources[name] ?? 'none';
    },
    set(name, value) {
      secrets.writes.push([name, value]);
      secrets.sources[name] = 'keyring';
    },
  };
  return secrets;
}

// The unofficial registry. Each call is recorded, and every feature maps to the same fake adapter.
function fakeUnofficial() {
  const calls = [];
  const adapter = {
    follow: async (userId) => {
      calls.push(['follow', userId]);
      return { following: true };
    },
    unfollow: async (userId) => {
      calls.push(['unfollow', userId]);
      return { following: false };
    },
    profileEdit: async (fields) => {
      calls.push(['profileEdit', fields]);
      return { edited: true };
    },
  };
  return {
    calls,
    forFeature(feature) {
      calls.push(['forFeature', feature]);
      return adapter;
    },
  };
}

// The Graph client, as the service sees it. A request is answered from graph.answers, keyed by 'METHOD path'. The answer is
// data or a function of the request, and a function may throw. Each response gives a fresh usage reading to onUsage before
// the answer is returned, as the real client does. Every request is recorded with the login product that made it.
function fakeGraph(answers, log) {
  const graph = {
    requests: [],
    products: [],
    options: [],
    failClient: null,
    answers,
    usage: lowUsage,
    lastUsage: null,
    getClient: async (product, opts = {}) => {
      if (graph.failClient === product) throw new IgError('CONFIG', 'owner_token is not set');
      graph.products.push(product);
      graph.options.push(opts);
      const send = (method, path, extra) => {
        const request = { product, method, path, ...extra };
        graph.requests.push(request);
        if (log) log.push(`${method} ${path}`);
        const usage = graph.usage();
        graph.lastUsage = usage;
        opts.onUsage?.(usage);
        const key = `${method} ${path}`;
        if (!Object.hasOwn(graph.answers, key)) throw new Error(`no fake answer for ${key}`);
        const value = graph.answers[key];
        const data = typeof value === 'function' ? value(request) : value;
        return { data, usage };
      };
      return {
        get: async (path, query) => send('GET', path, { query }),
        post: async (path, body, postOptions = {}) => send('POST', path, { body, options: postOptions }),
        del: async (path, query) => send('DELETE', path, { query }),
      };
    },
  };
  return graph;
}

function configFor({ owner = {}, routes = {}, autoReply = {}, caps = {}, media = {}, story = {} } = {}) {
  return {
    owner: { igUserId: OWNER, accountType: 'business', ...owner },
    graph: { version: 'v26.0', instagramBase: 'https://graph.instagram.com', facebookBase: 'https://graph.facebook.com' },
    routes: {
      unofficial: { enabled: false, acknowledged: false, adapterByFeature: {} },
      likes: { loginProduct: 'instagram' },
      ...routes,
    },
    caps: { ...structuredClone(DEFAULT_CAPS), ...caps },
    autoReply: { enabled: false, rules: [], ...autoReply },
    media: { dir: MEDIA_DIR, publicBaseUrl: null, allowedHosts: ['example.com'], ...media },
    story: { images: false, ...story },
  };
}

// Builds the service over fakes, with the real caps, usage gate and guard over the same fake state and clock.
function setup(options = {}) {
  const clock = makeClock(options.start);
  const log = [];
  const config = configFor(options);
  const state = fakeState(options.state);
  const events = fakeEvents(options.eventOptions);
  const audit = fakeAudit();
  const graph = fakeGraph(options.answers ?? {}, log);
  // P6: the owner's host answers HEAD requests (fakeHost), and media.dir is a fake file system. Neither touches the network.
  const host = options.host ?? fakeHost();
  const mediaFs = options.mediaFs ?? fakeMediaFs();
  const secrets = fakeSecrets({ facebook_token: options.facebook ?? 'none' });
  const unofficial = fakeUnofficial();
  const caps = createCaps({ caps: config.caps, state, now: clock.now });
  const usageGate = createUsageGate({
    thresholdPercent: config.caps.usageThrottlePercent,
    busyMs: config.caps.usageBusyMs,
    now: clock.now,
  });
  const guard = createGuard({ owner: config.owner, state, now: clock.now, eventsFile: MISSING_FILE });
  const service = createService({
    config,
    state,
    events,
    caps: options.wrapCaps ? options.wrapCaps(caps, log) : caps,
    usageGate: options.wrapGate ? options.wrapGate(usageGate) : usageGate,
    guard,
    audit,
    unofficial,
    secrets,
    getClient: graph.getClient,
    now: clock.now,
    mediaFs,
    mediaFetch: host.fetchImpl,
  });
  return { service, config, state, events, audit, graph, secrets, unofficial, guard, clock, log, host, mediaFs };
}

const posts = (t) => t.graph.requests.filter((request) => request.method === 'POST');
const ownedMedia = { 'GET me/media': { data: [{ id: MEDIA }] } };
const likeAnswers = (extra = {}) => ({
  ...ownedMedia,
  'GET me': { id: OWNER },
  [`POST ${OWNER}/likes`]: { success: true },
  ...extra,
});
const dmAnswers = (extra = {}) => ({ 'GET me': { id: OWNER }, [`POST ${OWNER}/messages`]: { message_id: 'm-sent-1' }, ...extra });
// Every Graph response gives a usage reading, and an official send needs one. A read is made first, as the poller does.
const prime = (t) => t.service.profileGet();

function inbound({ id = 'evt-1', senderId = OTHER, text = 'what is the price?', receivedAt = iso(NOW) } = {}) {
  return { seq: 1, id, kind: 'message', senderId, text, receivedAt, status: 'new', decision: null, untrusted: true };
}

// Hands an inbound event to the service, as the poller does: the sender's last inbound time is set first.
async function receive(t, event) {
  t.events.inbound[event.senderId] = event.receivedAt;
  await t.service.onInbound(event);
}

// ---------- The brief's tests ----------

test('outbound without confirm returns a preview and makes no request', async () => {
  const t = setup({ answers: { [`POST ${COMMENT}/replies`]: { id: 'r1' } } });
  const result = await t.service.commentReply({ commentId: COMMENT, text: 'thanks' });
  assert.deepEqual(result, { preview: true, action: 'comment_reply', target: COMMENT });
  assert.equal(t.graph.requests.length, 0);
  assert.equal(t.state.data.has('caps.outbound'), false);
});

test('outbound returns busy when spacing blocks it, and records nothing', async () => {
  const t = setup({ answers: likeAnswers() });
  await prime(t);
  const first = await t.service.like({ targetId: MEDIA, kind: 'media', confirm: true });
  assert.equal(first.liked, true);
  const second = await t.service.like({ targetId: MEDIA, kind: 'media', confirm: true });
  assert.equal(second.busy, true);
  assert.match(second.reason, /2000 ms/);
  assert.equal(posts(t).length, 1, 'the blocked like sent no write');
  assert.equal(t.state.data.get('caps.outbound').length, 1);
  assert.equal(t.state.data.get('caps.likes').length, 1);
});

test('dmSend refused when the window is closed, with no request made', async () => {
  const t = setup({ answers: dmAnswers(), eventOptions: { inbound: { [OTHER]: iso(NOW - 25 * HOUR) } } });
  await assert.rejects(
    t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true }),
    kindIs('WINDOW_CLOSED'),
  );
  assert.equal(t.graph.requests.length, 0);
  t.events.inbound = {};
  await assert.rejects(
    t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true }),
    kindIs('WINDOW_CLOSED'),
  );
  assert.equal(t.graph.requests.length, 0);
  t.events.inbound[OTHER] = iso(NOW - 23 * HOUR);
  await prime(t);
  const sent = await t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true });
  assert.deepEqual(sent, { messageId: 'm-sent-1', recipientId: OTHER });
});

test('error 190 during like sets the stop state, and the next outbound is refused', async () => {
  const t = setup({
    answers: likeAnswers({ [`POST ${OWNER}/likes`]: () => { throw graphError(400, 190, 'Error validating access token'); } }),
  });
  await prime(t);
  await assert.rejects(t.service.like({ targetId: MEDIA, kind: 'media', confirm: true }), kindIs('AUTH_EXPIRED'));
  assert.equal(t.guard.stopStatus().stopped, true);
  assert.equal(t.guard.stopStatus().kind, 'AUTH_EXPIRED');
  t.clock.advance(5000);
  await assert.rejects(
    t.service.commentReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    kindIs('STOPPED'),
  );
  assert.equal(posts(t).length, 1, 'only the like was sent');
});

test('read tool returns AUTH_EXPIRED cleanly and does not set the stop state', async () => {
  const t = setup({ answers: { 'GET me': () => { throw graphError(400, 190, 'Session expired'); } } });
  await assert.rejects(t.service.profileGet(), kindIs('AUTH_EXPIRED'));
  assert.equal(t.guard.stopStatus().stopped, false);
  assert.equal(t.state.data.has('stop'), false);
});

test("comment reply is refused when the parent media is not the owner's", async () => {
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: { media: { id: OTHER_MEDIA } },
      ...ownedMedia,
      [`POST ${COMMENT}/replies`]: { id: REPLY },
    },
  });
  await assert.rejects(t.service.commentReply({ commentId: COMMENT, text: 'hi', confirm: true }), kindIs('OWNER_MISMATCH'));
  assert.equal(posts(t).length, 0);
  // An unknown parent is refused too.
  t.graph.answers[`GET ${COMMENT}`] = {};
  await assert.rejects(t.service.commentReply({ commentId: COMMENT, text: 'hi', confirm: true }), kindIs('OWNER_MISMATCH'));
  assert.equal(posts(t).length, 0);
  // The owner's own media is allowed.
  t.graph.answers[`GET ${COMMENT}`] = { media: { id: MEDIA } };
  const reply = await t.service.commentReply({ commentId: COMMENT, text: 'hi', confirm: true });
  assert.deepEqual(reply, { id: REPLY });
  assert.equal(posts(t).length, 1);
});

test('private reply is allowed once per comment and only within 7 days', async () => {
  // The comment's own time comes from GET {comment-id}?fields=timestamp. The owner check reads media{id} from the same node.
  let commentTime = graphTime(NOW - 8 * DAY);
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: (request) =>
        request.query.fields === 'timestamp' ? { id: COMMENT, timestamp: commentTime } : { media: { id: MEDIA } },
      ...ownedMedia,
      [`POST ${OWNER}/messages`]: { message_id: 'pr-1' },
    },
  });
  // Eight days old: refused, and nothing is sent or recorded.
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    kindIs('WINDOW_CLOSED'),
  );
  assert.equal(posts(t).length, 0);
  assert.equal(t.state.data.has('private_replies'), false);
  // Six days old: sent once.
  commentTime = graphTime(NOW - 6 * DAY);
  const sent = await t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true });
  assert.deepEqual(sent, { messageId: 'pr-1', commentId: COMMENT });
  assert.ok(t.state.data.get('private_replies')[COMMENT], 'the reply is recorded under private_replies');
  // A second reply to the same comment is refused before any request. The two-second spacing is passed first, so that the
  // refusal is the one-reply-per-comment rule and not the early spacing check (which refuses with busy).
  t.clock.advance(2000);
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'again', confirm: true }),
    kindIs('CAP_EXCEEDED'),
  );
  assert.equal(posts(t).length, 1);
});

test('private reply refuses a comment whose timestamp fetch throws, has no timestamp, or is a stop', async () => {
  let timestampAnswer = () => { throw graphError(500, 1, 'boom'); };
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: (request) =>
        request.query.fields === 'timestamp' ? timestampAnswer() : { media: { id: MEDIA } },
      ...ownedMedia,
      [`POST ${OWNER}/messages`]: { message_id: 'pr-1' },
    },
  });
  // The fetch throws: refused before any send.
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    kindIs('WINDOW_CLOSED'),
  );
  // The fetch answers without a timestamp: refused before any send.
  timestampAnswer = () => ({ id: COMMENT });
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    kindIs('WINDOW_CLOSED'),
  );
  assert.equal(posts(t).length, 0);
  assert.equal(t.state.data.has('private_replies'), false);
  // An error 190 on the fetch is a stop, and it is passed on as one.
  timestampAnswer = () => { throw graphError(400, 190, 'expired'); };
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    kindIs('AUTH_EXPIRED'),
  );
  assert.equal(t.guard.stopStatus().kind, 'AUTH_EXPIRED');
});

test('eventsDecide records the decision and calls no send method', async () => {
  const t = setup();
  const event = await t.service.eventsDecide({ eventId: 'evt-1', decision: 'reply', draft: 'Thanks for asking!' });
  assert.equal(event.status, 'handled');
  assert.deepEqual(t.events.calls.map((call) => call[0]), ['decide']);
  assert.deepEqual(t.events.calls[0][2], { action: 'reply', draft: 'Thanks for asking!' });
  assert.equal(t.graph.requests.length, 0, 'no Graph request');
  assert.equal(JSON.stringify(t.audit.entries).includes('Thanks for asking'), false, 'the draft is not in the audit');
});

test('eventsPending marks event text untrusted', async () => {
  const pending = [{ seq: 1, id: 'evt-1', kind: 'message', senderId: OTHER, text: 'hello', receivedAt: iso(NOW) }];
  const t = setup({ eventOptions: { pending, nextCursor: 'cursor-1' } });
  const page = await t.service.eventsPending({ limit: 5 });
  assert.equal(page.nextCursor, 'cursor-1');
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0].untrusted, true);
  assert.deepEqual(t.events.calls[0], ['pending', { limit: 5 }]);
});

test('businessDiscovery returns the result marked untrusted, because it is another account\'s data', async () => {
  const t = setup({
    facebook: 'keyring',
    answers: { [`GET ${OWNER}`]: { business_discovery: { id: OTHER, username: 'other_shop', followers_count: 10 } } },
  });
  const found = await t.service.businessDiscovery({ username: 'other_shop', fields: 'username,followers_count' });
  // Changed in the P3 round: the result also carries truncated and reason. Old assertion (removed):
  //   assert.deepEqual(found, { id: OTHER, username: 'other_shop', followers_count: 10, missingFields: [], untrusted: true });
  assert.deepEqual(found, {
    id: OTHER,
    username: 'other_shop',
    followers_count: 10,
    missingFields: [],
    truncated: false,
    reason: null,
    untrusted: true,
  });
  assert.equal(t.graph.products.at(-1), 'facebook');
});

test('eventsDecide returns the event marked untrusted, even when the event it gets back has no marker', async () => {
  const t = setup();
  // The fake decide returns the inbound text without the marker. So the untrusted field in the result can only come from
  // the service, which marks the result before it returns it.
  t.events.decide = (id, decision) => {
    t.events.calls.push(['decide', id, decision]);
    return { id, senderId: OTHER, status: 'handled', text: 'what is the price?', decision: { ...decision } };
  };
  const event = await t.service.eventsDecide({ eventId: 'evt-1', decision: 'reply', draft: 'Thanks' });
  assert.equal(event.text, 'what is the price?');
  assert.equal(event.untrusted, true);
  assert.equal(t.graph.requests.length, 0, 'no Graph request');
});

test('mediaDelete is refused with ROUTE_DISABLED when no Facebook token exists', async () => {
  const t = setup({ facebook: 'none', answers: { ...ownedMedia, [`DELETE ${MEDIA}`]: { success: true } } });
  await assert.rejects(t.service.mediaDelete({ mediaId: MEDIA, confirm: true }), kindIs('ROUTE_DISABLED'));
  assert.equal(t.graph.requests.length, 0);
  // With a Facebook token, the delete goes through the Facebook client.
  t.secrets.sources.facebook_token = 'keyring';
  const deleted = await t.service.mediaDelete({ mediaId: MEDIA, confirm: true });
  assert.deepEqual(deleted, { id: MEDIA, deleted: true });
  const del = t.graph.requests.find((request) => request.method === 'DELETE');
  assert.equal(del.product, 'facebook');
});

test('personal account refuses official features with ROUTE_DISABLED', async () => {
  const t = setup({ owner: { accountType: 'personal' }, answers: { ...dmAnswers(), [`POST ${COMMENT}/replies`]: { id: 'r' } } });
  await assert.rejects(t.service.commentReply({ commentId: COMMENT, text: 'hi', confirm: true }), kindIs('ROUTE_DISABLED'));
  await assert.rejects(t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true }), kindIs('ROUTE_DISABLED'));
  await assert.rejects(t.service.hashtagSearch({ q: 'cats' }), kindIs('ROUTE_DISABLED'));
  assert.equal(t.graph.requests.length, 0);
});

test('unofficial follow is refused until routes.unofficial is enabled and acknowledged', async () => {
  for (const [enabled, acknowledged] of [[false, false], [true, false], [false, true]]) {
    const t = setup({ routes: { unofficial: { enabled, acknowledged, adapterByFeature: { follow: 'sidecar' } } } });
    await assert.rejects(t.service.follow({ userId: OTHER, confirm: true }), kindIs('ROUTE_DISABLED'));
    assert.equal(t.unofficial.calls.length, 0, `no adapter call with enabled=${enabled} acknowledged=${acknowledged}`);
  }
  const t = setup({ routes: { unofficial: { enabled: true, acknowledged: true, adapterByFeature: { follow: 'sidecar' } } } });
  const result = await t.service.follow({ userId: OTHER, confirm: true });
  assert.deepEqual(result, { following: true });
  assert.deepEqual(t.unofficial.calls.filter((call) => call[0] === 'follow'), [['follow', OTHER]]);
});

test('auto-reply sends only when enabled and a rule matches', async () => {
  const off = setup({ autoReply: { enabled: false, rules: RULES }, answers: dmAnswers() });
  await receive(off, inbound({ text: 'what is the price?' }));
  assert.equal(posts(off).length, 0, 'disabled: no reply');

  const on = setup({ autoReply: { enabled: true, rules: RULES }, answers: dmAnswers() });
  await prime(on);
  await receive(on, inbound({ id: 'evt-2', text: 'hello there' }));
  assert.equal(posts(on).length, 0, 'no rule matches: no reply');

  await receive(on, inbound({ id: 'evt-3', text: 'What is the PRICE?' }));
  assert.equal(posts(on).length, 1, 'a matching rule replies once');
  assert.equal(posts(on)[0].body.json.recipient.id, OTHER);
  assert.equal(posts(on)[0].body.json.message.text, RULES[0].reply);
});

test('caps block the 11th like within the hour with busy', async () => {
  const t = setup({ answers: likeAnswers() });
  await prime(t);
  for (let i = 0; i < 10; i += 1) {
    t.clock.advance(2000);
    const liked = await t.service.like({ targetId: MEDIA, kind: 'media', confirm: true });
    assert.equal(liked.liked, true, `like ${i + 1}`);
  }
  t.clock.advance(2000);
  const blocked = await t.service.like({ targetId: MEDIA, kind: 'media', confirm: true });
  assert.equal(blocked.busy, true);
  assert.match(blocked.reason, /likes per hour/);
  assert.ok(blocked.retryAfterMs > 0);
  assert.equal(posts(t).length, 10);
});

// ---------- The ledger rulings (a) to (o) ----------

test('(a) caps.record runs after the checks and before perform', async () => {
  const t = setup({
    answers: likeAnswers(),
    wrapCaps: (caps, log) => ({
      check: (...args) => { log.push('check'); return caps.check(...args); },
      record: (...args) => { log.push('record'); return caps.record(...args); },
      usage: (...args) => caps.usage(...args),
    }),
  });
  await prime(t);
  await t.service.like({ targetId: MEDIA, kind: 'media', confirm: true });
  // The early check (F-5) runs before the owner and quota reads, and the authoritative check runs again just before the
  // count. The record comes after the authoritative check and before the request.
  const order = t.log.filter((entry) => ['check', 'record', `POST ${OWNER}/likes`].includes(entry));
  assert.deepEqual(order, ['check', 'check', 'record', `POST ${OWNER}/likes`]);
});

test('(a) a count that cannot be saved stops the request', async () => {
  const t = setup({ answers: likeAnswers() });
  await prime(t);
  t.state.failSave = true;
  await assert.rejects(t.service.like({ targetId: MEDIA, kind: 'media', confirm: true }), kindIs('CONFIG'));
  assert.equal(posts(t).length, 0, 'no like was sent');
});

test('(a) an unreadable usage header holds outbound calls before the usage gate runs', async () => {
  const seen = [];
  const t = setup({
    answers: { ...dmAnswers(), 'GET me': { id: OWNER } },
    eventOptions: { inbound: { [OTHER]: iso(NOW) } },
    wrapGate: (gate) => ({ check: (usage) => { seen.push(usage); return gate.check(usage); } }),
  });
  t.graph.usage = unreadableUsage;
  await t.service.profileGet();
  const result = await t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true });
  assert.equal(result.busy, true);
  assert.match(result.reason, /could not be read/);
  assert.equal(seen.length, 0, 'the usage gate was not reached');
  assert.equal(posts(t).length, 0);
});

test('(b) the usage gate receives the stored app reading, the same object the last response gave', async () => {
  const seen = [];
  const t = setup({
    answers: { ...dmAnswers(), 'GET me': { id: OWNER } },
    eventOptions: { inbound: { [OTHER]: iso(NOW) } },
    wrapGate: (gate) => ({ check: (usage) => { seen.push(usage); return gate.check(usage); } }),
  });
  await t.service.profileGet();
  const firstApp = t.graph.lastUsage.app;
  await t.service.dmSend({ recipientId: OTHER, text: 'one', confirm: true });
  assert.equal(seen.at(-1), firstApp, 'the reading of the read call, not a copy');
  await t.service.profileGet();
  const secondApp = t.graph.lastUsage.app;
  t.clock.advance(2000);
  await t.service.dmSend({ recipientId: OTHER, text: 'two', confirm: true });
  assert.equal(seen.at(-1), secondApp, 'a later response replaces the stored reading');
});

test('(b) outbound is refused while no usage reading has arrived, and a read supplies one', async () => {
  const t = setup({ answers: { ...dmAnswers(), 'GET me': { id: OWNER } }, eventOptions: { inbound: { [OTHER]: iso(NOW) } } });
  const refused = await t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true });
  assert.equal(refused.busy, true);
  assert.match(refused.reason, /no app usage reading/);
  assert.equal(posts(t).length, 0);
  await t.service.profileGet();
  const sent = await t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true });
  assert.equal(sent.messageId, 'm-sent-1');
});

test('(c) an API_ERROR on a write is reported as unknown and is not retried', async () => {
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: { media: { id: MEDIA } },
      ...ownedMedia,
      [`POST ${COMMENT}/replies`]: { unexpected: true },
    },
  });
  await assert.rejects(
    t.service.commentReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    (err) => err instanceof IgError && err.kind === 'API_ERROR' && /not retried/.test(err.message),
  );
  assert.equal(posts(t).length, 1, 'the write was sent once');
  assert.equal(posts(t)[0].options.retryPost, undefined, 'no retryPost on a write');
  assert.equal(t.guard.stopStatus().stopped, false);
});

test('(d) a like on a comment checks the parent media of the comment', async () => {
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: { media: { id: OTHER_MEDIA } },
      ...likeAnswers(),
    },
  });
  await assert.rejects(t.service.like({ targetId: COMMENT, kind: 'comment', confirm: true }), kindIs('OWNER_MISMATCH'));
  assert.equal(posts(t).length, 0);
  t.graph.answers[`GET ${COMMENT}`] = { media: { id: MEDIA } };
  const liked = await t.service.like({ targetId: COMMENT, kind: 'comment', confirm: true });
  assert.equal(liked.liked, true);
});

test('(d) a like or unlike on a media that is not the owner\'s goes through, within caps and the confirm gate', async () => {
  const t = setup({
    answers: {
      'GET me': { id: OWNER },
      [`POST ${OWNER}/likes`]: { success: true },
      [`DELETE ${OWNER}/likes`]: { success: true },
    },
  });
  await prime(t);
  const before = t.graph.requests.length;
  // Without confirm: a preview, and no request.
  assert.deepEqual(
    await t.service.like({ targetId: OTHER_MEDIA, kind: 'media' }),
    { preview: true, action: 'like', target: OTHER_MEDIA },
  );
  assert.equal(t.graph.requests.length, before, 'the preview made no request');
  // With confirm: one like on the named target, and no read of the owner's media.
  assert.deepEqual(
    await t.service.like({ targetId: OTHER_MEDIA, kind: 'media', confirm: true }),
    { targetId: OTHER_MEDIA, kind: 'media', liked: true },
  );
  assert.equal(posts(t)[0].body.form.media_id, OTHER_MEDIA, 'the like names the target');
  assert.equal(t.graph.requests.some((request) => request.path === 'me/media'), false, 'no ownership read');
  // Caps still apply: the spacing rule blocks an unlike made straight after the like.
  const blocked = await t.service.unlike({ targetId: OTHER_MEDIA, kind: 'media', confirm: true });
  assert.equal(blocked.busy, true);
  t.clock.advance(2000);
  assert.deepEqual(
    await t.service.unlike({ targetId: OTHER_MEDIA, kind: 'media', confirm: true }),
    { targetId: OTHER_MEDIA, kind: 'media', liked: false },
  );
});

test('(d) comment hide and delete check the parent media too', async () => {
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: { media: { id: OTHER_MEDIA } },
      ...ownedMedia,
      [`POST ${COMMENT}`]: { success: true },
      [`DELETE ${COMMENT}`]: { success: true },
    },
  });
  await assert.rejects(t.service.commentHide({ commentId: COMMENT, hide: true, confirm: true }), kindIs('OWNER_MISMATCH'));
  await assert.rejects(t.service.commentDelete({ commentId: COMMENT, confirm: true }), kindIs('OWNER_MISMATCH'));
  assert.equal(t.graph.requests.filter((request) => request.method !== 'GET').length, 0, 'no write was sent');
  t.graph.answers[`GET ${COMMENT}`] = { media: { id: MEDIA } };
  assert.deepEqual(await t.service.commentHide({ commentId: COMMENT, hide: true, confirm: true }), { id: COMMENT, hidden: true });
  t.clock.advance(2000);
  assert.deepEqual(await t.service.commentDelete({ commentId: COMMENT, confirm: true }), { id: COMMENT, deleted: true });
});

// Changed in the P3 round (A-15): truncated follows paging.next, not the page length. Old assertions (removed): a full page
// of 25 with no next link gave truncated true with a reason that said "first page", and a limit of 30 gave truncated false.
test('(d) commentsList refuses another media, and reports truncated when more pages exist beyond the page limit', async () => {
  const t = setup({ answers: { ...ownedMedia, [`GET ${MEDIA}/comments`]: endlessComments } });
  const page = await t.service.commentsList({ mediaId: MEDIA });
  assert.equal(page.comments.length, 10, 'ten pages of one comment each, the default page limit');
  assert.equal(page.truncated, true);
  assert.equal(page.reason, 'more pages exist beyond the page limit');
  await assert.rejects(t.service.commentsList({ mediaId: OTHER_MEDIA }), kindIs('OWNER_MISMATCH'));
  // Added in the P3 review round (M-5). Old assertion: none; the next link carried the token and no request was checked.
  assertNoSecretInRequests(t);
});

test('(d) commentsList reads a thread that ends, and a page with no next link is not truncated', async () => {
  const comments = Array.from({ length: 25 }, (_, index) => ({
    id: `1787091367915${index}`,
    text: 'nice',
    timestamp: graphTime(NOW - HOUR),
    username: 'someone',
    hidden: false,
  }));
  const t = setup({ answers: { ...ownedMedia, [`GET ${MEDIA}/comments`]: { data: comments } } });
  const page = await t.service.commentsList({ mediaId: MEDIA });
  assert.equal(page.comments.length, 25);
  assert.equal(page.truncated, false);
  assert.equal(page.reason, null);
});

test('(e) a hashtag lookup that fails is an error, not a no-match', async () => {
  const t = setup({ facebook: 'keyring', answers: { 'GET ig_hashtag_search': { data: [] } } });
  await assert.rejects(
    t.service.hashtagSearch({ q: 'cats' }),
    (err) => err instanceof IgError && err.kind === 'API_ERROR' && /not a no-match/.test(err.message),
  );
  // A lookup is a read, not an outbound action, so no 2-second gap applies to the next one (P2-I2).
  t.graph.answers['GET ig_hashtag_search'] = { data: [{ id: '17843853946000001' }] };
  const found = await t.service.hashtagSearch({ q: 'cats' });
  assert.deepEqual(found, { hashtagId: '17843853946000001' });
  assert.equal(t.graph.products.at(-1), 'facebook');
});

test('(f) comments, messages and mentions are marked untrusted', async () => {
  const t = setup({
    answers: {
      ...ownedMedia,
      [`GET ${MEDIA}/comments`]: {
        data: [{ id: COMMENT, text: 'hi', timestamp: graphTime(NOW), username: 'x', hidden: false }],
      },
      [`GET ${OWNER}/conversations`]: { data: [{ id: 't_1', updated_time: iso(NOW) }] },
      // The messages edge returns the message fields in the page, so no per-message read is made (P3, one request per page).
      'GET t_1/messages': {
        data: [{ id: 'm1', created_time: iso(NOW), from: { id: OTHER }, to: { data: [{ id: OWNER }] }, message: 'hi' }],
      },
      [`GET ${OWNER}/mentioned_media`]: { id: OTHER_MEDIA, caption: 'from someone', media_type: 'IMAGE' },
    },
  });
  const comments = await t.service.commentsList({ mediaId: MEDIA });
  assert.equal(comments.comments[0].untrusted, true);
  const messages = await t.service.dmMessages({ recipientId: OTHER });
  assert.equal(messages.messages[0].untrusted, true);
  assert.equal(messages.messages[0].text, 'hi');
  const mention = await t.service.mentionedMedia({ mediaId: OTHER_MEDIA });
  assert.equal(mention.untrusted, true);
});

test('(h) dmMessages looks up the conversation by recipient and takes the first id', async () => {
  const seen = [];
  const t = setup({
    answers: {
      [`GET ${OWNER}/conversations`]: (request) => {
        seen.push(request.query);
        return { data: [{ id: 't_first', updated_time: iso(NOW) }, { id: 't_second', updated_time: iso(NOW) }] };
      },
      'GET t_first/messages': { data: [] },
    },
  });
  const result = await t.service.dmMessages({ recipientId: OTHER, limit: 5 });
  // Changed in the P3 round: the result also carries skippedMessages and skippedConversations. Old assertion (removed):
  //   assert.deepEqual(result, { messages: [], truncated: false, reason: null });
  // Changed in the P3 review round (M-4): the result also carries nextAfter. Old assertion (removed):
  //   assert.deepEqual(result, { messages: [], skippedMessages: 0, skippedConversations: 0, truncated: false, reason: null });
  assert.deepEqual(result, { messages: [], skippedMessages: 0, skippedConversations: 0, truncated: false, reason: null, nextAfter: null });
  assert.equal(seen[0].user_id, OTHER);
  // The check covers the conversation's messages edge too, so a request for t_second/messages would be seen.
  assert.equal(t.graph.requests.some((request) => request.path.startsWith('t_second')), false);
});

test('(h) dmMessages with no conversation for the recipient gives an empty list, not an error', async () => {
  const t = setup({ answers: { [`GET ${OWNER}/conversations`]: { data: [] } } });
  // Changed in the P3 round (see the dmMessages test above), and again in the P3 review round (M-4): the result also carries
  // nextAfter. Old assertion (removed):
  //   assert.deepEqual(await t.service.dmMessages({ recipientId: OTHER }), { messages: [], truncated: false, reason: null });
  assert.deepEqual(await t.service.dmMessages({ recipientId: OTHER }), {
    messages: [],
    skippedMessages: 0,
    skippedConversations: 0,
    truncated: false,
    reason: null,
    nextAfter: null,
  });
  assert.equal(t.graph.requests.length, 1);
});

test('(i) auto-reply skips the owner\'s own events and events with empty text, and audits the skip without the text', async () => {
  const t = setup({ autoReply: { enabled: true, rules: RULES }, answers: dmAnswers() });
  await receive(t, inbound({ id: 'e-own', senderId: OWNER, text: 'the price' }));
  await receive(t, inbound({ id: 'e-empty', senderId: OTHER, text: '   ' }));
  assert.equal(posts(t).length, 0);
  const details = t.audit.entries.filter((entry) => entry.action === 'inbound').map((entry) => entry.detail);
  assert.ok(details.some((detail) => detail.startsWith('OWNER')));
  assert.ok(details.some((detail) => detail.startsWith('EMPTY_TEXT')));
  assert.equal(JSON.stringify(t.audit.entries).includes('the price'), false);
});

test('(i) auto-reply answers one sender at most once per 24 hours, and other senders are not limited by it', async () => {
  const t = setup({ autoReply: { enabled: true, rules: RULES }, answers: dmAnswers() });
  await prime(t);
  await receive(t, inbound({ id: 'e1', senderId: OTHER, text: 'price?', receivedAt: iso(NOW) }));
  t.clock.advance(60000);
  await receive(t, inbound({ id: 'e2', senderId: OTHER, text: 'price again', receivedAt: iso(NOW + 60000) }));
  assert.equal(posts(t).length, 1, 'the second reply to the same sender is busy');
  const skipped = t.audit.entries.find((entry) => entry.action === 'inbound' && entry.detail.startsWith('BUSY'));
  assert.ok(skipped, 'the busy skip is audited');
  await receive(t, inbound({ id: 'e3', senderId: '17841400000000009', text: 'price?', receivedAt: iso(NOW + 60000) }));
  assert.equal(posts(t).length, 2, 'another sender is answered');
});

test('(i) the audit line for a skipped inbound event carries the sender and the time, never the text', async () => {
  const t = setup({ autoReply: { enabled: false, rules: RULES } });
  await receive(t, inbound({ id: 'e9', senderId: OTHER, text: 'SECRET price question', receivedAt: iso(NOW) }));
  const entry = t.audit.entries.find((item) => item.action === 'inbound');
  assert.equal(entry.target, OTHER);
  assert.match(entry.detail, /received 2026-10-21T12:00:00\.000Z/);
  assert.equal(JSON.stringify(t.audit.entries).includes('SECRET'), false);
});

test('(j) a repeated inbound event is answered once, even after the sender limit has cleared', async () => {
  const t = setup({
    autoReply: { enabled: true, rules: RULES },
    caps: { autoReplies: { perConversationHours: 1, perDay: 100 } },
    answers: dmAnswers(),
  });
  await prime(t);
  const event = inbound({ id: 'e-dup', senderId: OTHER, text: 'price?', receivedAt: iso(NOW) });
  await receive(t, event);
  assert.equal(posts(t).length, 1);
  t.clock.advance(2 * HOUR);
  await receive(t, event);
  assert.equal(posts(t).length, 1, 'the redelivered event is not answered again');
});

test('(k) audit lines carry no message text and no raw Graph text', async () => {
  const t = setup({
    eventOptions: { inbound: { [OTHER]: iso(NOW) } },
    answers: { ...dmAnswers(), [`POST ${OWNER}/messages`]: () => { throw graphError(400, 100, 'SECRET-GRAPH-TEXT please'); } },
  });
  await prime(t);
  await assert.rejects(
    t.service.dmSend({ recipientId: OTHER, text: 'MY-PRIVATE-DM', confirm: true }),
    (err) => err instanceof IgError && err.kind === 'API_ERROR' && !err.message.includes('SECRET-GRAPH-TEXT'),
  );
  const dump = JSON.stringify(t.audit.entries);
  assert.equal(dump.includes('MY-PRIVATE-DM'), false, 'no message text');
  assert.equal(dump.includes('SECRET-GRAPH-TEXT'), false, 'no raw Graph text');
  assert.ok(t.audit.entries.some((entry) => entry.outcome === 'error' && entry.detail.startsWith('API_ERROR')));
});

test('(k) a stop detail carries codes, not the raw Graph text', async () => {
  const t = setup({
    answers: likeAnswers({ [`POST ${OWNER}/likes`]: () => { throw graphError(400, 190, 'EXPIRED-TOKEN-TEXT'); } }),
  });
  await prime(t);
  await assert.rejects(t.service.like({ targetId: MEDIA, kind: 'media', confirm: true }), kindIs('AUTH_EXPIRED'));
  const stored = t.state.data.get('stop');
  assert.equal(stored.kind, 'AUTH_EXPIRED');
  assert.equal(JSON.stringify(stored).includes('EXPIRED-TOKEN-TEXT'), false);
  assert.match(stored.detail, /code 190/);
});

test('(l) publishMedia is refused with CAP_EXCEEDED when the quota is used up', async () => {
  const quota = (usage) => ({ [`GET ${OWNER}/content_publishing_limit`]: { data: [{ config: { quota_total: 10 }, quota_usage: usage }] } });
  const t = setup({
    answers: {
      ...quota(10),
      [`POST ${OWNER}/media`]: { id: CONTAINER },
      [`POST ${OWNER}/media_publish`]: { id: PUBLISHED },
    },
  });
  await assert.rejects(
    t.service.publishMedia({ kind: 'image', url: 'https://example.com/a.jpg', confirm: true }),
    kindIs('CAP_EXCEEDED'),
  );
  assert.equal(posts(t).length, 0);
  Object.assign(t.graph.answers, quota(9));
  const published = await t.service.publishMedia({ kind: 'image', url: 'https://example.com/a.jpg', confirm: true });
  assert.deepEqual(published, { id: PUBLISHED });
  const read = t.graph.requests.find((request) => request.path === `${OWNER}/content_publishing_limit`);
  assert.equal(read.query.since, Math.floor((NOW - DAY) / 1000), 'the quota is read from 24 hours ago');
});

test('(m) like uses the client named by routes.likes.loginProduct', async () => {
  const t = setup({
    routes: { likes: { loginProduct: 'facebook' } },
    facebook: 'keyring',
    answers: likeAnswers(),
  });
  await prime(t);
  await t.service.like({ targetId: MEDIA, kind: 'media', confirm: true });
  assert.equal(posts(t)[0].product, 'facebook');
  assert.equal(t.graph.requests.find((request) => request.path === 'me').product, 'instagram');
  t.secrets.sources.facebook_token = 'none';
  t.clock.advance(5000);
  await assert.rejects(t.service.like({ targetId: MEDIA, kind: 'media', confirm: true }), kindIs('ROUTE_DISABLED'));
});

test('(n) a read that gets AUTH_EXPIRED is a clean IgError and changes no stop state', async () => {
  const t = setup({ answers: { [`GET ${OWNER}/conversations`]: () => { throw graphError(400, 190, 'expired'); } } });
  await assert.rejects(t.service.dmConversations(), kindIs('AUTH_EXPIRED'));
  assert.equal(t.guard.stopStatus().stopped, false);
});

test('(o) a stop from a write is saved at once', async () => {
  const t = setup({
    answers: likeAnswers({ [`POST ${OWNER}/likes`]: () => { throw graphError(400, 190, 'expired'); } }),
  });
  await prime(t);
  const savesBefore = t.state.saves;
  await assert.rejects(t.service.like({ targetId: MEDIA, kind: 'media', confirm: true }), kindIs('AUTH_EXPIRED'));
  assert.ok(t.state.saves > savesBefore, 'the stop was saved');
  assert.equal(t.state.data.get('stop').stopped, true);
});

test('(o) an AUTH_EXPIRED seen while checking ownership also stops outbound actions', async () => {
  const t = setup({ answers: { [`GET ${COMMENT}`]: () => { throw graphError(400, 190, 'expired'); } } });
  await assert.rejects(t.service.commentReply({ commentId: COMMENT, text: 'hi', confirm: true }), kindIs('AUTH_EXPIRED'));
  assert.equal(t.guard.stopStatus().kind, 'AUTH_EXPIRED');
});

// ---------- Further behaviour ----------

test('dmSend refuses text over 1000 bytes before any count or request, and accepts exactly 1000', async () => {
  const t = setup({ answers: dmAnswers(), eventOptions: { inbound: { [OTHER]: iso(NOW) } } });
  await assert.rejects(t.service.dmSend({ recipientId: OTHER, text: 'a'.repeat(1001), confirm: true }), kindIs('VALIDATION'));
  await assert.rejects(t.service.dmSend({ recipientId: OTHER, text: 'é'.repeat(501), confirm: true }), kindIs('VALIDATION'));
  assert.equal(t.graph.requests.length, 0);
  assert.equal(t.state.data.has('caps.outbound'), false);
  await prime(t);
  const sent = await t.service.dmSend({ recipientId: OTHER, text: 'a'.repeat(1000), confirm: true });
  assert.equal(sent.messageId, 'm-sent-1');
});

test('stopClear without confirm previews and keeps the stop; with confirm it clears and is audited', async () => {
  const t = setup();
  t.guard.stop('CHECKPOINT', 'HTTP none, code none');
  const preview = await t.service.stopClear({});
  assert.equal(preview.result, 'preview');
  assert.equal(t.guard.stopStatus().stopped, true);
  const cleared = await t.service.stopClear({ confirm: true });
  assert.equal(cleared.result, 'cleared');
  assert.equal(t.guard.stopStatus().stopped, false);
  assert.ok(t.audit.entries.some((entry) => entry.action === 'stopClear' && entry.outcome === 'ok'));
});

test('autoReplySet without confirm previews; with confirm it stores the flag that onInbound reads', async () => {
  const t = setup({ autoReply: { enabled: false, rules: RULES }, answers: dmAnswers() });
  await prime(t);
  const preview = await t.service.autoReplySet({ enabled: true });
  assert.deepEqual(preview, { preview: true, action: 'auto_reply_set', target: null });
  assert.equal(t.state.data.has('autoReply.enabled'), false);
  await t.service.autoReplySet({ enabled: true, confirm: true });
  assert.equal((await t.service.status()).autoReply.enabled, true);
  await receive(t, inbound({ text: 'price?' }));
  assert.equal(posts(t).length, 1);
});

test('the event log is used for pending, ack, purge, unread senders and mark-read', async () => {
  const t = setup({ eventOptions: { unread: [OTHER] } });
  await t.service.eventsAck({ cursor: 'c1' });
  assert.deepEqual(await t.service.dmUnread(), { senders: [OTHER] });
  await t.service.dmMarkRead({ senderId: OTHER });
  assert.deepEqual(await t.service.eventsPurge(), { removed: 2 });
  assert.deepEqual(t.events.calls.map((call) => call[0]), ['ack', 'unreadSenders', 'markRead', 'purge']);
});

test('tokenStatus is unknown with no token record, and tokenRefresh stores the new token', async () => {
  const t = setup({ answers: { 'GET refresh_access_token': { access_token: 'EAAB-refreshed-token-0001', expires_in: 5184000 } } });
  assert.equal((await t.service.tokenStatus()).known, false);
  await assert.rejects(t.service.tokenRefresh(), kindIs('VALIDATION'));
  t.state.data.set('token', {
    obtainedAt: iso(NOW - 25 * HOUR),
    expiresAt: iso(NOW + 30 * DAY),
    scopes: ['instagram_business_basic'],
  });
  const status = await t.service.tokenStatus();
  assert.equal(status.known, true);
  assert.equal(status.canRefresh, true);
  const refreshed = await t.service.tokenRefresh();
  assert.equal(refreshed.refreshed, true);
  assert.deepEqual(t.secrets.writes, [['owner_token', 'EAAB-refreshed-token-0001']]);
  assert.equal(t.state.data.get('token').obtainedAt, iso(NOW));
});

test('onInbound never rejects, even when the send fails', async () => {
  const t = setup({
    autoReply: { enabled: true, rules: RULES },
    answers: { ...dmAnswers(), [`POST ${OWNER}/messages`]: () => { throw graphError(500, 1, 'boom'); } },
  });
  await prime(t);
  await assert.doesNotReject(receive(t, inbound({ text: 'price?' })));
  assert.ok(t.audit.entries.some((entry) => entry.action === 'autoReply' && entry.outcome === 'error'));
});

test('a malformed id or an unknown kind is refused before any request', async () => {
  const t = setup({ answers: dmAnswers(), eventOptions: { inbound: { [OTHER]: iso(NOW) } } });
  await assert.rejects(t.service.dmSend({ recipientId: 'not-digits', text: 'hi', confirm: true }), kindIs('VALIDATION'));
  await assert.rejects(t.service.like({ targetId: MEDIA, kind: 'page', confirm: true }), kindIs('VALIDATION'));
  assert.equal(t.graph.requests.length, 0);
});

test('createService refuses an auto-reply rule whose reply is over 1000 bytes', () => {
  assert.throws(
    () => setup({ autoReply: { enabled: true, rules: [{ keyword: 'a', reply: 'é'.repeat(501) }] } }),
    kindIs('CONFIG'),
  );
});

test('status reports the owner account type, the stop and the auto-reply flag', async () => {
  const t = setup({ owner: { accountType: 'creator' }, autoReply: { enabled: false, rules: RULES } });
  const status = await t.service.status();
  assert.equal(status.accountType, 'creator');
  assert.equal(status.stop.stopped, false);
  assert.equal(status.autoReply.enabled, false);
});

// ---------- Task 13 review, fix round 2 ----------

test('I-1 the DM window counts only the last inbound message: a comment an hour old does not open it', async () => {
  const t = setup({
    answers: dmAnswers(),
    eventOptions: { inbound: { [OTHER]: iso(NOW - 25 * HOUR) }, otherInbound: { [OTHER]: iso(NOW - HOUR) } },
  });
  await assert.rejects(t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true }), kindIs('WINDOW_CLOSED'));
  assert.equal(t.graph.requests.length, 0, 'no request was made');
  assert.deepEqual(
    t.events.calls.find((call) => call[0] === 'lastInboundAt'),
    ['lastInboundAt', OTHER, { kind: 'message' }],
  );
});

test('I-2 an audit that throws on a successful write gives one request, one count, the result, and one warning', async () => {
  const t = setup({ answers: likeAnswers() });
  await prime(t);
  // The error's name is distinctive. Its message carries the target id and a token-like string, and neither may reach
  // the warning, which carries the error name only.
  class AuditDiskFullError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AuditDiskFullError';
    }
  }
  t.audit.record = () => {
    throw new AuditDiskFullError(`cannot write ${MEDIA} EAAB-secret-token-value`);
  };
  // A recording stub stands in for process.emitWarning, so that no warning reaches the test output. The original is
  // restored in the finally block, even when the test fails.
  const original = process.emitWarning;
  const warnings = [];
  process.emitWarning = (text) => {
    warnings.push(String(text));
  };
  try {
    const liked = await t.service.like({ targetId: MEDIA, kind: 'media', confirm: true });
    assert.deepEqual(liked, { targetId: MEDIA, kind: 'media', liked: true });
    assert.equal(posts(t).length, 1, 'one write request');
    assert.equal(t.state.data.get('caps.likes').length, 1, 'one like counted');
    assert.equal(t.state.data.get('caps.outbound').length, 1, 'one outbound counted');
    // Exactly one warning, and its text is the error name and nothing else from the audit line.
    assert.deepEqual(warnings, ['audit line not written (AuditDiskFullError)']);
  } finally {
    process.emitWarning = original;
  }
  assert.equal(process.emitWarning, original);
});

test('M-1 a stop set during the owner read stops the action before anything is counted or written', async () => {
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: () => {
        t.guard.stop('CHECKPOINT', 'HTTP none, code none');
        return { media: { id: MEDIA } };
      },
      ...ownedMedia,
      [`POST ${COMMENT}/replies`]: { id: REPLY },
    },
  });
  await assert.rejects(t.service.commentReply({ commentId: COMMENT, text: 'hi', confirm: true }), kindIs('STOPPED'));
  assert.equal(posts(t).length, 0, 'no write request');
  assert.equal(t.state.data.has('caps.outbound'), false, 'nothing was counted');
});

test('M-4 a private reply counts toward the owner DM limit', async () => {
  const t = setup({
    caps: { ownerDms: { perDay: 1 } },
    answers: {
      ...dmAnswers(),
      ...ownedMedia,
      [`GET ${COMMENT}`]: (request) =>
        request.query.fields === 'timestamp' ? { id: COMMENT, timestamp: graphTime(NOW - DAY) } : { media: { id: MEDIA } },
    },
    eventOptions: { inbound: { [OTHER]: iso(NOW) } },
  });
  await prime(t);
  await t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true });
  t.clock.advance(2000);
  const blocked = await t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true });
  assert.equal(blocked.busy, true);
  assert.match(blocked.reason, /owner DMs per day/);
  assert.equal(posts(t).length, 1, 'only the direct message was sent');
  assert.equal(t.state.data.has('private_replies'), false, 'the private reply was not recorded');
});

test('M-7 a read that returns AUTH_EXPIRED sets no stop', async () => {
  const t = setup({ answers: { 'GET me': () => { throw graphError(400, 190, 'Session expired'); } } });
  await assert.rejects(t.service.profileGet(), kindIs('AUTH_EXPIRED'));
  assert.equal(t.guard.stopStatus().stopped, false);
  assert.equal(t.state.data.has('stop'), false);
});

test('M-7 a read that returns CHECKPOINT sets the stop, and the next outbound is refused', async () => {
  const t = setup({
    answers: { ...dmAnswers(), 'GET me': () => { throw graphError(400, 100, 'Checkpoint required'); } },
    eventOptions: { inbound: { [OTHER]: iso(NOW) } },
  });
  await assert.rejects(t.service.profileGet(), kindIs('CHECKPOINT'));
  assert.equal(t.guard.stopStatus().kind, 'CHECKPOINT');
  assert.equal(t.state.data.get('stop').kind, 'CHECKPOINT', 'the stop is saved');
  await assert.rejects(t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true }), kindIs('STOPPED'));
  assert.equal(posts(t).length, 0);
});

test('M-7 a read that returns ACTION_BLOCKED sets the stop', async () => {
  const t = setup({ answers: { 'GET me': () => { throw graphError(400, 368, 'You are blocked'); } } });
  await assert.rejects(t.service.profileGet(), kindIs('ACTION_BLOCKED'));
  assert.equal(t.guard.stopStatus().kind, 'ACTION_BLOCKED');
  assert.equal(t.state.data.get('stop').kind, 'ACTION_BLOCKED', 'the stop is saved');
});

test('M-7 a read that returns RATE_LIMITED sets the stop', async () => {
  const t = setup({ answers: { 'GET me': () => { throw graphError(429, 4, 'Application request limit reached'); } } });
  await assert.rejects(t.service.profileGet(), kindIs('RATE_LIMITED'));
  assert.equal(t.guard.stopStatus().kind, 'RATE_LIMITED');
  assert.equal(t.state.data.get('stop').kind, 'RATE_LIMITED', 'the stop is saved');
});

test('M-8 tokenRefresh with an error 190 sets the stop, and rethrows', async () => {
  const t = setup({ answers: { 'GET refresh_access_token': () => { throw graphError(400, 190, 'Session expired'); } } });
  t.state.data.set('token', {
    obtainedAt: iso(NOW - 25 * HOUR),
    expiresAt: iso(NOW + 30 * DAY),
    scopes: ['instagram_business_basic'],
  });
  await assert.rejects(t.service.tokenRefresh(), kindIs('AUTH_EXPIRED'));
  assert.equal(t.guard.stopStatus().kind, 'AUTH_EXPIRED');
  assert.equal(t.secrets.writes.length, 0, 'no token was stored');
});

test('M-10 dmMarkRead refuses an invalid senderId before any write', async () => {
  const t = setup();
  await assert.rejects(t.service.dmMarkRead({ senderId: 'not-digits' }), kindIs('VALIDATION'));
  await assert.rejects(t.service.dmMarkRead({ senderId: '  ' }), kindIs('VALIDATION'));
  assert.equal(t.events.calls.some((call) => call[0] === 'markRead'), false, 'no mark was written');
});

// Changed in the P3 round (A-15): a page with no next link is not truncated. The old name said truncated true. The P3 fix
// round (ruling 2) made the page 100, so 20 messages is a short page here; the assertion is unchanged in meaning.
test('M-11 a page of 20 messages with no next link is not truncated (P3: truncation follows paging.next)', async () => {
  const answers = {
    [`GET ${OWNER}/conversations`]: { data: [{ id: 't_full', updated_time: iso(NOW) }] },
    'GET t_full/messages': {
      data: Array.from({ length: 20 }, (_, i) => ({
        id: `m${i}`,
        created_time: iso(NOW),
        from: { id: OTHER },
        to: { data: [{ id: OWNER }] },
        message: `hi ${i}`,
      })),
    },
  };
  const t = setup({ answers });
  const page = await t.service.dmMessages({ recipientId: OTHER });
  assert.equal(page.messages.length, 20);
  // Old assertions (removed): truncated true, and reason 'may be truncated: a full page of 20 messages, the first page only'.
  assert.equal(page.truncated, false);
  assert.equal(page.reason, null);
});

test('M-11 a page of fewer than 20 messages is not truncated', async () => {
  const answers = {
    [`GET ${OWNER}/conversations`]: { data: [{ id: 't_short', updated_time: iso(NOW) }] },
    'GET t_short/messages': {
      data: ['m0', 'm1', 'm2'].map((id) => ({ id, created_time: iso(NOW), from: { id: OTHER }, to: { data: [{ id: OWNER }] }, message: id })),
    },
  };
  const t = setup({ answers });
  const page = await t.service.dmMessages({ recipientId: OTHER });
  assert.equal(page.messages.length, 3);
  assert.equal(page.truncated, false);
  assert.equal(page.reason, null);
});

test('M-16 a usage reading at 80 on the app bucket holds an outbound call busy for 60000 ms', async () => {
  const t = setup({ answers: dmAnswers(), eventOptions: { inbound: { [OTHER]: iso(NOW) } } });
  t.graph.usage = () => ({ app: { total_time: 80, total_cputime: 10 }, business: null });
  await prime(t);
  const held = await t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true });
  assert.equal(held.busy, true);
  assert.equal(held.retryAfterMs, 60000);
  assert.match(held.reason, /reached 80 percent/);
  assert.equal(posts(t).length, 0);
  t.clock.advance(30000);
  const stillHeld = await t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true });
  assert.equal(stillHeld.retryAfterMs, 30000);
  t.clock.advance(30000);
  const sent = await t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true });
  assert.equal(sent.messageId, 'm-sent-1', 'the hold has ended, and the same reading does not re-arm it');
});

// F-2 (Task 13 M-6). A hashtag search obeys a stop: it is refused before any count or request.
test('a hashtag search is refused while a stop holds, with no request and no count (F-2)', async () => {
  const t = setup({ facebook: 'keyring', answers: { 'GET ig_hashtag_search': { data: [{ id: '17843853946000001' }] } } });
  t.guard.stop('CHECKPOINT', 'checkpoint required');
  await assert.rejects(t.service.hashtagSearch({ q: 'cats' }), kindIs('STOPPED'));
  assert.equal(t.graph.requests.length, 0, 'no request is made');
  assert.deepEqual(t.audit.entries, [], 'no line is written for a call that was not made');
  // Nothing was counted, so a search straight after the stop clears is not held by the two-second spacing.
  assert.equal(t.guard.clearStop(true), 'cleared');
  assert.deepEqual(await t.service.hashtagSearch({ q: 'cats' }), { hashtagId: '17843853946000001' });
});

// F-2. A counted hashtag search has one audit line: ok on success, and the error kind on failure.
test('a counted hashtag search has one audit line, ok on success and the error kind on failure (F-2)', async () => {
  const t = setup({ facebook: 'keyring', answers: { 'GET ig_hashtag_search': { data: [{ id: '17843853946000001' }] } } });
  await t.service.hashtagSearch({ q: 'cats' });
  assert.deepEqual(
    t.audit.entries.map((e) => [e.action, e.target, e.route, e.outcome]),
    [['hashtagSearch', 'cats', 'facebook', 'ok']],
  );
  t.clock.advance(2000);
  t.graph.answers['GET ig_hashtag_search'] = { data: [] };
  await assert.rejects(t.service.hashtagSearch({ q: 'dogs' }), kindIs('API_ERROR'));
  assert.deepEqual(
    t.audit.entries.slice(1).map((e) => [e.action, e.target, e.outcome, e.detail]),
    [['hashtagSearch', 'dogs', 'error', 'API_ERROR']],
  );
});

// F-22 (Task 13 ledger minor). An error whose name getter throws does not turn a successful write into an error, and the
// warning carries no text from the error.
test('a name getter that throws does not turn a successful search into an error (F-22)', async () => {
  const t = setup({ facebook: 'keyring', answers: { 'GET ig_hashtag_search': { data: [{ id: '17843853946000001' }] } } });
  t.audit.record = () => {
    throw Object.defineProperty(new Error('text that must not reach a warning'), 'name', {
      get() {
        throw new Error('name getter');
      },
    });
  };
  const warnings = [];
  const original = process.emitWarning;
  process.emitWarning = (text) => {
    warnings.push(String(text));
  };
  try {
    assert.deepEqual(await t.service.hashtagSearch({ q: 'cats' }), { hashtagId: '17843853946000001' });
  } finally {
    process.emitWarning = original;
  }
  assert.deepEqual(warnings, ['audit line not written (error)']);
});

// F-24 (Task 17 N-4). The usage callback is not a property of the service object. The holder is made by the caller.
test('the service object does not expose the usage callback, and a holder keeps what it records (F-24)', () => {
  const t = setup();
  assert.equal('recordUsage' in t.service, false);
  const holder = createUsageHolder();
  assert.equal(holder.reading(), undefined);
  holder.record({ app: { call_count: 1 } });
  assert.deepEqual(holder.reading(), { app: { call_count: 1 } });
});

// F-26 (Task 13 M-14). The adapter is resolved inside perform, so a preview of an unmapped feature makes no request and throws
// nothing. A confirmed call with no adapter mapped is NOT_SUPPORTED, and makes no request either.
test('a preview of an unofficial feature with no adapter mapped is a preview, not NOT_SUPPORTED (F-26)', async () => {
  const t = setup({ routes: { unofficial: { enabled: true, acknowledged: true, adapterByFeature: {} } } });
  t.unofficial.forFeature = () => {
    throw new IgError('NOT_SUPPORTED', 'no unofficial adapter is mapped for feature follow');
  };
  assert.equal((await t.service.follow({ userId: OTHER })).preview, true);
  await assert.rejects(t.service.follow({ userId: OTHER, confirm: true }), kindIs('NOT_SUPPORTED'));
  assert.equal(t.graph.requests.length, 0);
});

// F-5 (Task 13 M-2). A call that the caps refuse makes no owner or quota read, because the caps are checked before the reads.
test('a call that the caps refuse makes no Graph read (F-5)', async () => {
  const t = setup({
    answers: likeAnswers(),
    wrapCaps: (caps) => ({ ...caps, check: () => ({ ok: false, reason: 'busy for the test', retryAfterMs: 1000 }) }),
  });
  const result = await t.service.commentReply({ commentId: COMMENT, text: 'thanks', confirm: true });
  assert.equal(result.busy, true);
  assert.equal(t.graph.requests.length, 0, 'no owner read was made');
});

// F-5. A known high usage reading refuses an outbound call before any read is made.
test('a known high usage reading refuses an outbound call before any read (F-5)', async () => {
  const t = setup({ answers: likeAnswers() });
  t.graph.usage = () => ({ app: { total_time: 90, total_cputime: 5 }, business: null });
  await t.service.profileGet();
  const before = t.graph.requests.length;
  const result = await t.service.commentReply({ commentId: COMMENT, text: 'thanks', confirm: true });
  assert.equal(result.busy, true);
  assert.equal(t.graph.requests.length, before, 'no read is made while the reading is high');
});

// F-25 (Task 13 M-12). Official features need a business or creator account, so any other account type is refused.
test('an official feature is refused for an account type other than business or creator (F-25)', async () => {
  const t = setup({ owner: { accountType: 'hobby' } });
  await assert.rejects(
    t.service.commentReply({ commentId: COMMENT, text: 'thanks', confirm: true }),
    kindIs('ROUTE_DISABLED'),
  );
  assert.equal(t.graph.requests.length, 0, 'no request is made');
});

// ---------- P2 (2026-10-22) ----------

// A failure before any request reached Graph, as the client reports it (details.preSend is true).
const preSendError = () => new IgError('API_ERROR', 'Graph API request failed (ECONNREFUSED)', { preSend: true });
// A timeout: the request may have reached Graph, so it is not a pre-send failure (details.preSend is false).
const timeoutError = () => new IgError('API_ERROR', 'Graph API request failed (TimeoutError)', { preSend: false });

test('O-4 the 51st business discovery on the same day is refused with busy and makes no request', async () => {
  const t = setup({ facebook: 'keyring', answers: { [`GET ${OWNER}`]: { business_discovery: { followers_count: 10 } } } });
  for (let i = 0; i < 50; i += 1) {
    await t.service.businessDiscovery({ username: 'other_shop', fields: 'followers_count' });
  }
  const before = t.graph.requests.length;
  const blocked = await t.service.businessDiscovery({ username: 'other_shop', fields: 'followers_count' });
  assert.equal(blocked.busy, true);
  assert.match(blocked.reason, /business discoveries per day/);
  assert.equal(t.graph.requests.length, before, 'no request for the 51st');
});

test('O-4 the 51st mentioned-media lookup on the same day is refused with busy and makes no request', async () => {
  const t = setup({ answers: { [`GET ${OWNER}/mentioned_media`]: { id: OTHER_MEDIA, caption: 'hi', media_type: 'IMAGE' } } });
  for (let i = 0; i < 50; i += 1) {
    await t.service.mentionedMedia({ mediaId: OTHER_MEDIA });
  }
  const before = t.graph.requests.length;
  const blocked = await t.service.mentionedMedia({ mediaId: OTHER_MEDIA });
  assert.equal(blocked.busy, true);
  assert.match(blocked.reason, /mentioned media lookups per day/);
  assert.equal(t.graph.requests.length, before, 'no request for the 51st');
});

test('O-5 a private reply that fails before any request reached Graph releases its reservation, and the next attempt goes through', async () => {
  let failNext = true;
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: (request) =>
        request.query.fields === 'timestamp' ? { id: COMMENT, timestamp: graphTime(NOW - DAY) } : { media: { id: MEDIA } },
      ...ownedMedia,
      [`POST ${OWNER}/messages`]: () => {
        if (failNext) {
          failNext = false;
          throw preSendError();
        }
        return { message_id: 'pr-2' };
      },
    },
  });
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    (err) => err.kind === 'API_ERROR' && /can be sent again/.test(err.message),
  );
  assert.equal(t.state.data.get('private_replies')[COMMENT].released, true, 'the reservation is released for one more attempt');
  // No clock advance: the released count leaves the spacing clear too.
  const sent = await t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true });
  assert.deepEqual(sent, { messageId: 'pr-2', commentId: COMMENT });
  assert.ok(t.state.data.get('private_replies')[COMMENT], 'the second reply is recorded');
  assert.equal(posts(t).length, 2, 'the failed attempt and the second were both sent');
});

test('O-5 a private reply that times out keeps its reservation, and the second attempt is refused', async () => {
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: (request) =>
        request.query.fields === 'timestamp' ? { id: COMMENT, timestamp: graphTime(NOW - DAY) } : { media: { id: MEDIA } },
      ...ownedMedia,
      [`POST ${OWNER}/messages`]: () => {
        throw timeoutError();
      },
    },
  });
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    (err) => err.kind === 'API_ERROR' && /may or may not/.test(err.message),
  );
  assert.equal(t.state.data.get('private_replies')[COMMENT].released, false, 'the reservation is kept');
  t.clock.advance(2000);
  await assert.rejects(t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }), kindIs('CAP_EXCEEDED'));
  assert.equal(posts(t).length, 1, 'the second attempt sent nothing');
});

test('O-5 an auto-reply that fails before any request reached Graph releases its mark and its count, and the next attempt goes through', async () => {
  let failNext = true;
  const t = setup({
    autoReply: { enabled: true, rules: RULES },
    answers: dmAnswers({
      [`POST ${OWNER}/messages`]: () => {
        if (failNext) {
          failNext = false;
          throw preSendError();
        }
        return { message_id: 'ar-2' };
      },
    }),
  });
  await prime(t);
  const event = inbound({ id: 'e-pre', senderId: OTHER, text: 'price?', receivedAt: iso(NOW) });
  await receive(t, event);
  assert.equal(posts(t).length, 1, 'the first attempt was sent and failed');
  assert.equal(t.state.data.get('autoReply.replied')[0].released, true, 'the mark is released for one more attempt');
  assert.equal(t.state.data.get('caps.auto_reply')?.length ?? 0, 0, 'the per-sender count was released');
  await receive(t, event);
  assert.equal(posts(t).length, 2, 'the second attempt was sent');
  assert.deepEqual(t.state.data.get('autoReply.replied'), [{ id: 'e-pre', preSendFailures: 1, released: false }]);
});

test('O-5 an auto-reply that times out keeps its mark, and the second attempt is refused', async () => {
  const t = setup({
    autoReply: { enabled: true, rules: RULES },
    answers: dmAnswers({
      [`POST ${OWNER}/messages`]: () => {
        throw timeoutError();
      },
    }),
  });
  await prime(t);
  const event = inbound({ id: 'e-timeout', senderId: OTHER, text: 'price?', receivedAt: iso(NOW) });
  await receive(t, event);
  await receive(t, event);
  assert.equal(posts(t).length, 1, 'the second attempt sent nothing');
  assert.deepEqual(t.state.data.get('autoReply.replied'), [{ id: 'e-timeout', preSendFailures: 0, released: false }]);
  assert.ok(t.audit.entries.some((entry) => entry.action === 'inbound' && entry.detail.startsWith('ALREADY_HANDLED')));
});

test('O-5 a direct message that fails before any request reached Graph releases its count', async () => {
  let failNext = true;
  const t = setup({
    answers: dmAnswers({
      [`POST ${OWNER}/messages`]: () => {
        if (failNext) {
          failNext = false;
          throw preSendError();
        }
        return { message_id: 'dm-2' };
      },
    }),
    eventOptions: { inbound: { [OTHER]: iso(NOW) } },
  });
  await prime(t);
  await assert.rejects(
    t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true }),
    (err) => err.kind === 'API_ERROR' && /can be sent again/.test(err.message),
  );
  assert.equal(t.state.data.get('caps.owner_dm')?.length ?? 0, 0, 'the owner DM count was released');
  assert.equal(t.state.data.get('caps.outbound')?.length ?? 0, 0, 'the outbound count was released');
  const sent = await t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true });
  assert.equal(sent.messageId, 'dm-2');
});

test('O-6 a token refresh under CHECKPOINT makes no request and reports paused', async () => {
  const t = setup({ answers: { 'GET refresh_access_token': { access_token: 'EAAB-paused-check-0001', expires_in: 5184000 } } });
  t.state.data.set('token', { obtainedAt: iso(NOW - 25 * HOUR), expiresAt: iso(NOW + 30 * DAY), scopes: ['instagram_business_basic'] });
  t.guard.stop('CHECKPOINT', 'HTTP none, code none');
  const result = await t.service.tokenRefresh();
  assert.equal(result.paused, true);
  assert.match(result.reason, /paused while CHECKPOINT/);
  assert.equal(t.graph.requests.length, 0, 'no request');
  assert.equal(t.secrets.writes.length, 0, 'no token stored');
});

test('O-6 a token refresh under ACTION_BLOCKED is paused too', async () => {
  const t = setup({ answers: { 'GET refresh_access_token': { access_token: 'EAAB-paused-check-0002', expires_in: 5184000 } } });
  t.state.data.set('token', { obtainedAt: iso(NOW - 25 * HOUR), expiresAt: iso(NOW + 30 * DAY), scopes: ['instagram_business_basic'] });
  t.guard.stop('ACTION_BLOCKED', 'HTTP none, code none');
  const result = await t.service.tokenRefresh();
  assert.equal(result.paused, true);
  assert.match(result.reason, /paused while ACTION_BLOCKED/);
  assert.equal(t.graph.requests.length, 0);
});

test('O-6 a token refresh with no stop refreshes as before, and one under RATE_LIMITED is not paused', async () => {
  const t = setup({ answers: { 'GET refresh_access_token': { access_token: 'EAAB-refresh-check-0003', expires_in: 5184000 } } });
  t.state.data.set('token', { obtainedAt: iso(NOW - 25 * HOUR), expiresAt: iso(NOW + 30 * DAY), scopes: ['instagram_business_basic'] });
  const refreshed = await t.service.tokenRefresh();
  assert.equal(refreshed.refreshed, true);
  assert.equal(t.graph.requests.length, 1, 'the refresh made its one request');
  t.guard.stop('RATE_LIMITED', 'HTTP none, code none');
  t.state.data.set('token', { obtainedAt: iso(NOW - 25 * HOUR), expiresAt: iso(NOW + 30 * DAY), scopes: ['instagram_business_basic'] });
  const again = await t.service.tokenRefresh();
  assert.equal(again.refreshed, true, 'RATE_LIMITED does not pause the refresh');
});

test('O-6 the token status gives the days left, warns under 7 days, and shows a paused refresh', async () => {
  const t = setup();
  const record = (expiresAt) =>
    t.state.data.set('token', { obtainedAt: iso(NOW - 25 * HOUR), expiresAt, scopes: ['instagram_business_basic'] });
  record(iso(NOW + 6 * DAY + 12 * HOUR));
  let status = await t.service.tokenStatus();
  assert.equal(status.daysLeft, 6);
  assert.match(status.warning, /expires in 6 days/);
  assert.equal(status.refreshPaused, false);
  record(iso(NOW + 20 * DAY));
  status = await t.service.tokenStatus();
  assert.equal(status.daysLeft, 20);
  assert.equal(status.warning, null, 'no warning with 20 days left');
  t.guard.stop('ACTION_BLOCKED', 'HTTP none, code none');
  status = await t.service.tokenStatus();
  assert.equal(status.refreshPaused, true);
  assert.match(status.refreshPauseReason, /ACTION_BLOCKED/);
  assert.equal((await t.service.status()).refreshPaused, true, 'the status shows the pause too');
});

test('O-11 a like on media with no usage reading makes one profile read first, then the like proceeds', async () => {
  const t = setup({ answers: likeAnswers() });
  const result = await t.service.like({ targetId: MEDIA, kind: 'media', confirm: true });
  assert.equal(result.liked, true);
  assert.deepEqual(
    t.graph.requests.map((request) => `${request.method} ${request.path}`),
    ['GET me', `POST ${OWNER}/likes`],
  );
  t.clock.advance(2000);
  await t.service.like({ targetId: OTHER_MEDIA, kind: 'media', confirm: true });
  assert.equal(t.graph.requests.filter((request) => request.path === 'me').length, 1, 'no second profile read');
});

test("O-11 with a failing profile read, the like is refused with the read's kind and sends no like", async () => {
  // The failing reads carry no usage header, as in the real client, so no reading is given by them.
  const t = setup({ answers: { ...likeAnswers(), 'GET me': () => { throw graphError(500, 1, 'boom'); } } });
  t.graph.usage = () => null;
  await assert.rejects(t.service.like({ targetId: MEDIA, kind: 'media', confirm: true }), kindIs('API_ERROR'));
  assert.equal(posts(t).length, 0, 'no like request');
  t.graph.answers['GET me'] = () => { throw graphError(400, 368, 'blocked'); };
  t.clock.advance(2000);
  await assert.rejects(t.service.like({ targetId: MEDIA, kind: 'media', confirm: true }), kindIs('ACTION_BLOCKED'));
  assert.equal(posts(t).length, 0, 'still no like request');
});

test('O-11 a like on a comment makes no profile read, and keeps its parent-media check', async () => {
  const t = setup({ answers: { ...likeAnswers(), [`GET ${COMMENT}`]: { media: { id: MEDIA } } } });
  const liked = await t.service.like({ targetId: COMMENT, kind: 'comment', confirm: true });
  assert.equal(liked.liked, true);
  assert.equal(t.graph.requests.some((request) => request.path === 'me'), false, 'no profile read for a comment');
});

test('A-13 a service method given null, or a non-object, refuses with VALIDATION and makes no request', async () => {
  const t = setup({ answers: dmAnswers(), eventOptions: { inbound: { [OTHER]: iso(NOW) } } });
  await assert.rejects(t.service.profileGet(null), kindIs('VALIDATION'));
  await assert.rejects(t.service.dmSend(null), kindIs('VALIDATION'));
  await assert.rejects(t.service.like('17900000000000001'), kindIs('VALIDATION'));
  await assert.rejects(t.service.status(42), kindIs('VALIDATION'));
  assert.equal(t.graph.requests.length, 0);
});

test('A-35 the service refuses a publish kind or an event decision outside its closed set, before any request', async () => {
  const t = setup({ answers: dmAnswers() });
  await assert.rejects(
    t.service.publishMedia({ kind: 'video', url: 'https://example.com/a.mp4', confirm: true }),
    kindIs('VALIDATION'),
  );
  await assert.rejects(t.service.eventsDecide({ eventId: 'evt-1', decision: 'send', draft: 'x' }), kindIs('VALIDATION'));
  assert.equal(t.graph.requests.length, 0);
  assert.equal(t.events.calls.some((call) => call[0] === 'decide'), false, 'the event log was not asked');
});

// ---------- P2 fix round (2026-10-22) ----------

test('P2-I1 a publish with a bad url, caption or carousel item is refused before any count or request', async () => {
  const t = setup({
    answers: {
      [`GET ${OWNER}/content_publishing_limit`]: { data: [{ config: { quota_total: 10 }, quota_usage: 0 }] },
      [`POST ${OWNER}/media`]: { id: CONTAINER },
      [`POST ${OWNER}/media_publish`]: { id: PUBLISHED },
    },
  });
  await assert.rejects(
    t.service.publishMedia({ kind: 'image', url: 'http://insecure.example/a.jpg', confirm: true }),
    kindIs('VALIDATION'),
  );
  await assert.rejects(
    t.service.publishMedia({ kind: 'image', url: 'https://example.com/a.jpg', caption: 42, confirm: true }),
    kindIs('VALIDATION'),
  );
  await assert.rejects(
    t.service.publishMedia({
      kind: 'carousel',
      urls: [{ imageUrl: 'https://example.com/1.jpg' }, { bogus: 'x' }],
      confirm: true,
    }),
    kindIs('VALIDATION'),
  );
  assert.equal(t.graph.requests.length, 0, 'no request, not even the quota read');
  assert.equal(t.state.data.has('caps.publish'), false, 'no publish count was spent');
  assert.equal(t.state.data.has('caps.outbound'), false, 'no outbound count was spent');
});

test('P2-I2 a lookup under a held CHECKPOINT makes no request, and spends no count', async () => {
  const t = setup({
    facebook: 'keyring',
    answers: {
      [`GET ${OWNER}`]: { business_discovery: { followers_count: 1 } },
      [`GET ${OWNER}/mentioned_media`]: { id: OTHER_MEDIA },
      'GET ig_hashtag_search': { data: [{ id: '17843853946000001' }] },
    },
  });
  t.guard.stop('CHECKPOINT', 'HTTP none, code none');
  await assert.rejects(
    t.service.businessDiscovery({ username: 'other_shop', fields: 'followers_count' }),
    kindIs('STOPPED'),
  );
  await assert.rejects(t.service.mentionedMedia({ mediaId: OTHER_MEDIA }), kindIs('STOPPED'));
  await assert.rejects(t.service.hashtagSearch({ q: 'cats' }), kindIs('STOPPED'));
  assert.equal(t.graph.requests.length, 0, 'no request was made');
  assert.equal(
    ['caps.business_discovery', 'caps.mentioned_media', 'caps.hashtag'].some((key) => t.state.data.has(key)),
    false,
    'no count was spent',
  );
});

test('P2-I2 a lookup spends no outbound count, so an outbound action straight after it is not spaced', async () => {
  const t = setup({
    facebook: 'keyring',
    answers: { [`GET ${OWNER}`]: { business_discovery: { followers_count: 1 } }, ...dmAnswers() },
    eventOptions: { inbound: { [OTHER]: iso(NOW) } },
  });
  await t.service.businessDiscovery({ username: 'other_shop', fields: 'followers_count' });
  await prime(t);
  const sent = await t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true });
  assert.equal(sent.messageId, 'm-sent-1', 'no 2-second gap is needed after a lookup');
  const usage = await t.service.capsStatus();
  assert.equal(usage.outbound.day.used, 1, 'only the direct message counts toward outbound');
  assert.equal(usage.business_discovery.day.used, 1, 'the lookup counts toward its own bucket');
});

test('P2-M1 a lookup whose client cannot be built spends no count', async () => {
  const t = setup({
    facebook: 'keyring',
    answers: { [`GET ${OWNER}`]: { business_discovery: { followers_count: 1 } } },
  });
  t.graph.failClient = 'facebook';
  await assert.rejects(
    t.service.businessDiscovery({ username: 'other_shop', fields: 'followers_count' }),
    kindIs('CONFIG'),
  );
  assert.equal(t.state.data.has('caps.business_discovery'), false, 'no count was spent on the failed build');
  t.graph.failClient = null;
  const found = await t.service.businessDiscovery({ username: 'other_shop', fields: 'followers_count' });
  assert.equal(found.followers_count, 1);
  assert.equal(t.state.data.get('caps.business_discovery').length, 1, 'the good call is counted once');
});

test('P2-M2 a private reply gets one retry after a pre-send failure; a second pre-send failure ends the retry', async () => {
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: (request) =>
        request.query.fields === 'timestamp' ? { id: COMMENT, timestamp: graphTime(NOW - DAY) } : { media: { id: MEDIA } },
      ...ownedMedia,
      [`POST ${OWNER}/messages`]: () => {
        throw preSendError();
      },
    },
  });
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    (err) => err.kind === 'API_ERROR' && /the request for privateReply failed before it reached Instagram; it can be sent again/.test(err.message),
  );
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    (err) => err.kind === 'API_ERROR' && /the one retry is used up/.test(err.message),
  );
  await assert.rejects(t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }), kindIs('CAP_EXCEEDED'));
  assert.equal(posts(t).length, 2, 'the first attempt and its one retry were sent; the third was not');
  assert.equal(t.state.data.get('private_replies')[COMMENT].released, false, 'the reservation is kept after the second failure');
});

test('P2-M2 an auto-reply gets one retry after a pre-send failure; a second pre-send failure ends the retry', async () => {
  const t = setup({
    autoReply: { enabled: true, rules: RULES },
    answers: dmAnswers({
      [`POST ${OWNER}/messages`]: () => {
        throw preSendError();
      },
    }),
  });
  await prime(t);
  const event = inbound({ id: 'e-two', senderId: OTHER, text: 'price?', receivedAt: iso(NOW) });
  await receive(t, event);
  await receive(t, event);
  await receive(t, event);
  assert.equal(posts(t).length, 2, 'two attempts were sent; the third was not');
  assert.ok(
    t.audit.entries.some((entry) => entry.action === 'inbound' && entry.detail.startsWith('RETRY_USED_UP')),
    'the third attempt is audited as RETRY_USED_UP',
  );
  assert.deepEqual(t.state.data.get('autoReply.replied'), [{ id: 'e-two', preSendFailures: 2, released: false }]);
});

test('P2-M6 an unreadable expiry gives the warning and does not throw', async () => {
  const t = setup();
  t.state.data.set('token', { obtainedAt: iso(NOW - 25 * HOUR), expiresAt: 'not-a-time', scopes: ['instagram_business_basic'] });
  const status = await t.service.tokenStatus();
  assert.equal(status.known, true);
  assert.equal(status.daysLeft, null);
  assert.equal(status.warning, 'the expiry time cannot be read');
  assert.equal(status.refreshPaused, false);
});

test('P2F-M3 a publish whose container reached Graph keeps its counts when the publish request fails before it is sent', async () => {
  const t = setup({
    answers: {
      [`GET ${OWNER}/content_publishing_limit`]: { data: [{ config: { quota_total: 10 }, quota_usage: 0 }] },
      [`POST ${OWNER}/media`]: { id: CONTAINER },
      [`POST ${OWNER}/media_publish`]: () => {
        throw preSendError();
      },
    },
  });
  await assert.rejects(
    t.service.publishMedia({ kind: 'image', url: 'https://example.com/a.jpg', confirm: true }),
    (err) =>
      err.kind === 'API_ERROR' &&
      /an earlier request of the same action had reached it, so its count stays counted/.test(err.message) &&
      !/can be sent again/.test(err.message),
  );
  assert.equal(posts(t).length, 2, 'the container and the publish request were each sent once');
  assert.equal(t.state.data.get('caps.publish').length, 1, 'the publish count stays spent');
  assert.equal(t.state.data.get('caps.outbound').length, 1, 'the outbound count stays spent');
});

test('P2F-M3 a publish that fails before any request reached Graph releases its counts', async () => {
  const t = setup({
    answers: {
      [`GET ${OWNER}/content_publishing_limit`]: { data: [{ config: { quota_total: 10 }, quota_usage: 0 }] },
      [`POST ${OWNER}/media`]: () => {
        throw preSendError();
      },
    },
  });
  await assert.rejects(
    t.service.publishMedia({ kind: 'image', url: 'https://example.com/a.jpg', confirm: true }),
    (err) => err.kind === 'API_ERROR' && /failed before it reached Instagram; it can be sent again/.test(err.message),
  );
  assert.equal(posts(t).length, 1, 'only the container request was sent');
  assert.deepEqual(t.state.data.get('caps.publish'), [], 'the publish count is released');
  assert.deepEqual(t.state.data.get('caps.outbound'), [], 'the outbound count is released');
});

// ---------- P3 (2026-10-22) ----------

// Comments whose page carries a next link on every request. Each page has one comment, so ten pages make ten comments.
const endlessComments = (request) => {
  const page = request.query.after === undefined ? 0 : Number(request.query.after.slice(1));
  return {
    data: [{ id: `178709136791${page}0`, text: 'x', timestamp: graphTime(NOW - HOUR), username: 'u', hidden: false }],
    paging: { cursors: { after: `p${page + 1}` }, next: 'https://graph.facebook.com/x?access_token=SECRET' },
  };
};

// A thread read through pages: pages[i] holds the message ids of page i. Every page but the last carries a next link,
// and its cursor is the next page's index. The next link carries a token, which the read must never request.
// M-5 (P3 review): the requests that the service made carry no next link and no token. The next links in these fixtures carry
// access_token=SECRET, so a request that followed one, or named the token, would show here.
function assertNoSecretInRequests(t) {
  const sent = JSON.stringify(t.graph.requests);
  assert.equal(sent.includes('SECRET'), false, 'no request carries the next link or its token');
  assert.equal(sent.includes('access_token'), false, 'no request names an access_token parameter');
}

function threadAnswers(conversationId, pages) {
  const answers = { [`GET ${OWNER}/conversations`]: { data: [{ id: conversationId, updated_time: iso(NOW) }] } };
  // The messages edge: GET {conversation}/messages, with after on the edge (P3 fix round, ruling 1).
  answers[`GET ${conversationId}/messages`] = (request) => {
    const index = request.query.after === undefined ? 0 : Number(request.query.after.slice(1));
    const last = index === pages.length - 1;
    const message = (id) => ({ id, created_time: iso(NOW), from: { id: OTHER }, to: { data: [{ id: OWNER }] }, message: id });
    return {
      data: pages[index].map(message),
      ...(last ? {} : { paging: { cursors: { after: `p${index + 1}` }, next: 'https://graph.instagram.com/x?access_token=SECRET' } }),
    };
  };
  return answers;
}

test('M-11 (P3) a thread of two pages of 20 messages, the second with no next link, is read in full and is not truncated', async () => {
  const pages = [Array.from({ length: 20 }, (_, i) => `m${i}`), Array.from({ length: 20 }, (_, i) => `m${20 + i}`)];
  const t = setup({ answers: threadAnswers('t_full', pages) });
  const page = await t.service.dmMessages({ recipientId: OTHER });
  assert.equal(page.messages.length, 40);
  assert.equal(page.truncated, false);
  assert.equal(page.reason, null);
  // Added in the P3 review round (M-5). Old assertion: none; the second page's next link carried the token.
  assertNoSecretInRequests(t);
});

test('P3 one page is one request through dmMessages: two pages make two messages-edge requests, and no per-message request', async () => {
  const pages = [Array.from({ length: 20 }, (_, i) => `q${i}`), Array.from({ length: 20 }, (_, i) => `q${20 + i}`)];
  const t = setup({ answers: threadAnswers('t_req', pages) });
  const page = await t.service.dmMessages({ recipientId: OTHER });
  const reads = t.graph.requests.filter((request) => request.method === 'GET').map((request) => request.path);
  assert.deepEqual(reads, [`${OWNER}/conversations`, 't_req/messages', 't_req/messages']);
  assert.equal(page.messages.length, 40);
  // Added in the P3 review round (M-5). Old assertion: none; the first page's next link carried the token.
  assertNoSecretInRequests(t);
});

test('M-11 (P3) a thread with more pages than the page limit is truncated at ten pages, and the reason names the page limit', async () => {
  // Eleven pages of three messages. The read stops after ten pages, and page ten has a next link, so it is truncated.
  const pages = Array.from({ length: 11 }, (_, p) => [0, 1, 2].map((k) => `p${p}m${k}`));
  const t = setup({ answers: threadAnswers('t_pages', pages) });
  const page = await t.service.dmMessages({ recipientId: OTHER });
  assert.equal(page.messages.length, 30);
  assert.equal(page.truncated, true);
  assert.equal(page.reason, 'more pages exist beyond the page limit');
  // Added in the P3 review round (M-5). Old assertion: none; every page's next link carried the token.
  assertNoSecretInRequests(t);
});

test('P3 A-21 dmMessages with a limit stops at that many messages and reports truncated by item', async () => {
  const pages = [['m0', 'm1', 'm2']];
  const t = setup({ answers: threadAnswers('t_limit', pages) });
  const page = await t.service.dmMessages({ recipientId: OTHER, limit: 2 });
  assert.deepEqual(page.messages.map((m) => m.id), ['m0', 'm1']);
  assert.equal(page.truncated, true);
  assert.equal(page.reason, 'more items exist beyond the item limit');
  await assert.rejects(t.service.dmMessages({ recipientId: OTHER, limit: 1001 }), kindIs('VALIDATION'));
});

test('P3 A-21 dmConversations returns the conversations, the count of skipped rows, and the paging state', async () => {
  const t = setup({
    answers: { [`GET ${OWNER}/conversations`]: { data: [{ id: 't_1', updated_time: iso(NOW) }, { updated_time: iso(NOW) }] } },
  });
  const result = await t.service.dmConversations();
  assert.deepEqual(result, {
    conversations: [{ id: 't_1', updatedTime: iso(NOW) }],
    skippedConversations: 1,
    truncated: false,
    reason: null,
  });
});

test('P3 A-15 a truncated owner media list refuses a media outside it, and the refusal says the list was truncated', async () => {
  const endlessOwned = (request) => {
    const page = request.query.after === undefined ? 0 : Number(request.query.after.slice(1));
    return {
      data: [{ id: String(1790000000000 + page) }],
      paging: { cursors: { after: `p${page + 1}` }, next: 'https://graph.instagram.com/x?access_token=SECRET' },
    };
  };
  const t = setup({ answers: { 'GET me/media': endlessOwned, [`GET ${OTHER_MEDIA}/comments`]: { data: [] } } });
  await assert.rejects(
    t.service.commentsList({ mediaId: OTHER_MEDIA }),
    (err) => kindIs('OWNER_MISMATCH')(err) && /truncated/.test(err.message),
  );
  // Added in the P3 review round (M-5). Old assertion: none; every owned-media page's next link carried the token.
  assertNoSecretInRequests(t);
});

// M-3 (P3 review): the lookup for the recipient's conversation keeps reading pages within the bound, until it finds a valid
// conversation. A first page of malformed rows does not end it. Old behaviour (removed): the lookup read one page, so the
// match on the second page was never seen and the list came back empty.
test('M-3 a first page of malformed conversation rows does not end the lookup, and the match on the second page is found', async () => {
  const lookups = [];
  const t = setup({
    answers: {
      [`GET ${OWNER}/conversations`]: (request) => {
        lookups.push(request.query.after);
        if (request.query.after === undefined) {
          return {
            data: [{ updated_time: iso(NOW) }],
            paging: { cursors: { after: 'l2' }, next: 'https://graph.instagram.com/x?access_token=SECRET' },
          };
        }
        return { data: [{ id: 't_match', updated_time: iso(NOW) }] };
      },
      'GET t_match/messages': {
        data: [{ id: 'm1', created_time: iso(NOW), from: { id: OTHER }, to: { data: [{ id: OWNER }] }, message: 'hi' }],
      },
    },
  });
  const result = await t.service.dmMessages({ recipientId: OTHER });
  assert.deepEqual(lookups, [undefined, 'l2']);
  assert.deepEqual(result.messages.map((m) => m.id), ['m1']);
  assert.equal(result.skippedConversations, 1);
  assertNoSecretInRequests(t);
});

// M-4 (P3 review): a thread longer than the bound returns truncated with nextAfter, and a call with that after returns the next
// messages. Old behaviour (removed): dmMessages had no after parameter and returned no nextAfter.
test('M-4 a thread longer than 1000 messages returns truncated with nextAfter, and a call with that after returns the next messages', async () => {
  const pages = Array.from({ length: 12 }, (_, p) => Array.from({ length: 100 }, (_, k) => `t${p}_${k}`));
  const t = setup({ answers: threadAnswers('t_long', pages) });
  const first = await t.service.dmMessages({ recipientId: OTHER });
  assert.equal(first.messages.length, 1000);
  assert.equal(first.truncated, true);
  assert.equal(first.nextAfter, 'p10');
  const second = await t.service.dmMessages({ recipientId: OTHER, after: first.nextAfter });
  assert.equal(second.messages.length, 200);
  assert.equal(second.messages[0].id, 't10_0');
  assert.equal(second.truncated, false);
  assert.equal(second.nextAfter, null);
  assertNoSecretInRequests(t);
});

test('M-4 dmMessages refuses an after that is not a cursor string, before any request', async () => {
  const t = setup({ answers: {} });
  for (const after of ['', 5]) {
    await assert.rejects(t.service.dmMessages({ recipientId: OTHER, after }), kindIs('VALIDATION'), `after ${String(after)}`);
  }
  assert.equal(t.graph.requests.length, 0);
});

// P4 review I-5. The targetId of a comment event is the raw digit id that the comment tools take. commentReply accepts it, and without
// confirm it returns the preview for that target and makes no request. The event side is covered in events.test.js.
test('a comment event targetId passes the comment tools id check, and commentReply previews it', async () => {
  const t = setup({ answers: {} });
  const result = await t.service.commentReply({ commentId: COMMENT, text: 'thanks' });
  assert.deepEqual(result, { preview: true, action: 'comment_reply', target: COMMENT });
  assert.equal(t.graph.requests.length, 0);
});

// P4 review M-10. Auto-replies are on, and a stop holds. An inbound event is not notified and no reply is sent. The notify step
// checks the stop, and the guard refuses a reply that is asked for directly. The audit line names the stop, and never the text.
// A control event from another sender is answered with no stop, so the test shows that the stop is what holds the reply.
test('during a STATE_CORRUPT stop, an inbound event is not answered and an auto-reply is refused', async () => {
  const CONTROL = '17841400000000009';
  const t = setup({ autoReply: { enabled: true, rules: RULES }, answers: dmAnswers() });
  await prime(t);
  await receive(t, inbound({ id: 'evt-control', senderId: CONTROL, text: 'price?' }));
  assert.equal(t.audit.entries.filter((entry) => entry.action === 'autoReply' && entry.outcome === 'ok').length, 1, 'with no stop, the control event is answered');

  t.guard.stop('STATE_CORRUPT', 'state file unreadable');
  const requestsBefore = t.graph.requests.length;
  await assert.doesNotReject(receive(t, inbound({ id: 'evt-held', senderId: OTHER, text: 'what is the price today?' })));
  assert.equal(t.graph.requests.length, requestsBefore, 'no request is made for the held event');
  assert.equal(t.audit.entries.filter((entry) => entry.action === 'autoReply' && entry.outcome === 'ok').length, 1, 'no second reply');
  const skipped = t.audit.entries.filter((entry) => entry.action === 'inbound' && entry.target === OTHER);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].detail, /^STOPPED: STATE_CORRUPT; received /);
  assert.equal(JSON.stringify(t.audit.entries).includes('what is the price today?'), false, 'the audit line carries no text');

  await assert.rejects(t.service.dmSend({ recipientId: OTHER, text: 'hi', confirm: true }), kindIs('STOPPED'));
  assert.equal(t.graph.requests.length, requestsBefore, 'the guard refuses the direct reply before any request');
});

// P4 review M-11. status() shows the recovery record that the state holds, and null when there is none.
test('status shows the recovery record of the state, and null when there is none', async () => {
  const recovery = { at: '2026-10-21T12:00:00.000Z', counters: 'rebuilt from the audit file', counted: { likes: 5 } };
  const recovered = setup({ state: { recovery } });
  assert.deepEqual((await recovered.service.status()).recovery, recovery);
  const plain = setup({});
  assert.equal((await plain.service.status()).recovery, null);
});

// P4 review, lost-state rebuild. A business-discovery lookup writes one audit line with its action and outcome, and no identifier: not
// the username, which is another account's.
test('a business-discovery lookup writes one audit line with its action and outcome, and no identifier', async () => {
  const t = setup({
    facebook: 'keyring',
    answers: { [`GET ${OWNER}`]: { business_discovery: { id: OTHER, username: 'other_shop', followers_count: 10 } } },
  });
  await t.service.businessDiscovery({ username: 'other_shop', fields: 'username,followers_count' });
  const lines = t.audit.entries.filter((entry) => entry.action === 'businessDiscovery');
  assert.deepEqual(lines.map((entry) => [entry.outcome, entry.target]), [['ok', null]]);
  assert.equal(JSON.stringify(lines).includes('other_shop'), false, 'the username is not in the audit line');
});

// P5a round 1, I-1. A private reply that was sent, and whose audit line could not be written, sets the one-reply flag. The reply is not
// reported as failed: it was sent. The next private reply is refused locally, with no request, and the status shows the flag.
test('a failed privateReply audit write sets the one-reply flag, and the next private reply is refused with no request', async (ctx) => {
  // The warning for the failed audit write is recorded, not printed, so the test output stays clean. The mock is restored when the test ends.
  ctx.mock.method(process, 'emitWarning', () => {});
  const commentTime = graphTime(NOW - 6 * DAY);
  const t = setup({
    answers: {
      [`GET ${COMMENT}`]: (request) =>
        request.query.fields === 'timestamp' ? { id: COMMENT, timestamp: commentTime } : { media: { id: MEDIA } },
      ...ownedMedia,
      [`POST ${OWNER}/messages`]: { message_id: 'pr-audit' },
    },
  });
  const original = t.audit.record.bind(t.audit);
  t.audit.record = (entry) => {
    if (entry.action === 'privateReply') throw new Error('disk full');
    original(entry);
  };
  const sent = await t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true });
  assert.deepEqual(sent, { messageId: 'pr-audit', commentId: COMMENT }, 'the reply was sent and reported as sent');
  assert.equal(posts(t).length, 1);
  assert.equal(t.state.data.get('oneReplyUnknown').oneReplyUnknown, true, 'the flag is in the state');
  assert.equal((await t.service.status()).oneReplyUnknown.oneReplyUnknown, true, 'the status shows the flag');
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'again', confirm: true }),
    (err) => err.kind === 'STOPPED' && /private replies are refused/.test(err.message),
  );
  assert.equal(posts(t).length, 1, 'no request for the refused reply');
});

// P5a round 1, M-R1-2. The process holds the flag, so a state that no longer holds it (after a failed save restored it) still refuses a
// private reply, and the status still shows the flag.
test('the one-reply flag is held in process: a state that no longer holds it still refuses a private reply', async () => {
  const flag = { oneReplyUnknown: true, since: iso(NOW), reason: 'test reason' };
  const t = setup({ state: { oneReplyUnknown: flag }, answers: dmAnswers() });
  t.state.data.delete('oneReplyUnknown');
  await assert.rejects(
    t.service.privateReply({ commentId: COMMENT, text: 'hi', confirm: true }),
    (err) => err.kind === 'STOPPED' && /private replies are refused: test reason/.test(err.message),
  );
  assert.equal(posts(t).length, 0, 'no request is made');
  assert.equal((await t.service.status()).oneReplyUnknown.reason, 'test reason');
});

// ---------- A-11 (2026-10-23): a write that Graph does not confirm ----------

test('a like answered with 2xx {"error": null} is reported as a write that may or may not have reached Instagram', async () => {
  const t = setup({ answers: likeAnswers({ [`POST ${OWNER}/likes`]: { error: null } }) });
  await prime(t);
  await assert.rejects(
    t.service.like({ targetId: MEDIA, kind: 'media', confirm: true }),
    (err) => err.kind === 'API_ERROR' && /may or may not/.test(err.message),
  );
  assert.equal(posts(t).length, 1, 'the like is sent once');
});

// ---------- P6 (2026-10-23): publishing from files, and the URL check before the first Graph request ----------

const BASE = 'https://media.example.com/owner';
const QUOTA_OK = { [`GET ${OWNER}/content_publishing_limit`]: { data: [{ config: { quota_total: 10 }, quota_usage: 0 }] } };
const SINGLE = { ...QUOTA_OK, [`POST ${OWNER}/media`]: { id: CONTAINER }, [`POST ${OWNER}/media_publish`]: { id: PUBLISHED } };
const CHILD_IDS = ['17900000000000301', '17900000000000302'];
// A carousel of two children. Each child POST answers the next child id, the parent answers CONTAINER, and each child is FINISHED.
function carouselAnswers() {
  let next = 0;
  return {
    ...QUOTA_OK,
    [`POST ${OWNER}/media`]: (request) =>
      request.body.form.media_type === 'CAROUSEL' ? { id: CONTAINER } : { id: CHILD_IDS[next++] },
    [`GET ${CHILD_IDS[0]}`]: { status_code: 'FINISHED' },
    [`GET ${CHILD_IDS[1]}`]: { status_code: 'FINISHED' },
    [`POST ${OWNER}/media_publish`]: { id: PUBLISHED },
  };
}
const COVER = { [inMedia('cover.jpg')]: 2048 };
const headWith = (headers) => fakeHost(() => new Response(null, { status: 200, headers }));

test('P6-1 a publish takes exactly one source: neither or both is refused before any read or request', async () => {
  const t = setup({ media: { publicBaseUrl: BASE }, answers: SINGLE, mediaFs: fakeMediaFs({ files: COVER }) });
  const refused = [
    { kind: 'image', confirm: true },
    { kind: 'image', url: 'https://example.com/a.jpg', file: 'cover.jpg', confirm: true },
    { kind: 'carousel', confirm: true },
    {
      kind: 'carousel',
      urls: [{ imageUrl: 'https://example.com/1.jpg' }, { imageUrl: 'https://example.com/2.jpg' }],
      files: [{ imageFile: 'cover.jpg' }, { imageFile: 'cover.jpg' }],
      confirm: true,
    },
  ];
  for (const input of refused) {
    await assert.rejects(t.service.publishMedia(input), kindIs('VALIDATION'), JSON.stringify(input));
  }
  assert.equal(t.graph.requests.length, 0);
  assert.equal(t.host.requests.length, 0);
  assert.equal(t.mediaFs.calls.length, 0);
});

test('P6-2 a file publish with no publicBaseUrl is refused with CONFIG before any file is read', async () => {
  const t = setup({ media: { publicBaseUrl: null }, answers: SINGLE, mediaFs: fakeMediaFs({ files: COVER }) });
  await assert.rejects(t.service.publishMedia({ kind: 'image', file: 'cover.jpg', confirm: true }), kindIs('CONFIG'));
  assert.equal(t.mediaFs.calls.length, 0);
  assert.equal(t.graph.requests.length, 0);
  assert.equal(t.host.requests.length, 0);
});

test('P6-3 a file path with .., a drive letter or a leading slash is refused before any file is read', async () => {
  const t = setup({ media: { publicBaseUrl: BASE }, answers: SINGLE, mediaFs: fakeMediaFs({ files: COVER }) });
  for (const file of ['../cover.jpg', 'photos/../../cover.jpg', 'C:/cover.jpg', '/etc/cover.jpg']) {
    await assert.rejects(t.service.publishMedia({ kind: 'image', file, confirm: true }), kindIs('VALIDATION'), file);
  }
  assert.equal(t.mediaFs.calls.length, 0);
  assert.equal(t.host.requests.length, 0);
  assert.equal(t.graph.requests.length, 0);
});

test('P6-4 a symlink that points outside media.dir is refused, with no HEAD request, no container request and no count', async () => {
  const target = join(OUTSIDE_DIR, 'secret.jpg');
  const mediaFs = fakeMediaFs({ files: { [target]: 1000 }, links: { [inMedia('link.jpg')]: target } });
  const t = setup({ media: { publicBaseUrl: BASE }, answers: SINGLE, mediaFs });
  await assert.rejects(t.service.publishMedia({ kind: 'image', file: 'link.jpg', confirm: true }), kindIs('VALIDATION'));
  assert.equal(t.host.requests.length, 0);
  assert.equal(t.graph.requests.length, 0);
  assert.equal(t.state.data.get('caps.publish'), undefined, 'the publish count is not spent');
});

test('P6-5 a HEAD check that answers 404 refuses the publish, with no container request and no count', async () => {
  const t = setup({
    media: { publicBaseUrl: BASE },
    answers: SINGLE,
    host: fakeHost(() => new Response(null, { status: 404 })),
  });
  await assert.rejects(
    t.service.publishMedia({ kind: 'image', url: 'https://example.com/a.jpg', confirm: true }),
    kindIs('VALIDATION'),
  );
  assert.equal(t.host.requests.length, 1);
  assert.equal(t.graph.requests.length, 0, 'no container request, and the quota is not read either');
  assert.equal(t.state.data.get('caps.publish'), undefined);
});

test('P6-6 a HEAD check with the wrong Content-Type refuses the publish', async () => {
  const t = setup({
    media: { publicBaseUrl: BASE },
    answers: SINGLE,
    mediaFs: fakeMediaFs({ files: COVER }),
    host: headWith({ 'content-type': 'video/mp4' }),
  });
  await assert.rejects(t.service.publishMedia({ kind: 'image', file: 'cover.jpg', confirm: true }), kindIs('VALIDATION'));
  assert.equal(posts(t).length, 0);
});

test('P6-7 a file whose Content-Length equals its size passes the HEAD check, and the container request follows', async () => {
  const t = setup({
    media: { publicBaseUrl: BASE },
    answers: SINGLE,
    mediaFs: fakeMediaFs({ files: COVER }),
    host: headWith({ 'content-type': 'image/jpeg', 'content-length': '2048' }),
  });
  assert.deepEqual(await t.service.publishMedia({ kind: 'image', file: 'cover.jpg', confirm: true }), { id: PUBLISHED });
  assert.equal(t.host.requests[0].init.method, 'HEAD');
  assert.deepEqual(posts(t).map((request) => request.path), [`${OWNER}/media`, `${OWNER}/media_publish`]);
  assert.equal(posts(t)[0].body.form.image_url, `${BASE}/cover.jpg`);
});

test('P6-7b a Content-Length that differs from the file size refuses the publish, with no container request', async () => {
  const t = setup({
    media: { publicBaseUrl: BASE },
    answers: SINGLE,
    mediaFs: fakeMediaFs({ files: COVER }),
    host: headWith({ 'content-type': 'image/jpeg', 'content-length': '2049' }),
  });
  await assert.rejects(t.service.publishMedia({ kind: 'image', file: 'cover.jpg', confirm: true }), kindIs('VALIDATION'));
  assert.equal(posts(t).length, 0);
});

test('P6-8 the direct url input is checked with HEAD, and its container request follows a passing check', async () => {
  const t = setup({ answers: SINGLE, host: headWith({ 'content-type': 'image/jpeg' }) });
  await t.service.publishMedia({ kind: 'image', url: 'https://example.com/a.jpg', confirm: true });
  assert.deepEqual(t.host.requests.map((request) => [request.init.method, request.url]), [['HEAD', 'https://example.com/a.jpg']]);
  assert.equal(posts(t)[0].body.form.image_url, 'https://example.com/a.jpg');
});

test('P6-9 the URL of a file is publicBaseUrl plus its encoded segments; the HEAD request carries no token and no query string', async () => {
  const mediaFs = fakeMediaFs({ files: { [inMedia('my photos', 'cover #1.jpg')]: 2048 } });
  const t = setup({ media: { publicBaseUrl: BASE }, answers: SINGLE, mediaFs });
  await t.service.publishMedia({ kind: 'image', file: 'my photos/cover #1.jpg', confirm: true });
  const expected = `${BASE}/my%20photos/cover%20%231.jpg`;
  assert.equal(t.host.requests[0].url, expected);
  assert.equal(posts(t)[0].body.form.image_url, expected);
  assert.deepEqual(t.host.requests[0].init.headers, {});
  assert.equal(t.host.requests[0].url.includes('?'), false);
});

test('P6-10 a carousel of files checks each file, and the parent is built from the file URLs', async () => {
  const mediaFs = fakeMediaFs({ files: { [inMedia('a.jpg')]: 100, [inMedia('b.mp4')]: 200 } });
  const t = setup({ media: { publicBaseUrl: BASE }, answers: carouselAnswers(), mediaFs });
  const files = [{ imageFile: 'a.jpg' }, { videoFile: 'b.mp4' }];
  assert.deepEqual(await t.service.publishMedia({ kind: 'carousel', files, caption: 'album', confirm: true }), { id: PUBLISHED });
  assert.deepEqual(t.host.requests.map((request) => request.url), [`${BASE}/a.jpg`, `${BASE}/b.mp4`]);
  const [childA, childB, parent] = posts(t);
  assert.deepEqual(childA.body, { form: { is_carousel_item: true, image_url: `${BASE}/a.jpg` } });
  assert.deepEqual(childB.body, { form: { is_carousel_item: true, video_url: `${BASE}/b.mp4` } });
  assert.equal(parent.body.form.children, CHILD_IDS.join(','));
});

test('P6-11 a carousel of files with one bad item is refused before any file is read or any request is made', async () => {
  const mediaFs = fakeMediaFs({ files: { [inMedia('a.jpg')]: 100 } });
  const t = setup({ media: { publicBaseUrl: BASE }, answers: carouselAnswers(), mediaFs });
  await assert.rejects(
    t.service.publishMedia({ kind: 'carousel', files: [{ imageFile: 'a.jpg' }, { imageFile: 'b.gif' }], confirm: true }),
    kindIs('VALIDATION'),
  );
  assert.equal(mediaFs.calls.length, 0);
  assert.equal(t.host.requests.length, 0);
  assert.equal(t.graph.requests.length, 0);
});

test('P6-12 the HEAD checks count toward no cap: a carousel of two checked files counts once', async () => {
  const mediaFs = fakeMediaFs({ files: { [inMedia('a.jpg')]: 100, [inMedia('b.mp4')]: 200 } });
  const t = setup({ media: { publicBaseUrl: BASE }, answers: carouselAnswers(), mediaFs });
  await t.service.publishMedia({ kind: 'carousel', files: [{ imageFile: 'a.jpg' }, { videoFile: 'b.mp4' }], confirm: true });
  assert.equal(t.host.requests.length, 2);
  assert.equal(t.state.data.get('caps.outbound').length, 1, 'the outbound count is one publish');
  assert.equal(t.state.data.get('caps.publish').length, 1, 'the publish count is one publish');
});

test('P6-13 a file over the size limit is refused before any HEAD or container request', async () => {
  const t = setup({
    media: { publicBaseUrl: BASE },
    answers: SINGLE,
    mediaFs: fakeMediaFs({ files: { [inMedia('big.jpg')]: 8 * MIB + 1 } }),
  });
  await assert.rejects(t.service.publishMedia({ kind: 'image', file: 'big.jpg', confirm: true }), kindIs('VALIDATION'));
  assert.equal(t.host.requests.length, 0);
  assert.equal(posts(t).length, 0);
});

test('P6-14 a preview of a file publish reads no file and makes no request', async () => {
  const mediaFs = fakeMediaFs({ files: COVER });
  const t = setup({ media: { publicBaseUrl: BASE }, answers: SINGLE, mediaFs });
  const preview = await t.service.publishMedia({ kind: 'image', file: 'cover.jpg' });
  assert.equal(preview.preview, true);
  assert.equal(mediaFs.calls.length, 0);
  assert.equal(t.host.requests.length, 0);
  assert.equal(t.graph.requests.length, 0);
});

// ---------- P6 fix round (2026-10-23): the HEAD fallback and the audit digest, through publishMedia ----------

test('P6-FB7 a host that answers 405 to HEAD and 206 to the one-byte GET lets a file publish through, and the container request follows', async () => {
  const host = fakeHost((url, init) =>
    init.method === 'HEAD'
      ? new Response(null, { status: 405 })
      : new Response(new Uint8Array(1), { status: 206, headers: { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/2048' } }),
  );
  const t = setup({ media: { publicBaseUrl: BASE }, answers: SINGLE, mediaFs: fakeMediaFs({ files: COVER }), host });
  assert.deepEqual(await t.service.publishMedia({ kind: 'image', file: 'cover.jpg', confirm: true }), { id: PUBLISHED });
  assert.deepEqual(t.host.requests.map((request) => request.init.method), ['HEAD', 'GET']);
  assert.equal(posts(t)[0].body.form.image_url, `${BASE}/cover.jpg`);
});

test('P6-FB8 a 404 to HEAD refuses a file publish with no one-byte GET and no container request', async () => {
  const t = setup({
    media: { publicBaseUrl: BASE },
    answers: SINGLE,
    mediaFs: fakeMediaFs({ files: COVER }),
    host: fakeHost(() => new Response(null, { status: 404 })),
  });
  await assert.rejects(t.service.publishMedia({ kind: 'image', file: 'cover.jpg', confirm: true }), kindIs('VALIDATION'));
  assert.deepEqual(t.host.requests.map((request) => request.init.method), ['HEAD']);
  assert.equal(t.graph.requests.length, 0);
});

test('P6-AUD2 the publish audit line carries the file digest, the kind and the outcome, and no caption text or path', async () => {
  const bytes = Buffer.alloc(2048, 7);
  const t = setup({
    media: { publicBaseUrl: BASE },
    answers: SINGLE,
    mediaFs: fakeMediaFs({ files: COVER, contents: { [inMedia('cover.jpg')]: bytes } }),
  });
  await t.service.publishMedia({ kind: 'image', file: 'cover.jpg', caption: 'SECRET CAPTION TEXT', confirm: true });
  const lines = t.audit.entries.filter((entry) => entry.action === 'publishMedia');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].outcome, 'ok');
  assert.equal(lines[0].target, 'image');
  assert.equal(lines[0].detail, `file cover.jpg sha256 ${sha256Hex(bytes)}`);
  assert.match(lines[0].detail, /sha256 [0-9a-f]{64}$/);
  const text = JSON.stringify(t.audit.entries);
  assert.equal(text.includes('SECRET CAPTION TEXT'), false, 'the caption is not in the audit');
  assert.equal(text.includes(MEDIA_DIR), false, 'no path beyond the relative name');
});

test('P6-AUD3 the error audit line of a failed file publish keeps the file digest, with the error kind', async () => {
  const bytes = Buffer.alloc(2048, 7);
  const t = setup({
    media: { publicBaseUrl: BASE },
    answers: {
      ...QUOTA_OK,
      [`POST ${OWNER}/media`]: () => {
        throw new IgError('API_ERROR', 'Graph API request failed (boom)');
      },
    },
    mediaFs: fakeMediaFs({ files: COVER, contents: { [inMedia('cover.jpg')]: bytes } }),
  });
  await assert.rejects(t.service.publishMedia({ kind: 'image', file: 'cover.jpg', confirm: true }), kindIs('API_ERROR'));
  const lines = t.audit.entries.filter((entry) => entry.action === 'publishMedia');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].outcome, 'error');
  assert.equal(lines[0].detail, `file cover.jpg sha256 ${sha256Hex(bytes)}; API_ERROR`);
});

test('P6-AUD4 a carousel of files has one digest per file, in order; a publish of direct URLs has no digest', async () => {
  const a = Buffer.alloc(100, 1);
  const b = Buffer.alloc(200, 2);
  const t = setup({
    media: { publicBaseUrl: BASE },
    answers: carouselAnswers(),
    mediaFs: fakeMediaFs({
      files: { [inMedia('a.jpg')]: 100, [inMedia('b.mp4')]: 200 },
      contents: { [inMedia('a.jpg')]: a, [inMedia('b.mp4')]: b },
    }),
  });
  await t.service.publishMedia({ kind: 'carousel', files: [{ imageFile: 'a.jpg' }, { videoFile: 'b.mp4' }], confirm: true });
  const files = t.audit.entries.find((entry) => entry.action === 'publishMedia');
  assert.equal(files.detail, `file a.jpg sha256 ${sha256Hex(a)}; file b.mp4 sha256 ${sha256Hex(b)}`);
  const direct = setup({ answers: SINGLE, host: headWith({ 'content-type': 'image/jpeg' }) });
  await direct.service.publishMedia({ kind: 'image', url: 'https://example.com/a.jpg', confirm: true });
  assert.equal(direct.audit.entries.find((entry) => entry.action === 'publishMedia').detail, null);
});

test('P6-ST1 a story from a .mp4 file uses the video STORIES path, and a story from a .jpg file is refused (stories are video only, spec line 135)', async () => {
  const video = Buffer.alloc(300, 3);
  const t = setup({
    media: { publicBaseUrl: BASE },
    answers: {
      ...QUOTA_OK,
      [`POST ${OWNER}/media`]: { id: CONTAINER },
      [`GET ${CONTAINER}`]: { status_code: 'FINISHED' },
      [`POST ${OWNER}/media_publish`]: { id: PUBLISHED },
    },
    mediaFs: fakeMediaFs({ files: { [inMedia('clip.mp4')]: 300 }, contents: { [inMedia('clip.mp4')]: video } }),
  });
  assert.deepEqual(await t.service.publishMedia({ kind: 'story', file: 'clip.mp4', confirm: true }), { id: PUBLISHED });
  assert.deepEqual(posts(t)[0].body, { form: { media_type: 'STORIES', video_url: `${BASE}/clip.mp4` } });
  assert.equal(t.host.requests[0].init.method, 'HEAD');
  const refused = setup({ media: { publicBaseUrl: BASE }, answers: SINGLE, mediaFs: fakeMediaFs({ files: COVER }) });
  await assert.rejects(refused.service.publishMedia({ kind: 'story', file: 'cover.jpg', confirm: true }), kindIs('VALIDATION'));
  assert.equal(refused.graph.requests.length, 0);
  assert.equal(refused.mediaFs.calls.length, 0, 'the refusal is by name, before any read');
});

test('P6-ST2 with story.images true, a story from a .jpg file publishes as an image story: a STORIES container with image_url, after the image HEAD check', async () => {
  const t = setup({
    story: { images: true },
    media: { publicBaseUrl: BASE },
    answers: {
      ...QUOTA_OK,
      [`POST ${OWNER}/media`]: { id: CONTAINER },
      [`GET ${CONTAINER}`]: { status_code: 'FINISHED' },
      [`POST ${OWNER}/media_publish`]: { id: PUBLISHED },
    },
    mediaFs: fakeMediaFs({ files: COVER }),
  });
  assert.deepEqual(await t.service.publishMedia({ kind: 'story', file: 'cover.jpg', confirm: true }), { id: PUBLISHED });
  assert.deepEqual(t.host.requests.map((request) => request.init.method), ['HEAD']);
  assert.deepEqual(posts(t)[0].body, { form: { media_type: 'STORIES', image_url: `${BASE}/cover.jpg` } });
});

test('P6-ST3 the default, story.images false, reads the config as false and refuses a .jpg story with no read and no request', async () => {
  const mediaFs = fakeMediaFs({ files: COVER });
  const t = setup({ media: { publicBaseUrl: BASE }, answers: SINGLE, mediaFs });
  assert.equal(t.config.story.images, false);
  await assert.rejects(t.service.publishMedia({ kind: 'story', file: 'cover.jpg', confirm: true }), kindIs('VALIDATION'));
  assert.equal(mediaFs.calls.length, 0);
  assert.equal(t.graph.requests.length, 0);
});

// ---------- P6 review fixes (2026-10-23): the host list for direct URLs, and one audit line for every refusal ----------

test('P6-R2s a direct URL on a host that is not on media.allowedHosts is refused before any request; a listed host is probed', async () => {
  const t = setup({ media: { publicBaseUrl: BASE, allowedHosts: ['cdn.example.org'] }, answers: SINGLE });
  await assert.rejects(t.service.publishMedia({ kind: 'image', url: 'https://example.com/a.jpg', confirm: true }), kindIs('VALIDATION'));
  assert.equal(t.host.requests.length, 0, 'no HEAD request to an unlisted host');
  assert.equal(t.graph.requests.length, 0);
  assert.deepEqual(await t.service.publishMedia({ kind: 'image', url: 'https://cdn.example.org/a.jpg', confirm: true }), { id: PUBLISHED });
  assert.deepEqual(t.host.requests.map((request) => [request.init.method, request.url]), [['HEAD', 'https://cdn.example.org/a.jpg']]);
});

test('P6-R9 every refused publish writes one audit line: the action, the outcome refused and the reason kind, with no path, caption or URL', async () => {
  const quotaFull = { [`GET ${OWNER}/content_publishing_limit`]: { data: [{ config: { quota_total: 10 }, quota_usage: 10 } ] } };
  const scenarios = [
    {
      name: 'a file that escapes by name',
      setup: { media: { publicBaseUrl: BASE }, answers: SINGLE, mediaFs: fakeMediaFs({ files: COVER }) },
      input: { kind: 'image', file: '../secret/cover.jpg', caption: 'SECRET CAPTION', confirm: true },
      detail: 'VALIDATION',
    },
    {
      name: 'a direct URL that answers 404',
      setup: { media: { publicBaseUrl: BASE }, answers: SINGLE, host: fakeHost(() => new Response(null, { status: 404 })) },
      input: { kind: 'image', url: 'https://example.com/a.jpg', caption: 'SECRET CAPTION', confirm: true },
      detail: 'VALIDATION',
    },
    {
      name: 'a file with no media.publicBaseUrl',
      setup: { media: { publicBaseUrl: null }, answers: SINGLE, mediaFs: fakeMediaFs({ files: COVER }) },
      input: { kind: 'image', file: 'cover.jpg', caption: 'SECRET CAPTION', confirm: true },
      detail: 'CONFIG',
    },
    {
      name: 'a quota that is used up',
      setup: { media: { publicBaseUrl: BASE }, answers: quotaFull },
      input: { kind: 'image', url: 'https://example.com/a.jpg', caption: 'SECRET CAPTION', confirm: true },
      detail: 'CAP_EXCEEDED',
    },
  ];
  for (const scenario of scenarios) {
    const t = setup(scenario.setup);
    await assert.rejects(t.service.publishMedia(scenario.input), (err) => err instanceof IgError, scenario.name);
    const lines = t.audit.entries.filter((entry) => entry.action === 'publishMedia');
    assert.equal(lines.length, 1, `${scenario.name}: one line`);
    assert.deepEqual([lines[0].outcome, lines[0].detail, lines[0].target], ['refused', scenario.detail, 'image'], scenario.name);
    const text = JSON.stringify(lines[0]);
    for (const secret of ['SECRET CAPTION', 'secret', '../', 'example.com', 'cover.jpg', BASE]) {
      assert.equal(text.includes(secret), false, `${scenario.name}: the line has no ${secret}`);
    }
  }
});
