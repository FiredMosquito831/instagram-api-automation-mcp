# QUEUE.md — the release queue (binding order since 2026-10-23)

**Rule:** this file is updated at every release start and end, in full detail. Statuses: **RUNNING** · **QUEUED** · **FINISHED** (plus SPEC FIRST, NEEDS GO and HELD as sub-notes). One release at a time. Every release: change → gate green on Node 24.6.0 and Node 22.13.1 → version bump and CHANGELOG section in the same commit → push `main` → annotated tag → GitHub release Latest → verified (WORKING-NOTES II.5) → row flipped to FINISHED here.

Specs live in `specs/` (this folder) and in `docs/superpowers/specs/` (the build's own specs, tracked). "User decisions" names the binding block inside the spec, with the owner's answers and their time.

---

## RUNNING

_(no release running; the last release is 0.1.0, finished 2026-10-23)_

---

## QUEUED (in order)

| # | Item | Version / note | Spec + user decisions | What it does and why |
|---|---|---|---|---|
| 1 | ~~**Continuous integration** (a GitHub Actions workflow)~~ — **replaced by local CI** (`npm run ci`, decided 2026-10-23) | no release needed | the owner's reply, 2026-10-23: "we can do the CI local" | No hosted CI will be used. The gate is `npm run ci`, which records each run in `orchestration/ci/history.md`. The exact Node 22.12.0 run stays on HELD (below). |

---

## FINISHED (this arc, newest first; each verified by the orchestrator per WORKING-NOTES II.5)

| Version | Commit | Item | Spec + user decisions | What shipped |
|---|---|---|---|---|
| 0.1.0 | `5b2d517` (tag `v0.1.0`) | **The build as a whole, first release** (created 2026-10-23 09:02 UTC) | the 18 build tasks in `docs/superpowers/plans/`; the owner's 2026-10-22 decisions O-1 to O-13 in `.superpowers/sdd/2026-10-20-instagram-automation-build/final-decisions-report.md`; the 2026-10-23 repository decision | SHIPPED: the service (CLI, loopback HTTP API, MCP server), the owner-only Graph routes with caps, stop state and confirmation, the poller and the webhook receiver (off by default), the durable event log, the unofficial sidecar (off by default), media publishing from the owner's host, redaction, and the audit log. Verified: `npm test` 1217 passing on Node 24.6.0 and on Node 22.13.1, with no skipped or cancelled tests; the Python sidecar check prints `rate_limited`; `origin/main` at `5b2d517` = tag `v0.1.0`; the release is not a draft and is marked Latest. Not verified: anything live against Instagram (the README's live-phase list). Not done: the CI workflow (queue item 1). |

**Investigations finished (no release):** the 2026-10-22 owner decisions (O-1 to O-13), recorded with their costs in `final-decisions-report.md`.

---

## HELD — waits until the owner says go

- **Live phase.** Needs the owner's second test account, the owner's consent, and a stated call budget. Its checks are the README's "Live-phase checks". Nothing live runs until then.
- **Node 22.12.0 exactly.** The suite is run on 22.13.1 (the engine minimum is 22.12.0). Held until a 22.12.0 binary is available on the machine, or queue item 1 runs it in CI.
- **Version 1.0.0.** Reserved for the release after the live-phase checks are verified (WORKING-NOTES II.2).

---

## AWAITING THE OWNER (decisions, not work)

- **C-1, `global-constraints.md` is out of step with the build.** Line 14 lacks the cursor-reset exception. Line 6 lacks the lookup buckets and the auto-reply scope. The owner decides the wording.
- **Reversible decisions** in `final-decisions-report.md`: the account-wide stop on an expired unofficial session, the one-reply flag and its clear command, and image stories behind the flag.
- **The MCP SDK reading** (SDK v2 negotiates 2026-07-28 through `server/discover`).
- **instagrapi 3.1.0**, two days old at pinning: confirm it, or choose 3.0.26.
