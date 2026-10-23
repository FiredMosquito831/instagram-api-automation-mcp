# Task 6 re-review 1: Graph endpoints for profile, media and insights

Scope: fix round 1 of task-6-review.md. Only I-1, M-4, M-5, M-7 and M-8 are in scope. M-1, M-2, M-3 and M-6 are deferred and were not checked.

Inputs read: task-6-brief.md, task-6-review.md, task-6-report.md (with the fix round appended), review-task-6-fix1.diff, src/graph/endpoints/media.js and common.js (current files), test/endpoints-media.test.js (current file), and src/graph/client.js:215-233 for the write and read retry defaults. The project is not a git repository, so the diff file was used. The suite was not re-run. No project file was edited, and no subagent was used.

## Finding verdicts

### I-1 (Important): ADDRESSED

- Every child waits for FINISHED. The loop at media.js:198-203 calls `waitUntilFinished` for each child, unconditionally, before the next child is posted and before the parent is created. The `isVideo` branch is gone: `grep isVideo` over src/ returns nothing.
- Order is kept. The parent POST is at media.js:204-206, after the loop, and `media_publish` at media.js:207.
- A child that ends in ERROR or EXPIRED throws API_ERROR from media.js:128-129, so the loop exits before the parent POST.
- Brief test "publishCarousel creates children before the parent and publishes last" is updated to queue a FINISHED after each child and still asserts order: test:299-329 (route list at test:315-322).
- Required new test, image child returns ERROR: test:359-371. Queue is [child id, ERROR]. Expects API_ERROR and calls exactly [POST, GET]. No parent POST and no media_publish.

### M-4 (promoted): ADDRESSED

- `publishCarousel` takes `pollMs` and `maxPolls` with defaults `POLL_MS` (5000, media.js:10) and `MAX_POLLS` (60, media.js:11): media.js:185-188.
- Both are validated by `checkPolling` before any request, at media.js:191, and passed to every child's `waitUntilFinished` at media.js:201.
- Required test, maxPolls 1 with a child that stays IN_PROGRESS: test:373-389. The poll at media.js:134-135 throws API_ERROR on the first IN_PROGRESS. Calls are [POST, GET], and `waits` is []. The test is meaningful: when the fake queue runs out it throws a plain Error (test:36), which fails the `name: 'IgError'` check, so an implementation that ignored maxPolls would fail this test.

### M-5 (promoted): ADDRESSED

- Minimum of two items: `MIN_CAROUSEL_ITEMS = 2` (media.js:14), checked at media.js:192-194 before any request. The check runs before `checkChild` (media.js:196) and before the first POST (media.js:199).
- Required test, one item gives VALIDATION with no request: test:391-403, which asserts `client.calls.length === 0`.

### M-7 (promoted): ADDRESSED (code and test)

- `mentionedMedia` sends `fields: MEDIA_FIELDS` at media.js:235.
- MEDIA_FIELDS (media.js:7) is `id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count`. normaliseMedia (media.js:54-66) reads exactly those eight fields. The sets match.
- Test: test:487-491 asserts the `fields` query. test:477-485 is updated to the new query shape.
- Live acceptance of `fields` on `mentioned_media` is still unverified, per the controller ruling.

### M-8 (promoted): ADDRESSED

- (a) Page with `paging.next` and no cursor: media.js:79-85 throws API_ERROR. Test:152-162 covers a missing cursor and an empty cursor. This code is unchanged from head, so the test is a regression guard, as the implementer says.
- (b) One-item carousel gives VALIDATION with no request: test:391-403 (same as M-5).

## New breakage in the fix diff

Each risk named in the scope was checked against media.js:185-208 and the new tests.

- Carousel created with an unfinished child: none. Each child's id is pushed to `childIds` only after `waitUntilFinished` returns (media.js:201-202). Any non-FINISHED outcome throws before the parent POST. A bad item in the list throws in `checkChild` before the first POST (media.js:196).
- Poll running past maxPolls: none. `waitUntilFinished` (media.js:123-139) issues at most `maxPolls` GETs per child. It throws at media.js:134 when `poll >= maxPolls` on IN_PROGRESS, and sleeps only when `poll < maxPolls`.
- Parent created with fewer than two children: none. The item-count check is at media.js:192-194, before any request. `Array.from` over the validated array (media.js:196) yields one entry per item, and any hole becomes `undefined`, which `checkChild` refuses. `childIds` gets one entry per child or the function throws.
- Write retried: none. Every write is a plain `client.post(path, { form })` with no options: media.js:118, 145, 157, 199, 204, 213. The client's `post` sets `retryable: options.retryPost === true` (client.js:228), so no write is retried by default. The no-retry test (test:435-462) now covers the child POSTs and checks 10 POSTs. The new child GETs are reads (`client.get`, client.js:215, retryable), and a repeated status read creates nothing.
- Fail-open path: none. `checkPolling` runs before any request (media.js:44-51, called at media.js:156 and media.js:191). Status comparison is exact, and an unknown or missing `status_code` throws API_ERROR (media.js:127-133). `responseId` on each child's and the parent's POST response rejects a missing id (media.js:200, 205).

Result: no new Critical, Important or Minor breakage.

## Out-of-scope observations

These are not counted as issues against this round.

1. The carousel parent container is not polled to FINISHED before `media_publish` (media.js:204-207). `publishImage` (media.js:145-146) has the same shape. The brief's named call order fixes this sequence, and adding a poll would change the tested calls. If Graph rejects an unready parent at `media_publish`, that is API_ERROR, so the path fails closed. Worth a check in the live phase.
2. `maxPolls` has no upper bound (media.js:48-50); only `pollMs` is capped (media.js:45). A caller can therefore set an effectively unbounded poll. The worst case per carousel is items x maxPolls x pollMs, which is 10 x 60 x 5 s, about 50 minutes, at the defaults. `publishReel` has the same bound. Task 13 should treat a carousel publish as a long call.
3. Test quality, not defects: the test named "publishCarousel waits for a video child to FINISH before the parent is created" (test:331) now covers an image child and a video child. Its `waits` assertion (test:356) is [] because every child is FINISHED on the first GET, so no carousel test shows an IN_PROGRESS child being waited on before the next step. The shared loop is covered by test:231 and test:270. The `pollMs` passthrough is not observed in any carousel test, because the M-4 test passes `pollMs: 10` but never sleeps. Neither gap is required by the brief or the ruling.

## Round verdict

All five in-scope findings (I-1, M-4, M-5, M-7, M-8) are ADDRESSED. No finding remains open. The fix diff adds no Critical or Important breakage, and no new Minor issue. New issues: Critical 0, Important 0, Minor 0.

Evidence limits: the suite was not re-run. The verdicts rest on reading the current code and tests against the diff, plus the implementer's reported 36/36 file run and 260/260 suite run.
