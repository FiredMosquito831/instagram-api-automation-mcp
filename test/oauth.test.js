import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { IgError } from '../src/errors.js';
import { redact } from '../src/redact.js';
import {
  FACEBOOK_BODY_LIMIT,
  FACEBOOK_SCOPES,
  INSTAGRAM_SCOPES,
  PAGE_LIST_LIMIT,
  RESPONSE_LIMIT,
  buildAuthorizeUrl,
  cappedFetch,
  buildFacebookAuthorizeUrl,
  createCallbackHandler,
  createFacebookBridgeHandler,
  exchangeShortLived,
  listenForFacebookToken,
  listenForRedirect,
  longLivedExchange,
  pageLinkFromAccounts,
  parseRedirect,
  parseUserIdFromRaw,
} from '../src/oauth.js';

const APP_ID = '990602627938098';
const OWNER_ID = '17841400000000001';
const REDIRECT = 'http://127.0.0.1:8790/callback';

// Asserts that fn throws an IgError of the given kind.
function assertKind(fn, kind) {
  assert.throws(fn, (err) => err instanceof IgError && err.kind === kind);
}

// A fake fetch that records each call and returns the given status and body text.
function fakeFetch(status, text) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status, text: async () => text };
  };
  return { fetchImpl, calls };
}

test('buildAuthorizeUrl comma-joins scope and includes state', () => {
  const url = new URL(
    buildAuthorizeUrl({
      appId: APP_ID,
      redirectUri: REDIRECT,
      scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
      state: 'STATE-1',
    }),
  );
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.instagram.com/oauth/authorize');
  assert.equal(url.searchParams.get('scope'), 'instagram_business_basic,instagram_business_manage_messages');
  assert.equal(url.searchParams.get('state'), 'STATE-1');
  assert.equal(url.searchParams.get('client_id'), APP_ID);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('buildAuthorizeUrl carries only the five documented parameters, and no secret or token', () => {
  const text = buildAuthorizeUrl({ appId: APP_ID, redirectUri: REDIRECT, scopes: INSTAGRAM_SCOPES, state: 'S' });
  const url = new URL(text);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['client_id', 'redirect_uri', 'response_type', 'scope', 'state']);
  assert.equal(url.hash, '');
  assert.ok(!/client_secret|access_token/.test(text));
});

test('buildAuthorizeUrl refuses a non-numeric app id and an empty scope list', () => {
  assertKind(() => buildAuthorizeUrl({ appId: 'abc', redirectUri: REDIRECT, scopes: ['x'], state: 'S' }), 'VALIDATION');
  assertKind(() => buildAuthorizeUrl({ appId: APP_ID, redirectUri: REDIRECT, scopes: [], state: 'S' }), 'VALIDATION');
});

test('parseRedirect returns the code when state matches', () => {
  // The #_ suffix that Meta appends is not part of the code.
  const code = parseRedirect(`${REDIRECT}?code=ABC123&state=STATE-1#_`, 'STATE-1');
  assert.equal(code, 'ABC123');
});

test('parseRedirect throws AUTH_EXPIRED when state does not match', () => {
  assertKind(() => parseRedirect(`${REDIRECT}?code=ABC123&state=OTHER`, 'STATE-1'), 'AUTH_EXPIRED');
});

test('parseRedirect throws AUTH_EXPIRED when state is missing', () => {
  assertKind(() => parseRedirect(`${REDIRECT}?code=ABC123`, 'STATE-1'), 'AUTH_EXPIRED');
});

test('parseRedirect checks state before an error parameter, so a forged error is still a state failure', () => {
  assertKind(() => parseRedirect(`${REDIRECT}?error=access_denied&state=OTHER`, 'STATE-1'), 'AUTH_EXPIRED');
  assertKind(() => parseRedirect(`${REDIRECT}?error=access_denied&state=STATE-1`, 'STATE-1'), 'CONFIG');
});

test('parseRedirect refuses a redirect with no code', () => {
  assertKind(() => parseRedirect(`${REDIRECT}?state=STATE-1`, 'STATE-1'), 'VALIDATION');
});

test('the callback handler answers 404 off the callback path and passes the callback URL on', () => {
  const seen = [];
  const handler = createCallbackHandler({ onCallback: (url) => seen.push(url) });
  const res = fakeResponse();
  handler({ url: '/favicon.ico' }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(seen.length, 0);

  const ok = fakeResponse();
  handler({ method: 'GET', url: '/callback?code=XCODE&state=S' }, ok);
  assert.equal(ok.statusCode, 200);
  // The callback runs once the response has finished, so the test lets the response finish first.
  ok.emit('finish');
  assert.equal(seen.length, 1);
  assert.match(seen[0], /code=XCODE/);
  // The page does not echo the code.
  assert.ok(!ok.body.includes('XCODE'));
});

// A response stand-in that is an event emitter, so 'finish' can be emitted by the test. end() records the body and does
// not emit 'finish' by itself.
class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.body = '';
    this.headers = {};
    this.ended = false;
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  end(text = '') {
    this.body = text;
    this.ended = true;
  }
}

function fakeResponse() {
  return new FakeResponse();
}

test('the callback is passed on only after the page has finished writing (M-4)', () => {
  const seen = [];
  const handler = createCallbackHandler({ onCallback: (url) => seen.push(url) });
  const res = fakeResponse();
  handler({ method: 'GET', url: '/callback?code=XCODE&state=S' }, res);
  assert.equal(res.ended, true);
  assert.equal(seen.length, 0, 'the callback must wait for the response to finish');
  res.emit('finish');
  assert.equal(seen.length, 1);
  assert.match(seen[0], /code=XCODE/);
});

test('parseUserIdFromRaw reads a string user_id from the raw text, exactly', () => {
  const raw = '{"data":[{"access_token":"EAAB1234567890","user_id":"17841400000000001"}]}';
  assert.equal(parseUserIdFromRaw(raw), OWNER_ID);
});

test('parseUserIdFromRaw refuses a user_id that is a bare JSON number', () => {
  const raw = '{"data":[{"access_token":"EAAB1234567890","user_id":17841400000000001}]}';
  assertKind(() => parseUserIdFromRaw(raw), 'CONFIG');
});

test('parseUserIdFromRaw refuses a response with no user_id', () => {
  assertKind(() => parseUserIdFromRaw('{"data":[{"access_token":"EAAB1234567890"}]}'), 'VALIDATION');
});

test('exchangeShortLived posts the code in the body, never in the URL', async () => {
  const body = JSON.stringify({ data: [{ access_token: 'EAAB-SHORT-0001', user_id: OWNER_ID }] });
  const { fetchImpl, calls } = fakeFetch(200, body);
  const result = await exchangeShortLived({
    appId: APP_ID,
    appSecret: 'APP-SECRET-VALUE-1',
    redirectUri: REDIRECT,
    code: 'CODE-VALUE-1',
    fetchImpl,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.instagram.com/oauth/access_token');
  assert.ok(!calls[0].url.includes('?'));
  assert.equal(calls[0].init.method, 'POST');
  const sent = new URLSearchParams(calls[0].init.body);
  assert.equal(sent.get('code'), 'CODE-VALUE-1');
  assert.equal(sent.get('client_secret'), 'APP-SECRET-VALUE-1');
  assert.equal(sent.get('grant_type'), 'authorization_code');
  assert.equal(result.userId, OWNER_ID);
  assert.equal(result.accessToken, 'EAAB-SHORT-0001');
});

test('exchangeShortLived registers the token it receives before returning it', async () => {
  const body = JSON.stringify({ data: [{ access_token: 'EAAB-REGISTERED-0002', user_id: OWNER_ID }] });
  const { fetchImpl } = fakeFetch(200, body);
  await exchangeShortLived({ appId: APP_ID, appSecret: 'APP-SECRET-VALUE-2', redirectUri: REDIRECT, code: 'C', fetchImpl });
  assert.ok(!JSON.stringify(redact({ note: 'EAAB-REGISTERED-0002' })).includes('EAAB-REGISTERED-0002'));
});

test('exchangeShortLived refuses a user_id that is a number, with no token stored', async () => {
  const body = '{"data":[{"access_token":"EAAB-NUM-0003","user_id":17841400000000001}]}';
  const { fetchImpl } = fakeFetch(200, body);
  await assert.rejects(
    exchangeShortLived({ appId: APP_ID, appSecret: 'APP-SECRET-VALUE-3', redirectUri: REDIRECT, code: 'C', fetchImpl }),
    (err) => err instanceof IgError && err.kind === 'CONFIG',
  );
});

test('exchangeShortLived maps a refused exchange to API_ERROR without echoing the secret', async () => {
  const { fetchImpl } = fakeFetch(400, '{"error_type":"OAuthException","code":400,"error_message":"Matching code was not found"}');
  await assert.rejects(
    exchangeShortLived({ appId: APP_ID, appSecret: 'APP-SECRET-VALUE-4', redirectUri: REDIRECT, code: 'C', fetchImpl }),
    (err) => {
      assert.equal(err.kind, 'API_ERROR');
      assert.ok(!err.message.includes('APP-SECRET-VALUE-4'));
      return true;
    },
  );
});

// O-7. The long-lived exchange: the short-lived token in the Bearer header, the secret and grant type in the form body, and no
// query string. Each test injects a fake fetch, so no request leaves the process.
test('the long-lived exchange sends the token in the Bearer header, the secret in the body, and no query (O-7)', async () => {
  const { fetchImpl, calls } = fakeFetch(
    200,
    JSON.stringify({ access_token: 'EAAB-LONG-7-VALUE', token_type: 'bearer', expires_in: 5184000 }),
  );
  const result = await longLivedExchange({ appSecret: 'APP-SECRET-VALUE-7', shortToken: 'EAAB-SHORT-7-VALUE', fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://graph.instagram.com/access_token');
  assert.equal(new URL(calls[0].url).search, '', 'the query string is empty');
  assert.ok(!calls[0].url.includes('EAAB-SHORT-7-VALUE'), 'the short-lived token is not in the URL');
  assert.ok(!calls[0].url.includes('APP-SECRET-VALUE-7'), 'the app secret is not in the URL');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer EAAB-SHORT-7-VALUE');
  const sent = new URLSearchParams(calls[0].init.body);
  assert.equal(sent.get('grant_type'), 'ig_exchange_token');
  assert.equal(sent.get('client_secret'), 'APP-SECRET-VALUE-7');
  assert.equal(sent.get('access_token'), null, 'the token travels in the header, not the body');
  assert.equal(result.accessToken, 'EAAB-LONG-7-VALUE');
  assert.equal(result.expiresInSeconds, 5184000);
});

test('the long-lived exchange registers its token before it is returned (O-7)', async () => {
  const { fetchImpl } = fakeFetch(200, JSON.stringify({ access_token: 'EAAB-LONG-REG-VALUE', expires_in: 60 }));
  await longLivedExchange({ appSecret: 'APP-SECRET-VALUE-REG', shortToken: 'EAAB-SHORT-REG', fetchImpl });
  assert.ok(!JSON.stringify(redact({ note: 'EAAB-LONG-REG-VALUE' })).includes('EAAB-LONG-REG-VALUE'));
});

test('the long-lived exchange names its step and the HTTP status when Meta refuses, with no secret text (O-7)', async () => {
  const { fetchImpl } = fakeFetch(
    400,
    '{"error_type":"OAuthException","code":400,"error_message":"Matching code was not found APP-SECRET-VALUE-REF"}',
  );
  await assert.rejects(
    longLivedExchange({ appSecret: 'APP-SECRET-VALUE-REF', shortToken: 'EAAB-SHORT-REF', fetchImpl }),
    (err) => {
      assert.equal(err.kind, 'API_ERROR');
      assert.equal(err.message, 'the long-lived token exchange was refused (HTTP 400, OAuthException)');
      assert.ok(!err.message.includes('APP-SECRET-VALUE-REF'));
      return true;
    },
  );
});

test('the long-lived exchange names its step when the request does not complete (O-7)', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    longLivedExchange({ appSecret: 'APP-SECRET-VALUE-NET', shortToken: 'EAAB-SHORT-NET', fetchImpl }),
    (err) => err.kind === 'API_ERROR' && err.message === 'the long-lived token exchange did not complete (TypeError)',
  );
});

test('the long-lived exchange refuses a response with no usable token or expiry (O-7)', async () => {
  const noToken = fakeFetch(200, JSON.stringify({ expires_in: 60 })).fetchImpl;
  await assert.rejects(
    longLivedExchange({ appSecret: 'APP-SECRET-VALUE-NT', shortToken: 'EAAB-SHORT-NT', fetchImpl: noToken }),
    (err) => err.kind === 'API_ERROR' && /no usable access token/.test(err.message),
  );
  const noExpiry = fakeFetch(200, JSON.stringify({ access_token: 'EAAB-LONG-NE-VALUE' })).fetchImpl;
  await assert.rejects(
    longLivedExchange({ appSecret: 'APP-SECRET-VALUE-NE', shortToken: 'EAAB-SHORT-NE', fetchImpl: noExpiry }),
    (err) => err.kind === 'API_ERROR' && /no usable expires_in/.test(err.message),
  );
});

// O-8. The Facebook fragment flow: the authorize URL, the bridge page, the bridge POST, and the approval receiver.
function form(fields) {
  return new URLSearchParams(fields).toString();
}

const FB_TOKEN = 'FB-TOKEN-BRIDGE-VALUE-1';
const BRIDGE_REDIRECT = 'http://127.0.0.1:8790/facebook-callback';

// A fake request: a readable body, the method and URL, the headers, and the remote address of the socket.
function fakeRequest({ method = 'POST', url = '/facebook-token', body = '', headers = {}, remote = '127.0.0.1', host = '127.0.0.1:8790' } = {}) {
  const req = Readable.from(body === '' ? [] : [body]);
  return Object.assign(req, {
    method,
    url,
    // A browser's own POST from the page: this server's origin, and a same-origin fetch (M-2).
    headers: {
      host,
      origin: `http://${host}`,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    socket: { remoteAddress: remote },
  });
}

// A response that finishes as soon as it is ended, as a real response does once its bytes are handed to the kernel.
class AutoFinishResponse extends FakeResponse {
  end(text = '') {
    super.end(text);
    this.emit('finish');
  }
}

// A handler whose results are recorded, for the fake requests above.
function bridge(expectedState = 'STATE-FB-1') {
  const results = [];
  const handler = createFacebookBridgeHandler({
    expectedState,
    port: 8790,
    // The approval is { token, expiresInSeconds }. The results keep the token and the expiry as separate fields.
    onResult: (error, approval) =>
      results.push({ error, token: approval?.token ?? null, expiresInSeconds: approval?.expiresInSeconds ?? null }),
  });
  return { handler, results };
}

test('buildFacebookAuthorizeUrl asks for response_type=token, and carries no secret or token (O-8)', () => {
  const text = buildFacebookAuthorizeUrl({ appId: APP_ID, redirectUri: BRIDGE_REDIRECT, scopes: FACEBOOK_SCOPES, state: 'S-FB' });
  const url = new URL(text);
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.facebook.com/dialog/oauth');
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('scope'), FACEBOOK_SCOPES.join(','));
  assert.deepEqual([...url.searchParams.keys()].sort(), ['client_id', 'redirect_uri', 'response_type', 'scope', 'state']);
  assert.ok(!/client_secret|access_token/.test(text));
});

test('the bridge page holds no token or secret, and its CSP names the hash of its own script (O-8)', async () => {
  const { handler } = bridge('STATE-PAGE-VALUE');
  const res = new AutoFinishResponse();
  await handler(fakeRequest({ method: 'GET', url: '/facebook-callback', body: '' }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /^text\/html/);
  assert.ok(!res.body.includes('STATE-PAGE-VALUE'), 'the page holds no state');
  assert.ok(!res.body.includes(FB_TOKEN), 'the page holds no token');
  const scriptText = res.body.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(scriptText.includes('history.replaceState'), 'the script clears the fragment');
  assert.ok(scriptText.includes("location.origin + '/facebook-token'"), 'the script posts to the loopback token path');
  const hash = createHash('sha256').update(scriptText).digest('base64');
  assert.equal(
    res.headers['Content-Security-Policy'],
    `default-src 'none'; script-src 'sha256-${hash}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
});

test('a POST with the fragment token and a matching state is accepted, and the token is registered (O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-1');
  const res = new AutoFinishResponse();
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'STATE-FB-1' }) }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(results.length, 1);
  assert.equal(results[0].error, null);
  assert.equal(results[0].token, FB_TOKEN);
  assert.ok(!res.body.includes(FB_TOKEN), 'the token is not echoed');
  assert.ok(!redact({ note: FB_TOKEN }).note.includes(FB_TOKEN), 'the token is registered for masking');
});

test('a POST with a mismatched state gets 400, stores nothing, and the login keeps waiting (I-1, O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-2');
  const res = new AutoFinishResponse();
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'OTHER-STATE' }) }), res);
  // Old assertions (before I-1): statusCode 403, one result with error AUTH_EXPIRED and token null.
  assert.equal(res.statusCode, 400);
  assert.equal(results.length, 0, 'nothing is reported: the login keeps waiting');
  assert.ok(!res.body.includes(FB_TOKEN));
  // The owner's own approval, with the matching state, is still accepted after the stray request.
  const own = new AutoFinishResponse();
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'STATE-FB-2' }) }), own);
  assert.equal(own.statusCode, 200);
  assert.equal(results.length, 1);
  assert.equal(results[0].token, FB_TOKEN);
});

test('a body over the limit is refused with 413, and does not end the login (O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-3');
  const big = form({ access_token: FB_TOKEN, state: 'STATE-FB-3', padding: 'x'.repeat(FACEBOOK_BODY_LIMIT) });
  const refused = new AutoFinishResponse();
  await handler(fakeRequest({ body: big }), refused);
  assert.equal(refused.statusCode, 413);
  assert.equal(results.length, 0, 'an over-limit body is not received');
  const fits = new AutoFinishResponse();
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'STATE-FB-3' }) }), fits);
  assert.equal(fits.statusCode, 200, 'a later approval within the limit is still accepted');
  assert.equal(results[0].token, FB_TOKEN);
});

test('a request from another address, or for another Host, is refused and ends nothing (O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-4');
  const body = form({ access_token: FB_TOKEN, state: 'STATE-FB-4' });
  const remote = new AutoFinishResponse();
  await handler(fakeRequest({ body, remote: '10.0.0.7' }), remote);
  assert.equal(remote.statusCode, 403);
  const rebound = new AutoFinishResponse();
  await handler(fakeRequest({ body, host: 'evil.example:8790' }), rebound);
  assert.equal(rebound.statusCode, 403);
  assert.equal(results.length, 0, 'neither refused request ends the login');
  const ok = new AutoFinishResponse();
  await handler(fakeRequest({ body }), ok);
  assert.equal(ok.statusCode, 200);
});

test('a POST that is not form-encoded is refused with 415, and ends nothing (O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-5');
  const res = new AutoFinishResponse();
  await handler(
    fakeRequest({ body: JSON.stringify({ access_token: FB_TOKEN, state: 'STATE-FB-5' }), headers: { 'content-type': 'application/json' } }),
    res,
  );
  assert.equal(res.statusCode, 415);
  assert.equal(results.length, 0);
});

test('an approval that carries an error is refused with CONFIG, and ends the login (O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-6');
  const res = new AutoFinishResponse();
  await handler(fakeRequest({ body: form({ error: 'access_denied', state: 'STATE-FB-6' }) }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(results[0].error.kind, 'CONFIG');
  assert.match(results[0].error.message, /not granted \(access_denied\)/);
});

test('an approval without a token is refused, and ends the login with an API_ERROR (O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-7');
  const res = new AutoFinishResponse();
  await handler(fakeRequest({ body: form({ state: 'STATE-FB-7' }) }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(results[0].error.kind, 'API_ERROR');
  assert.equal(results[0].token, null);
});

test('the bridge accepts one approval only: a second POST is refused with 409 (O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-8');
  const body = form({ access_token: FB_TOKEN, state: 'STATE-FB-8' });
  await handler(fakeRequest({ body }), new AutoFinishResponse());
  const again = new AutoFinishResponse();
  await handler(fakeRequest({ body }), again);
  assert.equal(again.statusCode, 409);
  assert.equal(results.length, 1);
});

test('the bridge answers a GET on the token path with 405, and an unknown path with 404 (O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-9');
  const getToken = new AutoFinishResponse();
  await handler(fakeRequest({ method: 'GET', url: '/facebook-token', body: '' }), getToken);
  assert.equal(getToken.statusCode, 405);
  const unknown = new AutoFinishResponse();
  await handler(fakeRequest({ method: 'GET', url: '/elsewhere', body: '' }), unknown);
  assert.equal(unknown.statusCode, 404);
  assert.equal(results.length, 0);
});

// The approval receiver with a fake server: the handler it builds is the one the tests call, and nothing listens.
test('the approval receiver resolves with the token the bridge accepts, with no listen (O-8)', async () => {
  let handler = null;
  const server = Object.assign(new EventEmitter(), { listen() {}, close() {}, closeAllConnections() {} });
  const pending = listenForFacebookToken({
    port: 8790,
    expectedState: 'STATE-SRV-1',
    timeoutMs: 60000,
    createServer: (h) => {
      handler = h;
      return server;
    },
  });
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'STATE-SRV-1' }) }), new AutoFinishResponse());
  assert.equal((await pending).token, FB_TOKEN);
});

test('the approval receiver keeps waiting after a mismatched state, and resolves on the matching one (I-1, O-8)', async () => {
  let handler = null;
  const server = Object.assign(new EventEmitter(), { listen() {}, close() {}, closeAllConnections() {} });
  const pending = listenForFacebookToken({
    port: 8790,
    expectedState: 'STATE-SRV-2',
    timeoutMs: 60000,
    createServer: (h) => {
      handler = h;
      return server;
    },
  });
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'FORGED' }) }), new AutoFinishResponse());
  // Old assertion (before I-1): the receiver rejected with AUTH_EXPIRED on the first mismatched POST.
  let settled = false;
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolveTick) => setImmediate(resolveTick));
  assert.equal(settled, false, 'a mismatched state does not end the login');
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'STATE-SRV-2' }) }), new AutoFinishResponse());
  const approval = await pending;
  assert.equal(approval.token, FB_TOKEN);
  assert.equal(approval.expiresInSeconds, null);
});

test('an error from the approval server after it is listening ends the login with CONFIG (O-8)', async () => {
  const servers = [];
  const createServer = () => {
    const server = Object.assign(new EventEmitter(), { listen() {}, close() {}, closeAllConnections() {} });
    servers.push(server);
    return server;
  };
  const pending = listenForFacebookToken({ port: 8790, expectedState: 'S-O8', timeoutMs: 60000, createServer });
  servers[0].emit('error', Object.assign(new Error('the socket went away'), { code: 'ECONNRESET' }));
  await assert.rejects(pending, (err) => err instanceof IgError && err.kind === 'CONFIG');
});

test('pageLinkFromAccounts returns the page linked to the owner account, and null when none is', () => {
  const pages = [
    { id: '1001', name: 'Other', instagram_business_account: { id: '999' } },
    { id: '1002', name: 'Owner', instagram_business_account: { id: OWNER_ID } },
  ];
  assert.equal(pageLinkFromAccounts(pages, OWNER_ID), '1002');
  assert.equal(pageLinkFromAccounts(pages.slice(0, 1), OWNER_ID), null);
  assert.equal(pageLinkFromAccounts([], OWNER_ID), null);
  assert.throws(() => pageLinkFromAccounts('not a list', OWNER_ID), TypeError);
});

// F-19 (Task 17 M-5). A callback whose state is not the expected one gets 400 and does not end the login. The right state does.
test('a callback with the wrong or no state gets 400 and does not end the login; the right state does (F-19)', () => {
  const seen = [];
  const handler = createCallbackHandler({ onCallback: (url) => seen.push(url), expectedState: 'STATE-19' });
  const wrong = fakeResponse();
  handler({ method: 'GET', url: '/callback?code=XCODE&state=OTHER' }, wrong);
  assert.equal(wrong.statusCode, 400);
  wrong.emit('finish');
  const none = fakeResponse();
  handler({ method: 'GET', url: '/callback?code=XCODE' }, none);
  assert.equal(none.statusCode, 400);
  none.emit('finish');
  assert.equal(seen.length, 0, 'the login keeps waiting');
  const right = fakeResponse();
  handler({ method: 'GET', url: '/callback?code=XCODE&state=STATE-19' }, right);
  assert.equal(right.statusCode, 200);
  right.emit('finish');
  assert.equal(seen.length, 1);
});

// P1 fix round. A body over the limit is read to its end (up to a bound), so the 413 can reach the client (M-1).
test('a body over the limit gets 413, and the request is drained to its end (M-1, O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-M1');
  let consumed = 0;
  async function* feed(pieces, size) {
    for (let i = 0; i < pieces; i += 1) {
      consumed += size;
      yield 'x'.repeat(size);
    }
  }
  const req = Object.assign(Readable.from(feed(12, 1024)), {
    method: 'POST',
    url: '/facebook-token',
    headers: { host: '127.0.0.1:8790', origin: 'http://127.0.0.1:8790', 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
    socket: { remoteAddress: '127.0.0.1' },
  });
  const res = new AutoFinishResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 413);
  assert.equal(consumed, 3 * FACEBOOK_BODY_LIMIT, 'the whole body was read, so the 413 reaches the client');
  assert.equal(results.length, 0, 'an over-limit body ends nothing');
});

test('a body beyond the drain bound is read only to the bound, and still gets 413 (M-1, O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-M1B');
  let consumed = 0;
  async function* feed(pieces, size) {
    for (let i = 0; i < pieces; i += 1) {
      consumed += size;
      yield 'x'.repeat(size);
    }
  }
  const req = Object.assign(Readable.from(feed(100, 1024)), {
    method: 'POST',
    url: '/facebook-token',
    headers: { host: '127.0.0.1:8790', origin: 'http://127.0.0.1:8790', 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
    socket: { remoteAddress: '127.0.0.1' },
  });
  const res = new AutoFinishResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 413);
  assert.ok(consumed < 100 * 1024, 'a hostile body is not read in full');
  assert.equal(results.length, 0);
});

// M-2 (revised 2026-10-22). Origin rule: an Origin that equals this server's loopback origin exactly is accepted. Only with no
// Origin is Sec-Fetch-Site consulted (same-origin or none). Every other case is refused, and ends nothing.

// Old assertions (before the revision): a missing Origin was refused, and the default matching headers were accepted.
test('a POST whose Origin is not this server is refused with 403, and ends nothing (M-2, O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-M2');
  const body = form({ access_token: FB_TOKEN, state: 'STATE-FB-M2' });
  const other = new AutoFinishResponse();
  await handler(fakeRequest({ body, headers: { origin: 'http://evil.example' } }), other);
  assert.equal(other.statusCode, 403);
  const secure = new AutoFinishResponse();
  await handler(fakeRequest({ body, headers: { origin: 'https://127.0.0.1:8790' } }), secure);
  assert.equal(secure.statusCode, 403, 'the scheme must match exactly');
  const port = new AutoFinishResponse();
  await handler(fakeRequest({ body, headers: { origin: 'http://127.0.0.1:9999' } }), port);
  assert.equal(port.statusCode, 403, 'the port must match exactly');
  assert.equal(results.length, 0, 'the refused requests end nothing');
  const ok = new AutoFinishResponse();
  await handler(fakeRequest({ body }), ok);
  assert.equal(ok.statusCode, 200);
});

test('a POST with a matching Origin and no Sec-Fetch-Site is accepted, for an older browser (M-2, O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-M2C');
  const res = new AutoFinishResponse();
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'STATE-FB-M2C' }), headers: { 'sec-fetch-site': undefined } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(results.length, 1);
  assert.equal(results[0].token, FB_TOKEN);
});

test('a POST with no Origin and Sec-Fetch-Site same-origin is accepted (M-2, O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-M2D');
  const res = new AutoFinishResponse();
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'STATE-FB-M2D' }), headers: { origin: undefined, 'sec-fetch-site': 'same-origin' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(results.length, 1);
});

test('a POST with neither Origin nor Sec-Fetch-Site is refused with 403, and ends nothing (M-2, O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-M2E');
  const res = new AutoFinishResponse();
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'STATE-FB-M2E' }), headers: { origin: undefined, 'sec-fetch-site': undefined } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(results.length, 0);
});

// Old assertions (before the revision): every case below used the matching Origin, so Sec-Fetch-Site was always checked.
test('with no Origin, a POST whose Sec-Fetch-Site is cross-site or same-site is refused, and none or same-origin is accepted (M-2, O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-M2F');
  const body = form({ access_token: FB_TOKEN, state: 'STATE-FB-M2F' });
  for (const site of ['cross-site', 'same-site']) {
    const res = new AutoFinishResponse();
    await handler(fakeRequest({ body, headers: { origin: undefined, 'sec-fetch-site': site } }), res);
    assert.equal(res.statusCode, 403, `Sec-Fetch-Site ${site}`);
  }
  assert.equal(results.length, 0, 'the refused requests end nothing');
  const none = new AutoFinishResponse();
  await handler(fakeRequest({ body, headers: { origin: undefined, 'sec-fetch-site': 'none' } }), none);
  assert.equal(none.statusCode, 200, 'none, a user-typed navigation, is accepted with no Origin');
  // The handler accepts one approval, so the same-origin case needs a handler of its own.
  const second = bridge('STATE-FB-M2F');
  const sameOrigin = new AutoFinishResponse();
  await second.handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'STATE-FB-M2F' }), headers: { origin: undefined, 'sec-fetch-site': 'same-origin' } }), sameOrigin);
  assert.equal(sameOrigin.statusCode, 200, 'same-origin is accepted with no Origin');
});

test('a matching Origin is accepted whatever its Sec-Fetch-Site, because the Origin rule decides (M-2, O-8)', async () => {
  const { handler, results } = bridge('STATE-FB-M2G');
  const res = new AutoFinishResponse();
  await handler(fakeRequest({ body: form({ access_token: FB_TOKEN, state: 'STATE-FB-M2G' }), headers: { 'sec-fetch-site': 'cross-site' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(results.length, 1);
});

test('the Instagram callback accepts GET only, and a POST gets 405 and ends nothing (M-2)', () => {
  const seen = [];
  const handler = createCallbackHandler({ onCallback: (url) => seen.push(url) });
  const res = fakeResponse();
  handler({ method: 'POST', url: '/callback?code=XCODE&state=S' }, res);
  assert.equal(res.statusCode, 405);
  res.emit('finish');
  assert.equal(seen.length, 0);
});

// M-8. The granted scopes are the permissions the exchange returned; none when it returns none.
test('the short-lived exchange returns the permissions it granted, and none when it returns none (M-8)', async () => {
  const granted = fakeFetch(
    200,
    JSON.stringify({ data: [{ access_token: 'EAAB-PERM-VALUE-1', user_id: OWNER_ID, permissions: 'instagram_business_basic, instagram_business_manage_messages' }] }),
  ).fetchImpl;
  const first = await exchangeShortLived({ appId: APP_ID, appSecret: 'APP-SECRET-VALUE-P8', redirectUri: REDIRECT, code: 'CODE-P8', fetchImpl: granted });
  assert.deepEqual(first.grantedScopes, ['instagram_business_basic', 'instagram_business_manage_messages']);
  const none = fakeFetch(200, JSON.stringify({ data: [{ access_token: 'EAAB-PERM-VALUE-2', user_id: OWNER_ID }] })).fetchImpl;
  const second = await exchangeShortLived({ appId: APP_ID, appSecret: 'APP-SECRET-VALUE-P8', redirectUri: REDIRECT, code: 'CODE-P8B', fetchImpl: none });
  assert.equal(second.grantedScopes, null);
});

// M-9. A token exchange response over the cap is refused, and names its step. The Page list is capped in cappedFetch.
test('a token exchange response over the cap is refused, and names the step (M-9)', async () => {
  const { fetchImpl } = fakeFetch(200, 'x'.repeat(RESPONSE_LIMIT + 1));
  await assert.rejects(
    exchangeShortLived({ appId: APP_ID, appSecret: 'APP-SECRET-VALUE-M9', redirectUri: REDIRECT, code: 'CODE-M9', fetchImpl }),
    (err) => err.kind === 'API_ERROR' && err.message === `the token exchange response is larger than ${RESPONSE_LIMIT} bytes; it is refused`,
  );
});

test('a long-lived response over the cap is refused, and names the step (M-9)', async () => {
  const { fetchImpl } = fakeFetch(200, 'x'.repeat(RESPONSE_LIMIT + 1));
  await assert.rejects(
    longLivedExchange({ appSecret: 'APP-SECRET-VALUE-M9L', shortToken: 'EAAB-SHORT-M9L', fetchImpl }),
    (err) =>
      err.kind === 'API_ERROR' &&
      err.message === `the long-lived token exchange response is larger than ${RESPONSE_LIMIT} bytes; it is refused`,
  );
});

test('cappedFetch gives HTTP 413 for a body over the cap, and passes a body under it (M-9)', async () => {
  const over = cappedFetch(async () => new Response('x'.repeat(PAGE_LIST_LIMIT + 1), { status: 200 }), PAGE_LIST_LIMIT);
  assert.equal((await over('https://graph.facebook.com/v26.0/me/accounts')).status, 413);
  const under = cappedFetch(async () => new Response('{"ok":1}', { status: 200 }), PAGE_LIST_LIMIT);
  const passed = await under('https://graph.facebook.com/v26.0/me/accounts');
  assert.equal(passed.status, 200);
  assert.equal(await passed.text(), '{"ok":1}');
});

// M-10. The approval's expires_in is handed on when it is a whole positive number; otherwise it is null. No lifetime is invented.
test('an approval reports its expires_in, or null when it has none or it is not a whole number (M-10, O-8)', async () => {
  const cases = [
    [{ access_token: FB_TOKEN, state: 'STATE-M10A', expires_in: '5183944' }, 5183944],
    [{ access_token: FB_TOKEN, state: 'STATE-M10B' }, null],
    [{ access_token: FB_TOKEN, state: 'STATE-M10C', expires_in: 'soon' }, null],
    [{ access_token: FB_TOKEN, state: 'STATE-M10D', expires_in: '0' }, null],
  ];
  for (const [fields, expected] of cases) {
    const { handler, results } = bridge(fields.state);
    await handler(fakeRequest({ body: form(fields) }), new AutoFinishResponse());
    assert.equal(results[0].expiresInSeconds, expected, fields.state);
  }
});

test('the bridge page script posts expires_in from the fragment when there is one (M-10)', async () => {
  const { handler } = bridge('STATE-M10P');
  const res = new AutoFinishResponse();
  await handler(fakeRequest({ method: 'GET', url: '/facebook-callback', body: '' }), res);
  const scriptText = res.body.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(scriptText.includes("params.get('expires_in')"));
  assert.ok(scriptText.includes('fields.expires_in = expires'));
});

// F-20 (Task 17 M-6). The redirect server keeps its error listener after it is listening. An error from it ends the login with
// CONFIG. A fake server stands in, so no socket is opened.
test('an error from the redirect server after it is listening ends the login with CONFIG (F-20)', async () => {
  const servers = [];
  const createServer = () => {
    const server = Object.assign(new EventEmitter(), { listen() {}, close() {}, closeAllConnections() {} });
    servers.push(server);
    return server;
  };
  const pending = listenForRedirect({ port: 8790, expectedState: 'S-20', timeoutMs: 60000, createServer });
  servers[0].emit('error', Object.assign(new Error('the socket went away'), { code: 'ECONNRESET' }));
  await assert.rejects(pending, (err) => err instanceof IgError && err.kind === 'CONFIG');
});
