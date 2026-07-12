/** Highest attainable player level in the current balance pass. */
export const MAX_LEVEL = 6;

/**
 * Cumulative xp thresholds. Index i is the xp needed to REACH level i+1, so
 * `XP_THRESHOLDS[level - 1]` is the answer for any level 1..MAX_LEVEL.
 * Provisional balance, will be tuned later.
 */
const XP_THRESHOLDS: readonly number[] = [0, 30, 90, 450, 1000, 2000];

/** Cumulative xp required to reach `level`. Clamped to 1..MAX_LEVEL. */
export function xpForLevel(level: number): number {
  const clamped = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
  return XP_THRESHOLDS[clamped - 1]!;
}

/** Highest level whose threshold is <= xp. Clamped to MAX_LEVEL. */
export function levelForXp(xp: number): number {
  for (let level = MAX_LEVEL; level >= 1; level--) {
    if (xp >= xpForLevel(level)) return level;
  }
  return 1;
}
