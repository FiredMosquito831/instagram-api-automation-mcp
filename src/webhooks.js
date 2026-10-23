// The webhook receiver. It answers Meta's verification handshake, checks the signature of each delivery, and turns the
// messages, comments and mentions in a delivery into events for the event log. It starts no server. Task 15 mounts the
// webhook path on the one HTTP listener and reads the body with readRawBody.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { IgError } from './errors.js';
import { sameText } from './util/compare.js';
import { MAX_FUTURE_MS, graphTimeIsoOrNull } from './util/time.js';
import { isPlainObject } from './util/object.js';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';
const RECEIVED = 'EVENT_RECEIVED';
const RETRY_LATER = 'Retry later';
// The flags that decide what happens to a messaging item. Each may sit on the item or on its message.
const DECIDING_FLAGS = ['is_echo', 'is_self', 'is_deleted'];

// A text that is not blank.
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// The id, or null when the value is not a non-blank string. Ids are never coerced from numbers.
function idOf(value) {
  return isText(value) ? value : null;
}

// The sender id of a comment or mention, or null when there is no sender.
function senderOf(value) {
  return isPlainObject(value.from) ? idOf(value.from.id) : null;
}

// A flag is set when it is present and not false. A flag with any other value counts as set, so an odd value is never
// read as an inbound message.
function isSet(flag) {
  return flag !== undefined && flag !== null && flag !== false;
}

// The value of a header, whatever the case of its name. A name that appears more than once gives undefined.
function headerValue(headers, name) {
  if (!isPlainObject(headers)) return undefined;
  const found = Object.keys(headers).filter((key) => key.toLowerCase() === name);
  return found.length === 1 ? headers[found[0]] : undefined;
}

// Answers Meta's verification handshake. The challenge is echoed only when the mode is subscribe and the verify token
// matches. Any other request is refused with 403.
export function verifyChallenge(query, { verifyToken } = {}) {
  const refused = { status: 403, body: 'Forbidden' };
  const mode = query?.['hub.mode'];
  const given = query?.['hub.verify_token'];
  const challenge = query?.['hub.challenge'];
  if (mode !== 'subscribe' || !isText(verifyToken) || typeof given !== 'string') return refused;
  if (typeof challenge !== 'string' || challenge === '') return refused;
  return sameText(given, verifyToken) ? { status: 200, body: challenge } : refused;
}

// True when the header is 'sha256=' and the hex HMAC-SHA256 of the raw body with the app secret. The header is refused
// before the comparison when it is missing or of another length, because timingSafeEqual needs equal lengths.
export function verifySignature({ rawBody, signatureHeader, appSecret } = {}) {
  const bodyIsText = Buffer.isBuffer(rawBody) || typeof rawBody === 'string';
  if (!bodyIsText || !isText(appSecret) || typeof signatureHeader !== 'string') return false;
  const digest = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const expected = Buffer.from(SIGNATURE_PREFIX + digest, 'utf8');
  const given = Buffer.from(signatureHeader, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// A comment or a mention, as an event, or null when a field it needs is missing or of the wrong type. Its time is its own
// created_time when it has one, and otherwise the time of its entry. Both accept the forms in graphTimeIsoOrNull (src/util/time.js).
function commentLike(kind, id, value, entryTime) {
  const senderId = senderOf(value);
  const receivedAt = graphTimeIsoOrNull(value.created_time !== undefined ? value.created_time : entryTime);
  if (id === null || senderId === null || typeof value.text !== 'string' || receivedAt === null) return null;
  return { id, kind, senderId, text: value.text, receivedAt };
}

// Reads one messaging item. A message becomes an event. A message with no text, such as an image, a voice note or a
// sticker, is stored with empty text. An echo or a message from this account is skipped. A deleted or edited message,
// and any other kind of item, is counted as unknown. A flag whose value is not a boolean makes the item unknown, and
// it is recorded in out.oddFlags so that the audit log can show it.
function readMessaging(item, out) {
  if (!isPlainObject(item)) {
    out.unknown += 1;
    return;
  }
  const hasMessage = isPlainObject(item.message);
  const message = hasMessage ? item.message : {};
  const flags = {};
  for (const name of DECIDING_FLAGS) {
    const values = [item[name], message[name]].filter((value) => value !== undefined);
    if (!values.every((value) => typeof value === 'boolean')) {
      out.unknown += 1;
      out.oddFlags.push({ id: idOf(message.mid), flag: name });
      return;
    }
    flags[name] = values.includes(true);
  }
  if (flags.is_echo || flags.is_self) return;
  const id = idOf(message.mid);
  const senderId = isPlainObject(item.sender) ? idOf(item.sender.id) : null;
  const receivedAt = graphTimeIsoOrNull(item.timestamp);
  const text = message.text ?? '';
  const storable = hasMessage && !isSet(item.message_edit) && !flags.is_deleted && id !== null && senderId !== null;
  if (!storable || typeof text !== 'string' || receivedAt === null) {
    out.unknown += 1;
    return;
  }
  out.events.push({ id, kind: 'message', senderId, text, receivedAt });
}

// Reads one change of an entry. A comment is keyed by its id. A mention is keyed by its comment, or by its media
// when it has no comment, so two mentions on one post are two events. A mention with no sender cannot be stored, so
// it is recorded in out.unstoredMentions. Any other field is counted as unknown.
function readChange(change, time, out) {
  const value = isPlainObject(change) ? change.value : undefined;
  if (!isPlainObject(value)) {
    out.unknown += 1;
    return;
  }
  if (change.field === 'comments') {
    const event = commentLike('comment', idOf(value.id), value, time);
    if (event === null) out.unknown += 1;
    else out.events.push(event);
    return;
  }
  if (change.field === 'mentions') {
    const mediaId = idOf(value.media_id);
    const commentId = idOf(value.comment_id);
    const id = commentId ?? mediaId;
    if (id !== null && senderOf(value) === null) {
      out.unstoredMentions.push({ mediaId, commentId });
      return;
    }
    const event = commentLike('mention', id, value, time);
    if (event === null) out.unknown += 1;
    else out.events.push(event);
    return;
  }
  out.unknown += 1;
}

// Turns a parsed webhook payload into events, and counts what it cannot store. A payload without an entry list is
// refused with VALIDATION. The result holds the events, the count of unknown items, the mentions with no sender, and
// the items with a flag that is not a boolean.
export function parseEvents(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.entry)) {
    throw new IgError('VALIDATION', 'the webhook payload has no entry list');
  }
  const out = { events: [], unknown: 0, unstoredMentions: [], oddFlags: [] };
  for (const entry of payload.entry) {
    if (!isPlainObject(entry)) {
      out.unknown += 1;
      continue;
    }
    if (entry.messaging !== undefined) {
      if (Array.isArray(entry.messaging)) {
        for (const item of entry.messaging) readMessaging(item, out);
      } else {
        out.unknown += 1;
      }
    }
    if (entry.changes !== undefined) {
      if (Array.isArray(entry.changes)) {
        for (const change of entry.changes) readChange(change, entry.time, out);
      } else {
        out.unknown += 1;
      }
    }
  }
  return out;
}

// Builds the webhook handler. It refuses to build without a non-blank app secret and verify token, and without the
// owner igUserId as a string of digits. It returns { status, body } for each request. A POST with a bad signature stores
// nothing. A delivery with an event stamped more than five minutes ahead stores the other events, and answers 503 (P4
// review M-7). An event from the owner's own account is never stored. An event whose id is already stored is skipped, so
// a redelivered event is stored once. The audit log gets one line per skipped event, and one line per verified
// delivery with the counts only.
export function createWebhookHandler({ appSecret, verifyToken, owner, events, audit, now = () => Date.now(), notify } = {}) {
  if (!isText(appSecret)) throw new IgError('CONFIG', 'the webhook needs an app secret');
  if (!isText(verifyToken)) throw new IgError('CONFIG', 'the webhook needs a verify token');
  if (typeof owner !== 'string' || !/^\d+$/.test(owner)) {
    throw new IgError('CONFIG', 'the webhook needs the owner igUserId as a string of digits');
  }
  if (typeof events?.hasId !== 'function' || typeof events?.append !== 'function') {
    throw new TypeError('createWebhookHandler needs an event log with hasId and append');
  }
  if (typeof audit?.record !== 'function') throw new TypeError('createWebhookHandler needs an audit log with record');
  if (typeof now !== 'function') throw new TypeError('createWebhookHandler needs now as a function');
  if (notify !== undefined && typeof notify !== 'function') {
    throw new TypeError('createWebhookHandler needs notify as a function when it is given');
  }

  // The notify step for one stored event (P4 review, inbound wiring). It is not awaited, so the delivery is answered at once. A
  // callback that throws, or whose promise rejects, is audited with its error kind only, and the delivery goes on.
  function notifyStored(stored) {
    const failed = (err) => {
      try {
        audit.record({ action: 'webhook.notify', target: stored.id, outcome: 'error', detail: { kind: err?.kind ?? 'error' } });
      } catch {
        // The audit line is best effort here, as elsewhere: the event is stored already.
      }
    };
    try {
      const result = notify(stored);
      if (result !== null && typeof result === 'object' && typeof result.then === 'function') result.then(undefined, failed);
    } catch (err) {
      failed(err);
    }
  }

  return async function handle({ method, query, headers, rawBody } = {}) {
    if (method === 'GET') return verifyChallenge(query, { verifyToken });
    if (method !== 'POST') return { status: 405, body: 'Method Not Allowed' };

    const signatureHeader = headerValue(headers, SIGNATURE_HEADER);
    if (!verifySignature({ rawBody, signatureHeader, appSecret })) return { status: 403, body: 'Forbidden' };

    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody);
    } catch {
      return { status: 400, body: 'Bad Request' };
    }
    let parsed;
    try {
      parsed = parseEvents(payload);
    } catch (error) {
      if (error instanceof IgError && error.kind === 'VALIDATION') return { status: 400, body: 'Bad Request' };
      throw error;
    }

    const counts = {
      unknown: parsed.unknown,
      futureSkipped: 0,
      mentionsUnstored: parsed.unstoredMentions.length,
      ownerSkipped: 0,
    };
    for (const event of parsed.events) {
      // An event from the owner's own account is not stored. This is checked before the future-time check and before
      // the dedupe check, so that the owner's event is never written.
      if (event.senderId === owner) {
        counts.ownerSkipped += 1;
        audit.record({
          action: 'webhook.event_skipped',
          target: event.id,
          outcome: 'skipped',
          detail: { kind: event.kind, reason: 'owner_sender' },
        });
        continue;
      }
      // The log refuses a time that is too far ahead, and the time must not be clamped, because receivedAt is the
      // message's own time. So the event is counted and audited, and it is not stored. The delivery is answered 503 below,
      // so that the sender retries it later (P4 review M-7). The other events of the delivery are stored as usual.
      if (Date.parse(event.receivedAt) > now() + MAX_FUTURE_MS) {
        counts.futureSkipped += 1;
        audit.record({
          action: 'webhook.event_skipped',
          target: event.id,
          outcome: 'skipped',
          detail: { kind: event.kind, reason: 'received_time_ahead', receivedAt: event.receivedAt },
        });
        continue;
      }
      // The dedupe key is the kind and the id, so a comment and a mention with the same id are both stored (A-22).
      if (events.hasId(event.id, event.kind)) continue;
      const stored = events.append(event);
      if (notify !== undefined) notifyStored(stored);
    }
    for (const mention of parsed.unstoredMentions) {
      audit.record({
        action: 'webhook.event_skipped',
        target: mention.mediaId ?? mention.commentId,
        outcome: 'skipped',
        detail: { kind: 'mention', reason: 'no_sender', mediaId: mention.mediaId, commentId: mention.commentId },
      });
    }
    for (const flagged of parsed.oddFlags) {
      audit.record({
        action: 'webhook.event_skipped',
        target: flagged.id,
        outcome: 'unknown',
        detail: { reason: 'non_boolean_flag', flag: flagged.flag },
      });
    }
    audit.record({ action: 'webhook.delivery', target: null, outcome: 'received', detail: counts });
    // An event that was stamped ahead of this host's clock was not stored, so the delivery is answered 503 and the sender
    // retries it later (P4 review M-7). A retry stores nothing twice: the stored ids are skipped.
    if (counts.futureSkipped > 0) return { status: 503, body: RETRY_LATER };
    return { status: 200, body: RECEIVED };
  };
}

// Reads the raw request body as one Buffer. A body over limit bytes is refused with an error whose status is 413. Once
// more than twice the limit has arrived, reading stops at once. The stream is paused rather than destroyed, so the
// caller can still send the 413 and close the connection. The limit counts bytes.
export async function readRawBody(req, limit) {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError('readRawBody needs a limit of whole bytes, 0 or more');
  }
  // A request that has already ended, or has been destroyed or closed, gets no end or close event that it has not already
  // had. Waiting for one would hang, so it is refused here at once (A-23).
  if (req.destroyed === true || req.readableEnded === true || req.closed === true) {
    throw new Error('the request closed before its body was read');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let over = false;
    let settled = false;
    // Settles once. The error and close listeners stay attached, and ignore any event after the first, so that a late
    // error on the request is never an unhandled error.
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      if (error) reject(error);
      else resolve(value);
    };
    const tooLarge = () => Object.assign(new Error(`the request body is over ${limit} bytes`), { status: 413 });
    function onData(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > 2 * limit) {
        req.pause();
        settle(tooLarge());
        return;
      }
      if (total > limit) over = true;
      if (!over) chunks.push(buffer);
    }
    function onEnd() {
      if (over) settle(tooLarge());
      else settle(null, Buffer.concat(chunks, total));
    }
    function onError(error) {
      settle(error);
    }
    function onClose() {
      settle(new Error('the request closed before its body was read'));
    }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}
