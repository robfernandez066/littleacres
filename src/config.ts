/** Portrait mobile design resolution. All layout is authored against this. */
export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;

/**
 * The WORLD rect: the pannable/zoomable farm world. Born (T3.3a-r2) around the
 * legacy 1080x1920 design rect - which stays exactly where it is (no existing
 * coordinate changes) - with a 180px grass apron east/west and a 320px apron
 * north/south. The default (home) camera view is still the legacy design rect
 * at zoom 1; pinch/pan reaches the apron. The world's west strip is reserved
 * for the mere (see PLOT_PLACEABLE_MIN_X in data/farm.ts).
 *
 * T3.3b (regions): the world grows EAST for the first purchasable region (the
 * "East Meadow" band). WORLD_MIN_X stays -180; WORLD_WIDTH 1440 -> 1952 moves
 * the east edge 1260 -> 1772, so the locked band and its region sign are
 * pannable/visible before purchase. The camera zoom-out floor is fitZoom(world)
 * and DROPS with the wider world (0.75 -> 1080/1952 ~= 0.553; it derives, never
 * re-hardcoded); the ground TileSprite covers the grown rect because it derives
 * from these constants (see FarmScene.createGroundTexture). REGIONS'
 * placeableRect (data/farm.ts) is measured off this east edge.
 */
export const WORLD_MIN_X = -180;
export const WORLD_MIN_Y = -320;
export const WORLD_WIDTH = 1952;
export const WORLD_HEIGHT = 2560;

/** Texture key of the single texture atlas loaded in Preload. */
export const ATLAS_KEY = 'atlas';

/**
 * Loader/texture keys for the standalone ground textures (not atlas frames)
 * - see ASSETS.md "Ground textures (standalone, not atlas frames)".
 * `grass_texture_a` is the LIVE meadow ground since T3.3s-r2b (a 512x512
 * seamless full-bleed master in the new art style; the pack pipeline
 * verified it passes through untrimmed). `grass_texture_b` retired from the
 * render path in the same task - its staged file and key remain, unused.
 */
export const GROUND_TEXTURE_A_KEY = 'grass_texture_a';
export const GROUND_TEXTURE_B_KEY = 'grass_texture_b';

/**
 * Ground rendering mode (T2.28 experiment; meadow promoted in T3.3s-r2b):
 * 'texture_a' - the DEFAULT - tiles the seamless meadow texture across the
 * ENTIRE world rect; 'tiles'/'tiles_flat' draw the old two-tone diamond
 * grass grid ('tiles_flat' being the T2.28a seam-reduced variant that was
 * the default of the previous art era) and stay reachable through the
 * dev-overlay cycle button for comparison only. 'texture_b' left the render
 * path entirely (T3.3s-r2b). This constant only controls the BOOT default.
 */
export type GroundMode = 'tiles' | 'tiles_flat' | 'texture_a';
// 'texture_a' (seamless meadow, new art era) promoted to default in
// T3.3s-r2b - the diamond grass tiles clashed with the regenerated art.
export const GROUND_MODE: GroundMode = 'texture_a';

/**
 * TileSprite tileScale for the meadow ground texture: 1.0 = one repeat per
 * 512 design px (the master's native size). Verified crisp and seam-free
 * across the full zoom range (0.75 fit-world to 1.6 max pinch) in
 * T3.3s-r2b; no visible repeat rhythm at 0.75.
 */
export const GROUND_TEXTURE_A_TILE_SCALE = 1.0;

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
 * render position (anchor (5,3) + STRUCTURE_RENDER_OFFSETS.noticeBoard);
 * live positions derive from state.structures. This is NOT a frozen
 * historical value: the 2026-07-17 Art Studio ruling nudged the board art
 * (render offset (104,30) -> (116,-11), re-centering the art onto one tile),
 * so this canonical default-anchor position moved with it (the T2.22a
 * MEASURED clearances above describe the pre-nudge position; the footprint
 * was reduced to a single tile by the same ruling). Its derivation is pinned
 * by test.
 *
 * T3.27: structures are BASE-anchored now, so this is the board's GROUND
 * point (the foot of its posts), not its sprite centre. The art did not
 * move - the value rose by half the board's display height (240/2 = 120,
 * y 1269 -> 1389) purely because it now names a different point on the same
 * sprite. See STRUCTURE_RENDER_OFFSETS.
 */
export const NOTICE_BOARD_POSITION = { x: 912, y: 1389 } as const;

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
 * render position (anchor (-1,-3) + STRUCTURE_RENDER_OFFSETS.farmhouse);
 * live positions derive from state.structures. This is NOT a frozen
 * historical value: the 2026-07-17 Art Studio ruling nudged the farmhouse
 * art (render offset (84,8) -> (137,9)), so this canonical default-anchor
 * position moved with it (the T2.22a MEASURED clearances above describe the
 * pre-nudge position). Its derivation is pinned by test.
 *
 * T3.27: structures are BASE-anchored now, so this is the farmhouse's GROUND
 * point (where the building meets the ground), not its sprite centre. The art
 * did not move - the value rose by half the farmhouse's display height
 * (420/2 = 210, y 521 -> 731) purely because it now names a different point
 * on the same sprite. See STRUCTURE_RENDER_OFFSETS.
 */
export const FARMHOUSE_POSITION = { x: 933, y: 731 } as const;

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
 *   historical blocked-tile set, so the default render position reproduces
 *   the pre-v18 hardcoded value EXACTLY (pinned by test).
 * - STRUCTURE_FOOTPRINT_OFFSETS: each structure's blocked tiles RELATIVE to
 *   its anchor. The farmhouse's is DESIGN-CHOSEN (Art Studio owner ruling
 *   2026-07-17, tuned visually against the live game): an Art-Studio-tuned
 *   2x2 block (4 tiles) at offsets (1,0),(2,0),(1,1),(2,1) - this supersedes
 *   the T3.3s-r2c symmetric 3x3, which in turn superseded the T3.3s-r2
 *   measured-opaque-bounds staircase; the owner refines footprints via Art
 *   Studio change requests from here. NOTE the anchor tile (offset (0,0)) is
 *   deliberately NOT part of the farmhouse footprint - the anchor is a pure
 *   reference point (it positions the art and the footprint but is itself
 *   placeable). The notice board is ALSO DESIGN-CHOSEN (owner hand-edit,
 *   approved by visual check, T3.3b-r1): the 5-tile diamond at offsets
 *   (1,0),(1,-1),(1,1),(2,0),(0,0), covering the board's art base. This
 *   supersedes the 2026-07-17 single-tile footprint at offset (1,0), which was
 *   smaller than the art - plots on the tiles the art covered tucked under/over
 *   the board in the iso depth interleave (the live bug T3.3b-r1 fixes); which
 *   in turn superseded the old 4-tile measured set (opaque rect x [823, 978],
 *   y [1190, 1430] - no longer used). NOTE the board's set INCLUDES its anchor
 *   tile (offset (0,0)) - a DELIBERATE reversal of the farmhouse's
 *   anchor-as-pure-reference convention, for the board only: the anchor tile
 *   sits under the board art, so it must block like any other footprint tile.
 * - STRUCTURE_RENDER_OFFSETS: pixel delta from the anchor tile's CENTER to
 *   the structure's GROUND point - where the building's base meets the
 *   ground. T3.27 re-anchored structures by that base (the sprite's origin is
 *   its base row, not its centre), so this offset now names a point ON the
 *   footprint instead of a point floating mid-building. At the default
 *   anchors:
 *   farmhouse: gridToIso(-1,-3) = (796, 512), +(137, 219) = FARMHOUSE_POSITION;
 *   noticeBoard: gridToIso(5,3) = (796, 1280), +(116, 109) = NOTICE_BOARD_POSITION.
 *
 *   Each y grew by exactly half that structure's display height over its
 *   pre-T3.27 value (farmhouse 9 + 420/2 = 219; board -11 + 240/2 = 109),
 *   which is the centre-to-base distance - so the ART IS PIXEL-IDENTICAL to
 *   where the 2026-07-17 Art Studio ruling put it; only the point these
 *   numbers name changed. Both ground points land inside a footprint tile of
 *   their structure (farmhouse (933,731) is inside its 2x2 block, whose
 *   diamond spans y 512..768; board (912,1389) is inside tile (6,3), which
 *   spans y 1280..1408), which is what "the base sits on the footprint"
 *   means numerically.
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
    { col: 1, row: 0 },
    { col: 2, row: 0 },
    { col: 1, row: 1 },
    { col: 2, row: 1 },
  ],
  noticeBoard: [
    { col: 1, row: 0 },
    { col: 1, row: -1 },
    { col: 1, row: 1 },
    { col: 2, row: 0 },
    { col: 0, row: 0 },
  ],
};

export const STRUCTURE_RENDER_OFFSETS: Record<StructureId, { x: number; y: number }> = {
  farmhouse: { x: 137, y: 219 },
  noticeBoard: { x: 116, y: 109 },
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
 * Directional cast shadows (T3.3s-r2d, superseding the T3.3s-r2c runtime
 * mirror silhouettes - owner picked this from PM mocks): light comes from
 * a fixed sun at TOP-RIGHT; every shadowed object (the farmhouse, the
 * notice board, the expand sign, every decoration) renders its pack-time
 * `<frame>_shadow` companion (tools/pack-atlas.mjs generateCastShadow -
 * squashed, sheared lower-left, blurred, alpha-baked black), positioned so
 * the shadow's un-sheared base edge sits under the object's base and the
 * shadow emerges from beneath the sprite. Crops, plot tiles, and dressing
 * decals stay shadowless, as always.
 * - SHADOW_TUCK_RATIO: the fraction of the shadow's height it is tucked
 *   upward under the sprite (the sprite draws over the overlap, so the
 *   shadow reads as attached, never a detached patch).
 * - SHADOW_CANVAS_PAD: the transparent padding the packer adds around the
 *   shadow canvas before blurring - MUST MATCH tools/pack-atlas.mjs
 *   SHADOW_BLUR_PAD. The runtime's x-alignment constant: together with the
 *   object frame's own width it locates the un-sheared base edge inside
 *   the shadow's (trim-metadata-restored) canvas.
 */
export const SHADOW_TUCK_RATIO = 0.28;
export const SHADOW_CANVAS_PAD = 12;
/**
 * Authored-shadow overrides (T3.28): explicit runtime placement for an authored
 * `<frame>_shadow` whose companion PNG was hand-authored (tools/shadow-overrides)
 * rather than generated. Values are EXACT integer logical-canvas pixels, kept in
 * lockstep with tools/shadow-overrides/farmhouse_shadow.json so the registration
 * stays inspectable (not normalized). `anchor` is the conceptual 256x256 farmhouse
 * frame's bottom-center, in logical-canvas pixels; it maps to farmhouseImage.x/y.
 * tuckRatio is 0: the authored shadow carries its own contact geometry, so the
 * generic SHADOW_TUCK_RATIO / SHADOW_CANVAS_PAD math must not touch it.
 */
export interface ShadowPlacementOverride {
  logicalWidth: number;
  logicalHeight: number;
  anchorX: number;
  anchorY: number;
  tuckRatio: number;
}

export const SHADOW_PLACEMENT_OVERRIDES: Readonly<Record<string, ShadowPlacementOverride>> = {
  farmhouse_shadow: {
    logicalWidth: 412,
    logicalHeight: 385,
    anchorX: 259,
    anchorY: 280,
    tuckRatio: 0,
  },
};