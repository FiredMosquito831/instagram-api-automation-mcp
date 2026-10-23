# P2 focused review (p1-head to p2-head)

Round verdict: FINDINGS REMAINING. New findings this round: Critical 0, Important 2, Minor 8.

## Scope and method

- Read in order: progress.md lines 397-421 (owner decisions O-4, O-5, O-6, O-11 and the P2 entries); global-constraints.md; task-13-report.md section 14 (lines 447-670); review-p2.diff (all 4769 lines).
- The diff has 10 lines of context, so each claim was checked in the full files under `snap/p2-head/`. Line numbers below refer to those files.
- Not run: the test suite (per the brief), git (not a repository). No project file was edited.
- Diff content outside P2: the P1 fix round (bin/ig.js, src/cli.js serve lock, runAuthLogin, runAuthFacebook, runServe, the bridge and callback in src/oauth.js, and the P1 test pins in test/oauth.test.js and test/cli.test.js). These were read only where they touch P2 (cappedFetch and PAGE_LIST_LIMIT in cli.js, runServe in the poller test).

## Item verdicts

| Item | Verdict | Evidence (snap/p2-head) | Notes |
|---|---|---|---|
| O-4 daily buckets, 50 each | ADDRESSED | config.js:32-33 (DEFAULT_CAPS); caps.js:67-68 (REQUIRED_CAPS), 132-137 (rules); service.js:789-801 (mentionedMedia: check 791, record 793); service.js:881-899 (businessDiscovery: check 889, record 891); caps.js:253-273 (record, verdict before the save) | The refused call returns busy before record (service.js:790-792, 890). Findings P2-I2 and P2-M1. |
| O-5 preSend release | ADDRESSED | client.js:23-48 (constants, codesOf, isPreSend, markResponseError); client.js:214-220 (fetchResponse sets preSend); client.js:273 (response errors marked false); service.js:129-131 (isPreSend); service.js:442-449 (releaseOnPreSend); service.js:570-578 (release only when isPreSend); service.js:618 and 1058 (reservation release) | A timeout keeps the reservation: tests "O-5 a private reply that times out keeps its reservation" and "O-5 an auto-reply that times out keeps its mark". Finding P2-M2 (wording and multi-request). |
| O-6 refresh pause and expiry | ADDRESSED | service.js:458-466 (refreshPause, PAUSE_KINDS at 59); service.js:716-722 (pause before any request; the only refreshToken call is service.js:737); service.js:683-712 (tokenStatus: daysLeft, warning, refreshPaused); service.js:664 (status refreshPaused); token.js:73-81 (expiryStatus, warning under 7 days) | Finding P2-M6. |
| O-11 usage read for a like on media | ADDRESSED | service.js:453-456 (ensureUsageReading, one readCall); service.js:998 and 1013 (preflight only when kind is media); service.js:546-549 (a preflight failure throws before any count); profile.js:7-8 (GET me, so no write); service.js:997 and 1012 (comment target keeps ownerCheck only) | Live check P2-N1. |
| A-10 body cap 5 MB | ADDRESSED | client.js:23 (MAX_BODY_BYTES); client.js:228-255 (readBody: declared length at 230, streamed count at 237-244, text fallback at 248-249); client.js:222-224 (bodyTooLarge, preSend false) | readBody runs before classify, so the retry path is never reached for a write. service.js:135-148 keeps the unknown-outcome wording. Finding P2-M3 (test). |
| A-13 null options | ADDRESSED | common.js:47-54 (optionsOf); every option-taking endpoint uses it (comments 7, discovery 2, insights 2, likes 2, media 9, messaging 6; token.js 5); profile.js:7 (profileGet takes none); service.js:150-166 (wrapArguments), service.js:653 (return wrapArguments) | Service argument check is in wrapArguments; onInbound is excluded by design. |
| A-14 empty DELETE | ADDRESSED | media.js:235 (mediaDelete calls responseConfirmed); test "A-14 a DELETE with an empty 2xx body is API_ERROR..." (endpoints-media.test.js) | Finding P2-M4 (stale test name). |
| A-17 missingFields | ADDRESSED | discovery.js:25-31 (missingFields; no throw) | Test endpoints-social "A-17 businessDiscovery lists each requested field the response lacks". |
| A-18 dots-only ids | ADDRESSED | client.js:28 (DOTS_ONLY), client.js:205 (buildUrl refuses); messaging.js:32-35 (checkRef), messaging.js:53-56 (refId); common.js:56-58 (isDotsOnly) | checkId (common.js:9-14) already refused dot ids because it is digits-only. |
| A-35 enums | ADDRESSED | tools.js:118 (metrics items), 121 (PERIOD), 122 (DECISION), 333 (publish kind), 377 and 387 (like and unlike kind); service.js:57 (EVENT_DECISIONS), 914 (eventsDecide check), 928 (publish kind check), 990 and 1005 (like and unlike kind check); events.js:21 (ACTIONS equals EVENT_DECISIONS); insights endpoint checks PERIODS | Test "A-35 the registry enums match the values the service accepts" (tools.test.js). |

## Checks (a) to (h)

- (a) No write is retried: PASS. The only loop in send() is the existing backoff (client.js:257-279). retryable is true only for GET (client.js:283), for POST only when options.retryPost === true (client.js:296), and never for DELETE (client.js:300). No endpoint passes retryPost: true (grep of src). One pre-existing exception to note: refreshToken is a GET and is retried on 429 and 5xx (client.js:8-11, 170-177). See P2-M7.
- (b) preSend only where provable: PASS. preSend is true only when every Node error code in the failure is ECONNREFUSED, ENOTFOUND or EAI_AGAIN (client.js:26, 33-41). A timeout (DOMException, numeric code) is false. A reset is false. A body read error is false (client.js:253). A response error is false (client.js:273). The service requires API_ERROR and preSend === true (service.js:129-131).
- (c) Refresh pause cannot be bypassed: PASS. refreshToken is called only at service.js:737, after the pause check at service.js:718. runTokenCheck (cli.js:813), the HTTP route and MCP reach it only through service.tokenRefresh (tools.js:169).
- (d) Like usage read is not a write: PASS. profileGet is GET me (profile.js:7-8), called through readCall. It records no count and sends no write.
- (e) 5 MB cap cannot be bypassed by chunking: PASS for Graph responses. The streamed body is counted by actual bytes (client.js:237-244) and the declared length is checked too (client.js:230). oauth.js readCapped (oauth.js:326-355) does the same. A Response with no stream is read whole before the check (client.js:248-249), but only test doubles have no stream. cli.js:551 and mcp.js:91 read local HTTP responses without a cap. They are not Graph bodies, so A-10 does not apply; see the notes.
- (f) Caps not spent on a refused call: FAIL in part. The lookups and the official actions record after their checks (service.js:563 after the gate; service.js:791-793 and 889-891). Two refusals still spend counts. A publish refused by endpoint validation spends its counts (P2-I1). A lookup refused when the client cannot be built spends its count (P2-M1). The report's claim in 14.5 ("A busy or refused call still records nothing") is not accurate for these.
- (g) Changed pins are intended and not weakened: PASS, with P2-M3, P2-M4 and P2-M8. Table below.
- (h) cli.test.js poller control: PASS. The change is legitimate; the report row 5 gives the old and new assertions accurately. Details below.

### Pins changed for P2 (report 14.2)

| Test | Old | New | Judgement |
|---|---|---|---|
| config.test.js, EXPECTED_CAPS (report line 19) | no businessDiscovery or mentionedMedia keys | both perDay 50 | Intended (O-4). |
| endpoints-media.test.js:464, "mediaDelete sends DELETE ... reports the deletion" | second call with empty body returns deleted: true | second call rejects API_ERROR | Intended (A-14). The name is stale (P2-M4). |
| endpoints-social.test.js:273, businessDiscovery | deepEqual(result, profile) | deepEqual(result, {...profile, missingFields: []}) | Intended (A-17). |
| service.test.js:442, businessDiscovery untrusted | no missingFields | missingFields: [] added | Intended (A-17). |
| cli.test.js:766-800, poller control (I-1) | first like returns busy "no app usage reading yet"; calls 1 after the poll | first like rejects API_ERROR from its own profile read (calls 1); poll makes calls 2; the held like returns busy "usage reached 80 percent" with calls still 2 | Intended (O-11). The first like now makes a read, so the old control no longer applies. The claim that the poller reading reaches the gate is still asserted by the final busy result. The report's old and new values match the diff. |

### Pins changed by the P1 fix round, in the same diff, not in the P2 report

See P2-M8.

## Findings

### P2-I1 (Important, pre-existing and in scope of check (f)): a publish refused by validation spends its counts

- Where: service.js:563 (caps.record) comes before service.js:566 (perform). publishMedia checks only the kind and that url is a string (service.js:927-933). The URL, caption, carousel and polling checks run inside perform: publishImage calls checkUrl and checkCaption (media.js:145-149); publishCarousel calls checkChild (media.js:172) after the record.
- Effect: a VALIDATION thrown from perform is not pre-send, so releaseOnPreSend does nothing (service.js:571). unknownOutcome returns it unchanged (service.js:135-137). The publish count and the outbound count stay spent. The quota read in the preflight also still runs first. This is the reverse of the Task 4 ruling in check (f).
- Provenance: publishing is not changed by P2, so this is pre-existing. It is raised here because check (f) covers it and the P2 report says refused calls record nothing (14.5).
- Fix: validate publish arguments in publishMedia before the preflight and before runOutbound, with the same rules as checkUrl, checkCaption, checkChild and checkPolling. Add a test: publishMedia with a bad url and confirm true makes no request and leaves caps.publish and caps.outbound at zero.

### P2-I2 (Important): counted lookups skip the stop check that hashtagSearch has

- Where: businessDiscovery (service.js:881-899) and mentionedMedia (service.js:789-801) have no guard.assertNotStopped(). hashtagSearch has one (service.js:859), and its comment (service.js:852) says a counted search "obeys the stop".
- Effect: all three go through caps.record, which writes the outbound bucket for every action (caps.js:259-262). So the lookups count toward the 2000 ms spacing and the 200 per day total. readCall (service.js:595-602) does not check the stop, and it observes only CHECKPOINT, ACTION_BLOCKED and RATE_LIMITED. So a lookup sends a Graph request while CHECKPOINT, ACTION_BLOCKED, RATE_LIMITED or AUTH_EXPIRED stands. The report (14.5) says the lookups count "as the hashtag search does". That is true of the count and not of the stop.
- The two requirements pull apart. Global constraint line 10 says a stop holds outbound actions. O-3 says reads work during a damaged-state stop. The owner must decide whether a lookup is a read (then it should not spend the outbound count) or an outbound action (then it needs the stop check). The current code matches neither.
- Also: the lookups are not held by the usage throttle. hashtagSearch is not either, so that part is pre-existing.
- Fix: decide the classification. If outbound, add guard.assertNotStopped() to both methods. If a read, stop counting them toward outbound and say so in the report.

### P2-M1 (Minor, check (f)): lookup counts are spent before the client exists

- Where: service.js:891-893 and 793-795 record the count; the client is built inside readCall (service.js:597). clientFor throws CONFIG "owner_token is not set" (cli.js:632) when the token is missing. The count is kept, because CONFIG is not pre-send.
- Effect: every such call spends one of the 50 daily lookups without sending a request.
- Fix: obtain the client before caps.record, as runOutbound does (service.js:533).

### P2-M2 (Minor, O-5 wording): the pre-send release is per request, not per action

- Where: service.js:135-148 (the message "did not reach Instagram ... can be sent again"), service.js:570-578 (the release).
- Effect: publish is the only multi-request write. Earlier requests (the container POST, or carousel children) can reach Graph before a later one fails pre-send. The message and the release then describe the whole action inaccurately. Checked: no duplicate publish is possible, because media_publish is the only step that publishes and a pre-send failure there means it never reached Graph. Unpublished containers can be left behind.
- O-5 says "ALLOW one retry". The code allows any number of repeated attempts, each one refused pre-send and released. The owner should decide whether this is one retry, and whether the message should name only the failing request.
- Fix (if one retry is wanted): keep a per-id attempt count in the reservation or in state.

### P2-M3 (Minor, test quality, check (g)): the "rest of the body is not read" assertion is vacuous

- Where: graph-client.test.js:503-511, with bigStream(6) (line 487). The stream has six 1 MB chunks, so `state.pulled <= 6` holds whether or not reading stops at the cap. The cap itself is checked by the first assertion.
- Fix: use bigStream(20) and keep `state.pulled <= 6`. Without the cancel, all 20 chunks would be read, so the assertion would then discriminate.

### P2-M4 (Minor, test name, check (g)): a stale test name

- Where: endpoints-media.test.js:464, "mediaDelete sends DELETE to the media id and reports the deletion". The second call now asserts a rejection for an empty body (A-14).
- Fix: rename it to say that an empty body is refused.

### P2-M5 (Minor, undocumented limits): stricter caps not in the report

- Where: oauth.js:50-51. RESPONSE_LIMIT is 64 KB for the token exchanges and PAGE_LIST_LIMIT is 256 KB for the Page list (cli.js uses cappedFetch with PAGE_LIST_LIMIT). The owner decision and report 14.1 give only the 5 MB cap.
- Effect: a token-exchange or Page-list response between these sizes and 5 MB is refused. Those responses are small, so this is probably acceptable.
- Fix: document both limits in the report, or state the rule.

### P2-M6 (Minor): ig_token_status throws on an unreadable expiry

- Where: service.js:701 calls expiryStatus on record.expiresAt. tokenRecord (service.js:295-307) checks only that expiresAt is a string. An unreadable time makes expiryStatus throw VALIDATION (token.js:73-75). Before P2, canRefresh returned false for an unreadable time (token.js, parseTime null).
- Fix: catch the error in tokenStatus and report daysLeft null, warning "the expiry time cannot be read", and refreshPaused as now.

### P2-M7 (Minor, pre-existing, check (a)): refresh is a GET and is retried

- Where: token.js refreshToken calls client.get('refresh_access_token'). GET is retryable (client.js:283), and retryWait retries 429, 500, 502, 503 and 504 on RATE_LIMITED or API_ERROR (client.js:8-11, 170-177).
- Effect: a refresh rotates the owner token, so a retry after a 5xx repeats a token-issuing call. This is not a P2 change.
- Decision for the owner: whether refreshToken should be non-retryable, since the constraint says no write is retried.

### P2-M8 (Minor, check (g)): P1 pins changed in this diff are not listed in any report I read

- test/oauth.test.js: the callback tests now pass method GET (the callback answers 405 to other methods, a P1 rule); "a POST with a mismatched state is refused with AUTH_EXPIRED" is now a 400 that keeps waiting (the P1 reversal of ruling 4); "the approval receiver rejects with AUTH_EXPIRED when the state does not match" now keeps waiting; the facebook receiver result is an object.
- test/cli.test.js: the record.scopes assertion (M-8) is now []; the startServe OWNER_MISMATCH test moved to runServe (P1 M-6); fakeSecrets.source returns 'keyring' instead of 'env' (M-3); facebook receiveToken mocks return { token, expiresInSeconds }.
- Each change looks intended by the P1 rulings. None is in task-13-report.md section 14.2 or in the progress.md P1 entries (lines 414-418). Add them to the ledger so the pin record is complete.

## Notes (not counted as findings)

- P2-N1 (live check): O-11 relies on the /me read returning X-App-Usage. If Graph does not send it, every media like stays busy. That fails closed, but it should be confirmed in the live phase.
- cli.js:551 and mcp.js:91 read local HTTP responses with no size cap. They are not Graph bodies, so A-10 does not apply.
- The report's claims of 850/850 and "no warning line" were not re-verified, since the suite was not re-run.
- The lookups count toward the outbound spacing and total (report 14.5). O-4 does not ask for that. It is disclosed, but it is a behaviour change for the owner to accept.

## Round verdict

FINDINGS REMAINING. New findings: Critical 0, Important 2 (P2-I1, P2-I2), Minor 8 (P2-M1 to P2-M8).
