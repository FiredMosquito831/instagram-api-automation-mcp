// The stop model (P4 fix round 2, N-13). A stop record in the state holds every stop that was observed and not yet cleared, as a list,
// in the order observed. The active stop is the one with the highest rank; when two of equal rank are held, the first observed stays
// active. The top-level fields of the record (stopped, kind, detail, since) are the active stop, so a reader of the record sees the
// stop that counts. Only a confirmed clear removes the list. An older record, which has no list, is read as a list of its one stop.

export const STOP_KINDS = Object.freeze(['AUTH_EXPIRED', 'ACTION_BLOCKED', 'CHECKPOINT', 'RATE_LIMITED', 'STATE_CORRUPT', 'STATE_LOST']);

// The severity of each stop kind. The state stops and the account stops share rank 3, above RATE_LIMITED (rank 2): a damaged or lost
// state halts the poller, and a rate limit must not replace it (P4 review I-1 and N-7). A kind that is not listed has rank 0.
export const STOP_RANK = new Map([
  ['AUTH_EXPIRED', 3],
  ['CHECKPOINT', 3],
  ['ACTION_BLOCKED', 3],
  ['RATE_LIMITED', 2],
  ['STATE_LOST', 3],
  ['STATE_CORRUPT', 3],
]);
export const rankOf = (kind) => STOP_RANK.get(kind) ?? 0;

export const MAX_DETAIL = 200;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RECORD_KEYS = ['detail', 'kind', 'since', 'stopped'];
const RECORD_KEYS_WITH_LIST = ['detail', 'kind', 'since', 'stopped', 'stops'];

// A stop entry: its kind, its detail (already redacted and kept to MAX_DETAIL by the caller), its time, and its rank.
export function entryOf(kind, detail, since) {
  return { kind, detail, since, rank: rankOf(kind) };
}

// The active entry of a list: the first entry of the highest rank, or null for an empty list.
export function activeOf(stops) {
  let active = null;
  for (const entry of stops) {
    if (active === null || entry.rank > active.rank) active = entry;
  }
  return active;
}

// The list with the entry added, unless a stop of that kind is already held. The first observation of a kind keeps its time and detail.
export function withStop(stops, entry) {
  return stops.some((held) => held.kind === entry.kind) ? stops : [...stops, entry];
}

// The stored record of a list. With no stop held, the record is clear.
export function recordOf(stops) {
  const active = activeOf(stops);
  if (active === null) return { stopped: false, kind: null, detail: null, since: null, stops: [] };
  return {
    stopped: true,
    kind: active.kind,
    detail: active.detail,
    since: active.since,
    stops: stops.map((entry) => ({ kind: entry.kind, detail: entry.detail, since: entry.since, rank: entry.rank })),
  };
}

// Reads a stored record into its list. A record of the older shape (no list) is the list of its one stop. A record that cannot be read
// throws, and the caller starts stopped with STATE_CORRUPT (O-3). A record whose top-level stop is not the active entry is refused.
export function readStops(value) {
  const refuse = () => new Error('the stop in the state file is not valid');
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw refuse();
  const keys = Object.keys(value).sort().join(',');
  const hasList = Object.hasOwn(value, 'stops');
  if (!(keys === RECORD_KEYS.join(',') || (hasList && keys === [...RECORD_KEYS_WITH_LIST].sort().join(',')))) throw refuse();
  const { stopped, kind, detail, since } = value;
  if (stopped === false) {
    if (kind !== null || detail !== null || since !== null) throw refuse();
    if (hasList && !(Array.isArray(value.stops) && value.stops.length === 0)) throw refuse();
    return [];
  }
  if (stopped !== true) throw refuse();
  const validDetail = (text) => typeof text === 'string' && text.length <= MAX_DETAIL;
  const validSince = (text) => typeof text === 'string' && ISO_TIME.test(text) && !Number.isNaN(Date.parse(text));
  if (!hasList) {
    if (!STOP_KINDS.includes(kind) || !validDetail(detail) || !validSince(since)) throw refuse();
    return [entryOf(kind, detail, since)];
  }
  if (!Array.isArray(value.stops) || value.stops.length === 0) throw refuse();
  const stops = [];
  for (const item of value.stops) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw refuse();
    if (!STOP_KINDS.includes(item.kind) || !validDetail(item.detail) || !validSince(item.since)) throw refuse();
    if (item.rank !== rankOf(item.kind)) throw refuse();
    if (stops.some((held) => held.kind === item.kind)) throw refuse();
    stops.push(entryOf(item.kind, item.detail, item.since));
  }
  const active = activeOf(stops);
  if (kind !== active.kind || detail !== active.detail || since !== active.since) throw refuse();
  return stops;
}
