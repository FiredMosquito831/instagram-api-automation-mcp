# Working Notes — the operating manual for instagram-api-automation-mcp

The orchestrator's manual: how the owner works, what they verify and reject, repo and release mechanics, the gate and code rules, product principles, domain facts, how agents are run, the machine, every release, every learning, and what is still open. **Current truth only.**

- **Where it lives:** `D:\Projects2\InstagramApi\orchestration\` inside the repo. Tracked in git (owner's decision 6, 2026-10-23). Backups are not tracked.
- **Before editing:** copy it to `WORKING-NOTES.bak-<yyyy-mm-dd-hhmm>.md` beside it. Never modify or delete a `.bak*`. Backups are ignored by git (`.gitignore`).
- **Format:** UTF-8, LF in the repository (`.gitattributes` enforces it). Append with a script that reads `newline=""`, asserts its anchor exactly once, and writes the same newline. Never `sed -i`/`awk` on it.
- **Who edits:** only the orchestrator. Agents never edit it. They report lessons in their final message, and the orchestrator ports them.
- **No secrets** here, ever. Machine paths as `%USERPROFILE%` where possible.
- **History and the dated diary** live in `WORKING-NOTES-ARCHIVE.md` (same folder). Cite superseded sections as `(§N)` and never renumber them, because specs cite them. The dated running log is `HANDOFF-2026-10-23.md`. The current entry point is the newest `HANDOFF-<date>.md`. The release and work queue is `QUEUE.md`. Specs and their USER DECISIONS blocks are in `specs/`.
- **The build's historical record** is not duplicated here. It is `.superpowers/sdd/2026-10-20-instagram-automation-build/` (briefs, task reports, review reports, the progress ledger `progress.md`, `final-decisions-report.md`). It is tracked, and it is the source for the decisions quoted in Part I.7 and Part X.

## Map of this file

| Part | What lives here |
| --- | --- |
| I — How the owner wants to work | ownership, discuss-first, delegation, verification, rejections, communication, standing decisions |
| II — Repo mechanics | git, versioning (semver), the release process, commit and PR shape, the verify recipe, hard rules for every brief |
| III — Gate, testing, code rules | the gate, flakes, test isolation, code rules, boundaries, contract tests, the new-setting checklist |
| IV — Product principles | the rules every change is judged against |
| V — Domain facts and gotchas | what the system's parts actually do |
| VI — Subagent orchestration | the loop, briefs, resume, failure modes |
| VII — Environment | this machine, tools, the live system's status |
| VIII — Release history | one row per version |
| IX — Learnings | one deduplicated list, grouped by theme, each with its origin |
| X — Still open | what is queued, held, awaiting the owner, and the owner's own to-dos |

**Fastest cold start:** the newest HANDOFF, then PART I, II.5, II.6, IV, the last rows of PART VIII, and X.

---

# PART I — HOW THE OWNER WANTS TO WORK

## I.1 Ownership and what "done" means
- The owner's repo, the owner's merge: `FiredMosquito831/instagram-api-automation-mcp` (public since 2026-10-23, on the owner's go; created private the same day). Remote `origin`, default branch `main`. There is no upstream; no pushes or pull requests anywhere else.
- **Pushed is not released.** Released = committed, pushed to `main`, tagged `vX.Y.Z` on the same commit, and a GitHub release published as Latest with its notes. The package is private and is not published to npm.
- Finish end to end. "Done" means the owner can see it working. State the exit criterion in their terms up front, test to it, lead with the negative when it is negative.
- Good behaviour by default: the product does the work; the owner never runs a "do this once" step.
- The live system: none is connected yet. The owner's second test account is pending. The orchestrator never contacts Instagram without consent and a stated budget (Part I.7).

## I.2 Discuss before building
- A change beyond a literal small ask goes: read-only investigation → a spec in `specs/` with numbered plain-language questions, each with a recommendation → the owner answers in one line → a binding `USER DECISIONS (<time>)` block is appended to the spec → one implementer. Never dispatch before the owner agrees.
- Safest, 100% working, break nothing: change only what is broken, where it is broken. Behaviour-preserving work is proven by equality contracts. What cannot meet the bar is left out and named.
- The owner's standing instruction (2026-10-23): every module must be functional and working. There is no frozen boundary. The test suite is the contract, and every change keeps it green.
- Questions to the owner: plain language, only about things they can see or decide.
- Queue discipline: finish the queued items in their order. New ideas wait. After the last queued item, report and let the owner choose.
- Granular releases: one concern per release. Scope additions go to the next release unless they are one line.
- Publishing a release is an outward action on the owner's GitHub account; it proceeds only on the owner's go (standing decision, Part I.7).

## I.3 Delegation, model choice, context
- Delegate investigation and builds; take conclusions only. Protect the orchestrator's context.
- Every agent runs on the session's model, and every subagent call uses `model: "haiku"` (CLAUDE.md constraint).
- At most two agents at once. One implementer at a time for changes to the same files; read-only reviewers may run beside it.
- One written brief per implementer: the contract, every `file:line` grepped, the tests named, the verification and the report path.
- Announce every dispatch in the same message. Run `ListAgents` before a dispatch.
- No diagnostics of the owner's machine unless asked. Agents keep their progress in the ledger. No polling without a bounded timeout.

## I.4 How the owner verifies
- Assume every claim will be checked. The owner tests independently and comes back with counter-evidence.
- Bug reports are precise and usually right: reproduce first, argue never.
- When the owner is frustrated: lead with evidence (command output, counts, file lines), not reassurance.

## I.5 What the owner rejects
- Invented limits; claiming something works without running it; filler documentation; per-name fixes; speculative features; silent changes to retry, fallback, rotation or safety behaviour; a long page as a fix; being told to change their own settings.

## I.6 Communication style
- Lead with the answer, then the evidence. Show real command output.
- Say plainly when wrong, correct it, and move on.
- Separate **CONFIRMED** (ran it; output shown), **UNVERIFIED** (read it in code or docs), and **NOT DONE** (skipped, and why).
- The machine's timezone is Europe/Bucharest (GTBDT in the session clock). Convert before saying "recent".

## I.7 The owner's standing decisions (do not re-ask)
- **2026-10-22, the 13 open decisions (O-1 to O-13):** delegated to the orchestrator. Each was decided toward the most complete option that still fails closed, and each is recorded with its cost in `.superpowers/sdd/2026-10-20-instagram-automation-build/final-decisions-report.md`. The owner can reverse any of them.
- **2026-10-23, repository and release setup:** a git repository and a GitHub repository, `instagram-api-automation-mcp` (public since 2026-10-23). Track everything except credentials and tracking artifacts (snapshot copies, review diffs, session memory). Keep all current work and progress. Releases use semantic version bumps.
- **2026-10-23, the owner's approvals:** the rename to `instagram-api-automation-mcp` (0.1.1); the constraint wording, option A; the live-phase plan in principle ("i approve all"). The live phase still needs a test account (private), a write-by-write consent, and the restriction-risk acceptance for phase 11.
- **2026-10-23, no frozen boundary:** every module must work. The test suite is the contract.
- **2026-10-23, the gate (local CI):** `npm run ci`, run on this machine. It runs the full suite on Node 24.6.0, 22.12.0 and 22.13.1, plus the checks in III.1. No hosted CI is used. No lint or type check is configured.
- **2026-10-23, how the owner works on this project:** decide every open decision yourself and aim for the most complete, resilient version, failing closed; keep all work and progress tracked, except credentials and tracking artifacts (snapshot copies, review diffs, session memory); every module must work; report what is CONFIRMED, UNVERIFIED and NOT DONE; no live Instagram call without consent and a stated budget.
- **2026-10-23, the repository's visibility:** public, on the owner's go. The full git history was checked for real secrets first (none; only fixtures). The Windows account name in machine paths was replaced with `%USERPROFILE%` in the tracked files; older commits keep it.
- **Live system:** no live Instagram call without the owner's consent and a stated budget. A rate-limit answer is inconclusive.
- **Credentials:** the OS keyring holds real secrets. Never read keyring entries or `IG_*` values. Never create a `.env`.

---

# PART II — REPO MECHANICS

## II.1 Checkout, branches
- Checkout: `D:\Projects2\InstagramApi`. One repository, one default branch `main`.
- Commits go straight to `main` for this project (no pull-request flow was requested). Each release is one commit with its version bump, then the tag, then the GitHub release.
- Never `git stash`, `git checkout <file>` or `git reset --hard` on the checkout. Inspect with `git diff`. Compare against an older tag with `git worktree add --detach <path> vX.Y.Z` into a scratch folder, then remove that worktree.
- Re-anchor before analysing: `git -C D:\Projects2\InstagramApi fetch origin --tags` and `git log --oneline -1 origin/main`.
- Line endings: the repository stores LF (`.gitattributes: * text=auto eol=lf`). Scripted edits keep the file's own newline.

## II.2 Versioning (semantic versioning)
- `package.json` `version` is the single source of the version. Bump it in the same commit as the change it describes.
- **PATCH** (0.1.0 → 0.1.1): fixes that change no tool name, HTTP route, MCP tool, config key or stored data format.
- **MINOR** (0.1.0 → 0.2.0): additions: a new tool, route, config key, or capability. Existing names and formats keep working.
- **MAJOR** (0.x.0 → 1.0.0 and later): a breaking change to a tool name, route, config key, stored data, or the stop behaviour. Before 1.0.0, a MINOR may carry a breaking change, and the CHANGELOG must say so in plain words.
- **1.0.0 is reserved** for the release after the live-phase checks in the README are verified on a live test account. Until then the version stays 0.x.
- The CHANGELOG (`CHANGELOG.md`) is the release-notes record. Each release gets a section.

## II.3 Release process
1. Make the change and run `npm run ci -- --release` (III.1) until it passes on every configured Node version. This also appends the run to `orchestration/ci/history.md`.
2. Bump `package.json` `version` and add the CHANGELOG section for the new version, in the same commit as the change.
3. Commit with the attribution line (II.4). Push `main`: `git push origin main`.
4. Tag the same commit as an annotated tag: `git tag -a vX.Y.Z -m "Release X.Y.Z: <headline>"`, then `git push origin vX.Y.Z`.
5. Create the GitHub release from the CHANGELOG section: `gh release create vX.Y.Z --title "vX.Y.Z" --notes "<section>" --latest`.
6. Verify (II.5): the tag resolves to the pushed `main` head, the release is not a draft, and it is marked Latest.
7. Report the release URL, the test counts, and anything not verified.
- The release is the package's artefact. The project publishes no build output; the source at the tag is the artefact.
- Traps that bit: `gh release view --json isLatest` is not a field in this gh version. Read `tagName`, `isDraft`, `isPrerelease`, `url`, `targetCommitish`, and check Latest with `gh release list`.

## II.4 Commit and release-note shape
- Commit message: a short subject, then prose: what was broken, the mechanism (cause, not symptom), what the change does and any non-obvious choice, the verification with real output, and what was deliberately not done.
- **Attribution line:** every commit message and every PR body ends with `by FiredMosquito831`.
- Release notes are the CHANGELOG section: the headline, what was wrong, what to expect, what action is required (with the exact command), and what is known and deliberate.
- Never claim verification beyond what ran.

## II.5 The verify recipe (after every release, before reporting it)
```
git -C D:\Projects2\InstagramApi fetch origin --tags
git -C D:\Projects2\InstagramApi log -1 --format="%h %s" origin/main
git -C D:\Projects2\InstagramApi rev-list -n 1 vX.Y.Z          # must equal the origin/main head
git -C D:\Projects2\InstagramApi ls-remote --tags origin vX.Y.Z  # must show the same commit
gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,url,targetCommitish
gh release list --limit 3                                     # Latest marks the new release
git -C D:\Projects2\InstagramApi status --short                # empty
npm run ci -- --release                                        # the gate: every configured Node version, clean tree, CHANGELOG section
```
- The tag must be an ancestor of `origin/main`, and the product code (`src`, `bin`, `package.json`, `sidecar`, `scripts`) must be unchanged between the tag and `origin/main`. A docs-only commit after a tag is allowed (decided 2026-10-23, when the manual landed after v0.1.0). Check it with `git diff --stat vX.Y.Z origin/main -- src bin package.json sidecar scripts` (empty) and `git merge-base --is-ancestor vX.Y.Z origin/main`.
- Then: append the release-history row (Part VIII), the dated line in the diary (`WORKING-NOTES-ARCHIVE.md`), flip the queue row (`QUEUE.md`), and tell the owner what shipped, what was verified, the deviations, and what was not done.

## II.6 Hard rules for every brief (agents and the orchestrator)
1. Work in the checkout only when the change is the orchestrator's own. Agents work in a scratch copy or a worktree, never the primary checkout, and never delete scratch.
2. Never touch the owner's world: no live Instagram call without consent, no real keyring entries, no real `IG_*` values, no real config homes, no autostart or registry entries, the owner's PATH.
3. Stop only processes you started, by exact PID. Never by image name or substring.
4. Secrets: never read the keyring or any `IG_*` value; never print a command line that contains a value; tokens in test fixtures are fake and must keep an obviously fake shape.
5. Tooling: write scripts and prose with the Write tool and run them by path. Never a heredoc into an interpreter, never `sed -i` on a tracked file.
6. No frozen boundary (owner's decision). Every module must work. A change to a module must keep its tests green and must not weaken a guard; a guard that is removed or narrowed needs a test that proves the replacement holds.
7. Extend, never narrow: list every module a change touches (grepped, `file:line`) and read each before changing it. If a change seems to require removing or bypassing existing behaviour, stop and report.
8. Reporting: the final message is the deliverable (what changed, the proofs with real output, deviations, residual risks, what was not done). Do not edit the manual, the queue or the handoff files.

---

# PART III — THE GATE, TESTING, CODE RULES

## III.1 The gate
- Gate: `npm run ci` (local CI, `scripts/ci-local.mjs`). It runs the suite on Node 24.6.0, on 22.12.0 (the engine minimum, exact: 1217/1217 on 2026-10-23) and on 22.13.1, using the paths in the untracked `.ci-local.json`. The raw suite is `npm test` (script: `node --test test/*.test.js`).
- Node 22.13.1 is the Playwright-bundled runtime at `%USERPROFILE%\AppData\Local\ms-playwright-go\1.50.1\node.exe`. Use it by full path for the second run. Node 22.12.0 is a verified official build (SHA-256 checked against nodejs.org) at `D:\tools\node\node-v22.12.0-win-x64\node.exe`. Do not change the machine's PATH.
- **The gate is local CI:** `npm run ci` (`scripts/ci-local.mjs`), decided by the owner on 2026-10-23. It runs the Node floor, the clean-tree and CHANGELOG checks, the full suite on every Node listed in the untracked `.ci-local.json` (22.12.0 and 22.13.1) and on the Node that runs it (24.6.0), the Python sidecar check, and a token-shape scan of the shipped files. `npm run ci -- --release` is the strict form (clean tree, CHANGELOG section, both Nodes) and appends a line to `orchestration/ci/history.md`. No hosted CI is used.
- No lint or type check is configured.
- Baseline: 1217 tests, all passing on both versions, with no skipped or cancelled tests. The Python sidecar checks run when Python is on PATH and skip with a reason otherwise.
- Never two full test gates at once on the machine.

## III.2 Known flakes
- The sidecar's child-process tests run against a 30-second budget. A child start under heavy parallel load took up to 16.1 s in measurement. If a sidecar test times out under load, classify it first: a load artefact, not a product defect. Do not widen the budget without a measurement.

## III.3 Test isolation
- Tests use injected fakes for fetch, timers, the file system and the clock. No test listens on a port or makes a network call. Tests that touch real files use a temporary directory and clean it up.
- A test that starts a timer uses an injected timer, or holds a referenced timer during the wait. `AbortSignal.timeout` alone does not keep Node alive (a Node 22 finding, Part IX.4).

## III.4 Code rules
- ESM throughout (`"type": "module"`). Node built-ins; the only runtime dependencies are `@modelcontextprotocol/server`, `@napi-rs/keyring`, `commander`.
- Every dependency is pinned exactly. `npm install` is run with `--ignore-scripts` after `npm view <pkg> scripts` is recorded.
- Redaction: every output path passes through `src/redact.js`. A registered secret is masked by its exact value, in the raw, URL-encoded and JSON-escaped forms.

## III.5 Boundaries
- `src/graph/` talks to Meta. Routes call only the endpoint modules. The service (`src/service.js`) is the only path to an outbound write, through `runOutbound`: stop check, route check, owner check, confirmation, caps, usage hold, record, perform, audit.
- Tokens travel only in the `Authorization` header. A token in a URL, a log, an audit line or a tool result is a defect.

## III.6 Every new setting or environment variable
- Constant default → config field → CLI or tool surface with real help text → bounds → example config line → docs → the tests that pin all of it. Everything new is opt-in and byte-stable when unset.

## III.7 Contract tests you will meet
- Stop rank and the halting kinds (`test/guard.test.js`, `test/poller.test.js`).
- Redaction forms and the token shape (`test/errors.test.js`, `test/secrets.test.js`, `test/redact*`).
- Owner-only and confirmation rules (`test/service.test.js`, `test/tools.test.js`).
- Caps and the usage hold (`test/caps.test.js`, `test/service.test.js`).
- Paging never follows a next URL (`test/paging.test.js`, `test/endpoints-*.test.js`).
- The sidecar's protocol and mapping (`test/sidecar.test.js`, `test/sidecar-python.test.js`).

## III.8 Stored-data rules
- The event log (`events.jsonl`) is append-only with a cursor; the state file (`state.json`) is written through a save-before-send rule.
- Stored records: additive fields only. A damaged file is quarantined and rebuilt where possible, and the owner is told.

---

# PART IV — PRODUCT PRINCIPLES

1. **No invented limits.** Limits are the platform's, or the owner's own. Where the spec sets one, it is cited.
2. **Clamp to capability, never under-use it.** Requested within the limit → sent. Beyond it → refused with the reason, never silently shrunk.
3. **Scope boundaries are explicit.** The owner's own account only; no comments on other people's posts; likes and follows only on named targets, one at a time, within caps.
4. **Guardrails must not become outages.** A soft guardrail degrades; a hard stop names its reason and its clear command.
5. **Secrets never leave the machine in identifiable form.** Masked labels only.
6. **General over per-name.** No account-specific or media-specific branches.
7. **Everything new is opt-in.** Unset means byte-identical behaviour.
8. **Fail closed.** A value that cannot be read, a stop that cannot be read back, a missing check: refused, with a message, never assumed safe.
9. **No hand-entered facts where a source exists.** Limits, capabilities and metrics come from the platform's documentation, or are marked unverified in the README.
10. **No speculative features.** Build what was asked; the owner's 2026-10-22 decisions are the scope.
11. **Every setting is visible** in the CLI or the config, with help text.
12. **The owner's values stay the owner's.** Defaults are safe; nothing overrides an owner value.
13. **Data is never lost by a feature.** Damaged state is quarantined, not deleted. Purges remove only handled, expired events.
14. **One update path**: a version bump, a CHANGELOG section, a tag, a GitHub release.
15. **Documentation is a deliverable.** The README is the owner's manual and must match the code.
16. **Unknown is not unsupported.** A feature the platform does not confirm is a live-phase item, not a claimed capability.
17. **Honest wording.** "Built and tested" is not "works on Instagram". The README's live-phase list says which.
18. **Never reduce a wide system to fit one scope.** A change extends a mechanism; it does not narrow or bypass it.

---

# PART V — DOMAIN FACTS AND GOTCHAS

- **Graph paging:** `paging.next` carries `access_token` in its query string. Never follow a next URL. Use the `after` cursor through the normal read path. (The build's own finding, P3.)
- **Stop kinds:** AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED and RATE_LIMITED stop outbound actions. STATE_CORRUPT and STATE_LOST start the service stopped. Reads of CHECKPOINT, ACTION_BLOCKED and RATE_LIMITED set the stop. An AUTH_EXPIRED on a read does not. (Owner rulings, 2026-10-22 and the build's Task 13.)
- **Messaging windows:** a DM may be sent within 24 hours of the last inbound message. A private reply is allowed once per comment, within 7 days of the comment.
- **Publishing:** media is read from the owner's folder and served from the owner's public HTTPS host. A HEAD check runs before any publish request, with a one-byte Range GET fallback when HEAD is refused.
- **The one-reply record:** if the audit file cannot be read after a damaged-state start, the one-reply flag blocks private replies until a later start rebuilds the records or the owner clears the flag (`ig routes clear-one-reply-flag --confirm`).
- **Unofficial route:** instagrapi 3.1.0, pinned. Off by default. Needs the acknowledgement (`ig routes ack-unofficial --confirm`) and the route switch. A session is stored in the keyring, never in a file.
- **Meta's long-lived token exchange** is a POST with the token in the `Authorization` header and the client secret in the form body (decision O-7). Meta's documented form is a GET with the token in the query string, so this is a live-phase check.
- **Facebook login** uses a loopback bridge page that reads the fragment in the browser and posts the token back (decision O-8). Needs a registered redirect URI and a real browser, both live-phase checks.

---

# PART VI — SUBAGENT ORCHESTRATION

## VI.1 The loop that holds up
1. Re-anchor: `origin/main` head, the latest release, `ListAgents`, the ledger's last entry.
2. Investigation → a spec in `specs/` with numbered questions and a recommendation each.
3. The owner answers. Append the answers verbatim as a binding `USER DECISIONS (<time>)` block.
4. One implementer from the spec, the decisions, and the II.6 rules. It changes the code, runs the gate, and reports.
5. Verify every claim (II.5). Review the change with a focused read-only reviewer when it touches security, stops, caps or state. Report: what changed, what was verified, deviations, not done.

## VI.2 What goes wrong with agents, and the counter-measure
- **Session limits interrupt a run.** Resume the same agent by message with the on-disk state; the agent's transcript and the ledger hold the rest.
- **Snapshot timing.** A review diff taken before the last fix round looks bigger than the change. Take the snapshot when a package closes.
- **Two agents editing one file.** The later write can overwrite the earlier. One implementer per file at a time.
- **A reviewer's script can disagree with the intended rule.** Check the rule first, then the script.
- **Silence.** The brief says the final message is the deliverable.
- **Stray agents.** `ListAgents` before every dispatch.

## VI.3 What a read-only reviewer brief says
Read-only: no writes to the project, no git writes, no suite re-run unless a specific doubt needs one, a stated list of what to verdict (ADDRESSED or NOT ADDRESSED, with `file:line`), and a report path.

---

# PART VII — ENVIRONMENT

- **Machine:** Windows 11 Pro. Git Bash and PowerShell 7 are available. Timezone Europe/Bucharest.
- **Tools:** git 2.46.0; Node 24.6.0 (the default); Node 22.12.0 at `D:\tools\node\node-v22.12.0-win-x64\node.exe`; Node 22.13.1 at the Playwright path above; npm 11.x; Python 3.13.7; `gh` CLI signed in as `FiredMosquito831` (keyring).
- **Git identity:** `FiredMosquito831`, set globally.
- **Repository:** `D:\Projects2\InstagramApi`. Remote `https://github.com/FiredMosquito831/instagram-api-automation-mcp` (public, since 2026-10-23).
- **Live system:** none. The owner's second test account is pending. Nothing is connected or running.
- **Runtime data:** the service writes `data/` (state, events, audit) and `media/` (the owner's publishing folder). Both are created at runtime, and both are git-ignored. Never read them outside tests.
- **Ports:** the HTTP API on `127.0.0.1:8788` by default; the OAuth redirect on `127.0.0.1:8790`. Check reserved ranges before a live run.
- **Never run:** the real installer of any tool against the owner's home; a live Instagram login; a publish.

---

# PART VIII — RELEASE HISTORY

| Version | Date | Commit | What |
| --- | --- | --- | --- |
| 0.1.1 | 2026-10-23 | `8abc8b2` (annotated tag `v0.1.1`, GitHub release Latest) | The package renamed to `instagram-api-automation-mcp`; the keyring and MCP names kept on purpose; the constraint wording option A applied; the gate on three Node versions, 1217/1217 each. |
| 0.1.0 | 2026-10-23 | `5b2d517` (tag `v0.1.0`, GitHub release Latest) | First release: the build as a whole. 1217 tests passing on Node 24.6.0, 22.12.0 and 22.13.1 (the exact 22.12.0 run was added 2026-10-23). The repository, the tag and the release were created and verified. No live Instagram call has been made. Scope and limits: CHANGELOG.md and the README. |

---

# PART IX — LEARNINGS (consolidated, deduplicated)

One bullet per lesson, with the evidence that makes it memorable and its origin. Rules that follow from these lessons live in PARTS I–VII; this is the "why".

## IX.1 Verification and evidence
- Re-anchor before analysing. The evidence ladder: real data through the whole path > the real artefact run > a unit test on the changed function > reading the code. (Standing practice.)
- A test that cannot fail is not a test. Prove each guard by removing it and watching its test fail (the mutation checks of the build, P1 through P6).
- A review diff against a stale snapshot shows changes that are not the package's own. (Build, P5a review, 2026-10-23: a snapshot taken before a fix round looked like a second change set.)
- A "concurrent writer" in a shared folder is usually one of our own agents. Check the ledger before treating it as an outside process. (Build, 2026-10-23: a changed `src/http.js` was the F-17 change from an earlier round.)

## IX.2 Agents and briefs
- A subagent can hit its session limit mid-round. Resume it by message with the on-disk state, and check its last edits before building on them. (Build, 2026-10-23, five times.)
- Two implementers editing the same files at once can interleave edits. Serialise edits per file. (Build, 2026-10-23, the sidecar and HTTP rounds.)
- A reviewer's own script can encode a rule that the owner did not ask for. Read the rule in the ledger first. (Build, P5a, 2026-10-23.)
- A review that finds a coordinator-side snapshot error must not blame the implementer. Check the base first. (Build, 2026-10-23.)

## IX.3 Shell and tooling traps on this machine
- `gh release view --json isLatest` is an unknown field in this gh version. Use `gh release list` to see Latest. (2026-10-23, the v0.1.0 release.)
- Git on Windows converts line endings unless `.gitattributes` fixes them. Without it, the index fills with CRLF warnings. (2026-10-23, the first commit.)
- `node --test` output in TAP does not match the `ℹ` summary lines. Read the `# pass` lines instead. (2026-10-23, the Node 22 run.)
- `npm test > file` then `grep` is the reliable way to read counts; a pipe can hide the exit code. (Standing practice.)
- `printf` writes single backslashes, so a JSON file written that way fails to parse. Write JSON with the Write tool. (2026-10-23, the `.ci-local.json` file.)
- A gate that crashes on a bad config reports nothing. Every failure must become a named check. (2026-10-23, fixed in `scripts/ci-local.mjs`.)
- `gh repo edit` takes the owner/repo form; a bare repository name is rejected. (2026-10-23, making the repository public.)
- Scrubbing a name from tracked files does not change git history. Check the history separately and say so. (2026-10-23.)
- `--release` records every attempt, including a failed one, so a dirty tree shows as a failure in the history, not as a missing run. (2026-10-23.)

## IX.4 Subsystems
- **Node 22 and timers:** `AbortSignal.timeout` does not keep Node alive while a test awaits it. A test that waits on it is cancelled on Node 22. Hold a referenced timer during the wait. (Build, 2026-10-22: 11 cancelled MCP tests on Node 22.13.1.)
- **Regex cost:** a token-shape pattern with nested quantifiers goes quadratic on a long run of separators. Test with a 100,000-character input. (Build, P5a, 2026-10-23.)
- **Redaction across a cut:** redact the whole line before any display cut; a value that straddles the cut escapes otherwise. (Build, final review, 2026-10-23.)
- **Stop precedence:** a later, less severe stop must not replace a stored, more severe one. (Build, 2026-10-22, the stop-rank fix.)
- **Recovery:** a readable state with lost cursor keys re-delivers acknowledged events if nothing holds it. Raise the stop when the cursors are unknown. (Build, final review, 2026-10-23.)
- **Graph paging:** never follow `paging.next`; it carries the token. (Build, P3, 2026-10-22.)

---

# PART X — STILL OPEN

## Priority now
The repository is public. Release 0.1.1 (the package rename) is verified and Latest. The local CI gate passes on three Node versions, and the constraint wording is applied. The next steps are the owner's: the live phase (the test account and the restriction-risk acceptance for phase 11), and the owner's review of the reversible decisions.

## Queued
Nothing is queued. See `QUEUE.md`.

## Awaiting the owner
- **The live-phase test account**, given privately and never in chat or in a commit, and the restriction-risk acceptance for phase 11 (the unofficial sidecar). The plan is `orchestration/LIVE-PHASE.md`; its sign-off records the approval given on 2026-10-23.
- **The O-decisions the owner may want to reverse** (the list in `final-decisions-report.md`), especially: the account-wide stop on an expired unofficial session; the one-reply flag and its clear command; image stories behind the flag.
- **The MCP SDK reading** (SDK v2 negotiates 2026-07-28 through `server/discover`; `initialize` negotiates 2025-11-25).
- **instagrapi 3.1.0**, two days old at pinning. Confirm it, or choose 3.0.26.

## Held
- **Live phase:** approved in principle on 2026-10-23. Waits for the test account and the phase 11 acceptance. Nothing live runs until then.
- **Version 1.0.0:** after the live-phase checks are verified.

## Resolved on 2026-10-23
- The package rename (0.1.1). The keyring service name and the MCP server name are kept on purpose.
- The constraint-file wording (option A, `decisions/C-1-global-constraints.md`).
- The exact Node 22.12.0 run (1217/1217).

## The owner's own to-dos (remind, never nag)
- Decide the items under "Awaiting the owner".
- Provide the live test account when ready, privately.
- Register the Facebook redirect URI and the app's `response_type` for the live Facebook check, when that phase starts.
