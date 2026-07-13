import { describe, expect, it } from 'vitest';

import { CROPS } from '../data/crops';
import { FULL_SIZE_BUTTONS, visibleSeedButtonCount } from './seedBarLayout';

const TOTAL_CROPS = Object.keys(CROPS).length;
/** Crops plantable at `level`, mirroring SeedBar.relayout's derivation. */
const unlockedAt = (level: number) =>
  Object.values(CROPS).filter((crop) => crop.unlockLevel <= level).length;

describe('visibleSeedButtonCount (T3.11 teaser rule)', () => {
  it('keeps the historical five-button row through L4 (locked fillers already include the teaser)', () => {
    for (const level of [1, 2, 3, 4]) {
      expect(visibleSeedButtonCount(unlockedAt(level), TOTAL_CROPS)).toBe(FULL_SIZE_BUTTONS);
    }
  });

  it('shows 6 at L5 and L6: five unlocked plus the Dewmelon teaser', () => {
    expect(visibleSeedButtonCount(unlockedAt(5), TOTAL_CROPS)).toBe(6);
    expect(visibleSeedButtonCount(unlockedAt(6), TOTAL_CROPS)).toBe(6);
  });

  it('shows all 7 at L7 (six unlocked + Sagesprig teaser) and at L8 (all unlocked, no teaser left)', () => {
    expect(visibleSeedButtonCount(unlockedAt(7), TOTAL_CROPS)).toBe(7);
    expect(visibleSeedButtonCount(unlockedAt(8), TOTAL_CROPS)).toBe(7);
  });

  it('never exceeds the crop total', () => {
    expect(visibleSeedButtonCount(TOTAL_CROPS, TOTAL_CROPS)).toBe(TOTAL_CROPS);
    expect(visibleSeedButtonCount(TOTAL_CROPS + 5, TOTAL_CROPS)).toBe(TOTAL_CROPS);
  });

  it('shows every crop when there are fewer than FULL_SIZE_BUTTONS in total', () => {
    expect(visibleSeedButtonCount(1, 3)).toBe(3);
    expect(visibleSeedButtonCount(3, 3)).toBe(3);
  });
});
