# QUEUE.md — the release queue (binding order since 2026-10-23)

**Rule:** this file is updated at every release start and end, in full detail. Statuses: **RUNNING** · **QUEUED** · **FINISHED** (plus SPEC FIRST, NEEDS GO and HELD as sub-notes). One release at a time. Every release: change → `npm run ci -- --release` passes on every configured Node version → version bump and CHANGELOG section in the same commit → push `main` → annotated tag on that commit → GitHub release Latest → verified (WORKING-NOTES II.5) → row flipped to FINISHED here.

Specs live in `specs/` (this folder) and in `docs/superpowers/specs/` (the build's own specs, tracked). "User decisions" names the binding block inside the spec, with the owner's answers and their time.

---

## RUNNING

_(no release running; the last release is 0.1.1, finished 2026-10-23)_

---

## QUEUED (in order)

_(nothing queued. The next item needs the owner to name it, or the live phase to start.)_

---

## FINISHED (newest first; each verified by the orchestrator per WORKING-NOTES II.5)

| Version | Commit | Item | Spec + user decisions | What shipped |
|---|---|---|---|---|
| 0.1.1 | `8abc8b2` (annotated tag `v0.1.1`, GitHub release Latest) | **Rename the package** to `instagram-api-automation-mcp`, to match the repository (created 2026-10-23 12:06 UTC) | the owner's approval, 2026-10-23: "i approve rename i approve all" | SHIPPED: `package.json` and `package-lock.json` renamed and bumped to 0.1.1; the CHANGELOG section; the constraint wording option A applied to `global-constraints.md`. Kept on purpose: the keyring service name `instagram-automation` and the MCP server's advertised name (stored credentials and client configurations depend on them). Verified: `npm run ci -- --release` passes on Node 24.6.0, 22.12.0 and 22.13.1 (1217/1217 each), the sidecar check, and the token scan (57 files); the tag peels to the release commit and is an ancestor of `main`; no product code changed after the tag; the release is not a draft and is Latest. |
| 0.1.0 | `5b2d517` (tag `v0.1.0`) | **The build as a whole, first release** (created 2026-10-23 09:02 UTC) | the 18 build tasks in `docs/superpowers/plans/`; the owner's 2026-10-22 decisions O-1 to O-13 in `.superpowers/sdd/2026-10-20-instagram-automation-build/final-decisions-report.md`; the 2026-10-23 repository decision | SHIPPED: the service (CLI, loopback HTTP API, MCP server), the owner-only Graph routes with caps, stop state and confirmation, the poller and the webhook receiver (off by default), the durable event log, the unofficial sidecar (off by default), media publishing from the owner's host, redaction, and the audit log. Verified: `npm test` 1217 passing on Node 24.6.0 and on Node 22.13.1, with no skipped or cancelled tests; the Python sidecar check prints `rate_limited`; the tag is on the product commit and the release is Latest, not a draft. Not verified: anything live against Instagram (the README's live-phase list). |

**Other completed work (no release):**

| Date | Item | What was done |
|---|---|---|
| 2026-10-23 | Repository and visibility | Git initialised; first commit `5b2d517`; GitHub repository created and pushed; made public on the owner's go after a history scan for secrets (none real). |
| 2026-10-23 | Path scrub | The Windows account name in machine paths replaced with `%USERPROFILE%` in the tracked files (commit `a689175`). Older commits keep it. |
| 2026-10-23 | Local CI | `npm run ci` (`scripts/ci-local.mjs`) built, and hosted CI withdrawn. Every run is recorded in `orchestration/ci/history.md`. |
| 2026-10-23 | Exact Node 22.12.0 run | The engine minimum, a verified official build (SHA-256 checked against nodejs.org): 1217/1217, exit 0. |
| 2026-10-23 | Working notes | `orchestration/` manual, queue, handoff, archive and specs; the managed block in `CLAUDE.md`; brought up to date after the release. |
| 2026-10-23 | Constraint wording (C-1) | Option A approved by the owner and applied to `global-constraints.md` (in 0.1.1). |

**Investigations finished (no release):** the 2026-10-22 owner decisions (O-1 to O-13), recorded with their costs in `final-decisions-report.md`.

---

## HELD — waits until the owner says go

- **Live phase.** The owner approved the plan in principle on 2026-10-23 ("approve all"). Two things are still needed before any call is made: the **test account** (its handle is given privately, never in chat or in a commit), and the **explicit restriction-risk acceptance** for phase 11 (the unofficial sidecar). Each write in the plan still needs its own yes at the time. The plan is `orchestration/LIVE-PHASE.md`.
- **Version 1.0.0.** Reserved for the release after the live-phase checks are verified (WORKING-NOTES II.2).

---

## AWAITING THE OWNER (decisions, not work)

- **Reversible decisions** in `final-decisions-report.md`: the account-wide stop on an expired unofficial session, the one-reply flag and its clear command, and image stories behind the flag.
- **The MCP SDK reading** (SDK v2 negotiates 2026-07-28 through `server/discover`; `initialize` negotiates 2025-11-25).
- **instagrapi 3.1.0**, two days old at pinning: confirm it, or choose 3.0.26.
