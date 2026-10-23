// Paging for the Graph reads. A page is read by its cursor, and the next page is requested only when the response carries
// paging.next. The next link itself is never followed: it carries the access token in its query string, so a read passes
// only the cursor (paging.cursors.after), through the normal read path, with the Bearer header. The cursor is opaque: it
// is passed on unchanged and is never parsed.

import { IgError } from '../errors.js';

export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_MAX_ITEMS = 1000;
// The most pages and items that one read may take: the decided ceilings (M-2). A bound above a ceiling is clamped to it.
const MAX_PAGES_CEILING = 10;
const MAX_ITEMS_CEILING = 1000;
// The fixed texts that say why a read stopped early. They are the only reasons that a truncated read reports.
const PAGE_REASON = 'more pages exist beyond the page limit';
const ITEM_REASON = 'more items exist beyond the item limit';

// A bound must be a whole number of at least 1, and anything else is refused. A bound above its ceiling is clamped to the
// ceiling, not refused (M-2): a caller asking for 50 pages reads 10, and one asking for 5000 items reads 1000.
function clampBound(value, ceiling, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new IgError('VALIDATION', `${name} must be a whole number of at least 1`);
  }
  return Math.min(value, ceiling);
}

// The cursor of the next page, from a Graph response's paging object. The next page exists when paging.next is present,
// and it is then the cursor of paging.cursors.after. A next link with no cursor is refused, rather than read as the end.
export function nextCursorOf(body, what) {
  const paging = body?.paging;
  if (!paging || !paging.next) return null;
  const cursor = paging.cursors?.after;
  if (typeof cursor !== 'string' || cursor === '') {
    throw new IgError('API_ERROR', `Graph API ${what} has a next page but no cursor`);
  }
  return cursor;
}

// The query for one page: the same query, with after set to the cursor when there is one.
export function withCursor(query, cursor) {
  return cursor === undefined ? query : { ...query, after: cursor };
}

// Reads pages until there are no more, or until a bound is reached. fetchPage(after) returns { items, nextAfter }, where
// nextAfter is the cursor of the next page or null. The first call has after undefined.
//
// The result is { items, truncated, reason, nextAfter }. truncated is true only when more data exists beyond a bound:
// a next page after maxPages, or an item beyond maxItems. reason is then one of the fixed texts, and null otherwise.
// nextAfter is the cursor of the first page not read, when the read stopped between pages, and null otherwise.
// keyOf, when given, gives each item a key, and an item whose key was already seen is dropped without counting.
// maxPages and maxItems are clamped to the ceilings, 10 pages and 1000 items (M-2): a larger value is read as the ceiling.
export async function readAllPages({ fetchPage, maxPages = DEFAULT_MAX_PAGES, maxItems = DEFAULT_MAX_ITEMS, keyOf } = {}) {
  if (typeof fetchPage !== 'function') throw new IgError('VALIDATION', 'fetchPage must be a function');
  const pageLimit = clampBound(maxPages, MAX_PAGES_CEILING, 'maxPages');
  const itemLimit = clampBound(maxItems, MAX_ITEMS_CEILING, 'maxItems');
  if (keyOf !== undefined && typeof keyOf !== 'function') throw new IgError('VALIDATION', 'keyOf must be a function');
  const items = [];
  const seen = new Set();
  const result = (truncated, reason, nextAfter) => ({ items, truncated, reason, nextAfter });
  let after;
  for (let pageNo = 1; ; pageNo += 1) {
    const page = await fetchPage(after);
    if (page === null || typeof page !== 'object' || !Array.isArray(page.items)) {
      throw new IgError('API_ERROR', 'a page read has no items array');
    }
    const nextAfter = page.nextAfter ?? null;
    if (nextAfter !== null && (typeof nextAfter !== 'string' || nextAfter === '')) {
      throw new IgError('API_ERROR', 'a page read has a next cursor that is not a non-empty string');
    }
    for (const item of page.items) {
      const key = keyOf === undefined ? undefined : keyOf(item);
      if (key !== undefined && seen.has(key)) continue;
      if (items.length === itemLimit) return result(true, ITEM_REASON, null);
      items.push(item);
      if (key !== undefined) seen.add(key);
    }
    if (nextAfter === null) return result(false, null, null);
    if (pageNo >= pageLimit) return result(true, PAGE_REASON, nextAfter);
    if (items.length === itemLimit) return result(true, ITEM_REASON, nextAfter);
    after = nextAfter;
  }
}
