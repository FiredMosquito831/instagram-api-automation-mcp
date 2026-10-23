### Task 16: MCP thin client

**Files:** Create `src/mcp.js`. Test: `test/mcp.test.js`. Install the chosen SDK package. Before writing code, read the current SDK documentation through Context7: server construction, tool registration with annotations, and the stdio transport.

**Interfaces:**
- Consumes: `TOOLS` (Task 14). The HTTP API (Task 15) is reached over loopback with the bearer token.
- Produces: `createMcpServer({ forward, tools }) -> server`. `forward(name, args)` posts to `http://127.0.0.1:<port>/tools/<name>` with the bearer token, and returns the parsed body. Each tool is registered with its name, description, input schema and annotations. A busy body is returned as a normal result, not as an error. An error body becomes a result with `isError: true` and text `{"error":{"kind":...,"message":...}}`. When the service cannot be reached, the error kind is `API_ERROR` and the message says `ig serve is not running`.
- Produces: `startStdio({ forward, tools }) -> Promise<void>`, which connects the stdio transport. Logs go to stderr only, because stdout carries the protocol.
- SDK choice: `@modelcontextprotocol/server` (v2) when Step 3 confirms that it negotiates the 2026-07-28 protocol revision with the client. Otherwise `@modelcontextprotocol/sdk` (v1). The choice is recorded in the README.

**Tests:**
- `createMcpServer registers every tool with its annotations`.
- `a busy body comes back as a normal result`.
- `an error body comes back with isError true and no secret text`.
- `an unreachable service gives an API_ERROR result that says ig serve is not running`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the module.** Run the tests and expect PASS.
- [ ] **Step 3: Protocol spike.** Start `node bin/ig.js mcp` as a subprocess with a fixture config and a fake `IG_OWNER_TOKEN`. Send `initialize` with protocol version `2026-07-28`, then `tools/list`. Expected: the negotiated version is `2026-07-28`, the tool count equals `TOOLS.length`, and stdout holds only protocol frames. If the negotiation fails, switch to the v1 package and repeat. Record the result.

