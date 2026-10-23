# Task 16 report: MCP thin client

Status: DONE_WITH_CONCERNS. The SDK is v2, `@modelcontextprotocol/server` 2.3.1, pinned exactly. One step of the brief's Step 3 could not be run as written, and it was changed (see Concerns).

## 1. npm view (run before the install)

`@modelcontextprotocol/server` (first choice):
- version: `2.3.1` (dist-tag latest: 2.3.1)
- scripts: `lint`, `test` (vitest), `build` (tsdown), `check`, `lint:fix`, `typecheck`, `test:watch`, `build:watch`. No `install`, `preinstall`, `postinstall` or `prepare` script.

`@modelcontextprotocol/sdk` (fallback, v1):
- version: `1.32.1` (dist-tag latest: 1.32.1)
- scripts: `lint`, `test`, `build`, `check`, `start`, `client`, `server`, `prepack`, `lint:fix`, `test:e2e`, `build:cjs`, `build:esm`, `typecheck`, `test:watch`, `build:cjs:w`, `build:esm:w`, `fetch:spec-types`, conformance and example scripts. No install, preinstall, postinstall or prepare script.

Install: `npm install --ignore-scripts --save-exact @modelcontextprotocol/server@2.3.1` (added 3 packages, 0 vulnerabilities). No install-time script ran. The package pulls `@modelcontextprotocol/core` 2.3.1 and `zod` (^4.2.0).

## 2. Context7 queries

- `resolve-library-id` with `@modelcontextprotocol/server` returned unrelated libraries (a community doc set, ext-apps, a Python scaffold, a reference server). None was used.
- `resolve-library-id` with `@modelcontextprotocol/sdk` returned the official repo `/modelcontextprotocol/typescript-sdk`, which lists version v2.3.1. The version-pinned ID `/modelcontextprotocol/typescript-sdk/v2.3.1` was used for three `query-docs` calls, one concept each:
  1. Server construction: `new McpServer({name, version}, {capabilities})`.
  2. Tool registration with annotations: `server.registerTool(name, {description, inputSchema, annotations}, handler)`, with `readOnlyHint`, `destructiveHint`, `idempotentHint`.
  3. The stdio transport: `StdioServerTransport` and `serveStdio` from `@modelcontextprotocol/server/stdio`.
- The Context7 docs did not cover two points, so they were taken from the installed package (`dist/*.d.mts`, `dist/*.mjs`) and from experiments:
  - `registerTool` takes a standard schema, not a raw JSON Schema (the `StandardSchemaWithJSON` type, which needs `~standard.validate` and `~standard.jsonSchema`).
  - The 2026-07-28 handshake (`server/discover` and a per-request `_meta` envelope). The docs did not describe it.

## 3. SDK choice and reason

Chosen: v2, `@modelcontextprotocol/server` 2.3.1.

Reason: it serves the 2026-07-28 revision. A client sends `server/discover`, and the server answers `supportedVersions: ["2026-07-28"]`. Requests that carry `params._meta["io.modelcontextprotocol/protocolVersion"] = "2026-07-28"` and `io.modelcontextprotocol/clientCapabilities` are then served (`tools/list` returns the full list). This works through `serveStdio`.

Why not v1: `@modelcontextprotocol/sdk` 1.32.1 has no support for 2026-07-28 at all. Its tarball has no file that names the revision, and its supported list ends at 2025-11-25. Falling back to v1 would not meet the criterion and would lose the revision.

Deviation from the brief's Step 3: the literal step (send `initialize` with `protocolVersion: "2026-07-28"` and expect 2026-07-28) cannot succeed in v2. `initialize` is the 2025 handshake, and it negotiates `2025-11-25` even when `2026-07-28` is in `supportedProtocolVersions` (tested). Sending `initialize` with the envelope claim returns `-32601`. The revision is selected only through `server/discover`, as the SDK's own comments say ("2026-era entries are only ever selected via server/discover"). The spike therefore runs both handshakes, each in its own child process, because a connection is pinned to one era by its first message. The messages sent are: run 1 (2025 handshake) `initialize` (id 1), `notifications/initialized` (a notification, no id), and `tools/list` (id 2); run 2 (2026-07-28) `server/discover` (id 1) and `tools/list` (id 2), each with the envelope in `_meta`. The controller should confirm this reading of Step 3.

## 4. Spike output

Command: `node scripts/mcp-spike.mjs` (exit 0). The messages sent are listed in section 3, and run 1 includes `notifications/initialized`. In round 1 the report moved from stdout to stderr (section 9); this block is the original run.

```
2025 handshake (initialize asked for 2026-07-28) negotiated: 2025-11-25
2025 handshake tools listed: 36 (TOOLS.length 36)
2026-07-28 advertised by server/discover: 2026-07-28
2026-07-28 tools listed: 36 (TOOLS.length 36)
stdout frames: legacy 2, 2026-07-28 2
non-protocol stdout lines: legacy 0, 2026-07-28 0
child exit codes: legacy 0, 2026-07-28 0
PASS: 2026-07-28 is advertised and served
PASS: 2026-07-28 tool count equals TOOLS.length
PASS: stdout holds only protocol frames (both runs)
PASS: both children exited cleanly
note: initialize does not select 2026-07-28 in this SDK; it negotiated 2025-11-25 (the 2025 handshake).
```

Negotiated version for the revision: `2026-07-28`. Tool count: 36, equal to `TOOLS.length`. Stdout held only protocol frames in both runs (every line was a JSON-RPC 2.0 frame, and none was logged). The spike uses a fake forward and no socket. The spike against `bin/ig.js` is re-run in Task 17, because `bin/ig.js` does not exist yet.

## 5. TDD evidence

RED (before `src/mcp.js` existed): `node --test test/mcp.test.js` failed to load the file (`ERR_MODULE_NOT_FOUND` for `src/mcp.js`). 0 of 11 tests ran; the file failed.

GREEN (after the implementation): `node --test test/mcp.test.js` gave 11 pass, 0 fail. The run was repeated after the `startStdio` change to `serveStdio`, with 11 pass, 0 fail.

Mutation check (one change at a time to `src/mcp.js`, original restored afterwards; each change was caught by the test it targets):
- M1, no `validateArgs` before `forward`: "a call with arguments that fail validation is refused before any request" fails.
- M2, busy body becomes `isError`: "a busy body comes back as a normal result" fails.
- M3, error message not redacted: "an error body comes back with isError true and no secret text" fails.
- M4, non-JSON body treated as success: "a body that is not JSON is an API_ERROR, not a success" fails.

Full suite: `npm test` gave 651 pass, 0 fail, exit 0. The ledger's count before this task was 640, so this task adds 11. No process warning was printed (the two "warning" lines in the output are test names from another file).

Tests (test/mcp.test.js, 11):
1. createMcpServer registers every tool with its annotations (the brief's test)
2. a busy body comes back as a normal result (the brief's test)
3. an error body comes back with isError true and no secret text (the brief's test)
4. an unreachable service gives an API_ERROR result that says ig serve is not running (the brief's test)
5. a call with arguments that fail validation is refused before any request (carry-forward)
6. a successful body comes back as its result
7. createForward posts to the loopback tools route with the bearer token and returns the parsed body
8. a body that is not JSON is an API_ERROR, not a success
9. a JSON body with no result, error or busy field is an API_ERROR, not a success
10. createForward refuses a blank api token
11. startStdio connects the transport it is given

No test makes a network call or opens a socket. The forward takes an injected `fetch` (the unreachable test injects one that rejects with ECONNREFUSED), and the MCP tests use an in-memory transport.

## 6. Files changed

- `package.json`: one line added, `"@modelcontextprotocol/server": "2.3.1"` (exact). The `test` script is unchanged (R9).
- `package-lock.json`: three entries added (`node_modules/@modelcontextprotocol/core`, `node_modules/@modelcontextprotocol/server`, `node_modules/zod`). No existing entry was changed or removed.
- `src/mcp.js` (new, 145 lines): `createForward`, `createMcpServer`, `startStdio`.
- `test/mcp.test.js` (new, 238 lines): 11 tests.
- `scripts/mcp-spike.mjs` (new, 131 lines): the protocol spike.
- `.superpowers/sdd/2026-10-20-instagram-automation-build/task-16-report.md` (this file).

Not changed: `src/tools.js` and `src/http.js`, as the brief requires.

Experiments (outside the project, under `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task16`): the handshake probes for `serveStdio`, the envelope probes, and the v1 tarball check. None is part of the change.

## 7. Design notes

- `createMcpServer({ forward, tools = TOOLS })` registers each tool with `description`, `annotations` (a copy of the registry's four hints) and an input schema. The schema is a standard-schema wrapper around the registry's own JSON Schema, which is what `tools/list` advertises unchanged.
- The wrapper's `validate` is a pass-through. The SDK's own refusal is a JSON-RPC `InvalidParams` error with a different shape, so it would replace our VALIDATION result. The handler runs `validateArgs(tool.inputSchema, args)` before `forward`, so a bad call gets `{"error":{"kind":"VALIDATION",...}}` and makes no request.
- `createForward({ port, apiToken, fetch })` posts to `http://127.0.0.1:<port>/tools/<name>` with `Authorization: Bearer <token>` and a JSON body. It registers the token as a secret (a blank or short token is refused with CONFIG). It returns the parsed body when the body has one of the three shapes the HTTP API sends (`busy`, `error`, or `result`). Anything else is API_ERROR, including a non-JSON body and a connection failure. A connection failure gives the message `ig serve is not running. Start it with: ig serve`.
- Tool results: success is `{content:[{type:"text", text: JSON(result)}]}`. A busy body is an ordinary result with the busy body as its text. An error body (and any failure) is `isError: true` with exactly one text item, `{"error":{"kind":...,"message":...}}`. Every text passes through `redact`.
- `startStdio({ forward, tools, transport })` serves through `serveStdio` (from `@modelcontextprotocol/server/stdio`), not a plain `server.connect`. `serveStdio` serves both eras. A plain connect serves only the 2025 handshake; the first version of this module used a plain connect, and the spike caught that the 2026 path was missing. The `transport` option is an addition for tests; it is not in the brief's interface.
- Nothing in `src/mcp.js` writes to stdout (grep: no `console.`, no `process.stdout`, no `stdout.write`).

## 8. Self-review

Read against the brief and the global constraints:
- The four brief tests are present, with the brief's names, and pass. The carry-forward (validateArgs before each handler) is covered by test 5 and mutation M1.
- Fail closed: a non-JSON body, an unknown body shape and a connection failure are all API_ERROR (tests 8, 9, 4). Mutation M4 confirms test 8 is not vacuous.
- Redaction: every result text and every error message goes through `redact`. The no-secret test registers a secret and checks that the text does not contain it (test 3, mutation M3).
- Owner-only and tokens: the bearer token is sent only in the `Authorization` header, never in the URL or the body. A blank token is refused.
- The only stdout writer is the SDK's stdio transport, which carries the protocol frames (spike: non-protocol lines 0).
- Tests: no network, no socket, no real stdin/stdout (tests 1 to 11 use `FakeTransport` or an injected `fetch`).
- Gaps I left open:
  - `createForward` has no request timeout. A hung `ig serve` hangs the MCP call until the client gives up.
  - The `INTERNAL` result kind (for an unexpected error inside the MCP layer) is not an `IgError` kind. It matches the kind `http.js` already uses for unexpected errors.
  - `startStdio` returns `void` (per the brief), so the `serveStdio` handle is dropped. The server stops only when stdin closes.
  - The SDK's protocol-level `onerror` is not wired, so a malformed stdin frame is silent.
  - Node 22.12 was not run. This machine runs Node 24.6.0. Carry-forward to Task 18, as in earlier tasks.
  - The brief's `initialize` step cannot negotiate 2026-07-28 in v2 (see section 3). Task 17 must use `serveStdio` for `ig mcp` as well.

## Concerns

1. Step 3 deviation. The brief's literal `initialize` step cannot negotiate 2026-07-28 with v2 or v1. The spike runs the revision's real handshake (`server/discover`). The controller should confirm this reading.
2. The bin-based spike (`node bin/ig.js mcp`) is re-run in Task 17. Task 17 must start the MCP server with `startStdio`, which uses `serveStdio`.
3. No request timeout in `createForward`. A hung `ig serve` hangs the call.
4. Node 22.12 not run (this machine has Node 24.6.0). Carry-forward to Task 18.

## 9. Fix round 1 (review task-16-review.md)

Scope: the eight items the coordinator listed, and nothing else. Deferred items stay deferred: M-1 (README, Task 18), M-6 (`startStdio` handle and transport errors, final review), M-9 (accepted). Round 1 closes the timeout gap in section 8 (gap 1) and Concern 3 above; those sections are left as they were written.

### Changes, with file and line (current numbers)

| Item | File and lines | Change |
|---|---|---|
| I-1 timeout | `src/mcp.js:23-26` (constants), `:47` (`timeoutMessageFor`), `:53` (`createForward` option), `:65-67` (check), `:71-82` (signal and fetch failure), `:91` (body read) | `createForward` takes `timeoutMs`, default 600000. It must be an integer from 1 to 2147483647, otherwise CONFIG. One `AbortSignal.timeout(timeoutMs)` per call goes to `fetch` and covers `response.text()`. An AbortError or TimeoutError is API_ERROR with its own message. A tool whose `readOnlyHint` is not true, and any name not in the registry, gets the write message. A read tool (`readOnlyHint` true) gets the read message. Any other fetch failure keeps "ig serve is not running". |
| M-5 status | `src/mcp.js:86` (status read before the body), `:100-103` | The status is read before the body is trusted. Outside 200-299, the body is passed on only if it is an error body, or the busy body of a 429. Any other body is API_ERROR. A 2xx body must still have a known shape. |
| M-7 comment | `src/mcp.js:177-179` | The comment now says what `build()` does: it runs `createMcpServer` once, which throws for a forward that is not a function, a tools value that is not a list, or a tool the SDK refuses (a duplicate name). The duplicate case was checked by running it. The comment is wrapped to two lines. |
| C-1 stdout | `scripts/mcp-spike.mjs:110-129` (all 11 parent output calls) | `console.log` changed to `console.error`. The parent writes nothing to stdout. `grep` finds no `console.log` left in the spike. |
| M-2 schema | `test/mcp.test.js:106` | Assertion changed (below). |
| M-3 token and URL | `test/mcp.test.js:156-157` | Two assertions added (below). |
| M-4 INTERNAL | `test/mcp.test.js:335` | New test (below). |
| M-8 message list | This report, sections 3 and 4 | `notifications/initialized` listed. |

Judgement calls, to be checked by the reviewer:
- The coordinator's rule for M-5 ("a non-2xx response whose body is not an error object is API_ERROR") would have turned the HTTP API's busy response (429 with `{busy:true,...}`) into an error. The brief requires a busy body to be a normal result, so the 429 busy body is passed on. The reviewer's text names this carve-out too. Test: the 429 busy test below.
- A timeout value of 2147483647 is accepted, because it is the longest timer the runtime allows (the global constraint).

### Test changes, old and new assertions

M-2, `test/mcp.test.js:106-107` (old, two lines):
```
assert.deepEqual(Object.keys(found.inputSchema.properties ?? {}).sort(), Object.keys(tool.inputSchema.properties).sort());
assert.deepEqual(found.inputSchema.required ?? [], tool.inputSchema.required);
```
New, one line at `:106`:
```
assert.deepEqual(found.inputSchema, tool.inputSchema, `${tool.name} has its input schema`);
```
The SDK returned each of the 36 schemas unchanged, so the deep equality holds.

M-3, `test/mcp.test.js:156-157`. Added after `assert.match(body.error.message, /ig serve is not running/);`. Nothing was removed:
```
assert.ok(!body.error.message.includes(API_TOKEN), 'the token is not in the message');
assert.ok(!body.error.message.includes('127.0.0.1'), 'the URL is not in the message');
```

New tests (eight), with the new helper `neverAnswers` at `test/mcp.test.js:237`. The helper is a fake fetch that never answers and rejects with an AbortError when its signal fires. It opens no socket.
1. `a write that times out is an API_ERROR that says a write may have run` (`:251`). Asserts the API_ERROR kind, the exact write message, one request started, and that the request carries an AbortSignal. Uses `timeoutMs: 20`.
2. `a read that times out is an API_ERROR that says ig serve did not answer in time` (`:265`). Asserts the read message.
3. `a body that does not finish before the timeout is cut off the same way` (`:273`). The fake body read rejects with a TimeoutError. Asserts the read message.
4. `createForward refuses a timeout that is not a whole number of milliseconds in range` (`:290`). Asserts CONFIG for 0, -1, 1.5, 2147483648 and '100', and that 2147483647 is accepted.
5. `a 500 response whose body has a result is isError, never a success` (`:300`). The body is `{"result":{}}` with status 500. Asserts the forward rejects with API_ERROR, and the MCP result is isError with API_ERROR.
6. `a 429 busy response from the HTTP API comes back as a normal busy result` (`:313`). Asserts the result is not isError, and the text is the busy body.
7. `a 409 error body from the HTTP API comes back as isError with its kind` (`:324`). Asserts isError, and the text is the error body with kind STOPPED.
8. `an unexpected error inside forward is INTERNAL with a fixed text and no secret` (`:335`). M-4. A plain Error whose message holds a registered secret. Asserts kind INTERNAL, the message `the tool call failed`, and no secret in the text.

Tests 4, 6 and 7 are beyond the named list. Each covers a rule that the round changes or depends on (the timeout option, the busy carve-out, and the error-body branch of M-5).

### Verification

Mutation checks on the new behaviour (one change at a time, original restored afterwards):
- M5, status check removed (`if (status < 200 || status > 299)` replaced by `if (false)`): 1 test fails, "a 500 response whose body has a result is isError, never a success". 18 of 19 pass.
- M6, timeout never recognised (`isTimeout` replaced by `() => false`): 3 tests fail, the write, read and body timeout tests. 16 of 19 pass.

Spike, after the change (`node scripts/mcp-spike.mjs > spike.stdout.txt 2> spike.stderr.txt`). Exit 0. The stdout file is 0 bytes. The stderr file holds the report:
```
2025 handshake (initialize asked for 2026-07-28) negotiated: 2025-11-25
2025 handshake tools listed: 36 (TOOLS.length 36)
2026-07-28 advertised by server/discover: 2026-07-28
2026-07-28 tools listed: 36 (TOOLS.length 36)
stdout frames: legacy 2, 2026-07-28 2
non-protocol stdout lines: legacy 0, 2026-07-28 0
child exit codes: legacy 0, 2026-07-28 0
PASS: 2026-07-28 is advertised and served
PASS: 2026-07-28 tool count equals TOOLS.length
PASS: stdout holds only protocol frames (both runs)
PASS: both children exited cleanly
note: initialize does not select 2026-07-28 in this SDK; it negotiated 2025-11-25 (the 2025 handshake).
```
The messages are the same as in section 3, with `notifications/initialized` sent in run 1.

`npm test` (after the last edit): exit 0.
```
ℹ tests 659
ℹ suites 0
ℹ pass 659
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
That is 651 before this round plus 8 new tests. `test/mcp.test.js` alone: 19 pass, 0 fail.

No socket or network call: `test/mcp.test.js` has no `listen`, `createServer`, `http.request` or `net.connect` (grep). `src/mcp.js` has no `console.`, `process.stdout` or `stdout.write` (grep).

## 10. Fix round 2 (re-review task-16-rereview-1.md)

Scope: the three items from the focused re-review, and nothing else. N-1 is a test gap, N-2 is hardening, N-3 is a comment. Deferred items stay deferred (M-1 README, Task 18; M-6 final review; M-9 accepted). The re-review's other verdicts (I-1, M-2, M-3, M-4, M-5, M-7, C-1) stand as recorded in section 9.

### Changes, with file and line (current numbers)

| Item | File and lines | Change |
|---|---|---|
| N-3 comment | `src/mcp.js:21-25` | The comment now says: a reel publish can poll its container for about five minutes (5 seconds by 60 polls); a carousel polls each child in turn, so one carousel can run well past the default of ten minutes, and the ceiling then cuts it off; a timed-out write says that a write may have run, so the owner checks the status before retrying, and its outcome is unknown. The default is unchanged (`DEFAULT_TIMEOUT_MS = 600000`, line 25). |
| N-2 hardening | `src/mcp.js:102` | `if (status < 200 \|\| status > 299)` is now `if (!(status >= 200 && status <= 299))`. An undefined or NaN status fails the 2xx test, so it is refused. |
| N-1 test | `test/mcp.test.js:324`, `:337` | Two new tests (below). |
| N-2 test | `test/mcp.test.js:350` | New test (below). |

No other source line changed. The carve-out at `src/mcp.js:104` (`isErrorBody(body) || (status === 429 && body?.busy === true)`) is unchanged, as is the handling at `:138-139` (the error check runs before the busy check).

### New tests (three)

1. `a 429 whose body is an error object is isError with its kind, not a busy result` (`test/mcp.test.js:324`). The fake response is status 429 with the body `{"error":{"kind":"CAP_EXCEEDED","message":"the daily cap is reached"}}`, the same shape the HTTP API sends. Asserts `isError` true, the body deep-equals the error body, and `busy` is absent from the text.
2. `a 429 that is neither busy nor an error is an API_ERROR, not a success` (`:337`). The fake response is status 429 with the body `{"result":{}}`. Asserts `forward` rejects with API_ERROR, and the MCP result is isError with API_ERROR. This test is added because test 1 cannot tell a status-only carve-out from the real one (see the mutation results below).
3. `a response with no numeric status is an API_ERROR, never a success` (`:350`). Loops over `undefined` and `NaN` as the status, with the body `{"result":{}}`. Asserts `forward` rejects with API_ERROR for each.

No existing assertion was changed in this round.

### Mutation results (item 1)

Each mutation was made in `src/mcp.js` by a scripted exact replacement. The file was then restored from a copy made before the round, and `diff` confirmed the restore. Each run was `node --test test/mcp.test.js`.

- M7, the literal status-only carve-out. The carve-out at line 104 is replaced by `if (status === 429) return body;`.
  - Result: N-1 test (`a 429 whose body is an error object ...`) PASSES. A 429 with an error body still reaches the error branch in `runTool`, so the result is isError with CAP_EXCEEDED. The test cannot tell a status-only carve-out from the real one.
  - Also fails: `a 429 that is neither busy nor an error ...` (the `{"result":{}}` 429 becomes a success) and `a 409 error body ...` (this mutation also drops the error-body carve-out for other statuses, so a 409 error body becomes API_ERROR). 2 fail, 20 pass.
- M8, the old status comparison. Line 102 is replaced by `if (status < 200 || status > 299) {`.
  - Result: `a response with no numeric status ...` FAILS (an undefined status reads as 2xx, and the `{"result":{}}` body becomes a success). 1 fails, 21 pass.
- M9, every 429 read as busy. Line 104 is replaced by `if (status === 429) return { busy: true, reason: 'busy', retryAfterMs: 0 };`.
  - Result: N-1 test FAILS, as the coordinator asked. It also fails the busy test, the neither test, and the 409 test. 4 fail, 18 pass.

Reading: N-1, on its own, fails only when the 429 error body is read as busy (M9). A status-only carve-out that still lets error bodies through (M7) is caught by test 2 of this round, not by test 1.

### Verification

- `node --test test/mcp.test.js`: 22 pass, 0 fail (19 before this round, plus 3).
- `npm test` (after the last edit): exit 0.

```
ℹ tests 662
ℹ suites 0
ℹ pass 662
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

That is 659 before this round plus 3 new tests. Process warnings in the output: 0. No `console.log`, `process.stdout` or `stdout.write` in `src/mcp.js` or the spike. No `listen`, `createServer`, `http.request` or `net.connect` in `test/mcp.test.js`.

The spike was not re-run in this round, because the round changed only `forward` and a comment, and the spike does not call `forward` (it uses a fake forward). Its last result is in section 9.
