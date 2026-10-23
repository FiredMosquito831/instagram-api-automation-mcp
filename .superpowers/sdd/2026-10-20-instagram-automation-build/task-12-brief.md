### Task 12: Unofficial adapters (instagrapi sidecar)

**Files:** Create `src/unofficial/adapter.js`, `src/unofficial/sidecar.js`, `src/unofficial/jslib.js`, `sidecar/ig_sidecar.py`, `sidecar/requirements.txt`. Tests: `test/sidecar.test.js`, with the fixture `test/fixtures/fake-sidecar.js`.

**Interfaces:**
- Consumes: `IgError` (Task 2).
- Produces, in `adapter.js`: an adapter shape, documented in JSDoc, with methods `login({ username, password, verificationCode })`, `restoreSession(session)`, `follow(userId)`, `unfollow(userId)`, `profileEdit(fields)`, `status()` and `close()`. Also `createAdapterRegistry({ adapters, byFeature }) -> { forFeature(feature) }`. `forFeature` throws `NOT_SUPPORTED` when no adapter is mapped.
- Produces, in `sidecar.js`: `createSidecarAdapter({ command, args, timeoutMs = 20000 }) -> adapter`. The child process starts on first use. Each call writes one JSON line `{ id, method, params }`. Each response is one JSON line, `{ id, ok, result }` or `{ id, ok: false, error: { kind, message } }`. Sidecar kinds map to `IgError` kinds: `checkpoint`, `challenge` and `two_factor` give `CHECKPOINT`; `auth_expired` gives `AUTH_EXPIRED`; `rate_limited` gives `RATE_LIMITED`; `action_blocked` gives `ACTION_BLOCKED`; anything else gives `UNOFFICIAL_ADAPTER_ERROR`. A timeout kills the child and rejects with `UNOFFICIAL_ADAPTER_ERROR`. A child exit rejects all pending calls.
- Produces, in `jslib.js`: `createJsLibAdapter()`. Every method throws `IgError('NOT_SUPPORTED', 'no JavaScript unofficial library is in use; the instagrapi sidecar is the unofficial route')`.
- `sidecar/ig_sidecar.py` reads JSON lines from stdin and writes one JSON line per request to stdout. Methods: `login`, `restore_session`, `follow`, `unfollow`, `profile_edit`, `status`. It uses the instagrapi `Client`. `login` returns the session settings as its result. It never imports the challenge resolvers, and it leaves any challenge handler unset.
- The pure function `map_exception_kind(name)` maps exception class names. A name containing `Challenge` gives `challenge`. `TwoFactorRequired` gives `two_factor`. `LoginRequired` gives `auth_expired`. `ClientThrottledError` gives `rate_limited`. `FeedbackRequired` gives `action_blocked`. Anything else gives `api_error`.
- The sidecar never prints a password, and it logs only to stderr.
- `sidecar/requirements.txt` pins `instagrapi` to a release after the 3.0.0 login break. The release is chosen at execution from its CHANGELOG, and its LICENSE is recorded in the README in Task 18.

**Tests:**
- `sidecar call resolves with the response that has the matching id`, using the fixture, which echoes `params`.
- `a checkpoint from the sidecar becomes CHECKPOINT`.
- `timeout kills the child and rejects with UNOFFICIAL_ADAPTER_ERROR`: the fixture has a mode that never answers.
- `jslib adapter refuses every call with NOT_SUPPORTED`.
- `registry throws NOT_SUPPORTED for an unmapped feature`.
- Python check, as a step only: `python -m py_compile sidecar/ig_sidecar.py` exits 0. Then run `python -c "import sidecar.ig_sidecar as s; print(s.map_exception_kind('ClientThrottledError'))"` from the project root and expect `rate_limited`. If Python is not installed, record that the checks did not run.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the modules and the sidecar script.** Run the tests and expect PASS. Run the Python checks.

