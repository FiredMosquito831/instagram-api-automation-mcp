# Task 10 re-review: fix round 1

Scope: the eight items named in the controller's brief (I-1, I-2, I-3, I-4, M-1, M-2, M-3, M-6), and new breakage in the fix diff (`review-task-10-fix1.diff`). Read-only. No project file was edited, and no subagent was used.

Checks run:
- `src/webhooks.js` and `test/webhooks.test.js` in the project are byte-identical to `snap/task-10-fix1-head`, so the diff reviewed is the code under test.
- Focused run: `node --test test/webhooks.test.js` gave 29 pass, 0 fail (the one file, on the node on PATH). The full suite was not re-run.
- Scratch check of `readRawBody` on a request that was already destroyed or already ended before the call: `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\rereview1\closed-req-check.mjs`. Used to confirm N-1 below.

## Finding verdicts

**I-1 (future-stamped event): ADDRESSED.**
- The skip is kept and nothing is clamped: `src/webhooks.js:229` tests `Date.parse(event.receivedAt) > now() + MAX_FUTURE_MS`, and `:237` `continue`s without storing. The skip is still needed, because `src/events.js:250` refuses a time more than five minutes ahead.
- Each skip is counted: `counts.futureSkipped += 1` at `:230`. The count reaches the delivery line at `:224` and `:258`.
- Each skip writes one audit line at `:231-236`: `action webhook.event_skipped`, `target event.id`, `detail { kind, reason: 'received_time_ahead', receivedAt }`. No text is written.
- Test `test/webhooks.test.js:340` ("a message over five minutes ahead is not stored, is counted and is audited without its text"): stored set is `['m-ok']`, the audit line has target `m-ahead`, kind `message`, reason `received_time_ahead`, delivery `futureSkipped: 1`, and the text string is absent from the whole audit output.

**I-2 (attachment-only message): ADDRESSED.**
- `src/webhooks.js:119` sets `text = message.text ?? ''`. A non-string text such as `42` still fails the check at `:121` and is counted unknown.
- Non-message items stay unknown. `storable` at `:120` requires `hasMessage`, and a reaction, read or postback has no `message` object, so it falls to `:121-123`.
- The store accepts an empty string: `src/events.js:245` checks only `typeof input.text !== 'string'`, and `maskRegistered('')` returns `''`.
- Test `test/webhooks.test.js:375` ("an attachment-only message ... is stored as a message with empty text") checks the image is stored with `text ''` and the numeric-text item is unknown.
- Test `test/webhooks.test.js:359` now asserts only the reaction, read and postback items, with `unknown: 3`. The comment-without-sender and live-comment cases still assert `unknown: 2`.

**I-4 (unbounded body read): ADDRESSED.**
- `src/webhooks.js:288-291`: once `total > 2 * limit`, the request is paused (`:289`), not destroyed, and the promise rejects with `status: 413` (`:284`, `:290`). Reading stops after one further limit's worth of bytes.
- `src/webhooks.js:293-297`: a body over the limit but under twice the limit is read to its end and then rejected with 413 (`:297`). Both 413 paths are reachable.
- `src/webhooks.js:300-309`: late `error` and `close` events are absorbed by the `settled` guard (`:277-279`), so a late error cannot become unhandled.
- Test `test/webhooks.test.js:440` covers the exact-limit body (read) and one byte more (413). Test `:448` covers a stream of 10,000 chunks of 100 bytes: it is refused with 413, and only 22 chunks were read (the test asserts fewer than 100). The bound is loose, since a cut-off at about nine times the limit would still pass. The brief asks only that "the count is small", so this is noted and not counted against the item.

**M-1 (unknown counts discarded): ADDRESSED.**
- `parseEvents` returns `unknown`, `unstoredMentions` and `oddFlags` (`src/webhooks.js:166`).
- The handler builds `counts = { unknown, futureSkipped, mentionsUnstored }` at `:224` and writes one `webhook.delivery` line with those counts only, at `:258`.
- Every audit line in the fix carries only ids, kinds, reasons, flag names and counts: `:231-236`, `:243-247`, `:251-255`, `:258`.
- Tests: `test/webhooks.test.js:270` asserts the delivery detail `{ unknown: 0, futureSkipped: 0, mentionsUnstored: 1 }`. `:340` asserts `futureSkipped: 1`. `:225` asserts `unknown: 1`.

**I-3 (mention without a sender, ruling): ADDRESSED.**
- `src/webhooks.js:142-150`: a mention with an id and no sender goes to `unstoredMentions` and is not stored. A mention with a sender and no string text still goes to `unknown` (`:151-153`), as before.
- `src/webhooks.js:242-249`: one audit line per mention, `action webhook.event_skipped`, `target mediaId ?? commentId`, `detail { kind: 'mention', reason: 'no_sender', mediaId, commentId }`.
- Counted as `mentionsUnstored` at `:224`.
- Test `test/webhooks.test.js:270` covers the store, the audit line, and the count.

**M-2 (`message_edit` with `isSet`): ADDRESSED.**
- `src/webhooks.js:120` uses `!isSet(item.message_edit)`. `isSet` at `:39-41` treats `null` and `false` as not set.
- Test `test/webhooks.test.js:225` stores a message with `message_edit: null`. Test `:196` still counts a real edit as unknown.

**M-3 (non-boolean flag, ruling): ADDRESSED.**
- `src/webhooks.js:105-114`: for each of `is_echo`, `is_self` and `is_deleted`, a value on the item or on the message that is not a boolean makes the item unknown (`:109`) and records `{ id, flag }` in `oddFlags` (`:110`). The `return` comes before the echo and self skip at `:115`, so the item is not skipped.
- Audit at `:250-256`: `reason non_boolean_flag`, `flag` name only, never the value.
- Test `test/webhooks.test.js:225`: `is_self: 'false'` gives `unknown: 1`, `oddFlags [{ id: 'm-odd', flag: 'is_self' }]`, an audit line, and a delivery line with `unknown: 1`. A boolean `is_self: false` with `message_edit: null` is stored.

**M-6 (tests): ADDRESSED.**
- GET through the handler: `src/webhooks.js:204` calls `verifyChallenge`. Test `test/webhooks.test.js:120` checks the echoed challenge (200, `'777'`) and a wrong token (403).
- Dedupe across a restart: test `test/webhooks.test.js:169` opens a second handler, state, event log and audit log over the same files, redelivers, and asserts 200 with one stored event.
- The drain bound that M-6 said was missing is covered by `:448`.

## New breakage in the fix diff

**N-1. Minor. `src/webhooks.js:270-310` (`readRawBody`).** The `data`, `end`, `error` and `close` listeners are attached without checking whether the request is already closed or already ended. A request that was destroyed or fully consumed before the call never settles. The scratch check gave: destroyed before attach, pending after 1 s; ended before attach, pending after 1 s; normal stream, resolved with 3 bytes. The old `for await` loop rejected a destroyed stream and resolved an ended one with an empty body, so this is a new hang introduced by the fix. It is not a fail-open path: an empty or truncated body is rejected by the signature check, and a pending promise holds no socket. It is reachable only if Task 15 awaits something before the call, or the request closes first. Suggested fix: at the top of the executor, reject when `req.destroyed` is set, and resolve or reject from `req.readableEnded`. Task 15 should also call `readRawBody` before its first `await`.

Checked and clean:
- Wrong kind: every stored message has kind `message` (`src/webhooks.js:125`); comments and mentions keep their kinds (`:137-142`, `:151`).
- Non-message item stored as a message: none. `storable` needs `hasMessage` (`:120`).
- Skipped and not counted or not audited: the future skip, the unstored mention and the odd flag are each counted and audited. The echo and self skip and the dedupe skip are not, but they are not new (see observations).
- Audit line with message text: none found in any of the four audit writes.
- Body read that can run unbounded: none. Chunks are kept only up to `limit`, and reading stops at `2 * limit`.
- 413 path not reachable: none. Both paths are reachable (`:290` and `:297`).
- Non-boolean flag still silently skipped: none. Every non-boolean value on a deciding flag returns through `:109-111`.
- Fail-open: none found. `verifyChallenge` (`:65-73`), `verifySignature` (`:77-84`), the JSON parse (`:210-215`) and `readRawBody` (rejects on `error` and on `close` before `end`) all fail closed.

## Out-of-scope observations

- Echo and self items are skipped silently, with no count and no audit line (`src/webhooks.js:115`). This is the brief's behaviour and is unchanged by the fix. A count would show the owner's own outbound volume.
- Deduped redeliveries are skipped silently (`:239`). This is expected for Meta's retries.
- A POST with a bad or missing signature writes no audit line (`:206-208`), so forged deliveries leave no trace. No item asked for this.
- Null on a deciding flag (`is_echo`, `is_self`, `is_deleted`) makes the message unknown and not stored (`:108-112`). Ruling M-3 requires this, but if Meta ever sends `null` on an ordinary inbound message, that message is lost from the event log. The audit line per message would show it. This belongs with ruling 4 as a live-phase check.
- Future-stamped messages are never stored, so their text is lost. The audit line keeps only the id. This follows ruling I-1. The root cause is host clock skew, so the `futureSkipped` count is the only live signal.
- Audit writes are synchronous per line (`src/audit.js:27-28`: `mkdirSync` and `appendFileSync` on every record). A signed delivery of many skipped items makes one sync append per item. Only signed deliveries reach this code, so the exposure is low.
- Audit lines are not idempotent across Meta retries. If a delivery throws part way (an append or an audit write fails), the per-skip lines repeat on the retry. The event log itself stays retry-safe, because `hasId` skips stored events.
- Task 15 carry-forwards: after the 413 the request stays paused (`src/webhooks.js:289`) and must not be resumed or drained. Send the 413 with `Connection: close`. `readRawBody` sets no idle timeout, so server timeouts bound a slow body. Pass the audit log, a clock shared with the event log (M-8), and an explicit byte limit (M-9).
- Task 13 carry-forwards: do not auto-reply to empty-text messages (I-2), and skip the owner's own comments (ruling 1).
- The live shapes of `entry.time`, of mentions and of comments remain unverified until the live phase (ruling 4). The Node 22 run is still a Task 18 item. The focused run above used the node on PATH.

## Round verdict

All eight items are ADDRESSED. The fix introduces no Critical or Important breakage. One Minor item is open: N-1 (`readRawBody` hangs on a request that is already closed or ended). It can be fixed in this round or carried to Task 15, at the controller's choice.

- Critical: 0 new
- Important: 0 new
- Minor: 1 new (N-1)
