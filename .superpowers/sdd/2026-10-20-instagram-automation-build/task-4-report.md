# Task 4 report: caps, busy results, stop state and the guard

Status: DONE_WITH_CONCERNS

Full suite: `npm test` exit 0, 182 of 182 pass (142 before this task, plus 40 new). The test script is unchanged.

## Files

Created (no other file changed; verified by diff against `snap/task-4-base`, and package.json is unchanged):

- `src/caps.js`: `createCaps`, `createUsageGate`, and the action name list.
- `src/guard.js`: `createGuard`, and the stop kind list `STOP_KINDS`.
- `test/caps.test.js`: 18 tests.
- `test/guard.test.js`: 22 tests.

Not changed, as the brief requires: `src/config.js`, `src/errors.js`, `src/redact.js`, `src/audit.js`, `src/state.js`, `src/events.js`. Nothing was installed (R3 does not apply). No commit (R2).

## TDD evidence

RED, before the modules existed (`node --test test/caps.test.js test/guard.test.js`):

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\caps.js' imported from D:\Projects2\InstagramApi\test\caps.test.js
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\guard.js' imported from D:\Projects2\InstagramApi\test\guard.test.js
ℹ tests 2
ℹ pass 0
ℹ fail 2
```

This first RED fails at module load, not at an assertion. Assertion-level RED: a later test was added to guard.test.js ("a stop whose save failed is saved again by the next stop call") before its fix. It failed with `ℹ pass 21, ℹ fail 1`. After the fix the file passed.

GREEN, the two files after implementation: `ℹ tests 40, ℹ pass 40, ℹ fail 0`.

GREEN, full suite (`npm test`): `ℹ tests 182, ℹ pass 182, ℹ fail 0, ℹ cancelled 0, ℹ skipped 0, ℹ todo 0`, exit 0.

Mutation check (on a scratch copy outside the project, one change at a time): each change below made at least one new test fail.

| Mutation | Failing tests |
|---|---|
| spacing off | 1 |
| repeated hashtag counts twice | 1 |
| hashtag rule ignored | 1 |
| likes hour window is a day | 1 |
| record does not save | 2 |
| per-sender auto-reply ignored | 1 |
| usage gate has no window after a reading | 1 |
| STATE_LOST check off | 3 |
| events file data ignored | 9 |
| clearStop not gated | 1 |
| stop kept only in memory after failed save (latch removed) | 1 |
| no retry of an unsaved stop | 5 |
| owner check off | 1 |
| RATE_LIMITED not a stop | 1 |
| stop detail not clipped | 1 |
| stop not persisted at all | 5 |

## Interface

`src/caps.js`

- `createCaps({ caps, state, now })` returns `{ check(action, opts), record(action, opts), usage() }`. `caps` is the caps section of the config (DEFAULT_CAPS shape). Its required keys are checked at construction. `state` needs `get`, `set` and `save`.
- `check` returns `{ ok: true }` or `{ ok: false, reason, retryAfterMs }`. The caller turns a refusal into `busyResult({ reason, retryAfterMs })`. It changes nothing.
- `record` counts an action. The caller must call it before sending the request. It saves at once. If the save fails it throws CONFIG with "do not send it", so the request must not go out. `record` does not check limits; the caller calls `check` first.
- Unknown action names, a missing `senderId` for `auto_reply`, and a missing or invalid `tag` for `hashtag` throw VALIDATION. A bad call is never read as busy.
- Windows: outbound is 200 per rolling 24 hours; likes 10 per rolling hour and 50 per rolling day, with like and unlike sharing them; follows and unfollows 20 per day each; owner DMs 50 per day; publishing 10 per day locally; auto-replies 1 per sender per 24 hours and 100 per day; hashtags 30 unique per rolling 7 days. Spacing is 2000 ms between outbound actions.
- A hashtag is lower-cased, and a leading `#` is removed. A tag counts once while it has been used within the window; its latest use keeps it in the window.
- Stored counters live under `caps.outbound`, `caps.likes`, `caps.follows`, `caps.unfollows`, `caps.owner_dm`, `caps.auto_reply`, `caps.publish` and `caps.hashtag`. Each is a list of `{ at }` entries (with `senderId` or `tag` where needed). A malformed list throws CONFIG.
- `usage()` returns `{ outbound: { day }, likes: { hour, day }, ... }`, each with `used` and `limit`.
- `createUsageGate({ thresholdPercent, busyMs, now })` returns `{ check(usage) }`. `usage` is the X-App-Usage object with numeric `total_time` and `total_cputime`. A reading at or above the threshold arms a busy window of `busyMs` from that reading. A busy result is `{ ok: false, retryAfterMs, reason }`, where `retryAfterMs` is what remains of the window. `null` or `undefined` (no response yet) passes. A malformed reading throws VALIDATION.

`src/guard.js`

- `createGuard({ owner, state, now, eventsFile })`. `owner.igUserId` must be a non-empty string. `eventsFile` is required (an addition to the plan's signature, as the ledger allows).
- `assertOwner(igUserId)` throws OWNER_MISMATCH. A non-string id is refused.
- `assertNotStopped()` throws STOPPED, with details `{ kind, since }`.
- `stop(kind, detail)`: kind must be one of `AUTH_EXPIRED`, `ACTION_BLOCKED`, `CHECKPOINT`, `RATE_LIMITED`, `STATE_CORRUPT`, `STATE_LOST`; otherwise VALIDATION. The detail must be a string or absent, is redacted, and is clipped to 200 characters. The first stop is kept. It returns the status.
- `clearStop(confirm)` returns `'preview'` (confirm absent or false), `'cleared'`, or `'not_stopped'`. A confirm that is not a boolean throws VALIDATION.
- `stopStatus()` returns a redacted copy of `{ stopped, kind, detail, since }`.
- `gate(confirm)` returns `'execute'` only for `true`, `'preview'` for absent or false, and throws VALIDATION otherwise.
- `shouldStop(error)` is true for an IgError of kind AUTH_EXPIRED, ACTION_BLOCKED, CHECKPOINT or RATE_LIMITED.
- The stop is stored under the state key `stop`, as `{ stopped, kind, detail, since }`. Startup refuses a malformed record with CONFIG. Each change is saved at once.

## Decisions and deviations

1. STATE_LOST trigger is broader than the ruling. The ruling says "the events file holds the {"lastSeq":N} header". The header is written only by `decide()` and `purge()`, so an events file with events alone (the common case, since `append` never writes a header) would have been missed. That leaves the O-2 fail-open path open. The guard therefore starts STATE_LOST when the events file holds any non-blank content and the state has no `stop` key and no whole-number `events.lastSeq`. Fresh installs are unaffected, and a test covers this.
2. The STATE_LOST check runs only when the state has no `stop` key at all. Without this, clearing STATE_LOST (or STATE_CORRUPT) would not hold: the state still has no `events.lastSeq` until a new event arrives, so every restart would stop again. Cost: a state that holds a cleared stop record but no `events.lastSeq` (for example, an older backup restored over the current file) is not detected.
3. A stop whose save fails still stops this process: the in-process copy changes before the save, and the error is raised. The next `stop()` call saves it again. Until a save succeeds, the stop is not on disk.
4. `clearStop` returns result strings rather than throwing, to match `gate`. Clearing a stop that is not in place returns `'not_stopped'` and writes nothing.

## Self-review

I read the diff against the snapshot. The concerns checked were these:

- Fail closed: every unknown kind, malformed record, missing sender or tag, and malformed usage reading is refused rather than coerced.
- Save ordering: `check` writes nothing. `record` and each stop change call `save()` at once, so no unsaved change is left behind in the shared state object.
- No raw response text enters a stop: `stop` takes codes and kinds, and the detail is redacted (best effort, per Task 2) and clipped.
- Clock: all tests use a fake clock. The guard tests use temporary files only. No network call.

No lint configuration exists, so the review was by reading and by the mutation check above.

## Concerns and carry-forwards

- After a STATE_LOST or STATE_CORRUPT clear, `events.issued` and `events.acked` are gone, so `pending()` re-delivers already-acked events. Task 11 and Task 13 need to handle this before the poller runs. Auto-replies are capped (1 per conversation per 24 hours) but not prevented. `events.js` is out of scope here.
- Not in caps, by design. `publishing` must also check `quota_total` from `content_publishing_limit` (Task 6 and Task 13). The per-comment private-reply rule and its 7-day window are messaging-window checks (Task 8 and Task 13).
- A busy outbound call sends nothing, so the usage reading refreshes only on a read response. Task 5 must pass numbers, not strings, to the usage gate, and Task 13 must call the usage gate before the caps.

---

# Fix round 1 (review task-4-review.md)

Status of the round: all five items are addressed. `npm test` is green: 191 of 191 pass, exit 0. Only `src/caps.js`, `src/guard.js`, `test/caps.test.js` and `test/guard.test.js` changed in this round (diffed against `snap/task-4-head`; package.json and the six protected modules are unchanged).

## What changed

**I-1 (fail-open stop).** `guard.js`
- `stop()` records the stop before any refusal. An unknown kind is recorded as `ACTION_BLOCKED`, with the detail prefixed `stop kind not recognised`, and then the call throws VALIDATION. The VALIDATION message does not echo the kind value.
- A detail that is not a string is recorded as `String(detail)`, and a value that cannot be converted is recorded as `''`. The call does not throw for it. The detail is still redacted and clipped to 200 characters.
- The clock is guarded by `stopTime(now)`. A clock that throws, or a value that is not a valid Date (for example 1e20), falls back to the process clock, so the stop is always recorded with a valid ISO time. The STATE_LOST startup path uses the same helper.
- The comment at the detail helper (old `guard.js:53`) now says what the code does.
- `guard.test.js`: the old "an unknown stop kind is refused, and nothing is stopped" test now asserts the stop IS recorded (kind `ACTION_BLOCKED`, detail mentions "not recognised", still stopped after restart).

**I-2 (usage window re-armed by a stale reading).** `caps.js`, `createUsageGate`
- A reading arms the window only when it is new: the object is a different one from the last reading seen, or its `total_time` or `total_cputime` differs from the values recorded when it was last seen. A repeated high reading no longer re-arms the window, so the window runs `busyMs` from the reading that caused it.
- Tests: the high reading at t=0 is busy 60000; the same reading at t=70000 is ok; a new high reading at t=70000 is busy with `retryAfterMs` 60000 (named test). Two more pin the rule: a new response object with the same high numbers re-arms, and an object changed in place re-arms when its numbers change.

**M-8 (stop held only in memory).** `guard.js`
- `assertNotStopped()` retries a pending save before it throws STOPPED. A failed retry does not raise its own error; the STOPPED error carries `saved: false` in its details, and `saved: true` once the save has succeeded.
- Test: a failing save, then `assertNotStopped` (STOPPED, `saved` false, no state file on disk), then the blocker is removed and `assertNotStopped` (STOPPED, `saved` true); a restarted guard then reads the stop from disk.

**M-3 (whitespace in senderId).** `caps.js`, `describe`
- `senderId` is trimmed; an empty result is refused with VALIDATION. The trimmed value is used for both `check` and `record`, so `' abc '` and `'abc'` share one per-sender count.
- Test: named "a sender id with spaces around it is the same conversation as the trimmed id" (also covers `'   '` refused with VALIDATION).

**M-2 (repeated tag under a zero limit).** `caps.js`, `verdictFor`
- The `limit === 0` check moved to the start of `verdictFor`, so it runs before the distinct-tag early return. For every other rule this changes nothing, because each already refused a zero limit at the same point.
- Test: named "a zero hashtag limit refuses a repeated tag too" (a tag counted under the normal limit, then a zero limit over the same state refuses it and a new tag).

## Tests written first (RED)

Before the fixes, `node --test test/caps.test.js test/guard.test.js` gave `ℹ tests 47, ℹ pass 40, ℹ fail 7`. The seven failures were: the repeated high reading (I-2), the trimmed sender (M-3), the zero-limit repeat (M-2), the unknown-kind stop (I-1), the non-string detail (I-1), the clock outside the Date range (I-1), and the retry in `assertNotStopped` (M-8). The in-place usage test already passed, as a guard for the new rule.

After the fixes, the two files gave `ℹ tests 49, ℹ pass 49, ℹ fail 0`. Two more tests were added after a mutation check showed gaps: "a stop is recorded even when the clock throws" and "a new response with the same high numbers is a new reading, and re-arms the window".

## Mutation check for this round (scratch copies, outside the project)

Each mutation was applied to a fresh copy of `src` and `test`, one at a time. Each one fails at least one test:

| Mutation | Failing tests |
|---|---|
| I-1: unknown kind throws before recording | 1 |
| I-1: non-string detail throws before recording | 1 |
| I-1: clock failure not guarded | 1 |
| I-2: every check with a high reading re-arms | 1 |
| I-2: object identity not compared | 1 |
| M-3: senderId not trimmed | 1 |
| M-2: zero limit after repeated tag (old order) | 1 |
| M-8: `assertNotStopped` does not retry | 1 |

The 16 mutations from the original task were rerun against the fixed code, and all 16 are still caught.

## Command and output

```
cd D:\Projects2\InstagramApi && npm test
```

```
ℹ tests 191
ℹ suites 0
ℹ pass 191
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
Exit code 0. The full output is in `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\full-run-fix1-final.txt`.

## Decisions in this round

- A non-string detail is recorded as text and does not throw, as the item asked. The stop is what matters for safety, so a bad detail must not stop it from being recorded.
- The usage gate depends on the caller passing a new object for each response. A caller that copies the stored reading on every check re-arms the window on every check, so outbound calls stay busy (fail closed) until a read refreshes the reading. Task 13 must follow this.
- `retrySave` swallows the error of a failed retry, and the STOPPED error reports `saved: false`. A persistent disk fault therefore keeps the process stopped, and the error is visible in the details, not as a separate exception.
- Deferred items (M-1, M-4, M-5, M-6, M-7, M-9, M-10) are unchanged, as instructed.
