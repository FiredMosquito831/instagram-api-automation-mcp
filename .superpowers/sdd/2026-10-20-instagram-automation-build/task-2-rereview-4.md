# Task 2, fix round 4: re-review (R-a)

Read-only. No project file was edited, no git command was run, no subagent was used, and the full suite was not run. A focused run of `test/errors.test.js` in a scratch copy of `snap\task-2-fix4-head` gives 57 of 57 passing. The project `src\redact.js` is identical to `snap\task-2-fix4-head\src\redact.js`.

The R-a counts come from the reviewer's `measure.mjs`, run unchanged as `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\fix3-review\measure.mjs`, with the project file as the candidate. Comparisons that script does not make (round 4 against round 1 or round 3, and the ordinary samples) come from a scratch copy with appended blocks, `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\r4-review\measure-r4.mjs` and its siblings `measure-r4b.mjs` to `measure-r4g.mjs`. Other scratch scripts are in the same folder: `check.mjs` and `probe.mjs` (forms), `grid.mjs` (NB-1 grid), `timing4.mjs` and `scale4.mjs` (timing), and `whatif\src\redact.js` (a scratch copy with the first-pass rules removed; it is not a proposed fix).

## Finding verdict

**R-a: ADDRESSED**, on the stated criterion: zero new leaks against round 2 on the reviewer's generator, on all four samples.

| Sample (60,000 texts each) | Round 2 leaks | Round 3 new vs round 2 | Round 4 leaks | Round 4 new vs round 2 | Round 4 fixed vs round 2 | Round 4 idempotence failures |
|---|---|---|---|---|---|---|
| Mixed generator, seed 1 (`ra 60000 1`) | 21,811 | 5,406 | 15,771 | **0** | 6,040 | 0 |
| Mixed generator, seed 2 (`ra 60000 2`) | 21,636 | 5,446 | 15,715 | **0** | 5,921 | 0 |
| Single-secret, seed 1 (`ra1 60000 1`) | 18,879 | 4,823 | 13,184 | **0** | 5,695 | 0 |
| Single-secret, seed 7 (`ra1 60000 7`) | 18,847 | 4,892 | 13,262 | **0** | 5,585 | 0 |

The round 3 column reproduces the reviewer's 5,406 and the report's 5,446, 4,823 and 4,892. Round 3 idempotence failures on the same samples are 273, 240, 153 and 170.

Two qualifications. Both are carried into New breakage.

- Against round 3, the same samples show 818, 824, 529 and 542 texts that round 3 masks and round 4 leaks. Round 2 leaks all of them, so they do not count against the R-a criterion. Round 1 masks 358, 372, 253 and 253 of them. Those are round 2 regressions that round 3 had closed and round 4 re-opens (N-1 and N-2 below). The rest also leak on round 1, and round 3 masked them only as a side effect of its order.
- On the implementer's unseeded generator (its `fix3-compare2.mjs`, with the `move` entry pointed at the project file, 60,000 texts, one run; output `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\r4-review\impl-compare-r4.txt`), round 4 gives 6 new against round 2 (round 2 leaks 38,099, round 4 leaks 37,613). The implementer reported 4 on its last run and 6, 10 and 7 on earlier runs. That generator is not the criterion, but the class is not closed on it.

Other families against round 3: the NB-1 family of the reviewer's generator (`nb1 60000 1`) gives 0 new and 0 fixed, with 14,992 texts that have fewer markers and the same leak status. The apikey family (`rb 60000 2`) gives 0 new and 78 fixed. The reviewer's NB-1 generator has no closed member followed by a letter, which is why N-1 is not in its counts.

## Regression check

Each form was run on round 2, round 3 and round 4 (`check.mjs`). "Masked" means no six-character window of the secret remains in the output. All of these give zero idempotence failures on round 4.

| Form, as tested | Round 2 | Round 3 | Round 4 |
|---|---|---|---|
| `token:"token":"EAAB123456"` (closed NB-1 shape 1) | leaks | masked | masked, `token:"[redacted]":"[redacted]"` |
| `apikey=\"api_key\":\"EAAB123456` (brief, unclosed escaped member) | leaks | masked | masked, `apikey=\"api_key\":\"[redacted]` |
| `apikey=\"api_key\":\"EAAB123456\"` (closed) | leaks | masked | masked |
| `apikey%3D\"api_key\":\"EAAB123456` | leaks | masked | masked |
| `cookie="\"token\":\""EAAB123456` (brief, escaped member in a double-quoted cookie) | leaks | masked | masked, `cookie="[redacted]"` |
| `cookie="\"token\":\""EAAB123456\""` (closed) | leaks | masked | masked |
| `access_token="EAAB123456"` | masked | masked | masked |
| `token: 'EAAB123456'` | masked | masked | masked |
| `Authorization: "Basic dXNlcjpwYXNz"` | masked | masked | masked, `Authorization: "[redacted]"` |
| `{access_token: "EAAB123456"}` | masked | masked | masked |
| `token:"token":"EAAB123456` (literal unclosed, O-1) | leaks | leaks | leaks, out of scope (ruled) |
| `apikey=token = EAAB123456` (R-b) | leaks | leaks | leaks, accepted (ruled) |

Ten texts taken from the round 4 tests are all masked on round 4. Round 3 leaked nine of the ten. Common forms `{"access_token":"EAAB123456","x":1}`, `access_token=EAAB123456&x=1`, `Authorization: Bearer EAAB123456` and `password: EAAB123456` are masked on rounds 2, 3 and 4.

The brief's well-formed forms that must stay masked are all masked on round 4. The two forms that still leak are O-1 and R-b, which the controller has ruled.

## Ordinary-text check (against round 3)

Samples, 60,000 texts each: generator C (ordinary text, seeds 3 and 5), generator D (secret-named members with ordinary values, seed 4) and generator E (non-secret keys, seeds 4 and 6).

- C: 0 texts differ from round 3.
- D: 655 texts differ. Markers added: 0. Markers removed: 454. Same marker count with other changes: 201. Of the 655, 391 change only the bare-backslash marker after `apikey=` (round 3 `apikey=[redacted]"...`, round 4 `apikey=\"...`). The other 264 change how far a mask reaches around an escaped or quoted member. In each, round 4 shows at least as much text as round 3: no word that round 3 shows is hidden by round 4. For example, `cookie="\"password\":\"value\"&"note": "ordinary text" x` gives `cookie="[redacted]"` on round 3 and `cookie="[redacted]"note": "ordinary text" x` on round 4.
- E: 391 (seed 4) and 367 (seed 6) texts differ. Each change is only the bare-backslash marker after `apikey=`. Markers added: 0.
- With the secret substituted for the ordinary value (D seeds 4 and 8, E seeds 4 and 6), round 4 adds no leak against round 3 except the two quoted-word shapes in N-1 and N-2.

Conclusion: no new masking of ordinary text against round 3. The controller's criterion "the ordinary corpus is unchanged" is not met literally, since 655, 391 and 367 texts change, all by removing a marker or by showing ordinary text that round 3 hid. No secret is exposed by these changes on the tested inputs, so they are not counted as breakage here.

## New breakage in the fix diff

Total: 0 Critical, 0 Important, 2 Minor.

### N-1 (Minor): the first-pass rules re-open the NB-1 class

- Where: `src\redact.js:59`, JSON_MEMBER_FIRST. Its nested key, separator and quote check, and its closing-quote lookahead `(?="(?!\w))`, reject a member that is then left to KEY_VALUE (`:41`, applied at `:76`). KEY_VALUE takes the member's key as a quoted value, so the secret is left with no key in front of it.
- Shapes (round 1 masks, round 2 leaks, round 3 masks, round 4 leaks):
  - `token:"token":"EAAB123456"ok` (`x` after the quote behaves the same). Round 4 output: `token:"[redacted]":"EAAB123456"ok`. Over the NB-1 member grid (10 outer keys, 5 separators, 10 inner keys, 5 closed member forms; `grid.mjs`), 1,000 of 2,500 texts are new against round 3 with suffix `ok` or `x`, and 0 with an empty suffix or ` end`. None of the grid texts is new against round 2.
  - `apikey="password":"EAAB123456 "quoted" word"; name: demo`. Round 4 output: `apikey="[redacted]":"EAAB123456 "quoted" word"; name: demo`. With the secret substituted for the ordinary value in the D generator, 575 (seed 4) and 589 (seed 8) texts per 60,000 are new against round 3, and 0 against round 2.
- Attribution: a scratch copy with the two lookaheads removed (`whatif\src\redact.js`) gives 0 new against round 3 on both sets above, but returns 5,185 R-a leaks against round 2 on mixed seed 1. So the lookaheads are what closes R-a, and this residual is their cost.
- Severity: Minor, the same class and label as NB-1 (round 2 re-review, Minor). The round 4 tests do not cover this shape. A regression test would be `token:"token":"EAAB123456"ok`.

### N-2 (Minor): an escaped member holding an unescaped quoted secret

- Where: `src\redact.js:41`, the double-quoted alternative of KEY_VALUE. It ends at the first unescaped quote, except that a quote directly after an escaped quote can continue the value when a word character follows it. The order is also relevant: KEY_VALUE (`:76`) runs before ESCAPED_JSON_MEMBER (`:85`), which is the round 2 order.
- Shape: `cookie="\"token\":\"a "EAAB123456" word"`. Round 1 masks it, round 2 leaks, round 3 masks it as `cookie="[redacted]"`, and round 4 leaks as `cookie="[redacted]"EAAB123456" word"`. The outer `cookie="` value ends at the quote after `a `, so the secret after it is outside every match. The same mechanism gives `cookie="\"access_token\":\"a "EAAB123456" word\" "page": 2}`, which round 3 masks and round 4 leaks.
- With the secret substituted into the D generator, 243 (seed 4) and 245 (seed 8) texts per 60,000 are new against round 3, and 0 against round 2.
- Attribution: on mixed seed 1, the scratch copy without the lookaheads still leaves 688 of the 818 new-against-round-3 leaks, so most of the R-a-family residual is this mechanism.
- Severity: Minor, for the same reasons as N-1.

Checked, no further breakage:

- Timing (`timing4.mjs`, 15 pathological inputs of 60,000 to 360,000 characters): round 4 is within about 1.7 times round 2 on every case, and its largest time is 25 ms. `scale4.mjs` shows roughly linear growth from 5,000 to 40,000 repetitions. No stall.
- Idempotence: zero failures on every measure sample (R-a, four; ordinary C, D and E, five; NB-1; apikey) and on the probes. The grids were not checked for idempotence.
- The unquoted-value rule `(?!\\")` at `src\redact.js:41`, which stops an unquoted value from starting with an escaped quote: no new leak against round 3 on the escaped-value shapes, which the D and E substitution sets include through their `apikey=` prefix.
- `test\errors.test.js`: 57 of 57 pass in the scratch copy. None of the nine new tests is an N-1 or N-2 shape.

## Out-of-scope observations

- O-1: the unclosed `token:"token":"EAAB123456` leaks in rounds 1 to 4. Out of scope under the ruling.
- The escaped-value family `apikey=\"S`, `apikey=\"S\"`, `token=\"S\"`, `token:\"S\"` and `password=\"S\"` leaks in rounds 1 to 4. It predates round 2, and it is the family of the documented round 2 ruling 4 limit `access_token=\"`. Not a round 4 change, and not reviewed further.
- The quoted `Authorization: "Basic ..."` form drops the scheme word, as in rounds 2 and 3. The credential is masked.
- OM-1 (accepted) is unchanged.

## Round verdict

R-a is ADDRESSED: zero new leaks against round 2 on all four samples, reproduced.

The round has no new Critical or Important breakage, but it is not clean. Round 4 re-opens two Minor leak classes that round 3 had masked (N-1 and N-2). On the R-a samples that is 818, 824, 529 and 542 texts per 60,000 that round 3 masks and round 4 leaks, of which round 1 also masks 358, 372, 253 and 253. Under the standing ruling, a leak introduced by a fix is fixed whatever its severity label. So N-1 and N-2 need a fix, or a ruling by the controller, before round 4 passes.

Suggested acceptance for the next round, measured on the same samples: zero new against round 2 (R-a); zero new against round 1 and round 3 on the R-a samples; zero new against round 3 on the NB-1 grid with `ok` and `x` suffixes and on the substitution sets (D seeds 4 and 8, E seeds 4 and 6); zero idempotence failures; and the ordinary corpus unchanged against round 3, apart from marker removals the controller accepts.

New issues: 0 Critical, 0 Important, 2 Minor (N-1, N-2).
