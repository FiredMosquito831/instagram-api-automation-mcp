// The instagrapi sidecar adapter. A Python child process speaks JSON lines over stdio. The child starts on the
// first call. Each request is one line { id, method, params }, and each response is one line with the same id.
// Each child keeps its own pending calls, so a late event from a killed child cannot reject a newer child's calls.

import { spawn } from 'node:child_process';
import { IgError } from '../errors.js';
import { redact, registerSecret } from '../redact.js';
import { MAX_TIMER_MS } from '../util/clock.js';
import { isPlainObject } from '../util/object.js';

const MAX_BUFFER_CHARS = 16 * 1024 * 1024;

// Sidecar error kinds to IgError kinds. Any other kind is UNOFFICIAL_ADAPTER_ERROR, not a guess.
const KIND_MAP = new Map([
  ['checkpoint', 'CHECKPOINT'],
  ['challenge', 'CHECKPOINT'],
  ['two_factor', 'CHECKPOINT'],
  ['auth_expired', 'AUTH_EXPIRED'],
  ['rate_limited', 'RATE_LIMITED'],
  ['action_blocked', 'ACTION_BLOCKED'],
]);

function sidecarKind(kind) {
  return KIND_MAP.get(kind) ?? 'UNOFFICIAL_ADAPTER_ERROR';
}

// Splits stdout text into complete lines. buffer is the unfinished text left by the previous chunk, and rest is the unfinished
// text after this chunk. Each complete line is sliced once, and the unfinished tail is sliced once per chunk. The rest of the
// chunk is not copied again for each line (A-30), so the work is in proportion to the length of the chunk, and rest never holds
// more than one unfinished line. A carriage return at the end of a line is removed.
export function splitLines(buffer, chunk) {
  const text = buffer + chunk;
  const lines = [];
  let start = 0;
  for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
    lines.push(text.slice(start, end).replace(/\r$/, ''));
    start = end + 1;
  }
  return { lines, rest: text.slice(start) };
}

// Returns a copy of a session value in which every string is trimmed, and registers each trimmed, non-blank string
// as a secret, at any depth. The copy is what the caller gets. A string the registry refuses for its length or its
// content (under 8 characters, or inside the redaction marker) is kept, but not registered. Any other failure to
// register, such as a lone surrogate, is UNOFFICIAL_ADAPTER_ERROR, so no session is returned unregistered.
export function prepareSession(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text !== '') registerSessionText(text);
    return text;
  }
  if (Array.isArray(value)) return value.map(prepareSession);
  if (isPlainObject(value)) {
    const copy = {};
    // defineProperty, not assignment, so that a key such as __proto__ stays an ordinary property of the copy.
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(copy, key, {
        value: prepareSession(item),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  }
  return value;
}

function registerSessionText(text) {
  // Text that cannot be encoded (a lone surrogate) is refused here, not skipped: a skipped session string would be returned
  // without being masked. registerSecret refuses it too, but that refusal is a VALIDATION error, which is skipped below.
  try {
    encodeURIComponent(text);
  } catch {
    throw new IgError('UNOFFICIAL_ADAPTER_ERROR', 'a session string could not be registered for masking');
  }
  try {
    registerSecret(text);
  } catch (error) {
    if (error instanceof IgError && error.kind === 'VALIDATION') return;
    throw new IgError('UNOFFICIAL_ADAPTER_ERROR', 'a session string could not be registered for masking');
  }
}

// The variables the child may read: the system paths it needs to run, and the Python settings that choose its interpreter,
// its library path, its user site and its text encoding. Every other variable is left out, so the child cannot read a
// variable that the project does not need it to have. Tokens and passwords reach the child over stdin, never through its
// environment. Names are compared without case, because Windows environment names are not case-sensitive.
const CHILD_ENV_NAMES = new Set([
  'PATH',
  'SYSTEMROOT',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'PYTHONHOME',
  'PYTHONPATH',
  'PYTHONUSERBASE',
  'PYTHONUTF8',
  'PYTHONIOENCODING',
]);

// The child gets only the allowlisted variables, under the names they have in this process.
function childEnvironment() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && CHILD_ENV_NAMES.has(name.toUpperCase())) env[name] = value;
  }
  return env;
}

// The child's stderr is kept as whole lines, never cut inside a line, so a registered value is masked whole before any cut for display
// (S-L1, and its 1000-character form). A line is kept whole up to STDERR_LINE_LIMIT characters. A longer line is not kept: it is shown as
// not shown, and no part of it is. At most STDERR_LINES_KEPT lines are kept.
const STDERR_LINE_LIMIT = 8192;
const STDERR_LINES_KEPT = 20;
const NOT_KEPT = null;

function appendStderrText(session, text) {
  if (session.stderrPartialDropped) return;
  session.stderrPartial += text;
  if (session.stderrPartial.length > STDERR_LINE_LIMIT) {
    session.stderrPartial = '';
    session.stderrPartialDropped = true;
  }
}

function finishStderrLine(session) {
  session.stderrLines.push(session.stderrPartialDropped ? NOT_KEPT : session.stderrPartial);
  if (session.stderrLines.length > STDERR_LINES_KEPT) session.stderrLines.shift();
  session.stderrPartial = '';
  session.stderrPartialDropped = false;
}

// Adds a chunk of the child's stderr. Each complete line is finished when its newline arrives.
function addStderrChunk(session, chunk) {
  let start = 0;
  let newline = chunk.indexOf('\n', start);
  while (newline !== -1) {
    appendStderrText(session, chunk.slice(start, newline));
    finishStderrLine(session);
    start = newline + 1;
    newline = chunk.indexOf('\n', start);
  }
  appendStderrText(session, chunk.slice(start));
}

// The last non-blank line of the child's stderr, for a diagnostic. The whole line is redacted first, and only then cut to 200 characters
// for display. A line that was not kept is named as not shown.
function lastStderrText(session) {
  const candidates = [...session.stderrLines];
  if (session.stderrPartialDropped) candidates.push(NOT_KEPT);
  else candidates.push(session.stderrPartial);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const line = candidates[index];
    if (line === NOT_KEPT) return `a line of over ${STDERR_LINE_LIMIT} characters, not shown`;
    if (line.trim() !== '') return redact(line.trim()).slice(0, 200);
  }
  return '';
}

// The message for a child that could not be started. It names the executable as configured. It holds no argument and no value.
function startFailureMessage(command, code) {
  const reason = code === 'ENOENT' ? 'was not found' : 'could not be run';
  return `the sidecar could not be started: the executable "${command}" ${reason} (${code})`;
}

/**
 * Creates an adapter that talks to a sidecar child process. The adapter has the shape in ./adapter.js, plus pid(),
 * which returns the child's process id or null when no child is running. Every request goes through a typed method.
 *
 * @param {{ command: string, args?: string[], timeoutMs?: number }} options
 * @returns {import('./adapter.js').UnofficialAdapter & { pid: () => number | null }}
 */
export function createSidecarAdapter({ command, args = [], timeoutMs = 20000 } = {}) {
  if (typeof command !== 'string' || command.trim() === '') throw new TypeError('a sidecar adapter needs a command');
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    throw new TypeError('sidecar args must be an array of strings');
  }
  if (typeof timeoutMs !== 'number' || !(timeoutMs > 0) || timeoutMs > MAX_TIMER_MS) {
    throw new TypeError(`timeoutMs must be a number from 1 to ${MAX_TIMER_MS}`);
  }

  let current = null; // the session of the running child, or null
  let nextId = 1;
  let closed = false;

  // Rejects every pending call of one child and kills it. Safe to call more than once.
  // A failure of a child that has not yet answered anything is a failure to start it. It is marked (sidecarStart), so the caller can tell
  // it from a failure of a session that did start. A missing script, a Python that exits at once, and a child that never answers all
  // count, as F2-M-6 requires. A failure after the first reply is an ordinary failure of a running child.
  function failStart(session, reason) {
    if (session.replies === 0) teardown(session, reason, { sidecarStart: 'failed', command });
    else teardown(session, reason);
  }

  function teardown(session, reason, details = {}) {
    if (session.dead) return;
    session.dead = true;
    if (current === session) current = null;
    const calls = [...session.calls.values()];
    session.calls.clear();
    for (const pending of calls) {
      clearTimeout(pending.timer);
      pending.reject(new IgError('UNOFFICIAL_ADAPTER_ERROR', reason, details));
    }
    session.proc.kill();
  }

  function handleLine(session, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      failStart(session, 'the sidecar sent a line that is not JSON');
      return;
    }
    if (!isPlainObject(message) || !session.calls.has(message.id)) {
      failStart(session, 'the sidecar sent a response that matches no request');
      return;
    }
    const pending = session.calls.get(message.id);
    session.calls.delete(message.id);
    clearTimeout(pending.timer);
    // The child has answered at least once, so it started.
    session.replies += 1;
    if (message.ok === true) {
      // Every sidecar method replies with a JSON object (HANDLERS in sidecar/ig_sidecar.py), so any other result
      // is refused, not read as success.
      if (isPlainObject(message.result)) {
        pending.resolve(message.result);
      } else {
        pending.reject(new IgError('UNOFFICIAL_ADAPTER_ERROR', 'the sidecar sent a success with no object result'));
      }
    } else if (message.ok === false && isPlainObject(message.error)) {
      const text = typeof message.error.message === 'string' ? message.error.message : 'the sidecar reported an error';
      // The sidecar's own kind is kept in the details, so the login can tell a two-factor request from a checkpoint.
      const sidecarKindName = typeof message.error.kind === 'string' ? message.error.kind : null;
      // "unavailable" is the sidecar saying the library cannot run (instagrapi is not installed). The session did not start, so it is marked
      // as not started, the same as a child that could not start. It maps to UNOFFICIAL_ADAPTER_ERROR, and a restore gives no stop for it.
      const details = { sidecarKind: sidecarKindName };
      if (sidecarKindName === 'unavailable') details.sidecarStart = 'failed';
      pending.reject(new IgError(sidecarKind(message.error.kind), text, details));
    } else {
      pending.reject(new IgError('UNOFFICIAL_ADAPTER_ERROR', 'the sidecar sent a response with no valid ok field'));
    }
  }

  function receive(session, chunk) {
    if (session.dead) return;
    if (session.buffer.length + chunk.length > MAX_BUFFER_CHARS) {
      failStart(session, 'the sidecar sent a response that is too large');
      return;
    }
    const { lines, rest } = splitLines(session.buffer, chunk);
    session.buffer = rest;
    for (const line of lines) {
      if (session.dead) break;
      if (line.trim() !== '') handleLine(session, line);
    }
    if (session.dead) session.buffer = '';
  }

  function start() {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: childEnvironment() });
    const session = {
      proc,
      buffer: '',
      calls: new Map(),
      dead: false,
      spawned: false,
      replies: 0,
      stderrLines: [],
      stderrPartial: '',
      stderrPartialDropped: false,
    };
    current = session;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => receive(session, chunk));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => addStderrChunk(session, chunk));
    proc.on('spawn', () => {
      session.spawned = true;
    });
    // A write to a child that has not started raises an error on stdin too. The error event of the process is the one that says why,
    // so an error on stdin counts only once the child has started.
    proc.stdin.on('error', () => {
      if (session.spawned) failStart(session, 'the sidecar stopped reading its input');
    });
    // An error before 'spawn' means the child never started (for example, the executable is missing). That is not a failed session, so
    // the error is marked, and the caller can tell it apart (sidecarStart).
    proc.on('error', (error) => {
      if (session.spawned) {
        failStart(session, `the sidecar failed (${error.code ?? 'error'})`);
        return;
      }
      teardown(session, startFailureMessage(command, error.code ?? 'error'), { sidecarStart: 'failed', command });
    });
    // 'close', not 'exit': 'close' comes after the stdio streams have ended, so the stderr of the child is complete when the
    // diagnostic is read. On 'exit' a last chunk of stderr may still be on its way.
    proc.on('close', (code, signal) => {
      const detail = lastStderrText(session);
      const suffix = detail === '' ? '' : `: ${detail}`;
      failStart(session, `the sidecar exited (${code ?? signal}) without answering${suffix}`);
    });
    return session;
  }

  // One request and its reply. The typed methods below are the only callers.
  function request(method, params = {}) {
    if (closed) return Promise.reject(new IgError('UNOFFICIAL_ADAPTER_ERROR', 'the sidecar adapter is closed'));
    const id = nextId;
    nextId += 1;
    let line;
    try {
      line = `${JSON.stringify({ id, method, params })}\n`;
    } catch {
      return Promise.reject(new IgError('UNOFFICIAL_ADAPTER_ERROR', 'the sidecar request could not be encoded'));
    }
    return new Promise((resolve, reject) => {
      let session;
      try {
        session = current ?? start();
      } catch {
        reject(
          new IgError(
            'UNOFFICIAL_ADAPTER_ERROR',
            `the sidecar could not be started: the executable "${command}" could not be run`,
            { sidecarStart: 'failed', command },
          ),
        );
        return;
      }
      const timer = setTimeout(
        () => failStart(session, `the sidecar did not answer within ${timeoutMs} ms`),
        timeoutMs,
      );
      session.calls.set(id, { resolve, reject, timer });
      session.proc.stdin.write(line);
    });
  }

  // A request whose reply is a session. Its strings are trimmed and registered before the promise resolves, so the
  // caller gets the session only after every string in it is a registered secret.
  function sessionRequest(method, params) {
    return request(method, params).then(prepareSession);
  }

  function pid() {
    return current ? (current.proc.pid ?? null) : null;
  }

  async function close() {
    closed = true;
    if (current) teardown(current, 'the sidecar adapter was closed');
  }

  return {
    login: ({ username, password, verificationCode } = {}) =>
      sessionRequest('login', { username, password, verificationCode }),
    restoreSession: (session) => sessionRequest('restore_session', { session }),
    follow: (userId) => request('follow', { userId }),
    unfollow: (userId) => request('unfollow', { userId }),
    profileEdit: (fields) => request('profile_edit', { fields }),
    status: () => request('status', {}),
    close,
    pid,
  };
}
