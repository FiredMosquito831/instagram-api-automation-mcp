### Task 7: Graph endpoints for comments, likes, discovery and hashtags

**Files:** Create `src/graph/endpoints/comments.js`, `src/graph/endpoints/likes.js`, `src/graph/endpoints/discovery.js`. Test: `test/endpoints-social.test.js`.

**Interfaces:**
- Consumes: the client from Task 5.
- Produces: `commentsList(client, { mediaId, limit = 25 })`: GET `{mediaId}/comments`, fields `id,text,timestamp,username,hidden`.
- Produces: `commentReply(client, { commentId, text })`: POST `{commentId}/replies` with form `message`.
- Produces: `commentHide(client, { commentId, hide })`: POST `{commentId}` with form `hide` set to `'true'` or `'false'`.
- Produces: `commentDelete(client, { commentId })`: DELETE `{commentId}`.
- Produces: `commentParentMedia(client, { commentId })`: GET `{commentId}` with `fields=media{id}`, returning the parent media id. The field path is verified in the live phase.
- Produces: `ownedMediaIds(client, { limit = 100 })`: GET `me/media` with `fields=id`, returning a Set of the owner's media ids.
- Produces: `like(client, { igUserId, targetId, kind })`: POST `{igUserId}/likes` with form `media_id` (kind `media`) or `comment_id` (kind `comment`).
- Produces: `unlike(client, { igUserId, targetId, kind })`: DELETE `{igUserId}/likes` with the same parameter as a query.
- Produces: `businessDiscovery(client, { igUserId, username, fields })`: GET `{igUserId}` with field `business_discovery.username(${username}){${fields}}`.
- Produces: `hashtagSearch(client, { igUserId, q })`: GET `ig_hashtag_search` with `user_id` and `q`. Returns `{ hashtagId }`.

**Tests:**
- `commentReply posts message to the replies edge`.
- `commentHide sends hide as the string 'true'`.
- `commentParentMedia requests media{id}`.
- `ownedMediaIds returns a Set of ids`.
- `like posts media_id to the likes edge`.
- `unlike sends DELETE with comment_id for comments`.
- `businessDiscovery builds the business_discovery field expression`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the modules.** Run the tests and expect PASS.

