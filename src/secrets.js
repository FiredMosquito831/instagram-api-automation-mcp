// Loads the secrets the service needs. The environment variable IG_<NAME> is read first, then the OS keyring entry
// (service, name). Every value loaded or stored is registered with redact.js before it is used, so it is masked
// wherever it would reach an output.

import { createRequire } from 'node:module';
import { IgError } from './errors.js';
import { registerSecret } from './redact.js';

export const DEFAULT_SERVICE = 'instagram-automation';
// A secret name: a letter, then letters, digits or underscores, at most 64 characters. Dashes and dots are refused, so that
// each secret has one name in the environment (IG_ and the name, upper-cased) and in the keyring.
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/i;
const nodeRequire = createRequire(import.meta.url);

// Loads @napi-rs/keyring when it is installed and its native binding loads. Otherwise returns null, so the keyring is
// reported as unavailable instead of stopping the process. The module is loaded only when a keyring value is needed.
export function defaultLoadKeyring() {
  try {
    return nodeRequire('@napi-rs/keyring');
  } catch {
    return null;
  }
}

function checkName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new IgError('VALIDATION', 'a secret name must start with a letter and hold only letters, digits or _');
  }
  return name;
}

// The environment variable for a secret: IG_ and the name, upper-cased.
export function envName(name) {
  checkName(name);
  return `IG_${name.toUpperCase()}`;
}

// Registers a value before it is used. A value that cannot be registered (too short, or blank) is refused, and the
// message does not include the value.
function register(name, value) {
  try {
    registerSecret(value);
  } catch {
    throw new IgError(
      'CONFIG',
      `secret ${name} cannot be registered for masking; a secret must be a non-blank string of at least 8 characters`,
    );
  }
  return value;
}

// Creates the secret store. env is read for IG_<NAME> variables. loadKeyring returns the keyring module, or null when
// it is unavailable. It is called at most once, on the first keyring use; a get that finds an env var never calls it.
// get returns null only when the keyring holds no entry. A keyring that is missing or throws is unavailable, so get,
// set and remove throw CONFIG.
export function createSecrets({ env = process.env, loadKeyring = defaultLoadKeyring, service = DEFAULT_SERVICE } = {}) {
  if (env === null || typeof env !== 'object') throw new IgError('CONFIG', 'createSecrets needs env as an object');
  if (typeof loadKeyring !== 'function') throw new IgError('CONFIG', 'createSecrets needs loadKeyring as a function');
  if (typeof service !== 'string' || service.trim() === '') {
    throw new IgError('CONFIG', 'createSecrets needs a non-blank service name');
  }

  let keyringLoaded = false;
  let keyring = null;

  // The keyring module, or null. A loader that throws, or a module with no Entry class, is unavailable.
  function keyringModule() {
    if (!keyringLoaded) {
      keyringLoaded = true;
      let loaded;
      try {
        loaded = loadKeyring();
      } catch {
        loaded = null;
      }
      keyring = typeof loaded?.Entry === 'function' ? loaded : null;
    }
    return keyring;
  }

  // Finds a secret. source is env, keyring, none (no entry) or unavailable (the keyring could not answer).
  function resolve(name) {
    const variable = envName(name);
    const raw = env[variable];
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== 'string') throw new IgError('CONFIG', `${variable} must be a string`);
      // A blank variable counts as absent, as config.js treats it. Surrounding whitespace, such as a newline from a pasted
      // value, is not part of the secret, so the trimmed value is registered and returned.
      const trimmed = raw.trim();
      if (trimmed !== '') return { source: 'env', value: register(name, trimmed) };
    }

    const mod = keyringModule();
    if (mod === null) return { source: 'unavailable', value: null };
    let value;
    try {
      value = new mod.Entry(service, name).getPassword();
    } catch {
      return { source: 'unavailable', value: null };
    }
    if (value === null) return { source: 'none', value: null };
    // Anything other than a non-blank string is not trusted as a secret.
    if (typeof value !== 'string' || value.trim() === '') return { source: 'unavailable', value: null };
    return { source: 'keyring', value: register(name, value.trim()) };
  }

  function unavailable(name) {
    return new IgError(
      'CONFIG',
      `the keyring is unavailable, so ${name} cannot be read; set ${envName(name)} in the environment instead`,
    );
  }

  return {
    get(name) {
      const { source, value } = resolve(name);
      if (source === 'unavailable') throw unavailable(name);
      return value;
    },

    set(name, value) {
      envName(name);
      if (typeof value !== 'string' || value.trim() === '') {
        throw new IgError('VALIDATION', `the value for ${name} must be a non-blank string`);
      }
      // The trimmed value is registered before the write, so no error text can carry it, and it is the value stored.
      const secret = register(name, value.trim());
      const mod = keyringModule();
      if (mod === null) {
        throw new IgError(
          'CONFIG',
          `no keyring is available, so ${name} cannot be stored; set ${envName(name)} in the environment instead`,
        );
      }
      try {
        new mod.Entry(service, name).setPassword(secret);
      } catch {
        throw new IgError('CONFIG', `the keyring refused to store ${name}`);
      }
    },

    // Removes the keyring entry. Returns true when an entry was removed and false when there was none.
    remove(name) {
      envName(name);
      const mod = keyringModule();
      if (mod === null) {
        throw new IgError('CONFIG', `no keyring is available, so ${name} cannot be removed`);
      }
      let removed;
      try {
        removed = new mod.Entry(service, name).deletePassword();
      } catch {
        throw new IgError('CONFIG', `the keyring could not remove ${name}`);
      }
      if (typeof removed !== 'boolean') throw new IgError('CONFIG', `the keyring gave no result for ${name}`);
      return removed;
    },

    // Where the value comes from: env, keyring, none or unavailable. Loading it registers the value, as get does.
    source(name) {
      return resolve(name).source;
    },
  };
}
