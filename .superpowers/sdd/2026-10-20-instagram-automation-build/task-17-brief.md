### Task 17: Setup commands, OAuth helpers and serve

**Files:** Create `bin/ig.js`, `src/oauth.js`. Tests: `test/oauth.test.js`, `test/cli.test.js`. Install `commander@15.0.0`.

**Interfaces:**
- Consumes: config (Task 1), secrets and token (Task 9), service (Task 13), HTTP API (Task 15), webhook receiver (Task 10), poller (Task 11), MCP client (Task 16).
- Produces, in `src/oauth.js`: `buildAuthorizeUrl({ appId, redirectUri, scopes, state })`, which returns the Instagram Login authorization URL with `client_id`, `redirect_uri`, `response_type=code`, `scope` (comma-joined) and `state`. Also `parseRedirect(url, expectedState)`, which returns the `code`, and throws `AUTH_EXPIRED` when `state` does not match.
- Commands in `bin/ig.js`:
  - `auth set <name>`: reads the value from a hidden prompt, or from stdin.
  - `auth login`: starts a loopback redirect server on `127.0.0.1`, on port 8790 by default. Prints the authorization URL. Exchanges the code for a short-lived token, then for a long-lived token, locally with the app secret. Stores `owner_token`, `obtained_at` and `expires_at`.
  - `auth facebook`: the same loopback pattern, for Facebook Login for Business. It stores `facebook_token` and requires a linked Page. The exact endpoints are read from the Meta docs at execution.
  - `serve`: builds the service, starts the poller, starts the HTTP API on `config.http`, starts the webhook receiver only when `webhook.enabled` is set, and starts the hourly token checks. It refuses a non-loopback host without `api_token`. It prints the bound addresses.
  - `mcp`: starts the stdio MCP client, which forwards to the HTTP API.
  - `status`: prints the result of `ig_status` from the running service, or a local summary with a notice when the service is not running.
- Logs and prompts for `mcp` go to stderr.

**Tests:**
- `buildAuthorizeUrl comma-joins scope and includes state`.
- `parseRedirect returns the code when state matches`.
- `parseRedirect throws AUTH_EXPIRED when state does not match`. This is the CSRF guard.
- `ig --help lists auth, serve, mcp and status`: spawn `node bin/ig.js --help`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the modules and the bin file.** Run the tests and expect PASS.

