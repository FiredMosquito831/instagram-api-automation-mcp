# Final fix round: report

Date: 2026-10-22. Status: DONE_WITH_CONCERNS (the concerns are in section 6).

Scope: the 34 FIX items of final-review.md, the README mismatches R-1 to R-14, the ACCEPT items, and the OWNER items, which were left as they are. No git, no commit, no package installed, and the `test` script in package.json is unchanged. The session crashed once during the round; the round resumed from the transcript and the code, and every FIX item was checked (by grep and by test name) before work went on.

## 1. Test counts

| Run | Command | Node | tests | pass | fail | cancelled | exit |
|---|---|---|---|---|---|---|---|
| Final, Node 24 | `npm test` | v24.6.0 | 764 | 764 | 0 | 0 | 0 |
| Final, Node 22 | `npm test`, with the Node 22.13.1 binary first on PATH (the method in task-18-report.md) | v22.13.1 | 764 | 764 | 0 | 0 | 0 |

- Before the round the suite had 730 tests (730 of 730 on Node 24). The round added 34.
- The Node 22 run used `PATH="%USERPROFILE%/AppData/Local/ms-playwright-go/1.50.1:$PATH"`. `node --version` under that PATH printed v22.13.1, and `npm` is the global npm, which runs under that node. Node 22 prints TAP, so its totals are the `# tests 764` lines.
- No test makes a network call or opens a socket. The new HTTP and OAuth tests stub `Server.prototype.listen` or use a fake server.

## 2. node bin/ig.js --help (exit 0)

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

## 3. FIX items: status, location, test

FIX items NOT FIXED: 0 of 34.

| ID | Status | File and line | Test |
|---|---|---|---|
| F-1 | FIXED | src/guard.js:128 (`auditHoldsData`), :179 (STATE_LOST also on audit evidence); src/cli.js:453 (`auditFile: files.audit`) | guard.test.js "STATE_LOST: a deleted state file with audit lines and no events file..."; "an audit file with only white space..."; "createGuard refuses an audit path that is blank"; cli.test.js "buildServe starts stopped with STATE_LOST..." |
| F-2 | FIXED | src/service.js:717 (hashtagSearch: `guard.assertNotStopped()` before `caps.check`; one audit line per counted search) | service.test.js "a hashtag search is refused while a stop holds..."; "a counted hashtag search has one audit line..." |
| F-3 | FIXED | src/poller.js:134 (`isHalted` follows the stored stop, so a non-halting stop releases the halt); :256 (guard asked before each thread) | poller.test.js "a halting stop stored during one thread..."; "a halt does not outlast its stop..."; "a stored STATE_LOST or STATE_CORRUPT halts..."; "a RATE_LIMITED from one thread backs the poller off..." |
| F-4 | FIXED (already in the code; verified, no change this round) | src/state.js:158 (`save()` restores the last saved image when the write fails) | state.test.js "a failed save restores memory to the last saved image" (existing; pins it) |
| F-5 | FIXED, narrowed (see 6.1) | src/service.js:450 (early `caps.check`, and the usage hold on a known high reading, before any read); the authoritative block after the reads is unchanged | service.test.js "a call that the caps refuse makes no Graph read (F-5)"; "a known high usage reading refuses an outbound call before any read (F-5)" |
| F-6 | FIXED | src/caps.js:242 (`record` re-runs `verdictOf`, throws CAP_EXCEEDED) | caps.test.js "record refuses a count over a limit with CAP_EXCEEDED, and saves nothing (F-6)" |
| F-7 | FIXED | src/config.js:21-33 (`perCommentDays` removed from DEFAULT_CAPS; the cap check refuses the key) | config.test.js "caps.privateReplies is not a known cap..."; "DEFAULT_CAPS is exactly the caps in the brief" updated |
| F-8 | FIXED | src/config.js:149 (`checkSections`, a type check per section); src/cli.js:486 and :592 (`webhook.enabled === true`) | config.test.js "webhook.enabled must be a real boolean..."; "the other config sections are type-checked..." |
| F-9 | FIXED | src/config.js:125 (digits after trim; the trimmed id is stored) | config.test.js "owner.igUserId must hold only digits after trimming..." |
| F-10 | FIXED | src/config.js:133 (`refuseProtoKeys`, before the merge) | config.test.js "a __proto__ key in the file is refused..." (replaces the old test that expected it to be ignored) |
| F-11 | FIXED | sidecar/ig_sidecar.py:39 (`ProxyAddressIsBlocked` maps to `action_blocked`); README live row kept as a live item | sidecar-python.test.js "python names: map_exception_kind maps the class names..." (now includes ProxyAddressIsBlocked). The brief's check printed `rate_limited` and exited 0 |
| F-12 | FIXED | src/graph/client.js:110 (`recordUsage`: try/catch around onUsage; a warning with no detail) | graph-client.test.js "a throwing onUsage does not turn an accepted write into an error (F-12)" |
| F-13 | FIXED | src/token.js:75 (refuses any loginProduct other than instagram, before any request); src/service.js (tokenRefresh passes `loginProduct: 'instagram'`) | token.test.js "refreshToken refuses a client that is not Instagram Login, before any request (F-13)"; "refreshToken with an Instagram Login client still refreshes (F-13)" |
| F-14 | FIXED | src/secrets.js:12 (NAME_PATTERN has no dash or dot); `envName` | secrets.test.js "names map to IG_ variables, and a name with a dash or a dot is refused (F-14)" |
| F-15 | FIXED | test/token.test.js (the refresh-and-scan test writes the audit, state and events files in the data directory, and scans them) | token.test.js "tokens are never written to a file" (asserts each data file is in the scan) |
| F-16 | FIXED | src/errors.js:65 (`userText`: stop phrases are read from the message and from error_user_title and error_user_msg) | errors.test.js "a stop phrase in Graph's user-facing error fields maps to its stop kind (F-16)" |
| F-17 | FIXED | src/http.js:341 (`requestHandlerForTests` replaces the serving export); :352 (a server's own `listen` refuses any start that does not come from `listenHttp`) | http.test.js "a direct listen on a server from createHttpServer is refused, and listenHttp starts it on its binding (F-17)" |
| F-18 | FIXED | src/http.js:151 (bracket strip, then trim) | http.test.js "a host of "[ ]" is refused at construction as an empty host (F-18)" |
| F-19 | FIXED | src/oauth.js:139 (a callback with a wrong or missing state gets 400 and the login keeps waiting); `listenForRedirect` passes expectedState | oauth.test.js "a callback with the wrong or no state gets 400..." |
| F-20 | FIXED (the error listener was already in the code; the test is new) | src/oauth.js:177 | oauth.test.js "an error from the redirect server after it is listening ends the login with CONFIG (F-20)" |
| F-21 | FIXED | src/cli.js:196 (`acquireServeLock`), with `readServeLock` and `releaseServeLock`; startServe takes the lock before any Graph call and releases it on a failed start and at shutdown; `runAuthLogin` and `runRoutesAck` check the lock instead of the probe | cli.test.js "a live serve lock refuses auth login before any listener..."; "a serve lock whose process is gone is stale..."; "acquire refuses a live lock..."; "release removes only a lock that holds this process id"; "a serve start that fails before it listens removes the lock it took" |
| F-22 | FIXED | src/service.js:97 (`errorName` reads `err.name` inside try) | service.test.js "a name getter that throws does not turn a successful search into an error (F-22)" |
| F-23 | FIXED | src/unofficial/sidecar.js:91 (`childEnvironment` is an allowlist; names compared without case) | sidecar.test.js "the child starts on first use, and it is given only the allowlisted variables" (the fixture env mode now lists every name the child sees) |
| F-24 | FIXED | src/service.js:165 (`createUsageHolder`); the service object no longer has `recordUsage`; src/cli.js buildServe makes the holder and passes it to the service, the poller and the owner check | service.test.js "the service object does not expose the usage callback, and a holder keeps what it records (F-24)" |
| F-25 | FIXED | src/service.js:315 (only business and creator pass) | service.test.js "an official feature is refused for an account type other than business or creator (F-25)" |
| F-26 | FIXED | src/service.js:930 and the other two unofficial performs (the adapter is resolved inside perform) | service.test.js "a preview of an unofficial feature with no adapter mapped is a preview, not NOT_SUPPORTED (F-26)" |
| F-27 | FIXED (README) | README "The owner check" (comment-action bullet) and "Reads and paging" (owned media) | README text; the same change as R-3 |
| F-28 | FIXED | src/state.js:88 (`corruptCopyName`: .corrupt, then .corrupt.1, and so on) | state.test.js "a second corrupt state file is copied to a numbered name, and the first copy is kept (F-28)" |
| F-29 | FIXED (pins existing behaviour; no code change) | src/errors.js (mapGraphError unchanged) | errors.test.js "a non-object error body maps by HTTP status alone (F-29)" |
| F-30 | FIXED | src/redact.js:191 (the encoded form is made before the value is added); src/unofficial/sidecar.js:57 (a session string that cannot be encoded is refused, not skipped) | errors.test.js "registerSecret refuses a value with a lone surrogate, before it is added to the registry (F-30)" |
| F-31 | FIXED | src/guard.js:76 (a null detail is stored as 'null') | guard.test.js "a null stop detail is stored as the text null, and a missing one as empty text (F-31)" |
| F-32 | FIXED | three tests: caps.test.js "a malformed caps counter..." and "a zero hashtag limit refuses the first tag..."; guard.test.js "a stop detail that cannot be converted to text..." (the non-string case is also the existing guard test "a non-string stop detail is recorded as text") | the three named tests |
| F-33 | FIXED (README) | README "The app secret and the login", the token refresh bullet | README text |
| F-34 | FIXED | comments: src/redact.js:41 and :62; src/graph/client.js:154 (onUsage); src/graph/endpoints/media.js:96. Tests renamed: errors.test.js (the two round-4 names, now with the over-masking described in a comment; the expectations are unchanged); events.test.js:162 and :173 (the damaged-line test, plus a damaged-then-valid case); endpoints-messaging.test.js:278 | the renamed tests |

## 4. README items

| Item | Status | Where in README |
|---|---|---|
| R-1 | DONE | Caps table, usage throttle row: busy for 60 seconds, nothing waits or queues |
| R-2 | DONE | Caps table, auto-replies row: 1 per sender (person) per 24 hours |
| R-3 | DONE | Confirmation and owner check (comment actions, private replies, the first 100 owned media for every owner check); Reads and paging, owned media |
| R-4 | DONE | Writes and retries: a DELETE with an empty success body counts as success; other writes need `{success: true}` |
| R-5 | DONE | App id and Graph version: the four environment variables that are not secrets |
| R-6 | DONE | Busy results (HTTP 429 with the same body; ordinary result over MCP); new section The HTTP API |
| R-7 | DONE | Messaging windows: 1000 UTF-8 bytes, checked before any request |
| R-8 | DONE | New section The HTTP API: the Host rule for every route, and Bearer for POST /tools |
| R-9 | DONE | ig serve command row, and the api_token row of the secrets table |
| R-10 | DONE | Confirmation: auto-replies are sent without a per-message confirm once turned on (describes current behaviour; the code is unchanged, see section 5) |
| R-11 | DONE | Device identity: the sidecar's environment allowlist |
| R-12 | DONE | Redaction: inbound text and decision drafts are masked by exact value only |
| R-13 | DONE | Config file: the section defaults, including http |
| R-14 | DONE | Config file: the autoReply.rules shape |
| F-11 live row | DONE | Sidecar stop mapping row: ProxyAddressIsBlocked maps to ACTION_BLOCKED; still a live item |
| Also updated, because the FIX items made them wrong | DONE | Secret name rule (was a known limit); config type checks (was a known limit); serve lock (was a probe); STATE_LOST evidence; stop text fields; hashtag search; the usage-hold order; direct listen; the Test status section (the final counts) |

## 5. ACCEPT items (36)

- Already in the README, not repeated (9): A-1, A-2, A-10, A-16, A-17, A-20, A-24, A-25, A-36.
- Covered by R-4 (1): A-14.
- Added as one line each under Known limits, "Accepted in the final review" (26): A-3, A-4, A-5, A-6, A-7, A-8, A-9, A-11, A-12, A-13, A-15, A-18, A-19, A-21, A-22, A-23, A-26, A-27, A-28, A-29, A-30, A-31, A-32, A-33, A-34, A-35. The triage marked several of these "no README entry" or "ledger only"; they were added because the round brief asks for each ACCEPT item to be in the README.

## 5a. OWNER items: left alone (13)

O-1 to O-13 were not decided or changed. Their code paths were checked against the round-start snapshot: the status map for HTTP (O-10), the long-lived exchange and the fragment refusal (O-7, O-8), the auto-reply `confirm: true` (O-12), the stop record read and the stop setting (O-3, O-6), the rate-limit codes, the usage hold, DEFAULT_CAPS apart from the removed key, and the sidecar pin `instagrapi==3.1.0` (O-9) are all unchanged. The README now describes the current O-12 behaviour (R-10), as R-10 requires; no code changed.

## 6. Concerns and deviations

1. F-5: the early check refuses on the usage reading only when it is known and high. With no reading yet, the owner and quota reads still run, because they are what produce a reading. The first version refused on "no reading" too, and that blocked the first outbound call; the test suite caught it. The cap check is fully early.
2. F-2: the audit line is written for each counted search, after `caps.record`, on success and on error. A busy search records no line. The triage's "safeAudit before caps.check" was read this way on purpose.
3. F-26: a confirmed call for an unmapped unofficial feature now counts toward that feature's cap, and then returns NOT_SUPPORTED with no request. The count-before-perform order is the existing fail-closed order.
4. F-1: a deployment with audit lines, but with no stop ever saved and no events.lastSeq in the state, starts STATE_LOST once. The owner clears it. This is fail-closed, and it is noted in the README.
5. F-21: the probe is removed. The lock is taken in startServe, before verifyOwner, not in buildServe. `ig serve` also refuses while another live lock is in the same data directory. The lock covers only the same data directory.
6. F-23: the allowlist drops APPDATA, LOCALAPPDATA and the proxy variables (HTTP_PROXY, HTTPS_PROXY, NO_PROXY). The sidecar will not use an environment proxy, and it will not find a per-user (APPDATA) instagrapi install. Both are live-phase checks. The README lists the allowlist.
7. F-11: the stop class for ProxyAddressIsBlocked is ACTION_BLOCKED. The triage did not name a class; this is my choice. The live row keeps it as a live item.
8. F-16: the field names error_user_msg and error_user_title are unverified, as the triage says. The stop-phrase match now reads these fields too, which widens the O-1 CHECKPOINT match. O-1 itself is unchanged.
9. F-12: if onUsage throws, that reading is not recorded (a warning is emitted), so the usage gate keeps the previous reading until the next response.
10. F-30: a sidecar session string that cannot be encoded is now refused as UNOFFICIAL_ADAPTER_ERROR. Before this change, the VALIDATION skip in the sidecar would have returned it unmasked.
11. F-17: `createRequestHandler` is renamed to `requestHandlerForTests`, so no serving export remains. A direct listen is refused, not documented as a limit.
12. F-9: a padded owner id is accepted once trimmed, and stored trimmed. The triage says "after trim", and this follows it.
13. F-4: no code change. The rollback that the triage describes as missing is present (state.js:158), and the existing test pins it. I did not add a second test.
14. F-3: the existing test "a RATE_LIMITED observed under a stored CHECKPOINT..." moved its CHECKPOINT hook from the newer thread to the failing older thread, because the per-thread check now stops the tick before the older thread. Its assertions are unchanged.
15. Other existing tests changed to fit the new behaviour: the second private reply advances the clock by the spacing, so the one-reply-per-comment refusal is what is tested; the caps-order log now shows the early check; the sidecar env test allows the seven system variables that Node adds on Windows (probed on Node 24.6.0); the fixture env mode lists every name; the config proto test now expects a refusal; the refreshToken tests pass `loginProduct`; the probe tests in cli.test.js were replaced by lock tests (the IPv6 status test stays).
16. F-29 and F-20 test pinned existing code; no behaviour changed for them.

## 7. Not done

- The live phase. This round changes no live path; the live items are unchanged except the F-11 row and the F-16 field names.
- A run on Node 22.12.0 exactly. The round used 22.13.1, as task-18-report.md did.
