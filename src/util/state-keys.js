// The state keys that more than one module reads or writes. Each is defined here once.

// The key of the stop record (src/guard.js reads it, src/state.js holds it).
export const STOP_KEY = 'stop';
// The event cursors (src/events.js keeps them; src/state.js repairs them; src/guard.js reads LAST_SEQ_KEY at startup).
export const ISSUED_KEY = 'events.issued';
export const ACKED_KEY = 'events.acked';
export const LAST_SEQ_KEY = 'events.lastSeq';
