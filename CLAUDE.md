# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

- The source code exists: `src/`, `bin/ig.js`, `test/`, `sidecar/` (the Python sidecar for the unofficial route), `scripts/mcp-spike.mjs`, and `package.json` (ESM, Node 22.12 or newer, npm).
- Commands: `npm test` runs the suite (`node --test test/*.test.js`): 1217 tests, all passing on Node 24.6.0 and on Node 22.13.1. The CLI entry point is `node bin/ig.js`, with the commands `auth` (`set`, `login`, `facebook`), `serve`, `mcp`, `status` and `routes` (`ack-unofficial`, `login-unofficial`, `clear-one-reply-flag`). There is no lint or CI config yet.
- Status: built, including the owner decisions of 2026-10-22 (O-1 to O-13) and the final review work. The live phase is pending: no live Instagram call has been made. The live checks are listed in `README.md` under "Live-phase checks".
- The spec (`docs/superpowers/specs/2026-10-20-instagram-cli-design.md`) and the plan (`docs/superpowers/plans/2026-10-20-instagram-automation-build.md`) are the references. The build ledger and task reports are in `.superpowers/sdd/2026-10-20-instagram-automation-build/`, with the decision map (`final-decisions-report.md`) and the final review (`final-review.md`).
- The owner decisions, their costs and the open questions are in `README.md` ("Owner decisions") and in the decision map. Two questions for the owner concern this file's constraint copy: `.superpowers/sdd/2026-10-20-instagram-automation-build/global-constraints.md` (line 14, the cursor exception, and line 6, the lookup caps).
- The directory is not a git repository. `.remember/` holds session-memory state from the Remember plugin, not project code.
- Research requests write working notes to `research_notes/<title>/` and final reports to `reports/`.

## Project goal

A Node.js package, managed with npm, that provides an API and a CLI for automating Instagram across its surfaces: profile, posts, comments and other interactions, direct messages, and insights.

## Constraints

- Automation must not be abusive: no spam and no bulk or unsolicited actions.
- Use only haiku-tier models for agents and subagents: pass `model: "haiku"` on every Agent call.
- Both routes are in the build: Meta's official APIs are the default, and the unofficial instagrapi sidecar is off by default and needs an acknowledgement stored in state (`ig routes ack-unofficial --confirm`). The decision is in `docs/superpowers/specs/2026-10-20-instagram-cli-design.md`, and the owner's decisions and open questions are in `README.md`.
- No comments on other people's posts, and no bulk, scraped or unsolicited actions. Likes and follows are on named targets, one at a time, within the caps.
- Publishing reads media only from the owner's own folder (`media.dir`), served from the owner's public HTTPS host (`media.publicBaseUrl`). No upload route is implemented.
- Secrets, tokens and message text never reach a file, a log, an audit line, an error or a tool result. Every output path passes through the redaction layer, and a registered secret is masked by its exact value.
- The event cursor never moves backwards, except for the owner-decided reset after a state loss (the consumer dedupes by event id). The spec and the README describe the exception.

<!-- working-notes:begin (managed by the working-notes skill; edit inside only through /working-notes) -->
## How we work in this repo (orchestration)

**Entry points (read in this order at the start of every session):** the newest `orchestration/HANDOFF-<date>.md` → `orchestration/QUEUE.md` → `orchestration/WORKING-NOTES.md` (PART I, II.2, II.3, II.5, II.6, IV, X, and the dated lessons in PART IX). Specs and their binding `USER DECISIONS` blocks live in `orchestration/specs/`. Verify the live state before relaying anything; report in five lines or fewer; do not dispatch before the owner's go.

**Binding rules (the full text is WORKING-NOTES; these are the ones that are never relaxed):**
1. Discuss before building: read-only investigation → spec with numbered questions and a recommendation each → the owner's one-line answers → `USER DECISIONS (<time>)` appended to the spec → one implementer. Never dispatch before the owner agrees.
2. Safest, 100% working, break nothing: change only what is broken, where it is broken; every module must work and the test suite is the contract; extend, never narrow an existing mechanism; stop and report if the scope seems to require removing behaviour.
3. One release at a time; one concern per release. Subagent calls always pass `model: "haiku"`. At most two agents at once. Announce every dispatch. Run `ListAgents` before a dispatch.
4. The orchestrator verifies every release itself (WORKING-NOTES II.5): the tag resolves to the pushed `main` head, the GitHub release is not a draft and is Latest, the working tree is clean, and `npm test` is green on Node 24.6.0 and on Node 22.13.1. CONFIRMED / UNVERIFIED / NOT DONE, always separated.
5. Tracking at every release boundary: `orchestration/QUEUE.md` (RUNNING / QUEUED / FINISHED / HELD), a release-history row in WORKING-NOTES PART VIII, a dated line in the diary (`WORKING-NOTES-ARCHIVE.md`), and a `HANDOFF-<date>.md` before every pause or compaction. Back up WORKING-NOTES before every edit.
6. Never touch the owner's world: no live Instagram call without the owner's consent and a stated budget; no real keyring entries, no real `IG_*` values, no real config homes, no autostart or registry entries, the owner's PATH. Never read `data/`, `media/` or any credential outside a test. Stop only processes you started, by exact PID.
7. No frozen boundary (the owner's decision, 2026-10-23). Every module must work. A guard that is removed or narrowed needs a test that proves its replacement holds.
8. Tooling: `npm test` for the gate; `node --test test/*.test.js` is the script. Write scripts with the Write tool and run them by path; never a heredoc into an interpreter; never `sed -i` on a tracked file; `python -B` for the sidecar, never `-c` one-liners against the owner's files.
9. Product principles: no invented limits; clamp to capability; unknown is not unsupported; everything new is opt-in and byte-stable when unset; honest wording ("built and tested" is not "works on Instagram"); data is never lost; general over per-name; no speculative features; documentation is the owner's manual and must match the code.
10. Releases: semantic version bumps in `package.json`, a CHANGELOG section, an annotated tag `vX.Y.Z` on the same commit as the change, and a GitHub release. 1.0.0 waits for the live-phase checks to be verified.

**Attribution:** commit messages and PR bodies end with `by FiredMosquito831`.
<!-- working-notes:end -->

