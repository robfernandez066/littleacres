import Phaser from 'phaser';

import ambientMp3Url from '../../assets/audio/ambient.mp3?url';
import musicAndriigMp3Url from '../../assets/audio/music_andriig.mp3?url';
import musicGeoffharveyMp3Url from '../../assets/audio/music_geoffharvey.mp3?url';
import musicMfccMp3Url from '../../assets/audio/music_mfcc.mp3?url';
import {
  ATLAS_KEY,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  type DressingPlacement,
  DRESSING,
  FARMHOUSE_DISPLAY_HEIGHT,
  FARMHOUSE_SCALE,
  GROUND_MODE,
  GROUND_TEXTURE_A_KEY,
  GROUND_TEXTURE_A_TILE_SCALE,
  type GroundMode,
  PANEL_SLICE,
  STRUCTURE_FOOTPRINT_OFFSETS,
  STRUCTURE_FRAME_SIZE,
  STRUCTURE_RENDER_OFFSETS,
  type StructureId,
  SHADOW_CANVAS_PAD,
  SHADOW_TUCK_RATIO,
  SHADOW_PLACEMENT_OVERRIDES,
  TILE_DIAMOND_CENTER_Y,
  TILE_FRAME_HEIGHT,
  WORLD_HEIGHT,
  WORLD_MIN_X,
  WORLD_MIN_Y,
  WORLD_WIDTH,
} from '../config';
import { BUILDING_IDS, BUILDINGS, type BuildingDef, type BuildingId } from '../data/buildings';
import { CROP_BASELINE_Y, CROP_FRAME_SIZE, CROPS, type CropDef, type CropId } from '../data/crops';
import { GOODS } from '../data/goods';
import {
  DECOR_ITEMS,
  decorClampBounds,
  decorSpawnScale,
  FENCE_FRAME,
  FENCE_SNAP_RADIUS,
  fenceEdgeSnapDeltas,
  fenceSnapDeltas,
  TROPHY_ITEMS,
} from '../data/decor';
import { findRegion, type RegionDef, REGIONS } from '../data/farm';
import { ONBOARDING_STEPS } from '../data/onboarding';
import { AMBIENT_KEY, MUSIC_TRACKS } from '../data/audio';
import { isOrderCoverable } from '../data/orders';
import { PATH_TIERS, type PathTierId } from '../data/paths';
import {
  FARMHOUSE_FRAME,
  FARMHOUSE_RESTORED_FRAME,
  FARMHOUSE_SHADOW_FRAME,
} from '../data/restoration';
import { placeAuthoredShadow } from '../systems/authoredShadowPlacement';
import { AudioManager } from '../systems/audio';
import {
  clampScroll,
  clampZoom,
  fitZoom,
  pinchZoom,
  rubberBand,
  scrollForAnchor,
  scrollRange,
  type Viewport,
  type WorldBounds,
} from '../systems/cameraMath';
import {
  registerCameraControl,
  registerCameraStateProbe,
  registerCoinArcTest,
  registerDressingEditorHooks,
  registerFarmhouseTransformHooks,
  registerFootprintsToggle,
  registerGroundModeCycle,
  registerHitboxToggle,
  registerSceneLayersProbe,
} from '../systems/dev';
import {
  bestBatchStartTile,
  buildingFootprintTiles,
  buildingRenderPosition,
  gameState,
  isBuildingAnchorFree,
  isPlotTileFree,
  isStructureAnchorFree,
  millSlots,
  nextChainPlotTile,
  placeablePlotTiles,
  structureFootprintTiles,
  structureRenderPosition,
  type DecorationPlacement,
  type GameStateData,
  type PathTile,
  type PlotState,
} from '../systems/gameState';
import { isReady, stageIndex } from '../systems/growth';
import { buzz } from '../systems/haptics';
import { type GridCell, gridCellLine } from '../systems/gridLine';
import { gridToIso, isoToGrid, TILE_HEIGHT, TILE_WIDTH } from '../systems/iso';
import { isModalOpen, setPanelOpen } from '../systems/modalPanels';
import { plotIndexAtScreen, PlotPointerTracker } from '../systems/plotPointer';
import { registerPulseTarget, type PulseTarget } from '../systems/pulseTargets';
import { now } from '../systems/time';
import { ChestCeremony } from '../ui/ChestCeremony';
import { CoinArc } from '../ui/CoinArc';
import { cropToInfoDef, CropInfoCard } from '../ui/CropInfoCard';
import { ExpandSign } from '../ui/ExpandSign';
import { FloatingText, type FloatingTextOptions } from '../ui/FloatingText';
import { GoalsPanel } from '../ui/GoalsPanel';
import { RegionSign } from '../ui/RegionSign';
import { Hud } from '../ui/Hud';
import { MillPanel } from '../ui/MillPanel';
import { LevelUpCelebration } from '../ui/LevelUpCelebration';
import { MoondustArc } from '../ui/MoondustArc';
import { OfflineSummaryPanel } from '../ui/OfflineSummaryPanel';
import { OnboardingGuide } from '../ui/OnboardingGuide';
import { CropCountdown } from '../ui/CropCountdown';
import { ParticleBurst } from '../ui/ParticleBurst';
import { PlotGrantPopup } from '../ui/PlotGrantPopup';
import { QuestBoard } from '../ui/QuestBoard';
import { ReplantChip, type ReplantEntry } from '../ui/ReplantChip';
import { RestorePanel } from '../ui/RestorePanel';
import { SeedBar } from '../ui/SeedBar';
import { WeeklyNoticePanel } from '../ui/WeeklyNoticePanel';

/** Slightly darker than the grass tiles so the field reads as raised ground. */
const BACKGROUND_COLOR = 0x55913f;

/**
 * Loader key -> fingerprinted URL for the background-loaded playlist tracks
 * (T3.21) - kept out of Preload so the ~15.8MB of music/ambient never blocks
 * first paint; queued on this scene's own loader in `create`. Keys line up
 * with MUSIC_TRACKS entries.
 */
const MUSIC_ASSET_URLS: Record<string, string> = {
  music_andriig: musicAndriigMp3Url,
  music_geoffharvey: musicGeoffharveyMp3Url,
  music_mfcc: musicMfccMp3Url,
};

/** The four background-loaded audio files: the playlist tracks plus the ambient bed. */
const BACKGROUND_AUDIO_ASSETS: { key: string; url: string }[] = [
  ...MUSIC_TRACKS.map((track) => ({ key: track.key, url: MUSIC_ASSET_URLS[track.key]! })),
  { key: AMBIENT_KEY, url: ambientMp3Url },
];

/**
 * Tile sprite origin: x centered, y at the diamond top face's center - the
 * frame is taller than the 2:1 diamond because the art's lip/fringe hangs
 * below it. Positioning stays "tile center at gridToIso(col, row)", so the
 * grid math and hit-testing are untouched by the taller frame.
 */
const TILE_ORIGIN_Y = TILE_DIAMOND_CENTER_Y / TILE_FRAME_HEIGHT;

/**
 * Vertical range (in design pixels) covered by the ground layer: the FULL
 * WORLD rect (T3.3a-r2 - zoomed out at 0.75 there must be grass to every
 * edge, no void). Historically a 420..1500 band (headroom for HUD/seed bar),
 * then the full screen; the band edges read as visible seams against any
 * ground whose green differs from BACKGROUND_COLOR - the HUD and seed bar
 * draw over the ground anyway (user report + PM-direct fix, 2026-07-12).
 */
const FIELD_MIN_Y = WORLD_MIN_Y;
const FIELD_MAX_Y = WORLD_MIN_Y + WORLD_HEIGHT;

/**
 * Grid range scanned when laying grass; wide enough to fill the world rect.
 * Derivation: tile centers sit at (540 + (col-row)*128, 768 + (col+row)*64);
 * covering the world rect's x [-256-128, 1772+128] (T3.3b grew the east edge
 * to 1772, T4.10 the west edge to -256) and y [-320, 2240] needs col-row in
 * [-8, 11] and col+row in [-17, 23]; col/row in [-11, 14] still encloses all
 * of that with room to spare.
 */
const GRASS_GRID_MIN = -11;
const GRASS_GRID_MAX = 14;

/**
 * Depth of the WHOLE ground layer - the texture TileSprite AND the grass
 * tile images alike: below every y-depth-sorted world object and above the
 * background rect (GROUND_LAYER_DEPTH - 1). Grass tiles need this explicitly
 * because the dev ground-mode cycle rebuilds them AFTER the plots exist - at
 * a shared default depth, later insertion drew grass over the plots (user
 * report + PM-direct fix, 2026-07-12). Was WORLD_MIN_Y - 2 while plot tiles
 * carried y-derived depths; T3.3b-r3 moved plots to the PLOT_TILE_DEPTH
 * sub-layer band (~-1000), and the whole ground stack (this layer plus its +1/+2/+3
 * overlays) dropped to -2000 so the plot sub-layer floats in clear air:
 * ~1000 depth units above the overlay band and ~700 below the lowest
 * possible standing-object depth, instead of a razor-thin coupling.
 */
const GROUND_LAYER_DEPTH = -2000;

/** How often (ms of real time) growth visuals re-derive from state/clock. */
const CROP_REFRESH_INTERVAL_MS = 250;

/** Tint applied to a ready-to-harvest crop, on top of its normal frame. */
const READY_TINT = 0xfff59d;

/** Harvest pop: quick scale-up + fade-out on the reaped sprite. */
const HARVEST_POP_SCALE = 1.25;
const HARVEST_POP_DURATION_MS = 150;

/** Light haptic pulse on a successful harvest or plant. */
const HAPTIC_LIGHT_MS = 12;
/** Medium haptic pulse on a successful farm expansion. */
const HAPTIC_MEDIUM_MS = 25;

/**
 * Plot-tile hit area for arrange mode (T3.3a): the tile diamond itself, in
 * FRAME-relative units per the hit-area rule (0,0 at the frame's own
 * top-left) - the diamond IS the visible art's opaque footprint, so a
 * polygon beats any rectangle here (the frame's corners are transparent and
 * a rectangle would steal taps from diagonal neighbors). The frame is
 * TILE_WIDTH wide with the diamond's center at TILE_DIAMOND_CENTER_Y; the
 * lip below the diamond is deliberately excluded - it overlaps the tile in
 * front. No pad: adjacent diamonds tessellate edge-to-edge, so any pad
 * would overlap neighbors.
 */
const PLOT_TILE_HIT_AREA = new Phaser.Geom.Polygon([
  new Phaser.Geom.Point(TILE_WIDTH / 2, TILE_DIAMOND_CENTER_Y - TILE_HEIGHT / 2),
  new Phaser.Geom.Point(TILE_WIDTH, TILE_DIAMOND_CENTER_Y),
  new Phaser.Geom.Point(TILE_WIDTH / 2, TILE_DIAMOND_CENTER_Y + TILE_HEIGHT / 2),
  new Phaser.Geom.Point(0, TILE_DIAMOND_CENTER_Y),
]);

/** Locked-plot refusal shake (T3.3a): a growing crop's plot does not lift. */
const PLOT_LOCKED_SHAKE_DISTANCE = 8;
const PLOT_LOCKED_SHAKE_STEP_MS = 40;

/** Where the floating xp label spawns relative to a plot's tile center. */
const XP_LABEL_OFFSET_Y = -70;
/** Where bursts spawn relative to a plot's tile center (at the plant, not the dirt). */
const BURST_OFFSET_Y = -30;

/** Pre-built "+N xp" labels and a shared options object - the harvest path
 * allocates no strings or option objects in steady state. */
const XP_LABELS = Object.fromEntries(
  Object.values(CROPS).map((crop) => [crop.id, `+${crop.xp} xp`]),
) as Record<CropId, string>;
const XP_TEXT_OPTIONS: FloatingTextOptions = { color: '#fff3c4', fontSize: 44 };

/**
 * Plant cost float (T3.13): a "-<seedCost>" floating label at the planted
 * plot, so spending coins on a seed is as visible as earning them from a
 * harvest. Color/size match the sell float's own "+N" tint (Hud.sellCrop) so
 * the pair reads as the same coin-cost/coin-gain visual language, just
 * negative. Reuses XP_LABEL_OFFSET_Y so it appears at the same height the
 * harvest xp label does.
 */
const PLANT_COST_TEXT_OPTIONS: FloatingTextOptions = { color: '#ffe27a', fontSize: 40 };

/**
 * Radiant harvest juice: large gold floating text well above the xp-label
 * layer (-70), so it reads even mid-sweep with "+N xp" labels firing all
 * around it.
 */
const RADIANT_LABEL = 'Radiant! x5';
const RADIANT_TEXT_OPTIONS: FloatingTextOptions = { color: '#ffd700', fontSize: 68 };
/** Where the Radiant label spawns relative to a plot's tile center. */
const RADIANT_LABEL_OFFSET_Y = -140;
/** Delay before a Radiant proc's second sparkle burst, for a two-stage pop. */
const RADIANT_SECOND_BURST_DELAY_MS = 150;

/**
 * Restoration purchase celebration (T3.25) - the Radiant flourish's shape
 * (two-stage sparkle burst + a gold label), reused over the farmhouse rather
 * than a plot, so the one-time upgrade lands with a beat of its own without
 * any new art or pools.
 */
const RESTORATION_LABEL = 'Restored!';
const RESTORATION_TEXT_OPTIONS: FloatingTextOptions = { color: '#ffd700', fontSize: 72 };
const RESTORATION_SECOND_BURST_DELAY_MS = 180;

/**
 * Notice board + farmhouse (T2.22): both structures share the same packed
 * frame convention (square, 256x256 - see tools/pack-atlas.mjs), displayed
 * with uniform scale (so the square frame stays square, never distorted),
 * and depth-sorted by their own y like a crop sprite - see `createNoticeBoard`
 * and `createFarmhouse`. T2.22a grew the farmhouse to its own, taller display
 * height (FARMHOUSE_DISPLAY_HEIGHT) when it swapped spots with the notice
 * board, which kept the original shared 240 - so the "shared" constant was
 * board-only in practice, and T3.3s-r2 renamed it NOTICE_BOARD_DISPLAY_HEIGHT
 * (a brief 216 experiment in that task was reversed by the owner in
 * T3.3s-r2b - the rename stays, the size is back to 240). Badge and hit-pad
 * math derive from NOTICE_BOARD_SCALE, so they follow the size automatically.
 *
 * T4.12 moved STRUCTURE_FRAME_SIZE and the farmhouse's own size constants into
 * config.ts (imported above): the farmhouse's render offset is derived from its
 * display height now, and that offset lives in config.ts, so the height had to
 * live where it could be read from.
 */
const NOTICE_BOARD_DISPLAY_HEIGHT = 240;
const NOTICE_BOARD_SCALE = NOTICE_BOARD_DISPLAY_HEIGHT / STRUCTURE_FRAME_SIZE;

/**
 * The BASE row of each structure's building, in native frame px measured down
 * from the frame's top (T3.27) - the row where the building meets the ground,
 * which is what `structureBaseOriginY` turns into the sprite's origin so the
 * building stands on its ground point instead of hovering around its centre.
 *
 * MEASURED (Jimp alpha scan of the packed atlas, threshold 8, same scan
 * tools/pack-atlas.mjs uses): in `farmhouse` the lowest opaque row is y=255
 * (the front corner of the base, x 145..150) and in `notice_board` it is y=255
 * (the foot of the posts, x 163..183) - both frames are bottom-flush because
 * the packer scales each art to fit its 256 square and both are height-limited
 * (farmhouse opaque bbox 240x256, board 165x256). So the base EDGE - the row
 * just below the last opaque one - sits at 256 in both, i.e. the frame's own
 * bottom edge.
 *
 * This is deliberately the bottom edge of the NOMINAL 256 band rather than a
 * hardcoded "use the frame bottom": `structureBaseOriginY` adds the restored
 * farmhouse's extra height on top (see there), and an art revision that stops
 * being bottom-flush only needs this number re-measured, not the origin logic
 * rewritten.
 */
const STRUCTURE_BASE_ROW_NATIVE: Record<StructureId, number> = {
  farmhouse: 256,
  noticeBoard: 256,
};

/**
 * Buildings (T4.1) render as structure-class sprites: the packer sizes
 * `flour_mill` through the identical 256-square path `farmhouse` takes
 * (tools/pack-atlas.mjs SQUARE_DOWNSCALE_SIZES), so the same frame size, base
 * row and shadow machinery apply unchanged.
 *
 * MEASURED (Jimp alpha scan of the packed atlas, threshold 8 - the same scan
 * the structure constants above were measured with): `flour_mill`'s opaque
 * bbox is x 33..222, y 0..255, i.e. the frame is bottom-flush exactly like
 * `farmhouse` (240x256) and `notice_board` (165x256), so its base EDGE - the
 * row just below the last opaque one - sits at 256, the frame's own bottom.
 *
 * BUILDING_DISPLAY_HEIGHT is PROVISIONAL and STILL FLAGGED FOR AN OWNER
 * EYEBALL. It was written as `= FARMHOUSE_DISPLAY_HEIGHT` because the mill
 * shares the farmhouse's 2x2 footprint and comes through the same pipeline at
 * the same staged 512x512, so "as big as the farmhouse" was the honest
 * baseline. T4.12 DECOUPLED it - literal 420, the exact value it had - because
 * that task refit the FARMHOUSE alone onto the 2x2 and must not silently
 * resize the mill and bakery with it. The mill/bakery almost certainly have
 * the SAME too-small-for-footprint gap the farmhouse had (same footprint, same
 * pipeline, still at 420); that is a separate owner-eyeball task, and this
 * constant plus BUILDING_BASE_ROW_NATIVE are where it would be fixed.
 */
const BUILDING_BASE_ROW_NATIVE = 256;
const BUILDING_DISPLAY_HEIGHT = 420;
const BUILDING_SCALE = BUILDING_DISPLAY_HEIGHT / STRUCTURE_FRAME_SIZE;
/** Hit-area pad around a building's frame, in DISPLAY px - the notice board's
 *  convention (its own frame-relative rect + pad), same generous grab target. */
const BUILDING_HIT_PAD_DISPLAY_PX = 24;

/**
 * WHICH movable, anchor-based object a lift/selection is about (T4.1). Before
 * buildings existed this was just a `StructureId`; a building is anchored,
 * footprinted and dragged by the exact same machinery but lives in an
 * indexed collection, so every path that used to take an id now takes this.
 *
 * `index` is an index into `state.buildings`, NOT a sprite reference - safe
 * because nothing removes a building (no "store a building" path exists), so
 * indices are stable for a session. If buildings ever become removable this
 * must become the reference-not-index pattern `decorationSprites` uses, for
 * exactly the reason documented on `pendingLift`.
 */
type MovableAnchorRef =
  { kind: 'structure'; id: StructureId } | { kind: 'building'; index: number };

const FARMHOUSE_REF: MovableAnchorRef = { kind: 'structure', id: 'farmhouse' };
const NOTICE_BOARD_REF: MovableAnchorRef = { kind: 'structure', id: 'noticeBoard' };

/**
 * Whether a movable may be mirrored by the arrange-mode Flip button (T4.8):
 * every BUILDING, plus the farmhouse. The notice board is the sole exclusion -
 * it is a sign, so mirroring it would mirror its text (owner's call). Shadows
 * do not flip either way, an accepted imperfection.
 */
function isFlippableMovable(ref: MovableAnchorRef): boolean {
  return ref.kind === 'building' || ref.id === 'farmhouse';
}

/** Whether two movable refs point at the same object. */
function sameMovableRef(a: MovableAnchorRef | null, b: MovableAnchorRef | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'structure' && b.kind === 'structure') return a.id === b.id;
  if (a.kind === 'building' && b.kind === 'building') return a.index === b.index;
  return false;
}

/**
 * Expand-sign ground shadow geometry (T3.art-2). The sign draws itself from
 * its own PRIVATE constants in ui/ExpandSign.ts - position (540, 1300),
 * 240px display size on a square frame, center origin - at depth 1900 (the
 * floating-text tier, so its planks read above crops). Its shadow therefore
 * cannot take the usual object.depth-1 (1899 would cover crops and decor):
 * it grounds at the sign's position y - 1 instead, matching the y-1
 * convention every decor shadow already uses, so anything standing in front
 * still covers it. MUST MATCH ExpandSign.ts's SIGN_X / SIGN_Y /
 * SIGN_DISPLAY_HEIGHT if the sign ever moves or rescales.
 */
const EXPAND_SIGN_X = 540;
const EXPAND_SIGN_Y = 1300;
const EXPAND_SIGN_DISPLAY_SIZE = 240;
/** The packed 'sign' frame's square size - MUST MATCH tools/pack-atlas.mjs
 *  SIGN_SIZE; the silhouette shadow needs it to reproduce the sign's scale. */
const EXPAND_SIGN_FRAME_SIZE = 192;

/**
 * The expand sign's blocked hidden-grid tiles, for the T3.3s-r2 overlays
 * (live footprint preview + dev.footprints()). MUST MATCH gameState.ts's
 * private EXPAND_SIGN_BLOCKED_TILES (the placement authority) - mirrored
 * here like the EXPAND_SIGN_* geometry above, since the store keeps its set
 * private and this file only reads it for overlay rendering.
 */
const EXPAND_SIGN_BLOCKED_TILES: readonly { col: number; row: number }[] = [
  { col: 3, row: 3 },
  { col: 4, row: 3 },
  { col: 3, row: 4 },
  { col: 4, row: 4 },
  { col: 5, row: 4 },
  { col: 4, row: 5 },
  { col: 5, row: 5 },
];

/**
 * Decor Shop (T3.9): opened by tapping the farmhouse, which becomes
 * interactive for the first time - hit area mirrors the notice board's
 * exactly (see NOTICE_BOARD_HIT_PAD_DISPLAY_PX below), just under its own
 * name. Rails still block taps while inert; the tutorial's pulse highlight
 * is the only visual treatment (the T3.12 dim was removed - PM decision).
 */
const FARMHOUSE_HIT_PAD_DISPLAY_PX = 20;

/**
 * Arrange mode (T3.9a; reworked in U3b to a single bottom bar + a contextual
 * toolbar): in-canvas Phaser objects only (phone-first, no DOM). While
 * arranging, the seed bar hides entirely (`SeedBar.setVisible`) and ONE bottom
 * bar takes over its band (~y 1650-1750): [Shed] [Shop] [Undo] [Done], with
 * Done the single prominent confirm (wider). The bar keeps the legacy row's
 * exact Y (preserving its ~10px clearance to the Shed/Shop panel's bottom edge,
 * see SHED_PANEL_CENTER_Y). The persistent per-item action row (resize / flip /
 * put away) is gone: flip and put away now live in a CONTEXTUAL toolbar that
 * floats above the selected asset (see the CTX_* block), and the resize +/-
 * controls were removed outright (placed decor keeps its saved scale forever).
 * The bar renders above every other UI tier (seed bar 2000, panels 2100) so
 * nothing can render over it while arranging. Each button is a `panel`
 * nineslice sized directly to its display bounds, so its default interactive
 * hit area already matches that rectangle one-to-one - no custom hitArea
 * needed. Positions are computed once below (`arrangeRowCenterXs`) so the bar
 * stays centered if a width changes.
 */
const ARRANGE_UI_DEPTH = 2200;
const ARRANGE_ROW_HEIGHT = 100;
const ARRANGE_ROW_GAP = 24;
const ARRANGE_ROW_VGAP = 16;
const ARRANGE_ROW2_Y = 1700;
const ARRANGE_ROW1_Y = ARRANGE_ROW2_Y - ARRANGE_ROW_HEIGHT - ARRANGE_ROW_VGAP;

const ARRANGE_SHED_WIDTH = 175;
const ARRANGE_SHOP_WIDTH = 175;
const ARRANGE_UNDO_WIDTH = 175;
const ARRANGE_CANCEL_WIDTH = 175;
/** Save is the single prominent confirm - wider than its neighbours (U3b/r1). */
const ARRANGE_SAVE_WIDTH = 220;

/**
 * Cancel (U3b-r1): a two-tap confirm - the first tap ARMS it (label swaps to
 * the armed copy), a second tap within this window fires the full session
 * unwind, and any other input disarms. Real timestamps (time-from-timestamps
 * rule), never frame deltas.
 */
const ARRANGE_CANCEL_ARM_MS = 3000;
const ARRANGE_CANCEL_LABEL = 'Cancel';
const ARRANGE_CANCEL_ARMED_LABEL = 'Confirm?';

/**
 * Chain placement (T3.3a-r): the "Place Next xN" button lives on its own,
 * centered row directly ABOVE the bottom bar, keeping the bar untouched - it
 * only exists during a placement session, so a transient tier reads as
 * "session control", not a mode action. Same panel-nineslice convention.
 */
const ARRANGE_PLACE_NEXT_WIDTH = 300;
const ARRANGE_PLACE_NEXT_X = DESIGN_WIDTH / 2;
const ARRANGE_PLACE_NEXT_Y = ARRANGE_ROW1_Y;

/**
 * Decor chain spawns offset a little down-right of the last-placed item
 * (free-form, clamped by the store) so each chained item lands visibly
 * beside its predecessor instead of stacking on it.
 */
const DECOR_CHAIN_OFFSET_X = 70;
const DECOR_CHAIN_OFFSET_Y = 35;

/** Centers `widths` as a single row, evenly gapped by ARRANGE_ROW_GAP, on the design width. */
function arrangeRowCenterXs(widths: number[]): number[] {
  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) + ARRANGE_ROW_GAP * (widths.length - 1);
  let x = DESIGN_WIDTH / 2 - totalWidth / 2;
  return widths.map((width) => {
    const center = x + width / 2;
    x += width + ARRANGE_ROW_GAP;
    return center;
  });
}

const [ARRANGE_SHED_X, ARRANGE_SHOP_X, ARRANGE_UNDO_X, ARRANGE_CANCEL_X, ARRANGE_SAVE_X] =
  arrangeRowCenterXs([
    ARRANGE_SHED_WIDTH,
    ARRANGE_SHOP_WIDTH,
    ARRANGE_UNDO_WIDTH,
    ARRANGE_CANCEL_WIDTH,
    ARRANGE_SAVE_WIDTH,
  ]) as [number, number, number, number, number];

const ARRANGE_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/** Enabled/dim convention shared by the Undo button and the contextual toolbar. */
const ARRANGE_STORE_ENABLED_ALPHA = 1;
const ARRANGE_STORE_DISABLED_ALPHA = 0.4;

/**
 * Shed-count badge on the bottom bar's Shed button (U3b): a small stroked
 * count pinned to the button's top-right corner, re-derived from the shed
 * total on the arrange tick. Mirrors the notice board / quest "!" badge style.
 */
const ARRANGE_SHED_BADGE_OFFSET_X = ARRANGE_SHED_WIDTH / 2 - 10;
const ARRANGE_SHED_BADGE_OFFSET_Y = -ARRANGE_ROW_HEIGHT / 2 + 6;
const ARRANGE_SHED_BADGE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  fontStyle: 'bold',
  color: '#f5c542',
  stroke: '#3a2a10',
  strokeThickness: 5,
};

/**
 * Contextual toolbar (U3b): a small drawn-vector bar (U2b card language -
 * parchment fill, thin dark-brown stroke) that floats just above the currently
 * selected / lifted asset, carrying only the actions that asset can take today
 * (Flip where flippable; Put away where storable). It lives in the WORLD layer
 * so it tracks the asset in world space with no per-frame camera maths - it
 * scales with the camera zoom like the asset it is attached to. A high depth
 * keeps it above every field object (lifted plots reach PLOT_LIFT_DEPTH 2050,
 * the footprint preview 2100). Hidden - and holding zero live hitboxes - the
 * moment nothing actionable is selected.
 */
const CTX_TOOLBAR_DEPTH = 3000;
const CTX_BTN_HEIGHT = 74;
const CTX_FLIP_WIDTH = 150;
const CTX_PUT_AWAY_WIDTH = 200;
const CTX_BTN_GAP = 14;
/** Clearance between the asset's top edge and the toolbar's bottom edge. */
const CTX_TOOLBAR_GAP = 26;
const CTX_STROKE_BROWN = 0x4a3218;
const CTX_BTN_FILL = 0xf1e2c0;
const CTX_BTN_RADIUS = 16;
const CTX_BTN_STROKE_W = 2;
const CTX_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/** Put-away flight (U3b): reuse the shop's fly-to-chip pattern - one plain
 *  Image, one tween, no per-frame Graphics redraws. */
const PUT_AWAY_FLY_MS = 420;
const PUT_AWAY_FLY_END_SCALE = 0.18;
const PUT_AWAY_FLY_DEPTH = 2400;
const SHED_BUTTON_BOUNCE_MS = 140;
const SHED_BUTTON_BOUNCE_SCALE = 1.3;

/**
 * Shed panel (T3.9b): a simple full-modal over the scene, reachable
 * only from arrange mode's Shed button - same panel dimensions/position
 * as `DecorShop` for visual consistency, but built directly in this scene
 * (no separate UI class) since it only ever exists inside arrange mode. Its
 * own full-screen backdrop sits ABOVE the arrange control row (unlike the
 * shared `ModalBackdrop`, fixed below the panel tier) so a tap anywhere
 * outside the panel body - including on the now-covered control row - closes
 * it instead of reaching through to a control underneath. Built once in
 * `create()`, hidden and inert until opened; one row per `DECOR_ITEMS` frame
 * plus one per `TROPHY_ITEMS` frame (T3.18), shown/hidden per-row from live
 * owned counts, decor rows before trophy rows, visible rows packed top-down
 * with no gaps (see `refreshShedPanel`).
 */
const SHED_PANEL_WIDTH = 1020;
const SHED_PANEL_HEIGHT = 1620;
const SHED_PANEL_CENTER_X = DESIGN_WIDTH / 2;
const SHED_PANEL_CENTER_Y = 980;
const SHED_BACKDROP_DEPTH = ARRANGE_UI_DEPTH + 50;
const SHED_PANEL_DEPTH = ARRANGE_UI_DEPTH + 60;

const SHED_TITLE_Y = -SHED_PANEL_HEIGHT / 2 + 60;
const SHED_CLOSE_OFFSET_X = SHED_PANEL_WIDTH / 2 - 50;
const SHED_CLOSE_OFFSET_Y = -SHED_PANEL_HEIGHT / 2 + 50;

const SHED_ROWS_PER_COLUMN = 8;
const SHED_COLUMN_X = [-245, 245] as const;
const SHED_ROW_START_Y = -640;
const SHED_ROW_SPACING = 175;

/**
 * Icons render at one uniform square footprint via `setDisplaySize` (T3.18a)
 * regardless of their source frame's native size - decor frames pack at
 * 128px but trophy frames pack at up to 256px (trophy_ancientoak), and a
 * plain `setScale` (the pre-T3.18a approach) scaled those native pixels
 * directly, rendering oversized trophy icons that overran neighboring
 * columns. 84 matches the on-screen size decor icons already had.
 */
const SHED_ICON_SIZE = 84;

const SHED_ICON_OFFSET_X = -190;

const SHED_NAME_OFFSET_X = -130;
const SHED_NAME_OFFSET_Y = -22;
/**
 * The name text's shrink-to-fit ceiling (T3.18a, same technique as
 * `LevelUpCelebration`/`OnboardingGuide`/`WeeklyNoticePanel`): the longest
 * trophy names ("Golden Scarecrow", "Trader's Cart") would otherwise clip
 * against the Place button. Set from the real gap between the name's left
 * edge and the Place button's left edge at the offsets above - see the
 * SHED_* geometry comment for the derivation if these offsets change.
 */
const SHED_NAME_MAX_WIDTH = 200;
const SHED_COUNT_OFFSET_X = -130;
const SHED_COUNT_OFFSET_Y = 22;

const SHED_PLACE_BUTTON_OFFSET_X = 155;
const SHED_PLACE_BUTTON_WIDTH = 140;
const SHED_PLACE_BUTTON_HEIGHT = 90;

const SHED_EMPTY_TEXT = 'Nothing stored. Buy decor at the farmhouse.';

const SHED_TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};
const SHED_CLOSE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};
const SHED_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};
/**
 * Trophy rows (T3.18, recolored T3.18b): identical to `SHED_NAME_STYLE`
 * but in the same premium-blue used by the order board's "Premium Order" tag
 * (`PREMIUM_TAG_STYLE` in OrderBoard.ts) - trophies share that "special" blue
 * family, distinct from ordinary shop decor.
 */
const SHED_TROPHY_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  ...SHED_NAME_STYLE,
  color: '#3a4a8a',
};
const SHED_COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  color: '#7a5518',
};
const SHED_PLACE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};
const SHED_EMPTY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  color: '#7a5518',
  align: 'center',
  wordWrap: { width: SHED_PANEL_WIDTH - 160 },
};

/**
 * Scene dressing decals (T2.28, collapsed to one array + depth in T2.28a):
 * `DRESSING` reads as ground decals above the grass tiles but below every
 * y-depth-sorted object - see `DRESSING`'s own comment in config.ts.
 * `createSceneDressing` is the one call in `create()` that draws it -
 * commenting it out disables all of this task's dressing.
 */
const DRESSING_DEPTH = 6;

/**
 * Player-painted path tiles (T4.12): a COSMETIC ground-decal band. It must
 * sit above the grass (GROUND_LAYER_DEPTH -2000 and its overlays) but below
 * everything the player farms with - plot tiles (PLOT_TILE_DEPTH -1000),
 * crops, structures, decorations, and the scene dressing (DRESSING_DEPTH 6) -
 * so a path always reads as painted ON the ground, never over a plot.
 * PLOT_TILE_DEPTH - 1 puts it in exactly that gap and keeps the whole path
 * layer flat: paths never y-sort against each other (they are coplanar
 * ground) and never against anything else (nothing else lives in this band).
 */
/**
 * Per-tile deterministic mirroring (T4.12): the path art is hard-edged and
 * tiles gaplessly, so an unbroken run reads as an obvious repeat. A cheap
 * integer hash of (col, row) picks flipX/flipY per tile - deterministic, so a
 * tile looks identical every load and needs nothing saved. The two odd
 * multipliers keep the pattern from aligning with either grid axis.
 */
function pathTileFlip(col: number, row: number): { flipX: boolean; flipY: boolean } {
  const hash = Math.abs(col * 73856093 + row * 19349663);
  return { flipX: (hash & 1) === 1, flipY: (hash & 2) === 2 };
}

/**
 * Dressing editor (T2.28a, dev-only): drag/spawn/scale/delete step sizes and
 * the newly-spawned decal's default scale/position, plus the selection
 * highlight tint - see `setDressingEditActive`/`spawnDressingDecal`.
 */
const DRESSING_SCALE_MIN = 0.2;
const DRESSING_SCALE_MAX = 1.5;
const DRESSING_SPAWN_SCALE = 0.55;
const DRESSING_SELECTED_TINT = 0x66ccff;
/**
 * "Move to front" (T2.28a follow-up): a decal's depth when `front` is set -
 * above every y-depth-sorted FIELD object (crops/structures top out around
 * DESIGN_HEIGHT, 1920) but strictly below the UI tier (seed bar 2000, panels
 * 2100): fronted decals are farm art, never overlays on menus (user report +
 * PM-direct fix, 2026-07-12).
 */
const DRESSING_FRONT_DEPTH = 1950;

/**
 * The notice board's hit area covers its full display bounds (not just its
 * trimmed opaque art - the user-facing tap target is the whole roof + board +
 * both posts) plus this much padding on every side, in DISPLAY px (converted
 * to native frame units in `createNoticeBoard`, since `hitArea` rectangles
 * are specified in the texture's own unscaled local space).
 */
const NOTICE_BOARD_HIT_PAD_DISPLAY_PX = 20;

/**
 * The notice board's full displayed structure bounds, padded (T3.14) - the
 * same size `createNoticeBoard`'s hitArea effectively covers in display
 * space (STRUCTURE_FRAME_SIZE * NOTICE_BOARD_SCALE + the pad on both sides).
 * The 'orders-button' pulse target uses this so the tutorial ring wraps the
 * whole structure, not just its bare NOTICE_BOARD_DISPLAY_HEIGHT footprint.
 */
const NOTICE_BOARD_PULSE_SIZE = NOTICE_BOARD_DISPLAY_HEIGHT + NOTICE_BOARD_HIT_PAD_DISPLAY_PX * 2;

/**
 * The "!" badge on the notice board, shown when an open order is fully
 * coverable. MEASURED (Jimp scan of the packed `notice_board` frame, 256x256
 * native): the board's opaque art is narrower than its square frame (native
 * x 45..210) and is a signpost with a peaked roof, so the frame's own top-right
 * corner (0, 0) sits in empty padding, nowhere near the art - the roof's right
 * eave (its actual top-right silhouette point) peaks at native (210, ~110).
 * The badge anchors there, nudged further up-right by BADGE_CORNER_NUDGE so it
 * hangs off the eave's tip rather than sitting on top of the shingles.
 */
const NOTICE_BOARD_CONTENT_RIGHT_NATIVE = 210;
const NOTICE_BOARD_CONTENT_RIGHT_Y_NATIVE = 110;
const BADGE_CORNER_NUDGE = 10;
const BADGE_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#f5c542',
  stroke: '#3a2a10',
  strokeThickness: 6,
};
/** Gentle "new order" bounce: a full up-down cycle every ~1s, subtle (a few px). */
const BADGE_BOUNCE_OFFSET_Y = -8;
const BADGE_BOUNCE_HALF_MS = 500;

/**
 * A producing building's on-field indicators (T4.2b) - the notice board's
 * badge pattern applied to a building, and derived the same way its panel is:
 * both read `millSlots`, so the field and the panel can never disagree about
 * what is ready.
 *
 * ONE mark, not three (T4.2b-r1). The first cut hung a ready badge off the
 * roof and puffed a separate flour cloud at the base; the owner asked for a
 * single combined indicator, centered above the building:
 *
 *   - the ICON is the building's OWN output good, so a future producer shows
 *     what it makes without touching this file;
 *   - the RING around it is a green radial progress arc - how far along the
 *     SOONEST-to-finish batch is;
 *   - the COUNT is a small corner badge, shown only when something is waiting
 *     to be collected.
 *
 * All three live in ONE container, so tracking the building through a drag is
 * a single setPosition. Nothing tweens: the ring is redrawn from state on the
 * refresh tick, which is also what makes it survive a reposition untouched.
 */
const BUILDING_BADGE_GAP = 26;
const BUILDING_BADGE_ICON_DISPLAY_SIZE = 64;
/**
 * The ring hugs the icon with a little air, and the count badge rides its
 * upper-right so it never sits over the good's art.
 */
const BUILDING_RING_RADIUS = 46;
const BUILDING_RING_THICKNESS = 9;
const BUILDING_RING_TRACK_COLOR = 0x3a2a10;
/**
 * The track is nearly opaque, not a hint. It is what separates the whole ring
 * from the field: the unfilled part reads as a dark groove and the bright arc
 * sits in it, so neither end of the ring has to fight the grass on its own.
 */
const BUILDING_RING_TRACK_ALPHA = 0.55;
/**
 * NOT the panel's bar green (0x7fb069, MillPanel's BAR_FILL_COLOR). That green
 * is tuned against a cream panel; on grass it is nearly the same hue AND value
 * as the field, so the ring sank into it. This one is deliberately lighter and
 * cooler than any grass tone, which is what makes it read at gameplay zoom.
 */
const BUILDING_RING_FILL_COLOR = 0x5cf58c;
/** Phaser arcs measure from due east, so a ring that fills from 12 o'clock starts a quarter turn back. */
const BUILDING_RING_START_ANGLE = -Math.PI / 2;
const BUILDING_COUNT_OFFSET_X = 38;
const BUILDING_COUNT_OFFSET_Y = -34;
const BUILDING_BADGE_COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '44px',
  fontStyle: 'bold',
  color: '#fff3c4',
  stroke: '#3a2a10',
  strokeThickness: 6,
};

/**
 * `refreshBuildings`'s change key (T4.2b): which buildings exist and where
 * they stand, and NOTHING else - mirrors `refreshStructures`' positional key.
 * See `lastBuildingsJson` for why the batches must stay out of it.
 */
function buildingPositionsKey(state: GameStateData): string {
  return state.buildings.map((b) => `${b.type}:${b.col},${b.row}`).join(';');
}

/** One building's field indicator - see BUILDING_BADGE_GAP's comment. */
interface BuildingIndicators {
  /** The whole mark: icon + progress ring + ready count, in one movable unit. */
  badge: Phaser.GameObjects.Container;
  /** The green radial progress ring, cleared and redrawn per refresh tick. */
  ring: Phaser.GameObjects.Graphics;
  count: Phaser.GameObjects.Text;
}

/**
 * Dev-only hitbox visualizer (T2.24): the depth a container child's debug
 * outline is temporarily bumped to while the visualizer is on, so it renders
 * above everything instead of at its own unused default depth (0) - see
 * `toggleHitboxDebug`.
 */
const HITBOX_DEBUG_DEPTH = 999_999;

/** The subset of a GameObject's shape `toggleHitboxDebug` needs beyond the base
 *  class (which already declares `parentContainer`) - every object in Phaser's
 *  own interactive-object list implements `depth`/`setDepth` via its Depth component. */
interface HitboxDebuggable extends Phaser.GameObjects.GameObject {
  depth: number;
  setDepth(value: number): this;
}

/**
 * Camera gestures (T3.4b): the main (world) camera becomes player-facing -
 * one-finger pan, pinch zoom, mouse wheel, rubber-banded edges, momentum,
 * and a recenter button. All the pure math lives in systems/cameraMath.ts;
 * this scene owns gesture classification and the live camera writes.
 * `dev.camera(...)` deliberately bypasses all of these clamps.
 */
/** Zoom-in ceiling for gestures; the floor is fitZoom(world) - see cameraFitZoom. */
const CAMERA_MAX_ZOOM_IN = 1.6;
/**
 * T3.3a-r2 splits the two rects the T3.4b gestures share:
 * - WORLD: the full world rect (config.ts) - pan reaches everywhere in it,
 *   rubber-banding at its true edges, and the zoom-out floor is fitZoom(world),
 *   showing grass to every edge. It grew EAST in T3.3b (regions) and WEST in
 *   T4.10, reaching 2028x2560, so the floor DROPPED from 0.75 to the width fit
 *   ~0.5325 (derived, pinned in cameraMath.test.ts) - never re-hardcoded here.
 * - OWNED: the legacy 1080x1920 design rect, still exactly where it was -
 *   the HOME view (default + Recenter target) is fitZoom(owned) pulled back by
 *   CAMERA_HOME_ZOOM_OUT (see there), centered on the same rect.
 */
const CAMERA_WORLD_BOUNDS: WorldBounds = {
  x: WORLD_MIN_X,
  y: WORLD_MIN_Y,
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
};
const CAMERA_OWNED_BOUNDS: WorldBounds = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
/**
 * How far the HOME view sits back from the OWNED rect's fit zoom - the default
 * camera the player lands on, and the Recenter target.
 *
 * Expressed as a FRACTION of that fit rather than an absolute zoom, so it
 * stays meaningful if the owned rect or the design viewport ever changes.
 * 0.7 shows the farm noticeably wider than the old fitZoom(owned) = 1 while
 * staying clear of the gesture floor (fitZoom(world) ~= 0.5325, the fully
 * zoomed-out view): it spends about two thirds of the available zoom-out
 * range, so the player can still pinch out further to see the whole world.
 * `cameraHome` clamps against that floor anyway, so this can never push past it.
 */
const CAMERA_HOME_ZOOM_OUT = 0.7;
/**
 * The one-finger PAN band, in screen y: between the HUD banner's bottom edge
 * and the seed bar band's top. Both values are module-local layout constants
 * of their owning files, pinned here by the task: Hud.ts BANNER_BOTTOM_Y
 * (14 + 144 = 158) and SeedBar.ts BAR_CENTER_Y - BUTTON_HEIGHT / 2
 * (1700 - 140 = 1560). Downs above/below the band are the banner's and the
 * seed bar's own business (the bar runs its own scene-level strip drag).
 */
const PAN_BAND_TOP_Y = 158;
const PAN_BAND_BOTTOM_Y = 1560;
/** Soft edge overshoot distance (world px) for a live drag - see cameraMath.rubberBand. */
const PAN_RUBBER_BAND_GIVE = 120;
/** Release glide: distance = release velocity (world px/ms) x this, eased over the duration. */
const PAN_MOMENTUM_DISTANCE_MS = 150;
const PAN_MOMENTUM_DURATION_MS = 300;
/** Only pointer samples this recent feed the release velocity - older ones are a held finger. */
const PAN_VELOCITY_WINDOW_MS = 100;
/** Ring capacity for those samples; at ~60Hz move events, 8 comfortably spans the window. */
const PAN_SAMPLE_CAPACITY = 8;
/** Exponential wheel-zoom rate per deltaY unit (~1.13x per 100-unit notch). */
const WHEEL_ZOOM_STEP = 0.0012;
/**
 * Deferred-tap slop (T3.4c), in design px - the same constant/precedent as
 * SeedBar's TAP_SLOP. Movement beyond this while a structure or plot tap is
 * armed converts the gesture (structure -> pan, plot -> live farm sweep);
 * release within it fires the tap.
 */
const TAP_SLOP = 12;
/**
 * Long-press lift hold (T3.3a-r3): an arrange-mode down on a movable object
 * (decor sprite or plot tile) must stay within TAP_SLOP this long before
 * the object lifts. Movement past the slop first cancels the pending lift
 * and reclassifies the gesture as a pan - panning is safe everywhere,
 * picking something up is deliberate.
 */
const HOLD_MS = 250;
/** Visual lift cue (T3.3a-r3): quick scale pulse - one leg up to
 *  LIFT_PULSE_SCALE, yoyo back, so ~2x LIFT_PULSE_MS total. */
const LIFT_PULSE_SCALE = 1.1;
const LIFT_PULSE_MS = 90;
/** Haptic lift cue duration - see `buzzOnLift` (feature-checked; iOS Safari has no vibrate). */
const LIFT_VIBRATE_MS = 30;
/**
 * Free-follow structure drop (T3.3s-r2): on release, the lifted structure
 * commits to the NEAREST legal anchor whose ideal anchor-tile center lies
 * within this many design px of the drop point's; with none in range it
 * wiggles and snaps back to the saved anchor. (Anchor centers are 128px
 * apart in x and 64 in y, so the +/-4-tile search window below always
 * covers the radius.)
 */
const STRUCTURE_SNAP_RADIUS = 192;
const STRUCTURE_SNAP_SEARCH = 4;
/**
 * Lift-time ground overlays (T3.3s-r2): the faint placement grid (change 5)
 * and the dev.footprints() restrictions overlay render in the band directly
 * above the ground layer (-2000) and strictly below the plot sub-layer band
 * (PLOT_TILE_DEPTH ~-1000, ~1000 depth units up) and every y-depth-sorted
 * sprite above that. The lifted structure's green/red footprint preview
 * does NOT live here: it renders at FOOTPRINT_PREVIEW_DEPTH, above every
 * field object - see `rebuildStructureFootprintPreview`.
 */
const PLACEMENT_GRID_DEPTH = GROUND_LAYER_DEPTH + 1;
const DEV_FOOTPRINTS_DEPTH = GROUND_LAYER_DEPTH + 3;
/**
 * The live green/red footprint preview's depth (T3.3b-r2). Was a small
 * negative offset from the LIFTED structure's own y (T3.3s-r2c), which put
 * it below any plot or crop standing in FRONT of the structure - so a
 * blocked tile's red shading was hidden under the very plot that blocked it
 * (found on device). It is now a flat depth above EVERY field object:
 * crops, decor and structures all render at plain y, which
 * PLOT_PLACEABLE_MAX_Y / DECOR_Y_MAX cap at 2010 (the board badge adds 1),
 * and plot tiles sit far below in the PLOT_TILE_DEPTH band (T3.3b-r3), so
 * the highest field depth is 2011. 2100 clears that and stays
 * below the arrange UI (ARRANGE_UI_DEPTH 2200). The cost is that the
 * translucent shading also draws over the lifted structure's own base
 * instead of tucking under it; the invariant that a blocked tile is ALWAYS
 * visibly red over whatever occupies it wins.
 */
const FOOTPRINT_PREVIEW_DEPTH = 2100;
/**
 * Plots are a GROUND SUB-LAYER (T3.3b-r3, owner ruling: standing objects
 * always render on top of plots). Every plot tile renders in a narrow band
 * around this base: strictly above the ground/overlay stack
 * (GROUND_LAYER_DEPTH -2000 through its +3 overlay) and strictly below
 * every y-depth-sorted standing object - crops, decor, structures and their
 * depth - 1 cast shadows. The lowest committed standing y is
 * PLOT_PLACEABLE_MIN_Y / DECOR_Y_MIN (-300, shadow -301), and a mid-drag
 * sprite can reach WORLD_MIN_Y (-320, shadow -321), so the band around
 * -1000 leaves ~680 depth units of clearance to the standing band and
 * ~1000 to the overlay band - nothing can drift into either gap. This
 * replaces both the old y - 1 `plotTileDepth` AND the T3.3b-r2 +32
 * decoration bias: with plots below the whole standing band, decor renders
 * at plain y again.
 *
 * NOT one shared depth WITHIN the band (owner-reported overlap after the
 * first flat cut): the plot frame is 256x160 - the 128px diamond plus a
 * 32px raised-soil lip hanging BELOW it, into the diamond of the row in
 * front - so plot-vs-plot draw order matters. At one literally flat depth
 * that overlap resolves by creation order, and a later-placed plot BEHIND
 * drew its lip over the plot in front. Each tile therefore adds
 * y * PLOT_TILE_DEPTH_Y_STEP: front-over-back among plots, while any world
 * y (WORLD_MIN_Y -320 .. PLOT_PLACEABLE_MAX_Y + 64 = 2074) moves the depth
 * by under +/-2.1 - the band spans [-1000.4, -997.9], so no plot can ever
 * reorder against the ground stack or a standing object. Grass tiles do
 * stay one flat depth: their lip band continues seamlessly into the
 * neighbor's art, so their overlap order is invisible.
 */
const PLOT_TILE_DEPTH = -1000;
const PLOT_TILE_DEPTH_Y_STEP = 0.001;
/**
 * Player-painted path tiles (T4.12): a COSMETIC ground-decal band. It must
 * sit above the grass (GROUND_LAYER_DEPTH -2000 and its overlays) but below
 * everything the player farms with - plot tiles, crops, structures,
 * decorations, and the scene dressing (DRESSING_DEPTH 6) - so a path always
 * reads as painted ON the ground, never over a plot. PLOT_TILE_DEPTH - 1 is
 * exactly that gap, and the whole layer stays FLAT: paths are coplanar
 * ground, so they never y-sort against each other, and nothing else lives in
 * this band to sort against.
 */
const PATH_LAYER_DEPTH = PLOT_TILE_DEPTH - 1;
/**
 * A LIFTED plot tile's temporary depth (T3.3b-r3): at the flat
 * PLOT_TILE_DEPTH a dragged plot would vanish under any crop, decor or
 * structure it crosses, so the lift elevates it above the whole standing
 * band (max committed depth 2011 - see FOOTPRINT_PREVIEW_DEPTH) while
 * staying under the modal backdrop (2090), the structure footprint preview
 * (2100) and the arrange UI (2200). Snaps back to PLOT_TILE_DEPTH on commit
 * or on an arrange-mode exit that abandons the lift.
 */
const PLOT_LIFT_DEPTH = 2050;
/** Faint diamond grid over the placeable domain during plot/structure lifts. */
const PLACEMENT_GRID_LINE_WIDTH = 2;
const PLACEMENT_GRID_LINE_COLOR = 0xffffff;
const PLACEMENT_GRID_LINE_ALPHA = 0.2;
/** Live footprint preview tints: green = that tile is free, red = blocked. */
const FOOTPRINT_FREE_COLOR = 0x2ecc40;
const FOOTPRINT_BLOCKED_COLOR = 0xe03131;
const FOOTPRINT_FILL_ALPHA = 0.35;
/** dev.footprints() overlay: blocked-tile fill and the beyond-domain dim wash. */
const DEV_FOOTPRINT_BLOCKED_ALPHA = 0.4;
const DEV_DOMAIN_WASH_COLOR = 0x1a2333;
const DEV_DOMAIN_WASH_ALPHA = 0.25;
/**
 * Locked-region dim overlay (T3.3b): a black tint over a locked band, straight
 * vertical west edge at the band boundary, full world height, above the ground
 * layer but below every standing object (its depth is far under the lowest
 * y-derived sprite depth). Fades out over REGION_DIM_FADE_MS on purchase.
 */
const REGION_DIM_COLOR = 0x000000;
const REGION_DIM_ALPHA = 0.35;
const REGION_DIM_DEPTH = GROUND_LAYER_DEPTH + 2;
const REGION_DIM_FADE_MS = 400;
/** Where a region sign's refusal FloatingText spawns, above the sign. */
const REGION_SIGN_FEEDBACK_OFFSET_Y = -160;
const REGION_REFUSAL_TEXT_OPTIONS: FloatingTextOptions = { color: '#ffd27a', fontSize: 44 };
/** One-time two-finger-pan hint (T3.3b): a UI-layer toast after the first region purchase. */
const TWO_FINGER_HINT_TEXT = 'Tip: drag with two fingers to pan from anywhere.';
const TWO_FINGER_HINT_POSITION = { x: DESIGN_WIDTH / 2, y: 620 } as const;
const TWO_FINGER_HINT_OPTIONS: FloatingTextOptions = { color: '#fff3c4', fontSize: 34 };
/** Recenter glide duration (task-specified ~250ms, Sine.easeOut). */
const RECENTER_GLIDE_MS = 250;
/** Off-default detection thresholds - a finished tween lands exactly, these absorb float noise. */
const CAMERA_SCROLL_EPSILON = 0.5;
const CAMERA_ZOOM_EPSILON = 0.001;

/**
 * Recenter button (T3.4b): panel nineslice + label like the arrange-row
 * buttons, centered directly below the HUD xp bar (owner feedback moved it
 * here from under the gear) with a small deliberate gap - a visible sliver
 * of green field must separate the bar's frame from the button. The xp
 * bar's bottom edge is derived from Hud.ts module-locals, pinned here:
 * BANNER_BOTTOM_Y (158) + XP_BAR_FRAME_TOP_GAP (10) + the frame's display
 * height (138 native x 360/512 scale = 97.03).
 */
const RECENTER_WIDTH = 170;
const RECENTER_HEIGHT = 60;
const XP_BAR_BOTTOM_Y = 158 + 10 + (138 * 360) / 512;
const RECENTER_GAP_Y = 12;
const RECENTER_X = DESIGN_WIDTH / 2;
const RECENTER_Y = XP_BAR_BOTTOM_Y + RECENTER_GAP_Y + RECENTER_HEIGHT / 2;
const RECENTER_DEPTH = 2000;
const RECENTER_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '24px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/**
 * The UI-layer FloatingText twin (T3.4b pool split): FloatingText's pool
 * grows on demand inside show() (Pool.acquire creates a fresh Text when the
 * free list is empty), which happens mid-gameplay OUTSIDE the `inUiLayer`
 * construction scope - a grown label would route to the world layer by
 * default and start moving with the camera. PooledArc/ChestCeremony pin
 * their own lazy objects, but FloatingText's pool is private to the shared
 * class (untouched by this task - the split is achieved purely by what
 * FarmScene constructs and passes), so the pinning happens at the call
 * boundary instead: every show() runs inside the same UI routing scope the
 * twin was constructed in.
 */
class UiLayerFloatingText extends FloatingText {
  constructor(
    scene: Phaser.Scene,
    private readonly routeUi: <T>(build: () => T) => T,
  ) {
    super(scene);
  }

  override show(x: number, y: number, text: string, options?: FloatingTextOptions): void {
    this.routeUi(() => super.show(x, y, text, options));
  }
}

/**
 * One shed panel row (T3.9b) - one per `DECOR_ITEMS` frame plus one per
 * `TROPHY_ITEMS` frame (T3.18), built once at a neutral position, shown/hidden
 * per owned count and positioned into its packed slot by
 * `positionShedRow` (see `refreshShedPanel`).
 */
interface ShedRow {
  frame: string;
  icon: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  countText: Phaser.GameObjects.Text;
  placeButton: Phaser.GameObjects.NineSlice;
  placeText: Phaser.GameObjects.Text;
}

/**
 * The main farm scene: plots on a HIDDEN scene-wide iso grid (T3.3a-r) in
 * the middle of a grass field, rendered live from `gameState`, plus the
 * seed bar. Each plot draws its own tile sprite; plotless land renders
 * nothing. One unified field gesture: tapping or sweeping harvests every
 * ready crop the pointer enters, and (with a seed selected) paint-plants
 * empty plots.
 *
 * Plot positions (T3.3a): every plot carries explicit `col`/`row` in the
 * save - array index means nothing spatially. Anything mapping a tap to a
 * plot goes through `plotIndexAtScreen` (a coordinate lookup against the
 * plots' actual tiles); anything mapping a plot to the screen goes through
 * `gridToIso(plot.col, plot.row)` in the frozen frame.
 */
export class FarmScene extends Phaser.Scene {
  /**
   * T3.4a camera split: every display object lives in exactly one of these
   * two Layers - `worldLayer` for anything anchored to a farm position,
   * `uiLayer` for anything anchored to the screen. The main camera renders
   * only the world layer (and is the one a later task will pan/zoom);
   * `uiCamera` renders only the UI layer and never moves. See
   * `createCameraLayers` for the routing mechanism.
   */
  private worldLayer!: Phaser.GameObjects.Layer;
  private uiLayer!: Phaser.GameObjects.Layer;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  /** Where `routeAddedObject` sends newly created display objects - the world
   *  layer except inside an `inUiLayer(...)` scope. */
  private routeLayer!: Phaser.GameObjects.Layer;
  /** Scratch vector for `fieldPointerWorld` - no per-pointer-move allocation. */
  private readonly pointerWorldPoint = new Phaser.Math.Vector2();
  /** One reusable crop sprite per plot, indexed like `gameState.plots`. */
  private cropSprites: Phaser.GameObjects.Image[] = [];
  /**
   * One tile image PER PLOT (T3.3a-r, replacing the permanent 16-tile
   * field), indexed like `gameState.plots`/`cropSprites` - created,
   * destroyed, and moved in step with state exactly like the crop sprites.
   * 'plot'/'plot_occupied' per plot state; empty land renders NOTHING (the
   * scene's normal ground shows through). Also what the onboarding highlight
   * breathes and what arrange mode lifts - never the crop sprite, which owns
   * its own ready bounce.
   */
  private readonly plotTileSprites: Phaser.GameObjects.Image[] = [];
  /** Whether the ready-state bounce/glow is currently active, per plot. */
  private readyActive: boolean[] = [];
  /**
   * Whether a harvest pop is mid-flight, per plot. Keeps `refreshCrops` from
   * hiding the sprite the moment state says the plot is empty again.
   */
  private popActive: boolean[] = [];
  private refreshAccumulatorMs = 0;
  private seedBar!: SeedBar;
  private cropInfoCard!: CropInfoCard;
  private replantChip!: ReplantChip;
  private cropCountdown!: CropCountdown;
  /**
   * T3.4b pool split: TWIN floating-text/particle pools, one per camera. The
   * world twins serve plot-anchored effects (harvest xp, plant cost, Radiant,
   * leaf/sparkle bursts at plots) and pan/zoom with the field; the UI twins
   * (constructed inside `inUiLayer`) serve screen-anchored effects (the HUD's
   * sell/fulfill "+N" labels, the level-up and chest-ceremony bursts) and
   * stay pixel-fixed. The UI classes' signatures are unchanged - FarmScene
   * just passes different instances.
   */
  private worldFloatingText!: FloatingText;
  private uiFloatingText!: FloatingText;
  private worldParticles!: ParticleBurst;
  private uiParticles!: ParticleBurst;
  private coinArc!: CoinArc;
  private moondustArc!: MoondustArc;
  private hud!: Hud;
  private levelUpCelebration!: LevelUpCelebration;
  private onboardingGuide!: OnboardingGuide;
  private expandSign!: ExpandSign;
  /** The sign's generated ground shadow (T3.art-2) - synced with the sign in `refreshExpandSign`. */
  private expandSignShadow!: Phaser.GameObjects.Image;
  /** Region purchase signs (T3.3b), one per REGIONS entry, keyed by region id. */
  private readonly regionSigns = new Map<string, RegionSign>();
  /** Each locked region's dim overlay (T3.3b), keyed by region id; faded out
   *  and removed on purchase. */
  private readonly regionDims = new Map<string, Phaser.GameObjects.Rectangle>();
  /** Set on a successful region purchase (T3.3b): show the one-time
   *  two-finger-pan hint once the 5C grant popup closes, then clear. */
  private pendingTwoFingerHint = false;
  /** Whether the plot-grant popup was visible last tick - so the hint fires on
   *  its close edge (T3.3b), not before it ever appears. */
  private plotGrantPopupWasVisible = false;
  private offlineSummaryPanel!: OfflineSummaryPanel;
  private weeklyNoticePanel!: WeeklyNoticePanel;
  private audio!: AudioManager;
  private noticeBoardImage!: Phaser.GameObjects.Image;
  private noticeBoardBadge!: Phaser.GameObjects.Text;
  /** The badge's perpetual bounce tween - killed and rebuilt whenever the
   *  board (and so the badge's base position) moves (T3.3s). */
  private noticeBoardBadgeTween: Phaser.Tweens.Tween | null = null;
  /** The board's ground shadow - a field since T3.3s so it travels with the board. */
  private noticeBoardShadow!: Phaser.GameObjects.Image;
  /** Cached rails gating so interactivity/alpha only toggle on change (mirrors Hud's pattern). */
  private noticeBoardEnabled = true;
  private chestCeremony!: ChestCeremony;
  private farmhouseImage!: Phaser.GameObjects.Image;
  /** The farmhouse's ground shadow - a field since T3.3s so it travels with the house. */
  private farmhouseShadow!: Phaser.GameObjects.Image;
  /** Cached rails gating, mirrors `noticeBoardEnabled`. */
  private farmhouseEnabled = true;
  /**
   * Dev-only farmhouse transform knobs (T3.26), for diagnosing whether the
   * building's angle is an in-plane tilt (fixable by rotation) or a
   * perspective mismatch (needs new art). Deliberately NOT part of
   * `GameStateData` and never saved - a reload clears them. See
   * `applyFarmhouseDevTransform`.
   */
  private farmhouseDevAngle = 0;
  private farmhouseDevScaleMult = 1;
  private farmhouseDevOffsetX = 0;
  private farmhouseDevOffsetY = 0;
  /**
   * The selected structure in arrange mode (T3.3s), or null - mutually
   * exclusive with `selectedDecorationIndex`/`selectedPlotIndex`, same
   * one-selection rule. While one is selected, Scale/Flip/Put Away all dim
   * (structures move only - never scale, flip, or store).
   */
  private selectedStructureId: MovableAnchorRef | null = null;
  /** The structure or building being drag-moved right now (T3.3s; T4.1 widened
   *  it to a MovableAnchorRef), or null outside a lift. */
  private structureDragId: MovableAnchorRef | null = null;
  /**
   * Placed buildings (T4.1), parallel arrays indexed exactly like
   * `state.buildings` - the sprite, and its generated cast shadow. Rebuilt
   * wholesale by `refreshBuildings` when the saved list changes (buildings are
   * bought and moved, never stored, so a rebuild is rare).
   */
  private buildingImages: Phaser.GameObjects.Image[] = [];
  private buildingShadows: Phaser.GameObjects.Image[] = [];
  /**
   * Each building's on-field production indicators (T4.2b), the same parallel
   * indexing - built and destroyed with the sprite they ride.
   */
  private buildingIndicators: BuildingIndicators[] = [];
  /**
   * Last-rendered building POSITIONS, serialized (T4.2b) - `refreshBuildings`
   * rebuilds only on change, so it never fights a live building drag.
   *
   * POSITIONS ONLY, deliberately: `state.buildings` now carries milling
   * batches too (T4.2a), and keying on the whole list would tear the mill's
   * sprite down and rebuild it on every start and collect - killing the
   * selection, any in-flight drag, and the indicators mid-tick. Batches change
   * what the indicators and the panel SAY, never which sprites exist, so only
   * a building appearing, disappearing, or moving belongs in this key.
   */
  private lastBuildingsJson = '';
  /** The anchor NEAREST the in-flight free-form drag position (T3.3s-r2) -
   *  legal or not; it drives the live green/red footprint preview, and the
   *  COMMIT independently searches for the nearest LEGAL anchor. */
  private structureDragCol = 0;
  private structureDragRow = 0;
  /** Faint placement grid (T3.3s-r2 change 5), alive only during a plot or
   *  structure lift - see `showPlacementGrid`. */
  private placementGridGraphics: Phaser.GameObjects.Graphics | null = null;
  /** The lifted structure's live green/red footprint (T3.3s-r2) - rebuilt
   *  when the nearest anchor changes, destroyed when the lift ends. */
  private structureFootprintGraphics: Phaser.GameObjects.Graphics | null = null;
  /** dev.footprints() overlay state (T3.3s-r2) - see `toggleDevFootprints`. */
  private devFootprintsEnabled = false;
  private devFootprintsGraphics: Phaser.GameObjects.Graphics | null = null;
  /** "col,row" keys of the placeable hidden-grid tile set, built on first use.
   *  Region-aware (T3.3b): rebuilt when `regionsUnlocked` changes, tracked by
   *  `placeableTileKeysSig`. */
  private placeableTileKeys: Set<string> | null = null;
  private placeableTileKeysSig = '';
  /** Last-rendered structure anchors, serialized - `refreshStructures`
   *  repositions only on change (so it never fights a live drag, whose
   *  moves are sprite-only until the commit). */
  private lastStructureAnchorsJson = '';
  private restorePanel!: RestorePanel;
  private questBoard!: QuestBoard;
  private goalsPanel!: GoalsPanel;
  /** The mill's panel (T4.2b) - opened by tapping a producing building. */
  private millPanel!: MillPanel;
  /** One sprite (+ one ground shadow) per `gameState` decoration, same index - see `refreshDecorations`. */
  private decorationSprites: Phaser.GameObjects.Image[] = [];
  /** Null entries are shadowless decorations (no `_shadow` companion frame, e.g. decor_fence) - stays index-aligned with `decorationSprites`. */
  private decorationShadowSprites: (Phaser.GameObjects.Image | null)[] = [];
  /** Last-rendered decorations, serialized - `refreshDecorations` rebuilds only on change. */
  private lastDecorationsJson = '';
  /** Whether arrange mode (T3.9a) is active - see `enterArrangeMode`/`exitArrangeMode`. */
  private arrangeModeActive = false;
  /**
   * Painted path tile sprites (T4.12), keyed "col,row" so a single painted or
   * erased tile is an O(1) sprite add/remove (T4.12-r1). Keyed rather than a
   * list precisely because painting is per-tile and continuous: the original
   * whole-layer teardown+recreate cost O(area) on EVERY tile of a drag, which
   * is what made painting into a large path lag.
   */
  private readonly pathSprites = new Map<string, Phaser.GameObjects.Image>();
  /**
   * The `paths` ARRAY last rendered from - identity, not contents (T4.12-r1).
   * `paintPath`/`erasePath` mutate that array in place, so a live stroke keeps
   * the same reference and `refreshPaths` stays a no-op while the incremental
   * updates do the drawing. Every BULK change - load, migration, backup
   * restore, import, reset - assigns a whole new state object and therefore a
   * new array, which is exactly when a full rebuild is wanted.
   */
  private lastPathsRef: readonly PathTile[] | null = null;
  /**
   * The tier being painted while path paint mode is active (T4.12), or null
   * outside the mode. THE mode flag: paint mode is on exactly when this is
   * non-null. Mutually exclusive with arrange and dressing edit - see
   * `enterPathMode`.
   */
  private pathModeTier: PathTierId | null = null;
  /**
   * Tiles already visited by the CURRENT paint gesture, as "col,row" (T4.12).
   * The path analogue of `PlotPointerTracker`'s per-gesture dedup: a drag
   * re-entering a tile must not re-run the paint (the store also refuses a
   * same-tier repaint, but this keeps the gesture from churning at all).
   */
  private readonly pathGestureVisited = new Set<string>();
  /**
   * The grid cell the current paint gesture last sampled (T4.12-r1), or null
   * before its first sample. The anchor the next sample interpolates FROM -
   * cleared at every gesture boundary so a new stroke never draws a line back
   * to where the previous one ended.
   */
  private pathLastCell: GridCell | null = null;
  /** Index into `decorationSprites`/`decorationShadowSprites` of the tapped decoration, or null. */
  private selectedDecorationIndex: number | null = null;
  /**
   * Index into `gameState.plots` of the selected plot (T3.3a), or null.
   * Mutually exclusive with `selectedDecorationIndex` - selecting either
   * clears the other. Only empty plots are ever selected.
   */
  private selectedPlotIndex: number | null = null;
  /** The plot being drag-moved right now (T3.3a), or null outside a lift. */
  private plotDragIndex: number | null = null;
  /** The live snap tile of the in-flight plot drag - always owned and free. */
  private plotDragCol = 0;
  private plotDragRow = 0;
  /**
   * The active chain-placement session (T3.3a-r), or null: started by the
   * Shed panel's Place buttons and the grant popup's Place Now, ended by
   * leaving arrange mode. While active (and more of the item remain in the
   * shed), the "Place Next xN" button chains further spawns without
   * round-tripping to the Shed panel. `lastPlaced*Index` anchors the next
   * spawn's adjacency; every spawn is already committed to state, so Done at
   * any moment is safe.
   */
  private placementSession: { kind: 'plot' } | { kind: 'decor'; frame: string } | null = null;
  /**
   * The plot session's committed placements IN ORDER (T3.3a-r2f), as indices
   * into `gameState.plots` - resolved to their CURRENT tiles at Place Next
   * time, so a player dragging a spawned plot re-aims the chain's direction
   * inference (see `nextChainPlotTile`).
   */
  private sessionPlotIndices: number[] = [];
  private lastPlacedDecorIndex = -1;
  private arrangePlaceNextButton!: Phaser.GameObjects.NineSlice;
  private arrangePlaceNextText!: Phaser.GameObjects.Text;
  /** The plot-grant popup (T3.3a) - see `create` and the update() drain. */
  private plotGrantPopup!: PlotGrantPopup;
  /** The Shed panel's "Farm Plot xN" row (T3.3a), separate from the decor rows. */
  private plotShedRow!: ShedRow;
  /** Bottom bar (U3b): [Shed] [Shop] [Undo] [Done], Done the prominent confirm. */
  /** Save (renamed from Done, U3b-r1): the prominent confirm - end session, exit. */
  private arrangeSaveButton!: Phaser.GameObjects.NineSlice;
  private arrangeSaveText!: Phaser.GameObjects.Text;
  private arrangeShedButton!: Phaser.GameObjects.NineSlice;
  private arrangeShedText!: Phaser.GameObjects.Text;
  /** Persistent shed-count badge on the Shed button (U3b). */
  private arrangeShedBadge!: Phaser.GameObjects.Text;
  private arrangeUndoButton!: Phaser.GameObjects.NineSlice;
  private arrangeUndoText!: Phaser.GameObjects.Text;
  /** Cancel (U3b-r1): two-tap confirm that unwinds the whole session, then exits. */
  private arrangeCancelButton!: Phaser.GameObjects.NineSlice;
  private arrangeCancelText!: Phaser.GameObjects.Text;
  /** Timestamp of the first Cancel tap while armed (0 = disarmed) - see handleCancelTap. */
  private cancelArmedAt = 0;
  private arrangeShopButton!: Phaser.GameObjects.NineSlice;
  private arrangeShopText!: Phaser.GameObjects.Text;
  /**
   * Contextual toolbar (U3b): a world-layer drawn-vector bar that floats above
   * the selected asset with its valid Flip / Put away actions - see
   * `createContextualToolbar`. Hidden with zero live hitboxes when nothing
   * actionable is selected.
   */
  private ctxToolbar!: Phaser.GameObjects.Container;
  private ctxFlipBg!: Phaser.GameObjects.Graphics;
  private ctxFlipLabel!: Phaser.GameObjects.Text;
  private ctxFlipZone!: Phaser.GameObjects.Zone;
  private ctxPutAwayBg!: Phaser.GameObjects.Graphics;
  private ctxPutAwayLabel!: Phaser.GameObjects.Text;
  private ctxPutAwayZone!: Phaser.GameObjects.Zone;
  /** Every OTHER interactive object suppressed for the duration of arrange mode - see `setOtherHitboxesEnabled`. */
  private readonly arrangeModeDisabledObjects: Phaser.GameObjects.GameObject[] = [];
  /** Shed panel (T3.9b) - see `createShedPanel`. */
  private shedContainer!: Phaser.GameObjects.Container;
  private shedBackdropZone!: Phaser.GameObjects.Zone;
  private shedBg!: Phaser.GameObjects.NineSlice;
  private shedCloseButton!: Phaser.GameObjects.Text;
  private shedRows: ShedRow[] = [];
  private shedEmptyText!: Phaser.GameObjects.Text;
  private shedPanelVisible = false;
  /** Static screen position of each plot's tile center, precomputed once. */
  private readonly plotPositions: { x: number; y: number }[] = [];
  /** Dedups plots per drag gesture; shared shape with next task's harvest. */
  private readonly plotTracker = new PlotPointerTracker();
  /**
   * Locks the current gesture to whichever action first succeeds, so a sweep
   * cannot both harvest and plant. Null while unlocked (no successful action
   * yet this gesture); reset on gesture start/end.
   */
  private gestureMode: 'harvest' | 'plant' | null = null;
  /**
   * T3.4b gesture classification, locked ONCE at single-finger pointer-down.
   * The two '-armed'/'-pending' states (T3.4c) are the only ones that
   * convert on movement - by proving what the gesture is, which is the
   * point: nothing user-visible fires at pointer-down anymore where a pan
   * or pinch could still claim the gesture.
   * - 'farm': a live harvest/plant sweep (also the unconditional
   *   instant-on-down legacy path whenever camera gestures are inert -
   *   rails, modals, dressing edit - so the tutorial feel is byte-identical
   *   to pre-T3.4b behavior).
   * - 'farm-pending' (T3.4c): a down on an actionable plot, ARMED but not
   *   processed. Confirms into 'farm' on first movement past TAP_SLOP
   *   (sweep feel unchanged) or at release (a tap - juice fires then);
   *   a second finger first converts to pinch and it never processes.
   * - 'pan': one-finger camera drag from empty field ground.
   * - 'pinch': two-finger zoom/pan; farming suppressed until every finger lifts.
   * - 'structure-armed' (T3.4c): a down on the notice board / farmhouse /
   *   expand sign, ARMED but not opened. Fires its open action on an
   *   in-slop release; converts to a re-anchored pan past TAP_SLOP; a
   *   second finger converts to pinch and it never fires.
   * - 'lift-pending' (T3.3a-r3): the down landed on a movable arrange
   *   object (decor sprite or plot tile). Nothing lifts yet - a holding
   *   state that resolves to exactly one of: the hold timer maturing
   *   within TAP_SLOP lifts ('lift'), movement past the slop converts to
   *   'pan' (the object never moves), a second finger converts to 'pinch',
   *   and an in-slop release is the old tap-select.
   * - 'lift' (T3.3a-r3): the hold matured - the object follows the finger
   *   (plots snap live to free hidden-grid tiles, exactly as before the
   *   hold existed) and the release commits through the same store calls.
   *   A second finger during an active lift is deliberately IGNORED.
   *   A down whose topmost movable is the CURRENTLY SELECTED piece
   *   (T3.3a-r3c) classifies 'lift' directly - no hold; selection is the
   *   player's explicit "I'm working with this piece".
   * - 'paint' (T4.12): path paint mode is active and the down landed on the
   *   field band. Lays its tile immediately (no arm/defer - Erase makes a
   *   mistaken tile trivially undoable) and every NEW tile the drag crosses
   *   paints too, deduped per gesture by `pathGestureVisited`.
   * - 'object': the down landed on any other interactive object - not ours,
   *   its own per-object input handles everything.
   * - 'idle': the down landed in the banner or seed-bar band - nothing to do
   *   (the seed bar's own scene-level drag owns its band).
   */
  private fieldGesture:
    | 'farm'
    | 'farm-pending'
    | 'pan'
    | 'pinch'
    | 'structure-armed'
    | 'lift-pending'
    | 'lift'
    | 'paint'
    | 'object'
    | 'idle'
    | null = null;
  /**
   * The armed structure tap (T3.4c), set by `handleStructureDown` in the
   * same event dispatch the scene-level classifier then reads it in - see
   * `structureArmedThisDown` for how a stale arm (reused pointer id after a
   * swallowed release) is kept from masquerading as a fresh one.
   */
  private armedStructure: {
    pointerId: number;
    downX: number;
    downY: number;
    fire: () => void;
  } | null = null;
  /** True only between a structure's own pointer-down handler arming a tap
   *  and the scene-level POINTER_DOWN classifier consuming it (same event
   *  dispatch - per-object handlers run first). */
  private structureArmedThisDown = false;
  /** The 'farm-pending' arm (T3.4c): the down's screen position (slop test)
   *  and world position (what plotTracker.begin processes on confirm). */
  private armedFarmDownX = 0;
  private armedFarmDownY = 0;
  private armedFarmWorldX = 0;
  private armedFarmWorldY = 0;
  /**
   * The pending long-press lift (T3.3a-r3), set while `fieldGesture` is
   * 'lift-pending': the movable object under the down, the down's screen
   * position (slop test), the grab offset (object position minus the down's
   * world point - the same offset Phaser's drag plugin used, so the lifted
   * object follows the finger without jumping), and the hold timer whose
   * firing lifts (`fireHoldLift`). `target` is a sprite REFERENCE, never an
   * index - indices shift when a decoration is stored (spliced), so every
   * index derives fresh via `indexOf` at use time (the decoration-sprite
   * pattern).
   */
  private pendingLift: {
    pointer: Phaser.Input.Pointer;
    kind: 'decor' | 'plot' | 'structure';
    target: Phaser.GameObjects.Image;
    /** WHICH movable, when kind is 'structure' (T3.3s; a building since T4.1,
     *  which shares the 'structure' lift kind) - identified at down time by
     *  sprite reference, carried so the lift paths never re-derive it. */
    structureId?: MovableAnchorRef;
    downX: number;
    downY: number;
    grabOffsetX: number;
    grabOffsetY: number;
    timer: Phaser.Time.TimerEvent;
  } | null = null;
  /** The active lift (T3.3a-r3), set while `fieldGesture` is 'lift' - same
   *  reference-not-index rule as `pendingLift`. */
  private activeLift: {
    kind: 'decor' | 'plot' | 'structure';
    target: Phaser.GameObjects.Image;
    grabOffsetX: number;
    grabOffsetY: number;
  } | null = null;
  /** The lift pulse's target and its pre-pulse scale, so a release landing
   *  mid-pulse can settle the scale exactly - `commitDecorationTransform`
   *  reads the sprite's live scale, which an in-flight pulse would skew. */
  private liftPulse: {
    target: Phaser.GameObjects.Image;
    scaleX: number;
    scaleY: number;
  } | null = null;
  /** The pointer that owns the current farm/pan gesture (a second pointer must not drive it). */
  private gesturePointerId = -1;
  /**
   * The owner's "pinch suppresses taps" guardrail: set the moment a pinch
   * starts and cleared only when EVERY finger has lifted, so the survivor of
   * a pinch (or a stray move between the two ups) can never harvest/plant.
   */
  private farmingSuppressed = false;
  /** Pan gesture start state: camera scroll and pointer position at the down. */
  private panStartScrollX = 0;
  private panStartScrollY = 0;
  private panStartPointerX = 0;
  private panStartPointerY = 0;
  /**
   * Recent pan pointer samples (screen px + scene time) in a preallocated
   * ring - feeds the release-velocity estimate for the momentum glide with
   * zero steady-state allocation, per the pooling ethos.
   */
  private readonly panSampleX = new Float64Array(PAN_SAMPLE_CAPACITY);
  private readonly panSampleY = new Float64Array(PAN_SAMPLE_CAPACITY);
  private readonly panSampleT = new Float64Array(PAN_SAMPLE_CAPACITY);
  private panSampleCount = 0;
  /** The two live pinch pointers; null outside a pinch. */
  private pinchPointerA: Phaser.Input.Pointer | null = null;
  private pinchPointerB: Phaser.Input.Pointer | null = null;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  /** The world point under the pinch midpoint at pinch start - the zoom/pan anchor. */
  private readonly pinchAnchorWorld = new Phaser.Math.Vector2();
  /**
   * The one camera tween at a time (momentum glide, edge snap-back, or the
   * recenter glide - the first two are the same tween); any new gesture,
   * wheel tick, or recenter tap kills it first.
   */
  private cameraTween: Phaser.Tweens.Tween | null = null;
  /** Recenter button (T3.4b) - see `createRecenterButton`. */
  private recenterButton!: Phaser.GameObjects.NineSlice;
  private recenterText!: Phaser.GameObjects.Text;
  /** Cached visibility so the per-frame check only touches objects on change. */
  private recenterVisible = false;
  /**
   * Plots (and their crop) reaped since the chip was last dismissed -
   * accumulates across multiple harvest gestures/sweeps, not just the
   * current one. A plot already in the list is replaced (defensive dedup),
   * never duplicated. Cleared only when the chip hides (see the ReplantChip
   * `onHide` callback below).
   */
  private pendingReplant: ReplantEntry[] = [];
  /** Container children's own depth, saved while the hitbox visualizer bumps it - see `toggleHitboxDebug`. */
  private readonly hitboxOriginalDepths = new Map<HitboxDebuggable, number>();
  /** Current ground rendering mode (T2.28 dev experiment) - see `createGroundLayer`. */
  private groundMode: GroundMode = GROUND_MODE;
  /** The grass diamond tile images, kept only so 'tiles' mode can be torn down live. */
  private groundTiles: Phaser.GameObjects.Image[] = [];
  /** The whole-world meadow TileSprite in 'texture_a' mode (the default since
   *  T3.3s-r2b); null in the dev-only 'tiles'/'tiles_flat' comparison modes. */
  private groundTexture: Phaser.GameObjects.TileSprite | null = null;
  /**
   * Live, mutable dressing layout (T2.28a dev editor) - starts as a clone of
   * `DRESSING` from config.ts; drag/spawn/scale/delete all mutate this array
   * (and its parallel `dressingSprites`), never the imported constant. This
   * is what "Copy layout" serializes.
   */
  private dressingState: DressingPlacement[] = [];
  /** One sprite per `dressingState` entry, same index - kept in lockstep on spawn/delete. */
  private dressingSprites: Phaser.GameObjects.Image[] = [];
  /** Whether the dev-overlay "Edit dressing" toggle is on - see `setDressingEditActive`. */
  private dressingEditActive = false;
  /** Index into `dressingState`/`dressingSprites` of the tapped decal, or null - see `setDressingSelection`. */
  private selectedDressingIndex: number | null = null;
  /**
   * Every OTHER interactive object this scene's input plugin knew about when
   * dressing edit mode turned on (bag, gear, seed buttons, notice board,
   * expand sign, replant chip, ...) - disabled for the duration so dragging a
   * decal near them never fires their own tap handler, restored on toggle
   * off. See `setOtherHitboxesEnabled`.
   */
  private readonly dressingEditDisabledObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Farm');
  }

  create(): void {
    this.createCameraLayers();

    // One below the whole ground layer (GROUND_LAYER_DEPTH), which must
    // render above this rect but below every gameplay object. Without this,
    // texture mode drew beneath the opaque background and read as solid
    // green (PM-direct fix after T2.28). Covers the FULL world rect
    // (T3.3a-r2) so the zoomed-out view never shows void.
    this.add
      .rectangle(WORLD_MIN_X, WORLD_MIN_Y, WORLD_WIDTH, WORLD_HEIGHT, BACKGROUND_COLOR)
      .setOrigin(0, 0)
      .setDepth(GROUND_LAYER_DEPTH - 1);

    this.createGroundLayer(this.groundMode);
    this.createSceneDressing();
    this.buildPlotVisuals();
    // Audio is background-loaded (T3.21): the playlist + ambient bed are
    // queued on this scene's own loader rather than blocking Preload, so the
    // farm is playable before the ~15.8MB of music finishes downloading.
    // startMusic() fires once the load completes and still self-defers on
    // autoplay lock (Phaser's `unlocked` event) exactly as before; a failed
    // download is logged and otherwise harmless.
    this.audio = new AudioManager(this);
    for (const asset of BACKGROUND_AUDIO_ASSETS) {
      this.load.audio(asset.key, asset.url);
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.audio.startMusic());
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`Background audio load failed: ${file.key}`);
    });
    this.load.start();
    // Plot-anchored effect pools (floating text, particle bursts) and the
    // tapped-plot countdown are world objects, so they build under the
    // default world routing; everything screen-anchored builds inside
    // `inUiLayer` so every object its constructor creates - however deep -
    // routes to the UI camera. See `createCameraLayers`. T3.4b splits the
    // shared pools into per-camera twins - see the twin fields' comment.
    this.worldFloatingText = new FloatingText(this);
    this.worldParticles = new ParticleBurst(this);
    this.uiFloatingText = this.inUiLayer(
      () => new UiLayerFloatingText(this, (build) => this.inUiLayer(build)),
    );
    this.uiParticles = this.inUiLayer(() => new ParticleBurst(this));
    this.coinArc = this.inUiLayer(() => new CoinArc(this));
    this.moondustArc = this.inUiLayer(() => new MoondustArc(this));
    this.cropInfoCard = this.inUiLayer(() => new CropInfoCard(this, this.audio));
    this.restorePanel = this.inUiLayer(
      () => new RestorePanel(this, this.audio, () => this.playRestorationCelebration()),
    );
    this.seedBar = this.inUiLayer(
      () => new SeedBar(this, this.audio, (crop) => this.showCropInfo(crop)),
    );
    this.cropCountdown = new CropCountdown(this);
    // UI, not world: the chip is a fixed screen-position control (centered
    // over the seed bar band, depth 2000) - it lists plots in its COPY but is
    // not anchored to any of them, and it must stay put when the world
    // camera moves (anchoring rule; see the T3.4a task report).
    this.replantChip = this.inUiLayer(
      () =>
        new ReplantChip(
          this,
          this.audio,
          (plantedEntries) => this.handleReplanted(plantedEntries),
          () => {
            this.pendingReplant = [];
          },
        ),
    );
    // Fill pending/expired order slots before the HUD's first render.
    gameState.ensureOrders();
    this.hud = this.inUiLayer(
      () =>
        new Hud(
          this,
          this.coinArc,
          this.moondustArc,
          this.uiFloatingText,
          this.audio,
          () => this.toggleArrangeMode(),
          (tier) => this.enterPathMode(tier),
          () => this.exitPathMode(),
          (buildingId) => this.enterArrangeWithBuilding(buildingId),
        ),
    );
    // Constructed after Hud (needs it for claim-reward juice - see
    // QuestBoard's own comment) and handed back in via setQuestBoard so the
    // HUD's scroll icon can own toggling it, mirroring the bag.
    this.questBoard = this.inUiLayer(() => new QuestBoard(this, this.hud, this.audio));
    this.hud.setQuestBoard(this.questBoard);
    // Goals hub (T3.30): built here (not inside Hud) because both of its
    // actions are scene-owned - the RestorePanel opener and the camera glide -
    // then handed back the same way the quest board is.
    this.goalsPanel = this.inUiLayer(
      () =>
        new GoalsPanel(this, this.audio, {
          onRestoration: () => this.openRestorePanel(),
          onFocusRegion: (regionId) => this.focusCameraOnRegionSign(regionId),
        }),
    );
    this.hud.setGoalsPanel(this.goalsPanel);
    // The mill panel (T4.2b): opened only by a field tap on the building, so
    // it lives here rather than in Hud - the HUD just holds it for panel
    // exclusivity and its per-tick refresh (see `setMillPanel`).
    this.millPanel = this.inUiLayer(() => new MillPanel(this, this.audio));
    this.hud.setMillPanel(this.millPanel);
    this.createFarmhouse();
    this.createNoticeBoard();
    // Placed buildings (T4.1) - none on a fresh save; `refreshBuildings` picks
    // up a later purchase on the refresh tick.
    this.createBuildings();
    this.lastBuildingsJson = buildingPositionsKey(gameState.getState());
    // Painted paths (T4.12): drawn once here so a loaded save shows them on
    // the first frame rather than one refresh tick in.
    this.refreshPaths();
    registerPulseTarget('empty-plot', () => this.plotPulseTarget('empty'));
    registerPulseTarget('ready-plot', () => this.plotPulseTarget('ready'));
    // Live board position (T3.3s - the board is movable), read at pulse time.
    // T3.27: the ring is a centred box, so it wants the board's visual centre -
    // the sprite's own y is its GROUND point now and would ring its feet.
    registerPulseTarget('orders-button', () => ({
      x: this.noticeBoardImage.x,
      y: this.structureCenterY(this.noticeBoardImage),
      width: NOTICE_BOARD_PULSE_SIZE,
      height: NOTICE_BOARD_PULSE_SIZE,
      object: this.noticeBoardImage,
    }));
    // Applied once immediately (not just on the periodic tick) so a fresh
    // scene start never shows a flash of interactive board before the
    // tutorial's rails have had a chance to disable it.
    this.applyNoticeBoardRailsGating();
    this.refreshNoticeBoardBadge();
    this.refreshBuildingIndicators(gameState.getState());
    // Same "no flash of interactive before the rails disable it" reasoning as the notice board above.
    this.applyFarmhouseRailsGating();
    this.onboardingGuide = this.inUiLayer(() => new OnboardingGuide(this));
    this.levelUpCelebration = this.inUiLayer(
      () => new LevelUpCelebration(this, this.uiParticles, this.audio),
    );
    this.chestCeremony = this.inUiLayer(
      () => new ChestCeremony(this, this.uiParticles, this.hud, this.audio),
    );
    // World: the sign is a farm structure (a signpost below the field), not a
    // screen control - it pans with the world camera like the notice board.
    // Its tap routes through the shared deferred-tap helper (T3.4c) like the
    // board and farmhouse; ExpandSign just forwards the pointer.
    this.expandSign = new ExpandSign(this, (pointer) =>
      this.handleStructureDown(pointer, () => this.tryExpand()),
    );
    this.expandSignShadow = this.createExpandSignShadow();
    this.refreshExpandSign();
    // Region signs + locked-land dim overlays (T3.3b): world objects that pan
    // with the camera; the sign taps route through the shared deferred-tap
    // helper like the expand sign.
    this.createRegionPresentation();
    this.inUiLayer(() => this.createArrangeControls());
    // The contextual toolbar lives in the WORLD layer (see its own comment) so
    // it tracks the selected asset - built OUTSIDE `inUiLayer`.
    this.createContextualToolbar();
    this.inUiLayer(() => this.createRecenterButton());
    // Seat the camera on HOME explicitly. Phaser starts every camera at zoom 1
    // / scroll (0, 0), which used to BE home by coincidence - now that home is
    // pulled back (CAMERA_HOME_ZOOM_OUT) the boot view has to be set, or the
    // player lands off-home and `updateRecenterButton` shows Recenter on the
    // very first frame of a fresh session.
    this.snapCameraHome();
    this.setupFieldInput();
    this.refreshCrops();
    this.refreshDecorations();
    this.onboardingGuide.refresh(gameState.getState());

    // Drained in update() (T3.20), where it can also fire mid-session on a
    // foreground resume, not just at scene start. It blocks field input like
    // any modal, via the same isModalOpen() gate.
    this.offlineSummaryPanel = this.inUiLayer(() => new OfflineSummaryPanel(this, this.audio));
    // Weekly rollover notice (T3.19): drained in update(), where it defers
    // behind the offline summary (via isModalOpen) and the celebrations.
    this.weeklyNoticePanel = this.inUiLayer(() => new WeeklyNoticePanel(this, this.audio));
    // Plot-grant popup (T3.3a): drained in update() exactly like the weekly
    // notice; Place Now hands off to arrange mode with a shed plot spawned.
    this.plotGrantPopup = this.inUiLayer(
      () => new PlotGrantPopup(this, this.audio, () => this.handlePlaceNow()),
    );

    // Coin arcs are not wired to gameplay until the HUD/sell task; expose a
    // console hook so curved flights can be verified now.
    registerCoinArcTest((n) => this.coinArc.fly(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, n));
    // dev.camera(scrollX, scrollY, zoom) moves the MAIN (world) camera only.
    // It deliberately bypasses the T3.4b gesture clamps (raw camera writes
    // for dev probing); it does kill any in-flight glide first so the tween
    // does not immediately overwrite the requested view.
    registerCameraControl((scrollX = 0, scrollY = 0, zoom = 1) => {
      this.killCameraTween();
      this.cameras.main.setScroll(scrollX, scrollY).setZoom(zoom);
    });
    // T3.4b verification probe: the live camera + gesture state.
    registerCameraStateProbe(() => ({
      scrollX: this.cameras.main.scrollX,
      scrollY: this.cameras.main.scrollY,
      zoom: this.cameras.main.zoom,
      gesture: this.fieldGesture,
      farmingSuppressed: this.farmingSuppressed,
      recenterVisible: this.recenterVisible,
    }));
    registerSceneLayersProbe(() => ({
      root: this.children.list.map((child) => child.type),
      worldChildren: this.worldLayer.list.length,
      uiChildren: this.uiLayer.list.length,
    }));
    registerHitboxToggle((enabled) => this.toggleHitboxDebug(enabled));
    registerGroundModeCycle(() => this.cycleGroundMode());
    registerDressingEditorHooks({
      toggle: (enabled) => this.setDressingEditActive(enabled),
      spawn: (frame) => this.spawnDressingDecal(frame),
      scaleSelected: (delta) => this.scaleSelectedDressing(delta),
      toggleSelectedFront: () => this.toggleSelectedDressingFront(),
      deleteSelected: () => this.deleteSelectedDressing(),
      copyLayoutJson: () => JSON.stringify(this.dressingState, null, 2),
    });
    // T3.3s-r2 dev restrictions overlay - see `toggleDevFootprints`.
    registerFootprintsToggle(() => this.toggleDevFootprints());
    // T3.26 farmhouse angle diagnosis - see `applyFarmhouseDevTransform`.
    registerFarmhouseTransformHooks({
      setRotation: (degrees) => this.setFarmhouseDevRotation(degrees),
      setScale: (mult) => this.setFarmhouseDevScale(mult),
      nudge: (dx, dy) => this.nudgeFarmhouseDev(dx, dy),
      reset: () => this.resetFarmhouseDevTransform(),
    });
  }

  /**
   * T3.4a camera foundation: build the two Layers, the second camera, and
   * the automatic layer routing - MUST run before anything else in
   * `create()` adds a display object.
   *
   * Routing: a scene-events ADDED_TO_SCENE hook moves every object added to
   * the scene's ROOT display list into `routeLayer` - the world layer by
   * default (which also covers all runtime world creation: plot visuals on
   * expand, decoration/shadow rebuilds, ground-mode rebuilds, dressing
   * spawns, and growth of the plot-anchored effect pools), the UI layer
   * inside an `inUiLayer(...)` scope (each UI class's whole construction,
   * containers and pools included). An object that immediately joins a
   * Container merely passes through a layer within the same synchronous
   * tick - no render can happen in between. The two UI classes that create
   * root-level objects lazily at runtime (PooledArc growth, ChestCeremony
   * slots) pin those to the layer recorded at their construction - see
   * their own comments.
   *
   * Layers (unlike Containers) depth-sort their children, so the iso
   * y-depth convention keeps working unchanged inside worldLayer; and since
   * every world depth is < 2000 <= every UI depth, world-then-UI camera
   * order preserves today's global draw order pixel for pixel.
   */
  private createCameraLayers(): void {
    this.worldLayer = this.add.layer();
    this.uiLayer = this.add.layer();
    this.routeLayer = this.worldLayer;
    // Registered only after both layers exist, so the layers themselves are
    // the only two objects that remain on the root display list.
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, this.routeAddedObject, this);
    // Identical geometry to the main camera (both default to the game's
    // 1080x1920 scale size); transparent, renders after (over) main.
    this.uiCamera = this.cameras.add(0, 0, undefined, undefined, false, 'ui');
    this.cameras.main.ignore(this.uiLayer);
    this.uiCamera.ignore(this.worldLayer);
  }

  /**
   * ADDED_TO_SCENE hook (see `createCameraLayers`): route every root
   * display-list add into the current target layer. Adding an object INTO a
   * layer re-emits this same scene event, but with `displayList` already set
   * to that layer - the root check drops those re-fires.
   */
  private routeAddedObject(gameObject: Phaser.GameObjects.GameObject): void {
    // Layer is not a GameObject subclass in Phaser's type definitions (it is
    // at runtime), hence the unknown-cast for this defensive identity check.
    const asUnknown = gameObject as unknown;
    if (asUnknown === this.worldLayer || asUnknown === this.uiLayer) return;
    if (gameObject.displayList !== this.children) return;
    this.routeLayer.add(gameObject);
  }

  /** Run `build` with new display objects routing to the UI layer (see `createCameraLayers`). */
  private inUiLayer<T>(build: () => T): T {
    const previous = this.routeLayer;
    this.routeLayer = this.uiLayer;
    try {
      return build();
    } finally {
      this.routeLayer = previous;
    }
  }

  /**
   * The layer an object ultimately renders in (through its top-most
   * container, if any), or null for an object on the root display list.
   */
  private layerOf(object: Phaser.GameObjects.GameObject): Phaser.GameObjects.Layer | null {
    let root: Phaser.GameObjects.GameObject = object;
    while (root.parentContainer) root = root.parentContainer;
    return root.displayList instanceof Phaser.GameObjects.Layer ? root.displayList : null;
  }

  /**
   * The MAIN camera's world point for a pointer - the field hit-test seam
   * (T3.4a). Deliberately not `pointer.worldX/worldY`: with two cameras
   * Phaser derives those from whichever camera it last hit-tested (the
   * top-most, i.e. the fixed UI camera), which stops matching the field the
   * moment the world camera moves (T3.4b). Equal to pointer.x/y at today's
   * default camera, so behavior cannot change now. Reuses one scratch
   * Vector2 - no allocation on pointer-move.
   */
  private fieldPointerWorld(pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    return this.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerWorldPoint);
  }

  override update(_time: number, delta: number): void {
    // Every frame, ahead of the 250ms refresh gate: three float compares in
    // the common case, so the button appears the instant a gesture (or tween
    // frame) moves the camera off-default rather than up to 250ms late.
    this.updateRecenterButton();
    // Arrange UI (U3b): the contextual toolbar follows the selected/lifted
    // asset (which can move every frame during a lift), and the Undo button /
    // Shed badge track the live undo depth and shed total. Both are cheap and
    // must feel immediate, so they run ahead of the 250ms gate.
    if (this.arrangeModeActive) {
      this.updateContextualToolbar();
      this.updateEditBarState();
    }
    this.refreshAccumulatorMs += delta;
    if (this.refreshAccumulatorMs < CROP_REFRESH_INTERVAL_MS) return;
    this.refreshAccumulatorMs = 0;
    gameState.ensureOrders();
    // Live weekly rollover (T3.19): idempotent and one Date.now() compare
    // when the week has not turned - safe at this cadence.
    gameState.ensureWeeklyQuests();
    this.refreshCrops();
    this.seedBar.refresh();
    this.replantChip.refresh(gameState.getState());
    this.cropCountdown.refresh(gameState.getState());
    this.hud.refresh();
    this.applyNoticeBoardRailsGating();
    this.refreshNoticeBoardBadge();
    this.applyFarmhouseRailsGating();
    this.refreshDecorations();
    // Painted paths (T4.12): a cheap key compare unless a tile was just laid
    // or erased. Sits with the other ground-layer rebuilds.
    this.refreshPaths();
    // Production indicators (T4.2b): re-derived every tick off millSlots, so a
    // batch ripening (even one that finished while the game was closed) shows
    // up here without anything being rebuilt. Runs BEFORE refreshBuildings so
    // it never touches indicators a rebuild is about to destroy.
    this.refreshBuildingIndicators(gameState.getState());
    // Movable structures (T3.3s): re-derive sprite/shadow/badge positions
    // when a saved anchor changed (dev import/reset) - a cheap string
    // compare otherwise, and inert during a live drag by construction.
    this.refreshStructures();
    // Buildings (T4.1): same deal - a `dev.buildMill()` or a dev import shows
    // the new building on the next tick, without a reload.
    this.refreshBuildings();
    // dev.footprints() overlay (T3.3s-r2): re-derive from live state on the
    // same tick so it tracks structure moves and the expansion purchase.
    if (this.devFootprintsEnabled) this.rebuildDevFootprints();
    // Chain placement (T3.3a-r): keep the Place Next button truthful on the
    // tick too - grants and put-aways can change its count mid-arrange.
    if (this.arrangeModeActive) this.updatePlaceNextButton();
    // Onboarding's select-sunwheat step: checked every tick (not just on the
    // tap) so a selection made before the step began still counts. Cheap
    // no-op whenever the step is not active.
    if (this.seedBar.getSelected() === 'sunwheat') {
      gameState.notifyOnboardingUiEvent('select-sunwheat');
    }
    // The review-order read-dwell auto-advance (store-side logic; the scene
    // only provides the tick).
    gameState.autoAdvanceOnboarding();
    this.onboardingGuide.refresh(gameState.getState());
    this.levelUpCelebration.enqueue(gameState.consumeLevelUpEvents());
    if (gameState.consumeTutorialCompleteEvent()) this.levelUpCelebration.enqueueTutorialComplete();
    // Offline summary (T3.20) and weekly rollover notice (T3.19), both
    // deferred behind the celebrations and any open modal. The summary drains
    // first: showing it opens a modal, so the notice check below fails on the
    // same tick, guaranteeing offline summary -> weekly notice -> chests on a
    // resume/load where all three queue up at once. If multiple notices
    // somehow queued, show the first and drop the rest - they cannot stack
    // in practice.
    if (!this.levelUpCelebration.isActive() && !this.chestCeremony.isActive() && !isModalOpen()) {
      const offlineSummary = gameState.consumeOfflineSummary();
      if (offlineSummary !== null) this.offlineSummaryPanel.show(offlineSummary);
    }
    if (!this.levelUpCelebration.isActive() && !this.chestCeremony.isActive() && !isModalOpen()) {
      const notices = gameState.consumeWeeklyNotices();
      if (notices.length > 0) this.weeklyNoticePanel.show(notices[0]!);
    }
    // Plot-grant popup (T3.3a): same deferral as the weekly notice. Unlike
    // it, multiple queued grants merge into one truthful total rather than
    // dropping the extras (dev.grantPlots can queue several between ticks).
    // Also deferred out of arrange mode - a grant landing mid-arrange shows
    // its popup once the player is done arranging.
    if (
      !this.levelUpCelebration.isActive() &&
      !this.chestCeremony.isActive() &&
      !isModalOpen() &&
      !this.arrangeModeActive
    ) {
      const grants = gameState.consumePlotGrantEvents();
      if (grants.length > 0) {
        this.plotGrantPopup.show(grants.reduce((sum, grant) => sum + grant.count, 0));
      }
    }
    // One-time two-finger-pan hint (T3.3b): fires on the grant popup's CLOSE
    // edge after a region purchase, so it never overlaps the popup and shows
    // exactly once (the flag persists). Tracked against the popup's last-tick
    // visibility so it waits for the popup to actually appear then close.
    const grantPopupVisible = this.plotGrantPopup.isVisible();
    if (
      this.pendingTwoFingerHint &&
      this.plotGrantPopupWasVisible &&
      !grantPopupVisible &&
      !isModalOpen() &&
      !gameState.getState().twoFingerHintShown
    ) {
      this.showTwoFingerHint();
      this.pendingTwoFingerHint = false;
    }
    this.plotGrantPopupWasVisible = grantPopupVisible;
    // Edit Layout flash (T3.3a): pulses while plots wait in the shed, paused
    // while the grant popup is up and during arrange mode itself (leaving
    // arrange mode with plots still unplaced resumes it here next tick).
    const flashState = gameState.getState();
    this.hud.setArrangeFlash(
      flashState.onboarding.completed &&
        flashState.unplacedPlots > 0 &&
        !this.plotGrantPopup.isVisible() &&
        !this.arrangeModeActive,
    );
    // Chest events (T2.23a) are deferred behind the level-up celebration: a
    // fulfillment that both levels up and earns a chest must show the level
    // celebration first, chest ceremony after - so while it's active, this
    // simply leaves any earned chests queued in the store (their rewards are
    // already granted; only the show waits) rather than draining them here.
    // Also deferred behind the weekly notice panel (T3.19), so rollover
    // chests ceremony only after the notice is dismissed.
    if (!this.levelUpCelebration.isActive() && !this.weeklyNoticePanel.isVisible()) {
      this.chestCeremony.enqueue(gameState.consumeChestEvents());
    }
    this.refreshExpandSign();
    this.refreshRegionSigns();
    const radiantEvents = gameState.consumeRadiantEvents();
    if (radiantEvents.length > 0) {
      for (const event of radiantEvents) this.playRadiantJuice(event.plotIndex);
      // Once per drained batch, not per event - a multi-proc sweep still buzzes/chimes once.
      buzz(HAPTIC_MEDIUM_MS);
      this.audio.sfx('radiant');
    }
  }

  /**
   * Field input (T3.4b): the scene-level pointer listeners now serve TWO
   * masters, routed by the single classification in `onFieldPointerDown` -
   * the unified FARM gesture (every plot the pointer newly enters, at most
   * once per gesture courtesy of PlotPointerTracker, is offered to harvest
   * first, then to plant - see `beginFarmGesture`/`handlePlotEntered`/
   * `endFarmGesture`, all byte-identical to the pre-T3.4b handlers) and the
   * camera gestures (PAN/PINCH/wheel). A new farm gesture only resets
   * `gestureMode` (which action this sweep has locked to) - it deliberately
   * leaves `pendingReplant` and the chip alone, so a stray tap or a second
   * harvest sweep never kills an offer still accumulating from an earlier one.
   */
  private setupFieldInput(): void {
    // Phaser defaults to mouse + ONE touch pointer; a second simultaneous
    // touch must exist for pinch to be observable at all.
    this.input.addPointer(1);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onFieldPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onFieldPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onFieldPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onFieldPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onFieldWheel, this);
  }

  /**
   * Whether camera gestures (pan/pinch/wheel) may run at all: inert while
   * any modal panel is open, during the tutorial rails, and during the
   * dev-only dressing editor (whose decal drags a pan would fight). Arrange
   * mode is deliberately ACTIVE: a down on a movable object arms the
   * long-press lift (T3.3a-r3, via the currentlyOver rule), dragging
   * empty ground - or swiping off a movable before the hold matures - pans.
   */
  private cameraGesturesAllowed(): boolean {
    return gameState.getState().onboarding.completed && !isModalOpen() && !this.dressingEditActive;
  }

  /** Live count of pressed pointers (mouse + both touch pointers). */
  private downPointerCount(): number {
    let count = 0;
    for (const pointer of this.input.manager.pointers) {
      if (pointer.isDown) count++;
    }
    return count;
  }

  /**
   * Single-finger gesture classification (T3.4b), locked ONCE at the down -
   * a locked gesture never converts on movement (only a second finger
   * converts farm/pan to pinch). See `fieldGesture`'s comment for the modes.
   */
  private onFieldPointerDown(
    pointer: Phaser.Input.Pointer,
    currentlyOver: Phaser.GameObjects.GameObject[],
  ): void {
    if (this.downPointerCount() >= 2) {
      this.maybeStartPinch();
      return;
    }
    // First (only) finger down: a fresh gesture. Every other finger is up,
    // so a pinch suppression left stale by a swallowed release clears here.
    this.farmingSuppressed = false;
    this.gesturePointerId = pointer.id;
    // A structure arm is only honored when IT happened in this same event
    // dispatch (per-object handlers run just before this classifier); an
    // armedStructure surviving from an earlier gesture is a stale leftover
    // of a swallowed release - pointer ids are reused, so without the flag
    // it could masquerade as fresh and fire on this gesture's release.
    const structureArmedNow = this.structureArmedThisDown;
    this.structureArmedThisDown = false;
    if (!structureArmedNow) this.armedStructure = null;
    if (!this.cameraGesturesAllowed()) {
      // Legacy path, byte-identical to pre-T3.4b behavior: the tutorial's
      // taps/sweeps, and downs while a modal is open (handlePlotEntered's
      // own gates make those no-ops exactly as before). Structures fired
      // instantly on down in handleStructureDown for the same reason.
      this.fieldGesture = 'farm';
      this.beginFarmGesture(pointer);
      return;
    }
    if (structureArmedNow && this.armedStructure?.pointerId === pointer.id) {
      this.fieldGesture = 'structure-armed';
      return;
    }
    if (currentlyOver.length > 0) {
      // Arrange mode (T3.3a-r3): a down on a movable object (decor sprite
      // or plot tile) arms a deliberate long-press lift instead of lifting
      // instantly - a swipe that merely STARTS on one must pan.
      const movable = this.arrangeModeActive ? this.movableLiftTarget(currentlyOver) : null;
      if (movable !== null) {
        // The SELECTED piece lifts instantly (T3.3a-r3c, supersedes the
        // post-drop grace window): selection is the player's explicit "I'm
        // working with this piece", so a down on it goes straight to 'lift'
        // - same cue, no hold. Deliberate tradeoff (owner decision): a
        // pan-swipe starting on the selected piece moves the piece instead
        // of panning for as long as it stays selected; every UNselected
        // piece keeps hold-to-lift pan safety.
        if (this.isSelectedMovable(movable)) {
          const world = this.fieldPointerWorld(pointer);
          if (
            this.startLift(
              movable.kind,
              movable.target,
              movable.target.x - world.x,
              movable.target.y - world.y,
              movable.structureId,
            )
          ) {
            return;
          }
          // A selected target that can no longer lift (stale selection -
          // despawned decor, non-empty plot) falls through to the normal
          // hold arm, exactly as the stale-grace case did.
        }
        this.fieldGesture = 'lift-pending';
        this.beginPendingLift(pointer, movable.kind, movable.target, movable.structureId);
        return;
      }
      // Not ours: badges, panels, and every button keep their own
      // per-object input unchanged.
      this.fieldGesture = 'object';
      return;
    }
    const world = this.fieldPointerWorld(pointer);
    if (this.pathModeActive()) {
      // Paint mode (T4.12) owns every ONE-finger gesture on the field band -
      // two fingers still pinch (handled at the top of this method), and the
      // HUD's own buttons were already claimed by the currentlyOver branch
      // above. Unlike a farm gesture the down is NOT armed and deferred: a
      // painted tile is instantly undoable with Erase, so there is nothing
      // to protect the way a mistaken harvest needs protecting. Outside the
      // pan band (banner, the paint bar's own row at y 1700) nothing paints,
      // so the HUD can never be painted through.
      if (pointer.y > PAN_BAND_TOP_Y && pointer.y < PAN_BAND_BOTTOM_Y) {
        this.fieldGesture = 'paint';
        this.pathGestureVisited.clear();
        this.pathLastCell = null;
        this.paintPathAt(world.x, world.y);
      } else {
        this.fieldGesture = 'idle';
      }
      return;
    }
    const plotIndex = plotIndexAtScreen(world.x, world.y, gameState.getState().plots);
    if (!this.arrangeModeActive && plotIndex !== null && this.plotActionable(plotIndex)) {
      // T3.4c: ARM the plot, do not process it - a pinch's first finger
      // landing on a ready crop must zoom, never harvest. Confirmation
      // happens on first movement past TAP_SLOP or at release.
      this.fieldGesture = 'farm-pending';
      this.gestureMode = null;
      this.armedFarmDownX = pointer.x;
      this.armedFarmDownY = pointer.y;
      this.armedFarmWorldX = world.x;
      this.armedFarmWorldY = world.y;
      return;
    }
    if (pointer.y > PAN_BAND_TOP_Y && pointer.y < PAN_BAND_BOTTOM_Y) {
      // A tap (pan that never moves) on a growing plot must still show the
      // countdown, exactly as the legacy down did.
      this.maybeShowCountdown(plotIndex);
      this.fieldGesture = 'pan';
      this.beginPan(pointer);
      return;
    }
    this.fieldGesture = 'idle';
  }

  /** The legacy field-gesture down, byte-identical to the pre-T3.4b handler. */
  private beginFarmGesture(pointer: Phaser.Input.Pointer): void {
    this.gestureMode = null;
    const world = this.fieldPointerWorld(pointer);
    const plotIndex = this.plotTracker.begin(world.x, world.y, gameState.getState().plots);
    this.maybeShowCountdown(plotIndex);
    this.handlePlotEntered(plotIndex);
  }

  /**
   * Shared deferred-tap-down for the world structures (notice board,
   * farmhouse, expand sign - and any future building): while camera
   * gestures are inert the action fires instantly on down, byte-identical
   * to pre-T3.4c behavior (the tutorial's notice-board step depends on it);
   * otherwise the down only ARMS the tap - `fire` runs on an in-slop
   * release, movement past TAP_SLOP converts to a re-anchored pan, and a
   * second finger converts to pinch (see `maybeStartPinch`), so a gesture
   * merely STARTING on a building can never open its menu.
   */
  private handleStructureDown(pointer: Phaser.Input.Pointer, fire: () => void): void {
    // Arrange mode (T3.3s): structure taps SELECT, never open - the scene
    // classifier's lift path owns the whole gesture (the farmhouse/notice
    // board stay interactive through the mode purely to be hit-testable),
    // so the deferred tap must neither fire nor arm here.
    if (this.arrangeModeActive) return;
    if (!this.cameraGesturesAllowed()) {
      fire();
      return;
    }
    // A second finger landing on a structure belongs to the pinch
    // conversion, never a new arm (which the release could then fire).
    if (this.downPointerCount() >= 2) return;
    this.armedStructure = { pointerId: pointer.id, downX: pointer.x, downY: pointer.y, fire };
    this.structureArmedThisDown = true;
  }

  /**
   * Confirm a 'farm-pending' arm into a live sweep (T3.4c): process the
   * armed plot exactly as the pre-deferral pointer-down did - through
   * plotTracker.begin at the down's world point, so the per-gesture dedup
   * and every store-side rule behave identically, just later.
   */
  private confirmArmedPlot(): void {
    const plotIndex = this.plotTracker.begin(
      this.armedFarmWorldX,
      this.armedFarmWorldY,
      gameState.getState().plots,
    );
    this.handlePlotEntered(plotIndex);
  }

  /**
   * Whether a down on this plot starts a FARM sweep: harvest-ready, or empty
   * with a seed selected - mirrors the two success paths of
   * `handlePlotEntered` (whose store calls stay the sole rule authority; a
   * mismatch here just classifies a fruitless sweep or a pan).
   */
  private plotActionable(plotIndex: number): boolean {
    const plot = gameState.getState().plots[plotIndex];
    if (plot === undefined) return false;
    if (plot.state === 'growing') return isReady(plot, now());
    return plot.state === 'empty' && this.seedBar.getSelected() !== null;
  }

  // -- ARRANGE LIFT (T3.3a-r3) -----------------------------------------------

  /**
   * The topmost movable arrange object under the down, or null - the hit
   * list arrives topmost-first, so the first decor sprite, plot tile, or
   * movable structure (T3.3s: farmhouse/notice board) in it is the one the
   * finger visually landed on.
   */
  private movableLiftTarget(currentlyOver: readonly Phaser.GameObjects.GameObject[]): {
    kind: 'decor' | 'plot' | 'structure';
    target: Phaser.GameObjects.Image;
    structureId?: MovableAnchorRef;
  } | null {
    for (const object of currentlyOver) {
      const image = object as Phaser.GameObjects.Image;
      if (this.decorationSprites.includes(image)) return { kind: 'decor', target: image };
      if (this.plotTileSprites.includes(image)) return { kind: 'plot', target: image };
      if (image === this.farmhouseImage) {
        return { kind: 'structure', target: image, structureId: FARMHOUSE_REF };
      }
      if (image === this.noticeBoardImage) {
        return { kind: 'structure', target: image, structureId: NOTICE_BOARD_REF };
      }
      // Buildings share the 'structure' lift kind (T4.1) - identical
      // anchor/footprint/snap machinery, so the classifier needs no new case.
      const buildingIndex = this.buildingImages.indexOf(image);
      if (buildingIndex !== -1) {
        return {
          kind: 'structure',
          target: image,
          structureId: { kind: 'building', index: buildingIndex },
        };
      }
    }
    return null;
  }

  /**
   * Whether `movable` is the CURRENTLY SELECTED piece (T3.3a-r3c) - the
   * decoration at `selectedDecorationIndex` or the plot tile at
   * `selectedPlotIndex`. Compared by sprite reference, the
   * decoration-sprite pattern (indices shift when a decoration is stored).
   */
  private isSelectedMovable(movable: {
    kind: 'decor' | 'plot' | 'structure';
    target: Phaser.GameObjects.Image;
    structureId?: MovableAnchorRef;
  }): boolean {
    if (movable.kind === 'decor') {
      return (
        this.selectedDecorationIndex !== null &&
        this.decorationSprites[this.selectedDecorationIndex] === movable.target
      );
    }
    if (movable.kind === 'structure') {
      return (
        movable.structureId !== undefined &&
        sameMovableRef(this.selectedStructureId, movable.structureId)
      );
    }
    return (
      this.selectedPlotIndex !== null &&
      this.plotTileSprites[this.selectedPlotIndex] === movable.target
    );
  }

  /**
   * Arm a long-press lift (T3.3a-r3): nothing user-visible happens at the
   * down. The scene-clock timer maturing while the pointer is still within
   * TAP_SLOP is the only path that lifts a PENDING arm (`fireHoldLift`);
   * every other resolution - slop movement (pan), a second finger (pinch),
   * an in-slop release (tap-select) - cancels the timer first. (A down on
   * the currently SELECTED piece never arms at all - it classifies 'lift'
   * directly in the classifier, T3.3a-r3c.)
   */
  private beginPendingLift(
    pointer: Phaser.Input.Pointer,
    kind: 'decor' | 'plot' | 'structure',
    target: Phaser.GameObjects.Image,
    structureId?: MovableAnchorRef,
  ): void {
    const world = this.fieldPointerWorld(pointer);
    this.pendingLift = {
      pointer,
      kind,
      target,
      structureId,
      downX: pointer.x,
      downY: pointer.y,
      grabOffsetX: target.x - world.x,
      // T3.27: no space conversion any more. A base-anchored sprite's position
      // IS its ground point for both looks, so the free-follow position, the
      // grid inverse-mapping, the footprint preview and the snap all already
      // share one coordinate system - which is what T3.25's nominal-space
      // add/subtract was faking.
      grabOffsetY: target.y - world.y,
      timer: this.time.delayedCall(HOLD_MS, () => this.fireHoldLift()),
    };
  }

  /** Discard the pending lift and its hold timer (no-op when none is armed). */
  private cancelPendingLift(): void {
    if (this.pendingLift === null) return;
    this.pendingLift.timer.remove(false);
    this.pendingLift = null;
  }

  /**
   * Ignite an active lift on `target` (T3.3a-r3b split this out of
   * `fireHoldLift`; the selected-piece instant lift shares it, T3.3a-r3c):
   * selection first (byte-identical to the old instant path's down), then
   * the pulse + buzz cue, and the gesture becomes 'lift'. Returns false
   * with NO side effects when the target no longer qualifies (despawned
   * decoration, missing or non-empty plot) - callers decide the fallback.
   */
  private startLift(
    kind: 'decor' | 'plot' | 'structure',
    target: Phaser.GameObjects.Image,
    grabOffsetX: number,
    grabOffsetY: number,
    structureId?: MovableAnchorRef,
  ): boolean {
    if (kind === 'plot') {
      const plotIndex = this.plotTileSprites.indexOf(target);
      const plot = plotIndex === -1 ? undefined : gameState.getState().plots[plotIndex];
      if (plot === undefined || plot.state !== 'empty') return false;
      this.setPlotSelection(plotIndex);
      this.plotDragIndex = plotIndex;
      this.plotDragCol = plot.col;
      this.plotDragRow = plot.row;
      // Lifted plots leave the flat ground sub-layer (T3.3b-r3): elevated
      // above every standing object for the drag's duration, or the tile
      // would tuck under any crop/decor/structure it crosses.
      target.setDepth(PLOT_LIFT_DEPTH);
    } else if (kind === 'structure') {
      // Structures are always liftable in arrange mode (T3.3s) - move only,
      // no locked state; the nearest-anchor tracker starts at the saved
      // anchor (the sprite has not moved yet).
      if (structureId === undefined) return false;
      const anchor = this.movableAnchor(structureId);
      // T4.1: a stale building ref (the list changed under the lift) has no
      // anchor - refuse the lift rather than drag a sprite with no state.
      if (anchor === null) return false;
      this.setStructureSelection(structureId);
      this.structureDragId = structureId;
      this.structureDragCol = anchor.col;
      this.structureDragRow = anchor.row;
      // The badge follows the free-form drag directly (T3.3s-r2); its
      // absolute-y bounce tween would fight that, so it dies for the
      // lift's duration - the commit's placeNoticeBoardBadge rebuilds it.
      if (structureId.kind === 'structure' && structureId.id === 'noticeBoard') {
        this.noticeBoardBadgeTween?.remove();
        this.noticeBoardBadgeTween = null;
      }
      this.rebuildStructureFootprintPreview(structureId);
    } else {
      const index = this.decorationSprites.indexOf(target);
      if (index === -1) return false;
      this.setDecorationSelection(index);
    }
    // Grid-snapped lifts (plot/structure) get the faint placement grid
    // (T3.3s-r2 change 5); free-form decor/fence lifts deliberately do not.
    if (kind !== 'decor') this.showPlacementGrid();
    this.activeLift = { kind, target, grabOffsetX, grabOffsetY };
    this.fieldGesture = 'lift';
    this.playLiftPulse(target);
    this.buzzOnLift();
    return true;
  }

  /**
   * The hold timer matured (T3.3a-r3): the pointer stayed within slop for
   * HOLD_MS, so the press is deliberate. A decoration or an EMPTY plot
   * lifts (`startLift`). A growing plot refuses with the locked-plot
   * wiggle and the REST of the gesture pans (`movePlot` only ever allows
   * EMPTY). Every bail path fully resolves the gesture - 'lift-pending'
   * never outlives its timer.
   */
  private fireHoldLift(): void {
    const pending = this.pendingLift;
    if (pending === null || this.fieldGesture !== 'lift-pending') return;
    this.pendingLift = null;
    if (!pending.pointer.isDown || !this.arrangeModeActive || !this.cameraGesturesAllowed()) {
      this.fieldGesture = null;
      this.gesturePointerId = -1;
      return;
    }
    if (pending.kind === 'plot') {
      const plotIndex = this.plotTileSprites.indexOf(pending.target);
      const plot = plotIndex === -1 ? undefined : gameState.getState().plots[plotIndex];
      if (plot !== undefined && plot.state !== 'empty') {
        // Locked: wiggle refusal, and the remainder of the gesture pans -
        // re-anchored at the pointer's current position, so no jump.
        this.shakeLockedPlot(pending.target);
        this.fieldGesture = 'pan';
        this.beginPan(pending.pointer);
        return;
      }
    }
    if (
      !this.startLift(
        pending.kind,
        pending.target,
        pending.grabOffsetX,
        pending.grabOffsetY,
        pending.structureId,
      )
    ) {
      this.fieldGesture = null;
      this.gesturePointerId = -1;
    }
  }

  /**
   * Live lift follow (T3.3a-r3): the object's would-be free-form position
   * is the pointer's world point plus the grab offset - exactly the
   * dragX/dragY Phaser's drag plugin fed the pre-hold handlers. Decorations
   * move free-form (y-depth and ground shadow re-derived every frame, as
   * the old 'drag' handler did); plots never move free-form - the free
   * position only feeds the live grid snap (`updatePlotDragSnap`).
   */
  private updateLiftDrag(pointer: Phaser.Input.Pointer): void {
    const lift = this.activeLift;
    if (lift === null) return;
    const world = this.fieldPointerWorld(pointer);
    const freeX = world.x + lift.grabOffsetX;
    const freeY = world.y + lift.grabOffsetY;
    if (lift.kind === 'decor') {
      const index = this.decorationSprites.indexOf(lift.target);
      // Fence chain snap (T3.3a2): near a placed fence the lifted fence
      // previews at the snapped continuation; elsewhere it follows the
      // finger. Release commits whatever position is showing, exactly like
      // the plot-tile pattern.
      const snapped = index === -1 ? null : this.fenceSnapPosition(index, freeX, freeY);
      const x = snapped === null ? freeX : snapped.x;
      const y = snapped === null ? freeY : snapped.y;
      lift.target.setPosition(x, y).setDepth(y);
      const shadow = index === -1 ? undefined : this.decorationShadowSprites[index];
      if (shadow) this.applyGroundShadowGeometry(shadow, lift.target);
    } else if (lift.kind === 'structure') {
      // Structures follow the finger FREE-FORM (T3.3s-r2 feel fix) - no
      // more mid-drag anchor snapping; the sprite (+ shadow, + the board's
      // badge) moves like a decoration, while the live green/red footprint
      // for the NEAREST anchor (free position minus the fixed render
      // offset) explains legality underneath. The release commits to the
      // nearest LEGAL anchor within STRUCTURE_SNAP_RADIUS - see
      // `commitStructureDrag`.
      const id = this.structureDragId;
      if (id !== null) {
        this.moveStructureSpriteFree(id, freeX, freeY);
        // The preview's depth no longer tracks the structure (T3.3b-r2): it
        // is the flat FOOTPRINT_PREVIEW_DEPTH, above every field object the
        // drag can cross, so nothing here has to follow the move.
        const offset = this.movableRenderOffset(id);
        const grid = isoToGrid(freeX - offset.x, freeY - offset.y);
        const col = Math.round(grid.col);
        const row = Math.round(grid.row);
        if (col !== this.structureDragCol || row !== this.structureDragRow) {
          this.structureDragCol = col;
          this.structureDragRow = row;
          this.rebuildStructureFootprintPreview(id);
        }
      }
    } else {
      const { col, row } = isoToGrid(freeX, freeY);
      this.updatePlotDragSnap(Math.round(col), Math.round(row));
    }
  }

  /**
   * Live fence snap (T3.3a2, plot edges added in T3.3a2-r1): the snapped
   * anchor for the lifted fence at placement `index`, or null when the
   * lifted piece is not a fence or no candidate is within
   * FENCE_SNAP_RADIUS of the free-form position. One nearest-wins pool of
   * candidates:
   * - every placed fence's flip-aware continuation offsets
   *   (`fenceSnapDeltas` - same-facing line steps plus the opposite-facing
   *   shared-post corners), and
   * - every placed plot's two flip-compatible tile-edge positions
   *   (`fenceEdgeSnapDeltas`, T3.3a2-r1 - rail exactly along the diamond
   *   edge, high post standing on its upper corner; any plot state,
   *   outlining does not care what's planted).
   * All candidates are rounded to integers so the preview matches
   * `commitDecorationTransform`'s rounded commit exactly, and filtered to
   * the store's x/y clamp range so a committed snap never shifts off its
   * previewed spot. State is read for frames/flips and the NEIGHBORS'
   * positions only - the lifted piece's own stale state position is never
   * used.
   */
  private fenceSnapPosition(
    index: number,
    freeX: number,
    freeY: number,
  ): { x: number; y: number } | null {
    const decorations = gameState.getState().decorations;
    const lifted = decorations[index];
    if (lifted === undefined || lifted.frame !== FENCE_FRAME) return null;
    // Region-aware clamp bounds (T3.3b) so a fence in an unlocked band can
    // snap to its plots/fences instead of being filtered out at the base edge.
    const clamp = decorClampBounds(gameState.getState().regionsUnlocked);
    let bestX = 0;
    let bestY = 0;
    let bestDistSq = FENCE_SNAP_RADIUS * FENCE_SNAP_RADIUS;
    let found = false;
    const consider = (rawX: number, rawY: number): void => {
      const candidateX = Math.round(rawX);
      const candidateY = Math.round(rawY);
      if (candidateX < clamp.minX || candidateX > clamp.maxX) return;
      if (candidateY < clamp.minY || candidateY > clamp.maxY) return;
      const distSq = (candidateX - freeX) ** 2 + (candidateY - freeY) ** 2;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        bestX = candidateX;
        bestY = candidateY;
        found = true;
      }
    };
    for (let i = 0; i < decorations.length; i++) {
      const neighbor = decorations[i];
      if (i === index || neighbor === undefined || neighbor.frame !== FENCE_FRAME) continue;
      for (const [dx, dy] of fenceSnapDeltas(neighbor.flip, lifted.flip)) {
        consider(neighbor.x + dx, neighbor.y + dy);
      }
    }
    const edgeDeltas = fenceEdgeSnapDeltas(lifted.flip, TILE_WIDTH, TILE_HEIGHT);
    for (const plot of gameState.getState().plots) {
      const center = gridToIso(plot.col, plot.row);
      for (const [dx, dy] of edgeDeltas) {
        consider(center.x + dx, center.y + dy);
      }
    }
    return found ? { x: bestX, y: bestY } : null;
  }

  /**
   * Release of an active lift (T3.3a-r3): settle the pulse FIRST (an early
   * release can land mid-pulse, and `commitDecorationTransform` reads the
   * sprite's live scale), then commit exactly as the pre-hold 'dragend'
   * handlers did - `setDecorationTransform`/`movePlot` stay the sole rule
   * authorities, and a refused commit snaps back from committed state.
   * The dropped piece stays SELECTED, so it regrabs instantly for as long
   * as it holds the selection (T3.3a-r3c, supersedes the post-drop grace
   * window).
   */
  private finishLift(): void {
    const lift = this.activeLift;
    this.activeLift = null;
    this.settleLiftPulse();
    // The faint placement grid lives exactly as long as the lift (T3.3s-r2
    // change 5) - a no-op for decor lifts, which never showed one.
    this.hidePlacementGrid();
    if (lift === null) return;
    if (lift.kind === 'decor') {
      if (!this.arrangeModeActive) return;
      const index = this.decorationSprites.indexOf(lift.target);
      if (index !== -1) this.commitDecorationTransform(index, lift.target);
    } else if (lift.kind === 'structure') {
      if (this.structureDragId !== null) this.commitStructureDrag();
    } else if (this.plotDragIndex !== null) {
      this.commitPlotDrag();
    }
  }

  /**
   * In-slop release before the hold fired (T3.3a-r3): a tap, byte-for-byte
   * the old per-object pointer-down behavior - a decoration selects, an
   * empty plot selects, a growing plot answers with the locked-plot shake
   * and no selection change.
   */
  private resolveLiftTap(
    kind: 'decor' | 'plot' | 'structure',
    target: Phaser.GameObjects.Image,
    structureId?: MovableAnchorRef,
  ): void {
    if (kind === 'decor') {
      const index = this.decorationSprites.indexOf(target);
      if (index !== -1) this.setDecorationSelection(index);
      return;
    }
    if (kind === 'structure') {
      // Arrange-mode structure taps SELECT (T3.3s) - never open the shop or
      // the order board; those stay outside-arrange behavior.
      if (structureId !== undefined) this.setStructureSelection(structureId);
      return;
    }
    const plotIndex = this.plotTileSprites.indexOf(target);
    if (plotIndex === -1) return;
    const plot = gameState.getState().plots[plotIndex];
    if (plot === undefined) return;
    if (plot.state === 'growing') {
      this.shakeLockedPlot(target);
      return;
    }
    this.setPlotSelection(plotIndex);
  }

  /**
   * Visual lift cue (T3.3a-r3): a quick scale pulse up to LIFT_PULSE_SCALE
   * and back. `liftPulse` records the pre-pulse scale so `settleLiftPulse`
   * can restore it exactly whenever the lift ends before the tween does.
   */
  private playLiftPulse(target: Phaser.GameObjects.Image): void {
    this.settleLiftPulse();
    this.liftPulse = { target, scaleX: target.scaleX, scaleY: target.scaleY };
    this.tweens.add({
      targets: target,
      scaleX: target.scaleX * LIFT_PULSE_SCALE,
      scaleY: target.scaleY * LIFT_PULSE_SCALE,
      duration: LIFT_PULSE_MS,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => this.settleLiftPulse(),
    });
  }

  /** Stop the pulse (if still running) and restore the exact pre-pulse scale. */
  private settleLiftPulse(): void {
    const pulse = this.liftPulse;
    if (pulse === null) return;
    this.liftPulse = null;
    this.tweens.killTweensOf(pulse.target);
    pulse.target.setScale(pulse.scaleX, pulse.scaleY);
  }

  /**
   * Haptic half of the lift cue: a short buzz where the platform supports
   * it (iOS Safari has no navigator.vibrate - the scale pulse is the
   * universal cue there).
   */
  private buzzOnLift(): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(LIFT_VIBRATE_MS);
    }
  }

  private onFieldPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.fieldGesture === 'pinch') {
      this.updatePinch();
      return;
    }
    if (!pointer.isDown || pointer.id !== this.gesturePointerId) return;
    if (this.fieldGesture === 'pan') {
      // A modal opening mid-pan ends the pan (same self-heal convention as
      // SeedBar's strip drag); no momentum - the finger did not release.
      if (!this.cameraGesturesAllowed()) {
        this.finishPan(false);
        this.fieldGesture = null;
        this.gesturePointerId = -1;
        return;
      }
      this.updatePan(pointer);
      return;
    }
    if (this.fieldGesture === 'farm-pending') {
      // A modal popping mid-arm (offline summary on the refresh tick, ...)
      // quietly discards the arm - nothing has fired yet, nothing should.
      if (!this.cameraGesturesAllowed()) {
        this.fieldGesture = null;
        this.gesturePointerId = -1;
        return;
      }
      if (Math.hypot(pointer.x - this.armedFarmDownX, pointer.y - this.armedFarmDownY) > TAP_SLOP) {
        // First real movement: confirm into a live sweep - the armed plot
        // processes now, then this very move continues it, so sweep feel
        // is identical to the old instant-on-down path.
        this.fieldGesture = 'farm';
        this.confirmArmedPlot();
        const world = this.fieldPointerWorld(pointer);
        this.handlePlotEntered(this.plotTracker.move(world.x, world.y, gameState.getState().plots));
      }
      return;
    }
    if (this.fieldGesture === 'lift-pending') {
      const pending = this.pendingLift;
      // A modal popping mid-hold quietly discards the arm, like
      // 'farm-pending'.
      if (pending === null || !this.arrangeModeActive || !this.cameraGesturesAllowed()) {
        this.cancelPendingLift();
        this.fieldGesture = null;
        this.gesturePointerId = -1;
        return;
      }
      if (Math.hypot(pointer.x - pending.downX, pointer.y - pending.downY) > TAP_SLOP) {
        // The gesture proved itself a swipe before the hold matured: the
        // object never moves, and the pan re-anchors at the pointer's
        // CURRENT position (beginPan records it) - the critical case.
        this.cancelPendingLift();
        this.fieldGesture = 'pan';
        this.beginPan(pointer);
      }
      return;
    }
    if (this.fieldGesture === 'lift') {
      // Arrange mode ending mid-lift (a second finger on Done) already
      // nulled the drag state in exitArrangeMode - just drop the gesture.
      if (!this.arrangeModeActive) {
        this.activeLift = null;
        this.fieldGesture = null;
        this.gesturePointerId = -1;
        return;
      }
      this.updateLiftDrag(pointer);
      return;
    }
    if (this.fieldGesture === 'structure-armed') {
      const armed = this.armedStructure;
      if (armed === null || !this.cameraGesturesAllowed()) {
        this.armedStructure = null;
        this.fieldGesture = null;
        this.gesturePointerId = -1;
        return;
      }
      if (Math.hypot(pointer.x - armed.downX, pointer.y - armed.downY) > TAP_SLOP) {
        // The gesture proved itself a drag: the building never opens, and
        // the pan re-anchors at the pointer's CURRENT position (beginPan
        // records it), so the camera does not jump by the slop distance.
        this.armedStructure = null;
        this.fieldGesture = 'pan';
        this.beginPan(pointer);
      }
      return;
    }
    if (this.fieldGesture === 'paint' && !this.farmingSuppressed) {
      // The paint run (T4.12): each move paints the tile under the finger,
      // deduped per gesture inside `paintPathAt`. `farmingSuppressed` is
      // shared with farming deliberately - a gesture that became a pinch must
      // stop painting for the same reason it stops harvesting.
      const world = this.fieldPointerWorld(pointer);
      this.paintPathAt(world.x, world.y);
      return;
    }
    if (this.fieldGesture === 'farm' && !this.farmingSuppressed) {
      const world = this.fieldPointerWorld(pointer);
      this.handlePlotEntered(this.plotTracker.move(world.x, world.y, gameState.getState().plots));
    }
  }

  private onFieldPointerUp(pointer: Phaser.Input.Pointer): void {
    // Pointers still down AFTER this release (defensive about whether the
    // manager has flipped this pointer's isDown yet at dispatch time).
    let remaining = 0;
    for (const p of this.input.manager.pointers) {
      if (p.isDown && p !== pointer) remaining++;
    }
    if (this.fieldGesture === 'pinch') {
      this.pinchPointerA = null;
      this.pinchPointerB = null;
      const survivor = this.firstDownPointerExcept(pointer);
      if (survivor !== null) {
        // One finger of the pinch lifted: continue as a re-anchored pan with
        // the survivor. Farming stays suppressed until EVERY finger lifts.
        this.fieldGesture = 'pan';
        this.gesturePointerId = survivor.id;
        this.beginPan(survivor);
      } else {
        this.fieldGesture = null;
        this.gesturePointerId = -1;
        this.farmingSuppressed = false;
        // Scroll is hard-clamped live during pinch; this only snaps float dust.
        this.finishPan(false);
      }
      return;
    }
    if (pointer.id === this.gesturePointerId) {
      // Gesture state resets BEFORE the branch actions run: none of them
      // read it, and a user-action callback that throws (seen live on a
      // half-loaded page with its audio missing) must not leave a phantom
      // gesture armed.
      const gesture = this.fieldGesture;
      this.fieldGesture = null;
      this.gesturePointerId = -1;
      if (gesture === 'farm') {
        this.endFarmGesture();
      } else if (gesture === 'farm-pending') {
        // A tap: the armed plot processes at release (full juice fires now,
        // imperceptibly later than the old on-down timing), then the
        // gesture ends exactly like a one-plot sweep.
        this.confirmArmedPlot();
        this.endFarmGesture();
      } else if (gesture === 'paint') {
        // The run ends; the next gesture starts with a clean visited set so
        // re-crossing a tile in a NEW stroke paints (or erases) it again.
        this.pathGestureVisited.clear();
        this.pathLastCell = null;
      } else if (gesture === 'pan') {
        this.finishPan(true);
      } else if (gesture === 'lift-pending') {
        const pending = this.pendingLift;
        this.cancelPendingLift();
        // In-slop release before the hold fired: the tap - selection and
        // arrange controls exactly as the old instant path. Re-checked
        // against the gates in case a modal popped while armed.
        if (
          pending !== null &&
          this.arrangeModeActive &&
          this.cameraGesturesAllowed() &&
          Math.hypot(pointer.x - pending.downX, pointer.y - pending.downY) <= TAP_SLOP
        ) {
          this.resolveLiftTap(pending.kind, pending.target, pending.structureId);
        }
      } else if (gesture === 'lift') {
        this.finishLift();
      } else if (gesture === 'structure-armed') {
        const armed = this.armedStructure;
        this.armedStructure = null;
        // In-slop release with no conversion: the tap fires its structure's
        // open action (each action plays its own usual sfx). Re-checked
        // against the gates in case a modal popped while armed.
        if (
          armed !== null &&
          this.cameraGesturesAllowed() &&
          Math.hypot(pointer.x - armed.downX, pointer.y - armed.downY) <= TAP_SLOP
        ) {
          armed.fire();
        }
      }
    }
    if (remaining === 0) this.farmingSuppressed = false;
  }

  /** The legacy field-gesture end, byte-identical to the pre-T3.4b handler. */
  private endFarmGesture(): void {
    this.plotTracker.end();
    if (
      this.gestureMode === 'harvest' &&
      this.pendingReplant.length > 0 &&
      gameState.getState().onboarding.completed
    ) {
      // Show (or re-show) with the FULL accumulated list - the TTL restarts
      // from this, the most recent harvest, not from the first one.
      this.replantChip.show([...this.pendingReplant]);
    }
    this.gestureMode = null;
  }

  /** The first pressed pointer other than `except`, or null - the pinch survivor. */
  private firstDownPointerExcept(except: Phaser.Input.Pointer): Phaser.Input.Pointer | null {
    for (const pointer of this.input.manager.pointers) {
      if (pointer.isDown && pointer !== except) return pointer;
    }
    return null;
  }

  // -- PAN ------------------------------------------------------------------

  private beginPan(pointer: Phaser.Input.Pointer): void {
    this.killCameraTween();
    const camera = this.cameras.main;
    this.panStartScrollX = camera.scrollX;
    this.panStartScrollY = camera.scrollY;
    this.panStartPointerX = pointer.x;
    this.panStartPointerY = pointer.y;
    this.panSampleCount = 0;
    this.pushPanSample(pointer);
  }

  /**
   * Live pan: 1:1 in design px divided by zoom - the world point under the
   * finger stays under the finger - rubber-banded softly past the scroll
   * range (snap-back on release, see `finishPan`).
   */
  private updatePan(pointer: Phaser.Input.Pointer): void {
    const camera = this.cameras.main;
    const viewport = this.cameraViewport();
    const zoom = camera.zoom;
    const desiredX = this.panStartScrollX + (this.panStartPointerX - pointer.x) / zoom;
    const desiredY = this.panStartScrollY + (this.panStartPointerY - pointer.y) / zoom;
    const range = scrollRange(zoom, CAMERA_WORLD_BOUNDS, viewport);
    camera.setScroll(
      rubberBand(desiredX, range.minX, range.maxX, PAN_RUBBER_BAND_GIVE),
      rubberBand(desiredY, range.minY, range.maxY, PAN_RUBBER_BAND_GIVE),
    );
    this.pushPanSample(pointer);
  }

  private pushPanSample(pointer: Phaser.Input.Pointer): void {
    const slot = this.panSampleCount % PAN_SAMPLE_CAPACITY;
    this.panSampleX[slot] = pointer.x;
    this.panSampleY[slot] = pointer.y;
    this.panSampleT[slot] = this.time.now;
    this.panSampleCount++;
  }

  /**
   * End a pan: one Sine.easeOut tween to the hard-clamped momentum target
   * covers both the edge snap-back (rubber-band overshoot returns to the
   * clamped range) and the short damped glide (`withMomentum` - false when
   * the pan was cut short rather than released).
   */
  private finishPan(withMomentum: boolean): void {
    const camera = this.cameras.main;
    const viewport = this.cameraViewport();
    let targetX = camera.scrollX;
    let targetY = camera.scrollY;
    if (withMomentum && this.panSampleCount >= 2) {
      const newest = (this.panSampleCount - 1) % PAN_SAMPLE_CAPACITY;
      const newestT = this.panSampleT[newest]!;
      // Oldest retained sample still inside the velocity window.
      const available = Math.min(this.panSampleCount, PAN_SAMPLE_CAPACITY);
      let oldest = newest;
      for (let back = 1; back < available; back++) {
        const slot = (this.panSampleCount - 1 - back + PAN_SAMPLE_CAPACITY) % PAN_SAMPLE_CAPACITY;
        if (newestT - this.panSampleT[slot]! > PAN_VELOCITY_WINDOW_MS) break;
        oldest = slot;
      }
      const dt = newestT - this.panSampleT[oldest]!;
      if (dt > 1) {
        // Screen-space velocity (px/ms) -> world px via zoom; the camera
        // moves opposite the finger, hence the subtraction.
        const vx = (this.panSampleX[newest]! - this.panSampleX[oldest]!) / dt;
        const vy = (this.panSampleY[newest]! - this.panSampleY[oldest]!) / dt;
        targetX -= (vx / camera.zoom) * PAN_MOMENTUM_DISTANCE_MS;
        targetY -= (vy / camera.zoom) * PAN_MOMENTUM_DISTANCE_MS;
      }
    }
    const clamped = clampScroll(targetX, targetY, camera.zoom, CAMERA_WORLD_BOUNDS, viewport);
    this.glideCameraTo(camera.zoom, clamped.scrollX, clamped.scrollY, PAN_MOMENTUM_DURATION_MS);
  }

  // -- PINCH ----------------------------------------------------------------

  /**
   * A second finger down ALWAYS converts the current field gesture to PINCH
   * (the owner's "pinch suppresses taps" guardrail): an ARMED plot or
   * structure tap is discarded before it ever processes (T3.4c - a pinch
   * whose first finger lands on a ready crop zooms and harvests NOTHING;
   * on a building, zooms and opens nothing), an already-live farm sweep
   * cancels (plots harvested by earlier movement stay harvested), and ALL
   * farming input stays suppressed until every finger lifts. A pending
   * long-press lift converts too (T3.3a-r3: the hold timer cancels, the
   * object never lifts), but an ACTIVE 'lift' is deliberately absent from
   * the list - a second finger during a lift is IGNORED and the lift
   * continues. Only OUR gestures convert - a down whose first finger
   * landed on any other interactive object ('object': a pressed button)
   * keeps that object's own input, and 'idle' downs (seed-bar band, where
   * the bar's own strip drag may be live) stay idle.
   */
  private maybeStartPinch(): void {
    if (
      this.fieldGesture !== 'farm' &&
      this.fieldGesture !== 'farm-pending' &&
      this.fieldGesture !== 'pan' &&
      this.fieldGesture !== 'structure-armed' &&
      this.fieldGesture !== 'lift-pending'
    )
      return;
    if (!this.cameraGesturesAllowed()) return;
    let a: Phaser.Input.Pointer | null = null;
    let b: Phaser.Input.Pointer | null = null;
    for (const pointer of this.input.manager.pointers) {
      if (!pointer.isDown) continue;
      if (a === null) a = pointer;
      else if (b === null) b = pointer;
    }
    if (a === null || b === null) return;
    // Cancel a live farm sweep cleanly (a mid-sweep replant offer keeps
    // accumulating and shows on the NEXT harvest gesture's end, as always)
    // and discard any T3.4c arm - the deferred tap never fires, the armed
    // plot never processes.
    this.plotTracker.end();
    this.gestureMode = null;
    this.armedStructure = null;
    this.cancelPendingLift();
    this.killCameraTween();
    this.fieldGesture = 'pinch';
    this.farmingSuppressed = true;
    this.pinchPointerA = a;
    this.pinchPointerB = b;
    this.pinchStartDist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    this.pinchStartZoom = this.cameras.main.zoom;
    this.cameras.main.getWorldPoint((a.x + b.x) / 2, (a.y + b.y) / 2, this.pinchAnchorWorld);
  }

  /**
   * Live pinch: zoom from the finger-distance ratio (clamped to
   * [fitZoom, CAMERA_MAX_ZOOM_IN]), then re-solve the scroll so the world
   * point captured under the pinch-start midpoint stays under the CURRENT
   * midpoint - which makes midpoint movement pan simultaneously, for free.
   * Scroll is hard-clamped (no rubber band): zoom-out stops exactly at the
   * full view.
   */
  private updatePinch(): void {
    const a = this.pinchPointerA;
    const b = this.pinchPointerB;
    if (a === null || b === null || !a.isDown || !b.isDown) return;
    const camera = this.cameras.main;
    const viewport = this.cameraViewport();
    const zoom = pinchZoom(
      this.pinchStartZoom,
      this.pinchStartDist,
      Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y),
      this.cameraFitZoom(viewport),
      CAMERA_MAX_ZOOM_IN,
    );
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const anchored = scrollForAnchor(
      this.pinchAnchorWorld.x,
      this.pinchAnchorWorld.y,
      midX,
      midY,
      zoom,
      viewport,
    );
    const clamped = clampScroll(
      anchored.scrollX,
      anchored.scrollY,
      zoom,
      CAMERA_WORLD_BOUNDS,
      viewport,
    );
    camera.setZoom(zoom).setScroll(clamped.scrollX, clamped.scrollY);
  }

  // -- WHEEL / RECENTER / SHARED CAMERA HELPERS ------------------------------

  /** Mouse wheel zoom around the cursor (desktop/dev convenience), same clamps and gates. */
  private onFieldWheel(
    pointer: Phaser.Input.Pointer,
    _over: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ): void {
    if (!this.cameraGesturesAllowed()) return;
    this.killCameraTween();
    const camera = this.cameras.main;
    const viewport = this.cameraViewport();
    const zoom = clampZoom(
      camera.zoom * Math.exp(-deltaY * WHEEL_ZOOM_STEP),
      this.cameraFitZoom(viewport),
      CAMERA_MAX_ZOOM_IN,
    );
    // Anchor BEFORE the zoom write: the world point under the cursor now
    // must still be under the cursor at the new zoom.
    const anchor = camera.getWorldPoint(pointer.x, pointer.y, this.pointerWorldPoint);
    const anchored = scrollForAnchor(anchor.x, anchor.y, pointer.x, pointer.y, zoom, viewport);
    const clamped = clampScroll(
      anchored.scrollX,
      anchored.scrollY,
      zoom,
      CAMERA_WORLD_BOUNDS,
      viewport,
    );
    camera.setZoom(zoom).setScroll(clamped.scrollX, clamped.scrollY);
  }

  private cameraViewport(): Viewport {
    return { width: this.cameras.main.width, height: this.cameras.main.height };
  }

  /** The gesture zoom-out FLOOR (T3.3a-r2): the zoom that fits the whole
   *  WORLD - the width fit (~0.5325) for the 2028x2560 world in the design
   *  viewport (derived from CAMERA_WORLD_BOUNDS, pinned in cameraMath.test.ts). */
  private cameraFitZoom(viewport: Viewport): number {
    return fitZoom(CAMERA_WORLD_BOUNDS, viewport);
  }

  /**
   * The default (home) view: the OWNED (legacy 1080x1920) rect's fit zoom
   * pulled back by CAMERA_HOME_ZOOM_OUT, centered on the same rect.
   *
   * Floored at the gesture zoom-out limit so home can never sit outside the
   * range a pinch is allowed to reach - if the factor is ever set past the
   * floor, home simply becomes the fully-zoomed-out view instead of an
   * unreachable one the Recenter button could never satisfy.
   */
  private cameraHome(viewport: Viewport): { zoom: number; scrollX: number; scrollY: number } {
    const zoom = Math.max(
      fitZoom(CAMERA_OWNED_BOUNDS, viewport) * CAMERA_HOME_ZOOM_OUT,
      this.cameraFitZoom(viewport),
    );
    const scroll = clampScroll(0, 0, zoom, CAMERA_WORLD_BOUNDS, viewport);
    return { zoom, scrollX: scroll.scrollX, scrollY: scroll.scrollY };
  }

  private killCameraTween(): void {
    this.cameraTween?.remove();
    this.cameraTween = null;
  }

  /** One shared camera tween (momentum, snap-back, recenter); no-ops when already at the target. */
  private glideCameraTo(zoom: number, scrollX: number, scrollY: number, duration: number): void {
    this.killCameraTween();
    const camera = this.cameras.main;
    if (
      Math.abs(camera.zoom - zoom) < CAMERA_ZOOM_EPSILON &&
      Math.abs(camera.scrollX - scrollX) < CAMERA_SCROLL_EPSILON &&
      Math.abs(camera.scrollY - scrollY) < CAMERA_SCROLL_EPSILON
    ) {
      camera.setZoom(zoom).setScroll(scrollX, scrollY);
      return;
    }
    this.cameraTween = this.tweens.add({
      targets: camera,
      zoom,
      scrollX,
      scrollY,
      duration,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.cameraTween = null;
      },
    });
  }

  /**
   * Recenter button (T3.4b): panel nineslice + label like the arrange-row
   * buttons, under the HUD gear. Hidden (and inert) whenever the camera is
   * at its default view or the tutorial rails are up; `enterArrangeMode`
   * exempts it, so it stays usable while arranging.
   */
  private createRecenterButton(): void {
    this.recenterButton = this.add
      .nineslice(
        RECENTER_X,
        RECENTER_Y,
        ATLAS_KEY,
        'panel',
        RECENTER_WIDTH,
        RECENTER_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(RECENTER_DEPTH)
      .setVisible(false);
    this.recenterText = this.add
      .text(RECENTER_X, RECENTER_Y, 'Recenter', RECENTER_TEXT_STYLE)
      .setOrigin(0.5)
      .setDepth(RECENTER_DEPTH + 1)
      .setVisible(false);
    this.recenterButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.recenterCamera();
    });
  }

  /**
   * Glide the camera to a region's on-field sign (T3.30), from the Goals
   * panel's region entry. The sign owns the actual purchase, so this only
   * carries the player there: the SAME shared tween `recenterCamera` uses
   * (`glideCameraTo`, so a live pan/pinch tween is cancelled cleanly), at the
   * current zoom, with the target scroll bounds-clamped exactly like every
   * other camera move. A no-op for an unknown region id.
   */
  private focusCameraOnRegionSign(regionId: string): void {
    const region = findRegion(regionId);
    if (region === undefined) return;
    const viewport = this.cameraViewport();
    const { zoom } = this.cameras.main;
    // Centering a world point: the camera's center sits at
    // scroll + viewport/2 (see cameraMath's conventions), so the scroll that
    // centers (x, y) is that point minus the half-viewport.
    const clamped = clampScroll(
      region.signPosition.x - viewport.width / 2,
      region.signPosition.y - viewport.height / 2,
      zoom,
      CAMERA_WORLD_BOUNDS,
      viewport,
    );
    this.glideCameraTo(zoom, clamped.scrollX, clamped.scrollY, RECENTER_GLIDE_MS);
  }

  /** Put the camera on HOME immediately, no glide - the boot seat (see create). */
  private snapCameraHome(): void {
    const home = this.cameraHome(this.cameraViewport());
    this.cameras.main.setZoom(home.zoom).setScroll(home.scrollX, home.scrollY);
  }

  /** Glide the camera home over ~250ms (Sine.easeOut). */
  private recenterCamera(): void {
    const home = this.cameraHome(this.cameraViewport());
    this.glideCameraTo(home.zoom, home.scrollX, home.scrollY, RECENTER_GLIDE_MS);
  }

  /**
   * Show the recenter button ONLY while the camera has SETTLED off-default
   * (and never during the tutorial rails). Settled matters (owner feedback):
   * mid-gesture and mid-tween positions are transient - a rubber-band drag
   * that will just bounce back home must never flash the button - so while a
   * pan/pinch is in progress or a glide/snap-back tween is running, the
   * button simply keeps its current state and the decision waits for the
   * camera to come to rest. Interactivity toggles with visibility so a
   * hidden button is never still tappable - the arrange-controls convention.
   */
  private updateRecenterButton(): void {
    if (this.fieldGesture === 'pan' || this.fieldGesture === 'pinch' || this.cameraTween !== null)
      return;
    const camera = this.cameras.main;
    const home = this.cameraHome(this.cameraViewport());
    const offDefault =
      Math.abs(camera.zoom - home.zoom) > CAMERA_ZOOM_EPSILON ||
      Math.abs(camera.scrollX - home.scrollX) > CAMERA_SCROLL_EPSILON ||
      Math.abs(camera.scrollY - home.scrollY) > CAMERA_SCROLL_EPSILON;
    const visible = offDefault && gameState.getState().onboarding.completed;
    if (visible === this.recenterVisible) return;
    this.recenterVisible = visible;
    this.recenterButton.setVisible(visible);
    this.recenterText.setVisible(visible);
    if (visible) {
      this.recenterButton.setInteractive({ useHandCursor: true });
    } else {
      this.recenterButton.disableInteractive();
    }
  }

  /**
   * Open the crop info card from a seed bar "i" tap: closes the bag/orders/
   * settings panels first, the established panel-exclusivity behavior (see
   * `Hud.closePanels`), then shows the tapped crop's info.
   */
  private showCropInfo(crop: CropDef): void {
    this.hud.closePanels();
    this.cropInfoCard.show(cropToInfoDef(crop));
  }

  /**
   * Attempt the farm expansion purchase (T3.3a rework): on success the 4 new
   * plots land in the SHED (`grantPlots` inside `expandFarm`), not on fixed
   * tiles - so there is no new-row reveal here anymore. The fanfare and buzz
   * play, the sign hides, and the grant popup (queued by the store) follows
   * on the next refresh tick; the 4th row's grass tiles were already visible
   * as the unowned-land preview. On failure (insufficient coins - the sign
   * is hidden once already expanded, so that is the only failure reachable
   * from a tap) nudges the sign instead.
   */
  private tryExpand(): void {
    if (!gameState.expandFarm()) {
      this.expandSign.flashInsufficientCoins();
      return;
    }
    this.audio.expandFanfare();
    buzz(HAPTIC_MEDIUM_MS);
    this.refreshExpandSign();
  }

  /**
   * A tap's first-contact plot only (never a mid-sweep POINTER_MOVE entry):
   * shows the live countdown when that plot is growing-but-not-ready, the
   * one case where both harvest and plant fall through and a tap would
   * otherwise do nothing. Suppressed while onboarding is active (the
   * tutorial chip owns countdown duty there) or a modal panel is open.
   */
  private maybeShowCountdown(plotIndex: number | null): void {
    if (
      plotIndex === null ||
      isModalOpen() ||
      this.dressingEditActive ||
      this.arrangeModeActive ||
      this.pathModeActive()
    )
      return;
    const state = gameState.getState();
    if (!state.onboarding.completed) return;
    const plot = state.plots[plotIndex];
    if (plot?.state !== 'growing' || isReady(plot, now())) return;
    const pos = this.plotPositions[plotIndex];
    if (pos === undefined) return;
    this.cropCountdown.show(plotIndex, pos);
  }

  /**
   * All harvest/plant rules live in the store: try the harvest first (only a
   * growing-and-ready plot succeeds), otherwise fall through to planting.
   * Growing-but-not-ready plots and empty plots with no seed selected fail
   * both silently. A gesture locks to whichever action first succeeds
   * (`gestureMode`), so a harvest sweep cannot plant empty plots it crosses
   * and a plant sweep cannot harvest ready crops it crosses. A level-up
   * celebration or chest ceremony blocks the field entirely - its full-screen
   * backdrop already eats the tap, this just guards the scene-wide pointer
   * listeners too. An open modal panel (order board, inventory) blocks it
   * the same way: field gestures are scene-wide listeners, not per-object hit
   * tests, so panel hit-testing alone never stops a tap from reaching the
   * field beneath it.
   */
  private handlePlotEntered(plotIndex: number | null): void {
    if (
      plotIndex === null ||
      this.levelUpCelebration.isActive() ||
      this.chestCeremony.isActive() ||
      isModalOpen() ||
      this.dressingEditActive ||
      this.arrangeModeActive ||
      // Paint mode never reaches here (its down classifies 'paint', not
      // 'farm'), but the tutorial's legacy instant-farm path bypasses the
      // classifier - so the gate is asserted here too, like every other mode.
      this.pathModeActive()
    )
      return;
    if (this.gestureMode !== 'plant') {
      // The crop id must be read before the harvest empties the plot - the
      // floating xp label needs it.
      const plot = gameState.getState().plots[plotIndex];
      if (gameState.harvestPlot(plotIndex)) {
        this.gestureMode = 'harvest';
        this.audio.harvestPop();
        this.playHarvestPop(plotIndex);
        if (plot?.state === 'growing') {
          this.playHarvestJuice(plotIndex, plot.cropId);
          this.pushPendingReplant({ plotIndex, cropId: plot.cropId });
        }
        return;
      }
      if (this.gestureMode === 'harvest') return;
    }
    this.tryPlant(plotIndex);
  }

  /** Append to `pendingReplant`, replacing (not duplicating) an existing entry for the same plot. */
  private pushPendingReplant(entry: ReplantEntry): void {
    const existingIndex = this.pendingReplant.findIndex((e) => e.plotIndex === entry.plotIndex);
    if (existingIndex === -1) this.pendingReplant.push(entry);
    else this.pendingReplant[existingIndex] = entry;
  }

  /** Leaf burst + floating "+N xp" + light buzz + a crop flight to the bag. */
  private playHarvestJuice(plotIndex: number, cropId: CropId): void {
    const pos = this.plotPositions[plotIndex];
    if (pos === undefined) return;
    this.worldParticles.burst('leaf', pos.x, pos.y + BURST_OFFSET_Y);
    this.worldFloatingText.show(
      pos.x,
      pos.y + XP_LABEL_OFFSET_Y,
      XP_LABELS[cropId],
      XP_TEXT_OPTIONS,
    );
    buzz(HAPTIC_LIGHT_MS);
    this.hud.flyCropToBag(pos.x, pos.y + BURST_OFFSET_Y, cropId);
  }

  /**
   * Radiant harvest follow-up flourish: a two-stage sparkle burst + gold
   * "Radiant! x5" label above the plot. Drained from the store's event queue
   * on the refresh tick, so it lands ~250ms behind the harvest pop - a
   * deliberate follow-up beat, not a bug. The buzz/chime for the batch this
   * event belongs to are fired by the caller, once per batch.
   */
  private playRadiantJuice(plotIndex: number): void {
    const pos = this.plotPositions[plotIndex];
    if (pos === undefined) return;
    this.worldParticles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
    this.worldFloatingText.show(
      pos.x,
      pos.y + RADIANT_LABEL_OFFSET_Y,
      RADIANT_LABEL,
      RADIANT_TEXT_OPTIONS,
    );
    this.time.delayedCall(RADIANT_SECOND_BURST_DELAY_MS, () => {
      this.worldParticles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
    });
  }

  /**
   * Attempt to plant the selected crop on a plot. All planting rules live in
   * `gameState.plantCrop`; on failure this only picks the feedback cue -
   * occupied plots stay silent, an unaffordable seed gets a gentle nudge.
   */
  private tryPlant(plotIndex: number): void {
    const cropId = this.seedBar.getSelected();
    if (cropId === null) return;
    if (gameState.plantCrop(plotIndex, cropId)) {
      this.gestureMode = 'plant';
      // A successful manual plant is a change of intent - dismiss any
      // outstanding replant offer (its `onHide` clears `pendingReplant`).
      this.replantChip.hide();
      this.audio.sfx('plant');
      this.refreshCrops();
      this.playPlantPop(plotIndex);
      const pos = this.plotPositions[plotIndex];
      if (pos !== undefined) {
        this.worldParticles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
        this.worldFloatingText.show(
          pos.x,
          pos.y + XP_LABEL_OFFSET_Y,
          `-${CROPS[cropId].seedCost}`,
          PLANT_COST_TEXT_OPTIONS,
        );
      }
      buzz(HAPTIC_LIGHT_MS);
      return;
    }
    const state = gameState.getState();
    if (state.plots[plotIndex]?.state !== 'empty') return;
    if (state.coins < CROPS[cropId].seedCost) this.seedBar.flashInsufficientCoins(cropId);
  }

  /**
   * The replant chip's juice callback: the chip owns no scene visuals, so it
   * hands back exactly the plots it actually planted for the usual plant pop
   * + sparkle burst per plot, mirroring `tryPlant`'s success path.
   */
  private handleReplanted(plantedEntries: ReplantEntry[]): void {
    this.refreshCrops();
    for (const { plotIndex } of plantedEntries) {
      this.playPlantPop(plotIndex);
      const pos = this.plotPositions[plotIndex];
      if (pos !== undefined) this.worldParticles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
    }
  }

  /** Placeholder "plip" on a fresh plant; real particles come later. */
  private playPlantPop(plotIndex: number): void {
    const sprite = this.cropSprites[plotIndex];
    if (sprite === undefined) return;
    // A replant can land while the previous harvest pop is still mid-flight
    // (next gesture within its 150ms); cancel that pop cleanly first.
    this.tweens.killTweensOf(sprite);
    this.popActive[plotIndex] = false;
    sprite.setAlpha(1).setScale(0.5);
    this.tweens.add({ targets: sprite, scale: 1, duration: 120, ease: 'Back.easeOut' });
  }

  /**
   * Placeholder harvest pop: scale up while fading out, then fully reset the
   * pooled sprite (alpha 1, scale 1, hidden, tint cleared). The ready effect
   * stops immediately so nothing glows during the pop; `popActive` keeps the
   * refresh tick from hiding the sprite before the pop finishes.
   */
  private playHarvestPop(plotIndex: number): void {
    const sprite = this.cropSprites[plotIndex];
    if (sprite === undefined) return;
    this.stopReadyEffect(plotIndex, sprite);
    this.tweens.killTweensOf(sprite);
    this.popActive[plotIndex] = true;
    this.tweens.add({
      targets: sprite,
      scale: HARVEST_POP_SCALE,
      alpha: 0,
      duration: HARVEST_POP_DURATION_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.popActive[plotIndex] = false;
        sprite.setVisible(false).setAlpha(1).setScale(1).clearTint();
      },
    });
  }

  /**
   * Build the ground layer for the given mode, tearing down whatever the
   * previous mode built first - this is the ONLY entry point that creates
   * ground visuals, so the dev-overlay cycle button can rebuild just this
   * layer live without touching anything else in the scene (`cycleGroundMode`).
   */
  private createGroundLayer(mode: GroundMode): void {
    this.destroyGroundLayer();
    this.groundMode = mode;
    if (mode === 'tiles' || mode === 'tiles_flat') {
      this.layGrassField(mode === 'tiles_flat' ? 'grass_flat' : 'grass');
    } else {
      this.layGroundTexture();
    }
  }

  /** Tear down whichever ground visuals the current mode built. Idempotent. */
  private destroyGroundLayer(): void {
    for (const tile of this.groundTiles) tile.destroy();
    this.groundTiles = [];
    this.groundTexture?.destroy();
    this.groundTexture = null;
  }

  /**
   * Cover the field band with grass diamond tiles (they also run under the
   * plots). `frame` is `'grass'` for 'tiles' mode or `'grass_flat'` (T2.28a
   * - see tools/pack-atlas.mjs `processTileFlat`) for 'tiles_flat' mode;
   * same grid math either way, since both frames share the same
   * TILE_DIAMOND_WIDTH x TILE_DIAMOND_HEIGHT geometry.
   */
  private layGrassField(frame: 'grass' | 'grass_flat'): void {
    for (let col = GRASS_GRID_MIN; col <= GRASS_GRID_MAX; col++) {
      for (let row = GRASS_GRID_MIN; row <= GRASS_GRID_MAX; row++) {
        const { x, y } = gridToIso(col, row);
        if (y < FIELD_MIN_Y || y > FIELD_MAX_Y) continue;
        if (x < WORLD_MIN_X - TILE_WIDTH / 2 || x > WORLD_MIN_X + WORLD_WIDTH + TILE_WIDTH / 2)
          continue;
        this.groundTiles.push(
          this.add
            .image(x, y, ATLAS_KEY, frame)
            .setOrigin(0.5, TILE_ORIGIN_Y)
            .setDepth(GROUND_LAYER_DEPTH),
        );
      }
    }
  }

  /**
   * The meadow ground (T2.28 experiment, promoted to the player-facing
   * default in T3.3s-r2b): ONE TileSprite tiling the seamless 512x512
   * meadow master across the ENTIRE world rect (FIELD_MIN/MAX_Y are the
   * world rect since T3.3a-r2), replacing the diamond grass tiles (plot
   * tiles are untouched either way). See GROUND_LAYER_DEPTH for why it
   * renders beneath everything else.
   */
  private layGroundTexture(): void {
    this.groundTexture = this.add
      .tileSprite(
        WORLD_MIN_X,
        FIELD_MIN_Y,
        WORLD_WIDTH,
        FIELD_MAX_Y - FIELD_MIN_Y,
        GROUND_TEXTURE_A_KEY,
      )
      .setOrigin(0, 0)
      .setTileScale(GROUND_TEXTURE_A_TILE_SCALE, GROUND_TEXTURE_A_TILE_SCALE)
      .setDepth(GROUND_LAYER_DEPTH);
  }

  /** Cycle texture_a -> tiles -> tiles_flat -> texture_a (dev comparison button); returns the new mode. */
  private cycleGroundMode(): GroundMode {
    const order: GroundMode[] = ['texture_a', 'tiles', 'tiles_flat'];
    const next = order[(order.indexOf(this.groundMode) + 1) % order.length]!;
    this.createGroundLayer(next);
    return next;
  }

  /**
   * A plot tile's depth inside the ground sub-layer band (T3.3b-r3): the
   * flat base plus a fractional y step so plots sort front-over-back among
   * THEMSELVES (the frame's soil lip overlaps the row in front - see
   * PLOT_TILE_DEPTH) while the whole band stays below every standing
   * object. THE single authority for a grounded plot tile; the lifted tile
   * alone uses PLOT_LIFT_DEPTH instead.
   */
  private plotTileDepth(y: number): number {
    return PLOT_TILE_DEPTH + y * PLOT_TILE_DEPTH_Y_STEP;
  }

  /**
   * Create one plot's visuals at its saved tile (T3.3a-r): its own tile
   * image ('plot'/'plot_occupied' per state - empty land renders nothing,
   * the permanent 16-tile field is gone) plus the reusable crop sprite with
   * the crop's baseline anchoring, hidden until the plot has a growing crop.
   * The tile carries no per-object listeners (T3.3a-r3: arrange mode's
   * tap-select and long-press lift run through the scene-level gesture
   * classifier, like `createDecorationSprite`); it stays inert until
   * `refreshArrangePlotInteractivity` makes it hit-testable for the mode.
   */
  private createPlotVisuals(index: number): void {
    const plot = gameState.getState().plots[index];
    const { x, y } = plot === undefined ? gridToIso(0, 0) : gridToIso(plot.col, plot.row);
    const tile = this.add
      .image(x, y, ATLAS_KEY, 'plot')
      .setOrigin(0.5, TILE_ORIGIN_Y)
      .setDepth(this.plotTileDepth(y));
    this.plotTileSprites[index] = tile;
    const sprite = this.add
      .image(x, y, ATLAS_KEY, CROPS.sunwheat.stageFrames[0])
      .setOrigin(0.5, CROP_BASELINE_Y / CROP_FRAME_SIZE)
      .setDepth(y)
      .setVisible(false);
    this.cropSprites[index] = sprite;
    this.plotPositions[index] = { x, y };
    this.readyActive[index] = false;
    this.popActive[index] = false;
  }

  /** One tile image + crop sprite per saved plot, at each plot's own saved tile. */
  private buildPlotVisuals(): void {
    const plotCount = gameState.getState().plots.length;
    for (let index = 0; index < plotCount; index++) {
      this.createPlotVisuals(index);
    }
  }

  /**
   * Keep the per-plot visuals (tile image + crop sprite) in step with state
   * (T3.3a): counts AND coordinates - a placed plot (append), a dev
   * import/reset (shrink), and a moved plot (same count, new tile) all
   * re-render correctly without a reload. Cheap on the refresh tick: a
   * length compare plus one position compare per plot. An in-flight plot
   * drag is safe: state does not change mid-drag, so the position compare
   * never fights the drag's own live tile moves.
   */
  private syncPlotVisuals(plots: readonly PlotState[]): void {
    while (this.cropSprites.length > plots.length) {
      const sprite = this.cropSprites.pop();
      if (sprite !== undefined) {
        this.tweens.killTweensOf(sprite);
        sprite.destroy();
      }
      const tile = this.plotTileSprites.pop();
      if (tile !== undefined) {
        this.tweens.killTweensOf(tile);
        tile.destroy();
      }
      this.plotPositions.pop();
      this.readyActive.pop();
      this.popActive.pop();
    }
    while (this.cropSprites.length < plots.length) {
      this.createPlotVisuals(this.cropSprites.length);
    }
    for (let index = 0; index < plots.length; index++) {
      const plot = plots[index]!;
      const { x, y } = gridToIso(plot.col, plot.row);
      const pos = this.plotPositions[index];
      if (pos === undefined || pos.x !== x || pos.y !== y) {
        this.plotPositions[index] = { x, y };
        this.cropSprites[index]?.setPosition(x, y).setDepth(y);
        this.plotTileSprites[index]?.setPosition(x, y).setDepth(this.plotTileDepth(y));
      }
    }
  }

  /**
   * Re-derive every plot tile's frame from state (T3.3a-r):
   * 'plot_occupied' under a growing crop, 'plot' otherwise. Per plot, not
   * per grid tile - plotless land renders nothing at all.
   */
  private refreshPlotTiles(plots: readonly PlotState[]): void {
    for (let index = 0; index < plots.length; index++) {
      const tile = this.plotTileSprites[index];
      if (tile === undefined) continue;
      const frame = plots[index]!.state === 'growing' ? 'plot_occupied' : 'plot';
      if (tile.frame.name !== frame) tile.setFrame(frame);
    }
  }

  /**
   * Re-derive every plot's visuals from `gameState` and the game clock:
   * show/hide the sprite, set its growth-stage frame, and start/stop the
   * ready-state bounce and glow. Reads state fresh every call - the scene
   * never caches plot data beyond the sprite objects themselves.
   */
  private refreshCrops(): void {
    const plots = gameState.getState().plots;
    this.syncPlotVisuals(plots);
    // Tile frames live on the per-plot tile sprites (T3.3a-r) - re-derived
    // per plot ('plot'/'plot_occupied'); plotless land draws nothing.
    this.refreshPlotTiles(plots);
    const nowMs = now();
    for (let index = 0; index < plots.length; index++) {
      const plot = plots[index];
      const sprite = this.cropSprites[index];
      if (plot === undefined || sprite === undefined) continue;

      if (plot.state === 'empty') {
        // A mid-pop sprite is already reset-and-hidden by the pop's own
        // completion callback; touching it here would cut the animation.
        if (!this.popActive[index]) {
          sprite.setVisible(false);
          this.stopReadyEffect(index, sprite);
        }
        continue;
      }

      sprite.setVisible(true);
      // stageIndex() is clamped to 0..CROP_STAGES-1, which stageFrames always covers.
      const frame = CROPS[plot.cropId].stageFrames[stageIndex(plot, nowMs)]!;
      if (sprite.frame.name !== frame) sprite.setFrame(frame);

      if (isReady(plot, nowMs)) {
        this.startReadyEffect(index, sprite);
      } else {
        this.stopReadyEffect(index, sprite);
      }
    }
  }

  /** Start the idle bounce + glow tint on a just-ready crop; idempotent. */
  private startReadyEffect(index: number, sprite: Phaser.GameObjects.Image): void {
    if (this.readyActive[index]) return;
    this.readyActive[index] = true;
    sprite.setTint(READY_TINT);
    this.tweens.add({
      targets: sprite,
      scale: 1.06,
      duration: 450,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * Onboarding pulse target on the field: the first empty (or first
   * harvest-ready) plot by index, or null when none qualifies - a null for
   * 'ready' while everything is mid-growth means no highlight, by design.
   * Also null while a modal panel is open: the field is occluded and
   * untappable then, so it is never a valid pulse target. Targets the tile
   * image (safe to scale-breathe), never the crop sprite - ready crops run
   * their own bounce.
   *
   * Index 0 is the TOP corner plot, which is also where the ghost-swipe
   * serpentine begins - so the tutorial's tap steps naturally put the
   * player's finger at the drag demo's start point.
   */
  private plotPulseTarget(kind: 'empty' | 'ready'): PulseTarget | null {
    if (isModalOpen()) return null;
    const plots = gameState.getState().plots;
    const nowMs = now();
    for (let index = 0; index < plots.length; index++) {
      const plot = plots[index];
      const pos = this.plotPositions[index];
      const tile = this.plotTileSprites[index];
      if (plot === undefined || pos === undefined || tile === undefined) continue;
      const matches =
        kind === 'empty'
          ? plot.state === 'empty'
          : plot.state === 'growing' && isReady(plot, nowMs);
      if (matches) {
        return { x: pos.x, y: pos.y, width: TILE_WIDTH, height: TILE_HEIGHT, object: tile };
      }
    }
    return null;
  }

  /** Stop the idle bounce + glow tint and restore defaults; idempotent. */
  private stopReadyEffect(index: number, sprite: Phaser.GameObjects.Image): void {
    if (!this.readyActive[index]) return;
    this.readyActive[index] = false;
    this.tweens.killTweensOf(sprite);
    sprite.setScale(1);
    sprite.clearTint();
  }

  /**
   * The decorative farmhouse (T2.22) - as of T3.9, also the entry point to
   * the Decor Shop: tapping it opens the shop, gated by the same rails
   * pattern as the notice board (`applyFarmhouseRailsGating`). Kept as one
   * isolated create call so it can be pulled independently of the notice
   * board if its baked grass skirt clashes with the tile grass. Its own,
   * taller scale (T2.22a) - see FARMHOUSE_DISPLAY_HEIGHT.
   *
   * The hit area covers the whole structure plus a generous pad, same
   * frame-relative convention as the notice board's - see its own comment on
   * `createNoticeBoard` for why the rectangle must be frame-relative, not
   * origin-centered.
   */
  private createFarmhouse(): void {
    // Render position derives from the saved anchor (T3.3s) - at the
    // default anchor this is exactly the historical FARMHOUSE_POSITION.
    const position = structureRenderPosition(
      'farmhouse',
      gameState.getState().structures.farmhouse,
    );
    this.farmhouseImage = this.add
      .image(position.x, position.y, ATLAS_KEY, FARMHOUSE_FRAME)
      .setScale(FARMHOUSE_SCALE)
      .setDepth(this.structureDepthFor(FARMHOUSE_REF, position.y));
    // Frame + hit area + ORIGIN all derive from the restoration flag (T3.25,
    // origin since T3.27); at flag 0 this is exactly the historical setup.
    this.applyFarmhouseLook();
    this.farmhouseImage.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (pointer: Phaser.Input.Pointer) => {
        // Deferred tap (T3.4c): opens on an in-slop release, never on down.
        this.handleStructureDown(pointer, () => this.openDecorShop());
      },
    );
    // Non-null: the farmhouse frame always has a packed shadow companion
    // (T3.art-3). Named explicitly (T3.25) - see createGroundShadow.
    // `false`: the farmhouse can be mirrored (T4.8) but its authored cast never is.
    this.farmhouseShadow = this.createGroundShadow(
      this.farmhouseImage,
      FARMHOUSE_SHADOW_FRAME,
      false,
    )!;
    // The shadow exists only now, so the look pass above could not place it.
    this.applyStructureStatePosition(FARMHOUSE_REF);
  }

  /**
   * Apply the farmhouse's restoration look (T3.25) - THE frame swap, and the
   * only thing restoration changes about the farmhouse. Both frames are packed
   * so their bottom STRUCTURE_FRAME_SIZE-tall band holds the building
   * identically (tools/pack-atlas.mjs processRestoredFarmhouse); the restored
   * frame is taller only by the overhang its floating moon needs. So:
   *
   * - the SCALE is the same for both looks. Reusing FARMHOUSE_DISPLAY_HEIGHT
   *   as a fixed display height instead would share those pixels between the
   *   building AND the moon and silently render the building smaller.
   * - the ORIGIN is re-derived to the (taller) frame's own base row, so the
   *   building's base stays pinned to the ground point and the moon's extra
   *   height grows upward off-screen-ward instead of dragging the building up
   *   with it. The building's on-screen size, base position, depth, and cast
   *   shadow are all then unchanged by construction. (T3.27 - this replaced
   *   T3.25's half-overhang counter-shove, which existed only because centre
   *   anchoring made the taller frame move the building.)
   * - the hit area stays anchored to that bottom band, so tapping the house
   *   feels identical and the floating moon is not a tap target.
   *
   * Safe to call repeatedly; the caller re-places the sprite afterwards.
   */
  private applyFarmhouseLook(): void {
    const restored = gameState.getState().restoration.farmhouse === 1;
    this.farmhouseImage.setFrame(restored ? FARMHOUSE_RESTORED_FRAME : FARMHOUSE_FRAME);
    // After the frame swap, so the taller restored frame's base row is used.
    this.farmhouseImage.setOrigin(0.5, this.structureBaseOriginY(this.farmhouseImage, 'farmhouse'));
    // The saved mirror (T4.8), applied here so BOTH looks flip and a frame swap
    // never drops it. Visual only - the origin it mirrors around is the base
    // point, so position, footprint and shadow are untouched.
    this.farmhouseImage.setFlipX(gameState.getState().structures.farmhouse.flipped);
    const pad = FARMHOUSE_HIT_PAD_DISPLAY_PX / FARMHOUSE_SCALE;
    const overhang = this.farmhouseImage.frame.realHeight - STRUCTURE_FRAME_SIZE;
    // Unchanged by T3.27's origin move: hitArea rectangles are FRAME-relative
    // (Phaser adds displayOrigin back before testing - see the convention note
    // in CLAUDE.md), so they describe a region of the art, not of the sprite's
    // placement. The art's position within its frame did not change, so this
    // rect - the bottom 256 band, i.e. the building, moon excluded - is still
    // exactly right.
    this.farmhouseImage.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(
        -pad,
        overhang - pad,
        STRUCTURE_FRAME_SIZE + pad * 2,
        STRUCTURE_FRAME_SIZE + pad * 2,
      ),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    // The rails gating owns interactivity from here; re-assert its verdict so
    // a look change during the tutorial cannot resurrect a blocked farmhouse.
    this.farmhouseEnabled = true;
    this.applyFarmhouseRailsGating();
  }

  /**
   * The origin-y that BASE-anchors a structure sprite (T3.27): the fraction of
   * the frame's height at which the building meets the ground, so
   * `setPosition` places the base on the ground point and everything above it
   * - roof, chimney, the restored farmhouse's floating moon - extends upward
   * on its own.
   *
   * The base row is STRUCTURE_BASE_ROW_NATIVE plus however much TALLER than
   * the nominal 256 band this particular frame is. That second term is what
   * makes the restored farmhouse work without a special case: the packer
   * builds `farmhouse_restored` so its bottom 256-tall band is
   * coordinate-identical to `farmhouse` and the moon simply grows the canvas
   * UPWARD (tools/pack-atlas.mjs processRestoredFarmhouse), so the building's
   * base row moves down the frame by exactly the overhang. This is what
   * replaced T3.25's `farmhouseRestorationOffsetY` half-overhang shove: under
   * centre anchoring a taller frame dragged the building with it and had to be
   * pushed back; under base anchoring the base is the fixed point by
   * construction and nothing needs correcting.
   *
   * Currently 1.0 for every structure and look (both frames are bottom-flush,
   * and 256 + 28 = 284 = the restored frame's own height), but derived rather
   * than hardcoded so re-measured art keeps working.
   */
  private structureBaseOriginY(image: Phaser.GameObjects.Image, id: StructureId): number {
    const overhang = image.frame.realHeight - STRUCTURE_FRAME_SIZE;
    return (STRUCTURE_BASE_ROW_NATIVE[id] + overhang) / image.frame.realHeight;
  }

  /**
   * The y of a base-anchored structure sprite's visual CENTRE (T3.27) - for
   * the few things that want the middle of the building rather than its
   * ground point: the tutorial's pulse ring and the restoration sparkle
   * burst. Origin-aware, so it survives an origin re-derive.
   */
  private structureCenterY(image: Phaser.GameObjects.Image): number {
    return image.y + image.displayHeight * (0.5 - image.originY);
  }

  /**
   * The DEPTH a structure sorts at, given its ground point `baseY` (T3.27).
   *
   * Deliberately NOT `baseY`: re-anchoring must not reshuffle the iso
   * interleave (a structure that used to pass behind a crop must still pass
   * behind it), so the sort key stays the exact quantity it was before this
   * task - the sprite's old CENTRE y, which is `baseY` minus half the
   * structure's un-restored display height. Restoration does not enter into
   * it, matching T3.25, where depth was taken from the nominal position and
   * the taller frame changed nothing.
   *
   * Moving the sort to the true ground y would be more correct iso-wise (the
   * farmhouse currently sorts 210px above where it stands) but it is a
   * visible, PM-owned change to what passes in front of what - see the task
   * report for T3.27.
   */
  private structureDepthFor(ref: MovableAnchorRef, baseY: number): number {
    // T4.1: buildings sort by the same rule - ground point minus half their
    // display height - so a building interleaves with crops, plots and
    // structures exactly as a structure of that size would.
    const displayHeight =
      ref.kind === 'building'
        ? BUILDING_DISPLAY_HEIGHT
        : ref.id === 'farmhouse'
          ? FARMHOUSE_DISPLAY_HEIGHT
          : NOTICE_BOARD_DISPLAY_HEIGHT;
    return baseY - displayHeight / 2;
  }

  /**
   * Tap handler for the farmhouse: same panel-exclusivity + tap sfx
   * convention as the notice board's `Hud.toggleOrderBoard`. Explicitly
   * un-elevates the shop's depth (`setElevated(false)`) in case it was last
   * opened from arrange mode - see `openDecorShopFromArrange`.
   *
   * T3.3a-r2y: while ARRANGING, this routes to the elevated
   * `openDecorShopFromArrange` path instead - identical to the arrange
   * row's Shop button - so the shop can never open BEHIND the arrange
   * control rows. The farmhouse is normally swept inert during arrange,
   * but the dressing editor's own hitbox sweep can resurrect it mid-mode
   * (its off-toggle blindly restores everything it cataloged, including
   * objects the arrange sweep had disabled - the two sweeps assume they
   * never interleave, but the DOM dev overlay stays clickable through
   * both). Routing by `arrangeModeActive` HERE makes the depth choice
   * self-correcting for every current and future caller.
   */
  private openDecorShop(): void {
    if (this.arrangeModeActive) {
      this.openDecorShopFromArrange();
      return;
    }
    this.audio.sfx('tap');
    // The unified Shop on its Decor tab (U2b), un-elevated - the Hud method
    // closes the other HUD panels and toggles it, replacing the old DecorShop.
    this.hud.toggleShopDecor(false);
  }

  /**
   * Shop button handler (T3.16): opens the same Decor Shop the farmhouse tap
   * does, without leaving arrange mode. Closes the Shed panel first (panel
   * exclusivity) and elevates the shop's depth above the arrange control row
   * (`setElevated(true)`) exactly like the Shed panel's own backdrop already
   * sits above the row - see DecorShop's ELEVATED_* constants - so a tap
   * outside the shop's body (including on the now-covered row) closes it
   * instead of reaching through to a control underneath. Purchases land in
   * the shed as usual; closing the shop leaves arrange mode untouched.
   */
  private openDecorShopFromArrange(): void {
    this.audio.sfx('tap');
    this.hideShedPanel();
    // The unified Shop on its Decor tab (U2b), elevated above the arrange
    // control row. The shed panel is closed above; the Hud method toggles it.
    this.hud.toggleShopDecor(true);
  }

  /**
   * Apply the dev-only farmhouse transform knobs (T3.26) on top of the
   * sprite's normal placement. Called at the END of every path that places the
   * farmhouse, so a refresh tick, a restoration frame swap, or a drag commit
   * re-asserts the knobs instead of silently dropping them.
   *
   * Safe to call repeatedly ONLY straight after a baseline placement, which is
   * exactly how it is wired: the offset is added to the position the caller
   * just computed, so calling it twice without re-placing would double the
   * offset. Every setter below therefore re-runs the full placement rather
   * than poking the sprite, which keeps one code path and no drift.
   *
   * Rotation pivots on the sprite's origin, which is the building's BASE
   * since T3.27 - so a rotation knob now swings the roof about the ground
   * point instead of about mid-building, which is the more useful pivot for
   * the angle question this exists to answer. Nothing here touches state, the
   * anchor, the footprint, the depth, or the shadow.
   */
  private applyFarmhouseDevTransform(): void {
    this.farmhouseImage
      .setAngle(this.farmhouseDevAngle)
      .setScale(FARMHOUSE_SCALE * this.farmhouseDevScaleMult)
      .setPosition(
        this.farmhouseImage.x + this.farmhouseDevOffsetX,
        this.farmhouseImage.y + this.farmhouseDevOffsetY,
      );
  }

  /** Re-place the farmhouse (re-applying the knobs) and log the live values. */
  private refreshFarmhouseDevTransform(): void {
    this.applyStructureStatePosition(FARMHOUSE_REF);
    console.log(
      `farmhouse transform: rotation ${this.farmhouseDevAngle}deg, ` +
        `scale x${this.farmhouseDevScaleMult} (${(
          FARMHOUSE_SCALE * this.farmhouseDevScaleMult
        ).toFixed(3)}), ` +
        `offset (${this.farmhouseDevOffsetX}, ${this.farmhouseDevOffsetY}) - not saved`,
    );
  }

  /** T3.26 dev knob: absolute rotation in degrees, about the sprite centre. */
  private setFarmhouseDevRotation(degrees: number): void {
    this.farmhouseDevAngle = degrees;
    this.refreshFarmhouseDevTransform();
  }

  /** T3.26 dev knob: absolute scale MULTIPLIER over the normal FARMHOUSE_SCALE. */
  private setFarmhouseDevScale(mult: number): void {
    this.farmhouseDevScaleMult = mult;
    this.refreshFarmhouseDevTransform();
  }

  /** T3.26 dev knob: CUMULATIVE pixel nudge from the computed position. */
  private nudgeFarmhouseDev(dx: number, dy: number): void {
    this.farmhouseDevOffsetX += dx;
    this.farmhouseDevOffsetY += dy;
    this.refreshFarmhouseDevTransform();
  }

  /** T3.26 dev knob: back to the exact baseline - angle 0, FARMHOUSE_SCALE, no offset. */
  private resetFarmhouseDevTransform(): void {
    this.farmhouseDevAngle = 0;
    this.farmhouseDevScaleMult = 1;
    this.farmhouseDevOffsetX = 0;
    this.farmhouseDevOffsetY = 0;
    this.refreshFarmhouseDevTransform();
  }

  /**
   * Open the Restore the Homestead panel (T3.25) from the Decor Shop's
   * Restore button. The shop stays OPEN behind it: the panel sits above both
   * of the shop's depth tiers (see RestorePanel's PANEL_DEPTH), so closing the
   * panel returns the player to the shop they came from rather than dumping
   * them back on the field.
   */
  private openRestorePanel(): void {
    this.restorePanel.show(gameState.getState());
  }

  /**
   * Restoration celebration (T3.25): a sparkle burst over the farmhouse plus
   * a floating label, using the existing pooled world effects - no new art and
   * no new pools. Fired by the RestorePanel after a successful purchase; the
   * frame swap itself lands on the next refresh tick.
   */
  private playRestorationCelebration(): void {
    const x = this.farmhouseImage.x;
    // T3.27: the burst belongs OVER the building, and the sprite's own y is
    // its ground point now - centre it explicitly.
    const y = this.structureCenterY(this.farmhouseImage);
    this.worldParticles.burst('sparkle', x, y);
    this.worldFloatingText.show(x, y, RESTORATION_LABEL, RESTORATION_TEXT_OPTIONS);
    this.time.delayedCall(RESTORATION_SECOND_BURST_DELAY_MS, () => {
      this.worldParticles.burst('sparkle', x, y);
    });
    buzz(HAPTIC_LIGHT_MS);
  }

  /**
   * Tutorial rails on the farmhouse, mirroring `applyNoticeBoardRailsGating`
   * exactly: inert (taps blocked) outside the tutorial - which never has a
   * shop step, so this stays inert for its entire duration and never toggles
   * again once onboarding completes. Renders at full alpha throughout (T3.12
   * - PM decision); the tutorial's pulse highlight is the only visual cue.
   */
  private applyFarmhouseRailsGating(): void {
    const allowed = gameState.railsAllow('decor-shop');
    if (allowed === this.farmhouseEnabled) return;
    this.farmhouseEnabled = allowed;
    if (allowed) {
      // No-arg re-enable, so the enlarged hit area set at construction
      // survives - passing a fresh config here would reset it to the
      // image's own (smaller) texture-frame bounds.
      this.farmhouseImage.setInteractive();
    } else {
      this.farmhouseImage.disableInteractive();
    }
  }

  /**
   * Directional cast shadow (T3.3s-r2d, superseding the r2c runtime
   * mirror): renders the object's pack-time `<frame>_shadow` companion
   * (tools/pack-atlas.mjs generateCastShadow - the object's own silhouette
   * squashed, sheared toward the LOWER-LEFT away from the fixed top-right
   * sun, blurred soft, and alpha-baked pure black, so the runtime applies
   * no tint or alpha of its own). All geometry (position/scale/flip/depth)
   * tracks the object through `applyGroundShadowGeometry`. Returns null for
   * a frame with no packed `_shadow` companion (T3.art-3: decor_fence casts
   * no shadow) rather than falling back to the whole atlas image.
   */
  private createGroundShadow(
    object: Phaser.GameObjects.Image,
    shadowFrameOverride?: string,
    // T4.8: whether the shadow mirrors when its object does. True for
    // decorations (generated silhouettes - see applyGroundShadowGeometry);
    // FALSE for every movable, whose authored cast never flips. A movable that
    // is already mirrored at creation time (a flipped building restored from a
    // save) would otherwise trip `placeAuthoredShadow`'s guard right here, and
    // the throw would abort `createBuildings` mid-list - leaving the sprite
    // unpositioned at the top-left with a stray unplaced shadow.
    mirrorsObjectFlip = true,
  ): Phaser.GameObjects.Image | null {
    // T3.25: the farmhouse passes an override because its restored look has
    // no `_shadow` companion of its own - same building base, so both looks
    // share `farmhouse_shadow` and the derived name would miss on a restored
    // save at boot.
    const shadowFrame = shadowFrameOverride ?? `${object.frame.name}_shadow`;
    if (!this.textures.get(ATLAS_KEY).has(shadowFrame)) return null;
    const shadow = this.add.image(0, 0, ATLAS_KEY, shadowFrame);
    this.placeCastShadow(shadow, {
      x: object.x,
      baseY: object.y + object.displayHeight * (1 - object.originY),
      sourceFrameWidth: object.frame.realWidth,
      scaleX: object.scaleX,
      scaleY: object.scaleY,
      flipX: mirrorsObjectFlip && object.flipX,
      depth: object.depth - 1,
    });
    return shadow;
  }

  /**
   * Re-derive an EXISTING cast shadow's geometry from its object's CURRENT
   * transform - the single tracker, called at creation and from every path
   * that moves/scales/flips a shadowed object: decor free-form drags,
   * commits, scale taps and flips, and structure free-follow drags,
   * commits, and snap-backs. Delegates to `placeCastShadow` with the
   * object's live values; a flipped decoration flips its shadow (the
   * mirrored shear direction is accepted - imperceptible at the baked
   * alpha and blur).
   *
   * DECORATIONS ONLY. Movables flip too since T4.8, but their shadows must
   * not follow - they go through `applyStructureShadowGeometry`, which pins
   * flipX to false. See that method for why.
   */
  private applyGroundShadowGeometry(
    shadow: Phaser.GameObjects.Image,
    object: Phaser.GameObjects.Image,
  ): void {
    this.placeCastShadow(shadow, {
      x: object.x,
      baseY: object.y + object.displayHeight * (1 - object.originY),
      sourceFrameWidth: object.frame.realWidth,
      scaleX: object.scaleX,
      scaleY: object.scaleY,
      flipX: object.flipX,
      depth: object.depth - 1,
    });
  }

  /**
   * The structure flavour of `applyGroundShadowGeometry` (T3.27). Identical
   * except for where the base is read from: a base-anchored structure's
   * position IS its ground point, so the shadow grounds on `object.y` rather
   * than on the bottom of the frame.
   *
   * For today's art the two agree exactly (both structure frames are
   * bottom-flush, so the base row IS the frame bottom - see
   * STRUCTURE_BASE_ROW_NATIVE), but they stop agreeing the moment an art
   * revision leaves transparent padding under a building, and it is the
   * ground point, not the frame, that the shadow belongs under.
   */
  private applyStructureShadowGeometry(
    shadow: Phaser.GameObjects.Image,
    object: Phaser.GameObjects.Image,
  ): void {
    this.placeCastShadow(shadow, {
      x: object.x,
      baseY: object.y,
      sourceFrameWidth: object.frame.realWidth,
      scaleX: object.scaleX,
      scaleY: object.scaleY,
      // NEVER `object.flipX` (T4.8): a movable's cast is an AUTHORED shadow
      // with one baked light direction, so it does not mirror when the
      // building does (owner's call, an accepted imperfection). Reading the
      // sprite's flip here would also hit `placeAuthoredShadow`'s hard guard
      // and throw on every re-derive of a flipped building.
      flipX: false,
      depth: object.depth - 1,
    });
  }

  /**
   * Position a `<frame>_shadow` image relative to its object's base
   * (T3.3s-r2d). The shadow's logical frame is the generator's full
   * untrimmed canvas (restored by the atlas trim metadata):
   * x = [PAD][shear band][base span = source frame width][PAD], y =
   * [PAD][squashed mask][PAD] - so the un-sheared base edge's CENTER sits
   * at fraction (canvasW - PAD - srcW/2) / canvasW horizontally and PAD /
   * canvasH vertically. Anchoring the image there and placing that anchor
   * at the object's base center aligns the shadow's base edge under the
   * object's base; the whole shadow is then tucked upward by
   * SHADOW_TUCK_RATIO of its height so the sprite draws over the overlap
   * and the shadow emerges from beneath, attached. A flipped object
   * mirrors the anchor fraction so the (mirrored) base span stays aligned.
   */
  private placeCastShadow(
    shadow: Phaser.GameObjects.Image,
    opts: {
      x: number;
      baseY: number;
      sourceFrameWidth: number;
      scaleX: number;
      scaleY: number;
      flipX: boolean;
      depth: number;
    },
  ): void {
    const canvasW = shadow.frame.realWidth;
    const canvasH = shadow.frame.realHeight;
    // Authored-shadow branch (T3.28): a hand-authored `<frame>_shadow` (see
    // SHADOW_PLACEMENT_OVERRIDES + tools/shadow-overrides) carries its own
    // contact geometry, so it places its explicit logical anchor directly on the
    // object's ground point - NO generic tuck, NO SHADOW_CANVAS_PAD origin
    // formula. The generated-shadow path below is unchanged for every other
    // object (decor, trophies, notice board, sign).
    const authored = SHADOW_PLACEMENT_OVERRIDES[String(shadow.frame.name)];
    if (authored !== undefined) {
      placeAuthoredShadow(shadow, authored, {
        x: opts.x,
        baseY: opts.baseY,
        scaleX: opts.scaleX,
        scaleY: opts.scaleY,
        flipX: opts.flipX,
        depth: opts.depth,
      });
      return;
    }
    const originX = (canvasW - SHADOW_CANVAS_PAD - opts.sourceFrameWidth / 2) / canvasW;
    shadow
      .setOrigin(opts.flipX ? 1 - originX : originX, SHADOW_CANVAS_PAD / canvasH)
      .setPosition(opts.x, opts.baseY - canvasH * opts.scaleY * SHADOW_TUCK_RATIO)
      .setScale(opts.scaleX, opts.scaleY)
      .setFlipX(opts.flipX)
      .setDepth(opts.depth);
  }

  /**
   * The expand sign's cast shadow (T3.art-2 shadow, directional form since
   * T3.3s-r2d): the generated 'sign_shadow' companion, placed by the same
   * `placeCastShadow` rule from the mirrored EXPAND_SIGN_* constants since
   * the sign owns its sprite privately (ui/ExpandSign.ts, center origin at
   * EXPAND_SIGN_DISPLAY_SIZE on an EXPAND_SIGN_FRAME_SIZE source) and
   * renders at the floating-text depth tier - see the constants' comment
   * for why the shadow grounds at EXPAND_SIGN_Y - 1 instead of depth - 1.
   * Starts hidden; `refreshExpandSign` owns visibility.
   */
  private createExpandSignShadow(): Phaser.GameObjects.Image {
    const scale = EXPAND_SIGN_DISPLAY_SIZE / EXPAND_SIGN_FRAME_SIZE;
    const shadow = this.add.image(0, 0, ATLAS_KEY, 'sign_shadow').setVisible(false);
    this.placeCastShadow(shadow, {
      x: EXPAND_SIGN_X,
      baseY: EXPAND_SIGN_Y + EXPAND_SIGN_DISPLAY_SIZE / 2,
      sourceFrameWidth: EXPAND_SIGN_FRAME_SIZE,
      scaleX: scale,
      scaleY: scale,
      flipX: false,
      depth: EXPAND_SIGN_Y - 1,
    });
    return shadow;
  }

  /**
   * Re-derive the expand sign AND its shadow together (T3.art-2): the
   * sign's own `refresh` keeps the visibility rule (onboarding completed,
   * not yet expanded); the shadow mirrors the same rule here so it
   * disappears exactly when the sign does - an expansion purchase can
   * never orphan it.
   */
  private refreshExpandSign(): void {
    const state = gameState.getState();
    this.expandSign.refresh(state);
    this.expandSignShadow.setVisible(state.onboarding.completed && !state.expanded);
  }

  /**
   * Build every region's sign and (while locked) its dim overlay (T3.3b). Signs
   * are world objects that pan with the camera; their taps defer through the
   * shared structure-tap helper like the expand sign. A region already unlocked
   * at boot gets a hidden sign and no dim.
   */
  private createRegionPresentation(): void {
    const state = gameState.getState();
    for (const region of REGIONS) {
      const sign = new RegionSign(this, region, (pointer) =>
        this.handleStructureDown(pointer, () => this.tryPurchaseRegion(region)),
      );
      sign.refresh(state);
      this.regionSigns.set(region.id, sign);
      if (!state.regionsUnlocked.includes(region.id)) {
        this.regionDims.set(region.id, this.createRegionDim(region));
      }
    }
  }

  /** One region's locked-land dim rectangle (T3.3b) - see REGION_DIM_* constants. */
  private createRegionDim(region: RegionDef): Phaser.GameObjects.Rectangle {
    const westX = region.placeableRect.minX;
    const width = WORLD_MIN_X + WORLD_WIDTH - westX;
    return this.add
      .rectangle(
        westX + width / 2,
        WORLD_MIN_Y + WORLD_HEIGHT / 2,
        width,
        WORLD_HEIGHT,
        REGION_DIM_COLOR,
        REGION_DIM_ALPHA,
      )
      .setDepth(REGION_DIM_DEPTH);
  }

  /**
   * Re-derive every region sign's visibility from state on the tick (T3.3b),
   * and drop a dim overlay left over from a dev import/reset that unlocked a
   * region (the real-purchase fade removes its own dim from the map first, so
   * this only ever catches the no-fade cases).
   */
  private refreshRegionSigns(): void {
    const state = gameState.getState();
    for (const sign of this.regionSigns.values()) sign.refresh(state);
    for (const [id, dim] of this.regionDims) {
      if (state.regionsUnlocked.includes(id)) {
        dim.destroy();
        this.regionDims.delete(id);
      }
    }
  }

  /**
   * Fade out and destroy a region's dim overlay (T3.3b, ~400ms). Removed from
   * the map FIRST so `refreshRegionSigns` never yanks it mid-fade.
   */
  private fadeOutRegionDim(regionId: string): void {
    const dim = this.regionDims.get(regionId);
    if (dim === undefined) return;
    this.regionDims.delete(regionId);
    this.tweens.add({
      targets: dim,
      alpha: 0,
      duration: REGION_DIM_FADE_MS,
      ease: 'Sine.easeOut',
      onComplete: () => dim.destroy(),
    });
  }

  /**
   * A region sign's tap outcome (T3.3b): below the level gate -> refusal wiggle
   * + a "Reach level N" float; enough level but short on coins -> the expand
   * sign's insufficient-funds nudge; affordable -> purchase (no extra confirm -
   * the 5C grant popup is the ceremony), fanfare + buzz, dim fade, and the
   * one-time two-finger-pan hint armed for once the popup closes. The store's
   * `purchaseRegion` re-validates, so a refused purchase falls back to the
   * insufficient-funds nudge. Level is checked before coins to match the store.
   */
  private tryPurchaseRegion(region: RegionDef): void {
    const sign = this.regionSigns.get(region.id);
    const state = gameState.getState();
    if (state.regionsUnlocked.includes(region.id)) return;
    if (state.level < region.levelGate) {
      sign?.wiggle();
      this.worldFloatingText.show(
        region.signPosition.x,
        region.signPosition.y + REGION_SIGN_FEEDBACK_OFFSET_Y,
        `Reach level ${region.levelGate}`,
        REGION_REFUSAL_TEXT_OPTIONS,
      );
      return;
    }
    if (state.coins < region.costCoins || !gameState.purchaseRegion(region.id)) {
      sign?.flashInsufficientCoins();
      return;
    }
    this.audio.expandFanfare();
    buzz(HAPTIC_MEDIUM_MS);
    this.fadeOutRegionDim(region.id);
    sign?.refresh(gameState.getState());
    if (!gameState.getState().twoFingerHintShown) this.pendingTwoFingerHint = true;
  }

  /** Show the one-time two-finger-pan hint (T3.3b) and persist that it was shown. */
  private showTwoFingerHint(): void {
    this.uiFloatingText.show(
      TWO_FINGER_HINT_POSITION.x,
      TWO_FINGER_HINT_POSITION.y,
      TWO_FINGER_HINT_TEXT,
      TWO_FINGER_HINT_OPTIONS,
    );
    gameState.markTwoFingerHintShown();
  }

  /**
   * Re-derive placed decorations from state (T3.9): the simplest correct
   * thing at the placement-budget caps (T3.3a2) - rebuild the whole sprite (+
   * ground shadow) list whenever the decorations array differs from the last
   * render, rather than diffing entry by entry. Depth = own screen y, so
   * decorations iso-sort with crops/structures. Non-interactive in normal
   * play (arrange mode off): sprites gain no `setInteractive()` call until
   * `enterArrangeMode` adds it, and FarmScene's field gestures are scene-wide
   * pointer listeners hit-testing the iso grid, not per-object hit tests - so
   * a decoration drawn over a plot never intercepts a field tap either way.
   *
   * Skipped entirely while arrange mode is active: every position change during
   * a drag is applied directly to the live sprite (`commitDecorationTransform`)
   * rather than through this rebuild, which would otherwise destroy and recreate
   * the very sprite mid-drag (losing its drag state and the selection tint). An
   * undo instead rebuilds the sprites via `rebuildDecorationSpritesForArrange`.
   * `exitArrangeMode` re-syncs `lastDecorationsJson` so the next call here is
   * a correct no-op instead of a redundant rebuild.
   */
  private refreshDecorations(): void {
    if (this.arrangeModeActive) return;
    const decorations = gameState.getState().decorations;
    const json = JSON.stringify(decorations);
    if (json === this.lastDecorationsJson) return;
    this.lastDecorationsJson = json;
    for (const sprite of this.decorationSprites) sprite.destroy();
    for (const shadow of this.decorationShadowSprites) shadow?.destroy();
    this.decorationSprites = [];
    this.decorationShadowSprites = [];
    for (const decoration of decorations) {
      const sprite = this.createDecorationSprite(decoration);
      this.decorationSprites.push(sprite);
      this.decorationShadowSprites.push(this.createGroundShadow(sprite));
    }
  }

  /** A path sprite's map key - the tile it occupies (T4.12-r1). */
  private static pathKey(col: number, row: number): string {
    return `${col},${row}`;
  }

  /**
   * Draw ONE path tile's sprite (T4.12-r1), replacing any sprite already on
   * that tile so a repaint swaps tiers in place. The single place path art is
   * created, so the full rebuild and the incremental paint can never drift
   * apart on depth, origin, or flip.
   */
  private setPathSprite(tile: PathTile): void {
    const key = FarmScene.pathKey(tile.col, tile.row);
    this.pathSprites.get(key)?.destroy();
    const { x, y } = gridToIso(tile.col, tile.row);
    const { flipX, flipY } = pathTileFlip(tile.col, tile.row);
    // Origin (0.5, 0.5) on the tile CENTER: a path frame is the bare 256x128
    // diamond with no lip band, unlike grass/plot's 256x160 frames (which is
    // why this does not use TILE_ORIGIN_Y). See the packer's PATH_TILE_NAMES.
    this.pathSprites.set(
      key,
      this.add
        .image(x, y, ATLAS_KEY, PATH_TIERS[tile.tier].frame)
        .setOrigin(0.5, 0.5)
        .setFlip(flipX, flipY)
        .setDepth(PATH_LAYER_DEPTH),
    );
  }

  /** Destroy ONE path tile's sprite (T4.12-r1); a no-op if nothing is drawn there. */
  private clearPathSprite(col: number, row: number): void {
    const key = FarmScene.pathKey(col, row);
    this.pathSprites.get(key)?.destroy();
    this.pathSprites.delete(key);
  }

  /**
   * Redraw the WHOLE path layer from state (T4.12-r1). O(area), so it is only
   * ever for scene create and bulk reloads (see `refreshPaths`) - never for a
   * tile laid during a gesture, which goes through `setPathSprite`.
   */
  private rebuildPaths(): void {
    for (const sprite of this.pathSprites.values()) sprite.destroy();
    this.pathSprites.clear();
    const paths = gameState.getState().paths;
    for (const path of paths) this.setPathSprite(path);
    this.lastPathsRef = paths;
  }

  /**
   * Per-tick path-layer check (T4.12-r1). Painting and erasing draw their own
   * one tile incrementally (`setPathSprite`/`clearPathSprite`) while mutating
   * the existing `paths` array in place, so during a stroke both tests below
   * hold and this costs one reference compare and one length compare - frame
   * time does NOT grow with the painted area.
   *
   * It rebuilds on exactly two signals, both O(1) to test:
   * - a NEW paths array: every bulk change (load, migration, backup restore,
   *   import, reset) installs a fresh state object, so this catches all of
   *   them without diffing contents.
   * - sprite count disagreeing with tile count: a self-heal, so any future
   *   writer that changes `paths` without going through the paint gesture
   *   still renders correctly (one frame later) instead of silently drifting.
   *
   * Path sprites are never made interactive - the field's scene-wide gesture
   * classifier hit-tests the iso grid, so a path under a plot can never
   * intercept a farm tap.
   */
  private refreshPaths(): void {
    const paths = gameState.getState().paths;
    if (paths === this.lastPathsRef && paths.length === this.pathSprites.size) return;
    this.rebuildPaths();
  }

  /**
   * One decoration's sprite (T3.9a). No per-object listeners since
   * T3.3a-r3: arrange mode's tap-select and long-press lift both run
   * through the scene-level gesture classifier ('lift-pending'/'lift'),
   * which finds the sprite via the down's `currentlyOver` hit list - so
   * the sprite only needs to BE interactive, which `enterArrangeMode`
   * makes it for the mode's duration. While lifted it moves (re-deriving
   * its y depth and ground shadow) every frame in `updateLiftDrag`; the
   * position only commits to the store on release
   * (`commitDecorationTransform`).
   */
  private createDecorationSprite(decoration: DecorationPlacement): Phaser.GameObjects.Image {
    return this.add
      .image(decoration.x, decoration.y, ATLAS_KEY, decoration.frame)
      .setScale(decoration.scale)
      .setFlipX(decoration.flip)
      .setDepth(decoration.y);
  }

  /**
   * Commit a just-dragged decoration's position (T3.9a): `setDecorationTransform`
   * is the sole clamp authority, so this re-reads the (possibly clamped)
   * committed value from state and snaps the sprite (+ its shadow) to it,
   * rather than trusting the raw drag-drop coordinates - a drag past the
   * legal bounds visibly "sticks" at the clamp edge instead of leaving the
   * sprite wherever the finger let go.
   *
   * A REFUSED commit (T3.3s-r1b: the anchor landed on a permanent object's
   * footprint) re-derives the sprite from the decoration's UNCHANGED state
   * entry the same way - position, depth, scale, flip, shadow - so the
   * sprite snaps back to where state still says it stands instead of
   * staying visually parked on the structure, with the locked-plot wiggle
   * so the refusal reads as deliberate.
   */
  private commitDecorationTransform(index: number, sprite: Phaser.GameObjects.Image): void {
    const current = gameState.getState().decorations[index];
    if (current === undefined) return;
    const committed = gameState.setDecorationTransform(
      index,
      Math.round(sprite.x),
      Math.round(sprite.y),
      sprite.scale,
      current.flip,
    );
    // Committed or refused, state holds the truth - snap the sprite to it.
    const decoration = gameState.getState().decorations[index];
    if (decoration === undefined) return;
    sprite
      .setPosition(decoration.x, decoration.y)
      .setScale(decoration.scale)
      .setFlipX(decoration.flip)
      .setDepth(decoration.y);
    const shadow = this.decorationShadowSprites[index];
    if (shadow) this.applyGroundShadowGeometry(shadow, sprite);
    if (!committed) this.shakeLockedPlot(sprite);
  }

  /**
   * Flip action (T3.15; contextual-toolbar Flip since U3b): mirrors the
   * selected decoration's facing (`setFlipX`), persisted through
   * `setDecorationTransform` - a no-op with nothing selected.
   * Silhouette shadows (T3.3s-r2c) mirror the art itself, so the shadow's
   * geometry re-derives here too - its flipX must track the sprite's.
   */
  private toggleSelectedDecorationFlip(): void {
    if (this.selectedDecorationIndex === null) return;
    const index = this.selectedDecorationIndex;
    const sprite = this.decorationSprites[index];
    const decoration = gameState.getState().decorations[index];
    if (sprite === undefined || decoration === undefined) return;
    if (
      !gameState.setDecorationTransform(
        index,
        decoration.x,
        decoration.y,
        decoration.scale,
        !decoration.flip,
      )
    )
      return;
    const updated = gameState.getState().decorations[index];
    if (updated === undefined) return;
    sprite.setFlipX(updated.flip);
    const shadow = this.decorationShadowSprites[index];
    if (shadow) this.applyGroundShadowGeometry(shadow, sprite);
  }

  /**
   * Flip button, movable half (T4.8): mirrors the selected building or the
   * farmhouse, persisted through `flipBuilding`/`flipStructure`. A no-op with
   * nothing selected, or with a movable the Flip button never enables for (the
   * notice board) - re-checked here so the action cannot outlive a stale
   * enabled state.
   *
   * The new flipX goes straight onto the LIVE sprite rather than through
   * `refreshBuildings`: that pass rebuilds only when the saved POSITIONS change
   * (its key excludes `flipped` by design), and a rebuild would throw away the
   * selection and the tint mid-arrange for a purely visual change.
   *
   * The shadow is deliberately left alone (owner's call, an accepted
   * imperfection): unlike a decoration's mirrored silhouette, these are
   * AUTHORED ground casts, so mirroring one would light the building from the
   * wrong side rather than track it.
   */
  private toggleSelectedMovableFlip(): void {
    const ref = this.selectedStructureId;
    if (ref === null || !isFlippableMovable(ref)) return;
    const flipped =
      ref.kind === 'building' ? gameState.flipBuilding(ref.index) : gameState.flipStructure(ref.id);
    if (!flipped) return;
    const state = gameState.getState();
    const sprite = this.structureImage(ref);
    const placement =
      ref.kind === 'building' ? state.buildings[ref.index] : state.structures[ref.id];
    if (sprite === null || placement === undefined) return;
    sprite.setFlipX(placement.flipped);
  }

  /**
   * Highlights the tapped decoration with a tint; clears the previous
   * selection's tint first - mirrors `setDressingSelection`. Selecting a
   * decoration also deselects any selected plot (T3.3a - one selection at a
   * time across both kinds). Re-derives the contextual toolbar (U3b), which
   * floats above whatever is selected.
   */
  private setDecorationSelection(index: number | null): void {
    this.disarmCancel();
    if (index !== null) {
      this.clearPlotSelectionTint();
      this.clearStructureSelectionTint();
    }
    if (this.selectedDecorationIndex !== null) {
      this.decorationSprites[this.selectedDecorationIndex]?.clearTint();
    }
    this.selectedDecorationIndex = index;
    if (index !== null) {
      this.decorationSprites[index]?.setTint(DRESSING_SELECTED_TINT);
    }
    this.updateContextualToolbar();
  }

  /**
   * Select a plot (T3.3a): tints its tile, deselecting any decoration (and
   * the previous plot) first - the plot-side mirror of
   * `setDecorationSelection`, driving the same per-item button re-derive.
   */
  private setPlotSelection(index: number | null): void {
    this.disarmCancel();
    if (index !== null) {
      if (this.selectedDecorationIndex !== null) {
        this.decorationSprites[this.selectedDecorationIndex]?.clearTint();
        this.selectedDecorationIndex = null;
      }
      this.clearStructureSelectionTint();
    }
    this.clearPlotSelectionTint();
    this.selectedPlotIndex = index;
    this.applyPlotSelectionTint();
    this.updateContextualToolbar();
  }

  /** Clear the selected plot's tile tint and forget the selection index. */
  private clearPlotSelectionTint(): void {
    if (this.selectedPlotIndex === null) return;
    this.plotTileSprites[this.selectedPlotIndex]?.clearTint();
    this.selectedPlotIndex = null;
  }

  /** (Re-)tint the selected plot's own tile sprite (T3.3a-r: it travels with the plot). */
  private applyPlotSelectionTint(): void {
    if (this.selectedPlotIndex === null) return;
    this.plotTileSprites[this.selectedPlotIndex]?.setTint(DRESSING_SELECTED_TINT);
  }

  /**
   * Build the arrange-mode bottom bar once (U3b): [Shed] [Shop] [Undo] [Done],
   * with Done the single prominent confirm. Hidden and inert until
   * `enterArrangeMode` shows them. Each is a `panel` nineslice sized directly
   * to its display bounds, so its default hit area already covers that
   * rectangle - no custom hitArea needed. The per-item action row is gone: flip
   * and put away live in the contextual toolbar (`createContextualToolbar`),
   * and the resize controls were removed outright.
   */
  private createArrangeControls(): void {
    this.arrangeShedButton = this.buildArrangeBarButton(ARRANGE_SHED_X, ARRANGE_SHED_WIDTH);
    this.arrangeShedText = this.buildArrangeBarLabel(ARRANGE_SHED_X, 'Shed');
    this.arrangeShedButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.disarmCancel();
      this.audio.sfx('tap');
      this.toggleShedPanel();
    });
    // Live shed-count badge on the Shed button (U3b), re-derived on the tick.
    this.arrangeShedBadge = this.add
      .text(
        ARRANGE_SHED_X + ARRANGE_SHED_BADGE_OFFSET_X,
        ARRANGE_ROW2_Y + ARRANGE_SHED_BADGE_OFFSET_Y,
        '',
        ARRANGE_SHED_BADGE_STYLE,
      )
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 2)
      .setVisible(false);

    this.arrangeShopButton = this.buildArrangeBarButton(ARRANGE_SHOP_X, ARRANGE_SHOP_WIDTH);
    this.arrangeShopText = this.buildArrangeBarLabel(ARRANGE_SHOP_X, 'Shop');
    this.arrangeShopButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.disarmCancel();
      this.openDecorShopFromArrange();
    });

    this.arrangeUndoButton = this.buildArrangeBarButton(ARRANGE_UNDO_X, ARRANGE_UNDO_WIDTH);
    this.arrangeUndoText = this.buildArrangeBarLabel(ARRANGE_UNDO_X, 'Undo');
    this.arrangeUndoButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.handleUndo();
    });

    this.arrangeCancelButton = this.buildArrangeBarButton(ARRANGE_CANCEL_X, ARRANGE_CANCEL_WIDTH);
    this.arrangeCancelText = this.buildArrangeBarLabel(ARRANGE_CANCEL_X, ARRANGE_CANCEL_LABEL);
    this.arrangeCancelButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.handleCancelTap();
    });

    this.arrangeSaveButton = this.buildArrangeBarButton(ARRANGE_SAVE_X, ARRANGE_SAVE_WIDTH);
    this.arrangeSaveText = this.buildArrangeBarLabel(ARRANGE_SAVE_X, 'Save');
    this.arrangeSaveButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.exitArrangeMode();
    });

    // Chain placement (T3.3a-r): "Place Next xN", its own centered row above
    // the bar. Visibility/label/enabled state are owned entirely by
    // `updatePlaceNextButton` - it only exists during a placement session.
    this.arrangePlaceNextButton = this.add
      .nineslice(
        ARRANGE_PLACE_NEXT_X,
        ARRANGE_PLACE_NEXT_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_PLACE_NEXT_WIDTH,
        ARRANGE_ROW_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
    this.arrangePlaceNextText = this.add
      .text(ARRANGE_PLACE_NEXT_X, ARRANGE_PLACE_NEXT_Y, 'Place Next', ARRANGE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangePlaceNextButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.handlePlaceNext();
    });

    this.createShedPanel();
  }

  /** One bottom-bar `panel` nineslice button (U3b), hidden until shown. */
  private buildArrangeBarButton(x: number, width: number): Phaser.GameObjects.NineSlice {
    return this.add
      .nineslice(
        x,
        ARRANGE_ROW2_Y,
        ATLAS_KEY,
        'panel',
        width,
        ARRANGE_ROW_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
  }

  /** One bottom-bar button label (U3b), hidden until shown. */
  private buildArrangeBarLabel(x: number, text: string): Phaser.GameObjects.Text {
    return this.add
      .text(x, ARRANGE_ROW2_Y, text, ARRANGE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
  }

  /**
   * Build the contextual toolbar once (U3b): a small drawn-vector bar (U2b card
   * language) with a Flip and a Put away button, floating above the selected
   * asset. Created in the WORLD layer (NOT inside `inUiLayer`) so it tracks the
   * asset in world space; hidden and holding zero live hitboxes until a
   * selection with real actions shows it (`updateContextualToolbar`). Each
   * button is a drawn rounded rect + label with a paired invisible hit Zone -
   * the ShopPanel vector-chrome pattern, so the rounded art needs no
   * frame-relative hitArea.
   */
  private createContextualToolbar(): void {
    this.ctxToolbar = this.add.container(0, 0).setDepth(CTX_TOOLBAR_DEPTH).setVisible(false);

    this.ctxFlipBg = this.add.graphics();
    this.drawCtxButton(this.ctxFlipBg, CTX_FLIP_WIDTH);
    this.ctxFlipLabel = this.add.text(0, 0, 'Flip', CTX_LABEL_STYLE).setOrigin(0.5);
    this.ctxFlipZone = this.add.zone(0, 0, CTX_FLIP_WIDTH, CTX_BTN_HEIGHT);
    this.ctxFlipZone.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        this.audio.sfx('tap');
        this.flipSelected();
      },
    );

    this.ctxPutAwayBg = this.add.graphics();
    this.drawCtxButton(this.ctxPutAwayBg, CTX_PUT_AWAY_WIDTH);
    this.ctxPutAwayLabel = this.add.text(0, 0, 'Put away', CTX_LABEL_STYLE).setOrigin(0.5);
    this.ctxPutAwayZone = this.add.zone(0, 0, CTX_PUT_AWAY_WIDTH, CTX_BTN_HEIGHT);
    this.ctxPutAwayZone.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        this.audio.sfx('tap');
        this.putAwaySelected();
      },
    );

    this.ctxToolbar.add([
      this.ctxFlipBg,
      this.ctxFlipLabel,
      this.ctxFlipZone,
      this.ctxPutAwayBg,
      this.ctxPutAwayLabel,
      this.ctxPutAwayZone,
    ]);
    // Closed toolbar carries no live hitboxes (the hidden-hygiene rule).
    this.ctxFlipZone.disableInteractive();
    this.ctxPutAwayZone.disableInteractive();
  }

  /** Draw one contextual-toolbar button (parchment fill + brown rounded stroke). */
  private drawCtxButton(g: Phaser.GameObjects.Graphics, width: number): void {
    g.clear();
    g.fillStyle(CTX_BTN_FILL, 1);
    g.fillRoundedRect(-width / 2, -CTX_BTN_HEIGHT / 2, width, CTX_BTN_HEIGHT, CTX_BTN_RADIUS);
    g.lineStyle(CTX_BTN_STROKE_W, CTX_STROKE_BROWN, 1);
    g.strokeRoundedRect(-width / 2, -CTX_BTN_HEIGHT / 2, width, CTX_BTN_HEIGHT, CTX_BTN_RADIUS);
  }

  /**
   * Show/hide the bottom bar together (U3b), so a hidden control is never still
   * tappable. Undo's enabled/dim state is owned by `updateEditBarState` (it
   * follows `editUndoDepth`), called right after this on `enterArrangeMode`.
   */
  private setArrangeControlsVisible(visible: boolean): void {
    const controls: readonly [Phaser.GameObjects.NineSlice, Phaser.GameObjects.Text][] = [
      [this.arrangeShedButton, this.arrangeShedText],
      [this.arrangeShopButton, this.arrangeShopText],
      [this.arrangeUndoButton, this.arrangeUndoText],
      [this.arrangeCancelButton, this.arrangeCancelText],
      [this.arrangeSaveButton, this.arrangeSaveText],
    ];
    for (const [button, label] of controls) {
      button.setVisible(visible);
      label.setVisible(visible);
      if (visible) {
        button.setInteractive({ useHandCursor: true });
      } else {
        button.disableInteractive();
      }
    }
    this.arrangeShedBadge.setVisible(visible);
    // Cancel always starts disarmed when the bar is shown or hidden.
    if (!visible) this.disarmCancel();
    // The Place Next button (T3.3a-r) is session-owned: hidden with the bar
    // here, but only `updatePlaceNextButton` ever shows it.
    if (!visible) {
      this.arrangePlaceNextButton.setVisible(false);
      this.arrangePlaceNextText.setVisible(false);
      this.arrangePlaceNextButton.disableInteractive();
    }
  }

  /**
   * Re-derive the bottom bar's per-tick state (U3b): the Undo button follows
   * `editUndoDepth` (enabled only above zero, dim otherwise) and the Shed badge
   * shows the live shed total. Cheap - called every arrange frame from
   * `update`.
   */
  private updateEditBarState(): void {
    const undoEnabled = gameState.editUndoDepth() > 0;
    const undoAlpha = undoEnabled ? ARRANGE_STORE_ENABLED_ALPHA : ARRANGE_STORE_DISABLED_ALPHA;
    this.arrangeUndoButton.setAlpha(undoAlpha);
    this.arrangeUndoText.setAlpha(undoAlpha);
    if (undoEnabled) {
      this.arrangeUndoButton.setInteractive({ useHandCursor: true });
    } else {
      this.arrangeUndoButton.disableInteractive();
    }
    const shedTotal = Object.values(gameState.getState().shedInventory).reduce(
      (sum, count) => sum + count,
      0,
    );
    this.arrangeShedBadge
      .setText(shedTotal > 0 ? String(shedTotal) : '')
      .setVisible(this.arrangeModeActive && shedTotal > 0);
    // Cancel disarms itself once its confirm window lapses (U3b-r1).
    if (this.cancelArmedAt !== 0 && Date.now() - this.cancelArmedAt >= ARRANGE_CANCEL_ARM_MS) {
      this.disarmCancel();
    }
  }

  /** The Undo button (U3b): pop the last recorded arrange action and re-render. */
  private handleUndo(): void {
    this.disarmCancel();
    if (gameState.editUndoDepth() <= 0) return;
    this.audio.sfx('tap');
    if (!gameState.undoEditAction()) return;
    this.rerenderArrangeAfterUndo();
  }

  /**
   * Cancel button tap (U3b-r1): a two-tap confirm. First tap arms it (swaps the
   * label to the armed copy, records a real timestamp); a second tap within
   * ARRANGE_CANCEL_ARM_MS fires the full session unwind; a lapsed window
   * re-arms. Any OTHER input disarms it (see `disarmCancel` call sites). Cancel
   * at depth 0 just exits cleanly through the same unwind (an empty loop).
   */
  private handleCancelTap(): void {
    this.audio.sfx('tap');
    const now = Date.now();
    if (this.cancelArmedAt !== 0 && now - this.cancelArmedAt < ARRANGE_CANCEL_ARM_MS) {
      this.doCancelUnwind();
      return;
    }
    this.cancelArmedAt = now;
    this.arrangeCancelText.setText(ARRANGE_CANCEL_ARMED_LABEL);
  }

  /** Disarm the Cancel confirm (U3b-r1) - a no-op when it was not armed. */
  private disarmCancel(): void {
    if (this.cancelArmedAt === 0) return;
    this.cancelArmedAt = 0;
    this.arrangeCancelText.setText(ARRANGE_CANCEL_LABEL);
  }

  /**
   * Unwind the whole edit session and exit (U3b-r1): pop every recorded action
   * (undoEditAction discards each popped entry per U3a, so depth strictly
   * decreases and a refused inverse is simply skipped - loop to empty), re-render
   * the fully-unwound state, then leave edit mode. Purchases are NOT refunded
   * (they are not edit actions); a building bought this session lands in the
   * shed on unwind and is recoverable from the shed panel's building rows.
   */
  private doCancelUnwind(): void {
    this.disarmCancel();
    // The guard is belt-and-braces: undoEditAction always pops, so depth falls.
    let guard = 0;
    while (gameState.editUndoDepth() > 0 && guard < 1000) {
      gameState.undoEditAction();
      guard++;
    }
    this.rerenderArrangeAfterUndo();
    this.exitArrangeMode();
  }

  /**
   * Re-render every arrange visual from state after an undo (U3b). The tick's
   * `refreshDecorations` skips while arranging, and `refreshBuildings`/
   * `refreshStructures` key on positions only (a flip never changes their key),
   * so an undo that moves/flips/places/stores must be reflected here by hand.
   * Deselects first: the undone action may have moved or removed its target, so
   * the safe result is a clean slate with the contextual toolbar hidden.
   */
  private rerenderArrangeAfterUndo(): void {
    // An undo interrupts any chain-placement session.
    this.placementSession = null;
    this.sessionPlotIndices = [];
    this.lastPlacedDecorIndex = -1;
    this.setDecorationSelection(null);
    this.setPlotSelection(null);
    this.setStructureSelection(null);
    // Decorations: full sprite rebuild from state (the tick skips it in arrange).
    this.rebuildDecorationSpritesForArrange();
    // Buildings: force a rebuild so a put-away/move/flip all reflect (flip is
    // not in the positions key; a removal-to-empty would collide with the old
    // '' sentinel - see refreshBuildings).
    this.refreshBuildings(true);
    // Structures: reposition and re-apply flip from state.
    const structures = gameState.getState().structures;
    this.applyStructureStatePosition(FARMHOUSE_REF);
    this.applyStructureStatePosition(NOTICE_BOARD_REF);
    this.structureImage(FARMHOUSE_REF)?.setFlipX(structures.farmhouse.flipped);
    this.structureImage(NOTICE_BOARD_REF)?.setFlipX(structures.noticeBoard.flipped);
    // Plots: reposition tiles + crops from state.
    this.refreshCrops();
    this.refreshArrangePlotInteractivity();
    this.updatePlaceNextButton();
  }

  /**
   * Rebuild every decoration sprite from state (U3b), bypassing the tick's
   * arrange-mode skip - mirrors `refreshDecorations`'s loop but re-asserts
   * interactivity for the mode. Used after an undo, where the decorations array
   * can have changed in ways the incremental place/store paths did not mirror.
   */
  private rebuildDecorationSpritesForArrange(): void {
    for (const sprite of this.decorationSprites) sprite.destroy();
    for (const shadow of this.decorationShadowSprites) shadow?.destroy();
    this.decorationSprites = [];
    this.decorationShadowSprites = [];
    for (const decoration of gameState.getState().decorations) {
      const sprite = this.createDecorationSprite(decoration);
      sprite.setInteractive();
      this.decorationSprites.push(sprite);
      this.decorationShadowSprites.push(this.createGroundShadow(sprite));
    }
  }

  /**
   * Re-derive the contextual toolbar every arrange frame (U3b): hidden with no
   * live hitboxes unless the selection has actions, otherwise floated just
   * above the selected/lifted asset with exactly its valid buttons. Flip shows
   * for a flippable asset (decor; buildings; farmhouse - `isFlippableMovable`
   * is the authority); Put away shows for a DECORATION only (U3b-r1 exempts
   * buildings). Plots and the notice board have no actions, so the toolbar hides.
   */
  private updateContextualToolbar(): void {
    // Hide (and drop hitboxes) when not arranging, or when a modal is open over
    // the field (U3b-r1): the shop/shed panel opened from arrange must not leave
    // the toolbar floating - and tappable - beneath it (the paint-bar leak's
    // sibling; the shop is UI-layer and always renders above this world-layer bar).
    if (!this.arrangeModeActive || isModalOpen()) {
      this.hideContextualToolbar();
      return;
    }
    const target = this.contextualTarget();
    if (target === null) {
      this.hideContextualToolbar();
      return;
    }
    const { obj, showFlip, showPutAway } = target;
    // Centre the visible button(s) as one row in the toolbar's local space.
    const buttons: { isFlip: boolean; width: number }[] = [];
    if (showFlip) buttons.push({ isFlip: true, width: CTX_FLIP_WIDTH });
    if (showPutAway) buttons.push({ isFlip: false, width: CTX_PUT_AWAY_WIDTH });
    const total = buttons.reduce((sum, b) => sum + b.width, 0) + CTX_BTN_GAP * (buttons.length - 1);
    let cursor = -total / 2;
    let flipX = 0;
    let putAwayX = 0;
    for (const b of buttons) {
      const centre = cursor + b.width / 2;
      if (b.isFlip) flipX = centre;
      else putAwayX = centre;
      cursor += b.width + CTX_BTN_GAP;
    }
    // Float above the asset's visible top edge (world coords - the toolbar is a
    // world-layer object, so it tracks the asset with no camera maths).
    const topY = obj.y - obj.displayOriginY;
    this.ctxToolbar
      .setPosition(obj.x, topY - CTX_TOOLBAR_GAP - CTX_BTN_HEIGHT / 2)
      .setVisible(true);

    this.ctxFlipBg.setPosition(flipX, 0).setVisible(showFlip);
    this.ctxFlipLabel.setPosition(flipX, 0).setVisible(showFlip);
    this.ctxFlipZone.setPosition(flipX, 0);
    if (showFlip) this.ctxFlipZone.setInteractive({ useHandCursor: true });
    else this.ctxFlipZone.disableInteractive();

    // Put away shows for a decoration only (U3b-r1), always enabled when shown.
    this.ctxPutAwayBg.setPosition(putAwayX, 0).setVisible(showPutAway).setAlpha(1);
    this.ctxPutAwayLabel.setPosition(putAwayX, 0).setVisible(showPutAway).setAlpha(1);
    this.ctxPutAwayZone.setPosition(putAwayX, 0);
    if (showPutAway) this.ctxPutAwayZone.setInteractive({ useHandCursor: true });
    else this.ctxPutAwayZone.disableInteractive();
  }

  /** Hide the contextual toolbar and drop its live hitboxes (U3b). */
  private hideContextualToolbar(): void {
    this.ctxToolbar.setVisible(false);
    this.ctxFlipZone.disableInteractive();
    this.ctxPutAwayZone.disableInteractive();
  }

  /**
   * The asset the contextual toolbar attaches to, plus which of its buttons are
   * valid, or null when nothing actionable is selected. Decor: Flip + Put away.
   * Building: Flip ONLY (U3b-r1 owner override - buildings are never put away
   * from the UI; putAwayToShed survives only as the undo/Cancel inverse).
   * Farmhouse: Flip only. Notice board and plots: no actions -> hidden.
   */
  private contextualTarget(): {
    obj: Phaser.GameObjects.Image;
    showFlip: boolean;
    showPutAway: boolean;
  } | null {
    if (this.selectedDecorationIndex !== null) {
      const obj = this.decorationSprites[this.selectedDecorationIndex];
      if (obj === undefined) return null;
      return { obj, showFlip: true, showPutAway: true };
    }
    const ref = this.selectedStructureId;
    if (ref !== null) {
      const obj = this.structureImage(ref);
      if (obj === null) return null;
      const showFlip = isFlippableMovable(ref);
      // No building/structure ever offers Put away from the UI (U3b-r1).
      if (!showFlip) return null;
      return { obj, showFlip, showPutAway: false };
    }
    return null;
  }

  /** Contextual-toolbar Flip (U3b): decor flips through its transform setter,
   *  a movable through its own flag - a true either/or given one selection. */
  private flipSelected(): void {
    if (this.selectedDecorationIndex !== null) this.toggleSelectedDecorationFlip();
    else this.toggleSelectedMovableFlip();
    this.updateContextualToolbar();
  }

  /** Contextual-toolbar Put away (U3b): decorations only (U3b-r1 exempts
   *  buildings) - stores the selection and plays the fly-to-Shed flight. */
  private putAwaySelected(): void {
    if (this.selectedDecorationIndex !== null) this.storeSelectedDecoration();
  }

  /**
   * Fly a put-away item's icon from where it stood to the bottom bar's Shed
   * button, then bounce the button (U3b) - reuses the shop's fly-to-chip
   * pattern (one plain Image, one tween, no per-frame Graphics redraws). The
   * fly image lives in the UI layer at SCREEN coordinates (the asset's world
   * position projected through the camera), so it lands on the fixed bar.
   */
  private flyPutAwayToShed(
    frame: string,
    screenX: number,
    screenY: number,
    displaySize: number,
  ): void {
    const fly = this.inUiLayer(() =>
      this.add.image(screenX, screenY, ATLAS_KEY, frame).setDepth(PUT_AWAY_FLY_DEPTH),
    );
    fly.setScale(Math.max(0.05, displaySize / (fly.width || 1)));
    this.tweens.add({
      targets: fly,
      x: ARRANGE_SHED_X,
      y: ARRANGE_ROW2_Y,
      scale: PUT_AWAY_FLY_END_SCALE,
      alpha: 0.2,
      duration: PUT_AWAY_FLY_MS,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        fly.destroy();
        this.bounceShedButton();
      },
    });
  }

  /** A small scale pop on the Shed button + badge as its count ticks up (U3b). */
  private bounceShedButton(): void {
    this.tweens.add({
      targets: [this.arrangeShedButton, this.arrangeShedText, this.arrangeShedBadge],
      scale: SHED_BUTTON_BOUNCE_SCALE,
      duration: SHED_BUTTON_BOUNCE_MS,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.arrangeShedButton.setScale(1);
        this.arrangeShedText.setScale(1);
        this.arrangeShedBadge.setScale(1);
      },
    });
  }

  /**
   * Project a world point to screen (UI-layer) coordinates (U3b): the world
   * camera zooms around its own `midPoint`, and the UI camera is fixed with
   * identical geometry, so this is the exact inverse of `cameras.main`'s
   * transform. Equal to the world point at the default view. Used to launch the
   * put-away flight from the asset's on-screen position.
   */
  private worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return {
      x: (worldX - cam.midPoint.x) * cam.zoom + cam.width / 2,
      y: (worldY - cam.midPoint.y) * cam.zoom + cam.height / 2,
    };
  }

  /**
   * The HUD's "Edit Layout" button (T3.25): a single control that opens
   * arrange mode from the farm and closes it while arranging (the button is
   * on the arrange-mode exempt list, so it stays tappable throughout).
   */
  private toggleArrangeMode(): void {
    // Paint mode owns the field's gestures and the same control band arrange
    // wants; leaving it first is what keeps the two mutually exclusive
    // (the dressing/arrange refusal precedent in `setDressingEditActive`).
    if (this.pathModeActive()) this.exitPathMode();
    if (this.arrangeModeActive) {
      this.exitArrangeMode();
    } else {
      this.enterArrangeMode();
    }
  }

  /** Whether path paint mode (T4.12) is active - `pathModeTier` is the flag. */
  private pathModeActive(): boolean {
    return this.pathModeTier !== null;
  }

  /**
   * Enter the persistent path paint mode (T4.12), from the Paths panel's
   * per-tier button (already closed by then). The player stays in this mode
   * laying tile after tile - it is NOT a one-shot purchase - until the HUD
   * bar's Done button (or anything else that calls `exitPathMode`) leaves it.
   *
   * Mutually exclusive with arrange and dressing edit: those two sweep every
   * hitbox in the scene through `setOtherHitboxesEnabled`, whose restore pass
   * assumes one mode at a time, so paint mode leaves arrange first rather
   * than interleaving. Paint mode itself needs NO hitbox sweep: it acts only
   * through the scene-wide field gesture classifier, which every other mode
   * already gates on.
   *
   * Inert during the tutorial: the Shop button that reaches the Paths panel
   * only exists post-onboarding (Hud.applyShopVisibility), and the field
   * gates below re-check the rails anyway.
   */
  private enterPathMode(tier: PathTierId): void {
    if (this.arrangeModeActive) this.exitArrangeMode();
    if (!gameState.getState().onboarding.completed) return;
    this.pathModeTier = tier;
    this.pathGestureVisited.clear();
    this.pathLastCell = null;
    this.setStructureSelection(null);
    this.selectedDecorationIndex = null;
    this.selectedPlotIndex = null;
    this.seedBar.setVisible(false);
    this.hud.setPathModeActive(true);
  }

  /** Leave path paint mode (T4.12) and restore normal play. */
  private exitPathMode(): void {
    if (!this.pathModeActive()) return;
    this.pathModeTier = null;
    this.pathGestureVisited.clear();
    this.pathLastCell = null;
    this.hud.setPathModeActive(false);
    this.seedBar.setVisible(true);
  }

  /**
   * Paint (or erase) the path tile under a screen point (T4.12) - the paint
   * mode's per-tile action, called on the gesture's first contact and again
   * for each NEW tile a drag crosses.
   *
   * The store is the sole authority on whether the tile lays and what it
   * costs: a refusal (short coins, off-grid) simply shows nothing, the same
   * feel as failing to plant. A successful PAID placement floats "-N" at the
   * tile; the free tier (dirt) floats nothing, and neither does a same-tier
   * repaint - the store refuses it, so there is no float and no second charge.
   */
  private paintPathAt(worldX: number, worldY: number): void {
    const tier = this.pathModeTier;
    if (tier === null) return;
    const { col, row } = isoToGrid(worldX, worldY);
    const target = { col: Math.round(col), row: Math.round(row) };
    // Fill in the cells between the last sample and this one (T4.12-r1): a
    // pointer move stream is sampled, not continuous, so a fast drag jumps
    // several cells per event and painting only the sampled cell leaves a
    // dotted run. `gridCellLine` walks the 4-connected line so consecutive
    // tiles share an edge. The first sample of a gesture has nothing to
    // interpolate from and paints its own cell alone.
    const cells = this.pathLastCell === null ? [target] : gridCellLine(this.pathLastCell, target);
    this.pathLastCell = target;

    const erasing = this.hud.isPathEraseActive();
    const cost = PATH_TIERS[tier].costCoins;
    let changed = false;
    for (const cell of cells) {
      const key = FarmScene.pathKey(cell.col, cell.row);
      if (this.pathGestureVisited.has(key)) continue;
      this.pathGestureVisited.add(key);
      if (erasing) {
        if (!gameState.erasePath(cell.col, cell.row)) continue;
        this.clearPathSprite(cell.col, cell.row);
        changed = true;
        continue;
      }
      if (!gameState.paintPath(cell.col, cell.row, tier)) continue;
      // Draw just this tile - never a whole-layer rebuild mid-stroke.
      this.setPathSprite({ col: cell.col, row: cell.row, tier });
      changed = true;
      if (cost > 0) {
        const { x, y } = gridToIso(cell.col, cell.row);
        this.worldFloatingText.show(x, y + XP_LABEL_OFFSET_Y, `-${cost}`, PLANT_COST_TEXT_OPTIONS);
      }
    }
    // Feedback fires once per POINTER EVENT, not once per tile: one fast move
    // can now lay a dozen tiles, and a dozen simultaneous taps/buzzes would
    // machine-gun. A tap or slow drag lays one tile per event, so those feel
    // exactly as before.
    if (!changed) return;
    this.audio.sfx('tap');
    buzz(HAPTIC_LIGHT_MS);
  }

  /**
   * Enter arrange mode (T3.9a): called by the Decor Shop's "Arrange Farm"
   * button (already closed by then). Makes every placed decoration
   * hit-testable for tap-select and long-press lift (T3.3a-r3 - the scene
   * classifier owns both; same for every plot-hosting tile, see
   * `refreshArrangePlotInteractivity`), hides the seed bar and
   * shows the floating control row in its band (T3.9b), and suppresses every
   * other interactive object in the scene (field gestures are gated
   * separately, in `handlePlotEntered`/`maybeShowCountdown`) - mirrors
   * `setDressingEditActive` exactly, just player-facing.
   */
  private enterArrangeMode(): void {
    this.arrangeModeActive = true;
    this.selectedDecorationIndex = null;
    this.selectedPlotIndex = null;
    this.selectedStructureId = null;
    // Start recording arrange actions' inverses onto the undo stack (U3b); every
    // exit path runs through `exitArrangeMode`, which ends the session.
    gameState.beginEditSession();
    this.seedBar.setVisible(false);
    for (const sprite of this.decorationSprites) sprite.setInteractive();
    // Buildings are already interactive outside the mode too (T4.2b - a tap
    // opens the mill panel), so this is a no-op re-assert kept for symmetry
    // with the decorations above and with the sweep's exempt list. No-arg
    // setInteractive PRESERVES the custom hit area (CLAUDE.md).
    for (const image of this.buildingImages) image.setInteractive();
    this.setArrangeControlsVisible(true);
    this.updateEditBarState();
    this.updateContextualToolbar();
    this.updatePlaceNextButton();
    this.setOtherHitboxesEnabled(
      false,
      this.arrangeExemptObjects(),
      this.arrangeModeDisabledObjects,
    );
    // AFTER the hitbox sweep, so the tiles are never swept into its disabled
    // list (they were inert when it snapshotted the interactive set).
    this.refreshArrangePlotInteractivity();
  }

  /**
   * Building fast path (U3b): the Shop just bought a building (via
   * `buyBuilding`, which appended it at its `defaultAnchor`) and closed. Drop
   * the player into arrange mode with the new building selected and "in hand" -
   * a selected movable lifts instantly on the next touch (T3.3a-r3c), which IS
   * "in hand" in this codebase; no new placement machinery. Handles being
   * called both from the farm (enter arrange fresh) and from an already-open
   * arrange session (buying via the arrange Shop's Buildings tab).
   */
  private enterArrangeWithBuilding(type: BuildingId): void {
    if (!this.arrangeModeActive) this.enterArrangeMode();
    // Force the new building's sprite to exist NOW so it can be selected (the
    // tick's `refreshBuildings` would otherwise create it a frame later).
    this.refreshBuildings(true);
    // The just-bought building is the newest placement of its type (buyBuilding
    // is one-per-type, so this is unambiguous).
    const buildings = gameState.getState().buildings;
    let index = -1;
    for (let i = buildings.length - 1; i >= 0; i--) {
      if (buildings[i]!.type === type) {
        index = i;
        break;
      }
    }
    if (index === -1) return;
    this.setStructureSelection({ kind: 'building', index });
  }

  /**
   * Exit arrange mode ("Done"): reverses `enterArrangeMode` exactly
   * (including closing the shed panel, if left open), then re-syncs
   * `lastDecorationsJson` from the current (already-committed and
   * already-rendered) state so `refreshDecorations`'s next call is a correct
   * no-op instead of an unnecessary rebuild.
   */
  private exitArrangeMode(): void {
    this.hideShedPanel();
    this.arrangeModeActive = false;
    // End the undo session (U3b): stop recording and discard the stack - undo
    // is a within-session affordance, and leaving commits the steps. This is
    // THE single exit path (Done, the Edit Layout toggle, and enterPathMode all
    // route here), so the session can never outlive the mode.
    gameState.endEditSession();
    this.hideContextualToolbar();
    // Chain placement session (T3.3a-r) ends with the mode; every spawn was
    // already committed, so ending mid-chain is safe - the Edit Layout flash
    // resumes for whatever remains in the shed.
    this.placementSession = null;
    this.sessionPlotIndices = [];
    this.lastPlacedDecorIndex = -1;
    this.setDecorationSelection(null);
    this.setPlotSelection(null);
    this.setStructureSelection(null);
    // A plot lift abandoned mid-exit never committed: snap the tile back to
    // its saved position AND back down from PLOT_LIFT_DEPTH to the ground
    // sub-layer band (T3.3b-r3) - state never changed, so the tick's
    // position compare cannot catch either.
    if (this.plotDragIndex !== null) {
      const plot = gameState.getState().plots[this.plotDragIndex];
      if (plot !== undefined) {
        const { x, y } = gridToIso(plot.col, plot.row);
        this.plotTileSprites[this.plotDragIndex]?.setPosition(x, y).setDepth(this.plotTileDepth(y));
      }
    }
    this.plotDragIndex = null;
    this.structureDragId = null;
    // A lift can only be pending/active mid-exit via a second finger on
    // Done (T3.3a-r3); drop it cleanly - nothing was committed yet, and the
    // gesture's own move/up handlers self-resolve on the dead mode flag.
    this.cancelPendingLift();
    this.activeLift = null;
    this.settleLiftPulse();
    // Lift-time overlays die with the mode (T3.3s-r2) - both are no-ops
    // when no lift was in flight at exit.
    this.hidePlacementGrid();
    this.destroyStructureFootprintPreview();
    // A structure lift abandoned mid-exit never committed: snap both
    // structures back to their saved anchors (a no-op when nothing moved -
    // the state-change refresh can't catch this, state never changed).
    this.applyStructureStatePosition(FARMHOUSE_REF);
    this.applyStructureStatePosition(NOTICE_BOARD_REF);
    // Same for a building lift abandoned mid-exit (T4.1).
    for (let index = 0; index < this.buildingImages.length; index++) {
      this.applyStructureStatePosition({ kind: 'building', index });
    }
    for (const sprite of this.decorationSprites) sprite.disableInteractive();
    // Buildings deliberately stay interactive here (T4.2b): outside arrange
    // mode a tap opens the mill panel, so turning them off on exit would kill
    // that. Nothing leaks - their deferred-tap handler was inert all through
    // the mode (`handleStructureDown` self-gates on `arrangeModeActive`).
    // Plot tiles go inert again (T3.3a). They are exempt from the enter
    // sweep (see `arrangeExemptObjects`), so the restore pass below can
    // never re-enable them behind this - root-caused live: a once-arranged
    // tile stays in Phaser's interactive `_list` even while disabled, so a
    // SECOND arrange session's sweep would otherwise catalog it as
    // "disabled by the sweep" and wrongly restore it on exit, leaving
    // invisible tile hitboxes that eat every field tap.
    for (const tile of this.plotTileSprites) tile.disableInteractive();
    this.setArrangeControlsVisible(false);
    this.seedBar.setVisible(true);
    this.setOtherHitboxesEnabled(true, [], this.arrangeModeDisabledObjects);
    this.lastDecorationsJson = JSON.stringify(gameState.getState().decorations);
  }

  /** Objects `setOtherHitboxesEnabled` must never disable while arrange mode is active. */
  private arrangeExemptObjects(): Phaser.GameObjects.GameObject[] {
    return [
      ...this.decorationSprites,
      // Movable structures (T3.3s): stay interactive through arrange mode
      // so the classifier can hit-test them for select/lift; their own
      // deferred-tap handler self-gates on `arrangeModeActive`, so nothing
      // can open through them mid-arrange.
      this.farmhouseImage,
      this.noticeBoardImage,
      // Buildings (T4.1): same rule - enterArrangeMode turns them on and the
      // sweep must not turn them back off behind it.
      ...this.buildingImages,
      // Owned entirely by refreshArrangePlotInteractivity/exitArrangeMode
      // (T3.3a) - the sweep must neither disable nor, crucially, RESTORE
      // them (see exitArrangeMode's comment).
      ...this.plotTileSprites,
      this.arrangePlaceNextButton,
      this.arrangeShedButton,
      this.arrangeShopButton,
      this.arrangeUndoButton,
      this.arrangeCancelButton,
      this.arrangeSaveButton,
      // Contextual toolbar zones (U3b): they only become interactive once a
      // selection shows them, AFTER this sweep snapshots the interactive set,
      // so they are exempt here belt-and-braces.
      this.ctxFlipZone,
      this.ctxPutAwayZone,
      this.hud.getArrangeToggleButton(),
      // T3.4b: camera gestures stay active while arranging, so recentering
      // must too (its own visibility logic still hides it at the default view).
      this.recenterButton,
    ];
  }

  /**
   * Contextual-toolbar Put away for a decoration (T3.9b; U3b adds the flight):
   * returns the selected decoration to the shed. No-op with nothing selected
   * (the button is only shown for a decoration - belt-and-braces). Captures the
   * sprite's on-screen position for the fly-to-Shed flight BEFORE destroying
   * it, then destroys the sprite/shadow and splices both parallel arrays at
   * `index`, keeping them aligned with the store's own `decorations.splice` -
   * every other sprite's index is derived fresh via `indexOf` at use time (see
   * `createDecorationSprite`), never cached, so the shift is transparent.
   */
  private storeSelectedDecoration(): void {
    if (this.selectedDecorationIndex === null) return;
    const index = this.selectedDecorationIndex;
    const sprite = this.decorationSprites[index];
    const frame = gameState.getState().decorations[index]?.frame;
    // Capture the flight source before the store mutates and the sprite dies.
    const centre = sprite?.getCenter();
    const screen = centre === undefined ? null : this.worldToScreen(centre.x, centre.y);
    const displaySize = sprite === undefined ? 0 : sprite.displayWidth * this.cameras.main.zoom;
    if (!gameState.storeDecoration(index)) return;
    this.setDecorationSelection(null);
    this.decorationSprites[index]?.destroy();
    this.decorationShadowSprites[index]?.destroy();
    this.decorationSprites.splice(index, 1);
    this.decorationShadowSprites.splice(index, 1);
    // The splice shifts indices after `index` - keep the chain session's
    // decor anchor pointing at the same placement (T3.3a-r); putting the
    // anchor itself away just re-anchors the next chain at the default spawn.
    if (this.lastPlacedDecorIndex === index) this.lastPlacedDecorIndex = -1;
    else if (this.lastPlacedDecorIndex > index) this.lastPlacedDecorIndex--;
    if (this.shedPanelVisible) this.refreshShedPanel();
    if (frame !== undefined && screen !== null) {
      this.flyPutAwayToShed(frame, screen.x, screen.y, displaySize);
    }
  }

  /**
   * Spawn the live sprite (+ shadow) for a decoration `placeFromShed`
   * just appended to `gameState`, wired for arrange mode exactly like the
   * sprites `enterArrangeMode` already made interactive, and select it -
   * mirrors `refreshDecorations`'s per-entry creation, but for the single
   * new entry rather than a full rebuild (which `refreshDecorations` itself
   * skips entirely while arrange mode is active).
   */
  private spawnPlacedDecorationSprite(index: number): void {
    const decoration = gameState.getState().decorations[index];
    if (decoration === undefined) return;
    const sprite = this.createDecorationSprite(decoration);
    sprite.setInteractive();
    this.decorationSprites.push(sprite);
    this.decorationShadowSprites.push(this.createGroundShadow(sprite));
    this.setDecorationSelection(index);
  }

  /**
   * Live snap of an in-flight plot lift (T3.3a-r): hovering a NEW tile that
   * is free (`isPlotTileFree`, with the lifted plot itself exempt) jumps the
   * plot's own tile sprite there instantly - always tile center to tile
   * center, never free-form pixels; the snap is an alignment assist, not a
   * boundary. Anything else (unplaceable, occupied, under a structure or
   * decor anchor) keeps the current snap, so the plot is always parked
   * somewhere legal.
   */
  private updatePlotDragSnap(col: number, row: number): void {
    if (this.plotDragIndex === null) return;
    if (col === this.plotDragCol && row === this.plotDragRow) return;
    const state = gameState.getState();
    const isHome =
      state.plots[this.plotDragIndex]?.col === col && state.plots[this.plotDragIndex]?.row === row;
    if (!isHome && !isPlotTileFree(state, col, row, this.plotDragIndex)) return;
    this.plotDragCol = col;
    this.plotDragRow = row;
    const { x, y } = gridToIso(col, row);
    this.plotTileSprites[this.plotDragIndex]?.setPosition(x, y).setDepth(PLOT_LIFT_DEPTH);
  }

  /**
   * Commit the lift (T3.3a): `movePlot` validates once more and persists;
   * the visuals then re-derive from the committed state - the tile sprite
   * snaps to wherever state actually says (position compares in
   * `syncPlotVisuals` cannot catch a refused commit, since state never
   * changed), plus selection tint and crop positions - so the render can
   * never drift from the save even if the commit is refused.
   */
  private commitPlotDrag(): void {
    const index = this.plotDragIndex;
    if (index === null) return;
    this.plotDragIndex = null;
    gameState.movePlot(index, this.plotDragCol, this.plotDragRow);
    const plot = gameState.getState().plots[index];
    if (plot !== undefined) {
      const { x, y } = gridToIso(plot.col, plot.row);
      this.plotTileSprites[index]?.setPosition(x, y).setDepth(this.plotTileDepth(y));
    }
    this.setPlotSelection(index);
    this.refreshCrops();
    this.applyPlotSelectionTint();
    this.refreshArrangePlotInteractivity();
  }

  /**
   * Free-follow structure drag (T3.3s-r2): the lifted structure's sprite
   * (+ shadow, + the board's badge) tracks the finger exactly like a
   * decoration - position, y-derived depth, and shadow geometry re-derive
   * every move. The badge repositions WITHOUT its bounce tween (killed at
   * lift start; the commit's `placeNoticeBoardBadge` rebuilds it) so the
   * absolute-y yoyo cannot fight the drag.
   */
  private moveStructureSpriteFree(ref: MovableAnchorRef, x: number, y: number): void {
    const image = this.structureImage(ref);
    if (image === null) return;
    // T3.27: (x, y) is the dragged GROUND point, in the same coordinates
    // `structureRenderPosition` returns - the T3.25 nominal-vs-shifted split is
    // gone, so a drag needs no per-look bookkeeping.
    image.setPosition(x, y).setDepth(this.structureDepthFor(ref, y));
    const shadow = this.structureShadow(ref);
    if (shadow !== null) this.applyStructureShadowGeometry(shadow, image);
    // The indicators track a mill THROUGH the drag (T4.2b) - no tween to fight
    // here, unlike the board's badge below (see BUILDING_BADGE_GAP).
    if (ref.kind === 'building') this.placeBuildingIndicators(ref.index);
    if (ref.kind !== 'structure') return;
    // T3.26: keep the dev knobs applied through a drag - see placeStructureSprite.
    if (ref.id === 'farmhouse') this.applyFarmhouseDevTransform();
    if (ref.id === 'noticeBoard') {
      const { x: badgeX, y: badgeY } = this.noticeBoardBadgeBase();
      this.noticeBoardBadge.setPosition(badgeX, badgeY).setDepth(y + 1);
    }
  }

  /**
   * Commit the structure lift (T3.3s-r2 free-follow): the nearest LEGAL
   * anchor within STRUCTURE_SNAP_RADIUS of the drop point wins
   * (`moveStructure` validates once more and persists); no anchor in range -
   * or a refused commit - wiggles the sprite and snaps it home, since the
   * visuals always re-derive from committed state. The dropped structure
   * stays selected, so it regrabs instantly (the plot convention).
   */
  private commitStructureDrag(): void {
    const ref = this.structureDragId;
    if (ref === null) return;
    this.structureDragId = null;
    this.destroyStructureFootprintPreview();
    const image = this.structureImage(ref);
    if (image === null) return;
    const target = this.nearestLegalAnchor(ref, image.x, image.y);
    // T4.1: buildings commit through `moveBuilding`, the building twin of
    // `moveStructure` - both re-validate and persist, so the store stays the
    // single rule authority for either kind.
    const moved =
      target !== null &&
      (ref.kind === 'structure'
        ? gameState.moveStructure(ref.id, target.col, target.row)
        : gameState.moveBuilding(ref.index, target.col, target.row));
    this.applyStructureStatePosition(ref);
    if (!moved) this.shakeLockedPlot(image);
    this.setStructureSelection(ref);
  }

  /**
   * The legal anchor nearest the drop point (T3.3s-r2), or null when none
   * lies within STRUCTURE_SNAP_RADIUS. Distance is measured between the
   * drop's IDEAL anchor-tile center (drop position minus the fixed render
   * offset) and each candidate anchor's tile center - identical to "anchor
   * render position vs drop position", just offset-free. Candidates come
   * from a fixed window around the ideal center (STRUCTURE_SNAP_SEARCH
   * always covers the radius); `isStructureAnchorFree` stays the one
   * legality authority.
   */
  private nearestLegalAnchor(
    ref: MovableAnchorRef,
    x: number,
    y: number,
  ): { col: number; row: number } | null {
    const offset = this.movableRenderOffset(ref);
    const idealX = x - offset.x;
    const idealY = y - offset.y;
    const center = isoToGrid(idealX, idealY);
    const centerCol = Math.round(center.col);
    const centerRow = Math.round(center.row);
    const state = gameState.getState();
    let best: { col: number; row: number } | null = null;
    let bestDistSq = STRUCTURE_SNAP_RADIUS * STRUCTURE_SNAP_RADIUS;
    for (
      let col = centerCol - STRUCTURE_SNAP_SEARCH;
      col <= centerCol + STRUCTURE_SNAP_SEARCH;
      col++
    ) {
      for (
        let row = centerRow - STRUCTURE_SNAP_SEARCH;
        row <= centerRow + STRUCTURE_SNAP_SEARCH;
        row++
      ) {
        const c = gridToIso(col, row);
        const distSq = (c.x - idealX) ** 2 + (c.y - idealY) ** 2;
        if (distSq > bestDistSq) continue;
        if (!this.movableAnchorFree(ref, state, col, row)) continue;
        bestDistSq = distSq;
        best = { col, row };
      }
    }
    return best;
  }

  /**
   * The placeable hidden-grid tile set as "col,row" keys (T3.3b: region-aware).
   * Rebuilt whenever `regionsUnlocked` changes - so a region purchase opens the
   * band to the structure preview / dev overlay without a reload - and cached
   * by that signature otherwise.
   */
  private getPlaceableTileKeys(): Set<string> {
    const regionsUnlocked = gameState.getState().regionsUnlocked;
    const sig = regionsUnlocked.join('|');
    if (this.placeableTileKeys === null || sig !== this.placeableTileKeysSig) {
      this.placeableTileKeysSig = sig;
      this.placeableTileKeys = new Set(
        placeablePlotTiles(regionsUnlocked).map((tile) => `${tile.col},${tile.row}`),
      );
    }
    return this.placeableTileKeys;
  }

  /**
   * Whether ONE footprint tile of structure `id` is legal ground
   * (T3.3s-r2): the per-tile half of `isStructureAnchorFree`, so the live
   * drag preview can show WHICH tile refuses. MUST MATCH that function's
   * rules (placeable domain, plots, the OTHER structure's live footprint,
   * the expand sign while it stands; decor never blocks structures) - an
   * anchor is legal exactly when every footprint tile passes this.
   */
  private structureTileFree(ref: MovableAnchorRef, col: number, row: number): boolean {
    const state = gameState.getState();
    if (!this.getPlaceableTileKeys().has(`${col},${row}`)) return false;
    for (const plot of state.plots) {
      if (plot.col === col && plot.row === row) return false;
    }
    // Every OTHER permanent footprint blocks (T4.1: both fixed structures and
    // every other building) - the lifted piece is exempt from its own, exactly
    // the self-exemption the store's authority applies.
    for (const other of this.otherFootprintTiles(ref, state)) {
      if (other.col === col && other.row === row) return false;
    }
    if (!state.expanded) {
      for (const tile of EXPAND_SIGN_BLOCKED_TILES) {
        if (tile.col === col && tile.row === row) return false;
      }
    }
    return true;
  }

  /**
   * The absolute footprint tiles of every permanent object EXCEPT `ref`
   * (T4.1) - the preview's mirror of the store's `permanentFootprints`
   * self-exemption. MUST MATCH `isStructureAnchorFree`/`isBuildingAnchorFree`,
   * which is exactly why `movableAnchorFree` below delegates to them for the
   * real verdict and this only explains WHICH tile refuses.
   */
  private otherFootprintTiles(
    ref: MovableAnchorRef,
    state: Readonly<ReturnType<typeof gameState.getState>>,
  ): { col: number; row: number }[] {
    const tiles: { col: number; row: number }[] = [];
    for (const id of ['farmhouse', 'noticeBoard'] as const) {
      if (ref.kind === 'structure' && ref.id === id) continue;
      tiles.push(...structureFootprintTiles(id, state.structures[id]));
    }
    for (let index = 0; index < state.buildings.length; index++) {
      if (ref.kind === 'building' && ref.index === index) continue;
      const placement = state.buildings[index]!;
      tiles.push(...buildingFootprintTiles(placement.type, placement));
    }
    return tiles;
  }

  /** THE legality verdict for a movable's anchor - straight through to the
   *  store's per-kind authority, never re-derived here. */
  private movableAnchorFree(
    ref: MovableAnchorRef,
    state: Readonly<ReturnType<typeof gameState.getState>>,
    col: number,
    row: number,
  ): boolean {
    if (ref.kind === 'structure') return isStructureAnchorFree(state, ref.id, col, row);
    const placement = state.buildings[ref.index];
    if (placement === undefined) return false;
    return isBuildingAnchorFree(state, placement.type, col, row, ref.index);
  }

  /**
   * Live footprint preview (T3.3s-r2; raised above ALL field objects in
   * T3.3b-r2): for the anchor nearest the lifted structure's current
   * position (`structureDragCol/Row`), fill each footprint tile's diamond
   * green (free) or red (blocked). Sits at the flat FOOTPRINT_PREVIEW_DEPTH,
   * clear of every plot tile, crop and decoration a footprint can overlap,
   * so a blocked tile ALWAYS reads as red shading over whatever occupies it
   * - the earlier "just under the lifted structure" depth hid the red under
   * any plot standing in front of the structure. Rebuilt only when the
   * nearest anchor changes; destroyed when the lift ends.
   */
  private rebuildStructureFootprintPreview(ref: MovableAnchorRef): void {
    this.structureFootprintGraphics?.destroy();
    const graphics = this.add.graphics().setDepth(FOOTPRINT_PREVIEW_DEPTH);
    this.structureFootprintGraphics = graphics;
    for (const offset of this.movableFootprintOffsets(ref)) {
      const col = this.structureDragCol + offset.col;
      const row = this.structureDragRow + offset.row;
      const free = this.structureTileFree(ref, col, row);
      graphics.fillStyle(
        free ? FOOTPRINT_FREE_COLOR : FOOTPRINT_BLOCKED_COLOR,
        FOOTPRINT_FILL_ALPHA,
      );
      this.fillTileDiamond(graphics, col, row);
    }
  }

  /** Destroy the live footprint preview (no-op when none is showing). */
  private destroyStructureFootprintPreview(): void {
    this.structureFootprintGraphics?.destroy();
    this.structureFootprintGraphics = null;
  }

  /** Fill tile (col, row)'s diamond into `graphics` (fill style pre-set). */
  private fillTileDiamond(graphics: Phaser.GameObjects.Graphics, col: number, row: number): void {
    const { x, y } = gridToIso(col, row);
    graphics.beginPath();
    graphics.moveTo(x - TILE_WIDTH / 2, y);
    graphics.lineTo(x, y - TILE_HEIGHT / 2);
    graphics.lineTo(x + TILE_WIDTH / 2, y);
    graphics.lineTo(x, y + TILE_HEIGHT / 2);
    graphics.closePath();
    graphics.fillPath();
  }

  /**
   * Faint placement grid (T3.3s-r2 change 5): thin diamond outlines over
   * EXACTLY the placeable tile set (never a tile the object cannot go to),
   * shown only while a grid-snapped object - a plot or a structure - is
   * lifted; free-form decor/fence lifts get no grid (owner rule: a grid
   * only helps when the lifted object lands flush on it). One Graphics
   * built at lift start (the domain is static), destroyed on release.
   */
  private showPlacementGrid(): void {
    if (this.placementGridGraphics !== null) return;
    const graphics = this.add.graphics().setDepth(PLACEMENT_GRID_DEPTH);
    graphics.lineStyle(
      PLACEMENT_GRID_LINE_WIDTH,
      PLACEMENT_GRID_LINE_COLOR,
      PLACEMENT_GRID_LINE_ALPHA,
    );
    for (const tile of placeablePlotTiles(gameState.getState().regionsUnlocked)) {
      const { x, y } = gridToIso(tile.col, tile.row);
      graphics.beginPath();
      graphics.moveTo(x - TILE_WIDTH / 2, y);
      graphics.lineTo(x, y - TILE_HEIGHT / 2);
      graphics.lineTo(x + TILE_WIDTH / 2, y);
      graphics.lineTo(x, y + TILE_HEIGHT / 2);
      graphics.closePath();
      graphics.strokePath();
    }
    this.placementGridGraphics = graphics;
  }

  /** Destroy the placement grid (no-op when none is showing). */
  private hidePlacementGrid(): void {
    this.placementGridGraphics?.destroy();
    this.placementGridGraphics = null;
  }

  /**
   * dev.footprints() (T3.3s-r2): toggle a persistent overlay of the FULL
   * restriction map - red diamonds on both structures' footprints at their
   * LIVE anchors and on the expand sign's while it stands, plus a dim wash
   * on every scanned tile beyond the placeable domain (the wash's inner
   * edge IS the domain boundary). While enabled it rebuilds on the scene's
   * 250ms refresh tick, so it tracks structure moves and the expansion
   * purchase live. Console-logs its state like the other probes.
   */
  private toggleDevFootprints(): void {
    this.devFootprintsEnabled = !this.devFootprintsEnabled;
    if (this.devFootprintsEnabled) {
      console.log(
        'dev.footprints: restrictions overlay ON (red = blocked tiles at live anchors, dim wash = beyond the placeable domain; tracks moves live)',
      );
      this.rebuildDevFootprints();
    } else {
      console.log('dev.footprints: restrictions overlay OFF');
      this.devFootprintsGraphics?.destroy();
      this.devFootprintsGraphics = null;
    }
  }

  /** Rebuild the dev restrictions overlay from live state - see `toggleDevFootprints`. */
  private rebuildDevFootprints(): void {
    this.devFootprintsGraphics?.destroy();
    const graphics = this.add.graphics().setDepth(DEV_FOOTPRINTS_DEPTH);
    this.devFootprintsGraphics = graphics;
    const state = gameState.getState();
    const placeable = this.getPlaceableTileKeys();
    graphics.fillStyle(DEV_DOMAIN_WASH_COLOR, DEV_DOMAIN_WASH_ALPHA);
    for (let col = GRASS_GRID_MIN; col <= GRASS_GRID_MAX; col++) {
      for (let row = GRASS_GRID_MIN; row <= GRASS_GRID_MAX; row++) {
        if (!placeable.has(`${col},${row}`)) this.fillTileDiamond(graphics, col, row);
      }
    }
    graphics.fillStyle(FOOTPRINT_BLOCKED_COLOR, DEV_FOOTPRINT_BLOCKED_ALPHA);
    for (const id of ['farmhouse', 'noticeBoard'] as const) {
      for (const tile of structureFootprintTiles(id, state.structures[id])) {
        this.fillTileDiamond(graphics, tile.col, tile.row);
      }
    }
    // T4.1: buildings block like structures, so the restrictions overlay shows
    // their footprints too - otherwise the mill would read as free ground.
    for (const placement of state.buildings) {
      for (const tile of buildingFootprintTiles(placement.type, placement)) {
        this.fillTileDiamond(graphics, tile.col, tile.row);
      }
    }
    if (!state.expanded) {
      for (const tile of EXPAND_SIGN_BLOCKED_TILES) {
        this.fillTileDiamond(graphics, tile.col, tile.row);
      }
    }
  }

  /**
   * The movable's sprite (T3.3s; ref-keyed since T4.1) - the fixed structure
   * pair by id, a placed building by index. Returns null only for a stale
   * building index (the list changed under a lift); every caller that can see
   * one handles it.
   */
  private structureImage(ref: MovableAnchorRef): Phaser.GameObjects.Image | null {
    if (ref.kind === 'structure') {
      return ref.id === 'farmhouse' ? this.farmhouseImage : this.noticeBoardImage;
    }
    return this.buildingImages[ref.index] ?? null;
  }

  /** The movable's ground shadow (T3.3s) - travels with the sprite. */
  private structureShadow(ref: MovableAnchorRef): Phaser.GameObjects.Image | null {
    if (ref.kind === 'structure') {
      return ref.id === 'farmhouse' ? this.farmhouseShadow : this.noticeBoardShadow;
    }
    return this.buildingShadows[ref.index] ?? null;
  }

  /** The movable's COMMITTED anchor from state, or null for a stale ref. */
  private movableAnchor(ref: MovableAnchorRef): { col: number; row: number } | null {
    const state = gameState.getState();
    if (ref.kind === 'structure') return state.structures[ref.id];
    return state.buildings[ref.index] ?? null;
  }

  /** The movable's fixed anchor-center-to-ground-point render offset. */
  private movableRenderOffset(ref: MovableAnchorRef): { x: number; y: number } {
    if (ref.kind === 'structure') return STRUCTURE_RENDER_OFFSETS[ref.id];
    const placement = gameState.getState().buildings[ref.index];
    return placement === undefined ? { x: 0, y: 0 } : BUILDINGS[placement.type].renderOffset;
  }

  /** The movable's anchor-relative footprint offsets. */
  private movableFootprintOffsets(ref: MovableAnchorRef): readonly { col: number; row: number }[] {
    if (ref.kind === 'structure') return STRUCTURE_FOOTPRINT_OFFSETS[ref.id];
    const placement = gameState.getState().buildings[ref.index];
    return placement === undefined ? [] : BUILDINGS[placement.type].footprintOffsets;
  }

  /** The movable's GROUND point at `anchor` - the store's one derivation. */
  private movableRenderPosition(
    ref: MovableAnchorRef,
    anchor: { col: number; row: number },
  ): { x: number; y: number } {
    if (ref.kind === 'structure') return structureRenderPosition(ref.id, anchor);
    const placement = gameState.getState().buildings[ref.index];
    return placement === undefined
      ? { x: 0, y: 0 }
      : buildingRenderPosition(placement.type, anchor);
  }

  /**
   * Put a structure's sprite (+ shadow, + the board's badge) at the render
   * position for `anchor` (T3.3s): position and y-derived depth re-derive
   * together so the structure iso-sorts correctly wherever it stands.
   */
  private placeStructureSprite(ref: MovableAnchorRef, anchor: { col: number; row: number }): void {
    const image = this.structureImage(ref);
    if (image === null) return;
    const pos = this.movableRenderPosition(ref, anchor);
    // T3.27: `pos` is the GROUND point and the sprite's origin is its base, so
    // this seats the building on it directly - no per-look correction, whatever
    // the frame's height (see `structureBaseOriginY`).
    image.setPosition(pos.x, pos.y).setDepth(this.structureDepthFor(ref, pos.y));
    const shadow = this.structureShadow(ref);
    if (shadow !== null) this.applyStructureShadowGeometry(shadow, image);
    // A building's indicators ride its sprite, so they follow every placement
    // (T4.2b) - including the one that lands a moved mill on its new anchor.
    if (ref.kind === 'building') this.placeBuildingIndicators(ref.index);
    if (ref.kind === 'structure') {
      if (ref.id === 'noticeBoard') this.placeNoticeBoardBadge();
      // T3.26: the dev knobs stack on top of the FINISHED baseline placement,
      // and deliberately after the shadow has been derived from it - so the
      // shadow keeps sitting where the un-transformed building would.
      if (ref.id === 'farmhouse') this.applyFarmhouseDevTransform();
    }
  }

  /** `placeStructureSprite` at the movable's COMMITTED (saved) anchor. */
  private applyStructureStatePosition(ref: MovableAnchorRef): void {
    const anchor = this.movableAnchor(ref);
    if (anchor !== null) this.placeStructureSprite(ref, anchor);
  }

  /**
   * Re-derive both structures' visuals from state on the refresh tick
   * (T3.3s) - the structure counterpart of `syncPlotVisuals`, so a dev
   * import/reset re-renders moved structures without a reload. Repositions
   * only when a saved anchor actually changed, which also means it can
   * never fight an in-flight structure drag (sprite-only moves; state is
   * untouched until the commit).
   */
  /**
   * Build every placed building's sprite + cast shadow from state (T4.1),
   * destroying whatever was there first - the whole-list rebuild
   * `refreshDecorations` uses, and cheap for the same reason (a save holds at
   * most a handful of buildings, and the list only changes on a purchase).
   *
   * Buildings are base-anchored structure-class sprites: same 256 frame, same
   * `structureBaseOriginY` derivation, same generated `<frame>_shadow`
   * companion.
   *
   * They stay interactive PERMANENTLY (T4.2b), unlike `decorationSprites`: a
   * building has a tap action of its own now (the mill panel), so it must be
   * hit-testable outside arrange mode too. The two modes do not collide -
   * `handleStructureDown` self-gates on `arrangeModeActive`, so a tap while
   * arranging still selects and lifts and can never open the panel, exactly
   * like the farmhouse and the notice board.
   */
  private createBuildings(): void {
    for (const image of this.buildingImages) image.destroy();
    for (const shadow of this.buildingShadows) shadow.destroy();
    // One container holds the whole mark, so destroying it takes the ring and
    // the count with it.
    for (const indicators of this.buildingIndicators) indicators.badge.destroy();
    this.buildingImages = [];
    this.buildingShadows = [];
    this.buildingIndicators = [];
    const state = gameState.getState();
    for (let index = 0; index < state.buildings.length; index++) {
      const placement = state.buildings[index]!;
      const def = BUILDINGS[placement.type];
      const image = this.add
        .image(0, 0, ATLAS_KEY, def.frame)
        .setScale(BUILDING_SCALE)
        .setOrigin(0.5, this.buildingBaseOriginY(this.textures.get(ATLAS_KEY).get(def.frame)))
        // The saved mirror (T4.8). Purely visual: setFlipX mirrors around the
        // sprite's own (0.5, baseOriginY) origin, so the ground point, the
        // footprint and the cast shadow are all unchanged - which is why the
        // shadow deliberately does NOT flip with it (owner's call).
        .setFlipX(placement.flipped);
      // FRAME-relative hit rect + pad, the notice board's convention (see its
      // comment on why an origin-centered rect silently misses part of the
      // sprite). The packer trim-fits building art into its 256 square, so the
      // frame IS the art's bounds to within the centering slack.
      const pad = BUILDING_HIT_PAD_DISPLAY_PX / BUILDING_SCALE;
      image.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(
          -pad,
          -pad,
          STRUCTURE_FRAME_SIZE + pad * 2,
          STRUCTURE_FRAME_SIZE + pad * 2,
        ),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
      image.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
        // Deferred tap (T3.4c): opens on an in-slop release, never on down -
        // the same classifier the farmhouse and notice board tap through, so a
        // pan or pinch merely STARTING on the mill cannot open its panel.
        this.handleStructureDown(pointer, () => this.openMillPanel(index));
      });
      this.buildingImages.push(image);
      // Non-null: every building frame is packed with a generated shadow
      // companion (tools/pack-atlas.mjs SHADOWED_FRAME_NAMES, T4.1).
      // `false`: a building can be mirrored (T4.8) but its authored cast never
      // is - and this runs while the sprite is ALREADY flipped from the save.
      this.buildingShadows.push(this.createGroundShadow(image, undefined, false)!);
      this.buildingIndicators.push(this.buildBuildingIndicators(def));
      this.applyStructureStatePosition({ kind: 'building', index });
    }
    this.refreshBuildingIndicators(state);
  }

  /**
   * Build one building's combined field indicator (T4.2b-r1), hidden -
   * `refreshBuildingIndicators` decides what shows and draws the ring,
   * `placeBuildingIndicators` decides where. The icon is the building's OWN
   * output good, so a future producer shows what it makes without touching
   * this.
   */
  private buildBuildingIndicators(def: BuildingDef): BuildingIndicators {
    const goodId = def.milling?.outputGoodId;
    const icon = this.add
      .image(0, 0, ATLAS_KEY, goodId === undefined ? 'coin' : GOODS[goodId].frame)
      .setDisplaySize(BUILDING_BADGE_ICON_DISPLAY_SIZE, BUILDING_BADGE_ICON_DISPLAY_SIZE);
    // Added BEFORE the icon so the ring reads as a frame around it, not a
    // band across it.
    const ring = this.add.graphics();
    const count = this.add
      .text(BUILDING_COUNT_OFFSET_X, BUILDING_COUNT_OFFSET_Y, '', BUILDING_BADGE_COUNT_STYLE)
      .setOrigin(0.5);
    const badge = this.add.container(0, 0, [ring, icon, count]).setVisible(false);
    return { badge, ring, count };
  }

  /**
   * (Re-)anchor a building's indicators to its sprite's CURRENT position - the
   * building twin of `placeNoticeBoardBadge`, called both from the settled
   * placement (`placeStructureSprite`) and mid-drag (`moveStructureSpriteFree`).
   *
   * The mark sits TOP-MIDDLE, centered on the art's top edge and derived from
   * the sprite rather than measured per building: the sprite is base-anchored
   * (origin y at its base row), so its top edge is `y - displayHeight *
   * originY` whatever the frame. One container, so this is one setPosition.
   */
  private placeBuildingIndicators(index: number): void {
    const image = this.buildingImages[index];
    const indicators = this.buildingIndicators[index];
    if (image === undefined || indicators === undefined) return;
    const top = image.y - image.displayHeight * image.originY;
    indicators.badge.setPosition(image.x, top - BUILDING_BADGE_GAP).setDepth(image.depth + 1);
  }

  /**
   * Re-derive every building's field indicators from state (T4.2b), on the
   * same tick as the notice board's badge.
   *
   * Reads `millSlots` - the SAME derivation the mill panel renders from - so a
   * batch that reads ready here is exactly the one the panel offers a Collect
   * for. LOCKED slots are ignored: they hold nothing, so they say nothing on
   * the field. A building with no recipe shows no indicator at all.
   *
   * The ring tracks the SOONEST-to-finish batch, so it always shows the next
   * thing that will happen. When that batch lands, the count ticks up and the
   * ring picks up the next still-milling batch's own true progress rather than
   * resetting to a fiction.
   */
  private refreshBuildingIndicators(state: GameStateData): void {
    const nowMs = now();
    for (let index = 0; index < this.buildingIndicators.length; index++) {
      const indicators = this.buildingIndicators[index]!;
      const placement = state.buildings[index];
      const recipe = placement === undefined ? undefined : BUILDINGS[placement.type].milling;
      if (placement === undefined || recipe === undefined) {
        indicators.badge.setVisible(false);
        continue;
      }
      const views = millSlots(placement, recipe, nowMs);
      const readyCount = views.filter((view) => view.kind === 'ready').length;
      const remaining = views
        .filter((view) => view.kind === 'milling')
        .map((view) => view.remainingMs);
      // Shown when there is anything to say: something waiting, or something
      // on its way. An idle mill wears nothing.
      indicators.badge.setVisible(readyCount > 0 || remaining.length > 0);
      indicators.count.setVisible(readyCount > 0).setText(String(readyCount));
      indicators.ring.clear();
      if (remaining.length === 0) continue;
      const fraction = Phaser.Math.Clamp(1 - Math.min(...remaining) / recipe.batchMs, 0, 1);
      indicators.ring
        .lineStyle(BUILDING_RING_THICKNESS, BUILDING_RING_TRACK_COLOR, BUILDING_RING_TRACK_ALPHA)
        .strokeCircle(0, 0, BUILDING_RING_RADIUS)
        .lineStyle(BUILDING_RING_THICKNESS, BUILDING_RING_FILL_COLOR, 1)
        .beginPath()
        .arc(
          0,
          0,
          BUILDING_RING_RADIUS,
          BUILDING_RING_START_ANGLE,
          BUILDING_RING_START_ANGLE + Math.PI * 2 * fraction,
        )
        .strokePath();
    }
  }

  /**
   * Open the mill panel on the building at `index` (T4.2b) - the field tap's
   * action, fired by `handleStructureDown` on an in-slop release. Closes the
   * HUD's panels first, the Decor Shop's handoff exactly. A building with no
   * recipe has nothing to show, so its tap does nothing.
   */
  private openMillPanel(index: number): void {
    const placement = gameState.getState().buildings[index];
    if (placement === undefined || BUILDINGS[placement.type].milling === undefined) return;
    this.audio.sfx('tap');
    this.hud.closePanels();
    this.millPanel.show(gameState.getState(), index);
  }

  /**
   * The origin-y that BASE-anchors a building sprite (T4.1) - the building
   * twin of `structureBaseOriginY`, same derivation over
   * BUILDING_BASE_ROW_NATIVE. Takes the FRAME rather than the image so it can
   * run before the sprite's origin is set.
   *
   * Currently 1.0 (building art is bottom-flush in its 256 square, measured -
   * see BUILDING_BASE_ROW_NATIVE), but derived rather than hardcoded so a
   * future building whose art leaves room under it keeps standing correctly.
   */
  private buildingBaseOriginY(frame: Phaser.Textures.Frame): number {
    const overhang = frame.realHeight - STRUCTURE_FRAME_SIZE;
    return (BUILDING_BASE_ROW_NATIVE + overhang) / frame.realHeight;
  }

  /**
   * Re-derive the placed buildings from state on the refresh tick (T4.1) - the
   * building counterpart of `refreshStructures`. Rebuilds only when the saved
   * list actually changed, so `dev.buildMill()` and a dev import both show up
   * without a reload, and an in-flight building drag (sprite-only until its
   * commit) is never fought.
   *
   * `force` (U3b-r1) skips the change check entirely and ALWAYS rebuilds. This
   * root-fixes the stale-building-sprite bug: a removal that leaves the list
   * EMPTY serializes to "" (`buildingPositionsKey([])`), which collided with the
   * old `lastBuildingsJson = ''` force sentinel - the compare then read equal
   * and early-returned, so the last building's sprite outlived its state
   * removal. A boolean flag can never collide with a real key, so any removal
   * path (undo, Cancel, shed re-place) despawns within the same call.
   */
  private refreshBuildings(force = false): void {
    const json = buildingPositionsKey(gameState.getState());
    if (!force && json === this.lastBuildingsJson) return;
    this.lastBuildingsJson = json;
    // A rebuild invalidates every index-based ref, so drop any selection or
    // in-flight drag pointing at a building before the sprites vanish.
    if (this.selectedStructureId?.kind === 'building') this.setStructureSelection(null);
    if (this.structureDragId?.kind === 'building') this.structureDragId = null;
    this.createBuildings();
    if (this.arrangeModeActive) {
      for (const image of this.buildingImages) image.setInteractive();
    }
  }

  private refreshStructures(): void {
    const state = gameState.getState();
    const structures = state.structures;
    // T3.25: the restoration flag joins the key, so buying the upgrade (or
    // flipping `dev.setFarmhouseRestored`, or importing a restored save)
    // swaps the frame on the very next tick without a reload.
    const json = `${structures.farmhouse.col},${structures.farmhouse.row};${structures.noticeBoard.col},${structures.noticeBoard.row};${state.restoration.farmhouse}`;
    if (json === this.lastStructureAnchorsJson) return;
    this.lastStructureAnchorsJson = json;
    this.applyFarmhouseLook();
    this.applyStructureStatePosition(FARMHOUSE_REF);
    this.applyStructureStatePosition(NOTICE_BOARD_REF);
  }

  /**
   * Select a structure (T3.3s): tints its sprite, deselecting any
   * decoration and plot first - the structure-side mirror of
   * `setDecorationSelection`/`setPlotSelection`, re-deriving the contextual
   * toolbar (U3b - Flip for a flippable movable, Put away for a building).
   */
  private setStructureSelection(ref: MovableAnchorRef | null): void {
    this.disarmCancel();
    if (ref !== null) {
      if (this.selectedDecorationIndex !== null) {
        this.decorationSprites[this.selectedDecorationIndex]?.clearTint();
        this.selectedDecorationIndex = null;
      }
      this.clearPlotSelectionTint();
    }
    this.clearStructureSelectionTint();
    this.selectedStructureId = ref;
    if (ref !== null) this.structureImage(ref)?.setTint(DRESSING_SELECTED_TINT);
    this.updateContextualToolbar();
  }

  /** Clear the selected movable's tint and forget the selection. */
  private clearStructureSelectionTint(): void {
    if (this.selectedStructureId === null) return;
    this.structureImage(this.selectedStructureId)?.clearTint();
    this.selectedStructureId = null;
  }

  /**
   * Make every plot's tile sprite hit-testable for arrange mode
   * (T3.3a-r: every tile IS a plot's now - growing plots stay interactive
   * for the locked-plot shake; lifting itself is the scene classifier's
   * long-press path since T3.3a-r3, so no `draggable`) - called on
   * arrange-mode entry and after every placement, so a tile spawned
   * mid-arrange (chain placement) becomes liftable too. The full
   * interactive config (diamond hit area included) is re-passed each time,
   * so the "no-arg setInteractive preserves the hit area" rule is moot here.
   */
  private refreshArrangePlotInteractivity(): void {
    if (!this.arrangeModeActive) return;
    for (const tile of this.plotTileSprites) {
      tile.setInteractive({
        hitArea: PLOT_TILE_HIT_AREA,
        hitAreaCallback: Phaser.Geom.Polygon.Contains,
        useHandCursor: true,
      });
    }
  }

  /**
   * Locked-plot refusal feedback (T3.3a): a growing crop pins its plot, so a
   * lift attempt answers with a brief tile x-wiggle - the ExpandSign's
   * insufficient-coins nudge, reused. Plot tiles carry no other x-tweens, so
   * the kill-and-reset is safe.
   */
  private shakeLockedPlot(tile: Phaser.GameObjects.Image): void {
    const baseX = tile.x;
    this.tweens.killTweensOf(tile);
    tile.setX(baseX);
    this.tweens.add({
      targets: tile,
      x: baseX + PLOT_LOCKED_SHAKE_DISTANCE,
      duration: PLOT_LOCKED_SHAKE_STEP_MS,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => tile.setX(baseX),
    });
  }

  /**
   * Place one shed plot on the best batch-start tile (T3.3a-r2f): nearest
   * (in screen space) to the existing plots' center of mass WITH a free
   * downward run sized to the shed count, so a granted batch opens a strip
   * it can build in instead of wedging against the existing farm block -
   * `bestBatchStartTile` owns the rule, with plain nearest-free as its own
   * fallback. Returns the new plot's index, or false when the shed is empty
   * or no placeable tile is free - the graceful refusal path (the Shed
   * row's Place button is already dimmed then, belt and braces). On success
   * the visuals re-derive immediately so the plot is visible, selected, and
   * liftable without waiting for the refresh tick.
   */
  private placePlotAtBestTile(): number | false {
    const state = gameState.getState();
    if (state.unplacedPlots <= 0) return false;
    const best = bestBatchStartTile(state, state.unplacedPlots);
    if (best === null) return false;
    const index = gameState.placePlot(best.col, best.row);
    if (index === false) return false;
    this.refreshCrops();
    return index;
  }

  /**
   * The grant popup's Place Now path (T3.3a): straight into arrange mode
   * with one plot auto-taken from the shed, spawned committed, selected,
   * and liftable - and a chain-placement session started (T3.3a-r), so the
   * remaining grants place via "Place Next" without a Shed round trip. With
   * no free placeable tile (only reachable via dev over-granting), it still
   * enters arrange mode - the plot stays in the shed and the Edit Layout
   * flash resumes on exit.
   */
  private handlePlaceNow(): void {
    if (!this.arrangeModeActive) this.enterArrangeMode();
    const placed = this.placePlotAtBestTile();
    if (placed === false) {
      this.updatePlaceNextButton();
      return;
    }
    this.recordSessionPlotPlacement(placed);
    this.setPlotSelection(placed);
    this.refreshArrangePlotInteractivity();
  }

  /**
   * The Shed panel's "Farm Plot" Place button (T3.3a): same flow as a decor
   * row's Place - panel closes and the new item arrives selected - except
   * the plot spawns snapped to the best free placeable tile, never
   * free-form. Seeds or extends the plot chain session (T3.3a-r2f2) BEFORE
   * any juice runs - see `recordSessionPlotPlacement`.
   */
  private placeShedPlot(): void {
    const placed = this.placePlotAtBestTile();
    if (placed === false) return;
    this.recordSessionPlotPlacement(placed);
    this.audio.sfx('tap');
    this.hideShedPanel();
    this.setPlotSelection(placed);
    this.refreshArrangePlotInteractivity();
  }

  /**
   * THE one bookkeeping path for plot placements (T3.3a-r2f2): every entry
   * point - the popup's Place Now, the Shed's Place, and Place Next's own
   * spawns - records the placed index here, IMMEDIATELY after the store
   * commit and before any juice (sfx, panels, selection). Root-cause
   * hardening: a user-action callback that throws mid-handler has happened
   * live before (a half-loaded page with its audio missing - see
   * `onFieldPointerUp`'s comment), and bookkeeping that ran after such a
   * throw was lost - an empty history then sent the next Place Next to the
   * batch-start search, which can legally pick a tile far from the plot it
   * should have chained from. Seeds a fresh plot session when none is
   * active; extends the current one otherwise, so a Shed round trip
   * mid-session keeps the chain's direction history.
   */
  private recordSessionPlotPlacement(placedIndex: number): void {
    if (this.placementSession === null || this.placementSession.kind !== 'plot') {
      this.placementSession = { kind: 'plot' };
      this.sessionPlotIndices = [];
    }
    this.sessionPlotIndices.push(placedIndex);
    this.updatePlaceNextButton();
  }

  /**
   * "Place Next xN" (T3.3a-r): spawn the session's next item adjacent to the
   * last-placed one, already committed. Plots follow the decided preference
   * order (same column row+1, else same row col+1, else nearest free
   * placeable tile - `nextChainPlotTile`; if the anchor is gone, e.g. after
   * a dev import, fall back to the center-of-mass spawn). Decor spawns
   * offset a little beside the last-placed decor, free-form, through the
   * store's own clamps.
   */
  private handlePlaceNext(): void {
    const session = this.placementSession;
    if (session === null || !this.arrangeModeActive) return;
    if (session.kind === 'plot') {
      const state = gameState.getState();
      // The session history at CURRENT tiles (T3.3a-r2f) - a dragged plot
      // re-aims the chain; indices dangling after a dev shrink drop out.
      const history = this.sessionPlotIndices
        .map((index) => state.plots[index])
        .filter((plot): plot is PlotState => plot !== undefined)
        .map((plot) => ({ col: plot.col, row: plot.row }));
      let placed: number | false = false;
      if (history.length > 0) {
        // With ANY anchor, the chain rule alone decides (T3.3a-r2f2): it
        // already ends in a nearest-free fallback, so a null here means the
        // board is full - never a reason to run the batch-start search,
        // which could hop away from the plot it should chain from.
        const tile = nextChainPlotTile(state, history);
        if (tile !== null) placed = gameState.placePlot(tile.col, tile.row);
      } else {
        // No anchor at all (only reachable when dev tooling shrank the
        // plots array mid-session): recover with the batch-start search.
        placed = this.placePlotAtBestTile();
      }
      if (placed === false) {
        this.updatePlaceNextButton();
        return;
      }
      // Bookkeeping FIRST (T3.3a-r2f2) - juice may throw, history may not be lost.
      this.recordSessionPlotPlacement(placed);
      this.audio.sfx('tap');
      this.refreshCrops();
      this.setPlotSelection(placed);
      this.refreshArrangePlotInteractivity();
    } else {
      // Read the anchor BEFORE placing - placements append, so its index is
      // stable, but the fresh entry must not anchor on itself.
      const previous = gameState.getState().decorations[this.lastPlacedDecorIndex];
      const newIndex = gameState.placeFromShed(session.frame);
      if (newIndex === false) {
        this.updatePlaceNextButton();
        return;
      }
      // Bookkeeping first here too (T3.3a-r2f2), same throwing-juice hardening.
      this.lastPlacedDecorIndex = newIndex;
      this.audio.sfx('tap');
      if (previous !== undefined) {
        gameState.setDecorationTransform(
          newIndex,
          previous.x + DECOR_CHAIN_OFFSET_X,
          previous.y + DECOR_CHAIN_OFFSET_Y,
          decorSpawnScale(session.frame),
          false,
        );
      }
      this.spawnPlacedDecorationSprite(newIndex);
    }
    this.updatePlaceNextButton();
  }

  /**
   * Re-derive the Place Next button (T3.3a-r) from the live session and shed
   * counts: hidden outside a session or once the session item's count hits
   * zero; "Place Next xN" while items remain; dimmed-but-visible (the Store
   * button convention) when items remain but there is nowhere to put one -
   * only reachable for plots (every placeable tile blocked), since decor is
   * free-form and always has somewhere to go.
   */
  private updatePlaceNextButton(): void {
    const session = this.placementSession;
    const state = gameState.getState();
    const count =
      session === null
        ? 0
        : session.kind === 'plot'
          ? state.unplacedPlots
          : (state.shedInventory[session.frame] ?? 0);
    const visible = this.arrangeModeActive && count > 0;
    this.arrangePlaceNextButton.setVisible(visible);
    this.arrangePlaceNextText.setVisible(visible);
    if (!visible) {
      this.arrangePlaceNextButton.disableInteractive();
      return;
    }
    this.arrangePlaceNextText.setText(`Place Next x${count}`);
    const enabled =
      session!.kind === 'decor' ||
      placeablePlotTiles(state.regionsUnlocked).some((tile) =>
        isPlotTileFree(state, tile.col, tile.row),
      );
    this.arrangePlaceNextButton.setAlpha(
      enabled ? ARRANGE_STORE_ENABLED_ALPHA : ARRANGE_STORE_DISABLED_ALPHA,
    );
    if (enabled) {
      this.arrangePlaceNextButton.setInteractive({ useHandCursor: true });
    } else {
      this.arrangePlaceNextButton.disableInteractive();
    }
  }

  /**
   * Build the shed panel once (T3.9b): a full-screen closing backdrop
   * (own zone, not the shared `ModalBackdrop` - see the SHED_* constants'
   * comment for why it needs its own depth) plus a panel body with one row
   * per `DECOR_ITEMS` frame, laid out exactly like `DecorShop`'s own grid.
   * Hidden and every interactive piece left non-interactive until first
   * shown - `showShedPanel`/`hideShedPanel` own that toggle, same
   * "never rely on container visibility alone" convention as
   * `setArrangeControlsVisible`.
   */
  private createShedPanel(): void {
    this.shedBackdropZone = this.add
      .zone(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)
      .setOrigin(0, 0)
      .setDepth(SHED_BACKDROP_DEPTH)
      .setVisible(false);
    this.shedBackdropZone.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        this.audio.sfx('tap');
        this.hideShedPanel();
      },
    );

    this.shedContainer = this.add
      .container(SHED_PANEL_CENTER_X, SHED_PANEL_CENTER_Y)
      .setDepth(SHED_PANEL_DEPTH)
      .setVisible(false);

    const bg = this.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      SHED_PANEL_WIDTH,
      SHED_PANEL_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const title = this.add.text(0, SHED_TITLE_Y, 'Shed', SHED_TITLE_STYLE).setOrigin(0.5);
    this.shedCloseButton = this.add
      .text(SHED_CLOSE_OFFSET_X, SHED_CLOSE_OFFSET_Y, 'X', SHED_CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16);
    this.shedCloseButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hideShedPanel();
    });
    this.shedEmptyText = this.add
      .text(0, 0, SHED_EMPTY_TEXT, SHED_EMPTY_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    this.shedContainer.add([bg, title, this.shedCloseButton, this.shedEmptyText]);
    this.shedBg = bg;
    // Do NOT call bg.setInteractive() here (T3.18b root cause): a container
    // child's FIRST setInteractive() call must happen while the panel is
    // actually being shown, matching shedBackdropZone/shedCloseButton/
    // each row's placeButton (all (re-)enabled from showShedPanel or
    // refreshShedPanel, every open) - verified live that an object whose
    // very first setInteractive() call happens once here, at panel-build time,
    // never wins a real hit-test against shedBackdropZone anywhere except
    // exactly on other already-interactive objects, even though its own
    // position/origin/hitArea all read back as correct. bg.setInteractive()
    // lives in showShedPanel/hideShedPanel instead.
    bg.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => event.stopPropagation(),
    );

    // The "Farm Plot xN" row (T3.3a) leads the panel - counted from
    // `unplacedPlots`, not the shed record, and placing snaps to the
    // best free owned tile instead of a free-form spawn. Its icon keeps the
    // plot frame's own wide-diamond aspect (a square would visibly squash it;
    // decor/trophy frames are square already, so only this row needs it).
    this.plotShedRow = this.buildShedRow('plot', 'Farm Plot', SHED_NAME_STYLE, () =>
      this.placeShedPlot(),
    );
    this.plotShedRow.icon.setDisplaySize(
      SHED_ICON_SIZE,
      (SHED_ICON_SIZE * TILE_FRAME_HEIGHT) / TILE_WIDTH,
    );
    // Building rows (U3b-r1): a building sits in the shed only transiently
    // (an undo/Cancel of a placement banks it there); its row appears only while
    // its shed count > 0 and taps into hand at its default anchor. `id === frame`
    // for every building, so the single-`frame` row shape carries both.
    this.shedRows = [
      ...BUILDING_IDS.map((id) =>
        this.buildShedRow(id, BUILDINGS[id].name, SHED_NAME_STYLE, () =>
          this.placeShedBuilding(id),
        ),
      ),
      ...DECOR_ITEMS.map((item) =>
        this.buildShedRow(item.frame, item.name, SHED_NAME_STYLE, () =>
          this.placeShedDecoration(item.frame),
        ),
      ),
      ...TROPHY_ITEMS.map((item) =>
        this.buildShedRow(item.frame, item.name, SHED_TROPHY_NAME_STYLE, () =>
          this.placeShedDecoration(item.frame),
        ),
      ),
    ];
  }

  /**
   * A building row's Place action (U3b-r1): brings a stranded shed building back
   * onto the farm at its default anchor and selects it "in hand" - the U3b
   * building fast-path flow, minus the purchase. `placeFromShed` keeps its
   * placed-only guard, so this is a silent no-op if a placed copy already stands
   * (the same-unit rule); in the normal stranded case (0 placed) it lands.
   */
  private placeShedBuilding(id: BuildingId): void {
    const newIndex = gameState.placeFromShed(id);
    if (newIndex === false) return;
    this.audio.sfx('tap');
    this.hideShedPanel();
    // Render the new sprite now so it can be selected this frame.
    this.refreshBuildings(true);
    this.setStructureSelection({ kind: 'building', index: newIndex });
  }

  /** A decor/trophy row's Place action - also starts the decor chain session
   * (T3.3a-r), bookkeeping before juice like the plot paths (T3.3a-r2f2). */
  private placeShedDecoration(frame: string): void {
    const newIndex = gameState.placeFromShed(frame);
    if (newIndex === false) return;
    this.placementSession = { kind: 'decor', frame };
    this.lastPlacedDecorIndex = newIndex;
    this.updatePlaceNextButton();
    this.audio.sfx('tap');
    this.hideShedPanel();
    this.spawnPlacedDecorationSprite(newIndex);
  }

  /**
   * One shed panel row: icon, name, "xN" count, a Place button - built
   * once at a neutral (0, 0) position, hidden until shown. `nameStyle` is
   * `SHED_TROPHY_NAME_STYLE` for a trophy row, `SHED_NAME_STYLE`
   * otherwise - everything else (icon, count, Place button/behavior) is
   * identical between decor and trophy rows. Actual on-panel position is
   * assigned later, per visible slot, by `positionShedRow`.
   */
  private buildShedRow(
    frame: string,
    name: string,
    nameStyle: Phaser.Types.GameObjects.Text.TextStyle,
    onPlace: () => void,
  ): ShedRow {
    const icon = this.add
      .image(0, 0, ATLAS_KEY, frame)
      .setDisplaySize(SHED_ICON_SIZE, SHED_ICON_SIZE)
      .setVisible(false);
    const nameText = this.add.text(0, 0, name, nameStyle).setOrigin(0, 0.5).setVisible(false);
    // Shrink-to-fit (T3.18a): never lets a long trophy name reach the Place button.
    nameText.setScale(Math.min(1, SHED_NAME_MAX_WIDTH / nameText.width));
    const countText = this.add.text(0, 0, '', SHED_COUNT_STYLE).setOrigin(0, 0.5).setVisible(false);

    const placeButton = this.add
      .nineslice(
        0,
        0,
        ATLAS_KEY,
        'panel',
        SHED_PLACE_BUTTON_WIDTH,
        SHED_PLACE_BUTTON_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setVisible(false);
    const placeText = this.add
      .text(0, 0, 'Place', SHED_PLACE_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    placeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onPlace);

    this.shedContainer.add([icon, nameText, countText, placeButton, placeText]);
    return { frame, icon, nameText, countText, placeButton, placeText };
  }

  /**
   * Position one row's five objects into the slot for `visibleIndex` (T3.18):
   * same per-object offsets `buildShedRow` used to apply directly, now
   * computed from the row's rank among VISIBLE rows rather than its fixed
   * build-order index, so owned rows pack top-down with no gaps regardless of
   * which frames are owned.
   */
  private positionShedRow(row: ShedRow, visibleIndex: number): void {
    const colX = SHED_COLUMN_X[Math.floor(visibleIndex / SHED_ROWS_PER_COLUMN)]!;
    const y = SHED_ROW_START_Y + (visibleIndex % SHED_ROWS_PER_COLUMN) * SHED_ROW_SPACING;

    row.icon.setPosition(colX + SHED_ICON_OFFSET_X, y);
    row.nameText.setPosition(colX + SHED_NAME_OFFSET_X, y + SHED_NAME_OFFSET_Y);
    row.countText.setPosition(colX + SHED_COUNT_OFFSET_X, y + SHED_COUNT_OFFSET_Y);
    row.placeButton.setPosition(colX + SHED_PLACE_BUTTON_OFFSET_X, y);
    row.placeText.setPosition(colX + SHED_PLACE_BUTTON_OFFSET_X, y);
  }

  /** Open (or close) the shed panel from the control row's Shed button. */
  private toggleShedPanel(): void {
    if (this.shedPanelVisible) this.hideShedPanel();
    else this.showShedPanel();
  }

  private showShedPanel(): void {
    this.refreshShedPanel();
    this.shedPanelVisible = true;
    this.shedContainer.setVisible(true);
    this.shedBackdropZone.setVisible(true).setInteractive();
    this.shedBg.setInteractive();
    this.shedCloseButton.setInteractive({ useHandCursor: true });
    setPanelOpen('decor-shed', true);
  }

  private hideShedPanel(): void {
    if (!this.shedPanelVisible) return;
    this.shedPanelVisible = false;
    this.shedContainer.setVisible(false);
    this.shedBackdropZone.setVisible(false).disableInteractive();
    this.shedBg.disableInteractive();
    this.shedCloseButton.disableInteractive();
    this.plotShedRow.placeButton.disableInteractive();
    for (const row of this.shedRows) row.placeButton.disableInteractive();
    setPanelOpen('decor-shed', false);
  }

  /**
   * Re-derive every row's visibility/count/Place-button state from the
   * live shed (T3.9b; the shed merged into it in U2a): rows with nothing
   * owned hide entirely (icon,
   * name, count, button - never a dangling interactive hitbox on an invisible
   * row), rows with any owned show with a truthful "xN" and an interactive
   * Place button. Visible rows are also (re)positioned here (T3.18), in
   * build order (decor before trophies), so they pack top-down with no gaps
   * no matter which frames happen to be owned. The empty-state text shows
   * only when nothing is owned at all.
   */
  private refreshShedPanel(): void {
    const state = gameState.getState();
    // The rows are built from DECOR_ITEMS + TROPHY_ITEMS, so only decor ids are
    // ever looked up here - a building or path tier sitting in the same shed
    // has no row and is silently (and correctly) not shown by this panel.
    const stored = state.shedInventory;
    let anyOwned = false;
    let visibleIndex = 0;
    // "Farm Plot xN" leads (T3.3a): counted from `unplacedPlots`. Its Place
    // button dims (Store-button convention) when no owned tile is free -
    // that is how a granted-but-unplaceable plot communicates the refusal.
    const plotCount = state.unplacedPlots;
    const showPlotRow = plotCount > 0;
    if (showPlotRow) anyOwned = true;
    const anyFreeTile = placeablePlotTiles(state.regionsUnlocked).some((tile) =>
      isPlotTileFree(state, tile.col, tile.row),
    );
    this.plotShedRow.icon.setVisible(showPlotRow);
    this.plotShedRow.nameText.setVisible(showPlotRow);
    this.plotShedRow.countText.setVisible(showPlotRow).setText(`x${plotCount}`);
    this.plotShedRow.placeText.setVisible(showPlotRow);
    this.plotShedRow.placeButton.setVisible(showPlotRow);
    if (showPlotRow) {
      this.positionShedRow(this.plotShedRow, visibleIndex);
      visibleIndex++;
    }
    this.plotShedRow.placeButton.setAlpha(
      anyFreeTile ? ARRANGE_STORE_ENABLED_ALPHA : ARRANGE_STORE_DISABLED_ALPHA,
    );
    if (showPlotRow && anyFreeTile) {
      this.plotShedRow.placeButton.setInteractive({ useHandCursor: true });
    } else {
      this.plotShedRow.placeButton.disableInteractive();
    }
    for (const row of this.shedRows) {
      const owned = stored[row.frame] ?? 0;
      const has = owned > 0;
      if (has) anyOwned = true;
      row.icon.setVisible(has);
      row.nameText.setVisible(has);
      row.countText.setVisible(has).setText(`x${owned}`);
      row.placeText.setVisible(has);
      row.placeButton.setVisible(has);
      if (has) {
        this.positionShedRow(row, visibleIndex);
        visibleIndex++;
        row.placeButton.setInteractive({ useHandCursor: true });
      } else {
        row.placeButton.disableInteractive();
      }
    }
    this.shedEmptyText.setVisible(!anyOwned);
  }

  /**
   * All scene dressing (T2.28, collapsed to one array in T2.28a) - reads
   * straight from `DRESSING` in config.ts, cloned into the live, editable
   * `dressingState`/`dressingSprites` pair (see the dressing editor methods
   * below). No interaction, no runtime randomness while the dev-overlay
   * "Edit dressing" toggle is off. Commenting out this single call disables
   * all of it.
   */
  private createSceneDressing(): void {
    this.dressingState = DRESSING.map((d) => ({ ...d }));
    this.dressingSprites = this.dressingState.map((d) => this.createDressingSprite(d));
  }

  /** One dressing decal's sprite, wired for the editor's select/drag events (inert until edit mode is on). */
  private createDressingSprite(d: DressingPlacement): Phaser.GameObjects.Image {
    const sprite = this.add
      .image(d.x, d.y, ATLAS_KEY, d.frame)
      .setScale(d.scale)
      .setDepth(d.front === true ? DRESSING_FRONT_DEPTH : DRESSING_DEPTH);
    sprite.on('pointerdown', () => {
      if (!this.dressingEditActive) return;
      const index = this.dressingSprites.indexOf(sprite);
      if (index !== -1) this.setDressingSelection(index);
    });
    sprite.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      if (!this.dressingEditActive) return;
      sprite.setPosition(dragX, dragY);
      const index = this.dressingSprites.indexOf(sprite);
      const entry = index !== -1 ? this.dressingState[index] : undefined;
      if (entry !== undefined) {
        entry.x = Math.round(dragX);
        entry.y = Math.round(dragY);
      }
    });
    if (this.dressingEditActive) sprite.setInteractive({ draggable: true });
    return sprite;
  }

  /**
   * Dressing editor toggle (T2.28a dev overlay): enables/disables drag on
   * every current decal and disables every OTHER interactive object in the
   * scene for the duration (`setOtherHitboxesEnabled`) so dragging a decal
   * near the notice board/seed bar/HUD buttons never fires their own tap
   * handler. Field gestures are ALSO suppressed while active, same
   * `isModalOpen()`-style gating as the level-up/chest/panel checks in
   * `handlePlotEntered`/`maybeShowCountdown`, but via this scene-level flag
   * instead of the shared modal registry (the editor is dev-only, not a
   * player-facing panel). Turning it off clears the selection highlight too.
   */
  private setDressingEditActive(enabled: boolean): void {
    // T3.3a-r2w (PM ruling): dressing edit and arrange mode must never
    // coexist - their hitbox sweeps share `setOtherHitboxesEnabled`, whose
    // restore pass assumes one mode at a time; interleaving them
    // resurrected arrange-swept objects mid-arrange (root-caused in
    // T3.3a-r2y). Dev-facing refusal: the DOM overlay stays clickable
    // through the arrange sweep, so the guard lives here at the scene
    // entry point. (The overlay's own button label may briefly read "on"
    // after a refused click - cosmetic, dev-only, self-heals on the next
    // click.)
    if (this.arrangeModeActive) {
      console.log(
        'Edit dressing refused: arrange mode is active (the two modes share the hitbox sweep and must not interleave - leave arrange mode first).',
      );
      return;
    }
    // Path paint mode (T4.12) owns the field's one-finger gestures, which a
    // decal drag would fight. It runs no hitbox sweep of its own, so unlike
    // arrange above it can simply be left rather than refused.
    if (this.pathModeActive()) this.exitPathMode();
    this.dressingEditActive = enabled;
    for (const sprite of this.dressingSprites) {
      if (enabled) sprite.setInteractive({ draggable: true });
      else sprite.disableInteractive();
    }
    this.setOtherHitboxesEnabled(!enabled, this.dressingSprites, this.dressingEditDisabledObjects);
    if (!enabled) this.setDressingSelection(null);
  }

  /**
   * Disables (or restores) every interactive object in the scene EXCEPT
   * those in `exempt`, tracked in `disabledObjects` so the exact same set is
   * restored - the shared technique behind both the dressing editor's edit
   * mode (`setDressingEditActive`) and arrange mode (`enterArrangeMode`/
   * `exitArrangeMode`; T3.9a), each with its own exempt list and tracking
   * array since only one mode is ever active at a time. Same `_list`
   * technique as `toggleHitboxDebug` (InputPlugin has no public accessor for
   * "every interactive object"); iterates a snapshot copy since
   * `disableInteractive()` mutates the live list. Restoring uses no-arg
   * `setInteractive()` (never a config object) so each object's own custom
   * hit area (e.g. the notice board's measured pad) survives the round trip,
   * per this project's hit-area convention.
   */
  private setOtherHitboxesEnabled(
    enabled: boolean,
    exempt: readonly Phaser.GameObjects.GameObject[],
    disabledObjects: Phaser.GameObjects.GameObject[],
  ): void {
    if (!enabled) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- InputPlugin's interactive-object list (`_list`) is internal/private with no public accessor
      const rawList = (this.input as any)._list as Phaser.GameObjects.GameObject[];
      const interactiveObjects = [...rawList];
      disabledObjects.length = 0;
      for (const object of interactiveObjects) {
        if (exempt.includes(object)) continue;
        disabledObjects.push(object);
        object.disableInteractive();
      }
    } else {
      for (const object of disabledObjects) {
        object.setInteractive();
      }
      disabledObjects.length = 0;
    }
  }

  /** Highlights the tapped/spawned decal with a tint; clears the previous selection's tint first. */
  private setDressingSelection(index: number | null): void {
    if (this.selectedDressingIndex !== null) {
      this.dressingSprites[this.selectedDressingIndex]?.clearTint();
    }
    this.selectedDressingIndex = index;
    if (index !== null) {
      this.dressingSprites[index]?.setTint(DRESSING_SELECTED_TINT);
    }
  }

  /** Dev-overlay palette "+" button: spawns one decal at screen center, immediately selected and draggable. */
  private spawnDressingDecal(frame: string): void {
    const entry: DressingPlacement = {
      frame,
      x: Math.round(DESIGN_WIDTH / 2),
      y: Math.round(DESIGN_HEIGHT / 2),
      scale: DRESSING_SPAWN_SCALE,
    };
    this.dressingState.push(entry);
    const sprite = this.createDressingSprite(entry);
    this.dressingSprites.push(sprite);
    this.setDressingSelection(this.dressingSprites.length - 1);
  }

  /** Dev-overlay "Scale +"/"Scale -": adjusts the selected decal, clamped, no-op with nothing selected. */
  private scaleSelectedDressing(delta: number): void {
    if (this.selectedDressingIndex === null) return;
    const entry = this.dressingState[this.selectedDressingIndex];
    const sprite = this.dressingSprites[this.selectedDressingIndex];
    if (entry === undefined || sprite === undefined) return;
    entry.scale = Math.min(
      DRESSING_SCALE_MAX,
      Math.max(DRESSING_SCALE_MIN, Math.round((entry.scale + delta) * 100) / 100),
    );
    sprite.setScale(entry.scale);
  }

  /**
   * Dev-overlay "Move to front"/"Send to back": toggles the selected decal's
   * `front` flag, immediately re-depthing its sprite (DRESSING_FRONT_DEPTH,
   * above every y-depth-sorted object, vs the normal DRESSING_DEPTH) so it's
   * visible on top of the farmhouse/notice board/crops for precise
   * placement. Persisted in "Copy layout" so the decision survives the
   * export. No-op with nothing selected.
   */
  private toggleSelectedDressingFront(): void {
    if (this.selectedDressingIndex === null) return;
    const entry = this.dressingState[this.selectedDressingIndex];
    const sprite = this.dressingSprites[this.selectedDressingIndex];
    if (entry === undefined || sprite === undefined) return;
    if (entry.front === true) delete entry.front;
    else entry.front = true;
    sprite.setDepth(entry.front === true ? DRESSING_FRONT_DEPTH : DRESSING_DEPTH);
  }

  /** Dev-overlay "Delete": removes the selected decal entirely, no-op with nothing selected. */
  private deleteSelectedDressing(): void {
    if (this.selectedDressingIndex === null) return;
    const index = this.selectedDressingIndex;
    this.dressingSprites[index]?.destroy();
    this.dressingSprites.splice(index, 1);
    this.dressingState.splice(index, 1);
    this.selectedDressingIndex = null;
  }

  /**
   * The community notice board structure (T2.22, replacing the retired HUD
   * orders icon; relocated bottom-right of the Expand sign in T2.22a):
   * tapping it opens the order board via `Hud.toggleOrderBoard` (same
   * panel-exclusivity + tap sfx as the old button), gated by the same
   * `railsAllow('orders-button')` query during the tutorial. The "!" badge is
   * a separate text object refreshed on the scene's periodic tick, anchored
   * relative to NOTICE_BOARD_POSITION so it rides along unchanged.
   *
   * The hit area (T2.22a) covers the WHOLE structure - roof, board face, and
   * both posts - plus a generous pad, not just the trimmed opaque art: the
   * full native 256x256 frame already contains all of that, padded by
   * NOTICE_BOARD_HIT_PAD_DISPLAY_PX converted to native units (hitArea
   * rectangles are in the texture's own unscaled local space).
   *
   * IMPORTANT (found live-testing this task): Phaser's `pointWithinHitArea`
   * normalizes the local hit-test point by ADDING the object's displayOrigin
   * before calling `hitAreaCallback` - so a custom `hitArea` rectangle must
   * be specified in FRAME-relative space (0,0 at the frame's own top-left,
   * frameSize,frameSize at its bottom-right), never centered on the object's
   * origin/position, however natural that reads. A center-relative rect
   * (`-half..+half`) only ever partially, coincidentally overlaps the true
   * frame-relative region - for this board specifically, that bug silently
   * dropped taps on roughly the right/bottom third of the frame, which is
   * exactly the report this task fixes (see NOTICE_BOARD_HIT_PAD's old,
   * center-relative rect for the pre-fix version - now removed).
   */
  private createNoticeBoard(): void {
    // Render position derives from the saved anchor (T3.3s) - at the
    // default anchor this is exactly the historical NOTICE_BOARD_POSITION.
    const position = structureRenderPosition(
      'noticeBoard',
      gameState.getState().structures.noticeBoard,
    );
    const pad = NOTICE_BOARD_HIT_PAD_DISPLAY_PX / NOTICE_BOARD_SCALE;
    this.noticeBoardImage = this.add
      .image(position.x, position.y, ATLAS_KEY, 'notice_board')
      .setScale(NOTICE_BOARD_SCALE)
      .setDepth(this.structureDepthFor(NOTICE_BOARD_REF, position.y))
      // Applied uniformly with the farmhouse and the buildings (T4.8), but the
      // board is a SIGN: mirroring would mirror its text, so the arrange-mode
      // Flip button never enables for it and this stays false forever.
      .setFlipX(gameState.getState().structures.noticeBoard.flipped);
    // T3.27: base-anchored, so `position` (the ground point) puts the posts'
    // feet on the footprint. The hit rect below is unaffected - it is
    // FRAME-relative, and the art did not move within its frame.
    this.noticeBoardImage
      .setOrigin(0.5, this.structureBaseOriginY(this.noticeBoardImage, 'noticeBoard'))
      .setInteractive({
        hitArea: new Phaser.Geom.Rectangle(
          -pad,
          -pad,
          STRUCTURE_FRAME_SIZE + pad * 2,
          STRUCTURE_FRAME_SIZE + pad * 2,
        ),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
    this.noticeBoardImage.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (pointer: Phaser.Input.Pointer) => {
        // Deferred tap (T3.4c): opens on an in-slop release, never on down.
        this.handleStructureDown(pointer, () => this.hud.toggleOrderBoard());
      },
    );
    // Non-null: the notice board frame always has a packed shadow companion (T3.art-3).
    // `false` for consistency with the other movables; the board never flips.
    this.noticeBoardShadow = this.createGroundShadow(this.noticeBoardImage, undefined, false)!;

    this.noticeBoardBadge = this.add
      .text(0, 0, '!', BADGE_TEXT_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    this.placeNoticeBoardBadge();
  }

  /**
   * (Re-)anchor the "!" badge to the board's CURRENT position (T3.3s - the
   * board is movable now) and restart its gentle perpetual bounce from the
   * new base y. The bounce runs continuously (harmless while hidden) rather
   * than starting/stopping with visibility, matching the codebase's other
   * perpetual-tween highlights (SwipeGuide, OnboardingGuide's halo); it is
   * killed and rebuilt here because its yoyo target is an absolute y.
   */
  private placeNoticeBoardBadge(): void {
    const { x: badgeX, y: badgeY } = this.noticeBoardBadgeBase();
    this.noticeBoardBadgeTween?.remove();
    this.noticeBoardBadge.setPosition(badgeX, badgeY).setDepth(this.noticeBoardImage.depth + 1);
    this.noticeBoardBadgeTween = this.tweens.add({
      targets: this.noticeBoardBadge,
      y: badgeY + BADGE_BOUNCE_OFFSET_Y,
      duration: BADGE_BOUNCE_HALF_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * The badge's base position for the board's CURRENT sprite position - the
   * eave-tip anchor math shared by `placeNoticeBoardBadge` (settled, with
   * the bounce tween) and `moveStructureSpriteFree` (mid-drag, tween-free).
   *
   * The two NATIVE constants are frame coordinates (px from the frame's top-
   * left), so each is converted by subtracting the frame coordinate the
   * sprite's ORIGIN sits at and scaling. T3.27 moved that origin from the
   * frame's centre to its base row, so x still subtracts the half-width but y
   * now subtracts the base row - the badge therefore rides the eave exactly
   * where it always did.
   */
  private noticeBoardBadgeBase(): { x: number; y: number } {
    const baseRow = STRUCTURE_BASE_ROW_NATIVE.noticeBoard;
    return {
      x:
        this.noticeBoardImage.x +
        (NOTICE_BOARD_CONTENT_RIGHT_NATIVE - STRUCTURE_FRAME_SIZE / 2) * NOTICE_BOARD_SCALE +
        BADGE_CORNER_NUDGE,
      y:
        this.noticeBoardImage.y +
        (NOTICE_BOARD_CONTENT_RIGHT_Y_NATIVE - baseRow) * NOTICE_BOARD_SCALE -
        BADGE_CORNER_NUDGE,
    };
  }

  /**
   * Tutorial rails on the notice board, mirroring the old Hud button's
   * pattern: inert (taps blocked) outside the board-facing steps. Cached flag
   * keeps per-tick work to one boolean check. Renders at full alpha
   * throughout (T3.12 - PM decision); the tutorial's pulse highlight is the
   * only visual cue.
   */
  private applyNoticeBoardRailsGating(): void {
    const allowed = gameState.railsAllow('orders-button');
    if (allowed === this.noticeBoardEnabled) return;
    this.noticeBoardEnabled = allowed;
    if (allowed) {
      // No-arg re-enable, so the enlarged hit area set at construction
      // survives - passing a fresh config here would reset it to the
      // image's own (smaller) texture-frame bounds.
      this.noticeBoardImage.setInteractive();
    } else {
      this.noticeBoardImage.disableInteractive();
    }
  }

  /**
   * Show the "!" badge iff at least one open order is fully coverable by the
   * current inventory, and onboarding has completed - OR the active tutorial
   * step's `pulseTarget` is 'orders-button' (T3.14: `open-orders` and
   * `deliver-sunwheat`), which forces it to show and bounce regardless of
   * coverability so the board reads as "something's waiting" during exactly
   * the steps that point at it. The two conditions are mutually exclusive
   * (one requires `onboarding.completed`, the other requires it false), so
   * there is never a conflict over which one wins. The badge's own bounce
   * tween (see `createNoticeBoard`) already runs perpetually, harmless while
   * hidden - forcing visibility here is all a tutorial "attention bounce"
   * needs, with nothing extra to clean up when the step advances.
   * The tutorial's own scripted order (ONBOARDING_ORDER_A) becomes coverable
   * mid-tutorial (`deliver-sunwheat`) well before the player has been taught
   * the board exists, and its follow-up (ONBOARDING_ORDER_B) isn't coverable
   * until the player harvests the `plant-mixed` crops after the tutorial
   * ends anyway - gating the coverable branch on `onboarding.completed`
   * suppresses the premature badge without needing to special-case either
   * scripted order.
   */
  private refreshNoticeBoardBadge(): void {
    const state = gameState.getState();
    const tutorialPointsAtBoard =
      !state.onboarding.completed &&
      ONBOARDING_STEPS[state.onboarding.step]?.pulseTarget === 'orders-button';
    const coverable =
      state.onboarding.completed &&
      state.orders.some(
        (slot) => slot.state === 'open' && isOrderCoverable(slot.order, state.inventory),
      );
    this.noticeBoardBadge.setVisible(tutorialPointsAtBoard || coverable);
  }

  /**
   * Dev-only hitbox visualizer (T2.24): draws (or clears) Phaser's own input
   * debug outline on every object CURRENTLY registered as interactive with
   * this scene's input plugin - the bag, gear, seed buttons, replant chip,
   * notice board, and anything else `setInteractive()` has touched, wherever
   * it lives (Hud, SeedBar, ReplantChip, this scene). `InputPlugin` has no
   * public accessor for that list, only the internal `_list` it maintains
   * for its own hit-testing - reading it here is the only way to reach
   * "every interactive object" without plumbing a registry through every
   * class that calls `setInteractive()`.
   *
   * Container children (the bag, every seed button, the replant chip - each
   * is the sole interactive child of its own owner-positioned container)
   * need one extra step: Phaser's debug shape mirrors the target's OWN
   * `.depth`, but a container child's own depth is left at its unused
   * default (0) - the CONTAINER carries the real depth - so its outline
   * would render at depth 0, behind the grass/field, invisible. While
   * enabled, this bumps such a child's own depth to render its outline on
   * top; restored on disable. Harmless beyond the outline itself: each of
   * these containers holds only that one interactive child, so nothing else
   * depends on its relative depth.
   */
  private toggleHitboxDebug(enabled: boolean): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const interactiveObjects = (this.input as any)._list as HitboxDebuggable[]; // `any` cast: InputPlugin's interactive-object list (`_list`) is internal/private with no public accessor
    for (const object of interactiveObjects) {
      if (enabled) {
        // enableDebug creates its outline shape as a fresh root display
        // object - route it into its target's own layer, so a UI button's
        // outline stays screen-fixed with the button under dev.camera.
        if (this.layerOf(object) === this.uiLayer) {
          this.inUiLayer(() => this.input.enableDebug(object));
        } else {
          this.input.enableDebug(object);
        }
        if (object.parentContainer) {
          this.hitboxOriginalDepths.set(object, object.depth);
          object.setDepth(HITBOX_DEBUG_DEPTH);
        }
      } else {
        this.input.removeDebug(object);
        const originalDepth = this.hitboxOriginalDepths.get(object);
        if (originalDepth !== undefined) object.setDepth(originalDepth);
      }
    }
    if (!enabled) this.hitboxOriginalDepths.clear();
  }
}
