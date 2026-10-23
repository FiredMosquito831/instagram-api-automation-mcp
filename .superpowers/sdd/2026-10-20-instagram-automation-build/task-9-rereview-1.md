# Task 9 re-review, fix round 1

Scope: the four findings under verification (I-1, I-2, the canRefresh input tests, the keyring blank or non-string test) and the three controller rulings for this round. Inputs: task-9-brief.md, task-9-review.md, task-9-report.md (fix round section), review-task-9-fix1.diff, the current src/secrets.js and src/token.js, package.json and package-lock.json. Read-only. No project file was edited, and git was not run. The lockfile was compared with snap/task-9-head/package-lock.json and the current project files with snap/task-9-fix1-head, both with diff. The current project files are identical to the fix1 snapshot. One focused run was made: `node --test test/secrets.test.js test/token.test.js` gave 40 of 40 pass. The full suite was not re-run.

## Finding verdicts

**I-1 (whitespace in secrets): ADDRESSED.**
- Env path: `raw.trim()` at src/secrets.js:88. The blank test runs on the trimmed value at :89, and the trimmed value is both registered and returned at :89. A blank env value still falls through to the keyring, as before.
- Keyring path: blank or non-string is refused at src/secrets.js:102. The trimmed value is registered and returned at :103.
- set: the blank check is at :122-124. The trimmed value is registered at :126 and stored at :135 (`setPassword(secret)`).
- Masking: registerSecret adds the exact string and its encodeURIComponent form (src/redact.js:177-190). maskText splits on each exact registered value (src/redact.js:106-111). So the bare trimmed token is masked wherever it appears, including inside a padded string.
- Tests (test/secrets.test.js):
  - :159 env value with a trailing newline is returned trimmed, and redact masks the bare token.
  - :165 keyring value is returned trimmed, and redact masks the bare token. Note: this test pads with a trailing space, not the newline the ruling named. String.prototype.trim removes both, so the code path is the same. This is a wording gap, not a coverage gap.
  - :172 set stores and registers the trimmed value.
  - :180 an audit line written through the real createAudit does not contain the bare token.
  - The report says these failed in the RED run before the fix (report lines 180-182).

**I-2 (keyring pin): ADDRESSED.**
- package.json:14 is `"@napi-rs/keyring": "2.1.2"`, an exact pin.
- package-lock.json:11 root specifier is `"2.1.2"`. :18 resolves 2.1.2 and :20 keeps the integrity hash.
- The lockfile diff against snap/task-9-head/package-lock.json shows one changed line, :11 (`^2.1.2` to `2.1.2`). node_modules/@napi-rs/keyring/package.json reports 2.1.2.

**canRefresh input tests (fail-closed): ADDRESSED.**
- test/token.test.js:126 covers obtainedAt missing, numeric string, ISO without milliseconds, and NaN. Each case is a separate assert.equal with a message.
- :134 covers now missing, numeric string, and NaN.
- :141 covers expiresAt missing, numeric string, and NaN.
- Code: scopes is checked first (src/token.js:55-57). Then each time is parsed by parseTime (:58-60). A null result returns false (:61) before any comparison. parseTime yields only a safe integer >= 0 or an exact ISO string with milliseconds and Z (:22-29). So no `true` can come from a coerced or missing input.

**Keyring blank or non-string value (fail-closed): ADDRESSED.**
- Code: null is `none` (src/secrets.js:100). A non-string or blank value is `unavailable` (:102). get throws CONFIG for unavailable (:114-118).
- Tests:
  - :199 blank: get throws CONFIG and source is `unavailable`.
  - :205 number: not returned, and the number is not registered (redact leaves the text unchanged).
  - :211 array holding a token: not returned, and the token is not registered.
- A blank value cannot be registered at all (src/redact.js:178 refuses blank values). So for the blank case, not-returned and unavailable is the full requirement.

**Controller rulings:**
1. Accepted and implemented. A blank or non-string keyring entry throws CONFIG (src/secrets.js:102, :114-118). get returns null only for a genuine no-entry (:100).
2. Accepted and implemented. canRefresh returns false for missing, string or NaN times (src/token.js:58-61). A future obtainedAt still throws VALIDATION, through ageMs at src/token.js:42 (reached at :62).
3. Accepted. The exact pin is in package.json:14 and the lockfile is in step (see I-2).

## New breakage in the fix diff

Checked against each failure mode named for this round:
- **A padded value still registered: none.** Every registration in src outside redact.js is one of: the helper at src/secrets.js:41, called with trimmed values at :89, :103 and :126; or src/token.js:82, for a token that already passes `^\S+$` (:18, :78), so it equals its trimmed form. A grep found no other registerSecret callers in src.
- **Trimmed value returned while the padded one is registered: none.**
- **A blank value now returned: none.** Blank env falls through (src/secrets.js:89). Blank keyring is unavailable (:102). Blank set is VALIDATION (:122-124).
- **canRefresh returns true for a missing input: none.** Each time must be non-null (src/token.js:61) before the comparison at :63. A missing scopes list throws (:55-57).
- **Fail-open path: none found.**
- **Minor (not a listed failure mode).** src/token.js:58-61 and parseTime at :22-29 now return false for every form that is not a safe integer >= 0 or an exact ISO string. That includes negative, fractional, Infinity, boolean, object and Date values, which previously threw VALIDATION (the old toEpochMs path). The ruling named only missing, string and NaN. The change is fail-closed, but no test covers these forms. A caller that passes the wrong type gets a silent no-refresh instead of an error. The owner should accept this or narrow it. It does not block the round.
- Not breakage: a padded env or keyring value whose trimmed form is under 8 characters is now refused with CONFIG (src/secrets.js:89 and :103, through register at :41-46). It was accepted, as padded text, before the fix. The new behaviour is correct.

## Out-of-scope observations

- src/token.js:24-27: the ISO string path accepts times before 1970 (negative epoch milliseconds), while the number path at :23 refuses negatives. This is pre-existing and the fix did not change it. It is not a fail-open: an old obtainedAt gives an old token, and a pre-1970 expiresAt gives false.
- Deferred items remain as ruled: M-2, M-3, M-5, M-6 and the Task 17 carry-forwards (M-7, M-9), plus M-8 (name normalisation). M-4's item that no test checks loadKeyring is called at most once is still open. It is not in this round's list.
- The message "the keyring is unavailable" is still shown for a blank or malformed entry (report line 219). The fix did not change it.

## Round verdict

All four findings are ADDRESSED, and the three controller rulings are implemented. No new Critical or Important breakage. One new Minor (the widened canRefresh false, src/token.js:58-61). The round passes.

Counts: new Critical 0, new Important 0, new Minor 1.
