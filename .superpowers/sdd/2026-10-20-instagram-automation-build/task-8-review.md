# Task 8 review: Graph endpoints for messaging

Scope: task-8-base to task-8-head. Reviewed: `src/graph/endpoints/messaging.js` (200 lines) and `test/endpoints-messaging.test.js` (257 lines). The project copies match the head snapshot (cmp). `src/graph/client.js` and `src/graph/endpoints/common.js` were read only for the named risks: retry, path validation and id checks. The suite was not re-run. One focused check was run: `Date.parse` on impossible ISO dates (Node v24.6.0).

## Spec compliance

Overall: ❌ on one finding (I-1, the window parser accepts impossible calendar days). Every other item in the brief and the named constraints is met.

- ✅ `conversationsList`: GET `{igUserId}/conversations` with `platform=instagram`, `user_id` only when given, default limit 20 (messaging.js:115-117). Returns `[{ id, updatedTime }]` (:120). Tests at test:95-110.
- ✅ `conversationMessages`: GET the conversation with `fields=messages` (:128). Limit must be 1 to 20 (:127), and only the first `limit` ids are kept (:131). Each message is then read with `fields=id,created_time,from,to,message` (:16, :133-136). Returns `{ id, createdTime, fromId, toId, text }` (:88-97). Test at test:128-148 asserts 21 calls and 20 results.
- ✅ `sendMessage`: all validation runs before the client is called (:143-145). The POST goes to `{igUserId}/messages` with `json: { recipient: { id }, message: { text } }` (:146-148).
- ✅ `privateReply`: POST with `json: { recipient: { comment_id }, message: { text } }` (:158-160). The same text check runs first (:157).
- ✅ 1000-byte limit: `Buffer.byteLength` (:43), refused as VALIDATION before any request (:44-45). Multi-byte cases at test:47-63.
- ✅ No retry on writes: both sends call `client.post` with two arguments (:146, :158), so `options` defaults to `{}` (client.js:217) and `retryable` is false (client.js:228). The real-client test at test:234-257 pins one send for HTTP 500 and HTTP 429. I read the code path; I did not re-run the test.
- ✅ A write without the success marker is an error: `sentMessageId` (:101-107) requires a non-empty string `message_id`. A 2xx with no body is API_ERROR through `responseObject` (common.js:17-22). Test at test:75-84.
  - ⚠️ That `message_id` is the right success marker for Instagram sends (the send response has no `success` field) rests on the report's Context7 citation. It was not re-checked here. The live phase confirms.
- ✅ `messageWindowOpen`: `null` gives false (:191). The check is `elapsed < 24h` (:192), so exactly 24 hours is closed. Test at test:197-200.
- ✅ `privateReplyOpen`: `null` gives false (:198). The check is `elapsed < 7 days` (:199), so exactly 7 days is closed. Test at test:215-218; the brief's "false at 7 days" is in this test under a longer name.
  - Note: global-constraints.md line 11 refuses a private reply when the comment is "more than 7 days old", which would allow exactly 7 days. The brief and this module close at 7 days, which is stricter. The module follows the brief. The ledger should record this ruling. It is not a defect.
- ✅ Fail-open paths, checked one by one:
  - A `null` last inbound time reads as closed (:191).
  - Missing ids are API_ERROR (:53-54, :103-105, :117-120; common.js:17-22).
  - Ids and limits are not coerced: ids must be digit strings (common.js:9-14) and limits must be integers (:23-28). Tests at test:86-93 and test:111-121.
  - A non-string or unparseable time is VALIDATION (:174-175).
- ❌ "A timestamp that does not parse must not read as recent": `parseTime` (:173-180) accepts impossible calendar days, and `Date.parse` moves them to a later date. See I-1.
- ⚠️ `created_time` and `updated_time` may be UNIX timestamps, per the report's Context7 citation. A UNIX value passes `requiredString` (:84, :92), and then the window check throws VALIDATION (:175). That is loud, not fail-open. Live phase.
- ⚠️ Message id characters: `REF_PATTERN` (:19) and the client's `PATH_PATTERN` (client.js:19) allow only `[A-Za-z0-9_.-]`. Live ids containing `=`, `+`, `/` or `$` would fail the read. See m-3.
- ✅ Tests: the six brief tests are present by content. Tests use a fake client (test:29-45) and a fake fetch (test:234 onward), so no network call is made.

## Strengths

- Every input is checked before any request. Ids must be digit strings, limits must be integers, and text must be a non-blank string within the byte limit (messaging.js:23-48; common.js:9-14). Nothing is coerced.
- The byte limit uses `Buffer.byteLength` on the exact string that is sent (messaging.js:43-45, :147, :159). The multi-byte boundary tests are exact.
- Writes cannot be retried. Neither send passes an options argument, and the client retries only when `retryPost === true` (client.js:228). The real-client test covers 500 and 429.
- A send counts as done only when `message_id` is a non-empty string (messaging.js:101-107). The comment at :99-100 explains why `responseConfirmed` is not reused.
- The window checks use strict `null` handling and strict `<` comparisons (messaging.js:191-192, :198-199), with boundary tests on both sides of 24 hours and 7 days.
- The module reuses `checkId` and `responseObject` from common.js and changes no shared file. The snapshot diff contains only the two new files.

## Issues

### Critical

None.

### Important

**I-1. An impossible calendar day is coerced into a later date, which can open a closed window (fail-open).**
messaging.js:173-180 (`parseTime`), used by `messageWindowOpen` (:192) and `privateReplyOpen` (:199). The regex at :21 checks the shape only, and then `Date.parse` is called on the text. Checked on Node v24.6.0:
- `2026-02-30T10:00:00Z` parses to 2026-03-02T10:00Z.
- `2026-09-31T12:00:00Z` parses to 2026-10-01T12:00Z.

The parsed time is later than the written one, so the elapsed time is shorter and a closed window can read open. Example: with `now` = 2026-10-02T11:00Z, `lastInboundAt` = `2026-09-31T12:00:00Z` is 23 hours old, so `messageWindowOpen` returns true. Month 13, hour 25, and minute or second overflow are refused as NaN, so only day-of-month overflow leaks through.

Exposure: an impossible date must come from upstream, and Graph should not send one. So this is a defect on a safety gate, not a live incident. The report's claim that "nothing is coerced" (Self-review and Behaviour) is not true for this input.

Fix: after the regex matches, check the day against the length of its month:
```js
const [year, month, day] = match[1].slice(0, 10).split('-').map(Number);
if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
  throw new IgError('VALIDATION', `${name} is not a real calendar date`);
}
```
Add tests: `2026-09-31T12:00:00+0000` and `2026-02-29T12:00:00Z` (2026 is not a leap year) both throw VALIDATION, and `2028-02-29T12:00:00Z` is accepted. The check was run on Node v24.6.0; the engine floor is Node 22.12, so the new test should be confirmed on that version.

### Minor

**m-1. A dot-only id passes the local check and is refused later by the client.**
messaging.js:19 (`REF_PATTERN`), used at :31 and :53. `.` and `..` match the pattern. The client refuses them as VALIDATION (client.js:164). So a Graph message id of `..` makes `conversationMessages` throw VALIDATION instead of API_ERROR. Fix: `/^(?!\.+$)[A-Za-z0-9_.-]+$/`.

**m-2. A time a few seconds ahead of the local clock is refused, not treated as recent.**
messaging.js:183-186 refuses any `past > now`. `events.js:25` and `:250` accept a received time up to 5 minutes ahead. So a message can enter the log and then make the `dmSend` window check throw for up to 5 minutes, and a comment that arrives just ahead of the local clock makes `privateReplyOpen` throw VALIDATION. This is fail-closed and loud, which is why it is Minor. The report's concern 3 notes it. If Task 13 agrees, the fix is to treat a future time within the events' 5-minute allowance as elapsed 0, and to keep refusing anything further ahead. An unbounded future time must not read as open.

**m-3. ⚠️ Message ids containing `=`, `+`, `/` or `$` would break conversation reads (live check).**
messaging.js:19 and client.js:19, :163-166. The client refuses these characters in path segments and does not percent-encode them. Instagram message ids may be base64-like. If a live id contains one of these characters, `conversationMessages` throws for the whole thread (messaging.js:131-136). The fix belongs in the client (encode each segment), which is a Task 5 change. Decide it when the live phase reports.

**m-4. One malformed message fails the whole conversation read.**
messaging.js:88-93 and :131-136. A message with no `from` or no `created_time` throws API_ERROR for the entire call. The poller (Task 11) would then fail the same thread on every cycle. This is fail-closed by design. Consider skipping that one message and reporting it. This is a Task 11 decision, not a Task 8 change.

**m-5. A test name does not match its assertions.**
test:225 is named "with a +0000 offset", but the assertion at test:229 uses `+00:00`. Rename the test, or add a `+0000` case for `messageWindowOpen`.

**m-6. Carry-forward, not a Task 8 defect: inbound text must be marked untrusted.**
messaging.js:95 returns raw message text. The constraint "Event text is untrusted data. Every tool result that carries event text marks it `untrusted: true`" applies when Task 13 or 14 returns it. Task 13 must set `untrusted: true` on conversation message text. Add this to the Task 13 carry-forwards.

## Assessment

Task quality: **Needs fixes.** The send, read and window code meets the brief, and the writes cannot be retried. But `parseTime` accepts impossible calendar days and moves them to a later time, so a closed window can read open. The fix is a few lines plus three tests.

Spec verdict: ❌ (I-1 only). Counts: Critical 0, Important 1, Minor 6 (m-6 is a carry-forward, not a defect in this module).
