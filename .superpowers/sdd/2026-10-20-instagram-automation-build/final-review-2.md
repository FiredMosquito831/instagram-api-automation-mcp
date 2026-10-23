# Final whole-branch review 2

Date: 2026-10-23. Scope: D:\Projects2\InstagramApi (Node ESM package), read-only. No project file was edited and no git command was run. The suite was not re-run (1161/1161 on Node 24.6.0 and 22.13.1 is taken as reported). No live call was made.

Read first: progress.md (section "OWNER DECISIONS MADE BY THE CONTROLLER (2026-10-22)", lines 397-412), final-decisions-report.md, README.md, global-constraints.md.

Method: searches over src/, bin/, sidecar/ and test/ for the patterns in the brief, and a read of every hit that could carry a value. The decision map (final-decisions-report.md) was treated as a claim to check, not as evidence. A scratch script (D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\inject-check.mjs) parsed the test call sites of network-capable functions, read-only.

Verdict words: LEAK (a real leak), FALSE POSITIVE, KNOWN LIMIT (already in the README), CLEAN (checked, no finding), MET, MET (LIVE) (implemented; a live check is still open), PARTLY, MISSING.

---

## 1. Security sweep

### 1.1 Real leaks

| ID | File:line | What it does | Verdict |
|---|---|---|---|
| S-L1 | src/unofficial/sidecar.js:114 | `lastStderrLine` cuts the child's last stderr line to 200 characters, then redacts it: `redact(lines[last].slice(0, 200))`. The cut happens first. A registered value (a session string, registered by `prepareSession` at sidecar.js:42-81) that starts before character 200 is cut, so its first part does not match the registry and reaches the error text. The text goes on through `teardown` (sidecar.js:146, 209-213) into an `IgError`, whose redaction cannot match a partial value. | LEAK, low severity, conditional. It needs the child to print a registered session value on stderr across that boundary. The Python side does not print sessions (sidecar/ig_sidecar.py:270-275 log names only; 300-302 stdout moved to stderr), so the trigger would be a library log line. Fix: `redact(lines[last]).slice(0, 200)`, the order guard.js:56 already uses. |

Count of real leaks: 1.

### 1.2 Known limit not in the README (not counted as a leak)

| ID | File:line | Finding | Verdict |
|---|---|---|---|
| S-K1 | src/cli.js:562-566 and 593-594; src/http.js:160-162 | `ig status` sends the api_token as a Bearer header over plain `http://` to the configured `http.host`. Only 0.0.0.0, `::` and empty are rewritten to 127.0.0.1; any other non-loopback host is used as configured. `ig serve` accepts a non-loopback host when an api_token is set. The default is loopback, so there is no default leak. The README (lines 39, 375) does not say the HTTP API is plain HTTP, so a LAN bind carries the token in clear text. | KNOWN LIMIT missing from the README. Add: "The HTTP API is plain HTTP. On a non-loopback host, api_token travels in clear text on that network; keep the host on loopback or put the API behind TLS." |

### 1.3 Hits that look like leaks and are not

| File:line | Why it is not a leak |
|---|---|
| src/oauth.js:213, 603 | `denied.slice(0, 64)` is cut before the message is redacted by the `IgError` constructor (errors.js:46). The value is the `error` query parameter of a redirect whose state already matched (oauth.js:209-211), so it is not a registered secret. FALSE POSITIVE (same ordering as S-L1, but no secret route). |
| src/oauth.js:423-431 (`refusedDetail`) | Only `error_type` of up to 40 letters is used (ERROR_TYPE_PATTERN). FALSE POSITIVE. |
| src/cli.js:112, 268, 284 (`atStep`) | Host name (config value), secret names, and an `IgError` message that is already redacted. FALSE POSITIVE. |
| src/secrets.js:86, 124, 138, 147, 153, 155 | Variable and secret names only. FALSE POSITIVE. |
| src/unofficial/sidecar.js:176 | The sidecar message becomes an `IgError` and is redacted there (errors.js:46). FALSE POSITIVE. |
| src/cli.js:593-594 | See S-K1. |

### 1.4 Checked and clean

| Check | File:line | Verdict |
|---|---|---|
| Token only in the Authorization header (Graph client) | src/graph/client.js:254 (Bearer header); :81-82 (`access_token` refused as a query or form field); :205 (URL built with no token); :212 (`redirect: 'error'`) | CLEAN. Note: a JSON body is not checked for `access_token` (client.js:93-98). No call site sends one. Latent, not a leak. |
| Paging `next` link never followed | src/graph/paging.js:2-3, 26-33 (cursor only); src/graph/endpoints/discovery.js:17-28 (nested and top-level `paging` stripped); src/cli.js:453-455 (Facebook Page list refuses a `next`) | CLEAN |
| Long-lived exchange: token in header, secret in body, no URL token (O-7) | src/oauth.js:8-10 (comment), :445 (form: grant_type and client_secret), :448 (URL without query), :450 (Bearer header), :476 (registerToken) | CLEAN |
| Short-lived exchange: secret in form body | src/oauth.js:376-391 | CLEAN |
| Token refresh: no token in URL | src/token.js:99 (GET with grant_type only); token header by client.js:254 | CLEAN |
| Facebook bridge: fragment cleared, body POST, origin rule | src/oauth.js:69-101 (script), :82 (`replaceState` clears the fragment), :87-93 (POST body), :574-580 (exact Origin, or same-origin Sec-Fetch-Site when no Origin), :596-599 (state), :609 (registerToken) | CLEAN (live check open, O-8). The fragment is in the browser's redirect URL until :82 runs; see R-5. |
| MCP forward: token to loopback only | src/mcp.js:21 (LOOPBACK_HOST), :74 (URL), :79-81 (Bearer header) | CLEAN |
| Publish HEAD and one-byte GET: no token, no redirect | src/graph/endpoints/media.js:318-322 (`redirect: 'error'`, no token), :388 (comment) | CLEAN |
| Sidecar: secrets on stdin only; no print; stdout reserved | src/unofficial/sidecar.js:85-109 (env allowlist), :225-242 (request written to stdin, not logged); sidecar/ig_sidecar.py:12-13, 17-18, 228-251 (scrub of raw, URL-encoded and JSON-escaped forms), 270-275 (log names only), 299-302 | CLEAN |
| Sidecar: no secret stored | src/cli.js and src/service.js have no caller of the adapter's `login` or `restoreSession` (see 1.5) | CLEAN (nothing persisted) |
| Logs and console writes | src/cli.js:67-68 (redacted), bin/ig.js:31-32 (redacted), src/cli.js:124-146 (hidden prompt does not echo), src/mcp.js:203-205 (framing line: error name only), src/mcp.js:118, 126 (redacted), src/audit.js:166-176 (line redacted before append), src/service.js:411-419 (warning: name only), src/service.js:125-135 (error and stop detail: kind, status, code), src/poller.js:88-92 and 627 (name only), src/http.js:130, src/graph/client.js:139, src/oauth.js:286, 652 (code only), src/webhooks.js:200-287 (kinds and counts) | CLEAN |
| IgError messages carry no values | src/errors.js:42-50 (message and details redacted); the interpolated values are names, kinds, statuses, counts or HTTP codes (for example state.js:170, guard.js:74, oauth.js:397, 460, media.js:149, messaging.js:52, 61, 67, 314-329) | CLEAN |
| Stop detail | src/guard.js:47-56 (redact, then cut to 200: the right order); src/poller.js:88-92 (kind, status, code only) | CLEAN |
| process.env reads of secrets | src/secrets.js:84-90 (env read, then `register`), :97-104 (keyring, then `register`); other env reads are non-secret: src/config.js:110 (IG_GRAPH_VERSION, IG_APP_ID), src/cli.js:80 (IG_CONFIG), :896 (IG_PYTHON) | CLEAN. Every secret read is registered (secrets.js:42, redact.js:201). |
| Default bind | src/http.js:25 (DEFAULT_HOST 127.0.0.1), :158-162 (empty host refused; non-loopback without a token refused), :373 (the only `server.listen`, with the validated host), src/config.js:70 (127.0.0.1), src/oauth.js:53, 292, 658 (login and approval servers on 127.0.0.1) | CLEAN. No default binds 0.0.0.0 or `::`. |
| HTTP token check | src/http.js:220-223 (SHA-256 digests compared), :266-268 (401 before the tool lookup), :301-303 (Host check on every route) | CLEAN |
| Webhook comparisons | src/webhooks.js:48-55 (verify token, sameText, constant time), :60-67 (HMAC, `timingSafeEqual` on equal-length buffers) | CLEAN |
| Retries of writes | src/graph/client.js:10-13 (retry statuses and kinds), :253-275 (loop: only when `retryable`), :282 (GET retry), :287-295 (POST retry only with `retryPost: true`; no call site sets it), :299 (DELETE not retried); src/token.js:99 (`noRetry`) | CLEAN |
| Retry of a pre-send private reply or auto-reply | src/service.js:137-141, 745-760 (one retry, only after a pre-send failure with no earlier request at Graph), :568-579 (reservation; released once), :902-903 (second failure is final, RETRY_USED_UP) | CLEAN. Bounded; no loop. See 1.5 about how the auto-reply retry is reached. |
| Every outbound write is gated | src/service.js:687-781 (`runOutbound`: stop check 699 and 727, route 700, client 706, confirm 707, early and counted caps 712-713 and 728-729, usage hold 715 and 734, record 736, perform 744). Every write method goes through it: autoReplyTo 862-876, publishMedia 1229-1263, commentReply 1265-1277, commentHide 1279-1291, commentDelete 1293-1304, like 1308-1321, unlike 1323-1336, dmSend 1339-1351, privateReply 1354-1399, mediaDelete 1401-1412, follow, unfollow, profileEdit 1415-1449. The endpoint write calls (client.post and client.del in src/graph/endpoints/*) are reached only inside `perform`. No write is called from src/poller.js, src/webhooks.js, src/cli.js, src/http.js or src/mcp.js. | CLEAN |
| Stop check before every outbound action | src/service.js:699 (first line of `runOutbound`), :727 (again, after the reads) | CLEAN |
| Confirm gate | src/guard.js:38-42 (non-boolean refused), :232-234 (`gate`) | CLEAN |
| Sidecar pin and refusing handlers | sidecar/requirements.txt:2 (`instagrapi==3.1.0`); sidecar/ig_sidecar.py:106-116 (both challenge handlers refuse; `with_challenge_flow=False`); src/config.js:57 (unofficial off) | CLEAN |
| Stored records | src/cli.js:387-396 (owner token record: times and scopes, no token value); src/cli.js:465-469 (facebook record: no token value) | CLEAN |

### 1.5 Observations (not counted)

- The sidecar adapter is built at src/cli.js:895, but no production code calls its `login` or `restoreSession` (the adapter defines them at src/unofficial/sidecar.js:262-264; no caller in src/cli.js or src/service.js). So follow, unfollow and profileEdit can only return `no_session` at present. The README does not say a sidecar login step is missing. This is a functional gap for the live phase, not a leak.
- The auto-reply retry (O-5) needs the same inbound event to be notified again. The poller dedupes by message id, so the retry may be reached only through a webhook redelivery. Not traced further.

---

## 2. Decisions O-1 to O-13

| # | Decision (short) | Verdict | Code (file:line) |
|---|---|---|---|
| O-1 | Structured codes first; text as fallback; the more severe stop when they conflict | MET (conflict clause); "structured first" holds as a tie rule only (flagged) | src/errors.js:79-109 (`mapGraphError`); :90-99 (every signal is a candidate; the most severe wins; a tie keeps the earlier, structured candidate); :93 (RATE_LIMITED structured); :95 (CHECKPOINT by text); src/stops.js:10-17 (ranks). Pin: test/errors.test.js:574-575. |
| O-2 | Exact-value registry, plus a token-shape scrub (IGAA, IGQV, EAA, Bearer) and escaped forms | MET | src/redact.js:30-31 (BEARER), :35 (AUTHORIZATION), :117 (TOKEN_SHAPE), :121-124 (tokenShaped), :201-223 (registry forms: raw, encodeURIComponent, JSON-escaped), :227-235 (maskRegistered); src/events.js:274, 303, 596 (drafts and text); sidecar/ig_sidecar.py:228-251 (Python forms) |
| O-3 | Damaged state starts stopped; service up; outbound refused; poller halted; `ig_stop_clear` clears | MET | src/guard.js:108-120 (`readStops` failure gives STATE_CORRUPT and an unsaved record); src/state.js:286 (damaged file copied aside); src/guard.js:149-153 (STATE_LOST); src/poller.js:50-53 (HALTING), :197-203 (halt follows the guard) |
| O-4 | Daily buckets: business discovery 50, mentioned media 50 | MET | src/config.js:33-34 (DEFAULT_CAPS); src/caps.js:101-102 (keys), :151-154 (daily rules), :14-16 (READ_ACTIONS: not in the outbound total) |
| O-5 | One retry, only after a pre-send failure | MET | src/graph/client.js:26-28 (PRE_SEND_CODES: ECONNREFUSED, ENOTFOUND, EAI_AGAIN), :41-44, :208-214 (`details.preSend`); src/service.js:137-141, 745-760, 568-579, 902-903 |
| O-6 | Refresh paused under CHECKPOINT and ACTION_BLOCKED; expiry in status; warning under 7 days | MET | src/service.js:76 (PAUSE_KINDS), :554-557 (refreshPause); src/token.js:74 (EXPIRY_WARNING_MS = 7 days); service.js expiry in `ig_token_status` |
| O-7 | Long-lived exchange: token in Bearer header, secret and grant in form body, no URL token | MET (LIVE) | src/oauth.js:8-10, :445, :448, :450, :476. Meta may refuse the POST; the refusal is loud (oauth.js:459-461). |
| O-8 | Facebook fragment flow through loopback; token posted in body; never in a URL, log or record | MET (LIVE) | src/oauth.js:69-101, :82, :87-93, :183 (`response_type=token`), :520-624 (handler). The "never in a URL" wording is overstated: see R-5. |
| O-9 | instagrapi 3.1.0; refusing challenge handlers; sidecar off by default; live check first | MET (LIVE) | sidecar/requirements.txt:2; sidecar/ig_sidecar.py:106-116; src/config.js:57 |
| O-10 | 423 Locked for AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, RATE_LIMITED; kind in body; STOPPED stays 409 | MET | src/http.js:38-48 (STATUS_FOR_KIND), :66-78 (`failureOf`), :93 (kind in body) |
| O-11 | (a) a like on media reads the owner profile first and fails closed; (b) private replies count toward the 50-a-day DM cap | MET | src/service.js:548-551 (`ensureUsageReading`), :1318, :1333 (like and unlike preflight); src/caps.js:59 (`private_reply` in `owner_dm`), :76 (`privateReply` to `private_reply`), :128 (owner_dm, 50 a day) |
| O-12 | Turning auto-replies on with confirm is consent; stated in README | MET | src/service.js:867 (`confirm: true` set by the service), :897 (AUTO_REPLY_OFF); README line 184 |
| O-13 | Owner's HTTPS host; media.dir only; publicBaseUrl; traversal refused; HEAD check; no upload route | MET (LIVE) | src/config.js:65 (media defaults), :154-171 (`checkPublicBaseUrl`), :188-200 (allowedHosts); src/graph/endpoints/media.js:23-25 (MEDIA_LIMITS: 8 MiB image, 100 MiB video; .jpg/.jpeg/.png, .mp4/.mov), :184-190 (NUL, leading slash, colon, `..`), :218-229 (realpath inside media.dir), :241 and :276 (regular file, at open), :243 (size), :277-280 (device, inode, link count), :308-310 (HEAD refusal set 403, 405, 501), :356-368 (one-byte GET fallback); src/service.js:1229-1238 (checkPublish before the count), :1236 (story.images, default off) |

Decisions not implemented: 0.

Notes on the decisions:
- O-1. The decision text says "the more severe stop when they conflict". The code does that: a text CHECKPOINT (rank 3) outranks a structured RATE_LIMITED (rank 2), which errors.test.js:574-575 pins. "Structured codes first" is implemented only as the tie rule. The decision map (final-decisions-report.md, O-1) reads this as PARTLY MET; this review reads it as MET on the conflict clause, with the wording flagged for the owner (see R-4). The owner should confirm which reading is intended.
- O-6. The decision map cites token.js:71-77 for expiryStatus; EXPIRY_WARNING_MS is at token.js:74. Consistent.
- O-8. The decision map cites src/oauth.js:176 for the authorize URL. The Facebook authorize builder is at oauth.js:178-185, with `response_type=token` at :183. Correct the reference.
- O-13. The decision map cites media.js:21-25 for the limits; MEDIA_LIMITS is at media.js:23-25.

---

## 3. README against code

### 3.1 Mismatches

| ID | README line | What it says | What the code does | What it should say |
|---|---|---|---|---|
| R-1 | 141 | "Messages per thread for `ig_dm_messages`: 20 by default, up to 1000 items over the pages" | The default is 1000: `const wanted = limit ?? DM_MESSAGES_MAX` (src/service.js:1112), with the limit 1 to 1000 (service.js:1113-1114) and the comment at service.js:1105 ("default 1000") | "1000 by default (the `limit` argument takes 1 to 1000), read through the messages edge up to 10 pages." Also fix the stale tool description at src/tools.js:259 ("the first page"). |
| R-2 | 319 | "A thread that fails is retried after 1, 2 and 4 ticks, and then at most every 32 ticks" | The wait doubles on each failure: `min(2^(count-1), 32)` (src/poller.js:254), so 1, 2, 4, 8, 16, then 32 ticks | "A thread that fails waits 1, 2, 4, 8 and 16 ticks, then at most 32 ticks between retries (A-24)." |
| R-3 | 379-391 (status table) | The table lists 200, 400, 401, 403, 404, 409, 413, 423, 429, 500, 503. | 405 is also returned: METHOD_NOT_ALLOWED for a non-POST on /tools/:name (src/http.js:265), a method other than GET or POST on the webhook path (:289), and a non-GET on /health (:306), with an Allow header (:64). | Add a row: "405 | A method the route does not serve, such as GET on `/tools/:name`. The `Allow` header names the method." |
| R-4 | 210-212 | "The classification reads Graph's structured signals first ... The text is the fallback, and it is read at the same rank as the structured signal it matches." | Every signal is a candidate, and the most severe wins, so text can outrank a structured signal (src/errors.js:90-99). The next paragraph (line 212) says so. The first two sentences describe a different rule. | "Each structured signal (Graph codes and HTTP 429) and each text phrase is a candidate. The most severe candidate wins; on a tie, the structured signal wins (decision O-1)." |
| R-5 | 353 | "The token is never in a URL, a log or a stored record." | The approval redirect carries the token in the URL fragment, which the browser holds until the bridge page runs `history.replaceState` (src/oauth.js:82). The token is not sent to a server in the fragment, is not logged and is not stored. | "The token is never sent in a request URL, logged or stored. The approval comes back in the URL fragment, which the bridge page clears on load (src/oauth.js:82)." The same overstatement is in decision O-8 (progress.md line 406 and the map). |
| R-6 | 363 | "`ig mcp` forwards each call to `ig serve` on 127.0.0.1:8788" | It forwards to `config.http.port` (src/cli.js:631), which is 8788 by default. | "... to `ig serve` on 127.0.0.1, on the configured `http.port` (8788 by default)." |

Count of README mismatches: 6 (R-1 to R-3 are factual; R-4 to R-6 are wording the reader relies on).

### 3.2 Checked and matching

- Caps (README 112-125, 135-138): every default in DEFAULT_CAPS (src/config.js:22-37) and the rules in src/caps.js: minSpacingMs 2000 (caps.js:247-249), dailyTotal 200, likes 10 an hour and 50 a day (likes and unlike share one counter, caps.js:44-48), follows 20, unfollows 20, ownerDms 50, auto-replies 1 per sender per 24 hours and 100 a day (caps.js:130-137: `perSender: true`), publishing 10 a day, hashtags 30 unique tags per 7 days (caps.js:140-146, `distinctTag`), businessDiscovery 50, mentionedMedia 50, usage threshold 80 and busy 60000 ms.
- Tools (README 262-299): 36 tools (src/tools.js, the registry); destructive set is exactly ig_stop_clear, ig_events_purge, ig_comment_hide, ig_comment_delete, ig_media_delete; the read-only and confirm columns match every row, including ig_dm_mark_read and ig_hashtag_search (readOnlyHint false) and the events tools.
- Stop ranks (README 199): src/stops.js:10-17 (AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, STATE_LOST, STATE_CORRUPT rank 3; RATE_LIMITED rank 2).
- Stop lists and halts (README 200-206): src/poller.js:50-53 (HALTING: AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED, STATE_CORRUPT, STATE_LOST); PAUSE_KINDS (service.js:76) = CHECKPOINT, ACTION_BLOCKED.
- Rate-limit codes (README 194, 210): src/errors.js:54 (4, 17, 32, 613, 80002) and the 429 status.
- Status codes (README 382-391): 200, 400, 401, 403, 404, 409, 413, 423, 429, 500, 503 match src/http.js:38-48, :66-78, :281, :297, the body limit (:21), and src/webhooks.js:290 (503).
- Default port and loopback (README 66, 91, 373, 375): src/config.js:70 and src/http.js:25, 27, 158-162.
- Read limits (README 139-145): src/graph/paging.js:11-12 (10 pages, 1000 items); MESSAGE_PAGE 100 (src/graph/endpoints/messaging.js:24); CONVERSATION_PAGE 100 (src/service.js:67; src/poller.js:59); DEFAULT_COMMENT_LIMIT and MAX_LIMIT 100 (src/graph/endpoints/comments.js:12-13); DEFAULT_LIMIT and MAX_LIMIT 100 (src/graph/endpoints/media.js:15-16); OWNED_PAGE 100 (src/service.js:62); REPLIED_LIMIT 500 (service.js:68); DEDUPE_DAYS 90 (src/events.js:36); SEEN_RETENTION_MS 30 days (src/poller.js:46); FUTURE_HOLD_MS 24 h (poller.js:47); MAX_THREAD_BACKOFF_TICKS 32 (poller.js:48); MAX_FUTURE_MS 5 min (src/util/time.js:12); MAX_BODY_BYTES 5 MB (src/graph/client.js:25).
- Timeouts and retries (README 152-165): TIMEOUT_MS 15 s (src/graph/client.js:9; src/oauth.js:55); BACKOFF_MS 1, 2, 4 s (client.js:13); MAX_RETRY_AFTER 60 s (client.js:16); POLL_MS 5 s and MAX_POLLS 60 (media.js:17-18); HEAD_TIMEOUT_MS 15 s (media.js:28); DEFAULT_TIMEOUT_MS 600000 (src/mcp.js:28); LOGIN_TIMEOUT_MS 5 min (oauth.js:54).
- Sizes (README 151-163, 422-423): MAX_BODY_BYTES 1 MiB (http.js:21); RESPONSE_LIMIT 64 KB (oauth.js:51); PAGE_LIST_LIMIT 256 KB (oauth.js:52); FACEBOOK_BODY_LIMIT 4 KB (oauth.js:46); media 8 MiB and 100 MiB (media.js:23-25); MAX_BUFFER_CHARS 16 MiB (src/unofficial/sidecar.js:11); audit rotation 50 MB and 10 rotations (src/audit.js:14-15).
- Poller bounds (README 64, 166): BOUNDS (src/poller.js:63-67): intervalMs min 1000, maxThreadsPerTick 1 to 100, spacingMs 600 to 60000; defaults in src/config.js:68.
- Token (README 168-169): MIN_REFRESH_AGE_MS 1 day (src/token.js:15); EXPIRY_WARNING_MS 7 days (token.js:74).
- Retention and config (README 70-74): retentionDays 30, minimum 1 (src/config.js:61, 239); `__proto__` refused (config.js:149); unknown top-level keys accepted (no check; config.js:271 is for caps only), which README line 74 already lists as a known limit.
- Confirm (README 181-185): non-boolean `confirm` refused (src/guard.js:38-42).
- One-reply rule (README 223-224, 244): reservation written before the send (src/service.js:1395), refusal for a second reply (:1373-1381), 7-day window from the comment's time (:1383-1391), unreadable time refused (:1388-1389), STOPPED while `oneReplyUnknown` is set (:1362-1365), `clear-one-reply-flag` audited (src/cli.js:534).
- Publishing (README 420-430): drive letter refused by the colon check (media.js:186); symlink refused by the realpath check (:218-229); file kinds and sizes (:23-25, :243); HEAD refusal set 403, 405, 501 (:308-310); story images behind `story.images` (config.js:67; service.js:1236).
- Facebook-only tools (README 309): service.js:95 (FACEBOOK: mediaDelete, hashtagSearch, businessDiscovery).
- Serve lock and login refusal (README 80, 352): src/cli.js:57 (serve.lock), :352, :425.
- Recovery (README 197-229): STATE_CORRUPT copy-aside (state.js:286); STATE_LOST (guard.js:149-153); cursor unknown held (events.js, per the map); recovery record (cli.js:819).

Not checked line by line: the long recovery and redaction passages (README 215-230, 446-468). The code entry points were checked (see the references in 1.4 and 2); the claims in those passages that depend on the event-log internals were not traced.

---

## 4. Test hygiene

Search scope: test/*.js. Hits:

| # | File:line | What | Verdict |
|---|---|---|---|
| T-1 | test/http.test.js:876-887 | `server.listen(9127)` (line 883) on a server from `createHttpServer`. The test patches `Server.prototype.listen` to record calls and restores it in `t.after`. The server's own `listen` throws `IgError CONFIG` before any socket (src/http.js:350-352 says that only `listenHttp`, at :373, may start it). | STUBBED. No socket. OK. |
| T-2 | test/graph-client.test.js:416 | `createGraphClient(options)` inside `assert.throws` (a construction refusal). | Makes no request. OK. |
| T-3 | test/cli.test.js:381, 386 | `runAuthLogin` without `fetchImpl` or an exchange stub. Both refuse before the exchange (no app id at 381; no app secret at 386). | No request. OK. |
| T-4 | test/cli.test.js:691, 1066 | `runAuthLogin` without `fetchImpl`. Both refuse on the held serve lock, before `listen` and before any exchange. | No request. OK. |
| T-5 | test/cli.test.js:549 | `runAuthFacebook` without `fetchImpl`. Refuses on the missing app id, before `receiveToken`. | No request. OK. |
| T-6 | test/cli.test.js:764, 1034, 1112 | `runServe` without `fetchImpl`. 764 uses an injected `build`; 1034 and 1112 refuse on the held serve lock. `runServe` makes no Graph request before `build` (src/cli.js:846-870). | No request. OK. |
| T-7 | test/cli.test.js:945, 948 | `makeGraphClient` without `fetchImpl`. Only builds a client, or asserts a refusal. | No request. OK. |

Network calls found: 0. No `createServer(`, no `http.request`, no `https.request`, no `net.connect`, no `dgram`. Every `fetch` in test/ is a fake (for example graph-client.test.js:39, mcp.test.js:24 and 235, which say "opens no socket"). `setup()` in test/service.test.js:215-250 injects `mediaFetch` (line 248), so the 36 publish calls do not reach the real fetch.

Process spawns (not network, not counted): test/cli.test.js:131, 682, 1175, 2067, 2070 (`node bin/ig.js --help` and a `node -e ''` pid probe); test/sidecar-python.test.js:20, 111, 196, 254 (Python probes and checks, run with `-I -B`). The sidecar tests use a local fixture child (test/sidecar.test.js:11, test/fixtures/fake-sidecar.js), not a network service.

Skips: the only `skip` and `todo` markers are the Python checks in test/sidecar-python.test.js at lines 144, 149, 159, 210, 217, 224, 230, 234 and 266, all with `{ skip: SKIP }`, where `SKIP` (line 31) is set only when Python is not on PATH. These are allowed by the brief and are not counted. There is no `test.todo`, `describe.skip`, `it.skip`, `.only(` or `only: true`. The strings "poll.skip" in test/poller.test.js are audit actions, not skips.

Test-hygiene hits (T-1 to T-7): 12 in total, which is 1 listen (stubbed) plus 11 un-injected call sites (T-2 to T-7, counted by line: 416; 381, 386; 549; 691, 1066; 764, 1034, 1112; 945, 948). None makes a request. Real problems: 0.

---

## 5. Round summary

- Real security leaks: 1 (S-L1, src/unofficial/sidecar.js:114, low, conditional). Known limit not documented: 1 (S-K1, plain HTTP for a non-loopback host).
- Decisions not implemented: 0. O-1 is implemented on its conflict clause, and its "structured first" wording needs the owner's confirmation (R-4). O-7, O-8, O-9 and O-13 are implemented with live checks open.
- README mismatches: 6 (R-1 to R-3 factual; R-4 to R-6 wording).
- Test-hygiene hits: 12, none a network call (T-1 to T-7).

Changes the owner should make or confirm:
1. Fix S-L1: redact the full line before the 200-character cut (src/unofficial/sidecar.js:114). Add a test that a registered value straddling character 200 is masked.
2. Correct the README: R-1 (the DM default is 1000), R-2 (the back-off sequence), R-3 (405), R-4 (the O-1 rule), R-5 (the fragment), R-6 (the configured port). Also src/tools.js:259 ("the first page").
3. Document S-K1 (the HTTP API is plain HTTP) in the README, or refuse a non-loopback `http.host` for `ig status`.
4. Decide whether the sidecar needs a login or restore step before the live phase (1.5). No production code calls the adapter's login.
5. Correct the decision map references (O-8 line 183; O-13 media.js:23-25) and decide the O-1 wording.
6. global-constraints.md (C-1, already open): line 6 says auto-replies are one per conversation; the code and README say one per sender. The file also still lacks the cursor-reset exception and the lookup buckets.

Not verified by this review: the suite was not re-run; no live call was made; the Python sidecar was read, not run; the long recovery and redaction passages of the README were checked at their entry points only (section 3.2).
