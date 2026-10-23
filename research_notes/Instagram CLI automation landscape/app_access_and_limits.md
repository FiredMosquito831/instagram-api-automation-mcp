# Instagram Platform API: app access and limits for one developer

Snapshot date: 2026-10-20. Scope: one developer, one professional Instagram account, a command-line tool.

Sources: Meta's Instagram Platform docs on developers.facebook.com, read two ways. Quotes from the Context7 index of those docs are near-verbatim page text. Quotes marked "(summary)" come from a WebFetch summary of the page and should be spot-checked before anyone relies on them. Where pages conflict, both values are shown and the conflict is listed under Gaps. Nothing here is estimated.

### Setup checklist

1. Make the account an Instagram professional account (Business or Creator). The docs say "your app users must have an Instagram professional account." — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
2. Choose the login product. Business Login for Instagram is for accounts "with a presence on Instagram only," and no Facebook Page is named as a requirement. Facebook Login for Business needs the account linked to a Facebook Page, and the user must be able to perform admin-equivalent tasks on that Page. — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
3. In the Meta App Dashboard, create the app, add the Instagram product, and open Instagram > API setup with Instagram login > 3. Set up Instagram business login > Business login settings. Copy the Instagram App ID and Instagram App Secret. — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
4. Register the OAuth redirect URI. The `redirect_uri` "must exactly match one of the base URIs in your list of valid OAuth URIs." Whether localhost URIs are accepted is not stated in the pages checked. — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
5. Leave the app in Development mode. "All newly created apps start out in Development mode," and the docs say not to switch to Live "until app development is complete." — [App modes](https://developers.facebook.com/docs/development/build-and-test/app-modes)
6. Add your Instagram account as a tester. The tutorial path is App Roles > Roles or Instagram > API Setup with Instagram login, then "Add an Instagram account. This account must be public." (summary) The Instagram-side steps to accept the invite are not on that page. — [Create an Instagram app](https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app)
7. Start authorization: GET `https://api.instagram.com/oauth/authorize` with `client_id`, `redirect_uri`, `response_type=code`, `scope` (include `instagram_business_basic`), and optional `state`. The returned code is valid for 1 hour and can be used once. — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
8. Exchange the code: POST `https://api.instagram.com/oauth/access_token` with `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, and `code`. The response is a short-lived token valid for one hour. — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login); [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
9. Exchange for a long-lived token: GET `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=...`. It is valid for 60 days and must be called server-side because it includes the app secret. — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
10. Refresh the long-lived token before 60 days pass without a refresh. The procedure is under Key Question 4.
11. Before publishing, call GET `/<IG_ID>/content_publishing_limit` and read `config.quota_total`. The docs disagree on the number (see the table). — [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing); [IG User content_publishing_limit](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit)
12. Read `X-Business-Use-Case-Usage` on API responses to monitor usage (Key Question 5).
13. App Review is needed only if other people will use the app, or for Advanced Access. Owner-only use is listed as Standard Access with App Review "Not required." — [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review)

### Restrictions table

| Area | Restriction as documented | Source |
|---|---|---|
| Account type | App users must have an Instagram professional account, business or creator. | [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |
| Facebook Page | Business Login for Instagram: accounts "with a presence on Instagram only" (no Page named). Facebook Login for Business: accounts "linked to a Facebook Page," and the user must be able to perform admin-equivalent tasks on that Page. | [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |
| Development mode | New apps start in Development mode. "Apps in Development mode can only request permissions from role users." Development mode apps "cannot be searched for by the public through our tools and APIs." | [App modes](https://developers.facebook.com/docs/development/build-and-test/app-modes) |
| Tester and admin caps | "Most apps, not linked, can have up to 50 testers." "Apps can have up to 500 administrators." Instagram-specific cap: not stated. | [App roles](https://developers.facebook.com/docs/development/build-and-test/app-roles) (summary) |
| Owner-only app | "My app is only for a business I own or manage." with Instagram Login: Standard Access, App Review "Not required." This conflicts with a tutorial sentence (see Key Question 2). | [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review) |
| Multi-business app | "I am a Tech Provider and my app serves multiple businesses." with Instagram Login: Advanced Access, App Review "Required." | [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review) |
| Advanced Access | "Advanced Access now requires Business Verification." Apps used only by people with app roles "don't need it." | [Business verification](https://developers.facebook.com/docs/development/release/business-verification) (summary) |
| Review submission | Screencast of the full flow for each permission; Privacy Policy URL; app icon 1024x1024; business email; app category; at least 1 successful API call to request Advanced Access. | [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review) |
| Review timeline | Not stated. | [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review); [App Review, general](https://developers.facebook.com/docs/app-review/) (summary) |
| Authorization code | Valid 1 hour; can be used once. | [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) |
| Short-lived token | Valid one hour (Business Login). | [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |
| Long-lived token | Valid 60 days. The exchange must be server-side because it needs the app secret. | [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) |
| Refresh | Token at least 24 hours old, not expired, and `instagram_business_basic` granted. Each refresh gives 60 more days. A token not refreshed in 60 days "will expire and can no longer be refreshed." | [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) |
| Lifetime stability | "Do not depend on these lifetimes remaining the same." | [Access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens) (summary) |
| Expired token | Error code 190, "Access token has expired"; action "Get a new access token." | [Error handling](https://developers.facebook.com/docs/graph-api/guides/error-handling) (summary) |
| Password change | Subcode 460, "Password Changed": "they must log in to the app again." Whether this applies to Instagram Login tokens is not stated. | [Error handling](https://developers.facebook.com/docs/graph-api/guides/error-handling) (summary) |
| Rate-limit scope | All endpoints use Business Use Case (BUC) limits, except Business Discovery and Hashtag Search, which use Platform limits. | [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |
| Rate-limit budget | `Calls within 24 hours = 4800 * Number of Impressions`, counted per app and app-user pair. Messaging is excluded. | [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |
| Usage header | `X-Business-Use-Case-Usage` (BUC). Platform: `X-App-Usage`. Older Ads API: `X-Ad-Account-Usage`. | [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) (summary) |
| Throttle trigger | When `total_cputime` or `total_time` reaches 100, "calls may be throttled." No `call_count` threshold stated. | [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) (summary) |
| Error codes | Platform: 4 (app), 17 (user), 32 (Pages), 613 (custom). Instagram BUC: 80002; subcode not stated. | [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) (summary) |
| Collaboration invites | GET: 300 calls per Instagram user per day (24 hours). POST accept or decline: 50 calls per Instagram user per day. | [Collaboration](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/collaboration) |
| Publishing cap | Conflict. "100 API-published posts within a 24-hour moving period" (Rate Limit section) vs "50 published posts within a 24-hour period" (carousel limitations, same page, summary). Reference page: quota_total "currently 50" IG containers per 86400 seconds. | [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing); [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) |
| Carousels | "Carousels count as a single post." | [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) |
| Publish enforcement | Enforced on `POST /<IG_ID>/media_publish`. | [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) |
| Publish usage | `GET /<IG_ID>/content_publishing_limit` returns `data[].quota_usage`, `config.quota_total`, and `config.quota_duration` in the JSON body. No header for this quota appears on the pages checked. | [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) |
| 2026 Discovery API rate limit | "Account-level rate limits for the Discovery API have increased from 240 to 1,000 queries per user per hour" (March 30, 2026). No endpoints named. | [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) (summary) |

## Key Question 1: Must the account be Professional, and does each login product need a Facebook Page?

### Takeaway
Yes, the account must be a professional account (business or creator). A Facebook Page is required only on the Facebook Login for Business path. Business Login for Instagram is described for accounts with an Instagram-only presence.

### Cited Findings
- "To use the APIs, your app users must have an Instagram professional account. An Instagram professional account can be for a business or creator." — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- Business Login: "Your app serves Instagram professional accounts with a presence on Instagram only," and users "use their Instagram credentials to log in to your app." — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- Facebook Login for Business: "Your app serves Instagram professional accounts that are linked to a Facebook Page," and users "use their Facebook credentials." — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- "For an Instagram professional account that is linked to a Facebook Page, your app user must also be able to perform admin-equivalent tasks on the linked Facebook Page." — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- Facebook Login for Business onboarding: users must "convert their account to a Professional account, create a Facebook Page that represents their business, then connect that Page to their account." — [Facebook Login for Business](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram)
- The Messenger API for Instagram "Requires an Instagram Business or Creator Account linked to a Facebook Page." — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) (section "Instagram Messaging API via Messenger API")
- Business Login setup needs the Instagram App ID and Instagram App Secret from "App Dashboard > Instagram > API setup with Instagram login > 3. Set up Instagram business login > Business login settings." — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- The naming varies. The Overview table says "Business Login for Instagram," while the dashboard path and URL say "API setup with Instagram login" and "instagram-api-with-instagram-login." — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview); [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)

### Inferences
- Owner-only use with Business Login should not need a Facebook Page, based on the Overview's "presence on Instagram only" wording. The docs do not say "no Page needed" in those words.
- Facebook Login for Business adds a Page dependency and a Page admin-level requirement. Choose it only if the account is already linked to a Page or Page-based features are needed.

### Gaps
- No eligibility rule beyond "professional account" appears in the pages checked.
- Whether a personal-to-professional conversion takes effect immediately was not checked.
- The tutorial says the tester account "must be public" (summary); this was not checked against other pages.

## Key Question 2: Can an app in Development mode serve the developer's own account without App Review, and what are its limits?

### Takeaway
Per the docs, a Development mode app serves role users only, and an app used only for a business you own is listed as Standard Access with App Review "Not required." Facebook apps not linked to a Business Manager can have up to 50 testers; no Instagram-specific cap is stated. One tutorial sentence says App Review is required before the app can access live data. That conflicts with the owner-only row, so test it before relying on the owner-only path.

### Cited Findings
- "All newly created apps start out in Development mode," and should not be switched to Live "until app development is complete." — [App modes](https://developers.facebook.com/docs/development/build-and-test/app-modes)
- "Apps in Development mode can only request permissions from role users." "Apps in Live mode can request permissions from anyone, but only permissions approved through App Review." — [App modes](https://developers.facebook.com/docs/development/build-and-test/app-modes)
- In Development mode, "cannot be searched for by the public through our tools and APIs," and "features will only be active for role users." — [App modes](https://developers.facebook.com/docs/development/build-and-test/app-modes)
- Standard Access: "permissions with Standard Access can only be requested from role users" (Live mode, consumer apps). Standard-level permissions are also requestable in Development mode, limited to role users (summary). — [App modes](https://developers.facebook.com/docs/development/build-and-test/app-modes)
- App Review scenario table, row "My app is only for a business I own or manage." with "Instagram Login": "Standard Access," App Review "Not required." The Facebook Login and no-login rows for the same case also say "Not required." — [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review)
- Same table, row "I am a Tech Provider and my app serves multiple businesses." with "Instagram Login": "Advanced Access," App Review "Required." — [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review)
- Role caps (summary): "Most apps, not linked, can have up to 50 testers." "Apps can have up to 500 administrators." For Business Manager-linked apps "with Business Verification": "a combined total of 500 analytics users and testers." — [App roles](https://developers.facebook.com/docs/development/build-and-test/app-roles)
- Tester role (summary): "Tests during development; cannot edit settings, manage roles, or view insights." Accepting an invite: "Click Accept to become an Authorized App Tester for an app or Decline to reject an invitation." — [App roles](https://developers.facebook.com/docs/development/build-and-test/app-roles)
- Instagram messaging testers: "Your app testers must have a role on your app, grant your app access to all the required permissions, and have a role on the Instagram professional account that owns the app." — [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)
- Tutorial (summary): add an Instagram account via App Roles > Roles or Instagram > API Setup with Instagram login. "Add an Instagram account. This account must be public. Multiple accounts can be added for multiple testers." — [Create an Instagram app](https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app)
- Tutorial (summary), conflicting: "Instagram requires successful completion of the App Review process before your app can access live data." — [Create an Instagram app](https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app)

### Inferences
- The owner-only path (Development mode, tester account, Instagram Login) appears to need no App Review, based on the scenario table. Confirm it with a real test before relying on it, because of the "live data" sentence.
- Public use would require Live mode, and Live mode permits only permissions approved through App Review (per the App modes page). For one developer's own account, the 50-tester figure is unlikely to matter, but no Instagram-specific cap is confirmed.

### Gaps
- Instagram-specific tester or role caps, and whether Instagram testers count against the 50-tester cap: not stated.
- Instagram-side steps to accept a tester invitation: not stated in the pages checked.
- The "live data" sentence conflicts with the owner-only row. No page checked reconciles them.
- The roles page summary notes an internal conflict on insights and testing; not resolved.
- The Access Levels page (formal Standard and Advanced definitions) was linked from the App modes page but not fetched.

## Key Question 3: When do App Review and Advanced Access apply, what does a review require, and how long does it take?

### Takeaway
App Review is required for Advanced Access, which the docs tie to serving other businesses as a Tech Provider. Submissions need a screencast, a privacy policy URL, an app icon, a business email, and at least one successful API call for Advanced Access. Advanced Access requires Business Verification, which apps used only by role users do not need. No review timeline appears on the pages checked, and the Data Use Checkup is not confirmed.

### Cited Findings
- Submission path: App Dashboard > Products > Instagram > API setup with Instagram login. Open "Complete app review," continue to App Review > Requests, then click "Edit." — [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review)
- App settings: "App icon (1024x1024)," "Privacy Policy URL," "App Category," and "Business Email." — [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review)
- Required material (summary): a screencast of "the full user flow for each requested permission/feature, with explanatory captions"; an explanation of how each permission is used and a commitment to the allowed-use rules; a step-by-step use case; per-platform login and testing walkthroughs; reviewer sign-in details "if applicable." — [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review) (summary)
- The login control must be visible in the app and the screencast, following brand rules, and outside reviewers must be able to load and test the app. — [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review) (summary)
- "To request Advanced Access to certain permissions, you need to make at least 1 successful API call." — [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review)
- "Advanced Access now requires Business Verification." Apps "used only by people with app roles don't need it." — [Business verification](https://developers.facebook.com/docs/development/release/business-verification) (summary)
- The business verification page gives no processing timeline. Its only date, "As of February 1, 2023," is a policy date, not a timeline. — [Business verification](https://developers.facebook.com/docs/development/release/business-verification) (summary)
- The general App Review page says verification and similar steps are "processes separate from App Review that you may need to complete depending on the nature of your app." It does not mention a Data Use Checkup. — [App Review, general](https://developers.facebook.com/docs/app-review/) (summary)
- Timeline: "no review timeline stated on this page" on both the Instagram App Review page and the general App Review page. — [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review); [App Review, general](https://developers.facebook.com/docs/app-review/) (summary)

### Inferences
- For owner-only use, the docs indicate no App Review and no Business Verification.
- A realistic review timeline cannot be given from these sources. No figure is used here.

### Gaps
- Typical App Review timelines: not documented in the pages checked.
- Data Use Checkup requirement: not confirmed in the pages checked.
- Business Verification document list: a linked Help Center topic lists them; not fetched.
- The Access Levels page was not fetched, so the formal Standard Access definition is taken from the App Review table only.

## Key Question 4: Token types, lifetimes, refresh, and what happens on expiry or password change

### Takeaway
The Business Login chain is: a 1-hour authorization code (single use), then a 1-hour short-lived Instagram User token, then a 60-day long-lived token. Each refresh gives another 60 days if the token is at least 24 hours old, not expired, and the user granted `instagram_business_basic`. A token not refreshed within 60 days expires and cannot be refreshed. The error table lists subcode 460 "Password Changed," but the pages checked do not say whether it applies to Instagram Login tokens, so password-change behavior is unconfirmed.

### Cited Findings
- Token classes: "Apps using Business Login for Instagram receive Instagram User access tokens and apps using Facebook Login for Business receive Facebook User access tokens." — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- Authorization code: "This code is valid for 1 hour and can only be used once." — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- Short-lived token: "This access token is valid for one hour." — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- Long-lived exchange: GET `https://graph.instagram.com/access_token` with `grant_type=ig_exchange_token`, `client_secret`, and `access_token`. It returns a long-lived token "valid for 60 days" and "must be made in server-side code because it includes the app secret." The response has `access_token`, `token_type` ("bearer"), and `expires_in` (seconds). — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- Refresh endpoint: GET `https://graph.instagram.com/refresh_access_token` with `grant_type=ig_refresh_token` and `access_token`. It "Refreshes a long-lived access token for another 60 days." Conditions: the existing token "is at least 24 hours old," "is valide (not expired)," and the user "has granted your app the instagram_business_basic permission." — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- "Tokens that have not been refreshed in 60 days will expire and can no longer be refreshed." — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- The documented example response has `expires_in` 5183944 seconds, which is about 60 days. — [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- Facebook Login tokens (general docs, not Instagram-specific, summary): "Short-lived tokens typically last about one to two hours"; "long-lived tokens last about 60 days"; web-login tokens convert "by making a server-side API call with your app secret." — [Access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens)
- Page access token expiry: not stated on that page. System user tokens: "choose a token expiration preference"; durations not stated. — [Access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens) (summary)
- Lifetimes may change: "Do not depend on these lifetimes remaining the same," and tokens "may change without warning or expire early." — [Access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens) (summary)
- Expiry errors (summary): code 190 "Access token has expired," action "Get a new access token." Subcode 463 "Expired": "Login status or access token has expired." Subcode 460 "Password Changed": "Otherwise, they must log in to the app again." The page says these subcodes "appear in a separate table," and their mapping to 190 "is not stated on this page." — [Error handling](https://developers.facebook.com/docs/graph-api/guides/error-handling) (summary)

**Refresh procedure (per the Business Login page):**
1. Confirm the token is a long-lived Instagram User token that has not expired, is at least 24 hours old, and was granted `instagram_business_basic`.
2. GET `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token={LONG_LIVED_TOKEN}`
3. Read `access_token`, `token_type`, and `expires_in` (seconds) from the JSON. Store the new `access_token`. It is valid for another 60 days.
4. Repeat before 60 days pass without a refresh. If the window lapses, run the authorization flow again (checklist steps 7 to 9).

### Inferences
- Refreshing within each 60-day window keeps the token alive. This follows from "Tokens that have not been refreshed in 60 days will expire," although the docs do not state the clock rule explicitly.
- The app secret is needed for the code exchange and the long-lived exchange, and the docs require both server-side. A CLI that performs these steps must store the app secret locally. No CLI-specific guidance was found in the pages checked.
- A refresh attempted before the token is 24 hours old does not meet the stated condition, so schedule refreshes after that point.

### Gaps
- Whether a password change, or the user removing the app, invalidates Instagram Login tokens: not confirmed. Subcode 460 suggests a re-login is required, but its applicability to this token type is not stated.
- How the 24-hour age is measured (from issue, or from the last refresh): not stated.
- Facebook Login exchange and refresh endpoints, and Page token expiry: not fetched, or not stated.
- Revocation by the user in Instagram settings: not described in the pages checked.

## Key Question 5: Rate limits, usage headers, and content publishing limits

### Takeaway
Instagram Platform calls fall under Business Use Case (BUC) rate limiting. The documented budget is `Calls within 24 hours = 4800 * Number of Impressions`, counted per app and app-user pair, and messaging is excluded. Usage is reported in the `X-Business-Use-Case-Usage` header, though the rate-limit page does not name an Instagram-specific header. The publishing cap conflicts across the docs (100 vs 50), and the endpoint returns the quota, so read it at runtime. The publishing quota is reported in the JSON body, not a header.

### Cited Findings
- "All endpoints are subject to Instagram Business Use Case rate limiting except for Business Discovery and Hashtag Search endpoints, which are subject to Platform Rate limiting." — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- "Calls within 24 hours = 4800 * Number of Impressions." The call count "is unique for each app and app user pair," and is "the number of calls the app has made in a rolling 24 hour window." Impressions are "the number of times any content from the app user's Instagram professional account has entered a person's screen within the last 24 hours." Calls to messaging endpoints are excluded. — [Overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- "Marketing API and Instagram Platform requests are subject to Business Use Case (BUC) Rate Limits." — [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) (summary)
- Headers (summary): `X-App-Usage` (Platform); `X-Business-Use-Case-Usage` (BUC), included on "All API responses made by your app that are rate limited using the BUC logic"; `X-Ad-Account-Usage` (older Ads API). — [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) (summary)
- Header fields (summary): `call_count` (BUC: "percentage of allowed calls"); `total_cputime` and `total_time` (percentage of allotted CPU and time); `type` ("Type of rate limit applied," with values including `instagram` and `messenger`); `business-id`; `estimated_time_to_regain_access` (minutes until calls are no longer throttled). — [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) (summary)
- Throttle trigger (summary): "When total_cputime reaches 100, calls may be throttled," and the same for `total_time`. No `call_count` threshold is stated. — [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) (summary)
- Error codes (summary): Platform 4 (app-level), 17 (user-level), 32 (Pages API), 613 (custom). The Instagram BUC section lists "error code 80002"; its subcode is not stated. — [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) (summary)
- Collaboration invites: "Rate limit applies to 300 calls per Instagram User per day (24 hours)" for GET, and "Rate limit applies to 50 calls per Instagram User per day (24 hours)" for POST accept or decline. — [Collaboration](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/collaboration)
- Publishing: "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period. Carousels count as a single post. This limit is enforced on the `POST /<IG_ID>/media_publish` endpoint when attempting to publish a media container." — [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- Same page, carousel limitations (summary): "Accounts are limited to 50 published posts within a 24-hour period." — [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) (summary)
- Reference page: `quota_total` is "The maximum number of IG Containers the app user can publish within the quota_duration time period (currently 50)." `quota_duration` is "currently 86400 seconds, or 24 hours." — [IG User content_publishing_limit](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit)
- `quota_usage` is "The number of times the app user has published an IG Container since the time specified in the since query string parameter." The `since` parameter is "A Unix timestamp no older than 24 hours." — [IG User content_publishing_limit](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) (Context7 index)
- The Context7 index of the Content Publishing page shows an example with `quota_total` 100 and `quota_duration` "24h" (a string). The live page as fetched shows no example values. The reference page's example uses `quota_total` 50 and `quota_duration` 86400. — [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) (Context7 index)
- The docs recommend that apps "also enforce the publishing rate limit, especially if your app allows app users to schedule posts to be published in the future." — [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) (Context7 index)
- The usage endpoint is GET `/<IG_ID>/content_publishing_limit`. The documented examples use `graph.instagram.com/v25.0` and `graph.facebook.com/v25.0`. — [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing); [IG User content_publishing_limit](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) (Context7 index)

### Inferences
- The publishing cap should be read from `config.quota_total` at runtime rather than hardcoded, because the docs disagree on the number. The endpoint returns the value, so this avoids guessing.
- `X-Business-Use-Case-Usage` is the header to read for Instagram calls. The rate-limit page applies BUC to Instagram Platform requests and lists `instagram` as a BUC type, but it does not name an Instagram-specific header. Confirm this on a real response.
- The call budget scales with impressions, so an account with few impressions has a small 24-hour budget. The docs do not say what happens at zero impressions.
- The rate-limit page describes `call_count` for Platform as covering "a rolling one hour period" (summary), while the Instagram formula uses 24 hours. The page does not reconcile the two windows.

### Gaps
- The Instagram-specific `call_count` threshold, and whether the BUC header appears on every Instagram response: not confirmed on a live response.
- Subcode for error 80002: not stated.
- Behavior at zero impressions: not stated.
- Publishing cap: 100 vs 50 is unresolved. The reference page says "currently 50"; no page checked says which value is enforced.
- Messaging limits (summary of the rate-limit page; not verified line by line, and internally conflicting): Conversations API "2 calls per second per Instagram professional account"; Private Replies 100 per second for Live comments and 750 per hour for post and reel comments; Send API 10 per second for audio or video. Text, link, reaction, and sticker sends are given as 100 per second in one section and 300 per second in another. Relevant only if the CLI sends direct messages.

## Key Question 6: Which rules changed in 2025 or 2026?

### Takeaway
Entries reviewed in the changelog with possible impact on a CLI: scope-name deprecation (January 27, 2025), v1.0 endpoint deprecation (2025), the `impressions` insights metric deprecation (April 21, 2025), new permission requirements for collaboration and media delete (December 3, 2025), a Discovery API rate-limit increase (March 30, 2026), and the `enable_fb_login` parameter (listed as deprecated in a June 2025 entry, then described as a usable control in a February 2026 entry). No change to the 1-hour and 60-day token lifetimes, the 4800-times-impressions formula, or the publishing cap appears in the fetched entries. The 100/50 publishing conflict is not described as a change.

### Cited Findings
- Sept 17, 2024 entry, effective 2025: the scope values `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, and `instagram_business_manage_messages` replace the old values. The old values "will be deprecated on January 27, 2025," and "Failure to do so will result in your app being unable to call the Instagram endpoints." A correction moved the date from December 17, 2024. — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- Jan 21, 2025 entry: "The Instagram v1.0 API is deprecated," with a long list of affected endpoints, and "Please migrate your API calls to the Instagram Platform endpoints." The applicability line reads "Will apply to all versions April 21, 2025 May 20, 2025." (two dates; unclear). — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- Insights: the `impressions` metric is "deprecated for v22.0 and will be deprecated for all versions on April 21, 2025," and the `views` metric is introduced. — [Instagram Account Insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights) (Context7 index)
- oEmbed: `author_name`, `author_url`, `thumbnail_url`, `thumbnail_width`, and `thumbnail_height` are removed from Facebook post, Facebook video, and Instagram post oEmbed responses. "These changes will apply across all API versions on November 3, 2025." — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) (Context7 index)
- June 14, 2025 entry (summary): Business Login adds `force_reauth`, and "deprecated" `enable_fb_login` and `force_authentication`. — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- December 3, 2025 entries (summary): accept or decline collaboration invites requires `instagram_basic`; a new DELETE endpoint for Instagram media requires `instagram_manage_contents`. — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- February 6, 2026 entry (summary): the `enable_fb_login` parameter lets developers decide whether Facebook Login appears on the Instagram sign-in screen. The authorize reference lists it with a default of `true`. — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog); [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) (Context7 index)
- March 30, 2026 entry, Creator Marketplace (summary): "Account-level rate limits for the Discovery API have increased from 240 to 1,000 queries per user per hour." The entry applies to all API versions and names no endpoints. — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- March 30, 2026 entry, Partnership Ads (summary): a `creator_username` filter on the `branded_content_ad_permissions` endpoint, with no new scope named. — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- April 22, 2026 entry, Partnership Ads label (summary): a publish-time "Paid partnership" label, and brand-partner tags capped at 2 through `branded_content_sponsor_ids`. — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- April 22, 2026 entry, Like Media and Comments API (summary): endpoints to like or unlike posts and comments (not Stories or private-account content), requiring `instagram_manage_engagement`. — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- May 15, 2026 entry (summary): oEmbed calls can now be made "without an access token." — [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)
- Older rule, not 2025 or 2026: "Advanced Access now requires Business Verification," dated "As of February 1, 2023." — [Business verification](https://developers.facebook.com/docs/development/release/business-verification) (summary)

### Inferences
- The scope rename and the v1.0 deprecation are the changes most likely to break an existing CLI. Check the scope strings in the code, and confirm no legacy endpoints are used.
- The June 2025 and February 2026 entries on `enable_fb_login` conflict. The current authorize reference documents the parameter, so it is probably available now, but the live changelog should be checked.
- Based on the entries fetched, no 2025 or 2026 change touches token lifetimes or the 4800-times-impressions formula. This is an inference from a partial read.

### Gaps
- The changelog was read from June 2025 onward through WebFetch. Earlier entries were seen only as Context7 snippets, so the absence of other changes before June 2025 is not established.
- The Discovery API entry names no endpoints, so whether it applies to the calls a CLI would make is unknown.
- The Graph API version policy (how long v25.0 remains supported) was not checked.
- The `enable_fb_login` status conflict is unresolved.
