// The setup commands, and the wiring for ig serve, ig mcp and ig status. bin/ig.js parses the command line and calls these
// functions, so every rule is here and the tests call them with fakes. Only startServe starts a listener and a poller, and
// only bin/ig.js calls it. Logs for mcp go to stderr only, because stdout carries the protocol.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAudit } from './audit.js';
import { ONE_REPLY_UNKNOWN_KEY, createCaps, createUsageGate, rebuildCapsFromAudit, rebuildPrivateReplies } from './caps.js';
import { createEventLog } from './events.js';
import { IgError } from './errors.js';
import { createGraphClient } from './graph/client.js';
import { createGuard } from './guard.js';
import { createForward, startStdio } from './mcp.js';
import { createHttpServer, listenHttp } from './http.js';
import {
  INSTAGRAM_SCOPES,
  CALLBACK_PATH,
  FACEBOOK_BRIDGE_PATH,
  FACEBOOK_SCOPES,
  PAGE_LIST_LIMIT,
  buildAuthorizeUrl,
  buildFacebookAuthorizeUrl,
  cappedFetch,
  exchangeShortLived,
  listenForFacebookToken,
  listenForRedirect,
  longLivedExchange,
  pageLinkFromAccounts,
  parseRedirect,
  randomState,
  registerToken,
} from './oauth.js';
import { redact } from './redact.js';
import { createService, createUsageHolder } from './service.js';
import { createState } from './state.js';
import { TOOLS } from './tools.js';
import { scheduleTokenChecks } from './token.js';
import { createAdapterRegistry } from './unofficial/adapter.js';
import { createJsLibAdapter } from './unofficial/jslib.js';
import { createSidecarAdapter } from './unofficial/sidecar.js';
import {
  UNOFFICIAL_SESSION,
  UNOFFICIAL_USERNAME,
  registerPassword,
  restoreUnofficialSession,
  sidecarCommand,
  storeUnofficialLogin,
} from './unofficial-session.js';
import { createPoller } from './poller.js';
import { createWebhookHandler } from './webhooks.js';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SECRET_NAMES = Object.freeze(['owner_token', 'facebook_token', 'api_token', 'app_secret', 'webhook_verify_token']);
export const ACK_KEY = 'routes.unofficial.acknowledged';
export const REDIRECT_PORT = 8790;
const TOKEN_KEY = 'token';
const FACEBOOK_RECORD_KEY = 'facebookToken';
const TOKEN_CHECK_MS = 3600000;
const STATUS_TIMEOUT_MS = 5000;
const LOOPBACK_NAMES = new Set(['127.0.0.1', '::1', 'localhost']);
const FACEBOOK_PRODUCT = 'facebook';
// The lock file that ig serve holds in the data directory while it runs. It holds the serve process id.
export const SERVE_LOCK = 'serve.lock';
export const SERVE_RUNNING_MESSAGE =
  'ig serve is running; stop it before you run this command, because two processes write the state file';

export const UNOFFICIAL_WARNING = [
  "Unofficial routes (follow, unfollow, profile edit) likely breach Instagram's Terms of Use.",
  'The account can be restricted or banned, possibly without notice.',
  'The unofficial clients send their default app or browser identity; the project adds none.',
].join('\n');

const log = (text) => process.stdout.write(`${redact(text)}\n`);
const logErr = (text) => process.stderr.write(`${redact(text)}\n`);

// The data directory. An absolute path is kept. A relative one is resolved against the project root, never the working
// directory, so the service finds the same files from any folder.
export function resolveDataDir(dataDir, root = PROJECT_ROOT) {
  if (typeof dataDir !== 'string' || dataDir.trim() === '') throw new IgError('CONFIG', 'dataDir must be a non-blank path');
  return isAbsolute(dataDir) ? resolve(dataDir) : resolve(root, dataDir);
}

// The config file: the --config option, then IG_CONFIG, then config.json in the project root when it exists.
export function resolveConfigFile({ option, env = process.env, root = PROJECT_ROOT } = {}) {
  if (typeof option === 'string' && option.trim() !== '') return resolve(option);
  const fromEnv = env.IG_CONFIG;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(fromEnv);
  const local = join(root, 'config.json');
  return existsSync(local) ? local : undefined;
}

// The files of the data directory: the state, the event log and the audit log.
export function filesFor(dataDir) {
  return {
    state: join(dataDir, 'state.json'),
    events: join(dataDir, 'events.jsonl'),
    audit: join(dataDir, 'audit.jsonl'),
  };
}

// The acknowledgement of the unofficial routes comes only from the state. A value in the config file is ignored, and the
// result says so, so the owner can be told. The loaded config is not changed.
export function applyAcknowledgement(config, stored) {
  const acknowledged = stored === true;
  const fileValue = config.routes.unofficial.acknowledged === true;
  const next = structuredClone(config);
  next.routes.unofficial.acknowledged = acknowledged;
  return { config: next, ignoredFileValue: fileValue && !acknowledged };
}

// True when a host name is a loopback address: 127.0.0.1, ::1 or localhost, with or without brackets, in any case.
function isLoopbackName(host) {
  return LOOPBACK_NAMES.has(host.trim().replace(/^\[(.*)\]$/, '$1').toLowerCase());
}

// serve binds only a loopback host without a token and without http.allowRemote. A non-loopback host needs two things. The
// first is http.allowRemote set to true: the owner's explicit acknowledgement that the HTTP API is plain HTTP. The second is
// api_token, which then travels in clear text on that network. Both refusals come before any listener is built.
export function assertServeHost({ host, apiToken, allowRemote = false }) {
  if (typeof host !== 'string') throw new IgError('CONFIG', 'http.host must be a string');
  if (isLoopbackName(host)) return;
  if (allowRemote !== true) {
    throw new IgError(
      'CONFIG',
      `serve refuses to bind ${host}: set http.allowRemote to true in the config to allow a non-loopback host. The HTTP API is plain HTTP, so api_token would travel in clear text on that network.`,
    );
  }
  if (typeof apiToken !== 'string' || apiToken.trim() === '') {
    throw new IgError('CONFIG', `serve refuses to bind ${host} without api_token; set IG_API_TOKEN or run ig auth set api_token`);
  }
}

// The line that serve prints on stderr when it starts on a non-loopback host, which http.allowRemote allows. The HTTP API is
// plain HTTP, so the bearer token and the API traffic travel unencrypted on that network. The line carries no token. A
// loopback host gives null: a loopback start prints nothing extra.
export function remoteServeWarning({ host, port }) {
  if (isLoopbackName(host)) return null;
  const bare = host.trim().replace(/^\[(.*)\]$/, '$1');
  const shown = bare.includes(':') ? `[${bare}]` : bare;
  return `warning: the HTTP API is plain HTTP on ${shown}:${port}. The bearer token (api_token) and the API traffic travel unencrypted on that network. Keep the host on loopback, or put the API behind TLS.`;
}

// Reads one value from a stream that is not a terminal: the first line.
export async function readPipedValue(stream) {
  let text = '';
  for await (const chunk of stream) text += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  return text.split(/\r?\n/, 1)[0] ?? '';
}

// Reads one value from a terminal with the echo off. Ctrl+C cancels. The value is never printed.
export function readHiddenValue(prompt, input = process.stdin, output = process.stderr) {
  return new Promise((resolveValue, rejectValue) => {
    let value = '';
    output.write(prompt);
    const finish = (error) => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (error) rejectValue(error);
      else resolveValue(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish(null);
        if (ch === '\u0003') return finish(new IgError('VALIDATION', 'input was cancelled'));
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

// Builds a Graph client for one product. A client without an onUsage callback is refused, so every response's usage can reach
// the usage gate (ruling k). The caller reads the token; this function never stores it.
export function makeGraphClient({ config, product, token, onUsage, fetchImpl, sleep }) {
  if (typeof onUsage !== 'function') throw new IgError('CONFIG', 'a Graph client is refused without onUsage');
  return createGraphClient({ config, loginProduct: product, token, onUsage, fetchImpl, sleep });
}

// Reads the account of the owner token with GET me, through the client, and compares its id with the configured owner. A
// mismatch, or an id that is missing, is refused. The messages name no token.
export async function verifyOwnerAccount({ client, owner }) {
  const response = await client.get('me', { fields: 'id' });
  const id = response?.data?.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new IgError('API_ERROR', 'Graph did not return the id of the owner token account; serve refuses to start');
  }
  if (id !== String(owner)) {
    throw new IgError('OWNER_MISMATCH', 'the owner token belongs to another account; serve refuses to start');
  }
  return id;
}

// The lock file of the data directory. ig serve writes it while it runs, and removes it at shutdown.
export const serveLockFile = (dataDir) => join(dataDir, SERVE_LOCK);

// Whether a process with this id exists. Signal 0 sends nothing. EPERM means the process exists under another user.
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

// Reads the serve lock. 'absent' when there is no lock, or when it holds the id of a process that is gone (a stale lock is
// ignored). 'running' when the id belongs to a live process. A lock that exists but cannot be read, or holds no valid id,
// is 'running', so the caller refuses; the message tells the owner what to remove.
export function readServeLock(dataDir) {
  const file = serveLockFile(dataDir);
  if (!existsSync(file)) return 'absent';
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return 'running';
  }
  const pid = Number(text.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) return 'running';
  return processAlive(pid) ? 'running' : 'absent';
}

// Takes over a stale lock (M-5). The stale lock is moved aside under a unique name first, and removed only when the file moved is
// the stale lock that was read. A live lock moved by mistake is put back, and the takeover is refused. Returns true when the caller
// may create the lock now, and false when a live lock is in place.
export function takeOverStaleLock(file, staleText) {
  const aside = `${file}.stale-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    renameSync(file, aside);
  } catch (err) {
    if (err?.code === 'ENOENT') return true;
    throw new IgError('CONFIG', `the serve lock could not be taken over (${err?.code ?? 'error'})`);
  }
  let moved = null;
  try {
    moved = readFileSync(aside, 'utf8');
  } catch {
    moved = null;
  }
  if (moved !== null && moved === staleText) {
    rmSync(aside, { force: true });
    return true;
  }
  // The file moved was not the stale lock that was read, so a live lock was moved. It goes back, and the takeover is refused.
  try {
    renameSync(aside, file);
  } catch {
    // The live lock stays under its unique name. The refusal still holds for this start.
  }
  return false;
}

// Takes the serve lock for this process. A live lock refuses with SERVE_RUNNING_MESSAGE. A stale lock is taken over (M-5). The lock
// is created exclusively, so two starts cannot both take it.
export function acquireServeLock(dataDir) {
  const file = serveLockFile(dataDir);
  mkdirSync(dataDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      return;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw new IgError('CONFIG', `the serve lock could not be written (${err?.code ?? 'error'})`);
    }
    if (readServeLock(dataDir) === 'running') throw new IgError('CONFIG', SERVE_RUNNING_MESSAGE);
    let staleText = null;
    try {
      staleText = readFileSync(file, 'utf8');
    } catch {
      staleText = null;
    }
    if (!takeOverStaleLock(file, staleText)) throw new IgError('CONFIG', SERVE_RUNNING_MESSAGE);
  }
  throw new IgError('CONFIG', SERVE_RUNNING_MESSAGE);
}

// Removes the serve lock when it holds this process's id. Any other lock, or none, is left alone.
export function releaseServeLock(dataDir) {
  const file = serveLockFile(dataDir);
  try {
    if (readFileSync(file, 'utf8').trim() === String(process.pid)) rmSync(file, { force: true });
  } catch {
    // No lock, or one that cannot be read: there is nothing of this process to remove.
  }
}

// ig auth set <name>. The name is checked before any value is read or any secret is touched.
export async function runAuthSet({ name, readValue, secrets, out = log }) {
  if (!SECRET_NAMES.includes(name)) {
    throw new IgError('VALIDATION', `unknown secret name; use one of: ${SECRET_NAMES.join(', ')}`);
  }
  const value = await readValue(name);
  secrets.set(name, value);
  out(`stored ${name} in the keyring; the environment variable IG_${name.toUpperCase()} still takes precedence when it is set`);
  return 'stored';
}

// Runs one step of a login. A failure keeps its kind and names the step, so the owner sees where the login stopped. The
// messages of the steps carry no secret: they are built from kinds, HTTP statuses and error names only.
async function atStep(step, action) {
  try {
    return await action();
  } catch (err) {
    const kind = err instanceof IgError ? err.kind : 'API_ERROR';
    const detail = err instanceof IgError ? err.message : (err?.name ?? 'error');
    throw new IgError(kind, `${step} failed: ${detail}`, { step });
  }
}

// Stores a secret and its record as one step (M-3). The previous keyring entry is read first. If the record cannot be saved, the
// previous entry is put back, or the new entry is removed when there was none, so a failed store leaves the previous state in
// place. A value from the environment is not a keyring entry, so it is not written into the keyring.
function storeSecretWithRecord({ secrets, state, name, value, recordKey, record }) {
  const previous = secrets.source(name) === 'keyring' ? secrets.get(name) : null;
  secrets.set(name, value);
  try {
    state.set(recordKey, record);
    state.save();
  } catch (err) {
    let restored = true;
    try {
      if (previous !== null) secrets.set(name, previous);
      else secrets.remove(name);
    } catch {
      restored = false;
    }
    const code = err?.code ?? err?.name ?? 'error';
    if (!restored) {
      throw new IgError(
        'CONFIG',
        `storing the record of ${name} failed (${code}); the ${name} entry could not be restored; check the keyring before you retry`,
      );
    }
    const what = previous !== null ? `the previous ${name} entry is in place again` : `the new ${name} entry was removed again`;
    throw new IgError('CONFIG', `storing the record of ${name} failed (${code}); ${what}, so nothing is stored`);
  }
}

// The audit line is written after a store. If it cannot be written, the step still succeeded: the output says so and names the
// missing line (M-4). Returns whether the line was written.
function auditSafely(audit, entry, out) {
  try {
    audit.record(entry);
    return true;
  } catch (err) {
    out(`warning: the audit line was not written (${err?.name ?? 'error'}); the step itself succeeded`);
    return false;
  }
}

// ig auth login (O-7). Authorize, the loopback redirect with the state check, the short-lived exchange with the code in the
// body, the owner check, then the long-lived exchange with the short-lived token in the Bearer header. The owner token and its
// record are stored only after both exchanges have succeeded. A failure at any step stores nothing and names the step. The serve
// lock is held for the whole wait, so a serve cannot start during a login (I-2), and it is released on every exit.
export async function runAuthLogin({
  config,
  secrets,
  state,
  audit,
  now = () => Date.now(),
  port = REDIRECT_PORT,
  out = log,
  listen = listenForRedirect,
  exchangeShort = exchangeShortLived,
  longLived = longLivedExchange,
  fetchImpl,
  serveLock = () => readServeLock(resolveDataDir(config.dataDir)),
}) {
  const appId = config.app?.id;
  if (typeof appId !== 'string' || appId.trim() === '') throw new IgError('CONFIG', 'app.id is not set; set IG_APP_ID');
  const appSecret = secrets.get('app_secret');
  if (appSecret === null) throw new IgError('CONFIG', 'app_secret is not set; set IG_APP_SECRET or run ig auth set app_secret');
  // A running service holds the serve lock and writes the same state file, so the login does not start while the lock is live.
  if ((await serveLock()) === 'running') throw new IgError('CONFIG', SERVE_RUNNING_MESSAGE);
  const dataDir = resolveDataDir(config.dataDir);
  acquireServeLock(dataDir);
  try {
    const expectedState = randomState();
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const authorize = buildAuthorizeUrl({ appId, redirectUri, scopes: INSTAGRAM_SCOPES, state: expectedState });
    out('Open this URL in a browser, approve the app, and keep this terminal open until it finishes:');
    out(authorize);

    const target = await atStep('the approval redirect', () => listen({ port, expectedState }));
    const code = await atStep('the approval redirect', () => parseRedirect(target, expectedState));
    const short = await atStep('the short-lived token exchange', () =>
      exchangeShort({ appId, appSecret, redirectUri, code, fetchImpl }),
    );
    if (short.userId !== String(config.owner.igUserId)) {
      throw new IgError('OWNER_MISMATCH', 'the account that approved the app is not the owner account; nothing was stored');
    }

    const long = await atStep('the long-lived token exchange', () =>
      longLived({ appSecret, shortToken: short.accessToken, fetchImpl }),
    );
    if (!Number.isSafeInteger(long?.expiresInSeconds) || long.expiresInSeconds <= 0) {
      throw new IgError('API_ERROR', 'the long-lived token exchange response has no usable expiry; nothing was stored');
    }
    registerToken(long.accessToken);

    // Both exchanges have succeeded. The granted scopes go in scopes when the exchange returned them. When it did not, scopes is
    // empty, because no granted list is known, and the requested scopes go under scopesRequested. An empty scopes list keeps a
    // refresh refused, since canRefresh needs the instagram_business_basic scope.
    const obtained = now();
    const expiresAt = obtained + long.expiresInSeconds * 1000;
    storeSecretWithRecord({
      secrets,
      state,
      name: 'owner_token',
      value: long.accessToken,
      recordKey: TOKEN_KEY,
      record: {
        obtainedAt: new Date(obtained).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        scopes: short.grantedScopes ?? [],
        scopesRequested: [...INSTAGRAM_SCOPES],
      },
    });
    auditSafely(audit, { action: 'authLogin', target: null, route: 'instagram', outcome: 'ok', detail: null }, out);
    out(`stored owner_token in the keyring; it is valid until ${new Date(expiresAt).toISOString()}`);
    out('A stop that was in place before this login, if any, still holds. Only ig_stop_clear with confirm clears it.');
    return 'stored';
  } finally {
    releaseServeLock(dataDir);
  }
}

// ig auth facebook (O-8). The approval comes back to the loopback page with the token in the fragment, and the page posts it to
// the loopback server, which checks the state. The Page check requires a Page linked to the owner's Instagram account. Nothing is
// stored unless the approval and the Page check both pass. The serve lock is held for the whole wait, as for auth login. The
// expiry is recorded when the approval gave one, and recorded as unknown when it did not (M-10).
export async function runAuthFacebook({
  config,
  secrets,
  state,
  audit,
  out = log,
  port = REDIRECT_PORT,
  now = () => Date.now(),
  receiveToken = listenForFacebookToken,
  createClient = makeGraphClient,
  fetchImpl = globalThis.fetch,
}) {
  const appId = config.app?.id;
  if (typeof appId !== 'string' || appId.trim() === '') throw new IgError('CONFIG', 'app.id is not set; set IG_APP_ID');
  const dataDir = resolveDataDir(config.dataDir);
  acquireServeLock(dataDir);
  try {
    const expectedState = randomState();
    const redirectUri = `http://127.0.0.1:${port}${FACEBOOK_BRIDGE_PATH}`;
    const authorize = buildFacebookAuthorizeUrl({ appId, redirectUri, scopes: FACEBOOK_SCOPES, state: expectedState });
    out('Open this URL in a browser, approve the app, and keep this terminal open until it finishes:');
    out(authorize);
    const approval = await atStep('the Facebook approval', () => receiveToken({ port, expectedState }));
    const token = registerToken(approval?.token);
    const expiresInSeconds =
      Number.isSafeInteger(approval.expiresInSeconds) && approval.expiresInSeconds > 0 ? approval.expiresInSeconds : null;
    // This command has no usage gate, so the reading of its one Page read is returned to the caller rather than dropped. The Page
    // list is read through a cap, so an oversized response is refused.
    const reading = { usage: null };
    const client = createClient({
      config,
      product: FACEBOOK_PRODUCT,
      token,
      onUsage: (usage) => {
        reading.usage = usage;
      },
      fetchImpl: cappedFetch(fetchImpl, PAGE_LIST_LIMIT),
    });
    const response = await atStep('the Page check', () =>
      client.get('me/accounts', { fields: 'id,name,instagram_business_account' }),
    );
    const pages = response?.data?.data;
    if (!Array.isArray(pages)) throw new IgError('API_ERROR', 'the Page list has no data; nothing was stored');
    if (response.data.paging?.next !== undefined) {
      throw new IgError('CONFIG', 'the Page list has more pages, which this version does not read; nothing was stored');
    }
    const pageId = pageLinkFromAccounts(pages, String(config.owner.igUserId));
    if (pageId === null) {
      throw new IgError('CONFIG', 'no Facebook Page is linked to the owner account; connect the Page and run again. Nothing was stored.');
    }
    const obtained = now();
    const expiresAt = expiresInSeconds === null ? null : new Date(obtained + expiresInSeconds * 1000).toISOString();
    storeSecretWithRecord({
      secrets,
      state,
      name: 'facebook_token',
      value: token,
      recordKey: FACEBOOK_RECORD_KEY,
      record: { obtainedAt: new Date(obtained).toISOString(), expiresAt, expiryKnown: expiresInSeconds !== null },
    });
    auditSafely(audit, { action: 'authFacebook', target: null, route: 'facebook', outcome: 'ok', detail: null }, out);
    out(`stored facebook_token in the keyring; the linked Page is ${pageId}`);
    out(
      expiresAt === null
        ? 'The approval gave no expiry, so the expiry of this token is recorded as unknown.'
        : `The token is valid until ${expiresAt}.`,
    );
    return { status: 'stored', usage: reading.usage, expiryKnown: expiresInSeconds !== null };
  } finally {
    releaseServeLock(dataDir);
  }
}

// The lines of a stream that is not a terminal, read in order. A line that is not there is ''. The stream is read once, when the first
// line is asked for, so the username, the password and a two-factor code can come from one piped input.
export function createLineSource(stream) {
  let lines = null;
  return {
    async next() {
      if (lines === null) {
        let text = '';
        for await (const chunk of stream) text += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        lines = text.split(/\r?\n/);
      }
      return lines.length > 0 ? lines.shift() : '';
    },
  };
}

// The message of a failed unofficial login. The sidecar's text is already redacted by IgError. A failure that is not an IgError is named
// without its text.
function unofficialLoginFailure(err) {
  if (err instanceof IgError) return new IgError(err.kind, `${err.message}; nothing was stored`, err.details);
  return new IgError('UNOFFICIAL_ADAPTER_ERROR', 'the unofficial login did not complete; nothing was stored');
}

// ig routes login-unofficial. It needs the acknowledgement stored first, and no running service. The username and the password come from
// the prompts, and so does a two-factor code, when the sidecar asks for one. The password is registered before it is used, and it is sent
// only to the sidecar. On success the session goes to the keyring as unofficial_session, the username as unofficial_username, and the
// route's stop is cleared. A failure stores nothing. The serve lock is held for the login, as for the auth commands.
export async function runRoutesLoginUnofficial({
  config,
  secrets,
  state,
  audit,
  dataDir,
  prompts,
  adapter,
  out = log,
  serveLock = () => readServeLock(dataDir),
}) {
  if (state.get(ACK_KEY, undefined) !== true) {
    throw new IgError('ROUTE_DISABLED', 'the unofficial routes are not acknowledged; run ig routes ack-unofficial --confirm first');
  }
  if ((await serveLock()) === 'running') throw new IgError('CONFIG', SERVE_RUNNING_MESSAGE);
  acquireServeLock(dataDir);
  try {
    const username = String((await prompts.username()) ?? '').trim();
    if (username === '') throw new IgError('VALIDATION', 'the username is missing; nothing was sent');
    const password = String((await prompts.password()) ?? '');
    if (password === '') throw new IgError('VALIDATION', 'the password is missing; nothing was sent');
    registerPassword(password);
    let session;
    try {
      session = await adapter.login({ username, password });
    } catch (err) {
      const twoFactor = err instanceof IgError && err.kind === 'CHECKPOINT' && err.details?.sidecarKind === 'two_factor';
      if (!twoFactor) throw unofficialLoginFailure(err);
      const code = String((await prompts.verificationCode()) ?? '');
      if (code === '') throw new IgError('VALIDATION', 'Instagram asked for a two-factor code, and none was given; nothing was stored');
      try {
        session = await adapter.login({ username, password, verificationCode: code });
      } catch (again) {
        throw unofficialLoginFailure(again);
      }
    }
    storeUnofficialLogin({ secrets, state, session, username });
    auditSafely(audit, { action: 'unofficialLogin', target: null, route: 'unofficial', outcome: 'ok', detail: null }, out);
    out(`stored ${UNOFFICIAL_SESSION} and ${UNOFFICIAL_USERNAME} in the keyring; ig serve restores the session when it starts`);
    return 'stored';
  } finally {
    releaseServeLock(dataDir);
  }
}

// ig routes ack-unofficial. A running service is refused first, because it writes the same state file. Without confirm it
// prints the warning and stores nothing.
export async function runRoutesAck({ confirm, state, out = log, serveLock }) {
  if (typeof serveLock !== 'function') throw new TypeError('runRoutesAck needs serveLock as a function');
  if ((await serveLock()) === 'running') throw new IgError('CONFIG', SERVE_RUNNING_MESSAGE);
  out(UNOFFICIAL_WARNING);
  if (confirm !== true) {
    out('Nothing was stored. Run again with --confirm to store the acknowledgement.');
    return 'preview';
  }
  if (state.get(ACK_KEY, undefined) === true) {
    out('The acknowledgement is already stored.');
    return 'already';
  }
  state.set(ACK_KEY, true);
  state.save();
  out('Stored the acknowledgement. Unofficial routes also need routes.unofficial.enabled in the config file.');
  return 'stored';
}

// ig routes clear-one-reply-flag (the owner's confirmed way out of the one-reply flag, P5a round 1). A running service is refused first, as for
// ack-unofficial. The flag is read from the state without writing it, so a preview changes nothing. Without confirm it prints the flag, its
// reason and the damaged line count now. With confirm it clears the flag and writes one audit line with the action and the outcome only: no
// text and no target. The fail-closed default stays: the flag is cleared only by this command, or by a later start whose scan is clean.
export async function runRoutesClearOneReplyFlag({ confirm, stateFile, auditFile, out = log, serveLock, now = () => Date.now() }) {
  if (typeof serveLock !== 'function') throw new TypeError('runRoutesClearOneReplyFlag needs serveLock as a function');
  if ((await serveLock()) === 'running') throw new IgError('CONFIG', SERVE_RUNNING_MESSAGE);
  const view = readStateView(stateFile);
  if (view.unreadable === true) {
    out('The state file is unreadable, so the one-reply flag cannot be read here. Nothing was changed.');
    return 'unreadable';
  }
  const flag = view[ONE_REPLY_UNKNOWN_KEY] ?? null;
  if (flag === null) {
    out('No one-reply flag is set. Nothing was changed.');
    return 'none';
  }
  const audit = createAudit({ file: auditFile, now });
  out(`One-reply flag: set since ${flag.since}.`);
  out(`Reason: ${flag.reason}.`);
  out(damagedLinesNow(audit, now));
  if (confirm !== true) {
    out(
      'Nothing was changed. Run again with --confirm to clear the flag. Private replies are then no longer refused for it, and only the ' +
        "Meta one-reply rule applies to a comment whose reply the records do not show.",
    );
    return 'preview';
  }
  const state = await createState({ file: stateFile });
  state.set(ONE_REPLY_UNKNOWN_KEY, null);
  state.save();
  audit.record({ action: 'oneReplyFlagClear', target: null, route: null, outcome: 'ok', detail: null });
  out('Cleared the one-reply flag. Private replies are no longer refused for it.');
  return 'cleared';
}

// The damaged lines that a scan of the audit files finds now, as text. It reads the files and writes nothing.
function damagedLinesNow(audit, now) {
  try {
    const scan = rebuildPrivateReplies({ audit, now });
    return `Damaged audit lines now: ${scan.damaged}.`;
  } catch (err) {
    return `The audit file could not be read now (${err.kind ?? err.code ?? 'error'}), so its damaged lines are not counted.`;
  }
}

// Reads the state file without writing it. A missing file is {}, and one that does not parse is { unreadable: true }.
function readStateView(file) {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { unreadable: true };
  } catch {
    return { unreadable: true };
  }
}

// The host of a URL, for the probe and for ig status. A host given with brackets, such as [::1], is taken as it is, and an
// IPv6 address gets its brackets exactly once. A name or an IPv4 address is unchanged. A wildcard bind is reached on loopback.
function statusHost(host) {
  const bare = host.trim().replace(/^\[(.*)\]$/, '$1');
  if (bare === '0.0.0.0' || bare === '::' || bare === '') return '127.0.0.1';
  return bare.includes(':') ? `[${bare}]` : bare;
}

// The local summary: the config and the state, with no token. It is printed when the service cannot be reached.
function localSummary(config, view) {
  return JSON.stringify(
    redact({
      accountType: config.owner.accountType,
      routes: {
        unofficial: { enabled: config.routes.unofficial.enabled, acknowledged: config.routes.unofficial.acknowledged },
        likesLoginProduct: config.routes.likes.loginProduct,
      },
      stop: view.unreadable ? 'the state file is unreadable' : (view.stop ?? 'no stop recorded'),
      recovery: view.recovery ?? null,
      oneReplyUnknown: view[ONE_REPLY_UNKNOWN_KEY] ?? null,
    }),
    null,
    2,
  );
}

// ig status. It asks the running service for ig_status, with the bearer token, and prints the result. When the service is not
// running, it prints a notice and the local summary. No token is printed. The token goes only to a loopback address. A
// non-loopback host is refused, with the reason on err and nothing else, and nothing is sent, unless http.allowRemote is true.
// Then the request goes over plain HTTP, and one warning line says so before it is sent. A refusal returns 'refused_remote',
// and bin/ig.js turns it into exit code 1.
export async function runStatus({ config, dataDir, secrets, fetchImpl = globalThis.fetch, out = log, err = logErr }) {
  const target = statusHost(config.http.host);
  const remote = !isLoopbackName(target);
  if (remote && config.http.allowRemote !== true) {
    err(`ig status refuses to send the api token to ${config.http.host}, which is not a loopback address. Set http.allowRemote to true in the config to allow it.`);
    return 'refused_remote';
  }
  const view = readStateView(filesFor(dataDir).state);
  const effective = applyAcknowledgement(config, view[ACK_KEY]).config;
  const token = secrets.get('api_token');
  if (remote) out(`warning: http.allowRemote is true, so ig status sends to ${target} over plain HTTP, and the traffic is not encrypted.`);
  const headers = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const url = `http://${target}:${config.http.port}/tools/ig_status`;
  let res;
  let text;
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
    text = await res.text();
  } catch {
    out('ig serve is not running. Start it with: ig serve');
    out(localSummary(effective, view));
    return 'not_running';
  }
  if (res.status === 401) {
    out('ig serve is running, but the api token was refused. Check IG_API_TOKEN or run ig auth set api_token.');
    out(localSummary(effective, view));
    return 'refused';
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    out('ig serve answered, but not with a result.');
    return 'unreadable';
  }
  if (body?.result === undefined) {
    out(`ig serve answered with an error (${body?.error?.kind ?? 'unknown'}).`);
    return 'error';
  }
  out(JSON.stringify(redact(body.result), null, 2));
  return 'running';
}

// ig mcp. The stdio server forwards each tool call to ig serve. Its only output on stdout is the protocol.
export async function runMcp({ config, secrets }) {
  const apiToken = secrets.get('api_token');
  if (apiToken === null) {
    throw new IgError('CONFIG', 'api_token is not set; ig mcp needs it to call ig serve (set IG_API_TOKEN or run ig auth set api_token)');
  }
  const forward = createForward({ port: config.http.port, apiToken });
  await startStdio({ forward, tools: TOOLS });
}

// Rebuilds the outbound counters of an unreadable state from the audit file, and writes the recovery record (P4 review M-11).
// A rebuild that fails is recorded too, with its error kind, so the owner can see that the caps started from zero. The
// recovery record is kept in the state, so ig status shows it after a restart. The audit line records the outcome.
// The count of damaged audit lines, as the recovery record and the start note give it (P4 final N-4). The counts may be low by
// that many, because a damaged line may have held an action.
function damagedNote(damaged) {
  if (damaged === 0) return 'no damaged audit line was skipped';
  return `${damaged} damaged audit line${damaged === 1 ? '' : 's'} skipped; the counts may be low by up to ${damaged}`;
}

// The event cursor state, as the recovery record gives it (P4 final N-1).
// The reset to zero is the owner-decided exception to "the cursors never move backwards" (P4 fix round 2, N-14): a consumer dedupes by
// event id, because a missed inbound message is treated as worse than a duplicate.
const EVENT_CURSORS_HELD =
  'unknown after the state loss: pending and ack are held until ig_stop_clear; a confirmed clear starts the cursors at zero (the owner-decided exception to the cursors never moving backwards), the next pending carries a notice, and each event keeps its id, so dedupe by id; a missed inbound message is treated as worse than a duplicate';
const EVENT_CURSORS_UNAFFECTED = 'not affected: no event cursor was lost';

// The one-reply records of a scan that read the audit file. A record that the state already holds is kept as it is: a live record counts.
function mergeOneReplyRecords(state, records) {
  if (Object.keys(records).length === 0) return;
  state.set('private_replies', { ...records, ...state.get('private_replies', {}) });
}

// The flag as a failed scan sets it. The time of the first failure is kept, and the reason is that of the latest failure.
function oneReplyFlagFor(state, reason, at) {
  const held = state.get(ONE_REPLY_UNKNOWN_KEY, null);
  return { oneReplyUnknown: true, since: held?.since ?? at, reason };
}

// Why a one-reply scan is not known to be complete, or null when it is known (P5a round 1, I-1). A scan that cannot read the audit file is
// unknown. So is a scan with a damaged line in any retained file: the damaged line may be a private reply, and the scan cannot tell. The
// cost of that rule is that the flag stays until the file holding the damaged line rotates out (the report says so).
function unknownReasonOf(replies, failure) {
  if (failure !== null) return `the audit file could not be read (${failure})`;
  if (replies.damaged > 0) {
    return `${replies.damaged} damaged audit line${replies.damaged === 1 ? '' : 's'} in the retained audit files may be a private reply`;
  }
  return null;
}

// Saves the flag on its own, before anything else is saved in the same step (P5a round 1, M-R1-2). Once the flag is in the file, a later
// failed save cannot drop it, because a failed save restores the last saved image. A save that fails here keeps the flag in memory, and it
// is set again after the restore; the service also holds it in its process (see setOneReplyUnknown in src/service.js).
function saveFlagFirst(state, flag) {
  state.set(ONE_REPLY_UNKNOWN_KEY, flag);
  try {
    state.save();
  } catch {
    state.set(ONE_REPLY_UNKNOWN_KEY, flag);
  }
}

// On a start that does not recover the state, the one-reply flag is retried (P4 fix round 2, the one-reply gap). A scan that reads the audit
// file cleanly writes the records and clears the flag. A scan that fails, or that finds a damaged line, keeps the flag, with the reason of the
// latest attempt. Each attempt is audited.
export function retryOneReplyRecords({ state, audit, now, events }) {
  const flag = state.get(ONE_REPLY_UNKNOWN_KEY, null);
  if (flag === null) return false;
  const at = new Date(now()).toISOString();
  let replies = null;
  let failure = null;
  try {
    replies = rebuildPrivateReplies({ audit, now, commentTimeOf: (id) => events?.receivedAtOf?.(id) ?? null });
  } catch (err) {
    failure = err.kind ?? err.code ?? 'error';
  }
  const unknown = unknownReasonOf(replies, failure);
  const nextFlag = unknown === null ? null : oneReplyFlagFor(state, `${unknown}, on the start of ${at}`, at);
  if (nextFlag !== null) saveFlagFirst(state, nextFlag);
  const write = () => {
    if (replies !== null) mergeOneReplyRecords(state, replies.privateReplies);
    state.set(ONE_REPLY_UNKNOWN_KEY, nextFlag);
  };
  write();
  try {
    state.save();
  } catch (err) {
    if (!(err instanceof IgError && err.kind === 'CONFIG')) throw err;
    write();
  }
  audit.record({
    action: 'oneReplyRebuild',
    target: null,
    route: null,
    outcome: unknown === null ? 'ok' : 'error',
    detail: unknown === null ? { records: Object.keys(replies.privateReplies).length } : { reason: unknown },
  });
  return unknown === null;
}

export function recoverFromAudit({ state, audit, caps, now, reason = 'state file unreadable', events }) {
  const at = new Date(now()).toISOString();
  // The key is authRecord, not tokenRecord: the redactor masks every key that contains the word token.
  const authRecord = 'empty; run ig auth login to write it again';
  const eventCursors = events?.cursorsUnknown?.() === true ? EVENT_CURSORS_HELD : EVENT_CURSORS_UNAFFECTED;
  const commentTimeOf = (id) => events?.receivedAtOf?.(id) ?? null;

  // The outbound counters (P4 fix round 2, N-10). This scan is separate from the one-reply scan below, so a failure of either does not
  // drop the other's result.
  let counters = null;
  let countersFailure = null;
  try {
    counters = rebuildCapsFromAudit({ caps, state, audit, now });
  } catch (err) {
    countersFailure = err.kind ?? err.code ?? 'error';
  }
  // The one-reply records of the comments (P4 final N-2, and P4 fix round 2 N-10): a scan of their own. When it fails, private replies are
  // refused until the owner clears the stop, and the recovery says so.
  let replies = null;
  let repliesFailure = null;
  try {
    replies = rebuildPrivateReplies({ audit, now, commentTimeOf });
  } catch (err) {
    repliesFailure = err.kind ?? err.code ?? 'error';
  }
  // A scan that cannot read the file, or that finds a damaged line, is not known to be complete (P5a round 1, I-1).
  const repliesUnknown = unknownReasonOf(replies, repliesFailure);
  const replyCount = replies === null ? 0 : Object.keys(replies.privateReplies).length;
  const recovery = {
    at,
    reason,
    ...(countersFailure === null
      ? {
          counters: 'rebuilt from the audit file',
          counted: counters.counted,
          auditLinesCounted: counters.actions,
          damagedAuditLines: counters.damaged,
          unusableAuditLines: counters.unusable,
          windowMs: counters.windowMs,
          note: damagedNote(counters.damaged),
          notRebuilt: 'lookups made before the lookup audit lines were added; they wrote no audit line',
        }
      : {
          counters: `not rebuilt (${countersFailure}); the caps start from zero`,
          note: 'the outbound counters were not rebuilt, so the caps start from zero',
        }),
    privateReplies: replyCount,
    oneReplyDamagedLines: replies === null ? null : replies.damaged,
    oneReplyRecords:
      repliesUnknown === null
        ? `${replyCount} rebuilt from the audit file`
        : repliesFailure !== null
          ? `not rebuilt (${repliesFailure}); the flag ${ONE_REPLY_UNKNOWN_KEY} is set, so private replies are refused until a later start reads the audit file; a confirmed ig_stop_clear does not lift this`
          : `${replyCount} rebuilt, but not known to be complete: ${repliesUnknown}; the flag ${ONE_REPLY_UNKNOWN_KEY} is set, so private replies are refused until a later start reads the audit file cleanly; a confirmed ig_stop_clear does not lift this`,
    eventCursors,
    authRecord,
    noted: false,
  };
  // The one-reply flag: set when the scan is not known to be complete, and cleared when it is. The time of the first failure is kept.
  const unknownFlag = repliesUnknown === null ? null : oneReplyFlagFor(state, `${repliesUnknown}, on the start of ${at}`, at);
  // The flag is saved on its own before the rest of this recovery is written (P5a round 1, M-R1-2).
  if (unknownFlag !== null) saveFlagFirst(state, unknownFlag);
  // Everything this recovery writes, set again after a failed save (P4 fix round 2, N-11). A save that fails restores the last saved
  // image (state.js), which does not hold these values, so they are set again in memory and the next save writes them.
  const writeAll = () => {
    if (counters !== null) {
      for (const [bucket, list] of Object.entries(counters.entries)) state.set(`caps.${bucket}`, list);
    }
    if (replies !== null && replyCount > 0) mergeOneReplyRecords(state, replies.privateReplies);
    if (unknownFlag !== null) state.set(ONE_REPLY_UNKNOWN_KEY, unknownFlag);
    else if (state.get(ONE_REPLY_UNKNOWN_KEY, null) !== null) state.set(ONE_REPLY_UNKNOWN_KEY, null);
    state.set('recovery', recovery);
  };
  writeAll();
  // A save that fails, because the damaged file has no copy yet (P4 review M-5), is kept in process: the values are set again, and the
  // next save writes the state. The start is not refused for it.
  try {
    state.save();
  } catch (err) {
    if (!(err instanceof IgError && err.kind === 'CONFIG')) throw err;
    writeAll();
  }
  audit.record({
    action: 'capsRebuild',
    target: null,
    route: null,
    outcome: recovery.counted !== undefined ? 'ok' : 'error',
    detail: { counters: recovery.counters, counted: recovery.counted ?? null, damagedAuditLines: recovery.damagedAuditLines ?? null },
  });
}

// The start note of a recovery (P4 review N-8). It is shown once per recovery: the record is marked as shown, so a later start does not
// repeat it, and a confirmed ig_stop_clear removes the record. Returns true when the note was shown.
export function recoveryNote({ state, err = logErr }) {
  const recovery = state.get('recovery', null);
  if (recovery === null || recovery.noted === true) return false;
  err(
    `the state was recovered (${recovery.reason}): ${recovery.counters}. ${recovery.note ?? 'the damaged audit lines are not known'}. ` +
      `One-reply records: ${recovery.oneReplyRecords ?? 'not recorded'}. Event cursors: ${recovery.eventCursors}. ` +
      `Token record: ${recovery.authRecord}.`,
  );
  state.set('recovery', { ...recovery, noted: true });
  try {
    state.save();
  } catch {
    // A failed save restores the last saved image, which holds noted false. The mark is set again in memory, so this process does not
    // show the note twice. A later start that finds the mark unsaved shows it once more: the safe side.
    state.set('recovery', { ...recovery, noted: true });
  }
  return true;
}

// Builds the service and its modules, without listening and without starting the poller or the token checks. A
// non-loopback host without api_token is refused first. The webhook handler exists only when webhook.enabled is true.
export async function buildServe({
  config,
  secrets,
  dataDir,
  env = process.env,
  now = () => Date.now(),
  root = PROJECT_ROOT,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  makeSidecar = createSidecarAdapter,
}) {
  const apiToken = secrets.get('api_token');
  assertServeHost({ host: config.http.host, apiToken, allowRemote: config.http.allowRemote });
  const files = filesFor(dataDir);
  const state = await createState({ file: files.state });
  const { config: effective, ignoredFileValue } = applyAcknowledgement(config, state.get(ACK_KEY, undefined));

  const guard = createGuard({ owner: effective.owner, state, now, eventsFile: files.events, auditFile: files.audit });
  guard.assertOwner(effective.owner.igUserId);
  // The event log holds pending and ack while the cursors are unknown and the stop holds (P4 final N-1). The stop is read from the guard.
  const events = createEventLog({
    file: files.events,
    state,
    retentionDays: effective.retentionDays,
    now,
    isStopped: () => guard.stopStatus().stopped,
  });
  // A readable state can lose its cursor keys without a stop: an older state file restored over a newer event file, or the keys removed by
  // hand. The event log then marks the cursors unknown with no stop held, so the stop is raised here (P4 fix round 2, N-9). Then pending and
  // ack are held, as for any other stop. A save that fails is kept in process by the guard, as for every stop.
  if (events.cursorsUnknown() && !guard.stopStatus().stopped) {
    try {
      guard.stop('STATE_LOST', 'the event cursors are unknown');
    } catch (err) {
      if (!(err instanceof IgError && err.kind === 'CONFIG')) throw err;
    }
  }
  const audit = createAudit({ file: files.audit, now });
  const caps = createCaps({ caps: effective.caps, state, now });
  // The counters are rebuilt from the audit file when the state file was lost with them (P4 review M-11 and the lost-state rebuild):
  // the file is unreadable, or it is missing and the guard found events or audit lines without it (STATE_LOST). A state file that
  // exists is never rebuilt, so a state that still has its counters keeps them. The token record is not in the audit file, so it
  // stays empty, and the recovery record says so. createState has already copied a damaged file.
  if (state.unreadable === true) {
    recoverFromAudit({ state, audit, caps: effective.caps, now, reason: 'state file unreadable', events });
  } else if (state.missing === true && guard.stopStatus().kind === 'STATE_LOST') {
    recoverFromAudit({ state, audit, caps: effective.caps, now, reason: 'state file missing (STATE_LOST)', events });
  } else {
    // A start that does not recover the state retries the one-reply flag, so that a later start clears it (P4 fix round 2).
    retryOneReplyRecords({ state, audit, now, events });
  }
  const usageGate = createUsageGate({
    thresholdPercent: effective.caps.usageThrottlePercent,
    busyMs: effective.caps.usageBusyMs,
    now,
  });
  // The sidecar command comes from the config (routes.unofficial.python), and IG_PYTHON overrides it. The script is under the project root.
  const sidecar = sidecarCommand({ config: effective, env, root });
  const adapters = {
    sidecar: makeSidecar({ command: sidecar.command, args: sidecar.args }),
    jslib: createJsLibAdapter(),
  };
  const unofficial = createAdapterRegistry({ adapters, byFeature: effective.routes.unofficial.adapterByFeature });
  // A stored unofficial session is restored at start, when the route is acknowledged. It is restored before the service is built, so the
  // route's stop is in state when the service first checks it.
  const unofficialRestore = await restoreUnofficialSession({
    enabled: effective.routes.unofficial.enabled,
    acknowledged: effective.routes.unofficial.acknowledged,
    secrets,
    state,
    adapter: adapters.sidecar,
    now,
  });

  // Every Graph client is built through getClient, which needs an onUsage callback (makeGraphClient refuses without one).
  // The service gets this getClient. The poller and the owner check get it too, with the same usage holder as the service,
  // so their readings reach the usage gate at once, before any tool call. The holder is not exposed on the service.
  const usageHolder = createUsageHolder();
  async function clientFor(product, onUsage) {
    const token = secrets.get(product === FACEBOOK_PRODUCT ? 'facebook_token' : 'owner_token');
    if (token === null) {
      if (product === FACEBOOK_PRODUCT) throw new IgError('ROUTE_DISABLED', 'facebook_token is not set; run ig auth facebook');
      throw new IgError('CONFIG', 'owner_token is not set; run ig auth login');
    }
    return makeGraphClient({ config: effective, product, token, onUsage, fetchImpl, sleep });
  }
  const getClient = (product, { onUsage } = {}) => clientFor(product, onUsage);

  const service = createService({
    config: effective,
    state,
    events,
    caps,
    usageGate,
    guard,
    audit,
    unofficial,
    secrets,
    getClient,
    usageHolder,
    now,
  });

  // The service's inbound hook is the notify step of both paths (P4 review, inbound wiring). The webhook calls it for each event
  // it stores, and the poller for each event it stores. The hook checks the stop and autoReply.enabled, which is off by default, so
  // with auto-replies off it sends nothing. It is looked up when the event arrives, so the wiring follows the service object.
  const onInbound = (event) => service.onInbound(event);
  const webhookHandler = effective.webhook.enabled === true
    ? createWebhookHandler({
        appSecret: secrets.get('app_secret'),
        verifyToken: secrets.get('webhook_verify_token'),
        owner: effective.owner.igUserId,
        events,
        audit,
        now,
        notify: onInbound,
      })
    : null;

  const httpServer = createHttpServer({
    service,
    tools: TOOLS,
    webhookHandler,
    webhookPath: effective.webhook.path,
    apiToken: apiToken ?? '',
    host: effective.http.host,
    allowedHosts: effective.http.allowedHosts,
    port: effective.http.port,
  });

  const poller = createPoller({
    getClient: () => getClient('instagram', { onUsage: usageHolder.record }),
    owner: effective.owner.igUserId,
    events,
    state,
    guard,
    config: effective,
    sleep,
    now,
    audit,
    onInbound,
  });

  // The owner check that serve runs before it listens: GET me with the owner token, through the same client path.
  const verifyOwner = async () => {
    const client = await getClient('instagram', { onUsage: usageHolder.record });
    return verifyOwnerAccount({ client, owner: effective.owner.igUserId });
  };

  return {
    config: effective,
    dataDir,
    files,
    state,
    guard,
    events,
    audit,
    service,
    poller,
    httpServer,
    webhookHandler,
    adapters,
    ignoredFileValue,
    unofficialRestore,
    verifyOwner,
  };
}

// Starts a built service: the stop state is reported, the HTTP API is listened on its validated host and port, the poller
// starts (it makes no request while a halting stop holds), and the hourly token checks run. Returns a stop function.
export async function startServe(built, { out = log, err = logErr } = {}) {
  const { guard, poller, httpServer, service, config, adapters, verifyOwner, dataDir } = built;
  // The serve lock was taken by runServe, before buildServe. It is released if this start fails, and at shutdown.
  let started = false;
  try {
    // The owner token must belong to the configured owner. A mismatch, or a token that cannot be checked, stops the start
    // before anything listens.
    await verifyOwner();
    out('owner account confirmed');
    const stop = guard.stopStatus();
    if (stop.stopped) err(`stop state: ${stop.kind} since ${stop.since}; outbound actions are held until ig_stop_clear`);
    else out('stop state: none');
    recoveryNote({ state: built.state, err });
    // The one-reply flag is shown at every start until a start that reads the audit file clears it (P4 fix round 2).
    const oneReplyFlag = built.state.get(ONE_REPLY_UNKNOWN_KEY, null);
    if (oneReplyFlag !== null) {
      err(`one-reply records unknown since ${oneReplyFlag.since}: ${oneReplyFlag.reason}; private replies are refused until a later start reads the audit file`);
    }

    await new Promise((resolveListen, rejectListen) => {
      httpServer.once('error', rejectListen);
      httpServer.once('listening', () => {
        httpServer.removeListener('error', rejectListen);
        resolveListen();
      });
      listenHttp(httpServer);
    });
    started = true;
  } finally {
    if (!started) releaseServeLock(dataDir);
  }
  const address = httpServer.address();
  out(`HTTP API listening on ${address.address}:${address.port}`);
  // A non-loopback start (allowed by http.allowRemote) gets one warning line on stderr. A loopback start gets none.
  const warning = remoteServeWarning({ host: config.http.host, port: config.http.port });
  if (warning !== null) err(warning);
  out(
    config.webhook.enabled === true
      ? `webhook receiver on ${config.webhook.path}`
      : `webhook receiver off; ${config.webhook.path} answers 404`,
  );

  poller.start();
  out('poller started');

  const checks = scheduleTokenChecks({
    check: () => runTokenCheck(service, err),
    intervalMs: TOKEN_CHECK_MS,
  });

  let stopping = null;
  const shutdown = () => {
    if (stopping !== null) return stopping;
    stopping = (async () => {
      checks();
      poller.stop();
      for (const adapter of Object.values(adapters)) {
        try {
          await adapter.close?.();
        } catch {
          // A failed close is not raised: the process is ending.
        }
      }
      await new Promise((resolveClose) => {
        httpServer.close(() => resolveClose());
        httpServer.closeAllConnections?.();
        setTimeout(resolveClose, 2000).unref();
      });
      releaseServeLock(dataDir);
    })();
    return stopping;
  };
  process.once('SIGINT', () => shutdown().then(() => process.exit(0)));
  process.once('SIGTERM', () => shutdown().then(() => process.exit(0)));
  return { shutdown };
}

// ig serve (M-6). The serve lock is taken before buildServe runs, so a second start is refused before it can write the state (buildServe
// can save a stop). The lock is released if the start fails. At shutdown startServe releases it. A live lock refuses the start.
export async function runServe({
  config,
  secrets,
  dataDir,
  env,
  out = log,
  err = logErr,
  build = buildServe,
  start = startServe,
}) {
  acquireServeLock(dataDir);
  let started = false;
  try {
    const built = await build({ config, secrets, dataDir, env });
    if (built.ignoredFileValue) {
      err('routes.unofficial.acknowledged in the config file is ignored; use ig routes ack-unofficial --confirm');
    }
    if (built.unofficialRestore?.status === 'failed') {
      err('the stored unofficial session could not be restored, so the unofficial routes are stopped; run ig routes login-unofficial again');
    }
    if (built.unofficialRestore?.status === 'unavailable') {
      err(`${built.unofficialRestore.detail}; the stored unofficial session is kept, and the unofficial routes run once the sidecar starts`);
    }
    const handle = await start(built, { out, err });
    started = true;
    return handle;
  } finally {
    if (!started) releaseServeLock(dataDir);
  }
}

// The hourly token check. It refreshes the token when the service says it may, and logs only the kind of a failure.
export async function runTokenCheck(service, err) {
  try {
    const status = await service.tokenStatus();
    if (status.canRefresh === true) await service.tokenRefresh();
  } catch (error) {
    err(`token check failed (${error instanceof IgError ? error.kind : 'error'})`);
  }
}
