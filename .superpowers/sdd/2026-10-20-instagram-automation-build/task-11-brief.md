### Task 11: Poller

**Files:** Create `src/poller.js`. Test: `test/poller.test.js`.

**Interfaces:**
- Consumes: the client from Task 5 (through `getClient`), `conversationsList`, `conversationMessages` (Task 8), `createEventLog` (Task 3), the guard (Task 4), `poll` settings (Task 1).
- Produces: `createPoller({ getClient, owner, events, state, guard, config, sleep, now, onInbound }) -> { tick(), start(), stop() }`.
- `tick()`: (1) calls `conversationsList` for the owner, spacing calls by `poll.spacingMs`; (2) for each conversation whose `updatedTime` differs from the value stored under `poll.seen.<id>`, up to `poll.maxThreadsPerTick` threads, calls `conversationMessages`; (3) for each message whose `fromId` is not the owner, appends an event with `kind: 'message'`, `id` set to the message id, `senderId` set to `fromId`, and `receivedAt` set to `createdTime`, skipping ids already known; (4) stores the new `updatedTime` values; (5) calls `onInbound(event)` once for each newly appended event.
- `start()` runs `tick` every `poll.intervalMs`. `stop()` clears it.
- Errors: `AUTH_EXPIRED` calls `guard.stop` and halts the poller. `RATE_LIMITED` doubles the interval, up to 10 minutes, and skips the tick. Any other error is recorded in the audit log and the poller continues.
- Reads are not capped. The spacing and the thread limit keep the call rate under the conversation limit.

**Tests:**
- `poll dedupes on message id across ticks`: two ticks over the same thread store one event.
- `owner-sent messages are not stored`.
- `only changed threads are read`: a second tick with an unchanged `updatedTime` makes no `conversationMessages` call.
- `calls are spaced by poll.spacingMs`: the fake sleep records the gap.
- `maxThreadsPerTick is honoured`.
- `RATE_LIMITED doubles the interval`.
- `AUTH_EXPIRED stops the poller and sets the stop state`.
- `onInbound is called once per new event`.

- [ ] **Step 1: Write the tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement the module.** Run the tests and expect PASS.

