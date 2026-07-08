/** Highest attainable player level in the current balance pass. */
export const MAX_LEVEL = 5;

/**
 * Cumulative xp thresholds. Index i is the xp needed to REACH level i+1, so
 * `XP_THRESHOLDS[level - 1]` is the answer for any level 1..MAX_LEVEL.
 * Provisional balance, will be tuned later.
 */
const XP_THRESHOLDS: readonly number[] = [0, 30, 90, 200, 380];

/** Cumulative xp required to reach `level`. Clamped to 1..MAX_LEVEL. */
export function xpForLevel(level: number): number {
  const clamped = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
  return XP_THRESHOLDS[clamped - 1]!;
}
