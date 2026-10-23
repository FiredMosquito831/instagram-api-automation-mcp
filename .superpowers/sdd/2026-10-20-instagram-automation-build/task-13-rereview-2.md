# Task 13 re-review: fix round 2

Scope: fix round 2 only, from snap/task-13-head to snap/task-13-fix2-head (review-task-13-fix2.diff). The live src and test files that round 2 touched are byte-identical to snap/task-13-fix2-head (checked with cmp). Read-only. No test run (the report holds 544/544), and no focused node check was needed. src/service.js is now 909 lines.

---

## Finding verdicts

**I-1: ADDRESSED.**
- The window passes the kind. `requireOpenWindow` calls `events.lastInboundAt(senderId, { kind: 'message' })` at src/service.js:311. Its callers are the dmSend preflight (src/service.js:813) and the auto-reply preflight (src/service.js:467). No other window caller exists.
- The kind filter is in src/events.js:357-367 (the filter at :363; an unknown kind is refused at :359). Stored kinds: messages are `kind: 'message'` (src/webhooks.js:125, src/poller.js:189); comments and mentions are `'comment'` and `'mention'` (src/webhooks.js:138, :151). Owner echoes are dropped at src/webhooks.js:115.
- Test: test/service.test.js:961 (a comment one hour old and a message 25 hours old: WINDOW_CLOSED, zero requests, lastInboundAt called with `{ kind: 'message' }`). The real filter is tested at test/events.test.js:188. The service test runs over a fake log that models the kind (test/service.test.js:71-77).

**I-2: NOT ADDRESSED.** The defect is fixed, but the ledger's visibility condition is not met.
- Fixed: the success path calls `safeAudit` at src/service.js:434 and returns `redact(result)` at :435. An audit failure after a counted write no longer turns it into a reported failure. Test: test/service.test.js:974 (one request, one count, result returned).
- Not met: `safeAudit` (src/service.js:256-262) catches the error and does nothing. No warning and no log is emitted. The ledger requires a visible warning carrying the error name only. Reported as Important N-1 below.

**M-1: ADDRESSED.**
- `guard.assertNotStopped()` is at src/service.js:414, after the owner and preflight awaits (:406-407) and before `caps.check` (:415). From :414 to the `perform` call at :426 there is no await: `caps.check` (src/caps.js:211), `usageHold` (src/service.js:295-306) and `caps.record` (src/caps.js:235) are synchronous. The check is therefore effectively immediately before perform. A refused stop records nothing.
- Test: test/service.test.js:987 (a stop set during the owner read: STOPPED, zero POSTs, no caps.outbound entry).

**M-4: ADDRESSED.**
- src/caps.js:43-44: `private_reply: 'owner_dm'`. The diff changes only this line; the other mappings in the object are unchanged.
- Old assertion: none. No test pinned `private_reply` to `null` (searched test/caps.test.js and test/service.test.js). The report's section 11.2 says the same, and that holds.
- New assertion: test/caps.test.js:160 (49 owner DMs, then a private reply: used is 50, and the next owner DM and the next private reply are refused). Service-level: test/service.test.js:1003.

**M-7: ADDRESSED.**
- `readCall` (src/service.js:445-452) calls `observe(err)` at :449 only when the error is an IgError whose kind is in `READ_STOP_KINDS` (src/service.js:441): CHECKPOINT, ACTION_BLOCKED, RATE_LIMITED. `observe` (src/service.js:245-254) calls `guard.stop` (src/guard.js:199) and saves through it.
- AUTH_EXPIRED is not in the set, so a read sets no stop.
- Codes, checked against src/errors.js:38-41 and :64-70: 190 gives AUTH_EXPIRED; HTTP 429 or Graph codes 4, 17, 32, 613, 80002 give RATE_LIMITED; 368 or feedback-required text gives ACTION_BLOCKED; checkpoint, challenge or two-factor text gives CHECKPOINT. This matches global constraints line 10. CHECKPOINT is detected from message text, which is pre-existing.
- Tests: AUTH_EXPIRED sets nothing, test/service.test.js:1024. CHECKPOINT sets the stop, which is saved, and the next dmSend is refused with STOPPED and zero POSTs, :1031. ACTION_BLOCKED, :1043. RATE_LIMITED, :1050.

**M-8: ADDRESSED.**
- The tokenRefresh catch is `throw observe(readError(err))` at src/service.js:563. It sets the stop through `guard.stop` and rethrows. A 190 from the refresh call is an IgError of kind AUTH_EXPIRED (src/errors.js:64), so `shouldStop` holds. The token is written only after the try block (src/service.js:565).
- Test: test/service.test.js:1057 (AUTH_EXPIRED rethrown, stop AUTH_EXPIRED saved, no token written).

**M-10: ADDRESSED.**
- src/service.js:658 `checkGraphId(senderId, 'senderId')` runs before `events.markRead` (:659), which is the only write in that method.
- Test: test/service.test.js:1069 ('not-digits' and two spaces are both VALIDATION, and no markRead call is made).

**M-11: ADDRESSED, with a Minor note (N-2).**
- `DM_PAGE = 20` at src/service.js:49. `dmMessages` at src/service.js:641-650: no match gives `{ messages: [], truncated: false, reason: null }` (:645). Otherwise `truncated = messages.length >= pageSize` (:648) and `reason` is `'first page only'` when truncated (:649).
- Tests: a full page of 20 gives truncated true with the reason, test/service.test.js:1076. Three messages give truncated false, :1097.

**M-16: ADDRESSED.**
- Service-level test at test/service.test.js:1112. With a reading of 80 on the app bucket, dmSend is busy with `retryAfterMs` 60000 and reason "reached 80 percent". After 30 s it is 30000. After 60 s the send goes through, and the same reading does not re-arm the hold. As the report says, this characterizes the existing gate, so it also passes on the old code. It satisfies M-16 as written.

---

## New breakage

**N-1, Important: a failed success-path audit is silent.** src/service.js:256-262, the `safeAudit` helper: `try { audit.record(entry); } catch { /* comment only */ }`. The helper is now also used on the success path at src/service.js:434. It was already used on the error path (:429), for the owner actions (:526, :567, :576, :703, :709), for the inbound skips (:480, :486) and in `onInbound` (:905). When the audit line fails, nothing is emitted. The ledger condition for I-2 (a visible warning carrying the error name only, with no secret and no message text) is not met, and the report's section 11.6 accepts the silence rather than fixing it.
- Fix: in the catch, `process.emitWarning(\`audit line not written (${err?.name ?? 'error'})\`)`. This is the same pattern as src/poller.js:316.
- Test: an audit that throws with a message containing a token-like string gives one warning whose text is the error name only. The write result is still returned.
- The helper is shared, so the fix also covers the error path.

**N-2, Minor: truncation is inferred from page length, not from paging.** src/service.js:648. `conversationMessages` (src/graph/endpoints/messaging.js:138-151) reads one page and ignores any `paging.next`. If Graph returns a first page shorter than `pageSize` while older messages exist, `truncated` is false and the older messages are omitted with no reason. The same pattern is at src/service.js:622 (commentsList). Live-phase check: the default page size of the conversation messages edge. Fix: have the endpoint report whether a next page exists.

**Checked, no new breakage found:**
- A window that counts a comment or mention: none. The only window caller passes `'message'` (src/service.js:311).
- A stop set on AUTH_EXPIRED from a read: none. `readCall` (src/service.js:449) is the only read-side observe, and it excludes AUTH_EXPIRED. `ownedSetOf` (src/service.js:317-324) and `ownedParentOf` rethrow stop errors without observing, and the enclosing read or runOutbound observes them. Inside a write, runOutbound observes every stop kind, as before (:405-410, :427-429). That is the write rule, not a read.
- A read that does not set the stop on CHECKPOINT: none. Every Graph read goes through `readCall`. Reads inside a write's preflight or ownerCheck are observed by runOutbound (:405-410).
- A write that runs after a stop: none introduced. `assertNotStopped` runs at :395 (before the gate) and at :414 (after the last await).
- A caps mapping change that drops another mapping: none. The caps diff changes one line (src/caps.js:44).
- A truncation flag set on a partial page: none. The flag is set only when the page is full (:648). The reverse risk is N-2.
- A fail-open path: none new. The swallowed errors are `safeAudit` (N-1, a visibility gap) and the save failure in `observe` (src/service.js:249-251). The latter holds the stop in process and retries it on the next `assertNotStopped`. A restart before a successful save loses it. That is the Task 4 design, unchanged here, and the new read stops inherit it.

**Observation, not counted as new breakage:** src/events.js:357-367 still counts every kind when no kind is given (test/events.test.js:184 pins that). No current caller uses the default for the window. It is still the unsafe default that I-1 was about. Suggest the final review require the kind, or add a `lastMessageAt`.

---

## Round verdict

Findings remaining. Not PASS.

- N-1 (Important): a failed success-path audit is silent. This leaves I-2 NOT ADDRESSED, because the ledger's visibility condition is not met.
- N-2 (Minor): truncation is inferred from page length.

Counts for this round: new Critical 0, new Important 1, new Minor 1.
