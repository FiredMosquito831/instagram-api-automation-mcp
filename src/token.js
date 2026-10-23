// Token lifecycle: the age of a token, when it may be refreshed, the refresh call and the hourly check timer. Times are
// epoch milliseconds, or the text that Date.prototype.toISOString gives (for example 2026-10-01T00:00:00.000Z). Any other
// time is refused. No function here writes a file, and every token received is registered before it is returned.

import { IgError } from './errors.js';
import { optionsOf } from './graph/endpoints/common.js';
import { registerSecret } from './redact.js';
import { MAX_TIMER_MS } from './util/clock.js';

// MAX_TIMER_MS is the longest timer that Node runs (src/util/clock.js). It stays exported from this module.
export { MAX_TIMER_MS };

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const MIN_REFRESH_AGE_MS = DAY_MS;
const REFRESH_SCOPE = 'instagram_business_basic';
export const DEFAULT_CHECK_INTERVAL_MS = HOUR_MS;

const ISO_MS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// A token from a refresh response: a non-empty run of characters with no whitespace, as the Graph client requires.
const TOKEN_PATTERN = /^\S+$/;

// Reads a time as epoch milliseconds, or null when it is not in an accepted form. A string must be exactly what
// toISOString gives, so an impossible date such as 2026-09-31 is refused and not moved to a later day.
function parseTime(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && ISO_MS_PATTERN.test(value)) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && new Date(ms).toISOString() === value) return ms;
  }
  return null;
}

// Reads a time, and refuses one that is not in an accepted form.
function toEpochMs(value, name) {
  const ms = parseTime(value);
  if (ms === null) {
    throw new IgError('VALIDATION', `${name} must be epoch milliseconds or an ISO time with milliseconds and Z`);
  }
  return ms;
}

// The age in milliseconds of a token obtained at obtained, measured at current. A time after current is refused.
function ageMs(obtained, current) {
  if (obtained > current) throw new IgError('VALIDATION', 'obtainedAt is later than now');
  return current - obtained;
}

// The age of a token in hours.
export function tokenAgeHours(options) {
  const { obtainedAt, now } = optionsOf(options, 'tokenAgeHours');
  return ageMs(toEpochMs(obtainedAt, 'obtainedAt'), toEpochMs(now, 'now')) / HOUR_MS;
}

// True only when the token is at least 24 hours old, has not expired, and its scopes include instagram_business_basic.
// Expiry is exact: a token is expired at expiresAt, not after it. A time that cannot be read gives false, and never true,
// so an unreadable time cannot start a refresh. A scopes value that is not a list of strings is still refused.
export function canRefresh(options) {
  const { obtainedAt, expiresAt, now, scopes } = optionsOf(options, 'canRefresh');
  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
    throw new IgError('VALIDATION', 'scopes must be a list of scope names');
  }
  const obtained = parseTime(obtainedAt);
  const expires = parseTime(expiresAt);
  const current = parseTime(now);
  if (obtained === null || expires === null || current === null) return false;
  const age = ageMs(obtained, current);
  return age >= MIN_REFRESH_AGE_MS && current < expires && scopes.includes(REFRESH_SCOPE);
}

// How long a token has left, and a warning when fewer than 7 days remain or the token has expired (O-6). expiresAt is read
// like the other times here, so an unreadable time is VALIDATION. daysLeft is whole days, rounded down, and it is negative
// once the token has expired.
const EXPIRY_WARNING_MS = 7 * DAY_MS;
export function expiryStatus(options) {
  const { expiresAt, now } = optionsOf(options, 'expiryStatus');
  const leftMs = toEpochMs(expiresAt, 'expiresAt') - toEpochMs(now, 'now');
  const daysLeft = Math.floor(leftMs / DAY_MS);
  let warning = null;
  if (leftMs <= 0) warning = 'the token has expired; refresh it or log in again';
  else if (leftMs < EXPIRY_WARNING_MS) warning = `the token expires in ${daysLeft} days; refresh it before then`;
  return { expiresAt, daysLeft, warning };
}

// Refreshes the token with a GET to refresh_access_token. The token goes only in the Authorization header, which the
// client adds, so the query holds only the grant type. Returns { token, expiresInSeconds }. The caller stores the token
// with an expiry 60 days out. The new token is registered before it is returned. loginProduct is the product of the
// client, which must be instagram: a Facebook client would send the Instagram token to the Facebook host, so it is refused
// before any request.
export async function refreshToken(options) {
  const { client, loginProduct } = optionsOf(options, 'refreshToken');
  if (client === null || typeof client !== 'object' || typeof client.get !== 'function') {
    throw new IgError('VALIDATION', 'refreshToken needs a Graph client with a get method');
  }
  if (loginProduct !== 'instagram') {
    throw new IgError('CONFIG', 'refreshToken needs an Instagram Login client; the token is not sent to another product');
  }
  // The refresh rotates the token, so it is never retried by the client (P2-M7).
  const { data } = await client.get('refresh_access_token', { grant_type: 'ig_refresh_token' }, { noRetry: true });
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new IgError('API_ERROR', 'Graph API refresh response is not an object');
  }
  const token = data.access_token;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new IgError('API_ERROR', 'Graph API refresh response has no usable access token');
  }
  try {
    registerSecret(token);
  } catch {
    throw new IgError('API_ERROR', 'Graph API refresh response token cannot be registered for masking');
  }
  const expiresInSeconds = data.expires_in;
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new IgError('API_ERROR', 'Graph API refresh response has no usable expires_in');
  }
  return { token, expiresInSeconds };
}

// Runs check every interval and returns a stop function. An interval must be a whole number of milliseconds from 1 to
// MAX_TIMER_MS, and a longer one is refused, not clamped. check should handle its own failures.
export function scheduleTokenChecks(options) {
  const {
    check,
    intervalMs = DEFAULT_CHECK_INTERVAL_MS,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
  } = optionsOf(options, 'scheduleTokenChecks');
  if (typeof check !== 'function') throw new IgError('VALIDATION', 'scheduleTokenChecks needs check as a function');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > MAX_TIMER_MS) {
    throw new IgError('VALIDATION', `intervalMs must be a whole number from 1 to ${MAX_TIMER_MS}`);
  }
  if (typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') {
    throw new IgError('VALIDATION', 'the interval functions must be functions');
  }
  const handle = setIntervalImpl(() => {
    check();
  }, intervalMs);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearIntervalImpl(handle);
  };
}
