import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRealDate } from '../src/calendar.js';

// Checked directly, so the lower and upper bounds are tested without Date.parse, which refuses some of these forms on its
// own on one engine and not on another.

test('isRealDate refuses a day of 00 and a day past the end of its month', () => {
  assert.equal(isRealDate(2026, 2, 0), false);
  assert.equal(isRealDate(2026, 1, 32), false);
  assert.equal(isRealDate(2026, 4, 31), false);
  assert.equal(isRealDate(2026, 9, 31), false);
  assert.equal(isRealDate(2026, 1, 31), true);
  assert.equal(isRealDate(2026, 4, 30), true);
});

test('isRealDate refuses a month outside 1 to 12', () => {
  assert.equal(isRealDate(2026, 0, 15), false);
  assert.equal(isRealDate(2026, 13, 15), false);
  assert.equal(isRealDate(2026, 1, 1), true);
  assert.equal(isRealDate(2026, 12, 31), true);
});

test('isRealDate allows 29 February only in a leap year', () => {
  assert.equal(isRealDate(2026, 2, 29), false);
  assert.equal(isRealDate(2026, 2, 28), true);
  assert.equal(isRealDate(2028, 2, 29), true);
  assert.equal(isRealDate(2000, 2, 29), true);
  assert.equal(isRealDate(1900, 2, 29), false);
});

test('isRealDate refuses values that are not whole numbers', () => {
  assert.equal(isRealDate(2026, 2, Number.NaN), false);
  assert.equal(isRealDate(2026, 2.5, 1), false);
  assert.equal(isRealDate(2026, 2, -1), false);
});
