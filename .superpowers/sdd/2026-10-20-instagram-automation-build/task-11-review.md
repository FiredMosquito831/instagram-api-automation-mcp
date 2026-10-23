# Task 11 review: poller (full task gate, task-11-base to task-11-fix1-head)

Scope: read-only review of the net diff (review-task-11.diff) against the brief, the global constraints, the ledger and the implementer report. Modules checked for named risks: src/guard.js, src/events.js, src/graph/endpoints/messaging.js, src/errors.js, src/config.js, src/audit.js. File:line references are to the project files. The line numbers of src/poller.js match the snapshot (diff line minus 14). The suite was not re-run; the report's 409/409 is taken as stated.

Focused checks run:
- Date.parse on impossible calendar days, on node v24.6.0 (Node 22 has not been run, as the ledger records). `2026-02-30T12:00:00+00:00` parses to 2026-03-02T12:00:00.000Z, and `2026-09-31T12:00:00+00:00` to 2026-10-01. This is the basis of I-1.
- Presence in the test file of the paths named in m-7 (grep found no test for stop_not_saved, STATE_LOST, STATE_CORRUPT, impossible dates, or a thread-level RATE_LIMITED).

Not verifiable from the diff: the live formats of created_time and updated_time (Task 8 ruling), the real OS keyring and client behaviour, and Node 22.

---

## Spec compliance

Verdict: ❌ one requirement missed (I-1: an impossible calendar date in created_time is stored at a rolled-over receivedAt). Everything else on the list is met, with the deviations and the accepted known limit noted below.

- ✅ createPoller interface, src/poller.js:97-128. Deviation: `audit` is a required argument and `config` is the full config. Controller ruling 1 accepted this. ⚠️ accepted interface change, not a defect.
- ✅ tick step 1, list and spacing: src/poller.js:207-208; spacing wrapper at 82-93; the list uses the default limit of 20 (messaging.js:12, 111-121).
- ✅ tick step 2, changed threads only, capped at maxThreadsPerTick, newest first: src/poller.js:213-220 (state comparison, newestFirst at 75, slice at 220).
- ✅ tick step 3, owner messages skipped and dedupe before append: src/poller.js:166-167; the append fields are at 171-176.
- ✅ receivedAt from the message's own time: src/poller.js:175, with the +hhmm to +hh:mm conversion (controller ruling 4; events.js:29 needs the colon form).
- ❌ "never stored with a guessed time": an impossible calendar date passes the event log's check and is stored at a rolled-over time (events.js:29, 64-66; poller.js:175). See I-1.
- ✅ tick step 4, seen value stored after the thread's messages: src/poller.js:227-228.
- ✅ tick step 5, onInbound once per new event, after the store, including on a partial failure: src/poller.js:186-194.
- ✅ start() and stop(): src/poller.js:280-290. ⚠️ Not tested (m-6); checked by reading only.
- ✅ AUTH_EXPIRED, CHECKPOINT and ACTION_BLOCKED call guard.stop with the kind and halt: src/poller.js:143, 153. The stop is persisted when no other stop is stored (guard.js:190-201).
- ⚠️ When a non-halting stop is already stored, the halting kind is not persisted (guard.js:190; poller.js:143 ignores the return). This is the accepted known limit. Its clear-path consequence is not in the accepted text and is reported as I-2.
- ✅ RATE_LIMITED: guard.stop (poller.js:143); the tick returns before any thread is read (poller.js:150-152 and 239); the interval doubles, capped at 10 minutes (poller.js:149); no halt (poller.js:133 covers halting kinds only); the interval returns to poll.intervalMs after an ok tick (poller.js:198).
- ✅ Other errors audited, loop continues: poller.js:157-158 (audit with kind and action, return 'continue').
- ✅ Halt on a stored stop: a tick makes no request while halted (poller.js:127-134 and 249). A halting stop saved by an earlier process halts it (test: a persisted halt holds after a restart). ⚠️ A stored STATE_LOST or STATE_CORRUPT does not halt reads (m-13).
- ✅ A cleared stop resumes: poller.js:129-131 (test: a cleared stop resumes the poller without a restart).
- ✅ Dedupe by message id across ticks and after a state loss: poller.js:167; events.js:279-281 refuses a repeated id as a second line of defence.
- ✅ Spacing through the injected sleep, including the per-message reads: spacedReader at poller.js:82-93 wraps every get; the test checks the exact sleep and get sequence.
- ✅ 20-thread limit, most recent first: messaging.js:12, 111-121; poller.js:75, 213-220.
- ⚠️ No updated time, fail closed: the poller filter at poller.js:216 requires a non-empty value, and the endpoint refuses the whole list when one row lacks updated_time (messaging.js:84). Fail closed, but one bad row stops all inbound (m-2).
- ✅ created_time that does not parse is skipped and audited, for non-ISO text: events.js:65 gives NaN, events.append throws VALIDATION, poller.js:179-180 audits it. ❌ for an impossible calendar date (I-1).
- ✅ Reads only: spacedReader exposes get and nothing else (poller.js:87); no retryPost and no write method is reachable; the tests assert writes is empty.
- ✅ Only the first page, and the report says so (report lines 131-133). The report's account of the thread case is wrong (I-3).
- ✅ Audit lines carry kind and action, never message text: poller.js:146, 153, 158, 180, 191; the test puts a sentinel in the Graph message and checks it reaches neither the stop nor the audit file.
- ✅ Fail-open checks: a halting error always sets the stop, since guard.stop sets the in-process stop before the save (guard.js:190-201). No halting stop is lost across a restart. No event is stored twice on the code paths read (poller.js:167; events.js:279-281). A clock read as zero is not a path: the poller's `now` only stamps the summary (poller.js:199). The fail-open paths found are I-1 and I-2.
- Global constraints: line 9 (confirmation) and the messaging-window and cursor rules do not apply to reads. Line 15 is met: events.append sets untrusted: true (events.js:285). Line 26 is met: the stop detail is numeric only (poller.js:54-57; errors.js:58-75 yields integer status and code).

---

## Strengths

- The stop path is complete. All four stop kinds go through guard.stop with a detail built only from the kind and two integers (poller.js:54-57). The audit line carries only the kind and action.
- The halt is checked before any request (poller.js:249), reads the guard on every tick (poller.js:127-134), survives a restart, and resumes after a clear. These are tested against a real state file.
- Read-only by construction: the endpoints receive a wrapper with get only (poller.js:82-93). Nothing in the poller can reach a write.
- Spacing covers every request, including the per-message reads inside conversationMessages.
- Dedupe runs before append, and a repeated id is never audited as a skip. The state-loss test confirms one stored event.
- Loop control is sound. The `ticking` flag prevents overlapping ticks (poller.js:250). `stop()` cannot be undone by an in-flight tick, because the reschedule checks `running` (poller.js:276). A throwing tick is caught and the loop goes on (poller.js:266-276).
- Config is validated with the field name (poller.js:36-50; config.js:5-9). The defaults in config.js:60 are within the bounds.
- The tests use the real state, event log, audit and guard in a temp directory, so the persistence paths are exercised rather than mocked.

---

## Issues

### Critical

None.

### Important

**I-1. An impossible calendar date in created_time is stored with a guessed receivedAt.**
- Where: events.js:29 (ISO_TIME accepts any two-digit day), events.js:64-66 (parseIsoTime returns Date.parse), events.js:246-257 (newEventFields accepts the value), poller.js:175 (receivedAt from eventTime(createdTime)). Downstream: events.js:351-356 (lastInboundAt) feeds messaging.js:194-197 (messageWindowOpen).
- What is wrong: Date.parse rolls an impossible day forward, so 2026-02-30 becomes 2026-03-02 (checked on node v24.6.0). events.append accepts the rolled value. The result is a message stored at a time that is not the one Graph sent. That breaks the rule "never stored with a guessed time". The stored value feeds lastInboundAt, which messageWindowOpen reads for the 24-hour DM window, so a time stored later than the real one can keep the window open past 24 hours. The calendar check already exists in messaging.js:173-181 (Task 8 I-1), but the poller's path does not go through it. No test covers it.
- Fix: add the same day-of-month check to events.js parseIsoTime, so the webhook path shares it. Add two tests: events.append refuses `2026-02-30T12:00:00+00:00`, and the poller audits such a message as poll.skip and stores nothing. The trigger needs Graph to send an impossible date, which is malformed data, but the rule is absolute.

**I-2. A halting stop observed while a non-halting stop is stored is not persisted, and clearing the stored stop removes the only record.**
- Where: guard.js:190 (`if (!current.stopped)`: the first stop kind is kept), guard.js:212-219 (clearStop), poller.js:143-146 (the guard.stop return is ignored), poller.js:153 (the in-process halt), poller.js:129-130 (the halt is released when the guard reports not stopped).
- What is wrong: this is the accepted known limit (a checkpoint after a stored rate limit keeps the stored kind). I do not count that limit. The clear path is a separate consequence that the ruling's stated cost does not include. When a RATE_LIMITED, STATE_LOST or STATE_CORRUPT stop is stored, a CHECKPOINT, ACTION_BLOCKED or AUTH_EXPIRED that the poller observes is kept only in process. When the owner clears the stored stop with ig_stop_clear, the guard holds no stop. The poller's next tick (60 seconds by default, poller.js:198 and config.js:60) sees "not stopped", resumes, and reads the account again. Until that tick, or until an outbound call records its own stop, outbound actions are allowed while the account is in a checkpoint. The same applies to STATE_LOST and STATE_CORRUPT stored stops, which the ruling does not mention.
- Fix (a Task 3 module change, for the owner's decision): in guard.stop, let a halting kind replace a non-halting stored kind, keep the more severe one, and persist it at once. Add a guard test and a poller test: store RATE_LIMITED, then observe CHECKPOINT, clear, and check that the guard reports stopped with CHECKPOINT.

**I-3. Messages and conversations beyond the first page are dropped without a trace.**
- Where: poller.js:208 (the list uses the default limit of 20, messaging.js:12, 111-121), poller.js:225 (conversationMessages keeps the first 20, messaging.js:13-15, 125-138), report lines 131-133.
- What is wrong: the list returns one page of 20 conversations. A conversation beyond the first 20 is not returned at all. It does not "wait", as the report says. It stays unread until it reappears on the first page. Messages beyond the first 20 of a thread are dropped with no audit line. A full page is the signal of possible truncation, and the poller does not look at it. The first-page limit is accepted. The silent loss is the problem: an inbound message can vanish, and the owner has no way to see it.
- Fix: pass `limit: 100` to conversationsList at poller.js:208 (messaging.js:13 allows 100, still one request). Write an audit line with outcome `truncated` when the list returns its full limit, and when a thread returns 20 messages. Correct report lines 131-133, which describe the thread case wrongly.

### Minor

**m-1. The poller does not check createdTime before append.** poller.js:175; events.js:246-247 defaults receivedAt to the clock when the field is undefined. messaging.js:59-64 (requiredString) makes this unreachable today, but a guessed time would be stored if the endpoint changed. Fix: skip with an audit line when `!hasTime(message.createdTime)`.

**m-2. One conversation without updated_time stops every thread.** messaging.js:84 makes conversationsList throw for the whole list, so no thread is read. The fail-closed outcome is right, but the spec wording ("not read as changed") suggests skipping that row only. Fix belongs in Task 8 (return the row with a null updatedTime); the poller filter at poller.js:216 already handles it.

**m-3. A thread that fails every tick can hold the only selection slot.** poller.js:213-220 and 225-245. A failing thread keeps its unseen updated_time, so it stays first in the newest-first order. With maxThreadsPerTick at its minimum of 1 (poller.js:25), a permanently failing newest thread can starve every other thread until it gets a new message. Fix: skip or deprioritise threads that failed on the previous tick.

**m-4. The in-process halt can outlast the stop that caused it.** poller.js:127-134. The halt is released only when a tick sees no stop. A clear followed by a non-halting stop within one interval leaves the poller halted until the next clear. This is fail closed and narrow. Fix: record the `since` of the halting stop and release the halt when it changes.

**m-5. The halt is checked only at the start of a tick.** poller.js:249 and the thread loop at 225-245. A halting stop set by another caller during a tick does not stop that tick's remaining reads (up to 20 threads, each with up to 21 spaced requests). Fix: call isHalted() before each thread.

**m-6. The timer code is untested.** poller.js:266-290 (runScheduled, start, stop). The report says "the brief says no test starts a timer". The brief and the constraints contain no such rule; they say only that no test makes a network call and that tests use fake clocks. Fix: inject setTimer and clearTimer, or test with a 1 ms interval and an immediate stop. Add a test that a throwing tick still reschedules.

**m-7. Test gaps.** No test covers: the stop_not_saved branch (poller.js:142-147); a stored STATE_LOST or STATE_CORRUPT stop; an impossible calendar date (I-1); a halt that outlasts a stored non-halting stop (I-2); or a thread-level RATE_LIMITED (poller.js:236-239), since the RATE_LIMITED test uses the list only.

**m-8. Live-phase description is wrong for numeric values.** report lines 137-139. Task 8 notes that the docs show unix timestamps. If updated_time or created_time arrives as a number, requiredString throws API_ERROR (messaging.js:59-64, 84, 92). Every list then fails, or every thread does. The report says a mismatch is "skipped and audited as poll.skip". That is wrong for a non-string value: the inbound path is dead until fixed. It is loud and fail closed. ⚠️ live phase. Fix: correct the report, and confirm both formats live before Task 13.

**m-9. A message refused as too far in the future is never retried.** poller.js:179-196; events.js:25 and 250 (MAX_FUTURE_MS of five minutes). The message is audited but not counted in the tick summary, and its thread is marked read. A host clock more than five minutes behind Graph loses messages read within about a minute of their creation. This follows the Task 10 I-1 precedent (count and audit). Fix: count skips in the summary, and leave the thread unmarked only for a future-time refusal.

**m-10. maxThreadsPerTick above 20 has no effect.** poller.js:25 accepts 1 to 100, but the list is one page of 20 (messaging.js:12). Fix: document the effective maximum, or cap the bound at the list limit (or pass limit 100 once I-3 is fixed).

**m-11. Audit and state growth.** poller.js:139-146 and 227: a persistently failing thread writes one audit line per tick, and each conversation adds a poll.seen.<id> key that is never pruned. Retention is the Task 18 carry-forward (Task 2 M-11).

**m-12. Each hasId call reads the whole events file.** poller.js:167; events.js:345-348. Each thread costs one full read per message. Performance only; Task 10 M-4.

**m-13. A stored STATE_LOST or STATE_CORRUPT does not stop reads.** poller.js:17 (HALTING holds three kinds); guard.js:18-19 and 152-156. This matches the constraints, which scope stops to outbound actions. ⚠️ The owner should confirm that reads may continue after a state loss.

**m-14. finish() resets the interval as a side effect.** poller.js:197-200. Moving the reset into runTick would make the backoff rule easier to read. Nit.

---

## Assessment

Task quality: Needs fixes. The stop wiring, the halt, the read-only design, the spacing and the dedupe are sound and tested, and no Critical defect was found. Three Important issues remain: an impossible date stored at a guessed time that feeds the DM window (I-1), a checkpoint lost on clear (I-2), and silent first-page loss that the report misdescribes (I-3). The fixes are small, and the accepted known limit is reported above but not counted.
