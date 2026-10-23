# Task 2, fix round 3: re-review

## Scope and method

Read-only. No project file was edited, no git command was run, no subagent was used, and the full suite was not run. The only project test command was a focused run of the four new round 3 tests in `test/errors.test.js` (4 of 4 pass). `test/errors.test.js` matches the `task-2-fix3-head` snapshot.

Baseline: round 2 is `snap\task-2-fix2-head`. The current `src\redact.js` and `src\errors.js` match `snap\task-2-fix3-head`. The only change to `src\redact.js` from round 2 is the moved block and its comment.

Definitions. "New" means round 3 leaks and round 2 masks. "Leak" means any 6-character window of the secret remains in the output. "Pre-existing" means both leak. "Fixed" means round 2 leaks and round 3 masks.

Scratch scripts, all under `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\fix3-review\`:
- `shapes.mjs`: the exact shapes, for head, rounds 1, 2 and 3.
- `measure.mjs`: seeded generators and counts. Modes: `ra`, `ra1`, `rb`, `nb1`, `ordinary`, `ordinary2`, `ordinary3`.
- `build-cand.mjs` and `cand\src\`: the implementer's proposed lookahead, built in scratch only. It was not applied.
- `timing.mjs`, `stringify-check.mjs`, `cand-shapes.mjs`.

The generators are mine. The counts depend on the generator mix, so each count names its generator.

## Finding verdicts

### NB-1, the three quote-wrapped shapes: ADDRESSED

Exact shapes (round 3 is idempotent on each):

| Shape | Round 2 | Round 3 |
|---|---|---|
| `token:"token":"EAAB123456"` | `token:"[redacted]":"EAAB123456"` (leaks) | `token:"[redacted]":"[redacted]"` |
| `apikey=\"api_key\":\"EAAB123456` | `apikey=[redacted]"api_key\":\"EAAB123456` (leaks) | `apikey=[redacted]"api_key\":\"[redacted]` |
| `cookie="\"token\":\""EAAB123456` | `cookie="[redacted]"EAAB123456` (leaks) | `cookie="[redacted]"` |

Variants masked in round 3: `apikey%3D\"api_key\":\"EAAB123456`, the closed form of shape 2 (`...EAAB123456\"`), and the closed form of shape 3 (`cookie="\"token\":\""EAAB123456\""`).

Family check. Generator F (a secret key, a separator, then a JSON or escaped member holding the secret, with closed and unclosed forms), 60,000 texts each, seeds 1 and 2:
- Round 2 leaks all 60,000 in both samples.
- Round 3 leaks 27,828 and 27,865. Every one of those also leaks in round 1, so new versus round 1 is 0 and new versus round 2 is 0.
- Round 3 fixes 32,172 and 32,135 round 2 leaks.

Tests. The three shape tests (`a JSON member after an outer token key...`, `an escaped JSON member after apikey=...`, `an escaped JSON member inside a double-quoted cookie value...`) pass on the outputs above.

Not covered by NB-1: the unclosed form `token:"token":"EAAB123456` still leaks in head, round 1, round 2 and round 3 (see O-1).

## Regression measurements

### R-a: New breakage, Minor. Confirmed

Counts, new versus round 2:

| Sample | Texts | New vs round 2 | Fixed vs round 2 | Pre-existing | New vs round 1 |
|---|---|---|---|---|---|
| Mixed nested-quote generator, seed 1 (`measure.mjs ra`) | 60,000 | 5,406 | 4,632 | 17,179 | 324 |
| Single-secret generator, seed 1 (`ra1`) | 60,000 | 4,823 | 4,471 | 14,408 | 371 |
| Single-secret generator, seed 7 (`ra1`) | 60,000 | 4,892 | 4,412 | 14,435 | 349 |
| Implementer's generator, `fix3-compare2.mjs 60000`, re-run | 60,000 | 243 | 726 | not reported | 26 |

Net effect on the same samples: round 3 leaks 774 more texts than round 2 on the mixed sample (21,811 to 22,585), and 352 and 480 more on the single-secret samples. On the implementer's generator it leaks 483 fewer (38,228 to 37,745). The net result depends on the generator.

The implementer's figure of 237 reproduces in magnitude: their script gives 243 on a re-run at 60,000 texts. Its default is 100,000 texts, where it gives 374. Their generator produces fewer texts in this class, and mine concentrates on it, so the count is generator-dependent. The shape is the same.

Idempotence. `redact(redact(x))` differs from `redact(x)` for 273 texts (mixed, seed 1), 153 (single-secret, seed 1) and 170 (single-secret, seed 7). Round 2 has 0 failures in each sample. In every round 3 failure the first pass leaks, and the second pass masks part of the leftover secret. Of the 273, 192 are new versus round 2. The other 81 also leak on round 2, but round 2 is idempotent on them. I count this as a symptom of R-a, not as a separate issue.

Concrete shapes (round 2 masks, round 3 leaks):
1. `x:"token":"session_id="EAAB123456 end`. Round 2 `x:"token":"[redacted]"[redacted]"`. Round 3 `x:"token":"[redacted]"EAAB123456 end`.
2. `"token":"apikey="EAAB123456 end`. Round 2 `"token":"[redacted]"[redacted]"`. Round 3 `"token":"[redacted]"EAAB123456 end`.
3. `"token":"session_id%3D"EAAB123456"`. Round 2 `"token":"[redacted]"[redacted]"`. Round 3 `"token":"[redacted]"EAAB123456"`.

Mechanism. Round 2 ran KEY_VALUE first. Its quoted alternative (`src\redact.js:37`) took `session_id="EAAB123456 end` whole, so the secret was masked. In round 3, JSON_MEMBER runs first (`:62`). Its value class `(?:[^"\\]|\\.)*` (`:41`) stops at the first unescaped quote, so it ends at the nested quote and replaces `"token":"session_id="`. The secret after that quote has no secret key in front of it, so KEY_VALUE does not match it.

Where it reaches. It needs an unescaped `"` inside a secret-named JSON member value, placed after `key=`, `key:` or `key%3D`. In practice the route is a raw string value in an object: `redact({ message: 'x:"token":"session_id="EAAB123456 end' })` gives `{"message":"x:\"token\":\"[redacted]\"[redacted]\""}` on round 2 and `{"message":"x:\"token\":\"[redacted]\"EAAB123456 end"}` on round 3. JSON.stringify escapes these quotes, so stringified text does not reach this shape (`stringify-check.mjs`).

### R-b: pre-existing. A round 2 regression that round 3 does not fix, not a round 3 breakage

Concrete shapes (head also leaks all three):

| Shape | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| `apikey=token = EAAB123456` | `apikey=token = [redacted]` | `apikey=[redacted] = EAAB123456` (leaks) | same as round 2 (leaks) |
| `apikey=token: EAAB123456` | `apikey=token: [redacted]` | `apikey=[redacted] EAAB123456` (leaks) | same (leaks) |
| `apikey=token = EAAB123456 end` | `apikey=token = [redacted] end` | `apikey=[redacted] = EAAB123456 end` (leaks) | same (leaks) |

Mechanism. `apikey` became a secret key in round 2 (O2). Its unquoted value takes `token` (`src\redact.js:37`), and the `= EAAB123456` after it has no key in front of it.

Counts. Generator B (apikey family), 60,000 texts, seed 2: round 2 leaks 44,347 and round 3 leaks 44,347, the same set. New versus round 2 is 0, and fixed is 0. New versus round 1 is 1,626, which is the round 2 regression.

The 286 in the brief. In the report, 286 is the figure for the unapplied lookahead candidate (`task-2-report.md`, measurements paragraph: "37,352 leaks, 286 new vs r2"), not for round 3. The report's round 3 figure on its separate sample is 245 (`task-2-report.md`, "Points that need your ruling", item 2). On my R-b sample round 3 adds none, so the 245 is the R-a class. I could not reproduce the separate sample, so I can confirm neither number directly.

Candidate, the lookahead, measured in scratch only. It masks the three R-b shapes. It adds new leaks against round 2: 25 on my R-b sample (fixed 15,403), and 5,579 on the R-a sample, where round 3 has 5,406. Example: `apikey=x-api-key: access_token="EAAB123456&x=1}`. Round 2 gives `apikey=[redacted] access_token="[redacted]"`. The candidate gives `apikey=x-api-key: [redacted]"EAAB123456&x=1}` (leaks). The lookahead tests only whether the value starts with a secret word, so `access_token=` is taken as the value. I recommend not applying it as specified.

## New breakage in the fix diff

1. **R-a, Minor, leak.** `src\redact.js:62` (JSON_MEMBER moved ahead of KEY_VALUE), with the value class at `:41`. Shapes and counts are under R-a above. Under the controller's ruling this must be fixed. A fix needs a quote-aware change; I did not test a candidate.

2. **OM-1, Minor, new over-masking.** `src\redact.js:63` (ESCAPED_JSON_MEMBER moved ahead of KEY_VALUE), with the end check at `:46`. Its `|$` fallback masks to the end of the text when no terminator follows.
   - `cookie="\"x-api-key\":\"x=1&y=2\"; "name": "demo" x`: round 1 leaves the text in clear, round 2 gives `cookie="[redacted]"name": "demo" x`, round 3 gives `cookie="[redacted]"`.
   - `apikey=\"token\":\"The token is valid\"; name: demo}`: round 2 gives `apikey=[redacted]"token\":\"The token is valid\"; name: demo}`. Round 3 gives `apikey=[redacted]"token\":\"[redacted]`, which masks `name: demo}`. Round 1 also masks that tail.
   - Count: 464 of 60,000 texts (generator D, seed 4). Round 1 also masks the non-secret text in 327 of them, and leaves it in clear in 137.
   - Every one has `key="`, `key=\"` or `key%3D"` directly before an escaped secret-named member. No secret is exposed. Needs a ruling: accept as a fail-closed trade-off, like NB-2, or bound the escaped member's value to its line.

Ordinary-text over-masking (the brief's check):
- Text with no secret-named member: no change from round 2. Generator C (prose and JSON with non-secret keys, seeds 3 and 5, 120,000 texts) and generator E (non-secret keys with secret-like values such as "The token is valid", seeds 4 and 6, 120,000 texts) give 0 differences.
- Secret-named members with ordinary values (generator D, seed 4, 60,000 texts): 1,298 texts differ, and none removes a marker. 834 are designed masks: round 3 masks the value of a secret-named member that round 2 left visible. Example: `apikey=\"api_key\":\"it's fine\", count=3 end`, where round 2 leaves `it's fine` and round 3 masks it. Of these, 660 match my value list. The other 174 do not match it, and I checked that none of them hides a non-secret word. The 464 OM-1 texts make up the rest.

Checked, no new breakage:
- Timing: eight pathological inputs of 80,000 to 320,000 characters (`timing.mjs`). Round 3 stays within about 2x of round 2. The largest ratio is on a 100,000-character input, 1.5 ms on round 2 and 3.0 ms on round 3. No stall.
- The four new tests pass.
- Registry and key masking: the move does not touch them, and I did not re-check them.

## Out-of-scope observations

- O-1. `token:"token":"EAAB123456` (NB-1 shape 1 without the closing quote) leaks in head, round 1, round 2 and round 3. It is pre-existing since head. The NB-1 test covers only the closed form.
- O-2. JSON text with a `key="secret"` pair inside a string leaks. Input `{"token":"x","message":"session_id=\"EAAB123456\" end"}` gives `{"token":"[redacted]","message":"session_id=[redacted]"EAAB123456\" end"}` on both round 2 and round 3. The leak is pre-existing, and it is the ruling 4 gap from round 2.
- O-3. The implementer's idempotence fuzz (0 failures in 50,000 random strings) does not cover the R-a class. My structured samples show 153 to 273 round 3 failures per 60,000 texts, and 0 for round 2.
- O-4. The report's counts are not exactly reproducible: its script gives 243 at 60,000 texts on a re-run (report 237), and defaults to 100,000 texts (374). This does not change the verdict.

## Round verdict

Findings remain open.

NB-1 is ADDRESSED. All three shapes and their variants mask in round 3, and the NB-1 family has no new leak against round 1 or round 2. The round has no new Critical or Important breakage.

Open findings:
- R-a: new leak, Minor, `src\redact.js:41` and `:62`. Required under the ruling.
- OM-1: new over-masking, Minor, `src\redact.js:46` and `:63`. Needs a ruling.
- R-b: a pre-existing round 2 regression that round 3 does not fix. Not a new breakage in this round. The proposed lookahead is not a clean follow-up as specified.

New issues: 0 Critical, 0 Important, 2 Minor.
