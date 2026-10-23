# Official-route Instagram repos, SDKs and webhook code: source-level comparison

Date: 2026-10-20. Read-only. GitHub files were read through the GitHub MCP tools at the commits listed below. npm, PyPI and Node.js pages came through WebFetch, so they are fetch summaries. Nothing was installed, built or run.

Labels: **verified** = read from a repository file or a search fragment at a pinned commit. **fetch summary** = WebFetch paraphrase or quote. **unverified** = not checked, or an inference drawn from verified code (marked "inference"). First-round facts keep their first-round labels.

Pinned commits: instagram-graph-api-lib `67574def42d25de25973e7a5e5ec3bd7d147f514`; felipeequaresma/instagram-api-sdk `4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d`; fbsamples/messenger-platform-samples `3c3853a84a5d87d2567e75e649655822f535fdf6`; facebook/facebook-python-business-sdk `efd8423a2e595ea8d4c04eb824ce113f2f1d68cd`; PixelFred0/ig-agent-cli `d37b15b286d224f7f3aeb70718d23d13a86232ac`; anatolyben/instagram-graph-test-server `6a12ebe8c610af220ce5751ae1b3248932a29493`.

**Bottom line.** The first round recommended instagram-graph-api-lib as the request layer. Its source does not support that. It targets graph.facebook.com with a Page ID, sends the token in the query string, sets no timeout, retries nothing, does not check HTTP status, reads no usage headers, and has no webhook code. The only Instagram Login client read, felipeequaresma's SDK, is closer to the owner's needs but has three problems that matter here: it retries POST, it keeps tokens in a plaintext file by default, and its refresh timer is wrong for 60-day tokens. Meta's own webhook sample has the only constant-time signature comparison among the webhook code read, but its defaults for unset secrets are empty strings, which weaken both of its checks, and it auto-comments on posts. Borrow shapes and endpoint names. Write the transport, the webhook checks and the token scheduler yourself.

## Key Question 1: What does each project cover, and which Graph API version does it target?

### Takeaway
Only two read projects are Graph clients. The lib uses Facebook Login with a Page ID on graph.facebook.com, and covers publishing, comments, insights and hashtags. felipeequaresma's SDK uses Instagram Login on graph.instagram.com. Its auth code and webhook handler were read, and its messaging, comments and media folders exist but their contents were not read. Neither covers likes, follows or discovery in the code read, and neither covers both login products, which the owner's Goal 4 requires. The lib pins no Graph version by default. felipe's SDK defaults to v21.0, not the v26.0 that the first round recommended.

### Cited Findings

| Project | Read at source level | Host and login | Coverage seen in the code read | Graph version |
|---|---|---|---|---|
| [instagram-graph-api-lib](https://github.com/TiagoGrosso/instagram-graph-api-lib) (npm `instagram-graph-api` 7.0.0, MIT) | Client.ts, AbstractRequest.ts, AbstractResponse.ts, Constants.ts, GetUserLongLivedTokenRequest.ts, package.json, README, check.yml, integration.yml | graph.facebook.com; Page ID and Page token (Facebook Login) | Publishing, comments, insights, hashtags, content-publishing limit, account info; 32 factory methods | Not pinned by default |
| [@felipeequaresma/instagram-api-sdk](https://github.com/felipeequaresma/instagram-api-sdk) (npm 1.0.4, MIT) | AuthManager.ts, WebhookHandler.ts, HttpClient.ts, InstagramClient.ts, TokenStorage.ts, utils/retry.ts; folder listings | graph.instagram.com (feature calls and token exchange); api.instagram.com (OAuth); graph.facebook.com (debug_token); Instagram Login | OAuth, token lifecycle, webhook handler; feature folders for comments, media and messages exist but were not read | v21.0 by default |
| [fbsamples/messenger-platform-samples](https://github.com/fbsamples/messenger-platform-samples) (Meta sample) | app.py in full; node/app.js and the signature utility via search fragments | graph.facebook.com; Page token (Messenger and Page) | Webhook handshake and signature check; sample comment on feed posts | Unversioned URL |
| [facebook-python-business-sdk](https://github.com/facebook/facebook-python-business-sdk) 26.0.2 (Meta, Marketing API) | api.py via grep fragments; instagramuser.py by path only | Marketing API | Marketing SDK with an InstagramUser object; not a content client | api_version defaults to None |
| [facebook-nodejs-business-sdk](https://www.npmjs.com/package/facebook-nodejs-business-sdk) (Meta, Marketing API) | Not read | Marketing API | Not read | Not read |
| [PixelFred0/ig-agent-cli](https://github.com/PixelFred0/ig-agent-cli) (TypeScript, MIT) | Root and src listings | Instagram Login (first round) | Not read beyond layout | Not read |
| [anatolyben/instagram-graph-test-server](https://github.com/anatolyben/instagram-graph-test-server) (npm 0.5.0, MIT) | Root listing; npm description | Instagram Login (local test server) | Not read | Not read |
| [mikusnuz/meta-mcp](https://github.com/mikusnuz/meta-mcp) (npm 2.2.2, MIT) | Not read; code search returned no hits | Instagram and Threads (first round) | First round counts 57 tools | Not read |

Table cells are verified unless they cite the registry or the first round.

Feature matrix. "Yes" means the file named in the bullets below contains the feature. "Folder only" means a folder exists in the listing but its contents were not read.

| Feature | lib | felipe SDK | Meta messenger sample | Meta Python SDK |
|---|---|---|---|---|
| Container publishing (photo, reel, carousel, story) | Yes (Client.ts) | Folder only (media) | No | Not checked |
| Comments (read, reply, hide, delete) | Yes (Client.ts) | Folder only (comments) | Comment posting only | Not checked |
| Likes | No | Not in listings (unverified) | No | Not checked |
| Insights | Yes (page, media, story) | Not read | No | Not checked |
| Messaging and conversations | No | Folder only (messages); webhook handles messages and reactions | Webhook only | Not checked |
| Webhooks | No (README says not covered) | Yes (handler; no HTTP server) | Yes (Flask receiver) | No |
| Business discovery | No | No folder for it | No | InstagramUser object exists (Marketing API) |
| Hashtag search | Yes (id, recent, top) | No folder for it | No | Not checked |

Bullets with sources:
- lib factory methods cover page info, page media, page insights (lifetime, day, week, month), media info, children, comments, post comment, simple-post and story insights, hashtag id, recent and top media, comment get, hide and delete, replies, tags, container status, photo, reel, carousel, story photo and video publish, publish, page stories, recently searched hashtags, content-publishing limit, and instagram account info. No factory for webhooks, mentions, likes, follows, messages or discovery: [Client.ts](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/src/main/Client.ts). Verified.
- lib README: the lib "does not yet cover" mentions (Mentions, Mentioned Comments, Mentioned Media) or webhooks: [README](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/README.md). Verified.
- lib request tree has directories comment, common, container, data, hashtag, media and page, and none for business, likes, messages or webhooks: [requests folder](https://github.com/TiagoGrosso/instagram-graph-api-lib/tree/67574def42d25de25973e7a5e5ec3bd7d147f514/src/main/requests). Verified (listing).
- lib host: `API_URL = 'https://graph.facebook.com'`: [Constants.ts](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/src/main/Constants.ts). Verified.
- lib version: `baseURL = ${Constants.API_URL}/${this.apiVersion ?? ''}`, and `apiVersion` is optional in the Client constructor: [AbstractRequest.ts](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/src/main/requests/AbstractRequest.ts) and [Client.ts](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/src/main/Client.ts). Verified. The values of the ApiVersion enum were not read.
- felipe host and version: `baseURL: https://graph.instagram.com/${this.apiVersion}` with default `v21.0`, in [HttpClient.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/client/HttpClient.ts) and [InstagramClient.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/client/InstagramClient.ts). Verified. Its AuthManager URLs carry no version segment: [AuthManager.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/auth/AuthManager.ts). Verified.
- felipe default scopes are `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments` and `instagram_business_content_publish`: [InstagramClient.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/client/InstagramClient.ts). Verified. The first round flagged `instagram_business_content_publish` against the App Review spelling `instagram_business_content_publishing` (first round, conflict 17).
- felipe npm description: "TypeScript SDK for Instagram Graph API with authentication, messaging, comments, and webhooks": [npm package](https://www.npmjs.com/package/@felipeequaresma/instagram-api-sdk), source [registry search](https://registry.npmjs.org/-/v1/search?text=instagram%20graph%20api&size=20). Fetch summary.
- messenger sample: the Page-based comment call is an unversioned URL, `https://graph.facebook.com/{post_id}/comments`: [app.py](https://github.com/fbsamples/messenger-platform-samples/blob/3c3853a84a5d87d2567e75e649655822f535fdf6/messenger-api/messenger-api-and-webhooks/app.py). Verified.
- Python SDK: an `InstagramUser` class exists in [instagramuser.py](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/adobjects/instagramuser.py) (search result path). Verified. Its `init` signature has `api_version=None` and `timeout=None`: [api.py](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/api.py) (grep fragment). Verified. What None resolves to was not read.
- Node SDK: registry `dist-tags.latest` is 24.0.1 ([registry JSON](https://registry.npmjs.org/facebook-nodejs-business-sdk), fetch summary). The first round lists the GitHub tag as v26.0.2 (first round, verified metadata).
- Other npm packages (registry search, fetch summary; code not read): [instagram-graph-api-sdk](https://www.npmjs.com/package/instagram-graph-api-sdk) (talhaansarii, Apache-2.0, 1.0.0, 2026-02-15, "Type-safe TypeScript SDK for Instagram Graph API with Instagram Login"); [@binary-black-holes/instagram-api](https://www.npmjs.com/package/@binary-black-holes/instagram-api) (MIT, 0.4.0, 2026-06-05, type-safe and class-oriented; the same repository is also published as @binary_blackholes/instagram-api 0.1.0); [@apicity/meta](https://www.npmjs.com/package/@apicity/meta) (MIT, 0.16.1, 2026-10-17, "Instagram Graph API provider for posting reels via the public-URL flow (graph.instagram.com)"); [instagram-graph-test-server](https://www.npmjs.com/package/instagram-graph-test-server) (MIT, 0.5.0, 2026-09-30, local test server for Instagram Login); [@chatblix/meta-sdk](https://www.npmjs.com/package/@chatblix/meta-sdk) (MIT, 0.2.4, 2026-10-06, NestJS module, repository "Not provided"); [@improvelabs/instagram-graph-api](https://www.npmjs.com/package/@improvelabs/instagram-graph-api) (MIT, 0.1.4, 2025-03-06, repository field points at the lib); [@framers/agentos-ext-channel-instagram](https://www.npmjs.com/package/@framers/agentos-ext-channel-instagram) (Apache-2.0, 0.1.3, 2026-10-11, a broad channel adapter); [@onebots/adapter-instagram](https://www.npmjs.com/package/@onebots/adapter-instagram) (MIT, 0.1.11, 2026-10-12); [n8n-nodes-instagram-publisher](https://www.npmjs.com/package/n8n-nodes-instagram-publisher) (MIT, 1.0.10, 2026-08-04, publishes images, reels, stories and carousels); [@mcpware/instagram-mcp](https://www.npmjs.com/package/@mcpware/instagram-mcp) (MIT, 1.0.4, 2026-03-19, claims 23 tools); [graph-ig](https://www.npmjs.com/package/graph-ig) (MIT, 0.0.1, 2024-06-29); [instagram-graph-fetcher-js](https://www.npmjs.com/package/instagram-graph-fetcher-js) (ISC, 1.0.11, 2022-06-30); [instafeed-node-js](https://www.npmjs.com/package/instafeed-node-js) (MIT, 0.1.4, 2020-07-21); [instagram-gallery](https://www.npmjs.com/package/instagram-gallery) (MIT, 1.4.0, 2022-12-30, React component); [machinepack-instagramnodemachines2](https://www.npmjs.com/package/machinepack-instagramnodemachines2) (MIT, 1.6.0, 2018-11-27); [@bernierllc/social-media-instagram](https://www.npmjs.com/package/@bernierllc/social-media-instagram) (2.0.1, licence "SEE LICENSE IN LICENSE", 2026-10-01). Source for all: the [registry search](https://registry.npmjs.org/-/v1/search?text=instagram%20graph%20api&size=20). Fetch summary.
- MCP servers, first-round metadata only: [AleemHaider/instagram-mcp](https://github.com/AleemHaider/instagram-mcp) (Python, MIT, 24 tools); [IvanBBaev/instagram-mcp](https://github.com/IvanBBaev/instagram-mcp) (TypeScript, 28 tools); [mikusnuz/meta-mcp](https://github.com/mikusnuz/meta-mcp) (TypeScript, 57 tools); [adelaidasofia/instagram-mcp](https://github.com/adelaidasofia/instagram-mcp) (README says "Official"; unverified); [William-Gao/instagram-mcp](https://github.com/William-Gao/instagram-mcp) (Python, Instagram Login); [alexfisenkov/meta-instagram-mcp](https://github.com/alexfisenkov/meta-instagram-mcp) (TypeScript, read-only). First round, verified metadata; tool counts were not checked against code.

### Inferences
- The lib serves the Page-based Facebook Login model. felipe's SDK serves Instagram Login. A CLI on Instagram Login needs felipe-style hosts and endpoints, and the lib's Page-based builders do not apply to it. Unverified (inference).
- The lib's publishing builders take `imageUrl` and `videoUrl` ([Client.ts](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/src/main/Client.ts)), which matches the public-URL input in the spec's decision N. @apicity/meta describes a public-URL flow for reels (fetch summary). Verified for the lib; the match is an inference.
- No Meta-owned repo read is an Instagram Graph content client. The two Meta SDK repos are Marketing API SDKs. Verified for the repos read; the list is not exhaustive.

### Gaps
- Not read: most of the lib's endpoint classes; Enums.ts (ApiVersion values and field lists); felipe's feature folders (comments, media, messages), types, errors, logger and rate-limit modules, tests and README; code of mikusnuz/meta-mcp, IvanBBaev/instagram-mcp, AleemHaider/instagram-mcp, adelaidasofia/instagram-mcp, William-Gao/instagram-mcp, alexfisenkov/meta-instagram-mcp, instagram-graph-api-sdk (talhaansarii), @binary-black-holes/instagram-api, @apicity/meta, @chatblix/meta-sdk, the test server's source, and ig-agent-cli's source.
- Likes, follows and discovery: no read code covers them. felipe's feature folders might, and they were not read.
- PyPI search returned a client-challenge page ([PyPI search](https://pypi.org/search/?q=instagram+graph+api)). It was not retried, so the Python wrapper survey stops at the first round's list. GitHub repository search was not run in this pass.

## Key Question 2: Request layer, covering tokens, timeouts, retries, POST retry and rate-limit headers

### Takeaway
None of the four request layers read meets the spec's Graph-client requirements in full. felipeequaresma's SDK is the most complete of the four: a 30-second timeout, rate-limit error codes, and Retry-After captured on those errors. But it retries POST through a method-agnostic helper, and it logs request params that include the token at debug level. The lib sets no timeout, no retry and no status check, and sends the token in the query string. Meta's Python SDK applies a timeout only if one is passed, and retries only failed batch sub-requests. Nothing read reads X-Business-Use-Case-Usage or X-App-Usage, and nothing read uses Retry-After to schedule a retry.

### Cited Findings

lib:
- Token: `this.params = { access_token: accessToken }`, and `execute()` builds the URL as `${config.baseURL}/${config.url}?${paramsToURLSearchParams(config.params)}`. No Authorization header: [AbstractRequest.ts](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/src/main/requests/AbstractRequest.ts). Verified.
- Timeout: `const response = await fetch(request);` with no timeout and no abort signal: same file. Verified.
- Retry: none. `retry` appears only in devDependencies (`"retry": "^0.13.1"`, `"@types/retry": "^0.12.2"`): [package.json](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/package.json). AbstractRequest.ts does not import it. Verified.
- Status and errors: `const parsed = await response.json(); return this.parseResponse(parsed);`. There is no `response.ok` check, and [AbstractResponse.ts](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/src/main/requests/AbstractResponse.ts) stores only `data`. Verified.
- Method: the base class `method()` returns `'GET'`. POST subclasses were not read, and no POST-specific retry or method logic exists in the files read. Verified.
- Usage headers: none in the lib files read. Verified.

felipe SDK:
- Token: the request interceptor adds `access_token` to `config.params`, which puts it in the query string, not a header: [HttpClient.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/client/HttpClient.ts). Verified.
- Logging: the same interceptor calls `logger.debug('HTTP <METHOD> <url>', { params: config.params })`, and `params` includes `access_token`. Verified. The default logger level was not read, so whether debug lines print by default is unverified.
- Timeout: the axios instance takes `timeout: config.timeout || 30000`, and InstagramClient passes `timeout: 30000` by default: [HttpClient.ts] and [InstagramClient.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/client/InstagramClient.ts). Verified. AuthManager sets `timeout: 30000` on its own axios instance: [AuthManager.ts]. Verified.
- Local rate limiter: `new RateLimiter({ requestsPerHour: this.config.rateLimit || 200 })`, acquired in the request interceptor before each call: [InstagramClient.ts] and [HttpClient.ts]. Verified. The RateLimiter internals were not read. It is a self-imposed limit, not a reading of Meta's headers.
- Error mapping, in `transformError`: a failure with no response becomes NetworkError. A response whose body has `error` becomes RateLimitError for Graph error codes 4, 17 and 32 (retry-after header, default 60 seconds), or ApiError otherwise. Other HTTP failures become NetworkError with the status: [HttpClient.ts]. Verified. The trigger is the Graph error code, not HTTP status 429.
- Retries: `get`, `post` and `delete` each wrap the call in `retry(async () => ...)`. `request()` is the only call without retry: [HttpClient.ts]. Verified.
- Retry policy, in [utils/retry.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/utils/retry.ts): maxRetries 3; initialDelay 1000 ms; maxDelay 10000 ms; backoff multiplier 2. An error is retryable if its message contains "network", "timeout", "econnreset", "enotfound" or "econnrefused", or if it has `response.status` between 500 and 599. The function takes no method argument, so POST is retried. It does not read Retry-After, so the retryAfter on RateLimitError is never used. Verified.
- Python SDK, [api.py](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/api.py): requests calls pass `timeout=self._session.timeout`, and the init default is `timeout=None`. The only retry is for failed batch sub-requests (`retry_indices`). A case-insensitive grep found no Retry-After, retry_after, max_retries, use-case-usage or app-usage handling; FacebookResponse keeps `headers` and exposes an ETag accessor. Verified (grep fragments).
- Messenger sample: `requests.post(url, json=payload, headers=headers)` with no timeout argument, and the page token in the URL: [app.py](https://github.com/fbsamples/messenger-platform-samples/blob/3c3853a84a5d87d2567e75e649655822f535fdf6/messenger-api/messenger-api-and-webhooks/app.py). Verified.

### Inferences
- The spec rule that POST is not retried by default conflicts with felipe's pattern. A POST that times out (a DM, a comment or a publish) can reach the server and then be retried, which repeats the side effect. The mechanism is verified; the consequence is unverified (inference).
- The 5xx branch of `isRetryableError` looks for a `response` property. The interceptor has already converted axios errors into the module's own error classes. Unless those classes keep `response`, 5xx errors are never retried. Unverified (inference); errors/InstagramError.ts was not read.
- The owner must write usage-header throttling and Retry-After scheduling. No read project supplies either. Unverified (inference).
- Spec Call G (fail closed on HTTP 429 and error 190): felipe's rate-limit mapping keys on Graph error codes 4, 17 and 32; no read project maps error 190. The owner must write this mapping. Verified for the files read.
- A token in the query string reaches any log, error text or proxy that records request URLs. Spec rule H needs redaction at the transport layer. Unverified (inference).

### Gaps
- Whether Graph endpoints accept `Authorization: Bearer` for these calls was not checked against Meta's pages in this pass. Unverified.
- lib Utils.ts and Params.ts (serialisation of dates and undefined values) were not read.
- The default logger level in felipe's logger module was not read, so whether the debug line prints by default is unknown.

## Key Question 3: Token handling, covering the Instagram Login exchange and the 60-day refresh

### Takeaway
felipeequaresma's SDK is the only read project that implements the Instagram Login exchange (ig_exchange_token) and refresh (ig_refresh_token). Its refresh scheduler is wrong for 60-day tokens: the timer delay overflows, so refresh runs after 1 ms. Its default token storage writes plaintext JSON to the working directory. The lib implements only the Facebook Login exchange (fb_exchange_token), and its URL construction appears to put a second `?` in the query string.

### Cited Findings

felipe SDK, [AuthManager.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/auth/AuthManager.ts):
- Authorization URL: `https://api.instagram.com/oauth/authorize`, with client_id, redirect_uri, scope (comma-joined), response_type=code and an optional state. Verified.
- Short-lived exchange: POST `https://api.instagram.com/oauth/access_token` with a form body (client_id, client_secret, grant_type=authorization_code, redirect_uri, code). Verified. This is the only exchange step that keeps client_secret out of the URL.
- Long-lived exchange: GET `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=…&access_token=…`. Verified.
- Refresh: GET `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…`. Verified.
- Scheduling: `timeUntilRefresh = Math.max(0, timeUntilExpiry - refreshBuffer)`, in seconds, with refreshBuffer of 7 days. Then `setTimeout(…, timeUntilRefresh * 1000)`. Verified.
- Node.js timers: "When `delay` is larger than `2147483647` or less than `1` or `NaN`, the `delay` will be set to `1`." ([Node.js timers](https://nodejs.org/api/timers.html)). Fetch summary; the quote is from the fetch model, so check the live page.
- Arithmetic: a 60-day token gives 5,184,000 − 604,800 = 4,579,200 s, which is 4.58 × 10^9 ms. The limit is 2,147,483,647 ms, about 24.9 days, so any token more than about 31.9 days from expiry overflows. Verified arithmetic on verified code; the Node rule is fetch summary.
- Effect: the refresh fires after 1 ms. On success, saveToken re-arms the same overflowing timer, so refreshes repeat. On failure, nothing is re-armed, and the planned refresh 7 days before expiry never runs. Unverified (inference). Meta's refresh age rule (at least 24 hours old, unexpired, carries instagram_business_basic) is in the first round's Business Login notes ([Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login); first round, verified).
- Storage: the refresh timers are an in-memory Map. Persistence goes through the `ITokenStorage` interface. Verified.
- Introspection: GET `https://graph.facebook.com/debug_token?input_token=…&access_token=<appId>|<appSecret>`. Verified.
- Errors: failures are logged with `logger.error(…, error)` and rethrown as AuthenticationError. An axios error can carry the request URL, which for the exchange includes client_secret. Unverified (inference); the logger module was not read.
- Fallback: when the long-lived exchange fails and `allowShortLivedToken` is set, the short-lived token (about 1 hour) is saved with `expiresAt` = now + 3600 ([InstagramClient.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/client/InstagramClient.ts)). Verified. If expires_in is missing, expiry defaults to 60 days. Verified.

felipe default storage, [TokenStorage.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/auth/TokenStorage.ts):
- `FileTokenStorage` defaults to `./tokens.json`. It writes the whole token map as JSON with `fs.writeFile` and sets no file mode. It encrypts nothing. Verified. InstagramClient uses it when no storage is given. Verified. This conflicts with spec rule H, which keeps tokens in the OS credential store.
- `MemoryTokenStorage` exists "for testing/development" and is usable as a test double. Verified.
- The scope spelling `instagram_business_content_publish` is noted in Key Question 1.

lib, [GetUserLongLivedTokenRequest.ts](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/src/main/requests/page/user_long_lived_token/GetUserLongLivedTokenRequest.ts):
- `GRANT_TYPE = 'fb_exchange_token'`. `url()` returns `/oauth/access_token?grant_type=fb_exchange_token&client_id=…&client_secret=…&fb_exchange_token=<token>`. Verified.
- `execute()` appends another `?` followed by the params, and the params hold `access_token` ([AbstractRequest.ts]). Verified. Inference, not executed: the final URL has two `?` characters, so the fb_exchange_token value includes `?access_token=…`, and the exchange likely fails. The URL also has a double slash after the base, and the secret and token are not URL-encoded. Unverified (inference).
- Constants.ts defines only graph.facebook.com. No graph.instagram.com host and no ig_exchange_token appear in the files read. Verified for those files.
- README: "Long-lived Page Tokens do not have an expiration date" ([README](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/README.md)). The text is verified; the claim is not checked here, and the first round lists Page token expiry as open.

messenger sample:
- No token exchange. It reads PAGE_ACCESS_TOKEN from the environment: [app.py]. Verified.

### Inferences
- felipe's endpoint names and parameters are a usable reference for the Instagram Login path. Its scheduler must be rewritten, for example with delays capped at 2^31 − 1 ms or with a periodic expiry check. Judgment on verified code and fetch-summary docs.
- Spec Call I (exchange and signature check run on the owner's machine) matches felipe's design, since its SDK runs the exchange in-process with the secret from config. Verified match.
- Conflict: the lib's README says long-lived Page tokens do not expire, while the first round left Page token expiry open. Not resolved.
- Spec Call G: no read code handles error 190 or its subcodes, so the owner must add that handling and the stop state. Verified for the files read.

### Gaps
- felipe's tests (vitest, tests folder) were not read, so it is unknown whether refresh scheduling is tested.
- Token invalidation (error 190, subcode 460, the user removing the app) is not handled by any read code. The first round also left it open.
- felipe's file storage writes in one writeFile call, which is not atomic. Whether this matters for the owner's event store was not assessed.

## Key Question 4: Webhooks, covering signature scheme, constant-time comparison and the handshake

### Takeaway
Meta's Python sample and felipeequaresma's handler both compute HMAC-SHA256 over the payload with the app secret, and compare lowercase hex digests. Among the webhook code read, only the Python sample compares in constant time (hmac.compare_digest) and verifies over raw bytes. felipe's handler requires the `sha256=` prefix and uses plain equality. The Python sample reads the header without checking the prefix, and its empty-string defaults for APP_SECRET and VERIFY_TOKEN weaken both checks. felipe's handler dedupes by timestamp and sender, not by message ID.

### Cited Findings

Meta messenger sample, [app.py](https://github.com/fbsamples/messenger-platform-samples/blob/3c3853a84a5d87d2567e75e649655822f535fdf6/messenger-api/messenger-api-and-webhooks/app.py):
- Handshake: GET with `hub.mode == "subscribe"` and `hub.challenge` present. `hub.verify_token` is compared with `==` against TOKEN. A mismatch returns "Verification token mismatch" with 403. A match returns the challenge with 200. Any other GET returns "INVALID REQUEST" with 400. Verified.
- Signature: requires `X-Hub-Signature-256` (403 "MISSING SIGNATURE HEADER" if absent). Splits on the first "=" (403 "MALFORMED SIGNATURE HEADER" if there is none). Uses the text after "=" with no prefix check. Computes `hmac.new(APP_SECRET.encode("utf-8"), request.get_data(), hashlib.sha256).hexdigest()`, compares with `hmac.compare_digest`, and returns "INVALID SIGNATURE HASH" with 403 on mismatch. Verified.
- Fail-open defaults: `TOKEN = os.environ.get("VERIFY_TOKEN", "")` and `APP_SECRET = os.environ.get("APP_SECRET", "")`. Verified. With VERIFY_TOKEN unset, an empty hub.verify_token matches. With APP_SECRET unset, the HMAC key is empty, so a payload signed with an empty key would pass. Unverified (inference).
- After verification: accepts only object "page", reads only `entry["changes"][0]`, and handles only field "feed". `comment_on_post` posts "Lovely post!" to `https://graph.facebook.com/{post_id}/comments` with the page token in the URL. Verified. This conflicts with the spec's anti-goal on comments on other people's posts.
- Tests: `tests/test_webhook_security.py` sends a signed `X-Hub-Signature-256: sha256=…` header and an invalid one ([test file](https://github.com/fbsamples/messenger-platform-samples/blob/3c3853a84a5d87d2567e75e649655822f535fdf6/messenger-api/messenger-api-and-webhooks/tests/test_webhook_security.py)). Verified via search fragments.
- Node sample: [node/app.js](https://github.com/fbsamples/messenger-platform-samples/blob/3c3853a84a5d87d2567e75e649655822f535fdf6/node/app.js) and utils/webhook-signature.js read the older `x-hub-signature` header. Verified via search fragments; the Node signature code was not read in full.

felipe handler, [WebhookHandler.ts](https://github.com/felipeequaresma/instagram-api-sdk/blob/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d/src/webhooks/WebhookHandler.ts):
- Handshake: `handleVerification(query)` returns `query['hub.challenge']` only if `hub.mode === 'subscribe'` and `hub.verify_token === this.config.verifyToken`, and returns null otherwise. It sets no HTTP status. Verified.
- Signature: requires a non-empty signature. `signature.split('=')` must give two parts, with the first equal to 'sha256'. Computes `createHmac('sha256', this.config.appSecret)`, `update(payload)` and `digest('hex')`, then compares with `calculatedHash === expectedHash`. Plain equality, not constant-time. Verified.
- Payload type: `verifySignature` and `processEvent` take `payload: string`. The class does not enforce that the string is the raw body. Verified from the signatures. Inference: a framework that re-serialises JSON would break the check. Unverified (inference).
- Processing: a failed signature throws `WebhookVerificationError`. The payload is then JSON-parsed. Objects other than 'instagram' are ignored. Messaging events go to 'messages' and 'message_reactions'. Changes go to 'comments', 'mentions' and 'story_insights'. Other fields are logged. Verified.
- Dedupe: an in-memory Set capped at 1,000 entries. The messaging key is `${event.timestamp}-${event.sender.id}`, and the change key is `${change.field}-${JSON.stringify(change.value)}`. The message ID is not used. Verified. Two distinct events with the same timestamp and sender collapse into one, and a restart clears the Set.

Generic code in search results:
- Hand-written constant-time helpers in other providers' webhook code, for example [AmazingDM/github-webhook-to-telegram src/github.ts](https://github.com/AmazingDM/github-webhook-to-telegram/blob/3655cb59cc60db570c93a4bbd34a2eabeaea7a14/src/github.ts) (a length check, then an XOR loop). Verified via fragment. These are not Meta sources.

First round:
- The header carries "sha256=" and is computed over the payload with the app secret: [Meta Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks). First round, verified. The docs do not name HMAC or the digest encoding (first round, open question 16).

### Inferences
- The two Meta-related implementations agree on HMAC-SHA256 with the app secret and lowercase hex. That is agreement between two code bases, not a Meta specification. The live phase should capture one real payload and check it. Unverified (inference).
- A safe receiver for the owner's spec would: refuse to start without APP_SECRET and VERIFY_TOKEN; verify over the raw bytes before JSON parsing; require the `sha256=` prefix; compare with a constant-time function after a length check; dedupe on the message ID; and answer the handshake with plain text and HTTP 200. Judgment on the verified code above.
- Spec Call P (the event log and pull tools) relies on clean deduplication. The spec dedupes on the message ID, as the first round recommends; felipe's handler does not.

### Gaps
- Meta's handshake reply status and content type are not in these notes (first round, open question 16).
- Node's `crypto.timingSafeEqual` could not be read. The WebFetch of [Node.js crypto](https://nodejs.org/api/crypto.html) stopped before the section, so its argument rules are unverified in this pass.
- felipe's examples/ and README were not read, so it is unknown whether its docs pass raw bodies.

## Key Question 5: Testing and quality signals

### Takeaway
The lib's CI is the only CI read in this pass. It covers pull-request commit lint, build, coverage tests, format check and lint, plus a weekly live integration run against a real Page. Its weak points are `npm install` in every job, a curl-to-bash coverage upload, and a newest registry version dated 2024-08-08. felipeequaresma's SDK uses vitest, ESLint, Prettier and Docker files, and its 1.0.4 npm release is dated 2026-06-07. Its tests and CI were not read.

### Cited Findings

lib:
- [check.yml](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/.github/workflows/check.yml), on pull_request: commitlint over the PR's commits; `npm run cti` and `npm run build`; `npm test` with coverage, then `bash <(curl -s https://codecov.io/bash)`; `npm run check-format`; `npm run lint`. Node 20 in every job, and `npm install` in every job. Verified.
- [integration.yml](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/.github/workflows/integration.yml): cron `0 6 * * 6` (Saturdays at 06:00 UTC) and manual dispatch. Environment `integration-tests`. Uses `vars.PAGE_ID` and `secrets.PAGE_ACCESS_TOKEN`. Runs `npm run integration-test` (src/it). Verified.
- [package.json](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/package.json): jest ^29.7.0, ts-jest, and jest-fetch-mock ^3.0.3 as devDependencies. `test` runs `jest --coverage --testPathPattern=src/test/`. TypeScript ^5.5.3, ESLint ^9.9.0, Prettier 3.6.2, husky ^9, commitlint, semantic-release. No `dependencies` or `engines` fields. Verified.
- Config files present: eslint.config.mjs and a legacy .eslintrc.json, tsconfig.json, .commitlintrc.json, .prettierrc. Verified (listing); contents not read.
- Version field: the repo's package.json says "0.1.0", while the registry lists 7.0.0. Verified and fetch summary.
- Release: the registry search lists 7.0.0 with publish date 2024-08-08 ([registry search](https://registry.npmjs.org/-/v1/search?text=instagram%20graph%20api&size=20)). Fetch summary. Last push 2025-11-24 and 95 stars: first round, verified metadata.
- README: codecov badge, and "dependency free" since 7.0. Verified.

felipe SDK:
- Root listing: vitest.config.ts, tests/, .eslintrc.json, .prettierrc, Dockerfile, docker-compose.yml, .env.example, .github/, docs/, examples/, LICENSE, tsconfig.json: [root](https://github.com/felipeequaresma/instagram-api-sdk/tree/4d2c4c8221b0d27a829fbcbfbc7296bb53ae605d). Verified (listing).
- Dependencies seen in imports: axios and eventemitter3. Verified.
- npm: 1.0.4, published 2026-06-07, MIT, TypeScript. Fetch summary ([registry search](https://registry.npmjs.org/-/v1/search?text=instagram%20graph%20api&size=20)).

Other projects:
- messenger sample: a tests folder exists ([test file](https://github.com/fbsamples/messenger-platform-samples/blob/3c3853a84a5d87d2567e75e649655822f535fdf6/messenger-api/messenger-api-and-webhooks/tests/test_webhook_security.py)). Verified via fragment.
- Test server: root has src/, test/, bin/, pnpm-lock.yaml, README.md (55,687 bytes) and LICENSE ([root](https://github.com/anatolyben/instagram-graph-test-server/tree/6a12ebe8c610af220ce5751ae1b3248932a29493)). Verified (listing). Its npm description, "A local test server for the Instagram Graph API (Instagram Login), for testing comment moderation, messaging, mentions…", is a fetch summary.
- ig-agent-cli: root has CLAUDE.md, SECURITY.md, SETUP.md, CHANGELOG.md, skills/, test/ and bun.lock. src/ has cache, commands, config, ig, lib, output and cli.ts ([root](https://github.com/PixelFred0/ig-agent-cli/tree/d37b15b286d224f7f3aeb70718d23d13a86232ac)). Verified (listing).

### Inferences
- The lib's test suite probably mocks fetch, since jest-fetch-mock is a devDependency. It probably does not test timeouts, headers or error mapping, because its request layer has none. Unverified (inference); tests not read.
- A unit test that asserts the built URL for each request would have caught the double `?`. A test with fake timers that checks the scheduled delay would have caught the refresh overflow. Judgment.

### Gaps
- Fixtures, mocks and coverage figures were not read in any project. The lib's src/test and src/it, and felipe's tests/, were not opened.
- The lib's ci-master.yml and dependabot.yml, and felipe's .github/ workflows, were not read.
- Lint rules and TypeScript strictness were not checked.

## Key Question 6: Licences, and what can be borrowed

### Takeaway
The lib, felipe's SDK, the test server and ig-agent-cli are MIT, per the registry or the first round. Meta's SDKs and sample carry Meta licence terms whose texts were not read. Borrow endpoint names, parameter sets, handshake order and test patterns. Write the transport, the token scheduler and the constant-time checks yourself, since none of the read transports meets the spec.

### Cited Findings

Licences:
- lib: MIT ([package.json](https://github.com/TiagoGrosso/instagram-graph-api-lib/blob/67574def42d25de25973e7a5e5ec3bd7d147f514/package.json)). Verified. The README says the lib is made by independent contributors and is not officially related to Instagram or Facebook. Verified.
- felipe SDK: MIT, per the [registry search](https://registry.npmjs.org/-/v1/search?text=instagram%20graph%20api&size=20). Fetch summary. LICENSE file present (listing).
- ig-agent-cli: MIT, per the first round (metadata).
- Test server: MIT, per the registry search. Fetch summary.
- instagram-graph-api-sdk (talhaansarii): Apache-2.0, per the registry search. Fetch summary; not read.
- @bernierllc/social-media-instagram: licence "SEE LICENSE IN LICENSE", per the registry search. Fetch summary; not read. Do not reuse without reading.
- facebook-python-business-sdk: the PyPI `license` field is "LICENSE.txt", with no licence classifiers ([PyPI JSON](https://pypi.org/pypi/facebook-business/json)). Fetch summary; the text was not read.
- facebook-nodejs-business-sdk: npm licence "Platform License", which is not an SPDX identifier ([registry JSON](https://registry.npmjs.org/facebook-nodejs-business-sdk)). Fetch summary; the text was not read.
- messenger sample: each file's header names the LICENSE file in the repo root ([app.py](https://github.com/fbsamples/messenger-platform-samples/blob/3c3853a84a5d87d2567e75e649655822f535fdf6/messenger-api/messenger-api-and-webhooks/app.py)). Verified; the LICENSE text was not read.

Borrowable pieces, verified in code:
- lib `AbstractRequest.config()` returns `{ params, method, url, baseURL }` separately from `execute()`, so request shape can be tested without a network. Keep the seam. Rewrite `execute()` with a timeout, a status check, header reads and token redaction.
- lib `Client.ts` factory methods, one per Graph edge with field-list parameters. Use them as a checklist for the spec's surfaces.
- lib publishing builders: PostPagePhotoMediaRequest, PostPageReelMediaRequest, PostPageCarouselMediaRequest (takes child IDs), PostPageStoriesPhotoMediaRequest, PostPageStoriesVideoMediaRequest, GetContainerRequest and PostPublishMediaRequest. These are the container flow the README describes.
- lib GetContentPublishingLimitRequest, for the quota read the spec calls for.
- felipe `AuthManager`: the Instagram Login authorize, code exchange, long-lived exchange and refresh endpoints and parameters. Keep the form POST for the code exchange. Replace the scheduler.
- felipe `HttpClient` interceptors and `transformError`: the token injection point, the error classes and the rate-limit code list (4, 17, 32). Do not reuse its retry for POST.
- felipe `utils/retry.ts`: exponential backoff with a cap. Adapt it to honour Retry-After and to retry GET only. The adaptation is judgment.
- felipe `ITokenStorage` seam and `MemoryTokenStorage`, for tests. Do not use `FileTokenStorage` for the owner's tokens.
- felipe `WebhookHandler`: handshake, signature and routing as separate methods over a string payload, which is testable. Fix the comparison and the dedupe key before use.
- Meta `app.py`: the check order (handshake, then signature over raw bytes before parsing), `hmac.compare_digest`, and the status code for each failure. Drop the auto-comment, the empty-string defaults and the `changes[0]` indexing.
- Meta `test_webhook_security.py`: signed-header fixtures for valid and invalid signatures. Pattern verified via fragments.
- Test server (anatolyben): a possible local fake of the Instagram Login API for unit tests. Unverified; read it before use.

### Inferences
- No read client meets the spec's Graph-client requirements. The lib gives the cleanest request-builder shape. felipe's SDK gives the Instagram Login endpoints and the webhook structure. This does not support the first round's recommendation of the lib as the request layer. It supports spec Call C, which calls for a thin owned client and a read of the lib first. Judgment on verified code.
- Spec Goal 4 (both logins) needs two host paths: graph.facebook.com with Page IDs (lib style) and graph.instagram.com (felipe style). No read project covers both. Judgment.
- Spec Call N (publishing input) matches the lib's URL-based publish builders, and the input still needs a public host. Verified for the builders; the host question is open.

### Gaps
- Licence texts for both Meta SDKs and the messenger sample's LICENSE were not read.
- The lib's remaining endpoint classes and Enums.ts were not read, so field names and ApiVersion values are unverified.
