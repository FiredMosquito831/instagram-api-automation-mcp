# Task 13 review: service core (task-13-base to task-13-head)

Scope read: the brief, the global constraints, spec lines 36 to 49 and 153 to 159, progress.md (rulings a to o and the Task 13 entries), the implementer report, review-task-13.diff, and the live modules the service depends on: src/guard.js, src/caps.js, src/events.js, src/audit.js, src/errors.js, src/graph/client.js, src/graph/endpoints/messaging.js, comments.js, likes.js, media.js, discovery.js, common.js, src/token.js, src/config.js, src/webhooks.js (where comment and mention events are created), src/poller.js (where message events are created). The live src/service.js, test/service.test.js, test/endpoints-social.test.js and src/graph/endpoints/comments.js are byte-identical to snap/task-13-head. Nothing was re-run and no project file was edited.

Note: report section 10 and section 9 say service.js is 874 lines. It is 886 lines. The report figure is stale.

---

## Spec compliance

Verdict: ❌. One named rule is not met as written: the 24-hour DM window reads comment and mention events as inbound (I-1 below). Everything else on the checklist meets the brief, the amended order and the rulings, except the items marked ⚠️.

- ✅ Method surface. Every read, outbound, unofficial, stopClear, tokenRefresh and autoReplySet method in brief Interfaces is present (src/service.js:487 to 886). createService takes getClient(product, { onUsage }) (src/service.js:195), the R6 amendment, and the client is built per call.
- ✅ runOutbound order, as amended by ruling (a) and the accepted amendments. Stop check src/service.js:391. Route :392. Client built, no request :396 to 399. Confirm gate :400 returns the preview with no request. Owner check and preflight reads :402 to 403, after the gate. caps.check :407. Usage hold :411 to 413. caps.record before perform :415. perform :418. Success audit :424. Result :425.
- ✅ A preview makes no request (src/service.js:400; test at test/service.test.js:260 asserts zero requests and no caps state).
- ✅ Busy records nothing. Caps busy at src/service.js:408 and usage busy at :412 return before caps.record (test/service.test.js:268 asserts one outbound entry only).
- ✅ Stop on a perform error. observe() (src/service.js:243 to 252) is called on the perform error at :420, then the error is rethrown (:422). The detail is codes only (stopDetail, src/service.js:101 to 104). Tests at test/service.test.js:300 and :785.
- ✅ Usage. An unreadable marker, or no app reading at all, holds the call for 60000 ms before the gate (src/service.js:293 to 305, :411). The gate receives usage.app only (:296). Tests at :516, :550 and :532.
- ✅ Writes. No write passes retryPost (no retryPost in src/service.js; src/graph/client.js:228 makes POST non-retryable by default). An API_ERROR on a write is reported as an unknown outcome and not retried (unknownOutcome, src/service.js:107 to 113, used at :422). Test at test/service.test.js:561.
- ✅ hashtagSearch. An API_ERROR is reported as an error, not a no-match (src/service.js:641 to 658). The endpoint refuses an empty data array as API_ERROR (src/graph/endpoints/discovery.js). Test at test/service.test.js:662.
- ✅ Ownership. Reply, hide and delete check the parent media (src/service.js:718, :732, :745). A like or unlike on a comment checks the parent (:761, :775). A like or unlike on a media has no owner check (:761 and :775 take null for kind media, per the owner ruling in fix round 1). An unknown parent is refused (ownedParentOf, src/service.js:330 to 345). The first-page limits are refusals with a reason (ownedSetOf and requireOwnedMedia, :313 to 328; commentsList, :598 to 610). Tests at :578, :592, :625, :643.
- ❌ DM 24-hour window. requireOpenWindow (src/service.js:307 to 310) passes events.lastInboundAt(senderId) to messageWindowOpen. events.lastInboundAt returns the newest event of any kind from that sender (src/events.js:356 to 365). Comment and mention events are stored with the commenter as senderId (src/webhooks.js:138 and :151). So dmSend (preflight at src/service.js:790) passes when only a comment or mention is under 24 hours old and the last message is older. The rule is "the last inbound message from that user" (global constraints line 11). The test at test/service.test.js:281 uses message times only, so the gap is not covered. Latent while webhook.enabled is false (src/config.js:61).
- ✅ privateReply. Preflight order: duplicate check (src/service.js:806), owned parent (:810), the comment's own time via commentTimeOf (:811; src/service.js:348 to 356, which refuses on any non-stop failure and passes stop errors), then privateReplyOpen inside a try that becomes WINDOW_CLOSED (:813 to 817). The reservation under private_replies is written in perform before the send (reservePrivateReply, src/service.js:363 to 369; called at :821). Tests at :344 and :375.
- ✅ dmMessages. Conversation lookup through conversationsList({ userId }) and the first id (src/service.js:624 to 627). No match gives an empty list (:625). Test at :698 and :715.
- ✅ Auto-reply. Skips the owner's own events (src/service.js:470), non-message events (:471), disabled (:472), empty text (:473), no rule match, and an event already answered (:476). The per-sender 24-hour limit is enforced by the caps auto_reply rule, which is recorded in state (src/caps.js:103 to 110 and :196 to 198). The send goes through runOutbound with action auto_reply (src/service.js:443 to 456). Tests at :459, :721, :732, :745 and :754.
- ✅ Re-delivery. An event already answered is skipped before any reply (src/service.js:476). The poller skips stored events before it calls onInbound (src/poller.js:178 and :206). Test at :754.
- ⚠️ Audit detail. The error path carries kind and code only (errorDetail, src/service.js:94 to 99). An inbound skip carries sender and receivedAt only (:468 to 470). Tests at :769 and :745 assert the text and raw Graph text are absent. The success path is not guarded (see I-2).
- ✅ publishMedia quota. requireQuota (src/service.js:371 to 380) reads contentPublishingLimit with since set to 24 hours ago (src/graph/endpoints/media.js:97 to 114, which refuses a missing quota). CAP_EXCEEDED when quotaUsage >= quotaTotal. Test at test/service.test.js:797.
- ✅ Read tools. readCall (src/service.js:429 to 436) gives a clean IgError and does not observe stops. Tests at :316 and :833.
- ⚠️ Read tools and stop codes. Reads never set the stop, for any code (src/service.js:429 to 436). The brief requires this for AUTH_EXPIRED and says reads never change stop state. Global constraints line 10 lists RATE_LIMITED and CHECKPOINT as persisted stops with no read or write split, so this is an owner decision (M-7).
- ✅ Events. eventsPending marks each event untrusted (src/service.js:667 to 671; stored events must carry untrusted true, src/events.js:95). eventsDecide records only and calls no send method (:678 to 686). eventsAck calls events.ack (:672 to 676), which refuses unissued and backwards cursors (src/events.js:316 to 324).
- ✅ Routes. assertRoute (src/service.js:274 to 291): unknown features refused; personal refuses official features; unofficial needs enabled and acknowledged; a Facebook token is required for mediaDelete, hashtagSearch and businessDiscovery (FACEBOOK set at :70; check at :286). Like and unlike use routes.likes.loginProduct (productOf, :262 to 266). Tests at :427, :439, :447, :818.
- ✅ Confirm. Every outbound method goes through guard.gate (src/guard.js:65 to 69 and :237 to 239). Non-boolean confirm is refused with VALIDATION. autoReplySet and stopClear use the same rule.
- ✅ Caps. The bucket rules in src/caps.js match the spec table (:95 to 122). DEFAULT_CAPS matches the spec (src/config.js:21 to 34). Two exceptions are listed as Minor: the private-reply day knob (M-3) and private replies not counted toward owner DMs (M-4).
- ✅ Brief tests. All 13 are present with the brief names (test/service.test.js:260, 268, 281, 300, 316, 323, 344, 407, 417, 427, 439, 447, 459, 475).
- ✅ Ledger rulings (a) to (o). Each has a test. Mapping in report section 2 and section 10.3; the test names resolve (test/service.test.js:493 to 857).
- ⚠️ Not verifiable from the diff: live Graph formats (comment timestamp, conversation and message times, quota fields; see the ledger's live-phase items); Task 17 routing every Graph client through getClient with onUsage (carry-forward); the Node 22.12 run (report section 9); the 529/529 count (not re-run, per instructions).
- ⚠️ Owner-only. The owner is structural: every action uses config owner. guard.assertOwner exists but is never called (M-13).

---

## Strengths

- The gate order is written once and the amended order is recorded in a comment (src/service.js:386 to 389).
- caps.check, usageHold and caps.record run in one synchronous block (src/service.js:407 to 415), so two concurrent calls cannot both pass the spacing check.
- Fail-closed defaults hold throughout: no usage reading holds; a null window is closed (src/graph/endpoints/messaging.js messageWindowOpen and privateReplyOpen); a missing comment time refuses; an unknown route is refused; a non-boolean confirm is refused.
- Write safety is consistent. No write retries anywhere, the client makes POST non-retryable by default (src/graph/client.js:228), and an API_ERROR on a write is an explicit unknown outcome.
- The stop is saved before any refusal, and a failed save still stops this process and is retried on the next call (src/guard.js:154 to 161 and :183 to 192).
- Redaction discipline: stop detail, audit error detail and inbound skips carry codes and identifiers only. Test at test/service.test.js:769 and :785 assert the message text and raw Graph text are absent.
- The tests use fake clients, a fake clock and a fake state. The real caps and guard run over the fake state, and no test makes a network call. Ordering is asserted directly (test/service.test.js:493 to 507).
- The ledger is traceable: every ruling (a) to (o) has a named test, and the implementer ran eleven mutation checks.

---

## Issues

### Critical

None.

### Important

**I-1. The DM window counts comment and mention events as inbound.**
Where: src/service.js:307 to 310 (requireOpenWindow) and :790 (dmSend preflight); src/events.js:356 to 365 (lastInboundAt has no kind filter); src/webhooks.js:138 and :151 (comment and mention events are stored with the commenter as senderId).
What is wrong: the 24-hour check uses the newest event of any kind. A comment or mention under 24 hours old opens the window even when the last message from that user is 25 hours old. The rule is "last inbound message" (global constraints line 11). No test covers this, because test/service.test.js:281 gives only message times. It is latent while webhook.enabled is false (src/config.js:61), and live when the webhook is enabled. Whether Meta also refuses such a send is not verified here.
Fix: give lastInboundAt a kind option and pass kind 'message' from requireOpenWindow, or add a separate lastMessageAt. Add a test: a comment event 1 hour old, a message 25 hours old, dmSend refused with WINDOW_CLOSED and zero requests.

**I-2. A successful write can be reported as a failure.**
Where: src/service.js:424 (audit.record on the success path, not guarded). The error path uses safeAudit (:421, defined at :254 to 259).
What is wrong: audit.record writes with appendFileSync (src/audit.js) and can throw after the write has been sent and counted. The caller then receives a raw, non-IgError failure for an action that happened, and a retry would send a second DM, like or publish. This is the situation the unknown-outcome rule exists to prevent.
Fix: use safeAudit on the success path too and return the result. Add a test where the audit throws on success: one request, one count, and the result is returned.

### Minor

**M-1. A stop set during the owner check or quota read does not stop perform.** src/service.js:391 is the only assertNotStopped call, and the awaits at :402 to 403 come after it. Fix: call guard.assertNotStopped() again right before caps.check (:407). The sync block that follows stays as it is.

**M-2. Owner and quota reads run before the caps and usage checks.** src/service.js:402 to 413. A call that will return busy still makes up to two Graph GETs during a usage-throttle window. Fix: run caps.check and usageHold once before the reads, without recording. After the reads, repeat check, usageHold and record in one synchronous block.

**M-3. The private-reply day knob is never read.** src/config.js:28 defines privateReplies.perCommentDays and validates it, but privateReplyOpen (src/graph/endpoints/messaging.js) hard-codes WEEK_MS. An owner's edit has no effect. Fix: pass the configured days into privateReplyOpen, or remove the knob.

**M-4. Private replies are not counted toward owner DMs.** src/caps.js:43 maps private_reply to null, so it does not count toward owner_dm (50 per day). The spec's "owner-sent DMs 50 per day" may include them (interpretation, to confirm with the owner). If it does, map private_reply to owner_dm.

**M-5. Bulk reads of other accounts have no bound.** businessDiscovery (src/service.js:660 to 665) and mentionedMedia (:591 to 596) are reads through readCall and bypass caps. Spec Call O says "single, on-demand lookups", and nothing in the code enforces that. Owner decision: add a per-day bucket for businessDiscovery, or confirm the limit is manual.

**M-6. hashtagSearch bypasses runOutbound.** src/service.js:641 to 658: no assertNotStopped, no usage hold, no audit line, but it counts toward outbound spacing and the 200-per-day total (src/caps.js:95 and :214 to 221). A stop does not stop hashtag lookups. Fix: route it through the same guard and audit, or record the intended behaviour explicitly.

**M-7. Stop codes on reads.** src/service.js:429 to 436. Per the brief, reads never change stop state. RATE_LIMITED and CHECKPOINT on a read are account-level signals, and global constraints line 10 does not separate reads from writes. Owner decision.

**M-8. tokenRefresh does not stop on an error 190.** src/service.js:527 to 552. It is not gated by assertNotStopped, and its catch uses readError (:544) without observe(). A 190 on refresh does not set the stop, unlike every write path. Fix: observe(err) in the catch, or document the exception.

**M-9. A failed save leaves the new value in memory.** src/service.js:198 to 206 (writeState sets, then saves). state.js set has no rollback. Effects: autoReplySet's flag stays on in process while unsaved, and tokenRefresh stores the secret before its record save. Fix: restore the previous value when save fails, then throw.

**M-10. dmMarkRead takes an unchecked senderId.** src/service.js:635 to 639. events.markRead checks only that the text is non-empty (src/events.js:368 to 373). Fix: checkGraphId(senderId, 'senderId') first.

**M-11. dmMessages reports no truncation.** src/service.js:621 to 631. A thread longer than the 20-message page returns the first 20 with no reason. commentsList reports this (:598 to 610). Fix: add truncated and reason in the same form.

**M-12. assertRoute allows official features for any account type except personal.** src/service.js:283. src/config.js:123 prevents other values at load, so this is defence in depth only. Fix: allow only business and creator.

**M-13. guard.assertOwner is never called.** src/guard.js:175 to 179. The owner rule rests on the config constant. Task 17 should check once, when the token is loaded, that the token's account (GET me) is owner.igUserId. ⚠️ Task 17.

**M-14. The adapter is resolved before the gate.** src/service.js:398 runs unofficial.forFeature before guard.gate (:400). An unconfirmed follow on an unmapped feature throws NOT_SUPPORTED instead of previewing. Fix: resolve the adapter inside perform.

**M-15. Reservations are written before the send.** src/service.js:453 (replied list) and :821 (private_replies). A send that fails before Graph accepts it, such as an AUTH_EXPIRED or a stop, leaves the event or comment marked as answered and never retried. This is fail-closed. Document it, or release the mark when the error is known to be before the send.

**M-16. Test gaps.** (a) No service-level test for the usage throttle at 80 or more; the readings used are low or unreadable (test/service.test.js:30 and :516). (b) No test for comment and mention events and the window (I-1). (c) No test for an audit failure on a successful write (I-2). (d) No test for unlike on a comment's parent, for businessDiscovery's personal and Facebook-token refusals, for reel, carousel or story publishing, or for a stop during the owner-check await (M-1). Report section 5 lists some of these.

**M-17. Code quality.** checkGraphId (src/service.js:80 to 82) is a pass-through alias of checkId. `const clock = () => now();` (:189) wraps now with no purpose. hashtagSearch repeats the route, caps and busy logic instead of using runOutbound (see M-6). Report line counts are stale (see the note at the top).

**M-18. Known limits for the Task 18 README.** The first 100 owned media limit affects mediaGet, insightsMedia, commentsList, mediaDelete and private replies (src/service.js:313 to 345). The report's section 7 lists the 100-comment page as superseded but does not list this limit. Add it with M-7 and the auto-reply rule shape.

Not counted: the mediaDelete empty-2xx success (src/graph/endpoints/media.js:222 to 229) and the null options TypeError. Both are deferred Task 6 items that the ledger assigns to the final review.

---

## Assessment

Task quality: Needs fixes. The DM window check treats comment and mention events as inbound messages, which is a named safety rule that is latent only until the webhook is enabled, and a successful write can be reported as failed when the success-path audit throws, which invites a duplicate send. Both fixes are small and targeted; the rest of the task (gate order, caps, write safety, ownership, routes, redaction, and ledger traceability) is sound.

Spec verdict: ❌ (I-1; the 24-hour window rule is not met as written).
