# Task 14 focused re-review: fix rounds 2 and 3

Scope: the net change from task-14-head to task-14-fix3-head (review-task-14-fix23.diff). The live files match snap/task-14-fix3-head (checked with cmp). Read-only. The suite was not re-run. The only check beyond reading was a diff of the scratch mutation copy against the live files.

## Finding verdicts

**I-1, ig_hashtag_search readOnly false: ADDRESSED.**
- Code: `src/tools.js:272-279`. The `readOnly: true` line is gone, so readOnlyHint is false (`src/tools.js:100`), idempotentHint is false (`src/tools.js:102`, `idempotentHint: readOnly`), and openWorldHint stays true (`src/tools.js:278`). The diff removes this one annotation line and changes no other tool.
- Test: `test/tools.test.js:53-61`. The READ_ONLY set excludes the tool, with a comment at `:53-54`. The tool's own test at `:170-175` asserts readOnly false, idempotent false and openWorld true.
- Count: the registry has 15 `readOnly: true` lines (`src/tools.js:125, 132, 139, 154, 184, 192, 201, 210, 219, 228, 238, 245, 254, 261, 287`). The report's count of 15 (`task-14-report.md:283`) matches.
- Caveat: the report's main table still shows the old values. See M-R1 under Round verdict.

**M-1, validateArgs with no schema throws VALIDATION: ADDRESSED.**
- `src/tools.js:38-40` throws `IgError` VALIDATION when the schema is not a plain object or its type is not 'object', including undefined. This is the ledger ruling (VALIDATION, not TypeError).
- Test: `test/tools.test.js:245-250` (undefined, null, and a schema with no type).

**M-2, the object type accepts plain objects only: ADDRESSED.**
- `src/tools.js:12-17`. The prototype must be `Object.prototype` or `null`. The check is used by `hasType` (`:25`), the input check (`:46`) and `pick` (`:71`).
- Test: `test/tools.test.js:252-263`. A Date, a Map and a class instance are refused. `Object.create(null)` is accepted.

**M-3, declared-order check with required and type together: ADDRESSED.**
- `src/tools.js:47-54` makes one pass over the declared properties. A required field that is absent, or a present field of the wrong type, throws and names itself. Required names the schema does not declare are checked last (`:55-57`).
- Test: `test/tools.test.js:265-275`. The first case, `{ a: 5 }`, fails under the old code, which named b. The second, `{ b: 1.5 }`, names a. The older test at `:209-213` keeps its name and does not discriminate, but the new test covers the claim.

**M-4, the three missing tests: ADDRESSED.**
- (a) Required fields against undefined args: `test/tools.test.js:277-280` (ig_dm_send names recipientId).
- (b) A declared type outside the list throws: `test/tools.test.js:282-287` (a bigint type next to a wrong-type argument, and an untyped property; both throw TypeError). The earlier test at `:232-236` also covers it.
- (c) NaN and Infinity refused for number and integer: `test/tools.test.js:289-295`. Code at `src/tools.js:22` (Number.isFinite) and `:23` (Number.isInteger rejects NaN and Infinity).
- Also added: findTool with a non-string name, `test/tools.test.js:304-308`.

**M-5, table-driven forwarding over every tool: ADDRESSED, as the fix is written.**
- `test/tools.test.js:319-343`. The loop at `:330` iterates `TOOLS` with no filter. It gives each tool a sample value for every declared property. `sampleOf` throws on an unknown type, so no tool is skipped silently. It asserts one call, to the spec method, with exactly those args (`:341`).
- A missing method fails the test. `fakeService` is built from SPEC (`:82-92`), so the check at `:339` cannot fail on its own. A registry method that the fake lacks makes `service[method]` undefined at `:340`, and the test fails there.
- Residual, not counted: the test checks forwarding against the registry's own schema and the SPEC table. It does not check the argument names that `src/service.js` destructures. A key renamed in the service, which the review's rationale names, is still not caught by any test. This gap predates this round.

**M-6, the untrusted marker: ADDRESSED.**
- The registry test is renamed (`test/tools.test.js:369`). Its assertion is identity (`:381`), so the name now matches what it checks.
- The service markers are asserted in `test/service.test.js`: `:434-442` (businessDiscovery, deepEqual with `untrusted: true`) and `:444-456` (eventsDecide). The eventsDecide test overrides `decide` at `:448-451`, so the fake returns no marker, and asserts `event.untrusted === true` at `:454`.
- The asserted key is the one the service sets. `src/service.js:79` defines `untrusted`, which adds the top-level `untrusted: true`. `src/service.js:695` marks businessDiscovery and `:713` marks eventsDecide.
- Mutation evidence: the scratch copy at `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\mut3` has a test directory identical to the live one. Its src differs from live only at `src/service.js:695` and `:713`, which are the two untrusted calls removed. That matches the claim that the two new tests go red. I did not re-run it.
- The old eventsDecide test could not show the service mark, because the fake decide returns `untrusted: true` itself (`test/service.test.js:88`). The override at `:448-451` closes that gap.

**M-8, frozen constants and TOOLS entries: ADDRESSED.**
- Constants: `src/tools.js:109-117` (each `Object.freeze`). `defineTool` returns `deepFreeze({...})` (`src/tools.js:94-106`). `deepFreeze` is at `:61-67`. TOOLS is frozen at `:119`.
- Test: `test/tools.test.js:385-402`. Each change throws TypeError, because the test module is strict ESM: `annotations.readOnlyHint`, `inputSchema.properties.senderId.type` (this is the frozen ID constant, `src/tools.js:112`), `handler`, and `TOOLS.push`. The values and the count of 36 are unchanged afterwards.

## New breakage

I checked each changed line and its callers.

- validateArgs on a valid call: none. An absent optional field is skipped (`src/tools.js:48-53`; the type check runs only on present fields). A whole-number integer passes (`:23`). A null-prototype object passes (`:16`). Every defineTool schema has type 'object' (`src/tools.js:97`), so the new schema check at `:38` cannot refuse a registry schema. The reordering cannot throw on a valid call, because no field fails in one.
- Freeze: no break found. The handler (`src/tools.js:105`) passes a fresh object from `pick` (`:70-77`), so a handler never mutates a caller's argument. The nested values the service receives are the caller's own objects, which the registry does not freeze. Nothing in `src/` or `test/` assigns to TOOLS, the schemas or the constants. Tasks 15 and 16 are not built yet, so no other consumer exists.
- readOnly: the change touches only ig_hashtag_search. No other tool's annotation changed.
- Tests that pass without asserting their claim: none found. Each new test asserts its claim. `test/tools.test.js:339` cannot fail by itself (see M-5), but `:340-341` assert the claim.
- Fail-open: none. validateArgs is opt-in, and that is the recorded Task 15 and 16 carry-forward, not a change in this round. Non-plain args are refused at `src/tools.js:46` on the validated path.

Notes, not counted:
- N-1: `pick` (`src/tools.js:71`) now returns `{}` for a non-plain args object. Before this round it forwarded the own declared keys of a class instance. This is reachable only when a caller skips validateArgs. The service then fails closed: a confirm tool with no confirm previews, and a missing required field is refused. Latent behaviour change only.
- N-2: the test named "reads are readOnlyHint true" (`test/tools.test.js:153`) now checks membership in a set that excludes two spec reads. The name is loose, but no assertion is weakened.

## Round verdict

Findings remaining: one Minor, documentation only. The code and tests pass.

- All seven in-scope items (I-1, M-1 to M-6, M-8) are ADDRESSED. No new Critical or Important issue. No new breakage on a valid call and no fail-open path.
- M-R1 (Minor, documentation): `task-14-report.md:80` (ig_dm_mark_read) and `:81` (ig_hashtag_search) still show readOnly true and idempotent true in the main table. The corrections exist only in the appended sections (`:199`, `:281`). Fix: edit both rows in place to readOnly false and idempotent false. Row 20 keeps openWorld true.
- Out of scope, already recorded for Task 18: spec line 156 still lists ig_dm_mark_read and ig_hashtag_search under Read.

Counts of new issues: Critical 0, Important 0, Minor 1 (M-R1). The residual M-5 gap and notes N-1 and N-2 are not counted.
