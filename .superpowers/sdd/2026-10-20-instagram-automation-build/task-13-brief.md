### Task 13: Service core

**Files:** Create `src/service.js`. Test: `test/service.test.js`, with fake clients, a fake state and a fake clock.

**Interfaces:**
- Consumes: Tasks 1 to 12.
- Produces: `createService({ config, state, events, caps, usageGate, guard, audit, unofficial, secrets, getClient, now })`. `getClient(loginProduct)` returns a Promise of a graph client bound to the current token. Tests pass a fake.
- Read methods: `status`, `capsStatus`, `stopStatus`, `tokenStatus`, `profileGet`, `mediaList`, `mediaGet`, `insightsAccount`, `insightsMedia`, `mentionedMedia`, `commentsList`, `dmConversations`, `dmMessages({ recipientId, limit })`, `dmUnread`, `dmMarkRead({ senderId })`, `hashtagSearch({ q })`, `businessDiscovery({ username, fields })`, `eventsPending({ limit })`, `eventsAck({ cursor })`, `eventsDecide({ eventId, decision, draft })`, `eventsPurge`.
- Outbound methods, each through `runOutbound`: `publishMedia({ kind, url, urls, caption, confirm })` with kinds `image`, `reel`, `carousel` and `story`; `commentReply({ commentId, text, confirm })`; `commentHide({ commentId, hide, confirm })`; `commentDelete({ commentId, confirm })`; `like({ targetId, kind, confirm })`; `unlike({ targetId, kind, confirm })`; `dmSend({ recipientId, text, confirm })`; `privateReply({ commentId, text, confirm })`; `mediaDelete({ mediaId, confirm })`. Also `stopClear({ confirm })`, `tokenRefresh`, `autoReplySet({ enabled, confirm })`.
- Unofficial methods, through `runOutbound` and gated by route: `follow({ userId, confirm })`, `unfollow({ userId, confirm })`, `profileEdit({ fields, confirm })`.
- `runOutbound({ action, feature, target, args, confirm, perform, ownerMediaCheck })` runs in this order: (1) `guard.assertNotStopped()`; (2) `assertRoute(feature)`; (3) when `ownerMediaCheck` is given, it runs and throws `OWNER_MISMATCH` when it fails; (4) `guard.gate(confirm)`, which returns `{ preview: true, action, target }` for a preview; (5) `caps.check(action)`, which returns busy on failure; (6) `usageGate.check(lastUsage)`, which returns busy on failure; (7) `perform()`. On error, if `guard.shouldStop(error)`, call `guard.stop(error.kind, error.message)`, then rethrow. (8) `caps.record(action)`, then `audit.record`, then return the result.
- Comment operations (`commentReply`, `commentHide`, `commentDelete`) pass an `ownerMediaCheck`. It calls `commentParentMedia` and checks the result against `ownedMediaIds`. A parent that is not in the set, or an unknown parent, is refused.
- `assertRoute(feature)`: for `business` and `creator`, official features are allowed. For `personal`, official features throw `ROUTE_DISABLED`. Unofficial features throw `ROUTE_DISABLED` unless both `routes.unofficial.enabled` and `acknowledged` are true. `mediaDelete`, `hashtagSearch` and `businessDiscovery` throw `ROUTE_DISABLED` when no Facebook token exists. `like` and `unlike` use the client named by `routes.likes.loginProduct`.
- `dmSend` checks `messageWindowOpen({ lastInboundAt: events.lastInboundAt(recipientId), now })` before `perform`, and throws `WINDOW_CLOSED` when it is false.
- `privateReply` checks `privateReplyOpen`, and it refuses when the comment already has a private reply, which is recorded in state under `private_replies`. Both refusals happen before any request.
- `publishMedia` throws `CAP_EXCEEDED` when `quotaUsage >= quotaTotal`. The quota comes from `contentPublishingLimit` with `since` set to 24 hours ago.
- `eventsPending` returns `{ events, nextCursor }`, and each event carries `untrusted: true`. `eventsAck` calls `events.ack`. `eventsDecide` calls `events.decide` and never calls a send method.
- `onInbound(event)`: when `autoReply.enabled` is true and a keyword rule matches `event.text`, it sends the reply through `runOutbound` with action `auto_reply`. No confirm is needed, and the caps apply. Otherwise it writes an audit line with the sender and time, never the text.
- Read tools return `AUTH_EXPIRED` as a clean `IgError`, and they never change the stop state.

**Tests:**
- `outbound without confirm returns a preview and makes no request`.
- `outbound returns busy when spacing blocks it, and records nothing`.
- `dmSend refused when the window is closed, with no request made`. (Review Focus 3.)
- `error 190 during like sets the stop state, and the next outbound is refused`. (Review Focus 1.)
- `read tool returns AUTH_EXPIRED cleanly and does not set the stop state`. (Review Focus 1.)
- `comment reply is refused when the parent media is not the owner's`.
- `private reply is allowed once per comment and only within 7 days`.
- `eventsDecide records the decision and calls no send method`.
- `eventsPending marks event text untrusted`.
- `mediaDelete is refused with ROUTE_DISABLED when no Facebook token exists`.
- `personal account refuses official features with ROUTE_DISABLED`.
- `unofficial follow is refused until routes.unofficial is enabled and acknowledged`.
- `auto-reply sends only when enabled and a rule matches`.
- `caps block the 11th like within the hour with busy`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the service.** Run the tests and expect PASS.

