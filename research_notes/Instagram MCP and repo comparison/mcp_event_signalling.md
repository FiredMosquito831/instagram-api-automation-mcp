# MCP event signalling for the Instagram service

Date: 2026-10-20. Scope: how an MCP server tells its client that something new has happened; what Claude Code and other clients surface; how existing servers do it; what the MCP maintainers recommend; and a recommendation for decision P in [design doc](file:///D:/Projects2/InstagramApi/docs/superpowers/specs/2026-10-20-instagram-cli-design.md). Builds on [first-round report](file:///D:/Projects2/InstagramApi/reports/Instagram%20CLI%20automation%20landscape.md).

**Labels.** *verified*: read from a repository file, or a search fragment of one (GitHub). *verified (Context7 copy)*: SDK documentation text returned by Context7, not the live page. *fetch summary*: a WebFetch paraphrase; quoted phrases are the summarising model's wording and were not checked against the live page. *unverified*: anything else, including inferences, which are marked as such.

**Spec versions.** The newest dated revision in the spec repository is 2026-07-28 (verified: folder listing), and its changelog compares it with 2025-11-25 (verified). Spec claims cite repository files at commit 1155ca460e5097019f32769b38dcba194432e2fb. The live spec site was not read; site URLs below are link targets only.

**Effort.** 17 tool calls, two over the researcher guideline, because the 2026-07-28 revision needed extra reads. Not read: the last 22,861 characters of the Claude Code MCP page; the MCP client matrix (the URL returned the intro page); the Slack, email and chat servers; most 2026-07-28 pages (search fragments only for some).

## 1. Which server-to-client mechanisms exist in the current specification

### Takeaway
The current revision, 2026-07-28, has one standard push route for change notifications: `subscriptions/listen`, a long-lived stream that the client opens and opts into by type. Progress and log messages travel only on the response to the request that caused them, logging and sampling are deprecated, and tasks are polled rather than pushed. The revision also removes SSE resumability, so a broken stream loses the in-flight request and nothing is redelivered.

### Cited Findings
- Dated folders in the spec repository are 2024-11-05, 2025-03-26, 2025-06-18, 2025-11-25 and 2026-07-28, plus `draft`; 2026-07-28 is the newest dated folder. [Spec folder](https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/docs/specification) [verified]
- The 2026-07-28 changelog lists changes "since the previous revision, 2025-11-25." [Changelog](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]
- Change notifications (spec 2026-07-28): `subscriptions/listen` is "a single long-lived POST-response stream for opted-in server-to-client change notifications." Clients opt in to `toolsListChanged`, `promptsListChanged`, `resourcesListChanged` and `resourceSubscriptions`; the server tags each notification with `io.modelcontextprotocol/subscriptionId`. It replaces the HTTP GET stream and `resources/subscribe` and `resources/unsubscribe`. [Changelog, major change 4](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]
- Resources (spec 2026-07-28): a server with `listChanged` SHOULD send `notifications/resources/list_changed`. Resource updates arrive as `notifications/resources/updated` on a `subscriptions/listen` stream filtered by `resourceSubscriptions`. The example payload carries `_meta` and `uri` only; the message flow then has the client call `resources/read`. [Resources page](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/server/resources.mdx) [verified]
- Prompts (spec 2026-07-28): a server SHOULD notify clients that opened a `subscriptions/listen` stream with `promptsListChanged: true`. [Prompts page](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/server/prompts.mdx) [verified, search fragment]
- Stream lifecycle (spec 2026-07-28): active `subscriptions/listen` streams "must also be re-established after restart." [Stdio transport](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/basic/transports/stdio.mdx) [verified, search fragment]. A server MUST send `notifications/cancelled` referencing the `subscriptions/listen` request ID when it tears down that stream. [Cancellation](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/basic/patterns/cancellation.mdx) [verified, search fragment]
- Progress (spec 2026-07-28): `notifications/progress` and `notifications/message` "continue to flow on the response stream of the request they relate to, not the `subscriptions/listen` stream." [Changelog, major change 4](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]. The progress page (`/specification/2026-07-28/basic/patterns/progress`) is a link target in the roadmap and was not read. [unverified page content]
- Logging (spec 2026-07-28): `notifications/message` is request-scoped; the server "MUST NOT" deliver it on a `subscriptions/listen` stream or on any stream other than the one carrying that request's response. [Logging](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/server/utilities/logging.mdx) [verified, search fragment]. Logging is deprecated (SEP-2577), with the advice to "log to stderr (stdio) or use OpenTelemetry instead of Logging." [Changelog, Deprecated item 1](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]. `logging/setLevel` is removed; the level is set per request in `_meta`. [Changelog, major change 5](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]
- Sampling and roots (spec 2026-07-28): sampling is deprecated. Roots is deprecated, and `notifications/roots/list_changed` is removed. [Changelog, Deprecated item 1 and major change 5](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]
- Server-initiated requests (spec 2026-07-28): Multi Round-Trip Requests replace server-initiated `roots/list`, `sampling/createMessage` and `elicitation/create`. The server returns an `InputRequiredResult`, and the client retries with `inputResponses`. [Changelog, major change 7](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]. The MRTR page (`/specification/2026-07-28/basic/patterns/mrtr`) was not read. [unverified page content]
- Elicitation (2025-11-25 to 2026-07-28): `notifications/elicitation/complete` and `elicitationId` were introduced in 2025-11-25 and removed in 2026-07-28; the client learns the outcome by retrying the request. [Changelog, minor change 11](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]
- Tasks (spec 2026-07-28): moved out of the core into the extension `io.modelcontextprotocol/tasks`; polling via `tasks/get`, client input via `tasks/update`, and `tasks/list` is removed. [Changelog, major change 6](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]. The extension page (`/extensions/tasks/overview`) is a link target and was not read. [unverified page content]
- Transport (spec 2026-07-28): SSE resumability (`Last-Event-ID`, SSE event IDs) and message redelivery are removed. "A broken response stream loses the in-flight request; clients MUST re-issue it as a new request with a new request ID." [Changelog, major change 9](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]
- Sessions (spec 2026-07-28): `Mcp-Session-Id` and protocol-level sessions are removed, and so is the `initialize` handshake. Each request carries its protocol version and client capabilities in `_meta`. `server/discover` is added. [Changelog, major changes 1 to 3](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]
- Caching (spec 2026-07-28): `ttlMs`, described as "a freshness hint ... allowing clients to cache responses and reduce polling," and `cacheScope` are required on list and read results. [Changelog, minor change 5](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]; the resources page shows both fields. [Resources page](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/server/resources.mdx) [verified]
- Pagination (spec 2026-07-28): the cursor is an opaque string. Page size is the server's choice, and clients "MUST NOT assume a fixed page size." A missing `nextCursor` ends the results (clients SHOULD). Clients MUST treat cursors as opaque; an empty string is a valid cursor. Invalid cursors SHOULD return -32602. [Pagination](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/server/utilities/pagination.mdx) [verified]
- Per-connection state (spec 2026-07-28): `resources/list` "MUST NOT vary per-connection." [Resources page](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/server/resources.mdx) [verified]
- Notification content (spec 2026-07-28): the resources page's Security Considerations cover URI validation, access controls and path sanitising. No size or content limit for notifications was found in the pages read. [Resources page](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/server/resources.mdx) [verified, absence within the pages read]

### Inferences
- The changelog replaces the GET stream with `subscriptions/listen`, so that is the only standard push route for change events in 2026-07-28 (inference).
- The protocol has no acknowledgement and no redelivery, so durable delivery to the owner has to come from the service's own log and a pull (inference).
- Logging and sampling are unsuitable as event channels under this revision: logging is request-scoped and deprecated, and sampling is deprecated (inference).

### Gaps
- Full text was read only for the changelog, resources and pagination pages. The subscriptions, logging, cancellation, stdio, prompts and architecture pages were read as search fragments. The progress, MRTR, tasks-extension and deprecated-registry pages were not read.
- Delivery ordering within a stream, buffering, and content size limits for subscription notifications: not found in the pages read.
- The 2025-11-25 pages were not read. That revision's mechanisms are described only through the changelog's removals.

## 2. What Claude Code and other clients implement and surface

### Takeaway
Claude Code documents refreshes on `list_changed` for tools, prompts and resources, and a research-preview channel path that pushes events into an open session, where Claude receives them as tagged content. Its MCP page, read to 100,000 of 122,861 characters, does not mention resource-update subscriptions, sampling or logging. For other clients the only evidence is one VS Code handler for resource list changes.

### Cited Findings
- "An MCP server can change the tools, prompts, or resources it offers while connected and send a `list_changed` notification." In interactive sessions Claude Code fetches the updated list without a reconnect; in `-p` runs and the Agent SDK it refreshes only the tool list. [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) [fetch summary]
- On the newer protocol revision, Claude Code receives `list_changed` on a stream it holds open. If the stream closes within 10 seconds, it reopens it up to three times, then stops for that connection. After five reopens in an hour, it waits about six hours. Reconnecting from `/mcp` picks up changes sooner. [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) [fetch summary]
- The MCP page text read does not mention resource subscriptions, resource-update notifications, sampling or logging. [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) [fetch summary; partial read]
- Roots: Claude Code answers `roots/list` with its launch directory and any added directories. [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) [fetch summary]
- Elicitation: a call waiting on an open elicitation dialog is not backgrounded while the dialog is open. The linked section "Respond to MCP elicitation requests" was not read. [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) [fetch summary]
- Progress: a call is aborted when the idle window passes with neither a response nor a progress notification. The idle window is five minutes for HTTP, SSE, WebSocket and connector servers, and 30 minutes for stdio. Progress does not extend the per-server hard timeout. For backgrounded calls, the task entry shows the latest reported progress. [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) [fetch summary]
- Revision handling: on the v2 runtime, a channel server that negotiates protocol revision 2026-07-28 cannot deliver channel messages, so Claude Code does not register it as a channel. Stdio servers request 2026-07-28 by default. Setting `MCP_PROTOCOL_NEGOTIATION` to `legacy` keeps servers on the earlier handshake. [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) [fetch summary]
- Channels: a server declares the experimental capability `claude/channel` and sends `notifications/claude/channel` with `content` and `meta`. The model receives a `<channel source="...">` event, and the terminal shows a one-line summary. [Channels reference](https://code.claude.com/docs/en/channels-reference) [fetch summary]
- Channel status: research preview. Auth through claude.ai or a Console API key is required, and channels are not available on Bedrock, Google Cloud's Agent Platform or Microsoft Foundry. Team and Enterprise organisations must enable them; Pro and Max users without an organisation skip those checks. Custom channels are not on the approved allowlist, so they need `--dangerously-load-development-channels`, which shows a warning dialog and is ignored under `-p` or the Agent SDK. [Channels](https://code.claude.com/docs/en/channels); [Channels reference](https://code.claude.com/docs/en/channels-reference) [fetch summary]
- Delivery: events arrive only while the session is open; for always-on use the docs suggest a background process or persistent terminal. Claude Code does not acknowledge notifications. If the channel is not loaded or policy blocks it, events are dropped silently with no error to the server. Queued events are delivered together on the next turn when Claude is busy. [Channels](https://code.claude.com/docs/en/channels); [Channels reference](https://code.claude.com/docs/en/channels-reference) [fetch summary]
- Permission relay: a channel that declares `claude/channel/permission` receives tool-approval prompts. "Anyone who can reply through the channel can approve or deny tool use in your session." [Channels](https://code.claude.com/docs/en/channels) [fetch summary]
- Gating: "An ungated channel is a prompt injection vector." [Channels reference](https://code.claude.com/docs/en/channels-reference) [fetch summary]
- VS Code, `src/vs/workbench/contrib/mcp` (one file matches "list_changed"): handles `notifications/resources/list_changed` and sends `notifications/roots/list_changed`. [mcpServerRequestHandler.ts](https://github.com/microsoft/vscode/blob/01bfb5147e54f6490144e94a3d9f334b8b0a5250/src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts) [verified, search fragment]. The search showed no `notifications/tools/list_changed` or resource-updated handler in that path. That does not prove absence elsewhere.
- The MCP site intro names Claude, ChatGPT, Visual Studio Code, Cursor and MCPJam as supporting MCP, with no feature detail. [MCP site](https://modelcontextprotocol.io/clients) [fetch summary; the URL returned the intro, not the client matrix]

### Inferences
- The stream Claude Code holds for `list_changed` is most likely `subscriptions/listen`, since the changelog replaces the GET stream with it. The docs do not name the method (inference).
- Claude Code may therefore also handle resource subscriptions, but the text read does not say so (inference).
- In the text read, the only documented routes that put a push into the model's context are list refreshes and channel events (inference).
- The roots notification is one the 2026-07-28 changelog removes, so the VS Code code is at least partly from an earlier revision. Its commit date is unknown (inference).

### Gaps
- The last 22,861 characters of the Claude Code MCP page were not read, including the elicitation section it links to.
- Whether Claude Code subscribes to resource updates, and how it shows them, is unconfirmed.
- The client matrix did not load. Claude Desktop, ChatGPT, Cursor and others are not verified.
- Channel behaviour was not tested here, and the channel docs say the feature may change during the preview.

## 3. How existing servers implement event-driven updates

### Takeaway
Only GitHub's official server was checked. Its notification tool is a pull with a time bound, not a push. Slack, email and chat servers and the reference servers were not checked, so no count of polling against notification-based servers is possible.

### Cited Findings
- `github/github-mcp-server` has `list_notifications`, which lists the authenticated user's GitHub notifications. Its parameters include `before` ("Only show notifications updated before the given time (ISO 8601 format)") and `filter`. [README](https://github.com/github/github-mcp-server/blob/e3809fe91c7546633241006bf0b91f23b2595e28/README.md) [verified, search fragment]
- The tool is implemented in `pkg/github/notifications.go`. Its description tells the model to call it for "what to work on next" and similar questions, so it is a pull tool. [notifications.go](https://github.com/github/github-mcp-server/blob/e3809fe91c7546633241006bf0b91f23b2595e28/pkg/github/notifications.go) [verified, search fragment]
- SDK v2 example of a push: `sendResourceUpdated` for 2025-era clients, and `notify.resourceUpdated` on a stateless handler. Clients with a subscription stream for that URI receive `notifications/resources/updated`. [SDK server resources](https://ts.sdk.modelcontextprotocol.io/v2/servers/resources.md); [SDK notifications](https://ts.sdk.modelcontextprotocol.io/v2/servers/notifications.md) [verified (Context7 copy)]
- The same docs warn that behind the stateless legacy fallback, "each POST gets a fresh instance, so no update can be delivered on that posture." [SDK server resources](https://ts.sdk.modelcontextprotocol.io/v2/servers/resources.md) [verified (Context7 copy)]
- Client side: `client.listen({ toolsListChanged: true, resourceSubscriptions: ['config://app'] })` returns the filter the server honoured. On the wrong protocol era, `listen()` and `subscribeResource()` reject with `METHOD_NOT_SUPPORTED_BY_PROTOCOL_VERSION`. [SDK client subscriptions](https://ts.sdk.modelcontextprotocol.io/v2/clients/subscriptions.md); [SDK llms-full](https://ts.sdk.modelcontextprotocol.io/v2/llms-full.txt) [verified (Context7 copy)]

### Inferences
- GitHub's server is a pull with a time bound that a poller could use as a cursor. Whether that bound is stable enough to serve as one is unknown (inference).
- No community server that pushes notifications was identified in this round.

### Gaps
- Slack, email and chat servers: not checked. The named examples remain open.
- `modelcontextprotocol/servers`, including the `everything` reference server: not searched.
- GitHub's server: not searched for emitted MCP notifications, so the absence of pushes is not proven.
- Context7 was queried once, on resource subscriptions. Logging, progress and tasks were not queried.

## 4. What the MCP maintainers recommend for event-driven servers

### Takeaway
The roadmap, last updated 2026-08-22, lists server push, including webhooks, as a deliverable for this period, and says the aim is to avoid relying purely on polling. The shipped 2026-07-28 revision pushes only change lists and resource updates; tasks are polled. No maintainer page read gives a step-by-step pattern for webhook-driven servers.

### Cited Findings
- Under "Agentic Messaging Primitives," the roadmap lists "Server-initiated events" for the Triggers & Events Working Group: "Channels and subscriptions for push delivery, including webhooks." It says that as work becomes asynchronous, "we need extensions that let servers tell clients when work has finished, without relying purely on expensive client-side polling." [MCP roadmap](https://modelcontextprotocol.io/development/roadmap) [fetch summary]
- The roadmap "reflects current thinking rather than firm commitments." [MCP roadmap](https://modelcontextprotocol.io/development/roadmap) [fetch summary]
- The roadmap names `subscriptions/listen`, Tasks and progress notifications as push-related pieces "spread across multiple Working Groups," and says they should "compose." [MCP roadmap](https://modelcontextprotocol.io/development/roadmap) [fetch summary]
- The roadmap says the caching work (`ttlMs` and `cacheScope`, SEP-2549) is meant to reduce polling, with ETag support planned. [MCP roadmap](https://modelcontextprotocol.io/development/roadmap) [fetch summary]
- The changelog advises logging to stderr or OpenTelemetry instead of MCP logging (spec 2026-07-28). [Changelog](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx) [verified]

### Inferences
- The maintainers want push for long-running and event work, but the 2026-07-28 revision pushes only change lists and resource updates, and tasks are polled (inference from the roadmap and changelog).
- The roadmap's "Channels" is not stated to be the same as Claude Code's `claude/channel` capability (unverified).

### Gaps
- The Triggers & Events Working Group page and any webhook SEPs were linked but not read.
- No maintainer guidance specific to webhook receivers was found in the pages read.

## 5. Trade-offs: reliability, latency, client support, security, and disconnected behaviour

### Takeaway
Every push route is best effort. Subscriptions end when a stream breaks or the process restarts, and must be re-established. Claude Code stops reopening its list stream after repeated short failures. Channels drop events silently when not loaded, and custom channels need a development flag during the preview. Only a pull against a log the service keeps is durable. No source read gives latency figures.

### Cited Findings
- Reliability: no redelivery, and a broken stream loses the in-flight request ([changelog, spec 2026-07-28](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/changelog.mdx)) [verified]. Subscriptions must be re-established after restart ([stdio, spec 2026-07-28](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/basic/transports/stdio.mdx)) [verified, search fragment]. Claude Code's reopen limits are in section 2 [fetch summary]. Channels are unacknowledged [fetch summary].
- Latency: no figures in any source read. Interactive list refreshes follow the notification ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)) [fetch summary]. Channel events wait for the next turn when Claude is busy ([Channels reference](https://code.claude.com/docs/en/channels-reference)) [fetch summary]. Progress does not extend the hard timeout ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)) [fetch summary].
- Client support: channels are a Claude Code feature in a research preview ([Channels](https://code.claude.com/docs/en/channels)) [fetch summary]. Claude Code documents list-change refreshes; resource-update support is not documented in the text read. VS Code handles resource list changes ([mcpServerRequestHandler.ts](https://github.com/microsoft/vscode/blob/01bfb5147e54f6490144e94a3d9f334b8b0a5250/src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts)) [verified, search fragment].
- Content: the spec's example `notifications/resources/updated` carries only `uri` and `_meta`, and the client reads contents with `resources/read` afterwards ([Resources page](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/server/resources.mdx)) [verified]. Log messages are request-scoped and deprecated ([Logging](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/1155ca460e5097019f32769b38dcba194432e2fb/docs/specification/2026-07-28/server/utilities/logging.mdx)) [verified, search fragment]. A channel's `content` goes straight into Claude's context inside a tag. `meta` keys must be identifiers, and other keys are silently dropped ([Channels reference](https://code.claude.com/docs/en/channels-reference)) [fetch summary]. Anyone who can reply through a channel can approve tool use if the channel declares permission relay ([Channels](https://code.claude.com/docs/en/channels)) [fetch summary].
- Disconnected behaviour: the design says webhook events are "received while the process runs (best effort, on the owner's machine)" and runs the receiver inside the same process ([design doc](file:///D:/Projects2/InstagramApi/docs/superpowers/specs/2026-10-20-instagram-cli-design.md), Interface and Architecture sections) [verified, local file]. The first-round report records that Meta retries failed deliveries over 36 hours and that webhook history cannot be queried ([Meta webhooks setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup); [Meta webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks)) [fetch summary and verified, as recorded in the first round; not re-checked here]. Claude Code channel events "only arrive while the session is open" ([Channels](https://code.claude.com/docs/en/channels)) [fetch summary].

### Inferences
- If the receiver lives in the stdio process, a gap in sessions longer than the 36-hour retry window loses events for good (inference from the design and first-round facts).
- A pull log keyed by a service-owned cursor is the only route that survives client restarts and gaps in sessions (inference).
- Pushed content is a prompt-injection surface, as pulled content is. The difference is that pushed text enters the model's context without the owner asking for it. Pushes should carry identifiers and counts, not message text (inference; the channel docs' injection warning supports this).

### Gaps
- No latency or throughput figures for any path.
- No delivery test on any client was run here.
- Notification size limits: not found.

## 6. Recommendation for this design

### Takeaway
Keep the pull tools as the primary route for decision P: `ig_events_pending`, `ig_events_ack` and `ig_events_decide`, with the acknowledged cursor kept by the service. Make push optional, and at most a Claude Code channel that carries identifiers and counts, never message text. Do not build resource subscriptions yet, because no verified client surfaces them. Before building, decide whether the webhook receiver runs when no MCP session is open.

### Cited Findings
- None new. The recommendation rests on the findings in sections 1 to 5.

### Inferences (design recommendations, not sourced facts)
1. **Primary path: pull.** The 2026-07-28 revision gives no acknowledgement or redelivery (section 1), subscriptions end on restart (section 1), and channels are unacknowledged and fire-and-forget (section 2). The owner's log and cursor are the only durable route.
2. **Cursor semantics**, following the spec's pagination rules (section 1). The cursor is an opaque string to clients. Internally it is a monotonically increasing sequence number, not a byte offset, because the 30-day purge rewrites the log. A missing `nextCursor` means no more events. An empty string is a valid cursor. An invalid cursor returns a fixed error kind.
3. **Page size:** default 20, maximum 100. This is the design's choice; the spec leaves page size to the server and gives no number.
4. **Acknowledgement.** `ig_events_pending` with no cursor starts from the acknowledged position, so unacknowledged events come back after a crash or disconnect (at-least-once delivery). With a cursor, it pages without moving the acknowledged position. `ig_events_ack(cursor)` moves the position forward only, is idempotent, and refuses a cursor the service has not issued. Each event carries a stable `event_id` as its dedupe key, matching the design's webhook dedupe on message ID.
5. **Response shape.** `{ events: [...], nextCursor? }`. Each event carries `event_id`, type, `conversation_id`, timestamp, and text marked as untrusted data. `ig_status` adds `pending_count` and the acknowledged cursor, so the model can check at the start of a turn without any push. A draft reply from `ig_events_decide` is still outbound and needs `confirm: true` (design decision F).
6. **Retention.** Decide whether the 30-day purge may remove unacknowledged events. The design should keep them, or warn before the purge.
7. **Optional push, in order of value.**
   - (a) A Claude Code channel for owner-opted, interactive sessions only. It pushes `{event_id, type, count}` and a one-line instruction to call `ig_events_pending`, with no message text. Do not declare `claude/channel/permission`, since anyone who can reply through the channel could approve tool use. The server must complete the earlier handshake, which must be checked against the SDK version. It is a research preview and needs the development flag for a custom server. Real-time pushes need a persistent Claude Code session.
   - (b) A resource subscription (`subscriptions/listen`, with `notifications/resources/updated` carrying only a URI). Skip it in the first build: no verified client surfaces it, and it would add a resource capability and re-establishment after restart.
   - (c) Log notifications: no. They are deprecated and request-scoped.
   - (d) Progress on a long-poll tool: not for now. Claude Code's per-call timeout is a hard limit that progress does not extend.
   - (e) Using `notifications/tools/list_changed` as an event flag: no. It misuses the notification and forces tool-list refreshes.
8. **Sender gate for pushes.** Only signature-verified, deduplicated events may be pushed. This matches design decision I and the webhook receiver.
9. **Receiver lifetime.** Choose one. Either run the receiver in a process that outlives the MCP session (for example `ig serve`) and let `ig mcp` read the same store, or accept the gaps described in section 5.
10. **SDK line.** Two packages exist. `@modelcontextprotocol/server` 2.3.1 (Apache-2.0; Node >=20; depends on `zod` ^4.2.0 and `@modelcontextprotocol/core`) is the v2 line that the 2026-07-28 docs describe. `@modelcontextprotocol/sdk` 1.32.1 (MIT; Node >=18) is the older line ([npm manifests](https://registry.npmjs.org/@modelcontextprotocol/server/latest); [npm manifests](https://registry.npmjs.org/@modelcontextprotocol/sdk/latest)) [fetch summary; the manifests carry no publish dates]. The channel reference's samples import `@modelcontextprotocol/sdk/server/index.js`, so they need checking against v2 before use (inference). The design's Node >=22.12 engine satisfies both. Confirm the choice with a spike.

### Gaps
- Latency of each route: unmeasured. Test on the owner's machine.
- Whether Claude Code surfaces resource-update notifications: unconfirmed. Test with a small server.
- Channel plus SDK interoperability (handshake, development flag, v2 imports): untested.
- The page size, the retention interplay and the acknowledgement rule are design choices, not sourced facts.
