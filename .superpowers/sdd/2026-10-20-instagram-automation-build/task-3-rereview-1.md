# Task 3 re-review: fix round 1

**Scope:** `task-3-fix1-head` against `task-3-head` (`review-task-3-fix1.diff`). Findings I-1, I-2, M-2, M-3, M-7, M-10 (a) and (b), and controller rulings 1 to 4. Read-only. The suite was not re-run.

**Checks run.** The live `src/state.js`, `src/events.js`, `src/redact.js` and both test files match `snap/task-3-fix1-head`. Against `snap/task-2-fix5-head`, `src/redact.js` differs only by the appended `maskRegistered` (`src/redact.js:193-203`). `errors.js`, `config.js`, `audit.js` and `package.json` are unchanged from Task 2. One focused scratch check ran the live modules, wrote only under the scratchpad, and removed its folder: `D:\tmp\claude\D--Projects2-InstagramApi\17f4f42a-5ede-49bc-83d7-c0627bbad30f\scratchpad\task3-rereview-check.mjs`.

## Finding verdicts

**I-1. A failed save leaves an advanced cursor in memory. ADDRESSED.**
- `createState` keeps the last saved image: `src/state.js:125-126`.
- `save()` restores that image and rethrows when the write fails (`src/state.js:147-148`). The image is updated only after a successful write (`src/state.js:150`). `restoreImage` is at `src/state.js:80-84`.
- Each cursor path calls `set` then `save`, so the restore covers all three: `pending` at `src/events.js:303-306`, `ack` at `src/events.js:315-318`, `markRead` at `src/events.js:365-367`.
- Tests: `test/events.test.js:327-358` (ack, pending and markRead against disk, then pending and unreadSenders after unblock). `test/state.test.js:48-61` (unit level). Without the restore, the disk comparison fails: memory would hold `events.issued` 3 while disk holds none.

**I-2. A corrupt state file is forgotten on restart. ADDRESSED.**
- The stop record has the required shape: `src/state.js:102-108` (`stopped: true`, `kind: 'STATE_CORRUPT'`, `detail`, `since`).
- Ruling 3 (copy, not rename) is in place: `src/state.js:109-115`. The state file is then replaced in one atomic write (`src/state.js:116-120`), so it is never absent. A failed copy or write throws CONFIG, so startup is refused.
- Test: `test/state.test.js:79-99`. It reads the stop from the file, checks the `.corrupt` copy, and checks that a restart sees `stop` with `movedAside` null.
- Carry-forward, not a finding: Task 4 must read the `stop` key at startup (C-1 stands).

**M-2. A seq can be reused after a state loss. ADDRESSED.**
- Next seq is the maximum of `lastSeq`, `issued`, `acked` and the file's high-water, plus 1: `src/events.js:282-284`.
- `events.lastSeq` is saved before the event line is written: `src/events.js:287-288`, then `appendEvent` at `src/events.js:291`.
- The header `{"lastSeq":N}` is written by `writeEvents` (`src/events.js:176-178`) and kept by `purge` (`src/events.js:389`) and `decide` (`src/events.js:341`). `fileHighWater` is at `src/events.js:170-172`.
- Reader skip: `parseHeader` (`src/events.js:113-117`) runs only on the first non-blank line (`src/events.js:136-144`). Every reader goes through `readStore` (`src/events.js:123-167`): constructor (`271-272`), append (`278`), pending (`300`), decide (`332`), hasId (`347`), lastInboundAt (`354`), markRead (`365`), unreadSenders (`373`), purge (`384`). `src/events.js:125` is the only read of the events file in `src/`.
- Next seq after a state loss: `test/events.test.js:372-385` (purge of seqs 1 to 3, state deleted, next seq is 4). `test/events.test.js:386-393` covers the lastSeq branch alone.
- Scratch check: after a purge the file starts `{"lastSeq":3}`. After a state loss, `append` returns seq 4, and `hasId`, `lastInboundAt`, `unreadSenders` and `pending` all read correctly over the header.
- Ruling 2 (header accepted) holds. Note that the header is written on every `decide` and `purge` that leaves events, not only after a purge (observation O-1).

**M-3. `append` does not fsync. ADDRESSED (known limit, ruling 4).**
- `appendEvent` opens with `'a'`, writes, calls `fsyncSync` on the descriptor, and closes in `finally`: `src/events.js:183-191`.
- Only `append` uses it (`src/events.js:291`). `decide` and `purge` go through `writeFileAtomic`, which fsyncs (`src/state.js:63-64`).
- No test observes the fsync. Verified by reading the code only, as the implementer reported.

**M-7. Registered secrets reach the events file. ADDRESSED (text and draft).**
- Inbound text: `src/events.js:256` (`text: maskRegistered(input.text)`), used by `append` at `src/events.js:277` and written at `src/events.js:291`.
- Decision draft (ruling 1): the type check runs on the raw draft (`src/events.js:329`). The draft is masked before storage (`src/events.js:330-331`, `338`), then written by `writeEvents` (`src/events.js:341`). The returned event is masked by `output`.
- `maskRegistered` (`src/redact.js:193-203`) uses split and join only, longest value first. It has no regex, and it returns the text unchanged when nothing is registered. It is the only addition to the Task 2 module.
- Tests: `test/events.test.js:394-404` (text, ordinary text unchanged) and `test/events.test.js:405` (draft, stored lines read with an `'id' in line` filter so a header line does not break the check).

**M-10 (a) and (b). ADDRESSED.**
- (a) failed save in ack, pending and markRead: `test/events.test.js:327-358`, plus `test/state.test.js:48-61`.
- (b) cursors and read markers survive a new `createEventLog` over the same files: `test/events.test.js:359-371`.
- M-10 (c) and (d) were not in this round and remain as the original review left them.

## New breakage in the fix diff

- **M-N1 (Minor, latent). A failed save discards every unsaved `set()` in the same state object.** `src/state.js:142-151` and `src/state.js:80-84`. Before this round, an unsaved change stayed in memory until the next successful save. Now a failed save drops it too, even when the failure came from another key. No current caller is affected: each `set` in `src/events.js` (`287`, `304`, `316`, `366`) is followed at once by `save`. The discard is asserted on purpose at `test/state.test.js:48-61`. The contract should be written into the `save` comment before Task 4 sets the stop.

Checked, with no finding:
- Reader paths: every reader skips the header through `readStore`. The scratch check confirmed `hasId`, `lastInboundAt`, `unreadSenders` and `pending` on a file with a header.
- Seq reuse: `events.lastSeq` is written before the event line (`src/events.js:287-291`), and the header keeps the high-water across `purge` and `decide`. A seq repeats only if both the state and the file lose it. That needs a torn line that no caller saw (`src/events.js:290` truncates it on the next append) or an outside edit (O-3).
- Unmasked path into the events file: the two free-text fields are text (`src/events.js:256`) and draft (`src/events.js:331`). The header holds only a number. The stop record goes to the state file, not the events file.
- State write loss: the recovery copies the corrupt file, then replaces the state atomically (`src/state.js:109-120`). A crash between the two steps leaves the corrupt file for the next start to recover again. No data is lost.
- Fail-open: none found. Unreadable state (`src/state.js:93-96`), a failed copy or stop write (`src/state.js:113-120`), a damaged or out-of-order line or header (`src/events.js:134-151`), and a non-integer `events.lastSeq` (`src/events.js:203-209`) all refuse the call or startup. The one gap is a missing state file (O-2).
- Imports: all new imports are used. `appendFileSync` and `rename` are removed.

## Out-of-scope observations (not counted)

- **O-1. The header is more common than the report says.** `writeEvents` writes it whenever there are events (`src/events.js:176-178`, `341`, `389`). Most event files therefore start with `{"lastSeq":N}` after the first `decide`, not only after a purge. A reader outside `readStore` would see it. Task 18's README should say so.
- **O-2. A deleted state file loses a stop, and nothing reports it. Needs a ruling.** A missing file gives an empty state with no stop (`src/state.js:91-101`). Only a corrupt file gets the STATE_CORRUPT record. This was not in the findings, and the path predates the fix. It touches the constraint that a stop is persisted. Task 4 could treat an events file that holds events, with no `events.lastSeq` in the state, as a sign of loss.
- **O-3. A header with no trailing newline is dropped.** `readStore` treats an unterminated last line that does not parse as a torn tail (`src/events.js:152-166`), and `append` truncates it (`src/events.js:290`). The scratch check showed `{"lastSeq":9}` with no newline gives next seq 1. The code never writes that form, so only an outside edit can cause it.
- **O-4. A state loss resets the cursors and read markers, so events come back.** Scratch check: after a deleted or corrupt state, `pending` returned `m2`, which an earlier ack had covered, and `unreadSenders` relisted the sender. `pending` selects by seq and ignores `status`. Tasks 10 to 15 must check `status: 'handled'` before acting.
- **O-5. Masking is limited to text and draft, and to values registered when written.** `id` and `senderId` are stored as given (`src/events.js:242-243`, `253-255`). A value registered after an event is stored leaves that line unmasked. Task 4 should register the tokens before the first append.
- **O-6. Overlapping, non-nested registered values leave a fragment.** With `SECRETAAAA` and `AAAAzzzzzz` registered, `maskRegistered('x SECRETAAAAzzzzzz y')` returns `x [redacted]zzzzzz y` (scratch check). The loop is the same as `maskText` in `src/redact.js:109-111` (Task 2), so Task 2 has the same limit. Real tokens make this unlikely.
- **O-7. The new file's directory entry is not fsynced.** On first creation, `appendEvent` (`src/events.js:183-191`) does not fsync the directory. This is the same known limit as M-3.
- **O-8. Test gap.** No test runs `lastInboundAt` or `unreadSenders` over a file that starts with the header. They share `readStore`, and the scratch check passed.
- **O-9. Still open from the original review, not re-checked:** M-1, M-4, M-5 (`src/state.js:112` still overwrites an earlier `.corrupt`), M-6, M-8, M-9, M-10 (c) and (d), and the C-1 to C-7 carry-forwards.

## Round verdict

**All findings addressed, with no new Critical or Important breakage.** I-1, I-2, M-2, M-3 (known limit), M-7 and M-10 (a) and (b) are ADDRESSED. New issues: Critical 0, Important 0, Minor 1 (M-N1, latent, no current caller affected). Task 4 must still read the `stop` key (C-1). O-2 needs a ruling before Task 4.
