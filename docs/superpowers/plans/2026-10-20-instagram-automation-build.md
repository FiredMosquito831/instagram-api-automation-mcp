# Instagram Automation Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, with haiku subagents only. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the owner-only Instagram automation service: `ig serve`, a long-running local service with an HTTP API, a poller for new messages and an event log, plus `ig mcp`, an MCP server that forwards tool calls to it. Official Graph API routes and gated unofficial routes sit behind caps, a confirmation gate, a fail-closed stop state, and an owner check. Everything is tested on fake transports with no live calls.

**Architecture:** One ESM Node package. The service core owns config, state, caps, the guard, audit and the event log. It calls the official Graph client (one module per surface group) and the unofficial adapter registry (the instagrapi sidecar). One tool registry feeds the HTTP API. `ig mcp` is a thin stdio client of the HTTP API. The poller reads new messages through the official conversations endpoint. The webhook receiver is built and tested, but it stays unserved until the owner sets up a public endpoint.

**Tech Stack:** Node.js 22.12+ (ESM); commander 15.0.0 (setup commands only); `@napi-rs/keyring` (version checked on npm at execution); the MCP SDK, either `@modelcontextprotocol/server` (v2) or `@modelcontextprotocol/sdk` (v1), chosen by the spike in Task 16; Python 3 with instagrapi (pinned at execution); `node:test`, `node:http`, `node:crypto`, `node:child_process`.

**Spec:** `docs/superpowers/specs/2026-10-20-instagram-cli-design.md`, revised to the owner's decisions 1 to 11. Facts about Meta's API come from `reports/Instagram CLI automation landscape.md` and `reports/Instagram MCP and repo comparison.md`, which label them. Endpoint shapes here follow those notes and are checked only in the live phase.

## Global Constraints

- Node engines `>=22.12.0`. `package.json` sets `"type": "module"`. Commander is used only by the setup commands.
- Secrets: the environment variable `IG_<NAME>` is read first, then the keyring. The keyring service name is `instagram-automation`. Tokens never reach a file, a log, or a tool result.
- Owner-only: one owner account, `owner.igUserId`. The service acts only as that account.
- Caps (starting values, configurable): any outbound action at least 2000 ms after the previous one; at most 200 outbound actions per day in total; likes 10 per hour and 50 per day; follows 20 per day; unfollows 20 per day; owner-sent DMs 50 per day; one private reply per comment, only within 7 days of the comment; auto-replies 1 per conversation per 24 hours and 100 per day; hashtag searches 30 unique hashtags per 7 days; publishing at most 10 per day locally, never above `quota_total`, read from `content_publishing_limit` with `since` set to 24 hours ago.
- Busy, not queued: spacing and cap limits return `{ busy: true, retryAfterMs, reason }`, with HTTP 429 on the HTTP API. Nothing waits in a queue to run later.
- Usage throttle: when the usage header shows `total_time` or `total_cputime` at 80 or more, outbound calls return busy for 60000 ms.
- Confirmation: every outbound tool requires `confirm: true`. Without it, the tool returns a preview and makes no request. `ig_events_decide` records a decision and an optional draft, and it never sends.
- Stop codes: error 190 (`AUTH_EXPIRED`); a checkpoint, challenge, or two-factor requirement (`CHECKPOINT`); error 368 or feedback required (`ACTION_BLOCKED`); HTTP 429, or Graph codes 4, 17, 32, 613 and 80002 (`RATE_LIMITED`). Every 80002 counts as a rate limit, because its subcode is unknown. A stop is persisted. Only `ig_stop_clear` with `confirm: true` resumes outbound actions.
- Messaging window: `dmSend` refuses before any request when the last inbound message from that user is 24 hours old or more. `ig_private_reply` refuses when the comment is more than 7 days old, or when that comment already has a private reply.
- DM text limit: 1000 bytes.
- Retention: events are kept 30 days. The purge removes only handled events older than that. Pending events are kept until they are acknowledged and decided.
- Event cursor: opaque. `ig_events_ack` refuses any cursor that has not been issued, and it never moves backwards.
- Event text is untrusted data. Every tool result that carries event text marks it `untrusted: true`.
- Webhooks: the signature is HMAC-SHA256 of the raw body with the app secret, hex encoded, sent as `X-Hub-Signature-256: sha256=<hex>`, compared in constant time. A mismatch returns 403. The verify token is compared in constant time by hashing both values first. The receiver refuses to build without the app secret and the verify token. Its path answers 404 unless `webhook.enabled` is true.
- HTTP API: binds `127.0.0.1` by default. A non-loopback host requires `api_token`. The Host header must be `127.0.0.1` or `localhost`, with the port. `POST /tools/:name` requires `Authorization: Bearer <api_token>`.
- Timers: no single timer is longer than 2147483647 ms. Token checks run hourly.
- Graph API version `v26.0` by default (configurable). Instagram Login base `https://graph.instagram.com`. Facebook Login base `https://graph.facebook.com`. The scope parameter is comma-joined, and the live login confirms the separator.
- Unofficial routes are off by default. Enabling them requires the warning to be acknowledged, and the acknowledgement is stored in state.
- The unofficial clients send their default app or browser identity as shipped. The project adds no device, fingerprint, proxy or challenge handling of its own.
- Comments on other people's posts are not implemented, and no tool exposes them.
- Tool annotations on every MCP tool: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.
- No test makes a network call. Tests use fake transports and fake clocks.
- No git commits. The project is not a git repository. Where a template step says commit, run the full suite instead.
- Secrets never appear in logs, audit lines, errors, or tool output. Every output path passes through `redact`.
- Subagents used for implementation or review are haiku-tier only.

## Review Focus

1. A token expires or is revoked mid-session (code 190). The stop state is set, outbound tools refuse with a reason, and read tools return `AUTH_EXPIRED` rather than crashing. Tests: Task 2 ("code 190 maps to AUTH_EXPIRED"), Task 4 ("error 190 sets stop state"), Task 13 ("read tool returns AUTH_EXPIRED cleanly").
2. Duplicate or out-of-order deliveries, from the poller or the webhook. Each message ID is stored once, and the cursor never skips or repeats an event. Tests: Task 11 ("poll dedupes on message id"), Task 10 ("duplicate delivery stores one event"), Task 3 ("ack refuses an unissued cursor", "ack never moves backwards").
3. A DM send outside the 24-hour window. It is refused before any request, with a reason. Test: Task 13 ("dmSend refused when the window is closed").
4. Bursts of outbound calls, and repeated rate-limit responses. Spacing and caps hold, the answer is busy with a retry hint, POST is not retried by default, and a rate-limit response sets the stop state. Tests: Task 4 ("spacing returns busy with retryAfterMs"), Task 5 ("POST is not retried by default"), Task 4 ("rate limit sets stop state").
5. A crash during a write, or a truncated last line in the event log. State is written atomically, and the reader skips a truncated last line and keeps the rest. Tests: Task 3 ("state save is atomic", "truncated last JSONL line is skipped").

## Tool List (the contract for Tasks 13 to 16)

- Status and admin: `ig_status`, `ig_caps_status`, `ig_stop_status`, `ig_stop_clear` (confirm), `ig_token_status`, `ig_token_refresh`, `ig_autoreply_set` (confirm), `ig_events_purge`.
- Read: `ig_profile_get`, `ig_media_list`, `ig_media_get`, `ig_insights_account`, `ig_insights_media`, `ig_mentioned_media`, `ig_comments_list`, `ig_dm_conversations`, `ig_dm_messages`, `ig_dm_unread`, `ig_dm_mark_read`, `ig_hashtag_search`, `ig_business_discovery`.
- Events: `ig_events_pending`, `ig_events_ack`, `ig_events_decide`.
- Outbound (confirm required): `ig_publish_media`, `ig_comment_reply`, `ig_comment_hide`, `ig_comment_delete`, `ig_like`, `ig_unlike`, `ig_dm_send`, `ig_private_reply`, `ig_media_delete`.
- Unofficial, gated and off by default (confirm required): `ig_follow`, `ig_unfollow`, `ig_profile_edit`.

## Tasks

### Task 1: Package skeleton and configuration

**Files:** Create `package.json`, `src/config.js`. Test: `test/config.test.js`.

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig({ env, file }) -> Config`, which throws `ConfigError` with a `.field` property; `DEFAULT_CAPS`; `ConfigError`.
- `DEFAULT_CAPS` is exactly: `{ minSpacingMs: 2000, dailyTotal: 200, likes: { perHour: 10, perDay: 50 }, follows: { perDay: 20 }, unfollows: { perDay: 20 }, ownerDms: { perDay: 50 }, privateReplies: { perCommentDays: 7 }, autoReplies: { perConversationHours: 24, perDay: 100 }, publishing: { perDayLocal: 10 }, hashtags: { perWeek: 30, windowDays: 7 }, usageThrottlePercent: 80, usageBusyMs: 60000 }`.
- The config is `{ owner: { igUserId, accountType }, graph: { version: 'v26.0', instagramBase, facebookBase }, routes: { unofficial: { enabled: false, acknowledged: false, adapterByFeature: {} }, likes: { loginProduct: 'instagram' } }, caps: DEFAULT_CAPS, retentionDays: 30, dataDir: './data', poll: { intervalMs: 60000, maxThreadsPerTick: 20, spacingMs: 600 }, webhook: { enabled: false, path: '/webhooks/instagram' }, http: { host: '127.0.0.1', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'] }, autoReply: { enabled: false, rules: [] } }`.
- Merge order: defaults, then the JSON file, then the environment.

**Tests (write first):**
- `defaults match the caps and retention in Global Constraints`: `cfg.caps.minSpacingMs === 2000`, `cfg.caps.hashtags.perWeek === 30`, `cfg.retentionDays === 30`.
- `owner.accountType must be business, creator or personal`: `'brand'` throws `ConfigError` with `field === 'owner.accountType'`.
- `owner.igUserId is required`: a missing value throws with `field === 'owner.igUserId'`.
- `environment overrides the file for graph version`: `IG_GRAPH_VERSION='v27.0'` gives `cfg.graph.version === 'v27.0'`.
- `auto-replies, webhooks and unofficial routes are off by default`.
- `http binds 127.0.0.1 by default and likes use instagram login by default`.

- [ ] **Step 1: Write the tests above.** Use a temporary JSON file for `file`.
- [ ] **Step 2: Run `node --test test/config.test.js`.** Expected: FAIL, module not found.
- [ ] **Step 3: Write `package.json` and `src/config.js`.** The package has no dependencies yet. The config validates `owner.accountType` against the three values.
- [ ] **Step 4: Run `node --test test/config.test.js`.** Expected: all pass.

### Task 2: Errors, redaction, audit and the busy result

**Files:** Create `src/errors.js`, `src/redact.js`, `src/audit.js`. Tests: `test/errors.test.js`, `test/audit.test.js`.

**Interfaces:**
- Consumes: nothing.
- Produces: `IgError extends Error`, with `kind` (one of `ERROR_KINDS`) and `details`. `ERROR_KINDS` is `CONFIG, VALIDATION, OWNER_MISMATCH, STOPPED, CONFIRMATION_REQUIRED, CAP_EXCEEDED, ROUTE_DISABLED, NOT_SUPPORTED, WINDOW_CLOSED, AUTH_EXPIRED, RATE_LIMITED, ACTION_BLOCKED, CHECKPOINT, API_ERROR, UNOFFICIAL_ADAPTER_ERROR`.
- `mapGraphError({ status, body }) -> IgError`. `body.error.code === 190` gives `AUTH_EXPIRED`. Codes 4, 17, 32, 613 and 80002, or `status === 429`, give `RATE_LIMITED`. Code 368 gives `ACTION_BLOCKED`. Anything else gives `API_ERROR`. The message is `body.error.message`, redacted.
- `busyResult({ reason, retryAfterMs }) -> { busy: true, reason, retryAfterMs }`. Busy is a result, not an error.
- `redact(value)` returns a deep copy. Keys matching `/token|secret|password|authorization|sessionid|cookie/i` become `'[redacted]'`. In strings, `access_token=<value>` and `Bearer <value>` are replaced.
- `createAudit({ file, now }) -> { record(entry), read({ limit }) }`. `record` appends one JSON line `{ at, action, target, route, outcome, detail }`, redacted. It creates the folder if needed.

**Tests:**
- `code 190 maps to AUTH_EXPIRED`: `mapGraphError({ status: 400, body: { error: { code: 190, message: 'expired' } } }).kind === 'AUTH_EXPIRED'`.
- `codes 4, 17, 32, 613, 80002 and status 429 map to RATE_LIMITED`.
- `code 368 maps to ACTION_BLOCKED`.
- `unknown errors map to API_ERROR`.
- `busyResult carries busy true and retryAfterMs`.
- `redact removes tokens from keys and strings`: `redact({ access_token: 'abc', note: 'x access_token=abc&y=1' })` contains no `abc`.
- `audit lines never contain access_token`: record an entry with a token in `detail`, read the file, and assert the token is absent.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the modules.** Run the tests and expect PASS.

### Task 3: State and the event log

**Files:** Create `src/state.js`, `src/events.js`. Tests: `test/state.test.js`, `test/events.test.js`.

**Interfaces:**
- Consumes: `IgError` (Task 2).
- Produces: `createState({ file }) -> Promise<{ get(key, fallback), set(key, value), save() }>`. `save()` writes `file + '.tmp'` and renames it over `file`. A file that does not parse is renamed to `file + '.corrupt'`, and the state starts empty.
- Produces: `createEventLog({ file, state, retentionDays, now })` returning `{ append(event), pending({ limit }) -> { events, nextCursor }, ack(cursor), lastInboundAt(senderId), hasId(id), decide(eventId, decision), markRead(senderId), unreadSenders(), purge() }`.
- Cursor: an opaque string, `base64url('c' + seq)`. The state key `events.issued` holds the highest seq that `pending` has returned. `pending` returns events with `seq > events.acked`, at most `limit`, and sets `events.issued` to the last seq it returned. `ack(cursor)` decodes the cursor, throws `VALIDATION` if the seq is above `events.issued`, and otherwise sets `events.acked` to the larger of the two values.
- A stored event is `{ seq, id, kind: 'message' | 'comment' | 'mention' | 'unknown', senderId, text, receivedAt, status: 'new' | 'handled', decision: null | { action: 'reply' | 'ignore' | 'escalate', draft, at }, untrusted: true }`. Each append assigns the next `seq`.
- `decide` records the decision and sets the status to `handled`. It sends nothing.
- `markRead(senderId)` stores the latest seq for that sender under `dm.read.<senderId>`. `unreadSenders()` lists senders whose latest inbound seq is above their read marker.
- `purge()` removes events older than `retentionDays` whose status is `handled`, and keeps the rest.
- Events are stored one JSON line each. `pending`, `hasId` and `lastInboundAt` skip a truncated last line.

**Tests:**
- `append assigns increasing seq, and pending returns events after the acked position`.
- `ack refuses an unissued cursor`: a cursor for a seq above `events.issued` throws `VALIDATION`.
- `ack never moves backwards`: ack 5, then ack 3, and the acked position is 5.
- `truncated last JSONL line is skipped and the rest is kept`.
- `hasId finds a stored id for dedupe`.
- `lastInboundAt returns the newest receivedAt for a sender`.
- `purge removes only handled events older than retentionDays`: a pending old event survives. Use a fake clock.
- `decide records the decision and does not change the cursor`.
- `markRead moves the sender out of unreadSenders`.
- `state save is atomic`: the file parses after `save()`, and no `.tmp` file remains.
- `corrupt state file is moved aside and loads empty`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement both modules.** Run the tests and expect PASS.

### Task 4: Caps, busy results, stop state and the guard

**Files:** Create `src/caps.js`, `src/guard.js`. Tests: `test/caps.test.js`, `test/guard.test.js`.

**Interfaces:**
- Consumes: `IgError` and `busyResult` (Task 2), `createState` (Task 3).
- Produces: `createCaps({ caps, state, now }) -> { check(action, { senderId, tag }), record(action, { senderId, tag }), usage() }`. `check` returns `{ ok: true }` or `{ ok: false, reason, retryAfterMs }`.
- Action names: `outbound`, `like`, `unlike`, `follow`, `unfollow`, `owner_dm`, `auto_reply`, `publish`, `comment_reply`, `comment_hide`, `comment_delete`, `profile_edit`, `private_reply`, `hashtag`. `like` and `unlike` share the likes counters. `follow` and `unfollow` have their own counters. `auto_reply` keeps a per-sender 24-hour counter and a daily counter. `publish` uses the local daily counter. `hashtag` counts unique tags within 7 days, so a repeated tag does not count twice. Every action also counts toward `outbound`.
- Produces: `createUsageGate({ thresholdPercent, busyMs, now }) -> { check(usage) }`. `check` returns `{ ok: true }` or `{ ok: false, retryAfterMs: busyMs, reason }`, when `total_time` or `total_cputime` is at or above the threshold.
- Produces: `createGuard({ owner, state, now }) -> { assertOwner(igUserId), assertNotStopped(), stop(kind, detail), clearStop(), stopStatus(), gate(confirm) -> 'execute' | 'preview', shouldStop(error) }`.
- `shouldStop(error)` is true for `AUTH_EXPIRED`, `ACTION_BLOCKED`, `CHECKPOINT` and `RATE_LIMITED`.
- The stop state is stored under `stop`, so it survives a restart.

**Tests:**
- `spacing returns busy with retryAfterMs`: a call recorded, then a check at +1000 ms returns `ok: false` with `retryAfterMs` 1000. At +2000 ms it returns `ok: true`.
- `daily total of 200 blocks the 201st outbound action`.
- `likes are capped at 10 per hour`: the 11th like in the hour is refused, and an unlike counts toward the same limit.
- `hashtags are capped at 30 unique tags per 7 days`: a repeated tag does not count twice.
- `owner mismatch throws OWNER_MISMATCH`.
- `error 190 sets stop state`: `shouldStop` is true for `AUTH_EXPIRED`, and after `stop('AUTH_EXPIRED')`, `assertNotStopped` throws `STOPPED`.
- `rate limit sets stop state`: `shouldStop` is true for `RATE_LIMITED`.
- `stop state survives a restart`: a new guard over the same state still refuses.
- `gate returns preview when confirm is absent and execute when it is true`.
- `usage gate returns busy at total_time 80`: the result is busy with `retryAfterMs` 60000.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the modules.** Run the tests and expect PASS.

### Task 5: Graph API client

**Files:** Create `src/graph/client.js`. Test: `test/graph-client.test.js`.

**Interfaces:**
- Consumes: `mapGraphError` (Task 2), config (Task 1).
- Produces: `createGraphClient({ config, loginProduct, token, fetchImpl = fetch, sleep, now }) -> { get(path, query), post(path, { form, json }, { retryPost }), del(path, query) }`. Every method returns `Promise<{ data, usage }>`.
- `loginProduct` is `'instagram'` (base `config.graph.instagramBase`) or `'facebook'` (base `config.graph.facebookBase`). The URL is `${base}/${config.graph.version}/${path}` plus the encoded query.
- The token goes in `Authorization: Bearer <token>`. The live phase confirms this transport.
- Timeout: `AbortSignal.timeout(15000)`.
- Retries: GET calls, and POST calls with `retryPost: true`, retry up to 3 times on 429, 500, 502, 503 and 504. The delay is the `Retry-After` value in seconds when present, otherwise 1000, 2000 and 4000 ms. POST and DELETE are not retried unless `retryPost: true`.
- `usage` is parsed from the `x-business-use-case-usage` and `x-app-usage` headers (JSON), or `null` when absent.
- A non-OK status, or a body with `error`, throws `mapGraphError`.

**Tests:**
- `GET builds the versioned URL on the instagram base with a Bearer header`: the fake fetch records the URL and the header.
- `facebook login uses graph.facebook.com`.
- `429 on GET is retried after Retry-After seconds, then succeeds`: the fake sleep records 2000 ms for `Retry-After: 2`.
- `POST is not retried by default`: a 503 on POST throws after one call.
- `error code 190 surfaces as AUTH_EXPIRED`.
- `usage header is parsed when present`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the client.** Run the tests and expect PASS.

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

### Task 9: Secrets and token lifecycle

**Files:** Create `src/secrets.js`, `src/token.js`. Tests: `test/secrets.test.js`, `test/token.test.js`. Install `@napi-rs/keyring` (version checked on npm at execution) into `dependencies`.

**Interfaces:**
- Consumes: the client from Task 5, `IgError` (Task 2).
- Produces: `createSecrets({ env, loadKeyring, service = 'instagram-automation' }) -> { get(name), set(name, value), remove(name), source(name) }`. `get` reads `IG_<NAME>` from `env` first, with the name upper-cased and dashes and dots changed to underscores, then reads the keyring entry `(service, name)`. `loadKeyring` returns the keyring module, or `null` when it is unavailable. `set` throws `CONFIG` when there is no keyring.
- Produces: `tokenAgeHours({ obtainedAt, now })`.
- Produces: `canRefresh({ obtainedAt, expiresAt, now, scopes })`: true only when the token is at least 24 hours old, not expired, and `scopes` includes `instagram_business_basic`.
- Produces: `refreshToken({ client })`: GET `refresh_access_token` with query `grant_type=ig_refresh_token`. Returns `{ token, expiresInSeconds }`. The caller stores the new token with an expiry 60 days out.
- Produces: `scheduleTokenChecks({ check, intervalMs = 3600000, setIntervalImpl })`: runs `check` every hour and returns a stop function. It never schedules a timer longer than 2147483647 ms.

**Tests:**
- `env var wins over keyring for the same name`: with `IG_OWNER_TOKEN` set and a keyring stub holding a different value, `get('owner_token')` returns the env value and `source` is `env`.
- `keyring is used when the env var is absent`.
- `set throws CONFIG when no keyring is available`.
- `canRefresh is false below 24 hours and true at 24 hours`.
- `canRefresh is false once the token has expired`.
- `canRefresh requires instagram_business_basic`.
- `refreshToken requests grant_type ig_refresh_token`.
- `scheduleTokenChecks uses an interval under 2147483647 ms`.
- `tokens are never written to a file`: after the calls above, no file under the data directory holds the token.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement both modules.** Run the tests and expect PASS.

### Task 10: Webhook receiver (built, not served)

**Files:** Create `src/webhooks.js`. Test: `test/webhooks.test.js`.

**Interfaces:**
- Consumes: `createEventLog` (Task 3), `IgError` (Task 2).
- Produces: `verifyChallenge(query, { verifyToken }) -> { status, body }`. When `hub.mode === 'subscribe'` and the verify token matches, the status is 200 and the body is `hub.challenge`. Otherwise the status is 403. The comparison hashes both values with SHA-256, then uses `crypto.timingSafeEqual`.
- Produces: `verifySignature({ rawBody, signatureHeader, appSecret }) -> boolean`. The expected value is `'sha256=' + HMAC-SHA256(appSecret, rawBody)` as hex. Compare with `crypto.timingSafeEqual`. Return false when the header is missing or the lengths differ.
- Produces: `parseEvents(payload) -> { events, unknown }`. From `entry[].messaging[]`: an inbound message becomes kind `message`, with `id = message.mid`, `senderId = sender.id`, `text = message.text`, and `receivedAt` from `timestamp`. Entries with `is_echo` or `is_self` are skipped. Entries with `is_deleted` or `message_edit` are counted in `unknown`. From `entry[].changes[]`: field `comments` becomes kind `comment` (`id = value.id`, `senderId = value.from.id`, `text = value.text`). Field `mentions` becomes kind `mention` (`id = value.media_id || value.comment_id`). Anything else is counted in `unknown`.
- Produces: `createWebhookHandler({ appSecret, verifyToken, events, now })`. It throws `CONFIG` when either value is empty. The handler is `async ({ method, query, headers, rawBody }) -> { status, body }`. GET uses `verifyChallenge`. POST checks the signature, parses the events, skips any id that `events.hasId` knows, appends the rest, and returns 200 with `EVENT_RECEIVED`. A bad signature returns 403 and stores nothing.
- Produces: `startWebhookServer({ host, port, path, handler }) -> Promise<{ address, close() }>`. It reads the raw body, passes it to the handler, and rejects bodies over 1 MB with 413. `serve` (Task 17) starts it only when `webhook.enabled` is set.

**Tests:**
- `handshake echoes hub.challenge when the verify token matches`.
- `handshake returns 403 for a wrong verify token`.
- `signature check accepts the HMAC of the raw body and rejects a tampered body`.
- `duplicate delivery stores one event`: the same payload posted twice stores one event.
- `echo and self messages are not stored as inbound`.
- `deleted and edited messages are counted as unknown`.
- `bad signature returns 403 and stores nothing`.
- `comments and mentions are stored with their kinds`.
- `the handler refuses to build without an app secret or verify token`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the module.** Run the tests and expect PASS.

### Task 11: Poller

**Files:** Create `src/poller.js`. Test: `test/poller.test.js`.

**Interfaces:**
- Consumes: the client from Task 5 (through `getClient`), `conversationsList`, `conversationMessages` (Task 8), `createEventLog` (Task 3), the guard (Task 4), `poll` settings (Task 1).
- Produces: `createPoller({ getClient, owner, events, state, guard, config, sleep, now, onInbound }) -> { tick(), start(), stop() }`.
- `tick()`: (1) calls `conversationsList` for the owner, spacing calls by `poll.spacingMs`; (2) for each conversation whose `updatedTime` differs from the value stored under `poll.seen.<id>`, up to `poll.maxThreadsPerTick` threads, calls `conversationMessages`; (3) for each message whose `fromId` is not the owner, appends an event with `kind: 'message'`, `id` set to the message id, `senderId` set to `fromId`, and `receivedAt` set to `createdTime`, skipping ids already known; (4) stores the new `updatedTime` values; (5) calls `onInbound(event)` once for each newly appended event.
- `start()` runs `tick` every `poll.intervalMs`. `stop()` clears it.
- Errors: `AUTH_EXPIRED` calls `guard.stop` and halts the poller. `RATE_LIMITED` doubles the interval, up to 10 minutes, and skips the tick. Any other error is recorded in the audit log and the poller continues.
- Reads are not capped. The spacing and the thread limit keep the call rate under the conversation limit.

**Tests:**
- `poll dedupes on message id across ticks`: two ticks over the same thread store one event.
- `owner-sent messages are not stored`.
- `only changed threads are read`: a second tick with an unchanged `updatedTime` makes no `conversationMessages` call.
- `calls are spaced by poll.spacingMs`: the fake sleep records the gap.
- `maxThreadsPerTick is honoured`.
- `RATE_LIMITED doubles the interval`.
- `AUTH_EXPIRED stops the poller and sets the stop state`.
- `onInbound is called once per new event`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the module.** Run the tests and expect PASS.

### Task 12: Unofficial adapters (instagrapi sidecar)

**Files:** Create `src/unofficial/adapter.js`, `src/unofficial/sidecar.js`, `src/unofficial/jslib.js`, `sidecar/ig_sidecar.py`, `sidecar/requirements.txt`. Tests: `test/sidecar.test.js`, with the fixture `test/fixtures/fake-sidecar.js`.

**Interfaces:**
- Consumes: `IgError` (Task 2).
- Produces, in `adapter.js`: an adapter shape, documented in JSDoc, with methods `login({ username, password, verificationCode })`, `restoreSession(session)`, `follow(userId)`, `unfollow(userId)`, `profileEdit(fields)`, `status()` and `close()`. Also `createAdapterRegistry({ adapters, byFeature }) -> { forFeature(feature) }`. `forFeature` throws `NOT_SUPPORTED` when no adapter is mapped.
- Produces, in `sidecar.js`: `createSidecarAdapter({ command, args, timeoutMs = 20000 }) -> adapter`. The child process starts on first use. Each call writes one JSON line `{ id, method, params }`. Each response is one JSON line, `{ id, ok, result }` or `{ id, ok: false, error: { kind, message } }`. Sidecar kinds map to `IgError` kinds: `checkpoint`, `challenge` and `two_factor` give `CHECKPOINT`; `auth_expired` gives `AUTH_EXPIRED`; `rate_limited` gives `RATE_LIMITED`; `action_blocked` gives `ACTION_BLOCKED`; anything else gives `UNOFFICIAL_ADAPTER_ERROR`. A timeout kills the child and rejects with `UNOFFICIAL_ADAPTER_ERROR`. A child exit rejects all pending calls.
- Produces, in `jslib.js`: `createJsLibAdapter()`. Every method throws `IgError('NOT_SUPPORTED', 'no JavaScript unofficial library is in use; the instagrapi sidecar is the unofficial route')`.
- `sidecar/ig_sidecar.py` reads JSON lines from stdin and writes one JSON line per request to stdout. Methods: `login`, `restore_session`, `follow`, `unfollow`, `profile_edit`, `status`. It uses the instagrapi `Client`. `login` returns the session settings as its result. It never imports the challenge resolvers, and it leaves any challenge handler unset.
- The pure function `map_exception_kind(name)` maps exception class names. A name containing `Challenge` gives `challenge`. `TwoFactorRequired` gives `two_factor`. `LoginRequired` gives `auth_expired`. `ClientThrottledError` gives `rate_limited`. `FeedbackRequired` gives `action_blocked`. Anything else gives `api_error`.
- The sidecar never prints a password, and it logs only to stderr.
- `sidecar/requirements.txt` pins `instagrapi` to a release after the 3.0.0 login break. The release is chosen at execution from its CHANGELOG, and its LICENSE is recorded in the README in Task 18.

**Tests:**
- `sidecar call resolves with the response that has the matching id`, using the fixture, which echoes `params`.
- `a checkpoint from the sidecar becomes CHECKPOINT`.
- `timeout kills the child and rejects with UNOFFICIAL_ADAPTER_ERROR`: the fixture has a mode that never answers.
- `jslib adapter refuses every call with NOT_SUPPORTED`.
- `registry throws NOT_SUPPORTED for an unmapped feature`.
- Python check, as a step only: `python -m py_compile sidecar/ig_sidecar.py` exits 0. Then run `python -c "import sidecar.ig_sidecar as s; print(s.map_exception_kind('ClientThrottledError'))"` from the project root and expect `rate_limited`. If Python is not installed, record that the checks did not run.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the modules and the sidecar script.** Run the tests and expect PASS. Run the Python checks.

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

### Task 14: Tool registry

**Files:** Create `src/tools.js`. Test: `test/tools.test.js`.

**Interfaces:**
- Consumes: the service methods (Task 13).
- Produces: `TOOLS`, an array of `{ name, description, inputSchema, outbound, annotations, handler: (service, args) => Promise<any> }`. `inputSchema` is JSON Schema with `type: 'object'`, `properties` and `required`. `annotations` holds `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`. Reads set `readOnlyHint: true`. `ig_comment_delete`, `ig_media_delete`, `ig_comment_hide` and `ig_stop_clear` set `destructiveHint: true`. Every outbound tool sets `openWorldHint: true`. Every outbound tool has a `confirm` boolean property. Names match the Tool List above.
- Produces: `findTool(name)`, which returns the tool or `undefined`.
- Produces: `validateArgs(schema, args)`, which checks required fields and the `type` of each declared property (`string`, `number`, `integer`, `boolean`, `object`, `array`). It throws `VALIDATION` naming the first failing field.

**Tests:**
- `every tool name starts with ig_ and is unique`.
- `every outbound tool has a confirm property and openWorldHint`.
- `reads are readOnlyHint true`.
- `destructive tools carry destructiveHint`.
- `validateArgs rejects a missing required field with VALIDATION`.
- `validateArgs rejects a wrong type`.
- `each handler calls the matching service method`: with a fake service that records calls, `ig_dm_send` calls `dmSend`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the registry.** Run the tests and expect PASS.

### Task 15: HTTP API

**Files:** Create `src/http.js`. Test: `test/http.test.js`.

**Interfaces:**
- Consumes: `TOOLS`, `findTool`, `validateArgs` (Task 14); `createWebhookHandler` (Task 10); `IgError` (Task 2).
- Produces: `createHttpServer({ service, tools, webhookHandler, webhookPath, apiToken, host, allowedHosts }) -> http.Server`, not yet listening. It throws `CONFIG` when `host` is not loopback and `apiToken` is empty.
- The Host header must match one of `allowedHosts`, with the port. Anything else returns 403.
- `GET /health` returns 200 `{ ok: true }` and needs no token.
- `POST /tools/:name` requires `Authorization: Bearer <apiToken>`, otherwise 401. The body is parsed as JSON, validated with `validateArgs`, and passed to the handler. Success is 200 `{ result }`. A busy result is 429 with the busy body. Errors are `{ error: { kind, message } }`, with status 400 for `VALIDATION`, 409 for `STOPPED`, 429 for `CAP_EXCEEDED`, 403 for `OWNER_MISMATCH` and `ROUTE_DISABLED`, 404 for an unknown tool, and 500 for other kinds. The message is redacted.
- `GET` and `POST` on `webhookPath` pass to `webhookHandler` as `{ method, query, headers, rawBody }`. When `webhookHandler` is null, the path returns 404.
- Request bodies over 1 MB return 413.

**Tests:**
- `health answers without a token`.
- `POST /tools without the bearer token returns 401`.
- `POST /tools/ig_status with the token returns the status result`.
- `a busy result returns 429 with busy true in the body`.
- `unknown tool returns 404`.
- `webhook path returns 404 when no handler is given`.
- `webhook GET handshake passes through unchanged`.
- `a Host header outside allowedHosts returns 403`.
- `a non-loopback host without an api token is refused at construction`.
- `bodies over 1 MB are rejected with 413`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the server.** Run the tests and expect PASS.

### Task 16: MCP thin client

**Files:** Create `src/mcp.js`. Test: `test/mcp.test.js`. Install the chosen SDK package. Before writing code, read the current SDK documentation through Context7: server construction, tool registration with annotations, and the stdio transport.

**Interfaces:**
- Consumes: `TOOLS` (Task 14). The HTTP API (Task 15) is reached over loopback with the bearer token.
- Produces: `createMcpServer({ forward, tools }) -> server`. `forward(name, args)` posts to `http://127.0.0.1:<port>/tools/<name>` with the bearer token, and returns the parsed body. Each tool is registered with its name, description, input schema and annotations. A busy body is returned as a normal result, not as an error. An error body becomes a result with `isError: true` and text `{"error":{"kind":...,"message":...}}`. When the service cannot be reached, the error kind is `API_ERROR` and the message says `ig serve is not running`.
- Produces: `startStdio({ forward, tools }) -> Promise<void>`, which connects the stdio transport. Logs go to stderr only, because stdout carries the protocol.
- SDK choice: `@modelcontextprotocol/server` (v2) when Step 3 confirms that it negotiates the 2026-07-28 protocol revision with the client. Otherwise `@modelcontextprotocol/sdk` (v1). The choice is recorded in the README.

**Tests:**
- `createMcpServer registers every tool with its annotations`.
- `a busy body comes back as a normal result`.
- `an error body comes back with isError true and no secret text`.
- `an unreachable service gives an API_ERROR result that says ig serve is not running`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the module.** Run the tests and expect PASS.
- [ ] **Step 3: Protocol spike.** Start `node bin/ig.js mcp` as a subprocess with a fixture config and a fake `IG_OWNER_TOKEN`. Send `initialize` with protocol version `2026-07-28`, then `tools/list`. Expected: the negotiated version is `2026-07-28`, the tool count equals `TOOLS.length`, and stdout holds only protocol frames. If the negotiation fails, switch to the v1 package and repeat. Record the result.

### Task 17: Setup commands, OAuth helpers and serve

**Files:** Create `bin/ig.js`, `src/oauth.js`. Tests: `test/oauth.test.js`, `test/cli.test.js`. Install `commander@15.0.0`.

**Interfaces:**
- Consumes: config (Task 1), secrets and token (Task 9), service (Task 13), HTTP API (Task 15), webhook receiver (Task 10), poller (Task 11), MCP client (Task 16).
- Produces, in `src/oauth.js`: `buildAuthorizeUrl({ appId, redirectUri, scopes, state })`, which returns the Instagram Login authorization URL with `client_id`, `redirect_uri`, `response_type=code`, `scope` (comma-joined) and `state`. Also `parseRedirect(url, expectedState)`, which returns the `code`, and throws `AUTH_EXPIRED` when `state` does not match.
- Commands in `bin/ig.js`:
  - `auth set <name>`: reads the value from a hidden prompt, or from stdin.
  - `auth login`: starts a loopback redirect server on `127.0.0.1`, on port 8790 by default. Prints the authorization URL. Exchanges the code for a short-lived token, then for a long-lived token, locally with the app secret. Stores `owner_token`, `obtained_at` and `expires_at`.
  - `auth facebook`: the same loopback pattern, for Facebook Login for Business. It stores `facebook_token` and requires a linked Page. The exact endpoints are read from the Meta docs at execution.
  - `serve`: builds the service, starts the poller, starts the HTTP API on `config.http`, starts the webhook receiver only when `webhook.enabled` is set, and starts the hourly token checks. It refuses a non-loopback host without `api_token`. It prints the bound addresses.
  - `mcp`: starts the stdio MCP client, which forwards to the HTTP API.
  - `status`: prints the result of `ig_status` from the running service, or a local summary with a notice when the service is not running.
- Logs and prompts for `mcp` go to stderr.

**Tests:**
- `buildAuthorizeUrl comma-joins scope and includes state`.
- `parseRedirect returns the code when state matches`.
- `parseRedirect throws AUTH_EXPIRED when state does not match`. This is the CSRF guard.
- `ig --help lists auth, serve, mcp and status`: spawn `node bin/ig.js --help`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the modules and the bin file.** Run the tests and expect PASS.

### Task 18: Verification and owner notes

**Files:** Create `README.md`. Update the status line in `docs/superpowers/specs/2026-10-20-instagram-cli-design.md`.

- [ ] **Step 1: Run `npm test`.** Expected: `# fail 0`.
- [ ] **Step 2: Run `node bin/ig.js --help`.** Expected: the commands are listed.
- [ ] **Step 3: Run the Python checks from Task 12.** Expected: exit 0 and `rate_limited`. If Python is not installed, record that they did not run.
- [ ] **Step 4: Write `README.md`.** Cover: setup (the `IG_<NAME>` variables and the config file); the safety model (caps, busy results, confirmation, the stop state, the owner check); the tool list; the poller as the inbound route, and how the webhook receiver can be served later behind a reverse proxy the owner runs; the device-identity rule (the unofficial clients send their default identity, and the project adds none); the app secret deviation from Meta's wording; the chosen MCP SDK and the chosen instagrapi version with its LICENSE; the Meta app in Development mode; and the publish-input decision.
- [ ] **Step 5: Add a section listing every fact still unverified** against live Instagram. Take the list from the spec's Open items and from the reports' open questions.
- [ ] **Step 6: Update the spec status** to "built; live phase pending".
- [ ] **Step 7: Report** the test counts and anything that did not run.
