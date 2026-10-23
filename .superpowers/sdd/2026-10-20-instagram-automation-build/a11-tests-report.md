# A-11 test gaps: report (2026-10-23)

Status: DONE_WITH_CONCERNS

Scope: tests only. No file under src/, bin/ or sidecar/ was changed, package.json is unchanged, and no git command was run.

## Counts

- Before: 1060 pass, 0 fail (first `npm test` of this task).
- After: 1087 pass, 0 fail (final `npm test`, exit 0, about 6 s).
- The rise of 27 is 21 new tests from this task, plus 6 tests that were added by something other than this task while it ran (see Concerns, item 1).

## New tests (21)

test/graph-client.test.js (7)
- a Retry-After of 0 is retried at once: the wait is 0 ms, not the backoff, on a 429 and on a 503
- a 2xx body of {"error": null} is success for a read, and the client returns a write without judging it
- a write that answers 2xx {"error": null} is refused by its endpoint as API_ERROR, and is sent once
- a DELETE sends its query fields and the id in the path, with the Bearer header and no body
- unlike sends the target field and the owner id as a DELETE through the real client
- mediaDelete sends DELETE to the media id on graph.facebook.com, and reports the deletion
- a DELETE with a null query, and an endpoint given a null options argument, are VALIDATION with no request

test/endpoints-social.test.js (2)
- unlike and commentDelete refuse a null options argument with VALIDATION, and make no request
- a DELETE is made with its path and query only, and no third argument

test/token.test.js (2)
- the longest allowed interval is passed to setInterval as it is, and one timer is made
- the hourly check keeps running after a failing check, because runTokenCheck handles its own failure

test/poller.test.js (6)
- start schedules one timer, due at once; a second start adds none; stop clears that timer
- a tick that throws does not stop the loop: the next timer is set at the interval, and the tick after it reads
- stop during a tick: the tick finishes, and no timer is set after it
- no timer is longer than 2147483647 ms, and the largest allowed interval is used as it is
- after a RATE_LIMITED the next timer is the doubled interval
- a message stored before a restart is not stored again by a poller over the same files

test/events.test.js (2)
- dedupe holds across a restart: a new event log over the same files refuses the same id
- a purged event id is still refused after a restart, inside the dedupe window

test/webhooks.test.js (1)
- a GET through the handler answers only a matching handshake, and stores and audits nothing

test/service.test.js (1)
- a like answered with 2xx {"error": null} is reported as a write that may or may not have reached Instagram

## Already covered before this task (not duplicated)

- The handshake through the handler, match and mismatch: webhooks.test.js, "the handshake through the handler echoes the challenge...".
- Dedupe across a restart at webhook level: webhooks.test.js, "dedupe holds across a restart".
- A null options argument for mediaDelete: endpoints-media.test.js, the A-13 test.
- scheduleTokenChecks refuses an interval above 2147483647 and accepts the limit: token.test.js.
- runTokenCheck logs a failure and does not throw: cli.test.js, "a failing token check is logged by its kind...".

## Product bugs

None found. All 21 new tests passed on their first run.

Mutation check (run on a scratch copy of src and test in the scratchpad, never in the project). One defect was applied per gap, and each was caught:
- M1 src/graph/client.js:177, Retry-After 0 waits 1 s: graph-client "a Retry-After of 0..." fails.
- M2 src/graph/client.js:158, {"error": null} treated as an error: two graph-client tests fail.
- M3 src/poller.js:639, start without the running check: "start schedules one timer..." fails.
- M4 src/poller.js:646, stop does not clear the timer: the start/stop test and the tick-throws test fail.
- M5 src/poller.js:632, a throwing tick is rethrown: the tick-throws test fails.
- M6 src/events.js:456, the index is not loaded at start: "a purged event id is still refused after a restart" fails. The non-purged restart test stays green, which is expected: the event file still holds that key.
- M7 src/webhooks.js:264, GET answers every handshake: the new webhook GET test fails.
- M8 src/graph/endpoints/common.js:48, null options pass through: the unlike/commentDelete null test fails.
- M9 src/token.js:127, the bound loosened: the existing token limit test fails.

## Concerns for the controller

1. Concurrent edits during this task. Files outside this task changed between 01:45 and 01:52 (modification times): src/redact.js, src/errors.js, src/service.js, src/caps.js, test/caps.test.js, test/errors.test.js, src/cli.js, bin/ig.js, test/cli.test.js, and the progress.md. Those changes add tests in test/caps.test.js (1), test/cli.test.js (9), test/errors.test.js (2) and test/service.test.js (2, the one-reply flag tests). I did not touch any of them. My baseline was 1060 and my 21 tests are the only ones I added, so 6 of the rise came from those edits (1087 - 21 - 1060 = 6). The final run is green. Please confirm those edits are intended. progress.md (P5b notes) already flagged this risk.

2. The poller takes no timer injection (src/poller.js start, stop and schedule, lines 617-648 call the global setTimeout and clearTimeout). The poller tests replace the two globals for the length of each test and restore them afterwards. No real timer is created. If you want a cleaner seam, add injected timers to createPoller. That is a product change, so I did not make it.

3. scheduleTokenChecks (src/token.js:133-135) does not catch a throwing check. Its comment says check must handle its own failures, and the server's check (src/cli.js runTokenCheck, lines 1100-1107) does. I did not write a test that expects the loop to survive a throwing check, because the contract puts that on the check. A future check that throws would be an uncaught exception from a Node timer.

4. src/graph/endpoints/media.js:266-272 (mediaDelete) accepts only mediaId and sends no query, so an extra field such as "fields" is silently ignored and never sent. The brief said a DELETE "sends the options it was given (the fields and the id)". The tests pin what the code does: the id is the path, and unlike sends the target field as its query. Your call whether mediaDelete should take fields.

5. Not covered: the A-11 row in final-review.md also lists the untrusted-marker check (Task 3 M-10 c). It is not among the six gaps I was given, so I did not add it.
