# Task 18 report: verification and owner notes

Status: DONE_WITH_CONCERNS.

Test summary (npm test, all four required runs): Node 24.6.0 runs 1 to 3 each 730 of 730 passing, 0 cancelled, exit 0; Node 22.13.1 run 730 of 730 passing, 0 cancelled, exit 0.

Changes since the first report: two test-side fixes (test/mcp.test.js for the Node 22 cancellations, test/sidecar.test.js for the Node 24 sidecar failures), and the Python check now runs without `-I`. No file under src/, bin/ or sidecar/ changed. No package was installed into the project, and no git or commit action was taken.

Scratch outputs are in D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\ (final-node24-run1.txt, final-node24-run2.txt, final-node24-run3.txt, final-node22.txt, final-node24-loaded.txt, fix-npm-test-node22.txt, py-import-noI-final.txt, child-start-timing.mjs, abort-timeout-probe.mjs, instagrapi-3.1.0.json and others).

## Final test runs

| Run | Command | Node | tests | pass | fail | cancelled | exit |
|---|---|---|---|---|---|---|---|
| 1 | `npm test` | v24.6.0 | 730 | 730 | 0 | 0 | 0 |
| 2 | `npm test` | v24.6.0 | 730 | 730 | 0 | 0 | 0 |
| 3 | `npm test` | v24.6.0 | 730 | 730 | 0 | 0 | 0 |
| 4 | `npm test` | v22.13.1 | 730 | 730 | 0 | 0 | 0 |
| extra | `npm test` with 15 CPU-bound node processes running | v24.6.0 | 730 | 730 | 0 | 0 | 0 |

- Run 4 put the Node 22.13.1 binary (C:\Users\fgghk\AppData\Local\ms-playwright-go\1.50.1\node.exe) first on PATH, so `npm` and the tests both ran on it. `node --version` printed v22.13.1 in that shell.
- Machine CPU before the runs: 13%, 19% and 23% for runs 1 to 3. With the burners running, CPU was 79%. No burner process was left running afterwards.
- The extra run is supplementary evidence for the sidecar fix. It is not one of the four required runs.

## Fix 1: Node 22 cancellations in test/mcp.test.js

**Cause.** The three tests that wait on a forward timeout (`a write that times out ...`, `a read that times out ...`, `a body that does not finish before the timeout ...`) wait on a fetch that never answers. The production timeout is `AbortSignal.timeout`. A standalone probe (scratchpad abort-timeout-probe.mjs) showed that the signal's timer does not keep Node alive: `AbortSignal.timeout(50)` never fired on Node 22.13.1 or Node 24.6.0, and the process exited with 0. So on Node 22 the process ended while those tests were pending. node:test then cancelled them, and every later test in the file, which gave the 11 cancelled tests (not ok 437 to 447).

**Fix (test side only).** Added a helper `holdLoop(run)` to test/mcp.test.js. It creates a referenced `setTimeout` with a 5000 ms delay before the test body runs, and clears it in `finally`. The three timeout tests now run inside `holdLoop`. The production code (src/mcp.js and `AbortSignal.timeout`) is unchanged.

**Result.** Node 22.13.1: 730 of 730 pass, 0 cancelled, exit 0 (run 4 above).

## Fix 2: sidecar failures on Node 24 under parallel load

**Symptom.** In a full `npm test` on Node 24.6.0, four tests in test/sidecar.test.js failed, each after about 5 s:

- `the child starts on first use, and IG_ variables are not passed to it` (5019 ms)
- `a login reply registers its session strings before the caller sees them` (5036 ms)
- `a restore reply registers its session strings too` (5031 ms)
- `a session string with a trailing newline is returned trimmed, and its bare value is masked` (5023 ms)

A second loaded run failed `ok:true with an object result resolves` at 5033 ms. The same file passed on the first run, where these tests took 130 to 200 ms. In the failing run, passing sidecar tests also took 2.9 to 4.3 s (for example 3840 ms and 3786 ms). So the failures sat on the edge of the limit, not in the test logic.

**Hypotheses checked.**

- *A fixed port shared between tests.* Not the cause. The sidecar tests and the fixture use stdio pipes only. A search of test/sidecar.test.js and test/fixtures/fake-sidecar.js for listen, port, 8788, 8789, 8790 found no listener.
- *A fixed temp path shared between tests.* Not the cause. The same search for tmpdir, mkdtemp, mkdir, writeFile and state paths found nothing in these files. Each test starts its own fixture child, and no file is shared.
- *A timeout too tight for a child process.* The cause. The adapter's timer starts with the first request and covers the child's whole start: spawning Node, loading the fixture, and the first reply. The sidecar tests used `LIMIT_MS = 5000` as the default `timeoutMs` in `fixtureAdapter`.

**Evidence of child start time** (scratchpad child-start-timing.mjs, which times the first reply from a fresh fixture child the way the tests do):

| Condition | n | min | median | max |
|---|---|---|---|---|
| Quiet, children one after another | 10 | 69 ms | 70 ms | 71 ms |
| Loaded: 15 CPU-bound node processes, 3 rounds of 15 concurrent children | 45 | 3279 ms | 6517 ms | 16149 ms |

The 5 s budget is below the median under load and far below the worst case. The machine was busy during the failing runs: 98% CPU at the start of the first failing run. It also has 86 background node processes, including MCP servers, plus a Python proxy.

**Fix.** In test/sidecar.test.js:

- Added `const CHILD_MS = 30000;` with a comment that gives the reason: the measured start under load, and the margin.
- Changed the default of `fixtureAdapter` from `LIMIT_MS` to `CHILD_MS`.

The production default (`timeoutMs = 20000` in src/unofficial/sidecar.js) is unchanged. The only test that passes its own timeout is `timeout kills the child and rejects with UNOFFICIAL_ADAPTER_ERROR` (200 ms). That test needs the timeout to fire, so it keeps its value. `LIMIT_MS` (5000) is kept for `waitUntilGone`, which only sets a deadline for a killed child to exit, and for the missing-command test, which fails at spawn. Neither has failed in any run, so neither was changed.

**Margin.** 30 s is about twice the worst start measured under the synthetic load (16.1 s). That is a judgement, not a bound: a heavier load could still exceed it.

**Result.** The sidecar file alone: 26 of 26 pass. Full suite on Node 24.6.0: 730 of 730 in runs 1 to 3, and 730 of 730 with the 15 CPU burners running.

## Python check (drop -I)

- Command: `python -B -c "import sidecar.ig_sidecar as s; print(s.map_exception_kind('ClientThrottledError'))"`, run from D:\Projects2\InstagramApi.
- Output: `rate_limited`. Exit code 0.
- `-B` keeps the check from writing `sidecar/__pycache__`. Check: the folder did not exist before the run, and did not exist after it. Control: the same import without `-B` creates `sidecar/__pycache__`, which I then removed.
- `-I` is not used. It removes the current directory from sys.path, so the import fails with `ModuleNotFoundError: No module named 'sidecar'`. That earlier result (exit 1) is recorded for the record.
- `python -I -B -m py_compile sidecar/ig_sidecar.py` was run earlier and exited 0. `py_compile` writes its cache file even with `-B`; that cache was removed.

## Step results (first pass, still valid)

### Step 1: npm test

First run before the fixes: 730 tests, 730 pass, exit 0 on Node 24.6.0. The final runs are in the table above.

### Step 2: node bin/ig.js --help

Exit 0. The output lists `auth`, `serve`, `mcp`, `status`, `routes` and `help`. `auth` has `set`, `login` and `facebook`. `routes` has `ack-unofficial`.

### Step 3: Python checks

See the Python section above. The earlier `-I` import (exit 1) and the variant with the project root inserted (exit 0) are superseded by the `-B` command.

### Step 4: Node 22

Node 22.13.1 is a standalone runtime found at C:\Users\fgghk\AppData\Local\ms-playwright-go\1.50.1\node.exe (the runtime bundled with a Playwright install). No other Node 22 was found on the machine, and none was installed. It meets `>=22.12.0`. Node 22.12.0 exactly was not run. Final result: 730 of 730, 0 cancelled, exit 0.

### Extra check: bin-based MCP protocol check (ledger ruling e)

Script: scratchpad task17-mcp-check.mjs, which spawns `node bin/ig.js --config <fixture> mcp` with fake tokens, once per protocol era. Result: PASS on all five checks. `initialize` (2025-11-25) negotiated 2025-11-25. `server/discover` advertises 2026-07-28. `tools/list` returns 36 in both runs. stdout holds only JSON-RPC frames. Both children exited 0, with empty stderr. The check created no data directory.

### Extra check: instagrapi 3.1.0 metadata

From the PyPI JSON endpoint (scratchpad instagrapi-3.1.0.json): `info.license_expression` is `MIT`. The `info.license` field is empty, and no license classifier is listed. The wheel and the sdist were both uploaded 2026-10-20 at 09:04 UTC. `requires_python` is `>=3.10`. The LICENSE file inside the wheel was not read. The pin in sidecar/requirements.txt is `instagrapi==3.1.0`, which matches.

## Code-tree and tooling checks

- Code trees against snap/task-18-base (diff -rq): the only differences are test/mcp.test.js and test/sidecar.test.js. src/, bin/, sidecar/ and scripts/ are identical. package.json and package-lock.json are identical.
- No data directory and no `__pycache__` folder exist in the project.
- Tool count: 36 in src/tools.js. Destructive (destructiveHint true): 5 (ig_stop_clear, ig_events_purge, ig_comment_hide, ig_comment_delete, ig_media_delete). Takes confirm: 14. Read-only (readOnlyHint true): 15 (the 4 status tools and 11 reads). Not read-only (readOnlyHint false): 21, namely the 12 outbound and unofficial tools, the 4 admin tools (including ig_token_refresh, which writes the stored token), the 3 events tools, and the 2 reads ig_dm_mark_read and ig_hashtag_search.
- Node engine: package.json `>=22.12.0`. Test script `node --test test/*.test.js`.
- The ledger names snapshots through task-17-fix2-head, but no such folder exists in snap/. The newest Task 17 snapshot is task-17-fix1-head. The working tree differs from fix1-head only in src/cli.js and test/cli.test.js, which matches the fix-round-2 changes that the Task 17 report lists. I checked the diff but did not re-review the change.

## Task 18 documents

### README.md (created at the project root)

Sections, in order:

1. What this is (plain language, no code names)
2. Setup: what you need; secrets (the IG_<NAME> variables, the credential store, the 8-character rule, the name-normalisation known limit); app id and Graph version; config file (lookup order, required keys); data directory (relative to the project root); commands; first run
3. Safety model: caps (table); busy results; confirmation; the stop state (sources, reads, startup kinds, ranks, the poller halt set); the owner check; messaging windows
4. The tools: kinds, destructive and read-only flags for all 36 tools, the two non-read-only reads, the untrusted marking
5. The poller and inbound messages; the webhook receiver (built, not served; the Host-rewrite requirement)
6. Device identity (default identity as shipped; the challenge handlers refuse)
7. The app secret and the login (the deviation; the refused long-lived exchange)
8. The MCP server (SDK 2.3.1 pinned; the Step 3 reading; ten-minute timeout)
9. The unofficial route: the instagrapi sidecar (3.1.0, MIT, uploaded 2026-10-20, off by default)
10. The Meta app and Facebook Login (Development mode; the fragment flow refused)
11. Publishing input (public URLs per spec decision N; live item)
12. Audit log, retention and secrets (the audit rule; the 30-day message text)
13. Known limits: redaction (the round-5 review list, copied in full); stops and recovery; reads and paging; timestamps and identifiers; writes and retries; other limits
14. Test status (the four required runs, the extra loaded run, the two test-side fixes, the Python command, the --help output, the bin MCP check)
15. Still unverified against live Instagram: spec open items and live-phase list; other live-phase items; the research conflicts (MCP report Tables 8 and 9)
16. Open owner decisions: 1 to 7, then the build's decisions B1 to B7
17. Where the rest is recorded

The README's known-limits section includes every item from task-2-rereview-5.md (the unclosed JSON member string, the token:"token" unclosed form, apikey=token = and apikey=token:, the escaped nested forms and residuals R1 to R4, M-1 and M-2, access_token%3A, encoded JSON, password=Basic, token: basic, and the registered-prefix case N2), plus the ledger limits listed in the brief.

### Spec: docs/superpowers/specs/2026-10-20-instagram-cli-design.md

- Line 4 status: now `- Status: built; live phase pending.`
- Line 156 (Read list): `ig_dm_mark_read` and `ig_hashtag_search` are marked "(not read-only)", with a sub-note: they write a local read marker and count toward the hashtag cap, and both are annotated readOnlyHint false.
- Call G (line 71), added at the end: a read that returns CHECKPOINT, ACTION_BLOCKED or RATE_LIMITED sets the same stop; AUTH_EXPIRED on a read does not (the owner to confirm). This is the reads' stop rule, recorded in the ledger as a Task 18 spec update.
- Caps table, "Owner-sent DMs" row: "50 per day, with private replies counted toward it (the owner to confirm)". This is the private-reply cap update recorded in the ledger.
- Architecture, Poller: "halts on AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, STATE_CORRUPT and STATE_LOST (a RATE_LIMITED stop backs it off and does not halt it)". Recorded in the ledger as a Task 18 spec update (ruling in Task 11).
- Not changed: Open items, the phases, the risks, and the Call B and Call K wording.

### CLAUDE.md: "Current state" section

Replaced with: the source code exists (src/, bin/ig.js, test/, sidecar/, scripts/mcp-spike.mjs, package.json, ESM, Node 22.12 or newer); commands (npm test; node bin/ig.js with auth, serve, mcp, status and routes; no lint or CI config); status built, live phase pending, no live call made; the spec and plan are the references, and the build ledger and task reports are in .superpowers/sdd/...; open owner decisions are listed in README.md under "Open owner decisions"; the git and .remember lines and the research_notes and reports lines are kept.

The Constraints section is not changed. It still says the official-versus-unofficial choice "is not decided", which the spec's decision 1 now settles. The brief limited this step to Current state (see concerns).

## Owner decisions, as written in README.md

Open decisions (the seven the brief lists):

1. **The long-lived token exchange.** Meta documents it with the token in the query string, which this project does not allow. Until the owner decides how it is done, `ig auth login` stops after the short-lived step and stores nothing.
2. **The Facebook Login for Business flow.** Meta's example returns the token in the redirect fragment, which the no-token-in-URL rule forbids. `ig auth facebook` refuses until the owner decides. Until then, hashtag search, business discovery and post deletion are unavailable.
3. **Private replies and the 50-a-day owner DM cap.** The spec does not exempt private replies, so the build counts them toward the cap. The owner confirms this reading.
4. **A like on media needs one prior usage reading.** Without one, the like is refused. The first like after each start needs a read first. The owner decides whether this is acceptable.
5. **Media likes and unlikes go to named targets only,** one at a time, within the caps (spec decision 5). The build briefly limited them to the owner's own media and reverted that, because it changed the owner's feature. The owner confirms the reading.
6. **The auto-reply rule shape and the stored token record** are the build's definitions. The owner confirms them in the live phase.
7. **Mentions without a sender are audited, not stored.** The event schema requires a sender id. Storing them needs a schema change, which the owner decides.

Decisions the build made, which the owner should accept or reverse:

- **B1. Reads set the stop.** A read that returns CHECKPOINT, ACTION_BLOCKED or RATE_LIMITED sets the persisted stop, following the global constraints. The build plan said reads never change the stop state.
- **B2. HTTP status for stops.** The HTTP interface returns 500 for the four stop kinds, as the build plan's table says. A status that differs would let a stop look different from a failure.
- **B3. The MCP SDK reading.** `initialize` negotiates 2025-11-25, and 2026-07-28 is served through `server/discover`.
- **B4. The instagrapi pin.** Version 3.1.0 is one day old at build. Version 3.0.26 also has the login fix.
- **B5. Publishing input.** Public HTTPS URLs, per spec decision N. The owner must host media at a public address, or choose a host, if Instagram Login requires it.
- **B6. The challenge handlers refuse** rather than being left unset.
- **B7. The ten-minute MCP timeout.** A shorter value would report a publish that succeeded as failed. A long carousel can still be cut off at the limit.

## Ledger and report items used

- Ledger: R1 to R14, the Task 13 rulings (a) to (o), the Task 17 rulings (a) to (p), and the rulings and carry-forwards in every Task entry.
- Reports: a haiku agent (a644b98c2349199b9) extracted the concerns, known-limit and open-item sections from task-1 to task-16 reports; I read task-17-report.md sections 8, 9, 11 and 12 myself. Several extracted items were stale and were dropped after checking the ledger and code: the usageThrottlePercent bound (now 1 to 100), the owner option for the webhook (built in Task 17), the commentTimestamp helper (built), the ig_events_purge destructive flag (now true), the ig_dm_mark_read annotation (now false), and the Task 14 M-6 second half (done).
- Research: the MCP and repo comparison report, Tables 8, 9 and 11, which the spec's Open items point to.

## Concerns

1. The coordinator asked for the Node 22 and sidecar fixes to be test-side only. They are. The 30 s sidecar budget is a judgement with a 2x margin over the worst measured start (16.1 s, under 15 CPU burners). A much heavier load could still exceed it.
2. The brief's Python import command (with `-I`) fails with ModuleNotFoundError. The README and this report now use the `-B` form without `-I`.
3. The brief describes the publish input as "Upload Media through Instagram Login, as the spec says". The spec's decision N says images use `image_url` and videos use `video_url`, with the upload page to be read in the spike. The build and the README follow the spec, and the publish input is a live-phase item. Please confirm this reading.
4. CLAUDE.md's Constraints section still says the official-versus-unofficial choice is "not decided", which spec decision 1 now settles. It is outside the brief's Step 8, so I did not change it. The ledger's task-17-fix2-head snapshot is also missing from snap/.
5. The first live run is blocked: `ig auth login` cannot complete until owner decision 1 (the long-lived exchange) is made.

## P7 (2026-10-23): README, docs and the decision map

Status: DONE_WITH_CONCERNS. The concerns are in the list at the end of this section.

### Test counts

| Node | Command | tests | pass | fail | cancelled | exit |
|---|---|---|---|---|---|---|
| v24.6.0 | `npm test` | 1161 | 1161 | 0 | 0 | 0 |
| v22.13.1 (that binary first on PATH, so npm and the tests run on it) | `npm test` | 1161 | 1161 | 0 | 0 | 0 |

Output files: `scratchpad\p7-npm-test-node24.txt` and `scratchpad\p7-npm-test-node22.txt` (under D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\).

### Files changed

- `README.md`: rewritten in full to the current behaviour (603 lines before; now 676).
- `docs/superpowers/specs/2026-10-20-instagram-cli-design.md`: status "built; live phase pending" (earlier); line 156 Read list (earlier); Call N (publishing input, O-13: the owner's host, `media.dir`, `media.publicBaseUrl`, no upload route, the story flag); Call O (lookups: the two daily buckets of 50, O-4); caps table (two rows added); setup commands (`ig routes ack-unofficial --confirm` and `ig routes clear-one-reply-flag --confirm` added); Call P (the cursor reset exception, pointing to the README). The stop-rule and private-reply-cap lines were changed earlier (Call G, the caps table, and the poller line).
- `CLAUDE.md`: "Current state" (the 1161 count on both Node versions, the decisions made, the live-phase status, the pointers to the README and the decision map, and the two constraint-file questions); "Constraints" (the existing haiku rule and the two routes kept; added: no comments on other people's posts, publishing from the owner's folder only, secrets never in output, the cursor exception).
- `.superpowers/sdd/2026-10-20-instagram-automation-build/final-decisions-report.md`: new. The O-1 to O-13 table (decision, status, reason, cost, code location), the constraint 14 exception, the questions for the owner, and the A-1 to A-36 table (status, where, reason).
- `.superpowers/sdd/2026-10-20-instagram-automation-build/task-18-report.md`: this section.
- Not changed: anything under `src/`, `bin/`, `test/`, `sidecar/`; `global-constraints.md` (the constraint-file question is left to the owner); `package.json`.

### How the README was checked

- The code claims were checked by grep and by reading the code at the lines the README cites: the caps and the defaults (`src/config.js`), the paging ceilings (`src/graph/paging.js`), the time and size limits (client, oauth, mcp, poller, token, sidecar, audit), the HTTP status map (`src/http.js`), the stop model (`src/stops.js`, `src/guard.js`, `src/service.js`), the damaged-state recovery (`src/state.js`, `src/caps.js`, `src/events.js`, `src/cli.js`), the publish path (`src/graph/endpoints/media.js`, `src/service.js`, `src/tools.js`), the OAuth flows (`src/oauth.js`), and the redaction layer (`src/redact.js`).
- A haiku verification pass checked all 36 A-items and the O-1, O-5 and O-11b code locations. Its claims were checked again by hand where the README depends on them.
- Four README claims were wrong and are now corrected: the DELETE rule (an empty DELETE body is `API_ERROR`, A-14); numeric times (accepted, A-25); the byte-order mark (ignored, A-34); and the failing-thread back-off (implemented, A-24, so a failing thread no longer holds a slot on every tick). The `ig status` row also claimed the token expiry; that is in `ig_token_status`, so the row was corrected.
- O-1 is partly met as worded. The README states the behaviour that the code and the tests pin, and the decision map records the difference.
- Stale wording removed: "Node 22 not run", the probe, "500 for the four stop kinds" (now 423), "Graph response bodies have no size cap" (now 5 MB), "Open owner decisions" (now decided, with the questions still open listed separately), the 730-test counts, and the "Status date 2026-10-21".

### Concerns

1. **O-1 is not met as worded.** The decision said "structured Graph codes first". As built, the most severe signal wins, and a text CHECKPOINT phrase (rank 3) outranks a structured rate limit (rank 2). So HTTP 429 with code 4 and "challenge required" gives CHECKPOINT. The test pins this on purpose. I did not change the code, because it is outside this package. The owner should decide whether structured codes should win over phrases of any rank (question 5 of the decision map).
2. **The constraint file is out of step with the build** on two points: line 14 (the cursor reset exception) and line 6 (the two lookup buckets of O-4). It is left unchanged for the owner's decision (question C-1).
3. **Live checks outstanding:** the long-lived POST (O-7), the Facebook bridge in a real browser (O-8), the publish host and the HEAD and Range fallback (O-13), and the rest of the list in README "Live-phase checks". Nothing has been run against a live account.

## Final round (2026-10-23)

Status: DONE_WITH_CONCERNS. The suite is green on both Node versions. Two items are placeholders until the other implementers report (see the concerns).

### Test counts

| Node | Command | tests | pass | fail | cancelled | exit |
|---|---|---|---|---|---|---|
| v24.6.0 | `npm test` | 1167 | 1167 | 0 | 0 | 0 |
| v22.13.1 (that binary first on PATH) | `npm test` | 1167 | 1167 | 0 | 0 | 0 |

The count moved from 1161 to 1167 because the HTTP implementer's tests for `http.allowRemote` landed during this round. One of those tests failed on Node 24.6.0 in the first run, because it ran while the implementer was still editing `src/cli.js`. A rerun passed, and the Node 22.13.1 count was taken on the settled code. Output files: `scratchpad\final-round-npm-test-node24-b.txt` and `scratchpad\final-round-npm-test-node22-b.txt`. A final confirmation run on the settled code gave the same counts on both Node versions, 1167 of 1167 each, exit 0 (`scratchpad\final-round-npm-test-node24-c.txt` and `scratchpad\final-round-npm-test-node22-c.txt`).

### What changed in this round

1. **README R-1 to R-6**, as the final review states them:
   - R-1: the `ig_dm_messages` default is 1000 (the `limit` argument takes 1 to 1000), read through the messages edge up to 10 pages.
   - R-2: the back-off is 1, 2, 4, 8 and 16 ticks, then at most 32 ticks between retries (A-24). The same correction is in the decision map's A-24 row.
   - R-3: a 405 row added to the status table.
   - R-4: the O-1 rule is stated as the review gives it: structured signals first, the text match as the fallback, and on a conflict the more severe stop wins, so a CHECKPOINT text on an HTTP 429 gives CHECKPOINT (a test pins it). The owner confirms the wording.
   - R-5: the approval comes back in the URL fragment, which the bridge page clears on load (`history.replaceState`, `src/oauth.js:82`). The README and the decision map no longer say the token is never in a URL. The sentence now says it is never sent in a request URL, logged or stored.
   - R-6: `ig mcp` forwards to `127.0.0.1` on the configured `http.port` (8788 by default).
2. **`src/tools.js` line 259** (wording only, inside a tool description): `ig_dm_messages` now says the read is bounded to 10 pages and 1000 items, that `truncated` is set when it is bounded, and that `nextAfter` continues a long thread. No test pins the description. The other two descriptions that say "the first page" (`ig_dm_conversations` at line 252, `ig_comments_list` at line 243) are unchanged, because the instruction named line 259 only. They are true for those reads, which are first-page reads, so they are not stale in the same way. Say if they should change too.
3. **Decision map** (`final-decisions-report.md`):
   - O-8 row: the cited lines are `src/oauth.js:43`, `:72-107` (`BRIDGE_SCRIPT` and `BRIDGE_HTML`), `:82`, `:176`, `:265` and `:571-576` (the Origin rule). The row's wording is corrected as in R-5.
   - O-13 row: the kind limits are at `src/graph/endpoints/media.js:23-25` (`MEDIA_LIMITS`). The `sha256File` reference is `:262-298`.
   - The O-1 status and its summary line are changed to MET on the conflict rule, with the wording for the owner to confirm.
   - The A-24 row uses the corrected back-off sequence.
4. **Plain HTTP (S-K1)**: the README now says the HTTP API is plain HTTP. A non-loopback `http.host` needs `http.allowRemote` and an `api_token`, and `ig serve` refuses to start without both. `ig status` refuses to send the token to a non-loopback host unless `http.allowRemote` is `true`, and it prints this line before the request: `warning: http.allowRemote is true, so ig status sends to <host> over plain HTTP, and the traffic is not encrypted.` That wording is copied from `src/cli.js:612`. The `ig serve` warning is **not in the code yet**, so the README marks it as pending. The known-limits section also states the plain-HTTP limit.
5. **Unofficial login**: the README has a placeholder for `ig routes login-unofficial`. It has the command row in the Commands table and a subsection "Logging in to the unofficial route". The prompts, the outcome, the keyring account name, the restore behaviour and the failure message are marked PLACEHOLDER. The code does not have the command yet (`grep` for `login-unofficial` finds nothing in `src/` or `bin/`).

### Concerns

1. **Placeholders, pending the other implementers.** The `ig serve` warning line (S-K1) and the `ig routes login-unofficial` section are placeholders in the README. Fill them from the HTTP and sidecar implementers' reports. The README marks each one with `[PENDING]` or `[PLACEHOLDER]`.
2. **The unofficial login is not wired.** The final review (1.5) says no production code calls the sidecar's login. The README describes the intended command, not one that exists yet.
3. **Two "first page" descriptions remain** (`ig_dm_conversations`, `ig_comments_list`). They are accurate for those reads. Say if the owner wants them rewritten as well.

### Files changed in this round

- `README.md` (R-1 to R-6; S-K1; the placeholders; the O-1 and O-8 wording).
- `src/tools.js` (line 259 wording only).
- `.superpowers/sdd/2026-10-20-instagram-automation-build/final-decisions-report.md` (the O-8 and O-13 references, the O-1 status, A-24).
- `.superpowers/sdd/2026-10-20-instagram-automation-build/task-18-report.md` (this section).
- Not changed: `progress.md` (the controller's O-8 wording at its line 406 still says the token is never in a URL; that is the controller's record, and the review points to it), `global-constraints.md`, the spec and `CLAUDE.md` (this round did not ask for changes to them).

## Final round (2026-10-23): placeholders

Status: DONE_WITH_CONCERNS. Every placeholder is filled from the code, and the markers are gone from the README.

### Test counts

| Node | Command | tests | pass | fail | cancelled | exit |
|---|---|---|---|---|---|---|
| v24.6.0 | `npm test` | 1204 | 1204 | 0 | 0 | 0 |
| v22.13.1 (that binary first on PATH) | `npm test` | 1204 | 1204 | 0 | 0 | 0 |

Output files: `scratchpad\placeholders-final-node24.txt` and `scratchpad\placeholders-final-node22.txt`. The count rose from 1167 to 1204 because the sidecar, login and restore work landed with their tests. The last run was on the code now on disk, after the other agent's README change.

### 1. serve and status over plain HTTP (filled from `src/cli.js` and `bin/ig.js`)

- `ig serve` refuses a non-loopback host unless `http.allowRemote` is true and `api_token` is set (`assertServeHost`, `src/cli.js:121-127`). It binds such a host over plain HTTP, and it prints `HTTP API listening on <address>:<port>`. **It prints no plain-HTTP warning** (the only warning is in `ig status`).
- `ig status` sends the token only to a loopback address (wildcard `0.0.0.0` maps to loopback). For a non-loopback host it refuses unless `allowRemote` is true (`src/cli.js:685-687`): the refusal goes to standard error, nothing is sent, and `bin/ig.js` exits 1. With `allowRemote`, it prints `warning: http.allowRemote is true, so ig status sends to <host> over plain HTTP, and the traffic is not encrypted.` before the request (`src/cli.js:692`).
- The status table has 405 (method not served) and 503 (webhook clock rule), and the README's Commands and Secrets rows say the same thing.

### 2. `ig routes login-unofficial` (filled from `bin/ig.js:239-262`, `src/cli.js` `runRoutesLoginUnofficial`, `src/unofficial-session.js`)

- Refused with `ROUTE_DISABLED` unless the route is acknowledged; refused with `CONFIG` while `ig serve` runs; holds the serve lock while it runs.
- Prompts: on a terminal, `Instagram username: ` (shown), `Instagram password (input hidden): ` and, only when the sidecar asks, `Two-factor code (input hidden): `. Without a terminal, the lines of standard input in that order.
- The password must be at least 8 characters (`registerPassword`, `VALIDATION`, nothing sent), is registered before use, and goes only to the sidecar.
- Storage: the session goes to the keyring as `unofficial_session` (JSON), the username as `unofficial_username` (JSON `{ "username": ... }`), service `instagram-automation`. Nothing is written to a file. Success clears `routes.unofficial.stop`, and an audit line `unofficialLogin` is written. A failed step restores or removes the entries it wrote (`storeUnofficialLogin`).
- Restore at serve start: when the route is acknowledged and a session is stored (`restoreUnofficialSession`, called from `buildServe`). A failed restore sets `AUTH_EXPIRED` on `routes.unofficial.stop`, which stops only the unofficial route. A sidecar that cannot start (missing Python) gives status `unavailable`: no stop, the session is kept, and serve prints the reason.
- A missing Python gives `UNOFFICIAL_ADAPTER_ERROR` (`sidecar.js`, `startFailureMessage`, with `sidecarStart: 'failed'`), not an expired login.
- The sidecar command: `IG_PYTHON`, else `routes.unofficial.python` (default `python`), script `sidecar/ig_sidecar.py` under the project root (`sidecarCommand`).

### 3. Feature mapping (checked against `src/config.js:56-64`, `src/unofficial/adapter.js`, `src/service.js` `assertRoute`)

- Defaults: `routes.unofficial.adapterByFeature` is `{ follow: 'sidecar', unfollow: 'sidecar', profileEdit: 'sidecar' }`; `python` is `python`; `enabled` and `acknowledged` are false.
- Official behaviour kept: `assertRoute` refuses `ROUTE_DISABLED` unless enabled and acknowledged.
- A config mapping overrides the default. A feature with no mapping, or mapped to an unregistered adapter, gives `NOT_SUPPORTED` (`createAdapterRegistry.forFeature`). `jslib` is registered and refuses every call with `NOT_SUPPORTED`.

### 4. Stderr redaction (S-L1, `src/unofficial/sidecar.js:147-158`)

- The last non-blank stderr line is redacted whole (`redact(line.trim())`) and only then cut to 200 characters. A line longer than 8192 characters is not shown, and the last 20 lines are kept. The README states both.

### 5. Live phase

- The live-phase table has three new rows: the sidecar login, the restore and the follow. The README says none of them has run against Instagram.

### 6. README check against the code (tool count, caps, status codes)

- Tools: 36 registry entries (`grep "^    name: 'ig_"`); the README lists 36. (`grep -c "defineTool({"` gives 37 only because the function definition line matches.)
- Caps: `DEFAULT_CAPS` matches the README caps table, including the two 50-a-day lookup buckets.
- Status codes: `STATUS_FOR_KIND` (400, 409, 423 for the four stop kinds, 429, 403 for `OWNER_MISMATCH` and `ROUTE_DISABLED`), plus 200, 401, 403 (Host), 404, 405, 413, 500 and the webhook 503. The README table has all of them.
- Numeric limits: every constant in the README's limits table was grepped; the values match. `ig status`'s 5-second wait (`STATUS_TIMEOUT_MS`) and the sidecar's stderr limits were added.

### Concerns

1. **`ig serve` prints no plain-HTTP warning.** The brief for this round said it does, but the code has only the refusals and the listening line. The README records the gap. A warning in `ig serve` needs a change under `src/`, which I did not make.
2. **An expired session during a follow is an account stop.** `runOutbound` routes the sidecar's `AUTH_EXPIRED` through `observe`, which sets the account stop, so all outbound actions halt, official routes included. Only a failed restore at serve start is limited to the unofficial route. The README now says so. The owner should decide whether a route-level stop is wanted here.
3. **The sidecar login, restore and follow have not run against Instagram.** They are the live-phase rows in the README.

## Final review fixes (2026-10-23)

Status: DONE_WITH_CONCERNS. The documentation corrections from final2-review.md are made, and no code was changed.

### Test counts (at the end of the round)

| Node | Command | tests | pass | fail | cancelled | exit |
|---|---|---|---|---|---|---|
| v24.6.0 | `npm test` | 1208 | 1208 | 0 | 0 | 0 |
| v22.13.1 (that binary first on PATH) | `npm test` | 1208 | 1208 | 0 | 0 | 0 |

Output files: `scratchpad\f2m-final-node24.txt` and `scratchpad\f2m-final-node22.txt`. The count matches the 1208 that the review recorded for the serve-warning head.

### What was corrected

- **F2-M-1 (serve warning).** `README.md`, the Commands row for `ig serve`, the plain-HTTP bullet and the known-limit bullet no longer say that `ig serve` prints no warning, and the word "gap" is gone. The text now says what the code does: with `http.allowRemote` on a non-loopback host, `ig serve` prints one warning line on standard error, `warning: the HTTP API is plain HTTP on <host>:<port>. The bearer token (api_token) and the API traffic travel unencrypted on that network. Keep the host on loopback, or put the API behind TLS.`. The line carries no token, and a loopback start prints nothing extra (`src/cli.js` `remoteServeWarning`, printed at the end of `startServe`).
- **F2-M-2 (status warning and config summary).** The README now says the `ig status` warning is printed only when `http.allowRemote` is true and the host is not loopback. The config summary of `http` lists `allowRemote` `false`, and says it must be `true` for a non-loopback host.
- **F2-M-3 (username registration and the secret count).** The README now says the session is registered for masking when it is received, and that the username is stored as JSON (`{ "username": ... }`). Only that stored JSON form is registered; the bare username is not. The Secrets section now says there are five secrets, and that the unofficial login keeps two more keyring entries, `unofficial_session` and `unofficial_username`.
- **F2-M-4 (test counts).** The README (Test status, both Node versions) and CLAUDE.md now say 1208.
- **F2-M-5 (CLAUDE.md commands).** CLAUDE.md lists `routes` as `ack-unofficial`, `login-unofficial`, `clear-one-reply-flag`.
- **F2-M-6 (sidecar start failure).** The review's text is not in the coordinator's per-item list, but it falls in the F2-M-1 to F2-M-8 range, so it was corrected. The README bullet now says only a failure to start the executable (for example Python not found) is not an expired login. A missing script, Python exiting at start, or instagrapi not installed counts as a failed restore, which sets the unofficial route's stop `AUTH_EXPIRED`. The stop clears on a successful restore at the next `ig serve` start, or on a successful `ig routes login-unofficial`.
- **F2-M-8 (remote name in allowedHosts).** The remote-host section now has a bullet: the `Host` header of a request must name a listed host, with its port. Loopback names are listed by default and a remote name is not, so a request to the remote address gets 403 until the name is added (for example `192.168.1.10`). `ig status` reports the refusal as `ig serve answered with an error (FORBIDDEN)`.
- **F2-M-7 and F2-M-9** are a test comment and a test assertion, so they were skipped as the coordinator said.

### Not changed, and why

- **Code.** Nothing under `src/`, `bin/`, `test/` or `sidecar/` was changed. The review's F2-M-8 suggestion, to add the allowedHosts hint to the 403 status text, is a code change, and it is left to the implementer. The ig status 403 text (`ig serve answered with an error (FORBIDDEN)`) still has no hint.
- **The decision map.** `final-decisions-report.md` still says the suite has 1204 tests (line 110). It is outside the F2-M list, so it was left, but it is stale and should say 1208.
- **Concurrent edits.** Another agent changed `README.md` and `CLAUDE.md` on disk during this round. Those changes were kept. After the round, every correction above was checked to be present, and the README has no `PENDING` or `PLACEHOLDER` markers.

### Concerns

1. The `ig status` 403 text has no hint about `http.allowedHosts` (F2-M-8). The README now covers it, but the message does not.
2. `final-decisions-report.md` still says 1204 tests (line 110), while the suite now has 1208.
3. F2-M-6 was not in the coordinator's per-item list. I corrected it as part of the F2-M-1 to F2-M-8 range. Please confirm that reading.

## Unavailable rule and counts (2026-10-23)

Status: DONE. The README bullet on start failures now states the rule the code implements, and the test count is updated in the README, CLAUDE.md and the decision map.

### The rule (README, "Logging in to the unofficial route")

The bullet "Only a failure to start the executable is not an expired login" is replaced by "Unavailable, not an expired login". It gives three cases that set no stop and return `UNOFFICIAL_ADAPTER_ERROR`:

- a missing instagrapi (the sidecar reports the kind `unavailable`; `sidecar/ig_sidecar.py` `_new_client`, `src/unofficial/sidecar.js` marks it `sidecarStart: 'failed'`);
- a failure to start the executable, for example the Python executable is not found (`sidecar.js` `startFailureMessage`, `sidecarStart: 'failed'`);
- a child that exits, or does not answer within the timeout, before it has answered anything (`sidecar.js` `failStart`, which marks the failure when `session.replies === 0`).

A failed restore of a session that did start gives `AUTH_EXPIRED`, and it stops the unofficial route only. A failure during a login gives `UNOFFICIAL_ADAPTER_ERROR`, and nothing is stored. The source of this rule is the sidecar section of `task-12-report.md` ("Missing instagrapi is unavailable, not an expired login").

### Counts

| Node | Command | tests | pass | fail | cancelled | exit |
|---|---|---|---|---|---|---|
| v24.6.0 | `npm test` | 1217 | 1217 | 0 | 0 | 0 |
| v22.13.1 (that binary first on PATH) | `npm test` | 1217 | 1217 | 0 | 0 | 0 |

Output files: `scratchpad\unavail-npm-test-node24.txt` and `scratchpad\unavail-npm-test-node22.txt`.

The count is now 1217 in `README.md` (Test status, both Node versions), in `CLAUDE.md` (Current state), and in `final-decisions-report.md` line 110.
