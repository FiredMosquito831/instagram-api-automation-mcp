# Task 12 re-review, fix round 1

Scope: task-12-head to task-12-fix1-head (review-task-12-fix1.diff), in-scope items only. Read-only. The suite was not re-run (report: 458/458; sidecar 24/24). The Python py_compile and chain checks were not re-run; their recorded output is in the report, section 9.5.

Checks run for this review: read the diff in full; read the current project files (sidecar/ig_sidecar.py, src/unofficial/sidecar.js, src/redact.js registerSecret and maskRegistered, src/errors.js IgError, src/unofficial/adapter.js, the test and fixture line numbers); grep of src/, test/ and sidecar/ for `.call(` and `call` on the adapter (no caller found). No runtime check was needed; each verdict below rests on the code as read.

Paths are absolute under D:\Projects2\InstagramApi\.

---

## Finding verdicts

**I-1 (ok:true with no or non-object result): ADDRESSED.**
- Node rule: `src/unofficial/sidecar.js:118-122`. Resolves only when `isObject(message.result)`; otherwise rejects with UNOFFICIAL_ADAPTER_ERROR. The `?? null` is gone.
- Python rule, per method (`sidecar/ig_sidecar.py`): login returns `client.get_settings()` (:154); restore_session returns `client.get_settings()` (:165); follow returns `{"ok": bool}` (:170); unfollow returns `{"ok": bool}` (:175); profile_edit returns `{"edited": [...]}` (:188); status returns `{"loggedIn": bool}` (:194). Every handler returns a dict. The only success reply is `{"id", "ok": True, "result": result}` at :256. No method returns None, so no real success is rejected. Mismatch count: 0. No Critical.
- Tests: `test/sidecar.test.js:187` (ok:true no result), `:197` (null), `:206` (string), `:215` (object resolves). Fixture: `test/fixtures/fake-sidecar.js:32` (replyShape: none, string, null, object, error-no-object, error-no-kind, ok-not-boolean).

**M-2 (session registration before return): ADDRESSED.**
- `src/unofficial/sidecar.js:30-48` registerSessionStrings: recursive over arrays and objects; blank strings skipped (:35); a registry VALIDATION refusal skipped (:37-40).
- `src/unofficial/sidecar.js:196-203` sessionRequest registers in the `.then` before the caller's promise resolves. `:215-217` login and restoreSession are the only callers, and no other method returns a session.
- Error paths: a failed request never reaches registration, so no session is returned. A non-VALIDATION throw from registration rejects the call (`:39`), so no session is returned unregistered. See N-4 for the one such throw path that real input can reach.
- Known limit (accepted): a string under 8 characters is refused (`src/redact.js:178`) and skipped. Narrower than the review's wording: `src/redact.js:185` refuses only values inside the marker, not values that contain it. Containing-marker values are registered, which is the safer side.
- Tests: `test/sidecar.test.js:251` (login; short and blank strings do not fail the login; the token is masked; the status error message does not carry it) and `:271` (restore).

**M-3 (raw call removed; pid kept): ADDRESSED.**
- `src/unofficial/sidecar.js:169` is `request` (internal, renamed). `:214-224` returned object has no `call`.
- `pid` is kept (`:205-207`) and tested (`test/sidecar.test.js:89-92`, `:129-134`).
- Grep for `.call(` and `call` across src/, test/ and sidecar/: no call on the adapter. Matches are Function `call`, the test name and comments only.

**M-7 (stop class through __cause__ and __context__): ADDRESSED.**
- `sidecar/ig_sidecar.py:75-92` kind_for_exception: breadth-first walk over the exception, `__cause__` and `__context__`; first stop kind returned; an api_error does not end the walk. Used by the generic except path at `:252`.
- Cycle: `:85-86` skips None and any exception already in `seen` (by id). A self-cycle or a two-cycle adds nothing new and the walk ends. The recorded self-referencing-context check (report 9.5) agrees. Termination does not depend on the cap (see N-1).
- Stop table unchanged: `_EXACT_KINDS` at `:29-39` and `map_exception_kind` at `:55-60` are outside the diff hunks. `_kind_for_class` at `:66-72` is the head's MRO loop moved into a function.
- Placement note: the walk lives in kind_for_exception(exc), not in map_exception_kind(name). map_exception_kind takes a name, as the brief says, so this is the right place. The item's wording is met.
- Python checks, recorded (report 9.5, and section 7): `py_compile` exit 0; the ChallengeRequired-with-generic-cause line PASS (challenge); the generic-with-no-chain line PASS (api_error). Consistent with the code as read.

**M-1 (report count): ADDRESSED.** `task-12-report.md:142` says five classes are added. The table at `:146-150` lists five. The code has five additions at `ig_sidecar.py:32, :34, :35, :37, :38`.

**M-4 (tests): ADDRESSED.** ok:true with no result (`test/sidecar.test.js:187`), ok:true with a string result (`:206`), ok:true with an object result (`:215`). The kinds table at `:61` includes an unknown kind, `constructor`, `__proto__` and the empty kind, each mapping to UNOFFICIAL_ADAPTER_ERROR. Extra cases also present: null (`:197`), ok:false with no error object (`:224`), error with no kind (`:233`), non-boolean ok (`:242`).

**Python checks (py_compile; ChallengeRequired with generic cause; generic with no chain): ADDRESSED as recorded.** Report 7 and 9.5. Not re-run.

---

## New breakage

Checked against the list in the brief. No new Critical, no new Important.

- **N-1 (Minor). The chain walk is capped, and a stop beyond the cap is lost.** `sidecar/ig_sidecar.py:63` (_CHAIN_LIMIT = 32) and `:83` (loop bound). The walk examines at most 32 distinct exceptions. A chain whose stop class is the 33rd exception or deeper returns api_error. Fail-open, but only for a chain deeper than 32. The cap is not needed for termination: `seen` alone guarantees it, since every node is added once and only unseen nodes add children. Fix: remove the cap.
- **N-2 (Minor). The walk reports the first stop found, not the most severe.** `sidecar/ig_sidecar.py:75-91`. A top-level ClientThrottledError (rate_limited) raised from a ChallengeRequired (challenge) reports rate_limited, so a checkpoint is hidden behind a rate limit. Both are stops, so outbound actions halt. The owner may see the less severe kind first, and after `ig_stop_clear` the next call can reach the checkpoint. This follows the item's "first stop class found" wording, so it is a design limit for the owner to accept or change (for example, rank the kinds), not a defect in the fix.
- **N-3 (Minor). A padded session string is registered padded, so its trimmed core is not masked.** `src/unofficial/sidecar.js:37` calls registerSecret on the raw value. `src/redact.js:177-191` does not trim, and `maskRegistered` (`:195-200`) replaces exact values only. A string with surrounding whitespace leaves its trimmed form unmasked when it appears alone. This is the Task 9 I-1 class, on the sidecar side. Fix: also register `value.trim()` when it differs. Needs a padded session string; not expected from instagrapi.
- **N-4 (Minor). A lone surrogate turns a real success into a non-IgError rejection.** `src/redact.js:188` adds the value to the registry, then `:189` calls encodeURIComponent, which throws URIError on a lone surrogate. `src/unofficial/sidecar.js:38-39` rethrows any non-VALIDATION error, so login or restoreSession rejects with a URIError, not an IgError. Fail-closed: no session is returned and nothing leaks. Python's json.dumps escapes a lone surrogate as a valid `\udXXX`, so it can reach this path. Needs a lone surrogate in a session string. Fix: treat an encode failure as a skip in registerSessionStrings.

Other breakage checks, no finding:
- A reply resolving with null or a non-object: none. `src/unofficial/sidecar.js:118-119` is the only resolve path.
- A registrable value skipped: none. The skip conditions are blank (`:35`), registry VALIDATION (`:39`, reached only for length under 8 or the marker), and non-string types (not required by the rule).
- An error message carrying a session value: none. IgError redacts (`src/errors.js:30`). The walk adds no message text (`ig_sidecar.py:252` uses `_safe_message` on the top-level exception only). `_safe_message` scrubs the session strings of restore_session (`:222-230`).
- A cycle that hangs: none. Python walk bounded by `seen` (see M-7). Node recursion in registerSessionStrings runs only on JSON-parsed input, which has no cycles.
- A stop class lost: N-1 and N-2.
- An unknown kind reading as success: none. Node: `sidecar.js:22-24` (KIND_MAP Map), `:115-128` (ok must be true with an object result). Python: unknown exceptions give api_error (`ig_sidecar.py:60`).
- A secret written to a file, log or audit line: none. The new code adds no log, print or write. The log lines at `ig_sidecar.py:249` and `:253` carry the method, the class name and the kind only.

Accepted, not counted: the chain walk can now stop outbound actions on an unrelated generic error whose __context__ is a stop exception. This is the fail-closed trade-off the controller accepted in fix round 1 (ledger, rule 2).

---

## Round verdict

**PASS.** Every in-scope item is ADDRESSED. No new Critical and no new Important issue. Four new Minor issues (N-1 to N-4), for the ledger's deferred list. N-1 is the cheapest to fix (remove the cap at `sidecar/ig_sidecar.py:63` and `:83`); the controller decides whether it goes into this round or the final review.
