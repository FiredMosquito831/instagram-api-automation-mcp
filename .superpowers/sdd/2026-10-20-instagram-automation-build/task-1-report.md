# Task 1 report: package skeleton and configuration

**Status:** DONE_WITH_CONCERNS
**Project:** D:\Projects2\InstagramApi (not a git repository; no commit, per ruling R2)

## Files

| Path | Change |
|---|---|
| `D:\Projects2\InstagramApi\package.json` | new |
| `D:\Projects2\InstagramApi\src\config.js` | new |
| `D:\Projects2\InstagramApi\test\config.test.js` | new |

Diff against the base snapshot (`D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\snap\task-1-base`, which held only CLAUDE.md): only the three paths above are new. `CLAUDE.md` is unchanged. There is no `node_modules`, no lockfile, and no change to docs, reports, research_notes or .superpowers (apart from this report, which the brief asked for).

No packages were installed, so R3's `npm view <pkg> scripts` has nothing to record for this task.

## TDD evidence

### RED: tests written, module absent

Command: `node --test test/config.test.js`, run in `D:\Projects2\InstagramApi`.

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\config.js' imported from D:\Projects2\InstagramApi\test\config.test.js
...
✖ test\config.test.js (319.318ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
EXIT CODE: 1
```

The file failed to load, so no test ran. This is the expected failure.

### GREEN: after package.json and src/config.js

```
✔ defaults match the caps and retention in Global Constraints
✔ owner.accountType must be business, creator or personal
✔ owner.igUserId is required
✔ owner.igUserId must be a string, not a JSON number
✔ environment overrides the file for graph version
✔ the file overrides the defaults and the environment overrides the file
✔ an empty environment value does not override the file
✔ app.id comes from IG_APP_ID and is null when unset
✔ auto-replies, webhooks and unofficial routes are off by default
✔ http binds 127.0.0.1 by default and likes use instagram login by default
✔ DEFAULT_CAPS is exactly the caps in the brief
✔ the default config has exactly the documented shape
✔ each load gets its own copy of the caps
✔ a missing file, invalid JSON or a non-object file is a ConfigError for field file
ℹ tests 14
ℹ pass 14
ℹ fail 0
EXIT CODE: 0
```

### Added after GREEN: prototype guard test

The self-review found that the `__proto__` guard in `merge` had no test. The first version put the key at the top level of the file. It passed against a mutant copy with the guard removed (exit 0). The second merge rebuilds the top-level object by spreading it, which drops the polluted prototype, so that version could not detect the guard's removal. The key now sits under `owner`, where the polluted prototype survives.

Mutant check: a scratch copy at `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\mut`, with the guard line removed from `src\config.js`:

```
✖ file keys that would change a prototype are ignored
  AssertionError [ERR_ASSERTION]: Expected "actual" to be reference-equal to "expected":
    actual: { polluted: true }, expected: {}
ℹ fail 1
```

Project copy with the guard present: 15 of 15 pass.

### Final suite: `npm test`

```
> instagram-automation@0.1.0 test
> node --test test/*.test.js
(15 test lines, all ✔, the same names as the GREEN list plus "file keys that would change a prototype are ignored")
ℹ tests 15
ℹ pass 15
ℹ fail 0
EXIT CODE: 0
```

## Decisions where the brief is silent

- **Package:** name `instagram-automation` (the keyring service name in Global Constraints), version `0.1.0`, `private: true` (the spec excludes npm publishing), `type: module`, `engines.node >=22.12.0`, no `dependencies` field (none yet), and `scripts.test` exactly `node --test test/*.test.js` (R9). Node here is v24.6.0. Node expands the glob itself (Node 21+).
- **File:** `file` is optional. When given, it must be readable JSON whose top level is an object. Otherwise the call throws `ConfigError` with `field === 'file'`.
- **Merge:** plain objects merge key by key. Arrays and scalars replace. A `__proto__` key in a file is ignored.
- **Environment:** only `IG_GRAPH_VERSION` (to `graph.version`) and `IG_APP_ID` (to `app.id`, R7) are read. Empty or blank values are ignored. The brief and the spec name no other environment keys.
- **Validation** runs after the merge. `owner.igUserId` is required and must be a non-blank string; a bare JSON number is rejected because a long id can lose precision. `owner.accountType` must be exactly `business`, `creator` or `personal`.
- **DEFAULT_CAPS** is deep-frozen. Each `loadConfig` call gets its own copy of the caps.
- **Errors** name the field and the reason. They never include the offending value. For files they include only the error code, never the contents (secrets rule).
- **Tests** pass `env` explicitly, so the developer's environment cannot leak in. They write temporary files under `os.tmpdir()` and remove them with `t.after`. No network calls.

## Self-review

- The values in `DEFAULT_CAPS` and in the default config match the brief line for line. Two tests compare the full objects with `deepStrictEqual`.
- Merge order (defaults, then file, then environment) is covered. Environment wins over file, and an empty environment value is ignored.
- Only Node 22.12 features are used: `structuredClone`, optional catch binding, `??`, and `node:` imports.
- Fixed during review: the prototype test (above). A comment said "this large", but the check rejects every number, so the comment now says a JSON number can lose precision. The guard now checks `__proto__` only, because `constructor` and `prototype` cannot change an object's prototype.
- Not validated: numeric ranges (port, intervals). The brief does not ask for them.

## Concerns

1. Only `IG_GRAPH_VERSION` and `IG_APP_ID` are environment overrides. The brief says "the environment" but names no other keys.
2. `owner.igUserId` must be a quoted string in the JSON file. A bare number is rejected by design.
3. `CLAUDE.md` "Current state" still says there is no package.json or tests. It is not in the brief's file list, so it is unchanged.

## Fix round 1: I1 (caps validation)

Requested by the coordinator after the reviewer's Important finding I1: the safety caps accepted null, strings, negatives and unknown keys. Only I1 is addressed. M1, M2 and M3 are deferred and not touched. Totals after the fix: 22 tests, 22 pass. The 15 earlier tests are unchanged. Status for this round: DONE_WITH_CONCERNS.

### What changed

- `D:\Projects2\InstagramApi\src\config.js`: new `validateCaps(caps, shape, path)`. It walks the merged caps against `DEFAULT_CAPS` and throws `ConfigError` with `field` set to `caps.<path>` when:
  - a key is not an own key of the shape (`Object.hasOwn`), for example `caps.minSpacingMS`;
  - a nested cap is not an object, for example `caps.likes: 5`, which would otherwise replace the object silently;
  - a leaf is not an integer >= 0 (`Number.isInteger(v) && v >= 0`), for example `null`, `"abc"`, `-1`, `1.5` or `true`.
  The messages name the field and the rule. They never include the value.
- `D:\Projects2\InstagramApi\src\config.js`: `loadConfig` calls `validateCaps(config.caps, DEFAULT_CAPS, 'caps')` after the merge, following `validateOwner`. No other code changed.
- `D:\Projects2\InstagramApi\test\config.test.js`: seven tests appended. The four requested cases each assert `err.field` through the existing `isConfigError` helper, which checks `instanceof ConfigError` and `err.field`:
  - `caps.minSpacingMs: null is rejected` (field `caps.minSpacingMs`)
  - `caps.dailyTotal: "abc" is rejected` (field `caps.dailyTotal`)
  - `caps.minSpacingMs: -1 is rejected` (field `caps.minSpacingMs`)
  - `a misspelt cap key such as caps.minSpacingMS is rejected` (field `caps.minSpacingMS`)

  Three more, for the same rule. `caps.likes: 5` (field `caps.likes`) covers the object-shape check. `caps.constructor: 5` (field `caps.constructor`) covers `Object.hasOwn`, because an `in` check would accept inherited names. `caps accept whole numbers >= 0, including 0` is a boundary test that passes before and after the fix, as expected.
- No existing test was edited. `package.json` and `CLAUDE.md` are unchanged.

### Covering tests run

**RED, before the fix.** The seven tests were added, and `validateCaps` did not exist yet.

Command: `node --test test/config.test.js`, run in `D:\Projects2\InstagramApi`.

```
✖ caps.minSpacingMs: null is rejected (5.5848ms)
✖ caps.dailyTotal: "abc" is rejected (4.8302ms)
✖ caps.minSpacingMs: -1 is rejected (5.4939ms)
✖ a misspelt cap key such as caps.minSpacingMS is rejected (4.3894ms)
✖ a nested cap must stay an object, so caps.likes: 5 is rejected (4.5826ms)
✖ cap keys must be own keys of the defaults, so caps.constructor is rejected (4.3609ms)
✔ caps accept whole numbers >= 0, including 0 (4.6802ms)
(each failing test reports: AssertionError [ERR_ASSERTION]: Missing expected exception.)
ℹ tests 22
ℹ pass 16
ℹ fail 6
EXIT CODE: 1
```

**GREEN, after the fix.** Command `node --test test/config.test.js`: tests 22, pass 22, fail 0, exit 0.

**Final, full suite.** Command `npm test` (runs `node --test test/*.test.js`). Output, with the per-test timings omitted:

```
> instagram-automation@0.1.0 test
> node --test test/*.test.js

✔ defaults match the caps and retention in Global Constraints
✔ owner.accountType must be business, creator or personal
✔ owner.igUserId is required
✔ owner.igUserId must be a string, not a JSON number
✔ environment overrides the file for graph version
✔ the file overrides the defaults and the environment overrides the file
✔ an empty environment value does not override the file
✔ app.id comes from IG_APP_ID and is null when unset
✔ auto-replies, webhooks and unofficial routes are off by default
✔ http binds 127.0.0.1 by default and likes use instagram login by default
✔ DEFAULT_CAPS is exactly the caps in the brief
✔ the default config has exactly the documented shape
✔ each load gets its own copy of the caps
✔ a missing file, invalid JSON or a non-object file is a ConfigError for field file
✔ file keys that would change a prototype are ignored
✔ caps.minSpacingMs: null is rejected
✔ caps.dailyTotal: "abc" is rejected
✔ caps.minSpacingMs: -1 is rejected
✔ a misspelt cap key such as caps.minSpacingMS is rejected
✔ a nested cap must stay an object, so caps.likes: 5 is rejected
✔ cap keys must be own keys of the defaults, so caps.constructor is rejected
✔ caps accept whole numbers >= 0, including 0
ℹ tests 22
ℹ pass 22
ℹ fail 0
EXIT CODE: 0
```

### Extra check, not a test

Command: `node D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\caps-check.mjs`. It is a throwaway script in the scratchpad, outside the project. It runs nine inputs through `loadConfig`:

```
nestedUnknownKey: ConfigError field=caps.likes.perMinute message="caps.likes.perMinute is not a known cap"
capsIsScalar: ConfigError field=caps message="caps must be an object"
nestedNumericString: ConfigError field=caps.hashtags.perWeek message="caps.hashtags.perWeek must be a whole number >= 0"
floatLeaf: ConfigError field=caps.usageBusyMs message="caps.usageBusyMs must be a whole number >= 0"
booleanLeaf: ConfigError field=caps.minSpacingMs message="caps.minSpacingMs must be a whole number >= 0"
objectReplacesLeaf: ConfigError field=caps.minSpacingMs message="caps.minSpacingMs must be a whole number >= 0"
nullReplacesObject: ConfigError field=caps.likes message="caps.likes must be an object"
validOverride: accepted
aboveHundred: accepted
```

`aboveHundred` is `usageThrottlePercent: 150`. It is accepted because the rule is "integer >= 0" with no upper bound. It is left unchanged, since the coordinator asked for no other changes. See the concerns.

### Self-review of the fix

- The walk runs over the caps, and the merge starts from the defaults, so every default key is always present. No missing-key check is needed.
- `Object.hasOwn` rather than `in` or a truthiness test. The `constructor` test covers it.
- `Number.isInteger` excludes null, strings, booleans, floats, NaN, Infinity and objects. `< 0` excludes negatives.
- Order: `validateOwner` runs first, then `validateCaps`. A config with both errors reports the owner error.
- The default config still passes. Every default leaf is a non-negative integer, and the "exactly the documented shape" test passes.

### Concerns (this round)

1. `usageThrottlePercent` has no upper bound. A value above 100 (for example 150) is accepted, and a percentage threshold above 100 can never be reached, so the usage throttle would never trigger. Say if you want a bound of 100.
2. Three tests beyond the four requested are listed above. Drop them if you want exactly four.
3. M1, M2 and M3 are deferred and untouched, as instructed.

## Amendment: usageThrottlePercent bound (ruling on fix-round concern 1)

The coordinator ruled that `caps.usageThrottlePercent` must be an integer from 1 to 100 inclusive. A percentage above 100 never triggers the usage throttle, so the setting would fail open, the same defect as I1. This resolves concern 1 of the fix round. Only this bound changed. Totals after the amendment: 26 tests, 26 pass.

### What changed

- `D:\Projects2\InstagramApi\src\config.js`: `validateCaps` has one new branch for `caps.usageThrottlePercent`, placed before the generic leaf branch. It requires `Number.isInteger(v) && v >= 1 && v <= 100` and throws `ConfigError('caps.usageThrottlePercent', 'must be a whole number from 1 to 100')`. The generic leaf branch is unchanged and still says "must be a whole number >= 0".
- `D:\Projects2\InstagramApi\src\config.js`: the header comment of `validateCaps` now notes that the usage throttle is 1 to 100, so the comment stays accurate. This is a comment change only.
- `D:\Projects2\InstagramApi\test\config.test.js`: four tests appended.
  - `caps.usageThrottlePercent: 0 is rejected` and `caps.usageThrottlePercent: 101 is rejected` assert `err.field === 'caps.usageThrottlePercent'`.
  - `caps.usageThrottlePercent: 80 is accepted` asserts that the loaded value is 80.
  - `caps.usageThrottlePercent accepts the inclusive bounds 1 and 100` is an addition beyond the three requested cases. It checks both ends of the range.
- No other code changed. No existing test was edited.

### Covering tests run

**RED, before the branch.** The four tests were added. The two rejection tests fail. The two accept tests already pass, as expected for the old code.

Command: `node --test test/config.test.js`, run in `D:\Projects2\InstagramApi`.

```
✖ caps.usageThrottlePercent: 0 is rejected (8.5469ms)
✖ caps.usageThrottlePercent: 101 is rejected (7.3875ms)
✔ caps.usageThrottlePercent: 80 is accepted (8.7419ms)
✔ caps.usageThrottlePercent accepts the inclusive bounds 1 and 100 (17.272ms)
(each failing test reports: AssertionError [ERR_ASSERTION]: Missing expected exception.)
ℹ tests 26
ℹ pass 24
ℹ fail 2
EXIT CODE: 1
```

**GREEN, final file state.** Command `node --test test/config.test.js`: tests 26, pass 26, fail 0, exit 0.

**Final, full suite.** Command `npm test` (runs `node --test test/*.test.js`). Output, with the per-test timings omitted:

```
> instagram-automation@0.1.0 test
> node --test test/*.test.js

✔ defaults match the caps and retention in Global Constraints
✔ owner.accountType must be business, creator or personal
✔ owner.igUserId is required
✔ owner.igUserId must be a string, not a JSON number
✔ environment overrides the file for graph version
✔ the file overrides the defaults and the environment overrides the file
✔ an empty environment value does not override the file
✔ app.id comes from IG_APP_ID and is null when unset
✔ auto-replies, webhooks and unofficial routes are off by default
✔ http binds 127.0.0.1 by default and likes use instagram login by default
✔ DEFAULT_CAPS is exactly the caps in the brief
✔ the default config has exactly the documented shape
✔ each load gets its own copy of the caps
✔ a missing file, invalid JSON or a non-object file is a ConfigError for field file
✔ file keys that would change a prototype are ignored
✔ caps.minSpacingMs: null is rejected
✔ caps.dailyTotal: "abc" is rejected
✔ caps.minSpacingMs: -1 is rejected
✔ a misspelt cap key such as caps.minSpacingMS is rejected
✔ a nested cap must stay an object, so caps.likes: 5 is rejected
✔ cap keys must be own keys of the defaults, so caps.constructor is rejected
✔ caps accept whole numbers >= 0, including 0
✔ caps.usageThrottlePercent: 0 is rejected
✔ caps.usageThrottlePercent: 101 is rejected
✔ caps.usageThrottlePercent: 80 is accepted
✔ caps.usageThrottlePercent accepts the inclusive bounds 1 and 100
ℹ tests 26
ℹ pass 26
ℹ fail 0
EXIT CODE: 0
```

### Self-review of the amendment

- The branch applies only to the exact path `caps.usageThrottlePercent`. Non-integers, 0 and anything above 100 are rejected with that field. 1, 80 and 100 are accepted.
- The default (80) still passes, and the "exactly the documented shape" test still passes.
- The header comment matches the code.

### Concerns (this amendment)

- The inclusive-bounds test (1 and 100) is beyond the three requested cases. Drop it if you want exactly three.
