# Task 9 report: secrets and the token lifecycle

Status: DONE_WITH_CONCERNS (concerns listed at the end).

## Files

New:
- `D:\Projects2\InstagramApi\src\secrets.js`
- `D:\Projects2\InstagramApi\src\token.js`
- `D:\Projects2\InstagramApi\test\secrets.test.js` (15 tests)
- `D:\Projects2\InstagramApi\test\token.test.js` (15 tests)

Changed:
- `D:\Projects2\InstagramApi\package.json`: added `"dependencies": { "@napi-rs/keyring": "^2.1.2" }`. The `test` script is unchanged (`node --test test/*.test.js`).
- `D:\Projects2\InstagramApi\package-lock.json`: created by `npm install` (the project had no lockfile).
- `node_modules/` is populated (not part of the snapshot scope).

Checked against `snap/task-9-base` with `diff -rq`: no other file changed. `src/redact.js`, `src/audit.js`, `src/errors.js`, `src/state.js`, `src/events.js`, `src/caps.js`, `src/guard.js` and `src/graph/**` are byte-identical to the base.

## Keyring install (R3)

- `npm view @napi-rs/keyring version` gave `2.1.2`.
- `npm view @napi-rs/keyring scripts` gave:
  ```
  { lint: 'oxlint', test: 'ava -s', build: 'napi build --platform --release',
    format: 'run-p format:prettier format:rs format:toml', version: 'napi version',
    licenses: 'node scripts/third-party-licenses.mjs', artifacts: 'napi artifacts',
    'format:rs': 'cargo fmt', preversion: 'napi build --platform && git add .',
    'build:debug': 'napi build --platform', 'format:toml': 'taplo format',
    prepublishOnly: 'napi prepublish -t npm', 'format:prettier': 'prettier . -w' }
  ```
  There is no `preinstall`, `install` or `postinstall` entry. The listed scripts are maintainer scripts (build, lint, publish and version hooks). `--ignore-scripts` therefore skips nothing that install needs.
- Installed with `npm install --ignore-scripts @napi-rs/keyring@2.1.2`: added 2 packages (`@napi-rs/keyring` and its optional Windows binary `@napi-rs/keyring-win32-x64-msvc`), 0 vulnerabilities.
- Publication time of 2.1.2: 2026-10-19T08:30:36.710Z.
- Load check, with no credential access: `defaultLoadKeyring()` returned the module, and `Entry` is a function. No `Entry` was constructed.

## API source

- Context7: `resolve-library-id` was called for "@napi-rs/keyring" and then "napi-rs keyring node". Neither gave the npm binding's JavaScript API. The matches were the Rust crate docs (`/websites/rs_keyring_keyring`, `/open-source-cooperative/keyring-rs`), the generic napi-rs docs and `/napi-rs/node-rs`. A `query-docs` call on `/websites/rs_keyring_keyring` matched nothing.
- Fallback, as the brief allows: the package's own `README.md` and `index.d.ts` (version 2.1.2, in `node_modules/@napi-rs/keyring`).
- API used: `new Entry(service, account)`; `getPassword()` returns `string | null` (synchronous); `setPassword(value)` writes; `deletePassword()` returns `true` when deleted, `false` when absent, and throws when the delete fails.

## TDD evidence

RED: the placeholder modules `src/secrets.js` and `src/token.js` threw "not implemented" and the two new test files ran:
```
node --test test/secrets.test.js test/token.test.js
ℹ tests 30
ℹ pass 1
ℹ fail 29
```
The one pass is "the Graph client refuses the token in a refresh query". It confirms behaviour the Task 5 client already has, so it is expected to pass. The failing tests:
```
✖ env var wins over keyring for the same name
✖ keyring is used when the env var is absent
✖ a blank env var is ignored and the keyring is used
✖ set throws CONFIG when no keyring is available
✖ remove throws CONFIG when no keyring is available
✖ a keyring that is missing or throws on load is reported as unavailable
✖ get returns null only when the keyring has no entry
✖ a keyring read that throws is unavailable, not no entry
✖ names map to IG_ variables with dashes and dots as underscores
✖ a loaded env secret is registered, so redact masks it everywhere
✖ a loaded keyring secret is registered, so redact masks it everywhere
✖ a secret too short to register is refused, and its value is not echoed
✖ set stores the value in the keyring and registers it
✖ a keyring write that throws is CONFIG and does not echo the value
✖ remove deletes the keyring entry and reports whether it existed
✖ tokenAgeHours counts the hours from obtainedAt to now
✖ tokenAgeHours refuses a time after now, an impossible date and a time without milliseconds
✖ canRefresh is false below 24 hours and true at 24 hours
✖ canRefresh is false once the token has expired
✖ canRefresh requires instagram_business_basic
✖ refreshToken requests grant_type ig_refresh_token
✖ refresh sends the token only in the Bearer header, never in the query
✖ refreshToken refuses a response with no usable token or expiry
✖ a token from a refresh response is registered on receipt, so an audit line masks it
✖ a registered token never appears in an audit line
✖ a registered token never appears in an error message
✖ scheduleTokenChecks uses an interval under 2147483647 ms
✖ scheduleTokenChecks refuses an interval over the timer limit, and accepts the limit itself
✖ tokens are never written to a file
```
Each failure is the placeholder's "not implemented" error or the assertion that follows it. Raw output: `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task9-red.txt`.

GREEN: after the implementation, the two files gave `ℹ tests 30, ℹ pass 30, ℹ fail 0`, with all 30 `✔` lines. Raw output: `...\scratchpad\task9-green1.txt`.

Full suite, `npm test` (run after the last edit): `ℹ tests 345, ℹ pass 345, ℹ fail 0`, exit 0. The ledger's total at the end of Task 8 was 315, so the 30 new tests account for the difference. Raw output: `...\scratchpad\task9-npmtest-final.txt`.

Mutation checks, on a scratch copy outside the project (each mutation makes the tests fail):
- M1: `refreshToken` does not register the token: 3 failures, including "a token from a refresh response is registered on receipt".
- M2: env values are not registered: 5 failures, including "a loaded env secret is registered".
- M3: expiry tested with `>` instead of `>=`: "canRefresh is false once the token has expired" fails.
- M4: an over-limit interval is clamped instead of refused: "scheduleTokenChecks refuses an interval over the timer limit" fails.
- M5: the env variable is not read: "env var wins over keyring" and the registration tests fail.

## Behaviour

`src/secrets.js`:
- `createSecrets({ env = process.env, loadKeyring = defaultLoadKeyring, service = 'instagram-automation' })` returns `get`, `set`, `remove` and `source`.
- The environment variable is `IG_` plus the name, upper-cased, with `-` and `.` changed to `_`. A name must start with a letter and hold only letters, digits, `_`, `.` or `-`, up to 64 characters. Otherwise it is VALIDATION.
- A blank env variable counts as absent, as `config.js` treats it. A non-string value is refused with CONFIG.
- The keyring is read only when no env value is set. `loadKeyring` is called at most once per instance. A loader that throws, or a module without an `Entry` class, is unavailable.
- `source(name)` returns `env`, `keyring`, `none` (no entry) or `unavailable`.
- `get` returns null only for `none`. For `unavailable` it throws CONFIG. A value that is not a non-blank string is treated as unavailable.
- Every value loaded or stored is registered with `registerSecret` before it is returned or written. A value too short to register (under 8 characters) gives CONFIG, and the message does not include the value.
- `set` throws CONFIG when no keyring is available, and CONFIG when the write fails, without echoing the value.
- `remove` returns `true` or `false`. It throws CONFIG when there is no keyring or the delete fails.
- `defaultLoadKeyring` uses `createRequire` and returns null on any failure, so importing the module never loads the native binding.

`src/token.js`:
- Times are epoch milliseconds (safe integers, not negative) or the exact `toISOString()` text with milliseconds and a `Z`. Anything else is VALIDATION. A string is round-trip checked, so `2026-09-31` is refused and not moved to October.
- `tokenAgeHours({ obtainedAt, now })` returns hours as a number. A time after `now` is VALIDATION.
- `canRefresh({ obtainedAt, expiresAt, now, scopes })` is true only when the age is at least 24 hours (exactly 24 hours is true), `now` is before `expiresAt` (at `expiresAt` the token counts as expired), and `scopes` includes `instagram_business_basic`. A `scopes` value that is not an array of strings is VALIDATION.
- `refreshToken({ client })` calls `client.get('refresh_access_token', { grant_type: 'ig_refresh_token' })`. The token goes only in the Bearer header, which the client adds. The new token is registered before it is returned. It returns `{ token, expiresInSeconds }`. A response with no usable token, a token that is too short to register, or an `expires_in` that is not a positive integer is API_ERROR.
- `scheduleTokenChecks({ check, intervalMs = 3600000, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval })` returns a stop function, which clears the timer once. An interval that is not a whole number from 1 to 2147483647 is VALIDATION. It is refused, not clamped.

## Carry-forward compliance

- Register every loaded secret at load time: `resolve()` calls `register()` on the env and keyring paths. Tested by "a loaded env secret is registered" and "a loaded keyring secret is registered".
- Register every token on receipt: `refreshToken` registers the new token. Tested by "a token from a refresh response is registered on receipt", which uses an audit line whose key is not secret-named, so only registration can mask the value.
- A registered token never appears in an audit line or an error message: tested by "a registered token never appears in an audit line" and "a registered token never appears in an error message". The error test runs the real Graph client against a fake fetch, which returns a 400 with the token in its message.
- The refresh sends the token only in the Bearer header: "refresh sends the token only in the Bearer header, never in the query" checks the URL (path, `grant_type`, no `access_token` parameter, no token text), and the Authorization header. "the Graph client refuses the token in a refresh query" checks that the client refuses an `access_token` query field.
- Tokens are never written to a file: "tokens are never written to a file" records audit lines that carry the tokens with ordinary keys, then scans every file under the data directory. The scan is not empty, because the audit file exists.
- Timers: no single timer is longer than 2147483647 ms. The default is 3600000.
- No test makes a network call and none touches the OS credential store. The keyring is injected in every test. The only real-module interaction is the load check above.

## Self-review

I read `src/secrets.js`, `src/token.js` and both test files in full, and checked the diff against the base snapshot.

- Fixed: a comment in `secrets.js` said the loader runs only when an env var is absent. `set` and `remove` also load it, so the comment now says it runs on the first keyring use.
- Left as is, deliberately:
  - `canRefresh` parses `now` twice (once in `ageMs` and once in its own check). The cost is negligible, and the code is clearer this way.
  - `scheduleTokenChecks` does not catch an error from `check`. The header comment says `check` must handle its own failures. A rejected promise from `check` would be an unhandled rejection.
  - A failed keyring load is remembered for the life of the instance. The native binding does not recover within a process, so retrying would only add noise.
- Exports: `DEFAULT_SERVICE`, `envName`, `defaultLoadKeyring`, `MAX_TIMER_MS` and `DEFAULT_CHECK_INTERVAL_MS`. `envName` may be useful to Tasks 13 and 17 when they name the variable in messages.
- Callers in Tasks 13 and 17 must store `obtainedAt` and `expiresAt` in one of the two accepted forms (epoch milliseconds, or `toISOString()` text).

## Concerns

1. Node 22 was not run. This machine has Node v24.6.0, and the engines field is `>=22.12.0`. This is the Task 18 carry-forward from the ledger.
2. The real Windows credential store was not exercised, by design. Only the load check touched the module. A live `set`/`get`/`remove` round trip belongs to the live phase.
3. Context7 has no entry for this binding, so the API comes from the package's README and `index.d.ts`. The version was published on 2026-10-19, two days before this report, so the owner may want to confirm it before release.
4. The auth exchange (Tasks 15 and 17) must register its token on receipt. This task covers only the refresh response.
5. `scheduleTokenChecks` does not catch errors from `check`. Task 13 and Task 17 callers must handle their own failures.

## Fix round 1 (review: task-9-review.md)

The `"@napi-rs/keyring": "^2.1.2"` text in the Files section above is superseded by the pin below.

### What changed

1. **I-1, whitespace in secrets (src/secrets.js).** `resolve()` now trims an env value after the blank check and registers and returns the trimmed value. The keyring path registers and returns `value.trim()`. `set()` registers and stores `value.trim()`. A blank value is still treated as missing on the env path (the variable is absent), and a blank keyring value is still unavailable.
2. **I-2, pin (package.json and package-lock.json).** Command: `npm install --save-exact --ignore-scripts @napi-rs/keyring@2.1.2`. Output: `up to date, audited 3 packages in 6s`, `found 0 vulnerabilities`. `package.json` now holds `"@napi-rs/keyring": "2.1.2"`. In the lockfile, only the root entry's specifier changed (from `^2.1.2` to `2.1.2`); the diff against a copy taken before the pin is that one line. The resolved version is still 2.1.2, with integrity `sha512-9i1SR6tYeQ3o1beLeVMxhN6Fq513m9TZlTs+46+4JgvSNkaFoW9S4WrpV5MjzE+0CzVoC+dZ4RfZDIgW6+afnQ==`.
3. **canRefresh inputs (src/token.js).** A missing, non-accepted string, or NaN `obtainedAt`, `now` or `expiresAt` now makes `canRefresh` return `false`. It never returns `true` for them and does not throw. `parseTime` returns null for an unaccepted form; `toEpochMs`, used by `tokenAgeHours`, still throws VALIDATION. Two behaviours are unchanged: a `scopes` value that is not a list of strings still throws VALIDATION (and is checked first), and an `obtainedAt` later than `now` still throws VALIDATION.
4. **Keyring blank or non-string value (tests only).** No code change. A keyring password that is blank, a number, or an array holding a token is never returned and never registered; `get` throws CONFIG and `source` reports `unavailable`. See the note on this item below.

### Covering tests

- Trimming (test/secrets.test.js): "an env value with a trailing newline is returned trimmed, and redact masks the bare token"; "a keyring value with a trailing space is returned trimmed, and redact masks the bare token"; "set stores and registers the trimmed value"; "an audit line written with a padded token does not contain the bare token" (uses the real `createAudit` and `redact` from src/).
- canRefresh inputs (test/token.test.js): "canRefresh returns false, and does not throw, when obtainedAt is missing, a string or NaN"; "... when now is missing, a string or NaN"; "... when expiresAt is missing, a string or NaN". Each case is a separate `assert.equal` with a message.
- Keyring blank or non-string (test/secrets.test.js): "a keyring password that is blank is not returned and is reported as unavailable"; "a keyring password that is a number is not returned and is not registered"; "a keyring password that is an array holding a token is not returned and is not registered".

### Note on item 4

The request said a blank or non-string keyring entry is "treated as missing". I did not implement that as `get() === null`. The brief's rule is that `get()` returns null only when the keyring genuinely has no entry. An entry that exists but holds no usable password is not "no entry", and returning null would make a corrupt entry look absent. The code therefore keeps the behaviour from the first round: CONFIG, reported as unavailable. The tests assert that the value is never returned or registered. If the owner wants null here, the change is one branch in `resolve()`, and it conflicts with the brief's rule.

These three keyring tests passed before the fix, because the code already behaved this way. They are regression guards, not fixes.

### Commands and output

RED, before the fix (new tests added, source not yet changed):

```
node --test test/secrets.test.js test/token.test.js
ℹ tests 40
ℹ pass 33
ℹ fail 7
✖ a keyring value with a trailing space is returned trimmed, and redact masks the bare token
✖ an audit line written with a padded token does not contain the bare token
✖ an env value with a trailing newline is returned trimmed, and redact masks the bare token
✖ canRefresh returns false, and does not throw, when expiresAt is missing, a string or NaN
✖ canRefresh returns false, and does not throw, when now is missing, a string or NaN
✖ canRefresh returns false, and does not throw, when obtainedAt is missing, a string or NaN
✖ set stores and registers the trimmed value
```

Raw output: `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task9-fix1-red.txt`.

GREEN, covering tests after the fix:

```
node --test test/secrets.test.js test/token.test.js
ℹ tests 40
ℹ pass 40
ℹ fail 0
```

Raw output: `...\scratchpad\task9-fix1-green.txt`.

Full suite, `npm test`:

```
ℹ tests 355
ℹ suites 0
ℹ pass 355
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Exit code 0. Raw output: `...\scratchpad\task9-fix1-npmtest.txt`. The earlier total was 345, so the 10 new tests account for the difference.

### Open points from this round

- A future `obtainedAt` still throws VALIDATION from `canRefresh`, while a missing one returns false. This is the unchanged behaviour the request did not cover.
- The message "the keyring is unavailable" is also shown for a blank or malformed entry, although the keyring itself works. The wording may mislead; it is unchanged for now.
