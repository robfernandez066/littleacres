/**
 * Pure derivation of how many seed buttons the bar shows (T3.11 fix). Kept
 * free of Phaser imports so the rule stays unit-testable without a scene -
 * SeedBar.ts owns everything visual (sizes, spacing, shrink scale).
 */

/**
 * The most buttons that fit the 1080 design width at full size: 5 span
 * 4 * 208 + 196 = 1028px (SeedBar's BUTTON_SPACING/BUTTON_WIDTH). Five or
 * fewer buttons render the historical fixed layout pixel-for-pixel; more
 * shrink uniformly to fit (see SeedBar's `relayout`).
 */
export const FULL_SIZE_BUTTONS = 5;

/**
 * Visible button count, with crops always taken in unlock order (= CROPS
 * order): every unlocked crop, exactly ONE next-locked crop as a teaser (the
 * lowest locked unlockLevel, if any remain), and further locked crops only
 * as filler up to FULL_SIZE_BUTTONS. Low levels therefore keep today's
 * five-button row (its locked fillers already include the teaser), and each
 * unlock past that grows the row by one - the next goal stays visible
 * without crowding the bar with far-off crops.
 */
export function visibleSeedButtonCount(unlockedCount: number, totalCrops: number): number {
  const throughTeaser = Math.min(totalCrops, unlockedCount + 1);
  return Math.max(Math.min(FULL_SIZE_BUTTONS, totalCrops), throughTeaser);
}
