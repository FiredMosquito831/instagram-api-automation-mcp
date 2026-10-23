# Task 2 review: errors, redaction, audit and the busy result

**Scope.** Reviewed against the task brief, the global constraints, the ledger (R2, R3, R9 and the Task 2 entries), the implementer's report, and `D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\review-task-2.diff`. Line numbers are those of the new files, which match the diff. Behaviour was checked with two read-only probes in the scratchpad: `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task2-probe.mjs` (probes P, S, B, A) and `...\scratchpad\task2-probe2.mjs` (probes D). Nothing in the project was edited, and the test suite was not re-run.

## Spec compliance

**Brief deliverables**

- ✅ Five files created and nothing else changed. The lockfile and package.json are unchanged (diff header and file list).
- ✅ ERROR_KINDS lists the fifteen kinds in brief order and is frozen: `D:\Projects2\InstagramApi\src\errors.js:6-22`.
- ✅ IgError extends Error, with `kind` validated against ERROR_KINDS and `details`: `D:\Projects2\InstagramApi\src\errors.js:27-36`.
- ✅ mapGraphError. Code 190 gives AUTH_EXPIRED (`errors.js:63`). Codes 4, 17, 32, 613, 80002 and status 429 give RATE_LIMITED (`errors.js:39`, `:64`). Code 368 gives ACTION_BLOCKED (`errors.js:65`). The fallback is API_ERROR (`errors.js:67`). The message is `body.error.message`, redacted (`errors.js:61`, `:68`, `:31`).
- ✅ Text matching for "feedback required" and "checkpoint, challenge, two-factor" (`D:\Projects2\InstagramApi\src\errors.js:41-42`, `:65-66`). This goes beyond the brief's literal "anything else gives API_ERROR", but the Global Constraints name both conditions as stops. See concern (a).
- ✅ busyResult returns `{ busy: true, reason, retryAfterMs }` (`D:\Projects2\InstagramApi\src\errors.js:84`). ⚠️ Its input checks throw (`errors.js:78-83`), which conflicts with busy being a result. See I-1.
- ✅ redact returns a deep copy (`D:\Projects2\InstagramApi\src\redact.js:61-62`). The key rule is the brief's regex verbatim (`redact.js:6`) and applies to object keys (`redact.js:52`). `access_token=` and `Bearer` are masked (`redact.js:8`, `:11`, `:18-19`).
- ✅ createAudit. `record` writes one redacted line with the six fields and creates the folder (`D:\Projects2\InstagramApi\src\audit.js:19-28`). `read({ limit })` returns the last N entries, oldest first (`audit.js:32-46`).
- ✅ All seven brief tests are present: `D:\Projects2\InstagramApi\test\errors.test.js:28, :35, :47, :54, :110, :125` and `D:\Projects2\InstagramApi\test\audit.test.js:17`.
- ⚠️ The RED and GREEN runs and the 49-test result come from the report only.

**Binding global constraints**

- ✅ Stop codes. Each listed code maps as above. Precedence is AUTH_EXPIRED, then RATE_LIMITED, then ACTION_BLOCKED, then CHECKPOINT (`D:\Projects2\InstagramApi\src\errors.js:63-67`). Text can only add a stop kind where the code path would give API_ERROR.
- ❌ Secrets. "Tokens never reach a file, a log, or a tool result" and "Secrets never appear in logs, audit lines, errors, or tool output." A token value with no key name and no Bearer prefix passes through. Probe P6: the error message `token <value> is invalid` keeps the value, and `D:\Projects2\InstagramApi\src\errors.js:68` carries it into the IgError message (`errors.js:31` redacts only the patterns). Probe P3: the audit detail `token <value>` is written unmasked (`D:\Projects2\InstagramApi\src\audit.js:19-26`). See I-2.
- ✅ The named secret keys are masked as keys: owner_token, facebook_token, api_token, app_secret and webhook_verify_token (`D:\Projects2\InstagramApi\src\redact.js:6`, `:52`). The names come from `D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\progress.md` line 58.
- ✅ IgError details hold status, code and subcode only (`D:\Projects2\InstagramApi\src\errors.js:69-73`).
- ✅ Node built-ins only. The tests make no network call (`D:\Projects2\InstagramApi\test\audit.test.js`, `...\test\errors.test.js`). No commit.
- ⚠️ Whether Graph puts the stop phrases in `error.message` cannot be verified from the diff. See M-4.

**Spec verdict: ❌.** Every brief deliverable is met. The binding secrets rule is not met for token values that appear without a key name (I-2).

## Strengths

- ERROR_KINDS matches the brief exactly, in order, and is frozen (`D:\Projects2\InstagramApi\src\errors.js:6-22`).
- Stop precedence is explicit and fail-closed. Text matching can only add stop kinds and never downgrades a code-based stop (`D:\Projects2\InstagramApi\src\errors.js:63-67`).
- Code 80002 counts as RATE_LIMITED whatever its subcode, as the constraints require (`D:\Projects2\InstagramApi\src\errors.js:39`, `:64`).
- Error details are limited to status, code and subcode (`D:\Projects2\InstagramApi\src\errors.js:69-73`), so the error object carries no secret.
- redact copies deeply, handles cycles, binary data, Dates and Errors, and keeps `__proto__` as data (`D:\Projects2\InstagramApi\src\redact.js:28-29`, `:38-40`, `:42-58`).
- Redaction runs on every audit write and read, and on every IgError (`D:\Projects2\InstagramApi\src\audit.js:19-26`, `:46`; `D:\Projects2\InstagramApi\src\errors.js:31`, `:34`).
- The audit tolerates a truncated last line and creates its folder (`D:\Projects2\InstagramApi\src\audit.js:27`, `:40-43`).
- The tests cover the seven brief bullets. The audit tests use a fixed clock. The report's mutation run (14 mutants, all caught) is ⚠️ unverified here.
- The implementer reported concerns (a) to (d) openly, with reasons, which made this review direct.

## Issues

### Critical

None.

### Important

**I-1. busyResult throws on a normal wait value.** `D:\Projects2\InstagramApi\src\errors.js:81-83`. The test that enshrines the throw is `D:\Projects2\InstagramApi\test\errors.test.js:121`.
- Problem: busy is a result, not an error (constraints: "Busy, not queued"; HTTP 429 on the API). Probe B1: `busyResult({ reason: 'spacing', retryAfterMs: 1500.5 })` throws TypeError. A caller that derives the wait from a fractional clock turns a cap hit into an exception, and the HTTP route returns an error instead of 429.
- Fix: accept any finite number and return `Math.max(0, Math.ceil(retryAfterMs))`. Keep throwing for NaN, undefined and non-numbers. Change the 1.5 case at `errors.test.js:121` to expect rounding up to 2.

**I-2. Redaction leaves bare and text-form token values unmasked.** Patterns: `D:\Projects2\InstagramApi\src\redact.js:8-13`. Output paths: `D:\Projects2\InstagramApi\src\errors.js:31`, `:68`, and `D:\Projects2\InstagramApi\src\audit.js:19-26`.
- Probe results (`<v>` is the secret; in each probe the value survived):
  - P6: `token <v> is invalid` as an error message. The IgError message keeps the value, and a tool would return it.
  - P2: `owner token: <v>` (colon form). P3: `token <v>` (space form). P3 is the same path an audit detail takes.
  - P4: `?access_token%3D<v>` (percent-encoded `=`).
  - P5: `Authorization: Basic <v>`. The implementer noted this one.
  - P1: a string holding escaped JSON, `{\"access_token\":\"<v>\"}`. JSON_MEMBER (`redact.js:13`) expects unescaped quotes.
  - P7 is the control and is masked: `access_token=<v>`.
- Impact: with its scopes, the owner's Graph token lets anyone act as the owner account. The app secret allows forging webhook signatures and exchanging codes. The api_token authorises the local HTTP tool API. A bare value reaches the audit file and any tool result that carries the message.
- Why Important: the constraints state the outcome and require every output path to pass through redact. The brief specifies pattern-only redaction, so the patterns cannot guarantee the outcome. The implementer raised this as concern (c) and deferred it to Task 9. Caller discipline is not enough for an absolute rule.
- Fix (small; do it before Task 9 loads any secret): add an exact-value registry to `redact.js`, for example `registerSecret(value)`. It throws for values under 8 characters. Before the patterns run, it replaces each registered value, and its `encodeURIComponent` form, with `[redacted]`, using split and join rather than a RegExp built from the value. Task 9 registers every secret it loads from the environment or the keyring. Also allow `:` and `%3D` as separators in KEY_VALUE (`redact.js:11`), and allow backslash-escaped quotes in JSON_MEMBER (`redact.js:13`). Do not add `code` to the key rule: it would mask Graph's `error.code` in details, and `D:\Projects2\InstagramApi\test\errors.test.js:91` would fail. Consider `api_key` and `passwd`, which the key rule does not match.
- If the controller rules that bare values are out of scope, record it as a Task 9 requirement rather than a note.

### Minor

**M-1. Redaction is not idempotent.** `D:\Projects2\InstagramApi\src\redact.js:8` and `:11`.
- Probe D1: `redact(redact('x access_token=abc&y=1'))` gives `x access_token=[redacted]]&y=1`. Probe D2 gives `Authorization: Bearer [redacted]]`. Probe D4, the audit round trip (record, then read), returns `[redacted]]`. Probe D3 shows the same for an IgError message. No secret is exposed, but the output is corrupted on a normal path, because `audit.read` redacts again by design.
- Cause: the value classes stop at `]`, so the captured value is `[redacted` and the trailing `]` stays behind.
- Fix: add `(?!\[redacted\])` before the value in KEY_VALUE and before the token in BEARER. Add a test that `redact(redact(x))` equals `redact(x)`. Make this change together with I-2.

**M-2. Code and status coercion fails open for common forms.** `D:\Projects2\InstagramApi\src\errors.js:45-48` and `:64`.
- Probe S1: code `' 190'` (with a space) gives API_ERROR. Probe S2: `status: '429'` gives API_ERROR.
- Fix: trim strings before the digit test, and coerce status the same way.

**M-3. A string body is ignored.** `D:\Projects2\InstagramApi\src\errors.js:51-54` and `:58`.
- Probe S3: `body: '{"error":{"code":190,...}}'` gives API_ERROR, so code 190, and any stop text in a non-object body, is missed. The brief's contract is a parsed body, so this is a Task 5 question.
- Fix: JSON.parse a string body. If it is still not an object, run FEEDBACK_REQUIRED and CHECKPOINT_TEXT over the raw text. Settle it before Task 5 passes bodies.

**M-4. Stop text is read only from `error.message`.** `D:\Projects2\InstagramApi\src\errors.js:61`.
- Probe S7: the phrase in `error_user_msg` gives API_ERROR. ⚠️ The diff cannot show where Graph carries these phrases.
- Fix: test the phrases against the other string fields of the error object as well.

**M-5. Phrase coverage has gaps.** `D:\Projects2\InstagramApi\src\errors.js:41-42`. The tests at `D:\Projects2\InstagramApi\test\errors.test.js:63-72` cover only "Feedback required." and "Checkpoint required.".
- Probe S6: `2FA required` gives API_ERROR. The challenge and two-factor alternatives have no test.
- Fix: add a test for each alternative. Add `2fa` once Graph's wording is known (⚠️).

**M-6. The CHECKPOINT substring match is broad by design.** `D:\Projects2\InstagramApi\src\errors.js:42`.
- Probe S4: `Your challenge response was rejected` gives CHECKPOINT, which persists a stop until `ig_stop_clear`. Keep the substring match. Probe S5 shows `challenge_required` matches, and a word boundary would miss it, because `_` is a word character. Document the false-positive cost for the owner. No code change.

**M-7. IgError argument handling.** `D:\Projects2\InstagramApi\src\errors.js:30` and `:34`.
- Probe B2: a non-string message throws TypeError, which inside an error path replaces the original error. Probe B3: `details: null` is stored as null, so `err.details.status` throws.
- Fix: coerce the message (`String(message ?? kind)`) and default details with `details ?? {}`. Keep the kind check (`errors.js:29`).

**M-8. Map and Set contents are dropped silently.** `D:\Projects2\InstagramApi\src\redact.js:51`.
- Probe P9: `redact(new Map([['access_token', ...]]))` gives `{}`. No leak, but the copy loses data without a signal.
- Fix: copy Map and Set explicitly, or document them as unsupported.

**M-9. The audit read keeps non-object JSON lines.** `D:\Projects2\InstagramApi\src\audit.js:41`. A line such as `5` or `null` is returned as an entry. Fix: keep only plain objects.

**M-10. The audit path is not resolved.** `D:\Projects2\InstagramApi\src\audit.js:27-28`. A relative `file` resolves against the working directory on each write. This is ledger carry-forward C2 (`D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\progress.md` line 92). The caller must pass an absolute path under the project root.

**M-11. Audit read loads the whole file.** `D:\Projects2\InstagramApi\src\audit.js:38`. Each read loads and splits the entire file, and nothing bounds its size. At the 200-a-day cap that is about 73,000 lines a year. Acceptable for now. Task 18 should set an audit retention rule, because the constraints give none for the audit file.

**M-12. A string limit throws TypeError.** `D:\Projects2\InstagramApi\src\audit.js:33-35`. Probe A1. The HTTP and MCP layers (Tasks 14 and 15) must validate `limit` and return VALIDATION. Otherwise a caller gets a 500.

Notes, no action. BEARER also rewrites ordinary prose: `bearer token missing` becomes `Bearer [redacted] missing` (probe P8). This errs toward masking and is acceptable. The redaction tests sit in `errors.test.js` because the brief lists only two test files, which is also acceptable.

## Assessment

**Implementer concerns**

- (a) Text matching that stops outbound actions. Fail-closed by construction: text can only add a stop kind where a code path would give API_ERROR, and it never downgrades a code-based stop. The named phrases match with their separators and underscore forms (S5). The match is broad by design (S4), and the cost is a persisted stop that the owner clears. Keep it and document it. The gaps (S3, S6, S7) depend on Graph's error shape, which the diff cannot show (⚠️). The regexes have no nested quantifiers, so there is no catastrophic backtracking by inspection.
- (b) Numeric coercion. Sound. The anchored digit test and exact set membership cannot turn one code into another. The only gap is that whitespace and string status fall through to API_ERROR (M-2).
- (c) Pattern-based redaction. The named keys are covered as keys, and as key=value or JSON members in strings. A bare token leaks: P6 reaches an error message and P3 reaches the audit file. This is not sound against the constraint (I-2). It is also not idempotent (M-1).
- (d) TypeError behaviour. Sound for programmer errors: unknown kind, missing action, wrong limit type, non-function clock. Not sound for busyResult (I-1), where a normal limit becomes an exception, or for error construction (M-7). Consumers must validate `limit` (M-12).

**Task quality: Needs fixes.** busyResult throws on a normal, clock-derived wait (I-1), and redact leaves bare and text-form token values unmasked, which breaks the binding secrets rule (I-2). Both fixes are small, and M-1 falls out of the same regex change.

**Counts:** Critical 0, Important 2, Minor 12.
