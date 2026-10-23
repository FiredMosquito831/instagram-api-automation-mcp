### Task 2: Errors, redaction, audit and the busy result

**Files:** Create `src/errors.js`, `src/redact.js`, `src/audit.js`. Tests: `test/errors.test.js`, `test/audit.test.js`.

**Interfaces:**
- Consumes: nothing.
- Produces: `IgError extends Error`, with `kind` (one of `ERROR_KINDS`) and `details`. `ERROR_KINDS` is `CONFIG, VALIDATION, OWNER_MISMATCH, STOPPED, CONFIRMATION_REQUIRED, CAP_EXCEEDED, ROUTE_DISABLED, NOT_SUPPORTED, WINDOW_CLOSED, AUTH_EXPIRED, RATE_LIMITED, ACTION_BLOCKED, CHECKPOINT, API_ERROR, UNOFFICIAL_ADAPTER_ERROR`.
- `mapGraphError({ status, body }) -> IgError`. `body.error.code === 190` gives `AUTH_EXPIRED`. Codes 4, 17, 32, 613 and 80002, or `status === 429`, give `RATE_LIMITED`. Code 368 gives `ACTION_BLOCKED`. Anything else gives `API_ERROR`. The message is `body.error.message`, redacted.
- `busyResult({ reason, retryAfterMs }) -> { busy: true, reason, retryAfterMs }`. Busy is a result, not an error.
- `redact(value)` returns a deep copy. Keys matching `/token|secret|password|authorization|sessionid|cookie/i` become `'[redacted]'`. In strings, `access_token=<value>` and `Bearer <value>` are replaced.
- `createAudit({ file, now }) -> { record(entry), read({ limit }) }`. `record` appends one JSON line `{ at, action, target, route, outcome, detail }`, redacted. It creates the folder if needed.

**Tests:**
- `code 190 maps to AUTH_EXPIRED`: `mapGraphError({ status: 400, body: { error: { code: 190, message: 'expired' } } }).kind === 'AUTH_EXPIRED'`.
- `codes 4, 17, 32, 613, 80002 and status 429 map to RATE_LIMITED`.
- `code 368 maps to ACTION_BLOCKED`.
- `unknown errors map to API_ERROR`.
- `busyResult carries busy true and retryAfterMs`.
- `redact removes tokens from keys and strings`: `redact({ access_token: 'abc', note: 'x access_token=abc&y=1' })` contains no `abc`.
- `audit lines never contain access_token`: record an entry with a token in `detail`, read the file, and assert the token is absent.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the modules.** Run the tests and expect PASS.

