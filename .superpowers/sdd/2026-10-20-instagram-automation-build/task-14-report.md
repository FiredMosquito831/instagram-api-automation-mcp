# Task 14 report: tool registry

Status: DONE_WITH_CONCERNS (see the concerns at the end).

## Files changed

- `D:\Projects2\InstagramApi\src\tools.js` (new): `TOOLS` (36 tools), `findTool(name)`, `validateArgs(schema, args)`.
- `D:\Projects2\InstagramApi\test\tools.test.js` (new): 25 tests.

Not changed: `src/service.js`, `package.json`, `package-lock.json`, and every other source and test file. The project is not a git repository, so there is no commit. The mutation check in the TDD evidence ran on a copy under the scratchpad, `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\mut`, and not on the project.

## TDD evidence

RED (`node --test test/tools.test.js`, before `src/tools.js` existed):

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\tools.js' imported from D:\Projects2\InstagramApi\test\tools.test.js
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

The import failed, so no test ran. This is the expected failure: the module did not exist.

GREEN (`node --test test/tools.test.js`, after the implementation):

```
ℹ tests 25
ℹ pass 25
ℹ fail 0
```

Full suite (`npm test`, final code): `ℹ tests 569`, `ℹ pass 569`, `ℹ fail 0`, exit 0. The count before this task was 544, so the 25 new tests account for the difference.

Mutation check (on the scratch copy, one breakage at a time; each must be caught):

- `ig_dm_send` requires `confirm`: 4 tests fail.
- `validateArgs` lets an unknown declared type pass: 1 test fails.
- A handler defaults `confirm` to true: 2 tests fail.
- `validateArgs` skips the type check: 4 tests fail.

The unmutated code passes all 25.

## Decisions

- Kinds. The brief names three kinds (read, outbound, unofficial). The spec has five groups, so the table uses the spec's group names: "status and admin", "read", "events", "outbound", "unofficial".
- Outbound. `outbound: true` on the 9 official outbound tools and the 3 unofficial tools (`ig_follow`, `ig_unfollow`, `ig_profile_edit`). Both groups take `confirm` and go through `runOutbound` in the service.
- `confirm` is never in `required`. A call without `confirm` must reach the service so that it can return a preview. The service enforces the gate.
- `confirm` appears on 14 tools: the 12 outbound tools, plus `ig_stop_clear` and `ig_autoreply_set`, which the spec also names with `confirm`.
- `idempotentHint` equals `readOnlyHint`. The spec gives no idempotence for any non-read tool, so those are false.
- `destructiveHint` is true for the four tools the brief names, and explicitly false for the others.
- `openWorldHint` is true for every outbound tool (as the brief requires) and for every read or token call that reaches Graph or the sidecar. It is false for the tools that touch only local state. The brief fixed only the outbound value; the rest is my reading of the MCP meaning.
- Handlers forward only the properties their schema declares, to the one service method named. A handler never adds `confirm`, and never calls another method. Returned values are the service's own object, unchanged, so the `untrusted` marker stays (tested by identity).
- `validateArgs`: a missing required field, or a present field of the wrong type, throws VALIDATION whose message begins with the field name. A declared type outside the six listed throws a TypeError before any argument is checked, so it cannot pass. No arguments count as `{}`. A `null` for an optional field is a wrong type, so callers must omit the field.

## Tool table

Columns: kind is the spec group. Annotations are readOnlyHint, destructiveHint, idempotentHint, openWorldHint. "confirm" marks a confirm property.

| # | Tool | Kind | Service method | Outbound | readOnly | destructive | idempotent | openWorld | confirm |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ig_status | status and admin | status | no | true | false | true | false | no |
| 2 | ig_caps_status | status and admin | capsStatus | no | true | false | true | false | no |
| 3 | ig_stop_status | status and admin | stopStatus | no | true | false | true | false | no |
| 4 | ig_stop_clear | status and admin | stopClear | no | false | true | false | false | yes |
| 5 | ig_token_status | status and admin | tokenStatus | no | true | false | true | false | no |
| 6 | ig_token_refresh | status and admin | tokenRefresh | no | false | false | false | true | no |
| 7 | ig_autoreply_set | status and admin | autoReplySet | no | false | false | false | false | yes |
| 8 | ig_events_purge | status and admin | eventsPurge | no | false | false | false | false | no |
| 9 | ig_profile_get | read | profileGet | no | true | false | true | true | no |
| 10 | ig_media_list | read | mediaList | no | true | false | true | true | no |
| 11 | ig_media_get | read | mediaGet | no | true | false | true | true | no |
| 12 | ig_insights_account | read | insightsAccount | no | true | false | true | true | no |
| 13 | ig_insights_media | read | insightsMedia | no | true | false | true | true | no |
| 14 | ig_mentioned_media | read | mentionedMedia | no | true | false | true | true | no |
| 15 | ig_comments_list | read | commentsList | no | true | false | true | true | no |
| 16 | ig_dm_conversations | read | dmConversations | no | true | false | true | true | no |
| 17 | ig_dm_messages | read | dmMessages | no | true | false | true | true | no |
| 18 | ig_dm_unread | read | dmUnread | no | true | false | true | false | no |
| 19 | ig_dm_mark_read | read | dmMarkRead | no | false | false | false | false | no |
| 20 | ig_hashtag_search | read | hashtagSearch | no | false | false | false | true | no |
| 21 | ig_business_discovery | read | businessDiscovery | no | true | false | true | true | no |
| 22 | ig_events_pending | events | eventsPending | no | false | false | false | false | no |
| 23 | ig_events_ack | events | eventsAck | no | false | false | false | false | no |
| 24 | ig_events_decide | events | eventsDecide | no | false | false | false | false | no |
| 25 | ig_publish_media | outbound | publishMedia | yes | false | false | false | true | yes |
| 26 | ig_comment_reply | outbound | commentReply | yes | false | false | false | true | yes |
| 27 | ig_comment_hide | outbound | commentHide | yes | false | true | false | true | yes |
| 28 | ig_comment_delete | outbound | commentDelete | yes | false | true | false | true | yes |
| 29 | ig_like | outbound | like | yes | false | false | false | true | yes |
| 30 | ig_unlike | outbound | unlike | yes | false | false | false | true | yes |
| 31 | ig_dm_send | outbound | dmSend | yes | false | false | false | true | yes |
| 32 | ig_private_reply | outbound | privateReply | yes | false | false | false | true | yes |
| 33 | ig_media_delete | outbound | mediaDelete | yes | false | true | false | true | yes |
| 34 | ig_follow | unofficial | follow | yes | false | false | false | true | yes |
| 35 | ig_unfollow | unofficial | unfollow | yes | false | false | false | true | yes |
| 36 | ig_profile_edit | unofficial | profileEdit | yes | false | false | false | true | yes |

Spec tool names with no service method: none. All 36 names in the spec's Tools section map to a service method, and the test "every service method a handler names exists in src/service.js" confirms each method is declared in `src/service.js`.

## Self-review

I read the new files in full. Points I checked and points that remain open:

- Every declared property name matches the destructured argument names of its service method. I checked this by reading each method's first line in `src/service.js`. No test compares names against the signatures, so this is a reading check, not a test.
- The confirm pass-through is tested for all 14 confirm tools, with `undefined`, `false` and `true`.
- The untrusted-text handlers (`ig_events_pending`, `ig_comments_list`, `ig_dm_messages`, `ig_mentioned_media`, `ig_business_discovery`, `ig_events_decide`) return the service's result object by identity, so the marker is kept.
- `validateArgs` does not check enum values (`kind`, `decision`, `period`, `metrics`) or lengths; those live in the service and in the descriptions. A caller that skips the service gets no enum check from the registry.
- Callers must run `validateArgs(tool.inputSchema, args)` before a handler. The registry does not enforce this. Tasks 15 (HTTP) and 16 (MCP) must do it.
- Task 13 carry-forward: the names and argument shapes match the service as built. The carousel `urls` entries are objects with exactly one of `imageUrl` or `videoUrl`, as `checkChild` in `src/graph/endpoints/media.js` requires.
- The suite ran on Node v24.6.0. The project engine is >=22.12.0, and Node 22 has not been run for any task; that is the Task 18 carry-forward.

## Concerns

1. `ig_dm_mark_read` is readOnlyHint true because the spec lists it under Read. It does write a local read marker, so a client that trusts readOnlyHint may skip a prompt. I followed the spec; the lead should decide.
2. `ig_events_purge` deletes stored events, but it is not destructiveHint, because the brief names four destructive tools. Same decision as concern 1.
3. The four status tools (`ig_status`, `ig_caps_status`, `ig_stop_status`, `ig_token_status`) are readOnlyHint true, although the spec groups them under status and admin. They change nothing, so the value is accurate.
4. openWorldHint is true for reads that call Graph and false for local tools. The brief fixed only the outbound value, so this is my extension.
5. The registry does not enforce `validateArgs`. Tasks 15 and 16 must call it before each handler.

## Fix round 1 (coordinator request)

The coordinator asked for two annotation changes. The tests were written first and run red, then the registry was changed.

### Changes

1. `ig_dm_mark_read` writes a local read marker, so it is not read-only.
   - readOnlyHint: `true` changed to `false`.
   - idempotentHint: `true` changed to `false` (it follows readOnlyHint, as before).
   - destructiveHint stays `false`. openWorldHint stays `false`.
   - In `src/tools.js` the `readOnly: true,` line of this tool was removed, so the default `false` applies.
2. `ig_events_purge` deletes stored events, so it is destructive.
   - destructiveHint: `false` changed to `true`.
   - In `src/tools.js` the line `destructive: true,` was added. The other annotations are unchanged.

### Tests (`test/tools.test.js`)

The assertion in "reads are readOnlyHint true" is unchanged. Only the set it checks against changed.

- Old: `const READ_ONLY = new Set([...inGroups('read'), 'ig_status', 'ig_caps_status', 'ig_stop_status', 'ig_token_status']);`
- New:

```js
const READ_ONLY = new Set([
  ...inGroups('read').filter((name) => name !== 'ig_dm_mark_read'),
  'ig_status',
  'ig_caps_status',
  'ig_stop_status',
  'ig_token_status',
]);
```

The destructive test keeps its assertion, `assert.equal(t.annotations.destructiveHint, DESTRUCTIVE.has(t.name), t.name);`. Only the set changed.

- Old: `const DESTRUCTIVE = new Set(['ig_comment_delete', 'ig_media_delete', 'ig_comment_hide', 'ig_stop_clear']);`
- New: `const DESTRUCTIVE = new Set(['ig_comment_delete', 'ig_media_delete', 'ig_comment_hide', 'ig_stop_clear', 'ig_events_purge']);`

New test:

```js
test('ig_dm_mark_read is not readOnlyHint, because it writes a local read marker', () => {
  const marker = tool('ig_dm_mark_read');
  assert.equal(marker.annotations.readOnlyHint, false);
  assert.equal(marker.annotations.idempotentHint, false);
});
```

### Evidence

RED (`node --test test/tools.test.js`, tests changed, registry not yet changed):

```
✖ reads are readOnlyHint true
✖ destructive tools carry destructiveHint
✖ ig_dm_mark_read is not readOnlyHint, because it writes a local read marker
ℹ tests 26
ℹ pass 23
ℹ fail 3
```

GREEN (after the registry change):

```
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

Full suite (`npm test`): `ℹ tests 570`, `ℹ pass 570`, `ℹ fail 0`, `ℹ cancelled 0`, exit 0. This is the earlier 569 plus the new test.

### Corrected table rows

Rows not listed here are unchanged.

| # | Tool | Change | readOnly | destructive | idempotent | openWorld |
|---|---|---|---|---|---|---|
| 8 | ig_events_purge | destructive now true | false | true (was false) | false | false |
| 18 | ig_dm_unread | unchanged | true | false | true | false |
| 19 | ig_dm_mark_read | readOnly and idempotent now false (were true) | false (was true) | false | false (was true) | false |

The readOnlyHint count is now 16: 12 spec reads plus 4 status tools. It was 17. The destructive count is now 5.

### Concerns after this round

- Concerns 1 and 2 above are closed by this round.
- The spec, at `docs/superpowers/specs/2026-10-20-instagram-cli-design.md` line 156, still lists `ig_dm_mark_read` under Read. The annotation now differs from that grouping, so the spec text may need the same correction.
- Concerns 3, 4 and 5 stand as written.

## Fix round 2 (full task review, `task-14-review.md`)

Each change below is listed with its file and line. Lines are those of the files after this round.

### Changes

- **I-1, ig_hashtag_search is not read-only.** `src/tools.js:272-279`, the `ig_hashtag_search` definition.
  - Old: `readOnly: true,` (between `method: 'hashtagSearch',` and `openWorld: true,`).
  - New: that line removed, so readOnlyHint and idempotentHint are false. openWorldHint stays true.
  - Test set: `test/tools.test.js:53-61`, READ_ONLY (the filter is on line 56). The comment above it now names both tools that write local state.
  - Old: `...inGroups('read').filter((name) => name !== 'ig_dm_mark_read'),`
  - New: `...inGroups('read').filter((name) => name !== 'ig_dm_mark_read' && name !== 'ig_hashtag_search'),`
  - The assertion in "reads are readOnlyHint true" is unchanged.
  - New test: `ig_hashtag_search is not readOnlyHint, because each call records a hashtag against its cap` (`test/tools.test.js:170`).
- **M-1, a missing schema throws VALIDATION.** `src/tools.js:37-40`.
  - The schema must be a plain object with `type: 'object'`; anything else throws VALIDATION. You asked for VALIDATION, and the review had suggested TypeError; I followed your instruction. An unknown declared type still throws TypeError.
  - New test: `validateArgs refuses a missing schema, or one that is not an object schema, with VALIDATION` (`test/tools.test.js:245`). It asserts `validateArgs(undefined, {})`, `validateArgs(null, {})` and a schema with no type all throw VALIDATION.
- **M-2, only plain objects are objects.** `src/tools.js:13-17`, `isPlainObject`.
  - Old: `const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);`
  - New: the value's prototype must be `Object.prototype` or `null`.
  - New test: `validateArgs refuses a Date, a Map or a class instance for an object property, and accepts a null-prototype object` (`test/tools.test.js:252`).
- **M-3, the first declared failing field is named.** `src/tools.js:37-58`, `validateArgs`.
  - The required and type checks now run in one pass over the declared properties, in declared order. Required names that the schema does not declare are checked for presence last.
  - New test: `validateArgs names the first declared field that fails, whether it is missing or of the wrong type` (`test/tools.test.js:265`). Case 1, `{ a: 5 }`, has a wrong type on `a` and `b` missing; the old code named `b`, so this case was red. Case 2, `{ b: 1.5 }`, has `a` missing and `b` wrong, and names `a`.
- **M-4, missing tests.** These three already had working behaviour, so they passed on the first run. They add coverage only.
  - (a) `validateArgs with no arguments throws VALIDATION naming the first required field` (`test/tools.test.js:277`).
  - (b) `validateArgs throws a TypeError for a declared type outside the list, even when another argument is wrong` (`test/tools.test.js:282`). The existing test "refuses a declared type that is not in the list, and never passes it" stays.
  - (c) `validateArgs refuses NaN and Infinity for number and integer` (`test/tools.test.js:289`).
  - Also added: `findTool returns undefined for a name that is not a string` (`test/tools.test.js:304`). It is not in your list (a) to (c), but the review's M-4 names it.
- **M-5, forwarding for every tool.** The new test `every tool forwards its declared arguments to the service method it names` (`test/tools.test.js:329`) builds valid arguments for each tool from its own schema, using the helper `sampleOf` (`test/tools.test.js:319`). It checks that `validateArgs` accepts them, and that the fake service records exactly one call, to the spec method, with the same arguments. It passed on the first run, so it is coverage.
- **M-6, the test name.** `test/tools.test.js:369`.
  - Old name: `handlers return event and comment text as the service gives it, with the untrusted marker`
  - New name: `handlers return the service result as the same object, so a marker the service sets is kept`
  - The assertion, `assert.equal(result, marked, ...)`, is unchanged.
- **M-8, frozen constants and tools.** `src/tools.js:61-67` (`deepFreeze`), `:94` (defineTool returns `deepFreeze({...})`), and `:109-116` (STRING, INTEGER, BOOLEAN, ID, METRICS, CONFIRM, each `Object.freeze`).
  - New test: `the tools and their schemas are frozen, so a change to one throws` (`test/tools.test.js:385`). It assigns to `annotations.readOnlyHint`, to `inputSchema.properties.senderId.type`, to `handler`, and calls `TOOLS.push`. Each throws TypeError, since the test file is strict ESM. Afterwards the values and the count of 36 are unchanged.

### Evidence

RED (`node --test test/tools.test.js`, after the test edits, before the registry edits):

```
ℹ tests 36
ℹ pass 30
ℹ fail 6
✖ reads are readOnlyHint true
✖ ig_hashtag_search is not readOnlyHint, because each call records a hashtag against its cap
✖ validateArgs refuses a missing schema, or one that is not an object schema, with VALIDATION
✖ validateArgs refuses a Date, a Map or a class instance for an object property, and accepts a null-prototype object
✖ validateArgs names the first declared field that fails, whether it is missing or of the wrong type
✖ the tools and their schemas are frozen, so a change to one throws
```

GREEN (`node --test test/tools.test.js`, after the registry edits): `ℹ tests 36`, `ℹ pass 36`, `ℹ fail 0`.

Full suite (`npm test`): `ℹ tests 580`, `ℹ pass 580`, `ℹ fail 0`, `ℹ cancelled 0`, exit 0. This is the 570 from fix round 1 plus the 10 new tests.

### New tests (10)

1. ig_hashtag_search is not readOnlyHint, because each call records a hashtag against its cap
2. validateArgs refuses a missing schema, or one that is not an object schema, with VALIDATION
3. validateArgs refuses a Date, a Map or a class instance for an object property, and accepts a null-prototype object
4. validateArgs names the first declared field that fails, whether it is missing or of the wrong type
5. validateArgs with no arguments throws VALIDATION naming the first required field
6. validateArgs throws a TypeError for a declared type outside the list, even when another argument is wrong
7. validateArgs refuses NaN and Infinity for number and integer
8. findTool returns undefined for a name that is not a string
9. every tool forwards its declared arguments to the service method it names
10. the tools and their schemas are frozen, so a change to one throws

### Corrected table rows

Row 20, ig_hashtag_search: readOnlyHint false (was true), idempotentHint false (was true), openWorldHint true (unchanged).

The readOnlyHint count is now 15: 11 spec reads (the 13 read-group tools, less ig_dm_mark_read and ig_hashtag_search) plus the 4 status tools. Round 1 gave 16.

### Concerns after this round

- The spec, at line 156, lists `ig_dm_mark_read` and `ig_hashtag_search` under Read. Both are now not read-only, so the spec text needs the same correction.
- Review M-6, second half, is not done: the service assertions for the business-discovery and eventsDecide markers in `test/service.test.js` (review lines 58 and 20). You asked for the registry test rename only.
- M-7 (enum values) is deferred, as you asked. The kind, decision and period values are still described in prose only.

## Fix round 3 (the second half of review M-6)

The coordinator asked for the two unasserted service markers to be tested. Both paths set the marker in the service, so no service change was needed and no finding is raised.

### What the service does

- `businessDiscovery`, `src/service.js:692-696`: the result passes through `untrusted(found)` (`src/service.js:695`). The marker is the top-level field `untrusted: true`.
- `eventsDecide`, `src/service.js:710-714`: the result passes through `redact(untrusted(event))` (`src/service.js:713`). The marker is again `untrusted: true`. `redact` keeps the boolean (the new test shows it).
- `src/service.js:79`, `untrusted`: `({ ...value, untrusted: true })`.

### New assertions (`test/service.test.js`, after `eventsPending marks event text untrusted`)

Added in full:

```js
test('businessDiscovery returns the result marked untrusted, because it is another account\'s data', async () => {
  const t = setup({
    facebook: 'keyring',
    answers: { [`GET ${OWNER}`]: { business_discovery: { id: OTHER, username: 'other_shop', followers_count: 10 } } },
  });
  const found = await t.service.businessDiscovery({ username: 'other_shop', fields: 'username,followers_count' });
  assert.deepEqual(found, { id: OTHER, username: 'other_shop', followers_count: 10, untrusted: true });
  assert.equal(t.graph.products.at(-1), 'facebook');
});

test('eventsDecide returns the event marked untrusted, even when the event it gets back has no marker', async () => {
  const t = setup();
  // The fake decide returns the inbound text without the marker. So the untrusted field in the result can only come from
  // the service, which marks the result before it returns it.
  t.events.decide = (id, decision) => {
    t.events.calls.push(['decide', id, decision]);
    return { id, senderId: OTHER, status: 'handled', text: 'what is the price?', decision: { ...decision } };
  };
  const event = await t.service.eventsDecide({ eventId: 'evt-1', decision: 'reply', draft: 'Thanks' });
  assert.equal(event.text, 'what is the price?');
  assert.equal(event.untrusted, true);
  assert.equal(t.graph.requests.length, 0, 'no Graph request');
});
```

The eventsDecide test replaces the fake `decide` on this test's own events fake only. The existing fake returns `untrusted: true` itself, so the existing `eventsDecide` test could not show the service adds the marker. The new fake returns the same text without it.

### Evidence

Targeted run (`node --test test/service.test.js`): `ℹ tests 64`, `ℹ pass 64`, `ℹ fail 0`. The two new tests pass.

Mutation check (scratch copy under `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\mut3`, not the project): with the service's two `untrusted` calls removed, exactly the two new tests fail (`ℹ tests 64`, `ℹ pass 62`, `ℹ fail 2`). The project's `src/service.js` was not changed; both original lines are still present.

Full suite (`npm test`): `ℹ tests 582`, `ℹ pass 582`, `ℹ fail 0`, `ℹ cancelled 0`, exit 0. This is the 580 from fix round 2 plus the two new tests.

### Status of review M-6

Both halves are now done: the registry test was renamed in fix round 2, and the two service markers are asserted here. Nothing else in this round changed.
