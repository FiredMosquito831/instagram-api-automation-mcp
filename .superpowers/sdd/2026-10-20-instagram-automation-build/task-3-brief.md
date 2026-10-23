### Task 3: State and the event log

**Files:** Create `src/state.js`, `src/events.js`. Tests: `test/state.test.js`, `test/events.test.js`.

**Interfaces:**
- Consumes: `IgError` (Task 2).
- Produces: `createState({ file }) -> Promise<{ get(key, fallback), set(key, value), save() }>`. `save()` writes `file + '.tmp'` and renames it over `file`. A file that does not parse is renamed to `file + '.corrupt'`, and the state starts empty.
- Produces: `createEventLog({ file, state, retentionDays, now })` returning `{ append(event), pending({ limit }) -> { events, nextCursor }, ack(cursor), lastInboundAt(senderId), hasId(id), decide(eventId, decision), markRead(senderId), unreadSenders(), purge() }`.
- Cursor: an opaque string, `base64url('c' + seq)`. The state key `events.issued` holds the highest seq that `pending` has returned. `pending` returns events with `seq > events.acked`, at most `limit`, and sets `events.issued` to the last seq it returned. `ack(cursor)` decodes the cursor, throws `VALIDATION` if the seq is above `events.issued`, and otherwise sets `events.acked` to the larger of the two values.
- A stored event is `{ seq, id, kind: 'message' | 'comment' | 'mention' | 'unknown', senderId, text, receivedAt, status: 'new' | 'handled', decision: null | { action: 'reply' | 'ignore' | 'escalate', draft, at }, untrusted: true }`. Each append assigns the next `seq`.
- `decide` records the decision and sets the status to `handled`. It sends nothing.
- `markRead(senderId)` stores the latest seq for that sender under `dm.read.<senderId>`. `unreadSenders()` lists senders whose latest inbound seq is above their read marker.
- `purge()` removes events older than `retentionDays` whose status is `handled`, and keeps the rest.
- Events are stored one JSON line each. `pending`, `hasId` and `lastInboundAt` skip a truncated last line.

**Tests:**
- `append assigns increasing seq, and pending returns events after the acked position`.
- `ack refuses an unissued cursor`: a cursor for a seq above `events.issued` throws `VALIDATION`.
- `ack never moves backwards`: ack 5, then ack 3, and the acked position is 5.
- `truncated last JSONL line is skipped and the rest is kept`.
- `hasId finds a stored id for dedupe`.
- `lastInboundAt returns the newest receivedAt for a sender`.
- `purge removes only handled events older than retentionDays`: a pending old event survives. Use a fake clock.
- `decide records the decision and does not change the cursor`.
- `markRead moves the sender out of unreadSenders`.
- `state save is atomic`: the file parses after `save()`, and no `.tmp` file remains.
- `corrupt state file is moved aside and loads empty`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement both modules.** Run the tests and expect PASS.

