# Keep the pull log, rewrite the transport

The owner's design is more controlled than every project the notes read, and the research supports keeping its core: a pull event log with acknowledgement, a stop state that only an explicit call clears, local caps, a 24-hour messaging guard and an owner check. No sampled MCP server combined those features, though most of the roughly 60 repositories were read at README level, so that absence is unverified as a survey ([MCP comparison](file:///D:/Projects2/InstagramApi/research_notes/Instagram%20MCP%20and%20repo%20comparison/mcp_server_comparison.md)). The request layer is the weak point: the first round's recommended library, instagram-graph-api-lib, puts the token in the query string, sets no timeout, retries nothing and checks no HTTP status (verified), so the design's decision not to adopt it before its code is read (Call C) is right. The closest Instagram Login client retries POST, writes tokens to a plaintext file by default and has a refresh timer that overflows for 60-day tokens (verified), so the transport and token handling must be written fresh. Event signalling points the same way: the 2026-07-28 MCP revision has no redelivery, and a broken stream loses its in-flight request (verified), while Claude Code's channel feature is a research preview that drops events silently when no channel is loaded (fetch summary), so pull stays primary and push stays optional. The biggest open structural question is where the webhook receiver runs. The plan binds it to 127.0.0.1 by default (verified), and Meta requires a valid TLS endpoint that no note shows how to reach (verified (Context7 copy)). Hosted services fail the owner's rules, and the notes cannot settle whether a vendor API key counts as a credential. The spec and plan also disagree on tool names, the stop and token tools, the private-reply tool and the SDK package, and several facts the build relies on remain unverified.

*Labels follow the notes. Verified means read from a repository file, a Meta or Node page, a registry response or a search fragment of one. Verified (Context7 copy) means a Context7 snapshot of a page. Fetch summary means a WebFetch paraphrase whose quotes need checking on the live page. Unverified covers snippets, unread pages, vendor claims and inferences, and inferences are tagged as such. No label is raised above what a note gives.*

## Usable endpoints sit on unusable transports

The first round's recommendation does not survive the source read. instagram-graph-api-lib targets graph.facebook.com with a Page ID, sends the token as a query parameter, sets no timeout, retries nothing, checks no status and has no webhook code (verified), and its retry package appears only in devDependencies (verified). Its publishing builders take `imageUrl` and `videoUrl`, which matches the design's public-URL input in decision N (verified), and its content-publishing limit request is a usable quota read (verified). felipeequaresma's SDK is the only read client for Instagram Login, so it is the nearest reference for those endpoints. It sets a 30-second timeout and maps Graph codes 4, 17 and 32 to rate-limit errors (verified), but one helper wraps get, post and delete alike, so **POST is retried** (verified). It also writes request parameters that include the access token to debug logs (verified; the default logger level is unverified). Its refresh timer delay overflows for 60-day tokens (verified arithmetic on verified code), and the Node.js rule for out-of-range delays is a fetch summary. The effect, that refresh fires after one millisecond, is an inference from that code.

Among the Meta and felipe webhook code read, Meta's messenger sample alone compares signatures in constant time (verified), but it defaults APP_SECRET and VERIFY_TOKEN to empty strings and posts "Lovely post!" to feed posts through the comments edge (verified). It is useful for check order and test fixtures, and it should not be copied for behaviour. Meta's Python business SDK applies a timeout only when one is passed and retries only failed batch sub-requests (verified, grep fragments), and it is a Marketing API client, not a content client (first round). The personal-account libraries split the other way. instagrapi is the only active one, with release 3.0.26 on 2026-10-17 (first round, verified metadata). Its CHANGELOG records an Android app profile and device-configuration entries (verified text), it ships a challenge resolver example (verified listing), and its 3.0.24 challenge-flow option is recorded with its details withheld (verified that the entry exists). instagram-private-api last changed on 2024-03-07, jlobos on 2020-08-06 and instagram_mqtt on 2024-04-23 (verified), and the consumer instagram-cli imports the first and third (verified).

**Table 1. Request layers and libraries read at source level**

| Project | Host and login | Timeout, retry and status | Token and secrets | Webhook | Use for the design |
|---|---|---|---|---|---|
| instagram-graph-api-lib, MIT, v7.0.0 | graph.facebook.com; Page ID and Page token (verified) | No timeout, no retry, no status check (verified) | Token in query string; fb_exchange_token only (verified) | None; README says not covered (verified) | Borrow endpoint names, publishing builders and quota read; do not use its request layer |
| felipeequaresma SDK, MIT, 1.0.4 | graph.instagram.com; default v21.0 (verified); npm published 2026-06-07 (fetch summary) | 30 s timeout; retries get, post and delete (verified) | Token in query string; plaintext ./tokens.json by default (verified) | Plain-equality check; dedupes on timestamp and sender (verified) | Borrow Instagram Login endpoints and the code-exchange form POST; replace retry, storage and scheduler |
| Meta messenger sample (Python) | graph.facebook.com, unversioned; page token in the URL (verified) | No timeout on requests.post (verified) | Empty-string defaults for APP_SECRET and VERIFY_TOKEN (verified) | Constant-time compare over raw bytes (verified); auto-comments on feed posts (verified) | Borrow check order and fixtures; drop the auto-comment and the defaults |
| Meta Python business SDK | Marketing API (first round) | Timeout only if passed; batch-only retry (verified) | Not checked | None | Not a content client |
| instagrapi (sidecar candidate) | Private API; CAA login since 3.0.0 (verified text) | Not checked in the notes | Session file format unread (first round gap) | None | Sidecar only if the device and challenge rules allow it |
| instagram-private-api; jlobos; instagram_mqtt | Private, web and MQTT routes; last changes 2024-03-07, 2020-08-06, 2024-04-23 (verified) | Not checked in the notes | jlobos passes account credentials to its CI test step (inference from verified config) | None in these three; realtime is MQTT (verified) | Stale; use only as a reference for the stub |

The design should take endpoint names, the handshake order, the container-then-publish sequence and the error-class names from these clients, but not their transports. felipe's helper could be adapted to honour Retry-After and to retry GET only, which the notes describe as judgment on verified code.

## IvanBBaev's write gate is the closest MCP model

Among MCP servers, IvanBBaev/instagram-mcp is closest to the design. It exposes 29 official Graph tools and no DM tools. Every mutation passes a preview-by-default gate that needs `apply: true`, deletes need a second flag, and every tool carries MCP annotations (verified). It binds loopback by default, refuses a non-loopback bind without a token, masks secrets before log sinks, and builds on the v2 split SDK packages with zod 4 (verified). Its doctor command and token-status tool match what the design's `ig_status` and token needs. adelaidasofia/instagram-mcp adds an output scrubber, a four-field JSONL audit line and egress pinned to two Meta hosts, and it fails DM tools loudly until an environment flag is set after App Review (verified). alexfisenkov/meta-instagram-mcp requires `confirm` plus an environment flag before any network call (fetch summary), although its About text says read-only (fetch summary). pendpost is a multi-network scheduler rather than an Instagram tool, but its breaker on Meta error 368 never auto-resumes, and its cadence cap defers bursts instead of discarding them (fetch summary). inssist drives the user's signed-in Chrome through an extension and returns `busy` with a retry hint when a call would wait past about 50 seconds (fetch summary). It is an unofficial route that the design does not use.

The sample also shows patterns to avoid. jlbadano's README puts access tokens in URL query strings and sets `LOG_LEVEL=DEBUG` (verified). trypeggy keeps the password in `.env` and passes `--password` in a client config (fetch summary). KynuxDev keeps three session cookies in a client config env block (verified), and AleemHaider's curl example passes `client_secret` with `-G`, which places it in the URL (verified). Shudesu runs its Meta webhook receiver on Cloudflare Workers, with a multi-secret signature check and a health endpoint that reports token days left (fetch summary). It also stores follower profiles and images in D1 and R2 (fetch summary), a third-party custody pattern the design avoids (inference).

Set against the sample, the design's distinct features are the pull log with acknowledgement, the stop state with an explicit clear, per-action caps, the 24-hour guard and the owner check. The notes found no sampled server with all of them, but that is an absence across about 60 repositories, most read at README level, so it stays unverified as a survey. The design lacks several patterns the sample shows working: a preview journal with a second gate for destructive calls, MCP annotations, the loopback refusal, output scrubbing, deferral instead of refusal, a distinct exit code for a dead token (William-Gao, fetch summary) and a throttle driven by usage headers (mikusnuz and exileum, fetch summary). Section 4 turns these into specific changes.

**Table 2. Closest MCP servers, read at README or source level where marked**

| Server | Access and surface | Overlap with the design | Difference or risk |
|---|---|---|---|
| IvanBBaev/instagram-mcp (verified) | Official Graph; 29 tools; no DM tools; ig-login or fb-login modes | Preview gate; loopback default; doctor and token status; annotations | Counts conflict (28 in GitHub description, 29 in README); no event or cap model |
| adelaidasofia/instagram-mcp (verified) | Official Graph; 29 tools; DM tools behind an environment flag | Output scrubber; audit line; egress pinned; DM gate | "Official" label not backed by any Meta affiliation in the sources (unverified); no stop state or caps |
| alexfisenkov/meta-instagram-mcp (fetch summary) | 22 tools; About says read-only but lists meta_publish_media | Double gate: confirm and environment flag, checked before any network call | README and tool list conflict |
| mikusnuz/meta-mcp and exileum/meta-mcp (fetch summary) | Instagram plus Threads; 57 to 66 tools; webhook subscription tools; no event read | Error taxonomy with remediation; usage throttle; retries that honour Retry-After | Counts and API version conflict; exileum allows 0.0.0.0 with no server auth |
| pendpost (fetch summary) | Multi-network scheduler; approval queue | Fail-closed approval; breaker that never auto-resumes; deferral | Not Instagram-only; its Meta error 368 mapping is its own |
| inssist (fetch summary) | Chrome-extension bridge; no Graph client | Per-account queue with busy and retryAfterMs; 0600 pairing file | Unofficial route; outside the design |
| Shudesu/ig-harness-oss (fetch summary) | Meta webhooks to a Cloudflare Worker; automated DMs | Multi-secret signature rotation; health checks for token and webhook | Hosted custody; automated DMs are an anti-goal |
| jlbadano, trypeggy, KynuxDev, AleemHaider (verified or fetch summary) | Token, password or cookies in config or URLs | KynuxDev's pagination parameter and max_pages (verified) | Credentials in URLs, logs or config; avoid these patterns |

## Hosted services fail the owner's rules either way

Vendor services divide by what they ask for, and each one fails a rule on some reading. HasData needs only a HasData key, sent as an `x-api-key` header (verified). Its server returns public profiles, 12 posts per call with paging, and comments on public posts (verified). Its README says every question it answers is about a handle the owner does not own (verified; the vendor's own words), and each result links to a stored copy of that exact call with no retention period given (verified). StoriesIG needs no Instagram login, but it signs the user in to StoriesIG through OAuth (verified). Its twelve tools return other accounts' followers, likers, stories and highlights, and video downloads in every quality with no watermark (verified). Apify's instagram-scraper page shows no Instagram credential field, but its MCP server uses Apify OAuth or an Apify API token (fetch summary), and the actor is a per-result scraper of public data (fetch summary). Phyllo asks the creator to type the Instagram password into Meta's OAuth screen, then says it receives the authorization token and manages refreshes (fetch summary), which places a live Meta token with a third party. Phantombuster's snippets describe a session-cookie field (unverified), and RapidAPI listings were not evaluated (fetch summary).

The notes rank the credential risk from the top down: an Instagram password, then a session cookie that is effectively the login (judgment), then a vendor-held Meta token the vendor can use until it is revoked (judgment), then a vendor API key that exposes billing and query history (judgment). The design's own Meta token sits in the OS credential store (decision H, verified in the local spec). The notes could not confirm how the keyring binding behaves on Windows, because its README documents only Linux backend selection (unverified; the first round listed the same gap). The custody claim therefore rests on a binding that no note has run.

The rule's reach decides the verdict. If "credentials" covers vendor API keys, HasData, StoriesIG and Apify fail it. If it covers only Instagram credentials, those three pass it and fail the no-scraping rule instead, because they return other people's public data. The notes leave that choice to the owner (judgment). On terms, the Instagram Terms clause on automated collection appears only in a search snippet (unverified), because the live help page returned navigation text. Meta's Platform Terms bar apps from separately collecting users' login credentials and from reverse engineering (verified, first round). StoriesIG's terms bar "any automated or non-automated 'scraping' methods" against its service and say nothing about Instagram's terms (fetch summary), and its privacy policy gives no retention period (fetch summary). Apify's privacy policy gives no retention period for run data, datasets or logs (fetch summary). Retention is the weakest area across the set.

The one complement the notes keep is reference reading. HasData's repository is MIT per its README badge, and it reports failures inside a successful MCP result with `isError` set to `true` (verified). Its contract tests run on every push (verified). Those could inform the design's MCP error mapping and tool-contract tests, but the LICENSE file was not read, and design decision D requires reading it first (inference).

**Table 3. Hosted services and the owner's baseline against the two rules**

| Service | Asks for | Data scope | Retention and terms | Verdict |
|---|---|---|---|---|
| HasData (MIT per README badge) | HasData API key in `x-api-key` (verified) | Public profiles, posts and comments (verified) | Stored artifact per call, no period stated (verified); terms not read | Fails the no-scraping rule; passes the credential rule only if vendor keys are not credentials |
| StoriesIG | OAuth sign-in to StoriesIG; no Instagram login (verified) | Other accounts' followers, likers and stories; no-watermark downloads (verified) | No retention period; sharing with partners (fetch summary) | Fails the no-scraping rule outright; the account OAuth creates is unknown |
| Apify instagram-scraper | Apify OAuth or API token (fetch summary) | Public posts, reels, comments, profiles, hashtag stats (fetch summary) | No period for run data or logs (fetch summary) | Fails the no-scraping rule; reach of the token beyond Apify is unstated |
| Phyllo | Creator's Instagram password typed into Meta's OAuth screen; vendor receives the token (fetch summary) | Connected creators' insights and audience data (fetch summary) | No retention or deletion statement on the page (fetch summary) | Fails the credential rule |
| Phantombuster | Session cookies, per snippets (unverified) | Instagram automations, including likes (unverified) | Terms not read | Unresolved; fails the credential rule on the snippets |
| RapidAPI Instagram listings | Unknown (unverified) | Snippets describe third-party scrapers (unverified) | Not read | Not evaluated |
| Baseline: the owner's own Meta app | Owner logs in to Meta once; token kept in the OS credential store (verified, local spec) | Owner's account only (first round) | Platform Terms and Developer Policies (verified, first round) | The route the design uses |

## Pull beats push on every route the notes tested

The notes map seven routes by which an outside event can reach the owner's process. Each one fails in a different way, and Table 4 sets them side by side.

**Table 4. Event routes compared**

| Route | Delivery and durability | Client surfacing | Fit for the design |
|---|---|---|---|
| MCP `subscriptions/listen` (spec 2026-07-28) | One opt-in stream for list changes and resource updates; no redelivery; streams must be re-established after restart (verified) | If the list stream closes within 10 seconds, Claude Code reopens it up to three times (fetch summary); resource-update surfacing is unconfirmed (unverified) | Skip resource subscriptions in the first build |
| MCP progress and log notifications | Request-scoped; logging is deprecated (verified) | Not checked | Do not use for events |
| MCP tasks extension | Polled through `tasks/get`; the extension page was not read (verified; unverified) | Not checked | Not for inbound events |
| Claude Code channels (research preview) | Unacknowledged; dropped silently when not loaded (fetch summary) | Events enter the model's context as tagged content (fetch summary) | Optional push of identifiers and counts only; no permission relay |
| Meta webhooks | Retried over 36 hours; duplicates possible (fetch summary); no history query (verified (Context7 copy)) | Not applicable | The receiver must persist each delivery before it answers |
| Conversations list polling | `updated_time` per thread; 2 calls per second; no cursor or `since` filter (verified (Context7 copy)) | Not applicable | Fallback only; message detail reaches only the 20 newest messages |
| GitHub `list_notifications` | Pull with a `before` time bound (verified, search fragment) | Called by the model on request | A pull with a time bound; stability as a cursor is unknown (inference) |

Pull is the only route the notes can call durable. They infer that a pull log keyed by a service-owned cursor is the only route that survives client restarts and gaps in sessions (inference). The event-signalling note recommends pull as primary, push optional, and no resource subscriptions until a client surfaces them (inference from its sources). Design Call P already takes that position, so the research supports it. The notes also say that a receiver living only inside a stdio process loses events for good in any session gap longer than the 36-hour retry window (inference from the spec and first-round facts). The spec says webhook events are received "while the process runs (best effort)" (verified, local spec). The owner should accept that gap in writing, or move the receiver into a process that outlives the MCP session.

Latency is unmeasured on every route. No source in the notes gives a figure for any push path, and the Claude Code docs say channel events wait for the next turn when Claude is busy (fetch summary). The owner should measure each route on the owner's machine before choosing a default. The VS Code client handles resource list changes and sends roots list changes (verified, search fragment), but the search found no tools `list_changed` handler in that path. The roots notification is one that the 2026-07-28 revision removes, so that code predates the current revision (inference).

## Changes to make before the build, each tied to a section

Each change below names the spec or plan section it touches and its basis. Where a change is the notes' own recommendation, or an inference from their facts, the basis column says so.

**Table 5. Changes ordered by where they land in the design**

| # | Change | Spec or plan section | Basis and label |
|---|---|---|---|
| 1 | Name the process that runs the webhook receiver, and say how Meta reaches it | Spec Interface and Architecture; plan Global Constraints and Task 16 | Spec says events arrive "while the process runs"; the plan runs the receiver under `serve`, not `mcp`, and binds it to 127.0.0.1. TLS rule verified (Context7 copy); no tunnel named (unverified) |
| 2 | Serve the webhook and the HTTP API from one listener, or document why there are two | Spec Architecture (`/webhooks/instagram` on the HTTP API); plan Tasks 10, 14 and 16 | The plan starts a separate webhook server on port 8787 and also routes the webhook path in the HTTP handler (verified, plan text) |
| 3 | Give pending events an opaque cursor with `nextCursor`; make `ack` refuse any cursor not yet issued | Spec P; plan Tasks 3 and 12 | Spec 2026-07-28 pagination rules verified; the cursor design is the notes' recommendation (inference). The plan's `ack` accepts any seq, so a client could skip events (inference) |
| 4 | Keep unacknowledged and undecided events through the 30-day purge, or warn before the purge removes them | Spec J and retention; plan Task 3 purge test | Notes' recommendation 6 (inference). The plan's purge test removes everything older than `retentionDays` |
| 5 | Mark event text as untrusted data in each tool result, and keep it out of any push | Spec J; plan Task 12 | Channel injection warning (fetch summary); notes' recommendation 5 (inference) |
| 6 | Put every stop code in one table, and add Graph code 80002 (the Instagram rate-limit error) with its subcode marked unknown | Spec G; plan Global Constraints and Task 2 | Rate-limit summary names 80002 with no subcode (fetch summary). The plan's 368 mapping comes from pendpost's use (fetch summary), so it stays unverified until live |
| 7 | Defer instead of refusing when spacing or a daily cap is hit, and return `retryAfterMs` | Spec caps; plan Task 4 | pendpost defers bursts (fetch summary); inssist returns busy with `retryAfterMs` (fetch summary). The plan's `check` refuses |
| 8 | Add a counter for hashtag lookups: 30 unique hashtags per 7 days, with the window's rolling status unknown | Spec caps table; plan `DEFAULT_CAPS` | Hashtag search reference (fetch summary); the note says the window is not described as rolling |
| 9 | Pass `since` (now minus 24 hours) to `content_publishing_limit`, and keep reading `quota_total` at runtime | Plan Task 6 (`contentPublishingLimit`); spec caps (publishing) | `since` is "no older than 24 hours" (verified (Context7 copy)). The 100-versus-50 conflict stays open |
| 10 | Allowlist insight metrics and leave out deprecated ones such as `impressions` | Plan Task 6 (`accountInsights` takes caller metrics) | `impressions` deprecated for all versions from April 21, 2025 (verified (Context7 copy)) |
| 11 | Check that the parent media belongs to the owner before any reply, hide or delete, and refuse otherwise | Spec anti-goal on comments on other people's posts; plan Tasks 7 and 12 | Owner's constraint. The Meta sample auto-comments on others' posts (verified; a pattern to avoid). How the Graph API answers a comment on someone else's media is not in the notes (unverified) |
| 12 | Parse Instagram Login mentions from comments payloads as well as from a `mentions` field | Spec Surfaces (mentions, Build); plan Task 10 `parseEvents` | Mentions on Instagram Login arrive inside the comments notification (verified (Context7 copy)); the separate `mentions` field is the Facebook Login example (verified (Context7 copy)) |
| 13 | Handle `is_self`, `is_echo`, `is_deleted` and `message_edit` explicitly, and count unknown kinds | Plan Task 10 | Keys come from fetch summaries of template-style examples (fetch summary) |
| 14 | Refuse to start the receiver without the app secret or verify token, and compare the verify token in constant time | Spec Architecture; plan Tasks 10 and 16 | The Meta sample defaults both to empty strings (verified). The constant-time step for the verify token is an inference |
| 15 | Refuse a non-loopback bind unless `api_token` is set, and check the Host header against an allowlist | Plan Tasks 14 and 16; spec silent on binding | IvanBBaev refuses non-loopback without a token (verified). exileum's DNS-rebinding check runs only with an allowlist (fetch summary) |
| 16 | Set `readOnlyHint`, `destructiveHint` and `idempotentHint` on each tool | Plan Tasks 13 and 15; spec silent | IvanBBaev sets them on every tool (verified). The SDK documents them as hints (verified (Context7 copy)) |
| 17 | Map instrumentation exceptions by their real class names | Plan Task 11 (`Challenge`, `LoginRequired`, `RateLimit`) | Notes list ClientThrottledError, FeedbackRequired and TwoFactorRequired (verified). The plan's name rules would send the first two to `api_error` (inference) |
| 18 | Confirm the sidecar runs no automatic challenge resolution, and fail closed on checkpoint and challenge | Spec G and the adapter; plan Task 11 | The challenge_resolvers example exists (verified listing). A 3.0.24 challenge-flow option is recorded with its details withheld (verified that the entry exists) |
| 19 | Pick the MCP SDK line by spike, and test the handshake the client negotiates | Spec Architecture (MCP server); plan Task 15, Step 3 and the package name | The 2026-07-28 revision removes `initialize` and sessions (verified). Claude Code requests 2026-07-28 for stdio by default (fetch summary). The plan's protocol check sends `initialize` |
| 20 | Decide the likes login product by test, and keep it as a per-feature setting | Spec Calls A and K; plan Task 12 (`getClient('instagram')` for all non-Facebook features) | Likes examples use graph.facebook.com (fetch summary). The notes call Facebook Login likely and unconfirmed (inference) |
| 21 | Give the Facebook Login features a token path, or mark them unavailable until a Facebook token exists | Spec decision 4 and Call K; plan Task 16 (Instagram Login only) | Four features need Facebook Login and a linked Page (fetch summary) |
| 22 | Require `confirm: true` on `ig_events_decide` when the decision sends a draft reply | Spec P and Call F; plan Task 12 | A draft reply is outbound (notes' recommendation 5; inference). Design decision F requires confirm on outbound tools |
| 23 | Feed usage headers into the caps and stop path, not only into the return value | Plan Tasks 5 and 4 (parses only) | No read project does this (inference). The Instagram BUC header is not confirmed on a live response (unverified). Throttling triggers when `total_cputime` or `total_time` reaches 100 (fetch summary) |
| 24 | Record each refresh time, and never arm one timer for longer than 2^31 − 1 ms | Plan Tasks 9 and 16 | The 24-hour age clock is undocumented (verified doc; open). felipe's overflow is verified; the Node limit is a fetch summary |
| 25 | Check the separator Meta expects in the `scope` parameter before building the authorize URL | Plan Task 16 (space-joined scope) | felipe comma-joins scope (verified). The notes do not give Meta's separator (unverified) |
| 26 | Test a localhost redirect round trip before relying on the loopback port | Plan Task 16 (127.0.0.1, port 8790) | Whether localhost redirect URIs are accepted is open (first round, open question 8; unverified) |
| 27 | Put private replies, carousel and story publishing and post deletion into the tool list, or defer them in the spec | Spec surfaces table (Build) and Tools; plan Tasks 6 and 13 | The spec says build them; neither tool list has them. Private-reply rules verified (Context7 copy). Deletion's method is in conflict (fetch summary) |

## Where the spec, the plan and the notes disagree

The spec and the plan differ in sixteen named places. The table records each difference and what the notes say about it. Several of these decide what the owner's MCP client can actually call, so they come before the build.

**Table 6. Spec against plan, with the notes' position**

| # | Topic | Spec says | Plan says | Notes say |
|---|---|---|---|---|
| 1 | Stop and clear tools | Tools list has no `ig_stop_status` or `ig_stop_clear`; section G says outbound actions resume after "an explicit tool call" | Lists `ig_stop_status` and `ig_stop_clear` (confirm) | The brief names both; the spec's list omits them (verified, local spec; MCP comparison) |
| 2 | Token tools | Tools list has no `ig_token_status` or `ig_token_refresh` | Lists both; `ig_token_refresh` runs `refreshToken` | Refresh rules verified (first round); no note discusses a token tool |
| 3 | Mentions read tool | `ig_mentions_list` | `ig_mentioned_media` | Name conflict. The reference documents a fields expression, `mentioned_media.media_id(...)` (fetch summary), not the plan's query form |
| 4 | Follow, unfollow and profile edit | Unofficial, gated, phase 2 | Built now, off by default, with confirm | The official route has no follow or profile-edit endpoint (fetch summary, absence); unofficial endpoints lean prohibited (judgment) |
| 5 | Private reply | Surfaces table: "Build, private reply only" | No tool in either list | Private-reply rules verified (Context7 copy); it is the only documented route to a first message (inference) |
| 6 | Post deletion | Surfaces table: Build, with Facebook Login | `mediaDelete` in Task 6; no tool | The method is in conflict, POST or DELETE (fetch summary) |
| 7 | Carousel and story publishing | Surfaces table: carousel, Reel and video story | Only `publishImage` and `publishReel` in Task 6; `publishMedia` takes an undefined `kind` | Carousel and video-story shapes documented (fetch summary) |
| 8 | Setup commands | `ig auth`, `ig serve`, `ig mcp` | Adds `ig status` | Not in the notes; a design-level choice |
| 9 | Listeners | One HTTP surface with `/webhooks/instagram` | Two listeners: webhook on 8787, HTTP on 8788 | Not in the notes; it affects whether Meta can reach the receiver (inference) |
| 10 | Binding | Silent | 127.0.0.1 for both | IvanBBaev defaults to loopback and refuses non-loopback without a token (verified) |
| 11 | Facebook Login | Decision 4 and Call K need it for four features | No Facebook auth command or token source in Task 16 | The four features need Facebook Login and a linked Page (fetch summary) |
| 12 | Stop triggers | Checkpoint, challenge, action block, HTTP 429, error 190 | Adds Graph codes 4, 17, 32 and 613; maps 368 to ACTION_BLOCKED | Code 80002 is named but not mapped; 368 is pendpost's use (fetch summary) |
| 13 | Likes route | Call K: Facebook Login only if the spike shows it | `getClient('instagram')` for every non-Facebook feature, including like | Likes product unstated; examples use graph.facebook.com (fetch summary) |
| 14 | MCP SDK package | Official JavaScript SDK; version and API to be confirmed on npm | `@modelcontextprotocol/sdk`; Step 3 tests `initialize` | Two lines: `@modelcontextprotocol/server` 2.3.1 (v2, the line the 2026-07-28 docs describe) and `@modelcontextprotocol/sdk` 1.32.1 (older) (npm manifests, fetch summary) |
| 15 | Draft reply on decide | `ig_events_decide` records a decision and an optional draft; no confirm | `eventsDecide` takes `draft`; no confirm | A draft reply is outbound and needs confirm (inference from notes' recommendation 5) |
| 16 | Scope separator | No scope detail | Space-joined scope in `buildAuthorizeUrl` | felipe comma-joins (verified); Meta's separator is not in the notes (unverified) |

Two of these rows matter more than the rest. Row 14 bears on whether a channel can work at all: the channel reference's samples import the older package path (inference), and on the v2 runtime a channel server that negotiates 2026-07-28 is not registered as a channel (fetch summary). Row 9 decides whether Meta can reach the receiver the plan describes.

**Table 7. Design statements that the notes contradict, qualify or leave open**

| Design element | What the notes say | Status |
|---|---|---|
| Call I: app secret stays local; the long-lived exchange runs on the owner's machine | The Business Login page says the exchange "must be made in server-side code because it includes the app secret" (verified (Context7 copy)). The notes found no CLI guidance | Contradicted as recorded; unresolved. The design runs the exchange on the owner's machine, where the docs as recorded say it must run server-side |
| Risks list: "Unofficial routes break Instagram's Terms of Use" | The Instagram Terms could not be read; only a snippet (unverified) | The design states as fact what the notes cannot verify |
| Decision 5: likes and follows on named targets, one at a time | Tier 3 of the policy note lists automated likes "aimed at people or posts that did not engage the account" as prohibited (judgment); the likes entry rests on two unverified secondary summaries | Possible conflict; the owner must decide (section 6) |
| Decision J: message text kept 30 days | Developer Policies: data about people reached through Instagram Messaging may be used only as reasonably necessary for the message types (verified). Storage beyond that is gray (judgment) | The owner accepted the trade-off, but the risks list does not name the rule |
| Call E: auto-replies, 100 per day | Automated replies at volume are gray even with owner-written templates; the rule gives no numeric threshold (verified rule; tier is judgment) | The 100-per-day cap is a design choice, not a line the notes give |
| Call H: tokens in the OS credential store | The binding's Windows behaviour is undocumented and untested (unverified) | Custody depends on a binding no note has run |
| Call G: fail closed on the listed errors | Instagram rate-limit error 80002 exists, subcode unstated (fetch summary); it is absent from the design's list | Gap in the design's list |
| Surfaces: post deletion, Build | DELETE or POST conflict; Facebook Login only (fetch summary) | Settle in the live phase |
| Call Q: unread state tracked locally | The notes show no official unread field (unverified absence). instagram-private-api's inbox carries `unseen_count` (verified), but it is an unofficial route | Open; the spike must check it |
| Call P: push only if clients surface it | Claude Code surfaces list changes (fetch summary); resource-update surfacing is unconfirmed (unverified); channels are a research preview | Partly answered: push is not needed for the first build |

The notes agree with the design on three points: the choice not to adopt instagram-graph-api-lib before its code is read (Call C), the webhook as best effort while the process runs, and dedupe on message ID. On the last point the notes add that felipe's handler dedupes on timestamp and sender instead (verified), which the design does not copy.

## Conflicts the notes keep open, source by source

The notes flag the conflicts below and do not resolve them. The first table holds conflicts raised in this round's notes. The second, after it, carries all twenty-nine of the first round's conflicts, condensed. Each row names the sources that disagree and their labels, so the owner can judge which side has the stronger evidence.

**Table 8. Conflicts raised in this round's notes**

| # | Conflict | Sources that disagree (label) |
|---|---|---|
| A1 | Recommended request layer | First-round report recommends instagram-graph-api-lib; the library's own source does not support that role (verified) |
| A2 | Graph version | First round recommends v26.0; felipe's SDK defaults to v21.0 and AleemHaider's examples use v21.0 (verified) |
| A3 | Page token expiry | instagram-graph-api-lib's README says long-lived Page tokens do not expire (verified text, claim not checked); the first round lists Page token expiry as open |
| A4 | Library version | Repository package.json says 0.1.0; registry lists 7.0.0 (verified and fetch summary) |
| A5 | IvanBBaev tool count | GitHub description says 28 professional-account tools; README says 29 (verified) |
| A6 | mikusnuz tool count and API version | README: 66 tools (33 Instagram, 27 Threads, 6 Meta) and Graph v26.0; About text: 57 tools and v25.0 (fetch summary). The first round's 57 follows the About text |
| A7 | oliverames counts | Section counts do not reconcile with the 199 total; 37 of them are Instagram tools (fetch summary) |
| A8 | William-Gao tool count | Description says 27; the page lists 28 plus refresh_tokens (fetch summary) |
| A9 | mcpware language and env names | README says TypeScript rewrite; files are Python (fetch summary). Env names INSTAGRAM_ACCOUNT_ID and INSTAGRAM_BUSINESS_ACCOUNT_ID conflict (fetch summary) |
| A10 | openinstaflow licence | Licence "none in API"; MIT per fetch summary (conflict noted in the note) |
| A11 | alexfisenkov read-only claim | About says read-only; tool list includes meta_publish_media (fetch summary; verified API) |
| A12 | jlbadano product and version | README setup names the Basic Display product and v19.0 (verified); the first round cites a secondary source for that product's shutdown (unverified) |
| A13 | HasData tool count | README prose and badge say two tools; its tool section names three (verified) |
| A14 | Phyllo personal-account route | Phyllo's IG Direct route is described for non-professional accounts (fetch summary); the design and first round say the official API does not serve personal accounts (verified, local spec; first round). Unresolved |
| A15 | Phyllo public-profile access | A Phyllo blog snippet says public profile data can be read without creator login (unverified); the product page does not say so (fetch summary) |
| A16 | Instagram Terms automated-access clause | A search snippet quotes the clause (unverified); a WebFetch of the same page returned only "Help Center" text |
| A17 | instagrapi default login | CHANGELOG 3.0.0 says the default login does not fall back to legacy (verified text); CHANGELOG 3.0.3 is summarised as a CAA-to-legacy fallback (fetch summary, sub-agent paraphrase) |
| A18 | instagrapi docs against code | Context7 docs snippets do not mention the CAA change; the docs may predate 3.0.0 (inference) |
| A19 | instagrapi licence | First round records GitHub's licence field as NOASSERTION (verified field); the personal-account note did not check licences (unverified). The sources differ in what they checked |
| A20 | VS Code roots notification | The client sends roots list_changed (verified, search fragment); the 2026-07-28 revision removes that notification (verified). The code predates the revision (inference) |
| A21 | Meta sample against the owner's anti-goal | The Meta sample auto-comments on feed posts (verified); the design's anti-goal bars comments on other people's posts (verified, local spec) |
| A22 | Business Login exchange location | Business Login says the long-lived exchange must be server-side (verified (Context7 copy)); design Call I runs it locally (verified, local spec) |
| A23 | Mentions on Instagram Login | Mentions arrive inside the comments notification on Instagram Login (verified (Context7 copy)); the `mentions` field example is Facebook Login (verified (Context7 copy)) |
| A24 | Channel samples against v2 | Channel reference samples import `@modelcontextprotocol/sdk`; the v2 runtime is the line the 2026-07-28 docs describe (inference, fetch summary) |

**Table 9. First-round conflicts still open, condensed from the first round's conflict table**

| # | Conflict | Disagreeing sources (label) |
|---|---|---|
| 1 | Publishing quota | 100 posts per 24 hours on the rate-limit text (verified) against 50 in the carousel passage (fetch summary) and "currently 50" on the quota reference (verified) |
| 2 | Likes in the edge list | Likes reference and April 22, 2026 changelog document `/likes` (fetch summary) against the IG User edge list and documentation index, which omit it (fetch summary) |
| 3 | `link_clicks` restriction | June 22, 2026 changelog says Facebook Login only (fetch summary) against Media insights, which lists it under Story without restriction (fetch summary) |
| 4 | Delete-media method | Request syntax says POST (fetch summary) against heading and example, which say DELETE (fetch summary) |
| 5 | Delete-comment rule | Only the media owner can delete (fetch summary) against a delete section that names the comment creator's token (fetch summary) |
| 6 | Replies page scopes | `page_read_engagement` (singular) against `pages_read_engagement` elsewhere; "a User who created the comment" (fetch summary) |
| 7 | `enable_fb_login` | Deprecated June 14, 2025 (fetch summary) against support added February 6, 2026 (fetch summary); the authorize reference lists default `true` (verified) |
| 8 | Insights permission | Insights pages name `instagram_business_manage_insights` (fetch summary) against an overview that omits it (fetch summary) |
| 9 | `caption` and `media_product_type` | IG Media page marks both Facebook Login only (fetch summary); the first round called that marking unexpected and asked for checking before relying on it for IG Login |
| 10 | Account insights retention | Insights overview: 90 days (fetch summary) against the IG User insights page, which gives no period (fetch summary) |
| 11 | `profile_views` | Overview example uses `profile_views` (fetch summary) against a metric list with `profile_links_taps` and no `profile_views` (fetch summary) |
| 12 | Media insights periods | Request section lists day, week, days_28, month, lifetime and total_over_range; response section says lifetime, fixed (fetch summary) |
| 13 | Discovery API limit | March 30, 2026 entry raises a limit from 240 to 1,000 per hour, naming no API (fetch summary) against the Business discovery page, which states no limit (fetch summary) |
| 14 | Owner-only App Review | Scenario table: Standard Access, App Review not required (verified) against a tutorial saying App Review is required before live data (fetch summary) |
| 15 | Webhook setup location | Live `/webhooks` says setup moved to `/webhooks/setup` (fetch summary) against a Context7 copy of `/webhooks` that holds the handshake text (verified (Context7 copy)) |
| 16 | API versions | v25.0 on messaging pages; v26.0 on the subscription example and versioning page; v20.0 on two template pages; the changelog's newest named version is v22.0 (mixed labels) |
| 17 | Business Login scope name | Authorization URL uses `instagram_business_content_publish` (verified) against App Review and the migration table, which use `instagram_business_content_publishing` (verified) |
| 18 | Timestamp format | Conversation list uses UNIX timestamps; message detail uses `2022-07-12T19:11:07+0000` (verified (Context7 copy)) |
| 19 | Message-list completeness | A fetch summary quotes "all message IDs in a conversation" (fetch summary); the Context7 copy lacks that sentence (verified (Context7 copy)) |
| 20 | Requests-folder 30-day rule | Messaging overview says messages (verified (Context7 copy)); Conversations page says conversations (fetch summary) |
| 21 | Human-agent tag syntax | A search summary says `HUMAN_AGENT` appears in the Send API reference and that private replies stopped needing it in August 2021 (unverified); no page checked shows the syntax |
| 22 | Text send rate | 100 calls per second for text, links, reactions and stickers in one section; 300 in another (fetch summary) |
| 23 | Rate-limit window | Platform `call_count` is a rolling one-hour period (fetch summary) against the Instagram formula, which uses 24 hours (verified (Context7 copy)) |
| 24 | Whether automation is banned | Sources conflict; vendor ban-rate figures conflict and have no source (unverified) |
| 25 | Method tags for WebFetch reads | The policy note tags WebFetch reads of Meta's terms as verified; the messaging and access notes tag WebFetch reads as fetch summaries (labels disagree; treat as fetch summary) |
| 26 | "Official" repository label | adelaidasofia README says "Official"; the sources show no Meta affiliation (unverified) |
| 27 | Language | The inventory note suggests a TypeScript CLI; the stack note designs ESM JavaScript (a choice between sources, not a factual conflict) |
| 28 | v1.0 deprecation dates | Applicability reads "April 21, 2025 May 20, 2025" with no separator (fetch summary) |
| 29 | App Review URL path | Policy note fetched the `/docs/` root; Context7 uses `/documentation/` (fetch summary; verified) |

The first round's open questions that the design depends on remain open. They are token invalidation after a password change or app removal, where subcode 460 is not mapped to error 190 (unverified); the 24-hour refresh-age clock (verified doc; open); the webhook signature scheme and the handshake reply status (first round, open question 16); DM send limits, where none was found but absence is unconfirmed (unverified); the human-agent tag syntax; and whether localhost redirect URIs are accepted. The notes add gaps of their own. They give no latency figure for any route and no delivery test on any client. They found no size limit for notifications in the pages read, and the MCP client matrix did not load. The last 22,861 characters of the Claude Code MCP page, including its elicitation section, were not read, and neither was the MCP Triggers and Events Working Group page. instagrapi's session-file format was not read, so the design's rule that sidecar session state lives only in the credential store (spec Call H) rests on a format no note has seen (first round, unverified).

## Owner constraints, and the decisions left to the owner

The research bears on each of the owner's constraints, and on some of them it cannot give an answer the owner can rely on. Table 10 says what the notes show for each one. The brief itself was never read in the notes; the device and challenge rules come from an agent's summary of it (unverified), so the owner should confirm their exact wording before deciding decisions 1 and 14 in Table 11.

**Table 10. The owner's constraints and what the notes bear on them**

| Constraint | What the notes bear on it | Status |
|---|---|---|
| No abuse | Developer Policies bar bots "at very high frequencies," spam and inauthentic behaviour in Instagram Messaging (verified). No numeric threshold exists in the text read (verified absence) | Rule verified; threshold unknown |
| Owner-only | The App Review row for an app used only for a business the developer owns or manages is Standard Access, not required (verified). A tutorial says App Review is required before live data (fetch summary). The plan's owner check exists (plan Task 4) | Needs a test call |
| The owner's credentials never go to a third party | Phyllo gives a Meta token to a vendor (fetch summary). Phantombuster's session cookies are in snippets (unverified). HasData, StoriesIG and Apify depend on the vendor-key reading. The notes also say a third-party tunnel would carry webhook payloads, including message text, through a vendor (judgment; tunnels not researched) | Open on vendor keys |
| No scraping of other people's data | StoriesIG, HasData and Apify return other people's public data and fail the rule. Business discovery and hashtag lookups are single calls the design allows (decision O). The policy note places discovery features in the gray tier and says their terms were not verified (judgment) | Owner decision |
| No device or fingerprint spoofing | instagrapi's CHANGELOG records an Android app profile and device configuration (verified text). instagram-private-api's `generateDevice(seed)` exists (verified signature). jlobos sends a browser user agent and an `ig_cb` cookie (verified). instagram_mqtt has a Frida helper (fetch summary, issue title). The brief's rule is an agent's summary (unverified) | Owner decision |
| No automated challenge solving | instagrapi's `challenge_resolvers.py` example exists (verified listing) and a captcha module is present but unread. jlobos's challenge functions, including `replayChallenge`, exist (verified). The plan's sidecar maps challenges to CHECKPOINT and fails closed (plan Task 11) | Check the sidecar's configuration |
| No comments on other people's posts | The Meta sample auto-comments "Lovely post!" on feed posts (verified). The plan's `commentReply` has no owner-media check (verified, plan text) | Add the check (Table 5, row 11) |
| Haiku-only subagents | No finding in the notes bears on this constraint. The plan repeats it in Global Constraints (verified, plan text) | No bearing |

Some constraints interact. The owner's credential rule and the no-scraping rule together decide whether HasData, StoriesIG and Apify are excluded by one rule or by two. The device rule and the challenge rule together decide whether the Python sidecar is usable at all, since instagrapi's device profile and its challenge handling both sit on the constraint lines.

**Table 11. Decisions only the owner can make**

| # | Decision | Options | What the notes add | Where it sits |
|---|---|---|---|---|
| 1 | Device identity: does the default identity that private-API clients send count as device spoofing? | Treat as spoofing and use official routes only; allow a disclosed profile the owner chooses; allow the library defaults | The brief was not read, and the agent summary is unverified. Each of the four libraries read presents an app or browser identity (verified for three; inference for instagram_mqtt) | Spec anti-goals and Call B; plan Task 11 |
| 2 | Does a vendor API key count as a credential? | If yes, HasData, StoriesIG and Apify fail the credential rule. If no, they fail the no-scraping rule | The notes give no answer and leave the choice to the owner (judgment) | Spec decision H and anti-goals; hosted note |
| 3 | Follows, unfollows and profile edits | Keep as unofficial, gated phase 2 (spec); build now (plan); or drop | The official route has no follow or profile-edit endpoint (fetch summary, absence). The policy note says unofficial endpoints lean prohibited (judgment) | Spec Tools; plan Task 12 |
| 4 | Likes on named targets (decision 5) | Keep as written; keep only for targets that engaged with the owner; or drop | Tier 3 lists automated likes on non-engaging targets as prohibited (judgment). The likes sourcing is the weakest in the set (judgment on unverified secondary summaries) | Spec decision 5 and Call K; plan Task 7 |
| 5 | Automated DM replies (Call E) | Keep off by default with the 100-per-day cap; lower the cap; or drop | Automated replies at volume are gray even with owner-written templates (verified rule; tier is judgment) | Spec Call E and caps; plan Task 12 |
| 6 | Message text kept 30 days, and pending events | Keep as decision J; shorten the period; exempt unacknowledged and undecided events from the purge | Developer Policies' data-use rule (verified). Protecting pending events is the notes' recommendation (inference) | Spec J; plan Task 3 |
| 7 | Webhook receiver lifetime | Always-on serve process; receiver inside the MCP process and accept losses beyond the retry window; or a separate receiver with shared storage | Meta retries over 36 hours and then drops (fetch summary). No history query (verified (Context7 copy)). Channels drop events silently (fetch summary) | Spec Architecture; plan Task 16 |
| 8 | Public endpoint for Meta | A reverse proxy the owner runs; a tunnel with a valid certificate; a hosted relay | No tunnel is named. Tunnels and relays were not researched. A third-party tunnel would carry message text through a vendor (judgment) | Spec Architecture and live phase; plan Global Constraints |
| 9 | App secret location | Keep it on the owner's machine (Call I); or move the exchange to a server | The Business Login wording as recorded says server-side (verified (Context7 copy)) | Spec Call I; plan Task 16 |
| 10 | Likes and Facebook Login features | Instagram Login first, after a live test; Facebook Login with a linked Page for the four features; both | The likes product is unstated. Four features need Facebook Login and a Page (fetch summary) | Spec Calls A and K; plan Tasks 12 and 16 |
| 11 | MCP SDK line | The v2 line with protocol 2026-07-28 and a channel-compatible handshake; the v1 line with legacy negotiation; or defer the channel | Channels need a compatible handshake (fetch summary). The notes say the SDK version must be checked before coding (inference) | Spec Architecture; plan Task 15 |
| 12 | Channel push | Build a channel for owner-opted interactive sessions; or leave push out | Research preview; custom channels need a development flag; a server must not declare permission relay (fetch summary and notes' recommendation) | Spec P; not in the plan |
| 13 | Stop tools | Separate `ig_stop_status` and `ig_stop_clear`; or parameters of `ig_status` | The MCP comparison lists this as the owner's decision | Spec Tools; plan Tool List |
| 14 | Sidecar default | The instagrapi sidecar; the jslib stub only; no unofficial adapter | Depends on decisions 1 and 2. instagrapi's README advises official APIs where they cover the use (unverified) | Spec Calls A and B; plan Task 11 |
| 15 | Account type and test account | Business or Creator; a test account for the live phase | Personal accounts have no official route (verified). No feature-level difference between Business and Creator is documented (verified absence) | Spec open items; plan Task 17 |
| 16 | App mode and App Review | Stay in Development mode and test the owner-only row with one call | The owner-only row says App Review is not required (verified); the tutorial says it is required before live data (fetch summary) | Spec Call M |
| 17 | Human-agent tag outside the 24-hour window | Add a tagged path with its own clock; or keep the 24-hour window only | Tag syntax not found; eligibility limited to human-staffed support (verified overview text; syntax unverified) | Spec silent; plan Task 8 |
| 18 | Post deletion | Build the Facebook Login deletion after a POST or DELETE test; or drop it | The method is in conflict (fetch summary) | Spec Surfaces; plan Task 6 |

## Conclusion

The research changes the design's emphasis more than its shape. The defensible core is the pull log, the stop state and the gates, which no sampled project matches, and the owner should protect that core by fixing the transport and the receiver before any outbound tool goes live. The official surface is narrower than the tool list implies. Follows and profile edits have no documented route (fetch summary), likes need a login decision, and the publishing quota carries an unresolved conflict between 100 and 50 posts per day (verified, conflicting). Breadth in those areas rests on unofficial routes, which the notes lean against (judgment), so the owner should accept that trade-off knowing the lean, rather than discover it through an account restriction.

The question that matters most is structural. Where the receiver runs decides whether the event log can be trusted at all, because Meta retries a failed delivery for 36 hours and then drops it (fetch summary), and because channels drop events silently (fetch summary). A process that outlives the MCP session, with the MCP server reading the same store, closes the gap the notes identify, although they give no latency figure for any route. No note made a live call, so the signature scheme, the handshake reply, the Bearer transport and the likes login product all stay provisional until the live phase confirms them, and the plan should say so in the README it promises (plan Task 17).
