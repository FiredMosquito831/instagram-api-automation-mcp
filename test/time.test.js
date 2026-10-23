import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readThread } from '../src/graph/endpoints/messaging.js';
import { parseEvents } from '../src/webhooks.js';

// The webhook receiver and the messaging endpoint read a Graph time with one reader (src/util/time.js). This test gives the
// same instant, in each accepted form, to both paths, and checks that both return the same ISO string.
const INSTANT_ISO = '2026-10-22T10:00:00.000Z';
const UNIX_SECONDS = 1792663200;
const UNIX_MS = 1792663200000;
const FORMS = [
  '2026-10-22T10:00:00Z',
  '2026-10-22T10:00:00+0000',
  '2026-10-22T12:00:00+02:00',
  UNIX_SECONDS,
  UNIX_MS,
  String(UNIX_SECONDS),
  String(UNIX_MS),
];
const OWNER = '17841400000000001';
const SENDER = '17841400000000002';

// The webhook side: a messaging item's timestamp, and a comment's created_time.
function webhookTimes(form) {
  const message = parseEvents({
    entry: [{ messaging: [{ sender: { id: SENDER }, timestamp: form, message: { mid: 'm1', text: 'hi' } }] }],
  });
  const comment = parseEvents({
    entry: [{ changes: [{ field: 'comments', value: { id: 'c1', from: { id: SENDER }, text: 'hi', created_time: form } }] }],
  });
  return [message.events[0]?.receivedAt, comment.events[0]?.receivedAt];
}

// The graph side: a message's created_time, read by the paged thread read (one page, one request).
async function graphTime(form) {
  const client = {
    calls: 0,
    get: async () => {
      client.calls += 1;
      const row = { id: 'm1', created_time: form, from: { id: SENDER }, to: { data: [{ id: OWNER }] }, message: 'hi' };
      return { data: { data: [row] }, usage: null };
    },
  };
  const thread = await readThread(client, { conversationId: 't_1234567890' });
  return thread.items[0]?.createdTime;
}

test('the webhook receiver and the messaging endpoint give the same ISO string for one instant in every accepted form', async () => {
  for (const form of FORMS) {
    const label = JSON.stringify(form);
    const [messageAt, commentAt] = webhookTimes(form);
    assert.equal(messageAt, INSTANT_ISO, `webhook timestamp ${label}`);
    assert.equal(commentAt, INSTANT_ISO, `webhook created_time ${label}`);
    assert.equal(await graphTime(form), INSTANT_ISO, `graph created_time ${label}`);
  }
  // An instant past the year 9999 has no four-digit year, so both paths refuse it. The messaging endpoint used to give it an
  // extended-year string, and the webhook refused it; the stricter rule now applies to both.
  const past = '9999-12-31T23:00:00-05:00';
  const refused = parseEvents({ entry: [{ messaging: [{ sender: { id: SENDER }, timestamp: past, message: { mid: 'm2', text: 'x' } }] }] });
  assert.equal(refused.events.length, 0, 'webhook past 9999');
  assert.equal(refused.unknown, 1, 'webhook past 9999 is counted as unknown');
  const client = {
    get: async () => ({ data: { data: [{ id: 'm2', created_time: past, from: { id: SENDER }, to: { data: [{ id: OWNER }] }, message: 'x' }] }, usage: null }),
  };
  const thread = await readThread(client, { conversationId: 't_1234567890' });
  assert.equal(thread.items.length, 0, 'graph past 9999');
  assert.equal(thread.skippedMessages, 1, 'graph past 9999 is counted as skipped');
});
