/**
 * Pure derivation of how many seed buttons the bar shows (T3.11 fix) and the
 * scroll-strip geometry (T3.23). Kept free of Phaser imports so the rules
 * stay unit-testable without a scene - SeedBar.ts owns everything visual and
 * passes its sizes/margins in as `SeedStripMetrics`.
 */

/**
 * The most buttons that fit the 1080 design width at full size: 5 span
 * 4 * 208 + 196 = 1028px (SeedBar's BUTTON_SPACING/BUTTON_WIDTH). Five or
 * fewer buttons render the historical fixed layout pixel-for-pixel; more
 * become a horizontally scrollable strip of full-size cards (see SeedBar's
 * `relayout` and the scroll math below).
 */
export const FULL_SIZE_BUTTONS = 5;

/**
 * Geometry inputs for the scroll-strip math, passed explicitly so this
 * module stays Phaser-free and owns no visual constants. All values are
 * design px.
 */
export interface SeedStripMetrics {
  /** One card's width. */
  buttonWidth: number;
  /** Center-to-center pitch between adjacent cards. */
  spacing: number;
  /** The screen width the strip scrolls within. */
  viewWidth: number;
  /** Margin the strip's extreme positions must leave clear at each edge. */
  sideMargin: number;
}

/** Total strip width: (count - 1) pitches plus one card. */
export function stripContentWidth(count: number, metrics: SeedStripMetrics): number {
  return (count - 1) * metrics.spacing + metrics.buttonWidth;
}

/**
 * scrollX convention: an offset ADDED to the centered row layout, i.e.
 * button i's world center x = viewWidth / 2 + (i - (count - 1) / 2) *
 * spacing + scrollX. 0 is therefore always the centered row, and the static
 * (<= FULL_SIZE_BUTTONS) layout is exactly scrollX = 0. The bounds come out
 * symmetric: +limit puts the first card's left edge on the left margin (it
 * can never scroll further right), -limit puts the last card's right edge on
 * the right margin. When the content fits inside the margins the only valid
 * offset is the centered one.
 */
export function clampScrollX(desired: number, count: number, metrics: SeedStripMetrics): number {
  const limit =
    (stripContentWidth(count, metrics) - (metrics.viewWidth - 2 * metrics.sideMargin)) / 2;
  if (limit <= 0) return 0;
  return Math.min(limit, Math.max(-limit, desired));
}

/** The clamped scrollX that horizontally centers button `index` on screen. */
export function scrollXToCenter(index: number, count: number, metrics: SeedStripMetrics): number {
  return clampScrollX(((count - 1) / 2 - index) * metrics.spacing, count, metrics);
}

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
