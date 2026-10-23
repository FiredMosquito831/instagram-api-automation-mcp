# Task 6 review: Graph endpoints for profile, media and insights

Inputs read: task-6-brief.md, global-constraints.md, progress.md (Task 6 entry and the Task 5 carry-forwards), task-6-report.md, review-task-6.diff. Code checked on disk: src/graph/endpoints/{profile,media,insights,common}.js and test/endpoints-media.test.js. Outside the diff, read only to check named risks: src/graph/client.js (undefined-value handling, post and del retry defaults, empty-body handling), src/errors.js (error kinds), and research_notes/Instagram CLI automation landscape/official_surface_matrix.md (allowlist, carousel limit). Line numbers are the files on disk, which match the head snapshot. The suite was not re-run. I counted 31 test() calls in the test file, which matches the report.

## Spec compliance

Spec verdict: ✅ The brief's functions, methods, paths, fields and named tests are present. Items marked ⚠️ need the live phase. The one gap against the focus checks is I-1 in Issues. It is not a brief miss, because the brief names no polling for carousel children.

- ✅ profileGet: GET `me` with the brief's seven fields (profile.js:5, 7-9).
- ✅ mediaList: GET `me/media` with the brief's eight fields (media.js:7, 75). Limit defaults to 25 (media.js:68). A missing media_url becomes null (media.js:59).
- ✅ mediaGet: GET `{mediaId}` with the same fields (media.js:88-91).
- ✅ contentPublishingLimit: GET `{igUserId}/content_publishing_limit` with `since`. Quota is read from `config.quota_total` and `quota_usage` and must be a whole count, otherwise API_ERROR (media.js:96-112).
- ✅ publishImage: POST `{igUserId}/media`, then POST `media_publish` with creation_id (media.js:140-146, publishContainer at 116-119).
- ✅ publishReel: container with REELS (media.js:156-158), poll with waitUntilFinished (122-139), publish only on FINISHED (media.js:127-135 throw on ERROR, EXPIRED, unknown status, or maxPolls).
- ✅ publishCarousel: children with is_carousel_item (media.js:193-198), then the parent with CAROUSEL and children (media.js:199-201), then media_publish (media.js:202). Size 1 to 10 (media.js:187).
- ✅ publishStory: STORIES container, poll, publish (media.js:205-212). No image path, as the brief says.
- ✅ mediaDelete: DELETE `{mediaId}` (media.js:219). The method choice is the brief's interface; the live phase confirms it (⚠️).
- ✅ accountInsights: GET `{igUserId}/insights` with comma-joined metric and period, default day, day or lifetime only (insights.js:76-82, period check at 79).
- ✅ mediaInsights: GET `{mediaId}/insights` with metric and the same allowlist, no period (insights.js:84-89).
- ✅ mentionedMedia: GET `{igUserId}/mentioned_media` with media_id (media.js:227-232). The fields it returns are ⚠️, see M-7.
- ✅ Allowlist: INSIGHT_METRICS (insights.js:10-36) does not include impressions. Any metric outside it is refused with VALIDATION before any request (checkMetrics, insights.js:41-52). The list matches the research notes, except facebook_views (M-2).
- ✅ Writes never pass retryPost. The client defaults post to no retry (client.js:228) and del to no retry (client.js:232). The endpoints pass no options. The test at test/endpoints-media.test.js:361 checks all 10 POSTs.
- ✅ Media URLs: https only, parsed with URL (checkUrl, media.js:21-34), applied to image, reel, story and carousel URLs.
- ✅ Brief test names are present, including the exact wording of the ten brief tests (profileGet at test:58, publishImage at test:204, publishReel polls at test:220, publishReel ERROR at test:237, publishCarousel at test:288, publishStory at test:353, mediaList normalises at test:121, contentPublishingLimit at test:172, accountInsights rejects impressions at test:419). No network calls.
- ⚠️ Carousel video children are sent with video_url only (media.js:179). The brief gives no media_type for children. The notes do not say whether Graph needs media_type=VIDEO on video carousel items. Live phase.
- ⚠️ mentionedMedia sends no `fields` (media.js:230). The brief names none. Whether Graph returns more than `id` by default is unverified. See M-7.
- ⚠️ Carry-forward, not a Task 6 defect: no publish path checks the quota. The brief's publish sequences rule out a quota GET inside publishImage and the others, because the named tests fix the call sequence. Task 13 must gate every publish on contentPublishingLimit with since = now minus 86400 seconds, quotaUsage below quotaTotal, and the local cap of 10 per day.
- ⚠️ Carry-forward, not a Task 6 defect: the endpoints accept any igUserId or mediaId. The owner check (Tasks 7 and 13) belongs to the caller.

## Strengths

- Writes are retry-free by construction. The client makes post and del non-retrying unless retryPost is true (client.js:228, 232), and no endpoint passes it.
- Fail-closed input checks run before any request. A carousel is checked item by item before the first request (media.js:190-191), so a bad item never leaves a half-built carousel. Ids must be digit strings and are never coerced (common.js:23-28).
- Response checks are strict. A created or published id must be a digit string (responseId, common.js:39-45). A container status must match exactly, and an unknown or missing status fails (media.js:127-137). A missing quota fails rather than comparing against undefined (media.js:110-111).
- The client drops undefined values from query and form bodies (client.js:56), so optional caption and after never reach Graph as the text "undefined". Checked in the client code.
- The insights allowlist is frozen (insights.js:10), duplicates and comma-joined strings are refused, and the period is restricted.
- The endpoints build no headers and no URLs. The Bearer header and the no-redirect rule stay in the client.

## Issues

### Critical

None.

### Important

- I-1. A carousel parent can be created with an image child that never finished. media.js:193-198. Only video children are polled (media.js:196, `if (child.isVideo)`). An image child that returns ERROR or EXPIRED is still referenced by the parent. The focus check requires that a parent is not created with a child that never finished. Graph's later failure is fail-closed, so no false success follows, but the check is not met and an unpublishable parent is created. Fix: call waitUntilFinished for every child, not only video children (drop the isVideo branch at media.js:196). This changes the call sequence of the brief test "publishCarousel creates children before the parent and publishes last" (test:288). That test must queue FINISHED responses and keep its order check. Also add a test where a carousel child GET returns ERROR: expect API_ERROR, no parent POST, and no media_publish. The current carousel test covers only the FINISHED path (test:311). Cost: one GET per image child.

### Minor

- M-1. mediaDelete reports success for an empty 2xx and for a literal `null` body (media.js:219-224). client.js:121-122 maps both to data null. This follows the Task 5 m-2 ruling, so it is not new. It is the one success path that treats an absent confirmation as success. Fix once the live DELETE body is confirmed: require `data?.success === true`. Until then, keep the ruling and say so in the report. The test at test:388 pins the null case as success.
- M-2. facebook_views is missing from INSIGHT_METRICS (insights.js:10-36). The notes list it among the feed and story metrics without an FB-only restriction (official_surface_matrix.md, Media insights row, line 78). The report says the list is the union of the notes' lists and gives no reason for this omission. Fix: add it, or list it under the report's exclusions with the reason.
- M-3. Five functions take no options default, so a call with no options throws a TypeError, not IgError: mediaGet (media.js:88), mediaDelete (media.js:217), publishImage (media.js:140), contentPublishingLimit (media.js:96), mentionedMedia (media.js:227). Fix: add `= {}`, as mediaList (media.js:68) and the other publish functions already do.
- M-4. publishCarousel ignores pollMs and maxPolls and hard-codes POLL_MS and MAX_POLLS (media.js:196). publishReel accepts both (media.js:148-151). Fix: accept them as options, or record the choice in the report.
- M-5. A one-item carousel is accepted (media.js:187, `items.length < 1`). The report leaves the minimum to Graph. The one child is created and never published, and the parent POST fails as API_ERROR. Fix: require at least 2 if Graph confirms the minimum, or leave it and say so in the report.
- M-6. A stale comment names publishMedia (media.js:95), which does not exist in this module. Fix: reword it to say the service's publish gate.
- M-7. mentionedMedia sends no fields (media.js:230), but normaliseMedia (media.js:53-65) expects caption, permalink and the rest. If Graph returns only `id` by default, every other field is null on the live API. The test at test:401 uses fake data and cannot show this. The brief names no fields for this call, so this is a ⚠️ and a live check. Fix: send `fields: MEDIA_FIELDS` if the live shape allows it.
- M-8. Two paths have no test: a page with `paging.next` and no cursor (media.js:79-84, expects API_ERROR), and a one-item carousel (media.js:187). The carousel ERROR case is covered by I-1.

Carry-forwards for later tasks, not defects in Task 6:
- Task 13: a publish or comment POST that times out, or loses its response, returns API_ERROR (client.js:176). It cannot be told apart from a refusal, so the service must never retry a publish or a comment on API_ERROR.
- Task 13: the quota gate, as set out under Spec compliance.
- Task 7 and Task 13: ownership of every mediaId and igUserId.

## Assessment

Task quality: Needs fixes. Reason: I-1 leaves a carousel parent able to be created with an image child that never finished, which the focus check requires. Otherwise the write retry rule, the publish order, the quota read, the allowlist and the response checks hold, and no Critical issue was found.

Counts: Critical 0, Important 1, Minor 8.
