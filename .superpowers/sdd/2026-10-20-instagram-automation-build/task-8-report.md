# Task 8 report: Graph endpoints for messaging

Status: DONE_WITH_CONCERNS. The module meets the brief. The concerns are live-phase checks and one cross-module timing point, listed below.

## Rules followed

- R2: no commit, no git. The commit step is replaced by `npm test`, which exits 0.
- R3: nothing installed.
- R9: the test script is unchanged (`node --test test/*.test.js`).
- Writes: `sendMessage` and `privateReply` call `client.post` with no third argument, so `retryPost` is never passed. A test runs the real Task 5 client over a fake `fetch` and shows that a 500 or a 429 on a send is sent once. A mutation check confirmed that test fails when `retryPost: true` is added.
- Tests make no network call. The fake client records calls, and the one real-client test uses a fake `fetch`.
- Fail closed: bad limits, ids, times and text are refused with `VALIDATION`, and nothing is coerced. The 1000-byte limit uses `Buffer.byteLength` and is checked before any request.
- Shared helpers: `checkId`, `responseObject` from `src/graph/endpoints/common.js` are reused. `common.js`, `client.js` and the Task 6 and Task 7 endpoint files are not changed. `responseId` and `responseConfirmed` are not reused, for the reasons in Self-review.

## Context7 check

Library `/llmstxt/developers_facebook_instagram-platform_llms_txt` (Instagram Platform, High reputation). Findings:

- Send response: `{ "recipient_id": "IGSID", "message_id": "MESSAGE-ID" }`. There is no `success` field. The module uses `message_id` as the success marker.
- Send text: UTF-8, 1000 bytes or less.
- `GET /<IG_ID>/conversations` takes `platform=instagram` and an optional `user_id`. Each row has `id` and `updated_time`. The docs describe `updated_time` as a UNIX timestamp.
- `GET /<CONVERSATION_ID>?fields=messages` returns `messages.data`, each with `id` and `created_time`. The example shows `created_time` as a UNIX timestamp.

## TDD evidence

RED 1, test file written, module absent:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/graph/endpoints/messaging.js'
✖ test\endpoints-messaging.test.js
ℹ tests 1   ℹ pass 0   ℹ fail 1
```

The import failed, so no test had run. A stub was then added to `src/graph/endpoints/messaging.js`. Each export throws `not implemented`.

RED 2, against the stub:

```
ℹ tests 21
ℹ pass 0
ℹ fail 21
```

Every test failed with `Error: not implemented` raised from `notImplemented`.

GREEN 1, after the implementation:

```
✔ sendMessage refuses text over 1000 bytes before any request
✔ sendMessage accepts text of exactly 1000 bytes
✔ sendMessage posts the recipient and text as json, with no retryPost
✔ sendMessage refuses a send that Graph does not confirm
✔ sendMessage refuses blank text and bad ids before any request
✔ conversationsList requests platform=instagram
✔ conversationsList adds user_id when a user is given
✔ conversationsList refuses bad ids and limits before any request
✔ conversationsList refuses a row without an id or an updated time
✔ conversationMessages reads the message ids, then each message, at most 20
✔ conversationMessages refuses a limit over 20 or a non-integer limit before any request
✔ conversationMessages refuses a conversation with no messages edge, or a message with no sender
✔ privateReply sends recipient comment_id
✔ privateReply applies the same 1000-byte limit before any request
✔ privateReply refuses a reply that Graph does not confirm, and bad input before any request
✔ messageWindowOpen is true just inside 24 hours and false at 24 hours
✔ messageWindowOpen is false when there is no inbound message
✔ messageWindowOpen refuses a future, unreadable or non-string time rather than guessing
✔ privateReplyOpen is true just inside 7 days and false at 7 days
✔ privateReplyOpen is false when the comment time is unknown, and refuses a future one
✔ the windows read the Graph timestamp form, with a +0000 offset
ℹ tests 21   ℹ pass 21   ℹ fail 0
```

One more test was added after GREEN 1: `a send that fails with a retryable status is sent once, through the real client`. It passed on its first run, so it has no RED run of its own. It was checked by a mutation instead. `sendMessage` was temporarily changed to pass `{ retryPost: true }`. Two tests then failed:

```
✖ sendMessage posts the recipient and text as json, with no retryPost
✖ a send that fails with a retryable status is sent once, through the real client
AssertionError [ERR_ASSERTION]: HTTP 500 is not retried for a send
ℹ pass 20   ℹ fail 2
```

The file was restored from a saved copy, byte-identical, and the module passed 22 of 22 again.

Full suite, after the final edit (`npm test`, exit code 0):

```
ℹ tests 312   ℹ pass 312   ℹ fail 0
```

That is the 290 baseline from Task 7 plus 22 new tests.

## Files changed

- `src/graph/endpoints/messaging.js` (new)
- `test/endpoints-messaging.test.js` (new)

A diff of the project against `snap/task-8-base` lists only these two files. Nothing else changed.

## Behaviour

- `conversationsList({ igUserId, userId, limit = 20 })`: GET `{igUserId}/conversations` with query `{ platform: 'instagram', limit }`, plus `user_id` only when `userId` is given. The limit must be 1 to 100. Each row needs a path-safe `id` and a string `updated_time`. Only the first page is read.
- `conversationMessages({ conversationId, limit = 20 })`: GET `conversationId` with `fields: 'messages'`. The first `limit` ids are kept, and the limit must be 1 to 20. Each message is then read with `fields: 'id,created_time,from,to,message'`, one request at a time. A message needs a `created_time` string and a `from` id. `to` gives the first recipient id, or null. `message` gives the text, or null.
- `sendMessage({ igUserId, recipientId, text })` and `privateReply({ igUserId, commentId, text })`: the text must be a non-blank string of at most 1000 bytes, checked before any request. The POST body is `json`, as the brief specifies, and no options are passed. A response counts as confirmed only when `message_id` is a non-empty string. Otherwise the result is `API_ERROR`. The return values are `{ messageId, recipientId }` and `{ messageId, commentId }`.
- `messageWindowOpen({ lastInboundAt, now })` and `privateReplyOpen({ commentCreatedAt, now })`: `now` must be a finite number of epoch milliseconds. The time must be a string with a zone: `Z`, `+hh:mm`, or the `+hhmm` form that Graph writes. `null` gives false. A time after `now` is refused with `VALIDATION`. The comparison is strict, so 24 hours or 7 days exactly is closed.

## Self-review

I read the full module and test file against the brief, line by line.

- Every brief line is covered: the six named tests, the endpoints, the windows, and the 1000-byte rule.
- No unused imports or constants.
- Deliberate choices beyond the brief:
  - The success marker is `message_id`, not the `responseConfirmed` check on `success: true`. The docs confirm the send response has no `success` field, so reusing that check would fail every real send.
  - `responseId` is not reused, because it accepts only digit strings and Instagram message and conversation ids are not digits. The module has its own id check.
  - Ids used as path segments must match `/^[A-Za-z0-9_.-]+$/`, the same rule the client applies in `buildUrl`.
  - Blank text is refused, consistent with `commentReply`.
  - A message with no `from` is `API_ERROR`, because the poller needs the sender to tell inbound from outbound.
  - `null` for `lastInboundAt` or `commentCreatedAt` gives false. For `lastInboundAt` this is the brief's rule, and I applied the same to `privateReplyOpen`.
- Not in this module, as the brief assigns them to Task 13: the 24-hour check inside `dmSend`, the 7-day check inside `privateReply`, the one-reply-per-comment rule, and paging of conversations and messages beyond the first page.
- Mutation check: the `retryPost` mutation was caught by two tests, as described above.

## Concerns

1. Live phase, time format: the docs show `created_time` and `updated_time` as UNIX timestamps. The module passes them through unchanged. The events log (Task 3) and the window checks both need ISO times with a zone, so a UNIX value fails loudly at append or at the window check. It is not converted here. Confirm the format against the live API. If it is UNIX seconds, a conversion is needed in one place.
2. Live phase, id characters: ids must match `[A-Za-z0-9_.-]`. An id containing `=` or `+` makes the read fail with `API_ERROR` or `VALIDATION`. Check real message ids.
3. Window timing: events accepts a `receivedAt` up to 5 minutes ahead (`MAX_FUTURE_MS` in `src/events.js`). The window functions refuse any future time. So `dmSend` refuses for up to 5 minutes after such a message. The failure is loud and safe. Task 13 decides whether to accept that.
4. Left to Task 13, not checked in this module: the 24-hour window in `dmSend`, the 7-day window and one-reply-per-comment in `privateReply`, and paging. Conversation reads take only the first page, so older threads are not seen.

## Fix round 1 (review finding I-1)

Source: `task-8-review.md`, I-1 (Important). `parseTime` accepted an impossible calendar day. The shape regex passed, and `Date.parse` moved the date forward. Examples: `2026-09-31T12:00:00Z` became 1 October, and `2026-02-30T10:00:00Z` became 2 March. A closed window could therefore read open.

### What changed

- `src/graph/endpoints/messaging.js`, `parseTime`: after the shape regex matches, the year, month and day are read from the match. The day is checked against the length of its month with `new Date(Date.UTC(year, month, 0)).getUTCDate()`. A day beyond the month throws `VALIDATION` with the message `${name} is not a real calendar date`. The value is not echoed. Five lines in total.
- `test/endpoints-messaging.test.js`: three tests added, listed below. No other change.
- Not changed: m-1 to m-6 are left as they were, as instructed. Day 00, day 32, month 00 and month 13 were probed on Node 24 and are already refused as NaN by `Date.parse`, so no extra check was needed. Hour `24:00` is valid ISO for the next midnight, the same instant, so it stays as it is.

### Covering tests

1. `an impossible calendar day is refused, not moved to a later date`: `2026-09-31T12:00:00+0000` and `2026-04-31T12:00:00Z` throw `VALIDATION` through `privateReplyOpen`. The message names `commentCreatedAt`, says "not a real calendar date", and does not contain the value.
2. `February 29 is refused in a common year and accepted in a leap year`: `2026-02-29T12:00:00Z` throws `VALIDATION`. `2028-02-29T12:00:00Z` is accepted, and `messageWindowOpen` returns true one hour later.
3. `a window check given an impossible lastInboundAt throws, rather than reading open`: with `now` = `2026-10-02T11:00:00Z`, `messageWindowOpen({ lastInboundAt: '2026-09-31T12:00:00Z' })` throws `VALIDATION`. Before the fix it returned true.

### RED

Run against the unfixed `parseTime`, with the three tests in place:

```
ℹ tests 25
ℹ pass 22
ℹ fail 3
✖ an impossible calendar day is refused, not moved to a later date
✖ February 29 is refused in a common year and accepted in a leap year
✖ a window check given an impossible lastInboundAt throws, rather than reading open
```

### GREEN

After the fix, `node --test --test-reporter=spec test/endpoints-messaging.test.js`: `ℹ tests 25`, `ℹ pass 25`, `ℹ fail 0`.

Full suite, `npm test` (output saved at `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\npm-test-task8-fix1.txt`):

```
npm test exit=0
ℹ tests 315
ℹ suites 0
ℹ pass 315
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

That is the 312 from before this round, plus the three new tests.

### Probes, Node v24.6.0, through `privateReplyOpen` with `now` = 2026-10-21T12:00Z

| commentCreatedAt | result |
|---|---|
| 2026-02-28T12:00:00Z | false (accepted) |
| 2026-02-29T12:00:00Z | VALIDATION, not a real calendar date |
| 2026-09-30T12:00:00Z | false (accepted) |
| 2026-09-31T12:00:00Z | VALIDATION, not a real calendar date |
| 2026-04-31T12:00:00Z | VALIDATION, not a real calendar date |
| 2026-12-31T12:00:00+0000 | VALIDATION, after now (a valid date, but in the future) |
| 0096-02-29T12:00:00Z | false (accepted; year 96 is a leap year) |
| 0000-02-29T12:00:00Z | VALIDATION, not a real calendar date (see concern 1) |

### Self-review of the fix

- The arithmetic is right. `split('-')` gives a 1-based month, and `Date.UTC` takes a 0-based month. So `Date.UTC(year, month, 0)` is the last day of the 1-based `month`, as the probes show for February and for April and September.
- The check runs before `Date.parse`, so it does not rely on how a given engine handles impossible dates. That makes the behaviour the same on any Node version.
- The diff is limited to `parseTime` and the three tests.

### Concerns from this round

1. Year 0000 February 29 is refused, although it is a leap day. `Date.UTC` maps years 0 to 99 onto 1900 to 1999. The refusal is fail-closed. It is not a realistic input, and the coordinator's prescribed method causes it, so I kept the method.
2. Node 22.12 is not installed on this machine, only Node 24.6.0, so the new tests have not run on Node 22. The new check does not depend on `Date.parse` leniency, so the result should match. Please confirm on Node 22.

## P3 (2026-10-22): real paging, truncation, per-message tolerance, numeric timestamps

Status: DONE_WITH_CONCERNS (the live checks listed under Concerns).

`npm test`: exit 0, **901 of 901 passing**. The count before P3 was 864 (the ledger's P2 total). P3 adds 37 tests and removes none. Eleven existing tests changed (old and new assertions below).

Files outside the package's list were not touched: `src/poller.js`, `src/webhooks.js`, `src/state.js`, `src/events.js` and `src/guard.js` are byte-identical to `snap/p2-fix-head`. `src/tools.js` and the README were not edited.

### Changes, by file

**1. `src/graph/paging.js` (new, 66 lines)**
- Constants: `DEFAULT_MAX_PAGES = 10` (line 8) and `DEFAULT_MAX_ITEMS = 1000` (line 9). Ceilings of 100 pages and 10000 items (lines 11 to 12). The two fixed reason texts are on lines 14 and 15.
- `nextCursorOf(body, what)` (line 26): reads the cursor only when `paging.next` is present. A next link with no cursor is `API_ERROR`. The next link itself is never read.
- `withCursor(query, cursor)` (line 37): adds `after` only when a cursor is given.
- `readAllPages({ fetchPage, maxPages, maxItems, keyOf })` (line 48): calls `fetchPage(after)`, which returns `{ items, nextAfter }`. It stops when `nextAfter` is null. It stops with `truncated` true and the page reason at `maxPages`, and with `truncated` true and the item reason at `maxItems`. `keyOf` drops a repeated item, and a repeat does not count toward `maxItems`. The result is `{ items, truncated, reason, nextAfter }`.

**2. `src/graph/endpoints/messaging.js`**
- Import (line 8). Constants (lines 20 to 23): `DEFAULT_THREAD_ITEMS` and `MAX_THREAD_ITEMS` at 1000; `MAX_TIME_MS` (line 23) is the last millisecond of year 9999.
- `unixMs` (line 76): a Unix number below 1e12 is seconds, and one at or above 1e12 is milliseconds. Zero, a negative number, a non-finite value and a value past year 9999 are malformed.
- `graphTimeIso` (line 86): accepts a number, a numeric string (`^\d+(\.\d+)?$`), or an ISO string with a zone (through `parseTime`, which checks the calendar day). Any other value is malformed, as `API_ERROR`. Output is `new Date(ms).toISOString()`.
- `isoTimeOrNull` (line 106): absent or blank is null. A present value goes through `graphTimeIso`. Used by the paged reads.
- `rawTimeOrNull` (line 115): the first-page reads only. A time is passed through as text, as it was before P3. A present non-text value is `API_ERROR`, as before.
- `readRow` (line 124): a shape failure (`API_ERROR`) is counted as skipped and gives null. Any other error is rethrown.
- `normaliseConversation` (line 153) and `normaliseMessage` (line 162) take the time function as a parameter. The default is `isoTimeOrNull`. The first-page reads pass `rawTimeOrNull`.
- `conversationsList` (line 186) and `conversationMessages` (line 201): the first-page reads kept for `poller.js` until P4. Their behaviour is unchanged, apart from the comment on line 184.
- `readConversations(client, { igUserId, userId, limit, maxPages, maxItems })` (line 220): paged through `readAllPages`, keyed by id. Returns `{ items, skippedConversations, truncated, reason, nextAfter }`.
- `readThread(client, { conversationId, maxPages, maxItems })` (line 262): paged through the messages edge (`fields=messages`, with `after` on later pages). Each message is read by id, one at a time. A malformed message, or an edge row with an unusable id, is skipped and counted in `skippedMessages`. A failed request is not skipped. `maxItems` must be 1 to 1000. Returns `{ items, skippedMessages, truncated, reason, nextAfter }`.
- Removed: `requiredString`. Its only caller was the old time check.

**3. `src/graph/endpoints/media.js`**
- Import (line 5). `mediaList` (line 73) is paged through `readAllPages`, keyed by id. `after` is the start cursor, and `limit` is the page size (1 to 100, unchanged). `maxPages` and `maxItems` are optional. Returns `{ items, truncated, reason, nextAfter }`. Truncation follows `paging.next`, not the page length.

**4. `src/graph/endpoints/comments.js`**
- Import (line 6). `commentsList` (line 34) is paged, keyed by id, with the same result shape. `ownedMediaIds` (line 105) is paged and returns `{ ids: Set, truncated, reason }`, not a bare Set.

**5. `src/graph/endpoints/discovery.js`**
- `NESTED_REASON` (line 15). `withoutNestedPaging` (line 19) removes the `paging` of a nested edge, because its next link holds the token, and sets `truncated` when that edge has a next page. `businessDiscovery` (line 36) returns `truncated` and `reason` as well. `missingFields` is unchanged.

**6. `src/service.js`, the read paths and the owned-media helper they use**
- Imports: `conversationMessages` and `conversationsList` are removed. `readConversations` and `readThread` are added (lines 38 and 39).
- Constants (lines 49 to 53): `OWNED_PAGE = 100` (was `OWNED_LIMIT`), `CONVERSATION_PAGE = 100` (was `CONVERSATION_LIMIT`), `DM_MESSAGES_MAX = 1000` (was `DM_PAGE = 20`). `COMMENT_PAGE` is unchanged.
- `ownedSetOf` (line 448) returns `{ ids, truncated, reason }`. `notOwnedMessage` (line 459) is new: a truncated list is named in the refusal. `requireOwnedMedia` (line 465) and `ownedParentOf` (about line 480) use `owned.ids` and `notOwnedMessage`.
- `commentsList` (line 930): `truncated` and `reason` come from the paged read. The page-length rule is removed.
- `dmConversations` (line 940): reads through `readConversations`. Returns `skippedConversations`, `truncated` and `reason`.
- `dmMessages` (line 956): `limit` is checked before any request (1 to 1000; null means the default). The conversation lookup uses `readConversations` with `maxPages: 1`, and an empty lookup gives an empty list. Messages come from `readThread` with `maxItems`. Returns `messages`, `skippedMessages`, `skippedConversations`, `truncated` and `reason`.

Note on the service diff: `diff` against `snap/p2-fix-head` also shows P2 round-2 edits (`watchRequests`, `earlierReached`, and the README). Those were made after that snapshot, and round 2 left no snapshot of its own. They are not P3 changes.

### New tests (37)

- `test/paging.test.js` (new, 11): `readAllPages follows paging.next with the after cursor, and collects every page`; `maxPages stops the read and reports truncated, with the cursor of the page that was not read`; `a full page with no paging.next is not truncated`; `a short page with a paging.next is truncated, because truncation follows the next link, not the page length`; `maxItems stops the read and reports truncated when items remain beyond it inside a page`; `maxItems reached exactly at the end of a page with a next page is truncated, and gives the next cursor`; `keyOf drops an item already seen on an earlier page, and a duplicate does not count toward maxItems`; `readAllPages refuses bad bounds, a bad fetchPage and a bad page shape, and requests nothing for the bounds`; `the defaults are 10 pages and 1000 items`; `nextCursorOf reads the cursor only when paging.next is present, and refuses a next link with no cursor`; `withCursor adds after only when a cursor is given`.
- `test/endpoints-messaging.test.js` (11): `A-25 the four time forms of one instant give the same ISO string in UTC, for a conversation and a message`; `A-25 a time that is not a number, a numeric string or an ISO time with a zone is malformed: skipped and counted`; `A-21 one malformed message in a thread gives the other messages and skippedMessages 1, and never stores a guessed time`; `A-21 a message with no sender, and an edge row with an unusable id, are skipped and counted, and the thread is kept`; `A-21 a message with no created_time keeps createdTime null, and is not counted as skipped`; `readThread follows the messages paging with the after cursor, and never requests the next link`; `readThread stops at maxItems and reports truncated; a maxItems outside 1 to 1000 is refused before any request`; `readConversations follows paging.next, keeps limit and user_id on every page, and never requests the next link`; `a malformed conversation row is skipped and counted in skippedConversations, and the others are kept`; `the first-page conversationMessages read still refuses a whole thread on a structurally malformed message, as the poller expects until P4`; `the first-page conversationMessages read passes a time through as text, for the poller to decide`.
- `test/endpoints-media.test.js` (4): `P3 A-15 a short page with a paging.next is truncated, and a full page with no next is not`; `P3 A-15 mediaList stops at maxPages and reports truncated, with the cursor of the page that was not read`; `P3 A-15 mediaList stops at maxItems and reports truncated when items remain beyond it`; `P3 mediaList refuses a maxPages or maxItems out of range before any request`.
- `test/endpoints-social.test.js` (5): `P3 A-15 commentsList follows paging.next with its cursor, and never requests the next link`; `P3 A-15 a short comments page with a next link is truncated, and a full page with no next is not`; `P3 A-15 commentsList stops at maxItems and reports truncated when comments remain beyond it`; `P3 A-15 ownedMediaIds reads each page up to maxPages, and reports truncated when more media exist`; `P3 a nested edge with paging is returned without its next link, and sets truncated`.
- `test/service.test.js` (6): `(d) commentsList reads a thread that ends, and a full page with no next link is not truncated`; `M-11 (P3) a thread of two full pages with no next link on the second is read in full, and is not truncated`; `M-11 (P3) a thread with more pages than the page limit is truncated at ten pages, and the reason names the page limit`; `P3 A-21 dmMessages with a limit stops at that many messages and reports truncated by item`; `P3 A-21 dmConversations returns the conversations, the count of skipped rows, and the paging state`; `P3 A-15 a truncated owner media list refuses a media outside it, and the refusal says the list was truncated`.

### Changed existing tests (11): old and new assertions

1. `test/endpoints-media.test.js`: `mediaList passes limit and after, and returns the cursor when a next page exists` is renamed `mediaList passes limit and after, and follows the next page with its cursor`. Old: one page, and `client.calls[0].query` equal to `{ fields, limit: 10, after: 'after-1' }`, with `page.nextAfter === 'after-2'`. New: two requests (`after` `'after-1'`, then `'after-2'`), `page.items` has both media, `truncated` false, `reason` null, `nextAfter` null, and the next link's token is absent from every request.
2. `test/endpoints-social.test.js`: `commentsList requests the comment fields and normalises each row`. Old: `deepEqual(result, { items: [...] })`. New: the same, plus `truncated: false, reason: null, nextAfter: null`.
3. `test/endpoints-social.test.js`: `ownedMediaIds returns a Set of ids` is renamed `ownedMediaIds returns a Set of ids, in an object with truncated and reason`. Old: `ids` is the Set; `ids instanceof Set`, `ids.size`, `ids.has(...)`. New: `owned.ids` is the Set, with the same checks, and `[owned.truncated, owned.reason]` equal to `[false, null]`.
4. `test/endpoints-social.test.js`: `ownedMediaIds returns an empty Set when the owner has no media`. Old: `ids.size === 0`. New: `owned.ids.size === 0`.
5. `test/endpoints-social.test.js`: `businessDiscovery builds the business_discovery field expression`. Old: `deepEqual(result, { ...profile, missingFields: [] })`. New: adds `truncated: false, reason: null`.
6. `test/endpoints-social.test.js`: `A-17 businessDiscovery lists each requested field the response lacks, and does not throw`. Old: `deepEqual(result, { followers_count: 120, missingFields: ['media_count'] })`. New: adds `truncated: false, reason: null`.
7. `test/service.test.js`: `(d) commentsList refuses another media, and reports when only the first page is read` is renamed `(d) commentsList refuses another media, and reports truncated when more pages exist beyond the page limit`. Old: 25 comments with no next link gave `truncated` true, with a reason that matched `/first page/`, and `limit: 30` gave `truncated` false. New: pages that always carry a next link give 10 comments, `truncated` true, and the reason `'more pages exist beyond the page limit'`.
8. `test/service.test.js`: `(h) dmMessages looks up the conversation by recipient and takes the first id`. Old: `deepEqual(result, { messages: [], truncated: false, reason: null })`. New: adds `skippedMessages: 0, skippedConversations: 0`.
9. `test/service.test.js`: `(h) dmMessages with no conversation for the recipient gives an empty list, not an error`. Old: `deepEqual(..., { messages: [], truncated: false, reason: null })`. New: adds `skippedMessages: 0, skippedConversations: 0`.
10. `test/service.test.js`: `M-11 a full page of 20 messages is returned with truncated true and a reason that says the page may be partial` is renamed `M-11 a full page of 20 messages with no next link is not truncated (P3: truncation follows paging.next)`. Old: `truncated === true`, and `reason === 'may be truncated: a full page of 20 messages, the first page only'`. New: `truncated === false`, and `reason === null`. The fixture is unchanged.
11. `test/service.test.js`: `businessDiscovery returns the result marked untrusted, because it is another account's data`. Old: `deepEqual(found, { id, username, followers_count, missingFields: [], untrusted: true })`. New: adds `truncated: false, reason: null`.

The first-page messaging pins from Task 8 (`conversationsList`, `conversationMessages`) were briefly changed during the work, then restored to their original assertions when the first-page path was made to keep raw times. Net change to them: none.

### Behaviour kept

- `poller.js` is unchanged. It still uses the first-page readers, and its tests pass without change.
- Events dedupe (`hasId`) is unchanged. The paged reads add their own dedupe by id, which is new.
- The owner-media check keeps its membership rule. The set is larger, and a refusal now says when the list was truncated. This changes the text of a write-path refusal, which was "in the first 100 read". The owner-check tests match on the error kind only.
- `missingFields` in business discovery, and `REPLIED_LIMIT` (500), are unchanged.

### Self-review

- Read each hunk of the endpoint and service diff against the request. The one defect found was on the first-page path: the shared normaliser converted times, so `poller.js` tests changed behaviour (`'1792583940'` was skipped and audited, and it is now valid Unix time). The fix splits the time function, so the first-page path keeps raw times as before. Two poller tests then passed again without any change to them.
- `paging.js` was checked for: a next link never read; an opaque cursor passed through unchanged; `paging.next` required before a request for more.
- Tests for the four time forms check the same instant. A test covers one malformed item in a thread, and each malformed-time form.

### Concerns and live checks

1. Thread paging sends `after` as a top-level query parameter on the conversation node with `fields=messages`, as the coordinator's rule specifies. Graph's documented form for a field edge is `messages.after(CURSOR)`. Check it live. If Graph ignores `after`, the first page repeats, duplicates are dropped, and the thread reports `truncated` at the page limit, so the failure is visible, not silent.
2. Effective bounds are below the documented 1000. Comments and media pages default to 25, so the default reach is 10 pages of 25, or 250. The messages edge uses Graph's default page size, because `fields=messages` is sent verbatim. Each message is then read by id, so a full thread costs up to 1000 sequential requests. The owner should decide whether to raise the page sizes.
3. Documents still describe the old behaviour, and are outside this package's file list: the README read-limit rows (lines 131 to 135) and the "Reads and paging" section (lines 394 to 399), and the "first page" wording in the `src/tools.js` descriptions of `ig_media_list`, `ig_comments_list`, `ig_dm_conversations` and `ig_dm_messages`. The README also differs from `snap/p2-fix-head` because someone edited it after that snapshot. P3 did not touch it. These belong to P7.
4. Until P4, `poller.js` uses the first-page readers. Those keep the old whole-thread failure on a structurally malformed message, and they do not count skipped items. P4 must move the poller to `readConversations` and `readThread`, and use `skippedConversations` and `skippedMessages`.
5. The owner-media set can now hold up to 1000 ids. An owner with more media makes up to 10 extra requests per comment action, and the refusal text for a media beyond the set now names the truncation.

### P3 fix round (controller rulings 1 and 2)

Status: DONE_WITH_CONCERNS (the live checks below).

`npm test`: exit 0, **902 of 902 passing**. Before this round the count was 901. The round adds one test and removes none.

The protected files are still byte-identical to `snap/p2-fix-head`: `src/poller.js`, `src/webhooks.js`, `src/state.js`, `src/events.js` and `src/guard.js`.

#### Ruling 1: the thread cursor goes on the messages edge

Old behaviour (removed). `readThread` (messaging.js) read the conversation node, `GET {conversation-id}` with `fields=messages`. The node returned `messages.data` and `messages.paging`. The second page was the same node request with `after` set: `{ fields: 'messages', after: 'e2' }`.

New behaviour. `readThread` (messaging.js line 266) reads the messages edge, `GET {conversation-id}/messages`, with `{ fields: 'id', limit: 100 }`. The next page adds `after` to that edge request, through the normal client path (Bearer header, no token in the URL). The edge response carries `data` and `paging` at the top level, so `nextCursorOf(body)` reads them directly (line 285). Only the cursor is used, and the next link is never read. Each message is still read by id, one request at a time.

New test: `readThread follows the messages edge with the after cursor, merges the pages in order, and never requests the next link` (test/endpoints-messaging.test.js). The fake client records these calls: the edge page 1 (`fields: 'id', limit: 100`), `m1`, `m2`, the edge page 2 (`fields: 'id', limit: 100, after: 'e2'`), and `m3`. The merged items are `['m1', 'm2', 'm3']` in that order. No token appears in any request.

Fixtures moved to the edge, with the assertions unchanged:
- `test/service.test.js` helper `threadAnswers`: the key is `GET {conv}/messages`, and the body is `{ data, paging }` at the top level.
- `test/service.test.js` fixtures `GET t_1`, `GET t_first`, `GET t_full` and `GET t_short` became `GET t_x/messages` with `{ data: [...] }`.
- `test/endpoints-messaging.test.js` edge queues: `A-25 the four time forms…`, `A-21 one malformed message…`, `A-21 a message with no sender…`, `A-21 a message with no created_time…` and `readThread stops at maxItems…`. Each `{ messages: { data: [...] } }` became `{ data: [...] }`.

The legacy first-page `conversationMessages` (messaging.js line 208) still reads the node form, `fields=messages`, and it has no cursor. The poller uses it until P4 moves the poller to `readThread`.

#### Ruling 2: the largest page for each read

| Read | Old default page | New default page | Where |
|---|---|---|---|
| `mediaList` | 25 | 100 | `src/graph/endpoints/media.js` line 11 (`DEFAULT_LIMIT`) |
| `commentsList` | 25 | 100 | `src/graph/endpoints/comments.js` line 12 (`DEFAULT_COMMENT_LIMIT`); `src/service.js` line 51 (`COMMENT_PAGE`) |
| `dmConversations` | 100 | 100 (unchanged) | `src/service.js` line 54 (`CONVERSATION_PAGE`) |
| `readConversations`, used by `dmMessages`'s lookup | 20 | 100 | `src/graph/endpoints/messaging.js` line 224 (`limit = MAX_CONVERSATION_LIMIT`) |
| `dmMessages`, the messages edge | none (node) | 100 | `src/graph/endpoints/messaging.js` line 23 (`MESSAGE_PAGE`) |
| owner-media set | 100 | 100 (unchanged) | `src/service.js` line 49 (`OWNED_PAGE`); `ownedMediaIds` default |

With `maxPages` 10 and `maxItems` 1000, `dmMessages` now reaches the full 1000-message bound (10 pages of 100). The legacy first-page `conversationsList` keeps its default of 20, because the poller uses it until P4.

Changed tests, with old and new assertions:
1. `test/endpoints-media.test.js`, `mediaList normalises a missing media_url to null`: `assert.equal(client.calls[0].query.limit, 25)` became `assert.equal(client.calls[0].query.limit, 100)`.
2. `test/endpoints-social.test.js`, `commentsList requests the comment fields and normalises each row`: `assert.deepEqual(client.calls[0].query, { fields: COMMENTS_FIELDS, limit: 25 })` became `{ fields: COMMENTS_FIELDS, limit: 100 }`.
3. `test/endpoints-messaging.test.js`, renamed `readThread follows the messages paging with the after cursor, and never requests the next link` to `readThread follows the messages edge with the after cursor, merges the pages in order, and never requests the next link`. Old calls: `[CONVERSATION, { fields: 'messages' }]` and `[CONVERSATION, { fields: 'messages', after: 'e2' }]`, with items `['m1', 'm2']`. New calls: `[`${CONVERSATION}/messages`, { fields: 'id', limit: 100 }]` and `[`${CONVERSATION}/messages`, { fields: 'id', limit: 100, after: 'e2' }]`, with items `['m1', 'm2', 'm3']`.
4. `test/service.test.js`, `(f) comments, messages and mentions are marked untrusted`: fixture `'GET t_1': { messages: { data: [...] } }` became `'GET t_1/messages': { data: [...] }`. The assertions are unchanged.
5. `test/service.test.js`, `(h) dmMessages looks up the conversation by recipient and takes the first id`: fixture `'GET t_first': { messages: { data: [] } }` became `'GET t_first/messages': { data: [] }`. The check that no request reached the second conversation changed from `request.path === 't_second'` to `request.path.startsWith('t_second')`, because the edge request path now carries `/messages`.
6. `test/service.test.js`, renamed `M-11 a full page of 20 messages with no next link is not truncated (P3: truncation follows paging.next)` to `M-11 a page of 20 messages with no next link is not truncated (P3: truncation follows paging.next)`. The page is 100 now, so 20 is a short page. Fixture `'GET t_full': { messages: { data: [...20] } }` became `'GET t_full/messages': { data: [...20] }`. The assertions (`truncated` false, `reason` null) are unchanged.
7. `test/service.test.js`, `M-11 a page of fewer than 20 messages is not truncated`: fixture `'GET t_short': { messages: ... }` became `'GET t_short/messages': { data: ... }`. The assertions are unchanged.
8. `test/service.test.js`, renamed `(d) commentsList reads a thread that ends, and a full page with no next link is not truncated` to `(d) commentsList reads a thread that ends, and a page with no next link is not truncated`. The 25 comments are a short page of 100, so the name was wrong. The assertions are unchanged.
9. `test/service.test.js`, renamed `M-11 (P3) a thread of two full pages with no next link on the second is read in full, and is not truncated` to `M-11 (P3) a thread of two pages of 20 messages, the second with no next link, is read in full and is not truncated`. The assertions are unchanged.
10. `test/service.test.js`, helper `threadAnswers`: the key `GET {conv}` with `{ messages: { data, paging } }` became `GET {conv}/messages` with `{ data, paging }`.

New test: `P3 fix the paged conversation and message reads ask for pages of 100 by default`. Its assertions: `readConversations` sends `{ platform: 'instagram', limit: 100 }`, and `readThread` sends `{ fields: 'id', limit: 100 }` on its edge request.

Test pins of 25 or 20 on the paged reads are gone. The legacy first-page `conversationMessages` keeps its 20 (`test/endpoints-messaging.test.js`, `conversationMessages reads the message ids, then each message, at most 20`), because the poller still uses it.

#### Live checks for this round

1. Confirm that `GET {conversation-id}/messages` exists for Instagram conversations, with `fields=id`, `limit=100`, and `after` working on that edge. The docs cite the node form, and the edge form is the coordinator's ruling.
2. Each message is still read by id, one request at a time. A full 1000-message thread therefore costs up to 1000 sequential requests. That cost is accepted with ruling 2, and the owner may want to batch it later.

### P3 change: one page is one request (no per-message reads)

Status: DONE_WITH_CONCERNS (the live check below).

`npm test`: exit 0, **905 of 905 passing**. Before this change the count was 902. The change adds three tests and removes none.

The protected files are still byte-identical to `snap/p2-fix-head`.

Old behaviour (removed). `readThread` (messaging.js) read each page through the messages edge with `fields=id`, `limit=100`, and then made one request per message id, `GET {message-id}` with `fields=id,created_time,from,to,message`. A thread of 250 messages across three pages therefore made 3 edge requests and 250 per-id requests, 253 in all.

New behaviour. `readThread` (messaging.js line 265) reads each page with `GET {conversation-id}/messages`, `fields=id,created_time,from,to,message` and `limit=100` (line 269). `after` goes on the edge for the next page (line 273). Each row of the page is normalised in place (line 278), so the page is one request. A malformed row is skipped and counted, and the rest of the page is kept. A thread of 250 messages across three pages is now 3 requests and no per-id request. The per-id read at line 213 belongs to the legacy first-page `conversationMessages`, which the poller still uses until P4, and it is unchanged.

Tolerance. A malformed item in a page is skipped and counted in `skippedMessages`. Malformed means a missing or dotted id, a missing or non-text sender, or a present time that cannot be read. An absent `created_time` still gives `createdTime` null, and is not counted as skipped, as before.

New tests:
- `test/endpoints-messaging.test.js`, `P3 one page is one request: a thread of 250 messages across three pages makes three requests and no per-id request` (line 497). Its assertions: three calls, all on `{conversation}/messages`; `after` is undefined, `c1`, then `c2`; 250 items in order (`a0` first, `c49` last); not truncated.
- `test/endpoints-messaging.test.js`, `P3 a malformed item in a page is skipped and counted, and the rest of the page is kept` (line 519). Its assertions: items `['m1', 'm3']`, `skippedMessages` 1, one request.
- `test/service.test.js`, `P3 one page is one request through dmMessages: two pages make two messages-edge requests, and no per-message request` (line 1791). Its assertions: the GET paths are `OWNER/conversations`, `t_req/messages`, `t_req/messages`, and 40 messages are returned.

Changed existing tests, with old and new behaviour:
1. `test/endpoints-messaging.test.js`, `A-25 the four time forms of one instant…` (for a message). Old: the page held only the id, and the time was read from a per-id response. New: the page holds `created_time`, and the test also asserts one request. The asserted ISO string is unchanged.
2. `test/endpoints-messaging.test.js`, renamed `A-21 one malformed message in a thread…` to `A-21 one malformed message in a page gives the other messages and skippedMessages 1, and never stores a guessed time`. Old: the malformed time came from a per-id response. New: it comes in the page, and the test asserts one request. The assertions (`['m1', 'm3']`, `skippedMessages` 1) are unchanged.
3. `test/endpoints-messaging.test.js`, renamed `A-21 a message with no sender, and an edge row with an unusable id…` to `A-21 a message with no sender, and a row with an unusable id, are skipped and counted, and the page is kept`. Old: the dotted-id row was checked to make no request. New: no per-id request exists at all, so the check is replaced by one request in total. The assertions (`['m3']`, `skippedMessages` 2) are unchanged.
4. `test/endpoints-messaging.test.js`, `A-21 a message with no created_time keeps createdTime null…`. Old: the message came from a per-id response. New: it is in the page. The assertions are unchanged.
5. `test/endpoints-messaging.test.js`, `readThread follows the messages edge with the after cursor…`. Old calls: `{conversation}/messages` with `{ fields: 'id', limit: 100 }`, then `m1`, `m2` per id, then the edge with `after: 'e2'`, then `m3` per id. New calls: the edge with `{ fields: MESSAGE_FIELDS, limit: 100 }`, then the edge with `{ fields: MESSAGE_FIELDS, limit: 100, after: 'e2' }`. The merged items `['m1', 'm2', 'm3']` are unchanged.
6. `test/endpoints-messaging.test.js`, `readThread stops at maxItems…`. Old: the page held ids only. New: the page holds the messages. The assertions are unchanged.
7. `test/endpoints-messaging.test.js`, `P3 fix the paged conversation and message reads ask for pages of 100 by default`. Old assertion: `thread.calls[0].query` deep-equals `{ fields: 'id', limit: 100 }`. New assertion: `{ fields: MESSAGE_FIELDS, limit: 100 }`.
8. `test/service.test.js`, `(f) comments, messages and mentions are marked untrusted`. Old fixture: `'GET t_1/messages': { data: [{ id: 'm1' }] }` plus a per-id `GET m1`. New fixture: the page holds the full message, and the per-id answer is removed. The assertions are unchanged.
9. `test/service.test.js`, `M-11 a page of 20 messages with no next link…` and `M-11 a page of fewer than 20 messages…`. Old fixtures: the page held ids, with a per-id answer for each. New fixtures: the page holds the full messages, with no per-id answers. The assertions are unchanged.
10. `test/service.test.js`, helper `threadAnswers`, used by the P3 thread tests. Old: the page held ids, with a per-id answer for each message. New: the page holds the full message, and there are no per-id answers. The assertions in the tests that use it are unchanged.

Live check for this change:
- Confirm that `GET {conversation-id}/messages` with `fields=id,created_time,from,to,message` returns the message fields in the page itself, so the per-id read is not needed. This is the coordinator's ruling. The docs cite the node form, and the edge form is still unconfirmed.

### P3 review round (p3-review.md, findings M-1 to M-5)

Status: DONE_WITH_CONCERNS (the live checks listed under Concerns).

`npm test`: exit 0, **912 of 912 passing**. Before this round the count was 905. The round adds seven tests and removes none. Two existing tests changed their pins (M-4), and five service tests gained a request assertion (M-5). The protected files are still byte-identical to `snap/p3-head`: `src/poller.js`, `src/webhooks.js`, `src/state.js`, `src/events.js` and `src/guard.js`. M-6 is a process note and has no code change here.

#### M-1: a top-level `paging` key is removed from the business-discovery result

- Code: `src/graph/endpoints/discovery.js`, `withoutNestedPaging`, line 25 (`if (key === 'paging') continue;`). The comment above it (lines 17 to 20) says a top-level paging key is removed too, and that it does not set `truncated`, because it is not a list.
- Old behaviour: the business object's top-level `paging` object passed through, with its next link and token.
- New behaviour: the key is dropped, and no `paging` text, `access_token` or `SECRET` appears in the result.
- New test: `M-1 a business object with a top-level paging.next carrying the token returns without the paging key, and no token text appears` (`test/endpoints-social.test.js`, line 423).

#### M-2: ceilings lowered to 10 pages and 1000 items, and bounds above them clamped

- Code: `src/graph/paging.js`. Ceilings are now `MAX_PAGES_CEILING = 10` (line 11) and `MAX_ITEMS_CEILING = 1000` (line 12). `checkBound` is replaced by `clampBound` (line 19): a value below 1, or not a whole number, is still refused with `VALIDATION`, and a value above its ceiling is clamped to it, with the comment saying so. `readAllPages` applies it (lines 53 to 54), and the comment above it says a larger value is read as the ceiling.
- Old behaviour: 101 pages and 10001 items were refused with `VALIDATION`. The ceilings were 100 and 10000.
- New behaviour: they are clamped to 10 and 1000.
- Changed test, `test/paging.test.js`, `readAllPages refuses bad bounds, a bad fetchPage and a bad page shape, and requests nothing for the bounds`. Old: the loops included `101` for `maxPages` and `10001` for `maxItems`. New: they are removed from the refusal loops, and the clamp is tested separately.
- New test: `M-2 a caller asking for 50 pages gets 10, and a caller asking for 5000 items gets 1000` (`test/paging.test.js`, line 107).
- Changed test, `test/endpoints-media.test.js`, renamed `P3 mediaList refuses a maxPages or maxItems out of range before any request` to `P3 mediaList refuses a maxPages below 1 before any request, and clamps a maxItems above 1000 to 1000` (line 629). Old: `mediaList(client, { maxItems: 10001 })` rejects with `VALIDATION`. New: the same call on a page of 1005 rows returns 1000 items, with `truncated` true and the item reason.
- Interpretation to confirm: the clamp is in the paging helper, which every paged read goes through. `readThread` and `dmMessages` still refuse a `maxItems` or `limit` above 1000 before the read, as the documented tool input range. Changing that would silently return 1000 for an input of 5000.

#### M-3: the conversation lookup reads on until it finds a valid conversation

- Code: `src/service.js`, `dmMessages`, line 969. The lookup is `readConversations(..., { maxItems: 1 })`, in place of `maxPages: 1`. With the default page bound of 10, it reads pages until a valid conversation is found or the list runs out. A page of malformed rows does not end it. The comment on lines 966 to 968 says so.
- Old behaviour: the lookup read one page only. A first page of malformed rows gave an empty list, and the match on the second page was never seen.
- New test: `M-3 a first page of malformed conversation rows does not end the lookup, and the match on the second page is found` (`test/service.test.js`, line 1873). Its assertions: the lookups were `[undefined, 'l2']`; the message is `m1`; `skippedConversations` is 1; no request carries the secret.

#### M-4: `dmMessages` takes `after` and returns `nextAfter`; a long thread can be read on

- Code, `src/graph/endpoints/messaging.js`, `readThread`:
  - It takes an `after` start cursor, validated as a non-empty string (line 271).
  - Each request asks only for the items still wanted: `limit: Math.max(1, Math.min(MESSAGE_PAGE, maxItems - collected))` (line 278). Old behaviour: every request asked for 100, so a bound such as 150 stopped inside a page with no cursor. New behaviour: the bound falls at a page end, so `nextAfter` is always given when more remain.
  - The first request uses `after` when no cursor is given (`cursor ?? after`).
- Code, `src/service.js`, `dmMessages`: `after` is validated before any request (line 965, `invalid(...)`). It is passed to `readThread` (line 974), and `nextAfter` is returned (line 981). An empty lookup returns `nextAfter: null`.
- Code, `src/tools.js`, line 260: `ig_dm_messages` properties are now `{ recipientId: ID, limit: INTEGER, after: STRING }`. Old: `{ recipientId: ID, limit: INTEGER }`. The description still says "the first page"; that is P7's wording, and it is not changed here.
- New tests:
  - `M-4 readThread asks each page only for the items still wanted, so a bound ends at a page end and gives nextAfter` (`test/endpoints-messaging.test.js`, line 603). Its assertions: the requests carry `limit` 100 and then 50 (`after: 'c1'`); 150 items; `truncated` true; the item reason; `nextAfter` `'c2'`; no `SECRET` in any call.
  - `M-4 readThread starts from the after cursor it is given, and refuses an after that is not a cursor string` (`test/endpoints-messaging.test.js`, line 628).
  - `M-4 a thread longer than 1000 messages returns truncated with nextAfter, and a call with that after returns the next messages` (`test/service.test.js`, line 1901). Its assertions: the first call returns 1000 messages, `truncated` true, `nextAfter` `'p10'`. The second call with `after: 'p10'` returns 200 messages starting at `t10_0`, not truncated, with `nextAfter` null. No request carries the secret.
  - `M-4 dmMessages refuses an after that is not a cursor string, before any request` (`test/service.test.js`, line 1916).
- Changed pins, `test/service.test.js`, because the result object now carries `nextAfter`:
  1. `(h) dmMessages looks up the conversation by recipient and takes the first id`. Old: `assert.deepEqual(result, { messages: [], skippedMessages: 0, skippedConversations: 0, truncated: false, reason: null })`. New: the same, plus `nextAfter: null`.
  2. `(h) dmMessages with no conversation for the recipient gives an empty list, not an error`. Old: `assert.deepEqual(await t.service.dmMessages({ recipientId: OTHER }), { messages: [], skippedMessages: 0, skippedConversations: 0, truncated: false, reason: null })`. New: the same, plus `nextAfter: null`.

#### M-5: the service and social tests that use next links assert on the requests

- A helper, `assertNoSecretInRequests(t)`, is added in `test/service.test.js` (before `threadAnswers`). It asserts that `JSON.stringify(t.graph.requests)` contains neither `SECRET` nor `access_token`.
- Changed tests, each gaining that assertion. Old assertions: none on the requests. New: `assertNoSecretInRequests(t)`.
  1. `(d) commentsList refuses another media, and reports truncated when more pages exist beyond the page limit`, which uses `endlessComments`.
  2. `M-11 (P3) a thread of two pages of 20 messages, the second with no next link, is read in full and is not truncated`, which uses `threadAnswers`.
  3. `P3 one page is one request through dmMessages: two pages make two messages-edge requests, and no per-message request`, which uses `threadAnswers`.
  4. `M-11 (P3) a thread with more pages than the page limit is truncated at ten pages, and the reason names the page limit`, which uses `threadAnswers`.
  5. `P3 A-15 a truncated owner media list refuses a media outside it, and the refusal says the list was truncated`, which uses `endlessOwned`.
- Changed test, `test/endpoints-social.test.js`, `P3 A-15 ownedMediaIds reads each page up to maxPages, and reports truncated when more media exist` (line 405). Old: the two next links were `'https://x'`, with no token, and there was no request assertion. New: the next links carry `access_token=SECRET`, and the test asserts that `SECRET` and `access_token` are absent from `client.calls`.
- These five service assertions and the social one pass when written. They guard behaviour that already holds (no next link is ever followed), so they are not red-green pairs.

#### Concerns for this round

1. The M-2 clamp is in the paging helper. `readThread` and `dmMessages` still refuse a `maxItems` or `limit` above 1000, as the tool's documented range. Confirm that is the intended reading.
2. The `ig_dm_messages` description still says "the first page", and the README read-limit wording is stale. Both are P7, as ruled.
3. The live checks are unchanged: the messages edge form (`fields`, `limit`, `after`), and the per-edge page maximum of 100.

Report: `D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\task-8-report.md`
