# Task 5 re-review 1: Graph API client (fix round 1)

Read-only. Inputs: task-5-brief.md, task-5-review.md (findings in scope only), task-5-report.md (round 1 and round 2 sections), review-task-5-fix1.diff, the current src/graph/client.js and test/graph-client.test.js, global-constraints.md line 10, and src/errors.js (mapGraphError).

Checks run:
- The current src/graph/client.js and test/graph-client.test.js are identical to the task-5-fix1-head snapshot (diff, no output).
- Focused run, `node --test test/graph-client.test.js`: 33 tests, 33 pass, 0 fail. The full suite was not run.
- The fix diff file contains both round 1 and round 2 changes (the fetchResponse/readBody split and the read order in send). The report's round 2 section describes the same code, so the reviewed state is the current file.

## Finding verdicts

- **I-1, Retry-After ceiling of 60 s: ADDRESSED.**
  - client.js:12-14 sets `MAX_RETRY_AFTER_SECONDS = 60`. `MAX_TIMER_MS` is gone.
  - client.js:130-137 (retryWait): `seconds <= 60 ? seconds * 1000 : null`. A value above 60 is not retried, and the call returns its RATE_LIMITED error (client.js:199-205).
  - The default backoff (client.js:134) is unchanged, and it is the only other sleep path.
  - Tests: test/graph-client.test.js:195-202 (60 is retried, waits [60000]) and 204-212 (61 and 2147483 are not retried, one call, no wait). Both sides of the boundary are covered.

- **I-2, onUsage on every response; unreadable marker; 2xx not thrown away: ADDRESSED.**
  - onUsage is called on every attempt, before the body is read and before classify (client.js:195-196). That covers 2xx, non-OK and retried responses.
  - client.js:98-105 (readUsage) returns `{ app: null, business: null, unreadable: '<header name>' }` for the first unreadable header, with x-app-usage checked first. readUsageHeader (client.js:83-93) does not throw.
  - client.js:207-209 returns the 2xx data with `usage: null` when the marker is set. The old throw of usageError is gone.
  - A non-OK response still throws its mapped error (client.js:199-205), so a stop is not hidden.
  - Tests: test/graph-client.test.js:300-314 (marker to onUsage, for x-app-usage and then x-business-use-case-usage) and 316-321 (2xx returns data with usage null, one call).

- **m-2 (a), empty 2xx body is success with data null: ADDRESSED.** client.js:119-121. Test lines 332-338 (a 204 from DELETE, and an empty 200 on GET).

- **m-2 (b), body-read failure keeps the usage, and onUsage runs first: ADDRESSED.** client.js:194-197 reads the headers and calls onUsage before readBody (client.js:181-187). Test lines 323-330: onUsage receives the parsed usage once, the call rejects with API_ERROR, and one request was made.

- **m-4, access_token in a query or form field is refused with CONFIG before any request: ADDRESSED.** TOKEN_FIELD is at client.js:16, and the check is at client.js:57-59 inside encodeParams. encodeParams is the only path for the query (buildUrl, client.js:167) and for form (encodeBody, client.js:76), and both run before send(). The check tests the raw key, which is the name the server receives after URLSearchParams encodes it. Test lines 340-347 cover a query `access_token`, a query `Access_Token`, a form `ACCESS_TOKEN`, and zero requests.

- **m-6 (a), the retry-ceiling test: ADDRESSED.** See I-1. The 2147484 test is removed.

- **m-6 (b), a non-OK response with an OK-looking body is an error: ADDRESSED.** Test lines 349-355: a 500 with `{data: []}` gives API_ERROR, and a 429 gives RATE_LIMITED. A non-OK response never reaches the success branch, because classify returns early on `res.ok` (client.js:119). The test posts without retryPost, so it pins the error kind, not a retry. The retry decision for a 5xx is status-based (client.js:132) and was not changed.

- **Deferred, not counted:** m-1, m-3, m-5, m-7, m-8, m-9, m-10, and m-6 (c) and (d), per the controller ruling.

## New breakage in the fix diff

Checked for each category the controller named:

- **Write success reported as failure: none new.** A 2xx with an unreadable usage header now returns its data (client.js:209). An empty 2xx body now succeeds (client.js:121). A 2xx body that cannot be read still throws, but that is unchanged from task-5-head (see out-of-scope item 1).
- **Usage reading lost: none.** onUsage receives the marker or the parsed reading on every response (client.js:195-196). The returned `usage` is null for the marker case by design (client.js:209); see out-of-scope item 3.
- **Retry past the ceiling: none.** Each Retry-After wait is at most 60 s (client.js:137). The default waits are 1, 2 and 4 s (client.js:11, 134). The only sleep call is client.js:202.
- **Token reaching a URL: none.** The token is only in the Authorization header (client.js:190). PATH_PATTERN (client.js:19) excludes `?`, `#`, `=` and `&`, so a path cannot carry a query. The new CONFIG message does not include the token value.
- **Fail-open: none new.** An unreadable usage reaches the callback as the marker (client.js:98-102, 196), not as null. A Retry-After that is not digits, or is above 60, is not retried (client.js:135-137). A non-OK response always throws (client.js:199-205).
- **Minor, new: stale comment.** client.js:140-141 says onUsage is called "with that response's usage, or null". The callback now also receives the unreadable marker (client.js:96-97, 196). Documentation only; no behaviour change.

Count of new issues: Critical 0, Important 0, Minor 1.

## Out-of-scope observations

1. **Pre-existing, not counted.** A write whose body cannot be read, or whose 2xx body is non-empty and not JSON, is reported as API_ERROR (client.js:122-123, 181-187, 197). Graph may already have applied the write, so the owner may resend it. The same behaviour is in task-5-head (the removed fetchText lines in the diff). Tasks 6 to 8 should treat API_ERROR from a write as "outcome unknown". The controller should decide.
2. **Pre-existing, not counted.** A non-OK response whose body cannot be read maps to API_ERROR, not RATE_LIMITED, because readBody throws before classify (client.js:197, before 198). Global constraints line 10 says HTTP 429 is RATE_LIMITED and that a stop is persisted. The response is also not retried. The fix would be to map by status when the body read fails on a non-OK response. The same behaviour is in task-5-head.
3. **Task 13 handoff, tied to controller ruling 1.** The marker reaches only onUsage (client.js:196). For a 2xx response with an unreadable header, the returned `usage` is null (client.js:209). Task 13's `usage.unreadable` check must run on the onUsage argument, not on the return value of get, post or del, or it will see "no reading".
4. **Total retry wait is not capped.** Each wait is at most 60 s, but three retries can sleep up to 180 s, and four attempts can each use the 15 s timeout. The ruling sets a per-wait ceiling only. The controller should decide whether a total cap is wanted.
5. **access_token refusal covers query and form only.** A JSON body is not checked (client.js:71-74). A JSON body that carries an access_token key goes in the request body, not in a URL. This is within ruling 2's scope.
6. **Test gap under m-6 (b).** The OK-looking-body test does not pin the retry of a 5xx on GET. The behaviour follows from client.js:132, and the test still meets the promoted item, which asks only that the response is an error.
7. **Deferred, not counted.** onUsage throwing escapes send (client.js:196). This is m-3.

## Round verdict

All findings addressed: I-1, I-2, m-2 (a) and (b), m-4, m-6 (a) and (b). No new Critical or Important breakage. One new Minor issue (stale onUsage comment, client.js:140-141). Items 1 to 4 above are pre-existing or are handoffs, not new breakage.
