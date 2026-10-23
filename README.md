# Instagram automation service (owner only)

## What this is

This is a service that runs on the owner's own computer. It lets the owner check and act on one Instagram account: the profile, posts, comments, direct messages and insights. An AI assistant can drive it through the Model Context Protocol (MCP), and it also has a local web interface with the same operations.

It is built for care, not volume:

- It works on one account, the owner's. It does not scrape or download other people's data, and it does not send bulk or unsolicited messages, likes, follows or comments.
- Anything that changes the account needs an explicit confirmation from the caller. Without one, the service only shows a preview.
- Each kind of action has a limit per hour or per day. When a limit is reached, the action is held, and the caller is told when to ask again.
- If Instagram signals a problem, such as an expired login, a security checkpoint, a block or a rate limit, the actions that change the account stop until the owner clears the stop.
- Every action is written to a local audit log. The log holds no message text.

Where it stands: the build is complete, and the test suite passes on Node 24.6.0 and on Node 22.13.1 (see "Test status"). The owner's decisions were made on 2026-10-22 and are listed in "Owner decisions". Nothing has been run against live Instagram. No live call has been made, so nothing has been sent to or read from a real account. The live phase (a test account, then checks of Meta's current behaviour) is still to do. The facts that need that check are listed in "Live-phase checks".

Status date: 2026-10-23.

---

## Setup

### What you need

- Node.js 22.12 or newer. The suite was run on Node 24.6.0 and on Node 22.13.1 (see "Test status").
- The packages in `package.json`, installed with `npm install`.
- Only if you use the unofficial route: Python 3.10 or newer, and the sidecar's packages installed from wheels with `pip install --only-binary=:all: -r sidecar/requirements.txt`.
- A Meta developer app, in Development mode (see "The Meta app and Facebook Login").
- For publishing: a public HTTPS host that you run, which serves the media folder (see "Publishing").

### Secrets

There are five secrets. Each one is read from an environment variable first. If that is not set, it is read from the operating system's credential store (Windows Credential Manager on this machine). The unofficial login also keeps two keyring entries, `unofficial_session` and `unofficial_username`. They are not among the five; see "Logging in to the unofficial route".

| Secret | Environment variable | What it is for |
|---|---|---|
| `owner_token` | `IG_OWNER_TOKEN` | The Instagram login token for the owner's account. `ig auth login` stores it. |
| `facebook_token` | `IG_FACEBOOK_TOKEN` | The Facebook login token, for the features that need one. `ig auth facebook` stores it. |
| `api_token` | `IG_API_TOKEN` | The bearer token that `ig mcp` and any HTTP caller present to `ig serve`. A host that is not loopback needs it and `http.allowRemote` (see "The HTTP API"), and `ig serve` refuses to start without them. |
| `app_secret` | `IG_APP_SECRET` | The Meta app secret, for the login code exchange and the webhook signature check. |
| `webhook_verify_token` | `IG_WEBHOOK_VERIFY_TOKEN` | The verify token for the webhook handshake. Needed only if the webhook is enabled. |

- `ig auth set <name>` stores a value in the credential store. It reads a hidden prompt, or standard input.
- Credential store entries use the service name `instagram-automation`, with the secret name as the account.
- A secret must be a non-blank string of at least 8 characters. Each value is registered for masking before it is used, so it does not appear in output or log lines.
- Secret names hold letters, digits and underscores only. A name with a dash or a dot is refused, so each secret has one name: the environment variable (`IG_` and the name in capitals) and the credential store entry are the same name.

### App id, Graph version and other environment variables

- `IG_APP_ID` sets the Meta app id (config key `app.id`). `ig auth login` needs it, together with `IG_APP_SECRET`.
- `IG_GRAPH_VERSION` overrides the Graph API version. The default is `v26.0`.
- `IG_CONFIG` names the config file (see "Config file").
- `IG_PYTHON` names the command that starts the sidecar. The default is `python`.
- These four are the only environment variables for settings that are not secrets.

### Config file

- The file is JSON, with an object at the top. It is found in this order: the `--config` option, then the `IG_CONFIG` variable, then `config.json` in the project root if that file exists. A UTF-8 byte-order mark at the start of the file is ignored.
- It holds settings, not secrets.
- Required: `owner.igUserId`, written as a quoted string. A bare JSON number is refused, because it can lose digits. The id must be digits once the surrounding white space is removed, and a padded id is stored trimmed. Also `owner.accountType`, which is `business`, `creator` or `personal`. Official features need `business` or `creator`.
- Other sections, with their defaults:
  - `caps`: see "Caps".
  - `routes`: the unofficial route (off), and the likes login product (`instagram`).
  - `poll`: `intervalMs` 60000, `maxThreadsPerTick` 20 (accepted from 1 to 100), `spacingMs` 600.
  - `webhook`: off, with the path `/webhooks/instagram`.
  - `http`: host `127.0.0.1`, port `8788`, `allowedHosts` `127.0.0.1` and `localhost`, `allowRemote` `false` (it must be `true` for a non-loopback host; see "The HTTP API").
  - `autoReply`: off, with no rules.
  - `media`: `dir` `./media`, `publicBaseUrl` none, `allowedHosts` (none, or the host of `publicBaseUrl`). See "Publishing".
  - `story`: `images` off. See "Publishing".
  - `retentionDays`: 30, at least 1. `dataDir`: `./data`.
- Each section is type-checked when the file loads, and a value of the wrong type is refused with its field named. A flag must be a real `true` or `false`. A key named `__proto__` is refused. A cap key that is not a cap, such as `caps.privateReplies`, is refused.
- `autoReply.rules` is a list. Each rule holds only `keyword` and `reply`, and each needs a non-blank value. A `reply` is at most 1000 bytes. Anything else is refused at startup.
- `media.publicBaseUrl` must be an https URL with no query string, no fragment and no credentials. Its trailing slashes are removed. `media.allowedHosts` is a list of host names only, with no scheme, path or port.
- **Known limit:** unknown top-level keys are accepted without an error.

### Data directory

- `dataDir` is relative to the project root, not to the folder the command runs from. The default is `./data`.
- It holds `state.json` (the cap counts, the stop state, the cursors, the token record and decisions), `events.jsonl` (inbound events, where message text is kept for 30 days), `audit.jsonl` (the audit log, rotated at 50 MB, with up to 10 rotations kept) and the poller's dedupe index.
- While `ig serve` runs, it holds `serve.lock` there, with the process id. A lock whose process has gone is ignored. A lock that cannot be read is refused.

### Commands

| Command | What it does |
|---|---|
| `ig auth set <name>` | Stores a secret in the credential store. |
| `ig auth login` | Logs the owner in through Instagram Login, with the callback on 127.0.0.1 port 8790. It exchanges the code, then the short-lived token for a long-lived one (a POST, with the token in a header; see "The app secret and the login"). Refused while `ig serve` holds its lock. Stores the owner token only when the account is the owner's. |
| `ig auth facebook` | Logs in through Facebook Login for Business with a loopback page that reads the token from the redirect fragment, then stores the Facebook token. Refused while `ig serve` holds its lock. The flow needs a live check. |
| `ig routes ack-unofficial --confirm` | Prints the warning for the unofficial route and stores the acknowledgement. Without `--confirm` it prints the warning and stores nothing. |
| `ig routes login-unofficial` | Logs the owner in to the unofficial route through the sidecar. It needs `ig routes ack-unofficial --confirm` first, and it refuses while `ig serve` runs. It asks for the username and the password, and for a two-factor code only when Instagram asks for one. The session goes to the keyring, never to a file. See "Logging in to the unofficial route". |
| `ig routes clear-one-reply-flag --confirm` | Clears the one-reply flag that refuses private replies after an unreadable or damaged audit file. Without `--confirm` it prints the flag, its reason and the damaged line count, and changes nothing. Refuses while `ig serve` holds its lock. See "Recovery from a damaged state file". |
| `ig serve` | Runs the HTTP interface on 127.0.0.1:8788, the poller and the hourly token checks. It needs the owner token and a reachable Graph API, and it checks that the token belongs to the owner. It takes the serve lock first. A host that is not loopback needs `api_token` and `http.allowRemote`, and `ig serve` refuses to start without them. With both, it starts over plain HTTP. It prints one warning line on standard error, which carries no token; a loopback start prints nothing extra (see "The HTTP API"). It restores a stored unofficial session when the route is acknowledged. |
| `ig mcp` | Serves the MCP tools over standard input and output. Each call is forwarded to `ig serve`. Logs go to standard error. |
| `ig status` | Prints the status from the running service, or a local summary if the service is not running. It shows the stop, the active kind and the list of stops, the recovery note and the one-reply flag. It sends the token only to a loopback address; for a non-loopback `http.host` it refuses unless `http.allowRemote` is `true`, and a refusal exits with code 1. |

### First run, in order

1. Run `npm install`.
2. Set `IG_APP_ID`, store `app_secret` with `ig auth set app_secret`, and write `config.json` with `owner.igUserId` and `owner.accountType`.
3. Store `api_token` with `ig auth set api_token`. Use a long random value. Until it is set, every tool call over HTTP is refused with 401.
4. Run `ig auth login`. The Meta step of this is a live check (see "Live-phase checks").
5. For Facebook features, run `ig auth facebook`. This also needs a live check.
6. Run `ig serve` in one terminal and `ig status` in another. Run `ig mcp` for an MCP client.

---

## Safety model

### Caps

These are the defaults. The owner changes them in the `caps` section of the config file. Values are whole numbers.

| Cap | Default | Notes |
|---|---|---|
| Any outbound action | At least 2 seconds apart; at most 200 a day in total | |
| Likes (media and comments) | 10 an hour; 50 a day | Like and unlike share the same count. A like on media first reads the owner profile once in this process, to get a usage reading (decision O-11a). |
| Follows | 20 a day | Unofficial route. |
| Unfollows | 20 a day | Unofficial route. |
| Owner-sent direct messages | 50 a day | Private replies count toward this (decision O-11b). |
| Private replies | One per comment, within 7 days of the comment | |
| Auto-replies (only when on) | 1 per sender (person) per 24 hours; 100 a day | |
| Hashtag searches | 30 unique hashtags per 7 days | Its own bucket. It does not wait for the outbound spacing and does not count toward the 200-a-day total. |
| Business discovery lookups | 50 a day | Its own bucket, as for hashtag searches (decision O-4). |
| Mentioned-media lookups | 50 a day | Its own bucket, as for hashtag searches (decision O-4). |
| Publishing | At most 10 a day from this service, and Instagram's quota for the last 24 hours | The quota is read each time. A publish is refused when the quota is used up. |
| Usage throttle | When the app usage reading is 80 or more, outbound calls return busy for 60 seconds. Nothing waits or queues. | The reading comes from Instagram's usage header (total_time or total_cputime). |

A count is recorded before the request is sent, so a request that then fails still counts. This is the fail-closed order. The one exception is a request that failed before it reached Instagram (the connection was refused, or the host name did not resolve), when no earlier request of the same action had reached Instagram. That is not an action, so its count is released. A private reply or an auto-reply that failed that way may be tried once more; a second such failure is final (decision O-5). A publish with an earlier request already at Instagram (its container, for example) keeps its counts, because that request was an action.

The three lookups of other accounts (hashtag search, business discovery and mentioned media) count toward their own bucket only. They do not wait for the outbound spacing and do not count toward the 200 a day total. The lookups are reads, so the stop check applies to them, and each counted search writes an audit line.

### Limits: sizes, pages and times

The table lists every limit in the service that is stricter than the spec, or that the spec does not have. The spec's own counts (spacing, 200 a day, likes, follows, unfollows, auto-replies, hashtag searches, publishing and the 1000-byte DM text) are not repeated.

| Limit | Value | Where |
|---|---|---|
| Business discovery and mentioned-media lookups | 50 a day each | `caps.businessDiscovery.perDay`, `caps.mentionedMedia.perDay` (added by decision O-4) |
| Owner-sent DMs, with private replies counted in it | 50 a day | `caps.ownerDms.perDay` (stricter than the spec's reading, O-11b) |
| Reads: pages and items | Up to 10 pages and 1000 items for one read; the page size is 100 where the endpoint allows | `src/graph/paging.js` (`MAX_PAGES_CEILING`, `MAX_ITEMS_CEILING`) |
| Conversations per read | 100 a page | `src/service.js` (`CONVERSATION_PAGE`), `src/graph/endpoints/messaging.js` |
| Messages per thread for `ig_dm_messages` | 1000 by default (the `limit` argument takes 1 to 1000), read through the messages edge, up to 10 pages | `src/service.js` (`DM_MESSAGES_MAX`) |
| Comments per media | 100 a page, the default for `ig_comments_list` | `src/graph/endpoints/comments.js` (`DEFAULT_COMMENT_LIMIT`, `MAX_LIMIT`) |
| Media listed per call | 100 at most, the default | `src/graph/endpoints/media.js` (`DEFAULT_LIMIT`, `MAX_LIMIT`) |
| Owned media checked for ownership | the first 100 | `src/service.js` (`OWNED_PAGE`) |
| Auto-reply events remembered | the last 500 answered events; the check against a second auto-reply covers only those | `src/service.js` (`REPLIED_LIMIT`) |
| Dedupe index for inbound events | 90 days | `src/events.js` (`DEDUPE_DAYS`) |
| Poller dedupe keys (`poll.seen`) | 30 days | `src/poller.js` (`SEEN_RETENTION_MS`) |
| Messages stamped in the future | held up to 24 hours before they are skipped; the thread is retried | `src/poller.js` (`FUTURE_HOLD_MS`) |
| Failing thread back-off | up to 32 ticks | `src/poller.js` (`MAX_THREAD_BACKOFF_TICKS`) |
| Webhook events stamped more than 5 minutes ahead | not stored; the delivery is answered 503 so the sender retries | `src/webhooks.js` |
| Graph response body | 5 MB | `src/graph/client.js` (`MAX_BODY_BYTES`) |
| Graph request timeout | 15 seconds for each request | `src/graph/client.js` (`TIMEOUT_MS`) |
| Graph GET retries | up to three, after 1, 2 and 4 seconds, on 429, 500, 502, 503 and 504; writes and the token refresh are not retried | `src/graph/client.js` (`BACKOFF_MS`) |
| Retry-After wait | 60 seconds; a longer Retry-After is not waited for | `src/graph/client.js` (`MAX_RETRY_AFTER_SECONDS`) |
| Publish container wait | each container is polled every 5 seconds, up to 60 times (5 minutes); then the publish fails | `src/graph/endpoints/media.js` (`POLL_MS`, `MAX_POLLS`) |
| Publish file size | images 8 MiB; videos (reels and video stories) 100 MiB | `src/graph/endpoints/media.js` |
| URL check on publish | 15-second timeout for the HEAD request, and for the one-byte GET fallback | `src/graph/endpoints/media.js` (`HEAD_TIMEOUT_MS`) |
| Forwarded MCP call | 10 minutes (600000 ms) | `src/mcp.js` (`DEFAULT_TIMEOUT_MS`) |
| MCP frame buffer | 10 MiB; a larger unterminated frame ends the MCP process with exit 1 (see "The MCP server") | the SDK's stdio transport |
| HTTP API request body | 1 MB; a larger body is refused with 413 | `src/http.js` |
| Token-exchange response | 64 KB | `src/oauth.js` (`RESPONSE_LIMIT`) |
| Page list response (Facebook login) | 256 KB | `src/oauth.js` (`PAGE_LIST_LIMIT`) |
| Facebook approval form body | 4 KB | `src/oauth.js` (`FACEBOOK_BODY_LIMIT`) |
| Token-exchange request timeout | 15 seconds for each request | `src/oauth.js` (`TIMEOUT_MS`) |
| Login wait | 5 minutes; then the login ends with AUTH_EXPIRED, and the owner starts it again | `src/oauth.js` (`LOGIN_TIMEOUT_MS`) |
| Poller interval | at least 1 second; the default is 60 seconds; spacing between calls at least 600 ms, at most 60 seconds | `src/poller.js` (`BOUNDS`) |
| Poller back-off on RATE_LIMITED | the interval doubles on each such stop, up to 10 minutes (a longer configured interval is kept) | `src/poller.js` (`MAX_BACKOFF_MS`) |
| Token refresh | only for a token at least 1 day old, that has not expired, that holds the refresh scope, and whose issue time is stored; paused under CHECKPOINT and ACTION_BLOCKED (decision O-6) | `src/token.js` (`MIN_REFRESH_AGE_MS`), `src/service.js` (`refreshPause`) |
| Token expiry warning | shown in `ig_token_status` when fewer than 7 days remain, or the token has expired | `src/token.js` (`EXPIRY_WARNING_MS`) |
| Stop detail text | 200 characters | `src/stops.js` (`MAX_DETAIL`) |
| Handled events kept | 30 days by default (`retentionDays`, at least 1); pending events are kept | `src/events.js`, `src/config.js` |
| Audit log rotation | at 50 MB per file, keeping 10 rotations | `src/audit.js` |
| Unofficial sidecar | 20 seconds for each call by default; 16 MB of output (16,777,216 characters); standard-error lines up to 8192 characters, the last 20 kept | `src/unofficial/sidecar.js` (`timeoutMs`, `MAX_BUFFER_CHARS`, `STDERR_LINE_LIMIT`, `STDERR_LINES_KEPT`) |
| `ig status` wait for the running service | 5 seconds | `src/cli.js` (`STATUS_TIMEOUT_MS`) |

### Busy results

When a cap or the usage throttle holds an action, the tool returns `{ busy: true, reason, retryAfterMs }`. This is a normal result, not an error. Nothing is queued, and the service does not retry on its own. The caller decides when to ask again. A busy result records nothing. Over the HTTP API, a busy result is status 429 with the same body. Over MCP it is an ordinary result.

### Confirmation

- Every outbound tool takes `confirm`. Without `confirm: true`, the tool returns a preview (`{ preview: true, action, target }`) and makes no request.
- `ig_stop_clear` and `ig_autoreply_set` also need `confirm: true`. So do the unofficial tools.
- A `confirm` value that is not true, false or absent is refused.
- Turning auto-replies on with `ig_autoreply_set` and `confirm: true` is the owner's consent to each automatic reply. Each reply is then sent without a per-message confirm, inside the caps and the 24-hour window (decision O-12).
- `ig_events_decide` records a decision and an optional draft. It never sends. Sending is `ig_dm_send` with `confirm: true`.

### The stop state

- The stop is saved in the state file, so it survives a restart. Every change is saved at once. Every observed stop is kept in a list, with its kind, time and rank. Only a confirmed `ig_stop_clear` removes the list.
- An outbound action's error can set a stop:
  - `AUTH_EXPIRED`: Graph error 190.
  - `CHECKPOINT`: a checkpoint, challenge or two-factor requirement (see "How a Graph error becomes a stop").
  - `ACTION_BLOCKED`: Graph error 368, or "feedback required".
  - `RATE_LIMITED`: HTTP 429, or Graph error codes 4, 17, 32, 613 and 80002. Every 80002 counts as a rate limit, because its subcode is unknown.
- A read can also set it, for three kinds: `CHECKPOINT`, `ACTION_BLOCKED` and `RATE_LIMITED`. An `AUTH_EXPIRED` from a read is returned as a clean error and does not set the stop. The build plan said that reads never change the stop state. The global constraints name these kinds as stop codes, so the build follows them (decision B1).
- Startup can set a stop too:
  - `STATE_CORRUPT`: the state file was damaged. The service copied it aside (`state.json.corrupt`, or the next free numbered name), rebuilt the outbound counters from the audit file, and started stopped (decision O-3). The service stays up. See "Recovery from a damaged state file".
  - `STATE_LOST`: the state file is missing, or it has no event counter, while the events file or the audit file holds data. The guard starts stopped, and the counters are rebuilt the same way.
- **Ranks.** The state stops (`STATE_LOST`, `STATE_CORRUPT`) and the account stops (`AUTH_EXPIRED`, `CHECKPOINT`, `ACTION_BLOCKED`) share rank 3. `RATE_LIMITED` is rank 2. The active stop is the highest rank. When two stops of the same rank meet, the one that is held is kept. So a rate limit never replaces a state or account stop, and a state stop does not replace an account stop that is held.
- **What a stop halts.**
  - Outbound actions are refused with `STOPPED` (HTTP 409) while any stop holds.
  - Reads still work, and so does `ig status`.
  - The poller halts (stops reading) under `AUTH_EXPIRED`, `CHECKPOINT`, `ACTION_BLOCKED`, `STATE_CORRUPT` and `STATE_LOST`. It stays halted until the owner clears the stop. `RATE_LIMITED` does not halt it. The poller backs off instead, doubling its interval up to 10 minutes.
  - The hourly token refresh is paused under `CHECKPOINT` and `ACTION_BLOCKED` (decision O-6). Under other stops it runs. The expiry of the token is shown in `ig status` with a warning when it is near, so the owner can clear the stop in time.
- **The HTTP status of a stop** is 423 Locked for the four stop kinds, with the kind in the body. `STOPPED` (the refusal while a stop holds) is 409.
- Only `ig_stop_clear` with `confirm: true` resumes outbound actions. It removes every stop in the list.

### How a Graph error becomes a stop

- The structured signals are read first: the error code (190, 368, 4, 17, 32, 613, 80002) and the HTTP status (429).
- It also reads the text: "feedback required", "checkpoint", "challenge" and "two-factor" in the error message and in Graph's user-facing fields (`error_user_title` and `error_user_msg`). The text match is the fallback.
- When a text match and a structured code conflict, the more severe stop wins. So a CHECKPOINT text on an HTTP 429 gives `CHECKPOINT`, and the test pins it. On a tie, the structured signal wins (decision O-1). This fails closed, and it can stop on an unrelated message (see "Known limits: stops and recovery"). The owner confirms this wording (question 5 of the decision map).
- The subcode of an error is recorded and not mapped, because its values are not verified.

### Recovery from a damaged state file

Decided by the owner on 2026-10-22 (P4 review M-11 and decision O-3). The outbound counters (the caps) and the token record are kept in the state file. When that file cannot be parsed, or is missing while the events or audit file holds data (`STATE_LOST`), both are lost. A state file that exists is never rebuilt, so a state that still has its counters keeps them. On a damaged-state start:

- The service starts stopped. It stays up. Outbound actions are refused, the poller is halted, and status and reads work. The owner inspects the cause and clears the stop with `ig_stop_clear` and `confirm: true`.
- **The outbound counters are rebuilt from the audit file.** Each audit line of an outbound action with outcome `ok` or `error` counts once. A line stays in each counter while it is inside that counter's window, measured from now: a day for the daily caps, an hour for the like cap, a week for hashtags, and the 24-hour window for auto-replies. So a like made today still counts against the like cap. An `error` line counts too. A failure before the request was sent released its count when it happened, but the audit line does not record that, so the rebuild counts it. The caps therefore stop sooner rather than later.
- **The lookups** of business discovery and mentioned media are rebuilt into their own daily buckets. Each lookup writes an audit line with its action and outcome and no identifier. A lookup made before that audit line was added wrote none, so it is not counted.
- **Damaged audit lines** (a line cut short by a crash, for example) are skipped and counted. The number is in the recovery record and in the note that `ig status` shows. The counts may be low by up to that number, because a damaged line may have held an action.
- **The one-reply record of each comment** is rebuilt from the `privateReply` audit lines within 7 days of the comment's stored time. When the comment's time is not stored, the record is kept with the line's time, and any second reply to that comment is refused locally. If the audit file cannot be read for this scan, the one-reply records are not rebuilt, and the state gets the flag `oneReplyUnknown` (`{ oneReplyUnknown: true, since, reason }`). **While the flag is set, private replies are refused with `STOPPED`, whether or not the stop has been cleared, and no request is made.** A confirmed `ig_stop_clear` does not clear the flag. Each later start retries the scan, and the flag clears only when a scan reads the file cleanly and writes the records; each retry is audited as `oneReplyRebuild`. The flag is also set when the scan finds a damaged line in any retained audit file (the damaged line may be a private reply), and when a private reply was sent but its audit line could not be written. The flag is saved on its own before the rest of a recovery, so a later failed save cannot drop it. A damaged line keeps the flag until the file holding it rotates out, so a torn last line after a crash blocks private replies until then. `ig status` shows the flag with its time and reason, and the start-up output shows it at every start until it clears.
- **The owner's confirmed way out of the one-reply flag** is `ig routes clear-one-reply-flag`. Without `--confirm` it prints the flag and the number of damaged audit lines, and changes nothing. With `--confirm` it clears the flag and writes one audit line with the action `oneReplyFlagClear` and no text and no target. It refuses while `ig serve` holds its lock, so stop the service first. Clearing the flag lets private replies through again without a check of the one-reply records, so Meta's own one-reply rule is the only check for a comment whose reply the records do not show. Use it only when the cause is known and accepted.
- **The event cursors** are kept in the state file. When that file is unreadable or missing, or a stored acked or issued position is damaged, the cursors are unknown. Until the owner clears the stop, `ig_events_pending` and `ig_events_ack` are refused with `STOPPED`, and the reason names the state loss. Nothing is delivered in that time. A confirmed `ig_stop_clear` starts the cursors at zero. The next `ig_events_pending` carries a notice (`cursors_reset`), and every event in the event file is delivered again with the id it had.
- **Constraint 14 exception.** The event cursor never moves backwards, except in that case. The owner decided this (P4 fix round 2, N-14). An acknowledged event comes back with the same id after a state loss, so a missed inbound message is treated as worse than a duplicate. The consumer must dedupe by event id. The notice carries the same statement. A reset that cannot be saved is refused with `CONFIG`, nothing is delivered, and the next `ig_events_pending` tries again. The global constraints file still has the unqualified rule (see "Owner decisions", question C-1).
- A damaged stored acked or issued position is removed, not reset to zero, so no acked event is redelivered before the owner clears the stop.
- The recovery record is kept in the state file under `recovery`. `ig status` shows it. A confirmed `ig_stop_clear` removes the record.
- **The token record** (its issue and expiry times, and its scopes) is not in the audit file, so it stays empty after a damaged-state start. The access token itself is in the secret store and is not affected. Run `ig auth login` to write the token record again. `ig_token_status` keeps this instruction while the record is absent.
- A stop that the damaged file caused stays until `ig_stop_clear` with `confirm: true`.

### The owner check

- `ig serve` reads the account of the owner token with one request (`GET /me?fields=id`). It refuses to start if the id is not `owner.igUserId`, if the token is missing, or if Graph cannot be reached.
- `ig auth login` refuses to store a token whose account is not the owner's, and stores nothing.
- Comment actions (reply, hide, delete, and like or unlike on a comment) are refused unless the comment is on one of the owner's media. Private replies are checked the same way, through the comment's parent media. The owner's media are read as the first 100, and every owner check uses only those 100. So `ig_media_get`, `ig_insights_media`, `ig_comments_list`, `ig_media_delete` and the comment actions are refused for media outside the first 100 owned media, with a reason.
- The owner's own messages and comments are never treated as new inbound events.
- Official features are refused unless the owner account is a `business` or `creator` account.

### Messaging windows and private replies

- A direct message can be sent only within 24 hours of the last inbound message from that person. Comments and mentions do not open this window. The check is made locally, before any request. The time used is the message's own time, not the time it was received. A timestamp a few seconds ahead of the clock makes the check refuse until the clock catches up. This fails closed (A-19).
- The text of a direct message is at most 1000 UTF-8 bytes. That limit, like the 24-hour window, is checked before any request.
- A private reply is the only route to someone who has not messaged the owner. It is allowed once per comment, within 7 days of the comment's own time. The reply is recorded before it is sent, so a second one is refused. If the comment's time cannot be read, the reply is refused. If the one-reply record is unknown after a damaged state, the reply is refused until the flag clears (see "Recovery from a damaged state file").
- Auto-replies are off by default. When on, they reply to direct messages only. They never reply to the owner's own messages or to empty text. They reply at most once per person per 24 hours, and only inside the 24-hour window.

---

## The tools

The same 36 tools are served over MCP and over the local HTTP interface. The list comes from the registry in `src/tools.js`.

Kinds:

- **status**: reads local state and changes nothing.
- **admin**: changes local settings, the stored owner token, or stored events.
- **read**: reads from Instagram, or from local state where the table says so. Two of these are not read-only; see the notes.
- **events**: the local event queue. Nothing here sends a message.
- **outbound**: changes the account through the official route.
- **unofficial**: changes the account through the unofficial sidecar. It is off by default.

| Tool | Kind | Destructive | Read-only | Takes `confirm` |
|---|---|---|---|---|
| `ig_status` | status | no | yes | no |
| `ig_caps_status` | status | no | yes | no |
| `ig_stop_status` | status | no | yes | no |
| `ig_token_status` | status | no | yes | no |
| `ig_stop_clear` | admin | yes | no | yes |
| `ig_token_refresh` | admin | no | no | no |
| `ig_autoreply_set` | admin | no | no | yes |
| `ig_events_purge` | admin | yes | no | no |
| `ig_profile_get` | read | no | yes | no |
| `ig_media_list` | read | no | yes | no |
| `ig_media_get` | read | no | yes | no |
| `ig_insights_account` | read | no | yes | no |
| `ig_insights_media` | read | no | yes | no |
| `ig_mentioned_media` | read | no | yes | no |
| `ig_comments_list` | read | no | yes | no |
| `ig_dm_conversations` | read | no | yes | no |
| `ig_dm_messages` | read | no | yes | no |
| `ig_dm_unread` | read (local) | no | yes | no |
| `ig_dm_mark_read` | read (local) | no | **no**: writes a local read marker | no |
| `ig_hashtag_search` | read | no | **no**: each call counts toward the hashtag cap | no |
| `ig_business_discovery` | read | no | yes | no |
| `ig_events_pending` | events | no | no: issues a cursor | no |
| `ig_events_ack` | events | no | no | no |
| `ig_events_decide` | events | no | no | no |
| `ig_publish_media` | outbound | no | no | yes |
| `ig_comment_reply` | outbound | no | no | yes |
| `ig_comment_hide` | outbound | yes | no | yes |
| `ig_comment_delete` | outbound | yes | no | yes |
| `ig_like` | outbound | no | no | yes |
| `ig_unlike` | outbound | no | no | yes |
| `ig_dm_send` | outbound | no | no | yes |
| `ig_private_reply` | outbound | no | no | yes |
| `ig_media_delete` | outbound | yes | no | yes |
| `ig_follow` | unofficial | no | no | yes |
| `ig_unfollow` | unofficial | no | no | yes |
| `ig_profile_edit` | unofficial | no | no | yes |

Notes:

- `ig_dm_mark_read` and `ig_hashtag_search` are not read-only. The spec's Read list named them as reads, and that list has been corrected. Their annotations say `readOnlyHint: false`, like every other tool that writes.
- The events tools are not read-only either, because they move a cursor or record a decision.
- `ig_token_refresh` calls Graph and stores a new owner token. It takes no `confirm`, and it never returns the token.
- Five tools are marked destructive: `ig_stop_clear`, `ig_events_purge`, `ig_comment_hide`, `ig_comment_delete` and `ig_media_delete`. `ig_comment_hide` is marked destructive in the registry even though it can be reversed by unhiding.
- `ig_events_purge` removes handled events older than the retention period. Pending events are kept.
- `ig_publish_media` takes one source: `url` (a public HTTPS address) or `file` (a path under the media folder). A carousel takes `urls` or `files`. See "Publishing".
- Facebook Login is needed by `ig_media_delete`, `ig_hashtag_search` and `ig_business_discovery`. Until a Facebook token is stored, these are refused with `ROUTE_DISABLED`.
- Text from other accounts (comments, messages, mention captions, business discovery results) is marked `untrusted` in every result that carries it.

---

## The poller and inbound messages

- Every 60 seconds (`poll.intervalMs`), the poller lists the owner's conversations, the first page of up to 100, newest first. It takes up to `poll.maxThreadsPerTick` (20 by default) changed threads, and reads the messages of each through the paging helper: the messages edge with the `after` cursor, up to 10 pages and 1000 items. It waits `poll.spacingMs` (600 ms by default) between its calls.
- It never writes to Graph.
- A message it cannot use is skipped and audited, and never stored. That covers a missing or unreadable time, an impossible calendar date, an unknown kind, and a message stamped more than five minutes ahead. A message stamped ahead is held for up to 24 hours and retried, so it holds a selection slot during that time. A time that is neither text nor a number makes the read fail on every tick, and the poller audits it (see "Timestamps and identifiers").
- A thread that fails waits 1, 2, 4, 8 and 16 ticks, then at most 32 ticks between retries (A-24). So a failing thread holds one of the poller's selection slots only on its retry ticks.
- It dedupes by message id, through the dedupe index (90 days). Events survive a loss of the state file, because the events file keeps the high-water mark. Comments, mentions and unknown items use a kind-qualified dedupe key, so a mention is not skipped because a comment with the same id was stored.
- Events wait in the event log until they are acknowledged with `ig_events_ack` and decided with `ig_events_decide`. Unread state is kept locally, and `ig_dm_mark_read` clears it for one sender.
- The poller's inbound hook is the service's notify step. With auto-replies off (the default), it sends nothing.

### The webhook receiver: built, not served

- The receiver answers Meta's verify handshake, checks the `X-Hub-Signature-256` signature with the app secret, dedupes, and stores message, comment and mention events. It skips the owner's own events.
- It is off until `webhook.enabled` is the boolean `true`. The text "true" does not turn it on, and a value of another type is refused at load. While it is off, its path (`/webhooks/instagram`) answers 404.
- It refuses to start without the app secret, the verify token and an audit log.
- An event stamped more than five minutes ahead of the host's clock is not stored, and the delivery answers `503 Retry later`, so the sender retries it. The other events of that delivery are stored at once, and a retry skips them. The event is stored by the retry once the clock is within five minutes of its stamp. The count of such events is in the audit line for the delivery.
- Events are stored while a stop holds, because the event log is a file of its own. While any stop holds, nothing is notified and no auto-reply is sent.
- Meta needs a public HTTPS address to deliver to. The owner sets up a reverse proxy that the owner runs, which forwards to the local port. The build does not set that up.
- **The proxy must rewrite the Host header to an allowed value.** The Host check applies to the webhook path too. Allowed values are `127.0.0.1` and `localhost` by default, or any name the owner adds to `http.allowedHosts`, with a port.

---

## Device identity

- The unofficial route (the instagrapi sidecar) sends the library's default device and app identity, exactly as shipped.
- The project adds no device, fingerprint or proxy handling of its own. It does not rotate identities or proxies, and it does not change any device setting.
- The sidecar child is given only these environment variables: `PATH`, `SYSTEMROOT`, `USERPROFILE`, `TEMP`, `TMP`, and the Python settings `PYTHONHOME`, `PYTHONPATH`, `PYTHONUSERBASE`, `PYTHONUTF8` and `PYTHONIOENCODING`. No other variable reaches it, and no `IG_` variable does. On Windows the runtime adds `HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `SYSTEMDRIVE`, `USERDOMAIN`, `USERNAME` and `WINDIR` to any child. Tokens and passwords reach the child over standard input only.
- The sidecar's challenge handlers refuse. A challenge therefore fails as `CHECKPOINT` and stops outbound actions. The build plan said to leave the handlers unset. The library's default handler reads from standard input, which would corrupt the JSON-line protocol, so both handlers are set to refuse instead (decision B6).
- The sidecar is off by default: `routes.unofficial.enabled` is false, and it needs `ig routes ack-unofficial --confirm` before it can be enabled.

---

## The app secret and the login

- Meta's Business Login page says the token exchange must run in server-side code, because it includes the app secret. This project keeps the app secret on the owner's machine, and it runs the exchange locally. The owner accepted this deviation (spec decision 10).
- The short-lived exchange sends the code, the client secret and the grant type in the body of a POST, never in a URL.
- The long-lived exchange (decision O-7) is a POST to `https://graph.instagram.com/access_token`. The short-lived token goes in the `Authorization: Bearer` header. The client secret and the grant type go in the form body. No token is in any URL. Meta documents this exchange as a GET with the token in the query string, so Meta may refuse the POST. That is a live check, and a refusal is loud: `ig auth login` stops with the error and stores nothing.
- The login's callback listens on 127.0.0.1 on port 8790, at `/callback`. The state value is checked, in constant time, before the code is accepted. A callback whose state is wrong gets 400, and the login keeps waiting for the owner's own redirect. The login waits 5 minutes at most.
- **The serve lock during a login.** A running `ig serve` holds the serve lock in the data directory. `ig auth login` and `ig auth facebook` refuse while a live lock is there. Each login holds the lock while it runs, so `ig serve` refuses to start during a login, and the login never writes the state file next to a running service.
- **Facebook Login (decision O-8).** `ig auth facebook` opens Meta's dialog with `response_type=token`, and the approval comes back to a loopback page. The browser runs a small script that reads the token from the redirect fragment (a browser never sends a fragment to a server), clears the fragment, and posts the token and the state to the loopback server on the same origin. The token is never sent in a request URL, logged or stored. The approval comes back in the URL fragment, which the bridge page clears on load (`history.replaceState`, `src/oauth.js:82`). The page only accepts an exact Origin match, or a same-origin Sec-Fetch-Site when no Origin is sent. The Page must be linked to the owner's Instagram account. The bridge and the Page link are live checks (see "Live-phase checks").
- The hourly check refreshes the owner token only when the stored record has an issue time (`obtainedAt`), and the token is at least 24 hours old, not expired, and holds `instagram_business_basic`. Without an issue time the token is not refreshed. The refresh is paused under `CHECKPOINT` and `ACTION_BLOCKED`.

---

## The MCP server

- The MCP SDK is `@modelcontextprotocol/server` version 2.3.1 (the v2 line), pinned exactly. The v1 line (1.32.1) has no support for the 2026-07-28 protocol revision.
- The build plan's Step 3 expected `initialize` to answer with 2026-07-28. In v2, `initialize` negotiates 2025-11-25. The 2026-07-28 revision is served through `server/discover`. This is a reading of Step 3, and the owner should accept it (decision B3).
- The bin-based check passes both handshakes. It runs `node bin/ig.js mcp`, and it confirms that stdout holds only protocol frames and that `tools/list` returns 36 tools.
- `ig mcp` forwards each call to `ig serve` on 127.0.0.1, on the configured `http.port` (8788 by default), with the `api_token` as the bearer token.
- Each forwarded call has a ten-minute timeout. A timed-out write reports an unknown outcome, and it may still have run. The owner should check with `ig_media_list` or `ig_status` before retrying. A long carousel can run past the ten-minute limit (see "Writes and retries").
- **Transport behaviour.** Standard output carries only the protocol frames. Standard error carries one line when the transport fails, with the error name. A transport error ends the process with exit code 1, after the frames already written are flushed. A clean close ends it with 0 (A-32).
- **The oversize-frame exception.** The SDK buffers at most 10 MiB of a frame that has no newline. A larger one ends the MCP process with exit 1, and the error is shown on standard error. This is a documented exception to the rule that only I/O failures end the process: the SDK closes the transport, so the exit is loud and non-zero.
- **A non-JSON line** from the client is dropped by the SDK, is not logged, and does not end the process. This is a documented limit: a malformed client line leaves no trace.

---

## The HTTP API

- `ig serve` serves the HTTP API on the configured host and port (`127.0.0.1:8788` by default). The routes are `GET /health`, `POST /tools/:name` (one route for each tool in the table above), and the webhook path when the webhook is enabled.
- The `Host` header must be a name with a port, `127.0.0.1` or `localhost` by default, or an entry in `http.allowedHosts`. This rule applies to every route, the webhook path included. Any other Host, or one with no port, gets 403.
- `POST /tools/:name` needs `Authorization: Bearer <api_token>`. Without a valid token the answer is 401. A loopback host with no `api_token` answers 401 to every tool call until one is set.
- **Plain HTTP.** The HTTP API speaks plain HTTP, not HTTPS. On a loopback host (`127.0.0.1`, `::1` or `localhost`) the bearer token stays on the machine. A host that is not loopback, including the wildcard `0.0.0.0`, needs two things in the config: `http.allowRemote` set to `true`, and an `api_token`. Without `http.allowRemote`, `ig serve` refuses to bind the host. With `http.allowRemote` but no `api_token`, it refuses too. With both, `ig serve` starts over plain HTTP and prints `HTTP API listening on <address>:<port>`. It then prints one warning line on standard error: `warning: the HTTP API is plain HTTP on <host>:<port>. The bearer token (api_token) and the API traffic travel unencrypted on that network. Keep the host on loopback, or put the API behind TLS.` The line carries no token. A loopback start prints no such line.
- **A remote serve needs the remote name in `http.allowedHosts`.** The `Host` header of a request must name a listed host, with its port. Loopback names are listed by default and a remote name is not, so a request to the remote address gets 403 until that name is added (for example `192.168.1.10`). `ig status` reports the refusal as `ig serve answered with an error (FORBIDDEN)`.
- **`ig status`** sends the token only to a loopback address. For a non-loopback `http.host` it refuses unless `http.allowRemote` is `true`. The refusal is printed on standard error, nothing is sent, and the command exits with code 1. A wildcard `http.host` such as `0.0.0.0` is reached on loopback by `ig status`, so it needs no `http.allowRemote` there. When `http.allowRemote` is `true` and the host is not loopback, `ig status` prints this line before it sends the request over plain HTTP: `warning: http.allowRemote is true, so ig status sends to <host> over plain HTTP, and the traffic is not encrypted.`
- The request body is limited to 1 MB. A larger body is refused with 413.
- The status codes:

| Status | When |
|---|---|
| 200 | A tool result, `{ result }`. |
| 400 | A validation error, or a body that is not valid JSON. |
| 401 | No valid bearer token. |
| 403 | A Host that is not allowed, `OWNER_MISMATCH`, or `ROUTE_DISABLED`. |
| 404 | An unknown route or tool. |
| 405 | A method the route does not serve: a non-POST on `/tools/:name`, a method other than GET or POST on the webhook path, or a non-GET on `/health`. The `Allow` header names the methods that are served. |
| 409 | `STOPPED`: the refusal while a stop holds. |
| 413 | The request body is over 1 MB. |
| 423 Locked | A stop kind: `AUTH_EXPIRED`, `CHECKPOINT`, `ACTION_BLOCKED` or `RATE_LIMITED`. The kind is in the body. Decision O-10. |
| 429 | A busy result, or `CAP_EXCEEDED`. The busy result has the busy body. |
| 500 | Any other error kind, or an unexpected error. The kind is in the body. |
| 503 | A webhook delivery with an event stamped too far ahead of the clock (the sender retries). |

---

## The unofficial route: the instagrapi sidecar

- The sidecar runs instagrapi, pinned to version 3.1.0 in `sidecar/requirements.txt` (`instagrapi==3.1.0`).
- License: MIT. This comes from the package metadata on PyPI (`license_expression` is MIT). The LICENSE file inside the wheel was not read in this task.
- Release: version 3.1.0 was uploaded to PyPI on 2026-10-20, a day before the build. Version 3.0.26 also has the login fix, so the owner can choose that version instead (decision O-9 keeps 3.1.0).
- Python 3.10 or newer. Install from wheels only.
- The sidecar's stop mapping includes `ProxyAddressIsBlocked`, which is an `ACTION_BLOCKED` stop (F-11). The class name and the stop class are live checks.
- Each call has a 20-second timeout by default, and the sidecar's output is limited to 16 MB.
- The sidecar is off by default. Its first use on a live account needs a live check (decision O-9).

### Logging in to the unofficial route

- The command is `ig routes login-unofficial`. It refuses with `ROUTE_DISABLED` unless the route is acknowledged (`ig routes ack-unofficial --confirm`), and it refuses with `CONFIG` while `ig serve` is running. It holds the serve lock while it runs, so `ig serve` cannot start during a login. Nothing is sent when it refuses.
- **Prompts.** On a terminal: `Instagram username: ` (shown), then `Instagram password (input hidden): ` (hidden). A two-factor code is asked for only when Instagram asks for one, as `Two-factor code (input hidden): `. Without a terminal, such as a pipe, the lines of standard input are read in the same order: the username, the password, then the code when it is asked for.
- **Checks before anything is sent.** The username must not be empty. The password must not be empty, and it must be at least 8 characters, because a shorter one cannot be registered for masking; a password that is too short is refused with `VALIDATION`, and nothing is sent. The password is registered for masking before it is used, and it is sent only to the sidecar.
- **Two-factor code.** When the sidecar reports that a two-factor code is needed, the command asks once for the code and tries again. If no code is given, nothing is stored.
- **What is stored.** On success the session that the sidecar returns goes to the keyring as `unofficial_session`, and the username goes to the keyring as `unofficial_username` (as JSON `{ "username": ... }`). The output line is `stored unofficial_session and unofficial_username in the keyring; ig serve restores the session when it starts`. The route's stop is cleared, and an audit line `unofficialLogin` with outcome `ok` is written. A failed login stores nothing. If a write fails, the entries written so far are restored or removed, so the previous state is left in place.
- **Where it is stored.** The session and the username are kept in the operating system's credential store (the keyring), under the service name `instagram-automation`, with the account names `unofficial_session` and `unofficial_username`. The session is registered for masking when it is received. The username is stored as JSON (`{ "username": ... }`), and only that stored JSON form is registered for masking; the bare username is not registered, and it is not one of the five secrets. Nothing is written to a file, and nothing is printed.
- **Restore at serve start.** When the route is acknowledged and a session is stored, `ig serve` restores the session before it builds the service. A restore that succeeds clears a stop left by an earlier failure. If no session is stored, nothing is restored, and a call with no session loaded fails with `UNOFFICIAL_ADAPTER_ERROR` (the sidecar's `no_session`) and sets no stop.
- **A failed restore stops only the unofficial route.** A restore that fails (the stored session cannot be read from the keyring or parsed, or the sidecar rejects it) sets the stop `AUTH_EXPIRED` on `routes.unofficial.stop`. Follow, unfollow and profile edit then refuse with `STOPPED`, and the reason says to run `ig routes login-unofficial` again. The official routes and the account stops are not affected, and `ig_stop_clear` does not clear this stop. It is cleared by a successful `ig routes login-unofficial`, or by a later restore that succeeds. `ig serve` prints `the stored unofficial session could not be restored, so the unofficial routes are stopped; run ig routes login-unofficial again`.
- **An expired session during a call is an account stop.** When a follow, unfollow or profile edit gets `AUTH_EXPIRED` from the sidecar, the account stop is set, as for any `AUTH_EXPIRED`. That stops all outbound actions, the official routes included, until `ig_stop_clear` with `confirm: true`. Only a failed restore at serve start is limited to the unofficial route.
- **Unavailable, not an expired login.** Three cases give `UNOFFICIAL_ADAPTER_ERROR` and set no stop: a missing instagrapi (the sidecar reports the kind `unavailable`); a failure to start the executable (for example, the Python executable is not found); and a child that exits, or does not answer within the timeout, before it has answered anything. For these, the stored session is kept, `ig serve` prints the reason, and the unofficial routes run once the sidecar can start. A failed restore of a session that did start gives `AUTH_EXPIRED`, and that stops the unofficial route only. A failure during a login gives `UNOFFICIAL_ADAPTER_ERROR`, and nothing is stored. After the fix, the next `ig serve` start clears a stop set by a failed restore when its restore succeeds, and `ig routes login-unofficial` clears it on success.
- **The sidecar command.** The sidecar is started with `IG_PYTHON` when it is set, and otherwise with `routes.unofficial.python` from the config, which defaults to `python`. The script is `sidecar/ig_sidecar.py` under the project root, so the working directory does not matter. A missing executable gives `UNOFFICIAL_ADAPTER_ERROR`, which names the executable as configured.
- **Feature mapping.** `follow`, `unfollow` and `profileEdit` go to the sidecar by default (`routes.unofficial.adapterByFeature`). They still need the route enabled and acknowledged. A mapping in the config overrides the default. A feature with no mapping, or one mapped to an adapter that is not registered, gives `NOT_SUPPORTED`. The `jslib` adapter is registered, and it refuses every call with `NOT_SUPPORTED`.
- **Live phase.** The sidecar login, the restore and the follow have not run against Instagram. The same live check as the sidecar (decision O-9) applies.
- **Sidecar error text.** A line the sidecar writes to standard error is kept as a whole line, up to 8192 characters, and the last 20 lines are kept. A longer line is not shown. The last line is redacted as a whole before it is cut to 200 characters for display, so a registered value that straddles the cut is still masked.

---

## The Meta app and Facebook Login

- The Meta app stays in Development mode, for the owner's account. App Review is requested only if the live phase shows that it is needed.
- Instagram Login: the authorize URL is `https://www.instagram.com/oauth/authorize`. The reference page shows `api.instagram.com` as well, so the host is a live check. The scopes are `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments` and `instagram_business_content_publish`. The research found `instagram_business_content_publishing` in the App Review list, so the scope name is a live check too.
- Facebook Login for Business: the bridge described in "The app secret and the login" (decision O-8). The app must allow `response_type=token`, and the redirect URI must be registered. Meta may require https for that redirect, which the loopback page does not use. Both are live checks, and the bridge page must be run in a real browser.
- The features that need a Facebook token (hashtag search, business discovery and media delete) are refused until `ig auth facebook` has stored one.

---

## Publishing

Publishing reads media only from the owner's own host. The service does not upload files to Instagram, and no upload route is implemented (decision O-13).

- **Inputs.** `ig_publish_media` takes `kind` (`image`, `reel`, `carousel` or `story`) and exactly one source: `url` (a public HTTPS address of the image or video) or `file` (a path under `media.dir`). A carousel takes exactly one of `urls` or `files`, with 2 to 10 items. Each item has exactly one of `imageUrl` or `videoUrl` (for `urls`), or `imageFile` or `videoFile` (for `files`). An optional `caption` is sent with the publish.
- **File paths.** A file path is relative to `media.dir`, such as `photos/cover.jpg`. A path with a drive letter, a `..` segment, a leading slash or a NUL character is refused. The path must end in an extension of its kind: `.jpg`, `.jpeg` or `.png` for an image, and `.mp4` or `.mov` for a reel or a video item.
- **Size limits.** An image is at most 8 MiB, and a video is at most 100 MiB. The file must be a regular file, and it must not be empty.
- **Symlinks and identity.** The real path of the file must lie inside the real path of `media.dir`, so a symlink that points outside is refused. The file is opened once, after the path checks. Its device, inode, link count and size must match what the path check saw, so a file swapped or changed between the check and the open is refused. The file is read in chunks to compute its SHA-256, which goes into the publish audit line. The bytes are not kept and not sent anywhere else.
- **URLs.** A file is published at the URL built from `media.publicBaseUrl` and the canonical path of the file. A direct `url` is checked only when its host is in `media.allowedHosts` (by default, the host of `publicBaseUrl`). Otherwise it is refused.
- **The URL check.** Before publishing, the service sends a HEAD request to the URL, without redirects and without any token. The answer must have a Content-Type of `image/*` for an image or `video/*` for a video, and a Content-Length that equals the file size when the size is known. A host that refuses HEAD with 403, 405 or 501 gets a one-byte GET with `Range: bytes=0-0` instead. Any other failure refuses the publish. Both checks are live checks.
- **Story images** are behind the `story.images` config key, which is off by default. The spec makes image stories conditional on the spike, which has not run.
- **Refused publishes** are audited without the file path, the caption or the URL. A successful publish's audit line carries the SHA-256 of the checked file, so a change after the check is visible.
- **Container wait.** Each media container is polled every 5 seconds, up to 60 times, before the publish continues. A carousel makes one container per item, then the parent.
- **A failure partway through a publish** (a request that failed before it reached Instagram, after an earlier one had reached it) stops the publish. The containers already made are not published, and the service does not retry the publish. The owner can run it again, and that run counts again. Graph is expected to expire the containers that were not published (a live check).
- **The media folder** is the owner's, and the owner's host serves it. The public base URL must be https, with no query string and no fragment.

---

## Audit log, retention and secrets

- `audit.jsonl` is kept. It is rotated at 50 MB per file, and up to 10 rotations are kept. The service never deletes the audit log by itself.
- Each audit line records the time, the action, the route, the target identifier, the outcome, and a detail made of kinds, codes and identifiers. It never holds raw Graph response text or message text. Stop lines carry the kind and the codes.
- A refused publish is audited without the path, the caption or the URL. A successful publish carries the SHA-256 of the file.
- Message text is kept in `events.jsonl` for 30 days (`retentionDays`). `ig_events_purge` removes it, and only for handled events older than that. Pending events are kept until they are acknowledged and decided. Conversation keys and timestamps are always kept.
- Tokens are never written to files or to logs. A registered secret is masked wherever it would reach output (see "Redaction").
- Each poll that skips a message, and each failing thread, writes an audit line. A thread that fails on every tick adds one line per tick, and the poller's per-thread keys are pruned after 30 days.
- The audit read at a recovery start reads every retained audit file, so it takes longer when the files are large. It has not been measured on a real file.

---

## Redaction

Masking has two layers.

1. **The exact-value registry (the control).** Every secret and token is registered on receipt, before any use. The loaded secrets, the token exchange and refresh responses, and the session settings from the unofficial route are all registered. A registered value is masked wherever it would reach output, in its raw form, in its URL-encoded form, and in its single JSON-escaped form. Inbound message text and decision drafts are masked by exact registered value only. A registered value must be at least 8 characters, and a session string under 8 characters cannot be registered, so it is not masked. A test checks that a registered token never appears in an audit line or an error message.
2. **The pattern layer (best effort).** It masks key and value pairs (`key=value`, `key: value`, `key%3Dvalue`, quoted values and JSON members), the `Authorization` header, and tokens of a known shape. The shapes are the Instagram tokens with the prefixes `IGAA` and `IGQV`, and the Facebook token with the prefix `EAA`. A candidate is a token only when at least 20 token characters follow the prefix, with a digit, a lower-case letter and an upper-case letter in the run. It must stand alone: a prefix glued to a letter or a digit is not a candidate. A Bearer credential is masked only when it is a token-shaped run of at least 20 characters with a digit, a lower-case letter and an upper-case letter. So the word "bearer" in ordinary prose is not masked.

The pattern layer is best effort, and the escaped forms are only partly covered:

- The pattern layer matches the escaped forms the review tested: JSON-escaped members, escaped quotes inside quoted values, and URL-encoded separators. The review found escaped forms that still leak when they are nested in a quoted secret. These are the examples it recorded: an unclosed JSON member string, such as `"access_token": "<value>` with no closing quote; `token:"token":"<value>` with the closing quote missing; `apikey=token = <value>` and `apikey=token: <value>`; escaped quotes around a secret nested inside a quoted secret; and `password=Basic <value>` and `token: basic <value>`. A registered value is still masked in these forms, so the leak needs an unregistered secret.

**Known limits of the redaction layer:**

- A token glued to a letter or a digit is not masked by the shape rule (for example `tokenIGAAQV...`). The registry still masks a registered value. The shape rule keeps this limit so that ordinary words such as `EAAGLE` are not masked (review M-R1-3, accepted).
- A bare `Bearer` before a short value, outside an `Authorization` header, is not masked (accepted, P5a concern 2).
- A double-encoded JSON form is not registered (review N-3).
- A bare token with no key name is not caught unless it is registered.
- A value with a literal space after `key=` is masked only up to the space.
- An unclosed quote masks to the end of the text. This is the fail-closed trade-off.
- Two keys that mask to the same text overwrite each other in the redacted copy. No value leaks, but one log entry is lost.
- A registered prefix of a longer secret leaves the rest of that value in clear. The registry matches the full value, so this happens only when a shorter value is registered.
- Map and Set contents are dropped from logs (A-3).
- On most shapes, redaction takes 2 to 4.6 times as long as the previous version. No stall was seen (A-1).

---

## Known limits

Each line is a limit that remains, with its reason. The items the owner has accepted are the ones in the final review (A-items). The complete mapping of every A-item, and of every owner decision, is in `final-decisions-report.md`.

### Stops and recovery

- **Stop by text (decision O-1).** A non-stop error whose text contains "challenge", "checkpoint", "two-factor" or "feedback required" is classified as a stop, and outbound actions stop until `ig_stop_clear`. The reason: the live shape of Graph's text is not known, and a missed stop is worse. The structured code wins a tie, but a text phrase of a higher rank still decides.
- **The stop text fields** `error_user_title` and `error_user_msg` are unverified. The live phase confirms the names.
- **A stop that cannot be read back** (a damaged saved stop record) makes the guard start stopped with `STATE_CORRUPT` (decision O-3). It does not refuse to start.
- **A stop held only in the state file** is lost if the file is deleted, unless an audit or events file holds data, which triggers `STATE_LOST`.
- **A stop does not hold the hourly token refresh** under the stops other than `CHECKPOINT` and `ACTION_BLOCKED`. The refresh is an authentication call. The paused case is decision O-6.
- **A stop saved before a login still holds after the login.** The login output says so.
- **Hashtag search** writes an audit line for each counted search, but a busy search writes none. It does not use the usage hold.
- **The owner DM cap and the publishing quota** are read before the cap check when no usage reading is known yet, so a call that comes back busy can still make those reads. With a known high reading, the call is refused before any read.
- **An audit line that cannot be written after a successful action** prints a warning with the error name only. The action still counts as done, so a retry does not send it again.
- **The serve lock is a file lock by process id.** A stale lock from a process that has gone is ignored. A lock held by a live process of another user is not checked more deeply.
- **Event cursors and one-reply records** are rebuilt or held as described in "Recovery from a damaged state file". The cursor reset is the owner-decided exception to constraint 14.
- **A rate limit that also says "checkpoint"** stops as `CHECKPOINT` (decision O-1).

### Reads and paging

- **Owned media are the first 100.** Every owner check uses those 100. A comment on older media, or an older media item, is refused with a reason. The paging helper reads more pages for lists, but the owner check does not.
- **Conversations** are the first 100 changed conversations for the poller and for `ig_dm_conversations`, with paging beyond that where the endpoint allows.
- **Messages** are read through the messages edge with the `after` cursor, up to 10 pages and 1000 items. A read that reaches a limit says so with `truncated: true`, and `nextAfter` gives the cursor for a continuation on `ig_dm_messages`.
- **Truncation follows the page length and `paging.next`**, so a short page with a next link is flagged (A-15 is closed by paging).
- **Business discovery** returns the raw object. Missing fields are reported, not thrown (A-17).
- **Insights** periods are `day` and `lifetime` only. `week` and `days_28` are refused until they are checked. Metrics come from an allowlist that includes no `facebook_views` (A-12).
- **A private reply's age** is read from the comment's own timestamp field. An unreadable time refuses the reply.
- **`ig_dm_messages`** finds the conversation through a lookup on the recipient's id. If there is no match, the list is empty.

### Timestamps and identifiers

- **Times in four accepted forms.** A `created_time` or `updated_time` may be text with a zone, or a number (Unix seconds or milliseconds), and the forms of one instant are read the same (A-25). The live format is unverified, and Meta's docs show Unix times for some fields. A time that is neither text nor a number fails the whole read, on every tick, and the poller audits it.
- **A message without `created_time`** is skipped and audited. Its thread is not marked as changed.
- **An impossible calendar date** (for example 2026-02-30) is refused, not rolled forward.
- **Identifiers** must be letters, digits, `_`, `.` or `-`. An id with `=` or `+` makes the read fail. A dot-only id is refused locally (A-18).
- **A timestamp a few seconds ahead of the clock** makes the 24-hour check refuse until the clock catches up. This fails closed (A-19).
- **Webhook times are read as milliseconds.** If Meta sends seconds, comments would land in 1970, and private replies would be refused.
- **A malformed message or conversation row** is skipped and counted, and the read goes on (A-21).

### Writes and retries

- **A write that returns an error is not retried.** The one exception is a private reply or an auto-reply that failed before it reached Instagram, which may be tried once more (decision O-5). Otherwise the outcome is unknown, and the service says so. A publish or comment that times out is treated the same way.
- **A publish that fails partway** can leave unpublished containers. Graph expires them; the live check confirms the expiry (see "Publishing").
- **Every write needs `{success: true}`, DELETE included.** A write whose successful reply does not have that form, including an empty DELETE body, returns `API_ERROR`, even if Graph acted, so a write that Graph did not confirm is never reported as done (A-14). This needs a live check.
- **Each forwarded MCP call has a ten-minute timeout.** A long carousel with video items can run past it. Each video item is polled every 5 seconds, up to 60 times, before the parent is created. Image carousels also cost one status read per item. The call then reports a timeout, and the publish may still have happened.
- **A like or unlike on media** needs one usage reading in this process, so the first like after each start reads the owner profile first (decision O-11a). If that read fails, the like is refused.
- **`ig_comment_hide`** sends its value as a form field. Meta's docs show a query parameter, so this needs a live check.
- **Post deletion** (`ig_media_delete`) uses DELETE. The method is unverified, and it needs Facebook Login.
- **Private replies count toward the owner DM cap** (decision O-11b).

### Other limits

- **Plain HTTP (S-K1).** The HTTP API carries the bearer token in clear text when the host is not loopback. That is why such a host needs `http.allowRemote` and an `api_token` (see "The HTTP API"). `ig status` prints a warning before it sends, when the host is not loopback. `ig serve` prints one warning line on standard error when it starts on a non-loopback host, and nothing on a loopback start.
- **A loopback host with no `api_token`** starts, but every tool call answers 401 until `api_token` is set.
- **A direct `listen` on the HTTP server is refused.** The server is started only through the protected start function, which listens on the validated host and port. `ig serve` uses that path.
- **Duplicated helpers** were consolidated (A-8). One behaviour change came with it: a time after the year 9999 is refused (fail closed).
- **Whole-file reads** remain in the event log, at start and on each append. The duplicate check is in memory for the dedupe window (A-9).
- **A redelivery older than 90 days** (the dedupe window) is skipped and audited, not stored (A-6).
- **Mentions without a sender** are audited, not stored (open decision C-3 below).
- **The auto-reply rule shape and the stored token record** are the build's own definitions (open decision C-2 below).
- **HTTP-only error kinds** reach MCP results as kinds in the body (A-33).
- **Test-only gaps** (A-11): 21 tests were added (`a11-tests-report.md`). The untrusted marker on pending events is still asserted at one place only.
- **Graph response bodies over 5 MB are refused** (A-10). The live check confirms that no real response is that large.
- **`startStdio`**: a transport error is reported on standard error, and the process exits with 1. A client that stops reading makes the final flush wait up to 5 seconds (A-32).
- **Lookups made before the lookup audit lines were added** are not counted in a rebuild (see "Recovery").

### Accepted in the final review

The final review's ACCEPT items are each in the list above, in "The poller", "Audit log", "Redaction", or in the decision map. The decision map gives the status of each of A-1 to A-36.

---

## Live-phase checks

Nothing in this list has been checked against a live account. Each item is an assumption in the build, or a point where the research sources disagree.

### Login, the Facebook bridge and the owner check

| Item | What the build assumes | How to check |
|---|---|---|
| Long-lived POST | `POST https://graph.instagram.com/access_token` with the short-lived token in `Authorization: Bearer` and the client secret and grant type in the form body is accepted by Meta. | Run `ig auth login` on the test account. A refusal is loud, and nothing is stored. |
| Facebook bridge in a browser | The loopback page reads the token from the fragment and posts it to the local server; `response_type=token` is allowed; the redirect URI is accepted (Meta may require https). | Run `ig auth facebook` in a real browser and watch the bridge. |
| Test account | None exists yet. | The owner provides one. |
| Owner's account type | `business`, `creator` or `personal` (personal has no official route). | The owner sets it in the config. |
| Localhost redirect | `http://127.0.0.1:8790/callback` is accepted by Meta. | Run the login and watch the redirect. |
| Authorize host | `www.instagram.com`; the reference page shows `api.instagram.com`. | Compare the two on the test account. |
| Form encoding of the short-lived exchange | Form body with `application/x-www-form-urlencoded`. | Watch the first exchange. |
| Scope separator | Scopes are joined with commas, and the scope list is taken from the exchange response when it returns one. | The login must be accepted. |
| Scope name | `instagram_business_content_publish`, against `instagram_business_content_publishing` in the App Review list. | Compare on the App Review page. |
| Owner-check endpoint | `GET /v26.0/me?fields=id` returns the account id. | Run `ig serve` on the test account. |
| Facebook Page call | A Bearer header, `me/accounts` with `instagram_business_account`. | Link a test Page and run `ig auth facebook`. |

### Publishing

| Item | What the build assumes | How to check |
|---|---|---|
| Public host for media | The owner's host serves `media.dir` at `media.publicBaseUrl`. | Publish one image and one video from the host. |
| HEAD and Range fallback | A host that refuses HEAD with 403, 405 or 501 accepts a one-byte GET with `Range: bytes=0-0`. | Test a host that refuses HEAD. |
| Story image request | Image stories use the image request (behind `story.images`). | Run the spike before turning `story.images` on. |
| 5 MB Graph response cap | No real Graph response is larger than 5 MB. | Watch the sizes on the test account. |
| Pre-send error codes | Meta's codes for a request refused before the send. | Check the error codes on the test account. |
| Container expiry | Graph expires containers that were not published. | Create and abandon a container on the test account. |
| Publish input | Public HTTPS URLs are accepted by Instagram Login; the upload route is not used. | Publish from the owner's host. If Meta requires an upload route, that is a new decision. |

### Messages, webhooks and reads

| Item | What the build assumes | How to check |
|---|---|---|
| Messages edge form | `GET /{conversation}/messages` with `fields`, `limit` and `after` returns the message fields in the page. | Read a test conversation through the messages edge. |
| Webhook signature scheme | `X-Hub-Signature-256` with the app secret. | Send a signed test payload. |
| Webhook setup location | The owner's reverse proxy. | Confirm where Meta requires the webhook to be set up. |
| Webhook time unit | Milliseconds. | Compare a webhook `time` with the clock. |
| Timestamp formats | ISO text with a zone, for `created_time`, `updated_time` and the webhook `time`. | Read a test conversation. |
| Identifier characters | Letters, digits, `_`, `.`, `-`. | Read real message ids. |
| Mention entry shape | `comment_id` before `media_id`; `fields` accepted on `mentioned_media`. | Mention the test account. |
| Like and unlike response bodies | A 2xx body with `success: true`. | Like and unlike a test post. |
| Comment hide form | Form field. | Hide and unhide a test comment. |
| Hashtag no-match shape | An empty result, not an API_ERROR. | Search a hashtag with no posts. |
| Business discovery fields | Facebook Login only. | Look up a test business. |
| Insights periods and metrics | `day` and `lifetime`; the allowlisted metrics. | Read each metric on a test account. |
| Paging limits | 100 per page; 10 pages; 1000 items. | Read a busy account. |
| Media delete method | DELETE. | Delete a test post with Facebook Login. |

### Stops, errors and the unofficial route

| Item | What the build assumes | How to check |
|---|---|---|
| Stop text fields | Graph's `error_user_title` and `error_user_msg` carry the phrases. | Compare with Graph's error shape. |
| Error subcodes | Every 190 is `AUTH_EXPIRED`; the sources do not map the subcodes (for example a password change, 460). | Check Meta's error-handling page on the test account. |
| Error 368 | `ACTION_BLOCKED`. | Compare with Meta's error reference. Do not try to trigger a block. |
| Sidecar pin | instagrapi 3.1.0, released a day before the build. | Run the first live use under the risk the owner accepts. |
| Sidecar login | `ig routes login-unofficial` with the username and password (and a two-factor code when asked) returns a session the sidecar can restore. | Run the login on the test account, then restart `ig serve` and check the restore. Not run against Instagram. |
| Sidecar restore | `ig serve` restores the stored session at start, and a failed restore stops only the unofficial route. | Restart `ig serve` on the test account. Not run against Instagram. |
| Sidecar follow, unfollow and profile edit | Each call through the sidecar reaches Instagram and returns its result. | Follow, unfollow and edit one test target. Not run against Instagram. |
| Sidecar stop mapping | `ProxyAddressIsBlocked` maps to `ACTION_BLOCKED`. | Check the class name and the stop class on the test account. |
| Sidecar reply shapes | The reply shapes match the fixture. | Run one live call of each method. |
| Session settings | Settings under 8 characters are not masked. | Check whether live settings are that short. |
| Text send rate and rate-limit window | Spacing of 2 seconds; the like limit (50 requests in 5 seconds locks for an hour, fetch summary). | Compare with Meta's current limits. |
| Token refresh header | The token is sent only in the Authorization header. | Run `ig_token_refresh` on the test account. |
| Automation rules | The unofficial route is a risk the owner accepts. | Read the current Terms, which the research could not read. |
| App mode | Development mode works for the owner's account, without App Review. | Test the owner-only row with one call. |

### Research conflicts still open

From the MCP and repo comparison report, Tables 8 and 9 (conflicts raised, and first-round conflicts still open). Each row asks for a browser or test-account check: publishing quota (100 or 50 a day); likes in the edge list; the `link_clicks` restriction; the delete-media method; the delete-comment rule; the replies page scopes; `enable_fb_login`; the insights permission; `caption` and `media_product_type` (Facebook Login only); account insights retention; `profile_views`; media insights periods; the discovery API limit; owner-only App Review; the webhook setup location; API version dates; the Business Login scope name; the timestamp format; message-list completeness; the human-agent tag syntax; the text send rate; the rate-limit window; whether automation is banned.

---

## Test status

- `npm test` on Node v24.6.0: 1217 tests, 1217 pass, 0 fail, 0 cancelled, exit code 0.
- `npm test` on Node v22.13.1 (that binary first on the PATH, so npm and the tests run on it): 1217 tests, 1217 pass, 0 fail, 0 cancelled, exit code 0.
- The suite grew from 730 in the build, through the fix rounds, the decision work packages P1 to P6 and the consolidation pass.
- Test-side fixes made along the way, which do not change the product code: on Node 22, three tests in `test/mcp.test.js` waited on `AbortSignal.timeout`, which does not keep Node alive, so each now holds the event loop with a referenced timer until the test ends. On Node 24, four tests in `test/sidecar.test.js` failed under heavy parallel load, because their 5-second budget covered a child's start. A quiet start takes about 70 ms, and under load a start took up to 16.1 s. The budget is now 30 s.
- A run with 15 CPU-bound node processes alongside passed the suite on Node 24.6.0 (recorded in the build; on the 730-test suite).
- Python: `py_compile` of `sidecar/ig_sidecar.py` exits 0. From the project root, `python -B -c "import sidecar.ig_sidecar as s; print(s.map_exception_kind('ClientThrottledError'))"` prints `rate_limited` and exits 0. The `-B` flag keeps the check from writing `sidecar/__pycache__`. Do not add `-I`: it removes the current directory from the import path, so the import fails with ModuleNotFoundError.
- `node bin/ig.js --help` lists `auth`, `serve`, `mcp`, `status` and `routes`.
- The bin-based MCP check passes both handshakes (see "The MCP server").

---

## Owner decisions

The owner delegated all thirteen open decisions to the controller on 2026-10-22. Each decision below is the one made, with its cost. Each is reversible in code. The reasoning and the code locations are in `final-decisions-report.md`.

| # | Decision made | Cost |
|---|---|---|
| O-1 | CHECKPOINT: structured signals first, with the broad text match as the fallback. When a text match and a structured code conflict, the more severe stop wins, so a CHECKPOINT text on an HTTP 429 gives CHECKPOINT (a test pins it). On a tie, the structured signal wins. The owner confirms the "structured first" wording. | A rare stop on an unrelated text, including a rate-limit response that mentions a checkpoint. Fails closed. |
| O-2 | Redaction: exact-value registration stays the control. A token-shape scrub (IGAA, IGQV, EAA and Bearer) and escaped-form matching (JSON escape and URL encoding) are added to error and audit text. | A small chance of over-masking a token-shaped string. |
| O-3 | Damaged state: the service starts stopped, instead of refusing to start. It stays up, outbound is refused, the poller is halted, status and reads work, and the owner clears the stop. | A damaged state file no longer stops the process from starting. Outbound stays blocked until the clear. |
| O-4 | Discovery lookups: business discovery and mentioned-media lookups each get a daily bucket of 50. | A hard ceiling on those lookups. |
| O-5 | Retry after a failure before any request reached Instagram: one retry is allowed for a private reply or an auto-reply. Any other failure keeps the block. | A retry path to keep correct. |
| O-6 | Token refresh: paused under CHECKPOINT and ACTION_BLOCKED. The expiry is shown in `ig status`, with a warning under seven days. | An expired token if the owner does not clear the stop in time. |
| O-7 | Long-lived token: the exchange is a POST with the short-lived token in the Authorization header and the client secret and grant type in the form body. No token is in a URL. | Meta may refuse the POST. That is a live check, and the failure is loud. |
| O-8 | Facebook login: the fragment flow through a loopback page. The browser reads the fragment and posts the token and the state to the loopback server. The token is never sent in a request URL, logged or stored; the approval comes back in the fragment, which the bridge page clears. | The owner's browser must run the loopback page. |
| O-9 | instagrapi: 3.1.0 stays, with both challenge handlers refusing. The sidecar stays off by default, and its first use needs a live check. | A release that was a day old at build. The live check is the mitigation. |
| O-10 | HTTP status for stops: 423 Locked for AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED and RATE_LIMITED, with the kind in the body. STOPPED stays 409. | Clients that expect 500 for a stop must handle 423. |
| O-11 | Readings: (a) a like on media reads the owner profile once first, and fails closed if that read fails; (b) private replies count toward the 50-a-day owner DM cap (confirmed). | One extra read for the first like after a start. |
| O-12 | Auto-reply consent: turning auto-replies on with the enable command and `confirm` is the owner's consent for each automatic reply, inside the caps and the 24-hour window. | The owner accepts that automatic replies are sent without a further prompt. |
| O-13 | Publishing: the owner runs a public HTTPS host. The service reads media only from `media.dir`, builds the URL from `media.publicBaseUrl`, refuses path traversal, and checks the URL with a HEAD request. No upload route is implemented. | The owner must host the files. |

**Questions still open for the owner** (not among the thirteen; each is recorded in `final-decisions-report.md`):

- **C-1. The constraint file.** `global-constraints.md` still states the event cursor rule without the exception of decision N-14 (cursor reset after a state loss). The README and the spec describe the exception. Should the constraint file be amended to say so, or should the reset be removed?
- **C-2. The auto-reply rule shape and the stored token record** are the build's own definitions. The owner confirms them in the live phase.
- **C-3. Mentions without a sender** are audited, not stored. The event schema requires a sender id. Storing them needs a schema change, which the owner decides.
- **C-4. Media likes and unlikes go to named targets only**, one at a time, within the caps (spec decision 5). The build briefly limited them to the owner's own media and reverted that. The owner confirms the reading.

**Decisions the build made earlier, with their status:**

- **B1. Reads set the stop** (CHECKPOINT, ACTION_BLOCKED, RATE_LIMITED). The build plan said reads never change the stop state. Still in force.
- **B2. HTTP status for stops.** Superseded by O-10: 423, not 500.
- **B3. The MCP SDK reading.** `initialize` negotiates 2025-11-25, and 2026-07-28 is served through `server/discover`. Still in force; the owner should accept it.
- **B4. The instagrapi pin.** Kept by O-9.
- **B5. Publishing input.** Superseded by O-13: the owner's host, not an upload route.
- **B6. The challenge handlers refuse.** Still in force (see "Device identity").
- **B7. The ten-minute MCP timeout.** Accepted in the final review (A-36).

---

## Where the rest is recorded

- Spec: `docs/superpowers/specs/2026-10-20-instagram-cli-design.md`
- Plan: `docs/superpowers/plans/2026-10-20-instagram-automation-build.md`
- Decision map (O-1 to O-13, A-1 to A-36, and the questions still open): `.superpowers/sdd/2026-10-20-instagram-automation-build/final-decisions-report.md`
- Final review, and the final fix round: `.superpowers/sdd/2026-10-20-instagram-automation-build/final-review.md` and `final-fix-report.md`
- Build ledger, rulings and per-task reports: `.superpowers/sdd/2026-10-20-instagram-automation-build/` (`progress.md`, and `task-N-report.md` for each task)
- Research: `reports/` and `research_notes/`
