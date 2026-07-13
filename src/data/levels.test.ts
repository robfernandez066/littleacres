import { describe, expect, it } from 'vitest';

import { levelForXp, MAX_LEVEL, xpForLevel } from './levels';

describe('levelForXp', () => {
  it('caps at level 8 (T3.11)', () => {
    expect(MAX_LEVEL).toBe(8);
  });

  it('stays at level 1 below the level-2 threshold', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(29)).toBe(1);
  });

  it('reaches level 7 exactly at its 3500 xp threshold (T3.11)', () => {
    expect(xpForLevel(7)).toBe(3500);
    expect(levelForXp(3499)).toBe(6);
    expect(levelForXp(3500)).toBe(7);
    expect(levelForXp(3501)).toBe(7);
  });

  it('reaches level 8 exactly at its 5500 xp threshold (T3.11)', () => {
    expect(xpForLevel(8)).toBe(5500);
    expect(levelForXp(5499)).toBe(7);
    expect(levelForXp(5500)).toBe(8);
    expect(levelForXp(5501)).toBe(8);
  });

  it('reaches level 2 exactly at its threshold and beyond', () => {
    expect(levelForXp(30)).toBe(2);
    expect(levelForXp(31)).toBe(2);
  });

  it('reaches the max level exactly at its threshold', () => {
    expect(levelForXp(xpForLevel(MAX_LEVEL))).toBe(MAX_LEVEL);
  });

  it('clamps to MAX_LEVEL beyond the top threshold', () => {
    expect(levelForXp(xpForLevel(MAX_LEVEL) + 1000)).toBe(MAX_LEVEL);
  });
});
