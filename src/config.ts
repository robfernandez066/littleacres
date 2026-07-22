/** Portrait mobile design resolution. All layout is authored against this. */
export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;

/**
 * The WORLD rect: the pannable/zoomable farm world. Born (T3.3a-r2) around the
 * legacy 1080x1920 design rect - which stays exactly where it is (no existing
 * coordinate changes) - with a 180px grass apron east/west and a 320px apron
 * north/south. The default (home) camera view is still the legacy design rect
 * at zoom 1; pinch/pan reaches the apron.
 *
 * T3.3b (regions): the world grows EAST for the first purchasable region (the
 * "East Meadow" band). WORLD_WIDTH 1440 -> 1952 moved the east edge
 * 1260 -> 1772, so the locked band and its region sign are pannable/visible
 * before purchase.
 *
 * T4.10 (default area grows WEST): the STARTER placeable rect gains 2 columns
 * west (PLOT_PLACEABLE_MIN_X 20 -> -236, data/farm.ts), so the world's west
 * edge moves with it: WORLD_MIN_X -180 -> -256, keeping the standard 20px
 * edge margin west of the new plots. WORLD_WIDTH 1952 -> 2028 so the EAST edge
 * is unchanged at -256 + 2028 = 1772 (East Meadow untouched). The west apron
 * absorbed the former "mere reserve" strip - that reserve was comment-only
 * (no art, no code) and no longer exists.
 *
 * The camera zoom-out floor is fitZoom(world) and DROPS with the wider world
 * (0.75 -> 1080/2028 ~= 0.5325; it derives, never re-hardcoded); the ground
 * TileSprite covers the grown rect because it derives from these constants
 * (see FarmScene.createGroundTexture). REGIONS' placeableRect (data/farm.ts)
 * is measured off this east edge.
 */
export const WORLD_MIN_X = -256;
export const WORLD_MIN_Y = -320;
export const WORLD_WIDTH = 2028;
export const WORLD_HEIGHT = 2560;

/** Texture key of the single texture atlas loaded in Preload. */
export const ATLAS_KEY = 'atlas';

/**
 * Loader/texture keys for the standalone ground textures (not atlas frames)
 * - see docs/ASSETS.md "Ground textures (standalone, not atlas frames)".
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
 * Tile frame geometry (see docs/ASSETS.md and tools/pack-atlas.mjs). The tile art
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
 * Screen position of the HUD goals icon (design space, T3.30): the banner row
 * again (same y as the bag and scroll), continuing the run rightward past the
 * bag. x=955 is bounded on both sides: at BUTTON_ICON_DISPLAY_SIZE (90) the
 * icon spans x 910..1000, leaving a 31px margin from the bag's right edge
 * (834 + 45 = 879) and a 20px margin before the banner's right vine curl
 * (the nineslice's right slice starts at 1080 - BANNER_SLICE_WIDTH = 1020).
 * The gear hangs BELOW the banner (y 166..238) so it never collides with this
 * row (y 41..131) despite the overlapping x range.
 */
export const GOALS_ICON_POSITION = { x: 955, y: 86 } as const;

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
 * Native (unscaled) size of a packed structure/building frame - every one of
 * them comes through the packer's 256-square path (tools/pack-atlas.mjs
 * SQUARE_DOWNSCALE_SIZES), so this is the common denominator every structure
 * scale below divides by. Lived in FarmScene.ts until T4.12, which needed it
 * here to derive the farmhouse's render offset from its display height.
 */
export const STRUCTURE_FRAME_SIZE = 256;

/**
 * FARMHOUSE SIZE + BASE ANCHOR (T4.12) - THE TWO OWNER-TUNABLE KNOBS.
 *
 * Retuning the farmhouse's fit on its 2x2 footprint means editing
 * FARMHOUSE_DISPLAY_HEIGHT (how big) and/or FARMHOUSE_BASE_FRONT_CORNER_NATIVE
 * (which point on the art sits on the footprint's front corner). Everything
 * else - FARMHOUSE_SCALE, STRUCTURE_RENDER_OFFSETS.farmhouse and
 * FARMHOUSE_POSITION - derives from them, so one number moves the whole thing
 * coherently (art, hit area and cast shadow all follow the sprite).
 *
 * WHY IT CHANGED: at the previous 420 the farmhouse's base spanned only ~370
 * design px against a 512-wide footprint diamond, and its render offset put
 * the frame's bottom edge 37px ABOVE the footprint's front corner - the grass
 * gap the owner traced against the edit-mode footprint.
 *
 * MEASURED (Jimp alpha scan of the packed `farmhouse` frame, threshold 8 - the
 * same scan the constants below and in FarmScene.ts use):
 * - The base diamond's widest span is native x 14..238 (~225px) at rows
 *   214..226. 512 / 225 * 256 = 583, so a display height in the high 500s puts
 *   the base across the full footprint width; 576 is picked because it makes
 *   FARMHOUSE_SCALE exactly 2.25 and lands the base at 225 * 2.25 = 506px, a
 *   hair inside 512 rather than over it.
 *   NOTE the PM's provisional 545-560 was derived from the frame's full opaque
 *   bbox (240px wide, which includes roof/bush overhang above the base), not
 *   from the base contact - hence the higher number here. This is exactly the
 *   knob the owner eyeballs.
 * - The base's FRONT corner is where the two tapering front edges of the base
 *   diamond meet. Extrapolating them from rows 226..253 (left edge x 20 -> 82,
 *   slope 2.30; right edge x 219 -> 155, slope 2.37) they intersect at native
 *   (118, 269) - i.e. the true corner is CLIPPED ~13px off the bottom of the
 *   256 frame (the art is bottom-flush and height-limited). The 6 stray opaque
 *   px on row 255 (x 145..150) are a detail nub sitting right of that corner,
 *   NOT the corner itself, which is why the frame's bottom-most pixels are the
 *   wrong thing to anchor on.
 */
export const FARMHOUSE_DISPLAY_HEIGHT = 576;
export const FARMHOUSE_SCALE = FARMHOUSE_DISPLAY_HEIGHT / STRUCTURE_FRAME_SIZE;
export const FARMHOUSE_BASE_FRONT_CORNER_NATIVE = { x: 118, y: 269 } as const;

/**
 * The farmhouse's GROUND point in native frame px - the point
 * `structureBaseOriginY` pins to the sprite's position (frame centre-x, base
 * row). Mirrors STRUCTURE_BASE_ROW_NATIVE.farmhouse in FarmScene.ts; kept
 * here so the render offset below can measure from it.
 */
const FARMHOUSE_GROUND_POINT_NATIVE = { x: STRUCTURE_FRAME_SIZE / 2, y: 256 } as const;

/**
 * The FRONT (bottom-most) corner of the farmhouse's 2x2 footprint diamond,
 * as a pixel delta from the ANCHOR tile's centre. Derived from
 * STRUCTURE_FOOTPRINT_OFFSETS.farmhouse in the frozen iso frame (systems/iso.ts,
 * TILE_WIDTH/HEIGHT 256x128): the front-most tile is offset (2,1), whose centre
 * sits at ((2-1)*128, (2+1)*64) = (128, 192), and its own bottom vertex is a
 * further 64px down - so (128, 256). (The whole block's diamond spans x
 * -128..384, y 0..256 relative to the anchor centre: 512x256, the 2x2 ground
 * area.)
 */
const FARMHOUSE_FOOTPRINT_FRONT_CORNER = { x: 128, y: 256 } as const;

/**
 * Where the farmhouse's GROUND point lands, relative to its anchor tile's
 * centre - i.e. STRUCTURE_RENDER_OFFSETS.farmhouse, computed here so it can
 * feed FARMHOUSE_POSITION below without a temporal-dead-zone read of the table.
 *
 * Solve for the ground point that puts the art's base front corner ON the
 * footprint's front corner: the corner sits (corner - groundPoint) native px
 * from the ground point, so the ground point must sit that far back from the
 * footprint corner, in DISPLAY px:
 *   x: 128 + (128 - 118) * 2.25 = 150.5 -> 151
 *   y: 256 + (256 - 269) * 2.25 = 226.75 -> 227
 * Rounded so positions stay whole pixels. Was (137, 219) at the old 420 size.
 */
const FARMHOUSE_RENDER_OFFSET = {
  x: Math.round(
    FARMHOUSE_FOOTPRINT_FRONT_CORNER.x +
      (FARMHOUSE_GROUND_POINT_NATIVE.x - FARMHOUSE_BASE_FRONT_CORNER_NATIVE.x) * FARMHOUSE_SCALE,
  ),
  y: Math.round(
    FARMHOUSE_FOOTPRINT_FRONT_CORNER.y +
      (FARMHOUSE_GROUND_POINT_NATIVE.y - FARMHOUSE_BASE_FRONT_CORNER_NATIVE.y) * FARMHOUSE_SCALE,
  ),
} as const;

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
 *
 * T4.12: DERIVED rather than hand-written, so the owner's size/anchor retune
 * cannot leave this constant behind. gridToIso(-1,-3) = (796, 512) is inlined
 * as literals because systems/iso.ts imports THIS file (deriving it live would
 * be a cycle); those two numbers are frozen-frame values that never move.
 * (933, 731) -> (947, 739) is the size-and-anchor fit, not an art move.
 */
export const FARMHOUSE_POSITION = {
  x: 796 + FARMHOUSE_RENDER_OFFSET.x,
  y: 512 + FARMHOUSE_RENDER_OFFSET.y,
} as const;

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
 *   farmhouse: gridToIso(-1,-3) = (796, 512), +(151, 227) = FARMHOUSE_POSITION;
 *   noticeBoard: gridToIso(5,3) = (796, 1280), +(116, 109) = NOTICE_BOARD_POSITION.
 *
 *   At T3.27 each y grew by exactly half that structure's display height over
 *   its pre-T3.27 value (farmhouse 9 + 420/2 = 219; board -11 + 240/2 = 109),
 *   which is the centre-to-base distance - so the ART WAS PIXEL-IDENTICAL to
 *   where the 2026-07-17 Art Studio ruling put it; only the point those
 *   numbers named changed. T4.12 then deliberately MOVED the farmhouse's art:
 *   219 -> 227 (and 137 -> 151), fitting the base onto the footprint instead
 *   of leaving it floating high inside it - see FARMHOUSE_RENDER_OFFSET above.
 *   The board's is untouched. Both ground points land inside a footprint tile
 *   of their structure (farmhouse (947,739) is inside its 2x2 block, whose
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
  // T4.12: derived from the farmhouse size/anchor knobs above, not hand-tuned.
  farmhouse: { x: FARMHOUSE_RENDER_OFFSET.x, y: FARMHOUSE_RENDER_OFFSET.y },
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
  'grass_1',
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
 * Authored building-shadow runtime placement (T3.28, generalized T3.29).
 *
 * The table below is GENERATED from the authored-shadow manifests
 * (tools/shadow-overrides/<building>_shadow.json) by tools/gen-shadow-placements.mjs
 * and re-exported here so scene code keeps importing it from `config`. Each
 * entry's anchor is the building's ground point in logical-canvas pixels, derived
 * as sourceFrameRect + sourceGroundPoint - never hand-written here, so JSON and
 * TypeScript cannot drift. tuckRatio is per-building (0 for the farmhouse: its
 * authored shape carries its own contact, so generic SHADOW_TUCK_RATIO /
 * SHADOW_CANVAS_PAD math must not touch it). See docs/SHADOW_WORKFLOW.md.
 */
export {
  SHADOW_PLACEMENT_OVERRIDES,
  type ShadowPlacementOverride,
} from './generated/shadowPlacements';
