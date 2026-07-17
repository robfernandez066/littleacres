/** Portrait mobile design resolution. All layout is authored against this. */
export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;

/**
 * The day-one WORLD rect (T3.3a-r2): the pannable/zoomable farm world, grown
 * around the legacy 1080x1920 design rect - which stays exactly where it is
 * (no existing coordinate changes) - with a 180px grass apron east/west and a
 * 320px apron north/south. The default (home) camera view is still the
 * legacy design rect at zoom 1; pinch/pan reaches the apron. The world's
 * west strip is reserved for the mere (see PLOT_PLACEABLE_MIN_X in
 * data/farm.ts).
 */
export const WORLD_MIN_X = -180;
export const WORLD_MIN_Y = -320;
export const WORLD_WIDTH = 1440;
export const WORLD_HEIGHT = 2560;

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
 * Screen position of the HUD scroll (Quests) icon (design space): banner row
 * (same y as the bag), left of the bag slot (T3.10a - the scroll icon's
 * reserved purpose since T2.22, when the old HUD orders button retired in
 * favor of the notice board structure). x=700 sits between the crest's right
 * overhang edge (540 + 160/2 = 620) and the bag icon's left edge (834 - 90/2
 * = 789): at BUTTON_ICON_DISPLAY_SIZE (90), the icon spans x 655..745, a
 * 35px margin from the crest and a 44px margin from the bag.
 */
export const QUEST_ICON_POSITION = { x: 700, y: 86 } as const;

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
 *
 * T3.3s: the board is MOVABLE now - this constant is only the DEFAULT
 * render position (anchor (5,3) + STRUCTURE_RENDER_OFFSETS.noticeBoard,
 * pinned identical by test); live positions derive from state.structures.
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
 *
 * T3.3s: the farmhouse is MOVABLE now - this constant is only the DEFAULT
 * render position (anchor (-1,-3) + STRUCTURE_RENDER_OFFSETS.farmhouse,
 * pinned identical by test); live positions derive from state.structures.
 */
export const FARMHOUSE_POSITION = { x: 880, y: 520 } as const;

/**
 * Movable structures (T3.3s, schema v18): the farmhouse and the notice board
 * are anchored to a hidden-grid tile in the frozen iso frame (see
 * systems/iso.ts - tile centers at (540 + (col-row)*128, 768 + (col+row)*64)),
 * stored per save in `state.structures`. The three constant tables below are
 * pure data - the derivations they must stay consistent with are pinned by
 * tests in systems/gameState.test.ts:
 *
 * - STRUCTURE_DEFAULT_ANCHORS: the anchor tiles a migrated (or fresh) save
 *   starts with. Chosen as the (0,0)-offset member of each structure's
 *   historical blocked-tile set, so the default footprint and render position
 *   reproduce the pre-v18 hardcoded values EXACTLY.
 * - STRUCTURE_FOOTPRINT_OFFSETS: each structure's blocked tiles RELATIVE to
 *   its anchor. At the default anchors these reproduce the historical
 *   FARMHOUSE_BLOCKED_TILES / NOTICE_BOARD_BLOCKED_TILES sets (v16/v17
 *   gameState.ts) tile for tile.
 * - STRUCTURE_RENDER_OFFSETS: pixel delta from the anchor tile's CENTER to
 *   the structure sprite's position. At the default anchors:
 *   farmhouse: gridToIso(-1,-3) = (796, 512), +(84, 8) = FARMHOUSE_POSITION;
 *   noticeBoard: gridToIso(5,3) = (796, 1280), +(104, 30) = NOTICE_BOARD_POSITION.
 */
export type StructureId = 'farmhouse' | 'noticeBoard';

export const STRUCTURE_DEFAULT_ANCHORS: Record<StructureId, { col: number; row: number }> = {
  farmhouse: { col: -1, row: -3 },
  noticeBoard: { col: 5, row: 3 },
};

export const STRUCTURE_FOOTPRINT_OFFSETS: Record<
  StructureId,
  readonly { col: number; row: number }[]
> = {
  farmhouse: [
    { col: -1, row: -1 },
    { col: 0, row: -1 },
    { col: -1, row: 0 },
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: 1, row: 1 },
  ],
  noticeBoard: [
    { col: 0, row: -1 },
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 1, row: 1 },
  ],
};

export const STRUCTURE_RENDER_OFFSETS: Record<StructureId, { x: number; y: number }> = {
  farmhouse: { x: 84, y: 8 },
  noticeBoard: { x: 104, y: 30 },
};

/**
 * Off-screen-right point the fulfilled order goods fly to - "handed to the
 * villager". Past DESIGN_WIDTH so sprites exit the frame before landing.
 */
export const VILLAGER_POSITION = { x: 1240, y: 900 } as const;

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
 * All scene dressing (T2.28, collapsed into one array in T2.28a): fixed
 * ground decals (tufts, stones, wisps) rendered at one depth by
 * `FarmScene.createSceneDressing`. Hand-placed and iterated via the
 * dev-overlay dressing editor ("Edit dressing"): drag/spawn/scale/delete
 * live, then "Copy layout" to hand the PM a fresh array to bake in here.
 *
 * EMPTY since T3.art-1: the old-art-era layout (and the dirt path decal it
 * hugged) clashed with the regenerated farmhouse/plot art and was removed
 * (owner decision). The editor, palette, and plumbing all remain - the
 * owner redresses the farm in the new art era from this blank slate.
 */
export const DRESSING: DressingPlacement[] = [];

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

/**
 * Ground shadows (T3.9): a scene-wide `ground_shadow` image (see
 * tools/pack-atlas.mjs `generateGroundShadow`) rendered under every standing
 * object - the farmhouse, the notice board, and every decoration - the fix
 * for standing sprites reading as "taped on" instead of resting on the
 * ground. Width is this fraction of the object's own display width; height
 * is width x 0.5 (the frame is already 2:1, so this keeps the shadow's own
 * aspect). Not applied to dressing decals - ground-hugging art that never
 * needed rooting.
 */
export const SHADOW_WIDTH_RATIO = 0.8;
export const SHADOW_HEIGHT_RATIO = 0.5;
/** Shadow opacity. */
export const SHADOW_ALPHA = 0.3;
/** Nudges the shadow up from the object's exact display-bounds base, in design px. */
export const SHADOW_BASE_RAISE = 8;
