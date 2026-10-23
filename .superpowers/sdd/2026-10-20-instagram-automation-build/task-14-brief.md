### Task 14: Tool registry

**Files:** Create `src/tools.js`. Test: `test/tools.test.js`.

**Interfaces:**
- Consumes: the service methods (Task 13).
- Produces: `TOOLS`, an array of `{ name, description, inputSchema, outbound, annotations, handler: (service, args) => Promise<any> }`. `inputSchema` is JSON Schema with `type: 'object'`, `properties` and `required`. `annotations` holds `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`. Reads set `readOnlyHint: true`. `ig_comment_delete`, `ig_media_delete`, `ig_comment_hide` and `ig_stop_clear` set `destructiveHint: true`. Every outbound tool sets `openWorldHint: true`. Every outbound tool has a `confirm` boolean property. Names match the Tool List above.
- Produces: `findTool(name)`, which returns the tool or `undefined`.
- Produces: `validateArgs(schema, args)`, which checks required fields and the `type` of each declared property (`string`, `number`, `integer`, `boolean`, `object`, `array`). It throws `VALIDATION` naming the first failing field.

**Tests:**
- `every tool name starts with ig_ and is unique`.
- `every outbound tool has a confirm property and openWorldHint`.
- `reads are readOnlyHint true`.
- `destructive tools carry destructiveHint`.
- `validateArgs rejects a missing required field with VALIDATION`.
- `validateArgs rejects a wrong type`.
- `each handler calls the matching service method`: with a fake service that records calls, `ig_dm_send` calls `dmSend`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the registry.** Run the tests and expect PASS.

