// The stop-chain walk in sidecar/ig_sidecar.py, run in a Python child process. The cases are the chain cases in
// task-12-report.md sections 7, 9.5 and 10.4 to 10.5. The exception classes are stand-ins that carry instagrapi's names.
// instagrapi is not installed and is not imported. The tests skip when no Python is found on PATH, and they make no
// network call. The child runs with a fixed argument array, with no shell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TIMEOUT_MS = 10000;

// Finds a Python interpreter: python first, then the py launcher with -3. A probe that fails or times out does not count.
function findPython() {
  const candidates = [
    { command: 'python', prefix: [] },
    { command: 'py', prefix: ['-3'] },
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.prefix, '--version'], {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

const python = findPython();
const SKIP = python ? false : 'skip: python not found on PATH';

// The script imports the project's sidecar module, maps each chain case, and prints one JSON object. The module
// imports only the standard library at load time, so instagrapi is not needed.
const SCRIPT = [
  'import json',
  'import sys',
  'sys.path.insert(0, sys.argv[1])',
  'import sidecar.ig_sidecar as s',
  '',
  'class ChallengeRequired(Exception):',
  '    pass',
  '',
  '',
  'class ClientThrottledError(Exception):',
  '    pass',
  '',
  '',
  'class LoginRequired(Exception):',
  '    pass',
  '',
  '',
  'class FeedbackRequired(Exception):',
  '    pass',
  '',
  '',
  'class SignupSpamError(FeedbackRequired):',
  '    pass',
  '',
  '',
  'def chained(exc, cause=None, context=None):',
  '    if cause is not None:',
  '        exc.__cause__ = cause',
  '    if context is not None:',
  '        exc.__context__ = context',
  '    return exc',
  '',
  '',
  'def generic_over(tail, depth):',
  '    head = tail',
  '    for index in range(depth):',
  '        head = chained(Exception("wrapper " + str(index)), cause=head)',
  '    return head',
  '',
  'cases = {}',
  'cases["cte_from_challenge"] = chained(ClientThrottledError("429"), cause=ChallengeRequired("challenge"))',
  'cases["challenge_from_cte"] = chained(ChallengeRequired("challenge"), cause=ClientThrottledError("429"))',
  'cases["cte_from_login"] = chained(ClientThrottledError("429"), cause=LoginRequired("login"))',
  'cases["login_from_challenge"] = chained(LoginRequired("login"), cause=ChallengeRequired("challenge"))',
  'generic = chained(Exception("a"), cause=Exception("b"))',
  'generic.__cause__.__context__ = ValueError("c")',
  'cases["generic_no_stop"] = generic',
  'cases["deep_40_over_challenge"] = generic_over(ChallengeRequired("end"), 40)',
  'loop_a = Exception("a")',
  'loop_b = Exception("b")',
  'loop_a.__cause__ = loop_b',
  'loop_b.__context__ = loop_a',
  'cases["two_cycle"] = loop_a',
  'cases["challenge_with_generic_cause"] = chained(ChallengeRequired("challenge"), cause=Exception("generic"))',
  'cases["plain_exception"] = Exception("plain")',
  'cases["generic_over_challenge"] = chained(Exception("generic wrapper"), cause=ChallengeRequired("inner"))',
  'cases["runtime_error_context_cte"] = chained(RuntimeError("wrapper"), context=ClientThrottledError("429"))',
  'cases["deep_feedback"] = chained(Exception("a"), cause=chained(RuntimeError("b"), cause=FeedbackRequired("c")))',
  'cases["subclass_cause"] = chained(Exception("wrapper"), cause=SignupSpamError("spam"))',
  'cases["cause_challenge_context_cte"] = chained(',
  '    Exception("both"), cause=ChallengeRequired("cause"), context=ClientThrottledError("context"))',
  'cases["cte_alone"] = ClientThrottledError("429")',
  '',
  'kinds = {name: s.kind_for_exception(exc) for name, exc in cases.items()}',
  'names = {name: s.map_exception_kind(name)',
  '         for name in ("ClientThrottledError", "ChallengeRequired", "LoginRequired", "ProxyAddressIsBlocked", "Exception")}',
  // restore_session with instagrapi absent: the sidecar answers "unavailable" before it reaches Instagram. If instagrapi is installed, this
  // call would reach Instagram, so it is not made, and the test skips.
  'import importlib.util',
  'installed = importlib.util.find_spec("instagrapi") is not None',
  'restore = None if installed else s.handle_request({"id": 1, "method": "restore_session", "params": {"session": {"sessionid": "x"}}})',
  'print(json.dumps({"kinds": kinds, "names": names, "instagrapi_loaded": "instagrapi" in sys.modules,',
  '                  "instagrapi_installed": installed, "restore": restore}))',
].join('\n');

let cached = null;

// Runs the script once, and returns its parsed output. A failed run is an error, not a skip.
function pythonRun() {
  if (cached === null) {
    // -I ignores PYTHON* environment variables, so -B (no bytecode files) is given on the command line.
    const run = spawnSync(python.command, [...python.prefix, '-I', '-B', '-c', SCRIPT, ROOT], {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      windowsHide: true,
      cwd: ROOT,
    });
    if (run.error) throw new Error(`python chain check did not run: ${run.error.message}`);
    if (run.status !== 0) throw new Error(`python chain check failed: ${run.stderr}`);
    cached = JSON.parse(run.stdout);
  }
  return cached;
}

// [case id in the script, label, expected kind]
const CHAIN_CASES = [
  ['cte_from_challenge', 'ClientThrottledError raised from ChallengeRequired', 'challenge'],
  ['challenge_from_cte', 'ChallengeRequired raised from ClientThrottledError', 'challenge'],
  ['cte_from_login', 'ClientThrottledError raised from LoginRequired', 'auth_expired'],
  ['login_from_challenge', 'LoginRequired raised from ChallengeRequired', 'challenge'],
  ['generic_no_stop', 'a generic chain with no stop', 'api_error'],
  ['deep_40_over_challenge', '40 generic exceptions over a ChallengeRequired', 'challenge'],
  ['two_cycle', 'a two-cycle through __cause__ and __context__', 'api_error'],
  ['challenge_with_generic_cause', 'ChallengeRequired with a generic __cause__', 'challenge'],
  ['plain_exception', 'a plain Exception with no chain', 'api_error'],
  ['generic_over_challenge', 'a generic Exception with __cause__ ChallengeRequired', 'challenge'],
  ['runtime_error_context_cte', 'RuntimeError with __context__ ClientThrottledError', 'rate_limited'],
  ['deep_feedback', 'generic, then RuntimeError, then FeedbackRequired', 'action_blocked'],
  ['subclass_cause', 'a generic Exception with __cause__ SignupSpamError', 'action_blocked'],
  ['cause_challenge_context_cte', 'a challenge cause with a rate-limit context', 'challenge'],
  ['cte_alone', 'ClientThrottledError alone', 'rate_limited'],
];

for (const [id, label, expected] of CHAIN_CASES) {
  test(`python chain: ${label} maps to ${expected}`, { skip: SKIP }, () => {
    assert.equal(pythonRun().kinds[id], expected);
  });
}

test('python names: map_exception_kind maps the class names as the brief says', { skip: SKIP }, () => {
  assert.deepEqual(pythonRun().names, {
    ClientThrottledError: 'rate_limited',
    ChallengeRequired: 'challenge',
    LoginRequired: 'auth_expired',
    ProxyAddressIsBlocked: 'action_blocked',
    Exception: 'api_error',
  });
});

test('python import: the sidecar module loads without importing instagrapi', { skip: SKIP }, () => {
  assert.equal(pythonRun().instagrapi_loaded, false);
});

test('python restore: with instagrapi not installed, restore_session replies unavailable, and nothing is sent to Instagram', { skip: SKIP }, (t) => {
  const result = pythonRun();
  if (result.instagrapi_installed) {
    t.skip('instagrapi is installed, so this check would reach Instagram; it runs only without instagrapi');
    return;
  }
  assert.equal(result.restore.ok, false);
  assert.equal(result.restore.error.kind, 'unavailable');
  assert.equal(result.restore.error.message, 'instagrapi is not installed; install the pinned version in sidecar/requirements.txt');
});

// The scrub of an error message (_safe_message). The secret values reach the child on stdin as JSON, never on its command
// line, so no quoting of the values is needed. The child prints one JSON object with the four scrubbed messages.
const SCRUB_PASSWORD = 'pa"ss\\word-1';
const SCRUB_TOKEN = 'EAAB/tok+en-123456';

const SCRUB_SCRIPT = [
  'import json',
  'import sys',
  'from urllib.parse import quote',
  'sys.path.insert(0, sys.argv[1])',
  'import sidecar.ig_sidecar as s',
  '',
  'class Failure(Exception):',
  '    pass',
  '',
  'doc = json.loads(sys.stdin.buffer.read().decode("utf-8"))',
  'password, token = doc["password"], doc["token"]',
  'params = {"password": password, "session": {"token": token}}',
  'messages = {',
  '    "json": "login failed: " + json.dumps(password)[1:-1],',
  '    "url": "session " + quote(token, safe=""),',
  '    "urlpw": "password " + quote(password, safe=""),',
  '    "raw": "password " + password,',
  '    "plain": "a plain failure",',
  '}',
  'print(json.dumps({name: s._safe_message(Failure(text), params) for name, text in messages.items()}))',
].join('\n');

let scrubCached = null;

// Runs the scrub script once, and returns its parsed output. A failed run is an error, not a skip.
function scrubRun() {
  if (scrubCached === null) {
    const run = spawnSync(python.command, [...python.prefix, '-I', '-B', '-c', SCRUB_SCRIPT, ROOT], {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      windowsHide: true,
      cwd: ROOT,
      input: JSON.stringify({ password: SCRUB_PASSWORD, token: SCRUB_TOKEN }),
    });
    if (run.error) throw new Error(`python scrub check did not run: ${run.error.message}`);
    if (run.status !== 0) throw new Error(`python scrub check failed: ${run.stderr}`);
    scrubCached = JSON.parse(run.stdout);
  }
  return scrubCached;
}

test('python scrub: a password in JSON-escaped form is masked in an error message', { skip: SKIP }, () => {
  const escaped = JSON.stringify(SCRUB_PASSWORD).slice(1, -1);
  const message = scrubRun().json;
  assert.equal(message.includes(escaped), false, message);
  assert.ok(message.includes('[redacted]'), message);
});

test('python scrub: a session token in URL-encoded form is masked in an error message', { skip: SKIP }, () => {
  const encoded = encodeURIComponent(SCRUB_TOKEN);
  const message = scrubRun().url;
  assert.equal(message.includes(encoded), false, message);
  assert.ok(message.includes('[redacted]'), message);
});

test('python scrub: the raw password is still masked in an error message', { skip: SKIP }, () => {
  const message = scrubRun().raw;
  assert.equal(message.includes(SCRUB_PASSWORD), false, message);
  assert.ok(message.includes('[redacted]'), message);
});

test('python scrub: an ordinary error message is unchanged', { skip: SKIP }, () => {
  assert.equal(scrubRun().plain, 'a plain failure');
});

test('python scrub: a value with a quote and a backslash is masked in its URL-encoded form', { skip: SKIP }, () => {
  const encoded = encodeURIComponent(SCRUB_PASSWORD);
  const message = scrubRun().urlpw;
  assert.equal(message.includes(encoded), false, message);
  assert.ok(message.includes('[redacted]'), message);
});

// Review round 1 (M-6). The Python forms are the JS registry forms: the raw value, the encodeURIComponent form and the
// JSON-escaped form without its quotes. The script prints the list that _secret_forms builds for the value it reads from stdin.
const FORMS_SCRIPT = [
  'import json',
  'import sys',
  'sys.path.insert(0, sys.argv[1])',
  'import sidecar.ig_sidecar as s',
  'value = json.loads(sys.stdin.buffer.read().decode("utf-8"))["value"]',
  'print(json.dumps(s._secret_forms(value)))',
].join('\n');

// The forms the Python side builds for one value. A failed run is an error, not a skip.
function pythonForms(value) {
  const run = spawnSync(python.command, [...python.prefix, '-I', '-B', '-c', FORMS_SCRIPT, ROOT], {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    windowsHide: true,
    cwd: ROOT,
    input: JSON.stringify({ value }),
  });
  if (run.error) throw new Error(`python forms check did not run: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`python forms check failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

test('python forms match the JS registry forms for a value with a quote, a backslash, a space and a newline', { skip: SKIP }, () => {
  const value = 'pa"ss\\word 1\né-7';
  const expected = [...new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])].sort();
  assert.deepEqual([...pythonForms(value)].sort(), expected);
});
