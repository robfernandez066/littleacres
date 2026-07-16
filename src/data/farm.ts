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

/**
 * The placeable rect (T3.3a-r, grown to the day-one world in T3.3a-r2): the
 * design-space region a plot tile's diamond must fit inside to be placeable -
 * the full 1440x2560 world rect (config.ts WORLD_MIN_X/Y + WORLD_WIDTH/
 * HEIGHT) EXCEPT:
 * - the west strip x < 20: the MERE RESERVE (art pending - no plots may
 *   ever sit there);
 * - the south band y > 2010 (T3.3a-r2x PM ruling): a tile diamond below
 *   that line can never scroll clear of the screen-fixed seed-bar band
 *   (band top at screen y 1560) even at max zoom-in - at zoom 1.6 and the
 *   southmost legal scroll, screen y 1560 is world y 2015 - so a plot
 *   there could be seen but never reliably tap-farmed;
 * with a small margin at the remaining world edges. `placeablePlotTiles`
 * (systems/gameState.ts) enumerates the hidden-grid tiles whose diamonds
 * fit here, in the frozen iso frame.
 */
export const PLOT_PLACEABLE_MIN_X = 20;
export const PLOT_PLACEABLE_MAX_X = 1240;
export const PLOT_PLACEABLE_MIN_Y = -300;
export const PLOT_PLACEABLE_MAX_Y = 2010;

/**
 * Static save-validation bounds for a plot's col/row (T3.3a-r): they enclose
 * the placeable set with margin. Derivation (pinned by a test): in the frozen
 * frame the placeable rect above admits tiles with col within [-9, 11] and
 * row within [-9, 10], so [-10, 12] encloses all of that with at least a
 * 1-tile margin on every side. Negative coordinates are expected - tile
 * (0, 0) is the legacy grid's top corner, not the scene's. Still a pure
 * LOOSENING of the committed v16 bounds ([-6, 8]) - no schema bump.
 */
export const PLOT_GRID_COORD_MIN = -10;
export const PLOT_GRID_COORD_MAX = 12;

/** Plot count before any expansion has been purchased. */
export const BASE_PLOT_COUNT = FARM_COLS * FARM_ROWS;

/** Plot count after the (currently only) expansion: one extra row. */
export const EXPANDED_PLOT_COUNT = FARM_COLS * FARM_MAX_ROWS;

/** Coin cost of the base -> expanded expansion. */
export const EXPANSION_COST = 500;
