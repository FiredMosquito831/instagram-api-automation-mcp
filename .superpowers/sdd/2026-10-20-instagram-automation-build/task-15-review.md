# Task 15 review: HTTP API

Scope: task-15-base to task-15-head. Files: `src/http.js` (288 lines), `test/http.test.js` (45 new tests). Read-only: no project file was edited, and the suite was not re-run. The 45-test count is confirmed in the diff. The test file has no `listen` call and no network call (only `server.listening` is read). Line numbers are from the project copies of `src/http.js` and `test/http.test.js`, and from `src/webhooks.js`, `src/tools.js`, `src/errors.js` and `src/config.js`.

## Spec compliance

Verdict: ✅ for every brief requirement and every named check in this task's scope. The items I could not close from the diff are marked ⚠️.

Brief requirements:
- ✅ `createHttpServer` throws CONFIG for a non-loopback host with an empty token (`src/http.js:110-111`). It does not listen: `src/http.js:286-287` returns `createServer(...)` with no `listen` call. Tests: `test/http.test.js:298-311`.
- ✅ Host check: the lowercased Host, with its port, must be in the allowed set (`src/http.js:140-143`). It runs first for every route (`src/http.js:249-251`). A missing Host fails the `typeof` check. A wrong port fails the match. An allowed name without a port gets the configured port (`src/http.js:130-135`). Tests: `test/http.test.js:262-297`.
- ✅ `GET /health` returns 200 `{ ok: true }` with no token (`src/http.js:253-256`). Test: `:96-101`.
- ✅ `POST /tools/:name`: a missing or wrong token is 401 (`src/http.js:214-216`; the message is fixed, `:215`). The comparison hashes both values with SHA-256 and then calls `timingSafeEqual` (`src/http.js:174-179`). An empty expected token never matches (`:175`). The token is read from the Authorization header only, and the query is not read. Test: `test/http.test.js:369-375`.
- ✅ Body: `readBody` uses `readRawBody` with `MAX_BODY_BYTES = 1048576` (`src/http.js:19`, `:184-198`). Over the limit gives 413 with `Connection: close` (`src/http.js:190-196`). A body that is not JSON gives 400 (`src/http.js:201-209`). `validateArgs` runs before the handler (`src/http.js:226`). An unknown tool gives 404 before the body is read (`src/http.js:223-224`). Test: `test/http.test.js:412-418`.
- ✅ The handler is called with the service and the validated args (`src/http.js:227`). A busy result gives 429 with the busy body (`src/http.js:228-230`). Success gives 200 `{ result }` (`src/http.js:231`). The status table is at `src/http.js:33-39` and `:59-70`. Every error message is redacted (`src/http.js:84`).
- ✅ Webhook path: GET and POST pass `{ method, query, headers, rawBody }` to the handler (`src/http.js:236-245`). With no handler, 404 (`src/http.js:258`). Other methods give 405 with `Allow` (`src/http.js:237`). The Host check applies (`src/http.js:249-251`). Test gap: M-6.
- ✅ Unknown methods on a served path give 405 (`src/http.js:213`, `:237`, `:254-255`). An unknown path gives 404 for any method (`src/http.js:263`). A disabled webhook path gives 404 for every method, which is the brief's null-handler rule (`test/http.test.js:145-152`).
- ✅ Carry-forwards: the N-1 closed-request guard (`src/http.js:185-187`) has tests for ended, destroyed and webhook-ended requests (`test/http.test.js:493-516`). The 413 on the tools route is tested (`test/http.test.js:426-441`).
- ✅ The ten brief tests are present by name: `test/http.test.js:96, 102, 111, 120, 130, 145, 154, 262, 298, 426`.

Checks named in the review brief:
- ✅ Token never in a URL, a log, an error or a response. The only output of the token is absent from every path. Test: `test/http.test.js:583-596`.
- ✅ Unknown method on a served path is 405, not a guess. Covered by `test/http.test.js:377-388`.
- ✅ Fail-open paths checked: no path with a missing token passes; no route skips the Host check; no body is read past 2 MB (readRawBody stops, `src/webhooks.js:288-292`); no handler error returns 200; no busy result returns 200; no validation is bypassed.

⚠️ Items this diff cannot close, or that depend on other tasks or on the owner:
1. Bind address: this module never binds. The loopback default holds only if Task 17's serve calls `listen` with the validated host. See I-1.
2. Webhook enabled gate: spec line 166 says the path answers 404 unless `webhook.enabled` is true. This holds here only if serve passes `webhookHandler = null` when the webhook is disabled. This is a Task 17 item (M-11).
3. Webhook Host: Meta's deliveries carry the public Host. Without a reverse proxy that rewrites Host to an allowed value, every delivery gets 403. The ledger accepted this ruling. The owner decides whether the webhook path should be exempt from the Host check, since its signature is the control there. The spec text does not settle it. This belongs in the Task 18 README.
4. Verify token: Meta's handshake sends `hub.verify_token` in the URL by design. `src/http.js` does not log it, but a reverse proxy's access log would. This belongs in the README.
5. Node 22.12 has not been run (Task 18). The N-1 guard depends on the `destroyed` and `readableEnded` flags of a real `IncomingMessage`. The report says these were checked only on Node 24.6.0.
6. The constant-time comparison and the generic 500 message were checked by reading the code only. The report says so too.
7. The Host rule and the non-loopback token rule are in `global-constraints.md:17` and in the brief. The spec's HTTP text (spec lines 14 and 163) does not state them. This is a documentation gap for the Task 18 spec update.

## Strengths

- The check order is sound: Host, route, method, token, tool lookup, body, validation, handler. An unauthenticated caller learns no tool names, because a bad token gets 401 before the lookup (`src/http.js:214-223`).
- Token handling is careful. The token comes only from the header. Both values are hashed before the comparison. An empty expected token never matches. The token is trimmed and registered as a secret at construction, and a token too short to register is refused with CONFIG (`src/http.js:123-129`).
- Failure is closed everywhere. Every error becomes a response. An unexpected error becomes a generic 500 (`src/http.js:69`). `createRequestHandler` never rejects (`src/http.js:268-283`).
- The body rules are explicit: a 1 MB limit, 413 with `Connection: close`, and a non-object JSON value refused with 400. The N-1 hang is guarded before the read, and the three request states are tested.
- Every result, busy reason and error message passes through `redact` (`src/http.js:84`, `:228-231`).
- The tests are substantive. They use fake requests and responses, have no `listen` and no network call, and check the error table against `ERROR_KINDS`, so a new kind fails the test (`test/http.test.js:551-573`).
- The module has no unused imports. `createHttpServer` only builds the server. The config defaults (`src/config.js:62`) match the defaults in `src/http.js`.

## Issues

### Critical

None.

### Important

**I-1. The validated bind host is never carried to the listener.** `src/http.js:110-111` checks that a non-loopback host has a token, and `src/http.js:286-287` returns a bare server. The host is not kept, so a caller that calls `server.listen(port)` binds every interface. The loopback default and the token rule are then bypassed by the caller, and this API makes that easy. Fix: keep the validated `{ host, port }` with the server (for example, in a WeakMap). Export a `listenHttp(server)` that calls `server.listen(port, host)` from that record, and throws CONFIG for a server this module did not build. Task 17's serve uses only `listenHttp`. Test it without a real listen: replace `listen` on a server from `createHttpServer` with a recording function, call `listenHttp`, and check the arguments.

### Minor

**M-1. IPv6 allowed entries and host.** `src/http.js:27` (`ENDS_WITH_PORT`) matches the `:1` in `::1`. So a bare `::1` entry is treated as a full Host value and never matches the `[::1]:8788` that a client sends. This fails closed, but the owner gets 403 on a valid config. `src/http.js:25` (`LOOPBACK_HOSTS`) does not contain `[::1]`, so a bracketed host needs a token. Fix: detect a port with `/^(\[[^\]]+\]|[^:]+):\d+$/`, and accept `[::1]` as loopback. Add tests for both forms (`test/http.test.js:285-297`).

**M-2. Duplicated lookup, and `findTool` not used.** `src/http.js:223-224` does `ctx.tools.find(...)`. The brief lists `findTool` as a consumed interface (`src/tools.js:449-451`). The lookup rule now lives in two places. Fix: give `findTool` an optional list, `findTool(name, tools = TOOLS)`, and call it from `src/http.js`. This is a small change to a Task 14 module.

**M-3. Unexpected errors leave no trace.** `src/http.js:69` turns any non-IgError into a generic 500, and nothing is logged or audited. A handler bug is invisible. Fix: record the error name and the redacted message, with no stack, through an audit log or logger that the caller supplies.

**M-4. Stop kinds share the 500 of a crash (owner decision).** `src/http.js:33-39` and `:61-68`. AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED and RATE_LIMITED are persisted stops, but they return 500, as the brief's table says. A status-only client cannot tell a stop from a failure. The test at `test/http.test.js:551-573` pins this. The owner decides whether stop kinds get their own status (for example 409 or 503). This is not a deviation from the brief, and if it changes, that test changes with it.

**M-5. The webhook handler receives the API token.** `src/http.js:242` passes every request header, including any `Authorization` header that carries the API token. The webhook code reads only `x-hub-signature-256` today. Fix: pass only the headers the handler reads, or drop `authorization` before the call.

**M-6. No test for the Host check on the webhook path.** `src/http.js:249-251` applies the check to every route, but no test sends a bad Host to the webhook path. Fix: a webhook POST with `Host: evil.example` gets 403, and the handler is not called.

**M-7. Extra export.** `src/http.js:19` exports `MAX_BODY_BYTES`. The surface the brief expects is `createHttpServer`, the `port` option, and the handler factory. A test-only export is acceptable, but say so in a comment or keep the constant internal.

**M-8. Duplicated constant-time compare.** `src/http.js:174-179` (`tokenMatches`) and `src/webhooks.js:50-54` (`sameText`) do the same thing. Fix: export one helper from `src/webhooks.js` and import it here.

**M-9. Content-Length is not checked up front.** `src/http.js:184-198` and `src/webhooks.js:288-292`. A body whose Content-Length is over the limit is read up to 2 MB before it is refused. This is not a security hole. Fix: if the header is over `MAX_BODY_BYTES`, throw the 413 before reading.

**M-10. A test name overclaims.** `test/http.test.js:312-322`, "a loopback host is built without an api token, and then refuses every tool call", tries two header values only, one of them `Bearer ` with no token. Rename it to what it checks, or add the cases.

**M-11. Carry-forwards not recorded in the ledger (process).** The ledger's Task 10 carry-forward says "Task 15 must pass audit and now shared with the event log" (`progress.md:237`). The report moves it to Task 17 (`task-15-report.md:104-107`) without a ledger ruling. The webhook gate (spec line 166) is also not recorded for Task 17: serve must pass `webhookHandler = null` when `webhook.enabled` is false. The controller should record both for Task 17.

**M-12. HTTP-only error kinds sit outside `ERROR_KINDS`.** `src/http.js:59-69` and `:75-83` use UNAUTHORIZED, FORBIDDEN, NOT_FOUND, METHOD_NOT_ALLOWED, PAYLOAD_TOO_LARGE and INTERNAL. The report documents them, and the MCP forwarder (Task 16) must map them. No test links the two lists, so they can drift. Fix: export the HTTP-only kinds from one place that Task 16 imports, and test them against that list.

**M-13. Where the N-1 guard lives.** `src/http.js:184-198`. The guard works around `readRawBody` (`src/webhooks.js:300-310`), which does not check for a closed or ended stream. When the deferred N-1 fix lands, move the guard into `readRawBody`, so both callers get it, and leave `http.js` to routing and auth. This is a code-quality point, not a defect.

### Known limit (deferred, not counted)

**N-1.** `readRawBody` (`src/webhooks.js:266-311`) still hangs on a stream that has already ended or been destroyed when it is called directly, because the `end` and `close` listeners at `:306-309` never fire again. The only caller is `src/http.js`, and its guard at `:185-187` covers it. This is deferred to the final review, as the controller directed.

## Assessment

Task quality: **Needs fixes.** I-1 is the reason. The validated loopback host is never carried to the listener, so the constraint that the API binds `127.0.0.1` by default depends on Task 17 calling `listen` correctly. The fix is small and should land before Task 17. The Minor items can go to the final review or to Task 17, and they do not need a fix round of their own.

Spec: **✅** for this task's scope, with the ⚠️ items above. I found no fail-open path in `src/http.js`.
