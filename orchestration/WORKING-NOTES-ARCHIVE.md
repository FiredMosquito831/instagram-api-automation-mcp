# WORKING-NOTES-ARCHIVE — the diary and the history of the operating manual

Superseded blocks of `WORKING-NOTES.md`, the dated diary lines, and long version-table cells live here, verbatim, with an index. The manual itself keeps only current truth. Cite a superseded section as `(§N)`; never renumber sections, because specs cite them.

## Index
| Date | Entry |
| --- | --- |
| 2026-10-23 | Initialised by /working-notes. The repository and the 0.1.0 release were created. The manual, the queue and the first handoff were written. |

## Dated diary
- 2026-10-23: `SHIPPED AND VERIFIED BY ME`: version 0.1.0. Commit `5b2d517`, tag `v0.1.0`, GitHub release Latest, not a draft. Gate: 1217 of 1217 on Node 24.6.0 and on Node 22.13.1. The release was made directly on `main`, with no pull request, as the owner asked. Deviations from the manual's default flow: no pull request, no CI, no artefact (the source at the tag is the artefact).
- 2026-10-23: The repository was made public on the owner's go, after a scan of the full git history for real secrets (none; only fixtures). The Windows account name in machine paths was replaced with `%USERPROFILE%` in the tracked files (`a689175`). Older commits keep the name.
- 2026-10-23: Local CI decided by the owner: `npm run ci`, built in `9c903e9`. The first strict run is recorded in `d7277a6`. The gate now runs the suite on every Node version listed in the untracked `.ci-local.json`: 24.6.0, 22.12.0 and 22.13.1 (`be1f443`, recorded in `48450fb`). Hosted CI was withdrawn.
- 2026-10-23: The exact Node 22.12.0 run was done: a verified official build (SHA-256 checked against nodejs.org), installed to `D:\tools\node\`. Result: 1217/1217, exit 0. The engine minimum is now confirmed, not assumed.
- 2026-10-23: The manual was found out of date after the release: the repository was still described as private, the gate as `npm test`, and the CI item as pending. Corrected in `67368d0`, `98cd825`, and in this session's update of WORKING-NOTES, QUEUE, the handoff and CLAUDE.md. The package rename is queued for the owner's decision. The live-phase plan (`orchestration/LIVE-PHASE.md`) and the proposed constraint wording (`orchestration/decisions/C-1-global-constraints.md`) are written and waiting for the owner.
