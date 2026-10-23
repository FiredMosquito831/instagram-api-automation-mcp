# Task 12: Unofficial adapters (instagrapi sidecar) - report

Status: DONE_WITH_CONCERNS

Test summary: test/sidecar.test.js 26/26 pass and test/sidecar-python.test.js 17/17 pass after fix round 3 (14 at the first pass); full suite `npm test` exit 0, 477/477 pass, 0 skipped. Section 1 holds the first-pass records. Section 9 holds fix round 1. Section 10 holds fix round 2. Section 11 holds fix round 3.

Environment: Windows 11, Node v24.6.0 (the Node 22.12 run is still a carry-forward to Task 18), Python 3.13.7 (`python`; `python3` is not on PATH). instagrapi was NOT installed (R10).

## 1. TDD evidence

### RED (before any implementation)

The fixture and the test file were written first. The modules did not exist yet. The output below is trimmed to its key lines.

```
$ node --test test/sidecar.test.js
node:internal/modules/esm/resolve:274
    throw new ERR_MODULE_NOT_FOUND(
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\unofficial\adapter.js' imported from D:\Projects2\InstagramApi\test\sidecar.test.js
...
ℹ tests 1
ℹ pass 0
ℹ fail 1
✖ test\sidecar.test.js (340.9791ms)
exit: 1
```

### GREEN (after the Node modules were written)

```
$ node --test test/sidecar.test.js
✔ sidecar call resolves with the response that has the matching id (168.7122ms)
✔ a checkpoint from the sidecar becomes CHECKPOINT (215.7783ms)
✔ sidecar kinds map to IgError kinds, and an unknown kind fails closed (184.9683ms)
✔ timeout kills the child and rejects with UNOFFICIAL_ADAPTER_ERROR (224.5975ms)
✔ a malformed JSON line from the child rejects the pending call with UNOFFICIAL_ADAPTER_ERROR (232.1923ms)
✔ a child exit rejects all pending calls (294.4892ms)
✔ a child that cannot start rejects with UNOFFICIAL_ADAPTER_ERROR (23.0378ms)
✔ the child starts on first use, and IG_ variables are not passed to it (352.29ms)
✔ the adapter methods send the sidecar method names and params (308.9102ms)
✔ calls after close reject with UNOFFICIAL_ADAPTER_ERROR (2.0834ms)
✔ createSidecarAdapter refuses a missing command, bad args and a timeout the timer cannot hold (1.3402ms)
✔ jslib adapter refuses every call with NOT_SUPPORTED (2.7918ms)
✔ registry throws NOT_SUPPORTED for an unmapped feature (1.0714ms)
✔ registry returns the adapter mapped to a feature, and refuses a mapping to an unregistered adapter (1.0532ms)
ℹ tests 14 / pass 14 / fail 0
exit: 0
```

The five tests the brief names are all present. The other nine cover the fail-closed rules in the ledger.

### Full suite, final state

```
$ npm test
ℹ tests 448
ℹ pass 448
ℹ fail 0
exit: 0
```

The count is the 434 from the Task 11 ledger entry, plus the 14 new tests.

## 2. Files changed

All are new. A diff against `snap/task-12-base` shows only these, plus nothing else changed: `package.json`, `package-lock.json` and `CLAUDE.md` are unchanged. No npm package was installed, so `npm view <pkg> scripts` was not needed (R3).

| File | Purpose |
|---|---|
| `src/unofficial/adapter.js` | Adapter shape (JSDoc typedef) and `createAdapterRegistry({ adapters, byFeature })` |
| `src/unofficial/sidecar.js` | `createSidecarAdapter({ command, args, timeoutMs = 20000 })`: JSON-lines child process |
| `src/unofficial/jslib.js` | `createJsLibAdapter()`: every method refuses with NOT_SUPPORTED |
| `sidecar/ig_sidecar.py` | The instagrapi sidecar: the six methods, `map_exception_kind`, the stdio loop |
| `sidecar/requirements.txt` | `instagrapi==3.1.0` |
| `test/sidecar.test.js` | 14 Node tests (no network, no instagrapi) |
| `test/fixtures/fake-sidecar.js` | Stand-in child: echo, reverse, silent, garbage, and the error, exit and env methods |

Design notes on the Node side:
- Each child has its own session object (pending calls, buffer, dead flag). A late exit event from a killed child cannot reject a newer child's calls.
- A malformed JSON line, or a response whose id matches no request, kills the child and rejects every pending call with UNOFFICIAL_ADAPTER_ERROR. The line-oriented stream cannot be trusted after that. A valid response with a bad `ok` field rejects only its own call.
- Sidecar kinds go through a `Map`, so `constructor` or `__proto__` as a kind is UNOFFICIAL_ADAPTER_ERROR, not a prototype lookup.
- The child receives the environment without any `IG_` variable. Passwords and session values travel only on stdin, never in argv or the environment.
- Adapter methods return Promises. The registry's `forFeature` throws synchronously, as the brief says. The jslib adapter's methods, `close` included, return rejected Promises. The brief says every method throws, and a Promise is the only form that works with the async shape. Callers must catch.
- `pid()` is the one extra method on the sidecar adapter. The timeout test uses it to check that the child is gone. The raw `call` method this bullet first described was removed in fix round 1 (section 9), so every request goes through a typed method.

## 3. instagrapi pin

### Choice: `instagrapi==3.1.0`

The brief says to pin the newest release that has the login fix. Source: https://github.com/subzeroid/instagrapi (CHANGELOG.md, fetched from the master branch) and https://pypi.org/pypi/instagrapi/json.

Release timeline around the break:
- 3.0.0 (2026-09-13): the break. "Make `login()` use CAA directly; retain the previous login flow and arguments as `login_legacy()`. Default login does not automatically fall back to legacy login."
- 3.0.3 (2026-09-17): the login fix. CHANGELOG line: "`login()` now follows Instagram's CAA fallback instruction (`CAA_LOGIN_FALLBACK:fallback_triggered`) and completes the legacy accounts flow, so typed failure reasons such as `PleaseWaitFewMinutes` or `BadPassword` surface instead of the generic "CAA login did not return a session" error (#2800)."
- 3.0.7 (2026-09-19): the default app profile moved to the current Android app, "avoiding the server-side 'Your version of Instagram is out of date' login gate reported in #2807".
- 3.0.24 (2026-10-13): CHANGELOG line: "Honor `Client(with_challenge_flow=False)` by propagating the original challenge without automatic resolution or request replay; keep automatic handling enabled by default and custom exception hooks first (#2878)." The sidecar depends on this switch, so any pin below 3.0.24 does not give the fail-closed behaviour the spec requires (per the CHANGELOG).
- 3.1.0 (2026-10-20): the newest release. It contains 3.0.3 and 3.0.24. Its own change is an opt-in HTTP/2 transport ("the existing curl default preserved").

So 3.1.0 is the newest release that has the login fix, and it also has the challenge switch. Wheel: `instagrapi-3.1.0-py3-none-any.whl`, sha256 `fb840b4d18026cb557991b51e2a5a7e4a4f30014eb1565cfdf92606c6de9ef43`, verified against the PyPI digest. The wheel is pure Python. It contains Go source files for the opt-in native transport, which is not used by default.

Concern: 3.1.0 was uploaded on 2026-10-20, one day before this task. If the owner prefers a release with more time in the wild, 3.0.26 (2026-10-17) also has the login fix and the challenge switch. Changing the pin means changing one line in `sidecar/requirements.txt`.

### License: MIT

- PyPI JSON `info.license` is null for the project, and its classifiers list no license. The license is taken from the wheel METADATA: `License-Expression: MIT` and `License-File: LICENSE`.
- The LICENSE file (GitHub master, fetched) reads "MIT License, Copyright (c) 2023-2026 Mark Subzeroid and instagrapi contributors", followed by: "Portions of the realtime MQTT implementation are derived from instagram_mqtt: Copyright (c) 2019 Nerixyz". Task 18's README should keep that second notice.

## 4. Verified against the instagrapi 3.1.0 source (read, not run)

Read from the downloaded wheel as data (`zipfile`, run with `python -I`). The wheel was not installed or executed. The checks:

| Used by the sidecar | Source |
|---|---|
| `Client(with_challenge_flow=False)`: kwargs pass through `Client.__init__` to the mixin, which pops the flag | `instagrapi/__init__.py:114-141`, `mixins/private.py:161` |
| The gate: with the flag off, a ChallengeRequired is re-raised | `mixins/private.py:752-753` |
| `login(username, password, relogin, verification_code)` returns bool; the two-factor code is handled in the same call | `mixins/auth.py:748` |
| `get_settings()`, `set_settings(settings)`; `user_id` is a property read from the cookies, with no request | `mixins/auth.py:1059, 1075, 1136` |
| `account_info()` | `mixins/account.py:56` |
| `account_edit(**data)` | `mixins/account.py:315` |
| `user_follow(user_id: str) -> bool`, `user_unfollow` | `mixins/user.py:1509, 1552` |

Exception classes checked in `exceptions.py`: ClientThrottledError (73), ClientLoginRequired (85), FeedbackRequired (101), SignupSpamError (105, subclass), ChallengeRequired (117), LoginRequired (216), RateLimitError (232), PleaseWaitFewMinutes (248), TwoFactorRequired (392), AccountSuspended (188), SentryBlock (228).

The library prints nothing to stdout from the paths the sidecar uses, and has no StreamHandler on stdout. `DEFAULT_LOGGER` is a plain named logger (`__init__.py:56`). A grep for single-line logger calls that include password, session, cookie or body found none. Multi-line logger calls were not searched.

## 5. Challenge handlers: a deviation that needs a ruling

The brief says the sidecar "leaves any challenge handler unset". The library does not leave them unset. `mixins/private.py:146-148` sets `challenge_code_handler = manual_input_code` and `change_password_handler = manual_change_password` as class defaults. Those call `input()` (`private.py:113`, `:129`), and `input()` would read the JSON protocol stream.

`with_challenge_flow=False` does not cover every path. Here is the chain, which I traced in the source:

`login()` (`auth.py:813`) → `bloks_caa_login` → `bloks_caa_resolve_two_step_verification` (`bloks.py:816`, with no code given) → `challenge_code_or_raised` (`bloks.py:1058`) → `self.challenge_code_handler` (`challenge.py:58`), which is `input()`. The entered code is also printed (`challenge.py:60`).

What the sidecar does instead: `_new_client()` replaces both instance handlers with `refuse_challenge`, which raises instagrapi's `ChallengeRequired`. A login that needs a code then returns kind `challenge`, which the Node side maps to CHECKPOINT, so it is a stop until the owner clears it. Nothing is read from stdin and nothing is printed. The sidecar still never imports the resolver modules. The library's `Client` inherits `ChallengeResolveMixin` (`__init__.py:66`), so the library loads that module itself. The sidecar does not import it.

The wiring was checked with a stub `instagrapi` package in the scratchpad. The stub reproduces the stdin default and the CAA-style call. With no code, `login` returns `challenge` and the stub's default is never reached. With a code, `login` succeeds. The stub checks the sidecar's wiring, not the library. The live phase must confirm the path.

Ruling needed: accept the refusing handlers as the way to meet "any challenge fails closed" and "nothing reads stdin"? Cost if wrong: a challenge that the owner expected to resolve interactively is refused instead. That is the intended behaviour under the spec.

## 6. Error mapping: additions beyond the brief's list

The brief's exact list is kept, and five classes are added: `ClientLoginRequired`, `RateLimitError`, `PleaseWaitFewMinutes`, `SentryBlock` and `AccountSuspended` (the table below). Each one is a stop condition under the global constraints, or the same concept as a listed class under another name. Subclasses are mapped through the class's bases, and the exception chain is followed through `__cause__` and `__context__` (fix round 1, section 9).

| Name | Kind | Why |
|---|---|---|
| `ClientLoginRequired` | auth_expired | Instagram redirected to the login page (`exceptions.py:85`), the same meaning as LoginRequired |
| `RateLimitError` | rate_limited | Raised on `error_type == "rate_limit_error"` (`private.py:591-592`) |
| `PleaseWaitFewMinutes` | rate_limited | Raised on "Please wait a few minutes" (`private.py:557-558`). A judgement call, leaning to the stop |
| `SentryBlock` | action_blocked | Raised on `error_type == "sentry_block"` (`private.py:589-590`) |
| `AccountSuspended` | challenge | Raised from a `challenge_required` response with a `/suspended/` URL (`private.py:579-580`) |

Not mapped, left as api_error: `ProxyAddressIsBlocked` (an IP block; the project adds no proxy). It is not a stop code in the constraints, so it is flagged for the live phase.

## 7. Python checks

From the project root:

```
$ python -m py_compile sidecar/ig_sidecar.py
exit: 0

$ python -c "import sidecar.ig_sidecar as s; print(s.map_exception_kind('ClientThrottledError'))"
rate_limited
```

Import check: `instagrapi` is not in `sys.modules` after the import (False). R10 holds.

`py_compile` writes a `sidecar/__pycache__` folder. It was removed afterwards.

Behaviour checks, beyond the brief (a script kept in the scratchpad, `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\py_behaviour_check.py`): 27 PASS, 0 FAIL. The checks cover:
- `map_exception_kind` by name, and `kind_for_exception` for a subclass.
- The password and session scrub in error messages.
- `status` before login, which makes no request.
- Refusals with no session, for bad input, for an unknown method and for a non-object request.
- A profile field outside the whitelist.
- A login without instagrapi installed, which is api_error and does not crash.
- The real script over stdio. The output had three response lines for two requests: a blank line was skipped and a non-JSON line was answered with bad_request. stderr carried only `INFO status ok` lines.

One bug was found and fixed during these checks: `follow` and `unfollow` checked the session before the `userId`, so a malformed id with no session gave `no_session` instead of `bad_request`. Both now validate first.

## 8. Self-review

I read the diff against the snapshot and the Python file in full.
- Logs: the sidecar logs only method names and kinds. There is no print call. The library's logs go to the same stderr.
- Secrets: the password and the verification code travel only on stdin. The login and restore results carry the session settings. The adapter now registers each session string on receipt (fix round 1, section 9). Task 17 still stores the session in the keyring. Nothing in this task logs it.
- Stop codes: every stop from the global constraints (190, checkpoint, challenge, two-factor, 368 or feedback, 429) reaches a stop kind, through the brief's table or the additions in section 6.
- Fixed during the review: the challenge-handler gap (section 5), the validation order in `follow` and `unfollow`, and the header docstring, which claimed no handler was set.

Known limits:
- The live library calls have not run. instagrapi is not installed (R10). The signatures were checked against the 3.1.0 source. The live phase must check `login`, `set_settings`, `account_info`, `user_follow` and `account_edit`, and the challenge path in section 5.
- Node 22 was not run. Node 24.6.0 was used.
- `restore_session` makes one read to check the session, which is an owner-initiated action, not outbound spam.
- `profile_edit` takes only `biography`, `external_url` and `full_name`. Picture changes need another instagrapi method and are not in this task.
- `sidecar/` has no `__init__.py`. `import sidecar.ig_sidecar` works as a namespace package, and the check above confirmed it.
- The protocol is strictly sequential on the child side, so two concurrent calls are answered in order. The Node side matches responses by id, and the reverse-order test covers that.
- Task 17 chooses the command. A reasonable choice is `python -I sidecar/ig_sidecar.py`, with the `-I` flag so that the environment cannot change the interpreter's search path.
- `ig_sidecar.py` was not run against a real Instagram account. No network call was made anywhere in this task.

## 9. Fix round 1 (coordinator review, task-12-review.md)

Scope: the six items in the coordinator's message. Deferred items M-5, M-6, M-8, M-9, M-10 and M-11 are not changed. instagrapi stays pinned at `==3.1.0`, and `sidecar/requirements.txt` is not changed.

### 9.1 Changes, with file and line

| Item | File and lines (after this round) | Change |
|---|---|---|
| I-1 | `src/unofficial/sidecar.js:115-123` (`handleLine`, the `ok: true` branch) | Resolves only when `isObject(message.result)`. Anything else rejects with `UNOFFICIAL_ADAPTER_ERROR`. The old `message.result ?? null` is gone. |
| M-2 | `src/unofficial/sidecar.js:7` (import of `registerSecret`), `:30-46` (`registerSessionStrings`), `:196-203` (`sessionRequest`), `:214-217` (`login` and `restoreSession` use `sessionRequest`) | Each string in a login or restore result is registered before the promise resolves. The walk is recursive over objects and arrays. Blank strings are skipped. Strings the registry refuses are skipped (see 9.4). |
| M-3 | `src/unofficial/sidecar.js:168-169` (the internal `request`, renamed from `call`), `:214-223` (the returned object has no `call`), `:63-72` (JSDoc) | The raw `call` is removed from the public object. `pid` is kept, because the timeout test uses it. |
| M-7 | `sidecar/ig_sidecar.py:63-92` (`_CHAIN_LIMIT`, `_kind_for_class`, `kind_for_exception`) | `kind_for_exception` walks the exception, then `__cause__` and `__context__`, breadth first. The first stop kind found wins. An `api_error` does not stop the walk. The walk is capped at 32 and skips exceptions it has seen. `map_exception_kind` is name-based, so the chain walk lives in `kind_for_exception`, which takes the exception. |
| M-1 | this report, section 6 | "four classes" corrected to five. The five are named in the section. |
| M-4 and item 6 | `test/sidecar.test.js:61` (the kinds table) | Confirmed. The table already covers an unknown kind (`no_such_kind`, and `constructor`, `__proto__` and the empty kind), each mapping to `UNOFFICIAL_ADAPTER_ERROR`. |
| Fixture | `test/fixtures/fake-sidecar.js` | Modes `error:<kind>`, `reply:<shape>` (none, string, null, object, error-no-object, error-no-kind, ok-not-boolean), `session`, and `exit`. The `env` mode now answers with an object `{ names }`. |

Per-method rule, checked against `sidecar/ig_sidecar.py`. Every method returns a JSON object, and none returns nothing, so one rule covers all six:

| Method | Python reply | Line | Node rule |
|---|---|---|---|
| `login` | `client.get_settings()` (dict) | 131 | object |
| `restore_session` | `client.get_settings()` (dict) | 142 | object |
| `follow` | `{"ok": bool}` | 147 | object |
| `unfollow` | `{"ok": bool}` | 152 | object |
| `profile_edit` | `{"edited": [...]}` | 165 | object |
| `status` | `{"loggedIn": bool}` | 171 | object |

The success reply from `handle_request` is `{"id", "ok": True, "result": result}` (line 233).

### 9.2 Old and new assertions for the changed tests

The raw `call` method was removed, so each existing test that used it now calls a typed method. The brief's test names are kept. The fixture mode carries the reply that the old `call` argument carried.

| Test (line now) | Old | New |
|---|---|---|
| sidecar call resolves with the response that has the matching id (:40) | `adapter.call('echo', { n: 1 })`, `adapter.call('echo', { n: 2 })`, fixture mode `reverse`. `assert.deepEqual(first, { method: 'echo', params: { n: 1 } })` and `assert.deepEqual(second, { method: 'echo', params: { n: 2 } })` | `adapter.status()` and `adapter.follow('42')`, fixture mode `reverse`. `assert.deepEqual(first, { method: 'status', params: {} })` and `assert.deepEqual(second, { method: 'follow', params: { userId: '42' } })` |
| a checkpoint from the sidecar becomes CHECKPOINT (:52) | `adapter.call('error', { kind: 'checkpoint', message: 'checkpoint required' })`, fixture default | `fixtureAdapter('error:checkpoint')` and `adapter.status()`. The assertion `assertKind(..., 'CHECKPOINT')` is unchanged. |
| sidecar kinds map to IgError kinds (:61) | One adapter, `adapter.call('error', { kind: sidecarKind, message: 'refused' })` for each case | One adapter per case, `fixtureAdapter(`error:${sidecarKind}`)` and `adapter.status()`. The table is unchanged. |
| timeout kills the child (:86) | `const pending = adapter.call('echo', {});` | `const pending = adapter.status();` |
| a malformed JSON line (:96) | `adapter.call('echo', {})` | `adapter.status()` |
| a child exit rejects all pending calls (:106) | Fixture default; `adapter.call('exit', {})` and `adapter.call('echo', {})` | `fixtureAdapter('exit')`; `adapter.status()` and `adapter.follow('42')` |
| a child that cannot start (:118) | `adapter.call('status', {})` | `adapter.status()` |
| the child starts on first use (:127) | `const names = await adapter.call('env', {});` then `assert.deepEqual(names, [], ...)` | `fixtureAdapter('env')`; `const { names } = await adapter.status();` then the same `assert.deepEqual(names, [], ...)` |

Unchanged tests: the adapter-method names test (:141), calls after close (:164), the options test (:170), the jslib test (:282) and the two registry tests (:299, :308).

### 9.3 Covering tests, new

| Test (line) | Covers |
|---|---|
| the adapter has no call property, so every request goes through a typed method (:177) | M-3 |
| ok:true with no result rejects with UNOFFICIAL_ADAPTER_ERROR (:187) | I-1, and `login` on the same reply |
| ok:true with a null result rejects with UNOFFICIAL_ADAPTER_ERROR (:197) | I-1 |
| ok:true with a string result rejects with UNOFFICIAL_ADAPTER_ERROR (:206) | I-1 (the coordinator's case) |
| ok:true with an object result resolves (:215) | I-1 (the coordinator's case) |
| ok:false with no error object rejects with UNOFFICIAL_ADAPTER_ERROR (:224) | M-4 |
| ok:false with an error object that has no kind rejects with UNOFFICIAL_ADAPTER_ERROR (:233) | M-4 |
| a reply whose ok is not a boolean rejects with UNOFFICIAL_ADAPTER_ERROR (:242) | M-4 |
| a login reply registers its session strings before the caller sees them (:251) | M-2. The caller reads the session, and `redact` masks the token and the nested strings. A later failure whose message repeats the token carries no copy of it. A short and a blank string do not fail the login. |
| a restore reply registers its session strings too (:271) | M-2, for `restoreSession` |
| sidecar kinds map to IgError kinds, and an unknown kind fails closed (:61) | M-4 item 6, existing |

### 9.4 Known limits in this round

- A session string shorter than 8 characters, or inside `[redacted]`, cannot be registered. `registerSecret` refuses it, and the adapter skips it so the login still succeeds. Such a string is not masked by the registry. Tokens and cookies are long, so the practical risk is low, but the limit is real.
- The chain walk makes a stop more likely. A stop class that is only the `__context__` of an unrelated generic error now stops outbound actions. That is the fail-closed direction. The live phase should check how often it fires.
- The coordinator's example, a `ChallengeRequired` with a generic `__cause__`, has the stop class on top, so the old MRO-only walk also gave `challenge` for it. The case the old walk missed is the reverse. Both are recorded in 9.5.

### 9.5 Python checks, recorded

```
$ python -m py_compile sidecar/ig_sidecar.py
exit: 0

$ python -c "import sidecar.ig_sidecar as s; print(s.map_exception_kind('ClientThrottledError'))"
rate_limited

$ python -I chain_check.py   (scratchpad: D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\chain_check.py)
PASS ChallengeRequired with __cause__ = Exception -> challenge (want challenge)
PASS Exception with no chain -> api_error (want api_error)
PASS Exception with __cause__ = ChallengeRequired -> challenge (want challenge)
PASS RuntimeError with __context__ = ClientThrottledError -> rate_limited (want rate_limited)
PASS Exception -> RuntimeError -> FeedbackRequired -> action_blocked (want action_blocked)
PASS Exception with __cause__ = SignupSpamError -> action_blocked (want action_blocked)
PASS cause (challenge) and context (rate limit) both set -> challenge (want challenge)
PASS self-referencing __context__ -> api_error (want api_error)
PASS ClientThrottledError alone -> rate_limited (want rate_limited)
exit: 0

$ python -c "...print(s._kind_for_class(Exception))"   (the old MRO-only walk, for a generic Exception with a stop cause)
api_error
```

The named cases are the first two lines of the check. The third line, `Exception with __cause__ = ChallengeRequired`, is the one the MRO-only walk got wrong. Before this round it gave `api_error`. The cases are stand-ins with instagrapi's class names, because instagrapi is not installed (R10). The check is a recorded step, not a repo test, so M-11 stays deferred.

The behaviour checks from section 7 were run again: 27 PASS, 0 FAIL.

### 9.6 npm test

```
$ npm test
ℹ tests 458
ℹ pass 458
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
exit: 0
```

The count is 448 from section 1, plus the 10 new sidecar tests. The sidecar file alone is 24 of 24.

### 9.7 Mutation check

The new tests were run against two scratch copies of `src` and `test`, with the project files untouched.

- Mutant a: the old `pending.resolve(message.result ?? null)` put back. Three tests fail: ok:true with no result, with a null result, and with a string result. The object-result test passes.
- Mutant b: session registration removed. Two tests fail: the login registration test and the restore registration test.

The tests catch the old behaviour in both cases.

## 10. Fix round 2 (re-review, task-12-rereview-1.md)

Scope: N-1 to N-4 only. The deferred items M-5, M-6, M-8, M-9, M-10 and M-11, and the 8-character session rule, are not changed. instagrapi stays `==3.1.0`.

### 10.1 Changes, with file and line

| Item | File and lines (after this round) | Change |
|---|---|---|
| N-1 | `sidecar/ig_sidecar.py:77-96` (`kind_for_exception`) | The cap `_CHAIN_LIMIT` and its loop bound are removed. The seen set alone guarantees termination: each exception is added once, and only an unseen exception adds children. |
| N-2 | `sidecar/ig_sidecar.py:63-65` (`_SEVERITY`, `_SEVERITY_RANK`, and a one-line comment that names STOP_RANK in `src/guard.js`), `:77-96` (`kind_for_exception`) | The walk visits the whole chain and keeps the most severe stop kind, not the first. The order is challenge, checkpoint, two_factor, auth_expired, action_blocked, rate_limited. Ranks as given: 3 for the checkpoint group, auth_expired and action_blocked, and 2 for rate_limited. Within rank 3 the listed order decides. That tie-break is a choice made here, see 10.7. |
| N-3 | `src/unofficial/sidecar.js:30-42` (`prepareSession`) | Each string is trimmed before it is registered, and the trimmed value is registered and returned. A value that is blank after trimming is not registered and comes back as `''`. The approach matches Task 9 (`src/secrets.js:88-89` and `:103`). |
| N-4 | `src/unofficial/sidecar.js:57-63` (`registerSessionText`) | A registration failure that is not a VALIDATION IgError becomes `IgError('UNOFFICIAL_ADAPTER_ERROR', ...)`, with a fixed message that does not include the value. A VALIDATION refusal is still skipped. |
| (supporting) | `src/unofficial/sidecar.js:214-215` (`sessionRequest`) | The call is `request(method, params).then(prepareSession)`. The copy that `prepareSession` builds is what the caller gets. A rejection passes through, so no session is returned on a failure. |
| (supporting) | `test/fixtures/fake-sidecar.js:26`, `:63`, `:71-72` | `PADDED_TOKEN`, a `padded` field in the session object (`${PADDED_TOKEN}\n`), and a `surrogate` mode whose session string holds a lone surrogate. |

### 10.2 Old and new assertions for changed tests

No existing test assertion was changed. The fixture's session object gained a `padded` field, which no existing assertion reads. The existing login and restore assertions (`settings.sessionid`, `settings.short`, and the `redact` checks) still hold on the copy that `prepareSession` returns.

### 10.3 Covering tests

Node, `test/sidecar.test.js`:
- `a session string with a trailing newline is returned trimmed, and its bare value is masked` (:283), for N-3. It asserts `settings.padded` equals `PADDED_TOKEN` (the old value was `PADDED_TOKEN + "\n"`), and that `redact` of the bare token does not contain it.
- `a session string that cannot be registered rejects with UNOFFICIAL_ADAPTER_ERROR, and no session is returned` (:294), for N-4. It asserts that login rejects with an IgError of kind UNOFFICIAL_ADAPTER_ERROR, and that the message does not contain the surrogate string.

Python, `chain_check2.py` (output in 10.4):
- N-2: `ClientThrottledError` raised from `ChallengeRequired` gives challenge. `ClientThrottledError` raised from `LoginRequired` gives auth_expired. `LoginRequired` raised from `ChallengeRequired` gives challenge. `ChallengeRequired` raised from `ClientThrottledError` gives challenge.
- N-2, no stop: a generic chain gives api_error.
- N-1: 40 generic exceptions over a `ChallengeRequired` give challenge.
- Termination: a two-cycle through `__cause__` and `__context__` gives api_error.

### 10.4 Python check output

```
$ python -m py_compile sidecar/ig_sidecar.py
exit: 0

$ python -c "import sidecar.ig_sidecar as s; print(s.map_exception_kind('ClientThrottledError'))"
rate_limited

$ python -I chain_check2.py   (scratchpad: D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\chain_check2.py)
PASS ClientThrottledError raised from ChallengeRequired -> challenge (want challenge)
PASS ChallengeRequired raised from ClientThrottledError -> challenge (want challenge)
PASS ClientThrottledError raised from LoginRequired (rank 3 beats rank 2) -> auth_expired (want auth_expired)
PASS LoginRequired raised from ChallengeRequired (order within rank 3) -> challenge (want challenge)
PASS generic chain with no stop -> api_error (want api_error)
PASS 40 generic exceptions over a ChallengeRequired -> challenge (want challenge)
PASS two-cycle through __cause__ and __context__ -> api_error (want api_error)
PASS ChallengeRequired with __cause__ = Exception -> challenge (want challenge)
PASS Exception with no chain -> api_error (want api_error)
PASS Exception with __cause__ = ChallengeRequired -> challenge (want challenge)
failures: 0
exit: 0
```

The round 1 cases (`chain_check.py`) were run again: 9 PASS, 0 FAIL. The behaviour checks from section 7 were run again: 27 PASS, 0 FAIL.

### 10.5 Mutation checks

- Python: the round 1 walk (cap of 32, first stop found) was put back into a scratch copy. Four of the ten cases fail: `ClientThrottledError` from `ChallengeRequired` (gives rate_limited), `ClientThrottledError` from `LoginRequired` (gives rate_limited), `LoginRequired` from `ChallengeRequired` (gives auth_expired), and the 40-deep chain (gives api_error). The coordinator's example, `ChallengeRequired` raised from `ClientThrottledError`, passes under the old walk too, because the top exception is already the most severe.
- Node, mutant c: the raw registration error re-thrown instead of IgError. The N-4 test fails.
- Node, mutant d: no trimming. The N-3 test fails.

### 10.6 npm test

```
$ npm test
ℹ tests 460
ℹ pass 460
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
exit: 0
```

The sidecar file alone is 26 of 26. The count is 458 from section 9, plus the two new Node tests.

### 10.7 Decisions and known limits

- Tie-break within rank 3. The coordinator's message gave the checkpoint group, auth_expired and action_blocked the same rank. I broke the tie with the listed order. So a chain with an auth_expired and a challenge reports challenge. Both halt outbound actions. The owner sees CHECKPOINT, not AUTH_EXPIRED. The guard keeps the first record at equal rank, so this tie-break is the sidecar's only rule.
- Lone surrogate. `registerSecret` adds the value to the registry before `encodeURIComponent` throws (`src/redact.js:188-189`). That is pre-existing Task 2 code, and it is not changed here. The value stays registered, which masks it, so the effect is harmless.
- Blank session strings come back as `''`, not as whitespace, because the copy is trimmed. Nothing reads them.

## 11. Fix round 3 (focused re-review, task-12-rereview-2.md, M-1)

Scope: the one open item. The chain walk had no committed test; its cases lived only in the scratchpad. Nothing else changed. `package.json` keeps `"test": "node --test test/*.test.js"`. instagrapi stays `==3.1.0`.

### 11.1 Change

- New file: `test/sidecar-python.test.js`. No other file changed. A `find -newer` check against the re-review file lists only this file.

What the file does:
- It finds Python with `spawnSync` and a fixed argument array, with no shell. It tries `python --version`, then `py -3 --version`. A probe that fails or times out does not count. A timeout of 10000 ms applies to every spawn.
- If no Python is found, all 17 tests are skipped with `skip: python not found on PATH`. Nothing fails.
- With Python, it runs one child: `python -I -B -c <script> <project root>`. The script inserts the project root on `sys.path`, imports `sidecar.ig_sidecar`, builds the chain cases from stand-in exception classes that carry instagrapi's names, calls `kind_for_exception` on each case, and prints one JSON object. The run is cached, so the script runs once.
- It does not import instagrapi. One test asserts `"instagrapi" in sys.modules` is false after the import.
- `-B` is given on the command line. `-I` ignores `PYTHON*` environment variables, so `PYTHONDONTWRITEBYTECODE` set in the environment had no effect. The first run wrote `sidecar/__pycache__`, which was removed, and the flag was changed to `-B`.

Note on the function under test: the coordinator's wording says "map_exception_kind on the chain cases". `map_exception_kind` takes a class name, not an exception. The chain walk is `kind_for_exception`, which calls `map_exception_kind` for each class. So the chain cases call `kind_for_exception`, and the names test calls `map_exception_kind` directly.

### 11.2 Cases

Fifteen chain cases, each asserting the expected kind:

| Test | Expected | Source |
|---|---|---|
| ClientThrottledError raised from ChallengeRequired | challenge | N-2, report 10.5 (the old walk gives rate_limited) |
| ChallengeRequired raised from ClientThrottledError | challenge | N-2, the coordinator's example (the old walk also passes) |
| ClientThrottledError raised from LoginRequired | auth_expired | N-2, report 10.5 (old gives rate_limited) |
| LoginRequired raised from ChallengeRequired | challenge | N-2, report 10.5 (old gives auth_expired) |
| a generic chain with no stop | api_error | N-2 |
| 40 generic exceptions over a ChallengeRequired | challenge | N-1, report 10.5 (old gives api_error) |
| a two-cycle through __cause__ and __context__ | api_error | termination, report 10.4 |
| ChallengeRequired with a generic __cause__ | challenge | round 1 |
| a plain Exception with no chain | api_error | round 1 |
| a generic Exception with __cause__ ChallengeRequired | challenge | round 1 |
| RuntimeError with __context__ ClientThrottledError | rate_limited | round 1 |
| generic, then RuntimeError, then FeedbackRequired | action_blocked | round 1 |
| a generic Exception with __cause__ SignupSpamError | action_blocked | round 1 (subclass) |
| a challenge cause with a rate-limit context | challenge | round 1 (cause before context) |
| ClientThrottledError alone | rate_limited | round 1 |

Plus two more tests:
- `python names: map_exception_kind maps the class names as the brief says`: `ClientThrottledError` gives rate_limited, `ChallengeRequired` gives challenge, `LoginRequired` gives auth_expired, `Exception` gives api_error.
- `python import: the sidecar module loads without importing instagrapi`.

### 11.3 Output, with python present

```
$ node --test test/sidecar-python.test.js
✔ python chain: ClientThrottledError raised from ChallengeRequired maps to challenge
✔ python chain: ChallengeRequired raised from ClientThrottledError maps to challenge
✔ python chain: ClientThrottledError raised from LoginRequired maps to auth_expired
✔ python chain: LoginRequired raised from ChallengeRequired maps to challenge
✔ python chain: a generic chain with no stop maps to api_error
✔ python chain: 40 generic exceptions over a ChallengeRequired maps to challenge
✔ python chain: a two-cycle through __cause__ and __context__ maps to api_error
✔ python chain: ChallengeRequired with a generic __cause__ maps to challenge
✔ python chain: a plain Exception with no chain maps to api_error
✔ python chain: a generic Exception with __cause__ ChallengeRequired maps to challenge
✔ python chain: RuntimeError with __context__ ClientThrottledError maps to rate_limited
✔ python chain: generic, then RuntimeError, then FeedbackRequired maps to action_blocked
✔ python chain: a generic Exception with __cause__ SignupSpamError maps to action_blocked
✔ python chain: a challenge cause with a rate-limit context maps to challenge
✔ python chain: ClientThrottledError alone maps to rate_limited
✔ python names: map_exception_kind maps the class names as the brief says
✔ python import: the sidecar module loads without importing instagrapi
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
exit: 0
```

### 11.4 Output, with no Python on PATH

```
$ env PATH=/usr/bin:/bin node --test test/sidecar-python.test.js
﹣ python chain: ... # skip: python not found on PATH        (all 17 lines)
ℹ tests 17
ℹ pass 0
ℹ fail 0
ℹ skipped 17
exit: 0
```

### 11.5 The new tests against the round 1 walk

The round 1 walk (cap of 32, first stop found) was put back into a scratch copy of `sidecar/ig_sidecar.py`. Four tests fail, which are the four cases the report named:

```
✖ python chain: 40 generic exceptions over a ChallengeRequired maps to challenge
✖ python chain: ClientThrottledError raised from ChallengeRequired maps to challenge
✖ python chain: ClientThrottledError raised from LoginRequired maps to auth_expired
✖ python chain: LoginRequired raised from ChallengeRequired maps to challenge
ℹ fail 4
ℹ pass 13
```

### 11.6 npm test

```
$ npm test
ℹ tests 477
ℹ pass 477
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
exit: 0
```

The count is 460 from section 10, plus the 17 new tests. Nothing was skipped, because Python is on PATH here (Python 3.13.7, run as `python`).

## Final round (2026-10-23)

Scope: the two required items from the final whole-branch review 2 (`final-review-2.md`): S-L1 (section 1.1), and the adapter login and restore path (section 1.5, which found that no production code calls the adapter's login). Nothing else is changed. The Python sidecar's behaviour, the pinned version (`instagrapi==3.1.0`, `sidecar/requirements.txt` untouched), and the challenge handlers (O-9) are unchanged.

Other work changed `src/cli.js`, `bin/ig.js` and `src/config.js` during this round (`assertServeHost` gained `allowRemote`, and `status` gained a refusal). Every edit here was made to exact text in those files, and the other changes are kept.

### 12.1 Changes, with file and line

S-L1 (`src/unofficial/sidecar.js`):
- `:112-115` `lastStderrLine` redacts the whole line, then cuts it to 200 characters. It was cut first.
- `:213-215` the child's teardown moves from `'exit'` to `'close'`. `'close'` comes after the stdio streams have ended, so the stderr is complete when the diagnostic is read. On `'exit'` a last chunk may still be on its way.
- `:177-179` an error from the sidecar keeps its sidecar kind in `details.sidecarKind`. The login uses it to tell a two-factor request from a checkpoint.
- `:46` `prepareSession` is exported. The restore path uses it, so the stored session strings are registered before they are sent.

Login and restore (new file `src/unofficial-session.js`, 144 lines):
- `sidecarCommand` (command and script path). `IG_PYTHON` overrides `routes.unofficial.python`. The script path is under the project root.
- `unofficialRouteStop(state)` reads the stop of the unofficial route from state key `routes.unofficial.stop`. A stored value that cannot be read still stops the route (fail closed).
- `registerPassword` registers the password with the redaction registry before any use. A password the registry cannot hold (under 8 characters) is refused before it is sent.
- `storeUnofficialLogin` stores `unofficial_session` (the session, as JSON) and `unofficial_username` (as JSON `{"username":...}`, so the entry meets the 8-character minimum of the registry) in the keyring. It clears the route stop and saves it. If a step fails, the entries written so far are put back, or removed when there was none.
- `restoreUnofficialSession` runs at serve start, when the route is acknowledged and a session is stored. A session that cannot be read, or a restore the sidecar refuses, sets the route stop (`AUTH_EXPIRED`, with a detail that names the error kind). A restore that succeeds clears the stop.

`src/cli.js`:
- `:43-50` imports from the new module.
- `:504-516` `createLineSource`: the lines of a stream that is not a terminal, read in order. A missing line is `''`.
- `:520-523` `unofficialLoginFailure`: the sidecar's message, with the nothing-stored note.
- `:529-572` `runRoutesLoginUnofficial`: refuses without the acknowledgement (before any prompt), refuses while a serve holds the lock, reads the username and the password, registers the password, calls the adapter's login, asks for the two-factor code only when the sidecar's kind is `two_factor` (then logs in once more with it), stores the result, audits one line (action and outcome only), and releases the lock in every case.
- `:949` `buildServe` takes `makeSidecar` (default `createSidecarAdapter`), so tests inject a fake.
- `:997-1003` the sidecar is created from `sidecarCommand`, with the config's command and the script under the project root.
- `:1003-1011` the restore runs before the service is built, so the route stop is in state when the service first checks it.
- `:1102` `buildServe` returns `unofficialRestore`.
- `:1202-1204` `runServe` tells the owner to run `ig routes login-unofficial` again after a failed restore.

`src/service.js`:
- `:53` import of `unofficialRouteStop`.
- `:440-448` `assertRoute`, for an unofficial feature: after the enabled and acknowledged check, a stop of the unofficial route throws `STOPPED` with details `{ kind, route: 'unofficial', since }`. This check runs before the caps are recorded, so a refused call costs no slot. The account stop and the official routes are not checked here.

`src/config.js`:
- `:58` `routes.unofficial.python`, default `'python'`.
- `:237` validated as text.

`bin/ig.js`:
- `:13-35` imports.
- `:68-90` `unofficialLoginPrompts` (a visible username and hidden password and code on a terminal; the piped lines otherwise) and `readVisibleLine`.
- `:238-266` the command `ig routes login-unofficial`. It loads the config, creates the state, the audit and the secrets, creates the sidecar adapter, runs the login, and closes the adapter in `finally`.

### 12.2 Old and new assertions for changed tests

- `test/config.test.js:132`, the default `routes.unofficial` object. Old: `{ enabled: false, acknowledged: false, adapterByFeature: {} }`. New: the same with `python: 'python'`. This is the only change to an existing assertion.
- `test/sidecar.test.js:8`, the import. Old: `import { redact } from '../src/redact.js';`. New: `import { redact, registerSecret } from '../src/redact.js';`. No existing test changed.
- `test/fixtures/fake-sidecar.js`: the `stderr:<line>` mode was added (header line 8, handler lines 104-107). Other modes are unchanged.

### 12.3 Covering tests

`test/sidecar.test.js` (2 new):
- `a registered value that straddles character 200 of the last stderr line is masked whole (S-L1)` (line 402). The secret starts at character 180 and runs past 200. The message holds no part of it.
- `an error from the sidecar keeps its sidecar kind in the details, so a two-factor request can be told apart` (line 419).

`test/unofficial-session.test.js` (21 new, no child process, no socket, no network, the Python sidecar never started):
- Login: refuses without the acknowledgement, with no prompt and no login. Refuses while a serve holds the lock, before any prompt. A password is never in any output, and the login stores the session and the username under their names. A login that fails with the password in its message prints none of it and stores nothing. The session is stored under `unofficial_session`, and no file of the data directory holds it (the session, the cookie or the password). A successful login clears a route stop. A two-factor request asks once and logs in with the code. A checkpoint that is not two-factor stores nothing and asks for no code. A password under 8 characters is refused before it is sent. A failed keyring write puts the previous session back, and removes the new username.
- Piped input and registration: `registerPassword` refuses a short password, and the piped lines come in order.
- Serve: restores the stored session with the stored object. Does not restore when the route is not acknowledged, and does nothing when no session is stored. A failed restore stops only the unofficial route: the account stop is not set, `assertNotStopped` does not throw, `follow` is refused with `STOPPED` and details `kind: AUTH_EXPIRED`, no follow reaches the sidecar, and `tokenStatus` still answers. A successful restore clears a stop, and `follow` is no longer refused for it. A stored session that cannot be read sets the stop and sends no restore. A stop value that cannot be read still stops the route. The sidecar command comes from the config, `IG_PYTHON` overrides it, and the script is under the project root. `runServe` tells the owner to run login-unofficial again after a failed restore.

### 12.4 npm test output

Node 24.6.0 (`node --version` printed `v24.6.0`):
```
$ npm test
ℹ tests 1193
ℹ pass 1193
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
exit: 0
```

Node 22.13.1 (the standalone binary at `%USERPROFILE%\AppData\Local\ms-playwright-go\1.50.1\node.exe` put first on PATH, as in `task-18-report.md`; `node --version` printed `v22.13.1`). Node 22 writes TAP to a non-terminal, so the summary is in TAP form:
```
$ npm test
# tests 1193
# pass 1193
# fail 0
# cancelled 0
# skipped 0
exit: 0
```

The count was 1167 at the start of this round (a baseline `npm test` on Node 24.6.0, exit 0). It is 1193 now. Of the 26 added, 23 are in this round (2 in `sidecar.test.js`, 21 in `unofficial-session.test.js`). The other 3 were added to the tree by other work during this round. I did not check them one by one.

### 12.5 Mutation and smoke checks

- S-L1: the old order (cut, then redact) in a scratch copy. The S-L1 test fails.
- Route stop check removed in a scratch copy: `a failed restore stops only the unofficial route...` fails.
- Password registration removed: `a login that fails with the password in its message...` and `a password under 8 characters...` fail.
- Acknowledgement check removed: `routes login-unofficial refuses without the acknowledgement...` fails.
- Real CLI, with no acknowledgement and a piped input: `node bin/ig.js --config <scratch> routes login-unofficial` prints `ig: the unofficial routes are not acknowledged; run ig routes ack-unofficial --confirm first`, exits 1, and creates no file in the data directory. Nothing was read from the input, and no sidecar was started.

### 12.6 Decisions and known limits

- A failed restore sets the stop when the sidecar was running: a session that cannot be read, a keyring read failure, or a sidecar that refuses. A sidecar that could not be started does not set it (see 12.7).
- A password under 8 characters cannot be registered, so it is refused before it is sent. An owner whose password is shorter cannot use this route until the registry rule changes.
- The stored username is JSON, so that the 8-character minimum holds for short usernames.
- The route stop is in the state, under `routes.unofficial.stop`. It is cleared by a successful `login-unofficial` or a successful restore. Its save failing keeps it in process, and the next start tries again.
- A restore writes no audit line. The stop is in the state, and the owner is told at start.
- The restore runs in `buildServe`, so the sidecar child starts at serve start when a session is stored.
- The stderr residual (the 1000-character cut, same class as S-L1) is resolved in 12.7.
- Not run live. No live login or restore was run. The sidecar is never started in tests. The login and the restore against Instagram are live-phase checks.
- `README.md` does not document `routes.unofficial.python` or `ig routes login-unofficial`. The README was not changed in this round.

### 12.7 Second round of the final round: the stderr cut, and a missing Python

Scope: two fixes from the coordinator. (1) The stderr residual: the child's stderr is cut to 1000 characters before redaction. (2) A missing or unrunnable Python is not an expired login. Nothing else changed.

Fix 1, the stderr is kept as whole lines (`src/unofficial/sidecar.js`):
- `:110-118` the limits and the line store: a line is kept whole up to `STDERR_LINE_LIMIT` (8192 characters), and at most 20 lines are kept. A longer line is not kept.
- `:118-133` `appendStderrText` and `finishStderrLine`: a partial line is kept whole, and one that passes the limit is dropped and marked as not kept. No cut is made inside a line.
- `:135-146` `addStderrChunk`: each complete line is finished when its newline arrives.
- `:149-160` `lastStderrText`: the last non-blank line is taken. The whole line is redacted first, and only then cut to 200 characters for display. A line that was not kept is named as not shown.
- `:265` the child's stderr goes to `addStderrChunk`. The old `session.stderr = (session.stderr + chunk).slice(-1000)` is gone.
- `:285-289` the diagnostic at the child's `close` uses `lastStderrText`.

Fix 2, a missing Python gives UNOFFICIAL_ADAPTER_ERROR, not AUTH_EXPIRED:
- `:162-164` `startFailureMessage`: "the sidecar could not be started: the executable "<command>" was not found (ENOENT)", or "could not be run (<code>)" for any other code. It holds no argument and no value.
- `:188` `teardown` takes details, which go to the rejected errors.
- `:249-282` `start`: the session records `spawned` at the child's `spawn` event. An `error` before `spawn` means the child never started. It rejects the pending calls with the start message, and the details carry `sidecarStart: 'failed'` and the command. An `error` after `spawn` is a failure of a running child, with its own message. An error on stdin counts only once the child has started, because the process error event is the one that says why.
- `:312` a start that fails synchronously rejects with the start message and the same mark.
- `src/unofficial-session.js:113-118` the comment of `restoreUnofficialSession`, with the status list; `:136-141` the branch: an error marked `sidecarStart: 'failed'` returns the status `unavailable` with the message, and sets no stop. Any other restore failure with the sidecar running still sets `AUTH_EXPIRED`, as before.
- `src/cli.js:1205-1207` `runServe`: an `unavailable` restore prints the message, then "the stored unofficial session is kept, and the unofficial routes run once the sidecar starts". It does not mention login-unofficial.
- The login path already gives UNOFFICIAL_ADAPTER_ERROR for a missing Python (`unofficialLoginFailure` keeps the kind and the details), so no change was needed there.

Tests (new or changed):
- `test/sidecar.test.js:124` `a child that cannot start rejects with UNOFFICIAL_ADAPTER_ERROR, and names the executable` (changed). Old: `await assertKind(adapter.status(), 'UNOFFICIAL_ADAPTER_ERROR');`. New: the same kind check, plus `assert.match` for "could not be started" and the executable name, and `error.details.sidecarStart === 'failed'`.
- `test/sidecar.test.js:436` `a registered session value that straddles the 1000-character cut of stderr is masked, with no part left` (new). The line is 1110 characters, and the secret runs from character 100 to 126, so the old cut, which began at character 110, fell inside it. The message holds `[redacted]` and no part of the secret. The mutant with the old `slice(-1000)` and the old cut-then-redact display fails this test.
- `test/sidecar.test.js:457` `a stderr line longer than the line limit is not shown, and no part of it is` (new). A 9000-character line is shown as not shown, and no run of ten of its characters appears.
- `test/unofficial-session.test.js:530` `a missing Python gives UNOFFICIAL_ADAPTER_ERROR, not AUTH_EXPIRED, and the route is not stopped` (new). It uses the real adapter with a missing executable, through `buildServe`. The restore is `unavailable`, the route stop is not set, and a `follow` is refused with UNOFFICIAL_ADAPTER_ERROR, not STOPPED. The mapping of the features to the sidecar is set in the test config. The mutant that drops the start-failure branch fails this test.
- `test/unofficial-session.test.js:548` `a missing Python on the login gives UNOFFICIAL_ADAPTER_ERROR, names the executable, and stores nothing` (new).
- `test/unofficial-session.test.js:571` `a restore that fails with the sidecar running still gives AUTH_EXPIRED` (new).
- `test/unofficial-session.test.js:584` `runServe says that a sidecar which could not start keeps the stored session, and does not say the login expired` (new).

No Python was started. The missing executable is `ig-no-such-python-for-test`, which the spawn fails on at once.

Counts (`npm test`, run on each Node version after the changes above):
- Node 24.6.0 (`node --version` printed `v24.6.0`): `ℹ tests 1199`, `ℹ pass 1199`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0`, exit 0.
- Node 22.13.1 (the standalone binary at `%USERPROFILE%\AppData\Local\ms-playwright-go\1.50.1\node.exe` first on PATH; `node --version` printed `v22.13.1`): TAP summary `# tests 1199`, `# pass 1199`, `# fail 0`, `# cancelled 0`, `# skipped 0`, exit 0.

The count went from 1193 (end of the first part of this round) to 1199: 2 new tests in `test/sidecar.test.js` and 4 in `test/unofficial-session.test.js`. In this second round, I changed one existing test (`test/sidecar.test.js:124`) and added no others to other files. Another change to `test/sidecar.test.js` landed on disk during this round, and I did not change or review it.

### 12.8 Default mapping of the unofficial features to the sidecar

Scope: one change from the coordinator. The route is already gated by the acknowledgement and by `routes.unofficial.enabled`, so the feature mapping should not need a second config step. The default now maps `follow`, `unfollow` and `profileEdit` to the sidecar. Nothing else changed.

- `src/config.js:57-66` the defaults of `routes.unofficial`: `adapterByFeature` is `{ follow: 'sidecar', unfollow: 'sidecar', profileEdit: 'sidecar' }` (line 63). The config merge is per key for plain objects (`merge`, `src/config.js:79-87`), so a config value that maps a feature elsewhere still wins for that feature, and the other features keep the default. A feature with no mapping still gives NOT_SUPPORTED from the registry, as before (`src/unofficial/adapter.js`, unchanged).
- `test/config.test.js:112` a new test, `the unofficial features map to the sidecar by default, and a config value for a feature wins`: the defaults map the three features; a config value `{ follow: 'jslib' }` gives jslib for follow and keeps the sidecar for unfollow.
- `test/config.test.js:147` the expectation of the default shape (`the default config has exactly the documented shape`) now includes the mapping. Old: `adapterByFeature: {}`. New: `adapterByFeature: { follow: 'sidecar', unfollow: 'sidecar', profileEdit: 'sidecar' }`.
- `test/unofficial-session.test.js:45` `configFrom` no longer writes an empty `adapterByFeature`, so the tests of the default use the defaults. The tests that set a mapping still set it.
- `test/unofficial-session.test.js:610` `with the route enabled and acknowledged and no mapping in the config, follow reaches the sidecar adapter` (new). The fake sidecar receives the follow.
- `test/unofficial-session.test.js:617` `with the route not acknowledged, follow is ROUTE_DISABLED and no adapter is called` (new).
- `test/unofficial-session.test.js:626` `a config value that maps follow elsewhere still wins over the default` (new). The config maps follow to jslib, which refuses with NOT_SUPPORTED, and the sidecar is not called.
- `test/unofficial-session.test.js:635` `an unmapped feature still gives NOT_SUPPORTED` (new). The registry built from the defaults refuses `like`.

Mutant check: the default reverted to `{}` in a scratch copy. Four tests fail: the default-shape expectation, the default-mapping test in `config.test.js`, the follow-reaches-the-sidecar test, and the unmapped-feature test, whose sanity line expects follow to be mapped.

Counts (`npm test`, after this change):
- Node 24.6.0 (`node --version` printed `v24.6.0`): `ℹ tests 1204`, `ℹ pass 1204`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0`, exit 0.
- Node 22.13.1 (the standalone binary first on PATH; `node --version` printed `v22.13.1`): TAP summary `# tests 1204`, `# pass 1204`, `# fail 0`, `# cancelled 0`, `# skipped 0`, exit 0.

The count went from 1199 to 1204: 1 new test in `test/config.test.js` and 4 in `test/unofficial-session.test.js`.

## Final review fixes (2026-10-23)

Scope: the three items from `final2-review.md` named by the coordinator: F2-I-1, F2-M-6 and F2-M-9. Nothing else changed. The Python sidecar is not changed. instagrapi stays `==3.1.0`. Login stays acknowledgement-only.

### F2-I-1: the restore needs the switch as well as the acknowledgement

- `src/unofficial-session.js:118-121` `restoreUnofficialSession` takes `enabled`. It returns `skipped` unless `enabled` and `acknowledged` are both `true`. With the switch off, nothing is read from the keyring and the adapter is not called. The comment at `:113-117` says the same.
- `src/cli.js:1016` `buildServe` passes `enabled: effective.routes.unofficial.enabled` from the effective config.
- `test/unofficial-session.test.js:654` `with routes.unofficial.enabled false, serve does not restore a stored session`. It uses the fake adapter and asserts `status === 'skipped'` and `adapter.calls.restore.length === 0`. `builtWith` and `configFrom` are unchanged, so the other tests still run with the switch on.
- `test/unofficial-session.test.js:662` `with routes.unofficial.enabled false, no sidecar process is started at serve start; with it on, the restore starts one`. It uses the Node fixture as the sidecar, which is not Python. With the switch off, `pid()` is `null`. With the switch on, the same stored session restores, and `pid()` is a number. The second case is the positive control.

### F2-M-6: a sidecar that does not start is never an expired login

What the adapter now marks (`sidecarStart: 'failed'` in the error details):
- A spawn failure before `spawn` (the existing mark, `src/unofficial/sidecar.js:289`), and the synchronous start failure (`:323`).
- A child that exits, closes, times out, sends a line that is not JSON, sends a reply that matches no request, or sends an oversized line, before it has answered anything. This is `failStart` at `src/unofficial/sidecar.js:191-194`, with its call sites at `:214`, `:218`, `:247`, `:283`, `:289`, `:299` and `:330`.
- `session.replies` counts the replies that matched a request (`:267`, and `:225` where it goes up). A failure after the first reply is an ordinary failure, with no mark.
- `close()` is a plain teardown. Closing the adapter is not a failure to start.

`restoreUnofficialSession` already returns `unavailable` for the mark, and sets no stop (`src/unofficial-session.js:136-141`, unchanged in this round).

Tests:
- `test/sidecar.test.js:470` `a sidecar that exits before its first reply gives UNOFFICIAL_ADAPTER_ERROR, and is marked as not started (F2-M-6)`. It uses the fixture in `exit` mode.
- `test/sidecar.test.js:482` `a sidecar that exits after it has answered is an ordinary failure, and is not marked as not started`. It uses the new fixture mode `once-then-exit` (`test/fixtures/fake-sidecar.js:9`, `:36`, `:112-115`).
- `test/unofficial-session.test.js:693` `a sidecar that exits before its first reply leaves the route unstopped (unavailable), not AUTH_EXPIRED`. Through `buildServe`, with the fixture in `exit` mode: `status === 'unavailable'`, and the route stop is `null`.

Not fixed in this round: a missing instagrapi. `sidecar/ig_sidecar.py` imports instagrapi inside `_new_client`. The import error becomes an `api_error` reply, because the sidecar answers the request. So the child has started, and a failed restore sets `AUTH_EXPIRED`. The Node side cannot tell that reply from a library error without a Python change, and the earlier round barred Python changes. The fix needs a decision: map `ImportError` in `_new_client` to a new kind, for example `not_started`, which the adapter would map to `UNOFFICIAL_ADAPTER_ERROR` with the mark. The README sentence at its line 421 is exact for a spawn failure, a child that exits before its first reply, and a child that does not answer before the timeout. It is not exact for a missing instagrapi, and it should say so until the decision is made.

### F2-M-9: the password refusal does not echo the password

- `test/unofficial-session.test.js:362-386`, `a password under 8 characters is refused before it is sent`. The validation function now asserts `!err.message.includes('short')` (line 381-383). The password in the test is `short`.

### Counts (`npm test`, after these changes)

- Node 24.6.0 (`node --version` printed `v24.6.0`): `ℹ tests 1213`, `ℹ pass 1213`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0`, exit 0.
- Node 22.13.1 (the standalone binary first on PATH; `node --version` printed `v22.13.1`): TAP summary `# tests 1213`, `# pass 1213`, `# fail 0`, `# cancelled 0`, `# skipped 0`, exit 0.

The count went from 1204 to 1213. My additions this round are 5: 2 in `test/sidecar.test.js` (at `:470` and `:482`) and 3 in `test/unofficial-session.test.js` (at `:654`, `:662` and `:693`). The other 4 were added to the tree during this round by work that is not part of these fixes. I did not trace them, and they are included in the counts above.

Mutant checks, in scratch copies:
- The `enabled` gate removed. The two switch tests fail.
- Every child-side failure marked, before the first reply or not. The test for a failure after a reply fails, so the mark is not over-applied.
- The F2-M-9 assertion has no mutant. It is a one-line check on the message.

### Missing instagrapi is unavailable, not an expired login (decided by the coordinator)

Scope: a missing instagrapi must not read as an expired login. The change is on both sides. Login stays as it was. instagrapi stays `==3.1.0`. Nothing else in the Python changed.

Python (`sidecar/ig_sidecar.py`):
- `:101` `INSTAGRAPI_MISSING`, the fixed message: "instagrapi is not installed; install the pinned version in sidecar/requirements.txt".
- `:104-111` `_new_client`. The two imports stay inside the function (R10). An `ImportError` raises `SidecarError("unavailable", INSTAGRAPI_MISSING)`, which `handle_request` returns as the kind `unavailable`. It is the only function that imports instagrapi, so no other function changes. Login and restore both reach it, so both give `unavailable` when the library is missing.

Node (`src/unofficial/sidecar.js`):
- `:240-241` a reply with the kind `unavailable` is marked `sidecarStart: 'failed'`, the mark that says the session did not start. The kind maps to UNOFFICIAL_ADAPTER_ERROR by the existing default for any kind that is not a stop kind. No other mapping changed.
- The restore path (`src/unofficial-session.js`) is unchanged, and it already gives status `unavailable` with no stop for the mark. A failed restore of a session that started still gives AUTH_EXPIRED.

Tests:
- `test/sidecar.test.js:495` `an unavailable reply from the sidecar gives UNOFFICIAL_ADAPTER_ERROR, and marks the session as not started`, through the fixture `error:unavailable`.
- `test/unofficial-session.test.js:728` `an unavailable reply from restore gives UNOFFICIAL_ADAPTER_ERROR, and sets no route stop`. It asserts status `unavailable` and no route stop.
- `test/unofficial-session.test.js:734` `a failed restore with another kind still gives AUTH_EXPIRED`, through the fixture `error:api_error`. It asserts status `failed` and the stop kind `AUTH_EXPIRED`.
- `test/sidecar-python.test.js:169` `python restore: with instagrapi not installed, restore_session replies unavailable, and nothing is sent to Instagram`. It skips with a reason when Python is absent, as the other Python checks do. It also skips with a reason when instagrapi is installed: in that case the script does not call `restore_session`, because the call would reach Instagram. The script's restore call is at `test/sidecar-python.test.js:105-106`.

The Python check, run by hand, with Python 3.13.7 on PATH and instagrapi absent (`find_spec` returned `None`). It does not install anything. The `refused` line is the sidecar's own stderr log:

```
$ python -I -B -c "...find_spec('instagrapi')...; s.handle_request({'id': 1, 'method': 'restore_session', 'params': {'session': {'sessionid': 'x'}}})..." D:/Projects2/InstagramApi
restore_session refused (unavailable)
instagrapi installed: False
{"id": 1, "ok": false, "error": {"kind": "unavailable", "message": "instagrapi is not installed; install the pinned version in sidecar/requirements.txt"}}
instagrapi loaded: False
exit: 0
$ python -m py_compile sidecar/ig_sidecar.py   (exit 0)
$ python -c "import importlib.util; print('instagrapi still absent:', importlib.util.find_spec('instagrapi') is None)"
instagrapi still absent: True
```

The Node test that runs the same check (`test/sidecar-python.test.js`, run on its own): `ℹ tests 24`, `ℹ pass 24`, `ℹ fail 0`, `ℹ skipped 0`.

Mutant checks, in scratch copies:
- The `sidecarStart` mark for `unavailable` removed. The two Node tests for an unavailable reply fail.
- The Python `unavailable` kind changed back to `api_error`. The Python restore test fails.

README, for the docs owner: the bullet at `README.md:422` ("**Only a failure to start the executable is not an expired login.**") still says that "instagrapi not installed" is a failed restore that sets `AUTH_EXPIRED`. That is no longer true. A missing instagrapi now gives `unavailable`: UNOFFICIAL_ADAPTER_ERROR, the stored session is kept, no stop is set, and `ig serve` prints the reason. The same bullet should also name the other cases that are now `unavailable`: a child that exits, or times out, before it has answered anything. Only a failure after the first reply sets `AUTH_EXPIRED`. Nothing else in the README needs to change for this item.

Counts (`npm test`, after these changes):
- Node 24.6.0 (`node --version` printed `v24.6.0`): `ℹ tests 1217`, `ℹ pass 1217`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0`, exit 0.
- Node 22.13.1 (the standalone binary first on PATH; `node --version` printed `v22.13.1`): TAP summary `# tests 1217`, `# pass 1217`, `# fail 0`, `# cancelled 0`, `# skipped 0`, exit 0.

The count went from 1213 to 1217: 1 new test in `test/sidecar.test.js`, 2 in `test/unofficial-session.test.js`, and 1 in `test/sidecar-python.test.js`.
