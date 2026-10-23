# Personal-account Instagram libraries: research notes

Research date: 2026-10-20. Scope: instagrapi (Python), instagram-private-api (TypeScript), jlobos/instagram-web-api (JavaScript, web endpoints), instagram_mqtt (TypeScript realtime companion), and the consumer project supreme-gg-gg/instagram-cli, which uses the TypeScript pair. Checked for personal-account actions, maintenance, and fit with the brief as summarized in this research. No installs, runtime tests, or live-account actions were run.

## Labels

- **verified**: read directly from a source file, CHANGELOG, LICENSE, package.json, CI config, a directory listing, a search hit showing the source line, or a GitHub API field, at the cited ref.
- **fetch summary**: taken from a fetched documentation page, a search result, an issue title or list field, or a sub-agent summary of fetched content. Not checked against the pinned source file.
- **unverified**: not checked, only named (for example, in a CHANGELOG line, or in a search hit whose file was not read), or a claim the research could not confirm.
- **inference**: a conclusion drawn from labeled facts. Tagged `[inference]` and names the facts it rests on.

Every fact carries one of the first three labels. Inferences also carry the inference tag.

## Summary

- [verified] Only instagrapi shows release activity in 2026; its release notes run through 2026-10-17. The default branches of the other three repositories last changed on 2024-03-07 (instagram-private-api), 2020-08-06 (jlobos), and 2024-04-23 (instagram_mqtt).
- [inference] Only instagrapi appears actively maintained. This rests on the commit dates above and the issue dates in each section.
- [verified] instagrapi and instagram-private-api each list most of the action list. Parts of that coverage are fetch summary, not source: instagrapi's DM methods and login signature, and instagram-private-api's insights and notifications. jlobos has no DM, 2FA, or insights code in its full source read. instagram_mqtt covers realtime transport only.
- [fetch summary] The instagrapi 2026 issue sample is dominated by login and challenge-flow reports: 25 of 102 sampled 2026 issues. The category assignment is an inference from titles.
- [verified] instagrapi 3.0.0 (2026-09-13) made login() use CAA directly. The previous flow is kept as login_legacy().
- [inference] The brief's device and challenge rules, as summarized, affect all four libraries. They may decide the choice more than coverage does.

## Pinned sources and links

| Item | Repo | Ref | Ref date | Link |
|---|---|---|---|---|
| instagrapi | subzeroid/instagrapi | 143b68fd084d11e84a17b78eeb71d1cfb69d3f33 [verified] | CHANGELOG latest entry 2026-10-17 [verified] | https://github.com/subzeroid/instagrapi/tree/143b68fd084d11e84a17b78eeb71d1cfb69d3f33 |
| instagram-private-api | dilame/instagram-private-api | 3a153c4e807049e95d72af67e316d432c2fd1577, default-branch head [verified, GitHub API] | 2024-03-07 [verified, GitHub API] | https://github.com/dilame/instagram-private-api/tree/3a153c4e807049e95d72af67e316d432c2fd1577 |
| jlobos/instagram-web-api | jlobos/instagram-web-api | e85a0f603e5be9e147606feed73a5057d74c5c60, default-branch head [verified, GitHub API] | 2020-08-06 [verified, GitHub API] | https://github.com/jlobos/instagram-web-api/tree/e85a0f603e5be9e147606feed73a5057d74c5c60 |
| instagram_mqtt | Nerixyz/instagram_mqtt | f2672ac2c1167859e4fcc3a2d0f6a4660a33250b, default-branch HEAD [verified] | 2024-04-23 [verified] | https://github.com/Nerixyz/instagram_mqtt/tree/f2672ac2c1167859e4fcc3a2d0f6a4660a33250b |
| consumer: instagram-cli | supreme-gg-gg/instagram-cli | c21c2ba, short SHA as recorded [verified] | not recorded [unverified] | https://github.com/supreme-gg-gg/instagram-cli |

Base URLs for file paths. Each section's file paths are relative to its base.

- instagrapi: https://github.com/subzeroid/instagrapi/blob/143b68fd084d11e84a17b78eeb71d1cfb69d3f33/
- instagram-private-api: https://github.com/dilame/instagram-private-api/blob/3a153c4e807049e95d72af67e316d432c2fd1577/
- jlobos: https://github.com/jlobos/instagram-web-api/blob/e85a0f603e5be9e147606feed73a5057d74c5c60/
- instagram_mqtt: https://github.com/Nerixyz/instagram_mqtt/blob/f2672ac2c1167859e4fcc3a2d0f6a4660a33250b/
- consumer: https://github.com/supreme-gg-gg/instagram-cli/blob/c21c2ba/

Other links:
- [verified, GitHub API this session] Fork Nerixyz/instagram-private-api, default-branch head 5d0228e737f57f64eaf00971384c319744bb4ab2, dated 2022-02-15, message "Merge branch 'dilame:master' into master": https://github.com/Nerixyz/instagram-private-api/commit/5d0228e737f57f64eaf00971384c319744bb4ab2
- [fetch summary] A docs page cites the fork at commit b3351b9: https://github.com/Nerixyz/instagram-private-api/blob/b3351b9/src/feeds/direct-pending.feed.ts#L18
- [verified, GitHub API this session] Head commit of dilame/instagram-private-api: https://github.com/dilame/instagram-private-api/commit/3a153c4e807049e95d72af67e316d432c2fd1577
- [verified, GitHub API this session] Head commit of jlobos/instagram-web-api: https://github.com/jlobos/instagram-web-api/commit/e85a0f603e5be9e147606feed73a5057d74c5c60

## Comparison table

| Area | instagrapi (Python) | instagram-private-api (TypeScript) | jlobos/instagram-web-api (JS, web endpoints) | instagram_mqtt (TypeScript, realtime companion) |
|---|---|---|---|---|
| Last code change | Release notes through 2026-10-17 [verified] | 2024-03-07, head 3a153c4 [verified] | 2020-08-06, head e85a0f6 [verified] | 2024-04-23, HEAD f2672ac [verified] |
| Latest issue in sample | 2026-10-18, #2890 [fetch summary] | 2026-08-10, #1853 [fetch summary] | 2024-04-04, #309 [fetch summary] | 2024-12-10, #123 [fetch summary] |
| License | Not checked [unverified] | Not checked [unverified] | Not checked [unverified] | MIT [verified] |
| Language and entry | Python package [verified] | TypeScript, src/ .ts files [verified] | JavaScript, lib/index.js [verified] | TypeScript, Node 18 or later [verified] |
| Follow, unfollow, like, comment | Yes: user_follow, user_unfollow, media_like, media_comment [verified] | Yes: FriendshipRepository create and destroy, MediaRepository like, unlike, comment [verified] | Yes: follow, unfollow, like, unlike, addComment [verified] | n/a |
| DM list, read, send | Yes: direct_threads, direct_thread, direct_send [fetch summary; source unverified] | Yes: DirectInboxFeed, DirectThreadFeed, broadcastText [verified] | No [verified] | MQTT message-sync types only, as imported by the consumer [verified]; DM event names [unverified] |
| DM seen or unread | Not found [unverified] | Item-level markItemSeen [verified]; unseen_count field [verified]; thread-level read flag not found [unverified] | No [verified] | Unverified |
| Stories list and seen | user_stories and story_seen [verified]; story_info definition [unverified] | ReelsTray and userStory feeds [fetch summary; consumer calls verified]; StoryService.seen [fetch summary] | getStoryReelFeed, getStoryItemsByUsername, markStoryItemAsSeen [verified] | n/a |
| Story upload | Not located [unverified] | broadcastStory into DM threads [verified] | uploadPhoto with story type, image only [verified] | n/a |
| Reels upload | Names in CHANGELOG only [unverified] | PublishService helpers seen at call sites [verified]; upload path [unverified] | No [verified] | n/a |
| Insights | insights_account [verified]; business accounts only [verified, per read]; other insights methods [unverified] | InsightsService account, post, story [fetch summary] | No [verified] | n/a |
| Notifications | news_inbox_v1 and notification settings [verified] | NewsFeed request and items [fetch summary] | getActivity only [verified] | n/a |
| Edit profile | account_edit, account_set_biography [verified] | editProfile [verified] | updateProfile, changeProfilePhoto [verified] | n/a |
| Two-factor login | TOTP helpers [verified]; login verification_code parameter [fetch summary; source unverified] | twoFactorLogin [verified] | No two-factor branch [verified] | n/a |
| Session save and restore | dump_settings, load_settings [verified]; set_settings [unverified] | State serialize and deserialize [verified] | Cookie jar only; no restore path reads credentials back [verified] | n/a |
| Realtime | realtime module [verified]; event names [unverified] | No realtime directory among the src directories listed [verified]; full tree [unverified] | None [verified] | RealtimeClient, MQTToTClient, FbnsClient [verified]; event keys [unverified] |
| Challenge code | challenge_resolvers.py example [verified]; challenge flows named in CHANGELOG [verified text] | Challenge and checkpoint error classes [verified]; code paths [unverified] | getChallenge, updateChallenge, resetChallenge, replayChallenge, _navigateChallenge [verified] | Unverified |
| Client identity | Android app profile [verified CHANGELOG text; fetch summary issue title] | state generateDevice signature [verified]; body [unverified] | Browser user agent and ig_cb cookie [verified] | Frida helper, per an issue title [fetch summary] |
| Tests and packaging | py.typed absent [verified]; tests/ has 6 entries [verified] | No tests; dist not committed [verified] | test/index.js; npm test runs xo and ava [verified] | No tests; test script exits with an error [verified] |

## Per-library findings

### 1. instagrapi (Python)

Base: https://github.com/subzeroid/instagrapi/blob/143b68fd084d11e84a17b78eeb71d1cfb69d3f33/

#### Repository facts
- `py.typed` is absent from `instagrapi/`. [verified]
- `tests/` contains `__init__.py`, `helpers.py`, `http2_server.py`, `socks5_proxy.py`, and directories `live/` and `regression/`. [verified]
- `examples/` has 22 files, including `challenge_resolvers.py`, `session_login.py`, `direct_message.py`, `upload_story.py`, `upload_media.py`, `load_session_cookie.py`, `bot.py`, and `diagnose_login.py`. [verified]
- `instagrapi/realtime/` contains `__init__.py` (180 B), `client.py` (18,296 B), `fbns.py` (12,437 B), and `mqttot.py` (21,751 B). `instagrapi/mixins/realtime.py` (2,479 B) was read in full. [verified]
- `instagrapi/mixins/direct.py` (71,792 B, blob a259f7e4) exists and was not read. [verified listing; contents unverified]
- Present but not read: `instagrapi/mixins/signup.py` (42,304 B), `instagrapi/mixins/attestation.py` (7,601 B), `instagrapi/utls.py` (11,106 B), `instagrapi/utls_build.py` (8,633 B), `instagrapi/utls_native.py` (8,400 B), `instagrapi/native/`, and `instagrapi/mixins/captcha.py` (3,946 B). Their contents: [unverified].
- A root `story.py` (12,246 B) exists alongside `instagrapi/mixins/story.py`. [verified listing]

#### Action map

| # | Action | Method or location | Label | Notes |
|---|---|---|---|---|
| 1 | Follow | `user_follow(self, user_id: str) -> bool`, mixins/user.py | [verified] | Takes a user ID, not a username. Private accounts send a request [fetch summary, docs user.html]. |
| 1b | Name to ID | `user_info_by_username(username)` returns a dict with `pk` | [fetch summary, docs user.html]; source [unverified] | Used with user_follow. |
| 2 | Unfollow | `user_unfollow(self, user_id: str) -> bool`, mixins/user.py | [verified] | |
| 3 | Like | `media_like(self, media_id: str, revert: bool = False) -> bool`, mixins/media.py | [verified] | Has a revert flag. |
| 3b | Unlike | `media_unlike(self, media_id: str) -> bool`, mixins/media.py | [verified] | |
| 4 | Comment and reply | `media_comment(self, media_id: str, text: str, replied_to_comment_id: Optional[int] = None) -> Comment`, mixins/comment.py | [verified] | Reply through replied_to_comment_id. |
| 5 | DM threads list | `direct_threads(amount)` | [fetch summary, docs direct.html]; source [unverified] | direct.py not read. Searches for `def direct_threads` returned no hits, a known search gap. |
| 6 | Read one DM thread | `direct_thread(thread_id, amount)`, `direct_messages(thread_id, amount)`, `direct_message(thread_id, message_id)` | [fetch summary]; source [unverified] | |
| 7 | Send DM | `direct_send(text, user_ids=[], thread_ids=[], reply_to_message=None)`; `direct_answer(thread_id, text)` | [fetch summary]; source [unverified] | Recipients who restrict requests raise DirectMessageRequestsDisabled [fetch summary]. |
| 8 | DM pending and requests | `direct_pending_inbox(amount)`, `direct_requests(amount)`, `direct_request_approve(request_id)` | [fetch summary] | |
| 9 | DM unread state and mark-read | None found | [unverified] | No docs or source hit. The docs query did not target it. |
| 10 | Edit profile | `account_edit(self, **data) -> Account`, mixins/account.py; `account_set_biography(biography)`; `set_external_url(external_url)` | [verified] | Accepted fields: external_url, username, full_name (sent as first_name), biography, phone_number, email [verified, per read]. |
| 11 | Stories list | `user_stories(self, user_id: str, amount: int = None) -> List[Story]`, mixins/story.py | [verified] | |
| 11b | Story info | `story_info(story_pk, use_cache=True)` | [unverified] | Named in the sub-agent table; definition not quoted. |
| 11c | Story seen | `story_seen(self, story_pks: List[int], skipped_story_pks: List[int] = [])`, story.py | [verified] | Calls media_seen [verified, per read]. |
| 11d | Story upload | Not located | [unverified] | |
| 12 | Reels and clips | `clip_configure`, `media_upload_status(post_client_id)`, `video_refresh_resources(media_id)` | [unverified] | Named in CHANGELOG 3.0.6 only. clip.py not located. |
| 13 | Insights | `insights_account(self) -> Dict`, mixins/insights.py | [verified] | Business account required; raises UserError [verified, per read]. |
| 13b | Other insights | `insights_media(media_pk)`, `insights_media_feed_all(...)` | [unverified] | Named only. |
| 14 | Notifications: inbox | `news_inbox_v1(self, mark_as_seen: bool = False) -> dict`, mixins/account.py | [verified] | |
| 14b | Notifications: settings | `notification_settings(...)`, `notification_mute_all(...)`, `notification_disable()`, and 24 per-type `notification_*` helpers, mixins/notification.py | [verified] | File read in full. |
| 15 | Session save | `dump_settings(self, path) -> bool`, mixins/auth.py | [verified] | |
| 15b | Session load | `load_settings(self, path, override_app_version: bool = False) -> Dict`, mixins/auth.py | [verified] | |
| 15c | get_settings | Named in CHANGELOG 3.0.4 as returning fbns_auth | CHANGELOG text [verified]; definition [unverified]; docs example `cl.get_settings()` [fetch summary] | |
| 15d | set_settings | Not located | [unverified] | |
| 15e | Session reuse inside login | Not retrieved | [unverified] | CHANGELOG 3.0.19 mentions valid saved-session reuse [verified text]. |
| 16 | Two-factor login | `login(username, password, verification_code=...)` returns bool | [fetch summary, docs interactions.html]; source signature [unverified] | Backup codes go in the same parameter [fetch summary, docs totp.html]. |
| 16b | TOTP helpers | `totp_generate_seed(self) -> str`; `totp_enable(self, verification_code: str) -> List[str]` (returns backup codes); `totp_disable(self) -> bool`; `totp_generate_code(seed: str) -> str` (static); mixins/totp.py | [verified] | File read in full. No separate backup-code method. |
| 16c | Automated Bloks TOTP flow | Docs: entrypoint, method picker, select method "totp", verify a code generated from a seed | [fetch summary, docs totp.html] | See Brief conflicts. |
| 17 | Realtime | `realtime_client`, `realtime_connect`, `realtime_disconnect`, `realtime_on(self, event: str, handler) -> None`, `realtime_read_once`, `realtime_ping`; FBNS: `fbns_client`, `fbns_connect`, `fbns_disconnect`, `fbns_on`, `fbns_read_once`, `fbns_ping`; mixins/realtime.py | [verified] | Event names are in realtime/client.py [unverified]. |
| 18 | Error classes | ChallengeRequired and FeedbackRequired (private.py, graphql.py); TwoFactorRequired and ClientThrottledError (private.py) | [verified] | Grep with blob SHAs matching the pinned tree. |

#### Login and session
- CHANGELOG 3.0.0 (2026-09-13), breaking: login() uses CAA directly; the previous flow and arguments are kept as login_legacy(); default login does not fall back to legacy. [verified text]
- CHANGELOG 3.0.3 (2026-09-17): the sub-agent summarized this entry as a CAA-to-legacy fallback in login(). [fetch summary, sub-agent paraphrase]
- CHANGELOG 3.0.4 (2026-09-17): get_settings() returns fbns_auth from the live FBNS auth object when present. [verified text]
- CHANGELOG 3.0.19 (2026-10-03): clears stale account routing and claim headers on relogin or successful logout; preserves device identifiers, valid saved-session reuse, and cookie-only cleanup. [verified text]
- Docs: relogin() re-logs in with clean cookies; login_by_sessionid(sessionid) is a lightweight compatibility login; logout() exists. [fetch summary, docs interactions.html]
- The login() source signature and the session-reuse code in login() were not read. [unverified]

#### CHANGELOG 2025 and 2026
- 29 entries are dated 2026-09-09 through 2026-10-17. None are dated 2025. The file points to GitHub Releases for older notes. [verified]
- Latest entry: 3.0.26 (2026-10-17) maps HTTP 400 with error_type=needs_upgrade to ClientNeedsUpgradeError. [verified text]
- Entries whose details were withheld from the research summary, by category: device/UA profile configuration (3.0.25); challenge-flow option (3.0.24); request-header internals (3.0.22); transport (3.0.21, 3.0.12); transport and browser headers (3.0.14); default app profile (3.0.20, 3.0.7); CAA two-step parsing (3.0.18); verification-step parsing (3.0.15); login fallback path (3.0.3); payload alignment with app metadata (3.0.6); app-sent GraphQL doc IDs (3.0.5); TLS configuration (2.18.20); optional private HTTP/2 transport (2.18.19). [verified that the entries exist; details deliberately omitted]

#### Issue activity
- The newest 100 of 1,166 listed issues were fetched. All are dated 2026-02-27 through 2026-10-18. Newest: #2890 (2026-10-18). [fetch summary]
- Searches added 8 in-window issues: 6 from 2025 and 2 from 2026. [fetch summary]
- Category counts (2025 / 2026). Category assignment is an inference from titles. [fetch summary; inference]

| Category | 2025 | 2026 | Examples (fetch summary: issue titles) |
|---|---|---|---|
| Login rejected, or login or challenge flow changed | 2 | 25 | [#2800](https://github.com/subzeroid/instagrapi/issues/2800) "[BUG] Unable to Login"; [#2195](https://github.com/subzeroid/instagrapi/issues/2195) "TwoFactorRequired does not work" |
| Throttling (429, anti-abuse) | 0 | 2 | [#2774](https://github.com/subzeroid/instagrapi/issues/2774) "too many 429 error responses"; [#2852](https://github.com/subzeroid/instagrapi/issues/2852) "Fresh login fails with HTTP 429 during CAA send_login_request" |
| App-profile or header expectations changed | 0 | 9 | [#2868](https://github.com/subzeroid/instagrapi/issues/2868) "New X-Pigeon-Session-Id and X-IG-SALT-IDS on each request"; [#2479](https://github.com/subzeroid/instagrapi/issues/2479) "Bring instagrapi in line with the current Instagram Android app" |
| Response shape or field changed | 0 | 8 | [#2701](https://github.com/subzeroid/instagrapi/issues/2701) "usertag_medias raises a Pydantic validation error"; [#2761](https://github.com/subzeroid/instagrapi/issues/2761) "user_pinned_medias incorrectly handles empty arrays" |
| Endpoint removed, moved, erroring, or partial | 1 | 10 | [#2627](https://github.com/subzeroid/instagrapi/issues/2627) "get_notes() returns HTTP 500"; [#2119](https://github.com/subzeroid/instagrapi/issues/2119) "user_follow not working" (2025) |
| Media upload or edit failure | 0 | 6 | [#2575](https://github.com/subzeroid/instagrapi/issues/2575) "Unsuccessful Reel Upload"; [#2582](https://github.com/subzeroid/instagrapi/issues/2582) "Error 403 Login Required While Uploading" |
| Messaging send or receive failure | 1 | 3 | [#2840](https://github.com/subzeroid/instagrapi/issues/2840) "Intermittent direct_send HTTP 403 item_ack with payload.error_code=1404006"; [#2146](https://github.com/subzeroid/instagrapi/issues/2146) "direct_threads" (2025) |
| Cross-post or share destination failure | 0 | 5 | [#2754](https://github.com/subzeroid/instagrapi/issues/2754) "Facebook & Threads destination not found"; [#2416](https://github.com/subzeroid/instagrapi/issues/2416) "Sharing to Facebook doesn't work" |
| Install, Python, or dependency break | 0 | 3 | [#2501](https://github.com/subzeroid/instagrapi/issues/2501) "CAN'T INSTALL ON TERMUX"; [#2406](https://github.com/subzeroid/instagrapi/issues/2406) "Python 3.9 Support" |
| Feature request or capability gap | 1 | 16 | [#2752](https://github.com/subzeroid/instagrapi/issues/2752) "Automated Publishing Pipeline from Pinterest Boards to Instagram"; [#2253](https://github.com/subzeroid/instagrapi/issues/2253) "Threads don't include Direct Messages" (2025) |
| Other (unclear, docs, maintenance, network) | 1 | 15 | [#2400](https://github.com/subzeroid/instagrapi/issues/2400) "[BUG]"; [#2415](https://github.com/subzeroid/instagrapi/issues/2415) "HTTPSConnectionPool ... Max retries exceeded" |

#### Brief-relevant facts
- `examples/challenge_resolvers.py` exists. [verified listing]
- The Context7 library listing for /subzeroid/instagrapi describes the library as covering challenge resolution. [fetch summary]
- The docs describe a Bloks two-step flow driven by a TOTP seed, and say an 8-digit code passed with a two-step context selects the backup-code challenge automatically. [fetch summary, docs totp.html]
- Issue #2479 title: "Bring instagrapi in line with the current Instagram Android app." [fetch summary; https://github.com/subzeroid/instagrapi/issues/2479]

#### Docs cross-check
- Context7 IDs: /websites/subzeroid_github_io_instagrapi (606 snippets, High reputation, benchmark 80.81) was used. /subzeroid/instagrapi (2048 snippets, Medium reputation, benchmark 76.58) was not used for docs. [fetch summary]
- Pages cited: https://subzeroid.github.io/instagrapi/usage-guide/direct.html, .../totp.html, .../interactions.html, .../user.html. [fetch summary]
- The returned snippets do not mention the 3.0.0 CAA login change. The docs may predate it. [inference from fetch summary]

### 2. instagram-private-api (TypeScript)

Base: https://github.com/dilame/instagram-private-api/blob/3a153c4e807049e95d72af67e316d432c2fd1577/

#### Repository facts
- Default-branch head is 3a153c4, commit message "1.46.1", dated 2024-03-07. The same commit is the only result when listing the default branch. [verified, GitHub API]
- The root has no `tests/` directory. `describe(` search returned 0 hits. `it(` hits are runtime code, not tests. [verified]
- package.json's test script uses mocha. [verified, search hit]
- `dist/` is not committed. [verified, root listing]
- `src/` contains repositories, feeds, services, errors, core, entities, responses, and samples. `src/samples/` holds devices.json, builds.json, and supported-capabilities.json. [verified listing]
- `src/errors/` has 24 `export class` declarations. [verified, search hits]
- The Nerixyz fork's head (5d0228e, 2022-02-15) is older than the dilame default branch. [verified, GitHub API] [inference: the fork is not a newer source]

#### Action map

| # | Action | Method or location | Label | Notes |
|---|---|---|---|---|
| 1 | Follow | `FriendshipRepository.create(id, mediaIdAttribution?)`, src/repositories/friendship.repository.ts | [verified] | id is a string or a number [verified]. |
| 2 | Unfollow | `destroy(id, mediaIdAttribution?)`, same file | [verified] | |
| 3 | Like | `MediaRepository.like(options)`, src/repositories/media.repository.ts | [verified] | Delegates to likeAction with action like. LikeRequestOptions type [unverified]. |
| 3b | Unlike | `unlike(options)`, same file | [verified] | |
| 4 | Comment and reply | `comment({ mediaId, text, replyToCommentId?, module? })`, same file | [verified] | Returns body.comment [verified]. |
| 5 | DM inbox | `ig.feed.directInbox()` (consumer call [verified]); `DirectInboxFeed.items()`, src/feeds/direct-inbox.feed.ts | [verified] | Paginated. First call sends no cursor; later calls send oldest_cursor with direction older [verified]. moreAvailable comes from inbox.has_older [verified]. Stop logic in src/core/feed.ts [unverified]. `records()` returns DirectThreadEntity[] [verified]. |
| 6 | DM thread messages | `ig.feed.directThread({...})` (consumer call; arguments not in the excerpt [unverified]); `DirectThreadFeed.items()`, src/feeds/direct-thread.feed.ts | [verified] | Pages backwards with thread.oldest_cursor and thread.has_older. Batch limit 10 [verified]. |
| 7 | Send DM text | `DirectThreadEntity.broadcastText(text, skipLinkCheck?)`, src/entities/direct-thread.entity.ts | [verified] | Text with a URL routes to broadcastLink unless skipLinkCheck is set [verified]. Recipients are threadId or userIds [verified]. Factory src/core/entity.factory.ts [unverified]. Consumer call ig.entity.directThread(threadId) [verified]. |
| 8 | Mark DM item seen | `DirectThreadEntity.markItemSeen(threadItemId)` | [verified] | Calls this.client.directThread.markItemSeen [verified]. Repository implementation [unverified]. No thread-level seen method in the entity file [verified within that file]. |
| 9 | Unread state | `unseen_count: number`, `unseen_count_ts: string` on the inbox response, src/responses/direct-inbox.feed.response.ts | [verified] | visual_message_return_type 'unseen' appears in query strings; it is a visual-message setting, not read state [verified]. |
| 10 | Per-thread read flag | Not found in the three files read | [unverified] | Response typings not checked for one. |
| 11 | Edit profile | `AccountRepository.editProfile(options)`, src/repositories/account.repository.ts | [verified] | Spreads options into the signed form [verified]. AccountEditProfileOptions [unverified]. |
| 12 | Login | `login(username, password)` returns Promise of AccountRepositoryLoginResponseLogged_in_user | [verified] | two_factor_required throws IgLoginTwoFactorRequiredError; bad_password throws IgLoginBadPasswordError; invalid_user throws IgLoginInvalidUserError [verified]. |
| 13 | Two-factor login | `twoFactorLogin(options: AccountTwoFactorLoginOptions)` | [verified] | Body reads verificationCode, twoFactorIdentifier, username, trustThisDevice, verificationMethod [verified]. Options type in src/types [unverified]. |
| 14 | Session serialize | `State.serialize()`, src/core/state.ts | [verified] | Returns constants, cookies (JSON string), and enumerable state fields [verified]. |
| 15 | Session deserialize | `deserialize(state)`, state is a JSON string or an object | [verified] | Also serializeCookieJar and deserializeCookieJar [verified signatures]. |
| 16 | Device generation | `generateDevice(seed: string): void` | [verified signature]; body [unverified] | Consumer calls generateDevice(username) [verified]. |
| 17 | Stories: tray | `ig.feed.reelsTray(reason?)`, reason is pull_to_refresh or cold_start (default cold_start) | [fetch summary, docs FeedFactory.md]; consumer call `ig.feed.reelsTray('cold_start').request()` [verified] | ReelsTrayFeed.items() returns only stories, without broadcasts [fetch summary, docs ReelsTrayFeed.md]. |
| 17b | Stories: one user | `ig.feed.userStory(userId)` | [fetch summary, docs FeedFactory.md]; consumer call [verified] | |
| 18 | Story seen | `StoryService.seen(input, sourceId?)` returns Promise of StatusResponse | [fetch summary, docs StoryService.md]; source src/services/story.service.ts [unverified] | |
| 19 | Story upload into DM | `DirectThreadEntity.broadcastStory(...)` calls publish.story | [verified] | Accepts a Buffer or photo or video story options [verified]. |
| 20 | Reels upload | Static helpers PublishService.getVideoInfo, getMP4Duration, catchTranscodeError, seen at call sites | [verified call sites]; upload path [unverified] | publish.service.ts not read. |
| 21 | Insights | `InsightsService.account(options)`, `post(mediaId)`, `story(storyId)`; FeedFactory `postsInsightsFeed(options)` and `storiesInsights(timeframe)` with ONE_DAY, ONE_WEEK, or TWO_WEEKS | [fetch summary, docs InsightsService.md and FeedFactory.md] | Source insights.service.ts [unverified]. |
| 22 | Notifications | `NewsFeed.request()` returns NewsFeedResponseRootObject; `items()` returns NewsFeedResponseStoriesItem[] | [fetch summary, docs NewsFeed.md] | Accessor name in FeedFactory [unverified]. Mapping to notifications is an inference: the news feed is Instagram's activity feed. [inference] |
| 23 | Pending DM inbox | `DirectPendingInboxFeed.request()` and `items()` | [fetch summary, docs DirectPendingInboxFeed.md] | |
| 24 | Name to ID | Consumer call `ig.user.search(username)` | [verified call site] | Library side (user.repository.ts, per sub-agent) [unverified]. |
| 25 | Realtime | No realtime directory among the src directories listed | [verified listing] | Full tree [unverified]. Realtime is provided by the companion instagram_mqtt. |

#### Errors (src/errors/, 24 classes)
- Checkpoint: IgCheckpointError (ig-checkpoint.error.ts). [verified]
- Challenge: IgChallengeWrongCodeError, the only class with "Challenge" in its name (ig-challenge-wrong-code.error.ts). [verified]
- Two-factor required: IgLoginTwoFactorRequiredError. [verified]
- Action blocked or spam: IgActionSpamError, IgSentryBlockError, IgSignupBlockError. [verified]
- Login required: IgLoginRequiredError, IgUserHasLoggedOutError. [verified]
- Rate limited: IgRequestsLimitError. [verified]
- Base classes: IgClientError, IgResponseError. [verified]
- Others: IgLoginBadPasswordError, IgLoginInvalidUserError, IgNotFoundError, IgPrivateUserError, IgInactiveUserError, IgCookieNotFoundError, IgUserIdNotFoundError, IgNoCheckpointError, IgExactUserNotFoundError, IgNetworkError, IgParseError, IgUploadVideoError, IgConfigureVideoError. [verified]

#### Consumer usage (supreme-gg-gg/instagram-cli, c21c2ba)
- LICENSE is MIT, with copyright line "[2025] [Jet Chiang, James Zheng]". [verified; https://github.com/supreme-gg-gg/instagram-cli/blob/c21c2ba/LICENSE]
- source/client.ts imports from instagram-private-api, including the type DirectThreadRepositoryBroadcastResponsePayload, and IgApiClientExt from instagram_mqtt. [verified]
- source/utils/message-parser.ts imports DirectThreadFeedResponseItemsItem from instagram-private-api and MessageSyncMessageTypes and MessageSyncMessage from instagram_mqtt. [verified]
- package.json: "instagram_mqtt": "^1.2.3" and "instagram-private-api": "^1.46.1". [verified]
- Library calls in source/client.ts (15 names): ig.feed.directInbox(); inboxFeed.items(); ig.feed.directThread({...}); thread.items(); ig.entity.directThread(threadId).markItemSeen(itemId); ig.entity.directThread(threadId).deleteItem(messageId); t.broadcastText(text); ig.feed.reelsTray('cold_start').request(); ig.feed.userStory(userIdNum); ig.state.serialize(); ig.state.deserialize(sessionData); ig.state.generateDevice(username); ig.user.info(user.pk); ig.user.search(username); caaLogin.login(username, password). [verified]
- this.caaLogin is a local wrapper that was not read. [unverified]
- docs/hybrid-client-design.md (prose) says MQTT handles realtime DM operations, with the instagram-private-api Web API as fallback. [verified]
- A dotted `ig.*` search returned 0 hits, though these lines exist. Search misses dotted call phrases in this repo. [verified, search note]

#### Docs cross-check (fetch summary)
- Context7 ID: /dilame/instagram-private-api (305 snippets, High reputation, benchmark 57.71). [fetch summary]
- Pages cited, under https://github.com/dilame/instagram-private-api/blob/master/: docs/classes/index/FeedFactory.md, docs/classes/feeds/ReelsTrayFeed.md, docs/classes/services/StoryService.md, docs/classes/feeds/NewsFeed.md, docs/classes/feeds/DirectPendingInboxFeed.md, docs/classes/services/InsightsService.md, README.md. [fetch summary]
- The docs are from master. One "Defined in" link points to the fork at b3351b9, not to 3a153c4. [fetch summary]

#### Issue activity
- The newest 100 of 1,481 listed issues were fetched. In that page, 23 are from 2025 and 14 from 2026. Newest: #1853 (2026-08-10). Searches added no in-window issues. [fetch summary]
- Six issues, #1848 through #1853, share one 2026 title: "Security: vulnerable dependency image-size (CVE-2025-71329/71330) — maintained drop-in available". Titles only; bodies not read. [fetch summary; bodies unverified]
- Recent issues include "instagram-private-api No Longer Active?" (#1843) and "Is instagram-private-api down??" (#1836). [fetch summary]

| Category | 2025 | 2026 | Examples (fetch summary: titles) |
|---|---|---|---|
| Dependency security advisory | 0 | 6 | #1848 to #1853, one repeated title (see above) |
| Login rejected, or login-support question | 3 | 1 | [#1819](https://github.com/dilame/instagram-private-api/issues/1819) "IgLoginBadPasswordError when password is actually right"; [#1839](https://github.com/dilame/instagram-private-api/issues/1839) "How to extract cookies manually, when the script fails?" |
| Throttling or anti-abuse | 3 | 1 | [#1833](https://github.com/dilame/instagram-private-api/issues/1833) "Account detected for feedback required"; [#1818](https://github.com/dilame/instagram-private-api/issues/1818) "Instagram Suspect Automated Behaviour" |
| Endpoint removed, moved, or 403 or 404 | 4 | 0 | [#1832](https://github.com/dilame/instagram-private-api/issues/1832) "Sending Voice Messages via broadcastVoice Endpoint No Longer Supported"; [#1814](https://github.com/dilame/instagram-private-api/issues/1814) "Friendship.create(user.pk) returns 404 Not Found" |
| Response shape or parse failure | 1 | 0 | [#1827](https://github.com/dilame/instagram-private-api/issues/1827) "How to properly get Reel (Clip) from the given URL" |
| Messaging failure | 1 | 0 | [#1821](https://github.com/dilame/instagram-private-api/issues/1821) "/api/v1/direct_v2/threads 403 login_required" |
| Feature request | 4 | 2 | [#1840](https://github.com/dilame/instagram-private-api/issues/1840) "Is it possible to send typing with these apis?"; [#1830](https://github.com/dilame/instagram-private-api/issues/1830) "Support for Hide Like and View Counts Option When Posting" |
| Other (status checks, unclear, questions) | 7 | 4 | [#1843](https://github.com/dilame/instagram-private-api/issues/1843) "instagram-private-api No Longer Active?"; [#1836](https://github.com/dilame/instagram-private-api/issues/1836) "Is instagram-private-api down??" |

- [inference] The 2026 sample has no endpoint or response breakage reports. Its open question is whether the library is still maintained.

### 3. jlobos/instagram-web-api (JavaScript, web endpoints)

Base: https://github.com/jlobos/instagram-web-api/blob/e85a0f603e5be9e147606feed73a5057d74c5c60/

#### Repository facts
- Default-branch head is e85a0f6, "Fix uploadPhoto (based on PR#144) (#165)", dated 2020-08-06. [verified, GitHub API]
- lib/index.js was read in full: 54 methods plus the constructor. [verified]
- test/ has one entry, index.js (7,786 bytes). Test titles were not read. [verified listing; titles unverified]
- `.circleci/config.yml`: one job, build, on circleci/node:latest (a floating tag). Steps: checkout; cache keyed on the package.json checksum; npm install; a "run tests!" step that maps $username and $password to USER_NAME and PASSWORD, then runs npm test. No workflows key. [verified]
- npm test is `xo && ava`. [verified, package.json]
- Passing account credentials to the test step suggests live-account tests. [inference from the CI config]

#### Methods (verified from lib/index.js)
- Auth and session: constructor (takes username, password, cookieStore, and language, proxy, requestOptions; writes an ig_cb=1 cookie; reads csrftoken from the jar for the X-CSRFToken header); login (POST /accounts/login/ajax/); logout (GET /accounts/logout/ajax/); _getSharedData (parses window._sharedData); _getGis (computes a request header). [verified]
- Reads, user and media: getHome and _getHomeData (GraphQL); getUserByUsername (GET /{username}/?__a=1); getUserIdPhotos (GraphQL); getPhotosByHashtag (GraphQL); getPhotosByUsername (lookup, then getUserIdPhotos); getMediaFeedByLocation and getMediaFeedByHashtag (?__a=1); locationSearch (/location_search/); getMediaByShortcode (/p/{shortcode}/?__a=1); search (GET /web/search/topsearch/); getChainsData (GraphQL); getMediaComments and getMediaLikes (GraphQL). [verified]
- Follow graph: getFollowers and getFollowings (GraphQL through _getFollowData); getPrivateProfilesFollowRequests (access_tool current_follow_requests). [verified]
- Stories: getStoryReelFeed (feed_reels_tray); getStoryReels (reels_media); getStoryItemsByUsername, getStoryItemsByHashtag, getStoryItemsByLocation, getStoryItemsByReel; markStoryItemAsSeen (POST /stories/reel/seen). [verified]
- Writes: follow (POST /web/friendships/{id}/follow/); unfollow; block; unblock; approve and ignore (follow requests); like (POST /web/likes/{id}/like/); unlike; addComment (replies through replyToCommentId); deleteComment; save and unsave (POST /web/save/{id}/save/); there is no list function for saved posts; deleteMedia (POST /create/{id}/delete/). [verified]
- Upload and profile: uploadPhoto (feed or story; image only) with the _uploadPhoto helper; changeProfilePhoto (POST web_change_profile_picture); updateProfile (POST /accounts/edit/); getProfile (GET /accounts/edit/?__a=1). [verified]
- Notifications: getActivity (/accounts/activity/?__a=1), the closest function to notifications. [verified]
- Challenge: getChallenge (GET {challengeUrl}?__a=1); _navigateChallenge (POST to the challenge URL); updateChallenge (caller-supplied input); resetChallenge (caller-supplied URL); replayChallenge (caller-supplied URL). [verified]
- Absent from the full read: DM or inbox functions; insights functions; notifications beyond getActivity; reel functions (the "reel" names mean stories); any two-factor branch. [verified]

#### Login and session
- No set-cookie header: throws Error('No cookie'). [verified]
- No csrftoken among the set-cookie values: an unguarded .find(...).toJSON() throws a TypeError. [verified]
- Otherwise: sets credentials to { username, password, cookies }; fetches _sharedData when the option is true (the default); returns res.body. [verified]
- No two-factor branch: a two-factor response body is returned as res.body when the checks above pass. [verified]
- No checkpoint branch and no challenge branch. [verified]
- A page without the `window._sharedData = ` marker makes the split fail with a TypeError. [unverified]
- cookieStore goes straight into request.jar(...). Library behavior: [unverified].
- Nothing restores credentials.cookies into the jar, so restoring a session means passing a populated cookieStore. [verified]
- Nothing is written to disk; fs is used only to read photo files. [verified]
- The plaintext password stays on credentials. [verified]

#### Error handling
- No custom error classes. Built-in Error only. [verified]
- Thrown strings: 'No cookie' and 'Image upload error' (the latter is rewrapped as "Image upload error: Error: Image upload error" when the upload response lacks upload_id). [verified]
- Status codes are not checked. Non-2xx rejection comes from request-promise defaults. [verified not checked; default behavior unverified]
- Response markers: csrf_token":" ; window._sharedData = ; ;</script> ; upload_id ; set-cookie. Cookies: csrftoken and ig_cb=1. [verified]
- Unguarded: matches[0], the csrftoken find, and the _sharedData split. [verified]

#### Activity and issues
- Issues sorted newest first. The top item is #309, dated 2024-04-04. [fetch summary]
- No 2025 or 2026 issues. [inference from the sort order and the top item]
- Search hit counts were 41, 3, 15, 6, and 0, all from 2017 to 2022. [fetch summary]

| Category (pre-2025 examples only) | 2025 | 2026 | Examples (fetch summary: titles) |
|---|---|---|---|
| Login failure | 0 | 0 | [#52](https://github.com/jlobos/instagram-web-api/issues/52) "403 error when trying to login"; [#197](https://github.com/jlobos/instagram-web-api/issues/197) "Instagram Login Failing but not throwing any errors" |
| Challenge or checkpoint | 0 | 0 | [#204](https://github.com/jlobos/instagram-web-api/issues/204) "Checkpoint required"; [#99](https://github.com/jlobos/instagram-web-api/issues/99) "Update challange outside the app" |
| Throttling (429) | 0 | 0 | [#202](https://github.com/jlobos/instagram-web-api/issues/202) "Error 429 - Any Solutions?"; [#288](https://github.com/jlobos/instagram-web-api/issues/288) "Always getting code 429" |
| Endpoint removed or changed | 0 | 0 | [#98](https://github.com/jlobos/instagram-web-api/issues/98) "403 - API has been deprecated"; [#178](https://github.com/jlobos/instagram-web-api/issues/178) "Changed hash" |
| Follow-list fetch failure | 0 | 0 | [#109](https://github.com/jlobos/instagram-web-api/issues/109) "getFollowers do not work!"; [#137](https://github.com/jlobos/instagram-web-api/issues/137) "GetFollowers and getFollowing are not working." |
| Dependency break or deprecation | 0 | 0 | [#225](https://github.com/jlobos/instagram-web-api/issues/225) "request-promise-native package is deprecated"; [#258](https://github.com/jlobos/instagram-web-api/issues/258) "Cookie is not a constructor" |

#### Docs cross-check
- Not run for this library. The source was read in full at a pinned commit, and the maintenance state rules it out for adoption. [verified, process record]

### 4. instagram_mqtt (TypeScript, realtime companion)

Base: https://github.com/Nerixyz/instagram_mqtt/blob/f2672ac2c1167859e4fcc3a2d0f6a4660a33250b/

#### Repository facts
- HEAD f2672ac2c1167859e4fcc3a2d0f6a4660a33250b, commit message "feat: release v1.2.3", committer date 2024-04-23T16:17:18Z. [verified, GitHub read]
- LICENSE is MIT, "Copyright (c) 2019 Nerixyz". [verified]
- The releases list is empty. [verified, GitHub API]
- No tests. There is no test directory, and scripts.test is `echo "Error: no test specified" && exit 1`. [verified]
- Root entries: .eslintrc.json, .github/, .gitignore, .npmignore, .prettierrc, CHANGELOG.md, LICENSE, README.md, examples/, frida/, package-lock.json, package.json, src/, tsconfig.build.json, tsconfig.json. [verified listing]
- package.json: name instagram_mqtt; version 1.2.3; description "Realtime and Push Notification (FBNS) support for the instagram-private-api"; main dist/index.js; types dist/index.d.ts; files ["dist"]; engines node >=18.0.0; license MIT. [verified]
- Runtime dependencies (7): chance, debug, eventemitter3, instagram-private-api (^1.46.1), mqtts (^1.5.0), socks, ts-custom-error. Ten devDependencies. [verified]
- Exported classes (search hits): FbnsClient (src/fbns/fbns.client.ts); MQTToTClient (src/mqttot/mqttot.client.ts); RealtimeClient (src/realtime/realtime.client.ts); DirectCommands (src/realtime/commands/direct.commands.ts); GraphqlParser (src/realtime/parsers/graphql.parser.ts); BufferReader (src/thrift/thrift.reading.ts); BufferWriter (src/thrift/thrift.writing.ts). [verified]
- RealtimeClient extends EventEmitter<ToEventFn<RealtimeClientEvents>>. The keys of RealtimeClientEvents were not read. [verified extends line; event keys unverified]
- `on(` hits show only internal listeners: 'connect', 'error', and 'warning'. [verified]
- The frida/ directory exists. Its contents were not read. [verified listing; contents unverified]

#### Issue activity
- 88 issues in total, all fetched. Newest: #123, dated 2024-12-10. None from 2025 or 2026. [fetch summary]
- Search hits: 6 and 7 for two queries; 0 for three others. All pre-2025. [fetch summary]
- Pre-2025 examples: session cookie missing (#121, #120); realtime disconnect (#18 "MQTToTClient got disconnected", #83); app-version drift (#119, #63); messaging failure (#93, #89); install, build, or dependency break (#92, #6); network or TLS error (#10, #115). Links: https://github.com/Nerixyz/instagram_mqtt/issues/<number>. [fetch summary]
- Issue #119 title: "Outdated mqttListen.js Frida Gadget for Version 341.1+". [fetch summary]
- [inference] The Frida helper appears to instrument the Instagram Android app to capture MQTT details for a given app version. This rests on the issue title alone.

#### Consumer usage
- The consumer imports IgApiClientExt from instagram_mqtt, and the message-sync types from it. [verified, consumer source at c21c2ba]
- The consumer's design doc says MQTT handles realtime DM operations, with the Web API as fallback. [verified, consumer docs read]

## Brief conflicts

Status of the brief: it was not read in this research. As summarized by the instagrapi sub-agent, the owner's design rules forbid device or fingerprint spoofing and automated challenge solving. The source path of the brief is not recorded. [unverified, agent summary]

Per library:
- **instagrapi**: Android app profile (CHANGELOG device and app-profile entries [verified text]; issue #2479 title [fetch summary]). Challenge resolver example [verified listing]. Automated Bloks TOTP flow [fetch summary, docs totp.html]. [inference] These may conflict with the device rule and with the challenge rule as summarized.
- **instagram-private-api**: generateDevice(seed) signature [verified]; body [unverified]. Challenge and checkpoint error classes [verified]; challenge code paths [unverified]. [inference] generateDevice may fall under the device rule.
- **jlobos**: browser user agent and ig_cb cookie [verified]. Challenge submission functions getChallenge, updateChallenge, resetChallenge, replayChallenge, _navigateChallenge [verified]. [inference] The challenge functions may fall under the challenge rule, depending on how they are used.
- **instagram_mqtt**: Frida helper [fetch summary, issue #119 title]. [inference] It may instrument the Android app, which may fall under the device rule or the spirit of it. The frida/ contents are unverified.
- **All four**: each presents the client as an Instagram app or browser. [verified for instagrapi, instagram-private-api, and jlobos; inference for instagram_mqtt] [inference] If the brief bans device or fingerprint spoofing strictly, none of the four fits.
- **Official route**: The Context7 search surfaced "Instagram Platform" (Context7 ID /llmstxt/developers_facebook_instagram-platform_llms_txt, 1673 snippets, High reputation), described as APIs for professional accounts, messaging, comment moderation, and content publishing. [fetch summary] Its fit with the action list was not evaluated. [unverified]

## Unverified list

- instagrapi: direct.py (DM methods and unread state); login() signature and session reuse in mixins/auth.py; set_settings and get_settings definitions; story_info definition; story upload; reels and clips upload (clip.py); insights_media and insights_media_feed_all; realtime event names (realtime/client.py); photo.py and video.py; contents of the signup, attestation, utls, native, and captcha files; license.
- instagram-private-api: NewsFeed accessor name; insights and StoryService source; publish.service.ts; the entity factory; LikeRequestOptions and AccountEditProfileOptions types; generateDevice body; reels upload path; name lookup on the library side; per-thread read flag; realtime in the full tree; challenge code paths; license.
- jlobos: request-promise error behavior for non-2xx responses; test titles in test/index.js; the _sharedData split failure case; contents of issue bodies; license.
- instagram_mqtt: RealtimeClientEvents keys and event names; frida/ contents; protocol details; license is MIT [verified], so no entry is needed there.
- Consumer: this.caaLogin wrapper; library side of ig.user.info and ig.user.search; the full commit SHA of c21c2ba.
- Cross-cutting: Context7 docs are not pinned to the research commits, and the instagrapi docs may predate the 3.0.0 CAA login change [inference]. Issue counts come from titles, not bodies. "Not found" results in search are weak evidence: instagrapi search missed definitions the CHANGELOG confirms, and the consumer search missed dotted call phrases.

## Decisions needed

1. Does the brief allow clients that present an app or browser identity (device emulation)?
2. Does the brief allow challenge-related code in a dependency if it is not used for automated solving? The brief as summarized bans automated solving.
3. Which language is the project in? Python points to instagrapi. TypeScript points to a stack with no commits since 2024-03-07 (instagram-private-api) and 2024-04-23 (instagram_mqtt).
4. Which actions are must-have? Candidates: DMs, two-factor login, realtime, insights, story upload, reels upload.
5. Should the official Instagram Platform API be evaluated against the action list? It has not been.
6. Should the unverified source files be read at the pinned commits before deciding? instagrapi: direct.py, mixins/auth.py, realtime/client.py, clip.py. instagram-private-api: insights.service.ts, story.service.ts, publish.service.ts. instagram_mqtt: frida/ and RealtimeClientEvents.
7. Should licenses be checked for instagrapi, instagram-private-api, and jlobos? They have not been.

## Method and limits
- Three sub-agents ran the research: instagrapi mapping at 143b68f; instagram-private-api mapping at 3a153c4 with the consumer read at c21c2ba; jlobos code and issue read at e85a0f6, plus issue reads for the other repositories. [verified, process record]
- Parent cross-checks: Context7 for instagrapi (three queries) and for instagram-private-api (three queries); GitHub API commit checks for dilame, jlobos, and the Nerixyz fork. [verified, process record]
- Search reliability: instagrapi search missed confirmed definitions; the consumer search missed dotted call phrases. "Not found" means only that a search returned nothing. [verified, process record]
- Issue counts come from titles, from the newest issues plus searches. They are a sample, not a census. Category assignments are inferences. [verified, process record; inference]
- No installs or runtime tests were run, and no live-account actions were taken. [verified, process record]
- This file was written at the coordinator's request. No further research was run for it. [verified, process record]
