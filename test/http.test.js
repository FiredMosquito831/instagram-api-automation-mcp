import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { Server } from 'node:http';
import { Readable } from 'node:stream';
import { ERROR_KINDS, HTTP_ERROR_KINDS, IgError, busyResult } from '../src/errors.js';
import { createHttpServer, requestHandlerForTests, listenHttp, MAX_BODY_BYTES } from '../src/http.js';
import { createWebhookHandler } from '../src/webhooks.js';

const API_TOKEN = 'api-token-for-tests-0123456789';
const APP_SECRET = 'app-secret-for-tests';
const VERIFY_TOKEN = 'verify-token-for-tests';
const WEBHOOK_PATH = '/webhooks/instagram';
const HOST = '127.0.0.1:8788';
const T0 = Date.parse('2026-10-20T12:00:00.000Z');
const AUTH = { authorization: `Bearer ${API_TOKEN}` };
const TIMEOUT_MS = 2000;

// A service whose methods are the given functions. Each call is recorded in calls, with the method name and the
// arguments it got. The status method answers by default.
function fakeService(methods = {}) {
  const calls = [];
  const service = { calls };
  const all = { status: () => ({ owner: 'owner-1', stopped: false }), ...methods };
  for (const [name, fn] of Object.entries(all)) {
    service[name] = async (args) => {
      calls.push({ name, args });
      return fn(args);
    };
  }
  return service;
}

// A request: a Readable with the method, the URL, the headers and an optional body. The Host header is the loopback one
// unless the test sets another. No port is opened: the request is a stream.
function fakeRequest({ method = 'GET', url = '/health', headers = {}, body = null } = {}) {
  const req = Readable.from(body === null ? [] : [Buffer.from(body)]);
  req.method = method;
  req.url = url;
  req.headers = { host: HOST, ...headers };
  return req;
}

// A response that records its status, headers and body, and counts how many times it was ended.
function fakeResponse() {
  return {
    statusCode: undefined,
    headers: {},
    body: '',
    ends: 0,
    headersSent: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
      this.headersSent = true;
    },
    end(text = '') {
      this.ends += 1;
      this.body += text;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

// Rejects when the promise does not settle in time, so that a hang fails the test rather than the whole run.
function withTimeout(promise, ms) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// Sends one request to the handler, and checks that the response was ended exactly once.
async function drive(handler, req) {
  const res = fakeResponse();
  await withTimeout(handler(req, res), TIMEOUT_MS);
  assert.equal(res.ends, 1, 'the response is ended exactly once');
  return res;
}

function handlerWith(options = {}) {
  return requestHandlerForTests({ service: fakeService(), apiToken: API_TOKEN, ...options });
}

// The real webhook handler, over an in-memory event log. Each stored event is pushed to appended.
function realWebhookHandler(appended) {
  const events = { hasId: () => false, append: (event) => appended.push(event) };
  const audit = { record: () => {} };
  // The owner is a string of digits, as the handler requires. The payloads here are from user-1, so none is the owner.
  const owner = '1784100000000001';
  return createWebhookHandler({
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    owner,
    events,
    audit,
    now: () => T0,
  });
}

test('health answers without a token', async () => {
  const res = await drive(handlerWith(), fakeRequest({ url: '/health' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test('POST /tools without the bearer token returns 401', async () => {
  const service = fakeService();
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', body: '{}' });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.kind, 'UNAUTHORIZED');
  assert.deepEqual(service.calls, []);
});

test('POST /tools/ig_status with the token returns the status result', async () => {
  const service = fakeService();
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { result: { owner: 'owner-1', stopped: false } });
  assert.deepEqual(service.calls, [{ name: 'status', args: {} }]);
});

test('a busy result returns 429 with busy true in the body', async () => {
  const service = fakeService({
    status: () => busyResult({ reason: 'spacing: wait for the gap', retryAfterMs: 1500.2 }),
  });
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.json(), { busy: true, reason: 'spacing: wait for the gap', retryAfterMs: 1501 });
});

test('unknown tool returns 404', async () => {
  const service = fakeService();
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_nope', headers: AUTH, body: '{}' });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.kind, 'NOT_FOUND');
  assert.deepEqual(service.calls, []);
});

test('an unknown tool without the token is 401, so the tool names are not revealed', async () => {
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_nope', body: '{}' });
  const res = await drive(handlerWith(), req);
  assert.equal(res.statusCode, 401);
});

test('webhook path returns 404 when no handler is given', async () => {
  const handler = handlerWith({ webhookHandler: null, webhookPath: WEBHOOK_PATH });
  for (const method of ['GET', 'POST', 'PUT']) {
    const body = method === 'GET' ? null : '{}';
    const res = await drive(handler, fakeRequest({ method, url: `${WEBHOOK_PATH}?hub.mode=subscribe`, body }));
    assert.equal(res.statusCode, 404, method);
  }
});

test('webhook GET handshake passes through unchanged', async () => {
  const seen = [];
  const webhookHandler = async (args) => {
    seen.push(args);
    return { status: 200, body: args.query['hub.challenge'] };
  };
  const url = `${WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=1158201444`;
  const res = await drive(handlerWith({ webhookHandler, webhookPath: WEBHOOK_PATH }), fakeRequest({ url }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '1158201444');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.deepEqual(
    { ...seen[0].query },
    { 'hub.mode': 'subscribe', 'hub.verify_token': 'abc', 'hub.challenge': '1158201444' },
  );
  assert.equal(seen[0].headers.host, HOST);
});

test('webhook GET handshake with the real handler echoes the challenge', async () => {
  const url = `${WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=987`;
  const handler = handlerWith({ webhookHandler: realWebhookHandler([]), webhookPath: WEBHOOK_PATH });
  const res = await drive(handler, fakeRequest({ url }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '987');
});

test('a repeated handshake parameter is refused by the real handler with 403', async () => {
  const url = `${WEBHOOK_PATH}?hub.mode=subscribe&hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=987`;
  const handler = handlerWith({ webhookHandler: realWebhookHandler([]), webhookPath: WEBHOOK_PATH });
  const res = await drive(handler, fakeRequest({ url }));
  assert.equal(res.statusCode, 403);
});

test('webhook POST reaches the real handler with its raw body and signature', async () => {
  const appended = [];
  const payload = JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: 'owner-1',
        time: T0,
        messaging: [
          {
            sender: { id: 'user-1' },
            recipient: { id: 'owner-1' },
            timestamp: T0,
            message: { mid: 'm-1', text: 'hi' },
          },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac('sha256', APP_SECRET).update(payload).digest('hex')}`;
  const req = fakeRequest({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers: { 'x-hub-signature-256': signature, 'content-type': 'application/json' },
    body: payload,
  });
  const handler = handlerWith({ webhookHandler: realWebhookHandler(appended), webhookPath: WEBHOOK_PATH });
  const res = await drive(handler, req);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'EVENT_RECEIVED');
  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, 'm-1');
});

test('a webhook POST with a bad signature is refused with 403 by the real handler', async () => {
  const appended = [];
  const payload = '{"object":"instagram","entry":[]}';
  const req = fakeRequest({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers: { 'x-hub-signature-256': 'sha256=00' },
    body: payload,
  });
  const handler = handlerWith({ webhookHandler: realWebhookHandler(appended), webhookPath: WEBHOOK_PATH });
  const res = await drive(handler, req);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(appended, []);
});

test('a webhook body over 1 MB is refused with 413 before the handler runs', async () => {
  const seen = [];
  const webhookHandler = async (args) => {
    seen.push(args);
    return { status: 200, body: 'ok' };
  };
  const req = fakeRequest({
    method: 'POST',
    url: WEBHOOK_PATH,
    body: Buffer.alloc(MAX_BODY_BYTES + 1, 'a'),
  });
  const res = await drive(handlerWith({ webhookHandler, webhookPath: WEBHOOK_PATH }), req);
  assert.equal(res.statusCode, 413);
  assert.equal(res.headers.Connection, 'close');
  assert.deepEqual(seen, []);
});

test('the webhook path answers other methods with 405, and names the two it serves', async () => {
  const webhookHandler = async () => ({ status: 200, body: 'ok' });
  const handler = handlerWith({ webhookHandler, webhookPath: WEBHOOK_PATH });
  const res = await drive(handler, fakeRequest({ method: 'PUT', url: WEBHOOK_PATH, body: '{}' }));
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET, POST');
});

test('a Host header outside allowedHosts returns 403', async () => {
  const handler = handlerWith();
  for (const host of ['evil.example:8788', '127.0.0.1', '127.0.0.1:9999', '']) {
    const res = await drive(handler, fakeRequest({ url: '/health', headers: { host } }));
    assert.equal(res.statusCode, 403, `host "${host}"`);
  }
  const missing = await drive(handler, fakeRequest({ url: '/health', headers: { host: undefined } }));
  assert.equal(missing.statusCode, 403, 'a missing Host header');
});

test('a Host header outside allowedHosts is refused before the token is checked on a tool route', async () => {
  const service = fakeService();
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: { ...AUTH, host: 'evil.example:8788' }, body: '{}' });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(service.calls, []);
});

test('the Host header is compared without regard to case', async () => {
  const res = await drive(handlerWith(), fakeRequest({ url: '/health', headers: { host: 'LOCALHOST:8788' } }));
  assert.equal(res.statusCode, 200);
});

test('allowedHosts names are matched with the port given, and full host and port values as written', async () => {
  const named = handlerWith({ allowedHosts: ['127.0.0.1', 'localhost'], port: 9000 });
  const onPort = await drive(named, fakeRequest({ url: '/health', headers: { host: '127.0.0.1:9000' } }));
  assert.equal(onPort.statusCode, 200);
  const otherPort = await drive(named, fakeRequest({ url: '/health', headers: { host: '127.0.0.1:8788' } }));
  assert.equal(otherPort.statusCode, 403);
  const full = handlerWith({ allowedHosts: ['[::1]:8788'] });
  const fullOk = await drive(full, fakeRequest({ url: '/health', headers: { host: '[::1]:8788' } }));
  assert.equal(fullOk.statusCode, 200);
  const fullWrong = await drive(full, fakeRequest({ url: '/health', headers: { host: '127.0.0.1:8788' } }));
  assert.equal(fullWrong.statusCode, 403);
});

test('a Host of [::1]:8788 matches an allowed entry [::1] with port 8788', async () => {
  const handler = handlerWith({ allowedHosts: ['[::1]'], port: 8788 });
  const res = await drive(handler, fakeRequest({ url: '/health', headers: { host: '[::1]:8788' } }));
  assert.equal(res.statusCode, 200);
});

test('a Host of ::1 is refused', async () => {
  const handler = handlerWith({ allowedHosts: ['[::1]'], port: 8788 });
  for (const host of ['::1', '::1:8788']) {
    const res = await drive(handler, fakeRequest({ url: '/health', headers: { host } }));
    assert.equal(res.statusCode, 403, host);
  }
});

test('a bare IPv6 address in allowedHosts is refused at construction', () => {
  assert.throws(
    () => requestHandlerForTests({ service: fakeService(), apiToken: API_TOKEN, allowedHosts: ['::1'] }),
    { name: 'IgError', kind: 'CONFIG' },
  );
});

test('a non-loopback host without an api token is refused at construction', () => {
  for (const host of ['0.0.0.0', '::', '192.168.1.10', 'example.com']) {
    const expected = { name: 'IgError', kind: 'CONFIG' };
    assert.throws(() => createHttpServer({ service: fakeService(), host, apiToken: '' }), expected, host);
    assert.throws(() => createHttpServer({ service: fakeService(), host }), expected, host);
  }
});

test('a non-loopback host with an api token is built, and the server is not listening', () => {
  const server = createHttpServer({ service: fakeService(), host: '0.0.0.0', apiToken: API_TOKEN });
  assert.ok(server instanceof Server);
  assert.equal(server.listening, false);
});

test('listenHttp listens on the validated host and port, and not on every interface', () => {
  const loopback = createHttpServer({ service: fakeService(), host: '127.0.0.1', port: 9123, apiToken: '' });
  const bracketed = createHttpServer({ service: fakeService(), host: '[::1]', port: 9124, apiToken: API_TOKEN });
  const byDefault = createHttpServer({ service: fakeService(), host: '127.0.0.1', apiToken: '' });
  const calls = [];
  for (const server of [loopback, bracketed, byDefault]) {
    // A recording stub in place of listen, so that no socket is opened.
    server.listen = (...args) => {
      calls.push(args);
      return server;
    };
  }
  listenHttp(loopback);
  listenHttp(bracketed);
  listenHttp(byDefault);
  assert.deepEqual(calls, [
    [9123, '127.0.0.1'],
    [9124, '::1'],
    [8788, '127.0.0.1'],
  ]);
});

test('listenHttp refuses a server that createHttpServer did not build, and starts nothing', () => {
  const unlistened = new Server();
  const impostor = {
    listen: () => {
      throw new Error('listen must not be called');
    },
  };
  for (const other of [unlistened, impostor, undefined]) {
    assert.throws(() => listenHttp(other), { name: 'IgError', kind: 'CONFIG' });
  }
});

test('an empty host is refused at construction, because listen would bind every interface', () => {
  for (const host of ['  ', '[]']) {
    assert.throws(
      () => createHttpServer({ service: fakeService(), host, apiToken: API_TOKEN }),
      { name: 'IgError', kind: 'CONFIG' },
      `host "${host}"`,
    );
  }
});

test('a loopback host without an api token builds, and refuses an empty or a non-empty bearer token with 401', async () => {
  for (const host of ['127.0.0.1', '::1', 'localhost']) {
    const server = createHttpServer({ service: fakeService(), host, apiToken: '' });
    assert.ok(server instanceof Server);
    assert.equal(server.listening, false);
  }
  const handler = requestHandlerForTests({ service: fakeService(), host: '127.0.0.1', apiToken: '' });
  for (const authorization of ['Bearer ', 'Bearer x-token-value-000000']) {
    const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: { authorization }, body: '{}' });
    const res = await drive(handler, req);
    assert.equal(res.statusCode, 401, authorization);
  }
});

test('an api token too short to register as a secret is refused at construction', () => {
  assert.throws(
    () => createHttpServer({ service: fakeService(), apiToken: 'short' }),
    { name: 'IgError', kind: 'CONFIG' },
  );
});

test('construction options of the wrong kind are refused', () => {
  const service = fakeService();
  assert.throws(() => createHttpServer({ service, webhookHandler: 'not a function' }), TypeError);
  assert.throws(() => createHttpServer({ service, apiToken: 12345 }), TypeError);
  assert.throws(() => createHttpServer({ service, allowedHosts: [] }), { name: 'IgError', kind: 'CONFIG' });
  assert.throws(() => createHttpServer({ service, port: 70000 }), { name: 'IgError', kind: 'CONFIG' });
});

test('a wrong token, or a prefix of the right one, returns 401', async () => {
  const service = fakeService();
  const handler = handlerWith({ service });
  const values = [`Bearer ${API_TOKEN}x`, `Bearer ${API_TOKEN.slice(0, 10)}`, 'Bearer wrong-token-value-000000', 'Bearer'];
  for (const authorization of values) {
    const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: { authorization }, body: '{}' });
    const res = await drive(handler, req);
    assert.equal(res.statusCode, 401, authorization);
  }
  assert.deepEqual(service.calls, []);
});

test('a scheme other than Bearer, or a bare token, is refused with 401', async () => {
  const handler = handlerWith();
  const values = [`Basic ${Buffer.from(API_TOKEN).toString('base64')}`, `Token ${API_TOKEN}`, API_TOKEN];
  for (const authorization of values) {
    const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: { authorization }, body: '{}' });
    const res = await drive(handler, req);
    assert.equal(res.statusCode, 401, authorization);
  }
});

test('the Bearer scheme is read without regard to case', async () => {
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: { authorization: `bearer ${API_TOKEN}` }, body: '{}' });
  const res = await drive(handlerWith(), req);
  assert.equal(res.statusCode, 200);
});

test('the token is not accepted from the URL', async () => {
  const service = fakeService();
  const url = `/tools/ig_status?token=${API_TOKEN}&access_token=${API_TOKEN}`;
  const res = await drive(handlerWith({ service }), fakeRequest({ method: 'POST', url, body: '{}' }));
  assert.equal(res.statusCode, 401);
  assert.deepEqual(service.calls, []);
});

test('an unknown method is 405, and the Allow header names the methods that are served', async () => {
  const handler = handlerWith();
  const cases = [
    ['PUT', '/health', null, 'GET'],
    ['POST', '/health', '{}', 'GET'],
    ['GET', '/tools/ig_status', null, 'POST'],
    ['DELETE', '/tools/ig_status', null, 'POST'],
  ];
  for (const [method, url, body, allow] of cases) {
    const res = await drive(handler, fakeRequest({ method, url, headers: AUTH, body }));
    assert.equal(res.statusCode, 405, `${method} ${url}`);
    assert.equal(res.headers.Allow, allow, `${method} ${url}`);
  }
});

test('an unknown path is 404', async () => {
  const handler = handlerWith();
  for (const url of ['/nope', '/tools', '/tools/a/b']) {
    const res = await drive(handler, fakeRequest({ method: 'POST', url, headers: AUTH, body: '{}' }));
    assert.equal(res.statusCode, 404, url);
  }
});

test('a body that fails validation is 400, and the handler does not run', async () => {
  const service = fakeService({ mediaGet: () => ({ id: '1' }) });
  const handler = handlerWith({ service });
  for (const body of ['{}', '{"mediaId": 17}']) {
    const req = fakeRequest({ method: 'POST', url: '/tools/ig_media_get', headers: AUTH, body });
    const res = await drive(handler, req);
    assert.equal(res.statusCode, 400, body);
    assert.equal(res.json().error.kind, 'VALIDATION');
  }
  assert.deepEqual(service.calls, []);
});

test('an unknown tool is refused before its body is read', async () => {
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_nope', headers: AUTH, body: Buffer.alloc(MAX_BODY_BYTES + 1, 'a') });
  const res = await drive(handlerWith(), req);
  assert.equal(res.statusCode, 404);
  assert.equal(req.readableDidRead, false);
});

test('a request without the token is refused before its body is read', async () => {
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', body: Buffer.alloc(MAX_BODY_BYTES + 1, 'a') });
  const res = await drive(handlerWith(), req);
  assert.equal(res.statusCode, 401);
  assert.equal(req.readableDidRead, false);
});

test('bodies over 1 MB are rejected with 413, and the handler does not run', async () => {
  const service = fakeService();
  const req = fakeRequest({
    method: 'POST',
    url: '/tools/ig_status',
    headers: AUTH,
    body: 'a'.repeat(MAX_BODY_BYTES + 1),
  });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 413);
  assert.equal(res.headers.Connection, 'close');
  assert.equal(res.json().error.kind, 'PAYLOAD_TOO_LARGE');
  assert.deepEqual(service.calls, []);
});

test('a body of exactly 1 MB is read and passed on', async () => {
  const pad = MAX_BODY_BYTES - Buffer.byteLength('{"x":""}');
  const body = `{"x":"${'a'.repeat(pad)}"}`;
  assert.equal(Buffer.byteLength(body), MAX_BODY_BYTES);
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body });
  const res = await drive(handlerWith(), req);
  assert.equal(res.statusCode, 200);
});

test('an empty body is taken as no arguments', async () => {
  const service = fakeService();
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '' });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(service.calls, [{ name: 'status', args: {} }]);
});

test('an invalid JSON body is 400, and a JSON value that is not an object is 400', async () => {
  const handler = handlerWith();
  for (const body of ['{', '[]', 'null', '"text"', '7']) {
    const res = await drive(handler, fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body }));
    assert.equal(res.statusCode, 400, body);
    assert.equal(res.json().error.kind, 'VALIDATION', body);
  }
});

test('a body that fails while it is read is refused with 400, not 500', async () => {
  const req = new Readable({
    read() {
      this.destroy(new Error('connection reset'));
    },
  });
  Object.assign(req, { method: 'POST', url: '/tools/ig_status', headers: { host: HOST, ...AUTH } });
  const res = await drive(handlerWith(), req);
  assert.equal(res.statusCode, 400);
});

// A request whose body has been read to its end and which is not destroyed. readRawBody cannot wait this state out: the
// end event has already been emitted, so no further end event comes. (A stream that auto-destroys after its end is not
// this state, because its close event fires and readRawBody settles.)
async function endedRequest({ method, url, headers, body }) {
  const req = new Readable({ autoDestroy: false, read() {} });
  Object.assign(req, { method, url, headers: { host: HOST, ...headers } });
  req.push(Buffer.from(body));
  req.push(null);
  req.resume();
  await once(req, 'end');
  assert.equal(req.readableEnded, true);
  assert.equal(req.destroyed, false);
  return req;
}

test('a request whose body has already ended is refused without waiting', async () => {
  const req = await endedRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
  const res = await drive(handlerWith(), req);
  assert.equal(res.statusCode, 400);
});

test('a request that is destroyed or has closed is refused without waiting', async () => {
  const destroyed = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
  destroyed.destroy();
  const closed = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
  closed.destroy();
  await once(closed, 'close');
  for (const req of [destroyed, closed]) {
    const res = await drive(handlerWith(), req);
    assert.equal(res.statusCode, 400);
  }
});

test('a webhook POST whose body has already ended is refused without waiting', async () => {
  const req = await endedRequest({ method: 'POST', url: WEBHOOK_PATH, headers: {}, body: '{}' });
  const handler = handlerWith({ webhookHandler: async () => ({ status: 200, body: 'ok' }), webhookPath: WEBHOOK_PATH });
  const res = await drive(handler, req);
  assert.equal(res.statusCode, 400);
});

test('a result is redacted before it is sent', async () => {
  const service = fakeService({ status: () => ({ note: `the token is ${API_TOKEN}` }) });
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes(API_TOKEN));
});

test('an error message is redacted before it is sent', async () => {
  const service = fakeService({
    status: () => {
      throw new IgError('API_ERROR', `Graph said access_token=EAAB1234567890abcdef and ${API_TOKEN}`);
    },
  });
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 500);
  assert.ok(!res.body.includes('EAAB1234567890abcdef'));
  assert.ok(!res.body.includes(API_TOKEN));
});

test('an unexpected error is a 500 with a generic message and no detail', async () => {
  const service = fakeService({
    status: () => {
      throw new TypeError(`boom at /srv/secret.js with ${API_TOKEN}`);
    },
  });
  // The warning goes to a recording stub, so that it does not reach the test output. The original is restored in finally.
  const original = process.emitWarning;
  const warnings = [];
  process.emitWarning = (text) => {
    warnings.push(String(text));
  };
  let res;
  try {
    const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
    res = await drive(handlerWith({ service }), req);
  } finally {
    process.emitWarning = original;
  }
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: { kind: 'INTERNAL', message: 'the request failed' } });
  // Exactly one warning, carrying the error name (TypeError) and nothing else.
  assert.deepEqual(warnings, ['the HTTP API caught an unexpected TypeError']);
  assert.equal(process.emitWarning, original);
});

test('each error kind maps to its status, and every other kind is 500', async () => {
  const cases = {
    VALIDATION: 400,
    STOPPED: 409,
    CAP_EXCEEDED: 429,
    OWNER_MISMATCH: 403,
    ROUTE_DISABLED: 403,
    CONFIG: 500,
    CONFIRMATION_REQUIRED: 500,
    NOT_SUPPORTED: 500,
    WINDOW_CLOSED: 500,
    AUTH_EXPIRED: 423,
    RATE_LIMITED: 423,
    ACTION_BLOCKED: 423,
    CHECKPOINT: 423,
    API_ERROR: 500,
    UNOFFICIAL_ADAPTER_ERROR: 500,
  };
  assert.deepEqual(Object.keys(cases).sort(), [...ERROR_KINDS].sort(), 'the table covers every error kind');
  for (const [kind, status] of Object.entries(cases)) {
    const service = fakeService({
      status: () => {
        throw new IgError(kind, `failed as ${kind}`);
      },
    });
    const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
    const res = await drive(handlerWith({ service }), req);
    assert.equal(res.statusCode, status, kind);
    assert.equal(res.json().error.kind, kind, kind);
  }
});

// The four stop kinds: each is a persisted stop, and each is 423 Locked with its kind in the body.
test('each stop kind is 423 Locked, with its kind in the body', async () => {
  for (const kind of ['AUTH_EXPIRED', 'CHECKPOINT', 'ACTION_BLOCKED', 'RATE_LIMITED']) {
    const service = fakeService({
      status: () => {
        throw new IgError(kind, `stopped as ${kind}`);
      },
    });
    const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
    const res = await drive(handlerWith({ service }), req);
    assert.equal(res.statusCode, 423, kind);
    assert.deepEqual(res.json(), { error: { kind, message: `stopped as ${kind}` } }, kind);
  }
});

test('STOPPED is 409, the service refusal while a stop holds, and VALIDATION is 400', async () => {
  for (const [kind, status] of [['STOPPED', 409], ['VALIDATION', 400]]) {
    const service = fakeService({
      status: () => {
        throw new IgError(kind, `refused as ${kind}`);
      },
    });
    const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
    const res = await drive(handlerWith({ service }), req);
    assert.equal(res.statusCode, status, kind);
    assert.equal(res.json().error.kind, kind, kind);
  }
});

test('an error kind that the table does not know is 500, with its kind in the body', async () => {
  // IgError refuses an unknown kind when it is built, so the kind is set after construction, as a later kind would be.
  const unknown = Object.assign(new IgError('API_ERROR', 'an unknown failure'), { kind: 'SOME_FUTURE_KIND' });
  const service = fakeService({
    status: () => {
      throw unknown;
    },
  });
  const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.kind, 'SOME_FUTURE_KIND');
});

test('the api token never appears in a response, on any route', async () => {
  const handler = handlerWith();
  const requests = [
    fakeRequest({ url: '/health', headers: { host: 'evil.example' } }),
    fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: { authorization: 'Bearer nope-nope-nope' }, body: '{}' }),
    fakeRequest({ method: 'POST', url: `/tools/ig_nope?t=${API_TOKEN}`, headers: AUTH, body: '{}' }),
    fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{"bad":' }),
    fakeRequest({ method: 'PUT', url: '/health', headers: AUTH }),
    fakeRequest({ url: `/nothing?x=${API_TOKEN}` }),
  ];
  for (const req of requests) {
    const res = await drive(handler, req);
    assert.ok(!res.body.includes(API_TOKEN), req.url);
    assert.ok(!JSON.stringify(res.headers).includes(API_TOKEN), req.url);
  }
});

test('an unknown tool name is 404 for a name the tool list does not have', async () => {
  const seen = [];
  const custom = {
    name: 'ig_custom',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: (service, args) => {
      seen.push(args);
      return { ran: true };
    },
  };
  const handler = handlerWith({ tools: [custom] });
  const found = await drive(handler, fakeRequest({ method: 'POST', url: '/tools/ig_custom', headers: AUTH, body: '{}' }));
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), { result: { ran: true } });
  // ig_status is in the registry, but not in the list this handler was given, so the lookup must fail.
  const missing = await drive(handler, fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' }));
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.kind, 'NOT_FOUND');
  assert.deepEqual(seen, [{}]);
});

test('an unexpected error gives a 500, and one warning that carries only the error name', async () => {
  const service = fakeService({
    status: () => {
      throw new Error(`boom with ${API_TOKEN}`);
    },
  });
  // A recording stub stands in for process.emitWarning, so that no warning reaches the test output. The original is
  // restored in the finally block, even when the request fails.
  const original = process.emitWarning;
  const warnings = [];
  process.emitWarning = (text) => {
    warnings.push(String(text));
  };
  let res;
  try {
    const req = fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' });
    res = await drive(handlerWith({ service }), req);
  } finally {
    process.emitWarning = original;
  }
  assert.equal(res.statusCode, 500);
  // Exactly one warning, and its text is the error name (Error) and nothing else: not the message, not the token.
  assert.deepEqual(warnings, ['the HTTP API caught an unexpected Error']);
  assert.equal(process.emitWarning, original);
});

test('the webhook handler gets no authorization header, and the other headers unchanged', async () => {
  const seen = [];
  const webhookHandler = async (args) => {
    seen.push(args);
    return { status: 200, body: 'ok' };
  };
  const req = fakeRequest({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      Authorization: `Bearer ${API_TOKEN}`,
      'x-hub-signature-256': 'sha256=abc',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  const res = await drive(handlerWith({ webhookHandler, webhookPath: WEBHOOK_PATH }), req);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen[0].headers, {
    host: HOST,
    'x-hub-signature-256': 'sha256=abc',
    'content-type': 'application/json',
  });
  assert.ok(!JSON.stringify(seen[0].headers).includes(API_TOKEN));
});

test('a Host outside allowedHosts is 403 on the webhook path too', async () => {
  const seen = [];
  const webhookHandler = async (args) => {
    seen.push(args);
    return { status: 200, body: 'ok' };
  };
  const handler = handlerWith({ webhookHandler, webhookPath: WEBHOOK_PATH });
  const get = await drive(
    handler,
    fakeRequest({ method: 'GET', url: `${WEBHOOK_PATH}?hub.mode=subscribe`, headers: { host: 'evil.example' } }),
  );
  const post = await drive(
    handler,
    fakeRequest({ method: 'POST', url: WEBHOOK_PATH, headers: { host: 'evil.example:8788' }, body: '{}' }),
  );
  assert.equal(get.statusCode, 403);
  assert.equal(post.statusCode, 403);
  assert.deepEqual(seen, []);
});

test('a request that declares a body over 1 MB is refused with 413 before its body is read, on the tools route', async () => {
  const service = fakeService();
  const req = fakeRequest({
    method: 'POST',
    url: '/tools/ig_status',
    headers: { ...AUTH, 'content-length': String(2 * MAX_BODY_BYTES) },
    body: Buffer.alloc(2 * MAX_BODY_BYTES, 'a'),
  });
  const res = await drive(handlerWith({ service }), req);
  assert.equal(res.statusCode, 413);
  assert.equal(res.headers.Connection, 'close');
  assert.equal(req.readableDidRead, false);
  assert.deepEqual(service.calls, []);
});

test('a request that declares a body over 1 MB is refused with 413 before its body is read, on the webhook route', async () => {
  const seen = [];
  const webhookHandler = async (args) => {
    seen.push(args);
    return { status: 200, body: 'ok' };
  };
  const req = fakeRequest({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers: { 'content-length': String(2 * MAX_BODY_BYTES) },
    body: Buffer.alloc(2 * MAX_BODY_BYTES, 'a'),
  });
  const res = await drive(handlerWith({ webhookHandler, webhookPath: WEBHOOK_PATH }), req);
  assert.equal(res.statusCode, 413);
  assert.equal(req.readableDidRead, false);
  assert.deepEqual(seen, []);
});

test('a content-length that is not a whole number is refused with 400, before the body is read', async () => {
  const req = fakeRequest({
    method: 'POST',
    url: '/tools/ig_status',
    headers: { ...AUTH, 'content-length': '12abc' },
    body: '{}',
  });
  const res = await drive(handlerWith(), req);
  assert.equal(res.statusCode, 400);
  assert.equal(req.readableDidRead, false);
});

// F-17 (Task 15 K-1, K-2, M-13). A direct listen on a server from createHttpServer is refused, and listenHttp starts the server
// on its validated binding. The native listen is a recorder, so no socket is opened.
test('a direct listen on a server from createHttpServer is refused, and listenHttp starts it on its binding (F-17)', (t) => {
  const original = Server.prototype.listen;
  const calls = [];
  Server.prototype.listen = function recordListen(...args) {
    calls.push(args);
    return this;
  };
  t.after(() => {
    Server.prototype.listen = original;
  });
  const server = createHttpServer({ service: fakeService(), host: '[::1]', port: 9127, apiToken: API_TOKEN });
  assert.throws(() => server.listen(9127), { name: 'IgError', kind: 'CONFIG' });
  assert.deepEqual(calls, [], 'the refused listen reaches nothing');
  listenHttp(server);
  assert.deepEqual(calls, [[9127, '::1']]);
});

// F-18 (Task 15 N-2). A host that is empty once the brackets are removed and the rest is trimmed is refused at construction.
test('a host of "[ ]" is refused at construction as an empty host (F-18)', () => {
  for (const host of ['[ ]', ' [ ] ', '[  ]']) {
    assert.throws(
      () => createHttpServer({ service: fakeService(), host, apiToken: API_TOKEN }),
      { name: 'IgError', kind: 'CONFIG' },
      host,
    );
  }
});

// The kinds that the HTTP layer raises on its own (M-12). Each is sent by a request below, and the list HTTP_ERROR_KINDS in
// src/errors.js is the one place they are named. None of them is an IgError kind.
test('the HTTP-only error kinds are exactly the ones the HTTP layer sends, and none of them is an IgError kind', async () => {
  const sent = new Set();
  const note = async (handler, req) => {
    const res = await drive(handler, req);
    if (res.statusCode >= 400) sent.add(res.json().error.kind);
  };
  await note(handlerWith(), fakeRequest({ method: 'POST', url: '/tools/ig_status', body: '{}' }));
  await note(handlerWith(), fakeRequest({ url: '/health', headers: { host: 'evil.example' } }));
  await note(handlerWith(), fakeRequest({ method: 'POST', url: '/tools/ig_nope', headers: AUTH, body: '{}' }));
  await note(handlerWith(), fakeRequest({ method: 'GET', url: '/tools/ig_status', headers: AUTH }));
  await note(
    handlerWith(),
    fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: 'a'.repeat(MAX_BODY_BYTES + 1) }),
  );
  // An error that is not an IgError is INTERNAL. Its warning goes to a recording stub, as in the test above.
  const service = fakeService({
    status: () => {
      throw new TypeError('boom');
    },
  });
  const original = process.emitWarning;
  process.emitWarning = () => {};
  try {
    await note(handlerWith({ service }), fakeRequest({ method: 'POST', url: '/tools/ig_status', headers: AUTH, body: '{}' }));
  } finally {
    process.emitWarning = original;
  }
  assert.deepEqual([...sent].sort(), [...HTTP_ERROR_KINDS].sort());
  for (const kind of HTTP_ERROR_KINDS) {
    assert.equal(ERROR_KINDS.includes(kind), false, kind);
    assert.throws(() => new IgError(kind, 'x'), TypeError, kind);
  }
});
