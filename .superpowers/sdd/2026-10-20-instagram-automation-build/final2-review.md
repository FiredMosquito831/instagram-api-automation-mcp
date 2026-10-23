# Final review 2: the final rounds (2026-10-23)

Scope: D:\Projects2\InstagramApi (Node ESM package), net change final-head to final2-head, from review-final2.diff. Read-only: no project file was edited, no git command was run, and the suite was not re-run. progress.md (line 484) records 1208/1208 on Node 24.6.0 and on Node 22.13.1 for the head under review. No live call was made.

Read, in order: final-review-2.md (S-L1, S-K1, R-1 to R-6, T-1 to T-7); progress.md lines 397-412 (owner decisions) and 434-485 (the final rounds); global-constraints.md; task-12-report.md "Final round (2026-10-23)" (lines 518-684); task-15-report.md "Final round" and "Final round: serve warning" (lines 471-615); task-18-report.md "Final round" and "Final round: placeholders" (lines 225-324); review-final2.diff in full. Each change in the diff was read against the working-tree file it changes.

Method note for item (g): a scratch check in D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\mockcheck\mock-restore.test.mjs confirmed on Node 24.6.0 that a mock made with ctx.mock.method is restored when its test ends. The project was not touched.

---

## 1. Verdicts

| Item | Verdict | Evidence (file:line) |
|---|---|---|
| (a) login-unofficial: refused without the acknowledgement; password hidden or piped; registered before use; never printed, logged, in an error or in a file; under 8 characters refused without echo | ADDRESSED | Ack check src/cli.js:550 (before any prompt; the prompts are only read after lines 553-554). Hidden password bin/ig.js:70-81 (unofficialLoginPrompts: readHiddenValue on a terminal, the piped lines otherwise, src/cli.js:514 createLineSource). Registration src/cli.js:560 before the adapter call at 563. Under 8 refused in src/unofficial-session.js:37-48 with a message that does not include the value. Nothing printed but fixed text (src/cli.js:576-577). Test gap: see F2-M-9. |
| (b) session in keyring under unofficial_session, registered on receipt, never in a file; username under unofficial_username; no session text in audit, error or notice | ADDRESSED | Session strings registered on receipt: src/unofficial/sidecar.js:46-66 (prepareSession) through sessionRequest at :330-331 and restoreSession at :345. Store: src/unofficial-session.js:52-80 (secrets.set at :63). Audit line at src/cli.js:576 carries no value. The username is not registered in bare form: see F2-M-3. |
| (c) serve restore runs only when acknowledged and a session is stored; failed restore stops only the unofficial route with AUTH_EXPIRED; missing Python is UNOFFICIAL_ADAPTER_ERROR | ADDRESSED for the stated condition (src/unofficial-session.js:119 acknowledged, :122-125 not stored, :139-142 classification; start failure marked at src/unofficial/sidecar.js:281 and read at src/unofficial-session.js:139). Two gaps beyond the stated condition: F2-I-1 (the restore ignores routes.unofficial.enabled) and F2-M-6 (a sidecar that starts but cannot run is classified as an expired login). |
| (d) S-L1: child stderr line redacted whole before any display cut; straddling value masked; no part survives | ADDRESSED | src/unofficial/sidecar.js:114-116 (8192-character whole lines, 20 kept), :118-133 (no cut inside a line; over-limit line dropped), :149-159 (lastStderrText: redact(line.trim()).slice(0, 200) at :156, redact before the cut). The old session.stderr slice is gone (grep: no session.stderr). Close handler at :285 uses lastStderrText. Tests at test/sidecar.test.js (straddle, 1110-character line, 9000-character line). |
| (e) remote guard: serve refuses non-loopback without http.allowRemote; with it, serve starts and prints one warning line with no token; ig status sends the token only to loopback unless allowRemote, refusal exits 1 and sends no request | ADDRESSED (code). The README describes the serve warning as absent: F2-M-1. | assertServeHost src/cli.js:121-135 (allowRemote checked before the token, both before any listener; buildServe calls it first at src/cli.js:962, before createState). Warning src/cli.js:138-143, printed once at startServe src/cli.js:1153-1154 on stderr; no token in it. ig status refusal src/cli.js:694-698 returns refused_remote before any state read, token read or fetch; bin/ig.js sets exit 1 for it. Status warning src/cli.js:702 (non-loopback target only). |
| (f) mapping defaults (follow, unfollow, profileEdit to the sidecar) only when enabled and acknowledged; unacknowledged route is ROUTE_DISABLED | ADDRESSED | Defaults src/config.js:63 (adapterByFeature), :64 (python). Gate src/service.js:434-441 (enabled and acknowledged checked first, ROUTE_DISABLED), then the new route stop at :441-450 (STOPPED). Called from runOutbound at src/service.js:710 before any registry lookup; the registry is resolved only in perform (:1433 and following). Tests test/unofficial-session.test.js:"with the route not acknowledged" and "a config value that maps follow elsewhere". |
| (g) test stub for the stray warning (test/service.test.js:1989-1991) restores the original, and the test asserts what it claims | ADDRESSED. Restore: ctx.mock.method, restored at test end (scratch check above). Assertions: the test's own claims (reply sent, flag set and shown, refusal with no request) are at test/service.test.js:2006-2015. The comment at :1990 says the warning is "recorded"; it is not (F2-M-7). |
| (h) no new process listens on a port in a test; no test makes a network call | ADDRESSED. Every new listen is stubbed: test/cli.test.js (listen stub at the serve start tests, and startWithoutSocket). The only listen in test/ is test/http.test.js:883, a stub that throws (pre-existing, T-1). The status tests use a fetch stub in-process, or a child that loads test/fixtures/status-fetch-stub.mjs, which replaces fetch. The new unofficial-session tests spawn a non-existent executable (ENOENT, no process created) and use fake adapters. |
| (i) README: login command, remote guard, mapping defaults checked against the code | NOT ADDRESSED. Mismatches are listed in section 3 (F2-M-1 to F2-M-5, F2-M-8; F2-M-6 for the sidecar-start rule). |

---

## 2. Findings

Severity: Critical = a leak or a bypass of a safety gate. Important = a stated requirement or switch not honoured, or a wrong safety outcome. Minor = documentation, comment, test-gap or wording.

### F2-I-1 (Important): the restore at serve start ignores routes.unofficial.enabled

- Where: src/cli.js:1015-1021 (buildServe calls restoreUnofficialSession with acknowledged only); src/unofficial-session.js:118-119 (returns skipped only when not acknowledged).
- What happens: with routes.unofficial.enabled false (the documented off state: README:344; spec line 59 says the route "sits behind a config switch"), an ig serve start that finds a stored session still spawns the sidecar and sends restore_session. The sidecar calls client.account_info() (sidecar/ig_sidecar.py:169), an unofficial request to Instagram. The feature calls are refused with ROUTE_DISABLED (src/service.js:437), but the restore is not gated.
- Why it matters: the off switch does not stop the unofficial traffic that serve makes at start. src/cli.js:600 tells the owner that unofficial routes "also need routes.unofficial.enabled", which the restore contradicts.
- Tests do not cover it: every builtWith test uses configFrom, which sets enabled true (test/unofficial-session.test.js:46).
- Fix: gate the restore on effective.routes.unofficial.enabled === true as well (pass enabled to restoreUnofficialSession). Add a test with enabled false that asserts adapter.calls.restore.length === 0. Login may stay ack-only, which is an explicit command.

### F2-M-1 (Minor): README says ig serve prints no plain-HTTP warning; the code prints one

- README:92 ("prints no plain-HTTP warning"), README:378 ("It prints no warning about plain HTTP. That is a gap"), README:547 ("ig serve prints none ... a warning in ig serve would close it").
- Code: src/cli.js:138-143 (remoteServeWarning) and :1153-1154 (printed on stderr on a non-loopback start). Tests: test/cli.test.js "serve on a non-loopback host with http.allowRemote prints one plain-HTTP warning line".
- Fix: state the warning, its stream (stderr) and that a loopback start prints nothing; remove the "gap" sentences.

### F2-M-2 (Minor): the status warning is described as unconditional; the README also omits the new key from the config summary

- README:379: "When http.allowRemote is true, ig status prints this line". Code: src/cli.js:702 prints it only when the target is not loopback (if (remote)). With allowRemote true and a loopback or wildcard host, no line is printed.
- README:66 (config summary of http) lists host, port and allowedHosts, but not allowRemote (default false, src/config.js:80).
- Fix: "When http.allowRemote is true and the host is not loopback ..."; add allowRemote false to the http summary.

### F2-M-3 (Minor): README says the username is registered for masking; only its stored JSON form is

- README:417: "They are registered for masking when they are received." The session is registered on receipt (src/unofficial/sidecar.js:46-66). The username is not registered in bare form at any point: src/cli.js:556 trims it and does not register it; storeUnofficialLogin registers only the JSON wrapper {"username":...} through secrets.set (src/unofficial-session.js:63; src/secrets.js register). A bare username could therefore appear unmasked in a sidecar message.
- README:33 says "There are five secrets", while the login stores two more keyring entries (README:416-417).
- Fix: reword README:417 to say the session is registered and the username is stored as JSON, not registered; reword README:33 to say the five secrets, and the two keyring entries of the unofficial login described below. The brief's secret list does not include the username, so a code change is needed only if the owner wants the username masked.

### F2-M-4 (Minor): the test count is stale in the README and CLAUDE.md

- README:645-646 and CLAUDE.md:8 say 1204 tests. progress.md:484 and task-15-report.md ("Final round: serve warning", Counts) record 1208 on both Node versions for the serve-warning head, which the diff contains (src/cli.js:1153-1154; test/cli.test.js). The README was last written at 04:49:52 and CLAUDE.md at 04:49:12, both before the last test-file changes in the snapshot (test/cli.test.js at 04:52:02; test/mcp.test.js at 04:53:23), so the counts were not updated after the final tests were added.
- Fix: after the controller's next suite run, set both to the reported count.

### F2-M-5 (Minor): CLAUDE.md omits the login-unofficial command

- CLAUDE.md:8 lists routes (ack-unofficial, clear-one-reply-flag). bin/ig.js:239 adds login-unofficial.
- Fix: add login-unofficial to the list.

### F2-M-6 (Minor): README says a sidecar that cannot start is not an expired login; only a spawn failure is treated that way

- README:421: "A sidecar that cannot start is not an expired login." Code: only a spawn failure carries sidecarStart (src/unofficial/sidecar.js:281). Two cases reach the restore as a failed restore and set AUTH_EXPIRED (src/unofficial-session.js:142):
  - The script is missing or Python exits at start. The child closes, and teardown gives the generic exit message (src/unofficial/sidecar.js:285).
  - instagrapi is not installed. sidecar/ig_sidecar.py imports it inside _new_client (lines 101-104), so restore_session raises ImportError, which becomes api_error and UNOFFICIAL_ADAPTER_ERROR without sidecarStart.
- Fail-closed, and it clears on a later successful restore after the fix. But the serve message (src/cli.js:1215-1216) tells the owner to run login-unofficial again, which also fails until instagrapi is installed.
- Fix: narrow README:421 to a spawn failure, and say that a missing instagrapi or script gives the stop. Or classify ImportError and a missing script as unavailable.

### F2-M-7 (Minor): the comment on the emitWarning stub says the warning is recorded; it is not

- test/service.test.js:1990: "The warning for the failed audit write is recorded, not printed". Line 1991 is ctx.mock.method(process, 'emitWarning', () => {}), which records nothing, and no assertion checks a warning.
- Fix: record the calls and assert one warning with the error name only, or reword the comment to "suppressed".

### F2-M-8 (Minor): a remote serve needs the remote name in http.allowedHosts; neither the README nor the serve warning says so

- The Host check uses only the configured allowedHosts (src/http.js:180; hostAllowed at :186-189; refusal at :301-302). Loopback names are the default, so a client that connects to http://192.168.1.10:8788 sends Host 192.168.1.10:8788 and gets 403 unless that name is listed.
- ig status then prints "ig serve answered with an error (FORBIDDEN)" (src/cli.js:729), with no hint.
- README:378-379 and the warning (src/cli.js:142) do not mention allowedHosts.
- Fix: say in README:378-379 that the remote name must also be in http.allowedHosts, and say so in the 403 status text.

### F2-M-9 (Minor): the password refusal test does not check that the message omits the password

- test/unofficial-session.test.js:361-377 asserts kind VALIDATION only. The brief (a) asks for a message that does not echo the password.
- Fix: add !err.message.includes('short') (and the value it was given).

---

## 3. README against the code (item i)

| README line | Says | Code | Verdict |
|---|---|---|---|
| 92 | ig serve "prints no plain-HTTP warning" | src/cli.js:1153-1154 prints one | MISMATCH (F2-M-1) |
| 378 | "It prints no warning about plain HTTP. That is a gap" | same | MISMATCH (F2-M-1) |
| 379 | status prints the line "when http.allowRemote is true" | src/cli.js:702, non-loopback only | MISMATCH (F2-M-2) |
| 66 | http summary without allowRemote | src/config.js:80 default false | OMISSION (F2-M-2) |
| 33 | "There are five secrets" | the login also stores unofficial_session and unofficial_username (src/unofficial-session.js:11-12) | MISMATCH (F2-M-3) |
| 417 | username "registered for masking when received" | JSON form only (src/unofficial-session.js:63) | MISMATCH (F2-M-3) |
| 421 | "A sidecar that cannot start is not an expired login" | spawn failure only (src/unofficial/sidecar.js:281) | MISMATCH (F2-M-6) |
| 378-379 | remote use, no allowedHosts note | src/http.js:180, 301-302 | GAP (F2-M-8) |
| 344, 419, 423 | off by default; restore on acknowledgement; mapping gated by enabled and acknowledged | restore is not gated on enabled (F2-I-1); mapping gate matches (src/service.js:437) | MISMATCH with F2-I-1 (the README says the switch is enabled) |
| 645-646 | 1204 tests | 1208 recorded (progress.md:484) | MISMATCH (F2-M-4) |
| CLAUDE.md:8 | routes subcommands list | login-unofficial exists (bin/ig.js:239) | MISMATCH (F2-M-5) |

Checked and matching: the login command row (README:90) and its refusals (ROUTE_DISABLED, CONFIG; src/cli.js:550, 553); the prompts (README:413, bin/ig.js:70-81 with the same strings); the checks (README:414, src/cli.js:556-571 and src/unofficial-session.js:37-48); the stored output line (README:416, src/cli.js:577 exact text); the restore failure text (README:419, src/cli.js:1216 exact text); the no-session rule (README:418; sidecar no_session maps to UNOFFICIAL_ADAPTER_ERROR, src/unofficial/sidecar.js:23-25 and sidecar/ig_sidecar.py:122); the sidecar command (README:422, src/unofficial-session.js:21-26); the mapping defaults and NOT_SUPPORTED (README:423, src/config.js:63, src/unofficial/adapter.js:37, src/unofficial/jslib.js:9); the stderr text (README:425, src/unofficial/sidecar.js:114-115); the status refusal text and exit code (README:379, src/cli.js:695-698; bin/ig.js status command); the serve refusal order (README:378, src/cli.js:121-135).

---

## 4. Observations (not counted)

- The session JSON is written to the Windows Credential Manager with no size check. A Windows generic credential's blob is capped at 2560 bytes (CRED_MAX_CREDENTIAL_BLOB_SIZE, Win32 documentation). I did not measure a real session. If the write is refused, the login fails with CONFIG and nothing is stored (src/unofficial-session.js:52-80 rolls back). Check the stored size in the live phase.
- The restore at serve start also runs one account_info() request each start (F2-I-1 covers the enabled gate).
- The keyring-unavailable case sets the route stop (src/unofficial-session.js:122-125). This is documented at README:419 and fail-closed.
- The two-factor code is not registered (too short for the registry). The Python side scrubs it from messages (sidecar/ig_sidecar.py SECRET_PARAMS). Nothing in the JS side prints it.
- The spec (line 73: "Sidecar session state is kept only in the credential store") agrees with the keyring-only session. The only divergence from the spec or the README found in the new code is F2-I-1 (the restore ignores enabled).

---

## 5. Round verdict

Findings remaining. Critical 0. Important 1 (F2-I-1). Minor 9 (F2-M-1 to F2-M-9).

The safety items (a) to (h) are addressed in code. The open work is the enabled gate on the restore (F2-I-1) and the README and test-comment corrections (F2-M-1 to F2-M-9).
