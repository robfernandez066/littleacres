/** Portrait mobile design resolution. All layout is authored against this. */
export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;

/** Texture key of the single texture atlas loaded in Preload. */
export const ATLAS_KEY = 'atlas';

/**
 * Tile frame geometry (see ASSETS.md and tools/pack-atlas.mjs). The tile art
 * has raised lips/fringes, so the frame is taller than the 2:1 diamond: the
 * diamond's top face spans TILE_WIDTH x TILE_HEIGHT (256x128, iso.ts) with
 * its center at (TILE_FRAME_WIDTH / 2, TILE_DIAMOND_CENTER_Y) and the lip
 * hanging below. Tile sprites therefore render with origin
 * (0.5, TILE_DIAMOND_CENTER_Y / TILE_FRAME_HEIGHT) so grid math is untouched.
 */
export const TILE_FRAME_WIDTH = 256;
export const TILE_FRAME_HEIGHT = 160;
export const TILE_DIAMOND_CENTER_Y = 64;

/**
 * Nine-slice margin for the `panel` frame, on all four sides of every
 * nineslice call. Measured from the packed art by tools/pack-atlas.mjs
 * (border 11px, corner radius ~15px, plus safety) - rerun the packer after
 * changing the panel art and keep this in sync with its logged value.
 */
export const PANEL_SLICE = 18;

/**
 * Screen position of the HUD coin counter (design space), on the banner's
 * left side, vertically centered in the slim strip (y 14..158, center 86).
 * x=110, not flush against the left slice boundary (60): live review found
 * the coin icon visibly overlapping the left vine curl (native x 2..51,
 * unscaled 1:1 in the slice) at x=85. Coin arcs fly here.
 */
export const HUD_COIN_POSITION = { x: 110, y: 86 } as const;

/**
 * Screen position of the HUD bag button (design space): the only bare icon
 * on the banner's right side, vertically centered in the strip. Harvested
 * crops fly here. The orders button retired in T2.22 (orders now open from
 * the notice board structure on the farm - see NOTICE_BOARD_POSITION).
 */
export const BAG_POSITION = { x: 834, y: 86 } as const;

/**
 * Screen position (design space) of the community notice board structure on
 * the farm - tapping it opens the order board (T2.22, replacing the old HUD
 * orders icon). Depth is derived from its own y at render time, same iso
 * sorting rule as crops.
 *
 * T2.22a: relocated to the bottom-right, swapping spots with the farmhouse
 * (which now sits where the board used to be - see FARMHOUSE_POSITION).
 * MEASURED (Jimp opaque-bounds scan of the packed `notice_board` frame,
 * cross-checked against the iso grid math in systems/iso.ts): at this
 * position and STRUCTURE_SCALE, the board's opaque left edge (~x822) clears
 * the nearest plot tile's opaque right edge with a 38px margin at
 * BASE_PLOT_COUNT (12 plots) and 70px at EXPANDED_PLOT_COUNT (16 plots) - the
 * closest tile in both cases is (col 3, row 1), not the grid's own bottom-most
 * corner, which sits further left. Its top edge (~y1190) clears the Expand
 * sign's x-range by 178px (so it's unambiguously "beside" it, not "above"
 * it) and its bottom edge (~y1430) clears the seed bar band (top ~1550) by
 * 120px. Its right edge (~x978) clears the screen edge by 102px.
 */
export const NOTICE_BOARD_POSITION = { x: 900, y: 1310 } as const;

/**
 * Screen position (design space) of the decorative farmhouse structure.
 *
 * T2.22a: relocated to the notice board's old top-right spot (swapping with
 * it) and grown to FARMHOUSE_DISPLAY_HEIGHT (~300, up from the shared
 * STRUCTURE_DISPLAY_HEIGHT of 240 the notice board keeps - see FarmScene.ts).
 * MEASURED (Jimp opaque-bounds scan of the packed `farmhouse` frame): at this
 * position and size, the farmhouse's opaque top edge (y370) clears the
 * lowest HUD element (y265) by 105px, its opaque bottom edge (y670) clears
 * every plot tile's visual top edge at both field sizes (>=704) by >=34px,
 * and its right edge (x~1014) clears the screen edge by 66px.
 */
export const FARMHOUSE_POSITION = { x: 880, y: 520 } as const;

/**
 * Off-screen-right point the fulfilled order goods fly to - "handed to the
 * villager". Past DESIGN_WIDTH so sprites exit the frame before landing.
 */
export const VILLAGER_POSITION = { x: 1240, y: 900 } as const;

/**
 * Screen position (design space) of the dirt path ground decal (T2.22b),
 * connecting the farmhouse down toward the plot grid's upper-right edge.
 *
 * MEASURED (Jimp: rendered the packed `dirt_path`, `plot`, and `farmhouse`
 * frames into full-resolution alpha masks at this position/scale, using the
 * same iso grid math as systems/iso.ts, for every plot at both
 * BASE_PLOT_COUNT (12 plots, 3 rows) and EXPANDED_PLOT_COUNT (16 plots, 4
 * rows)): pixel-exact alpha-mask collision check finds ZERO overlapping
 * opaque pixels between the path and any plot tile at either field size
 * (nearest tile clears by roughly 35px+ per an earlier bounding estimate).
 * The path's upper-right tip lands within the farmhouse's own opaque
 * footprint (overlap there is intentional - see FarmScene's
 * `createDirtPath`), close to its base/steps but not pixel-exact on them,
 * since a tighter fit would cut the tile clearance at the 16-plot layout.
 * Position chosen by search over a grid of candidates, confirmed by
 * rendering a static composite of both field sizes with the real packed art
 * (browser automation was unavailable this session - see the task report).
 */
export const DIRT_PATH_POSITION = { x: 750, y: 630 } as const;
