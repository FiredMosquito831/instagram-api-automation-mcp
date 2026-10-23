// Times. One reader turns a Graph time into epoch milliseconds. The webhook receiver and the messaging endpoint both use it,
// so that a time means the same instant on both paths. The accepted forms are an ISO 8601 string with a zone (Z, +hh:mm or
// +hhmm), a Unix number in seconds (below 1e12) or in milliseconds (at or above 1e12), and a numeric string of either. A zero
// or negative number, a value past the year 9999, and a day that is not in its month are refused. Nothing is guessed.

import { isRealDate } from '../calendar.js';

// The latest instant that a stored time may carry: 9999-12-31T23:59:59.999Z. A later time has no four-digit year.
export const MAX_EVENT_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
// A received time may be this far ahead of the clock, to allow for clock skew between this host and the sender. The poller,
// the event log and the webhook receiver use the same allowance (A-26).
export const MAX_FUTURE_MS = 5 * 60 * 1000;
// An ISO 8601 time with a zone. The first group is the date and the time; the second is the zone (Z, +hh:mm or +hhmm).
export const ISO_WITH_ZONE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)(Z|[+-]\d{2}:?\d{2})$/;
const NUMERIC = /^\d+(?:\.\d+)?$/;
// A Unix number below this is in seconds, and one at or above it is in milliseconds. 1e12 seconds is far past year 9999.
const UNIX_MS_THRESHOLD = 1e12;

// A Unix number as epoch milliseconds, or null when it is not a usable time.
function unixMsOf(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const ms = value < UNIX_MS_THRESHOLD ? value * 1000 : value;
  return ms <= MAX_EVENT_MS ? ms : null;
}

// An ISO 8601 string with a zone as epoch milliseconds, or null. The calendar date must exist, because Date.parse would roll
// 2026-09-31 forward to 1 October.
function isoZoneMsOf(value) {
  const match = ISO_WITH_ZONE.exec(value);
  if (match === null) return null;
  const [year, month, day] = match[1].slice(0, 10).split('-').map(Number);
  if (!isRealDate(year, month, day)) return null;
  const zone = match[2] === 'Z' || match[2].includes(':') ? match[2] : `${match[2].slice(0, 3)}:${match[2].slice(3)}`;
  const parsed = Date.parse(`${match[1]}${zone}`);
  return Number.isNaN(parsed) || parsed > MAX_EVENT_MS ? null : parsed;
}

// A Graph time in any accepted form, as epoch milliseconds, or null when it is not a usable time.
export function graphTimeMs(value) {
  if (typeof value === 'number') return unixMsOf(value);
  if (typeof value === 'string' && NUMERIC.test(value)) return unixMsOf(Number(value));
  if (typeof value === 'string') return isoZoneMsOf(value);
  return null;
}

// The ISO 8601 string in UTC with milliseconds for epoch milliseconds, such as 2026-10-22T10:00:00.000Z.
export const isoOf = (ms) => new Date(ms).toISOString();

// A Graph time as that ISO string, or null when it is not a usable time.
export function graphTimeIsoOrNull(value) {
  const ms = graphTimeMs(value);
  return ms === null ? null : isoOf(ms);
}
