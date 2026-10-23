// The calendar check shared by the time parsers (src/events.js and src/graph/endpoints/messaging.js). Date.parse rolls an
// impossible day forward (2026-02-30 becomes 2026-03-02), so a date is checked before it is parsed. The month must be 1 to
// 12, and the day must be 1 to the length of that month. 29 February counts only in a leap year. Year 0 to 99 maps to
// 1900 to 1999 in Date.UTC, so 0000-02-29 is refused; that refusal is the one accepted for Task 8.

// True when year, month and day name a date that exists.
export function isRealDate(year, month, day) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
