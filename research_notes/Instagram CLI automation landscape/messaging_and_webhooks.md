# Instagram Platform: Messaging and Webhooks

Retrieved 2026-10-20. Scope: Meta's Instagram Platform messaging (direct messages) and webhooks, for a CLI that lists conversations, reads messages, and replies. Unless a point says otherwise, the path assumed is the Instagram API with Instagram Login (host graph.instagram.com).

Evidence tags: [C] = text from the Context7 index of Meta's Instagram Platform docs (developers.facebook.com, source /llmstxt/developers_facebook_instagram-platform_llms_txt). [F] = live WebFetch of the official page, summarized by a fetch model, so quotes are as extracted and should be checked against the live page before code depends on them. Untagged lines are inferences or notes.

Known conflicts: (a) the live /webhooks page says its setup sections moved to /webhooks/setup; the handshake, retry, and batching text is now there. (b) API versions differ: v25.0 on the messaging pages, v26.0 on the webhook subscription example, v20.0 on two template pages, and the fetched changelog names v22.0 as its newest version. (c) The Business Login scope is `instagram_business_content_publish` in the authorization URL but `instagram_business_content_publishing` in App Review (not a messaging scope).

## 1. What account type, permission scopes, review requirements, and Page links does messaging need?

### Takeaway
Messaging on the Instagram Login path needs an Instagram Business or Creator account, an Instagram User access token, and the scopes `instagram_business_basic` and `instagram_business_manage_messages`. Advanced Access applies when the app serves accounts it does not own or manage, and Business Verification is then required. The Instagram Login requirement text does not mention a Facebook Page; the Facebook Login path requires one.

### Cited Findings
- Instagram Login path: "Requires an Instagram Business or Creator Account." - [Instagram Platform](https://developers.facebook.com/documentation/instagram-platform) [C]
- Facebook Login path (Messenger Platform's Instagram Messaging API): requires an Instagram Business or Creator Account linked to a Facebook Page. - [Instagram Platform](https://developers.facebook.com/documentation/instagram-platform) [C]
- App users "must have an Instagram professional account. An Instagram professional account can be for a business or creator." For accounts linked to a Page, "your app user must also be able to perform admin-equivalent tasks on the linked Facebook Page." - [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) [C]
- Facebook Login onboarding requires the user to "convert their account to a Professional account, create a Facebook Page that represents their business, then connect that Page to their account." - [Facebook Login for Business](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram) [C]
- Messaging requirements (Instagram Login): permissions `instagram_business_basic` and `instagram_business_manage_messages`; token "requested from a person who can send a message from the Instagram professional account"; "All endpoints can be accessed via the graph.instagram.com host." - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Conversations API requirements: the same two permissions; token "requested from a person who can manage messages on the Instagram professional account." - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [C]
- Authorization URL example scopes: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`, `instagram_business_content_publish`, requested at `https://www.instagram.com/oauth/authorize` with `response_type=code`. - [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) [C]
- Messenger Platform column of the webhook field table (the Facebook Login path) lists `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list` for message fields. - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
- Access levels: "Advanced Access if your app serves Instagram professional accounts you don't own or manage"; "Standard Access if your app serves Instagram professional accounts you own or manage or have added to your app in the App Dashboard"; "Some features may not work properly until your app has been granted Advanced Access." - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- App Review's list of "Available permissions & features" includes "Human Agent" alongside `instagram_business_basic`, `instagram_business_content_publishing`, `instagram_business_manage_comments`, and `instagram_business_manage_messages`. - [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review) [C]
- Business Verification: required "if your app requires Advanced Access; if your app will be used by app users who do not have a Role on the app itself, or a Role in a Business that has claimed the app." - [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) [C]
- Submission path: App Dashboard, Products, Instagram, "API setup with Instagram login", "Complete app review", "Continue to app review", then App Review, Requests, Edit. Reviewers get "Provide verification details" (step-by-step test instructions) and "Credentials (If applicable)." - [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review) [C]
- Migration: apps moving from Facebook Login "might automatically be granted Advanced Access." Name map: `instagram_manage_messages` to `instagram_business_manage_messages`, `instagram_basic` to `instagram_business_basic`. - [App Review, Migrated apps](https://developers.facebook.com/documentation/instagram-platform/app-review) [C]
- Testers: "Your app testers must have a role on your app, grant your app access to all the required permissions, and have a role on the Instagram professional account that owns the app." - [Messaging API, Overview](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Self-messaging (for testing) requires "An Instagram Professional account connected to your app", "Business Messaging API access", and "Webhooks configured for message events." - [Self Messaging](https://developers.facebook.com/documentation/instagram-platform/self-messaging) [C]
- Changelog: Nov 10, 2025, "We now support an Instagram Professional account messaging itself." - [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) [F]
- Changelog check: no 2025-2026 changelog entry mentions the human agent feature, private replies, or messaging scopes. - [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) [F]

### Inferences
- A CLI that only manages the developer's own professional account likely fits Standard Access, because the docs describe "accounts you own or manage" under Standard Access. Confirm against the App Dashboard for the actual setup.
- The Instagram Login requirement text names no Facebook Page, so the Instagram Login path most likely needs no Page link. The docs do not state "no Page required" in those words.

### Gaps
- The full review checklist (for example, screencasts or messaging-specific reviewer steps) was not in the retrieved text.
- The OAuth token exchange and token lifetime rules were not retrieved.
- Scope-name conflict: `instagram_business_content_publish` (authorization URL) versus `instagram_business_content_publishing` (App Review list and migration table). Messaging scope names match on every page checked.

## 2. Which endpoints list conversations and messages, which one sends, and how is the recipient identified?

### Takeaway
List threads with `GET /<IG_ID>/conversations`, list a thread's messages with `GET /<CONVERSATION_ID>?fields=messages`, read a message with `GET /<MESSAGE_ID>?fields=...`, and send with `POST /<IG_ID>/messages`. The recipient is the Instagram-scoped ID (IGSID), not a username. No cursor pagination is documented for the list endpoints.

### Cited Findings
- List conversations: `GET https://graph.instagram.com/v25.0/<IG_ID>/conversations` (or `/me/conversations`). Query parameters: `platform` (required, "Set to instagram") and `access_token` (required). Optional `user_id`: "Instagram-scoped ID for the Instagram user to filter conversations." - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [C]
- Conversation list response: `data[]` of objects with `id` and `updated_time`, where `updated_time` is a "UNIX timestamp of the most recent message." - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [C]
- Thread with one person: add `user_id=<IGSID>`; the response returns that conversation's ID. - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [C]
- List messages: `GET https://graph.instagram.com/v25.0/<CONVERSATION_ID>?fields=messages&access_token=...`; the response has `messages.data[]` with `id` and `created_time`. - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [C]
- Read one message: `GET https://graph.instagram.com/v25.0/<MESSAGE_ID>?fields=id,created_time,from,to,message`. Default fields are `id` and `created_time`; available fields are `id`, `created_time`, `from`, `to`, and `message`. `from` has `username` and `id`; `to` has `data[]` with `username` and `id`. - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [C]
- Send: `POST https://graph.instagram.com/v25.0/<IG_ID>/messages` with header `Authorization: Bearer <INSTAGRAM_USER_ACCESS_TOKEN>` and JSON body `{"recipient":{"id":"<IGSID>"},"message":{"text":"<TEXT_OR_LINK>"}}`. The docs also show `/me/messages` as an alternative. - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Send response: `{"recipient_id": "IGSID", "message_id": "MESSAGE-ID"}`. - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Recipient: "The Instagram-scoped ID (IGSID) of the Instagram user who sent the message to your app user," which is "received from an Instagram messaging webhook notification." `<IG_ID>` is "The app user's Instagram professional account ID ... that received the message." - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Pagination: the Conversations API page documents no `limit`, `paging`, `cursors`, `after`, `before`, `next`, or `previous`, and its sample responses have no paging object. - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [F]

### Inferences
- The `from.id` in a message detail, or `sender.id` in a webhook event, gives the IGSID to reply to. A username can be displayed, but the send call uses only the IGSID (based on field names and the send body).
- Without documented pagination, a CLI should expect one response per list call and verify completeness against a real account. This is unverified.

### Gaps
- Pagination for the conversation and message lists is undocumented. Other Instagram edges document cursors (for example, the tags edge uses `before` and `after`), but those are not the messaging edges. - [Tags, Pagination](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/tags) [C]
- One fetch summary quotes the conversations page as saying the conversation query "will return all message IDs in a conversation." [F] That sentence is not in the Context7 copy, so message-list completeness is unverified.
- Timestamp format conflict: the list placeholders use UNIX timestamps, but the message-detail example shows `"created_time": "2022-07-12T19:11:07+0000"`. - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [C]
- Error response shapes for these endpoints were not in the retrieved text.
- A "User Profile API" page (`messaging-api/user-profile`, described as "profile lookup for chats") is listed in the index but was not fetched. - [Instagram Platform llms.txt](https://developers.facebook.com/documentation/instagram-platform/llms.txt) [F]

## 3. How long after a user's last message can the account reply, and what is allowed after that window?

### Takeaway
A reply is allowed for 24 hours after the user's message. The docs say the window depends on the action that opened it, and a first message after a Click-to-Direct ad can extend it to 7 days. After the window, the only documented options are the human agent tag (7 days from the user's message, restricted to human-staffed support) and a private reply to a comment (within 7 days of the comment, one message). No other Instagram message tags were found. The human agent tag's request syntax was not found.

### Cited Findings
- "Only after an Instagram user has sent your app user's Instagram professional account a message can your app send a message to the Instagram user. Your app has 24 hours to respond to any message sent from an Instagram user to your app user." - [Messaging API, How It Works](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- "The duration of the standard messaging window depends on the user action that opens it. For most user actions, it lasts 24 hours." When the action is a first message after a Click-to-Direct ad, "the window may last up to 7 days from that message." - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [F]
- Overview: "Your app can use the API to respond within 24 hours. If more time is needed to allow a human agent to respond, you can use the human agent tag to send a response within 7 days." - [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) [C]
- Human Agent feature: it "allows your app to have a human agent respond to user messages using the human_agent tag within 7 days of a user's message." Allowed use is "to provide human agent support in cases where a user's issue cannot be resolved in the standard messaging window," for example "when the business is closed for the weekend, or if the issue requires more than 24 hours to resolve." - [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) [C]
- Human agent response: "your app can tag the response to allow your app to send the message outside the 24 hour messaging window." It also requires a custom inbox that can "receive messages sent by people and render them correctly" and "reply to messages via the custom inbox and ensure people successfully received them." - [Messaging API, Human agent experiences](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- An ig.me link into an existing conversation: the webhook "Contains only the referral object and resets the 24-hour messaging window." - [ig.me](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/ig-me) [C]
- Private replies: "Only one message can be sent to the commenter"; "The message must be sent within 7 days of the comment was made on the post or reel"; "For Instagram Live, private replies can only be sent during the live broadcast"; "Follow-up messages can only be sent if the recipient responds, and must be sent within 24 hours of the response." - [Private Replies](https://developers.facebook.com/documentation/instagram-platform/private-replies) [C]
- Private reply request: `POST https://<HOST_URL>/<API_VERSION>/<APP_USERS_IG_ID>/messages` with body `{"recipient":{"comment_id":"<COMMENT_ID>"},"message":{"text":"<COMMENT_TEXT>"}}`. Success returns `recipient_id` (an IGSID) and `message_id`. - [Private Replies](https://developers.facebook.com/documentation/instagram-platform/private-replies) [C]
- Private reply rate limits: "750 calls per hour per Instagram professional account for private replies to comments on Instagram posts and reels"; "100 calls per second per Instagram professional account for private replies to Instagram Live comments." - [Overview, Messaging Rate Limits](https://developers.facebook.com/documentation/instagram-platform/overview) [C]
- Comment replies cannot target live video: "use the Instagram Messaging API to send a private reply instead." - [IG Comment Replies](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) [C]
- No dedicated messaging rate-limit page or messaging app-review page appears in the Instagram Platform index, and the index has no entries for the human agent feature or message tags. - [Instagram Platform llms.txt](https://developers.facebook.com/documentation/instagram-platform/llms.txt) [F]

### Inferences
- Private-reply follow-ups run 24 hours from the commenter's response, not from the original comment (based on the wording). The first private reply must fall within 7 days of the comment.
- The human agent window (7 days from the user's message) and the private reply window (7 days from the comment) have separate clocks, so the CLI should store both timestamps per thread.
- Because the only documented post-window options are the human agent tag and private replies, a CLI cannot send ordinary text to a thread after its window closes.

### Gaps
- The human agent tag request syntax (parameter names, values, placement in the JSON body) was not found on any page checked: the Instagram Login messaging page, the Instagram Platform index, the Messenger Platform "Instagram Messaging" page (only its title came back), and the "Human Agent Escalation" page (no tag content). Unverified.
- A search summary (not a fetched page, so unverified) said the tag is written `HUMAN_AGENT` in the Send API reference, and that private replies stopped needing the tag in August 2021. Neither claim was confirmed. Do not rely on either without checking the Send API reference directly.
- Other message tags for Instagram sends: none found in the index or the pages checked.
- Whether an ig.me link can start a new conversation: the docs describe the referral only for "an existing conversation."
- The "Human Agent" App Review feature has no eligibility detail beyond the overview text.

## 4. Which message types can be sent, and what are the send rate limits?

### Takeaway
Documented send types: text and links (1000 bytes max), up to ten images in one message (out of beta May 6, 2026), quick replies, generic and button templates, the `like_heart` sticker attachment, and audio, video, and PDF attachments (with size limits from one fetch). Send rate limit: 100 calls per second per Instagram professional account for text, links, reactions, and stickers, and 10 per second for audio or video.

### Cited Findings
- Text: "The message text must be UTF-8 and 1000 bytes or less; links must be valid formatted URLs." - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Content types listed: "Audio files, Images, Instagram posts (owned by your app user), Links, Reactions, Stickers, Templates, Text, Videos, PDF Files." - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [F]
- Multiple images: "up to ten `attachment` objects with `type` set to `image`." Sample body: `"message":{"attachments":[{"type":"image","payload":{"url":"<IMAGE_URL>"}}, ...]}`. Changelog, May 6, 2026: "Sending multiple images is now out of beta and available to all accounts." - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]; [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) [F]
- Attachment limits from one fetch: Audio "aac, m4a, wav, mp4" (25MB); Image "png, jpeg" (8MB); Video "mp4, ogg, avi, mov, webm" (25MB); File "pdf" (25MB). - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [F] (verify before use)
- Quick replies: `message.text` plus `message.quick_replies[]`; each item has `content_type` (`text`, `user_phone_number`, or `user_email`), `title` (max 20 characters, truncated if longer), and `payload`. A tap posts the button title as a message and sends a webhook event. - [Quick Replies](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies) [C]
- Generic template: `message.attachment.type` "template", `payload.template_type` "generic", and an `elements` array. The example uses `v20.0` and `/me/messages`, so it is an older example. - [Generic Template](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/generic-template) [C]
- Button template: `template_type` "button", `text`, and `buttons[]` with `type` "web_url" or "postback". The example uses `v20.0`. - [Button Template](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/button-template) [C]
- Heart sticker: `"message":{"attachment":{"type":"like_heart"}}`. - [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Shared media: "Your app user must own any media or posts to be used in the message." - [Messaging API, Overview](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Send rate limit: "100 calls per second per Instagram professional account for messages that contain text, links, reactions, and stickers"; "10 calls per second per Instagram professional account for messages that contain audio or video content." - [Overview, Messaging Rate Limits](https://developers.facebook.com/documentation/instagram-platform/overview) [C]
- Conversations API rate limit: "2 calls per second per Instagram professional account." - [Overview, Messaging Rate Limits](https://developers.facebook.com/documentation/instagram-platform/overview) [C]
- Recent messaging changes (fetch summary): Oct 27, 2025 shared-post support in messaging webhooks; Nov 3, 2025 multi-image Direct collections in beta; Dec 19, 2025 PDF upload and send in Instagram Direct; Mar 13, 2026 Direct Send accepts attachment IDs alongside image URLs; Sept 23, 2025 typing and mark_seen indicators via Sender Actions. - [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) [F]

### Inferences
- A text-only reply command fits the documented send path. Media and templates need their own request shapes.
- The audio/video limit of 10 per second likely applies only to messages carrying those attachments, based on the wording.

### Gaps
- No per-hour or per-day limit for DM sends was found; only per-second send limits are documented. This is not confirmed as absent.
- Request syntax for audio, video, and PDF sends was not retrieved in exact form; only the format table from one fetch.
- Send error codes and retry rules were not found.
- Version: the two template examples use `v20.0`; messaging endpoint examples use `v25.0`. Check the current version before coding.

## 5. How do webhooks work: subscription, message/comment/mention fields, verification handshake, and signatures?

### Takeaway
Create the endpoint, then subscribe with `POST https://graph.instagram.com/v26.0/<INSTAGRAM_ACCOUNT_ID>/subscribed_apps?subscribed_fields=...&access_token=...`. Meta verifies the callback with a GET carrying `hub.mode`, `hub.challenge`, and `hub.verify_token`, and expects `hub.challenge` back. Message events arrive in a `messaging` array with `sender.id` and `recipient.id`. Comments arrive with `field: "comments"`, and on Instagram Login mentions are included in the comments notification. The signature arrives in `X-Hub-Signature-256` as "sha256=..."; the docs say SHA256 over the payload with the App Secret, but do not say HMAC or the digest encoding.

### Cited Findings
- Subscribe: "Send a POST request to the account's /subscribed_apps edge." Instagram Login example: `https://graph.instagram.com/v26.0/<INSTAGRAM_ACCOUNT_ID>/subscribed_apps` with `subscribed_fields` ("Separate field names with commas.") and `access_token` as query parameters. Success body: `"success": true`. - [Webhooks setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup) [F]
- Example: `POST https://graph.instagram.com/v25.0/1755847768034402/subscribed_apps?subscribed_fields=comments,messages&access_token=...` returns `success: true`. - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
- The `/me/subscribed_apps` form is also documented, with "App user's Instagram User access token or Facebook Page access token." - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
- Order: "This step must be completed before you can subscribe to any webhook fields in the App Dashboard." - [Webhooks, Create an endpoint](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]; dashboard flow: "Add the callback URL and verify token. Verify the endpoint, then select the fields that your app needs." - [Webhooks setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup) [F]
- Field table, Instagram Login column (field names verbatim):
  - `messages`, `messaging_postbacks`, `messaging_referral`, `messaging_seen`, `message_reactions`, `messaging_optins`, `messaging_handover`, `standby`: `instagram_business_basic`, `instagram_business_manage_messages`. - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
  - `comments`, `live_comments`: `instagram_business_basic`, `instagram_business_manage_comments`. - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
  - `mentions`: "Included in the `comments` webhook notification." - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
  - `message_echoes`: listed with `instagram_business_basic` and `instagram_business_manage_comments` (an odd pairing; verify). In the Messenger column it is "Included in the `messages` webhook notification." - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
  - `messaging_policy_enforcement`, `story_insights`, `response_feedback`: "Not supported" on Instagram Login. - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
  - `message_edit`: "Introducing the new `message_edit` webhook subscription" (Sept 10, 2025). - [Changelog](https://developers.facebook.com/documentation/instagram-platform/changelog) [F]
- Messaging payload (Instagram Login): every example has `"object": "instagram"`. `entry[]` has `id`, `time`, and `messaging[]`. Each `messaging[]` item has `sender.id`, `recipient.id`, `timestamp`, and one event key. - [Webhooks, Examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples) [F]
  - `message`: `mid`, `text`, `attachments` (each with `type` and `payload.url`), `is_echo`, `is_self`, `is_deleted`, `is_unsupported`, `quick_reply.payload`, `referral`, `reply_to` (with `mid` or `story`). [F]
  - `reaction` (field `message_reactions`): `mid`, `action`, `reaction`, `emoji`. [F]
  - `postback` (field `messaging_postbacks`): `mid`, `title`, `payload`. [F]
  - `referral` (field `messaging_referral`): `ref`, `source`, `type`. [F]
  - `read` (field `messaging_seen`): `mid`. [F]
  - `message_edit`: `mid`, `text`, `num_edit`. [F]
  - Caveat: the fetch summary says the examples are "template-style, not strictly valid JSON." Confirm key names against a live payload.
- Comments payload (Instagram Login): `object` "instagram"; `entry[]` with `id`, `time`, `field` "comments", and `value` containing `id`, `from` (`id`, `username`), `text`, and `media` (`id`, `media_product_type`). - [Comment moderation](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) [C]
- Mentions (Facebook Login example, not Instagram Login): `changes[]` with `field: "mentions"` and `value` containing `comment_id` and `media_id`. - [Webhooks, Examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples) [C]
- Verification: Meta sends a GET with `hub.mode` ("This value will always be set to `subscribe`."), `hub.challenge` (an int), and `hub.verify_token`. The endpoint must "Verify that the `hub.verify_token` value matches the string you set in the **Verify Token** field" and "Respond with the `hub.challenge` value." - [Webhooks setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup) [F]; [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
- Signature: "We sign all Event Notification payloads with a SHA256 signature and include the signature in the request's `X-Hub-Signature-256` header, preceded with `sha256=`." Validation: "Generate a SHA256 signature using the payload and your app's App Secret," then compare with the header value after `sha256=`. "You don't have to validate the payload, but you should." - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]; [Webhooks setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup) [F]
- Response and retries: the endpoint "should respond to all Event Notifications with `200 OK HTTPS`." If an update fails, Meta will "retry immediately, then try a few more times with decreasing frequency over the next 36 hours. Unacknowledged responses will be dropped after 36 hours." - [Webhooks setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup) [F]; [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
- Batching and duplicates: "aggregated and sent in a batch with a maximum of 1000 updates"; "batching cannot be guaranteed"; the server "should handle deduplication" of repeated notifications. - [Webhooks setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup) [F]; [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
- History: "You will not be able to query historical webhook event notification data, so be sure to capture and store any webhook payload content that you want to keep." - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
- HTTPS: "your server must have a valid TLS or SSL certificate correctly configured and installed. Self-signed certificates are not supported." - [Webhooks, Create an endpoint](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]

### Inferences
- An inbound message gives the reply target directly: `messaging[].sender.id` is the IGSID to pass as `recipient.id`. The `message.mid` can be matched against the message list IDs.
- Signature check: compute an HMAC-SHA256 of the raw request body keyed with the App Secret and compare it with the header value. This is the usual construction for this header, but the docs do not say HMAC, so confirm with a real test payload before relying on it.
- Because retries and duplicates happen, deduplicate on `message.mid` (inference from the retry and deduplication text).

### Gaps
- HMAC and digest encoding (hex or base64) are not stated in the retrieved text.
- The HTTP status and content type for the verification reply are not stated.
- No Instagram Login mention example was found; on Instagram Login, mentions are documented only as included in the `comments` notification.
- Version: the subscription example is v26.0 on the setup page and v25.0 on the other pages.
- The Context7 copy of /webhooks includes the handshake and retry text, but the live /webhooks page says those sections moved to /webhooks/setup. Treat /webhooks/setup as the current location.
- `message_echoes` scope pairing and the exact `messages` payload key list rest on fetch summaries, not raw page text.

## 6. Is there a polling alternative for inbound messages, and what does local development need?

### Takeaway
No polling endpoint is documented specifically for inbound messages. The Conversations API (2 calls per second per account) is the closest option, and it has no cursor or `since` filter. Local development needs a public HTTPS endpoint with a valid TLS certificate, since self-signed certificates are not supported. The docs name no tunnel tool.

### Cited Findings
- Conversations API rate limit: 2 calls per second per Instagram professional account. - [Overview, Messaging Rate Limits](https://developers.facebook.com/documentation/instagram-platform/overview) [C]
- Conversation list fields: `id` and `updated_time`. Message list fields: `id` and `created_time`. - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [C]
- Webhook history cannot be queried. - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
- Endpoint requirements: "Create and verify an HTTPS callback endpoint on your server." Self-signed certificates are not supported. - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [F]; [Webhooks, Create an endpoint](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]
- Dashboard flow: add the callback URL and verify token, verify the endpoint, then select fields. - [Webhooks setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup) [F]
- Testing: self-messaging requires "An Instagram Professional account connected to your app", "Business Messaging API access", and "Webhooks configured for message events." - [Self Messaging](https://developers.facebook.com/documentation/instagram-platform/self-messaging) [C]
- Testers "must have a role on your app" and "a role on the Instagram professional account that owns the app." - [Messaging API, Overview](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]

### Inferences
- A polling CLI can call `GET /<IG_ID>/conversations`, compare each `updated_time` with the last value it saw, and re-read only the threads that changed. The docs define `updated_time` as the time of the most recent message, so this is workable, but it is not an official pattern.
- Polling can only read details for the 20 most recent messages in a thread (see section 7), so the poll interval must be short enough to catch each message before it leaves that window.
- Local development: run the server locally behind an HTTPS tunnel that presents a publicly trusted certificate. The docs require valid TLS but name no tool.

### Gaps
- No official polling guidance, cursor, or `since` filter for messages was found.
- No official local development guide was found in the retrieved pages.
- The retry count is documented only as "a few more times" within 36 hours.

## 7. What is not possible?

### Takeaway
The API cannot start a conversation with someone who has never messaged the account, except through a private reply to that person's comment. It cannot run group threads, return details beyond the 20 most recent messages in a thread, or replay past webhook events. Beyond the standard window, only the human agent tag and private replies are documented.

### Cited Findings
- Starting conversations: "Only after an Instagram user has sent your app user's Instagram professional account a message can your app send a message to the Instagram user." - [Messaging API, How It Works](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- "Conversations only begin when an Instagram user sends a message to your app user through your app user's Instagram Feed, posts, story mentions, and other channels." - [Messaging API, How It Works](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Group threads: "Group messaging is not supported. An Instagram professional account can only converse with one customer per conversation." - [Messaging API, Overview](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Read history: "you can only get details about the 20 most recent messages in the conversation." Older messages return "an error that the message has been deleted." - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [F]; "Only the 20 most recent messages in a conversation can be queried; older messages return an error." - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [C]
- Requests folder: "Messages in the Requests folder that have not been active for 30 days will not be returned in API calls." - [Messaging API, Overview](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]. The conversations page wording is "Conversations that are within the Requests folder that have not been active for 30 days will not be returned in API calls." - [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [F]. The two pages say different things (messages versus conversations).
- Shares: "Only the URL for the shared media or post is included in the webhooks notification when a customer sends a message with a share." - [Messaging API, Overview](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) [C]
- Private replies: a single message, and "Follow-up messages can only be sent if the recipient responds." For Live, "Once the broadcast ends, private replies cannot be sent." - [Private Replies](https://developers.facebook.com/documentation/instagram-platform/private-replies) [C]
- Comment replies: "You cannot reply to comments on a live video," "You cannot reply to hidden comments," and "You can only reply to top-level comments." - [IG Comment Replies](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) [C]
- Webhook history: "You will not be able to query historical webhook event notification data." - [Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks) [C]

### Inferences
- A "start conversation" command cannot target a user who has not messaged the account, except through a private reply to a comment, which is the only documented route to a first message.
- If a thread is older than its 20 most recent messages, the CLI can list message IDs if the list returns them, but it cannot read their details.

### Gaps
- Whether an ig.me link can open a new conversation: the docs describe only existing conversations.
- Whether the message list is complete: the sources conflict (see section 2).
- No per-thread message-count limit beyond the 20-message detail rule was found.
- Whether message tags other than the human agent tag exist for Instagram: not found.
