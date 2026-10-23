// The unofficial route's login and restore. Every test uses injected fakes: a secret store, the sidecar adapter, the prompts and the
// serve lock. No child process is started (the Python sidecar never runs here), and there is no socket and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAudit } from '../src/audit.js';
import { ACK_KEY, PROJECT_ROOT, buildServe, createLineSource, runRoutesLoginUnofficial, runServe } from '../src/cli.js';
import { loadConfig } from '../src/config.js';
import { IgError } from '../src/errors.js';
import { createState } from '../src/state.js';
import { createSidecarAdapter } from '../src/unofficial/sidecar.js';
import { createAdapterRegistry } from '../src/unofficial/adapter.js';
import {
  UNOFFICIAL_SESSION,
  UNOFFICIAL_STOP_KEY,
  UNOFFICIAL_USERNAME,
  registerPassword,
  sidecarCommand,
  unofficialRouteStop,
} from '../src/unofficial-session.js';

const NOW = Date.parse('2026-10-23T09:00:00.000Z');
const PASSWORD = 'PASSWORD-VALUE-9988';
const USERNAME = 'owner-account';
const SESSION = { sessionid: 'SESSION-VALUE-4411', cookies: { ds: 'DS-VALUE-5522' }, uuids: { phone: 'UUID-VALUE-6633' } };
const FOLLOWER = '17841400000000002';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-unofficial-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A config with the unofficial route enabled. The acknowledgement comes from the state, as it does for the service.
function configFrom(t, unofficial = {}) {
  const dir = tempDir(t);
  const file = join(dir, 'config.json');
  const base = {
    owner: { igUserId: '17841400000000001', accountType: 'business' },
    app: { id: '990602627938098' },
    dataDir: tempDir(t),
    routes: {
      // No adapterByFeature here: the config has no mapping unless a test sets one, so the defaults apply.
      unofficial: { enabled: true, acknowledged: false, ...unofficial },
      likes: { loginProduct: 'instagram' },
    },
  };
  writeFileSync(file, JSON.stringify(base));
  return loadConfig({ env: {}, file });
}

// A secret store over a plain object. failSetFor names an entry whose set throws, to test the rollback.
function fakeSecrets(values = {}, { failSetFor = null } = {}) {
  return {
    values,
    get(name) {
      return values[name] ?? null;
    },
    set(name, value) {
      if (name === failSetFor) throw new IgError('CONFIG', `the keyring refused to store ${name}`);
      values[name] = value;
    },
    remove(name) {
      delete values[name];
      return true;
    },
    source(name) {
      return values[name] === undefined ? 'none' : 'keyring';
    },
  };
}

// A sidecar adapter stand-in. Each call is recorded. The behaviour is given per method.
function fakeAdapter({ login, restore } = {}) {
  const calls = { login: [], restore: [], follow: [], closed: 0 };
  return {
    calls,
    async login(input) {
      calls.login.push(input);
      return login ? login(input, calls.login.length) : SESSION;
    },
    async restoreSession(session) {
      calls.restore.push(session);
      return restore ? restore(session) : {};
    },
    async follow(userId) {
      calls.follow.push(userId);
      return { ok: true };
    },
    async unfollow() {
      return { ok: true };
    },
    async profileEdit() {
      return { edited: [] };
    },
    async status() {
      return { loggedIn: true };
    },
    async close() {
      calls.closed += 1;
    },
  };
}

// Prompts stand-in. Each prompt returns its value, and the calls are counted.
function fakePrompts({ username = USERNAME, password = PASSWORD, code = '' } = {}) {
  const calls = { username: 0, password: 0, verificationCode: 0 };
  return {
    calls,
    async username() {
      calls.username += 1;
      return username;
    },
    async password() {
      calls.password += 1;
      return password;
    },
    async verificationCode() {
      calls.verificationCode += 1;
      return code;
    },
  };
}

function collector() {
  const lines = [];
  const out = (text) => lines.push(text);
  out.text = () => lines.join('\n');
  return out;
}

function allFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...allFiles(path));
    else found.push(path);
  }
  return found;
}

// A data directory with the acknowledgement stored (when asked), and a stop (when given), and the state file saved.
async function dataDirWith(t, { acknowledged = true, stop = null } = {}) {
  const dataDir = tempDir(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  if (acknowledged) state.set(ACK_KEY, true);
  if (stop !== null) state.set(UNOFFICIAL_STOP_KEY, stop);
  state.save();
  return dataDir;
}

const absent = async () => 'absent';

// A built service over the fakes. The sidecar maker returns the fake adapter, so no child process is started.
async function builtWith(t, { adapter, secrets = fakeSecrets(), acknowledged = true, stop = null, config = configFrom(t), env = {} } = {}) {
  const dataDir = await dataDirWith(t, { acknowledged, stop });
  const built = await buildServe({
    config,
    secrets,
    dataDir,
    env,
    now: () => NOW,
    makeSidecar: () => adapter,
  });
  return { built, dataDir };
}

// ----- ig routes login-unofficial -----

test('routes login-unofficial refuses without the acknowledgement, and reads no prompt and starts no login', async (t) => {
  const dataDir = await dataDirWith(t, { acknowledged: false });
  const state = await createState({ file: join(dataDir, 'state.json') });
  const adapter = fakeAdapter();
  const prompts = fakePrompts();
  const secrets = fakeSecrets();
  await assert.rejects(
    runRoutesLoginUnofficial({ config: configFrom(t), secrets, state, audit: createAudit({ file: join(dataDir, 'audit.jsonl') }), dataDir, prompts, adapter, serveLock: absent }),
    (err) => err instanceof IgError && err.kind === 'ROUTE_DISABLED',
  );
  assert.deepEqual(prompts.calls, { username: 0, password: 0, verificationCode: 0 });
  assert.equal(adapter.calls.login.length, 0);
  assert.deepEqual(secrets.values, {});
});

test('routes login-unofficial refuses while a serve holds the lock, before any prompt', async (t) => {
  const dataDir = await dataDirWith(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  const prompts = fakePrompts();
  await assert.rejects(
    runRoutesLoginUnofficial({
      config: configFrom(t),
      secrets: fakeSecrets(),
      state,
      audit: createAudit({ file: join(dataDir, 'audit.jsonl') }),
      dataDir,
      prompts,
      adapter: fakeAdapter(),
      serveLock: async () => 'running',
    }),
    (err) => err instanceof IgError && err.kind === 'CONFIG',
  );
  assert.equal(prompts.calls.username, 0);
});

test('a password is never in any output, and the login stores the session and the username under their names', async (t) => {
  const dataDir = await dataDirWith(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  const adapter = fakeAdapter();
  const secrets = fakeSecrets();
  const out = collector();
  const result = await runRoutesLoginUnofficial({
    config: configFrom(t),
    secrets,
    state,
    audit: createAudit({ file: join(dataDir, 'audit.jsonl') }),
    dataDir,
    prompts: fakePrompts(),
    adapter,
    out,
    serveLock: absent,
  });
  assert.equal(result, 'stored');
  assert.equal(adapter.calls.login[0].password, PASSWORD, 'the password goes to the sidecar and nowhere else');
  assert.equal(adapter.calls.closed, 0, 'the caller closes the adapter, not the login');
  assert.equal(out.text().includes(PASSWORD), false, 'the output holds no password');
  assert.equal(out.text().includes('SESSION-VALUE'), false, 'the output holds no session');
  assert.equal(JSON.parse(secrets.values[UNOFFICIAL_SESSION]).sessionid, SESSION.sessionid);
  assert.equal(JSON.parse(secrets.values[UNOFFICIAL_USERNAME]).username, USERNAME);
  assert.deepEqual(secrets.values.owner_token, undefined, 'the official token is not touched');
});

test('a login that fails with the password in its message prints none of it, and stores nothing', async (t) => {
  const dataDir = await dataDirWith(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  const adapter = fakeAdapter({
    login: () => {
      throw new IgError('UNOFFICIAL_ADAPTER_ERROR', `the sidecar refused the request for ${PASSWORD}`);
    },
  });
  const secrets = fakeSecrets();
  const out = collector();
  await assert.rejects(
    runRoutesLoginUnofficial({
      config: configFrom(t),
      secrets,
      state,
      audit: createAudit({ file: join(dataDir, 'audit.jsonl') }),
      dataDir,
      prompts: fakePrompts(),
      adapter,
      out,
      serveLock: absent,
    }),
    (err) => err instanceof IgError && err.kind === 'UNOFFICIAL_ADAPTER_ERROR' && !err.message.includes(PASSWORD),
  );
  assert.deepEqual(secrets.values, {});
  assert.equal(out.text().includes(PASSWORD), false);
});

test('the session is stored under unofficial_session, and no file of the data directory holds it', async (t) => {
  const dataDir = await dataDirWith(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  const secrets = fakeSecrets();
  await runRoutesLoginUnofficial({
    config: configFrom(t),
    secrets,
    state,
    audit: createAudit({ file: join(dataDir, 'audit.jsonl') }),
    dataDir,
    prompts: fakePrompts(),
    adapter: fakeAdapter(),
    out: () => {},
    serveLock: absent,
  });
  assert.ok(secrets.values[UNOFFICIAL_SESSION].includes('SESSION-VALUE-4411'), 'the keyring entry holds the session');
  for (const file of allFiles(dataDir)) {
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes('SESSION-VALUE-4411'), false, `${file} holds no session value`);
    assert.equal(text.includes('DS-VALUE-5522'), false, `${file} holds no cookie value`);
    assert.equal(text.includes(PASSWORD), false, `${file} holds no password`);
  }
});

test('a successful login clears a route stop left by an earlier failure', async (t) => {
  const stop = { kind: 'AUTH_EXPIRED', detail: 'AUTH_EXPIRED: the session has expired', since: '2026-10-22T10:00:00.000Z' };
  const dataDir = await dataDirWith(t, { stop });
  const state = await createState({ file: join(dataDir, 'state.json') });
  assert.equal(unofficialRouteStop(state)?.kind, 'AUTH_EXPIRED');
  await runRoutesLoginUnofficial({
    config: configFrom(t),
    secrets: fakeSecrets(),
    state,
    audit: createAudit({ file: join(dataDir, 'audit.jsonl') }),
    dataDir,
    prompts: fakePrompts(),
    adapter: fakeAdapter(),
    out: () => {},
    serveLock: absent,
  });
  assert.equal(unofficialRouteStop(state), null);
  assert.equal((await createState({ file: join(dataDir, 'state.json') })).get(UNOFFICIAL_STOP_KEY, null), null, 'the clear is saved');
});

test('a two-factor request asks for the code once, and logs in with it', async (t) => {
  const dataDir = await dataDirWith(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  const adapter = fakeAdapter({
    login: (input, attempt) => {
      if (attempt === 1) throw new IgError('CHECKPOINT', 'two-factor code needed', { sidecarKind: 'two_factor' });
      return SESSION;
    },
  });
  const prompts = fakePrompts({ code: '123456' });
  const secrets = fakeSecrets();
  await runRoutesLoginUnofficial({
    config: configFrom(t),
    secrets,
    state,
    audit: createAudit({ file: join(dataDir, 'audit.jsonl') }),
    dataDir,
    prompts,
    adapter,
    out: () => {},
    serveLock: absent,
  });
  assert.equal(prompts.calls.verificationCode, 1);
  assert.equal(adapter.calls.login.length, 2);
  assert.equal(adapter.calls.login[1].verificationCode, '123456');
  assert.ok(secrets.values[UNOFFICIAL_SESSION]);
});

test('a checkpoint that is not two-factor stores nothing, and asks for no code', async (t) => {
  const dataDir = await dataDirWith(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  const prompts = fakePrompts({ code: '123456' });
  const secrets = fakeSecrets();
  await assert.rejects(
    runRoutesLoginUnofficial({
      config: configFrom(t),
      secrets,
      state,
      audit: createAudit({ file: join(dataDir, 'audit.jsonl') }),
      dataDir,
      prompts,
      adapter: fakeAdapter({
        login: () => {
          throw new IgError('CHECKPOINT', 'a challenge needs the owner', { sidecarKind: 'challenge' });
        },
      }),
      out: () => {},
      serveLock: absent,
    }),
    (err) => err instanceof IgError && err.kind === 'CHECKPOINT' && err.message.includes('nothing was stored'),
  );
  assert.equal(prompts.calls.verificationCode, 0);
  assert.deepEqual(secrets.values, {});
});

test('a password under 8 characters is refused before it is sent', async (t) => {
  const dataDir = await dataDirWith(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  const adapter = fakeAdapter();
  await assert.rejects(
    runRoutesLoginUnofficial({
      config: configFrom(t),
      secrets: fakeSecrets(),
      state,
      audit: createAudit({ file: join(dataDir, 'audit.jsonl') }),
      dataDir,
      prompts: fakePrompts({ password: 'short' }),
      adapter,
      out: () => {},
      serveLock: absent,
    }),
    (err) =>
      err instanceof IgError &&
      err.kind === 'VALIDATION' &&
      // The refusal must not echo the password it refuses (F2-M-9).
      !err.message.includes('short'),
  );
  assert.equal(adapter.calls.login.length, 0);
});

test('a keyring write that fails puts the previous session back, and removes the new username', async (t) => {
  const dataDir = await dataDirWith(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  const previous = JSON.stringify({ sessionid: 'OLD-SESSION-VALUE-7788' });
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: previous }, { failSetFor: UNOFFICIAL_USERNAME });
  await assert.rejects(
    runRoutesLoginUnofficial({
      config: configFrom(t),
      secrets,
      state,
      audit: createAudit({ file: join(dataDir, 'audit.jsonl') }),
      dataDir,
      prompts: fakePrompts(),
      adapter: fakeAdapter(),
      out: () => {},
      serveLock: absent,
    }),
    (err) => err instanceof IgError && err.kind === 'CONFIG' && err.message.includes('nothing is stored'),
  );
  assert.equal(secrets.values[UNOFFICIAL_SESSION], previous, 'the previous session is in place again');
  assert.equal(secrets.values[UNOFFICIAL_USERNAME], undefined, 'no username was stored');
});

test('the password is registered before it is used, so a registered password is masked in an error', () => {
  assert.throws(() => registerPassword('short'), (err) => err instanceof IgError && err.kind === 'VALIDATION');
  assert.equal(registerPassword(PASSWORD), PASSWORD);
});

test('the prompt lines of a piped input come in order, and a missing line is blank', async () => {
  const { Readable } = await import('node:stream');
  const lines = createLineSource(Readable.from(['owner\r\nsecret-pass\n']));
  assert.equal(await lines.next(), 'owner');
  assert.equal(await lines.next(), 'secret-pass');
  assert.equal(await lines.next(), '');
});

// ----- serve: restore and the route stop -----

test('serve restores the stored session with the stored object, and the route is not stopped', async (t) => {
  const adapter = fakeAdapter();
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: JSON.stringify(SESSION) });
  const { built } = await builtWith(t, { adapter, secrets });
  assert.equal(built.unofficialRestore.status, 'restored');
  assert.deepEqual(adapter.calls.restore, [SESSION]);
  assert.equal(unofficialRouteStop(built.state), null);
});

test('serve does not restore a stored session when the route is not acknowledged', async (t) => {
  const adapter = fakeAdapter();
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: JSON.stringify(SESSION) });
  const { built } = await builtWith(t, { adapter, secrets, acknowledged: false });
  assert.equal(built.unofficialRestore.status, 'skipped');
  assert.equal(adapter.calls.restore.length, 0);
});

test('serve does nothing for the unofficial route when no session is stored', async (t) => {
  const adapter = fakeAdapter();
  const { built } = await builtWith(t, { adapter, secrets: fakeSecrets() });
  assert.equal(built.unofficialRestore.status, 'skipped');
  assert.equal(adapter.calls.restore.length, 0);
  assert.equal(unofficialRouteStop(built.state), null);
});

test('a failed restore stops only the unofficial route: the account stop and the official routes are not touched', async (t) => {
  const adapter = fakeAdapter({
    restore: () => {
      throw new IgError('AUTH_EXPIRED', 'the session has expired');
    },
  });
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: JSON.stringify(SESSION) });
  const { built } = await builtWith(t, { adapter, secrets });
  assert.equal(built.unofficialRestore.status, 'failed');
  assert.equal(built.state.get(UNOFFICIAL_STOP_KEY, null).kind, 'AUTH_EXPIRED');
  assert.equal(built.guard.stopStatus().stopped, false, 'the account stop is not set');
  assert.doesNotThrow(() => built.guard.assertNotStopped());
  const refused = await built.service.follow({ userId: FOLLOWER, confirm: true }).catch((err) => err);
  assert.ok(refused instanceof IgError);
  assert.equal(refused.kind, 'STOPPED');
  assert.equal(refused.details.kind, 'AUTH_EXPIRED');
  assert.equal(refused.details.route, 'unofficial');
  assert.equal(adapter.calls.follow.length, 0, 'no follow reaches the sidecar');
  await built.service.tokenStatus();
});

test('a restore that succeeds clears a stop left by an earlier failure, and follow is no longer refused for it', async (t) => {
  const stop = { kind: 'AUTH_EXPIRED', detail: 'AUTH_EXPIRED: the session has expired', since: '2026-10-22T10:00:00.000Z' };
  const adapter = fakeAdapter();
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: JSON.stringify(SESSION) });
  const { built } = await builtWith(t, { adapter, secrets, stop });
  assert.equal(built.unofficialRestore.status, 'restored');
  assert.equal(unofficialRouteStop(built.state), null);
  const outcome = await built.service.follow({ userId: FOLLOWER, confirm: true }).catch((err) => err);
  assert.equal(outcome instanceof IgError && outcome.kind === 'STOPPED', false, 'the route stop is gone');
});

test('a stored session that cannot be read sets the route stop, and no restore is sent', async (t) => {
  const adapter = fakeAdapter();
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: 'this is not json' });
  const { built } = await builtWith(t, { adapter, secrets });
  assert.equal(built.unofficialRestore.status, 'failed');
  assert.equal(adapter.calls.restore.length, 0);
  assert.equal(unofficialRouteStop(built.state).kind, 'AUTH_EXPIRED');
});

test('a stop value that cannot be read still stops the unofficial route (fail closed)', async (t) => {
  const dataDir = await dataDirWith(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  state.set(UNOFFICIAL_STOP_KEY, 'corrupted');
  assert.equal(unofficialRouteStop(state).kind, 'AUTH_EXPIRED');
});

test('the sidecar command comes from routes.unofficial.python, and IG_PYTHON overrides it; the script is under the project root', async (t) => {
  const config = configFrom(t, { python: 'py-configured' });
  const seen = [];
  const maker = (options) => {
    seen.push(options);
    return fakeAdapter();
  };
  await buildServe({ config, secrets: fakeSecrets(), dataDir: await dataDirWith(t), env: {}, now: () => NOW, makeSidecar: maker });
  await buildServe({ config, secrets: fakeSecrets(), dataDir: await dataDirWith(t), env: { IG_PYTHON: ' py-env ' }, now: () => NOW, makeSidecar: maker });
  assert.equal(seen[0].command, 'py-configured');
  assert.equal(seen[1].command, 'py-env');
  for (const options of seen) assert.equal(options.args[0], join(PROJECT_ROOT, 'sidecar', 'ig_sidecar.py'));
  assert.deepEqual(sidecarCommand({ config, env: {} }).args, [join(PROJECT_ROOT, 'sidecar', 'ig_sidecar.py')]);
});

test('runServe tells the owner to run login-unofficial again after a failed restore', async (t) => {
  const err = collector();
  const dataDir = tempDir(t);
  const handle = await runServe({
    config: configFrom(t),
    secrets: fakeSecrets(),
    dataDir,
    env: {},
    out: () => {},
    err,
    build: async () => ({
      ignoredFileValue: false,
      unofficialRestore: { status: 'failed', stop: { kind: 'AUTH_EXPIRED' } },
    }),
    start: async () => ({ shutdown: async () => {} }),
  });
  assert.ok(handle);
  assert.match(err.text(), /run ig routes login-unofficial again/);
  assert.match(err.text(), /unofficial routes are stopped/);
});

// A missing Python is not an expired login. The executable named here does not exist, so the spawn fails at once and nothing is started.
const MISSING_PYTHON = 'ig-no-such-python-for-test';

test('a missing Python gives UNOFFICIAL_ADAPTER_ERROR, not AUTH_EXPIRED, and the route is not stopped', async (t) => {
  // The features are mapped to the sidecar, as an owner maps them. Without the mapping, follow is NOT_SUPPORTED before any call.
  const config = configFrom(t, { python: MISSING_PYTHON, adapterByFeature: { follow: 'sidecar' } });
  const dataDir = await dataDirWith(t);
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: JSON.stringify(SESSION) });
  // No makeSidecar: the real adapter is used, with the missing executable. It starts no child.
  const built = await buildServe({ config, secrets, dataDir, env: {}, now: () => NOW });
  t.after(() => built.adapters.sidecar.close());
  assert.equal(built.unofficialRestore.status, 'unavailable');
  assert.match(built.unofficialRestore.detail, /could not be started/);
  assert.match(built.unofficialRestore.detail, new RegExp(MISSING_PYTHON));
  assert.equal(unofficialRouteStop(built.state), null, 'a missing executable does not stop the route');
  const refused = await built.service.follow({ userId: FOLLOWER, confirm: true }).catch((err) => err);
  assert.ok(refused instanceof IgError);
  assert.equal(refused.kind, 'UNOFFICIAL_ADAPTER_ERROR');
  assert.notEqual(refused.kind, 'STOPPED');
});

test('a missing Python on the login gives UNOFFICIAL_ADAPTER_ERROR, names the executable, and stores nothing', async (t) => {
  const dataDir = await dataDirWith(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  const adapter = createSidecarAdapter({ command: MISSING_PYTHON, args: [] });
  t.after(() => adapter.close());
  const secrets = fakeSecrets();
  await assert.rejects(
    runRoutesLoginUnofficial({
      config: configFrom(t),
      secrets,
      state,
      audit: createAudit({ file: join(dataDir, 'audit.jsonl') }),
      dataDir,
      prompts: fakePrompts(),
      adapter,
      out: () => {},
      serveLock: absent,
    }),
    (err) => err instanceof IgError && err.kind === 'UNOFFICIAL_ADAPTER_ERROR' && err.message.includes(MISSING_PYTHON),
  );
  assert.deepEqual(secrets.values, {});
});

test('a restore that fails with the sidecar running still gives AUTH_EXPIRED', async (t) => {
  const adapter = fakeAdapter({
    restore: () => {
      throw new IgError('UNOFFICIAL_ADAPTER_ERROR', 'the sidecar reported an error', { sidecarKind: 'api_error' });
    },
  });
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: JSON.stringify(SESSION) });
  const { built } = await builtWith(t, { adapter, secrets });
  assert.equal(built.unofficialRestore.status, 'failed');
  assert.equal(unofficialRouteStop(built.state).kind, 'AUTH_EXPIRED');
  assert.equal(built.guard.stopStatus().stopped, false, 'the account stop is not set');
});

test('runServe says that a sidecar which could not start keeps the stored session, and does not say the login expired', async (t) => {
  const err = collector();
  await runServe({
    config: configFrom(t),
    secrets: fakeSecrets(),
    dataDir: tempDir(t),
    env: {},
    out: () => {},
    err,
    build: async () => ({
      ignoredFileValue: false,
      unofficialRestore: {
        status: 'unavailable',
        detail: `the sidecar could not be started: the executable "${MISSING_PYTHON}" was not found (ENOENT)`,
      },
    }),
    start: async () => ({ shutdown: async () => {} }),
  });
  assert.match(err.text(), /could not be started/);
  assert.match(err.text(), /session is kept/);
  assert.equal(err.text().includes('login-unofficial'), false);
});

// The features map to the sidecar by default, so the owner need not map them. The route is still gated by the acknowledgement and by enabled.
test('with the route enabled and acknowledged and no mapping in the config, follow reaches the sidecar adapter', async (t) => {
  const adapter = fakeAdapter();
  const { built } = await builtWith(t, { adapter, acknowledged: true });
  await built.service.follow({ userId: FOLLOWER, confirm: true });
  assert.deepEqual(adapter.calls.follow, [FOLLOWER]);
});

test('with the route not acknowledged, follow is ROUTE_DISABLED and no adapter is called', async (t) => {
  const adapter = fakeAdapter();
  const { built } = await builtWith(t, { adapter, acknowledged: false });
  const refused = await built.service.follow({ userId: FOLLOWER, confirm: true }).catch((err) => err);
  assert.ok(refused instanceof IgError);
  assert.equal(refused.kind, 'ROUTE_DISABLED');
  assert.equal(adapter.calls.follow.length, 0);
});

test('a config value that maps follow elsewhere still wins over the default', async (t) => {
  const sidecar = fakeAdapter();
  const { built } = await builtWith(t, { adapter: sidecar, config: configFrom(t, { adapterByFeature: { follow: 'jslib' } }) });
  const refused = await built.service.follow({ userId: FOLLOWER, confirm: true }).catch((err) => err);
  assert.ok(refused instanceof IgError);
  assert.equal(refused.kind, 'NOT_SUPPORTED', 'the jslib adapter refuses, as the config asks');
  assert.equal(sidecar.calls.follow.length, 0, 'the sidecar is not used for a feature the config maps elsewhere');
});

test('an unmapped feature still gives NOT_SUPPORTED', (t) => {
  const config = configFrom(t);
  const registry = createAdapterRegistry({
    adapters: { sidecar: fakeAdapter() },
    byFeature: config.routes.unofficial.adapterByFeature,
  });
  assert.equal(registry.forFeature('follow') !== null, true);
  assert.throws(() => registry.forFeature('like'), (err) => err instanceof IgError && err.kind === 'NOT_SUPPORTED');
});

// F2-I-1. The restore needs the switch as well as the acknowledgement. The fixture is a Node script that stands in for the sidecar. The
// Python sidecar is never started here.
const FAKE_SIDECAR = fileURLToPath(new URL('./fixtures/fake-sidecar.js', import.meta.url));

test('with routes.unofficial.enabled false, serve does not restore a stored session', async (t) => {
  const adapter = fakeAdapter();
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: JSON.stringify(SESSION) });
  const { built } = await builtWith(t, { adapter, secrets, config: configFrom(t, { enabled: false }) });
  assert.equal(built.unofficialRestore.status, 'skipped');
  assert.equal(adapter.calls.restore.length, 0);
});

test('with routes.unofficial.enabled false, no sidecar process is started at serve start; with it on, the restore starts one', async (t) => {
  const makeEchoSidecar = () => {
    const adapter = createSidecarAdapter({ command: process.execPath, args: [FAKE_SIDECAR], timeoutMs: 5000 });
    t.after(() => adapter.close());
    return adapter;
  };
  const secrets = () => fakeSecrets({ [UNOFFICIAL_SESSION]: JSON.stringify(SESSION) });
  const off = await buildServe({
    config: configFrom(t, { enabled: false }),
    secrets: secrets(),
    dataDir: await dataDirWith(t),
    env: {},
    now: () => NOW,
    makeSidecar: makeEchoSidecar,
  });
  assert.equal(off.unofficialRestore.status, 'skipped');
  assert.equal(off.adapters.sidecar.pid(), null, 'the switch is off, so no child process was started');

  // The positive control: the same stored session, with the switch on, starts the child and restores.
  const on = await buildServe({
    config: configFrom(t),
    secrets: secrets(),
    dataDir: await dataDirWith(t),
    env: {},
    now: () => NOW,
    makeSidecar: makeEchoSidecar,
  });
  assert.equal(on.unofficialRestore.status, 'restored');
  assert.equal(typeof on.adapters.sidecar.pid(), 'number', 'the child process started for the restore');
});

test('a sidecar that exits before its first reply leaves the route unstopped (unavailable), not AUTH_EXPIRED', async (t) => {
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: JSON.stringify(SESSION) });
  const built = await buildServe({
    config: configFrom(t),
    secrets,
    dataDir: await dataDirWith(t),
    env: {},
    now: () => NOW,
    makeSidecar: () => {
      const adapter = createSidecarAdapter({ command: process.execPath, args: [FAKE_SIDECAR, 'exit'], timeoutMs: 5000 });
      t.after(() => adapter.close());
      return adapter;
    },
  });
  assert.equal(built.unofficialRestore.status, 'unavailable');
  assert.equal(unofficialRouteStop(built.state), null, 'a child that never answered does not stop the route as an expired login');
});

// A restore answered by the sidecar itself, through the Node fixture: "unavailable" (instagrapi is not installed) and another kind.
async function buildWithSidecarReply(t, mode) {
  const secrets = fakeSecrets({ [UNOFFICIAL_SESSION]: JSON.stringify(SESSION) });
  return buildServe({
    config: configFrom(t),
    secrets,
    dataDir: await dataDirWith(t),
    env: {},
    now: () => NOW,
    makeSidecar: () => {
      const adapter = createSidecarAdapter({ command: process.execPath, args: [FAKE_SIDECAR, mode], timeoutMs: 5000 });
      t.after(() => adapter.close());
      return adapter;
    },
  });
}

test('an unavailable reply from restore gives UNOFFICIAL_ADAPTER_ERROR, and sets no route stop', async (t) => {
  const built = await buildWithSidecarReply(t, 'error:unavailable');
  assert.equal(built.unofficialRestore.status, 'unavailable');
  assert.equal(unofficialRouteStop(built.state), null, 'a sidecar without instagrapi is not an expired login');
});

test('a failed restore with another kind still gives AUTH_EXPIRED', async (t) => {
  const built = await buildWithSidecarReply(t, 'error:api_error');
  assert.equal(built.unofficialRestore.status, 'failed');
  assert.equal(unofficialRouteStop(built.state).kind, 'AUTH_EXPIRED');
});
