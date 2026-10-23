## Global Constraints

- Node engines `>=22.12.0`. `package.json` sets `"type": "module"`. Commander is used only by the setup commands.
- Secrets: the environment variable `IG_<NAME>` is read first, then the keyring. The keyring service name is `instagram-automation`. Tokens never reach a file, a log, or a tool result.
- Owner-only: one owner account, `owner.igUserId`. The service acts only as that account.
- Caps (starting values, configurable): any outbound action at least 2000 ms after the previous one; at most 200 outbound actions per day in total; likes 10 per hour and 50 per day; follows 20 per day; unfollows 20 per day; owner-sent DMs 50 per day; one private reply per comment, only within 7 days of the comment; auto-replies 1 per conversation per 24 hours and 100 per day; hashtag searches 30 unique hashtags per 7 days; publishing at most 10 per day locally, never above `quota_total`, read from `content_publishing_limit` with `since` set to 24 hours ago.
- Busy, not queued: spacing and cap limits return `{ busy: true, retryAfterMs, reason }`, with HTTP 429 on the HTTP API. Nothing waits in a queue to run later.
- Usage throttle: when the usage header shows `total_time` or `total_cputime` at 80 or more, outbound calls return busy for 60000 ms.
- Confirmation: every outbound tool requires `confirm: true`. Without it, the tool returns a preview and makes no request. `ig_events_decide` records a decision and an optional draft, and it never sends.
- Stop codes: error 190 (`AUTH_EXPIRED`); a checkpoint, challenge, or two-factor requirement (`CHECKPOINT`); error 368 or feedback required (`ACTION_BLOCKED`); HTTP 429, or Graph codes 4, 17, 32, 613 and 80002 (`RATE_LIMITED`). Every 80002 counts as a rate limit, because its subcode is unknown. A stop is persisted. Only `ig_stop_clear` with `confirm: true` resumes outbound actions.
- Messaging window: `dmSend` refuses before any request when the last inbound message from that user is 24 hours old or more. `ig_private_reply` refuses when the comment is more than 7 days old, or when that comment already has a private reply.
- DM text limit: 1000 bytes.
- Retention: events are kept 30 days. The purge removes only handled events older than that. Pending events are kept until they are acknowledged and decided.
- Event cursor: opaque. `ig_events_ack` refuses any cursor that has not been issued, and it never moves backwards.
- Event text is untrusted data. Every tool result that carries event text marks it `untrusted: true`.
- Webhooks: the signature is HMAC-SHA256 of the raw body with the app secret, hex encoded, sent as `X-Hub-Signature-256: sha256=<hex>`, compared in constant time. A mismatch returns 403. The verify token is compared in constant time by hashing both values first. The receiver refuses to build without the app secret and the verify token. Its path answers 404 unless `webhook.enabled` is true.
- HTTP API: binds `127.0.0.1` by default. A non-loopback host requires `api_token`. The Host header must be `127.0.0.1` or `localhost`, with the port. `POST /tools/:name` requires `Authorization: Bearer <api_token>`.
- Timers: no single timer is longer than 2147483647 ms. Token checks run hourly.
- Graph API version `v26.0` by default (configurable). Instagram Login base `https://graph.instagram.com`. Facebook Login base `https://graph.facebook.com`. The scope parameter is comma-joined, and the live login confirms the separator.
- Unofficial routes are off by default. Enabling them requires the warning to be acknowledged, and the acknowledgement is stored in state.
- The unofficial clients send their default app or browser identity as shipped. The project adds no device, fingerprint, proxy or challenge handling of its own.
- Comments on other people's posts are not implemented, and no tool exposes them.
- Tool annotations on every MCP tool: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.
- No test makes a network call. Tests use fake transports and fake clocks.
- No git commits. The project is not a git repository. Where a template step says commit, run the full suite instead.
- Secrets never appear in logs, audit lines, errors, or tool output. Every output path passes through `redact`.
- Subagents used for implementation or review are haiku-tier only.

