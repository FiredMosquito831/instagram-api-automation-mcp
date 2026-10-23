# Final whole-branch review: Instagram automation service

Date: 2026-10-21. Read-only review. No file was edited, git was not run, the suite was not re-run (the ledger and README report 730/730 on Node 24.6.0 and 22.13.1), and no subagent was used. Paths are relative to `D:\Projects2\InstagramApi` unless shown in full.

Counting rule: each table row counts once. A row that groups several ledger IDs lists them all.

Counts: FIX 34, ACCEPT 36, OWNER 13. Real security leaks: 0. README mismatches: 14 (5 wrong statements, 9 omissions).

---

## Part 1: Deferred items triage

Severity: High means the item could fail open, or silently lose a stop, cap, owner rule or secret path. Medium means fail-closed but wrong, or a gap a live step would expose. Low means hygiene, tests, comments or documented limits.

The rule applied: an item that touches a secret, a stop, a cap or the owner rule is never ACCEPT. Where the code is already fail-closed and only the README is wrong, the row is FIX with a README change named as the fix.

### High

| ID | Item (source) | Rec | Reason |
|---|---|---|---|
| F-1 | A stop is lost when `state.json` is deleted and `events.jsonl` does not exist (Task 4 M-1; Task 3 O-2 ruling) | FIX | In `src/guard.js` `createGuard` (line 163), treat a non-empty `audit.jsonl` as evidence too, and pass `files.audit` from `buildServe` in `src/cli.js`. A deleted state file currently clears a stop with no evidence. |
| F-2 | `hashtagSearch` has no stop check and writes no audit line, but counts toward spacing and the 200-a-day total (Task 13 M-6) | FIX | Call `guard.assertNotStopped()` and `safeAudit` before `caps.check` in `src/service.js` (about lines 677-690). A call that is counted must obey the stop. |
| F-3 | The poller's halt is sticky after a clear and is checked only at the start of a tick; the stop paths have no tests (Task 11 m-4, m-5, m-7) | FIX | Ask the guard before each thread (`src/poller.js` about lines 127-140 and 225-245), release the halt when the stored stop is not a halting kind, and add the three missing tests. |
| F-4 | `state.set` changes memory before a save that can fail, with no rollback (Task 3 M-N1; Task 13 M-9) | FIX | Restore the previous value when `save` throws (`src/state.js` about lines 135-145). Memory must match disk. Today the effect is an over-count, which fails closed. |
| F-5 | Owner and quota reads run before `caps.check`, so a busy call still makes Graph reads (Task 13 M-2) | FIX | Run `caps.check` and `usageHold` as an early refusal before the reads. Keep the authoritative check, `usageHold` and `caps.record` in one synchronous block. Moving the check alone would open a race across the awaits (`src/service.js` `runOutbound`, about lines 398-445). |
| F-6 | `caps.record()` does not check limits (Task 4 M-10) | FIX | `record()` re-runs the verdict and throws on a limit (`src/caps.js` about line 235). All four current callers check first, so this is defensive. |
| F-7 | `privateReplies.perCommentDays` is validated but never read; the window is fixed at 7 days (Task 13 M-3) | FIX | Remove the key from `DEFAULT_CAPS` and its validation (`src/config.js:28`). The spec fixes 7 days, and an owner edit would silently do nothing. |
| F-8 | Enable flags are truthy checks (`webhook.enabled` at `src/cli.js:441` and `:537`), and other config sections are not type-checked (Task 1 M3) | FIX | Use a strict `=== true` for `webhook.enabled`, and a type check per section in `loadConfig`. A string `"false"` must not turn the receiver on. |
| F-9 | `owner.igUserId` accepts padded and non-numeric strings (Task 1 M2) | FIX | Require `/^\d+$/` after trim in `validateOwner` (`src/config.js` about lines 111-126). Owner rule: fail at load, not only at serve start. |
| F-10 | A `__proto__` cap key is silently dropped by `merge()` (Task 1 re-review Minor-1) | FIX | Reject `__proto__` in the raw file before the merge (`src/config.js:76`). An owner's cap key should produce an error. |
| F-11 | `ProxyAddressIsBlocked` is not in the sidecar's mapping, so it reads as `api_error` and does not stop outbound actions (ledger Task 12; README live table) | FIX | Map it to a stop class in `sidecar/ig_sidecar.py` `map_exception_kind` (line 55), and change the README live row to match. An unmapped stop-class error is a fail-open. |
| F-12 | An exception thrown by `onUsage` escapes `send()` and can discard a response Graph accepted (Task 5 m-3) | FIX | Wrap the `onUsage` call in `src/graph/client.js` `send()` in try/catch. A successful write must not be reported as failed. |
| F-13 | `refreshToken` does not check the client's product, so a Facebook-product client would send the Instagram token to graph.facebook.com (Task 9 deferred) | FIX | Pass the product into `refreshToken` (`src/token.js` about line 73) and refuse anything but `instagram`. Add a test. Latent today, because the service passes only the Instagram client. |
| O-1 | A CHECKPOINT match on any text that contains "challenge", "checkpoint", "two-factor" or "feedback required" stops outbound actions until `ig_stop_clear` (Task 2 M-6) | OWNER | Question: keep the broad match (fails closed, but may stop on an unrelated message), or narrow it once the live error shape is known? Recommendation: keep it broad until the live check. |
| O-2 | Free-text redaction is best effort. Residual forms are listed in README "Redaction" and include breaker M-1 and M-2 (Task 2), Task 12 M-6 (the Python scrub matches exact values only), and session strings under 8 characters | OWNER | Question: accept free-text redaction as best effort, with exact-value registration as the control (the README's current position), or stop sending Graph error text to callers? Recommendation: accept, and keep the README wording. |
| O-3 | A damaged stop record stops the service from starting (Task 4 N-1) | OWNER | Question: refuse to start (current behaviour), or start stopped and keep reads running? Recommendation: keep refusing; it fails closed and is rare. |
| O-12 | NEW, found in this review: auto-replies send with `confirm: true` hard-coded (`src/service.js:474`). README "Confirmation" does not say so | OWNER | Question: is turning auto-replies on with `ig_autoreply_set` (confirm true) your consent for each automatic reply, inside the caps and the 24-hour window? Recommendation: confirm, and say so in the README. |

### Medium

| ID | Item (source) | Rec | Reason |
|---|---|---|---|
| F-14 | Secret names differ between the env and the keyring (`api-token` versus `api_token`) (Task 9 M-8) | FIX | Reject dashes and dots in secret names in `src/secrets.js` `checkName`, so both forms are one name. A stored secret can read as missing today. |
| F-15 | The file-scan test covers a temp directory, not the data directory (Task 9 M-5) | FIX | Point the scan at the data directory the service writes. |
| F-16 | Stop text is read from `error.message` only (Task 2 M-4) | FIX | Also read Graph's user-facing error fields (for example `error_user_msg`) in `mapGraphError` (`src/errors.js:62-70`). Confirm the field names in the live phase. A checkpoint described only in user text would not stop outbound actions. |
| F-17 | A server built by `createRequestHandler`, or a direct `server.listen` on `createHttpServer` output, binds every interface (Task 15 K-1, K-2, M-13) | FIX | Stop exporting `createRequestHandler` for serving (keep a test-only path), and refuse a listen that does not go through `listenHttp` (`src/http.js:337` and `:354`). |
| F-18 | Host `"[ ]"` passes construction and fails only at listen (Task 15 N-2) | FIX | Validate after the bracket strip and trim in `src/http.js` `buildContext`. |
| F-19 | Any request to `/callback` ends the login (Task 17 M-5) | FIX | Answer a request without the expected state with 400 and keep waiting (`src/oauth.js` callback handler). |
| F-20 | The redirect server's error listener is removed once it is listening (Task 17 M-6) | FIX | Keep an error handler that ends the login with CONFIG (`src/oauth.js` `listenForRedirect`). |
| F-21 | One owning process for state and events is assumed; the auth-login probe is a one-second heuristic on the configured host only (Task 3 M-8; Task 17 N-2) | FIX | Serve holds a lock file with its pid in `dataDir`. `auth login` and `routes ack-unofficial` refuse while it exists, instead of probing. |
| F-22 | `errorName` reads `err.name` unguarded, so a throwing getter escapes `safeAudit` and can turn a successful write into an error (Task 13 ledger minor) | FIX | Wrap it in try/catch (`src/service.js:96-99`). The I-2 fix relies on the success path not throwing. |
| F-23 | The sidecar child receives every environment variable except `IG_*` (found in this review, `src/unofficial/sidecar.js:68-74`) | FIX | Pass an allowlist (PATH, SYSTEMROOT, USERPROFILE, TEMP, TMP and the Python settings it needs). Not a log leak, but it widens what the child can read. |
| F-24 | `recordUsage` is a public property of the service object (Task 17 N-4; `src/service.js:513`) | FIX | Keep it internal to `buildServe`. Nothing in HTTP or MCP reaches it today. |
| F-25 | `assertRoute` allows official features for any account type except personal (Task 13 M-12) | FIX | Allow only `business` and `creator`. Defence in depth; config already limits the value. |
| F-26 | The adapter is resolved before the confirm gate, so an unconfirmed unmapped feature throws NOT_SUPPORTED instead of previewing (Task 13 M-14) | FIX | Resolve the adapter inside `perform` (`src/service.js` about line 398). The preview contract is no error and no request. |
| F-27 | README says the owned-media check covers comment actions only (Task 13 M-18) | FIX | README correction, see Part 3 R-3. |
| O-4 | `businessDiscovery` and `mentionedMedia` have no daily bound (Task 13 M-5) | OWNER | Question: add a per-day bucket for these lookups, or keep them manual with no bound? Recommendation: add a small daily bucket. |
| O-5 | A send that fails before Graph accepts it leaves the private reply or auto-reply marked, so it is never retried (Task 13 M-15) | OWNER | Question: allow a retry after a known pre-send failure, or keep the block? Recommendation: keep the block for now. |
| O-6 | The hourly token refresh keeps running while a CHECKPOINT or ACTION_BLOCKED stop holds (Task 17 M-3) | OWNER | Question: pause the refresh under those stops? Recommendation: pause. The constraints scope stops to outbound actions, so this is a policy call. |
| O-7 | The long-lived token exchange is refused by design, so `ig auth login` stores nothing (Task 17 open item 1; README open decision 1) | OWNER | Question: how should the long-lived token be obtained without a token in a URL? Blocks owner login. |
| O-8 | Facebook Login returns its token in the redirect fragment, so `ig auth facebook` refuses (Task 17 open item 2; README open decision 2) | OWNER | Question: accept a fragment flow that keeps the token out of stored or logged URLs, or drop hashtag search, business discovery and media delete? Blocks three tools. |
| O-10 | HTTP returns 500 for AUTH_EXPIRED, RATE_LIMITED, CHECKPOINT and ACTION_BLOCKED (Task 15 M-4; README decision B2) | OWNER | Question: keep 500 (the build plan), or give stops a distinct status so they do not look like failures? Recommendation: a distinct 4xx. |
| O-13 | Publishing needs public HTTPS media URLs; the Instagram Login upload route is not confirmed (README decision B5) | OWNER | Question: which public host will serve the media, or is an upload route acceptable? Blocks publishing. |

### Low

| ID | Item (source) | Rec | Reason |
|---|---|---|---|
| F-28 | A second corrupt state file overwrites the first copy (Task 3 M-5) | FIX | Use a numbered copy name when `.corrupt` exists (`src/state.js` about lines 92-97). |
| F-29 | A stop-class code in a non-object error body is never read (Task 5 m-1) | FIX | Add a test that pins the status-only mapping for a non-object error body. No real Graph body is non-object. |
| F-30 | A lone surrogate is added to the registry before encoding fails, leaving a URIError after registration (ledger Task 12; `src/redact.js` registerSecret) | FIX | Check encodability before adding the value. Harmless today. |
| F-31 | A null stop detail is stored as `''`, not `'null'` (Task 4 N-2) | FIX | Store `'null'` (`src/guard.js` `detailText`). Cosmetic, but it touches the stop record. |
| F-32 | Missing tests: a malformed caps counter, a non-string stop detail, and `hashtags.perWeek` of 0 (Task 4 M-9) | FIX | Add the three tests. They guard caps and the stop record. |
| F-33 | A widened `canRefresh` false (no issue time means no refresh) is fail-closed but not documented (Task 9 re-review minor) | FIX | Add a README sentence in the token section: the token is not refreshed without an issue time. No code change. |
| F-34 | Comment and test-name corrections: `src/redact.js` comments at lines 41 and 62 (Task 2 M-4); two over-masking tests and their expectations (Task 2 M-5, M-6); a misnamed test (Task 3 M-1, Task 8 m-5); a stale comment at `src/graph/endpoints/media.js:95` (Task 6 M-6); a stale `onUsage` comment in `src/graph/client.js` (Task 5) | FIX | One batch. No behaviour change. |
| O-9 | instagrapi 3.1.0 is one day old; both challenge handlers refuse instead of being left unset (README decisions B4 and B6; Task 12) | OWNER | Question: keep 3.1.0 with the refusing handlers, or choose 3.0.26? Recommendation: keep both, and test live. |
| O-11 | Two readings the owner should confirm: a like on media needs one usage reading after each start, and private replies count toward the 50-a-day owner DM cap (Task 13 owner decisions 1 and 2; README open decisions 3 and 4) | OWNER | Question: confirm both readings. Recommendation: confirm. |
| A-1 | Redaction takes 2 to 4.6 times as long as before (Task 2 M-3) | ACCEPT | Already in README "Known limits: Redaction" (Other limits). |
| A-2 | Two keys that mask to the same text overwrite each other in the redacted copy; no value leaks (Task 2 key collisions) | ACCEPT | Already in README "Redaction", Other limits. |
| A-3 | Map and Set contents are dropped from logs (Task 2 M-8) | ACCEPT | Add to README "Redaction", Other limits. |
| A-4 | The audit read keeps non-object JSON lines and reads the whole file (Task 2 M-9, M-11) | ACCEPT | Add a line to README "Audit log, retention and secrets". |
| A-5 | Raw filesystem errors (EACCES, ENOSPC) escape `events.js` unwrapped (Task 3 M-4) | ACCEPT | No README entry. The message shows a path at most, never a secret. |
| A-6 | After a purge, a redelivery older than 30 days is stored again (Task 3 M-9) | ACCEPT | Add to README "Audit log, retention and secrets". |
| A-7 | fsync on append is checked by reading the code, not by a test (Task 3 M-3) | ACCEPT | Ledger only; not a user limit. |
| A-8 | Duplicated helpers and aliases: `isPlainObject` copies, clock wrappers, error-kind lists (Task 3 M-6; Task 4 M-5; Task 5 m-10; Task 10 M-7; Task 13 M-17; Task 15 M-7, M-8, M-12) | ACCEPT | Code hygiene for the final pass. No README entry. |
| A-9 | Whole-file reads: `eventsHoldData` at start, and `hasId` on every event (Task 4 M-4; Task 10 M-4; Task 11 m-12) | ACCEPT | Add to README "Other limits": the reads grow with 30 days of events. |
| A-10 | No size cap on Graph response bodies (Task 5 m-5) | ACCEPT | Already in README "Other limits". |
| A-11 | Test-only gaps: Retry-After 0 and a 2xx with error null (Task 5 m-6 c, d); the timer code (Task 11 m-6); DELETE options (Task 7 Minor 5); webhook GET through the handler and dedupe across a restart (Task 10 M-6); the untrusted marker asserted only on `pending` (Task 3 M-10 c) | ACCEPT | No behaviour change. No README entry. |
| A-12 | `facebook_views` is not on the insights allowlist, and the metric list is unverified (Task 6 M-2) | ACCEPT | Already in README "Still unverified". |
| A-13 | Calls with null or missing options throw TypeError, which becomes a 500 (Task 6 M-3; Task 7 Minor 4) | ACCEPT | Internal programming error. No README entry. |
| A-14 | A DELETE with an empty 2xx body counts as success, while other writes need `{success: true}` (Task 6 M-1; Task 7 Minor 1) | ACCEPT | Correct the README write rule, see Part 3 R-4. |
| A-15 | Truncation follows page length, not `paging.next`, so a short page with a next link is not flagged (Task 7 Minor 2; Task 13 N-2) | ACCEPT | Add to README "Reads and paging". |
| A-16 | A hashtag lookup that returns API_ERROR is reported as unknown, not no-match (Task 7 Minor 3) | ACCEPT | Already in README "Still unverified" (hashtag no-match shape). |
| A-17 | Business discovery is returned raw and its fields are not checked (Task 7 Minor 7) | ACCEPT | Already in README ("returns the raw object"). |
| A-18 | A dot-only id passes the local check and is refused by the client (Task 8 m-1) | ACCEPT | Refused and safe. No README entry. |
| A-19 | A timestamp a few seconds ahead of the clock makes the 24-hour check refuse until the clock catches up (Task 8 m-2) | ACCEPT | Fails closed. Add to README "Messaging windows". |
| A-20 | Identifier characters are unverified live (Task 8 m-3) | ACCEPT | Already in README "Still unverified". |
| A-21 | One malformed message fails the whole conversation read; loud and audited (Task 8 m-4) | ACCEPT | Add to README "Timestamps and identifiers". |
| A-22 | Comments and mentions share one dedupe space, so a mention whose comment is stored is skipped (Task 10 M-5) | ACCEPT | Add to README "The poller and inbound messages". |
| A-23 | `readRawBody` hangs if called on a closed request; its only caller guards it (Task 10 N-1; Task 15 M-13) | ACCEPT | Internal. No README entry. |
| A-24 | A thread that fails every tick keeps one of the poller's selection slots (Task 11 m-3) | ACCEPT | Already in README "Stops and recovery". |
| A-25 | A present non-text `created_time` or `updated_time` fails the read on every tick, and is audited (Task 11 m-8) | ACCEPT | Already in README "Timestamps and identifiers". |
| A-26 | A message stamped more than five minutes ahead is skipped and not retried, and its thread is marked read (Task 11 m-9) | ACCEPT | Add to README "The poller": keep the computer's clock in sync. |
| A-27 | `poll.maxThreadsPerTick` above 20 has no effect (Task 11 m-10) | ACCEPT | Add to README "The poller": the effective maximum is 20. |
| A-28 | A failing thread writes one audit line per tick, and `poll.seen` keys are never pruned (Task 11 m-11) | ACCEPT | Add to README "Audit log": the audit grows and is not pruned. |
| A-29 | `finish()` resets the interval as a side effect (Task 11 m-14) | ACCEPT | Nit. No README entry. |
| A-30 | The sidecar client slices its buffer quadratically on large input (Task 12 M-8) | ACCEPT | Performance. No README entry. |
| A-31 | Live-phase items for the sidecar's reply shapes (Task 12 M-10) | ACCEPT | Already in README "Still unverified". |
| A-32 | `startStdio` does not observe transport errors, so the MCP process can end without a message (Task 16 M-6) | ACCEPT | Add a sentence to README "The MCP server". |
| A-33 | HTTP-only error kinds reach MCP results as kinds in the body (Task 16 M-9) | ACCEPT | Accepted in the ledger. No change. |
| A-34 | A UTF-8 BOM in the config file gives a "not valid JSON" error (Task 1 M1) | ACCEPT | Add a line to README "Config file": save without a BOM. |
| A-35 | The tool schema has no enum for kind, decision or period; the service enforces them (Task 14 M-7) | ACCEPT | Service enforces them. No README entry. |
| A-36 | Build decisions B3 (the MCP handshake reading) and B7 (the ten-minute timeout) | ACCEPT | Not a stop, cap, secret or owner rule. Already in README "Decisions the build made". |

### Closed in code since the ledger entry (no action)

- Task 2 M-3 (string bodies): `classify()` in `src/graph/client.js` parses or rejects them.
- Task 4 M-2 (zero tag cap order): `verdictFor` checks `limit === 0` first (`src/caps.js`).
- Task 4 M-6 and M-7: Task 13 converts with `busyResult`; the remaining-window ruling stands.
- Task 6 M-5 and M-8: fixed in Task 6 round 1 (carousel minimum; tests).
- Task 7 Minors 2, 3 and 6: handled in Task 13 (d), (e) and (f).
- Task 9: the undefined-client case now throws VALIDATION; the scheduled check is wrapped (`src/cli.js` `runTokenCheck`); the exchange responses are registered (`src/oauth.js`); the 60-day TTL is in `src/service.js:44`.
- Task 10 M-8: `buildServe` passes one `now` to the webhook handler and the event log. M-9: Task 15 sets the 1 MB limit.
- Task 11 m-1, m-2 and m-13: m-13 is superseded by Task 17 I-2, which halts the poller under STATE_CORRUPT and STATE_LOST.
- Task 12 M-5: the shutdown catches the adapter close (`src/cli.js`). M-11: `test/sidecar-python.test.js` runs the Python checks.
- Task 15 M-11: Task 17 passes the audit log and the clock to the webhook handler.
- Task 16 M-1: the SDK choice is in README "The MCP server".

---

## Part 2: Security sweep

Searched `src/`, `bin/` and `sidecar/` (Python and JS). Verdict for the whole sweep: no real leak.

### Check 1: a token or secret in a URL

Searched `access_token`, `client_secret`, `owner_token`, `app_secret`, `api_token`, `webhook_verify_token` near query strings, template-string URLs and `URLSearchParams`.

- `src/graph/client.js:15` and `:58`: the refusal of an `access_token` query or form field. False positive (a guard).
- `src/graph/client.js:162` `buildUrl`: the query comes from `encodeParams`, and no token source feeds it. The token is set in the header at `:190`. False positive.
- `src/oauth.js:215`: the short-lived exchange puts `client_secret` in a POST body (`form.toString()`), with `redirect: 'error'`. Not in a URL. False positive; this is the intended design.
- `src/oauth.js:70-86`: the authorize URL carries `client_id`, `redirect_uri`, `response_type`, `scope` and `state` only. False positive.
- `src/oauth.js:9`, `:242`, `:249`: comments describing refused flows. False positive.
- `src/mcp.js:72`: the forward URL uses the port and an encoded tool name. The token is in the header at `:79`. False positive.
- `src/cli.js:167` and `:350`: `/health` and `/tools/ig_status` URLs. The token is in the header (`cli.js:349`). False positive.
- `src/token.js:73`: the refresh GET sends `grant_type` only; the token is in the header. False positive.
- `src/webhooks.js:68` and `:208`: `hub.verify_token` is read from Meta's inbound query. We never build that URL, and it is not logged. False positive.

Verdict: none.

### Check 2: a secret written to a log, audit line, error or console

Sinks checked: `audit.record` (every call site), `IgError` messages, stop details, warnings and CLI output.

- Audit lines: `src/audit.js` `record()` redacts the whole line. Every call site passes codes, kinds, ids or a fixed text. For example `src/service.js:268`, `:437`, `:442`, `:488`, `:494`; `src/poller.js:158-199`; `src/webhooks.js:239-279`. `src/webhooks.js:110` records the flag name, not its value. False positive.
- `IgError` messages: `src/errors.js:30` redacts the message and details in the constructor. `src/errors.js:62-70` (`mapGraphError`) keeps Graph's `error.message` text, which is redacted by the constructor and again by the HTTP and MCP output. Known limit: the regex layer (O-2, README "Redaction").
- Stop details: `src/service.js:109-115` and `src/poller.js:60-63` carry status, code and kind only. False positive.
- Warnings: `src/http.js:123`, `src/poller.js:318`, `src/service.js:268` emit names only. False positive.
- CLI output: `src/cli.js:59-60` and `bin/ig.js:31-32` pass through `redact`. The printed lines at `cli.js:186`, `:242`, `:283`, `:377` carry names, expiry times or redacted results. `cli.js:217` prints the authorize URL, which holds `client_id`, `redirect_uri` and a one-time `state` nonce; none of these is a secret. False positive.
- `src/oauth.js:112`: prints the first 64 characters of the redirect's `error` parameter, which the owner's own browser sent. Not a secret. False positive.
- Sidecar: `sidecar/ig_sidecar.py:226-233` (`_safe_message`) removes the request's secret params before returning text. `:12-13` and `:283` log only the method and the kind. The JS side passes the last stderr line through `redact` (`src/unofficial/sidecar.js`). False positive; the unregistered-form limit is O-2.
- Inbound text and decision drafts: `src/events.js:261` and `:336` mask exact registered values only. Known limit (O-2; README gap R-12).

Verdict: no real leak. Known limits only: O-2.

### Check 3: console or stdout on the MCP path

Searched `console.*`, `process.stdout.write`, `process.stderr.write`, `emitWarning` and `print(` in `src/`, `bin/` and `sidecar/`.

- Hits: `src/cli.js:59` (`log`, stdout) and `bin/ig.js:31` (`say`, stdout). Neither runs for `ig mcp`. The `mcp` action calls `runMcp` (`src/cli.js:382-391`), which builds the forwarder and calls `startStdio`.
- `src/mcp.js` imports only `errors.js`, `redact.js`, `tools.js` and the SDK. None of them writes to stdout. The only stdout on that path is the SDK transport.
- `sidecar/ig_sidecar.py` has no `print` call and redirects `sys.stdout` to stderr (`:283-285`).
- No module writes to stdout at import time.

Verdict: none. No Critical finding.

### Check 4: a secret read from the environment without registration

`process.env` and `env[...]` reads:

- `src/config.js:103`: `IG_GRAPH_VERSION` and `IG_APP_ID`. Not secrets.
- `src/cli.js:70`: `IG_CONFIG`, a path. Not a secret.
- `src/cli.js:421`: `IG_PYTHON`, the sidecar command. Not a secret. Not documented in the README (R-5).
- `src/secrets.js:83`: `IG_<NAME>` secrets. Each value is registered before return at `secrets.js:89`, `:103` and `:126`.
- `src/unofficial/sidecar.js:68-74`: copies every environment variable except `IG_*` into the Python child. Nothing is read or logged, so this is not a leak. It is a hardening gap (F-23).

Verdict: no secret read without registration. One hardening finding (F-23).

### Check 5: a bind to 0.0.0.0 or all interfaces by default

Searched `listen(` and host defaults.

- `src/http.js:354`: `server.listen(binding.port, binding.host)`. The host is validated in `buildContext`. The default is `127.0.0.1` (`src/http.js:24`, `src/config.js:62`).
- `src/oauth.js:173`: `server.listen(port, LOOPBACK)`, with `LOOPBACK` set to `127.0.0.1` (`src/oauth.js:28`).
- No default is `0.0.0.0` or `::`. `src/cli.js:322` maps those to `127.0.0.1` for the probe.
- A non-loopback host needs `api_token`, and serve refuses without it (`src/cli.js:99-107`; `buildContext`).
- Known limit: a direct `server.listen` on the `createHttpServer` output bypasses the check (F-17, K-2 ruling).

Verdict: no finding by default. The direct-listen path is F-17.

### Summary

- Real security leaks: 0.
- Known limits in the ledger that the sweep reconfirmed: the regex layer (O-2) and the direct-listen path (F-17).
- Hardening found by the sweep and not in the ledger: the sidecar environment passthrough (F-23), the undocumented `IG_PYTHON` (R-5), and the auto-reply confirm (O-12).

---

## Part 3: README against code

### Checked and matching

- Caps (`src/config.js:21-34` `DEFAULT_CAPS`): 2000 ms spacing, 200 a day, likes 10 an hour and 50 a day, follows 20 a day, unfollows 20 a day, owner DMs 50 a day, private replies 7 days, auto-replies 1 per 24 hours and 100 a day, publishing 10 a day, hashtags 30 per 7 days, usage throttle 80 and 60000 ms. All match README "Caps". The caps logic (`src/caps.js`) matches each row.
- Tools (`src/tools.js`): 36 tools. Fourteen take `confirm`, matching README. The destructive set is `ig_stop_clear`, `ig_events_purge`, `ig_comment_hide`, `ig_comment_delete` and `ig_media_delete`, matching README. `ig_dm_mark_read` and `ig_hashtag_search` have no `readOnly` flag and are annotated `readOnlyHint: false`, as README says. The other status and read tools are read-only.
- 24-hour DM window: `messageWindowOpen` (`src/graph/endpoints/messaging.js:208-211`) is open below 24 hours. `requireOpenWindow` (`src/service.js:316-321`) counts only `kind: 'message'`, so comments and mentions do not open it. The check runs before any request. Matches README "Messaging windows".
- 7-day private reply: `privateReplyOpen` uses `WEEK_MS` (`messaging.js:12`, `:216-218`). Matches "within 7 days". Boundary note: the code refuses at exactly 7 days, while the constraint says "more than 7 days". The code is one instant stricter and fails closed. No README change needed.
- Stop kinds: `STOP_KINDS`, `SHOULD_STOP` and `STOP_RANK` (`src/guard.js:13-32`) match README "The stop state": AUTH_EXPIRED, CHECKPOINT and ACTION_BLOCKED at rank 3, RATE_LIMITED at 2, STATE_LOST and STATE_CORRUPT at 1. The read-stop set in `src/service.js` (`READ_STOP_KINDS`) matches the three kinds.
- Poller halt: `HALTING` (`src/poller.js:19`) is AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, STATE_CORRUPT and STATE_LOST. RATE_LIMITED backs off, doubling up to `MAX_BACKOFF_MS` (10 minutes, `poller.js:12`). Matches README.
- Port and loopback: the default port is 8788 (`src/config.js:62`, `src/http.js:21`). The default host is `127.0.0.1` (`src/config.js:62`, `src/http.js:24`). Matches README lines 74 and 88.
- Pins: `package.json` pins `@modelcontextprotocol/server` 2.3.1, `@napi-rs/keyring` 2.1.2 and `commander` 15.0.0 exactly, with engines `>=22.12.0`. `sidecar/requirements.txt` pins `instagrapi==3.1.0`. Matches README.
- Timing and pages: poll 60000 ms, 20 threads, 600 ms spacing, conversations page 100, messages page 20, comments page 25, owned media 100, insights periods `day` and `lifetime`, video polling 5000 ms by 60, 600000 ms call timeout. Matches README.
- Not re-run: the test counts in README "Test status" (the suite is 730/730 per the brief).

### Mismatches

Wrong statements (5):

- R-1. README line 105 says "Outbound calls wait 60 seconds". The code returns busy with `retryAfterMs` 60000 (`src/service.js` `usageHold`, about lines 303-313) and nothing waits or queues. README should say: "When the reading is 80 or more, outbound calls return busy for 60 seconds. Nothing waits or queues."
- R-2. README line 102 says the auto-reply cap is "1 per conversation per 24 hours". The code keys it by sender (`src/caps.js:104-111`, `perSender: true`). README should say "1 per sender (person) per 24 hours", as line 146 already does.
- R-3. README lines 139 and 342 describe the first-100 owned-media check for comment actions only. The code also applies it to `ig_media_get` (`src/service.js:604`), `ig_insights_media` (`:616`), `ig_comments_list` (`:632`) and `ig_media_delete` (`:871`), and to private replies through `ownedParentOf` (`:754-811`). README should list all of them, and say that media outside the first 100 owned media is refused with a reason.
- R-4. README line 362 says a write whose reply is not `{success: true}` returns API_ERROR. `mediaDelete` accepts an empty 2xx body as success (`src/graph/endpoints/media.js:225`). README should say: "A DELETE with an empty success body counts as success. Other writes need `{success: true}`."
- R-5. README line 51 says "These two are the only environment overrides for settings that are not secrets." The code also reads `IG_CONFIG` (`src/cli.js:70`, documented at line 55) and `IG_PYTHON` (`src/cli.js:421`, the sidecar command, not documented). README should list `IG_GRAPH_VERSION`, `IG_APP_ID`, `IG_CONFIG` and `IG_PYTHON`, and say what each sets.

Omissions (9): the code or the global constraints have a rule that README does not state.

- R-6. Busy results over HTTP are status 429 with the busy body (`src/http.js`, `serveTool`). This is in the global constraints. README "Busy results" should add: "Over the HTTP API, a busy result is status 429 with the same body. Over MCP it is an ordinary result."
- R-7. The DM text limit of 1000 UTF-8 bytes is not in README (`src/graph/endpoints/messaging.js:10`, `:44-46`; `src/service.js:45`). README "Messaging windows" should add it, and say the check happens before any request.
- R-8. The HTTP Host rule applies to every route, and POST `/tools/:name` needs a Bearer token (`src/http.js` `route`, `hostAllowed`, `serveTool`). README mentions the Host rule only for the webhook (line 228). README should add an "HTTP API" section: the Host must be `127.0.0.1` or `localhost` (or an `http.allowedHosts` entry) with a port, and tool calls need `Authorization: Bearer <api_token>`.
- R-9. A non-loopback `http.host` needs `api_token`, and `ig serve` refuses to start without it (`src/cli.js:99-107`; `src/http.js` `buildContext`). README's `ig serve` row and its Secrets section should say it.
- R-10. Auto-replies send with `confirm: true` set in code (`src/service.js:474`). README "Confirmation" should say: "Once the owner turns auto-replies on, each reply is sent without a per-message confirm. The caps and the 24-hour window still apply." This is also O-12.
- R-11. The sidecar child receives every environment variable except `IG_*` (`src/unofficial/sidecar.js:68-74`). README "Device identity" should say it. F-23 changes this.
- R-12. Inbound message text and decision drafts are masked by exact registered value only (`src/events.js:261`, `:336`), not by the pattern layer. README "Redaction" should say so.
- R-13. README line 58 lists `http` among the config sections without its defaults. README should give them: host `127.0.0.1`, port 8788, `allowedHosts` `127.0.0.1` and `localhost` (`src/config.js:62`).
- R-14. README does not describe the `autoReply.rules` shape: each rule needs a non-blank `keyword` and `reply`, and a reply is at most 1000 bytes (`src/service.js` `checkRules`, about lines 137-150). README "Config file" should describe it.

Total: 14 mismatches (5 wrong statements, 9 omissions).

---

## For the owner

These need your decision. Each is one question; the table above has the recommendation.

1. Keep the CHECKPOINT text match broad (fails closed, can stop on an unrelated message), or narrow it once the live error shape is known (O-1)?
2. Accept free-text redaction as best effort, with exact-value registration as the real control, or require stricter output (O-2)?
3. If the state file is damaged, should the service refuse to start (current), or start stopped and keep reads running (O-3)?
4. Should business discovery and mentioned-media lookups get a daily limit, or stay manual with no limit (O-4)?
5. After a send fails before Instagram accepts it, may the private reply or auto-reply be retried, or stay blocked (O-5)?
6. Should the hourly token refresh pause while a CHECKPOINT or ACTION_BLOCKED stop holds (O-6)?
7. How should the long-lived owner token be obtained, given that Meta's method puts it in a URL? Owner login is blocked until this is decided (O-7).
8. Facebook Login returns its token in a redirect fragment. Accept a flow that keeps the token out of stored or logged URLs, or drop hashtag search, business discovery and media delete (O-8)?
9. Keep instagrapi 3.1.0 (one day old) and the refusing challenge handlers, or choose 3.0.26 (O-9)?
10. Should HTTP stop codes stay 500, or get their own status so a stop does not look like a failure (O-10)?
11. Confirm two readings: a like on media needs a usage reading after each start, and private replies count toward the 50-a-day owner DM cap (O-11).
12. Is turning auto-replies on (with confirm) your consent for each automatic reply inside the caps and the 24-hour window? README should say so either way (O-12).
13. Which public HTTPS host will serve media for publishing, or is an upload route acceptable (O-13)?
