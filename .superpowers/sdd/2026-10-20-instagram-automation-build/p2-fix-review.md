# P2 fix round focused re-review (p2-head to p2-fix-head)

Round verdict: FINDINGS REMAINING. New findings: Critical 0, Important 1 (P2F-I1), Minor 4 (P2F-M1 to P2F-M4).

## Scope and method

- Read in order: p2-review.md; progress.md lines 397-425 (O-4 to O-13, P2 entries, controller rulings of 2026-10-22); task-13-report.md section "P2 fix round (2026-10-22)" (lines 672-877); review-p2-fix.diff.
- Checked against the full files under `snap/p2-fix-head/` (the diff has 10 lines of context). Line numbers below are of those files.
- Not run: the test suite (per the brief), git (not a repository). No project file was edited. Test line numbers were checked with grep, not by running the tests.
- The P1 pin rows in the report (section 3, lines 779-797) were checked against the list in p2-review.md P2-M8, not against review-p2.diff.

## In-scope items

| Item | Verdict | Evidence (snap/p2-fix-head) | Notes |
|---|---|---|---|
| P2-I1 publish validation before counts | ADDRESSED | `src/service.js:1013` (`checkPublish` runs before `runOutbound` at 1014); `src/graph/endpoints/media.js:145-173` (`checkPublish`, same checks as `publishImage` 175-182, `publishReel` 184-199, `publishCarousel` 221-245, `publishStory` 247-255); `service.js:552-589` (stop, preflight 573, caps.check 581, caps.record 589 all after the validation) | Test `test/service.test.js:1542` asserts no request, no `caps.publish`, no `caps.outbound`. Residual: P2F-M3. |
| P2-I2 lookups are reads | ADDRESSED | `service.js:646-663` (`lookup`: `guard.assertNotStopped()` at 647 first); `caps.js:14` (`READ_ACTIONS`); `caps.js:232-241` (`verdictOf` skips spacing and daily total for reads); `caps.js:266-268` (`record` writes only the action's own bucket); `service.js:873-881` (mentionedMedia), `934-960` (hashtagSearch), `964-977` (businessDiscovery) use `lookup` | Tests `test/caps.test.js:427`, `:441`; `test/service.test.js:1571`, `:1595`. The README classification is wrong in one place: P2F-I1. |
| P2-M1 count after the client exists | ADDRESSED | `service.js:650` (`client(product)`) before `caps.check` (654) and `caps.record` (656) | Test `test/service.test.js:1610`. |
| P2-M2 one retry after a pre-send failure | ADDRESSED (scope note N1; P2F-M3) | `service.js:136-148` (`unknownOutcome` names only the failed request; `retryLeft` text); `service.js:487-503` (`releasePrivateReply`, `releaseReplied`: failures count, `released: failures === 1`); `service.js:508-518` (`reservePrivateReply` keeps `preSendFailures`); `service.js:595-608` (`runOutbound`: count released once, reservation released once, `retryLeft` from the release); `service.js:724-727` (`handleInbound`: `RETRY_USED_UP` on a second failure); `service.js:1124-1132` (preflight refuses a reservation with two failures) | Tests `test/service.test.js:1627` (private reply), `:1651` (auto-reply). |
| P2-M3 body cap test | ADDRESSED | `test/graph-client.test.js:513` asserts `state.pulled === 6` with `bigStream(20)` (line ~504). The cap is unchanged (`src/graph/client.js:23`, `240-243`). | The old assertion was vacuous with six chunks; the new one discriminates. |
| P2-M4 stale test name | ADDRESSED | `test/endpoints-media.test.js:464` renamed to "...refuses an empty body" | |
| P2-M5 stricter caps in the report | ADDRESSED (P2F-M2) | `README.md:116-134` table. Values checked: `src/oauth.js:45` (FACEBOOK_BODY_LIMIT 4096), `:50` (RESPONSE_LIMIT 65536), `:51` (PAGE_LIST_LIMIT 262144); `src/http.js:20` (1048576); `service.js:47` (OWNED_LIMIT 100), `:48` (COMMENT_PAGE 25), `:50` (DM_PAGE 20), `:51` (CONVERSATION_LIMIT 100); `src/graph/endpoints/comments.js` (max 100) | The table is complete for the rows it lists, but its claim to list "every cap" is false: P2F-M2. |
| P2-M6 unreadable expiry | ADDRESSED | `service.js:665-681` (`expiryOrNull`, `ageOrNull`); `service.js:783-787` (`tokenStatus` uses both); `canRefresh` is false for an unreadable time, so the hourly check does not refresh | Test `test/service.test.js:1673`. |
| P2-M7 refresh not retried | ADDRESSED | `src/graph/client.js:284-287` (`get(path, query, options)`, `retryable: options?.noRetry !== true`); `client.js:170-172` (`retryWait` returns null when not retryable); `src/token.js:97` (`{ noRetry: true }`); `service.js:820` (one call, one caller); `cli.js:813-816` (`runTokenCheck` calls refresh once) | Tests `test/graph-client.test.js:544` (one request on 503, no backoff), `:552` (GET without noRetry still retried), `test/token.test.js:375` (one request on 503). |
| P2-M8 P1 pins listed | ADDRESSED | `task-13-report.md:779-797` lists the P1 pins in `test/oauth.test.js` and `test/cli.test.js`: callback method GET, approval POST headers, approval object, the mismatched-state rule (I-1), `receiveToken` return value, `record.scopes` and `scopesRequested`, OWNER_MISMATCH via runServe, `fakeSecrets.source` | Each row matches the list in p2-review.md P2-M8. The ledger pointer is in progress.md:423. |

## Checks (a) to (h)

- (a) Lookups: PASS. A stop of any kind refuses a lookup first. `guard.js:151-152` loads a persisted stop at construction, and `guard.js:200-209` refuses on any held stop. Each lookup spends only its own bucket: `caps.js:232` skips the outbound spacing and daily total for `business_discovery`, `mentioned_media` and `hashtag`, and `caps.js:266-268` writes only the own bucket. `caps.check` applies the own-bucket rules at `caps.js:242-247`. Note N2 (release also names the outbound list).
- (b) A refused lookup makes no request and records nothing: PASS. The stop is refused at `service.js:647`, before `client()` at 650 and before `caps.record` at 656. A bucket refusal returns busy at 654-655, before the record. `clientFor` (`cli.js:628-634`) only reads the secret and builds a client; it sends no request. Test `service.test.js:1571` asserts zero requests and no `caps.*` keys.
- (c) Publish validation: PASS. `checkPublish` (`service.js:1013`) runs before `runOutbound` (1014), so before the confirm gate, the early caps check, the preflight quota read and `caps.record`. A validation failure spends zero counts (test `service.test.js:1542`).
- (d) One-retry rule: PASS for the reservation actions. The count is released once (`service.js:597`) and the reservation is released once (`service.js:600-606`). The attempt count is stored in state with the reservation (`service.js:487-494`, `508-518`, `289-310`), so it survives a restart. A second pre-send failure keeps `released: false` (`service.js:491`, `500-501`). A timeout never releases: `client.js:41-44` and `:218` give `preSend: false` for a timeout and for any code outside `ECONNREFUSED`, `ENOTFOUND` and `EAI_AGAIN`, and `service.js:600` releases only on `isPreSend`. A failed release is fail-closed: `state.js:153-161` restores memory to the last saved image, so the reservation stays `released: false` in process as well as on disk. Scope note N1 and finding P2F-M3.
- (e) Refresh non-retryable: PASS. `client.js:286` sets `retryable: false` for the refresh. `client.js:170-172` returns no wait, so `send` throws after one request. Network failures are never retried anywhere in `send` (`fetchResponse` at 214-219 throws directly). The one caller (`service.js:820`) and the one hourly caller (`cli.js:813-816`) each make one call.
- (f) Pins: PASS. I checked each changed hunk in review-p2-fix.diff against report section 3 (lines 801-815). Old and new values are in the report for every changed test: `service.test.js` (hashtag advance removed, two O-4 loops, the four O-5 assertions, the A-10 `bigStream` pin, the `failClient` helper), `endpoints-media.test.js` (rename), `graph-client.test.js` (`bigStream(20)` and the exact count). The other changes in this round are new tests only. None weakens an assertion: the O-5 `released`/`preSendFailures` checks are stronger than the old `undefined`/`ok` checks, and the A-10 check is now an equality.
- (g) No new retry of a write, no write sent twice: PASS. `client.js:299` (POST retries only with `retryPost`) and `client.js:303` (DELETE never) are unchanged, and no endpoint passes `retryPost: true`. The reservation retry is a new call or a redelivered event, handled once per delivery (`service.js:709-734`). A publish is still one `media_publish` per successful container chain (`media.js:121-124`).
- (h) Publish containers limit: ADDRESSED in the report, NOT in the README. The limit is in task-13-report.md section 6 (line 872), but that line points to "the concerns", and section 9 "Concerns" (line 146) does not list it. progress.md:423 says it is "recorded in the README", which is not true. See P2F-M1.

## Findings

### P2F-I1 (Important): README states the reverse of the P2-I2 ruling and of the one-retry rule

- Where: `README.md:376` says "Hashtag search ... It counts toward the spacing, the 200-a-day total and the hashtag cap." `README.md:377` says "A reservation (such as a private reply) is written before the request is sent. If the send then fails, the reservation blocks a retry."
- Contradicts: `README.md:106`, `:114` and the code (`caps.js:232`, `:266-268`) for the first; `README.md:112`, `service.js:491`, `:500-501` and `:724-727` for the second.
- Effect: the owner-facing description of the caps in the same file is wrong on two points. A reader would think a hashtag search uses the outbound spacing and the 200-a-day total, and that a failed private reply stays blocked.
- Fix: rewrite both lines to the ruled behaviour. Line 376: the search checks the stop, counts toward its own weekly bucket only, and does not use the outbound spacing or total. Line 377: a pre-send failure releases the reservation once, and a second pre-send failure keeps it.

### P2F-M1 (Minor, check h): the publish-container limit is not in the README, and the report pointer is wrong

- Where: `task-13-report.md:872` says "This is a known limit, listed in the concerns." Section 9 (`task-13-report.md:146`) does not list it. `progress.md:423` says "recorded in the README"; `README.md` has no such text (no hit for "container" or "unpublished").
- Effect: the report does record the limit (section 6, Choices), so check (h) is met. The README and the ledger say otherwise.
- Fix: add the limit to the README under the publishing rows (near `README.md:109-111`) or in "Writes and retries". Correct the report pointer to section 6 itself, and correct the progress.md note.

### P2F-M2 (Minor, P2-M5 fix): the stricter-caps table claims to be complete, and it is not

- Where: `README.md:118` says "The table lists every cap in the service that is stricter than the spec, or that the spec does not have." The table at `README.md:120-134` omits:
  - `src/service.js:52` `REPLIED_LIMIT = 500`: answered events are remembered only for the last 500 (`service.js:309`). This bounds the once-per-event guarantee.
  - `src/graph/endpoints/media.js:11-12` and `:138-139`: the publish container wait is 60 polls at 5000 ms, then an error.
  - `src/graph/client.js:7` and `:216`: a 15-second request timeout.
  - `src/graph/client.js:11` and `:170-178`: up to three GET retries with 1, 2 and 4 second backoff.
  - `src/oauth.js:53` `LOGIN_TIMEOUT_MS = 300000`: a 5-minute login wait.
- The spec (`docs/superpowers/specs/2026-10-20-instagram-cli-design.md`) has none of these (a grep for timeout, retry and poll finds none).
- Fix: add these rows to the table, or narrow the sentence to the size, page and count limits.

### P2F-M3 (Minor, checks d and g): a publish that fails pre-send after an earlier request reached Graph releases its counts

- Where: `service.js:595-608` releases the publish and outbound counts through the generic `releaseOnPreSend` (`service.js:459-466`) on any pre-send failure. `media.js:175-245` shows that an earlier POST has already reached Graph in a multi-request publish (a container, or carousel children). `README.md:112` says such a failure "is not an action, so its count is released."
- Contradicts: the ruling O-5 (`progress.md:403`), which allows a release only for "a failure proven to happen before any request reached Graph". For a publish, earlier requests did reach Graph.
- Effect: the 200-a-day and 10-a-day publish counts under-count the containers created. No duplicate publication results: `media_publish` runs only after a finished container, and an unpublished container is never published. The report discloses the orphaned containers (`task-13-report.md:872`) but not the count release.
- Fix: keep the outbound count once any request of a publish has been sent (for example, a flag set at the first `client.post` in `publishContainer`'s callers, read in `runOutbound`). Or change README:112 and the O-5 record to say so, and have the owner accept it.

### P2F-M4 (Minor, report accuracy): the new-test count per file is wrong

- Where: `task-13-report.md:819` says "`test/service.test.js` (8)". The list at lines 820-826 has seven bullets, and the diff has seven new service tests (`service.test.js:1542`, `:1571`, `:1595`, `:1610`, `:1627`, `:1651`, `:1673`).
- The total of 12 is correct: 7 + 2 (caps) + 2 (graph-client) + 1 (token).
- Fix: change "(8)" to "(7)".

## Notes (not counted as findings)

- N1 (scope of the one-retry rule): the one-retry rule is implemented for the two reservation actions only (private reply and auto-reply). An owner DM, a publish or a like can be sent again after a pre-send failure without limit, each as a new call (`task-13-report.md:871`, disclosed). This matches the wording of O-5 (`progress.md:403`: "the private reply or auto-reply"), but not the general wording in the brief ("a second pre-send failure blocks"). The owner should confirm the scope.
- N2: `caps.release` for a read also rewrites `caps.outbound` (`caps.js:290-291`). The rewrite is a no-op for a read, so it is harmless.
- N3: `ig_hashtag_search` is classed as a read for caps (`caps.js:14`), but its MCP annotation is `readOnlyHint: false` (`README.md:213`, `:233`). This is terminology; the owner may want the two aligned.
- N4: lookups still skip the usage hold (`service.js:646-663`), as before. `caps.js:325` documents that reads are not gated. This is consistent with the ruling and is not a change in this round.
- N5: `config.js:117-128` requires `owner.igUserId` to be digits at load, so the owner-id checks inside the endpoints cannot fail after a count is spent.
- N6: the live checks from p2-review.md remain open (P2-N1: X-App-Usage on `/me`; the publish container behaviour under a pre-send failure).
- N7: the report's claims of 862/862 and "no warning line" were not re-verified, since the suite was not re-run.
