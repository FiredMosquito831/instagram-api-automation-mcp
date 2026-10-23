# Task 9 review: secrets and the token lifecycle

Scope: the net diff review-task-9.diff (task-9-base to task-9-head), package-lock.json read directly, package.json, and the named risk checks: registerSecret and maskText in src/redact.js, the Graph client in src/graph/client.js, IgError in src/errors.js, audit in src/audit.js, and the installed @napi-rs/keyring (index.d.ts, package.json). Read-only. No project file was edited. The full suite was not re-run. One in-process Node check (no file writes) confirmed Important finding I-1.

## Spec compliance

Overall: ❌ (the only failing item is the version pin, I-2). Every behaviour in the brief is met.

- ✅ `createSecrets` signature and return shape: src/secrets.js:55, :111-160 (get, set, remove, source).
- ✅ Env read first, then keyring: src/secrets.js:83-88 (env), :90-101 (keyring). The "env var wins" test asserts the keyring is never constructed.
- ✅ Env name is IG_ plus the upper-cased name with dashes and dots as underscores: src/secrets.js:32-35.
- ✅ Keyring entry is (service, name), service default `instagram-automation`: src/secrets.js:9, :94, :133, :148.
- ✅ `loadKeyring` returning null, throwing, or returning a module with no Entry is unavailable: src/secrets.js:66-78, :91.
- ✅ `get` returns null only for a genuine no-entry: src/secrets.js:98 (none). A keyring read that throws is unavailable and get throws CONFIG: :93-97, :113-115. A non-string or blank keyring value is unavailable: :100. Checked against the installed index.d.ts: `getPassword(): string | null` returns null for no entry (line 150), and `deletePassword(): boolean` throws when a delete fails (line 189).
- ✅ `set` throws CONFIG with no keyring: src/secrets.js:125-131. A failed write is CONFIG without the value: :132-136.
- ✅ Every loaded or stored secret is passed to registerSecret at load time: src/secrets.js:87 (env), :101 (keyring), :124 (set). The refreshed token is registered on receipt: src/token.js:72-76. ⚠️ The whitespace case is a registration gap, see I-1.
- ✅ `tokenAgeHours`: src/token.js:40-42, with validation at :22-37.
- ✅ `canRefresh`: at least 24 hours, inclusive (src/token.js:54, `age >= MIN_REFRESH_AGE_MS`). Expiry is exact, expired at expiresAt (:53). Requires instagram_business_basic (:54). Missing or non-number inputs throw VALIDATION (:23-28, :50-52), so no `true` is returned. ⚠️ Design note: missing input throws rather than returning false, see M-1.
- ✅ `refreshToken`: GET `refresh_access_token` with only `grant_type=ig_refresh_token` (src/token.js:64). The token goes only in the Authorization header (src/graph/client.js:190). The client refuses an `access_token` field in a query or form (src/graph/client.js:57-58). Returns `{ token, expiresInSeconds }` (src/token.js:81).
- ⚠️ The 60-day expiry for the stored token is the caller's job (brief; plan line 287; src/token.js:57-59). Task 9 correctly leaves it out, but no ledger entry names the task that must do it, see M-7.
- ✅ `scheduleTokenChecks`: default interval 3600000 (src/token.js:14, :88). Intervals above 2147483647 are refused, not clamped (:93-95). Returns a stop function that clears the timer once (:102-107).
- ✅ No token is written to a file: neither src/secrets.js (imports at :5-7) nor src/token.js (imports at :5-6) imports fs. The test "tokens are never written to a file" exists and scans the files after the calls.
- ✅ All nine brief tests have counterparts in test/secrets.test.js (15 tests) and test/token.test.js (15 tests). Every `createSecrets` call in the tests injects `loadKeyring`, so no OS credential store is touched.
- ✅ `@napi-rs/keyring` is in `dependencies`: package.json:13-15.
- ❌ The version is not pinned in package.json: package.json:14 is `"^2.1.2"`, a range. Spec Decision D says "Versions are pinned" (docs/superpowers/specs/2026-10-20-instagram-cli-design.md:65). The lockfile pins 2.1.2 with an integrity hash (package-lock.json:17-20), which mitigates this. See I-2.
- ✅ Lockfile: the only additions are the keyring and its optional platform packages. The root entry lists the keyring (package-lock.json:7-16), the keyring entry (:17-43), and 11 optional platform packages (:44-250). The report says the project had no lockfile before, so nothing else is in it. The lockfile lists 12 platform packages although npm reported installing 2; npm records optional dependencies for every platform, which is normal.
- ✅ The report's `npm view ... scripts` list matches the installed package's scripts (node_modules/@napi-rs/keyring/package.json:47-61: 13 entries). There is no preinstall, install or postinstall. This verifies the installed copy. The npm view call itself was not re-run.
- ⚠️ Cannot be verified from the diff: the `--ignore-scripts` install command, the npm view version and publication date, the RED and GREEN counts and mutation results, the 345/345 suite result (not re-run, as instructed), and the real Windows credential store (the live phase). The Node 22.12 run has not been done (ledger carry-forward to Task 18).

## Strengths

- Env-first lookup. The keyring is read only when no env value is set, and the loader is injected and cached once per instance (src/secrets.js:62-78, :81-102).
- Keyring failures fail closed. A throw, a missing Entry, or a non-string or blank value becomes unavailable, and get, set and remove throw CONFIG (src/secrets.js:91-102, :113-115, :127-129, :132-136, :148-152).
- Error messages name the variable or the secret, never its value (src/secrets.js:105-108, :127-129, :135, :150).
- Times must round-trip through toISOString, so an impossible date such as 2026-09-31 is refused rather than moved (src/token.js:22-29). Expiry is exact (:53).
- The refresh token is registered before it is returned (src/token.js:72-76). A too-short token and a bad expires_in are API_ERROR (:69-71, :77-80).
- Two tests run the real Graph client over a fake fetch: the Bearer-header test, and the test that a registered token does not appear in an error message (test/token.test.js). The redaction path is exercised end to end.
- The timer ceiling is refused rather than clamped, and the stop function is idempotent (src/token.js:93-107).
- The diff touches only the files the brief names. src/redact.js, errors.js, audit.js and src/graph/** are unchanged.

## Issues

### Critical

None.

### Important

**I-1. Untrimmed secret values are registered and returned, so the trimmed token is not masked.**
- Where: src/secrets.js:87 (env), :101 (keyring), :120-124 and :133 (set checks the trimmed value but registers and stores the raw one). src/redact.js:177-191 (registerSecret adds only the exact string and its encodeURIComponent form) and :106-111 (masking is exact match).
- What is wrong: a value such as `IGAAB...` with a trailing newline or space, for example a token pasted into a prompt, is registered with the padding. The trimmed token is not registered. I checked this in-process without writing files. With `IG_OWNER_TOKEN` set to the token plus a newline, `get()` returns the padded value. `redact()` of a text containing the bare token leaves the token unmasked. The Graph client refuses whitespace tokens (src/graph/client.js:153-154), which limits the reach for owner_token, but app_secret, webhook_verify_token and api_token have no such check. The ledger's rule (Task 2 round 2, ledger line 110; breaker, line 141) is that the registry must hold the exact token strings that can appear in output.
- Fix: trim before registering and returning. In `resolve()`, use `const value = raw.trim()` after the blank check, then register and return `value`. Do the same in `set()`. Alternatively, refuse values that contain whitespace, as token.js does at line 69. Add a test: a value with a trailing newline, then assert that the bare trimmed value is masked by `redact()` and in an audit line.

**I-2. The keyring version is a caret range, not a pin.**
- Where: package.json:14 `"@napi-rs/keyring": "^2.1.2"`.
- What is wrong: spec Decision D says "Versions are pinned" (spec line 65). A caret lets a later `npm install` take any 2.x release. The lockfile holds 2.1.2 today (package-lock.json:17-20), so the risk is low, but the package.json does not record the pin.
- Fix: set `"@napi-rs/keyring": "2.1.2"`, or run `npm install --save-exact --ignore-scripts @napi-rs/keyring@2.1.2`, and keep the lockfile in step.

### Minor

**M-1. canRefresh and tokenAgeHours throw VALIDATION on missing or non-number input rather than returning false.**
- Where: src/token.js:23-28, :32-37, :47-52.
- The result is fail-closed, because no `true` is returned. But a caller that does not catch the throw will crash its check. Task 17's check must catch it (see M-6). Keep as is, or document it at token.js:44-46.

**M-2. refreshToken destructures the client result without a guard.**
- Where: src/token.js:64. A client that returns undefined gives a TypeError, not an IgError. The real client always returns an object, so this matters only for stubs.
- Fix: `const result = await client.get(...); const data = result?.data;`

**M-3. refreshToken does not check which login product the client uses.**
- Where: src/token.js:60-64. The client does not expose `loginProduct` (src/graph/client.js:213-234). A Facebook-product client would send refresh_access_token to graph.facebook.com. This does not leak the token, since it stays on a Meta origin, but the refresh would fail.
- Fix: expose `loginProduct` on the client and check it in refreshToken, or state the requirement in the comment at token.js:57-59.

**M-4. Test gaps.**
- No test shows that canRefresh refuses a missing or non-number `obtainedAt`, `now` or `expiresAt`. The canRefresh tests cover only the scopes-as-string case (test/token.test.js, "canRefresh requires instagram_business_basic").
- No test for a keyring value that is blank or not a string (src/secrets.js:100).
- No test that `loadKeyring` is called at most once (src/secrets.js:62-78).
- No test for whitespace in an env or keyring value (ties to I-1).

**M-5. The file scan covers a temp directory, not the data directory.**
- Where: test/token.test.js, "tokens are never written to a file". It uses `mkdtempSync(tmpdir())` and scans only the audit file's directory. The brief says "under the data directory". This is acceptable at unit level. The state and events files should be included in the end-to-end check at Task 18.

**M-6. scheduleTokenChecks does not catch a throw or a rejection from check.**
- Where: src/token.js:99-101. A synchronous throw in the interval callback stops the process, which is loud. A rejected promise is an unhandled rejection. The report notes this, and ledger line 221 carries it to Task 17.
- Fix in Task 17: wrap the check body in try/catch and log through redact.

**M-7. The 60-day expiry for the stored refreshed token has no owner in the ledger.**
- Where: brief and plan line 287, and the comment at src/token.js:57-59. No ledger entry names Task 13 or Task 17 for it.
- Fix: record a carry-forward so that the caller stores the refreshed token with an expiry 60 days out, as the brief states.

**M-8. The env name and the keyring account are normalised differently.**
- Where: src/secrets.js:34 normalises the env name. src/secrets.js:94, :133 and :148 use the raw name as the keyring account. So `get('api-token')` and `get('api_token')` share an env variable but read different keyring accounts. This matches the brief's wording. Note only.

**M-9. The ledger names the wrong owner for exchange-response registration.**
- Where: ledger line 110 and the breaker carry-forward (line 141) name Tasks 9 and 17 for exchange responses. The Task 9 ruling (line 221) names Tasks 15 and 17. The plan places `auth login`, which does the exchange, only in Task 17 (plan line 498).
- Fix: record in the ledger that Task 17 alone owns registration of exchange responses. Task 9 cannot do it, because it has no exchange function.

## Assessment

Task quality: **Needs fixes.** The module meets the brief and its tests cover the required behaviour, but a whitespace-padded secret is registered in a form that leaves its trimmed token unmasked (I-1), and the keyring version is a range where the spec requires a pin (I-2). Both are one-line fixes plus a test.

Spec verdict: ❌ (I-2 is the only failing item).

Counts: Critical 0, Important 2, Minor 9.

Review path: D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\task-9-review.md
