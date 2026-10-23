# P3 review: real paging and reads (p2-fix-head to p3-head)

Scope: review-p3.diff (2258 lines, read in full), progress.md (P3 entry and the OWNER DECISIONS paragraph), global-constraints.md, and task-8-report.md section "P3 (2026-10-22)" (lines 201-385). Live `src/` and `test/` were compared with `snap/p3-head` and are byte-identical. The suite was not re-run. Test blocks were scanned by script for assertion calls. Graph pagination docs were checked through Context7 (/websites/developers_facebook_graph-api).

## Round verdict

FINDINGS REMAINING. New findings: Critical 0, Important 0, Minor 6.

The P3 contract holds in code. paging.next is never requested, the token stays in the Authorization header, truncation follows paging.next, and per-item tolerance is in place. The six Minor items below need a decision or a fix before the round closes.

## Verdicts

| Item | Verdict | Where |
|---|---|---|
| (a) paging.next never followed | ADDRESSED | paging.js:26-34; client.js:19, 203-206 |
| (b) no access_token in any URL; no next URL logged or stored | ADDRESSED (see M-1) | client.js:85, 258; paging.js:26-34; discovery.js:19-27 |
| (c) cursor passed through unchanged | ADDRESSED | paging.js:26-39; media.js:85 |
| (d) truncated rule | ADDRESSED | paging.js:69, 73-75 |
| (e) maxPages 10 and maxItems 1000 enforced; fixed reasons | ADDRESSED (see M-2) | paging.js:8-9, 14-15, 50-51, 69, 74-75 |
| (f) messages edge, one request per page; legacy node form | ADDRESSED; legacy form EXPECTED | messaging.js:265-282; messaging.js:203-216; poller.js:260 |
| (g) numeric timestamps | ADDRESSED | messaging.js:28, 78-104, 331-344 |
| (h) per-item tolerance | ADDRESSED | messaging.js:126-136, 278; service.js:943-976 |
| (i) page size 100 | ADDRESSED in code; per-edge maximum is a live check | media.js:11; comments.js:12-13; messaging.js:16, 23; service.js:49-54 |
| (j) tests: old and new assertions; no weakened check; token coverage | ADDRESSED (see M-5) | task-8-report.md:130-180, 257-279; test refs below |
| (k) no new write retry; no write from a read path | ADDRESSED | media.js:85; messaging.js:223, 273; service.js:669 |

## Item detail

**(a) paging.next never followed. ADDRESSED.**
- The only reads of `paging.next` in `src/` are `src/cli.js:453`, which refuses the Facebook Page list when a next link is present and makes no request, and `src/graph/endpoints/discovery.js:25`, which drops a nested link and sets `truncated`. Neither builds a request.
- The only follow-up request is the same endpoint with `after`, through `withCursor` (paging.js:37-39). It is used at media.js:85, comments.js:35-46, comments.js:106-120 (ownedMediaIds), messaging.js:222-248 (readConversations) and messaging.js:265-282 (readThread).
- The client cannot take a URL. `PATH_PATTERN` (client.js:19) allows relative paths only, and `buildUrl` (client.js:203-206) refuses anything else.

**(b) No access_token in a URL; no next URL logged or stored. ADDRESSED, with M-1.**
- The token is sent only in the header (client.js:258).
- A query key named `access_token` is refused (client.js:85, `TOKEN_FIELD`).
- `nextCursorOf` (paging.js:26-34) keeps only the cursor string. Nothing on the read paths logs a response body. Results pass through `redact` (service.js readWith).
- Gap: M-1 (a top-level `paging` key is not stripped).

**(c) Cursor unchanged. ADDRESSED.** `nextCursorOf` checks that the cursor is a non-empty string and returns `paging.cursors.after` as it is (paging.js:26-34). `withCursor` adds it without change (paging.js:37-39). `cursor ?? after` at media.js:85 uses the caller's start cursor on the first page only.

**(d) truncated rule. ADDRESSED.**
- No `paging.next` gives `truncated` false at any length (paging.js:73). A full page with no next link is not truncated (paging.test.js:44).
- A short page with a next link continues. The only exits before a bound are the no-next check at paging.js:73 (paging.test.js:22).
- `maxPages` reached with a next link gives truncated, with the cursor of the unread page (paging.js:74).
- `maxItems` reached gives truncated (paging.js:69 mid-page, paging.js:75 at a page end with a next link). The page-end case follows the rule "paging.next present and a bound stopped the read" (paging.test.js:69).

**(e) Bounds and reasons. ADDRESSED, with M-2.**
- Defaults are 10 pages and 1000 items (paging.js:8-9). They are enforced at paging.js:74 and paging.js:69, 75.
- Bounds are validated before any request (paging.js:50-51).
- Reason texts are fixed constants (paging.js:14-15). `NESTED_REASON` is a constant (discovery.js:15). `notOwnedMessage` uses constant text (service.js:460-464).
- The ceilings in paging.js:11-12 (100 pages, 10000 items) are above the decided values. Gap: M-2.

**(f) Messages edge. ADDRESSED for the P3 paths. Legacy form EXPECTED.**
- `readThread` (messaging.js:265-282) makes one GET per page to `${conversationId}/messages`, with `fields=MESSAGE_FIELDS` and `limit=MESSAGE_PAGE` (messaging.js:269, 273). There is no per-id read in it.
- `dmMessages` uses `readThread` (service.js:969).
- Expected residual until P4: `conversationMessages` (messaging.js:203-216) uses the node form (`fields: 'messages'`) and a per-id read (messaging.js:213). `poller.js:260` calls it. `conversationsList` (messaging.js:188) is called by `poller.js:224`.

**(g) Numeric timestamps. ADDRESSED.**
- `unixMs` (messaging.js:78-83): below 1e12 is seconds, otherwise milliseconds. Zero, negative, non-finite, and past year 9999 are malformed.
- `graphTimeIso` (messaging.js:88-104): a number, a numeric string (`NUMERIC_TIME_PATTERN`, messaging.js:28), or an ISO string with a zone (`parseTime`, messaging.js:331-344). Anything else is malformed. Any parse error is rethrown as `API_ERROR`.
- Test `A-25 the four time forms of one instant...` (endpoints-messaging.test.js:390) checks that ISO Z, +0000, seconds, milliseconds and both numeric strings give the same ISO string, for a conversation and a message.
- Test `A-25 a time that is not a number...` checks 14 malformed values, including a missing zone and a day that does not exist.
- Observation, not counted: ms values from 1e11 to 2.5e11 (1973 to 1977) fall under the seconds rule and are accepted as valid dates. This is the decided magnitude rule.

**(h) Per-item tolerance. ADDRESSED.**
- `readRow` (messaging.js:126-136) counts only `API_ERROR` and returns null. Other errors are rethrown.
- Used by `readThread` (messaging.js:278) and by `readConversations`.
- Counts surface as `skippedMessages` and `skippedConversations` (service.js:943-950 for dmConversations, service.js:966-976 for dmMessages).
- Tests: `A-21 one malformed message in a page...`, `A-21 a message with no sender...`, `a malformed conversation row...`, `P3 a malformed item in a page...`.
- A message with no `created_time` keeps `createdTime` null and is not counted, as before.

**(i) Page size 100. ADDRESSED in code. Per-edge maximum is a live check.**
- Values: media.js:11 (mediaList), comments.js:12 and service.js:51 (commentsList), messaging.js:23 (readThread), messaging.js:16 (readConversations default), service.js:54 (dmConversations), service.js:49 (owned media), comments.js:13 (ownedMediaIds).
- Context7 check: the Facebook Graph pagination docs say `limit` is a maximum, and that "some edges may also have a maximum on the limit value for performance reasons." They name no maximum for conversations, messages, media or comments. So 100 is not confirmed for these edges. Open live check. Not counted.

**(j) Tests. ADDRESSED, with M-5.**
- The changed tests' old and new assertions are in task-8-report.md: 11 in the first round (lines 257-279), 10 in fix round 1 (lines 130-144), and 10 in the per-message round (lines 170-180). I checked each named change against the diff. The old assertions encode the old behaviour (page-length truncation, first-page reads, the 25 and 20 page sizes, a bare Set). The new ones encode the new behaviour. No check was dropped without a replacement. Example: service.test.js:1931-1941 replaces "a full page reports truncated" with "truncated follows paging.next".
- Tests that assert nothing: none found. A script found an assertion call in every test block of the P2 and P3 test files, including every changed or new block. Three poller tests (poller.test.js:252-262) have no direct assert, but they call `checkHalt`. That file is unchanged by P3.
- Token coverage ("a next URL containing access_token is never requested"): covered at endpoint level. endpoints-messaging.test.js:477-495 (readThread: no `access_token` and no `SECRET` in any call), endpoints-messaging.test.js:542-558 (readConversations), endpoints-media.test.js:144-160 (mediaList), endpoints-social.test.js:368-382 (commentsList), endpoints-social.test.js:418-440 (nested discovery edge: the result has no `SECRET`). Gap: M-5.
- Test counts by file rose by: media +4, messaging +14, social +5, paging +11, service +9 (two of the nine are P2 round-2 tests, service.test.js:1714). That matches the implementer's 905 total. Not re-run.

**(k) No write retry; no write from a read path. ADDRESSED.**
- Every new read calls `client.get` only: media.js:85, comments.js:35-46, comments.js:106-120, messaging.js:223, messaging.js:273, and the business-discovery GET at discovery.js:36-52.
- `readCall` (service.js:669) runs no write.
- The client's retry rule is unchanged: GET is retried on 429 and 5xx, and POST only with `retryPost`.
- The `watchRequests` wrapper (service.js:164) belongs to P2 round 2. It wraps only `perform` (service.js:633-636) and does not retry.

## New findings

**M-1 (Minor). discovery.js:19-27.** `withoutNestedPaging` removes `paging` only from nested objects. A top-level `paging` key on the business object would pass through with its next link. `redact` masks the `access_token` text, so no token reaches the caller, but the next URL does. Graph does not return that key in practice, and FIELDS_PATTERN would allow the word `paging` as a field name. Fix: drop a top-level `paging` key too.

**M-2 (Minor). paging.js:11-12.** The ceilings (100 pages, 10000 items) are above the decided 10 and 1000. No service caller passes them (service.js passes only `limit`, and dmMessages' `maxItems` is capped at 1000 by checkLimit, messaging.js:36-41). Latent for internal callers. Fix: lower the ceilings to the decided values, or document the reason.

**M-3 (Minor). service.js:964.** The dmMessages lookup reads one page (`maxPages: 1`). If that page holds only malformed conversation rows, the lookup finds no conversation and returns an empty list. `skippedConversations` shows the skip, so this is not silent. Fix: keep reading pages, within the bound, until a valid conversation is found.

**M-4 (Minor). service.js:957-975; tools.js:259.** dmMessages returns `truncated` and `reason`, but no `nextAfter`, and it accepts no `after`. A thread longer than 1000 messages cannot be read past the bound through the tool. The decided limit is respected. The continuation path is missing. Fix: expose `nextAfter` and accept `after`, or state the limit in the description (P7).

**M-5 (Minor). Test coverage.** service.test.js:1757-1761 (endlessComments), service.test.js:1767-1776 (threadAnswers) and service.test.js:1833-1838 (endlessOwned) use next links that carry `access_token=SECRET`, but none asserts on the requests. endpoints-social.test.js:405-416 (ownedMediaIds) uses `next: 'https://x'` and asserts no token absence. Fix: in these service tests, assert that no entry in `t.graph.requests` contains the secret.

**M-6 (Minor). Review base and traceability.** `snap/p2-fix-head` does not contain the P2 round-2 edits. `snap/p2-fix-head/src/service.js` has 0 matches for `watchRequests` or `earlierReached`, and `snap/p3-head/src/service.js` has 10. So review-p3.diff includes `watchRequests` (service.js:164), the `earlierReached` branches in `unknownOutcome` and `releaseOnPreSend`, the README caps rows, and the P2F-M3 tests (service.test.js:1714). None of this was reviewed as its own snapshot, and it is outside P3. I read it. `watchRequests` treats any non-pre-send failure as reached, which fails closed. Its wrappers cover `get`, `post` and `del`, the only client methods (client.js). I found no defect. Fix: snapshot the round-2 state (p2-round2-head) and review it on its own.

## Accepted by the controller, not counted

- tools.js:243 (`ig_comments_list`) still says truncated is set "when a full page came back". That rule is gone; the code now follows paging.next (service.js:931-937). tools.js:252 and tools.js:259 still say "first page". The controller accepted the tools.js and README wording to P7 (progress.md, P3 entry), but the statements are wrong now.
- README "Reads and paging" and the read-limit rows still say first page (task-8-report.md, concern 3). Accepted to P7.
- The poller uses the first-page readers (poller.js:224, 260) until P4. They keep the old whole-thread failure on a structurally malformed message (endpoints-messaging.test.js:569 pins it).
- The owner-media set now holds up to 1000 ids, with up to 10 extra GETs before each comment, like and publish-check (service.js ownedSetOf; comments.js:106-120). Accepted cost (progress.md).
- Cursors go back to MCP callers in `nextAfter` (media.js:88, comments.js:45). Meta's docs say cursors can become invalid and should not be stored. The design returns them on purpose, so this is an observation.
- Open live checks: the messages edge form (`fields`, `limit`, `after`) and the per-edge maximum page sizes in (i).

## Notes

- The suite was not run. The 905 figure is the implementer's and is consistent with the test counts above.
- No file in the project was edited. The only file written is this review.
