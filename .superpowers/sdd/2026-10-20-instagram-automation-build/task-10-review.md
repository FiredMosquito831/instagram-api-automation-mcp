# Task 10 review: webhook receiver (built, not served)

Reviewed: task-10-brief.md, global-constraints.md, progress.md (Task 10 entry, R2, R3, R4, R9, Task 3 carry-forward), task-10-report.md, review-task-10.diff. Read-only checks: src/events.js (createEventLog, newEventFields, readStore, hasId) and src/errors.js (IgError.kind). The suite was not re-run. Line numbers refer to src/webhooks.js and test/webhooks.test.js in the project, which match the diff.

## Spec compliance

Verdict: ❌. Three narrow deviations in the POST path: events stamped more than five minutes ahead are dropped silently, attachment-only messages are never stored, and mentions without a sender are never stored. The handshake, the signature check, the dedupe, the build refusal and the body reader meet the brief.

- ✅ Handshake, `src/webhooks.js:58-66`. The mode check (:63), both tokens hashed with SHA-256 and compared with `timingSafeEqual` (:43-47, :65), the challenge returned on a match (:65), and 403 otherwise. An empty configured token never matches (:63).
- ✅ Signature, `src/webhooks.js:70-77`. The expected value is `sha256=` plus the hex HMAC-SHA256 of the raw body (:73-74). A missing header is refused (:72), and a length mismatch is refused (:76) before `timingSafeEqual`.
- ✅ Order in the handler, `src/webhooks.js:171-192`. The signature is checked (:171) before `JSON.parse` (:175), before `parseEvents`, and before any append (:191-192). A repeated signature header gives no match (:50-54).
- ✅ Build refusal, `src/webhooks.js:159-160`. CONFIG is thrown at build time for an empty app secret or verify token.
- ✅ Echo and self skipped, at message or item level, `src/webhooks.js:97-98`.
- ✅ Message fields, `src/webhooks.js:99-101` and `:108`. `id` is `mid`, `senderId` is `sender.id`, `text` is `message.text`, and `receivedAt` comes from the message's own timestamp (the Task 3 carry-forward). A timestamp that is not an integer in range becomes unknown (`:37-40`, `:104`), never recent.
- ✅ Deleted and edited messages count as unknown, `src/webhooks.js:103` and `:105-107`.
- ✅ Comments, `src/webhooks.js:80-85` and `:116-117`. `id` is `value.id`, `senderId` is `value.from.id`, `text` is `value.text`.
- ✅ Mention id, with a deviation, `src/webhooks.js:119`. The code reads `comment_id` before `media_id`, the reverse of the brief. The report (decision 1) gives the reason, and a test pins it. The deviation should be recorded in the ledger.
- ❌ Mentions, `src/webhooks.js:81` and `:83`, applied at `:119`. A mention without `from.id`, or without a string `text`, is counted unknown. The brief gives a mention an id only. `src/events.js:243` requires a sender for every event, so part of this rule is forced by Task 3's schema. See I-3.
- ❌ Attachment-only messages, `src/webhooks.js:104-107`. A message with no text is counted unknown. The brief says an inbound message becomes kind `message` with `text = message.text`. See I-2.
- ❌ Future-stamped events, `src/webhooks.js:190`. They are skipped without a count or a log. The brief says the handler "appends the rest". See I-1.
- ✅ Dedupe, `src/webhooks.js:191`. An id that `events.hasId` knows is skipped, both across deliveries and inside one delivery. The test "duplicate delivery stores one event" covers both.
- ✅ Responses, `src/webhooks.js:181` (GET through `verifyChallenge`) and `:194` (200 with `EVENT_RECEIVED`). Other methods get 405 at `:182`, which the brief does not list and which is harmless.
- ✅ R4 followed. No `startWebhookServer`. `readRawBody` is exported at `:200`. The module imports no net or http code, and it starts no listener.
- ✅ `readRawBody`, `src/webhooks.js:200-219`. It returns a Buffer (:218), counts bytes (:211), rejects an over-limit body with `status: 413` (:217), and rejects a non-whole limit with TypeError (:201-203).
- ⚠️ The 1 MB limit is not in the module. Task 15 must pass it. The brief does not say whether 1 MB means 1,000,000 or 1,048,576 bytes.
- ⚠️ `entry.time` as the `receivedAt` of comments and mentions, `src/webhooks.js:146` and `:37-40`. The brief gives comments no time. The unit is read as milliseconds, like the message timestamp, and the diff cannot show whether that is right. If the live unit is seconds, every comment gets a 1970 time and every private reply is refused. That fails closed. It is a live-phase gate before Task 15 serves the path.
- ⚠️ The live shapes of mentions and comments (report concern 3) cannot be verified from the diff.
- ⚠️ The report's counts (23 tests; 378 in the suite), the mutation table and the Node 22 status are report claims. I did not re-run them. The RED evidence is a module-load failure, not a behavioural failure.
- ⚠️ "The path answers 404 unless `webhook.enabled`" is not in Task 10, which has no route. It belongs to Task 15 and Task 17.
- Tests: all nine named tests are present under the brief's exact names in `test/webhooks.test.js`. There are 23 tests in the file.

## Strengths

- The handshake and the signature check follow the brief and the constraints. Tokens are hashed before `timingSafeEqual`. The length check comes before the signature comparison. Nothing is parsed before the check.
- Parsing fails closed throughout. Ids are never coerced from numbers (`idOf`, `src/webhooks.js:25-28`). A bad time, a non-object item or a wrong-typed field becomes unknown, never a message. A repeated header gives no match.
- Events reach the log only through the events schema (`newEventFields`, `src/events.js:240-259`), which masks text with `maskRegistered` (`src/events.js:256`). No raw secret path.
- Retry-safe batches. If the append fails part way, the delivery is retried and `hasId` skips the events already stored (`src/webhooks.js:191-192`).
- The tests use a real event log and a real state file in temp directories. The report's mutation table, if accurate, shows the tests can fail.
- No logging, no network, no server. Node built-ins only.

## Issues

### Critical

None.

### Important

**I-1. Future-stamped events are dropped silently.** `src/webhooks.js:190`. The skip is needed: `src/events.js:250` throws for a `receivedAt` more than five minutes ahead, and the Task 3 rule forbids clamping `receivedAt` to the clock. The problem is that the drop is not counted, not logged and not reported. A host clock more than five minutes behind Meta's makes every inbound message disappear. The handler still answers 200, so Meta does not retry. The report (decision 5) documents the skip but not its silence. Fix: keep the skip, count the skipped events, write one audit line per skipped event (kind, id and receivedAt, never the text), and add a test that checks the count or the line.

**I-2. Attachment-only messages are never stored.** `src/webhooks.js:104-107`, pinned by the test "reactions, reads, postbacks, non-text messages and comments without a sender are counted as unknown" (`test/webhooks.test.js:266`). An image, voice note or sticker has no `text`, so the item is counted unknown. The brief says an inbound message becomes kind `message` with `text = message.text`. These are real inbound DMs, and the owner never sees them. Fix: when `message.text` is absent, store `text: ''`. `src/events.js:245` accepts any string. Keep the unknown count for items that are not messages, and update the test. Task 13 must handle an empty-text message without treating it as a request to reply.

**I-3. Mentions without a sender are never stored.** `src/webhooks.js:80-85` and `:119`. The brief gives a mention an id only, but `src/events.js:243` requires a non-blank `senderId` for every event. So a mention with no `from.id` cannot be stored under the current schema. The report (decision 2) does not say this. A caption mention carries only a media id, as far as I understand Meta's shape (unverified), so it is never stored and never surfaced. This is a conflict between the brief and Task 3's schema, not an implementer error. Fix: the controller rules before Task 15. Either Task 3's schema accepts a null sender for kind `mention`, or the loss is accepted and written into the README and the ledger.

**I-4. `readRawBody` reads an oversized body to its end.** `src/webhooks.js:207-216`. Once the limit is passed, the loop drops each chunk and keeps reading until the stream ends. The only bound is the server's timeouts, which this module does not set, so one connection can push gigabytes into a public webhook. The 413 is also sent only after the whole body has arrived (`:217`). Fix: after a bounded extra amount (for example, one more `limit` of bytes), stop reading and throw, so that Task 15 can send the 413 with `Connection: close`. Add a test that a stream of many times the limit makes the function reject before the stream ends.

### Minor

**M-1. Unknown counts are discarded.** `parseEvents` returns `unknown` (`src/webhooks.js:127-153`), and the handler reads only `events` (`:179-194`). Fix: write the counts to the audit log with no text, or return them to Task 15. This is the report's concern 2 and ledger ruling 2.

**M-2. `message_edit` uses `=== undefined`.** `src/webhooks.js:103`. Every other flag uses `isSet` (`:32-34`), so `message_edit: null` on a message counts as absent. Fix: `!isSet(item.message_edit)`.

**M-3. Odd flag values count as set.** `src/webhooks.js:32-34` and `:98`. A value such as `is_self: "false"` silently skips a real inbound message. This fails closed for actions, but it is a silent loss. Fix: accept the rule and record it, or count only `true` and the string `"true"` as set.

**M-4. `hasId` reads the whole events file on every call.** `src/events.js:123-125` and `:347`, called once per event at `src/webhooks.js:191`. A delivery of N events costs N full reads. Fix: one read per delivery, or an in-memory id index in events.js. This is Task 3's file, so it goes to the final review.

**M-5. Comments and mentions share one dedupe space.** `src/webhooks.js:191`. A mention whose comment is already stored as a comment is skipped, and its kind is lost. Fix: document it, or accept it.

**M-6. Test gaps.** No test calls the handler with GET (the path at `src/webhooks.js:181` is tested only through `verifyChallenge`). No test covers dedupe across a restart. No test bounds the drain, because I-4 leaves no bound to test.

**M-7. Duplicated constants and helpers.** `MAX_FUTURE_MS` at `src/webhooks.js:12` and `src/events.js:25`. `isPlainObject` and `isText` at `src/webhooks.js:16-23` duplicate helpers elsewhere. The ledger lists this for the final review. Fix: export each once.

**M-8. Two clocks.** `createWebhookHandler` defaults `now` to `Date.now` (`src/webhooks.js:158`), and `createEventLog` does the same (`src/events.js:264`). The five-minute skip (`:190`) and the refusal at `src/events.js:250` can disagree if the clocks differ. Fix: Task 15 passes one clock to both.

**M-9. The body limit has no default and no stated unit.** `src/webhooks.js:200-203`. The 1 MB value lives in the caller. Fix: Task 15 passes an explicit byte count and names it in a comment.

## Assessment

Spec: not met. I-1, I-2 and I-3 are the three deviations. The handshake, the signature check, the dedupe, the build refusal and the body reader meet the brief.

Task quality: Needs fixes. The handshake, the signature check, the dedupe and the body reader are correct and tested, but three inbound paths lose messages silently (I-1 to I-3), and `readRawBody` reads an oversized body without a bound (I-4).

Carry-forwards, not Task 10 defects:
- The owner's own comments are not skipped (ledger ruling 1). Task 13 and Task 15 own this.
- The comment and mention time unit and live shapes (the ⚠️ items) are a live-phase gate before Task 15 serves the path.
- `hasId` reads the whole file per event (M-4). Task 3's file, for the final review.
- The Node 22 run is a Task 18 carry-forward.
