# specs — investigations and their binding decisions

A spec is written by a read-only investigator before any build. It follows the structure of the template in the working-notes skill (`templates/SPEC.template.md`):

0. The answer in five lines.
1. The problem, as reported, and its reproduction.
2. Measured findings, each CONFIRMED or UNVERIFIED.
3. Every module the change would touch (`file:line`).
4. The options, with their bytes and their risks.
5. The recommendation.
6. The risks.
7. Questions for the owner, one line each, with a recommendation each.
8. CONFIRMED, UNVERIFIED and NOT DONE.
9. What is left on disk.

After the owner answers, the answers are appended here as a binding `USER DECISIONS (<time>)` block, written by the orchestrator, never by an agent.

The build's own specs are in `docs/superpowers/specs/` and its plan in `docs/superpowers/plans/`. This folder holds the investigations that come after the 0.1.0 release.
