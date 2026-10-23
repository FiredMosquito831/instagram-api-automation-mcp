# QUEUE.md — the release queue (binding order since 2026-10-23)

**Rule:** this file is updated at every release start and end, in full detail. Statuses: **RUNNING** · **QUEUED** · **FINISHED** (plus SPEC FIRST, NEEDS GO and HELD as sub-notes). One release at a time. Every release: change → `npm run ci -- --release` passes on every configured Node version → version bump and CHANGELOG section in the same commit → push `main` → annotated tag → GitHub release Latest → verified (WORKING-NOTES II.5) → row flipped to FINISHED here.

Specs live in `specs/` (this folder) and in `docs/superpowers/specs/` (the build's own specs, tracked). "User decisions" names the binding block inside the spec, with the owner's answers and their time.

---

## RUNNING

_(no release running; the last release is 0.1.0, finished 2026-10-23)_

---

## QUEUED (in order)

| # | Item | Version / note | Spec + user decisions | What it does and why |
|---|---|---|---|---|
| 1 | **Rename the package** from `instagram-automation` to `instagram-api-automation-mcp` (`package.json` `name`, the `name` field in `package-lock.json`, and the CLI description if it names the old name) | PATCH 0.1.1 · NEEDS GO | the owner's question, 2026-10-23: "say if you want the package renamed" | The repository and the package name disagree. Nothing is published, so the rename changes no installed behaviour. The recommendation is to rename, so the name a reader sees matches the repository. The release also records the rename in the CHANGELOG. **Needs the owner's go.** |

---

## FINISHED (this arc, newest first; each verified by the orchestrator per WORKING-NOTES II.5)

| Version | Commit | Item | Spec + user decisions | What shipped |
|---|---|---|---|---|
| 0.1.0 | `5b2d517` (tag `v0.1.0`) | **The build as a whole, first release** (created 2026-10-23 09:02 UTC) | the 18 build tasks in `docs/superpowers/plans/`; the owner's 2026-10-22 decisions O-1 to O-13 in `.superpowers/sdd/2026-10-20-instagram-automation-build/final-decisions-report.md`; the 2026-10-23 repository decision | SHIPPED: the service (CLI, loopback HTTP API, MCP server), the owner-only Graph routes with caps, stop state and confirmation, the poller and the webhook receiver (off by default), the durable event log, the unofficial sidecar (off by default), media publishing from the owner's host, redaction, and the audit log. Verified: `npm test` 1217 passing on Node 24.6.0 and on Node 22.13.1, with no skipped or cancelled tests; the Python sidecar check prints `rate_limited`; the tag is on the product commit and the release is Latest, not a draft. Not verified: anything live against Instagram (the README's live-phase list). |

**Other completed work (no release):**

| Date | Item | What was done |
|---|---|---|
| 2026-10-23 | Repository and visibility | Git initialised; first commit `5b2d517`; GitHub repository created and pushed; made public after a history scan for secrets (none real). |
| 2026-10-23 | Path scrub | The Windows account name in machine paths replaced with `%USERPROFILE%` in the tracked files (commit `a689175`). Older commits keep it. |
| 2026-10-23 | Local CI | `npm run ci` (`scripts/ci-local.mjs`) decided and built. Hosted CI withdrawn. First strict run recorded in `orchestration/ci/history.md`. |
| 2026-10-23 | Exact Node 22.12.0 run | The engine minimum, verified official build (SHA-256 checked): 1217/1217, exit 0. |
| 2026-10-23 | Working notes | `orchestration/` manual, queue, handoff, archive and specs; the managed block in `CLAUDE.md`. |

**Investigations finished (no release):** the 2026-10-22 owner decisions (O-1 to O-13), recorded with their costs in `final-decisions-report.md`.

---

## HELD — waits until the owner says go

- **Live phase.** Needs the owner's second test account, the owner's consent, and a stated call budget. The plan is in `orchestration/LIVE-PHASE.md`. Nothing live runs until then.
- **Version 1.0.0.** Reserved for the release after the live-phase checks are verified (WORKING-NOTES II.2).

---

## AWAITING THE OWNER (decisions, not work)

- **C-1, `global-constraints.md` is out of step with the build.** Line 14 lacks the cursor-reset exception. Line 6 lacks the lookup buckets, and the auto-reply scope differs (per sender in the code, per conversation in the constraint). A proposal with exact wording is in `orchestration/decisions/C-1-global-constraints.md`. The owner chooses.
- **Reversible decisions** in `final-decisions-report.md`: the account-wide stop on an expired unofficial session, the one-reply flag and its clear command, and image stories behind the flag.
- **The MCP SDK reading** (SDK v2 negotiates 2026-07-28 through `server/discover`; `initialize` negotiates 2025-11-25).
- **instagrapi 3.1.0**, two days old at pinning: confirm it, or choose 3.0.26.
