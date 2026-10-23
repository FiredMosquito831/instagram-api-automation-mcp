// The MCP thin client. It serves the tool registry over the MCP protocol on stdio. Each tool call goes to the HTTP API on
// loopback with the bearer token, and the HTTP API's answer becomes the MCP result. The names, descriptions, schemas and
// annotations are the registry's (TOOLS). No rule of the service is decided here: the HTTP API and the service hold every
// rule.
//
// Each call checks its arguments with validateArgs before it forwards, so a bad call is refused without a request. Every
// result passes through redact before it is returned.
//
// Stdout carries the MCP protocol, so nothing in this module writes to stdout. The lines this module writes go to stderr, and
// only startStdio writes them: one line for a transport error that ends the process, and one line for each framing error that
// does not. Each line carries the error name only.

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { IgError } from './errors.js';
import { redact, registerSecret } from './redact.js';
import { findTool, TOOLS, validateArgs } from './tools.js';
import { MAX_TIMER_MS } from './util/clock.js';

const SERVER_INFO = Object.freeze({ name: 'instagram-automation', version: '0.1.0' });
const LOOPBACK_HOST = '127.0.0.1';
const NOT_RUNNING = 'ig serve is not running. Start it with: ig serve';
const BAD_RESPONSE = 'the response from ig serve is not a valid result';
// The longest a call waits for ig serve, in milliseconds. A reel publish can poll its container for about five minutes (5
// seconds by 60 polls). A carousel polls each child in turn, so one carousel can run well past the default of ten minutes,
// and the ceiling then cuts it off. A timed-out write says that a write may have run, so the owner checks the status before
// retrying: its outcome is unknown. 2147483647 is the longest timer allowed.
const DEFAULT_TIMEOUT_MS = 600000;
const TIMED_OUT_READ = 'ig serve did not answer in time';
const TIMED_OUT_WRITE = 'ig serve did not answer in time; a write may have run, so check the status before you retry';

// True when a parsed body is an error body: an error object with a string kind.
function isErrorBody(body) {
  return body !== null && typeof body === 'object' && body.error !== null && typeof body.error === 'object' && typeof body.error.kind === 'string';
}

// True when a parsed HTTP body has one of the three shapes the HTTP API sends: a busy result, an error, or a result.
// Any other body is refused, so an unexpected answer is never read as success.
function isResultBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  if (body.busy === true || isErrorBody(body)) return true;
  return Object.hasOwn(body, 'result');
}

// True when fetch or the body read stopped because the call's timeout fired. Node raises AbortError for an aborted signal,
// and TimeoutError for a signal made by AbortSignal.timeout.
const isTimeout = (error) => error?.name === 'AbortError' || error?.name === 'TimeoutError';

// The message for a call that timed out. A tool that is not read-only may have run already, so its message says so. A name
// that is not in the registry counts as a write, which is the safe reading.
const timeoutMessageFor = (name) => (findTool(name)?.annotations?.readOnlyHint === true ? TIMED_OUT_READ : TIMED_OUT_WRITE);

// Calls the HTTP API for one tool and returns its parsed body. The body must be JSON of a known shape. A connection that
// fails, a body that cannot be read, and a body that is not JSON or not of a known shape are all API_ERROR. A call that
// does not finish within timeoutMs is cut off, and it is API_ERROR with the timeout message. fetch is injected, so the
// tests make no request.
export function createForward({ port, apiToken, fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new IgError('CONFIG', 'the port must be a whole number from 1 to 65535');
  }
  if (typeof apiToken !== 'string' || apiToken.trim() === '') throw new IgError('CONFIG', 'the api token must be given');
  const token = apiToken.trim();
  try {
    registerSecret(token);
  } catch {
    throw new IgError('CONFIG', 'the api token cannot be registered as a secret; use a longer token');
  }
  if (typeof fetch !== 'function') throw new TypeError('createForward needs a fetch function');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_MS) {
    throw new IgError('CONFIG', 'the timeout must be a whole number of milliseconds from 1 to 2147483647');
  }

  return async function forward(name, args) {
    const url = `http://${LOOPBACK_HOST}:${port}/tools/${encodeURIComponent(name)}`;
    // One signal covers the request and the body read, so a call that does not finish within timeoutMs is cut off.
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args ?? {}),
        signal,
      });
    } catch (error) {
      if (isTimeout(error)) throw new IgError('API_ERROR', timeoutMessageFor(name));
      throw new IgError('API_ERROR', NOT_RUNNING);
    }
    // The status is read before the body is trusted: a failed status is never a success.
    const status = response.status;
    let text;
    try {
      text = await response.text();
    } catch (error) {
      if (isTimeout(error)) throw new IgError('API_ERROR', timeoutMessageFor(name));
      throw new IgError('API_ERROR', 'the response from ig serve could not be read');
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new IgError('API_ERROR', BAD_RESPONSE);
    }
    if (!(status >= 200 && status <= 299)) {
      // Under a failed status only an error body is passed on, or the busy body of a 429. Any other body is API_ERROR. The
      // status is not mapped to a kind here: a 423 stop, a 409 STOPPED and a 400 VALIDATION each carry their kind in the
      // body, and runTool passes that kind on unchanged.
      if (isErrorBody(body) || (status === 429 && body?.busy === true)) return body;
      throw new IgError('API_ERROR', BAD_RESPONSE);
    }
    if (!isResultBody(body)) throw new IgError('API_ERROR', BAD_RESPONSE);
    return body;
  };
}

// An MCP result with one text item, the JSON of the value after redact.
function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(redact(value)) }] };
}

// An MCP error result: isError true and one text item that holds only {"error":{"kind":...,"message":...}}.
function errorResult(kind, message) {
  const text = typeof message === 'string' ? message : 'the request failed';
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: { kind: String(kind), message: redact(text) } }) }],
  };
}

// Runs one tool call: checks the arguments, forwards them, and turns the answer into an MCP result. A busy answer is an
// ordinary result. An error answer is isError. Any failure before or during the call is an error result, never a throw.
async function runTool(forward, tool, args) {
  let body;
  try {
    validateArgs(tool.inputSchema, args);
    body = await forward(tool.name, args ?? {});
  } catch (error) {
    if (error instanceof IgError) return errorResult(error.kind, error.message);
    return errorResult('INTERNAL', 'the tool call failed');
  }
  if (!isResultBody(body)) return errorResult('API_ERROR', BAD_RESPONSE);
  if (body.error) return errorResult(body.error.kind, body.error.message);
  if (body.busy === true) return textResult(body);
  return textResult(body.result ?? null);
}

// The input schema the SDK is given for one tool. The SDK needs a standard schema, and it advertises the JSON Schema
// returned here unchanged. The checking is the handler's job (validateArgs), which returns VALIDATION as an error result.
// The SDK's own refusal would be a protocol error with another shape, so the SDK's check always passes.
function schemaFor(tool) {
  const jsonSchema = () => JSON.parse(JSON.stringify(tool.inputSchema));
  return {
    '~standard': {
      version: 1,
      vendor: 'instagram-automation',
      validate: (value) => ({ value }),
      jsonSchema: { input: jsonSchema, output: jsonSchema },
    },
  };
}

// Builds the MCP server. Each tool in the list is registered with its name, description, input schema and annotations.
// forward(name, args) carries a call to the HTTP API; createForward builds the real one.
export function createMcpServer({ forward, tools = TOOLS } = {}) {
  if (typeof forward !== 'function') throw new TypeError('createMcpServer needs a forward function');
  if (!Array.isArray(tools)) throw new TypeError('the tools must be a list');
  const server = new McpServer(SERVER_INFO);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: schemaFor(tool), annotations: { ...tool.annotations } },
      (args) => runTool(forward, tool, args),
    );
  }
  return server;
}

// Serves the tools over stdio: the process's stdin and stdout unless the caller gives another transport. serveStdio is the
// entry that serves both protocol eras: the 2026-07-28 revision (server/discover, then a per-request envelope) and the 2025
// handshake (initialize). A plain connect would serve only the 2025 handshake.
// The longest the process waits for stdout to take the last frame, after a transport error or a close. A client that stops
// reading cannot hold the process open for ever past this.
export const FLUSH_LIMIT_MS = 5000;

// The error name, when it is a plain word, and Error otherwise. The message is never used, because it can carry a value.
function plainNameOf(error) {
  return typeof error?.name === 'string' && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error';
}

// The error names of a framing error: a frame that is not JSON (a SyntaxError, which the SDK skips before it reaches the
// transport) and a frame that is JSON but not a JSON-RPC message (the SDK's schema error, a ZodError). Every other transport
// error is an I/O failure, and it ends the process. The SDK's buffer-overflow error is not a framing error by name, so it
// ends the process too, which is the fail-closed reading.
const FRAMING_ERROR_NAMES = new Set(['SyntaxError', 'ZodError']);
const isFramingError = (error) => error instanceof SyntaxError || FRAMING_ERROR_NAMES.has(error?.name);

// The stderr line for a transport error that ends the process: the error name and nothing else.
function errorLineFor(error) {
  return `ig mcp: transport error: ${plainNameOf(error)}\n`;
}

// The stderr line for a framing error: the error name and nothing else. The process goes on after it.
function framingLineFor(error) {
  return `ig mcp: framing error: ${plainNameOf(error)}\n`;
}

// Calls done once the frames already written to stdout are flushed. An empty write is queued behind them, and its callback
// runs after they are out. A backstop timer calls done anyway, so a client that stops reading cannot hold the process open.
function flushThen(stdout, done, limitMs = FLUSH_LIMIT_MS) {
  let finished = false;
  const once = () => {
    if (finished) return;
    finished = true;
    clearTimeout(backstop);
    done();
  };
  const backstop = setTimeout(once, limitMs);
  try {
    stdout.write('', once);
  } catch {
    once();
  }
}

// Serves the tools over stdio: the process's stdin and stdout unless the caller gives another transport. A framing error (a
// frame that is not JSON, or JSON that is not JSON-RPC) writes one stderr line with the error name, and the process goes on.
// Any other transport error, or a failed start, writes one stderr line with the error name, and ends the process with 1 once
// the frames already written are flushed. A clean close ends it with 0. Whichever ends the process decides the code, and it
// ends once. exit, stderr, stdout and flushLimitMs (the backstop, 5000 ms by default) can be injected, so a test writes to no
// real stream and ends no process.
export async function startStdio({
  forward,
  tools = TOOLS,
  transport,
  exit = (code) => process.exit(code),
  flushLimitMs = FLUSH_LIMIT_MS,
  stderr = process.stderr,
  stdout = process.stdout,
} = {}) {
  const build = () => createMcpServer({ forward, tools });
  // Runs createMcpServer once. It throws now for a forward that is not a function, a tools value that is not a list, or a
  // tool the SDK refuses to register (a duplicate name), so a bad call fails at start and not at the first connection.
  build();
  const wire = transport ?? new StdioServerTransport();
  let decided = false;
  const decide = (code, line) => {
    if (decided) return;
    decided = true;
    if (line !== undefined) stderr.write(line);
    flushThen(stdout, () => exit(code), flushLimitMs);
  };
  // A start failure is a transport error too. serveStdio keeps a failed start to itself, so the failure is observed here,
  // and it is rethrown, so that serveStdio's own handling is unchanged.
  const start = wire.start.bind(wire);
  wire.start = async () => {
    try {
      return await start();
    } catch (error) {
      decide(1, errorLineFor(error));
      throw error;
    }
  };
  serveStdio(build, { transport: wire });
  // serveStdio has set its own onerror and onclose on the transport by now. Both are wrapped, so serveStdio still gets each
  // event, and the event is also observed here.
  const serveError = wire.onerror;
  wire.onerror = (error) => {
    try {
      serveError?.(error);
    } finally {
      // A framing error is logged, and the process goes on. Any other transport error is an I/O failure, which ends it.
      if (isFramingError(error)) {
        if (!decided) stderr.write(framingLineFor(error));
      } else {
        decide(1, errorLineFor(error));
      }
    }
  };
  const serveClose = wire.onclose;
  wire.onclose = () => {
    try {
      serveClose?.();
    } finally {
      decide(0);
    }
  };
}
