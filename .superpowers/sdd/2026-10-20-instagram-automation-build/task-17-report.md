# Task 17 report: setup commands, OAuth helpers and serve

Status: DONE_WITH_CONCERNS. The long-lived token exchange and the Facebook Login token step are refused by design, as the coordinator ruled. Live-phase items and one ruling gap (the webhook owner id) are listed in the open items.

## 1. Commander

`npm view commander version`:

```
15.0.0
```

`npm view commander scripts` (recorded before the install; the scripts are commander's own dev tooling and were not run, because the install used `--ignore-scripts`):

```
{
  fix: 'npm run fix:lint && npm run fix:format',
  test: 'node --test && npm run check:type:ts',
  check: 'npm run check:type && npm run check:lint && npm run check:format',
  'fix:lint': 'eslint --fix .',
  'test-all': 'node --test && npm run check',
  'check:lint': 'eslint .',
  'check:type': 'npm run check:type:js && npm run check:type:ts',
  'fix:format': 'prettier --write .',
  'check:format': 'prettier --check .',
  'check:type:js': 'tsc -p tsconfig.js.json',
  'check:type:ts': 'tsd && tsc -p tsconfig.ts.json'
}
```

Install, run from `D:\Projects2\InstagramApi`:

```
npm install --ignore-scripts --save-exact commander@15.0.0
added 1 package, and audited 7 packages in 1s
found 0 vulnerabilities
```

`package.json` now pins `"commander": "15.0.0"` (exact). `package-lock.json` gained the commander entry. The other dependencies are unchanged.

## 2. Endpoints

Confirmed in the Meta docs (read through Context7, library `/llmstxt/developers_facebook_instagram-platform_llms_txt`, and one WebFetch):

| Step | URL and method | Status |
|---|---|---|
| Instagram Login authorize | `https://www.instagram.com/oauth/authorize` (Business Login guide, endpoint list) | Used. The reference page `https://developers.facebook.com/documentation/instagram-platform/reference/oauth-authorize` shows `https://api.instagram.com/oauth/authorize`. Live check which host applies. |
| Short-lived token | `POST https://api.instagram.com/oauth/access_token`, form body (client_id, client_secret, grant_type, redirect_uri, code) | Used, body only. The docs' curl uses multipart `-F`; this build sends `application/x-www-form-urlencoded`. Live check. |
| Long-lived token | `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=...` | NOT used. The token is in the query string, which the no-token-in-URL rule forbids. `longLivedExchange` refuses with CONFIG. Owner decision needed. |
| Refresh | `https://graph.instagram.com/refresh_access_token` (endpoint list) | Not changed here; the existing token.js and service refresh path call it. |
| Owner check at serve start (fix round 1) | `GET https://graph.instagram.com/v26.0/me?fields=id`, with the owner token in the Authorization Bearer header only. The client adds the configured version prefix. | Used by `verifyOwnerAccount`. The docs for this exact call were not re-read in fix round 1; live check. |
| Facebook Login for Business dialog | `https://www.facebook.com/dialog/oauth` with `response_type=token` | NOT used. The docs state the token arrives in the redirect fragment. The step refuses with CONFIG before any browser step. No Facebook code exchange is documented. |
| Linked Page | `GET https://graph.facebook.com/v26.0/me/accounts?fields=id,name,instagram_business_account` (docs examples at v25.0 and v26.0) | Implemented as `pageLinkFromAccounts` and used by `runAuthFacebook` behind the refused token step, so it is not reached in production yet. The project's Graph client sends the token as a Bearer header, while the docs show a query parameter. Live check. |

Scopes: `instagram_business_basic, instagram_business_manage_messages, instagram_business_manage_comments, instagram_business_content_publish`, the set in the Business Login example. Scope is comma-joined; the docs accept comma-separated lists.

Redirect URI: `http://127.0.0.1:8790/callback`. It must be registered in the Meta app exactly. Whether Meta accepts an http loopback URI is a live check.

## 3. Files changed

- `bin/ig.js`: new. Commander entry: `auth set|login|facebook`, `serve`, `mcp`, `status`, `routes ack-unofficial --confirm`, and the global `--config`.
- `src/oauth.js`: new. `buildAuthorizeUrl`, `parseRedirect`, `randomState`, `createCallbackHandler`, `listenForRedirect` (loopback, not tested with a real listen), `parseUserIdFromRaw`, `exchangeShortLived`, `longLivedExchange` (refuses), `facebookTokenFromRedirect` (refuses), `pageLinkFromAccounts`, `registerToken`.
- `src/cli.js`: new. Deviation: the brief lists two source files. The command logic lives here so the tests can call it with fakes, the same way `src/graph/endpoints/common.js` was added in Task 6. It holds `resolveDataDir`, `resolveConfigFile`, `applyAcknowledgement`, `assertServeHost`, `readPipedValue`, `readHiddenValue`, `runAuthSet`, `runAuthLogin`, `runAuthFacebook`, `runRoutesAck`, `runStatus`, `runMcp`, `buildServe`, `startServe`.
- `test/oauth.test.js`: new, 18 tests.
- `test/cli.test.js`: new, 26 tests.
- `package.json`, `package-lock.json`: commander added and pinned. The `test` script is unchanged (`node --test test/*.test.js`), per R9.
- Changed in fix round 1 (section 11): `src/service.js`, `src/poller.js`, `src/oauth.js`, `src/cli.js`, `bin/ig.js`, `test/cli.test.js`, `test/oauth.test.js`, `test/poller.test.js`.
- Changed by another task, not by this one: the owner option of `createWebhookHandler` in `src/webhooks.js` and a fixture in `test/http.test.js` (the Task 10 owner fix, ledger line 377).
- Not changed: every other `src/` and `test/` file, `scripts/mcp-spike.mjs`, `sidecar/`, the ledger and the brief.
- Scratch files, outside the project: `scratchpad\task17-mcp-check.mjs`, `scratchpad\task17-config.json`, and the npm test logs.

## 4. TDD evidence

RED: the two new test files were written first. `node --test test/oauth.test.js test/cli.test.js` failed at load, because `src/oauth.js` and `src/cli.js` did not exist (`ERR_MODULE_NOT_FOUND`). Both files failed before any test ran, so the RED state is at module-load level, not per test.

GREEN, first run: `test/oauth.test.js` 18/18 and `test/cli.test.js` 24/24, after the implementation. After two more tests were added (the corrupt state file, and an unreadable stop time): `test/cli.test.js` 26/26. Total new: 44.

Full suite, `npm test` (log at `scratchpad\npm-test-2.txt`):

```
ℹ tests 706
ℹ suites 0
ℹ pass 706
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

The 662 before this task plus 44 new gives 706 (round 0). The Task 10 owner fix added four tests (710). Fix round 1 added fifteen, for 725; see section 11. The output has no warning lines. Exit code 0.

No test made a network call or opened a socket. The `ig --help` test spawns `node bin/ig.js --help`, which is local. The redirect server, `buildServe`'s listener and `startServe` are not run in tests. `buildServe` builds the HTTP server without listening, and the tests check `listening === false`.

## 5. `node bin/ig.js --help`

```
Usage: ig [options] [command]

Owner-only Instagram automation: setup commands, the service, the MCP client and
status.

Options:
  --config <file>  config file (default: IG_CONFIG, then config.json in the
                   project root)
  -h, --help       display help for command

Commands:
  auth             store secrets, and log in to Instagram or Facebook
  serve            run the HTTP API on the configured host and port, the poller
                   and the hourly token checks
  mcp              serve the MCP tools over stdio, forwarding each call to ig
                   serve; logs go to stderr
  status           print ig_status from the running service, or a local summary
                   when it is not running
  routes           settings for the unofficial routes
  help [command]   display help for command
```

## 6. Bin-based MCP check (ruling e)

Script: `scratchpad\task17-mcp-check.mjs`. It spawns `node bin/ig.js --config scratchpad\task17-config.json mcp` with `IG_OWNER_TOKEN` and `IG_API_TOKEN` set to fake values, twice. The first child sends initialize (protocolVersion 2025-11-25), `notifications/initialized` and `tools/list`. The second sends `server/discover` and `tools/list`. One child per protocol era, as in the Task 16 ruling. No tool call is made, so nothing is forwarded and no socket is opened.

```
--- 2025 handshake (initialize 2025-11-25, tools/list)
stdout protocol frames: 2; non-protocol stdout lines: 0
exit code: 0; stderr: (empty)
--- 2026-07-28 revision (server/discover, tools/list)
stdout protocol frames: 2; non-protocol stdout lines: 0
exit code: 0; stderr: (empty)
--- summary
initialize (2025-11-25) negotiated: 2025-11-25
tools/list after initialize: 36
server/discover supportedVersions: 2026-07-28
tools/list after server/discover: 36
PASS: initialize answered with 2025-11-25
PASS: 2026-07-28 advertised by server/discover
PASS: tool lists answered (both runs)
PASS: stdout holds only protocol frames (both runs)
PASS: both children exited cleanly
```

The check is run again in Task 18.

## 7. Ruling table

| Ruling | Code | Test |
|---|---|---|
| (a) R7: app id from IG_APP_ID (config `app.id`); app secret is `app_secret` (IG_APP_SECRET or keyring); login refuses without both | `src/cli.js` `runAuthLogin` (app.id and `secrets.get('app_secret')` checks); `src/secrets.js` `envName` | `auth login refuses without app.id, and without app_secret` |
| (b) user_id read from raw text, a number refused | `src/oauth.js` `parseUserIdFromRaw`, called by `exchangeShortLived` | `parseUserIdFromRaw reads a string user_id...`; `...refuses a user_id that is a bare JSON number`; `exchangeShortLived refuses a user_id that is a number...` |
| (c) dataDir resolved against the project root | `src/cli.js` `resolveDataDir` (root = `PROJECT_ROOT`, from `import.meta.url`) | `dataDir resolves against the project root, not the working directory` |
| (d) `ig routes ack-unofficial --confirm` is the only way to set the acknowledgement; it is stored in state; serve reads it from state, not config | `src/cli.js` `runRoutesAck`, `applyAcknowledgement` (used in `buildServe` and `runStatus`); `bin/ig.js` `routes ack-unofficial` | `routes ack-unofficial without --confirm prints the warning and stores nothing`; `routes ack-unofficial --confirm stores...`; `the unofficial acknowledgement is read from the state, not from the config file` |
| (e) bin-based MCP check, run in this task and again in Task 18 | `bin/ig.js` `mcp` to `src/cli.js` `runMcp` to `src/mcp.js` `startStdio` | The check in section 6 (manual, not a unit test) |
| (f) corrupt state file starts the guard STOPPED with STATE_CORRUPT; serve passes it through; only ig_stop_clear clears it | `src/state.js` (Task 3) and `src/guard.js` (Task 4), reached by `buildServe`; `startServe` reports the stop | `a corrupt state file starts the guard stopped with STATE_CORRUPT...` |
| (g) a stop time that cannot be read back refuses a restart | `src/guard.js` `readRecord` throws CONFIG at construction; `buildServe` does not catch it | `a stop whose time cannot be read back refuses the start...` |
| (h) serve token check: try/catch, log through redact (kind only); refreshed token expiry 60 days out; exchange tokens registered on receipt; hourly interval | `src/cli.js` `runTokenCheck`, `startServe` (`scheduleTokenChecks`, 3600000 ms); `registerToken` in `src/oauth.js`; the 60-day expiry is in `src/service.js` `tokenRefresh` (Task 13) | Not tested here. Covered by the Task 9 and Task 13 tests. The interval and the catch are read-only checks. |
| (i) webhook handler built with the owner id, audit and clock; mounted only when enabled; path 404 otherwise | `src/cli.js` `buildServe` (`webhookHandler` is null unless `webhook.enabled`; the owner id is passed at `src/cli.js:442`, to the owner option added by the Task 10 owner fix at `src/webhooks.js:195`) | `the webhook handler is null when webhook.enabled is false`; `the webhook handler is built only when webhook.enabled is true...`. The owner gap is closed (fix round 1, item 3 of section 9). |
| (j) serve passes audit to the poller; checks the stop state; starts the poller with start(); guard.assertOwner called once at startup | `src/cli.js` `buildServe` (`createPoller`, `guard.assertOwner`), `startServe` (stop report, `poller.start()`) | Covered by `buildServe wires the modules without starting the poller or a listener`. The start path is not run in tests. |
| (k) every Graph client through getClient with onUsage; a client without onUsage is refused | `src/cli.js` `clientFor` (refuses without onUsage); the service and the poller both use it | Not tested directly (the function is private). Read-checked. |
| (l) serve uses createHttpServer and listenHttp only; passes port with host and allowedHosts; refuses a non-loopback host without api_token | `src/cli.js` `assertServeHost`, `buildServe` (`createHttpServer`), `startServe` (`listenHttp`) | `serve refuses a non-loopback host without api_token`; `...before it builds anything` |
| (m) session settings from login and restore_session go to the keyring | No caller in this task. No command logs in to the unofficial sidecar. The adapter registers them on receipt (Task 12). | Not applicable here. A future unofficial login command must store them. |
| (n) jslib close() rejection caught at shutdown | `src/cli.js` `startServe` `shutdown` (try/catch around each `adapter.close`) | Not tested (shutdown is not run in tests). Read-checked. |
| (o) `ig mcp` through startStdio; logs to stderr only | `src/cli.js` `runMcp`; `bin/ig.js` `mcp` | The check in section 6 (stdout holds only protocol frames) |
| (p) token record in state: `{ obtainedAt, expiresAt, scopes }`; the owner token in the keyring | `src/cli.js` `runAuthLogin` (`state.set('token', ...)`, `secrets.set('owner_token', ...)`) | `auth login stores the owner token and the token record on success` |

## 8. Gap decisions (coordinator)

- Long-lived exchange: `longLivedExchange` is injectable. Its default throws `CONFIG 'the long-lived token exchange is not yet approved; see the Task 17 ledger item'`. The tests inject a fake. Nothing is stored when the long-lived step fails (`auth login stops at the long-lived exchange and stores nothing`).
- `auth login` order: authorize URL, loopback redirect (`parseRedirect` with the state check), short-lived exchange (code in the body), owner check, then the long-lived step.
- `auth facebook`: refuses before any browser step, because the documented token comes in the URL fragment. The Page-link check is implemented and tested with a fake client. Nothing is stored unless the Page is linked to the owner account.

## 9. Open items

1. Owner decision: how the long-lived exchange should carry the token (the documented query form breaks the no-token-in-URL rule). Until then `ig auth login` stops after the short-lived exchange, with CONFIG, and stores nothing.
2. Owner decision: the Facebook Login for Business token arrives in the redirect fragment. `ig auth facebook` refuses until the owner rules.
3. Webhook owner id: CLOSED (fix round 1). `createWebhookHandler` takes `owner` (`src/webhooks.js:195`, added by the Task 10 owner fix), and `buildServe` passes `effective.owner.igUserId` (`src/cli.js:442`). An event from the owner's own account is skipped before storage, and the skip is counted and audited.
4. Live checks: the authorize host (`www.instagram.com` or `api.instagram.com`); the redirect URI accepted for `http://127.0.0.1:8790/callback`; the form encoding of the short-lived exchange; the Facebook Page call with a Bearer header.
5. Poller halts (corrected in fix round 1, item I-2). The poller halts under AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, STATE_CORRUPT and STATE_LOST (`src/poller.js:19`), and makes no request while one of them holds. RATE_LIMITED is a back-off and does not halt it. `startServe` reports the stop state and then starts the poller; the poller's own guard check holds its reads. The owner needs `ig_stop_clear` with confirm to resume reads after a STATE_CORRUPT or a STATE_LOST stop, as after the other halting kinds.
6. Usage relay: CLOSED (fix round 1, item I-1). `buildServe` creates the service first, and the poller's client is `getClient('instagram', { onUsage: service.recordUsage })`, where `service.recordUsage` is the service's own usage callback (`src/service.js:513`). Every poller reading reaches the usage gate at once, before any tool call.
7. Two writers of `state.json` (partly closed, fix round 1, item I-3). `ig auth login` and `ig routes ack-unofficial` now refuse while a service answers `GET /health` on the configured host and port (`probeServe`, `src/cli.js:166`). Any HTTP answer, whatever its status, means a service is running (corrected in fix round 2, section 12). Only a connection error or a timeout (1000 ms) means no service, and the command goes on. The probe is a check, not a lock: a service started after it is not seen. `ig auth facebook` writes no state. The one-owning-process rule (Task 3 M-8) still goes in the README (Task 18).
8. Not exercised by tests: `readHiddenValue` (a terminal), `listenForRedirect` (a real listen), and the listen, poller start and signal shutdown inside `startServe`. The owner check that `startServe` runs first is tested through `verifyOwner`, and its refusal is tested with a stub server, so no listen is reached (section 11). A manual `ig serve` run would open a socket, so it was not run.
9. Node 22.12 is not run (carry-forward to Task 18).
10. `ig status` reads the bearer token from the keyring when IG_API_TOKEN is not set. If the keyring is unavailable, status fails with CONFIG before it prints the local summary. Minor.
11. The redirect server takes any request to `/callback` as the callback, so a local request with the wrong state fails the login (fail closed). Minor and local only.

## 10. Self-review

I read my own diff against the brief, the rulings and the constraints.

- No token in a URL: the authorize URL carries five parameters and nothing else (checked by a test). The short-lived exchange sends the code and the app secret in the body (checked by a test). `status` sends the token as a Bearer header.
- No token in an output: `runStatus` prints only the `ig_status` result or the local summary, neither of which reads a token. A test checks that the bearer value is absent from both branches. The tokens are registered with `registerToken` or `secrets.get` before use.
- Stop state: `buildServe` does not catch the guard's CONFIG error, so an unreadable stop refuses the start.
- Listeners: `listenHttp` is the only call that starts the API. The `server.listen` in `src/oauth.js` is the one-shot loopback redirect used by `auth login`.
- Unused imports: a script lists each import of the five new files and counts its uses. None is unused. The script was checked against a planted unused import, which it caught.
- Fixed during the review: two path assertions that would fail on Windows (`join` against `resolve`); a test name that overclaimed (`buildServe checks the stop state`), renamed; a gap in coverage (ruling f and g), now tested.
- Stdout: `ig mcp` writes nothing to stdout except the protocol (the check confirms this). The `log` helper is not used by `runMcp`.
- The `test` script is unchanged. `npm test` is green at 730 of 730 after fix round 2 (sections 11 and 12).

## 11. Fix round 1 (full task review, task-17-review.md)

Each item of the coordinator's round, with its change and its place in the live files.

| Item | Change | Where (live file and line) |
|---|---|---|
| I-1 usage reading | `createService` returns `recordUsage`, the service's own usage callback. `buildServe` drops its relay. The poller's client is `getClient('instagram', { onUsage: service.recordUsage })`. | `src/service.js:513`; `src/cli.js:436` (getClient), `:475` (poller) |
| I-2 halt | `HALTING` adds `STATE_CORRUPT` and `STATE_LOST`. RATE_LIMITED stays a back-off. | `src/poller.js:19` (comment at :17-18) |
| I-3 refuse while serve runs | `probeServe`: GET /health on the configured host and port, 1000 ms; any HTTP answer means running, and only a refusal or a timeout means absent (the 200-only rule of fix round 1 is corrected in fix round 2, section 12). `runAuthLogin` probes before the browser step. `runRoutesAck` is async and probes first. `bin/ig.js` passes the probe. The message is `SERVE_RUNNING_MESSAGE`. | `src/cli.js:50` (message), `:165` (probeServe), `:203` and `:210` (runAuthLogin), `:288-290` (runRoutesAck); `bin/ig.js:18`, `:157-161` |
| M-1 owner check | `verifyOwnerAccount` does `client.get('me', { fields: 'id' })` through the client path, with the owner token in the Bearer header only, and compares the id. A mismatch refuses with OWNER_MISMATCH; a missing id refuses with API_ERROR. `buildServe` returns `verifyOwner`, and `startServe` runs it before anything listens. | `src/cli.js:151` (verifyOwnerAccount), `:488-490` (verifyOwner), `:517` (startServe) |
| M-2 facebook client | `makeGraphClient` is one module-level factory that refuses a client without onUsage. `clientFor` and `runAuthFacebook` both use it. `runAuthFacebook` passes a recording onUsage and returns `{ status, usage }`. | `src/cli.js:144` (makeGraphClient), `:254` (createClient default), `:283` (return) |
| M-4 callback page | The callback is registered with `res.once('finish')` before `res.end`, so onCallback runs after the page is written. | `src/oauth.js:139` |
| M-8 test name | Renamed. Assertions unchanged. | `test/cli.test.js:174` |
| M-9 | `runTokenCheck` is exported so its catch can be tested. New tests for the onUsage refusal and the catch. | `src/cli.js:574`; tests below |
| M-10 | Sections 3, 4, 7, 9 and 10 corrected (test counts, the owner gap, the halt set, the usage relay). | this report |
| M-11 | The auth login output says that a stop from before the login still holds. | `src/cli.js:242` |

Other edits that support these: `buildServe` takes `fetchImpl` and `sleep` (`src/cli.js:397-398`), so the tests inject them. The defaults are the real ones. The owner check now runs first in `startServe`, so a serve start needs a valid owner token and a reachable Graph. That is a behaviour change: before this round, `ig serve` started without an owner token and refused per call.

### Changed tests: old and new assertion

- `test/poller.test.js` 'a lost state does not store a message twice' (Task 11). Old: `assert.equal((await second.poller.tick()).status, 'ok');`. New: `'halted'`; after `second.guard.clearStop(true)` the tick returns `'ok'` and still one stored event. Reason: STATE_LOST halts (I-2).
- `test/poller.test.js` 'a stored STATE_LOST stop does not halt reads', renamed 'a stored STATE_LOST stop halts reads until it is cleared'. Old: tick status 'ok' and the message stored. New: tick status 'halted', no request (the read count is unchanged), no event stored, the stop kind still STATE_LOST; after `clearStop(true)` the tick is 'ok' and the message is stored.
- `test/oauth.test.js` 'the callback handler answers 404 off the callback path and passes the callback URL on'. Old: `assert.equal(seen.length, 1);` straight after the handler call. New: `ok.emit('finish');` before the same assertion. The `FakeResponse` helper is now an EventEmitter; its `end` records the body and does not emit 'finish' by itself.
- `test/cli.test.js` 'the webhook path is absent when webhook.enabled is false', renamed 'the webhook handler is null when webhook.enabled is false' (M-8). Assertions unchanged.
- `test/cli.test.js` the two routes tests. Old: `const result = runRoutesAck({...});` (synchronous). New: `const result = await runRoutesAck({..., probe: absentService});`. Assertions unchanged.
- `test/cli.test.js` the five auth login calls that reach the probe (long-lived stop, state mismatch, owner mismatch, success, authorize step): added `probe: absentService`. Assertions unchanged.
- `test/cli.test.js` 'auth login stores the owner token and the token record on success'. New assertion: `out.text()` includes 'A stop that was in place before this login, if any, still holds.' (M-11).

### New tests (names)

- `test/oauth.test.js`: 'the callback is passed on only after the page has finished writing (M-4)'
- `test/poller.test.js`: 'a stored STATE_CORRUPT stop halts reads until it is cleared'
- `test/cli.test.js`:
  - 'the probe asks GET /health on the configured host and port, with no token'
  - 'auth login refuses while ig serve answers /health with 200, and opens no listener (I-3)'
  - 'a connection error or a timeout means no service, and the login proceeds (I-3)'
  - 'routes ack-unofficial is refused while ig serve answers, and stores nothing (I-3)'
  - 'a poller reading reaches the usage gate before any tool call, and the next outbound call is busy (I-1)'
  - 'the poller makes no request while STATE_LOST is held (I-2)'
  - 'the poller makes no request while STATE_CORRUPT is held (I-2)'
  - 'serve checks the owner token account with GET me, with the Bearer header and no token in the URL (M-1)'
  - 'serve refuses a token of another account, and listens on nothing (M-1)'
  - 'serve refuses when Graph gives no id for the owner token (M-1)'
  - 'auth facebook keeps the usage reading of its Page read through the usage-aware factory (M-2)'
  - 'a Graph client without onUsage is refused for outbound use (M-9)'
  - 'a failing token check is logged by its kind, and does not throw (M-9)'

### Mutation checks

Each fix was broken on purpose, and the matching test had to fail.

| Mutation | Result |
|---|---|
| I-2: HALTING without the two state kinds | Three poller tests fail ('a lost state...', 'a stored STATE_LOST...', 'a stored STATE_CORRUPT...'). Two cli tests fail ('the poller makes no request while STATE_LOST / STATE_CORRUPT is held'). |
| I-1: the poller client with a no-op onUsage | 'a poller reading reaches the usage gate...' fails. The first version of this test passed under the mutation, because a call with no reading is also busy. The test now asserts the no-reading reason before the tick, and the gate's own reason ('usage reached 80 percent') after it. |
| I-3: probe always 'absent' | 'the probe asks GET /health...' and 'auth login refuses while ig serve answers...' fail. |
| M-1: owner check compares nothing | 'serve refuses a token of another account, and listens on nothing' fails. |
| M-4: onCallback before finish | 'the callback is passed on only after the page has finished writing' fails. |
| M-9: makeGraphClient without the onUsage check | 'a Graph client without onUsage is refused for outbound use' fails. |
| M-9: token check rethrows | 'a failing token check is logged by its kind, and does not throw' fails. |
| M-11: stop line removed | 'auth login stores the owner token and the token record on success' fails. |
| M-2: Facebook reading dropped | 'auth facebook keeps the usage reading...' fails. |

Each mutation was restored from a verified copy, and `src/cli.js` was compared with the good copy afterwards.

### A mistake during the mutation check, and its fix

The M-1 mutation let the mismatch test reach a real `listen` on port 8788, and the run did not exit. The two node test processes were stopped, port 8788 was confirmed free, and `src/cli.js` was restored from a verified copy. The mismatch test now puts a stub in place of the HTTP server. If the owner check is broken, `startServe` reaches `listenHttp`, which refuses a server it did not build, so the test fails without opening a socket. No test opens a socket or makes a network call: the probe, the Graph calls, the Facebook token and the redirect listen are all injected.

### Test output

`npm test` (saved at `scratchpad\npm-test-fr1-final.txt`):

```
ℹ tests 725
ℹ suites 0
ℹ pass 725
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Exit code 0, with no warning lines. The count: 710 before this round (706, plus the four owner tests from the Task 10 fix), plus 15 new tests (oauth 1, poller 1, cli 13), which gives 725.

`node bin/ig.js --help` is unchanged. The bin-based MCP check still passes both handshakes.

### Deferred, as the coordinator said

M-3 (the token refresh is not held by a stop), M-5 (any request to /callback ends the login) and M-6 (the server error listener is removed once listening) stay open. M-7 (`auth set owner_token` stores without an account check) is covered for serve, because serve now checks the owner token at every start; `auth set` itself is unchanged.

### Behaviour changes for the owner

- `ig serve` needs `owner_token` and a reachable Graph at start. It refuses otherwise, with a clear message.
- `ig auth login` and `ig routes ack-unofficial` refuse while a service answers `/health` on the configured host and port.
- The poller halts under STATE_CORRUPT and STATE_LOST. The owner clears either with `ig_stop_clear`.

## 12. Fix round 2 (focused re-review: task-17-rereview-1.md)

Scope, as the coordinator set it: N-1a, N-1b, N-3, and the two items that stay as they are (N-2, N-4).

### Changes

| Item | Change | Where (live file and line) |
|---|---|---|
| N-1a, the probe answer | `probeServe` returns 'running' for any HTTP response, whatever its status (403 and 404 included). Only a connection error or a timeout returns 'absent'. The body is still released. | `src/cli.js:166-176` (the return is at :176) |
| N-1b, the IPv6 host | `statusHost` takes the host bare first (a bracketed input is unwrapped), and brackets an IPv6 address exactly once. A name or an IPv4 address is unchanged. The probe and `ig status` both use it, so `ig status` for a `[::1]` host is fixed too (it was the same pre-existing bug). | `src/cli.js:320-324` |
| N-3, the test comment | The comment now says that a broken owner check makes startServe reach `httpServer.once` first, which the stub lacks, so it fails with a TypeError before listenHttp runs, and no socket is opened. | `test/cli.test.js` (the M-1 refusal test, the comment above `built.httpServer = { listening: false }`) |

Not changed, as the coordinator said. N-2: the probe still uses the configured host; the README (Task 18) will say so. N-4: the `recordUsage` setter is accepted; no request can reach it (`src/service.js:513`).

### Changed test: old and new assertion

- `test/cli.test.js` 'the probe asks GET /health on the configured host and port, with no token'. Old: `assert.equal(await probeServe({ config, fetchImpl: notOk.fetchImpl }), 'absent');` for a 503. New: `'running'`. The comment above it changed to say that any HTTP answer is a running service. The other assertions are unchanged.

### New tests (names)

- `test/cli.test.js`:
  - 'a probe answer of 403 or 404 means a service is running, and auth login and routes refuse (N-1a)'. It checks both commands for each status, and that nothing is listened on or stored.
  - 'a connection error means no service, and the login proceeds (N-1a)'
  - 'a timeout means no service, and the login proceeds (N-1a)'. It uses the probe's own `AbortSignal.timeout(20)` with a fetch that never answers. The test asserts that the signal aborted. No request leaves the process.
  - 'the probe builds one pair of brackets for an IPv6 host, and 127.0.0.1 is unchanged (N-1b)'. It covers `127.0.0.1`, `[::1]` and `::1`, and checks that each URL parses.
  - 'ig status builds one pair of brackets for an IPv6 host (N-1b)'

### Mutation checks

| Mutation | Result |
|---|---|
| The probe back to 200-only (N-1a) | 'the probe asks GET /health...' and 'a probe answer of 403 or 404...' fail |
| `statusHost` back to the original (N-1b) | 'the probe builds one pair of brackets...' and 'ig status builds one pair of brackets...' fail |
| A connection error read as running | 'a connection error means no service...', 'a timeout means no service...' and the I-3 'connection error or a timeout' test fail |

Each mutation was restored from a verified copy. `src/cli.js` was compared with the good copy afterwards, and port 8788 was confirmed free.

### Test output

`npm test` (saved at `scratchpad\npm-test-fr2-final.txt`):

```
ℹ tests 730
ℹ suites 0
ℹ pass 730
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Exit code 0, with no warning lines. The count: 725 after fix round 1, plus five new tests (cli: 44, up from 39), which gives 730. `node bin/ig.js --help` is unchanged.

### Notes for the owner and for Task 18

- Probe host (N-2): the probe and `ig status` use the configured host. For a non-loopback bind, a probe goes to that address. It sends no token and reads no body, so nothing secret leaves. The README will say this.
- Recording setter (N-4): accepted, as the coordinator said.
- The probe still fails open for a running service that takes more than 1000 ms to answer. That residual is accepted by the ruling and is listed in section 9, item 7.

## P1 (2026-10-22)

Scope, as the coordinator set it: the auth flow only. The changes are in `src/oauth.js`, the auth parts of `src/cli.js`, `test/oauth.test.js` and `test/cli.test.js`. The graph client and the service are unchanged. No step needed a client change, so nothing was stopped for one.

### Decisions implemented

- **O-7, the long-lived token exchange.** Implemented. `longLivedExchange` (`src/oauth.js:367`) POSTs to `https://graph.instagram.com/access_token`. The short-lived token goes in the `Authorization: Bearer` header. `grant_type=ig_exchange_token` and `client_secret` go in the form body. The URL is a constant with no query string, and a test asserts it. The short-lived exchange (`exchangeShortLived`, `src/oauth.js:305`) is unchanged: it already POSTs the code and the secret in the body, with the URL constant and no query. `user_id` is still read from the raw text (ruling b).
- **O-7, storage order.** `runAuthLogin` (`src/cli.js:262`) writes the owner token and its record only after both exchanges have succeeded and the owner check has passed. The record is `{ obtainedAt, expiresAt, scopes }`, the ruling (p) shape. The keyring entry is written first. If the record save then fails, the entry is removed again and the message says so (`removeOwnerToken`, `src/cli.js:250`; the rollback branch around `src/cli.js:318`).
- **O-7, step naming.** Each step of the login runs through `atStep` (`src/cli.js:238`), so a failure keeps its kind and names its step: `the approval redirect`, `the short-lived token exchange`, `the long-lived token exchange`, `the Facebook approval`, `the Page check`. A refusal carries the HTTP status and the error type when that is a short word (`refusedDetail`, `src/oauth.js:353`). No body text, token or secret is echoed.
- **O-8, the Facebook fragment flow.** Implemented.
  - `buildFacebookAuthorizeUrl` (`src/oauth.js:168`) asks for `response_type=token` against `https://www.facebook.com/dialog/oauth`. It carries client_id, redirect_uri, response_type, scope and state, and nothing else.
  - The redirect page (`GET /facebook-callback`) is a small static page (`BRIDGE_HTML`, `src/oauth.js:97`). Its inline script (`BRIDGE_SCRIPT`, `src/oauth.js:64`) reads `location.hash`, clears it with `history.replaceState` before posting, and POSTs the token and state as a form body to `location.origin + '/facebook-token'`. The page holds no token and no secret. Its CSP (`BRIDGE_CSP`, `src/oauth.js:94`) names the sha256 of the script text, and nothing else is allowed to run.
  - The handler (`createFacebookBridgeHandler`, `src/oauth.js:436`) accepts the POST only from `127.0.0.1` or `::ffff:127.0.0.1`, only for the Host it listens on, only with the form content type, and only up to `FACEBOOK_BODY_LIMIT` = 4096 bytes (`readLimited`, `src/oauth.js:416`). It accepts one approval. It checks the state first, in constant time: a mismatch is AUTH_EXPIRED, nothing is registered or stored, and the login ends. An approval that carries `error` ends the login with CONFIG. An approval with no usable token ends it with API_ERROR. The token is registered (`registerToken`) before the result is reported. The result is reported after the response has finished, as in the Instagram callback.
  - `listenForFacebookToken` (`src/oauth.js:532`) binds only 127.0.0.1, times out after five minutes, and keeps its error listener after listening. It is injectable; the tests never call it with a real server.
  - `runAuthFacebook` (`src/cli.js:339`) prints the authorize URL, receives the token through the bridge, runs the Page check (the brief's rule, through `makeGraphClient`, with the token in the Bearer header), and stores `facebook_token` only if the Page is linked to the owner's account. The refusal that stopped it before any browser step is gone.

### Existing behaviour kept

`buildAuthorizeUrl` and `parseRedirect` are unchanged in behaviour (the authorize-input checks moved into `checkAuthorizeInputs`, `src/oauth.js:140`, and the tests cover both). The F-19 callback state check and the F-20 error listener are unchanged. The serve-running refusal is in place. See the discrepancy below. The owner check at serve start (M-1), the acknowledgement command and ruling (d) are unchanged.

### A discrepancy the coordinator should know

The coordinator's message for this package says to keep the probe refusal (I-3). The probe is no longer in the code. The final fix round replaced it with the serve lock: F-21 in `final-fix-report.md`, which says "the probe is removed". `runAuthLogin` and `runRoutesAck` now check `readServeLock` (`src/cli.js:255`, `src/cli.js:335`), and `startServe` takes the lock. I kept the lock. It refuses on the same condition ("ig serve is running"), and it does not depend on a network answer, so it has no probe residual. Putting the probe back would undo F-21. The owner or the controller should say whether the probe should return.

### Changed tests (old and new assertion)

- `test/oauth.test.js`: 'the long-lived exchange is not approved, so its default refuses with CONFIG and stores nothing' is removed. Old: `longLivedExchange()` rejects with CONFIG and the message /not yet approved/. Replaced by five O-7 tests.
- `test/cli.test.js`: 'auth login stops at the long-lived exchange and stores nothing' is renamed 'a refused long-lived exchange names its step, and stores nothing (O-7)'. Old: rejects with kind CONFIG and /not yet approved/, and the fake fetch answers the short-lived body for every URL. New: rejects with kind API_ERROR and the message `the long-lived token exchange failed: the long-lived token exchange was refused (HTTP 400, OAuthException)`. The fake fetch now answers by URL: the short-lived body for api.instagram.com, and HTTP 400 for the long-lived call. Nothing is stored, and the audit is empty.
- `test/cli.test.js`: 'the authorize step is built from the app id and the owner scopes'. Old: relied on the default long-lived refusal (CONFIG). New: injects `longLived`, which throws CONFIG, so the test still stops after the authorize step. The kind assertion and the URL assertions are unchanged.
- `test/cli.test.js`: 'auth facebook refuses before any browser step, because the documented token arrives in the URL fragment' is removed. Old: asserted a CONFIG refusal mentioning /fragment/ and no writes. Replaced by 'auth facebook prints the fragment authorize URL, and the bridge receives the expected state (O-8)', 'auth facebook refuses without app.id, before any approval is awaited (O-8)' and 'auth facebook stores nothing when the bridge refuses the state (O-8)'.
- `test/cli.test.js` helper: `fakeSecrets` gained `removes` and `remove`, for the rollback test. No assertion changed.

A dangerous moment, recorded for honesty. The retired Facebook test called `runAuthFacebook` without a receiver, so the default listened on 127.0.0.1:8790 and waited five minutes. The run was killed by the timeout (exit 124) after about 100 seconds. I checked that no test process was left and that port 8790 was free, then rewrote the test so every `runAuthFacebook` and `runAuthLogin` call injects its receiver or listener. I checked each call site by reading it, since a script over the multi-line calls gave false alarms. No test listens now.

### New tests (names)

`test/oauth.test.js` (19 new):
- 'the long-lived exchange sends the token in the Bearer header, the secret in the body, and no query (O-7)'
- 'the long-lived exchange registers its token before it is returned (O-7)'
- 'the long-lived exchange names its step and the HTTP status when Meta refuses, with no secret text (O-7)'
- 'the long-lived exchange names its step when the request does not complete (O-7)'
- 'the long-lived exchange refuses a response with no usable token or expiry (O-7)'
- 'buildFacebookAuthorizeUrl asks for response_type=token, and carries no secret or token (O-8)'
- 'the bridge page holds no token or secret, and its CSP names the hash of its own script (O-8)'
- 'a POST with the fragment token and a matching state is accepted, and the token is registered (O-8)'
- 'a POST with a mismatched state is refused with AUTH_EXPIRED, and nothing is received (O-8)'
- 'a body over the limit is refused with 413, and does not end the login (O-8)'
- 'a request from another address, or for another Host, is refused and ends nothing (O-8)'
- 'a POST that is not form-encoded is refused with 415, and ends nothing (O-8)'
- 'an approval that carries an error is refused with CONFIG, and ends the login (O-8)'
- 'an approval without a token is refused, and ends the login with an API_ERROR (O-8)'
- 'the bridge accepts one approval only: a second POST is refused with 409 (O-8)'
- 'the bridge answers a GET on the token path with 405, and an unknown path with 404 (O-8)'
- 'the approval receiver resolves with the token the bridge accepts, with no listen (O-8)'
- 'the approval receiver rejects with AUTH_EXPIRED when the state does not match, and stores nothing (O-8)'
- 'an error from the approval server after it is listening ends the login with CONFIG (O-8)'

`test/cli.test.js` (5 new):
- 'a refused short-lived exchange names its step, and stores nothing (O-7)'
- 'a failed token record save removes the keyring entry again, and says that nothing is stored (O-7)'
- 'auth facebook prints the fragment authorize URL, and the bridge receives the expected state (O-8)'
- 'auth facebook refuses without app.id, before any approval is awaited (O-8)'
- 'auth facebook stores nothing when the bridge refuses the state (O-8)'

### Mutation checks

Each safety rule was broken on purpose, and the matching test had to fail. Each change was restored from a verified copy.

| Mutation | Result |
|---|---|
| O-7: the access token put in the long-lived form body | 'the long-lived exchange sends the token in the Bearer header...' fails |
| O-8: the state check removed | 'a POST with a mismatched state is refused...' fails |
| O-8: the body limit removed | 'a body over the limit is refused with 413...' fails |
| O-8: the remote-address check removed | 'a request from another address, or for another Host...' fails |
| O-7: the rollback removed | 'a failed token record save removes the keyring entry again...' fails |

### Test output

`npm test` (saved at `scratchpad\npm-test-p1.txt`):

```
ℹ tests 786
ℹ suites 0
ℹ pass 786
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Exit code 0, with no warning lines. The count before this package was 764 (the final fix round's count). This package adds 24 test names and retires 2, so the net is +22: 764 to 786. The per-file split is 19 new in `test/oauth.test.js` (one retired), and 5 new in `test/cli.test.js` (one retired, one renamed).

`node bin/ig.js --help` is unchanged. The bin-based MCP check still passes both handshakes. Ports 8788 and 8790 are free after the run.

### Live-check items

1. **Meta may refuse the POST for the long-lived exchange** (O-7). This is the main live risk. A refusal is loud: the message names the step and carries the HTTP status and the error type. Nothing is stored.
2. **The authorize host** for Instagram Login: `www.instagram.com` (the Business Login guide) or `api.instagram.com` (the reference page).
3. **The short-lived exchange's form encoding**: the docs' curl uses multipart `-F`; the code sends a form-urlencoded body.
4. **Facebook Login for Business**: the app must allow the response_type=token flow, and `http://127.0.0.1:8790/facebook-callback` must be registered as a redirect URI. Meta may require https for a Facebook redirect. The scopes are the docs example's list, and must be confirmed against the app's permissions.
5. **The Facebook fragment in a real browser.** The bridge page's script, the CSP hash, and the POST to the loopback server must run in a real browser. Confirm in Chrome and Firefox.
6. **The Facebook Page check** sends the token in the Bearer header, while the docs show a query parameter. The owner-check endpoint `GET /v26.0/me?fields=id` is also still a live check.
7. **The token record's expiry.** The record takes `expires_in` from the long-lived response (5183944 seconds in the docs), and the Facebook token's lifetime is not confirmed.

### Concerns for the owner

- A stale or forged approval with the wrong state ends the login (AUTH_EXPIRED), as the decision says. The owner must start again. The other refusals on the bridge (wrong address, wrong Host, too large, wrong type, a second approval) keep the login waiting, so a bad request cannot end it.
- The bridge needs the owner's browser to run its page. That is the cost O-8 states.

## P1 fix round (2026-10-22)

Scope, as the review set it (p1-review.md). Each item below is either a change with its file and line, or a stated reason. The changes are in `src/oauth.js`, `src/cli.js`, `bin/ig.js`, `test/oauth.test.js` and `test/cli.test.js`. No graph client or service change. No test listens on a real port, and no test makes a network call.

### Changes, by review item

- **I-1, a mismatched bridge state keeps the login waiting.** `src/oauth.js:599`: a POST whose state does not match gets 400 with `reply(res, 400, ...)`, with no `received` flag and no `onResult`. The login keeps waiting; nothing is stored. The receiver (`listenForFacebookToken`, `src/oauth.js:632`) therefore resolves only on a matching approval, or on a refusal that ends the login (an `error` field, or no usable token).
- **I-2, the login holds the serve lock for its wait.** `runAuthLogin` (`src/cli.js:333`) calls `acquireServeLock(dataDir)` (`:354`), after its own checks and before the browser step. It releases the lock in a `finally` (`:402`), so every exit is covered: a failed step, a cancelled or timed-out approval, and a store failure. `runAuthFacebook` (`src/cli.js:410`) does the same (`:425`, `:479`). The lock is the same file and the same functions as serve's (`acquireServeLock`, `readServeLock`, `releaseServeLock`). `runServe` (`src/cli.js:784`) takes it too (M-6).
- **M-1, a body over the limit is drained so the 413 reaches the client.** `readBody` (`src/oauth.js:493`) reads past the limit and discards the rest, up to `BODY_DRAIN` (`src/oauth.js:48`, four times the body limit). Only a body beyond the drain bound stops the read. The 413 is sent after the read, so it can reach a real client.
- **M-2, Origin and Sec-Fetch-Site on the bridge POST; the Instagram callback accepts GET only.** `src/oauth.js:582` (the rule is REVISED; see "Origin rule revision (2026-10-22)" at the end): an `Origin` equal to this server's loopback origin is accepted; with no `Origin`, `Sec-Fetch-Site` must be `same-origin` or `none`; every other case gets 403 and ends nothing. The Instagram callback (`createCallbackHandler`, `src/oauth.js:245`) answers 405 to any method but GET.
- **M-3, a re-login restores the previous owner token.** `storeSecretWithRecord` (`src/cli.js:291`) reads the previous keyring entry before the store (only a keyring value counts; an environment value is not written into the keyring). If the record cannot be saved, it puts the previous entry back, or removes the new one when there was none. The same helper stores `facebook_token`.
- **M-4, an audit write that fails after the store does not fail the login.** `auditSafely` (`src/cli.js:319`) writes the line and, if that throws, prints `warning: the audit line was not written (<name>); the step itself succeeded`. The login still returns `stored`. Used for both login and Facebook.
- **M-5, a stale lock is taken over by rename first.** `takeOverStaleLock` (`src/cli.js:204`) renames the stale lock to a unique name, and removes it only if the file moved has the stale content that was read. A live lock moved by mistake is put back, and the takeover is refused. `acquireServeLock` (`src/cli.js:233`) uses it.
- **M-6, the serve lock is taken before `buildServe`.** New `runServe` (`src/cli.js:784`): it takes the lock, then `build`, then `start`, and releases the lock if the start fails. `bin/ig.js:129` calls `runServe`. `startServe` no longer takes the lock; it releases it on a failed start and at shutdown, as before.
- **M-7, `auth facebook` help and `--port`.** The description in `bin/ig.js:102-106` now says what the command does. `--port` is added (`bin/ig.js:102`), it matches `auth login`, and `runAuthFacebook` passes it to the receiver (`src/cli.js:432`) and the redirect URI (`src/cli.js:428`).
- **M-8, the scopes the exchange returns.** `exchangeShortLived` returns `grantedScopes` from the `permissions` field (`src/oauth.js:425`), or `null`. `runAuthLogin` records `scopes` = the granted list when there is one, and `scopes` = `[]` otherwise, with the requested list under `scopesRequested` (`src/cli.js:384-395`). `scopes: []` keeps a refresh refused, because `canRefresh` needs `instagram_business_basic` in the list, so the record does not claim a granted scope it does not have.
- **M-9, size caps on the exchange and Page-check bodies.** `readCapped` (`src/oauth.js:326`) refuses a body over the limit with an error that names the step. The token exchanges use `RESPONSE_LIMIT` = 65536 (`src/oauth.js:50`). The Page check goes through `cappedFetch` (`src/oauth.js:357`, `PAGE_LIST_LIMIT` = 262144 at `:51`), which turns an oversized body into HTTP 413; the Graph client then refuses it as an API_ERROR. The graph client is unchanged, so the message is the client's ("Graph API request failed with HTTP 413"), under the step name.
- **M-10, the Facebook expiry is recorded when given, and unknown when not.** The bridge script posts `expires_in` from the fragment when it has one (`src/oauth.js:77-80`). `expiresInOf` (`src/oauth.js:511`) reads it as a whole positive number, otherwise `null`. `runAuthFacebook` records `facebookToken` = `{ obtainedAt, expiresAt, expiryKnown }`, with `expiresAt` = `null` and `expiryKnown` = `false` when the approval gave none (`src/cli.js:462-468`). No lifetime is invented. The approval contract is now `{ token, expiresInSeconds }` (`listenForFacebookToken`, `src/oauth.js:632`).

### Changed tests (old and new assertion)

`test/oauth.test.js`:
- 'a POST with a mismatched state is refused with AUTH_EXPIRED, and nothing is received (O-8)' is renamed 'a POST with a mismatched state gets 400, stores nothing, and the login keeps waiting (I-1, O-8)'. Old: `statusCode 403`, `results.length 1`, `results[0].error.kind 'AUTH_EXPIRED'`, `results[0].token null`. New: `statusCode 400`, `results.length 0`, then the owner's matching approval is accepted (200, one result, token = FB token).
- 'the approval receiver rejects with AUTH_EXPIRED when the state does not match, and stores nothing (O-8)' is renamed 'the approval receiver keeps waiting after a mismatched state, and resolves on the matching one (I-1, O-8)'. Old: `await assert.rejects(pending, err.kind === 'AUTH_EXPIRED')`. New: after the mismatched POST the receiver is still pending; after the matching POST it resolves with `token` = FB token and `expiresInSeconds` = `null`.
- 'the approval receiver resolves with the token the bridge accepts, with no listen (O-8)'. Old: `assert.equal(await pending, FB_TOKEN)`. New: `assert.equal((await pending).token, FB_TOKEN)`, because the receiver resolves with the approval object.
- Five callback calls now pass `method: 'GET'`: the 404 test, the M-4 test, and the three F-19 calls. Their assertions are unchanged. Without the method the callback now answers 405.
- `fakeRequest` now defaults to the page's own headers: `origin` (this server) and `sec-fetch-site: same-origin`. The refusal tests override them. No assertion changed.
- The `bridge()` helper records `token` and `expiresInSeconds` from the approval object. Its existing assertions on `results[0].token` are unchanged.

`test/cli.test.js`:
- 'auth login stores the owner token and the token record on success'. Old: `assert.deepEqual(record.scopes, INSTAGRAM_SCOPES)`. New: `record.scopes` is `[]` and `record.scopesRequested` is `INSTAGRAM_SCOPES`, because this exchange returns no permissions (M-8).
- 'a serve start that fails before it listens removes the lock it took (F-21)'. Old: `startServe(built, ...)` rejects OWNER_MISMATCH and the lock is gone. New: `runServe({ ..., build: () => built, start: startServe })` rejects OWNER_MISMATCH and the lock is gone (M-6). The lock is now taken by `runServe`.
- 'auth facebook prints the fragment authorize URL, and the bridge receives the expected state (O-8)'. Old: `receiveToken` returned the token string. New: it returns `{ token, expiresInSeconds: null }`, and the call passes `state: fakeState()`.
- 'auth facebook stores the token only when the owner account has a linked Page' (linked and unlinked cases) and 'auth facebook keeps the usage reading of its Page read through the usage-aware factory (M-2)'. Old: `receiveToken` returned a string. New: an object; the usage-reading test also passes `state: fakeState()`.
- `configFrom` now sets `dataDir` to a temporary folder, so a login or a serve never writes the project's data folder. No assertion changed.
- `fakeSecrets.source()` now reports `'keyring'` for a stored value (it reported `'env'`). `fakeSecrets` gained `remove()` and `removes`. These support the M-3 tests. The assertions that check `source` are unchanged.

### New tests (names)

`test/oauth.test.js` (11):
- 'a body over the limit gets 413, and the request is drained to its end (M-1, O-8)'
- 'a body beyond the drain bound is read only to the bound, and still gets 413 (M-1, O-8)'
- 'a POST whose Origin is missing or is not this server is refused with 403, and ends nothing (M-2, O-8)'
- 'a POST whose Sec-Fetch-Site is missing, cross-site or same-site is refused with 403, and ends nothing (M-2, O-8)'
- 'the Instagram callback accepts GET only, and a POST gets 405 and ends nothing (M-2)'
- 'the short-lived exchange returns the permissions it granted, and none when it returns none (M-8)'
- 'a token exchange response over the cap is refused, and names the step (M-9)'
- 'a long-lived response over the cap is refused, and names the step (M-9)'
- 'cappedFetch gives HTTP 413 for a body over the cap, and passes a body under it (M-9)'
- 'an approval reports its expires_in, or null when it has none or it is not a whole number (M-10, O-8)'
- 'the bridge page script posts expires_in from the fragment when there is one (M-10)'

`test/cli.test.js` (14):
- 'a login holds the serve lock while it waits, so a serve started in that window is refused (I-2)'
- 'a serve that holds the lock makes the login refuse before any browser step (I-2)'
- 'the lock is released when a login fails, and when the approval is cancelled (I-2)'
- 'a second start is refused before buildServe is called (M-6)'
- 'two takeovers of one stale lock: one wins, and the other is refused without removing the winner's lock (M-5)'
- 'a failed re-login leaves the previous owner token in place (M-3)'
- 'an audit write that fails after the store does not fail the login, and the output says so (M-4)'
- 'the help lists --port for auth facebook (M-7)'
- 'auth facebook passes its --port to the approval receiver and into the redirect URI (M-7)'
- 'the granted scopes are recorded when the exchange returns them (M-8)'
- 'the requested scopes go under scopesRequested, and scopes stays empty, when no granted list is returned (M-8)'
- 'a Page-check response over the cap is refused, and stores nothing (M-9)'
- 'an approval with expires_in records the expiry (M-10)'
- 'an approval without expires_in records the expiry as unknown, and invents no lifetime (M-10)'

Two existing test names were changed (the renames above); no test was removed.

### Mutation checks

Each fix was broken on purpose, and the matching tests had to fail. Each change was restored from a verified copy.

| Mutation | Result |
|---|---|
| I-1: state check off, or a mismatch ends the login | the I-1 tests fail (2 each) |
| M-1: drain removed (read stops at the limit) | the drain tests fail; one M-9 test also fails, because the sed pattern matched both read loops (noted, not a test error) |
| M-2: Origin check removed | the Origin test fails |
| M-2: callback GET-only check removed | the callback test fails |
| M-3: restore of the previous entry removed | the re-login test fails |
| M-4: audit throw propagates | the audit test fails |
| M-5: content check removed in takeover | the takeover test fails |
| I-2: login does not take the lock | the login-holds-lock test fails |
| M-6: runServe does not take the lock first | two tests fail (the window test and the M-6 test) |
| M-9: cappedFetch never refuses | the cappedFetch test fails |
| M-8: scopes always the requested list | three tests fail |
| M-10: expiry 0 accepted; expiry never read | the M-10 tests fail |
| M-7: port ignored for the redirect | the M-7 redirect test fails |

### Test output

`npm test` (saved at `scratchpad\npm-test-p1fix.txt`):

```
ℹ tests 811
ℹ suites 0
ℹ pass 811
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Exit code 0, with no warning lines. The count before this round was 786 (the P1 count). This round adds 25 new tests (11 in `test/oauth.test.js`, 14 in `test/cli.test.js`) and renames two; no test is removed. 786 + 25 = 811.

`node bin/ig.js --help` (top level) is unchanged; the `auth facebook` help now lists `--port`. The bin-based MCP check passes both handshakes (no FAIL line). Ports 8788 and 8790 are free after the run.

### Decisions and concerns for the owner

- **A scope list the exchange does not return** leaves `scopes` empty, so a refresh stays refused until a token is obtained whose exchange returns its permissions. The docs show `permissions` in the short-lived response, so this should not happen in practice; it is a live check.
- **The Page-check cap** reaches the owner as the Graph client's message, "Graph API request failed with HTTP 413", under the step name. A message that says "too large" needs a client change, which this round does not make.
- **Concurrency of the takeover.** The two-takeover test is sequential: it uses the same stale content for both attempts. A true race between two processes is not exercised.
- **Stale login locks.** A login that dies leaves a lock with a dead pid; the next start takes it over (M-5). A live login blocks a serve for its wait, as I-2 requires.
- **The Facebook record** `facebookToken` is a new state key. Its `expiryKnown` is `false` when the approval gave no expiry.
- **The bridge no longer refuses a POST without `Sec-Fetch-Site`** (revised 2026-10-22, see the end of this report). A matching `Origin` is accepted with or without `Sec-Fetch-Site`, so older browsers are not locked out. Only a POST with no `Origin` relies on `Sec-Fetch-Site`.

## Origin rule revision (2026-10-22)

The coordinator changed the bridge's Origin rule (M-2), so that older browsers are not locked out. The change is in `src/oauth.js:577-582`, in the bridge POST check of `createFacebookBridgeHandler`.

**Old rule** (P1 fix round): the POST was refused unless its `Origin` equalled this server's loopback origin AND its `Sec-Fetch-Site` was `same-origin` or `none`. A missing header of either kind was refused.

**New rule**:
- An `Origin` header is accepted only when it equals this server's loopback origin exactly, `http://127.0.0.1:<port>`. Its `Sec-Fetch-Site` is not consulted.
- Only when `Origin` is absent is `Sec-Fetch-Site` consulted: `same-origin` or `none` is accepted, and every other value (or none) is refused.
- Every other case is refused with 403, and it ends nothing; the login keeps waiting.

```js
const origin = req.headers?.origin;
const site = req.headers?.['sec-fetch-site'];
const sourceOk = origin === undefined ? site === 'same-origin' || site === 'none' : origin === allowedOrigin;
```

### Changed tests (old and new assertion)

`test/oauth.test.js`:
- 'a POST whose Origin is missing or is not this server is refused with 403, and ends nothing (M-2, O-8)' is renamed 'a POST whose Origin is not this server is refused with 403, and ends nothing (M-2, O-8)'.
  - Old: a missing Origin (with the default `Sec-Fetch-Site: same-origin`) gets 403; a foreign Origin gets 403; `https://127.0.0.1:8790` gets 403; the default headers get 200.
  - New: the foreign Origin, the `https` Origin and `http://127.0.0.1:9999` (a foreign port) each get 403; the default headers get 200. The missing-Origin case is removed from this test, because it is now decided by `Sec-Fetch-Site` (see the new tests below).
- 'a POST whose Sec-Fetch-Site is missing, cross-site or same-site is refused with 403, and ends nothing (M-2, O-8)' is renamed 'with no Origin, a POST whose Sec-Fetch-Site is cross-site or same-site is refused, and none or same-origin is accepted (M-2, O-8)'.
  - Old: with the matching Origin, `Sec-Fetch-Site` of missing, `cross-site` or `same-site` gets 403; `none` gets 200.
  - New: with no Origin, `cross-site` and `same-site` get 403; `none` gets 200; `same-origin` gets 200 (on a second handler, since the first has received its one approval).
  - The missing-`Sec-Fetch-Site` case moved to 'a POST with neither Origin nor Sec-Fetch-Site is refused with 403'.

### New tests (names)

`test/oauth.test.js` (4 new; the two renames above are not counted as new):
- 'a POST with a matching Origin and no Sec-Fetch-Site is accepted, for an older browser (M-2, O-8)': the state matches; the approval is received with the token.
- 'a POST with no Origin and Sec-Fetch-Site same-origin is accepted (M-2, O-8)'.
- 'a POST with neither Origin nor Sec-Fetch-Site is refused with 403, and ends nothing (M-2, O-8)'.
- 'a matching Origin is accepted whatever its Sec-Fetch-Site, because the Origin rule decides (M-2, O-8)': a matching Origin with `cross-site` is accepted.

### Mutation checks

| Mutation | Result |
|---|---|
| The old rule put back (`origin === allowedOrigin && (same-origin or none)`) | 4 tests fail: 'a POST with a matching Origin and no Sec-Fetch-Site is accepted, for an older browser'; 'a POST with no Origin and Sec-Fetch-Site same-origin is accepted'; 'a matching Origin is accepted whatever its Sec-Fetch-Site'; 'with no Origin, a POST whose Sec-Fetch-Site is cross-site or same-site is refused, and none or same-origin is accepted' |
| The no-Origin fallback removed (missing Origin accepted) | 2 tests fail: the neither-header test, and the no-Origin cross/same test |

Each mutation was restored, and the source line was checked afterwards (`src/oauth.js:582`).

### Test output

`npm test` (saved at `scratchpad\npm-test-origin2.txt`):

```
ℹ tests 815
ℹ suites 0
ℹ pass 815
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Exit code 0, with no warning lines. The count before this revision was 811 (the P1 fix round). This revision adds 4 new tests, which gives 815. Ports 8788 and 8790 are free after the run.

### Note on the rule

The rule is looser than the previous one. An `Origin` header that matches is accepted even when `Sec-Fetch-Site` says `cross-site`. Browsers do not send that combination for the page's own fetch, so the practical effect is none; the coordinator decided it, and the test pins it.
