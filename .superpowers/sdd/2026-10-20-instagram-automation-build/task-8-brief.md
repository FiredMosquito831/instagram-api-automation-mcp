### Task 8: Graph endpoints for messaging

**Files:** Create `src/graph/endpoints/messaging.js`. Test: `test/endpoints-messaging.test.js`.

**Interfaces:**
- Consumes: the client from Task 5, `IgError` (Task 2).
- Produces: `conversationsList(client, { igUserId, userId, limit = 20 })`: GET `{igUserId}/conversations` with `platform=instagram`, plus `user_id` when given. Returns `[{ id, updatedTime }]`.
- Produces: `conversationMessages(client, { conversationId, limit = 20 })`: GET `{conversationId}` with field `messages`, then GET each message id with fields `id,created_time,from,to,message`. At most 20 messages. Returns `[{ id, createdTime, fromId, toId, text }]`.
- Produces: `sendMessage(client, { igUserId, recipientId, text })`: POST `{igUserId}/messages` with `json: { recipient: { id: recipientId }, message: { text } }`. Refuses with `VALIDATION` before any request when `Buffer.byteLength(text) > 1000`.
- Produces: `privateReply(client, { igUserId, commentId, text })`: POST `{igUserId}/messages` with `json: { recipient: { comment_id: commentId }, message: { text } }`. The same 1000-byte limit applies. The live phase confirms the shape.
- Produces: `messageWindowOpen({ lastInboundAt, now })`: true when `now - lastInboundAt` is less than 24 hours. A `null` `lastInboundAt` gives false.
- Produces: `privateReplyOpen({ commentCreatedAt, now })`: true when the comment is less than 7 days old.

**Tests:**
- `sendMessage refuses text over 1000 bytes before any request`.
- `conversationsList requests platform=instagram`.
- `privateReply sends recipient comment_id`.
- `messageWindowOpen is true just inside 24 hours and false at 24 hours`.
- `messageWindowOpen is false when there is no inbound message`.
- `privateReplyOpen is false at 7 days`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the module.** Run the tests and expect PASS.

