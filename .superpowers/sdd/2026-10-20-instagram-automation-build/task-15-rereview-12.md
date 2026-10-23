# Task 15 re-review: fix rounds 1 and 2

Scope: fix rounds 1 and 2 of Task 15 (HTTP API), net diff review-task-15-fix12.diff (task-15-head to task-15-fix2-head). Read: task-15-review.md, progress.md (Task 15 entries), global-constraints.md (HTTP lines), task-15-report.md (fix rounds 1 and 2), src/http.js (current), src/tools.js (findTool), test/http.test.js (the changed tests). Read-only. The suite was not re-run. Two focused node checks were run inline, with no file written: (1) the HOST_VALUE and Content-Length regexes and the bracket strip on a set of inputs; (2) dns.lookup on a space and on a tab, to see whether a whitespace listen host could bind every interface.

Line numbers are for the current project files. The test-file line numbers in task-15-report.md are stale (see Notes).

## Finding verdicts

**I-1: ADDRESSED.**
- The validated host and port are kept per server. buildContext strips the brackets and checks the host (src/http.js:151-153) and returns `host` and `port` (:174). The WeakMap `bindings` holds them (:315), and createHttpServer records them at build (:345).
- `listenHttp(server)` calls `server.listen(binding.port, binding.host)` (src/http.js:351-354). A server this module did not build throws CONFIG (:353).
- Test test/http.test.js:333-354 replaces `listen` with a recording stub on three servers and asserts `[9123,'127.0.0.1']`, `[9124,'::1']`, `[8788,'127.0.0.1']`. No socket is opened. Test :355-366 covers `new Server()`, an impostor whose listen throws if called, and undefined. Each throws CONFIG.
- A direct `server.listen` on the returned server still binds every interface. This is the ruled known limit (see K-2).

**M-1: ADDRESSED.**
- HOST_VALUE is at src/http.js:29. hostParts is at :92-95, allowedKey at :98-107, hostAllowed at :179-182.
- An allowed `[::1]` matches Host `[::1]:8788`: test :298-303.
- A bare `::1` Host, and `::1:8788`, give 403: test :304-311. A bare `::1` allowed entry throws CONFIG (src/http.js:100-104; test :312-318). A bare address has no port, so it is refused rather than given the configured port.
- Node check: `[::1]:8788` splits to name `[::1]` and port `8788`. `[::1]` gives port null. `::1` and `::1:8788` do not match. `127.0.0.1:08788` keeps the port as `08788`, so it does not match 8788. The split is right for bracketed forms and for names with a port.
- Gap, not counted: the loopback acceptance of host `[::1]` without a token (bracket strip at src/http.js:151, loopback test at :153) has no test. The no-token loopback test at test/http.test.js:377-389 uses unbracketed `::1`.

**M-2: ADDRESSED (behavioural test, accepted by ruling).**
- src/http.js:16 imports findTool. src/http.js:270 calls `findTool(name, ctx.tools)`. src/tools.js:448-451 defines `findTool(name, tools = TOOLS)`.
- The default keeps the single-argument callers at test/tools.test.js:95 and :298-306. No caller passes findTool as a callback (grep of src, test and bin).
- The test at test/http.test.js:679-698 is behavioural. Its name overclaims; see N-1.

**M-3: ADDRESSED (name-only warning is the brief's standard).**
- warnUnexpected (src/http.js:121-124) emits `the HTTP API caught an unexpected <name>`. The name is used only when it is 1 to 40 ASCII letters, otherwise `Error`. There is no message and no stack.
- It runs only for errors that are neither HttpFailure nor IgError (src/http.js:325). The response is the generic 500 from failureOf (:71), sent through sendFailure (:327).
- Tests: test/http.test.js:604-628 (500, generic body, warning exactly `...unexpected TypeError`) and :700-724 (`...unexpected Error`). The stub is restored in finally (:620-622 and :717-719), and the restored function is asserted equal to the original (:627 and :723).
- The original review text also asked for the redacted message. The implementer left it out. The brief's check is the error name only, so the verdict is on that standard.

**M-5: ADDRESSED.**
- webhookHeadersOf (src/http.js:111-117) drops every header whose lowercase name is `authorization`. Other headers are copied unchanged. It is used at :289. The handler receives only `{ method, query, headers, rawBody }` (:286-291).
- Test test/http.test.js:726-751: both `authorization` and `Authorization` are dropped, `x-hub-signature-256` and `content-type` pass through, and the token does not appear in the headers object.

**M-6: ADDRESSED.** route (src/http.js:296-298) runs the Host check before the webhook branch (:304). Test test/http.test.js:753-771: GET and POST with a bad Host both give 403, and the handler is never called (`seen` is empty).

**M-9: ADDRESSED.**
- readBody (src/http.js:227-245) checks the declared length at :231-238, before readRawBody at :240. A value that is not digits gives 400 (:234-235). A value over MAX_BODY_BYTES gives the 413 with `Connection: close` (:237, builder at :224-225).
- Both routes use it. serveTool reads its body at :272, after the token check and the tool lookup. serveWebhook reads it at :285, for POST only.
- Tests: tools route test/http.test.js:773-787 (413, Connection close, `readableDidRead` false, no service call). Webhook route :788-804 (413, `readableDidRead` false, handler not called). Non-digit length :806-816 (400, body not read).

**M-10: ADDRESSED.** The name at test/http.test.js:377 matches the assertions at :378-388. Three loopback hosts build unlistened, and `Bearer ` and `Bearer x-token-value-000000` each give 401.

**Round 2 (warning output): ADDRESSED.** The two unexpected-error tests stub `process.emitWarning` (test/http.test.js:611-615 and :708-712), restore it in finally (:620-622 and :717-719), and assert the exact recorded list and the restored function (:626-627 and :722-723). test/service.test.js:1012-1030 carries the same stub pattern for the Task 13 test. That file is outside this diff, and I did not run it.

## New breakage

Known limits, not counted:
- **K-1 (known limit, pre-existing).** src/http.js:337-339: `createRequestHandler` is exported and does not carry the validated host. A caller can pass the handler to `http.createServer(...)` and call `listen(port)`, which binds every interface, without listenHttp. The export is the same at task-15-head, and rounds 1 and 2 did not change it. It is the same class as the ruled direct-listen limit. Task 17 must build with createHttpServer and start with listenHttp, and must not serve from createRequestHandler.
- **K-2 (ruled).** A direct `server.listen` on the createHttpServer output (src/http.js:342-347).

New, Minor:
- **N-1 (Minor).** test/http.test.js:679: "an unknown tool name is 404 through findTool". The test cannot observe findTool: a `ctx.tools.find` would give the same results. The ledger accepted the test as behavioural, so the body is fine, but the name claims the mechanism. That is the same defect class as M-10. Fix: rename it, for example "an unknown tool name is 404 when the handler's own tool list lacks it".
- **N-2 (Minor).** src/http.js:151-152: the empty-host guard tests `bindHost === ''` after trim and bracket strip. A host of `[ ]` gives `' '`, which passes construction when a token is set. The test at :367-376 covers only `'  '` and `'[]'`. Node check: `dns.lookup(' ')` and `dns.lookup('\t')` both fail with ENOTFOUND, so the lookup that listen performs fails rather than binding every interface. This fails closed and is not a bind-all. Fix: check the stripped value with trim, and add `[ ]` to the test.

Checked, none found:
- **Listen by another path that binds every interface:** only K-1 and K-2.
- **Host check that accepts a non-loopback host:** none. The match is exact after parsing. Node check: `localhost:8788@evil` and `127.0.0.1.evil.example:8788` do not match, and `localhost/:8788` parses to a name that is not in the set. Only configuration can add a non-loopback name.
- **Token passed to the webhook handler through another field:** none. The handler gets method, query (taken from the URL only), headers (Authorization removed) and rawBody. The token is read only from the Authorization header (src/http.js:204-209).
- **Content-Length that accepts a value it should refuse:** none. `^\d+$` (src/http.js:234) refuses ` 5`, `+5`, `-1`, `1e3`, `12abc`, an empty string and Arabic-Indic digits (node check). A long leading-zero value over the limit gives 413, because Number compares it correctly. A value within the limit is still capped by readRawBody.
- **Error path that returns 200:** none. Unexpected errors give 500 (src/http.js:325-327). If the warning or the send throws, the connection is destroyed (:328-331).
- **Fail-open path:** none. The Host check runs first (:296-298). tokenMatches returns false for an empty expected token (:213-215). An empty bind host is refused (:152). The loopback test is an exact set after lowercasing (:153). listenHttp refuses any server this module did not build (:353).
- **Warning flood by an unauthenticated caller:** not reachable. The tools route needs the token before any unexpected error. The webhook route checks the signature (src/webhooks.js:208) before JSON.parse (:212).

Notes, not counted:
- src/http.js:220-222: the readBody doc comment now sits above `tooLarge` (:223-225), not above readBody (:227). Cosmetic.
- task-15-report.md gives stale test-file line numbers. The M-6 test is at :753, not 737. The findTool test is at :679, not 665. The M-3 test is at :700, not 686. The test names in the report are correct.
- Node 22 has not been run (Task 18). The suite was not re-run.

## Round verdict

Findings remaining, Minor only. Critical: 0. Important: 0. Minor: 2 (N-1, N-2).

All in-scope items (I-1, M-1, M-2, M-3, M-5, M-6, M-9, M-10, and the round 2 warning change) are ADDRESSED.
