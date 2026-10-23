# Task 2, fix round 1: re-review

## Scope and method

Read-only. No project file was edited, no git command was run, and the full suite was not re-run.

Inputs: `task-2-brief.md`, `task-2-report.md` (including the fix round 1 section), `review-task-2-fix1.diff`, the current `src/redact.js`, `src/errors.js`, `test/errors.test.js` and `test/audit.test.js`, and `src/audit.js` (it calls `redact`). The current project files match `snap/task-2-fix1-head` (checked with `diff -q`). The baseline for "new" versus "pre-existing" is `snap/task-2-head`.

Focused probes ran against the fixed modules and against the head snapshot, from the scratchpad:
- `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task2-rereview-probe.mjs`: leak matrix, ordinary-text corpus, timing, idempotence fuzz, object keys, registry.
- `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task2-rereview-probe2.mjs`: extra leak forms and timing at larger sizes.
- `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task2-rereview-probe3.mjs`: over-masking and late registration.
- The reviewer's original probes, `task2-probe.mjs` and `task2-probe2.mjs`, were re-run unchanged against the fixed code.

Line numbers below refer to the current files.

## Finding verdicts

### I-1, busyResult rejects a fractional retryAfterMs: ADDRESSED

- `src/errors.js:83-86`. Any finite number is accepted and the result is `Math.max(0, Math.ceil(retryAfterMs))`. NaN, Infinity, undefined and strings still throw (`:83-85`).
- `test/errors.test.js:153-157` expects 1.5 to give 2, 1500.5 to give 1501 and -1 to give 0. `:159-165` covers the throws.
- The 1.5 assertion is now at `errors.test.js:154`. The controller's note said line 121, which was the pre-fix position.
- Probe B1 now gives `retryAfterMs: 1501`.

### I-2, bare and text-form token values unmasked: ADDRESSED against the required fix

Each required item is present and working:
- `registerSecret`: `src/redact.js:103-117`. It throws `IgError` VALIDATION for a non-string, a blank value, a value under 8 characters (`:104`) and a value inside the marker (`:111-113`). It registers the value and its `encodeURIComponent` form (`:114-116`).
- Masking uses `split` and `join` over the registry, longest value first (`:52-54`).
- `KEY_VALUE` accepts `:` and `%3D` (`:35`).
- The Basic pattern is `AUTHORIZATION` (`:29-30`).
- Escaped JSON is handled by `ESCAPED_JSON_MEMBER` (`:42-45`). The brief said JSON_MEMBER would accept escaped quotes. The implementer used a sibling pattern and left `JSON_MEMBER` unchanged (`:39`). The stated reason holds: one pattern would consume text beyond the secret. The behaviour is met, so I accept the wording deviation.
- `api_key` and `passwd` are in the key list (`:12`). `code` is not.
- Original probes, re-run: P1 gives `{"detail":"{\\\"access_token\\\":\\\"[redacted]\\\"}"}`. P2 gives `owner token: [redacted]`. P4 gives `?access_token%3D[redacted]`. P5 gives `Authorization: Basic [redacted]`. P7 is unchanged and correct.
- P3 and P6 are not masked when unregistered, which is ruling 5. Once a value is registered they are masked (`test/errors.test.js:245-259`, `test/audit.test.js:101-108`).
- Every required form leaks in head and is masked in the fix (leak matrix).

The residual gaps below are outside the required list and are pre-existing (same output in head). They are reported in Out-of-scope observations O1 and O2, and the controller must decide whether they belong to this round. The registry coverage gaps N1, N2 and N5 are new and are reported under New breakage. They do not reopen I-2, because the required fix defines replacement in strings.

### M-1, idempotence: ADDRESSED

- Negative lookaheads before the captured values: `src/redact.js:26` (BEARER), `:30` (AUTHORIZATION), `:35` (KEY_VALUE).
- The fuzz covers 50,000 random strings built from secret words, separators, quotes and the marker. The fixed code has 0 failures. Head has 5,797.
- The directed samples are at `test/errors.test.js:200-212`.
- `JSON_MEMBER` and `ESCAPED_JSON_MEMBER` have no lookahead. Both replace with the same shape, so they are idempotent in practice. The fuzz covers them.

### M-2, trim before the digit test: ADDRESSED

- `src/errors.js:43-49`. `graphCode` trims strings before the digit test.
- Status goes through the same function (`:60`), and the code too (`:61`). The rate-limit test uses `httpStatus` (`:65`).
- Tests: `test/errors.test.js:99-108`. Probe S1 gives `AUTH_EXPIRED` and S2 gives `RATE_LIMITED`.

### M-5, CHECKPOINT tests for the two forms: ADDRESSED

- Tests: `test/errors.test.js:74-86` (challenge_required and two-factor required).
- The mapping is `CHECKPOINT_TEXT` at `src/errors.js:41` and the branch at `:67`. Probes S4 and S5 give `CHECKPOINT`.

### M-7, IgError arguments: ADDRESSED

- `src/errors.js:28-33`. `String(message ?? kind)` is at `:30`, `details ?? {}` at `:33`, and the kind check is kept at `:29`.
- Tests: `test/errors.test.js:135-143`.

### Controller rulings on the implementer's extra changes

1. Two extra leaks fixed: ADDRESSED. The key restriction is at `src/redact.js:16` and `:34-37`, with the test at `test/errors.test.js:282-288`. The nested escaped quote is handled by `:42-45`, with the test at `test/errors.test.js:275-280`.
2. AUTHORIZATION masks any scheme: ADDRESSED, with notes. The rule is at `src/redact.js:29-30`. `Authorization: Token X` gives `Authorization: [redacted] [redacted]`, because KEY_VALUE also masks the scheme word. The result is cosmetic and idempotent. A Digest header is only partly masked (O5).
3. registerSecret refuses blank and marker-contained values: ADDRESSED. `src/redact.js:104` and `:111-113`, with tests at `test/errors.test.js:261-267`.
4. Module cycle: ACCEPTED, and the conditions hold. Each cross-import is used only inside a function body. `src/redact.js:105` and `:112` use `IgError` inside `registerSecret`. `src/errors.js:30`, `:33` and `:86` use `redact` inside the `IgError` constructor and `busyResult`. Neither file calls the other at top level: errors.js top level holds only `ERROR_KINDS`, `KINDS`, the class and the constants; redact.js top level holds only the regex, Set and string constants. Both load orders ran cleanly (errors.js first, and redact.js first), and `busyResult`, `registerSecret` and `redact` all worked. The cycle is not needed for correctness, so it can stay. Any future top-level call across it would break it.
5. Bare values masked only when registered: ACCEPTED as a carry-forward. Task 9 must register every secret. The coverage gaps N1, N2 and N5 apply to registered values, so Task 9 needs them in mind.
6. A `key=value` value with a literal space masked only up to the space: ACCEPTED, with a precision note. `password=hunter 2` gives `password=[redacted] 2`. Head is the same, because the value class is unchanged. One exception is new. For a value that starts with `basic `, the fix masks nothing, because the lookahead at `src/redact.js:35` skips it. Head masked the word `Basic`. The secret after the space leaks in both, so no extra secret is exposed. Only the word `Basic` is now visible.

## New breakage in the fix diff

### N1, Important: a registered value passes through redact() when it is an object key

- Where: `src/redact.js:87-89` copies keys verbatim, and `maskText` runs only on values. The comment at `src/redact.js:101-102` says "Every output then masks it, whether or not a key name sits beside it". That is false for keys.
- Evidence: after `registerSecret('Kx8mPq4Rs1')`, `redact({ [k]: 'v' })` gives `{"Kx8mPq4Rs1":"v"}`, and `redact({ ['x ' + k]: 1 })` gives `{"x Kx8mPq4Rs1":1}`. The value path works: `redact({ note: k })` gives `{"note":"[redacted]"}`.
- Reach: `src/audit.js:19-26` passes `detail` through `redact`, and the keys survive. A token used as a key would be written to the audit file.
- Pre-existing part: a `key=value` text inside a key is also unmasked in head (`{"https://g?access_token=Qz9xWv7Lm2":"[redacted]"}`). One change at `src/redact.js:88` closes both: apply `maskText` to the key, and keep `SECRET_KEY.test` on the raw key.
- No test covers keys.
- Why Important: the guarantee the fix states is broken on a path the audit log uses, and the fix is small.

### N2, Minor: a registered value that is a prefix of a longer secret leaves the rest in clear

- Where: the registry runs first (`src/redact.js:52-54`). The marker lookaheads at `:26`, `:30` and `:35` then refuse any value that starts with `[redacted]`, so the regex stage skips the remainder.
- Evidence: after `registerSecret('Qz9xWv7L')`, `redact('token=Qz9xWv7Lm2 done')` gives `token=[redacted]m2 done`, and `redact('Authorization: Bearer Qz9xWv7Lm2|tail')` gives `Authorization: Bearer [redacted]m2|tail`.
- Head has no registry, so the leak is new. It needs a registered value that is a strict prefix of the secret.
- Direction for a fix, not tested: the guard must cover the whole marker, not only its first character. A change needs the fuzz rerun.

### N3, Minor: quadratic backtracking on one long run of word characters

- Where: `SECRET_NAME` at `src/redact.js:16` has `[\w.-]*` on both sides of the secret word. It is used by `KEY_VALUE` (`:34-37`) and by `JSON_MEMBER` (`:39`, not measured). `ESCAPED_JSON_MEMBER` (`:42-45`) scans with `\\*` in its lookahead.
- Evidence, fixed code / head:
  - `token` repeated 16,000 times (80,000 characters): 1,577 ms / 1 ms.
  - `token` repeated 32,000 times (160,000 characters): 9,692 ms / 2 ms.
  - `token ` repeated 8,000 times (with spaces): under 1 ms on both.
  - Escaped backslash run of 8,000: 77 ms / 0.2 ms.
- Exposure: it needs tens of kilobytes with no space or punctuation, which ordinary text does not produce. It is still a synchronous stall on a large tool or API payload.
- Direction for a fix, not tested: bound the name length (for example `{0,64}`) and re-time the 160,000-character case.

### N4, Minor: an escaped secret member with no closing delimiter masks to the end of the string

- Where: `src/redact.js:43`, the `|$` alternative in the lookahead.
- Evidence: `redact('{\\"token\\":\\"abc\\" and then ordinary text, more')` gives `{\"token\":\"[redacted]`, which loses the rest of the string. The closed control masks only the value.
- This is a fail-safe trade-off. Dropping `$` would fail open for an unterminated member. It is listed because it is over-masking of ordinary text, which the review was asked to check.

### N5, Minor: a value registered after an IgError is built stays in err.message and err.stack

- Where: redaction happens once, at construction (`src/errors.js:30`), so a later registration does not reach that message.
- Evidence: `new IgError('API_ERROR', 'failed with Yy7Tt5Ww3Q in the body')`, then `registerSecret('Yy7Tt5Ww3Q')`. `err.message` still holds the raw value. `redact(err.message)` masks it.
- Head already redacted at construction, so the late-registration gap comes with the registry.
- Options: redact `message` and `stack` on read, or make registration before use an explicit Task 9 rule.

### Checked, no new breakage

- Fail-open in busyResult and mapGraphError: none found. A negative retry value becomes 0, as ruled. The new string handling in `graphCode` makes stop detection stricter, not looser.
- Overreach on ordinary text: a 42-string corpus was run on head and on the fix (`scratchpad\ord-head.txt` and `scratchpad\ord-fix1.txt`). The only new masking comes from the required `:` separator, the added key names and the any-scheme AUTHORIZATION. Examples: `Next token: none` becomes `Next token: [redacted]`, `tokens: 500 left` becomes `tokens: [redacted] left`, `api_key: rotate monthly` becomes `api_key: [redacted] monthly`. These are over-masking that the required fix implies, and no unrelated text is masked otherwise.
- Idempotence: 0 failures in 50,000 random strings.
- `src/audit.js` is unchanged, and it redacts through `redact()`.

## Out-of-scope observations

- O1. Quote-wrapped values are unmasked, and the cause is pre-existing (head gives the same output). Examples: `access_token="EAAB123456"`, `token: 'EAAB123456'`, `Authorization: "Basic dXNlcjpwYXNz"`, `{access_token: "..."}`. The value class at `src/redact.js:35` excludes quotes, and AUTHORIZATION (`:30`) stops at a quote. These are not in the required list. Needs a ruling: a follow-up in this task, or a Task 9 carry-forward. It would be Important if in scope.
- O2. Other pre-existing text-form gaps, same in head: `access_token%3AEAAB...` (no `%3A` separator); encoded JSON `%22access_token%22%3A%22...`; key names `apikey`, `session_id` and `x-api-key` (only `api_key` was added).
- O3. Numeric JSON values in text are unmasked, and head is the same: `{"access_token": 12345678901}`. `JSON_MEMBER` (`src/redact.js:39`) matches string values only. Object keys with numeric values are masked by the key rule.
- O4. BEARER overreach and escape loss, same in head. `bearer of bad news` gives `Bearer [redacted] bad news` (P8, accepted earlier). The credential class at `src/redact.js:26` does not exclude a backslash, so `{\"Authorization\":\"Bearer EAAB123\"}` loses the escape before the closing quote. The fix gives `{\"Authorization\":\"[redacted]"}`, and head gives `...Bearer [redacted]"}`. The value is masked either way, but the JSON structure is broken.
- O5. Digest, which the project does not use: `Authorization: Digest username="x", response="y"` gives `Authorization: [redacted] [redacted]"x", response="y"`. Only the first token after the scheme is masked, and the response hash stays visible.
- O6. The registry is exact-match. `registerSecret` stores the string as given (no trim), and only the raw and `encodeURIComponent` forms are masked. Task 9 must register the exact token strings.
- O7. Deferred items (S3, S6, S7, P8, P9, A1) were not re-reviewed, as the report says. Noted for the record: S6 `2FA required to continue` gives `API_ERROR`, P9 `Map` contents give `{}`, and A1 throws for a string limit.

## Round verdict

Findings remain open.

- All six listed findings (I-1, I-2, M-1, M-2, M-5, M-7) are addressed, and controller rulings 1 to 6 hold.
- Open: N1, a new Important breakage. A registered value used as an object key passes through `redact()` unmasked. It must be fixed before the round passes.
- N2 to N5 are new Minor issues. They do not block the round, so the controller can fix them now or carry them.
- New issues: 0 Critical, 1 Important, 4 Minor.
