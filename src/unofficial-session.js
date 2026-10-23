// The unofficial route's session: the sidecar command, the password registration, the store of the login, the restore at serve
// start, and the stop of the unofficial route. The stop holds only the unofficial route. The official routes and the account stops
// (guard.js) are not affected by it.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IgError } from './errors.js';
import { redact, registerSecret } from './redact.js';
import { prepareSession } from './unofficial/sidecar.js';

export const UNOFFICIAL_SESSION = 'unofficial_session';
export const UNOFFICIAL_USERNAME = 'unofficial_username';
// The state key of the unofficial route's stop: null when there is none, otherwise { kind, detail, since }.
export const UNOFFICIAL_STOP_KEY = 'routes.unofficial.stop';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The command that starts the sidecar: IG_PYTHON when it is set, else routes.unofficial.python from the config. The script is under
// the project root, so the working directory does not matter.
export function sidecarCommand({ config, env = process.env, root = PROJECT_ROOT } = {}) {
  const fromEnv = typeof env.IG_PYTHON === 'string' ? env.IG_PYTHON.trim() : '';
  const configured = typeof config?.routes?.unofficial?.python === 'string' ? config.routes.unofficial.python.trim() : '';
  return { command: fromEnv || configured || 'python', args: [join(root, 'sidecar', 'ig_sidecar.py')] };
}

// The stop of the unofficial route, or null when there is none. A stored value that cannot be read still stops the route (fail closed).
export function unofficialRouteStop(state) {
  const value = state.get(UNOFFICIAL_STOP_KEY, null);
  if (value === null || value === undefined) return null;
  if (isObject(value) && typeof value.kind === 'string') return value;
  return { kind: 'AUTH_EXPIRED', detail: 'the stored stop of the unofficial route cannot be read', since: null };
}

// Registers the password before any use, so every output masks it. A password the registry cannot hold (under 8 characters, or blank)
// is refused before it is sent. The message does not contain it.
export function registerPassword(password) {
  try {
    registerSecret(password);
  } catch {
    throw new IgError(
      'VALIDATION',
      'the password must be at least 8 characters long, so that it can be registered for masking; nothing was sent',
    );
  }
  return password;
}

// Stores the session and the username in the keyring, and clears the route stop. Neither goes into a file. The session strings were
// registered when the adapter received them. If a step fails, the entries written so far are put back, or removed when there was none,
// so a failed login leaves the previous state in place. The username is stored as JSON, so the entry is long enough to register.
export function storeUnofficialLogin({ secrets, state, session, username }) {
  if (!isObject(session)) throw new IgError('API_ERROR', 'the login returned no session object; nothing was stored');
  if (typeof username !== 'string' || username.trim() === '') throw new IgError('VALIDATION', 'the username is missing; nothing was stored');
  const entries = [
    { name: UNOFFICIAL_SESSION, value: JSON.stringify(session) },
    { name: UNOFFICIAL_USERNAME, value: JSON.stringify({ username }) },
  ];
  const before = new Map(entries.map(({ name }) => [name, secrets.source(name) === 'keyring' ? secrets.get(name) : null]));
  const written = [];
  try {
    for (const { name, value } of entries) {
      secrets.set(name, value);
      written.push(name);
    }
    clearRouteStop(state);
  } catch (err) {
    let restored = true;
    for (const name of written.reverse()) {
      try {
        if (before.get(name) !== null) secrets.set(name, before.get(name));
        else secrets.remove(name);
      } catch {
        restored = false;
      }
    }
    const code = err instanceof IgError ? err.kind : (err?.code ?? err?.name ?? 'error');
    if (!restored) {
      throw new IgError('CONFIG', `storing the unofficial login failed (${code}); an entry could not be restored; check the keyring before you retry`);
    }
    throw new IgError(
      'CONFIG',
      `storing the unofficial login failed (${code}); the previous entries are in place again, or the new ones were removed, so nothing is stored`,
    );
  }
}

// Sets the stop of the unofficial route and saves it. A save that fails throws.
function setRouteStop(state, stop) {
  state.set(UNOFFICIAL_STOP_KEY, stop);
  state.save();
}

// Clears the stop of the unofficial route and saves it. A save that fails throws.
export function clearRouteStop(state) {
  state.set(UNOFFICIAL_STOP_KEY, null);
  state.save();
}

// A failed restore sets the stop. The stop stays in process when its save fails, so this start still refuses the route, and the next
// start tries again.
function failRestore(state, now, detail) {
  const stop = { kind: 'AUTH_EXPIRED', detail: redact(detail).slice(0, 200), since: new Date(now()).toISOString() };
  state.set(UNOFFICIAL_STOP_KEY, stop);
  try {
    state.save();
  } catch {
    // The stop is kept in process. See above.
  }
  return { status: 'failed', stop };
}

// Restores the stored session at serve start, when the route is enabled and acknowledged and a session is stored. A session that cannot
// be read, or a restore that fails with the sidecar running, sets the stop of the unofficial route (AUTH_EXPIRED) and nothing else. A
// sidecar that could not be started, or that never answered before it ended (the sidecarStart mark from the adapter), is not an expired
// login: the stop is not set, and the status is 'unavailable'. A restore that succeeds clears a stop left by an earlier failure.
// Returns { status: 'skipped' | 'restored' | 'failed' | 'unavailable', stop?, detail? }.
export async function restoreUnofficialSession({ enabled, acknowledged, secrets, state, adapter, now = () => Date.now() }) {
  // The restore needs both the switch and the acknowledgement. With the switch off, nothing is read and the sidecar is not started, so
  // serve makes no unofficial request at start (F2-I-1).
  if (enabled !== true || acknowledged !== true) return { status: 'skipped' };
  let stored;
  try {
    stored = secrets.get(UNOFFICIAL_SESSION);
  } catch {
    return failRestore(state, now, 'the stored session cannot be read from the keyring');
  }
  if (stored === null) return { status: 'skipped' };
  let session;
  try {
    // The stored strings are registered before the session is sent, as the strings of a reply are.
    session = prepareSession(JSON.parse(stored));
  } catch {
    return failRestore(state, now, 'the stored session cannot be read');
  }
  if (!isObject(session)) return failRestore(state, now, 'the stored session is not an object');
  try {
    await adapter.restoreSession(session);
  } catch (err) {
    // The session was never sent to a running sidecar, so the login is not known to have expired.
    if (err instanceof IgError && err.details?.sidecarStart === 'failed') {
      return { status: 'unavailable', detail: err.message };
    }
    return failRestore(state, now, err instanceof IgError ? `${err.kind}: ${err.message}` : 'the restore did not complete');
  }
  try {
    clearRouteStop(state);
  } catch {
    // The cleared stop is kept in process, as for a failed restore.
  }
  return { status: 'restored' };
}
