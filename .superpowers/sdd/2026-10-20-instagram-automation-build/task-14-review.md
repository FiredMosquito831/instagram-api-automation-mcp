# Task 14 review: tool registry

Scope: task-14-base to task-14-head. Both files are new: `src/tools.js` and `test/tools.test.js`. I read the review diff and the live files (36 `defineTool` calls, 26 tests, matching the head), then the service code each handler reaches: `src/service.js`, `src/guard.js`, `src/caps.js`, `src/events.js`, `src/graph/endpoints/messaging.js`. I did not re-run the suite.

## Spec compliance

- ✅ Tool list. All 36 spec names are in TOOLS, and there are no extras. Names match exactly (`src/tools.js:97` onward). The SPEC table in `test/tools.test.js:10-47` matches spec lines 155 to 159, and the sorted-equality test (`test/tools.test.js:110-112`) fails on a missing or an extra name.
- ⚠️ Kind. The registry has no `kind` field, and the brief's interface has none. The kinds are encoded by `outbound` and the annotations. Official and unofficial outbound tools are told apart only by their descriptions (`src/tools.js:396`, ig_follow). This is not a spec failure. Tasks 15 and 16 must not rely on a group field.
- ✅ Outbound. Exactly 12 tools have `outbound: true` (9 official, 3 unofficial). Each has a boolean `confirm` (`src/tools.js:92-95`), `confirm` is not in `required`, and `openWorldHint` is true (`test/tools.test.js:136-143`).
- ✅ Confirm. `pick()` forwards only the keys the caller gave (`src/tools.js:48-55`), and nothing defaults `confirm`. The service refuses a non-boolean `confirm` (`src/guard.js:65-69`) and previews on `undefined` (`src/guard.js:237-239`). `test/tools.test.js:261-269` covers the 14 confirm tools with undefined, false and true.
- ✅ Destructive. Exactly the five named tools: ig_stop_clear, ig_comment_hide, ig_comment_delete, ig_media_delete and ig_events_purge. The exact-set test is at `test/tools.test.js:62` and `:160-162`.
- ❌ readOnlyHint. ig_hashtag_search is `readOnly: true` (`src/tools.js:256`). Each successful call writes the hashtag cap ledger: `src/service.js:681` calls `caps.record`, and `src/caps.js:246-247` runs `state.set` and `state.save`. The ruling is that a read which writes local state is not read-only, as ig_dm_mark_read is. By that rule this tool is false. See I-1.
- ✅ ig_dm_mark_read is `readOnly: false`, as ruled (`src/tools.js:243`), and pinned by `test/tools.test.js:164-168`.
- ✅ The other reads and status tools are read-only, and their normal path writes nothing. The status tools (`src/service.js:512-548`), ig_dm_unread (`src/service.js:662-664`, where `events.unreadSenders` only reads), and the Graph reads are all clean. ig_events_pending is correctly not read-only: `events.pending` saves `events.issued` (`src/events.js:308-310`).
- ⚠️ Error-path writes. `readCall` persists a stop for CHECKPOINT, ACTION_BLOCKED and RATE_LIMITED (`src/service.js:449-460`, the Task 13 M-7 ruling). Read literally, the readOnly rule would make every Graph read false on that path. I took the rule to cover normal-path writes only, which is what ig_dm_mark_read implies. The lead should confirm.
- ✅ openWorldHint. False on exactly the 12 local tools (`test/tools.test.js:64-77` and `:170-172`). Each of those makes no Graph or sidecar call, as checked in `src/service.js:512-720`. True on every Graph read, on every outbound tool, and on ig_token_refresh.
- ✅ Handlers. Each of the 36 handlers calls one service method, and each method exists (`src/service.js:512-897`). Each schema property name matches the destructured argument of its method, checked by reading every signature. The test pins method names (`test/tools.test.js:245-251`) but not argument names (see M-5).
- ✅ ig_events_decide calls eventsDecide and nothing else (`src/tools.js:288-293`; `src/service.js:710-714`, no send).
- ✅ ig_events_pending returns the service result unchanged (`src/service.js:699-702`), and each event carries `untrusted` (`src/events.js:290`).
- ✅ Inbound and comment text keep their marker. Comments, messages and mentions are marked in the service (`src/service.js:617-637`, `:649-660`), and the handler returns the object by identity (`src/tools.js:83`). `test/service.test.js:683-702` asserts the marker for those three. The business-discovery and eventsDecide markers have no assertion (see M-6).
- ⚠️ ig_events_purge is destructive with no `confirm`. Spec line 155 lists no confirm for it, so this follows the spec. Whether the owner wants a preview is an owner decision. No change in this task.
- ✅ validateArgs. Required fields and the six types are checked (`src/tools.js:37-43`). An unknown declared type throws TypeError before any argument is read (`src/tools.js:33`). NaN and Infinity are refused (`src/tools.js:17`), integer is a whole number (`:18`), and presence uses own properties (`:25`). A missing args object is refused when required fields exist (`:35`, `:37-38`). That last behaviour is correct by reading and has no test (see M-4).
- ✅ findTool uses strict equality and returns undefined on a miss (`src/tools.js:428-430`). `test/tools.test.js:238-243` covers `__proto__`.
- ✅ Tests. All seven brief tests are present, and each asserts behaviour. The weak ones are listed under Minor.

## Strengths

- One generic handler factory (`src/tools.js:60-85`) reaches exactly one service method and forwards only the declared keys. A handler cannot add `confirm` or call a second method.
- Confirm is never defaulted in the registry, and the service refuses a non-boolean `confirm` (`src/guard.js:65-69`). The test covers all 14 confirm tools with three values.
- validateArgs fails closed: an unknown type is a TypeError, a wrong type is VALIDATION, and NaN, Infinity and fractions never count as numbers or integers.
- The spec-match test is two-way (sorted equality), so it catches both a missing tool and an extra one.
- The destructive and openWorld sets are pinned as exact sets, not as spot checks (`test/tools.test.js:62`, `:64-77`).
- Untrusted results pass through by identity, so the service's marker is never stripped by the registry.

## Issues

### Critical

None.

### Important

**I-1. ig_hashtag_search is readOnlyHint true, but each call writes local state** (`src/tools.js:256`; pinned by `test/tools.test.js:55-61`, the READ_ONLY set). The service records each tag against the 30-per-7-days cap (`src/service.js:681`), and `caps.record` saves the ledger (`src/caps.js:246-247`). Under the readOnly rule this tool is false. A client that trusts readOnlyHint would run it without a prompt, and each run uses a cap slot.
Fix: set `readOnly: false` at `src/tools.js:256`, so idempotentHint follows to false. Remove ig_hashtag_search from the READ_ONLY set in the test, with a comment, as ig_dm_mark_read is. Update the report's row 20 and its readOnly count, which becomes 15, not 16. openWorldHint stays true.

### Minor

**M-1. validateArgs passes silently when there is no schema** (`src/tools.js:31`, `:37`). `schema?.properties` and `schema?.required` default to empty, so `validateArgs(undefined, args)` accepts anything. Current callers reach it through `tool?.inputSchema`, so this is latent. Fix: throw TypeError unless the schema is a plain object with `type: 'object'`.

**M-2. The `object` type accepts non-plain objects** (`src/tools.js:12`, used at `:20`). `isPlainObject` accepts Date, Map and class instances. Fix: require that `Object.getPrototypeOf(value)` is `Object.prototype` or `null`.

**M-3. Required fields are checked before types** (`src/tools.js:37-43`), so the first failing field is not necessarily the first declared one. The test at `test/tools.test.js:202-206` is named "in the order the schema declares them", and it passes only because its two cases happen to agree. Fix: rename the test, or check in one pass in declared order.

**M-4. Three behaviours the brief asks for have no test.** Validating a schema that has required fields with undefined args (`test/tools.test.js:231-236` uses a schema with no required fields). Infinity in `number` and `integer` (`test/tools.test.js:208-214` checks only NaN). findTool with a non-string name (`test/tools.test.js:238-243`). The code handles all three. Fix: add the three assertions.

**M-5. Argument forwarding is tested for one tool only** (`test/tools.test.js:253-259`, ig_dm_send). If a key in `src/service.js` is renamed, an optional argument (limit, period, draft) is dropped without error, because `pick()` passes undefined. Fix: a table-driven test that sets each declared property to a sentinel and asserts that the fake service receives it.

**M-6. A test name overclaims, and two service markers are unasserted.** `test/tools.test.js:277` is named "with the untrusted marker", but the fake returns the marked object and the test checks identity. It cannot fail if the real service drops the marker. The service marks business discovery (`src/service.js:695`) and eventsDecide (`src/service.js:713`), and `test/service.test.js:683-702` asserts neither. Fix: rename the test, and add a service assertion for those two.

**M-7. The schema has no `enum` for kind, decision or period** (`src/tools.js:303` and `:347` and `:357` for kind; `:291` for decision; `:185` for period). The service enforces the values (`src/service.js:724`, `:786`; `src/events.js:21`), but an MCP client sees them only in the prose. Fix: add `enum` to these properties. validateArgs does not need to check it.

**M-8. Shared schema constants and tool objects are mutable** (`src/tools.js:87-96`, the STRING, INTEGER, BOOLEAN, ID, METRICS and CONFIRM constants; `:97`). TOOLS is frozen only at the array level, so a runtime change to one tool's annotations reaches the HTTP and MCP layers. Fix: `Object.freeze` the constants, and each tool with its annotations and inputSchema.

## Assessment

Spec verdict: ❌. The tool list, names, outbound and confirm rules, destructive set and handler wiring all match the spec. One readOnlyHint (ig_hashtag_search, `src/tools.js:256`) breaks the read rule.

Task quality: Needs fixes. Apart from I-1, the registry is sound: confirm is never defaulted, the handlers reach the right methods with the right argument names, and validateArgs fails closed on types. The recorded carry-forward (Tasks 15 and 16 must call validateArgs before each handler) is correct per the ruling, and the service's own outbound guards (`src/service.js:742-786`) back up an unvalidated call.

Counts: Critical 0, Important 1, Minor 8.
