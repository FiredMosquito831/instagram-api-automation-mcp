### Task 5: Graph API client

**Files:** Create `src/graph/client.js`. Test: `test/graph-client.test.js`.

**Interfaces:**
- Consumes: `mapGraphError` (Task 2), config (Task 1).
- Produces: `createGraphClient({ config, loginProduct, token, fetchImpl = fetch, sleep, now }) -> { get(path, query), post(path, { form, json }, { retryPost }), del(path, query) }`. Every method returns `Promise<{ data, usage }>`.
- `loginProduct` is `'instagram'` (base `config.graph.instagramBase`) or `'facebook'` (base `config.graph.facebookBase`). The URL is `${base}/${config.graph.version}/${path}` plus the encoded query.
- The token goes in `Authorization: Bearer <token>`. The live phase confirms this transport.
- Timeout: `AbortSignal.timeout(15000)`.
- Retries: GET calls, and POST calls with `retryPost: true`, retry up to 3 times on 429, 500, 502, 503 and 504. The delay is the `Retry-After` value in seconds when present, otherwise 1000, 2000 and 4000 ms. POST and DELETE are not retried unless `retryPost: true`.
- `usage` is parsed from the `x-business-use-case-usage` and `x-app-usage` headers (JSON), or `null` when absent.
- A non-OK status, or a body with `error`, throws `mapGraphError`.

**Tests:**
- `GET builds the versioned URL on the instagram base with a Bearer header`: the fake fetch records the URL and the header.
- `facebook login uses graph.facebook.com`.
- `429 on GET is retried after Retry-After seconds, then succeeds`: the fake sleep records 2000 ms for `Retry-After: 2`.
- `POST is not retried by default`: a 503 on POST throws after one call.
- `error code 190 surfaces as AUTH_EXPIRED`.
- `usage header is parsed when present`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the client.** Run the tests and expect PASS.

