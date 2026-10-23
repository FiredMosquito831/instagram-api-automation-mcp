import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphClient } from '../src/graph/client.js';
import { like, unlike } from '../src/graph/endpoints/likes.js';
import { mediaDelete } from '../src/graph/endpoints/media.js';

const TOKEN = 'TEST_TOKEN_VALUE';
const CONFIG = Object.freeze({
  graph: Object.freeze({
    version: 'v26.0',
    instagramBase: 'https://graph.instagram.com',
    facebookBase: 'https://graph.facebook.com',
  }),
});
const APP_USAGE_HIGH = JSON.stringify({ call_count: 28, total_time: 90, total_cputime: 5 });
const BUSINESS_USAGE = JSON.stringify({ '17841400000000001': [{ type: 'instagram', call_count: 1 }] });

// A response for the fake fetch. A string body is sent as text; any other body is sent as JSON.
function reply(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const type = typeof body === 'string' ? 'text/plain' : 'application/json';
  return new Response(text, { status, headers: { 'content-type': type, ...headers } });
}

const ok = (body = {}, headers = {}) => reply(200, body, headers);

// A response whose headers arrive but whose body cannot be read, as when the connection drops mid-body.
function unreadableBody(status, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => {
      throw new TypeError('terminated');
    },
  };
}

// A fake fetch that answers each call with the next queued response. An Error in the queue is thrown.
function fakeFetch(queue) {
  const calls = [];
  const pending = [...queue];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (pending.length === 0) throw new Error('unexpected extra request');
    const next = pending.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

// A fake sleep that records each requested delay and does not wait.
function fakeSleep() {
  const waits = [];
  return { sleep: async (ms) => { waits.push(ms); }, waits };
}

function client({ fetchImpl, sleep, loginProduct = 'instagram', onUsage } = {}) {
  return createGraphClient({ config: CONFIG, loginProduct, token: TOKEN, fetchImpl, sleep, onUsage });
}

test('GET builds the versioned URL on the instagram base with a Bearer header', async () => {
  const { fetchImpl, calls } = fakeFetch([ok({ id: '1' })]);
  const result = await client({ fetchImpl, sleep: fakeSleep().sleep }).get('me', { fields: 'id,username' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://graph.instagram.com/v26.0/me?fields=id%2Cusername');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].url.includes(TOKEN), false);
  assert.deepEqual(result, { data: { id: '1' }, usage: null });
});

test('facebook login uses graph.facebook.com', async () => {
  const { fetchImpl, calls } = fakeFetch([ok({ id: '2' })]);
  await client({ fetchImpl, sleep: fakeSleep().sleep, loginProduct: 'facebook' }).get('me/accounts');
  assert.equal(calls[0].url, 'https://graph.facebook.com/v26.0/me/accounts');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('429 on GET is retried after Retry-After seconds, then succeeds', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(429, { error: { message: 'slow down' } }, { 'retry-after': '2' }), ok({ id: '3' })]);
  const { sleep, waits } = fakeSleep();
  const result = await client({ fetchImpl, sleep }).get('me');
  assert.deepEqual(waits, [2000]);
  assert.equal(calls.length, 2);
  assert.deepEqual(result.data, { id: '3' });
});

test('POST is not retried by default', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(503, { error: { message: 'unavailable' } })]);
  const { sleep, waits } = fakeSleep();
  await assert.rejects(client({ fetchImpl, sleep }).post('123/media', { form: { caption: 'hi' } }), {
    name: 'IgError',
    kind: 'API_ERROR',
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test('error code 190 surfaces as AUTH_EXPIRED', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(400, { error: { code: 190, message: 'Session has expired' } })]);
  await assert.rejects(client({ fetchImpl, sleep: fakeSleep().sleep }).get('me'), {
    name: 'IgError',
    kind: 'AUTH_EXPIRED',
  });
  assert.equal(calls.length, 1);
});

test('usage header is parsed when present', async () => {
  const { fetchImpl } = fakeFetch([ok({ id: '4' }, { 'x-app-usage': APP_USAGE_HIGH, 'x-business-use-case-usage': BUSINESS_USAGE })]);
  const result = await client({ fetchImpl, sleep: fakeSleep().sleep }).get('me');
  assert.deepEqual(result.usage, {
    app: { call_count: 28, total_time: 90, total_cputime: 5 },
    business: { '17841400000000001': [{ type: 'instagram', call_count: 1 }] },
  });
});

test('usage is null when neither usage header is present', async () => {
  const { fetchImpl } = fakeFetch([ok({ id: '5' })]);
  const result = await client({ fetchImpl, sleep: fakeSleep().sleep }).get('me');
  assert.equal(result.usage, null);
});

test('POST with retryPost retries 503 with the default delays, and sends a form body', async () => {
  const { fetchImpl, calls } = fakeFetch([
    reply(503, { error: { message: 'unavailable' } }),
    reply(503, { error: { message: 'unavailable' } }),
    reply(503, { error: { message: 'unavailable' } }),
    ok({ id: 'media_1' }),
  ]);
  const { sleep, waits } = fakeSleep();
  const result = await client({ fetchImpl, sleep }).post('123/media', { form: { caption: 'hi' } }, { retryPost: true });
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.body, 'caption=hi');
    assert.equal(call.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  }
  assert.deepEqual(result.data, { id: 'media_1' });
});

test('a GET gives up after three retries, four calls in all', async () => {
  const { fetchImpl, calls } = fakeFetch([
    reply(500, { error: { message: 'boom' } }),
    reply(500, { error: { message: 'boom' } }),
    reply(500, { error: { message: 'boom' } }),
    reply(500, { error: { message: 'boom' } }),
  ]);
  const { sleep, waits } = fakeSleep();
  await assert.rejects(client({ fetchImpl, sleep }).get('me'), { name: 'IgError', kind: 'API_ERROR' });
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, [1000, 2000, 4000]);
});

test('GET retries 502, 503 and 504 as well as 500', async () => {
  for (const status of [502, 503, 504]) {
    const { fetchImpl, calls } = fakeFetch([reply(status, { error: { message: 'down' } }), ok({ id: 'x' })]);
    const { sleep, waits } = fakeSleep();
    const result = await client({ fetchImpl, sleep }).get('me');
    assert.equal(calls.length, 2, `status ${status}`);
    assert.deepEqual(waits, [1000], `status ${status}`);
    assert.deepEqual(result.data, { id: 'x' });
  }
});

test('a stop on a retryable status is not retried', async () => {
  const { fetchImpl, calls } = fakeFetch([
    reply(503, { error: { code: 190, message: 'Session has expired' } }),
    reply(500, { error: { message: 'Checkpoint required' } }),
  ]);
  const { sleep, waits } = fakeSleep();
  const api = client({ fetchImpl, sleep });
  await assert.rejects(api.get('me'), { name: 'IgError', kind: 'AUTH_EXPIRED' });
  await assert.rejects(api.get('me'), { name: 'IgError', kind: 'CHECKPOINT' });
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, []);
});

test('a status outside the retry list, such as 401, is not retried', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(401, { error: { message: 'unauthorized' } })]);
  const { sleep, waits } = fakeSleep();
  await assert.rejects(client({ fetchImpl, sleep }).get('me'), { name: 'IgError', kind: 'API_ERROR' });
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test('a Retry-After that is not a number of seconds is not retried', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(429, { error: { message: 'slow' } }, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' })]);
  const { sleep, waits } = fakeSleep();
  await assert.rejects(client({ fetchImpl, sleep }).get('me'), { name: 'IgError', kind: 'RATE_LIMITED' });
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test('a Retry-After of 60 seconds is retried', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(429, { error: { message: 'slow' } }, { 'retry-after': '60' }), ok({ id: '11' })]);
  const { sleep, waits } = fakeSleep();
  const result = await client({ fetchImpl, sleep }).get('me');
  assert.deepEqual(waits, [60000]);
  assert.equal(calls.length, 2);
  assert.deepEqual(result.data, { id: '11' });
});

test('a Retry-After over 60 seconds is not retried, and the call returns its error', async () => {
  for (const value of ['61', '2147483']) {
    const { fetchImpl, calls } = fakeFetch([reply(429, { error: { message: 'slow' } }, { 'retry-after': value })]);
    const { sleep, waits } = fakeSleep();
    await assert.rejects(client({ fetchImpl, sleep }).get('me'), { name: 'IgError', kind: 'RATE_LIMITED' }, value);
    assert.equal(calls.length, 1, value);
    assert.deepEqual(waits, [], value);
  }
});

test('DELETE is never retried, even on a 503', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(503, { error: { message: 'unavailable' } })]);
  const { sleep, waits } = fakeSleep();
  await assert.rejects(client({ fetchImpl, sleep }).del('17841400000000002'), { name: 'IgError', kind: 'API_ERROR' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'DELETE');
  assert.deepEqual(waits, []);
});

test('a 429 whose body is not JSON is RATE_LIMITED, and the text is not parsed as an error', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(429, 'Too Many Requests')]);
  await assert.rejects(client({ fetchImpl, sleep: fakeSleep().sleep }).post('123/media', {}), {
    name: 'IgError',
    kind: 'RATE_LIMITED',
  });
  assert.equal(calls.length, 1);
});

test('a non-OK body that is not JSON is API_ERROR', async () => {
  const { fetchImpl } = fakeFetch([reply(400, 'oops, not json')]);
  await assert.rejects(client({ fetchImpl, sleep: fakeSleep().sleep }).get('me'), { name: 'IgError', kind: 'API_ERROR' });
});

test('a 2xx body that is not JSON is API_ERROR', async () => {
  const { fetchImpl } = fakeFetch([reply(200, '<html>proxy</html>')]);
  await assert.rejects(client({ fetchImpl, sleep: fakeSleep().sleep }).get('me'), { name: 'IgError', kind: 'API_ERROR' });
});

test('a 2xx body with an error member throws the mapped error', async () => {
  const { fetchImpl } = fakeFetch([ok({ error: { code: 368, message: 'Action blocked' } })]);
  await assert.rejects(client({ fetchImpl, sleep: fakeSleep().sleep }).post('1/comments', { form: { message: 'x' } }), {
    name: 'IgError',
    kind: 'ACTION_BLOCKED',
  });
});

test('a network failure on GET is API_ERROR and is not retried', async () => {
  const { fetchImpl, calls } = fakeFetch([new TypeError('fetch failed')]);
  const { sleep, waits } = fakeSleep();
  await assert.rejects(client({ fetchImpl, sleep }).get('me'), { name: 'IgError', kind: 'API_ERROR' });
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test('every request has a 15 second timeout signal and refuses redirects', async () => {
  const original = AbortSignal.timeout;
  const timeouts = [];
  AbortSignal.timeout = (ms) => {
    timeouts.push(ms);
    return original.call(AbortSignal, ms);
  };
  try {
    const { fetchImpl, calls } = fakeFetch([ok({ id: '6' })]);
    await client({ fetchImpl, sleep: fakeSleep().sleep }).get('me');
    assert.deepEqual(timeouts, [15000]);
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.equal(calls[0].init.redirect, 'error');
  } finally {
    AbortSignal.timeout = original;
  }
});

test('onUsage is called after every response, with that response usage or null', async () => {
  const seen = [];
  const { fetchImpl } = fakeFetch([
    reply(429, { error: { code: 4, message: 'limit reached' } }, { 'retry-after': '1', 'x-app-usage': APP_USAGE_HIGH }),
    ok({ id: '7' }),
  ]);
  const { sleep, waits } = fakeSleep();
  const result = await client({ fetchImpl, sleep, onUsage: (usage) => seen.push(usage) }).get('me');
  assert.deepEqual(waits, [1000]);
  assert.deepEqual(seen, [{ app: { call_count: 28, total_time: 90, total_cputime: 5 }, business: null }, null]);
  assert.equal(result.usage, null);
});

test('onUsage is called before an error is thrown', async () => {
  const seen = [];
  const { fetchImpl } = fakeFetch([reply(429, { error: { message: 'slow' } }, { 'x-app-usage': APP_USAGE_HIGH })]);
  await assert.rejects(
    client({ fetchImpl, sleep: fakeSleep().sleep, onUsage: (usage) => seen.push(usage) }).post('123/media', {}),
    { name: 'IgError', kind: 'RATE_LIMITED' },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].app.total_time, 90);
});

test('onUsage is called once for a malformed usage header, with the unreadable marker', async () => {
  const seen = [];
  const { fetchImpl } = fakeFetch([
    ok({ id: '8' }, { 'x-app-usage': 'not json' }),
    ok({ id: '9' }, { 'x-business-use-case-usage': '[1, 2]' }),
  ]);
  const api = client({ fetchImpl, sleep: fakeSleep().sleep, onUsage: (usage) => seen.push(usage) });
  await api.get('me');
  assert.deepEqual(seen, [{ app: null, business: null, unreadable: 'x-app-usage' }]);
  await api.get('me');
  assert.deepEqual(seen, [
    { app: null, business: null, unreadable: 'x-app-usage' },
    { app: null, business: null, unreadable: 'x-business-use-case-usage' },
  ]);
});

test('a 2xx response with a malformed usage header returns its data with usage null, and does not throw', async () => {
  const { fetchImpl, calls } = fakeFetch([ok({ id: '8' }, { 'x-app-usage': 'not json' })]);
  const result = await client({ fetchImpl, sleep: fakeSleep().sleep }).post('1/comments', { form: { message: 'hi' } });
  assert.deepEqual(result, { data: { id: '8' }, usage: null });
  assert.equal(calls.length, 1);
});

test('a body that cannot be read still sends its usage to onUsage, then fails with API_ERROR', async () => {
  const seen = [];
  const { fetchImpl, calls } = fakeFetch([unreadableBody(200, { 'x-app-usage': APP_USAGE_HIGH })]);
  const api = client({ fetchImpl, sleep: fakeSleep().sleep, onUsage: (usage) => seen.push(usage) });
  await assert.rejects(api.get('me'), { name: 'IgError', kind: 'API_ERROR' });
  assert.deepEqual(seen, [{ app: { call_count: 28, total_time: 90, total_cputime: 5 }, business: null }]);
  assert.equal(calls.length, 1);
});

test('an empty 2xx body is success with data null, such as a 204 from DELETE', async () => {
  const { fetchImpl, calls } = fakeFetch([new Response(null, { status: 204 }), new Response('', { status: 200 })]);
  const api = client({ fetchImpl, sleep: fakeSleep().sleep });
  assert.deepEqual(await api.del('17841400000000002'), { data: null, usage: null });
  assert.deepEqual(await api.get('me'), { data: null, usage: null });
  assert.equal(calls[0].init.method, 'DELETE');
});

test('a token in a query or form field is refused with CONFIG before any request', async () => {
  const { fetchImpl, calls } = fakeFetch([]);
  const api = client({ fetchImpl, sleep: fakeSleep().sleep });
  await assert.rejects(api.get('me', { access_token: TOKEN }), { name: 'IgError', kind: 'CONFIG' });
  await assert.rejects(api.get('me', { Access_Token: TOKEN }), { name: 'IgError', kind: 'CONFIG' });
  await assert.rejects(api.post('1/messages', { form: { ACCESS_TOKEN: TOKEN } }), { name: 'IgError', kind: 'CONFIG' });
  assert.equal(calls.length, 0);
});

test('a non-OK response with an OK-looking body is an error, not success', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(500, { data: [] }), reply(429, { data: [] })]);
  const api = client({ fetchImpl, sleep: fakeSleep().sleep });
  await assert.rejects(api.post('1/media', { form: {} }), { name: 'IgError', kind: 'API_ERROR' });
  await assert.rejects(api.post('1/media', { form: {} }), { name: 'IgError', kind: 'RATE_LIMITED' });
  assert.equal(calls.length, 2);
});

test('a path or query that is not simple is refused before any request', async () => {
  const { fetchImpl, calls } = fakeFetch([]);
  const api = client({ fetchImpl, sleep: fakeSleep().sleep });
  await assert.rejects(api.get('me?fields=id'), { name: 'IgError', kind: 'VALIDATION' });
  await assert.rejects(api.get('../me'), { name: 'IgError', kind: 'VALIDATION' });
  await assert.rejects(api.get('https://evil.example/me'), { name: 'IgError', kind: 'VALIDATION' });
  await assert.rejects(api.get('me', { fields: null }), { name: 'IgError', kind: 'VALIDATION' });
  await assert.rejects(api.get('me', { fields: { a: 1 } }), { name: 'IgError', kind: 'VALIDATION' });
  assert.equal(calls.length, 0);
});

test('a POST sends a JSON body or a form body, and refuses both', async () => {
  const { fetchImpl, calls } = fakeFetch([ok({ id: '9' }), ok({ id: '10' })]);
  const api = client({ fetchImpl, sleep: fakeSleep().sleep });
  await api.post('1/messages', { json: { recipient: { id: '42' } } });
  await api.post('1/messages', { form: { a: '1', b: 'two' } });
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { recipient: { id: '42' } });
  assert.equal(calls[1].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(calls[1].init.body, 'a=1&b=two');
  await assert.rejects(api.post('1/messages', { form: { a: '1' }, json: { a: 1 } }), {
    name: 'IgError',
    kind: 'VALIDATION',
  });
  assert.equal(calls.length, 2);
});

test('createGraphClient refuses bad configuration', () => {
  const fetchImpl = async () => ok({});
  const sleep = fakeSleep().sleep;
  const bad = [
    { config: CONFIG, loginProduct: 'instagram', token: '', fetchImpl, sleep },
    { config: CONFIG, loginProduct: 'instagram', token: 'has space', fetchImpl, sleep },
    { config: CONFIG, loginProduct: 'twitter', token: TOKEN, fetchImpl, sleep },
    {
      config: { graph: { ...CONFIG.graph, version: 'latest' } },
      loginProduct: 'instagram',
      token: TOKEN,
      fetchImpl,
      sleep,
    },
    {
      config: { graph: { ...CONFIG.graph, instagramBase: 'http://graph.instagram.com' } },
      loginProduct: 'instagram',
      token: TOKEN,
      fetchImpl,
      sleep,
    },
    {
      config: { graph: { ...CONFIG.graph, facebookBase: 'https://graph.facebook.com/' } },
      loginProduct: 'facebook',
      token: TOKEN,
      fetchImpl,
      sleep,
    },
  ];
  for (const options of bad) {
    assert.throws(() => createGraphClient(options), { name: 'IgError', kind: 'CONFIG' });
  }
});

// F-12 (Task 5 m-3). A throwing onUsage does not turn a response that Graph accepted into an error. The result is returned,
// the write is sent once, and one warning is emitted that carries no text from the error.
test('a throwing onUsage does not turn an accepted write into an error (F-12)', async () => {
  const { fetchImpl, calls } = fakeFetch([ok({ id: '123' })]);
  const warnings = [];
  const original = process.emitWarning;
  process.emitWarning = (text) => {
    warnings.push(String(text));
  };
  try {
    const api = client({
      fetchImpl,
      sleep: fakeSleep().sleep,
      onUsage: () => {
        throw new Error('the callback failed with a token-like text');
      },
    });
    const result = await api.post('123/media', { json: { caption: 'x' } });
    assert.deepEqual(result.data, { id: '123' });
  } finally {
    process.emitWarning = original;
  }
  assert.equal(calls.length, 1, 'the write is sent once');
  assert.equal(warnings.length, 1, 'one warning is emitted');
  assert.equal(warnings[0].includes('token-like'), false, 'the warning carries no error text');
});

// ---------- P2 (2026-10-22) ----------

// A fetch failure as Node reports it: a TypeError whose cause carries a code.
function fetchFailure(code) {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
}

test('O-5 a connection refused or a DNS failure is a pre-send failure, and a timeout or a reset is not', async () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
    const { fetchImpl } = fakeFetch([fetchFailure(code)]);
    await assert.rejects(client({ fetchImpl, sleep: fakeSleep().sleep }).get('me'), (err) => {
      assert.equal(err.kind, 'API_ERROR');
      assert.equal(err.details.preSend, true, `${code} is before any request`);
      return true;
    });
  }
  // Several addresses: each attempt is listed in an AggregateError, and every code must be a pre-send code.
  const several = Object.assign(new TypeError('fetch failed'), {
    cause: new AggregateError([Object.assign(new Error('a'), { code: 'ECONNREFUSED' })], 'connect failed'),
  });
  const { fetchImpl: severalFetch } = fakeFetch([several]);
  await assert.rejects(client({ fetchImpl: severalFetch, sleep: fakeSleep().sleep }).get('me'), (err) => err.details.preSend === true);
  // A timeout: the request may have reached Graph, so it is not pre-send.
  const { fetchImpl: timeoutFetch } = fakeFetch([new DOMException('The operation timed out.', 'TimeoutError')]);
  await assert.rejects(client({ fetchImpl: timeoutFetch, sleep: fakeSleep().sleep }).get('me'), (err) => {
    assert.equal(err.details.preSend, false, 'a timeout is not pre-send');
    return true;
  });
  // A connection reset in the middle of a request: not pre-send.
  const { fetchImpl: resetFetch } = fakeFetch([fetchFailure('ECONNRESET')]);
  await assert.rejects(client({ fetchImpl: resetFetch, sleep: fakeSleep().sleep }).get('me'), (err) => err.details.preSend === false);
});

test('O-5 every failure that comes back as a response is marked not pre-send', async () => {
  const { fetchImpl } = fakeFetch([reply(400, { error: { code: 100, message: 'bad' } })]);
  await assert.rejects(client({ fetchImpl, sleep: fakeSleep().sleep }).get('me'), (err) => {
    assert.equal(err.details.preSend, false);
    return true;
  });
});

// A stream of 6 MB, in 1 MB chunks, that counts how many chunks were pulled.
function bigStream(megabytes) {
  const chunk = new Uint8Array(1024 * 1024);
  const state = { pulled: 0 };
  const stream = new ReadableStream({
    pull(controller) {
      if (state.pulled >= megabytes) {
        controller.close();
        return;
      }
      state.pulled += 1;
      controller.enqueue(chunk);
    },
  }, { highWaterMark: 0 });
  return { stream, state };
}

test('A-10 a response body over 5 MB is an API_ERROR, and the rest of the body is not read', async () => {
  const { stream, state } = bigStream(20);
  const { fetchImpl } = fakeFetch([new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })]);
  await assert.rejects(client({ fetchImpl, sleep: fakeSleep().sleep }).get('me'), (err) => {
    assert.equal(err.kind, 'API_ERROR');
    assert.match(err.message, /larger than/);
    return true;
  });
  // Five 1 MB chunks fit the cap exactly, and the sixth passes it, so the stream is cut off after six chunks. Without the
  // cancel, all twenty would be read.
  assert.equal(state.pulled, 6, 'the body was cut off after the sixth chunk, the first that passes the cap');
});

test('A-10 a body whose declared length is over 5 MB is refused before any of it is read', async () => {
  const { stream, state } = bigStream(6);
  const headers = { 'content-type': 'application/json', 'content-length': String(6 * 1024 * 1024) };
  const { fetchImpl } = fakeFetch([new Response(stream, { status: 200, headers })]);
  await assert.rejects(client({ fetchImpl, sleep: fakeSleep().sleep }).get('me'), { kind: 'API_ERROR' });
  assert.equal(state.pulled, 0, 'nothing was read');
});

test('A-10 an over-size body on a write is an API_ERROR, and the write is not retried', async () => {
  const { stream } = bigStream(6);
  const { fetchImpl, calls } = fakeFetch([new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })]);
  await assert.rejects(client({ fetchImpl, sleep: fakeSleep().sleep }).post('17900000000000001/likes', { form: {} }), {
    kind: 'API_ERROR',
  });
  assert.equal(calls.length, 1, 'the write was sent once');
});

test('A-18 a path part made only of dots is refused locally with VALIDATION, and no request is made', async () => {
  const { fetchImpl, calls } = fakeFetch([]);
  const c = client({ fetchImpl, sleep: fakeSleep().sleep });
  for (const path of ['.', '..', '...', 'me/..']) {
    await assert.rejects(c.get(path), { kind: 'VALIDATION' }, `path ${path}`);
  }
  assert.equal(calls.length, 0);
});

// ---------- P2 fix round (2026-10-22) ----------

test('P2-M7 a GET marked noRetry gets one request on a 503, and the error is reported', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(503, { error: { message: 'down' } }), ok({})]);
  const { sleep, waits } = fakeSleep();
  await assert.rejects(client({ fetchImpl, sleep }).get('me', undefined, { noRetry: true }), { kind: 'API_ERROR' });
  assert.equal(calls.length, 1, 'one request was made');
  assert.deepEqual(waits, [], 'no backoff was taken');
});

test('P2-M7 a GET without noRetry is still retried on a 503', async () => {
  const { fetchImpl, calls } = fakeFetch([reply(503, { error: { message: 'down' } }), ok({ id: '1' })]);
  const { sleep, waits } = fakeSleep();
  assert.deepEqual((await client({ fetchImpl, sleep }).get('me')).data, { id: '1' });
  assert.equal(calls.length, 2, 'the read was retried once');
  assert.equal(waits.length, 1, 'with one backoff');
});

// ---------- A-11 (2026-10-23): Retry-After of 0, a 2xx body with error null, and DELETE ----------

const OWNER_ID = '17841400000000001';
const MEDIA_ID = '17900000000000001';
const COMMENT_ID = '17870913679156914';

test('a Retry-After of 0 is retried at once: the wait is 0 ms, not the backoff, on a 429 and on a 503', async () => {
  for (const status of [429, 503]) {
    const { fetchImpl, calls } = fakeFetch([
      reply(status, { error: { message: 'busy' } }, { 'retry-after': '0' }),
      ok({ id: '9' }),
    ]);
    const { sleep, waits } = fakeSleep();
    const result = await client({ fetchImpl, sleep }).get('me');
    assert.deepEqual(waits, [0], `the wait for status ${status}`);
    assert.equal(calls.length, 2, `the calls for status ${status}`);
    assert.deepEqual(result.data, { id: '9' });
  }
});

test('a 2xx body of {"error": null} is success for a read, and the client returns a write without judging it', async () => {
  const { fetchImpl, calls } = fakeFetch([ok({ error: null }), ok({ error: null })]);
  const { sleep, waits } = fakeSleep();
  const api = client({ fetchImpl, sleep });
  assert.deepEqual(await api.get('me'), { data: { error: null }, usage: null });
  assert.deepEqual(await api.post(`${OWNER_ID}/media`, { form: { caption: 'x' } }), { data: { error: null }, usage: null });
  assert.equal(calls.length, 2, 'neither response is retried');
  assert.deepEqual(waits, []);
});

test('a write that answers 2xx {"error": null} is refused by its endpoint as API_ERROR, and is sent once', async () => {
  const { fetchImpl, calls } = fakeFetch([ok({ error: null })]);
  await assert.rejects(
    like(client({ fetchImpl, sleep: fakeSleep().sleep }), { igUserId: OWNER_ID, targetId: MEDIA_ID, kind: 'media' }),
    (err) => err.name === 'IgError' && err.kind === 'API_ERROR' && /did not confirm/.test(err.message),
  );
  assert.equal(calls.length, 1, 'a write that is not confirmed is not repeated');
  assert.equal(calls[0].init.method, 'POST');
});

test('a DELETE sends its query fields and the id in the path, with the Bearer header and no body', async () => {
  const { fetchImpl, calls } = fakeFetch([ok({ success: true })]);
  await client({ fetchImpl, sleep: fakeSleep().sleep }).del(`${OWNER_ID}/likes`, { media_id: MEDIA_ID, fields: 'id' });
  assert.equal(calls[0].url, `https://graph.instagram.com/v26.0/${OWNER_ID}/likes?media_id=${MEDIA_ID}&fields=id`);
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].url.includes(TOKEN), false);
});

test('unlike sends the target field and the owner id as a DELETE through the real client', async () => {
  const { fetchImpl, calls } = fakeFetch([ok({ success: true })]);
  const result = await unlike(client({ fetchImpl, sleep: fakeSleep().sleep }), {
    igUserId: OWNER_ID,
    targetId: COMMENT_ID,
    kind: 'comment',
  });
  assert.deepEqual(result, { targetId: COMMENT_ID, kind: 'comment', liked: false });
  assert.equal(calls[0].url, `https://graph.instagram.com/v26.0/${OWNER_ID}/likes?comment_id=${COMMENT_ID}`);
  assert.equal(calls[0].init.method, 'DELETE');
});

test('mediaDelete sends DELETE to the media id on graph.facebook.com, and reports the deletion', async () => {
  const { fetchImpl, calls } = fakeFetch([ok({ success: true })]);
  const api = client({ fetchImpl, sleep: fakeSleep().sleep, loginProduct: 'facebook' });
  assert.deepEqual(await mediaDelete(api, { mediaId: MEDIA_ID }), { id: MEDIA_ID, deleted: true });
  assert.equal(calls[0].url, `https://graph.facebook.com/v26.0/${MEDIA_ID}`);
  assert.equal(calls[0].init.method, 'DELETE');
});

test('a DELETE with a null query, and an endpoint given a null options argument, are VALIDATION with no request', async () => {
  const { fetchImpl, calls } = fakeFetch([]);
  const api = client({ fetchImpl, sleep: fakeSleep().sleep, loginProduct: 'facebook' });
  await assert.rejects(api.del(`${OWNER_ID}/likes`, null), { name: 'IgError', kind: 'VALIDATION' });
  await assert.rejects(mediaDelete(api, null), { name: 'IgError', kind: 'VALIDATION' });
  await assert.rejects(unlike(api, null), { name: 'IgError', kind: 'VALIDATION' });
  assert.equal(calls.length, 0, 'no request is made');
});
