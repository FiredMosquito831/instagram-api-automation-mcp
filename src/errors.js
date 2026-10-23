// Error kinds, the mapping of Graph API errors to those kinds, and the busy result.
// A busy result is a normal result, not an error.

import { redact } from './redact.js';
import { rankOf } from './stops.js';

export const ERROR_KINDS = Object.freeze([
  'CONFIG',
  'VALIDATION',
  'OWNER_MISMATCH',
  'STOPPED',
  'CONFIRMATION_REQUIRED',
  'CAP_EXCEEDED',
  'ROUTE_DISABLED',
  'NOT_SUPPORTED',
  'WINDOW_CLOSED',
  'AUTH_EXPIRED',
  'RATE_LIMITED',
  'ACTION_BLOCKED',
  'CHECKPOINT',
  'API_ERROR',
  'UNOFFICIAL_ADAPTER_ERROR',
]);

const KINDS = new Set(ERROR_KINDS);

// The account stops: the error kinds that Graph sets as a persisted stop, through the guard (src/guard.js). The poller uses the
// same set to tell a stop from an error (src/poller.js). STATE_CORRUPT and STATE_LOST are not here: they come from the startup
// checks, not from an error.
export const ACCOUNT_STOP_KINDS = new Set(['AUTH_EXPIRED', 'ACTION_BLOCKED', 'CHECKPOINT', 'RATE_LIMITED']);
// The kinds that the HTTP layer raises itself (src/http.js). They are not IgError kinds. INTERNAL is also the kind of a failed
// MCP tool call (src/mcp.js).
export const HTTP_ERROR_KINDS = Object.freeze([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL',
]);

// An error with a known kind. Its message and details are redacted, so it never carries a secret.
export class IgError extends Error {
  constructor(kind, message, details) {
    if (!KINDS.has(kind)) throw new TypeError(`unknown error kind: ${String(kind)}`);
    super(redact(String(message ?? kind)));
    this.name = 'IgError';
    this.kind = kind;
    this.details = redact(details ?? {});
  }
}

// Graph codes that mean the account is rate limited. Code 80002 always counts, because its subcode is unknown.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);
// Message text for stop conditions that carry no code in this mapping. Global Constraints names both.
const FEEDBACK_REQUIRED = /feedback[\s_-]*required/i;
const CHECKPOINT_TEXT = /checkpoint|challenge|two[\s_-]*factor/i;

// Graph codes and HTTP statuses arrive as numbers or as numeric strings. A string is trimmed first, so that
// " 190" is read as 190 and a stop is not missed. Anything else gives null.
function graphCode(value) {
  if (Number.isInteger(value)) return value;
  const text = typeof value === 'string' ? value.trim() : '';
  return /^\d+$/.test(text) ? Number(text) : null;
}

function graphErrorObject(body) {
  const error = body && typeof body === 'object' ? body.error : undefined;
  return error && typeof error === 'object' ? error : {};
}

// Maps a failed Graph API response to an IgError (O-1, review M-4). Each signal that matches is a candidate: the code 190
// (AUTH_EXPIRED); the code 368 (ACTION_BLOCKED); the HTTP status 429 and the codes 4, 17, 32, 613 and 80002 (RATE_LIMITED); the
// feedback phrase (ACTION_BLOCKED); the checkpoint, challenge and two-factor phrases (CHECKPOINT). The most severe candidate
// wins, ranked by rankOf in src/stops.js, the table the guard uses too. On a tie the earlier candidate
// wins, so a structured signal beats a text signal of the same rank. Any other error is API_ERROR. The detail records the signal
// that decided: 'code' for a structured signal (a Graph code or the HTTP status), 'text' for a phrase, and 'none' when nothing
// matched. The detail never holds message text. The subcode is recorded and not mapped, because its values are not verified.
export function mapGraphError({ status, body } = {}) {
  const error = graphErrorObject(body);
  const httpStatus = graphCode(status);
  const code = graphCode(error.code);
  const text = typeof error.message === 'string' ? error.message : '';
  // The stop phrases are read from the message and from Graph's user-facing fields, which can carry the same phrases alone.
  // The live phase confirms the field names. The message text itself is kept as the error's message.
  const userText = [error.error_user_title, error.error_user_msg].filter((value) => typeof value === 'string').join(' ');
  const phrases = `${text} ${userText}`;
  // The candidates are listed in tie order: the code 190 first, then the code 368, the rate limit, the feedback phrase and the
  // checkpoint phrase. A candidate replaces the chosen one only when it ranks higher, so a tie keeps the earlier candidate.
  const candidates = [];
  if (code === 190) candidates.push({ kind: 'AUTH_EXPIRED', signal: 'code' });
  if (code === 368) candidates.push({ kind: 'ACTION_BLOCKED', signal: 'code' });
  if (httpStatus === 429 || RATE_LIMIT_CODES.has(code)) candidates.push({ kind: 'RATE_LIMITED', signal: 'code' });
  if (FEEDBACK_REQUIRED.test(phrases)) candidates.push({ kind: 'ACTION_BLOCKED', signal: 'text' });
  if (CHECKPOINT_TEXT.test(phrases)) candidates.push({ kind: 'CHECKPOINT', signal: 'text' });
  let chosen = { kind: 'API_ERROR', signal: 'none' };
  for (const candidate of candidates) {
    if (rankOf(candidate.kind) > rankOf(chosen.kind)) chosen = candidate;
  }
  const { kind, signal } = chosen;
  const shown = text !== '' ? text : userText;
  const message = shown !== '' ? shown : `Graph API request failed with HTTP ${httpStatus ?? 'unknown'}`;
  return new IgError(kind, message, {
    status: httpStatus,
    code,
    subcode: graphCode(error.error_subcode),
    signal,
  });
}

// A spacing, cap or usage limit returns this instead of an error. Nothing waits in a queue to run later.
// A fractional wait is rounded up, and a negative one is taken as 0.
export function busyResult({ reason, retryAfterMs } = {}) {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new TypeError('a busy result needs a reason');
  }
  if (typeof retryAfterMs !== 'number' || !Number.isFinite(retryAfterMs)) {
    throw new TypeError('a busy result needs retryAfterMs as a finite number of milliseconds');
  }
  return { busy: true, reason: redact(reason), retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)) };
}
