// Messaging: conversation reads, the two sends (a direct message and a private reply), and the two windows that gate
// the sends. Both sends are writes, so they are plain client calls with no retryPost: a send that may have gone out is
// reported to the caller and never sent again here. The caller holds the inbound times, so the 24-hour and 7-day
// windows are checked by the caller. sendMessage and privateReply cannot check them, because they receive no times.

import { isRealDate } from '../../calendar.js';
import { IgError } from '../../errors.js';
import { graphTimeIsoOrNull, ISO_WITH_ZONE } from '../../util/time.js';
import { nextCursorOf, readAllPages, withCursor } from '../paging.js';
import { optionsOf } from './common.js';
import { checkId, isDotsOnly, responseObject } from './common.js';

const MAX_TEXT_BYTES = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DEFAULT_CONVERSATION_LIMIT = 20;
const MAX_CONVERSATION_LIMIT = 100;
const DEFAULT_MESSAGE_LIMIT = 20;
const MAX_MESSAGE_LIMIT = 20;
// The messages read for one thread by readThread: a default of 1000, and no call may ask for more.
const DEFAULT_THREAD_ITEMS = 1000;
const MAX_THREAD_ITEMS = 1000;
// The messages edge: the page size is the largest that the endpoint allows, and the message fields come in the page (P3).
const MESSAGE_PAGE = 100;
const MESSAGE_FIELDS = 'id,created_time,from,to,message';
// Conversation and message ids are used as path segments, so only the characters that the client accepts in a path are
// allowed. A response id that does not match is API_ERROR.
const REF_PATTERN = /^[A-Za-z0-9_.-]+$/;

function checkLimit(limit, max, name) {
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new IgError('VALIDATION', `${name} must be a whole number from 1 to ${max}`);
  }
  return limit;
}

function checkRef(value, name) {
  if (typeof value !== 'string' || !REF_PATTERN.test(value) || isDotsOnly(value)) {
    throw new IgError('VALIDATION', `${name} must be a Graph id made of letters, digits, '_', '.' or '-', not only dots`);
  }
  return value;
}

// A message text is a string that is not blank and is at most 1000 UTF-8 bytes. The length is in bytes, not characters,
// so a multi-byte character counts for its full size. The text is checked here, before any request.
function checkText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new IgError('VALIDATION', 'text must be a non-empty string');
  }
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_TEXT_BYTES) {
    throw new IgError('VALIDATION', `text is ${bytes} bytes; the limit is ${MAX_TEXT_BYTES}`);
  }
  return text;
}

// An id from a response that is used as a path segment later. A missing or unusable id is API_ERROR.
function refId(row, what) {
  const id = responseObject(row, what).id;
  if (typeof id !== 'string' || !REF_PATTERN.test(id) || isDotsOnly(id)) {
    throw new IgError('API_ERROR', `Graph API ${what} response has no usable id`);
  }
  return id;
}

function malformedTime(what) {
  return new IgError('API_ERROR', `Graph API ${what} is not a time this module can read`);
}

// A Graph time as an ISO 8601 string in UTC with milliseconds, such as 2026-10-22T10:00:00.000Z. The reader is shared with the
// webhook receiver (graphTimeIsoOrNull in src/util/time.js), so both paths read a time the same way: an ISO string with a
// zone, a Unix number in seconds or milliseconds, or a numeric string of either. Any other value is malformed. Nothing is
// guessed: a value that does not fit is refused (A-25).
function graphTimeIso(value, what) {
  const iso = graphTimeIsoOrNull(value);
  if (iso === null) throw malformedTime(what);
  return iso;
}

// A time that is absent or blank is null, so the caller can skip that row and not guess a time. A time that is present is
// converted by graphTimeIso, and a present value that cannot be read is malformed. The paged reads use this (A-25).
function isoTimeOrNull(value, what) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return graphTimeIso(value, what);
}

// The first-page reads keep the time as Graph gives it, as text, as they did before P3. The poller still reads through them
// until P4 moves it to the paged reads, and its event log then decides whether the time is usable. A present value that is
// not text is refused with API_ERROR, as before.
function rawTimeOrNull(value, what) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'string') throw new IgError('API_ERROR', `Graph API ${what} is not text`);
  return value;
}

// Runs the shape check of one row. A malformed row (API_ERROR from the checks) is counted and gives null. Any other error
// is thrown, so a failure of the read itself is never taken for a malformed row.
function readRow(normalise, counts) {
  try {
    return normalise();
  } catch (err) {
    if (err instanceof IgError && err.kind === 'API_ERROR') {
      counts.count += 1;
      return null;
    }
    throw err;
  }
}

// A text field that Graph may omit, such as the text of a message that has only an attachment, is null when omitted.
function optionalText(value, what) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new IgError('API_ERROR', `Graph API ${what} is not text`);
  return value;
}

// The id of the first recipient of a message, or null when the message names none.
function firstRecipientId(to) {
  if (to === undefined || to === null) return null;
  const rows = responseObject(to, 'message recipients').data;
  if (!Array.isArray(rows)) throw new IgError('API_ERROR', 'Graph API message recipients have no data array');
  return rows.length === 0 ? null : refId(rows[0], 'message recipient');
}

// A conversation with no updated time has updatedTime null. The poller skips it and audits it, so one row does not
// stop the others.
function normaliseConversation(row, time = isoTimeOrNull) {
  return {
    id: refId(row, 'conversation'),
    updatedTime: time(responseObject(row, 'conversation').updated_time, 'conversation updated_time'),
  };
}

// A message with no created time has createdTime null. The poller skips that message and audits it, and the rest of its
// thread is still read. The paged reads convert a present time to ISO; the first-page reads pass it through (see rawTimeOrNull).
function normaliseMessage(raw, time = isoTimeOrNull) {
  const message = responseObject(raw, 'message');
  return {
    id: refId(message, 'message'),
    createdTime: time(message.created_time, 'message created_time'),
    fromId: refId(message.from, 'message sender'),
    toId: firstRecipientId(message.to),
    text: optionalText(message.message, 'message text'),
  };
}

// A send that Graph confirms returns the id of the new message as message_id. The response has no success field, so
// responseConfirmed does not apply here. A response without a message_id, or with no body, is API_ERROR.
function sentMessageId(data) {
  const id = responseObject(data, 'message send').message_id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new IgError('API_ERROR', 'Graph API did not confirm the message send');
  }
  return id;
}

// One page of the owner's conversations, up to limit. When userId is given, only that user's conversation is asked for.
// The first page only, kept for the poller until P4 moves it to readConversations. Paging is not read. A conversation
// without an updated time has updatedTime null, and a time is passed through as text (see rawTimeOrNull).
export async function conversationsList(client, options) {
  const { igUserId, userId, limit = DEFAULT_CONVERSATION_LIMIT } = optionsOf(options, 'conversationsList');
  checkId(igUserId, 'igUserId');
  if (userId !== undefined) checkId(userId, 'userId');
  checkLimit(limit, MAX_CONVERSATION_LIMIT, 'limit');
  const query = { platform: 'instagram', limit };
  if (userId !== undefined) query.user_id = userId;
  const { data } = await client.get(`${igUserId}/conversations`, query);
  const rows = responseObject(data, 'conversations list').data;
  if (!Array.isArray(rows)) throw new IgError('API_ERROR', 'Graph API conversations list response has no data array');
  return rows.map((row) => normaliseConversation(row, rawTimeOrNull));
}

// The messages of one conversation, at most limit (at most 20). The conversation is read for its message ids, and then
// each message is read by id, one request at a time. The first limit ids of the page are used.
export async function conversationMessages(client, options) {
  const { conversationId, limit = DEFAULT_MESSAGE_LIMIT } = optionsOf(options, 'conversationMessages');
  checkRef(conversationId, 'conversationId');
  checkLimit(limit, MAX_MESSAGE_LIMIT, 'limit');
  const { data } = await client.get(conversationId, { fields: 'messages' });
  const rows = responseObject(responseObject(data, 'conversation').messages, 'conversation messages').data;
  if (!Array.isArray(rows)) throw new IgError('API_ERROR', 'Graph API conversation messages have no data array');
  const ids = rows.slice(0, limit).map((row) => refId(row, 'conversation message'));
  const messages = [];
  for (const id of ids) {
    const { data: raw } = await client.get(id, { fields: MESSAGE_FIELDS });
    messages.push(normaliseMessage(raw, rawTimeOrNull));
  }
  return messages;
}

// Every page of the owner's conversations, in pages of limit, up to maxPages pages and maxItems rows. Paging follows
// paging.next only (see paging.js). A malformed row is skipped and counted in skippedConversations, and the others are kept.
// userId, when given, narrows the list to that user's conversation.
export async function readConversations(client, options) {
  const { igUserId, userId, limit = MAX_CONVERSATION_LIMIT, maxPages, maxItems } = optionsOf(
    options,
    'readConversations',
  );
  checkId(igUserId, 'igUserId');
  if (userId !== undefined) checkId(userId, 'userId');
  checkLimit(limit, MAX_CONVERSATION_LIMIT, 'limit');
  const base = { platform: 'instagram', limit };
  if (userId !== undefined) base.user_id = userId;
  const skipped = { count: 0 };
  const page = await readAllPages({
    fetchPage: async (cursor) => {
      const { data } = await client.get(`${igUserId}/conversations`, withCursor(base, cursor));
      const body = responseObject(data, 'conversations list');
      if (!Array.isArray(body.data)) {
        throw new IgError('API_ERROR', 'Graph API conversations list response has no data array');
      }
      const items = [];
      for (const row of body.data) {
        const conversation = readRow(() => normaliseConversation(row), skipped);
        if (conversation !== null) items.push(conversation);
      }
      return { items, nextAfter: nextCursorOf(body, 'conversations list') };
    },
    keyOf: (conversation) => conversation.id,
    maxPages,
    maxItems,
  });
  return {
    items: page.items,
    skippedConversations: skipped.count,
    truncated: page.truncated,
    reason: page.reason,
    nextAfter: page.nextAfter,
  };
}

// Every page of one conversation's messages, read through the messages edge, GET {conversation-id}/messages, with the message
// fields in the page itself (fields=id,created_time,from,to,message) and limit=100. One page is one request: there is no
// read by message id. The cursor goes on that edge, as after. Paging follows paging.next only (see paging.js), up to
// maxPages pages and maxItems messages (1 to 1000). A malformed message in a page, such as one with no sender or an
// unusable id, is skipped and counted in skippedMessages, and the rest of the page is kept. after, when given, is the cursor
// to start from (M-4); the result's nextAfter is the cursor to continue from, when more messages remain past the bound.
// Each request asks only for the items still wanted (M-4), so a bound falls at a page end and always gives nextAfter.
export async function readThread(client, options) {
  const { conversationId, maxPages, maxItems = DEFAULT_THREAD_ITEMS, after } = optionsOf(options, 'readThread');
  checkRef(conversationId, 'conversationId');
  checkLimit(maxItems, MAX_THREAD_ITEMS, 'maxItems');
  if (after !== undefined && (typeof after !== 'string' || after === '')) {
    throw new IgError('VALIDATION', 'after must be a non-empty cursor string when it is given');
  }
  const skipped = { count: 0 };
  let collected = 0;
  const page = await readAllPages({
    fetchPage: async (cursor) => {
      const query = { fields: MESSAGE_FIELDS, limit: Math.max(1, Math.min(MESSAGE_PAGE, maxItems - collected)) };
      const { data } = await client.get(`${conversationId}/messages`, withCursor(query, cursor ?? after));
      const body = responseObject(data, 'conversation messages');
      if (!Array.isArray(body.data)) throw new IgError('API_ERROR', 'Graph API conversation messages have no data array');
      const items = [];
      for (const row of body.data) {
        const message = readRow(() => normaliseMessage(row), skipped);
        if (message !== null) items.push(message);
      }
      collected += items.length;
      return { items, nextAfter: nextCursorOf(body, 'conversation messages') };
    },
    keyOf: (message) => message.id,
    maxPages,
    maxItems,
  });
  return {
    items: page.items,
    skippedMessages: skipped.count,
    truncated: page.truncated,
    reason: page.reason,
    nextAfter: page.nextAfter,
  };
}

// A direct message to a user, by the user's id. The 1000-byte limit is checked before any request. The 24-hour window
// is the caller's to check.
export async function sendMessage(client, options) {
  const { igUserId, recipientId, text } = optionsOf(options, 'sendMessage');
  checkId(igUserId, 'igUserId');
  checkId(recipientId, 'recipientId');
  checkText(text);
  const { data } = await client.post(`${igUserId}/messages`, {
    json: { recipient: { id: recipientId }, message: { text } },
  });
  return { messageId: sentMessageId(data), recipientId };
}

// A private reply to a comment, by the comment's id. The same 1000-byte limit applies. The one-reply-per-comment rule
// and the 7-day window are the caller's to check.
export async function privateReply(client, options) {
  const { igUserId, commentId, text } = optionsOf(options, 'privateReply');
  checkId(igUserId, 'igUserId');
  checkId(commentId, 'commentId');
  checkText(text);
  const { data } = await client.post(`${igUserId}/messages`, {
    json: { recipient: { comment_id: commentId }, message: { text } },
  });
  return { messageId: sentMessageId(data), commentId };
}

// The time now, in epoch milliseconds, as Date.now() gives it. Anything else is refused.
function checkNow(now) {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new IgError('VALIDATION', 'now must be epoch milliseconds');
  }
  return now;
}

// An ISO 8601 time with a zone, as epoch milliseconds. Any other value is refused, not guessed at.
function parseTime(value, name) {
  const match = typeof value === 'string' ? ISO_WITH_ZONE.exec(value) : null;
  if (match === null) throw new IgError('VALIDATION', `${name} must be an ISO 8601 time with a zone`);
  // The shape check passes 2026-09-31, and Date.parse would move it to 1 October. The calendar check (see calendar.js)
  // refuses a month outside 1 to 12, a day outside its month, and 29 February in a common year.
  const [year, month, day] = match[1].slice(0, 10).split('-').map(Number);
  if (!isRealDate(year, month, day)) {
    throw new IgError('VALIDATION', `${name} is not a real calendar date`);
  }
  const zone = match[2] === 'Z' || match[2].includes(':') ? match[2] : `${match[2].slice(0, 3)}:${match[2].slice(3)}`;
  const ms = Date.parse(`${match[1]}${zone}`);
  if (Number.isNaN(ms)) throw new IgError('VALIDATION', `${name} is not a valid time`);
  return ms;
}

// The time since a past moment. A moment after now is refused, because the window cannot be measured from it.
function elapsedSince(past, now, name) {
  if (past > now) throw new IgError('VALIDATION', `${name} is after now`);
  return now - past;
}

// True when the last inbound message is less than 24 hours old. No inbound message (null) is false.
export function messageWindowOpen(options) {
  const { lastInboundAt, now } = optionsOf(options, 'messageWindowOpen');
  checkNow(now);
  if (lastInboundAt === null) return false;
  return elapsedSince(parseTime(lastInboundAt, 'lastInboundAt'), now, 'lastInboundAt') < DAY_MS;
}

// True when the comment is less than 7 days old. A comment with no known time (null) is false.
export function privateReplyOpen(options) {
  const { commentCreatedAt, now } = optionsOf(options, 'privateReplyOpen');
  checkNow(now);
  if (commentCreatedAt === null) return false;
  return elapsedSince(parseTime(commentCreatedAt, 'commentCreatedAt'), now, 'commentCreatedAt') < WEEK_MS;
}
