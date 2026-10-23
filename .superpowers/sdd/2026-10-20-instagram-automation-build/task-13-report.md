# Task 13 report: service core

Status: DONE_WITH_CONCERNS. The service and its 48 tests are in place, and the full suite passes (525 of 525). The concerns are listed in section 9.

Files changed: `src/service.js` (new), `test/service.test.js` (new). Nothing else was touched. `package.json`, `package-lock.json` and the test script are unchanged. No package was installed, and there is no commit (R2, R3, R9).

## 1. TDD evidence

### RED

The tests were written first, against a stub `src/service.js` whose `createService` throws `service is not implemented`. Each test therefore failed at its first call, so this RED shows that the tests run and fail, not which assertions they make.

```
$ node --test --test-reporter=tap test/service.test.js
# tests 47
# pass 0
# fail 47
```

### GREEN, in order

| Run | Result | What changed before the run |
|---|---|---|
| 1 | 32 pass, 15 fail | First implementation. See the note on run 1 below. |
| 2 | 42 pass, 5 fail | Test fixes: usage priming, hashtag spacing, the busy-like assertion. |
| 3 | 47 pass, 0 fail | Fixture fixes: non-digit ids (reply, container, publish), fake answer keys without the `GET ` prefix, and the `GET me` answer in the (k) setup. |
| 4 | 48 pass, 0 fail | One test added: ruling (d) for comment hide and delete, which had no test. |

Final full suite, `npm test` (exit 0):

```
ℹ tests 525
ℹ pass 525
ℹ fail 0
```

That is the 477 existing tests plus 48 new ones.

Note on run 1. Every failure in runs 1 and 2 was looked at before anything was changed. Three causes were found:

- **Implementation change (one).** Unofficial actions were held on the Graph usage reading, although the usage header comes from Graph responses only. The hold now applies to official actions only (section 3, item 6). This was a decision made because a test failed, and it is flagged for review.
- **Test errors (the rest).** The official send tests did not prime a usage reading, which the code correctly requires. A hashtag search counts toward outbound spacing (caps design), so two searches need a 2-second gap. The busy-like test asserted "no request at all", but the owner read happens before the caps check, so the test now asserts "no write". Fixtures used non-digit ids (`responseId` correctly requires digits), and fake answer keys lacked the `GET ` prefix.

### Mutation checks

Eleven mutations were applied in a scratch copy of the project (`D:/tmp/claude/mut`), one at a time. Each was caught by at least one test, and the project file was verified unchanged afterwards.

| Mutation | Tests failing |
|---|---|
| M1 `caps.record` moved after `perform` | 2 |
| M2 no redelivery dedupe | 1 |
| M3 owner's own events not skipped | 1 |
| M4 window not checked on `dmSend` | 1 |
| M5 no per-comment private-reply check | 1 |
| M6 usage hold skipped | 3 |
| M7 stop not observed on a perform error | 3 |
| M8 confirm gate removed | 1 |
| M9 owner check removed from comment reply | 3 |
| M10 hashtag API_ERROR read as no-match | 1 |
| M11 unofficial route check removed | 1 |

## 2. Ruling coverage

| Ruling | Test that covers it |
|---|---|
| (a) runOutbound: `caps.record` before `perform` | `(a) caps.record runs after the checks and before perform` |
| (a) a count that cannot be saved stops the request | `(a) a count that cannot be saved stops the request` |
| (a) unreadable usage header held before the usage gate | `(a) an unreadable usage header holds outbound calls before the usage gate runs` |
| (b) latest usage object stored, never a copy; gate gets `usage.app` | `(b) the usage gate receives the stored app reading, the same object the last response gave` |
| (b) no reading yet refuses; a read supplies one | `(b) outbound is refused while no usage reading has arrived, and a read supplies one` |
| (c) API_ERROR on a write is unknown, never retried | `(c) an API_ERROR on a write is reported as unknown and is not retried` |
| (d) reply, hide, delete check the parent media; unknown parent refused | `comment reply is refused when the parent media is not the owner's` (brief); `(d) comment hide and delete check the parent media too` |
| (d) like and unlike check the comment's parent or the media | `(d) a like on a comment checks the parent media of the comment`; `(d) a like or unlike on a media checks that the media is the owner's` |
| (d) first-page limits reported with a reason | `(d) commentsList refuses another media, and reports when only the first page is read` |
| (e) hashtag API_ERROR is an error, not a no-match | `(e) a hashtag lookup that fails is an error, not a no-match` |
| (f) comment, message and mention text marked untrusted | `(f) comments, messages and mentions are marked untrusted`; `eventsPending marks event text untrusted` (brief) |
| (g) `dmSend` 24-hour check before perform | `dmSend refused when the window is closed, with no request made` (brief) |
| (g) private reply 7-day check and one per comment, recorded under `private_replies` | `private reply is allowed once per comment and only within 7 days` (brief) |
| (h) `dmMessages` takes the first conversation for the recipient; no match is empty | `(h) dmMessages looks up the conversation by recipient and takes the first id`; `(h) dmMessages with no conversation for the recipient gives an empty list, not an error` |
| (i) auto-reply skips owner events and empty text; audit has sender and time, not text | `(i) auto-reply skips the owner's own events and events with empty text, and audits the skip without the text`; `(i) the audit line for a skipped inbound event carries the sender and the time, never the text` |
| (i) one auto-reply per sender per 24 hours, through caps | `(i) auto-reply answers one sender at most once per 24 hours, and other senders are not limited by it` |
| (i) auto-reply only when enabled and a rule matches | `auto-reply sends only when enabled and a rule matches` (brief) |
| (j) redelivered event answered once | `(j) a repeated inbound event is answered once, even after the sender limit has cleared` |
| (k) audit carries no message text and no raw Graph text | `(k) audit lines carry no message text and no raw Graph text`; `(k) a stop detail carries codes, not the raw Graph text` |
| (l) publish refused at quota; quota read since 24 hours ago | `(l) publishMedia is refused with CAP_EXCEEDED when the quota is used up` |
| (m) like uses `routes.likes.loginProduct`; mediaDelete needs a Facebook token | `(m) like uses the client named by routes.likes.loginProduct`; `mediaDelete is refused with ROUTE_DISABLED when no Facebook token exists` (brief) |
| (n) read AUTH_EXPIRED is clean and changes no stop | `read tool returns AUTH_EXPIRED cleanly and does not set the stop state` (brief); `(n) a read that gets AUTH_EXPIRED is a clean IgError and changes no stop state` |
| (o) stop saved at once; stop set only in the error step | `(o) a stop from a write is saved at once`; `(o) an AUTH_EXPIRED seen while checking ownership also stops outbound actions` |

Brief tests, all present: outbound without confirm previews; busy records nothing; `dmSend` window; error 190 then STOPPED; read AUTH_EXPIRED; comment reply owner check; private reply; eventsDecide sends nothing; eventsPending untrusted; mediaDelete ROUTE_DISABLED; personal refuses official; unofficial follow gated; auto-reply; caps block the 11th like.

Additional coverage: dmSend 1000-byte limit (exactly 1000 accepted, 1001 refused before any count); stopClear preview and clear; autoReplySet preview and flag; event log pass-through; tokenStatus and tokenRefresh; onInbound never rejects; bad ids and unknown kinds refused before any request; auto-reply rule validation at startup; status.

## 3. Places where a ruling or the brief was followed, and where I amended something

1. **Order of the owner check (brief amended).** The brief puts the owner check at step (3), before the confirm gate. The global constraints say a preview makes no request, and the owner check is a Graph read. So the owner check and the preflight (quota, window, private-reply age) run after the gate, and only for confirmed actions.
2. **`caps.record` before `perform`** (ruling a). The order is: stop, route, client (no request), gate, owner check and preflight (reads), caps check, usage hold, `caps.record`, `perform`. The caps check, usage hold and record run with no `await` between them, so two concurrent calls cannot both pass the spacing check.
3. **Usage hold** (ruling a, Task 5 ruling 1, Task 1 fail-closed rule). An unreadable marker, or no app reading at all, refuses the call with busy and `retryAfterMs` of 60000. Only then is `usageGate.check` called, with `usage.app`.
4. **Stop detail carries codes** (brief amended). The brief says `guard.stop(error.kind, error.message)`. The guard's own comment says callers pass codes, not response text, so the detail is `HTTP x, code y, subcode z`.
5. **Stops from the owner check and the preflight** (amendment). An AUTH_EXPIRED or other stop error seen while checking ownership also sets the stop, since an error 190 is an account condition, not a per-call one.
6. **Unofficial actions skip the usage hold** (judgement, see section 1). The usage header comes from Graph responses only.
7. **mediaDelete counts under the `outbound` caps action.** `caps.js` has no bucket for it, and its action list is fixed.
8. **Hashtag searches count toward outbound spacing**, because `caps.record` writes every action to the outbound list (caps design).
9. **`getClient(loginProduct, { onUsage })`** (R6). The optional second argument is the usage callback. Task 17 must pass it to `createGraphClient`.
10. **Private reply age.** No endpoint returns a comment's time by its id. The age comes from `commentsList` on the parent media, with a limit of 100. A comment outside that page is refused with WINDOW_CLOSED (fail closed).
11. **Likes and unlikes on a media** check that the media is the owner's (ruling d applied to likes, which the brief did not name). The spec's accepted-risk text mentions likes on named targets, so this narrows the feature. Flagged for the owner.
12. **Official features** include `hashtagSearch` and `businessDiscovery` (personal accounts refused). Reads of the owner's own media (`mediaGet`, `insightsMedia`, `commentsList`) check ownership, which is the Task 6 carry-forward. `mentionedMedia` does not, because the media is another account's by definition.

## 4. Interfaces the service defines for other tasks

- **Token record**, state key `token`: `{ obtainedAt, expiresAt, scopes }`, ISO times with milliseconds and a Z. Task 17's login must write it. `tokenRefresh` writes `owner_token` through `secrets.set` and updates the record with an expiry 60 days out.
- **Auto-reply rules**, config `autoReply.rules`: `[{ keyword, reply }]`. The keyword is matched case-insensitively, first rule wins, and the reply is at most 1000 bytes. The spec does not define the shape, so this is my definition. Checked at startup.
- **State keys written:** `autoReply.enabled` (overrides config when set by `autoReplySet`), `autoReply.replied` (the last 500 event ids answered), `private_replies` (comment id to time).
- **Publish carousel input:** `urls` is a list of `{ imageUrl }` or `{ videoUrl }` objects, the endpoint's shape. Task 14's schema must match.
- **Result shapes:** `commentsList` returns `{ comments, truncated, reason }`; `dmConversations` returns `{ conversations, truncated }`; `dmMessages` returns `{ messages }`; `eventsPending` returns `{ events, nextCursor }`, each event with `untrusted: true`.

## 5. Known gaps in the tests

Not tested directly: `businessDiscovery` (its route check is the same code path as `mediaDelete`), `unfollow`, `profileEdit`, `mediaList` and insight pass-through, the `tokenRefresh` age refusal, and the createService argument checks other than the rule size. These paths are small and follow the same patterns as the tested ones.

## 6. Self-review

I read the diff of `src/service.js` after the final run. What I checked:

- **Fail closed:** unknown feature, missing usage reading, unreadable usage, a malformed token or private-reply record, a malformed rule and a non-boolean confirm are all refusals, not passes.
- **Nothing is queued:** every busy result is returned to the caller, and none is stored.
- **No secret or text in the audit:** audit entries carry the feature name, the target id, the outcome, and a kind or code. A skipped inbound event carries the sender and the time. Refusals and busy results are not audited (they do nothing), and errors are audited by kind and code only.
- **Stop state:** set only through `observe`, which is called only in `runOutbound`'s error paths. Reads never set it.
- **No timers, no network** in the service or in the tests. The tests use a fake clock, a fake Graph client, fake state, events, audit, secrets and unofficial registry. The real `caps`, `usageGate` and `guard` run over the fake state.
- **Concurrency:** the last `await` before the caps check, the usage hold and `caps.record` is the owner check or preflight, so the check and the record are one synchronous step.

I found no further defects in the self-review. The mutation checks in section 1 cover the rulings that carry the most risk.

## 7. Cross-task carry-forwards

- **Task 17 (serve and wiring):** every Graph client must come from the service's `getClient`, so that `onUsage` is passed. The poller's client must also use it. Otherwise the poller's responses never reach the usage store, and outbound calls stay refused until a service read provides a reading.
- **Task 17 (login):** write the token record (section 4). Serve checks the stop state before it starts the poller (Task 11 carry-forward).
- **Task 14:** the carousel input shape and the result shapes in section 4.
- **Task 18 (README):** known limits: the comment age is read from the first 100 comments; a usage reading must come from an app header (a business-only response holds outbound calls); the auto-reply rule shape; the likes restriction (section 3, item 11); the mediaDelete caps bucket; and the Node 22 run (Node 24.6.0 is what this machine has).

## 8. Files

- `D:\Projects2\InstagramApi\src\service.js` (new, 874 lines)
- `D:\Projects2\InstagramApi\test\service.test.js` (new, 48 tests)

## 9. Concerns

1. **Private-reply age** comes from a 100-comment page, not from the comment itself. A comment outside that page is refused. The ideal signature is `commentTimestamp(client, { commentId })` in `src/graph/endpoints/comments.js` (a Task 7 module), which I did not change.
2. **Cross-task wiring:** the poller and every client must share the service's usage store (section 7). Without it, outbound calls are refused as having no reading.
3. **Owner decisions:** likes and unlikes on a media are limited to the owner's media (item 11); the auto-reply rule shape and the token record are my definitions (section 4).
4. **Brief amendments** (items 1, 4, 5, 6): the order of the owner check, the stop detail, the stops from the owner check, and the unofficial usage hold. Each is a judgement that a reviewer may reverse.
5. **Node 22.12** (the engines floor) was not run. The suite ran on Node 24.6.0 only.

## 10. Fix round 1 (coordinator's message)

Result: DONE. `npm test` is green: 529 pass, 0 fail. The changes are below, with the file and line of each. The earlier sections stay as they were, except where this section says a point is superseded.

### 10.1 Superseded earlier text

- Section 2, the (d) row "a like or unlike on a media checks that the media is the owner's", and the (d) row "like and unlike check the comment's parent or the media": superseded. A media like or unlike has no owner check now.
- Section 3, item 10 (private-reply age from the first 100 comments): superseded. The age now comes from the comment's own timestamp.
- Section 3, item 11 (likes on a media limited to the owner's media): reverted, per the spec (line 49).
- Section 7, the Task 18 bullet on the 100-comment page: superseded.
- Section 9, concerns 1 and 3: superseded for the likes restriction and the 100-comment page. Concern 1's endpoint request is done, as described below.

### 10.2 Changes

Item 1, likes. The owner's rule is spec line 49: "Likes and follows on named targets: yes, one at a time, within caps. Comments on other people's posts: no."

| File | Line(s) after this round | Change |
|---|---|---|
| `src/service.js` | 750-751 | Comment above `like`: states the new rule (a comment target checks the parent media; a media target goes to any named target within the caps). |
| `src/service.js` | 761 (like) and 775 (unlike) | `ownerCheck` runs only for a comment target. Old: `ownerCheck: () => (kind === 'comment' ? ownedParentOf(targetId) : requireOwnedMedia(targetId)),`. New: `ownerCheck: kind === 'comment' ? () => ownedParentOf(targetId) : null,`. |

Item 2, private-reply age.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/graph/endpoints/comments.js` | 72-84 | New `commentTimestamp(client, { commentId })`. It runs `checkId`, then `client.get(commentId, { fields: 'timestamp' })`, then `responseObject`. A timestamp that is not text, or is blank, throws `API_ERROR`. It returns the text. |
| `src/service.js` | 16 | Import `commentTimestamp`. |
| `src/service.js` | 47 (removed) | `COMMENT_READ_LIMIT = 100` removed. |
| `src/service.js` | 346-355 | Old: `commentCreatedAt`, which read the first 100 comments of the parent media with `commentsList`. Removed. New: `commentTimeOf(igc, commentId)`, which calls `commentTimestamp`. A stop error is rethrown, so it sets the stop. Any other failure refuses with `WINDOW_CLOSED`. |
| `src/service.js` | 805-818 | `privateReply` preflight: the duplicate check, then `ownedParentOf` (the comment must be on the owner's media), then `commentTimeOf` for the comment's own time, then `privateReplyOpen`. A missing or unreadable time refuses with `WINDOW_CLOSED` before any send. A time that `privateReplyOpen` cannot read also refuses. |

Test file changes (`test/service.test.js`, `test/endpoints-social.test.js`).

| File | Line(s) | Change |
|---|---|---|
| `test/service.test.js` | 238-245 | `likeAnswers` gains `'GET me': { id: OWNER }`. The fixture is a usage source, not an assertion. |
| `test/service.test.js` | 270, 304, 477, 502, 510, 789, 824, 843 | `await prime(t);` after the setup of eight tests. A like with no earlier Graph read is now refused as "no app usage reading yet". Before this round the owner-media read was the incidental source of that reading. The assertions in those eight tests are unchanged. |
| `test/service.test.js` | 827 | (m) like loginProduct test. Old: `assert.equal(t.graph.requests.find((request) => request.path === 'me/media').product, 'instagram');`. New: `assert.equal(t.graph.requests.find((request) => request.path === 'me').product, 'instagram');`. The `me/media` read went with the owner check, and the owner read that `prime` makes is the one that shows the Instagram client. |
| `test/service.test.js` | 344-366 | The private-reply test keeps its name. Old: the comment's time came from `GET {media}/comments`; 8 days refused; then `t.graph.answers[...]` set to 2 days, allowed. New: the time comes from `GET {comment}` with `fields=timestamp` through the `commentTime` variable; 8 days refused; then `commentTime = graphTime(NOW - 6 * DAY)` (line 363), allowed once; a second reply refused with `CAP_EXCEEDED`. |
| `test/service.test.js` | 375-405 | New: "private reply refuses a comment whose timestamp fetch throws, has no timestamp, or is a stop". A fetch that throws, and a fetch with no timestamp, are both refused with `WINDOW_CLOSED` before any send. An error 190 on the fetch sets the stop and is passed on as `AUTH_EXPIRED`. |
| `test/service.test.js` | 592-621 | Old: "(d) a like or unlike on a media checks that the media is the owner's", with `like` and `unlike` on `OTHER_MEDIA` each expected to reject with `OWNER_MISMATCH`, and zero non-GET requests. New: "(d) a like or unlike on a media that is not the owner's goes through, within caps and the confirm gate". The preview returns `{ preview: true, action: 'like', target: OTHER_MEDIA }` with no request. A confirmed like returns `{ targetId, kind: 'media', liked: true }`, sends `media_id` = `OTHER_MEDIA`, and makes no `me/media` read. An unlike straight after is busy (spacing). After a 2-second advance it returns `{ liked: false }`. |
| `test/endpoints-social.test.js` | 3-11 | Import `commentTimestamp`. |
| `test/endpoints-social.test.js` | 160-182 | New: "commentTimestamp reads the timestamp field of the comment and returns it as text" (request shape: GET, path, `fields: 'timestamp'`, returned text); "commentTimestamp throws API_ERROR for a missing, blank or non-text timestamp" (three cases, each `API_ERROR`); "commentTimestamp refuses a bad comment id before any request" (`VALIDATION`, zero calls). |

### 10.3 Covering tests

| Requirement | Test |
|---|---|
| A like on a media that is not the owner's goes through, within caps and the confirm gate | (d) a like or unlike on a media that is not the owner's goes through, within caps and the confirm gate |
| A like on a comment still checks the parent media | (d) a like on a comment checks the parent media of the comment (unchanged) |
| Comment hide and delete still check the parent media | (d) comment hide and delete check the parent media too (unchanged) |
| The timestamp request shape, the text return, and the missing or blank field | endpoints-social: commentTimestamp reads the timestamp field...; commentTimestamp throws API_ERROR for a missing, blank or non-text timestamp |
| A comment 8 days old is refused | private reply is allowed once per comment and only within 7 days |
| A comment whose timestamp fetch throws is refused | private reply refuses a comment whose timestamp fetch throws, has no timestamp, or is a stop |
| A comment 6 days old is allowed once, and a second reply is refused | private reply is allowed once per comment and only within 7 days |

### 10.4 Consequence to note

A like or unlike on a media no longer makes an ownership read, so it no longer supplies its own usage reading. Such a call is now refused as "no app usage reading yet" until an earlier Graph response in this process has supplied one. This is the fail-closed rule, and nothing else changed. In practice the owner's first like after startup needs one read first, such as `ig_profile_get`, or the poller's first tick, once Task 17 wires the poller's client through the service. Flagged for the README (Task 18) and for the owner.

### 10.5 npm test output

```
ℹ tests 529
ℹ pass 529
ℹ fail 0
exit 0
```

Targeted runs, for the two changed files: `test/service.test.js` 49/49 pass, and `test/endpoints-social.test.js` 33/33 pass. The earlier count was 525; the four new tests are one service test and three endpoint tests.

### 10.6 Mutation checks for this round

Run in a scratch copy, one at a time:

- The owner-media check put back on a media like: 1 test fails (the rewritten (d) test).
- The 7-day check skipped in privateReply: 1 test fails (the umbrella private-reply test).

The project's `src/service.js` was verified identical to its pre-mutation state afterwards.

## 11. Fix round 2 (task reviewer's findings, and the coordinator's list)

Result: DONE. `npm test` is green: 544 pass, 0 fail. The review is `task-13-review.md`. This round fixes the items below. Everything else stays as it was. The deferred items (M-2, M-3, M-5, M-6, M-9, M-12, M-14, M-15, M-17, M-18) are not touched.

### 11.1 Changes

Item 1, I-1: the DM window counts only inbound messages.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/events.js` | 355-367 | `lastInboundAt(senderId, { kind } = {})`. With a kind, only events of that kind count. The kind is validated (`VALIDATION` for an unknown kind). With no kind, the function is unchanged: the newest event of any kind. Old: `function lastInboundAt(senderId) {`, which counted every kind. |
| `src/service.js` | 308-314 | `requireOpenWindow` passes `{ kind: 'message' }`. Old: `const open = messageWindowOpen({ lastInboundAt: events.lastInboundAt(senderId), now: clock() });`. New: `const lastInboundAt = events.lastInboundAt(senderId, { kind: 'message' });` then the same `messageWindowOpen` call. `dmSend`'s preflight calls `requireOpenWindow`, so one change covers `dmSend` and the auto-reply. |

Item 2, I-2: a successful write is not reported as a failure when its audit line fails.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/service.js` | 432-434 | The success path calls `safeAudit`, as the error path does, and then returns the result. Old: `audit.record({ action: feature, target, route, outcome: 'ok', detail: null });`. New: `safeAudit({ action: feature, target, route, outcome: 'ok', detail: null });`, with a comment. |

Item 3, M-1: a stop set during the owner or quota reads stops the action before anything is counted.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/service.js` | 411-414 | `guard.assertNotStopped()` after the owner and preflight awaits and before `caps.check`. Placement: the last await-free point before the count. `caps.check`, the usage hold and `caps.record` run in one synchronous block, so the stop cannot change between this check and `perform`. Placing it after `caps.record` would count a refused action, which is why it sits before the count. |

Item 4, M-4: a private reply counts toward the owner DM limit.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/caps.js` | 43-44 | `private_reply` maps to `'owner_dm'`, not `null`. Old: `private_reply: null,`. New: `private_reply: 'owner_dm',`, with a comment. |

Item 5, M-7: a read that gets CHECKPOINT, ACTION_BLOCKED or RATE_LIMITED sets the persisted stop. A read that gets AUTH_EXPIRED does not.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/service.js` | 438-441 | Comment and `READ_STOP_KINDS = new Set(['CHECKPOINT', 'ACTION_BLOCKED', 'RATE_LIMITED'])`. |
| `src/service.js` | 443-452 | `readCall`: on an error whose kind is in `READ_STOP_KINDS`, `observe(err)` is called (so `guard.stop` runs and saves), then the error is rethrown as before. AUTH_EXPIRED is not in the set, so it sets nothing, as the brief pins. Old: the catch only called `throw readError(err);`. |

Item 6, M-8: `tokenRefresh` with a stop error sets the stop.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/service.js` | 561-563 | The catch around `refreshToken` calls `observe(readError(err))` and rethrows. Old: `throw readError(err);`. The exception is deliberate. A refresh changes the token, so a 190 on it sets the stop, as a write does. Other reads do not. |

Item 7, M-10: `dmMarkRead` checks the sender id before any write.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/service.js` | 657-658 | `checkGraphId(senderId, 'senderId');` before `events.markRead(senderId)`. Old: no check there. |

Item 8, M-11: `dmMessages` reports truncation.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/service.js` | 49 | New constant `const DM_PAGE = 20;`, the endpoint's own maximum and default, beside `COMMENT_PAGE`. |
| `src/service.js` | 638-651 | `dmMessages` comment updated. The page size is `limit ?? DM_PAGE`. The result carries `truncated` (a full page: `messages.length >= pageSize`) and `reason` (`'first page only'` when truncated, else `null`). An empty lookup returns `{ messages: [], truncated: false, reason: null }`. Old: `return { messages: [] };` on no match, and `return { messages: messages.map(untrusted) };`. |

Item 9, M-16: test only. The usage throttle at 80 or more is tested at service level (see 11.3).

Test helper, not an assertion: the fake events in `test/service.test.js` (lines 60-82) model the real log. Old: `lastInboundAt(senderId) { calls.push(['lastInboundAt', senderId]); return events.inbound[senderId] ?? null; }`. New: `lastInboundAt(senderId, opts = {})` records `opts`, returns the message time for `kind: 'message'`, and otherwise the newer of the message time and the `otherInbound` time, as the real log does. The new `otherInbound` option holds the times of comments and mentions.

### 11.2 Assertions changed

| Test | File and line | Old | New | Why |
|---|---|---|---|---|
| (h) dmMessages looks up the conversation by recipient and takes the first id | `test/service.test.js` line 717 | `assert.deepEqual(result, { messages: [] });` | `assert.deepEqual(result, { messages: [], truncated: false, reason: null });` | The result shape gains the truncation fields (item 8). |
| (h) dmMessages with no conversation for the recipient gives an empty list, not an error | `test/service.test.js` line 724 | `assert.deepEqual(await t.service.dmMessages({ recipientId: OTHER }), { messages: [] });` | `assert.deepEqual(await t.service.dmMessages({ recipientId: OTHER }), { messages: [], truncated: false, reason: null });` | Same shape change. |

No existing caps test pinned `private_reply` to `null`. I searched `test/caps.test.js` and every other test file for `private_reply`, `private` and `owner_dm`. The nearest test, "owner DMs are capped at 50 per day, and publishing at 10 per day" (line 150), does not involve private replies, so there was no old assertion to show. The new caps test is in 11.3.

### 11.3 Covering tests

| Item | Test (file) | Assertion |
|---|---|---|
| I-1 | I-1 the DM window counts only the last inbound message: a comment an hour old does not open it (`test/service.test.js` line 961) | A message 25 hours old and a comment 1 hour old: `dmSend` rejects with `WINDOW_CLOSED`; zero requests; `lastInboundAt` called with `{ kind: 'message' }`. |
| I-1 | lastInboundAt with a kind counts only events of that kind (`test/events.test.js` line 188) | With a message at 10:00 and a comment at 11:00: no kind gives 11:00; `kind: 'message'` gives 10:00; `kind: 'comment'` gives 11:00; `kind: 'mention'` gives null; an unknown kind is `VALIDATION`. |
| I-2 | I-2 an audit that throws on a successful write gives one request, one count, and the result (`test/service.test.js` line 974) | With `audit.record` throwing: `like` returns `{ targetId, kind, liked: true }`; one POST; one `caps.likes` entry; one `caps.outbound` entry. |
| M-1 | M-1 a stop set during the owner read stops the action before anything is counted or written (`test/service.test.js` line 987) | A stop set during the `GET comment` owner read: `commentReply` rejects with `STOPPED`; zero POSTs; no `caps.outbound`. |
| M-4 | a private reply counts toward the owner DM limit of 50 per day (`test/caps.test.js` line 160) | 49 owner DMs then a private reply: `usage().owner_dm.day.used` is 50; the next owner DM and the next private reply are refused. |
| M-4 | M-4 a private reply counts toward the owner DM limit (`test/service.test.js` line 1003) | With the owner DM limit at 1: after one `dmSend`, a `privateReply` is busy with "owner DMs per day", one POST only, and no `private_replies` record. |
| M-7 | M-7 a read that returns AUTH_EXPIRED sets no stop (`test/service.test.js` line 1024) | `profileGet` rejects with `AUTH_EXPIRED`; no stop; no `stop` key in state. |
| M-7 | M-7 a read that returns CHECKPOINT sets the stop, and the next outbound is refused (`test/service.test.js` line 1031) | The stop is `CHECKPOINT` and saved; the next `dmSend` rejects with `STOPPED`; zero POSTs. |
| M-7 | M-7 a read that returns ACTION_BLOCKED sets the stop (`test/service.test.js` line 1043) | The stop is `ACTION_BLOCKED` and saved. |
| M-7 | M-7 a read that returns RATE_LIMITED sets the stop (`test/service.test.js` line 1050) | The stop is `RATE_LIMITED` and saved. |
| M-8 | M-8 tokenRefresh with an error 190 sets the stop, and rethrows (`test/service.test.js` line 1057) | `tokenRefresh` rejects with `AUTH_EXPIRED`; the stop is `AUTH_EXPIRED`; no token stored. |
| M-10 | M-10 dmMarkRead refuses an invalid senderId before any write (`test/service.test.js` line 1069) | `'not-digits'` and `'  '` both reject with `VALIDATION`; no `markRead` call. |
| M-11 | M-11 a full page of 20 messages is returned with truncated true and the reason first page only (`test/service.test.js` line 1076) | 20 messages: `truncated` true; reason `'first page only'`. |
| M-11 | M-11 a page of fewer than 20 messages is not truncated (`test/service.test.js` line 1097) | 3 messages: `truncated` false; reason null. |
| M-16 | M-16 a usage reading at 80 on the app bucket holds an outbound call busy for 60000 ms (`test/service.test.js` line 1112) | A usage reading of 80 on the app bucket: `dmSend` busy, `retryAfterMs` 60000, reason "reached 80 percent"; after 30 s, `retryAfterMs` 30000; after 60 s, the send goes through. This is characterization of the existing gate, as the coordinator asked, and it passes on the pre-round code too. |

### 11.4 Red and green

RED, against the pre-round code: the new and changed tests were run against `snap/task-13-head` (the code at the start of this round, which the review confirms). The result was `# tests 117 / # pass 102 / # fail 15`. The 15 failures are exactly the tests that test a behaviour this round changes: I-1 (service and events), I-2, M-1, M-4 (service and caps), M-7 CHECKPOINT, ACTION_BLOCKED and RATE_LIMITED, M-8, M-10, M-11 (two), and the (h) dmMessages assertions (two, changed shape). The M-16 and M-7 AUTH_EXPIRED tests pass on the old code, as they are characterization tests of behaviour the coordinator asked me to pin.

GREEN, against this round's code: `node --test test/service.test.js test/caps.test.js test/events.test.js` gives `# tests 117 / # pass 117 / # fail 0`.

Full suite, `npm test` (exit 0):

```
ℹ tests 544
ℹ pass 544
ℹ fail 0
exit 0
```

That is the 529 from round 1, plus 15 new tests: 13 in `test/service.test.js`, one in `test/caps.test.js`, and one in `test/events.test.js`.

### 11.5 Mutation checks for this round

Run in a scratch copy, one at a time:

- The stop re-check (item 3) removed: 1 test fails (M-1).
- The success audit unguarded (item 2) restored: 1 test fails (I-2).
- The CHECKPOINT observation on reads (item 5) removed: 3 tests fail (the three M-7 stop tests).

The project's `src/service.js` was verified identical to the edited file afterwards.

### 11.6 Choices to note

- M-1 placement is before `caps.check`, not literally before `perform`. Reason in 11.1, item 3.
- I-2: the success audit is now best effort. If the audit line fails, the owner gets no notice. This follows the review, and it is flagged in the concerns.
- M-7 applies to every read, so a CHECKPOINT, ACTION_BLOCKED or RATE_LIMITED from any read (including the reads the poller and the outbound ownership checks make) now stops outbound actions until `ig_stop_clear`. The coordinator's ruling is the basis.
- M-8 is the one place a refresh observes AUTH_EXPIRED. A refresh changes the token, so it is treated as a write. Reads other than the refresh keep the brief's rule.
- M-4: private replies now use the owner DM cap of 50 per day. This follows the ruling, and it assumes that "owner-sent DMs" in the spec covers them. The owner should confirm.
- `lastInboundAt` still counts every kind when no kind is given, because `test/events.test.js` pins that default. Only the DM window uses the `message` kind, so any new caller that needs the window must pass the kind.
- M-10 requires a numeric sender id, as `checkId` does everywhere else. Instagram-scoped user ids are numeric, so this should hold, and it is refused loudly if not.

## 12. Fix round 3 (focused re-review, `task-13-rereview-2.md`: N-1 and N-2)

Result: DONE. `npm test` is green: 544 pass, 0 fail. Two findings are addressed, and nothing else changed.

Note on N-2. The coordinator's N-2 is the wording of the truncation reason, which is done below. The re-review's N-2 is a different finding: truncation is inferred from the page length, and `conversationMessages` ignores `paging.next` (its line 622 is the same pattern for `commentsList`). That finding is still open. The coordinator scoped this round to wording, so I did not change the paging. It is listed in the concerns.

### 12.1 Changes

Item 1, N-1: a failed audit write is no longer silent. It emits one warning that carries the error name only.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/service.js` | 96-100 | New helper `errorName(err)`: the error's name, reduced to letters, digits and underscores (at most 64 characters), or `'error'` when there is no usable name. No message text can reach a warning through it. |
| `src/service.js` | 262-270 | `safeAudit`. The comment is updated: a failed write never changes the outcome, and it is not silent. The catch is no longer empty. Old: `} catch { // The audit line is best effort on an error path, so the original error is the one the caller sees. }`. New: `} catch (err) { process.emitWarning(\`audit line not written (\${errorName(err)})\`); }`. |

Effect on the paths. The success path (line 434 after round 2, now `safeAudit`) still returns the result when the audit write fails. The error path and the inbound skips use the same helper, so they also warn, and their outcome is unchanged. `onInbound` never rejects, as before.

Item 2, N-2 (wording only): the truncation reason.

| File | Line(s) after this round | Change |
|---|---|---|
| `src/service.js` | 657-658 | Old: `return { messages: messages.map(untrusted), truncated, reason: truncated ? 'first page only' : null };`. New: `const reason = \`may be truncated: a full page of \${pageSize} messages, the first page only\`;` then `return { messages: messages.map(untrusted), truncated, reason: truncated ? reason : null };`. With the default page size of 20, the text is exactly the wording the coordinator gave. `pageSize` is used rather than a literal 20, so the number matches the page that was read when a caller passes a smaller `limit`. The `truncated` flag is unchanged. |

### 12.2 Assertions changed

| Test | File and line | Old | New |
|---|---|---|---|
| I-2 (name) | `test/service.test.js` line 974 | `I-2 an audit that throws on a successful write gives one request, one count, and the result` | `I-2 an audit that throws on a successful write gives one request, one count, the result, and one warning` |
| I-2 (audit that throws) | line 977-979 (new text at 977-998) | `t.audit.record = () => { throw new Error('disk full'); };` | A local `AuditDiskFullError` (name `AuditDiskFullError`), thrown with a message that holds the target id and a token-like string. The warning listener is added and removed in a `finally`. |
| I-2 (new assertions) | lines 999-1000 | none | `assert.equal(warnings.length, 1, 'exactly one warning');` and `assert.equal(warnings[0].message, 'audit line not written (AuditDiskFullError)');`. The warning text is checked for exact equality, so it carries no message, target, token or path. |
| I-2 (unchanged) | lines 990-993 | `deepEqual(liked, ...)`, one POST, one `caps.likes` entry, one `caps.outbound` entry | Unchanged. |
| M-11 full page (name) | `test/service.test.js` line 1095 | `M-11 a full page of 20 messages is returned with truncated true and the reason first page only` | `M-11 a full page of 20 messages is returned with truncated true and a reason that says the page may be partial` |
| M-11 full page (reason) | line 1113 | `assert.equal(page.reason, 'first page only');` | `assert.equal(page.reason, 'may be truncated: a full page of 20 messages, the first page only');` |

### 12.3 Covering tests

| Requirement | Test (file and line) | Assertion |
|---|---|---|
| N-1: one request, one count, the result returned | I-2 (`test/service.test.js` line 974) | One POST; one `caps.likes` entry; one `caps.outbound` entry; `like` returns `{ targetId, kind, liked: true }`. |
| N-1: exactly one warning, carrying the error name and nothing else from the audit line | I-2 (line 974) | `warnings.length` is 1; the warning text is exactly `audit line not written (AuditDiskFullError)`. The text holds neither the target id nor the token-like string. |
| N-2: the reason text | M-11 full page (`test/service.test.js` line 1095) | `reason` is `may be truncated: a full page of 20 messages, the first page only`; `truncated` is still true. |

### 12.4 Red and green

RED, with the fix removed (a scratch copy in `D:/tmp/claude/mut4`): the silent catch restored, and separately the old reason text restored.

- Silent `safeAudit`: `# pass 61 / # fail 1`. The failure is `not ok 51 - I-2 an audit that throws on a successful write gives one request, one count, the result, and one warning`.
- Old reason text: `# pass 61 / # fail 1`. The failure is `not ok 60 - M-11 a full page of 20 messages is returned with truncated true and a reason that says the page may be partial`.

GREEN, with the fix in place: `node --test test/service.test.js` gives `# tests 62 / # pass 62 / # fail 0`. Its output shows the single `audit line not written (AuditDiskFullError)` warning, from the I-2 test.

Full suite, `npm test` (exit 0):

```
ℹ tests 544
ℹ pass 544
ℹ fail 0
exit 0
```

The count is unchanged from round 2. This round changed two tests and added none.

### 12.5 Choices to note

- The warning text is fixed and carries the error name only. The name is cut down to identifier characters, so even an unusual error name cannot carry message text.
- The warning is emitted through `process.emitWarning`, the same as the poller (`src/poller.js:316`). Node prints it to stderr unless warnings are disabled, so the owner sees it in the console.
- The test waits one tick (`process.nextTick`), since warnings are emitted on the next tick. It does not start a timer.

## 13. Note: the I-2 test no longer prints a warning (test-only change)

Test changed: "I-2 an audit that throws on a successful write gives one request, one count, the result, and one warning" (`test/service.test.js`, line 998, with the replaced stub at lines 1011-1030).

- Old: a `process.on('warning')` listener, a `process.nextTick` wait, and `process.removeListener` in `finally`. Node printed the warning to the test output as `audit line not written (AuditDiskFullError)`.
- New: a recording stub replaces `process.emitWarning` for the duration of the test, following the Task 15 pattern (`test/http.test.js`, lines 706-723). The original is restored in `finally`, and an assertion after the `finally` confirms the restore. The assertion that matters is unchanged in substance: `assert.deepEqual(warnings, ['audit line not written (AuditDiskFullError)'])`, which is exactly one warning with the exact text. The `nextTick` wait and the listener are gone, since the stub records synchronously.
- Behaviour under test: unchanged. `src/service.js` is not touched.

Result:

- `npm test` (exit 0): `ℹ tests 640 / ℹ pass 640 / ℹ fail 0`. Searching the output for a warning line finds only two test names that contain the word "warning". No `(node:` line and no Node warning line appears.
- `node --test test/service.test.js` on its own: `ℹ tests 64 / ℹ pass 64 / ℹ fail 0`, with zero bytes on stderr.

Two notes on the count:

- The suite is now 640 tests, not the 544 in the earlier sections. The other test files (for example `test/http.test.js` and `test/tools.test.js`) have been added to the project since, and they are not part of this task.
- The service file is 64 tests, not the 62 in section 12. Two tests were added to `test/service.test.js` by someone other than me, and I did not change them: "businessDiscovery returns the result marked untrusted, because it is another account's data" (line 434) and "eventsDecide returns the event marked untrusted, even when the event it gets back has no marker" (line 444). Both pass, and both test the `untrusted` marking that `src/service.js` applies at lines 695 and 713. They are listed here so the record is complete.

## 14. P2 (2026-10-22): service, caps, token, graph client, tool enums

Result: DONE. `npm test` is green: 850 pass, 0 fail (815 before this package, plus 35 new tests). No warning line appears in the output. The decisions followed are O-4, O-5, O-6 and O-11, and the accepted limits A-10, A-13, A-14, A-17, A-18 and A-35, as stated in `progress.md` under "OWNER DECISIONS MADE BY THE CONTROLLER (2026-10-22)".

Scope note. Some code in `src/service.js` predates this package and was not written in these rounds: the early refusal in `runOutbound` (`earlyUsageHold`), the usage holder injected into `createService` (`usageHolder`, with `record` and `reading`), the adapter resolved inside `perform`, and the stop check before the hashtag search. All of it is kept. These files are unchanged by this package: `src/http.js`, `src/poller.js`, `src/webhooks.js`, `src/state.js`, `src/events.js`, `src/guard.js`, `src/oauth.js`, `src/cli.js`, and the sidecar.

### 14.1 Changes, with file and line

Line numbers are those of the current files.

O-4, discovery daily buckets (50 per day each).

| File | Line(s) | Change |
|---|---|---|
| `src/config.js` | 32-33 | `DEFAULT_CAPS` gains `businessDiscovery: { perDay: 50 }` and `mentionedMedia: { perDay: 50 }`. The validation walks this shape, so the new keys are validated with the rest. The keys are camelCase, following the existing nested caps. The coordinator's `business_discovery_per_day` and `mentioned_media_per_day` map to these; the action names are `business_discovery` and `mentioned_media`. |
| `src/caps.js` | 27, 49 | `ACTION_NAMES` and `BUCKET_OF` gain `business_discovery` and `mentioned_media`. |
| `src/caps.js` | 67 | `REQUIRED_CAPS` gains `businessDiscovery.perDay` and `mentionedMedia.perDay`, each at least 0. |
| `src/caps.js` | 132-137 | `rulesFor` gains a day rule for each bucket. |
| `src/service.js` | 881-902 | `businessDiscovery` checks `username` and `fields` against the endpoint's patterns (exported from `discovery.js`, lines 8 and 11) before it counts. Then `caps.check` and `caps.record` run before the request, and a pre-send failure releases the count. |
| `src/service.js` | 789-803 | `mentionedMedia`: the same, with `caps.check('mentioned_media')` and `caps.record` before the request. |

O-5, retry after a provable pre-send failure.

| File | Line(s) | Change |
|---|---|---|
| `src/graph/client.js` | 23-28 | New constants: `MAX_BODY_BYTES` (5 MB, used by A-10), `PRE_SEND_CODES` (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`), and `DOTS_ONLY` (used by A-18). |
| `src/graph/client.js` | 33-53 | `codesOf` gathers the Node error codes of a failure: its own code, its cause, and its `errors` list (several addresses), to a depth of 3. `isPreSend` is true only when there is at least one code and every code is a pre-send code. `markResponseError` gives each response error `details.preSend: false`. |
| `src/graph/client.js` | 214-220 | `fetchResponse` gives a fetch failure `details.preSend = isPreSend(err)`. A timeout (a `TimeoutError` DOMException, with no string code) and a reset are not pre-send. |
| `src/graph/client.js` | 273 | `send` throws `markResponseError(outcome.error)`, so every error the client returns carries `details.preSend` as a boolean. |
| `src/service.js` | 128-132 | Module-level `isPreSend(err)`: an `IgError` of kind `API_ERROR` with `details.preSend === true`. |
| `src/service.js` | 135-148 | `unknownOutcome`: a pre-send failure is reported as "did not reach Instagram (the connection failed before the request was sent), so it can be sent again". Every other `API_ERROR` on a write keeps the unknown-outcome wording. |
| `src/service.js` | 442-450 | `releaseOnPreSend(err, token, action, args)` calls `caps.release(token, action, args)` when the failure is pre-send. A failed release is swallowed, so the count stays (fail closed). |
| `src/service.js` | 469-473 | `releasePrivateReply(commentId)`: removes the comment from `private_replies`. |
| `src/service.js` | 476-478 | `releaseReplied(eventId)`: removes the event from `autoReply.replied`. |
| `src/service.js` | 563-583 | `runOutbound`: the count token from `caps.record` is kept (line 563). A failure of `perform` releases the count for any pre-send failure (line 571), and the action's reservation when it has one (lines 572-578). Then the audit and the rethrow, as before. |
| `src/service.js` | 523 | `runOutbound` gains the option `preSendRelease`. |
| `src/service.js` | 618 | `autoReplyTo` passes `preSendRelease: () => releaseReplied(event.id)`. |
| `src/service.js` | 1058 | `privateReply` passes `preSendRelease: () => releasePrivateReply(commentId)`. |
| `src/caps.js` | 6, 259-273 | `record` gives each count a random id (`randomUUID`), stores it on its entries, and returns it. Before: `record` returned nothing. |
| `src/caps.js` | 279-292 | New `release(id, action, opts)`: removes exactly the entries that carry the id, from the outbound list and the action's bucket. A failed save throws CONFIG, and the count stays. |
| `src/caps.js` | 309 | `return { check, record, release, usage }`. |
| `src/service.js` | 863-869 | `hashtagSearch` keeps the id of its count and releases it on a pre-send failure. |

O-6, refresh pause, and the token expiry in status.

| File | Line(s) | Change |
|---|---|---|
| `src/service.js` | 59 | `PAUSE_KINDS = {CHECKPOINT, ACTION_BLOCKED}`. |
| `src/service.js` | 459-466 | `refreshPause()` returns the stop when it is CHECKPOINT or ACTION_BLOCKED; `pauseReason(stop)` gives the reason text. |
| `src/service.js` | 716-727 | `tokenRefresh` returns `{ paused: true, reason }` before any request when the refresh is paused, and audits the pause. Otherwise it refreshes as before. |
| `src/service.js` | 683-713 | `tokenStatus` gives `daysLeft`, `warning` (from `expiryStatus`), `refreshPaused` and `refreshPauseReason`. |
| `src/service.js` | 664 | `status()` gives `refreshPaused`. The key is not `tokenRefreshPaused`, because `redact()` masks any value under a key that contains "token", so that name showed as `[redacted]`. |
| `src/token.js` | 72-81 | `expiryStatus({ expiresAt, now })`: `daysLeft` is whole days, rounded down, and negative once expired. `warning` is set under 7 days, and says the token has expired at or below 0. |

O-11, the usage reading for a like on media.

| File | Line(s) | Change |
|---|---|---|
| `src/service.js` | 453-456 | `ensureUsageReading()`: if `usageHolder.reading()` has no app object, one `profileGet` read is made through `readCall`. A failure throws the read's error, so the like is refused with its kind. |
| `src/service.js` | 998, 1013 | `like` and `unlike` pass `preflight: kind === 'media' ? ensureUsageReading : null`. The preflight runs after the confirm gate and before the caps check, so a preview makes no request. A comment target is unchanged (`ownerCheck` only). |

A-10, a 5 MB cap on response bodies.

| File | Line(s) | Change |
|---|---|---|
| `src/graph/client.js` | 222-252 | `bodyTooLarge()`. `readBody` refuses a declared `content-length` over the cap before it reads anything. It then reads the stream in chunks and stops, cancelling the rest, as soon as the total passes the cap. A body with no stream is read as text and checked. Any failure to read is `API_ERROR`. |

A-13, null or non-object options.

| File | Line(s) | Change |
|---|---|---|
| `src/graph/endpoints/common.js` | 47-54 | New `optionsOf(value, name)`: `undefined` gives `{}`; `null`, a non-object and an array are VALIDATION. |
| `src/graph/endpoints/*.js` and `src/token.js` | all option-taking functions | Each takes `options` and reads its fields with `const { ... } = optionsOf(options, '<name>')`. That is 28 endpoint functions (comments 7, discovery 2, insights 2, likes 2, media 9, messaging 6), and five in `token.js` (`tokenAgeHours`, `canRefresh`, `refreshToken`, `scheduleTokenChecks`, `expiryStatus`). `profileGet` takes no options. |
| `src/service.js` | 150-164, 653 | `createService` returns `wrapArguments({...})`. `wrapArguments` rejects any argument that is not `undefined` or a plain object, with VALIDATION, before the method runs. `onInbound` is left as it is: its argument is an event, and it never rejects. |

A-14, an empty DELETE body.

| File | Line(s) | Change |
|---|---|---|
| `src/graph/endpoints/media.js` | 227-237 | `mediaDelete` calls `responseConfirmed(data, 'media deletion')`, the same rule as every other write. An empty 2xx body is API_ERROR, and `{ success: true }` is success. Before: an empty body was accepted. The import gains `responseConfirmed` (line 6). |

A-17, business discovery fields.

| File | Line(s) | Change |
|---|---|---|
| `src/graph/endpoints/discovery.js` | 25-31 | `businessDiscovery` returns the business object with `missingFields`: each requested field the response lacks. It does not throw. Before: the object was returned as it came. |

A-18, dots-only ids.

| File | Line(s) | Change |
|---|---|---|
| `src/graph/client.js` | 28, 205 | `buildUrl` refuses any path part made only of dots (`DOTS_ONLY`). Before: only `.` and `..` were refused, so `...` was sent. |
| `src/graph/endpoints/common.js` | 56-58 | `isDotsOnly(value)`. |
| `src/graph/endpoints/messaging.js` | 9, 33, 55 | `checkRef` (a request id) and `refId` (an id from a response) refuse an id made only of dots. A request id gives VALIDATION before any request; a response id gives API_ERROR. |

A-35, enums in the tool schemas.

| File | Line(s) | Change |
|---|---|---|
| `src/tools.js` | 8-10 | Imports: `INSIGHT_METRICS` and `PERIODS` from the insights endpoint; `EVENT_DECISIONS`, `LIKE_KINDS` and `PUBLISH_KINDS` from the service. |
| `src/tools.js` | 116-122 | `METRICS` gains `items: { type: 'string', enum: INSIGHT_METRICS }`. New `PERIOD` (enum `PERIODS`) and `DECISION` (enum `EVENT_DECISIONS`). |
| `src/tools.js` | 216, 321, 333, 377, 387 | `ig_insights_account` takes `period: PERIOD`; `ig_events_decide` takes `decision: DECISION`; `ig_publish_media` `kind`, and `ig_like` and `ig_unlike` `kind`, carry enums. |
| `src/service.js` | 54-59 | `PUBLISH_KINDS`, `LIKE_KINDS` and `EVENT_DECISIONS` are exported. `eventsDecide` refuses a decision outside `EVENT_DECISIONS` before the event log is asked (line 914). |
| `src/graph/endpoints/insights.js` | 39 | `PERIODS` is exported. |

Enums are in the schema, and the service enforces them. `validateArgs` checks types only and is unchanged, since the brief limits `tools.js` to enums.

### 14.2 Assertions changed in existing tests

Each of these pinned behaviour that P2 changes. The old and new values are shown.

| Test | File and line | Old | New |
|---|---|---|---|
| DEFAULT_CAPS is exactly the caps in the brief (and the tests that compare the same object) | `test/config.test.js` line 19 | `hashtags: { perWeek: 30, windowDays: 7 },` as the last entry of `EXPECTED_CAPS` | the same line, then `businessDiscovery: { perDay: 50 },` and `mentionedMedia: { perDay: 50 },` |
| mediaDelete sends DELETE to the media id and reports the deletion | `test/endpoints-media.test.js` lines 465-467 | the second call expected `{ id: MEDIA, deleted: true }` for an empty body | the second call rejects with `API_ERROR` (A-14), with a comment |
| businessDiscovery builds the business_discovery field expression | `test/endpoints-social.test.js` line 273 | `assert.deepEqual(result, profile);` | `assert.deepEqual(result, { ...profile, missingFields: [] });` (A-17) |
| businessDiscovery returns the result marked untrusted, because it is another account's data | `test/service.test.js` line 442 | `assert.deepEqual(found, { id: OTHER, username: 'other_shop', followers_count: 10, untrusted: true });` | the same, with `missingFields: []` added (A-17) |
| a poller reading reaches the usage gate before any tool call, and the next outbound call is busy (I-1) | `test/cli.test.js` lines 766-800 | Control: before the poller reads, `service.like(media)` resolves busy with "no app usage reading yet", and `calls.length` is 1 after the poll. The fake answers every request with the high usage header. | Control (O-11): the like's own profile read is the first request, so `service.like(media)` rejects with `API_ERROR` and `calls.length` is 1. The fake answers the first request without a usage header, so that read gives no reading. The poll then makes `calls.length` 2. The final assertion changes from `calls.length, 1` to `calls.length, 2` ("the held call made no request"). The test's claim, that the poller's reading reaches the gate, is unchanged. |

No existing caps test pinned the discovery buckets, since they are new. Other tests that build the service through the CLI or the HTTP layer still pass unchanged.

### 14.3 New tests

Each name is in the file given, and each one passes in the 850-test suite.

`test/graph-client.test.js` (6)
- O-5 a connection refused or a DNS failure is a pre-send failure, and a timeout or a reset is not
- O-5 every failure that comes back as a response is marked not pre-send
- A-10 a response body over 5 MB is an API_ERROR, and the rest of the body is not read
- A-10 a body whose declared length is over 5 MB is refused before any of it is read
- A-10 an over-size body on a write is an API_ERROR, and the write is not retried
- A-18 a path part made only of dots is refused locally with VALIDATION, and no request is made

`test/caps.test.js` (3)
- O-4 business discoveries and mentioned-media lookups each have a daily cap of 50
- O-5 release removes exactly the count that record returned, and no other
- O-5 releasing an auto-reply count frees its per-sender limit

`test/token.test.js` (2)
- O-6 expiryStatus gives the days left, and warns under 7 days or once the token has expired
- A-13 the token functions refuse a null argument with VALIDATION, not a TypeError

`test/endpoints-media.test.js` (2)
- A-14 a DELETE with an empty 2xx body is API_ERROR, and a DELETE with success true is a success
- A-13 the endpoints refuse a null options argument with VALIDATION, and make no request

`test/endpoints-social.test.js` (2)
- A-17 businessDiscovery lists each requested field the response lacks, and does not throw
- A-13 the social endpoints refuse a null options argument with VALIDATION, and make no request

`test/endpoints-messaging.test.js` (3)
- A-18 a conversation id made only of dots is refused locally with VALIDATION, and no request is made
- A-18 a message id from a response that is made only of dots is API_ERROR
- A-13 the messaging endpoints refuse a null options argument with VALIDATION, and make no request

`test/tools.test.js` (1)
- A-35 the registry enums match the values the service accepts

`test/service.test.js` (16)
- O-4 the 51st business discovery on the same day is refused with busy and makes no request
- O-4 the 51st mentioned-media lookup on the same day is refused with busy and makes no request
- O-5 a private reply that fails before any request reached Graph releases its reservation, and the next attempt goes through
- O-5 a private reply that times out keeps its reservation, and the second attempt is refused
- O-5 an auto-reply that fails before any request reached Graph releases its mark and its count, and the next attempt goes through
- O-5 an auto-reply that times out keeps its mark, and the second attempt is refused
- O-5 a direct message that fails before any request reached Graph releases its count
- O-6 a token refresh under CHECKPOINT makes no request and reports paused
- O-6 a token refresh under ACTION_BLOCKED is paused too
- O-6 a token refresh with no stop refreshes as before, and one under RATE_LIMITED is not paused
- O-6 the token status gives the days left, warns under 7 days, and shows a paused refresh
- O-11 a like on media with no usage reading makes one profile read first, then the like proceeds
- O-11 with a failing profile read, the like is refused with the read's kind and sends no like
- O-11 a like on a comment makes no profile read, and keeps its parent-media check
- A-13 a service method given null, or a non-object, refuses with VALIDATION and makes no request
- A-35 the service refuses a publish kind or an event decision outside its closed set, before any request

The existing test "(d) a like or unlike on a media that is not the owner's goes through, within caps and the confirm gate" (round 1) still passes, because it primes a reading first.

### 14.4 Red and green

RED, by reverse mutation: each requirement was reverted in a scratch copy, one at a time, and the test files that cover it were run. Every reverse mutation was caught.

| Reverse mutation | Failing tests |
|---|---|
| A-10 body cap removed | 2 |
| O-5 preSend flag always false | 1 |
| O-5 count release removed | 3 |
| O-5 reservation release removed (private reply) | 1 |
| O-5 reservation release removed (auto-reply) | 1 |
| O-6 pause removed | 3 |
| O-4 discovery bucket unmapped | 2 |
| O-11 usage read removed | 2 |
| A-13 argument wrapper removed | 1 |
| A-18 client dots-only check removed | 1 |
| A-14 empty DELETE accepted | 3 |
| A-35 decision enum not enforced | 1 |

GREEN: `npm test` (exit 0) gives:

```
ℹ tests 850
ℹ pass 850
ℹ fail 0
```

The 35 new tests are the 6 + 3 + 2 + 2 + 2 + 3 + 1 + 16 listed in 14.3. The count went from 815 to 850.

### 14.5 Choices to note

- A pre-send failure releases its count for any outbound action, not only for the two that hold a reservation. A request that never reached Graph was not an action. The reservations are released for private replies and auto-replies only, as the decision names. The discovery lookups and the hashtag search release their count too.
- A busy or refused call still records nothing, as before.
- A write that fails with a pre-send error is an API_ERROR, and the message says it can be sent again. A write that fails any other way is still an unknown outcome, and is not retried.
- The priming read for a like on media (O-11) is part of the like. A stop error from it (AUTH_EXPIRED included) sets the stop, as an ownership read does inside a write. The "reads never set the stop" rule still holds for reads made outside a write.
- Business discovery and mentioned-media lookups count toward the outbound spacing and the 200-per-day total, as the hashtag search does. The caps design says every action counts toward outbound.
- The status key is `refreshPaused`, not `tokenRefreshPaused`, because redact masks values under keys that contain "token".
- `missingFields` is added to the object the endpoint returns. The fields Graph returned are not changed, and the untrusted marker is still added in the service.
- The 5 MB cap is enforced on the stream as it is read, and on a declared `content-length`. A fake response with a body but no stream is checked after it is read as text.
- The enum is in the schema, and the service enforces it. `validateArgs` does not enforce `enum`, since the brief limits `tools.js` to enums.

### 14.6 Open live checks

- Meta's real pre-send codes. The classification uses the Node codes `ECONNREFUSED`, `ENOTFOUND` and `EAI_AGAIN`. A live run should confirm that a real refused connection is classified as pre-send.
- The real `Response` body stream against the 5 MB cap.
- The owner's first like after a start, when the priming read fails. The fail-closed behaviour is tested. The live phase should confirm the read's own response shape.

## P2 fix round (2026-10-22)

Result: DONE. `npm test` is green: 862 pass, 0 fail, and no Node warning line in the output. There are 12 new tests, and 862 = 850 + 12. The review is `p2-review.md`. Every finding below is addressed, and each one has a test. The points where I made a judgement are in section "Choices" at the end.

### 1. Changes, with file and line

Line numbers are those of the current files.

P2-I1, validation before the counts (publish).

| File | Line(s) | Change |
|---|---|---|
| `src/graph/endpoints/media.js` | 147-171 | New `checkPublish({ kind, url, urls, caption })`. It runs the checks each publish makes before any request: the URL (`checkUrl`), the caption (`checkCaption`), the carousel items (`checkChild` for each, and 2 to 10 of them), and the polling values (`checkPolling`). Each publish function still runs its own checks. |
| `src/service.js` | 23 | `checkPublish` is imported. |
| `src/service.js` | 1013 | `publishMedia` calls `checkPublish` before `runOutbound`, so a bad publish is refused before the quota read and before any count. |

P2-I2, the lookups are reads.

| File | Line(s) | Change |
|---|---|---|
| `src/caps.js` | 14 | New `READ_ACTIONS = {business_discovery, mentioned_media, hashtag}`. |
| `src/caps.js` | 232-240 | `verdictOf`: the outbound spacing and the outbound daily total are checked only for an action that is not a read. A read keeps its own bucket. |
| `src/caps.js` | 267-268 | `record`: a read writes its own bucket only, not the `outbound` list. Before: every action wrote `outbound`. |
| `src/service.js` | 623-660 | `readCall` is split into `readWith`, which runs a read with a client in hand, and `lookup`. `lookup` (line 646) refuses under any held stop with `guard.assertNotStopped()`, then obtains its client, then counts toward its own bucket, then reads. A pre-send failure releases the count. A busy result is returned and records nothing. |
| `src/service.js` | 873-882 | `mentionedMedia` calls `lookup` (bucket `mentioned_media`). |
| `src/service.js` | 934-963 | `hashtagSearch` calls `lookup` (bucket `hashtag`). Its audit lines stay: an `ok` line on success, through `wrap`, and an `error` line on failure. |
| `src/service.js` | 964-975 | `businessDiscovery` calls `lookup` (bucket `business_discovery`). |

P2-M1, the count after the client exists.

| File | Line(s) | Change |
|---|---|---|
| `src/service.js` | 646-660 | `lookup` obtains the client (`client(product)`) before `caps.check` and `caps.record`. A failed client build throws CONFIG and spends no count. |

P2-M2, one retry for a pre-send failure (private reply and auto-reply).

| File | Line(s) | Change |
|---|---|---|
| `src/service.js` | 291-312 | `repliedList` reads the answered events as `{ id, preSendFailures, released }`. A plain id from an older state file reads as an entry with no failures. New `repliedEntry` and `writeRepliedEntry`. |
| `src/service.js` | 486-516 | `reservePrivateReply` writes `{ at, preSendFailures, released: false }`. A reservation that is not released refuses another attempt. `releasePrivateReply` and `releaseReplied` now count the pre-send failures. The first failure sets `released: true` and returns `true` (one retry left). The second keeps `released: false` and returns `false` (the retry is used up). |
| `src/service.js` | 1124-1131 | The duplicate check in the `privateReply` preflight: a reservation with two failures says the retry is used up. |
| `src/service.js` | 596-608 | `runOutbound`: the release result decides the message, through `retryLeft`. A failed release is treated as no retry left (fail closed). |
| `src/service.js` | 136-148 | `unknownOutcome(err, feature, retryLeft)`. The message names only the request that failed: "the request for <feature> failed before it reached Instagram; it can be sent again", or, when the retry is used up, "...the one retry is used up, so it is not sent again". |
| `src/service.js` | 726 | `handleInbound`: an answered event with two failures is skipped with `RETRY_USED_UP`; any other unreleased answer is `ALREADY_HANDLED`. |
| `src/service.js` | `autoReplyTo` perform (line 700) | The event mark keeps its failure count when it is written again. |

P2-M3, the body cap test (test only; the cap itself is unchanged).

| File | Line(s) | Change |
|---|---|---|
| `test/graph-client.test.js` | 504, 513 | The stream is 20 chunks, and the test asserts the exact count: the sixth chunk is the first that passes the cap, so the stream stops after six. |

P2-M4, a stale test name (test only).

| File | Line(s) | Change |
|---|---|---|
| `test/endpoints-media.test.js` | 464 | Renamed to "mediaDelete sends DELETE to the media id, reports the deletion, and refuses an empty body". |

P2-M5, stricter caps (report and README).

| File | Line(s) | Change |
|---|---|---|
| `README.md` | 107-108 | The caps table gains the business discovery and mentioned-media rows (50 a day each), and says that the lookups count toward their own bucket only. |
| `README.md` | 112 (the paragraph after the table) | A pre-send failure releases its count, and a private reply or an auto-reply may be tried once more. |
| `README.md` | 116-134 | New "Caps stricter than the spec" section (the table is in section 2 below). |

P2-M6, the unreadable expiry.

| File | Line(s) | Change |
|---|---|---|
| `src/service.js` | 666-672 | `expiryOrNull(expiresAt, at)`: `expiryStatus`, or `{ daysLeft: null, warning: 'the expiry time cannot be read' }` when the time cannot be read. |
| `src/service.js` | 675-681 | `ageOrNull(obtainedAt, at)`: `tokenAgeHours`, or `null` when the obtained time cannot be read. The same failure in the age would have thrown too. |
| `src/service.js` | 784, 787 | `tokenStatus` uses both. `refreshPaused` is reported as before. |

P2-M7, the refresh is not retried.

| File | Line(s) | Change |
|---|---|---|
| `src/graph/client.js` | 284-287 | `get(path, query, options)`. A GET is retried only when `options.noRetry` is not `true`. `options` must be a plain object (VALIDATION otherwise). |
| `src/token.js` | 96-97 | `refreshToken` passes `{ noRetry: true }`. The refresh is the only request to `refresh_access_token` in `src/` (checked by grep). The client therefore sends one request, and the token is not rotated twice. |

P2-M8, the pins (test pins are listed in section 3).

### 2. Stricter caps

The table in the README (section "Caps stricter than the spec") was this list in round 1. Round 2 added the rows listed in "P2 fix round 2", section 2, so the README table is now the current list. The first group are counts. The second are size and page limits. The spec's own counts (spacing, 200 a day, likes, follows, unfollows, auto-replies, hashtag searches, publishing, and the 1000-byte DM text) are not listed, because the service uses the spec's values.

| Limit | Value | Where | In the spec? |
|---|---|---|---|
| Business discovery lookups | 50 a day | `caps.businessDiscovery.perDay` | No (added, owner decision O-4) |
| Mentioned-media lookups | 50 a day | `caps.mentionedMedia.perDay` | No (added, owner decision O-4) |
| Owner-sent DMs, with private replies counted in it | 50 a day | `caps.ownerDms.perDay` | Stricter: private replies count toward it (decision O-11(b)) |
| Retry-After wait | 60 seconds; a longer Retry-After is not waited for | `src/graph/client.js` | No |
| Graph response body | 5 MB | `src/graph/client.js` | No (added, decision A-10) |
| HTTP API request body | 1 MB | `src/http.js` | No |
| Token-exchange response | 64 KB | `src/oauth.js` (`RESPONSE_LIMIT`) | No |
| Page list response | 256 KB | `src/oauth.js` (`PAGE_LIST_LIMIT`) | No |
| Facebook approval form body | 4 KB | `src/oauth.js` (`FACEBOOK_BODY_LIMIT`) | No |
| Comments read per media | 25 by default, 100 at most; the first page only | `src/graph/endpoints/comments.js` | No |
| Owned media checked for ownership | the first 100 | `src/service.js` (`OWNED_LIMIT`) | No |
| Conversations read | the first 100 | `src/service.js` (`CONVERSATION_LIMIT`) | No |
| Messages read per thread | the first 20; a full page is reported as truncated | `src/graph/endpoints/messaging.js` | No |

### 3. Pins changed in P1 and P2 (2026-10-22)

Each pin below is a test assertion or a test helper that changed. The old and new values are given. The first group is the P1 fix round, from `review-p2.diff` (the diff between `snap/p1-head` and `snap/p2-head`). The second group is P2, both the earlier round in section 14 and this round.

P1 pins, `test/oauth.test.js`.

| Test | Old | New | Why |
|---|---|---|---|
| The callback tests (`handler({ url: '/callback?code=XCODE&state=S' }, ok)`, and the same for the `wrong`, `none` and `right` cases) | the request has no method | `{ method: 'GET', url: ... }` | The callback answers 405 to any other method (P1 rule). |
| The approval POST helper, `fakeRequest` defaults | `headers: { host, 'content-type': 'application/x-www-form-urlencoded', ...headers }` | the same, plus `origin: \`http://${host}\`` and `'sec-fetch-site': 'same-origin'` | The bridge accepts an exact Origin match (P1 rule M-2). |
| The approval receiver's `onResult` | `(error, token) => results.push({ error, token })` | `(error, approval) => results.push({ error, token: approval?.token ?? null, expiresInSeconds: approval?.expiresInSeconds ?? null })` | The approval is now an object `{ token, expiresInSeconds }`. |
| "a POST with a mismatched state is refused with AUTH_EXPIRED, and nothing is received (O-8)" (renamed to "...gets 400, stores nothing, and the login keeps waiting (I-1, O-8)") | `res.statusCode` 403; `results.length` 1; `results[0].error.kind` `AUTH_EXPIRED`; `results[0].token` `null` | `res.statusCode` 400; `results.length` 0; the owner's matching approval is then accepted, `results.length` 1, `results[0].token` the approved token | P1 ruling 4, reversed: a stray request keeps the login waiting (I-1). |
| `assert.equal(await pending, FB_TOKEN)` | the receiver resolves to the token | `assert.equal((await pending).token, FB_TOKEN)` | The receiver now resolves to the approval object. |
| "the approval receiver rejects with AUTH_EXPIRED when the state does not match, and stores nothing (O-8)" (renamed to "...keeps waiting after a mismatched state, and resolves on the matching one (I-1, O-8)") | `await assert.rejects(pending, ... AUTH_EXPIRED)` | the promise is still pending after a mismatched state; a matching approval resolves it to `{ token, expiresInSeconds: null }` | I-1: a mismatched state does not end the login. |

P1 pins, `test/cli.test.js`.

| Test | Old | New | Why |
|---|---|---|---|
| The record scopes assertion (M-8) | `assert.deepEqual(record.scopes, INSTAGRAM_SCOPES);` | `assert.deepEqual(record.scopes, []);` and `assert.deepEqual(record.scopesRequested, INSTAGRAM_SCOPES);` | The exchange returns no granted list, so `scopes` is empty and the requested list is kept apart. |
| The facebook `receiveToken` mocks | `receiveToken: async () => 'FB-TOKEN-VALUE-LINKED-1'` (and `-UNLINKED`, `-READING-1`) | `receiveToken: async () => ({ token: '...', expiresInSeconds: null })` | `receiveToken` returns the approval object. |
| The OWNER_MISMATCH test (M-6) | `await assert.rejects(startServe(built, { out, err }), ... OWNER_MISMATCH)` | `await assert.rejects(runServe({ config, secrets, dataDir, out, err, build: async () => built, start: startServe }), ... OWNER_MISMATCH)` | `runServe` takes the serve lock before the build, and `startServe` releases it on a failed start. |
| The `fakeSecrets.source` helper (M-3) | `return values[name] === undefined ? 'none' : 'env';` | `return values[name] === undefined ? 'none' : 'keyring';` | A stored secret comes from the keyring, not the environment. |

P2 pins, earlier rounds (section 14.2): `test/config.test.js` `EXPECTED_CAPS` (two new keys, 50 each); `test/endpoints-media.test.js` the second `mediaDelete` call (deleted true, now `API_ERROR`); `test/endpoints-social.test.js` the `businessDiscovery` result (`profile`, now `{...profile, missingFields: []}`); `test/service.test.js` the `businessDiscovery` untrusted result (now with `missingFields: []`); `test/cli.test.js` the poller control (I-1, now the first like rejects with `API_ERROR`, and the poll is call 2).

P2 pins, this round:

| Test | File and line | Old | New |
|---|---|---|---|
| (e) hashtag lookup that fails | `test/service.test.js` line 699 (and about line 703) | `// A hashtag search counts as an action, so the 2-second spacing applies to the next one.` and `t.clock.advance(2000);` | `// A lookup is a read, not an outbound action, so no 2-second gap applies to the next one (P2-I2).` and no advance |
| O-4 the 51st business discovery | `test/service.test.js` line 1294 | `t.clock.advance(2000);` in the loop and before the blocked call | no advance (a lookup is not spaced by the outbound rules) |
| O-4 the 51st mentioned-media lookup | `test/service.test.js` line 1306 | the same two advances | no advance |
| O-5 a private reply that fails releases its reservation | `test/service.test.js` line 1338 | `assert.equal(t.state.data.get('private_replies')[COMMENT], undefined, 'the reservation was released');` | `assert.equal(t.state.data.get('private_replies')[COMMENT].released, true, 'the reservation is released for one more attempt');` |
| O-5 a private reply that times out keeps its reservation | `test/service.test.js` line 1361 | `assert.ok(t.state.data.get('private_replies')[COMMENT], 'the reservation is kept');` | `assert.equal(t.state.data.get('private_replies')[COMMENT].released, false, 'the reservation is kept');` |
| O-5 an auto-reply that fails releases its mark | `test/service.test.js` lines 1388-1389 | `assert.equal((t.state.data.get('autoReply.replied') ?? []).includes('e-pre'), false, 'the mark was released');` and `assert.deepEqual(t.state.data.get('autoReply.replied'), ['e-pre']);` | `assert.equal(t.state.data.get('autoReply.replied')[0].released, true, 'the mark is released for one more attempt');` and `assert.deepEqual(t.state.data.get('autoReply.replied'), [{ id: 'e-pre', preSendFailures: 1, released: false }]);` |
| O-5 an auto-reply that times out keeps its mark | `test/service.test.js` line 1406 | `assert.deepEqual(t.state.data.get('autoReply.replied'), ['e-timeout']);` | `assert.deepEqual(t.state.data.get('autoReply.replied'), [{ id: 'e-timeout', preSendFailures: 0, released: false }]);` |
| A-10 the body is cut off at the cap (P2-M3) | `test/graph-client.test.js` lines 504-513 | `bigStream(6)`, and `assert.ok(state.pulled <= 6, ...)` | `bigStream(20)`, and `assert.equal(state.pulled, 6, 'the body was cut off after the sixth chunk, the first that passes the cap');` |
| mediaDelete test name (P2-M4) | `test/endpoints-media.test.js` line 464 | `mediaDelete sends DELETE to the media id and reports the deletion` | `mediaDelete sends DELETE to the media id, reports the deletion, and refuses an empty body` |

Test helpers changed this round: `test/service.test.js` `fakeGraph` gains `failClient` (a product whose client build throws CONFIG). The helper is used only by the P2-M1 test.

### 4. New tests (12)

`test/service.test.js` (7)
- P2-I1 a publish with a bad url, caption or carousel item is refused before any count or request (line 1542)
- P2-I2 a lookup under a held CHECKPOINT makes no request, and spends no count (line 1571)
- P2-I2 a lookup spends no outbound count, so an outbound action straight after it is not spaced (line 1595)
- P2-M1 a lookup whose client cannot be built spends no count (line 1610)
- P2-M2 a private reply gets one retry after a pre-send failure; a second pre-send failure ends the retry (line 1627)
- P2-M2 an auto-reply gets one retry after a pre-send failure; a second pre-send failure ends the retry (line 1651)
- P2-M6 an unreadable expiry gives the warning and does not throw (line 1673)

`test/caps.test.js` (2)
- P2-I2 a read writes its own bucket only: no outbound count, and no spacing for the next outbound action (line 427)
- P2-I2 a lookup is not held by the outbound spacing or the outbound total (line 441)

`test/graph-client.test.js` (2)
- P2-M7 a GET marked noRetry gets one request on a 503, and the error is reported (line 544)
- P2-M7 a GET without noRetry is still retried on a 503 (line 552)

`test/token.test.js` (1)
- P2-M7 a token refresh that gets a 503 makes one request, and the error is reported (line 375)

Also changed: the test for a bad publish checks the quota read is not made as well (`t.graph.requests.length` is 0), which covers the order of the checks.

### 5. Red and green

Reverse mutations, each one reverted in a scratch copy and the matching tests run. Every one is caught by at least one failing test.

| Reverse mutation | Failing tests |
|---|---|
| P2-I1 `checkPublish` call removed | 1 |
| P2-I2 reads count toward outbound (`caps.record`) | 2 |
| P2-I2 reads checked against outbound spacing (`verdictOf`) | 1 |
| P2-I2 lookup stop check removed | 1 |
| P2-M1 count before the client build (a real reorder) | 1 |
| P2-M2 second failure releases the private reservation | 1 |
| P2-M2 second failure releases the auto-reply mark | 1 |
| P2-M3 the whole body read before the cap check | 1 |
| P2-M6 the expiry error not caught | 1 |
| P2-M7 `noRetry` ignored by the client | 2 |
| P2-M7 the refresh not marked `noRetry` | 1 |

GREEN: `npm test` (exit 0):

```
ℹ tests 862
ℹ pass 862
ℹ fail 0
```

The test file before this round had 850 tests, and the round adds 12.

### 6. Choices

- P2-M2 applies the one-retry rule to the two reservation actions only (private reply and auto-reply), as the decision says. A direct message or a publish has no reservation, so its pre-send failure says it can be sent again, and each new call is a new attempt. (Round 2: a publish whose earlier request reached Instagram keeps its counts and says so; see "P2 fix round 2".)
- P2-M2 publish: a publish is a multi-request write (containers, then media_publish). A pre-send failure in a later request can leave earlier containers unpublished; Graph expires them. The message names only the request that failed, so it does not claim the whole publish failed. This is a known limit, recorded here and in the README under "Writes and retries".
- P2-I1 means a publish that is invalid is now refused with VALIDATION even as a preview, because the check runs before the gate. The quota read is also skipped for it.
- P2-I2 changes the caps for the three lookups: they no longer wait for the outbound spacing or count toward the 200 a day total. This is the reading the controller ruled on. The earlier report (section 14.5) said the opposite.
- P2-M6 also covers an unreadable `obtainedAt`, which would throw in the same way (`ageOrNull`). The coordinator's item named only the expiry.
- `refreshToken` requires `loginProduct: 'instagram'` (added by an earlier change). The new test passes it.
- No test listens on a port. The one `.listen(` call in `test/http.test.js` (line 840) is asserted to throw before a socket is opened, and the other listen check uses a recording stub.

## P2 fix round 2 (2026-10-22)

Result: DONE. `npm test` is green: 864 pass, 0 fail, exit 0, and no Node warning line. 864 = 862 + 2 new tests. The review is `p2-fix-review.md`. Items P2F-I1, P2F-M1, P2F-M2, P2F-M3 and P2F-M4 are addressed, each with a test where the item is code. The controller's ruling on P2F-M3 (the counts stay spent) is in progress.md.

### 1. Changes, with file and line

Line numbers are those of the current files.

P2F-I1, the README sentences for hashtag search and reservations.

| File | Line | Old | New |
|---|---|---|---|
| `README.md` | 389 | "It counts toward the spacing, the 200-a-day total and the hashtag cap. It does not use the usage hold." | "It counts toward its own weekly hashtag bucket only, not the outbound spacing or the 200-a-day total. It does not use the usage hold." |
| `README.md` | 390 | "A reservation (such as a private reply) is written before the request is sent. If the send then fails, the reservation blocks a retry." | "A reservation (such as a private reply) is written before the request is sent. If the send fails before it reaches Instagram, the reservation is released once, so one retry is allowed. A second such failure keeps the reservation, and no further retry is allowed." |

Every other README sentence about lookups and retries was checked against the rulings:
- README 106-108 (the table rows for the lookups): already say "its own bucket only, not the outbound spacing or total". No change.
- README 114 (the three lookups): already correct. No change.
- README 138 ("the service does not retry on its own", busy results): correct. No change.
- README 213 (`ig_hashtag_search`, "each call counts toward the hashtag cap"): correct. No change.
- README 112 (the pre-send paragraph): changed for P2F-M3, below.
- README 415 ("A write that returns an error is never retried"): contradicted the one-retry rule for a private reply and an auto-reply. Corrected, below.

P2F-M3, a pre-send failure after an earlier request of the same publish reached Graph keeps its counts.

| File | Line(s) | Change |
|---|---|---|
| `src/service.js` | 136-156 | `unknownOutcome` takes a fourth parameter, `earlierReached` (default false). For a pre-send failure with `earlierReached`, the text is "the request for <feature> failed before it reached Instagram, but an earlier request of the same action had reached it, so its count stays counted", and the details carry `preSend: false`. Old: only the two pre-send texts (one retry left, or the retry used up). |
| `src/service.js` | 158-180 | New `watchRequests(igc)`. It wraps `get`, `post` and `del` of the client that `perform` receives. A request has reached Graph when it gets an answer, or when it fails with anything other than a pre-send failure. A pre-send failure does not set the flag. |
| `src/service.js` | 492-493 | `releaseOnPreSend` takes `earlierReached` (default false) and returns without releasing when it is true. Old: `if (!isPreSend(err)) return;`. New: `if (!isPreSend(err) || earlierReached) return;`. |
| `src/service.js` | 625-646 | `runOutbound`: `const sent = watchRequests(ctx.client)`. `perform` gets `{ client: sent.client }`. In the catch, `earlierReached = sent.watch.reached`. Both releases (the count and the reservation) are skipped when it is true, and `unknownOutcome` receives it. Old: `result = await perform(ctx);`, `releaseOnPreSend(failure, token, action, args);`, `if (isPreSend(failure) && preSendRelease !== null)`, `throw unknownOutcome(failure, feature, retryLeft);`. |
| `README.md` | 112 | Old: "The one exception is a request that failed before it reached Instagram (...). That is not an action, so its count is released. ... a second such failure ends its retry." New: adds "and no earlier request of the same action had reached Instagram", "a second such failure is final, and its retry is used up", and "A publish with an earlier request already at Instagram (its container, for example) keeps its counts, because that request was an action." |

The flag is set when a request gets an answer, not when it is sent. The review suggested a flag at the first `client.post`. A flag set at the send would mark a first request that failed before it was sent as reached, so its counts would be kept, and the ruling requires them released. The preflight reads (the owner check and the quota read) are not watched. They run before the count, so a failure of the first write after a good quota read still releases.

P2F-M1, the publish container limit.

| File | Line(s) | Change |
|---|---|---|
| `README.md` | 416 | New bullet under "Writes and retries": a publish is several requests; a failure after an earlier request reached Instagram stops the publish; the containers already made are not published; the service does not retry the publish; a new run counts again; Graph is expected to expire unpublished containers (a live check). |
| `task-13-report.md` | section 6, the P2-M2 publish bullet | Old pointer: "This is a known limit, listed in the concerns." New: "This is a known limit, recorded here and in the README under "Writes and retries"." Section 9 ("Concerns") does not list it. |
| `progress.md` | line 423 | Old: "a KNOWN LIMIT, recorded in the README." New: recorded in the README under "Writes and retries" and in task-13-report.md section 6. The earlier pointer to the concerns was wrong. |

P2F-M2, the stricter-caps table. The review listed five rows. The audit of the constants in `src/` (grep for constants, limits, maxima, timeouts, retries, polls and retention) found more time and page limits that the spec does not give, and the sentence says "every cap", so they are listed too.

| File | Line(s) | Change |
|---|---|---|
| `README.md` | 118 | Old: "The first group are counts; the second are size and page limits." New: "The first three rows are counts; the rest are size, page and time limits." |
| `README.md` | 135-147 | 13 new rows, listed in section 2 below. |
| `task-13-report.md` | section 2 | A note says that the round 1 list is superseded: the README table is the current list. |

Scope of the audit: the numeric constants and limit checks in `src/`. Input patterns (identifiers, hashtag, username and field patterns), the length of a secret name, the 5-minute `receivedAt` skew, the timer maxima and default page sizes (the event list's 20, the audit's 100) are input rules or defaults, not caps, and are not listed.

P2F-M4, the per-file count in section 4: `task-13-report.md`, "`test/service.test.js` (8)" changed to "(7)". The total of 12 is unchanged (7 + 2 + 2 + 1).

### 2. Stricter caps rows added in this round

| Limit | Value | Where | In the spec? |
|---|---|---|---|
| Media listed per call | 25 by default, 100 at most; the first page only | `src/graph/endpoints/media.js` (`MAX_LIMIT`) | No |
| Auto-reply events remembered | the last 500 answered events; the check against a second auto-reply covers only those | `src/service.js` (`REPLIED_LIMIT`) | No |
| Publish container wait | each container is polled every 5 seconds, up to 60 times (5 minutes); then the publish fails | `src/graph/endpoints/media.js` (`POLL_MS`, `MAX_POLLS`) | No |
| Graph request timeout | 15 seconds for each request | `src/graph/client.js` (`TIMEOUT_MS`) | No |
| Graph GET retries | up to three, after 1, 2 and 4 seconds, on 429, 500, 502, 503 and 504; writes and the token refresh are not retried | `src/graph/client.js` (`BACKOFF_MS`, `RETRY_STATUSES`) | No |
| Token-exchange request timeout | 15 seconds for each request | `src/oauth.js` (`TIMEOUT_MS`) | No |
| Login wait | 5 minutes; then the login ends with AUTH_EXPIRED, and the owner starts it again | `src/oauth.js` (`LOGIN_TIMEOUT_MS`) | No |
| Forwarded MCP call | 10 minutes (600000 ms) | `src/mcp.js` (`DEFAULT_TIMEOUT_MS`) | No |
| Poller backoff on RATE_LIMITED | the interval doubles on each such stop, up to 10 minutes (a longer configured interval is kept) | `src/poller.js` (`MAX_BACKOFF_MS`) | No (the spec says only that it backs off) |
| Token refresh | only for a token at least 1 day old that has not expired | `src/token.js` (`MIN_REFRESH_AGE_MS`) | No |
| Stop detail text | 200 characters | `src/guard.js` (`MAX_DETAIL`) | No |
| Handled events kept | 30 days by default (`retentionDays`, at least 1); pending events are kept | `src/events.js`, `src/config.js` | No |
| Unofficial sidecar | 20 seconds for each call by default; 16 MB of output (16,777,216 characters) | `src/unofficial/sidecar.js` (`timeoutMs`, `MAX_BUFFER_CHARS`) | No |

The 20-second sidecar default is the one the CLI uses (`src/cli.js` 616 passes no `timeoutMs`). The login wait is 5 minutes for both the Instagram callback and the Facebook approval (`src/oauth.js` 271 and 636).

### 3. Assertions changed in existing tests

None. This round changes no existing test, so no pin is changed.

### 4. New tests (2)

`test/service.test.js` (2)
- P2F-M3 a publish whose container reached Graph keeps its counts when the publish request fails before it is sent (line 1683). The quota read and the container POST succeed, and the publish POST fails pre-send. Asserts: two POSTs; `caps.publish` has one entry; `caps.outbound` has one entry; the message says the count stays counted.
- P2F-M3 a publish that fails before any request reached Graph releases its counts (line 1705). The container POST fails pre-send. Asserts: one POST; `caps.publish` and `caps.outbound` are empty lists; the message says it can be sent again.

### 5. Red and green

Reverse mutation, in a scratch copy of `src/` and `test/` (`D:\tmp\claude\p2\m3`, removed afterwards): `if (!isPreSend(err) || earlierReached) return;` changed to `if (!isPreSend(err)) return;`, so the count is released after an earlier request reached Graph. Result: the first new test fails; the second passes. `node --test test/service.test.js` reports 96 pass and 1 fail.

Green: `node --test test/service.test.js` reports 97 pass and 0 fail (95 before, plus 2). `npm test` (exit 0, output in `D:\tmp\claude\p2\npm-test-round2.txt`):

```
ℹ tests 864
ℹ pass 864
ℹ fail 0
```

### 6. Choices

- The flag is set on an answer, not on a send (see section 1).
- A failure that is not a pre-send failure also marks its request as reached (fail closed), so a later pre-send failure of the same action keeps the counts. In the current code, `perform` ends at the first failure, so this case does not arise in the publish flow.
- The error from the earlier-reached case carries `preSend: false` in its details, so no caller reads it as a pre-send failure of the action.
- The lookups make one request each, so their release is unchanged, and it is correct for one request.
- Not verified live: Graph's expiry of unpublished containers (the README says so). Node 22.12 was not run (Node 24.6.0 only), as in round 1.

### 7. Concerns for the coordinator

- The owner should look at the 13 new rows in the README table. The review listed five; the others are time and page limits found by the audit of the constants.
- The one-retry rule covers the two reservation actions only (review note N1). The owner should confirm that scope.
- Still open from round 1: the lookups' spacing and total (owner to confirm), private replies counting toward the owner DM cap (O-11b), and the live checks.
