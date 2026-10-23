import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecrets, envName } from '../src/secrets.js';
import { IgError } from '../src/errors.js';
import { redact } from '../src/redact.js';
import { createAudit } from '../src/audit.js';

const SERVICE = 'instagram-automation';
const ENV_TOKEN = 'IGAAB_env_owner_token_0001';
const KEYRING_TOKEN = 'IGAAB_keyring_owner_token_0002';
const SET_TOKEN = 'IGAAB_set_owner_token_0003';
const PADDED_ENV = 'IGAAB_padded_env_token_0004';
const PADDED_KEYRING = 'IGAAB_padded_keyring_token_0005';
const PADDED_SET = 'IGAAB_padded_set_token_0006';
const PADDED_AUDIT = 'IGAAB_padded_audit_token_0008';

// A stand-in for the @napi-rs/keyring module. Entries live in a Map, so no test touches the OS credential store.
function fakeKeyring({ store = new Map(), readError = null, writeError = null } = {}) {
  const constructed = [];
  class Entry {
    constructor(service, account) {
      constructed.push({ service, account });
      this.key = `${service}/${account}`;
    }
    getPassword() {
      if (readError) throw readError;
      return store.has(this.key) ? store.get(this.key) : null;
    }
    setPassword(value) {
      if (writeError) throw writeError;
      store.set(this.key, value);
    }
    deletePassword() {
      return store.delete(this.key);
    }
  }
  return { module: { Entry }, store, constructed };
}

const isKind = (kind) => (err) => err instanceof IgError && err.kind === kind;

test('env var wins over keyring for the same name', () => {
  const keyring = fakeKeyring({ store: new Map([[`${SERVICE}/owner_token`, KEYRING_TOKEN]]) });
  const secrets = createSecrets({ env: { IG_OWNER_TOKEN: ENV_TOKEN }, loadKeyring: () => keyring.module });
  assert.equal(secrets.get('owner_token'), ENV_TOKEN);
  assert.equal(secrets.source('owner_token'), 'env');
  assert.equal(keyring.constructed.length, 0, 'the keyring is not read when the env var is set');
});

test('keyring is used when the env var is absent', () => {
  const keyring = fakeKeyring({ store: new Map([[`${SERVICE}/owner_token`, KEYRING_TOKEN]]) });
  const secrets = createSecrets({ env: {}, loadKeyring: () => keyring.module });
  assert.equal(secrets.get('owner_token'), KEYRING_TOKEN);
  assert.equal(secrets.source('owner_token'), 'keyring');
  assert.deepEqual(keyring.constructed[0], { service: SERVICE, account: 'owner_token' });
});

test('a blank env var is ignored and the keyring is used', () => {
  const keyring = fakeKeyring({ store: new Map([[`${SERVICE}/owner_token`, KEYRING_TOKEN]]) });
  const secrets = createSecrets({ env: { IG_OWNER_TOKEN: '   ' }, loadKeyring: () => keyring.module });
  assert.equal(secrets.get('owner_token'), KEYRING_TOKEN);
});

test('set throws CONFIG when no keyring is available', () => {
  const secrets = createSecrets({ env: {}, loadKeyring: () => null });
  assert.throws(() => secrets.set('owner_token', SET_TOKEN), isKind('CONFIG'));
  assert.equal(secrets.source('owner_token'), 'unavailable');
});

test('remove throws CONFIG when no keyring is available', () => {
  const secrets = createSecrets({ env: {}, loadKeyring: () => null });
  assert.throws(() => secrets.remove('owner_token'), isKind('CONFIG'));
});

test('a keyring that is missing or throws on load is reported as unavailable', () => {
  const broken = createSecrets({
    env: {},
    loadKeyring: () => {
      throw new Error('native addon not found');
    },
  });
  assert.equal(broken.source('owner_token'), 'unavailable');
  assert.throws(() => broken.get('owner_token'), isKind('CONFIG'));
});

test('get returns null only when the keyring has no entry', () => {
  const keyring = fakeKeyring();
  const secrets = createSecrets({ env: {}, loadKeyring: () => keyring.module });
  assert.equal(secrets.get('owner_token'), null);
  assert.equal(secrets.source('owner_token'), 'none');
});

test('a keyring read that throws is unavailable, not no entry', () => {
  const keyring = fakeKeyring({ readError: new Error('store is locked') });
  const secrets = createSecrets({ env: {}, loadKeyring: () => keyring.module });
  assert.throws(() => secrets.get('owner_token'), isKind('CONFIG'));
  assert.equal(secrets.source('owner_token'), 'unavailable');
});

// F-14 (Task 9 M-8). A secret has one name. Dashes and dots are refused, so the environment name and the keyring name cannot
// differ, and a stored secret cannot read as missing.
test('names map to IG_ variables, and a name with a dash or a dot is refused (F-14)', () => {
  const secrets = createSecrets({ env: { IG_API_TOKEN: ENV_TOKEN }, loadKeyring: () => null });
  assert.equal(secrets.get('api_token'), ENV_TOKEN);
  assert.equal(envName('api_token'), 'IG_API_TOKEN');
  for (const name of ['api-token', 'api.token', '', 'bad name']) {
    assert.throws(() => secrets.get(name), isKind('VALIDATION'), name);
    assert.throws(() => envName(name), isKind('VALIDATION'), name);
  }
});

test('a loaded env secret is registered, so redact masks it everywhere', () => {
  const secrets = createSecrets({ env: { IG_OWNER_TOKEN: ENV_TOKEN }, loadKeyring: () => null });
  secrets.get('owner_token');
  assert.equal(JSON.stringify(redact({ note: `token ${ENV_TOKEN}`, value: ENV_TOKEN })).includes(ENV_TOKEN), false);
});

test('a loaded keyring secret is registered, so redact masks it everywhere', () => {
  const keyring = fakeKeyring({ store: new Map([[`${SERVICE}/owner_token`, KEYRING_TOKEN]]) });
  const secrets = createSecrets({ env: {}, loadKeyring: () => keyring.module });
  secrets.get('owner_token');
  assert.equal(JSON.stringify(redact({ value: KEYRING_TOKEN })).includes(KEYRING_TOKEN), false);
});

test('a secret too short to register is refused, and its value is not echoed', () => {
  const secrets = createSecrets({ env: { IG_OWNER_TOKEN: 'pw-0123' }, loadKeyring: () => null });
  assert.throws(
    () => secrets.get('owner_token'),
    (err) => isKind('CONFIG')(err) && !err.message.includes('pw-0123'),
  );
});

test('set stores the value in the keyring and registers it', () => {
  const keyring = fakeKeyring();
  const secrets = createSecrets({ env: {}, loadKeyring: () => keyring.module });
  secrets.set('owner_token', SET_TOKEN);
  assert.equal(keyring.store.get(`${SERVICE}/owner_token`), SET_TOKEN);
  assert.equal(secrets.get('owner_token'), SET_TOKEN);
  assert.equal(secrets.source('owner_token'), 'keyring');
  assert.equal(JSON.stringify(redact({ value: SET_TOKEN })).includes(SET_TOKEN), false);
});

test('a keyring write that throws is CONFIG and does not echo the value', () => {
  const keyring = fakeKeyring({ writeError: new Error(`denied for ${SET_TOKEN}`) });
  const secrets = createSecrets({ env: {}, loadKeyring: () => keyring.module });
  assert.throws(
    () => secrets.set('owner_token', SET_TOKEN),
    (err) => isKind('CONFIG')(err) && !err.message.includes(SET_TOKEN),
  );
});

test('remove deletes the keyring entry and reports whether it existed', () => {
  const keyring = fakeKeyring({ store: new Map([[`${SERVICE}/owner_token`, KEYRING_TOKEN]]) });
  const secrets = createSecrets({ env: {}, loadKeyring: () => keyring.module });
  assert.equal(secrets.remove('owner_token'), true);
  assert.equal(secrets.remove('owner_token'), false);
  assert.equal(secrets.get('owner_token'), null);
});

test('an env value with a trailing newline is returned trimmed, and redact masks the bare token', () => {
  const secrets = createSecrets({ env: { IG_OWNER_TOKEN: `${PADDED_ENV}\n` }, loadKeyring: () => null });
  assert.equal(secrets.get('owner_token'), PADDED_ENV);
  assert.equal(redact({ note: `pasted ${PADDED_ENV} here` }).note, 'pasted [redacted] here');
});

test('a keyring value with a trailing space is returned trimmed, and redact masks the bare token', () => {
  const keyring = fakeKeyring({ store: new Map([[`${SERVICE}/owner_token`, `${PADDED_KEYRING} `]]) });
  const secrets = createSecrets({ env: {}, loadKeyring: () => keyring.module });
  assert.equal(secrets.get('owner_token'), PADDED_KEYRING);
  assert.equal(redact({ note: `token ${PADDED_KEYRING}` }).note, 'token [redacted]');
});

test('set stores and registers the trimmed value', () => {
  const keyring = fakeKeyring();
  const secrets = createSecrets({ env: {}, loadKeyring: () => keyring.module });
  secrets.set('owner_token', `${PADDED_SET}\n`);
  assert.equal(keyring.store.get(`${SERVICE}/owner_token`), PADDED_SET);
  assert.equal(redact({ note: `token ${PADDED_SET}` }).note, 'token [redacted]');
});

test('an audit line written with a padded token does not contain the bare token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ig-secrets-test-'));
  try {
    const secrets = createSecrets({ env: { IG_OWNER_TOKEN: `${PADDED_AUDIT}\n` }, loadKeyring: () => null });
    secrets.get('owner_token');
    const file = join(dir, 'audit.jsonl');
    createAudit({ file }).record({ action: 'token.check', outcome: 'ok', detail: { note: `read ${PADDED_AUDIT}` } });
    assert.equal(readFileSync(file, 'utf8').includes(PADDED_AUDIT), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A keyring whose entry holds the given stored value, which is not a usable password.
function keyringHolding(stored) {
  const keyring = fakeKeyring({ store: new Map([[`${SERVICE}/owner_token`, stored]]) });
  return createSecrets({ env: {}, loadKeyring: () => keyring.module });
}

test('a keyring password that is blank is not returned and is reported as unavailable', () => {
  const secrets = keyringHolding('   \n\t');
  assert.throws(() => secrets.get('owner_token'), isKind('CONFIG'));
  assert.equal(secrets.source('owner_token'), 'unavailable');
});

test('a keyring password that is a number is not returned and is not registered', () => {
  const secrets = keyringHolding(1234567890123);
  assert.throws(() => secrets.get('owner_token'), isKind('CONFIG'));
  assert.equal(redact({ note: 'value 1234567890123' }).note, 'value 1234567890123');
});

test('a keyring password that is an array holding a token is not returned and is not registered', () => {
  const token = 'IGAAB_array_token_0007';
  const secrets = keyringHolding([token]);
  assert.throws(() => secrets.get('owner_token'), isKind('CONFIG'));
  assert.equal(redact({ note: `token ${token}` }).note, `token ${token}`);
});
