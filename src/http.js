// The HTTP API. One listener serves GET /health, POST /tools/:name and the webhook path. createHttpServer builds that
// listener and does not start it. serve starts it with listenHttp, which listens on the validated host and port, so a
// loopback default is never widened to every interface, and a direct listen on that server is refused. The request logic
// is reached in tests through requestHandlerForTests, so the tests call it with fake requests and never open a port.
//
// The order of checks for each request is fixed. The Host header comes first, for every route. Then the route, then the
// method. For a tool, the bearer token is checked before the tool is looked up, so an unauthenticated caller learns no
// tool names. Then the tool is looked up, then the body is read with a 1 MB limit, then the arguments are validated, and
// then the handler runs. A busy result is 429 with the busy fields as the body. A stop (AUTH_EXPIRED, CHECKPOINT,
// ACTION_BLOCKED or RATE_LIMITED) is 423 Locked, and STOPPED is 409; each error carries its kind in the body, and the
// status table is STATUS_FOR_KIND below. Every error and every result passes through redact before it is sent.

import { createServer } from 'node:http';
import { IgError } from './errors.js';
import { sameText } from './util/compare.js';
import { redact, registerSecret } from './redact.js';
import { findTool, TOOLS, validateArgs } from './tools.js';
import { readRawBody } from './webhooks.js';

// The largest request body that either route reads, in bytes. A larger body is refused with 413.
export const MAX_BODY_BYTES = 1048576;
const DEFAULT_PORT = 8788;
const DEFAULT_WEBHOOK_PATH = '/webhooks/instagram';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_ALLOWED_HOSTS = ['127.0.0.1', 'localhost'];
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
// A Host value: a name with no colon, or a bracketed IPv6 address, and then an optional port in digits. A bare IPv6
// address such as ::1 has colons and no brackets, so it does not match.
const HOST_VALUE = /^(\[[^\]]+\]|[^:[\]\s]+)(?::(\d+))?$/;
const TOOL_PATH = /^\/tools\/([^/]+)$/;
const BEARER = /^Bearer\s+(\S+)$/i;
const JSON_TYPE = 'application/json; charset=utf-8';
const TEXT_TYPE = 'text/plain; charset=utf-8';
// The status of each error kind that a tool can raise. The four stop kinds are 423 Locked: a persisted stop, which only
// ig_stop_clear with confirm lifts. STOPPED is 409, the service's refusal while a stop holds. Any kind not listed here is a
// 500. The kind is in the body in every case.
const STATUS_FOR_KIND = new Map([
  ['VALIDATION', 400],
  ['STOPPED', 409],
  ['AUTH_EXPIRED', 423],
  ['CHECKPOINT', 423],
  ['ACTION_BLOCKED', 423],
  ['RATE_LIMITED', 423],
  ['CAP_EXCEEDED', 429],
  ['OWNER_MISMATCH', 403],
  ['ROUTE_DISABLED', 403],
]);

// A failure of the HTTP layer itself, such as a missing token or a method that is not served. It carries its status,
// its kind, and any extra headers.
class HttpFailure extends Error {
  constructor(status, kind, message, headers = {}) {
    super(message);
    this.name = 'HttpFailure';
    this.status = status;
    this.kind = kind;
    this.headers = headers;
  }
}

const notFound = () => new HttpFailure(404, 'NOT_FOUND', 'not found');
const methodNotAllowed = (allowed) =>
  new HttpFailure(405, 'METHOD_NOT_ALLOWED', 'method not allowed', { Allow: allowed.join(', ') });

// The status, kind and message to send for any error. An IgError keeps its kind. Any other error is a 500 with a
// generic message, so nothing from an unexpected error reaches the caller.
function failureOf(error) {
  if (error instanceof HttpFailure) return error;
  if (error instanceof IgError) {
    return {
      status: STATUS_FOR_KIND.get(error.kind) ?? 500,
      kind: error.kind,
      message: error.message,
      headers: {},
    };
  }
  return { status: 500, kind: 'INTERNAL', message: 'the request failed', headers: {} };
}

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': TEXT_TYPE, 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function sendFailure(res, failure) {
  sendJson(res, failure.status, { error: { kind: failure.kind, message: redact(failure.message) } }, failure.headers);
}

// A Host value split into its name and its port, both lowercase: '[::1]:8788' gives '[::1]' and '8788', and 'localhost'
// gives 'localhost' and null. The port is kept as text, so that 08788 is not read as 8788. Null when the text is not a
// Host value.
function hostParts(value) {
  const match = HOST_VALUE.exec(value.trim().toLowerCase());
  return match ? { name: match[1], port: match[2] ?? null } : null;
}

// The key of an allowed entry: its name and its port, with the configured port when the entry has none.
function allowedKey(entry, port) {
  const parts = hostParts(entry);
  if (parts === null) {
    throw new IgError(
      'CONFIG',
      'an allowed host must be a name, a name with a port, or a bracketed IPv6 address such as [::1]',
    );
  }
  return `${parts.name}:${parts.port ?? port}`;
}

// The headers that the webhook handler gets. The Authorization header is left out, because it can carry the API token,
// and the webhook handler has no use for it. Every other header is passed unchanged.
function webhookHeadersOf(headers) {
  const kept = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== 'authorization') kept[name] = value;
  }
  return kept;
}

// Reports an unexpected error as a process warning that carries only its name. The message and the stack are left out,
// because either one can carry a secret. A name that is not a plain word is replaced by Error.
function warnUnexpected(error) {
  const name = typeof error?.name === 'string' && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error';
  process.emitWarning(`the HTTP API caught an unexpected ${name}`);
}

// Checks the options and returns the state the handler needs. A non-loopback host needs an api token. The token is
// registered as a secret, so that no output carries it. An allowed entry without a port gets the port.
function buildContext({
  service,
  tools = TOOLS,
  webhookHandler = null,
  webhookPath = DEFAULT_WEBHOOK_PATH,
  apiToken = '',
  host = DEFAULT_HOST,
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
  port = DEFAULT_PORT,
} = {}) {
  if (service === null || typeof service !== 'object') throw new TypeError('the HTTP API needs a service object');
  if (!Array.isArray(tools)) throw new TypeError('the tools must be a list');
  if (webhookHandler !== null && typeof webhookHandler !== 'function') {
    throw new TypeError('the webhook handler must be a function, or null');
  }
  if (typeof webhookPath !== 'string' || !webhookPath.startsWith('/')) {
    throw new TypeError('the webhook path must start with /');
  }
  if (typeof apiToken !== 'string') throw new TypeError('the api token must be a string');
  if (typeof host !== 'string') throw new TypeError('the host must be a string');
  const token = apiToken.trim();
  // A bracketed IPv6 host is given to listen without its brackets. The brackets are removed first and the rest is trimmed
  // again, so "[ ]" is an empty host. An empty host is refused, because listen would then bind every interface.
  const bindHost = host.trim().replace(/^\[(.*)\]$/, '$1').trim();
  if (bindHost === '') throw new IgError('CONFIG', 'the host must be given');
  if (!LOOPBACK_HOSTS.has(bindHost.toLowerCase()) && token === '') {
    throw new IgError('CONFIG', 'a host that is not loopback needs an api token');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new IgError('CONFIG', 'the port must be a whole number from 1 to 65535');
  }
  if (
    !Array.isArray(allowedHosts) ||
    allowedHosts.length === 0 ||
    allowedHosts.some((entry) => typeof entry !== 'string' || entry.trim() === '')
  ) {
    throw new IgError('CONFIG', 'allowedHosts must list at least one host');
  }
  if (token !== '') {
    try {
      registerSecret(token);
    } catch {
      throw new IgError('CONFIG', 'the api token cannot be registered as a secret; use a longer token');
    }
  }
  const hosts = new Set(allowedHosts.map((entry) => allowedKey(entry, port)));
  return { service, tools, webhookHandler, webhookPath, apiToken: token, allowedHosts: hosts, host: bindHost, port };
}

// True when the Host header is a Host value with a port, and its name and port are one of the allowed keys. A Host
// with no port is refused, and so is a bare IPv6 address.
function hostAllowed(headers, allowed) {
  const parts = typeof headers?.host === 'string' ? hostParts(headers.host) : null;
  return parts !== null && parts.port !== null && allowed.has(`${parts.name}:${parts.port}`);
}

// The URL of the request target, or 404 when the target cannot be read.
function parseUrl(target) {
  try {
    return new URL(String(target), 'http://localhost');
  } catch {
    throw notFound();
  }
}

// The query as a null-prototype object. A name that repeats gives a list of its values.
function queryOf(url) {
  const query = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (!(key in query)) query[key] = value;
    else query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
  }
  return query;
}

// The token of a Bearer header, or null when the header is missing, is another scheme, or carries no token.
function bearerTokenOf(headers) {
  const value = headers?.authorization;
  if (typeof value !== 'string') return null;
  const match = BEARER.exec(value.trim());
  return match ? match[1] : null;
}

// Compares the two tokens through their SHA-256 digests, so the time taken does not depend on where they differ. An
// empty expected token matches nothing, so an api token that is not set can never be presented.
function tokenMatches(presented, expected) {
  if (expected === '' || presented === null) return false;
  return sameText(presented, expected);
}

// Reads the body of a request as one Buffer, with the 1 MB limit. A request that has already ended, or been destroyed
// (a closed request is always destroyed), has no body left to read. readRawBody would wait for an end or close event
// that never comes, so such a request is refused here, without waiting.
// The 413 for a body over the limit. The connection is closed, because the rest of the body is not read.
const tooLarge = () =>
  new HttpFailure(413, 'PAYLOAD_TOO_LARGE', `the request body is over ${MAX_BODY_BYTES} bytes`, { Connection: 'close' });

async function readBody(req) {
  if (req.destroyed || req.readableEnded) {
    throw new HttpFailure(400, 'VALIDATION', 'the request body is no longer readable');
  }
  // A body that declares a length over the limit is refused before any of it is read.
  const declared = req.headers?.['content-length'];
  if (declared !== undefined) {
    if (typeof declared !== 'string' || !/^\d+$/.test(declared)) {
      throw new HttpFailure(400, 'VALIDATION', 'the content-length header is not a whole number');
    }
    if (Number(declared) > MAX_BODY_BYTES) throw tooLarge();
  }
  try {
    return await readRawBody(req, MAX_BODY_BYTES);
  } catch (error) {
    if (error?.status === 413) throw tooLarge();
    throw new HttpFailure(400, 'VALIDATION', 'the request body could not be read');
  }
}

// The arguments of a tool call. An empty body is no arguments. Any other body must be JSON.
function parseArgs(raw) {
  const text = raw.toString('utf8');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpFailure(400, 'VALIDATION', 'the body is not valid JSON');
  }
}

// POST /tools/:name. The order is: the method, the token, the tool lookup, the body, the validation, the handler.
async function serveTool(ctx, req, res, encodedName) {
  if (req.method !== 'POST') throw methodNotAllowed(['POST']);
  if (!tokenMatches(bearerTokenOf(req.headers), ctx.apiToken)) {
    throw new HttpFailure(401, 'UNAUTHORIZED', 'a valid bearer token is required', { 'WWW-Authenticate': 'Bearer' });
  }
  let name;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    throw new HttpFailure(404, 'NOT_FOUND', 'unknown tool');
  }
  const tool = findTool(name, ctx.tools);
  if (!tool) throw new HttpFailure(404, 'NOT_FOUND', 'unknown tool');
  const args = parseArgs(await readBody(req));
  validateArgs(tool.inputSchema, args);
  const result = await tool.handler(ctx.service, args);
  if (result?.busy === true) {
    return sendJson(res, 429, { busy: true, reason: redact(result.reason), retryAfterMs: result.retryAfterMs });
  }
  return sendJson(res, 200, { result: redact(result ?? null) });
}

// The webhook path. A GET or a POST goes to the handler, which answers with a status and a text body. The handler gets
// the method, the query, the headers and the raw body, unchanged.
async function serveWebhook(ctx, req, res, url) {
  if (req.method !== 'GET' && req.method !== 'POST') throw methodNotAllowed(['GET', 'POST']);
  const rawBody = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
  const reply = await ctx.webhookHandler({
    method: req.method,
    query: queryOf(url),
    headers: webhookHeadersOf(req.headers),
    rawBody,
  });
  return sendText(res, reply.status, reply.body);
}

async function route(ctx, req, res) {
  if (!hostAllowed(req.headers, ctx.allowedHosts)) {
    throw new HttpFailure(403, 'FORBIDDEN', 'the Host header is not allowed');
  }
  const url = parseUrl(req.url);
  if (url.pathname === '/health') {
    if (req.method !== 'GET') throw methodNotAllowed(['GET']);
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === ctx.webhookPath) {
    if (ctx.webhookHandler === null) throw notFound();
    return serveWebhook(ctx, req, res, url);
  }
  const match = TOOL_PATH.exec(url.pathname);
  if (match) return serveTool(ctx, req, res, match[1]);
  throw notFound();
}

// The bind host and port of each server that createHttpServer built. listenHttp reads them, so that a server is listened
// on its validated host and never on every interface.
const bindings = new WeakMap();
// The servers that listenHttp is starting at this moment. A server from createHttpServer listens only while it is in here.
const starting = new WeakSet();

// The request handler for a checked context. The handler never rejects: every failure becomes a response, so the server
// never sees an unhandled rejection. An unexpected error is also reported as a process warning, with its name only.
function requestHandlerFor(ctx) {
  return async function handleRequest(req, res) {
    try {
      await route(ctx, req, res);
    } catch (error) {
      try {
        if (!(error instanceof HttpFailure) && !(error instanceof IgError)) warnUnexpected(error);
        if (res.headersSent) res.end();
        else sendFailure(res, failureOf(error));
      } catch {
        // The response cannot be written, so the connection is closed rather than left open.
        res.destroy?.();
      }
    }
  };
}

// The request handler for a checked context, for tests only. Tests call it with fake requests and fake responses. It is
// not exported for serving: a handler given to http.createServer and listened on a port binds every interface, so the
// server is built with createHttpServer and started with listenHttp.
export function requestHandlerForTests(options) {
  return requestHandlerFor(buildContext(options));
}

// Builds the HTTP server. It is not listening: serve starts it with listenHttp. Its own listen refuses any other start,
// so a direct listen cannot bind every interface.
export function createHttpServer(options) {
  const ctx = buildContext(options);
  const server = createServer(requestHandlerFor(ctx));
  bindings.set(server, { host: ctx.host, port: ctx.port });
  const nativeListen = server.listen;
  server.listen = function listenOnlyThroughListenHttp(...args) {
    if (!starting.has(server)) {
      throw new IgError('CONFIG', 'a server from createHttpServer is started with listenHttp only');
    }
    return nativeListen.apply(server, args);
  };
  return server;
}

// Starts a server that createHttpServer built, on the host and port it was validated with. A server that this module
// did not build is refused with CONFIG, so it is never started on a default address.
export function listenHttp(server) {
  const binding = bindings.get(server);
  if (binding === undefined) throw new IgError('CONFIG', 'listenHttp needs a server that createHttpServer built');
  starting.add(server);
  try {
    return server.listen(binding.port, binding.host);
  } finally {
    starting.delete(server);
  }
}
