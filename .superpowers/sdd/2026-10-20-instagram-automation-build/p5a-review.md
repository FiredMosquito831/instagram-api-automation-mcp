# P5a review (round 1)

Scope: package P5a, base p4-final, head p5a-head, read from `review-p5a.diff` (2,191 lines, read in full). Paths below are relative to `D:\Projects2\InstagramApi`. Read-only: no project file was edited, `npm test` was not re-run, and no git command was run.

Checks run, all against the project modules, with scripts kept in the scratchpad:
- `p5a-check.mjs`: token-shape boundaries, ordinary words, escaped forms of a value with a quote, a backslash and a newline, registry refusals, Graph classification and subcode, sidecar line splitter over 20,000 lines in random chunks (exact split, buffer never longer than one line), and timings of adversarial 140 KB to 480 KB inputs to the full `redact`.
- `p5a-regex.mjs`: scaling of the token-shape pattern alone at 100,000, 200,000, 400,000 and 800,000 characters, on seven adversarial shapes; idempotence of `redact` over 20,000 mixed strings.
- `p5a-order.mjs`: identifiers that start with a prefix, prose with `EAA-`, and conflicting Graph signals.
- `p5a_py_check.py`, run with `python -I -B`: the forms that `_secret_forms` builds, and `_safe_message` on JSON, raw, URL and cookie forms of the password and session values.

## Verdicts

**(a) O-2 token shape: ADDRESSED for the shape, the prefixes, the minimum length, the Bearer headers and ReDoS. NOT ADDRESSED for the ordinary-word sub-check (M-1, M-2).**
- Prefixes: `src\redact.js:108` covers IGAA, IGQV and EAA. EAAB begins with EAA, so it is covered.
- Minimum length: 20 token characters after the prefix, so 23 characters in all. `EAA` plus 19 characters is not masked. `EAAB` plus 19 characters is masked. Checked in `p5a-check.mjs`.
- Bearer headers: masked. `Authorization: Bearer EAAB...` gives `Authorization: Bearer [redacted]` (`src\redact.js:28`, `:32`).
- ReDoS: `TOKEN_SHAPE` is linear. Doubling the input from 100,000 to 800,000 characters roughly doubles the time on every shape (at most 38 ms at 800,000). The full `redact` on the adversarial inputs took at most 172 ms. The pattern has one fixed prefix alternation and one bounded class with no nested quantifier, and it cannot backtrack across a run.
- Ordinary words: `EAAGLE`, `IGAAS` and `EAA-1` are not masked (`test\errors.test.js:618`, checked again in `p5a-check.mjs`).
- NOT ADDRESSED: prose and identifiers that start with a prefix or with `bearer` are masked (M-1, M-2).

**(b) Escaped forms: ADDRESSED.**
- The JSON-escaped form is `JSON.stringify(value).slice(1, -1)` (`src\redact.js:201`). The URL-encoded form is `encodeURIComponent` (`src\redact.js:197`).
- With the value `ab"cd\ef<LF>gh-12345` registered: the raw form, the JSON form inside a JSON string, the URL-encoded form, an object value, a JSON string nested in an object, and an object key were all masked. Checked in `p5a-check.mjs`.
- `maskRegistered` (`src\redact.js:211-219`) reads the same registry, so events and drafts get the new forms too.
- Parity with the Python side is not complete (M-6).

**(c) Registry refusals: ADDRESSED, with a wording note.**
- Under 8 characters, or blank: refused with VALIDATION (`src\redact.js:186-190`).
- The marker check (`src\redact.js:203-205`) refuses a value that occurs inside `[redacted]`, such as `redacted` or `[redacted]`. Checked.
- The check now runs over all three forms. No value that the raw check accepted is newly refused, because a JSON or URL form can be inside the marker only when the raw value is too.
- Wording note: the rule refuses a value that occurs inside the marker, not one that contains it. `abc[redacted]def` is accepted. That is the correct rule, because the growth case is a value inside the marker. The brief's wording "values containing [redacted]" is the reverse, and the P5a report should state the rule as coded.

**(d) Python scrub: ADDRESSED.**
- `_secret_forms` (`sidecar\ig_sidecar.py:228-239`) builds the raw value, the JSON form with and without non-ASCII escaping, `quote(safe="")`, `quote(safe="!*'()~")` (the encodeURIComponent set) and `quote_plus`. `_safe_message` (`:242-252`) replaces each form, longest first, for each value in `SECRET_PARAMS` (`:44`, password and verificationCode) and for every string in the session.
- Checked under `python -I`: the JSON, raw, URL and token forms were masked, and an ordinary message was unchanged. The output of the check has no leak.
- The Python test file has `SKIP = 'skip: python not found on PATH'` (`test\sidecar-python.test.js:31`), and the four scrub tests use it (`:209-229`).
- No print or stderr write carries a value. The logging calls at `sidecar\ig_sidecar.py:271`, `:275` and `:277` carry the method name, an exception kind or a class name. The only `print` added is inside the test script.
- `SidecarError` messages (`:272`) are returned without `_safe_message`. They are fixed texts or field names, so no value can reach them.

**(e) Classification: ADDRESSED, with M-4.**
- Order in `src\errors.js:73-90`: code 190 (AUTH_EXPIRED), then HTTP 429 and codes 4, 17, 32, 613 and 80002 (RATE_LIMITED), then 368 (ACTION_BLOCKED), then the feedback phrase (ACTION_BLOCKED), then the checkpoint, challenge and two-factor phrases (CHECKPOINT), else API_ERROR.
- A structured code wins over a conflicting text (`test\errors.test.js:575` onward, and checked in `p5a-check.mjs`).
- The detail carries `signal` as `code`, `text` or `none` (`src\errors.js:72-97`). It never carries message text (`test\errors.test.js:596`, checked).
- M-4 is the one case where two structured signals conflict.

**(f) BOM: ADDRESSED.** `src\config.js:87` reads the file as UTF-8, so the BOM arrives as U+FEFF. `src\config.js:93` strips it before `JSON.parse` (`:96`). A file that is not JSON still gives "is not valid JSON" (`:98`). Tests at the end of `test\config.test.js`.

**(g) Sidecar buffer: ADDRESSED, with M-5.**
- `splitLines` is at `src\unofficial\sidecar.js:33-42`, and `receive` uses it at `:184-197`.
- 20,000 lines fed in random chunks of 1 to 3,000 characters split exactly. The buffer never exceeded one line (77 characters in that run). A carriage return split from its line feed across chunks is removed.
- The size check (`:186`) compares the buffer plus the chunk, as before.
- The splitter does not slice the remainder for each line, so the quadratic copy is gone. It does slice each line once (`:38`) and the tail once (`:41`). The comment and the report say "once per chunk", which is wrong (M-5).

**(h) Secrets in output: ADDRESSED.** No added line in the diff calls `emitWarning`, `console`, `audit.record` or `print`, and no added line writes a value. The new throws carry fixed texts or redacted IgError messages. The new notices (`events.cursors`, `events.index`, `state.repair`) carry reasons and counts only. The recovery note (`recoveryNote`, `src\cli.js`) carries the reason, counter text, a damaged-line count and two fixed notes. No new Python log call was added.

**(i) No network in tests: ADDRESSED.** No added line calls `listen`, `createServer`, `fetch` or a URL. `buildServe` does not call Graph: `verifyOwner` runs only in `runServe` (`src\cli.js:830`), and `poller.start()` runs only there (`:857`). The new cli tests pass a fake `fetchImpl`, and the privateReply test asserts zero requests.

**(j) Subcode: ADDRESSED.** The subcode is read only into the details (`src\errors.js:96`). `src\service.js:127` formats it into the stop detail text for display. No classification reads it. Checked: subcodes 368, 190 and 80002 alone leave the kind at API_ERROR.

## Findings

Counts: Critical 0. Important 1. Minor 6.

### I-1 (Important): the package contains a second change set, and the P5a report does not describe it

- The diff from p4-final to p5a-head changes 25 files. The P5a report (`task-2-report.md`, the P5a section) lists 9 (line 820), so 16 are not described. Beyond the nine, the diff changes `README.md`, `src\audit.js`, `src\caps.js`, `src\cli.js`, `src\events.js`, `src\guard.js`, `src\service.js`, `src\state.js`, `src\tools.js`, and the tests `audit`, `caps`, `cli`, `events`, `guard`, `state` and `tools`.
- Those changes are the P4-final fixes N-1 to N-8 (`progress.md`, the P4 final entry, around line 444). They are not in the P5a checklist, so this review checked them only for (h) and (i).
- The report says "Nothing in the service, the poller, the HTTP server or the MCP module changed" (line 814). `src\service.js` (`stopClear`, `eventsPending`) and `src\tools.js` (the `ig_like` description) did change.
- The counts show the N-fix changes were already in the tree when P5a started. The diff adds 37 net tests (`errors` 11, `config` 2, `sidecar` 3, `sidecar-python` 4, and 17 from the N-fix files). So p4-final holds 1016 minus 37, which is 979. The report's "before" figure of 996 is 979 plus the 17 N-fix tests. The p4-final snapshot therefore does not match the state P5a started from.
- I found no implementer report for N-1 to N-8 in the review folder.
- Action: take the real pre-P5a state as the base, or review the N-fix changes as a separate package with its own report. Correct the P5a report at lines 814, 818 and 820.

### M-1 (Minor): `bearer` in ordinary prose is masked

- `src\redact.js:28` (`BEARER`) masks the word after "bearer" in any text. Measured: `the bearer of this letter is valid` gives `the Bearer [redacted] this letter is valid`.
- The rule predates P5a and is unchanged. It is fail-closed, but it fails the ordinary-word check in (a).
- Suggestion: narrow it to a credential-shaped run, for example a minimum length or a digit in the run, and keep the header form, `Authorization: Bearer <value>`, masked. The owner should choose the trade-off.

### M-2 (Minor): the token-shape rule masks uppercase identifiers and prose that start with a prefix

- `src\redact.js:108`. Measured: `IGAA_ENABLE_LOGGING_FEATURE` gives `[redacted]`, and `EAA-compliant-standard-document` gives `[redacted]`. The rule accepts `_` and `-` as token characters.
- O-2 accepts "a small chance of over-masking", but this is more than small for words that start with these prefixes.
- Suggestion: raise the minimum, or require a digit and mixed case in the run. The registry stays the control, and the owner can supply real token lengths from the live phase.

### M-3 (Minor): a token directly after a letter or digit, or after an escape such as `\n` or `%0A`, is not masked by the shape rule

- `src\redact.js:108`, the lookbehind `(?<![A-Za-z0-9])`. Measured and left unchanged: `tokenEAAB` followed by 20 characters; `first\nEAAB` (a JSON newline escape) followed by 20 characters; `x%0AEAAB` followed by 20 characters. Each stays unmasked.
- A registered value is still masked in all these places, so the gap is for unregistered tokens only.
- Suggestion: treat a backslash escape or a percent escape before the prefix as a boundary.

### M-4 (Minor): two structured signals that conflict resolve to the less severe stop

- `src\errors.js:76` checks HTTP 429 and the codes 4, 17, 32, 613 and 80002 before `src\errors.js:79` checks code 368. Measured: `mapGraphError({ status: 429, body: { error: { code: 368 } } })` gives `RATE_LIMITED`.
- The guard ranks ACTION_BLOCKED above RATE_LIMITED (`src\guard.js:31-32`). Only ACTION_BLOCKED halts the poller. The README "Stops and recovery" section says RATE_LIMITED does not halt it.
- O-1 asks for the fail-closed reading, so the more severe stop should win.
- Suggestion: check code 368 before the rate-limit codes. Code 190 stays first. Outbound actions are refused under either stop, so the effect is on the poller only.

### M-5 (Minor): the splitter's comment and the report say "once per chunk", and that is wrong

- `src\unofficial\sidecar.js:31-32` and the P5a report item 5 say the text is sliced once per chunk, not once per line. The code slices each line (`:38`) and the tail (`:41`).
- The behaviour is right, because the remainder is no longer copied for each line. Only the description is wrong.

### M-6 (Minor): the JS and Python forms of a secret differ

- JS (`src\redact.js:197-201`) registers the raw, encodeURIComponent and JSON-escaped forms. Python (`sidecar\ig_sidecar.py:233` and `:237`) also masks the ASCII-escaped JSON form (`\uXXXX`) and the `quote_plus` form, where a space is `+`.
- The tokens named in O-2 are ASCII and have no spaces, so the effect is nil today. A secret with a space, or with a non-ASCII character, would be masked in Python error text and not on the JS side.
- Suggestion: register the same forms on both sides, or record the difference.

## Notes (not counted)

- N-1: the registry rule as coded is "a value that occurs inside `[redacted]`" (see (c)). The P5a report and the brief should say so.
- N-2: the token-shape pattern stops at `.`, `|` or `%`, so a token containing one of them is masked only up to it. The registry covers registered values.
- N-3: a double-encoded JSON form is not registered. The P5a report states this, and it is a documented limit.

## Round verdict

FINDINGS REMAINING. Critical 0, Important 1 (I-1), Minor 6 (M-1 to M-6). The checks (b) to (j) hold. Check (a) holds for the shape, the prefixes, the minimum length, the Bearer headers and ReDoS, and fails only the ordinary-word sub-check (M-1, M-2).
