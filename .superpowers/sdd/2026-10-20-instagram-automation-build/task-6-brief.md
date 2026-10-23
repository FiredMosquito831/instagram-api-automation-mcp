### Task 6: Graph endpoints for profile, media and insights

**Files:** Create `src/graph/endpoints/profile.js`, `src/graph/endpoints/media.js`, `src/graph/endpoints/insights.js`. Test: `test/endpoints-media.test.js`, using a fake client that records calls.

**Interfaces:**
- Consumes: the client from Task 5.
- Produces: every function takes `client` first and returns normalised data.
- `profileGet(client)`: GET `me`, fields `id,username,biography,website,followers_count,follows_count,media_count`.
- `mediaList(client, { limit = 25, after })`: GET `me/media`, fields `id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count`. A missing `media_url` becomes `null`.
- `mediaGet(client, { mediaId })`: GET `{mediaId}`, same fields.
- `contentPublishingLimit(client, { igUserId, since })`: GET `{igUserId}/content_publishing_limit` with `since` as a Unix time, returning `{ quotaTotal, quotaUsage }` from `data.data[0].config.quota_total` and `data.data[0].quota_usage`.
- `publishImage(client, { igUserId, imageUrl, caption })`: POST `{igUserId}/media` with `image_url` and `caption`, then POST `{igUserId}/media_publish` with `creation_id`. Returns `{ id }`.
- `publishReel(client, { igUserId, videoUrl, caption, sleep, pollMs = 5000, maxPolls = 60 })`: POST `{igUserId}/media` with `media_type: 'REELS'`, `video_url` and `caption`. Poll GET `{containerId}` with `fields=status_code` until `FINISHED`. Throw `API_ERROR` on `ERROR` or `EXPIRED`, or after `maxPolls`. Then POST `{igUserId}/media_publish`.
- `publishCarousel(client, { igUserId, items, caption, sleep })`: for each item, POST `{igUserId}/media` with `is_carousel_item: true` and either `image_url` or `video_url`, collecting the child ids. Then POST `{igUserId}/media` with `media_type: 'CAROUSEL'`, `children` and `caption`. Then POST `{igUserId}/media_publish`.
- `publishStory(client, { igUserId, videoUrl, sleep })`: POST `{igUserId}/media` with `media_type: 'STORIES'` and `video_url`, poll until `FINISHED`, then publish. The image story path is not built until the spike confirms it.
- `mediaDelete(client, { mediaId })`: DELETE `{mediaId}`. The method is unresolved (DELETE or POST), and the live phase confirms it. Facebook Login only.
- `accountInsights(client, { igUserId, metrics, period = 'day' })`: GET `{igUserId}/insights` with `metric` (comma-joined) and `period`. The metrics must come from an allowlist kept in this module. `impressions` is not on the list.
- `mediaInsights(client, { mediaId, metrics })`: GET `{mediaId}/insights` with `metric`, checked against the same allowlist.
- `mentionedMedia(client, { igUserId, mediaId })`: GET `{igUserId}/mentioned_media` with `media_id`.

**Tests:**
- `profileGet requests the fields listed in the interface`.
- `publishImage creates a container, then publishes it with the creation id`.
- `publishReel polls until FINISHED before publishing`: the fake GET returns `IN_PROGRESS`, then `FINISHED`. Publish is called once, after the second poll.
- `publishReel fails on ERROR without publishing`.
- `publishCarousel creates children before the parent and publishes last`.
- `publishStory uses media_type STORIES`.
- `mediaList normalises a missing media_url to null`.
- `contentPublishingLimit sends since and reads config.quota_total`.
- `accountInsights rejects impressions with VALIDATION`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the modules.** Run the tests and expect PASS.

