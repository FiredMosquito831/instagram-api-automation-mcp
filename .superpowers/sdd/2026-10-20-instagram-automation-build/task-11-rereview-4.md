# Task 11 re-review: fix round 4 (task-11-rereview-23.md: N-1, N-2, O-3)

Scope: read-only review of review-task-11-fix4.diff (task-11-fix3-head to task-11-fix4-head), against the three items named in task-11-rereview-23.md. The project is not a git repository. The nine changed files were checked with `diff -q` against the fix4 snapshot, and they are identical to it. The suite was not re-run (the report's 434/434 is taken as stated). No project file was edited.

Focused checks run:
- Node v24.6.0, `node --input-type=module`, importing src/calendar.js: isRealDate compared with a Gregorian month-length table for every year 0000 to 9999, month 0 to 13, and day 0 to 32 (4,620,000 calls). One mismatch: 0000-02-29 (refused; see N-1).
- Node v24.6.0: the poller's newestFirst comparator (poller.js:79) applied to a mixed list. Output: the dated threads first, newest first, then the threads with an undatable updated_time in list order.
- Grep of src/ for getUTCDate, Date.UTC and isRealDate: one copy of the day check remains (calendar.js:10).

---

## Finding verdicts

### N-1. ADDRESSED

- One shared check. The helper is src/calendar.js:7-11, `isRealDate`. src/events.js:15 imports it and calls it in parseIsoTime at events.js:69, before Date.parse at events.js:70. src/graph/endpoints/messaging.js:6 imports it and calls it in parseTime at messaging.js:192, before Date.parse at messaging.js:196. No other copy of the day check exists in src/.
- Lower bounds: calendar.js:8 (month is an integer from 1 to 12) and calendar.js:9 (day is an integer of at least 1). Upper bound: calendar.js:10 (day is at most the length of the month, from `Date.UTC(year, month, 0)`). NaN, fractional and negative inputs return false (checked).
- Leap rule: calendar.js:10 takes it from the native calendar. The exhaustive check agrees with "divisible by 4, except centuries, unless divisible by 400" for every year 0000 to 9999, with one exception. 0000-02-29 is refused, though year 0 is a leap year, because Date.UTC maps years 0 to 99 onto 1900 to 1999. This is the Task 8 ruling accepted at progress.md:213, and the old check gave the same result. It is a fail-closed refusal of a valid date, not an accepted impossible date. Not counted.
- Boundaries and tests: calendar.test.js:8 (day 00, day 32, 2026-04-31, 2026-09-31 refused; 2026-01-31 and 2026-04-30 accepted), :17 (month 0 and 13 refused; months 1 and 12 accepted, with day 1 and day 31), :24 (2026-02-29 refused, 2026-02-28 accepted, 2028 and 2000 accepted, 1900 refused), :32 (NaN, fractional and negative days refused). events.test.js:277 (2026-02-00, 2026-00-15, 2026-13-15, 2026-04-31 and 2026-02-29 refused and nothing stored; 2028-02-29 accepted). endpoints-messaging.test.js:340 (the refusal message names the calendar check, so the lower bounds are tested without relying on Date.parse).
- Import direction: calendar.js has no imports (calendar.js:1-11), so there is no require cycle.

### N-2. ADDRESSED

- The kind comes from the guard. poller.js:155 reads `guard.stopStatus().kind` into `held`. The stop_not_saved line uses `held` (poller.js:156). The observed kind is used only for the stop_kept comparison (poller.js:158) and the backoff or halted branch (poller.js:159-166).
- Why `held` is the right kind: guard.stop saves only `current` (guard.js:213-214, `persist({ ...current })`). `current` is the stop the guard holds after any replacement (guard.js:199-212). A save that fails therefore always belongs to the held stop. The retry of an earlier unsaved stored stop runs inside guard.stop whenever `unsaved` is true (guard.js:213-214), whether or not the new stop replaces it, so the save that fails can be for a stored kind.
- The question asked: a test covers a stored unsaved CHECKPOINT with an observed RATE_LIMITED, the save retry fails, and the audit names CHECKPOINT. It is poller.test.js:677 ("a failed save of a stored stop is named by its kind when a different kind was observed"). It asserts, in order, stop_not_saved CHECKPOINT, stop_kept {observed RATE_LIMITED, stored CHECKPOINT} and backoff RATE_LIMITED, then that the next tick is halted and makes no request. Naming the observed kind would fail its first audit assertion.
- The brief's literal example (store an unsaved RATE_LIMITED, observe CHECKPOINT, fail the save, expect RATE_LIMITED) cannot occur under the severity rule. CHECKPOINT ranks higher and replaces the unsaved RATE_LIMITED in memory (guard.js:202), so the failed save is CHECKPOINT's. poller.test.js:650 covers that scenario and expects CHECKPOINT. Together, the two tests cover both directions of an unsaved stored stop.
- The stop_kept line now also fires on the failed-save path (poller.js:158). Before this round it did not, so the audit now shows both the failed save and the kept stop. This is the intended behaviour, and the test pins it.

### O-3. ADDRESSED (the wording of the corrected line has one imprecision, carried as N-3)

- The stale claim is corrected. task-11-report.md:138-143 now states that: an absent or blank updated_time is null, is skipped and audited as poll.skip (messaging.js:69-73 and :95; poller.js:242-244); a present value that is not text fails the list or the thread with API_ERROR (messaging.js:72); and a text created_time that is not an ISO time with a zone is refused by the event log and audited as poll.skip (poller.js:185-198; events.js:252-254). Each of these matches the code.
- Still imprecise: report lines 140-141 say a text updated_time that Date cannot parse "is still read, in Graph's list order". The code reads it, but it sorts it after every dated thread (poller.js:74-77 gives -Infinity; poller.js:79 and :252). It is in list order only among the undatable threads (see the node check above). Under maxThreadsPerTick (poller.js:253) these threads are the last to be selected. This is N-3 below.

---

## New breakage

- **N-3. Minor. Report wording. task-11-report.md:140-141.** The corrected line says an unparseable text updated_time "is still read, in Graph's list order". The code reads those threads after every dated thread (poller.js:74-79, 246-253), in list order only among themselves. Fix: say they are read after the dated threads, in Graph's list order among themselves. No code change.

- Checked and none found in the changed lines:
  - Impossible date accepted: none. Across 0000 to 9999 the helper accepts exactly the real dates, except that it refuses the valid 0000-02-29 (fail-closed; accepted ruling, progress.md:213).
  - Date still rolled forward: none in the changed lines. Both callers check the calendar before Date.parse (events.js:69-70; messaging.js:192-196). The only remaining roll is a 24:00 time, which is the same instant ISO 8601 gives and is on a real date.
  - Stop kind named wrongly: none. poller.js:155-158 read the held kind, and guard.js:213-214 persists only the held stop.
  - Parser throws on a valid value: none. isRealDate cannot throw (a NaN year returns false, checked). Every real date passes, and no date accepted before is now refused, apart from the existing 0000-02-29.
  - Require cycle: none. calendar.js has no imports; events.js and messaging.js import it and nothing imports them back.
  - Fail-open: none. An impossible time is refused: messaging.js:192-193 throws VALIDATION, and events.js:69 returns NaN, which events.js:253-254 refuses, so poller.js:185-198 audits it as skipped and does not store it. A failed stop save still halts this process: guard.js:199-216 keeps the stop in memory, and poller.js:146-166 halts on it.

- Noted, outside this round's diff, not counted: task-11-report.md:88-89 still says the poller lists "one page, the list default of 20". That has been stale since fix round 2, when the list asked for 100 (poller.js:32, :225). It is not one of the O-3 lines and the round did not change it.

---

## Round verdict

PASS, with one Minor finding open: N-3 (report wording at task-11-report.md:140-141). New issues: 0 Critical, 0 Important, 1 Minor. The code for N-1 and N-2 is correct, and the report line for O-3 needs one phrase changed before the report is cited.
