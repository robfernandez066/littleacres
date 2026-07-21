import { CHEST_UNLOCK_LEVEL } from './chests';

/** Highest attainable player level in the current balance pass. */
export const MAX_LEVEL = 8;

/**
 * Cumulative xp thresholds. Index i is the xp needed to REACH level i+1, so
 * `XP_THRESHOLDS[level - 1]` is the answer for any level 1..MAX_LEVEL.
 * Balance Pass v2, re-shaped by T4.11-fix (owner-approved, simulation-verified).
 *
 * L2 = 30 RESTORES THE ONBOARDING CONTRACT: data/onboarding.ts scripts the
 * tutorial to deliver exactly 30 xp (10 harvests x 2, plus ORDER_A's +10) and
 * is designed to hit level 2 at that moment - the celebration and the Starcorn
 * reveal fire mid-tutorial, and step 10 (plant-mixed) needs Starcorn to be
 * unlocked. The v2 pass had moved L2 to 900 and stranded the tutorial there.
 *
 * L3-L8 keep the v2 increments EXACTLY (+1600, +2600, +6500, +11000, +20000,
 * +43500), so only the L1->L2 hop changed and organic L2->L8 pacing is
 * untouched: L1->L8 is 11.1 days, every level-length ratio 1.3-1.8x.
 */
const XP_THRESHOLDS: readonly number[] = [0, 30, 1630, 4230, 10730, 21730, 41730, 85230];

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

/** A level-up celebration card that announces a system unlock, not a crop. */
export interface SystemUnlockCard {
  level: number;
  iconFrame: string;
  label: string;
}

/** Future system unlocks (T3.22+) append here. */
export const SYSTEM_UNLOCK_CARDS: readonly SystemUnlockCard[] = [
  {
    level: CHEST_UNLOCK_LEVEL,
    iconFrame: 'chest_closed',
    label: 'Treasure Chests unlocked!',
  },
];
