import { WORLD_MIN_X, WORLD_MIN_Y, WORLD_WIDTH } from '../config';

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
 * the world rect (config.ts WORLD_MIN_X/Y + WORLD_WIDTH/HEIGHT) EXCEPT:
 * - the south band y > 2010 (T3.3a-r2x PM ruling): a tile diamond below
 *   that line can never scroll clear of the screen-fixed seed-bar band
 *   (band top at screen y 1560) even at max zoom-in - at zoom 1.6 and the
 *   southmost legal scroll, screen y 1560 is world y 2015 - so a plot
 *   there could be seen but never reliably tap-farmed;
 * with a small margin at the remaining world edges. `placeablePlotTiles`
 * (systems/gameState.ts) enumerates the hidden-grid tiles whose diamonds
 * fit here, in the frozen iso frame.
 *
 * T4.10: the DEFAULT buildable area grows 2 columns WEST - MIN_X 20 -> -236
 * (2 x TILE_WIDTH/2 = 256px), so the leftmost admissible visual column
 * (col - row) goes -3 -> -5 and the base set goes 136 -> 170 tiles. The west
 * strip is no longer a "mere reserve": that reserve was comment-only (no art,
 * no code ever existed for it) and is absorbed by this expansion. WORLD_MIN_X
 * moved -180 -> -256 to keep the standard 20px edge margin west of the new
 * plots; the east edge is unchanged.
 */
export const PLOT_PLACEABLE_MIN_X = -236;
export const PLOT_PLACEABLE_MAX_X = 1240;
export const PLOT_PLACEABLE_MIN_Y = -300;
export const PLOT_PLACEABLE_MAX_Y = 2010;

/**
 * Static save-validation bounds for a plot's col/row (T3.3a-r): they enclose
 * the ENLARGED placeable set (base rect UNION every region's band since T3.3b)
 * with margin, and also bound the scan `computePlaceablePlotTiles` runs.
 * Derivation (pinned by a test): in the frozen frame the base rect admits
 * col [-10, 11] / row [-9, 11] (T4.10 west growth); the East Meadow band
 * (REGIONS, x 1240..1752) pushes the union to col [-10, 13] and row [-11, 11].
 * [-12, 14] encloses all of that with at least a 1-tile margin on every side
 * (col -10 gets 2, col 13 gets exactly 1, row -11 gets exactly 1, row 11
 * gets 3). Negative coordinates are expected -
 * tile (0, 0) is the legacy grid's top corner, not the scene's. Still a pure
 * LOOSENING of the T3.3a-r bounds ([-10, 12]) - no schema bump.
 */
export const PLOT_GRID_COORD_MIN = -12;
export const PLOT_GRID_COORD_MAX = 14;

/** Plot count before any expansion has been purchased. */
export const BASE_PLOT_COUNT = FARM_COLS * FARM_ROWS;

/** Plot count after the (currently only) expansion: one extra row. */
export const EXPANDED_PLOT_COUNT = FARM_COLS * FARM_MAX_ROWS;

/** Coin cost of the base -> expanded expansion. */
export const EXPANSION_COST = 500;

/**
 * Purchasable regions (T3.3b): config-extensible land the world grows into.
 * The FIRST region is "East Meadow", the eastern band the world grew for in
 * T3.3b (config.ts WORLD_WIDTH). Buying a region clears its dim, retires its
 * sign, grants `plotGrant` plots through the same 5C grant flow the expand
 * sign uses, and raises the plot entitlement cap by `entitlementIncrease`.
 * R2/R3 land later as ADDITIONAL entries here - never new code paths.
 */
export interface RegionRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface RegionDef {
  /** Save/lookup id; also the `state.regionsUnlocked` entry. */
  id: string;
  /** Display name (region sign title, unlock copy). */
  name: string;
  costCoins: number;
  /** Player level required to purchase (below it, the sign refuses). */
  levelGate: number;
  /** Plots granted into the shed on purchase (via the 5C grant flow). */
  plotGrant: number;
  /** How much this region raises the plot entitlement cap when unlocked. */
  entitlementIncrease: number;
  /** The band's placeable rect (design space, frozen iso frame). */
  placeableRect: RegionRect;
  /** Where the region sign stands while the region is locked (design space). */
  signPosition: { x: number; y: number };
}

/**
 * The margin the base placeable rect keeps between itself and the world edge
 * (T3.3b): the north edge sits `PLOT_PLACEABLE_MIN_Y - WORLD_MIN_Y` = 20 px
 * inside the world, and the east edge kept the identical 20 px against the
 * pre-growth world east edge (1260 - 1240). A region band reuses this same
 * margin at the NEW world east edge rather than inventing its own - so the
 * band's rules stay derived from the existing constants, not re-tuned.
 */
const REGION_EDGE_MARGIN = PLOT_PLACEABLE_MIN_Y - WORLD_MIN_Y;

/**
 * The East Meadow band's placeable rect (T3.3b): x from the base rect's east
 * edge (PLOT_PLACEABLE_MAX_X) to the new world east edge minus REGION_EDGE_MARGIN;
 * y identical to the base rect. All four edges derive from existing farm.ts /
 * config.ts constants - no invented margins. With the T3.3b world (east edge
 * 1772) this is x [1240, 1752], y [-300, 2010].
 */
const EAST_MEADOW_RECT: RegionRect = {
  minX: PLOT_PLACEABLE_MAX_X,
  maxX: WORLD_MIN_X + WORLD_WIDTH - REGION_EDGE_MARGIN,
  minY: PLOT_PLACEABLE_MIN_Y,
  maxY: PLOT_PLACEABLE_MAX_Y,
};

export const REGIONS: readonly RegionDef[] = [
  {
    id: 'east_meadow',
    name: 'East Meadow',
    costCoins: 7500,
    levelGate: 7,
    plotGrant: 6,
    entitlementIncrease: 6,
    placeableRect: EAST_MEADOW_RECT,
    // PM-provisional (owner will hot-tune): inside the band near its west
    // edge, visible from owned land. Kept a plain literal on purpose.
    signPosition: { x: 1340, y: 1000 },
  },
];

/** Every known region id - the domain of `state.regionsUnlocked` validation. */
export const REGION_IDS: ReadonlySet<string> = new Set(REGIONS.map((region) => region.id));

/** The region def for `id`, or undefined if unknown. */
export function findRegion(id: string): RegionDef | undefined {
  return REGIONS.find((region) => region.id === id);
}

/**
 * The plot entitlement cap (placed + shed) for a set of unlocked regions
 * (T3.3b): the maximal base grid (EXPANDED_PLOT_COUNT = 16) plus the sum of
 * `entitlementIncrease` over every unlocked, KNOWN region (unknown ids are
 * ignored - validation is the arbiter of those). With East Meadow unlocked
 * this is 16 + 6 = 22.
 */
export function plotEntitlementCap(regionsUnlocked: readonly string[]): number {
  let cap = EXPANDED_PLOT_COUNT;
  for (const id of regionsUnlocked) {
    const region = findRegion(id);
    if (region !== undefined) cap += region.entitlementIncrease;
  }
  return cap;
}
