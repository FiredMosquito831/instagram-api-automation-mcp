# Task 13 re-review: fix round 3

Scope: fix round 3 only, from snap/task-13-fix2-head to snap/task-13-fix3-head (review-task-13-fix3.diff, 10 lines of context). Two items: N-1 (the success-path audit failure was silent) from task-13-rereview-2.md, and the N-2 wording (the dmMessages truncation reason). Read-only. The live src/service.js and test/service.test.js were checked with cmp and are byte-identical to snap/task-13-fix3-head. No test run (the report holds 544/544), and no focused node check was needed.

Note on labels: task-13-rereview-2.md also has an N-2 (Minor), which is a different finding: truncation is inferred from page length and `paging.next` is ignored. It is still open. It is listed under carried forward below, not under the finding verdicts.

---

## Finding verdicts

**N-1: ADDRESSED.**
- Warning on a failed audit write: `safeAudit` at src/service.js:264-270. The catch at :267 calls `process.emitWarning(\`audit line not written (${errorName(err)})\`)` at :268. The text is a fixed label plus the error name. `errorName` (src/service.js:96-99) keeps only `[A-Za-z0-9_]`, caps the result at 64 characters, and falls back to `'error'`. No message, entry, target id, path or secret can reach the warning.
- The success path still returns the result: `caps.record` at src/service.js:431 and `perform` at :434 come before the audit. `safeAudit` at :442 cannot reject the call, and `return redact(result)` is at :443. An audit failure therefore cannot turn a counted write into a reported failure.
- The request is counted once: the test asserts one POST, one `caps.likes` entry and one `caps.outbound` entry (test/service.test.js:995-998).
- The test (test/service.test.js:974-1003) throws an error whose message holds the target id and a token-like string (:986). It adds the listener at :990 and wraps the rest in `try` at :991. It waits one tick at :994, since `emitWarning` defers the emit with `nextTick` and the wait is queued after it. It asserts exactly one warning (:999) and its exact text (:1000). It removes the listener in `finally` at :1001-1002, so a failed assertion does not leak the listener into later tests.

**N-2 (wording): ADDRESSED.**
- src/service.js:656-658. `reason` is `may be truncated: a full page of ${pageSize} messages, the first page only` (:657). With the default page size of 20 this is the requested text. `truncated` is still `messages.length >= pageSize` (:656), and `reason` is null when `truncated` is false (:658). The flag is unchanged.
- test/service.test.js:1113 asserts the exact new text for the 20-message page. The fix3 diff changes only this test among the M-11 tests. The 3-message test still asserts `truncated` false and a null reason.

**Carried forward (not new, not in this round's scope): task-13-rereview-2 N-2, paging. Minor, still open.**
- src/service.js:655-656. `conversationMessages` reads one page and ignores `paging.next`. `truncated` is still inferred from page length, so a short first page with older messages reports no truncation. The implementer left this open on purpose (task-13-report.md section 12, note on N-2). The coordinator scoped the round to wording.

---

## New breakage

**Minor: `errorName` is not guarded against a throwing `name` getter.** src/service.js:96-97 reads `err?.name` with no try. The call at :268 runs inside the catch of `safeAudit`. If `audit.record` throws a value whose `name` getter throws, `errorName` throws out of the catch, and `safeAudit` throws. On the success path (src/service.js:442) that rejects `runOutbound` after the write is counted, which is the I-2 failure again. On the error path (src/service.js:437) it replaces the original error. This needs a deliberately hostile thrown value. `audit.record` throws only a `TypeError` (src/audit.js:17, :34) or a filesystem error, and neither has a throwing getter. Fix: read the name inside a try and fall back to `'error'`, or put the `emitWarning` call inside its own try.

**Checked, no new breakage found:**
- A warning that carries a message, a path or a secret: none. The template is fixed and the name is identifier-only (src/service.js:96-99, :268).
- A warning on the error path that changes the error the caller gets: none for the cases above. The catch at :267 does not rethrow, and the caller still gets `unknownOutcome(failure, feature)` at :438. The one exception is the Minor above.
- A listener not removed: none. The removal is in `finally` (test/service.test.js:1001-1002).
- A success-path result not returned: none. `return redact(result)` is at src/service.js:443.
- A fail-open path: none. A failed audit still does not change the outcome. This is the intended behaviour for a counted write.
- `onInbound` never rejecting: holds. `process.emitWarning` does not throw, so the inbound skip and `onInbound` paths that use `safeAudit` keep the property.

---

## Round verdict

Findings remaining, Minor only. Nothing blocks this round.

- N-1 and N-2 (wording): both ADDRESSED.
- New, Minor: `errorName` is not guarded against a throwing `name` getter (src/service.js:96-97, call at :268). Hardening only.
- Carried forward, Minor: task-13-rereview-2 N-2, paging (src/service.js:655-656). Still open, deferred by the coordinator.

Counts for this round: new Critical 0, new Important 0, new Minor 1.
