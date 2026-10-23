import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canRefresh, expiryStatus, refreshToken, scheduleTokenChecks, tokenAgeHours } from '../src/token.js';
import { runTokenCheck } from '../src/cli.js';
import { createGraphClient } from '../src/graph/client.js';
import { createAudit } from '../src/audit.js';
import { createEventLog } from '../src/events.js';
import { createState } from '../src/state.js';
import { createSecrets } from '../src/secrets.js';
import { IgError } from '../src/errors.js';
import { redact } from '../src/redact.js';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const MAX_TIMER_MS = 2147483647;
const OBTAINED_MS = Date.parse('2026-10-01T00:00:00.000Z');
const OBTAINED = new Date(OBTAINED_MS).toISOString();
const EXPIRES = new Date(OBTAINED_MS + 60 * DAY_MS).toISOString();
const BASIC = ['instagram_business_basic'];
const OWNER_TOKEN = 'IGAAB_owner_token_for_tests_01';
const NEW_TOKEN = 'IGAAB_refreshed_token_for_tests_02';
const APP_SECRET = 'app_secret_for_tests_0003';
const GRAPH_CONFIG = Object.freeze({
  graph: Object.freeze({
    version: 'v26.0',
    instagramBase: 'https://graph.instagram.com',
    facebookBase: 'https://graph.facebook.com',
  }),
});

const isKind = (kind) => (err) => err instanceof IgError && err.kind === kind;

function reply(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

// A fake fetch that answers each call with the next queued response. Each call is recorded.
function fakeFetch(queue) {
  const calls = [];
  const pending = [...queue];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (pending.length === 0) throw new Error('unexpected extra request');
    return pending.shift();
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {};

// The real Graph client over a fake fetch, so no test makes a network call.
function graphClient(queue) {
  const fake = fakeFetch(queue);
  const client = createGraphClient({
    config: GRAPH_CONFIG,
    loginProduct: 'instagram',
    token: OWNER_TOKEN,
    fetchImpl: fake.fetchImpl,
    sleep: noSleep,
  });
  return { client, calls: fake.calls };
}

// A minimal client for refreshToken. It records each get and answers with the given data.
function stubClient(data) {
  const calls = [];
  const client = {
    get: async (path, query) => {
      calls.push({ path, query });
      return { data, usage: null };
    },
  };
  return { client, calls };
}

// Runs fn with a new temporary directory, then removes it.
async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-token-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

test('tokenAgeHours counts the hours from obtainedAt to now', () => {
  assert.equal(tokenAgeHours({ obtainedAt: OBTAINED, now: OBTAINED_MS + 36 * HOUR_MS }), 36);
  assert.equal(tokenAgeHours({ obtainedAt: OBTAINED_MS, now: OBTAINED_MS + 2 * HOUR_MS }), 2);
});

test('tokenAgeHours refuses a time after now, an impossible date and a time without milliseconds', () => {
  assert.throws(() => tokenAgeHours({ obtainedAt: OBTAINED, now: OBTAINED_MS - 1 }), isKind('VALIDATION'));
  assert.throws(() => tokenAgeHours({ obtainedAt: '2026-09-31T00:00:00.000Z', now: OBTAINED_MS }), isKind('VALIDATION'));
  assert.throws(() => tokenAgeHours({ obtainedAt: '2026-10-01T00:00:00Z', now: OBTAINED_MS }), isKind('VALIDATION'));
});

test('canRefresh is false below 24 hours and true at 24 hours', () => {
  const base = { obtainedAt: OBTAINED, expiresAt: EXPIRES, scopes: BASIC };
  assert.equal(canRefresh({ ...base, now: OBTAINED_MS + DAY_MS - 1 }), false);
  assert.equal(canRefresh({ ...base, now: OBTAINED_MS + DAY_MS }), true);
});

test('canRefresh is false once the token has expired', () => {
  const base = { obtainedAt: OBTAINED, expiresAt: EXPIRES, scopes: BASIC };
  const expiresMs = Date.parse(EXPIRES);
  assert.equal(canRefresh({ ...base, now: expiresMs - 1 }), true);
  assert.equal(canRefresh({ ...base, now: expiresMs }), false);
  assert.equal(canRefresh({ ...base, now: expiresMs + DAY_MS }), false);
});

test('canRefresh requires instagram_business_basic', () => {
  const base = { obtainedAt: OBTAINED, expiresAt: EXPIRES, now: OBTAINED_MS + 2 * DAY_MS };
  assert.equal(canRefresh({ ...base, scopes: BASIC }), true);
  assert.equal(canRefresh({ ...base, scopes: ['instagram_business_manage_messages'] }), false);
  assert.equal(canRefresh({ ...base, scopes: [] }), false);
  assert.throws(() => canRefresh({ ...base, scopes: 'instagram_business_basic' }), isKind('VALIDATION'));
});

test('canRefresh returns false, and does not throw, when obtainedAt is missing, a string or NaN', () => {
  const base = { expiresAt: EXPIRES, now: OBTAINED_MS + 2 * DAY_MS, scopes: BASIC };
  assert.equal(canRefresh({ ...base, obtainedAt: undefined }), false, 'missing obtainedAt');
  assert.equal(canRefresh({ ...base, obtainedAt: String(OBTAINED_MS) }), false, 'numeric string obtainedAt');
  assert.equal(canRefresh({ ...base, obtainedAt: '2026-10-01T00:00:00Z' }), false, 'ISO string without milliseconds');
  assert.equal(canRefresh({ ...base, obtainedAt: NaN }), false, 'NaN obtainedAt');
});

test('canRefresh returns false, and does not throw, when now is missing, a string or NaN', () => {
  const base = { obtainedAt: OBTAINED, expiresAt: EXPIRES, scopes: BASIC };
  assert.equal(canRefresh({ ...base, now: undefined }), false, 'missing now');
  assert.equal(canRefresh({ ...base, now: String(OBTAINED_MS + 2 * DAY_MS) }), false, 'numeric string now');
  assert.equal(canRefresh({ ...base, now: NaN }), false, 'NaN now');
});

test('canRefresh returns false, and does not throw, when expiresAt is missing, a string or NaN', () => {
  const base = { obtainedAt: OBTAINED, now: OBTAINED_MS + 2 * DAY_MS, scopes: BASIC };
  assert.equal(canRefresh({ ...base, expiresAt: undefined }), false, 'missing expiresAt');
  assert.equal(canRefresh({ ...base, expiresAt: String(Date.parse(EXPIRES)) }), false, 'numeric string expiresAt');
  assert.equal(canRefresh({ ...base, expiresAt: NaN }), false, 'NaN expiresAt');
});

test('refreshToken requests grant_type ig_refresh_token', async () => {
  const stub = stubClient({ access_token: NEW_TOKEN, token_type: 'bearer', expires_in: 5183999 });
  const result = await refreshToken({ loginProduct: 'instagram', client: stub.client });
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].path, 'refresh_access_token');
  assert.deepEqual(stub.calls[0].query, { grant_type: 'ig_refresh_token' });
  assert.deepEqual(result, { token: NEW_TOKEN, expiresInSeconds: 5183999 });
});

test('refresh sends the token only in the Bearer header, never in the query', async () => {
  const { client, calls } = graphClient([
    reply(200, { access_token: NEW_TOKEN, token_type: 'bearer', expires_in: 5183999 }),
  ]);
  const result = await refreshToken({ loginProduct: 'instagram', client });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/v26.0/refresh_access_token');
  assert.equal(url.searchParams.get('grant_type'), 'ig_refresh_token');
  assert.equal(url.searchParams.has('access_token'), false);
  assert.equal(calls[0].url.includes(OWNER_TOKEN), false);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${OWNER_TOKEN}`);
  assert.equal(result.token, NEW_TOKEN);
});

test('the Graph client refuses the token in a refresh query', async () => {
  const { client, calls } = graphClient([]);
  await assert.rejects(client.get('refresh_access_token', { access_token: OWNER_TOKEN }), isKind('CONFIG'));
  assert.equal(calls.length, 0);
});

test('refreshToken refuses a response with no usable token or expiry', async () => {
  const missingToken = stubClient({ token_type: 'bearer', expires_in: 5183999 });
  const shortToken = stubClient({ access_token: 'short', expires_in: 5183999 });
  const noExpiry = stubClient({ access_token: NEW_TOKEN });
  const zeroExpiry = stubClient({ access_token: NEW_TOKEN, expires_in: 0 });
  const emptyBody = stubClient(null);
  await assert.rejects(refreshToken({ loginProduct: 'instagram', client: missingToken.client }), isKind('API_ERROR'));
  await assert.rejects(refreshToken({ loginProduct: 'instagram', client: shortToken.client }), isKind('API_ERROR'));
  await assert.rejects(refreshToken({ loginProduct: 'instagram', client: noExpiry.client }), isKind('API_ERROR'));
  await assert.rejects(refreshToken({ loginProduct: 'instagram', client: zeroExpiry.client }), isKind('API_ERROR'));
  await assert.rejects(refreshToken({ loginProduct: 'instagram', client: emptyBody.client }), isKind('API_ERROR'));
});

test('a token from a refresh response is registered on receipt, so an audit line masks it', () =>
  withTempDir(async (dir) => {
    const file = join(dir, 'audit.jsonl');
    const { client } = stubClient({ access_token: NEW_TOKEN, token_type: 'bearer', expires_in: 5183999 });
    const { token } = await refreshToken({ loginProduct: 'instagram', client });
    createAudit({ file }).record({ action: 'token.refresh', outcome: 'ok', detail: { note: `issued ${token}` } });
    assert.equal(readFileSync(file, 'utf8').includes(NEW_TOKEN), false);
  }));

test('a registered token never appears in an audit line', () =>
  withTempDir(async (dir) => {
    createSecrets({ env: { IG_OWNER_TOKEN: OWNER_TOKEN }, loadKeyring: () => null }).get('owner_token');
    const file = join(dir, 'audit.jsonl');
    createAudit({ file }).record({
      action: 'token.refresh',
      outcome: 'failed',
      detail: { note: `sent with ${OWNER_TOKEN}`, owner: OWNER_TOKEN },
    });
    assert.equal(readFileSync(file, 'utf8').includes(OWNER_TOKEN), false);
  }));

test('a registered token never appears in an error message', async () => {
  createSecrets({ env: { IG_OWNER_TOKEN: OWNER_TOKEN }, loadKeyring: () => null }).get('owner_token');
  const { client } = graphClient([
    reply(400, { error: { message: `Invalid OAuth access token ${OWNER_TOKEN}`, code: 100 } }),
  ]);
  const err = await refreshToken({ loginProduct: 'instagram', client }).then(
    () => null,
    (caught) => caught,
  );
  assert.ok(err instanceof IgError);
  assert.equal(err.kind, 'API_ERROR');
  assert.equal(err.message.includes(OWNER_TOKEN), false);
  assert.equal(JSON.stringify(err.details).includes(OWNER_TOKEN), false);
});

test('scheduleTokenChecks uses an interval under 2147483647 ms', () => {
  const timers = [];
  const cleared = [];
  let runs = 0;
  const stop = scheduleTokenChecks({
    check: () => {
      runs += 1;
    },
    setIntervalImpl: (fn, ms) => {
      timers.push({ fn, ms });
      return 'handle-1';
    },
    clearIntervalImpl: (handle) => {
      cleared.push(handle);
    },
  });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, HOUR_MS);
  assert.ok(timers[0].ms < MAX_TIMER_MS);
  timers[0].fn();
  assert.equal(runs, 1);
  stop();
  stop();
  assert.deepEqual(cleared, ['handle-1'], 'stop clears the timer once');
});

test('scheduleTokenChecks refuses an interval over the timer limit, and accepts the limit itself', () => {
  const common = { check: () => {}, setIntervalImpl: () => 'handle', clearIntervalImpl: () => {} };
  assert.doesNotThrow(() => scheduleTokenChecks({ ...common, intervalMs: MAX_TIMER_MS }));
  assert.throws(() => scheduleTokenChecks({ ...common, intervalMs: MAX_TIMER_MS + 1 }), isKind('VALIDATION'));
  assert.throws(() => scheduleTokenChecks({ ...common, intervalMs: 0 }), isKind('VALIDATION'));
});

test('tokens are never written to a file', () =>
  withTempDir(async (dir) => {
    const keyring = { store: new Map() };
    class Entry {
      constructor(service, account) {
        this.key = `${service}/${account}`;
      }
      getPassword() {
        return keyring.store.has(this.key) ? keyring.store.get(this.key) : null;
      }
      setPassword(value) {
        keyring.store.set(this.key, value);
      }
      deletePassword() {
        return keyring.store.delete(this.key);
      }
    }
    const secrets = createSecrets({ env: { IG_OWNER_TOKEN: OWNER_TOKEN }, loadKeyring: () => ({ Entry }) });
    // The data directory holds the three files the service writes: the audit log, the state and the events. All three are
    // written here and scanned below (F-15, Task 9 M-5).
    const dataFiles = { audit: join(dir, 'audit.jsonl'), state: join(dir, 'state.json'), events: join(dir, 'events.jsonl') };
    const audit = createAudit({ file: dataFiles.audit });
    const state = await createState({ file: dataFiles.state });
    const events = createEventLog({ file: dataFiles.events, state, retentionDays: 30, now: () => OBTAINED_MS + 2 * DAY_MS });
    secrets.set('app_secret', APP_SECRET);
    const owner = secrets.get('owner_token');
    const { client } = graphClient([
      reply(200, { access_token: NEW_TOKEN, token_type: 'bearer', expires_in: 5183999 }),
    ]);
    const refreshed = await refreshToken({ loginProduct: 'instagram', client });
    audit.record({ action: 'token.refresh', outcome: 'ok', detail: { note: `new ${refreshed.token}` } });
    // The service stores the token record in the state, and the event log stores inbound text, which is masked before it
    // is written. A token in that text must not reach the file.
    state.set('token', { obtainedAt: OBTAINED, expiresAt: EXPIRES, scopes: BASIC });
    state.save();
    events.append({
      id: 'evt-scan-1',
      kind: 'message',
      senderId: '17841400000000002',
      text: `the text holds ${refreshed.token}`,
      receivedAt: new Date(OBTAINED_MS + DAY_MS).toISOString(),
    });

    let tick = null;
    const stop = scheduleTokenChecks({
      check: () => audit.record({ action: 'token.check', outcome: 'ok', detail: { note: `owner ${owner}` } }),
      setIntervalImpl: (fn) => {
        tick = fn;
        return 'handle';
      },
      clearIntervalImpl: () => {},
    });
    tick();
    stop();
    canRefresh({ obtainedAt: OBTAINED, expiresAt: EXPIRES, now: OBTAINED_MS + 2 * DAY_MS, scopes: BASIC });

    const files = listFiles(dir);
    assert.ok(files.length > 0, 'the audit file exists, so the scan is not empty');
    for (const path of Object.values(dataFiles)) {
      assert.ok(files.includes(path), `the scan covers ${path}`);
    }
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const secret of [OWNER_TOKEN, NEW_TOKEN, APP_SECRET]) {
        assert.equal(text.includes(secret), false, `${file} holds a token`);
      }
    }
    assert.equal(JSON.stringify(redact({ value: APP_SECRET })).includes(APP_SECRET), false);
  }));

// F-13 (Task 9 deferred). A client whose product is not Instagram Login is refused before any request, so the Instagram token
// is never sent to the Facebook host. A missing product is refused too.
test('refreshToken refuses a client that is not Instagram Login, before any request (F-13)', async () => {
  for (const loginProduct of ['facebook', undefined]) {
    const stub = stubClient({ access_token: NEW_TOKEN, expires_in: 5184000 });
    await assert.rejects(refreshToken({ client: stub.client, loginProduct }), isKind('CONFIG'), String(loginProduct));
    assert.equal(stub.calls.length, 0, `no request is made for ${String(loginProduct)}`);
  }
});

test('refreshToken with an Instagram Login client still refreshes (F-13)', async () => {
  const stub = stubClient({ access_token: NEW_TOKEN, expires_in: 5184000 });
  const result = await refreshToken({ client: stub.client, loginProduct: 'instagram' });
  assert.equal(result.token, NEW_TOKEN);
  assert.equal(stub.calls.length, 1);
});

// ---------- P2 (2026-10-22) ----------

test('O-6 expiryStatus gives the days left, and warns under 7 days or once the token has expired', () => {
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  const days = (n) => new Date(now + n * 24 * 60 * 60 * 1000).toISOString();
  const far = expiryStatus({ expiresAt: days(20), now });
  assert.equal(far.daysLeft, 20);
  assert.equal(far.warning, null, 'no warning with 20 days left');
  const near = expiryStatus({ expiresAt: days(6.5), now });
  assert.equal(near.daysLeft, 6, 'whole days, rounded down');
  assert.match(near.warning, /expires in 6 days/);
  const seven = expiryStatus({ expiresAt: days(7), now });
  assert.equal(seven.warning, null, 'exactly 7 days is not under 7 days');
  const expired = expiryStatus({ expiresAt: days(-1), now });
  assert.equal(expired.daysLeft, -1);
  assert.match(expired.warning, /has expired/);
});

test('A-13 the token functions refuse a null argument with VALIDATION, not a TypeError', () => {
  assert.throws(() => canRefresh(null), { kind: 'VALIDATION' });
  assert.throws(() => tokenAgeHours(null), { kind: 'VALIDATION' });
  assert.throws(() => expiryStatus(null), { kind: 'VALIDATION' });
});

// ---------- P2 fix round (2026-10-22) ----------

test('P2-M7 a token refresh that gets a 503 makes one request, and the error is reported', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ error: { message: 'down' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  };
  const waits = [];
  const client = createGraphClient({
    config: { graph: { version: 'v26.0', instagramBase: 'https://graph.instagram.com', facebookBase: 'https://graph.facebook.com' } },
    loginProduct: 'instagram',
    token: 'EAAB-REFRESH-CHECK-VALUE',
    fetchImpl,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  await assert.rejects(refreshToken({ client, loginProduct: 'instagram' }), { kind: 'API_ERROR' });
  assert.equal(calls.length, 1, 'the refresh was sent once, so the token is rotated at most once');
  assert.deepEqual(waits, [], 'no backoff was taken');
});

// ---------- A-11 (2026-10-23): the check timer ----------

test('the longest allowed interval is passed to setInterval as it is, and one timer is made', () => {
  const made = [];
  const stop = scheduleTokenChecks({
    check: () => {},
    intervalMs: MAX_TIMER_MS,
    setIntervalImpl: (fn, ms) => {
      made.push(ms);
      return 'handle-max';
    },
    clearIntervalImpl: () => {},
  });
  assert.deepEqual(made, [MAX_TIMER_MS], 'not clamped, and not split into more timers');
  assert.ok(made.every((ms) => ms <= MAX_TIMER_MS));
  stop();
});

test('the hourly check keeps running after a failing check, because runTokenCheck handles its own failure', async () => {
  let fire = null;
  const cleared = [];
  const logged = [];
  const service = {
    tokenStatus: async () => {
      throw new IgError('API_ERROR', 'the token check failed');
    },
  };
  const stop = scheduleTokenChecks({
    check: () => runTokenCheck(service, (text) => logged.push(text)),
    setIntervalImpl: (fn) => {
      fire = fn;
      return 'handle-hourly';
    },
    clearIntervalImpl: (handle) => cleared.push(handle),
  });
  // Three ticks of the interval. Each returns at once, as a timer does, so the check runs in the background.
  fire();
  fire();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(logged, Array(3).fill('token check failed (API_ERROR)'));
  stop();
  assert.deepEqual(cleared, ['handle-hourly']);
});
