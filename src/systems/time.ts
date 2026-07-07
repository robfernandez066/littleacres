/**
 * Game clock. All gameplay timers (crop growth, processing queues, etc.)
 * must read time from `now()`, never `Date.now()` directly - only save
 * metadata (e.g. `lastSavedAt`) stays on real wall-clock time. Routing
 * gameplay time through here is what lets the dev overlay warp time forward.
 *
 * The offset is in-memory only: it is never saved, and a refresh clears it
 * back to zero. That is intended.
 */

let devTimeOffsetMs = 0;

export function now(): number {
  return Date.now() + devTimeOffsetMs;
}

export function advanceTime(ms: number): void {
  devTimeOffsetMs += ms;
}

export function getTimeOffsetMs(): number {
  return devTimeOffsetMs;
}
