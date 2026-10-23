import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createAdapterRegistry } from '../src/unofficial/adapter.js';
import { createSidecarAdapter, splitLines } from '../src/unofficial/sidecar.js';
import { createJsLibAdapter } from '../src/unofficial/jslib.js';
import { IgError } from '../src/errors.js';
import { redact, registerSecret } from '../src/redact.js';

// The fixture stands in for the Python sidecar. No test here starts instagrapi or makes a network call.
const FIXTURE = fileURLToPath(new URL('./fixtures/fake-sidecar.js', import.meta.url));
const LIMIT_MS = 5000;
// The budget for a request to a fixture child. The clock starts with the first request, so it includes the child's start.
// A quiet start takes about 70 ms. Measured under load (15 CPU-bound node processes and 15 concurrent fixture children,
// 45 starts), a start took a median of 6.5 s and a worst case of 16.1 s, so a 5 s budget fails on an ordinary parallel run.
// The budget is 30 s, about twice the worst measured start. The test that expects a timeout still passes its own 200 ms.
const CHILD_MS = 30000;
// These must match the tokens in the fixture's session mode.
const SESSION_TOKEN = 'SESSION-TOKEN-7f3a9c';
const RESTORE_TOKEN = 'RESTORE-TOKEN-0b2d4e';
const PADDED_TOKEN = 'PADDED-TOKEN-9d8c7b';

function fixtureAdapter(mode, timeoutMs = CHILD_MS) {
  const args = mode ? [FIXTURE, mode] : [FIXTURE];
  return createSidecarAdapter({ command: process.execPath, args, timeoutMs });
}

async function assertKind(promise, kind) {
  await assert.rejects(promise, (error) => error instanceof IgError && error.kind === kind);
}

async function waitUntilGone(pid) {
  const until = Date.now() + LIMIT_MS;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    if (Date.now() > until) assert.fail(`process ${pid} is still running`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('sidecar call resolves with the response that has the matching id', async () => {
  const adapter = fixtureAdapter('reverse');
  try {
    // The fixture answers the second request first, so only the id can pair each response with its call.
    const [first, second] = await Promise.all([adapter.status(), adapter.follow('42')]);
    assert.deepEqual(first, { method: 'status', params: {} });
    assert.deepEqual(second, { method: 'follow', params: { userId: '42' } });
  } finally {
    await adapter.close();
  }
});

test('a checkpoint from the sidecar becomes CHECKPOINT', async () => {
  const adapter = fixtureAdapter('error:checkpoint');
  try {
    await assertKind(adapter.status(), 'CHECKPOINT');
  } finally {
    await adapter.close();
  }
});

test('sidecar kinds map to IgError kinds, and an unknown kind fails closed', async () => {
  const cases = [
    ['checkpoint', 'CHECKPOINT'],
    ['challenge', 'CHECKPOINT'],
    ['two_factor', 'CHECKPOINT'],
    ['auth_expired', 'AUTH_EXPIRED'],
    ['rate_limited', 'RATE_LIMITED'],
    ['action_blocked', 'ACTION_BLOCKED'],
    ['api_error', 'UNOFFICIAL_ADAPTER_ERROR'],
    ['bad_request', 'UNOFFICIAL_ADAPTER_ERROR'],
    ['no_such_kind', 'UNOFFICIAL_ADAPTER_ERROR'],
    ['constructor', 'UNOFFICIAL_ADAPTER_ERROR'],
    ['__proto__', 'UNOFFICIAL_ADAPTER_ERROR'],
    ['', 'UNOFFICIAL_ADAPTER_ERROR'],
  ];
  for (const [sidecarKind, igKind] of cases) {
    const adapter = fixtureAdapter(`error:${sidecarKind}`);
    try {
      await assertKind(adapter.status(), igKind);
    } finally {
      await adapter.close();
    }
  }
});

test('timeout kills the child and rejects with UNOFFICIAL_ADAPTER_ERROR', async () => {
  const adapter = fixtureAdapter('silent', 200);
  const pending = adapter.status();
  const pid = adapter.pid();
  assert.equal(typeof pid, 'number', 'the child is running while the call is pending');
  await assertKind(pending, 'UNOFFICIAL_ADAPTER_ERROR');
  assert.equal(adapter.pid(), null, 'the adapter forgets the killed child');
  await waitUntilGone(pid);
});

test('a malformed JSON line from the child rejects the pending call with UNOFFICIAL_ADAPTER_ERROR', async () => {
  const adapter = fixtureAdapter('garbage');
  try {
    await assertKind(adapter.status(), 'UNOFFICIAL_ADAPTER_ERROR');
    assert.equal(adapter.pid(), null, 'the adapter kills the child whose output cannot be trusted');
  } finally {
    await adapter.close();
  }
});

test('a child exit rejects all pending calls', async () => {
  const adapter = fixtureAdapter('exit');
  try {
    const first = adapter.status();
    const second = adapter.follow('42');
    await assertKind(first, 'UNOFFICIAL_ADAPTER_ERROR');
    await assertKind(second, 'UNOFFICIAL_ADAPTER_ERROR');
  } finally {
    await adapter.close();
  }
});

test('a child that cannot start rejects with UNOFFICIAL_ADAPTER_ERROR, and names the executable', async () => {
  const adapter = createSidecarAdapter({ command: 'ig-sidecar-no-such-command', args: [], timeoutMs: LIMIT_MS });
  try {
    const error = await adapter.status().catch((caught) => caught);
    assert.ok(error instanceof IgError);
    assert.equal(error.kind, 'UNOFFICIAL_ADAPTER_ERROR');
    assert.match(error.message, /could not be started/);
    assert.match(error.message, /ig-sidecar-no-such-command/);
    assert.equal(error.details.sidecarStart, 'failed');
  } finally {
    await adapter.close();
  }
});

// The variables the child may see. Any other variable of the parent, such as IG_ ones or an ordinary one, is left out.
const CHILD_ALLOWLIST = new Set([
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

test('the child starts on first use, and it is given only the allowlisted variables', async () => {
  const adapter = fixtureAdapter('env');
  assert.equal(adapter.pid(), null, 'no child before the first call');
  process.env.IG_SIDECAR_TEST_SECRET = 'do-not-pass';
  process.env.SIDECAR_TEST_OTHER = 'do-not-pass-either';
  try {
    const { names } = await adapter.status();
    assert.ok(!names.some((name) => name.toUpperCase().startsWith('IG_')), 'the child sees no IG_ variable');
    assert.ok(!names.some((name) => name.toUpperCase() === 'SIDECAR_TEST_OTHER'), 'an ordinary variable is not passed');
    // On Windows the runtime adds these system names to any child, whatever env it is given (probed on Node 24.6.0). They are
    // not secrets and not IG_ variables, so they are the only names allowed beyond the allowlist.
    const windowsRuntimeNames = new Set(['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN', 'USERNAME', 'WINDIR']);
    for (const name of names) {
      const upper = name.toUpperCase();
      const allowed = CHILD_ALLOWLIST.has(upper) || (process.platform === 'win32' && windowsRuntimeNames.has(upper));
      assert.ok(allowed, `${name} is not on the child allowlist`);
    }
    assert.ok(
      names.some((name) => name.toUpperCase() === 'PATH'),
      'PATH is passed, so the child can run',
    );
    assert.equal(typeof adapter.pid(), 'number', 'the child runs after the first call');
  } finally {
    delete process.env.IG_SIDECAR_TEST_SECRET;
    delete process.env.SIDECAR_TEST_OTHER;
    await adapter.close();
  }
});

test('the adapter methods send the sidecar method names and params', async () => {
  const adapter = fixtureAdapter();
  try {
    assert.deepEqual(
      await adapter.login({ username: 'owner', password: 'pw', verificationCode: '123456' }),
      { method: 'login', params: { username: 'owner', password: 'pw', verificationCode: '123456' } },
    );
    assert.deepEqual(
      await adapter.restoreSession({ sessionid: 'x' }),
      { method: 'restore_session', params: { session: { sessionid: 'x' } } },
    );
    assert.deepEqual(await adapter.follow('42'), { method: 'follow', params: { userId: '42' } });
    assert.deepEqual(await adapter.unfollow('42'), { method: 'unfollow', params: { userId: '42' } });
    assert.deepEqual(
      await adapter.profileEdit({ biography: 'hi' }),
      { method: 'profile_edit', params: { fields: { biography: 'hi' } } },
    );
    assert.deepEqual(await adapter.status(), { method: 'status', params: {} });
  } finally {
    await adapter.close();
  }
});

test('calls after close reject with UNOFFICIAL_ADAPTER_ERROR', async () => {
  const adapter = fixtureAdapter();
  await adapter.close();
  await assertKind(adapter.status(), 'UNOFFICIAL_ADAPTER_ERROR');
});

test('createSidecarAdapter refuses a missing command, bad args and a timeout the timer cannot hold', () => {
  assert.throws(() => createSidecarAdapter({ command: '' }), TypeError);
  assert.throws(() => createSidecarAdapter({ command: 'python', args: 'ig_sidecar.py' }), TypeError);
  assert.throws(() => createSidecarAdapter({ command: 'python', timeoutMs: 0 }), TypeError);
  assert.throws(() => createSidecarAdapter({ command: 'python', timeoutMs: 2147483648 }), TypeError);
});

test('the adapter has no call property, so every request goes through a typed method', async () => {
  const adapter = fixtureAdapter();
  try {
    assert.equal(Object.hasOwn(adapter, 'call'), false);
    assert.equal(adapter.call, undefined);
  } finally {
    await adapter.close();
  }
});

test('ok:true with no result rejects with UNOFFICIAL_ADAPTER_ERROR', async () => {
  const adapter = fixtureAdapter('reply:none');
  try {
    await assertKind(adapter.status(), 'UNOFFICIAL_ADAPTER_ERROR');
    await assertKind(adapter.login({ username: 'owner', password: 'pw' }), 'UNOFFICIAL_ADAPTER_ERROR');
  } finally {
    await adapter.close();
  }
});

test('ok:true with a null result rejects with UNOFFICIAL_ADAPTER_ERROR', async () => {
  const adapter = fixtureAdapter('reply:null');
  try {
    await assertKind(adapter.status(), 'UNOFFICIAL_ADAPTER_ERROR');
  } finally {
    await adapter.close();
  }
});

test('ok:true with a string result rejects with UNOFFICIAL_ADAPTER_ERROR', async () => {
  const adapter = fixtureAdapter('reply:string');
  try {
    await assertKind(adapter.status(), 'UNOFFICIAL_ADAPTER_ERROR');
  } finally {
    await adapter.close();
  }
});

test('ok:true with an object result resolves', async () => {
  const adapter = fixtureAdapter('reply:object');
  try {
    assert.deepEqual(await adapter.status(), { method: 'status', params: {} });
  } finally {
    await adapter.close();
  }
});

test('ok:false with no error object rejects with UNOFFICIAL_ADAPTER_ERROR', async () => {
  const adapter = fixtureAdapter('reply:error-no-object');
  try {
    await assertKind(adapter.status(), 'UNOFFICIAL_ADAPTER_ERROR');
  } finally {
    await adapter.close();
  }
});

test('ok:false with an error object that has no kind rejects with UNOFFICIAL_ADAPTER_ERROR', async () => {
  const adapter = fixtureAdapter('reply:error-no-kind');
  try {
    await assertKind(adapter.status(), 'UNOFFICIAL_ADAPTER_ERROR');
  } finally {
    await adapter.close();
  }
});

test('a reply whose ok is not a boolean rejects with UNOFFICIAL_ADAPTER_ERROR', async () => {
  const adapter = fixtureAdapter('reply:ok-not-boolean');
  try {
    await assertKind(adapter.status(), 'UNOFFICIAL_ADAPTER_ERROR');
  } finally {
    await adapter.close();
  }
});

test('a login reply registers its session strings before the caller sees them', async () => {
  const adapter = fixtureAdapter('session');
  try {
    // The short and blank strings cannot be registered, and they do not fail the login.
    const settings = await adapter.login({ username: 'owner', password: 'pw' });
    assert.equal(settings.sessionid, SESSION_TOKEN);
    assert.equal(settings.short, 'ab');
    for (const value of [SESSION_TOKEN, 'DS-VALUE-1234', 'LIST-VALUE-5678']) {
      assert.equal(redact(`text ${value} end`).includes(value), false, `redact masks ${value}`);
    }
    // A later failure whose message repeats the token carries no copy of it.
    const error = await adapter.status().catch((caught) => caught);
    assert.ok(error instanceof IgError);
    assert.equal(error.kind, 'UNOFFICIAL_ADAPTER_ERROR');
    assert.equal(error.message.includes(SESSION_TOKEN), false);
  } finally {
    await adapter.close();
  }
});

test('a restore reply registers its session strings too', async () => {
  const adapter = fixtureAdapter('session');
  try {
    const settings = await adapter.restoreSession({ sessionid: 'stored' });
    assert.equal(settings.sessionid, RESTORE_TOKEN);
    assert.equal(redact(`text ${RESTORE_TOKEN} end`).includes(RESTORE_TOKEN), false);
  } finally {
    await adapter.close();
  }
});

test('a session string with a trailing newline is returned trimmed, and its bare value is masked', async () => {
  const adapter = fixtureAdapter('session');
  try {
    const settings = await adapter.login({ username: 'owner', password: 'pw' });
    assert.equal(settings.padded, PADDED_TOKEN);
    assert.equal(redact(`text ${PADDED_TOKEN} end`).includes(PADDED_TOKEN), false);
  } finally {
    await adapter.close();
  }
});

test('a session string that cannot be registered rejects with UNOFFICIAL_ADAPTER_ERROR, and no session is returned', async () => {
  const adapter = fixtureAdapter('surrogate');
  try {
    await assert.rejects(adapter.login({ username: 'owner', password: 'pw' }), (error) => (
      error instanceof IgError && error.kind === 'UNOFFICIAL_ADAPTER_ERROR' && !error.message.includes('SURROGATE')
    ));
  } finally {
    await adapter.close();
  }
});

test('jslib adapter refuses every call with NOT_SUPPORTED', async () => {
  const adapter = createJsLibAdapter();
  const message = 'no JavaScript unofficial library is in use; the instagrapi sidecar is the unofficial route';
  const calls = [
    () => adapter.login({ username: 'owner', password: 'pw' }),
    () => adapter.restoreSession({}),
    () => adapter.follow('42'),
    () => adapter.unfollow('42'),
    () => adapter.profileEdit({ biography: 'hi' }),
    () => adapter.status(),
    () => adapter.close(),
  ];
  for (const call of calls) {
    await assert.rejects(call(), (error) => error instanceof IgError && error.kind === 'NOT_SUPPORTED' && error.message === message);
  }
});

test('registry throws NOT_SUPPORTED for an unmapped feature', () => {
  const registry = createAdapterRegistry({
    adapters: { jslib: createJsLibAdapter() },
    byFeature: { follow: 'jslib' },
  });
  assert.throws(() => registry.forFeature('like'), (error) => error instanceof IgError && error.kind === 'NOT_SUPPORTED');
  assert.throws(() => registry.forFeature('constructor'), (error) => error instanceof IgError && error.kind === 'NOT_SUPPORTED');
});

test('registry returns the adapter mapped to a feature, and refuses a mapping to an unregistered adapter', () => {
  const jslib = createJsLibAdapter();
  const registry = createAdapterRegistry({ adapters: { jslib }, byFeature: { follow: 'jslib', unfollow: 'missing' } });
  assert.equal(registry.forFeature('follow'), jslib);
  assert.throws(() => registry.forFeature('unfollow'), (error) => error instanceof IgError && error.kind === 'NOT_SUPPORTED');
});

// A-30 (final review). The line splitter slices the buffer once per chunk, not once per line.
test('splitLines splits a large reply of many lines and keeps the unfinished tail', () => {
  const lines = Array.from({ length: 20000 }, (_, index) => JSON.stringify({ id: index + 1, ok: true, result: { index } }));
  const { lines: complete, rest } = splitLines('', `${lines.join('\n')}\n{"id":20001,"ok":`);
  assert.equal(complete.length, 20000);
  assert.equal(complete[0], lines[0]);
  assert.equal(complete[19999], lines[19999]);
  assert.equal(rest, '{"id":20001,"ok":');
});

test('splitLines removes a carriage return at the end of a line', () => {
  assert.deepStrictEqual(splitLines('', 'first\r\nsecond\n').lines, ['first', 'second']);
});

test('splitLines keeps the buffer to one line, however many lines a stream holds', () => {
  const line = JSON.stringify({ id: 7, ok: true, result: { text: 'x'.repeat(40) } });
  const stream = `${Array.from({ length: 5000 }, () => line).join('\n')}\n`;
  let buffer = '';
  let count = 0;
  let longest = 0;
  for (let start = 0; start < stream.length; start += 7) {
    const { lines, rest } = splitLines(buffer, stream.slice(start, start + 7));
    buffer = rest;
    count += lines.length;
    longest = Math.max(longest, buffer.length);
  }
  assert.equal(count, 5000);
  assert.ok(longest <= line.length, `the buffer reached ${longest} characters; one line is ${line.length}`);
});

test('a registered value that straddles character 200 of the last stderr line is masked whole (S-L1)', async () => {
  const secret = 'STRADDLE-SECRET-0123456789';
  registerSecret(secret);
  // The secret starts at character 180 and runs past character 200, so a cut before the redaction would split it.
  const adapter = fixtureAdapter(`stderr:${'x'.repeat(180)}${secret}`);
  try {
    const error = await adapter.status().catch((caught) => caught);
    assert.ok(error instanceof IgError);
    assert.equal(error.kind, 'UNOFFICIAL_ADAPTER_ERROR');
    for (const part of ['STRADDLE', 'SECRET', '0123456789']) {
      assert.equal(error.message.includes(part), false, `the message holds no part of the secret: ${part}`);
    }
  } finally {
    await adapter.close();
  }
});

test('an error from the sidecar keeps its sidecar kind in the details, so a two-factor request can be told apart', async () => {
  const adapter = fixtureAdapter('error:two_factor');
  try {
    const error = await adapter.status().catch((caught) => caught);
    assert.ok(error instanceof IgError);
    assert.equal(error.kind, 'CHECKPOINT');
    assert.equal(error.details.sidecarKind, 'two_factor');
  } finally {
    await adapter.close();
  }
});

test('a registered session value that straddles the 1000-character cut of stderr is masked, with no part left', async () => {
  const secret = 'SECRET-STRADDLE-0123456789';
  registerSecret(secret);
  // The line is 1110 characters, and the secret runs from character 100 to 126. The old cut kept the last 1000 characters, so it began at
  // character 110, inside the secret.
  const line = `${'x'.repeat(100)}${secret}${'z'.repeat(984)}`;
  assert.equal(line.length, 1110);
  const adapter = fixtureAdapter(`stderr:${line}`);
  try {
    const error = await adapter.status().catch((caught) => caught);
    assert.ok(error instanceof IgError);
    assert.equal(error.kind, 'UNOFFICIAL_ADAPTER_ERROR');
    assert.ok(error.message.includes('[redacted]'), 'the secret is masked in the displayed line');
    for (const part of ['SECRET-STRADDLE', 'STRADDLE', 'SECRET-S', '0123456789']) {
      assert.equal(error.message.includes(part), false, `the message holds no part of the secret: ${part}`);
    }
  } finally {
    await adapter.close();
  }
});

test('a stderr line longer than the line limit is not shown, and no part of it is', async () => {
  const line = 'L'.repeat(9000);
  const adapter = fixtureAdapter(`stderr:${line}`);
  try {
    const error = await adapter.status().catch((caught) => caught);
    assert.ok(error instanceof IgError);
    assert.match(error.message, /not shown/);
    assert.equal(error.message.includes('L'.repeat(10)), false);
  } finally {
    await adapter.close();
  }
});

test('a sidecar that exits before its first reply gives UNOFFICIAL_ADAPTER_ERROR, and is marked as not started (F2-M-6)', async () => {
  const adapter = fixtureAdapter('exit');
  try {
    const error = await adapter.status().catch((caught) => caught);
    assert.ok(error instanceof IgError);
    assert.equal(error.kind, 'UNOFFICIAL_ADAPTER_ERROR');
    assert.equal(error.details.sidecarStart, 'failed');
  } finally {
    await adapter.close();
  }
});

test('a sidecar that exits after it has answered is an ordinary failure, and is not marked as not started', async () => {
  const adapter = fixtureAdapter('once-then-exit');
  try {
    assert.deepEqual(await adapter.status(), { method: 'status', params: {} });
    const error = await adapter.follow('42').catch((caught) => caught);
    assert.ok(error instanceof IgError);
    assert.equal(error.kind, 'UNOFFICIAL_ADAPTER_ERROR');
    assert.equal(error.details.sidecarStart, undefined);
  } finally {
    await adapter.close();
  }
});

test('an unavailable reply from the sidecar gives UNOFFICIAL_ADAPTER_ERROR, and marks the session as not started', async () => {
  const adapter = fixtureAdapter('error:unavailable');
  try {
    const error = await adapter.status().catch((caught) => caught);
    assert.ok(error instanceof IgError);
    assert.equal(error.kind, 'UNOFFICIAL_ADAPTER_ERROR');
    assert.equal(error.details.sidecarKind, 'unavailable');
    assert.equal(error.details.sidecarStart, 'failed');
  } finally {
    await adapter.close();
  }
});
