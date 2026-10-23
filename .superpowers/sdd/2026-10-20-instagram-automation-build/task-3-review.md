# Task 3 review: state and the event log

**Scope:** `task-3-base` to `task-3-head` (review-task-3.diff). Files: `src/state.js`, `src/events.js`, `test/state.test.js`, `test/events.test.js`. The live files match the diff at the lines cited. Source line numbers are the live file's; test line numbers are the test file's own.

**Read:** the brief, the global constraints, the ledger (Task 3 entry, rulings 1 to 3, R2, R3, R9), the implementer report, the diff, and, for the named risks, the live `src/errors.js` and `src/redact.js`.

**Focused checks.** Read-only against the live modules; the suite was not re-run. A scratch script (`D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task3-review-checks.mjs`) wrote only to the OS temp folder and cleaned up after itself.

1. `ack(2)` with a failed save (the `.tmp` path blocked): the error is EISDIR, `events.acked` is 1 on disk and 2 in memory, and `pending()` straight after returns seq `[3]` only.
2. A truncated state file is moved aside on the first start (no state file is left). A restart before any save gives `movedAside: null` and `guard.stop: "none"`.
3. After seq 1 is purged and the state is lost, the first append gets seq 1.
4. Two state objects over one file: the second one's save drops the `guard.stop` the first one wrote.

## Spec compliance

**Verdict: ❌.** One constraint is not met on the restart path (I-2, reproduced in check 2). Ruling (1)'s carry-forward, as written, does not cover a restart before the first save. Every other brief item and in-scope constraint is met or marked ⚠️.

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Four files created; consumes IgError | ✅ | diff headers; `state.js:6`, `events.js:6`. `CONFIG` and `VALIDATION` are in `ERROR_KINDS` (`errors.js:7-8`) |
| 2 | `createState({ file })` returns get, set, save | ✅ | `state.js:79-119`. Adds `movedAside` (`state.js:105`), as report decision 3 says |
| 3 | `save()` writes `file.tmp`, renames it over `file` | ✅ | `state.js:54-75`, `116-118` |
| 4 | Unparseable file moved to `file.corrupt`; state starts empty | ✅ | `state.js:89-97`. Also moves aside non-object JSON (`state.js:91`), tested at `state.test.js:66-75` |
| 5 | `createEventLog` returns the nine methods | ✅ | `events.js:204`, `328` |
| 6 | Cursor is `base64url('c' + seq)` | ✅ | `events.js:159-161` |
| 7 | `events.issued` holds the highest seq `pending` returned | ✅ | `events.js:240-243`. The brief says "highest seq" in one sentence and "last seq it returned" in another. The two agree on a first batch, and only the max keeps `ack` correct when a later batch is smaller |
| 8 | `pending`: seq above acked, at most `limit` | ✅ | `events.js:234-244` |
| 9 | `ack`: VALIDATION above issued; acked never moves back | ✅ | `events.js:248-256` |
| 10 | Stored event shape, with `untrusted: true` | ✅ | `events.js:225` |
| 11 | `append` assigns the next seq | ✅ | `events.js:222-225` |
| 12 | `decide` records, sets handled, sends nothing, cursor unchanged | ✅ | `events.js:260-278` |
| 13 | `markRead` stores latest seq under `dm.read.<senderId>` | ✅ | `events.js:298-303`; key at `events.js:20` |
| 14 | `unreadSenders` lists senders above their marker | ✅ | `events.js:306-312` |
| 15 | `purge` removes handled events older than `retentionDays`; keeps the rest | ✅ with a stricter rule | `events.js:316-326` adds `seq <= acked`, per the global constraint and ruling (2) |
| 16 | One JSON line per event; `pending`, `hasId`, `lastInboundAt` skip a truncated last line | ✅ | `events.js:101-134`; used at `237`, `282`, `289` |
| 17 | The eleven test names, as in the brief | ✅ | `events.test.js:43, 73, 83, 126, 171, 178, 187, 216, 245`; `state.test.js:27, 56` |
| 18 | Fail-closed: bad stored values rejected, not coerced (Task 1 rule) | ✅ | `events.js:142-156`, `80`; tests at `events.test.js:275-300` |
| 19 | Constraint: events kept 30 days; purge removes only handled; pending kept | ✅ | `events.js:13`, `320-322` |
| 20 | Constraint: cursor opaque; refused if unissued; never moves back | ✅ | `events.js:248-256` |
| 21 | Constraint: event text untrusted and marked in results | ✅ | `events.js:225`, `80`, `173-175` |
| 22 | Constraint: secrets stay out of logs, errors and tool output; every output through redact | ✅ | `events.js:173-175`, `229`, `244`, `277`. Error messages carry no event text (`events.js:114`, `127`, `145`, `164`, `220`; `state.js:85`, `96`). No event key matches the secret-name test (`redact.js:15`), so `redact` keeps every field except string values |
| 23 | Constraint: a stop is persisted; only `ig_stop_clear` resumes | ❌ | The corrupt-state path loses a stop across a restart (check 2; `state.js:91-97`, `102-105`). See I-2 |
| 24 | Constraint: tokens never reach a file | ⚠️ | Inbound text is stored as given (`events.js:225`, `228`). See M-7 |
| 25 | Constraint: Node `>=22.12.0` | ⚠️ | Run on Node v24.6.0 only (report). The APIs used exist in Node 22, as read in the code; not run on 22 |
| 26 | No network; no commits | ✅ | Imports are Node built-ins and project modules (`state.js:3-6`, `events.js:4-8`) |
| 27 | Report: 134 of 134 tests; mutation check | ⚠️ | Not re-run, per the review rules. The mutation output is not in the package |

**Report claims, checked:**
- Test names match the brief (row 17).
- Decision 2 (purge keeps decided but unacknowledged events) matches the code (`events.js:320-322`).
- Decision 8 says the brief requires stored text to be kept "as written". The brief does not say that (see M-7).
- Concern 1 (`movedAside` must be checked) is correct but incomplete across a restart (I-2).

## Strengths

- **S-1. Atomic save.** The temp file is flushed before the rename, and the cleanup cannot hide the original error (`state.js:54-75`). A failed save leaves the old file in place (`state.test.js:36-45`).
- **S-2. Torn tail handled by byte offset.** A torn last line is skipped on read and removed by the next append. A complete last line without a newline is kept and separated (`events.js:104-105`, `119-133`, `225-228`).
- **S-3. Damage refused, not skipped.** A damaged line that is not a torn tail is refused, so a damaged log stops the service at startup (`events.js:113-115`, `127`, `211-212`).
- **S-4. Bad stored values rejected, not coerced.** Non-integers, strings, nulls, negatives, unsafe integers and acked-above-issued are all refused (`events.js:142-156`, tests at `events.test.js:275-300`).
- **S-5. Canonical cursors.** `decodeCursor` re-encodes and compares, so `YzV` is refused even when seq 5 is issued (`events.js:163-170`; `events.test.js:106-107`).
- **S-6. `issued` is the max.** This avoids the literal "last returned" reading, which would let a smaller later batch make `ack` refuse a cursor that was issued (`events.js:240-243`; `events.test.js:92`).
- **S-7. Field-by-field input.** `newEventFields` copies only the caller's fields, so a caller cannot set `seq`, `status`, `decision` or `untrusted` (`events.js:186-199`).
- **S-8. `untrusted` set and enforced.** It is set at append (`events.js:225`) and required on read (`events.js:80`), so a line without it is refused.
- **S-9. Outputs redacted; stored text unchanged.** `output()` runs `redact` (`events.js:173-175`), which keeps the non-string fields (`redact.js:142-168`).
- **S-10. Stricter purge.** An event that is not acknowledged is never removed, even when it is handled and old (`events.js:320-322`).

## Issues

### Critical

None.

### Important

**I-1. A failed save leaves an advanced cursor in memory.** `src/events.js:241-242` (pending), `253-254` (ack), `301-302` (markRead); `src/state.js:110-118`. `set` changes the in-memory value before `save` runs, and nothing puts it back when `save` throws. Check 1 shows the effect: after the failed ack, memory says `events.acked` is 2 and the disk says 1, so `pending()` skips seq 2 for the rest of the process. A restart heals it. This is the cursor contract the review focus names. Fix: in `createState`, keep a copy of the last saved image; in `save()`, on failure, restore that copy and rethrow. Add a test: after a failed save inside `ack`, `pending` and `markRead`, the next `pending()` and `unreadSenders()` match the disk.

**I-2. A corrupt state file is moved aside, and a restart forgets it.** `src/state.js:91-97` moves the file to `.corrupt` and sets `movedAside`, but nothing is saved, and `movedAside` exists only in that process (`state.js:102-105`). Check 2 shows the result: after a restart before any save, `movedAside` is `null`, the state file is absent, and the stop is gone. So a stop persisted before the corruption resumes outbound actions after a restart, which the constraint "A stop is persisted" forbids. Ruling (1) says Task 4's guard starts STOPPED when `movedAside` is set. That holds only within the same process. Fix: in `createState`, after the move, save the empty state at once with a marker key (for example `state.recovered`, holding the moved-aside path and the time), and have Task 4 treat that marker as STATE_CORRUPT until `ig_stop_clear`. The other option is for Task 4 to save STOPPED at startup whenever `movedAside` is set. Either way, the carry-forward must name the save. Test: a second `createState` after a corrupt start still sees the marker. Rated Important rather than Critical because it needs a corrupt file and a restart before the first save. The controller may raise it if the Task 4 carry-forward does not name the save.

### Minor

**M-1. A test name misdescribes its case, and mid-file damage is untested.** `test/events.test.js:161-172`. The damaged line (`:164`) is the last line of the file, so "not the last" is wrong. Fix: rename it to "a damaged terminated line is refused, even when it is the last line", and add a case with a damaged line followed by a valid line.

**M-2. "No seq is ever reused" is false after a state loss.** `src/events.js:223-224`, with `state.js:91-97`. Purge removes seq 1, the state is lost, and the next append gets seq 1 (check 3). Fix: keep the highest-seq event in `purge` (`events.js:320-322`), so the events file always holds the newest seq; or correct the comment.

**M-3. No fsync on append.** `src/events.js:228`. The webhook can answer 200 before the bytes reach the disk. After a power loss the event is gone, and Meta does not resend an event it has been answered for. Fix: open with `'a'`, write, `fsyncSync`, close.

**M-4. Raw fs errors escape, while the state wraps its errors.** `src/events.js:103` (readFileSync), `138` (writeFileAtomic via writeEvents) and `228` (appendFileSync) let EISDIR, EACCES and ENOSPC through unwrapped. `src/state.js:83-86` wraps its read errors as `CONFIG`. Fix: wrap these in `IgError` with one kind.

**M-5. A second corrupt file overwrites the first copy.** `src/state.js:92-97` renames onto an existing `.corrupt`, which loses the earlier evidence. Fix: when `${file}.corrupt` exists, use a numbered name for the newer copy.

**M-6. Duplicated helper.** `src/state.js:8-10` and `src/events.js:22-24` both define `isPlainObject`. Fix: export one.

**M-7. Inbound text is written unmasked.** `src/events.js:225` keeps `text` as given, and `228` writes it. The constraint "Tokens never reach a file" is absolute, so a registered token inside an inbound message would reach `events.jsonl`. The brief does not require raw storage (report decision 8 says it does). Controller ruling needed. If the ruling is to mask, mask exact registered values before the write, not the regex layer.

**M-8. A single writer is assumed, not enforced.** `src/events.js:228`, `276`, `324`. `decide` and `purge` rewrite the whole file from a snapshot read, so an append from a second process in between is lost. Fix: document one owning process for both files (Task 17), or add a lock.

**M-9. Dedupe covers only retained events.** `src/events.js:219-221` and `280-283`. After purge (`events.js:320-322`) an id is forgotten, so a redelivery older than 30 days would be stored and handled again. The risk is low, since a redelivery that old is unlikely. Fix: state the window in the README (Task 18).

**M-10. Test gaps.** (a) No test for a failed save in `ack`, `pending` or `markRead`; that test would have caught I-1. (b) No test that cursors and read markers survive a new `createEventLog` over the same files. (c) `untrusted` is asserted only on `pending` output (`test/events.test.js:54-71`), not on `append` or `decide`. (d) `test/state.test.js:44` asserts that `save` throws, not why, so it would pass for any cause.

### Carry-forward notes (not counted in the totals)

- **C-1 (Task 4, ruling 1).** The restart case closes only if Task 4 uses the I-2 marker or saves STOPPED at startup. The carry-forward should say which.
- **C-2 (Tasks 4 and 17).** Use one state object per file per process. Two objects over one file overwrite each other's keys on save (check 4). The alternative is for `save()` to write only the keys this object changed, over the file's current content. Without one of these, a persisted stop is at risk.
- **C-3 (Tasks 4 and 13).** `createState.get` returns the stored type unchanged (`state.js:106-109`). Callers must validate what they read, as `events.js:142-156` does for the cursors (the Task 1 fail-closed rule).
- **C-4 (Tasks 10 and 11).** `receivedAt` must be the message's own time, as an ISO string with a zone (`events.js:194-196`). A numeric Meta timestamp must be converted first. Ruling (3) stands.
- **C-5 (Tasks 10 and 15).** `append` throws VALIDATION on a repeated id (`events.js:219-221`). The webhook path must call `hasId` first and treat a duplicate as a 200 no-op.
- **C-6 (Tasks 14 and 15).** `pending`, `append` and `decide` outputs carry `untrusted: true` (`events.js:173-175`). `unreadSenders` and `lastInboundAt` return ids and timestamps, not event text.
- **C-7 (Task 18, README).** Known limits for the event log: M-3, M-7, M-8, M-9.

## Assessment

**Task quality: Needs fixes.** Two Important defects are in the Task 3 code, and both are verified: a failed save leaves an advanced cursor in memory (I-1), and a corrupt-state recovery is forgotten on restart, so a persisted stop can resume outbound actions (I-2). The rest of the brief and the in-scope constraints are met, and both fixes are small.

**Spec verdict: ❌** (I-2; everything else in scope is met or marked ⚠️).

**Counts:** Critical 0, Important 2, Minor 10.
