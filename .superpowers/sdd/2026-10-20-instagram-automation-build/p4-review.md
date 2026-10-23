# P4 review: p3-head to p4-head

Scope: poller, state, events, audit, the guard's startup path, and the webhook receiver (O-3 and A-4, A-5, A-6, A-7, A-9, A-22, A-23, A-24, A-26, A-28, A-29, plus the P3 paging use and numeric webhook times).

Method: read progress.md (P4 entries, OWNER DECISIONS 2026-10-22), global-constraints.md, task-11-report.md section "P4 (2026-10-22)", and review-p4.diff in full (3889 lines). Line numbers below are from the live tree under `D:\Projects2\InstagramApi\` and match the p4-head snapshot. The suite was not re-run, as instructed. One scratch script was run against the live `src/` modules to reproduce three findings; it wrote only under the scratchpad (`D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\repro-p4.mjs`, data in `repro-p4-data\`). No project file was edited. Git was not used.

## Round verdict

FINDINGS REMAINING.

New findings: Critical 0, Important 5 (I-1 to I-5), Minor 11 (M-1 to M-11).

The P4 work is largely sound: the O-3 start path, the 90-day window for a healthy index, the in-memory hasId, the kind-qualified ids, backoff, future-time holds, audit streaming and rotation, fsync, the closed-request check, the interval reset, and webhook time forms are all implemented and tested. Five items must be fixed before P4 passes. Three of them (I-1, I-2, I-3) were reproduced.

## Item verdicts

| Item | Verdict | Evidence (file:line) | Notes |
|---|---|---|---|
| (a) O-3 start stopped, halts, status and reads work, only ig_stop_clear(true) clears | NOT ADDRESSED | guard.js:151-168 (unreadable stored stop becomes STATE_CORRUPT, saved at :192); state.js:136-152 (unparseable file: STATE_CORRUPT stop); state.js:156-173 (cursor damage); service.js:669-677 (reads not gated by the stop); guard.js:260-267 (clearStop, confirm-gated); service.js:806 | The start-stopped path works. The halt does not hold: a RATE_LIMITED stop from a read replaces a stored STATE_CORRUPT (I-1), and cursor damage over a stored RATE_LIMITED keeps RATE_LIMITED (I-1). |
| (b) A-6 90-day index, purged redelivery within 90 days refused, limit in a comment | ADDRESSED | events.js:4-7 (header), :27-28 (DEDUPE_DAYS = 90), :418-424 (hasKey); test "a purged event redelivered after 31 days ..." | Holds for a healthy index. After 90 days the key is pruned and the poller re-stores old messages (I-2). After an index rebuild, purged ids older than 30 days are not known (M-3, disclosed). |
| (c) A-9 hasId reads memory, not the file | ADDRESSED | events.js:508-511 (hasId calls hasKey, which reads the `known` Map only); test "hasId does not read the event file on each call" | append still reads the file (the append path, events.js:426-447). That is not in scope for A-9. |
| (d) A-22 kind-qualified key and id; message ids raw; comment and mention with one raw id both store; decide and ack act on one event | ADDRESSED | events.js:39-45 (QUALIFIED_KINDS, storedIdOf, rawIdOf); :446 (known key by kind); :482-505 (decide matches the stored id exactly, refuses ambiguity); webhooks.js:294 (hasId(id, kind)); ack is by seq (events.js:468-478); tests in events.test.js and webhooks.test.js | The stored id of a comment or mention is no longer a Graph id, and no field carries the raw id (I-5). |
| (e) A-24 backoff 1, 2, 4 ... to 32 ticks, reset on success, persisted, survives restart; a future message does not hold a slot | ADDRESSED with I-4 | poller.js:249-254 (noteThreadFailure, 2^(n-1) capped at 32, retry at tickNo + wait + 1); :257-262 (clearBackoff on a clean read); state keys poll.backoff.<id>, poll.tick; test "a backoff recorded before a restart..."; normal loop poller.js:539-545 (held threads take no slot) | The later loop (poller.js:546-550) has no cap, so deferred threads are read without limit (I-4). |
| (f) A-26 future message not marked read, retried, dropped with audit poll.skip future-time after 24 h | ADDRESSED | poller.js:337-345 (hold, the thread is not marked read; first sighting kept in state); :300-313 (futureHold; 24 h; audit at :312 with detail future-time; record kept with dropped true) | Dropped records are deleted after 30 days (M-6). |
| (g) A-28 poll.seen older than 30 days pruned; audit rotates at 50 MB, keeps 10 | ADDRESSED (interpretation to confirm) | poller.js:386-409 (prune by listed age; future records by first); audit.js:11-12 (50 MB, 10 kept), :42-52 (rotateIfFull) | Pruning is by "not listed for 30 days", not by the age of the seen value (M-1). |
| (h) A-4 audit read skips non-object JSON lines, counts them, reads as a stream | ADDRESSED | audit.js:54-76 (readTail: readSync in chunks, carry buffer, non-object lines counted); :99-120 (readCounted returns entries and skipped); :140 (read keeps its shape); tests in audit.test.js | |
| (i) A-5 filesystem error on the events file wrapped as IgError with fixed kind; message names operation, not path or secret | ADDRESSED | events.js:63-70 (io: CONFIG, operation and code only); wrapped sites: :160-163, :216-218, :223-235, :307-310, :329-341, :382-383, :442-443; test "a file-system error from the event file becomes an IgError..." | state.save() called inside append (events.js, after the seq is set) is not wrapped, so a state write error carries the state path. It is outside A-5's events-file scope. Not traced to a tool result. |
| (j) A-7 fsync before append returns; recorded with an injected fs | ADDRESSED | events.js:223-234 (openSync, writeFileSync, fsyncSync, closeSync); test "append calls fsync before it returns" (wrapped fs records the order) | |
| (k) A-23 readRawBody refuses a closed or ended request | ADDRESSED | webhooks.js:327-329 (destroyed, readableEnded, closed; throws at once); test "readRawBody refuses a request that has ended, or is destroyed or closed, without waiting" (5 s timeout) | |
| (l) A-29 interval reset in runTick; finish only reports; clean tick returns to normal | ADDRESSED | poller.js:551 (reset in runTick); :556-558 (finish reports only); test "RATE_LIMITED doubles the interval" (clean tick returns to 60000) | |
| (m) P3 paged readers; messages through the messages edge; malformed message skipped and counted; audit has kind and count, never text | ADDRESSED | poller.js:493 (readConversations); :427 (readThread, messages edge, threadMaxItems); :432-436 (poll.messages skipped, detail {kind, count}); :504 (list skip); :509-513 (list truncated with reason) | The kind is always the literal API_ERROR, not the reader's skip reason (M-4). |
| (n) numeric webhook timestamps (Unix seconds, ms, numeric strings, ISO with zone) give the same instant | ADDRESSED | webhooks.js:49-75 (WEBHOOK_ISO, WEBHOOK_NUMERIC, unixMsOf, webhookTimeIso); :120-124 (commentLike; created_time, else entry time); :151 (messaging); test "a webhook time is read in each accepted form..." (all forms map to the same ISO text) | Duplicates the P3 parser (accepted, deferred to cleanup per progress.md). |
| (o) halting kinds unchanged; RATE_LIMITED a back-off | ADDRESSED for the set; the halt does not hold (I-1) | poller.js:46 (HALTING: AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, STATE_CORRUPT, STATE_LOST); :206-233 (RATE_LIMITED returns backoff, doubles the interval) | A RATE_LIMITED stop replaces STATE_CORRUPT, and then the poller is no longer halted (I-1, reproduced). |

## Security and correctness checks

- No secret or message text in audit lines, errors or logs added by P4: ADDRESSED. Every audit.record in the P4 paths carries an action, an id, a fixed outcome, and a code, count, reason or ISO time (poller.js:219-228, 277-280, 312, 334, 357, 434, 504, 513; webhooks.js:274-290; the notice detail in events.js:384-394 carries basename(quarantined), a count and a fixed note). process.emitWarning appears only at poller.js:589 (existing, name only). New throws carry a fixed text plus an error code (events.js:63-70, 77-80, 332; state.js:152, 162, 171; webhooks.js:328).
- Dedupe index and rebuilt index hold ids only: ADDRESSED (events.js:339-342, writeIndex, writes {key, at}; the key is kind:id).
- No write retried, no new write path: ADDRESSED. The poller client is get-only (poller.js:115 spacedReader; readThread and readConversations use get). guard.retrySave (guard.js:182-189, 192) retries a local state write only, not an outbound call.
- Fail-open, damaged index: rebuilt (events.js:377-395), with two gaps. A missing index is not reported (M-8). A rebuild loses purged ids older than 30 days (M-3, disclosed in the notice).
- Fail-open, stop not saved: ADDRESSED. The stop holds in process (guard.js:248-251, 182-189) and the poller audits stop_not_saved (poller.js:219).
- Fail-open, cursor moves backwards: NOT ADDRESSED. state.js:164 deletes events.issued and events.acked on cursor damage (reproduced: acked 9 becomes absent, issued 2 becomes absent). See I-3.
- Fail-open, event stored twice: NOT ADDRESSED. Old messages are re-stored after the 90-day key expires, through the poller's whole-thread reads (reproduced: m_old delivered twice). See I-2.
- No test listens on a port or makes a network call: ADDRESSED for the changed test files. The listen and fetch hits in test/ are fake servers in oauth.test.js and an assertion in http.test.js, neither changed in P4. The P4 tests use fake streams and clients.

## Important findings

### I-1. A STATE_CORRUPT stop can be replaced by RATE_LIMITED, which lifts the poller halt (items a, o; O-3)

- Evidence: guard.js:25-33 (STOP_RANK: STATE_CORRUPT 1, RATE_LIMITED 2); guard.js:237 (a higher rank replaces the stored stop); service.js:680-687 and :363-370 (a read's error with code 4, 17, 613, 80002 or 429 calls guard.stop, and reads are not gated by the stop, service.js:669-677); poller.js:198-202 (the poller halts only for HALTING kinds, and RATE_LIMITED is not one). Separately, state.js:165-167 keeps any stored stop, so cursor damage over a stored RATE_LIMITED stop keeps RATE_LIMITED. The implementer disclosed that case (report, "Rank rule and damaged cursors") but did not fix it.
- Reproduced (scratch, P2): a state with an unreadable stop starts with STATE_CORRUPT; after guard.stop('RATE_LIMITED'), the kind is RATE_LIMITED, which the poller does not halt on.
- Impact: the owner's O-3 guarantee ("the poller is halted until ig_stop_clear") can be broken by one rate-limited read. The poller then reads a state it has just recorded as damaged.
- Fix: rank STATE_CORRUPT and STATE_LOST above RATE_LIMITED (for example 4), so no non-halting stop replaces them. In state.js, when the cursor repair runs, set STATE_CORRUPT over any stored non-halting stop (RATE_LIMITED), and audit the change.

### I-2. A purged event is stored again after 90 days, through the poller's whole-thread reads (items b, fail-open "stored twice")

- Evidence: events.js:27-28 and :418-424 (a key not in the file is known for 90 days from receipt, then unknown); poller.js:326-331 (storeMessages has no age bound; hasId false, then append); poller.js:427 (readThread reads up to threadMaxItems, default 1000, messages of every changed thread, newest first); events.js:508-511 (hasId).
- Reproduced (scratch, P1): a message sent on day 0, handled, acked and purged on day 31. On day 91 a new message arrives in the same thread. The tick reports appended 2, and onInbound delivers m_old and then m_new (m_old twice in total). The event file now holds m_old again at seq 2.
- Impact: every change to a thread with history older than 90 days re-emits its old messages (purged ones) as new events, which the consumer receives as new inbound messages. Outbound replies are still bounded by the messaging windows (dmSend, the 24-hour window, and the private-reply 7-day window), so this is a duplicate-input defect, not an outbound one.
- Fix (owner decision): the poller should not store a message whose created time is older than the dedupe window, and should audit it as poll.skip with a reason such as older-than-window. Alternatively, keep purged keys for as long as the poller can read them, or bound the poller's reads to messages newer than the seen point. Add a test: a message older than 90 days in a changed thread is not stored.

### I-3. Cursor damage repair moves the event cursor backwards (fail-open; global constraint line 14)

- Evidence: state.js:156-173: on cursor damage, the file is copied aside and then `for (const key of CURSOR_KEYS) data.delete(key)` (state.js:164) removes events.issued, events.acked and events.lastSeq. The damage test is state.js:105-112 (acked above issued, or a non-whole value).
- Reproduced (scratch, P3): events.issued 2 and events.acked 9 become both absent after createState; the stop is STATE_CORRUPT.
- Impact: the acked position goes from 9 back to 0, so pending() re-delivers already-acknowledged events to the consumer (up to 30 days of them), and ig_events_ack refuses cursors that were issued before the repair until pending() issues them again. The global constraint says "never moves backwards". The report accepts the redelivery ("Repaired cursors redeliver acked events"), but the constraint does not allow it.
- Fix: do not delete the cursors. Keep events.acked and events.issued as stored, hold STATE_CORRUPT, and refuse pending and ack until ig_stop_clear. If a repair is preferred, it must never lower a cursor (for example, set issued to max(issued, acked)) and must say so in the notice.

### I-4. Deferred threads are read without a cap (item e; header contract)

- Evidence: poller.js:546-550 (the `later` loop calls readThreadOnce for every deferred thread with no slot check). The header at poller.js:7 says "Up to maxThreadsPerTick changed threads are read per tick". The normal loop (poller.js:539-545) does apply the cap.
- Impact: a tick reads every deferred thread, up to 1000 listed conversations, each with up to 10 pages of messages (poller.js:427, threadMaxItems 1000 with 100 per page), at the spacing interval. Deferral is triggered by a future-stamped message, which Meta should not send, but when it happens the read budget is unbounded. Code reading; not reproduced.
- Fix: give deferred reads their own budget (for example, another maxThreadsPerTick), stop the `later` loop when it is spent, and correct the header at poller.js:7 to match.

### I-5. A comment or mention event id is not a Graph id, and no field carries the raw id (item d)

- Evidence: events.js:39-45 and :268 (output returns the stored id as is; a comment is stored as comment:<id>, a mention as mention:<id>). common.js:9-13 (checkId accepts only digit strings). service.js:1090, :1104, :1118 and :1179 (commentReply, commentHide, commentDelete and privateReply each call checkGraphId on commentId). tools.js:345-348 and :404-408 (the commentId inputs; no description of event ids). tools.js:318-323 (ig_events_decide takes eventId).
- Impact: an owner's agent reads a comment event and gets id "comment:17..." with no commentId field. Passing that id to ig_comment_reply or ig_private_reply fails with VALIDATION. The prefix rule exists only in events.js comments. The ruling asked for kind-qualified ids; it did not say the raw id should go missing from the output. Code reading; not reproduced.
- Fix: add a targetId (the raw Graph comment id) to the output of comment and mention events, and state the rule in the tool descriptions for ig_events_pending, ig_events_decide and the comment tools.

## Minor findings

- M-1 (poller.js:392-394): A-28 prunes poll.seen by the conversation's listed age, not by the age of the seen value. A still-listed conversation keeps a seen value of any age. This may be the intended reading (the seen map is bounded by listed conversations), but it differs from the literal wording. No test covers a listed conversation with an old seen value. Owner to confirm.
- M-2 (events.js:564-566; poller.js:276-281; poller.js:586-590): takeNotices() empties the queue (splice) before drainNotices writes each one. If audit.record throws, the rest of the notices are lost, and the tick error is only warned (poller.js:589). Write each notice, then remove it, or requeue on failure.
- M-3 (events.js:383, :398-401, versus :446): receivedAt is caller-supplied (events.js:289-299), so it is the message's sent time for poller and webhook events. The index written at append uses the receipt clock (:446), but the rebuild path (:383) and the crash-gap path (:398-401) use receivedAt. The header claim "90 days after it was received" (events.js:4-7) does not hold on those two paths. Purged ids older than 30 days are not known after a rebuild (disclosed in the notice and accepted in progress.md, but still a gap against A-6 for that window).
- M-4 (poller.js:434, :504): the poll.messages and poll.list skip audit always uses kind API_ERROR. It is a literal, not the reader's skip reason. The count is real. Either carry the reason or record the count only.
- M-5 (state.js:159-163 and :168-172): if the cursor-repair copy or write fails, createState throws CONFIG and the service refuses to start. The guard starts stopped in process when its save fails (guard.js:182-192). The write-failure case is narrow, but it is inconsistent with the O-3 "start stopped, not refused" rule.
- M-6 (poller.js:406-408): future records older than 30 days are deleted, including dropped ones. A thread that is read again after that re-holds and re-audits the message.
- M-7 (webhooks.js:283-292): a webhook event stamped more than five minutes ahead is dropped at once with an audit line; there is no hold. A-26 describes a hold for the poller. The poller would recover the message on its next read of that thread, so this is a minor inconsistency, not a loss.
- M-8 (events.js:309-310 and :397-402): a missing index (deleted, or an index that was never written) is not reported. The known set is built from the event file only, so purged ids are accepted again without a notice. Add a notice when the event file holds data and the index is absent.
- M-9 (process): the review baseline p3-head predates the P3 review fixes (M-1 to M-5). Those edits show in this diff: paging.js:19-27 (clampBound), discovery.js:21-25 (withoutNestedPaging drops a top-level paging key), messaging.js:267-290 (readThread with after and the per-page limit), service.js:958 (dmMessages with after and the lookup bound). progress.md records no focused re-review of those edits. They were read here on a first pass, and no defect was found. The report's claim that service.js and src/graph/* are byte-identical to the pre-P4 copies holds only against the post-P3-fix copy. Several report line numbers are off by one (for example, DEDUPE_DAYS is events.js:27, not :26).
- M-10 (webhooks.js, no guard reference): webhook intake is not gated by the guard, so events keep being stored while a STATE_CORRUPT stop is held. O-3 halts only the poller, so this matches the letter of the decision. Combined with I-3 (cursors removed), the owner should confirm that intake should continue during a damaged-state stop.
- M-11 (state.js:136-152, pre-existing and not changed by P4): an unparseable state file is replaced by a state holding only the stop. Tokens and the daily caps counters (the caps.* keys and the token record) are gone, and the copy is kept aside. After ig_stop_clear, the caps start from zero for that day, so the daily limits can be exceeded once. The O-3 cost statement does not mention this. Owner to decide whether a cleared stop should restore the day's counts from the copy.

## Other observations (not findings)

- O-3 with a damaged event file: a non-tail damaged line still refuses to build the event log (events.js readStore). O-3 covers the state file and the stop record only, so this is consistent with the decision.
- The P4 poller test file and the scratch repro both use fake clients and clocks. No test in the P4 set makes a network call.
- The report's claim of a damaged-cursor test "a stored stop is kept when the cursors are repaired" (state.test.js) matches state.js:165-167.

## Summary of what must change before PASS

1. I-1: rank STATE_CORRUPT and STATE_LOST above RATE_LIMITED; apply the cursor-damage stop over a stored non-halting stop.
2. I-2: stop re-storing messages older than the dedupe window in the poller (owner decision on the approach), with a test.
3. I-3: do not reset events.issued or events.acked on repair.
4. I-4: cap the deferred reads with their own budget; fix the header.
5. I-5: expose the raw comment id in comment and mention events; document it in the tool descriptions.
