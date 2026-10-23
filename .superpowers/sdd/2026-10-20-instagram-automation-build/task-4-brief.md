### Task 4: Caps, busy results, stop state and the guard

**Files:** Create `src/caps.js`, `src/guard.js`. Tests: `test/caps.test.js`, `test/guard.test.js`.

**Interfaces:**
- Consumes: `IgError` and `busyResult` (Task 2), `createState` (Task 3).
- Produces: `createCaps({ caps, state, now }) -> { check(action, { senderId, tag }), record(action, { senderId, tag }), usage() }`. `check` returns `{ ok: true }` or `{ ok: false, reason, retryAfterMs }`.
- Action names: `outbound`, `like`, `unlike`, `follow`, `unfollow`, `owner_dm`, `auto_reply`, `publish`, `comment_reply`, `comment_hide`, `comment_delete`, `profile_edit`, `private_reply`, `hashtag`. `like` and `unlike` share the likes counters. `follow` and `unfollow` have their own counters. `auto_reply` keeps a per-sender 24-hour counter and a daily counter. `publish` uses the local daily counter. `hashtag` counts unique tags within 7 days, so a repeated tag does not count twice. Every action also counts toward `outbound`.
- Produces: `createUsageGate({ thresholdPercent, busyMs, now }) -> { check(usage) }`. `check` returns `{ ok: true }` or `{ ok: false, retryAfterMs: busyMs, reason }`, when `total_time` or `total_cputime` is at or above the threshold.
- Produces: `createGuard({ owner, state, now }) -> { assertOwner(igUserId), assertNotStopped(), stop(kind, detail), clearStop(), stopStatus(), gate(confirm) -> 'execute' | 'preview', shouldStop(error) }`.
- `shouldStop(error)` is true for `AUTH_EXPIRED`, `ACTION_BLOCKED`, `CHECKPOINT` and `RATE_LIMITED`.
- The stop state is stored under `stop`, so it survives a restart.

**Tests:**
- `spacing returns busy with retryAfterMs`: a call recorded, then a check at +1000 ms returns `ok: false` with `retryAfterMs` 1000. At +2000 ms it returns `ok: true`.
- `daily total of 200 blocks the 201st outbound action`.
- `likes are capped at 10 per hour`: the 11th like in the hour is refused, and an unlike counts toward the same limit.
- `hashtags are capped at 30 unique tags per 7 days`: a repeated tag does not count twice.
- `owner mismatch throws OWNER_MISMATCH`.
- `error 190 sets stop state`: `shouldStop` is true for `AUTH_EXPIRED`, and after `stop('AUTH_EXPIRED')`, `assertNotStopped` throws `STOPPED`.
- `rate limit sets stop state`: `shouldStop` is true for `RATE_LIMITED`.
- `stop state survives a restart`: a new guard over the same state still refuses.
- `gate returns preview when confirm is absent and execute when it is true`.
- `usage gate returns busy at total_time 80`: the result is busy with `retryAfterMs` 60000.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the modules.** Run the tests and expect PASS.

