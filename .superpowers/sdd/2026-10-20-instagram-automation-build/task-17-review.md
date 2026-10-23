# Task 17 review: setup commands, OAuth helpers and serve

Range: task-17-base to task-17-head (snapshot diff; the project is not a git repository).

Read: the brief, the global constraints, the spec's CLI and OAuth sections, the ledger (Task 17 rulings a to p and the Task 17 entries), the implementer's report, `review-task-17.diff`, and the modules serve wires (for the named risks only).

Checks made, read-only: the live `src`, `bin`, `test` and package files were compared with the task-17-head snapshot (identical). The lockfile was diffed against task-17-base and parsed. The new test files were counted and read. Nothing was edited, no suite was run, no git was used, and no subagents were spawned. One thing the reviewer could not verify is the bin-based MCP check, which is judged from the report only.

Line numbers below are for the live files. For `src/cli.js`, the diff line number minus 204 is the file line number, which puts the owner-option change at `src/cli.js:390` as the ledger says.

---

## Spec compliance

Spec verdict: **not fully met**. Ruling (k) is not met for the poller's Graph client (I-1). The startup stop is passed through, but the poller still reads under two of its kinds (I-2). Live-phase items are unverified (⚠️).

### Files, dependency and tests
- ✅ Brief files are present: `bin/ig.js`, `src/oauth.js`, `test/oauth.test.js`, `test/cli.test.js`. Accepted extras: `src/cli.js` (ledger item 5), the owner option in `src/webhooks.js` (ledger, accepted), and an owner fixture in `test/http.test.js`. The report does not list the `http.test.js` change (M-10).
- ✅ `package.json:` `"commander": "15.0.0"` (exact, no caret). The lockfile diff adds only the root dependency entry and `node_modules/commander` 15.0.0, with no nested dependencies. The lockfile parses. Commander is imported only in `bin/ig.js`. The report records `npm view commander scripts` and the `--ignore-scripts` install (report section 1).
- ✅ The brief's four tests are present and assert behaviour (`test/oauth.test.js`: buildAuthorizeUrl, parseRedirect match, AUTH_EXPIRED; `test/cli.test.js`: `ig --help`). The only process spawn is `node bin/ig.js --help`. The only listen-related assertions are `listening === false`. No test opens a socket or makes a network call. Test counts: oauth 18, cli 26, webhooks 33, http 58. Together with the four owner tests this gives 710, matching the ledger; the report's 706 is stale (M-10).

### Commands and OAuth helpers
- ✅ `buildAuthorizeUrl`: `src/oauth.js:70-89`. Five parameters only (`client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`). Scope is comma-joined; `URLSearchParams` encodes the comma as `%2C`, which parses back to a comma. No secret or token.
- ✅ `parseRedirect`: `src/oauth.js:99-116`. The state is compared first, by digest (`sameText`, constant time). A mismatch or a missing state throws `AUTH_EXPIRED` (line 109). An `error` parameter cannot bypass the state check. Tests cover match, mismatch, missing state, and error-after-state.
- ✅ `auth set`: `bin/ig.js:71-77` and `bin/ig.js:56-59` (hidden prompt on a TTY, first line of stdin otherwise). `src/cli.js:140-149` checks the name before any value is read. `src/secrets.js:120-124` refuses blank values. Only the name is printed.
- ✅ with an accepted deviation. `auth login`: `src/cli.js:152-202`. The order is: `app.id` and `app_secret` checks (152-168); the authorize URL; loopback listen on `127.0.0.1:8790` (`REDIRECT_PORT`); `parseRedirect`; short-lived exchange (178); owner check (179-181); long-lived step (183), which refuses by design (`src/oauth.js:243-246`, owner decision 1). Nothing is stored before every step succeeds. The token record `{obtainedAt, expiresAt, scopes}` follows ruling (p) (192-196). ⚠️ The authorize host, the loopback redirect URI, and the form encoding need the live phase (report section 9, item 4).
- ✅ with an accepted deviation. `auth facebook`: refuses before any browser step (`src/oauth.js:249-254`, ledger item 2). The Page-link check exists and is tested (`src/cli.js:205-232`). Nothing is stored unless the Page check passes.
- ✅ `serve` (`src/cli.js:335-452` and `454-520`):
  - Refuses a non-loopback host without `api_token`: `assertServeHost` (`src/cli.js:96-103`) runs first in `buildServe`, before any file is touched.
  - The webhook handler is built only when `webhook.enabled` (386-399), with the owner id (390), the audit log and the shared clock.
  - `guard.assertOwner` runs once (350).
  - The poller gets audit (431) and starts with `poller.start()` (476), after the stop report (456-457). See I-2 for the halt scope.
  - The HTTP server is built with `createHttpServer` (411-419), with host, port and `allowedHosts`, and started only with `listenHttp` (466).
  - Token checks are hourly, `TOKEN_CHECK_MS = 3600000` (479-482). The check is wrapped in try/catch and logs the error kind through redact (511-520).
  - The bound addresses are printed.
- ✅ `mcp`: `bin/ig.js:127-134` to `src/cli.js:324-331` to `src/mcp.js:177-183` (`startStdio`). The mcp path writes nothing to stdout. The only stdout writers are `say` (`bin/ig.js:30`) and `log` (`src/cli.js:56`), both used by human-facing commands. `src/mcp.js:9` states the rule. ⚠️ The bin-based protocol check is judged from report section 6 only. The transcript is not in the package, and the check makes no tool call, so the forward path and the bearer header are not exercised.
- ✅ `status`: `src/cli.js:286-321`. The bearer token goes in the Authorization header only; the URL has none (292). The output is the `ig_status` result through redact, or a local summary with a notice that holds no token (`localSummary`, 473-486). Tests cover the not-running and running branches.
- ✅ `routes ack-unofficial` (ruling d): `bin/ig.js:148-160`, `src/cli.js:235-251`. Without `--confirm`, the warning is printed and nothing is stored (tested). The acknowledgement is read only from state (`applyAcknowledgement`, `src/cli.js:86-94`). A `true` in the config file is ignored and reported (`bin/ig.js:119-121`). The default in `src/config.js:54` is off.
- ✅ dataDir (ruling c): `src/cli.js:61-63`, with `PROJECT_ROOT` at line 40. Tested.
- ❌ Ruling (k): every Graph client in serve goes through `getClient` with `onUsage`. The poller's client is built by calling `clientFor` directly (`src/cli.js:422-424`), and its `onUsage` is a no-op until the service has called `getClient` once (`src/cli.js:371-383`). See I-1. `auth facebook` also builds a client directly, with a no-op `onUsage` (`src/cli.js:217`). See M-2.
- ✅ Ruling (k), `guard.assertOwner` called once at startup: `src/cli.js:350`. The letter is met, but the check compares the config owner with itself (M-1).
- ✅ Ruling (f): a corrupt state file starts the guard STOPPED with STATE_CORRUPT (`src/state.js:101-120`). `startServe` reports it (`src/cli.js:456-457`). Only `ig_stop_clear` clears it.
- ✅ Ruling (g): a damaged stop refuses the start (`src/guard.js:87-106`). `buildServe` does not catch it (`src/cli.js:349`).
- ✅ Ruling (h): tokens are registered on receipt (`src/oauth.js:236` via `exchangeShortLived`; `src/cli.js:187`). `scheduleTokenChecks` refuses a timer above the cap (`src/token.js:102`). The refresh expiry is 60 days (`src/service.js:44`). The refresh is not held by a stop (M-3).
- ✅ Ruling (i): the owner id is passed (`src/cli.js:390`). The webhook path returns 404 when no handler is built (`src/http.js:305`, tested at `test/http.test.js:154`). The owner skip runs before storage and dedupe, is counted and audited (`src/webhooks.js:237-247`, counted at 232 and reported at 279).
- ⚠️/❌ Ruling (j): the audit is passed to the poller (`src/cli.js:431`). The poller halts only for AUTH_EXPIRED, CHECKPOINT and ACTION_BLOCKED (`src/poller.js:17`, `131-139`, `291`). It does not halt for STATE_CORRUPT or STATE_LOST. See I-2.
- ✅ Ruling (l): `src/cli.js:411-419` and `466`. `listenHttp` refuses any server it did not build (`src/http.js:351-355`). A non-loopback host with an empty token is refused in `src/http.js:153-155`.
- ✅ Ruling (n): `src/cli.js:491-497`, a try/catch around each adapter `close`. Not tested (M-9).
- ✅ Ruling (o): see the mcp item above.
- ✅ Ruling (p): the token record shape is `src/cli.js:192-196`.
- ✅ Ruling (b): the user id is read from the raw text and a bare number is refused (`src/oauth.js:177-190`, called before `JSON.parse` at line 224). Tested.
- ✅ Ruling (a): `app.id` from config and `app_secret` from secrets, both checked before anything else (`src/cli.js:152-168`). Tested.
- ✅ Ruling (m): not applicable here; no sidecar login command exists.

### Secrets and stop rules
- ✅ No token in a URL. The authorize URL (`src/oauth.js:70-89`) has none. The short-lived exchange sends the code and the app secret in a form body (`src/oauth.js:213`). The Graph client sends the token only in the Authorization header (`src/graph/client.js:190`) and refuses a token in a query or form field (`src/graph/client.js:58`). The status URL has no token (`src/cli.js:292`).
- ✅ No token in an error, a log or an audit line. `IgError` redacts its message (`src/errors.js:27-34`). Error texts carry the kind, the status or the error name only (`src/oauth.js:215-227`, `src/cli.js:199`). Audit records carry no token (`src/cli.js:202`).
- ✅ Tokens and the app secret are registered before use: `src/oauth.js:51-60` (`registerToken`); `src/secrets.js:89` and `103` (`register`).
- ✅ The app secret leaves the machine only in the token exchange: `INSTAGRAM_TOKEN_URL` is an https origin (`src/oauth.js:19`), and the request refuses redirects (`redirect: 'error'`, `src/oauth.js:214`) and has a timeout.
- ✅ Unofficial routes are off by default (`src/config.js:54`). The acknowledgement is stored in state (ruling d).
- ✅ Logs for mcp go to stderr (`src/mcp.js:9`).
- ✅ Node engines are unchanged; the stop state is read through the guard.
- ⚠️ The global constraint names `https://graph.instagram.com` as the Instagram Login base. The short-lived exchange uses `https://api.instagram.com/oauth/access_token`, which is the endpoint Meta documents (report section 2). This is a live check.
- ⚠️ Comma-joined scope: the live login confirms the separator (global constraints).

---

## Strengths

- The two steps that would break a named rule are refused by design, with nothing stored: the long-lived exchange (query-string token) and the Facebook token (fragment). Tests cover both paths.
- The redirect check compares the state before anything else, by digest, and an error parameter cannot skip it.
- The user id is read from the raw text, so a bare JSON number is refused rather than silently rounded (ruling b).
- The token exchange uses a POST body, refuses redirects, has a timeout, and reports only the status on failure.
- The owner check runs before the long-lived step, and the token is written only after every step has succeeded.
- `buildServe` checks the host before creating any file. `createHttpServer` refuses a non-loopback host without a token, and `listenHttp` will not listen on a server it did not build.
- An empty API token never matches (`src/http.js:213-214`).
- The webhook owner skip runs before storage and dedupe, is counted and audited. A numeric sender id cannot reach the comparison, because `idOf` accepts only text (`src/webhooks.js:28-30`).
- A damaged stop refuses the start (`src/guard.js:87-106`). A corrupt state file starts stopped (`src/state.js:101-120`).
- The acknowledgement comes only from state, and a config value is reported and ignored.
- The mcp path keeps stdout to protocol frames. The lockfile change is minimal and the pin is exact.
- The tests assert behaviour, use fakes for the keyring, fetch and listen, and check that no secret appears in output.

---

## Issues

### Critical

None.

### Important

**I-1. The poller's usage readings are discarded until the first service client call (ruling k; usage throttle).**
- `src/cli.js:371-383` (`relay`, `clientFor`, `getClient`); `src/cli.js:422-424` (poller client); `src/service.js:199-203` (the service's `latestUsage` holder and its `onUsage`).
- `relay.service` stays `null` until the service calls `getClient` (`service.js:203`). The service calls it only on a tool call or a token refresh. Until then the poller's `onUsage` (`cli.js:423`) drops every reading. The usage gate therefore cannot see poller-driven load, which on an idle `serve` is most of the Graph traffic.
- The poller's client is also not built through `getClient`, which ruling (k) names. Report section 9, item 6 calls this a small gap. The usage throttle is a global rule, so the gap is not small.
- Fix: create the service first, expose its `onUsage` to buildServe, and give the poller the same callback at build time, so no reading is dropped. Add a test that a poller reading reaches the usage gate before any tool call.

**I-2. The poller halt set does not include STATE_CORRUPT or STATE_LOST, and the report says it does (rulings f and j).**
- `src/poller.js:17` (`HALTING` holds only AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED); `src/poller.js:131-139` (`isHalted`); `src/poller.js:289-291` (`tick`). The guard's only check is `stopStatus` at line 132; `assertNotStopped` is never called.
- The guard can hold STATE_CORRUPT and STATE_LOST from startup (`src/state.js:101-120`; `src/guard.js:163-167`). With either held, the poller keeps reading Graph and storing events.
- Report section 9, item 5 says "The poller makes no request while halted (its own guard check)". That is true only for the three halting kinds.
- The global constraint names outbound actions, so reads may be allowed. That is a ruling the owner has not made.
- Fix: either add STATE_CORRUPT and STATE_LOST to `HALTING` in `src/poller.js` (one set and a test), or get the owner's ruling that reads continue under those kinds. Correct report section 9, item 5 either way. Leave RATE_LIMITED as a back-off.

**I-3. Two processes write the whole state file; a stop can be erased on disk (latent until owner decision 1).**
- `src/state.js:142-150` (`save` writes the whole in-memory image); `src/guard.js:143-150` (`persist`). Each process holds its own image loaded at start.
- `auth login` loads at `bin/ig.js:79-98` and saves at `src/cli.js:197`, after the browser step, which can take minutes. `routes ack-unofficial` loads and saves at `src/cli.js:241-246`, in a window of milliseconds.
- If `serve` saves a stop between a CLI's load and its save, the CLI save writes an image without that stop. The stop is then gone from disk, while serve still holds it in memory. After a restart, outbound actions resume. Serve's next save would also erase a token record that `auth login` wrote.
- `auth login` currently refuses at the long-lived step before it saves, so this path becomes live only when owner decision 1 is taken. Report section 9, item 7 defers the one-owning-process rule to the README. The code does not enforce it.
- Fix before owner decision 1: `auth login` and `routes ack-unofficial` refuse with a clear message when a service answers `GET /health` on the configured host and port. Alternatively, re-read the file and merge only the key they own immediately before the save. Document the choice in the README either way.

### Minor

**M-1. The startup owner check compares the config owner with itself.** `src/cli.js:350` calls `guard.assertOwner(effective.owner.igUserId)`, and `src/guard.js:175-179` compares it with the same value. The check meets the letter of ruling (k) and M-13 but adds nothing that `createGuard` does not already refuse. If M-13 meant a live check of the token's account, that needs a read call and an owner ruling.

**M-2. `auth facebook` builds a Graph client directly, with a no-op usage callback.** `src/cli.js:217` passes `onUsage: () => {}` and bypasses `clientFor`. This is unreachable in practice, because the token step refuses first (`src/oauth.js:249-254`). When that step is approved, route this client through a usage-aware path.

**M-3. The hourly token refresh is not held by a stop.** `src/service.js:552-580` (`tokenRefresh` has no guard call) is reached from `src/cli.js:479-482` and `511-520` whenever `canRefresh` is true. It makes at most one refresh call per 24 hours. The stop rule names outbound actions, and the spec does not say whether a refresh counts. Ask the owner. If it should be held, skip the refresh while `guard.stopStatus().stopped` is true.

**M-4. The callback page may be cut off.** `src/oauth.js:137-138` writes the page and then calls `onCallback`. `finish` (`src/oauth.js:152-160`) calls `server.closeAllConnections()` right after `res.end`. Destroying sockets can drop bytes not yet flushed, so the browser may show a reset. ⚠️ Live check. Fix: finish on the response's `finish` event, or drop `closeAllConnections` from the success path.

**M-5. Any request to `/callback` ends the login, whatever its state.** `src/oauth.js:120-141` and `163`. `parseRedirect` then fails with AUTH_EXPIRED. This is fail-closed, but a local page or process can abort a login. Accepted as report item 11; recorded here.

**M-6. The server's error listener is removed once listening.** `src/cli.js:461-463`. After `listening`, a later server `error` event has no listener and would crash serve. Fix: keep a permanent handler that logs `err.code` through redact.

**M-7. `auth set` stores `owner_token` and `facebook_token` without the owner-account check.** `src/cli.js:140-149`. `auth login` checks the account (`src/cli.js:179`); the set path does not. The brief allows these names, so this is the owner's choice. A token for another account would be stored and used until Graph rejects it. Fix: for `owner_token`, read the account and compare it with `owner.igUserId` before storing, or refuse `owner_token` in `auth set` and point to `auth login`.

**M-8. A test name overclaims.** `test/cli.test.js:156`, "the webhook path is absent when webhook.enabled is false", checks only `webhookHandler === null`. The 404 is tested at `test/http.test.js:154`. Rename the test, or assert the route.

**M-9. Several rulings have no test.** Untested: the `clientFor` refusal (`src/cli.js:372-377`, ruling k), `runTokenCheck`'s catch (`src/cli.js:511-520`), the shutdown path with adapter close (`src/cli.js:491-497`, ruling n), and `startServe`. The report marks these read-checked. Accept for this task, but I-1 needs a test.

**M-10. The report is stale.** It says 706 tests; the final count is 710 (ledger line 377). It says the owner gap is open and that `src/webhooks.js` is unchanged (section 3, section 7 row (i), section 9 item 3); the ledger records the fix. It does not list the `test/http.test.js` fixture change. Section 9, item 5 is inaccurate (I-2). Update the report before the owner reads it.

**M-11. A successful `auth login` does not say that a stop from before the login still holds.** `src/cli.js:199-200`. Per the spec, the stop remains until `ig_stop_clear`. Latent until owner decision 1. Add that line to the output.

---

## Assessment

**Task quality: Needs fixes.** There are no Critical issues, and the core safety rules hold: secrets stay out of URLs, logs and errors; the state check and the long-lived refusal work; the webhook owner skip and the loopback bind are correct. Three Important issues remain. The poller's usage readings are dropped until the first tool call (ruling k). The poller keeps reading under two startup stop kinds, which the report misstates. The two state writers can erase a stop on disk once `auth login` completes. The fixes are small.
