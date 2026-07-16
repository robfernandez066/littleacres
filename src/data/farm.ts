/**
 * Starting farm layout: a 4x3 grid of 12 plots. FARM_COLS/FARM_ROWS fix the
 * base layout; FARM_MAX_ROWS is the maximal grid (the frozen frame the iso
 * origin pins to in `iso.ts` - T3.3a) - the expansion grows owned land to the
 * 4th row without recentering the grid.
 */
export const FARM_COLS = 4;
export const FARM_ROWS = 3;

/**
 * Rows of the maximal plot grid (T3.3a): the base rows plus the expansion
 * row. The iso origin is FROZEN to this frame (see `iso.ts`), plot col/row
 * validation runs against it, and the tile field always draws all
 * FARM_COLS x FARM_MAX_ROWS of it.
 */
export const FARM_MAX_ROWS = 4;

/** Plot count before any expansion has been purchased. */
export const BASE_PLOT_COUNT = FARM_COLS * FARM_ROWS;

/** Plot count after the (currently only) expansion: one extra row. */
export const EXPANDED_PLOT_COUNT = FARM_COLS * FARM_MAX_ROWS;

/** Coin cost of the base -> expanded expansion. */
export const EXPANSION_COST = 500;
