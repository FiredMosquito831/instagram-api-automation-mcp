# Task 6 report: Graph endpoints for profile, media and insights

Status: DONE_WITH_CONCERNS
Base snapshot: `.superpowers/sdd/2026-10-20-instagram-automation-build/snap/task-6-base` (taken before any change).
No git, no commit, no install (R2, R3). `package.json` is unchanged, and so is the test script (R9).

## Files changed

| File | Change |
|---|---|
| `src/graph/endpoints/profile.js` | New. `profileGet(client)`. |
| `src/graph/endpoints/media.js` | New. `mediaList`, `mediaGet`, `contentPublishingLimit`, `publishImage`, `publishReel`, `publishCarousel`, `publishStory`, `mediaDelete`, `mentionedMedia`. |
| `src/graph/endpoints/insights.js` | New. `INSIGHT_METRICS` (the allowlist), `accountInsights`, `mediaInsights`. |
| `src/graph/endpoints/common.js` | New, a fourth source file. Shared checks: `checkId`, `responseObject`, `responseId`, `orNull`. Not in the brief's file list; it keeps the id and response checks in one place. |
| `test/endpoints-media.test.js` | New. 31 tests, all using a fake client that records calls. No network call. |

Not touched: `src/graph/client.js`, `src/config.js`, `src/errors.js`, `src/redact.js`, `src/audit.js`, `src/state.js`, `src/events.js`, `src/caps.js`, `src/guard.js`, `package.json`.

## TDD evidence

### RED

The tests were written first, with no endpoint modules present. `node --test test/endpoints-media.test.js` gave:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\graph\endpoints\profile.js' imported from D:\Projects2\InstagramApi\test\endpoints-media.test.js
...
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

The RED run fails at module load, so no individual assertion ran. That is the honest state before the modules exist. The saved output is in the scratchpad at `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\red.txt`.

### GREEN

After the modules were written, `node --test test/endpoints-media.test.js` gave:

```
ℹ tests 31
ℹ pass 31
ℹ fail 0
```

Full suite, `npm test`, run once at the end:

```
ℹ tests 255
ℹ pass 255
ℹ fail 0
```

That is the 224 tests that passed at baseline plus the 31 new ones. The baseline run is in the scratchpad at `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\baseline.txt`.

### Wire check (not a test)

A probe in the scratchpad (`probe.mjs`) ran `publishCarousel` and `contentPublishingLimit` through the real Task 5 client, with a fake `fetch`. The wire format was correct:
- Child bodies: `is_carousel_item=true&image_url=...`. The boolean and the URL are encoded as expected.
- Parent body: `media_type=CAROUSEL&children=<id>%2C<id>&caption=album`.
- Publish body: `creation_id=<id>`.
- The limit GET carried `?since=1792500000`.
- The token appeared only in the Authorization header, never in a URL.

The probe's insights line returned `API_ERROR` because the probe had run out of scripted replies. That is the probe's fault, not the code's.

## Behaviour

- **Writes never pass `retryPost`.** Every `post` and `del` call is made without options. One test checks every POST across all the publish functions (10 calls).
- **Fail closed.** Each of these is refused with VALIDATION before any request: non-numeric ids (a number is not coerced), `limit` outside 1 to 100, a `since` that is not a whole Unix time, a non-https media URL, a caption that is not a string, a carousel of 0 or more than 10 items, an item with both or neither URL or any other key, a `pollMs` or `maxPolls` out of range, a metric not on the allowlist, a repeated metric, a comma-joined metric string, and a period other than `day` or `lifetime`. All items in a carousel are checked before the first request, so a bad item never leaves a half-built carousel.
- **Responses are fail closed too.** A missing quota is API_ERROR, so `publishMedia` can never compare against `undefined`. A container status that is `ERROR`, `EXPIRED`, unknown or missing fails without publishing. A delete is confirmed only by `{ success: true }` or an empty 2xx.
- **Impressions are excluded**, and so are the deprecated metrics and the ones the notes mark as Facebook Login only (see Decisions).

## Decisions and deviations (the brief was silent or open)

1. **Carousel video children are polled to FINISHED** before the parent is created. The brief names `sleep` for `publishCarousel` but gives no polling step, so this is the only use of `sleep` there. A parent that references a video still processing would fail at Graph. Polling makes that a clean API_ERROR. Please check this against the live phase.
2. **Carousel size is 1 to 10 items.** The 10 maximum comes from the research notes. The 2-item minimum that Instagram may enforce is not in the notes, so Graph decides that.
3. **Media URLs must be https.** This is my rule; the brief does not give one.
4. **Insights periods are `day` and `lifetime` only**, as the research notes list them. `week` and `days_28` are refused until verified.
5. **The insights allowlist** is taken from the research notes (`research_notes/Instagram CLI automation landscape/official_surface_matrix.md`), union of the account and media metric lists. Left out: `impressions`, `plays`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count` (deprecated), `total_comments`, `total_likes`, `total_views`, `link_clicks` (Facebook Login only in the notes), and `profile_views` (not in the metric list). Not re-verified live.
6. **Return shapes** (the brief does not give them): camelCase fields, and a missing Graph field becomes null.
   - `profileGet` returns `{ id, username, biography, website, followersCount, followsCount, mediaCount }`.
   - `mediaList` returns `{ items, nextAfter }`. `nextAfter` is the cursor when Graph reports a next page, otherwise null.
   - `mediaGet` and `mentionedMedia` return `{ id, caption, mediaType, mediaUrl, permalink, timestamp, likeCount, commentsCount }`.
   - `contentPublishingLimit` returns `{ quotaTotal, quotaUsage }`.
   - `accountInsights` and `mediaInsights` return `{ metrics: [{ name, period, values: [{ value, endTime }] }] }`.
   - Publish functions return `{ id }`. `mediaDelete` returns `{ id, deleted: true }`.
   - The client's usage value is dropped here. Task 13 gets it through `onUsage`, as R6 says.
7. **`mediaList` limit maximum is 100.** The brief gives no maximum.
8. **`mediaDelete` uses DELETE**, as the brief's interface says. The plan leaves the method open (DELETE or POST), and the live phase confirms it.
9. **`mentionedMedia` response shape is assumed** to be a single media object. The brief gives only the request. An unexpected shape fails as API_ERROR.

## Carry-forwards from earlier tasks

- Task 5 (carry-forward m-7): no retryPost on a write. Met, and tested.
- Task 5 (R6): the endpoints never read usage. Task 13 must pass `usage.app` through `onUsage`, as the Task 5 ledger says.
- Task 2 (M-12): Tasks 14 and 15 must validate `limit` and return VALIDATION. `mediaList` already does, so the value never reaches Graph unchecked.
- Task 2 (M-3, string bodies): handled in Task 5. The endpoints only see parsed data.

## Self-review

I read the new modules on disk, `media.js` in full and the rest against my own write-up. Findings:

- Fixed during the review: the comment on `mediaDelete` said the method was "not yet confirmed" without saying what was used. It now names DELETE as the interface's choice and the plan's open question.
- Checked: no unused imports or constants (`media.js`, `insights.js`, `common.js`, `profile.js`). Every error kind used (VALIDATION, API_ERROR) is in `ERROR_KINDS`.
- Checked: the endpoints build no headers and no URLs. They call `client.get`, `client.post` and `client.del` only, so the Bearer header and the no-redirect rule stay in the client. The probe confirmed both.
- Checked: each test name in the brief is present, with the exact wording the brief uses (`profileGet requests the fields listed in the interface`, `publishReel polls until FINISHED before publishing`, and so on), plus extra tests for the fail-closed rules.
- Not checked: nothing exercises the real Graph API. Shapes and metric names are from the research notes and the brief, and the live phase confirms them.

## Known limits

- The insights allowlist and the `mentioned_media` shape are unverified against the live API (decisions 5 and 9).
- The carousel video polling is not verified against the live API (decision 1).
- The endpoints write no logs. Their own error messages carry ids, status words and counts, never the token. A Graph error text that reaches an `IgError` is redacted by `IgError` itself. Task 9 registers the tokens.

## Fix round 1 (review task-6-review.md)

Status after this round: DONE_WITH_CONCERNS. Items 1 to 5 below are done. M-1, M-2, M-3 and M-6 are left alone, as the coordinator asked, and remain deferred.

Decisions 1 and 2 above are superseded by this round. Decision 1 said only video children were polled. Decision 2 said a one-item carousel was allowed. Both are replaced by the changes below.

### What changed

1. **I-1 (Important): every carousel child waits for FINISHED.** The `isVideo` branch is removed, so `waitUntilFinished` runs for each child before the next child and before the parent. An image child that returns ERROR now stops the carousel before the parent is created, with API_ERROR. The brief's test "publishCarousel creates children before the parent and publishes last" is updated to queue a FINISHED for each child. It still asserts the order. The video-child test is updated to the same sequence.
2. **M-4: `publishCarousel` accepts `pollMs` and `maxPolls`.** Defaults are 5000 and 60, the same as `publishReel`. The values are checked with `checkPolling` before any request.
3. **M-5: a carousel needs at least two items.** Fewer than two gives VALIDATION before any request. The message now says "2 to 10".
4. **M-7: `mentionedMedia` requests `fields: MEDIA_FIELDS`**, the same list as `mediaList`.
5. **M-8: two paths are now tested.** (a) A page with `paging.next` and no cursor gives API_ERROR. The test covers a missing cursor and an empty cursor. This behaviour already existed, so this test passed at RED. It is a guard, not a new fix. (b) A one-item carousel gives VALIDATION with no request.

### Tests

New tests (5):
- `mediaList refuses a page that has a next page but no cursor, rather than an empty success` (M-8 a).
- `publishCarousel stops before the parent when an image child returns ERROR` (I-1).
- `publishCarousel polls with the given maxPolls, and fails when a child stays IN_PROGRESS` (M-4).
- `publishCarousel refuses a one-item carousel with VALIDATION, before any request` (M-5, M-8 b).
- `mentionedMedia requests the fields that normaliseMedia reads` (M-7).

Updated tests (4): the two carousel order tests, the no-retry test (its queue now includes the child polls), and `mentionedMedia reads the mentioning media by media_id` (its query now includes `fields`).

### RED

Before the code change, with the updated tests in place, `node --test test/endpoints-media.test.js` gave 36 tests, 28 pass, 8 fail. The 8 failures were the carousel tests, the no-retry test and the two mentionedMedia tests. The output is in the scratchpad at `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\fix1-red.txt`.

### GREEN and the full suite

Covering tests:

```
$ node --test test/endpoints-media.test.js
ℹ tests 36
ℹ pass 36
ℹ fail 0
exit 0
```

Full suite, `npm test`:

```
$ npm test
ℹ tests 260
ℹ suites 0
ℹ pass 260
ℹ fail 0
ℹ cancelled 0
exit 0
```

260 is the 255 from the first round plus the 5 new tests. Outputs are in the scratchpad at `fix1-green-module.txt` and `fix1-full.txt` in the same folder.

### Files changed in this round

- `src/graph/endpoints/media.js`: `MIN_CAROUSEL_ITEMS`, `checkChild` returns the form fields directly, `publishCarousel` (polls every child, takes pollMs and maxPolls, minimum 2 items), `mentionedMedia` (sends fields).
- `test/endpoints-media.test.js`: the tests listed above.

Nothing else was changed. `insights.js`, `profile.js`, `common.js` and the client are untouched.

### Concerns after this round

- Every carousel child now costs one status GET, so image carousels are slower to publish. The review named this cost.
- Whether Graph accepts `fields` on `mentioned_media` is still unverified and needs the live phase.
- The mediaList no-cursor test is a regression guard, not a fix.

## P6 (2026-10-23)

Package P6 (owner decision O-13): publishing from files under media.dir, with the URL checked by HEAD before any Graph request. No upload route. Status: DONE_WITH_CONCERNS (see the end of this section).

Starting point: 1087 passing (the count before P6). Finish: 1125 passing, `npm test` exit 0 (1087 plus 38 new tests).

### Changes, file and line

src/config.js (line numbers as on disk after the change):
- 63: defaults `media: { dir: './media', publicBaseUrl: null }`, with a comment (O-13).
- 157: `checkPublicBaseUrl(value)`. The URL must be https, with no query string (`?`, even empty), no fragment (`#`, even empty), no credentials, no white space, and no non-string or empty value. Trailing slashes are removed, and the href must round-trip to the input (a host or path that the parser would rewrite is refused). A null value means no base URL.
- 223-225: the `media` section is checked: `media.dir` must be a non-empty string, and `media.publicBaseUrl` is normalised at load (`config.media = { ...media, publicBaseUrl: checkPublicBaseUrl(...) }`).

src/graph/endpoints/media.js:
- 5: `import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'`.
- 22-25: `MEDIA_LIMITS` (exported, frozen). image: .jpg, .jpeg, .png; 8 MiB; Content-Type prefix `image/`. video: .mp4, .mov; 100 MiB; prefix `video/`.
- 27: `HEAD_TIMEOUT_MS = 15000`. 28-29: `URL_ITEM_KEYS` (imageUrl, videoUrl) and `FILE_ITEM_KEYS` (imageFile, videoFile). `CHILD_KEYS` is removed.
- 161-170: `invalidFile`, `extensionOf`, `kindLimits` (helpers).
- 172: `requireBase(publicBaseUrl)`: a file publish with no base URL throws CONFIG, before any read.
- 181: `parseMediaPath(value, mediaKind)` (exported). The syntax check runs before any read: a non-empty string; no NUL; not starting with a slash or backslash; no colon (drive letter or stream name); no empty, `.` or `..` segment; and the extension of its kind. It returns the segments.
- 199: `resolveMediaDir(dir, root)` (exported): a relative dir is resolved against the root, an absolute one is kept.
- 204: `mediaFileUrl(publicBaseUrl, segments)` (exported): base, then each segment percent-encoded. No query string.
- 212: `resolveMediaFile({ fs, mediaDir, file, mediaKind, publicBaseUrl })` (exported, the file system injected). Order: syntax, base URL, `realpath(mediaDir)` (CONFIG if it fails), `realpath(file)` (VALIDATION if missing), containment (the real path must lie inside the real media dir; `..` prefixes and equality are refused), the extension of the real file, `stat` (VALIDATION if it fails), regular file, not empty, size within the limit. Returns `{ url, size }`. The file's content is never read.
- 253: `checkMediaUrl({ fetchImpl, url, mediaKind, size })` (exported). A HEAD request with `redirect: 'error'`, `headers: {}` (no token), and a 15 s timeout. A send failure, a non-2xx status, a Content-Type that is not the kind's prefix, or a Content-Length that is not digits (or, when `size` is known, not equal to it) all refuse with VALIDATION.
- 282: `parseCarouselItem(item, index, source)` (exported): exactly one of the two keys for the source, and no other key. Returns `{ key, mediaKind, value }`.
- 298: `checkPublish({ kind, url, file, urls, files, caption, publicBaseUrl })` (rewritten). A carousel takes exactly one of `urls` or `files`, and neither `url` nor `file`. A single-media kind takes exactly one of `url` or `file`, and neither `urls` nor `files`. A file needs the base URL (CONFIG). Syntax only, no read. The checks for the existing URL inputs are unchanged.
- 338: `checkSource(...)`: one source of a single-media publish.
- 375: `checkChild(item, index)`: now built on `parseCarouselItem` (the same messages and the same refusals as before for URL items).

src/service.js:
- 6: `import { realpath, stat } from 'node:fs/promises'`. 7-8: `dirname`, `isAbsolute`, `resolve` from node:path, and `fileURLToPath`.
- 22-40: the media imports (`checkMediaUrl`, `parseCarouselItem`, `resolveMediaDir`, `resolveMediaFile` added).
- 53-54: `PROJECT_ROOT` (the folder above src/, as cli.js computes it) and `DEFAULT_MEDIA_FS = { realpath, stat }`.
- 282-284: createService options `mediaFs = DEFAULT_MEDIA_FS`, `mediaFetch = (url, init) => globalThis.fetch(url, init)`, `projectRoot = PROJECT_ROOT`. The doc comment above `createService` now describes them.
- 309-313: argument checks: `need(mediaFs, ['realpath', 'stat'], ...)`, `mediaFetch` a function, `projectRoot` absolute.
- 612: `publishBy(kind, igc, { url, items, caption })`: uses the URLs that `resolveMedia` checked.
- 620: `mediaBaseUrl()`: `config.media.publicBaseUrl` as a string, or null.
- 628: `resolveMedia({ kind, url, file, urls, files, publicBaseUrl })`: for each source, a file goes through `resolveMediaFile` and then `checkMediaUrl` (with the size); a direct URL goes through `checkMediaUrl`. A carousel does this per item and returns `{ items }`. No Graph request.
- 1198: `publishMedia({ kind, url, file, urls, files, caption, confirm })`. `checkPublish` runs before `runOutbound`, so a bad input spends no count. The preflight runs `resolveMedia` and then `requireQuota`, so every check comes before the first Graph request. `perform` gets the resolved URLs.

src/tools.js:
- 335-343: `ig_publish_media` declares `file` (string) and `files` (array), which the handler forwards. The description names the two sources and the extensions. The annotations are unchanged.

### Tests

Existing tests changed (old and new):
1. test/config.test.js, 'the default config has exactly the documented shape' (line 122). Old: the expected object had no `media` key. New: `media: { dir: './media', publicBaseUrl: null }` is added after `dataDir`, because the default config now has the section.
2. test/service.test.js, the harness only (no existing assertion changed): `configFor` takes a `media` option and sets `media: { dir: MEDIA_DIR, publicBaseUrl: null, ...media }`; `setup` injects `mediaFs` (default: an empty fake file system) and `mediaFetch` (default: a fake host that answers 200, `image/jpeg`, or `video/mp4` for .mp4 and .mov), and returns `host` and `mediaFs`. Existing publishMedia tests now pass through the fake HEAD check, with no network request.
3. test/endpoints-media.test.js: only new imports were added. No existing assertion changed.
4. test/fixtures/media-fakes.js (new): `fakeMediaFs`, `fakeHost`, `defaultHead`, `MEDIA_DIR`, `OUTSIDE_DIR`, `MIB`, `inMedia`. Not a `*.test.js` file, so the R9 glob does not run it.

New tests (38):
- test/config.test.js (6): P6 media.dir defaults to ./media, and media.publicBaseUrl defaults to null; P6 media.publicBaseUrl must be https: an http URL is refused; P6 media.publicBaseUrl with a query string or a fragment is refused, even an empty one; P6 media.publicBaseUrl loses its trailing slashes at load; P6 media.publicBaseUrl refuses credentials, a space, an empty string, a path that is not absolute, and a non-string; P6 media.dir must be a non-empty string.
- test/endpoints-media.test.js (16): P6 a file path must be relative, with no drive, colon, leading separator, empty, . or .. segment, before any read; P6 a file must end in an extension of its kind: .jpg, .jpeg or .png for an image, .mp4 or .mov for a video; P6 the URL of a file is publicBaseUrl plus each percent-encoded segment, with no query string or fragment; P6 media.dir is resolved against the project root when it is relative, and kept when it is absolute; P6 a file inside media.dir is accepted, with its URL and size; a backslash separator gives the same URL; P6 a symlink under media.dir that points outside it is refused, and its target is never read; P6 a real path that only shares a name prefix with media.dir is refused (media-evil is not media); P6 a symlink whose real file has an extension of the other kind is refused; P6 a file that is missing, a directory, empty, or over the size limit is refused; the limits are 8 MiB and 100 MiB; P6 the HEAD check refuses a 404, and sends no token and follows no redirect; P6 the HEAD check refuses a Content-Type that does not match the kind, and accepts a matching one with parameters; P6 the HEAD check passes a Content-Length that equals the file size, and refuses one that differs or is not a whole number; P6 the HEAD check refuses a request that fails to send, such as a redirect that is not followed; P6 a carousel item from files or from urls has exactly one of its two keys; P6 a publish takes exactly one of url or file, and a carousel exactly one of urls or files; P6 a file publish with no publicBaseUrl is refused with CONFIG, before any read.
- test/service.test.js (15): P6-1 a publish takes exactly one source: neither or both is refused before any read or request; P6-2 a file publish with no publicBaseUrl is refused with CONFIG before any file is read; P6-3 a file path with .., a drive letter or a leading slash is refused before any file is read; P6-4 a symlink that points outside media.dir is refused, with no HEAD request, no container request and no count; P6-5 a HEAD check that answers 404 refuses the publish, with no container request and no count; P6-6 a HEAD check with the wrong Content-Type refuses the publish; P6-7 a file whose Content-Length equals its size passes the HEAD check, and the container request follows; P6-7b a Content-Length that differs from the file size refuses the publish, with no container request; P6-8 the direct url input is checked with HEAD, and its container request follows a passing check; P6-9 the URL of a file is publicBaseUrl plus its encoded segments; the HEAD request carries no token and no query string; P6-10 a carousel of files checks each file, and the parent is built from the file URLs; P6-11 a carousel of files with one bad item is refused before any file is read or any request is made; P6-12 the HEAD checks count toward no cap: a carousel of two checked files counts once; P6-13 a file over the size limit is refused before any HEAD or container request; P6-14 a preview of a file publish reads no file and makes no request.
- test/tools.test.js (1): P6 ig_publish_media declares file and files, and its handler forwards them to publishMedia.

The count: 6 + 16 + 15 + 1 = 38.

### RED and GREEN

RED, after the tests were written and before any implementation, on the files that the new tests touch: `node --test test/service.test.js test/config.test.js test/endpoints-media.test.js` gave tests 168, pass 146, fail 22, and the endpoints file did not load (the new functions did not exist). `node --test test/tools.test.js` gave tests 39, pass 38, fail 1 (the new tool test). Output is in the scratchpad at `p6-red.txt` and `p6-tools-red.txt`, in `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\`.

Two of the RED failures were mine, in the tests, and were fixed before the implementation was judged: `BASE` was not defined in the service test file (a ReferenceError), and the imports named a fixture export that did not exist. Both were test-side fixes, with no change to what the tests assert.

GREEN, `npm test` after the implementation and the config-shape update:

```
$ npm test
ℹ tests 1125
ℹ suites 0
ℹ pass 1125
ℹ fail 0
ℹ cancelled 0
exit 0
```

### Reverse mutations (each applied, run, then restored; the restore is verified)

| # | Mutation | Result |
|---|---|---|
| M1 | containment check in resolveMediaFile disabled (`if (false)`) | 3 failing, caught |
| M2 | Content-Length equality in checkMediaUrl disabled | 2 failing, caught |
| M3 | the one-source check for a single-media publish disabled | 2 failing, caught |
| M4 | HEAD redirect policy changed from `error` to `follow` | 1 failing, caught |
| M5 | trailing-slash removal in checkPublicBaseUrl disabled | 1 failing, caught |
| M6 | requireBase removed from the file path checks | 2 failing, caught |

After M1 to M4 the files were compared with their backups (identical). M5 was applied and reverted with Edit; the line is back at src/config.js line 167 (inside checkPublicBaseUrl). The full suite was green after the last restore: 1125 of 1125.

### Self-review

- Order: every check that needs no read runs in `checkPublish`, before `runOutbound` (so before the count). The file and HEAD checks run in the preflight, before `requireQuota` (the first Graph request). `caps.record` runs after the preflight, so a refused input spends no count. Tests P6-4, P6-5 and P6-13 check the no-count outcome.
- A preview (no `confirm`) returns before the preflight, so it reads no file and makes no request (P6-14).
- No token: the HEAD request has `headers: {}`. The built URL has no query string. Tests P6-9 and the HEAD tests check both.
- A carousel is all URLs or all files; each item is checked; a bad item stops the publish before any read (P6-11).
- Known limits, recorded for the README (P7):
  1. A story is video only (the publishStory path, which the brief keeps to video until the spike confirms an image path). So the story rule is .mp4 or .mov. There is no image-story code path, so the request's ".jpg, .jpeg or .png for story images" has nothing to apply to.
  2. A carousel cannot mix URL and file items.
  3. A file can change between its check and the owner's host serving it. The Content-Length match narrows this; it does not close it.
  4. The owner's host must answer HEAD. A host that answers 405 or fails to send refuses every publish (fail closed). A missing Content-Length passes; a present one must match.
  5. A direct URL now costs one HEAD request per publish, to the URL the caller gave.
  6. A symlinked directory inside media.dir resolves through `realpath`, as a symlinked file does. The tests use a file-level link in the fake file system.
- Not done: no README, no CLAUDE.md, no docs (P7). No change to the poller, the state, the events or the HTTP server.

### Status

DONE_WITH_CONCERNS. Concerns: the story image path is not built, so the story rule is video only; the HEAD check needs the owner's host to answer HEAD (a live check); a file can change after it is checked.

### P6 fix round (2026-10-23)

Three items from the coordinator. Count: 1125 before the round, 1138 after (+13), `npm test` exit 0 (1138 pass, 0 fail).

#### Item 1: image stories. Not added. The spec allows only video stories for now.

- Spec, line 134: "Publish post, carousel, Reel, story video | Yes (container, then publish); input method pending the spike". Line 135: "Publish story image | Unconfirmed | Unknown | Build only if the spike confirms it".
- Plan, line 205: "The image story path is not built until the spike confirms it."
- No spike result is recorded. `CLAUDE.md` says no live Instagram call has been made, and the live phase is pending. The research notes say the same: `reports/Instagram CLI automation landscape.md` line 147, "Only the video STORIES path is confirmed", and `official_surface_matrix.md` line 117, "the Stories image path" is unverified.
- So stories stay video only (.mp4 or .mov). Test P6-ST1 shows that a `.mp4` story uses the video STORIES path, and a `.jpg` story is refused by name before any read or request.
- When the live spike confirms the image story path, the change is small: an image kind for `story` in `checkPublish`, `resolveMedia`, and `publishStory`, with the image limits.

#### Item 2: HEAD fallback to a one-byte GET (405 or 501 only)

Files: `src/graph/endpoints/media.js`.
- Line 260: `HEAD_REFUSED = new Set([405, 501])`. Only these statuses trigger the fallback.
- Lines 262-290: `sendCheck` (one request, timeout, no redirect, the given headers only, never a token; a send failure refuses), `checkContentType`, `checkLength`.
- Line 291: `discardBody`. The body of the fallback answer is cancelled at once, so the file is not downloaded.
- Line 302: `checkRangedGet`. The GET sends `Range: bytes=0-0`. A 206 must carry `Content-Range: bytes 0-0/<total>`, and the total must equal the file size when the size is known. A 200 (the host ignored the range) must carry a `Content-Length` that equals the size when the size is known. The Content-Type must be the kind's type. Any other status (404, for example) refuses.
- Line 332: `checkMediaUrl`. HEAD first. On 405 or 501 the fallback runs. Any other HEAD failure refuses, as before (the 404 test still sends one HEAD and no GET).
- For a direct URL, whose size is not known, the same rules apply without the size comparison: a 206 needs a `Content-Range` in the form `bytes 0-0/<total>`, and a 200 needs a digit `Content-Length` if one is given.

#### Item 3: the audit line carries the SHA-256 of the file

Files: `src/graph/endpoints/media.js` and `src/service.js`.
- `media.js` line 214, `resolveMediaFile`: after the size checks, `fs.readFile(real)` reads the content once through the injected file system. The content length must equal the stat size (otherwise it is refused as changed while checked). Line 255 computes the SHA-256 (`createHash`). The result is `{ url, size, sha256 }`.
- `service.js` line 54: `DEFAULT_MEDIA_FS` includes `readFile`. Line 309: `createService` checks that `readFile` exists.
- `service.js` line 629, `resolveMedia`: returns the audit entries, one `{ name, sha256 }` per file, in order. A direct URL has none.
- `service.js` line 665, `publishAuditDetail`: `file <relative name> sha256 <hex>`, joined with `; `. It never carries the caption, and no path beyond the relative name. It is null for a publish with no file.
- `service.js` line 685: `runOutbound` takes `auditDetail` (a function, default null). Line 730: `detailOf`. Line 755: the error line carries the digest, then the error kind (`...; API_ERROR`). Line 764: the ok line carries the digest. Other actions pass no `auditDetail`, so their lines are unchanged.
- `service.js` line 1233: `publishMedia` passes `auditDetail`, read after the preflight.
- Check that the digest survives the real audit writer: a probe through `createAudit` (which redacts every line) kept the 64-character digest intact.
- Cost: the content of a file of up to 100 MiB is read into memory once to hash it, one file at a time.

#### Changed existing assertion (1)

- `test/endpoints-media.test.js`, 'P6 a file inside media.dir is accepted, with its URL and size; a backslash separator gives the same URL'. Old: `assert.deepEqual(forward, { url: \`${BASE}/photos/cover.jpg\`, size: 2048 })`. New: `assert.deepEqual(forward, { url: \`${BASE}/photos/cover.jpg\`, size: 2048, sha256: sha256Hex(Buffer.alloc(2048)) })`. Reason: `resolveMediaFile` now returns the digest.
- Fixture change (not an assertion): `test/fixtures/media-fakes.js` `fakeMediaFs` gained `readFile` and a `contents` option (a file without contents reads as zero bytes of its size). It also exports `sha256Hex`. The service test file imports `sha256Hex` too.

#### New tests (13)

- `test/endpoints-media.test.js` (7): P6-FB1 a host that answers 405 to HEAD and 206 to the one-byte GET passes when the type and the Content-Range total match; P6-FB2 a 501 also falls back, and a 200 passes when its Content-Length matches, with its body cancelled and not read; P6-FB3 after a 405, the one-byte GET refuses a different total, a different type, no Content-Range, a 200 with no Content-Length (size known), or a 404; P6-FB4 a 405 whose one-byte GET cannot be sent refuses; P6-FB5 a 404 to HEAD refuses with no fallback (only HEAD is sent); P6-FB6 for a direct URL a 206 with a Content-Range passes, and so does a 200 without a Content-Length; P6-AUD1 `resolveMediaFile` gives the SHA-256 of the contents, and refuses a file whose contents differ in length from its size.
- `test/service.test.js` (6): P6-FB7 a 405 to HEAD and a 206 to the one-byte GET lets a file publish through, and the container request follows; P6-FB8 a 404 to HEAD refuses a file publish with no one-byte GET and no container request; P6-AUD2 the publish audit line carries the digest, the kind (target) and the outcome, and no caption text or path (the test checks the whole audit with `JSON.stringify`); P6-AUD3 the error audit line keeps the digest, with the error kind; P6-AUD4 a carousel of files has one digest per file, in order, and a publish of direct URLs has a null detail; P6-ST1 a story from a `.mp4` file uses the video STORIES path, and a story from a `.jpg` file is refused with no read and no request.

#### RED

This round's tests were written after the implementation, so there is no RED run for this round. Their power is shown by the reverse mutations below. Each mutation was applied with an exact string replacement, the test files were run, and the file was restored and compared byte for byte.

| # | Mutation | Failing tests |
|---|---|---|
| M7 | `HEAD_REFUSED` emptied (no fallback) | 5: FB1, FB2, FB3, FB6, FB7 |
| M8 | fallback on any HEAD status of 400 or more | 4: the 404 test, FB5, P6-5, FB8 |
| M9 | body of the fallback answer not cancelled | 1: FB2 (the cancelled assertion) |
| M10 | digest left out of the audit (`auditDetail: null`) | 3: AUD2, AUD3, AUD4 |
| M11 | `Authorization` sent on the one-byte GET | 1: FB1 (the headers assertion) |
| M12 | digest computed over empty bytes | 5: the accepted-file test, AUD1, AUD2, AUD3, AUD4 |

#### GREEN

```
$ npm test
ℹ tests 1138
ℹ suites 0
ℹ pass 1138
ℹ fail 0
ℹ cancelled 0
exit 0
```

#### Known limits from this round

- The fallback is a GET for one byte, so the owner's host sees a Range request. A host that serves the range is the normal case, and the body is never read.
- The digest describes the file as checked. The host could serve a different file afterwards. The Content-Type and Content-Length or Content-Range checks narrow this, and do not close it.
- A 100 MiB file is held in memory once while it is hashed.

### P6 fix round 2 (2026-10-23): story.images, and a chunked digest

Count: 1138 before the round, 1146 after (+8). `npm test` exit 0: 1146 pass, 0 fail.

#### 1. Image stories behind `story.images` (default false)

Spec: lines 134 and 135 of `docs/superpowers/specs/2026-10-20-instagram-cli-design.md`. Line 135 says "Publish story image | Unconfirmed | Unknown | Build only if the spike confirms it". The spike has not run, so the default stays video only.

- `src/config.js` line 65: default `story: { images: false }`, with a comment that cites spec line 135. Lines 228-229: `story.images` must be a real boolean (the string "true", a number and null are refused, as `ConfigError` for `story.images`).
- `src/graph/endpoints/media.js`:
  - line 397, `storyKindOf({ file, url, storyImages })` (exported): a story is a video unless `storyImages` is true and its name (the file's name, or the last segment of a URL's path) ends in .jpg, .jpeg or .png.
  - line 412, `checkPublish`: takes `storyImages` (default false). The story branch (line 445) takes the kind from `storyKindOf`, then runs the same source check as any single-media publish: the image path (imageUrl or file with image extension, 8 MiB, image/* HEAD check) or the video path.
  - line 527, `publishStory`: takes exactly one of `videoUrl` or `imageUrl`, and posts `media_type: 'STORIES'` with `video_url` or `image_url`. Polling and publish are unchanged. A feed image is never posted as a story: `publishImage` is not used for stories.
- `src/service.js`: line 1226 reads `config.story.images`, which is passed to `checkPublish` (publishMedia) and to `resolveMedia` (line 1236, which is defined at line 634). Line 647 sets the media kind of a story. `publishBy` (line 613) posts an image story with `imageUrl` and a video story with `videoUrl`.

With the flag false, a `.jpg` or `.png` story is refused by name before any read or request (P6-ST3, unchanged behaviour). With the flag true, a `.jpg` story goes through the image checks (extension, 8 MiB, image/* HEAD) and is posted as `STORIES` with `image_url` (P6-ST2).

The image story request shape is not confirmed by a live call. That is the spike item.

#### 2. The digest is streamed in chunks

- `src/graph/endpoints/media.js`:
  - line 253: `HASH_CHUNK_BYTES = 1 MiB`.
  - line 258, `sha256File({ fs, path, size, chunkBytes })` (exported): `fs.open(path, 'r')`, then `read(buffer, 0, chunk, position)` until it returns 0 bytes, with the hasher fed each chunk, then `close()`. Reading stops early if more bytes arrive than `size`. The bytes read must equal `size`, or the file is refused as changed while checked. Only one chunk buffer is held at a time.
  - line 248: `resolveMediaFile` calls `sha256File` after the size checks. It no longer calls `readFile`, so `DEFAULT_MEDIA_FS` in `src/service.js` line 55 is `{ realpath, stat, open }` (imported as `open as openFile`, line 6), and the `need` check at line 310 asks for `open`.
- The fixture `test/fixtures/media-fakes.js`: `fakeMediaFs` gained an `open` method with `read` and `close`. Its bytes are the contents when given, and zeros are written into the caller's buffer per read otherwise, so a 100 MiB fake file costs no memory. The `readFile` method added earlier in this round was removed.
- The earlier round's note that a 100 MiB file is held in memory once is superseded: the file is now read in 1 MiB chunks.
- A probe against the real Node file system (`open` from node:fs/promises, a 2.5 MiB random file) gave the same digest as a one-shot hash, and refused a stat size that did not match.

#### Changed existing assertion (1)

- `test/config.test.js`, 'the default config has exactly the documented shape' (around line 122): the expected object gained `story: { images: false }` after `media`. Old: no `story` key. Reason: the new default section.

Harness change (not an assertion): `test/service.test.js` `configFor` takes a `story` option and sets `story: { images: false, ...story }`.

#### New tests (8)

- `test/config.test.js` (2): P6-ST story.images defaults to false, so only video stories are published; P6-ST story.images must be a real boolean, so the string "true", a number and null are refused.
- `test/endpoints-media.test.js` (4): P6-IS1 publishStory posts an image story as a STORIES container with image_url, and refuses a story with both or neither URL; P6-IS2 checkPublish takes a .jpg or .png story only when storyImages is true, and a .mp4 story either way; P6-CH1 the digest of a file read in several chunks equals the digest of the same bytes read in one chunk, and no read asks for more than a chunk; P6-CH2 a 100 MiB file is hashed in chunks of at most 1 MiB.
- `test/service.test.js` (2): P6-ST2 with story.images true, a story from a .jpg file publishes as an image story (a STORIES container with image_url, after the image HEAD check); P6-ST3 the default reads as false and refuses a .jpg story with no read and no request.

#### RED

The tests were written before the implementation. `node --test test/service.test.js test/config.test.js test/endpoints-media.test.js` gave 178 tests, 173 pass, 5 fail: P6-ST (default), P6-ST (boolean), P6-ST2, the pinned default shape (the new key was expected but absent), and the endpoint file, which did not load because `sha256File` did not exist. P6-ST3 passed already, which is expected, since it guards the default.

#### GREEN

```
$ npm test
ℹ tests 1146
ℹ suites 0
ℹ pass 1146
ℹ fail 0
ℹ cancelled 0
exit 0
```

Three affected files alone (`service`, `config`, `endpoints-media`): 246 pass, 0 fail.

#### Reverse mutations (each applied by exact replacement, the three files run, the file restored and compared byte for byte)

| # | Mutation | Failing tests |
|---|---|---|
| M13 | `storyKindOf` always answers video | 2: P6-IS2, P6-ST2 |
| M14 | the service passes `storyImages = false` to the checks | 1: P6-ST2 |
| M15 | image story posted as `video_url` | 2: P6-IS1, P6-ST2 |
| M16 | `story.images` default true | 2: the pinned default shape, P6-ST (default) |
| M17 | one chunk of up to 100 MiB | 1: P6-CH2 |
| M18 | only the first chunk is hashed | 3: the size-limit test, P6-CH1, P6-CH2 |

Suite after the mutations were restored: 1146 pass, 0 fail.

#### Limits recorded for the README

- The image story request (`STORIES` with `image_url`) is the natural shape and is not confirmed by the live spike. It is off until `story.images` is set to true.
- `sha256File` reads with `open`, `read` and `close`. A host that returns fewer bytes than the stat size is refused as a changed file.

### P6 review fixes (2026-10-23): the nine items in p6-review.md

Count: 1146 before the round, 1159 after (+13). `npm test` exit 0: 1159 pass, 0 fail.

#### M-1: remote text in refusal messages is cut and cleaned

- `src/graph/endpoints/media.js` line 316, `safeEcho(value)` (exported): removes control characters (U+0000 to U+001F and U+007F to U+009F) and keeps the first 64 characters.
- Line 335: the Content-Type refusal uses it. Line 345: the Content-Length refusal (`checkLength`) uses it. Line 372: the total of a 206 answer uses it.
- The Content-Type and Content-Length are still only ever compared, never used for anything else.

#### M-2: direct URLs are probed only on hosts on `media.allowedHosts`

- `src/config.js` line 64: `media.allowedHosts` defaults to `null`, which means "the default". Line 187, `HOST_NAME`: a host name is lowercase letters, digits and hyphens in dot-separated labels, with no scheme, path or port. Line 191, `checkAllowedHosts(value, publicBaseUrl)`: `null` gives the host of `publicBaseUrl`, or none when that is not set; a list must be an array of host names (lowercased), and anything else is a `ConfigError` for `media.allowedHosts`. Line 246-247: the value is normalised at load.
- `src/graph/endpoints/media.js` line 440, `checkDirectUrl(url, field, allowedHosts)`: https (as before), then the host must be on the list. A host that is not on it is refused with VALIDATION (the refusal does not repeat the host). It is called for a single URL (`checkSource`, line 499) and for each carousel URL item (line 466). `checkPublish` takes `allowedHosts` (line 452, default `[]`, so no host is allowed when no list is given).
- `src/service.js` line 1243: `config.media.allowedHosts`, passed to `checkPublish` at line 1244, before any request.

#### M-3: a 403 to HEAD also falls back to the one-byte GET

- `src/graph/endpoints/media.js` line 312: `HEAD_REFUSED = new Set([403, 405, 501])`. The same checks apply to the GET answer (the type, and the 206 Content-Range total or the 200 Content-Length).

#### M-4: the file is opened once, and the descriptor is checked

- `src/graph/endpoints/media.js` line 6: `constants` from node:fs. Line 257: `READ_FLAGS`, read only and non-blocking where the platform has the flag (on Windows `O_NONBLOCK` is undefined, so the flags are `O_RDONLY`).
- Line 264, `sha256File({ fs, path, expected, chunkBytes })`: `fs.open(path, READ_FLAGS)`, then `handle.stat()`. The descriptor must be a regular file (line 278), with the same device and inode as the path stat taken at check time (line 279), a link count of 1 (line 282), and the same size (line 283). The bytes are then read in chunks and hashed; the count must equal the descriptor's size. It returns `{ size, sha256 }`, both from the descriptor.
- Line 250: `resolveMediaFile` calls it with the check-time stat (`expected: info`), and takes the size and the digest from its result.
- A real-filesystem probe (node:fs/promises, a temporary folder): the stat and the descriptor had the same device and inode, the link count was 1, the digest matched a one-shot hash, and `PHOTOS/Cover.JPG` gave the canonical URL. The O_NONBLOCK flag is undefined on this Windows platform (flags 0).
- Hard links (link count above 1) are now refused, as the review asked. A file that is legitimately hard-linked is refused too; the owner can remove the second name.

#### M-5: the URL is built from the canonical path

- `src/graph/endpoints/media.js` line 251: `mediaFileUrl(publicBaseUrl, inside.split(/[\\/]/))`, where `inside` is the path relative to the real media folder. The URL, the digest and the size now describe the same file.
- Line 192: a `.` segment is no longer refused. It names the directory it is in, and the real path is what is checked. A `..` segment is still refused (the syntax check, which runs before any read).

#### M-6: an oversize file is never opened or hashed

- The size check (line 245) runs on the path stat, before `sha256File` (line 250), so an oversize file gets no `open`, no `read` and no `fstat`. Test P6-R6 asserts this.

#### M-7: image stories stay behind `story.images`

- No code change. The flag (`story.images`, default false) is the controller's decision, which supersedes the plan's "not built" wording (spec line 135 and plan line 205). Recorded here as the decision the controller should note in the decisions file.

#### M-8: the tool description

- `src/tools.js` line 337: "... .jpg, .jpeg or .png for an image; .mp4 or .mov for a reel or a video story; .jpg, .jpeg or .png for an image story only when story.images is true ...".
- `src/graph/endpoints/media.js` line 487: an image-looking story is refused by name while `story.images` is off, and the refusal says why: "an image story needs story.images to be true; a story is a video (.mp4 or .mov) until then".

#### M-9: a refused publish writes one audit line

- `src/service.js` line 614, `refusedPublish(kind, reason)`: one `publishMedia` line, with the outcome `refused`, the kind as the target, and the reason kind as the detail. No path, caption or URL.
- Line 1235, `publishMedia`: the body runs in a try. A refusal before the request part (the kind, `checkPublish`, the preflight, the stop, the route, the quota) writes the line at line 1266, using `reached`, which is set at line 1258 when the request part begins. An error from the request part is audited by `runOutbound` as before, so it is not written twice.
- A busy result is also a refusal, and writes a `BUSY` line (line 1263). The coordinator did not ask for this; it is a judgement, and the report says so.

#### Changed existing assertions (4)

1. `test/config.test.js`, 'the default config has exactly the documented shape': the `media` line changed from `media: { dir: './media', publicBaseUrl: null }` to `media: { dir: './media', publicBaseUrl: null, allowedHosts: [] }`. Reason: the new key.
2. `test/endpoints-media.test.js`, 'P6 a file path must be relative, with no drive, colon, leading separator, empty, . or .. segment, before any read': the list no longer contains `'a/./b.jpg'`. Old: refused. New: a `.` segment is allowed, and it is covered by P6-R5. Reason: M-5.
3. `test/endpoints-media.test.js`, 'P6 a publish takes exactly one of url or file, and a carousel exactly one of urls or files': `base` changed from `{ publicBaseUrl: BASE, caption: 'x' }` to `{ publicBaseUrl: BASE, caption: 'x', allowedHosts: ['media.example.com'] }`. Reason: M-2, the list must now be passed for a direct URL.
4. `test/endpoints-media.test.js`, P6-CH1 and P6-CH2: the calls changed from `sha256File({ ..., size })` returning the hex digest to `sha256File({ ..., expected: await fs.stat(path) })` returning `{ size, sha256 }`, so the assertions compare `.sha256`. Reason: M-4 (the function now takes the check-time stat and returns the descriptor's size and digest).

Harness and fixture changes (not assertions):
- `test/service.test.js` `configFor`: `media` defaults to `allowedHosts: ['example.com']`, so the existing direct-URL tests (all on example.com) keep their behaviour.
- `test/fixtures/media-fakes.js`: `fakeMediaFs` gained a device, an inode and a link count for each path (`identity`), a descriptor `stat` on the open handle, and `swaps` to model a change between the check and the open. `open` takes the flags.

#### New tests (13)

- `test/config.test.js` (2): P6-R2 media.allowedHosts defaults to the host of publicBaseUrl, and to none when publicBaseUrl is not set; P6-R2 media.allowedHosts takes host names, lowercased, and refuses anything else with the field named.
- `test/endpoints-media.test.js` (8): P6-R1 safeEcho removes control characters and keeps at most 64 characters, and a refusal echoes a long Content-Type no further; P6-R2 checkPublish refuses a direct URL, or a carousel URL item, on a host that is not on allowedHosts; P6-R3 a 403 to HEAD falls back to the one-byte GET; P6-R4 a file swapped between the check and the open is refused (another inode, another size, a non-file, a second name); P6-R4b the file is opened once, after the path checks, and its size and digest come from the descriptor; P6-R5 a path spelled with another case, or with a `.` segment, gives the canonical URL and digest; P6-R6 an oversize file is never opened, read or stat-ed through a descriptor; P6-R6b a 301 or 302 answer refuses, with no fallback.
- `test/service.test.js` (2): P6-R2s a direct URL on a host that is not on media.allowedHosts is refused before any request, and a listed host is probed; P6-R9 every refused publish writes one audit line (outcome refused, reason kind, no path, caption or URL), for four refusals: a file that escapes by name, a 404, a missing publicBaseUrl, and a used-up quota.
- `test/tools.test.js` (1): P6-M8 the publish tool names the story rule.

#### RED

The tests were written before the code. The config tests failed (3: the pinned shape, and the two allowedHosts tests). The service tests failed (2: P6-R2s and P6-R9). The endpoint file did not load (`safeEcho` was not exported yet). After the code, four expectations in my new tests were wrong and were corrected (the chunk tests compared the return object, and the echo test expected 64 `x` characters where 64 characters of `text/…` leave 59).

#### GREEN

```
$ npm test
ℹ tests 1159
ℹ suites 0
ℹ pass 1159
ℹ fail 0
ℹ cancelled 0
exit 0
```

#### Reverse mutations (each applied by exact replacement, the four test files run, the file restored and compared byte for byte)

| # | Mutation | Failing tests |
|---|---|---|
| MR1 | safeEcho neither strips nor cuts | 1: P6-R1 |
| MR2 | the allowedHosts check removed | 2: P6-R2, P6-R2s |
| MR3 | 403 not a fallback status | 1: P6-R3 |
| MR4 | device and inode not compared | 1: P6-R4 |
| MR5 | URL built from the spelled segments | 1: P6-R5 |
| MR6 | size check after the open | 3: the size-limit test, P6-R6, P6-13 |
| MR7 | refusal line not written | 1: P6-R9 |
| MR8 | `..` segment allowed | 2: the relative-path test, P6-3 |
| MR9 | second hard link allowed | 1: P6-R4 |
| MR10 | story images flag default true | 2: the pinned shape, P6-ST |

Suite after the mutations were restored: 1159 pass, 0 fail.

#### Notes for the report reader

- A direct URL on a host that the owner did not list is now refused. A presigned or object-store URL on another host needs the host added to `media.allowedHosts` (the README item, P7).
- `sha256File` now takes the check-time stat and returns `{ size, sha256 }`. A caller that passes the old `size` gets a refusal, not a silent pass.
- The M-3 fallback and the M-4 descriptor check have not been run against a live host.
