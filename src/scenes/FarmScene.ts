import Phaser from 'phaser';

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
} from '../config';
import { CROP_BASELINE_Y, CROP_FRAME_SIZE, CROPS, type CropDef, type CropId } from '../data/crops';
import { DECOR_ITEMS } from '../data/decor';
import { BASE_PLOT_COUNT, EXPANDED_PLOT_COUNT, FARM_COLS } from '../data/farm';
import { isOrderCoverable } from '../data/orders';
import { AudioManager } from '../systems/audio';
import {
  registerCoinArcTest,
  registerDressingEditorHooks,
  registerGroundModeCycle,
  registerHitboxToggle,
} from '../systems/dev';
import { gameState, type DecorationPlacement } from '../systems/gameState';
import { isReady, stageIndex } from '../systems/growth';
import { buzz } from '../systems/haptics';
import { gridToIso, TILE_HEIGHT, TILE_WIDTH } from '../systems/iso';
import { isModalOpen, setPanelOpen } from '../systems/modalPanels';
import { PlotPointerTracker } from '../systems/plotPointer';
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
import { QuestBoard } from '../ui/QuestBoard';
import { ReplantChip, type ReplantEntry } from '../ui/ReplantChip';
import { SeedBar } from '../ui/SeedBar';

/** Slightly darker than the grass tiles so the field reads as raised ground. */
const BACKGROUND_COLOR = 0x55913f;

/**
 * Tile sprite origin: x centered, y at the diamond top face's center - the
 * frame is taller than the 2:1 diamond because the art's lip/fringe hangs
 * below it. Positioning stays "tile center at gridToIso(col, row)", so the
 * grid math and hit-testing are untouched by the taller frame.
 */
const TILE_ORIGIN_Y = TILE_DIAMOND_CENTER_Y / TILE_FRAME_HEIGHT;

/**
 * Vertical range (in design pixels) covered by the ground layer: the FULL
 * screen. Historically a 420..1500 band (headroom for HUD/seed bar), but the
 * band edges read as visible seams against any ground whose green differs
 * from BACKGROUND_COLOR - the HUD and seed bar draw over the ground anyway
 * (user report + PM-direct fix, 2026-07-12).
 */
const FIELD_MIN_Y = 0;
const FIELD_MAX_Y = DESIGN_HEIGHT;

/** Grid range scanned when laying grass; wide enough to fill the range above. */
const GRASS_GRID_MIN = -9;
const GRASS_GRID_MAX = 13;

/**
 * Depth of the WHOLE ground layer - the texture TileSprite AND the grass
 * tile images alike: below plot tiles (default depth 0) and above the
 * background rect (-2). Grass tiles need this explicitly because the dev
 * ground-mode cycle rebuilds them AFTER the plots exist - at a shared
 * default depth, later insertion drew grass over the plots (user report +
 * PM-direct fix, 2026-07-12).
 */
const GROUND_LAYER_DEPTH = -1;

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

/** Delay before each new plot's tile fade-in starts when the farm expands. */
const EXPAND_REVEAL_STAGGER_MS = 1200;
/** Duration of each new plot's tile fade-in when the farm expands. */
const EXPAND_REVEAL_FADE_MS = 2400;

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
 * T3.9b): in-canvas Phaser objects only (phone-first, no DOM). While
 * arranging, the seed bar hides entirely (`SeedBar.setVisible`) and this row
 * - [Warehouse] [-] [+] [Store] [Done] - takes over its band (~y 1700), at a
 * depth above every other UI tier (seed bar 2000, panels 2100) so nothing can
 * render over these controls while arranging. Each button is a `panel`
 * nineslice sized directly to its own width/height (not scaled from a
 * smaller native frame), so its default interactive hit area already matches
 * its full display bounds one-to-one - no custom hitArea needed to satisfy
 * the >=100px/frame-relative hit-area rule. Positions are five varying-width
 * buttons, evenly gapped and centered on the design width - computed once
 * below rather than hand-placed, so the row stays centered if a width
 * changes.
 */
const ARRANGE_UI_DEPTH = 2200;
const ARRANGE_ROW_Y = 1700;
const ARRANGE_ROW_HEIGHT = 100;
const ARRANGE_ROW_GAP = 24;
const ARRANGE_WAREHOUSE_WIDTH = 200;
const ARRANGE_SCALE_BUTTON_SIZE = 100;
const ARRANGE_STORE_WIDTH = 170;
const ARRANGE_DONE_WIDTH = 220;
const ARRANGE_DONE_HEIGHT = ARRANGE_ROW_HEIGHT;

const ARRANGE_ROW_WIDTHS = [
  ARRANGE_WAREHOUSE_WIDTH,
  ARRANGE_SCALE_BUTTON_SIZE,
  ARRANGE_SCALE_BUTTON_SIZE,
  ARRANGE_STORE_WIDTH,
  ARRANGE_DONE_WIDTH,
];
const ARRANGE_ROW_TOTAL_WIDTH =
  ARRANGE_ROW_WIDTHS.reduce((sum, width) => sum + width, 0) +
  ARRANGE_ROW_GAP * (ARRANGE_ROW_WIDTHS.length - 1);
const ARRANGE_ROW_CENTER_XS: number[] = (() => {
  let x = DESIGN_WIDTH / 2 - ARRANGE_ROW_TOTAL_WIDTH / 2;
  return ARRANGE_ROW_WIDTHS.map((width) => {
    const center = x + width / 2;
    x += width + ARRANGE_ROW_GAP;
    return center;
  });
})();
const [
  ARRANGE_WAREHOUSE_X,
  ARRANGE_SCALE_DOWN_X,
  ARRANGE_SCALE_UP_X,
  ARRANGE_STORE_X,
  ARRANGE_DONE_X,
] = ARRANGE_ROW_CENTER_XS as [number, number, number, number, number];

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
 * (the only frames a warehouse can ever hold today - trophies are not yet
 * purchasable), shown/hidden per-row from live owned counts.
 */
const WAREHOUSE_PANEL_WIDTH = 900;
const WAREHOUSE_PANEL_HEIGHT = 1320;
const WAREHOUSE_PANEL_CENTER_X = DESIGN_WIDTH / 2;
const WAREHOUSE_PANEL_CENTER_Y = 980;
const WAREHOUSE_BACKDROP_DEPTH = ARRANGE_UI_DEPTH + 50;
const WAREHOUSE_PANEL_DEPTH = ARRANGE_UI_DEPTH + 60;

const WAREHOUSE_TITLE_Y = -WAREHOUSE_PANEL_HEIGHT / 2 + 60;
const WAREHOUSE_CLOSE_OFFSET_X = WAREHOUSE_PANEL_WIDTH / 2 - 50;
const WAREHOUSE_CLOSE_OFFSET_Y = -WAREHOUSE_PANEL_HEIGHT / 2 + 50;

const WAREHOUSE_ROWS_PER_COLUMN = 5;
const WAREHOUSE_COLUMN_X = [-215, 215] as const;
const WAREHOUSE_ROW_START_Y = -380;
const WAREHOUSE_ROW_SPACING = 190;

const WAREHOUSE_ICON_OFFSET_X = -195;
const WAREHOUSE_ICON_NATIVE_SIZE = 128;
const WAREHOUSE_ICON_DISPLAY_SIZE = 84;
const WAREHOUSE_ICON_SCALE = WAREHOUSE_ICON_DISPLAY_SIZE / WAREHOUSE_ICON_NATIVE_SIZE;

const WAREHOUSE_NAME_OFFSET_X = -140;
const WAREHOUSE_NAME_OFFSET_Y = -22;
const WAREHOUSE_COUNT_OFFSET_X = -140;
const WAREHOUSE_COUNT_OFFSET_Y = 22;

const WAREHOUSE_PLACE_BUTTON_OFFSET_X = 140;
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

/** One warehouse panel row (T3.9b) - one per `DECOR_ITEMS` frame, built once, shown/hidden per owned count. */
interface WarehouseRow {
  frame: string;
  icon: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  countText: Phaser.GameObjects.Text;
  placeButton: Phaser.GameObjects.NineSlice;
  placeText: Phaser.GameObjects.Text;
}

/**
 * The main farm scene: a FARM_COLS x FARM_ROWS grid of plots in the middle of
 * a grass field, rendered live from `gameState`, plus the seed bar. One
 * unified field gesture: tapping or sweeping harvests every ready crop the
 * pointer enters, and (with a seed selected) paint-plants empty plots.
 *
 * Plot index convention (matches `gameState.plots`): index = row * FARM_COLS
 * + col. Any future code mapping a tile tap to a plot must use the same
 * formula (see `indexToGrid` below).
 */
export class FarmScene extends Phaser.Scene {
  /** One reusable crop sprite per plot, indexed like `gameState.plots`. */
  private cropSprites: Phaser.GameObjects.Image[] = [];
  /**
   * One tile image per plot, indexed like `gameState.plots`. Kept so the
   * onboarding highlight can breathe the TILE - never the crop sprite, which
   * owns its own ready bounce.
   */
  private readonly plotTiles: Phaser.GameObjects.Image[] = [];
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
  private floatingText!: FloatingText;
  private particles!: ParticleBurst;
  private coinArc!: CoinArc;
  private moondustArc!: MoondustArc;
  private hud!: Hud;
  private levelUpCelebration!: LevelUpCelebration;
  private onboardingGuide!: OnboardingGuide;
  private expandSign!: ExpandSign;
  private offlineSummaryPanel!: OfflineSummaryPanel;
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
  private arrangeDoneButton!: Phaser.GameObjects.NineSlice;
  private arrangeDoneText!: Phaser.GameObjects.Text;
  private arrangeScaleDownButton!: Phaser.GameObjects.NineSlice;
  private arrangeScaleDownText!: Phaser.GameObjects.Text;
  private arrangeScaleUpButton!: Phaser.GameObjects.NineSlice;
  private arrangeScaleUpText!: Phaser.GameObjects.Text;
  /** T3.9b control row additions. */
  private arrangeWarehouseButton!: Phaser.GameObjects.NineSlice;
  private arrangeWarehouseText!: Phaser.GameObjects.Text;
  private arrangeStoreButton!: Phaser.GameObjects.NineSlice;
  private arrangeStoreText!: Phaser.GameObjects.Text;
  /** Every OTHER interactive object suppressed for the duration of arrange mode - see `setOtherHitboxesEnabled`. */
  private readonly arrangeModeDisabledObjects: Phaser.GameObjects.GameObject[] = [];
  /** Warehouse panel (T3.9b) - see `createWarehousePanel`. */
  private warehouseContainer!: Phaser.GameObjects.Container;
  private warehouseBackdropZone!: Phaser.GameObjects.Zone;
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
    // Depth -2: below the whole ground layer (GROUND_LAYER_DEPTH, -1),
    // which must render above this rect but below every depth-0 gameplay
    // object. Without this, texture mode drew beneath the opaque background
    // and read as solid green (PM-direct fix after T2.28).
    this.add
      .rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, BACKGROUND_COLOR)
      .setOrigin(0, 0)
      .setDepth(-2);

    this.createGroundLayer(this.groundMode);
    this.createDirtPath();
    this.createSceneDressing();
    this.buildPlotVisuals();
    // Before any UI that plays sounds; startMusic self-defers until the
    // sound system unlocks on the first user gesture.
    this.audio = new AudioManager(this);
    this.audio.startMusic();
    this.floatingText = new FloatingText(this);
    this.particles = new ParticleBurst(this);
    this.coinArc = new CoinArc(this);
    this.moondustArc = new MoondustArc(this);
    this.cropInfoCard = new CropInfoCard(this, this.audio);
    this.decorShop = new DecorShop(this, this.audio, () => this.enterArrangeMode());
    this.seedBar = new SeedBar(this, this.audio, (crop) => this.showCropInfo(crop));
    this.cropCountdown = new CropCountdown(this);
    this.replantChip = new ReplantChip(
      this,
      this.audio,
      (plantedEntries) => this.handleReplanted(plantedEntries),
      () => {
        this.pendingReplant = [];
      },
    );
    // Fill pending/expired order slots before the HUD's first render.
    gameState.ensureOrders();
    this.hud = new Hud(this, this.coinArc, this.moondustArc, this.floatingText, this.audio);
    // Constructed after Hud (needs it for claim-reward juice - see
    // QuestBoard's own comment) and handed back in via setQuestBoard so the
    // HUD's scroll icon can own toggling it, mirroring the bag.
    this.questBoard = new QuestBoard(this, this.hud, this.audio);
    this.hud.setQuestBoard(this.questBoard);
    this.createFarmhouse();
    this.createNoticeBoard();
    registerPulseTarget('empty-plot', () => this.plotPulseTarget('empty'));
    registerPulseTarget('ready-plot', () => this.plotPulseTarget('ready'));
    registerPulseTarget('orders-button', () => ({
      x: NOTICE_BOARD_POSITION.x,
      y: NOTICE_BOARD_POSITION.y,
      width: STRUCTURE_DISPLAY_HEIGHT,
      height: STRUCTURE_DISPLAY_HEIGHT,
      object: this.noticeBoardImage,
    }));
    // Applied once immediately (not just on the periodic tick) so a fresh
    // scene start never shows a flash of interactive board before the
    // tutorial's rails have had a chance to disable it.
    this.applyNoticeBoardRailsGating();
    this.refreshNoticeBoardBadge();
    // Same "no flash of interactive before the rails disable it" reasoning as the notice board above.
    this.applyFarmhouseRailsGating();
    this.onboardingGuide = new OnboardingGuide(this);
    this.levelUpCelebration = new LevelUpCelebration(this, this.particles, this.audio);
    this.chestCeremony = new ChestCeremony(this, this.particles, this.hud, this.audio);
    this.expandSign = new ExpandSign(this, () => this.tryExpand());
    this.expandSign.refresh(gameState.getState());
    this.createArrangeControls();
    this.setupFieldInput();
    this.refreshCrops();
    this.refreshDecorations();
    this.onboardingGuide.refresh(gameState.getState());

    // Checked once per scene start, after every other panel/backdrop exists -
    // it blocks field input like any modal, via the same isModalOpen() gate.
    this.offlineSummaryPanel = new OfflineSummaryPanel(this, this.audio);
    const offlineSummary = gameState.consumeOfflineSummary();
    if (offlineSummary !== null) this.offlineSummaryPanel.show(offlineSummary);

    // Coin arcs are not wired to gameplay until the HUD/sell task; expose a
    // console hook so curved flights can be verified now.
    registerCoinArcTest((n) => this.coinArc.fly(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, n));
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
  }

  override update(_time: number, delta: number): void {
    this.refreshAccumulatorMs += delta;
    if (this.refreshAccumulatorMs < CROP_REFRESH_INTERVAL_MS) return;
    this.refreshAccumulatorMs = 0;
    gameState.ensureOrders();
    this.refreshCrops();
    this.seedBar.refresh();
    this.replantChip.refresh(gameState.getState());
    this.cropCountdown.refresh(gameState.getState());
    this.hud.refresh();
    this.applyNoticeBoardRailsGating();
    this.refreshNoticeBoardBadge();
    this.applyFarmhouseRailsGating();
    this.refreshDecorations();
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
    // Chest events (T2.23a) are deferred behind the level-up celebration: a
    // fulfillment that both levels up and earns a chest must show the level
    // celebration first, chest ceremony after - so while it's active, this
    // simply leaves any earned chests queued in the store (their rewards are
    // already granted; only the show waits) rather than draining them here.
    if (!this.levelUpCelebration.isActive()) {
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
   * Unified field gesture: every plot the pointer newly enters (tap or drag,
   * at most once per gesture courtesy of PlotPointerTracker) is offered to
   * harvest first, then to plant. Harvesting never requires deselecting a
   * seed, and the per-gesture dedup guarantees a just-harvested plot cannot
   * be replanted within the same sweep. A new gesture only resets
   * `gestureMode` (which action this sweep has locked to) - it deliberately
   * leaves `pendingReplant` and the chip alone, so a stray tap or a second
   * harvest sweep never kills an offer still accumulating from an earlier one.
   */
  private setupFieldInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.gestureMode = null;
      const plotIndex = this.plotTracker.begin(pointer.worldX, pointer.worldY, this.rowCount());
      this.maybeShowCountdown(plotIndex);
      this.handlePlotEntered(plotIndex);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      this.handlePlotEntered(
        this.plotTracker.move(pointer.worldX, pointer.worldY, this.rowCount()),
      );
    });
    const endGesture = (): void => {
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
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, endGesture);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, endGesture);
  }

  /** Current row count (3 base, 4 once expanded), derived from saved plot count. */
  private rowCount(): number {
    return gameState.getState().plots.length / FARM_COLS;
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
   * Attempt the farm expansion purchase. On success, builds the new row's
   * tiles/sprites (state updates instantly - planting on a still-fading plot
   * is allowed), then fades each new plot's tile in from alpha 0 on a
   * staggered timer - a calm reveal with no particle bursts, timed to the
   * expand fanfare which ducks everything else while it plays; on failure
   * (insufficient coins - the sign is hidden once already expanded, so that
   * is the only failure reachable from a tap) nudges the sign instead.
   */
  private tryExpand(): void {
    if (!gameState.expandFarm()) {
      this.expandSign.flashInsufficientCoins();
      return;
    }
    this.audio.expandFanfare();
    // Expansion adds a row, which recenters the iso origin - reposition every
    // existing plot before building the new row's visuals at the new origin.
    const rowCount = this.rowCount();
    for (let index = 0; index < BASE_PLOT_COUNT; index++) {
      this.repositionPlotVisuals(index, rowCount);
    }
    for (let index = BASE_PLOT_COUNT; index < EXPANDED_PLOT_COUNT; index++) {
      this.createPlotVisuals(index, rowCount);
      const tile = this.plotTiles[index];
      if (tile === undefined) continue;
      tile.setAlpha(0);
      this.tweens.add({
        targets: tile,
        alpha: 1,
        delay: (index - BASE_PLOT_COUNT) * EXPAND_REVEAL_STAGGER_MS,
        duration: EXPAND_REVEAL_FADE_MS,
      });
    }
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
    this.particles.burst('leaf', pos.x, pos.y + BURST_OFFSET_Y);
    this.floatingText.show(pos.x, pos.y + XP_LABEL_OFFSET_Y, XP_LABELS[cropId], XP_TEXT_OPTIONS);
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
    this.particles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
    this.floatingText.show(
      pos.x,
      pos.y + RADIANT_LABEL_OFFSET_Y,
      RADIANT_LABEL,
      RADIANT_TEXT_OPTIONS,
    );
    this.time.delayedCall(RADIANT_SECOND_BURST_DELAY_MS, () => {
      this.particles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
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
        this.particles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
        this.floatingText.show(
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
      if (pos !== undefined) this.particles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
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
        if (x < -TILE_WIDTH / 2 || x > DESIGN_WIDTH + TILE_WIDTH / 2) continue;
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
      .tileSprite(0, FIELD_MIN_Y, DESIGN_WIDTH, FIELD_MAX_Y - FIELD_MIN_Y, key)
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
   * Build the plot tile + crop sprite for every saved plot (12 on a fresh or
   * unexpanded save, 16 on an expanded one) - so a 16-plot save renders its
   * 4th row, correctly recentered, immediately on load. Also called (per new
   * index) at runtime when `tryExpand` succeeds, so the new row appears
   * without a scene reload.
   */
  private buildPlotVisuals(): void {
    const plotCount = gameState.getState().plots.length;
    const rowCount = plotCount / FARM_COLS;
    for (let index = 0; index < plotCount; index++) {
      this.createPlotVisuals(index, rowCount);
    }
  }

  /** (col, row) for a plot index, inverse of `index = row * FARM_COLS + col`. */
  private indexToGrid(index: number): { col: number; row: number } {
    return { col: index % FARM_COLS, row: Math.floor(index / FARM_COLS) };
  }

  /**
   * Create one plot's tile and crop sprite, positioned on the iso grid (for
   * the given current row count) with the crop's baseline anchoring, hidden
   * until the plot has a growing crop. Sprites are reused for the life of the
   * scene - no per-frame allocation.
   */
  private createPlotVisuals(index: number, rowCount: number): void {
    const { col, row } = this.indexToGrid(index);
    const { x, y } = gridToIso(col, row, rowCount);
    this.plotTiles[index] = this.add.image(x, y, ATLAS_KEY, 'plot').setOrigin(0.5, TILE_ORIGIN_Y);
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

  /**
   * Reposition an already-built plot's tile/sprite for a new row count - used
   * when expansion recenters the whole grid. Depth is re-derived from the new
   * y like at creation, so draw order stays correct after the shift.
   */
  private repositionPlotVisuals(index: number, rowCount: number): void {
    const { col, row } = this.indexToGrid(index);
    const { x, y } = gridToIso(col, row, rowCount);
    this.plotTiles[index]?.setPosition(x, y);
    this.cropSprites[index]?.setPosition(x, y).setDepth(y);
    this.plotPositions[index] = { x, y };
  }

  /**
   * Keep the built tile/sprite set in step with `plots.length`, so a plot
   * count change outside `tryExpand` (a dev reset of an expanded save back
   * to 12 plots, or importing a 16-plot save) renders correctly without a
   * reload: extras are destroyed, missing ones are created, and everything
   * remaining is repositioned for the new grid origin. A cheap length check
   * on the refresh tick; a no-op after `tryExpand`, which builds its own.
   */
  private syncPlotVisuals(plotCount: number): void {
    if (this.plotTiles.length === plotCount) return;
    const rowCount = plotCount / FARM_COLS;
    while (this.plotTiles.length > plotCount) {
      this.plotTiles.pop()?.destroy();
      const sprite = this.cropSprites.pop();
      if (sprite !== undefined) {
        this.tweens.killTweensOf(sprite);
        sprite.destroy();
      }
      this.plotPositions.pop();
      this.readyActive.pop();
      this.popActive.pop();
    }
    for (let index = 0; index < this.plotTiles.length; index++) {
      this.repositionPlotVisuals(index, rowCount);
    }
    while (this.plotTiles.length < plotCount) {
      this.createPlotVisuals(this.plotTiles.length, rowCount);
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
    this.syncPlotVisuals(plots.length);
    const nowMs = now();
    for (let index = 0; index < plots.length; index++) {
      const plot = plots[index];
      const sprite = this.cropSprites[index];
      if (plot === undefined || sprite === undefined) continue;

      // Occupied plots show the planted-soil tile; frame set only on change,
      // same pattern as the crop sprite frames below.
      const tile = this.plotTiles[index];
      const tileFrame = plot.state === 'growing' ? 'plot_occupied' : 'plot';
      if (tile !== undefined && tile.frame.name !== tileFrame) tile.setFrame(tileFrame);

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
      const tile = this.plotTiles[index];
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
    this.farmhouseImage.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.openDecorShop();
    });
    this.createGroundShadow(this.farmhouseImage);
  }

  /**
   * Tap handler for the farmhouse: same panel-exclusivity + tap sfx
   * convention as the notice board's `Hud.toggleOrderBoard`.
   */
  private openDecorShop(): void {
    this.audio.sfx('tap');
    this.hud.closePanels();
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
   * One decoration's sprite (T3.9a), wired for arrange mode's select/drag
   * events - inert until `enterArrangeMode` makes it interactive, same
   * "always wired, only listens while the mode flag is on" pattern as
   * `createDressingSprite`. Dragging moves the sprite and its ground shadow
   * live every frame (including re-deriving depth from the live y, so it
   * naturally re-sorts against crops/structures while being dragged); the
   * position only commits to the store on drag-end.
   */
  private createDecorationSprite(decoration: DecorationPlacement): Phaser.GameObjects.Image {
    const sprite = this.add
      .image(decoration.x, decoration.y, ATLAS_KEY, decoration.frame)
      .setScale(decoration.scale)
      .setDepth(decoration.y);
    sprite.on('pointerdown', () => {
      if (!this.arrangeModeActive) return;
      const index = this.decorationSprites.indexOf(sprite);
      if (index !== -1) this.setDecorationSelection(index);
    });
    sprite.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      if (!this.arrangeModeActive) return;
      sprite.setPosition(dragX, dragY).setDepth(dragY);
      const index = this.decorationSprites.indexOf(sprite);
      const shadow = index !== -1 ? this.decorationShadowSprites[index] : undefined;
      if (shadow !== undefined) this.applyGroundShadowGeometry(shadow, sprite);
    });
    sprite.on('dragend', () => {
      if (!this.arrangeModeActive) return;
      const index = this.decorationSprites.indexOf(sprite);
      if (index !== -1) this.commitDecorationTransform(index, sprite);
    });
    return sprite;
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
    const committed = gameState.setDecorationTransform(
      index,
      Math.round(sprite.x),
      Math.round(sprite.y),
      sprite.scale,
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
   * clamping locally.
   */
  private scaleSelectedDecoration(delta: number): void {
    if (this.selectedDecorationIndex === null) return;
    const index = this.selectedDecorationIndex;
    const sprite = this.decorationSprites[index];
    const decoration = gameState.getState().decorations[index];
    if (sprite === undefined || decoration === undefined) return;
    const nextScale = Math.round((decoration.scale + delta) * 100) / 100;
    if (!gameState.setDecorationTransform(index, decoration.x, decoration.y, nextScale)) return;
    const updated = gameState.getState().decorations[index];
    if (updated === undefined) return;
    sprite.setScale(updated.scale);
    const shadow = this.decorationShadowSprites[index];
    if (shadow !== undefined) this.applyGroundShadowGeometry(shadow, sprite);
  }

  /**
   * Highlights the tapped decoration with a tint; clears the previous
   * selection's tint first - mirrors `setDressingSelection`. Also
   * re-derives the Store button's enabled/dim state (T3.9b), since that
   * button always acts on whatever is currently selected.
   */
  private setDecorationSelection(index: number | null): void {
    if (this.selectedDecorationIndex !== null) {
      this.decorationSprites[this.selectedDecorationIndex]?.clearTint();
    }
    this.selectedDecorationIndex = index;
    if (index !== null) {
      this.decorationSprites[index]?.setTint(DRESSING_SELECTED_TINT);
    }
    this.updateArrangeStoreButtonState();
  }

  /**
   * Build the floating control row once (T3.9a, extended to 5 buttons in
   * T3.9b): [Warehouse] [-] [+] [Store] [Done], hidden and inert until
   * `enterArrangeMode` shows them. Each is a `panel` nineslice sized
   * directly to its own display bounds, so its default interactive hit area
   * already covers that full rectangle - no custom hitArea needed.
   */
  private createArrangeControls(): void {
    this.arrangeDoneButton = this.add
      .nineslice(
        ARRANGE_DONE_X,
        ARRANGE_ROW_Y,
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
      .text(ARRANGE_DONE_X, ARRANGE_ROW_Y, 'Done', ARRANGE_BUTTON_STYLE)
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
        ARRANGE_ROW_Y,
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
      .text(ARRANGE_SCALE_DOWN_X, ARRANGE_ROW_Y, '-', ARRANGE_SCALE_BUTTON_STYLE)
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
        ARRANGE_ROW_Y,
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
      .text(ARRANGE_SCALE_UP_X, ARRANGE_ROW_Y, '+', ARRANGE_SCALE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangeScaleUpButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.scaleSelectedDecoration(DRESSING_SCALE_STEP);
    });

    this.arrangeWarehouseButton = this.add
      .nineslice(
        ARRANGE_WAREHOUSE_X,
        ARRANGE_ROW_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_WAREHOUSE_WIDTH,
        ARRANGE_ROW_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
    this.arrangeWarehouseText = this.add
      .text(ARRANGE_WAREHOUSE_X, ARRANGE_ROW_Y, 'Warehouse', ARRANGE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangeWarehouseButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.toggleWarehousePanel();
    });

    this.arrangeStoreButton = this.add
      .nineslice(
        ARRANGE_STORE_X,
        ARRANGE_ROW_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_STORE_WIDTH,
        ARRANGE_ROW_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setDepth(ARRANGE_UI_DEPTH)
      .setVisible(false);
    this.arrangeStoreText = this.add
      .text(ARRANGE_STORE_X, ARRANGE_ROW_Y, 'Store', ARRANGE_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(ARRANGE_UI_DEPTH + 1)
      .setVisible(false);
    this.arrangeStoreButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.storeSelectedDecoration();
    });

    this.createWarehousePanel();
  }

  /**
   * Show/hide + enable/disable the arrange-mode controls together, so a
   * hidden control is never still tappable. The Store button is EXCLUDED
   * from the blanket interactive toggle - `updateArrangeStoreButtonState`
   * owns its enabled/dim state (it must stay dim/disabled while shown
   * whenever nothing is selected), called right after this on both
   * `enterArrangeMode` and `exitArrangeMode`.
   */
  private setArrangeControlsVisible(visible: boolean): void {
    const controls: readonly [Phaser.GameObjects.NineSlice, Phaser.GameObjects.Text][] = [
      [this.arrangeDoneButton, this.arrangeDoneText],
      [this.arrangeScaleDownButton, this.arrangeScaleDownText],
      [this.arrangeScaleUpButton, this.arrangeScaleUpText],
      [this.arrangeWarehouseButton, this.arrangeWarehouseText],
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
  }

  /**
   * Store button (T3.9b): enabled only while a decoration is selected, dim
   * and inert otherwise - same enabled/dim convention as DecorShop's Buy
   * button. Called whenever the selection changes (`setDecorationSelection`)
   * and whenever the row's visibility changes (`enterArrangeMode`/
   * `exitArrangeMode`).
   */
  private updateArrangeStoreButtonState(): void {
    const enabled = this.selectedDecorationIndex !== null;
    this.arrangeStoreButton.setAlpha(
      enabled ? ARRANGE_STORE_ENABLED_ALPHA : ARRANGE_STORE_DISABLED_ALPHA,
    );
    if (enabled) {
      this.arrangeStoreButton.setInteractive({ useHandCursor: true });
    } else {
      this.arrangeStoreButton.disableInteractive();
    }
  }

  /**
   * Enter arrange mode (T3.9a): called by the Decor Shop's "Arrange Farm"
   * button (already closed by then). Makes every placed decoration
   * draggable + tap-selectable, hides the seed bar and shows the floating
   * control row in its band (T3.9b), and suppresses every other interactive
   * object in the scene (field gestures are gated separately, in
   * `handlePlotEntered`/`maybeShowCountdown` - mirrors `setDressingEditActive`
   * exactly, just player-facing.
   */
  private enterArrangeMode(): void {
    this.arrangeModeActive = true;
    this.selectedDecorationIndex = null;
    this.seedBar.setVisible(false);
    for (const sprite of this.decorationSprites) sprite.setInteractive({ draggable: true });
    this.setArrangeControlsVisible(true);
    this.updateArrangeStoreButtonState();
    this.setOtherHitboxesEnabled(
      false,
      this.arrangeExemptObjects(),
      this.arrangeModeDisabledObjects,
    );
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
    this.setDecorationSelection(null);
    for (const sprite of this.decorationSprites) sprite.disableInteractive();
    this.setArrangeControlsVisible(false);
    this.seedBar.setVisible(true);
    this.setOtherHitboxesEnabled(true, [], this.arrangeModeDisabledObjects);
    this.lastDecorationsJson = JSON.stringify(gameState.getState().decorations);
  }

  /** Objects `setOtherHitboxesEnabled` must never disable while arrange mode is active. */
  private arrangeExemptObjects(): Phaser.GameObjects.GameObject[] {
    return [
      ...this.decorationSprites,
      this.arrangeDoneButton,
      this.arrangeScaleDownButton,
      this.arrangeScaleUpButton,
      this.arrangeWarehouseButton,
      this.arrangeStoreButton,
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
    sprite.setInteractive({ draggable: true });
    this.decorationSprites.push(sprite);
    this.decorationShadowSprites.push(this.createGroundShadow(sprite));
    this.setDecorationSelection(index);
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
    // Swallow taps on the panel body so they never fall through to the backdrop beneath.
    bg.setInteractive();
    bg.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => event.stopPropagation(),
    );
    const title = this.add
      .text(0, WAREHOUSE_TITLE_Y, 'Warehouse', WAREHOUSE_TITLE_STYLE)
      .setOrigin(0.5);
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

    this.warehouseRows = DECOR_ITEMS.map((item, index) =>
      this.buildWarehouseRow(item.frame, item.name, index),
    );
  }

  /** One warehouse panel row: icon, name, "xN" count, a Place button - built once, hidden/shown per owned count. */
  private buildWarehouseRow(frame: string, name: string, index: number): WarehouseRow {
    const colX = WAREHOUSE_COLUMN_X[Math.floor(index / WAREHOUSE_ROWS_PER_COLUMN)]!;
    const y = WAREHOUSE_ROW_START_Y + (index % WAREHOUSE_ROWS_PER_COLUMN) * WAREHOUSE_ROW_SPACING;

    const icon = this.add
      .image(colX + WAREHOUSE_ICON_OFFSET_X, y, ATLAS_KEY, frame)
      .setScale(WAREHOUSE_ICON_SCALE)
      .setVisible(false);
    const nameText = this.add
      .text(colX + WAREHOUSE_NAME_OFFSET_X, y + WAREHOUSE_NAME_OFFSET_Y, name, WAREHOUSE_NAME_STYLE)
      .setOrigin(0, 0.5)
      .setVisible(false);
    const countText = this.add
      .text(
        colX + WAREHOUSE_COUNT_OFFSET_X,
        y + WAREHOUSE_COUNT_OFFSET_Y,
        '',
        WAREHOUSE_COUNT_STYLE,
      )
      .setOrigin(0, 0.5)
      .setVisible(false);

    const placeButton = this.add
      .nineslice(
        colX + WAREHOUSE_PLACE_BUTTON_OFFSET_X,
        y,
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
      .text(colX + WAREHOUSE_PLACE_BUTTON_OFFSET_X, y, 'Place', WAREHOUSE_PLACE_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    placeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      const newIndex = gameState.placeFromWarehouse(frame);
      if (newIndex === false) return;
      this.audio.sfx('tap');
      this.hideWarehousePanel();
      this.spawnPlacedDecorationSprite(newIndex);
    });

    this.warehouseContainer.add([icon, nameText, countText, placeButton, placeText]);
    return { frame, icon, nameText, countText, placeButton, placeText };
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
    this.warehouseCloseButton.setInteractive({ useHandCursor: true });
    setPanelOpen('decor-warehouse', true);
  }

  private hideWarehousePanel(): void {
    if (!this.warehousePanelVisible) return;
    this.warehousePanelVisible = false;
    this.warehouseContainer.setVisible(false);
    this.warehouseBackdropZone.setVisible(false).disableInteractive();
    this.warehouseCloseButton.disableInteractive();
    for (const row of this.warehouseRows) row.placeButton.disableInteractive();
    setPanelOpen('decor-warehouse', false);
  }

  /**
   * Re-derive every row's visibility/count/Place-button state from the
   * live warehouse (T3.9b): rows with nothing owned hide entirely (icon,
   * name, count, button - never a dangling interactive hitbox on an invisible
   * row), rows with any owned show with a truthful "xN" and an interactive
   * Place button. The empty-state text shows only when nothing is owned at
   * all.
   */
  private refreshWarehousePanel(): void {
    const warehouse = gameState.getState().warehouse;
    let anyOwned = false;
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
    this.noticeBoardImage.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.hud.toggleOrderBoard();
    });
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
   * current inventory, and onboarding has completed. The tutorial's own
   * scripted order (ONBOARDING_ORDER_A) becomes coverable mid-tutorial
   * (`deliver-sunwheat`) well before the player has been taught the board
   * exists, and its follow-up (ONBOARDING_ORDER_B) isn't coverable until the
   * player harvests the `plant-mixed` crops after the tutorial ends anyway -
   * gating on `onboarding.completed` suppresses the premature badge without
   * needing to special-case either scripted order.
   */
  private refreshNoticeBoardBadge(): void {
    const state = gameState.getState();
    const coverable =
      state.onboarding.completed &&
      state.orders.some(
        (slot) => slot.state === 'open' && isOrderCoverable(slot.order, state.inventory),
      );
    this.noticeBoardBadge.setVisible(coverable);
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
        this.input.enableDebug(object);
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
