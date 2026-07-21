import { describe, expect, it } from 'vitest';

import { levelForXp, MAX_LEVEL, xpForLevel } from './levels';

describe('levelForXp', () => {
  it('caps at level 8 (T3.11)', () => {
    expect(MAX_LEVEL).toBe(8);
  });

  it('stays at level 1 below the level-2 threshold', () => {
    expect(levelForXp(0)).toBe(1);
    // RE-PIN (T4.11-fix): the level-2 threshold came back down 900 -> 30 to
    // restore the onboarding contract, so the last level-1 xp value is 29.
    expect(levelForXp(29)).toBe(1);
  });

  it('reaches level 7 exactly at its 41730 xp threshold (T3.11)', () => {
    // RE-PIN (T4.11-fix): XP_THRESHOLDS[6] 42600 -> 41730 - the v2 increment
    // (+20000 over L6) is unchanged, it just starts 870 lower after the L2 hop.
    expect(xpForLevel(7)).toBe(41730);
    expect(levelForXp(41729)).toBe(6);
    expect(levelForXp(41730)).toBe(7);
    expect(levelForXp(41731)).toBe(7);
  });

  it('reaches level 8 exactly at its 85230 xp threshold (T3.11)', () => {
    // RE-PIN (T4.11-fix): XP_THRESHOLDS[7] 86100 -> 85230 - same +43500 v2
    // increment over L7, shifted down by the same 870.
    expect(xpForLevel(8)).toBe(85230);
    expect(levelForXp(85229)).toBe(7);
    expect(levelForXp(85230)).toBe(8);
    expect(levelForXp(85231)).toBe(8);
  });

  it('reaches level 2 exactly at its threshold and beyond', () => {
    // RE-PIN (T4.11-fix): XP_THRESHOLDS[1] 900 -> 30, the onboarding contract.
    expect(levelForXp(30)).toBe(2);
    expect(levelForXp(31)).toBe(2);
  });

  it('holds the v2 increments for every level past 2 (T4.11-fix)', () => {
    // Only the L1->L2 hop was re-shaped; L3-L8 keep Balance Pass v2's exact
    // step sizes, which is what keeps organic L2->L8 pacing untouched.
    const thresholds = Array.from({ length: MAX_LEVEL }, (_, i) => xpForLevel(i + 1));
    expect(thresholds).toEqual([0, 30, 1630, 4230, 10730, 21730, 41730, 85230]);
    const increments = thresholds.slice(2).map((xp, i) => xp - thresholds[i + 1]!);
    expect(increments).toEqual([1600, 2600, 6500, 11000, 20000, 43500]);
  });

  it('reaches the max level exactly at its threshold', () => {
    expect(levelForXp(xpForLevel(MAX_LEVEL))).toBe(MAX_LEVEL);
  });

  it('clamps to MAX_LEVEL beyond the top threshold', () => {
    expect(levelForXp(xpForLevel(MAX_LEVEL) + 1000)).toBe(MAX_LEVEL);
  });
});
