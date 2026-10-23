import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAX_ITEMS, DEFAULT_MAX_PAGES, nextCursorOf, readAllPages, withCursor } from '../src/graph/paging.js';

const PAGE_REASON = 'more pages exist beyond the page limit';
const ITEM_REASON = 'more items exist beyond the item limit';

// A fake fetchPage. It answers each call from a list of pages, in order, and records the cursor each call was given.
// A call past the end of the list fails the test, so an extra page request is visible.
function fakePages(pages) {
  const cursors = [];
  let call = 0;
  const fetchPage = async (after) => {
    cursors.push(after);
    if (call >= pages.length) throw new Error(`unexpected page request ${call + 1}`);
    call += 1;
    return pages[call - 1];
  };
  return { fetchPage, cursors };
}

test('readAllPages follows paging.next with the after cursor, and collects every page', async () => {
  const { fetchPage, cursors } = fakePages([
    { items: ['a', 'b'], nextAfter: 'c1' },
    { items: ['c'], nextAfter: 'c2' },
    { items: ['d'], nextAfter: null },
  ]);
  const result = await readAllPages({ fetchPage });
  assert.deepEqual(cursors, [undefined, 'c1', 'c2']);
  assert.deepEqual(result, { items: ['a', 'b', 'c', 'd'], truncated: false, reason: null, nextAfter: null });
});

test('maxPages stops the read and reports truncated, with the cursor of the page that was not read', async () => {
  const { fetchPage, cursors } = fakePages([
    { items: ['a'], nextAfter: 'c1' },
    { items: ['b'], nextAfter: 'c2' },
    { items: ['c'], nextAfter: null },
  ]);
  const result = await readAllPages({ fetchPage, maxPages: 2 });
  assert.equal(cursors.length, 2, 'no third page is requested');
  assert.deepEqual(result, { items: ['a', 'b'], truncated: true, reason: PAGE_REASON, nextAfter: 'c2' });
});

test('a full page with no paging.next is not truncated', async () => {
  const { fetchPage, cursors } = fakePages([{ items: ['a', 'b'], nextAfter: null }]);
  const result = await readAllPages({ fetchPage, maxItems: 2 });
  assert.equal(cursors.length, 1);
  assert.deepEqual(result, { items: ['a', 'b'], truncated: false, reason: null, nextAfter: null });
});

test('a short page with a paging.next is truncated, because truncation follows the next link, not the page length', async () => {
  const { fetchPage } = fakePages([{ items: ['a'], nextAfter: 'c1' }]);
  const result = await readAllPages({ fetchPage, maxPages: 1 });
  assert.deepEqual(result, { items: ['a'], truncated: true, reason: PAGE_REASON, nextAfter: 'c1' });
});

test('maxItems stops the read and reports truncated when items remain beyond it inside a page', async () => {
  // The page holds three items, so the third is beyond a bound of two. The read stops there, and no cursor is given,
  // because the cut falls inside a page.
  const { fetchPage, cursors } = fakePages([
    { items: ['a', 'b', 'c'], nextAfter: 'c1' },
    { items: ['d'], nextAfter: null },
  ]);
  const result = await readAllPages({ fetchPage, maxItems: 2 });
  assert.equal(cursors.length, 1);
  assert.deepEqual(result, { items: ['a', 'b'], truncated: true, reason: ITEM_REASON, nextAfter: null });
});

test('maxItems reached exactly at the end of a page with a next page is truncated, and gives the next cursor', async () => {
  const { fetchPage, cursors } = fakePages([
    { items: ['a', 'b'], nextAfter: 'c1' },
    { items: ['c'], nextAfter: null },
  ]);
  const result = await readAllPages({ fetchPage, maxItems: 2 });
  assert.equal(cursors.length, 1, 'the next page is not requested once the item limit is met');
  assert.deepEqual(result, { items: ['a', 'b'], truncated: true, reason: ITEM_REASON, nextAfter: 'c1' });
});

test('keyOf drops an item already seen on an earlier page, and a duplicate does not count toward maxItems', async () => {
  const { fetchPage } = fakePages([
    { items: [{ id: '1' }, { id: '2' }], nextAfter: 'c1' },
    { items: [{ id: '2' }, { id: '3' }], nextAfter: null },
  ]);
  const result = await readAllPages({ fetchPage, keyOf: (item) => item.id, maxItems: 3 });
  assert.deepEqual(result.items, [{ id: '1' }, { id: '2' }, { id: '3' }]);
  assert.equal(result.truncated, false);
});

// Changed in the P3 review round (M-2): a bound above its ceiling is clamped, not refused. Old assertion (removed): 101 pages
// and 10001 items were refused with VALIDATION. See the clamp test below.
test('readAllPages refuses bad bounds, a bad fetchPage and a bad page shape, and requests nothing for the bounds', async () => {
  const { fetchPage, cursors } = fakePages([{ items: [], nextAfter: null }]);
  for (const maxPages of [0, 1.5, '2', null]) {
    await assert.rejects(readAllPages({ fetchPage, maxPages }), { kind: 'VALIDATION' }, `maxPages ${String(maxPages)}`);
  }
  for (const maxItems of [0, 2.5, '5', null]) {
    await assert.rejects(readAllPages({ fetchPage, maxItems }), { kind: 'VALIDATION' }, `maxItems ${String(maxItems)}`);
  }
  assert.equal(cursors.length, 0);
  await assert.rejects(readAllPages({ fetchPage: 'nope' }), { kind: 'VALIDATION' });
  await assert.rejects(readAllPages({ fetchPage: async () => ({ items: 'x', nextAfter: null }) }), { kind: 'API_ERROR' });
  await assert.rejects(readAllPages({ fetchPage: async () => ({ items: [], nextAfter: '' }) }), { kind: 'API_ERROR' });
  await assert.rejects(readAllPages({ fetchPage: async () => ({ items: [], nextAfter: 7 }) }), { kind: 'API_ERROR' });
});

// M-2 (P3 review): a caller asking for more than the decided ceilings gets the ceilings, 10 pages and 1000 items.
test('M-2 a caller asking for 50 pages gets 10, and a caller asking for 5000 items gets 1000', async () => {
  const many = fakePages(Array.from({ length: 50 }, () => ({ items: ['a'], nextAfter: 'c' })));
  const pages = await readAllPages({ fetchPage: many.fetchPage, maxPages: 50 });
  assert.equal(many.cursors.length, 10, 'ten pages are requested, not fifty');
  assert.deepEqual([pages.items.length, pages.truncated, pages.reason], [10, true, PAGE_REASON]);
  const big = fakePages([{ items: Array.from({ length: 5000 }, (_, i) => i), nextAfter: null }]);
  const items = await readAllPages({ fetchPage: big.fetchPage, maxItems: 5000 });
  assert.equal(items.items.length, 1000);
  assert.deepEqual([items.truncated, items.reason], [true, ITEM_REASON]);
});

test('the defaults are 10 pages and 1000 items', () => {
  assert.equal(DEFAULT_MAX_PAGES, 10);
  assert.equal(DEFAULT_MAX_ITEMS, 1000);
});

test('nextCursorOf reads the cursor only when paging.next is present, and refuses a next link with no cursor', () => {
  assert.equal(nextCursorOf({}, 'list'), null);
  assert.equal(nextCursorOf({ paging: { cursors: { after: 'c9' } } }, 'list'), null, 'no next link, so no further page');
  const next = 'https://graph.instagram.com/v26.0/me/media?after=c9&access_token=SECRET';
  assert.equal(nextCursorOf({ paging: { next, cursors: { after: 'c9' } } }, 'list'), 'c9');
  assert.throws(() => nextCursorOf({ paging: { next } }, 'list'), { kind: 'API_ERROR' });
  assert.throws(() => nextCursorOf({ paging: { next, cursors: { after: '' } } }, 'list'), { kind: 'API_ERROR' });
});

test('withCursor adds after only when a cursor is given', () => {
  assert.deepEqual(withCursor({ limit: 5 }, undefined), { limit: 5 });
  assert.deepEqual(withCursor({ limit: 5 }, 'c1'), { limit: 5, after: 'c1' });
});
