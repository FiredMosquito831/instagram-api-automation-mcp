# Task 11 report: poller (reads new messages through the official conversations endpoint)

Status: DONE_WITH_CONCERNS

## Summary

The poller is built and tested. It lists the owner's conversations, reads the first page of messages of each changed
thread, and stores each inbound message once in the event log. It only reads. The client it is given exposes `get`
and nothing else, so no write can be made through it. No network call is made by any test. Tests use a fake Graph
client, a fake sleep, a fake clock, and real state, event-log, audit and guard files in a temporary directory. No
timer is started by any test.

## Files changed

- Created `src/poller.js` (the module).
- Created `test/poller.test.js` (19 tests in round 0; 25 after fix round 1).
- No other file changed. `package.json` and the test script are untouched. Nothing was installed (no `npm install`).
  The project is not a git repository, so there is no commit (R2).

## TDD evidence

RED (before `src/poller.js` existed). Command: `node --test test/poller.test.js`. Output excerpt:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\poller.js' imported from D:\Projects2\InstagramApi\test\poller.test.js
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

The log is at `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task11-red.txt`.

GREEN (after `src/poller.js` was written). Command: `node --test test/poller.test.js`. Output excerpt:

```
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ duration_ms 2473.0594
```

The log is at `...\scratchpad\task11-green2.txt` (same folder).

Full suite. Command: `npm test` (`node --test test/*.test.js`). Output:

```
ℹ tests 403
ℹ pass 403
ℹ fail 0
```

Exit code 0. The 403 is the 384 tests that passed before this task plus the 19 new ones. The log is at `...\scratchpad\task11-npmtest.txt`.

The 19 tests (names as the brief gives them, where it names them): `poll dedupes on message id across ticks`,
`owner-sent messages are not stored`, `only changed threads are read`, `calls are spaced by poll.spacingMs`,
`maxThreadsPerTick is honoured`, `RATE_LIMITED doubles the interval`, `AUTH_EXPIRED stops the poller and sets the stop
state`, `onInbound is called once per new event`, plus eleven more: a failing thread is audited and the tick goes on;
a conversation without an updated time is not read as changed; audit lines carry the kind and the action, never the
message text; a message with no text is stored with empty text and the Graph time; a lost state does not store a
message twice; only the first page of messages is read (20 of 25); a message the event log refuses is audited and
skipped; a callback that throws does not stop the tick; a tick is refused while another tick runs; poll settings
outside their bounds are refused with the field name; createPoller refuses a missing audit log, guard, owner or sleep.

### Mutation checks (in scratch copies, not the project)

Each rule was broken in a copy of `src/poller.js`, and the poller tests were run against it:

| Mutation | Result |
|---|---|
| Remove the `hasId` check before append | Caught, by `poll dedupes...`, after the test was tightened (see below) |
| Remove the owner-sent filter | Caught, by `owner-sent messages are not stored` |
| Remove the `maxThreadsPerTick` slice | Caught, by `maxThreadsPerTick is honoured` |
| Remove the spacing sleep | Caught, by `calls are spaced by poll.spacingMs` |
| Backoff cap 20 minutes instead of 10 | Caught, by `RATE_LIMITED doubles the interval` |
| Remove the seen-value check | Caught, by `only changed threads are read` |
| Do not set `halted` on AUTH_EXPIRED | Caught, by `AUTH_EXPIRED stops the poller...` |
| Do not double the interval on RATE_LIMITED | Caught, by `RATE_LIMITED doubles the interval` |
| Remove the Graph zone conversion (`+0000` to `+00:00`) | Caught, by 3 tests |

The first version of the dedupe test did not catch the removal of the `hasId` check. The event log refuses a repeated
id with VALIDATION, and the poller's skip path caught that, so the message was still not stored twice. The poller would
still have written a `poll.skip` audit line for every repeated message. The test now asserts that no `poll.skip` line
is written for a message that is already stored. After that change the mutation is caught.

## Behaviour

- `tick()`: gets the client; lists the owner's conversations (one page, the list default of 20). It selects the
  threads whose `updated_time` differs from `state['poll.seen.<id>']`, sorted most recent first and capped at
  `poll.maxThreadsPerTick`. For each thread it reads the first page of messages, stores each message from another
  account once (checked with `events.hasId` before `events.append`), oldest first, then stores the thread's updated time
  and calls `onInbound` for each new event. A thread's updated time is stored only after its messages are stored.
- Every Graph read waits `poll.spacingMs` first (the injected sleep). The wrapper also covers the per-message reads
  that `conversationMessages` makes inside one call, so the spacing holds for every request.
- `start()` runs the first tick at once, then schedules the next tick at the interval in use. `stop()` clears the
  timer. The timer chain is `setTimeout`, not `setInterval`, so the interval can change after a rate limit.
- AUTH_EXPIRED, CHECKPOINT and ACTION_BLOCKED: the poller halts. `guard.stop(kind, detail)` sets the stop, and the
  guard saves it. The audit line carries the kind and the action. While halted, `tick()` makes no request. The halt
  follows the guard's stop (see fix round 1).
- RATE_LIMITED: `guard.stop('RATE_LIMITED', detail)` sets the stop. The tick is skipped at once, and the interval
  becomes `max(current, min(2 * current, 600000))`. The poller does not halt.
- Any other error: an audit line with the action and the kind (`UNKNOWN` for an error that is not an `IgError`), then
  the poller goes on.

## Rulings and deviations (each is a judgement the controller may want to confirm)

1. The brief's signature has no audit log, but the errors must be audited. `audit` is added as a required dependency
   (`audit.record`). `config` is the full config object, and `config.poll` is read from it. `owner` is the igUserId
   string.
2. `poll` settings are validated at build time, with `ConfigError` and the field name. Bounds: `intervalMs` 1000 to
   2147483647, `maxThreadsPerTick` 1 to 100, `spacingMs` 600 to 60000 (the spec's 600 ms is the floor). An unknown poll
   key is refused. Config is not coerced.
3. Interval recovery: a clean tick (status `ok`) returns the interval to `poll.intervalMs`. The brief does not say when
   the backoff ends.
4. Graph writes the zone as `+hhmm` (the messaging endpoint's comment says so). The event log accepts only `+hh:mm`, so
   the poller converts that form. Any other text is passed on unchanged, and the event log refuses it.
5. `text` that is null (an attachment-only message) is stored as `''`. This is the Task 10 I-2 lesson.
6. A message that the event log refuses with VALIDATION (for example, a time more than 5 minutes ahead, or an
   unreadable time) is audited as `poll.skip` with the message id as the target. It is not stored, and the thread is
   still marked read, so that one bad message does not hold its thread back. The message is not retried. This matches
   the Task 10 ruling for future-stamped webhook events.
7. A callback that throws is audited (`poll.notify`, detail `CALLBACK_ERROR`), and the tick goes on. The event is
   already stored when the callback runs.
8. A tick called while another tick is running returns `status: 'in_progress'`. A tick that throws (for example, a
   failed audit write) emits a warning carrying the error name only, and the loop goes on.
9. `tick()` returns `{ status, threadsRead, appended, errors, intervalMs, at }`. Status is one of `ok`, `error`,
   `backoff`, `halted`, `in_progress`.

## Known limits and carry-forwards

- First page only (the Task 8 paging carry-forward). Corrected in fix round 2: the list asks for 100 conversations. A
  conversation beyond the first 100 is not returned, and it is not read until it reappears on the first page. A message
  beyond the first 20 of a thread is never read, because the endpoint's limit is 20 and it does not page. Both cases are
  audited with outcome `truncated` when the page comes back full (see fix round 2).
- Superseded by fix round 1: CHECKPOINT and ACTION_BLOCKED now halt the poller and set the stop through the guard, as the
  global constraints require. The spec's line on the poller ("stops on auth errors") is narrower than the constraints,
  and the constraints were followed.
- The live format of `created_time` and `updated_time` is unverified (Task 8 ruling). Corrected in fix round 4 (O-3): a
  text `created_time` that is not an ISO time with a zone is skipped and audited as `poll.skip`, so if the live format
  differs, every inbound message is skipped. A text `updated_time` that `Date` cannot parse is still read, after every dated
  thread, and in Graph's list order among those undated threads. An absent or blank time is null, and that row is skipped and audited as `poll.skip` (fix round 3). A time that is
  present but is not text (for example a number) fails the list or the thread with `API_ERROR`, on every tick. The live
  phase must confirm the format.
- `start()` and `stop()` (the timer chain) are not tested, because the brief says no test starts a timer. They were
  checked by reading only. The tick logic they call is tested.
- Node 22 has not been run. The local Node is v24.6.0. Carry-forward to Task 18.
- Superseded by fix round 1: the poller checks the guard's stop at the start of each tick. A halting stop refuses the
  tick. A RATE_LIMITED stop does not.

## Self-review

I read both new files in full, and I checked each rule against the brief:

- Dedupe by message id: `events.hasId` runs before every append (tests 1, 14).
- Owner messages are not stored (test 2). Only changed threads are read, and the stored value is the `updated_time`
  (test 3). Calls are spaced by the configured value, including the per-message reads (test 4).
- The thread cap takes the most recent threads first (test 5). Backoff and reset follow the brief (test 6).
  AUTH_EXPIRED halts and sets the stop, and it persists (test 7).
- `onInbound` runs once per event, in chronological order within a thread (test 8).
- Read-only: the client given to the endpoints exposes `get` only, and tests check that no write was attempted.
- Audit lines carry the kind and the action, never the message text (test 11). The test puts a sentinel in the error
  message and checks it does not reach the audit file.
- No network: every test uses the fake client. No timer is started by a test.
- Fail closed: the poll settings are checked, a conversation with no updated time is not read as changed (superseded in
  fix round 3: the endpoint gives it null, the poller audits it as `poll.skip`, and the other conversations are read), and
  an unknown kind is audited, not coerced.
- The poller does not pass `retryPost` and makes no write call.
- I did not change `src/events.js`, `src/guard.js`, `src/config.js`, `src/errors.js` or `src/graph/endpoints/messaging.js`.
  (Superseded: fix rounds 1 to 4 changed these files, as their sections below record.)
  The poller imports `ConfigError`, `IgError`, `conversationsList` and `conversationMessages` from them.

The mutation checks above are the evidence that the tests can fail.

## Fix round 1 (coordinator ruling: the global constraints' stop codes bind the poller)

Status: DONE_WITH_CONCERNS

### What changed

- Stop codes now go through the guard. AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED and RATE_LIMITED each call
  `guard.stop(kind, detail)`. The guard accepts all four kinds (`STOP_KINDS` in `src/guard.js`), so nothing is BLOCKED.
  The detail is `<KIND> from Graph (HTTP <status>, code <code>)`, with numbers only and no message text.
- AUTH_EXPIRED, CHECKPOINT and ACTION_BLOCKED halt the poller. The halt follows the guard's stop. A halting stop that the
  guard holds halts the poller at the start of each tick, including one saved by an earlier process. Clearing the stop
  with `guard.clearStop(true)` resumes the poller without a restart. While halted, a tick makes no request.
  Ruling: `start()` keeps its timer while halted, so that a cleared stop resumes. Each tick checks the guard.
- RATE_LIMITED sets the stop through the guard. The tick is skipped, the interval doubles up to 10 minutes, and the
  poller does not halt. A clean tick later returns the interval to `poll.intervalMs`, as before.
- Other errors are audited (`poll.list` or `poll.messages`, with the kind), and the poller continues. Unchanged.
- A stop whose save fails is audited (outcome `stop_not_saved`). The guard keeps the stop in memory, so it still applies
  in this process.
- Audit lines carry the kind and the action only: outcome `halted`, `backoff`, `error` or `stop_not_saved`, and detail
  equal to the kind.
- The stop reaches the guard's persisted state through `guard.stop`. Tests read the state file with `createState`, as a
  restart would. Nothing writes the stop state directly.
- Unchanged: dedupe through `events.hasId` before every append; the spacing wrapper; the 20-thread limit; the first page
  only; the reads-only rule (the client exposes `get` only, and no `retryPost`); a conversation with no updated time is
  not read as changed; a `created_time` that does not parse is skipped and audited.
- Files changed in this round: `src/poller.js` and `test/poller.test.js`. `src/guard.js`, `src/graph/client.js`,
  `src/config.js`, `src/errors.js`, `src/events.js` and `src/graph/endpoints/messaging.js` are not changed.

### Covering tests

- `AUTH_EXPIRED stops the poller and sets the stop state`: the stop kind, the state file, the audit line (kind and action
  only), a later tick makes no request. It runs through `checkHalt`, which the next three tests share.
- `CHECKPOINT stops the poller and sets the stop state`: the same checks, with kind CHECKPOINT.
- `ACTION_BLOCKED stops the poller and sets the stop state`: the same checks, with kind ACTION_BLOCKED.
- `RATE_LIMITED doubles the interval`: the stop is set and saved as RATE_LIMITED; the interval doubles to 120000,
  240000, 480000, then 600000; the poller reads again once the failure clears.
- `a persisted halt holds after a restart`: the CHECKPOINT stop is read from disk, and a restarted poller makes no call.
- `a cleared stop resumes the poller without a restart`: after `guard.clearStop(true)`, the next tick reads the thread.
- `an API_ERROR on the list is audited and the poller goes on`: no stop is set; the next tick succeeds.
- `a created_time that does not parse is skipped and audited`: the bad message is audited as `poll.skip`, and the good
  one is stored.

### TDD evidence

RED, before the change. Command: `node --test test/poller.test.js`. Output: `ℹ tests 25`, `ℹ pass 20`, `ℹ fail 5`. The
five failures were ACTION_BLOCKED, CHECKPOINT, `RATE_LIMITED doubles the interval`, `a cleared stop resumes the poller
without a restart` and `a persisted halt holds after a restart`. The API_ERROR and created_time tests passed before the
change, as they describe behaviour that is kept. Log: `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task11-fix1-red.txt`.

GREEN, after the change. Command: `node --test test/poller.test.js`. Output: `ℹ tests 25`, `ℹ pass 25`, `ℹ fail 0`, exit
0. Log: `...\scratchpad\task11-fix1-green.txt`.

Full suite. Command: `npm test`. Output: `ℹ tests 409`, `ℹ pass 409`, `ℹ fail 0`, exit 0. The 409 is the 403 from round 0
plus six new tests. Log: `...\scratchpad\task11-fix1-npmtest.txt`.

Mutation checks in a scratch copy, the poller tests run after each change:

| Mutation | Result |
|---|---|
| Skip `guard.stop` for CHECKPOINT | 3 failing: CHECKPOINT test, cleared-stop test, persisted-halt test |
| RATE_LIMITED also halts | 1 failing: `RATE_LIMITED doubles the interval` |
| Ignore a halting stop read from the state (no restart halt) | 1 failing: `a persisted halt holds after a restart` |
| Message text in the stop detail | 4 failing: the three halt tests and the cleared-stop test |

The restored copy passes 25 of 25.

### Known consequence (guard behaviour, not changed here)

Superseded by fix round 2 (I-2): the guard now replaces a stored stop with a higher-ranked one. The text below is the
round 1 state, kept for the record.

The guard keeps the first stop it is given (`stop()` returns without replacing an existing stop). If a RATE_LIMITED stop
is stored and a CHECKPOINT then arrives, the poller halts in this process, but the stored kind stays RATE_LIMITED. After
a restart the poller makes one read, and then halts again on the next CHECKPOINT. A fix belongs in the guard. This round
does not change it.

### Self-review

I re-read the changed sections of `src/poller.js`. The stop detail carries no message text (checked by the sentinel
assertions and the mutation). Halting kinds are read from the guard, not held only in memory, so a restart and a
clear both behave. `start()` no longer refuses while halted; the timer keeps checking the guard. No write call or
`retryPost` was added. The dedupe, spacing and thread-limit code paths were not touched.

## Fix round 2 (task review, task-11-review.md: I-1, I-2, I-3, m-1, m-7)

Status: DONE_WITH_CONCERNS

### Changes, with file and line

- **I-1, impossible calendar day (`src/events.js:63-72`, `parseIsoTime`).** The value must match ISO_TIME, and then the day
  must exist in its month (the check is the one `src/messaging.js:173-181` uses). An impossible day gives NaN, so
  `events.append` refuses it. This is the shared path, so the poller and the webhook path both get it. Hours, minutes and
  seconds out of range already give NaN from `Date.parse` (checked: 25:00, 12:61 and :60 are NaN). Only the day rolls.
- **I-2, stop severity (`src/guard.js:25-33` and `:195-202`, `stop()`).** New `STOP_RANK` map: AUTH_EXPIRED, CHECKPOINT and
  ACTION_BLOCKED rank 3; RATE_LIMITED rank 2; STATE_LOST and STATE_CORRUPT rank 1. A kind that is not listed has rank 0.
  The new stop replaces the stored one when there is no stored stop, or when its rank is higher. An equal rank keeps the
  stored record. The replacement takes its own kind, detail and since, and the save is the same as before. The
  `clearStop`, `shouldStop`, `assertNotStopped` and save-failure code are unchanged.
  Ruling on unknown kinds: an unknown kind still records ACTION_BLOCKED when no stop is stored, and it never replaces a
  stored stop. The old code also left a stored stop alone in that case, so this keeps the old behaviour.
- **I-2, poller (`src/poller.js:143-166`, `handleFailure`; `stop_kept` at line 155).** The guard's returned status is read. If the guard keeps a
  different stored kind, the poller writes a `stop_kept` line, with detail `{ observed, stored }` (kinds only). The
  outcome line (`backoff` or `halted`) is written for every observed stop, as before.
- **I-3, page sizes (`src/poller.js:30-33` constants; `:223-236` list; `:251-258` message read).** The conversations list
  asks for `limit: 100` (`CONVERSATION_PAGE`). `conversationMessages` is not changed: `src/graph/endpoints/messaging.js:13-15`
  caps the message limit at 20, and `limit: 100` would throw VALIDATION. The default 20 stays, so `MESSAGE_PAGE = 20`.
  A full list (100 rows) writes a `truncated` line with detail `{ returned, limit }`. A full message page (20 messages)
  writes a `truncated` line with the conversation id as target and the same detail shape. The thread is still marked
  read, as before.
- **m-1, no created_time (`src/poller.js`, `storeMessages`).** A message whose `created_time` is not text with content is
  skipped and audited as `poll.skip` (detail `VALIDATION`), before the append. Superseded by fix round 3: the endpoint
  now gives an absent or blank `created_time` as null (`messaging.js`, `timeOrNull`), so the poller's check does skip
  an absent field, and the rest of the thread is read. The round 2 note that the thread fails is no longer true.
- **m-7, test gaps.** The stop_not_saved branch and a stored STATE_LOST stop are tested (see below).
- **Corrected report lines.** The first-page bullet in Known limits (old text: "the older ones wait", and "the older ones
  are never read") is replaced. The thread case is now stated correctly: a message beyond the first 20 is never read,
  and a conversation beyond the first 100 is not returned. The old text for the round 1 "known consequence" is marked
  superseded.

### Test changed (old and new assertion)

- `test/guard.test.js`, the test that pinned the first-kept rule (old name: "the first stop is kept: a later stop does
  not replace its kind"). It is now "a stop of higher severity replaces the stored kind".
  - Old assertion: `assert.equal(guard.stopStatus().kind, 'RATE_LIMITED');`
  - New assertion: `assert.equal(guard.stopStatus().kind, 'AUTH_EXPIRED');`
  - Reason: AUTH_EXPIRED ranks higher than RATE_LIMITED, so it replaces it.

No other existing test was changed. The poller test file's test for the fake Graph now records the list query and a
`before` hook. These are helpers, not assertions.

### Covering tests (new)

- `test/events.test.js`: `append refuses a calendar day that does not exist, and accepts a leap day`. It refuses
  2026-02-30, 2026-09-31 and 2026-02-29 (2026 is not a leap year), and it accepts 2028-02-29 with the clock moved to 2028.
- `test/guard.test.js`:
  - `a CHECKPOINT after a stored RATE_LIMITED replaces it, and the replacement survives a reload`
  - `a RATE_LIMITED after a stored CHECKPOINT does not replace it`
  - `an equal rank keeps the stored record, with its detail and since`
  - `an unknown kind never replaces a stored stop`
  - `a replacement whose save fails still stops this process, and is saved on the next call`
- `test/poller.test.js`:
  - `a full conversation page writes a truncated audit line` (also checks the list asks for 100)
  - `a full message page writes a truncated audit line`
  - `an impossible calendar day in created_time is skipped and audited, and nothing is stored`
  - `a message without created_time is not stored, and is audited`
  - `a blank created_time is skipped and audited as poll.skip`
  - `a CHECKPOINT observed over a stored RATE_LIMITED replaces it, and the owner clear removes it`. Ruling: the brief's
    wording was "clear the stop, and check that the guard reports stopped with CHECKPOINT". A confirmed clear removes
    every stop, so that cannot hold literally. The test reads it this way: a preview clear (`clearStop(false)`) leaves
    CHECKPOINT in place, and the confirmed clear (`clearStop(true)`) removes it.
  - `a RATE_LIMITED observed under a stored CHECKPOINT is audited and does not replace it`. Another caller stores a
    CHECKPOINT during the tick, through a hook before the thread read. Then the older thread fails with RATE_LIMITED.
  - `a stop that cannot be saved still halts this process and is audited` (m-7, the stop_not_saved branch)
  - `a stored STATE_LOST stop does not halt reads` (m-7)

### Commands and output

Covering files, after the test mistakes were corrected. Command: `node --test test/poller.test.js test/guard.test.js
test/events.test.js`. Output: `ℹ tests 94`, `ℹ pass 94`, `ℹ fail 0`, exit 0.

Two of my new tests failed on the first run, and both mistakes were in the tests, not the code. The leap-day case needed
the event-log clock moved to 2028, because the test clock is in 2026. The audit order is `stop_kept` and then
`backoff`, as the code writes it, and the test now expects that order.

Full suite. Command: `npm test`. Output: `ℹ tests 424`, `ℹ pass 424`, `ℹ fail 0`, exit 0. The 424 is the 409 from fix
round 1 plus 15 new tests (1 events, 9 poller, 5 guard). The log is at
`D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task11-fix2-npmtest.txt`.

### Mutation checks (scratch copies, the covering files run after each change)

| Mutation | Result |
|---|---|
| Remove the day check in events.js | 2 failing (events leap-day test; poller impossible-day test) |
| Restore the first-kept rule in guard.js | 5 failing (the severity tests, the save-failure replacement test, and the renamed test) |
| Remove the `limit: 100` on the list | 1 failing (full conversation page) |
| Remove the list truncated audit | 1 failing (full conversation page) |
| Remove the message truncated audit | 1 failing (full message page) |
| Remove the stop_kept audit | 1 failing (RATE under CHECKPOINT) |
| Remove the stop_not_saved audit | 1 failing (stop that cannot be saved) |
| Stop calls for RATE_LIMITED skipped | 3 failing |
| Remove the blank created_time check | 0 failing (see below) |

The blank-time check is redundant. `events.append` already refuses a blank time, because it is not ISO, so the poller's
explicit check produces the same `poll.skip` line. The test passes without the check, and it checks behaviour, not the
branch. The check stays as defence in depth.

### Concerns and rulings

- The guard's rule now lets a stored stop move up in severity. A stop of a higher kind is saved, and an owner's
  `ig_stop_clear` removes it. The severity rule is the coordinator's ruling, and `src/guard.js` changed on purpose.
- A message beyond the first 20 of a thread is still never read. The endpoint does not page, so the fix can only audit
  it. The poller cannot recover it.
- Superseded by fix round 3 (m-3, closed): a message without `created_time` no longer fails its thread. It is skipped and
  audited, and the rest of the thread is stored.
- Deferred and unchanged, as the coordinator said: m-2, m-3, m-4, m-5, m-6, m-8, m-9, m-10, m-11, m-12, m-13 and m-14.
  m-5 (a halt checked only at the start of a tick) is still open.

## Fix round 3 (coordinator: a missing time silenced whole reads; m-2 and m-3 closed)

Status: DONE_WITH_CONCERNS

### Cause

`src/graph/endpoints/messaging.js` called `requiredString` on `created_time` (message) and `updated_time`
(conversation). One message with no `created_time` failed its whole thread every tick, and one conversation with no
`updated_time` failed the whole list. Both silenced reads for as long as the field stayed absent.

### Changes, with file and line

- **Endpoint helper (`src/graph/endpoints/messaging.js:66-73`, `timeOrNull`).** An absent value (undefined or null), or a
  string that is blank after trimming, gives null. Any other value goes to `requiredString` as before, so a present value
  that is not text (for example a number) is still refused with `API_ERROR`. This is the rule the coordinator set: do not
  guess a time.
- **Conversation (`messaging.js:91-95`, `normaliseConversation`).** `updatedTime` uses `timeOrNull` (line 94). A
  conversation with no updated time comes back with `updatedTime: null`. The stale comment on `conversationsList`
  (around line 122) now says so.
- **Message (`messaging.js:100-106`, `normaliseMessage`).** `createdTime` uses `timeOrNull` (line 104). The other fields
  keep `requiredString`, and `requiredString` is not changed for any field.
- **Poller, conversations (`src/poller.js:237-243`).** Before the changed-thread filter, each conversation with no usable
  `updatedTime` is audited: `{ action: 'poll.skip', target: <conversation id>, outcome: 'skipped', detail: 'VALIDATION' }`.
- **Poller, change test (`src/poller.js:244-249`).** The filter already required `hasTime(updatedTime)` before comparing
  with the stored value. That stays, so null never compares as changed. The test below checks this with a stored value,
  so a regression would show.
- **Poller, messages (`src/poller.js:179-183`, the existing check).** `hasTime(message.createdTime)` now sees null for an
  absent or blank time, and it skips the message with `poll.skip`, detail `VALIDATION`. The comment there is updated.
- **Closed:** m-3 (its cause, a permanent thread failure from an absent `created_time`, is fixed) and m-2 (one conversation
  no longer stops the list).

### Tests changed (old and new assertions)

These tests pinned the old throws. Each one is updated in place, and the old assertion is shown.

1. `test/endpoints-messaging.test.js`: `conversationsList refuses a row without an id or an updated time` is now
   `conversationsList refuses a row without an id, and gives a row without an updated time a null updatedTime`.
   - Old assertion (removed): `await assert.rejects(conversationsList(fakeClient([{ data: [{ id: CONVERSATION }] }]),
     { igUserId: IG_USER }), { kind: 'API_ERROR' });`
   - New assertion: `const result = await conversationsList(fakeClient([{ data: [{ id: CONVERSATION }] }]),
     { igUserId: IG_USER }); assert.deepEqual(result, [{ id: CONVERSATION, updatedTime: null }]);`
   - The no-id and not-an-array assertions are unchanged.
2. `test/poller.test.js`: `a conversation without an updated time is not read as changed` is now
   `a conversation with null updatedTime is not read, is audited, and the other conversations are read`.
   - Old assertions (removed): `result.status === 'error'`; `graph.reads` equal `[LIST]`; the last audit line is
     `poll.list` with detail `API_ERROR`.
   - New assertions: `result.status === 'ok'`; the thread reads are `['t_1']`; the stored value for `t_bad` is unchanged
     (the test first stores one, so the null cannot compare as changed); the delivered ids are `['m_1']`; the audit lines
     are `[['poll.skip', 't_bad', 'skipped', 'VALIDATION']]`.
3. `test/poller.test.js`: `a message without created_time is not stored, and is audited` is now
   `a thread with one message lacking created_time stores the other messages, and audits the skipped one`.
   - Old assertions (removed): `result.errors === 1`; no event stored; the audit line is `poll.messages`, target `t_1`,
     detail `API_ERROR`.
   - New assertions: `result.errors === 0`; the stored event ids are `['m_1']`; `poll.seen.t_1` is set; the audit lines
     are `[['poll.skip', 'm_missing', 'skipped', 'VALIDATION']]`.

### New tests

- `test/endpoints-messaging.test.js`:
  - `a list with one conversation lacking updated_time returns the other conversations`. Rows c1, c2 (absent), c3 (blank),
    c4 come back with c2 and c3 as null. A present number is still refused with `API_ERROR`.
  - `a thread with one message lacking created_time returns the other messages, and that one has createdTime null`. m1
    (absent) and m3 (blank) come back with null, and m2 keeps its time. A present number is still refused.
- `test/poller.test.js`: the two tests in item 2 and item 3 above, which carry the new assertions.

Test-file count: 426 = 424 (round 2) + 2 new endpoint tests. Renamed and updated tests are not counted.

### Commands and output

Covering files. Command: `node --test test/endpoints-messaging.test.js test/poller.test.js`. Output: `ℹ tests 61`,
`ℹ pass 61`, `ℹ fail 0`, exit 0.

Full suite. Command: `npm test`. Output: `ℹ tests 426`, `ℹ pass 426`, `ℹ fail 0`, exit 0. Log:
`D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task11-fix3-npmtest.txt`.

### Mutation checks (scratch copies, the covering files run after each change)

| Mutation | Result |
|---|---|
| Remove the null-conversation audit | 1 failing (null updatedTime test) |
| Remove the `hasTime` guard in the change filter | 1 failing (null updatedTime test, the stored value is then compared with null) |
| Conversation back to `requiredString` | 3 failing (the two endpoint tests and the null updatedTime test) |
| Message back to `requiredString` | 2 failing (the two message tests) |
| Remove the poller's message time check | 0 failing (see below) |

The message time check is still redundant with `events.append`. `events.append` refuses a null `receivedAt` with
`VALIDATION`, so the same `poll.skip` line is written either way. The check stays, as defence in depth.

### Concerns

- A present `created_time` or `updated_time` that is not text (for example, a Unix number) still fails its whole read.
  This is m-8, which stays deferred. The live phase must confirm the format before Task 13.
- Conversations with a null updated time are audited on every tick until Graph gives them one, so the audit file grows
  while the condition lasts (the audit growth in m-11).
- The message time check is redundant with the event log, as above.

### Deferred, unchanged

m-4, m-5, m-6, m-8, m-9, m-10 (resolved in part: the page size is now 100, which is the list maximum), m-11, m-12, m-13
and m-14. m-2 and m-3 are closed by this round.

## Fix round 4 (task-11-rereview-23.md: N-1, N-2, O-3)

Status: DONE_WITH_CONCERNS

### Changes, with file and line

- **N-1, the calendar check covers both bounds, in one shared helper.** The check is in a new module, `src/calendar.js`
  (line 7, `isRealDate(year, month, day)`). It requires the month to be an integer from 1 to 12, and the day to be an
  integer from 1 to the length of that month. February 29 counts only in a leap year (the length comes from
  `Date.UTC(year, month, 0)`, as before, so year 0000 is still refused, which is the Task 8 ruling). The helper is in its
  own module, not exported from `src/events.js`, because `messaging.js` should not depend on the event log, its state
  and its file handling. This is the only new source file this round.
  - `src/events.js:15` imports `isRealDate`. `parseIsoTime` (line 66) calls it at line 69, before `Date.parse`.
  - `src/graph/endpoints/messaging.js:6` imports it. `parseTime` calls it at line 192, before `Date.parse`.
  - The two former copies of the upper-bound check are gone. Only the helper has the rule now.
- **N-2, the audit names the kind the guard holds (`src/poller.js:143-158`, `handleFailure`).** The poller records whether
  the stop call saved (`saved`). It then reads `guard.stopStatus().kind` (`held`, line 155). A failed save is audited
  with `held` as its detail (line 156), and the `stop_kept` check compares `held` with the observed kind (line 158). On the
  success path, `held` is the same value that `guard.stop` returned before, so nothing else changes.
- **O-3, stale report text.** The live-format bullet (report lines 138-144) is corrected to the code as it stands. The
  round 0 self-review bullets at report lines 164-168 are marked superseded.

### The coordinator's N-2 example, and why the test uses the closest case

The brief asked for this test: store an unsaved RATE_LIMITED stop, observe CHECKPOINT, make the save fail, and check that
the audit line names RATE_LIMITED. The severity rule (round 2, I-2) makes that impossible. CHECKPOINT ranks higher, so it
replaces the unsaved RATE_LIMITED in memory before any save. The save that then fails is the save of CHECKPOINT, so the
audit must name CHECKPOINT. The code names the kind the guard holds, which is the kind that was saved. The first new test
below is the coordinator's scenario, with the expected name corrected to CHECKPOINT. The second test is the case that
names a stored kind that differs from the observed kind (the N-2 case proper).

### Tests changed (old and new assertions)

No existing test was changed in this round. All new tests are listed below.

### Covering tests (new)

- `test/calendar.test.js` (new file, 4 tests): `isRealDate` refuses a day of 00 and a day past the end of its month;
  refuses a month outside 1 to 12; allows 29 February only in a leap year (2000 yes, 1900 no, 2026 no, 2028 yes); refuses
  values that are not whole numbers. These test the lower bounds directly, without `Date.parse`.
- `test/events.test.js`: `append refuses a day of 00, a month outside 1 to 12, and a day past the end of its month`. It
  refuses 2026-02-00, 2026-00-15, 2026-13-15, 2026-04-31 and 2026-02-29, stores nothing, and accepts 2028-02-29 with the
  clock moved to 2028.
- `test/endpoints-messaging.test.js`: `a month outside 1 to 12, or a day of 00, is refused as not a real calendar date;
  2028-02-29 is accepted`. It goes through `messageWindowOpen`, and it checks the message text, so the calendar check
  (not `Date.parse`) is what refuses the value.
- `test/poller.test.js`:
  - `a failed save is named by the kind the guard holds, and the in-process halt holds`. An unsaved RATE_LIMITED is held,
    CHECKPOINT is observed, and the save fails. The audit names CHECKPOINT for the save, and the next tick makes no call.
  - `a failed save of a stored stop is named by its kind when a different kind was observed`. CHECKPOINT is stored unsaved
    by another caller during the tick, RATE_LIMITED is observed, and the save fails. The audit names the stored CHECKPOINT
    for the failed save, then `stop_kept` names both kinds, then the backoff line. The next tick is halted.

### Commands and output

Covering files. Command: `node --test test/calendar.test.js test/endpoints-messaging.test.js test/events.test.js
test/poller.test.js`. Output: `ℹ tests 98`, `ℹ pass 98`, `ℹ fail 0`, exit 0.

Full suite. Command: `npm test`. Output: `ℹ tests 434`, `ℹ pass 434`, `ℹ fail 0`, exit 0. The 434 is the 426 from round 3
plus 8 new tests (4 calendar, 1 events, 1 messaging, 2 poller). Log:
`D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task11-fix4-npmtest.txt`.

### Mutation checks (scratch copies, the covering files run after each change)

| Mutation | Result |
|---|---|
| Remove the month lower bound (`month < 1`) | 2 failing (calendar month test; the messaging calendar test) |
| Remove the day lower bound (`day < 1`) | 3 failing (calendar day test, whole-number test, messaging calendar test) |
| Remove the month upper bound (`month > 12`) | 2 failing (calendar month test; messaging calendar test) |
| Remove the day upper bound | 9 failing (leap-year, window, poller, and calendar tests) |
| Remove the messaging calendar check | 4 failing (messaging tests) |
| Name the observed kind in the stop_not_saved line | 1 failing (the second N-2 test) |

The first mutation list checks the helper directly. The events-log test passes with the lower bound removed, because
`Date.parse` refuses those forms on Node 24 and the event log refuses the NaN. This is why the direct helper test exists.

### Concerns

- The brief's N-2 example cannot hold under the severity rule. The test uses CHECKPOINT, the kind the guard holds (see
  above). Ruling needed on whether the example should be dropped from the brief.
- The helper is a new file (`src/calendar.js`), not an export from `src/events.js`. This is the only new source file
  this round.
- `src/token.js` (line 25) uses a round-trip check (`toISOString() === value`), so it refuses every impossible date and
  needs no change. It is not in the two places named, and it was not changed.

## P4 (2026-10-22): poller, state, events, audit, webhooks (owner decision O-3; items A-4 to A-30 of the work package)

Status: DONE_WITH_CONCERNS. npm test: 935/935 pass, exit 0 (912 before P4).

### Scope

Files changed: `src/poller.js` (rewritten), `src/events.js`, `src/audit.js` (rewritten), `src/state.js`, `src/guard.js` (startup path only), `src/webhooks.js`, and their tests. No new file in `src/` or `test/`. `src/service.js`, `src/graph/*`, `src/oauth.js`, `src/cli.js` and `src/http.js` are byte-identical to their pre-P4 copies (checked). No call-site change was needed in `src/cli.js`: `createPoller`, `createEventLog`, `createAudit` and `createState` keep their argument names, and each new option has a default.

### Changes, with file and line

1. **O-3, a damaged state starts stopped.**
   - `src/state.js:105` `cursorsDamaged`: an `events.issued`, `events.acked` or `events.lastSeq` that is not a whole number, or an acked above the issued, is damage. `src/state.js:115` `corruptStop` builds the STATE_CORRUPT record. In `createState` (from line 120), damaged cursors are copied aside (`movedAside`), the three keys are removed so the event log can start, and a STATE_CORRUPT stop is written when no stop is stored. A stored stop is kept.
   - `src/guard.js:152-166`: a stored stop that cannot be read back no longer throws. The guard starts stopped with STATE_CORRUPT, and `retrySave()` (line 192) saves it. Only `ig_stop_clear` with confirm true clears it.
   - The poller already halts under STATE_CORRUPT and STATE_LOST (`HALTING` in `src/poller.js`), so no change there.
2. **A-4, audit reads (`src/audit.js:54-97`).** `readTail` streams each file in chunks of `chunkBytes` (default 64 KB) and keeps the last n entries. A line that does not parse, or is not a JSON object, is skipped and counted. `readCounted` (line 99) reads the newest file first, then the rotations, only as far as the limit needs, and returns `{ entries, skipped }`. `read()` (line 139) keeps its old shape for callers.
3. **A-6, 90-day dedupe window (`src/events.js:26` `DEDUPE_DAYS = 90`; `pruneKnown` line 357; `hasKey` line 371; `append` line 379).** A purged event's key stays known for 90 days from when it was received. A redelivery in that window is refused by `hasId`, and `append` refuses it too (VALIDATION). After 90 days the key is pruned, and the id is new again. The limit is stated in the header comment of `src/events.js`.
4. **A-9, in-memory index (`src/events.js:295` `loadIndex`, `:316` `writeIndex`, `:459` `hasId`).** The index file `event-ids.jsonl` in the data directory is read once, at construction. `hasId` reads memory only. `append` records the key in memory, then appends a line to the index after the event is on disk. Damaged index lines are skipped and counted, not refused.
5. **A-22, kind-qualified dedupe (`src/events.js` `keyOf`; `append`; `hasId(id, kind)` at line 459).** The key is kind plus id, and `hasId` now needs a kind. `decide` refuses an id that more than one stored event has (line 433).
6. **A-24, failing-thread backoff (`src/poller.js:230` `noteThreadFailure`; the selection in `runTick`).** After a thread fails, it is retried after 1, 2, 4 ... ticks, up to 32. A clean read clears the backoff. It is kept in memory, so a restart starts it again.
7. **A-26, future-stamped messages (`src/poller.js:254` `futureHold`, `:271` `clearFuture`, `:280` `storeMessages`).** A message more than `MAX_FUTURE_MS` (exported from `src/events.js:24`) ahead of the clock is held: it is not stored, and its thread is not marked read, so the thread is read again on the next tick. The first sighting is kept in the state (`poll.future.<id>`). After 24 hours it is audited as `poll.skip` with detail `future-time`, and the record is kept with `dropped: true`, so the drop is not repeated.
8. **A-28, growth (`src/poller.js:339` `stampAndPrune`; `src/audit.js:42` `rotateIfFull`).** Each tick stamps `poll.listed.<id>`. A conversation not listed for 30 days loses its seen value, its listed time and its cursor. Future records older than 30 days are removed. The audit file rotates to `file.1` at `rotateBytes` (default 50 MB), and only `keepRotations` (default 10) are kept.
9. **A-5, wrapped file errors (`src/events.js:51` `io`).** A raw error from the event file or the index becomes an `IgError` with kind `CONFIG`. The message names the operation and the code, for example `the event file could not be appended to (EACCES)`, and no path.
10. **A-7, fsync (`src/events.js:211` `appendText`).** The order is open, write, fsync, close. The test records that order through an injected file system.
11. **A-23, closed request (`src/webhooks.js:327`).** `readRawBody` refuses a request that is destroyed, has ended, or is closed, with an error, rather than waiting for an event that will not come.
12. **A-29, interval reset (`src/poller.js:464` in `runTick`; `finish` at line 469 only reports).** The clean-tick reset moved from `finish` into `runTick`. The behaviour is unchanged.
13. **P3 readers and skipped messages (`src/poller.js:368` `readConversations`; `:419` `readThread`).** Conversations come from `readConversations` (`limit: 100`, and the reader's default page bounds). Messages come from `readThread` (the messages edge; `threadMaxItems`, default 1000). A malformed message is counted by the reader (`skippedMessages`), and the poller audits it as `poll.messages`, outcome `skipped`, detail `{ kind, count }`. The thread's other messages are stored. A list that stops early is audited as `poll.list`, outcome `truncated`, with the reader's reason and the count.
14. **Webhook times (`src/webhooks.js:54` `unixMsOf`, `:61` `webhookTimeIso`).** A messaging `timestamp`, an entry `time`, and a comment's or mention's `created_time` accept the same forms as P3: ISO with a zone (Z, +hh:mm or +hhmm), Unix seconds, Unix milliseconds, and numeric strings. An impossible day, zero, a negative number and text are unknown, not guessed.
15. **Kept.** The halt set, the owner-message and echo skips, the stop wiring and the `hasId` dedupe path behave as before. Their existing tests pass unchanged.

Extra, not in the package: **A-30, continuation.** A thread with more messages than one read takes keeps a cursor (`poll.after.<id>`), and the next tick continues from it. The thread is not marked read until the cursor is done. A cursor that fails to read is dropped, so the next read starts from the newest message. Without this, a read limit would lose the older messages silently.

### Changed tests (old and new assertion)

Each is a deliberate change to the new behaviour, not a weakened check.

- `test/events.test.js`, every `hasId(id)` call (lines 133, 188, 189, 223 to 226, 238, 292, 316): old `log.hasId('m1')`; new `log.hasId('m1', 'message')`. The kind is now required (A-22).
- `test/events.test.js`, `purge removes only handled events older than retentionDays`: old `assert.equal(log.hasId('old-decided', 'message'), false)`; new `assert.equal(log.hasId('old-decided', 'message'), true)` (A-6: known for 90 days after receipt).
- `test/events.test.js`, `purge keeps a decided old event until it is acknowledged`: old `assert.equal(log.hasId('m1', 'message'), false)`; new `true` (A-6).
- `test/webhooks.test.js`, `an owner message is not stored and is audited`: old `events.hasId('m-own')`; new `events.hasId('m-own', 'message')` (signature only).
- `test/guard.test.js`, `a malformed stop record in the state file is refused at startup`: renamed `... starts the guard stopped with STATE_CORRUPT (O-3)`. Old `assert.throws(() => guardOver(state, file), kind CONFIG)`. New: `stopStatus()` is `[true, 'STATE_CORRUPT']`, `assertNotStopped()` throws STOPPED, and a restart keeps STATE_CORRUPT.
- `test/cli.test.js`, `a stop whose time cannot be read back ...`: renamed `... starts the service stopped with STATE_CORRUPT (O-3)`. Old `assert.rejects(buildServe(...), kind CONFIG)`. New: the build resolves, `guard.stopStatus()` is stopped with STATE_CORRUPT, and `assertNotStopped()` throws STOPPED.
- `test/poller.test.js`. The fake Graph (`fakeGraph`) now serves the messages edge `<id>/messages` with offset paging and `paging.next`. The helper `threads(reads)` gives the thread ids of those reads. `buildWith`'s dummy state gained `delete` and `keys`, and `setup` takes `threadMaxItems`. These are helper changes; the assertions below use them.
  - `poll dedupes on message id across ticks`: old `graph.reads.filter(p => p === 't_1').length === 2`; new `threads(graph.reads).filter(id => id === 't_1').length === 2`.
  - `calls are spaced by poll.spacingMs`: old `graph.log` deepEqual eight entries (the list, then `get t_1`, `get m_1`, `get m_2`, each after a 900 ms sleep); new `['sleep 900', 'get <LIST>', 'sleep 900', 'get t_1/messages']`. Both messages come in one page.
  - `maxThreadsPerTick is honoured`: old `graph.reads.filter(p => p.startsWith('t_'))` deepEqual `['t_c', 't_b']`; new `threads(graph.reads)` deepEqual `['t_c', 't_b']`.
  - `RATE_LIMITED doubles the interval`: old `graph.reads.slice(-2)` deepEqual `['t_1', 'm_1']`; new `[LIST, 't_1/messages']`.
  - `a cleared stop resumes the poller without a restart`: old `graph.reads.slice(-3)` deepEqual `[LIST, 't_1', 'm_1']`; new `slice(-2)` deepEqual `[LIST, 't_1/messages']`.
  - `a created_time that does not parse is skipped and audited`: old value `'1792583940'` (Unix seconds, which P3 now accepts), expected audit `poll.skip m_bad VALIDATION`; new value `'not a time'`, expected audit `poll.messages t_1 skipped {kind: 'API_ERROR', count: 1}`, and the other message is delivered.
  - `a conversation with null updatedTime is not read ...`: old `graph.reads.filter(p => p.startsWith('t_'))` deepEqual `['t_1']`; new `threads(graph.reads)` deepEqual `['t_1']`.
  - `only the first page of messages is read: 20 of a thread of 25`: renamed `a thread of 25 is read in one request, and all 25 are stored`. Old stored events `ids.slice(0, 20)`; new all 25 ids.
  - `a message the event log refuses is audited and skipped; the rest are stored`: replaced. Old assertion: a message stamped 10 minutes ahead is audited at once as `poll.skip VALIDATION`, and the thread is marked read. Under A-26 it is held, so three tests replace it (listed below).
  - `a full conversation page writes a truncated audit line`: renamed `a full page of conversations with no more pages is not truncated`. Old audit `[['poll.list', 'truncated', {returned: 100, limit: 100}]]`; new audit `[]`.
  - `a full message page writes a truncated audit line`: replaced by `a thread longer than one read is continued from its cursor on the next tick`. Old audit `[['poll.messages', 't_1', 'truncated', {returned: 20, limit: 20}]]`; new: the truncation is audited with the reader's reason, the cursor is kept, and the next tick finishes the thread.
  - `an impossible calendar day in created_time is skipped and audited, and nothing is stored`: old audit `[['poll.skip', 'm_feb', 'skipped', 'VALIDATION']]`; new `[['poll.messages', 't_1', 'skipped', {kind: 'API_ERROR', count: 1}]]`. The reader refuses the impossible day as malformed, so the skip is counted there.

### New tests

- `test/events.test.js`: `a purged event redelivered after 31 days is not stored again; after 91 days it is treated as new` (A-6); `hasId does not read the event file on each call` (A-9); `a comment and a mention with the same id are both stored, once each` (A-22); `a file-system error from the event file becomes an IgError that names the operation, not the path` (A-5); `append calls fsync before it returns` (A-7); `a damaged line of the dedupe index is skipped, and the other keys are kept`.
- `test/audit.test.js`: `a non-object JSON line is skipped and counted, and the objects are kept` (A-4); `a large audit file is read in chunks, and the last entries are the right ones` (A-4); `an audit file at the rotation size rotates to file.1 before the next line is written` (A-28); `only the last ten rotations are kept` (A-28); `an audit file over 50 MB rotates at the default size` (A-28).
- `test/state.test.js`: `keys lists the keys with a prefix, and delete removes a key on save`; `damaged event cursors are copied aside, removed, and a STATE_CORRUPT stop is stored` (O-3); `a text cursor is damage, and a stored stop is kept when the cursors are repaired` (O-3).
- `test/webhooks.test.js`: `a webhook time is read in each accepted form, and a value that is not a time is unknown` (item 14); `a comment and a mention with the same id are both stored once each` (A-22, at the handler); `readRawBody refuses a request that has ended, or is destroyed or closed, without waiting` (A-23, with a 5 s timeout, so a regression fails rather than hangs).
- `test/poller.test.js`: `a message stamped more than five minutes ahead is held, and its thread is read again on the next tick` (A-26); `a held message is stored once its time is within the allowance` (A-26); `a message still ahead of the clock after 24 hours is audited as future-time and dropped from the retry` (A-26); `a conversation list with more pages than the read takes is audited as truncated` (P3 paging); `a thread longer than one read is continued from its cursor on the next tick` (A-30); `a failing thread does not take every slot across ticks` (A-24); `a poll.seen entry older than 30 days is pruned` (A-28); `a damaged state file starts stopped with STATE_CORRUPT, and the poller makes no request` (O-3, item 1).
- Item 13 (a malformed message is skipped and counted, the others stored) is covered by `a created_time that does not parse is skipped and audited`. Item 12 (the backoff returns to the normal interval after a clean tick) is covered by `RATE_LIMITED doubles the interval`, which checks that the clean tick returns to `poll.intervalMs`.

### Commands and output

Full suite after the last change. Command: `npm test` (`node --test test/*.test.js`). Output: `ℹ tests 935`, `ℹ pass 935`, `ℹ fail 0`, exit 0. The 935 is the 912 before P4 plus the net new tests above.

### Mutation checks (scratch copies, the relevant test files after each change)

| Mutation | Result |
|---|---|
| Remove the fsync call (A-7) | 1 failing: `append calls fsync before it returns` |
| `hasId` reads the event file (A-9) | 1 failing: `hasId does not read the event file on each call` |
| Dedupe key is the id only, not kind and id (A-22) | 3 failing: the events and the index tests |
| Failing-thread backoff removed (A-24) | 1 failing: `a failing thread does not take every slot across ticks` |
| Future-stamped messages not held (A-26) | 3 failing: the three held-message tests |
| Pruning of stale state removed (A-28) | 1 failing: `a poll.seen entry older than 30 days is pruned` |
| Rotation removed (A-28) | 3 failing: the rotation tests |
| Dedupe window 90 days changed to 30 (A-6) | 1 failing: the 31-day and 91-day test |
| Cursor continuation removed (A-30) | 1 failing: `a thread longer than one read is continued from its cursor on the next tick` |
| Closed-request check removed (A-23) | 1 failing, by timeout. Before the 5 s timeout was added, the run hung for over 200 s. |
| Unreadable stop refused rather than starting stopped (O-3), a real mutant | 1 failing guard test; the CLI test file fails too |

The first start-stopped mutation changed nothing (a no-op) and reported 0 failing; it was replaced by the real mutant above.

### Concerns and decisions

- **A held thread can starve the others.** A thread holding a future-stamped message is read on every tick until the message is dropped (up to 24 hours). With `maxThreadsPerTick` of 1 it takes the only slot. Not fixed in P4; the default of 20 makes it much smaller.
- **Repaired cursors redeliver acked events.** After a damaged cursor is removed, `pending` starts again from zero. Events are not stored twice, but the consumer sees them again (the Task 4 carry-forward; consumers dedupe by id).
- **Rank rule and damaged cursors.** A damaged cursor file that holds a stored RATE_LIMITED stop keeps RATE_LIMITED (rank 2 beats STATE_CORRUPT's rank 1), so the damage does not halt the poller in that case. The rank table is unchanged.
- **Dedupe index damage.** A damaged index line is skipped. If it was the only record of a key purged within 90 days, one redelivery of that event could be stored again.
- **`decide` and a shared id.** An id that a comment and a mention share cannot be decided (VALIDATION). The owner's tool would need a kind for this case; not implemented.
- **Duplicate time parser.** `webhookTimeIso` (`src/webhooks.js`) duplicates P3's `graphTimeIso` (`src/graph/endpoints/messaging.js`), which I may not change. Merge them in the final review.
- **Failing-thread backoff is in memory.** A restart clears it, so a bad thread gets its first retry straight after a restart.
- **Node 22 not run.** The suite ran on Node v24.6.0 only (carry-forward to Task 18).

### P4 fix round (coordinator: three items, plus the persisted backoff)

Status: DONE. npm test: 938/938 pass, exit 0 (935 before this round). Accepted as designed by the coordinator: concern 2 (RATE_LIMITED is a back-off for the poller and a persisted stop for outbound). Not done, as instructed: concern 3 (the duplicated time parser, which moves to the cleanup package).

### Changes, with file and line

1. **Selection slot (item 1, concern 1) (`src/poller.js`).** A thread that holds a future-stamped message is deferred, and it does not take a selection slot.
   - `src/poller.js:483` `runTick` selects in two phases. The normal threads are read newest first, and each read that is not held takes a slot (line 544, `if (!step.held) slots -= 1`). The deferred threads (those with a `poll.deferred.<id>` mark, lines 535 and 536) are read after them, on every tick, and they take no slot.
   - `src/poller.js:416` `readThreadOnce` commits the deferral: when the thread holds a message, it writes `poll.deferred.<id>` and does not write the seen value. When the thread is clean, the mark is removed.
   - The retry continues until the message is within tolerance (stored, and the mark removed) or dropped after 24 hours (the existing future-time rule).
2. **Damaged dedupe index (item 2, concern 4) (`src/events.js`, `src/poller.js`).**
   - `src/events.js:307` `loadIndex` now returns one flag, `damaged`, which is set for a line that is not a key line and for a torn last line.
   - `src/events.js:329` `quarantineName` picks a numbered name (`event-ids.jsonl.corrupt`, then `.corrupt.1`, and so on).
   - `src/events.js:370` the notices list, and `:377` the damaged branch. The index is renamed to the quarantined name, the known ids are rebuilt from the event file only, and a notice is queued: action `events.index`, outcome `rebuilt`, detail `{ reason, keys, quarantined, note }`. The note says that ids older than the event file are not known.
   - `src/events.js:564` `takeNotices` returns the queued notices once. The event log has no audit writer, so the poller writes them: `src/poller.js:276` `drainNotices` runs at the start of every tick (`src/poller.js:562`, before the halt check), so the line is written even while the poller is halted. `src/cli.js` is unchanged.
3. **Kind-qualified stored ids (item 3, concern 3) (`src/events.js`).**
   - `src/events.js:39` `QUALIFIED_KINDS` (comment, mention, unknown), `:40` `storedIdOf`, `:43` `rawIdOf`. A comment or mention is stored as `comment:<id>` or `mention:<id>`. A message keeps its raw id, so the message tests and the message ids are unchanged. An event stored before the prefix is read as it is.
   - `src/events.js:438` `append` stores the qualified id. The duplicate check and the dedupe key use the raw id (`rawIdOf`), so the dedupe is the same as before.
   - `src/events.js:492` `decide` matches the stored id exactly. Two events of one kind and raw id cannot exist now, so an ambiguous match only happens for old events, and it is still refused.
   - The cursor format and `eventsAck` are unchanged. They work on the seq.
4. **Backoff survives a restart (`src/poller.js`).** The in-memory backoff map is gone.
   - `src/poller.js:30-32` the keys `poll.tick`, `poll.backoff.<id>` and `poll.deferred.<id>`. `:107-108` their key builders.
   - `src/poller.js:237` `backoffOf`, `:243` `retryTickOf`, `:249` `noteThreadFailure` (the record is written, then the state is saved), `:257` `clearBackoff`, `:264` `isDeferred`, `:269` `persistedTick`.
   - `src/poller.js:484` the tick number is read from the state, so a retry tick means the same tick after a restart. The number is written with the next save of the state, not with a save of its own. A separate save would throw before the list is read, and that changes the blocked-save tests.
   - `src/poller.js:401` a backoff or a deferral for an unlisted conversation is removed with it. The conversation's removal (`removeConversation`) also removes both.

### Changed tests (old and new assertion)

- `test/events.test.js`, the test for a comment and a mention with the same id (`a comment and a mention with the same id are both stored, once each`): removed, and replaced by `a comment and a mention with the same raw id are two events with distinct ids, and decide on one does not change the other`. Old assertions: the two stored ids were `x1` and `x1`, and `decide('x1')` was refused as ambiguous. New assertions: the ids are `comment:x1` and `mention:x1`; a duplicate comment is refused; `decide('x1')` is refused as matching no event; `decide('comment:x1')` changes only the comment (its status is `handled`, the mention stays `new`).
- `test/events.test.js`, the damaged-index test (`a damaged line of the dedupe index is skipped, and the other keys are kept`): replaced by `a damaged dedupe index is quarantined and rebuilt from the event file, the rebuild is recorded, and an id still in the event file is refused`. Old assertions: `hasId('kept')` and `hasId('also')` were true, because the damaged line was skipped. New assertions: the damaged file is kept as `event-ids.jsonl.corrupt`; one notice is queued (`events.index`, `rebuilt`, quarantined name, one key); the notice is returned once; `hasId('m1')` is true for an id still in the event file; the append is refused; the rebuilt index has no damaged line.
- `test/webhooks.test.js`, `comments and mentions are stored with their kinds`: old expected ids `c1` and `c2`; new `comment:c1` and `mention:c2`.
- `test/webhooks.test.js`, `a comment and a mention with the same id are both stored once each`: old expected ids `same-1` and `same-1`; new `comment:same-1` and `mention:same-1`.
- `test/events.test.js`: added `dirname` to the `node:path` import, which the new test uses.
- `test/poller.test.js`: the dummy event log in `buildWith` gained `takeNotices`, and `appendFileSync` and `existsSync` were added to the `node:fs` import. Helpers only.

### New tests

- `test/poller.test.js`:
  - `a thread holding a future message does not take the only slot from a second thread` (item 1): with `maxThreadsPerTick` 1, the second thread's normal message is stored in the same tick; the holding thread is deferred; on the next tick it is read after the others; once its message is within the allowance, it is stored and no longer deferred.
  - `a damaged dedupe index causes a rebuild that is audited, and a message still in the event file is not stored again` (item 2): the rebuild is written to the audit log as `events.index`, `rebuilt`, with the quarantined name; the message is not stored again and is not announced again.
  - `a backoff recorded before a restart is still in force after it` (item 4): after a restart, the thread is not read on tick 2 and is retried on tick 3; a clean read clears the backoff.
- `test/events.test.js`: `a comment and a mention with the same raw id are two events with distinct ids, and decide on one does not change the other` (item 3); `a damaged dedupe index is quarantined and rebuilt from the event file, the rebuild is recorded, and an id still in the event file is refused` (item 2).

### Commands and output

Full suite. Command: `npm test` (`node --test test/*.test.js`). Output: `ℹ tests 938`, `ℹ pass 938`, `ℹ fail 0`, exit 0. The 938 is the 935 before the round plus three poller tests, and the event tests come to a net +0 (one replaced, one replaced, and the damaged-index test replaced by the rebuild test).

### Mutation checks (scratch copies, the poller, event and webhook tests after each change)

| Mutation | Result |
|---|---|
| The holding thread takes a slot (item 1) | 1 failing: `a thread holding a future message does not take the only slot from a second thread` |
| The damaged index is trusted, not rebuilt (item 2) | 2 failing: the poller and events rebuild tests |
| The stored id is not kind-qualified (item 3) | 3 failing: the two same-raw-id tests and the webhook kinds test |
| The tick number is not persisted (item 4) | 1 failing: `a backoff recorded before a restart is still in force after it` |

### Concerns and decisions

- **Notices go through the poller.** The event log queues its audit notice, and the poller writes it at the start of each tick. The line is therefore written on the first tick after a start, not at the start itself. `src/cli.js` is not changed (the brief's constraint). If the audit must be written at start, pass the audit log to `createEventLog` in `src/cli.js` as a one-line change.
- **Only comment, mention and unknown ids are qualified.** Message ids are stored as they arrive, so the message ids in the poller and in the owner's tools are unchanged. The coordinator's example named comment and mention only.
- **A damaged index is rebuilt from 30 days of ids.** Ids purged more than 30 days before the damage, and still inside the old 90-day window, are not known after the rebuild. The audit notice states this. This is the cost the coordinator asked for.
- **The tick number is saved with the next state save.** A tick that stops before a save does not add to the persisted number. A backoff is written with a save, and that save also writes the tick number, so the persisted number is never behind a stored backoff, and the retry is counted in ticks exactly.
- **Node 22 not run.** The suite ran on Node v24.6.0 only (carry-forward to Task 18).


### P4 review fix round (p4-review.md: I-1 to I-5, and every Minor)

Status: DONE. npm test: 954/954 pass, exit 0 (938 before this round, plus 16 new tests; one existing test was rewritten in place, see Changed tests).

The P4 entries above that describe the damaged-cursor repair (which removed `events.acked` and `events.issued`) and the index rebuild from the event file alone are superseded by this round. Their text is kept for the record; the current behaviour is below.

#### Important findings

**I-1. A STATE_CORRUPT stop replaced by RATE_LIMITED.**
- `src/guard.js:27-34` `STOP_RANK`: STATE_LOST and STATE_CORRUPT rank 4, above RATE_LIMITED (2). A RATE_LIMITED stop no longer replaces them.
- `src/state.js:15` `HALTING_STOPS`, and the repair path in `createState` (`src/state.js:163-222`): a cursor repair sets STATE_CORRUPT over a stored non-halting stop (RATE_LIMITED, or any other stop that is not halting). A stored halting stop is kept. The repair is recorded as a notice whose detail carries `stopReplaced` (`src/state.js:211`), the replaced kind or null.
- Audit: the state has no audit writer, so the notice is drained by the poller (`src/poller.js:284-289` `writeNotice` and `drainNotices`, called at the start of each tick, before the halt check). `src/cli.js` is unchanged.

**I-2. A purged message stored again after 90 days.**
- `src/poller.js:336` `storeMessages` skips a message whose created time is older than `DEDUPE_MS` (`src/poller.js:352-357`), and does not store it. `DEDUPE_MS` is now exported from `src/events.js:32`.
- Audit, a deviation to note: the skip is written once per thread per read, as `poll.skip` with detail `{ reason: 'older-than-window', count }` (`src/poller.js:381-388`), not once per message. A thread's history can be long, and a line per message would be written on every read of the thread (up to 1000 lines per change). The detail carries no message text.

**I-3. Cursor repair moved the event cursor backwards.**
- `src/state.js:113-143` `repairCursors`: no cursor is deleted. `events.acked` is kept as stored. `events.issued` is raised to `max(issued, acked)` when it is below `events.acked`. A damaged (non-whole) `events.issued` or `events.acked` is reset to 0, which redelivers events rather than skipping them. A damaged `events.lastSeq` is removed, since the next seq is the highest of the cursors and the event file. The repair is queued as a notice, `state.repair`, with the cursors that changed and a note that no cursor moved backwards (`src/state.js:206-216`).
- `src/events.js` does not read the stop (no stop or guard call in that file), so `pending()` and `ack()` are not gated by it.

**I-4. Deferred threads read without a cap.**
- `src/poller.js:573-592`: deferred threads have their own budget, `maxThreadsPerTick` (line 586, `deferredBudget`). The first pass (the normal threads) is bounded at `2 * maxThreadsPerTick` reads (line 578), because a thread that holds a future message takes no slot and so must not be unbounded either.
- The header at `src/poller.js:6-11` now describes the two budgets. The old header said "up to maxThreadsPerTick changed threads are read per tick", which was wrong.

**I-5. No raw Graph id in comment and mention events.**
- `src/events.js:272-275` `output`: a comment or mention carries `targetId`, its raw Graph id (`rawIdOf`). The stored id is unchanged and stays kind-qualified. `pending`, `append` and `decide` all return this output.
- `src/tools.js:115-120` `COMMENT_ID`, used by `ig_comment_reply` (line 353), `ig_comment_hide` (362), `ig_comment_delete` (372) and `ig_private_reply` (413). Its description says a comment or mention event's targetId is the value to pass.
- `src/tools.js:310` `ig_events_pending` and `:326` `ig_events_decide` descriptions say which value each tool takes.

#### Minor findings

- **M-1 (A-28 by listing, not by the age of the seen value): accepted, as the reading of "not seen".** `src/poller.js:415` `stampAndPrune`. A listed conversation keeps its seen value however old it is. Pinned by the test below.
- **M-2 (notices lost when an audit write fails): fixed.** `src/events.js:582` `drainNotices(write)` and `src/state.js:248` `drainNotices(write)`. A notice is dropped only after its write returns. `src/poller.js:284-289` writes each one.
- **M-3 (rebuild and crash-gap times use `receivedAt`): fixed.** `src/events.js:381` `loadedAt`. A key the log learns without a record starts at the load time, which is later than its receipt, so it stays known at least 90 days. The rebuild (`src/events.js:384-420`) keeps the valid lines of a damaged index, with their receipt times, so an id purged 40 days ago is still refused. The header at `src/events.js:4-14` states the rule.
- **M-4 (the audit kind is a literal): accepted, with the reason in the code.** `src/poller.js:462-465`. The reader's shape check (`src/graph/endpoints/messaging.js`, `readRow`) counts only API_ERROR rows, so API_ERROR is the reader's only skip kind. The count is real.
- **M-5 (a failed copy aside stops the start): fixed.** `src/state.js:163` (`fs` option), `:148` `copyAside` returns false instead of throwing, and `:192`, `:204` keep the copy pending. The repaired state is held in memory and the damaged file is not replaced. `src/state.js:257` `save()` makes the copy first, and throws CONFIG when it cannot, so the guard keeps the stop in process.
- **M-6 (dropped future records deleted after 30 days): fixed.** `src/poller.js:310` `futureHold` stores the message's time (`createdAt`) with the record. `:357` a dropped record makes the message skip silently. `:439` a dropped record is kept until its message is older than the dedupe window.
- **M-7 (a webhook event stamped ahead of the clock is dropped, not held): accepted.** `src/webhooks.js:283-292`. The code comment at `:280-282` says the delivery still gets 200 so that Meta does not retry it, so the webhook cannot hold the event for later. The poller reads that thread again when its updated time changes, and then holds or stores the message by the poller's rules. Not a loss in the normal case, but a loss if the thread is never updated again.
- **M-8 (a missing index is not reported): fixed.** `src/events.js:384`. With events in the file and no index, the index is rebuilt from the file, and the notice reason is `index missing`.
- **M-9 (review baseline and line numbers): corrected here.** The copy taken at the start of P4 is `scratchpad\p4-before`, which is after the P3 fixes. The reviewer's `p3-head` baseline predates the P3 fixes, so a comparison against it is not the right check for P4. The current line of `DEDUPE_DAYS` is `src/events.js:30`; the earlier entries above cite lines from earlier edits, so use this section's references.
- **M-10 (webhook intake continues during a STATE_CORRUPT stop): accepted, for owner confirmation.** `src/webhooks.js`. The O-3 entry in `progress.md:401` names the halt of the poller and the refusal of outbound actions, and says nothing about webhook intake, so intake continues.
- **M-11 (an unparseable state file loses the caps counters and the token record): accepted, for owner decision.** `src/state.js:163-190`, the unparseable path. The file cannot be read, so there is nothing to restore from; the copy is kept aside. After `ig_stop_clear`, the daily caps start from zero for that day.

#### Changed tests (old and new assertion)

- `test/state.test.js`, `damaged event cursors are copied aside, removed, and a STATE_CORRUPT stop is stored`, renamed `... copied aside, repaired, and ...`. Old: `state.get('events.acked')` and `state.get('events.issued')` were undefined. New: both are 5. Old: after a restart `events.acked` was undefined. New: 5.
- `test/events.test.js`, `a damaged dedupe index is quarantined and rebuilt ...`. Old: `log.takeNotices()` returned the notice and emptied the queue, and `detail.keys` was 1. New: `log.drainNotices(...)` writes the notice once; `detail.keysFromIndex` is 1 (the valid m1 line) and `detail.keysFromFile` is 0.
- `test/poller.test.js`, the helper `buildWith` (its dummy event log and state): `takeNotices` became `drainNotices`. The test `poll settings outside their bounds are refused with the field name` fails without that change, because `createPoller` now requires `drainNotices`. This is a helper change; the assertions are unchanged.

#### New tests

- `test/state.test.js`: `a repair raises events.issued to events.acked, and records the repair as a notice` (I-3); `a repair over a stored RATE_LIMITED sets STATE_CORRUPT, and the notice records the replaced stop` (I-1); `a repair keeps a stored halting stop` (I-1); `a notice whose write fails stays queued for the next drain` (M-2); `a copy aside that fails does not stop the start, and no save replaces the damaged file before its copy exists` (M-5).
- `test/events.test.js`: `a repaired cursor never re-delivers an event that was acked` (I-3); `a rebuild keeps the valid lines of a damaged index, so an id purged 40 days ago is still refused` (M-3); `a missing dedupe index with events in the event file is rebuilt from the event file, and the rebuild is recorded` (M-8); `an event-log notice whose write fails stays queued for the next drain` (M-2); `a comment event carries its raw Graph id as targetId, which passes the digit check of the comment tools` (I-5).
- `test/poller.test.js`: `a message older than 90 days in a changed thread is not stored, and the audit line carries no text` (I-2); `with ten deferred threads and a budget of two, only two are read per tick` (I-4); `a dropped future message is not stored when its time passes, and its drop is audited once` (M-6); `a listed conversation keeps a seen value of any age (A-28 prunes by listing, M-1)` (M-1, pinned).
- `test/guard.test.js`: `a stored STATE_CORRUPT or STATE_LOST stays when RATE_LIMITED is observed, and after a restart` (I-1).
- `test/service.test.js`: `a comment event targetId passes the comment tools id check, and commentReply previews it` (I-5).

#### Commands and output

Full suite. Command: `npm test` (`node --test test/*.test.js`). Output: `ℹ tests 954`, `ℹ pass 954`, `ℹ fail 0`, exit 0. The 954 is the 938 before this round plus 16 new tests.

A grep of the five changed test files (`poller`, `events`, `state`, `guard`, `service`) finds no `listen(`, `createServer`, `http(s).request`, `fetch(` or `net.connect` call. The new tests use the fake Graph client and the injected file system.

#### Mutation checks (scratch copies; the affected test files after each change)

| Mutation | Result |
|---|---|
| STATE_CORRUPT ranked 1 again (I-1) | 1 failing: `a stored STATE_CORRUPT or STATE_LOST stays when RATE_LIMITED is observed` |
| Repair does not replace a stored RATE_LIMITED (I-1) | 1 failing: `a repair over a stored RATE_LIMITED sets STATE_CORRUPT` |
| No 90-day check in the poller (I-2) | 1 failing: `a message older than 90 days ... is not stored` |
| Repair does not raise events.issued (I-3) | 7 failing, including the copy-aside, restart and notice tests |
| No deferred budget (I-4) | 1 failing: `with ten deferred threads and a budget of two ...` |
| No targetId in output (I-5) | 1 failing: `a comment event carries its raw Graph id as targetId ...` |
| Notice removed before its write (M-2) | 4 failing, including the notice-stays-queued tests |
| Copy aside throws after the copy (M-5) | 4 failing: `a corrupt state file leaves a stop record on disk at once ...`, `a second corrupt state file is copied to a numbered name ...`, `corrupt state file is moved aside and loads empty`, and `damaged event cursors are copied aside, repaired, and a STATE_CORRUPT stop is stored` |
| Dropped future records not skipped (M-6) | 1 failing: `a dropped future message is not stored when its time passes ...` |
| Missing index not rebuilt (M-8) | 1 failing: `a missing dedupe index ... is rebuilt ...` |

The restored copy passes.

#### Concerns and decisions

- **The notices are written by the poller.** The state repair and the index rebuild are drained by the poller on its first tick after a start, not at construction. `src/cli.js` is unchanged, as the brief requires. Passing an audit writer into `createState` and `createEventLog` in `src/cli.js` would write them at start.
- **The old-message audit is per thread, with a count.** I-2 said "audits the message". One line per message would be written on each read of a long thread, so the audit is one line per thread and read, with the count. The detail carries no text.
- **A damaged events.acked resets to 0.** A non-number cannot be read as a position. Reset to 0 redelivers events, which is the safe side; no acked event is skipped.
- **Minors M-7, M-10 and M-11 need an owner decision** (see above). They are accepted limits, with their file and line in this section.
- **Node 22 has not been run** (carry-forward to Task 18).


### P4 coordinator decisions: M-7, M-10 and M-11 (owner delegated the decisions; final)

Status: DONE. `npm test`: 969/969 pass, exit 0 (954 before this round, plus 15 new tests; no test changed except the one noted under M-7). These decisions supersede the accepted-limit entries for M-7, M-10 and M-11 in the "P4 review fix round" section above.

#### M-7. A webhook event stamped more than five minutes ahead answers 503 and is not stored

- `src/webhooks.js:12` `RETRY_LATER`. `:280-284` the future branch: the event is counted, audited and not stored, as before. The comment now says the delivery is answered 503. `:291` the audit line is unchanged (kind and identifiers, never the text). `:317-318` after the delivery line is written, a delivery with `futureSkipped > 0` answers `{ status: 503, body: 'Retry later' }`; any other delivery answers 200 `EVENT_RECEIVED`. The other events of that delivery are stored as usual, and a retry skips them by id.
- `src/webhooks.js:223-227` the handler's doc comment states the 503 rule.
- Owner-sent events are still skipped before the future check, so they never cause a 503.
- Changed test: `test/webhooks.test.js`, renamed from `a message over five minutes ahead is not stored, is counted and is audited without its text` to `a message over five minutes ahead is answered 503, is not stored, is counted and is audited without its text`. Old assertion: `assert.deepStrictEqual(await handle(signedPost(rawBody)), { status: 200, body: 'EVENT_RECEIVED' })`. New: `{ status: 503, body: 'Retry later' }`. The stored-events, skipped-line and delivery-detail assertions are unchanged.
- New tests: `a future-stamped event is stored by the retry once it is no longer ahead, and is stored once` (the first attempt answers 503 and stores only the normal event; the retry, with the clock two minutes on, answers 200 and stores the other, once each); `a delivery with only normal events still gets 200`.

#### M-10. While a stop holds, events are stored, and nothing is notified or answered

- The event log is a file of its own, so a stop does not block a write to it. Nothing in `src/events.js` or `src/webhooks.js` changed for this, and `test/webhooks.test.js` shows it.
- `src/service.js:766-770`, in `handleInbound`: after the kind check, `const stop = guard.stopStatus(); if (stop.stopped) return skip(`STOPPED: ${stop.kind}`)`. The audit line is `inbound`, outcome `skipped`, target the sender, detail `STOPPED: <kind>; received <time>`. No text. The check comes before the auto-reply check, so the stop is the recorded reason.
- The guard still refuses a reply on its own: `runOutbound` calls `guard.assertNotStopped()` (`src/service.js`, unchanged), which throws `STOPPED`.
- Not changed, and reported as a concern: `src/cli.js:685` passes `onInbound: () => {}` to the poller, and the webhook handler does not call any notify hook. So no inbound event is notified by either path today, stop or no stop. The README says so. Connecting the hook is the `serve` wiring in the ledger (progress.md, the Task 15 and Task 17 carry-forwards). It was not done here, because it would turn auto-replies on in production.
- New tests: `during a STATE_CORRUPT stop, an inbound event is stored` (`test/webhooks.test.js`: a real state file with a stored STATE_CORRUPT stop, a real event log and the handler; the event is stored and the delivery answers 200). `during a STATE_CORRUPT stop, an inbound event is not answered and an auto-reply is refused` (`test/service.test.js`: a control event from another sender is answered with no stop, so the stop is what holds the reply; with the stop, no request is made, there is no second reply, the skip audit names the stop, the audit carries no text, and `dmSend` is refused with `STOPPED` before any request).

#### M-11. A corrupt-state start rebuilds the outbound counters from the audit file

- `src/state.js:176` the `unreadable` flag. It is set at `:192` only when the state file cannot be parsed, and read through the getter at `:232`. A file that parses, or a file that is missing, is not unreadable.
- `src/audit.js:54` `forEachLine`: the chunked line reader, factored out of `readTail` (`:78`; its behaviour is unchanged). `src/audit.js:106` `scanSince(since, visit)`: visits each entry whose `at` is at or after `since`, newest file first, then the rotations. It counts the lines that are not JSON objects or have no valid `at` as damaged. It stops after a file whose first valid line is before `since`, because the rotations hold only older lines. Exposed at `:187`.
- `src/caps.js:60` `AUDIT_FEATURES` maps the audit feature names that `src/service.js` writes to their caps actions: publishMedia, commentReply, commentHide, commentDelete, like, unlike, dmSend (owner_dm), privateReply (private_reply), mediaDelete (outbound only), follow, unfollow, profileEdit, autoReply, hashtagSearch (hashtag). Business discovery and mentioned-media lookups write no audit line, so they are not listed.
- `src/caps.js:348` `rebuildCapsFromAudit({ caps, state, audit, now })`. It counts an audit line when its action is in `AUDIT_FEATURES` and its outcome is `ok` or `error`. The `error` lines count because a pre-send failure released its count when it happened, but the audit line does not record that, so the rebuild over-counts there, which fails closed. Each counter keeps the lines inside its longest window measured from now, using the same test as `live()` (`:397`). An auto-reply line keeps its sender (the audit target). A hashtag line keeps its normalised tag. A line whose sender or tag is unusable is counted as unusable and kept out of its counter. It writes the counters to the state and does not save; the caller saves. It returns `counted`, `damaged`, `unusable`, `actions` and `windowMs` (`:402`).
- `src/cli.js:591` `recoverFromAudit` (exported). It runs the rebuild, writes the `recovery` record to the state, saves, and audits `capsRebuild` with outcome `ok` (or `error` when the rebuild failed). The record holds `at`, `counters`, `counted`, `auditLinesCounted`, `damagedAuditLines`, `unusableAuditLines`, `windowMs`, `notRebuilt` and `authRecord`. A rebuild that throws is recorded as `counters: 'not rebuilt (<kind>); the caps start from zero'`. A save that fails with CONFIG, because the damaged file has no copy yet, is kept in process and does not refuse the start (the M-5 ruling).
- `src/cli.js:659` `buildServe` calls it when `state.unreadable === true`, after the caps are created. `createState` still makes the damaged copy (`state.json.corrupt`, or the next free numbered name), as before.
- `src/cli.js:777` `startServe` prints one stderr line when a recovery record exists. `src/cli.js:532` the local `ig status` summary (used when the service is not running) shows `recovery`.
- `src/service.js:801` `status()` (so `ig_status`) returns `recovery`, or null.
- The token record is not rebuilt. It stays absent, and the recovery record's `authRecord` says so: `empty; run ig auth login to write it again`. The key is `authRecord`, not `tokenRecord`, because `src/redact.js` masks every key that contains the word token, which would show the status as `[redacted]`. The access token itself is in the secret store and is not touched.
- README: `:170` (the STATE_CORRUPT paragraph), `:172` (the stop ranking, which the README had stated backwards: STATE_LOST and STATE_CORRUPT rank highest, then the account stops, then RATE_LIMITED, as `src/guard.js:27-34` has it), `:176-186` the new section "Recovery from a damaged state file", and `:281-282` the webhook rules for M-7 and M-10.

New tests (15):
- `test/audit.test.js`: `scanSince visits the entries at or after a time, across a rotation, and counts the damaged lines`; `scanSince does not read a rotation once the newest file starts before the time`.
- `test/caps.test.js`: `a rebuild counts the ok and error lines of outbound actions inside each window, and writes them to the state`; `a rebuild skips the lines that are not outbound actions, and a mediaDelete counts toward outbound only`; `a rebuild keeps the sender of an auto-reply and the tag of a hashtag, and counts an unusable one as unusable`.
- `test/state.test.js`: `unreadable is true only when the state file could not be parsed`.
- `test/cli.test.js`: `a corrupt-state start with five audited likes today shows five against the like cap, and an empty token record` (the required test: five `like` lines at `ok` one minute before the clock, one cut-short line; the like cap shows 5, the outbound total 5, the recovery record counts `{ outbound: 5, likes: 5 }` and one damaged line, the token record is absent, and the `capsRebuild` audit line says so); `a corrupt-state start with no audit file records a rebuild with no counts`; `a readable state file is not rebuilt, so there is no recovery record`; `a recovery whose save fails is kept in process, and does not refuse the start (M-5)`.
- `test/service.test.js`: `during a STATE_CORRUPT stop, an inbound event is not answered and an auto-reply is refused`; `status shows the recovery record of the state, and null when there is none`.

Changed tests: only the M-7 test above. Its old and new assertions are in the M-7 section.

#### Mutation checks (scratch copies of the whole project tree, six test files each)

| Mutation | Result |
|---|---|
| No 503: `src/webhooks.js:318` made `if (false)` | 2 failing: `a future-stamped event is stored by the retry ...`, `a message over five minutes ahead is answered 503 ...` |
| No notify check: `src/service.js:770` made `if (false)` | 1 failing: `during a STATE_CORRUPT stop, an inbound event is not answered ...` |
| No rebuild: `src/cli.js:659` made `if (false)` | 2 failing: `a corrupt-state start with five audited likes today ...`, `a corrupt-state start with no audit file ...` |
| No window filter: `src/caps.js:397` keeps every entry | 1 failing: `a rebuild counts the ok and error lines of outbound actions inside each window ...` |
| Error lines skipped: outcome check in `rebuildCapsFromAudit` | 1 failing: the same test |
| No early stop: the `break` in `scanSince` removed | 1 failing: `scanSince does not read a rotation once the newest file starts before the time` |

The restored copy passes the six files (284 tests, 0 failing), and the project's full suite passes (969).

Harness note: a scratch copy needs the project's `node_modules`. Without it the CLI test file fails on import (`@modelcontextprotocol/server`), which is the copy, not the code. The scratch copies link `node_modules` as a junction.

#### Concerns and decisions for the coordinator

- The notify step is the service's `onInbound`. It now checks the stop. `src/cli.js:685` still wires the poller's `onInbound` to a no-op, and the webhook handler has no notify hook, so no inbound event is notified by either path today. Connecting them is a `serve` decision (the ledger's Task 15 and Task 17 carry-forwards). It would turn auto-replies on in production, so it was not done here.
- The counter rebuild uses each counter's window measured from now. For the daily caps that is the last 24 hours, the same as the caps measure, not the calendar day. `error` lines count, so the counts can run high. That is the fail-closed choice.
- Not rebuilt, and listed as known limits in the README: the business-discovery and mentioned-media counters (no audit line), and a `STATE_LOST` start (no state file, so no counters). The token record is not rebuilt in any case.
- The M-7 retry depends on Meta retrying a 503. That cannot be checked here. If Meta stops retrying before the clock catches up, the event is not stored unless its thread changes again, because the poller re-reads a changed thread.
- The earlier "accepted limits" entries for M-7, M-10 and M-11 are now decided, and the owner's decisions are recorded in the README (`Recovery from a damaged state file`, and the webhook section).


### P4 coordinator round: the inbound wiring and the lookup counters

Status: DONE. `npm test`: 979/979 pass, exit 0 (969 before this round, plus 10 new tests). No existing test was changed. M-7, M-10 and M-11 are kept as decided in the section above.

#### 1. The inbound path is wired (concern 1 of the last round)

- `src/cli.js:713` `const onInbound = (event) => service.onInbound(event);`. It looks up the service's hook when an event arrives, so the wiring follows the service object. The poller gets it at `:747`, in place of the no-op `() => {}`. The webhook handler gets it as `notify` at `:722`. The webhook handler is now created after the service, because the wiring needs the service. Its position in `buildServe` changed; nothing else did.
- `src/webhooks.js:247-257` `notifyStored`. `createWebhookHandler` takes an optional `notify`. Each event that is newly stored (`:318`, `const stored = events.append(event)`) is passed to it at `:319`. The call is not awaited, so the delivery is answered at once. A `notify` that throws, or whose promise rejects, is audited as `webhook.notify` with the event id and the error kind only, and the delivery goes on. Owner-sent events and events already stored are not notified, because they are skipped before `:318`.
- `src/service.js` `onInbound` is unchanged. It already refuses under a stop (M-10), skips the owner's events, and refuses when `autoReply.enabled` is off, which is the default. A reply then goes through `runOutbound`, so the caps and the 24-hour window apply.
- The README's webhook section states the wiring.

New tests, all through `buildServe` with a fake `fetchImpl` and a `sleep` that returns at once. No test listens or makes a network call. The fake Graph answers the owner's conversations and their messages, records each send, and gives every answer an `x-app-usage` header, because an official send needs a usage reading (the gate refuses a send without one):
- `test/cli.test.js`: `with auto-replies off, an inbound event through the poller and through the webhook calls the service callback and sends nothing` (both paths call the callback with their own events; no send; two audit lines, each `AUTO_REPLY_OFF`).
- `test/cli.test.js`: `with auto-replies on, a matching event through the webhook is replied to once, and the conversation cap holds back a second` (one send with the rule's reply; the second event from the same sender is refused, audited as `BUSY`). The test first makes one poller read, as the poller does in production, which gives the usage reading.
- `test/cli.test.js`: `an auto-reply is subject to the 24-hour window: an event older than that gets no reply` (no send; audited as `WINDOW_CLOSED`).
- `test/cli.test.js`: `with auto-replies on, a matching event through the poller is replied to once` (one send).
- `test/webhooks.test.js`: `notify is called once for each stored event, and a failing notify does not change the answer`.

#### 2. The lookups are counted, and the rebuild also runs on STATE_LOST (concern 3 of the last round)

- `src/service.js:694` `lookup` takes an optional `feature`. When it is given, the lookup writes one audit line for its outcome: `{ action: feature, target: null, route: product, outcome: 'ok' | 'error', detail }` (`:707` and `:711`). `:939` mentioned media passes `feature: 'mentionedMedia'`, and `:1055` business discovery passes `feature: 'businessDiscovery'`. The line has no username and no media id. The hashtag search is unchanged: it writes its own line, with the tag, and passes no feature. A busy lookup writes nothing, as before.
- `src/caps.js:75-76` `AUDIT_FEATURES` maps the two lookup features to `business_discovery` and `mentioned_media`. Both are read actions, so each counts into its own bucket only and not into the outbound total.
- `src/state.js:172` and `:238`: a `missing` flag, true when there was no state file at load.
- `src/cli.js:662-665` in `buildServe`: the rebuild runs when the state is unreadable, or when it is missing and the guard reports `STATE_LOST`. A state file that exists is never rebuilt, so a state that still has its counters keeps them. `recoverFromAudit` (`:591`) takes the reason, and the recovery record now has a `reason` field: `state file unreadable` or `state file missing (STATE_LOST)`. The `notRebuilt` text (`:607`) now says only that lookups made before the audit lines were added are not counted. The start banner (`startServe`) names the reason.
- Checked, not assumed: an earlier version of this round also checked that the state held no counters. A mutation that removed that check survived, because the missing-or-unreadable rule already excludes a file that has counters. The check was removed, so the code has the one rule the README now states.
- README: the stop section (the `STATE_LOST` bullet), the recovery section (`:176`, the lookups bullet, the `STATE_LOST` bullet and the sentence on files that exist), and the webhook section.

New tests:
- `test/cli.test.js`: `a STATE_LOST start with three audited lookups shows three against the lookup bucket` (the state file is gone, the audit file holds three `businessDiscovery` lines with outcome `ok`; the business-discovery bucket shows 3 against its daily limit, outbound shows 0, and the recovery reason is `state file missing (STATE_LOST)`). `a STATE_LOST start over a state file that still holds counters does not rebuild them`.
- `test/service.test.js`: `a business-discovery lookup writes one audit line with its action and outcome, and no identifier`.
- `test/caps.test.js`: `a rebuild counts business-discovery and mentioned-media lookups into their own daily buckets, not outbound`.
- `test/state.test.js`: `missing is true only when there is no state file`.

Count: 979 pass, 0 fail (969 before; 6 new in `test/cli.test.js`, 1 in `test/webhooks.test.js`, 1 in `test/state.test.js`, 1 in `test/caps.test.js`, 1 in `test/service.test.js`).

#### Mutation checks (scratch copies of the whole project tree, all test files)

| Mutation | Result |
|---|---|
| Poller back to a no-op: `src/cli.js:747` | 2 failing: the auto-replies-off test and the poller reply test |
| Webhook does not notify: `src/webhooks.js:319` | 4 failing: the notify test, the auto-replies-off test, the webhook reply test, the window test |
| Lookup writes no audit line: `src/service.js:707` | 1 failing: the business-discovery audit test |
| No lost-state rebuild: the `STATE_LOST` branch in `src/cli.js:664` | 1 failing: the lookups STATE_LOST test |
| Lookup features missing from `AUDIT_FEATURES` | 2 failing: the lookups STATE_LOST test and the caps lookups test |
| The removed counters check (see above) | survived, so it was removed as redundant |

The restored copy passes every test file.

Harness note: the scratch copies link the project's `node_modules` as a junction, as in the last round.

#### Concerns for the coordinator

- With auto-replies off (the default), each new inbound message now writes one `inbound` audit line (`AUTO_REPLY_OFF`) from either path. The audit rotates at 50 MB, so the volume is the owner's call.
- Lookups made before this build wrote no audit line, so a rebuild after the upgrade does not count them.
- A webhook event that arrives before the first Graph read after a start is refused as `BUSY` (no usage reading yet), and audited as such. The poller's first tick clears it. In production that is normally seconds after the start.


### P4 final fix round: p4-final-review.md (N-1 to N-8, and the I-3 residual)

Status: DONE. `npm test`: 996/996 pass, exit 0 (979 before this round, plus 17 new tests; one existing test changed, listed below). No test listens or makes a network call: the new tests use the fake `fetchImpl` of `buildServe`, or no Graph call at all. I-3 (the residual branch) was carried in the review, and it is addressed here under the N-1 hold, because it is the same loss. The coordinator's list did not name it, so this is flagged in the concerns.

#### N-1. The event cursors are unknown after a state loss; pending and ack are held (Important)

- `src/events.js:377` `isStopped` option (default: never stopped). `src/cli.js:701` `buildServe` passes `() => guard.stopStatus().stopped`, so the event log reads the same stop as the guard.
- `src/events.js:404` the loss is marked: when the state holds none of `events.issued`, `events.acked` and `events.lastSeq` (`anyCursor`, `:255`), and the event file holds events, the state gets the marker `events.cursorsLost = { reason: 'the state file was unreadable or missing', since }`. A healthy state always holds `events.lastSeq` once an event is stored, so this is the lost case only.
- `src/state.js:16` `CURSORS_LOST_KEY`, and `src/state.js:117-125` `repairCursors` (the delete is at `:121`): a damaged (non-whole) `events.acked` or `events.issued` is now removed, not reset to 0, and the marker is set with `reason: 'damaged event cursor'`. This is the I-3 residual: a reset to 0 moved the acked position back and redelivered acked events. The repair note at `src/state.js:217-219` no longer says that no cursor moved backwards, and it says what happened.
- `src/events.js:499-511` `unknownMarker` and `holdError`. The refusal is `STOPPED`, with the message `the event cursors are unknown (<reason>), so events are held until the owner clears the stop with ig_stop_clear`.
- `src/events.js:536` `pending`: while the marker is set and the stop holds, it throws; nothing is delivered. After a clear, `resetCursors` (`:515`) sets `events.acked` to 0, keeps `events.issued` and `events.lastSeq` at the highest of the known value and the event file's high water (so no seq is reused, and an ack of an old cursor is still accepted), clears the marker to `null`, queues the audit notice `events.cursors reset`, and keeps the notice in memory until the next successful pending returns it as `notice: { kind: 'cursors_reset', reason, note }`. A save that fails is kept in process.
- `src/events.js:565` `ack`: held while the stop holds (`STOPPED`); after a clear and before a pending, it is refused with `VALIDATION` ("read the pending events first").
- `src/events.js:696` `cursorsUnknown()`, used by the recovery record.
- `src/service.js:1073` `eventsPending` passes `notice` through. Without a notice the output is unchanged.
- `src/cli.js:607` and `EVENT_CURSORS_HELD` (`:599`): the recovery record's `eventCursors` field states the cursor state, and the start note shows it.
- README "Recovery from a damaged state file": the bullet "Known limit: the event cursors" (the redelivery, the dedupe by id, the hold). Known limit, as the ruling asked.
- Tests:
  - `test/events.test.js`: `an unreadable state with acked 9 holds pending and ack; the clear starts from zero with the notice; the event ids are the same as before` (the required test: `STOPPED` names the state loss; `ack` is held; after the clear, an ack before pending is refused; the pending carries the notice once; the ids are the same; the reset is queued for the audit log).
  - `test/events.test.js`: `a damaged acked cursor holds pending and ack until the clear, and no acked event is delivered before it` (the I-3 residual).
  - `test/cli.test.js`: `through the service, an unreadable state holds ig_events_pending and ig_events_ack, and a confirmed clear starts the cursors again with the notice` (the same through `buildServe` and the service, with the recovery record's `eventCursors`).
  - `test/state.test.js`: `a damaged acked cursor is removed and marks the cursors unknown; it is not reset to zero`; `a damaged events.lastSeq alone is removed and leaves the cursors intact, with no unknown marker`.

#### N-2. The one-reply record is rebuilt from the privateReply audit lines (Important)

- `src/caps.js:17` `PRIVATE_REPLY_WINDOW_MS` (7 days). `src/caps.js:376-388` `keepPrivateReply`: a `privateReply` line whose target is a comment id (digits; otherwise counted as unusable) is kept when the comment's stored time is unknown, and when the line is within 7 days of that time. The earliest kept line gives the record's time. `src/caps.js:389` the scan reads at least 7 days back (`Math.max(longest, PRIVATE_REPLY_WINDOW_MS)`), and `:390` feeds the lines in.
- `src/caps.js:427` returns `privateReplies` in the record shape the service's check reads: `{ at, preSendFailures: 0, released: false }` (the live check refuses while a record is not released).
- `src/events.js:676` `receivedAtOf(rawId)`: the stored comment's or mention's receipt time (the comment's own time), or null.
- `src/cli.js:603-607` `recoverFromAudit` passes `commentTimeOf: (id) => events.receivedAtOf(id)`, merges the records into `private_replies`, and records the count as `privateReplies`.
- Deviation, for the coordinator: the ruling said "outcome is ok". The rebuild also keeps `error` lines, as the counters do. The live record keeps its reservation when a reply fails after it reached Instagram, and the audit line does not say which failures those were. So an `ok`-only rebuild would open the fail-open case that the review describes. The cost is one blocked retry after a damaged-state start, for a pre-send failure. This is recorded in the README bullet about the one-reply record.
- Tests:
  - `test/cli.test.js`: `a damaged-state rebuild with one privateReply audit line for comment C refuses a second private reply to C with no request` (after the owner clears the stop: `CAP_EXCEEDED`, and the fake Graph records no request).
  - `test/caps.test.js`: `a rebuild keeps the one-reply record of a comment when its time is unknown, and when the reply is within 7 days of it`; `a privateReply line whose target is not a comment id gives no record and is counted as unusable`.

#### N-3. The audit rebuild no longer assumes time order (Minor)

- `src/audit.js:101-137` `scanSince` reads every retained file, newest first, and tests each line by its own `at`. The early stop is removed. The cost is one read of every retained file at a recovery start (up to 11 files of 50 MB by default). The header at `src/audit.js:1-6` says so.
- A line with no usable time is counted as damaged (unchanged; the caps counts sort by the line's own time, `src/caps.js` `kept.sort`).
- Changed test (old and new assertion), `test/audit.test.js`: the test named `scanSince does not read a rotation once the newest file starts before the time`, with `assert.deepEqual(result, { damaged: 0, visited: 1 }, 'the rotation with the damaged line is not read')`, is replaced by `scanSince reads every retained file, so a rotation with lines out of time order is counted in full`, with `assert.deepEqual(result, { damaged: 1, visited: 1 }, 'the damaged line of the rotation is counted')`. The entry seen is the same.
- New tests: `test/audit.test.js`: `an out-of-order audit file counts the same as the ordered one`; `a rotation that holds an in-window line is read even when the newest file starts before the window` (the reviewer's scenario); `test/caps.test.js`: `the counts of an out-of-order audit file are the same as those of the ordered one`.

#### N-4. The damaged-line count is in the notice and the status (Minor)

- `src/cli.js:593` `damagedNote`: `N damaged audit line(s) skipped; the counts may be low by up to N`. The recovery record's `note` (`src/cli.js:624`) carries it, and `status().recovery` shows it (`src/service.js`, unchanged).
- The start note (`src/cli.js:659` `recoveryNote`) prints the same note.
- Test: `test/cli.test.js`, the existing test `a corrupt-state start with five audited likes today...`: added assertion `assert.equal(status.recovery.note, '1 damaged audit line skipped; the counts may be low by up to 1')` (added, not changed).

#### N-5. A zero-length index is reported with the rebuild (Minor)

- `src/events.js:332` `loadIndex`: a zero-length index is a missing one (`empty: true`). The rebuild notice's reason is `index empty` (`src/events.js:434`). The rebuild runs when events are in the file (unchanged rule).
- Tests: `test/events.test.js`: `a zero-length dedupe index with events in the event file gives the rebuild notice`; `a zero-length dedupe index with an empty event file gives no notice`.

#### N-6. The ig_like description gives the comment rule (Minor)

- `src/tools.js:382`: "For kind comment, pass the targetId of a comment event from ig_events_pending, which is the raw comment id, not the event id (comment:<id>)."
- Test: `test/tools.test.js`: `the ig_like description gives the targetId rule for a comment event`.

#### N-7. The ranks: the state stops and the account stops share rank 3 (Minor)

- `src/guard.js:28-34` `STOP_RANK`: AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED at 3 (their earlier rank); STATE_LOST and STATE_CORRUPT at 3 (above RATE_LIMITED at 2, as the I-1 ruling asked); a stop of equal rank keeps the stored one (the rule at `src/guard.js` `stop()`, unchanged). The comment at `:23-27` says so.
- README: "When stops overlap..." (stop-state section) states the order and the equal-rank rule.
- Tests: `test/guard.test.js`: `a stored CHECKPOINT is not replaced by a rate limit, and a stored STATE_CORRUPT is kept against an equal-rank CHECKPOINT (N-7)`; `STATE_LOST and STATE_CORRUPT rank with the account stops, above RATE_LIMITED (N-7)`.

#### N-8. The recovery record is cleared on a confirmed clear, and the start note shows once (Minor)

- `src/service.js:823-831` `stopClear`: a confirmed clear (any result other than `preview`) sets the `recovery` key to `null` and saves; a save that fails throws CONFIG, so the owner can confirm again.
- `src/cli.js:659` `recoveryNote`: shows the note once, and marks the record `noted: true` (saved). `startServe` (`src/cli.js:835`) calls it. The record starts with `noted: false` (`src/cli.js:624`).
- Test: `test/cli.test.js`: `the start note of a recovery is shown once, and a confirmed ig_stop_clear removes the record so the note does not reappear`.

#### Changed tests (old and new assertion)

- `test/audit.test.js`: one test replaced, as in N-3 above. Old: `{ damaged: 0, visited: 1 }`, and the test name `does not read a rotation once the newest file starts before the time`. New: `{ damaged: 1, visited: 1 }`, and the test name `reads every retained file ...`.
- No other existing test was changed. Added assertions only: `test/cli.test.js` (the N-4 note line, above). The `fakeGraph` helper in `test/cli.test.js` now also records every request (`requests`), and every answer carries an `x-app-usage` header.

#### New tests (17)

- `test/audit.test.js` (2): the out-of-order file; the in-window rotation.
- `test/guard.test.js` (2): the N-7 rank tests.
- `test/state.test.js` (2): the damaged acked cursor; the damaged lastSeq alone.
- `test/events.test.js` (4): the required N-1 test; the I-3 residual hold; the zero-length index notice; the empty index gives no notice.
- `test/caps.test.js` (3): the one-reply record rules; the non-id target; the out-of-order counts.
- `test/tools.test.js` (1): the ig_like rule.
- `test/cli.test.js` (3): the N-2 integration; the N-8 note; the N-1 through the service.

#### Mutation checks (scratch copies of the whole project tree; all test files)

| Mutation | Result |
|---|---|
| No hold in pending (`src/events.js`, the hold) | 3 failing, including the required N-1 test and the service test |
| No lost-cursor marker (`src/events.js:403`) | 2 failing: the required test and the service test |
| No private-reply rebuild (`src/caps.js:390`) | 3 failing: the N-2 integration, the non-id test, the record test |
| No 7-day window (`src/caps.js:384`) | 1 failing: the record test |
| Scan reads only the newest file (`src/audit.js:114`) | 4 failing: the rotation tests |
| Damaged-line note always "none" (`src/cli.js:593`) | 1 failing: the five-likes test |
| Zero-length index not treated as missing (`src/events.js:332`) | 1 failing: the zero-length notice test |
| Tool rule removed (`src/tools.js:382`) | 1 failing: the ig_like test |
| STATE_CORRUPT ranked 2, below the account stops (`src/guard.js:34`) | 2 failing: the N-7 tests |
| Recovery record not cleared on a confirmed clear (`src/service.js`) | 1 failing: the N-8 test |
| Start note not marked as shown (`src/cli.js`) | 1 failing: the N-8 test |
| Damaged acked cursor reset to 0 (`src/state.js:117`) | 7 failing, including the damaged-cursor state test |

The restored project passes all 996 tests.

#### Concerns for the coordinator

- The N-2 rebuild keeps `error` lines, against the ruling's "outcome is ok" (see the N-2 section). A pre-send failure before a damaged-state start then blocks one retry; the alternative is a fail-open case.
- The I-3 residual is addressed under the N-1 hold, and a confirmed clear re-delivers the acked events, with the notice and the same ids. That is the ruled reset to zero. The owner should confirm it as a redelivery, not a loss.
- The audit rebuild now reads every retained file once at a recovery start (up to 11 files of 50 MB by default). The cost on a large real audit file has not been measured.


### P4 fix round 2: p4-nfix-review.md (N-9 to N-14)

Status: DONE. `npm test`: 1038/1038 pass, exit 0 (1029 on the same test files before this round, plus 9 new tests). No test listens or makes a network call: the new tests use the fake `fetchImpl` of `buildServe`, a directory in place of an audit file, or no Graph call. See the count note at the end.

#### N-9. A readable state that lost its cursor keys raises STATE_LOST (Important)

- `src/cli.js:741-746` in `buildServe`, right after the event log is created: if `events.cursorsUnknown()` and no stop is held, `guard.stop('STATE_LOST', 'the event cursors are unknown')`. A CONFIG error from the save is kept in process (the guard's rule), and any other error propagates.
- `src/events.js:405-421`: the marker is set when the cursor keys are all absent and the event file holds events. This existed before; the new part is only the stop.
- Test: `test/cli.test.js`: `a readable state with a clear record, no cursor keys and events in the file gives STATE_LOST, and pending is refused until the clear`. The state is readable, with a clear record and no cursor keys, over three events. The guard's kind is STATE_LOST with the detail `the event cursors are unknown`. `eventsPending` is refused with `STOPPED`. After `stopClear`, the pending returns the same three ids, with the notice.

#### N-10. A failed audit scan drops the one-reply records (Important)

- `src/caps.js:420-445` `rebuildPrivateReplies({ audit, now, commentTimeOf })`: a scan of its own, over the last 7 days. It returns `{ privateReplies, unusable }` and throws when the audit cannot be read. The one-reply logic (the 7-day rule, the unknown-time rule, the earliest line) moved here from `rebuildCapsFromAudit` unchanged.
- `src/caps.js:404-412` `rebuildCapsFromAudit` no longer scans for `privateReply` lines. It returns `entries` (the kept list of each counter), so that a caller can set them again after a failed save (N-11). Its one-reply code is gone.
- `src/cli.js:605-680` `recoverFromAudit`: the counters and the one-reply records are two separate `try` blocks (`:617-631`). A failure of either is recorded on its own. `oneReplyRecords` in the recovery record says `N rebuilt from the audit file`, or `not rebuilt (<kind>); private replies are refused until ig_stop_clear, because a second reply to a comment cannot be refused locally`. The recovery note prints it (`src/cli.js:691-700`).
- `src/cli.js:661-669` `writeAll`: when the one-reply scan failed, `private_replies_unverified = { reason: 'the audit file could not be read (<kind>)', since }` is set.
- `src/service.js:1216-1222` `privateReply`: before `runOutbound` (so before the stop check, and the reason names the cause), it refuses with `STOPPED` and the message `private replies are refused: <reason>; ig_stop_clear clears this refusal`. No request is made.
- `src/service.js:824-833` `stopClear`: a confirmed clear also sets `private_replies_unverified` to `null`, with the recovery record.
- Tests:
  - `test/cli.test.js`: `an unreadable audit file during a damaged-state start refuses a private reply with no request` (a directory is placed where the audit rotation `audit.jsonl.1` would be; the counters and the one-reply scan both fail; the status says so; `privateReply` is refused with `STOPPED`, and the fake Graph records no request).
  - `test/cli.test.js`: `a failed caps scan does not drop the one-reply records of a recovery` (the first audit scan throws, the second succeeds; the counters are `not rebuilt (EIO)`, the record for comment C is kept, and the private replies are not refused).
  - The existing test `a damaged-state rebuild with one privateReply audit line for comment C refuses a second private reply to C with no request` is the readable-audit case the coordinator asked for. It passes unchanged.

#### N-11. "Kept in process" is wrong for a failed save (Minor)

- The save restores the last saved image (`src/state.js` `save()`, the `restoreImage` call). Every place that relied on "kept in process" is now written to match:
  - `src/events.js:405-420` `setMarker`: holds the marker in `heldMarker` (`:405`) and sets it in the state again after a failed save. The comment says why.
  - `src/events.js:513-515` `unknownMarker` reads `heldMarker`, not the state.
  - `src/events.js:530-558` `resetCursors`: a save that fails no longer delivers. It re-sets the marker, throws CONFIG, and `pending` does not return. The next `pending` repeats the reset and carries the notice. The comment says so.
  - `src/cli.js:661-669` `writeAll` and `src/cli.js:671-679` (the recovery save): the values are set again after a failed save.
  - `src/cli.js:691-720` `recoveryNote`: the noted mark is set again after a failed save, with the comment that a later start may show the note once more.
- Tests: `test/events.test.js`: `a failed save during the reset delivers nothing, and the next pending repeats the reset with the notice (N-11, N-14)` (a `CONFIG` throw, the hold still in process, nothing delivered, then the events and the notice; the wording of the exception is asserted). `test/events.test.js`: `a marker save that fails is held in process: nothing is delivered before the clear, and the first pending after it carries the notice (N-11)`.
- The failing save is injected through the state's own `fs` option (a switch on `openSync` with flag `w`), so the real write path and restore run.

#### N-12. The token-record instruction survives a clear (Minor)

- `src/service.js:851`: `tokenStatus` with no token record now carries `warning: 'the token record is empty; run ig auth login to write it again'` (it was null).
- The README's recovery section names the tool (`ig_token_status`).
- Test: `test/cli.test.js`: `after a confirmed clear of a recovery, tokenStatus still says to run ig auth login while the token record is absent`.

#### N-13. Every observed stop is stored, as a list (decision)

- New module `src/stops.js`: `STOP_KINDS`, `STOP_RANK` (state and account stops at 3, RATE_LIMITED at 2; the I-1 and N-7 ruling), `entryOf` (kind, detail, since, rank), `activeOf` (the first of the highest rank), `withStop` (a kind already held keeps its first entry), `recordOf` (the stored record: the top-level active stop plus `stops`), and `readStops` (reads the new shape; reads the older four-key shape as a list of one stop; refuses a record whose top-level stop is not the active entry, or whose rank is wrong, or with a duplicate kind).
- `src/guard.js:70-75`, `:118-131`, `:169-175`, `:202-227`, `:229-240`: the guard keeps the list, `stop()` appends a new kind and never replaces, `clearStop` clears the list, and `stopStatus()` returns the active fields and `stops`. The STATE_LOST path appends too. The state holds the same record.
- `src/state.js:145-152` `storedStopsOf`, `:217-222` the repair appends STATE_CORRUPT to the list instead of replacing the record. `stopReplaced` (`:231`) names the previous active stop only when the active stop changed. The old halting-set constant is removed.
- Changed test (old and new assertion), `test/guard.test.js`: `a stop is saved at once, in the shape { stopped, kind, detail, since } under the key stop`. Renamed to `... { stopped, kind, detail, since, stops } ...`. Old: `assert.deepStrictEqual(Object.keys(onDisk).sort(), ['detail', 'kind', 'since', 'stopped'])`. New: `assert.deepStrictEqual(Object.keys(onDisk).sort(), ['detail', 'kind', 'since', 'stopped', 'stops'])`, and the list `[['RATE_LIMITED', 2]]`. The top-level assertions are unchanged.
- Tests (new): `test/guard.test.js`: `a RATE_LIMITED then a CHECKPOINT are both stored; the active kind is CHECKPOINT; the clear removes both (N-13)` (both on disk and after a restart; the clear removes both); `a stored record of the older shape, with no list, is read as a list of its one stop (N-13)`; `a stored list whose top-level stop is not its active entry is read as damage, and STATE_CORRUPT starts the guard (N-13)`.
- The state test `a repair over a stored RATE_LIMITED sets STATE_CORRUPT, and the notice records the replaced stop` passes unchanged: the RATE_LIMITED is still in the list, and it is the replaced active stop.

#### N-14. The reset to zero is the decided exception to constraint 14 (decision)

- `src/events.js:37-40` `CURSOR_RESET_NOTE`: the notice now says it is the owner-decided exception to the rule that the cursors never move backwards, and that a missed inbound message is treated as worse than a duplicate.
- `src/cli.js:601-603` `EVENT_CURSORS_HELD`: the recovery record's cursor text says the same.
- README (the recovery section, the event cursors bullet): the exception, the dedupe by id, and the failed reset.
- Test: the N-11 event test asserts the notice wording. The cli test `through the service, an unreadable state holds ig_events_pending and ig_events_ack...` asserts the same words in the recovery record (an added assertion).
- `global-constraints.md` line 14 is not edited, as the ruling named the README and the notice only. See the concerns.

#### Changed tests (old and new assertion)

- `test/guard.test.js`: `a stop is saved at once...` (N-13, above).
- `test/caps.test.js`: `a rebuild keeps the one-reply record of a comment when its time is unknown, and when the reply is within 7 days of it`. Old: `rebuildCapsFromAudit({ ..., commentTimeOf }).privateReplies`. New: `rebuildPrivateReplies({ audit, now, commentTimeOf }).privateReplies`. The assertions are unchanged.
- `test/caps.test.js`: `a privateReply line whose target is not a comment id gives no record and is counted as unusable`. Old: `rebuildCapsFromAudit(...).unusable === 1`. New: `rebuildPrivateReplies(...).unusable === 1`. The caps rebuild now counts that line in its owner-DM and outbound counters, not as unusable.
- `test/cli.test.js`: the added assertion in `through the service, ...` (N-14) is an addition, not a change.

#### New tests (9)

- `test/guard.test.js` (3): the N-13 tests listed above.
- `test/events.test.js` (2): the two failed-save tests (N-11 and N-14).
- `test/cli.test.js` (4): the N-9 test, the unreadable-audit refusal, the failed caps scan (independence), and the token instruction after a clear (N-12).

#### Mutation checks (scratch copies of the whole project tree; all test files)

| Mutation | Result |
|---|---|
| No STATE_LOST raise (`src/cli.js:741`) | 5 failing, including `a readable state with a clear record, no cursor keys ...` |
| No private-reply refusal (`src/service.js:1217`) | 5 failing, including `an unreadable audit file ... refuses a private reply` |
| One-reply records dropped on merge (`src/cli.js` `writeAll`) | 6 failing, including `a failed caps scan does not drop the one-reply records` and the readable-audit refusal |
| Marker not held in process (`src/events.js:407`) | 9 failing, including the two failed-save tests |
| No token warning (`src/service.js:851`) | 5 failing, including the N-12 test |
| Stop list replaced, not appended (`src/stops.js`, `withStop`) | 14 failing, including the N-7 and I-1 rank tests |
| Exception wording removed from the notice (`src/events.js:40`) | 5 failing, including the N-11 and N-14 test |
| Reset delivers on a failed save (`src/events.js`, the reset catch) | 5 failing, including the N-11 test |

Each run also lists failures in the python sidecar tests. They appear in every mutant run, including the ones that touch no Python code, so they come from the scratch copy, not from the mutants. The project's own suite passes.

#### Count note

The round before this one reported 996 passing. The same test files now give 1029 before this round, and the per-file counts sum to 1029. The earlier total was lower, and the output of those runs does not show why (the test names of `test/errors.test.js`, `test/sidecar.test.js` and `test/config.test.js` are missing from the earlier output). The earlier totals in this section (979, 996) may have been understated. The count reported here is the one `npm test` gives now.


#### The one-reply flag: the one-reply gap survives a clear (the coordinator's change from the N-10 concern)

Status: DONE. `npm test`: 1039/1039 pass, exit 0 (1038 before this change, plus 1 new test). No test listens or makes a network call. Changed tests are listed below with their old and new assertions.

The ruling: when the one-reply scan fails during recovery, the state records a flag. privateReply is refused locally, with no request, while the flag is set, whether or not the stop has been cleared. The flag clears only when a later start rebuilds the one-reply records from the audit file. The status shows the flag.

- The flag: state key `oneReplyUnknown` (`ONE_REPLY_UNKNOWN_KEY`, `src/caps.js:17`), value `{ oneReplyUnknown: true, since, reason }`. `since` is the time of the first failure, and `reason` is that of the latest attempt.
- Set on a failed scan: `src/cli.js:710` (`unknownFlag`) and `src/cli.js:718` (`writeAll` sets it, or clears it when the scan succeeded and the flag was held). `writeAll` is set again after a failed save, as in the N-11 round.
- Retried on every start that does not recover the state: `src/cli.js:811` (the `else` branch in `buildServe`) calls `retryOneReplyRecords` (`src/cli.js:620`). A scan that reads the audit file merges the records, where a live record is kept as it is (`mergeOneReplyRecords`, `src/cli.js:607`), and clears the flag. A scan that fails keeps the flag, with the reason of the latest attempt (`oneReplyFlagFor`, `src/cli.js:613`). Each attempt is audited as `oneReplyRebuild`, with outcome `ok` or `error`.
- Refused locally: `src/service.js:1219-1222`, in `privateReply`, before `runOutbound`. The refusal is `STOPPED`, and its message names the reason and says that a later start that reads the audit file clears it. No request is made.
- A confirmed clear does not clear it: `src/service.js:828` (`stopClear`) now clears only the recovery record. The flag is not touched.
- Shown: `src/service.js:809` (`status().oneReplyUnknown`), the local status summary (`src/cli.js`, `oneReplyUnknown: view[ONE_REPLY_UNKNOWN_KEY]`), and the start-up output, which prints the flag at every start until it clears (`src/cli.js:936-941`).
- The recovery record's `oneReplyRecords` text (`src/cli.js:650-653`) names the flag, and says that a confirmed clear does not lift it.
- README, the recovery section (the one-reply bullet): the flag, the refusal across a clear, the retry on each later start, and the status.

New test (1):
- `test/cli.test.js`: `a failed one-reply scan sets the flag; a confirmed clear does not clear it; privateReply is refused with no request until a successful rebuild on a later start clears it`. A damaged-state start with a directory in place of the audit rotation sets the flag with its time, and the status shows it. `privateReply` is refused with `STOPPED`. After `stopClear({ confirm: true })`, the stop is clear, the flag is still set, and `privateReply` is still refused with no request. The directory is removed and a privateReply line for the comment is written. On the next start, the records are rebuilt, the flag is null, the status shows null, the comment's record is released-false, a second reply is refused with `CAP_EXCEEDED` and no request, and the audit holds one `oneReplyRebuild` line with outcome `ok`.

Changed tests (old and new assertion):
- `test/cli.test.js`: `an unreadable audit file during a damaged-state start refuses a private reply with no request`. Old: `assert.match(status.recovery.oneReplyRecords, /^not rebuilt \(.+\); private replies are refused until ig_stop_clear/)`. New: `assert.match(status.recovery.oneReplyRecords, /^not rebuilt \(.+\); the flag oneReplyUnknown is set, so private replies are refused until a later start reads the audit file; a confirmed ig_stop_clear does not lift this/)`. The old wording said a clear lifts the refusal, which is now wrong.
- `test/cli.test.js`: `a failed caps scan does not drop the one-reply records of a recovery`. Old: `assert.equal(state.get('private_replies_unverified', null), null, ...)`. New: `assert.equal(state.get('oneReplyUnknown', null), null, ...)`. The old key is no longer written, so the old assertion passed without checking anything.

Mutation checks (scratch copy, `test/cli.test.js`):

| Mutation | Result |
|---|---|
| A confirmed clear clears the flag (`src/service.js`, `stopClear`) | 1 failing: the new flag test |
| No retry on a later start (`src/cli.js:811`) | 1 failing: the new flag test |
| The flag is not set on a failed scan (`src/cli.js:718`) | 2 failing: the new flag test and the unreadable-audit refusal test |

Concern for the coordinator: while the audit file cannot be read, private replies stay refused across restarts, until the owner fixes the file and a later start reads it. That is the ruling. A start that recovers the state retries the scan in the same start, so the flag clears on the first successful start.


##### Review fix: I-1 and M-R1-2 of p5a-round1-review.md (the fail-closed rule)

Status: DONE. `npm test`: 1060/1060 pass, exit 0. This change adds 6 tests. The total also includes tests that other work in the same tree added or changed during the session (`test/errors.test.js`, `test/mcp.test.js` and `test/http.test.js`, with `src/errors.js`, `src/redact.js`, `src/mcp.js` and `src/http.js`). This change does not touch those files. No test listens or makes a network call.

Review file: the coordinator's path (`...\2026-10-23-instagram-automation-build\p5a-round1-review.md`) does not exist. The review is at `...\2026-10-20-instagram-automation-build\p5a-round1-review.md`, and that is the file used.

Scope: I-1 and M-R1-2 only, as requested. M-R1-1 (TOKEN_SHAPE quadratic on a long run), M-R1-3 (a token glued to a letter or digit) and M-R1-4 (stale description and duplicate severity table) are not in this request and are still open.

**I-1. The one-reply scan treats a damaged or missing privateReply line as "no reply".** Fixed on three paths:

- The damaged count of the scan is returned. `src/caps.js:433` keeps the result of `audit.scanSince`, and `src/caps.js:450` returns `damaged` with the records and `unusable`. The doc comment at `src/caps.js:418-423` says so.
- A scan with a damaged line in any retained file is not known to be complete. `src/cli.js:621-630` `unknownReasonOf`: a scan that cannot read the audit file is unknown, and so is a scan with `damaged > 0`. The rule is fail-closed: the damaged line may be a private reply. The rule is applied in both places that run the scan:
  - the recovery (`src/cli.js:705` the reason, `src/cli.js:738` the flag, `src/cli.js:726` the new recovery field `oneReplyDamagedLines`, and the `oneReplyRecords` text for the damaged case, `src/cli.js:727-735`);
  - the retry on a start that does not recover (`src/cli.js:644` `retryOneReplyRecords`). A clean scan clears the flag. A damaged scan keeps it, with the reason of the latest attempt, and its records are still merged, because they are valid.
- A privateReply audit line that cannot be written sets the flag. `src/service.js:396-402` `safeAudit` now returns whether the line was written. `src/service.js:675-678` (the error line) and `src/service.js:683-690` (the ok line) call `setOneReplyUnknown` when the line is a privateReply and was not written. The reply itself is reported as sent (the ok path returns normally), as the coordinator asked. `setOneReplyUnknown` is at `src/service.js:319-330`.

Cost, stated for the coordinator: a damaged line in any retained audit file keeps the flag until the file holding it rotates out (50 MB per file, up to the retained rotations). A torn last line after a crash therefore blocks private replies until that rotation. The README bullet on the flag says so.

**M-R1-2. A flag held only in memory can be dropped by a later failed save.** Fixed in two places:

- The flag is saved on its own before anything else in the same step. `src/cli.js:740` (`saveFlagFirst` in `recoverFromAudit`, before `writeAll`), and in `retryOneReplyRecords` when the scan is unknown (`src/cli.js:657`). `saveFlagFirst` is at `src/cli.js:632-640`. A failed save of the flag keeps it in memory, and it is set again after the restore.
- The service holds the flag in the process. `src/service.js:314` reads it at construction, and `setOneReplyUnknown` keeps it there (`src/service.js:319-330`; the flag is saved before any other service save, and a failed save keeps it in process). `privateReply` checks the held flag first (`src/service.js:1249`), so a state that has lost the flag does not lift the refusal. The status reads the held flag first (`src/service.js:838`).

Tests (6 new):

- `test/cli.test.js`: `a damaged privateReply line inside the window sets the flag, and privateReply is refused with no request`. A torn privateReply line is in the audit file, and the state is unreadable. The flag is set with the reason `1 damaged audit line in the retained audit files may be a private reply`. After `stopClear`, `privateReply` is still refused with `STOPPED` and no request is made.
- `test/cli.test.js`: `a clean one-reply scan does not set the flag`. A clean privateReply line gives `oneReplyRecords` of `1 rebuilt from the audit file`, and no flag.
- `test/cli.test.js`: `a flag set by a recovery is on disk before a failed save of another value, so it is set on reload (M-R1-2)`. The state's first write succeeds and its second fails (the counters and records write). The recovery throws the disk error, which reaches the caller as a disk error does for any recovery save. On reload, the flag is set.
- `test/service.test.js`: `a failed privateReply audit write sets the one-reply flag, and the next private reply is refused with no request`. The reply is sent and reported as sent. The flag is in the state, and the status shows it. The next private reply is refused with `STOPPED` and no request.
- `test/service.test.js`: `the one-reply flag is held in process: a state that no longer holds it still refuses a private reply`. The flag is removed from the state after the service starts, and `privateReply` is still refused with no request. The status shows the held reason.
- `test/caps.test.js`: `rebuildPrivateReplies returns the damaged count of its scan, and a clean scan returns zero (I-1)`.

Changed tests: none. Every existing test passes with its assertions unchanged. The only edit to a test file that is not a new test is one import line in `test/cli.test.js` (`import * as nodeFsForCli from 'node:fs'`).

Mutation checks (scratch copy, `test/cli.test.js`, `test/service.test.js`, `test/caps.test.js`):

| Mutation | Result |
|---|---|
| The damaged-line rule removed (`src/cli.js:623`) | 1 failing: the damaged privateReply test |
| The flag not set after a failed privateReply audit write (`src/service.js:683-690`) | 1 failing: the audit-write test |
| The flag not saved first in the recovery (`src/cli.js:740`) | 1 failing: the flag-on-disk test |
| The process hold not checked in `privateReply` (`src/service.js:1249`) | 1 failing: the held-in-process test |

The project's own tree passes all 1060 tests.

Concerns for the coordinator:

- The cost of the damaged-line rule is large, and the coordinator accepted it: a torn last line after a crash blocks private replies until the file rotates out (50 MB per file). A tighter rule would need the damaged line's time, which a torn line does not have.
- M-R1-1 (ReDoS on TOKEN_SHAPE), M-R1-3 and M-R1-4 remain open, as they are outside this request.
- The working tree changed under this round (`src/errors.js`, `src/redact.js`, `src/mcp.js`, `src/http.js` and their tests were modified by other work). The 1060 count includes those tests, so this change's own count is 6 new tests.


##### The owner's confirmed way out: `ig routes clear-one-reply-flag --confirm`

Status: DONE. `npm test`: 1066/1066 pass, exit 0. This change adds 6 tests. The fail-closed default is unchanged: a damaged line still sets the flag, and only this command or a clean later start clears it.

The command:

- `src/cli.js:507` `runRoutesClearOneReplyFlag({ confirm, stateFile, auditFile, out, serveLock, now })`. It is the same shape as `runRoutesAck`:
  - It refuses first while a serve process holds the lock, with `SERVE_RUNNING_MESSAGE` (`src/cli.js:512`).
  - It reads the flag with `readStateView`, which writes nothing. A state file that is unreadable is reported and left alone: no copy aside and no repair write, which `createState` would do.
  - With no flag set, it prints that and writes nothing.
  - With the flag set, it prints `One-reply flag: set since <time>.`, `Reason: <reason>.`, and `Damaged audit lines now: <n>.`. The count comes from a read-only scan (`damagedLinesNow`, `src/cli.js:540`). If the audit file cannot be read now, the line says so and gives the error kind.
  - Without `--confirm` it prints that nothing was changed, and what clearing would mean. It writes nothing.
  - With `--confirm` it creates the state (`createState` is called only on this path), clears `oneReplyUnknown`, saves, and writes one audit line (`src/cli.js:534`): `{ action: 'oneReplyFlagClear', target: null, route: null, outcome: 'ok', detail: null }`. The line has no reason text and no target.
- `bin/ig.js`: the import (`:26`), the subcommand (`:180-197`) with `--confirm`, and the `routes` group description (`:159`), which now reads `settings for the unofficial routes, and the one-reply flag`, so the top-level help shows the command's group.

Help output (commander, from the descriptions):

```
$ ig routes --help
Commands:
  ack-unofficial [options]        acknowledge the unofficial routes warning,
                                  which is needed before they can be enabled
  clear-one-reply-flag [options]  clear the one-reply flag, which refuses
                                  private replies after an unreadable or damaged
                                  audit file (the owner's confirmed way out)

$ ig routes clear-one-reply-flag --help
  --confirm   clear the flag; without it, the flag, its reason and the damaged
              line count are printed and nothing changes
```

Tests (6 new, `test/cli.test.js`):

- `clear-one-reply-flag without --confirm prints the flag, its reason and the damaged line count, and the flag stays`: the state file and the audit file are byte-identical after the preview; the output has the reason and `Damaged audit lines now: 1.`
- `clear-one-reply-flag --confirm clears the flag, and its one audit line has the action and the outcome only`: the flag is null; the audit has one line with action `oneReplyFlagClear`, outcome `ok`, and target, route and detail null; the text `EIO` and `could not be read` are not in the file.
- `clear-one-reply-flag refuses while a serve lock is held, and changes nothing`: a real lock file with a live process id gives `SERVE_RUNNING_MESSAGE`; the flag stays and no audit file is written.
- `clear-one-reply-flag with no flag set changes nothing and writes no audit line`.
- `clear-one-reply-flag on an unreadable state changes nothing: the file is not repaired or copied`.
- `ig routes --help lists clear-one-reply-flag, and its --confirm option`.

Changed tests: none. The only change to an existing line in `test/cli.test.js` is one added import (`runRoutesClearOneReplyFlag`).

Mutation checks (scratch copy; the command's function only):

| Mutation | Result |
|---|---|
| A clear without `--confirm` (`src/cli.js:507` range, `if (confirm !== true)`) | 1 failing: the no-confirm test |
| No serve-lock check (`src/cli.js:512`) | 1 failing: the serve-lock test |
| The audit line carries the reason (`src/cli.js:534`) | 2 failing: the audit-content test, and the help test |

The third row's second failure is a stale `bin/ig.js` in the scratch copy, which does not affect the result. The first two rows were rerun with the edit limited to the function's range, after a first run had mutated `runRoutesAck` by mistake.

README wording (P7 document; the wording is listed here for the report):

- The commands table row, after the `ig routes ack-unofficial --confirm` row (`README.md:77`):
  `| \`ig routes clear-one-reply-flag --confirm\` | Clears the one-reply flag that refuses private replies after an unreadable or damaged audit file. Without \`--confirm\` it prints the flag, its reason and the damaged line count, and changes nothing. Refuses while \`ig serve\` holds its lock. See "Recovery from a damaged state file". |`
- The recovery section, a new bullet after the last one (`README.md:194`):
  "**The owner's confirmed way out of the one-reply flag: `ig routes clear-one-reply-flag`.** Without `--confirm` it prints the flag (`since` and `reason`), and the number of damaged audit lines in the retained files now. It changes nothing. With `--confirm` it clears the flag, and writes one audit line with the action `oneReplyFlagClear` and the outcome `ok`; that line has no text and no target. It refuses while `ig serve` holds its lock, so stop the service first. Clearing the flag lets private replies through again without a check of the one-reply records, so only Meta's one-reply rule applies to a comment whose reply the records do not show. Use it when the cause is known and accepted; the default stays fail-closed, so a damaged line keeps the flag until its file rotates out, unless the owner clears it."

Concern for the coordinator: the clear is unconditional with `--confirm`. It does not check that the damaged line is gone, because the owner has the final say, as asked.
