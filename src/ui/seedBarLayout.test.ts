import { describe, expect, it } from 'vitest';

import { CROPS } from '../data/crops';
import {
  clampScrollX,
  FULL_SIZE_BUTTONS,
  scrollXToCenter,
  type SeedStripMetrics,
  stripContentWidth,
  visibleSeedButtonCount,
} from './seedBarLayout';

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

/** SeedBar's real geometry (BUTTON_WIDTH/BUTTON_SPACING/DESIGN_WIDTH/BAR_SIDE_MARGIN). */
const BAR: SeedStripMetrics = { buttonWidth: 196, spacing: 208, viewWidth: 1080, sideMargin: 20 };

/** Button `index`'s world center x under the module's scrollX convention. */
const worldX = (index: number, count: number, scrollX: number, m: SeedStripMetrics) =>
  m.viewWidth / 2 + (index - (count - 1) / 2) * m.spacing + scrollX;

describe('scroll strip math (T3.23)', () => {
  it('stripContentWidth is (count - 1) pitches plus one card', () => {
    expect(stripContentWidth(5, BAR)).toBe(1028);
    expect(stripContentWidth(7, BAR)).toBe(1444);
    expect(stripContentWidth(1, BAR)).toBe(196);
  });

  it('clamps so the first card never passes the left margin (7 cards)', () => {
    const max = clampScrollX(10_000, 7, BAR);
    expect(max).toBe(202);
    // At the clamp, card 0's left edge sits exactly on the side margin.
    expect(worldX(0, 7, max, BAR) - BAR.buttonWidth / 2).toBe(BAR.sideMargin);
  });

  it('clamps so the last card never passes the right margin (7 cards)', () => {
    const min = clampScrollX(-10_000, 7, BAR);
    expect(min).toBe(-202);
    expect(worldX(6, 7, min, BAR) + BAR.buttonWidth / 2).toBe(BAR.viewWidth - BAR.sideMargin);
  });

  it('passes in-range offsets through unchanged', () => {
    expect(clampScrollX(150, 7, BAR)).toBe(150);
    expect(clampScrollX(-150, 7, BAR)).toBe(-150);
    expect(clampScrollX(0, 7, BAR)).toBe(0);
  });

  it('collapses to the centered offset (0) whenever the content fits the screen', () => {
    // 5 cards span 1028 < 1040 usable px - the static-layout case.
    for (const desired of [0, 5, -5, 10_000, -10_000]) {
      expect(clampScrollX(desired, 5, BAR)).toBe(0);
      expect(clampScrollX(desired, 1, BAR)).toBe(0);
    }
  });

  it('scrollXToCenter puts the chosen card at screen center when the clamp allows', () => {
    // The middle of 7 centers at the neutral offset...
    expect(scrollXToCenter(3, 7, BAR)).toBe(0);
    // ...and an off-middle card truly lands on center when there is room
    // (narrower view => wider clamp range than one 208px pitch).
    const roomy: SeedStripMetrics = { ...BAR, viewWidth: 1000 };
    const offset = scrollXToCenter(2, 7, roomy);
    expect(offset).toBe(208);
    expect(worldX(2, 7, offset, roomy)).toBe(roomy.viewWidth / 2);
  });

  it('scrollXToCenter clamps at the strip ends (edge cards cannot reach center)', () => {
    expect(scrollXToCenter(0, 7, BAR)).toBe(202);
    expect(scrollXToCenter(1, 7, BAR)).toBe(202);
    expect(scrollXToCenter(6, 7, BAR)).toBe(-202);
    expect(scrollXToCenter(5, 7, BAR)).toBe(-202);
  });

  it('scrollXToCenter is the centered no-op when the content fits', () => {
    for (const index of [0, 2, 4]) expect(scrollXToCenter(index, 5, BAR)).toBe(0);
  });
});
