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
