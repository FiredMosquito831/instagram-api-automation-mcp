// Comments on the owner's media: the list, reply, hide and delete, plus the two lookups that the owner-media check
// needs. Every write is a plain client call with no retryPost, so a failed write is reported to the caller and is
// never repeated here. The service, not this module, decides whether a media id belongs to the owner.

import { IgError } from '../../errors.js';
import { nextCursorOf, readAllPages, withCursor } from '../paging.js';
import { optionsOf } from './common.js';
import { checkId, orNull, responseConfirmed, responseId, responseObject } from './common.js';

const COMMENT_FIELDS = 'id,text,timestamp,username,hidden';
// The default page is the largest that the endpoint allows (P3 fix round, ruling 2). Old value (removed): 25.
const DEFAULT_COMMENT_LIMIT = 100;
const MAX_LIMIT = 100;

function checkLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new IgError('VALIDATION', `limit must be a whole number from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}

function normaliseComment(raw) {
  const comment = responseObject(raw, 'comment');
  return {
    id: responseId(comment, 'comment'),
    text: orNull(comment.text),
    timestamp: orNull(comment.timestamp),
    username: orNull(comment.username),
    hidden: orNull(comment.hidden),
  };
}

// The comments on one media object, read page by page in pages of limit, up to maxPages pages and maxItems comments.
// Paging follows paging.next only (see paging.js). The result is { items, truncated, reason, nextAfter }.
export async function commentsList(client, options) {
  const { mediaId, limit = DEFAULT_COMMENT_LIMIT, maxPages, maxItems } = optionsOf(options, 'commentsList');
  checkId(mediaId, 'mediaId');
  checkLimit(limit);
  const base = { fields: COMMENT_FIELDS, limit };
  return readAllPages({
    fetchPage: async (cursor) => {
      const { data } = await client.get(`${mediaId}/comments`, withCursor(base, cursor));
      const body = responseObject(data, 'comments list');
      if (!Array.isArray(body.data)) throw new IgError('API_ERROR', 'Graph API comments list response has no data array');
      return { items: body.data.map(normaliseComment), nextAfter: nextCursorOf(body, 'comments list') };
    },
    keyOf: (comment) => comment.id,
    maxPages,
    maxItems,
  });
}

// A reply to a comment. Blank text is refused before any request. Graph states no length limit for a reply.
export async function commentReply(client, options) {
  const { commentId, text } = optionsOf(options, 'commentReply');
  checkId(commentId, 'commentId');
  if (typeof text !== 'string' || text.trim() === '') {
    throw new IgError('VALIDATION', 'text must be a non-empty string');
  }
  const { data } = await client.post(`${commentId}/replies`, { form: { message: text } });
  return { id: responseId(data, 'comment reply') };
}

// Hides or shows a comment. Graph takes hide as the text 'true' or 'false', so the boolean is sent as that text.
export async function commentHide(client, options) {
  const { commentId, hide } = optionsOf(options, 'commentHide');
  checkId(commentId, 'commentId');
  if (hide !== true && hide !== false) throw new IgError('VALIDATION', 'hide must be true or false');
  const { data } = await client.post(commentId, { form: { hide: hide ? 'true' : 'false' } });
  responseConfirmed(data, 'comment hide');
  return { id: commentId, hidden: hide };
}

export async function commentDelete(client, options) {
  const { commentId } = optionsOf(options, 'commentDelete');
  checkId(commentId, 'commentId');
  const { data } = await client.del(commentId);
  responseConfirmed(data, 'comment deletion');
  return { id: commentId, deleted: true };
}

// The media that a comment belongs to, as the id string. A comment with no parent media id is API_ERROR.
export async function commentParentMedia(client, options) {
  const { commentId } = optionsOf(options, 'commentParentMedia');
  checkId(commentId, 'commentId');
  const { data } = await client.get(commentId, { fields: 'media{id}' });
  return responseId(responseObject(data, 'comment').media, 'comment parent media');
}

// The time a comment was written, from its timestamp field, as the text Graph gives. A missing or blank time is API_ERROR,
// the same rule as the other text fields, so no caller reads a guessed time. The private-reply window uses it.
export async function commentTimestamp(client, options) {
  const { commentId } = optionsOf(options, 'commentTimestamp');
  checkId(commentId, 'commentId');
  const { data } = await client.get(commentId, { fields: 'timestamp' });
  const timestamp = responseObject(data, 'comment').timestamp;
  if (typeof timestamp !== 'string' || timestamp.trim() === '') {
    throw new IgError('API_ERROR', 'Graph API comment response has no timestamp');
  }
  return timestamp;
}

// The ids of the owner's media, read page by page in pages of limit, up to maxPages pages and maxItems ids. The result is
// { ids: Set, truncated, reason }. When the list is truncated, a media id beyond the read is not in the set, so the caller
// refuses it; truncated says why. A media id that is not in the set is refused by the caller, so this fails closed.
export async function ownedMediaIds(client, options) {
  const { limit = MAX_LIMIT, maxPages, maxItems } = optionsOf(options, 'ownedMediaIds');
  checkLimit(limit);
  const base = { fields: 'id', limit };
  const page = await readAllPages({
    fetchPage: async (cursor) => {
      const { data } = await client.get('me/media', withCursor(base, cursor));
      const body = responseObject(data, 'owned media list');
      if (!Array.isArray(body.data)) throw new IgError('API_ERROR', 'Graph API owned media list response has no data array');
      return {
        items: body.data.map((row) => responseId(row, 'owned media')),
        nextAfter: nextCursorOf(body, 'owned media list'),
      };
    },
    keyOf: (id) => id,
    maxPages,
    maxItems,
  });
  return { ids: new Set(page.items), truncated: page.truncated, reason: page.reason };
}
