# Task 4 review: caps, busy results, stop state and the guard

Scope: `task-4-base` to `task-4-head` (review-task-4.diff), read against task-4-brief.md, global-constraints.md, progress.md (Task 3 carry-forwards and Task 4 rulings 1 to 4), and task-4-report.md. Line numbers are for `snap/task-4-head/src/*.js` and `snap/task-4-head/test/*.js`, which match the diff. The test suite was not re-run. Two focused checks were run as a read-only scratch script against the head snapshot: `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\check-task4.mjs`. Its output is cited under I-1 and I-2.

## Spec compliance

Overall: ❌. One requirement is not met (usage throttle window, I-2). All other listed behaviours are met as far as the diff shows.

- ✅ Caps values match the constraints: `config.js:22-31` (minSpacingMs 2000, dailyTotal 200, likes 10 per hour and 50 per day, follows 20, unfollows 20, ownerDms 50, autoReplies 24 hours and 100 per day, publishing 10, hashtags 30 per 7 days).
- ✅ Daily total of 200 blocks the 201st outbound action: `caps.js:95` (rule), `caps.js:165-167` (the blocking entry leaves the window at the right time).
- ✅ Spacing of 2000 ms, busy with `retryAfterMs`: `caps.js:214-216`.
- ✅ Likes: 10 per hour and 50 per day, with unlike on the same counter: `caps.js:32-33` (BUCKET_OF), `caps.js:96-99` (rules).
- ✅ Follows 20 per day, unfollows 20 per day, owner DMs 50 per day, publish 10 per day locally: `caps.js:100-102`, `caps.js:113`.
- ✅ Auto-replies: one per sender per 24 hours (`caps.js:104-110`) and 100 per day (`caps.js:111`). The brief says per-sender, so the code follows the brief.
- ✅ Hashtags: 30 unique per 7 days, lower-cased, leading `#` removed (`caps.js:64`, `caps.js:142`), a repeat in the window is allowed without counting twice (`caps.js:156`), distinct-tag retry arithmetic (`caps.js:114-122`, `caps.js:165-167`).
- ✅ Every action counts toward outbound: `caps.js:218-221` (check loops the outbound rules), `caps.js:237` (record writes outbound for every action).
- ✅ Busy, not queued: `check` returns a busy result and nothing waits (`caps.js:210-230`); `check` writes nothing (reads through `entriesOf`, `caps.js:188-201`).
- ❌ Usage throttle: busy for 60000 ms after a reading at or above 80. `caps.js:302` re-arms the window on every call that passes a high reading, so repeated calls with the same stale reading keep the gate busy beyond 60000 ms. Reproduced by the scratch script: the same high reading at t=0, 30 s, 70 s, 130 s and 200 s each return busy with `retryAfterMs` 60000. See I-2.
- ⚠️ Usage gate `retryAfterMs`: the brief's Produces line says `retryAfterMs: busyMs`. The code returns the remaining window (`caps.js:307`), which the test at `caps.test.js:247-258` asserts. The behaviour fits the constraint's intent, but the deviation is not recorded as a ruling. See M-7.
- ✅ Usage gate numbers only, threshold 1 to 100 (`caps.js:276-283`), numeric check on both fields (`caps.js:286-295`), a non-number or missing field throws VALIDATION.
- ✅ Owner check: `guard.js:141-145`, exact string match; a non-string id is refused.
- ✅ `gate(confirm)`: `guard.js:188-190`, using `confirmed()` at `guard.js:47-51`. Only true gives execute; absent or false gives preview; any other value throws VALIDATION.
- ✅ Stop kinds and `shouldStop`: `guard.js:22` (AUTH_EXPIRED, ACTION_BLOCKED, CHECKPOINT, RATE_LIMITED), `guard.js:193-195`. Code-to-kind mapping: `errors.js:37-38` (4, 17, 32, 613, 80002), `errors.js:64-67` (190, HTTP 429, 368, feedback required, checkpoint, challenge, two-factor).
- ✅ A stop is persisted and saved at once: `guard.js:120-127` (`persist`), `guard.js:160-172` (`stop`), `guard.js:176-183` (`clearStop`; a failed save keeps the stop).
- ✅ Stop read from the key `stop` in the shape `{ stopped, kind, detail, since }`, refused when malformed: `guard.js:115` (read), `guard.js:63-82` (`readRecord`, strict key set and value checks).
- ✅ STATE_CORRUPT: `state.js:101-108` writes the record at recovery; the guard starts stopped from it (`guard.js:115-116`).
- ✅ STATE_LOST, ruling (1): `guard.js:129-133`, with `eventsHoldData` at `guard.js:86-96`. Residual gap in M-1.
- ✅ Only `clearStop(true)` clears: `guard.js:176-178`.
- ✅ Unknown action is refused with VALIDATION, not busy: `caps.js:129`. A missing `senderId` (`caps.js:136`) or a missing or invalid `tag` (`caps.js:141-143`) is refused the same way.
- ✅ Malformed counter in the state is refused, not read as empty: `caps.js:188-201` (`entriesOf` throws CONFIG). No test covers it. See M-9.
- ✅ Ruling (3): `createGuard` takes `eventsFile` (`guard.js:101`), and `caps.record` runs before the request (`caps.js:234-249`).
- ✅ All brief-named tests exist in `caps.test.js` and `guard.test.js` (spacing, daily total, likes, hashtags, owner, 190, rate limit, restart, gate, usage gate).
- ⚠️ The brief lists `busyResult` (Task 2) as consumed. The module builds its own busy shape at `caps.js:87-89` and does not use `busyResult` (`errors.js:79`). The report says the caller converts. See M-6.
- ⚠️ The report's mutation table and the 182 of 182 result were not re-run here, per the review scope.

## Strengths

- Fail-closed parsing throughout: `readRecord` (`guard.js:63-82`), `entriesOf` (`caps.js:188-201`), `describe` (`caps.js:128-146`) and the usage reading check (`caps.js:286-295`) all refuse rather than coerce.
- Save before send: `record` writes and saves at once and throws CONFIG with "do not send it" on failure (`caps.js:244-248`), so a failed count stops the request.
- The stop has an in-process latch that is set before the save (`guard.js:160-172`), so a failed save still stops this process and is retried by the next `stop()`.
- The retry time is computed from the entry that must leave the window (`caps.js:165-167`), which is the correct k-th-earliest arithmetic for both plain and distinct-tag rules.
- Restart and file-backed tests use the real `createState` (`caps.test.js:198-209` for counters, `guard.test.js:79-86` for the stop, `guard.test.js:170-184` for STATE_LOST), not only the in-memory double.
- Hashtag normalization and the retry for repeated tags are both covered by tests.

## Issues

### Critical

None.

### Important

**I-1. `stop()` records nothing when given a non-string detail or an unknown kind, so outbound actions keep running.**
- `guard.js:161`: an unknown kind throws VALIDATION before anything is recorded.
- `guard.js:162` and `guard.js:57`: a non-string detail throws TypeError from `clipDetail` before the stop is set.
- `guard.js:164`: `new Date(clock()).toISOString()` throws RangeError for a finite clock value outside the Date range, also before the stop is set.
- `guard.js:53-54` says "A stop is never refused for its detail, because a refused stop would not be recorded." The code does exactly that, so the comment and the code contradict each other.
- `guard.test.js:139-145` asserts that an unknown kind stops nothing. That codifies the fail-open path.
- Reproduced by the scratch script: `guard.stop('RATE_LIMITED', 12345)` throws TypeError and `stopStatus().stopped` stays false, with no `stop` key in the state. `guard.stop('RATE_LIMIT', 'typo kind')` throws VALIDATION and also stops nothing.
- Fix: on a stop call, record the stop first, then throw for bad input. For an unknown kind, record the stop under a fallback stop kind such as ACTION_BLOCKED, and for a non-string detail use `''` or `String(detail)`. Use a clock fallback or validate the Date range before the stop is set. Change `guard.test.js:139-145` to assert that the stop is recorded.

**I-2. The usage gate's busy window is re-armed on every check that passes the same high reading, so outbound actions stay busy beyond 60000 ms.**
- `caps.js:302` sets `highAt = t` whenever the reading passed in is at or above the threshold, including a reading that was already seen. `caps.js:304-307` then keeps the gate busy until `highAt + busyMs`.
- The report and the code comment at `caps.js:273-274` say the window is 60000 ms from the reading and the gate is not stuck on a reading that is never refreshed. The code does the opposite when the caller passes the stored last reading each time, which is the Task 13 pattern (R6, and the report's note on refresh).
- Reproduced by the scratch script: the same high reading at t=0, 30 s, 70 s, 130 s and 200 s returns busy with `retryAfterMs` 60000 every time. A low reading at 260 s opens the gate.
- The test at `caps.test.js:247-258` only passes a low reading after the high one, so it does not catch this.
- Fix: arm `highAt` only for a reading that is new, for example by comparing the object identity with the last reading seen or by taking a response counter or time from the caller. Add a test: high reading at 0, the same high reading at 70 s, expect ok after the window.

### Minor

**M-1. A stop held only in the state file is lost if that file is deleted and no events file exists.** `guard.js:129-133` and `guard.js:86-96`. The STATE_LOST trigger needs the events file to hold data, so a fresh-looking state with no events file gives no stop. This is inside the O-2 ruling's wording, but the ruling does not record it as a residual. Fix: record it as a known limit in the report, or write an audit line at each stop (audit.js exists) and check it at startup.

**M-2. A repeated tag is allowed even when `hashtags.perWeek` is 0.** `caps.js:156` returns null before the `limit === 0` check at `caps.js:163`. Only reachable if the config changes to 0 within a week. Fix: move the `limit === 0` check above the distinct-tag early return.

**M-3. The `senderId` is stored untrimmed, so whitespace variants bypass the per-sender rule.** `caps.js:136-138`, compared with the tag handling at `caps.js:142`. Fix: trim `senderId`, reject an empty result, and use the trimmed value for both `check` and `record`.

**M-4. `eventsHoldData` reads the whole events file synchronously at every start.** `guard.js:86-96` (`readFileSync` at line 90). Events are kept for 30 days, so this grows. Fix: stat the file size, or read until the first non-whitespace byte.

**M-5. Helpers are duplicated.** `isPlainObject`, `isState` and `clockMs` appear in `caps.js:66-80` and `guard.js:27-40`. This is the Task 3 M-6 carry-forward. Fix: move them to a shared module.

**M-6. The busy shape is not `busyResult`.** `caps.js:87-89` builds `{ ok: false, reason, retryAfterMs }`. The brief says this task consumes `busyResult` (`errors.js:79`). The report says the caller converts it. Fix: either use `busyResult` at the caller in Task 13 and record the decision, or record the decision now.

**M-7. The usage gate's `retryAfterMs` is the remaining window, not `busyMs`.** `caps.js:307`. The brief's Produces line says `busyMs`. After I-2 is fixed, the remaining window is the behaviour the constraint describes. Fix: record a ruling in progress.md, or align the code with the brief text.

**M-8. A stop whose save failed lives only in memory until the next `stop()` call.** `guard.js:160-172` (the `unsaved` path) and `guard.js:148-154` (`assertNotStopped`). Documented in the report (decision 3). Fix: in `assertNotStopped`, when `unsaved` is true, retry `persist()` before throwing STOPPED.

**M-9. Test gaps.**
- No test that a malformed `caps.*` counter in the state refuses (`caps.js:188-201`).
- No test for a non-string detail (`guard.js:57`).
- `guard.test.js:139-145` must change with I-1.
- No test for `hashtags.perWeek` at 0 (M-2).

**M-10. `record()` does not check limits.** `caps.js:234-249`. A caller that skips `check()` counts an action without any refusal. This is not a fail-open path (it counts more, not less), but a defensive fix is cheap: `record()` could call `check()` and refuse with a busy result on a limit.

## Assessment

Task quality: **Needs fixes.** The caps arithmetic, the stop shape, the owner check and the STATE_CORRUPT and STATE_LOST startup path are sound and tested. Two Important defects remain: `stop()` silently records nothing for a bad detail or an unknown kind (I-1), and the usage gate can hold outbound actions busy well beyond 60000 ms (I-2). Both fixes are small.

Carry-forwards, not counted as issues:
- Task 13: call `assertNotStopped` first, then `check` and `record` in one synchronous block before the request, and pass a fresh usage object per response to the usage gate (the I-2 fix depends on the last point). Ruling 2 (dedupe by event id) applies.
- Task 17: pass the same absolute `eventsFile` path the event log uses, or STATE_LOST detection is silently off (C2).
- Task 6 (quota_total) and Task 8 (private-reply rule and window) stay outside caps, as ruled (4).
