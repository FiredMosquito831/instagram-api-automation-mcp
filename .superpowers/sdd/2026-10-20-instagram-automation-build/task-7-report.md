# Task 7 report: Graph endpoints for comments, likes, discovery and hashtags

Status: DONE_WITH_CONCERNS

## Rules followed

- R2 (no commits): no commit. The full suite (`npm test`) is the gate.
- R3 (installs): nothing installed. `package.json` is unchanged.
- R9 (test glob): the test script is unchanged, `node --test test/*.test.js`.
- The client (`src/graph/client.js`) and the media endpoint (`src/graph/endpoints/media.js`) are byte-identical to `snap/task-7-base` (checked with `cmp`).
- No `retryPost` on any write. There are five write calls in the new modules: `comments.js` (reply POST, hide POST, delete DELETE) and `likes.js` (like POST, unlike DELETE). Each passes no options argument, so the client cannot retry them.
- Ownership of each `mediaId` and `igUserId` is not checked here. The module provides `ownedMediaIds` and `commentParentMedia` for the service.
- No network call. The tests use a fake client that records calls.

## Context7 check (Instagram Platform docs, `/llmstxt/developers_facebook_instagram-platform_llms_txt`)

- `POST /{ig-comment-id}/replies` takes `message`, and the response is `{ id }`. The docs give no length limit for a reply.
- `POST /{ig-comment-id}?hide=<bool>` returns `{ success: true }`. The docs show `hide` as a query parameter. The brief says form, so the code sends a form field, as the brief requires. This is a live-phase check.
- `DELETE /{ig-comment-id}` returns `{ success: true }`.
- `POST` and `DELETE /{ig-user-id}/likes` take `media_id` or `comment_id`. The changelog does not show the response body, so `{ success: true }` is assumed.
- `GET ig_hashtag_search` takes `user_id` and `q`, where `q` has no leading `#`. The docs show two response shapes, `{ data: [{ id }] }` and `{ id }`. Both are accepted.

## TDD evidence

RED, before any implementation (`node --test test/endpoints-social.test.js`):

```
code: 'ERR_MODULE_NOT_FOUND',
url: 'file:///D:/Projects2/InstagramApi/src/graph/endpoints/comments.js'
...
ℹ tests 1
ℹ fail 1
✖ test\endpoints-social.test.js
```

This RED is a module-load failure, because none of the three modules existed yet, so it does not show each assertion failing on its own.

GREEN, after implementation (`node --test test/endpoints-social.test.js`): 30 of 30 pass. All seven test names from the brief are present, plus validation and fail-closed tests for each function.

GREEN, full suite (`npm test`): `ℹ tests 290`, `ℹ pass 290`, `ℹ fail 0`, exit code 0. The output is saved at `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\npm-test-task7.txt`. The count rose from 260 at Task 6 to 290, which is the 30 new tests.

## Files changed

- Created `src/graph/endpoints/comments.js`: `commentsList`, `commentReply`, `commentHide`, `commentDelete`, `commentParentMedia`, `ownedMediaIds`. `ownedMediaIds` sits here, beside `commentParentMedia`, because the two form the owner-media check. The brief did not say which module holds it.
- Created `src/graph/endpoints/likes.js`: `like`, `unlike`.
- Created `src/graph/endpoints/discovery.js`: `businessDiscovery`, `hashtagSearch`.
- Created `test/endpoints-social.test.js`: 30 tests.
- Changed `src/graph/endpoints/common.js`: added one export, `responseConfirmed(data, what)`. It throws API_ERROR unless the body is an object with `success === true`. The existing exports are unchanged.

## Behaviour

- Every input is checked before any request. The tests assert zero calls on each rejected input.
- Writes need a confirmed `{ success: true }` (hide, delete, like, unlike) or a returned id (reply). An empty or unconfirmed body is API_ERROR, never an empty success.
- A missing id in any response is API_ERROR (`responseId`).
- `commentHide` accepts only a real boolean and sends `'true'` or `'false'`. Strings and numbers are refused.
- `like` and `unlike` accept only the kinds `media` and `comment`. The kind is looked up in a Map, so prototype keys are refused.
- `businessDiscovery` accepts a username of 1 to 30 characters from `[A-Za-z0-9._]`, and fields as comma-joined lowercase names with no nesting. Both are refused before the request, so the value cannot change the `business_discovery` expression.
- `hashtagSearch` accepts `q` of 1 to 100 letters, digits or underscores, with no `#`. It needs exactly one hashtag row, or a single `{ id }` response.

## Self-review

I read the full diff against `snap/task-7-base`. The checks were:

- No `retryPost` on any write, and no options argument on the five write calls (grep).
- Every import is used. None is left over.
- The brief's seven test names are present verbatim.
- The test file imports the functions from their modules, and the modules match the test file. A first draft of the test imports put two functions in the wrong module, and I fixed that before the RED run.
- Rejected inputs are refused before any request, and the tests check that.
- Nothing logs or builds an error message from user text. The messages name only the field.

Limits of this review: every response shape comes from the docs, not from a live call. The live phase must confirm them.

## Concerns

1. `responseConfirmed` is strict. A write whose 2xx body is not `{ success: true }`, including an empty body, is reported as API_ERROR even if Graph performed it. The write is not retried. The service must treat an API_ERROR on a write as an unknown outcome, not as "not done". The like and unlike response bodies are not shown in the docs, so the live phase must confirm them.
2. `hide` is sent as a form field, as the brief requires. The docs show a query parameter. The live phase must confirm which form Graph accepts.
3. `commentsList` reads the first page only, with no `after` cursor. `ownedMediaIds` reads only the first `limit` media (up to 100). An owner with more media has older media refused by the owner-media check. This fails closed, but Task 13 should know that comments on older posts are refused until paging is added.
4. Limits that the brief does not state: comment `limit` 1 to 100, `ownedMediaIds` `limit` 1 to 100, hashtag `q` 1 to 100 characters, the username and fields grammar, and `commentReply` refusing blank text only. An unmatched hashtag gives API_ERROR, because an empty list is treated as a missing id. The live phase should confirm what Graph returns for a hashtag with no match.
5. `businessDiscovery` returns the raw `business_discovery` object, not a normalised one. The fields the caller asked for are returned as Graph sends them.
