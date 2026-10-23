# Task 5 review: Graph API client

Read-only gate. Inputs: task-5-brief.md, global-constraints.md, progress.md (R2, R3, R6, R9; Task 2 carry-forward M-3; Task 4 carry-forwards), task-5-report.md, review-task-5.diff. The project file src/graph/client.js matches the diff; the line numbers below are from the project file. Outside the diff I read src/errors.js (mapGraphError), src/caps.js (createUsageGate) and src/config.js (graph defaults), because the error mapping and the usage callback are named risks. The suite was not re-run; the report's test counts and mutation table are unverified (see the last spec item).

Spec verdict: ❌ (two items: the Retry-After ceiling, and onUsage skipped on a malformed header).

## Spec compliance

- ✅ Files. src/graph/client.js and test/graph-client.test.js are created. The diff lists no other change, and the lockfile is unchanged.
- ✅ URL build. `${base}/${version}/${path}` plus the encoded query, client.js:155-161. The base must be an https origin with no path or trailing slash (checkBase, client.js:31-44). The path is validated by PATH_PATTERN (client.js:16) and refuses `.` and `..` segments (client.js:157). The default base and version match config.js:49-51. Test at test/graph-client.test.js:49-58 asserts the exact URL, including `fields=id%2Cusername`.
- ✅ loginProduct. client.js:14 and 141-145 pick graph.instagramBase or graph.facebookBase. Test at lines 60-65.
- ✅ Bearer header, token kept out of URLs. The header is set at client.js:180. buildUrl (155-161) never includes the token, and the test at line 53 asserts `url.includes(TOKEN) === false`.
- ✅ Timeout. `AbortSignal.timeout(TIMEOUT_MS)` with TIMEOUT_MS = 15000 (client.js:7, 168). A new signal is created on each attempt because fetchText runs inside the send loop (client.js:182-183). Test at lines 235-251 checks the argument, not a real abort; this is acknowledged in the report.
- ✅ Retry statuses and count. RETRY_STATUSES = {429, 500, 502, 503, 504} (client.js:8). Attempts are capped at 3 retries by BACKOFF_MS.length (client.js:11, 124). Tests at lines 111-128, 130-141 and 143-152.
- ✅ Default delays. 1000, 2000, 4000 ms (client.js:11, 127). Test at lines 111-128 expects [1000, 2000, 4000].
- ✅ Retry-After in whole seconds. `^\d+$` then `× 1000` (client.js:128-129). Test at lines 67-74 expects 2000 ms for `Retry-After: 2`.
- ❌ No retry for a Retry-After that is too large. client.js:13 and 129-130 use MAX_TIMER_MS = 2147483647 ms as the limit. A value up to 2147483 seconds (about 24.8 days) is accepted and slept inside the call (client.js:190). The brief and constraints do not define "too large", and the timer ceiling is not a practical bound. The test at lines 183-189 uses 2147484 (just over the ceiling), so the gap is not covered. See I-1.
- ✅ POST and DELETE not retried by default. POST is retryable only when `retryPost === true` (client.js:215). DELETE is never retryable (client.js:219). Tests at lines 76-85, 191-198.
- ⚠️ DELETE and retryPost. Brief line 11 ("POST and DELETE ... unless retryPost: true") can be read as letting DELETE retry with the option. `del` (client.js:218) takes no options, so DELETE can never retry. The implementer's reading matches the signature, and I accept it.
- ✅ Usage parsing. Both headers are read and parsed as JSON objects (client.js:77-102, 184). Missing headers give null, and neither present gives null (client.js:98-101, tests at lines 96-110). The result is `{ app, business }`, not the bare header. This is a deliberate deviation from the brief's wording, which the ledger accepts (report Decision 1). Task 13 must pass `usage.app` to the gate (see m-9).
- ❌ onUsage after every response. client.js:184-185 skip the callback when a usage header is malformed (`usageError !== null`). R6 says "called after every response", and the test at lines 277-285 pins the skip. The ledger accepted this as Decision 5, but the literal contract is not met. See I-2.
- ✅ Error mapping. A non-OK status always throws (client.js:114, 118; tests at lines 209-213, 214-218). A 2xx body with an `error` member throws the mapped error (client.js:113-114, 118; test at lines 219-226). Code 190 maps to AUTH_EXPIRED (test at lines 87-95; errors.js:64).
- ✅ String-body rule (Task 2 carry-forward M-3). mapGraphError only ever receives a parsed object or null (client.js:113, 118). A non-JSON non-OK body maps by status (test at lines 200-208 for 429, 209-213 for 400).
- ⚠️ 429 with a non-JSON body. The carry-forward wording says API_ERROR. The client maps it to RATE_LIMITED (test at lines 200-208). That follows the global constraint "HTTP 429 ... RATE_LIMITED" (global-constraints.md line 10). I accept the deviation and the controller should record it.
- ✅ Stop codes never retried. RETRY_KINDS is RATE_LIMITED and API_ERROR only (client.js:10), and retryWait also requires a retryable status (client.js:125). Test at lines 154-165.
- ✅ No network call in tests. Every `client(...)` call in the test file injects fetchImpl and sleep, so the global fetch and setTimeout defaults are not reached. Responses are local `Response` objects.
- ✅ Transport errors carry no URL or token. Errors use only the error name (client.js:170, 175).
- ⚠️ Report claim "error messages carry no response text". Not accurate: mapGraphError puts Graph's `error.message` into the IgError message (errors.js:62, 69). IgError redacts it (errors.js:30). I accept, since redaction is Task 2's design.
- ⚠️ Signature. `now` is not accepted (client.js:135), though brief line 7 lists it. Nothing in the client needs a clock, and the ledger accepts this (report Decision 8). Harmless; Task 13 must not rely on `now`.
- ⚠️ Global constraints. The "no-retry-for-writes" and "Bearer token" rules named in the review request do not appear verbatim in global-constraints.md. I applied brief lines 9 and 11 as the source.
- ⚠️ Unverified. The 218-test pass and the mutation table (report lines 45-82) were not re-run. The mutants are not reproducible from the diff.

## Strengths

- The token appears only in the Authorization header. The URL builder rejects absolute URLs, query characters and dot segments through PATH_PATTERN, so a path cannot change the host (client.js:16, 155-159).
- Redirects are refused (`redirect: 'error'`, client.js:168), so the token cannot follow a redirect to another origin. checkBase enforces the origin at construction (client.js:31-44).
- Stops are excluded from retries twice: by kind (RETRY_KINDS) and by status (client.js:124-125).
- Retry-After parsing is strict: a date, a fraction or any non-digit value is not retried (client.js:128).
- A non-OK response always throws, even when its body looks successful (client.js:114, 118).
- Configuration is checked up front with CONFIG, before any request (client.js:136-153).
- The tests use a fake fetch, a fake sleep and a stubbed AbortSignal.timeout, so they make no network call. They cover all six brief tests and 21 others, including the boundaries for timers and the status list.

## Issues

### Critical

None.

### Important

- I-1. Retry-After ceiling is too large (client.js:13, 129-130; test at lines 183-189). A Retry-After of 2147483 seconds passes the check and is slept inside the call, which is about 24.8 days. Even 600 seconds would hold the caller for ten minutes. Fix: choose a practical bound and refuse any retry above it, for example 60 seconds, which matches the 60000 ms usage window in the constraints (controller to confirm). Then change the test at lines 183-189 to use a value above the new bound, and add a boundary test at the bound.

- I-2. A malformed usage header breaks the usage path (client.js:184-185, 195; caps.js:302-325). Two effects:
  (a) onUsage is not called, so the usage gate keeps the last reading. If that reading was low, later calls pass while Graph's usage may be high, and the gate is blind until a valid header arrives. R6 requires the callback after every response.
  (b) On a 2xx response the call throws API_ERROR at line 195, after Graph has accepted the request. A DM or comment that was sent is reported as failed, and the owner may send it again.
  Fix: call onUsage on every response, passing an explicit unreadable marker such as `{ app: null, business: null, unreadable: 'x-app-usage' }`. Task 13 then holds outbound calls for the 60000 ms window on that marker. Also return the 2xx data with `usage: null` instead of throwing. If the controller keeps the throw, record (a) and (b) as known limits with their cost, and rewrite the test at lines 277-285 to say so.

### Minor

- m-1. Non-object JSON bodies (client.js:113-118). On a 2xx response, a body that parses to null, a string, an array or a number is returned as success data (line 115). On a non-OK response, a non-object body skips the code check, so a stop code inside such a body maps by status only. Graph's documented bodies are objects, so no realistic stop is missed. DELETE may legitimately return `true`, so do not reject every non-object. Fix: none in the client. Tasks 6 to 8 must check the shape they read, such as `data.id`, and the README should note it.

- m-2. Empty and unreadable bodies (client.js:116-117, 175). An empty 2xx body, such as a 204, is reported as API_ERROR, so a DELETE that Graph completed looks failed. A body-read failure throws in fetchText (line 175) before readUsage runs, so the usage in a response whose headers arrived is lost and onUsage is not called. Fix: treat an empty 2xx body as data null, and read the headers before the body so that usage and onUsage run first.

- m-3. Callback exceptions (client.js:185). An exception thrown by onUsage escapes send as a non-IgError and ends the call, including any pending retry. Fix: wrap the call and map a throw to a CONFIG or API_ERROR error, or document that onUsage must not throw.

- m-4. Token in a query or form (client.js:48-61, 155-161). Nothing stops a caller from passing `access_token` in a query or form field, which would put the token in a URL. The spec says the token never goes in a URL. Fix: refuse keys named access_token (case-insensitive) in encodeParams with VALIDATION. Note for Task 9: the refresh call must not place the token in the query.

- m-5. No response size cap (client.js:172-176). `res.text()` reads any length into memory. Fix: stop reading above a cap, for example 5 MB, and map that to API_ERROR.

- m-6. Test gaps (test/graph-client.test.js). (a) The Retry-After test at lines 183-189 pins the timer ceiling and must change with I-1. (b) No test that a non-OK response with an OK-looking body and no `error` member is thrown: a 500 with `{"data":[]}` should be retried as API_ERROR, and a 429 with `{"data":[]}` should be RATE_LIMITED. (c) No test for `Retry-After: 0`. (d) No test that a 2xx with `error: null` returns data. Fix: add these four, and optionally a test that a real abort maps to API_ERROR.

- m-7. Handoff, retryPost (client.js:215). retryPost re-sends the whole request, including a write that Graph may already have applied. Tasks 6 to 8 must not pass retryPost for DM sends, comments, publishing, likes, follows or hides, or the owner's action can be duplicated. Note only; the client follows the spec.

- m-8. Handoff, token lifecycle (client.js:135, 180). The token is fixed when the client is created, and the client does not call registerSecret. The ledger assigns both to Tasks 9 and 17. Task 9's refresh must build a new client with the new token and register it on receipt. Note only.

- m-9. Handoff, usage shape (client.js:92-102; caps.js:293-297). The client accepts any JSON object for the app header. createUsageGate.check throws VALIDATION when total_time or total_cputime is missing or not a number. If Graph sent such an object, every outbound check in Task 13 would throw VALIDATION, not return busy. Task 13 must map that case to a busy or stop result.

- m-10. Duplicated helper (client.js:22-24; caps.js:66-68). isPlainObject is defined in both modules. This is the carry-forward from Task 3 M-6 and Task 4 M-5. Fix: one shared helper, at the final review.

## Assessment

Task quality: Needs fixes. The Retry-After check lets a single call sleep for up to about 24.8 days (I-1), and a malformed usage header leaves the throttle on a stale reading and reports a sent write as failed (I-2). The rest of the client matches the brief: the URL, Bearer transport, timeout, retry statuses, POST and DELETE defaults, stop handling and the string-body rule are correct, and the tests make no network call.
