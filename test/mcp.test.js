import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForward, createMcpServer, FLUSH_LIMIT_MS, startStdio } from '../src/mcp.js';
import { IgError } from '../src/errors.js';
import { registerSecret } from '../src/redact.js';
import { TOOLS } from '../src/tools.js';

const API_TOKEN = 'mcp-api-token-for-tests-0123456789';
const PORT = 8788;
const TIMEOUT_MS = 2000;
const PROTOCOL_VERSION = '2026-07-28';

// A forward that records each call and answers with respond(name, args). It makes no request.
function fakeForward(respond) {
  const calls = [];
  const forward = async (name, args) => {
    calls.push({ name, args });
    return respond(name, args);
  };
  forward.calls = calls;
  return forward;
}

// A fetch that refuses the connection, as fetch does when nothing listens on the port. It opens no socket.
function refusingFetch() {
  const cause = Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:${PORT}`), { code: 'ECONNREFUSED' });
  return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause }));
}

// An in-memory transport. The server writes its messages to send, and the test delivers requests to onmessage. No
// stream, socket or process is involved.
class FakeTransport {
  constructor() {
    this.started = false;
    this.closed = false;
    this.waiting = new Map();
    this.onmessage = undefined;
    this.onclose = undefined;
    this.onerror = undefined;
  }

  async start() {
    this.started = true;
  }

  async send(message) {
    const resolve = message.id === undefined ? undefined : this.waiting.get(message.id);
    if (resolve) {
      this.waiting.delete(message.id);
      resolve(message);
    }
  }

  async close() {
    this.closed = true;
    this.onclose?.();
  }
}

// Connects a server to a fake transport and initializes it. request(method, params) resolves with the JSON-RPC reply.
async function clientFor(server) {
  const transport = new FakeTransport();
  await server.connect(transport);
  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => reject(new Error(`no reply to ${method}`)), TIMEOUT_MS);
      timer.unref();
      transport.waiting.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      transport.onmessage({ jsonrpc: '2.0', id, method, params });
    });
  const initialized = await request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'mcp-test', version: '0.0.0' },
  });
  assert.equal(initialized.error, undefined, 'initialize succeeds');
  return { request, transport };
}

// The text of the one content item of a tool result.
function textOf(reply) {
  assert.equal(reply.error, undefined, 'the request succeeds');
  assert.equal(reply.result.content.length, 1, 'the result has one content item');
  assert.equal(reply.result.content[0].type, 'text');
  return reply.result.content[0].text;
}

test('createMcpServer registers every tool with its annotations', async () => {
  const server = createMcpServer({ forward: fakeForward(async () => ({ result: null })) });
  const client = await clientFor(server);
  const reply = await client.request('tools/list', {});
  assert.equal(reply.error, undefined);
  const listed = reply.result.tools;
  assert.equal(listed.length, TOOLS.length);
  for (const tool of TOOLS) {
    const found = listed.find((item) => item.name === tool.name);
    assert.ok(found, `${tool.name} is listed`);
    assert.equal(found.description, tool.description);
    assert.deepEqual(found.annotations, tool.annotations, `${tool.name} has its annotations`);
    assert.deepEqual(found.inputSchema, tool.inputSchema, `${tool.name} has its input schema`);
  }
  await server.close();
});

test('a busy body comes back as a normal result', async () => {
  const busy = { busy: true, reason: 'the spacing cap is in force', retryAfterMs: 1500 };
  const forward = fakeForward(async () => busy);
  const server = createMcpServer({ forward });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_status', arguments: {} });
  assert.notEqual(reply.result.isError, true, 'a busy result is not an error');
  assert.deepEqual(JSON.parse(textOf(reply)), busy);
  assert.deepEqual(forward.calls, [{ name: 'ig_status', args: {} }]);
  await server.close();
});

test('an error body comes back with isError true and no secret text', async () => {
  const secret = 'mcp-test-secret-0123456789';
  registerSecret(secret);
  const forward = fakeForward(async () => ({
    error: { kind: 'STOPPED', message: `outbound actions are stopped; detail ${secret}` },
  }));
  const server = createMcpServer({ forward });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_comment_reply', arguments: { commentId: '17', text: 'hi', confirm: true } });
  assert.equal(reply.result.isError, true);
  const text = textOf(reply);
  assert.ok(!text.includes(secret), 'the secret is not in the text');
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error), ['kind', 'message']);
  assert.equal(body.error.kind, 'STOPPED');
  await server.close();
});

test('an unreachable service gives an API_ERROR result that says ig serve is not running', async () => {
  let fetchCalls = 0;
  const fetch = () => {
    fetchCalls += 1;
    return refusingFetch();
  };
  const forward = createForward({ port: PORT, apiToken: API_TOKEN, fetch });
  const server = createMcpServer({ forward });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_status', arguments: {} });
  assert.equal(reply.result.isError, true);
  const body = JSON.parse(textOf(reply));
  assert.equal(body.error.kind, 'API_ERROR');
  assert.match(body.error.message, /ig serve is not running/);
  assert.ok(!body.error.message.includes(API_TOKEN), 'the token is not in the message');
  assert.ok(!body.error.message.includes('127.0.0.1'), 'the URL is not in the message');
  assert.equal(fetchCalls, 1);
  await server.close();
});

test('a call with arguments that fail validation is refused before any request', async () => {
  const forward = fakeForward(async () => ({ result: null }));
  const server = createMcpServer({ forward });
  const client = await clientFor(server);

  const wrongType = await client.request('tools/call', { name: 'ig_media_get', arguments: { mediaId: 12345 } });
  assert.equal(wrongType.result.isError, true);
  assert.equal(JSON.parse(textOf(wrongType)).error.kind, 'VALIDATION');

  const missing = await client.request('tools/call', { name: 'ig_media_get', arguments: {} });
  assert.equal(missing.result.isError, true);
  assert.equal(JSON.parse(textOf(missing)).error.kind, 'VALIDATION');

  assert.deepEqual(forward.calls, [], 'no call reached forward');
  await server.close();
});

test('a successful body comes back as its result', async () => {
  const forward = fakeForward(async () => ({ result: { id: '17853' } }));
  const server = createMcpServer({ forward });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_media_get', arguments: { mediaId: '17853' } });
  assert.notEqual(reply.result.isError, true);
  assert.deepEqual(JSON.parse(textOf(reply)), { id: '17853' });
  assert.deepEqual(forward.calls, [{ name: 'ig_media_get', args: { mediaId: '17853' } }]);
  await server.close();
});

test('createForward posts to the loopback tools route with the bearer token and returns the parsed body', async () => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ result: { ok: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  };
  const forward = createForward({ port: PORT, apiToken: API_TOKEN, fetch });
  const body = await forward('ig_media_get', { mediaId: '17853' });
  assert.deepEqual(body, { result: { ok: true } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `http://127.0.0.1:${PORT}/tools/ig_media_get`);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${API_TOKEN}`);
  assert.deepEqual(JSON.parse(requests[0].init.body), { mediaId: '17853' });
});

test('a body that is not JSON is an API_ERROR, not a success', async () => {
  const fetch = async () => new Response('<html>a proxy page</html>', { status: 200 });
  const forward = createForward({ port: PORT, apiToken: API_TOKEN, fetch });
  await assert.rejects(forward('ig_status', {}), (error) => error instanceof IgError && error.kind === 'API_ERROR');

  const server = createMcpServer({ forward });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_status', arguments: {} });
  assert.equal(reply.result.isError, true);
  assert.equal(JSON.parse(textOf(reply)).error.kind, 'API_ERROR');
  await server.close();
});

test('a JSON body with no result, error or busy field is an API_ERROR, not a success', async () => {
  const fetch = async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 });
  const forward = createForward({ port: PORT, apiToken: API_TOKEN, fetch });
  await assert.rejects(forward('ig_status', {}), (error) => error instanceof IgError && error.kind === 'API_ERROR');
});

test('createForward refuses a blank api token', () => {
  assert.throws(
    () => createForward({ port: PORT, apiToken: '   ', fetch: refusingFetch }),
    (error) => error instanceof IgError && error.kind === 'CONFIG',
  );
});

// A fetch that never answers. It records each call, and it rejects with an AbortError when the signal it was given fires,
// as fetch does on a timeout. It opens no socket.
function neverAnswers() {
  const calls = [];
  const fetch = (url, init) => {
    calls.push({ url, init });
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
      });
    });
  };
  fetch.calls = calls;
  return fetch;
}

// Holds the event loop open for the length of a test that waits on a timeout. The production timeout is AbortSignal.timeout,
// and its timer does not keep Node alive. On Node 22 the process then exits with the test still pending, and node:test
// cancels it. This timer is referenced, and it is cleared in finally, so it never outlives the test.
const HOLD_MS = 5000;
async function holdLoop(run) {
  const hold = setTimeout(() => {}, HOLD_MS);
  try {
    return await run();
  } finally {
    clearTimeout(hold);
  }
}

test('a write that times out is an API_ERROR that says a write may have run', () =>
  holdLoop(async () => {
    const fetch = neverAnswers();
    const forward = createForward({ port: PORT, apiToken: API_TOKEN, fetch, timeoutMs: 20 });
    await assert.rejects(
      forward('ig_comment_reply', { commentId: '17', text: 'hi', confirm: true }),
      (error) =>
        error instanceof IgError &&
        error.kind === 'API_ERROR' &&
        error.message === 'ig serve did not answer in time; a write may have run, so check the status before you retry',
    );
    assert.equal(fetch.calls.length, 1, 'one request was started');
    assert.ok(fetch.calls[0].init.signal instanceof AbortSignal, 'the request carries the timeout signal');
  }));

test('a read that times out is an API_ERROR that says ig serve did not answer in time', () =>
  holdLoop(async () => {
    const forward = createForward({ port: PORT, apiToken: API_TOKEN, fetch: neverAnswers(), timeoutMs: 20 });
    await assert.rejects(
      forward('ig_status', {}),
      (error) => error instanceof IgError && error.kind === 'API_ERROR' && error.message === 'ig serve did not answer in time',
    );
  }));

test('a body that does not finish before the timeout is cut off the same way', () =>
  holdLoop(async () => {
    const fetch = async (url, init) => ({
      status: 200,
      text: () =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }));
          });
        }),
    });
    const forward = createForward({ port: PORT, apiToken: API_TOKEN, fetch, timeoutMs: 20 });
    await assert.rejects(
      forward('ig_status', {}),
      (error) => error instanceof IgError && error.kind === 'API_ERROR' && error.message === 'ig serve did not answer in time',
    );
  }));

test('createForward refuses a timeout that is not a whole number of milliseconds in range', () => {
  for (const timeoutMs of [0, -1, 1.5, 2147483648, '100']) {
    assert.throws(
      () => createForward({ port: PORT, apiToken: API_TOKEN, fetch: refusingFetch, timeoutMs }),
      (error) => error instanceof IgError && error.kind === 'CONFIG',
    );
  }
  assert.doesNotThrow(() => createForward({ port: PORT, apiToken: API_TOKEN, fetch: refusingFetch, timeoutMs: 2147483647 }));
});

test('a 500 response whose body has a result is isError, never a success', async () => {
  const fetch = async () => new Response(JSON.stringify({ result: {} }), { status: 500 });
  const forward = createForward({ port: PORT, apiToken: API_TOKEN, fetch });
  await assert.rejects(forward('ig_status', {}), (error) => error instanceof IgError && error.kind === 'API_ERROR');

  const server = createMcpServer({ forward });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_status', arguments: {} });
  assert.equal(reply.result.isError, true);
  assert.equal(JSON.parse(textOf(reply)).error.kind, 'API_ERROR');
  await server.close();
});

test('a 429 busy response from the HTTP API comes back as a normal busy result', async () => {
  const busy = { busy: true, reason: 'the spacing cap is in force', retryAfterMs: 2000 };
  const fetch = async () => new Response(JSON.stringify(busy), { status: 429 });
  const server = createMcpServer({ forward: createForward({ port: PORT, apiToken: API_TOKEN, fetch }) });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_status', arguments: {} });
  assert.notEqual(reply.result.isError, true, 'a busy result is not an error');
  assert.deepEqual(JSON.parse(textOf(reply)), busy);
  await server.close();
});

test('a 429 whose body is an error object is isError with its kind, not a busy result', async () => {
  const error = { kind: 'CAP_EXCEEDED', message: 'the daily cap is reached' };
  const fetch = async () => new Response(JSON.stringify({ error }), { status: 429 });
  const server = createMcpServer({ forward: createForward({ port: PORT, apiToken: API_TOKEN, fetch }) });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_status', arguments: {} });
  assert.equal(reply.result.isError, true);
  const body = JSON.parse(textOf(reply));
  assert.deepEqual(body, { error });
  assert.equal(body.busy, undefined, 'the result is not the busy body');
  await server.close();
});

test('a 429 that is neither busy nor an error is an API_ERROR, not a success', async () => {
  const fetch = async () => new Response(JSON.stringify({ result: {} }), { status: 429 });
  const forward = createForward({ port: PORT, apiToken: API_TOKEN, fetch });
  await assert.rejects(forward('ig_status', {}), (error) => error instanceof IgError && error.kind === 'API_ERROR');

  const server = createMcpServer({ forward });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_status', arguments: {} });
  assert.equal(reply.result.isError, true);
  assert.equal(JSON.parse(textOf(reply)).error.kind, 'API_ERROR');
  await server.close();
});

test('a response with no numeric status is an API_ERROR, never a success', async () => {
  for (const status of [undefined, NaN]) {
    const fetch = async () => ({ status, text: async () => JSON.stringify({ result: {} }) });
    const forward = createForward({ port: PORT, apiToken: API_TOKEN, fetch });
    await assert.rejects(
      forward('ig_status', {}),
      (error) => error instanceof IgError && error.kind === 'API_ERROR',
      `a status of ${status} is refused`,
    );
  }
});

test('a 409 error body from the HTTP API comes back as isError with its kind', async () => {
  const error = { kind: 'STOPPED', message: 'outbound actions are stopped' };
  const fetch = async () => new Response(JSON.stringify({ error }), { status: 409 });
  const server = createMcpServer({ forward: createForward({ port: PORT, apiToken: API_TOKEN, fetch }) });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_status', arguments: {} });
  assert.equal(reply.result.isError, true);
  assert.deepEqual(JSON.parse(textOf(reply)), { error });
  await server.close();
});

test('an unexpected error inside forward is INTERNAL with a fixed text and no secret', async () => {
  const secret = 'mcp-internal-secret-0123456789';
  registerSecret(secret);
  const forward = async () => {
    throw new Error(`socket setup failed with ${secret}`);
  };
  const server = createMcpServer({ forward });
  const client = await clientFor(server);
  const reply = await client.request('tools/call', { name: 'ig_status', arguments: {} });
  assert.equal(reply.result.isError, true);
  const text = textOf(reply);
  assert.ok(!text.includes(secret), 'the secret is not in the text');
  const body = JSON.parse(text);
  assert.equal(body.error.kind, 'INTERNAL');
  assert.equal(body.error.message, 'the tool call failed');
  await server.close();
});

test('startStdio connects the transport it is given', async () => {
  const transport = new FakeTransport();
  const stand = stdioStandIns();
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport,
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
  });
  assert.equal(transport.started, true);
  // Nothing closes the transport in this test, so no exit and no stderr line happen.
  assert.deepEqual(stand.exits, []);
  assert.deepEqual(stand.lines, []);
});

test('a 423 stop body comes back as isError with its kind unchanged, for each stop kind', async () => {
  for (const kind of ['AUTH_EXPIRED', 'CHECKPOINT', 'ACTION_BLOCKED', 'RATE_LIMITED']) {
    const error = { kind, message: `stopped as ${kind}` };
    const fetch = async () => new Response(JSON.stringify({ error }), { status: 423 });
    const server = createMcpServer({ forward: createForward({ port: PORT, apiToken: API_TOKEN, fetch }) });
    const client = await clientFor(server);
    const reply = await client.request('tools/call', { name: 'ig_status', arguments: {} });
    assert.equal(reply.result.isError, true, kind);
    assert.deepEqual(JSON.parse(textOf(reply)), { error }, kind);
    await server.close();
  }
});

// Stand-ins for the stderr stream, the stdout stream and the exit. Nothing reaches a real stream, and no process ends.
// With flush 'now', a stdout write calls back at once. With flush 'held', each callback is kept in pending, for the test to
// release.
function stdioStandIns({ flush = 'now' } = {}) {
  const lines = [];
  const exits = [];
  const pending = [];
  return {
    lines,
    exits,
    pending,
    stderr: {
      write: (text) => {
        lines.push(text);
        return true;
      },
    },
    stdout: {
      write: (chunk, callback) => {
        if (flush === 'now') callback?.();
        else pending.push(callback);
        return true;
      },
    },
    exit: (code) => {
      exits.push(code);
    },
  };
}

// A transport whose start fails, as a stdin that cannot be read would.
class FailingStartTransport extends FakeTransport {
  async start() {
    throw Object.assign(new Error('stdin is not readable at /dev/stdin with mcp-start-value-0123456789'), {
      name: 'ENODEV',
    });
  }
}

test('a transport error writes one stderr line with the error name only, and exits non-zero', async () => {
  const transport = new FakeTransport();
  const stand = stdioStandIns();
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport,
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
  });
  const error = Object.assign(new Error('write failed at /private/path with mcp-stdio-value-0123456789'), { name: 'EPIPE' });
  transport.onerror(error);
  assert.deepEqual(stand.lines, ['ig mcp: transport error: EPIPE\n']);
  assert.deepEqual(stand.exits, [1]);
});

test('a transport error exits only after stdout has flushed the frames already written', async () => {
  const transport = new FakeTransport();
  const stand = stdioStandIns({ flush: 'held' });
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport,
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
  });
  transport.onerror(new Error('boom'));
  assert.deepEqual(stand.lines, ['ig mcp: transport error: Error\n']);
  assert.deepEqual(stand.exits, [], 'the process has not ended before the flush');
  stand.pending[0]();
  assert.deepEqual(stand.exits, [1]);
});

test('a clean close exits with 0 and writes nothing to stderr', async () => {
  const transport = new FakeTransport();
  const stand = stdioStandIns();
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport,
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
  });
  await transport.close();
  assert.deepEqual(stand.exits, [0]);
  assert.deepEqual(stand.lines, []);
});

test('an error followed by a close writes one stderr line and exits once, with 1', async () => {
  const transport = new FakeTransport();
  const stand = stdioStandIns();
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport,
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
  });
  transport.onerror(Object.assign(new Error('boom'), { name: 'EIO' }));
  await transport.close();
  assert.deepEqual(stand.lines, ['ig mcp: transport error: EIO\n']);
  assert.deepEqual(stand.exits, [1]);
});

test('a failed start writes one stderr line with the error name only, and exits non-zero', async () => {
  const stand = stdioStandIns();
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport: new FailingStartTransport(),
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
  });
  // The failed start settles after startStdio returns, so one turn of the event loop passes first.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(stand.lines, ['ig mcp: transport error: ENODEV\n']);
  assert.deepEqual(stand.exits, [1]);
});

test('a stdout that never flushes still ends the process, after the backstop', async () => {
  const transport = new FakeTransport();
  const stand = stdioStandIns({ flush: 'held' });
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport,
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
    flushLimitMs: 20,
  });
  transport.onerror(new Error('boom'));
  assert.deepEqual(stand.exits, [], 'the process waits for the flush before the backstop');
  // The limit is 20 ms. The test waits well past it on a real timer, so no experimental timer API is used.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(stand.exits, [1]);
  // A flush that arrives after the backstop does not end the process a second time.
  stand.pending[0]();
  assert.deepEqual(stand.exits, [1]);
});

test('the default backstop is 5000 ms', () => {
  assert.equal(FLUSH_LIMIT_MS, 5000);
});

test('a parse error logs one line and does not exit', async () => {
  const transport = new FakeTransport();
  const stand = stdioStandIns();
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport,
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
  });
  transport.onerror(new SyntaxError('Unexpected token x in JSON at position 0 with mcp-frame-value-0123456789'));
  assert.deepEqual(stand.lines, ['ig mcp: framing error: SyntaxError\n']);
  assert.deepEqual(stand.exits, [], 'the process goes on after a parse error');
  // The process still ends on a clean close, with 0, and writes no second line.
  await transport.close();
  assert.deepEqual(stand.exits, [0]);
  assert.deepEqual(stand.lines, ['ig mcp: framing error: SyntaxError\n']);
});

test('a frame that is JSON but not a JSON-RPC message logs one framing line and does not exit', async () => {
  const transport = new FakeTransport();
  const stand = stdioStandIns();
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport,
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
  });
  transport.onerror(Object.assign(new Error('invalid_union at the root with mcp-frame-value-0123456789'), { name: 'ZodError' }));
  assert.deepEqual(stand.lines, ['ig mcp: framing error: ZodError\n']);
  assert.deepEqual(stand.exits, []);
});

test('a transport error that is not a framing error ends the process with 1', async () => {
  const transport = new FakeTransport();
  const stand = stdioStandIns();
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport,
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
  });
  // The SDK's buffer-overflow error has the name Error, so it is not a framing error by name, and it ends the process.
  transport.onerror(new Error('ReadBuffer exceeded maximum size of 50 bytes'));
  assert.deepEqual(stand.lines, ['ig mcp: transport error: Error\n']);
  assert.deepEqual(stand.exits, [1]);
});
