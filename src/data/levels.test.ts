import { describe, expect, it } from 'vitest';

import { levelForXp, MAX_LEVEL, xpForLevel } from './levels';

describe('levelForXp', () => {
  it('stays at level 1 below the level-2 threshold', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(29)).toBe(1);
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
