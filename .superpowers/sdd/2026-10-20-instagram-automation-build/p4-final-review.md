# P4 final review: p4-head to p4-final

Scope: the P4 fix rounds (p4-review.md I-1 to I-5 and the Minors; the M-7, M-10 and M-11 decisions; the inbound wiring and the lookup audit round), read from `review-p4-final.diff` (3081 lines, read in full) and checked against the live tree.

Method:
- The live `src/` files and `test/` match `snap/p4-final` (`diff -q`: identical for all ten changed source files, and for the test folder).
- Two scratch reproductions ran under the scratchpad (`D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\repro-acked.mjs` and `repro-unparse.mjs`). They read and write only scratchpad data. Nothing in the project was edited, git was not used, and the suite was not re-run.

## Round verdict

FINDINGS REMAINING.

- New findings: Critical 0, Important 2 (N-1, N-2), Minor 6 (N-3 to N-8).
- Carried from p4-review.md and still open: I-3 (residual branch, NOT ADDRESSED).

## Item verdicts

| Item | Verdict | Evidence (file:line) | Notes |
|---|---|---|---|
| I-1 STATE_CORRUPT/STATE_LOST outrank RATE_LIMITED; repair sets STATE_CORRUPT over a stored non-halting stop, with an audit line | ADDRESSED | guard.js:27-34 (STATE_LOST and STATE_CORRUPT rank 4, RATE_LIMITED 2); guard.js:239 (replacement rule); state.js:207-218 (a repair keeps only halting stored stops; `stopReplaced` in the notice); state.js:262 (`drainNotices`); poller.js:284-289 (the poller writes the notices at tick start) | Tests: guard.test.js (STATE_* stays after RATE_LIMITED and after restart), state.test.js (repair over RATE_LIMITED; halting stop kept). Ranking beyond the ruling: N-7. |
| I-2 a message older than the 90-day window is not stored; audited as poll.skip, no text | ADDRESSED | poller.js:352-353 (skip before append); poller.js:384-390 (one `poll.skip` per thread read, `reason: 'older-than-window'`, count, no text); events.js:435-438 (`hasKey`) | The key lives 90 days from receipt, and a message stops being stored at 90 days from its creation. Creation is never later than receipt, so the age check fires before the key expires, and no re-store is possible. Deviation: one line per thread read, not per message. The implementer's reason holds (repeat lines on long threads). |
| I-3 repair never lowers a cursor; issued = max(issued, acked); acked unchanged; pending never re-delivers an acked event | NOT ADDRESSED (carried) | state.js:113-125 (whole-number case fixed); state.js:117-120 (a damaged `events.acked`, text or non-whole, is reset to 0); state.js:218 (the note says "no cursor was moved backwards", which is false in this branch) | Reproduced (repro-acked.mjs): stored `"9"` or `9.5` becomes 0, and `pending()` re-delivers m1 to m9. A control with no damage re-delivers nothing. This violates global constraint 14 and the I-3 criterion. Path via an unparseable state file: N-1. |
| I-4 deferred reads have their own budget; the header matches | ADDRESSED | poller.js:7-8 (header: two budgets); poller.js:576-592 (first pass capped at 2 * maxThreadsPerTick; deferred loop has `deferredBudget = maxThreadsPerTick`, stops when spent) | |
| I-5 comment and mention events carry targetId; it passes checkGraphId | ADDRESSED | events.js:273-276 (`output` adds `targetId` = raw id); tools.js:115-120 (`COMMENT_ID`); tools.js:353, 362, 372, 413 (comment tools use it); tools.js:310, 326 (event tool descriptions) | ig_like with kind comment is not updated: N-6. |
| M-7 future-stamped webhook event: 503, not stored; normal event 200 | ADDRESSED | webhooks.js:12 (`RETRY_LATER`); webhooks.js:306-312 (count, audit with kind and time, no text; owner events are skipped before this check); webhooks.js:317-319 (store, then notify); webhooks.js:340 (503 when `futureSkipped > 0`, else 200) | The 503 body is "Retry later", with no event text. The other events of that delivery are stored at once. Retry depends on Meta retrying a 503 (not checkable here; disclosed by the implementer). |
| M-10 during a stop: events stored, not notified, auto-reply refused | ADDRESSED | service.js:771-776 (`STOPPED: <kind>` skip, before the auto-reply check); service.js:593 and 621 (`guard.assertNotStopped` in `runOutbound`); webhooks.js:318 (store, no guard) | Intake continues during any stop, as decided. Owner to confirm (accepted). |
| M-11 corrupt-state start rebuilds counters from the audit file; token record empty and stated | ADDRESSED for caps and the token record; cursors and private replies not covered (N-1, N-2) | state.js:178, 194 (`unreadable`); state.js:234, 238 (getters); cli.js:662-666 (rebuild on unreadable, or missing with STATE_LOST); cli.js:591-633 (`recoverFromAudit`; `authRecord` at cli.js:608); cli.js:788-791 (start note); caps.js:350-405 (`rebuildCapsFromAudit`); audit.js:106-137 (`scanSince`); caps.js:60-78 (`AUDIT_FEATURES`); service.js:806 (`status().recovery`) | Damaged lines are skipped and counted (cli.js:604), and error lines count (fail closed). Known gaps: N-3, N-4. |
| Wiring: poller onInbound and webhook notify call service.onInbound; off by default; on with a matching rule, one reply within caps and window | ADDRESSED | cli.js:713 (`onInbound` looked up at call time); cli.js:722 (webhook `notify`); cli.js:747 (poller); webhooks.js:247-257 (`notifyStored`, not awaited, failures audited with kind only); service.js:1282-1288 (`onInbound` never rejects); service.js:776 (`AUTO_REPLY_OFF`, no send); service.js:740-756 and 593-630 (reply goes through `runOutbound`) | No double send for one event: the poller checks `events.hasId(message.id, 'message')` before append (poller.js:341), and the webhook checks `events.hasId(event.id, event.kind)` before append (webhooks.js:317). Both use one key space; the message id is the Graph `mid` (webhooks.js:150) that the poller also reads. Two events from one sender in one burst cannot both record a reply: the authoritative `caps.check` and `caps.record` run with no await between them (service.js:621-630). The early check at service.js:606 is advisory only. |
| Lookup audit lines: no text, no identifiers beyond action and outcome; rebuild counts them | ADDRESSED | service.js:694-712 (`lookup` with `feature`; ok and error lines; `route` is the product); service.js:119-123 (`errorDetail`: kind and code only); service.js:939, 1055 (features); caps.js:60-78 (`AUDIT_FEATURES` maps both; `READ_ACTIONS` keeps them out of outbound) | A busy lookup writes nothing (as before). The hashtag line is unchanged (service.js:1025, 1035). |
| M-1 accepted, pinned | ADDRESSED (owner to confirm) | poller.js:415 region; test "a listed conversation keeps a seen value of any age" | Owner confirmation remains open, as the implementer records. |
| M-2 notices lost on a failed write | ADDRESSED | events.js:582-587; state.js:262-268; poller.js:284-289 | A notice is dropped only after its write returns. |
| M-3 rebuild and crash-gap times | ADDRESSED | events.js:381 (`loadedAt`); events.js:384-420 (rebuild keeps valid lines with receipt times); header events.js:4-14 | |
| M-4 audit kind is a literal | ADDRESSED | messaging.js:124-133 (`readRow`: only API_ERROR rows are counted as skips) | The literal is therefore the reader's only skip kind. |
| M-5 failed copy aside stops the start | ADDRESSED | state.js:148-154 (`copyAside` returns false); state.js:184 (no write while the copy is pending); state.js:273-279 (save makes the copy first, or throws CONFIG); cli.js:621-625 (recovery save kept in process) | |
| M-6 dropped future records deleted after 30 days | ADDRESSED | poller.js:300-325 (`createdAt` kept; drop is final); poller.js:357 (dropped messages skip silently); poller.js:441-442 (pruned after the dedupe window from `createdAt`) | |
| M-8 missing index not reported | ADDRESSED for the ruled case (missing index with events in the file) | events.js:384-420 (rebuild and notice, reason `index missing`) | Missing or zero-length index with an empty event file is not reported: N-5. |
| M-9 review baseline and line numbers | Note only | | |

## Security and correctness checks

- Audit lines, notices, errors and logs added in P4: no secret or message text. Reviewed every new `audit.record`, `safeAudit`, notice and throw in the diff. `poll.skip` carries a count and reason (poller.js:384-390); `webhook.notify` carries `kind` only (webhooks.js:250); lookups carry action, route, outcome and error kind and code (service.js:707, 711); `capsRebuild` and the recovery record carry counts and fixed strings (cli.js:598-632); `state.repair` carries cursor names and the replaced stop kind (state.js:218 area); `events.index` carries a basename and counts (events.js:406-409). New throws carry fixed text, with at most an error code (state.js:~ CONFIG on copy failure; audit.js and caps.js TypeErrors). `process.emitWarning` has no new call.
- No new write retry: none added. `writeRepaired` (state.js:182-190) only keeps the change in memory when a write fails.
- No new write path without the gates: the auto-reply path goes through `runOutbound`, with the stop check, caps, usage hold and window preflight (service.js:593, 606, 621-630, 747). `confirm: true` inside `autoReplyTo` (service.js:746) relies on the owner enabling auto-replies in config or with `ig_auto_reply_set` (confirm required). That is unchanged from p4-head.
- The 503 body does not carry the event text (webhooks.js:12, 340).
- Fail-open checks:
  - Cursor moves backwards: NOT ADDRESSED (I-3 residual, N-1).
  - Damaged audit rebuild: counts and reports damaged lines (audit.js:106-137; caps.js:367; cli.js:604). Undercount paths remain (N-3, N-4).
  - Stop not saved: the copy and save paths keep the stop in process (state.js:273-279; cli.js:621-625). ADDRESSED.
  - Double send from the two notify paths: none found (see the wiring row).
- No test listens on a port or makes a network call: `test/` contains no literal `fetch(`. The `listen(` hits are fake server objects in oauth.test.js:472-764, which P4 did not change, and an assertion at http.test.js:840. The P4 tests inject `fetchImpl`. The recovery tests call `buildServe` without `fetchImpl`, but `buildServe` makes no request, so no network call occurs.

## New findings

### N-1 (Important): an unreadable or missing state file resets the event cursors, so pending re-delivers every stored event with no notice

- Evidence: state.js:192-199 (unreadable branch: `data` holds only the stop; `repairCursors` is not called, so `events.issued` and `events.acked` are absent and read as 0); state.js:163-172 (missing state: empty `data`, the same result, by code reading, not reproduced); events.js createEventLog reads the cursors from the state at start; service.js:1060-1068 (`eventsPending` and `eventsAck` do not read the stop, so they are not gated).
- Reproduced (repro-unparse.mjs): `events.acked` 9 on disk; the state file is truncated so it does not parse. After load: stop `STATE_CORRUPT`, `events.acked` and `events.issued` undefined, notices 0. `pending()` re-delivers m1 to m9.
- Impact: this violates global constraint 14 (never moves backwards) and the I-3 criterion (pending never re-delivers an acked event). It is silent, and the M-11 recovery record and the README section "Recovery from a damaged state file" (README.md:176-186) do not list the cursor loss among the known limits.
- Fix (owner decision): while the cursors are unknown, hold `events.pending` and `events.ack` until `ig_stop_clear`, or refuse them with a reason; and state the cursor loss in the recovery record and the README.

### N-2 (Important): the one-private-reply-per-comment record is not rebuilt, so the local check fails open after a damaged-state rebuild

- Evidence: service.js:1203-1211 (the preflight reads only `stateObject('private_replies')[commentId]`); service.js:529-533 and 550-558 (the record is in the state only); service.js:1199 (the `privateReply` audit line carries `target: commentId`, which the rebuild ignores, since caps.js uses `target` only for auto-reply and hashtag); cli.js:607 (`notRebuilt` names only lookups); README.md:199 (says a second private reply "is refused", without the damaged-state caveat).
- Impact: after a corrupt-state start, `ig_private_reply` for a comment that already has one passes the local check and goes to Graph. Meta's one-reply rule is the only backstop; it was not checked live. Global constraint: "one private reply per comment".
- Fix: rebuild `private_replies` from `privateReply` audit lines (`target` = comment id, outcome ok or error, inside 7 days of the comment), or name the limit in the recovery record and the README.

### N-3 (Minor): the audit rebuild assumes time-ordered audit lines

- Evidence: audit.js:102-105 (the comment states the assumption); audit.js:136 (`if (first !== null && first < since) break;`, which stops reading rotations once the newest file's first valid line is older than the window).
- Impact: a backward clock step can make a rotation hold lines inside the window while the newest file's first line is before it. The rebuild then skips those lines and undercounts, silently (the damaged count does not show it).
- Fix: scan every retained file, or compare the first and last `at` of each file before stopping.

### N-4 (Minor): damaged audit lines can hide counted actions, and the recovery notice does not say so

- Evidence: cli.js:604 (`damagedAuditLines` is reported); caps.js:367 (damaged lines come from the read files only); audit.js:136 (damaged lines in skipped rotations are not counted).
- Impact: a torn last line followed by a later append merges into one unparseable line, which hides the later valid action (mechanism inferred from the append path, not reproduced). The notice shows one damaged line, but not that the counts may be low by that many.
- Fix: state in the recovery record that counts may be low by up to `damagedAuditLines`, or count each damaged line as one possible outbound action (fail closed).

### N-5 (Minor): a zero-length index with events in the file is not reported

- Evidence: events.js:313-332 (`loadIndex`: empty text is neither damaged nor missing); events.js:384 (rebuild and notice only for `index.damaged` or missing-with-events).
- Impact: the in-file keys are kept with the load time, but purged keys inside the window are forgotten with no notice. This is the M-8 gap, narrowed to the zero-length case. A missing index with an empty event file has the same gap.
- Fix: treat a zero-length index as missing, and report it when the event file holds events.

### N-6 (Minor): ig_like with kind comment takes a comment id, and its description does not give the event rule

- Evidence: tools.js:380-384 (`ig_like` takes `targetId` as a plain ID, and `kind` may be `comment`); I-5 ruling named "the comment tools".
- Impact: an owner's agent that passes a comment event's `id` (`comment:<id>`) to ig_like gets VALIDATION. Passing the event's `targetId` works.
- Fix: add the targetId rule to the ig_like description.

### N-7 (Minor): the rank change also places the state stops above the account stops, which the I-1 ruling did not ask for

- Evidence: guard.js:27-34 (STATE_LOST and STATE_CORRUPT rank 4, AUTH_EXPIRED, CHECKPOINT and ACTION_BLOCKED rank 3); guard.js:239 (a CHECKPOINT or AUTH_EXPIRED observed under a state stop is not recorded). The ruling asked only for "above RATE_LIMITED".
- Impact: no safety loss found. The poller still halts, outbound is still refused, and the next outbound call would re-observe the account stop. The owner loses the account-stop record until then. README states the new order.
- Fix: owner to confirm the order.

### N-8 (Minor): the recovery record is never cleared, and the start note repeats on every start

- Evidence: cli.js:788-791 (the start note prints each time a recovery record exists); cli.js:608 (`authRecord` text); service.js:806 (`status()` shows it). No command removes it.
- Impact: after `ig auth login` has written the token record, every start still says "the token record is empty, run ig auth login".
- Fix: clear the note once the token record exists, or keep the record and drop the stale wording.

## Observations (not findings)

- With auto-replies off, each new inbound message writes one `inbound` audit line from either path (service.js:776). Accepted by the implementer for audit volume.
- Each Meta retry of a delivery that is answered 503 writes a `webhook.delivery` line and a `webhook.event_skipped` line for each future event (webhooks.js:306-312, 340). Volume only.
- Webhook intake continues during any stop, by the M-10 decision. Owner to confirm.

## Changed tests and report claims

- The changed-test list in task-11-report.md matches the diff (M-7 test renamed and its assertion changed; the state, events and poller damaged-index and cursor tests changed as described). The 979 count was not re-run.
