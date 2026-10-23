# P5b review: O-10 (HTTP 423 for stops) and A-32 (MCP transport errors)

Base: snap/p5a-head. Head: snap/p5b-head. At review time src/mcp.js, src/http.js, test/mcp.test.js and test/http.test.js match the head snapshot byte for byte.

Method. Read-only on the project: no file edited, no git, and the suite was not re-run. Behaviour was checked with probes in the scratchpad that drive the real SDK transport (StdioServerTransport on in-process PassThrough streams, and the real process stdin and stdout through a pipe). The probes are not part of the suite.

Sources read: progress.md (OWNER DECISIONS, O-10; the A-32 ruling at line 456); global-constraints.md (lines 4 and 26, the secrets rules); task-15-report.md (P5b section, lines 266-410); review-p5b.diff (the P5b hunks for src/http.js, src/mcp.js, test/http.test.js and test/mcp.test.js, read in full); the SDK 2.3.1 source in node_modules/@modelcontextprotocol/server/dist (stdio.mjs, src-Cqbh3MYc.mjs).

## Verdicts

| Item | Verdict | Evidence (file:line) |
|---|---|---|
| (a) O-10 status map | ADDRESSED | src/http.js:38-47. AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, RATE_LIMITED are 423 (41-44). STOPPED is 409 (40). VALIDATION is 400 (39). An unknown kind is 500 (src/http.js:72, `?? 500`), and the kind stays in the body (sendFailure, src/http.js:92-94). |
| (a) MCP client mapping | ADDRESSED | src/mcp.js:104-107: a failed status with an error body is passed on, and no status is turned into a kind. src/mcp.js:141: runTool passes `body.error.kind` unchanged. src/mcp.js:121-127: errorResult keeps the kind as String(kind) and redacts the message. test/mcp.test.js:413-424 asserts isError true and an unchanged body for the four stop kinds. |
| (a) in-repo consumers | ADDRESSED | `ig status` (src/cli.js:548-575) reads only `body.error.kind`, and checks only 401. A 423 does not break it. |
| (b) I/O failure: one stderr line, name only, exit 1 after the flush | ADDRESSED | src/mcp.js:243-249 (decide: one line, then flushThen), 264-276 (onerror wrapper), 185-187 (plainNameOf), 197-199 (errorLineFor), 208-220 (flushThen; backstop FLUSH_LIMIT_MS at 182). Probes C, D, F, and the real-pipe EPIPE run: one line, exit 1. Tests at test/mcp.test.js:465, 481, 513. |
| (b) failed start | ADDRESSED | src/mcp.js:252-258 (start wrapper). serveStdio keeps the rejection to itself (stdio.mjs, `started.catch`), so the wrapper's rethrow causes no unhandled rejection. Test at test/mcp.test.js:529. |
| (b) clean close: exit 0, no stderr | ADDRESSED | src/mcp.js:277-283. Probe E (in-process and real stdin): exit 0, zero stderr bytes, 275 ms. Test at test/mcp.test.js:498. |
| (b) framing error (valid JSON that is not JSON-RPC): one line, no exit | ADDRESSED | src/mcp.js:193-194 (isFramingError), 202-204 (framingLineFor), 269-271. Probes A and B. Tests at test/mcp.test.js:584, 565. |
| (b) parse error, non-JSON line: one line, no exit | NOT ADDRESSED for the log line (no exit is correct). See I-2. | The SDK drops it before the transport: src-Cqbh3MYc.mjs:7185 `if (error instanceof SyntaxError) continue;`. Probe A logged nothing for the non-JSON line. |
| (b) stderr never has the message, a frame or a secret | ADDRESSED for our lines | Names only, matched by `^[A-Za-z]{1,40}$` (src/mcp.js:186). Probe G: a token-bearing invalid frame gave no token in stderr. Exception: Node and SDK warnings (M-2). |
| (c) no real stdio, socket or port in the new tests | ADDRESSED | test/http.test.js:876-880 stubs Server.prototype.listen; line 883 asserts the CONFIG refusal. No other listen or createServer call in that file. test/mcp.test.js: every startStdio call (409, 468, 484, 501, 516, 531, 548, 568, 587, 602) passes an injected transport, and the stubs for exit, stderr and stdout are injected in each call that can reach decide. createForward gets an injected fetch (413). clientFor uses FakeTransport (63). The existing call at 407-410 is the exception: see M-4. |
| (d) many malformed frames do not end the process | ADDRESSED | Probe B: 500 invalid-RPC frames gave exits []. Probe A: non-JSON lines are silent. The process stays up. Log volume is not capped: M-1. |
| (d) a client that closes stdin exits 0 | ADDRESSED | Probe E and the real-stdin run: exit 0. Test at test/mcp.test.js:498. |
| (d) the exit path is not triggered by a client in a way the rule did not intend | NOT ADDRESSED | One frame over 10 MiB with no newline ends the process with exit 1. See I-1. |
| (e) missing or wrong token is still 401 | ADDRESSED | src/http.js:265-270: method, then token, then the tool lookup and body read. Tests at test/http.test.js:111 and 148. |
| (e) Host outside allowedHosts is still 403 | ADDRESSED | src/http.js:302-305: the Host check is first in route(). Test at test/http.test.js:271-285. |
| (e) 423 only after authentication | ADDRESSED | The 423 mapping is applied only in failureOf (src/http.js:66-76), which handles an IgError thrown by a tool handler after the token check. HttpFailure never carries a stop kind (its kinds: NOT_FOUND, METHOD_NOT_ALLOWED, UNAUTHORIZED, FORBIDDEN, PAYLOAD_TOO_LARGE, VALIDATION). The webhook path throws nothing before the HMAC check (src/webhooks.js:263-268), so a 423 there follows signature verification. |
| (f) no secret in the new body, header or stderr line | ADDRESSED | The 423 body is `{ error: { kind, message } }` through sendFailure, which redacts (src/http.js:92-94). failureOf adds no headers (src/http.js:77). IgError's constructor redacts its message (src/errors.js). The MCP result is redacted by errorResult (src/mcp.js:125). Stderr lines hold only the name (src/mcp.js:185-204). Test at test/mcp.test.js:465-479 checks that the message text is absent. |

## Findings

### I-1 (Important): one client frame over 10 MiB ends the MCP process (items b, d)

Evidence. The SDK's ReadBuffer has a 10 MiB limit (src-Cqbh3MYc.mjs:7159). When it is exceeded, `append` throws an Error named `Error` (src-Cqbh3MYc.mjs:7172). StdioServerTransport's `_ondata` then calls onerror and close (stdio.mjs:45-52). src/mcp.js:269-272 treats that error as an I/O failure and calls decide(1). Probe C (in-process) and a real-stdin run of 10 MiB + 1 bytes both gave exit 1 and the line `ig mcp: transport error: Error`. Test at test/mcp.test.js:599 codifies the behaviour.

Why it matters. The ruling (progress.md line 456) says a malformed frame does not end the process, and only I/O failures do. An oversize frame is neither a parse error nor an I/O failure, so the ruling does not cover it. The report does not list it under "Limits, stated plainly" (task-15-report.md lines 373-376). Once the SDK closes the transport, the process cannot keep serving, so the real choice is between ending and going silent. The implementation ends with exit 1, which is the fail-closed choice.

Severity. Important, not Critical: the client is the host that spawned the process, and the exit is loud and non-zero.

Decision needed. Either accept this as a documented exception (the SDK closes the transport on overflow, so the process ends with 1), and record it in the ruling and the README; or change the rule. I recommend the first.

### I-2 (Important): a non-JSON line is never logged (item b)

Evidence. ReadBuffer.readMessage skips a SyntaxError before the transport sees it (src-Cqbh3MYc.mjs:7185). Probe A sent `not json`, then a valid-JSON non-RPC frame, then initialize. Only the second produced a stderr line. The report discloses this (task-15-report.md line 374).

Why it matters. The ruling says a parse error logs one line. The most common parse error, a non-JSON line, logs nothing. The process behaviour is right: it does not exit.

Severity. Important: a stated requirement is not met, and the gap is disclosed rather than fixed.

Decision needed. Accept it as a documented limit, or add a detector. A detector would need its own line split and JSON.parse on the stdin data, duplicating the SDK's parsing. I recommend accepting it as a documented limit.

### M-1 (Minor): framing lines are not capped (item d)

Each valid-JSON frame that is not JSON-RPC writes one stderr line (src/mcp.js:269-271). Probe B wrote 500 lines for 500 frames. The process stays up, but the stderr volume follows the client. Accept, or count and summarise after N lines.

### M-2 (Minor): Node warnings reach stderr before our line in a backpressured EPIPE (item b)

Real-pipe run: 20000 queued requests, and the reader closed after 200 bytes. Stderr held two `MaxListenersExceededWarning` lines (11 error listeners and 11 drain listeners on the stdout Socket) before `ig mcp: transport error: Error`. They come from the SDK's per-send `once('error')` and `once('drain')` in StdioServerTransport.send. This is pre-existing SDK behaviour, not P5b code, and no secret is in it. The "one stderr line" claim holds for our lines only. Accept and document.

### M-3 (Minor): stale header comment (src/mcp.js:9-10)

The comment says the module's one line is the transport-error line. startStdio also writes framing lines (src/mcp.js:202-204, 270). Update the comment.

### M-4 (Minor): an existing test runs startStdio without injected stubs (test/mcp.test.js:407-410)

The call passes only `transport`, so the defaults apply: process.exit, process.stderr and process.stdout (src/mcp.js:233-235). Nothing in that test closes the transport, so nothing fires now. A later edit that closes it would call the real process.exit inside the test runner. Inject the three stubs.

## Scope notes

- The base snapshot p5a-head (taken at 00:12) predates the P4 fix round 2 and the one-reply flag round. review-p5b.diff therefore also carries changes to src/guard.js, src/state.js, src/stops.js (new), src/events.js, src/caps.js, src/cli.js, src/service.js, src/errors.js, src/redact.js, src/unofficial/sidecar.js, sidecar/ig_sidecar.py, their tests, and README.md. None of these is P5b, and none was reviewed here. Two touch this package's surface: errors.js mapGraphError (it sets the kind, and so whether a Graph error is 423 or 500), and service.js privateReply (it refuses with STOPPED, 409). The controller should confirm those changes have their own review.
- The F-17 and F-18 lines (src/http.js 4, 158, 323-324, 348, 358-364, 373-378) are excluded as instructed. None of them falls in a hunk of review-p5b.diff, so none is a P5b change.
- Node 22 was not run (the report says the same).

## Probe record

Scratchpad files (all outside the project):
- D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\p5b-review-probe.mjs (in-process transport, cases A to G)
- D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\p5b-real-stdio.mjs and p5b-make-input.mjs (real stdin and stdout, run through a pipe)

Results, in-process (the SDK's real transport on PassThrough streams):

| Case | Stderr lines | Exit |
|---|---|---|
| A: non-JSON, then invalid RPC, then initialize, then end | 1 (`framing error: ZodError`) | 0 |
| B: 500 invalid-RPC frames | 500 (same line) | none |
| C: 10 MiB + 1 bytes, no newline | 1 (`transport error: Error`) | 1 |
| D: stdout destroyed with EPIPE | 1 (`transport error: Error`) | 1 (after the 5 s backstop) |
| E: stdin ends | 0 | 0 |
| F: stdin error named EIO | 1 (`transport error: EIO`) | 1 |
| G: invalid-RPC frame holding a token | 1 (`framing error: ZodError`), no token | none |

Results, real process pipe: clean end exit 0 in 275 ms with 0 bytes of stderr; EPIPE exit 1 in 671 ms, with the M-2 warnings; 10 MiB + 1 bytes exit 1.

## Round verdict

Findings remaining. Critical 0. Important 2 (I-1 and I-2), and both need a controller or owner ruling (accept as a documented exception, or change). Minor 4 (M-1 to M-4).
