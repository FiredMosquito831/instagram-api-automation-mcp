# Official Instagram Platform capability matrix (as of 2026-10-20)

Scope: what Meta's official Instagram Platform documentation allows on each Instagram surface, for Professional (Business and Creator) accounts and personal accounts, with the login product, the Graph API version to pin, and 2025 to 2026 changes.

Legend: **Yes** = documented and usable as described. **Partial** = documented but limited to one login product, some media types, read-only or live-only use, or a stated condition. **No** = no documented operation. "IG Login" = Instagram API with Instagram Login (graph.instagram.com, Business Login for Instagram). "FB Login" = Instagram API with Facebook Login (graph.facebook.com, Facebook Login for Business).

Method and caveats: 19 official pages were read with WebFetch. That tool returns a summary written by a small model, not raw HTML, so quoted names are as the fetch returned them. Claims that rest on a single summary, on the changelog alone, or on a Context7 excerpt of a Meta page are marked. Context7's copy of the Instagram Platform docs (High reputation, a snapshot) was consulted first and is cited where marked. Items marked "unverified" were not confirmed on a dedicated page. No web search was used.

## Capability matrix by surface

### Takeaway
Both products document profile reads, publishing (image, carousel, Reel, Story), comment read, reply, hide and delete, mentions, and account and media insights. Likes and unlikes became available in April 2026 through `POST` and `DELETE /<IG_USER_ID>/likes`. Follow and unfollow have no documented endpoint, and profile fields and captions cannot be edited. Hashtag search, business discovery, post deletion, product tagging, partnership ads, collaborative media and the audio library are documented for Facebook Login only.

### Cited Findings

#### Profile
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Read profile fields (`id`, `username`, `name`, `biography`, `website`, `profile_picture_url`, `has_profile_pic`, `followers_count`, `follows_count`, `media_count`) | Yes | Business and Creator (the IG User node lists Instagram Business and Creator accounts). | IG Login: `instagram_business_basic`. FB Login: `instagram_basic`, `pages_read_engagement`; plus `ads_management` or `ads_read` if the app user has a Business Manager role on the Page | `GET /<IG_USER_ID>?fields=...` | `shopping_product_tag_eligibility` is FB Login only and also needs `catalog_management` and `instagram_shopping_tag_products`. `collaborative_media_search` is FB Login only. | [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) |
| Edit bio, name, username, website, profile picture | No | n/a | None | None documented. The Creating, Updating and Deleting sections each state "This operation is not supported." | Profile fields are read-only through the API | [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) |

#### Posts and Reels
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Publish single image | Yes (both products) | Professional accounts | IG Login: `instagram_business_basic`, `instagram_business_content_publish`. FB Login: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` | `POST /<IG_USER_ID>/media` with `image_url` (the page writes `/<IG_ID>/media`), then `POST /<IG_USER_ID>/media_publish` | Quota: "limited to 100 API-published posts within a 24-hour moving period," enforced on `media_publish`; check with `GET /<IG_ID>/content_publishing_limit`. The carousel section says "50 published posts within a 24-hour period" (conflict, see Gaps). | [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) |
| Publish carousel | Yes (both products) | Professional accounts | Same as single image | `POST /<IG_USER_ID>/media` with `media_type=CAROUSEL` and `children` (comma-separated, up to 10 container IDs); each child has `is_carousel_item=true`; then `POST /<IG_USER_ID>/media_publish` | 10 items maximum (images, videos or a mix). A carousel counts as one post against the quota. `is_ai_generated` goes on the carousel container only. | [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |
| Publish Reel | Yes (both products, per the overview table) | Professional accounts | Same as single image | `POST /<IG_USER_ID>/media` with `media_type=REELS`, then `POST /<IG_USER_ID>/media_publish`; video uploads go to `rupload.facebook.com` | Trial Reels supported (changelog, Dec 3, 2025, optional `trial_params`). Resumable uploads are FB Login only. | [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |
| List own media | Yes | Business and Creator | IG Login: `instagram_business_basic`. FB Login: `instagram_basic`, `pages_read_engagement` | `GET /<IG_USER_ID>/media` | From July 30, 2026, `media_url` can be absent (copyright, licensed audio, Reel download setting) and the HTTP status stays 200. On the IG Media page, `caption`, `media_product_type` and several counts are marked "Available for Instagram API with Facebook Login only" (unexpected, verify before relying on it for IG Login). | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog); [IG Media reference](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) |
| Read one media object | Yes | Business and Creator. Media from personal accounts cannot be read ("It can not be used to get data for media owned by personal Instagram accounts."). | As for list | `GET /<IG_MEDIA_ID>?fields=...` | Live video readable only while broadcasting. Carousel children lack several counts. | [IG Media reference](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) |
| Edit caption | No | n/a | None | None for caption. `POST /<IG_MEDIA_ID>` documents exactly one updatable field, `comment_enabled`. | `caption` is not documented as updatable | [IG Media reference](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) |
| Enable or disable comments on a post | Yes | Business and Creator | IG Login: `instagram_business_basic`, `instagram_business_manage_comments`. FB Login: `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement` | `POST /<IG_MEDIA_ID>?comment_enabled=true` (or `false`) | Live video media not supported | [IG Media reference](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) |
| Delete post | Partial (FB Login only) | Not stated | FB Login: `instagram_basic`, `instagram_manage_contents`. IG Login not listed. | `DELETE /<IG_MEDIA_ID>` (added Dec 3, 2025) | "This api only supports Instagram API with Facebook login only." Non-ad posts, Stories, Reels and whole carousel albums are supported. Individual carousel children cannot be deleted. The page's request syntax shows POST while its heading and example show DELETE (inconsistent). | [IG Media reference](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |

#### Stories
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Publish Story | Yes (documented under content publishing for both products) | Professional accounts | Same as single image | `POST /<IG_USER_ID>/media` with `media_type=STORIES` (video container), then `POST /<IG_USER_ID>/media_publish` | The fetched summary describes only video STORIES containers. The image-Story path is not confirmed. | [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) |
| List Stories | Yes (unverified detail) | Not stated | Not verified | `GET /<IG_USER_ID>/stories` | Edge listed in the IG User edges and in the changelog | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog); [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) |
| Story insights | Yes (both products; `total_views` FB Login only) | Professional accounts | IG Login: `instagram_business_basic`, `instagram_business_manage_insights`. FB Login: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`; plus `ads_management` or `ads_read` for a Business Manager role | `GET /<IG_MEDIA_ID>/insights?metric=...` (`metric` and `access_token` required) | STORY metrics listed: `facebook_views`, `follows`, `impressions` (deprecated for media created after July 2, 2024), `link_clicks`, `navigation`, `profile_activity`, `profile_visits`, `reach`, `replies`, `reposts`, `shares`, `total_interactions`, `views`, `total_views` (FB only). Story data is "only available for 24 hours". Values under five return error (#10). The Insights webhook is not supported for IG Login. `link_clicks` is marked "Facebook Login API only" in the June 22, 2026 changelog entry, which conflicts with the insights page (see Gaps). | [Media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |
| Story replies | Partial (no dedicated replies endpoint documented) | n/a | Messaging scopes apply (messaging researcher covers these) | Replies arrive as messaging webhook payloads with `reply_to.story` (changelog, Dec 12, 2025 added `link_sticker_url` to it). The story `replies` metric gives a count. | `replies` "returns 0" for Stories whose creator is in Europe (from Dec 1, 2020) or Japan (from Apr 14, 2021). | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog); [Media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights) |

#### Comments
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Read comments on own post | Yes | Professional accounts | IG Login: `instagram_business_basic`, `instagram_business_manage_comments`. FB Login: `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement`. Reading commenter usernames has required the manage-comments scope since Aug 27, 2024. | `GET /<IG_MEDIA_ID>/comments` | Comments by restricted users are withheld. Comments on age-restricted media are not returned. Live-video comments are readable only while the broadcast is live. | [Comment Moderation](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) (Context7 excerpt, page not fetched); [IG Comment reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment) |
| Read replies | Yes | Not stated | Scopes as listed on the Replies page: `instagram_basic`, `pages_show_list`, `page_read_engagement` (spelling as on the page; other pages use `pages_read_engagement`) | `GET /<IG_COMMENT_ID>/replies` | Replies cannot be retrieved for a deleted comment. No IG Login scopes listed on this page. | [Replies](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) |
| Reply to comment | Yes (top-level comments only) | Not stated | As listed on the Replies page: `instagram_basic`, `instagram_manage_comments`, `pages_show_list`, `page_read_engagement`. The page says the token must come from "a User who created the comment," which is unclear for replying to comments on your own media (see Gaps). | `POST /<IG_COMMENT_ID>/replies?message=<TEXT>` (`message` required) | No replies to replies (they attach to the top-level comment). Hidden comments and live-video comments cannot be replied to. Top-level comments on media use `POST /<IG_MEDIA_ID>/comments`, which the Replies page references (not separately verified). Private replies are a separate feature page (index only). | [Replies](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) |
| Hide or unhide comment | Yes | Professional accounts (token must belong to the media owner) | Node-level: IG Login `instagram_business_manage_comments`; FB Login `instagram_manage_comments`, `pages_read_engagement` | `POST /<IG_COMMENT_ID>?hide=true` (or `hide=false`); `hide` is required | The owner's own comments always stay visible. Not supported for live-video comments. | [IG Comment reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment); [Comment Moderation](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) (Context7 excerpt) |
| Delete comment | Yes (conditions apply) | Professional accounts | Node-level: IG Login `instagram_business_manage_comments`; FB Login `instagram_manage_comments` | `DELETE /<IG_COMMENT_ID>` | Only the media owner can delete a comment, even when the requester wrote it. The delete section names the comment creator's token (conflict, see Gaps). Not supported for live-video comments. | [IG Comment reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment); [Comment Moderation](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) (Context7 excerpt) |
| Comments that mention the account (`mentioned_comment`) | Yes (edge listed; details unverified) | Not stated | Not verified | `GET /<IG_USER_ID>/mentioned_comment` (path from changelog; method GET) | Comments found through the Mentions API are readable only by their owner. The Mentioned Comment page was not fetched. | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog); [IG Comment reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment) |

#### Likes
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Like or unlike feed post, Reel or carousel | Yes (documented; product scope not stated) | Not stated | `instagram_basic`, `instagram_manage_engagement` (the reference lists both; the changelog says `instagram_manage_engagement` "is required") | `POST /<IG_USER_ID>/likes?media_id=<MEDIA_ID>`; `DELETE /<IG_USER_ID>/likes?media_id=<MEDIA_ID>` | Supports Feed images, Reels and carousels. Stories not supported. Media from private accounts cannot be liked. One target per request. More than 50 requests in 5 seconds locks the user out for an hour. Success returns `{"success": true}`. Examples use `graph.facebook.com/v26.0`. Added April 22, 2026. | [Likes reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/user-likes); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |
| Like or unlike comment or reply | Yes (same product caveat) | Not stated | Same as above | `POST` and `DELETE /<IG_USER_ID>/likes?comment_id=<COMMENT_ID>` | Comments from private accounts cannot be liked | [Likes reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/user-likes); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |

#### Follows
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Follow or unfollow another account | No | n/a | None | None documented | Read-only analogues only: the `follows_and_unfollows` insights metric (a count) and the read-only `is_user_follow_business` and `is_business_follow_user` flags in the messaging user profile | [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user); [Documentation index](https://developers.facebook.com/documentation/instagram-platform/llms.txt); [IG User insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights); [Messaging user profile](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile) (Context7 excerpt) |

#### Hashtags
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Hashtag search | Partial (FB Login only; the overview marks IG Login "Not supported") | Not named. Requires an IG user ID and a user token from someone "approved for tasks on the connected Facebook Page." | `instagram_basic`; plus `ads_management`, `business_management` or `pages_read_engagement` if the token holder has a Business Manager Page role. Also the "Instagram Public Content Access" feature. | `GET /ig_hashtag_search?user_id=<USER_ID>&q=<QUERY_STRING>` (only GET documented) | "a maximum of 30 unique hashtags within a 7 day period" (not described as rolling). Sensitive or offensive hashtags return a generic error. | [Hashtag search reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-hashtag-search); [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |
| Top and recent media for a hashtag | Partial (FB Login; per changelog and index) | Not stated | Not verified (hashtag edge pages not fetched) | `GET /<IG_HASHTAG_ID>/top_media`; `GET /<IG_HASHTAG_ID>/recent_media` | media_url restrictions apply to these endpoints (changelog List A) | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog); [Documentation index](https://developers.facebook.com/documentation/instagram-platform/llms.txt) |

#### Business discovery
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Look up another account's profile and media | Partial (FB Login only, per the page) | The querying account must be Business or Creator. Targets are Business or Creator accounts. Age-gated Business accounts are not returned. | FB Login: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`; plus `ads_management` or `ads_read` for a Business Manager role. IG Login is not listed on the page. | `GET /<IG_USER_ID>?fields=business_discovery.username(<USERNAME>)` | `view_count` is available only through Business Discovery (Reels, added June 16, 2025). media_url restrictions apply. No rate limit is stated on the page. A March 30, 2026 changelog entry raises a "Discovery API" limit "from 240 to 1,000 queries per user per hour"; the API is not named (see Gaps). | [Business discovery reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |

#### Insights
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Account insights | Yes (both products; the Jan 21, 2025 changelog opened Insights to IG Login apps) | Professional accounts (Business or Creator). Some metrics need 100 or more followers. | IG Login: `instagram_business_basic`, `instagram_business_manage_insights`. FB Login: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`; plus `ads_management` or `ads_read` for a Business Manager role | `GET /<IG_USER_ID>/insights?metric=...&period=day` (or `lifetime`); `metric_type=total_value` (`time_series` only for `impressions` and `reach`) | Day metrics: `accounts_engaged`, `comments`, `follows_and_unfollows`, `impressions` (deprecated), `likes`, `profile_links_taps`, `reach`, `replies`, `reposts`, `saves`, `shares`, `total_interactions`, `views`. Lifetime metrics: `engaged_audience_demographics`, `follower_demographics`. `follower_count` and `online_followers` are unavailable below 100 followers. Default lookback is 24 hours. Data can lag up to 48 hours. | [IG User insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights); [Insights overview](https://developers.facebook.com/documentation/instagram-platform/insights) |
| Media insights (feed, Reels, Stories) | Yes (both products; some metrics FB Login only) | Professional accounts. Media from personal accounts is not accessible. | Same as account insights | `GET /<IG_MEDIA_ID>/insights?metric=...` | Feed metrics include `comments`, `facebook_views`, `follows`, `impressions` (deprecated), `likes`, `profile_activity`, `profile_visits`, `reach`, `reposts`, `saved`, `shares`, `total_interactions`, `views`. Reels add `crossposted_views`, `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`. `total_comments`, `total_likes` and `total_views` are FB Login only. Insights data is "not available for any media within an Instagram Media album." Data is delayed up to 48 hours and stored up to 2 years. | [IG Media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights) |

#### Live
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Read live media | Partial (read-only, only while broadcasting) | Not stated | FB Login: `instagram_basic`, `pages_read_engagement`; plus `ads_management` or `ads_read` for a Business Manager role. IG Login scopes not stated on the page. | `GET /<IG_USER_ID>/live_media` (`fields`, `since`, `until`) | Returns only live video being broadcast at request time. Create, update and delete are "not supported." Starting or stopping a broadcast is not addressed. Live comments can be read only while live, cannot be replied to, and cannot be hidden or deleted. | [Live media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/live_media); [IG Comment reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment); [Replies](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) |

#### Mentions
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Media that mentions the account (caption @mentions) | Yes (both products, per the overview table) | Not stated. Private-account media sends no webhooks. | The page documents only the FB Login route: `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement`; plus `ads_management` or `ads_read` for a Business Manager role. IG Login scopes not stated. | `GET /<IG_USER_ID>/mentioned_media` (path from changelog); or `GET /{ig-user-id}?fields=mentioned_media.media_id(<MEDIA_ID>)` (reference form) | Discovery is through the mentions webhook, which carries the media ID. Story mentions unsupported. Commenting on tagged photos unsupported. Caption mentions only. | [mentioned_media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/mentioned_media); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog); [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |
| Tagged photos (`tags` edge) | Yes (edge listed; details unverified) | Not stated | Not verified | `GET /<IG_USER_ID>/tags` (path from changelog) | Not fetched | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |

#### Direct messages (name only; the messaging researcher covers this)
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Direct messages | Yes | Professional accounts | IG Login: `instagram_business_manage_messages`. FB Login: `instagram_manage_messages`, via the Messenger Platform. | Messaging endpoints (not covered here) | Not covered here | [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |

#### Other documented surfaces
| Operation | Supported | Account types | Permission scopes (exact) | Endpoint and method | Notable limits | Sources |
|---|---|---|---|---|---|---|
| Collaborative media | Partial (FB Login only) | Not stated | Not stated in fetched sources | `GET /<IG_USER_ID>/collaborative_media`; `GET /<IG_USER_ID>?fields=collaborative_media_search.media_id(<IG_MEDIA_ID>)` | Added Apr 22, 2026 | [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |
| Collaboration invites | Partial (FB Login feature page) | Not stated | `instagram_basic` | `GET /<IG_USER_ID>/collaboration_invites`; `POST /<IG_USER_ID>/collaboration_invites` | Added Dec 3, 2025 | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog); [Documentation index](https://developers.facebook.com/documentation/instagram-platform/llms.txt) |
| Product tagging | Partial (FB Login only) | Requires an Instagram Shop with eligibility (`shopping_product_tag_eligibility`) | FB Login; the eligibility field also needs `catalog_management` and `instagram_shopping_tag_products` | Not fetched (Product Tags edge is listed in the index) | Overview: IG Login "Not supported" | [Overview](https://developers.facebook.com/documentation/instagram-platform/overview); [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) |
| Partnership ads and branded-content label | Partial (FB Login only) | Sponsor accounts must be professional accounts | Token must include `instagram_branded_content_creator` or `instagram_basic` (label) | `POST /<IG_USER_ID>/media` with `is_paid_partnership` and `branded_content_sponsor_ids`; `/{business-account-id}/branded_content_ad_permissions` (method not stated) | Resumable uploads and the label are FB Login only | [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |
| AI-generated label | Yes (both login flows, per changelog) | Not stated | Not stated | `POST /<IG_USER_ID>/media` with `is_ai_generated`; `GET /<IG_MEDIA_ID>?fields=is_ai_generated` | Added June 22, 2026 | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |
| Alt text on image posts | Yes | Not stated | Not stated | `alt_text` on the media container create call (method not stated in changelog) | Image posts only, not Reels or Stories. Added Mar 24, 2025. | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |
| Audio library | Partial (FB Login apps) | Not stated | Not stated | `GET /ig_audio?audio_type=music` or `original_sound`; `GET /<IG_AUDIO_ID>`; `media_audio_type` field on media | Added June 1, 2026 | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |
| Content publishing limit | Yes | Professional accounts | Publishing scopes apply (not separately listed) | `GET /<IG_USER_ID>/content_publishing_limit` (the publishing page writes `/<IG_ID>/content_publishing_limit`) | Shows usage against the 24-hour quota | [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing); [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) |
| oEmbed | Yes; no access token required since May 15, 2026 | Not stated | None | oEmbed endpoint (not fetched) | Five oEmbed response fields scheduled for removal Nov 3, 2025 (Apr 8, 2025 entry) | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |
| Creator Marketplace API | Partial (FB Login path in index; not fetched) | Not stated | Not verified | Not fetched | Discovery query limit change dated Mar 30, 2026 (see Business discovery) | [Documentation index](https://developers.facebook.com/documentation/instagram-platform/llms.txt); [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) |

### Inferences
- A content-and-moderation tool can run on IG Login: publishing, comment read, reply, hide and delete, mentions, and account and media insights are documented for it. A tool that needs post deletion, hashtag search, business discovery, product tagging or partnership ads needs FB Login and a linked Facebook Page.
- Guidance that predates April 2026 saying Instagram has no like API is out of date for the official Platform. The like API is documented with its own permission.
- The absence of follow and unfollow is an inference from absence in every index and changelog entry checked. No page says "not supported" for follows.
- Likes are documented with graph.facebook.com examples and a Facebook Login token link, so FB Login is the likely product, but this is not confirmed.

### Gaps
- Unverified rows: `tags` edge, `mentioned_comment` page, hashtag top and recent media pages, product tagging endpoints, Creator Marketplace, oEmbed endpoint, audio endpoint details, and the Stories image path.
- Not fetched, listed only in the documentation index: Copyright Detection, Upcoming Events, Embed Button, Sharing to Feed, Sharing to Stories, Private Replies, Resumable Uploads, Upload Media (IG Login), Conversations API and Welcome message ads (messaging).
- IG Login scopes not stated for: likes, live, business discovery (page lists FB Login only), replies (Replies page lists FB Login scopes only), mentions (mentioned_media page lists FB Login only), collaborative media, oEmbed.
- No page lists the full supported set with methods (see the first key question).
- Source conflicts are listed under Deprecations, below.

## Likes, unlikes, follows and unfollows

### Takeaway
Likes and unlikes are officially supported through `POST` and `DELETE` on `/<IG_USER_ID>/likes`, added April 22, 2026. No documented endpoint exists to follow or unfollow an account, and no page in the documentation I could reach lists one.

### Cited Findings
- The April 22, 2026 changelog entry "Like Media and Comments API" documents `POST /<IG_USER_ID>/likes` and `DELETE /<IG_USER_ID>/likes`, each taking `media_id` or `comment_id`, and requires the new `instagram_manage_engagement` permission. [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- The Likes reference lists the permissions `instagram_basic` and `instagram_manage_engagement`. It supports Feed images, Reels and carousels and their comments and replies, and states "Stories is not supported." It also states "Media and Comments from Private Accounts cannot be liked." More than 50 requests in 5 seconds locks the user out for an hour. Examples use `https://graph.facebook.com/v26.0`. [Likes reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/user-likes)
- The IG User node's edge list (19 edges) contains no follow or unfollow edge. Its edges include `business_discovery`, `media`, `mentions`, `mentioned_media`, `live_media`, `stories`, `tags` and `collaboration_invites`. [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user)
- The documentation index lists 36 feature pages and 39 endpoint and reference pages. Its titles and descriptions cover no follow, unfollow, like, or profile-edit page. The index does not list the Likes page, so it is not exhaustive. [Documentation index](https://developers.facebook.com/documentation/instagram-platform/llms.txt)
- The API Reference index lists six nodes (IG Comment, IG Container, IG Hashtag, IG Media, IG User, Page) and one root edge (`ig_hashtag_search`), with no HTTP methods. It says only that the platform "consists of nodes (objects), edges (collections) on those nodes, and fields (object properties)." It does not claim to list the complete supported set. [API Reference](https://developers.facebook.com/documentation/instagram-platform/reference)
- Follow-related read-only data: the `follows_and_unfollows` insights metric is a count. [IG User insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights) The messaging User Profile endpoint returns read-only flags `is_user_follow_business` and `is_business_follow_user`. [Messaging user profile](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile) (Context7 excerpt)

### Inferences
- No official endpoint to follow or unfollow is documented. This rests on absence across the IG User edge list, the documentation index, the 2025 to 2026 changelog and the API Reference index. It does not rest on an explicit "not supported" sentence.
- The IG User edge list is not a complete list of write operations, because it omits `likes`. Use the changelog and dedicated pages for writes.

### Gaps
- No single official page lists the full supported set with methods. The closest pages are the API Reference index (no methods, no edges) and the IG User edge list (no likes). The changelog is the most complete record of additions.
- The Likes API's account types and whether IG Login supports it are not stated.

## Profile editing

### Takeaway
No. Profile fields (bio, name, username, website, profile picture) are read-only through the Instagram Platform. The IG User node documents no create, update or delete operation.

### Cited Findings
- The IG User reference states that its Creating, Updating and Deleting sections each say "This operation is not supported." [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user)
- Readable profile fields include `biography`, `name`, `username`, `website` and `profile_picture_url`. `biography`, `username`, `website`, `followers_count`, `media_count`, `id` and `alt_text` are marked "Public" on that page. [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user)
- Example read from the same page: `GET https://graph.facebook.com/v25.0/<IG_USER_ID>?fields=biography,id,username,website`. [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) (Context7 excerpt, v25.0 in the snapshot)
- The 2025 to 2026 changelog has no profile-edit entry. [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- Another user's profile (messaging, via the Instagram-scoped ID) is read-only: `GET /<INSTAGRAM_SCOPED_ID>?fields=name,username,profile_pic,...`. [Messaging user profile](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile) (Context7 excerpt)

### Inferences
- Profile changes must be made outside the API. The documentation offers no alternative.

### Gaps
- The "not supported" wording was read from a model-written summary of the IG User page, not from raw HTML. The Context7 excerpt agrees on the read fields but does not show the Updating section.

## Login product for new integrations

### Takeaway
Meta's official pages do not designate either login product as recommended for new integrations. They frame both as options, and the overview's "Recommended use" row describes each one for existing integrations only. FB Login is the broader feature set and requires a Facebook Page. IG Login does not require a Page but lacks hashtag search, product tagging and partnership ads.

### Cited Findings
- Overview comparison ([Overview](https://developers.facebook.com/documentation/instagram-platform/overview)):
  - "Recommended use": "Existing Instagram Login integrations" (IG Login) vs "Existing Page-linked integrations" (FB Login).
  - "Authorization": "Business Login for Instagram" vs "Facebook Login for Business".
  - "API host": `graph.instagram.com` vs `graph.facebook.com`.
  - "Facebook Page": "Not required" vs "Required".
  - "Permissions": "Uses the instagram_business_* permission family" vs "Uses the instagram_* permission family and applicable Page permissions".
  - Comment moderation, content publishing, insights and mentions: "Supported" in both.
  - Messaging: "Supported" (IG Login) vs "Supported through Messenger Platform" (FB Login).
  - Hashtag search, product tagging, partnership ads: "Not supported" (IG Login) vs "Supported" (FB Login).
- IG Login landing page: "The Instagram API with Instagram Login allows Instagram professionals — businesses and creators — to use your app to manage their presence on Instagram." It lists comment moderation, content publishing, Media Insights, mentions and messaging, and says "This API setup cannot access ads or tagging." It does not call itself recommended, current, legacy or deprecated. [IG Login landing](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login)
- FB Login product description: "allows Instagram Professionals — Businesses and Creators — to use your app to manage their presence on Instagram." It also covers finding hashtagged media and getting metadata and metrics about other Instagram Businesses and Creators. [FB Login landing](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login) (Context7 excerpt; page not fetched)
- IG Login landing: "Please note that the old scope values will be deprecated on January 27, 2025." [IG Login landing](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login)
- OAuth for IG Login: `GET https://api.instagram.com/oauth/authorize` with `response_type=code`. The code is valid for 1 hour and is single-use. [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) (Context7 excerpt)

### Inferences
- For a new integration that needs hashtag search, product tagging, partnership ads, business discovery or post deletion, the documented route is FB Login with a linked Page.
- For a publishing, comment-moderation and insights tool without a Page, IG Login covers the core features, subject to the scopes in the matrix.

### Gaps
- No official page states a recommendation for new integrations. No page I read marks either product as current, legacy or deprecated.
- The FB Login landing page was not fetched directly. The Context7 excerpt was used instead.

## Account-type limits

### Takeaway
Every documented surface assumes an Instagram professional account (Business or Creator). Personal-account media cannot be read. Further limits come from follower thresholds, the account type of a lookup target, Page linkage, and product.

### Cited Findings
- Professional audience: both login landing pages describe Instagram professionals (businesses and creators) as the audience. [IG Login landing](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login); [FB Login landing](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login) (Context7 excerpt)
- Personal media: "It can not be used to get data for media owned by personal Instagram accounts." [IG Media reference](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media)
- IG User node: lists Instagram Business and Creator accounts. [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user)
- Insights: some metrics "are not available on Instagram accounts with fewer than 100 followers." `follower_count` and `online_followers` are unavailable below 100 followers. `follower_demographics` and `follows_and_unfollows` are not returned below 100 followers. `engaged_audience_demographics` needs at least 100 engagements. [Insights overview](https://developers.facebook.com/documentation/instagram-platform/insights); [IG User insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights)
- Business discovery: the querying account must be a Business or Creator account; "Data about age-gated Instagram Business IG Users will not be returned." [Business discovery reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery)
- Content publishing: "Instagram professional accounts"; a professional account connected to a Page that requires PPA (the acronym is not expanded on the page) cannot publish until PPA is completed; partnership-label sponsors must be professional accounts. [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- Hashtag search: no account type is named, but it requires an IG user ID and a token from a user approved for tasks on the connected Page. [Hashtag search reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-hashtag-search)
- Live: only live video being broadcast can be read. [Live media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/live_media)
- Private accounts: their media and comments cannot be liked. [Likes reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/user-likes); no mention webhooks fire for their media. [mentioned_media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/mentioned_media)
- Story data is "only available for 24 hours." Insights data is "not available for any media within an Instagram Media album." [IG Media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights)

### Inferences
- A CLI tool that targets personal accounts cannot use the Platform for them. It must check the account type first and tell the user to convert the account.

### Gaps
- Account types are not stated for: likes, mentions, live, replies, hashtag search, collaborative media, product tagging and the audio library.
- No page states how Creator accounts differ from Business accounts for any feature.

## Graph API version to pin

### Takeaway
Pin `v26.0`. Meta's versioning page labels it the latest version, and current Instagram pages use it in their examples.

### Cited Findings
- "The latest Graph API version is v26.0." [Versioning](https://developers.facebook.com/docs/graph-api/guides/versioning)
- "Each version is guaranteed to operate for at least two years." A version "will no longer be usable two years after the date that the subsequent version is released." [Versioning](https://developers.facebook.com/docs/graph-api/guides/versioning)
- v26.0 appears in current Instagram pages: the Likes reference uses `graph.facebook.com/v26.0`; the IG Media insights page lists "v26.0" as the latest version; the mentioned_media syntax uses v26.0. [Likes reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/user-likes); [IG Media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights); [mentioned_media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/mentioned_media)
- Older examples: `graph.instagram.com/v25.0` on the messaging user-profile page and `graph.facebook.com/v25.0` on the IG User page (Context7 excerpts). [Messaging user profile](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile); [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user)
- The versioning page does not mention the Instagram Platform or `graph.instagram.com`. [Versioning](https://developers.facebook.com/docs/graph-api/guides/versioning)

### Inferences
- Pin v26.0 for both hosts. Before relying on it for `graph.instagram.com`, make one test call, because no page confirms the Instagram Login host's version policy.

### Gaps
- The release date of v26.0 is not given on the versioning page, which points to the changelog. The Graph API changelog page was not fetched.
- Nothing confirms whether a version newer than v26.0 has been announced.

## Deprecations and changes, 2025 to 2026

### Takeaway
The most consequential changes are the January 2025 metric deprecations and the deprecation of the hyphenated "v1.0" endpoints, the oEmbed field removals, the April 2026 like API with `instagram_manage_engagement`, the December 2025 delete-media endpoint, and the July 30, 2026 change that lets `media_url` be absent.

### Cited Findings
Changelog entries, from the changelog summary ([Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)), in date order:
- **Jan 21, 2025.** Insights APIs open to IG Login apps. The `views` metric is added. Metric deprecations for v22.0 and later, and for all versions from April 21, 2025: `clips_replays_count`, `ig_reels_aggregated_all_plays_count` and `plays` (media), and `impressions` (media and user). Requests for `impressions` on media created on or after July 2, 2024 return errors after April 21, 2025.
- **Jan 21, 2025.** "v1.0 Endpoint Deprecations" for v22.0 and later, and for all versions from April 21, 2025 (the page's second date reads "May 20, 2025" with no separator). 29 hyphenated paths are deprecated, including `DELETE /{instagram-comment-id}`, `POST /{instagram-comment-id}`, `POST /{instagram-media-id}/comments`, and the `page-backed-instagram-accounts` and `upcoming-events` paths.
- **Jan 27, 2025.** Per the IG Login landing page, "old scope values will be deprecated" on this date; the page does not name them. [IG Login landing](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login)
- **Mar 24, 2025.** `alt_text` for image posts (not Reels or Stories).
- **Apr 8, 2025.** oEmbed: five response fields (`author_name`, `author_url`, `thumbnail_url`, `thumbnail_width`, `thumbnail_height`) are removed effective Nov 3, 2025. The current oEmbed Read feature is deprecated effective Nov 3, 2025, replaced by "Meta oEmbed Read Feature". The Facebook page post oEmbed endpoint is deprecated.
- **Jun 14, 2025.** Business Login adds `force_reauth`. `enable_fb_login` and `force_authentication` are deprecated, with no date given.
- **Jun 16, 2025.** `view_count` on IG Media, available only through Business Discovery for Reels.
- **Sep 10 to Nov 10, 2025 (messaging-only, for the messaging researcher).** `message_edit` webhook (Sep 10); sender actions (Sep 23); post-share webhook enhancements (Oct 27); image collections in Direct, beta (Nov 3); professional accounts can message themselves (Nov 10).
- **Dec 3, 2025.** Delete media: `DELETE /{ig_media_id}`, permission `instagram_manage_contents`. Collaboration invites: `GET` and `POST /<IG_USER_ID>/collaboration_invites`, permission `instagram_basic`. New insights metrics (`reels_skip_rate`, `reposts`, `crossposted_views`, `facebook_views`). Trial Reels.
- **Dec 12, 2025.** `link_sticker_url` added to `reply_to.story` in messaging webhooks.
- **Dec 19, 2025 (messaging).** PDF attachments in Direct.
- **Feb 6, 2026.** `enable_fb_login` support added to Instagram OAuth authorization requests. This conflicts with the June 2025 deprecation (see Gaps).
- **Mar 13, 2026 (messaging).** Direct Send supports images with attachment IDs.
- **Mar 30, 2026.** Creator Marketplace. A "Discovery API" limit change "from 240 to 1,000 queries per user per hour." Partnership-ads endpoint `/{business-account-id}/branded_content_ad_permissions`.
- **Apr 22, 2026.** Like Media and Comments API (`POST` and `DELETE /<IG_USER_ID>/likes`; `instagram_manage_engagement`). Media engagement fields `reposts_count`, `saved_count`, `shares_count` (FB Login apps). Aggregated metrics `total_like_count`, `total_comments_count`, `total_views_count`. `facebook_views`. Collaborative Media API (`GET /<IG_USER_ID>/collaborative_media`). Partnership Ads label (`is_paid_partnership`, `branded_content_sponsor_ids`).
- **May 6, 2026 (messaging).** Sending multiple images is out of beta for all accounts.
- **May 15, 2026.** oEmbed API: no access token required.
- **Jun 1, 2026.** Instagram Audio API (FB Login apps): `GET /ig_audio`, `GET /{ig_audio_id}`. New `media_audio_type` field (`MUSIC`, `ORIGINAL_SOUND`).
- **Jun 22, 2026.** AI Info Label: `is_ai_generated` on `POST /{ig_user_id}/media` and `GET /{ig_media_id}?fields=is_ai_generated` (both login flows). New Story insights metric `link_clicks` (changelog: "Facebook Login API only").
- **Jul 30, 2026.** "Download and copyright protections on `media_url`": `media_url` can be absent, and the HTTP status stays 200. Thirteen GET paths are affected, including `business_discovery`, `tags`, `mentioned_media`, `mentioned_comment`, the hashtag top and recent media paths, `collaborative_media`, `media`, `stories`, `live_media` and `collaboration_invites`.

### Inferences
- Code that assumes `media_url` is always present will break. The July 30, 2026 change affects reads on most media paths, including those used for mentions, hashtags and stories.
- Code that uses the hyphenated `v1.0` paths (for example `DELETE /{instagram-comment-id}`) is on deprecated endpoints. The current forms use `<IG_COMMENT_ID>` and `<IG_MEDIA_ID>`.
- Changes in 2025 and 2026 were additive for most surfaces. The removals are the 2025 metric and endpoint deprecations and the oEmbed fields.

### Gaps
- The changelog was read through a model-written summary. The summary lists "v22.0" as the most recent version it found, so version-specific claims after v22.0 come from other pages.
- The v1.0 deprecation's end date is ambiguous ("April 21, 2025 May 20, 2025").
- No dedicated deprecation notice was found for either login product as a whole.
- Pre-2025 items not covered: the Sept 17, 2024 changelog entry (old scope values) and the Aug 27, 2024 manage-comments requirement for reading commenter usernames.

### Conflicts between sources (unresolved)
- **Likes:** the Likes reference and the April 22, 2026 changelog document the endpoint, but the IG User edge list (as summarized) and the documentation index omit it.
- **`link_clicks`:** the changelog says "Facebook Login API only"; the Media insights page lists it under STORY with no restriction.
- **Publishing quota:** 100 posts per 24 hours (quota paragraph) vs 50 posts per 24 hours (carousel section) on the Content publishing page.
- **Delete media:** the IG Media page's request syntax shows POST; its heading and example show DELETE.
- **Delete comment:** the IG Comment page says only the media owner can delete, even the requester's own comment, but its delete section names the comment creator's token.
- **Replies page:** uses `page_read_engagement` (singular) where other pages use `pages_read_engagement`. It also says both actions require a token "from a User who created the comment," which is unclear for replies to comments on your own media.
- **`enable_fb_login`:** deprecated June 14, 2025; support added Feb 6, 2026.
- **Insights permission for IG Login:** the Insights pages name `instagram_business_manage_insights`, but the overview's permission list omits it.
- **`caption` on media:** the IG Media page marks it "Available for Instagram API with Facebook Login only" (per the summary). That is unexpected and should be verified before relying on it for IG Login reads.
- **Account insights retention:** the Insights overview says "User Metrics data is stored for up to 90 days"; the IG User insights page states no retention period.
- **Account insights metric names:** `profile_views` appears in the Insights overview example, but the IG User insights metric list has `profile_links_taps` and no `profile_views`.
- **Media insights periods:** the request section lists `day`, `week`, `days_28`, `month`, `lifetime` and `total_over_range`, but the response section says the period "is automatically set to" lifetime and "cannot be changed."
- **"Discovery API" limit:** the March 30, 2026 entry changes a limit from 240 to 1,000 queries per user per hour, but the changelog does not name the API.
