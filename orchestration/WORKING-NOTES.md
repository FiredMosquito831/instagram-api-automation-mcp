# Working Notes — the operating manual for instagram-api-automation-mcp

The orchestrator's manual: how the owner works, what they verify and reject, repo and release mechanics, the gate and code rules, product principles, domain facts, how agents are run, the machine, every release, every learning, and what is still open. **Current truth only.** History lives in `WORKING-NOTES-ARCHIVE.md`.

- **Where it lives:** `D:\Projects2\InstagramApi\orchestration\`, inside the repository, tracked in git (owner's decision 6, 2026-10-23). Backups (`*.bak-*`) are git-ignored.
- **Before editing:** copy it to `WORKING-NOTES.bak-<yyyy-mm-dd-hhmm>.md` beside it. Never modify or delete a `.bak*`.
- **Format:** UTF-8, LF in the repository (`.gitattributes` enforces it). Scripted edits read with `newline=""`, assert each anchor exactly once, and write back the same newline. Never `sed -i` or `awk` on this file.
- **Who edits:** only the orchestrator. Agents never edit it; they report lessons in their final message, and the orchestrator ports them.
- **No secrets here, ever.** Machine paths as `%USERPROFILE%`.
- **History and the dated diary** live in `WORKING-NOTES-ARCHIVE.md`. The dated running log is `HANDOFF-2026-10-23.md`; the current entry point is the newest `HANDOFF-<date>.md`. The release queue is `QUEUE.md`. Specs and their USER DECISIONS blocks are in `specs/`, and the build's own specs are in `docs/superpowers/specs/`.
- **The build's full record** (every brief, report, review and fix round, 2026-10-20 to 2026-10-22) is tracked in `.superpowers/sdd/2026-10-20-instagram-automation-build/`. Its ledger is `progress.md`; its decision map is `final-decisions-report.md`.

## Map of this file

| Part | What lives here |
| --- | --- |
| I — How the owner wants to work | ownership, discuss-first, delegation, verification, what is rejected, communication, standing decisions |
| II — Repo mechanics | git, semantic versioning, the release process, commit shape, the verify recipe, hard rules for every brief |
| III — Gate, testing, code rules | the gate (`npm run ci`), flakes, test isolation, code rules, boundaries, the new-setting checklist, contract tests, stored-data rules |
| IV — Product principles | the rules every change is judged against |
| V — Domain facts and gotchas | what the system's parts do, each with its source file |
| VI — Subagent orchestration | the loop as it was run, briefs, resume, failure modes |
| VII — Environment | this machine, tools, the live system's status |
| VIII — Release history | one row per version (seeded from git tags and the CHANGELOG) |
| IX — Learnings | one deduplicated list, grouped by theme, each with its origin |
| X — Still open | what is queued, held, awaiting the owner, and the owner's own to-dos |

**Fastest cold start:** the newest HANDOFF, then PART I, II.5, II.6, III.1, IV, the last rows of PART VIII, and X.

---

# PART I — HOW THE OWNER WANTS TO WORK

## I.1 Ownership and what "done" means
- The owner's repository: `FiredMosquito831/instagram-api-automation-mcp`, **public** since 2026-10-23 (on the owner's go; created private the same day). Remote `origin`, default branch `main`. No upstream exists; nothing is pushed or pull-requested anywhere else.
- **Pushed is not released.** Released = committed to `main`, a version bump and CHANGELOG section in that commit, an annotated tag on that commit, and a GitHub release marked Latest with its notes. The package is private and is not published to npm.
- Finish end to end. "Done" means the owner can see it working: state the exit criterion in their terms up front, test to it, and lead with the negative when it is negative.
- Good behaviour by default: the product does the work; the owner never runs a "do this once" step.
- **The live system:** none is connected. The owner's second test account is pending. The orchestrator never contacts Instagram without consent and a stated budget (I.7).

## I.2 Discuss before building
- A change beyond a literal small ask goes: read-only investigation → a spec in `specs/` with numbered, plain-language questions, each with a recommendation → the owner answers in one line → a binding `USER DECISIONS (<time>)` block is appended to the spec → one implementer. Never dispatch before the owner agrees.
- **Delegated decisions:** when the owner says "decide", the orchestrator decides toward the most complete version that still fails closed, records each decision with its cost in the decision map, and keeps each one reversible. This was done for the 13 open decisions of 2026-10-22 (O-1 to O-13).
- Safest, 100% working, break nothing: change only what is broken, where it is broken. Every module must work, and the test suite is the contract (I.7).- Questions to the owner: plain language, only about things they can see or decide. Never relay an agent's question unchecked.
- Queue discipline: finish the queued items in their order. New ideas wait. After the last queued item, report and let the owner choose.
- Granular releases: one concern per release. Scope additions go to the next release unless they are one line.
- Publishing a release, or any outward action on the owner's GitHub account, proceeds only on the owner's go (I.7).

## I.3 Delegation, model choice, context
- Delegate investigations and builds; take conclusions only. Protect the orchestrator's context.
- **Every subagent call passes `model: "haiku"`** (the CLAUDE.md constraint, binding since the first session).
- At most two agents at once. One implementer per file at a time, because two writers to one file interleave their edits (IX.2). Read-only reviewers may run beside it.
- One written brief per implementer: the contract, every `file:line` grepped, the tests named, the verification, and the report path. A review brief lists what to verdict (ADDRESSED or NOT ADDRESSED, with `file:line`) and what to write.
- Announce every dispatch in the same message. Run `ListAgents` before a dispatch.
- No diagnostics of the owner's machine unless asked. No polling without a bounded timeout.

## I.4 How the owner verifies
- Assume every claim will be checked on the owner's machine. The owner tests independently and comes back with counter-evidence.
- Bug reports are precise and usually right: reproduce first, argue never.
- When the owner is frustrated: lead with evidence (command output, counts, file lines), not reassurance.

## I.5 What the owner rejects
- Invented limits; claiming something works without running it; filler documentation; per-name fixes; speculative features; silent changes to retry, fallback, rotation or safety behaviour; a long page as a fix; being told to change their own settings.

## I.6 Communication style
- Lead with the answer, then the evidence. Show real command output.
- Say plainly when wrong, correct it, and move on.
- Separate **CONFIRMED** (ran it; output shown), **UNVERIFIED** (read it in code or docs), and **NOT DONE** (skipped, and why).
- The machine's timezone is Europe/Bucharest. Convert before saying "recent".

## I.7 The owner's standing decisions (do not re-ask)
- **2026-10-22, the 13 open decisions (O-1 to O-13):** delegated to the orchestrator. Each was decided toward the most complete option that still fails closed, and each is recorded with its cost in `final-decisions-report.md`. The owner can reverse any of them.
- **2026-10-23, the owner's working rules for this project:** decide every open decision yourself and aim for the most complete, resilient version, failing closed. Keep all work and progress tracked, except credentials and tracking artifacts (snapshot copies, review diffs, session memory). Every module must work. Report what is CONFIRMED, UNVERIFIED and NOT DONE. No live Instagram call without consent and a stated budget.
- **2026-10-23, repository and release:** a git repository and a GitHub repository, `instagram-api-automation-mcp`, public since 2026-10-23 on the owner's go, after a scan of the full history for real secrets (none real; fixtures only). Releases use semantic version bumps.
- **2026-10-23, no frozen boundary:** every module must work, and the test suite is the contract. (The owner's answer to the frozen-boundary question: "I want all files and modules functional and working.")
- **2026-10-23, the gate:** local CI, `npm run ci`, run on this machine, not hosted. It runs the full suite on Node 24.6.0, 22.12.0 and 22.13.1, plus the checks in III.1. No lint or type check is configured.
- **2026-10-23, the owner's approvals:** the rename to `instagram-api-automation-mcp` (released as 0.1.1); the constraint wording, option A; the live-phase plan in principle ("i approve all"). The live phase still needs a test account (private), consent at each write, and an explicit restriction-risk acceptance for phase 11 (the unofficial sidecar).
- **Kept on purpose (2026-10-23):** the keyring service name `instagram-automation` and the MCP server's advertised name. Stored credentials and client configurations depend on them.
- **The Windows account name** in machine paths was replaced with `%USERPROFILE%` in the tracked files (2026-10-23). Older commits keep it.
- **Credentials:** the OS keyring holds real secrets. Never read keyring entries or `IG_*` values. Never create a `.env`.

---

# PART II — REPO MECHANICS

## II.1 Checkout, branches, scratch
- Checkout: `D:\Projects2\InstagramApi`. One repository; default branch `main`; remote `origin` (public, on GitHub).
- Commits go straight to `main`. No pull-request flow was requested. Each release is one commit (the change, the bump and the CHANGELOG section together), then the tag, then the GitHub release. Docs-only commits may follow a tag (II.5).
- Never `git stash`, `git checkout <file>` or `git reset --hard` on the checkout. Inspect with `git diff`. Compare against an older tag in a scratch worktree, then remove the worktree.
- Re-anchor before analysing: `git -C D:\Projects2\InstagramApi fetch origin --tags` and `git log --oneline -1 origin/main`.
- Scratch: the session scratchpad under `D:\tmp\claude\...`. Tools installed outside the repository live in `D:\tools\node\`. Never delete under a scratch root without listing what is there first.
- Line endings: the repository stores LF (`.gitattributes: * text=auto eol=lf`).

## II.2 Versioning (semantic versioning)
- `package.json` `version` is the single source. Bump it in the same commit as the change it describes.
- **PATCH** (0.1.1 → 0.1.2): fixes and packaging that change no tool name, HTTP route, MCP tool, config key or stored data format.
- **MINOR** (0.1.x → 0.2.0): additions: a new tool, route, config key or capability. Existing names and formats keep working.
- **MAJOR** (0.x.y → 1.0.0 and later): a breaking change to a tool name, route, config key, stored data or the stop behaviour. Before 1.0.0, a MINOR may carry a breaking change, and the CHANGELOG must say so in plain words.
- **1.0.0 is reserved** for the release after the live-phase checks are verified on a live test account.
- The CHANGELOG (`CHANGELOG.md`) is the release-notes record. Each release has a section.

## II.3 Release process (as run for 0.1.0 and 0.1.1)
1. Make the change. Commit it with the version bump and the CHANGELOG section (II.4), in one commit. The tree must be clean before the strict gate runs.
2. Run the strict gate on the clean tree: `npm run ci -- --release`. It must pass on every configured Node version. It appends a line to `orchestration/ci/history.md`; commit that line as a separate, docs-only commit.
3. Push `main`: `git push origin main`.
4. Tag the **release commit** (not the history commit): `git tag -a vX.Y.Z <sha> -m "Release X.Y.Z: <headline>"`, then `git push origin vX.Y.Z`.
5. Create the GitHub release from the CHANGELOG section: `gh release create vX.Y.Z --title "vX.Y.Z" --notes "<section>" --latest`.
6. Verify (II.5). Report the release URL, the test counts, and anything not verified.
- The release's artefact is the source at the tag. The project publishes no build output.
- Traps that bit: `gh release view --json isLatest` is not a field in this gh version (read `tagName`, `isDraft`, `isPrerelease`, `url`, `targetCommitish`; check Latest with `gh release list`). `gh repo edit` takes `owner/repo`, not a bare name.

## II.4 Commit and release-note shape
- Commit message: a short subject, then prose: what was broken, the mechanism (cause, not symptom), what the change does and any non-obvious choice, the verification with real output, and what was deliberately not done.
- **Attribution line:** every commit message and PR body ends with `by FiredMosquito831`.
- Release notes are the CHANGELOG section: the headline, what was wrong, what to expect, the action required (with the exact command), and what is known and deliberate.
- Never claim verification beyond what ran.

## II.5 The verify recipe (after every release, before reporting it)
```
git -C D:\Projects2\InstagramApi fetch origin --tags
git -C D:\Projects2\InstagramApi log -1 --format="%h %s" origin/main
git -C D:\Projects2\InstagramApi ls-remote --tags origin 'vX.Y.Z^{}'          # must peel to the release commit
git -C D:\Projects2\InstagramApi merge-base --is-ancestor vX.Y.Z origin/main  # the tag is an ancestor of main
git -C D:\Projects2\InstagramApi diff --stat vX.Y.Z origin/main -- src bin package.json sidecar scripts   # empty = no product change since the tag
gh release view vX.Y.Z --json tagName,isDraft,url,targetCommitish
gh release list --limit 3                                                    # Latest marks the new release
git -C D:\Projects2\InstagramApi status --short                              # empty
npm run ci -- --release                                                      # PASS on every configured Node version
```
- A docs-only commit after a tag is allowed (decided 2026-10-23). The product-code diff since the tag must be empty; a tooling change since the tag (scripts, package.json) belongs to the next release.
- Then: a release-history row (Part VIII), a dated line in the diary (`WORKING-NOTES-ARCHIVE.md`), the queue row flipped (`QUEUE.md`), and the report to the owner: what shipped, what was verified, the deviations, and what was not done.

## II.6 Hard rules for every brief (agents and the orchestrator)
1. Work in the checkout only when the change is the orchestrator's own. Agents work in a scratch copy or a worktree, never the primary checkout, and never delete scratch. List every directory left behind.
2. Never touch the owner's world: no live Instagram call without consent and a budget; no real keyring entries; no real `IG_*` values; no real config homes; no autostart or registry entries; the owner's PATH. Never read `data/` or `media/` outside a test.
3. Stop only processes you started, by exact PID. Never by image name or substring.
4. Secrets: never read the keyring or any `IG_*` value; never print a command line that contains a value. Tokens in test fixtures are fake and keep an obviously fake shape (`IGAAB_owner_token_for_tests_01`).
5. Tooling: write scripts with the Write tool and run them by path. Never a heredoc into an interpreter; never `sed -i` on a tracked file; `python -B` for the sidecar, never `-c` one-liners against the owner's files.
6. No frozen boundary (the owner's decision, 2026-10-23). Every module must work. A change keeps its tests green and does not weaken a guard; a guard that is removed or narrowed needs a test that proves its replacement holds.
7. Extend, never narrow: list every module a change touches (grepped, `file:line`) and read each one before changing it. If a change seems to require removing or bypassing existing behaviour, stop and report.
8. Reporting: the final message is the deliverable (what changed, the proofs with real output, deviations, residual risks, what was not done). Agents do not edit the manual, the queue or the handoff.

---

# PART III — THE GATE, TESTING, CODE RULES

## III.1 The gate: `npm run ci` (local CI)
- **Script:** `scripts/ci-local.mjs`, run as `npm run ci`. The raw suite is `npm test` (`node --test test/*.test.js`).
- **What it runs:** the Node version floor (22.12.0); the clean-tree check (strict for a release); the CHANGELOG section for the version in `package.json`; the full suite on the Node that runs the script, and on every Node listed under `nodes` in the untracked `.ci-local.json`; the Python sidecar check (`python -B`, expects `rate_limited`; skipped with a reason when Python is absent); and a token-shape scan of the shipped code, docs and manual (test fixtures excluded).
- **Modes:** `npm run ci` reports; `npm run ci -- --record` also appends a line to `orchestration/ci/history.md`; `npm run ci -- --release` is strict (clean tree, CHANGELOG section, every configured Node must pass) and records. A failed run is recorded too, so a dirty-tree attempt shows as a failure.
- **Node versions:** 24.6.0 (the default); 22.12.0 (the engine minimum; a verified official build at `D:\tools\node\node-v22.12.0-win-x64\node.exe`, SHA-256 checked against nodejs.org); 22.13.1 (the Playwright-bundled runtime at `%USERPROFILE%\AppData\Local\ms-playwright-go\1.50.1\node.exe`). The non-default paths live in the untracked `.ci-local.json` (see `.ci-local.example.json`). Do not change the machine's PATH.
- **Baseline:** 1217 tests, all passing on every configured Node version, with no skipped or cancelled tests (last strict run recorded 2026-10-23).
- **No hosted CI** (decided 2026-10-23). No lint or type check is configured. Never run two full gates at once on the machine.

## III.2 Known flakes
- The sidecar's child-process tests run against a 30-second budget. A child start took up to 16.1 s under 15 CPU burners in measurement. A timeout under heavy load is a load artefact first: classify it, and do not widen the budget without a measurement.

## III.3 Test isolation
- Tests use injected fakes for fetch, timers, the file system and the clock. No test listens on a port or makes a network call. A test that touches a real file uses a temporary directory and cleans it up.
- A test that waits on a timeout holds a referenced timer during the wait. `AbortSignal.timeout` alone does not keep Node alive, and on Node 22 the test is cancelled (IX.4).
## III.4 Code rules
- ESM throughout (`"type": "module"`), Node 22.12 or newer. Runtime dependencies are pinned exactly: `@modelcontextprotocol/server` 2.3.1, `@napi-rs/keyring` 2.1.2, `commander` 15.0.0.
- A new dependency: `npm view <pkg> version` and `npm view <pkg> scripts` are recorded first; it is installed with `npm install --ignore-scripts <pkg>@<exact version>`.
- Redaction: every output path passes through `src/redact.js`. A registered secret is masked by its exact value, in the raw, URL-encoded and single JSON-escaped forms, and a token-shape rule covers the Meta token prefixes.
- Secrets never reach a file, a log, an audit line, an error or a tool result (the owner's rule).

## III.5 Architecture and boundaries
- `src/graph/` is the only code that talks to Meta. The service calls the endpoint modules.
- The service is the only path to an outbound write, through `runOutbound`: the stop check, the route check, the owner check, the confirmation, the caps, the usage hold, the record, the perform, and the audit.
- Tokens travel only in the `Authorization` header. A token in a URL, a log, an audit line, a tool result or a stored file is a defect (III.7).
## III.6 Every new setting or environment variable
- Constant default → config field → CLI or tool surface with real help text → bounds → example config line → docs → the tests that pin all of it. Everything new is opt-in and byte-stable when unset.

## III.7 Contract tests (what each pins)
- Stop ranks and the halting kinds: `test/guard.test.js`, `test/poller.test.js`.
- Redaction forms and the token shape: `test/errors.test.js`, `test/secrets.test.js`.
- The owner-only, confirmation and route rules: `test/service.test.js`, `test/tools.test.js`.
- Caps and the usage hold: `test/caps.test.js`, `test/service.test.js`.
- Paging never follows a next URL: `test/paging.test.js`, `test/endpoints-*.test.js`.
- The sidecar protocol and error mapping: `test/sidecar.test.js`, `test/sidecar-python.test.js`.
- The HTTP surface (loopback, bearer, Host allowlist, 423 for stops): `test/http.test.js`.
- The one-reply rule and its recovery: `test/service.test.js`, `test/cli.test.js`.

## III.8 Stored-data rules
- `events.jsonl`: append-only, read through cursors. Purge removes only handled events older than the retention (30 days). A dedupe index keeps event ids for 90 days.
- `state.json`: written through a save-before-send rule. A damaged file is quarantined under a numbered name and rebuilt where possible, and the owner is told. Stop records are read back strictly; an unreadable stop starts the service stopped.
- `audit.jsonl`: one line per action, with kinds, codes and identifiers, never message text or raw response text. Recovery counters are rebuilt from it on a start after damage.
- Stored records change additively. A new field is optional on read.

---

# PART IV — PRODUCT PRINCIPLES

1. **No invented limits.** Limits are the platform's, or the owner's own, and the spec or the README cites them.
2. **Clamp to capability, never under-use it.** Within the limit: sent. Beyond it: refused with the reason, never silently shrunk.
3. **Scope boundaries are explicit.** The owner's own account only; no comments on other people's posts; likes and follows only on named targets, one at a time, within caps.
4. **Guardrails must not become outages.** A soft guardrail degrades; a hard stop names its reason and its clear command.
5. **Secrets never leave the machine in identifiable form.** Masked labels only; never in a log, a file, an error or a response.
6. **General over per-name.** No account-specific or media-specific branches.
7. **Everything new is opt-in.** Unset means byte-identical behaviour.
8. **Fail closed.** A value that cannot be read, a stop that cannot be read back, a missing check, an unknown kind: refused, with a message, never assumed safe.
9. **No hand-entered facts where a source exists.** Limits, capabilities and metrics come from the platform's documentation, or are marked unverified in the README.
10. **No speculative features.** Build what was asked; the owner's decisions are the scope.
11. **Every setting is visible** in the CLI or the config, with help text.
12. **The owner's values stay the owner's.** Defaults are safe; nothing overrides an owner value.
13. **Data is never lost by a feature.** Damaged state is quarantined, not deleted; purges remove only handled, expired events.
14. **One release path:** a version bump, a CHANGELOG section, an annotated tag, a GitHub release, and the local gate.
15. **Documentation is a deliverable.** The README is the owner's manual and must match the code.
16. **Unknown is not unsupported.** A feature the platform does not confirm is a live-phase item, not a claimed capability.
17. **Honest wording.** "Built and tested" is not "works on Instagram". The README's live-phase list says which is which.
18. **Never reduce a wide system to fit one scope.** A change extends a mechanism; it does not narrow or bypass it.

---

# PART V — DOMAIN FACTS AND GOTCHAS
Each fact cites its source. The code is the authority; the README and the spec describe it.

- **Outbound caps** (starting values, owner-configurable): any outbound action at least 2 s after the previous one; 200 outbound actions a day in total; likes 10 an hour and 50 a day (likes and unlikes share one counter); follows 20 a day; unfollows 20 a day; owner-sent DMs 50 a day, private replies included; one private reply per comment within 7 days; auto-replies one per sender per 24 hours (the config key is `perConversationHours`) and 100 a day; hashtag searches 30 unique a week; publishing 10 a day locally. Lookups of other accounts are reads with their own buckets: business discovery and mentioned media 50 a day each, not counted in the outbound total. Source: `src/config.js` (`DEFAULT_CAPS`); `src/caps.js`; the owner's rulings in `final-decisions-report.md`.
- **Usage throttle:** when the usage header reads 80% or more, outbound calls return busy for 60 s. A like or unlike on a media target needs one usage reading in the process first. Source: `src/config.js` (`usageThrottlePercent`, `usageBusyMs`); `src/service.js`.
- **Messaging windows:** a DM may be sent within 24 hours of the last inbound message, measured from inbound messages only (comments and mentions do not open it). A private reply may be sent within 7 days of its comment. Source: `src/service.js` (`requireOpenWindow`); `src/events.js` (`lastInboundAt`).
- **Stop kinds:** AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED and RATE_LIMITED stop outbound actions. STATE_CORRUPT and STATE_LOST start the service stopped. Rank: AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, STATE_LOST and STATE_CORRUPT at rank 3; RATE_LIMITED at rank 2. A stop is replaced only by a higher rank. Source: `src/stops.js` (`STOP_RANK`, `rankOf`).
- **Reads and the stop:** a read that returns CHECKPOINT, ACTION_BLOCKED or RATE_LIMITED sets the stop; a read that returns AUTH_EXPIRED does not. Source: `src/service.js` (`READ_STOP_KINDS`); the owner's ruling, 2026-10-22.
- **The poller halts** under AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, STATE_CORRUPT and STATE_LOST. RATE_LIMITED is not a halting kind, so the poller keeps running on it; for outbound it is a persisted stop. Source: `src/poller.js` (`HALTING`).
- **The one-reply record:** if the audit file cannot be read after a damaged-state start, the one-reply flag blocks private replies until a later start rebuilds the records, or the owner runs `ig routes clear-one-reply-flag --confirm` after review. A pre-send failure allows one retry. Source: `src/cli.js`; `src/caps.js`; `src/service.js`.
- **Graph settings:** API version `v26.0`; Instagram base `https://graph.instagram.com`; Facebook base `https://graph.facebook.com`; request timeout 15 s; GET retries up to three, with 1, 2 and 4 s waits; `Retry-After` capped at 60 s. Source: `src/config.js`; `src/graph/client.js`.
- **Paging:** `paging.next` carries `access_token` in its query string, so it is never followed. Only the `after` cursor is used, through the normal read path. Reads page up to 10 pages or 1000 items; a larger request is read as the ceiling. Truncation is reported only when a bound stops the read. Source: `src/graph/paging.js`; the build's P3 finding.
- **Messages edge:** conversation messages are read on `/{conversation-id}/messages` with `fields`, `limit` and `after`, one request per page. This form is a live-phase check. Source: `src/graph/endpoints/messaging.js`.
- **Publishing from the owner's host:** media is read from `media.dir` (default `./media`) and served from `media.publicBaseUrl` (https). Path checks: the real path must stay inside `media.dir`, symlinks included; a file with more than one name (a hard link) is refused. Extensions: images `.jpg`, `.jpeg`, `.png`; video `.mp4`, `.mov`. Sizes: 8 MiB for images, 100 MiB for video. A HEAD check runs before any container request; a 403, 405 or 501 on HEAD falls back to a one-byte Range GET. Image stories are behind `story.images` (default false) until the spike confirms them. Source: `src/graph/endpoints/media.js`; decision O-13.
- **Redaction:** exact-value registration in the raw, URL-encoded and single JSON-escaped forms; a token-shape rule for `IGAA`, `IGQV` and `EAA` prefixes, linear in time, with whole-token boundaries. A token glued to a letter or digit is not masked by the shape rule (a documented limit). Source: `src/redact.js`.
- **HTTP API:** loopback by default, `127.0.0.1:8788`; a Host allowlist; a bearer token for `POST /tools`; the webhook path is 404 unless enabled. Stops return **423 Locked** with the kind in the body; a STOPPED refusal is 409; validation 400; a busy result 429 with its busy fields. A non-loopback host needs `http.allowRemote: true`, is plain HTTP, and prints a warning. Source: `src/http.js`; `src/config.js`.
- **Webhook:** off by default. When enabled, it needs a public HTTPS endpoint, which the owner provides (LIVE-PHASE phase 10). An event stamped more than five minutes ahead gets 503, so the sender retries. Source: `src/webhooks.js`.
- **OAuth:** the redirect server listens on `127.0.0.1:8790`. The long-lived exchange is a POST with the token in the `Authorization` header and the client secret in the form body (decision O-7; Meta documents a GET with the token in the query string, which is not used). Facebook login uses a loopback bridge page that reads the fragment in the browser and posts the token back (decision O-8). Source: `src/oauth.js`.
- **Unofficial route:** instagrapi 3.1.0, pinned exactly, in a Python sidecar. Off by default; needs `routes.unofficial.enabled` and the acknowledgement (`ig routes ack-unofficial --confirm`). The session is stored in the keyring under `unofficial_session`, never in a file. The challenge handlers refuse (decision O-9). A missing instagrapi is `UNOFFICIAL_ADAPTER_ERROR`, not an expired login. Source: `sidecar/ig_sidecar.py`; `src/unofficial/`; `src/unofficial-session.js`.
- **The poller:** interval 60 s; up to 20 threads a tick; spacing 600 ms; a failing thread backs off (1, 2, 4 … 32 ticks); a message stamped more than five minutes ahead is retried for 24 hours, then audited and dropped. Source: `src/poller.js`.
- **Event retention:** 30 days; the dedupe index keeps event ids for 90 days. Source: `src/config.js` (`retentionDays`); `src/events.js`.
- **Tool registry:** 36 tools, 15 of them read-only. Destructive: `ig_stop_clear`, `ig_events_purge`, `ig_comment_hide`, `ig_comment_delete`, `ig_media_delete`. The outbound tools take a `confirm` argument. Source: `src/tools.js` (annotations).
- **Node 22 and timers:** `AbortSignal.timeout` does not keep Node alive while a test awaits it, and the test is cancelled on Node 22. Source: the build's Task 16 fix (IX.4).
- **Secret names:** `SECRET_NAMES` in `src/cli.js` (`owner_token`, `facebook_token`, `api_token`, `app_secret`, `webhook_verify_token`); the unofficial route also stores `unofficial_session` and `unofficial_username` (`src/cli.js`). The environment form is `IG_<NAME>`.

---

# PART VI — SUBAGENT ORCHESTRATION

## VI.1 The loop, as it was run for the build (2026-10-20 to 2026-10-22)
1. Re-anchor: the default branch head, the latest release, `ListAgents`, the ledger's last entry.
2. Investigation → a spec with numbered questions and a recommendation each. The build's specs and plan are in `docs/superpowers/`; its research is in `research_notes/`.
3. The owner answers or delegates. Answers are appended as a binding `USER DECISIONS` block, or recorded as a standing decision (I.7).
4. **One implementer per task**, from the brief, the decisions and II.6. It writes the code and the tests, runs the gate, and reports with its evidence.
5. **A focused read-only reviewer** per task or per fix round, against the diff of that round. The orchestrator triages each finding: fix now, accept with a stated reason, or defer to the final review. Every Important finding was fixed or ruled before its task closed.
6. **Fix rounds** go to the same implementer by message (it keeps its context), with the findings as a numbered list and a stated scope. A re-review checks the round.
7. **A final whole-branch review** (read-only) found no real secret leak; its Important findings were fixed in a final round.
8. Verify every claim (II.5). Report: what shipped, what was verified, deviations, and what was not done.

## VI.2 What goes wrong with agents, and the counter-measure
- **Session limits interrupt a run.** Resume the same agent by message with the on-disk state, and check its last edits before building on them. Every resumed run finished.
- **Snapshot timing.** A review diff against a snapshot taken before the last fix round shows changes that are not the package's own. Take the snapshot when a package closes, and say which snapshot a review uses.
- **Two writers to one file.** The later write can overwrite the earlier. One implementer per file at a time; when two must touch one file, one waits.
- **A reviewer's own rule can be wrong.** Check the rule in the ledger first.
- **A coordinator's snapshot can be wrong.** The first check when a review looks wrong is the base of the diff, not the implementer.
- **Silence.** The brief says the final message is the deliverable.
- **Stray agents.** `ListAgents` before every dispatch.
- **Wrong claims.** Budget half of a report to be wrong. Check each `file:line`. "Unchanged" claims about machine state need the before and after shown.

## VI.3 What a read-only reviewer brief says
Read-only: no writes to the project; no git writes; no re-run of the suite unless a specific doubt needs one; a stated list of what to verdict (ADDRESSED or NOT ADDRESSED, with `file:line`), the findings with severity and `file:line`, the round verdict (PASS, or findings remaining), and the report path.

---

# PART VII — ENVIRONMENT
- **Machine:** Windows 11 Pro. Git Bash and PowerShell 7 are available. Timezone Europe/Bucharest.
- **Tools:** git 2.46.0; Node 24.6.0 (the default); Node 22.12.0 at `D:\tools\node\node-v22.12.0-win-x64\node.exe`; Node 22.13.1 at the Playwright path in III.1; Python 3.13.7; `gh` CLI signed in as `FiredMosquito831` (keyring).
- **Git identity:** `FiredMosquito831`, set globally.
- **Repository:** `D:\Projects2\InstagramApi`. Remote `https://github.com/FiredMosquito831/instagram-api-automation-mcp`, public since 2026-10-23.
- **Live system:** none. Nothing is connected or running.
- **Runtime data:** the service writes `data/` (state, events, audit) and reads `media/` (the owner's publishing folder). Both are created at runtime and are git-ignored. Never read them outside tests.
- **Ports:** the HTTP API on `127.0.0.1:8788` by default; the OAuth redirect on `127.0.0.1:8790`. Check reserved ranges before a live run.
- **Never run:** the real installer of any tool against the owner's home; a live Instagram login; a publish; any write without the owner's consent.

---

# PART VIII — RELEASE HISTORY

| Version | Date | Commit | What |
| --- | --- | --- | --- |
| 0.1.1 | 2026-10-23 | `8abc8b2` (annotated tag `v0.1.1`, GitHub release Latest) | Seeded from git tags and the CHANGELOG. The package renamed to `instagram-api-automation-mcp`; the keyring and MCP names kept on purpose; the constraint wording option A applied; the gate on three Node versions, 1217/1217 each. |
| 0.1.0 | 2026-10-23 | `5b2d517` (tag `v0.1.0`, GitHub release, not Latest after 0.1.1) | Seeded from git tags and the CHANGELOG. The first release of the build as a whole: the service, the routes, the poller and webhook, the event log, the sidecar (off by default), media publishing, redaction and the audit log. 1217 tests on Node 24.6.0 and 22.13.1. No live Instagram call. |
| (pre-release) | 2026-10-20 to 2026-10-22 | the build's 18 tasks, the owner decisions O-1 to O-13, the final review and the P1–P6 packages | Seeded from the build ledger (`.superpowers/sdd/2026-10-20-instagram-automation-build/progress.md`). Not a release. Summarised in the archive. |

---

# PART IX — LEARNINGS (consolidated, deduplicated)

One bullet per lesson, with the evidence that makes it memorable and its origin. Rules that follow from these lessons live in PARTS I–VII; this is the "why".

## IX.1 Verification and evidence
- Re-anchor before analysing. The evidence ladder: real data through the whole path > the real artefact run > a unit test on the changed function > reading the code. (Standing practice.)
- A test that cannot fail is not a test. Prove each guard by removing it and watching its test fail. (The mutation checks of the build, Tasks 1 to 18 and P1 to P6.)
- A review diff against a stale snapshot shows changes that are not the package's own. (Build, P5a review, 2026-10-23.)
- A "concurrent writer" in a shared folder is usually one of our own agents. Check the ledger before treating it as an outside process. (Build, 2026-10-23: a changed `src/http.js` was the F-17 change from an earlier round.)
- A reviewer's own script can encode a rule the owner did not ask for. Read the rule in the ledger first. (Build, P5a, 2026-10-23.)
- A coordinator's snapshot can be the wrong base. Check the base before blaming the implementer. (Build, 2026-10-23.)
- A gate must report every failure as a named check. A gate that crashed on a bad config reported nothing. (2026-10-23, fixed in `scripts/ci-local.mjs`.)
- A test name that claims a mechanism it does not observe is a finding; the untrusted-text marker must be asserted where the code sets it. (Build, Task 14 review, 2026-10-22.)
## IX.2 Agents and briefs
- A subagent can hit its session limit mid-round. Resume it by message with the on-disk state, and check its last edits before building on them. (Build, 2026-10-22 and 2026-10-23, more than five times; every resumed run finished.)
- Two implementers editing the same files at once can interleave edits, and the later write can drop the earlier. Serialise edits per file. (Build, 2026-10-23, the sidecar and HTTP rounds.)
- A fix round that changes a file another agent is editing must wait for that agent, or be sent to it. (Build, 2026-10-23.)
- When a fix changes a rule an earlier test pinned, update the test and show the old and new assertion. (Build, Task 13 and Task 17, 2026-10-22.)
- An agent that finds a defect outside its brief reports it; it does not silently fix it. (Build, the consolidation and test-gap rounds, 2026-10-23.)
## IX.3 Shell and tooling traps on this machine
- `printf` writes single backslashes, so a hand-written JSON file fails to parse (the `.ci-local.json` file, 2026-10-23). Write JSON with the Write tool.
- `gh release view --json isLatest` is an unknown field in this gh version. Use `gh release list` to see Latest. (2026-10-23, the v0.1.0 release.)
- `gh repo edit` takes `owner/repo`; a bare repository name is rejected. (2026-10-23, making the repository public.)
- Git on Windows converts line endings unless `.gitattributes` fixes them; without it the index fills with CRLF warnings. (2026-10-23, the first commit.)
- `node --test --test-reporter=tap` prints `# pass` lines on every version; the default reporter differs between Node 22 and 24. Read the `# pass` lines. (2026-10-23, the Node 22 run.)
- `npm test > file` then `grep` is the reliable way to read counts; a pipe can hide the exit code. (Standing practice.)
- Scrubbing a name from tracked files does not change git history. Check the history separately and say so. (2026-10-23, the path scrub.)
- `--release` records every attempt, including a failed one. (2026-10-23.)
## IX.4 Subsystems
- **Node 22 and timers:** `AbortSignal.timeout` does not keep Node alive while a test awaits it; the test is cancelled on Node 22. Hold a referenced timer during the wait. (Build, 2026-10-22: 11 cancelled MCP tests on Node 22.13.1.)
- **Regex cost:** a token-shape pattern with nested quantifiers goes quadratic on a long run of separators. Test with a 100,000-character input. (Build, P5a, 2026-10-23.)
- **Redaction across a cut:** redact the whole line before any display cut; a value that straddles the cut escapes otherwise. (Build, final review, 2026-10-23.)
- **Stop precedence:** a later, less severe stop must not replace a stored, more severe one. (Build, 2026-10-22, the stop-rank fix.)
- **Recovery:** a readable state with lost cursor keys re-delivers acknowledged events if nothing holds it. Raise the stop when the cursors are unknown, and say so in the notice. (Build, final review, 2026-10-23.)
- **Graph paging:** never follow `paging.next`; it carries the access token. (Build, P3, 2026-10-22.)
- **Graph writes are not retried**, except one provable pre-send retry. An API_ERROR on a write is an unknown outcome, reported to the owner. (Build, Task 7 and Task 13, 2026-10-22.)
- **Lookups are reads**, not outbound actions: their own buckets, the stop check, and no outbound count. (Build, P2 review, 2026-10-22.)
- **Counts on publishing:** a validation error before the request costs nothing; a request that reached Graph keeps its counts. (Build, P2, 2026-10-22.)
- **Stderr from a child** is redacted whole-line before any display cut. (Build, final review, 2026-10-23.)
- **Plain HTTP for a non-loopback host** carries the token in clear text; it needs the explicit `allowRemote` switch and a warning. (Build, final review, 2026-10-23.)
---

# PART X — STILL OPEN

## Priority now
The repository is public. Release 0.1.1 (the package rename) is verified and Latest. The local CI gate passes on three Node versions, and the constraint wording is applied. The next steps are the owner's: the live phase (the test account and the restriction-risk acceptance for phase 11), and the owner's review of the reversible decisions.

## Queued
Nothing is queued. See `QUEUE.md`.

## Awaiting the owner
- **The live-phase test account**, given privately and never in chat or in a commit, and the restriction-risk acceptance for phase 11 (the unofficial sidecar). The plan is `orchestration/LIVE-PHASE.md`; its sign-off records the approval given on 2026-10-23.
- **The reversible decisions** in `final-decisions-report.md`, especially: the account-wide stop on an expired unofficial session; the one-reply flag and its clear command; image stories behind `story.images`.
- **The MCP SDK reading:** SDK v2 negotiates 2026-07-28 through `server/discover`; `initialize` negotiates 2025-11-25. Confirm it.
- **instagrapi 3.1.0**, two days old at pinning: confirm it, or choose 3.0.26.
- **Lookup buckets and the auto-reply scope** are now in the constraint file (option A). Confirm that the code's per-sender auto-reply reading is the owner's intent for group conversations.

## Held
- **Live phase:** approved in principle on 2026-10-23. Waits for the test account and the phase 11 acceptance. Nothing live runs until then.
- **Version 1.0.0:** after the live-phase checks are verified.

## Resolved on 2026-10-23
- The package rename (0.1.1). The keyring service name and the MCP server name are kept on purpose.
- The constraint-file wording (option A, `decisions/C-1-global-constraints.md`).
- The exact Node 22.12.0 run (1217/1217).
- Hosted CI withdrawn in favour of the local gate.

## The owner's own to-dos (remind, never nag)
- Decide the items under "Awaiting the owner".
- Provide the live test account when ready, privately.
- Register the Facebook redirect URI and the app's `response_type` for the live Facebook check, when that phase starts.
