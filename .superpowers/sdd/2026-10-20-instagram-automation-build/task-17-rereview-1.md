# Task 17 focused re-review: fix round 1

Range: task-17-head to task-17-fix1-head (diff review-task-17-fix1.diff). Read-only. The project is not a git repository, so the snapshot diff was used. No project file was edited, the suite was not re-run (the report holds 725/725), and no subagents were spawned.

Checks made: the diff was read in full; the live src/cli.js, src/service.js, src/poller.js, src/oauth.js, src/http.js, src/graph/client.js and bin/ig.js were read where the diff points; every test file under test/ was searched for listen, createServer, fetch and the call sites of the changed functions, and the changed tests were read. One focused check was run: `node -e` parsing two URLs with the WHATWG URL class (no socket, no request), to confirm the IPv6 probe URL behaviour in N-1.

---

## Finding verdicts

- **I-1 (usage relay): ADDRESSED.** The service is created first (`src/cli.js:449`). The poller's client is `getClient('instagram', { onUsage: service.recordUsage })` (`src/cli.js:475`), and the service exposes `recordUsage: onUsage` (`src/service.js:513`). Every Graph client goes through `makeGraphClient`, which refuses without onUsage (`src/cli.js:144-147`, `:434`). Test `test/cli.test.js:602`: the control shows the "no app usage reading yet" reason before the poller's tick, and after a real 400 reading with `x-app-usage` at 90 the gate holds the next call with its own reason, with no request made.

- **I-2 (halt set): ADDRESSED.** `HALTING` now holds AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, STATE_CORRUPT and STATE_LOST (`src/poller.js:19`). `isHalted` (`src/poller.js:131-139`) and `tick` (`src/poller.js:289-291`) return 'halted' before any request. Tests: `test/cli.test.js:637` and `:658` (zero Graph calls under each kind); `test/poller.test.js:639` and `:657`. Report section 9 item 5 (report line 177) now lists the five kinds. RATE_LIMITED stays a back-off.

- **I-3 (refuse while serve runs): NOT ADDRESSED in full.** Done: `probeServe` (`src/cli.js:165-175`) runs before the browser step in `runAuthLogin` (`src/cli.js:210`) and before the warning in `runRoutesAck` (`src/cli.js:290`). A 200 refuses with no listener opened (`test/cli.test.js:535`). A connection error or a timeout proceeds (`test/cli.test.js:558`). The routes refusal stores nothing (`test/cli.test.js:589`). Not done: the ruling is to refuse when a service answers `GET /health`. The probe reads only status 200 (`src/cli.js:175`), so a running serve that answers any other status reads as absent. It also builds an invalid URL for a bracketed IPv6 host (`src/cli.js:166`, `statusHost` at `src/cli.js:318-321`). Both are fail-open. The default configuration is covered. See N-1.

- **M-1 (serve checks the owner account): ADDRESSED, with the endpoint a live-phase item.** `verifyOwnerAccount` (`src/cli.js:151-163`) calls `client.get('me', { fields: 'id' })`, requires a string id, and refuses a mismatch with OWNER_MISMATCH. `verifyOwner` (`src/cli.js:488-490`) is awaited in `startServe` before anything listens (`src/cli.js:517`). The token is in the Authorization header only (`src/graph/client.js:190`), and the URL carries only `fields=id`. Tests: `test/cli.test.js:678` (origin, path, fields, no token in the URL, Bearer header), `:701` (mismatch, nothing listens, no token in the message), `:726` (missing id). The endpoint `GET /v26.0/me?fields=id` is not re-read in the Meta docs this round (report section 2; ledger item 3).

- **M-2 (auth facebook usage reading): ADDRESSED in substance.** The factory is `makeGraphClient` (`src/cli.js:144`), not `clientFor`, because `clientFor` lives inside `buildServe`. `runAuthFacebook` defaults to it (`src/cli.js:254`), requires onUsage, and returns `{ status, usage }` (`src/cli.js:283`). The CLI discards that return (`bin/ig.js:109`), and a one-shot command has no gate, so the reading is kept in the return value only. Test `test/cli.test.js:741`.

- **M-4 (callback written before onCallback): ADDRESSED.** `res.once('finish', ...)` is registered before `res.end` (`src/oauth.js:139-140`), so onCallback runs after the page is handed to the kernel. Test `test/oauth.test.js:133` asserts the callback is not called before 'finish' and is called after. Live check: `server.closeAllConnections()` (`src/oauth.js:160`) still runs right after the callback, so the cut-off risk is reduced, not removed on paper; confirm in the live phase.

- **M-8 (test name): ADDRESSED.** Renamed to 'the webhook handler is null when webhook.enabled is false' (`test/cli.test.js:174`). Its assertions are `webhookHandler === null` and not listening. The 404 is asserted in `test/http.test.js:154`.

- **M-9 (tests for clientFor refusal and runTokenCheck catch): ADDRESSED.** The refusal test is on `makeGraphClient` (`test/cli.test.js:765`), which is now the only place the refusal happens (`clientFor`, `src/cli.js:428-435`, reads the token and then delegates). The runTokenCheck catch is tested (`test/cli.test.js:775`) with `runTokenCheck` exported (`src/cli.js:574`). The test asserts the logged kind and that no secret text is logged.

- **M-10 (report is stale): ADDRESSED.** The report now says 725 = 710 + 15 (report line 282; 13 cli, 1 oauth, 1 poller, which I counted in the diff). The owner gap is closed (report line 175). Item 5 is corrected (line 177). The http.test.js fixture is disclosed (line 68). The 706 figure remains only as the labelled round-0 output (lines 81-90).

- **M-11 (stop still holds after login): ADDRESSED.** The line is printed on success (`src/cli.js:242`). Test `test/cli.test.js:389-390` asserts it.

---

## Socket and network check (a): PASS, with no test that opens a socket or makes a network call

Static reading. Nothing was run for this section.

- The only real `listen` call sites are `listenHttp` (`src/http.js:351-356`) and `listenForRedirect` (`src/oauth.js:172`). Neither is reached by a test without a stub.
- `test/cli.test.js`:
  - `spawnSync(node bin/ig.js --help)` (line 111). It is a process, not a socket, and it is pre-existing.
  - `runAuthLogin` has nine calls. Seven reach the probe, and each injects `probe` (lines 271, 311, 339, 369, 398, 540, 567). Two refuse before the probe (lines 295 and 300, app id and app secret). So the default `probeServe` is never reached.
  - `runRoutesAck` (lines 465, 475, 589) injects `probe`. The function throws a TypeError without it.
  - `runAuthFacebook` (lines 424, 434, 447, 744): 424 refuses at `receiveToken`, before `createClient`. The other three inject `createClient`.
  - `runStatus` (lines 490, 513) injects `fetchImpl`. `probeServe` (lines 527, 532, 538, 560, 562) injects `fetchImpl`.
  - `buildServe` calls at lines 164-235 never reach Graph, a poller tick or `startServe`. The buildServe calls with Graph reach (I-1 at 602, STATE_LOST at 637, CORRUPT at 658, M-1 at 678, 701, 726) all inject `fetchImpl` and `sleep`.
  - `startServe` is called once (line 719) with `recordingFetch` and a stub `httpServer`.
- `test/http.test.js`: the listenHttp test (lines 342-362) replaces `server.listen` with a recorder on every server, so ports 9123 and 9124 are never bound. The refusal test (364-374) checks that listenHttp refuses unbuilt servers.
- `test/oauth.test.js`: `createCallbackHandler` with a `FakeResponse` (lines 89, 133). `listenForRedirect` is never called.
- `test/poller.test.js`: `createPoller` with `getClient` stubs (lines 97, 739).
- `test/service.test.js`: `getClient` stubs (lines 169, 237).
- `test/token.test.js` (line 58), `test/endpoints-messaging.test.js` (line 303) and `test/graph-client.test.js` (line 58 and every helper): `fetchImpl` is injected.
- `test/mcp.test.js`: every `createForward` receives `fetch`. `startStdio` receives a transport (line 393).
- `test/sidecar.test.js` and `test/sidecar-python.test.js` spawn child processes (node and `python -I`). This is not a socket, and this round did not change them.
- The remaining files (audit, calendar, caps, config, endpoints-media, endpoints-social, errors, events, guard, secrets, state, tools, webhooks, fixtures) contain no listen, createServer or unscoped fetch.

Caveat on the mutation check. The earlier hang came from the old M-1 test. Under the current test, a broken owner check makes `startServe` call `httpServer.once` (`src/cli.js:521`) on the stub, which throws a TypeError before `listenHttp` is reached. No socket is opened either way. The test comment at `test/cli.test.js:714-715` says startServe reaches listenHttp, which is not accurate (N-3).

---

## New breakage

### Important

**N-1. The /health probe fails open for a running serve in two configurations (risk f; I-3 depends on it).**
- `src/cli.js:175`: `return res.status === 200 ? 'running' : 'absent';`. A running serve answers 403 when the Host header is not in `allowedHosts`: `route` checks it first (`src/http.js:296-298`), and `hostAllowed` compares `name:port` (`src/http.js:177-181`). The probe's Host is the probe URL's host and port.
  - With `http.allowedHosts` lacking `127.0.0.1` (for example `['localhost']`), the probe gets 403, reads absent, and `auth login` or `routes ack-unofficial --confirm` proceeds while serve runs.
- `src/cli.js:166` with `statusHost` (`src/cli.js:318-321`): a bracketed host such as `[::1]` is accepted by `assertServeHost` (`src/cli.js:99-106`) and by `createHttpServer` (`src/http.js:151`). `statusHost` returns `[[::1]]`, which the URL class rejects (verified: `new URL('http://[[::1]]:8788/health')` throws ERR_INVALID_URL; `new URL('http://[::1]:8788/health')` parses). The fetch throws, and the catch reads absent.
  - A bare `::1` builds a valid URL, but its Host header `[::1]:8788` is not in the default allowedHosts, so the serve answers 403, which reads absent for the same reason.
- Direction: fail-open (proceed while a service is up). The default configuration (`127.0.0.1`, allowedHosts `['127.0.0.1','localhost']`, `src/config.js:62`) is covered.
- Fix: treat any HTTP response on the port as running (any status), so 403 counts. Build the probe host without double brackets (strip, then wrap only when the host contains a colon). Add tests: a 403 answer reads running, and a `[::1]` host builds a valid URL.
- Pre-existing, same function: `ig status` uses `statusHost` (`src/cli.js:347`), so `ig status` reports "not running" for a `[::1]` host. Fix it in the same change.

### Minor

**N-2. The probe is not loopback-only for a configured non-loopback host (check e).** `src/cli.js:166` probes the configured host. With api_token set, a LAN address or a hostname is probed with a GET to that address. It sends no token and reads no body, so nothing secret leaves. Note it for the owner, or probe the loopback address instead if serve binds loopback only.

**N-3. Test comment is inaccurate.** `test/cli.test.js:714-715` says startServe reaches listenHttp when the owner check is broken. It reaches `httpServer.once` first (`src/cli.js:521`) and fails there with a TypeError. No socket is opened either way. Correct the comment.

**N-4. `recordUsage` is a public setter with no source check (risk c).** `src/service.js:513` exposes `onUsage`, which sets `latestUsage` (`src/service.js:200-202`). The gate trusts any object with a plain `app` (`src/service.js:304-308`). Current call sites (`src/cli.js:475`, `:489`) pass only Graph client readings. The HTTP and MCP dispatch is fixed: `tools.js:105` calls `service[method]` with the method from the tool definition, and `http.js:274` runs `tool.handler`. No request can reach the setter, so no untrusted reading is trusted today. Narrow the surface if it is ever reused.

---

## Risk checks (b) to (f)

- **(b) Task 11 poller tests: PASS, not weakened.** `test/poller.test.js:409`: the old 'ok' is now 'halted'; after `clearStop(true)` the tick is 'ok' and the pending count stays at 1, so the dedupe is still asserted. `test/poller.test.js:639`: the old "does not halt" is now asserted as halted with zero reads and no store, the kind still held, and a read and store after the clear. Nothing that tested the check was dropped.
- **(c) recordUsage: PASS with N-4 noted.** See N-4.
- **(d) serve /me check: PASS.** The token is in the Authorization header only (`src/graph/client.js:190`). The client error path reports only the error name (`src/graph/client.js:176`). A non-2xx response throws through the client (asserted for 400 in `test/graph-client.test.js:100`). A missing or non-string id refuses with API_ERROR (`src/cli.js:153-156`). A mismatch refuses with OWNER_MISMATCH (`src/cli.js:158-160`). The output is only "owner account confirmed" (`src/cli.js:518`). Errors print through `attempt` with redact (`bin/ig.js:46-54`). No refusal message contains a token or the id.
- **(e) /health probe: PASS with N-2.** The probe sends no headers (`src/cli.js:168`, asserted at `test/cli.test.js:533`). It is a GET on the configured host, which is loopback for the default and wildcard hosts.
- **(f) fail-open: FAIL.** The error direction is correct: any fetch error or timeout reads absent, which is the direction the ruling sets. The fail-open cases are a non-200 answer from a running serve and the IPv6 host (N-1). A running serve that takes more than 1000 ms to answer also reads absent. The ruling accepts that direction (ledger, I-3). It remains a residual, as report item 7 says.

---

## Round verdict

**Findings remaining.**
- I-3 is NOT ADDRESSED in full. The probe fails open for non-200 answers and for IPv6 hosts (N-1, Important).
- New Minor issues: N-2, N-3, N-4. Each is a comment, a documentation or design note, or a narrowing. None blocks the round.

Counts: new Critical 0, new Important 1 (N-1), new Minor 3 (N-2, N-3, N-4).
