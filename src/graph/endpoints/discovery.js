// Reads about other accounts and hashtags: business discovery and the hashtag id lookup. Both are reads, and they are
// refused before any request when an input could change the request. The owner's own media lookups are in comments.js.

import { IgError } from '../../errors.js';
import { optionsOf } from './common.js';
import { checkId, responseId, responseObject } from './common.js';

export const USERNAME_PATTERN = /^[A-Za-z0-9._]{1,30}$/;
// Plain, lowercase field names, comma-joined. Nested or grouped fields are refused, so the value cannot change the
// business_discovery expression it is put into.
export const FIELDS_PATTERN = /^[a-z][a-z0-9_]*(?:,[a-z][a-z0-9_]*)*$/;
// A hashtag name without the leading #. The length limit is a local choice, not a Graph rule.
const HASHTAG_PATTERN = /^[\p{L}\p{N}_]{1,100}$/u;

const NESTED_REASON = 'more business discovery items exist beyond the first page';

// A nested edge that Graph returns with its paging (such as media) carries a next link, which holds the access token. The
// link is removed from the result. A next page sets truncated: the edge is not followed here, and the caller is told so.
// A top-level paging key is removed too (M-1), so no next link is returned at any depth. It is not a list, so it does not
// set truncated.
function withoutNestedPaging(business) {
  const body = {};
  let truncated = false;
  for (const [key, value] of Object.entries(business)) {
    if (key === 'paging') continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'paging')) {
      const { paging, ...edge } = value;
      if (paging?.next) truncated = true;
      body[key] = edge;
    } else {
      body[key] = value;
    }
  }
  return { body, truncated };
}

// The public profile of another business or creator account, with the requested fields. The result also carries
// truncated and reason, which say whether a nested edge has more items than the first page.
export async function businessDiscovery(client, options) {
  const { igUserId, username, fields } = optionsOf(options, 'businessDiscovery');
  checkId(igUserId, 'igUserId');
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    throw new IgError('VALIDATION', 'username must be 1 to 30 letters, digits, periods or underscores');
  }
  if (typeof fields !== 'string' || !FIELDS_PATTERN.test(fields)) {
    throw new IgError('VALIDATION', 'fields must be comma-joined lowercase field names');
  }
  const expression = `business_discovery.username(${username}){${fields}}`;
  const { data } = await client.get(igUserId, { fields: expression });
  const business = responseObject(responseObject(data, 'business discovery').business_discovery, 'business discovery');
  // Each requested field that Graph did not return is listed, so a missing field is visible to the caller. Nothing is
  // thrown for it: a field the account does not expose is a normal answer, and the caller decides what it means.
  const missingFields = fields.split(',').filter((field) => !Object.hasOwn(business, field));
  const { body, truncated } = withoutNestedPaging(business);
  return { ...body, missingFields, truncated, reason: truncated ? NESTED_REASON : null };
}

// The id of a hashtag, from its name. Graph answers with { data: [{ id }] } or with { id }. Any other shape, and a
// list that is not exactly one row, is refused, so a wrong or missing hashtag never passes as a result.
export async function hashtagSearch(client, options) {
  const { igUserId, q } = optionsOf(options, 'hashtagSearch');
  checkId(igUserId, 'igUserId');
  if (typeof q !== 'string' || !HASHTAG_PATTERN.test(q)) {
    throw new IgError('VALIDATION', 'q must be 1 to 100 letters, digits or underscores, without the #');
  }
  const { data } = await client.get('ig_hashtag_search', { user_id: igUserId, q });
  const body = responseObject(data, 'hashtag search');
  if (Array.isArray(body.data)) {
    if (body.data.length !== 1) {
      throw new IgError('API_ERROR', 'Graph API hashtag search did not return exactly one hashtag');
    }
    return { hashtagId: responseId(body.data[0], 'hashtag search') };
  }
  return { hashtagId: responseId(body, 'hashtag search') };
}
