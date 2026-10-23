# Instagram automation API and MCP design

- Date: 2026-10-20 (revised after the owner's answers and the research rounds)
- Status: built; live phase pending.
- Research: `reports/Instagram CLI automation landscape.md` (first round) and `reports/Instagram MCP and repo comparison.md` (second round). Facts carry three labels: *verified* (read from a Meta or library page), *fetch summary* (a paraphrase to check against the live page), and *unverified*. No live call has been made.

## Why

The owner wants an Instagram automation service they can connect to, check, and act through. It is a JavaScript package, managed with npm, that exposes the Instagram surfaces as tools, for personal, creator, and business accounts, without abuse.

## Interface

- The product runs as one long-running service, `ig serve`, and as an MCP server, `ig mcp`, which forwards every tool call to that service. Setup commands are the only other CLI.
- `ig serve` runs the local HTTP API on `127.0.0.1`, a poller that reads new messages, the event log, and token checks. The webhook receiver is built and tested, but not served until the owner sets up a public endpoint.
- The MCP server and the HTTP API expose the same tools.

## Goals

1. Cover every surface the research lists, for personal, creator, and business accounts.
2. Official routes first. Unofficial routes for personal accounts and for surfaces with no official route.
3. Keep a pull log of new messages and replies, let the owner or the MCP client decide what to do, and check unread conversations and messages.
4. Support both Instagram Login and Facebook Login, each used for what it covers.
5. Owner-only. One owner account is configured.
6. Reuse code only after reading it and checking its license. The transport is written fresh.
7. Keep the owner's account safe: caps, confirmations, fail-closed behaviour, and an audit log.

## Non-goals, for now

- More than one owner account, or sharing access with anyone.
- Facebook Pages beyond the one linked to the owner's Instagram account.
- The Marketing (ads) API and Threads. Both are separate APIs.
- Publishing to npm. Use is local.

## Anti-goals: not built, even where reachable

- Unsolicited DMs, including a DM triggered by a follow, like, or comment.
- Bulk or discovery-driven likes, follows, unfollows, or comments.
- Comments on other people's posts. The owner declined them.
- Scraping, or bulk download of, other people's data or media.
- Anything that hides the owner's activity from the people it affects (stealth story viewing, hidden typing or read receipts), or that evades Meta's detection or enforcement. That includes automated challenge solving, proxy rotation, and any device or fingerprint change of our own. The unofficial libraries send their default app or browser identity as shipped. The project adds no identity of its own.
- Storing other people's credentials, sharing the owner's, or using fake-engagement services.

## Decisions from the owner

1. Official and unofficial routes both. A JavaScript library and a Python sidecar running instagrapi were both accepted for the unofficial route. The JavaScript libraries are unmaintained, so the sidecar is the unofficial route in practice.
2. Options for each account type. Business and Creator: official, with optional unofficial extras. Personal: unofficial only, because the official API does not serve personal accounts.
3. The product runs only as a service with an MCP server and an HTTP API, so everything can be checked and done through them.
4. Messages: signals and tools that let the owner decide, and checks for unread conversations and messages. Auto-replies are an optional rule set, off by default.
5. Likes and follows on named targets: yes, one at a time, within caps. Comments on other people's posts: no.
6. No second test account yet. Build first, investigate, compare with existing tools, then improve.
7. Stack, as recommended: ESM JavaScript; commander 15.0.0 for setup commands; built-in `fetch` with a retry helper the project owns; `@napi-rs/keyring`, with an environment variable read first; `node:test`; `node:http`. Engines `>=22.12.0`; CI on Node 22, 24, and 26.
8. Inbound messages: poll the official conversations list now. No public endpoint is set up. The webhook receiver stays built but unserved, and a reverse proxy the owner runs can be added later for real-time delivery.
9. Device identity: reading (a). The project adds no device or fingerprint change of its own, and the library default identity is used as shipped.
10. App secret: stays on the owner's machine. Meta's Business Login page says the token exchange must run in server-side code, because it includes the app secret. This deviation is recorded under the risks.
11. Execution: subagent-driven build, with haiku subagents only.

## Calls I made (changeable)

A. **Route per feature.** Official first. An unofficial route is used only for a surface with no official route, or for personal accounts. It sits behind a config switch, and a warning is shown once and must be acknowledged.

B. **Unofficial adapter: instagrapi sidecar.** It is a Python child process speaking JSON lines over stdio. It is pinned to a release after the 3.0.0 login break, chosen at execution after its CHANGELOG and LICENSE are read. Its challenge-resolver code is not used. Any challenge fails closed.

C. **Own a thin client over the Graph API.** instagram-graph-api-lib is not adopted, because its request layer has no timeout, retry, or status check, and it puts the token in the query string. The Instagram Login client in felipeequaresma's SDK is read for endpoint names only.

D. **Third-party code is read before use.** Versions are pinned, licenses are checked, and no install script runs unreviewed. Meta's SDK licences are read before any code is reused.

E. **Auto-replies** cover DMs only, use owner-written keyword rules, and are off by default. A reply needs an open 24-hour window.

F. **Confirmation.** Every outbound tool takes `confirm`. Without it, the tool returns a preview. `ig_events_decide` records a decision and an optional draft, and it never sends. Sending is `ig_dm_send` with `confirm`.

G. **Fail closed.** These codes stop outbound actions for the account: error 190 (`AUTH_EXPIRED`); a checkpoint, challenge, or two-factor requirement (`CHECKPOINT`); error 368 or feedback required (`ACTION_BLOCKED`); HTTP 429, or Graph codes 4, 17, 32, 613 and 80002 (`RATE_LIMITED`). Code 80002's subcode is unknown, so every 80002 counts as a rate limit. Only `ig_stop_clear` with `confirm` resumes outbound actions. A read that returns CHECKPOINT, ACTION_BLOCKED or RATE_LIMITED sets the same stop; AUTH_EXPIRED on a read does not (the owner to confirm).

H. **Credentials.** Official tokens are kept in the OS credential store through `@napi-rs/keyring`, with an environment variable read first. The unofficial password is never stored. Sidecar session state is kept only in the credential store. Tokens never reach files or logs. The spike tests the Windows keyring binding before any token is stored, and picks another store if it fails.

I. **App secret stays local** (decision 10).

J. **Message text is kept for 30 days,** so the owner can decide what to do. Conversation keys and timestamps are always kept. The purge removes only handled events older than 30 days. Pending events are kept until they are acknowledged and decided.

K. **Facebook Login.** `ig auth facebook` stores a Facebook token. The features that need it (post deletion, hashtag search, business discovery, product tags, partnership ads) report `ROUTE_DISABLED` until a token exists. Likes use Instagram Login by default. A live test can change that setting.

L. **Repository.** The project is not a git repository. Files are written, and nothing is committed without the owner's request.

M. **App mode.** The Meta app stays in Development mode, for the owner's account. App Review is requested only if the spike shows it is needed.

N. **Publishing input.** Images use `image_url`, and videos use `video_url`. The "Upload Media (IG Login)" page is read in the spike. If Instagram Login accepts only public URLs, the owner chooses a host before publishing works. Build decision (owner decision O-13, 2026-10-22): the owner runs a public HTTPS host. The service reads media only from a configured folder (`media.dir`), builds the URL from `media.publicBaseUrl`, refuses path traversal, and checks the URL with a HEAD request (a one-byte GET is the fallback) before publishing. Image stories are behind `story.images` (default off, until the spike runs). No upload route is implemented.

O. **Lookups.** Business discovery, mentioned-media reads and hashtag search are single, on-demand lookups. Hashtag searches are capped at 30 unique hashtags per 7 days. Business discovery and mentioned-media lookups each have a daily bucket of 50 (owner decision O-4). The lookups count toward their own bucket only, not toward the outbound spacing or the 200-a-day total.

P. **Event signalling.** `ig_events_pending` returns unacknowledged events with an opaque cursor. `ig_events_ack` advances the cursor and refuses any cursor that has not been issued. The cursor never moves backwards, with one owner-decided exception: after a state loss, a confirmed `ig_stop_clear` starts the cursors at zero, so acknowledged events are delivered again with the same ids, and the consumer dedupes by id (see the README, "Recovery from a damaged state file"). Push notifications stay optional and later, because channels are a research preview.

Q. **Unread.** Tracked locally from inbound events, with a read marker set by `ig_dm_mark_read` or by the owner's own reply. Whether the API exposes unread state is checked in the spike.

R. **Busy, not queued.** Spacing and cap limits return `{ busy: true, retryAfterMs, reason }`. Nothing waits in a queue to run later, so the client decides when to retry.

S. **Usage throttle.** When the usage header shows `total_time` or `total_cputime` at 80 or more, outbound calls return busy for 60 seconds. The header is verified in the spike.

T. **Comment operations.** Reply, hide, and delete are refused unless the parent media belongs to the owner.

U. **Tool annotations.** Every MCP tool carries `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`.

V. **Event text is untrusted data.** Every tool result that carries event text marks it `untrusted`.

## Caps (starting values; the owner changes them in config)

| Action | Cap |
|---|---|
| Any outbound action | at least 2 seconds apart; at most 200 per day in total |
| Likes | 10 per hour; 50 per day |
| Follows and unfollows | 20 per day, each |
| Owner-sent DMs | 50 per day, with private replies counted toward it (the owner to confirm) |
| Private replies | one per comment, within 7 days of the comment |
| Auto-replies (when enabled) | 1 per conversation per 24 hours; 100 per day |
| Hashtag searches | 30 unique hashtags per 7 days |
| Business discovery lookups | 50 per day (added, owner decision O-4) |
| Mentioned-media lookups | 50 per day (added, owner decision O-4) |
| Publishing | the quota read from `content_publishing_limit` at runtime, with `since` set to 24 hours ago; at most 10 per day locally |

The research gives the like limit as more than 50 requests in 5 seconds, which locks the user out for an hour (fetch summary). The caps sit well below that.

## Account types and routes

| Account type | Official route | Unofficial route | Options offered |
|---|---|---|---|
| Business | Yes, both logins | Optional extras | Official only; official plus unofficial |
| Creator | Yes, both logins | Optional extras | Official only; official plus unofficial |
| Personal | No (the official API does not serve personal accounts) | Yes | Unofficial only |

## Surfaces and routes

The matrix comes from the research report. "Unknown" means the research did not map it.

| Surface | Official route | Unofficial route | Plan |
|---|---|---|---|
| Profile read | Yes | — | Build |
| Profile edit (bio, name, picture) | No | Unknown | Build, off by default; enabled after the sidecar spike |
| Publish post, carousel, Reel, story video | Yes (container, then publish); input method pending the spike (decision N) | — | Build; read the quota first |
| Publish story image | Unconfirmed | Unknown | Build only if the spike confirms it |
| Edit caption | No | Unknown | Later |
| Delete post | Partial (stories, Reels, whole carousels); Facebook Login only; method DELETE or POST is unresolved | Unknown | Build, with Facebook Login, after a test |
| Like and unlike | Yes from April 22, 2026 (fetch summary); login product unconfirmed | — | Build; Instagram Login by default; a live test can change it |
| Follow and unfollow | No documented endpoint (inferred from absence) | Unknown | Build, off by default; owner-named, capped |
| Comments: read, reply, hide, delete | Yes (delete rule conflicts in the sources) | — | Build; owner-media check (Call T) |
| Mentions | Yes, `mentioned_media` (Tool `ig_mentioned_media`) | — | Build, read only |
| Hashtag search | Facebook Login only; 30 unique hashtags per 7 days | — | Build, single lookups |
| Business discovery | Facebook Login only | — | Build, single lookups |
| Account and media insights | Yes; some metrics need 100 or more followers; data can lag up to 48 hours | — | Build; allowlisted metrics only |
| Story insights | Yes; `total_views` is Facebook Login only; data kept 24 hours | — | Build |
| Product tags, partnership ads, collaborative media, audio library | Partial; Facebook Login only | Unknown | Later |
| Live | Read only during a broadcast (Facebook Login scopes listed) | Unknown | Later |
| DM list, read, send | Yes, inside the 24-hour window; reads cover the 20 most recent messages | Unknown | Build |
| First message to someone who never messaged | No, except one private reply per comment within 7 days | — | Build, private reply only |
| Notifications, close friends, blocks, restrictions, archive, highlights, saved | Unknown | Unknown | Map in the spike |
| Stealth viewing, hidden receipts | — | — | Anti-goal |

## Tools (MCP, and the same operations over HTTP)

- **Status and admin:** `ig_status`, `ig_caps_status`, `ig_stop_status`, `ig_stop_clear` (confirm), `ig_token_status`, `ig_token_refresh`, `ig_autoreply_set` (confirm), `ig_events_purge`.
- **Read:** `ig_profile_get`, `ig_media_list`, `ig_media_get`, `ig_insights_account`, `ig_insights_media`, `ig_mentioned_media`, `ig_comments_list`, `ig_dm_conversations`, `ig_dm_messages`, `ig_dm_unread`, `ig_dm_mark_read` (not read-only), `ig_hashtag_search` (not read-only), `ig_business_discovery`.
  - Note: `ig_dm_mark_read` writes a local read marker, and `ig_hashtag_search` counts each call toward the hashtag cap. Both are annotated `readOnlyHint: false`, as every tool that writes is. The other tools in this list are read-only.
- **Events:** `ig_events_pending`, `ig_events_ack`, `ig_events_decide`.
- **Outbound** (each takes `confirm`): `ig_publish_media`, `ig_comment_reply`, `ig_comment_hide`, `ig_comment_delete`, `ig_like`, `ig_unlike`, `ig_dm_send`, `ig_private_reply`, `ig_media_delete`.
- **Unofficial, gated, off by default** (each takes `confirm`): `ig_follow`, `ig_unfollow`, `ig_profile_edit`.

## Architecture (responsibilities, not files)

- **`ig serve`, the long-running service.** The local HTTP API on `127.0.0.1:8788`, with `/health`, the tool routes, and the webhook path (answering 404 unless the webhook is enabled). The poller. The event log and state. Hourly token checks.
- **`ig mcp`, the MCP server.** A stdio server that forwards each tool call to `ig serve` with the bearer token. When the service is not running, it returns a clear error. It holds no state of its own.
- **Poller.** Every 60 seconds, it lists the owner's conversations with `updated_time`, reads up to 20 changed threads, records inbound messages, dedupes by message ID, backs off on rate limits, and halts on AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, STATE_CORRUPT and STATE_LOST (a RATE_LIMITED stop backs it off and does not halt it). It spaces its calls at least 600 ms apart, to stay under the 2-per-second conversation limit.
- **Webhook receiver.** Answers the verification handshake, checks `X-Hub-Signature-256`, dedupes, and parses message, comment, and mention events. It is mounted at `/webhooks/instagram`, and it stays off unless `webhook.enabled` is set. It refuses to start without the app secret and the verify token.
- **Event store.** An append-only JSONL log and a state file, written atomically, with the cursor and purge rules in Call J and Call P.
- **Official provider.** A thin client that the project owns, with one module per surface group.
- **Unofficial provider.** The instagrapi sidecar, behind an adapter registry.
- **Setup commands.** `ig auth set <name>`, `ig auth login` (Instagram Login), `ig auth facebook` (Facebook Login), `ig routes ack-unofficial --confirm`, `ig routes clear-one-reply-flag --confirm`, `ig serve`, `ig mcp`, and `ig status`.

## Phases

**Build phase (now).** Everything above, tested on fake transports, with no live calls.

**Live phase (once the owner has a test account and gives the go-ahead).** Verify on the test account: the token flow and its transport, the localhost redirect, the scope separator, the likes login product, the publish input, unread state, mark-as-read, the poll and send round trip, the usage header, the Windows keyring binding, and the Facebook Login setup. The sidecar runs against the live account only after the owner accepts that risk, and only with its challenge handling failing closed.

**Later, if wanted.** A reverse proxy the owner runs, to serve the webhook for real-time delivery. Push notifications through a client channel, once a stable client supports them.

## Acceptance for the build phase

- Tests pass for: caps, busy results, confirmation, the owner check, the stop codes, the event store (cursor, purge, untrusted marking), the poller (dedupe, backoff, auth stop), the webhook (handshake, signature, dedupe, refusal without secrets), the Graph client (headers, retries, usage throttle), the endpoints on fixtures, MCP annotations, HTTP (loopback refusal, token), and the setup commands.
- No live call has been made. Every Meta fact stays marked until the live phase checks it.

## Risks the owner accepts

- Unofficial routes likely breach Instagram's Terms of Use. The Terms could not be read in research. The account can be restricted or banned, possibly without notice.
- The unofficial libraries present an app or browser identity to Instagram. The project adds none of its own.
- The app secret and tokens live on this machine. Meta's Business Login page says the token exchange must run in server-side code. The exchange runs here instead, and the owner accepts that deviation.
- Message text is stored locally for 30 days. Meta's Developer Policies allow message data to be used only as reasonably necessary for the message types (verified), and the owner accepts the trade-off.
- Likes and follows on named targets may fall in the policy's prohibited tier (judgment). The owner accepts that.
- Automated DM replies at volume are in the policy's gray tier. The caps limit them, but the rule gives no numeric threshold.
- Polling delays inbound messages. Real-time delivery needs a public endpoint.
- Many Meta facts come from fetched summaries. The live phase verifies the facts the build depends on.

## Open items

- A test account, for the live phase. The owner has not got one yet.
- The owner's own account type, needed for the first live test.
- The spike items in the live phase, listed above.
- The deeper research's open questions, which the report lists in its Tables 8, 9 and 11.
