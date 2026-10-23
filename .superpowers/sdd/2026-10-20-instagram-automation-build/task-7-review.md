# Task 7 review: Graph endpoints for comments, likes, discovery and hashtags

Scope: review-task-7.diff (task-7-base to task-7-head), checked against task-7-brief.md, global-constraints.md, progress.md and task-7-report.md. Read-only. No project file was edited, the suite was not re-run, and no subagent was used. Outside the diff I read only `src/graph/endpoints/common.js` and `src/graph/client.js` (the named retry and argument-shape risks), `src/errors.js` (kind names), and `src/graph/endpoints/media.js:218-229` (a cross-task consistency check). A grep of the live tree confirmed that the write call sites match the diff. Line numbers are file line numbers in the live files, which match the snapshot.

## Spec compliance

Verdict: ✅ compliant, with ⚠️ items that the live phase or Task 13 must confirm.

Endpoints (files under `D:\Projects2\InstagramApi\src\graph\endpoints\`):

- ✅ `commentsList`: GET `${mediaId}/comments`, fields `id,text,timestamp,username,hidden`, limit default 25. See `comments.js:8-9, 31-34`.
- ✅ `commentReply`: POST `${commentId}/replies` with form `message`, returns the id from the response. See `comments.js:46-47`.
- ✅ `commentHide`: POST `commentId` with form `hide` set to `'true'` or `'false'`, from a strict boolean. See `comments.js:53-55`. The brief asks for a form field. The docs show a query parameter, so this is a ⚠️ live item, as the report says.
- ✅ `commentDelete`: DELETE `commentId`. See `comments.js:61-62`.
- ✅ `commentParentMedia`: GET `commentId` with fields `media{id}`, returns the parent media id. A missing `media` or id throws API_ERROR through `responseId` and `responseObject` (`common.js:17-31`). See `comments.js:69-70`. ⚠️ The field path is verified live, as the brief says.
- ✅ `ownedMediaIds`: GET `me/media` with fields `id` and a limit default of 100, returns a Set. A missing `data` array or a row without an id throws (`comments.js:77-80`). It reads one page only; see Minor 2.
- ✅ `like`: POST `${igUserId}/likes` with form `media_id` or `comment_id`, chosen from a two-entry Map (`likes.js:8-11, 23`). ⚠️ The response body shape is confirmed live.
- ✅ `unlike`: DELETE `${igUserId}/likes` with the same parameter as a query. `client.del(path, query)` takes the query as its second argument (`client.js:231-233`), so `likes.js:33` sends it correctly. ⚠️ Live check of the response body.
- ✅ `businessDiscovery`: GET `igUserId` with fields `business_discovery.username(${username}){${fields}}` (`discovery.js:23-24`). Username and fields are checked by anchored patterns first (`discovery.js:7, 10`).
- ✅ `hashtagSearch`: GET `ig_hashtag_search` with `user_id` and `q`, returns `{ hashtagId }`. Accepts `{ data: [{ id }] }` and `{ id }` (`discovery.js:35-43`). See Minor 3 for the no-match case.

Tests:

- ✅ All seven brief test names are present verbatim: `test/endpoints-social.test.js:70, 94, 137, 152, 180, 205, 228`.
- ✅ The file has 30 test blocks, which matches the report's count of 30 new tests.

Constraints:

- ✅ Retry rule for writes. None of the five write calls passes a third argument: `comments.js:46, 54, 61` and `likes.js:23, 33`. In `client.js`, POST is retryable only when `options.retryPost === true` (`client.js:228`), and DELETE is always `retryable: false` (`client.js:232`).
- ✅ Stop codes. The modules have no try/catch, so the client's IgError propagates unchanged (`client.js:125`).
- ✅ No network in tests. The test file uses only a fake client.
- ✅ Local bounds fail closed without coercion. `checkId` refuses non-strings (`common.js:9-14`). `checkLimit` uses `Number.isInteger` (`comments.js:12-17`). `hide` must be a real boolean (`comments.js:53`). `kind` is a Map lookup (`likes.js:8-16`). The username, fields and q patterns are anchored with `$` (`discovery.js:7, 10, 12`).
- ✅ Write success marker. `responseConfirmed` requires `success === true` (`common.js:35-39`) and is used on hide, delete, like and unlike. An empty 2xx body reaches it as `data: null` (`client.js:121`) and is rejected. Reply and parent-media lookups require an id.
- ✅ No fail-open path found. A non-OK response never reaches the endpoints as success (`client.js:119-125`). Every read that needs an id or a data array throws when it is absent.
- ⚠️ Comment policy (carry-forward to Task 13). The Task 7 modules act on any `commentId` and any `igUserId`, and they do not check that the comment's parent media belongs to the owner. The ledger assigns that check to the service, with `ownedMediaIds` and `commentParentMedia` as its inputs. It cannot be verified in this diff. See Minor 1.
- ⚠️ Live-phase items, as the report lists them: the hide form versus query, the `media{id}` path, the like and unlike success bodies, and the hashtag no-match shape.

## Strengths

- Each write is one client call with no options argument, and the client has no retry path for it (`client.js:189-233`). The fake client records options, so a `retryPost` would show in the tests.
- `responseConfirmed` is strict. An empty 2xx write is an error, not a silent success. This matches the constraint.
- Every rejected input is refused before any request, and the tests assert zero calls on each.
- Error messages name the field only and never echo the input (`common.js:11`, `discovery.js:144, 147, 159`), so no value reaches an error.
- The report discloses its limits: response shapes come from the docs, not a live call, and the first-page reads are stated.

## Issues

### Critical

None.

### Important

None.

### Minor

1. Owner gate is not in this module (carry-forward to Task 13, not a Task 7 defect). `comments.js:41, 51, 59` (`commentReply`, `commentHide`, `commentDelete`) and `likes.js:19, 29` (`like`, `unlike`) accept any id. Fix: none in Task 7. Task 13 must require `commentParentMedia(commentId)` to be in `ownedMediaIds()` before the three comment writes, and `igUserId === owner.igUserId` before the likes, `businessDiscovery` and `hashtagSearch` calls. The ledger is also inconsistent: the Task 6 entry lists ownership as a carry-forward to "Task 7 and Task 13", while the Task 7 entry says the service checks it. Reconcile this in the Task 13 brief.

2. First page only (`comments.js:31-37` for `commentsList`, `comments.js:75-80` for `ownedMediaIds`). An owner with more than 100 posts has older media refused by the owner check, and comments beyond the first 25 are not reached. This fails closed and ledger ruling 3 accepted it, but it is a real functional gap. Fix later: follow the `paging.cursors.after` cursor up to a stated cap.

3. Unmatched hashtag is reported as API_ERROR (`discovery.js:38-40`). Graph answers a non-matching hashtag with an empty list, and the code treats that as a missing id. The service therefore cannot tell "no such hashtag" from a failure, and the 30-per-7-days hashtag count is spent on it. Fix after the live check: return a distinct result, such as `{ hashtagId: null }`, or add a distinct kind in `src/errors.js`.

4. Null options throw TypeError, not IgError. The `= {}` defaults only cover `undefined` (`comments.js:31, 41, 51, 59, 67, 75`, `likes.js:19, 29`, `discovery.js:15, 30`). `null` throws a TypeError, which a handler would map to a 500. This is not fail-open. Fix: destructure from `options ?? {}` inside each body, or use one shared helper. This is the same class as Task 6 M-3, which is deferred.

5. Test gap for DELETE options (`test/endpoints-social.test.js:31`). The fake `del` does not record a third argument, so a future `retryPost` on DELETE would pass the tests. The client hard-codes DELETE as non-retryable (`client.js:232`), so there is no current defect. Fix: give the fake `del` the same options parameter as `post`, and assert `undefined` in the `commentDelete` and `unlike` tests.

6. Comment text is returned without an untrusted marker (carry-forward to Tasks 13 and 14). `comments.js:23` returns text written by other accounts. The constraint says every tool result that carries event text is marked `untrusted: true`. The constraint does not say whether comment text counts as event text. If it does, the tool layer must mark it.

7. `businessDiscovery` returns the raw object (`discovery.js:25`) without checking that the requested fields are present. A field that Graph omits is absent, not null. This is not a safety path, and the report flags it (concern 5). Optional fix: normalise to the requested fields with `orNull`, as `normaliseComment` does.

Notes outside this diff (for the final review, not counted above):

- `media.js:225` (Task 6 `mediaDelete`) treats an empty 2xx body as success (`data !== null && ...`), so a DELETE with no body is reported as deleted. The constraint says a write without its success marker is an error. The ledger lists this as Task 6 M-1, deferred. Task 7's `responseConfirmed` (`common.js:36`) is the stricter rule that the constraint asks for. The Task 5 ruling that made an empty 2xx a success conflicts with the constraint. Fix in the final review: apply the `responseConfirmed` rule to `mediaDelete`.

## Assessment

Task quality: Approved. The endpoints match the brief's method, path and parameter names, no write can be retried, every write needs an explicit success marker, and every local bound fails closed without coercion. The Minor items are a null-options TypeError, a DELETE test guard, a first-page-only read that the ledger accepted, and carry-forwards to Task 13 and Task 14. None of them changes a result or a safety path in this task.

Counts: Critical 0, Important 0, Minor 7 (five in Task 7 code, two carry-forwards).
