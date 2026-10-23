### Task 15: HTTP API

**Files:** Create `src/http.js`. Test: `test/http.test.js`.

**Interfaces:**
- Consumes: `TOOLS`, `findTool`, `validateArgs` (Task 14); `createWebhookHandler` (Task 10); `IgError` (Task 2).
- Produces: `createHttpServer({ service, tools, webhookHandler, webhookPath, apiToken, host, allowedHosts }) -> http.Server`, not yet listening. It throws `CONFIG` when `host` is not loopback and `apiToken` is empty.
- The Host header must match one of `allowedHosts`, with the port. Anything else returns 403.
- `GET /health` returns 200 `{ ok: true }` and needs no token.
- `POST /tools/:name` requires `Authorization: Bearer <apiToken>`, otherwise 401. The body is parsed as JSON, validated with `validateArgs`, and passed to the handler. Success is 200 `{ result }`. A busy result is 429 with the busy body. Errors are `{ error: { kind, message } }`, with status 400 for `VALIDATION`, 409 for `STOPPED`, 429 for `CAP_EXCEEDED`, 403 for `OWNER_MISMATCH` and `ROUTE_DISABLED`, 404 for an unknown tool, and 500 for other kinds. The message is redacted.
- `GET` and `POST` on `webhookPath` pass to `webhookHandler` as `{ method, query, headers, rawBody }`. When `webhookHandler` is null, the path returns 404.
- Request bodies over 1 MB return 413.

**Tests:**
- `health answers without a token`.
- `POST /tools without the bearer token returns 401`.
- `POST /tools/ig_status with the token returns the status result`.
- `a busy result returns 429 with busy true in the body`.
- `unknown tool returns 404`.
- `webhook path returns 404 when no handler is given`.
- `webhook GET handshake passes through unchanged`.
- `a Host header outside allowedHosts returns 403`.
- `a non-loopback host without an api token is refused at construction`.
- `bodies over 1 MB are rejected with 413`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the server.** Run the tests and expect PASS.

