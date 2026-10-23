import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import * as nodeFsForCli from 'node:fs';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { createAudit } from '../src/audit.js';
import { loadConfig } from '../src/config.js';
import { IgError } from '../src/errors.js';
import { listenHttp } from '../src/http.js';
import { INSTAGRAM_SCOPES, PAGE_LIST_LIMIT, parseRedirect } from '../src/oauth.js';
import { createState } from '../src/state.js';
import {
  ACK_KEY,
  PROJECT_ROOT,
  SERVE_RUNNING_MESSAGE,
  applyAcknowledgement,
  assertServeHost,
  buildServe,
  remoteServeWarning,
  recoverFromAudit,
  recoveryNote,
  makeGraphClient,
  processAlive,
  readServeLock,
  acquireServeLock,
  releaseServeLock,
  serveLockFile,
  readPipedValue,
  resolveConfigFile,
  resolveDataDir,
  runAuthFacebook,
  runAuthLogin,
  runAuthSet,
  runRoutesAck,
  runRoutesClearOneReplyFlag,
  runServe,
  runStatus,
  runTokenCheck,
  startServe,
  takeOverStaleLock,
} from '../src/cli.js';

const BIN = join(PROJECT_ROOT, 'bin', 'ig.js');
const OWNER_ID = '17841400000000001';
const APP_ID = '990602627938098';

// A temporary directory that is removed when the test ends.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A config loaded through loadConfig from a JSON file, with the environment empty.
function configFrom(t, overrides = {}) {
  const dir = tempDir(t);
  const file = join(dir, 'config.json');
  // The data directory is a temporary one, so a login or a serve never writes the project's data folder (P1 fix round).
  const base = { owner: { igUserId: OWNER_ID, accountType: 'business' }, app: { id: APP_ID }, dataDir: tempDir(t) };
  writeFileSync(file, JSON.stringify({ ...base, ...overrides }));
  return loadConfig({ env: {}, file });
}

// A secrets stand-in over a plain object. Nothing reaches the OS keyring.
function fakeSecrets(values = {}) {
  const writes = [];
  const removes = [];
  return {
    writes,
    removes,
    get(name) {
      return values[name] ?? null;
    },
    set(name, value) {
      writes.push(name);
      values[name] = value;
    },
    remove(name) {
      removes.push(name);
      delete values[name];
      return true;
    },
    source(name) {
      return values[name] === undefined ? 'none' : 'keyring';
    },
  };
}

// A state stand-in that records each write.
function fakeState() {
  const data = new Map();
  const log = { sets: [], saves: 0 };
  return {
    log,
    get(key, fallback) {
      return data.has(key) ? data.get(key) : fallback;
    },
    set(key, value) {
      log.sets.push(key);
      data.set(key, value);
    },
    save() {
      log.saves += 1;
    },
  };
}

function collector() {
  const lines = [];
  const out = (text) => lines.push(text);
  out.text = () => lines.join('\n');
  return out;
}

// A serve-lock check that reports no running service, so the login and the routes command run without a lock file.
const absentService = async () => 'absent';

// A fetch stand-in that records each call and answers with the given Response factory.
function recordingFetch(answer = () => new Response('{}', { status: 200 })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  return { calls, fetchImpl };
}

test('ig --help lists auth, serve, mcp and status', () => {
  const run = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(run.status, 0, run.stderr);
  for (const word of ['auth', 'serve', 'mcp', 'status']) {
    assert.match(run.stdout, new RegExp(`\\b${word}\\b`));
  }
});

test('dataDir resolves against the project root, not the working directory', (t) => {
  const cwd = process.cwd();
  t.after(() => process.chdir(cwd));
  process.chdir(tempDir(t));
  assert.equal(resolveDataDir('./data'), resolve(PROJECT_ROOT, 'data'));
  assert.equal(resolveDataDir('data', resolve('/project/root')), resolve('/project/root', 'data'));
  assert.equal(resolveDataDir(resolve(PROJECT_ROOT, 'elsewhere')), resolve(PROJECT_ROOT, 'elsewhere'));
});

test('the config file defaults to IG_CONFIG, then config.json in the project root', () => {
  assert.equal(resolveConfigFile({ option: '/x/cfg.json', env: {}, root: PROJECT_ROOT }), resolve('/x/cfg.json'));
  assert.equal(
    resolveConfigFile({ option: undefined, env: { IG_CONFIG: '/env/cfg.json' }, root: PROJECT_ROOT }),
    resolve('/env/cfg.json'),
  );
  const expected = existsSync(join(PROJECT_ROOT, 'config.json')) ? join(PROJECT_ROOT, 'config.json') : undefined;
  assert.equal(resolveConfigFile({ option: undefined, env: {}, root: PROJECT_ROOT }), expected);
});

test('the unofficial acknowledgement is read from the state, not from the config file', (t) => {
  const config = configFrom(t, { routes: { unofficial: { enabled: true, acknowledged: true } } });
  // The file says true, but the state holds no acknowledgement, so it is false and the file value is reported.
  const none = applyAcknowledgement(config, undefined);
  assert.equal(none.config.routes.unofficial.acknowledged, false);
  assert.equal(none.ignoredFileValue, true);
  // Only the state can make it true.
  const stored = applyAcknowledgement(config, true);
  assert.equal(stored.config.routes.unofficial.acknowledged, true);
  assert.equal(stored.ignoredFileValue, false);
  // The loaded config is not changed.
  assert.equal(config.routes.unofficial.acknowledged, true);
});

test('serve refuses a non-loopback host without api_token, and without http.allowRemote', () => {
  assertKind(() => assertServeHost({ host: '0.0.0.0', apiToken: null }), 'CONFIG');
  assertKind(() => assertServeHost({ host: '192.168.1.5', apiToken: '' }), 'CONFIG');
  assertKind(() => assertServeHost({ host: '0.0.0.0', apiToken: 'API-TOKEN-VALUE-1' }), 'CONFIG');
  assertKind(() => assertServeHost({ host: '0.0.0.0', apiToken: 'API-TOKEN-VALUE-1', allowRemote: false }), 'CONFIG');
  assertKind(() => assertServeHost({ host: '0.0.0.0', apiToken: null, allowRemote: true }), 'CONFIG');
  assert.doesNotThrow(() => assertServeHost({ host: '0.0.0.0', apiToken: 'API-TOKEN-VALUE-1', allowRemote: true }));
  assert.doesNotThrow(() => assertServeHost({ host: '127.0.0.1', apiToken: null }));
  assert.doesNotThrow(() => assertServeHost({ host: 'localhost', apiToken: null }));
  assert.doesNotThrow(() => assertServeHost({ host: '::1', apiToken: null }));
});

function assertKind(fn, kind) {
  assert.throws(fn, (err) => err instanceof IgError && err.kind === kind);
}

test('serve refuses a non-loopback host without api_token before it builds anything', async (t) => {
  const config = configFrom(t, { http: { host: '0.0.0.0', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'] } });
  const dataDir = tempDir(t);
  await assert.rejects(
    buildServe({ config, secrets: fakeSecrets({}), dataDir, now: () => Date.now() }),
    (err) => err instanceof IgError && err.kind === 'CONFIG',
  );
  assert.equal(existsSync(join(dataDir, 'state.json')), false);
});

test('serve refuses a non-loopback host without http.allowRemote, names the key, and builds nothing', async (t) => {
  assert.throws(
    () => assertServeHost({ host: '192.168.1.10', apiToken: 'API-TOKEN-VALUE-1' }),
    (err) => err instanceof IgError && err.kind === 'CONFIG' && err.message.includes('http.allowRemote'),
  );
  const config = configFrom(t, {
    http: { host: '192.168.1.10', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'], allowRemote: false },
  });
  const dataDir = tempDir(t);
  await assert.rejects(
    buildServe({ config, secrets: fakeSecrets({ api_token: 'API-TOKEN-VALUE-1' }), dataDir, now: () => Date.now() }),
    (err) => err instanceof IgError && err.kind === 'CONFIG' && err.message.includes('http.allowRemote'),
  );
  assert.equal(existsSync(join(dataDir, 'state.json')), false);
});

test('serve starts on a non-loopback host with http.allowRemote and a token, on the configured host and port', async (t) => {
  const config = configFrom(t, {
    http: { host: '192.168.1.10', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'], allowRemote: true },
  });
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ api_token: 'API-TOKEN-VALUE-1' }),
    dataDir: tempDir(t),
    now: () => Date.now(),
  });
  // A recording stub stands in for listen, so no socket is opened. listenHttp is the path that serve uses to start the listener.
  const listens = [];
  built.httpServer.listen = (...args) => {
    listens.push(args);
    return built.httpServer;
  };
  listenHttp(built.httpServer);
  assert.deepEqual(listens, [[8788, '192.168.1.10']]);
});

// Starts a built service without a socket and without Graph. The owner check is replaced. The listener is a recording stub,
// which reports listening on the next turn. The poller does not start. The token check is the real one, and shutdown clears it.
const SERVE_TOKEN = 'API-TOKEN-SERVE-WARNING-1';

async function startWithoutSocket(built, { out, err }) {
  const listens = [];
  built.verifyOwner = async () => {};
  built.poller.start = () => {};
  built.httpServer.address = () => ({ address: built.config.http.host, port: built.config.http.port });
  built.httpServer.listen = (...args) => {
    listens.push(args);
    setImmediate(() => built.httpServer.emit('listening'));
    return built.httpServer;
  };
  const { shutdown } = await startServe(built, { out, err });
  return { listens, shutdown };
}

test('serve on a non-loopback host with http.allowRemote prints one plain-HTTP warning line on start, and no token', async (t) => {
  const config = configFrom(t, {
    http: { host: '192.168.1.10', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'], allowRemote: true },
  });
  const built = await buildServe({ config, secrets: fakeSecrets({ api_token: SERVE_TOKEN }), dataDir: tempDir(t), now: () => Date.now() });
  const out = collector();
  const err = collector();
  const { listens, shutdown } = await startWithoutSocket(built, { out, err });
  t.after(() => shutdown());
  assert.deepEqual(listens, [[8788, '192.168.1.10']]);
  assert.match(out.text(), /HTTP API listening on 192.168.1.10:8788/);
  const warnings = err.text().split('\n').filter((line) => line.startsWith('warning:'));
  assert.equal(warnings.length, 1, 'exactly one warning line');
  assert.match(warnings[0], /plain HTTP/);
  assert.match(warnings[0], /unencrypted/);
  assert.ok(!err.text().includes(SERVE_TOKEN) && !out.text().includes(SERVE_TOKEN), 'the token is printed nowhere');
});

test('serve on loopback prints nothing extra: stderr stays silent and no plain-HTTP line is printed', async (t) => {
  const config = configFrom(t);
  const built = await buildServe({ config, secrets: fakeSecrets({ api_token: SERVE_TOKEN }), dataDir: tempDir(t), now: () => Date.now() });
  const out = collector();
  const err = collector();
  const { listens, shutdown } = await startWithoutSocket(built, { out, err });
  t.after(() => shutdown());
  assert.deepEqual(listens, [[8788, '127.0.0.1']]);
  assert.equal(err.text(), '', 'stderr is silent on a loopback start');
  assert.ok(!out.text().includes('plain HTTP'));
});

test('remoteServeWarning is null for a loopback host, and otherwise names the plain-HTTP risk without a token', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
    assert.equal(remoteServeWarning({ host, port: 8788 }), null, host);
  }
  const wildcard = remoteServeWarning({ host: '::', port: 8788 });
  assert.match(wildcard, /^warning: the HTTP API is plain HTTP on \[::\]:8788\. /);
  assert.match(remoteServeWarning({ host: '192.168.1.10', port: 9000 }), /on 192\.168\.1\.10:9000\./);
  assert.ok(!wildcard.includes(SERVE_TOKEN));
});

test('the webhook handler is null when webhook.enabled is false', async (t) => {
  const config = configFrom(t);
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ api_token: 'API-TOKEN-VALUE-2' }),
    dataDir: tempDir(t),
    now: () => Date.now(),
  });
  assert.equal(built.webhookHandler, null);
  assert.equal(built.httpServer.listening, false);
});

test('the webhook handler is built only when webhook.enabled is true, and refuses without secrets', async (t) => {
  const config = configFrom(t, { webhook: { enabled: true, path: '/webhooks/instagram' } });
  await assert.rejects(
    buildServe({ config, secrets: fakeSecrets({}), dataDir: tempDir(t), now: () => Date.now() }),
    (err) => err instanceof IgError && err.kind === 'CONFIG',
  );
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ app_secret: 'APP-SECRET-VALUE-W', webhook_verify_token: 'VERIFY-TOKEN-VALUE-W' }),
    dataDir: tempDir(t),
    now: () => Date.now(),
  });
  assert.equal(typeof built.webhookHandler, 'function');
  assert.equal(built.httpServer.listening, false);
});

test('buildServe wires the modules without starting the poller or a listener', async (t) => {
  const config = configFrom(t);
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-B' }),
    dataDir: tempDir(t),
    now: () => Date.now(),
  });
  assert.equal(built.guard.stopStatus().stopped, false);
  assert.equal(built.httpServer.listening, false);
  assert.equal(typeof built.poller.start, 'function');
});

test('a corrupt state file starts the guard stopped with STATE_CORRUPT, and serve keeps that stop', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-CORRUPT' }),
    dataDir,
    now: () => Date.now(),
  });
  assert.equal(built.guard.stopStatus().stopped, true);
  assert.equal(built.guard.stopStatus().kind, 'STATE_CORRUPT');
});

// Changed in P4 (O-3). Old assertion (removed): the build rejects with CONFIG, so the service refuses to start. New assertion:
// the service starts, stopped with STATE_CORRUPT, and an outbound call is refused. Only ig_stop_clear clears it.
test('a stop whose time cannot be read back starts the service stopped with STATE_CORRUPT (O-3)', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  const stop = { stopped: true, kind: 'CHECKPOINT', detail: 'checkpoint', since: 'not a time' };
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify({ stop }));
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-STOP' }),
    dataDir,
    now: () => Date.now(),
  });
  assert.equal(built.guard.stopStatus().stopped, true);
  assert.equal(built.guard.stopStatus().kind, 'STATE_CORRUPT');
  assert.throws(() => built.guard.assertNotStopped(), (err) => err instanceof IgError && err.kind === 'STOPPED');
});

test('auth set refuses an unknown name before it reads a value or touches a secret', async () => {
  const secrets = fakeSecrets({});
  let reads = 0;
  await assert.rejects(
    runAuthSet({ name: 'not_a_secret', secrets, readValue: async () => ((reads += 1), 'VALUE-ABCDEFGH'), out: () => {} }),
    (err) => err instanceof IgError && err.kind === 'VALIDATION',
  );
  assert.equal(reads, 0);
  assert.deepEqual(secrets.writes, []);
});

test('auth set stores a known name and never prints the value', async () => {
  const secrets = fakeSecrets({});
  const out = collector();
  await runAuthSet({ name: 'api_token', secrets, readValue: async () => 'SECRET-VALUE-XYZ-123', out });
  assert.deepEqual(secrets.writes, ['api_token']);
  assert.ok(!out.text().includes('SECRET-VALUE-XYZ-123'));
});

test('readPipedValue takes the first line of stdin', async () => {
  assert.equal(await readPipedValue(Readable.from(['first-line\r\nsecond'])), 'first-line');
});

// O-7. The long-lived exchange is refused by Meta in this fake: the failure must name its step, and store nothing.
test('a refused long-lived exchange names its step, and stores nothing (O-7)', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({ app_secret: 'APP-SECRET-VALUE-L1' });
  const state = fakeState();
  const audit = { records: [], record(entry) { this.records.push(entry); } };
  const out = collector();
  const shortBody = JSON.stringify({ data: [{ access_token: 'EAAB-SHORT-L1', user_id: OWNER_ID }] });
  await assert.rejects(
    runAuthLogin({
      config,
      secrets,
      state,
      audit,
      now: () => Date.parse('2026-10-21T10:00:00.000Z'),
      port: 8790,
      out,
      listen: async ({ expectedState }) => `http://127.0.0.1:8790/callback?code=CODE-L1&state=${expectedState}`,
      serveLock: absentService,
      fetchImpl: async (url) =>
        url.startsWith('https://api.instagram.com/')
          ? { status: 200, text: async () => shortBody }
          : { status: 400, text: async () => '{"error_type":"OAuthException","code":400}' },
    }),
    (err) =>
      err instanceof IgError &&
      err.kind === 'API_ERROR' &&
      /^the long-lived token exchange failed: the long-lived token exchange was refused \(HTTP 400, OAuthException\)$/.test(err.message),
  );
  assert.deepEqual(secrets.writes, []);
  assert.deepEqual(state.log.sets, []);
  assert.equal(state.log.saves, 0);
  assert.equal(audit.records.length, 0);
  assert.ok(out.text().includes('https://www.instagram.com/oauth/authorize'));
  assert.ok(!out.text().includes('APP-SECRET-VALUE-L1'));
});

test('a refused short-lived exchange names its step, and stores nothing (O-7)', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({ app_secret: 'APP-SECRET-VALUE-S7' });
  const state = fakeState();
  await assert.rejects(
    runAuthLogin({
      config,
      secrets,
      state,
      audit: { record() {} },
      now: () => Date.now(),
      port: 8790,
      out: () => {},
      listen: async ({ expectedState }) => `http://127.0.0.1:8790/callback?code=CODE-S7&state=${expectedState}`,
      serveLock: absentService,
      fetchImpl: async () => ({ status: 500, text: async () => '' }),
      longLived: async () => {
        throw new Error('the long-lived step must not run after a refused short-lived step');
      },
    }),
    (err) => err.kind === 'API_ERROR' && /^the short-lived token exchange failed: /.test(err.message),
  );
  assert.deepEqual(secrets.writes, []);
  assert.deepEqual(state.log.sets, []);
});

test('a failed token record save removes the keyring entry again, and says that nothing is stored (O-7)', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({ app_secret: 'APP-SECRET-VALUE-R7' });
  const state = { ...fakeState(), save() { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
  await assert.rejects(
    runAuthLogin({
      config,
      secrets,
      state,
      audit: { record() {} },
      now: () => Date.now(),
      port: 8790,
      out: () => {},
      listen: async ({ expectedState }) => `http://127.0.0.1:8790/callback?code=CODE-R7&state=${expectedState}`,
      serveLock: absentService,
      fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ data: [{ access_token: 'EAAB-SHORT-R7', user_id: OWNER_ID }] }) }),
      longLived: async () => ({ accessToken: 'EAAB-LONG-R7-VALUE', expiresInSeconds: 5184000 }),
    }),
    (err) => err.kind === 'CONFIG' && /ENOSPC/.test(err.message) && /nothing is stored/.test(err.message),
  );
  assert.deepEqual(secrets.writes, ['owner_token']);
  assert.deepEqual(secrets.removes, ['owner_token']);
  assert.equal(secrets.get('owner_token'), null);
});

test('auth login refuses without app.id, and without app_secret', async (t) => {
  const noAppId = configFrom(t, { app: { id: null } });
  await assert.rejects(
    runAuthLogin({ config: noAppId, secrets: fakeSecrets({ app_secret: 'APP-SECRET-VALUE-N1' }), state: fakeState(), audit: { record() {} }, port: 8790, out: () => {}, listen: async () => '' }),
    (err) => err instanceof IgError && err.kind === 'CONFIG',
  );
  const config = configFrom(t);
  await assert.rejects(
    runAuthLogin({ config, secrets: fakeSecrets({}), state: fakeState(), audit: { record() {} }, port: 8790, out: () => {}, listen: async () => '' }),
    (err) => err instanceof IgError && err.kind === 'CONFIG',
  );
});

test('auth login refuses a redirect whose state does not match, with nothing stored', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({ app_secret: 'APP-SECRET-VALUE-S1' });
  const state = fakeState();
  let longCalls = 0;
  await assert.rejects(
    runAuthLogin({
      config,
      secrets,
      state,
      audit: { record() {} },
      now: () => Date.now(),
      port: 8790,
      out: () => {},
      listen: async () => 'http://127.0.0.1:8790/callback?code=CODE-S1&state=FORGED',
      serveLock: absentService,
      fetchImpl: async () => ({ status: 200, text: async () => '{"data":[]}' }),
      longLived: async () => {
        longCalls += 1;
        return { accessToken: 'NEVER', expiresInSeconds: 1 };
      },
    }),
    (err) => err instanceof IgError && err.kind === 'AUTH_EXPIRED',
  );
  assert.equal(longCalls, 0);
  assert.deepEqual(secrets.writes, []);
});

test('auth login refuses an account other than the owner before the long-lived step', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({ app_secret: 'APP-SECRET-VALUE-O1' });
  let longCalls = 0;
  const shortBody = JSON.stringify({ data: [{ access_token: 'EAAB-SHORT-O1', user_id: '999' }] });
  await assert.rejects(
    runAuthLogin({
      config,
      secrets,
      state: fakeState(),
      audit: { record() {} },
      now: () => Date.now(),
      port: 8790,
      out: () => {},
      listen: async ({ expectedState }) => `http://127.0.0.1:8790/callback?code=CODE-O1&state=${expectedState}`,
      serveLock: absentService,
      fetchImpl: async () => ({ status: 200, text: async () => shortBody }),
      longLived: async () => {
        longCalls += 1;
        return { accessToken: 'NEVER', expiresInSeconds: 1 };
      },
    }),
    (err) => err instanceof IgError && err.kind === 'OWNER_MISMATCH',
  );
  assert.equal(longCalls, 0);
  assert.deepEqual(secrets.writes, []);
});

test('auth login stores the owner token and the token record on success', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({ app_secret: 'APP-SECRET-VALUE-OK' });
  const state = fakeState();
  const audit = { records: [], record(entry) { this.records.push(entry); } };
  const out = collector();
  const shortBody = JSON.stringify({ data: [{ access_token: 'EAAB-SHORT-OK', user_id: OWNER_ID }] });
  const now = Date.parse('2026-10-21T10:00:00.000Z');
  await runAuthLogin({
    config,
    secrets,
    state,
    audit,
    now: () => now,
    port: 8790,
    out,
    listen: async ({ expectedState }) => `http://127.0.0.1:8790/callback?code=CODE-OK&state=${expectedState}`,
    serveLock: absentService,
    fetchImpl: async () => ({ status: 200, text: async () => shortBody }),
    longLived: async () => ({ accessToken: 'EAAB-LONG-OK-0123456789', expiresInSeconds: 5184000 }),
  });
  assert.deepEqual(secrets.writes, ['owner_token']);
  const record = state.get('token', undefined);
  assert.equal(record.obtainedAt, '2026-10-21T10:00:00.000Z');
  assert.equal(record.expiresAt, new Date(now + 5184000 * 1000).toISOString());
  // Old assertion (before M-8): deepEqual(record.scopes, INSTAGRAM_SCOPES). This exchange returns no permissions, so no granted
  // list is known: scopes is empty, and the requested list is under scopesRequested.
  assert.deepEqual(record.scopes, []);
  assert.deepEqual(record.scopesRequested, INSTAGRAM_SCOPES);
  assert.ok(state.log.saves >= 1);
  assert.ok(!out.text().includes('EAAB-LONG-OK-0123456789'));
  // A stop from before the login still holds: the login output says so, because a login never clears a stop.
  assert.ok(out.text().includes('A stop that was in place before this login, if any, still holds.'));
  assert.ok(!JSON.stringify(audit.records).includes('EAAB-LONG-OK-0123456789'));
});

test('the authorize step is built from the app id and the owner scopes', async (t) => {
  const config = configFrom(t);
  const out = collector();
  await assert.rejects(
    runAuthLogin({
      config,
      secrets: fakeSecrets({ app_secret: 'APP-SECRET-VALUE-A1' }),
      state: fakeState(),
      audit: { record() {} },
      now: () => Date.now(),
      port: 8790,
      out,
      listen: async ({ expectedState }) => {
        // Also proves the parser is the one the login uses.
        assert.equal(parseRedirect(`http://127.0.0.1:8790/callback?code=X&state=${expectedState}`, expectedState), 'X');
        return `http://127.0.0.1:8790/callback?code=X&state=${expectedState}`;
      },
      fetchImpl: async () => ({ status: 200, text: async () => '{"data":[{"access_token":"EAAB-A1-0000000000","user_id":"17841400000000001"}]}' }),
      serveLock: absentService,
      // The test stops here: the long-lived step is a fake that refuses, so the login ends after the authorize step.
      longLived: async () => {
        throw new IgError('CONFIG', 'stopped after the authorize step');
      },
    }),
    (err) => err instanceof IgError && err.kind === 'CONFIG',
  );
  assert.ok(out.text().includes(`client_id=${APP_ID}`));
  assert.ok(out.text().includes('scope=instagram_business_basic%2C'));
});

// O-8. The approval receiver is always injected in these tests: the default would listen on the loopback port.
test('auth facebook prints the fragment authorize URL, and the bridge receives the expected state (O-8)', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({});
  const out = collector();
  const received = [];
  await runAuthFacebook({
    config,
    secrets,
    state: fakeState(),
    audit: { record() {} },
    out,
    receiveToken: async (args) => {
      received.push(args);
      return { token: 'FB-TOKEN-VALUE-URL-1', expiresInSeconds: null };
    },
    createClient: () => ({
      get: async () => ({ data: { data: [{ id: '1002', instagram_business_account: { id: OWNER_ID } }] } }),
    }),
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].port, 8790);
  const authorizeLine = out.text().split('\n').find((line) => line.startsWith('https://www.facebook.com/dialog/oauth'));
  const url = new URL(authorizeLine);
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('client_id'), APP_ID);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:8790/facebook-callback');
  assert.equal(url.searchParams.get('state'), received[0].expectedState);
  assert.ok(!authorizeLine.includes('FB-TOKEN-VALUE-URL-1'));
  assert.deepEqual(secrets.writes, ['facebook_token']);
});

test('auth facebook refuses without app.id, before any approval is awaited (O-8)', async (t) => {
  const config = configFrom(t, { app: { id: null } });
  let asked = false;
  await assert.rejects(
    runAuthFacebook({
      config,
      secrets: fakeSecrets({}),
      audit: { record() {} },
      out: () => {},
      receiveToken: async () => {
        asked = true;
        return 'FB-TOKEN-VALUE-NOAPP';
      },
    }),
    (err) => err instanceof IgError && err.kind === 'CONFIG',
  );
  assert.equal(asked, false);
});

test('auth facebook stores nothing when the bridge refuses the state (O-8)', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({});
  await assert.rejects(
    runAuthFacebook({
      config,
      secrets,
      audit: { record() {} },
      out: () => {},
      receiveToken: async () => {
        throw new IgError('AUTH_EXPIRED', 'the authorization state does not match this login; start the login again');
      },
      createClient: () => {
        throw new Error('no client is made after a refused state');
      },
    }),
    (err) => err instanceof IgError && err.kind === 'AUTH_EXPIRED' && /the Facebook approval failed/.test(err.message),
  );
  assert.deepEqual(secrets.writes, []);
});

test('auth facebook stores the token only when the owner account has a linked Page', async (t) => {
  const config = configFrom(t);
  const accounts = (data) => ({ get: async () => ({ data: { data } }) });
  const linked = fakeSecrets({});
  await runAuthFacebook({
    config,
    secrets: linked,
    state: fakeState(),
    audit: { record() {} },
    out: () => {},
    receiveToken: async () => ({ token: 'FB-TOKEN-VALUE-LINKED-1', expiresInSeconds: null }),
    createClient: () => accounts([{ id: '1002', instagram_business_account: { id: OWNER_ID } }]),
  });
  assert.deepEqual(linked.writes, ['facebook_token']);

  const unlinked = fakeSecrets({});
  await assert.rejects(
    runAuthFacebook({
      config,
      secrets: unlinked,
      state: fakeState(),
      audit: { record() {} },
      out: () => {},
      receiveToken: async () => ({ token: 'FB-TOKEN-VALUE-UNLINKED', expiresInSeconds: null }),
      createClient: () => accounts([{ id: '1003', instagram_business_account: { id: '999' } }]),
    }),
    (err) => err instanceof IgError && err.kind === 'CONFIG',
  );
  assert.deepEqual(unlinked.writes, []);
});

test('routes ack-unofficial without --confirm prints the warning and stores nothing', async (t) => {
  const dataDir = tempDir(t);
  const state = await createState({ file: join(dataDir, 'state.json') });
  const out = collector();
  const result = await runRoutesAck({ confirm: false, state, out, serveLock: absentService });
  assert.equal(result, 'preview');
  assert.match(out.text(), /Terms of Use/);
  assert.equal(state.get(ACK_KEY, undefined), undefined);
});

test('routes ack-unofficial --confirm stores the acknowledgement in the state file', async (t) => {
  const dataDir = tempDir(t);
  const file = join(dataDir, 'state.json');
  const state = await createState({ file });
  const result = await runRoutesAck({ confirm: true, state, out: () => {}, serveLock: absentService });
  assert.equal(result, 'stored');
  const again = await createState({ file });
  assert.equal(again.get(ACK_KEY, undefined), true);
  assert.equal(JSON.parse(readFileSync(file, 'utf8'))[ACK_KEY], true);
});

test('status prints the local summary with a notice, and never a token, when the service is not running', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  const token = 'API-TOKEN-NEVER-PRINTED-1';
  const out = collector();
  const failingFetch = async () => {
    throw new TypeError('fetch failed');
  };
  const result = await runStatus({
    config,
    dataDir,
    secrets: fakeSecrets({ api_token: token, owner_token: 'OWNER-TOKEN-NEVER-PRINTED' }),
    fetchImpl: failingFetch,
    out,
  });
  assert.equal(result, 'not_running');
  assert.match(out.text(), /ig serve is not running/);
  assert.match(out.text(), /"accountType": "business"/);
  assert.ok(!out.text().includes(token));
  assert.ok(!out.text().includes('OWNER-TOKEN-NEVER-PRINTED'));
});

test('status prints the ig_status result from a running service, with the bearer token and no token in the URL', async (t) => {
  const config = configFrom(t);
  const token = 'API-TOKEN-NEVER-PRINTED-2';
  const out = collector();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, text: async () => JSON.stringify({ result: { accountType: 'business', stop: { stopped: false } } }) };
  };
  const result = await runStatus({ config, dataDir: tempDir(t), secrets: fakeSecrets({ api_token: token }), fetchImpl, out });
  assert.equal(result, 'running');
  assert.equal(calls[0].url, 'http://127.0.0.1:8788/tools/ig_status');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  assert.ok(!out.text().includes(token));
  assert.match(out.text(), /"stopped": false/);
});

test('status refuses to send the token to a non-loopback host without http.allowRemote, and sends nothing', async (t) => {
  const config = configFrom(t, {
    http: { host: '192.168.1.10', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'], allowRemote: false },
  });
  const token = 'API-TOKEN-NEVER-PRINTED-3';
  const out = collector();
  const err = collector();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    throw new TypeError('no request should be made');
  };
  const result = await runStatus({ config, dataDir: tempDir(t), secrets: fakeSecrets({ api_token: token }), fetchImpl, out, err });
  assert.equal(result, 'refused_remote');
  assert.deepEqual(calls, [], 'no request is made');
  assert.equal(out.text(), '', 'nothing goes to stdout');
  assert.equal(err.text().split('\n').length, 1, 'the reason is the only line');
  assert.match(err.text(), /http\.allowRemote/, 'the reason names the key');
  assert.ok(!err.text().includes(token));
});

test('status with http.allowRemote sends the token over plain HTTP, prints one warning line that the traffic is not encrypted, and prints no token', async (t) => {
  const config = configFrom(t, {
    http: { host: '192.168.1.10', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'], allowRemote: true },
  });
  const token = 'API-TOKEN-NEVER-PRINTED-4';
  const out = collector();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, text: async () => JSON.stringify({ result: { accountType: 'business' } }) };
  };
  const result = await runStatus({ config, dataDir: tempDir(t), secrets: fakeSecrets({ api_token: token }), fetchImpl, out });
  assert.equal(result, 'running');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://192.168.1.10:8788/tools/ig_status');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  const warnings = out.text().split('\n').filter((line) => line.startsWith('warning:'));
  assert.equal(warnings.length, 1, 'exactly one warning line');
  assert.match(warnings[0], /not encrypted/);
  assert.ok(!out.text().includes(token), 'the token is not printed, not even in the warning');
});

test('status reaches a wildcard bind on loopback, so it needs no http.allowRemote and prints no warning', async (t) => {
  const config = configFrom(t, {
    http: { host: '0.0.0.0', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'], allowRemote: false },
  });
  const out = collector();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, text: async () => JSON.stringify({ result: { accountType: 'business' } }) };
  };
  const result = await runStatus({ config, dataDir: tempDir(t), secrets: fakeSecrets({ api_token: 'API-TOKEN-NEVER-PRINTED-5' }), fetchImpl, out });
  assert.equal(result, 'running');
  assert.equal(calls[0].url, 'http://127.0.0.1:8788/tools/ig_status');
  assert.ok(!out.text().split('\n').some((line) => line.startsWith('warning:')));
});

// ig status run as a child process. The child loads test/fixtures/status-fetch-stub.mjs, which replaces fetch in that process,
// so no request leaves the test. The api token comes from the environment, so the keyring is not read.
const STATUS_STUB = join(PROJECT_ROOT, 'test', 'fixtures', 'status-fetch-stub.mjs');
const STATUS_TOKEN = 'API-TOKEN-SPAWN-STATUS-1';

function runIgStatus(t, host, { allowRemote }) {
  const dir = tempDir(t);
  const file = join(dir, 'config.json');
  writeFileSync(
    file,
    JSON.stringify({
      owner: { igUserId: OWNER_ID, accountType: 'business' },
      app: { id: APP_ID },
      dataDir: join(dir, 'data'),
      http: { host, port: 8788, allowedHosts: ['127.0.0.1', 'localhost'], allowRemote },
    }),
  );
  return spawnSync(process.execPath, ['--import', pathToFileURL(STATUS_STUB).href, BIN, '--config', file, 'status'], {
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, IG_API_TOKEN: STATUS_TOKEN },
  });
}

test('ig status with a non-loopback host and no http.allowRemote exits 1, prints only the reason, and sends no request', (t) => {
  const run = runIgStatus(t, '192.168.1.10', { allowRemote: false });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(run.stdout, '', 'nothing goes to stdout');
  const lines = run.stderr.trim().split('\n');
  assert.equal(lines.length, 1, 'the reason is the only line on stderr');
  assert.match(lines[0], /http\.allowRemote/);
  assert.ok(!run.stderr.includes('FETCH'), 'no request is sent');
  assert.ok(!run.stderr.includes(STATUS_TOKEN));
});

test('ig status with http.allowRemote still exits 0, sends the token over plain HTTP, and prints one warning line', (t) => {
  const run = runIgStatus(t, '192.168.1.10', { allowRemote: true });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /FETCH http:\/\/192\.168\.1\.10:8788\/tools\/ig_status authorization=yes/);
  const warnings = run.stdout.split('\n').filter((line) => line.startsWith('warning:'));
  assert.equal(warnings.length, 1, 'exactly one warning line');
  assert.match(warnings[0], /not encrypted/);
  assert.ok(!run.stdout.includes(STATUS_TOKEN) && !run.stderr.includes(STATUS_TOKEN), 'the token is printed nowhere');
});

test('ig status on loopback still exits 0 on a successful status', (t) => {
  const run = runIgStatus(t, '127.0.0.1', { allowRemote: false });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /FETCH http:\/\/127\.0\.0\.1:8788\/tools\/ig_status authorization=yes/);
  assert.match(run.stdout, /"accountType": "business"/);
});

const OWNER_TOKEN = 'OWNER-TOKEN-VALUE-RUN-1';

// The serve lock (F-21). ig serve writes serve.lock, with its process id, in the data directory while it runs. A live id
// refuses auth login and routes ack-unofficial before any listener is built and before anything is stored. A stale id is
// ignored. No socket is opened here.
function deadPid() {
  return spawnSync(process.execPath, ['-e', '']).pid;
}

test('a live serve lock refuses auth login before any listener, and routes ack-unofficial stores nothing (F-21)', async (t) => {
  const dir = tempDir(t);
  writeFileSync(serveLockFile(dir), `${process.pid}\n`);
  const config = configFrom(t, { dataDir: dir });
  let listened = false;
  await assert.rejects(
    runAuthLogin({
      config,
      secrets: fakeSecrets({ app_secret: 'APP-SECRET-VALUE-F21' }),
      state: fakeState(),
      audit: { record() {} },
      port: 8790,
      out: () => {},
      listen: async () => {
        listened = true;
        return '';
      },
    }),
    (err) => err instanceof IgError && err.kind === 'CONFIG' && err.message === SERVE_RUNNING_MESSAGE,
  );
  assert.equal(listened, false, 'no listener is built');
  const state = fakeState();
  const out = collector();
  await assert.rejects(
    runRoutesAck({ confirm: true, state, out, serveLock: () => readServeLock(dir) }),
    (err) => err instanceof IgError && err.message === SERVE_RUNNING_MESSAGE,
  );
  assert.equal(state.log.sets.length, 0, 'nothing is stored');
  assert.equal(out.text(), '');
});

test('a serve lock whose process is gone is stale: it is ignored, and a new serve takes it over (F-21)', (t) => {
  const dir = tempDir(t);
  const dead = deadPid();
  assert.equal(processAlive(dead), false, 'the probe process has exited');
  writeFileSync(serveLockFile(dir), `${dead}\n`);
  assert.equal(readServeLock(dir), 'absent');
  acquireServeLock(dir);
  assert.equal(readFileSync(serveLockFile(dir), 'utf8').trim(), String(process.pid));
  releaseServeLock(dir);
  assert.equal(existsSync(serveLockFile(dir)), false);
});

test('acquire refuses a live lock and leaves it in place, and a lock with no valid id also refuses (F-21)', (t) => {
  const dir = tempDir(t);
  writeFileSync(serveLockFile(dir), `${process.pid}\n`);
  assert.throws(
    () => acquireServeLock(dir),
    (err) => err instanceof IgError && err.kind === 'CONFIG' && err.message === SERVE_RUNNING_MESSAGE,
  );
  assert.equal(readFileSync(serveLockFile(dir), 'utf8').trim(), String(process.pid));
  writeFileSync(serveLockFile(dir), 'not a process id\n');
  assert.equal(readServeLock(dir), 'running');
  assert.throws(() => acquireServeLock(dir), (err) => err instanceof IgError && err.kind === 'CONFIG');
});

test('release removes only a lock that holds this process id (F-21)', (t) => {
  const dir = tempDir(t);
  writeFileSync(serveLockFile(dir), `${deadPid()}\n`);
  releaseServeLock(dir);
  assert.equal(existsSync(serveLockFile(dir)), true, 'another id is left alone');
});

test('a serve start that fails before it listens removes the lock it took (F-21)', async (t) => {
  const dir = tempDir(t);
  const built = {
    dataDir: dir,
    config: { webhook: { enabled: false, path: '/webhooks/instagram' } },
    guard: { stopStatus: () => ({ stopped: false }) },
    poller: { start() {} },
    httpServer: { once() {}, removeListener() {} },
    service: {},
    adapters: {},
    verifyOwner: async () => {
      throw new IgError('OWNER_MISMATCH', 'the owner token belongs to another account; serve refuses to start');
    },
  };
  // Old: startServe took the lock itself. Now runServe takes it before buildServe, and startServe releases it on a failed start.
  await assert.rejects(
    runServe({
      config: configFrom(t, { dataDir: dir }),
      secrets: fakeSecrets({}),
      dataDir: dir,
      out: () => {},
      err: () => {},
      build: async () => built,
      start: startServe,
    }),
    (err) => err instanceof IgError && err.kind === 'OWNER_MISMATCH',
  );
  assert.equal(existsSync(serveLockFile(dir)), false, 'the lock is not left behind');
});

// I-1: a poller reading reaches the usage gate before any tool call.
test('a poller reading reaches the usage gate before any tool call, and the next outbound call is busy (I-1)', async (t) => {
  const config = configFrom(t);
  // The first read is the like's own profile read (O-11). It answers without a usage header, so it gives no reading. Every
  // later read, the poll's included, carries the high reading.
  let answered = 0;
  const { calls, fetchImpl } = recordingFetch(() => {
    answered += 1;
    const headers = { 'content-type': 'application/json' };
    if (answered > 1) headers['x-app-usage'] = '{"call_count":1,"total_time":90,"total_cputime":5}';
    return new Response('{"error":{"message":"not found","code":1}}', { status: 400, headers });
  });
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: OWNER_TOKEN }),
    dataDir: tempDir(t),
    now: () => Date.now(),
    fetchImpl,
    sleep: async () => {},
  });
  const target = '17900000000000001';
  // Control (O-11): with no reading, a like on media first makes one profile read. That read gives no reading, and it fails
  // here, so the like is refused with the read's kind and nothing is sent.
  await assert.rejects(built.service.like({ targetId: target, kind: 'media', confirm: true }), { kind: 'API_ERROR' });
  assert.equal(calls.length, 1, 'only the profile read was made');
  await built.poller.tick();
  assert.equal(calls.length, 2, 'the poll made one read');
  // After the poller's reading, the usage gate itself holds the call, with its own reason.
  const result = await built.service.like({ targetId: target, kind: 'media', confirm: true });
  assert.equal(result.busy, true, 'the usage gate holds the outbound call on the poller reading');
  assert.match(result.reason, /usage reached 80 percent/);
  assert.equal(calls.length, 2, 'the held call made no request');
});

// I-2: the poller halts under STATE_LOST and STATE_CORRUPT too.
test('the poller makes no request while STATE_LOST is held (I-2)', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  // Events are on disk, but the state has no events.lastSeq, so the guard starts stopped with STATE_LOST.
  writeFileSync(join(dataDir, 'events.jsonl'), '{"lastSeq":1}\n');
  writeFileSync(join(dataDir, 'state.json'), '{}');
  const { calls, fetchImpl } = recordingFetch();
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: OWNER_TOKEN }),
    dataDir,
    now: () => Date.now(),
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(built.guard.stopStatus().kind, 'STATE_LOST');
  const result = await built.poller.tick();
  assert.equal(result.status, 'halted');
  assert.equal(calls.length, 0);
});

test('the poller makes no request while STATE_CORRUPT is held (I-2)', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  const { calls, fetchImpl } = recordingFetch();
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: OWNER_TOKEN }),
    dataDir,
    now: () => Date.now(),
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(built.guard.stopStatus().kind, 'STATE_CORRUPT');
  const result = await built.poller.tick();
  assert.equal(result.status, 'halted');
  assert.equal(calls.length, 0);
});

// M-1: the owner check is a GET to me, with the owner token in the Bearer header only.
test('serve checks the owner token account with GET me, with the Bearer header and no token in the URL (M-1)', async (t) => {
  const config = configFrom(t);
  const { calls, fetchImpl } = recordingFetch(
    () => new Response(JSON.stringify({ id: OWNER_ID }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: OWNER_TOKEN }),
    dataDir: tempDir(t),
    now: () => Date.now(),
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(await built.verifyOwner(), OWNER_ID);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, 'https://graph.instagram.com');
  assert.equal(url.pathname, '/v26.0/me');
  assert.equal(url.searchParams.get('fields'), 'id');
  assert.ok(!calls[0].url.includes(OWNER_TOKEN));
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${OWNER_TOKEN}`);
});

test('serve refuses a token of another account, and listens on nothing (M-1)', async (t) => {
  const config = configFrom(t);
  const { fetchImpl } = recordingFetch(
    () => new Response(JSON.stringify({ id: '999' }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: OWNER_TOKEN }),
    dataDir: tempDir(t),
    now: () => Date.now(),
    fetchImpl,
    sleep: async () => {},
  });
  // A stub stands in for the server. If the owner check were broken, startServe would reach httpServer.once first, which the
  // stub lacks, and fail with a TypeError before listenHttp runs. No socket is opened either way.
  built.httpServer = { listening: false };
  const out = collector();
  await assert.rejects(
    startServe(built, { out, err: () => {} }),
    (err) => err instanceof IgError && err.kind === 'OWNER_MISMATCH' && !err.message.includes(OWNER_TOKEN),
  );
  assert.deepEqual(built.httpServer, { listening: false });
  assert.equal(out.text(), '');
});

test('serve refuses when Graph gives no id for the owner token (M-1)', async (t) => {
  const config = configFrom(t);
  const { fetchImpl } = recordingFetch(() => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: OWNER_TOKEN }),
    dataDir: tempDir(t),
    now: () => Date.now(),
    fetchImpl,
    sleep: async () => {},
  });
  await assert.rejects(built.verifyOwner(), (err) => err instanceof IgError && err.kind === 'API_ERROR');
});

// M-2: auth facebook makes its client through the usage-aware factory, and the reading is returned.
test('auth facebook keeps the usage reading of its Page read through the usage-aware factory (M-2)', async (t) => {
  const config = configFrom(t);
  const reading = { app: { call_count: 1, total_time: 12, total_cputime: 3 }, business: null };
  const result = await runAuthFacebook({
    config,
    secrets: fakeSecrets({}),
    audit: { record() {} },
    out: () => {},
    state: fakeState(),
    receiveToken: async () => ({ token: 'FB-TOKEN-VALUE-READING-1', expiresInSeconds: null }),
    createClient: (args) => {
      assert.equal(typeof args.onUsage, 'function');
      return {
        get: async () => {
          args.onUsage(reading);
          return { data: { data: [{ id: '1002', instagram_business_account: { id: OWNER_ID } }] } };
        },
      };
    },
  });
  assert.equal(result.status, 'stored');
  assert.deepEqual(result.usage, reading);
});

// M-9: a Graph client without onUsage is refused (ruling k).
test('a Graph client without onUsage is refused for outbound use (M-9)', (t) => {
  const config = configFrom(t);
  assert.throws(
    () => makeGraphClient({ config, product: 'instagram', token: 'TOKEN-VALUE-REFUSE-1', onUsage: undefined }),
    (err) => err instanceof IgError && err.kind === 'CONFIG' && /without onUsage/.test(err.message),
  );
  assert.equal(typeof makeGraphClient({ config, product: 'instagram', token: 'TOKEN-VALUE-REFUSE-1', onUsage: () => {} }).get, 'function');
});

// M-9: the hourly token check logs a failure by its kind, through redact, and does not throw.
test('a failing token check is logged by its kind, and does not throw (M-9)', async () => {
  const logged = [];
  const err = (text) => logged.push(text);
  const failing = {
    tokenStatus: async () => {
      throw new IgError('API_ERROR', 'failed with OWNER-TOKEN-CHECK-SECRET-1');
    },
  };
  await runTokenCheck(failing, err);
  assert.deepEqual(logged, ['token check failed (API_ERROR)']);
  const plain = {
    tokenStatus: async () => {
      throw new Error('boom OWNER-TOKEN-CHECK-SECRET-2');
    },
  };
  await runTokenCheck(plain, err);
  assert.deepEqual(logged.slice(1), ['token check failed (error)']);
  const refresh = {
    tokenStatus: async () => ({ canRefresh: true }),
    tokenRefresh: async () => {
      throw new IgError('AUTH_EXPIRED', 'refused OWNER-TOKEN-CHECK-SECRET-3');
    },
  };
  await runTokenCheck(refresh, err);
  assert.deepEqual(logged.slice(2), ['token check failed (AUTH_EXPIRED)']);
  assert.ok(!logged.join('\n').includes('SECRET'));
});


test('ig status builds one pair of brackets for an IPv6 host (N-1b)', async (t) => {
  const config = configFrom(t, { http: { host: '[::1]', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'] } });
  const { calls, fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ result: {} }), { status: 200 }));
  const result = await runStatus({ config, dataDir: tempDir(t), secrets: fakeSecrets({}), fetchImpl, out: () => {} });
  assert.equal(result, 'running');
  assert.equal(calls[0].url, 'http://[::1]:8788/tools/ig_status');
});

// F-1 (Task 4 M-1). buildServe gives the guard the audit file, so a deleted state file with audit lines starts stopped.
test('buildServe starts stopped with STATE_LOST when the state file is gone and the audit file has lines (F-1)', async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'audit.jsonl'), '{"action":"stopClear","outcome":"ok"}\n');
  const built = await buildServe({ config: configFrom(t), secrets: fakeSecrets({}), dataDir: dir, now: () => Date.now() });
  assert.equal(built.guard.stopStatus().kind, 'STATE_LOST');
});

// ---- P1 fix round (2026-10-22) ----

// A login run to the store, with the approval and both exchanges faked and the probe (serveLock) absent. Extra options override.
async function loginToStore(config, extra = {}) {
  return runAuthLogin({
    config,
    secrets: fakeSecrets({ app_secret: 'APP-SECRET-VALUE-FAKE' }),
    state: fakeState(),
    audit: { record() {} },
    now: () => Date.parse('2026-10-22T10:00:00.000Z'),
    port: 8790,
    out: () => {},
    serveLock: absentService,
    listen: async ({ expectedState }) => `http://127.0.0.1:8790/callback?code=CODE-FAKE&state=${expectedState}`,
    exchangeShort: async () => ({ accessToken: 'EAAB-SHORT-FAKE-VALUE', userId: OWNER_ID, grantedScopes: null }),
    longLived: async () => ({ accessToken: 'EAAB-LONG-FAKE-VALUE', expiresInSeconds: 5184000 }),
    ...extra,
  });
}

// A Page client that reports the owner's Page as linked.
const linkedClient = () => ({
  get: async () => ({ data: { data: [{ id: '1002', instagram_business_account: { id: OWNER_ID } }] } }),
});

// I-2. The login holds the serve lock while it waits, so a serve started in that window is refused before it builds anything.
test('a login holds the serve lock while it waits, so a serve started in that window is refused (I-2)', async (t) => {
  const config = configFrom(t);
  const dir = resolveDataDir(config.dataDir);
  let lockDuringWait = false;
  let serveRefused = false;
  let built = 0;
  await loginToStore(config, {
    secrets: fakeSecrets({ app_secret: 'APP-SECRET-VALUE-I2' }),
    listen: async ({ expectedState }) => {
      lockDuringWait = existsSync(serveLockFile(dir));
      await assert.rejects(
        runServe({
          config,
          secrets: fakeSecrets({}),
          dataDir: dir,
          out: () => {},
          err: () => {},
          build: async () => {
            built += 1;
            throw new Error('buildServe must not run while the login holds the lock');
          },
          start: async () => ({}),
        }),
        (err) => err instanceof IgError && err.message === SERVE_RUNNING_MESSAGE,
      );
      serveRefused = true;
      return `http://127.0.0.1:8790/callback?code=CODE-I2&state=${expectedState}`;
    },
  });
  assert.equal(lockDuringWait, true, 'the lock file exists while the approval is pending');
  assert.equal(serveRefused, true, 'a serve started in the window is refused');
  assert.equal(built, 0, 'buildServe never ran in the window');
  assert.equal(existsSync(serveLockFile(dir)), false, 'the lock is gone after the login');
});

// I-2. A serve that holds the lock makes the login refuse before any browser step.
test('a serve that holds the lock makes the login refuse before any browser step (I-2)', async (t) => {
  const config = configFrom(t);
  const dir = resolveDataDir(config.dataDir);
  writeFileSync(serveLockFile(dir), `${process.pid}\n`);
  const out = collector();
  let listened = false;
  await assert.rejects(
    runAuthLogin({
      config,
      secrets: fakeSecrets({ app_secret: 'APP-SECRET-VALUE-I2B' }),
      state: fakeState(),
      audit: { record() {} },
      port: 8790,
      out,
      listen: async () => {
        listened = true;
        return '';
      },
    }),
    (err) => err instanceof IgError && err.kind === 'CONFIG' && err.message === SERVE_RUNNING_MESSAGE,
  );
  assert.equal(listened, false);
  assert.ok(!out.text().includes('https://www.instagram.com/oauth/authorize'), 'no URL is printed');
  assert.equal(readFileSync(serveLockFile(dir), 'utf8').trim(), String(process.pid), 'the serve lock is left as it was');
});

// I-2. The lock is released on every exit: a failed step, and an approval that is cancelled or times out.
test('the lock is released when a login fails, and when the approval is cancelled (I-2)', async (t) => {
  const config = configFrom(t);
  const dir = resolveDataDir(config.dataDir);
  await assert.rejects(
    loginToStore(config, { listen: async () => 'http://127.0.0.1:8790/callback?code=X&state=FORGED' }),
    (err) => err.kind === 'AUTH_EXPIRED',
  );
  assert.equal(existsSync(serveLockFile(dir)), false, 'the lock is gone after a failed step');
  await assert.rejects(
    loginToStore(config, {
      listen: async () => {
        throw new IgError('AUTH_EXPIRED', 'no authorization arrived before the timeout; start the login again');
      },
    }),
    (err) => err.kind === 'AUTH_EXPIRED',
  );
  assert.equal(existsSync(serveLockFile(dir)), false, 'the lock is gone after a cancel or a timeout');
});

// M-6. A second start is refused before buildServe runs, so it cannot write the state first.
test('a second start is refused before buildServe is called (M-6)', async (t) => {
  const config = configFrom(t);
  const dir = resolveDataDir(config.dataDir);
  writeFileSync(serveLockFile(dir), `${process.pid}\n`);
  let built = 0;
  await assert.rejects(
    runServe({
      config,
      secrets: fakeSecrets({}),
      dataDir: dir,
      out: () => {},
      err: () => {},
      build: async () => {
        built += 1;
        return {};
      },
      start: async () => ({}),
    }),
    (err) => err instanceof IgError && err.message === SERVE_RUNNING_MESSAGE,
  );
  assert.equal(built, 0);
  assert.equal(readFileSync(serveLockFile(dir), 'utf8').trim(), String(process.pid), 'the holder keeps its lock');
});

// M-5. Two takeovers of one stale lock: one wins, and the other is refused without removing the winner's lock.
test("two takeovers of one stale lock: one wins, and the other is refused without removing the winner's lock (M-5)", (t) => {
  const dir = tempDir(t);
  const file = serveLockFile(dir);
  writeFileSync(file, `${deadPid()}\n`);
  const stale = readFileSync(file, 'utf8'); // both starts read the stale lock before either takes it over
  assert.equal(takeOverStaleLock(file, stale), true, 'the first takeover moves the stale lock aside');
  writeFileSync(file, `${process.pid}\n`, { flag: 'wx' }); // the winner creates its own lock
  assert.equal(takeOverStaleLock(file, stale), false, 'the second takeover finds a live lock, puts it back, and is refused');
  assert.equal(readFileSync(file, 'utf8').trim(), String(process.pid), "the winner's lock is in place");
});

// M-3. A failed re-login leaves the previous owner token in place.
test('a failed re-login leaves the previous owner token in place (M-3)', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({ app_secret: 'APP-SECRET-VALUE-M3', owner_token: 'PREVIOUS-OWNER-TOKEN-1' });
  const state = { ...fakeState(), save() { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
  await assert.rejects(
    loginToStore(config, { secrets, state }),
    (err) => err.kind === 'CONFIG' && /the previous owner_token entry is in place again, so nothing is stored/.test(err.message),
  );
  assert.equal(secrets.get('owner_token'), 'PREVIOUS-OWNER-TOKEN-1');
  assert.deepEqual(secrets.removes, [], 'the previous entry is restored, not removed');
});

// M-4. An audit write that fails after the store does not fail the login; the output says so.
test('an audit write that fails after the store does not fail the login, and the output says so (M-4)', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({ app_secret: 'APP-SECRET-VALUE-M4' });
  const state = fakeState();
  const out = collector();
  const audit = {
    record() {
      throw Object.assign(new Error('disk full'), { name: 'AuditDiskFullError' });
    },
  };
  const result = await loginToStore(config, { secrets, state, audit, out });
  assert.equal(result, 'stored');
  assert.deepEqual(secrets.writes, ['owner_token']);
  assert.ok(state.get('token', undefined), 'the token record is saved');
  assert.match(out.text(), /warning: the audit line was not written \(AuditDiskFullError\)/);
});

// M-7. The help lists --port for auth facebook, and the port reaches the approval receiver and the redirect URI.
test('the help lists --port for auth facebook (M-7)', () => {
  const run = spawnSync(process.execPath, [BIN, 'auth', 'facebook', '--help'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /--port <port>/);
});

test('auth facebook passes its --port to the approval receiver and into the redirect URI (M-7)', async (t) => {
  const config = configFrom(t);
  const out = collector();
  const seen = [];
  await runAuthFacebook({
    config,
    secrets: fakeSecrets({}),
    state: fakeState(),
    audit: { record() {} },
    out,
    port: 9123,
    receiveToken: async (args) => {
      seen.push(args);
      return { token: 'FB-TOKEN-VALUE-PORT-1', expiresInSeconds: null };
    },
    createClient: linkedClient,
  });
  assert.equal(seen[0].port, 9123);
  const line = out.text().split('\n').find((l) => l.startsWith('https://www.facebook.com/dialog/oauth'));
  assert.equal(new URL(line).searchParams.get('redirect_uri'), 'http://127.0.0.1:9123/facebook-callback');
});

// M-8. The granted scopes are recorded when the exchange returns them; otherwise the requested scopes go under scopesRequested.
test('the granted scopes are recorded when the exchange returns them (M-8)', async (t) => {
  const config = configFrom(t);
  const state = fakeState();
  await loginToStore(config, {
    state,
    exchangeShort: async () => ({ accessToken: 'EAAB-SHORT-M8-VALUE', userId: OWNER_ID, grantedScopes: ['instagram_business_basic'] }),
  });
  const record = state.get('token', undefined);
  assert.deepEqual(record.scopes, ['instagram_business_basic']);
  assert.deepEqual(record.scopesRequested, INSTAGRAM_SCOPES);
});

test('the requested scopes go under scopesRequested, and scopes stays empty, when no granted list is returned (M-8)', async (t) => {
  const config = configFrom(t);
  const state = fakeState();
  await loginToStore(config, { state });
  const record = state.get('token', undefined);
  assert.deepEqual(record.scopes, []);
  assert.deepEqual(record.scopesRequested, INSTAGRAM_SCOPES);
});

// M-9. A Page-list response over the cap is refused with an error that names the step, and stores nothing.
test('a Page-check response over the cap is refused, and stores nothing (M-9)', async (t) => {
  const config = configFrom(t);
  const secrets = fakeSecrets({});
  const state = fakeState();
  const fetchImpl = async () => new Response('x'.repeat(PAGE_LIST_LIMIT + 10), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    runAuthFacebook({
      config,
      secrets,
      state,
      audit: { record() {} },
      out: () => {},
      fetchImpl,
      receiveToken: async () => ({ token: 'FB-TOKEN-VALUE-BIG-1', expiresInSeconds: null }),
    }),
    (err) => err.kind === 'API_ERROR' && /^the Page check failed: /.test(err.message),
  );
  assert.deepEqual(secrets.writes, []);
  assert.deepEqual(state.log.sets, []);
});

// M-10. The Facebook approval's expiry is recorded when it gave one, and recorded as unknown when it did not.
test('an approval with expires_in records the expiry (M-10)', async (t) => {
  const config = configFrom(t);
  const state = fakeState();
  await runAuthFacebook({
    config,
    secrets: fakeSecrets({}),
    state,
    audit: { record() {} },
    out: () => {},
    now: () => Date.parse('2026-10-22T10:00:00.000Z'),
    receiveToken: async () => ({ token: 'FB-TOKEN-VALUE-EXP-1', expiresInSeconds: 5000 }),
    createClient: linkedClient,
  });
  assert.deepEqual(state.get('facebookToken', undefined), {
    obtainedAt: '2026-10-22T10:00:00.000Z',
    expiresAt: '2026-10-22T11:23:20.000Z',
    expiryKnown: true,
  });
});

test('an approval without expires_in records the expiry as unknown, and invents no lifetime (M-10)', async (t) => {
  const config = configFrom(t);
  const state = fakeState();
  const out = collector();
  await runAuthFacebook({
    config,
    secrets: fakeSecrets({}),
    state,
    audit: { record() {} },
    out,
    now: () => Date.parse('2026-10-22T10:00:00.000Z'),
    receiveToken: async () => ({ token: 'FB-TOKEN-VALUE-EXP-2', expiresInSeconds: null }),
    createClient: linkedClient,
  });
  assert.deepEqual(state.get('facebookToken', undefined), {
    obtainedAt: '2026-10-22T10:00:00.000Z',
    expiresAt: null,
    expiryKnown: false,
  });
  assert.match(out.text(), /recorded as unknown/);
});

// P4 review M-11. A corrupt state file, with five audited likes today, starts stopped with STATE_CORRUPT. The like cap shows the
// five, because the counters are rebuilt from the audit file. A damaged audit line is counted, not read. The token record is not in
// the audit file, so it is empty, and the recovery record says so. The damaged copy is kept.
test('a corrupt-state start with five audited likes today shows five against the like cap, and an empty token record', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  const NOW = Date.parse('2026-10-21T12:00:00.000Z');
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  const auditFile = join(dataDir, 'audit.jsonl');
  const writer = createAudit({ file: auditFile, now: () => NOW - 60 * 1000 });
  for (let i = 0; i < 5; i += 1) {
    writer.record({ action: 'like', target: `media-${i}`, route: 'official', outcome: 'ok', detail: null });
  }
  appendFileSync(auditFile, 'a line cut short by a crash\n');
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-REBUILD' }),
    dataDir,
    now: () => NOW,
  });
  assert.equal(built.guard.stopStatus().kind, 'STATE_CORRUPT');
  assert.equal(existsSync(join(dataDir, 'state.json.corrupt')), true, 'the damaged file is kept as a copy');

  const usage = await built.service.capsStatus();
  assert.equal(usage.likes.day.used, 5, 'the five audited likes count against the like cap');
  assert.equal(usage.likes.day.limit, built.config.caps.likes.perDay);
  assert.equal(usage.outbound.day.used, 5);

  const status = await built.service.status();
  assert.equal(status.recovery.counters, 'rebuilt from the audit file');
  assert.deepEqual(status.recovery.counted, { outbound: 5, likes: 5 });
  assert.equal(status.recovery.damagedAuditLines, 1, 'the cut-short line is counted, and skipped');
  // Added in the P4 final round (N-4): the recovery note names the damaged line, and that the counts may be low by it.
  assert.equal(status.recovery.note, '1 damaged audit line skipped; the counts may be low by up to 1');
  assert.match(status.recovery.authRecord, /^empty; run ig auth login/);
  assert.equal(built.state.get('token', undefined), undefined, 'the token record is empty');

  const rebuildLines = (await built.audit.read({ limit: 100 })).filter((line) => line.action === 'capsRebuild');
  assert.deepEqual(rebuildLines.map((line) => [line.outcome, line.detail.counted]), [['ok', { outbound: 5, likes: 5 }]]);
});

// P4 review M-11. A state with no audit file rebuilds to zero, and the recovery record says the counters were rebuilt from the
// audit file, with nothing in it.
test('a corrupt-state start with no audit file records a rebuild with no counts', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-NOAUDIT' }),
    dataDir,
    now: () => Date.parse('2026-10-21T12:00:00.000Z'),
  });
  const status = await built.service.status();
  assert.deepEqual(status.recovery.counted, {}, 'no entries are counted when there is no audit file');
  assert.equal(status.recovery.auditLinesCounted, 0);
  assert.equal(status.recovery.damagedAuditLines, 0);
});

// P4 review M-11. A state that parses is not rebuilt, so the recovery record is absent.
test('a readable state file is not rebuilt, so there is no recovery record', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify({ 'caps.likes': [] }));
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-READABLE' }),
    dataDir,
    now: () => Date.parse('2026-10-21T12:00:00.000Z'),
  });
  assert.equal((await built.service.status()).recovery, null);
});

// P4 review M-5, at the recovery. A save that fails, because the damaged file has no copy yet, does not refuse the start. The
// rebuilt counters and the recovery record are kept in process, and the audit line still records the rebuild.
test('a recovery whose save fails is kept in process, and does not refuse the start (M-5)', (t) => {
  const NOW = Date.parse('2026-10-21T12:00:00.000Z');
  const data = new Map();
  const state = {
    get: (key, fallback) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
    set: (key, value) => {
      data.set(key, structuredClone(value));
    },
    save: () => {
      throw new IgError('CONFIG', 'the damaged state file has no copy yet; do not send it');
    },
  };
  const audited = [];
  const audit = {
    scanSince: (since, visit) => {
      visit({ at: new Date(NOW - 60 * 1000).toISOString(), action: 'like', outcome: 'ok', target: null });
      return { damaged: 0, visited: 1 };
    },
    record: (entry) => audited.push(entry),
  };
  assert.doesNotThrow(() => recoverFromAudit({ state, audit, caps: configFrom(t).caps, now: () => NOW }));
  assert.equal(state.get('recovery', null).counted.likes, 1, 'the rebuilt counter is kept in process');
  assert.deepEqual(audited.map((entry) => [entry.action, entry.outcome]), [['capsRebuild', 'ok']]);
});

// ---------- The inbound wiring (P4 review, the notify step) ----------
// A fake Graph for the poller and the sends. It answers the owner's conversations and their messages, records each send, and
// answers anything else with an error. It makes no network call: buildServe is given it as fetchImpl.
const INBOUND_NOW = Date.parse('2026-10-21T12:00:00.000Z');
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const SENDER = '17841400000000002';
const APP_SECRET_VALUE = 'APP-SECRET-VALUE-INBOUND';
const INBOUND_RULES = [{ keyword: 'price', reply: 'The price is in our bio.' }];

function fakeGraph({ conversations = [], messages = {} } = {}) {
  const sent = [];
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push(url);
    const { pathname } = new URL(url);
    // Every answer carries an app usage reading: an official send needs one (the usage gate refuses a send without it).
    const json = (value, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: {
          'content-type': 'application/json',
          'x-app-usage': JSON.stringify({ call_count: 1, total_time: 1, total_cputime: 1 }),
        },
      });
    if (init.method === 'POST' && pathname.endsWith('/messages')) {
      sent.push(typeof init.body === 'string' ? JSON.parse(init.body) : init.body);
      return json({ message_id: `m-sent-${sent.length}` });
    }
    if (pathname.endsWith('/conversations')) return json({ data: conversations });
    const thread = /\/([^/]+)\/messages$/.exec(pathname);
    if (thread !== null) return json({ data: messages[thread[1]] ?? [] });
    return json({ error: { message: 'not in the fake Graph', code: 100 } }, 400);
  };
  return { fetchImpl, sent, requests };
}

// A message row as the thread read receives it, from SENDER to the owner.
function messageRow(id, { text, at }) {
  return { id, created_time: new Date(at).toISOString(), from: { id: SENDER }, to: { data: [{ id: OWNER_ID }] }, message: text };
}

// A signed webhook POST with one message from SENDER. at is in milliseconds, as Meta sends it.
function webhookPost(mid, { text, at }) {
  const rawBody = JSON.stringify({
    object: 'instagram',
    entry: [{ id: OWNER_ID, time: at, messaging: [{ sender: { id: SENDER }, recipient: { id: OWNER_ID }, timestamp: at, message: { mid, text } }] }],
  });
  const signature = `sha256=${createHmac('sha256', APP_SECRET_VALUE).update(rawBody).digest('hex')}`;
  return { method: 'POST', headers: { 'x-hub-signature-256': signature }, query: {}, rawBody };
}

// A built service over the fake Graph, with the webhook on and auto-replies as given.
function inboundBuild(t, { graph, autoReply }) {
  const config = configFrom(t, {
    webhook: { enabled: true, path: '/webhooks/instagram' },
    autoReply: { enabled: autoReply, rules: INBOUND_RULES },
  });
  return buildServe({
    config,
    secrets: fakeSecrets({
      owner_token: 'OWNER-TOKEN-VALUE-INBOUND',
      app_secret: APP_SECRET_VALUE,
      webhook_verify_token: 'VERIFY-TOKEN-VALUE-INBOUND',
    }),
    dataDir: tempDir(t),
    now: () => INBOUND_NOW,
    fetchImpl: graph.fetchImpl,
    sleep: async () => {},
  });
}

// Wraps the service's inbound hook, so that a test sees each call and can wait for the work the calls start.
function trackInbound(built) {
  const seen = [];
  const pending = [];
  const original = built.service.onInbound;
  built.service.onInbound = (event) => {
    seen.push(event);
    const started = original(event);
    pending.push(started);
    return started;
  };
  return { seen, settled: () => Promise.all(pending) };
}

// P4 review, inbound wiring. With auto-replies off (the default), an inbound event through the poller and through the webhook calls
// the service's inbound hook, and nothing is sent.
test('with auto-replies off, an inbound event through the poller and through the webhook calls the service callback and sends nothing', async (t) => {
  const graph = fakeGraph({
    conversations: [{ id: 'conv-1', updated_time: new Date(INBOUND_NOW - MINUTE_MS).toISOString() }],
    messages: { 'conv-1': [messageRow('mid-poll', { text: 'price?', at: INBOUND_NOW - MINUTE_MS })] },
  });
  const built = await inboundBuild(t, { graph, autoReply: false });
  const calls = trackInbound(built);
  assert.equal((await built.poller.tick()).status, 'ok');
  assert.equal((await built.webhookHandler(webhookPost('mid-web', { text: 'price?', at: INBOUND_NOW - MINUTE_MS }))).status, 200);
  await calls.settled();
  assert.deepEqual(calls.seen.map((event) => event.id), ['mid-poll', 'mid-web'], 'both paths call the service callback');
  assert.equal(graph.sent.length, 0, 'nothing is sent while auto-replies are off');
  const skipped = built.audit.read({ limit: 100 }).filter((line) => line.action === 'inbound');
  assert.deepEqual(skipped.map((line) => line.detail.split(';')[0]), ['AUTO_REPLY_OFF', 'AUTO_REPLY_OFF']);
});

// P4 review, inbound wiring. With auto-replies on and a matching rule, a matching event through the webhook is answered once, and the
// conversation cap holds back a second reply to the same sender.
test('with auto-replies on, a matching event through the webhook is replied to once, and the conversation cap holds back a second', async (t) => {
  const graph = fakeGraph();
  const built = await inboundBuild(t, { graph, autoReply: true });
  const calls = trackInbound(built);
  // A read comes first, as the poller makes it: an official send needs the usage reading that a Graph response gives.
  assert.equal((await built.poller.tick()).status, 'ok');
  assert.equal((await built.webhookHandler(webhookPost('mid-1', { text: 'price?', at: INBOUND_NOW - MINUTE_MS }))).status, 200);
  await calls.settled();
  assert.deepEqual(graph.sent, [{ recipient: { id: SENDER }, message: { text: 'The price is in our bio.' } }]);
  assert.equal((await built.webhookHandler(webhookPost('mid-2', { text: 'price again?', at: INBOUND_NOW - MINUTE_MS / 2 }))).status, 200);
  await calls.settled();
  assert.equal(graph.sent.length, 1, 'a second reply to the same conversation is refused by the cap');
  assert.ok(built.audit.read({ limit: 100 }).some((line) => line.action === 'inbound' && line.detail.startsWith('BUSY')));
});

// P4 review, inbound wiring. An auto-reply is subject to the 24-hour window: an event older than that gets no reply.
test('an auto-reply is subject to the 24-hour window: an event older than that gets no reply', async (t) => {
  const graph = fakeGraph();
  const built = await inboundBuild(t, { graph, autoReply: true });
  const calls = trackInbound(built);
  assert.equal((await built.webhookHandler(webhookPost('mid-old', { text: 'price?', at: INBOUND_NOW - 25 * HOUR_MS }))).status, 200);
  await calls.settled();
  assert.equal(graph.sent.length, 0);
  assert.ok(built.audit.read({ limit: 100 }).some((line) => line.action === 'inbound' && line.detail.startsWith('WINDOW_CLOSED')));
});

// P4 review, inbound wiring. With auto-replies on, a matching event through the poller is answered once.
test('with auto-replies on, a matching event through the poller is replied to once', async (t) => {
  const graph = fakeGraph({
    conversations: [{ id: 'conv-1', updated_time: new Date(INBOUND_NOW - MINUTE_MS).toISOString() }],
    messages: { 'conv-1': [messageRow('mid-poll', { text: 'price?', at: INBOUND_NOW - MINUTE_MS })] },
  });
  const built = await inboundBuild(t, { graph, autoReply: true });
  const calls = trackInbound(built);
  assert.equal((await built.poller.tick()).status, 'ok');
  await calls.settled();
  assert.equal(calls.seen.length, 1);
  assert.equal(graph.sent.length, 1, 'the reply is sent once');
});

// P4 review, lost-state rebuild. A state file that is gone, with audit lines, starts stopped with STATE_LOST, and the three audited
// lookups show three against the business-discovery bucket. A lookup is not an outbound action.
test('a STATE_LOST start with three audited lookups shows three against the lookup bucket', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  const writer = createAudit({ file: join(dataDir, 'audit.jsonl'), now: () => INBOUND_NOW - MINUTE_MS });
  for (let i = 0; i < 3; i += 1) {
    writer.record({ action: 'businessDiscovery', target: null, route: 'facebook', outcome: 'ok', detail: null });
  }
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-LOST' }),
    dataDir,
    now: () => INBOUND_NOW,
  });
  assert.equal(built.guard.stopStatus().kind, 'STATE_LOST');
  const usage = await built.service.capsStatus();
  assert.equal(usage.business_discovery.day.used, 3);
  assert.equal(usage.business_discovery.day.limit, built.config.caps.businessDiscovery.perDay);
  assert.equal(usage.outbound.day.used, 0);
  const status = await built.service.status();
  assert.equal(status.recovery.reason, 'state file missing (STATE_LOST)');
  assert.deepEqual(status.recovery.counted, { business_discovery: 3 });
});

// P4 review, lost-state rebuild. A STATE_LOST start over a state file that still holds a counter does not rebuild it.
test('a STATE_LOST start over a state file that still holds counters does not rebuild them', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify({ 'caps.likes': [{ at: INBOUND_NOW - MINUTE_MS, id: 'kept-1' }] }));
  const writer = createAudit({ file: join(dataDir, 'audit.jsonl'), now: () => INBOUND_NOW - MINUTE_MS });
  for (let i = 0; i < 3; i += 1) writer.record({ action: 'like', target: `media-${i}`, route: 'official', outcome: 'ok', detail: null });
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-KEPT' }),
    dataDir,
    now: () => INBOUND_NOW,
  });
  assert.equal(built.guard.stopStatus().kind, 'STATE_LOST');
  assert.equal((await built.service.status()).recovery, null, 'nothing is rebuilt');
  assert.equal((await built.service.capsStatus()).likes.day.used, 1, 'the stored count stands');
});

// P4 final N-2. After a damaged-state rebuild, the one-reply record of a comment is rebuilt from its privateReply audit line. Once the
// owner has cleared the stop, a second private reply to that comment is refused locally, with no request. The comment's time is not
// stored here, so the record is kept with the time of the audit line.
test('a damaged-state rebuild with one privateReply audit line for comment C refuses a second private reply to C with no request', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  const COMMENT = '17870913679156914';
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  createAudit({ file: join(dataDir, 'audit.jsonl'), now: () => INBOUND_NOW - HOUR_MS }).record({
    action: 'privateReply',
    target: COMMENT,
    route: 'instagram',
    outcome: 'ok',
    detail: null,
  });
  const graph = fakeGraph();
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-PRIVATE' }),
    dataDir,
    now: () => INBOUND_NOW,
    fetchImpl: graph.fetchImpl,
    sleep: async () => {},
  });
  assert.equal(built.guard.stopStatus().kind, 'STATE_CORRUPT');
  await built.service.stopClear({ confirm: true });
  await assert.rejects(
    built.service.privateReply({ commentId: COMMENT, text: 'a second reply', confirm: true }),
    (err) => err.kind === 'CAP_EXCEEDED',
  );
  assert.equal(graph.requests.length, 0, 'the local record refuses the reply before any request');
});

// P4 final N-8 and N-4. The start note of a recovery is shown once: a later start does not repeat it, and a confirmed ig_stop_clear
// removes the record, so the note does not reappear.
test('the start note of a recovery is shown once, and a confirmed ig_stop_clear removes the record so the note does not reappear', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  const build = () => buildServe({ config, secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-NOTE' }), dataDir, now: () => INBOUND_NOW });
  const shown = [];
  const err = (line) => shown.push(line);
  const first = await build();
  assert.equal(recoveryNote({ state: first.state, err }), true, 'the first start shows the note');
  assert.equal(recoveryNote({ state: first.state, err }), false, 'the same start does not show it again');
  assert.equal(shown.length, 1);
  assert.match(shown[0], /^the state was recovered \(state file unreadable\): rebuilt from the audit file\. no damaged audit line was skipped\./);
  assert.match(shown[0], /Token record: empty; run ig auth login/);

  const restarted = await build();
  assert.equal(recoveryNote({ state: restarted.state, err }), false, 'a later start does not repeat the note');
  assert.equal((await restarted.service.status()).recovery.noted, true);

  await restarted.service.stopClear({ confirm: true });
  assert.equal((await restarted.service.status()).recovery, null, 'the confirmed clear removes the record');
  const afterClear = await build();
  assert.equal(recoveryNote({ state: afterClear.state, err }), false, 'after the clear, nothing is shown');
  assert.equal(shown.length, 1, 'the note was shown once in all');
});

// P4 final N-1, through the service. An unreadable state holds ig_events_pending and ig_events_ack, and the status records that the event
// cursors are unknown. A confirmed clear starts the cursors again: the next pending carries the notice, and the event ids are the same.
test('through the service, an unreadable state holds ig_events_pending and ig_events_ack, and a confirmed clear starts the cursors again with the notice', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  const build = () => buildServe({ config, secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-HOLD' }), dataDir, now: () => INBOUND_NOW });
  const first = await build();
  for (let i = 1; i <= 9; i += 1) {
    first.events.append({
      id: `m${i}`,
      kind: 'message',
      senderId: SENDER,
      text: `hello ${i}`,
      receivedAt: new Date(INBOUND_NOW - MINUTE_MS).toISOString(),
    });
  }
  const page = await first.service.eventsPending({ limit: 20 });
  await first.service.eventsAck({ cursor: page.nextCursor });
  const idsBefore = page.events.map((event) => event.id);
  assert.equal(idsBefore.length, 9);

  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  const second = await build();
  assert.equal(second.guard.stopStatus().kind, 'STATE_CORRUPT');
  await assert.rejects(second.service.eventsPending({ limit: 20 }), (err) => err.kind === 'STOPPED');
  await assert.rejects(second.service.eventsAck({ cursor: page.nextCursor }), (err) => err.kind === 'STOPPED');
  assert.match((await second.service.status()).recovery.eventCursors, /pending and ack are held until ig_stop_clear/);
  // Added in the P4 fix round 2 (N-14): the recovery record names the exception to the cursors never moving backwards.
  assert.match((await second.service.status()).recovery.eventCursors, /owner-decided exception to the cursors never moving backwards/);

  await second.service.stopClear({ confirm: true });
  const restarted = await second.service.eventsPending({ limit: 20 });
  assert.deepEqual(restarted.events.map((event) => event.id), idsBefore, 'the event ids are the same as before');
  assert.equal(restarted.notice.kind, 'cursors_reset');
  assert.match(restarted.notice.note, /dedupe by id/);
  await second.service.eventsAck({ cursor: restarted.nextCursor });
  assert.deepEqual((await second.service.eventsPending({ limit: 20 })).events, []);
});

// P4 fix round 2, N-9. A readable state whose clear record holds no cursor keys, over an event file that holds events, starts stopped with
// STATE_LOST: the cursors are unknown and no stop was held. pending is refused until the owner clears the stop, and then the cursors start
// again with the notice, and the event ids are the same.
test('a readable state with a clear record, no cursor keys and events in the file gives STATE_LOST, and pending is refused until the clear', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  const build = () => buildServe({ config, secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-N9' }), dataDir, now: () => INBOUND_NOW });
  const first = await build();
  for (let i = 1; i <= 3; i += 1) {
    first.events.append({ id: `n${i}`, kind: 'message', senderId: SENDER, text: `hi ${i}`, receivedAt: new Date(INBOUND_NOW - MINUTE_MS).toISOString() });
  }
  const page = await first.service.eventsPending({ limit: 20 });
  await first.service.eventsAck({ cursor: page.nextCursor });
  const idsBefore = page.events.map((event) => event.id);
  // The state is readable: an older state with a clear record and none of the cursor keys is restored over the newer event file.
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify({ stop: { stopped: false, kind: null, detail: null, since: null, stops: [] } }));
  const second = await build();
  assert.equal(second.guard.stopStatus().kind, 'STATE_LOST');
  assert.equal(second.guard.stopStatus().detail, 'the event cursors are unknown');
  await assert.rejects(second.service.eventsPending({ limit: 20 }), (err) => err.kind === 'STOPPED');
  await second.service.stopClear({ confirm: true });
  const after = await second.service.eventsPending({ limit: 20 });
  assert.deepEqual(after.events.map((event) => event.id), idsBefore, 'the event ids are the same as before');
  assert.equal(after.notice.kind, 'cursors_reset');
});

// P4 fix round 2, N-10. An audit file that cannot be read during a damaged-state start: the one-reply records cannot be rebuilt, so private
// replies are refused with the cause named, and no request is made, until the owner clears the stop. The audit line of the start is still
// written, to the audit file itself, which can be written.
test('an unreadable audit file during a damaged-state start refuses a private reply with no request', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  mkdirSync(join(dataDir, 'audit.jsonl.1'));
  const graph = fakeGraph();
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-N10' }),
    dataDir,
    now: () => INBOUND_NOW,
    fetchImpl: graph.fetchImpl,
    sleep: async () => {},
  });
  const status = await built.service.status();
  assert.match(status.recovery.counters, /^not rebuilt \(/, 'the counters are not rebuilt');
  // Changed in the one-reply flag round. Old assertion (removed): the text said private replies are refused until ig_stop_clear. New: the
  // text names the flag, and says that a later start that reads the audit file clears it, and that a confirmed clear does not.
  assert.match(
    status.recovery.oneReplyRecords,
    /^not rebuilt \(.+\); the flag oneReplyUnknown is set, so private replies are refused until a later start reads the audit file; a confirmed ig_stop_clear does not lift this/,
  );
  await assert.rejects(
    built.service.privateReply({ commentId: '17870913679156914', text: 'a reply', confirm: true }),
    (err) => err.kind === 'STOPPED' && /private replies are refused: the audit file could not be read/.test(err.message),
  );
  assert.equal(graph.requests.length, 0, 'no request is made');
});

// P4 fix round 2, N-10. A failed caps scan does not drop the one-reply records: the records come from a scan of their own, which here
// succeeds, after the caps scan has failed.
test('a failed caps scan does not drop the one-reply records of a recovery', (t) => {
  const NOW = INBOUND_NOW;
  let calls = 0;
  const lines = [{ at: new Date(NOW - MINUTE_MS).toISOString(), action: 'privateReply', outcome: 'ok', target: '17870913679156914', route: 'instagram', detail: null }];
  const audit = {
    scanSince(since, visit) {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('read failed'), { code: 'EIO' });
      let visited = 0;
      for (const line of lines) {
        if (Date.parse(line.at) >= since) {
          visited += 1;
          visit(line);
        }
      }
      return { damaged: 0, visited };
    },
    record: () => {},
  };
  const data = new Map();
  const state = {
    get: (key, fallback) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
    set: (key, value) => data.set(key, structuredClone(value)),
    save: () => {},
  };
  recoverFromAudit({ state, audit, caps: configFrom(t).caps, now: () => NOW, reason: 'state file unreadable' });
  assert.equal(state.get('recovery', null).counters, 'not rebuilt (EIO); the caps start from zero');
  assert.equal(state.get('recovery', null).oneReplyRecords, '1 rebuilt from the audit file');
  assert.deepEqual(Object.keys(state.get('private_replies', {})), ['17870913679156914']);
  // Changed in the one-reply flag round. Old assertion (removed): state.get('private_replies_unverified', null) is null. New: the flag that
  // the one-reply scan sets, oneReplyUnknown, is null, because the one-reply scan succeeded here.
  assert.equal(state.get('oneReplyUnknown', null), null, 'the private replies are not refused');
});

// P4 fix round 2, N-12. The token-record instruction stays while the record is absent, also after a confirmed clear of the recovery.
test('after a confirmed clear of a recovery, tokenStatus still says to run ig auth login while the token record is absent', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-N12' }),
    dataDir,
    now: () => INBOUND_NOW,
  });
  assert.match((await built.service.tokenStatus()).warning, /run ig auth login/);
  await built.service.stopClear({ confirm: true });
  assert.equal((await built.service.status()).recovery, null);
  const after = await built.service.tokenStatus();
  assert.equal(after.known, false);
  assert.equal(after.warning, 'the token record is empty; run ig auth login to write it again');
});

// The one-reply flag (P4 fix round 2, the one-reply gap). A failed one-reply scan sets the flag, with its time. A confirmed clear of the stop does
// not clear it, and privateReply is refused with no request. A later start that reads the audit file rebuilds the records and clears the flag.
// Then the rebuilt record refuses a second reply to the comment, with no request, as in normal operation.
test('a failed one-reply scan sets the flag; a confirmed clear does not clear it; privateReply is refused with no request until a successful rebuild on a later start clears it', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  const COMMENT = '17870913679156914';
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  const blocked = join(dataDir, 'audit.jsonl.1');
  mkdirSync(blocked);
  const graph = fakeGraph();
  const build = () =>
    buildServe({
      config,
      secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-FLAG' }),
      dataDir,
      now: () => INBOUND_NOW,
      fetchImpl: graph.fetchImpl,
      sleep: async () => {},
    });

  const first = await build();
  const flag = first.state.get('oneReplyUnknown', null);
  assert.equal(flag.oneReplyUnknown, true, 'the failed scan sets the flag');
  assert.equal(flag.since, new Date(INBOUND_NOW).toISOString(), 'with the time of the failure');
  assert.equal((await first.service.status()).oneReplyUnknown.oneReplyUnknown, true, 'the status shows the flag');
  await assert.rejects(
    first.service.privateReply({ commentId: COMMENT, text: 'a reply', confirm: true }),
    (err) => err.kind === 'STOPPED' && /private replies are refused/.test(err.message),
  );

  assert.equal((await first.service.stopClear({ confirm: true })).result, 'cleared');
  assert.equal((await first.service.status()).stop.stopped, false, 'the stop is cleared');
  assert.equal((await first.service.status()).oneReplyUnknown.oneReplyUnknown, true, 'a confirmed clear does not clear the flag');
  await assert.rejects(
    first.service.privateReply({ commentId: COMMENT, text: 'a reply', confirm: true }),
    (err) => err.kind === 'STOPPED' && /private replies are refused/.test(err.message),
    'the refusal holds after the clear',
  );
  assert.equal(graph.requests.length, 0, 'no request is made while the flag is set');

  // A later start, with the audit file readable and a privateReply line for the comment, rebuilds the records and clears the flag.
  rmSync(blocked, { recursive: true, force: true });
  createAudit({ file: join(dataDir, 'audit.jsonl'), now: () => INBOUND_NOW - HOUR_MS }).record({
    action: 'privateReply',
    target: COMMENT,
    route: 'instagram',
    outcome: 'ok',
    detail: null,
  });
  const later = await build();
  assert.equal(later.state.get('oneReplyUnknown', null), null, 'the successful rebuild clears the flag');
  assert.equal((await later.service.status()).oneReplyUnknown, null, 'the status no longer shows it');
  assert.equal(later.state.get('private_replies', {})[COMMENT].released, false, 'the record of the comment is rebuilt');
  await assert.rejects(
    later.service.privateReply({ commentId: COMMENT, text: 'a second reply', confirm: true }),
    (err) => err.kind === 'CAP_EXCEEDED',
    'the rebuilt record refuses a second reply',
  );
  assert.equal(graph.requests.length, 0, 'the second reply makes no request');
  const rebuilds = (await later.audit.read({ limit: 100 })).filter((line) => line.action === 'oneReplyRebuild');
  assert.deepEqual(rebuilds.map((line) => line.outcome), ['ok'], 'the retry is audited');
});

// P5a round 1, I-1. A damaged line in a retained audit file may be a private reply, so the one-reply scan is unknown: the flag is set, and
// privateReply is refused with no request, with the stop cleared too. The damaged line here is a torn privateReply line, cut short.
test('a damaged privateReply line inside the window sets the flag, and privateReply is refused with no request', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  const COMMENT = '17870913679156914';
  const TORN = '17870913679156915';
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  writeFileSync(
    join(dataDir, 'audit.jsonl'),
    `{"at":"${new Date(INBOUND_NOW - HOUR_MS).toISOString()}","action":"privateReply","target":"${TORN}","outcome":"ok"\n`,
  );
  const graph = fakeGraph();
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-DAMAGED' }),
    dataDir,
    now: () => INBOUND_NOW,
    fetchImpl: graph.fetchImpl,
    sleep: async () => {},
  });
  const flag = built.state.get('oneReplyUnknown', null);
  assert.equal(flag.oneReplyUnknown, true, 'the damaged line makes the scan unknown');
  assert.match(flag.reason, /1 damaged audit line in the retained audit files may be a private reply/);
  assert.match(built.state.get('recovery', null).oneReplyRecords, /not known to be complete/);
  await built.service.stopClear({ confirm: true });
  await assert.rejects(
    built.service.privateReply({ commentId: COMMENT, text: 'a reply', confirm: true }),
    (err) => err.kind === 'STOPPED' && /private replies are refused/.test(err.message),
    'the flag refuses the reply after the clear',
  );
  assert.equal(graph.requests.length, 0, 'no request is made');
});

// P5a round 1, I-1. A clean one-reply scan does not set the flag: the records are rebuilt, and the recovery says so.
test('a clean one-reply scan does not set the flag', async (t) => {
  const config = configFrom(t);
  const dataDir = tempDir(t);
  const COMMENT = '17870913679156914';
  writeFileSync(join(dataDir, 'state.json'), '{ not json');
  createAudit({ file: join(dataDir, 'audit.jsonl'), now: () => INBOUND_NOW - HOUR_MS }).record({
    action: 'privateReply',
    target: COMMENT,
    route: 'instagram',
    outcome: 'ok',
    detail: null,
  });
  const built = await buildServe({
    config,
    secrets: fakeSecrets({ owner_token: 'OWNER-TOKEN-VALUE-CLEAN' }),
    dataDir,
    now: () => INBOUND_NOW,
  });
  assert.equal(built.state.get('oneReplyUnknown', null), null, 'no flag');
  assert.equal((await built.service.status()).oneReplyUnknown, null);
  assert.equal(built.state.get('recovery', null).oneReplyRecords, '1 rebuilt from the audit file');
});

// P5a round 1, M-R1-2. The flag is saved before the rest of a recovery. A save of another value that then fails leaves the flag on disk, so
// it is set on reload. The failing write here is the second one of the recovery (the write of the counters and the records), and its error
// reaches the caller, as a disk error does for any recovery save.
test('a flag set by a recovery is on disk before a failed save of another value, so it is set on reload (M-R1-2)', async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'state.json');
  writeFileSync(file, JSON.stringify({ 'caps.likes': [] }));
  let writes = 0;
  const fsSwitch = {
    ...nodeFsForCli,
    openSync: (path, flags, ...rest) => {
      if (flags === 'w') {
        writes += 1;
        if (writes > 1) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      }
      return nodeFsForCli.openSync(path, flags, ...rest);
    },
  };
  const state = await createState({ file, fs: fsSwitch });
  const failingAudit = {
    scanSince() {
      throw Object.assign(new Error('read failed'), { code: 'EIO' });
    },
    record: () => {},
  };
  assert.throws(
    () => recoverFromAudit({ state, audit: failingAudit, caps: configFrom(t).caps, now: () => INBOUND_NOW, reason: 'state file unreadable' }),
    (err) => err.code === 'ENOSPC',
  );
  const reloaded = await createState({ file });
  assert.equal(reloaded.get('oneReplyUnknown', null).oneReplyUnknown, true, 'the flag reached the file before the failed save');
});

// ig routes clear-one-reply-flag (P5a round 1, the owner's confirmed way out). Without confirm it prints the flag, its reason and the damaged
// line count, and changes nothing. With confirm it clears the flag and writes one audit line with the action and the outcome only.
const ONE_REPLY_REASON = 'the audit file could not be read (EIO)';
function flagStateFile(dataDir) {
  const file = join(dataDir, 'state.json');
  writeFileSync(
    file,
    JSON.stringify({ oneReplyUnknown: { oneReplyUnknown: true, since: new Date(INBOUND_NOW).toISOString(), reason: ONE_REPLY_REASON } }),
  );
  return file;
}

test('clear-one-reply-flag without --confirm prints the flag, its reason and the damaged line count, and the flag stays', async (t) => {
  const dataDir = tempDir(t);
  const stateFile = flagStateFile(dataDir);
  const auditFile = join(dataDir, 'audit.jsonl');
  writeFileSync(auditFile, `{"at":"${new Date(INBOUND_NOW - HOUR_MS).toISOString()}","action":"privateReply","target":"17870913679156915","outcome":"ok"\n`);
  const stateBefore = readFileSync(stateFile, 'utf8');
  const auditBefore = readFileSync(auditFile, 'utf8');
  const out = collector();
  const result = await runRoutesClearOneReplyFlag({
    confirm: false,
    stateFile,
    auditFile,
    out,
    serveLock: absentService,
    now: () => INBOUND_NOW,
  });
  assert.equal(result, 'preview');
  assert.match(out.text(), /One-reply flag: set since/);
  assert.match(out.text(), /Reason: the audit file could not be read \(EIO\)\./);
  assert.match(out.text(), /Damaged audit lines now: 1\./);
  assert.equal(readFileSync(stateFile, 'utf8'), stateBefore, 'the state file is not written');
  assert.equal(readFileSync(auditFile, 'utf8'), auditBefore, 'no audit line is written');
});

test('clear-one-reply-flag --confirm clears the flag, and its one audit line has the action and the outcome only', async (t) => {
  const dataDir = tempDir(t);
  const stateFile = flagStateFile(dataDir);
  const auditFile = join(dataDir, 'audit.jsonl');
  const out = collector();
  const result = await runRoutesClearOneReplyFlag({
    confirm: true,
    stateFile,
    auditFile,
    out,
    serveLock: absentService,
    now: () => INBOUND_NOW,
  });
  assert.equal(result, 'cleared');
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).oneReplyUnknown, null, 'the flag is cleared');
  const text = readFileSync(auditFile, 'utf8');
  const lines = text.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 1, 'one audit line');
  assert.deepEqual(
    [lines[0].action, lines[0].outcome, lines[0].target, lines[0].route, lines[0].detail],
    ['oneReplyFlagClear', 'ok', null, null, null],
    'the action and the outcome only',
  );
  assert.equal(text.includes('EIO'), false, 'the audit line has no reason text');
  assert.equal(text.includes('could not be read'), false);
});

test('clear-one-reply-flag refuses while a serve lock is held, and changes nothing', async (t) => {
  const dataDir = tempDir(t);
  const stateFile = flagStateFile(dataDir);
  writeFileSync(serveLockFile(dataDir), `${process.pid}\n`);
  const before = readFileSync(stateFile, 'utf8');
  const out = collector();
  await assert.rejects(
    runRoutesClearOneReplyFlag({
      confirm: true,
      stateFile,
      auditFile: join(dataDir, 'audit.jsonl'),
      out,
      serveLock: () => readServeLock(dataDir),
      now: () => INBOUND_NOW,
    }),
    (err) => err instanceof IgError && err.message === SERVE_RUNNING_MESSAGE,
  );
  assert.equal(readFileSync(stateFile, 'utf8'), before, 'the flag stays');
  assert.equal(existsSync(join(dataDir, 'audit.jsonl')), false, 'no audit line is written');
});

test('clear-one-reply-flag with no flag set changes nothing and writes no audit line', async (t) => {
  const dataDir = tempDir(t);
  const stateFile = join(dataDir, 'state.json');
  writeFileSync(stateFile, '{}');
  const out = collector();
  const result = await runRoutesClearOneReplyFlag({
    confirm: true,
    stateFile,
    auditFile: join(dataDir, 'audit.jsonl'),
    out,
    serveLock: absentService,
    now: () => INBOUND_NOW,
  });
  assert.equal(result, 'none');
  assert.match(out.text(), /No one-reply flag is set/);
  assert.equal(readFileSync(stateFile, 'utf8'), '{}');
  assert.equal(existsSync(join(dataDir, 'audit.jsonl')), false);
});

test('clear-one-reply-flag on an unreadable state changes nothing: the file is not repaired or copied', async (t) => {
  const dataDir = tempDir(t);
  const stateFile = join(dataDir, 'state.json');
  writeFileSync(stateFile, '{ not json');
  const out = collector();
  const result = await runRoutesClearOneReplyFlag({
    confirm: true,
    stateFile,
    auditFile: join(dataDir, 'audit.jsonl'),
    out,
    serveLock: absentService,
    now: () => INBOUND_NOW,
  });
  assert.equal(result, 'unreadable');
  assert.equal(readFileSync(stateFile, 'utf8'), '{ not json', 'the damaged file is left as it is');
  assert.equal(existsSync(`${stateFile}.corrupt`), false, 'no copy is made');
});

test('ig routes --help lists clear-one-reply-flag, and its --confirm option', () => {
  const group = spawnSync(process.execPath, [BIN, 'routes', '--help'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(group.status, 0, group.stderr);
  assert.match(group.stdout, /clear-one-reply-flag/);
  const command = spawnSync(process.execPath, [BIN, 'routes', 'clear-one-reply-flag', '--help'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(command.status, 0, command.stderr);
  assert.match(command.stdout, /--confirm/);
});
