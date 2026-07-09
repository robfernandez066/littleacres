/**
 * Starting farm layout: a 4x3 grid of 12 plots. FARM_COLS/FARM_ROWS fix the
 * base layout (and the iso origin derived from it in `iso.ts`) - the
 * expansion below adds a 4th row without recentering the grid.
 */
export const FARM_COLS = 4;
export const FARM_ROWS = 3;

/** Plot count before any expansion has been purchased. */
export const BASE_PLOT_COUNT = FARM_COLS * FARM_ROWS;

/** Plot count after the (currently only) expansion: one extra row. */
export const EXPANDED_PLOT_COUNT = 16;

/** Coin cost of the base -> expanded expansion. */
export const EXPANSION_COST = 500;
