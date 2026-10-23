# Task 15 report: HTTP API

Status: DONE_WITH_CONCERNS. Node 22 has not been run (Task 18 carry-forward). Node here is v24.6.0.

## Files changed

- `src/http.js` (new, 288 lines): `createHttpServer`, `createRequestHandler`, `MAX_BODY_BYTES`.
- `test/http.test.js` (new, 45 tests). Uses fake requests (`Readable` streams) and fake responses. No test calls `listen`, opens a socket or makes a network call (checked with grep).
- No other file changed. `src/webhooks.js`, `src/tools.js`, `src/errors.js`, `src/redact.js` and `package.json` are untouched. The test script is unchanged (R9). No npm package was added (`node:http`, `node:crypto`, `node:stream` only, plus the project's own modules).
- No git commit (R2). The full suite is the gate.

## TDD evidence

RED: the tests were written first against a stub `src/http.js` that exported the two functions and threw `not implemented`.

```
node --test test/http.test.js
ℹ tests 45
ℹ pass 0
ℹ fail 45
```

All 45 failed. Most failures are the stub's `Error: not implemented`. The three construction-refusal tests failed on their assertions (a `TypeError` expected, a `CONFIG` expected, and the non-loopback host check).

GREEN: after `src/http.js` was implemented:

```
node --test test/http.test.js
ℹ tests 45
ℹ pass 45
ℹ fail 0
```

Full suite (`npm test`, the gate for R2):

```
ℹ tests 627
ℹ pass 627
ℹ fail 0
(exit code 0)
```

The 627 is the 582 existing tests plus the 45 new ones.

### Test that was corrected during the work

The first version of the N-1 "ended request" test used a Readable that auto-destroys after its end. Without the guard it passed, so it did not reproduce the hang. A probe (`readRawBody` on three kinds of stream) showed:

- ended and not destroyed: hangs (never settles);
- ended and auto-destroyed: rejects at once, because its close event fires;
- destroyed and closed: hangs.

The ended-request tests now use `new Readable({ autoDestroy: false })` through the helper `endedRequest`, which is the state an HTTP request can be in.

### Mutation checks (each applied to `src/http.js`, then restored and compared byte for byte)

| Mutation | Result |
|---|---|
| N-1 guard removed entirely | 3 tests fail by timeout: ended request, destroyed or closed request, webhook POST with ended body |
| only the `destroyed` term removed | 1 fails: destroyed or closed request |
| only the `readableEnded` term removed | 2 fail: ended request, webhook ended body |
| Host check removed | 3 fail: the 403 tests (Host outside allowedHosts, Host before token, port matching) |
| tool result not passed through `redact` | 1 fails: result is redacted before it is sent |

## Brief tests and carry-forwards, mapped to tests

| Brief test or carry-forward | Test (test/http.test.js) |
|---|---|
| health answers without a token | `health answers without a token` |
| POST /tools without the bearer token returns 401 | `POST /tools without the bearer token returns 401` |
| POST /tools/ig_status with the token returns the status result | `POST /tools/ig_status with the token returns the status result` |
| a busy result returns 429 with busy true in the body | `a busy result returns 429 with busy true in the body` |
| unknown tool returns 404 | `unknown tool returns 404` |
| webhook path returns 404 when no handler is given | `webhook path returns 404 when no handler is given` |
| webhook GET handshake passes through unchanged | `webhook GET handshake passes through unchanged`; `webhook GET handshake with the real handler echoes the challenge`; `a repeated handshake parameter is refused by the real handler with 403` |
| a Host header outside allowedHosts returns 403 | `a Host header outside allowedHosts returns 403`; `... is refused before the token is checked on a tool route`; `the Host header is compared without regard to case`; `allowedHosts names are matched with the port given...` |
| a non-loopback host without an api token is refused at construction | `a non-loopback host without an api token is refused at construction`; `a non-loopback host with an api token is built, and the server is not listening` |
| bodies over 1 MB are rejected with 413 | `bodies over 1 MB are rejected with 413, and the handler does not run`; `a body of exactly 1 MB is read and passed on` (boundary); `a webhook body over 1 MB is refused with 413 before the handler runs` |
| Task 10 N-1: a closed or ended request does not hang | `a request whose body has already ended is refused without waiting`; `a request that is destroyed or has closed is refused without waiting`; `a webhook POST whose body has already ended is refused without waiting` |
| Task 14: findTool, then validateArgs, then the handler; unknown tool before the body | `a body that fails validation is 400, and the handler does not run`; `an unknown tool is refused before its body is read` |
| Fail closed: unknown method is 405 | `an unknown method is 405, and the Allow header names the methods that are served`; `the webhook path answers other methods with 405...` |
| Fail closed: missing Authorization is 401 | `a request without the token is refused before its body is read`; `a scheme other than Bearer, or a bare token, is refused with 401` |
| Fail closed: a body that is not JSON is 400 | `an invalid JSON body is 400, and a JSON value that is not an object is 400` |
| Error mapping: VALIDATION 400, STOPPED 409, CAP_EXCEEDED 429, OWNER_MISMATCH 403, ROUTE_DISABLED 403, other kinds 500 | `each error kind maps to its status, and every other kind is 500` (the table is checked against `ERROR_KINDS`, so a new kind fails the test) |
| Every error message and result is redacted | `a result is redacted before it is sent`; `an error message is redacted before it is sent`; `an unexpected error is a 500 with a generic message and no detail` |
| Token rules: constant-time comparison, never in a URL, a log or an error | `a wrong token, or a prefix of the right one, returns 401`; `the Bearer scheme is read without regard to case`; `the token is not accepted from the URL`; `the api token never appears in a response, on any route` |
| Read a body with an explicit limit; a body that fails while read is not a 500 | `a body that fails while it is read is refused with 400, not 500`; `an empty body is taken as no arguments` |
| Construction options are checked | `construction options of the wrong kind are refused`; `an api token too short to register as a secret is refused at construction`; `a loopback host is built without an api token, and then refuses every tool call` |

## Design decisions (where the brief left a choice)

1. Check order for a tool call: Host (403), route, method (405), bearer token (401), tool lookup (404), body read (413 or 400), `validateArgs` (400), handler. The token comes before the lookup, so an unauthenticated caller learns no tool names.
2. `port` is an added option (default 8788). `config.http.allowedHosts` holds names without the port (`src/config.js:62`). An entry without a port gets `:port` appended. An entry that ends in `:digits` is matched as written. The brief's "with the port" rule holds either way.
3. The tool lookup is `ctx.tools.find` over the injected `tools` list (default `TOOLS`). This is the same rule as `findTool`, and it lets the list be injected. `findTool` itself is not used.
4. Busy result: the body is `{ busy: true, reason, retryAfterMs }` at the top level, with status 429.
5. Empty body is `{}`. A body that is JSON but not an object is 400, through `validateArgs`.
6. HTTP-layer kinds that are not in `ERROR_KINDS`: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `PAYLOAD_TOO_LARGE`, and `INTERNAL` (any non-`IgError`, with a generic message). The MCP forwarder (Task 16) must know them.
7. The webhook path: with no handler it answers 404 for any method. With a handler, GET and POST go to it, and other methods are 405 with `Allow: GET, POST`.
8. The api token is trimmed and registered with `registerSecret` at construction. A token that cannot be registered (under 8 characters) is refused with CONFIG.
9. A 413 response carries `Connection: close` (Task 10 I-4 ruling).
10. `createRequestHandler(options)` is exported. The brief's "for example handleRequest" is this function, and the server's request event is `createServer(createRequestHandler(options))`. The handler never rejects.
11. The guard for N-1 lives in `src/http.js` (`readBody`), as the ledger assigns it to Task 15. `readRawBody` in `src/webhooks.js` is unchanged, so it still hangs if a caller passes it an ended or destroyed stream directly. Both routes call it through `readBody`.

## Carry-forwards that are not in this task

- Task 10 (audit and the shared clock, passed to `createWebhookHandler`) and Task 11 (poller start and stop) belong to Task 17's `serve`. This task only mounts the handler it is given.
- Task 13: `guard.assertOwner` once at startup, and `getClient` with `onUsage` for every Graph client. Both are Task 17.
- Task 18: the Node 22 run.

## Self-review

I read the final `src/http.js` in full. Changes made during the work:

- The N-1 guard no longer checks `req.closed`. A closed request is always destroyed, so the check was redundant.
- `DEFAULT_PORT` and `DEFAULT_WEBHOOK_PATH` are no longer exported.
- The N-1 test was rewritten (see above).

Points I checked and accept:

- The token comparison hashes both values with SHA-256 before `timingSafeEqual`, so the time does not depend on where the values differ. A test cannot measure timing, so this rests on reading the code.
- The 401 message does not say whether a token is configured.
- The 500 message for an unexpected error is generic, so a stack or a library message never reaches the caller.
- Both `IgError` messages and result values pass through `redact`. `IgError` also redacts when it is built, so the error path is redacted twice.
- No test relies on timing, except the 2-second timeout in the N-1 tests, which only applies when the code is wrong.

## Concerns

1. A loopback host with an empty `api_token` builds, and then every `POST /tools` answers 401. The owner must set `api_token` to use the tools (Task 17 and the README).
2. The Host check also applies to the webhook path. A reverse proxy that forwards the public Host header gets 403. The proxy has to rewrite Host to an allowed value (a Task 17/18 item).
3. The brief's error table sends `AUTH_EXPIRED`, `RATE_LIMITED`, `CHECKPOINT` and `ACTION_BLOCKED` to 500, so a caller cannot tell a stop from a failure by status. This follows the brief and is recorded for Task 16 and the owner.
4. Node 22 has not been run. Node 24.6.0 is the only runtime tested.

## Fix round 1 (from task-15-review.md)

Fixed: I-1, M-1, M-2, M-3, M-5, M-6, M-9 and M-10. Deferred and unchanged: M-4, M-7, M-8, M-11, M-12 and M-13. Nothing else was changed.

Totals: `test/http.test.js` has 58 tests (45 before, 13 new), and all 58 pass. The full suite has 640 passing tests (627 before). No test calls a real `listen`: the file has only stub assignments (`server.listen = ...`) and one impostor whose `listen` throws if it is called.

### Changes, with file and line

Line numbers are in the current files.

| Item | File and line | Change |
|---|---|---|
| I-1 | `src/http.js:315` (WeakMap `bindings`), `:345` (record at build), `:351-354` (`listenHttp`) | `createHttpServer` records the validated host and port for the server it builds. `listenHttp(server)` calls `server.listen(port, host)` from that record. Any other value (a server this module did not build, a plain object, or undefined) throws CONFIG at `:353`. |
| I-1 | `src/http.js:151-152` | The bind host is the configured host with surrounding brackets removed. An empty host is refused with CONFIG, because `listen` with an empty host binds every interface. |
| I-1 | `src/http.js:1-4` | The header comment says serve starts the listener with `listenHttp`. |
| M-1 | `src/http.js:27-29` (`HOST_VALUE`, replaces `ENDS_WITH_PORT`) | A Host value is a name with no colon, or a bracketed IPv6 address, then an optional `:digits` port. A bare IPv6 address does not match, so `::1` is not a Host value. |
| M-1 | `src/http.js:92-96` (`hostParts`), `:98-107` (`allowedKey`), `:179-182` (`hostAllowed`) | Host headers and allowed entries are split into name and port before they are compared. The port is kept as text, so `08788` is not read as `8788`. A Host with no port is refused. An allowed entry that is a bare IPv6 address is refused with CONFIG (`:103`). |
| M-1 | `src/http.js:153` | The loopback test uses `bindHost`, so `[::1]` counts as loopback. |
| M-2 | `src/tools.js:448-450` | `findTool(name, tools = TOOLS)`. The optional list has a default, so the single-argument callers in `test/tools.test.js` are unchanged. |
| M-2 | `src/http.js:16` (import), `:270` | The tool lookup is `findTool(name, ctx.tools)`. |
| M-3 | `src/http.js:121-123` (`warnUnexpected`), `:319-334` (catch in `requestHandlerFor`, call at `:325`) | An error that is neither an IgError nor an HttpFailure emits `process.emitWarning('the HTTP API caught an unexpected <name>')`. The name is used only when it is 1 to 40 letters; otherwise the text says `Error`. The message and the stack are left out. The response is still the generic 500. |
| M-5 | `src/http.js:111-118` (`webhookHeadersOf`), `:289` | The webhook handler gets the request headers without any entry whose name is `authorization` in any case. Every other header is passed unchanged. |
| M-9 | `src/http.js:224-226` (`tooLarge`), `:232-238` (declared length) | Before any byte is read, a declared Content-Length over `MAX_BODY_BYTES` gives 413 with `Connection: close`. A declared length that is not digits gives 400 VALIDATION (a new branch that the review did not name). Both routes call `readBody`, so both get the check. The 413 builder is shared. |
| M-6 | test only (`test/http.test.js:737`) | No code change. The route function already runs the Host check before the webhook branch, and the test confirms it. |
| M-10 | `test/http.test.js:377` | Renamed. The assertions are unchanged. |

No existing test body was changed, except the one rename. The only other edit to the test file is the import line, which adds `listenHttp`.

### Test name changed

| Item | Old name | New name | Assertion change |
|---|---|---|---|
| M-10 | `a loopback host is built without an api token, and then refuses every tool call` | `a loopback host without an api token builds, and refuses an empty or a non-empty bearer token with 401` | None. Three loopback hosts are built with `listening` false. The two bearer values `Bearer ` and `Bearer x-token-value-000000` each get 401. |

### New tests (13)

1. `listenHttp listens on the validated host and port, and not on every interface` (`test/http.test.js:333`), I-1. The test replaces `listen` with a recording stub on three servers: 127.0.0.1 with port 9123, `[::1]` with port 9124, and the default with no port. It asserts the calls are `[9123, '127.0.0.1']`, `[9124, '::1']` and `[8788, '127.0.0.1']`.
2. `listenHttp refuses a server that createHttpServer did not build, and starts nothing` (`:355`), I-1. Checks a `new Server()`, a plain object whose `listen` throws, and undefined. Each throws CONFIG.
3. `an empty host is refused at construction, because listen would bind every interface` (`:367`), I-1. Extra: covers the empty-host rule at `src/http.js:152`.
4. `a Host of [::1]:8788 matches an allowed entry [::1] with port 8788` (`:298`), M-1.
5. `a Host of ::1 is refused` (`:304`), M-1. Checks `::1` and `::1:8788`; both give 403.
6. `a bare IPv6 address in allowedHosts is refused at construction` (`:312`), M-1. Extra: the CONFIG rule at `src/http.js:103`.
7. `an unknown tool name is 404 through findTool` (`:665`), M-2. The handler is given a list with one custom tool. The custom tool gets 200. `ig_status`, which is in the registry but not in that list, gets 404.
8. `an unexpected error gives a 500, and one warning that carries only the error name` (`:686`), M-3. The listener is removed in a `finally` block (`:702`). The test asserts that the one matching warning text is exactly `the HTTP API caught an unexpected Error`, and that no warning contains the token.
9. `the webhook handler gets no authorization header, and the other headers unchanged` (`:710`), M-5. Both `authorization` and `Authorization` are removed. The three other headers are passed unchanged.
10. `a Host outside allowedHosts is 403 on the webhook path too` (`:737`), M-6. A GET and a POST each get 403, and the handler is never called.
11. `a request that declares a body over 1 MB is refused with 413 before its body is read, on the tools route` (`:757`), M-9. The declared length is 2 MB. The test asserts 413, `Connection: close`, `readableDidRead` false, and no service call.
12. `a request that declares a body over 1 MB is refused with 413 before its body is read, on the webhook route` (`:772`), M-9. The same checks, with the webhook handler not called.
13. `a content-length that is not a whole number is refused with 400, before the body is read` (`:790`), M-9. Extra: covers the new 400 branch.

### Mutation checks

Each change was applied to `src/http.js`, the suite was run, and the file was restored and compared byte for byte.

| Change to `src/http.js` | Tests that fail |
|---|---|
| `listen` called without the recorded host (I-1) | `listenHttp listens on the validated host and port, and not on every interface` |
| Bracket stripping removed (M-1) | `listenHttp listens on ...`, and `an empty host is refused ...` (the `[]` case) |
| Webhook handler given `req.headers` (M-5) | `the webhook handler gets no authorization header, and the other headers unchanged` |
| Declared length not checked (M-9) | Both 2 MB tests |
| `warnUnexpected` call removed (M-3) | `an unexpected error gives a 500, and one warning that carries only the error name` |
| Host check skipped on the webhook path (M-6) | `a Host outside allowedHosts is 403 on the webhook path too` |

M-2 is not covered by a mutation. The `findTool` test is behavioural. Reverting to `ctx.tools.find` gives the same answers, so that test would not catch the revert. The call site was checked by reading `src/http.js:270`.

### npm test

```
ℹ tests 640
ℹ pass 640
ℹ fail 0
```

Exit code 0. `test/http.test.js` alone: 58 pass. The run prints two stderr lines, `(node:PID) Warning: the HTTP API caught an unexpected Error` and the same text with `TypeError`, from the M-3 test and from the existing generic-500 test. This is Node's default warning output, and the tests pass.

### Superseded text in the round-0 sections

- Design decision 2 (port handling): IPv6 entries follow the rule in the M-1 row above. A bare IPv6 allowed entry is refused with CONFIG.
- Design decision 3 (tool lookup): now `findTool(name, ctx.tools)`, as M-2 asks.

### Concerns

- `listenHttp` is the only start path that is protected. A caller that calls `server.listen` directly still binds every interface. Task 17 must use `listenHttp`.
- The M-2 test is behavioural and cannot tell `findTool` from the old lookup (see above).
- Node 22 has not been run. Node 24.6.0 is the only runtime tested.

## Fix round 2 (warning output)

Scope: one item from the coordinator. The two unexpected-error tests printed a Node warning line during `npm test`. Code under test: unchanged. `src/http.js` was not edited in this round.

### Change (test/http.test.js)

Both tests now replace `process.emitWarning` with a recording stub for the duration of the test, and restore the original in a `finally` block. Each one then asserts exactly one recorded warning, with the exact text. The stub records the text only, because the code passes the text alone. The error name is part of that text, so the exact-text assertion checks the name and nothing else.

| Test | Line | Old assertions (warning part) | New assertions (warning part) |
|---|---|---|---|
| `an unexpected error gives a 500, and one warning that carries only the error name` | 700 | A `process.on('warning')` listener collected the messages, with a `setImmediate` wait before the listener was removed. Assertions: status 500; the warnings filtered to those starting with `the HTTP API caught` deep-equal `['the HTTP API caught an unexpected Error']`; no warning contains the token. | `process.emitWarning` is replaced by a stub in place of the listener. The `setImmediate` wait is removed, since the stub records synchronously. Assertions: status 500; the recorded warnings deep-equal exactly `['the HTTP API caught an unexpected Error']`; `process.emitWarning` is the original again after the test. The token check is covered by the exact-text check. |
| `an unexpected error is a 500 with a generic message and no detail` | 604 | Assertions: status 500; body deep-equals `{ error: { kind: 'INTERNAL', message: 'the request failed' } }`. No warning assertion. | Same stub pattern, restored in `finally`. Added assertions: the recorded warnings deep-equal exactly `['the HTTP API caught an unexpected TypeError']`; `process.emitWarning` is the original again after the test. The status and body assertions are unchanged. |

No test was added or renamed in this round. `test/http.test.js` has 58 tests, and all 58 pass. The generic-500 test is above the M-3 test, so this round's edit moved the M-3 test from line 686 (the round-1 numbering) to line 700. The round-1 line references are otherwise unchanged as history.

### M-2

Left as it is. The call site is checked by reading `src/http.js:270`. The coordinator accepts this.

### npm test output

```
ℹ tests 640
ℹ pass 640
ℹ fail 0
ℹ cancelled 0
```

Exit code 0. The output for `test/http.test.js` alone has no warning line.

### Is the output pristine?

No, not yet. The two warnings from this task are gone. The full `npm test` output still has one warning line, from a test outside this task:

```
(node:217632) Warning: audit line not written (AuditDiskFullError)
(Use `node --trace-warnings ...` to show where the warning was created)
```

It comes from `test/service.test.js:998` (the Task 13 I-2 test, which checks the visible audit-failure warning at line 1024). The warning is emitted by `src/service.js:268`. That test does not stub `process.emitWarning`, so Node prints the warning. Fixing it means the same stub pattern in that test. That is outside this task, and the coordinator said not to change anything else, so it is left for the coordinator to decide.

### Concerns

- The full `npm test` output has one warning line, from `test/service.test.js:998` (Task 13). The output is not pristine until that test uses the same stub.
- The stub records the warning text only. The error name is inside that text.
- Node 22 has not been run. Node 24.6.0 is the only runtime tested.

## P5b (2026-10-23)

Scope, from the controller's package P5b: O-10 (423 Locked for the four stop kinds) and A-32 (startStdio observes transport errors and close). Files: src/http.js, src/mcp.js, test/http.test.js and test/mcp.test.js. The service and the poller are unchanged.

### Changes, with file and line

Line numbers are in the current files.

| Item | File and line | Change |
|---|---|---|
| O-10 | `src/http.js:35-46` (`STATUS_FOR_KIND`, comment at 35-37) | AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED and RATE_LIMITED map to 423 (lines 41-44). STOPPED stays 409 and VALIDATION stays 400. Other kinds, and any kind the map does not know, stay 500. The kind is in the body, as before. |
| O-10 | `src/http.js:10-11` (header comment) | The order-of-checks comment states the stop status (423), STOPPED (409), and where the table is. |
| O-10 | `src/mcp.js:104-106` (comment in the failed-status branch of `createForward`) | Comment only. The client maps no status to a kind: a 423, a 409 or a 400 each carry the kind in the body, and `runTool` passes that kind on unchanged. The code already does this for any failed status with an error body, so no code changed. |
| A-32 | `src/mcp.js:9-10` (header comment) | The one line the module writes is the stderr line for a transport error, and it carries the error name only. |
| A-32 | `src/mcp.js:12-13` (import) | `StdioServerTransport` is imported, so `startStdio` can own the transport. |
| A-32 | `src/mcp.js:180-207` (`FLUSH_LIMIT_MS` at 182, `errorLineFor` at 186, `flushThen` at 193) | `errorLineFor` gives `ig mcp: transport error: <name>` with a newline. The name is used only when it is 1 to 40 letters, otherwise Error. The message is never written. `flushThen` queues an empty write behind the frames already written, and calls back when they are out. A 5000 ms backstop calls back anyway, so a client that stops reading cannot hold the process open. |
| A-32 | `src/mcp.js:209-262` (`startStdio`) | Takes `exit` (default `process.exit`), `stderr` (default `process.stderr`) and `stdout` (default `process.stdout`). Creates the transport when none is given. Wraps `start` (236-243) so a failed start is observed. After `serveStdio` has set its own `onerror` and `onclose` (244), wraps both (248-254, 256-262), so serveStdio still gets each event. A single `decide` runs once: an error or a failed start writes one stderr line and exits 1 after the flush; a clean close exits 0 after the flush. |

### Test changed

| Test | Old assertion | New assertion |
|---|---|---|
| `each error kind maps to its status, and every other kind is 500` (test/http.test.js:639, rows at 650-653) | `AUTH_EXPIRED: 500`, `RATE_LIMITED: 500`, `ACTION_BLOCKED: 500`, `CHECKPOINT: 500` | `AUTH_EXPIRED: 423`, `RATE_LIMITED: 423`, `ACTION_BLOCKED: 423`, `CHECKPOINT: 423`. The other rows and the test name are unchanged, and the name still holds for the kinds that remain 500. |

No other existing test was changed.

### New tests

test/http.test.js (3):
1. `each stop kind is 423 Locked, with its kind in the body` (line 672). Each of the four kinds gives 423, and the body is exactly `{ error: { kind, message } }`.
2. `STOPPED is 409, the service refusal while a stop holds, and VALIDATION is 400` (line 686).
3. `an error kind that the table does not know is 500, with its kind in the body` (line 700). The IgError has a kind set after construction, as a later kind would be. The status is 500 and the kind is kept in the body.

test/mcp.test.js (7):
1. `a 423 stop body comes back as isError with its kind unchanged, for each stop kind` (line 413).
2. `a transport error writes one stderr line with the error name only, and exits non-zero` (line 465). The stderr line must equal `ig mcp: transport error: EPIPE` with a newline, and the exit is `[1]`.
3. `a transport error exits only after stdout has flushed the frames already written` (line 481). The exit list is empty until the held flush is released.
4. `a clean close exits with 0 and writes nothing to stderr` (line 498).
5. `an error followed by a close writes one stderr line and exits once, with 1` (line 513).
6. `a failed start writes one stderr line with the error name only, and exits non-zero` (line 529).
7. `a stdout that never flushes still ends the process, after the backstop` (line 544). It uses node:test mock timers. The exit does not come at 4999 ms, and comes at 5000 ms. A late flush does not exit again.

Test helpers: `stdioStandIns` (line 429) and `FailingStartTransport` (line 457). No test opens a real stdio stream, a socket or a process. `exit`, `stderr` and `stdout` are injected stubs, and the transport is the existing in-memory `FakeTransport`.

### Counts

- `test/http.test.js`: 63 pass, 0 fail.
- `test/mcp.test.js`: 29 pass, 0 fail.
- `npm test`: 1049 pass, 0 fail, exit code 0. The output has no warning line.

### Mutation checks

Each change was applied to `src/mcp.js` or `src/http.js`, the suite was run, and both files were restored and compared byte for byte.

| Change | Tests that fail |
|---|---|
| Stderr line not written | The two `transport error` stderr tests, `an error followed by a close`, and `a failed start` |
| Exit without waiting for the flush | `a transport error exits only after stdout has flushed`, and the backstop test |
| Clean close does not exit 0 | `a clean close exits with 0` |
| Backstop changed to 60000 ms | The backstop test |
| CHECKPOINT mapped to 500 | `each error kind maps ...`, and `each stop kind is 423 Locked` |
| STOPPED mapped to 423 | `STOPPED is 409 ...`, and `each error kind maps ...` |

### Concerns

- A malformed frame from the client is reported by the SDK through the transport's `onerror`, and the SDK keeps reading. Under the rule as written, the first such frame ends the process with 1. This is the literal reading of "a transport error". The controller should confirm it, or decide that a parse error is exempt.
- During this round, another process changed `src/http.js` (the listen guard and the factory rename, which were not mine), and it replaced the shared scratchpad file `mutate.mjs` with a script that runs other suites and writes a shared backup. I used a private helper, `p5b-mutate.mjs`. The controller should confirm that nothing else writes to these files.
- `README.md:481` still lists A-32 as open. It is outside this package and was not changed.
- Node 22 has not been run. The exit path and the 423 mapping are tested on Node 24.6.0 only.

### P5b follow-up (2026-10-23): framing errors, and the check on src/http.js

This follow-up replaces the first P5b concern about a malformed frame. The check on src/http.js is in part 2.

#### 1. Framing errors do not end the process

Probe, not part of the suite: `scratchpad/p5b-sdk-probe.mjs`, which uses in-process PassThrough streams. What the SDK (2.3.1) reports, from `node_modules/@modelcontextprotocol/server/dist/src-Cqbh3MYc.mjs` (`ReadBuffer`, around line 7163) and `stdio.mjs`:

| Input | What reaches the transport's onerror |
|---|---|
| A line that is not JSON | Nothing. `readMessage` skips a SyntaxError before the transport sees it. |
| Valid JSON that is not JSON-RPC | An error named `ZodError`. The SDK keeps reading. |
| A buffer over the size limit | An error named `Error`, then a close. |
| stdout EPIPE | An error named `Error` with code `EPIPE`, then a close. |
| stdin ends normally | A close only. |

Change, in `src/mcp.js`:

| Item | Lines | Change |
|---|---|---|
| `plainNameOf` | 185-187 | The error name when it is a plain word, otherwise `Error`. |
| `FRAMING_ERROR_NAMES`, `isFramingError` | 193-194 | A framing error is a SyntaxError, or an error named `ZodError`. Every other transport error is an I/O failure. |
| `errorLineFor` | 197-199 | `ig mcp: transport error: <name>` (unchanged text, now using `plainNameOf`). |
| `framingLineFor` | 202-204 | `ig mcp: framing error: <name>`. |
| `wire.onerror` wrapper | 269-273 | A framing error writes one framing line, unless the process is already ending, and the process goes on. Any other error calls `decide(1, ...)`. |
| `startStdio` doc comment | 224-228 | Describes the framing rule and the I/O rule. |

Tests added to `test/mcp.test.js`:

1. `a parse error logs one line and does not exit` (line 565). A SyntaxError stub gives one framing line and no exit. A later clean close exits 0, and no second line is written.
2. `a frame that is JSON but not a JSON-RPC message logs one framing line and does not exit` (line 584). A ZodError stub.
3. `a transport error that is not a framing error ends the process with 1` (line 599). An Error stub with the SDK's buffer-overflow message, which ends the process with 1.

The clean close and the EPIPE cases are covered by the existing tests `a clean close exits with 0 and writes nothing to stderr` (line 498) and `a transport error writes one stderr line with the error name only, and exits non-zero` (line 465), which are unchanged.

Mutation check: `isFramingError` was made to return false. Tests 1 and 2 failed. The file was restored and compared byte for byte.

Limits, stated plainly:
- A line that is not JSON is never logged. The SDK drops it before the transport sees it, so logging it would mean replacing the SDK's private read buffer. The process still goes on.
- An EPIPE is logged as `ig mcp: transport error: Error`. A system error's `name` is `Error`, and its code (`EPIPE`) is not logged, to keep the name-only rule.
- A normal stdin end reaches the SDK as a close, so it exits 0. The brief listed "EOF on stdin" with the I/O failures. An EOF that arrives as an error exits non-zero. A normal end does not, because it is a clean close.

#### 2. Lines in src/http.js

Method: the current `src/http.js` and `test/http.test.js` were compared with `snap/p5a-head`, taken at 00:12 on 2026-10-23, which is the state when P5b began. The P5b copy of `src/http.js` (`scratchpad/http.p5b.js`) matches the current file, and no write has happened since 01:20:28, which was my own restore.

Lines I changed in P5b, in `src/http.js`: lines 9-11 (header comment), 35-37 (comment on STATUS_FOR_KIND), and 41-44 (the four rows that map to 423). Nothing else in that file.

Lines in `src/http.js` that I did not write. They are already in `snap/p5a-head`, so they predate P5b:

| Current lines | What | Source |
|---|---|---|
| 4 | Header comment: direct listen refused, `requestHandlerForTests` | F-17 |
| 158 | `bindHost` is trimmed again after the bracket strip | F-18 |
| 323-324 | `starting` WeakSet | F-17 |
| 348 | `requestHandlerForTests` (replaces the serving export `createRequestHandler`) | F-17 |
| 358-364 | `createHttpServer` overrides `server.listen` and refuses any start that does not come from `listenHttp` | F-17 |
| 373-378 | `listenHttp` marks the server as starting | F-17 |

`test/http.test.js` also refers to `requestHandlerForTests` (the import on line 8, the `handlerWith` helper, and the F-17 tests). Those references predate P5b too.

The source is `final-fix-report.md`, which records F-17 and F-18. It was written by the final fix round (the implementer a703521971f4cbf47). The P1 snapshot (`snap/p1-head`) already contains the same changes.

Time of noticing: about 01:18 local on 2026-10-23. I first saw them when I re-read the header, right after my first P5b edit (the file was written at 01:18:16 by that edit). They were already in the file then.

I built on them. My P5b edits, tests and mutation checks all ran on top of these lines. I did not revert or change them. My mutation restores copied files taken after these lines were present, so nothing was lost. My round-1 report says `createRequestHandler` is exported. F-17 renamed it, so that report is out of date on that point.

Shared scratchpad: `scratchpad/mutate.mjs` was replaced. Its mtime is 2026-10-22 20:34. My earlier version was a helper for `file from to` that restored from a copy. The replacement takes `file label oldFile newFile`, applies one replacement, runs `test/oauth.test.js` and `test/cli.test.js`, and restores from the shared backup `scratchpad/bak/mutate-backup.js`. Its header says it runs the auth tests. It was written next to the `bak/cli-*.js` backups (20:30 to 20:38 on 10-22), so it belongs to the P1 fix round's CLI work, not to this round. This round used a private helper, `scratchpad/p5b-mutate.mjs`. The shared backup path would collide if two runs happened at once.

#### Counts

- `test/mcp.test.js`: 32 pass, 0 fail.
- `test/http.test.js`: 63 pass, 0 fail (unchanged in this follow-up).
- `npm test`: 1052 pass, 0 fail, exit code 0. The output has no warning line (`scratchpad/npm-test-p5b-round3.txt`).

### P5b review rulings (2026-10-23)

The review is `p5b-review.md`. Its rulings are applied below.

#### Changes made for the review

| Item | File and lines | Change |
|---|---|---|
| M-3 | `src/mcp.js:9-11` (header comment) | The stale claim that the module's one line is the transport-error line is corrected. The header now says that the lines go to stderr, that only `startStdio` writes them, and that each carries the error name only. No behaviour change. |
| M-4 | `test/mcp.test.js:407-421` (`startStdio connects the transport it is given`) | The test now gives `exit`, `stderr` and `stdout` stubs, and asserts that no exit and no stderr line happened. The other 9 `startStdio` calls in that file already had all three stubs, and so do all 10 now. The production callers (`src/cli.js:586` and `scripts/mcp-spike.mjs:25`) still use the defaults, as they should. |

M-4, old test body:

```js
test('startStdio connects the transport it is given', async () => {
  const transport = new FakeTransport();
  await startStdio({ forward: fakeForward(async () => ({ result: null })), transport });
  assert.equal(transport.started, true);
});
```

M-4, new test body:

```js
test('startStdio connects the transport it is given', async () => {
  const transport = new FakeTransport();
  const stand = stdioStandIns();
  await startStdio({
    forward: fakeForward(async () => ({ result: null })),
    transport,
    exit: stand.exit,
    stderr: stand.stderr,
    stdout: stand.stdout,
  });
  assert.equal(transport.started, true);
  // Nothing closes the transport in this test, so no exit and no stderr line happen.
  assert.deepEqual(stand.exits, []);
  assert.deepEqual(stand.lines, []);
});
```

The test name is unchanged. Its assertions are the old one (`transport.started` is true) plus the two new ones on the stubs. No other test changed.

#### Limits (for the README)

These four are accepted as documented limits. They are listed here with the reason for each.

1. **A client frame over 10 MiB ends the MCP process with exit 1** (review I-1, ruling: accepted as a documented exception). The SDK's `ReadBuffer` has a 10 MiB limit (`src-Cqbh3MYc.mjs`, around line 7159). When a frame without a newline passes it, the SDK closes the transport. The error is named `Error`, so the rule treats it as an I/O failure, and the process writes `ig mcp: transport error: Error` and exits 1 after the flush. Reason: once the SDK closes the transport, the process cannot keep serving. Ending loudly with a non-zero exit is the fail-closed choice. The rule is not changed, and no code changes.

2. **A line that is not JSON is never logged** (review I-2, ruling: accepted as a documented limit). `ReadBuffer.readMessage` skips a SyntaxError (`src-Cqbh3MYc.mjs`, around line 7185) before the transport's error event, so the SDK never reports it. The process does not exit on it, which is the property that matters. Logging it would mean splitting lines and parsing JSON on the stdin data again, which duplicates the SDK's work. No code changes.

3. **Framing lines are not capped** (review M-1, ruling: accepted). Each frame that is valid JSON but not JSON-RPC writes one stderr line. The SDK caps the size of its read buffer (the 10 MiB limit above), but not how many frames a client sends. So the volume of stderr lines follows the client's frame rate, and the process stays up. Counting or summarising the lines is not done.

4. **A Node warning can come before our stderr line when a write fails with EPIPE** (review M-2, ruling: accepted). With a backpressured stdout, the SDK's per-send `once('error')` and `once('drain')` listeners can go over Node's listener limit. Node then writes a `MaxListenersExceededWarning` to stderr before our `ig mcp: transport error: Error` line. The warning is the SDK's own behaviour, and it holds no secret. The claim of one stderr line holds for our lines only.

#### Counts

- `test/mcp.test.js`: 32 pass, 0 fail.
- `npm test`: 1052 pass, 0 fail, exit code 0. The output has no warning line (`scratchpad/npm-test-p5b-round4.txt`).

## Final round (2026-10-23)

Scope: S-K1 in `final-review-2.md`. The API is plain HTTP, so a non-loopback host with a bearer token sends the token in clear text on that network. The rule is now a stated, controlled exception: `http.allowRemote` must be `true` before serve binds a non-loopback host, and before status sends the token to one.

### Changes, with file and line

| Item | File and line | Change |
|---|---|---|
| Config default | `src/config.js:70-72` | `http.allowRemote` defaults to `false`. A comment says what it gates and why (the API is plain HTTP). |
| Config check | `src/config.js:260` | `flag('http.allowRemote', ...)`, so a value that is not a real boolean is refused with the field named. The string `"true"` is refused. |
| Loopback helper | `src/cli.js:106-108` | `isLoopbackName`: 127.0.0.1, ::1 or localhost, with or without brackets, in any case. |
| Serve gate | `src/cli.js:110-122` (`assertServeHost`) | A non-loopback host without `allowRemote: true` is refused with CONFIG. The message names `http.allowRemote`. Only after that does the existing token check run. Loopback is unchanged. |
| Serve call | `src/cli.js:871` (`buildServe`) | Passes `allowRemote: config.http.allowRemote`. The refusal comes before any state is written and before any listener is built. |
| Status gate | `src/cli.js:605-612` (`runStatus`) | The target is the host after the wildcard mapping (`0.0.0.0`, `::` and empty go to 127.0.0.1). A non-loopback target without `allowRemote: true` prints the reason, prints the local summary, returns `refused_remote`, and makes no request. |
| Status warning | `src/cli.js:612` | With `allowRemote: true` and a non-loopback target, one line goes out before the request: `warning: http.allowRemote is true, so ig status sends to <host> over plain HTTP, and the traffic is not encrypted.` It carries no token. |

`src/http.js` is unchanged in this round. Its own host check (the line that S-K1 cites at `src/http.js:160-162`) still accepts a non-loopback host with a token at the library level. The gate is in serve (`buildServe`, which calls `assertServeHost`) and in status (`runStatus`), so no serve path reaches a listener without it.

### Tests

New tests in `test/cli.test.js`:

1. `serve refuses a non-loopback host without http.allowRemote, names the key, and builds nothing` (line 198). `assertServeHost` throws CONFIG with `http.allowRemote` in the message. `buildServe` rejects, and no `state.json` is written.
2. `serve starts on a non-loopback host with http.allowRemote and a token, on the configured host and port` (line 214). `buildServe` succeeds. The listener's `listen` is replaced by a recording stub, `listenHttp` is called, and the recorded call is `[8788, '192.168.1.10']`. No socket is opened.
3. `status refuses to send the token to a non-loopback host without http.allowRemote, and sends nothing` (line 716). The fetch stub records calls and throws if called. It is never called. The result is `refused_remote`, the output names `http.allowRemote`, and no token is printed.
4. `status with http.allowRemote sends the token over plain HTTP, prints one warning line that the traffic is not encrypted, and prints no token` (line 734). One request goes to `http://192.168.1.10:8788/tools/ig_status` with the bearer header. Exactly one `warning:` line is printed, it says `not encrypted`, and the token is not in the output.
5. `status reaches a wildcard bind on loopback, so it needs no http.allowRemote and prints no warning` (line 756). A guard against over-refusal: `0.0.0.0` goes to `127.0.0.1` with no refusal and no warning.

New test in `test/config.test.js`:

6. `http.allowRemote is false by default, and a value that is not a real boolean is refused with the field named` (line 147). The values `"true"`, `1` and `null` are refused with `http.allowRemote` named.

Changed tests, with the old and new assertions:

| Test | Old | New |
|---|---|---|
| `serve refuses a non-loopback host without api_token` (test/cli.test.js:172), renamed to `serve refuses a non-loopback host without api_token, and without http.allowRemote` | `assert.doesNotThrow(() => assertServeHost({ host: '0.0.0.0', apiToken: 'API-TOKEN-VALUE-1' }))` | `assertKind(() => assertServeHost({ host: '0.0.0.0', apiToken: 'API-TOKEN-VALUE-1' }), 'CONFIG')`. Added: `assertKind(... allowRemote: false ..., 'CONFIG')` and `assertKind(... apiToken: null, allowRemote: true ..., 'CONFIG')`, and `assert.doesNotThrow(... allowRemote: true ...)` for the token case. The loopback assertions are unchanged. |
| `the default config has exactly the documented shape` (test/config.test.js:122) | `http: { host: '127.0.0.1', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'] }` | `http: { host: '127.0.0.1', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'], allowRemote: false }` |

The existing test `serve refuses a non-loopback host without api_token before it builds anything` (test/cli.test.js:188) is unchanged. Its host is `0.0.0.0` with no `allowRemote`, so it is still refused with CONFIG.

### Counts and checks

- `test/config.test.js` and `test/cli.test.js`: 135 pass, 0 fail before the full run.
- Mutation checks. Each gate was disabled in turn, and the file was restored and compared byte for byte. Disabling the serve gate fails the two serve refusal tests. Disabling the status refusal fails test 3. Disabling the warning fails test 4.
- `npm test`: 1167 pass, 0 fail, exit code 0 (`scratchpad/npm-test-final-round.txt`).
- Nothing listens and no network call is made. The serve start test uses a `listen` stub. The status tests use a fetch stub, and the refusal test's stub throws if it is called.

### Known limits and notes

- The refusal exits 0. `bin/ig.js:155` ignores the value that `runStatus` returns. That is the same as before, when status printed the not-running notice and exited 0. The reason is printed, and `refused_remote` is returned for a caller that reads it.
- The README does not change in this round. The S-K1 sentence ("The HTTP API is plain HTTP. On a non-loopback host, api_token travels in clear text on that network; keep the host on loopback or put the API behind TLS.") still needs a place in the README. The controller should add it, because this round's files do not include the README. The stated exception is in the config comment, in the serve refusal message, and in the status refusal and warning.
- The full suite prints one Node warning line, `(node:PID) Warning: audit line not written (Error)`. It comes from `test/service.test.js:1989`, the test `a failed privateReply audit write sets the one-reply flag, and the next private reply is refused with no request`. That test makes its audit throw and does not stub `process.emitWarning`. The output is therefore not pristine. The file is not in this round, and it was modified at 03:45 today by another process, so I did not change it. The stub pattern used elsewhere in the file would fix it.

### Fix: a refused status exits 1 (2026-10-23)

Fix to the final round above. `ig status` ignored the code that `runStatus` returned for a refusal, so it exited 0 when it refused to send the token to a non-loopback host. Now a refusal exits 1, and prints only the reason. A successful status and the "service not running" summary still exit 0. The README is not edited; the sentence for the plain-HTTP guard is the docs owner's.

#### Changes, with file and line

| Item | File and line | Change |
|---|---|---|
| Refusal output | `src/cli.js:682-687` (`runStatus`) | The refusal is printed through a new `err` parameter (default `logErr`, stderr), as the one reason line. The local summary is no longer printed on a refusal. The refusal check now comes first, before the state file is read and before the token is read, so a refusal reads nothing and sends nothing. |
| Exit code | `bin/ig.js:180-194` (`command('status')`) | `runStatus` gets `err: sayErr`. A returned `'refused_remote'` sets `process.exitCode = 1`. Every other outcome leaves the exit at 0. |
| Test fixture | `test/fixtures/status-fetch-stub.mjs` (new, 11 lines) | Loaded into a child process with `--import`. It replaces `fetch` in that process only, reports each call on stderr with its URL and whether an Authorization header was sent, and never writes the token. No network call. |

Changed test, with the old and new assertions (`test/cli.test.js:717`, `status refuses to send the token to a non-loopback host without http.allowRemote, and sends nothing`):

| Old | New |
|---|---|
| `runStatus({ ..., out })` | `runStatus({ ..., out, err })`, with a separate `err` collector |
| `assert.match(out.text(), /http\.allowRemote/, 'the reason names the key')` | `assert.equal(out.text(), '', 'nothing goes to stdout')`, then `assert.equal(err.text().split('\n').length, 1, 'the reason is the only line')`, then `assert.match(err.text(), /http\.allowRemote/, 'the reason names the key')` |
| `assert.ok(!out.text().includes(token))` | `assert.ok(!err.text().includes(token))` |

The `calls` check (no request) and the result (`refused_remote`) are unchanged.

New tests, in `test/cli.test.js` (the helper `runIgStatus` is at line 781):

1. `ig status with a non-loopback host and no http.allowRemote exits 1, prints only the reason, and sends no request` (line 800). The child process exits 1. Its stdout is empty, its stderr is one line that names `http.allowRemote`, and the stub reports no `FETCH`. The token is not printed.
2. `ig status with http.allowRemote still exits 0, sends the token over plain HTTP, and prints one warning line` (line 811). The child process exits 0. The stub reports one `FETCH` to `http://192.168.1.10:8788/tools/ig_status` with `authorization=yes`. Stdout has exactly one `warning:` line, which says `not encrypted`. The token is printed nowhere.
3. `ig status on loopback still exits 0 on a successful status` (line 821). Exit 0, a request to `127.0.0.1`, and the result is printed.

The helper `runIgStatus` writes a config file to a temporary directory, sets `IG_API_TOKEN` in the child's environment so the keyring is not read, and runs `node --import <stub> bin/ig.js --config <file> status`.

#### Counts

- `test/config.test.js` and `test/cli.test.js`: 138 pass, 0 fail.
- `npm test`: 1172 pass, 0 fail, exit code 0. The output has no warning line (`scratchpad/npm-test-status-exit.txt`).

#### Notes

- The mutation check was not run on `bin/ig.js`. Another writer was editing that file during this round, and a backup and restore could have overwritten its changes. Test 1 asserts exit code 1 directly, so it would fail without the mapping.
- The notice from the system said `src/cli.js`, `bin/ig.js` and `test/cli.test.js` had changed on disk between 04:34:31 and 04:34:39. I checked that my changes in those files are intact. The lines above the `serve` command in `bin/ig.js` (the `auth` block, and the `routes login-unofficial` command at about line 239) are not from this round. I did not change them, and I did not check their history.
- The earlier note in this round that "the refusal exits 0" is superseded by this fix. The earlier statement that the refusal prints the local summary is also superseded: the refusal prints only the reason.

### Final round (2026-10-23): serve warning

The docs check asked for one warning line when `ig serve` starts on a non-loopback host that `http.allowRemote` allows. The API is plain HTTP, so the bearer token and the API traffic travel unencrypted on that network. The line carries no token. A loopback start prints nothing extra. The README is not edited.

#### Changes, with file and line

| Item | File and line | Change |
|---|---|---|
| Warning text | `src/cli.js:138-144` (`remoteServeWarning`, exported) | Returns null for a loopback host. Otherwise returns `warning: the HTTP API is plain HTTP on <host>:<port>. The bearer token (api_token) and the API traffic travel unencrypted on that network. Keep the host on loopback, or put the API behind TLS.` An IPv6 host is shown in brackets. The line holds no token. |
| Printed at start | `src/cli.js:1153-1154` (`startServe`, after the `HTTP API listening` line) | Calls `remoteServeWarning` with the configured host and port, and prints the line on stderr through `err` when it is not null. A loopback start prints nothing here. |
| Injectable backstop | `src/mcp.js:209` (`flushThen`), `:217` (the timer), `:236` (`startStdio` option `flushLimitMs`), `:250` (the call) | `flushLimitMs` defaults to `FLUSH_LIMIT_MS`, so the default is unchanged. This replaces the mock-timer test, which caused the Node 22 warning below. |
| Exported constant | `src/mcp.js:183` | `export const FLUSH_LIMIT_MS = 5000`, so a test can pin the default. |
| Doc comment | `src/mcp.js:229-230` | Names `flushLimitMs` among the injectable options. |

#### Tests

New tests in `test/cli.test.js`:

1. `serve on a non-loopback host with http.allowRemote prints one plain-HTTP warning line on start, and no token` (line 254). The start goes through `startServe`, with the owner check replaced, the poller start replaced, and `listen` replaced by a recording stub. The stub reports `listening` on the next turn, so no socket is opened and no Graph call is made. The test asserts that the recorded listen is `[8788, '192.168.1.10']`, that the output has `HTTP API listening on 192.168.1.10:8788`, that stderr has exactly one `warning:` line naming `plain HTTP` and `unencrypted`, and that the token is printed nowhere. `t.after` runs `shutdown`, which clears the token-check timer.
2. `serve on loopback prints nothing extra: stderr stays silent and no plain-HTTP line is printed` (line 272). The same start on `127.0.0.1`. The test asserts that the recorded listen is `[8788, '127.0.0.1']`, that stderr is an empty string, and that stdout has no `plain HTTP`.
3. `remoteServeWarning is null for a loopback host, and otherwise names the plain-HTTP risk without a token` (line 284). Null for `127.0.0.1`, `localhost`, `::1` and `[::1]`. For `::` the line starts `warning: the HTTP API is plain HTTP on [::]:8788. `, and for `192.168.1.10` it names port 9000 when given 9000. The line has no token.

Changed test in `test/mcp.test.js` (line 554, the backstop test). The old version used the mock-timer API. Its assertions were the same as the new ones, apart from the timing:

| Old | New |
|---|---|
| `test('a stdout that never flushes still ends the process, after the backstop', async (t) => {` with `t.mock.timers.enable({ apis: ['setTimeout'] });` | `test('a stdout that never flushes still ends the process, after the backstop', async () => {`, with `flushLimitMs: 20` passed to `startStdio` |
| `t.mock.timers.tick(4999);` then `assert.deepEqual(stand.exits, [], ...)` | `assert.deepEqual(stand.exits, [], ...)` straight after `transport.onerror`, then a 100 ms real timer |
| `t.mock.timers.tick(1);` then `assert.deepEqual(stand.exits, [1]);` | `assert.deepEqual(stand.exits, [1]);` after the 100 ms wait |
| (the late flush assertion is unchanged) | `stand.pending[0](); assert.deepEqual(stand.exits, [1]);` |

New test in `test/mcp.test.js` (line 575): `the default backstop is 5000 ms`, which asserts `FLUSH_LIMIT_MS === 5000`.

No test listens or makes a network call. The new serve tests use listen stubs, and the `startServe` path is replaced where it would reach Graph.

#### Counts

- Node 24.6.0: `npm test` gives 1208 pass, 0 fail, exit code 0, and the output has no warning line (`scratchpad/final-24.txt`).
- Node 22.13.1: `npm test` gives 1208 pass, 0 fail, exit code 0, and the output has no warning line (`scratchpad/final-22.txt`).

#### Node 22.13.1

Node 22.13.1 was not on this machine. It was downloaded from `https://nodejs.org/dist/v22.13.1/` into `scratchpad/node22-dl/`, and its SHA-256 was checked against the published `SHASUMS256.txt` (398a61e250a5584a62a5959e2f69f5d597fc83f1a5ebe3ed8fff29ba39d55f14, which matched). It was then extracted into `scratchpad/node22/node-v22.13.1-win-x64/`. Nothing was installed system-wide. The Node 22 run put that directory first on PATH. In that shell, `which node` gives that directory and `node --version` gives `v22.13.1`. `npm` itself was the one that ships with the Node 24 install. The test script's `node` was 22.13.1, and the child processes of the binary tests use `process.execPath`, so they also ran on 22.13.1.

The first Node 22 run showed one warning line, `ExperimentalWarning: The MockTimers API is an experimental feature`. It came from the backstop test's `t.mock.timers`. The test now uses a real timer, and the warning is gone.

#### Notes

- The status warning (the earlier final round) goes to stdout. The serve warning goes to stderr. Both are one line and both carry no token. If the owner wants one stream for both, the status line can move to stderr.
- The mutation check was not run on `src/cli.js` for the serve warning. That file had been written by another process during an earlier round, and a backup and restore could overwrite its changes. The tests assert the exact stderr output, so a removed warning fails the first test.
