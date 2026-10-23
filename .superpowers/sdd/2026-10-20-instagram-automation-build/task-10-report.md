# Task 10 report: webhook receiver (built, not served)

Status: DONE_WITH_CONCERNS

## Files changed

- `D:\Projects2\InstagramApi\src\webhooks.js` (new, 219 lines). Exports `verifyChallenge`, `verifySignature`, `parseEvents`, `createWebhookHandler`, `readRawBody`.
- `D:\Projects2\InstagramApi\test\webhooks.test.js` (new, 23 tests).

Nothing else changed. A diff against `snap/task-10-base` shows only these two files. `package.json`, the lockfile and `src/config.js`, `errors.js`, `redact.js`, `audit.js`, `state.js`, `events.js`, `caps.js`, `guard.js`, `graph/` and `secrets.js` are untouched. No package was installed (the task installs nothing), no server is started, and no test makes a network call. Node built-ins only (`node:crypto`, `node:stream`). No commit (R2).

Ruling R4 is followed: `startWebhookServer` is not written. `readRawBody(req, limit)` is exported for Task 15.

## TDD evidence

### RED (before the module existed)

Command: `node --test test/webhooks.test.js`

```
code: 'ERR_MODULE_NOT_FOUND',
url: 'file:///D:/Projects2/InstagramApi/src/webhooks.js'
...
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
✖ test\webhooks.test.js
```

The suite could not load, so every test failed. This is the only RED evidence, because no test ran against a partial module.

### GREEN (after the implementation)

Command: `node --test test/webhooks.test.js`

```
ℹ tests 23
ℹ pass 23
ℹ fail 0
```

Full suite: `npm test` gives `ℹ tests 378`, `ℹ pass 378`, `ℹ fail 0`, exit 0. That is 355 from Task 9 plus 23 new. This run is after the last code change.

### Mutation check (the tests can fail)

Each mutation was applied to a scratch copy (`scratchpad\mut10`), never to the project. The unmodified control passes 23/23.

| Mutation | Result |
|---|---|
| `verifySignature` always returns true | 3 failing |
| No five-minute future-time skip in the handler | 1 failing |
| No `hasId` skip (duplicate delivery) | 1 failing |
| Mention keyed by `media_id` first | 2 failing |
| `receivedAt` from the clock, not the message timestamp | 4 failing |
| `readRawBody` limit off by one (`>=`) | 2 failing |
| Echo flag not checked | 1 failing |

## Behaviour

- `verifyChallenge(query, { verifyToken })`: 200 with `hub.challenge` only when `hub.mode` is `subscribe`, the token matches, and the challenge is a non-empty string. Otherwise 403. Both tokens are SHA-256 hashed, then compared with `timingSafeEqual`. An empty configured token never matches.
- `verifySignature({ rawBody, signatureHeader, appSecret })`: `sha256=` plus the hex HMAC-SHA256 of the raw body. Lengths are compared before `timingSafeEqual`. Returns false for a missing header, a bad type, or a blank secret.
- `parseEvents(payload)` returns `{ events, unknown }`. A payload without an `entry` array throws `VALIDATION`.
  - Messaging: a `message` becomes kind `message`, with `id = mid`, `senderId = sender.id`, `text = message.text`, and `receivedAt` from the message's own `timestamp`. Echo and self flags are skipped. `is_deleted` and `message_edit` are counted in `unknown`. Any other item is counted in `unknown`.
  - Changes: `comments` becomes kind `comment`. `mentions` becomes kind `mention`. Anything else is counted in `unknown`.
- `createWebhookHandler({ appSecret, verifyToken, events, now })` throws `CONFIG` for a blank app secret or verify token. The handler returns `{ status, body }`:
  - GET: `verifyChallenge`.
  - POST: a bad or missing signature gives 403 and stores nothing. Invalid JSON, or a payload with no entry list, gives 400. Each event is skipped if `events.hasId` knows it, and appended otherwise. The result is 200 `EVENT_RECEIVED`.
  - Any other method gives 405.
- `readRawBody(req, limit)` reads the body as a Buffer with `for await`. The limit counts bytes. A body over the limit rejects with `status: 413`. The rest of such a body is drained and dropped, so that a 413 can still be sent. A non-whole limit rejects with `TypeError`, because the function is async.

## Decisions beyond the brief

1. Mention id order. The brief says `id = value.media_id || value.comment_id`. The module uses `comment_id` first, then `media_id`. Reason: with `media_id` first, two mentions in comments on one post get the same id, and the second one is dropped as a duplicate. The test `a mention is keyed by its comment...` pins this.
2. A mention needs `from.id` and a string `text` to be stored. The only documented mention shape (Facebook Login) has neither, so such a mention is counted `unknown`. On Instagram Login, mentions arrive inside `comments`, which are stored.
3. Comments and mentions take `receivedAt` from the entry's `time`, because a comment's age drives the 7-day private-reply window. The brief gives this only for messages. The unit of `entry.time` is not confirmed. It is read as milliseconds, like the message timestamp. If the live unit is seconds, comments land in 1970 and private replies are refused. That fails closed, but the live phase must confirm it.
4. A message or comment with a missing `mid`, `sender.id`, string `text`, or usable time is counted `unknown`, not answered with 400. A retry could never fix it.
5. The handler skips an event stamped more than five minutes ahead. `events.append` would throw, and the whole delivery would fail on every retry for up to 36 hours. This is the only use of `now`.
6. The signature header is found whatever the case of its name. A repeated header gives no match.
7. Response bodies are plain text: `Forbidden`, `Bad Request` and `Method Not Allowed`. Only `EVENT_RECEIVED` and the challenge echo are success bodies. The challenge is not passed through `redact`, because it is not a secret and redaction could break the handshake. No token is ever echoed.

## Self-review

- Read the full diff. Fixed while reviewing: `readMessaging` now reads `is_echo`, `is_self` and `is_deleted` from the item as well as from the message. The brief's wording does not fix the placement, and the research notes put them on the message. Two tests cover the item-level placement.
- Fail closed: an odd flag value counts as set. An odd id, time or text is never coerced. A bad value makes the item unknown, not an inbound message.
- Constant-time comparisons: `timingSafeEqual` on equal-length digests, and a length check before any signature comparison.
- Stored text is masked by `events.js` (`maskRegistered` on the way in, `redact` on the way out). The handler adds no output that carries a secret.
- Ids are never coerced from numbers. A missing or blank id makes the item unknown.
- Lines are at most 120 columns. `node --check` passes.
- Node 22 was not run (only v24.6.0 is installed). The APIs used are present in Node 22.12. The Task 8 carry-forward still applies: run the suite on Node 22 at Task 18.
- The unknown counts from `parseEvents` are not visible to any caller. The handler returns `{ status, body }` as the brief specifies.

## Concerns

1. Comments made by the owner's own account are not skipped. The handler is not given the owner id. Task 13 must skip `senderId === owner.igUserId` before any auto-reply, or the account could reply to itself.
2. The `unknown` counts are computed but not returned by the handler, so no caller or log sees them yet. A hook is needed if the owner wants them.
3. Unverified against live payloads: the unit of `entry.time` (item 3 above), and the mention shape.
4. Task 15 must pass `query` as a plain object keyed by `hub.mode`, `hub.verify_token` and `hub.challenge`, and `rawBody` as the Buffer from `readRawBody`.
5. A client can keep a connection open while an oversized body drains. Task 15's server timeouts bound this.

## Fix round 1 (review: task-10-review.md)

Status: DONE_WITH_CONCERNS. The first-round sections above describe the state before this round. Where they differ, this section governs: 29 webhook tests (was 23), and the suite is 384 (was 378).

Changed files: the same two files, `src/webhooks.js` and `test/webhooks.test.js`. Nothing else changed.

### What changed, by review item

- **I-1 (future-stamped events).** The skip is kept, and no clamping is done. Each skipped event is counted (`futureSkipped`) and written as one `webhook.event_skipped` audit line. The line holds the target id, `kind`, `reason: received_time_ahead` and `receivedAt`, and never the text. The delivery still gets 200.
- **I-2 (attachment-only messages).** A message with no `text`, or with `text: null`, is stored with `text: ''`. A `text` that is present and not a string is still unknown. Reactions, reads, postbacks and `message_edit` items remain unknown.
- **I-4 (unbounded read).** `readRawBody` now stops once more than twice the limit has arrived. It pauses the request and rejects with status 413. It does not destroy the request, so Task 15 can still send the 413 with `Connection: close`. A body over the limit but under twice the limit is read to its end, and then refused with 413. A late `error` or `close` after the first settle is absorbed, so that it cannot become an unhandled error.
- **M-1 (counts discarded).** `createWebhookHandler` now takes a required `audit` (a log with `record`), and throws `TypeError` without one. Each verified POST writes one `webhook.delivery` line whose detail holds only the counts: `{ unknown, futureSkipped, mentionsUnstored }`.
- **I-3 (mention without a sender, ruled).** The mention is not stored, because the event schema needs a sender. `parseEvents` returns it in `unstoredMentions`. The handler writes a `webhook.event_skipped` line with `kind: 'mention'`, `reason: 'no_sender'`, `mediaId` and `commentId`. The target is the media id, or the comment id when there is no media id. The schema is unchanged.
- **M-2 (`message_edit`).** Read with `isSet`, like the other flags. A `null` or `false` `message_edit` is not an edit.
- **M-3 (non-boolean flags).** `is_echo`, `is_self` and `is_deleted` must be booleans when present, on the item or on its message. Any other value makes the item unknown. It is listed in `oddFlags`, and the handler writes a `webhook.event_skipped` line with `reason: non_boolean_flag` and `flag`. The item is not skipped as an echo or self message.
- **M-6 (tests).** A GET through the handler is tested, and dedupe across a restart is tested. The restart is a new state, event log and audit log over the same files.

### Interface changes

- `createWebhookHandler({ appSecret, verifyToken, events, audit, now })`. `audit` is new and required.
- `parseEvents(payload)` returns `{ events, unknown, unstoredMentions, oddFlags }`. Before, it returned `{ events, unknown }`.
- Task 15 must pass an audit log whose file is under the project root (carry-forward C2).

### Covering tests

| Item | Test (test/webhooks.test.js) |
|---|---|
| I-1, M-1 | `a message over five minutes ahead is not stored, is counted and is audited without its text` |
| I-2 | `an attachment-only message, such as an image, is stored as a message with empty text` |
| I-2 (updated) | `reactions, reads, postbacks and comments without a sender are counted as unknown` (now asserts only the non-message items) |
| I-3, M-1 | `a mention without a sender is counted and audited with its kind and media id, and is not stored` |
| I-4 | `a stream many times the limit is cut off before its end` (also asserts that a late error does not throw); `a body of exactly the limit is read, and one byte more is refused with status 413` |
| M-2, M-3 | `a flag with a non-boolean value makes the item unknown and audited, and the item is not skipped` (`is_self: "false"` is audited, and `is_self: false` with `message_edit: null` is stored) |
| M-6 | `the handshake through the handler echoes the challenge, and refuses a wrong verify token`; `dedupe holds across a restart` |

The restored test `bad signature returns 403 and stores nothing` was dropped by mistake in the first write of this round. It is back, verbatim.

Cut-off measurement: the test stream of 10,000 chunks of 100 bytes was read to 22 chunks (2,200 bytes) before the 413.

### Mutation checks (scratch copy, one change at a time)

| Mutation | Result |
|---|---|
| A. future skip not counted | 1 failing (the future test) |
| B. message with no text becomes unknown | 1 failing (the attachment test) |
| C. non-boolean flags treated as set | 1 failing (the flag test). The first try was a no-op because of an indentation mismatch in my sed, and it was redone |
| D. mention without sender dropped silently | 1 failing (the mention test) |
| E. no 2x cut-off in `readRawBody` | 1 failing (the cut-off test) |
| F. `message_edit` tested with `=== undefined` | 1 failing (the flag test), after the `null` assertion was added |
| G. no `hasId` check | 2 failing (duplicate and restart) |
| H. `error` listener removed from `readRawBody` | 2 failing (cut-off and stream-error) |
| Control (unchanged) | 28 pass, 0 fail, run before the restored test was added. After the restore, the final `npm test` runs the 29 webhook tests and all pass |

### Command and output

```
npm test
ℹ tests 384
ℹ pass 384
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Exit code 0. The webhook file alone runs 29 of 29.

### Deferred, untouched

M-4 (`hasId` reads the whole file), M-5 (shared dedupe space), M-7 (duplicated helpers), M-8 (two clocks), M-9 (body limit has no default).

### Concerns after this round

1. Task 15 must pass `audit` and a `now` shared with `createEventLog` (M-8), and must set the body limit explicitly (M-9).
2. Task 13 must not auto-reply to an empty-text message (I-2), and must skip the owner's own comments (ruling 1).
3. A mention with no sender is audited but not stored (I-3). The owner loses it in the event log, so the README and the ledger must record that.
4. Unverified against live payloads: the unit of `entry.time` and the mention shape. Node 22 has not been run (Task 18 carry-forward).

## Task 17 owner option

Status: DONE. The owner is now required by the webhook handler, and events from the owner's own account are skipped.

### What changed

- `src/webhooks.js:195`: `createWebhookHandler({ appSecret, verifyToken, owner, events, audit, now })`. `owner` is new.
- `src/webhooks.js:198-200`: the owner check. It is the same rule as the poller's owner check (`src/poller.js:103`): `typeof owner !== 'string' || !/^\d+$/.test(owner)` throws `IgError` `CONFIG`. The check comes after the app secret and verify token checks, and before the event log and audit checks.
- `src/webhooks.js:228-246`: the owner skip. The `counts` object gains `ownerSkipped` (`:232`). The check `if (event.senderId === owner)` (`:237`) runs for each parsed event (messages, comments and mentions) before the future-time check, before `events.hasId` and before `events.append`. A match increments `ownerSkipped` (`:238`), is audited as `webhook.event_skipped` with `target` = event id and `detail` = `{ kind, reason: 'owner_sender' }`, and `continue`s (`:245`). No text is written. The line has the same shape as `poll.skip` (action, target id, outcome `skipped`, reason).
- The delivery audit line (`webhook.delivery`) gains a fourth count, `ownerSkipped`. The other three counts are unchanged.
- `src/cli.js:390` (outside the webhook module, see concerns): `owner: effective.owner.igUserId,` added to the `createWebhookHandler` call in `buildServe`. Without it the serve command throws CONFIG whenever `webhook.enabled` is true, and the cli test `the webhook handler is built only when webhook.enabled is true...` failed.
- `test/http.test.js:92-103`: the helper `realWebhookHandler` (declared at `:90`) passes `owner: '1784100000000001'` (a digit string), in a call spread over lines 95-102. Its payloads are from `user-1`.

Unchanged: the signature check is still first (`src/webhooks.js`, the POST branch of the handler), the verify token comparison, and the 24-hour rules (those live in the service and in `events.js`, not in this module).

### Tests added (test/webhooks.test.js)

- `an owner message is not stored and is audited` (`:292`): not stored, `hasId` false, one `webhook.event_skipped` line with target `m-own`, kind `message`, reason `owner_sender`, `ownerSkipped` 1, no text in the audit.
- `an owner comment or mention is not stored and is audited` (`:311`): both skipped, audited with kinds `comment` and `mention`, `ownerSkipped` 2, no comment text in the audit.
- `a message from another account is still stored, and is not counted as an owner skip` (`:334`).
- `a handler built with an owner that is not a string of digits throws CONFIG` (`:342`): `undefined`, `''`, `'   '`, `'1784 100'`, `'17841x'`, `'owner-1'`, and the number `1784100000000001`.

### Test changes, old and new assertions

Only the assertions and helpers below changed. No other test was edited.

1. `the handler refuses to build without an app secret, a verify token or an audit log`, the TypeError check:
   - Old: `() => createWebhookHandler({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, events }),`
   - New: `() => createWebhookHandler({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, owner: OWNER_ID, events }),`
   - The reason: the owner check now runs before the audit check, so the call needs an owner to reach the audit check.
2. The same test, the success check:
   - Old: `typeof createWebhookHandler({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, events, audit }),`
   - New: `typeof createWebhookHandler({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, owner: OWNER_ID, events, audit }),`
3. `a message over five minutes ahead is not stored, is counted and is audited without its text` (`:420`):
   - Old: `assert.deepStrictEqual(delivery.detail, { unknown: 0, futureSkipped: 1, mentionsUnstored: 0 });`
   - New: `assert.deepStrictEqual(delivery.detail, { unknown: 0, futureSkipped: 1, mentionsUnstored: 0, ownerSkipped: 0 });`
4. `a mention without a sender is counted and audited with its kind and media id, and is not stored` (`:289`):
   - Old: `assert.deepStrictEqual(delivery.detail, { unknown: 0, futureSkipped: 0, mentionsUnstored: 1 });`
   - New: `assert.deepStrictEqual(delivery.detail, { unknown: 0, futureSkipped: 0, mentionsUnstored: 1, ownerSkipped: 0 });`
5. The `openHandler` helper (`:70`): `owner: OWNER_ID,` added. The helper is not an assertion.

The build test's secret and token loops still omit `owner`. Those calls still throw CONFIG, because the secret and token checks run first, so their assertions are unchanged.

### Commands and output

```
npm test
ℹ tests 710
ℹ suites 0
ℹ pass 710
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Exit code 0. The webhook file alone: 33 tests, 33 pass (29 before this change, plus 4 new).

The first full run after the handler change failed one test, `cli.test.js:168`, with `IgError [CONFIG] the webhook needs the owner igUserId as a string of digits` raised from `src/cli.js:387`. The `src/cli.js:390` change fixed it.

### Mutation check (scratch copy)

Removing the owner check (`if (event.senderId === owner)` replaced by `if (false)`) makes 2 tests fail: `an owner message is not stored and is audited` and `an owner comment or mention is not stored and is audited`.

### Concerns

1. `src/cli.js:390` is one line in another module, changed to keep the suite green. Please confirm the owner of that file accepts it. Without it, `ig serve` with `webhook.enabled` true fails at startup.
2. `config.owner.igUserId` is not checked for digits at config load. The handler refuses a non-digit owner at build, so such a config fails loudly at serve start.
