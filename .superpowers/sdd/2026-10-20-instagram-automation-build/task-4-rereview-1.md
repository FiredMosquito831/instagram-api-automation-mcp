# Task 4 re-review 1: fix round 1 (I-1, I-2, M-8, M-3, M-2)

Scope: `review-task-4-fix1.diff` (snap task-4-head to task-4-fix1-head), read against `task-4-review.md` and the fix round in `task-4-report.md`. The current `src/guard.js` and `src/caps.js` were read in full and match the diff. The full suite was not re-run. One focused read-only check was run: `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\check-fix1-clock.mjs`. Its output is cited under N-1 and N-2. Deferred items (M-1, M-4 to M-7, M-9, M-10) were not reviewed except where the fix touched them.

## Finding verdicts

**I-1. `stop()` recorded nothing for a bad detail, an unknown kind or a bad clock: ADDRESSED.**
- Record before refusal: `guard.js:187-208`. The kind is tested at line 188, the detail is converted at line 189, and the stop is written at lines 190-203 before the VALIDATION throw at lines 204-206.
- Unknown kind: recorded as `ACTION_BLOCKED` (`guard.js:194`), detail prefixed "stop kind not recognised" (`guard.js:191`, `195`). Test `guard.test.js:139-150` now asserts the stop IS recorded, and that it survives a restart. The old "nothing is stopped" assertion is gone.
- Non-string detail: `detailText` (`guard.js:63-72`) converts with `String()` inside a try block and does not throw. Test `guard.test.js:152-159` (12345 recorded as '12345'). One deviation, see N-2.
- Clock: `stopTime` (`guard.js:38-47`) catches a throwing clock and falls back to the process clock for an invalid Date. Tests `guard.test.js:161-168` (1e20) and `guard.test.js:170-184` (throwing clock). One gap, see N-1.
- The comment at `guard.js:60-62` matches the code. The `stop()` comment at `guard.js:183-186` matches it too.
- Paths traced: unknown kind with no prior stop (recorded, persisted, then VALIDATION); unknown kind with a failed save (stop held in memory, CONFIG raised instead of VALIDATION, then retried by `assertNotStopped`, `guard.js:173`); known kind with a stop already in place (first stop kept, `guard.js:190`). No path found where a stop is not recorded in memory.

**I-2. The usage window re-armed on a repeated reading: ADDRESSED, under ruling (1).**
- The last reading is kept at `caps.js:288-289`. A reading arms `highAt` only when it is new (`caps.js:307-315`: a different object, or different numbers). The gate is busy until `highAt + busyMs` (`caps.js:317-323`).
- Tests `caps.test.js:272-290`: high at t=0 is busy with 60000; the same object at t=70000 is ok; a new high at t=70000 is busy with 60000. `caps.test.js:292-300` covers an in-place change. The old test at `caps.test.js:247-258` still passes.
- Under the ruling (1) contract, a repeated reading does not re-arm the window. The contract caveats are carry-forward C-1, not counted here.

**M-8. A stop whose save failed lived only in memory: ADDRESSED.**
- `assertNotStopped` retries first (`guard.js:172-181`; retry at line 173, `saved` flag at line 178). `retrySave` (`guard.js:143-150`) swallows a failed retry, as ruling (2) accepts. The STOPPED error reports `saved: false` until the save succeeds.
- Test `guard.test.js:186-204`: failing save, STOPPED with `saved` false and no state file on disk; blocker removed, STOPPED with `saved` true; a restarted guard reads the stop from disk.
- `state.js:142-149` restores the in-memory state to the last saved image when a save fails, so the failed value does not leak into a later unrelated save. The retry sets it again.

**M-3. `senderId` stored untrimmed: ADDRESSED.**
- `describe` trims and refuses an empty result with VALIDATION (`caps.js:134-137`).
- `record` stores `req.senderId` (`caps.js:240`), and the per-sender match uses `req.senderId` (`caps.js:155`). Both use the trimmed value.
- Test `caps.test.js:302-312`: `' abc '` and `'abc'` share one conversation (the second is refused with reason "conversation"); `'   '` is VALIDATION. Residual, see O-2.

**M-2. Repeated tag ignored a zero limit: ADDRESSED.**
- The `limit === 0` check is now first in `verdictFor` (`caps.js:150-151`), before the distinct-tag early return (`caps.js:157`).
- Test `caps.test.js:314-328`: after the tag is counted, a zero limit refuses it again ("switched off") and refuses a new tag.
- No other rule changes result. For limit 0 the old code already returned busy at the same point for every non-distinct rule.

## New breakage in the fix diff

**N-1. Minor. `stopTime` can record a stop whose time cannot be read back, so a restart refuses to start.** `guard.js:42` and `guard.js:46`, read with `guard.js:84` (`ISO_TIME` at `guard.js:24`).
- A clock value that makes a valid Date with a year outside 0000-9999 is not caught by the fallback, because the fallback tests only for an invalid Date. Check output: a clock of 1e15 gave `since` "+033658-09-27T01:46:40.000Z" in the state, and a restart with the same state threw CONFIG "the stop in the state file is not valid" (createGuard refused).
- Fail-closed, not fail-open: the stop is recorded, and startup refuses until the state file is edited. Trigger needs a broken injected clock; `Date.now()` cannot produce it. The head had the same output for this input (`new Date(clock()).toISOString()`), but `stopTime` is the function the fix says guarantees a valid time.
- Fix: in `stopTime`, also fall back when `date.toISOString()` does not match `ISO_TIME`. Add a test with a clock of 1e15: the test at `guard.test.js:161` covers only the invalid-Date branch.

**N-2. Minor. A null detail is recorded as '' and not as `String(null)`.** `guard.js:64` returns '' for both `undefined` and `null`. Ruling (3) and item 1 say a non-string detail is recorded as `String(detail)`, which gives 'null' for null. The stop is recorded either way, so this is not a safety issue. The fix round text (`task-4-report.md`, "What changed", I-1) says a value that cannot be converted becomes '' and implies other non-strings are converted, which is not accurate for null. Check output: `stopStatus().detail` was "" after `stop('RATE_LIMITED', null)`. The controller should either accept null as absent, which the report should then say, or change `guard.js:64` to convert null too.

Checked, no breakage found:
- Stop recording: no path where a stop is not recorded in memory (see I-1). A failed save leaves the stop in memory, and `assertNotStopped` retries it (see M-8).
- Usage gate: no fail-open on the same-object path under ruling (1). The copy pattern and the in-place pattern are carry-forward C-1.
- Sender key: no new collision. Every write to `caps.auto_reply` goes through `describe`, so every stored `senderId` is trimmed. `entriesOf` refuses entries without a string `senderId` (`caps.js:196`).
- Stall: none. `retrySave` makes one save attempt per `assertNotStopped` call. A zero limit returns busy for the whole window, which is the intended switch-off.
- Clear and retry interplay: `clearStop` sets `unsaved = false` (`guard.js:217`), so `assertNotStopped` cannot write a stale stop after a clear. No `clock(` or `clockMs` call remains in `guard.js` (grep found none), so the removal of `clock` is safe.
- The STOPPED details gain `saved`. Nothing reads it yet, and it is additive.

## Out-of-scope observations

**C-1. Carry-forward to Task 13 (ruling 1): the usage gate depends on the caller's object identity.**
- A caller that passes a copy of the stored reading on every check (a new object with the same numbers) re-arms the window on every check (`caps.js:307-315`). Outbound stays busy until a read refreshes the reading. Fail-closed, and the same as before the fix.
- A caller that reuses one object and updates its fields in place with unchanged numbers is treated as a repeated reading, so the window does not re-arm (`caps.js:307-311`). If a later response still reports high usage and is written into the same object, the gate reopens after 60000 ms. Fail-open under that pattern.
- Task 13 must pass a new object for each response, parsed from that response, and never update one in place. The comment at `caps.js:275-276` ("a caller that passes the stored reading on every check does not re-arm") is true only for the same object reference, and could be reworded to say so.

**O-2. Residual of M-3: `trim()` strips only JavaScript whitespace.** `caps.js:136`. Zero-width and other format characters (for example U+200B) are not stripped, so `'abc\u200B'` is a separate conversation and a separate per-sender count. This is not the stated M-3 scope, and the fix does what M-3 asked. Instagram-scoped IDs are numeric, so a format check on `senderId` where IDs enter (Task 5 or Task 8) is the stronger fix.

**O-3. A stop whose save never succeeds is lost if the process exits.** This is the accepted decision 3 in the fix round. An audit line per stop (the M-1 suggestion) would reduce the window. Not new.

**O-4. Header comment nit.** `guard.js:2-4` says the error is raised "so that the caller knows the stop was not written". The VALIDATION throw for an unknown kind comes after a successful write (`guard.js:204-206`). The `stop()` comment (`guard.js:183-186`) is right; the header is not.

**O-5. Part of M-9 is now covered as a side effect.** The non-string detail test (`guard.test.js:152`), the `perWeek` 0 test (`caps.test.js:314`), and the changed unknown-kind test (`guard.test.js:139`) close three of the M-9 gaps. The test for a malformed `caps.*` counter is still missing. Not counted.

## Round verdict

All five findings are addressed: I-1, I-2, M-8, M-3 and M-2. There is no new Critical or Important breakage. Two new Minor issues, N-1 and N-2, do not block the round; both are small. The carry-forward C-1 is for Task 13 and is not counted.

New issues: Critical 0, Important 0, Minor 2 (N-1, N-2).
