# Task 1 review: package skeleton and configuration

Inputs: task-1-brief.md, global-constraints.md, progress.md (rulings R2, R3, R7, R9, R12, R13, R14), task-1-report.md, review-task-1.diff, and the project files at the lines cited below. Read-only. No project file was edited, and the suite was not re-run.

## Spec compliance

**Verdict: ✅ Compliant.** No ❌ findings.

Brief and interfaces
- ✅ The three files exist: `package.json`, `src/config.js` (134 lines), `test/config.test.js` (168 lines).
- ✅ `loadConfig({ env, file })` is at src/config.js:128. `ConfigError` with `.field` is at src/config.js:5-11. `DEFAULT_CAPS` is exported and matches the brief line for line (src/config.js:21-34), and test/config.test.js:117-119 pins it.
- ✅ The config shape and defaults match the brief (src/config.js:44-65). The one addition is `app: { id: null }` (src/config.js:47), which R7 requires.
- ✅ The merge order is defaults, then file, then environment (src/config.js:129-131).
- ✅ `owner.igUserId` is required (src/config.js:114-118). `owner.accountType` must be business, creator or personal (src/config.js:123-125).
- ✅ The six brief tests are present at test/config.test.js:43, 50, 60, 75, 103 and 111. The file has 15 `test()` calls, and their names match the report's GREEN list.

Global constraints in scope
- ✅ Engines `>=22.12.0` and `"type": "module"` (package.json:6-9).
- ✅ Caps, retention 30, graph `v26.0` with both login bases, HTTP on `127.0.0.1`, and webhook, auto-reply and unofficial routes off by default (src/config.js:21-34, 48-54, 58, 61-62, 63).
- ✅ No test makes a network call. The test file imports only Node built-ins and the module under test (test/config.test.js:1-6).
- ✅ No secret is read or stored, and no error echoes a value or file contents (src/config.js:87, 93, 95, 118, 121, 124).
- ✅ The package has no dependencies, as the brief says (package.json:1-13).

Ledger rulings
- ✅ R2: no commit. The report shows `npm test` used in place of the commit step. ⚠️ Not re-run, per instructions. The report holds the evidence.
- ✅ R3: no package was installed, so there was nothing to record. No `node_modules` exists in the project root.
- ✅ R7: `app.id` is read from `IG_APP_ID` (src/config.js:41, 47; test/config.test.js:98-101). The app secret is not in config, which is correct.
- ✅ R9: `"test": "node --test test/*.test.js"` (package.json:11).
- ✅ R12 and R13 do not apply to this code.
- ✅ `"private": true` (package.json:4) agrees with the spec's out-of-scope list, "Publishing to npm. Use is local." (spec line 32). The report gives that reason correctly.

Lockfile
- ✅ No `package-lock.json` exists in the project root, in `snap/task-1-base`, or in `snap/task-1-head`. Task 1 should not produce one. The brief has no install step, and the package has no dependencies.
- The diff header's "Lockfile changed: yes" is a false positive. `review.sh:13` runs `cmp -s` on two files that are both absent. That fails, so the script prints "yes". Fix the script to print "no" when neither file exists. The project itself is fine.

Implementer concerns
1. Only `IG_GRAPH_VERSION` and `IG_APP_ID` are read from the environment. ✅ Not a defect. The brief names only the graph version, R7 adds the app id, and the spec names no configuration environment keys. Its only environment-variable references (spec lines 51 and 73) concern credentials.
2. `owner.igUserId` must be a quoted string. ✅ Keep it. Neither the brief nor the spec sets the type. The check is justified: current Instagram user ids are typically 17 digits, and a bare JSON number above 2^53 - 1 (9007199254740991) can lose digits silently. The 17841400000000000 in the tests is above that limit.
3. `CLAUDE.md` is outdated. ✅ Out of scope. The ledger assigns it to Task 18, and it is not counted.

⚠️ Cannot verify from the diff
- ⚠️ TDD order and the `npm test` exit 0 come from the report only. The test names match the file.
- ⚠️ "No change to docs, reports, research_notes or .superpowers" (report line 14). The snapshot excludes those folders by design (R1), so the diff cannot show it.
- ⚠️ Two later-task rules are not enforced here, as expected. Enabling unofficial routes requires the acknowledgement, and config accepts `routes.unofficial.enabled: true` with `acknowledged: false` (src/config.js:54, 130-131). A non-loopback HTTP host requires `api_token`. That token is a secret, so the check belongs in the HTTP task.

## Strengths
- Clear layering: one recursive `merge` and one validation step after it (src/config.js:72-80, 128-134).
- Errors name the field and never echo the value or the file contents (src/config.js:87, 93, 95, 118, 121, 124).
- `DEFAULT_CAPS` is deep-frozen (src/config.js:13-19, 21), and each load clones it (src/config.js:57). test/config.test.js:144-152 checks that one load does not affect the next.
- The `__proto__` guard (src/config.js:75-76) has a test (test/config.test.js:161-168). The implementer checked that test against a mutant (report lines 59-72).
- The igUserId string rule is deliberate and explained in a comment (src/config.js:119-122).
- The tests are hermetic. Env is passed explicitly (test/config.test.js:33-37), temp files are removed (test/config.test.js:26-30), and one test pins the full documented shape (test/config.test.js:121-142).

## Issues

### Critical
None.

### Important

**I1. Safety caps accept null, strings, negatives and unknown keys.** `src/config.js:130` merges the file's `caps` with no check. `loadConfig` (src/config.js:128-134) validates only the owner fields. The report defers numeric checks because the brief does not ask for them (report line 103). I do not accept that for caps, because a bad value here fails open. A focused check against `src/config.js`, with fixtures in `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task1-check.mjs`, showed:
- `caps.minSpacingMs: null` loads as `null`.
- `caps.dailyTotal: "abc"` loads.
- `caps.minSpacingMs: -1` loads.
- A misspelt key, `caps.minSpacingMS: 5000`, loads and adds an unused key. `minSpacingMs` stays at 2000.

Caps are the core safety control (spec line 25, fail-closed; spec line 103, owner-configurable). A gate written as `elapsed < caps.minSpacingMs` never trips when the value is `null`, because `null` coerces to 0. A check such as `count >= caps.dailyTotal` is always false when the value is `"abc"`. The limit then stops applying with no error. The ledger's preflight scan says Task 3's `createState` reads the caps.

Fix: after the merge in `loadConfig`, walk `caps` against `DEFAULT_CAPS`. Reject any key that is not an own key of the default (`Object.hasOwn`), and any leaf that is not an integer `>= 0`, with `ConfigError('caps.<path>', ...)`. Add tests for `null`, `"abc"`, `-1` and a misspelt key, each asserting `err.field`.

### Minor

**M1. A BOM-prefixed JSON file fails with a misleading message.** `src/config.js:85` reads the text, and `src/config.js:91` parses it. A focused check showed that a file starting with U+FEFF throws `ConfigError file is not valid JSON`. Windows tools often write a UTF-8 BOM, and this project runs on Windows. Fix: `text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');`, plus a test.

**M2. igUserId accepts padded and non-numeric strings.** `src/config.js:114-117` accepts `" 1784 "` and `"abc"`. A padded value would reach the API unchanged. Fix: after the existing checks, require `/^\d+$/`. Also change the non-string message at `src/config.js:121`, so that an object or array does not get "quote it in the JSON file".

**M3. Other sections are not type-checked, and unknown keys pass silently.** The merge at `src/config.js:72-80` lets any value replace a default. By reading the code (not run), `autoReply.rules` (src/config.js:63) accepts an object, `http.port` (src/config.js:62) accepts a string, and a misspelt top-level key such as `retentionDay` is kept with no warning. Fix: apply the I1 walker to the whole defaults tree, so each leaf keeps its default's JSON type and unknown keys are rejected. The owner fields keep their own checks, and `app.id` should be a string when set.

## Assessment

**Task quality: Needs fixes.** The brief's requirements, the ledger rulings and the tests are met, and the code is clean. The caps accept null, strings and negatives, so a limit could silently stop applying once Task 3 reads them. I1 is a small change and should land first.

Notes for the controller (not counted as issues):
- The "Lockfile changed: yes" line comes from the `review.sh` bug described above. Fix the script, not the project.
- Carry-forward for the auth task, unverified: if the token exchange returns `user_id` as a bare JSON number, `JSON.parse` rounds it before the igUserId check sees it. I could not confirm the response shape from the diff. The auth task should read that id from the raw text, or make sure it is a string.
- Carry-forward for the consumer of `dataDir`: `src/config.js:59` (`'./data'`) resolves against the process working directory. An MCP client may start the server from another folder, so the consumer should resolve it against the project root.
