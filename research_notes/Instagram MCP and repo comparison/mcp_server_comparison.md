# Instagram MCP servers and repo comparison

Date: 2026-10-20. Read-only research. Nothing was installed, cloned, run, or built, and no live Instagram call was made. No repository code was read: tool names come from READMEs, WebFetch summaries of GitHub pages, and registry JSON.

Compared against: the owner's planned tool set, architecture, and account types in the [design spec](D:\Projects2\InstagramApi\docs\superpowers\specs\2026-10-20-instagram-cli-design.md). Builds on the [first-round report](D:\Projects2\InstagramApi\reports\Instagram CLI automation landscape.md) and its [inventory notes](D:\Projects2\InstagramApi\research_notes\Instagram CLI automation landscape\existing_tools_inventory.md). The inventory is not repeated except where a row changed.

**Labels.** V = verified: read from a repository file (GitHub contents API), a GitHub search API response (stars, licence, pushed_at, created_at), or a Context7 copy of a repository file (a snapshot). FS = fetch summary: a WebFetch paraphrase of a GitHub page or registry JSON; check quotes on the live page. U = unverified: description text only, a search snippet, or an inference. "Last push" is GitHub's pushed_at field, used as the last-commit proxy; commit dates were not read.

**Coverage.** Official MCP registry, search "instagram", 3 pages: 61 entries, 30 distinct names, no further cursor (FS). GitHub search "instagram mcp in:name,description,topics": 854 matches, top 50 by stars read (V). GitHub search "instagram mcp in:name stars:0..9": 207 matches, first 50 read (V). A broader stars 0..9 query was saved to a 51 KB file and was not read. Not searched: Smithery, mcp.so, Glama, PulseMCP.

**Effort.** About 60 tool calls in parallel batches. That is well above the researcher guideline of about 15. The brief asked for roughly 30 servers with about 15 fields each, so the extra calls were needed; the cost is recorded here.

---

## Key question 0: Which Instagram MCP servers exist, and how do they compare on the brief's fields?

### Takeaway
The sample has 30 registry names, 854 GitHub matches, and about 60 repositories read or classified. Most registry names and most of the GitHub tail are public-data scrapers, downloaders, or hosted third-party APIs; these fall under the owner's anti-goal on scraping and bulk download. Owner-account servers are either official Graph API servers (about 12 read) or unofficial session, cookie, or browser servers (about 10 read). The most complete official server is IvanBBaev/instagram-mcp (29 tools, preview-by-default writes, no DM tools). The broadest surfaces are adelaidasofia/instagram-mcp (29 tools, DMs gated behind App Review and an env flag) and mikusnuz, exileum, and oliverames, which add Threads and Facebook tools; oliverames also ships about 90 ads, commerce, and audience tools, outside the owner's scope. No sampled server implements the owner's event log, stop state, or per-action caps.

### Table A: Identity and access class (26 repositories; about 34 more are in Table E)

| Server | Access class | Lang | Stars | Last push | Licence | Transport | Read by |
|---|---|---|---|---|---|---|---|
| [IvanBBaev/instagram-mcp](https://github.com/IvanBBaev/instagram-mcp) (npm instagram-mcp-ai) | Official Graph API, professional accounts; write gate | TypeScript | 4 | 2026-10-15 | MIT | stdio; HTTP opt-in | V README; V API |
| [AleemHaider/instagram-mcp](https://github.com/AleemHaider/instagram-mcp) | Official Graph API, professional accounts | Python | 6 | 2026-05-29 | MIT | stdio | V README; V API |
| [adelaidasofia/instagram-mcp](https://github.com/adelaidasofia/instagram-mcp) | Official Graph API, multi-account; DMs env-gated | Python | 9 | 2026-10-18 | MIT | stdio | V README; V API |
| [mikusnuz/meta-mcp](https://github.com/mikusnuz/meta-mcp) | Official Graph API; Instagram plus Threads | TypeScript | 30 | 2026-10-19 | MIT | stdio (inferred) | FS; V API |
| [jlbadano/ig-mcp](https://github.com/jlbadano/ig-mcp) | Official Graph API, Business accounts | Python | 197 | 2026-02-09 | MIT | stdio | V README; V API |
| [exileum/meta-mcp](https://github.com/exileum/meta-mcp) | Official Graph API; Instagram plus Threads | TypeScript | 13 | 2026-09-10 | MIT | stdio; HTTP opt-in | FS; V API |
| [oliverames/meta-mcp-server](https://github.com/oliverames/meta-mcp-server) | Official; Facebook, Instagram, Threads, Ads (199 tools) | TypeScript | 58 | 2026-10-08 | MIT | stdio | FS; V API |
| [William-Gao/instagram-mcp](https://github.com/William-Gao/instagram-mcp) | Official, Instagram Login | Python | 2 | 2026-06-22 | MIT | stdio | FS; V API |
| [mcpware/instagram-mcp](https://github.com/mcpware/instagram-mcp) (npm @mcpware/instagram-mcp) | Official Graph API | Python per files; README says TypeScript rewrite | 59 (FS) | not read | MIT (FS) | stdio (implied) | FS |
| [Narla-Venkata-Anand-Sai-Kumar/openinstaflow](https://github.com/Narla-Venkata-Anand-Sai-Kumar/openinstaflow) | Official Graph API | TypeScript | 20 | 2026-05-31 | none in API; MIT per FS (conflict) | stdio | FS; V API |
| [alexfisenkov/meta-instagram-mcp](https://github.com/alexfisenkov/meta-instagram-mcp) | Official; About says read-only, but has writes | TypeScript | 1 | 2026-10-20 | MIT | stdio; HTTP with bearer | FS; V API |
| [setsmart-git/instagram-mcp](https://github.com/setsmart-git/instagram-mcp) | Hosted bridge to third-party SetSmart (Meta-approved app) | not stated (npm setsmart-mcp) | 0 (FS) | not read | MIT (FS) | stdio to hosted HTTPS | FS |
| [trypeggy/instagram_dm_mcp](https://github.com/trypeggy/instagram_dm_mcp) | Unofficial; username and password; DMs and likes | Python | 186 | 2025-08-13 | MIT | stdio | FS; V API |
| [KynuxDev/mcp-instagram-dm](https://github.com/KynuxDev/mcp-instagram-dm) (npm mcp-instagram-dm) | Unofficial web API; session cookies; DMs | TypeScript | not retrieved | not retrieved | MIT (README) | stdio (npx) | V README |
| [braindead-dev/instagram-dms-mcp](https://github.com/braindead-dev/instagram-dms-mcp) | Unofficial; cookies; DMs; forwards DMs to Poke; Render option | Go | 10 | 2026-01-02 | none in API | stdio; hosted HTTPS | FS; V API |
| [DavidCoder-agent/instagram-mcp-server](https://github.com/DavidCoder-agent/instagram-mcp-server) | Unofficial; "reverse-engineered private API"; 48 tools | Python | 0 | 2026-07-09 | MIT | stdio | FS; V API |
| [official-Arvind/instagram-mcp](https://github.com/official-Arvind/instagram-mcp) | Unofficial; instagrapi; "68+ tools" (description) | Python | 5 | 2026-06-20 | MIT | not stated | V API (description); first round |
| [inssist/mcp](https://github.com/inssist/mcp) | Unofficial; drives the user's own signed-in browser through an extension | TypeScript | 31 | 2026-10-19 | MIT | stdio plus local WebSocket | FS; V API |
| [duhlink/instagram-server-next-mcp](https://github.com/duhlink/instagram-server-next-mcp) | Unofficial; reuses a Chrome profile; one tool | TypeScript | 50 | 2025-01-09 | none in API; README says MIT | stdio (implied) | FS; V API |
| [lupikovoleg/instagram-cli](https://github.com/lupikovoleg/instagram-cli) | "Agentic AI to communicate with Instagram (and MCP too)" | Python | 43 | 2026-07-02 | none in API | not stated | V API; U description |
| [Shudesu/ig-harness-oss](https://github.com/Shudesu/ig-harness-oss) | Comment-triggered DM automation on Cloudflare Workers; MCP package | TypeScript | 61 | 2026-10-11 | MIT | hosted Workers | FS; V API |
| [pendpost/pendpost](https://github.com/pendpost/pendpost) | Multi-network scheduler with a human approval gate; Instagram among networks | JavaScript | 14 | 2026-10-14 | MIT | stdio plus HTTP on 127.0.0.1:8090 | FS; V API |
| [HasData/instagram-mcp](https://github.com/HasData/instagram-mcp) | Hosted; public profile and post data; API key | JavaScript | 16 | 2026-10-12 | MIT | hosted HTTPS; npm and PyPI launchers | FS; V API |
| [storiesig-info/instagram-mcp](https://github.com/storiesig-info/instagram-mcp) | Hosted; public content; monthly quota | not stated | 1 | 2026-09-30 | none in API | hosted HTTPS | FS; V API |
| [postoncehq/instagram-mcp](https://github.com/postoncehq/instagram-mcp) | Publish and schedule "through Instagram's official API"; "no developer app" (hosted claim) | not given | 2 | 2026-10-16 | MIT | not stated | V API; U description |
| [Insightful-Pipe/instagram-mcp-server](https://github.com/Insightful-Pipe/instagram-mcp-server) | Hosted; "19 actions (11 read, 8 write)" | not given | 1 | 2026-10-10 | MIT | hosted | V API; U description |

### Table B: Tool names by area (servers whose tool list was read)

Write tools are listed in the right column. Counts are the server's own claim unless marked.

| Server | Count | Read tools by area | Write tools |
|---|---|---|---|
| IvanBBaev (V) | 29 (GitHub description says 28) | Account: instagram_get_account, instagram_list_linked_accounts (Facebook login), instagram_token_status. Media: instagram_get_media, instagram_list_media, instagram_list_stories, instagram_list_tagged_media. Insights: instagram_get_account_insights, instagram_get_audience_demographics, instagram_get_media_insights, instagram_get_online_followers. Discovery (Facebook login): instagram_search_hashtag, instagram_get_hashtag_media, instagram_discover_business. Publishing: instagram_get_container_status, instagram_get_publishing_limit. Comments: instagram_list_comments, instagram_get_comment. No DM tools. | instagram_create_media_container, instagram_post_image, instagram_post_reel, instagram_post_story, instagram_publish_media, instagram_create_comment, instagram_reply_to_comment, instagram_hide_comment, instagram_unhide_comment, instagram_set_comments_enabled, instagram_delete_comment (11 of 29) |
| AleemHaider (V) | 24 | get_my_profile, list_my_media, list_all_media, get_media, list_tagged_media, list_stories; search_hashtag, hashtag_top_media, hashtag_recent_media; list_comments, get_comment_replies; list_conversations, get_conversation; get_account_insights, get_media_insights; get_publish_limit | publish_image, publish_reel, publish_story, publish_carousel, reply_to_comment, hide_comment, delete_comment, send_dm (message_tag optional) |
| adelaidasofia (V) | 29 | healthcheck, list_accounts, account_info; get_profile, list_media, get_media; get_account_insights, get_media_insights, get_audience_insights; get_comments; search_hashtag, get_hashtag_media, get_mentions, business_discovery; list_conversations, get_messages; publishing_limit | add_account, set_default_account, remove_account (local account store); publish_image, publish_video, publish_reel, publish_carousel, publish_story; reply_to_comment, hide_comment, delete_comment; send_message (env-gated) |
| KynuxDev (V) | 15 | instagram_get_inbox, instagram_get_thread, instagram_get_pending, instagram_user_info, instagram_thread_info, instagram_search_inbox, instagram_search_messages, instagram_search_users | instagram_send_message, instagram_send_link, instagram_create_thread, instagram_like_message, instagram_unsend_message, instagram_mark_seen, instagram_approve_pending |
| jlbadano (V) | 8 features (README names features; only get_profile_info appears as an identifier) | Get Profile Info, Get Media Posts, Get Media Insights, Get Account Pages, Get Conversations, Get Conversation Messages | Publish Media, Send DM; resources (profile, media feed, insights) and three prompts |
| mikusnuz (FS) | 66 per README (About says 57); 33 Instagram, 27 Threads, 6 Meta | ig_get_profile, ig_business_discovery, ig_get_media_list, ig_get_media, ig_get_container_status, ig_get_comments, ig_get_comment, ig_get_replies, ig_get_conversations, ig_get_messages, ig_get_message, insights, ig_search_hashtag, ig_get_hashtag_recent, ig_get_hashtag_top, ig_get_mentioned_comments, ig_get_tagged_media, meta_get_webhook_subscriptions, meta_debug_token, meta_get_app_info | ig_publish_photo, ig_publish_video, ig_publish_carousel, ig_publish_reel, ig_publish_story, ig_delete_media, ig_post_comment, ig_reply_to_comment, ig_hide_comment, ig_delete_comment, ig_toggle_comments, ig_send_message, ig_respond_collaboration_invite, meta_subscribe_webhook, meta_exchange_token, meta_refresh_token. No like tool. |
| exileum (FS) | 58 or 59 (page counts differ) | Same Instagram read family as mikusnuz (profile, media, comments, conversations, insights, hashtag, tagged and mentioned media, collaboration invites) plus meta_get_webhook_subscriptions and token debug | ig_publish_photo, ig_publish_video (marked deprecated), ig_publish_carousel, ig_publish_reel, ig_publish_story, ig_delete_media, ig_post_comment, ig_reply_to_comment, ig_hide_comment, ig_delete_comment, ig_toggle_comments, ig_send_message, ig_respond_collaboration_invite, meta_subscribe_webhook, token swaps. No like tool. |
| oliverames (FS) | 199 (Instagram 37; Facebook Pages 52; Threads 22; Ads and other 88); 81 marked as writes | Instagram: meta_list_instagram_accounts, meta_get_instagram_user, media and comment reads, meta_get_instagram_conversations, meta_get_instagram_messages, broadcast channel reads, insights, meta_get_instagram_live_media, catalog and hashtag reads, meta_check_instagram_publishing_limit. Facebook and Threads reads also present. | Instagram writes (14): meta_publish_instagram_photo, _reel, _story, _carousel, _container; meta_delete_instagram_media; meta_reply_instagram_comment; meta_delete_instagram_comment; meta_hide_instagram_comment; meta_toggle_instagram_comments; meta_send_instagram_message; meta_send_instagram_media_message; meta_send_broadcast_channel_message; meta_create_broadcast_channel_poll. meta_like_object exists for Facebook objects, not Instagram media. |
| William-Gao (FS) | 27 per description; 28 listed plus refresh_tokens | get_profile_info, get_account_pages, validate_access_token, get_media_posts, get_media_details, get_stories, get_mentions, get_account_insights, get_media_insights, get_comments, get_content_publishing_limit, get_conversations, get_conversation_messages, business_discovery, search_hashtag, get_hashtag_media, discover_fb_setup | publish_image, publish_video, publish_reel, publish_carousel, post_comment, reply_to_comment, delete_comment, hide_comment, toggle_media_comments, send_dm; refresh_access_token and refresh_tokens (writes .env) |
| mcpware (FS) | 23 | get_profile_info, get_account_pages, validate_access_token, get_media_posts, get_content_publishing_limit, get_account_insights, get_media_insights, get_comments, get_conversations, get_conversation_messages, search_hashtag, get_hashtag_media, get_stories, get_mentions, business_discovery | publish_media, publish_carousel, publish_reel, post_comment, reply_to_comment, delete_comment, hide_comment, send_dm |
| openinstaflow (FS) | 8 plus resources and prompts | get_profile_info, get_media_posts, get_media_insights, get_account_pages, get_conversations, get_conversation_messages | publish_media, send_dm |
| alexfisenkov (FS) | 22 (About says read-only) | meta_auth_status, meta_scope_presets, meta_build_login_url, meta_begin_oauth, meta_capabilities, meta_list_facebook_pages, meta_resolve_instagram_account, meta_get_account_info, meta_list_media, meta_get_media, meta_get_top_media, meta_get_user_insights, meta_get_post_insights, meta_list_comments, meta_get_comment_replies, meta_read_inbox, meta_read_source, meta_raw_get | meta_publish_media (needs confirm and an env flag), meta_create_media_container (unpublished container), meta_exchange_code, meta_refresh_token, meta_resolve_instagram_account (saves user id) |
| inssist (FS) | 55 named (page says 60) | ig_fetch_profile, ig_fetch_posts, ig_fetch_post, ig_fetch_stories, ig_fetch_saved, ig_search, account_info, story_viewers, notifications_list, events_check, follow_requests_list, comments_list, dm_list, dm_requests, dm_read, draft_get, draft_preview, draft_list, insights_report, unfollowers_report, antibot_report, peers_report, location_search, music_search; background scans (unfollowers_scan, antibot_scan, peers_scan) and downloads_status | account_switch, profile_update, note_set, follower_remove, ig_block, comment_add, comment_reply, comment_like, comment_delete, dm_send, dm_mark_seen, dm_accept, dm_remove, draft_create, draft_schedule, draft_publish, draft_update, draft_delete, draft_reorder, ig_post_edit, ig_post_delete; downloads_start (background) |
| trypeggy (FS) | 22 | get_user_id_from_username, get_username_from_user_id, get_user_info, search_users, get_user_followers, get_user_following, get_user_posts, get_user_stories, list_chats, list_pending_chats, search_threads, get_thread_by_participants, get_thread_details, list_messages, list_media_messages, download_media_from_message, download_shared_post_from_message | like_media, send_message, send_photo_message, send_video_message, mark_message_seen |
| DavidCoder-agent (FS) | 48 | set_session, set_csrf_token, login, login_two_factor, get_current_user, search_users, get_user_info, get_user_by_username, get_timeline, get_user_feed, get_explore, get_liked_media, get_saved_media, get_media_info, get_media_likers, get_media_comments, get_friendship_status, get_following, get_followers, get_reels_tray, get_reels_media, get_user_reels, get_clips, get_inbox, get_thread, get_thread_messages, search_direct_recipients, hashtag and location reads, get_notifications, get_news_inbox | add_comment, delete_comment, edit_media_caption, delete_media, like_media, unlike_media, save_media, unsave_media, follow_user, unfollow_user, block_user, unblock_user, send_direct_text, upload_and_post_photo (upload_photo_only unclear) |
| braindead-dev (FS) | 4 | get_inbox, get_conversation(user) (may mark the thread seen) | send_message(user, message), react(user, emoji) |
| setsmart-git (FS) | 30 | conversation_list, conversation_search, conversation_get, conversation_get_messages, contact_find, contact_get, ai_get_all_status, scheduled_list, template_list, analytics_stats, instagram_post_list, instagram_post_get_triggers, comment_reply_get_auto_reply | message_send_text, message_send_image, message_send_video, message_send_audio, message_send_template, message_send_reaction, conversation_add_tag, conversation_remove_tag, conversation_set_notes, contact_import, contact_add_tags, contact_remove_tags, ai_pause_conversation, ai_resume_conversation, ai_pause_channel, ai_resume_channel, scheduled_cancel |
| pendpost (FS) | 42 named (page says 134); multi-network | plan_list, plan_get, account_status, assets_list, activity_log, validate_media, platform_validate, pendpost_health, publish_preview, brand_lint, generate_digest, config_get, clients_overview | publish_due_run, plan_create_post, plan_update_post, plan_delete_post, approve_post, reject_post, campaign_create, campaign_set_active, scheduler_set, reschedule, unschedule, mark_posted, set_cover, clear_cover, asset_upload, rename_asset, delete_asset, token_refresh, pendpost_record_block, meta_lane_set, config_set, client_create, client_update, client_archive, client_set_active |
| HasData (FS) | 3 plus one prompt | profile by handle; posts by handle (paged); comments by post URL (paged) | none; read-only |
| storiesig-info (FS) | 12 | get_instagram_profile, search_instagram_accounts, list_instagram_posts, get_instagram_post, list_instagram_comments, list_instagram_post_likers, list_instagram_followers, list_instagram_following, list_instagram_stories, get_instagram_story, list_instagram_highlights | download_instagram_video is a download of public media; no account writes |
| duhlink (FS) | 1 | get_instagram_posts (saves media and metadata to a local folder) | none |
| Shudesu/ig-harness-oss (FS) | not listed | Page names no tools; it describes comment, story-mention, keyword, and broadcast DM flows | Automated DMs; the page calls them triggers, not tools |

### Table C: Behaviour and security fields

DM = direct messages. "Not stated" means the page or README is silent; it does not mean the feature is absent.

| Server | Auth model | DM listing and pagination | New-message signal | Confirm or preview | Caps and pacing | Error model | Secrets in config and logs | HTTP bind | Tests and docs |
|---|---|---|---|---|---|---|---|---|---|
| IvanBBaev (V) | IG_ACCESS_TOKEN; ig-login (graph.instagram.com) or fb-login (graph.facebook.com plus app secret, appsecret_proof) | no DM tools | none | Preview by default; apply: true or IG_WRITE_MODE=apply; deletes also need IG_ALLOW_DESTRUCTIVE=true; asks the client to confirm applied writes when elicitation is supported | IG_MAX_CONCURRENT 4 per host; IG_MAX_ITEMS 200; publishing quota read; no per-action caps | error taxonomy in docs/operations.md (not read) | env file under the XDG config path, 0600 on POSIX (no effect on Windows); redactor masks tokens before logs; login, refresh, and doctor never print secrets | stdio default; HTTP 127.0.0.1:3000; non-loopback bind without a token refused | unit tests and CI on Linux, macOS, Windows (README claim); extensive docs/; version conflict 0.8.0 (status line) vs 0.7.0 (table) |
| AleemHaider (V) | Facebook-login token; IG_GRAPH_HOST switch to graph.instagram.com | list_conversations, get_conversation; not stated | none | none; send_dm takes message_tag (HUMAN_AGENT) | get_publish_limit only | structured dict: error true, status, message, code, subcode, fbtrace_id | helper writes .env; Claude Desktop config holds the token in plain env; curl example passes client_secret in the URL query (curl -G) | stdio | README says pytest; docs clear; examples use v21.0 |
| adelaidasofia (V) | long-lived token in env or added at runtime to keychain | list_conversations, get_messages; not stated | none | none; DM tools fail loud until INSTAGRAM_MCP_DM_ENABLED=1 after App Review | publishing_limit; input validation before each Graph call | error_class in audit log (names not given) | keychain on macOS; chmod 600 elsewhere (no effect on Windows, per first round); output scrubber strips tokens; audit JSONL with 4 fields; egress pinned to Meta hosts | stdio | no tests section in README; SETUP.md and APP_REVIEW.md linked; commercial link |
| KynuxDev (V) | sessionid, csrftoken, ds_user_id cookies in client config env | inbox and thread take cursor; thread auto-paginates; search takes max_pages | none; pull via inbox | none; disclaimer says personal use only | INSTAGRAM_RATE_LIMIT_MS=300 between paginated calls | not stated | cookies in plain config env; README says cookies are never logged or stored beyond runtime (claim) | stdio via npx | CI badge; no error section; tests not stated |
| jlbadano (V) | token and app secret in .env; token in client config env | conversations and messages (Advanced Access); not stated | none | none | README claims 200 calls per hour and 25 posts per day; enforcement not shown | README lists categories only (auth, permissions, rate limit, network, API) | README code puts access_token in URL query strings; LOG_LEVEL=DEBUG; redaction not stated | stdio | README says tests/ exists; setup still names the Basic Display product (first round cites a secondary source for its shutdown) and uses v19.0 |
| mikusnuz (FS) | env block: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, messaging token, Page ID, Threads, META_APP_ID and secret | conversations and messages; not stated | webhook subscription tools only; no event read | none; Threads reply approvals (enable_reply_approvals, threads_manage_pending_reply) | x-app-usage tracked; slowdown at 80 percent, backoff at 90 percent; up to 3 retries on 429 and 5xx honouring Retry-After; Threads daily caps 250 publish, 100 delete | JSON with error_type (auth, validation, rate_limit, server, network, internal), remediation, fbtrace_id | exchange and refresh tools return tokens; internal errors redact three keys; other redaction not stated | stdio (inferred) | test folder; counts conflict (57 vs 66); API v25 vs v26 |
| exileum (FS) | env block; refreshed tokens held in memory and returned | conversations and messages; not stated | webhook subscription tools only | none | same throttle and retries as mikusnuz | same JSON shape | partial redaction in internal errors | stdio default; HTTP 127.0.0.1:3000 default; MCP_HTTP_HOST=0.0.0.0 allowed; server has no auth; DNS-rebinding check only when MCP_HTTP_ALLOWED_HOSTS is set, with a stderr warning | tests not shown; counts differ (58 vs 59) |
| oliverames (FS) | META_ACCESS_TOKEN and THREADS_ACCESS_TOKEN in env; falls back to 1Password CLI at startup | conversations, messages, broadcast channels; not stated | page webhooks only (Facebook) | none | publishing-limit check; one retry after error 190 only when it maps to one cached Page; never replays writes | isError true; actionable messages | 1Password fallback; redaction not stated | stdio only | 52 tests (claim); counts do not reconcile |
| William-Gao (FS) | IGAA token (Instagram Login) plus optional EAA Page token; token manager writes .env | get_conversations, get_conversation_messages (Advanced Access); not stated | none | none stated; --force is a token refresh flag | 100 posts per 24 hours; 30 hashtags per 7 days; content limits | FBGraphTokenMissing; token manager exit code 2 means dead token, needs_reauth | .env and env block; redaction not stated | stdio only | tests folder, pytest, ruff; counts conflict (24, 25, 27, 28) |
| mcpware (FS) | .env and client config env block; sample passes token in URL | conversations, messages; not stated | none | none | "intelligent rate limiting" claim; 200 per hour env; 25 posts per day | categories; retry with backoff (claim) | sample passes token in URL; redaction not stated | stdio implied | tests folder; says TypeScript but files are Python; env name conflict (INSTAGRAM_ACCOUNT_ID vs INSTAGRAM_BUSINESS_ACCOUNT_ID) |
| openinstaflow (FS) | IG_ACCESS_TOKEN, IG_USER_ID in env block; optional Page token | conversations, messages (Advanced Access); not stated | none | none | none stated | generic | get_account_pages returns Page tokens; masking not stated | stdio | no tests visible; verify.mjs at root; licence conflict |
| alexfisenkov (FS) | env file under ~/.config; token store token.json; bearer secret for HTTP | meta_read_inbox (API, then browser companion, then phone companion); unread and unanswered states are "unknown" until proven | none | confirm: true plus META_INSTAGRAM_WRITE=true, both checked before any network call | bounded previews; no rate limit stated | not stated | env file and token store; redaction not stated | HTTP with bearer; host and port not stated | tests folder; About says read-only but lists meta_publish_media |
| setsmart-git (FS) | SETSMART_API_KEY (workspace key) in env block; sent per request | conversation list, search, get, messages; not stated | none | none; page says a send "happens on the real account" | none stated | not stated | key in env block; whether SetSmart stores Meta tokens not stated; redaction not stated | stdio locally; upstream hosted | no tests visible; 7 commits |
| trypeggy (FS) | username and password in .env; --username and --password in client config; session file | list_chats, list_messages; "filters/limits" only | none | none | none stated | none stated | password in .env and in client config JSON; session cache location not stated | stdio | no tests visible; README-level docs |
| DavidCoder-agent (FS) | sessionid and csrftoken in env; set_session at runtime; login with username and password (storage not stated) | get_inbox, get_thread, get_thread_messages; not stated | get_notifications and get_news_inbox (pull) | none | "about 60 actions per hour" (README claim) | checkpoint_required named | cookies in env; redaction not stated | stdio | no tests visible; README describes reverse engineering |
| braindead-dev (FS) | Instagram cookies (sessionid, ds_user_id, csrf, datr, did, mid) in .env or Render env (IG_COOKIES) | get_inbox, get_conversation; not stated; IG_AUTO_MARK_SEEN defaults to true | incoming DMs sent to Poke when POKE_API_KEY is set | none; IG_SIMULATE_TYPING is a display delay | IG_TYPING_DELAY 1.5 s; no limits stated | not stated | cookies and Poke key in env; redaction not stated | stdio; hosted HTTPS on Render | tests and licence not shown on page; API shows no licence |
| inssist (FS) | no Instagram credential held (claim); extension pairing; pairing file mode 0600 | dm_list, dm_requests, dm_read; not stated | not stated | none; "Pairing is automatic: the toggle is the consent" | one per-account queue spaced a few seconds apart; instant: true bypasses it; busy: true with retryAfterMs past about 50 s | named bridge errors; protocol-version message | redaction not stated | 127.0.0.1:48231 WebSocket; claims it accepts only chrome-extension origins | test folder; claims every other Instagram MCP wraps the Graph API (unverified) |
| pendpost (FS) | per-platform keys in .env; no Instagram DMs | none | none (approval queue) | approval states; publish fails closed without approval; auto-approve owner-only and revocable | cadence cap defers bursts; breaker on Meta error 368 never auto-resumes; lane kill switch | JSON envelope; brand lint errors block publish | .env only (per page); log redaction not stated | 127.0.0.1:8090 default | test folder; MIT; multi-network |
| Shudesu (FS) | Meta app registered in the app; secret store not stated | admin inbox; automated comment and keyword triggers | Meta webhooks to a Worker; 5-minute cron; multi-secret signature check | none | follow-up cap of 3; D1 daily limits; health checks for checkpoint and freeze | health endpoint | follower profiles stored; secrets handling not stated | hosted Workers | no tests visible; docs in Japanese |
| HasData (FS) | HASDATA_API_KEY in x-api-key header; key written into client config files | none | none | none; read-only | concurrency by plan; 10 credits per successful call | HTTP 200 with isError; 401 at connection | key in client config; redaction not stated | hosted HTTPS | test folder; contract workflow with a live check that costs credits |
| storiesig-info (FS) | OAuth sign-in window on first connect (remote) | none | none | none | monthly quotas; payment link when exhausted | not stated | not stated | hosted HTTPS | no tests shown; no licence |
| duhlink (FS) | CHROME_USER_DATA_DIR (the Chrome profile that holds the login) | none | none | none | delayBetweenPosts; limit 1 to 50 | INVALID_REQUEST, INVALID_PARAMS, METHOD_NOT_FOUND, INTERNAL_ERROR | login stays in the browser profile; redaction not stated | stdio implied | root test files; README says MIT, API shows no licence |

### Table D: Official MCP registry entries (search "instagram", 3 pages, FS)

Every name below contains "instagram". The search appears to match names (U). Transport is from the registry entry; repo is as listed there.

| # | Registry name | Transport | Repo | Class (from description) |
|---|---|---|---|---|
| 1 | app.hooksend/instagram | remote HTTP | none | comment-to-DM automation; "official Meta API" claim (anti-goal pattern) |
| 2 | cc.ssave/tiktok-instagram-downloader | npm stdio | ssavecc/ssave-mcp-server | downloader for TikTok, Instagram, YouTube (bulk download) |
| 3 | co.civai.nova/instagram-web-agent | remote HTTP | none | uses the user's Instagram Web session through instagrapi (session reuse) |
| 4 | co.instapi/instagram | remote HTTP | none | search and posts for agents (public data) |
| 5 | co.instavision/instagram-discovery | remote and npm | afanasenkoa/instavision-mcp | finds creators and leads by niche (discovery of others) |
| 6 | com.52choujiang/instagram-insights | remote HTTP | none | public posts, comments, users, Reels speech-to-text |
| 7 | com.hasdata/instagram | remote, npm, PyPI | HasData/instagram-mcp | public profiles and posts (see Table C) |
| 8 | com.jojapi/instagram | remote HTTP | none | public data scraper API |
| 9 | com.jojapi/instagram-private-profile-viewer | remote HTTP | none | description implies viewing private profiles; excluded by the owner's anti-goals; not examined further |
| 10 | com.jojapi/instagram-scraper | remote HTTP | none | scraper |
| 11 | com.ranovam/instagram-hashtag-discovery | remote (Apify) | none | scrapes hashtag posts and Reels |
| 12 | com.superagnt/instagram-data | remote HTTP | superagnt/plugins | profiles, posts, reels, followers for research |
| 13 | info.storiesig/instagram-mcp | remote HTTP | storiesig-info/instagram-mcp | public content and downloads (Table C) |
| 14 | io.github.AnshumanAtrey/instagram-profile-intel-no-login | remote (Apify) | AnshumanAtrey/instagram-profile-intel-no-login | profile intelligence including bio emails (personal data) |
| 15 | io.github.ArpitGandhi1934/yugenox-instagram-comments | remote (Apify) | ArpitGandhi1934/yugenox-mcp | public comments |
| 16 | io.github.ArpitGandhi1934/yugenox-instagram-reels-transcript | remote (Apify) | same | Reels transcripts |
| 17 | io.github.ArpitGandhi1934/yugenox-instagram-scraper | remote (Apify) | same | Reels, posts, profiles, comments |
| 18 | io.github.FastSocialCo/instagram-data-mcp | PyPI stdio and remote | FastSocialCo/instagram-data-mcp | read-only public data |
| 19 | io.github.KynuxDev/mcp-instagram-dm | npm stdio | KynuxDev/mcp-instagram-dm | DM read and send, cookie auth (Table C) |
| 20 | io.github.adelaidasofia/instagram-mcp | PyPI stdio | adelaidasofia/instagram-mcp | official Graph API (Table C) |
| 21 | io.github.afanasenkoa/instagram-profile-mcp-server | remote (Apify) | afanasenkoa/apify-mcp-servers | followers, similar accounts, keyword and location search |
| 22 | io.github.fernandoguiraud16-coder/instagram-reels-transcript-scraper | remote (Apify) | fernandoguiraud16-coder/data-tools | Reels transcripts by handle |
| 23 | io.github.mcp-dir/instagram-mcp | remote HTTP (api.mcp.ai) | mcp-dir/instagram-mcp: WebFetch returned HTTP 404 | "publish, read comments and DMs, insights, and engage from your account" |
| 24 | io.github.mcpware/instagram-mcp | npm stdio | mcpware/instagram-mcp | Graph API, 23 tools (Table B) |
| 25 | io.github.sadri-dridi/instagram-id | remote HTTP | sadri-dridi/named-mcp-utilities | description unrelated to Instagram ("shard id shape, value discarded") |
| 26 | io.github.saulius876-lgtm/instagram-reels-transcripts | remote (Apify) | none | bulk transcripts of public Reels |
| 27 | io.github.setsmart-git/instagram-mcp | npm stdio and remote | setsmart-git/instagram-mcp | DMs "through official Meta Business APIs" (hosted; Table A) |
| 28 | io.github.wmarceau/instagram-creator | PyPI stdio | MarceauSolutions/dev-sandbox (subfolder) | posts, Reels, carousels, Stories, analytics; a sandbox repo as provenance |
| 29 | one.aisa/instagram | remote HTTP | none | public profiles, timelines, comments, transcripts |
| 30 | sh.fetcher.instagram/mcp | remote HTTP | none | "16 Instagram endpoints. Pay per call in USDC via x402" |

### Table E: Long tail not deep-read (GitHub search, V metadata; U descriptions)

- Owner-account-capable, not read: Bob-lance/instagram-engagement-mcp (46 stars, MIT, JavaScript, pushed 2025-04-26; "tracking Instagram engagement, generating leads"); arjun1194/insta-mcp (12, no licence, TypeScript, 2025-12-28; "analytics, insights, and account management"); anand-kamble/mcp-instagram (8, MIT, TypeScript, 2025-11-24); tylerprogramming/mcp-instagram (7, no licence, Python, 2025-07-09); BilalTariq01/instagram-analytics-mcp (6, MIT, TypeScript; insights only); 0XX7C00/mcp-instagram-dm (4, MIT, JavaScript, 2026-04-08; no description); thenavidm/instagram-mcp (0, MIT, Python, 2026-10-15; "three tiers of access"); michalmalek318-star/mcp-instagram (0, MIT, Python, 2026-10-19; 16 open issues); Hidden1988/instagram-mcp2 (0, MIT, created 2026-10-14); dr-ashraf-s-MCP-LABS/instagram-mcp (2, MIT, Python); kaewz-manga/instagram-mcp-community (1, MIT, TypeScript; "25 tools"); ishan-parihar/instagram-mcp-server (1, Apache-2.0, Python); luminarylane/instagram-mcp-server (1, MIT, TypeScript); peiiaratef126-hub/mcp-server-instagram (1, MIT, TypeScript); 0x1337c0d3/instagram-mcp (1, no licence, Rust; description is word-for-word the same as jlbadano's).
- Unofficial or automation, not read: nachomartinezl/mcp_instagram_agent (4, no licence, Python, 2025-04-25; "Playwright ... story views, likes, comments, and follows"); Stupidoodle/instagram-mcp (3, licence "Other", Python, 2026-10-19; "built entirely by Claude ... with mass auto-accept enabled"); Devdas-gupta/instagram-mcp (0, MIT, Python; "Playwright automation, multi-account session management"); vinipace/instagram-automation-mcp (1, MIT, TypeScript, created 2026-10-18; "comment-to-DM automation controlled through MCP"); AadiSharma49/MCP-Instagram (0, MIT, Python, 2025-08-19); manideep1428/instagram_MCP (3, no licence, TypeScript, 2025-05-27; "Graph V22.0").
- Public-data or read-only, not read: CDataSoftware/instagram-mcp-server-by-cdata (4, MIT, Java; read-only JDBC connector); crewimia/mcp-instagram (2, MIT, Python; "public Instagram profiles, posts & images. No API key needed"); xishandong/instagram-mcp (2, no licence, Python; "通过 imginn.com 访问 Instagram 公开数据", public data via a third-party site); DevinChen2014/instagram-mcp (0, MIT, language not given; SocialDataX public search).
- Adjacent, outside the Instagram-account scope: pipeboard-co/meta-ads-mcp (1317, licence "Other", Python; Meta ads); gyoridavid/short-video-maker (1423, MIT; video creation); trypostit/trypost (719, AGPL-3.0, PHP; self-hosted scheduler with MCP, multi-network); matiasbattocchia/open-bsp-api (610, Unlicense, TypeScript; WhatsApp and Instagram business platform); ndesv21/socialclaw (97, MIT, JavaScript; multi-network scheduling CLI); publora/skills (58, MIT; skills for a multi-network MCP); Chatway-app/chatway-mcp-server (26, MIT; customer support chat); Owlseer-AI/Social-ops (18, MIT; "localhost-only by default" per description); guimatheus92/mcp-video-analyzer (95, MIT; analyses videos from Instagram and other URLs; yt-dlp topic); mrxehmad/rednote-instagram-auto-uploader (12, MIT; downloads RedNote videos and uploads to Instagram); Sharan-Kumar-R/Custom-MCP-Server (98, no licence; scrapes LinkedIn, Facebook, and Instagram profiles).
- Metadata from GitHub search (V): all stars and dates above come from the search API response for each repository.

### Cited Findings
- [V] IvanBBaev: 29 tools in six packages; every mutation passes a preview-by-default write gate; loopback HTTP default. [README](https://github.com/IvanBBaev/instagram-mcp)
- [V] IvanBBaev: the GitHub description says "28 professional-account tools"; the README says 29. [GitHub API](https://api.github.com/repos/IvanBBaev/instagram-mcp)
- [V] AleemHaider: "24 tools across five capability areas," built on FastMCP and httpx. [README](https://github.com/AleemHaider/instagram-mcp)
- [V] adelaidasofia: "official" describes the Graph API it calls; the README makes no Meta-affiliation claim. First-round open item 26 is partly settled. [README](https://github.com/adelaidasofia/instagram-mcp)
- [FS] mikusnuz: README lists 66 tools (33 Instagram, 27 Threads, 6 Meta) and Graph v26.0; the About text says 57 and v25.0. [GitHub page](https://github.com/mikusnuz/meta-mcp)
- [FS] oliverames: 37 of the 199 tools are Instagram; the page's section counts do not reconcile. [GitHub page](https://github.com/oliverames/meta-mcp-server)
- [FS] alexfisenkov: About says read-only; the tool list includes meta_publish_media. [GitHub page](https://github.com/alexfisenkov/meta-instagram-mcp)
- [FS] registry: 61 entries and 30 distinct names over three pages; the third page has no cursor. [registry](https://registry.modelcontextprotocol.io/v0/servers?search=instagram)
- [FS] registry: about 21 of the 30 names are public-data, scraper, downloader, or discovery services; five offer account actions (app.hooksend, co.civai.nova, KynuxDev, mcp-dir, setsmart); two are official owner-account servers (adelaidasofia, mcpware); one posts content through an unknown route (wmarceau); one description is unrelated (sadri-dridi) (see Table D). [registry](https://registry.modelcontextprotocol.io/v0/servers?search=instagram)
- [V] GitHub search API: 854 matches for "instagram mcp in:name,description,topics"; 207 matches for "instagram mcp in:name stars:0..9". [GitHub search API](https://api.github.com/search/repositories?q=instagram+mcp+in:name,description,topics)

### Inferences
- The owner-account, write-capable servers split into an official Graph API group and an unofficial session or cookie group. No sampled server combines the two per account.
- Most of the sample is public-data or downloader tooling. The owner's design differs from the market mainly through its gates and its event and caps model, not through its tool list (U).
- No sampled official server exposes an Instagram media like tool, including IvanBBaev, mikusnuz, and oliverames, which were all pushed in October 2026. This is an inference from absence in READMEs and summaries (U).
- The registry search likely misses servers whose names do not contain "instagram" (U).
- The 2026 pushes in the sample (IvanBBaev, pendpost, inssist, Shudesu, alexfisenkov) show active development. The most-starred official-route server is jlbadano/ig-mcp (197 stars, last push 2026-02-09); most others have 2 to 59 stars, so there is no clear de facto standard (U).

### Gaps
- KynuxDev: the GitHub search for user KynuxDev returned a validation error. Stars, last push, and licence API values were not retrieved; the README was read (V).
- mcp-dir/instagram-mcp: WebFetch returned HTTP 404 for the repository in the registry entry. The entry cannot be checked, and the repository may be private, moved, or removed (U).
- setsmart-git and mcpware: fetch summaries only; no API metadata retrieved.
- The GitHub search tail beyond 50 results per query was not read; the broader stars 0..9 query was not read at all.
- No repository code was read. Tool names and behaviour come from READMEs and fetch summaries; counts conflict in several repos (see Table C).
- Smithery, mcp.so, Glama, and PulseMCP were not searched in this round.

---

## Key question 1: Which servers expose direct-message tools, what are they named, and how do they paginate?

### Takeaway
Fifteen sampled servers expose a DM send tool, under at least five naming schemes (send_dm, send_message, instagram_send_message, ig_send_message, message_send_text). One more (alexfisenkov) exposes DM reads only. Only KynuxDev documents a paging parameter and auto-pagination (V). The official-route servers document no pagination, which matches the first round's finding that the official conversation list has no cursor, limit, or since filter and that message details reach only the 20 most recent messages (first round, verified there).

### Table F: DM tools by server

| Server | DM tools as named | Send or write tools | Pagination |
|---|---|---|---|
| AleemHaider (V) | list_conversations, get_conversation | send_dm (message_tag optional) | not stated |
| adelaidasofia (V) | list_conversations, get_messages | send_message (DM gate env flag) | not stated |
| jlbadano (V) | Get Conversations, Get Conversation Messages (feature names) | Send DM | not stated |
| KynuxDev (V) | instagram_get_inbox, instagram_get_thread, instagram_get_pending, instagram_search_inbox, instagram_search_messages | instagram_send_message, instagram_send_link, instagram_create_thread, instagram_like_message, instagram_unsend_message, instagram_mark_seen, instagram_approve_pending | cursor parameter; thread auto-paginates; max_pages on search |
| IvanBBaev (V) | none | none | not applicable |
| trypeggy (FS) | list_chats, list_pending_chats, search_threads, get_thread_by_participants, get_thread_details, list_messages, list_media_messages | send_message, send_photo_message, send_video_message, mark_message_seen | not stated ("filters/limits" on list_chats) |
| DavidCoder-agent (FS) | get_inbox, get_thread, get_thread_messages, search_direct_recipients | send_direct_text | not stated |
| braindead-dev (FS) | get_inbox, get_conversation(user) | send_message(user, message), react(user, emoji) | not stated |
| inssist (FS) | dm_list, dm_requests, dm_read | dm_send, dm_mark_seen, dm_accept, dm_remove | not stated |
| alexfisenkov (FS) | meta_read_inbox (operations inbox.list and conversation.read), meta_read_source | none named | not stated |
| William-Gao (FS) | get_conversations, get_conversation_messages | send_dm | not stated |
| openinstaflow (FS) | get_conversations, get_conversation_messages | send_dm | not stated |
| mcpware (FS) | get_conversations, get_conversation_messages | send_dm | not stated |
| mikusnuz (FS) | ig_get_conversations, ig_get_messages, ig_get_message | ig_send_message | not stated |
| exileum (FS) | ig_get_conversations, ig_get_messages, ig_get_message | ig_send_message | not stated |
| oliverames (FS) | meta_get_instagram_conversations, meta_get_instagram_messages; broadcast channel reads | meta_send_instagram_message, meta_send_instagram_media_message, meta_send_broadcast_channel_message, meta_create_broadcast_channel_poll | not stated |
| setsmart-git (FS) | conversation_list, conversation_search, conversation_get, conversation_get_messages | message_send_text, message_send_image, message_send_video, message_send_audio, message_send_template, message_send_reaction | not stated |
| Shudesu (FS) | no MCP tools named; admin inbox and automated triggers | automated comment-triggered and keyword-triggered DMs; broadcast | not stated |
| pendpost, HasData, storiesig, duhlink | none | none | not applicable |

### Cited Findings
- [V] KynuxDev lists 15 tools; thread reads "auto-paginate," and search takes max_pages; INSTAGRAM_RATE_LIMIT_MS sets a delay between paginated requests. [README](https://github.com/KynuxDev/mcp-instagram-dm)
- [V] AleemHaider: list_conversations, get_conversation, and send_dm (with an optional message_tag); the README says "Tags require Meta approval." [README](https://github.com/AleemHaider/instagram-mcp)
- [V] adelaidasofia: DM tools are named list_conversations, get_messages, and send_message; they "fail loud" until INSTAGRAM_MCP_DM_ENABLED=1 is set after App Review. [README](https://github.com/adelaidasofia/instagram-mcp)
- [V] IvanBBaev: no DM tools appear in its 29-tool table. [README](https://github.com/IvanBBaev/instagram-mcp)
- [FS] trypeggy: 22 tools, including send_message, send_photo_message, send_video_message, and mark_message_seen; no pagination described. [GitHub page](https://github.com/trypeggy/instagram_dm_mcp)
- [FS] registry and GitHub: setsmart's 30 tools include message_send_text through message_send_reaction, with conversation_list and conversation_get_messages for reads. [GitHub page](https://github.com/setsmart-git/instagram-mcp)
- [FS] braindead: get_conversation may mark the thread as seen, because IG_AUTO_MARK_SEEN defaults to true. [GitHub page](https://github.com/braindead-dev/instagram-dms-mcp)
- [FS] first round (verified there): the official Conversations API has no documented cursor, limit, or since filter, and message details reach the 20 most recent messages. [first-round report](D:\Projects2\InstagramApi\reports\Instagram CLI automation landscape.md)

### Inferences
- Pagination is the weakest documented area across the sample. A list tool built on the official route will likely need a fixed window of the newest messages, which is consistent with the owner's ig_dm_messages design and the 20-message limit (U).
- Reads with side effects (mark-seen on open) appear in two DM servers. The owner's read tools should be side-effect free and any mark-as-read should be an explicit outbound action (U).

### Gaps
- Pagination is not stated for 14 of the 15 send-capable servers; their code was not read.
- The official route's current behaviour (cursor, limit, or since) was not re-checked in this round; the first-round report is the source.

---

## Key question 2: Which servers signal new messages, and how?

### Takeaway
No sampled server consumes Meta message events through MCP tools with a pull, ack, or decide model. Three expose webhook subscription tools without an event read path (mikusnuz, exileum, oliverames, for Facebook pages). Shudesu runs a Meta webhook receiver on Cloudflare Workers that triggers DMs; braindead can forward incoming DMs to a third-party service. DavidCoder exposes activity notifications as pull tools. The owner's pull design (ig_events_pending, ig_events_ack, ig_events_decide) has no sampled counterpart. Claude Code documents surfacing of channel notifications, not of the generic MCP notifications.

### Cited Findings
- [V] IvanBBaev, AleemHaider, adelaidasofia, and KynuxDev expose no event, webhook, or subscription tools. [README](https://github.com/IvanBBaev/instagram-mcp); [README](https://github.com/AleemHaider/instagram-mcp); [README](https://github.com/adelaidasofia/instagram-mcp); [README](https://github.com/KynuxDev/mcp-instagram-dm)
- [FS] mikusnuz: meta_get_webhook_subscriptions and meta_subscribe_webhook exist; the page does not say how events reach the server or whether they cover DMs. [GitHub page](https://github.com/mikusnuz/meta-mcp)
- [FS] exileum: the same two webhook tools; no event read tool. [GitHub page](https://github.com/exileum/meta-mcp)
- [FS] oliverames: meta_subscribe_page_webhooks is for Facebook pages only. [GitHub page](https://github.com/oliverames/meta-mcp-server)
- [FS] Shudesu: Meta webhooks reach a Cloudflare Worker; entry.id routes to the account; multi-secret signature verification; a cron runs every 5 minutes for delivery, token refresh, and liveness probes. [GitHub page](https://github.com/Shudesu/ig-harness-oss)
- [FS] braindead: incoming DMs are sent to Poke, in the format "Instagram DM from @username: message", when POKE_API_KEY is set; no polling or webhook mechanism is described. [GitHub page](https://github.com/braindead-dev/instagram-dms-mcp)
- [FS] DavidCoder: get_notifications and get_news_inbox are pull tools for activity notifications. [GitHub page](https://github.com/DavidCoder-agent/instagram-mcp-server)
- [FS] Claude Code channels: a channel is an MCP server that pushes events into a running session; it declares the claude/channel capability and emits notifications/claude/channel; Claude Code does not acknowledge notifications and drops them silently if the channel is not loaded or is blocked; custom channels need --dangerously-load-development-channels during the research preview; "An ungated channel is a prompt injection vector." [channels reference](https://code.claude.com/docs/en/channels-reference)
- [U] A search snippet says Claude Code 2.1.80 or newer is required, and that a May 2026 issue reported inbound notifications dropped in 2.1.119 to 2.1.142, closed as resolved. [search snippet](https://claudeissues.com/issue/59240-inbound-channel-notifications-silently-dropped-notifications-claude-channel-neve)
- [V, Context7 copy] MCP spec (main branch, 2026-07-28 path): tools/list_changed and resources/updated are delivered on a subscriptions/listen stream; request-scoped notifications (progress, message) travel only on their request's response stream. [spec](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx)

### Answer to the spec's open question on push notifications
- The spec says MCP push notifications are added "only if the deeper comparison confirms that clients surface them" ([design spec](D:\Projects2\InstagramApi\docs\superpowers\specs\2026-10-20-instagram-cli-design.md), section Calls, item P).
- Surfacing is documented for Claude Code channel notifications only (FS, research preview). No source read in this round documents client surfacing of the generic MCP notifications (tools/list_changed, resources/updated, logging) (U).
- No sampled server README or summary mentions emitting MCP notifications (U; code not read).

### Inferences
- The owner's in-process webhook receiver with a pull event log is unusual in the sample. No sampled server shows a reference handshake, dedupe, or retention design for it (U).
- If channels are used, DM text would reach the model as pushed context. The channel docs treat this as a prompt-injection path that needs sender gating; the owner's design would need the same gating, and DM text should be treated as untrusted on any path (inference from the docs).
- Multi-secret signature verification (Shudesu) is a useful pattern for app-secret rotation. It is described only in a fetch summary (FS).

### Gaps
- Whether any MCP client surfaces generic MCP notifications: not checked.
- Whether channel notifications remain available after the research preview: unknown.
- Live webhook behaviour (handshake, retries, signature scheme) was not tested; the first round lists these as open facts.

---

## Key question 3: Which servers use confirmation parameters, dry runs, or preview modes, and how do they word them?

### Takeaway
Three servers have a write gate of some kind: IvanBBaev (preview by default; apply: true or IG_WRITE_MODE=apply; a second gate for deletes), alexfisenkov (confirm: true plus META_INSTAGRAM_WRITE=true, both checked before any network call), and pendpost (a draft, approve, or reject state machine with fail-closed publishing). No sampled DM tool takes a confirmation parameter. The MCP SDK documents annotations (readOnlyHint, destructiveHint, idempotentHint) as hints that let a host auto-approve reads and confirm destructive calls.

### Cited Findings
- [V] IvanBBaev: "every mutation passes through a preview-by-default write gate"; "A write returns a non-mutating preview describing exactly what would change; nothing is sent to Meta"; "Pass apply: true on the call, or set IG_WRITE_MODE=apply for standing consent"; deletes also need IG_ALLOW_DESTRUCTIVE=true; a client that supports MCP elicitation "is asked to confirm each applied write." [README](https://github.com/IvanBBaev/instagram-mcp)
- [V] IvanBBaev: "Every tool carries MCP annotations (readOnlyHint, destructiveHint, idempotentHint) so clients apply the right confirmation UX." [README](https://github.com/IvanBBaev/instagram-mcp)
- [FS] alexfisenkov: publish requires "confirm: true" and the env flag META_INSTAGRAM_WRITE=true; "both are checked before any network call." [GitHub page](https://github.com/alexfisenkov/meta-instagram-mcp)
- [FS] pendpost: "a post with no approval will not publish" (fail-closed); approval is required by default; auto-approve is "owner-only and revocable"; the page's PENDPOST_MODE=mock is "a test/demo fixture," not a tool option. [GitHub page](https://github.com/pendpost/pendpost)
- [FS] inssist: "Pairing is automatic: the toggle is the consent." instant: true "should use it only when you asked for an immediate action." No confirmation step for dm_send or draft_publish is described. [GitHub page](https://github.com/inssist/mcp)
- [FS] exileum: auto_publish_text (default true) and auto_publish on Threads publishing are flow controls, not confirmations. [GitHub page](https://github.com/exileum/meta-mcp) [FS] mikusnuz has Threads reply approvals (enable_reply_approvals; threads_manage_pending_reply, "Approve or ignore a pending reply"). [GitHub page](https://github.com/mikusnuz/meta-mcp)
- [FS] oliverames: meta_test_conversion_events is "Test CAPI setup without affecting production data," yet it sends test events; meta_get_ad_preview is a rendering preview. [GitHub page](https://github.com/oliverames/meta-mcp-server)
- [FS] alexfisenkov: the page calls the container step a "dry run" but names no flag for it. [GitHub page](https://github.com/alexfisenkov/meta-instagram-mcp) [FS] William-Gao: its --force flag is a token refresh attempt, not a confirmation. [GitHub page](https://github.com/William-Gao/instagram-mcp)
- [V] adelaidasofia: DM tools are "review-gated" in the description; the mechanism in the README is the App Review plus env flag, not a per-message confirmation. [README](https://github.com/adelaidasofia/instagram-mcp)
- [V] AleemHaider: send_dm accepts message_tag (HUMAN_AGENT), which "require[s] Meta approval"; this is a policy tag, not a confirmation. [README](https://github.com/AleemHaider/instagram-mcp)
- [V, Context7 copy] MCP TypeScript SDK: annotations "never change how the SDK runs the tool"; "a host can auto-approve a read-only tool and require confirmation before a destructive one." [SDK docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md)
- [V, Context7 copy] MCP spec: elicitation/create uses mode "form" with a flat requestedSchema; the client returns accept, decline, or cancel. [spec](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/client/elicitation.mdx)

### Inferences
- The owner's confirm: true pattern is the same idea as IvanBBaev's apply: true, but it applies to DM sends, where no sampled server has a gate. Its HTTP API cannot use MCP elicitation, so an explicit parameter is still needed for HTTP parity (inference).
- Annotations are not mentioned in the owner's spec. Adding readOnlyHint and destructiveHint to every tool would let clients apply their own confirmation UX (inference from the SDK docs and IvanBBaev).

### Gaps
- Whether any client renders elicitation prompts for these servers was not checked.
- The wording of pendpost's approval controls is from a fetch summary; quotes need checking on the live page.

---

## Key question 4: Comparison with the owner's planned tools: gaps filled and ideas to copy

### Takeaway
The owner's list fills gaps no sampled server covers: one status tool that merges routes, caps, stop state, and webhook state; a fail-closed stop state with an explicit clear; per-action local caps; a pull event log with ack and decide; a local unread model; and a confirm gate for owner-authored DM sends. The closest analogues are pendpost's breaker and approval states, IvanBBaev's preview gate and doctor command, and inssist's per-account queue. The spec's Tools list omits ig_stop_status and ig_stop_clear, which the brief names.

### Table G: Owner tool against the closest analogue in the sample

| Owner tool (brief or spec) | Closest analogue in the sample | Status |
|---|---|---|
| ig_status (routes, caps, stop, webhook state) | IvanBBaev doctor and instagram_token_status (V); Shudesu /api/health with checkpoint and freeze checks (FS); adelaidasofia healthcheck and account_info (V); pendpost account_status and pendpost_health (FS) | Partial; no sampled tool merges all four |
| ig_stop_status and ig_stop_clear | pendpost breaker on Meta error 368, "never auto-resumes," plus a lane kill switch (FS) | Partial; closest is pendpost. Neither name is in the spec Tools list |
| ig_caps_status | publishing-limit tools in many servers (V and FS); x-app-usage throttle in mikusnuz and exileum (FS); pendpost cadence cap that defers bursts (FS); inssist per-account spacing queue (FS) | Gap for per-action local caps |
| ig_events_pending | none (webhook subscription tools only in mikusnuz, exileum, oliverames) | Gap |
| ig_events_ack | none | Gap |
| ig_events_decide | pendpost approve_post and reject_post (FS); mikusnuz threads_manage_pending_reply, "Approve or ignore" (FS) | Partial; naming only, no event store |
| ig_events_purge | none | Gap |
| ig_dm_unread | KynuxDev inbox output shows an [UNREAD] label (V, README example); alexfisenkov reports unread as "unknown" until proven (FS) | Gap for a local unread model |
| ig_dm_conversations, ig_dm_messages | see Table F | Covered by many; pagination unstated |
| ig_dm_send with confirm | IvanBBaev apply gate (V; no DMs); alexfisenkov confirm plus env flag (FS). None of the 15 DM send servers in Table F documents a confirmation step | Gap in the sample for DM sends |
| ig_autoreply_set (off by default) | none that is off by default; Shudesu and vinipace automate comment-triggered DMs (anti-goal) | Gap; keep the owner's design |
| ig_like, ig_unlike | no official-route server; unofficial like tools in trypeggy and DavidCoder (FS) | Covered only by unofficial servers |
| ig_follow, ig_unfollow (phase 2) | DavidCoder follow_user and unfollow_user (FS); inssist follower_remove and ig_block (FS) | Unofficial only; the owner's design gates them |

### Cited Findings
- [V] Spec, Tools section: lists ig_status, ig_caps_status, ig_autoreply_set, ig_events_purge, ig_dm_unread, ig_dm_send, and the events tools; it does not list ig_stop_status or ig_stop_clear. Section G says "ig_status shows the stop, and outbound actions resume only after the owner clears it with an explicit tool call," without naming the clear tool. The brief names both. [design spec](D:\Projects2\InstagramApi\docs\superpowers\specs\2026-10-20-instagram-cli-design.md)
- [V] Spec, Architecture section: the HTTP API is described as "JSON routes ... plus /webhooks/instagram"; no bind address or default is given. [design spec](D:\Projects2\InstagramApi\docs\superpowers\specs\2026-10-20-instagram-cli-design.md)
- [V] Spec: no mention of MCP tool annotations. [design spec](D:\Projects2\InstagramApi\docs\superpowers\specs\2026-10-20-instagram-cli-design.md)
- [V] Context7 copy of the MCP TypeScript SDK lists v2.3.1 and v1.29.0 as versions; IvanBBaev builds on the v2 split packages (@modelcontextprotocol/server and @modelcontextprotocol/node) with zod 4. The spec asks for the SDK version to be confirmed on npm before coding. [README](https://github.com/IvanBBaev/instagram-mcp); [Context7 listing](https://github.com/modelcontextprotocol/typescript-sdk)
- [V] IvanBBaev: the per-call guard "still rejects a mismatched account argument"; a profile model holds one account per profile. [README](https://github.com/IvanBBaev/instagram-mcp)
- [FS] pendpost: an action block from Meta (error 368) activates a breaker that stops the Meta lane; the lane "never auto-resumes"; a cadence cap "postpones bursts instead of discarding them." [GitHub page](https://github.com/pendpost/pendpost)
- [FS] inssist: "spaces agent calls a few seconds apart on one per-account queue"; a call that would wait longer than about 50 seconds is refused "with busy: true and retryAfterMs." [GitHub page](https://github.com/inssist/mcp)
- [FS] Shudesu health endpoint: token days left per account; live checks for checkpoint and freeze; last webhook received; DM delivery failure count; cron liveness. [GitHub page](https://github.com/Shudesu/ig-harness-oss)

### Ideas to copy (ordered by fit with the owner's design)
1. Preview by default for every write, applied with an explicit flag, with an applied-write journal and a second gate for destructive calls (IvanBBaev, V). Fits the owner's confirm gate and audit log.
2. MCP annotations on every tool: readOnlyHint for reads; destructiveHint for deletes, sends, and publishes (IvanBBaev, V; SDK docs, V). Not in the spec.
3. A profile name that forces read-only tools, rather than a list that can be edited into write access (IvanBBaev, V). Fits the owner's "reader" use.
4. Loopback default for HTTP; refuse non-loopback binds without a bearer token; log a loud error when no token is set on loopback (IvanBBaev, V). The spec does not state a default.
5. A doctor command and a token status with days left and a refresh threshold (IvanBBaev, V). Feeds ig_status.
6. A breaker on action-block errors that never auto-resumes, with a manual clear and a kill switch (pendpost, FS). Matches the owner's G; use it as the model for ig_stop_clear.
7. Defer rather than drop when a cadence cap is hit (pendpost, FS). Use it for the 2-second spacing rule: queue and return busy with retryAfterMs, instead of failing.
8. A per-account queue returning busy with a retry hint, and an instant flag for owner-requested immediate actions (inssist, FS).
9. A fixed error_type set with remediation text (mikusnuz, exileum, FS). Matches the owner's fixed error kinds.
10. A scrubber on tool output as well as logs (adelaidasofia, V, scrubs results before they reach the model; IvanBBaev, V, redacts before log sinks). The owner's log redactor should also cover tool output.
11. Cursor parameters and max_pages on list tools (KynuxDev, V), once the official pagination is verified.
12. Multi-secret webhook verification for app-secret rotation (Shudesu, FS).
13. A live contract test gated by a key and run on a schedule (HasData, FS). Fits the owner's live phase if it is manual and capped.
14. A distinct exit code for a dead token that needs browser re-login (William-Gao, FS). Fits the owner's refresh error path.

### Patterns to avoid (seen in the sample; outside the owner's anti-goals)
- Comment- or follow-triggered DMs, broadcast DMs, and keyword DM sequences (Shudesu, FS; vinipace, U).
- Likes, follows, and unfollows as bulk tools (trypeggy like_media, DavidCoder follow_user and like_media, FS).
- Session cookies or browser-profile reuse for an account (KynuxDev, braindead, DavidCoder, inssist, duhlink, FS or V).
- Passwords on the command line (trypeggy, FS), and cookies or tokens in plain client config env blocks (many; Table C).
- Tokens or the app secret in URL query strings (jlbadano, V; mcpware sample, FS) and in shell commands (AleemHaider curl, V).
- Forwarding DM text to a third-party service (braindead to Poke, FS), and hosting account tokens with a third party (setsmart, FS). Shudesu stores follower profile data in Cloudflare D1 and R2 (FS).
- Public-data scraping, profile intelligence (including bio emails), and download tools (Table D and E).
- Ads and Facebook Page surfaces (oliverames, pipeboard): outside the spec's non-goals.

### Inferences
- The owner's list is the only one in the sample with a stop state and a pull event log. Keep both; name ig_stop_status and ig_stop_clear in the spec.
- The spec's HTTP API and webhook receiver need a bind decision. The webhook must be reachable by Meta, so the receiver likely needs its own listener or a reverse proxy, while the API stays on loopback (inference from the spec and IvanBBaev).
- The sample's lack of like tools on official routes supports the first round's view that the like endpoint is new and not yet widely wired. The owner's ig_like is a differentiator if the spike confirms it (U).

### Gaps
- Whether ig_stop_status and ig_stop_clear should exist as separate tools or as parameters of ig_status: an owner decision.
- Whether the owner's event retention and message-text storage match any sampled practice: none of the sampled servers documents message retention.

---

## Key question 5: Security posture: credentials in config, secrets in logs, HTTP bind addresses

### Takeaway
Most servers that were read keep account secrets in MCP client config env blocks or in plain .env files; 18 of the 22 servers in Table C do. Three put a password, an app secret, or a token on a command line or in a URL (trypeggy, AleemHaider, jlbadano). Verified log protection is rare: IvanBBaev (a redactor, and login, refresh, and doctor never print secrets) and adelaidasofia (a scrubber on results and an audit log) are the clear cases; exileum redacts only some internal errors; most other fetch summaries say "not stated." No sampled local HTTP server binds to 0.0.0.0 by default: IvanBBaev and exileum default to 127.0.0.1:3000, pendpost to 127.0.0.1:8090, and inssist to 127.0.0.1:48231. exileum allows 0.0.0.0 with no server-side auth. The owner's spec does not state a default bind address.

### Cited Findings
- [V] IvanBBaev: the env file is written "owner-only (0600)" on POSIX; access tokens, app secrets, and appsecret_proof values are "masked by a secret redactor before anything reaches a log sink." Leaving IG_HTTP_TOKEN unset means "no authentication at all"; it is allowed only on loopback and logged at error level; a non-loopback bind without a token is refused. [README](https://github.com/IvanBBaev/instagram-mcp)
- [V] adelaidasofia: "every result and error passes a scrubber that strips access tokens ... before it reaches the model"; each call appends a 4-field JSONL audit line; egress is pinned to two Meta hosts. Tokens go to the OS keychain on macOS, and "a chmod 600 file on other platforms." [README](https://github.com/adelaidasofia/instagram-mcp)
- [FS, first round] On Windows, file permission bits do not restrict other users; the 0600 and chmod 600 fallbacks therefore give no protection on the owner's machine. [first-round report](D:\Projects2\InstagramApi\reports\Instagram CLI automation landscape.md)
- [V] AleemHaider: a helper writes .env with IG_ACCESS_TOKEN; the Claude Desktop example holds the token in plain env; a curl example passes client_secret with -G, which places it in the URL. [README](https://github.com/AleemHaider/instagram-mcp)
- [V] jlbadano: the README's token-refresh code puts access_token into a URL query string; the README sets LOG_LEVEL=DEBUG and claims "Audit Logging: Log all API interactions" without a redaction statement. [README](https://github.com/jlbadano/ig-mcp)
- [V] KynuxDev: three Instagram session cookies go into the client config env block; the README says "Session cookies are never logged or stored beyond runtime" (claim, not code). [README](https://github.com/KynuxDev/mcp-instagram-dm)
- [FS] trypeggy: the recommended path puts INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env; the CLI example puts --password in the saved client config JSON; a session cache file's location is not stated. [GitHub page](https://github.com/trypeggy/instagram_dm_mcp)
- [FS] exileum: the server has no auth; the page "advises a reverse proxy for TLS and authentication in front"; MCP_HTTP_HOST=0.0.0.0 is accepted; DNS-rebinding protection is off unless MCP_HTTP_ALLOWED_HOSTS is set for non-loopback binds, with a stderr warning; internal errors replace access_token, client_secret, and input_token with ***. [GitHub page](https://github.com/exileum/meta-mcp)
- [FS] oliverames: tokens are read from a 1Password CLI at startup when unset, with a quiet fallback; redaction in logs not stated. [GitHub page](https://github.com/oliverames/meta-mcp-server)
- [FS] pendpost: default bind 127.0.0.1:8090; "keeps secrets only in your own .env," which is gitignored; log redaction not stated. [GitHub page](https://github.com/pendpost/pendpost)
- [FS] inssist: local WebSocket on 127.0.0.1:48231 that "accepts connections only from chrome-extension:// origins" (claim); pairing file ~/.inssist/mcp-pairings.json at mode 0600; the page says no Instagram credentials are held (claim). [GitHub page](https://github.com/inssist/mcp)
- [FS] HasData: the key is sent in an x-api-key header and written into client config files such as .cursor/mcp.json and claude_desktop_config.json. [GitHub page](https://github.com/HasData/instagram-mcp)
- [FS] braindead: cookies go into a local .env or the Render env block as IG_COOKIES; Poke receives message text when configured. [GitHub page](https://github.com/braindead-dev/instagram-dms-mcp)
- [FS] Shudesu: follower profile data and profile images are stored in D1 and R2; message text retention is not described. [GitHub page](https://github.com/Shudesu/ig-harness-oss)
- [FS] setsmart: the workspace key sits in the client config env block and is sent in an Authorization header per request; the page calls it a "long lived static secret." [GitHub page](https://github.com/setsmart-git/instagram-mcp)

### Table H: HTTP and bind summary

| Server | Local HTTP? | Default bind | Non-loopback allowed? | Auth on HTTP |
|---|---|---|---|---|
| IvanBBaev | opt-in | 127.0.0.1:3000 | yes, only with a token | optional bearer; unset means no auth (loopback only) |
| exileum | opt-in | 127.0.0.1:3000 | yes (0.0.0.0 accepted) | none in server; reverse proxy advised |
| pendpost | yes | 127.0.0.1:8090 | not stated | dashboard and /mcp; auth not stated |
| alexfisenkov | opt-in | not stated | not stated | bearer secret |
| inssist | local WebSocket | 127.0.0.1:48231 | not stated | extension-origin check (claim) |
| hosted servers (HasData, storiesig, Shudesu, braindead on Render, setsmart upstream) | no local listener | vendor-hosted | not applicable | vendor key or OAuth |
| all other stdio servers | no | not applicable | not applicable | not applicable |

### Inferences
- Credentials in config are the sample norm. The owner's keyring design (spec, decision H) is a real differentiator. On Windows, the owner should not rely on file permissions; the keyring is the right choice (inference from the first round).
- Hosted servers are the main custodians of account secrets in the sample. The owner's rule against third-party hosting avoids that exposure (inference).
- The owner's spec should state the HTTP bind default. A safe proposal: loopback by default, a refusal to bind non-loopback without a token, a DNS-host allowlist for any non-loopback bind, and a separate public listener for /webhooks/instagram behind TLS (inference from IvanBBaev and exileum).

### Gaps
- Redaction of secrets in logs was not verified for any server's code.
- The bind behaviour of alexfisenkov's and pendpost's HTTP modes beyond the fetch summaries was not checked.
- The owner's own message-text retention is not compared with any sampled practice; no sampled server documents message retention.
- Windows ACL behaviour of the sampled secret files was not tested.
