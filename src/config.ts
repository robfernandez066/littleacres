/** Portrait mobile design resolution. All layout is authored against this. */
export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;

/** Texture key of the single texture atlas loaded in Preload. */
export const ATLAS_KEY = 'atlas';

/**
 * Loader/texture keys for the two experimental ground textures (T2.28),
 * loaded as standalone images (not atlas frames) - see ASSETS.md "Ground
 * textures (standalone, not atlas frames)".
 */
export const GROUND_TEXTURE_A_KEY = 'grass_texture_a';
export const GROUND_TEXTURE_B_KEY = 'grass_texture_b';

/**
 * Ground rendering mode (T2.28 experiment): 'tiles' draws the grass diamond
 * tiles (the shipping default - safe, unchanged look); 'tiles_flat' (T2.28a)
 * draws the same grid using `grass_flat` (a flat-fill variant with the
 * scalloped tile-edge fringe removed - see tools/pack-atlas.mjs
 * `processTileFlat`), which visibly reduces the grid-line seams 'tiles'
 * shows at each tile boundary; 'texture_a'/'texture_b' instead tile one of
 * the two candidate ground textures across the field band. A dev-overlay
 * button cycles through all four live for the owner's verdict; this
 * constant only controls the BOOT default, which stays 'tiles' until a
 * verdict picks a winner (a one-line follow-up - see ASSETS.md).
 */
export type GroundMode = 'tiles' | 'tiles_flat' | 'texture_a' | 'texture_b';
// 'tiles_flat' (derived seamless-face tile) promoted to default 2026-07-12
// after the owner's verdict, once its over-plots depth bug was fixed.
export const GROUND_MODE: GroundMode = 'tiles_flat';

/**
 * TileSprite tileScale for each ground texture (T2.28), chosen by screenshot
 * comparison at 0.5 and 1.0 in FarmScene's field band - see ASSETS.md "Ground
 * textures (standalone, not atlas frames)" for the screenshots/reasoning.
 */
export const GROUND_TEXTURE_A_TILE_SCALE = 1.0;
export const GROUND_TEXTURE_B_TILE_SCALE = 0.5;

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
 * Screen position of the HUD moondust counter (design space): same banner
 * row as the coin counter (y matches HUD_COIN_POSITION), x=345 per the
 * currency row's layout budget (see Hud.ts's currency-row comment). Moondust
 * arcs fly here (T2.23c).
 */
export const HUD_MOONDUST_POSITION = { x: 345, y: 86 } as const;

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

/**
 * One scene-dressing decal: an atlas frame placed at a fixed screen position
 * with a uniform scale, normally rendered at DRESSING_DEPTH (see
 * FarmScene.createSceneDressing). `front` (T2.28a editor "Move to front"
 * toggle) is an optional escape hatch: when true, the decal renders above
 * every y-depth-sorted object instead (crops, structures, the chest
 * ceremony) - omitted (or false) for the normal, below-everything placement.
 */
export interface DressingPlacement {
  frame: string;
  x: number;
  y: number;
  scale: number;
  front?: boolean;
}

/**
 * All scene dressing (T2.28, collapsed into one array in T2.28a): dirt-based
 * decals (`tuft_1`, `dirt_wisp`, `stones_1`) plus grass-based decals
 * (`tuft_2`, single rocks) hugging the dirt path and scattered across open
 * grass, all rendered at one depth by `FarmScene.createSceneDressing`.
 * Originally two depth-separated arrays (road-edge hugging the path at depth
 * 6, grass scatter in the open at depth 4), each measured by a Jimp
 * opaque-bounds scan against every plot tile (both field sizes) plus the
 * farmhouse/notice board/sign/dirt path footprints - see git history for
 * that measurement detail. From T2.28a on, this array is hand-placed and
 * iterated via the dev-overlay dressing editor ("Edit dressing"): drag/
 * spawn/scale/delete live, then "Copy layout" to hand the PM a fresh array
 * to bake in here.
 */
// Owner-authored layout (2026-07-12, revision 2 with the v2 tufts), placed
// live in the dressing editor and baked from its Copy-layout JSON (PM-direct).
export const DRESSING: DressingPlacement[] = [
  { frame: 'stones_1', x: 834, y: 1288, scale: 0.6 },
  { frame: 'stone_a', x: 606, y: 686, scale: 0.55 },
  { frame: 'stone_b', x: 698, y: 743, scale: 0.55 },
  { frame: 'stone_c', x: 732, y: 724, scale: 0.55 },
  { frame: 'stones_1', x: 986, y: 581, scale: 0.55 },
  { frame: 'stone_a', x: 689, y: 640, scale: 0.55 },
  { frame: 'stone_b', x: 643, y: 661, scale: 0.55 },
  { frame: 'stone_c', x: 771, y: 706, scale: 0.55 },
  { frame: 'tuft_2v2', x: 848, y: 1369, scale: 0.55, front: true },
  { frame: 'tuft_2v2', x: 869, y: 1362, scale: 0.55 },
  { frame: 'tuft_1v2', x: 947, y: 1396, scale: 0.55 },
  { frame: 'tuft_1v2', x: 935, y: 1412, scale: 0.55, front: true },
  { frame: 'tuft_2v2', x: 949, y: 624, scale: 0.55, front: true },
  { frame: 'tuft_2v2', x: 768, y: 530, scale: 0.55 },
];

/**
 * Dressing editor (T2.28a dev overlay) scale-step size, shared by
 * `DevOverlay`'s Scale +/- buttons (which pass +/-this value) and
 * `FarmScene`'s clamp (which owns the min/max).
 */
export const DRESSING_SCALE_STEP = 0.05;

/** Every atlas frame the dressing editor's DOM palette can spawn (T2.28a). */
export const DRESSING_PALETTE_FRAMES = [
  'tuft_1',
  'tuft_2',
  'tuft_1v2',
  'tuft_2v2',
  'dirt_wisp',
  'stones_1',
  'stone_a',
  'stone_b',
  'stone_c',
] as const;
