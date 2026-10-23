# Task 2 report: errors, redaction, audit and the busy result

Status: DONE_WITH_CONCERNS

Environment: Node v24.6.0 (engines `>=22.12.0`). The project is not a git repository, so nothing was committed (R2). No packages were installed, so the R3 `npm view <pkg> scripts` record does not apply.

## Files

Created:
- D:\Projects2\InstagramApi\src\errors.js: `ERROR_KINDS`, `IgError`, `mapGraphError`, `busyResult`.
- D:\Projects2\InstagramApi\src\redact.js: `redact`.
- D:\Projects2\InstagramApi\src\audit.js: `createAudit`.
- D:\Projects2\InstagramApi\test\errors.test.js: 16 tests.
- D:\Projects2\InstagramApi\test\audit.test.js: 7 tests.

Unchanged. A diff against the snapshot `task-2-base` shows only the five files above as added: `src\config.js`, `test\config.test.js` and `package.json` are identical to the snapshot. `package.json` and the `test` script are unchanged.

## TDD evidence

RED. The tests were written first, and no file in `src` existed yet. Command: `node --test test/errors.test.js test/audit.test.js`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\audit.js' imported from D:\Projects2\InstagramApi\test\audit.test.js
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\errors.js' imported from D:\Projects2\InstagramApi\test\errors.test.js
ℹ tests 2
ℹ pass 0
ℹ fail 2
EXIT: 1
```

GREEN. The three modules were written, then the same command was run.

```
✔ audit lines never contain access_token
✔ each line has the six fields, at comes from the clock, and missing fields are null
✔ record creates the folder when it is missing
✔ read returns the last entries, oldest first, and an empty list when no file exists
✔ read skips a truncated last line and keeps the rest
✔ read redacts lines that were written with a secret
✔ bad arguments are rejected with TypeError
✔ ERROR_KINDS lists the fifteen kinds from the brief, in order
✔ code 190 maps to AUTH_EXPIRED
✔ codes 4, 17, 32, 613, 80002 and status 429 map to RATE_LIMITED
✔ code 368 maps to ACTION_BLOCKED
✔ unknown errors map to API_ERROR
✔ feedback required and checkpoint messages map to their stop kinds
✔ a numeric string code is read as the same code, and error 190 wins over status 429
✔ the message of a mapped error is redacted, and the details hold status and codes only
✔ IgError carries kind, details and a redacted message
✔ IgError rejects a kind that is not in ERROR_KINDS
✔ busyResult carries busy true and retryAfterMs
✔ busyResult rejects an empty reason and a retryAfterMs that is not a whole number of ms, 0 or more
✔ redact removes tokens from keys and strings
✔ redact returns a deep copy and leaves the input unchanged
✔ redact masks Bearer values and string JSON members, and keeps other members
✔ redact keeps ordinary values and handles cycles, errors and binary data
ℹ tests 23
ℹ pass 23
ℹ fail 0
EXIT: 0
```

Full suite. Command: `npm test` (`node --test test/*.test.js`), run after the last edit:

```
ℹ tests 49
ℹ pass 49
ℹ fail 0
NPM TEST EXIT: 0
```

The 49 are 26 from `config.test.js`, which were not changed, plus the 23 above.

Mutation check. I broke one rule at a time in a scratch copy under the scratchpad (the project was not touched) and ran the two new test files against each copy. The script is `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\mutation-check.mjs`.

| Mutant | Result |
|---|---|
| M0 baseline, no mutation | pass 23, fail 0 |
| M1 no key-based redaction | fail 4 |
| M2 no JSON member masking | fail 1 |
| M3 no Bearer masking | fail 1 |
| M4 no cycle guard | fail 1 |
| M5 audit writes unredacted lines | fail 1 |
| M6 audit read does not redact | fail 1 |
| M7 code 80002 not a rate limit | fail 1 |
| M8 code 368 not blocked | fail 1 |
| M9 unknown IgError kind accepted | fail 1 |
| M10 busyResult does not validate retryAfterMs | fail 1 |
| M11 code 190 not AUTH_EXPIRED | fail 2 |
| M12 IgError message not redacted | fail 2 |
| M13 audit read ignores limit | fail 1 |

Every mutant is caught.

## What was built

- `errors.js`. `ERROR_KINDS` is frozen and lists the fifteen kinds in brief order. `IgError(kind, message, details = {})` stores `kind`, the redacted `message` and the redacted `details`. An unknown kind or a non-string message throws `TypeError`.
- `mapGraphError({ status, body })`. Code 190 gives `AUTH_EXPIRED`. Codes 4, 17, 32, 613 and 80002, or status 429, give `RATE_LIMITED`. Code 368 gives `ACTION_BLOCKED`. Anything else gives `API_ERROR`. The stop kinds are checked in that order. `details` is `{ status, code, subcode }`. When the body has no message, the message is `Graph API request failed with HTTP <status>`.
- `busyResult({ reason, retryAfterMs })`. It returns `{ busy: true, reason, retryAfterMs }`. The reason is redacted. An empty reason, or a `retryAfterMs` that is not a whole number of ms, 0 or more, throws `TypeError`.
- `redact(value)`. It returns a deep copy. Keys matching `/token|secret|password|authorization|sessionid|cookie/i` become `'[redacted]'`. Strings are masked for `Bearer <value>`, for `key=value` pairs whose key matches the same rule, and for JSON string members whose name matches. Binary values become `'[binary]'`. A cycle becomes `'[circular]'`.
- `createAudit({ file, now })` returns `{ record(entry), read({ limit }) }`. `record` appends one redacted JSON line with exactly `at` (ISO time from `now()`), `action`, `target`, `route`, `outcome` and `detail`. A field that is not given is `null`. It creates the folder if needed. `read({ limit = 100 })` returns the last `limit` entries, oldest first, skips any line that does not parse, and redacts what it returns.

## Concerns and deviations from the brief

These need a ruling from the controller.

1. Stop text. The brief maps Graph errors by code only. Global Constraints also name "feedback required" (`ACTION_BLOCKED`) and "checkpoint, challenge, or two-factor" (`CHECKPOINT`). The code therefore also matches those phrases in the error message. Without this, such errors would be `API_ERROR`, and `shouldStop` is false for `API_ERROR`, so outbound actions would not stop. Cost: an unrelated error whose message contains "challenge" stops outbound actions until `ig_stop_clear`.
2. Numeric string codes. A code given as a string, such as `"190"`, is read as the number, so a stop is not missed. This is the only coercion in the module, and it applies to Graph error codes only.
3. Beyond the brief. `IgError` redacts its message and details when it is built. `busyResult`, `createAudit`, `record` and `read` throw `TypeError` on bad input. `redact` also masks `key=value` and JSON members whose names match, not only `access_token`.
4. Test placement. The brief lists only two test files, so the redaction tests are in `test/errors.test.js`. `redact.js` has no test file of its own.

## Limits of redaction

- Redaction is pattern-based. A bare token in free text, with no key name and no `Bearer` prefix, is not caught. Task 9 should keep token values out of error and log text.
- `Authorization: Basic ...` written as plain text is not masked. The project uses Bearer only.

## Self-review

- I read all three modules after writing them. Two comments overstated the behaviour, and I corrected them. The code did not change after that, and the final `npm test` run above is after those edits.
- The diff against `task-2-base` contains only the five new files.
- Edge checks, outside the suite. An own `__proto__` key stays as data and does not change the prototype. Cycles become `'[circular]'`, so `JSON.stringify` works on the result. Inputs of 200 KB to 350 KB were redacted in 2 to 29 ms, so the key regex is linear in practice.
- The project tree was checked after the runs. There are no leftover temp directories, no `node_modules` and no stray files.
- Context7 was not used. The modules use only Node built-ins (`node:fs`, `node:path`, `node:test`), and this is code written from scratch, which the Context7 rule excludes.

## Fix round 1

This round covers the coordinator's findings I-1, I-2, M-1, M-2, M-5 and M-7 in the review file `D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\task-2-review.md`. The deferred items M-3, M-4, M-6, M-8, M-9, M-10, M-11 and M-12 are unchanged. Where this section and the earlier sections differ, this section is current.

### Files changed in this round

- `D:\Projects2\InstagramApi\src\redact.js`: the regex rules, `registerSecret`, and the registry masking.
- `D:\Projects2\InstagramApi\src\errors.js`: the `IgError` constructor, `graphCode`, the status handling in `mapGraphError`, and `busyResult`.
- `D:\Projects2\InstagramApi\test\errors.test.js`: 19 tests added or split, 35 in all.
- `D:\Projects2\InstagramApi\test\audit.test.js`: 2 tests added, 9 in all.
- Unchanged: `src\audit.js`, `src\config.js`, `test\config.test.js` and `package.json`.

### What changed, by finding

**I-1, busyResult.** `busyResult` accepts any finite number and returns `Math.max(0, Math.ceil(retryAfterMs))`. It still throws `TypeError` for an empty reason, NaN, Infinity, undefined and non-numbers. The fractional test at `errors.test.js` line 121 now expects `1.5` to give `2`. The `-1` case changed from a throw to `0`, because the formula takes a negative value as 0. Probe B1 now gives `retryAfterMs: 1501` for 1500.5.

**I-2, redaction.**
- `registerSecret(value)` is exported from `src/redact.js`. It throws `IgError` with kind `VALIDATION` for a non-string, a blank string, a value under 8 characters, and a value that occurs inside `[redacted]`. The last rule is mine, see below. The function registers the value and its `encodeURIComponent` form. `maskText` replaces every registered value first, longest first, using `split` and `join`.
- `KEY_VALUE` accepts `=`, `:` and `%3D` as separators.
- A new `AUTHORIZATION` rule masks the credential after an `Authorization` label and keeps an optional scheme word such as `Basic`. This covers the Basic case you listed.
- `BEARER`, `KEY_VALUE` and `AUTHORIZATION` skip a value that is already `[redacted]`.
- `ESCAPED_JSON_MEMBER` is a new pattern beside `JSON_MEMBER`, and it handles backslash-escaped quotes. `JSON_MEMBER` keeps its plain form. One pattern could not handle both forms without consuming text that does not belong to the secret.
- The key rule adds `passwd` and `api_key`. `code` is not added.
- Probes P1, P2, P4 and P5 are masked. P3 and P6 are masked once the value is registered.

**M-1, idempotence.** The `(?!\[redacted\])` lookaheads stop the value classes from matching `[redacted]`, so `redact(redact(x))` equals `redact(x)`. Probes D1 to D4 give the same text on the second pass.

**M-2, coercion.** `graphCode` trims strings before the digit test, and `status` goes through the same function. `' 190'` gives `AUTH_EXPIRED`, and `'429'` gives `RATE_LIMITED`. `details.status` holds the number.

**M-5, CHECKPOINT tests.** Tests were added for `challenge_required` and `two-factor required`. Both already map to CHECKPOINT, so no code changed. The feedback-required test is kept.

**M-7, IgError arguments.** The constructor uses `message = String(message ?? kind)` and `details = details ?? {}`. The kind check is kept. Tests cover a non-string message and `details: null`.

### Changes beyond the list, for your ruling

1. **A leak, found and fixed.** Before this round, `KEY_VALUE` and `JSON_MEMBER` matched any key. A non-secret key then consumed a value that held a secret, and the secret stayed visible. The pre-fix pattern left `x=https://g?access_token=abc` unchanged, so `abc` leaked. Both patterns now match only secret names. Test: "a secret after a key that is not secret is still masked".
2. **Nested escaped JSON.** `{\"access_token\":\"ab\\\"cd\"}` left `cd` visible. `ESCAPED_JSON_MEMBER` now runs its value up to the quote that closes the string. Test: "a nested escaped quote inside an escaped JSON secret is masked to the end of the value". Its RED run is under Stage C below.
3. **`AUTHORIZATION` covers any scheme word**, not only `Basic`. With `Token`, the output is `Authorization: [redacted] [redacted]`, because the key rule masks the scheme word. That is cosmetic, and it is safe and idempotent.
4. **`registerSecret` also refuses** a blank value and a value inside `[redacted]`. Without the second rule, registering `redacted` would make the text grow on each pass.
5. **A module cycle.** `redact.js` now imports `IgError` from `errors.js`, and `errors.js` already imports `redact` from `redact.js`. Neither module calls the other while it loads. The two test files enter the cycle in different orders, so both orders are covered. Say if you want the cycle removed.

### TDD evidence for this round

Stage A: the behavioural tests were written first, before any source change. Command: `node --test test/errors.test.js test/audit.test.js`.

```
ℹ tests 37
ℹ pass 25
ℹ fail 12
```

The 12 failures were the stable audit read, the code with spaces, the status as a string, the IgError message and details, the busyResult fraction, idempotence, the colon separator, the `%3D` separator, the Authorization Basic credential, escaped JSON, and `api_key` and `passwd`. Each one is an assertion on an expected value. The output shows the leaks and the `]]` corruption, for example `actual: 'x access_token=[redacted]]&y=1 Authorization: Bearer [redacted]]'`. The two checkpoint tests and the busyResult rejection test passed already, which is expected.

Stage B: the registry tests were added, and they import `registerSecret`.

```
SyntaxError: The requested module '../src/redact.js' does not provide an export named 'registerSecret'
ℹ tests 2
ℹ pass 0
ℹ fail 2
```

Stage C: the nested-escape regression, run before the `ESCAPED_JSON_MEMBER` change.

```
ℹ tests 44
ℹ pass 43
ℹ fail 1
actual:   '{\\"access_token\\":\\"[redacted]\\"cd\\"}'
expected: '{\\"access_token\\":\\"[redacted]\\"}'
```

GREEN, the covering tests after all source changes. Command: `node --test test/errors.test.js test/audit.test.js`, exit 0. Output, with the per-test timings removed:

```
✔ audit lines never contain access_token
✔ each line has the six fields, at comes from the clock, and missing fields are null
✔ record creates the folder when it is missing
✔ read returns the last entries, oldest first, and an empty list when no file exists
✔ read skips a truncated last line and keeps the rest
✔ read redacts lines that were written with a secret
✔ bad arguments are rejected with TypeError
✔ audit read output is stable under redaction
✔ audit masks a registered secret that appears as a bare value in a detail
✔ ERROR_KINDS lists the fifteen kinds from the brief, in order
✔ code 190 maps to AUTH_EXPIRED
✔ codes 4, 17, 32, 613, 80002 and status 429 map to RATE_LIMITED
✔ code 368 maps to ACTION_BLOCKED
✔ unknown errors map to API_ERROR
✔ feedback required and checkpoint messages map to their stop kinds
✔ challenge_required maps to CHECKPOINT
✔ two-factor required maps to CHECKPOINT
✔ a numeric string code is read as the same code, and error 190 wins over status 429
✔ a code with surrounding spaces, such as " 190", gives AUTH_EXPIRED
✔ a status given as a string, such as "429", gives RATE_LIMITED
✔ the message of a mapped error is redacted, and the details hold status and codes only
✔ IgError carries kind, details and a redacted message
✔ IgError rejects a kind that is not in ERROR_KINDS
✔ IgError turns a non-string message into text, and uses the kind when there is no message
✔ IgError stores details: null as an empty object
✔ busyResult carries busy true and retryAfterMs
✔ busyResult rounds a fractional retryAfterMs up and takes a negative one as 0
✔ busyResult rejects an empty reason, and a retryAfterMs that is not a finite number
✔ redact removes tokens from keys and strings
✔ redact returns a deep copy and leaves the input unchanged
✔ redact masks Bearer values and string JSON members, and keeps other members
✔ redact keeps ordinary values and handles cycles, errors and binary data
✔ redaction is idempotent: redacting a redacted string changes nothing
✔ owner token: <value> is masked when the separator is a colon
✔ a percent-encoded equals sign, as in access_token%3D<value>, is masked
✔ Authorization: Basic <value> keeps the scheme and masks the credential
✔ a string holding escaped JSON has its secret member masked
✔ api_key and passwd are secret keys, and code is not
✔ a registered secret is masked as a bare value in an error message
✔ a registered secret after a space, as in token <value>, is masked
✔ registerSecret refuses a short, blank or non-string value, or one inside the marker, with VALIDATION
✔ the registry masks the encodeURIComponent form of a registered secret
✔ a nested escaped quote inside an escaped JSON secret is masked to the end of the value
✔ a secret after a key that is not secret is still masked
ℹ tests 44
ℹ suites 0
ℹ pass 44
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Full suite, `npm test`, which runs `node --test test/*.test.js`, exit 0:

```
ℹ tests 70
ℹ suites 0
ℹ pass 70
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

The 70 are the 26 unchanged config tests and the 44 covering tests.

### Probe re-run

The reviewer's scripts, `task2-probe.mjs` and `task2-probe2.mjs`, were run unchanged against the fixed modules. Command: `node task2-probe.mjs` and `node task2-probe2.mjs`, both exit 0.

- P1 gives `{\"access_token\":\"[redacted]\"}`. P2 gives `owner token: [redacted]`. P4 gives `?access_token%3D[redacted]`. P5 gives `Authorization: Basic [redacted]`. P7 gives `access_token=[redacted]`.
- P3 (`token LEAK_C`) and P6 (`token LEAK_E is invalid`) still show their values, because the probe script does not register them. The tests show that registration masks them.
- S1 gives `AUTH_EXPIRED`. S2 gives `RATE_LIMITED`. S5 gives `CHECKPOINT`. S8 gives `RATE_LIMITED`.
- B1 gives `retryAfterMs: 1501`. B2 gives the message `API_ERROR`. B3 gives details `{}`.
- D1 to D4 give the same text on the second pass.
- Unchanged and deferred: S3, S6, S7, P8, P9 and A1. P8 gives `Bearer [redacted] missing`, which is accepted as noted earlier.

Extra probes, outside the suite. All of these were masked: `x=https://g?access_token=abc`, `{"url": "https://g?access_token=abc"}`, `password=ab\cd`, a mixed line, and idempotence on the mixed line. Redaction of 200 KB to 350 KB inputs took 4 to 29 ms.

### Mutation check for this round

Each changed rule was broken in a scratch copy, and the covering tests were run against each copy. The script is `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\mutation-check-fix1.mjs`. The unmutated baseline is 44 of 44.

| Mutant | Result |
|---|---|
| M1 no registry masking | fail 4 |
| M2 registry skips the encoded form | fail 1 |
| M3 no minimum length | fail 1 |
| M4 KEY_VALUE lookahead removed | fail 2 |
| M5 BEARER lookahead removed | fail 2 |
| M6 no `%3D` separator | fail 1 |
| M7 no colon separator | fail 1 |
| M8 no Authorization rule | fail 1 |
| M9 old escaped-JSON value body | fail 2 |
| M10 `passwd` and `api_key` not secret | fail 1 |
| M11 KEY_VALUE matches any key | fail 6 |
| M12 busy fraction not rounded | fail 1 |
| M13 code not trimmed | fail 1 |
| M14 status not normalised | fail 1 |
| M15 non-string message throws again | fail 1 |
| M16 details null kept | fail 1 |
| M17 kind check removed | fail 1 |

All 17 mutants are caught.

### Limits after this round

- A bare value is masked only if it is registered. Task 9 must call `registerSecret` for every secret it loads from the environment or the keyring. This is a requirement carried forward to Task 9.
- A `key=value` value with a literal space is masked only up to the space. For example, `password=hunter 2` shows ` 2`. URL and form values are encoded, so this matters mainly for free text.
- Escaped JSON whose secret contains a quote followed by `,`, `}` or `]` is masked only up to that quote.
- An Authorization scheme other than Basic or Bearer shows its scheme word and masks the credential, giving `[redacted] [redacted]`.

### Superseded parts of the earlier report

- "Limits of redaction": the first bullet still applies to values that are not registered. The Basic bullet is now covered by the `AUTHORIZATION` rule.
- Concern 3: `busyResult` now rounds fractions up and takes negatives as 0, instead of throwing.
- Concern 2: `graphCode` also trims strings, so the coercion covers spaces as well as numeric strings.

## Fix round 2

This round covers the re-review's N1 (Important), and the three items promoted into the round: N3, O1 and O2. The re-review file is `D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\task-2-rereview-1.md`. N2, N4, N5, O3, O4, O5, O6 and O7 are unchanged. Where this section and the earlier sections differ, this section is current.

### Files changed

- `D:\Projects2\InstagramApi\src\redact.js`: object-key masking (N1), the key-run patterns and the quoted-value alternative (N3, O1), the key names (O2), and the guard on the escaped closing check (N3).
- `D:\Projects2\InstagramApi\test\errors.test.js`: 9 tests added (N1 three, N3 one, O1 four, O2 one), and 4 samples added to the existing idempotence test. The file now has 44 tests.
- Unchanged: `src\errors.js`, `src\audit.js`, `src\config.js`, `test\audit.test.js`, `test\config.test.js` and `package.json`.

### What changed, by finding

**N1, object keys.** `copy()` now masks each key as text with `maskText`. The secret-name test (`SECRET_KEY`) still runs on the raw key, so a secret-named key still masks its value. Before this round, keys were copied unchanged. Results:
- `{Kx8mPq4Rs1: 'v'}`, with the value registered, gives `{'[redacted]': 'v'}`.
- `{'x Kx8mPq4Rs1': 1}` gives `{'x [redacted]': 1}`.
- `{'https://g?access_token=Qz9xWv7Lm2': '[redacted]'}` gives `{'https://g?access_token=[redacted]': '[redacted]'}`.

Tests: "a registered value used as an object key is masked", "a key that holds access_token=<value> text is masked", and "a secret-named key still masks its value, whatever the key text holds".

**N3, the quadratic stall.** The cause was `[\w.-]*` on both sides of the secret word, which the regex engine rescanned at each keyword occurrence. I did not add the bound you suggested. A bound would fail open: a key with more than 64 word characters after its secret word would not be matched, so `token` followed by 100 letters and `=abc` would leak `abc`. The key is now matched as the whole run of word characters, with a lookahead that asserts the run contains a secret word: `(?=[\w.-]*(?:words))`. No length is limited, and the work grows with the length of the run. The JSON member and escaped member patterns use the same lookahead. The escaped closing check was also quadratic on a long run of backslashes (the re-review's 77 ms case), so it now runs only at the start of a run, through `(?<!\\)`.

Timings with the final module (`fix2-timing.mjs`, Node v24.6.0):

| Input | Before this round | After this round |
|---|---|---|
| `token` repeated 32,000 times (160,000 characters) | 10,715 ms | 5.1 ms |
| backslash run of 160,000 after an escaped key | 44,234 ms | 4.3 ms |
| backslash run of 8,000 after an escaped key | 79.8 ms | 0.5 ms |
| 100,000 letters then `token=abc` | not timed | 1.0 ms, output ends `token=[redacted]` |

Test: "a 160,000-character run of word characters or backslashes is redacted in under 500 ms".

**O1, quote-wrapped values.** `KEY_VALUE` has a quoted alternative for double and for single quotes. The value runs to the matching quote. An unclosed quote runs to the end of the text, which fails closed. The replacement keeps the quotes:
- `access_token="EAAB123456"` gives `access_token="[redacted]"`.
- `token: 'EAAB123456'` gives `token: '[redacted]'`.
- `Authorization: "Basic dXNlcjpwYXNz"` gives `Authorization: "[redacted]"`.
- `{access_token: "EAAB123456"}` gives `{access_token: "[redacted]"}`.

Tests: one per form.

**O2, key names.** `apikey`, `session_id` and `x-api-key` join the key rule. `code` is not added. `session_id=abc&apikey=def` gives `session_id=[redacted]&apikey=[redacted]`. Test: "apikey, session_id and x-api-key are secret keys, and code is not".

### Beyond the list, for your ruling

1. **A fuzz regression from O1, found and fixed in this round.** The first quoted alternative consumed `\\.` inside the quotes, so a trailing backslash was left unconsumed. The first pass then removed that backslash, and the second pass parsed a later quote differently. The fuzz found one failure in 50,000 (`token%3D'\api_key: \`). The fix consumes `\\[\s\S]` and an optional trailing backslash before the closing quote. The input is now a sample in the idempotence test, and the fuzz reports 0 failures in 50,000.
2. **No length bound for N3.** The reason is given above. Your suggested `{0,64}` would fail open.
3. **Key collisions.** Keys are masked as text, so two different keys can become the same text, for example `token=abc` and `token=xyz`. In the copy, the later entry then replaces the earlier one. No value leaks, but one entry is lost from that copy. Not changed; a ruling is needed if it matters.
4. The idempotence test gained four samples: three quoted forms from O1, and the fuzz input.

### Evidence

**RED, stage A.** The tests were added before `redact.js` changed. Command: `node --test test/errors.test.js test/audit.test.js`. Output, the failing tests:

```
✖ a registered value used as an object key is masked
✖ a key that holds access_token=<value> text is masked
✖ a 160,000-character run of word characters or backslashes is redacted in under 500 ms
    AssertionError [ERR_ASSERTION]: word run took 9396.9 ms
✖ a double-quoted value keeps its quotes and masks the value
✖ a single-quoted value keeps its quotes and masks the value
✖ a quoted Authorization header value is masked and keeps its quotes
✖ a secret key in an object literal masks its quoted value
✖ apikey, session_id and x-api-key are secret keys, and code is not
ℹ tests 53
ℹ pass 45
ℹ fail 8
```

The quoted samples in the idempotence list passed trivially in this run, because nothing was masked yet. The fuzz sample was added after the first GREEN run.

**GREEN, covering tests (final).** Command: `node --test test/errors.test.js test/audit.test.js`, exit 0. Output:

```
✔ audit lines never contain access_token
✔ each line has the six fields, at comes from the clock, and missing fields are null
✔ record creates the folder when it is missing
✔ read returns the last entries, oldest first, and an empty list when no file exists
✔ read skips a truncated last line and keeps the rest
✔ read redacts lines that were written with a secret
✔ bad arguments are rejected with TypeError
✔ audit read output is stable under redaction
✔ audit masks a registered secret that appears as a bare value in a detail
✔ ERROR_KINDS lists the fifteen kinds from the brief, in order
✔ code 190 maps to AUTH_EXPIRED
✔ codes 4, 17, 32, 613, 80002 and status 429 map to RATE_LIMITED
✔ code 368 maps to ACTION_BLOCKED
✔ unknown errors map to API_ERROR
✔ feedback required and checkpoint messages map to their stop kinds
✔ challenge_required maps to CHECKPOINT
✔ two-factor required maps to CHECKPOINT
✔ a numeric string code is read as the same code, and error 190 wins over status 429
✔ a code with surrounding spaces, such as " 190", gives AUTH_EXPIRED
✔ a status given as a string, such as "429", gives RATE_LIMITED
✔ the message of a mapped error is redacted, and the details hold status and codes only
✔ IgError carries kind, details and a redacted message
✔ IgError rejects a kind that is not in ERROR_KINDS
✔ IgError turns a non-string message into text, and uses the kind when there is no message
✔ IgError stores details: null as an empty object
✔ busyResult carries busy true and retryAfterMs
✔ busyResult rounds a fractional retryAfterMs up and takes a negative one as 0
✔ busyResult rejects an empty reason, and a retryAfterMs that is not a finite number
✔ redact removes tokens from keys and strings
✔ redact returns a deep copy and leaves the input unchanged
✔ redact masks Bearer values and string JSON members, and keeps other members
✔ redact keeps ordinary values and handles cycles, errors and binary data
✔ redaction is idempotent: redacting a redacted string changes nothing
✔ owner token: <value> is masked when the separator is a colon
✔ a percent-encoded equals sign, as in access_token%3D<value>, is masked
✔ Authorization: Basic <value> keeps the scheme and masks the credential
✔ a string holding escaped JSON has its secret member masked
✔ api_key and passwd are secret keys, and code is not
✔ a registered secret is masked as a bare value in an error message
✔ a registered secret after a space, as in token <value>, is masked
✔ registerSecret refuses a short, blank or non-string value, or one inside the marker, with VALIDATION
✔ the registry masks the encodeURIComponent form of a registered secret
✔ a nested escaped quote inside an escaped JSON secret is masked to the end of the value
✔ a secret after a key that is not secret is still masked
✔ a registered value used as an object key is masked
✔ a key that holds access_token=<value> text is masked
✔ a secret-named key still masks its value, whatever the key text holds
✔ a 160,000-character run of word characters or backslashes is redacted in under 500 ms
✔ a double-quoted value keeps its quotes and masks the value
✔ a single-quoted value keeps its quotes and masks the value
✔ a quoted Authorization header value is masked and keeps its quotes
✔ a secret key in an object literal masks its quoted value
✔ apikey, session_id and x-api-key are secret keys, and code is not
ℹ tests 53
ℹ pass 53
ℹ fail 0
```

**Full suite.** Command: `npm test` (`node --test test/*.test.js`), exit 0:

```
ℹ tests 79
ℹ pass 79
ℹ fail 0
```

The 79 are the 26 config tests, which are unchanged, and the 53 covering tests.

**Re-review probes.** The re-review scripts were run unchanged against `D:\Projects2\InstagramApi\src`, and all exited 0. The probe modes were `matrix`, `ordinary`, `timing`, `fuzz`, `keys` and `registry` in `task2-rereview-probe.mjs`, plus `task2-rereview-probe2.mjs` and `task2-rereview-probe3.mjs`.
- Fuzz: `idempotence failures in 50000 random strings: 0`.
- Matrix: the LEAK rows are a strict subset of the head snapshot's LEAK rows (`snap\task-2-head\src`, compared with `diff`). Head has 29 LEAK rows. Every required form is now masked. The remaining rows are listed under "Carried forward".
- Ordinary corpus: the output is identical to the round 1 output the reviewer saved (`ord-fix1.txt`, `diff` exit 0). This round added no over-masking on that corpus.
- Probe 2: numeric JSON, the encoded colon and Digest are unchanged. Timings are now 1 ms at 80,000 characters and 2 ms at 160,000.
- Probe 3: unchanged. The late-registration and no-closing-delimiter items are deferred.
- Keys: `{"https://g?access_token=[redacted]":"[redacted]"}`. Registry: `{"[redacted]":"v"}` and `{"x [redacted]":1}`.

**Mutation check.** Six mutants on the new rules, each in a scratch copy (`mutation-check-fix2.mjs`). Baseline 53 of 53.

| Mutant | Result |
|---|---|
| M1 keys not masked (N1) | fail 2 |
| M2 quoted values not masked (O1) | fail 4 |
| M3 `apikey` not a secret word (O2) | fail 1 |
| M4 escaped closing check not guarded (N3) | fail 1, after 48.4 s |
| M5 KEY_VALUE matches any key | fail 7 |
| M6 quoted body reverted to `\\.` (fuzz regression) | fail 1 |

All six are caught.

### Carried forward, unchanged

- N2: a registered value that is a strict prefix of a longer secret still leaves the rest in clear. `token=Qz9xWv7Lm2 done` gives `token=[redacted]m2 done` after `Qz9xWv7L` is registered.
- N4, N5, O3, O4, O5, O6 and O7 are unchanged.
- Forms that still leak. Each one is also in head, as the matrix comparison shows:
  - `access_token%3A<value>`, which has no `%3A` separator.
  - Encoded JSON, `%22access_token%22%3A%22<value>`.
  - An unclosed JSON member string, `{"access_token": "<value>`. JSON_MEMBER needs a closing quote, while the quoted KEY_VALUE alternative masks to the end of the text.
  - `access_token=\"<value>`, an escaped quote after the separator.
  - `password=Basic <value>` and `token: basic <value>`, which the scheme-word lookahead from ruling 6 skips.

## Fix round 3

This round covers the NB-1 regression from round 2 in the re-review. The controller's ruling applies: a leak introduced by a fix is fixed, whatever its severity label. Read "Points that need your ruling" first: the fix as specified introduces leaks of its own, and one round 2 regression is outside its scope.

### What changed

- `D:\Projects2\InstagramApi\src\redact.js`: the two JSON-member replacements, `JSON_MEMBER` and then `ESCAPED_JSON_MEMBER`, now run before the `KEY_VALUE` replacement. A one-line comment says why. Nothing else in the chain changed. A diff against `snap\task-2-fix2-head\src\redact.js` shows only the moved lines and the comment.
- `D:\Projects2\InstagramApi\test\errors.test.js`: 4 tests added.
  - "a JSON member after an outer token key masks its value, not the value of the outer key", with `token:"token":"EAAB123456"`.
  - "an escaped JSON member after apikey= masks the value after the key", with `apikey=\"api_key\":\"EAAB123456`, as written in the regression.
  - "an escaped JSON member inside a double-quoted cookie value masks its value", with `cookie="\"token\":\""EAAB123456`, as written in the regression.
  - "ordinary sentences that mention token and key are not masked", with three sentences: "The token is valid for 60 minutes.", "Press any key to continue." and "Our api key rotation is due next week.".
  - Each shape test asserts that the secret value is absent from the output and that `[redacted]` is present.
- Unchanged: `src\errors.js`, `src\audit.js`, `src\config.js`, `test\audit.test.js`, `test\config.test.js` and `package.json`.

### Points that need your ruling

1. **The move introduces leaks that round 2 masked.** When a JSON string holds an unescaped nested key=value pair, the JSON member ends at the nested quote and the nested secret is left outside the match. Example: `x:"token":"session_id="EAAB123456 end` is masked by round 2 (`x:"token":"[redacted]"[redacted]"`) and leaks after the move (`x:"token":"[redacted]"EAAB123456 end`). On 60,000 generated texts, each containing the secret once, the move leaks 237 texts that round 2 masked. It also leaks 19 that round 1 masked, where round 2 leaked 370. Under the ruling these 237 must be fixed. A fix needs a quote-aware change to the chain, which "nothing else in the chain changes" excludes, so I did not make it.
2. **A round 2 regression that the move does not cover (the apikey family).** `apikey=token = EAAB123456` and `apikey=token: EAAB123456` are masked by round 1 and leak in round 2 and after the move. The cause is the `apikey` key name from round 2: its unquoted value consumes the next key. Adding one lookahead to the unquoted value only, refusing a value that starts with a secret key followed by a separator, fixes both forms. Measured on a separate 60,000-text sample: 286 leaks that round 2 masked, 14 that round 1 masked, and 1,011 round 2 leaks removed. The move alone, on the same sample, gives 245, 18 and 714. I did not apply the lookahead, because this round is limited to the move. I recommend it as a follow-up for your ruling.
3. **The unclosed form of shape A still leaks.** `token:"token":"EAAB123456` has no closing quote. It leaks in head and in round 1 as well, so it is not a round 2 regression, and the move does not fix it. The test uses the closed form, which round 1 masked.

### Measurements

Each row scores every version on the same generated texts. The generator combines secret key names, separators, quote styles and escapes, so it is adversarial rather than representative. The script is `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\fix3-compare2.mjs`, run on 60,000 texts in one run. "new vs r2" counts texts the version leaks and round 2 masked. "new vs r1" is the same against round 1. "fixed vs r2" counts round 2 leaks the version masks.

| version | leaks | new vs r2 | new vs r1 | fixed vs r2 |
|---|---|---|---|---|
| head | 59,195 | 21,118 | 2,490 | 104 |
| round 1 | 56,728 | 18,917 | 0 | 370 |
| round 2 (before this round) | 38,181 | 0 | 370 | 0 |
| move (this round) | 37,705 | 237 | 19 | 713 |
| G1, guard on all alternatives, rejected | 38,535 | 3,272 | 76 | 2,918 |
| G2, guard on quoted and unquoted values, rejected | 37,194 | 804 | 140 | 1,791 |
| G3, guard on colon separators only, rejected | 37,544 | 527 | 143 | 1,164 |
| G4, guard on JSON member forms only, rejected | 37,874 | 110 | 149 | 417 |

G1 to G4 were built on the round 2 code, with `KEY_VALUE` still first. None of them is better than the move on both "new vs r2" and "new vs r1". The move is the best of the set on the round 1 measure. The unquoted-value lookahead from item 2 is a separate sample (`fix3-compare3.mjs`): 37,352 leaks, 286 new vs r2, 14 new vs r1 and 1,011 fixed vs r2.

### Evidence

RED, before the move. The three shape tests were added with the ordinary-text test. Command: `node --test test/errors.test.js test/audit.test.js`. Result: tests 57, pass 54, fail 3, exit 1. The three failures are the shape tests, each with `actual: true, expected: false`, meaning the secret is still in the output. The ordinary-text test passed, as expected.

GREEN, after the move. Command: `node --test test/errors.test.js test/audit.test.js`. Output, timings removed, exit 0:

```
✔ audit lines never contain access_token
✔ each line has the six fields, at comes from the clock, and missing fields are null
✔ record creates the folder when it is missing
✔ read returns the last entries, oldest first, and an empty list when no file exists
✔ read skips a truncated last line and keeps the rest
✔ read redacts lines that were written with a secret
✔ bad arguments are rejected with TypeError
✔ audit read output is stable under redaction
✔ audit masks a registered secret that appears as a bare value in a detail
✔ ERROR_KINDS lists the fifteen kinds from the brief, in order
✔ code 190 maps to AUTH_EXPIRED
✔ codes 4, 17, 32, 613, 80002 and status 429 map to RATE_LIMITED
✔ code 368 maps to ACTION_BLOCKED
✔ unknown errors map to API_ERROR
✔ feedback required and checkpoint messages map to their stop kinds
✔ challenge_required maps to CHECKPOINT
✔ two-factor required maps to CHECKPOINT
✔ a numeric string code is read as the same code, and error 190 wins over status 429
✔ a code with surrounding spaces, such as " 190", gives AUTH_EXPIRED
✔ a status given as a string, such as "429", gives RATE_LIMITED
✔ the message of a mapped error is redacted, and the details hold status and codes only
✔ IgError carries kind, details and a redacted message
✔ IgError rejects a kind that is not in ERROR_KINDS
✔ IgError turns a non-string message into text, and uses the kind when there is no message
✔ IgError stores details: null as an empty object
✔ busyResult carries busy true and retryAfterMs
✔ busyResult rounds a fractional retryAfterMs up and takes a negative one as 0
✔ busyResult rejects an empty reason, and a retryAfterMs that is not a finite number
✔ redact removes tokens from keys and strings
✔ redact returns a deep copy and leaves the input unchanged
✔ redact masks Bearer values and string JSON members, and keeps other members
✔ redact keeps ordinary values and handles cycles, errors and binary data
✔ redaction is idempotent: redacting a redacted string changes nothing
✔ owner token: <value> is masked when the separator is a colon
✔ a percent-encoded equals sign, as in access_token%3D<value>, is masked
✔ Authorization: Basic <value> keeps the scheme and masks the credential
✔ a string holding escaped JSON has its secret member masked
✔ api_key and passwd are secret keys, and code is not
✔ a registered secret is masked as a bare value in an error message
✔ a registered secret after a space, as in token <value>, is masked
✔ registerSecret refuses a short, blank or non-string value, or one inside the marker, with VALIDATION
✔ the registry masks the encodeURIComponent form of a registered secret
✔ a nested escaped quote inside an escaped JSON secret is masked to the end of the value
✔ a secret after a key that is not secret is still masked
✔ a registered value used as an object key is masked
✔ a key that holds access_token=<value> text is masked
✔ a secret-named key still masks its value, whatever the key text holds
✔ a 160,000-character run of word characters or backslashes is redacted in under 500 ms
✔ a double-quoted value keeps its quotes and masks the value
✔ a single-quoted value keeps its quotes and masks the value
✔ a quoted Authorization header value is masked and keeps its quotes
✔ a secret key in an object literal masks its quoted value
✔ apikey, session_id and x-api-key are secret keys, and code is not
✔ a JSON member after an outer token key masks its value, not the value of the outer key
✔ an escaped JSON member after apikey= masks the value after the key
✔ an escaped JSON member inside a double-quoted cookie value masks its value
✔ ordinary sentences that mention token and key are not masked
ℹ tests 57
ℹ pass 57
ℹ fail 0
```

Full suite. Command: `npm test` (`node --test test/*.test.js`), exit 0:

```
ℹ tests 83
ℹ pass 83
ℹ fail 0
```

The 83 are the 26 config tests, which are unchanged, and the 57 covering tests.

Probe set, run unchanged against the final `src` (`fuzz`, `matrix`, `ordinary`, `keys` and `registry` modes of `task2-rereview-probe.mjs`, and `task2-rereview-probe2.mjs` and `task2-rereview-probe3.mjs`):
- Fuzz: `idempotence failures in 50000 random strings: 0`.
- Matrix: the LEAK rows are identical to round 2.
- Ordinary corpus: identical to round 2, so no new masking.
- Keys and registry: identical to round 2.
- Probes 2 and 3: identical to round 2.

### Carried forward

- The three points under "Points that need your ruling".
- Unchanged from round 2: N2, N4, N5, O3 to O7, and the pre-existing forms listed in the round 2 section.

## Fix round 4

This round covers R-a from `task-2-rereview-3.md`: a Minor leak that the round 3 move introduced. Where this section and the earlier sections differ, this section is current.

Status: DONE_WITH_CONCERNS. The exports are unchanged. No git command was run, and no subagent was used.

### Cause

Round 3 ran the JSON member rule before KEY_VALUE. The member rule closes at the first unescaped quote, so in `x:"token":"session_id="EAAB123456 end` it closes at the quote that opens the nested pair. The secret is then left with no key in front of it. Round 2 ran KEY_VALUE first and masked it. The round 3 move fixed NB-1, and that fix must stay.

### What changed (`src\redact.js` only)

1. `JSON_MEMBER_FIRST` (new) is the first JSON pass. It masks a secret-named member only when the member is well formed. (a) Its value holds no nested pair: a secret-named key, a separator, then a single quote, or a double quote that is not followed by a comma, a closing bracket or brace, or the end of the text. (b) Its closing quote is not followed by a word character, because that quote may open the next key. Both checks are lookaheads, so a rejected member consumes nothing. A callback that returned the match unchanged consumed the next member's opening quote, which was the first failure found in this round.
2. KEY_VALUE, double-quoted value: a double quote that follows an escaped quote continues the value when a word character follows it and that word is neither a JSON key nor followed by a separator. This keeps the cookie shape, `cookie="\"token\":\""EAAB123456`, masked. An unquoted value may not start with an escaped quote, so the escaped-member rule masks `apikey=\"api_key\":...` instead.
3. `JSON_MEMBER` (second pass) runs after KEY_VALUE. Its closing quote is a lookahead, so that quote can open the next member.
4. `ESCAPED_JSON_MEMBER` is unchanged. It runs after the second JSON pass, because when it ran earlier it took the closing quote of a plain member that contains an escaped member.

Chain: BEARER, AUTHORIZATION, JSON_MEMBER_FIRST, KEY_VALUE, JSON_MEMBER, ESCAPED_JSON_MEMBER.

Well-formed JSON keeps round 3's output: `{"access_token": "xyz_token=", "x": "y"}` gives `{"access_token": "[redacted]", "x": "y"}`.

### Covering tests (`test\errors.test.js`: nine added, 57 in the file)

- a nested key=value pair inside a JSON member value is masked, whatever quote follows it (4 texts)
- a member whose value ends in a key and separator does not expose that key
- a single-quoted nested pair inside a double-quoted JSON value does not hide the members after it
- an empty JSON value does not take the opening quote of the next member
- an escaped member inside a plain member is masked with its enclosing member
- a well-formed member whose value ends in a key and separator keeps the members after it
- redaction of the nested-quote samples is idempotent (6 samples)
- a key=value pair after an escaped quote inside a quoted value keeps its own match
- a closing quote followed by a word character does not end a JSON member early

RED, round 3 source with all nine tests: `node --test test/errors.test.js`, output `tests 57`, `pass 52`, `fail 5`. The five failures are the nested-pair, single-quoted, empty-value, escaped-member and word-character tests. The other four pass on round 3 and guard behaviour that must stay. The `api_key` test is red on an earlier candidate that had a broader continuation rule, which leaked.

GREEN: `node --test test/errors.test.js test/audit.test.js` gives `tests 66`, `pass 66`, `fail 0`, exit 0.

Full suite: `npm test` (`node --test test/*.test.js`) gives `tests 92`, `pass 92`, `fail 0`, exit 0.

### Measurements

The reviewer's script, `measure.mjs`, was copied unchanged to the scratch folder and run on the project file, as `node measure.mjs <mode> 60000 <seed> D:/Projects2/InstagramApi/src/redact.js`. "New" means texts that round 2 masks and the version leaks. The scratch folder is `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\r4\`.

| set (60,000 texts each) | round 2 leaks | round 3 leaks | round 3 new vs round 2 | round 4 leaks | round 4 new vs round 2 | round 4 fixed vs round 2 | round 4 idempotence failures |
|---|---|---|---|---|---|---|---|
| mixed nested-quote, seed 1 | 21,811 | 22,585 | 5,406 | 15,771 | 0 | 6,040 | 0 |
| mixed nested-quote, seed 2 | 21,636 | 22,517 | 5,446 | 15,715 | 0 | 5,921 | 0 |
| single-secret, seed 1 | 18,879 | 19,231 | 4,823 | 13,184 | 0 | 5,695 | 0 |
| single-secret, seed 7 | 18,847 | 19,327 | 4,892 | 13,262 | 0 | 5,585 | 0 |
| NB-1 family | 60,000 | 27,828 | 0 | 27,828 | 0 | 32,172 | 0 |
| apikey family | 44,347 | 44,347 | 0 | 44,269 | 0 | 78 | 0 |

Ordinary corpora, compared with round 2 and round 3 at marker and span level:
- Generator C (seeds 3 and 5, 120,000 texts): 0 texts differ from round 2.
- Generator E (seeds 4 and 6, 120,000 texts): 391 and 367 texts differ from round 2. All of them are inputs with `apikey=` followed by an escaped quote, where round 2 masked a bare backslash. No other text differs.
- Generator D (seed 4, 60,000 texts): against round 3, 0 markers are added and 454 are removed (the same apikey inputs), and 0 non-secret member values are hidden that round 3 shows. Against round 2, 643 markers are added, all on secret-named member values, which round 3 already masks.

Other checks on the project file:
- Idempotence fuzz, `task2-rereview-probe.mjs <src> fuzz`: `idempotence failures in 50000 random strings: 0`.
- Matrix probe: 7 LEAK rows, the same as round 2, and none new.
- Keys and registry probes: output identical to round 3.
- Timing probe: every case at or below 3.6 ms.
- Implementer's generator (`fix3-compare2.mjs`, unseeded, 60,000 texts): new versus round 2 was 4 on the final file. Three earlier runs of the same code gave 6, 10 and 7. Round 3 gave 243 on this generator in the implementer's run.
- Mutation check: seven mutants, each removing one new rule from the final code and running the final test file. Each fails at least one test. The word-character rule is the last one, and its mutant fails the word-character test.
- Keep-list from the brief, on the final code: the closed `token:"token":"EAAB123456`, the escaped `apikey=\"api_key\":\"EAAB123456`, the escaped `cookie="\"token\":\""EAAB123456`, `access_token="EAAB123456"`, `token: 'EAAB123456'`, `Authorization: "Basic dXNlcjpwYXNz"`, and `{access_token: "EAAB123456"}` are all masked. The literal unclosed `token:"token":"EAAB123456` leaks in rounds 2, 3 and 4 (see concern 1).

### Concerns and limits

1. The literal unclosed `token:"token":"EAAB123456` is not masked in round 2, round 3 or this round. The round 3 report lists it as O-1 and says the NB-1 fix was the closed form, so the keep-list item is taken as the closed form. Not changed here.
2. On the implementer's unseeded generator, new leaks against round 2 are 4 to 10 per 60,000. The examples are dense, multi-level escaped mixtures. The brief's criterion is the reviewer's generator, where the count is zero.
3. OM-1 from round 3 remains for `apikey=\"token\":\"The token is valid\"; name: demo}`, where the tail is masked. Round 2 did not mask it. It is outside this round's scope.
4. The rules are regular-expression lookaheads and lookbehinds. Zero is measured on the reviewer's generator, the fuzz and the probes. It is not proven for the whole class.
5. An unquoted value that starts with an escaped quote is no longer marked with a bare backslash. No secret is exposed by this, since round 2 leaked the same secrets on those inputs.

### Self-review

- I read the diff against round 3 and the added tests. The comments describe the rules as coded.
- Each new rule is pinned by at least one test. The seven mutants are the check.
- These files are identical to the `task-2-fix3-head` snapshot: `src\errors.js`, `src\audit.js`, `src\config.js`, `test\audit.test.js`, `test\config.test.js`, `package.json` and `CLAUDE.md`. The only project files changed are `src\redact.js`, `test\errors.test.js` and this report.

## Fix round 5

This round covers N-1 and N-2 in `task-2-rereview-4.md`, and the five acceptance criteria in its Round verdict. Where this section and the earlier sections differ, this section is current.

Status: DONE_WITH_CONCERNS. Two points need a ruling: criterion 5 holds on the round 3 reading only (concern 1), and on unseen seeds criterion 2 still has 3 and 2 residual texts (concern 2). No git command was run, no subagent was used, and the only project files changed are `src\redact.js` and `test\errors.test.js`.

### Files changed

- `D:\Projects2\InstagramApi\src\redact.js`. Five patterns are new (`KEYED_MEMBER_AFTER_SECRET`, `QUOTED_ESCAPED_VALUE`, `QUOTED_ESCAPED_SINGLE`, `BARE_ESCAPED_VALUE`, `JSON_ESCAPED_OPEN`). Three existing patterns change: the closing rule of `JSON_MEMBER_FIRST` and of `JSON_MEMBER`, the nested-pair check of `JSON_MEMBER_FIRST`, and the unquoted value of `KEY_VALUE`. The chain order and the comments follow. Exports are unchanged (`redact`, `registerSecret`). The round 4 file is kept at `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\round5\redact.round4.js`, and it matches the snapshot `task-2-fix4-head\src\redact.js`.
- `D:\Projects2\InstagramApi\test\errors.test.js`. Eleven tests added at the end, so the file has 68 tests. No existing test changed.
- Unchanged: `src\errors.js`, `src\audit.js`, `src\config.js`, `test\audit.test.js`, `test\config.test.js` and `package.json`.

### What changed, and why

Each shape from N-1 and N-2 was traced through the chain. Three round 4 causes produce them. The closing-quote lookahead of the first JSON pass rejects a plain value followed by a word character (N-1). KEY_VALUE takes a quoted or escaped value up to its first unescaped quote, so a secret after that quote falls outside every match (N-2, and the round 1 and round 3 classes of the same shape). KEY_VALUE can also read a JSON key as the value of a preceding separator, which removes the member the JSON pass needs.

1. Closing rule, both JSON passes. A value with no escaped quote closes at its first quote, whatever follows it. A value that holds an escaped quote closes only at a quote not followed by a word character, as before. This fixes N-1 (`token:"token":"<value>"ok`, `apikey="password":"<value> "quoted" word"`).
2. Nested-pair check, first JSON pass. A single quote after `key=` no longer counts as a nested pair. Before, `"token":"<value> a=b api_key='<value>'"` was rejected and only the nested pair was masked.
3. `KEYED_MEMBER_AFTER_SECRET`, before KEY_VALUE. A secret-named member that follows a secret key and a separator, with an escaped quote in its value, is masked with its key and its value. KEY_VALUE then cannot read the member key as a value.
4. `QUOTED_ESCAPED_VALUE` and `QUOTED_ESCAPED_SINGLE`, before KEY_VALUE. A double-quoted or single-quoted secret value that holds an escaped secret member runs to the close check of ESCAPED_JSON_MEMBER, so an unescaped quote inside it does not end it. The single-quoted form adds its own closing quote, as KEY_VALUE does.
5. `BARE_ESCAPED_VALUE`, before KEY_VALUE. An escaped quote after `=`, `:` or `%3D` with no space (`password=\"<value>\"`) masks the bare value. An escaped member such as `\"name\":` is left to ESCAPED_JSON_MEMBER.
6. KEY_VALUE, unquoted value. It stops before a backslash that opens an escaped member (`\"name\":`), so that backslash is not consumed into the value.
7. `JSON_ESCAPED_OPEN`, after the second JSON pass. A secret member with no closing quote, whose value holds an escaped quote, is masked with its key. This makes the second pass stable, because the next pass no longer reads the key as a value.

Tried and dropped during the round, because the criteria did not need them: a key rule in KEY_VALUE that refused a secret-named JSON key as a value (it changed ordinary text), a separate JSON pass for closed escaped members (`JSON_KEYED_ESCAPED`), and a refined single-quote rule (round 4's form is kept).

### Measurements

Scripts, all in `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\round5\`: `criteria.mjs` (the five criteria, run in five parallel sections by `run.sh` and merged by `combine.mjs`), `criteriaH.mjs` (the same with unseen seeds), `shapes5.mjs` (the brief's keep-list, the round 4 test inputs, N-1 and N-2), `mutate.mjs` and `ordmarkers.mjs`. The reviewer's `measure.mjs` was copied unchanged and run on the four R-a samples. Its candidate counts agree with `criteria.mjs`, and its idempotence count is zero. The round 4 column comes from the same script, and it matches the reviewer's round 4 figures. Counts are per 60,000-text set. "New" means the candidate leaks and the other version masks.

Reviewer's samples (the samples the criteria name):

| Criterion | Round 4 | Round 5 |
|---|---|---|
| 1. R-a new vs round 2 (ra 1, ra 2, ra1 1, ra1 7) | 0 | 0 |
| 2. R-a new vs round 1 | 1,252 | 0 |
| 2. R-a new vs round 3 | 2,713 | 0 |
| 3. NB-1 grid, suffix `ok`, new vs round 3 (2,500 texts) | 1,000 | 0 |
| 3. NB-1 grid, suffix `x`, new vs round 3 | 1,000 | 0 |
| 3. Substitution sets vs round 3 (D 4, D 8, E 4, E 6, five variants each) | 1,652 | 0 |
| 4. Idempotence failures, all sets, and the 50,000-string fuzz | 0 | 0 |
| 5. Ordinary corpora vs round 3, texts that differ and are not marker removals (1,482 texts differ) | 0 | 0 |
| 5. Ordinary corpora vs round 4, texts that differ (strict reading) | 0 | 513 (concern 1) |

Per R-a set, round 5 is 0 new against round 1 and round 3, and 0 new against round 2. It fixes 11,882, 11,771, 9,873 and 9,886 texts that round 2 leaks. The reviewer's unchanged script gives the same candidate counts.

Holdout, seeds not used while tuning (R-a 3 and 4, ra1 2 and 9, D 11 and 12, E 11 and 12, C 7 and 8, NB-1 3, apikey 4):

| Criterion | Round 4 | Round 5 |
|---|---|---|
| 1. new vs round 2 | 0 | 0 |
| 2. new vs round 1 | 1,324 | 3 |
| 2. new vs round 3 | 2,722 | 2 |
| 3. grid `ok` / `x`, new vs round 3 | 1,000 / 1,000 | 0 / 0 |
| 3. substitution sets, new vs round 3 | 1,577 | 0 |
| 4. idempotence failures | 0 | 0 |
| 5. ordinary, texts that differ from round 3 and are not marker removals (1,404 texts differ) | - | 0 |

Ordinary corpora, round 3 reading. Round 5 differs from round 3 on 2,886 texts across the 12 ordinary sets (1,482 on the reviewer's six, 1,404 on the holdout six). Every one of them is a marker removal, and none adds a marker. These are the reviewer's designed marker removals, which round 5 keeps.

### Covering tests and output

The eleven new tests pass. `npm test` in the project gives `tests 103`, `pass 103`, `fail 0` (92 before, plus 11). The new tests, from the spec output:

```
✔ a secret member followed by a word character, as in token:"token":"<value>"ok, is masked
✔ a secret member whose value holds a quoted word masks the value and keeps the text after it
✔ an escaped member whose value holds a quoted secret is masked to the end of the escaped string
✔ an escaped secret member after key=value text is masked, and so is an escaped secret value
✔ a secret key whose quoted value is a secret member masks that member and its value
✔ a secret member with an escaped quote and no closing quote is masked with its key
✔ a single-quoted secret value that holds an escaped secret member is masked to the end of the escaped string
✔ ordinary text keeps its round 4 output: a secret key with a plain quoted value keeps its key masked
✔ ordinary text keeps its round 4 output: a non-secret escaped member does not extend a secret value
✔ redaction of the round 5 samples is idempotent
✔ a secret member whose value holds an escaped member, with no closing quote, leaves no secret and is stable
```

Red check. The same test file run against round 4's `redact.js` gives `tests 68`, `pass 61`, `fail 7`. The seven failures are the leak and shape tests. The other four pass on round 4 because they pin round 4's own output: the two ordinary-text tests, the idempotence test and the no-closing-quote test.

Mutation check on the final file, one rule removed or one old form restored, with `errors.test.js` run each time. Each mutant fails at least one test. No KEYED pass: 1 failing. No QUOTED_ESCAPED_VALUE: 1. No QUOTED_ESCAPED_SINGLE: 1. No BARE_ESCAPED_VALUE: 1. No JSON_ESCAPED_OPEN: 1. Unquoted value takes escaped members: 1. No closing-quote rule in the JSON passes: 1. Nested check counts a single quote: 1. Bare separator allows a space: 1.

Trade-off, each rule removed from the final file and measured on the criteria (reviewer's samples):

| Removed | C1 new vs r2 | C2 new vs r1 | C2 new vs r3 | C3 subst new vs r3 | C4 idempotence | Note |
|---|---|---|---|---|---|---|
| none (final) | 0 | 0 | 0 | 0 | 0 | |
| KEYED_MEMBER_AFTER_SECRET | 0 | 7 | 0 | 0 | 0 | |
| QUOTED_ESCAPED_VALUE | 0 | 766 | 1,082 | 488 | 0 | |
| QUOTED_ESCAPED_SINGLE | 0 | 0 | 1 | 0 | 0 | |
| BARE_ESCAPED_VALUE | 0 | 1 | 0 | 0 | 0 | |
| JSON_ESCAPED_OPEN | 0 | 0 | 0 | 0 | 73 | |
| unquoted-value exception | 0 | 200 | 1,113 | 0 | 0 | |
| nested check counts a single quote | 0 | 46 | 62 | 0 | 0 | |
| closing-quote rule (both JSON passes) | 0 | 0 | 0 | 0 | 0 | test at line 441 leaks |
| bare separator allows a space | 0 | 0 | 0 | 0 | 0 | test at line 435 fails |

The criteria samples do not exercise the closing-quote rule or the bare-separator rule. Their tests do, so a zero in those two rows does not mean the rule is unneeded.

Other checks on the final file:
- Matrix probe: 6 LEAK rows, against 7 in round 4. None of the 6 is new. The keys and registry probes match round 4 exactly.
- Fuzz, 50,000 random strings: 0 idempotence failures.
- Timing, the reviewer's 15-case probe: the worst case is 123 ms in this run (round 4: 52 ms in the same run; round 5 measured 89 ms on an earlier run). Doubling the input roughly doubles the time from 5,000 to 320,000 characters, so the growth is linear.
- Test suite, `npm test` in the project: 103 tests, 103 pass.

### Concerns and limits

1. Criterion 5, literal reading against round 4. 513 ordinary texts change: 264 on D seed 4 and 249 on D seed 8. On the holdout the count is 506. All of them are in the reviewer's designed list (round 4 differs from round 3 there), and each now shows round 3's output. This is the "shows more text" change the reviewer listed for round 4, reverted. It is forced by criterion 3's `quoted_in_middle` set (round 4: 243 and 245 new against round 3). Its ordinary twin has the same structure with `quoted` in place of the secret, for example `cookie="\"session_id\":\"a "quoted" word\" "page": 2" end`. A rule that masks the secret masks that text too, and I found no rule that separates them without reading the content. On the reviewer's acceptance wording (against round 3, apart from marker removals), criterion 5 holds. This needs a ruling.
2. Holdout residual for criterion 2. On unseen seeds, 3 texts leak that round 1 masks and 2 that round 3 masks (4 in 240,000). They share one class: a quoted or `%3D`-quoted secret inside an escaped member's value, after an unescaped quote, for example `{"apikey":"\"sessionid\":\"<value>\" access_token%3D"<value> api_key="<value>"" x`. I did not fix them. Each earlier attempt moved the residual to another shape.
3. Zero is measured, not proven. The new rules are lookahead patterns tuned on the reviewer's generators and the 32 shapes in `shapes5.mjs`. The holdout shows residual leaks, which is concern 2. The module is more complex than round 4's: five patterns added and three changed.

## P5a (2026-10-23)

Package P5a: O-2 (the token-shape scrub and the escaped forms, in JS and in Python) and O-1 (the structured-first CHECKPOINT classification), both from the controller's decisions in `progress.md` ("OWNER DECISIONS MADE BY THE CONTROLLER (2026-10-22)"), and the findings A-34 (byte-order mark) and A-30 (sidecar buffer). The documented limits A-2, A-3, A-16 and A-19 are wording only, for P7. I changed no file in the service, the poller, the HTTP server or the MCP module.

### Result

- `npm test` at the end of P5a: 1016 of 1016 pass, exit 0. The measured baseline at the start of P5a, before my first edit, was 996 of 996, so P5a added 20 tests. None is skipped. After review round 1 (below), the suite is 1026 of 1026; after the coordinator's change, 1029 of 1029; after round 2 (below), 1060 of 1060 at the last run. Other work changed test files in this tree during round 2, so this total is a snapshot.
- Python check (`test/sidecar-python.test.js`): 21 of 21 pass at the end of P5a, none skipped; 23 of 23 after review round 1. Python 3.13.7 is on PATH. Four of the 21 at the end of P5a are new, the scrub tests.
- Files I changed in P5a: `src\redact.js`, `src\errors.js`, `src\config.js`, `src\unofficial\sidecar.js`, `sidecar\ig_sidecar.py`, `test\errors.test.js`, `test\config.test.js`, `test\sidecar.test.js`, `test\sidecar-python.test.js`. The review diff p4-final to p5a-head also shows 16 files that I did not change; they are not in this list, and I did not revert them. Review round 1 changed `src\redact.js`, `src\errors.js`, `src\unofficial\sidecar.js`, `sidecar\ig_sidecar.py`, `test\errors.test.js` and `test\sidecar-python.test.js`, and no others.

### Each change, file and line

Line numbers are those of the files at the end of P5a.

1. **O-2 (a), token-shape scrub.** `src\redact.js` line 108: `TOKEN_SHAPE`, at the end of P5a the pattern `(?<![A-Za-z0-9])(?:IGAA|IGQV|EAA)[A-Za-z0-9_-]{20,}`. Review round 1 (M-2, M-3) replaced the pattern, and review round 2 (M-R1-1) rewrote it without lookaheads; it is now at lines 108 to 124 (see below). It runs last in `maskText`, at line 140 at the end of P5a and at line 156 now (a replacer that calls `tokenShaped`, from round 2). The Bearer rule (line 28 at the end of P5a) masked any value after the word Bearer; review round 1 (M-1) narrowed it so that the word in prose is kept.
2. **O-2 (b), escaped forms.** `src\redact.js` lines 195 to 206, in `registerSecret`. Each value is registered in three forms: the raw value, its URL-encoded form (`encodeURIComponent`, as before), and its JSON-escaped form (`JSON.stringify(value).slice(1, -1)`, line 201). Every form is checked against the marker before anything is added (lines 203 to 206), so a refused value never reaches the registry. `maskRegistered`, which `events.js` uses for stored message text and drafts, reads the same registry, so it masks the new forms too.
3. **O-1, structured-first classification.** `src\errors.js` lines 56 to 61 (comment) and lines 68 to 97 (code) at the end of P5a; after review round 1, lines 64 to 70 (comment) and 80 to 92 (code); after round 2, lines 57 to 63 (comment) and 73 to 85 (code). At the end of P5a the structured signals were checked first (code 190, AUTH_EXPIRED; HTTP 429 and codes 4, 17, 32, 613 and 80002, RATE_LIMITED; code 368, ACTION_BLOCKED), and the text was the fallback. Review round 1 (M-4) replaced that fixed order with the most severe candidate, as described below. The text match stays broad, as ruled. Each mapping records the signal that decided in `details.signal` (now line 92): `code`, `text`, or `none` when nothing matched. The details never hold message text. The subcode is recorded and not mapped, because its values are not verified until the live phase.
4. **A-34, byte-order mark.** `src\config.js` lines 91 to 93: a leading U+FEFF is removed after the file is read and before it is parsed. The error for a file that is not JSON is unchanged.
5. **A-30, sidecar buffer.** `src\unofficial\sidecar.js` lines 31 to 42 at the end of P5a (lines 30 to 43 now): a new exported function `splitLines(buffer, chunk)`. It slices each complete line once and the unfinished tail once per chunk, and returns the complete lines and the unfinished tail. The P5a wording said the whole text was sliced once per chunk; that was wrong, and review round 1 (M-5) corrected the comment and this item. `receive` (lines 186 to 197 at the end of P5a; lines 185 to 198 now) uses it. The size limit and the handling of a dead session are unchanged.
6. **Python scrub, escaped forms.** `sidecar\ig_sidecar.py` line 24 (the import); lines 228 to 239 at the end of P5a (`_secret_forms`: the raw value, the JSON-escaped form with and without non-ASCII characters, and the URL-encoded form in three ways); lines 242 to 252 at the end of P5a (`_safe_message` replaces every form, longest first). Review round 1 (M-6) replaced the forms in `_secret_forms` with exactly the JS registry forms, and changed the import to `quote` alone; see below. `_safe_message` is now at lines 241 to 251. The signature and the 500-character cap are unchanged.

### Tests

New tests, by file (20 in all):

`test\errors.test.js` (11):
- a structured code wins over a conflicting checkpoint text: code 190 is AUTH_EXPIRED, by the code
- a structured code wins over a conflicting checkpoint text: code 368 is ACTION_BLOCKED, by the code
- a structured code wins over a conflicting checkpoint text: code 4 and HTTP 429 are RATE_LIMITED, by the code (changed in review round 1: now CHECKPOINT, by the text; see below)
- a text-only CHECKPOINT still maps to CHECKPOINT, and records the text signal
- a message with no signal maps to API_ERROR, and records no signal
- the classification detail never carries the message text
- a token in a JSON-escaped string is masked
- a URL-encoded token is masked
- a token-shaped string with an IGAA prefix is masked
- an ordinary word is not masked by the token-shape rule
- the exact-value registry still masks the raw form

`test\config.test.js` (2):
- a config file with a UTF-8 byte-order mark loads
- a config file that is not JSON gives the clear error, with or without a byte-order mark

`test\sidecar.test.js` (3):
- splitLines splits a large reply of many lines and keeps the unfinished tail
- splitLines removes a carriage return at the end of a line
- splitLines keeps the buffer to one line, however many lines a stream holds

`test\sidecar-python.test.js` (4):
- python scrub: a password in JSON-escaped form is masked in an error message
- python scrub: a session token in URL-encoded form is masked in an error message
- python scrub: the raw password is still masked in an error message
- python scrub: an ordinary error message is unchanged

Changed tests (one test, and one import) at the end of P5a. Review round 1 changed a second test; see below.
- `test\errors.test.js`. The name was "the message of a mapped error is redacted, and the details hold status and codes only"; it is now "... status, codes and the signal only". The old assertion was `assert.deepStrictEqual(err.details, { status: 400, code: 100, subcode: 2207006 });`. The new assertion is `assert.deepStrictEqual(err.details, { status: 400, code: 100, subcode: 2207006, signal: 'none' });`. The details now carry the signal.
- `test\sidecar.test.js` line 5: the import now also names `splitLines`. No assertion changed.

### Evidence

RED, before the source change, with the tests written. Command: `node --test test/errors.test.js test/config.test.js test/sidecar.test.js test/sidecar-python.test.js`. Result: tests 136, pass 124, fail 12, exit 1. The twelve failures are the signal tests, the JSON-escaped and IGAA redaction tests, the byte-order mark test, the changed details assertion, the two Python scrub tests (for example `login failed: pa\"ss\\word-1` was not masked), and the sidecar file, which did not load because `splitLines` did not exist. Seven new tests passed before the change, as guards for behaviour that already held: the URL-encoded registry test, the raw registry test, the ordinary-word test, the detail-without-text test, the config test for a file that is not JSON, and the two Python tests for the raw password and the ordinary message.

GREEN, the four files after the change. Command: the same. Result: tests 164, pass 164, fail 0, exit 0. Per file: errors 82, config 32, sidecar 29, sidecar-python 21.

Full suite at the end of P5a. Command: `npm test`, run after the last comment edits. Result: tests 1016, pass 1016, fail 0, skipped 0, exit 0. After review round 1: tests 1026, pass 1026, fail 0, exit 0. After the coordinator's change: tests 1029, pass 1029, fail 0, exit 0.

Python check output. Command: the test's own scrub script, run with `python -I -B -c` and the two values on stdin. Exit 0:

```
{"json": "login failed: [redacted]", "url": "session [redacted]", "raw": "password [redacted]", "plain": "a plain failure"}
```

### Checks outside the suite

Each comparison is against the state before P5a, the snapshot `snap\task-2-fix5-head\src`, which holds the redaction code as it was.

- The reviewer's leak matrix, at the end of P5a: the LEAK rows are identical to the baseline. Review round 1 changed two rows; see below.
- The reviewer's ordinary-text corpus (42 sentences), at the end of P5a: identical to the baseline. The token-shape rule masks nothing extra there. Review round 1 changed two sentences; see below.
- The reviewer's keys, registry and probe 3: identical to the baseline.
- The reviewer's fuzz (50,000 random strings): 0 idempotence failures.
- Token-shaped text (20,000 random strings with prefixes, separators and escapes): 0 idempotence failures.
- The reviewer's timing probe: 160,000 characters take 9 ms, against 2 ms before. The token-shape rule is one more linear pass.
- A-30, measured. The old loop (one slice per line, `+=` per chunk) took 24 to 39 ms on 8 MB in 64 KB and 4 KB chunks. The new code took 24 to 26 ms. The quadratic cost does not reproduce on Node 24, where V8 uses sliced strings. The change is made as the finding asks, and the tests pin correctness and the one-line bound. No speed-up is claimed. 200,000 lines (20 MB) in one chunk split in 61 ms.

### Documented limits (A-2, A-3, A-16, A-19): no code change

- A-2, two keys that mask to the same text overwrite each other. True: two keys that both mask to `token=[redacted]` leave one entry. The README wording is accurate.
- A-3, Map and Set contents are dropped. True: a Map and a Set each become `{}`. The README wording is accurate.
- A-16 (a failed hashtag lookup is reported as unknown) and A-19 (a timestamp a few seconds ahead of the clock). P5a does not touch either. Their README wording is accurate.

### Wording for P7 (README), listed here and not edited

1. "Known limits: Redaction", first paragraph. Replace "Registered values are masked as exact text." with "Registered values are masked in three forms: the raw value, its URL-encoded form and its JSON-escaped form."
2. The same section. Add: "Error and audit text also masks a token of a known shape: a whole run of letters, digits, '_' and '-' that starts with IGAA, IGQV or EAA, has at least 20 characters after the prefix, and contains a digit, a lower-case letter and an upper-case letter. A token glued to a letter or a digit is not masked. A token of another shape is masked only when it is registered."
3. "Other limits" in the same section. Replace "A bare token with no key name is not caught unless it is registered." with "A bare token is caught by the registry, or by the token-shape rule. A word after 'Bearer' is masked only when it is token-shaped, so 'Bearer' in ordinary prose is kept. Any other bare token is not caught."
4. "Stops and recovery", the line that begins "Stop detection reads Graph's error text as well as its codes." Replace it with: "Stop detection takes the most severe of Graph's codes and its error text. The account stops and CHECKPOINT outrank the rate limit, so a rate-limit code with a checkpoint text is a CHECKPOINT, and a code wins a tie with the text. An error whose text contains 'challenge', 'checkpoint', 'two-factor' or 'feedback required' is treated as a stop when no code of the same or a higher rank decides. The error's details record whether a code or the text decided, and never the message text."
5. "Config file": add "A UTF-8 byte-order mark at the start of the file is accepted and removed."
6. "Accepted in the final review": remove the A-34 line ("Save the file without a BOM"), which is now fixed. Reword the A-30 line to "The sidecar's line splitter slices each line once and the unfinished tail once per chunk. No slowdown was reproduced on Node 24."
7. "The unofficial route: the instagrapi sidecar": add "The sidecar's error text removes each secret it holds in its raw, JSON-escaped and URL-encoded forms."

### Not covered by P5a (carried forward)

- The registry holds the raw, URL-encoded and single JSON-escaped forms. A value that is JSON-encoded twice (JSON inside a JSON string) is not matched by the registry. The key and quote rules still cover the key=value and escaped-member shapes.
- The classification records the subcode but does not map on it, because its values are not verified.
- The token-shape rule covers only the prefixes named in O-2. A token with another prefix is masked only when it is registered. The rule also needs a digit, a lower-case letter and an upper-case letter in the run, so a run without one of them is not masked.
### Review round 1 (2026-10-23)

Review: `D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\p5a-review.md`, items I-1 and M-1 to M-6. Line numbers below are those at the end of this round.

- **I-1, report.** Corrected in place above: the statement about the service, poller, HTTP server and MCP module (line 814); the test counts and the 996 baseline (line 818); the Python count (line 819); the file list (line 820); and the P5a description of the code this round changed (items 1, 3, 5 and 6, and the test list at line 840). The review diff p4-final to p5a-head changes 16 files that I did not change. I did not revert them, and they are not listed here.
- **M-1, the word bearer in prose.** `src\redact.js` lines 27 to 31 (comment, and `BEARER` at lines 30 to 31). Old pattern: `/\bbearer\s+(?!\[redacted\])[^\s"'&,;<>)\]}]+/gi`. New pattern: `/(?<![A-Za-z])(?:[Bb]earer|BEARER)\s+(?!\[redacted\])`, then three lookaheads (a digit, a lower-case letter and an upper-case letter in the run), then `[A-Za-z0-9._~+\/=-]{20,}(?![A-Za-z0-9._~+\/=-])/g`. There is no i flag. `Authorization: Bearer x` is still masked by the AUTHORIZATION rule.
- **M-2 and M-3, identifiers and escape boundaries.** `src\redact.js` lines 108 to 119 at the end of round 1 (comment 108 to 115; `TOKEN_SHAPE` 116 to 119), and `.replace(TOKEN_SHAPE, MARKER)` at line 151; at the end of round 2 they are at lines 108 to 124 (see round 2). Old pattern: `(?<![A-Za-z0-9])(?:IGAA|IGQV|EAA)[A-Za-z0-9_-]{20,}`. New: the prefix may follow a character that is not a letter or a digit (`(?<![A-Za-z0-9])`; see the coordinator's change below, which removed `_` and `-` from this exclusion), a backslash escape `\n \r \t \b \f`, or a percent-encoded `%0A`, `%0D`, `%09` or `%20`. The run must be whole, with a digit, a lower-case letter and an upper-case letter, and at least 20 characters after the prefix. (This is the round 1 form; round 2 moved the lookaheads out of the pattern, see round 2.)
- **M-4, conflicting signals.** `src\errors.js` at the end of round 1: the comment at lines 64 to 70, and the candidates and selection at lines 80 to 92. A `SEVERITY` table at lines 39 to 46 copied the ranks from `src\guard.js`; round 2 (M-R1-4) removed the table and imports `rankOf` from `src\stops.js`, see round 2. Old: a fixed if-chain in the order 190, 429 and rate codes, 368, feedback text, checkpoint text. New: every matching signal is a candidate; the most severe wins; a tie keeps the earlier one, in the order code 190, code 368, rate limit, feedback text, checkpoint text.
  Behaviour changes: HTTP 429 or code 4 with checkpoint text is now CHECKPOINT (was RATE_LIMITED); HTTP 429 or code 4 with feedback text is now ACTION_BLOCKED (was RATE_LIMITED). Code 190 with checkpoint text stays AUTH_EXPIRED, by the code (`test\errors.test.js` line 563, an existing test that I checked and kept).
  Changed test, `test\errors.test.js` lines 575 to 582. Old name: "a structured code wins over a conflicting checkpoint text: code 4 and HTTP 429 are RATE_LIMITED, by the code". Old assertions: `byCode.kind` and `byStatus.kind` equal `'RATE_LIMITED'`, and their `details.signal` equal `'code'`. New name: "a checkpoint text outranks a rate-limit code: code 4 and HTTP 429 with a checkpoint text are CHECKPOINT, by the text". New assertions: `kind` equals `'CHECKPOINT'` and `details.signal` equals `'text'`, for both.
- **M-5, splitter comment.** `src\unofficial\sidecar.js` lines 30 to 33, comment only. Old: "The text is sliced once per chunk, not once per line". New: "Each complete line is sliced once, and the unfinished tail is sliced once per chunk". Item 5 above is corrected to match.
- **M-6, Python forms.** `sidecar\ig_sidecar.py` line 24 (the import is now `quote` alone) and lines 228 to 238 (`_secret_forms`). Old forms: the raw value, `json.dumps(value)[1:-1]`, `json.dumps(value, ensure_ascii=False)[1:-1]`, `quote(value, safe="")`, `quote(value, safe="!*'()~")` and `quote_plus(value, safe="")`. New forms: the raw value; `quote(value, safe="!*'()~")`, which is skipped for a lone surrogate (`UnicodeEncodeError`); and `json.dumps(value, ensure_ascii=False)[1:-1]`. These equal the JS registry forms `value`, `encodeURIComponent(value)` and `JSON.stringify(value).slice(1, -1)`.
  `test\sidecar-python.test.js`: line 178, the scrub script now reads stdin as UTF-8 bytes (`json.loads(sys.stdin.buffer.read().decode("utf-8"))`; it was `json.load(sys.stdin)`); line 184, a new `urlpw` message; the new test at line 234; `FORMS_SCRIPT` at line 243; the new parity test at line 266.
- **Ten new tests.** `test\errors.test.js`: line 584 (HTTP 429 with code 368 is ACTION_BLOCKED); line 636 (the word bearer in prose is not masked); line 640 (a Bearer header with a token-shaped value is masked); line 646 (IGAAMAX_LIMIT and IGAA_ENABLE_LOGGING_FEATURE are not masked); line 651 (EAA-compliant-standard-document is not masked); line 658 (a token after a newline escape is masked); line 662 (a token after %0A is masked); line 666 (a prefix glued to a letter, or to a digit inside a longer word, is not masked, and a whole token is). `test\sidecar-python.test.js`: line 234 (a value with a quote and a backslash is masked in URL-encoded form); line 266 (the Python forms equal the JS registry forms for a value with a quote, a backslash, a space and a newline, and for non-ASCII text).
- **Coordinator change, after round 1.** The token-shape prefix no longer treats `_` and `-` as a letter or digit boundary, so a token-shaped run after either one is masked. `src\redact.js` line 117: `(?<![A-Za-z0-9_-])` changed to `(?<![A-Za-z0-9])`; the comment says so (lines 108 to 116 at the end of round 2). The whole-token rule (`(?![A-Za-z0-9_-])` after the run, and the three mix lookaheads) and the escape boundaries of M-3 are unchanged. Tests, `test\errors.test.js`: line 677 (a real IGAA token directly after `_` is masked; new), line 681 (a real IGAA token directly after `-` is masked; new), line 685 (IGAAMAX_LIMIT after `x_`, after `y-` and alone is not masked; new). RED before the change: 93 tests, 2 failing, the two masking tests (`p5a3-red.txt` in the scratchpad). GREEN after: `test\errors.test.js` 93 of 93; `npm test` 1029 of 1029, exit 0.
- **Counts after this round.** `npm test`: 1026 of 1026 pass, exit 0 after round 1, and 1029 of 1029 after the coordinator's change: 1016 plus 13 new tests; the changed test keeps its count. Per file: errors 90 (was 82), config 32, sidecar 29, sidecar-python 23 (was 21). RED before the source change: 113 tests, 8 failing, each of them a new behaviour (`p5a2-red.txt` in the scratchpad). GREEN for the four files: 174 of 174.
- **Reviewer checks, run again after this round** (scratchpad, not in the suite):
  - `p5a-check.mjs`: 25 PASS, 3 FAIL. Two FAILs are the shape checks, `EAAB` plus 19 characters and `IGQV` plus 20 characters. Their runs are all `y`, with no digit and no upper-case letter, which M-2 no longer masks. With mixed-case runs of the same length, both are masked (`p5a2-mixed.mjs`). The third FAIL, "HTTP 429 with checkpoint text is RATE_LIMITED", is the M-4 change.
  - Leak matrix: two rows now leak, the bare `Bearer ` and `bearer ` before a short value outside a header. This is the M-1 trade-off; the registry still covers loaded tokens.
  - Ordinary corpus: "bearer of bad news" and "bearer bonds are safe" are no longer masked, as M-1 asks.
  - `p5a_py_check.py`: "json ascii LEAK" is the ASCII-escaped JSON form, which M-6 removes; the JS registry never registered it. "url plus space form LEAK" is a false alarm: the check replaces the newline in the value with a space before URL-encoding, so it tests a different string.
  - Regex timing was reported here as linear. That was wrong for a run of a prefix and separators (M-R1-1, focused review); round 2 fixed it, see below (`p5a-regex.mjs`). After the coordinator's change, the matrix and the ordinary corpus are identical to the round-1 run, and idempotence still has 0 failures. Idempotence: 0 failures in 20,000 mixed strings and in 50,000 random strings (`task2-rereview-probe.mjs fuzz`).
- **Limits added by this round.** The limit that a token after `_` or `-` was not masked is removed by the coordinator's change above. A run without a digit, or without an upper-case letter, is not masked by the shape rule. A bare Bearer value outside an Authorization header is masked only when it is token-shaped. Documented limit, accepted in round 2 (M-R1-3): a token glued to a letter or a digit is not masked by the shape rule (`tokenIGAAQV...`, `9IGAAQV...`, pinned by `test\errors.test.js` line 666); registered values are masked exactly.

### Review round 2 (focused review of round 1, 2026-10-23)

Review: `D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\p5a-round1-review.md`. Addressed: M-R1-1 and M-R1-4. Accepted as a documented limit: M-R1-3. Not in this round and not changed by me: I-1 (the one-reply rebuild treats a damaged or missing privateReply line as "no reply"; `src\caps.js` and `src\cli.js`) and M-R1-2 (a flag held only in memory can be dropped by a later failed save; `src\state.js` and `src\cli.js`). The review's verdict lists both as open.

- **M-R1-1, TOKEN_SHAPE is quadratic (fixed).** Cause: the three lookaheads after a prefix each rescanned the rest of the run, for every prefix that passed the boundary, so a long run of `EAA-` or `IGAA_` cost O(n squared). Before the fix, 100,000 characters of `EAA-` took 2,952 ms (RED, `test\errors.test.js` line 694, bound 1,000 ms; `p5a4-red.txt` in the scratchpad). Change: `src\redact.js` line 117 is now `/(?:...)(?:IGAA|IGQV|EAA)[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g`, with no lookahead and no nested quantifier. The mix check is `tokenShaped` (lines 118 to 124), called from the replacer at line 156: `(candidate) => (tokenShaped(candidate) ? MARKER : candidate)`. The scan is linear, because the leftmost candidate's match runs to the end of its run, so the scan resumes after that run. The output does not change: a later candidate inside the run has a run that is a suffix of the first candidate's run, so it fails the mix check whenever the first candidate fails it.
  Equivalence (`p5a4-equiv.mjs`): on 60,000 random texts (prefixes, separators, digits, case variants, escapes, long runs), the round 1 pattern and the round 2 pattern with `tokenShaped` give identical output. 1,038 of the texts contain a masked token. 0 differences.
  Timing (`p5a4-timing.mjs`, full `redact`): about 7 to 8 ms for 100,000 characters, and 46 to 69 ms for 0.8 to 1.2 million characters, in the families `EAA-`, `IGAA_`, `EAA1-`, `EAAa1-` and the prefix after `\n`. 4,600,000 characters of `EAA` plus 19 separators took 274 ms.
- **Tests (new, `test\errors.test.js`).** Line 694: 100,000 characters of `EAA-` with no digit; masks nothing and runs within 1,000 ms (the round 1 pattern took 2,952 ms, so it fails). Line 703: 50,000 repetitions of `-_` (100,000 characters) followed by a real IGAA token; masks only the token and runs within the bound (it passes on both patterns, so it guards the output).
- **M-R1-4, stale description and duplicate table (fixed).** `src\errors.js` line 5 imports `rankOf` from `src\stops.js`. The table is `STOP_RANK` at `src\stops.js` lines 11 to 16, and `rankOf` is at line 19. `src\stops.js` imports nothing, so there is no cycle. The copied `SEVERITY` table is removed, and the candidate loop at `src\errors.js` line 83 compares `rankOf(candidate.kind) > rankOf(chosen.kind)`. The comments at lines 57 to 63 and 73 to 74 name `rankOf` in `src\stops.js`. No `SEVERITY` or `STOP_RANK` name remains in `src\errors.js` (checked). The `src\redact.js` comments had no severity table and no rank description; the table and the stale description were in `src\errors.js`. The `TOKEN_SHAPE` comment in `src\redact.js` was rewritten for M-R1-1 (lines 108 to 116). The round 1 bullet for M-4 is superseded by this.
- **M-R1-3 (accepted, documented limit).** A token glued to a letter or a digit is not masked by the shape rule: `tokenIGAAQV...` and `9IGAAQV...`, pinned by `test\errors.test.js` line 666. Registered values are masked exactly.
- **Review note on `config_IGAA_Mixed_Case_2`.** This value is not masked, because it has 13 characters after the prefix, fewer than 20. The note in the review said it is masked; that was wrong. `config_IGAA_Mixed_Case_2xyzAB12CDEF` is masked to `config_[redacted]`.
- **Counts.** `test\errors.test.js` 95 of 95 (2 new tests in this round). `npm test`: 1060 of 1060 pass, exit 0, at the last run (01:49). The total moved during this round between two runs, and my only edit in between changed a string length in a test (no test added or removed). In the same interval `test\service.test.js` went from 111 to 113 and `test\cli.test.js` from 78 to 81, and I did not edit either file. Other work is changing test files in this tree, so the total is a snapshot.
- **Evidence.** In the scratchpad `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\`: `p5a4-red.txt` (RED), `p5a4-green-errors2.txt` (errors 95 of 95), `p5a4-npm.txt` (1054, the first run after the change), `p5a4-npm2.txt` (1060), `p5a4-equiv.mjs`, `p5a4-timing.mjs`, `p5a4-counts-now.txt`.
