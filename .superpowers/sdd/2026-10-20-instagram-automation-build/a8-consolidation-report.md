# A-8 consolidation report

Date: 2026-10-23. Project: `D:\Projects2\InstagramApi`. Not a git repository: no git run, nothing committed. The `test` script in `package.json` is unchanged.

Status: DONE_WITH_CONCERNS (section 5).

## Counts

- `npm test` before: 1159 tests, 1159 pass, 0 fail.
- `npm test` after: 1161 tests, 1161 pass, 0 fail (two tests added, section 6).
- Duplicate definitions removed: 57 copies in 17 groups (section 1).

## 1. Duplicates before the change

Line numbers are from the tree before any edit. A copy is removed unless the table says it is kept.

| # | Group | Copies (file:line) | Disposition |
|---|---|---|---|
| G1 | `isPlainObject` (and `isObject` in two modules) | audit.js:17, caps.js:106, events.js:60, graph/client.js:53, guard.js:21, poller.js:69, service.js:96, state.js:21, tools.js:15 (strict form), webhooks.js:20, config.js:74 (`isObject`), unofficial/sidecar.js:26 (`isObject`). 12 copies | Merged into `src/util/object.js`. Strict form kept (section 3). |
| G2 | `isState` | caps.js:110, events.js:95, guard.js:25 | Merged into `src/util/object.js`. |
| G3 | `clockMs` | caps.js:116, events.js:101 | Merged into `src/util/clock.js`. |
| G4 | `defaultSleep` | graph/client.js:30, graph/endpoints/media.js:34 | Merged into `src/util/clock.js`. |
| G5 | Longest timer constant 2147483647 | MAX_TIMER_MS: graph/endpoints/media.js:19, poller.js:40, token.js:14 (exported). MAX_TIMEOUT_MS: mcp.js:28, unofficial/sidecar.js:9 | Merged into `src/util/clock.js`. token.js still exports `MAX_TIMER_MS`. |
| G6 | `isoOf` | poller.js:116, service.js:99 | Merged into `src/util/time.js`. |
| G7 | Clock alias `const clock = () => now()` | service.js:318 | Removed; the calls use `now()` directly (same value; `now` is the createService parameter and is not shadowed). |
| G8 | `checkGraphId` (pass-through to `checkId`) | service.js:103 | Removed; the 16 call sites use `checkId` (same function). |
| G9 | `STOP_KINDS_LIST` (alias of `STOP_KINDS`) | stops.js:6 | Inlined into `STOP_KINDS` (same frozen array). |
| G10 | Event cursor keys `events.issued`, `events.acked`, `events.lastSeq` | state.js:12-14, events.js:42-44, guard.js:16 (`EVENTS_LAST_SEQ`) | Merged into `src/util/state-keys.js` (`ISSUED_KEY`, `ACKED_KEY`, `LAST_SEQ_KEY`). |
| G11 | Stop key `stop` | state.js:10 (`STOP`), guard.js:14 (`STOP_KEY`) | Merged into `src/util/state-keys.js` (`STOP_KEY`). |
| G12 | Account stop kinds (AUTH_EXPIRED, ACTION_BLOCKED, CHECKPOINT, RATE_LIMITED) | guard.js:18 (`SHOULD_STOP`), poller.js:49 (`STOP_ERRORS`) | Merged into `ACCOUNT_STOP_KINDS` in src/errors.js (new export). |
| G13 | `MAX_FUTURE_MS` (5 minutes) | events.js:31 (exported), webhooks.js:14 | Merged into `src/util/time.js`. events.js re-exports it. |
| G14 | Last instant of year 9999 | graph/endpoints/messaging.js:25 (`MAX_TIME_MS`), webhooks.js:16 (`MAX_EVENT_MS`) | Merged into `MAX_EVENT_MS` in `src/util/time.js`. |
| G15 | Unix seconds/milliseconds threshold 1e12 | messaging.js:27, webhooks.js:52 | Merged into `src/util/time.js`. |
| G16 | Graph time reader: `webhookTimeIso` (webhooks.js:62) and `graphTimeIso` (messaging.js:88), with `unixMsOf` (webhooks.js:55), `unixMs` (messaging.js:78), `WEBHOOK_ISO` (webhooks.js:50) and `TIME_PATTERN` (messaging.js:34), `WEBHOOK_NUMERIC` (webhooks.js:51) and `NUMERIC_TIME_PATTERN` (messaging.js:28). 8 definitions | Merged into `graphTimeMs` and `graphTimeIsoOrNull` in `src/util/time.js`. `graphTimeIso` in messaging.js stays as a thin wrapper that throws API_ERROR. `ISO_WITH_ZONE` is shared with messaging's window parser. |
| G17 | Constant-time text compare: `sameText` (webhooks.js:83), `sameText` (oauth.js:189), `tokenMatches` (http.js:220, same digest compare plus a null/empty guard) | 3 | Merged into `sameText` in `src/util/compare.js`. `tokenMatches` keeps its guard and calls `sameText`. |

Total: 57 copies in 17 groups.

Not a duplicate, but in the same list: the HTTP-only error kinds (Task 15 M-12). They were literals in src/http.js only. They are now named once in `HTTP_ERROR_KINDS` in src/errors.js, and a test links them (section 6).

## 2. Where each one went

- `src/util/object.js`: `isPlainObject` (strict form), `isState`.
- `src/util/clock.js`: `clockMs`, `defaultSleep`, `MAX_TIMER_MS`.
- `src/util/time.js`: `MAX_EVENT_MS`, `MAX_FUTURE_MS`, `ISO_WITH_ZONE`, `graphTimeMs`, `graphTimeIsoOrNull`, `isoOf`.
- `src/util/compare.js`: `sameText`.
- `src/util/state-keys.js`: `STOP_KEY`, `ISSUED_KEY`, `ACKED_KEY`, `LAST_SEQ_KEY`.
- `src/errors.js` (existing module, two new exports): `ACCOUNT_STOP_KINDS`, `HTTP_ERROR_KINDS`.

Existing exports are kept. `events.js` still exports `MAX_FUTURE_MS`, and `token.js` still exports `MAX_TIMER_MS`, both as re-exports. `http.js` still exports `MAX_BODY_BYTES`. A check of the export names of every module before and after found no export removed or renamed.

## 3. Copies that differed, and what was kept

1. `isPlainObject`: `tools.js` checks the prototype (a plain object has `Object.prototype` or no prototype). The other 11 copies accept any non-null, non-array object. The stricter form (tools.js) is kept.
   - Effect: a programmer-supplied class instance, Date or Map that reached one of the 11 checks is now refused. JSON-parsed input, config files, object literals and Node's request headers are unchanged. Node's `req.headers` has `Object.prototype` (checked on this Node version), so the webhook signature lookup is unaffected.
   - No test passes such an object.

2. Graph time reader: `webhookTimeIso` and `graphTimeIso` read the same forms and give the same instant for every accepted form. They differ in one place: `webhookTimeIso` refuses an ISO time later than 9999-12-31T23:59:59.999Z, and `graphTimeIso` did not check that bound for ISO strings. The stricter rule (with the bound) is kept.
   - Effect, one edge only: the messaging endpoint now refuses an ISO time with a zone that falls after the year 9999, for example `9999-12-31T23:00:00-05:00`. It is counted as a malformed row (API_ERROR, skipped and counted), as the webhook already did. Before, it returned the string `+010000-01-01T04:00:00.000Z`.
   - Numbers and in-range ISO times are unchanged. The window checks (`messageWindowOpen`, `privateReplyOpen`) use messaging's `parseTime`, which I did not change.
   - The new test shows the old and new behaviour for this edge (section 6).

3. Forms that differ but behave the same, merged without a choice being needed:
   - `sameText`: webhooks.js passed `'utf8'` to `update()`, oauth.js did not. For strings the default is UTF-8, so the digests are the same.
   - `SHOULD_STOP` and `STOP_ERRORS`: identical sets.
   - `MAX_TIME_MS` and `MAX_EVENT_MS`: identical value.
   - `MAX_TIMEOUT_MS` (mcp.js, sidecar.js) and `MAX_TIMER_MS`: identical value.

## 4. Not merged, and why

- `guard.js` `stopTime`: falls back to the process clock when the clock throws. The contract differs from `clockMs`, which throws.
- `events.js` `parseIsoTime`: similar to the Graph reader, but it accepts only a colon zone (Z or +hh:mm) and any number of fraction digits. The Graph reader also accepts +hhmm. Merging would change what the event log accepts. Flagged for a later decision.
- `token.js` `parseTime` (exact `toISOString` round trip, plain numbers), `poller.js` `parseIso` and `timeOf` (`Date.parse` wrappers): different accepted forms.
- `invalid` (caps.js:123, events.js:65, service.js:97): three identical one-line VALIDATION constructors. Left local, because sharing them would add a third export to errors.js.
- `caps.js:231` `const clock = () => clockMs(now)`: kept. It wraps the validation, so it is not an alias.
- `DAY_MS` and `HOUR_MS` (6 and 3 literal copies), `TOKEN_PATTERN` (3), `TIMEOUT_MS` (client.js and oauth.js, both 15000), `DEFAULT_THREAD_ITEMS` and `MAX_THREAD_ITEMS` (messaging.js and poller.js), `CONVERSATION_PAGE` (poller.js and service.js), `PROJECT_ROOT` (cli.js and service.js), `MAX_LIMIT` (comments.js and media.js), `DEFAULT_LIMIT`: literal constants, not in the categories listed for this pass. Left.
- `MAX_BODY_BYTES`: http.js (1 MiB, exported and used by a test) and graph/client.js (5 MiB). Different values and meaning, so not a duplicate. Task 15 M-7 (the extra export) is left: removing an export is out of scope.
- `deepFreeze` (config.js:13 and tools.js:63): similar, but tools.js also skips frozen values.
- `errorName` (graph/client.js:57 and service.js:118), `stopDetail` (poller.js:92 and service.js:137), `isPreSend` (graph/client.js:41 and service.js:144), `readBody` and `tooLarge` (http.js and oauth.js), `checkText` and `checkLimit` (service.js and messaging.js; comments.js), `parseTime` (messaging.js and token.js): different bodies or different messages. Left, because their messages must not change.
- `refuse` (service.js:98 and unofficial/jslib.js:8): not compared in full. Left.
- Status and kind sets that differ: `HALTING` (poller.js:53), `PAUSE_KINDS` and `READ_STOP_KINDS` (service.js), `RETRY_KINDS` (graph/client.js), `STATUS_FOR_KIND` (http.js), `KIND_MAP` (unofficial/sidecar.js). Each is a different set with a different meaning. Left.
- `busy` in caps.js and `busyResult` in errors.js: different shapes (Task 4 M-6, a behaviour question). Not touched.
- Task 13 M-6 and M-17 (`hashtagSearch` repeating the `runOutbound` logic): a behaviour question (F-2 in the final review), not a helper copy. Not touched.
- Task 10 M-7 says `isText` in webhooks.js duplicates a helper elsewhere. No other `isText` exists in src/, so nothing was merged.
- Task 15 M-8 suggested exporting `sameText` from webhooks.js. I put it in `src/util/compare.js` instead, so no export was added to webhooks.js.

## 5. Concerns for the owner or lead

1. One behaviour change in the time readers, the stricter bound (section 3, item 2). It affects only an ISO time with a zone after the year 9999. Apart from item 2, it is the only change in output for any input.
2. The strict `isPlainObject` refuses a programmer-supplied non-plain object where the loose copies accepted it (section 3, item 1). No input from JSON, config, the HTTP or MCP layer, or a test is affected.
3. Two new exports in `src/errors.js`: `ACCOUNT_STOP_KINDS` and `HTTP_ERROR_KINDS`. No export was removed. These are the only additions to an existing module's export list. Say if you want them elsewhere.
4. The "event-id constants" in the brief were read as the `events.*` cursor keys and the `stop` key (G10 and G11). No literal event-id constant was duplicated.
5. `node --test --experimental-test-coverage` fails one sidecar test (`the child starts on first use, and it is given only the allowlisted variables`, test/sidecar.test.js). It fails the same way on the pre-change code: the coverage run sets `NODE_V8_COVERAGE`, and the test checks that the child does not get it. `npm test` is not affected.
6. Only Node 24.6.0 was used here. Node 22.13.1 was not run.

## 6. Tests

- Added `test/time.test.js`: "the webhook receiver and the messaging endpoint give the same ISO string for one instant in every accepted form". It gives one instant in seven forms (ISO with Z, ISO with +0000, ISO with +02:00, Unix seconds, Unix milliseconds, and numeric strings of each) to `parseEvents` (messaging timestamp and comment created_time) and to `readThread` (created_time). It checks that both return `2026-10-22T10:00:00.000Z`. It then checks the year-9999 edge: both paths refuse it. This edge is the one change in section 3. Against the pre-change code, the equality part passes and the year-9999 part fails on the graph path, which is the change.
- Added one test in `test/http.test.js`: "the HTTP-only error kinds are exactly the ones the HTTP layer sends, and none of them is an IgError kind" (M-12). It drives the handler to each HTTP-only kind (UNAUTHORIZED, FORBIDDEN, NOT_FOUND, METHOD_NOT_ALLOWED, PAYLOAD_TOO_LARGE, INTERNAL) and compares the set with `HTTP_ERROR_KINDS`.
- One import line changed in test/http.test.js (`HTTP_ERROR_KINDS`). No existing test was changed, weakened or removed.

## 7. Checks run

- `npm test` after each module: modules 1 (`isPlainObject`, `isState`), 2 (clock), 3 (time parser and `isoOf`), 4 (compare), 5 (state keys), 6 (error-kind lists), 7 (aliases), then the time test and the HTTP test. All green. The suite was run again at the end: 1161 of 1161.
- A missing import in `src/http.js` during module 4 made 24 tests fail, because the HTTP API caught the ReferenceError and turned it into a 500. It was fixed before the next run. The final run is clean.
- Export names of every module compared with the pre-change copy: none removed (section 2).
- Unused imports and unused top-level declarations: none added. The only flagged names are exports that other modules use.
- A coverage run listed every changed line. All changed lines are executed by the tests except three `checkId(` call sites in service.js (renamed from `checkGraphId`, same function, and not executed before the change either).
- Checksums of every other src and test file match the pre-change snapshot, so no other edit was made during this pass.
- Files changed: 20 in src, plus test/http.test.js. Files added: 5 in src/util, plus test/time.test.js.

Pre-change snapshot: `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\a8-before`.
