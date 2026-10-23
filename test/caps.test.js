import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CAPS } from '../src/config.js';
import { createCaps, createUsageGate, rebuildCapsFromAudit, rebuildPrivateReplies } from '../src/caps.js';
import { IgError } from '../src/errors.js';
import { createState } from '../src/state.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const START = Date.UTC(2026, 9, 20, 12, 0, 0);

// A clock the test moves by hand.
function fakeClock(start = START) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

// A temporary directory that is removed when the test ends.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-caps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// An in-memory state with the contract of createState: save() copies the working data to the saved image, and a
// failed save puts the working data back to the saved image before it throws.
function memoryState() {
  let saved = {};
  let data = {};
  return {
    failSave: false,
    get(key, fallback) {
      return Object.hasOwn(data, key) ? structuredClone(data[key]) : fallback;
    },
    set(key, value) {
      data[key] = structuredClone(value);
    },
    save() {
      if (this.failSave) {
        data = structuredClone(saved);
        throw new Error('disk full');
      }
      saved = structuredClone(data);
    },
  };
}

function setup(overrides = {}) {
  const clock = fakeClock();
  const state = memoryState();
  const caps = createCaps({ caps: DEFAULT_CAPS, state, now: clock.now, ...overrides });
  return { clock, state, caps };
}

// Records one action after the spacing has passed, and checks that it was allowed first.
function act(clock, caps, action, opts) {
  clock.advance(2000);
  assert.equal(caps.check(action, opts).ok, true, `${action} should be allowed`);
  caps.record(action, opts);
}

function assertVerdict(result, { ok, reason, retryAfterMs }) {
  assert.equal(result.ok, ok);
  if (reason !== undefined) assert.match(result.reason, reason);
  if (retryAfterMs !== undefined) assert.equal(result.retryAfterMs, retryAfterMs);
}

test('spacing returns busy with retryAfterMs, and clears 2000 ms after the call', () => {
  const { clock, caps } = setup();
  caps.record('profile_edit');
  clock.advance(1000);
  const early = caps.check('profile_edit');
  assert.equal(early.ok, false);
  assert.equal(early.retryAfterMs, 1000);
  clock.advance(1000);
  assert.deepStrictEqual(caps.check('profile_edit'), { ok: true });
});

test('daily total of 200 blocks the 201st outbound action, and the block lifts when the first one leaves the day', () => {
  const { clock, caps } = setup();
  const firstAt = clock.now() + 2000;
  for (let i = 0; i < 200; i++) act(clock, caps, 'comment_hide');
  clock.advance(2000);
  const blocked = caps.check('comment_hide');
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /day/);
  assert.equal(blocked.retryAfterMs, firstAt + DAY - clock.now());
  clock.advance(blocked.retryAfterMs);
  assert.equal(caps.check('comment_hide').ok, true);
});

test('every action counts toward the outbound total', () => {
  const { clock, caps } = setup();
  for (let i = 0; i < 199; i++) act(clock, caps, 'profile_edit');
  act(clock, caps, 'like');
  clock.advance(2000);
  assert.equal(caps.check('profile_edit').ok, false);
  assert.equal(caps.check('like').ok, false);
});

test('likes are capped at 10 per hour, and an unlike counts toward the same limit', () => {
  const { clock, caps } = setup();
  const firstAt = clock.now() + 2000;
  for (let i = 0; i < 9; i++) act(clock, caps, 'like');
  act(clock, caps, 'unlike');
  clock.advance(2000);
  const like = caps.check('like');
  assertVerdict(like, { ok: false, reason: /hour/, retryAfterMs: firstAt + HOUR - clock.now() });
  assert.equal(caps.check('unlike').ok, false);
  clock.advance(like.retryAfterMs);
  assert.equal(caps.check('like').ok, true);
});

test('hashtags are capped at 30 unique tags per 7 days, and a repeated tag does not count twice', () => {
  const { clock, caps } = setup();
  act(clock, caps, 'hashtag', { tag: '#Alpha' });
  const repeatedAt = clock.now() + 2000;
  act(clock, caps, 'hashtag', { tag: 'alpha' });
  for (let i = 1; i <= 28; i++) act(clock, caps, 'hashtag', { tag: `tag${i}` });
  // Thirty entries but only 29 unique tags so far, so one more unique tag is still allowed.
  act(clock, caps, 'hashtag', { tag: 'tag29' });
  clock.advance(2000);
  const fresh = caps.check('hashtag', { tag: 'omega' });
  assertVerdict(fresh, { ok: false, reason: /unique/, retryAfterMs: repeatedAt + WEEK - clock.now() });
  assert.equal(caps.check('hashtag', { tag: 'ALPHA' }).ok, true);
  clock.advance(fresh.retryAfterMs);
  assert.equal(caps.check('hashtag', { tag: 'omega' }).ok, true);
});

test('follows and unfollows have separate daily counters of 20', () => {
  const { clock, caps } = setup();
  for (let i = 0; i < 20; i++) act(clock, caps, 'follow');
  clock.advance(2000);
  assertVerdict(caps.check('follow'), { ok: false, reason: /day/ });
  assert.equal(caps.check('unfollow').ok, true);
  for (let i = 0; i < 20; i++) act(clock, caps, 'unfollow');
  clock.advance(2000);
  assert.equal(caps.check('unfollow').ok, false);
});

test('owner DMs are capped at 50 per day, and publishing at 10 per day', () => {
  const { clock, caps } = setup();
  for (let i = 0; i < 50; i++) act(clock, caps, 'owner_dm');
  clock.advance(2000);
  assert.equal(caps.check('owner_dm').ok, false);
  for (let i = 0; i < 10; i++) act(clock, caps, 'publish');
  clock.advance(2000);
  assert.equal(caps.check('publish').ok, false);
});

test('a private reply counts toward the owner DM limit of 50 per day', () => {
  const { clock, caps } = setup();
  for (let i = 0; i < 49; i++) act(clock, caps, 'owner_dm');
  act(clock, caps, 'private_reply');
  clock.advance(2000);
  assert.equal(caps.usage().owner_dm.day.used, 50, 'the private reply is the 50th owner DM');
  assert.equal(caps.check('owner_dm').ok, false, 'the next owner DM is refused');
  assert.equal(caps.check('private_reply').ok, false, 'and so is the next private reply');
});

test('auto-replies allow one per conversation per 24 hours and 100 per day', () => {
  const { clock, caps } = setup();
  const firstAt = clock.now() + 2000;
  act(clock, caps, 'auto_reply', { senderId: 'a' });
  act(clock, caps, 'auto_reply', { senderId: 'b' });
  clock.advance(2000);
  const again = caps.check('auto_reply', { senderId: 'a' });
  assert.equal(again.ok, false);
  assert.equal(again.retryAfterMs, firstAt + DAY - clock.now());
  // 98 more senders reach the daily total of 100 with senders a and b.
  for (let i = 0; i < 98; i++) act(clock, caps, 'auto_reply', { senderId: `u${i}` });
  clock.advance(2000);
  assertVerdict(caps.check('auto_reply', { senderId: 'new' }), { ok: false, reason: /day/ });
});

test('a check changes no counter, and usage() reports what has been recorded', () => {
  const { clock, caps } = setup();
  for (let i = 0; i < 20; i++) assert.equal(caps.check('publish').ok, true);
  caps.record('publish');
  clock.advance(2000);
  assert.equal(caps.usage().publish.day.used, 1);
  assert.equal(caps.usage().outbound.day.used, 1);
  assert.equal(caps.usage().publish.day.limit, DEFAULT_CAPS.publishing.perDayLocal);
});

test('a failed save does not count the action, so no counter moves without its save', () => {
  const { clock, state, caps } = setup();
  state.failSave = true;
  assert.throws(
    () => caps.record('publish'),
    (error) => error instanceof IgError && error.kind === 'CONFIG' && /do not send/.test(error.message),
  );
  state.failSave = false;
  clock.advance(2000);
  assert.equal(caps.usage().outbound.day.used, 0);
  assert.equal(caps.usage().publish.day.used, 0);
});

test('counters survive a restart: a new caps over the same file still refuses', async (t) => {
  const file = join(tempDir(t), 'state.json');
  const clock = fakeClock();
  const first = createCaps({ caps: DEFAULT_CAPS, state: await createState({ file }), now: clock.now });
  for (let i = 0; i < 10; i++) {
    clock.advance(2000);
    first.record('like');
  }
  clock.advance(2000);
  const second = createCaps({ caps: DEFAULT_CAPS, state: await createState({ file }), now: clock.now });
  assert.equal(second.check('like').ok, false);
});

test('an unknown action, or a missing sender or tag, is refused with VALIDATION', () => {
  const { caps } = setup();
  const validation = (error) => error instanceof IgError && error.kind === 'VALIDATION';
  assert.throws(() => caps.check('delete_everything'), validation);
  assert.throws(() => caps.check('auto_reply'), validation);
  assert.throws(() => caps.record('hashtag', {}), validation);
  assert.throws(() => caps.check('hashtag', { tag: '   ' }), validation);
  assert.throws(() => caps.check('hashtag', { tag: 'two words' }), validation);
});

test('createCaps refuses a caps object with a missing or negative value', () => {
  const state = memoryState();
  const clock = fakeClock();
  const missing = structuredClone(DEFAULT_CAPS);
  delete missing.likes.perHour;
  assert.throws(() => createCaps({ caps: missing, state, now: clock.now }), TypeError);
  const negative = { ...structuredClone(DEFAULT_CAPS), dailyTotal: -1 };
  assert.throws(() => createCaps({ caps: negative, state, now: clock.now }), TypeError);
});

test('usage gate returns busy at total_time 80: the result is busy with retryAfterMs 60000', () => {
  const clock = fakeClock();
  const gate = createUsageGate({ thresholdPercent: 80, busyMs: 60000, now: clock.now });
  const result = gate.check({ call_count: 3, total_time: 80, total_cputime: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.retryAfterMs, 60000);
  assert.equal(typeof result.reason, 'string');
});

test('usage gate also throttles on total_cputime, and passes below the threshold', () => {
  const clock = fakeClock();
  const gate = createUsageGate({ thresholdPercent: 80, busyMs: 60000, now: clock.now });
  assert.deepStrictEqual(gate.check({ call_count: 1, total_time: 79, total_cputime: 79 }), { ok: true });
  assert.equal(gate.check({ call_count: 1, total_time: 10, total_cputime: 80 }).ok, false);
});

test('usage gate stays busy for busyMs after the last high reading, then opens', () => {
  const clock = fakeClock();
  const gate = createUsageGate({ thresholdPercent: 80, busyMs: 60000, now: clock.now });
  gate.check({ call_count: 1, total_time: 90, total_cputime: 1 });
  clock.advance(30000);
  assertVerdict(gate.check({ call_count: 1, total_time: 1, total_cputime: 1 }), {
    ok: false,
    retryAfterMs: 30000,
  });
  clock.advance(30000);
  assert.deepStrictEqual(gate.check({ call_count: 1, total_time: 1, total_cputime: 1 }), { ok: true });
});

test('usage gate passes when no reading has come yet, and refuses a malformed reading', () => {
  const clock = fakeClock();
  const gate = createUsageGate({ thresholdPercent: 80, busyMs: 60000, now: clock.now });
  assert.deepStrictEqual(gate.check(null), { ok: true });
  assert.deepStrictEqual(gate.check(undefined), { ok: true });
  const validation = (error) => error instanceof IgError && error.kind === 'VALIDATION';
  assert.throws(() => gate.check({ total_time: '80', total_cputime: 1 }), validation);
  assert.throws(() => gate.check({ total_time: -1, total_cputime: 0 }), validation);
  assert.throws(() => gate.check({ total_time: 1 }), validation);
  assert.throws(() => gate.check('80'), validation);
});

test('a repeated high reading does not re-arm the usage window, and a new high reading does', () => {
  const clock = fakeClock();
  const gate = createUsageGate({ thresholdPercent: 80, busyMs: 60000, now: clock.now });
  const high = { call_count: 1, total_time: 80, total_cputime: 1 };
  assertVerdict(gate.check(high), { ok: false, retryAfterMs: 60000 });
  clock.advance(70000);
  // The same reading again, as a caller passes the stored one on every check: the window ran out 10 s ago.
  assert.deepStrictEqual(gate.check(high), { ok: true });
  const newer = { call_count: 2, total_time: 85, total_cputime: 1 };
  assertVerdict(gate.check(newer), { ok: false, retryAfterMs: 60000 });
});

test('a new response with the same high numbers is a new reading, and re-arms the window', () => {
  const clock = fakeClock();
  const gate = createUsageGate({ thresholdPercent: 80, busyMs: 60000, now: clock.now });
  assertVerdict(gate.check({ call_count: 1, total_time: 80, total_cputime: 1 }), { ok: false, retryAfterMs: 60000 });
  clock.advance(70000);
  assertVerdict(gate.check({ call_count: 1, total_time: 80, total_cputime: 1 }), { ok: false, retryAfterMs: 60000 });
});

test('a usage object changed in place is a new reading when its numbers change', () => {
  const clock = fakeClock();
  const gate = createUsageGate({ thresholdPercent: 80, busyMs: 60000, now: clock.now });
  const reading = { call_count: 1, total_time: 10, total_cputime: 10 };
  assert.deepStrictEqual(gate.check(reading), { ok: true });
  clock.advance(1000);
  reading.total_time = 90;
  assertVerdict(gate.check(reading), { ok: false, retryAfterMs: 60000 });
});

test('a sender id with spaces around it is the same conversation as the trimmed id', () => {
  const { clock, caps } = setup();
  act(clock, caps, 'auto_reply', { senderId: ' abc ' });
  clock.advance(2000);
  assertVerdict(caps.check('auto_reply', { senderId: 'abc' }), { ok: false, reason: /conversation/ });
  assert.equal(caps.usage().auto_reply.day.used, 1);
  assert.throws(
    () => caps.check('auto_reply', { senderId: '   ' }),
    (error) => error instanceof IgError && error.kind === 'VALIDATION',
  );
});

test('a zero hashtag limit refuses a repeated tag too', () => {
  const clock = fakeClock();
  const state = memoryState();
  const caps = createCaps({ caps: DEFAULT_CAPS, state, now: clock.now });
  act(clock, caps, 'hashtag', { tag: 'alpha' });
  // The limit is set to 0 after the tag was counted, so the repeated tag must be refused as well.
  const zero = createCaps({
    caps: { ...structuredClone(DEFAULT_CAPS), hashtags: { perWeek: 0, windowDays: 7 } },
    state,
    now: clock.now,
  });
  clock.advance(2000);
  assertVerdict(zero.check('hashtag', { tag: 'alpha' }), { ok: false, reason: /switched off/ });
  assertVerdict(zero.check('hashtag', { tag: 'omega' }), { ok: false });
});

test('usage gate refuses a threshold outside 1 to 100 and a negative busy window', () => {
  const clock = fakeClock();
  assert.throws(() => createUsageGate({ thresholdPercent: 0, busyMs: 60000, now: clock.now }), TypeError);
  assert.throws(() => createUsageGate({ thresholdPercent: 101, busyMs: 60000, now: clock.now }), TypeError);
  assert.throws(() => createUsageGate({ thresholdPercent: 80.5, busyMs: 60000, now: clock.now }), TypeError);
  assert.throws(() => createUsageGate({ thresholdPercent: 80, busyMs: -1, now: clock.now }), TypeError);
});

// F-6 (Task 4 M-10). record() runs the same verdict as check(), so a count over a limit is refused with CAP_EXCEEDED, and
// nothing is saved.
test('record refuses a count over a limit with CAP_EXCEEDED, and saves nothing (F-6)', () => {
  const { clock, state, caps } = setup();
  // Ten likes an hour is the limit; ten are counted, each after the two-second spacing.
  for (let i = 0; i < 10; i += 1) act(clock, caps, 'like');
  clock.advance(2000);
  assertVerdict(caps.check('like', {}), { ok: false, reason: /reached the limit of 10/ });
  const before = JSON.stringify(state.get('caps.likes', []));
  assert.throws(() => caps.record('like', {}), (err) => err instanceof IgError && err.kind === 'CAP_EXCEEDED');
  assert.equal(JSON.stringify(state.get('caps.likes', [])), before, 'nothing was counted');
});

// F-32 (Task 4 M-9). A counter in the state that is not a list of entries is refused with CONFIG, for check() and for record().
test('a malformed caps counter in the state is refused with CONFIG, not read as empty (F-32)', () => {
  for (const bad of ['not a list', [{ at: 'soon' }], [null], [{ at: Number.NaN }]]) {
    const { state, caps } = setup();
    state.set('caps.outbound', bad);
    assert.throws(() => caps.check('like', {}), (err) => err instanceof IgError && err.kind === 'CONFIG', String(bad));
    assert.throws(() => caps.record('like', {}), (err) => err instanceof IgError && err.kind === 'CONFIG', String(bad));
  }
});

// F-32 (Task 4 M-9). A zero hashtag limit refuses the first tag, before any tag is counted, and a record over it is refused too.
test('a zero hashtag limit refuses the first tag, and a record over it is refused and not counted (F-32)', () => {
  const clock = fakeClock();
  const state = memoryState();
  const caps = createCaps({
    caps: { ...structuredClone(DEFAULT_CAPS), hashtags: { perWeek: 0, windowDays: 7 } },
    state,
    now: clock.now,
  });
  assertVerdict(caps.check('hashtag', { tag: 'alpha' }), { ok: false, reason: /switched off/, retryAfterMs: WEEK });
  assert.throws(() => caps.record('hashtag', { tag: 'alpha' }), (err) => err instanceof IgError && err.kind === 'CAP_EXCEEDED');
  assert.deepEqual(state.get('caps.hashtag', []), [], 'nothing was counted');
});

// ---------- P2 (2026-10-22) ----------

test('O-4 business discoveries and mentioned-media lookups each have a daily cap of 50', () => {
  const { clock, caps } = setup();
  for (let i = 0; i < 50; i++) act(clock, caps, 'business_discovery');
  clock.advance(2000);
  assert.equal(caps.check('business_discovery').ok, false, 'the 51st business discovery is busy');
  for (let i = 0; i < 50; i++) act(clock, caps, 'mentioned_media');
  clock.advance(2000);
  assert.equal(caps.check('mentioned_media').ok, false, 'the 51st mentioned-media lookup is busy');
  assert.equal(caps.usage().business_discovery.day.limit, 50);
  assert.equal(caps.usage().mentioned_media.day.limit, 50);
});

test('O-5 release removes exactly the count that record returned, and no other', () => {
  const { clock, caps } = setup();
  clock.advance(2000);
  const first = caps.record('owner_dm');
  clock.advance(2000);
  const second = caps.record('owner_dm');
  assert.notEqual(first, second, 'each count has its own id');
  caps.release(first, 'owner_dm');
  assert.equal(caps.usage().owner_dm.day.used, 1, 'only the first count was released');
  assert.equal(caps.usage().outbound.day.used, 1);
  caps.release(second, 'owner_dm');
  assert.equal(caps.usage().owner_dm.day.used, 0);
  assert.equal(caps.usage().outbound.day.used, 0);
  assert.throws(() => caps.release('', 'owner_dm'), { kind: 'VALIDATION' });
});

test('O-5 releasing an auto-reply count frees its per-sender limit', () => {
  const { clock, caps } = setup();
  clock.advance(2000);
  const token = caps.record('auto_reply', { senderId: 'sender-a' });
  clock.advance(2000);
  assert.equal(caps.check('auto_reply', { senderId: 'sender-a' }).ok, false, 'the sender is limited before the release');
  caps.release(token, 'auto_reply', { senderId: 'sender-a' });
  assert.equal(caps.check('auto_reply', { senderId: 'sender-a' }).ok, true, 'the sender is free after the release');
});

// ---------- P2 fix round (2026-10-22) ----------

test('P2-I2 a read writes its own bucket only: no outbound count, and no spacing for the next outbound action', () => {
  const { clock, caps } = setup();
  clock.advance(2000);
  caps.record('hashtag', { tag: 'cats' });
  assert.equal(caps.usage().outbound.day.used, 0, 'a lookup is not an outbound action');
  assert.equal(caps.usage().hashtag.week.used, 1, 'it counts toward its own bucket');
  assert.equal(caps.check('owner_dm').ok, true, 'an outbound action straight after a lookup is not spaced');
  caps.record('business_discovery');
  assert.equal(caps.usage().business_discovery.day.used, 1);
  assert.equal(caps.usage().outbound.day.used, 0, 'the second lookup is not outbound either');
});

// ---------- P2 fix round (2026-10-22), second check ----------

test('P2-I2 a lookup is not held by the outbound spacing or the outbound total', () => {
  const { clock, caps } = setup();
  act(clock, caps, 'owner_dm');
  // No clock advance: the owner DM was an outbound action 0 ms ago, so an outbound action would be spaced.
  assert.equal(caps.check('owner_dm').ok, false, 'an outbound action is spaced after the DM');
  assert.equal(caps.check('hashtag', { tag: 'cats' }).ok, true, 'a lookup is not held by that outbound spacing');
  assert.equal(caps.check('business_discovery').ok, true, 'nor is a business discovery');
  assert.equal(caps.check('mentioned_media').ok, true, 'nor is a mentioned-media lookup');
});

// P4 review M-11. The counters of a lost state are rebuilt from the audit lines of the outbound actions, within each counter's
// window, so a like made today still counts against the like cap after a corrupt-state start.
function fakeAudit(lines) {
  return {
    scanSince(since, visit) {
      let visited = 0;
      for (const line of lines) {
        if (Date.parse(line.at) >= since) {
          visited += 1;
          visit(line);
        }
      }
      return { damaged: 0, visited };
    },
  };
}
const lineAt = (ms, action, outcome = 'ok', target = null) => ({
  at: new Date(ms).toISOString(),
  action,
  target,
  route: 'official',
  outcome,
  detail: null,
});

test('a rebuild counts the ok and error lines of outbound actions inside each window, and writes them to the state', () => {
  const state = memoryState();
  const lines = [
    ...[1, 2, 3].map((i) => lineAt(START - i * 60 * 1000, 'like')),
    ...[1, 2].map(() => lineAt(START - 2 * HOUR, 'like')),
    lineAt(START - 60 * 1000, 'like', 'error'),
    lineAt(START - 2 * DAY, 'like'),
    lineAt(START - 60 * 1000, 'dmSend', 'ok'),
  ];
  const result = rebuildCapsFromAudit({ caps: DEFAULT_CAPS, state, audit: fakeAudit(lines), now: () => START });
  assert.equal(result.counted.likes, 6, 'the three recent and two two-hour-old likes, and the error line, inside the day window');
  assert.equal(result.damaged, 0);
  const usage = createCaps({ caps: DEFAULT_CAPS, state, now: () => START }).usage();
  assert.equal(usage.likes.hour.used, 4, 'the hour window holds the three recent likes and the error line');
  assert.equal(usage.likes.day.used, 6);
  assert.equal(usage.likes.day.limit, DEFAULT_CAPS.likes.perDay);
  assert.equal(usage.outbound.day.used, 7, 'the direct message counts toward the outbound total as well');
});

test('a rebuild skips the lines that are not outbound actions, and a mediaDelete counts toward outbound only', () => {
  const state = memoryState();
  const lines = [
    lineAt(START - 60 * 1000, 'inbound', 'skipped'),
    lineAt(START - 60 * 1000, 'like', 'preview'),
    lineAt(START - 60 * 1000, 'mediaDelete', 'ok', 'media-1'),
  ];
  rebuildCapsFromAudit({ caps: DEFAULT_CAPS, state, audit: fakeAudit(lines), now: () => START });
  const usage = createCaps({ caps: DEFAULT_CAPS, state, now: () => START }).usage();
  assert.equal(usage.outbound.day.used, 1);
  assert.equal(usage.likes.day.used, 0);
});

test('a rebuild keeps the sender of an auto-reply and the tag of a hashtag, and counts an unusable one as unusable', () => {
  const state = memoryState();
  const lines = [
    lineAt(START - 60 * 1000, 'autoReply', 'ok', 'user-1'),
    lineAt(START - 60 * 1000, 'autoReply', 'ok', ''),
    lineAt(START - 60 * 1000, 'hashtagSearch', 'ok', '#Sun'),
    lineAt(START - 60 * 1000, 'hashtagSearch', 'ok', 'bad tag!'),
  ];
  const result = rebuildCapsFromAudit({ caps: DEFAULT_CAPS, state, audit: fakeAudit(lines), now: () => START });
  assert.equal(result.unusable, 2);
  assert.deepEqual(state.get('caps.auto_reply'), [{ at: START - 60 * 1000, id: 'audit:0', senderId: 'user-1' }]);
  assert.deepEqual(state.get('caps.hashtag'), [{ at: START - 60 * 1000, id: 'audit:2', tag: 'sun' }]);
  const usage = createCaps({ caps: DEFAULT_CAPS, state, now: () => START }).usage();
  assert.equal(usage.auto_reply.day.used, 1);
  assert.equal(usage.hashtag.week.used, 1);
});

// P4 review, lost-state rebuild. The lookups of business discovery and mentioned media are rebuilt into their own daily buckets, and
// they are not outbound actions.
test('a rebuild counts business-discovery and mentioned-media lookups into their own daily buckets, not outbound', () => {
  const state = memoryState();
  const lines = [
    lineAt(START - 60 * 1000, 'businessDiscovery'),
    lineAt(START - 60 * 1000, 'businessDiscovery'),
    lineAt(START - 60 * 1000, 'mentionedMedia', 'error'),
  ];
  rebuildCapsFromAudit({ caps: DEFAULT_CAPS, state, audit: fakeAudit(lines), now: () => START });
  const usage = createCaps({ caps: DEFAULT_CAPS, state, now: () => START }).usage();
  assert.equal(usage.business_discovery.day.used, 2);
  assert.equal(usage.mentioned_media.day.used, 1);
  assert.equal(usage.outbound.day.used, 0);
});

// P4 final N-2. The one-reply record of a comment is rebuilt from its privateReply audit lines. A line is kept when the comment's stored
// time is unknown, and when it is within 7 days of the comment's time. The earliest kept line gives the record's time.
test('a rebuild keeps the one-reply record of a comment when its time is unknown, and when the reply is within 7 days of it', () => {
  const state = memoryState();
  const commentTimes = { 1001: new Date(START - 2 * DAY).toISOString(), 1002: new Date(START - 20 * DAY).toISOString() };
  const lines = [
    lineAt(START - 60 * 1000, 'privateReply', 'ok', '2001'),
    lineAt(START - DAY, 'privateReply', 'ok', '1001'),
    lineAt(START - 2 * HOUR, 'privateReply', 'error', '1001'),
    lineAt(START - 60 * 1000, 'privateReply', 'ok', '1002'),
  ];
  // Changed in the P4 fix round 2 (N-10). Old call (removed): rebuildCapsFromAudit({ ..., commentTimeOf }) returned privateReplies. New: the
  // one-reply records are their own scan, rebuildPrivateReplies, so a failed caps scan does not drop them. The assertions are unchanged.
  const rebuilt = rebuildPrivateReplies({
    audit: fakeAudit(lines),
    now: () => START,
    commentTimeOf: (id) => commentTimes[id] ?? null,
  });
  assert.deepEqual(Object.keys(rebuilt.privateReplies).sort(), ['1001', '2001'], 'the comment 1002 reply is more than 7 days from its comment');
  assert.deepEqual(rebuilt.privateReplies['1001'], { at: new Date(START - DAY).toISOString(), preSendFailures: 0, released: false });
  assert.equal(rebuilt.privateReplies['2001'].at, new Date(START - 60 * 1000).toISOString(), 'an unknown comment time keeps the line time');
});

// P4 final N-2. A privateReply line whose target is not a comment id gives no record, and it is counted as unusable.
test('a privateReply line whose target is not a comment id gives no record and is counted as unusable', () => {
  // Changed in the P4 fix round 2 (N-10). Old assertion (removed): rebuildCapsFromAudit(...).unusable === 1, the line counted in the caps
  // rebuild. New: rebuildPrivateReplies(...).unusable === 1. The caps rebuild counts the line in its owner-DM and outbound counters.
  const rebuilt = rebuildPrivateReplies({
    audit: fakeAudit([lineAt(START - 60 * 1000, 'privateReply', 'ok', 'not-an-id')]),
    now: () => START,
  });
  assert.deepEqual(rebuilt.privateReplies, {});
  assert.equal(rebuilt.unusable, 1);
});

// P4 final N-3. The same lines give the same counts whatever order they are in: each is counted by its own time.
test('the counts of an out-of-order audit file are the same as those of the ordered one', () => {
  const times = [START - 3 * HOUR, START - 60 * 1000, START - 2 * DAY, START - 5 * HOUR, START - 30 * 60 * 1000];
  const ordered = times.slice().sort((a, b) => a - b).map((at) => lineAt(at, 'like'));
  const run = (lines) => {
    const state = memoryState();
    const result = rebuildCapsFromAudit({ caps: DEFAULT_CAPS, state, audit: fakeAudit(lines), now: () => START });
    return { counted: result.counted, likes: state.get('caps.likes').map((entry) => entry.at), usage: createCaps({ caps: DEFAULT_CAPS, state, now: () => START }).usage() };
  };
  const expected = run(ordered);
  assert.deepEqual(run([...ordered].reverse()), expected);
  assert.equal(expected.usage.likes.day.used, 4, 'the lines older than a day are not counted');
});

// P5a round 1, I-1. The damaged count of the one-reply scan is returned, so a caller can treat a damaged line as an unknown scan. A clean scan
// returns zero.
test('rebuildPrivateReplies returns the damaged count of its scan, and a clean scan returns zero (I-1)', () => {
  const damaged = { scanSince: () => ({ damaged: 2, visited: 0 }), record() {} };
  const withDamage = rebuildPrivateReplies({ audit: damaged, now: () => START });
  assert.equal(withDamage.damaged, 2);
  assert.deepEqual(withDamage.privateReplies, {});
  const clean = rebuildPrivateReplies({ audit: fakeAudit([]), now: () => START });
  assert.equal(clean.damaged, 0);
});
