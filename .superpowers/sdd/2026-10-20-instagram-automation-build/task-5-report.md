# Task 5 report: Graph API client

Status: DONE_WITH_CONCERNS

Project: D:\Projects2\InstagramApi (not a git repository; no commit, per R2. The full suite `npm test` replaces the commit step.)

## Inputs read

- Brief: task-5-brief.md
- Global constraints: global-constraints.md
- Ledger: progress.md (R2, R3, R9; R6; Task 2 carry-forward M-3 on string bodies; Task 2 mapGraphError behaviour)

Rulings applied:
- R2: no commit. Verification is `npm test`.
- R3: no packages installed, so no `npm install` ran.
- R9: `package.json` is unchanged. The test script is still `node --test test/*.test.js`.
- R6: `createGraphClient` takes an optional `onUsage(usage)`, called after every response with the object parsed from that response, or null.
- Task 2 carry-forward (M-3): the body passed to `mapGraphError` is always a parsed JSON object or null. A string body is never passed unparsed. A body that does not parse is rejected with API_ERROR on a 2xx response, and on a non-OK response it maps by status (see Decision 3).

## TDD evidence

### RED

Tests were written first (test/graph-client.test.js, 25 tests at that point). Before `src/graph/client.js` existed, the run was:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\graph\client.js' imported from D:\Projects2\InstagramApi\test\graph-client.test.js
...
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ duration_ms 172.5955
✖ test\graph-client.test.js (148.4983ms)
  'test failed'
EXIT=1
```

The RED here is a load failure: the whole file failed before any test body ran. This is the expected state before the module exists.

### GREEN, first pass

After writing `src/graph/client.js`, all 25 tests passed on the first run (`ℹ tests 25`, `ℹ pass 25`, `ℹ fail 0`, EXIT=0).

### Mutation checks (coverage of the tests)

Each mutant was applied to a scratch copy in the session scratchpad, never to the project. The scratch copy was removed afterwards.

| Mutant | First run | After adding tests |
|---|---|---|
| M1: POST retried without retryPost | 3 fail | 3 fail |
| M2: redirects followed (`redirect: 'follow'`) | 1 fail | 1 fail |
| M3: malformed usage header ignored | 1 fail | 1 fail |
| M4: AUTH_EXPIRED and CHECKPOINT retried | 0 fail (gap) | 1 fail (test added: "a stop on a retryable status is not retried") |
| M6: 401 treated as retryable | 0 fail (gap) | 1 fail (test added: "a status outside the retry list, such as 401, is not retried") |
| M7: Retry-After ignored | 3 fail | 3 fail |

The two gaps (M4, M6) were found by the mutants, and each gap got a test. The restored client passes all tests.

### GREEN, final

```
ℹ tests 27
ℹ suites 0
ℹ pass 27
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
EXIT=0
```

### Full suite

`npm test` (`node --test test/*.test.js`):

```
ℹ tests 218
ℹ pass 218
ℹ fail 0
EXIT=0
```

The 218 count is the 191 tests from the Task 4 ledger, plus the 27 new graph client tests.

## Files changed

Created:
- D:\Projects2\InstagramApi\src\graph\client.js
- D:\Projects2\InstagramApi\test\graph-client.test.js

Not changed: package.json, and every other file under src/ (config.js, errors.js, redact.js, audit.js, state.js, events.js, caps.js, guard.js). No packages were installed.

## What the client does

- `createGraphClient({ config, loginProduct, token, fetchImpl = fetch, sleep, onUsage })` returns `{ get, post, del }`. Each method resolves to `{ data, usage }`.
- URL: `${base}/${config.graph.version}/${path}` plus the encoded query. `loginProduct` `instagram` uses `graph.instagramBase`, and `facebook` uses `graph.facebookBase`.
- Token: `Authorization: Bearer <token>` on every request. It is never placed in the URL.
- Timeout: `AbortSignal.timeout(15000)`, created per attempt. Redirects are refused (`redirect: 'error'`).
- Retries: GET, and POST with `retryPost: true`, retry up to 3 times on 429, 500, 502, 503 and 504. The wait is the Retry-After value in seconds when present, otherwise 1000, 2000 and 4000 ms.
- Stop kinds are never retried. The retry happens only when the mapped error is RATE_LIMITED or API_ERROR.
- Errors: a non-OK status, or a body with an `error` member, throws `mapGraphError({ status, body })`. Other failures are API_ERROR: a network failure, a timeout, a body that cannot be read, a 2xx body that is not JSON, and a bad usage header.
- Usage: read from the `x-app-usage` and `x-business-use-case-usage` headers of each response. Both are parsed JSON. The result is `{ app, business }`, each the parsed object or null, or `null` when neither header is present.
- onUsage: called after every response, including non-OK responses and before any error is thrown, with that response's usage (or null). It is never called with a stored copy.

## Decisions and interpretations (for the controller to check)

1. **Usage shape is `{ app, business }`, not the bare X-App-Usage object.** The brief says usage comes from both headers, but the usage gate in src/caps.js takes the X-App-Usage object with top-level numeric `total_time` and `total_cputime`. The business header has a different shape (keyed by the account id, with arrays). **Task 13 must pass `usage?.app ?? null` to `createUsageGate().check`, not the whole usage object.** Passing the whole object would make the gate throw VALIDATION.

2. **Retry-After that is not whole seconds, or is longer than one timer can hold, is not retried.** A value such as an HTTP date, or any value over 2147483647 ms, gives the mapped error at once. Node turns a longer timer into 1 ms, so waiting would be wrong. This follows the fail-closed rule: the value is refused, not coerced to the default backoff.

3. **A non-OK response with a body that is not JSON.** The literal Task 2 carry-forward says reject with API_ERROR. But the global constraints say HTTP 429 is always RATE_LIMITED, and that a stop is persisted. So `mapGraphError` gets `body: null`, which never receives a string. A 429 with a non-JSON body is therefore RATE_LIMITED, and other statuses are API_ERROR. This is a deliberate deviation from the literal wording, to keep the 429 stop. Covered by the test "a 429 whose body is not JSON is RATE_LIMITED, and the text is not parsed as an error".

4. **DELETE is never retried.** The brief's line "POST and DELETE are not retried unless `retryPost: true`" is ambiguous. The retry list names only GET and POST, and `del` takes no options, so DELETE has no retry path.

5. **A malformed usage header rejects the response with API_ERROR, and onUsage is not called for it.** A stop on the same response still wins (for example, a 429 with a bad usage header is RATE_LIMITED). The effect on the gate: the previously stored reading stays in place. That reading may be stale.

6. **A network failure or timeout on GET is API_ERROR and is not retried.** The brief names no retry for this case.

7. **Argument checks.** Bad config (base not an https origin, version not `vN.N`, unknown loginProduct, token with spaces or empty, bad fetchImpl, sleep or onUsage) throws `IgError('CONFIG')` synchronously. A bad path, query, form or json body, or bad options, is `IgError('VALIDATION')`, returned as a rejected promise. A path must be relative and match `[A-Za-z0-9_.-]` segments joined by `/`, with no `.` or `..` segment. A query or form value must be a string, a finite number, or a boolean. An undefined value is skipped.

8. **`now` is not accepted.** The brief's signature lists `now`, but this client has no timing that needs a clock. The retry waits go through the injected `sleep`. Passing `now` is harmless, because it is ignored.

9. **Default `sleep`** is a real `setTimeout`. Tests always inject a fake.

## Self-review (read of the diff)

Checked against the brief and the constraints:
- Bearer header on every request; no token in the URL (test 1 asserts the URL does not contain the token value).
- Timeout is 15000 ms via `AbortSignal.timeout`, created per attempt (test "every request has a 15 second timeout signal and refuses redirects" stubs `AbortSignal.timeout` and restores it in `finally`).
- Redirects refused (`redirect: 'error'`), so the token cannot follow a redirect.
- Retry statuses, the three-retry limit, and the backoff schedule match the brief. Tests cover 500, 502, 503, 504 and 429, the schedule 1000/2000/4000, and the 4-call limit.
- Stop kinds (AUTH_EXPIRED, ACTION_BLOCKED, CHECKPOINT) are never retried (test "a stop on a retryable status is not retried").
- Status 401 is not retried (test added after mutant M6).
- A body that is a string or not an object is never passed to mapGraphError (`classify` passes the object or null).
- onUsage is called once per response, before any error is thrown, with the object parsed from that response (tests cover the 429-then-200 sequence, and the POST 429 case).
- No network call in any test: all fakes are local `Response` objects. The fake sleep records waits without waiting.
- Error messages carry no response text and no header value. Graph's `error.message` reaches the IgError message only through IgError's own redaction.

Known limits, not fixed in this task:
- The client does not register the token with `registerSecret`. The ledger assigns that to Task 9 and Task 17 (register every token on receipt). Nothing in this file logs or stores the token.
- The 15-second timeout is checked by the stub, not by waiting 15 seconds.
- A usage header that is malformed leaves the last stored reading in place (Decision 5).
- The retry and throw ordering was checked by the mutant runs above, but not against a live Graph API. The live phase confirms the Bearer transport, as the brief states.

## Fix round 1 (coordinator request, from task-5-review.md)

Scope: the five items below only. Left alone, as instructed: m-1, m-3, m-5, m-7, m-8, m-9 and m-10.

This round supersedes these earlier statements in this report:
- Decision 2: the Retry-After ceiling is now 60 seconds, not the timer maximum.
- Decision 5 and Known limit 3: a malformed usage header now reaches onUsage as a marker, and a 2xx response returns its data with `usage: null`. It no longer throws API_ERROR.
- "Empty 2xx body" in the earlier text: an empty 2xx body is now success with `data: null`.

### Changes

1. **I-1, Retry-After ceiling.** `MAX_TIMER_MS` is removed. `MAX_RETRY_AFTER_SECONDS = 60` replaces it. A Retry-After of 60 seconds or less is waited for (`seconds * 1000`). A value above 60 is not retried, and the call returns its RATE_LIMITED error. The old test "a Retry-After longer than one timer can wait is not retried" (2147484) is replaced.
2. **I-2, malformed usage header.** `readUsage` returns the marker `{ app: null, business: null, unreadable: '<header name>' }` for the first unreadable header, `x-app-usage` checked first. `onUsage` is called on every response, including with the marker. A 2xx response with an unreadable header returns its data with `usage: null`, and does not throw. A non-OK response still throws its mapped error, so a stop is not hidden. The old test "a malformed usage header is API_ERROR, and onUsage is not called with it" is replaced.
3. **m-2, empty 2xx body.** A 2xx response whose body is empty or whitespace is success with `data: null`. The other half of m-2 (reading usage headers before the body) is not changed, because it was not in this round's list. A body that fails to read still loses usage and onUsage, as the review noted.
4. **m-4, token in a query or form field.** `encodeParams` refuses any key matching `/^access_token$/i` with `IgError('CONFIG')`, before any request. The review suggested VALIDATION; the coordinator's instruction says CONFIG, and CONFIG is used. JSON bodies are not affected, because they do not go into the URL.
5. **m-6 (a) and (b).** (a) is covered by item 1. (b) is a new test: a non-OK response with an OK-looking body is an error. The review's cases (c) (Retry-After: 0) and (d) (a 2xx with `error: null`) are not added, because they were not in the coordinator's list.

Files changed in this round: src/graph/client.js and test/graph-client.test.js. Nothing else.

### Tests added or replaced

Replaced:
- "a Retry-After longer than one timer can wait is not retried" becomes "a Retry-After of 60 seconds is retried" and "a Retry-After over 60 seconds is not retried, and the call returns its error" (values 61 and 2147483).
- "a malformed usage header is API_ERROR, and onUsage is not called with it" becomes "onUsage is called once for a malformed usage header, with the unreadable marker" (covers x-app-usage, then x-business-use-case-usage) and "a 2xx response with a malformed usage header returns its data with usage null, and does not throw".

Added:
- "an empty 2xx body is success with data null, such as a 204 from DELETE" (204 on DELETE, empty 200 on GET).
- "a token in a query or form field is refused with CONFIG before any request" (query `access_token`, query `Access_Token`, form `ACCESS_TOKEN`; zero requests).
- "a non-OK response with an OK-looking body is an error, not success" (500 with `{data: []}` gives API_ERROR, and 429 with `{data: []}` gives RATE_LIMITED).

The client test file went from 27 to 32 tests.

### TDD evidence

RED: the new and replaced tests were run against the round-1 client, before the change to src/graph/client.js:

```
✖ a Retry-After over 60 seconds is not retried, and the call returns its error
✖ onUsage is called once for a malformed usage header, with the unreadable marker
✖ a 2xx response with a malformed usage header returns its data with usage null, and does not throw
✖ an empty 2xx body is success with data null, such as a 204 from DELETE
✖ a token in a query or form field is refused with CONFIG before any request
ℹ tests 32
ℹ pass 27
ℹ fail 5
```

The first Retry-After test (60 seconds retried) and the OK-looking-body test passed before the change. They pin behaviour the client already had, so they are guards, not RED tests.

GREEN: `node --test test/graph-client.test.js`:

```
ℹ tests 32
ℹ pass 32
ℹ fail 0
EXIT=0
```

Mutants, run on a scratch copy of the client and its test in the session scratchpad, then removed:

| Mutant | Result |
|---|---|
| X1: ceiling back to 2147483 seconds | 1 fail |
| X2: empty 2xx body treated as API_ERROR | 1 fail |
| X3: access_token field not refused | 1 fail |
| X4: onUsage skipped for an unreadable header | 1 fail |
| X5: unreadable header throws on a 2xx | 2 fail |
| restored | 32 pass, 0 fail |

### Full suite

Command: `npm test` (from D:\Projects2\InstagramApi). Output saved to D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\npm-test-fix1.txt

```
ℹ tests 223
ℹ suites 0
ℹ pass 223
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2066.3791
EXIT=0
```

223 is the 218 from the first round, plus the 5 net new client tests.

### Concerns carried forward from this round

- Task 13 must check `usage.unreadable` before it calls the gate. The marker has `app: null`, and the gate treats a null reading as "no reading" and passes. Without that check, a malformed header lets outbound calls through. The check should return busy.
- The refusal of `access_token` in a query means Task 9's refresh call cannot put the token in the query. Task 9 must send the token only in the Authorization header. The live phase should confirm that the header works for the refresh endpoint.

## Fix round 2 (m-2, second part, from the coordinator)

This supersedes the round-1 item 3 statement that a body that fails to read still loses usage and onUsage. It no longer does.

### Change

- `fetchText` is split into two functions. `fetchResponse` sends the request, and a failure there is API_ERROR. `readBody` reads the body, and a failure there is API_ERROR.
- `send` now reads the headers first: `readUsage`, then `onUsage`, then `readBody`. So onUsage runs for every response that arrives. A body that fails to read still fails the call with API_ERROR, but only after the usage has gone to the callback.
- No change to the retry rule. A body-read failure is not retried, as before.

Files changed in this round: src/graph/client.js and test/graph-client.test.js. Nothing else.

### Covering test

Added: "a body that cannot be read still sends its usage to onUsage, then fails with API_ERROR". The fake is a response whose headers carry `x-app-usage` and whose `text()` throws `TypeError('terminated')` (helper `unreadableBody`). The test asserts that:
- onUsage receives the parsed usage of that response, once;
- the call rejects with IgError kind API_ERROR;
- exactly one request was made.

### TDD evidence

RED, before the change to src/graph/client.js:

```
✖ a body that cannot be read still sends its usage to onUsage, then fails with API_ERROR (2.7871ms)
ℹ tests 33
ℹ pass 32
ℹ fail 1
EXIT=1
```

GREEN, after the change: `node --test test/graph-client.test.js`:

```
ℹ tests 33
ℹ pass 33
ℹ fail 0
EXIT=0
```

Mutant X6, on a scratch copy with the old order (body read before usage): 1 fail, so the test catches the old behaviour. The scratch copy was removed.

### Full suite

Command: `npm test` (from D:\Projects2\InstagramApi). Output saved to D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\npm-test-fix2.txt

```
ℹ tests 224
ℹ suites 0
ℹ pass 224
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1878.5511
EXIT=0
```

224 is the 223 from round 1, plus the one new test.

### Concerns still open

- Task 13 must check `usage.unreadable` before the gate (round 1).
- m-6 (c) and (d) are still untested: Retry-After of 0, and a 2xx with `error: null`.
- m-3 (onUsage throwing) and m-5 (no response size cap) are deferred, as instructed.
