# P5a round 1 and the P4 one-reply flag: focused review

Scope: the diff `review-p5b.diff` (p5a-head to p5b-head). It contains the P5a round 1 changes, the P4 fix round 2 changes (N-9 to N-14) with the one-reply flag, and P5b. As instructed, `src/http.js`, `src/mcp.js` and their tests were ignored. `src/config.js` is not in this diff (the BOM change is in p4-final to p5a-head), so (d) was checked on the live file, which matches `snap\p5b-head`. Read-only: no project file was edited, no git command was run, and `npm test` was not re-run.

Checks run (scratch scripts in `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\`, project modules imported read-only):
- `r1-regex.mjs` and `r1-full.mjs`: timing of TOKEN_SHAPE (copied from redact.js:116-119) and of full `redact` on adversarial inputs.
- `r1-checks.mjs`: classification combinations; registry forms; token-shape and Bearer cases; config BOM; sidecar splitter on 20,000 lines in random chunks; one-reply rebuild with a torn audit line.
- `r1_py.py`, run with `python -I -B`: Python `_secret_forms` and `_safe_message`.
- `r1-restore.mjs`: whether a failed `state.save()` keeps an unsaved value in memory.

## Verdicts

**(a) Token shape: PARTLY ADDRESSED (ReDoS NOT ADDRESSED).**
- Whole-token boundary (M-2): ADDRESSED. `src\redact.js:117-118`: the run must end at a non-token character, and it needs a digit, a lower-case and an upper-case letter. Checked: `IGAAMAX_LIMIT`, `IGAA_ENABLE_LOGGING_FEATURE` and `EAA-compliant-standard-document` are unchanged; a whole token is masked.
- Escape boundaries (M-3): ADDRESSED for the escapes named in the finding. `src\redact.js:117`: `(?<=\\[nrtbf])` and `(?<=%(?:0[AaDd]|09|20))`. Checked: `first\nEAAB...` gives `first\n[redacted]`; `x%0AEAAB...` gives `x%0A[redacted]`. A token glued to a letter or digit is not masked (see M-R1-3).
- `_` and `-` restore: ADDRESSED. `src\redact.js:117`: the lookbehind is `(?<![A-Za-z0-9])`, so `_` and `-` count as a boundary. Checked: `config_IGAAQV...` gives `config_[redacted]`, and `config-IGAAQV...` gives `config-[redacted]`. The tests are `test\errors.test.js:677, 681, 685`.
- Bearer rule (M-1): ADDRESSED. `src\redact.js:30-31` masks only a token-shaped run. `the bearer of this letter is valid` is unchanged. `Authorization: Bearer <token>` is masked by the AUTHORIZATION rule (`src\redact.js:34`).
- ReDoS: NOT ADDRESSED. The Bearer pattern is linear (200,000 spaces: 8 ms; a 200,000-character run: 3 ms). TOKEN_SHAPE is quadratic. See M-R1-1. The round 1 report's claim that regex timing stays linear is wrong for this input family.

**(b) Escaped forms: ADDRESSED.**
- JS registry (`src\redact.js:196-206`, unchanged in round 1, checked live): for the value `ab"cd\ef<LF>gh-12345`, the raw form, the `encodeURIComponent` form and the single JSON-escaped form are all masked, both alone and inside an object.
- Python (`sidecar\ig_sidecar.py:228-238`, the M-6 change): `_secret_forms` gives the URL form, the JSON form and the raw value, the same as the JS registry. `_safe_message` (`:241`) masked every checked message. The parity test is `test\sidecar-python.test.js:266`.
- Not registered, as documented in P5a: a value that is JSON-encoded twice.

**(c) Conflicting signals (M-4): ADDRESSED.** `src\errors.js:82-92`: each matching signal is a candidate, and the most severe wins; a tie keeps the earlier one. Checked: code 190 with checkpoint text gives AUTH_EXPIRED by code. Code 4 or HTTP 429 with checkpoint text gives CHECKPOINT by text. Code 368 with HTTP 429 gives ACTION_BLOCKED by code. Code 190 with HTTP 429 gives AUTH_EXPIRED. The detail holds `status, code, subcode, signal` only; the message text is not in it. The ranks in `SEVERITY` (`src\errors.js:41-46`) agree with `STOP_RANK` in `src\stops.js:11` for the four kinds (see M-R1-4).

**(d) BOM (A-34) and sidecar buffer (A-30): ADDRESSED.**
- BOM: `src\config.js:93` removes U+FEFF before `JSON.parse`. A BOM-prefixed file parses; the not-JSON error is unchanged.
- Buffer: `src\unofficial\sidecar.js:34-45` (`splitLines`) and `:185-198` (`receive`). 20,000 lines in random chunks split exactly; the held remainder never exceeded 44 characters. The comment was corrected to "each complete line is sliced once, and the unfinished tail once per chunk" (`:30-33`), which is M-5.

**(e) One-reply flag: PARTLY ADDRESSED (I-1).**
- A failed one-reply scan sets `oneReplyUnknown`: ADDRESSED for a failed scan (`src\cli.js:710` and `:713-725` in `recoverFromAudit`; `:620-654` in `retryOneReplyRecords`). NOT ADDRESSED for a damaged or missing privateReply line: the scan succeeds and no flag is set. See I-1.
- A confirmed clear does NOT clear it: ADDRESSED. `src\service.js:821-836` (`stopClear`) changes only the `recovery` record. Test `test\cli.test.js:1791`.
- privateReply is refused locally with no request while set: ADDRESSED. `src\service.js:1219-1222`, before `runOutbound`. The test asserts zero requests. Exception: M-R1-2.
- A later start that rebuilds successfully clears it: ADDRESSED. `src\cli.js:811` (the retry on a start that does not recover) and the `writeAll` else branch (`:713-725`). Checked by the test at `test\cli.test.js:1791`.
- The status shows it: ADDRESSED. `src\service.js:809`, `src\cli.js:533` (`localSummary`), and the start note at `src\cli.js:936-938`.

**(f) No secret or message text in new output: ADDRESSED.** No new `console`, `emitWarning` or `print` in the reviewed files. The new audit details carry counts or the error kind (`src\cli.js:620-654`: `failure = err.kind ?? err.code ?? 'error'`). The new throws use fixed text (`src\caps.js:424-426`, `src\service.js:1221`). The one `emitWarning` on this path (`src\service.js:378`, `safeAudit`) carries the error name only.

**(g) Fail-open paths: FINDINGS (I-1, M-R1-1, M-R1-2, M-R1-3).** No classification gives a less severe stop. No path clears the flag on a clear. A privateReply goes through with the flag set only in M-R1-2 (in-process, narrow).

**(h) No network, no listener in tests: ADDRESSED.** No added line in the reviewed test files calls `listen`, `createServer`, a real `fetch` or a URL. The cli tests use the stub `fakeGraph` (`test\cli.test.js:1397`). The scratch checks used no network.

## Findings

### I-1 (Important): the one-reply rebuild treats a damaged or missing privateReply line as "no reply"

- `src\caps.js:430-447`: `rebuildPrivateReplies` calls `audit.scanSince` and discards its result. The damaged count (`src\audit.js:123` and `:128`, returned at `:137`) never reaches the caller. The function returns only `{ privateReplies, unusable }`.
- `src\cli.js:677` treats a returned scan as success, so no flag is set (`:710`).
- `src\service.js:374-380` (`safeAudit`) is best-effort. If the audit write for a sent privateReply fails, the line is missing, and only a warning is emitted.
- Measured (`r1-checks.mjs`): an audit file with a valid privateReply line for comment `1111111111111111` and a torn privateReply line for `2222222222222222`. The rebuild returns a record for the first comment only, with no error. The scan reports `damaged: 1`.
- Trigger: the state is unreadable or lost, so the live record is gone, and a privateReply line is damaged or missing within 7 days. A second private reply to that comment is then not refused locally. The Graph window check still allows it while the comment is within 7 days.
- Fix: return the damaged count from `rebuildPrivateReplies`. Treat a damaged line in the window as an unknown scan, which sets the flag (`cli.js`). For a privateReply whose audit write fails, set the flag as well. Cost to state to the owner: `audit.js:123` and `:128` count damaged lines in every retained file, not only in the window, so the flag stays until the file rotates out.

### M-R1-1 (Minor): TOKEN_SHAPE is quadratic on a long run with separators

- `src\redact.js:116-119`. The lookaheads at `:117` scan the whole run after each prefix that passes the boundary. Any `EAA-` or `IGAA_` repetition with no digit (or no lower-case letter) triggers this.
- Measured (`r1-regex.mjs`): `EAA-` repeated, 25,000 / 50,000 / 100,000 / 200,000 characters: 179 ms / 705 ms / 2.8 s / 11.3 s. `IGAA_` repeated at 200,000 characters: 9.0 s. Full `redact` (`r1-full.mjs`): 100,000 characters of `EAA-` take 3.0 s; 2,200 characters take 3.8 ms.
- Reach: Instagram's text limits (comments 2,200 characters, DMs 1,000 bytes) and the signed webhook limit it. The widest path is sidecar error text, which can be up to `MAX_BUFFER_CHARS` = 16 MiB (`src\unofficial\sidecar.js:10`).
- Fix: one linear pass over the `[A-Za-z0-9_-]+` runs, then the prefix and mix check per run, or bounded lookaheads with a documented window.

### M-R1-2 (Minor): a flag held only in memory can be dropped by a later failed save

- `src\state.js:287-305`: a failed `save()` restores memory to the last saved image (`restoreImage`, `:91-94`, `:301`). `r1-restore.mjs` confirms that an unsaved key is gone from memory after one failed save.
- `src\cli.js:713-725` re-sets the flag only after its own save. A save that throws on a pending copy keeps memory (`state.js` throws before the restore), so the flag survives that save. If a later save copies aside and then fails to write, the restore drops the flag. `src\service.js:1219` then stops refusing privateReply in this process.
- A restart is safe: the damaged file was never replaced, so the recovery runs again and sets the flag.
- Fix: hold the flag in a process variable, as `heldMarker` does in `src\events.js:785-800`, and check it in `privateReply`.

### M-R1-3 (Minor): a token glued to a letter or digit is not masked by the shape rule

- `src\redact.js:117`: `tokenIGAAQV...` and `9IGAAQV...` are not masked. The test `test\errors.test.js:666` pins this. The registry still masks registered values.
- The choice is deliberate and documented in the P5a wording (item 2), but it is a shape-rule fail-open, and O-2 asks for fail-closed. The owner should accept or change it.

### M-R1-4 (Minor): stale description and a duplicate severity table

- `src\errors.js:39` and `:67` say the ranks are `STOP_RANK` in `src\guard.js`. That table now lives in `src\stops.js:11`, and `src\guard.js:10` imports from `stops.js`.
- `SEVERITY` (`src\errors.js:41-46`) copies that table. Import `rankOf` from `stops.js` so the two cannot drift.

## Notes (not counted)

- Accepted trade-off, as O-2 allows: `_` and `-` are a boundary, so a mixed-case identifier such as `config_IGAA_Mixed_Case_2` is masked (`src\redact.js:117`).
- Accepted under O-1: the broad CHECKPOINT text (`src\errors.js:49`, `challenge`) can classify an unrelated error as CHECKPOINT.
- Not reviewed in depth: the N-11 and N-13 logic in `src\events.js` and `src\guard.js` / `src\stops.js`. I read the diff, checked the flag paths, and found no defect there, but I did not trace every branch.

## Round verdict

FINDINGS REMAINING. Critical 0, Important 1 (I-1), Minor 4 (M-R1-1 to M-R1-4). The round 1 items (M-1 to M-6 and I-1 of the P5a review) are addressed. The P5a review's ReDoS verdict, which the round 1 report relies on ("regex timing stays linear"), is wrong for the separator input (M-R1-1).
