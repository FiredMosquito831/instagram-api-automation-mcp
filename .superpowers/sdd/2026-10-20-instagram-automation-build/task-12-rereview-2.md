# Task 12 re-review, fix round 2

Scope: task-12-fix1-head to task-12-fix2-head (review-task-12-fix2.diff). Items N-1 to N-4, and the new-breakage checks on the changed lines. Read-only. The suite was not re-run (report: 460/460, sidecar 26/26). No code was run.

Checks run for this review: read the diff, the round 1 re-review, and report section 10 (10.1 to 10.7); read the current sidecar/ig_sidecar.py, src/unofficial/sidecar.js, src/redact.js (registerSecret), src/guard.js (STOP_RANK), test/sidecar.test.js (:250-310), test/fixtures/fake-sidecar.js; read scratchpad chain_check2.py and chain_check2_out.txt (not run). Glob for *.py in the project (only sidecar/ig_sidecar.py). Grep for kind_for_exception, ClientThrottledError, ChallengeRequired, _SEVERITY, chain (project-wide, excluding node_modules), and for login/restoreSession callers under src/. Line numbers below are the current project files, which match the fix2 snapshot in the diff.

---

## Finding verdicts

**N-1 (no depth cap; cycles must terminate): ADDRESSED.**
- The cap is gone. No `_CHAIN_LIMIT` remains in `sidecar/ig_sidecar.py`. The loop is `while queue:` at :87.
- Termination: each exception is expanded once. A repeat is skipped at :89-90 by its id. A first visit adds the id to `seen` at :91 and pushes its two children at :95. Only first visits push children, so the number of pops is bounded by 1 + 2 x (distinct exceptions reachable from `exc`). The ids are stable during the walk, because every seen exception is kept alive by a `__cause__` or `__context__` reference from `exc`.
- Self-cycle (`a.__context__ = a`) and two-cycle (`a.__cause__ = b`, `b.__context__ = a`) both end. The two-cycle case is `chain_check2.py` :52-54 and its recorded output is PASS (`chain_check2_out.txt`). The 40-deep case (:43-49) is also PASS there. Not re-run.

**N-2 (most severe stop, not first found): ADDRESSED in code. One Minor finding on test coverage (M-1 below).**
- The walk does not stop at the first stop. `best` starts as "api_error" (:84). A stop kind replaces it only when it ranks higher (:93-94). The walk returns `best` (:96).
- Order: `_SEVERITY` at :64 is challenge, checkpoint, two_factor, auth_expired, action_blocked, rate_limited. Indices 0-4 are rank 3 and index 5 is rate_limited, rank 2. This matches `STOP_RANK` in `src/guard.js:26-29` (AUTH_EXPIRED, CHECKPOINT, ACTION_BLOCKED at 3; RATE_LIMITED at 2). Within rank 3 the listed order decides, as report 10.7 states.
- Every kind `map_exception_kind` can return (`_EXACT_KINDS` values at :30-38, plus "challenge" at :59, and the default at :60) is in `_SEVERITY`. So `_SEVERITY_RANK[kind]` at :93 cannot raise KeyError. The `or` at :93 also keeps `_SEVERITY_RANK["api_error"]` from being read.

**N-3 (trim before registration; trimmed value returned; blank skipped): ADDRESSED.**
- `src/unofficial/sidecar.js:35-38`: the string is trimmed (:36). Only non-blank trimmed text is registered (:37, via `registerSessionText` to `registerSecret` at :59). The trimmed text is returned (:38). A blank string is not registered and comes back as ''.
- `sessionRequest` (:214-216) resolves with the copy from `prepareSession`, so the caller never gets the raw value.
- Test: `test/sidecar.test.js:283-292`. It asserts `settings.padded === PADDED_TOKEN` (:287) and that `redact` of the bare token does not contain it (:288). Fixture: `test/fixtures/fake-sidecar.js:26` and :63. By reading, the no-trim mutant fails :287.

**N-4 (non-VALIDATION registration failure becomes UNOFFICIAL_ADAPTER_ERROR; no session returned): ADDRESSED.**
- `src/unofficial/sidecar.js:57-64`: VALIDATION is skipped (:61). Any other error becomes `IgError('UNOFFICIAL_ADAPTER_ERROR', ...)` with a fixed message (:62). The raw error and the value are not passed on.
- A failure rejects: `prepareSession` throws inside the `.then` at :215, so `login` and `restoreSession` reject and no session is returned.
- Lone surrogate path: `src/redact.js:188` registers the raw value, then `:189` `encodeURIComponent` throws URIError. It is caught at `sidecar.js:59-62`.
- Test: `test/sidecar.test.js:294-303`, with the fixture's surrogate mode at `test/fixtures/fake-sidecar.js:21` and :71-73. It asserts the kind is UNOFFICIAL_ADAPTER_ERROR and the message lacks "SURROGATE". That check is meaningful because the message is fixed text.
- Not a finding: the registry keeps the surrogate value (`src/redact.js:188`). It masks extra text and no session is returned.

---

## Minor finding

**M-1 (Minor, N-2 and N-1 test coverage): the chain walk has no committed test.**
- None of the four cases that the old first-found walk got wrong is in `test/sidecar.test.js`. The project has one .py file, `sidecar/ig_sidecar.py` (Glob). No grep hit for kind_for_exception, ClientThrottledError, ChallengeRequired or _SEVERITY under test/ or in package.json. The Node suite reaches the Python walk only through the fixture, which does not run it.
- The cases exist only in the scratchpad file `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\chain_check2.py`:
  - (a) `ClientThrottledError` raised from `ChallengeRequired`: old walk gives rate_limited, want challenge (:21-23). This is the most direct missing case. It fails the old walk, and the coordinator's example does not.
  - (b) `ClientThrottledError` raised from `LoginRequired`: old gives rate_limited, want auth_expired (:29-31).
  - (c) `LoginRequired` raised from `ChallengeRequired`: old gives auth_expired, want challenge (:33-35).
  - (d) The 40-deep chain over a `ChallengeRequired`: old gives api_error (cap of 32), want challenge (:43-49).
  - The N-1 cycle case (:52-54) is also missing from any committed test.
- The old-walk failures come from the report's mutation run (10.5). They match my reading of the fix1 walk in the diff. Not re-run.
- Fix: a committed test for the walk. A Python test, or a Node test that runs `python -I` on the pure functions. The controller decides whether it goes into this round.

---

## New breakage

No Critical. No Important. The one open issue is M-1 (Minor), listed above.

Checked, no new defect:
- Severity order vs guard: the rank groups match (`src/guard.js:26-29`; `sidecar/ig_sidecar.py:64`). Within rank 3 the listed order is the only rule. Guard keeps the stored record at equal rank (`src/guard.js:195`, :202), so the owner sees the tie-break winner (report 10.7). Accepted.
- Stop chain returning a non-stop kind: none. `best` changes only for a stop kind (`sidecar/ig_sidecar.py:93-94`).
- Trim changing a value the caller then fails to match: no `login` or `restoreSession` call exists under src/ (grep). `src/unofficial/adapter.js:12` is a typedef. The round trip is consistent, because restore sends the trimmed copy. A value with meaningful edge whitespace would change; none is known, and instagrapi's own settings values were not checked. The approach matches Task 9 (`src/secrets.js:88`, :103).
- Registration error returning a session unregistered: only the VALIDATION skip (`src/unofficial/sidecar.js:61`), for a value under 8 characters (`src/redact.js:178`) or one inside the marker (`src/redact.js:185`). The item keeps VALIDATION skipped, and the 8-character rule is out of scope. Accepted.
- Error message carrying a session value: none. The IgError text at `src/unofficial/sidecar.js:62` is fixed. The walk adds no message text. `handle_request` uses `_safe_message` on the top-level exception only (`sidecar/ig_sidecar.py:258`).
- Cycle that hangs: none (see N-1).
- Stale `__context__` escalation: a rate limit whose `__context__` is an old ChallengeRequired now reports challenge (`sidecar/ig_sidecar.py:93-94`). The top-level rate limit used to end the walk. This is fail-closed and is the trade-off accepted in round 1 (ledger rule 2). Not counted.
- Latent, not a current case: `sidecar/ig_sidecar.py:93-94` indexes `_SEVERITY_RANK`. A future `_EXACT_KINDS` value missing from `_SEVERITY` would raise KeyError inside the `except` at :255-258, which ends `serve()`. The Node side then sees the child exit as UNOFFICIAL_ADAPTER_ERROR. Fail-closed. Not counted.
- Dead entry: "checkpoint" in `_SEVERITY` (`sidecar/ig_sidecar.py:64`) is never returned by `map_exception_kind`. Harmless.
- Cosmetic, not counted: report 10.1 cites `src/unofficial/sidecar.js:30-42` for prepareSession (actual :34-55, with the comment at :30-33), :57-63 for registerSessionText (actual :57-64), and :214-215 for sessionRequest (actual :214-216). `sidecar/ig_sidecar.py:63` is 122 characters.

---

## Round verdict

**PASS.** No Critical and no Important issue. N-1, N-2, N-3 and N-4 are all ADDRESSED in code. One Minor finding is open: M-1, the chain walk has no committed test (the four cases the old walk missed are only in scratchpad). The controller decides whether M-1 goes into this round or the final review.

New issues this round: Critical 0, Important 0, Minor 1.
