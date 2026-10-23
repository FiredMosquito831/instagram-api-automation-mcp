// OAuth helpers for the setup commands: the Instagram Login authorize URL, the redirect check (the state comparison is constant
// time), the loopback callback, the short-lived and long-lived token exchanges, and the Facebook Login fragment bridge. Each
// step is injectable, so the tests run the flows with fakes and never listen on a port. No function here stores a token: the
// caller stores what these return, and only after every step has succeeded.
//
// Endpoints (Meta docs, Instagram Platform, read in Task 17 and P1):
//   authorize:           https://www.instagram.com/oauth/authorize (the reference page shows https://api.instagram.com; live check)
//   short-lived token:   POST https://api.instagram.com/oauth/access_token, a form body (code, client secret, grant type)
//   long-lived token:    POST https://graph.instagram.com/access_token, the short-lived token in the Authorization Bearer header,
//                        and grant_type and client_secret in the form body (decision O-7). Meta documents a GET with the token in
//                        the query string; the POST form is a live check, and a refusal is loud.
//   Facebook Login:      https://www.facebook.com/dialog/oauth with response_type=token. The token comes back in the redirect
//                        URL fragment, which a loopback page reads and posts to the loopback server (decision O-8).
//   Pages:               GET https://graph.facebook.com/v26.0/me/accounts with instagram_business_account (Page-link check).

import { createHash, randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { IgError } from './errors.js';
import { registerSecret } from './redact.js';
import { sameText } from './util/compare.js';

export const INSTAGRAM_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
export const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
export const INSTAGRAM_LONG_LIVED_URL = 'https://graph.instagram.com/access_token';
// The scopes the service uses, as the Business Login example requests them.
export const INSTAGRAM_SCOPES = Object.freeze([
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
]);
export const FACEBOOK_DIALOG_URL = 'https://www.facebook.com/dialog/oauth';
// The scopes of the Facebook Login for Business example (Instagram API with Facebook Login, business-login-for-instagram).
export const FACEBOOK_SCOPES = Object.freeze([
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
]);
export const CALLBACK_PATH = '/callback';
export const FACEBOOK_BRIDGE_PATH = '/facebook-callback';
export const FACEBOOK_TOKEN_PATH = '/facebook-token';
// The largest body the Facebook token POST may carry, in bytes. A token and a state fit in far less.
export const FACEBOOK_BODY_LIMIT = 4096;
// Past the body limit, the bridge reads and discards up to this many bytes, so its 413 can reach the client. Beyond it the
// read stops, so a hostile body is never read in full.
const BODY_DRAIN = 4 * FACEBOOK_BODY_LIMIT;
// The largest body a token exchange response may carry, and the largest Page list. A refused response is an API_ERROR.
export const RESPONSE_LIMIT = 65536;
export const PAGE_LIST_LIMIT = 262144;
export const LOOPBACK = '127.0.0.1';
const LOGIN_TIMEOUT_MS = 300000;
const TIMEOUT_MS = 15000;
const FORM_TYPE = 'application/x-www-form-urlencoded';
const APP_ID_PATTERN = /^\d+$/;
const USER_ID_PATTERN = /^\d+$/;
const SCOPE_PATTERN = /^[a-z_]+$/;
const TOKEN_PATTERN = /^\S+$/;
const ERROR_TYPE_PATTERN = /^[A-Za-z]{1,40}$/;
// The user_id field in the raw text: a quoted string, or a bare token such as a number.
const USER_ID_FIELD = /"user_id"\s*:\s*("(?:[^"\\]|\\.)*"|[^,}\]\s]+)/;
const LOOPBACK_REMOTES = new Set(['127.0.0.1', '::ffff:127.0.0.1']);
const CALLBACK_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>ig</title></head>' +
  '<body><p>You can close this window and return to the terminal.</p></body></html>';

// The script of the Facebook redirect page (O-8). It holds no token and no secret: it reads them from the fragment when the page
// runs, clears the fragment before it posts, and posts to the loopback server on the page's own origin. An expires_in in the
// fragment is posted with the token; without one the expiry is recorded as unknown.
const BRIDGE_SCRIPT = [
  '(function () {',
  "  var params = new URLSearchParams(location.hash.replace(/^#/, ''));",
  "  var token = params.get('access_token');",
  "  var error = params.get('error');",
  "  var state = params.get('state') || '';",
  "  var expires = params.get('expires_in');",
  "  var status = document.getElementById('status');",
  "  var fields = error ? { error: error, state: state } : { access_token: token || '', state: state };",
  '  if (!error && expires) fields.expires_in = expires;',
  "  history.replaceState(null, '', location.pathname);",
  '  if (!token && !error) {',
  "    status.textContent = 'The approval did not include a token. Return to the terminal.';",
  '    return;',
  '  }',
  "  var body = new URLSearchParams(fields).toString();",
  "  fetch(location.origin + '/facebook-token', {",
  "    method: 'POST',",
  "    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },",
  '    body: body,',
  "    credentials: 'omit',",
  "    redirect: 'error'",
  '  }).then(function (res) {',
  "    status.textContent = res.ok ? 'Done. You can close this window and return to the terminal.'",
  "      : 'The terminal did not accept the approval. Return to the terminal.';",
  '  }, function () {',
  "    status.textContent = 'The terminal could not be reached. Return to the terminal.';",
  '  });',
  '})();',
].join('\n');
// The text between the script tags, exactly as the page holds it. Its hash is the one the Content-Security-Policy names.
const SCRIPT_TEXT = `\n${BRIDGE_SCRIPT}\n`;
const BRIDGE_CSP =
  `default-src 'none'; script-src 'sha256-${createHash('sha256').update(SCRIPT_TEXT).digest('base64')}'; ` +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const BRIDGE_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<title>ig</title>',
  '</head>',
  '<body>',
  '<p id="status">Reading the approval from this page.</p>',
  `<script>${SCRIPT_TEXT}</script>`,
  '</body>',
  '</html>',
  '',
].join('\n');

function isHttpUrl(text) {
  try {
    const { protocol } = new URL(text);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Registers a token before it is used. A token that cannot be registered is refused, and the message holds no token.
export function registerToken(value) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    throw new IgError('API_ERROR', 'the token in the response is not usable');
  }
  try {
    registerSecret(value);
  } catch {
    throw new IgError('API_ERROR', 'the token in the response cannot be registered for masking; it is refused');
  }
  return value;
}

// A random state for one login. It is compared as text, never as a secret, but it is random so a guess is useless.
export function randomState() {
  return randomBytes(24).toString('base64url');
}

// The inputs shared by both authorize URLs. A bad input is a VALIDATION error, and nothing is built from it.
function checkAuthorizeInputs({ appId, redirectUri, scopes, state }) {
  if (typeof appId !== 'string' || !APP_ID_PATTERN.test(appId)) {
    throw new IgError('VALIDATION', 'the app id must be a numeric string');
  }
  if (typeof redirectUri !== 'string' || !isHttpUrl(redirectUri)) {
    throw new IgError('VALIDATION', 'the redirect URI must be an http or https URL');
  }
  if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((s) => typeof s === 'string' && SCOPE_PATTERN.test(s))) {
    throw new IgError('VALIDATION', 'the scopes must be a non-empty list of scope names');
  }
  if (typeof state !== 'string' || state.trim() === '') throw new IgError('VALIDATION', 'the state must be a non-blank string');
}

// The Instagram Login authorization URL. It carries client_id, redirect_uri, response_type=code, scope (comma-joined) and
// state, and nothing else: no secret and no token.
export function buildAuthorizeUrl({ appId, redirectUri, scopes, state } = {}) {
  checkAuthorizeInputs({ appId, redirectUri, scopes, state });
  const url = new URL(INSTAGRAM_AUTHORIZE_URL);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(','));
  url.searchParams.set('state', state);
  return url.toString();
}

// The Facebook Login for Business authorize URL (O-8). It asks for response_type=token, so the approval comes back with the
// token in the redirect fragment. It carries client_id, redirect_uri, response_type, scope and state, and nothing else.
export function buildFacebookAuthorizeUrl({ appId, redirectUri, scopes, state } = {}) {
  checkAuthorizeInputs({ appId, redirectUri, scopes, state });
  const url = new URL(FACEBOOK_DIALOG_URL);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', scopes.join(','));
  url.searchParams.set('state', state);
  return url.toString();
}

// The path of a request target, or '' when it cannot be read.
function pathOf(target) {
  try {
    return new URL(String(target), `http://${LOOPBACK}`).pathname;
  } catch {
    return '';
  }
}

// Returns the authorization code from a redirect. The state is checked first, so a redirect with the wrong state, even one
// with an error parameter, is AUTH_EXPIRED. A #_ suffix is not part of the query, so it is ignored.
export function parseRedirect(url, expectedState) {
  if (typeof url !== 'string') throw new TypeError('parseRedirect needs the redirect URL as a string');
  if (typeof expectedState !== 'string' || expectedState === '') throw new TypeError('parseRedirect needs the expected state');
  let params;
  try {
    params = new URL(url, `http://${LOOPBACK}`).searchParams;
  } catch {
    throw new IgError('VALIDATION', 'the redirect is not a URL');
  }
  if (!sameText(params.get('state') ?? '', expectedState)) {
    throw new IgError('AUTH_EXPIRED', 'the authorization state does not match this login; start the login again');
  }
  const denied = params.get('error');
  if (denied !== null) throw new IgError('CONFIG', `the authorization was not granted (${denied.slice(0, 64)})`);
  const code = params.get('code');
  if (code === null || !TOKEN_PATTERN.test(code)) throw new IgError('VALIDATION', 'the redirect has no authorization code');
  return code;
}

// The callback handler of the loopback server. Any path other than the callback is 404, and any method other than GET is 405.
// A callback whose state is not the expected one gets 400 and does not end the login, so the login keeps waiting for the
// owner's own redirect. The callback is answered with a fixed page that carries no code, and the target (path and query) is
// passed on for parseRedirect.
export function createCallbackHandler({ onCallback, expectedState } = {}) {
  if (typeof onCallback !== 'function') throw new TypeError('createCallbackHandler needs onCallback as a function');
  return function handleCallback(req, res) {
    let url = null;
    try {
      url = new URL(String(req.url), `http://${LOOPBACK}`);
    } catch {
      url = null;
    }
    const path = url === null ? '' : url.pathname;
    if (path !== CALLBACK_PATH) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Method not allowed.');
      return;
    }
    if (typeof expectedState === 'string' && expectedState !== '') {
      const state = url.searchParams.get('state') ?? '';
      if (!sameText(state, expectedState)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('This callback does not match the login in progress.');
        return;
      }
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // The callback runs once the page has been written and the response has finished, so that closing the server cannot
    // cut the page off.
    res.once('finish', () => onCallback(String(req.url)));
    res.end(CALLBACK_PAGE);
  };
}

// Waits on 127.0.0.1 for one redirect to the callback path, and resolves with its target (path and query). Only the
// loopback interface is bound. Times out after five minutes. Not tested with a real listen.
export function listenForRedirect({ port, expectedState, timeoutMs = LOGIN_TIMEOUT_MS, createServer = createHttpServer } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new IgError('CONFIG', 'the redirect port must be a whole number from 1 to 65535');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let server = null;
    const finish = (error, target) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (server !== null) {
        server.close();
        server.closeAllConnections?.();
      }
      if (error) reject(error);
      else resolve(target);
    };
    server = createServer(createCallbackHandler({ onCallback: (target) => finish(null, target), expectedState }));
    server.on('error', (err) =>
      finish(new IgError('CONFIG', `the redirect server could not listen on ${LOOPBACK}:${port} (${err.code ?? 'error'})`)),
    );
    timer = setTimeout(
      () => finish(new IgError('AUTH_EXPIRED', 'no authorization arrived before the timeout; start the login again')),
      timeoutMs,
    );
    server.listen(port, LOOPBACK);
  });
}

// Reads the user_id from the raw response text. A quoted id is returned exactly. A bare number is refused, because
// JSON.parse rounds a long number, so the digits could already be wrong.
export function parseUserIdFromRaw(text) {
  if (typeof text !== 'string') throw new TypeError('parseUserIdFromRaw needs the response text');
  const match = USER_ID_FIELD.exec(text);
  if (match === null) throw new IgError('VALIDATION', 'the token response has no user_id');
  const raw = match[1];
  if (!raw.startsWith('"')) {
    throw new IgError('CONFIG', 'user_id came back as a JSON number, which can lose digits; it is refused, and nothing is stored');
  }
  const value = JSON.parse(raw);
  if (typeof value !== 'string' || !USER_ID_PATTERN.test(value)) {
    throw new IgError('VALIDATION', 'the user_id is not a numeric string');
  }
  return value;
}

// The error for a response body over a limit. It names the step, and no body text.
function tooLarge(step, limit) {
  return new IgError('API_ERROR', `${step} response is larger than ${limit} bytes; it is refused`);
}

// Reads a response body up to limit bytes. A body larger than the limit, by its declared length or by what arrives, is refused
// with an error that names the step, and the read stops there. A response with no stream (a test double) is read whole and checked.
async function readCapped(res, limit, step) {
  const declared = res.headers?.get?.('content-length');
  if (declared !== null && declared !== undefined && Number(declared) > limit) throw tooLarge(step, limit);
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel().catch(() => {});
          throw tooLarge(step, limit);
        }
        chunks.push(Buffer.from(value));
      }
    } catch (err) {
      if (err instanceof IgError) throw err;
      throw new IgError('API_ERROR', `${step} response could not be read (${err?.name ?? 'error'})`);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await res.text();
  if (Buffer.byteLength(text) > limit) throw tooLarge(step, limit);
  return text;
}

// Wraps a fetch so that a response body over the limit reaches the caller as HTTP 413 with no body. The Graph client maps that to
// an API_ERROR, so a Page-list read over the limit is refused without the client changing.
export function cappedFetch(fetchImpl, limit = PAGE_LIST_LIMIT) {
  if (typeof fetchImpl !== 'function') throw new TypeError('cappedFetch needs fetchImpl as a function');
  return async (url, init) => {
    const res = await fetchImpl(url, init);
    let text;
    try {
      text = await readCapped(res, limit, 'the Graph response');
    } catch (err) {
      if (err instanceof IgError && err.message.includes('is larger than')) return new Response(null, { status: 413 });
      throw err;
    }
    const bodyless = res.status === 204 || res.status === 304;
    return new Response(bodyless ? null : text, { status: res.status, headers: res.headers });
  };
}

// Exchanges the authorization code for a short-lived token. The code and the app secret go in the form body, never in the
// URL. The token is registered before it is returned. Returns { accessToken, userId, grantedScopes }, where grantedScopes is the
// list the exchange returned (its permissions), or null when it returned none.
export async function exchangeShortLived({ appId, appSecret, redirectUri, code, fetchImpl = globalThis.fetch } = {}) {
  if (typeof appId !== 'string' || !APP_ID_PATTERN.test(appId)) throw new IgError('VALIDATION', 'the app id must be a numeric string');
  if (typeof appSecret !== 'string' || appSecret.trim() === '') throw new IgError('CONFIG', 'the app secret is not set');
  if (typeof code !== 'string' || !TOKEN_PATTERN.test(code)) throw new IgError('VALIDATION', 'the authorization code is not valid');
  if (typeof redirectUri !== 'string' || !isHttpUrl(redirectUri)) throw new IgError('VALIDATION', 'the redirect URI is not valid');
  if (typeof fetchImpl !== 'function') throw new TypeError('exchangeShortLived needs fetchImpl as a function');
  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  let res;
  try {
    res = await fetchImpl(INSTAGRAM_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': FORM_TYPE },
      body: form.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new IgError('API_ERROR', `the token exchange did not complete (${err?.name ?? 'error'})`);
  }
  const text = await readCapped(res, RESPONSE_LIMIT, 'the token exchange');
  if (!(res.status >= 200 && res.status <= 299)) {
    throw new IgError('API_ERROR', `the token exchange was refused (HTTP ${res.status})`);
  }
  const userId = parseUserIdFromRaw(text);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new IgError('API_ERROR', 'the token exchange response is not JSON');
  }
  const entry = Array.isArray(body?.data) ? body.data[0] : undefined;
  const accessToken = entry?.access_token;
  if (typeof accessToken !== 'string' || !TOKEN_PATTERN.test(accessToken)) {
    throw new IgError('API_ERROR', 'the token exchange response has no usable access token');
  }
  registerToken(accessToken);
  const granted =
    typeof entry?.permissions === 'string'
      ? entry.permissions
          .split(',')
          .map((scope) => scope.trim())
          .filter((scope) => SCOPE_PATTERN.test(scope))
      : [];
  return { accessToken, userId, grantedScopes: granted.length > 0 ? granted : null };
}

// The error_type of a refused response, when it is a short word. Nothing else from the body is used, so a refusal never
// echoes a token, a secret or the response text.
function refusedDetail(text) {
  try {
    const type = JSON.parse(text)?.error_type;
    return typeof type === 'string' && ERROR_TYPE_PATTERN.test(type) ? `, ${type}` : '';
  } catch {
    return '';
  }
}

// Exchanges the short-lived token for a long-lived one (O-7). The short-lived token goes in the Authorization Bearer header. The
// app secret and the grant type go in the form body. The URL has no query string, so no token and no secret is in a URL.
// Returns { accessToken, expiresInSeconds }; the caller stores nothing until both exchanges have succeeded. A refusal, a send
// failure, or a response with no usable token or expiry is an error that names this step. Meta may refuse POST for this
// endpoint: that is a live check, and the refusal is loud, because it carries the HTTP status.
export async function longLivedExchange({ appSecret, shortToken, fetchImpl = globalThis.fetch } = {}) {
  if (typeof appSecret !== 'string' || appSecret.trim() === '') throw new IgError('CONFIG', 'the app secret is not set');
  if (typeof shortToken !== 'string' || !TOKEN_PATTERN.test(shortToken)) {
    throw new IgError('VALIDATION', 'the short-lived token is not valid');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('longLivedExchange needs fetchImpl as a function');
  const step = 'the long-lived token exchange';
  const form = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: appSecret });
  let res;
  try {
    res = await fetchImpl(INSTAGRAM_LONG_LIVED_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${shortToken}`, 'Content-Type': FORM_TYPE },
      body: form.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new IgError('API_ERROR', `${step} did not complete (${err?.name ?? 'error'})`);
  }
  const text = await readCapped(res, RESPONSE_LIMIT, step);
  if (!(res.status >= 200 && res.status <= 299)) {
    throw new IgError('API_ERROR', `${step} was refused (HTTP ${res.status}${refusedDetail(text)})`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new IgError('API_ERROR', `${step} response is not JSON`);
  }
  const accessToken = body?.access_token;
  if (typeof accessToken !== 'string' || !TOKEN_PATTERN.test(accessToken)) {
    throw new IgError('API_ERROR', `${step} response has no usable access token`);
  }
  const expiresInSeconds = body?.expires_in;
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new IgError('API_ERROR', `${step} response has no usable expires_in`);
  }
  registerToken(accessToken);
  return { accessToken, expiresInSeconds };
}

// The media type of a Content-Type header, without its parameters, in lower case.
function mediaType(header) {
  return typeof header === 'string' ? header.split(';')[0].trim().toLowerCase() : '';
}

// Reads a request body (M-1). Up to the limit the text is kept. Past the limit the rest is read and discarded, up to BODY_DRAIN, so
// the 413 can reach the client; beyond BODY_DRAIN the read stops. Returns { text, tooLarge }.
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      tooLarge = true;
      if (size > BODY_DRAIN) break;
      continue;
    }
    chunks.push(buffer);
  }
  return tooLarge ? { text: null, tooLarge } : { text: Buffer.concat(chunks).toString('utf8'), tooLarge };
}

// The expires_in of the approval, in seconds, or null when it is absent or not a whole positive number. Nothing is invented.
function expiresInOf(raw) {
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

// The Facebook redirect page, and the handler of the loopback server that receives the token it posts (O-8).
//
// The approval comes back to the redirect URI with the token in the fragment, and a browser never sends a fragment to a server.
// So the redirect page is a small static page: its script reads location.hash, clears it with history.replaceState, and posts
// the token and the state to the loopback server as a form body. The handler accepts that POST only from 127.0.0.1, only for the
// Host it listens on, only with the Origin of this server and a same-origin Sec-Fetch-Site, only with the expected state, and only
// up to FACEBOOK_BODY_LIMIT bytes. It accepts one approval. A request that is refused for its peer, Host, Origin, Sec-Fetch-Site,
// method, type, size or state gets a refusal and does not end the login: nothing is stored, and the owner's own approval can still
// arrive. An approval that carries an error, or no usable token, ends the login. No body is logged, and no token is echoed.
export function createFacebookBridgeHandler({ expectedState, port, onResult } = {}) {
  if (typeof expectedState !== 'string' || expectedState === '') {
    throw new TypeError('createFacebookBridgeHandler needs the expected state');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('createFacebookBridgeHandler needs the port as a whole number from 1 to 65535');
  }
  if (typeof onResult !== 'function') throw new TypeError('createFacebookBridgeHandler needs onResult as a function');
  const allowedHost = `${LOOPBACK}:${port}`;
  const allowedOrigin = `http://${allowedHost}`;
  let received = false;

  // Writes a response. onDone, when given, runs after the response has finished, so a result is reported after the page or the
  // refusal has been written.
  function reply(res, status, text, onDone) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'close');
    if (onDone) res.once('finish', onDone);
    res.end(text);
  }

  async function respond(req, res) {
    const remote = req.socket?.remoteAddress ?? '';
    if (!LOOPBACK_REMOTES.has(remote) || req.headers?.host !== allowedHost) {
      reply(res, 403, 'Not allowed.');
      return;
    }
    const path = pathOf(req.url);
    if (path === FACEBOOK_BRIDGE_PATH) {
      if (req.method !== 'GET') {
        reply(res, 405, 'Method not allowed.');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', BRIDGE_CSP);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'close');
      res.end(BRIDGE_HTML);
      return;
    }
    if (path !== FACEBOOK_TOKEN_PATH) {
      reply(res, 404, 'Not found.');
      return;
    }
    if (req.method !== 'POST') {
      reply(res, 405, 'Method not allowed.');
      return;
    }
    // Origin rule (M-2, revised 2026-10-22). An Origin header is accepted only when it equals this server's loopback origin exactly,
    // so older browsers that send no Sec-Fetch-Site are not locked out. Only when Origin is absent is Sec-Fetch-Site consulted:
    // same-origin or none. Every other case is refused, and ends nothing.
    const origin = req.headers?.origin;
    const site = req.headers?.['sec-fetch-site'];
    const sourceOk = origin === undefined ? site === 'same-origin' || site === 'none' : origin === allowedOrigin;
    if (!sourceOk) {
      reply(res, 403, 'Not allowed.');
      return;
    }
    if (received) {
      reply(res, 409, 'The approval was already received.');
      return;
    }
    if (mediaType(req.headers?.['content-type']) !== FORM_TYPE) {
      reply(res, 415, 'Unsupported media type.');
      return;
    }
    const body = await readBody(req, FACEBOOK_BODY_LIMIT);
    if (body.tooLarge) {
      reply(res, 413, 'The request is too large.');
      return;
    }
    const params = new URLSearchParams(body.text);
    // A state that does not match is refused and the login keeps waiting (I-1): a stray request cannot end it, and nothing is stored.
    if (!sameText(params.get('state') ?? '', expectedState)) {
      reply(res, 400, 'The approval does not match this login.');
      return;
    }
    received = true;
    const denied = params.get('error');
    if (denied !== null) {
      const failure = new IgError('CONFIG', `the approval was not granted (${denied.slice(0, 64)})`);
      reply(res, 400, 'The approval was not granted.', () => onResult(failure, null));
      return;
    }
    let token;
    try {
      token = registerToken(params.get('access_token') ?? '');
    } catch (err) {
      reply(res, 400, 'The token could not be used.', () => onResult(err, null));
      return;
    }
    const expiresInSeconds = expiresInOf(params.get('expires_in'));
    reply(res, 200, 'Received. You can close this window and return to the terminal.', () =>
      onResult(null, { token, expiresInSeconds }),
    );
  }

  return function handleBridge(req, res) {
    return respond(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, 'The approval could not be read.');
    });
  };
}

// Waits on 127.0.0.1 for one Facebook approval, and resolves with { token, expiresInSeconds }, where expiresInSeconds is null when
// the approval gave no expiry. Only the loopback interface is bound. Times out after five minutes. An approval that ends the login
// rejects it. Not tested with a real listen.
export function listenForFacebookToken({ port, expectedState, timeoutMs = LOGIN_TIMEOUT_MS, createServer = createHttpServer } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new IgError('CONFIG', 'the approval port must be a whole number from 1 to 65535');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let server = null;
    const finish = (error, approval) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (server !== null) {
        server.close();
        server.closeAllConnections?.();
      }
      if (error) reject(error);
      else resolve(approval);
    };
    server = createServer(createFacebookBridgeHandler({ expectedState, port, onResult: finish }));
    // The error listener stays attached after the server is listening, so a later error ends the login with CONFIG.
    server.on('error', (err) =>
      finish(new IgError('CONFIG', `the approval server could not listen on ${LOOPBACK}:${port} (${err.code ?? 'error'})`)),
    );
    timer = setTimeout(
      () => finish(new IgError('AUTH_EXPIRED', 'no approval arrived before the timeout; start the login again')),
      timeoutMs,
    );
    server.listen(port, LOOPBACK);
  });
}

// The Page whose linked Instagram account is the owner's, from the data of GET me/accounts. Returns the Page id, or null.
export function pageLinkFromAccounts(pages, igUserId) {
  if (!Array.isArray(pages)) throw new TypeError('pageLinkFromAccounts needs the list of Pages');
  if (typeof igUserId !== 'string' || !USER_ID_PATTERN.test(igUserId)) {
    throw new TypeError('pageLinkFromAccounts needs the owner igUserId as a numeric string');
  }
  const page = pages.find((entry) => entry?.instagram_business_account?.id === igUserId);
  return page === undefined ? null : String(page.id);
}
