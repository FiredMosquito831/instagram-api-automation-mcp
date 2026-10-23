# Task 2, fix round 5: re-review

Read-only. No project file was edited, no git command was run, and no subagent was used. The project `src\redact.js` and `test\errors.test.js` are byte-identical to the snapshot `snap\task-2-fix5-head`, and the other project files (`src\errors.js`, `src\audit.js`, `src\config.js`, `test\audit.test.js`, `test\config.test.js`, `package.json`) are unchanged from it.

## Scope and method

- Reviewer's scripts, run unchanged, with the project `src\redact.js` as the candidate:
  - `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\fix3-review\measure.mjs`: the R-a samples, the NB-1 and apikey families, the ordinary sets, and the holdout seeds.
  - `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\r4-review\grid.mjs` (NB-1 grid, four suffixes), `...\scratchpad\r4-review\timing4.mjs`, `...\scratchpad\r4-review\scale4.mjs`, and `...\scratchpad\r4-review\check.mjs` (forms).
  - `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task2-rereview-probe.mjs` with the `fuzz`, `matrix`, `keys` and `registry` modes.
- Comparisons that `measure.mjs` does not make (candidate against rounds 1, 3 and 4, the substitution sets, the holdout residuals) come from `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\r5-review\measure-r5.mjs`. It is a verbatim copy of `measure.mjs` with an appended block (`...\scratchpad\r5-review\block.mjs`), and it uses the reviewer's generators. Round snapshots are `snap\task-2-fix1-head` to `snap\task-2-fix4-head`. Run outputs are in `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\r5-review\` (`u-*.txt` for the unchanged runs, `x-*.txt` for the copy).
- Extra scratch checks: forms across rounds 1 to 5 (`...\scratchpad\r5-review\forms-r5.mjs`), a token-mix fuzzer independent of the reviewer's generators (`...\scratchpad\r5-review\fuzz-new.mjs`, 600,000 texts in three seeds), NB-1 grid idempotence (`...\scratchpad\r5-review\grid-idem.mjs`), scaling and timing (`...\scratchpad\r5-review\timing-cmp.mjs`, `scale-r5.mjs`, `scale-r5b.mjs`), single-rule removal mutants (`...\scratchpad\r5-review\mut\`), and step traces of the replace chain (`...\scratchpad\r5-review\trace\`).
- Calibration: the round 2, 3 and 4 counts reproduce the round 4 review's tables exactly. For example, round 4 leaks 15,771 / 15,715 / 13,184 / 13,262 on the four R-a sets, round 3 leaks 22,585 / 22,517 / 19,231 / 19,327, and round 3 has 273 / 240 / 153 / 170 idempotence failures.

## Criteria

### 1. No new leaks against round 2 on the R-a samples: MET

Samples: mixed seeds 1 and 2 (`ra 60000 1`, `ra 60000 2`) and single-secret seeds 1 and 7 (`ra1 60000 1`, `ra1 60000 7`), 60,000 texts each. Reviewer's `measure.mjs`, unchanged:

| Set | Round 1 leaks | Round 2 leaks | Round 3 leaks | Round 4 leaks | Candidate leaks | Candidate new vs round 2 | Candidate fixed vs round 2 |
|---|---|---|---|---|---|---|---|
| ra 1 | 40,604 | 21,811 | 22,585 | 15,771 | 9,929 | 0 | 11,882 |
| ra 2 | 40,626 | 21,636 | 22,517 | 15,715 | 9,865 | 0 | 11,771 |
| ra1 1 | 36,891 | 18,879 | 19,231 | 13,184 | 9,006 | 0 | 9,873 |
| ra1 7 | 37,259 | 18,847 | 19,327 | 13,262 | 8,961 | 0 | 9,886 |

### 2. No new leaks against round 1 and round 3 on the R-a samples: MET on the named samples

Same four sets, candidate against each earlier round (copy of `measure.mjs`): new vs round 1 = 0, new vs round 3 = 0, and new vs round 4 = 0 on each set. The unseen seeds are in the next section: 3 new vs round 1, 2 new vs round 3, and 1 new vs round 4.

### 3. No new leaks against round 3 on the NB-1 grid (ok, x) and on the substitution sets: MET

- NB-1 grid (reviewer's `grid.mjs`, unchanged; the project file is its round 4 column). Suffix `ok`: 2,500 texts, round 3 leaks 1,000, candidate 500, new vs round 3 = 0, new vs round 2 = 0. Suffix `x`: the same counts. Suffixes `''` and ` end` also give 0 new.
- Substitution sets, D seeds 4 and 8 and E seeds 4 and 6, using the round 4 scratch variant of `r4-extra-block3.mjs` (the secret for the ordinary value, three values skipped) and the five variants of `r4-extra-block5.mjs` (`all_to_S`, `quoted_first`, `quoted_in_middle`, `quoted_pair_first`, `sep_first`). New vs round 3 = 0 in all 24 cells, and new vs round 2 = 0. The holdout sets D 11, D 12, E 11 and E 12 are also 0 in all 24 cells.
- NB-1 family (`nb1 60000 1` and `3`, unchanged): new vs round 2 = 0 and new vs round 3 = 0. Candidate leaks are 10,605 and 10,751, against round 3's 27,828 and 27,802.
- apikey family (`rb 60000 2` and `4`, unchanged): new vs round 2 = 0 and new vs round 3 = 0. New vs round 1 = 1,626 and 1,569. Those are the round 2 apikey regression, which round 3 already leaks (see out-of-scope).

### 4. Zero idempotence failures on all samples: MET

Zero on every set: the four R-a sets, the R-a holdouts, the NB-1 and apikey families, all twelve ordinary sets (C 3, 5, 7, 8; D 4, 8, 11, 12; E 4, 6, 11, 12), the 48 substitution cells, the 10,000-text NB-1 grid, the reviewer's 50,000-string fuzz (0 failures), my 600,000-text token-mix fuzz (0 failures), and the 40 forms.

### 5. The ordinary corpus is unchanged except for the designed changes: MET against round 3 (the written acceptance); NOT MET against round 4 on the literal reading, ruling needed

Ordinary sets, 60,000 texts each, compared at the output level:

| Set | Texts differing from round 3 | Of which marker removals | Markers added vs round 3 | Non-secret word hidden that round 3 shows | Texts differing from round 4 |
|---|---|---|---|---|---|
| C 3, 5, 7, 8 | 0 | 0 | 0 | 0 | 0 |
| D 4 | 391 | 391 | 0 | 0 | 264 |
| D 8 | 333 | 333 | 0 | 0 | 249 |
| D 11 | 354 | 354 | 0 | 0 | 271 |
| D 12 | 348 | 348 | 0 | 0 | 235 |
| E 4 | 391 | 391 | 0 | 0 | 0 |
| E 6 | 367 | 367 | 0 | 0 | 0 |
| E 11 | 354 | 354 | 0 | 0 | 0 |
| E 12 | 348 | 348 | 0 | 0 | 0 |

Against round 4, each text is either round 4's output (the apikey marker removals that round 4 made, kept: 391, 333, 354 and 348) or round 3's output (round 4's "show more" changes, reverted: 264, 249, 271 and 235). No third output appears. Of the reverted texts, 161, 150, 171 and 135 hide a non-secret member value that round 4 shows. Example (D 4): `cookie="\"password\":\"value\"&"note": "ordinary text" x` gives `cookie="[redacted]"note": "ordinary text" x` on round 4, and `cookie="[redacted]"` on the candidate and on round 3.

Reading: the round 4 review's suggested acceptance for the next round is the ordinary corpus "unchanged against round 3, apart from marker removals the controller accepts". The candidate meets that exactly. Against round 4's literal output, 1,019 texts across the D sets differ (513 on seeds 4 and 8, and 506 on holdouts 11 and 12). All of them are round 4's show-more changes, returned to round 3's output. This is the implementer's concern 1. I count criterion 5 as met on the written acceptance and open on the literal reading, for the controller to rule.

## Unseen-seed residuals

Holdout R-a sets, none used in tuning: `ra 60000 3` and `ra 60000 4` (mixed), `ra1 60000 2` and `ra1 60000 9` (single-secret). 240,000 texts in total.

| Set | Candidate leaks | New vs round 1 | New vs round 2 | New vs round 3 | New vs round 4 |
|---|---|---|---|---|---|
| ra 3 | 9,968 | 1 | 0 | 0 | 0 |
| ra 4 | 9,857 | 2 | 0 | 2 | 1 |
| ra1 2 | 8,762 | 0 | 0 | 0 | 0 |
| ra1 9 | 9,047 | 0 | 0 | 0 | 0 |
| Total | | 3 | 0 | 2 | 1 |

The implementer's counts (3 new vs round 1, 2 new vs round 3) reproduce exactly. The round 4 column is new: one of the two texts that are new against round 3 is also new against round 4. The four texts, with the candidate output and the rounds that mask each one:

- **R1 (ra 3).** Input `{"apikey":"\"sessionid\":\"EAAB123456\" access_token%3D"EAAB123456 api_key="EAAB123456"" x`. Candidate `{"apikey":"[redacted]"[redacted]"EAAB123456"" x`. Round 1 masks it. Rounds 2, 3, 4 and the candidate leak it. Carried from round 2.
- **R2 (ra 4).** Input `'"x-api-key": "ok&\"access_token\":\"EAAB123456&token%3D"EAAB123456&sessionid:"EAAB123456"" x`. Candidate `'"x-api-key": "[redacted]"[redacted]"EAAB123456"" x`. Round 1 masks it. Rounds 2, 3, 4 and the candidate leak it. Carried from round 2, and the same family as R1.
- **R3 (ra 4), a round 5 leak.** Input `cookie="\"access_token\":\""access_token":"EAAB123456,access_token=\"EAAB123456\",cookie%3D"EAAB123456"\"}`. Candidate `cookie="[redacted]"EAAB123456"\"}`. Rounds 3 and 4 mask it (`cookie="[redacted]"` and `cookie="[redacted]"access_token":"[redacted]"[redacted]"\"}`). Rounds 1 and 2 leak it. This is new against rounds 3 and 4. Cause, from a step trace of the replace chain: `src\redact.js:71` (QUOTED_ESCAPED_VALUE, added in round 5) ends its masked span at the escaped quote before `,cookie%3D`. Then `src\redact.js:43` (KEY_VALUE's double-quoted alternative, unchanged) ends at the first unescaped quote before `EAAB123456`, and the secret falls outside both matches.
- **R4 (ra 4).** Input `x:cookie="x&y=1,\"secret\":\"EAAB123456\",\"api_key\":\"EAAB123456,cookie="EAAB123456""\"`. Candidate `x:cookie="[redacted]"EAAB123456""\"`. Rounds 1 and 3 mask it. Rounds 2, 4 and the candidate leak it. Introduced by round 4 (the N-1 and N-2 class that round 3 had masked), and not closed here.

Total: 4 texts in 240,000. Three are in the escaped-member-inside-a-quoted-secret family (R1, R2, R4), and one (R3) is new in round 5. Each earlier attempt moved the residual to another shape, as the implementer says, and R3 is an instance of that.

## Well-formed masks

Candidate outputs from `forms-r5` and from the reviewer's `check.mjs` (candidate column). "Masked" means no six-character window of the secret remains.

| Form, as in the brief | Candidate | Rounds 1 to 4 |
|---|---|---|
| `token:"token":"EAAB123456"` (closed) | masked: `token:"[redacted]":"[redacted]"` | r1 masked, r2 leaks, r3 masked, r4 masked |
| `token:"token":"EAAB123456` (unclosed, as written in the list) | LEAK: `token:"[redacted]":"EAAB123456` | leaks in all four rounds (O-1, ruled out of scope) |
| `apikey=\"api_key\":\"EAAB123456` (unclosed) | masked: `apikey=\"api_key\":\"[redacted]` | r1 masked, r2 leaks, r3 masked, r4 masked; the closed form is masked too |
| `cookie="\"token\":\""EAAB123456` (unclosed) | masked: `cookie="[redacted]"` | r1 masked, r2 leaks, r3 masked, r4 masked; the closed form is masked too |
| `access_token="EAAB123456"` | masked: `access_token="[redacted]"` | r1 leaks, r2 to r4 masked |
| `token: 'EAAB123456'` | masked: `token: '[redacted]'` | r1 leaks, r2 to r4 masked |
| `Authorization: "Basic dXNlcjpwYXNz"` | masked: `Authorization: "[redacted]"` (the scheme word is dropped, as in rounds 2 to 4) | r1 leaks, r2 to r4 masked |
| `{access_token: "EAAB123456"}` | masked: `{access_token: "[redacted]"}` | r1 leaks, r2 to r4 masked |

Also masked on the candidate: `{"access_token":"EAAB123456","x":1}`, `access_token=EAAB123456&x=1`, `Authorization: Bearer EAAB123456`, and `password: EAAB123456`. The round 5 shapes B1 to B9 (N-1, N-2, and the inputs of the new tests) are all masked on the candidate, and round 4 leaked all nine. Also newly masked, where round 4 leaked: `password=\"EAAB123456` (unclosed), `token=\"EAAB123456\" was refreshed` (the tail is hidden too), `apikey=\"EAAB123456`, and `token:\"EAAB123456\"`.

Not masked:
- `token:"token":"EAAB123456` (unclosed literal). It leaks in every round (O-1, ruled out of scope). The well-formed form is the closed one, which is masked.
- `apikey=token = EAAB123456` and `apikey=token: EAAB123456` (R-b). Both leak on the candidate and on rounds 2 to 4, and round 1 masks both. The `=` form is the ruled one. The `:` form is the same class (see out-of-scope).

## New breakage in the fix diff

Total: 0 Critical, 0 Important, 6 Minor.

**M-1 (Minor). New leak against rounds 3 and 4 on an unseen seed.** Shape R3 above. Where: `src\redact.js:71` (QUOTED_ESCAPED_VALUE's close check, which accepts a `,` after an escaped quote) and `src\redact.js:43` (KEY_VALUE's double-quoted alternative). It is a leak introduced by this round, so under the standing ruling it must be fixed before the round passes. The reviewer's generators do not reach it (0 on the R-a samples).

**M-2 (Minor). A bare secret after the closing quote of a quoted value, new against rounds 3 and 4.** Examples, with the candidate output and the round 4 output:
- `owner_token=\sessionidapi_key=\"sessionid%3D"}EAAB123456`. Candidate `owner_token=[redacted]"[redacted]"}EAAB123456`. Round 4 `owner_token=[redacted]"sessionid%3D"[redacted]"`.
- `\"x\":access_tokenokowner_token=\"=token%3D"]EAAB123456the endname`. Candidate `\"x\":access_tokenokowner_token=\"[redacted]"]EAAB123456the endname`. Round 4 masks the tail.
- `\"x\":secret=\"sessionid%3D"}cookieEAAB123456:="`. Candidate `\"x\":secret=\"[redacted]"}cookieEAAB123456:[redacted]"`. Round 4 masks it.
- `session_idend=\"token,access_token%3D"}EAAB123456\"token`. Candidate `session_idend=\"[redacted]"}EAAB123456\"token`. Round 4 masks the tail.

Cause, from the step trace: `src\redact.js:90` (BARE_ESCAPED_VALUE, added in round 5). Its close check ends the value at a quote followed by `}` or `]`, and the text after that quote is outside every match. Frequency: 4 texts in 600,000 random token mixes, and 0 in the reviewer's generators. Rounds 3 and 4 masked these only by over-masking the tail. The module's documented limit is that a bare token in free text is not caught (task-2 report, "Limits of redaction"), so the controller may rule these out of scope. If not, fix at `src\redact.js:90`.

**M-3 (Minor). Performance is 2 to 4.6 times round 4 on most shapes; no stall.** Best of three, idle machine, the reviewer's 15 shapes: for example, 53.2 ms against 17.2 ms (`"token":"a` times 20,000, 200 KB) and 33.6 ms against 7.3 ms (`\"token\":\"x` times 20,000, 260 KB). One ratio is 17 times, on a 100,000-backslash run (3.4 ms against 0.2 ms). Growth stays roughly linear: 80,000 to 160,000 repetitions take 2.5 to 2.7 times longer, and about 0.4 s at 3.8 MB. Single run of `timing4.mjs` gave 140 ms on the 200 KB case. Scripts: `...\scratchpad\r5-review\timing-cmp.mjs` and `scale-r5b.mjs`.

**M-4 (Minor). Two comments misdescribe the rules.** `src\redact.js:41` says `\"name\":` is masked "which ESCAPED_JSON_MEMBER masks". That rule masks only secret-named members. `src\redact.js:62` says "A closing quote is masked too". The closing quote is kept unchanged: `src\redact.js:118` re-emits it as `closeQuote`.

**M-5 (Minor). Tests that pin over-masking of ordinary text.** `test\errors.test.js:459`, `:464`, `:479` and `:486`. See Test quality.

**M-6 (Minor). Two tests named after round 4 output.** `test\errors.test.js:493` and `:500`. See Test quality.

Checked, no further breakage:
- Leaks and idempotence on the reviewer's sets (criteria 3 and 4).
- Ordinary output: no marker added, and no non-secret word hidden that round 3 shows (criterion 5).
- No stall: all 15 reviewer shapes are at or below 53 ms in the best-of-three run, and the added shapes scale roughly linearly up to 3.8 MB.
- `errors.js`, `audit.js`, `config.js` and `package.json` are unchanged. The chain order matches its comment (`src\redact.js:115-116`).

## Test quality

My runs:
- In the project, `node --test test/errors.test.js test/audit.test.js test/config.test.js` gives 103 of 103 passing. `errors.test.js` has 68 tests, 57 before and 11 added.
- The new test file run against round 4's `src` gives 7 failures (test lines 448, 452, 459, 464, 472, 479 and 486). The other four pass on round 4 (493, 500, 508 and 527). This matches the implementer's red check.
- Removing any one of KEYED_MEMBER_AFTER_SECRET, QUOTED_ESCAPED_VALUE, QUOTED_ESCAPED_SINGLE, BARE_ESCAPED_VALUE or JSON_ESCAPED_OPEN from the chain, in scratch copies, fails exactly one test each time.

What they pin:
- Nine of the eleven assert exact output strings. Two are property checks: 508 (idempotence on samples) and 527 (no secret, and stable).
- Behaviour that matters, and is pinned: N-1 (448, 452), N-2 (459 first assertion, 472), a bare escaped value (464, second assertion), a member with no closing quote (479, first assertion), a single-quoted escaped secret (486, first part), and non-secret members kept visible (493 and 500).
- Implementation output pinned where the requirement is not stated (M-5). Line 459, second assertion, expects `"page": 2}` to disappear. Line 464, first assertion, expects ` end` to disappear. Line 479 expects `\"}` to disappear. Line 486 expects the ordinary ` and ` between secret parts to be masked. These are fail-closed choices. As written they would break if masking were tightened, and they do not state the requirement, which is that no secret remains and that ordinary text is kept where the design promises it. A better form: assert that the secret is absent and that `[redacted]` is present, and keep the exact output only where the kept text is the requirement.
- Line 452 expects `quoted" word` to be shown after a secret value that stops at its first quote. That is acceptable for Graph tokens, which have no embedded quotes. But the test presents a partial exposure of a value with an embedded quote as expected behaviour, without saying so.
- Lines 493 and 500 are named "ordinary text keeps its round 4 output", which names history rather than behaviour. Their assertions do pin real behaviour: the non-secret member `"note": "ordinary text"` stays visible, and the text after a closing quote is not hidden. Rename them to say that.
- Gap: no new test covers M-1 or M-2. Both inputs are masked by round 4, so they work as regression tests once fixed: `cookie="\"access_token\":\""access_token":"EAAB123456,access_token=\"EAAB123456\",cookie%3D"EAAB123456"\"}` and `owner_token=\sessionidapi_key=\"sessionid%3D"}EAAB123456`.

## Out-of-scope observations

- **R-b scope (ruling).** The ruled form `apikey=token = <v>` is one instance of `key SEP secret-word SEP value`. The 600,000-text fuzz found 28 texts that round 1 masks and the candidate leaks. The printed examples are all of the chained form (I did not classify all 28), for example `session_id = password = EAAB123456session_id` (candidate `session_id = [redacted] = EAAB123456session_id`) and `session_id: tokenaccess_token = EAAB123456}]session_id`. It was introduced in round 2 and is unchanged here. The ruling text names only the `=` form, so the controller should confirm that the whole family is covered. The `apikey=token: <v>` form is in the same class.
- **Pre-existing, not in the R-a family.** A non-secret escaped member holding the secret after a secret key with `=`: `token=\"name\":\"EAAB123456` (and the closed form), `token=abc\"name\":\"EAAB123456\"`, `password=\"name\":\"EAAB123456\"`. All of these leak in rounds 1 to 5.
- **Carried unchanged.** The unclosed JSON member string (`"access_token": "<v>`), `access_token%3A<v>`, encoded JSON, `password=Basic <v>`, and `token: basic <v>` (the reviewer's matrix, 6 LEAK rows, none new). Also N2 from round 2: a registered prefix leaves the rest of the value, as in `token=[redacted]m2 done`.
- **Fail-closed trade-off.** The escaped-value rules hide everything to the end of the text when there is no closing delimiter, so `token=\"EAAB123456\" was refreshed` gives `token=\"[redacted]`. This is not a leak, but it costs readability.
- **Complexity.** Five patterns added and three changed, in a chain of eleven replacement steps. The zero counts are measured on the generators, probes and fuzz. They are not proven, and M-1, M-2 and the residuals show that the class is not closed.

## Round verdict

**Findings remain open.**

Criteria:
1. Met. Zero new against round 2 on all four R-a sets.
2. Met on the named R-a samples (zero new against rounds 1 and 3). Not met on unseen seeds: 3 new against round 1, 2 new against round 3, and 1 new against round 4 in 240,000 texts. Open: M-1 (round 5), and the carried residuals R1, R2 and R4.
3. Met. The NB-1 grid (ok and x) and the substitution sets show zero new against round 3 (48 cells).
4. Met. Zero idempotence failures on every set and on both fuzzers.
5. Met against round 3, which is the round 4 review's written acceptance. Not met on the literal reading against round 4, because 1,019 texts return to round 3's output. Ruling needed.

Open findings to close before the round passes (standing ruling: a leak introduced by a fix is fixed, whatever its severity label):
- M-1: the R3 leak. Fix at `src\redact.js:71` and `:43`.
- M-2: the bare-token leak after a quoted value. Fix at `src\redact.js:90`, or a controller ruling that it is out of scope.

Open for ruling:
- Criterion 5, literal reading against round 4 (1,019 texts).
- The R-b family scope.
- Residuals R1, R2 and R4. They are carried from rounds 2 to 4 and are not new in this round. Criterion 2 covers only the named samples.

Minor, to fix in the same round: M-3 (accept or note), M-4 (comments), M-5 and M-6 (tests), and the two round 5 leak inputs added as regression tests.

New issues: 0 Critical, 0 Important, 6 Minor (M-1 to M-6).
