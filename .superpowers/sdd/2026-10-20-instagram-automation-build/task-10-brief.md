### Task 10: Webhook receiver (built, not served)

**Files:** Create `src/webhooks.js`. Test: `test/webhooks.test.js`.

**Interfaces:**
- Consumes: `createEventLog` (Task 3), `IgError` (Task 2).
- Produces: `verifyChallenge(query, { verifyToken }) -> { status, body }`. When `hub.mode === 'subscribe'` and the verify token matches, the status is 200 and the body is `hub.challenge`. Otherwise the status is 403. The comparison hashes both values with SHA-256, then uses `crypto.timingSafeEqual`.
- Produces: `verifySignature({ rawBody, signatureHeader, appSecret }) -> boolean`. The expected value is `'sha256=' + HMAC-SHA256(appSecret, rawBody)` as hex. Compare with `crypto.timingSafeEqual`. Return false when the header is missing or the lengths differ.
- Produces: `parseEvents(payload) -> { events, unknown }`. From `entry[].messaging[]`: an inbound message becomes kind `message`, with `id = message.mid`, `senderId = sender.id`, `text = message.text`, and `receivedAt` from `timestamp`. Entries with `is_echo` or `is_self` are skipped. Entries with `is_deleted` or `message_edit` are counted in `unknown`. From `entry[].changes[]`: field `comments` becomes kind `comment` (`id = value.id`, `senderId = value.from.id`, `text = value.text`). Field `mentions` becomes kind `mention` (`id = value.media_id || value.comment_id`). Anything else is counted in `unknown`.
- Produces: `createWebhookHandler({ appSecret, verifyToken, events, now })`. It throws `CONFIG` when either value is empty. The handler is `async ({ method, query, headers, rawBody }) -> { status, body }`. GET uses `verifyChallenge`. POST checks the signature, parses the events, skips any id that `events.hasId` knows, appends the rest, and returns 200 with `EVENT_RECEIVED`. A bad signature returns 403 and stores nothing.
- Produces: `startWebhookServer({ host, port, path, handler }) -> Promise<{ address, close() }>`. It reads the raw body, passes it to the handler, and rejects bodies over 1 MB with 413. `serve` (Task 17) starts it only when `webhook.enabled` is set.

**Tests:**
- `handshake echoes hub.challenge when the verify token matches`.
- `handshake returns 403 for a wrong verify token`.
- `signature check accepts the HMAC of the raw body and rejects a tampered body`.
- `duplicate delivery stores one event`: the same payload posted twice stores one event.
- `echo and self messages are not stored as inbound`.
- `deleted and edited messages are counted as unknown`.
- `bad signature returns 403 and stores nothing`.
- `comments and mentions are stored with their kinds`.
- `the handler refuses to build without an app secret or verify token`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the module.** Run the tests and expect PASS.

