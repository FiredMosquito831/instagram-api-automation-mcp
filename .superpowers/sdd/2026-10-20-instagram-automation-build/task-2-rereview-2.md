# Task 2, fix round 2: re-review

## Scope and method

Read-only. No project file was edited, no git command was run, no subagent was used, and the full suite was not re-run.

Inputs: the brief; the N1, N3, O1 and O2 entries of `task-2-rereview-1.md`; the round 2 section of `task-2-report.md`; `review-task-2-fix2.diff`; the current `src/redact.js` and `test/errors.test.js`. The project files match `snap/task-2-fix2-head` (checked with `diff`). "New" means masked by `snap/task-2-fix1-head` and not masked now. Forms that already leaked in fix1 are not counted.

Focused checks. The scripts are in `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\fix2-review\`.
- `probe-a.mjs`: N1, N3 and O2 cases; O1 forms with idempotence; timings at 160,000 characters.
- `probe-b.mjs` and `probe-e.mjs`: differential fuzz of fix1 against fix2 and against a scratch candidate (`cand\src\redact.js`). 1.3M structured random strings over five seeds, with idempotence.
- `probe-c.mjs` and `probe-h.mjs`: quote-form table (head, fix1, fix2), ordinary-text corpus, exact outputs of the new-leak cases.
- `probe-d.mjs`: scaling sweep, 18 shapes at 40k to 320k units.
- `probe-i.mjs`: key rule, fix1 against fix2, 199,313 unquoted samples.
- `probe-f.mjs`: out-of-scope forms.
- Focused tests: `node --test --test-name-pattern=...` on the eleven new N1, N3, O1 and O2 tests in the project (11 pass). The 44-test `errors.test.js` on the scratch candidate (44 pass).

## Finding verdicts

### N1, a registered value or key=value text inside an object key: ADDRESSED

- The key is now passed through `maskText` at `src/redact.js:98` (comment at `:96-97`). `SECRET_KEY.test` still runs on the raw key, so a secret-named key still masks its value.
- Results (fix2): `{Kx8mPq4Rs1: 'v'}` with the value registered gives `{"[redacted]":"v"}`. `{'x Kx8mPq4Rs1': 1}` gives `{"x [redacted]":1}`. `{'https://g?access_token=Qz9xWv7Lm2': '[redacted]'}` gives `{"https://g?access_token=[redacted]":"[redacted]"}`. `{'owner access_token': 'plain-value'}` gives the value `[redacted]`. Nested keys and Error details behave the same way.
- Tests, all passing: `test/errors.test.js:294` (registered value used as a key), `:300` (key holding `access_token=<value>`), `:306` (secret-named key still masks its value).

### N3, quadratic stall on a long run of word characters: ADDRESSED (whole-run approach accepted)

- No length bound was added, as the implementer reported. The key is the whole run of word characters, guarded by a lookahead that the run contains a secret word (`src/redact.js:16-18`, used at `:37`, `:41` and `:46`). The backslash closing check is guarded by `(?<!\\)` at `:46`, so a long backslash run is scanned once.
- Timings for 160,000-character inputs: `token` x 32,000 takes 16.5 ms on the first call and 5.0 ms warm. `'a'` x 160,000 followed by `token=abc` takes 7.8 ms. `token=` x 32,000 takes 4.0 ms. A run of 160,000 backslashes takes 6.3 ms. An escaped key followed by 160,000 backslashes takes 9.2 ms. The new test (`errors.test.js:313`) takes 7.2 ms in the focused run, against a 500 ms bound.
- Scaling of the word run from 20k to 320k characters: 0.65, 1.13, 2.67, 5.01 and 11.37 ms, so each doubling roughly doubles the time. Across 18 shapes at 40k to 320k units, the worst growth ratio per doubling is 2.8, and the slowest case is about 300 ms for a 3.2 MB input. No quadratic shape was found.
- Key-name length: names of 65, 100 and 1000 characters are still masked in the prefix form (`kkk...token=abc`), the suffix form (`token kkk... =abc`), the JSON member, the escaped JSON member and the single-quoted form. The 10 and 63 character cases pass too.

### O1, quote-wrapped values: ADDRESSED for the four required forms

- Quoted alternatives in `KEY_VALUE` at `src/redact.js:37`. The replacement keeps the quotes at `:61-66`.
- Results (fix2): `access_token="EAAB123456"` gives `access_token="[redacted]"`. `token: 'EAAB123456'` gives `token: '[redacted]'`. `Authorization: "Basic dXNlcjpwYXNz"` gives `Authorization: "[redacted]"`. `{access_token: "EAAB123456"}` gives `{access_token: "[redacted]"}`.
- One test per form: `errors.test.js:327`, `:331`, `:335` and `:339`.
- Idempotence holds for all four (the second pass changes nothing). The idempotence test at `:200` includes three of the forms and the fuzz sample. The fuzz found 0 idempotence failures in 1.3M samples for fix1, fix2 and the candidate.
- The quoted branch brings NB-1 shapes 1 and 3. Quote-wrapped forms outside the four listed ones still leak (OS-1, OS-2). Whether O1 covers them is a ruling for the controller.

### O2, key names: ADDRESSED

- `src/redact.js:13` adds `apikey`, `session_id` and `x-api-key`. `code` is not added.
- Results: `session_id=abc&apikey=def` gives `session_id=[redacted]&apikey=[redacted]`. `X-Api-Key: EAAB...` gives `X-Api-Key: [redacted]`. `code=EAAB...` and `{code: 190}` are unchanged.
- Test: `errors.test.js:343`.
- Adding these names also makes the ruling 4 gap (`key=\"`) reachable for them (NB-1, shape 2).

## New breakage in the fix diff

### NB-1, Minor: a secret-named key directly followed by a quote, or an escaped quote, can expose a later member

- Where: the quoted alternatives of `KEY_VALUE` at `src/redact.js:37`. Its unquoted branch, on the same line, takes a leading backslash as the value. The replacement chain runs `KEY_VALUE` (`:61-66`) before `JSON_MEMBER` (`:67`) and `ESCAPED_JSON_MEMBER` (`:68`), so the new quoted match can consume the quotes those rules need. The O2 names (`:13`) make the second shape reachable.
- Evidence (exact outputs):
  1. `token:"token":"EAAB123456"`: fix1 gives `token:"token":"[redacted]"`; fix2 gives `token:"[redacted]":"EAAB123456"`. The quoted branch takes the JSON key `"token"` as its value, so `JSON_MEMBER` no longer finds its key quote.
  2. `apikey=\"api_key\":\"EAAB123456`: fix1 gives `apikey=\"api_key\":\"[redacted]`; fix2 gives `apikey=[redacted]\"api_key\":\"EAAB123456`. `apikey` is new (O2). The unquoted branch takes `\` as the value, so `ESCAPED_JSON_MEMBER` no longer finds `\"`. The `%3D` form (`apikey%3D\"api_key\":\"EAAB123456`) behaves the same. This is the ruling 4 gap (`access_token=\"`) reached through the new names.
  3. `cookie="\"token\":\""EAAB123456`: fix1 gives `cookie="\"token\":\"[redacted]` (masked to the end of the text); fix2 gives `cookie="[redacted]"EAAB123456`.
- Scale: fix2 has 55 new-leak samples in 1.3M structured random strings (five seeds). In the 18-form table, rows 10 and 12 are shapes 1 and 2, and no other row is new. The four O1 forms show no new leak. No realistic payload shape was found.
- Severity: Minor. Each case needs a secret-named key directly followed by a separator and a quote, then a second secret member or an escaped member in a specific position. The nearest real-world case is already a documented limit (ruling 4). It is a New breakage under the controller's definition, because fix1 masked these forms.
- Verified direction, not applied: move the two JSON-member replacements (`src/redact.js:67-68`) above the `KEY_VALUE` replacement (`:61-66`). The scratch copy is `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\fix2-review\cand\src\redact.js`. On that copy: 0 new leaks in the same 1.3M samples; 0 idempotence failures; the 44 tests in `errors.test.js` pass; the 18-line ordinary corpus output is identical to fix2; the scaling sweep stays linear.

### NB-2, Minor: over-masking from the quoted-value rule

- Where: `src/redact.js:37` (a quoted value runs to its closing quote, or to the end of the text when the quote is unclosed) and `:61-66`.
- Evidence:
  - An unclosed apostrophe hides the rest of the text: `Retry note token: 'abc then this long ordinary sentence continues to the end of the line and keeps going.` gives `Retry note token: '[redacted]'`. This fails closed, but the rest of the line is lost. It is the same trade-off as N4.
  - An empty quoted value becomes a placeholder: `secret="" means unset` gives `secret="[redacted]" means unset`.
  - Ordinary quoted words after a secret word are masked: `Next token: 'none'` gives `Next token: '[redacted]'`. Object keys with the same text change too: `{'Next token: none': 1}` gives the key `Next token: [redacted]` (fix1 kept `Next token: none`).
- These follow from O1 and N1. No secret is exposed. The implementer's no-over-masking statement refers to the round-1 corpus. On my 24-line quoted-value corpus, 16 lines differ from fix1, all from quoted values; two of them also involve the new key names (`session_id`, `apikey`).
- Severity: Minor. Accept it as a documented fail-closed trade-off, or bound an unclosed quote to its line.

### Checked, no new breakage

- Fail-open: none. No new path returns unmasked data. `copy` masks each key with the same rules as values, and key collisions (ruling 3) can only replace an entry, never reveal one.
- Stall: none (see N3).
- The `SECRET_NAME` to `SECRET_RUN` rewrite (`src/redact.js:18`) leaves the key rule unchanged: 199,313 unquoted samples give identical output in fix1 and fix2 (`probe-i.mjs`), excluding the O2 names.

## Out-of-scope observations

Each item was verified in fix2. Each also leaks in head and fix1 unless noted, so none is a new breakage.

- OS-1, quote-wrapped JSON-style keys: `'access_token': 'EAAB...'`, `'access_token': "EAAB..."` and `"access_token": 'EAAB...'` leak. This is the O1 family, but these forms are not among the four required ones. `JSON_MEMBER` (`src/redact.js:41`) accepts only double-quoted values. A ruling is needed on whether O1 covers quoted keys.
- OS-2, scheme outside the quotes: `Authorization: Basic "EAAB..."` and `token: Basic "EAAB..."` leak. `Authorization: "Basic" EAAB...` masks `"Basic"` and leaks the credential in fix2 (head and fix1 leak all of it). This is related to the scheme-word lookahead (ruling 6).
- OS-3, text-form JSON key with a space: `"owner token": "EAAB..."` leaks, because the key class at `src/redact.js:41` is `[\w.-]`. The object form masks it.
- OS-4, `api-key=EAAB...` (hyphen, no `x-`) leaks. O2 added `x-api-key` and `apikey` but not `api-key`.
- OS-5, unquoted JSON value: `{"access_token": EAAB...}` leaks. This is the O3 family.
- OS-6, cost, not a stall: copying a 100k-key object took 0.22 to 0.26 s in fix1 and 0.44 to 0.46 s in fix2. Growth is linear.
- Carried and not re-checked: N2, N4, N5 and O3 to O7. This diff does not touch the registry or those paths. N2 (a registered prefix leaves the rest in clear) is unchanged and still open.

## Round verdict

PASS. N1, N3, O1 and O2 are all ADDRESSED, and the round has no new Critical or Important breakage.

- New issues: 0 Critical, 0 Important, 2 Minor (NB-1 and NB-2).
- NB-1 is the item to act on if the controller wants no new leak. The two-line move is verified on a scratch copy: it removes the new leaks in all 1.3M samples, with no idempotence failures and no change to the ordinary corpus.
- OS-1 and OS-2 need a ruling on whether O1 covers quoted keys and quoted values after a scheme word.
