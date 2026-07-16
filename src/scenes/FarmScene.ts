import Phaser from 'phaser';

import ambientMp3Url from '../../assets/audio/ambient.mp3?url';
import musicAndriigMp3Url from '../../assets/audio/music_andriig.mp3?url';
import musicGeoffharveyMp3Url from '../../assets/audio/music_geoffharvey.mp3?url';
import musicMfccMp3Url from '../../assets/audio/music_mfcc.mp3?url';
import {
  ATLAS_KEY,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  DIRT_PATH_POSITION,
  type DressingPlacement,
  DRESSING,
  DRESSING_SCALE_STEP,
  FARMHOUSE_POSITION,
  GROUND_MODE,
  GROUND_TEXTURE_A_KEY,
  GROUND_TEXTURE_A_TILE_SCALE,
  GROUND_TEXTURE_B_KEY,
  GROUND_TEXTURE_B_TILE_SCALE,
  type GroundMode,
  NOTICE_BOARD_POSITION,
  PANEL_SLICE,
  SHADOW_ALPHA,
  SHADOW_BASE_RAISE,
  SHADOW_HEIGHT_RATIO,
  SHADOW_WIDTH_RATIO,
  TILE_DIAMOND_CENTER_Y,
  TILE_FRAME_HEIGHT,
  WORLD_HEIGHT,
  WORLD_MIN_X,
  WORLD_MIN_Y,
  WORLD_WIDTH,
} from '../config';
import { CROP_BASELINE_Y, CROP_FRAME_SIZE, CROPS, type CropDef, type CropId } from '../data/crops';
import { DECOR_ITEMS, DECOR_SCALE_MAX, DECOR_SPAWN_SCALE, TROPHY_ITEMS } from '../data/decor';
import { ONBOARDING_STEPS } from '../data/onboarding';
import { AMBIENT_KEY, MUSIC_TRACKS } from '../data/audio';
import { isOrderCoverable } from '../data/orders';
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
  registerDecorSizingToggle,
  registerDressingEditorHooks,
  registerGroundModeCycle,
  registerHitboxToggle,
  registerSceneLayersProbe,
} from '../systems/dev';
import {
  bestBatchStartTile,
  gameState,
  isPlotTileFree,
  nextChainPlotTile,
  placeablePlotTiles,
  type DecorationPlacement,
  type PlotState,
} from '../systems/gameState';
import { isReady, stageIndex } from '../systems/growth';
import { buzz } from '../systems/haptics';
import { gridToIso, isoToGrid, TILE_HEIGHT, TILE_WIDTH } from '../systems/iso';
import { isModalOpen, setPanelOpen } from '../systems/modalPanels';
import { plotIndexAtScreen, PlotPointerTracker } from '../systems/plotPointer';
import { registerPulseTarget, type PulseTarget } from '../systems/pulseTargets';
import { now } from '../systems/time';
import { ChestCeremony } from '../ui/ChestCeremony';
import { CoinArc } from '../ui/CoinArc';
import { cropToInfoDef, CropInfoCard } from '../ui/CropInfoCard';
import { DecorShop } from '../ui/DecorShop';
import { ExpandSign } from '../ui/ExpandSign';
import { FloatingText, type FloatingTextOptions } from '../ui/FloatingText';
import { Hud } from '../ui/Hud';
import { LevelUpCelebration } from '../ui/LevelUpCelebration';
import { MoondustArc } from '../ui/MoondustArc';
import { OfflineSummaryPanel } from '../ui/OfflineSummaryPanel';
import { OnboardingGuide } from '../ui/OnboardingGuide';
import { CropCountdown } from '../ui/CropCountdown';
import { ParticleBurst } from '../ui/ParticleBurst';
import { PlotGrantPopup } from '../ui/PlotGrantPopup';
import { QuestBoard } from '../ui/QuestBoard';
import { ReplantChip, type ReplantEntry } from '../ui/ReplantChip';
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
 * covering x in [-180-128, 1260+128] and y in [-320, 2240] needs
 * col-row in [-6, 6] and col+row in [-17, 23], i.e. col/row in [-11, 14].
 */
const GRASS_GRID_MIN = -11;
const GRASS_GRID_MAX = 14;

/**
 * Depth of the WHOLE ground layer - the texture TileSprite AND the grass
 * tile images alike: below every y-depth-sorted world object and above the
 * background rect (GROUND_LAYER_DEPTH - 1). Grass tiles need this explicitly
 * because the dev ground-mode cycle rebuilds them AFTER the plots exist - at
 * a shared default depth, later insertion drew grass over the plots (user
 * report + PM-direct fix, 2026-07-12). Was -1 while the world's y was never
 * negative; the T3.3a-r2 north apron has world y down to WORLD_MIN_Y, and a
 * plot tile there carries depth y - 1 (see `plotTileDepth`), so the ground
 * must sit below the lowest possible y-derived depth (WORLD_MIN_Y - 1) or
 * apron plots render UNDER the grass (caught live in this task's checks).
 */
const GROUND_LAYER_DEPTH = WORLD_MIN_Y - 2;

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
 * Notice board + farmhouse (T2.22): both structures share the same packed
 * frame convention (square, 256x256 - see tools/pack-atlas.mjs), displayed
 * with uniform scale (so the square frame stays square, never distorted),
 * and depth-sorted by their own y like a crop sprite - see `createNoticeBoard`
 * and `createFarmhouse`. T2.22a grew the farmhouse to its own, taller display
 * height (FARMHOUSE_DISPLAY_HEIGHT) when it swapped spots with the notice
 * board, which keeps the original STRUCTURE_DISPLAY_HEIGHT.
 */
const STRUCTURE_FRAME_SIZE = 256;
const STRUCTURE_DISPLAY_HEIGHT = 240;
const STRUCTURE_SCALE = STRUCTURE_DISPLAY_HEIGHT / STRUCTURE_FRAME_SIZE;
/** T2.22a: the farmhouse alone grew to this height when it moved to the board's old, more
 *  prominent top-right spot - see FARMHOUSE_POSITION's comment in config.ts. */
const FARMHOUSE_DISPLAY_HEIGHT = 300;
const FARMHOUSE_SCALE = FARMHOUSE_DISPLAY_HEIGHT / STRUCTURE_FRAME_SIZE;

/**
 * Dirt path ground decal (T2.22b): a single S-curve image connecting the
 * farmhouse down toward the plot grid's upper-right edge. Packed as a
 * 288x288 square (same trim-fit-center treatment as the structures above -
 * see tools/pack-atlas.mjs), displayed at a uniform scale so the square
 * frame stays undistorted. Fixed at DIRT_PATH_DEPTH, below every
 * y-depth-sorted object (crops, structures, chest ceremony, the Expand
 * sign) but above the grass tiles, which render at the default depth (0)
 * - see `createDirtPath`. Non-interactive; an isolated create call so it
 * can be pulled independently, same as the farmhouse.
 */
const DIRT_PATH_FRAME_SIZE = 288;
const DIRT_PATH_DISPLAY_WIDTH = 280;
const DIRT_PATH_SCALE = DIRT_PATH_DISPLAY_WIDTH / DIRT_PATH_FRAME_SIZE;
const DIRT_PATH_DEPTH = 5;

/**
 * Decor Shop (T3.9): opened by tapping the farmhouse, which becomes
 * interactive for the first time - hit area mirrors the notice board's
 * exactly (see NOTICE_BOARD_HIT_PAD_DISPLAY_PX below), just under its own
 * name. Rails still block taps while inert; the tutorial's pulse highlight
 * is the only visual treatment (the T3.12 dim was removed - PM decision).
 */
const FARMHOUSE_HIT_PAD_DISPLAY_PX = 20;

/**
 * Arrange mode (T3.9a, control row moved into the seed bar's own band in
 * T3.9b, flip button added in T3.15, reworked into two rows in T3.16):
 * in-canvas Phaser objects only (phone-first, no DOM). While arranging, the
 * seed bar hides entirely (`SeedBar.setVisible`) and two rows take over its
 * band (~y 1584-1750): row 1 (per-item actions, need a selection) - [-] [+]
 * [Flip] [Put Away] - directly above row 2 (mode actions) - [Shed] [Shop]
 * [Done]. Row 2 keeps the legacy single-row's exact Y (preserving its
 * existing ~10px clearance to the Shed/Shop panel's bottom edge, see
 * WAREHOUSE_PANEL_CENTER_Y); row 1 sits ARRANGE_ROW_VGAP above it. Both rows
 * render at a depth above every other UI tier (seed bar 2000, panels 2100)
 * so nothing can render over these controls while arranging. Each button is
 * a `panel` nineslice sized directly to its own width/height (not scaled
 * from a smaller native frame), so its default interactive hit area already
 * matches its full display bounds one-to-one - no custom hitArea needed to
 * satisfy the >=100px/frame-relative hit-area rule. Positions within each
 * row are computed once below (`arrangeRowCenterXs`) rather than
 * hand-placed, so each row stays centered if a width changes.
 */
const ARRANGE_UI_DEPTH = 2200;
const ARRANGE_ROW_HEIGHT = 100;
const ARRANGE_ROW_GAP = 24;
const ARRANGE_ROW_VGAP = 16;
const ARRANGE_ROW2_Y = 1700;
const ARRANGE_ROW1_Y = ARRANGE_ROW2_Y - ARRANGE_ROW_HEIGHT - ARRANGE_ROW_VGAP;

const ARRANGE_SCALE_BUTTON_SIZE = 100;
const ARRANGE_FLIP_BUTTON_WIDTH = 170;
const ARRANGE_PUT_AWAY_WIDTH = 240;
const ARRANGE_SHED_WIDTH = 170;
const ARRANGE_SHOP_WIDTH = 170;
const ARRANGE_DONE_WIDTH = 220;
const ARRANGE_DONE_HEIGHT = ARRANGE_ROW_HEIGHT;

/**
 * Chain placement (T3.3a-r): the "Place Next xN" button lives on its own,
 * centered row directly ABOVE the per-item row (row 1), keeping both
 * existing rows untouched - it only exists during a placement session, so a
 * transient third tier reads as "session control", not a mode action.
 * Same panel-nineslice-sized-to-bounds convention as the other buttons.
 */
const ARRANGE_PLACE_NEXT_WIDTH = 300;
const ARRANGE_PLACE_NEXT_X = DESIGN_WIDTH / 2;
const ARRANGE_PLACE_NEXT_Y = ARRANGE_ROW1_Y - ARRANGE_ROW_HEIGHT - ARRANGE_ROW_VGAP;

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

const [ARRANGE_SCALE_DOWN_X, ARRANGE_SCALE_UP_X, ARRANGE_FLIP_X, ARRANGE_PUT_AWAY_X] =
  arrangeRowCenterXs([
    ARRANGE_SCALE_BUTTON_SIZE,
    ARRANGE_SCALE_BUTTON_SIZE,
    ARRANGE_FLIP_BUTTON_WIDTH,
    ARRANGE_PUT_AWAY_WIDTH,
  ]) as [number, number, number, number];

const [ARRANGE_SHED_X, ARRANGE_SHOP_X, ARRANGE_DONE_X] = arrangeRowCenterXs([
  ARRANGE_SHED_WIDTH,
  ARRANGE_SHOP_WIDTH,
  ARRANGE_DONE_WIDTH,
]) as [number, number, number];

const ARRANGE_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};
const ARRANGE_SCALE_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/** Store button (T3.9b): dims when nothing is selected, same convention as DecorShop's Buy button. */
const ARRANGE_STORE_ENABLED_ALPHA = 1;
const ARRANGE_STORE_DISABLED_ALPHA = 0.4;

/**
 * Warehouse panel (T3.9b): a simple full-modal over the scene, reachable
 * only from arrange mode's Warehouse button - same panel dimensions/position
 * as `DecorShop` for visual consistency, but built directly in this scene
 * (no separate UI class) since it only ever exists inside arrange mode. Its
 * own full-screen backdrop sits ABOVE the arrange control row (unlike the
 * shared `ModalBackdrop`, fixed below the panel tier) so a tap anywhere
 * outside the panel body - including on the now-covered control row - closes
 * it instead of reaching through to a control underneath. Built once in
 * `create()`, hidden and inert until opened; one row per `DECOR_ITEMS` frame
 * plus one per `TROPHY_ITEMS` frame (T3.18), shown/hidden per-row from live
 * owned counts, decor rows before trophy rows, visible rows packed top-down
 * with no gaps (see `refreshWarehousePanel`).
 */
const WAREHOUSE_PANEL_WIDTH = 1020;
const WAREHOUSE_PANEL_HEIGHT = 1620;
const WAREHOUSE_PANEL_CENTER_X = DESIGN_WIDTH / 2;
const WAREHOUSE_PANEL_CENTER_Y = 980;
const WAREHOUSE_BACKDROP_DEPTH = ARRANGE_UI_DEPTH + 50;
const WAREHOUSE_PANEL_DEPTH = ARRANGE_UI_DEPTH + 60;

const WAREHOUSE_TITLE_Y = -WAREHOUSE_PANEL_HEIGHT / 2 + 60;
const WAREHOUSE_CLOSE_OFFSET_X = WAREHOUSE_PANEL_WIDTH / 2 - 50;
const WAREHOUSE_CLOSE_OFFSET_Y = -WAREHOUSE_PANEL_HEIGHT / 2 + 50;

const WAREHOUSE_ROWS_PER_COLUMN = 8;
const WAREHOUSE_COLUMN_X = [-245, 245] as const;
const WAREHOUSE_ROW_START_Y = -640;
const WAREHOUSE_ROW_SPACING = 175;

/**
 * Icons render at one uniform square footprint via `setDisplaySize` (T3.18a)
 * regardless of their source frame's native size - decor frames pack at
 * 128px but trophy frames pack at up to 256px (trophy_ancientoak), and a
 * plain `setScale` (the pre-T3.18a approach) scaled those native pixels
 * directly, rendering oversized trophy icons that overran neighboring
 * columns. 84 matches the on-screen size decor icons already had.
 */
const WAREHOUSE_ICON_SIZE = 84;

const WAREHOUSE_ICON_OFFSET_X = -190;

const WAREHOUSE_NAME_OFFSET_X = -130;
const WAREHOUSE_NAME_OFFSET_Y = -22;
/**
 * The name text's shrink-to-fit ceiling (T3.18a, same technique as
 * `LevelUpCelebration`/`OnboardingGuide`/`WeeklyNoticePanel`): the longest
 * trophy names ("Golden Scarecrow", "Trader's Cart") would otherwise clip
 * against the Place button. Set from the real gap between the name's left
 * edge and the Place button's left edge at the offsets above - see the
 * WAREHOUSE_* geometry comment for the derivation if these offsets change.
 */
const WAREHOUSE_NAME_MAX_WIDTH = 200;
const WAREHOUSE_COUNT_OFFSET_X = -130;
const WAREHOUSE_COUNT_OFFSET_Y = 22;

const WAREHOUSE_PLACE_BUTTON_OFFSET_X = 155;
const WAREHOUSE_PLACE_BUTTON_WIDTH = 140;
const WAREHOUSE_PLACE_BUTTON_HEIGHT = 90;

const WAREHOUSE_EMPTY_TEXT = 'Nothing stored. Buy decor at the farmhouse.';

const WAREHOUSE_TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};
const WAREHOUSE_CLOSE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};
const WAREHOUSE_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};
/**
 * Trophy rows (T3.18, recolored T3.18b): identical to `WAREHOUSE_NAME_STYLE`
 * but in the same premium-blue used by the order board's "Premium Order" tag
 * (`PREMIUM_TAG_STYLE` in OrderBoard.ts) - trophies share that "special" blue
 * family, distinct from ordinary shop decor.
 */
const WAREHOUSE_TROPHY_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  ...WAREHOUSE_NAME_STYLE,
  color: '#3a4a8a',
};
const WAREHOUSE_COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  color: '#7a5518',
};
const WAREHOUSE_PLACE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};
const WAREHOUSE_EMPTY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  color: '#7a5518',
  align: 'center',
  wordWrap: { width: WAREHOUSE_PANEL_WIDTH - 160 },
};

/**
 * Scene dressing decals (T2.28, collapsed to one array + depth in T2.28a):
 * `DRESSING` reads as ground decals just above the dirt path (depth 5) -
 * see `DRESSING`'s own comment in config.ts. `createSceneDressing` is the
 * one call in `create()` that draws it - commenting it out disables all of
 * this task's dressing.
 */
const DRESSING_DEPTH = 6;

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
 * T3.27 dev-only decor sizing probe: the ceiling `scaleSelectedDecoration`
 * passes to `setDecorationTransform` in place of the normal DECOR_SCALE_MAX
 * while `dev.decorSizing(true)` is on, so the owner can grow the selected
 * item past its normal cap to compare items side by side. Down-clamp
 * (DECOR_SCALE_MIN) is untouched - only the ceiling moves.
 */
const DEV_DECOR_SCALE_CEILING = 3.0;
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
 * space (STRUCTURE_FRAME_SIZE * STRUCTURE_SCALE + the pad on both sides).
 * The 'orders-button' pulse target uses this so the tutorial ring wraps the
 * whole structure, not just its bare STRUCTURE_DISPLAY_HEIGHT footprint.
 */
const NOTICE_BOARD_PULSE_SIZE = STRUCTURE_DISPLAY_HEIGHT + NOTICE_BOARD_HIT_PAD_DISPLAY_PX * 2;

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
/** Zoom-in ceiling for gestures; the floor is fitZoom(world) (0.75 - see cameraFitZoom). */
const CAMERA_MAX_ZOOM_IN = 1.6;
/**
 * T3.3a-r2 splits the two rects the T3.4b gestures share:
 * - WORLD: the full day-one 1440x2560 world (config.ts) - pan reaches
 *   everywhere in it, rubber-banding at its true edges, and the zoom-out
 *   floor is fitZoom(world) = 0.75 exactly (pinned in cameraMath.test.ts),
 *   showing grass to every edge.
 * - OWNED: the legacy 1080x1920 design rect, still exactly where it was -
 *   the HOME view (default + Recenter target) is fitZoom(owned) = 1 at
 *   scroll (0, 0), so a player who never touches the camera sees no change.
 * A future purchase task grows OWNED independently (T3.3c).
 */
const CAMERA_WORLD_BOUNDS: WorldBounds = {
  x: WORLD_MIN_X,
  y: WORLD_MIN_Y,
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
};
const CAMERA_OWNED_BOUNDS: WorldBounds = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
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
/**
 * Post-drop grace window (T3.3a-r3b): for this long after a lift commits,
 * the just-dropped piece lifts again INSTANTLY on touch - no hold - so
 * fine-tuning a placement (arrange mode's most common sequence) never
 * demands a fresh press-and-hold. Tracks the most recent drop only, and
 * every commit re-arms it. Deliberate tradeoff (owner decision): a
 * pan-swipe that starts on the grace piece moves the piece instead of
 * panning until the window expires; every other object keeps the hold rule.
 */
const GRACE_MS = 1500;
/** Visual lift cue (T3.3a-r3): quick scale pulse - one leg up to
 *  LIFT_PULSE_SCALE, yoyo back, so ~2x LIFT_PULSE_MS total. */
const LIFT_PULSE_SCALE = 1.1;
const LIFT_PULSE_MS = 90;
/** Haptic lift cue duration - see `buzzOnLift` (feature-checked; iOS Safari has no vibrate). */
const LIFT_VIBRATE_MS = 30;
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
 * One warehouse panel row (T3.9b) - one per `DECOR_ITEMS` frame plus one per
 * `TROPHY_ITEMS` frame (T3.18), built once at a neutral position, shown/hidden
 * per owned count and positioned into its packed slot by
 * `positionWarehouseRow` (see `refreshWarehousePanel`).
 */
interface WarehouseRow {
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
  private offlineSummaryPanel!: OfflineSummaryPanel;
  private weeklyNoticePanel!: WeeklyNoticePanel;
  private audio!: AudioManager;
  private noticeBoardImage!: Phaser.GameObjects.Image;
  private noticeBoardBadge!: Phaser.GameObjects.Text;
  /** Cached rails gating so interactivity/alpha only toggle on change (mirrors Hud's pattern). */
  private noticeBoardEnabled = true;
  private chestCeremony!: ChestCeremony;
  private farmhouseImage!: Phaser.GameObjects.Image;
  /** Cached rails gating, mirrors `noticeBoardEnabled`. */
  private farmhouseEnabled = true;
  private decorShop!: DecorShop;
  private questBoard!: QuestBoard;
  /** One sprite (+ one ground shadow) per `gameState` decoration, same index - see `refreshDecorations`. */
  private decorationSprites: Phaser.GameObjects.Image[] = [];
  private decorationShadowSprites: Phaser.GameObjects.Image[] = [];
  /** Last-rendered decorations, serialized - `refreshDecorations` rebuilds only on change. */
  private lastDecorationsJson = '';
  /** Whether arrange mode (T3.9a) is active - see `enterArrangeMode`/`exitArrangeMode`. */
  private arrangeModeActive = false;
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
  private plotShedRow!: WarehouseRow;
  /** T3.27 dev-only decor sizing probe flag - see `setDecorSizingEnabled`. Off by default. */
  private decorSizingEnabled = false;
  private arrangeDoneButton!: Phaser.GameObjects.NineSlice;
  private arrangeDoneText!: Phaser.GameObjects.Text;
  private arrangeScaleDownButton!: Phaser.GameObjects.NineSlice;
  private arrangeScaleDownText!: Phaser.GameObjects.Text;
  private arrangeScaleUpButton!: Phaser.GameObjects.NineSlice;
  private arrangeScaleUpText!: Phaser.GameObjects.Text;
  private arrangeFlipButton!: Phaser.GameObjects.NineSlice;
  private arrangeFlipText!: Phaser.GameObjects.Text;
  /** T3.9b control row additions. */
  private arrangeWarehouseButton!: Phaser.GameObjects.NineSlice;
  private arrangeWarehouseText!: Phaser.GameObjects.Text;
  private arrangeStoreButton!: Phaser.GameObjects.NineSlice;
  private arrangeStoreText!: Phaser.GameObjects.Text;
  /** T3.16 two-row rework: Shop button, mode row - see `openDecorShopFromArrange`. */
  private arrangeShopButton!: Phaser.GameObjects.NineSlice;
  private arrangeShopText!: Phaser.GameObjects.Text;
  /** Every OTHER interactive object suppressed for the duration of arrange mode - see `setOtherHitboxesEnabled`. */
  private readonly arrangeModeDisabledObjects: Phaser.GameObjects.GameObject[] = [];
  /** Warehouse panel (T3.9b) - see `createWarehousePanel`. */
  private warehouseContainer!: Phaser.GameObjects.Container;
  private warehouseBackdropZone!: Phaser.GameObjects.Zone;
  private warehouseBg!: Phaser.GameObjects.NineSlice;
  private warehouseCloseButton!: Phaser.GameObjects.Text;
  private warehouseRows: WarehouseRow[] = [];
  private warehouseEmptyText!: Phaser.GameObjects.Text;
  private warehousePanelVisible = false;
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
   *   During the post-drop grace window (T3.3a-r3b, see `graceLift`) a
   *   down on the just-dropped piece classifies 'lift' directly - no hold.
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
    kind: 'decor' | 'plot';
    target: Phaser.GameObjects.Image;
    downX: number;
    downY: number;
    grabOffsetX: number;
    grabOffsetY: number;
    timer: Phaser.Time.TimerEvent;
  } | null = null;
  /** The active lift (T3.3a-r3), set while `fieldGesture` is 'lift' - same
   *  reference-not-index rule as `pendingLift`. */
  private activeLift: {
    kind: 'decor' | 'plot';
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
  /**
   * The post-drop grace target (T3.3a-r3b), armed by `finishLift` on every
   * commit: until `until` (scene time) passes, a down whose topmost movable
   * is `target` skips the hold and lifts instantly. Same reference-not-index
   * rule as `pendingLift`. Expiry is timer-only - downs on anything else
   * leave it armed; exiting arrange mode and the gate-fail paths that
   * discard pending/active lifts (a modal opening mid-gesture) clear it.
   */
  private graceLift: {
    kind: 'decor' | 'plot';
    target: Phaser.GameObjects.Image;
    until: number;
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
  /** The field-band TileSprite in 'texture_a'/'texture_b' mode; null in 'tiles'/'tiles_flat' mode. */
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
    this.createDirtPath();
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
    this.decorShop = this.inUiLayer(
      () => new DecorShop(this, this.audio, () => this.enterArrangeMode()),
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
        new Hud(this, this.coinArc, this.moondustArc, this.uiFloatingText, this.audio, () =>
          this.toggleArrangeMode(),
        ),
    );
    // Constructed after Hud (needs it for claim-reward juice - see
    // QuestBoard's own comment) and handed back in via setQuestBoard so the
    // HUD's scroll icon can own toggling it, mirroring the bag.
    this.questBoard = this.inUiLayer(() => new QuestBoard(this, this.hud, this.audio));
    this.hud.setQuestBoard(this.questBoard);
    this.createFarmhouse();
    this.createNoticeBoard();
    registerPulseTarget('empty-plot', () => this.plotPulseTarget('empty'));
    registerPulseTarget('ready-plot', () => this.plotPulseTarget('ready'));
    registerPulseTarget('orders-button', () => ({
      x: NOTICE_BOARD_POSITION.x,
      y: NOTICE_BOARD_POSITION.y,
      width: NOTICE_BOARD_PULSE_SIZE,
      height: NOTICE_BOARD_PULSE_SIZE,
      object: this.noticeBoardImage,
    }));
    // Applied once immediately (not just on the periodic tick) so a fresh
    // scene start never shows a flash of interactive board before the
    // tutorial's rails have had a chance to disable it.
    this.applyNoticeBoardRailsGating();
    this.refreshNoticeBoardBadge();
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
    this.expandSign.refresh(gameState.getState());
    this.inUiLayer(() => this.createArrangeControls());
    this.inUiLayer(() => this.createRecenterButton());
    this.setupFieldInput();
    this.refreshCrops();
    this.refreshDecorations();
    this.logOverCapDecorations();
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
    registerDecorSizingToggle((enabled) => this.setDecorSizingEnabled(enabled));
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
    this.expandSign.refresh(gameState.getState());
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
        // Post-drop grace (T3.3a-r3b): the piece dropped less than GRACE_MS
        // ago lifts again right now - straight to 'lift', same cue, no hold
        // - so a just-placed piece can be nudged without a fresh hold.
        if (this.graceLift !== null && this.time.now > this.graceLift.until) {
          this.graceLift = null;
        }
        if (this.graceLift?.target === movable.target) {
          const world = this.fieldPointerWorld(pointer);
          if (
            this.startLift(
              movable.kind,
              movable.target,
              movable.target.x - world.x,
              movable.target.y - world.y,
            )
          ) {
            return;
          }
          // A grace target that can no longer lift is stale - forget it and
          // fall through to the normal hold arm.
          this.graceLift = null;
        }
        this.fieldGesture = 'lift-pending';
        this.beginPendingLift(pointer, movable.kind, movable.target);
        return;
      }
      // Not ours: badges, panels, and every button keep their own
      // per-object input unchanged.
      this.fieldGesture = 'object';
      return;
    }
    const world = this.fieldPointerWorld(pointer);
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
   * list arrives topmost-first, so the first decor sprite or plot tile in
   * it is the one the finger visually landed on.
   */
  private movableLiftTarget(
    currentlyOver: readonly Phaser.GameObjects.GameObject[],
  ): { kind: 'decor' | 'plot'; target: Phaser.GameObjects.Image } | null {
    for (const object of currentlyOver) {
      const image = object as Phaser.GameObjects.Image;
      if (this.decorationSprites.includes(image)) return { kind: 'decor', target: image };
      if (this.plotTileSprites.includes(image)) return { kind: 'plot', target: image };
    }
    return null;
  }

  /**
   * Arm a long-press lift (T3.3a-r3): nothing user-visible happens at the
   * down. The scene-clock timer maturing while the pointer is still within
   * TAP_SLOP is the only path that lifts a PENDING arm (`fireHoldLift`);
   * every other resolution - slop movement (pan), a second finger (pinch),
   * an in-slop release (tap-select) - cancels the timer first. (A down
   * inside the post-drop grace window never arms at all - it classifies
   * 'lift' directly in the classifier, T3.3a-r3b.)
   */
  private beginPendingLift(
    pointer: Phaser.Input.Pointer,
    kind: 'decor' | 'plot',
    target: Phaser.GameObjects.Image,
  ): void {
    const world = this.fieldPointerWorld(pointer);
    this.pendingLift = {
      pointer,
      kind,
      target,
      downX: pointer.x,
      downY: pointer.y,
      grabOffsetX: target.x - world.x,
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
   * Ignite an active lift on `target` (T3.3a-r3b splits this out of
   * `fireHoldLift` so the post-drop grace path shares it): selection first
   * (byte-identical to the old instant path's down), then the pulse + buzz
   * cue, and the gesture becomes 'lift'. Returns false with NO side
   * effects when the target no longer qualifies (despawned decoration,
   * missing or non-empty plot) - callers decide the fallback.
   */
  private startLift(
    kind: 'decor' | 'plot',
    target: Phaser.GameObjects.Image,
    grabOffsetX: number,
    grabOffsetY: number,
  ): boolean {
    if (kind === 'plot') {
      const plotIndex = this.plotTileSprites.indexOf(target);
      const plot = plotIndex === -1 ? undefined : gameState.getState().plots[plotIndex];
      if (plot === undefined || plot.state !== 'empty') return false;
      this.setPlotSelection(plotIndex);
      this.plotDragIndex = plotIndex;
      this.plotDragCol = plot.col;
      this.plotDragRow = plot.row;
    } else {
      const index = this.decorationSprites.indexOf(target);
      if (index === -1) return false;
      this.setDecorationSelection(index);
    }
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
      this.graceLift = null;
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
    if (!this.startLift(pending.kind, pending.target, pending.grabOffsetX, pending.grabOffsetY)) {
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
      lift.target.setPosition(freeX, freeY).setDepth(freeY);
      const index = this.decorationSprites.indexOf(lift.target);
      const shadow = index === -1 ? undefined : this.decorationShadowSprites[index];
      if (shadow !== undefined) this.applyGroundShadowGeometry(shadow, lift.target);
    } else {
      const { col, row } = isoToGrid(freeX, freeY);
      this.updatePlotDragSnap(Math.round(col), Math.round(row));
    }
  }

  /**
   * Release of an active lift (T3.3a-r3): settle the pulse FIRST (an early
   * release can land mid-pulse, and `commitDecorationTransform` reads the
   * sprite's live scale), then commit exactly as the pre-hold 'dragend'
   * handlers did - `setDecorationTransform`/`movePlot` stay the sole rule
   * authorities, and a refused commit snaps back from committed state.
   * Every commit (re-)arms the post-drop grace window on the piece just
   * dropped (T3.3a-r3b) - including an in-place drop, whose same-position
   * commit is harmless and simply re-arms.
   */
  private finishLift(): void {
    const lift = this.activeLift;
    this.activeLift = null;
    this.settleLiftPulse();
    if (lift === null) return;
    if (lift.kind === 'decor') {
      if (!this.arrangeModeActive) return;
      const index = this.decorationSprites.indexOf(lift.target);
      if (index !== -1) {
        this.commitDecorationTransform(index, lift.target);
        this.armGraceLift('decor', lift.target);
      }
    } else if (this.plotDragIndex !== null) {
      this.commitPlotDrag();
      this.armGraceLift('plot', lift.target);
    }
  }

  /** Arm (or re-arm) the post-drop grace window on the piece just committed (T3.3a-r3b). */
  private armGraceLift(kind: 'decor' | 'plot', target: Phaser.GameObjects.Image): void {
    this.graceLift = { kind, target, until: this.time.now + GRACE_MS };
  }

  /**
   * In-slop release before the hold fired (T3.3a-r3): a tap, byte-for-byte
   * the old per-object pointer-down behavior - a decoration selects, an
   * empty plot selects, a growing plot answers with the locked-plot shake
   * and no selection change.
   */
  private resolveLiftTap(kind: 'decor' | 'plot', target: Phaser.GameObjects.Image): void {
    if (kind === 'decor') {
      const index = this.decorationSprites.indexOf(target);
      if (index !== -1) this.setDecorationSelection(index);
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
      // 'farm-pending' - and the grace window with it (T3.3a-r3b).
      if (pending === null || !this.arrangeModeActive || !this.cameraGesturesAllowed()) {
        this.cancelPendingLift();
        this.graceLift = null;
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
      // nulled the drag state in exitArrangeMode - just drop the gesture
      // (and the grace window, T3.3a-r3b).
      if (!this.arrangeModeActive) {
        this.activeLift = null;
        this.graceLift = null;
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
          this.resolveLiftTap(pending.kind, pending.target);
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
   *  WORLD - 0.75 exactly for the 1440x2560 world in the design viewport
   *  (pinned in cameraMath.test.ts). */
  private cameraFitZoom(viewport: Viewport): number {
    return fitZoom(CAMERA_WORLD_BOUNDS, viewport);
  }

  /** The default (home) view: the OWNED (legacy 1080x1920) rect's fit zoom,
   *  centered on it - exactly zoom 1, scroll (0, 0), unchanged by the world
   *  growth (T3.3a-r2). */
  private cameraHome(viewport: Viewport): { zoom: number; scrollX: number; scrollY: number } {
    const zoom = fitZoom(CAMERA_OWNED_BOUNDS, viewport);
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
    this.expandSign.refresh(gameState.getState());
  }

  /**
   * A tap's first-contact plot only (never a mid-sweep POINTER_MOVE entry):
   * shows the live countdown when that plot is growing-but-not-ready, the
   * one case where both harvest and plant fall through and a tap would
   * otherwise do nothing. Suppressed while onboarding is active (the
   * tutorial chip owns countdown duty there) or a modal panel is open.
   */
  private maybeShowCountdown(plotIndex: number | null): void {
    if (plotIndex === null || isModalOpen() || this.dressingEditActive || this.arrangeModeActive)
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
      this.arrangeModeActive
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
      this.layGroundTexture(mode);
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
   * Ground texture experiment (T2.28): one TileSprite spans the full-width
   * field band, replacing the grass diamond tiles entirely (plot tiles are
   * untouched either way). See GROUND_LAYER_DEPTH for why it renders
   * beneath everything else.
   */
  private layGroundTexture(mode: 'texture_a' | 'texture_b'): void {
    const key = mode === 'texture_a' ? GROUND_TEXTURE_A_KEY : GROUND_TEXTURE_B_KEY;
    const tileScale =
      mode === 'texture_a' ? GROUND_TEXTURE_A_TILE_SCALE : GROUND_TEXTURE_B_TILE_SCALE;
    this.groundTexture = this.add
      .tileSprite(WORLD_MIN_X, FIELD_MIN_Y, WORLD_WIDTH, FIELD_MAX_Y - FIELD_MIN_Y, key)
      .setOrigin(0, 0)
      .setTileScale(tileScale, tileScale)
      .setDepth(GROUND_LAYER_DEPTH);
  }

  /** Cycle tiles -> tiles_flat -> texture_a -> texture_b -> tiles (dev button); returns the new mode. */
  private cycleGroundMode(): GroundMode {
    const order: GroundMode[] = ['tiles', 'tiles_flat', 'texture_a', 'texture_b'];
    const next = order[(order.indexOf(this.groundMode) + 1) % order.length]!;
    this.createGroundLayer(next);
    return next;
  }

  /**
   * A plot tile's depth: y-derived like every world object, minus 1 so the
   * plot's own crop sprite (depth y) always renders over its tile.
   */
  private plotTileDepth(y: number): number {
    return y - 1;
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
    const pad = FARMHOUSE_HIT_PAD_DISPLAY_PX / FARMHOUSE_SCALE;
    this.farmhouseImage = this.add
      .image(FARMHOUSE_POSITION.x, FARMHOUSE_POSITION.y, ATLAS_KEY, 'farmhouse')
      .setScale(FARMHOUSE_SCALE)
      .setDepth(FARMHOUSE_POSITION.y)
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
    this.farmhouseImage.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (pointer: Phaser.Input.Pointer) => {
        // Deferred tap (T3.4c): opens on an in-slop release, never on down.
        this.handleStructureDown(pointer, () => this.openDecorShop());
      },
    );
    this.createGroundShadow(this.farmhouseImage);
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
    this.hud.closePanels();
    this.decorShop.setElevated(false);
    this.decorShop.toggle(gameState.getState());
  }

  /**
   * Shop button handler (T3.16): opens the same Decor Shop the farmhouse tap
   * does, without leaving arrange mode. Closes the Shed panel first (panel
   * exclusivity) and elevates the shop's depth above the arrange control row
   * (`setElevated(true)`) exactly like the Shed panel's own backdrop already
   * sits above the row - see DecorShop's ELEVATED_* constants - so a tap
   * outside the shop's body (including on the now-covered row) closes it
   * instead of reaching through to a control underneath. Purchases land in
   * the warehouse as usual; closing the shop leaves arrange mode untouched.
   */
  private openDecorShopFromArrange(): void {
    this.audio.sfx('tap');
    this.hideWarehousePanel();
    this.decorShop.setElevated(true);
    this.decorShop.toggle(gameState.getState());
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
   * Ground shadow (T3.9): an auto-rendered `ground_shadow` image under a
   * standing object, sized/positioned from the object's OWN rendered display
   * bounds (so it works for any object regardless of native frame size or
   * scale) - width = SHADOW_WIDTH_RATIO x the object's display width, height
   * = width x SHADOW_HEIGHT_RATIO (the frame is already 2:1), positioned at
   * the object's visual base (the bottom of its display bounds, raised
   * SHADOW_BASE_RAISE), one depth below the object's own.
   */
  private createGroundShadow(object: Phaser.GameObjects.Image): Phaser.GameObjects.Image {
    const shadow = this.add.image(0, 0, ATLAS_KEY, 'ground_shadow').setAlpha(SHADOW_ALPHA);
    this.applyGroundShadowGeometry(shadow, object);
    return shadow;
  }

  /**
   * Re-derive an EXISTING shadow's size/position/depth from its object's
   * CURRENT display bounds (T3.9a) - the live-follow half of
   * `createGroundShadow`'s geometry, used while a decoration is being
   * dragged in arrange mode (every drag-move frame) and after a scale tap,
   * so the shadow tracks the object continuously instead of only at create
   * time. The farmhouse/notice board never move after creation, so they only
   * ever go through `createGroundShadow`.
   */
  private applyGroundShadowGeometry(
    shadow: Phaser.GameObjects.Image,
    object: Phaser.GameObjects.Image,
  ): void {
    const width = object.displayWidth * SHADOW_WIDTH_RATIO;
    const height = width * SHADOW_HEIGHT_RATIO;
    const baseY = object.y + object.displayHeight * (1 - object.originY) - SHADOW_BASE_RAISE;
    shadow
      .setPosition(object.x, baseY)
      .setDisplaySize(width, height)
      .setDepth(object.depth - 1);
  }

  /**
   * Re-derive placed decorations from state (T3.9): the simplest correct
   * thing at the MAX_DECORATIONS cap (30) - rebuild the whole sprite (+
   * ground shadow) list whenever the decorations array differs from the last
   * render, rather than diffing entry by entry. Depth = own screen y, so
   * decorations iso-sort with crops/structures. Non-interactive in normal
   * play (arrange mode off): sprites gain no `setInteractive()` call until
   * `enterArrangeMode` adds it, and FarmScene's field gestures are scene-wide
   * pointer listeners hit-testing the iso grid, not per-object hit tests - so
   * a decoration drawn over a plot never intercepts a field tap either way.
   *
   * Skipped entirely while arrange mode is active: every position/scale
   * change during a drag or a scale tap is applied directly to the live
   * sprite (`commitDecorationTransform`/`scaleSelectedDecoration`) rather
   * than through this rebuild, which would otherwise destroy and recreate
   * the very sprite mid-drag (losing its drag state and the selection tint).
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
    for (const shadow of this.decorationShadowSprites) shadow.destroy();
    this.decorationSprites = [];
    this.decorationShadowSprites = [];
    for (const decoration of decorations) {
      const sprite = this.createDecorationSprite(decoration);
      this.decorationSprites.push(sprite);
      this.decorationShadowSprites.push(this.createGroundShadow(sprite));
    }
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
    if (!committed) return;
    const decoration = gameState.getState().decorations[index];
    if (decoration === undefined) return;
    sprite.setPosition(decoration.x, decoration.y).setDepth(decoration.y);
    const shadow = this.decorationShadowSprites[index];
    if (shadow !== undefined) this.applyGroundShadowGeometry(shadow, sprite);
  }

  /**
   * Dev/arrange-overlay "Scale +/-" for the selected decoration (T3.9a),
   * DRESSING_SCALE_STEP-sized steps within the store's own clamps - no-op
   * with nothing selected. Mirrors `scaleSelectedDressing`, but commits
   * through `setDecorationTransform` (the store owns the clamp) instead of
   * clamping locally. T3.27: while the decor sizing probe is on, passes
   * DEV_DECOR_SCALE_CEILING so the selected item can scale past the normal
   * cap, and logs the resulting frame/scale/px size.
   */
  private scaleSelectedDecoration(delta: number): void {
    if (this.selectedDecorationIndex === null) return;
    const index = this.selectedDecorationIndex;
    const sprite = this.decorationSprites[index];
    const decoration = gameState.getState().decorations[index];
    if (sprite === undefined || decoration === undefined) return;
    const nextScale = Math.round((decoration.scale + delta) * 100) / 100;
    if (
      !gameState.setDecorationTransform(
        index,
        decoration.x,
        decoration.y,
        nextScale,
        decoration.flip,
        this.decorSizingEnabled ? DEV_DECOR_SCALE_CEILING : undefined,
      )
    )
      return;
    const updated = gameState.getState().decorations[index];
    if (updated === undefined) return;
    sprite.setScale(updated.scale);
    const shadow = this.decorationShadowSprites[index];
    if (shadow !== undefined) this.applyGroundShadowGeometry(shadow, sprite);
    if (this.decorSizingEnabled) this.logDecorSizing(index);
  }

  /**
   * T3.27 dev probe toggle (`dev.decorSizing`): while OFF (default) the
   * arrange-mode Scale +/- buttons behave exactly as before - the store's
   * normal DECOR_SCALE_MAX stays the sole ceiling. While ON, the selected
   * decoration may scale up to DEV_DECOR_SCALE_CEILING and every scale
   * change/selection logs. Turning the flag off (and scene boot, see
   * `create`) logs any decoration still holding an over-cap scale so it is
   * never silently carried into normal play.
   */
  private setDecorSizingEnabled(enabled: boolean): void {
    this.decorSizingEnabled = enabled;
    if (!enabled) this.logOverCapDecorations();
    else if (this.selectedDecorationIndex !== null)
      this.logDecorSizing(this.selectedDecorationIndex);
  }

  /**
   * T3.27: one console line per scale change/selection while the decor
   * sizing probe is on - frame, scale factor, and the sprite's actual
   * rendered px size (its live `displayWidth`/`displayHeight`).
   */
  private logDecorSizing(index: number): void {
    const decoration = gameState.getState().decorations[index];
    const sprite = this.decorationSprites[index];
    if (decoration === undefined || sprite === undefined) return;
    const width = Math.round(sprite.displayWidth);
    const height = Math.round(sprite.displayHeight);
    console.log(
      `[decorSizing] ${decoration.frame} scale ${decoration.scale.toFixed(2)} -> ${width} x ${height} px`,
    );
  }

  /**
   * T3.27: warns about any decoration currently holding a scale above the
   * normal DECOR_SCALE_MAX cap (only reachable via the dev ceiling while the
   * probe was on) - called at scene boot and whenever the probe flag turns
   * off, so the owner is never surprised by an over-cap scale left over from
   * a probing session.
   */
  private logOverCapDecorations(): void {
    for (const decoration of gameState.getState().decorations) {
      if (decoration.scale > DECOR_SCALE_MAX) {
        console.log(
          `[decorSizing] ${decoration.frame} is over the normal cap: scale ${decoration.scale.toFixed(2)} > ${DECOR_SCALE_MAX} - will be clamped the next time it is touched.`,
        );
      }
    }
  }

  /**
   * Flip button (T3.15): mirrors the selected decoration's facing
   * (`setFlipX`), persisted through the same transform setter as scale
   * changes - a no-op with nothing selected, matching the scale buttons.
   * Ground shadows are symmetric ellipses, so unlike a scale change there is
   * no shadow geometry to re-derive.
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
  }

  /**
   * Highlights the tapped decoration with a tint; clears the previous
   * selection's tint first - mirrors `setDressingSelection`. Selecting a
   * decoration also deselects any selected plot (T3.3a - one selection at a
   * time across both kinds). Also re-derives the per-item buttons'
   * enabled/dim states, since they always act on whatever is selected.
   */
  private setDecorationSelection(index: number | null): void {
    if (index !== null) this.clearPlotSelectionTint();
    if (this.selectedDecorationIndex !== null) {
      this.decorationSprites[this.selectedDecorationIndex]?.clearTint();
    }
    this.selectedDecorationIndex = index;
    if (index !== null) {
      this.decorationSprites[index]?.setTint(DRESSING_SELECTED_TINT);
      if (this.decorSizingEnabled) this.logDecorSizing(index);
    }
    this.updateArrangeItemButtonsState();
  }

  /**
   * Select a plot (T3.3a): tints its tile, deselecting any decoration (and
   * the previous plot) first - the plot-side mirror of
   * `setDecorationSelection`, driving the same per-item button re-derive.
   */
  private setPlotSelection(index: number | null): void {
    if (index !== null && this.selectedDecorationIndex !== null) {
      this.decorationSprites[this.selectedDecorationIndex]?.clearTint();
      this.selectedDecorationIndex = null;
    }
    this.clearPlotSelectionTint();
    this.selectedPlotIndex = index;
    this.applyPlotSelectionTint();
    this.updateArrangeItemButtonsState();
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
   * Build the floating control rows once (T3.9a, extended to 5 buttons in
   * T3.9b, 6 in T3.15, reworked into two rows + a Shop button in T3.16):
   * row 1 (per-item, needs a selection) - [-] [+] [Flip] [Put Away] - above
   * row 2 (mode actions) - [Shed] [Shop] [Done]. Hidden and inert until
   * `enterArrangeMode` shows them. Each is a `panel` nineslice sized
   * directly to its own display bounds, so its default interactive hit area
   * already covers that full rectangle - no custom hitArea needed.
   */
  private createArrangeControls(): void {
    this.arrangeDoneButton = this.add
      .nineslice(
        ARRANGE_DONE_X,
        ARRANGE_ROW2_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_DONE_WIDTH,
        ARRANGE_DONE_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
    this.arrangeDoneText = this.add
      .text(ARRANGE_DONE_X, ARRANGE_ROW2_Y, 'Done', ARRANGE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangeDoneButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.exitArrangeMode();
    });

    this.arrangeScaleDownButton = this.add
      .nineslice(
        ARRANGE_SCALE_DOWN_X,
        ARRANGE_ROW1_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_SCALE_BUTTON_SIZE,
        ARRANGE_SCALE_BUTTON_SIZE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
    this.arrangeScaleDownText = this.add
      .text(ARRANGE_SCALE_DOWN_X, ARRANGE_ROW1_Y, '-', ARRANGE_SCALE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangeScaleDownButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.scaleSelectedDecoration(-DRESSING_SCALE_STEP);
    });

    this.arrangeScaleUpButton = this.add
      .nineslice(
        ARRANGE_SCALE_UP_X,
        ARRANGE_ROW1_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_SCALE_BUTTON_SIZE,
        ARRANGE_SCALE_BUTTON_SIZE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
    this.arrangeScaleUpText = this.add
      .text(ARRANGE_SCALE_UP_X, ARRANGE_ROW1_Y, '+', ARRANGE_SCALE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangeScaleUpButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.scaleSelectedDecoration(DRESSING_SCALE_STEP);
    });

    this.arrangeFlipButton = this.add
      .nineslice(
        ARRANGE_FLIP_X,
        ARRANGE_ROW1_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_FLIP_BUTTON_WIDTH,
        ARRANGE_ROW_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
    this.arrangeFlipText = this.add
      .text(ARRANGE_FLIP_X, ARRANGE_ROW1_Y, 'Flip', ARRANGE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangeFlipButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.toggleSelectedDecorationFlip();
    });

    this.arrangeWarehouseButton = this.add
      .nineslice(
        ARRANGE_SHED_X,
        ARRANGE_ROW2_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_SHED_WIDTH,
        ARRANGE_ROW_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
    this.arrangeWarehouseText = this.add
      .text(ARRANGE_SHED_X, ARRANGE_ROW2_Y, 'Shed', ARRANGE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangeWarehouseButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.toggleWarehousePanel();
    });

    this.arrangeShopButton = this.add
      .nineslice(
        ARRANGE_SHOP_X,
        ARRANGE_ROW2_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_SHOP_WIDTH,
        ARRANGE_ROW_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
    this.arrangeShopText = this.add
      .text(ARRANGE_SHOP_X, ARRANGE_ROW2_Y, 'Shop', ARRANGE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangeShopButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.openDecorShopFromArrange();
    });

    this.arrangeStoreButton = this.add
      .nineslice(
        ARRANGE_PUT_AWAY_X,
        ARRANGE_ROW1_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_PUT_AWAY_WIDTH,
        ARRANGE_ROW_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
    this.arrangeStoreText = this.add
      .text(ARRANGE_PUT_AWAY_X, ARRANGE_ROW1_Y, 'Put Away', ARRANGE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangeStoreButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.storeSelectedDecoration();
    });

    // Chain placement (T3.3a-r): "Place Next xN", its own centered row above
    // the per-item row. Visibility/label/enabled state are owned entirely by
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

    this.createWarehousePanel();
  }

  /**
   * Show/hide + enable/disable the arrange-mode controls together, so a
   * hidden control is never still tappable. The Store button is EXCLUDED
   * from the blanket interactive toggle - `updateArrangeItemButtonsState`
   * owns its enabled/dim state (it must stay dim/disabled while shown
   * whenever nothing is selected), called right after this on
   * `enterArrangeMode`; it also re-derives Scale/Flip, which the blanket
   * enable below may have just turned on despite a selected plot (T3.3a).
   */
  private setArrangeControlsVisible(visible: boolean): void {
    const controls: readonly [Phaser.GameObjects.NineSlice, Phaser.GameObjects.Text][] = [
      [this.arrangeDoneButton, this.arrangeDoneText],
      [this.arrangeScaleDownButton, this.arrangeScaleDownText],
      [this.arrangeScaleUpButton, this.arrangeScaleUpText],
      [this.arrangeFlipButton, this.arrangeFlipText],
      [this.arrangeWarehouseButton, this.arrangeWarehouseText],
      [this.arrangeShopButton, this.arrangeShopText],
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
    this.arrangeStoreButton.setVisible(visible);
    this.arrangeStoreText.setVisible(visible);
    if (!visible) this.arrangeStoreButton.disableInteractive();
    // The Place Next button (T3.3a-r) is session-owned: hidden with the rows
    // here, but only `updatePlaceNextButton` ever shows it.
    if (!visible) {
      this.arrangePlaceNextButton.setVisible(false);
      this.arrangePlaceNextText.setVisible(false);
      this.arrangePlaceNextButton.disableInteractive();
    }
  }

  /**
   * Per-item arrange buttons (T3.9b, plot rules added in T3.3a): the Put
   * Away button is enabled only while a DECORATION is selected (grants are
   * one-way - no put-away for plots), dim and inert otherwise - same
   * enabled/dim convention as DecorShop's Buy button. Scale +/- and Flip
   * disable while a PLOT is selected (plots snap to the grid - they never
   * scale or flip); with a decoration or nothing selected they stay enabled
   * as before (a no-selection tap is a no-op). Called whenever the selection
   * changes and whenever the rows' visibility changes.
   */
  private updateArrangeItemButtonsState(): void {
    const storeEnabled = this.selectedDecorationIndex !== null;
    this.arrangeStoreButton.setAlpha(
      storeEnabled ? ARRANGE_STORE_ENABLED_ALPHA : ARRANGE_STORE_DISABLED_ALPHA,
    );
    if (storeEnabled) {
      this.arrangeStoreButton.setInteractive({ useHandCursor: true });
    } else {
      this.arrangeStoreButton.disableInteractive();
    }
    const scaleFlipEnabled = this.selectedPlotIndex === null;
    for (const button of [
      this.arrangeScaleDownButton,
      this.arrangeScaleUpButton,
      this.arrangeFlipButton,
    ]) {
      button.setAlpha(
        scaleFlipEnabled ? ARRANGE_STORE_ENABLED_ALPHA : ARRANGE_STORE_DISABLED_ALPHA,
      );
      if (scaleFlipEnabled && this.arrangeModeActive) {
        button.setInteractive({ useHandCursor: true });
      } else {
        button.disableInteractive();
      }
    }
  }

  /**
   * The HUD's "Edit Layout" button (T3.25): a single control that opens
   * arrange mode from the farm and closes it while arranging (the button is
   * on the arrange-mode exempt list, so it stays tappable throughout).
   */
  private toggleArrangeMode(): void {
    if (this.arrangeModeActive) {
      this.exitArrangeMode();
    } else {
      this.enterArrangeMode();
    }
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
    this.seedBar.setVisible(false);
    for (const sprite of this.decorationSprites) sprite.setInteractive();
    this.setArrangeControlsVisible(true);
    this.updateArrangeItemButtonsState();
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
   * Exit arrange mode ("Done"): reverses `enterArrangeMode` exactly
   * (including closing the warehouse panel, if left open), then re-syncs
   * `lastDecorationsJson` from the current (already-committed and
   * already-rendered) state so `refreshDecorations`'s next call is a correct
   * no-op instead of an unnecessary rebuild.
   */
  private exitArrangeMode(): void {
    this.hideWarehousePanel();
    this.arrangeModeActive = false;
    // Chain placement session (T3.3a-r) ends with the mode; every spawn was
    // already committed, so ending mid-chain is safe - the Edit Layout flash
    // resumes for whatever remains in the shed.
    this.placementSession = null;
    this.sessionPlotIndices = [];
    this.lastPlacedDecorIndex = -1;
    this.setDecorationSelection(null);
    this.setPlotSelection(null);
    this.plotDragIndex = null;
    // A lift can only be pending/active mid-exit via a second finger on
    // Done (T3.3a-r3); drop it cleanly - nothing was committed yet, and the
    // gesture's own move/up handlers self-resolve on the dead mode flag.
    this.cancelPendingLift();
    this.activeLift = null;
    this.graceLift = null;
    this.settleLiftPulse();
    for (const sprite of this.decorationSprites) sprite.disableInteractive();
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
      // Owned entirely by refreshArrangePlotInteractivity/exitArrangeMode
      // (T3.3a) - the sweep must neither disable nor, crucially, RESTORE
      // them (see exitArrangeMode's comment).
      ...this.plotTileSprites,
      this.arrangePlaceNextButton,
      this.arrangeDoneButton,
      this.arrangeScaleDownButton,
      this.arrangeScaleUpButton,
      this.arrangeFlipButton,
      this.arrangeWarehouseButton,
      this.arrangeShopButton,
      this.arrangeStoreButton,
      this.hud.getArrangeToggleButton(),
      // T3.4b: camera gestures stay active while arranging, so recentering
      // must too (its own visibility logic still hides it at the default view).
      this.recenterButton,
    ];
  }

  /**
   * Store button handler (T3.9b): returns the current selection to the
   * warehouse. No-op with nothing selected (the button is disabled then
   * anyway - belt-and-braces). Destroys the sprite/shadow and splices both
   * parallel arrays at `index`, keeping them aligned with the store's own
   * `decorations.splice` - every other sprite's index is derived fresh via
   * `indexOf` at use time (see `createDecorationSprite`), never cached, so
   * the shift is transparent to them.
   */
  private storeSelectedDecoration(): void {
    if (this.selectedDecorationIndex === null) return;
    const index = this.selectedDecorationIndex;
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
    if (this.warehousePanelVisible) this.refreshWarehousePanel();
  }

  /**
   * Spawn the live sprite (+ shadow) for a decoration `placeFromWarehouse`
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
    this.plotTileSprites[this.plotDragIndex]?.setPosition(x, y).setDepth(this.plotTileDepth(y));
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
    this.hideWarehousePanel();
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
      const newIndex = gameState.placeFromWarehouse(session.frame);
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
          DECOR_SPAWN_SCALE,
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
          : (state.warehouse[session.frame] ?? 0);
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
      placeablePlotTiles().some((tile) => isPlotTileFree(state, tile.col, tile.row));
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
   * Build the warehouse panel once (T3.9b): a full-screen closing backdrop
   * (own zone, not the shared `ModalBackdrop` - see the WAREHOUSE_* constants'
   * comment for why it needs its own depth) plus a panel body with one row
   * per `DECOR_ITEMS` frame, laid out exactly like `DecorShop`'s own grid.
   * Hidden and every interactive piece left non-interactive until first
   * shown - `showWarehousePanel`/`hideWarehousePanel` own that toggle, same
   * "never rely on container visibility alone" convention as
   * `setArrangeControlsVisible`.
   */
  private createWarehousePanel(): void {
    this.warehouseBackdropZone = this.add
      .zone(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)
      .setOrigin(0, 0)
      .setDepth(WAREHOUSE_BACKDROP_DEPTH)
      .setVisible(false);
    this.warehouseBackdropZone.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        this.audio.sfx('tap');
        this.hideWarehousePanel();
      },
    );

    this.warehouseContainer = this.add
      .container(WAREHOUSE_PANEL_CENTER_X, WAREHOUSE_PANEL_CENTER_Y)
      .setDepth(WAREHOUSE_PANEL_DEPTH)
      .setVisible(false);

    const bg = this.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      WAREHOUSE_PANEL_WIDTH,
      WAREHOUSE_PANEL_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const title = this.add.text(0, WAREHOUSE_TITLE_Y, 'Shed', WAREHOUSE_TITLE_STYLE).setOrigin(0.5);
    this.warehouseCloseButton = this.add
      .text(WAREHOUSE_CLOSE_OFFSET_X, WAREHOUSE_CLOSE_OFFSET_Y, 'X', WAREHOUSE_CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16);
    this.warehouseCloseButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hideWarehousePanel();
    });
    this.warehouseEmptyText = this.add
      .text(0, 0, WAREHOUSE_EMPTY_TEXT, WAREHOUSE_EMPTY_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    this.warehouseContainer.add([bg, title, this.warehouseCloseButton, this.warehouseEmptyText]);
    this.warehouseBg = bg;
    // Do NOT call bg.setInteractive() here (T3.18b root cause): a container
    // child's FIRST setInteractive() call must happen while the panel is
    // actually being shown, matching warehouseBackdropZone/warehouseCloseButton/
    // each row's placeButton (all (re-)enabled from showWarehousePanel or
    // refreshWarehousePanel, every open) - verified live that an object whose
    // very first setInteractive() call happens once here, at panel-build time,
    // never wins a real hit-test against warehouseBackdropZone anywhere except
    // exactly on other already-interactive objects, even though its own
    // position/origin/hitArea all read back as correct. bg.setInteractive()
    // lives in showWarehousePanel/hideWarehousePanel instead.
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
    // `unplacedPlots`, not the warehouse record, and placing snaps to the
    // best free owned tile instead of a free-form spawn. Its icon keeps the
    // plot frame's own wide-diamond aspect (a square would visibly squash it;
    // decor/trophy frames are square already, so only this row needs it).
    this.plotShedRow = this.buildWarehouseRow('plot', 'Farm Plot', WAREHOUSE_NAME_STYLE, () =>
      this.placeShedPlot(),
    );
    this.plotShedRow.icon.setDisplaySize(
      WAREHOUSE_ICON_SIZE,
      (WAREHOUSE_ICON_SIZE * TILE_FRAME_HEIGHT) / TILE_WIDTH,
    );
    this.warehouseRows = [
      ...DECOR_ITEMS.map((item) =>
        this.buildWarehouseRow(item.frame, item.name, WAREHOUSE_NAME_STYLE, () =>
          this.placeShedDecoration(item.frame),
        ),
      ),
      ...TROPHY_ITEMS.map((item) =>
        this.buildWarehouseRow(item.frame, item.name, WAREHOUSE_TROPHY_NAME_STYLE, () =>
          this.placeShedDecoration(item.frame),
        ),
      ),
    ];
  }

  /** A decor/trophy row's Place action - also starts the decor chain session
   * (T3.3a-r), bookkeeping before juice like the plot paths (T3.3a-r2f2). */
  private placeShedDecoration(frame: string): void {
    const newIndex = gameState.placeFromWarehouse(frame);
    if (newIndex === false) return;
    this.placementSession = { kind: 'decor', frame };
    this.lastPlacedDecorIndex = newIndex;
    this.updatePlaceNextButton();
    this.audio.sfx('tap');
    this.hideWarehousePanel();
    this.spawnPlacedDecorationSprite(newIndex);
  }

  /**
   * One warehouse panel row: icon, name, "xN" count, a Place button - built
   * once at a neutral (0, 0) position, hidden until shown. `nameStyle` is
   * `WAREHOUSE_TROPHY_NAME_STYLE` for a trophy row, `WAREHOUSE_NAME_STYLE`
   * otherwise - everything else (icon, count, Place button/behavior) is
   * identical between decor and trophy rows. Actual on-panel position is
   * assigned later, per visible slot, by `positionWarehouseRow`.
   */
  private buildWarehouseRow(
    frame: string,
    name: string,
    nameStyle: Phaser.Types.GameObjects.Text.TextStyle,
    onPlace: () => void,
  ): WarehouseRow {
    const icon = this.add
      .image(0, 0, ATLAS_KEY, frame)
      .setDisplaySize(WAREHOUSE_ICON_SIZE, WAREHOUSE_ICON_SIZE)
      .setVisible(false);
    const nameText = this.add.text(0, 0, name, nameStyle).setOrigin(0, 0.5).setVisible(false);
    // Shrink-to-fit (T3.18a): never lets a long trophy name reach the Place button.
    nameText.setScale(Math.min(1, WAREHOUSE_NAME_MAX_WIDTH / nameText.width));
    const countText = this.add
      .text(0, 0, '', WAREHOUSE_COUNT_STYLE)
      .setOrigin(0, 0.5)
      .setVisible(false);

    const placeButton = this.add
      .nineslice(
        0,
        0,
        ATLAS_KEY,
        'panel',
        WAREHOUSE_PLACE_BUTTON_WIDTH,
        WAREHOUSE_PLACE_BUTTON_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setVisible(false);
    const placeText = this.add
      .text(0, 0, 'Place', WAREHOUSE_PLACE_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    placeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onPlace);

    this.warehouseContainer.add([icon, nameText, countText, placeButton, placeText]);
    return { frame, icon, nameText, countText, placeButton, placeText };
  }

  /**
   * Position one row's five objects into the slot for `visibleIndex` (T3.18):
   * same per-object offsets `buildWarehouseRow` used to apply directly, now
   * computed from the row's rank among VISIBLE rows rather than its fixed
   * build-order index, so owned rows pack top-down with no gaps regardless of
   * which frames are owned.
   */
  private positionWarehouseRow(row: WarehouseRow, visibleIndex: number): void {
    const colX = WAREHOUSE_COLUMN_X[Math.floor(visibleIndex / WAREHOUSE_ROWS_PER_COLUMN)]!;
    const y =
      WAREHOUSE_ROW_START_Y + (visibleIndex % WAREHOUSE_ROWS_PER_COLUMN) * WAREHOUSE_ROW_SPACING;

    row.icon.setPosition(colX + WAREHOUSE_ICON_OFFSET_X, y);
    row.nameText.setPosition(colX + WAREHOUSE_NAME_OFFSET_X, y + WAREHOUSE_NAME_OFFSET_Y);
    row.countText.setPosition(colX + WAREHOUSE_COUNT_OFFSET_X, y + WAREHOUSE_COUNT_OFFSET_Y);
    row.placeButton.setPosition(colX + WAREHOUSE_PLACE_BUTTON_OFFSET_X, y);
    row.placeText.setPosition(colX + WAREHOUSE_PLACE_BUTTON_OFFSET_X, y);
  }

  /** Open (or close) the warehouse panel from the control row's Warehouse button. */
  private toggleWarehousePanel(): void {
    if (this.warehousePanelVisible) this.hideWarehousePanel();
    else this.showWarehousePanel();
  }

  private showWarehousePanel(): void {
    this.refreshWarehousePanel();
    this.warehousePanelVisible = true;
    this.warehouseContainer.setVisible(true);
    this.warehouseBackdropZone.setVisible(true).setInteractive();
    this.warehouseBg.setInteractive();
    this.warehouseCloseButton.setInteractive({ useHandCursor: true });
    setPanelOpen('decor-warehouse', true);
  }

  private hideWarehousePanel(): void {
    if (!this.warehousePanelVisible) return;
    this.warehousePanelVisible = false;
    this.warehouseContainer.setVisible(false);
    this.warehouseBackdropZone.setVisible(false).disableInteractive();
    this.warehouseBg.disableInteractive();
    this.warehouseCloseButton.disableInteractive();
    this.plotShedRow.placeButton.disableInteractive();
    for (const row of this.warehouseRows) row.placeButton.disableInteractive();
    setPanelOpen('decor-warehouse', false);
  }

  /**
   * Re-derive every row's visibility/count/Place-button state from the
   * live warehouse (T3.9b): rows with nothing owned hide entirely (icon,
   * name, count, button - never a dangling interactive hitbox on an invisible
   * row), rows with any owned show with a truthful "xN" and an interactive
   * Place button. Visible rows are also (re)positioned here (T3.18), in
   * build order (decor before trophies), so they pack top-down with no gaps
   * no matter which frames happen to be owned. The empty-state text shows
   * only when nothing is owned at all.
   */
  private refreshWarehousePanel(): void {
    const state = gameState.getState();
    const warehouse = state.warehouse;
    let anyOwned = false;
    let visibleIndex = 0;
    // "Farm Plot xN" leads (T3.3a): counted from `unplacedPlots`. Its Place
    // button dims (Store-button convention) when no owned tile is free -
    // that is how a granted-but-unplaceable plot communicates the refusal.
    const plotCount = state.unplacedPlots;
    const showPlotRow = plotCount > 0;
    if (showPlotRow) anyOwned = true;
    const anyFreeTile = placeablePlotTiles().some((tile) =>
      isPlotTileFree(state, tile.col, tile.row),
    );
    this.plotShedRow.icon.setVisible(showPlotRow);
    this.plotShedRow.nameText.setVisible(showPlotRow);
    this.plotShedRow.countText.setVisible(showPlotRow).setText(`x${plotCount}`);
    this.plotShedRow.placeText.setVisible(showPlotRow);
    this.plotShedRow.placeButton.setVisible(showPlotRow);
    if (showPlotRow) {
      this.positionWarehouseRow(this.plotShedRow, visibleIndex);
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
    for (const row of this.warehouseRows) {
      const owned = warehouse[row.frame] ?? 0;
      const has = owned > 0;
      if (has) anyOwned = true;
      row.icon.setVisible(has);
      row.nameText.setVisible(has);
      row.countText.setVisible(has).setText(`x${owned}`);
      row.placeText.setVisible(has);
      row.placeButton.setVisible(has);
      if (has) {
        this.positionWarehouseRow(row, visibleIndex);
        visibleIndex++;
        row.placeButton.setInteractive({ useHandCursor: true });
      } else {
        row.placeButton.disableInteractive();
      }
    }
    this.warehouseEmptyText.setVisible(!anyOwned);
  }

  /**
   * Dirt path ground decal (T2.22b), no interaction. Kept as one isolated
   * create call, same as the farmhouse, so it can be pulled independently -
   * see DIRT_PATH_POSITION's comment in config.ts for how the position was
   * measured.
   */
  private createDirtPath(): void {
    this.add
      .image(DIRT_PATH_POSITION.x, DIRT_PATH_POSITION.y, ATLAS_KEY, 'dirt_path')
      .setScale(DIRT_PATH_SCALE)
      .setDepth(DIRT_PATH_DEPTH);
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
    const pad = NOTICE_BOARD_HIT_PAD_DISPLAY_PX / STRUCTURE_SCALE;
    this.noticeBoardImage = this.add
      .image(NOTICE_BOARD_POSITION.x, NOTICE_BOARD_POSITION.y, ATLAS_KEY, 'notice_board')
      .setScale(STRUCTURE_SCALE)
      .setDepth(NOTICE_BOARD_POSITION.y)
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
    this.createGroundShadow(this.noticeBoardImage);

    const badgeX =
      NOTICE_BOARD_POSITION.x +
      (NOTICE_BOARD_CONTENT_RIGHT_NATIVE - STRUCTURE_FRAME_SIZE / 2) * STRUCTURE_SCALE +
      BADGE_CORNER_NUDGE;
    const badgeY =
      NOTICE_BOARD_POSITION.y +
      (NOTICE_BOARD_CONTENT_RIGHT_Y_NATIVE - STRUCTURE_FRAME_SIZE / 2) * STRUCTURE_SCALE -
      BADGE_CORNER_NUDGE;
    this.noticeBoardBadge = this.add
      .text(badgeX, badgeY, '!', BADGE_TEXT_STYLE)
      .setOrigin(0.5)
      .setDepth(NOTICE_BOARD_POSITION.y + 1)
      .setVisible(false);
    // Gentle perpetual bounce so an active badge draws the eye without being
    // distracting; runs continuously (harmless while hidden) rather than
    // starting/stopping with visibility, matching the codebase's other
    // perpetual-tween highlights (SwipeGuide, OnboardingGuide's halo).
    this.tweens.add({
      targets: this.noticeBoardBadge,
      y: badgeY + BADGE_BOUNCE_OFFSET_Y,
      duration: BADGE_BOUNCE_HALF_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
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
