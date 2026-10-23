### Task 9: Secrets and token lifecycle

**Files:** Create `src/secrets.js`, `src/token.js`. Tests: `test/secrets.test.js`, `test/token.test.js`. Install `@napi-rs/keyring` (version checked on npm at execution) into `dependencies`.

**Interfaces:**
- Consumes: the client from Task 5, `IgError` (Task 2).
- Produces: `createSecrets({ env, loadKeyring, service = 'instagram-automation' }) -> { get(name), set(name, value), remove(name), source(name) }`. `get` reads `IG_<NAME>` from `env` first, with the name upper-cased and dashes and dots changed to underscores, then reads the keyring entry `(service, name)`. `loadKeyring` returns the keyring module, or `null` when it is unavailable. `set` throws `CONFIG` when there is no keyring.
- Produces: `tokenAgeHours({ obtainedAt, now })`.
- Produces: `canRefresh({ obtainedAt, expiresAt, now, scopes })`: true only when the token is at least 24 hours old, not expired, and `scopes` includes `instagram_business_basic`.
- Produces: `refreshToken({ client })`: GET `refresh_access_token` with query `grant_type=ig_refresh_token`. Returns `{ token, expiresInSeconds }`. The caller stores the new token with an expiry 60 days out.
- Produces: `scheduleTokenChecks({ check, intervalMs = 3600000, setIntervalImpl })`: runs `check` every hour and returns a stop function. It never schedules a timer longer than 2147483647 ms.

**Tests:**
- `env var wins over keyring for the same name`: with `IG_OWNER_TOKEN` set and a keyring stub holding a different value, `get('owner_token')` returns the env value and `source` is `env`.
- `keyring is used when the env var is absent`.
- `set throws CONFIG when no keyring is available`.
- `canRefresh is false below 24 hours and true at 24 hours`.
- `canRefresh is false once the token has expired`.
- `canRefresh requires instagram_business_basic`.
- `refreshToken requests grant_type ig_refresh_token`.
- `scheduleTokenChecks uses an interval under 2147483647 ms`.
- `tokens are never written to a file`: after the calls above, no file under the data directory holds the token.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement both modules.** Run the tests and expect PASS.

