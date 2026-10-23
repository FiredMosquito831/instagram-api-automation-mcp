# Task 11 re-review: fix rounds 2 and 3 (task-11-fix1-head to task-11-fix3-head)

Scope: read-only re-review of the net change in review-task-11-fix23.diff, against the in-scope items of task-11-review.md, the constraints, the ledger (progress.md, Task 11 entries) and task-11-report.md (its claims were checked, not taken). The project is not a git repository; no project file was edited. The suite was not re-run; the report's 426/426 is taken as stated.

Focused checks run (no project file changed):
- `node -e` on Node v24.6.0: Date.parse of day 00, month 00, month 13, month 14, day 32, impossible days 02-30, 09-31, 02-29, 04-31, leap day 2028-02-29, hour 25, minute 60, second 60, and 24:00. Day 00, month 00, month 13 and day 32 give NaN. 2026-02-30, 2026-09-31, 2026-02-29 and 2026-04-31 roll forward, which is why the day check is needed. 2028-02-29 is valid. 24:00:00 is accepted as the end of the day, which is the same instant ISO 8601 gives it.
- Greps for every caller of guard.stop (only poller.js:148 in src), every consumer of conversationsList and conversationMessages (only the poller), and the state temp-file path (state.js:59, `${file}.tmp`, which the injected save failures in the tests depend on).

Line references are to the current project files, not to diff lines.

---

## Finding verdicts

### I-1. Impossible calendar date: ADDRESSED
- events.js:66-70, `parseIsoTime`: the ISO_TIME shape check (events.js:29) is followed by `day > new Date(Date.UTC(year, month, 0)).getUTCDate()` returning NaN, before `Date.parse`. The expression is the one in messaging.js:188-192 (`parseTime`).
- events.js:252-254, `newEventFields`: a NaN receivedAt is refused with VALIDATION, so `events.append` refuses 2026-02-30 and stores nothing.
- poller.js:192-196: the VALIDATION is caught, and the message is audited as `poll.skip` with detail VALIDATION (poller.js:195) and not stored.
- Leap day: events.js:69 accepts 2028-02-29, because the month has 29 days in 2028 (checked).
- Stored values are always `toISOString()` output (events.js:262), so the stored-line validator at events.js:94, which now also calls parseIsoTime, does not refuse existing data.
- Tests: events.test.js:258-274 (refuses 2026-02-30, 2026-09-31 and 2026-02-29 and checks nothing is stored; accepts 2028-02-29); poller.test.js:511-530 (impossible day skipped and audited, nothing stored, delivered only m_1).
- Residual, latent only: the check covers the upper day bound only. See N-1.

### I-2. Stop severity: ADDRESSED
- guard.js:25-33, `STOP_RANK`: AUTH_EXPIRED, CHECKPOINT and ACTION_BLOCKED 3; RATE_LIMITED 2; STATE_LOST and STATE_CORRUPT 1. A kind not in the map has rank 0 (guard.js:33). Matches the ruling.
- guard.js:202: `replaces = !current.stopped || (known && rankOf(kind) > rankOf(current.kind))`. The comparison is strict, so an equal rank keeps the stored record, with its detail and since. A lower rank does not replace.
- guard.js:213-216: a replacement is persisted in the same call (`persist` at 143-150). A failed save raises CONFIG, keeps `unsaved` true, and is retried by assertNotStopped (guard.js:184).
- Unknown kind: guard.js:200-202 gives `known` false, so a stored stop is never replaced. With no stored stop it is recorded as ACTION_BLOCKED and refused with VALIDATION (guard.js:217-219), as the ruling says.
- clearStop (guard.js:225-232) and shouldStop (guard.js:242-244) are outside the diff hunks (the guard diff hunks are at old lines 13-33 and 173-202 only). Unchanged. The poller's halt release (poller.js:131-139) is unchanged.
- The poller audits every observed stop: poller.js:148 keeps the returned stored status; poller.js:154-156 writes `stop_kept` with `{ observed, stored }` (kinds only) when the guard keeps a different kind; poller.js:157-164 writes the backoff or halted line for every observed stop; poller.js:149-151 writes stop_not_saved when the save fails.
- The pinned first-kept test was updated: guard.test.js:131-139. Old assertion `kind === 'RATE_LIMITED'`; new assertion `kind === 'AUTH_EXPIRED'`. The report (lines 288-294) shows both, and they match the file.
- Tests: guard.test.js:141-161 (CHECKPOINT over RATE replaces and survives a reload; RATE over CHECKPOINT does not); 163-177 (equal rank keeps detail and since, and the restart reads the kept detail); 179-185 (unknown kind never replaces); 187-201 (failed save still stops this process, and is saved on the next call). poller.test.js:565-610 (observed CHECKPOINT replaces a stored RATE; the owner clear is previewed and then confirmed; observed RATE under stored CHECKPOINT is audited as stop_kept and does not replace it).

### I-3. Paging: ADDRESSED in code; the live effect is not verified (see O-2)
- poller.js:32 `CONVERSATION_PAGE = 100`; poller.js:223 passes `limit: CONVERSATION_PAGE`. The endpoint allows 100 (messaging.js:13, checked at 126).
- poller.js:33 `MESSAGE_PAGE = 20`. conversationMessages keeps its default of 20 (messaging.js:137), and its maximum is 20 (messaging.js:15, checked at 139). The message request is not raised to 100, so the code does not send a limit the endpoint would refuse.
- Truncated audits: poller.js:229-236 (a full list writes `poll.list` with outcome `truncated`, detail `{ returned, limit }`); poller.js:258-265 (a full thread page writes `poll.messages` with outcome `truncated`, target the conversation id, the same counts). Counts only.
- Report corrected: report lines 131-134 describe the first-page limit correctly. Report line 140 is stale; see O-3.
- Tests: poller.test.js:485-497 (full conversation page, list limit 100 asserted, one truncated line); 499-509 (full message page, one truncated line with counts).

### m-1. Message with no created_time: ADDRESSED
- poller.js:179-182: `!hasTime(message.createdTime)` is audited as `poll.skip`, detail VALIDATION, and skipped before the append. Nothing is stored at the clock time. The check sits after the owner and dedupe checks and before `events.append`.
- messaging.js:104 gives a missing or blank created_time as null (timeOrNull, 68-72).
- Tests: poller.test.js:532-548 (absent created_time: the other message is stored, errors 0, thread marked read, one poll.skip line); 550-563 (blank created_time).

### m-2. Conversation with no updated_time: ADDRESSED
- messaging.js:91-96: updatedTime is `timeOrNull`, so a missing or blank updated_time gives null and the list is not refused. A present non-text value still gives API_ERROR (messaging.js:68-72, via requiredString at 71).
- poller.js:239-243: each null conversation is audited as `poll.skip`, detail VALIDATION, on every tick (ruling d).
- poller.js:246-249: the changed filter requires `hasTime(updatedTime)` before the comparison, so null is never read as changed and the stored seen value is not overwritten.
- The other conversations are read: endpoints-messaging.test.js:133-147; poller.test.js:363-383 (null conversation not read, stored value kept, the other thread read, one skip line).

### m-3. Thread failure from a missing created_time: ADDRESSED for the cause the controller set; see O-1
- messaging.js:100-109: createdTime is `timeOrNull`, so one message with no created_time no longer fails its thread. Other message fields keep requiredString (fromId at 105 through refId, text through optionalText).
- poller.js:179-182 skips that message.
- Tests: endpoints-messaging.test.js:181-200 (the thread returns the other messages; the absent and blank times give null; a present number still gives API_ERROR); poller.test.js:532-548.
- Caveat: the review's own m-3 (review line 87) is a different item, selection-slot starvation. It is not closed by this round, and it is not on the controller's deferred list. See O-1.

### m-7. Test gaps: ADDRESSED
- stop_not_saved branch: poller.test.js:611-633. The state temp path is blocked by a directory (state.js:59 makes `${file}.tmp`). The guard throws CONFIG (guard.js:143-150). The poller audits `stop_not_saved` (poller.js:151), halts in this process, and the next tick makes no read.
- Stored STATE_LOST does not halt reads: poller.test.js:634-643. HALTING (poller.js:17) holds AUTH_EXPIRED, CHECKPOINT and ACTION_BLOCKED only. The tick reads and stores m_1, and the STATE_LOST stop is left in place.
- The impossible-date test (m-7 item) is poller.test.js:511-530 and events.test.js:258-274. The halt-outlasts-a-stored-stop test is poller.test.js:565-587 and 588-610.

### Controller rulings to accept (checked against the code, not defects)
- (a) Preview clear keeps CHECKPOINT; confirmed clear removes it: poller.test.js:565-587 (`clearStop(false)` returns 'preview'; `clearStop(true)` returns 'cleared').
- (b) Messages beyond the first page are not read and are audited as truncated: poller.js:258-265.
- (c) A present non-text created_time or updated_time still fails the read: messaging.js:68-72 and 94, 104. The failure is audited on every tick: poller.js:166 (`error`), via poller.js:225-226 for the list and 276-279 for a thread. Note that a non-text updated_time on any one conversation fails the whole list, so no thread is read until it is fixed (see O-2).
- (d) A null-updated conversation is audited on every tick: poller.js:239-243.
- (e) The blank-time checks are redundant: events.js:252-254 already refuses null and blank text (VALIDATION), so the poller's own checks (poller.js:179-182 and 240, 247) produce the same audit line.

---

## New breakage in the fix diff

Checklist, as the controller listed it:
- Stop replaced by a lower or equal rank: none. guard.js:202 uses a strict comparison.
- Stop kind stored but not saved: none on the replacement path (guard.js:213-216). The save-failure path keeps the stop in process and retries it (guard.js:184). That is the accepted limit.
- Clear path changed by mistake: none. The guard diff touches only the rank table and stop(). clearStop, shouldStop, readRecord and the STATE_LOST startup check are unchanged. The poller's halt release (poller.js:131-139) is unchanged.
- Date still rolled forward in events.js or messaging.js: none for a value that reaches storage or a window (checked on v24.6.0). Latent: see N-1.
- Message stored with a guessed time: none. A null time is skipped (poller.js:179-182), and events.js:252-254 refuses null anyway.
- Conversation with a null updated time treated as changed: none (poller.js:246-249).
- Poll throws on a null field instead of skipping it: none found. The sort comparators tolerate null (poller.js:74-80: timeOf gives -Infinity for a non-date). The conversation sort runs only after the filter (poller.js:244-251). The message sort sees a null createdTime, which is handled. eventTime(null) returns null without throwing (poller.js:68-71).
- Body or page read still unbounded: none added. Pages are bounded by limit 100 (messaging.js:126) and by 20 (messaging.js:143). conversationsList does not cut the rows to its limit (messaging.js:132). That is unchanged from Task 8; see O-4.
- Audit line carries message text: none. Every new audit line carries a kind, an outcome, a numeric count, or an id (poller.js:155, 233-234, 241, 262-263, 180).
- Test that asserts nothing or pins wrong behaviour: none found. The changed tests assert the new behaviour and show the old assertions in the report. The equal-rank test pins the ruled keep behaviour. The same-kind double-stop tests (guard.test.js:166-173, 359-367) still hold under the rule.
- Fail-open path: none new. The only halt that is not persisted is the save-failure case (guard.js:213-216 and poller.js:149-151), which is the accepted limit and is still halted in process.

New findings:

**N-1. Minor. The day check covers only the upper bound. events.js:69 and messaging.js:190.**
A day of 00 (`2026-02-00`), a month of 00 (`2026-00-15`) or a month of 13 or more (`2026-13-15`) passes the check and is left to Date.parse. On Node v24.6.0 Date.parse returns NaN for each (checked), so nothing rolls today. Node 22 has not been run, and the check does not depend on Date.parse for the days that matter. Fix: check `month` is 1 to 12 and `day` is 1 to the month length, in both places. Cost if left: none on Node 24; a possible silent roll on an engine that accepts those values.

**N-2. Minor. The stop_not_saved audit names the observed kind, not the unsaved kind. poller.js:149-151.**
When the failing save is of an earlier unsaved stored stop (a different kind), the audit line names the observed kind. The in-process halt is correct, because the earlier stop is held in process (guard.js:184-216). The owner's audit trail shows the wrong kind for the save that failed. Cosmetic for safety; it affects audit accuracy only.

---

## Out-of-scope observations

**O-1. The review's original m-3 is not closed, and the ledger merges it with the null-time item. Check before the controller closes Task 11.**
Review line 87 describes a failing thread that keeps its updated_time, so it stays first in the newest-first order. With maxThreadsPerTick at 1 it starves every other thread. Round 3 removes only the null-created_time trigger. Any other persistent failure of a thread still starves: a non-text created_time (the accepted ruling c), or an API_ERROR from one message read. The selection is at poller.js:244-251, and a failed thread is not marked seen (poller.js:267 is reached only on success). The default maxThreadsPerTick is 20 (config.js:60), so the impact at default is smaller. progress.md line 252 treats the two items as one. Either list the starvation item as deferred, or fix it (skip or deprioritise a thread that failed on the previous tick).

**O-2. Live check needed for I-3 and the page cap.**
The I-3 fix assumes Graph honours `limit=100` on the conversations edge. research_notes/Instagram CLI automation landscape/messaging_and_webhooks.md:56 says the Conversations API page documents no `limit` parameter. If Graph ignores it and returns its default page, the truncated audit (poller.js:229) never fires, and conversations past the default page stay unread without a trace. The message limit (messaging.js:15) has the same open question. Confirm both in the live phase before Task 13. Also: a non-text updated_time on one conversation fails the whole list every tick (accepted ruling c), so one bad row silences all inbound until it is fixed.

**O-3. Stale report text.**
report line 140 says "If updated_time is not parseable, the threads are read in Graph's list order." The code (poller.js:239-251) skips a null or blank updated_time and never reads that conversation. A non-text value fails the list. Report lines 161-162 (round 0 self-review) are also superseded. Correct before the report is cited.

**O-4. Unchanged from Task 8: conversationsList does not cut rows to its limit.**
messaging.js:132 maps every row Graph returns. conversationMessages does cut to its limit (messaging.js:143). Threads read per tick are capped (poller.js:251), so the effect is bounded by the response size only. Task 5 m-5 (no body size cap) still applies.

**O-5. A full list writes one audit line per tick.**
poller.js:229-236 writes a truncated line on every tick while the account has 100 or more conversations (60 s by default, about 1,440 lines a day). Audit growth is the Task 18 retention carry-forward (m-11 pattern).

**O-6. Null-time messages are not retried.**
After a skip, the thread is marked read (poller.js:267), so a message skipped for a missing created_time is not read again unless the thread changes. The skip is not counted in the tick summary (the m-9 pattern). The owner sees it only in the audit log. This is the cost of the m-1 ruling and is recorded here for the owner.

**O-7. A RATE_LIMITED stop can replace a stored STATE_LOST stop.**
By the rank table (guard.js:25-33, 202), a RATE_LIMITED (rank 2) replaces a stored STATE_LOST (rank 1). The owner then sees RATE_LIMITED, and the state-loss reason is not shown until the stop is cleared. No audit line records the replaced kind. This follows from the ruled table; the owner should know it.

**O-8. In-tick halt still open (m-5).**
The RATE-under-CHECKPOINT test (poller.test.js:588-610) shows the poller still reads a thread after a CHECKPOINT was stored in the same tick. The halt is checked only at the start of the tick (poller.js:287-289). This is the m-5 deferral, unchanged.

**O-9. Pre-existing, outside the diff: a stored since is checked with Date.parse only.**
guard.js:95 accepts a since with an impossible calendar day. It is reachable only by editing the state file, and since is informational. Not a stop-path issue. Carry forward to the final review with N-1.

**O-10. Node 22 not run.**
The date check and the ISO handling are verified on Node v24.6.0 only. Carry-forward to Task 18 (already in the ledger).

---

## Round verdict

PASS. All in-scope items (I-1, I-2, I-3, m-1, m-2, m-3, m-7, and the five controller rulings) are ADDRESSED as the controller defined them, with file:line evidence above. No new Critical or Important breakage in the fix diff. New issues: 0 Critical, 0 Important, 2 Minor (N-1, N-2).

Items for the controller, not blocking this round:
- O-1: the review's original m-3 (selection-slot starvation) is not closed and is not on the deferred list. Decide and record it.
- O-2: the limit=100 and the thread-level behaviour need a live check before Task 13.
- O-3: report line 140 is stale and should be corrected.
