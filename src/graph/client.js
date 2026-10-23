// The Graph API client. The token goes only in the Authorization header, never in the URL. Redirects are refused,
// so the token reaches only the configured origin. Failures are IgError kinds from errors.js: a stop condition is
// mapped there, and a body that is not JSON is API_ERROR.

import { IgError, mapGraphError } from '../errors.js';
import { defaultSleep } from '../util/clock.js';
import { isPlainObject } from '../util/object.js';

const TIMEOUT_MS = 15000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
// Only a RATE_LIMITED or API_ERROR response is retried, so a stop (AUTH_EXPIRED, ACTION_BLOCKED, CHECKPOINT) never is.
const RETRY_KINDS = new Set(['RATE_LIMITED', 'API_ERROR']);
const BACKOFF_MS = Object.freeze([1000, 2000, 4000]);
// The longest Retry-After, in seconds, that is waited for. It matches the 60000 ms usage window, so a longer wait is
// refused, and the call returns its error.
const MAX_RETRY_AFTER_SECONDS = 60;
// A query or form field with this name would put the token in a URL, so it is refused.
const TOKEN_FIELD = /^access_token$/i;
const LOGIN_BASE = Object.freeze({ instagram: 'instagramBase', facebook: 'facebookBase' });
const VERSION_PATTERN = /^v\d+\.\d+$/;
const PATH_PATTERN = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const TOKEN_PATTERN = /^\S+$/;
const RETRY_AFTER_PATTERN = /^\d+$/;
// A response body larger than this is refused. Graph's answers are small JSON, so a larger body is an error, not data.
const MAX_BODY_BYTES = 5 * 1024 * 1024;
// The Node error codes of a failure that happened before any request reached Graph: the connection was refused, or the
// host name could not be resolved. Any other failure, a timeout included, may have reached Graph, so it is not one of these.
const PRE_SEND_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
// An id or path part made only of dots changes the request, so it is refused.
const DOTS_ONLY = /^\.+$/;

// The Node error codes on a failure: its own, its cause's, and for several addresses the codes in its errors list.
function codesOf(err, depth = 0) {
  if (err === null || typeof err !== 'object' || depth > 3) return [];
  const own = typeof err.code === 'string' ? [err.code] : [];
  const nested = Array.isArray(err.errors) ? err.errors.flatMap((item) => codesOf(item, depth + 1)) : [];
  return [...own, ...nested, ...codesOf(err.cause, depth + 1)];
}

// True only when every code of the failure is a pre-send code. A fetch failure with no code, or a timeout, is not.
function isPreSend(err) {
  const codes = codesOf(err);
  return codes.length > 0 && codes.every((code) => PRE_SEND_CODES.has(code));
}

// A failure of a response (an HTTP error, a body that is not JSON, a body that is too large) happened after the request was
// sent, so it is never pre-send. Every error the client returns carries details.preSend as a boolean.
function markResponseError(error) {
  error.details = { ...error.details, preSend: false };
  return error;
}

function errorName(err) {
  return typeof err?.name === 'string' ? err.name : 'error';
}

// A base must be an https origin with no path, credentials or trailing slash, so the token goes only to that origin.
function checkBase(value, name) {
  let url = null;
  if (typeof value === 'string') {
    try {
      url = new URL(value);
    } catch {
      url = null;
    }
  }
  if (url === null || url.protocol !== 'https:' || url.origin !== value) {
    throw new IgError('CONFIG', `${name} must be an https origin, such as https://graph.instagram.com`);
  }
  return value;
}

// Encodes a flat object as a query string or a form body. A missing value is skipped. A string, a finite number
// or a boolean is written as text, and any other value is refused. A token field is refused.
function encodeParams(values, name) {
  if (values === undefined) return '';
  if (!isPlainObject(values)) throw new IgError('VALIDATION', `the ${name} must be an object`);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (TOKEN_FIELD.test(key)) {
      throw new IgError('CONFIG', 'a token goes in the Authorization header, not in a query or form field');
    }
    const scalar =
      typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
    if (!scalar) throw new IgError('VALIDATION', `the ${name} value for ${key} must be a string, number or boolean`);
    params.append(key, String(value));
  }
  return params.toString();
}

// The body of a POST: either json or form, never both. Returns the payload and its content type.
function encodeBody({ form, json }) {
  if (form !== undefined && json !== undefined) throw new IgError('VALIDATION', 'give form or json, not both');
  if (json !== undefined) {
    if (!isPlainObject(json)) throw new IgError('VALIDATION', 'json must be an object');
    return { payload: JSON.stringify(json), contentType: 'application/json' };
  }
  if (form !== undefined) {
    return { payload: encodeParams(form, 'form'), contentType: 'application/x-www-form-urlencoded' };
  }
  return {};
}

// Reads one usage header as a JSON object. A missing header gives a null value. A header that is present but is not
// a JSON object gives the header name as unreadable, so an unreadable usage is never taken for a missing one.
function readUsageHeader(headers, name) {
  const value = headers.get(name);
  if (value === null) return { value: null };
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { unreadable: name };
  }
  return isPlainObject(parsed) ? { value: parsed } : { unreadable: name };
}

// The usage of one response: { app, business }, each the parsed header or null, or null when neither is present.
// When a header cannot be read, the usage is the marker { app: null, business: null, unreadable: '<header name>' },
// naming the first unreadable header. onUsage receives this marker, so the caller can hold outbound calls on it.
function readUsage(headers) {
  const app = readUsageHeader(headers, 'x-app-usage');
  if (app.unreadable !== undefined) return { app: null, business: null, unreadable: app.unreadable };
  const business = readUsageHeader(headers, 'x-business-use-case-usage');
  if (business.unreadable !== undefined) return { app: null, business: null, unreadable: business.unreadable };
  if (app.value === null && business.value === null) return null;
  return { app: app.value, business: business.value };
}

// Passes one response's usage to onUsage. A throw from the callback is not raised: the response was sent by Graph, so a
// write in it has happened, and the caller must still get the result, rather than a failure that could lead to a retry.
// The warning carries no detail.
function recordUsage(onUsage, usage) {
  if (onUsage === undefined) return;
  try {
    onUsage(usage);
  } catch {
    process.emitWarning('a usage reading could not be recorded; the response is returned as it was');
  }
}

// Sorts one response into a result or an error. Only an object body reaches mapGraphError: a body that is not
// JSON, or is JSON but not an object, is passed as null, which maps by HTTP status alone.
function classify(res, text) {
  let parsed;
  let isJson = true;
  try {
    parsed = JSON.parse(text);
  } catch {
    isJson = false;
  }
  const body = isPlainObject(parsed) ? parsed : null;
  const hasError = body !== null && body.error !== undefined && body.error !== null;
  if (res.ok && !hasError) {
    // An empty 2xx body is a success with no data, such as a 204 from a DELETE.
    if (text.trim() === '') return { ok: true, data: null };
    if (isJson) return { ok: true, data: parsed };
    return { ok: false, error: new IgError('API_ERROR', 'Graph API response body is not JSON') };
  }
  return { ok: false, error: mapGraphError({ status: res.status, body }) };
}

// The wait before a retry of a failed response, or null when it is not retried. A Retry-After that is not whole
// seconds, or is longer than MAX_RETRY_AFTER_SECONDS, is not retried.
function retryWait(res, error, retryable, attempt) {
  if (!retryable || attempt >= BACKOFF_MS.length) return null;
  if (!RETRY_STATUSES.has(res.status) || !RETRY_KINDS.has(error.kind)) return null;
  const header = res.headers.get('retry-after');
  if (header === null) return BACKOFF_MS[attempt];
  if (!RETRY_AFTER_PATTERN.test(header)) return null;
  const seconds = Number(header);
  return seconds <= MAX_RETRY_AFTER_SECONDS ? seconds * 1000 : null;
}

// Creates a Graph API client. The config is checked here, so a bad base, version or login product is refused before
// any request. onUsage, when given, is called after every response with that response's usage, the unreadable marker, or
// null. A throw from onUsage is caught (see recordUsage), so the response is still returned.
export function createGraphClient({ config, loginProduct, token, fetchImpl = fetch, sleep = defaultSleep, onUsage } = {}) {
  const graph = isPlainObject(config) && isPlainObject(config.graph) ? config.graph : null;
  if (graph === null) throw new IgError('CONFIG', 'the Graph API client needs config.graph');
  if (typeof graph.version !== 'string' || !VERSION_PATTERN.test(graph.version)) {
    throw new IgError('CONFIG', 'graph.version must look like v26.0');
  }
  if (!Object.hasOwn(LOGIN_BASE, loginProduct)) {
    throw new IgError('CONFIG', 'loginProduct must be instagram or facebook');
  }
  const version = graph.version;
  const base = checkBase(graph[LOGIN_BASE[loginProduct]], `graph.${LOGIN_BASE[loginProduct]}`);
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new IgError('CONFIG', 'the token must be a non-empty string with no spaces');
  }
  if (typeof fetchImpl !== 'function') throw new IgError('CONFIG', 'fetchImpl must be a function');
  if (typeof sleep !== 'function') throw new IgError('CONFIG', 'sleep must be a function');
  if (onUsage !== undefined && typeof onUsage !== 'function') {
    throw new IgError('CONFIG', 'onUsage must be a function when it is given');
  }

  function buildUrl(path, query) {
    const simple = typeof path === 'string' && PATH_PATTERN.test(path);
    if (!simple || path.split('/').some((part) => DOTS_ONLY.test(part))) {
      throw new IgError('VALIDATION', 'the Graph API path must be relative, such as me or 17841400000000001/media');
    }
    const params = encodeParams(query, 'query');
    return `${base}/${version}/${path}${params === '' ? '' : `?${params}`}`;
  }

  // One request with the timeout and no redirects. A failure to send it is API_ERROR. details.preSend is true only when the
  // failure happened before the request reached Graph (see PRE_SEND_CODES); every other failure is false.
  async function fetchResponse(url, init) {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    } catch (err) {
      throw new IgError('API_ERROR', `Graph API request failed (${errorName(err)})`, { preSend: isPreSend(err) });
    }
  }

  function bodyTooLarge() {
    return new IgError('API_ERROR', `Graph API response is larger than ${MAX_BODY_BYTES} bytes`, { preSend: false });
  }

  // The body of a response, read up to MAX_BODY_BYTES. A longer body is refused as soon as the limit is passed, and the rest
  // of the stream is cancelled. A failure to read the body is API_ERROR.
  async function readBody(res) {
    const declared = res.headers.get('content-length');
    if (declared !== null && Number(declared) > MAX_BODY_BYTES) throw bodyTooLarge();
    try {
      if (res.body !== null && res.body !== undefined && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BODY_BYTES) {
            await reader.cancel().catch(() => {});
            throw bodyTooLarge();
          }
          chunks.push(value);
        }
        return Buffer.concat(chunks).toString('utf8');
      }
      const text = await res.text();
      if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw bodyTooLarge();
      return text;
    } catch (err) {
      if (err instanceof IgError) throw err;
      throw new IgError('API_ERROR', `Graph API response could not be read (${errorName(err)})`, { preSend: false });
    }
  }

  async function send({ method, url, payload, contentType, retryable }) {
    const headers = { Authorization: `Bearer ${token}` };
    if (contentType !== undefined) headers['Content-Type'] = contentType;
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetchResponse(url, { method, headers, body: payload });
      // The headers are read before the body, so this response's usage reaches onUsage even when its body fails.
      const usage = readUsage(res.headers);
      recordUsage(onUsage, usage);
      const text = await readBody(res);
      const outcome = classify(res, text);
      if (!outcome.ok) {
        const wait = retryWait(res, outcome.error, retryable, attempt);
        if (wait !== null) {
          await sleep(wait);
          continue;
        }
        throw markResponseError(outcome.error);
      }
      // A usage header that cannot be read does not discard a 2xx response that Graph accepted: its data is returned
      // with usage null. The marker has already gone to onUsage.
      return { data: outcome.data, usage: usage?.unreadable === undefined ? usage : null };
    }
  }

  return {
    // A GET is retried on 429 and 5xx unless the caller marks it noRetry. The token refresh is marked, because a refresh
    // rotates the token, so it must not be repeated by the client (P2-M7).
    async get(path, query, options) {
      if (options !== undefined && !isPlainObject(options)) throw new IgError('VALIDATION', 'the GET options must be an object');
      return send({ method: 'GET', url: buildUrl(path, query), retryable: options?.noRetry !== true });
    },
    async post(path, body = {}, options = {}) {
      if (!isPlainObject(body)) throw new IgError('VALIDATION', 'the POST body must be an object with form or json');
      if (!isPlainObject(options)) throw new IgError('VALIDATION', 'the POST options must be an object');
      if (options.retryPost !== undefined && typeof options.retryPost !== 'boolean') {
        throw new IgError('VALIDATION', 'retryPost must be true or false');
      }
      const url = buildUrl(path);
      return send({
        method: 'POST',
        url,
        ...encodeBody(body),
        retryable: options.retryPost === true,
      });
    },
    async del(path, query) {
      return send({ method: 'DELETE', url: buildUrl(path, query), retryable: false });
    },
  };
}
