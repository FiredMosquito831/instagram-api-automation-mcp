# Task 3 report: state and the event log

**Status:** DONE_WITH_CONCERNS
**Tests:** `npm test` exits 0 with 134 of 134 passing: 103 existing, 9 state, 22 events.
**Node:** v24.6.0 (the only Node on this machine; engines is `>=22.12.0`, and every API used exists in 22).

## Files changed

New files only. Nothing else was edited.

- `D:\Projects2\InstagramApi\src\state.js` (new): `createState`, and `writeFileAtomic`, which is exported for `events.js`.
- `D:\Projects2\InstagramApi\src\events.js` (new): `createEventLog`.
- `D:\Projects2\InstagramApi\test\state.test.js` (new): 9 tests.
- `D:\Projects2\InstagramApi\test\events.test.js` (new): 22 tests.
- `D:\Projects2\InstagramApi\.superpowers\sdd\2026-10-20-instagram-automation-build\task-3-report.md` (this file).

Not changed: `package.json` (the test script is unchanged, per R9), `src/config.js`, `src/errors.js`, `src/redact.js`, `src/audit.js`. Their modification times predate this session. Nothing was installed (R3 does not apply). No commit was made (R2): the full run `npm test` replaces the commit step.

Both modules use only Node built-ins (`node:fs`, `node:fs/promises`, `node:path`) and the Task 2 `IgError`, `redact`. Neither module makes a network call.

## TDD evidence

### RED: tests written first, before any implementation

Command: `npm test`. Both new test files failed to load, because `src/state.js` and `src/events.js` did not exist. The 103 existing tests passed.

```
✖ test\events.test.js (169.0565ms)
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\events.js' imported from D:\Projects2\InstagramApi\test\events.test.js
✖ test\state.test.js (162.4467ms)
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects2\InstagramApi\src\state.js' imported from D:\Projects2\InstagramApi\test\state.test.js
ℹ tests 105
ℹ pass 103
ℹ fail 2
```

### GREEN: after the implementation

- `test/state.test.js` alone: 8 of 8 pass (before the save-failure test was added later).
- `test/events.test.js` alone: 22 of 22 pass, on the first run.
- Full suite, after the implementation: 133 of 133.
- Full suite, after the review fixes listed below: 134 of 134.
- Final run (`npm test`, exit 0):

```
ℹ tests 134
ℹ suites 0
ℹ pass 134
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 953.6871
```

The 22 event tests passed on the first run. Passing that early is a reason to check that they can fail, so I ran a mutation check (below).

### Mutation check

A scratch script (`D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\mutate.mjs`) applies one deliberate bug at a time to a scratch copy of the project, then runs the Task 3 tests. It is not part of the suite.

- Round 1: 22 of 23 bugs were caught. One survived: a non-canonical cursor (`YzV`, which decodes to seq 5) was accepted if its seq had been issued. The test had issued only seq 1, so the unissued check refused it for the wrong reason. Fixed by issuing seq 5 first and asserting that the canonical cursor is accepted.
- Round 2, after the fix: 23 of 23 bugs were caught. Output is in `...\scratchpad\mutation-results.txt`.

The 23 bugs covered: `events.issued` lowered, an unissued or backwards ack, purge ignoring acked or the boundary, a torn tail kept or refused, an acked value above issued, a stored value coerced, raw text returned, a repeated id accepted, `hasId` wrong, `markRead` wrong, an unread check off by one, a decision not stored, a non-canonical cursor, an unterminated line merged, purge not writing, a corrupt file not moved aside, a non-atomic save, a NaN accepted, and a state getter returning the stored object.

## Behaviour and decisions

Where the brief is silent, or where two sources disagree, the choice is listed here.

1. **`events.issued` is the maximum seq returned so far.** The brief says "the last seq it returned". A later, smaller batch would lower it, and `ack` would then refuse a cursor that was really issued. The test "pending never lowers events.issued" covers this.
2. **Purge also requires `seq <= events.acked`.** The brief's literal rule removes any handled event older than retention. The global constraint says pending events are kept "until they are acknowledged and decided". The two conflict for an event that is decided but not acknowledged. I followed the global constraint. Test: "purge keeps a decided old event until it is acknowledged". **Needs a ruling.**
3. **`createState` returns a `movedAside` property**, the path of the moved-aside file, or null. This is an addition to the brief's interface. A moved-aside state is empty, so a stop kept in it is lost and outbound actions could resume. Task 4 or Task 17 must check `movedAside` before allowing outbound actions. The code comment says so.
4. **`receivedAt` is optional on `append`.** It defaults to the clock. A supplied value must be an ISO 8601 time with a zone, and it may not be more than 5 minutes ahead of the clock.
5. **Error kinds.** Refused caller input is `IgError('VALIDATION')`. Damaged or inconsistent stored data is `IgError('CONFIG')`. `errors.js` is locked, so no new kind was added.
6. **Damage rules, which are fail-closed.** A last line with no newline that does not parse is torn: reads skip it, and the next `append` removes it. A last line with no newline that does parse is kept, and the next `append` starts on a new line. Any other damaged line, or a seq that is not increasing, makes `createEventLog` throw `CONFIG`, so the service does not start until the file is repaired.
7. **`append` refuses a repeated id** (`VALIDATION`). Callers should call `hasId` first. The check and the write run without yielding, so two calls in one process cannot store the same id twice.
8. **Output is redacted.** `pending`, `append` and `decide` return `redact()` copies. The stored text is kept as written, as the brief says.
9. **`save()` is synchronous** and returns nothing, so the synchronous event log can call it. `createState` is async, as the brief specifies.
10. **Cursors are canonical only.** `decodeCursor` re-encodes the seq and compares. Seq 0 and leading zeros are refused.
11. **`pending` default limit is 20.** A limit must be an integer of 1 or more.
12. **`decide` replaces an earlier decision.** The brief does not say, and nothing sends in between.
13. **`unreadSenders` returns sender ids** ordered by each sender's newest event, oldest first.
14. **Every call re-reads the whole event file.** That is fine at owner scale with 30-day retention.
15. **`receivedAt` and the 24-hour window.** The `dmSend` window will rely on `lastInboundAt`, which returns `receivedAt`. If Tasks 10 and 11 do not pass the message's own time, the window is measured from receipt.

## Self-review

I read the full diff of `src/state.js` and `src/events.js`, and the changed parts of both test files. Fixed during review:

- `writeFileAtomic`: a failing cleanup `rmSync` could replace the original error. The cleanup is now guarded.
- The malformed-cursor test passed for the wrong reason (see the mutation check).
- The decide test checked only the return value, not the stored decision. It now reads the decision back through `pending`.
- No test covered a failed save. Added: "a save that fails leaves the previous state file in place".
- Comments: wording was corrected, and two lines over 120 characters were split. The `isState` check was extracted into a helper.

Checked: all 11 test names from the brief appear unchanged. Every event output (`pending`, `append`, `decide`) passes through `redact`. Node built-ins only. The module is given no tokens. Its files hold cursors, read markers, events and the owner's inbound text, as the brief specifies.

Known limits:
- Only Node v24.6.0 was available, not 22.12.
- Corrupt state is handled as the brief says (moved aside, state starts empty). See decision 3.
- The event file is re-read on every call (decision 14).

## Concerns for the controller

1. A moved-aside state is empty, so a stop held there is lost. Task 4 or 17 must check `movedAside`.
2. Purge keeps decided but unacknowledged events, which departs from the brief's literal rule (decision 2). Needs a ruling.
3. Tasks 10 and 11 should pass the message's own time as `receivedAt`, or the 24-hour window is measured from receipt.

---

## Fix round 1

Covers the review items I-1, I-2, M-2, M-3 and M-7, and M-10 (a) and (b). Deferred items M-1, M-4, M-5, M-6, M-8, M-9 and M-10 (c) are untouched.

**Result:** `npm test` passes 141 of 141. The total was 134 before this round: 103 existing, 11 state and 27 events now.

### What changed

- **I-1 (`src/state.js`).** `createState` keeps `saved`, the JSON text of the last image that was loaded or written. `save()` writes the state. If the write throws, it restores `saved` into memory and rethrows. So a failed save leaves memory equal to disk. This covers `ack`, `pending` and `markRead`, which each call `set` and then `save`.
- **I-2 (`src/state.js`).** Recovery from a file that is not a JSON object now does three things, in order:
  1. Sets `stop` to `{ stopped: true, kind: 'STATE_CORRUPT', detail: 'state file unreadable; moved aside to state.json.corrupt', since }`.
  2. Copies the corrupt file to `file.corrupt`.
  3. Writes the state, with the stop, to `file` in one atomic write.

  `movedAside` is kept for in-process logging.
  - **Deviation: copy, not rename.** A rename leaves no state file until the write succeeds. If that write fails, or the process stops between the two steps, the next start finds no state file and forgets the stop, which is the failure I-2 describes. With a copy, the state file is replaced atomically and is never absent. If the write fails, the corrupt file is still in place, and the next start repeats the recovery.
- **M-2 (`src/events.js`).** Two changes, because the requested fix alone does not pass the requested test:
  - `events.lastSeq` is saved in the state on every append, before the event line is written. The next seq is `max(lastSeq, issued, acked, highest seq in the file or its header) + 1`.
  - `events.lastSeq` lives in the state file, and the state file is the thing that is lost. After a purge empties the events file, nothing would remember that seq 3 was used, and the next seq would be 1. So a purged file now starts with a header line, `{"lastSeq":N}`, which records the highest seq the file has held. `readStore` reads it only as the first line. `purge` and `decide` write it. No event is kept beyond retention to do this. **Format change:** the first line of the events file may now be this header.
- **M-3 (`src/events.js`).** `append` writes through `appendEvent`, which opens the file with `'a'`, writes, calls `fsyncSync` on the descriptor, and closes. The append path is `append` → `appendEvent` (`events.js` lines 183 to 191 and 291). An fsync cannot be observed in-process, so no test covers it, and the mutation check below confirms that.
- **M-7 (`src/redact.js`, `src/events.js`).** `redact.js` gains one export, `maskRegistered(text)`. It replaces each registered value with the marker, longest first, by split and join, and does no pattern matching. A diff against `snap/task-2-fix5-head` shows that the only change is the appended function. `events.append` stores `maskRegistered(text)`. Ordinary text is unchanged.
  - Not changed: `decide` still stores the draft as given. The instruction scoped the change to inbound text. See the concerns.
- **M-10 (a) and (b).** (a) The failed-save test covers `ack`, `pending` and `markRead`. (b) A test checks that cursors and read markers survive a new `createEventLog` over the same files.

Test edits made for the new behaviour:
- `test/state.test.js`: "corrupt state file is moved aside and loads empty" no longer asserts that the state file is absent. Recovery now leaves a state file that holds the stop.
- `test/events.test.js`: the helpers `freshFiles` and `setup` also return `stateFile`, and `mkdirSync` is imported.

Files in this round: `src/state.js`, `src/events.js`, `src/redact.js` (one export), `test/state.test.js`, `test/events.test.js`, and this report. Unchanged: `src/config.js`, `src/errors.js`, `src/audit.js` (identical to `task-2-fix5-head`), and `package.json`.

### Covering tests

State:
- `a failed save restores memory to the last saved image` (new, I-1 at unit level)
- `a corrupt state file leaves a stop record on disk at once, and a new load reports it` (I-2)
- `corrupt state file is moved aside and loads empty` (changed, see above)

Events:
- `a failed save leaves memory equal to disk for ack, pending and markRead` (I-1, M-10 a)
- `cursors and read markers survive a new event log over the same files` (M-10 b)
- `after a state loss the next seq is above every purged seq` (M-2)
- `the next seq is above the saved events.lastSeq` (M-2, the lastSeq branch on its own)
- `a registered secret is masked in the stored line, and ordinary text is unchanged` (M-7)

### RED, before the source changes

Command: `node --test test/state.test.js test/events.test.js`. Output summary:

```
✖ a failed save leaves memory equal to disk for ack, pending and markRead
✖ after a state loss the next seq is above every purged seq
✖ a registered secret is masked in the stored line, and ordinary text is unchanged
✖ a failed save restores memory to the last saved image
✖ a corrupt state file leaves a stop record on disk at once, and a new load reports it
ℹ tests 37
ℹ pass 32
ℹ fail 5
```

The cursors-survive test passed before the change. It is a guard, not a fix.

### GREEN, after the source changes

The covering files passed 37 of 37 before the lastSeq branch test was added. The final run is the full suite, with its output saved to the scratchpad as `fix1-npm-test-final.txt`:

```
$ npm test
ℹ tests 141
ℹ suites 0
ℹ pass 141
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2422.3651
```

Exit code 0.

### Mutation check for this round

Each fix was removed in turn from a scratch copy, and the state and events tests were run. Output is in the scratchpad as `fix1-mutation-results.txt`.

- Killed: I-1 restore (2 tests), I-2 stop write (1), I-2 copy aside (3), M-2 lastSeq left out of the max (1), M-2 header left out of the max (1), M-2 lastSeq not saved (1), M-2 purge not writing the header (1), M-7 unmasked (1).
- Survived: M-3, the fsync removed (0 failing). Expected, since the fsync is not observable in-process. Verified by inspection only.

### Earlier sections superseded by this round

- Decision 8 holds, except that registered secret values are now masked on write.
- Concern 1 is addressed in part. The stop now survives a restart on disk. `movedAside` remains a logging aid.
- The totals are 141, not 134.

### Concerns for the controller

1. The decision draft is still stored unmasked. The M-7 fix covers inbound text only, as instructed. "Tokens never reach a file" also covers the draft, so this needs a ruling. The fix is one line in `decide`.
2. M-2 needed the events-file header, beyond the requested lastSeq-in-state fix. The header is a format change: the first line of the events file may be `{"lastSeq":N}`. Confirm that this is acceptable.
3. Recovery copies the corrupt file aside rather than renaming it, so the state file is never missing. This departs from the word "moves" in the review wording.
4. The M-3 fsync is verified by reading the code only. No test can observe it in-process.

---

## Ruling: the decision draft is masked

The coordinator ruled on concern 1 of Fix round 1: "Tokens never reach a file" covers the decision draft too.

### What changed

- `src/events.js`, `decide()`: the draft is masked with `maskRegistered` before it is stored, as the inbound text is in `newEventFields`:
  ```js
  const storedDraft = draft === null ? null : maskRegistered(draft);
  ...
  decision: { action: decision.action, draft: storedDraft, at: ... },
  ```
  The type check still runs on the raw draft first, so a non-string draft is still refused with `VALIDATION`. The returned event carries the masked draft too.
- `test/events.test.js`: one new test, `a registered secret in a draft is masked in the stored line; ordinary draft text is unchanged`. It registers `EAAB-draft-line-0004`, decides two events, and checks that the registered value is masked in the returned event and in the stored lines. It also checks that ordinary draft text is unchanged. The test reads only the lines that hold an event, because a rewrite may put the header line first.
- Nothing else changed in `src/`.

### Covering test

Command: `node --test test/events.test.js`.

RED, before the `decide()` change (the title was longer then, and was shortened afterwards to meet the 120-character line rule):

```
✖ a registered secret in a decision draft is masked in the stored line, and ordinary draft text is unchanged (51.7393ms)
ℹ tests 28
ℹ pass 27
ℹ fail 1
```

GREEN, after the change:

```
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

### Full suite

Command: `npm test`. Output saved to the scratchpad as `draft-npm-test-final.txt`:

```
ℹ tests 142
ℹ suites 0
ℹ pass 142
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2120.1569
```

Exit code 0. The count is 103 existing, 11 state and 28 events.

### Superseded

In Fix round 1, the note "Not changed: `decide` still stores the draft as given" and concern 1 are both resolved by this ruling. The draft is now masked, so decision 8 holds with no exception for stored text: registered secret values are masked on write, in both the inbound text and the draft.
