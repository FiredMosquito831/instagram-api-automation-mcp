# Task 16 review: MCP thin client (task-16-base to task-16-head)

Reviewer: full task gate, read-only. Inputs read: the brief, the global constraints, the ledger (Task 16 entries), the implementer's report, the review diff, src/mcp.js (project copy), src/tools.js, src/errors.js, src/redact.js, src/http.js (tool route and error shapes), test/mcp.test.js, scripts/mcp-spike.mjs, package.json, and the lockfile (base and head, compared by entry).

Focused checks run (named so they can be repeated):
1. `node scripts/mcp-spike.mjs` run once. Exit 0. Its output matches report section 4 line for line (36 tools on both runs, 0 non-protocol stdout lines, four PASS lines). Nothing was written to disk.
2. Grep for console, process.stdout, stdout.write and process.stderr across src/. No matches. The module itself writes nothing.
3. Lockfile entries compared by name between base and head: 13 entries before, 16 after. Added: node_modules/@modelcontextprotocol/core, node_modules/@modelcontextprotocol/server, node_modules/zod. The dependency closure is complete (core needs zod; server needs core and zod).
4. Installed SDK checked in node_modules: package.json of the v2 server and core packages has no install, preinstall, postinstall, prepare, prepack or postpack script. The serveStdio signature is at node_modules/@modelcontextprotocol/server/dist/stdio.d.mts:61.

The test suite was not re-run (651/651 per the report).

## Spec compliance

- ✅ `createMcpServer({ forward, tools })` registers each tool with name, description, input schema and annotations (src/mcp.js:124-136). The annotations are copied from the registry and not rewritten (src/mcp.js:131; registry src/tools.js:99-104). Test test/mcp.test.js:94-110 checks the annotations with deepEqual (line 105).
- ✅ A busy body is a normal result (src/mcp.js:26, 71-72, 103). The HTTP side sends the busy body with status 429 (src/http.js:275-276). Test: test/mcp.test.js:112-122.
- ✅ An error body becomes `isError: true` with exactly one text item, `{"error":{"kind":...,"message":...}}`, and nothing else (src/mcp.js:82-88, 102). Test: test/mcp.test.js:124-141.
- ✅ A non-JSON body, or a JSON body of no known shape, becomes API_ERROR (src/mcp.js:66-71, 101). Tests: test/mcp.test.js:208-225.
- ✅ An unreachable service gives API_ERROR with "ig serve is not running" (src/mcp.js:19, 56-57). The text is a constant that carries no URL and no token. Test: test/mcp.test.js:143-159. The test does not assert the absence of the token (see M-3).
- ✅ `forward` posts to `http://127.0.0.1:<port>/tools/<name>` (src/mcp.js:48) with the token in the Authorization header only (src/mcp.js:51-54). The body is the arguments only. Test asserts the URL, the method, the header and the body: test/mcp.test.js:189-206.
- ✅ The token is a parameter. It is trimmed, registered as a secret, and a blank token is refused (src/mcp.js:38-44). Nothing in the module logs it. ⚠️ Where the token comes from (IG_ environment variable, then keyring) is not in this task; it is the Task 17 entry point's job.
- ✅ `validateArgs(tool.inputSchema, args)` runs before `forward`. A failure is a VALIDATION error result and no request is made (src/mcp.js:95-96). Test: test/mcp.test.js:161-176. This is the carry-forward from Task 14 and Task 15.
- ✅ Logs go to stderr only in the module (focused check 2). The module writes nothing.
- ❌ The spike writes to stdout from its parent process (scripts/mcp-spike.mjs:110-119, 128-129). The controller's rule classes any stdout write outside the SDK transport as Critical. See C-1.
- ✅ `startStdio({ forward, tools })` connects the stdio transport and returns a Promise (src/mcp.js:141-145, serveStdio at line 144).
- ✅ The four brief tests are present with the brief's names (test/mcp.test.js:94, 112, 124, 143). The validateArgs carry-forward has its own test (line 161).
- ✅ No test makes a network call or opens a socket. Tests use FakeTransport (test/mcp.test.js:32-58) or an injected fetch (lines 25-28, 149, 198, 210, 223, 229). The default `globalThis.fetch` (src/mcp.js:34) is never reached by a test.
- ✅ SDK choice (accepted by ruling): `@modelcontextprotocol/server` 2.3.1, pinned exactly (package.json:14). The lockfile change is limited to the three entries in focused check 3, and the root entry matches (lockfile line 11). The npm view scripts are recorded in report section 1. Focused check 4 confirms that the installed v2 packages have no install-time script.
- ⚠️ The v1 npm view output and the claim that v1 has no 2026-07-28 support (report sections 1 and 3) cannot be checked here. v1 is not installed.
- ⚠️ Step 3 reading (accepted by ruling; flagged to the owner): under the brief's literal step, v2 negotiates 2025-11-25 for `initialize`. The 2026-07-28 revision is served through `server/discover` and the envelope. The spike shows this. Not counted as a defect.
- ❌ The brief requires the SDK choice to be recorded in the README (brief line 9). No README exists yet, and this diff does not record the choice. The ledger puts the README in Task 18. See M-1.
- ⚠️ The Context7 record (report section 2) cannot be checked from the workspace; the query results are not kept. The serveStdio signature the code uses is confirmed in the installed SDK types (focused check 4).
- ⚠️ The TDD RED run and the four mutation checks (report section 5) are not in the diff and were not re-run.
- ✅ The spike runs both handshakes in child processes, one per era (scripts/mcp-spike.mjs:32-84, 88-103). It uses a fake forward and no socket, and it prints no token (focused check 1). It sends one message the report does not list: `notifications/initialized` (scripts/mcp-spike.mjs:95). See M-8.
- ⚠️ The bin-based spike against `bin/ig.js` is deferred to Task 17 (ledger R5, report concern 2). Node 22.12 has not been run (ledger, Task 18).

## Strengths

- The module holds no service rule. All rules stay in the HTTP API and the service (src/mcp.js:1-4), as the design requires.
- Body handling fails closed. `isResultBody` (src/mcp.js:24-29) is used twice: on the forwarded body (line 71) and again in `runTool` (line 101). A body that is not JSON, or of an unknown shape, never reads as success.
- The token stays in the header. It is never in the URL, the body, a log, or an error. The fetch failure is caught and its message discarded (src/mcp.js:56-58), so no connection detail or token reaches the caller.
- Every result text and error message passes through `redact` (src/mcp.js:78, 86). `IgError` also redacts its message (src/errors.js:30).
- The registry's annotations are copied, not rewritten (src/mcp.js:131). The registry freezes them (src/tools.js:60-67).
- The standard-schema wrapper passes everything through (src/mcp.js:116), so the SDK never pre-empts the VALIDATION result. The schema advertised by tools/list is the registry's own JSON Schema (src/mcp.js:111).
- The tests assert behaviour and not only that code ran. The validation test checks that `forward` received no call (test/mcp.test.js:174). The secret test checks the exact keys of the error body (lines 137-138).
- The spike reproduces its recorded output exactly (focused check 1). Its checks are the report's checks.

## Issues

### Critical

**C-1. The spike writes report text to stdout.** scripts/mcp-spike.mjs:110-119 and 128-129 use `console.log` in the spike's parent process. The controller's rule classes any stdout write outside the SDK's transport as Critical, so it is listed here. The practical effect is nil: the child's stdout is the protocol, and it carries only frames (0 non-protocol lines in focused check 1). The parent is not an MCP server. Fix: write these lines with `console.error`. If the controller reads the rule as covering the server process only, this can be downgraded to Minor.

### Important

**I-1. No request timeout in `forward`.** src/mcp.js:51-58, and the body read at line 61. If `ig serve` accepts the connection and never answers, or stalls while sending the body, the MCP call waits until the client gives up. The report's gap 1 and concern 3 say the same. This is still true. Fix:
- Add `signal: AbortSignal.timeout(timeoutMs)` to the init at lines 51-55. The same signal covers `response.text()` at line 61.
- Map an abort to API_ERROR with its own message. Lines 56-58 map every fetch rejection to "ig serve is not running", which is wrong for a timeout.
- For a write, the message must say the outcome is unknown, for example: "ig serve did not answer in time; a write may have run; check the status before retrying." Nothing in this module retries, so no other change is needed.
- Choose the ceiling above the longest legitimate call. A container poll is 5 s by 60 polls (src/graph/endpoints/media.js:10-11), so one publish can run for about five minutes. A carousel polls each child (media.js:201). A short fixed value would report a publish that succeeded as failed, and the owner might repeat it. Make the value an option with a generous default, and let the test inject a short one.
- Test: a fetch that never resolves but rejects with an AbortError when its signal fires. It opens no socket. Assert the timeout kind and message.

### Minor

**M-1. The SDK choice is not recorded in a README.** Brief line 9 requires it. No README exists in the project (Task 18 creates it per the ledger). Fix: add a Task 18 carry-forward to record the SDK (v2, 2.3.1, pinned), the Step 3 reading and the owner flag.

**M-2. The input schema test is weak.** test/mcp.test.js:106-107 compares only the property names and the required list. A changed type, enum or description would still pass. Fix: `assert.deepEqual(found.inputSchema, tool.inputSchema)`, after confirming the SDK returns the schema unchanged.

**M-3. The unreachable test does not check for a token or URL.** test/mcp.test.js:156 checks only the regex. Fix: also assert `!body.error.message.includes(API_TOKEN)` and `!body.error.message.includes('http')`.

**M-4. The non-IgError path is untested.** src/mcp.js:97-99 turns any other error into INTERNAL with a fixed text. No test covers it. Fix: add a test where `forward` throws a plain Error whose message holds the token, and assert the result is INTERNAL with no token in its text.

**M-5. The HTTP status is never read.** src/mcp.js:71. A non-2xx response whose body has a `result` key would be accepted as success. The current HTTP API does not do this: its errors are JSON with their status (src/http.js:262, 275-278, and sendFailure at 85-86). So this is defence in depth. Fix: treat any non-2xx response as API_ERROR, unless it is the 429 busy body or carries an error object.

**M-6. `startStdio` drops the transport handle and does not observe transport errors.** src/mcp.js:141-144. `serveStdio` returns a `StdioServerHandle` with `close()` (node_modules/@modelcontextprotocol/server/dist/stdio.d.mts:41-44). The report's section 8 notes that a malformed stdin frame is silent. Also, test/mcp.test.js:234-237 asserts `transport.started` straight after the await, which depends on `serveStdio` starting the transport synchronously. Fix: keep the handle for `close()`. If the error path matters for Task 17, pass an explicit `StdioServerTransport` with an `onerror` that writes one line to stderr. Do not assert timing the SDK does not promise.

**M-7. A misleading comment.** src/mcp.js:142-143 says "checks the arguments now". `build()` only checks that `forward` and `tools` have the right types (lines 125-126). Fix: reword it to say "checks forward and tools now".

**M-8. The spike sends a message the report does not list.** scripts/mcp-spike.mjs:95 sends `notifications/initialized`. Report sections 3 and 4 list only `initialize` and `tools/list`. Fix: add it to the report, or drop it if the SDK does not need it.

**M-9. HTTP-only error kinds reach MCP results.** src/mcp.js:82-88 passes through NOT_FOUND, UNAUTHORIZED, FORBIDDEN and INTERNAL (src/http.js:55, 71, 262, 297). None is in ERROR_KINDS (src/errors.js:6-22). This is not a fail-open, and it matches the Task 15 M-12 deferral. For the final review.

## Assessment

**Spec verdict: ❌.** Every module behaviour in the brief is met (busy, error, non-JSON, unreachable, token placement, validateArgs first, annotations, startStdio). Two items are not: the spike writes report text to stdout (C-1), and the README record of the SDK choice is not made (M-1, a Task 18 item).

**Task quality: Needs fixes.** `forward` has no timeout, so a hung `ig serve` hangs the MCP call (I-1). The spike's stdout writes are Critical under the stated rule (C-1), though the protocol is unaffected.

Counts: Critical 1, Important 1, Minor 9.
