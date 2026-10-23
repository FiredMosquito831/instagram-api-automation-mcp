# Task 12 review: unofficial adapters (instagrapi sidecar)

Scope: task-12-base to task-12-head, from review-task-12.diff. Read-only. The suite was not re-run, and the Python py_compile and behaviour checks were not re-run; both are taken from the report.

Checks run for this review (read-only, against the instagrapi 3.1.0 wheel in the scratchpad, read in place with zipfile under `python -I`; nothing was extracted or executed):
- Check A: exception class names in `exceptions.py`, every `input(` call site, logger calls with a secret-like argument within 5 lines, and the `get_settings()` keys in `mixins/auth.py`.
- Check B: the `ChallengeRequired` constructor, every reference to the two challenge handlers, and the `bloks.py` and `challenge.py` call path.

Paths below are relative to `D:\Projects2\InstagramApi\`. Line numbers are for the files as they stand at task-12-head.

---

## Spec compliance

### Node side

- ✅ Adapter shape and JSDoc: `src/unofficial/adapter.js:6-20` typedef lists `login`, `restoreSession`, `follow`, `unfollow`, `profileEdit`, `status`, `close`.
- ✅ `createAdapterRegistry` and `forFeature`: `src/unofficial/adapter.js:29-41`. An unmapped feature, or a mapping to an unregistered adapter, throws `NOT_SUPPORTED` synchronously (`adapter.js:37`).
- ✅ `createSidecarAdapter` signature and default: `src/unofficial/sidecar.js:54` (`timeoutMs = 20000`), argument checks at `:55-61`.
- ✅ Child starts on first use: `sidecar.js:156` (`session = current ?? start()`). Nothing spawns at construction.
- ✅ One JSON line per call: `sidecar.js:149` builds `{ id, method, params }`, written at `:166`.
- ❌ Response mapping, fail-open: `sidecar.js:97` resolves `message.result ?? null` for any type. The `login`, `restoreSession` and other wrappers at `:180-185` pass it through unchecked. A result that is not an object is read as success, and so is `ok: true` with no result. See I-1.
- ✅ Kind mapping: `sidecar.js:13-20` matches the brief's list exactly. Any other kind, a missing kind, or a non-string kind gives `UNOFFICIAL_ADAPTER_ERROR` (`:22-23`). The Map lookup has no prototype path.
- ✅ Timeout: `sidecar.js:161-164` calls `teardown`, which kills the child (`:78`) and rejects with `UNOFFICIAL_ADAPTER_ERROR` (`:76`).
- ✅ Child exit: `sidecar.js:135-139` calls `teardown`, which rejects every pending call (`:74-77`). Each child has its own session object (`:124`, with `dead` at `:69-70`), so a stale exit cannot reject a newer child's calls.
- ✅ Malformed JSON line: `sidecar.js:83-88` tears the child down and rejects every pending call of that child with `UNOFFICIAL_ADAPTER_ERROR`. This is stricter than the brief's "rejects the pending call", and the report says so (report section 2).
- ✅ jslib: every method refuses with `NOT_SUPPORTED` and the brief's exact text (`src/unofficial/jslib.js:6`, `:8-10`, `:17-23`). The form is a rejected Promise, not a synchronous throw as the brief says. The adapter shape is Promise-returning and the test accepts a rejection, so this is accepted. Callers must catch (see M-5).
- ✅ Fixture: `test/fixtures/fake-sidecar.js` does no network and runs no instagrapi. The tests spawn only `process.execPath` with the fixture (`test/sidecar.test.js:13-16`).
- ✅ The five tests the brief names are present under the brief's names (`test/sidecar.test.js:36`, `:51`, `:85`, `:176`, `:193`). The file holds 14 tests, as the report says.
- ⚠️ Off-by-default gating and the route from the adapter to the service are not in this task. They belong to Task 13.

### Python side

- ✅ `instagrapi` is imported only inside `_new_client` (`sidecar/ig_sidecar.py:74-75`). The module loads without it, and `map_exception_kind` is pure (`:55-60`).
- ✅ No `print` call. Logs go to stderr (`:256`), and `sys.stdout` is redirected to stderr after the protocol stream is captured (`:257-258`). The three log calls (`:226`, `:230`, `:232`) carry only the method name, the exception class name and the kind.
- ✅ No challenge resolver is imported. The only imports are `Client` and `ChallengeRequired` (`:74-75`). The library's own `Client` inherits the resolver mixin, which the sidecar does not control; the brief's intent is met.
- ❌ Challenge handlers: the brief says to leave them unset. The sidecar sets both to a refusal (`:85-86`, with `refuse_challenge` at `:77-81`). This is a literal deviation. I agree with it, and I recommend amending the brief rather than the code.
  - It is a refusal, not a resolver. `refuse_challenge` raises and resolves nothing.
  - Leaving them unset is unsafe. Check A found exactly two `input(` calls in the 3.1.0 wheel: `instagrapi/mixins/private.py:113` and `:129`. They are installed as class defaults at `private.py:147-148` and called from `challenge.py:58`, `challenge.py:96` and the `bloks.py:1058` path. Unset, a challenge would block on stdin and consume the next protocol line as the code.
  - The refusal fails as CHECKPOINT. Check B confirmed that the `ChallengeRequired` constructor accepts one message (`exceptions.py:120-122`). `kind_for_exception` maps it to `challenge`, and the Node side maps `challenge` to `CHECKPOINT`.
  - The brief's line should say "replaces it with a refusal". The owner should record the acceptance.
- ✅ `map_exception_kind` follows the brief's list (`ig_sidecar.py:58-60`, plus `"Challenge" in text`). The additions are at `:32`, `:34`, `:35`, `:37` and `:38`. Each maps to a stop class: `auth_expired`, `rate_limited`, `action_blocked` or `challenge`. The report's section 6 says four additions, but it lists five and the code has five (see M-1).
- ✅ Subclasses keep their stop kind through `kind_for_exception` (`:63-69`). For example, `SignupSpamError(FeedbackRequired)` gives `action_blocked`, per the wheel's class list.
- ✅ An unknown exception gives `api_error` and does not raise (`:60`, `:69`). `map_exception_kind` uses a `dict.get` default, so it cannot raise.
- ✅ `sidecar/requirements.txt`: line 2 is `instagrapi==3.1.0`, an exact pin. Line 1 names the license (MIT) and the wheel-only install command. The file is well formed.
- ✅ Session settings: `login` returns `client.get_settings()` only in its response line (`ig_sidecar.py:131`), and `restore_session` does the same (`:142`). Nothing writes them to a file, a log or an audit line. Check A confirmed that `get_settings()` holds tokens and cookies and no password.
- ✅ Error text: `IgError` redacts its message and its details in its constructor (`src/errors.js:30`, `:33`), so sidecar error text is redacted on the Node side. The sidecar scrubs the password, `verificationCode` and session strings from exception text (`ig_sidecar.py:202-206`). That scrub matches exact values only (see M-6).
- ✅ Fail-open paths: an unknown kind gives `UNOFFICIAL_ADAPTER_ERROR` (`sidecar.js:23`). A missing error kind gives the same (`:23`, with `undefined`). An `ok` that is neither `true` nor `false` is an error (`:101-102`).
- ❌ Fail-open path: a result that is not an object is read as a success (`sidecar.js:97`, passed through at `:180-181`). See I-1.

### Requirements file

- ✅ Pin is exact (`sidecar/requirements.txt:2`). The comment carries the license and the wheel-only install line (`:1`). The age of the release is the owner's call, as ruling 2 records.

### Items I could not verify from the diff

- ⚠️ Live behaviour of instagrapi 3.1.0: `login`, `set_settings`, `account_info`, `user_follow`, `account_edit` and the challenge path. These were checked against the source only, and the live phase covers them.
- ⚠️ The library's other `print()` calls. The stdout redirect sends them to stderr. Only the last stderr line is kept, and it is redacted (`sidecar.js:40-44`, `:135-139`). I did not audit every `print`.
- ⚠️ Node 22 has not run (carry-forward to Task 18).

---

## Strengths

- `IgError` redacts its message and details in its constructor (`src/errors.js:30`, `:33`), so every sidecar error reaches the caller redacted.
- The child environment drops every `IG_` variable (`sidecar.js:35`). Passwords and session values travel on stdin, never in argv or the environment.
- Strict matching: a response whose id matches no request tears the child down (`sidecar.js:89-92`). A late event from a killed child cannot touch a newer child (`:124`, `:70`).
- The kind lookup uses a `Map` (`sidecar.js:13`), so `constructor` and `__proto__` are unknown kinds.
- The two `input()` calls in the library sit behind the two handlers the sidecar replaces (check A). That makes the refusal the only stdin-safe reading.
- The `ChallengeRequired` constructor takes one message (check B), so the refusal raises the right class.
- The library's `get_settings()` holds no password (check A).
- Check A found no logger call with a secret-like argument within 5 lines, across the wheel's 66 Python files. That is a partial check, not a full audit.
- `login` sets `_STATE["client"]` only after success (`ig_sidecar.py:130`), so a failed login leaves no half-session.
- The stdout redirect (`ig_sidecar.py:257-258`) protects the protocol stream from stray prints.
- The tests spawn only the fixture, and the names match the brief.

---

## Issues

### Critical

None.

### Important

**I-1. A non-object result, or an `ok: true` with no result, is read as success.** `src/unofficial/sidecar.js:97` resolves `message.result ?? null` for any type. The `login`, `restoreSession` and other adapter methods (`sidecar.js:180-185`) pass it through with no check. A malformed reply therefore reads as a successful login with a `null` session, or as a completed follow with no result.
- Fix: in `handleLine`, resolve only when `isObject(message.result)`. Otherwise reject with `UNOFFICIAL_ADAPTER_ERROR`. Drop the `?? null`.
- Tests: add cases for `ok: true` with no result, and `ok: true` with a string result. Both must reject with `UNOFFICIAL_ADAPTER_ERROR`. The fixture (`test/fixtures/fake-sidecar.js:17-26`) needs a method that sends these replies.

### Minor

- **M-1. The report miscounts the additions.** `task-12-report.md:142` says four classes are added. The table at `:146-150` lists five, and the code has five (`ig_sidecar.py:32`, `:34`, `:35`, `:37`, `:38`). Fix: correct the report to five.
- **M-2. Session values are not registered on receipt.** `sidecar.js:180-181` returns the session to the caller, and `ig_sidecar.py:131`, `:142` produce it. The ledger assigns registration to Task 17. The adapter is the first point where the JavaScript side sees the tokens. Fix: register the string leaves of the result there with `registerSecret`, or confirm in the Task 17 brief that the rule is owned there.
- **M-3. The public adapter exposes `call` and `pid`.** `sidecar.js:187-188`. `call` sends any method name and bypasses the typed methods. Fix: remove `call` from the returned object, or keep it test-only. The protocol tests can use the fixture directly.
- **M-4. Test gaps for the fail-closed rules.** `test/sidecar.test.js:60-83` covers the kind mapping only. Missing: `ok: true` with a non-object or missing result, an `ok: false` with no `error` object, and a non-boolean `ok`. Fix: add these with I-1.
- **M-5. `jslib` `close()` rejects.** `src/unofficial/jslib.js:23`. A shutdown path that calls `close()` without a catch gets an unhandled rejection. Fix: Task 17 catches the rejection. Keep the brief's rejection form.
- **M-6. The Python scrub matches exact values only.** `sidecar/ig_sidecar.py:202-206`. A password or session value in URL-encoded or JSON-escaped form passes through. The `IgError` redaction (`src/errors.js:30`) is pattern-based. The password is not registered on the Node side. Fix: list this limit in the Task 18 README, and consider registering the password when the adapter is called.
- **M-7. Stop class behind `__cause__` is not followed.** `sidecar/ig_sidecar.py:63-69` walks the class MRO only. A stop-class exception raised as the cause of a generic one maps to `api_error`. Not verified against the library. Fix: after the MRO walk gives `api_error`, follow `exc.__cause__` once. Confirm live first.
- **M-8. Quadratic buffer slicing.** `sidecar.js:113-118` slices the buffer once per line. Fix: track a start offset and slice once per chunk.
- **M-9. Carry-forwards to Task 13 and Task 17 (no change in this task).**
  - (a) After a child restart the sidecar holds no session. `follow` then returns `no_session`, which maps to `UNOFFICIAL_ADAPTER_ERROR` (`ig_sidecar.py:93`, `sidecar.js:23`). The caller must call `restore_session` from the keyring after any restart.
  - (b) `follow` and `unfollow` resolve `{ ok: bool }` as the result (`ig_sidecar.py:147`, `:152`). Task 13 must read `result.ok`, so `{ ok: false }` is not a completed follow.
  - (c) `UNOFFICIAL_ADAPTER_ERROR` on a write (a timeout or a child death, `sidecar.js:76`, `:138`) is an unknown outcome. Task 13 must not retry it.
  - (d) A sidecar stop (`CHECKPOINT`, `AUTH_EXPIRED`, `ACTION_BLOCKED`, `RATE_LIMITED`) must reach `guard.stop` in Task 13.
- **M-10. Live-phase items.**
  - The 20000 ms default (`sidecar.js:54`) may be short for a live CAA login. A timeout kills the child and drops its session.
  - `ClientUnauthorizedError` (HTTP 401) maps to `api_error`. No listed stop code covers 401, so this follows the brief, but the live phase should look at it.
  - The install line `--only-binary=:all:` (`requirements.txt:1`) fails if any transitive dependency ships only an sdist. The dependency set was not checked here.
- **M-11. The Python checks are not in the repo.** The 27 behaviour checks in report section 7 live in the scratchpad. The suite has no test for `_safe_message`, the refusal, or the stop mapping. R10 allows a pure-Python test of `map_exception_kind` without instagrapi. Fix: optional; otherwise record it as a known gap.

---

## Assessment

Spec compliance: ❌. One literal line fails: the challenge handlers are set to a refusal rather than left unset (`sidecar/ig_sidecar.py:85-86`). I agree with the deviation, because an unset handler reads the protocol stream (check A). The fix is to amend the brief and have the owner record the acceptance, not to change the code. Every other spec item is met.

Task quality: Needs fixes. The reason is I-1, a fail-open path on the Node result handling at `src/unofficial/sidecar.js:97`. The protocol handling, the kind mapping, the timeout and exit handling, the Python stop mapping and the secret handling are otherwise sound. After I-1 and the M-4 tests, a focused re-check should be enough.

Counts: Critical 0, Important 1, Minor 11.
