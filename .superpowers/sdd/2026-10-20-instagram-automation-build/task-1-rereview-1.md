# Task 1 re-review, fix round 1

Inputs: task-1-brief.md, task-1-report.md (fix round 1 and amendment sections), review-task-1-fix1.diff, and the current src/config.js and test/config.test.js. The project copies match snap/task-1-fix1-head (diff clean). Test results are taken from the report; the suite was not re-run. One focused check was run with a scratch script outside the project (D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\proto-check.mjs). It reads the module and writes only scratch files.

## Finding verdicts

### I1 (Important): caps accept null, strings, negatives and unknown keys

Verdict: ADDRESSED, with one residual edge (Minor-1 below).

- Walk after the merge in loadConfig: ADDRESSED. src/config.js:151 merges the file, 152 merges the env layer, 153 runs validateOwner, 154 runs `validateCaps(config.caps, DEFAULT_CAPS, 'caps')`.
- Unknown keys rejected with Object.hasOwn: ADDRESSED. src/config.js:135 `if (!Object.hasOwn(shape, key)) throw new ConfigError(field, 'is not a known cap');`. The test at test/config.test.js:202-207 (caps.constructor: 5) would fail against an `in` check, so it does discriminate.
- Leaves must be integers >= 0: ADDRESSED. src/config.js:143-145. Nested caps must stay objects: src/config.js:132 and 136-137, covered by test/config.test.js:198-200.
- Field names: ADDRESSED. Every error uses `caps.<path>`. src/config.js:134 builds the path, and 135, 141 and 144 throw with it.
- The four named tests, each asserting err.field through isConfigError (test/config.test.js:39-41):
  - caps.minSpacingMs: null, test/config.test.js:170-175, asserts 'caps.minSpacingMs'. Fails before the fix (report line 139).
  - caps.dailyTotal: "abc", test/config.test.js:177-182, asserts 'caps.dailyTotal'. Report line 140.
  - caps.minSpacingMs: -1, test/config.test.js:184-189, asserts 'caps.minSpacingMs'. Report line 141.
  - caps.minSpacingMS: 5000, test/config.test.js:191-196, asserts 'caps.minSpacingMS'. Report line 142.

Residual (Minor-1): a `__proto__` key under caps is discarded, not rejected. merge() skips the key at src/config.js:76, and the walk runs after the merge (line 154), so the walk never sees it. The key is not an own key of the defaults, so the literal rule "reject any key that is not an own key of the defaults" is not met for this one key. Focused check: `{"owner":{...},"caps":{"__proto__":{"minSpacingMs":1}}}` and `{"owner":{...},"caps":{"__proto__":5}}` both load, with caps.minSpacingMs = 2000. The effective caps do not change. The drop comes from the prototype guard in the original build (test/config.test.js:161-168, owner level), which the fix leaves in place. Controller to rule: either accept the drop as the guard's documented behaviour and add a test that records it, or check the raw file caps for `__proto__` before the merge and reject it.

### Amendment: usageThrottlePercent is an integer from 1 to 100 inclusive

Verdict: ADDRESSED.

- Branch: src/config.js:138-142. Rule `Number.isInteger(v) && v >= 1 && v <= 100`. Error: `caps.usageThrottlePercent must be a whole number from 1 to 100`.
- 0 rejected: src/config.js:140 (0 < 1). test/config.test.js:215-220 asserts field 'caps.usageThrottlePercent'. Report line 242 shows it failing before the branch.
- 101 rejected: src/config.js:140 (101 > 100). test/config.test.js:222-227 asserts the same field. Report line 243.
- 80 accepted: test/config.test.js:229-232 asserts the loaded value is 80. The default 80 also passes the walk. Report line 244 shows it passing before the change, as expected.
- Extra: test/config.test.js:234-239 checks the bounds 1 and 100. It goes beyond the three requested cases and does no harm.
- No conflict with the spec. docs\superpowers\specs\2026-10-20-instagram-cli-design.md:95 gives the threshold only as "80 or more" for the usage header.

## New breakage in the fix diff

- Critical: none.
- Important: none.
- Minor: none introduced by the fix. Minor-1 above is a residual of I1 that the fix's ordering leaves in place. The prototype guard sits outside the diff (src/config.js:72-80), so it predates the fix.
- Nit, not counted: src/config.js:139 explains only the upper bound (above 100). The lower bound of 1 is not explained. The comment is accurate as far as it goes.

Checks that found no breakage:
- Existing tests still hold. The default caps are all integers >= 0, and the default 80 passes the percent branch. `caps accept whole numbers >= 0, including 0` (test/config.test.js:209-213) passes, because 0 is accepted by the generic branch (src/config.js:143). The file-error tests throw in readJsonFile (src/config.js:151) before validateCaps runs.
- The change is confined to the inserted validateCaps (src/config.js:128-147), the call at line 154, and the appended tests. merge, defaults, envLayer, validateOwner and DEFAULT_CAPS are unchanged.
- The walk does not mutate caps or DEFAULT_CAPS. DEFAULT_CAPS stays frozen (src/config.js:13-21), and each load still gets a structuredClone (src/config.js:57).
- Recursion is bounded by the shape of DEFAULT_CAPS, two levels deep. It recurses only where the shape is an object (src/config.js:136-137).
- Error messages name the field and the rule, never the value (src/config.js:135, 141, 144).
- No sample config in the project would now fail. A search for JSON-style `"caps"` found no config files outside snap/.
- The lockfile is unchanged. package.json is not in the diff's file list, so it is unchanged this round.

## Out-of-scope observations

1. Non-cap fields are not type-checked. The fix did not touch these, and the brief asks for no validation of them. The focused check showed `autoReply.enabled: "false"` loads as the string "false" (default at src/config.js:63; merge at 72-80 does no type check). `http.port: -1` and `retentionDays: "abc"` also load. A non-empty string is truthy, so any consumer that tests truthiness would switch on autoReply, webhook or routes.unofficial when a file sets "false". Suggest boolean and integer checks in a later round or in the owning task, using the same ConfigError pattern.
2. M1, M2 and M3 remain deferred per the report (report line 219). Not checked in this round.
3. Per the report (concern 3, line 109), the CLAUDE.md "Current state" section is stale. Not verified here.

## Round verdict

All findings addressed (I1 and the usageThrottlePercent amendment), with no new Critical or Important breakage. No findings remain open.

New issues raised by this review: Critical 0, Important 0, Minor 1. Minor-1 is the `__proto__` edge of I1 (src/config.js:76 and 154). It does not block the round, and it needs the controller's ruling.
