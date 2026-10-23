# Task 8 re-review 1: I-1 (impossible calendar day in parseTime)

Scope: I-1 only, from task-8-review.md. Fix diff: review-task-8-fix1.diff (task-8-head to task-8-fix1-head). Read: task-8-brief.md, task-8-review.md, the fix round 1 section of task-8-report.md, the fix diff, and src/graph/endpoints/messaging.js. No project file was edited and no subagents were used. Checks ran on Node v24.6.0, the only Node on this machine. Node 22.12 was not run (controller ruling 2, carry-forward). m-1 to m-6 are deferred (controller ruling 3) and are not re-reviewed.

## Finding verdict

**I-1: ADDRESSED.**

Evidence:

- The fix is at messaging.js:176-180. It runs after TIME_PATTERN matches (:174) and before `Date.parse` (:182). It reads year, month and day from `match[1].slice(0, 10)`, which is the YYYY-MM-DD part only. The time, fraction and zone do not enter the check. The day is compared with `new Date(Date.UTC(year, month, 0)).getUTCDate()`, which is the length of the 1-based month. The refusal is `VALIDATION` with `${name} is not a real calendar date`, and the value is not echoed.
- Impossible days are refused (focused probe through the exported functions, Node v24.6.0):
  - `2026-09-31T12:00:00+0000` and `2026-09-31T12:00:00Z`: VALIDATION, "commentCreatedAt is not a real calendar date" (privateReplyOpen).
  - `2026-04-31T12:00:00Z`, `2026-06-31T12:00:00Z`, `2026-11-31T12:00:00Z`, `2026-02-30T12:00:00Z`, `2026-02-29T12:00:00Z`: VALIDATION, same message.
  - `2026-02-30T00:00:00.5-03:00`: VALIDATION, same message.
  - Review example: `messageWindowOpen({ lastInboundAt: '2026-09-31T12:00:00Z', now: 2026-10-02T11:00Z })` throws VALIDATION, "lastInboundAt is not a real calendar date". It does not return true. Before the fix, `Date.parse` gave 2026-10-01T12:00Z, which is 23 hours before now.
  - `2026-04-31T12:00:00Z` with `now` = 2026-05-01T11:00Z: VALIDATION. Before the fix this would also read open.
- Valid dates are still accepted: `2026-01-31`, `2026-02-28`, `2026-04-30`, `2000-02-29` and `0096-02-29` each returned `false` (closed, not refused). `2100-02-29` and `1900-02-29` are refused, which is correct because neither is a leap year. `2028-02-29T12:00:00Z` is accepted by `messageWindowOpen` with `now` one hour later, as the new test checks.
- Time-of-day portions: `2026-01-30T24:00:00Z`, `2026-01-31T24:00:00Z`, `2026-02-28T24:00:00Z` and `2026-09-30T24:00:00Z` are accepted, since 24:00 is the next midnight. `2026-09-30T25:00:00Z` is refused as "not a valid time", from `Date.parse`. `2026-02-29T25:00:00Z` is refused by the new check, so the check fires on the date before the time is looked at. These confirm the check reads the date portion only.
- Exhaustive sweep: every year-month-day from 1900-01-01 to 2400-12-31, with day 01 to 31 (186,372 stamps), through `privateReplyOpen` with `now` = 2500-01-01. Each stamp was compared with an independent `Date.UTC` calendar check. Result: 0 mismatches.
- Years 0000 to 0099, against a hand-coded month-length table: 1 mismatch, `0000-02-29T12:00:00Z`, refused. This is controller ruling 1. `Date.UTC` maps years 0 to 99 onto 1900 to 1999, and 1900 is not a leap year, so year 0000 is the only year in that range affected.
- The check cannot silently pass on a NaN. `TIME_PATTERN` (:21) fixes `match[1]` to a 4-2-2 digit date followed by the time, so `slice(0, 10)` is always YYYY-MM-DD and `split` and `Number` always give finite integers.
- `Date.parse` is called once in the module (:182). It runs after the new check, and both window functions reach it only through `parseTime`. There is no other path.
- The four tests the review required are in the test diff: 2026-09-31 with +0000 throws VALIDATION; 2026-02-29 throws VALIDATION; 2028-02-29 is accepted; `messageWindowOpen` with the impossible `lastInboundAt` throws and does not return true.
- Focused run: `node --test test/endpoints-messaging.test.js` gives 25 pass, 0 fail (Node v24.6.0). Only that file was run. The full suite was not re-run.
- Pre-fix behaviour, to show the new tests are meaningful: on Node v24.6.0, `Date.parse` gives `2026-09-31T12:00:00+00:00` as 2026-10-01T12:00Z, `2026-02-29T12:00:00Z` as 2026-03-01T12:00Z, and `2026-04-31T12:00:00Z` as 2026-05-01T12:00Z. The three new tests therefore fail on the unfixed code, which matches the report's RED run.

## New breakage in the fix diff

None.

- Valid date refused: none in the sweep, except `0000-02-29` (controller ruling 1). The refusal is fail-closed and loud (VALIDATION, not a silent "open").
- Impossible day accepted: none. The four controller dates (`2026-04-31`, `2026-06-31`, `2026-11-31`, `2026-02-30`) and all 186,372 swept stamps are refused as specified.
- Regex accepts the value without the day check: no. See the shape point in the Finding verdict.
- Fail-open path: none. The change only adds refusals, so it cannot make a closed window read open.
- Test changes: the three added tests use `assert.throws` with a validation function that returns a boolean, and `{ kind }` matching, as the existing tests do. Their assertions match the code's behaviour.

## Out-of-scope observations (not counted)

1. The implementer's report (task-8-report.md, fix round 1, Self-review of the fix) says the check "does not rely on how a given engine handles impossible dates". That is only partly true. The new check covers day-of-month overflow only. Day 00, month 00 and month 13 are still refused by `Date.parse` returning NaN. The probe shows `2026-02-00`, `2026-00-15` and `2026-13-15` each refused as "not a valid time". This is the same as before the fix, and it is not a fail-open on V8. The report's wording should be corrected in the ledger.
2. Fragility, for a future edit: the day check reads its numbers from the fixed-width prefix of the regex match. If `TIME_PATTERN` is loosened later (a variable-width year, or the basic ISO form without dashes), `day` could become NaN, and `NaN > x` is false, so the check would pass silently. No change is needed now. A comment or a test on the pattern would protect it if the pattern changes.
3. Carry-forwards from the controller: run the three new tests and the module on Node 22.12 in the verification task (ruling 2). m-1 to m-6 are deferred (ruling 3).

## Round verdict

I-1 addressed with no new Critical or Important breakage.

New issues this round: Critical 0, Important 0, Minor 0.
