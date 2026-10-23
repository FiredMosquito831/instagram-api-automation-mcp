# Task 16 focused re-review: fix round 1 (task-16-fix1-head)

Reviewer: focused re-review, read-only. No project file was edited. The suite was not re-run (the report holds 659/659).

Inputs read: the findings (task-16-review.md), the ledger's Task 16 entries (progress.md, rulings at the 347 entry), the round 1 report (task-16-report.md, section 9), review-task-16-fix1.diff, src/mcp.js (project copy), the changed areas of test/mcp.test.js, scripts/mcp-spike.mjs, src/tools.js (findTool, annotations), src/http.js (status map), src/graph/endpoints/media.js (publishCarousel).

Focused checks run:
1. `timeout-check` (named): a scratch script at D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task16-rereview\timeout-check.mjs. It starts a loopback HTTP server on 127.0.0.1 with an ephemeral port (no project file is touched), then calls createForward with the real global fetch and a 300 ms timeout. Results:
   - write tool, headers never arrive: fetch rejects with TimeoutError; forward gives API_ERROR with the write message.
   - write tool, body stalls after headers: response.text() rejects with TimeoutError; forward gives the write message.
   - read tool (ig_status), body stalls: forward gives the read message.
   - No case reports "ig serve is not running". So a real body-read timeout is named as a timeout, and a write timeout says the outcome is unknown.
2. grep for `console.` and `process.stdout` in src/mcp.js and scripts/mcp-spike.mjs: no console.log, no process.stdout, no stdout.write. (Only console.error in the spike.)
3. grep in node_modules/@modelcontextprotocol/server/dist: the SDK throws `Tool ${name} is already registered` at mcp-DIH4cS6P.mjs:2152 (for M-7).

The 429-with-error-body path (N-1 area) was checked by tracing the code, not by running it. The trace is in the M-5 verdict.

## Finding verdicts

**I-1 (timeout): ADDRESSED.**
- Default ten minutes: src/mcp.js:23 (DEFAULT_TIMEOUT_MS = 600000). Option at :53. Bounds check (integer, 1 to 2147483647, else CONFIG) at :65-67.
- One `AbortSignal.timeout(timeoutMs)` per call: src/mcp.js:72. It goes to fetch at :79 and covers the body read at :89.
- Fetch failure: :81-84. A timeout maps to `timeoutMessageFor(name)` (:47): the read message (:25) when `readOnlyHint` is true, else the write message (:26), which says "a write may have run, so check the status before you retry". Only a non-timeout failure keeps NOT_RUNNING (:83).
- Body-read failure: :90-92 has the same timeout branch.
- Tests: neverAnswers at test/mcp.test.js:237 (fake fetch that rejects with AbortError when its signal fires; no socket). Write timeout test :251 (timeoutMs 20; asserts API_ERROR, the exact write message, one request, and an AbortSignal on it). Read timeout test :265. Body timeout test :273 (TimeoutError). Timeout option test :290.
- The focused check above confirms the real fetch rejects with TimeoutError in all three cases, and each maps to the right message.
- The ten-minute ceiling itself is accepted (ledger ruling). Its supporting comment is wrong for carousels: see N-3.

**M-5 (status before body): ADDRESSED.**
- Status is read first: src/mcp.js:86. The body is read at :89 and parsed at :96.
- Non-2xx branch: :100-103. The carve-out at :102 is `status === 429 && body?.busy === true`, so it tests the busy body and not the status alone. An error object (`isErrorBody`) is also passed on at :102.
- Critical check, a 429 with an error body (CAP_EXCEEDED, which the real HTTP API sends as 429: src/http.js:38, and the error body via sendJson at src/http.js:86): :102 returns the body. runTool at :136 checks `body.error` before the busy check at :137, so the result is `isError: true` with the CAP_EXCEEDED kind. It is not a busy result, even when the body also carried `busy: true`. Code-traced, not run. No test covers this case (N-1).
- Non-2xx without an error object: :103, API_ERROR (BAD_RESPONSE).
- Non-JSON on any status: :97-99, API_ERROR before the status check, so it is never a success.
- 2xx: :105 requires a known shape. A 2xx without `result` is API_ERROR.
- Tests: 500 with a result body, test/mcp.test.js:300 (forward rejects with API_ERROR; MCP result is isError). 429 busy, :313 (not isError; text equals the busy body). 409 error body, :324 (isError with kind STOPPED).
- Gap: no test for a 429 with an error body. See N-1.

**M-2 (schema deep-equal): ADDRESSED.** test/mcp.test.js:106 is `assert.deepEqual(found.inputSchema, tool.inputSchema, ...)`, run for every tool in the loop at :94-110. The old key-name and required checks are gone. The file imports the strict assert (line 2), so the comparison is strict.

**M-3 (token and URL absent): ADDRESSED.** test/mcp.test.js:156-157 assert the API_TOKEN value and '127.0.0.1' are absent from the message. The token is a fixed test value (test/mcp.test.js:5). The message is a constant, so this is a regression guard, and it is meaningful as one.

**M-4 (plain Error gives INTERNAL): ADDRESSED.** test/mcp.test.js:335-351. The forward throws a plain Error whose message holds a registered secret. The test asserts kind INTERNAL, message 'the tool call failed', and no secret in the text. The code path is src/mcp.js:132-133.

**M-7 (comment matches build()): ADDRESSED.** src/mcp.js:177-179 now says that build() runs createMcpServer once, which throws for a forward that is not a function (:159), a tools value that is not a list (:160), or a duplicate tool name. The duplicate case is the SDK's `Tool ... is already registered` (focused check 3). The comment matches the code.

**C-1 (spike console.log to console.error, Minor): ADDRESSED.** scripts/mcp-spike.mjs:110-129 uses console.error at every parent output line. Focused check 2 finds no console.log in the file.

## New breakage

**N-1. Minor. Test gap on the M-5 critical case.** No test sends a 429 with an error body (for example `{"error":{"kind":"CAP_EXCEEDED",...}}`). The code is correct (src/mcp.js:102, :136-137), and the HTTP API produces exactly this response (src/http.js:38). The ledger asks the re-review to check it. Add a test at about test/mcp.test.js:313: a 429 whose body is a CAP_EXCEEDED error, asserting isError true, kind CAP_EXCEEDED, and that the text is not the busy body.

**N-2. Minor. A non-numeric status is read as 2xx (hardening).** src/mcp.js:100 is `if (status < 200 || status > 299)`. An undefined or NaN status fails both comparisons, so it goes down the 2xx path. Global fetch always gives a numeric status, so this is not reachable in production. Write the test as `if (!(status >= 200 && status <= 299))` to close it.

**N-3. Minor. The ten-minute comment understates a carousel publish.** src/mcp.js:21-22 says a publish "can run about five minutes". publishCarousel polls each child in turn (src/graph/endpoints/media.js:198-201), with up to 60 polls of 5 s per child (media.js:10-11), then polls the parent container. A slow ten-item carousel can therefore run past ten minutes, and the ceiling would cut it off. The cut-off is reported with the write message, so it is not silent, and nothing retries. Fix: correct the comment, and re-flag the default to the owner with the carousel case. The ruling at progress.md's 347 entry rests on "about five minutes".

Checked, no new breakage:
- A timeout reported as "ig serve is not running": none. The timeout branch comes first (src/mcp.js:82, :91).
- A write timeout that does not say the outcome is unknown: none (focused check 1).
- A token in the timeout message or a URL: none. The timeout texts are constants (src/mcp.js:25-26). The fetch failure message is discarded.
- A 2xx without a result read as success: none (src/mcp.js:105).
- A non-JSON body on a non-2xx read as success: none (src/mcp.js:97-103).
- A test that passes without asserting its claim: none. The timeout, status and INTERNAL tests assert kind, message, and the absence of the secret.
- A fail-open path: only N-2, not reachable with global fetch.

## Round verdict

Findings remaining, Minor only. Critical: 0. Important: 0. Minor: 3 (N-1, N-2, N-3).

All in-scope items (I-1, M-2, M-3, M-4, M-5, M-7, C-1) are ADDRESSED. Out of scope and not verdicted: M-1, M-6, M-8, M-9.
