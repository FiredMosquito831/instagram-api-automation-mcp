// Clock and timer helpers shared by the modules that read the time or wait for it.

// The longest delay that a Node timer runs. A longer delay fires at once, so no timer is allowed above this value.
export const MAX_TIMER_MS = 2147483647;

// The clock gives milliseconds. Anything else is a programming error.
export function clockMs(now) {
  const ms = now();
  if (!Number.isFinite(ms)) throw new TypeError('the clock must return a time in milliseconds');
  return ms;
}

// The default wait between calls. A test passes its own sleep.
export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
