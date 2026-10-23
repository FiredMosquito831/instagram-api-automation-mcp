# P4 final fix round review (N-1 to N-8, and the I-3 residual)

Scope: the P4 final fix round only, read from `review-p5a.diff` (the net change from p4-final to p5a-head), restricted to `src/state.js`, `src/events.js`, `src/audit.js`, `src/guard.js`, `src/caps.js`, `src/tools.js`, `src/cli.js` (wiring and the recovery notice), and `src/service.js` (stopClear, eventsPending, the lookup audit lines, the private-reply preflight), plus their tests. Not reviewed (P5a): `src/redact.js`, `src/errors.js`, `src/config.js`, `src/unofficial/sidecar.js`, `sidecar/ig_sidecar.py`.

Method: the diff hunks, the live tree (it matches the diff), the implementer's section in `task-11-report.md` (line 932 onward), and `p4-final-review.md` (N-1 to N-8). Checks run in the scratchpad only (the scripts read the live `src/` modules and write only under the scratchpad; nothing in the project was edited; git was not used; the suite was not re-run):

- `nfix-restart-check.mjs`: 18 checks, all PASS. Missing state and damaged-acked state, each across restarts: the hold holds before the clear, no delivery before the clear, the first pending after the clear carries the notice, the ids are unchanged, seqs stay unique, nothing is redelivered after the ack.
- `nfix-readable-check.mjs`: FAIL (see N-9).
- `nfix-writefail-check.mjs`: injected write failure during the reset (see N-11).

## Round verdict

FINDINGS REMAINING.

- New findings: Critical 0, Important 2 (N-9, N-10), Minor 4 (N-11 to N-14).
- The N-1 to N-8 items as ruled are addressed on the paths they name. The two Important findings are gaps next to those paths (a readable state with lost cursor keys; a failed audit rebuild). Both need a fix and a test before PASS.

## Item verdicts

| Item | Verdict | Evidence (file:line) | Notes |
|---|---|---|---|
| N-1 unreadable or missing state: pending and ack held until the clear; clear starts at zero with a notice; ids unchanged; no re-delivery before the clear | ADDRESSED | state.js:171, 193 (`missing`, `unreadable`); guard.js:197-205 (STATE_LOST, persisted); events.js:403-404 (marker, saved); events.js:541-543 (pending hold and reset); events.js:568 (ack hold); events.js:515-530 (`resetCursors`); events.js:696 (`cursorsUnknown`); service.js:1070-1076 (notice passed through); cli.js:607 (`eventCursors`) | Verified by scratch S1 (missing state, restarts, clear, notice, ids, seqs) and S2 (damaged acked, restart, clear). The gap for a readable state with lost cursor keys is N-9. |
| N-2 one-reply record rebuilt from `privateReply` lines (target = comment id, within 7 days of the comment); damaged rebuild refuses a second reply with no request | ADDRESSED on the rebuild path; NOT ADDRESSED on a failed rebuild (N-10) | caps.js:17 (window), caps.js:376-390 (`keepPrivateReply`, scan), caps.js:429-431 (record shape); events.js:676-681 (`receivedAtOf`); cli.js:610-613 (merge); service.js:1215-1223 (refusal before any request); runOutbound writes `action: feature` = `privateReply` with `target` = comment id (service.js:653, 658) | Error lines kept (fail closed), as the controller accepts. The integration test writes its line by hand; the live line has the same shape (verified in runOutbound). |
| N-3 rebuild does not assume time order; a line with no usable time is damaged | ADDRESSED | audit.js:108-135 (`scanSince` reads every retained file, no early stop); audit.js:210-214 (no finite `at` counts as damaged) | Cost of a full read at a recovery start: see observations. |
| N-4 recovery notice states the number of damaged audit lines skipped | ADDRESSED | cli.js:593-597 (`damagedNote`); cli.js:659-667 (`recoveryNote` prints `recovery.note`); service.js status shows it | The note reads "the counts may be low by up to N". Per the append path (audit.js:179, no newline guard) one torn line hides at most one action, so the bound holds. |
| N-5 zero-length index with events gives the rebuild notice | ADDRESSED | events.js:327-332 (`empty: true`); events.js:434 (`index empty`); events.js:797-801 rebuild path | Empty file with no events: no notice (test). |
| N-6 ig_like description gives the comment rule | ADDRESSED | tools.js:382 | |
| N-7 STATE_LOST and STATE_CORRUPT above RATE_LIMITED; account stops at their earlier rank | ADDRESSED (as ruled) | guard.js:28-34 (state stops 3, account stops 3, RATE_LIMITED 2); guard.js:240 (equal rank keeps stored); README.md:172 | Consequence noted as N-13. |
| N-8 recovery record cleared on confirmed clear; start note shown once | ADDRESSED | service.js:818-831 (`stopClear`; a save that fails throws CONFIG); cli.js:659-667 (`recoveryNote`, `noted`); cli.js:835 (`startServe`) | Side effect on the token-record warning: N-12. |
| Lookup audit lines: no text, no identifier beyond action and outcome; rebuilt into buckets; STATE_LOST also rebuilds | ADDRESSED | service.js:694-712 (`lookup`, `feature`, `route`; `errorDetail` at service.js:119-123 is kind and code only); caps.js:60-79 (`AUDIT_FEATURES`); caps.js:14 (`READ_ACTIONS`); cli.js:709-713 (rebuild on unreadable, or missing with STATE_LOST) | The hashtag line (service.js:1045, target = tag) is pre-existing and not in this round. |
| Inbound wiring: poller and webhook call `service.onInbound`; off by default; no double send | ADDRESSED | cli.js:760 (`onInbound`, looked up at call time), cli.js:769 (webhook notify), cli.js:794 (poller); webhooks.js:247-261 (`notifyStored`, not awaited, audited with kind only); webhooks.js:317-319 (dedupe before append and notify); poller.js:341 (dedupe before append), poller.js:393-400 (`announce`); service.js:774-776 (`AUTO_REPLY_OFF`, no send); service.js:621-630 (check and record in one synchronous block) | No double send for one event: each path checks the same `kind:id` key before append. Backstop for a mismatch between the two ids: the auto-reply cap of one per conversation per 24 hours, see observations. |
| M-7 future-stamped webhook event: 503, not stored; other events stored | ADDRESSED | webhooks.js:12 (`RETRY_LATER`), webhooks.js:306-315 (count, audit with kind and time, no text), webhooks.js:340 (503 when `futureSkipped > 0`) | Retry depends on Meta retrying a 503 (not checkable here; disclosed). |
| M-10 during a stop: events stored, not notified, auto-reply refused | ADDRESSED | service.js:774-776 (skip before the auto-reply check); service.js:593, 621 (`assertNotStopped` in `runOutbound`); webhooks.js:318 (store, no guard) | Intake continues during a stop, as decided. |
| M-11 corrupt-state start rebuilds counters from the audit file; token record empty and stated | ADDRESSED for caps and the token record; cursors and private replies: N-9, N-10 | cli.js:709-713; caps.js:354-431 (`rebuildCapsFromAudit`); cli.js:607-637 (record, `authRecord`); state.js:193-199 (unreadable branch); audit.js:108-135 | |
| I-3 residual: repair never lowers a cursor; a damaged acked position does not redeliver acked events before the clear | ADDRESSED under the N-1 hold | state.js:117-137 (damaged cursor is removed, not reset to 0; marker at state.js:125); state.js:218-220 (the note no longer claims "no cursor moved backwards"); events.js:541-543 and 568 (hold); scratch S2 (pending refused; no redelivery before the clear) | After a confirmed clear the reset to zero re-delivers acked events. That is the ruled behaviour (N-14). |

## New findings

### N-9 (Important): a readable state with lost cursor keys and a stored clear record redelivers with no stop and no hold

- Evidence: guard.js:197-205 raises STATE_LOST only when `stored === undefined`, that is, when the state holds no stop record at all. After any confirmed clear the state stores `stop: { stopped: false, ... }` (guard.js:264-270, persist of CLEAR), so a readable file that later lacks `events.issued`, `events.acked` and `events.lastSeq` raises no stop. events.js:403-404 still sets the marker (no cursors, events in the file). The holds at events.js:541-543 and events.js:568 test `isStopped()` only, so `pending` resets at events.js:543 with no clear.
- Reproduced (`nfix-readable-check.mjs`): stop `null`, marker set, `pending` delivered the 3 acked events with `notice: cursors_reset`.
- Impact: events acknowledged before the loss are delivered again with no stop and no owner clear. This breaks the N-1 criterion ("no re-delivery before the clear") and constraint 14 for that case. The trigger is narrow: an owner restores an older `state.json` taken after an earlier clear while `events.jsonl` is newer, or the cursor keys are removed by hand. README.md:170 defines `STATE_LOST` as "the state file has lost its event counter" with events present, and the code is narrower. README.md:184 says the hold lasts until the owner clears the stop, which is not true here.
- Fix: raise STATE_LOST whenever the cursors are unknown and no stop is held, for example in `buildServe` right after `createEventLog` (cli.js:696-702): `if (events.cursorsUnknown() && !guard.stopStatus().stopped) guard.stop('STATE_LOST', 'the event cursors are unknown')`. Add a test: readable state, clear record, no cursor keys, events in the file: `STATE_LOST` and `pending` refused until the clear.

### N-10 (Important): a failed audit rebuild drops the one-reply records and does not say so

- Evidence: cli.js:610-613 merges `rebuilt.privateReplies` into `private_replies` inside the `try`, after `rebuildCapsFromAudit` returns. When `rebuildCapsFromAudit` throws (caps.js:389-390, `audit.scanSince` throws when a retained file cannot be opened, audit.js:55-59 `forEachLine`), the merge never runs. The catch branch (cli.js:631-638) writes `counters: not rebuilt (...); the caps start from zero` and no private-reply statement. README.md:180-183 describes only the success path.
- Impact: after a damaged-state start with an unreadable audit file, `private_replies` is empty. The preflight at service.js:1215-1223 passes, and a second private reply to a comment that already has one is sent to Graph. The one-reply limit then rests on Meta's rule alone, which the README says was not checked live. This is the fail-open class the brief lists ("a second private reply that is not refused"). The rule is explicit in the global constraints.
- Not run as a repro; established by code reading (the throw path is audit.js:55-59 and caps.js:389-390).
- Fix: in the catch branch, record that the one-reply records were not rebuilt and that a second private reply to a comment is not refused locally, and say the same in README.md:183. Better: scan for `privateReply` lines in its own `try`, so that a caps-scan failure does not drop the one-reply records, and refuse `privateReply` while that rebuild has failed.

### N-11 (Minor): "kept in process" is wrong for a failed save, which restores the last saved image

- Evidence: state.js:284-287 (`writeFileAtomic` fails, then `restoreImage(data, saved)` and rethrow); state.js:92-95 (`restoreImage` replaces memory with the last saved image). events.js:523-526 (`resetCursors`: "Kept in process. The next save writes the reset.") and events.js:403-409 (the marker save) assume the in-memory change survives a failed save. It does not.
- Reproduced (`nfix-writefail-check.mjs`, injected ENOSPC on the state write): after a failed reset save the marker is in memory again. `ack` returns VALIDATION until writes succeed. Each `pending` repeats the events and the notice. After writes recover, `pending` returns the 3 events with the notice, and `ack` works. No loss and no double delivery was seen; the defect is in liveness and in the comment.
- By reading only: if the marker save at events.js:403-409 fails, the marker is dropped from memory while the stop still holds. After the owner's clear, that process's first `pending` delivers without the notice. A restart restores the notice.
- Pre-existing, not in this round: the issued-cursor save in `pending` (events.js:552) is not wrapped, so a raw `ENOSPC` escapes `pending`.
- Fix: correct the comments. For the reset, keep a pending-reset flag that is re-applied after a failed save, or document that a failed save repeats the reset on the next call. Test the failed-save path.

### N-12 (Minor): the N-8 clear removes the token-record instruction; `tokenStatus` shows only `known: false`

- Evidence: service.js:818-831 (the recovery record, with its `authRecord` text, is removed on any confirmed clear); service.js:840-850 (`tokenStatus` with no token record returns `known: false`, `warning: null`). README.md:186 keeps the instruction.
- Impact: after a confirmed clear with the token record still empty, the start note's "run ig auth login" is gone. The owner sees `known: false` with no instruction.
- Fix: keep a token-record warning in `tokenStatus` while the token record is absent, or keep the recovery record until a token record is written.

### N-13 (Minor): one stop record; an observed stop of equal or lower rank is not persisted (constraint 10, owner to confirm)

- Evidence: guard.js:240 (a new stop replaces only a stop of lower rank); guard.js:255-257 (an unknown kind is refused, and a non-replacing stop is not saved); guard.js:28-34 (state and account stops share rank 3). So a CHECKPOINT observed under a STATE_CORRUPT is not recorded, and the reverse drops the state stop's record. The cursor hold still applies, since any stop holds (N-1 unaffected).
- Impact: no outbound safety loss; outbound stays refused. But constraint 10 says "a stop is persisted", and after the owner clears the held stop, an account stop observed earlier is not known until it recurs, so the first outbound call after that clear reaches Meta under the checkpoint. This is the ruled N-7 consequence, not a new defect, but it departs from constraint 10 in this narrow case.
- Fix (owner decision): keep the record of each held stop (a list), or accept the drop and state it in the README (README.md:172 already states the equal-rank rule).

### N-14 (Minor): global constraint 14 and the I-3 criterion now conflict with the ruled reset to zero

- Evidence: global-constraints.md:14 ("never moves backwards"); events.js:515-530 and events.js:543 (acked goes to 0 after a confirmed clear); README.md:184 discloses the redelivery; the I-3 criterion in p4-final-review.md says "pending never re-delivers an acked event".
- Impact: the reset is the owner-ruled behaviour, so this is not a defect in the round. It will be flagged again on every review unless the constraint names the exception.
- Fix: amend global-constraints.md line 14 and the I-3 criterion to name the reset after an owner-confirmed clear.

## Observations (not counted)

1. caps.js:376-390 with caps.js:349 (doc): a `privateReply` line with a non-id target is counted in its bucket (outbound and owner DMs, caps.js:397-398) and also in `unusable` (caps.js:378-380). The doc at caps.js:349 says an unusable line is not put in its counter. The result is fail-closed; the doc is wrong for this case.
2. events.js:676-681 (`receivedAtOf`) reads the whole event file for each `privateReply` line in the rebuild. Acceptable at expected volume; not measured.
3. Double send: the two notify paths dedupe on `kind:id` (webhooks.js:317, poller.js:341). If a webhook `mid` and a Graph message id ever differ for the same DM, both paths store it and both can reply. The auto-reply cap (one per conversation per 24 hours, checked and recorded in one synchronous block at service.js:621-630) limits this to one reply. The `mid` equality is not checked live.
4. The `privateReply` audit line is written best effort (`safeAudit`, service.js:653 and 658). A failed write leaves no line for the rebuild after a damaged-state start, the same as for the counters. README does not name it.
5. The N-3 rebuild reads every retained file once at a recovery start (up to 11 files of 50 MB). Cost not measured; the implementer disclosed it.
6. The `events.cursors` audit line is queued and written at the poller's next tick (poller.js:606). The owner's `pending` response carries the notice at once.

## Security and correctness checks

- No secret or message text in any new audit line, notice, error or log. Checked: `events.cursors` (events.js:527, `reason`, `acked`, `issued`); `state.repair` (state.js:215-220, fixed strings and cursor names); `holdError` (events.js:505-509, fixed text and the marker reason); the recovery record and `capsRebuild` detail (cli.js:593-640, counts and fixed strings); `recoveryNote` (cli.js:659-667); `stopClear` CONFIG (service.js:824-826, fixed text); lookup audit (service.js:707, 711, kind and code only).
- No write is retried: `recoveryNote` saves once (cli.js:661-666); `stopClear` saves once (service.js:823-827); `resetCursors` saves once (events.js:523). A retry after a failed `stopClear` is the owner's confirm.
- No new path sends a write without the gates: the N-fixes add no outbound path. Reset and rebuild are local.
- Fail-open paths:
  - Rebuild undercounts without a notice: counted damage is noted (cli.js:593-597). A failed scan is not noted for the private replies (N-10).
  - A stop not saved: `stopClear` throws CONFIG and keeps the record (service.js:824-826); guard persist throws (guard.js:174-181). No fail-open found.
  - A cursor that moves backwards: only the owner-ruled reset (N-14). A readable state with lost cursor keys is not held (N-9).
  - A second private reply not refused: the success path refuses (service.js:1215-1223); the failed rebuild does not (N-10).
  - A double send from the two notify paths: none found; see observation 3.
- No test listens on a port or makes a network call: the changed test files (`test/audit.test.js`, `test/caps.test.js`, `test/cli.test.js`, `test/events.test.js`, `test/guard.test.js`, `test/state.test.js`, `test/tools.test.js`) contain no `listen(`, `createServer` or `fetch(`. The new cli tests call `buildServe` without `fetchImpl`; `buildServe` makes no request (`verifyOwner` and `poller.start` are called only from `startServe`, cli.js:830 and 857).
- Changed tests: the list in `task-11-report.md` matches the diff. The one replaced assertion (audit.test.js, scanSince rotation) is consistent with N-3.

## Changes requested before PASS

1. N-9: raise STATE_LOST when the cursors are unknown and no stop is held; add the readable-state test.
2. N-10: state the failed-rebuild case for the one-reply records (code and README), and keep the private-reply rebuild independent of the caps scan.
3. N-11 to N-14: fix or document as the owner decides (the comment and the failed-save behaviour; the token-record warning; the equal-rank stop record; the constraint 14 wording).
