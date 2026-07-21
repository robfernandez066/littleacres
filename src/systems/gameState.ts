import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  STRUCTURE_DEFAULT_ANCHORS,
  STRUCTURE_FOOTPRINT_OFFSETS,
  STRUCTURE_RENDER_OFFSETS,
  type StructureId,
} from '../config';
import { DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME } from '../data/audio';
import { BUILDINGS, type BuildingId, findBuilding, type MillingRecipe } from '../data/buildings';
import {
  CHEST_COINS_MAX,
  CHEST_COINS_MIN,
  CHEST_MOONDUST_AMOUNT,
  CHEST_MOONDUST_CHANCE,
} from '../data/chests';
import { CROPS, type CropId } from '../data/crops';
import {
  DECOR_FRAMES,
  DECOR_SCALE_MIN,
  DECOR_SIZING,
  decorClampBounds,
  DECOR_ITEMS,
  decorMaxScale,
  decorOwnedCount,
  decorSpawnScale,
  FENCE_FIXED_SCALE,
  FENCE_FRAME,
  fenceOwnedCount,
  MAX_DECOR_ITEMS,
  MAX_FENCES,
  WAREHOUSE_PLACE_X,
  WAREHOUSE_PLACE_Y,
} from '../data/decor';
import {
  BASE_PLOT_COUNT,
  EXPANDED_PLOT_COUNT,
  EXPANSION_COST,
  FARM_COLS,
  findRegion,
  PLOT_GRID_COORD_MAX,
  PLOT_GRID_COORD_MIN,
  PLOT_PLACEABLE_MAX_X,
  PLOT_PLACEABLE_MAX_Y,
  PLOT_PLACEABLE_MIN_X,
  PLOT_PLACEABLE_MIN_Y,
  plotEntitlementCap,
  type RegionRect,
  REGION_IDS,
  REGIONS,
} from '../data/farm';
import { GOODS, type GoodId } from '../data/goods';
import { levelForXp } from '../data/levels';
import {
  MOONDUST_PER_LEVEL,
  RADIANT_CHANCE,
  RADIANT_MOONDUST_CHANCE,
  RADIANT_YIELD_MULT,
} from '../data/moondust';
import { OFFLINE_SUMMARY_MIN_MS } from '../data/offline';
import { effectiveRadiantChance, RESTORE_FARMHOUSE_COST } from '../data/restoration';
import {
  ONBOARDING_ORDER_A,
  ONBOARDING_ORDER_B,
  ONBOARDING_STEPS,
  type OnboardingStep,
  type OnboardingStepId,
  type OnboardingUiEventId,
  REVIEW_ORDER_DWELL_MS,
} from '../data/onboarding';
import {
  generateOrder,
  type Order,
  ORDER_SLOTS,
  PREMIUM_CHANCE,
  SKIP_COOLDOWN_BASE_MS,
  SKIP_COOLDOWN_GROWTH,
  SKIP_COOLDOWN_MAX_MS,
  SKIP_STREAK_RESET_MS,
} from '../data/orders';
import {
  growthTargetForLevel,
  type LongQuestCounter,
  LONG_QUESTS,
  type WeeklyQuestDef,
  WEEKLY_QUESTS,
  WEEK_MS,
} from '../data/quests';
import { isReady } from './growth';
import { gridToIso, TILE_HEIGHT, TILE_WIDTH } from './iso';
import { now } from './time';

/**
 * Game state store: one serializable plain object (no classes, no Phaser
 * refs) persisted to localStorage with versioned migrations. Scenes render
 * from this state and never own it.
 */

/** localStorage key. Stable for the life of the project. */
export const SAVE_KEY = 'littleacres:save';

/** Last-known-good save, refreshed on every successful `load()` (T3.17). */
export const BACKUP_KEY = 'littleacres:save:backup';

/**
 * Stash for a SAVE_KEY string that failed to load (T3.17). Written BEFORE the
 * save is ever overwritten by recovery or reset, so an "invalid" save is
 * never destroyed - it stays retrievable for debugging or manual repair.
 */
export const RECOVERY_KEY = 'littleacres:save:recovery';

/** Autosave cadence. Wall-clock interval, never frame deltas. */
export const AUTOSAVE_INTERVAL_MS = 10_000;

/** Plot count of a fresh save. Kept as an alias of BASE_PLOT_COUNT since a
 * default state is always unexpanded; expanded saves have EXPANDED_PLOT_COUNT. */
export const PLOT_COUNT = BASE_PLOT_COUNT;

export interface EmptyPlot {
  state: 'empty';
  /** Explicit hidden-grid tile (T3.3a) in the frozen iso frame; any placeable
   * tile (T3.3a-r), so negative coordinates are legal and expected. */
  col: number;
  row: number;
}

export interface GrowingPlot {
  state: 'growing';
  cropId: CropId;
  /** Game-clock timestamp (see systems/time.ts) when the crop was planted. */
  plantedAt: number;
  /** Explicit hidden-grid tile (T3.3a) in the frozen iso frame; any placeable
   * tile (T3.3a-r), so negative coordinates are legal and expected. */
  col: number;
  row: number;
}

/**
 * Discriminated union over `state`. Only `empty` and `growing` are ever
 * stored - "ready" is derived from `plantedAt + growMs`, never saved, so
 * offline growth is free and cannot desync. Since v16 every plot carries its
 * own explicit `col`/`row` - positions never derive from the array index.
 */
export type PlotState = EmptyPlot | GrowingPlot;

export interface OpenOrderSlot {
  state: 'open';
  order: Order;
}

export interface CooldownOrderSlot {
  state: 'cooldown';
  /** Game-clock timestamp (see systems/time.ts) when a new order may appear. */
  readyAt: number;
}

/** Needs generation; `ensureOrders` fills it. The migration default. */
export interface PendingOrderSlot {
  state: 'pending';
}

/** Discriminated union over `state`, like `PlotState`. */
export type OrderSlot = OpenOrderSlot | CooldownOrderSlot | PendingOrderSlot;

/**
 * One placed decoration (T3.9): `frame` is a `DECOR_ITEMS`/`TROPHY_FRAMES`
 * atlas frame, `x`/`y` its screen position (design space), `scale` its
 * display scale. `FarmScene` renders these iso-sorted by `y`, like a crop or
 * structure.
 */
export interface DecorationPlacement {
  frame: string;
  x: number;
  y: number;
  scale: number;
  /** Horizontal mirror (T3.15) - flipX, never rotation. */
  flip: boolean;
}

/**
 * One movable structure's saved GRID ANCHOR TILE (T3.3s, schema v18), in the
 * frozen iso frame like a plot's col/row. The structure's blocked footprint
 * tiles are anchor + STRUCTURE_FOOTPRINT_OFFSETS[id] and its render position
 * is the anchor tile's center + STRUCTURE_RENDER_OFFSETS[id] (config.ts) -
 * never stored, always derived.
 */
export interface StructureAnchor {
  col: number;
  row: number;
}

/** The two movable structures' anchors (T3.3s). The expand sign stays fixed. */
export interface StructuresState {
  farmhouse: StructureAnchor;
  noticeBoard: StructureAnchor;
}

/**
 * One placed building (T4.1, schema v23): its type plus its saved GRID ANCHOR
 * TILE, exactly the StructureAnchor convention above - blocked footprint tiles
 * are anchor + BUILDINGS[type].footprintOffsets and the render position is the
 * anchor tile's center + BUILDINGS[type].renderOffset (data/buildings.ts),
 * never stored, always derived.
 *
 * Milling state (T4.2a) co-locates here as `batches`, so a building instance
 * stays ONE object.
 */
export interface BuildingPlacement {
  type: BuildingId;
  col: number;
  row: number;
  /**
   * In-flight production batches (T4.2a, schema v24), oldest first. Capped at
   * the building's `milling.slots`; a building with no milling recipe carries
   * an empty array forever.
   */
  batches: MillBatch[];
  /**
   * How many of the building's `milling.slots` the player has PAID FOR
   * (T4.2b-r1, schema v25). A building is born with 1 and buys the rest with
   * coins (`unlockMillSlot`); `startMilling` caps on this, not on the def's
   * slot count, so capacity is progression rather than a given. A building
   * with no recipe carries 1 and never uses it.
   */
  unlockedSlots: number;
}

/**
 * One in-flight production batch (T4.2a). Stores ONLY `startedAt` - readiness
 * is derived from `startedAt + recipe.batchMs` on every read, exactly like a
 * GrowingPlot derives ready from `plantedAt + growMs`. Nothing stores a
 * `readyAt` or a `ready` flag and nothing ticks a batch forward, which is what
 * makes offline milling free and impossible to desync.
 */
export interface MillBatch {
  /** Game-clock timestamp (see systems/time.ts) when the batch began. */
  startedAt: number;
}

/**
 * When `batch` finishes, DERIVED (T4.2a) - never stored. The single place the
 * store, the tests, and the future mill panel agree on batch timing.
 */
export function millBatchReadyAt(batch: MillBatch, recipe: MillingRecipe): number {
  return batch.startedAt + recipe.batchMs;
}

/**
 * Whether `batch` is collectible at `nowMs` (T4.2a). Callers pass the game
 * clock's `now()`, the same clock crops and orders read, so a warped dev clock
 * fast-forwards batches too.
 */
export function isMillBatchReady(batch: MillBatch, recipe: MillingRecipe, nowMs: number): boolean {
  return nowMs >= millBatchReadyAt(batch, recipe);
}

/**
 * One production slot's display state (T4.2b) - what `millSlots` hands the UI.
 * A slot is one of exactly four things, and each carries only what its
 * renderer needs: a milling slot its live countdown, a ready slot the
 * `batchIndex` to pass straight back to `collectMilling`, a locked slot the
 * coin price that would open it (T4.2b-r1).
 */
export type MillSlotView =
  | { kind: 'empty' }
  | { kind: 'milling'; remainingMs: number }
  | { kind: 'ready'; batchIndex: number }
  | { kind: 'locked'; cost: number };

/**
 * Every slot on `placement`, in slot order (T4.2b) - the ONE derivation the
 * mill panel and the field indicators both read, so neither restates a milling
 * rule. Slot i holds batch i (batches are stored oldest-first and never
 * sparse), and every index past the batch list is an empty slot.
 *
 * Slots at or past `placement.unlockedSlots` are LOCKED (T4.2b-r1), carrying
 * the coin cost that would open them. The list is still `recipe.slots` long
 * whatever is unlocked, so the panel draws the full mill and the player can
 * see what they are working toward. The field indicator ignores locked slots.
 *
 * Pure: takes the clock as `nowMs` (callers pass the game clock's `now()`, the
 * same clock the store's own readiness checks use) and mutates nothing, so the
 * panel can call it per tick and the tests can call it at any instant.
 */
export function millSlots(
  placement: BuildingPlacement,
  recipe: MillingRecipe,
  nowMs: number,
): MillSlotView[] {
  const views: MillSlotView[] = [];
  for (let index = 0; index < recipe.slots; index++) {
    if (index >= placement.unlockedSlots) {
      // Slot 2 (index 1) is priced by slotUnlockCosts[0] - the list prices the
      // slots PAST the first, so the index shifts down by one.
      views.push({ kind: 'locked', cost: recipe.slotUnlockCosts[index - 1] ?? 0 });
      continue;
    }
    const batch = placement.batches[index];
    if (batch === undefined) {
      views.push({ kind: 'empty' });
    } else if (isMillBatchReady(batch, recipe, nowMs)) {
      views.push({ kind: 'ready', batchIndex: index });
    } else {
      views.push({ kind: 'milling', remainingMs: millBatchReadyAt(batch, recipe) - nowMs });
    }
  }
  return views;
}

/**
 * Permanent restoration upgrades (T3.25, schema v20): 0 = the current look,
 * 1 = restored. One-way - nothing in the game sets a flag back to 0 (the dev
 * toggle aside). Purely cosmetic + perk state: it never affects a structure's
 * anchor, footprint, or movability.
 */
export interface RestorationState {
  farmhouse: 0 | 1;
}

export interface GameSettings {
  musicOn: boolean;
  sfxOn: boolean;
  /** Music channel volume, 0..1. */
  musicVolume: number;
  /** Sound-effects channel volume, 0..1. */
  sfxVolume: number;
  /** Vibration on/off (T3.12); gates `haptics.buzz`. */
  hapticsOn: boolean;
}

/**
 * First-session tutorial progress. `step` indexes ONBOARDING_STEPS and
 * `progress` counts matching actions within the current step (reset to 0 on
 * every advance). `progressB` is the second counter for the dual-goal
 * plant-mixed step (progress = sunwheat, progressB = starcorn); 0 everywhere
 * else. Once `completed` is true it never flips back.
 */
export interface OnboardingState {
  completed: boolean;
  step: number;
  progress: number;
  progressB: number;
}

/**
 * Everything the tutorial rails gate (see `GameStateStore.railsAllow`). The
 * first six mirror the store mutators; the last four are the UI queries
 * (SeedBar seed taps, the HUD's Orders/Bag buttons, and the farmhouse's Decor
 * Shop tap) so their gating shares the exact same rules instead of
 * duplicating them.
 */
export type RailsAction =
  | 'plant'
  | 'harvest'
  | 'sell'
  | 'fulfill'
  | 'skip'
  | 'expand'
  | 'select-seed'
  | 'orders-button'
  | 'bag-button'
  | 'decor-shop'
  | 'quest-claim'
  | 'quest-board';

/** One level gained, and any crops newly unlocked at exactly that level. */
export interface LevelUpEvent {
  level: number;
  unlockedCropIds: CropId[];
}

/** One Radiant harvest proc, for the scene's sparkle + floating-text juice. */
export interface RadiantEvent {
  plotIndex: number;
  cropId: CropId;
}

/**
 * One or more chests earned from a single premium fulfillment, for the
 * scene's ceremony (see `GameStateStore.fulfillOrder`/`consumeChestEvents`).
 * `contents` holds one entry per chest with its own individual roll
 * (T2.23b - was a single summed coins/moondust pair, so the ceremony could
 * show each chest's own loot rather than one blended total); already
 * granted to state (summed) by the time this is queued - the ceremony is
 * pure display/juice, like `LevelUpEvent`.
 */
export interface ChestEvent {
  contents: { coins: number; moondust: number }[];
}

/**
 * One weekly rollover's banked rewards, for the scene's notice panel (T3.19):
 * completed-but-unclaimed weeklies auto-grant at rotation (owner decision; no
 * inbox), and this event tells the player what was claimed for them plus
 * which two quests the new week drew. Queued only when at least one reward
 * was granted - a bare rotation stays silent. Already granted to state by the
 * time this is queued - the panel is pure display, like `ChestEvent`.
 */
export interface WeeklyNoticeEvent {
  granted: { name: string; chests: number; moondust: number }[];
  newQuestNames: [string, string];
}

/**
 * One successful `grantPlots` call (T3.3a), for the scene's PlotGrantPopup.
 * Queued AFTER the grant is already in state - the popup is pure display,
 * like `ChestEvent`. Transient - never saved; a grant whose popup is lost to
 * an app close still flashes the Edit Layout button on the next session,
 * since that flash derives live from `unplacedPlots`.
 */
export interface PlotGrantEvent {
  count: number;
}

/**
 * "While you were away" summary, computed once on `load()` from the gap
 * between `lastSavedAt` and the real clock. Transient - never saved, and
 * cleared by `reset`/`importSave` too, since neither represents a return
 * from a real session gap.
 */
export interface OfflineSummary {
  elapsedMs: number;
  readyCounts: Partial<Record<CropId, number>>;
}

/**
 * Skip-cooldown escalation streak (see `GameStateStore.skipOrder`). `count`
 * is consecutive skips since the streak last reset; `lastAt` is the
 * game-clock timestamp of the most recent skip, used to detect a gap longer
 * than `SKIP_STREAK_RESET_MS`.
 */
export interface OrderSkipsState {
  count: number;
  lastAt: number;
}

/** Lifetime (never-reset) quest counters, driving the LONG_QUESTS. */
export interface QuestsLifetimeState {
  harvestsByCrop: Partial<Record<CropId, number>>;
  totalHarvests: number;
  ordersFulfilled: number;
  premiumFulfilled: number;
  chestsOpened: number;
}

/**
 * The current weekly quest rotation's counters and claims. `anchor` is the
 * real-clock (`Date.now()`) timestamp the current week started;
 * `ensureWeeklyQuests` advances it once `Date.now() >= anchor + WEEK_MS`.
 * Counters and `claimed` reset on every rotation; `activeIds` and
 * `featuredCrop` redraw.
 */
export interface QuestsWeeklyState {
  anchor: number;
  /** Exactly 2 distinct WEEKLY_QUESTS ids, active for the current week. */
  activeIds: string[];
  /** This week's crop for weekly_specialist's per-crop target. */
  featuredCrop: CropId;
  /**
   * weekly_growth's target for the current week, snapshot from
   * `growthTargetForLevel(level)` when the week is drawn (T3.19). A snapshot
   * deliberately, never re-derived mid-week: leveling up must not raise the
   * target under a player's feet (un-completing a finished quest is
   * punishment).
   */
  growthTarget: number;
  growMinutes: number;
  featuredHarvests: number;
  orders: number;
  radiants: number;
  claimed: string[];
}

/** Quest system state (T3.10): lifetime long-quest progress plus the weekly rotation. */
export interface QuestsState {
  lifetime: QuestsLifetimeState;
  weekly: QuestsWeeklyState;
  /** LONG_QUESTS ids claimed so far - each claimable at most once, ever. */
  longClaimed: string[];
  /** Whether the board's first-open explainer (T3.14) has been dismissed. */
  introSeen: boolean;
}

/** `GameStateStore.questProgress`'s return shape. */
export interface QuestProgress {
  current: number;
  target: number;
  complete: boolean;
  claimed: boolean;
}

export interface GameStateData {
  /** Schema version. Bump only via the migration list. */
  version: number;
  coins: number;
  xp: number;
  level: number;
  plots: PlotState[];
  /**
   * Granted-but-unplaced plots (T3.3a): the "shed" count. `grantPlots` fills
   * it, `placePlot` drains it one plot at a time onto a chosen owned tile.
   * Grants are one-way - a placed plot can move but never returns here.
   */
  unplacedPlots: number;
  /**
   * Whether the one-time farm expansion has been purchased (T3.3a). No longer
   * geometry (T3.3a-r): it only gates the Expand sign's one-time 4-plot grant
   * (and, while false, the sign's own blocked footprint tiles). Before v16
   * this was derived from `plots.length === 16`, which stopped working once
   * granted plots wait in the shed instead of appearing instantly.
   */
  expanded: boolean;
  inventory: Partial<Record<CropId, number>>;
  seeds: Partial<Record<CropId, number>>;
  /**
   * Processed goods on hand (T4.0, schema v22). A SEPARATE map from
   * `inventory`, keyed by GoodId - never a widening of the crop maps, so the
   * crop economy stays entirely CropId-keyed as goods grow. Empty until a
   * producer exists (the flour mill lands next).
   */
  goods: Partial<Record<GoodId, number>>;
  /** Reserved currency slot; nothing earns or spends it yet. */
  moondust: number;
  /** The order board, always exactly ORDER_SLOTS entries. */
  orders: OrderSlot[];
  /** Skip-cooldown escalation streak (see `skipOrder`). */
  orderSkips: OrderSkipsState;
  /** Placed decorations (T3.9); purchasable placed+warehoused within the split budgets (MAX_DECOR_ITEMS / MAX_FENCES, T3.3a2), trophies exempt (T3.17). */
  decorations: DecorationPlacement[];
  /**
   * Owned-but-unplaced decorations (T3.9b): frame -> count. A purchase always
   * lands here first (`buyDecoration`); `placeFromWarehouse`/`storeDecoration`
   * move one unit between here and `decorations`. Keys are removed once their
   * count reaches 0, never left at 0 (see `placeFromWarehouse`).
   */
  warehouse: Record<string, number>;
  /** Movable structures' grid anchors (T3.3s, schema v18). */
  structures: StructuresState;
  /**
   * Placed buildings (T4.1, schema v23): the things the player BUYS and puts
   * on the farm, each one grid anchor plus its type. Its OWN collection, not a
   * widening of `structures` (a closed 2-member union of the fixed
   * farmhouse/notice board) and not `decorations` (free-form and non-blocking)
   * - a building blocks its footprint like a structure but is bought, owned in
   * variable numbers, and extensible one BUILDINGS entry at a time.
   *
   * Per-instance PROCESSING state lives on the placement itself (T4.2a's
   * `batches`), so a building instance is always one object.
   */
  buildings: BuildingPlacement[];
  /** Permanent restoration upgrades (T3.25, schema v20). */
  restoration: RestorationState;
  /**
   * Purchased regions (T3.3b, schema v19): ids from `REGIONS` (data/farm.ts),
   * no duplicates. Each entry adds its band to the placeable domain and raises
   * the plot entitlement cap by its `entitlementIncrease`. Empty on a fresh or
   * migrated save.
   */
  regionsUnlocked: string[];
  /**
   * Whether the one-time two-finger-pan hint (T3.3b) has been shown - shown
   * once after the first region purchase's grant popup closes, then never
   * again. Defaults false (fresh and migrated saves).
   */
  twoFingerHintShown: boolean;
  /**
   * Whether the player has ever opened the Goals menu (T3.30, schema v21).
   * A one-time "discovered the menu" flag: it clears the "!" badge and the
   * first-appearance pulse permanently on the first open and never re-arms.
   * Deliberately NOT a per-goal seen-set - a v1 simplification, so adding a
   * future goal does not re-badge the icon for everyone.
   */
  goalsSeen: boolean;
  /** Quest system state (T3.10). */
  quests: QuestsState;
  onboarding: OnboardingState;
  settings: GameSettings;
  createdAt: number;
  lastSavedAt: number;
}

/**
 * A migration takes a raw save object at version N and returns it at version
 * N+1. `MIGRATIONS[i]` migrates version i+1 to i+2, so the current schema
 * version is always `migrations.length + 1`. `rng` is the store's own
 * randomness source (only `v10ToV11` uses it, to draw the initial weekly
 * quest rotation); every other migration ignores the parameter.
 */
export type Migration = (
  raw: Record<string, unknown>,
  rng: () => number,
) => Record<string, unknown>;

/** v1 -> v2: adds the moondust currency slot, defaulted to 0. */
const v1ToV2: Migration = (raw) => ({ ...raw, moondust: 0 });

function createPendingOrderSlots(): OrderSlot[] {
  return Array.from({ length: ORDER_SLOTS }, (): OrderSlot => ({ state: 'pending' }));
}

/** Deep copy so later slot mutation can never touch a scripted config order. */
function cloneOrder(order: Order): Order {
  return { ...order, items: order.items.map((item) => ({ ...item })) };
}

/** v2 -> v3: adds the order board, all slots pending generation. */
const v2ToV3: Migration = (raw) => ({ ...raw, orders: createPendingOrderSlots() });

/**
 * v3 -> v4: adds onboarding. Anyone with any progress (level above 1 or any
 * xp) is a veteran and skips the tutorial permanently.
 */
const v3ToV4: Migration = (raw) => ({
  ...raw,
  onboarding: {
    completed:
      (typeof raw.level === 'number' && raw.level > 1) ||
      (typeof raw.xp === 'number' && raw.xp > 0),
    step: 0,
    progress: 0,
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * v4 -> v5: adds the plant-mixed step's second progress counter. A save
 * mid-tutorial keeps its step index; the step chain was redesigned in the
 * same schema bump, but only fresh first-session saves can be mid-chain and
 * validation still passes either way.
 */
const v4ToV5: Migration = (raw) => ({
  ...raw,
  onboarding: isRecord(raw.onboarding) ? { ...raw.onboarding, progressB: 0 } : raw.onboarding,
});

/**
 * v5 -> v6: adds the channel volume settings. Existing saves get the new
 * defaults too - the old fixed music level (0.35) was judged too loud, so
 * everyone lands on 0.2 rather than grandfathering it in.
 */
const v5ToV6: Migration = (raw) => ({
  ...raw,
  settings: isRecord(raw.settings)
    ? { ...raw.settings, musicVolume: DEFAULT_MUSIC_VOLUME, sfxVolume: DEFAULT_SFX_VOLUME }
    : raw.settings,
});

/** v6 -> v7: renames the 'carrot' crop id to 'starcorn' (see renameCropId). */
const v6ToV7: Migration = (raw) => renameCropId(raw, 'carrot', 'starcorn');

/**
 * v7 -> v8: the tutorial chain was redesigned (15 steps -> 10) alongside the
 * full-rails enforcement, so old mid-chain step indices are meaningless and
 * a diverged save could wedge against the rails. Any save parked mid-chain
 * (started but not finished) skips the tutorial permanently; a step-0 save
 * keeps its fresh tutorial, and everything else passes through untouched.
 */
const v7ToV8: Migration = (raw) => {
  const onboarding = raw.onboarding;
  if (
    isRecord(onboarding) &&
    onboarding.completed === false &&
    typeof onboarding.step === 'number' &&
    onboarding.step > 0
  ) {
    return { ...raw, onboarding: { ...onboarding, completed: true } };
  }
  return raw;
};

/**
 * Rename a crop id everywhere a save stores crop ids: inventory and seeds
 * keys, growing plots' cropId, and open order slots' item cropIds. Anything
 * with an unexpected shape is passed through untouched - validation after
 * the migration chain is the arbiter of bad saves, not the migration.
 */
function renameCropId(
  raw: Record<string, unknown>,
  from: string,
  to: string,
): Record<string, unknown> {
  const renameKey = (value: unknown): unknown => {
    if (!isRecord(value) || !(from in value)) return value;
    const { [from]: count, ...rest } = value;
    return { ...rest, [to]: count };
  };
  const renamePlot = (plot: unknown): unknown =>
    isRecord(plot) && plot.cropId === from ? { ...plot, cropId: to } : plot;
  const renameSlot = (slot: unknown): unknown => {
    if (!isRecord(slot) || slot.state !== 'open' || !isRecord(slot.order)) return slot;
    const order = slot.order;
    if (!Array.isArray(order.items)) return slot;
    const items = order.items.map((item: unknown) =>
      isRecord(item) && item.cropId === from ? { ...item, cropId: to } : item,
    );
    return { ...slot, order: { ...order, items } };
  };
  return {
    ...raw,
    inventory: renameKey(raw.inventory),
    seeds: renameKey(raw.seeds),
    plots: Array.isArray(raw.plots) ? raw.plots.map(renamePlot) : raw.plots,
    orders: Array.isArray(raw.orders) ? raw.orders.map(renameSlot) : raw.orders,
  };
}

/** v8 -> v9: adds the skip-cooldown escalation streak, zeroed for existing saves. */
const v8ToV9: Migration = (raw) => ({ ...raw, orderSkips: { count: 0, lastAt: 0 } });

/**
 * v9 -> v10: adds decorations (T3.9) and the warehouse (T3.9b, folded into
 * the same still-uncommitted schema bump), both empty for existing saves.
 */
const v9ToV10: Migration = (raw) => ({ ...raw, decorations: [], warehouse: {} });

/**
 * Draw 2 distinct WEEKLY_QUESTS ids for a fresh weekly rotation: "pick one,
 * then pick a second from the rest" (like `generateOrder`'s two-item draw),
 * so it is always exactly 2 rng calls and can never loop. Repeats across
 * different weeks are allowed - only the 2 ids within one week must differ.
 */
function drawWeeklyQuestIds(rng: () => number): [string, string] {
  const pool = WEEKLY_QUESTS.map((quest) => quest.id);
  const first = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
  const rest = pool.filter((id) => id !== first);
  const second = rest[Math.min(rest.length - 1, Math.floor(rng() * rest.length))]!;
  return [first, second];
}

/**
 * Draw this week's featured crop, uniform over the crops unlocked at
 * `maxLevel` (T3.19 - a locked crop would make an impossible Specialist
 * week). The default (no filter) exists only for `createDefaultWeeklyState`'s
 * v10ToV11 migration branch, which deliberately keeps the historical
 * unfiltered draw so old migration outputs stay stable.
 */
function drawFeaturedCrop(rng: () => number, maxLevel = Number.POSITIVE_INFINITY): CropId {
  const ids = (Object.keys(CROPS) as CropId[]).filter((id) => CROPS[id].unlockLevel <= maxLevel);
  return ids[Math.min(ids.length - 1, Math.floor(rng() * ids.length))]!;
}

/**
 * A fresh weekly rotation anchored at `anchor`, zeroed counters and claims.
 * With no `rng` (a brand-new fresh-install save, via `createDefaultState`),
 * starts on a fixed rotation (the pool's first 2 ids, the first crop) rather
 * than spending rng calls a new player has no game history to justify -
 * `ensureWeeklyQuests` draws for real the first time the week actually rolls
 * over. A migrated save (via `v10ToV11`) already represents real play, so it
 * draws immediately through the passed `rng` - deliberately UNfiltered by
 * level (see `drawFeaturedCrop`), so old migration outputs stay stable; a
 * migrated v10 save may keep a locked featured crop until its first real
 * rollover (accepted, self-heals). `level` (default 1) seeds the
 * level-scaled weekly_growth target snapshot (T3.19).
 */
function createDefaultWeeklyState(
  anchor: number,
  rng?: () => number,
  level = 1,
): QuestsWeeklyState {
  const [activeIds, featuredCrop]: [[string, string], CropId] =
    rng === undefined
      ? [[WEEKLY_QUESTS[0]!.id, WEEKLY_QUESTS[1]!.id], (Object.keys(CROPS) as CropId[])[0]!]
      : [drawWeeklyQuestIds(rng), drawFeaturedCrop(rng)];
  return {
    anchor,
    activeIds: [...activeIds],
    featuredCrop,
    growthTarget: growthTargetForLevel(level),
    growMinutes: 0,
    featuredHarvests: 0,
    orders: 0,
    radiants: 0,
    claimed: [],
  };
}

/** A fresh quest system state: zeroed lifetime counters, a fresh weekly rotation. */
function createDefaultQuestsState(anchor: number, rng?: () => number): QuestsState {
  return {
    lifetime: {
      harvestsByCrop: {},
      totalHarvests: 0,
      ordersFulfilled: 0,
      premiumFulfilled: 0,
      chestsOpened: 0,
    },
    weekly: createDefaultWeeklyState(anchor, rng),
    longClaimed: [],
    introSeen: false,
  };
}

/**
 * v10 -> v11: adds the quest system (T3.10) - zeroed lifetime counters and a
 * fresh weekly rotation anchored at Date.now() (real clock deliberately, not
 * `now()` - a warped/dev-overlay game clock must not skip a week on load),
 * drawn immediately via `rng` since a migrating save already represents real
 * play (unlike a brand-new fresh-install save - see `createDefaultWeeklyState`).
 */
const v10ToV11: Migration = (raw, rng) => ({
  ...raw,
  quests: createDefaultQuestsState(Date.now(), rng),
});

/** v11 -> v12: adds the vibration toggle (T3.12), defaulted on for existing saves. */
const v11ToV12: Migration = (raw) => ({
  ...raw,
  settings: isRecord(raw.settings) ? { ...raw.settings, hapticsOn: true } : raw.settings,
});

/**
 * v12 -> v13: adds the quest board's first-open explainer flag (T3.14),
 * defaulted false for existing saves - everyone sees the explainer once,
 * same as a fresh save.
 */
const v12ToV13: Migration = (raw) => ({
  ...raw,
  quests: isRecord(raw.quests) ? { ...raw.quests, introSeen: false } : raw.quests,
});

/**
 * v13 -> v14: adds decoration flip (T3.15, mirrored facing) - false (unmirrored)
 * on every existing placement, matching how they already render.
 */
const v13ToV14: Migration = (raw) => ({
  ...raw,
  decorations: Array.isArray(raw.decorations)
    ? raw.decorations.map((decoration) =>
        isRecord(decoration) ? { ...decoration, flip: false } : decoration,
      )
    : raw.decorations,
});

/**
 * v14 -> v15: stamps the level-scaled weekly_growth target snapshot (T3.19)
 * onto the existing weekly state, from the save's own level - existing saves
 * pick up their correct target immediately rather than waiting for the next
 * rotation. Defensive like other migrations: an unexpected shape passes
 * through untouched for validation to judge.
 */
const v14ToV15: Migration = (raw) => {
  if (!isRecord(raw.quests) || !isRecord(raw.quests.weekly)) return raw;
  const level = isFiniteNumber(raw.level) ? raw.level : 1;
  return {
    ...raw,
    quests: {
      ...raw.quests,
      weekly: { ...raw.quests.weekly, growthTarget: growthTargetForLevel(level) },
    },
  };
};

/**
 * v15 -> v16: placeable plots (T3.3a). Every plot gains the explicit col/row
 * the historical index formula rendered it at (index = row * FARM_COLS + col,
 * so col = i % FARM_COLS, row = floor(i / FARM_COLS)) - nobody's layout
 * changes shape; unexpanded saves keep rows 0-2 (now in the frozen 4-row
 * frame, a one-time whole-grid shift by the old-vs-new origin delta) and
 * expanded saves keep all 16 tiles. `unplacedPlots` starts at 0 (nothing was
 * ever in the shed before this schema) and `expanded` is derived from the
 * only signal old saves had: a 16-plot array.
 */
const v15ToV16: Migration = (raw) => ({
  ...raw,
  plots: Array.isArray(raw.plots)
    ? raw.plots.map((plot, i) =>
        isRecord(plot) ? { ...plot, col: i % FARM_COLS, row: Math.floor(i / FARM_COLS) } : plot,
      )
    : raw.plots,
  unplacedPlots: 0,
  expanded: Array.isArray(raw.plots) && raw.plots.length === EXPANDED_PLOT_COUNT,
});

/**
 * v16 -> v17: fence normalization + per-item sizing (T3.3a2). Every fence
 * placement's scale becomes exactly FENCE_FIXED_SCALE; every OTHER placement
 * with a DECOR_SIZING entry clamps DOWN to that entry's maxScale if above
 * it. Positions and flip are untouched, entries at or below their max pass
 * through unchanged, and frames without a table entry (including unknown
 * frames - validation is the arbiter of those) pass through untouched.
 */
const v16ToV17: Migration = (raw) => ({
  ...raw,
  decorations: Array.isArray(raw.decorations)
    ? raw.decorations.map((decoration) => {
        if (
          !isRecord(decoration) ||
          typeof decoration.frame !== 'string' ||
          !isFiniteNumber(decoration.scale)
        ) {
          return decoration;
        }
        if (decoration.frame === FENCE_FRAME) {
          return decoration.scale === FENCE_FIXED_SCALE
            ? decoration
            : { ...decoration, scale: FENCE_FIXED_SCALE };
        }
        const sizing = DECOR_SIZING[decoration.frame];
        return sizing !== undefined && decoration.scale > sizing.maxScale
          ? { ...decoration, scale: sizing.maxScale }
          : decoration;
      })
    : raw.decorations,
});

/** A fresh copy of the default structure anchors (T3.3s) - cloned so no save
 * ever aliases the shared config constant. */
function createDefaultStructures(): StructuresState {
  return {
    farmhouse: { ...STRUCTURE_DEFAULT_ANCHORS.farmhouse },
    noticeBoard: { ...STRUCTURE_DEFAULT_ANCHORS.noticeBoard },
  };
}

/**
 * v17 -> v18: movable structures (T3.3s). Every save gains
 * `structures` at the DEFAULT anchors - the exact tiles whose derived
 * footprints and render positions reproduce the pre-v18 hardcoded
 * blocked-tile sets and position constants, so an existing save renders
 * pixel-identical after migration (pinned by test).
 */
const v17ToV18: Migration = (raw) => ({ ...raw, structures: createDefaultStructures() });

/**
 * v18 -> v19: purchasable regions (T3.3b). Every save gains an empty
 * `regionsUnlocked` (no region owned yet) and `twoFingerHintShown: false`
 * (everyone still gets the one-time pan hint after their first region
 * purchase, same as a fresh save).
 */
const v18ToV19: Migration = (raw) => ({
  ...raw,
  regionsUnlocked: [],
  twoFingerHintShown: false,
});

/**
 * v19 -> v20: the Restoration Chapter (T3.25). EVERY existing save loads
 * un-restored, so nobody's farmhouse changes appearance until they buy the
 * upgrade themselves - the same default a fresh save gets.
 */
const v19ToV20: Migration = (raw) => ({ ...raw, restoration: { farmhouse: 0 } });

/**
 * v20 -> v21: the Goals hub (T3.30). Every existing save loads with
 * `goalsSeen: false`, exactly like a fresh one - the menu is new to veterans
 * too, so everybody gets the one-time discovery badge and pulse.
 */
const v20ToV21: Migration = (raw) => ({ ...raw, goalsSeen: false });

/**
 * v21 -> v22: the goods economy foundation (T4.0). Every existing save gains
 * an empty `goods` map, exactly like a fresh one - nothing produces a good
 * yet, so there is no legacy stock to reconstruct.
 */
const v21ToV22: Migration = (raw) => ({ ...raw, goods: {} });

/**
 * v22 -> v23: buildings (T4.1). Every existing save gains an empty `buildings`
 * list, exactly like a fresh one - nobody owns a building yet (the flour mill
 * is dev-only this task), so there is nothing to reconstruct and no existing
 * placement can be invalidated. `structures`, `decorations` and `plots` are
 * deliberately untouched: a building is a NEW collection alongside them, never
 * a reinterpretation of one.
 */
const v22ToV23: Migration = (raw) => ({ ...raw, buildings: [] });

/**
 * v23 -> v24: milling (T4.2a). Every EXISTING placement gains an empty
 * `batches` list - a dev-placed mill is already out there, so this maps the
 * list rather than assuming it is empty. Nothing was milling before this
 * version, so there is no in-flight batch to reconstruct.
 */
const v23ToV24: Migration = (raw) => ({
  ...raw,
  buildings: ((raw.buildings as BuildingPlacement[]) ?? []).map((b) => ({ ...b, batches: [] })),
});

/**
 * v24 -> v25: unlockable production slots (T4.2b-r1). Every EXISTING placement
 * gains `unlockedSlots: 1` - the same one-slot start a freshly bought building
 * gets, so a pre-v25 mill lands exactly where a new one would rather than
 * being grandfathered into a full three.
 *
 * ACCEPTED DATA LOSS (owner call): before this version every declared slot was
 * usable, so a v24 save can hold up to `slots` batches in flight, and a flat 1
 * strands all but the first behind a lock - paid for and uncollectable. The
 * mill is dev-only and pre-release, so the owner took the loss rather than
 * grandfather anyone into free capacity. Nothing crashes on such a save: the
 * extra batches stay in `batches` (the validator caps on the def's `slots`,
 * not on `unlockedSlots`) and become collectable again if the slot is bought.
 */
const v24ToV25: Migration = (raw) => ({
  ...raw,
  buildings: ((raw.buildings as BuildingPlacement[]) ?? []).map((b) => ({
    ...b,
    unlockedSlots: 1,
  })),
});

/** The real migration list. */
export const MIGRATIONS: readonly Migration[] = [
  v1ToV2,
  v2ToV3,
  v3ToV4,
  v4ToV5,
  v5ToV6,
  v6ToV7,
  v7ToV8,
  v8ToV9,
  v9ToV10,
  v10ToV11,
  v11ToV12,
  v12ToV13,
  v13ToV14,
  v14ToV15,
  v15ToV16,
  v16ToV17,
  v17ToV18,
  v18ToV19,
  v19ToV20,
  v20ToV21,
  v21ToV22,
  v22ToV23,
  v23ToV24,
  v24ToV25,
];

export function createDefaultState(version: number): GameStateData {
  const now = Date.now();
  return {
    version,
    coins: 50,
    xp: 0,
    level: 1,
    plots: Array.from({ length: PLOT_COUNT }, (_, i): PlotState => ({
      state: 'empty',
      col: i % FARM_COLS,
      row: Math.floor(i / FARM_COLS),
    })),
    unplacedPlots: 0,
    expanded: false,
    inventory: {},
    seeds: {},
    goods: {},
    moondust: 0,
    orders: createPendingOrderSlots(),
    orderSkips: { count: 0, lastAt: 0 },
    decorations: [],
    warehouse: {},
    structures: createDefaultStructures(),
    buildings: [],
    restoration: { farmhouse: 0 },
    regionsUnlocked: [],
    twoFingerHintShown: false,
    goalsSeen: false,
    quests: createDefaultQuestsState(now),
    onboarding: { completed: false, step: 0, progress: 0, progressB: 0 },
    settings: {
      musicOn: true,
      sfxOn: true,
      musicVolume: DEFAULT_MUSIC_VOLUME,
      sfxVolume: DEFAULT_SFX_VOLUME,
      hapticsOn: true,
    },
    createdAt: now,
    lastSavedAt: now,
  };
}

/** One hidden-grid tile coordinate (frozen iso frame - see systems/iso.ts). */
export interface PlotTileCoord {
  col: number;
  row: number;
}

/** Collision-set key for a tile. String, not `row * cols + col` arithmetic -
 * numeric keys collide once coordinates go negative (T3.3a-r). */
function plotTileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * Enumerate every hidden-grid tile whose diamond fits inside `rect`, in the
 * frozen iso frame. The scan range is the static validator bounds, which
 * enclose the whole (base UNION regions) placeable set with margin (pinned by
 * a test), so nothing is ever clipped at the scan edge.
 */
function computePlaceableTilesInRect(rect: RegionRect): PlotTileCoord[] {
  const tiles: PlotTileCoord[] = [];
  for (let row = PLOT_GRID_COORD_MIN; row <= PLOT_GRID_COORD_MAX; row++) {
    for (let col = PLOT_GRID_COORD_MIN; col <= PLOT_GRID_COORD_MAX; col++) {
      const { x, y } = gridToIso(col, row);
      if (
        x - TILE_WIDTH / 2 >= rect.minX &&
        x + TILE_WIDTH / 2 <= rect.maxX &&
        y - TILE_HEIGHT / 2 >= rect.minY &&
        y + TILE_HEIGHT / 2 <= rect.maxY
      ) {
        tiles.push({ col, row });
      }
    }
  }
  return tiles;
}

/**
 * Whether `a` and `b` are edge-adjacent along a shared full edge (T3.3b-r1):
 * identical y-range and touching east/west, or identical x-range and touching
 * north/south. Only such a pair has a combined bounding rectangle that covers
 * exactly their union and nothing more - so merging them is lossless.
 */
function areRectsEdgeAdjacent(a: RegionRect, b: RegionRect): boolean {
  const sameY = a.minY === b.minY && a.maxY === b.maxY;
  const sameX = a.minX === b.minX && a.maxX === b.maxX;
  return (
    (sameY && (a.maxX === b.minX || b.maxX === a.minX)) ||
    (sameX && (a.maxY === b.minY || b.maxY === a.minY))
  );
}

/**
 * Collapse edge-adjacent rects into their combined bounding rectangles
 * (T3.3b-r1). THE fix for the seam gap: `computePlaceableTilesInRect` admits a
 * tile only when its whole diamond fits inside ONE rect, so tiles straddling
 * the boundary between two touching rects (the base rect's east edge x=1240
 * and the East Meadow band's west edge, same y-range) fit neither and were
 * dropped - a dead column with no grid between the base area and the band.
 * Merging first makes the seam interior, so those tiles enumerate normally.
 * Repeats to a fixed point, so a future chain of bands (R2/R3 east of R1)
 * collapses all the way in one pass of the caller.
 */
function mergeEdgeAdjacentRects(rects: readonly RegionRect[]): RegionRect[] {
  const merged: RegionRect[] = rects.map((rect) => ({ ...rect }));
  for (let i = 0; i < merged.length; i++) {
    for (let j = i + 1; j < merged.length; j++) {
      if (!areRectsEdgeAdjacent(merged[i]!, merged[j]!)) continue;
      merged[i] = {
        minX: Math.min(merged[i]!.minX, merged[j]!.minX),
        maxX: Math.max(merged[i]!.maxX, merged[j]!.maxX),
        minY: Math.min(merged[i]!.minY, merged[j]!.minY),
        maxY: Math.max(merged[i]!.maxY, merged[j]!.maxY),
      };
      merged.splice(j, 1);
      // Restart the inner sweep: the grown rect may now touch a rect it did
      // not before (and one already passed over).
      j = i;
    }
  }
  return merged;
}

/** One resolved placeable domain: the tile list plus its "col,row" key set. */
interface PlaceableDomain {
  tiles: readonly PlotTileCoord[];
  keys: ReadonlySet<string>;
}

/** Static geometry - computed once at module load. */
const BASE_PLACEABLE_RECT: RegionRect = {
  minX: PLOT_PLACEABLE_MIN_X,
  maxX: PLOT_PLACEABLE_MAX_X,
  minY: PLOT_PLACEABLE_MIN_Y,
  maxY: PLOT_PLACEABLE_MAX_Y,
};
const BASE_PLACEABLE_TILES: readonly PlotTileCoord[] =
  computePlaceableTilesInRect(BASE_PLACEABLE_RECT);
const BASE_PLACEABLE_DOMAIN: PlaceableDomain = {
  tiles: BASE_PLACEABLE_TILES,
  keys: new Set(BASE_PLACEABLE_TILES.map((tile) => plotTileKey(tile.col, tile.row))),
};

/**
 * Memoized runtime placeable domains keyed by the canonical unlocked-region
 * list (T3.3b) - a fresh union per distinct unlocked set, built at most once.
 */
const RUNTIME_PLACEABLE_CACHE = new Map<string, PlaceableDomain>();

/**
 * THE runtime placeable domain (T3.3b): the base set UNION the bands of every
 * unlocked, KNOWN region, derived from `state.regionsUnlocked`. With no region
 * unlocked this is exactly the base domain. Coordinates include negative
 * col/row: tile (0, 0) is the legacy grid's top corner, not the scene's.
 *
 * T3.3b-r1: tiles are enumerated over the MERGED active area, not per raw
 * rect - see `mergeEdgeAdjacentRects` for why (the seam gap). Region
 * `placeableRect`s themselves are untouched; the dim overlay and
 * `decorClampBounds` still read the raw rects.
 */
function runtimePlaceableDomain(regionsUnlocked: readonly string[]): PlaceableDomain {
  // Canonical key: REGIONS order filtered to unlocked & known, so duplicates
  // and ordering in the save never split the cache.
  const unlockedKnown = REGIONS.filter((region) => regionsUnlocked.includes(region.id)).map(
    (region) => region.id,
  );
  if (unlockedKnown.length === 0) return BASE_PLACEABLE_DOMAIN;
  const cacheKey = unlockedKnown.join('|');
  const cached = RUNTIME_PLACEABLE_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;
  const rects = mergeEdgeAdjacentRects([
    BASE_PLACEABLE_RECT,
    ...unlockedKnown.map((id) => findRegion(id)!.placeableRect),
  ]);
  const tiles: PlotTileCoord[] = [];
  const keys = new Set<string>();
  for (const rect of rects) {
    for (const tile of computePlaceableTilesInRect(rect)) {
      const key = plotTileKey(tile.col, tile.row);
      if (!keys.has(key)) {
        keys.add(key);
        tiles.push(tile);
      }
    }
  }
  const domain: PlaceableDomain = { tiles, keys };
  RUNTIME_PLACEABLE_CACHE.set(cacheKey, domain);
  return domain;
}

/**
 * THE placement authority (T3.3a-r; region-aware since T3.3b): every
 * hidden-grid tile a plot may occupy given the unlocked regions - a scene-wide
 * set, deliberately independent of `expanded` (the legacy expansion is only a
 * 4-plot grant now, never geometry). With no argument, the base (no-region)
 * set. Whether a given tile is currently FREE (unoccupied, clear of structures
 * and decor) is `isPlotTileFree`'s business.
 */
export function placeablePlotTiles(
  regionsUnlocked: readonly string[] = [],
): readonly PlotTileCoord[] {
  return runtimePlaceableDomain(regionsUnlocked).tiles;
}

/**
 * Structure footprint tiles (T3.3a-r, made anchor-relative in T3.3s):
 * placeable tiles a plot may never sit on because a structure's art stands
 * there. Since schema v18 the farmhouse/notice board footprints derive
 * DYNAMICALLY from `state.structures` + STRUCTURE_FOOTPRINT_OFFSETS
 * (config.ts) - the historical hardcoded sets are exactly the offsets
 * applied at the default anchors (pinned by test). The offsets' original
 * derivation (unchanged): a tile is blocked when its diamond center lies
 * within the structure's measured footprint rect expanded by a quarter tile
 * (64, 32), i.e. the diamond overlaps the structure by more than a corner
 * graze. Tile centers in the frozen frame:
 * (540 + (col-row)*128, 768 + (col+row)*64).
 *
 * The villager needs no set: VILLAGER_POSITION (config.ts) is an off-screen
 * fly-to point (x 1240), not a standing structure.
 */
const STRUCTURE_IDS: readonly StructureId[] = ['farmhouse', 'noticeBoard'];

/**
 * Whether the design-space point (x, y) lies inside tile (col, row)'s
 * diamond (frozen frame): the Manhattan-normalized containment test - the
 * one rule shared by "decor anchors block plot placement" (isPlotTileFree)
 * and "decor may not commit onto a permanent object" (T3.3s-r1).
 */
function pointInTileDiamond(x: number, y: number, col: number, row: number): boolean {
  const center = gridToIso(col, row);
  return (
    Math.abs(x - center.x) / (TILE_WIDTH / 2) + Math.abs(y - center.y) / (TILE_HEIGHT / 2) <= 1
  );
}

/**
 * Which permanent-footprint owner a lookup belongs to (T4.1) - the two fixed
 * structures by id, a placed building by its index in `state.buildings`. Used
 * only to exempt an owner from its OWN footprint when asking whether it may
 * stand somewhere ("is this anchor free FOR me").
 */
export type FootprintOwnerRef =
  { kind: 'structure'; id: StructureId } | { kind: 'building'; index: number };

/** One permanent footprint: its anchor-relative offsets and its live anchor. */
interface FootprintOccupant {
  offsets: readonly PlotTileCoord[];
  anchor: { col: number; row: number };
}

/**
 * THE shared footprint enumeration (T4.1): every permanent blocking footprint
 * on the farm - both fixed structures at their live anchors AND every placed
 * building at its own - as (offsets, anchor) pairs, optionally with `self`
 * omitted.
 *
 * This is the ONE list `isUnderStructure`, `isPointOnPermanentFootprint`,
 * `isStructureAnchorFree` and `isBuildingAnchorFree` all walk, which is what
 * makes "a building blocks and is blocked exactly like a structure" true by
 * construction rather than by four functions each remembering to check
 * buildings. Adding a future footprint-owning collection means extending this
 * function, and nothing else.
 */
function permanentFootprints(
  state: Pick<GameStateData, 'structures' | 'buildings'>,
  self?: FootprintOwnerRef,
): FootprintOccupant[] {
  const occupants: FootprintOccupant[] = [];
  for (const id of STRUCTURE_IDS) {
    if (self?.kind === 'structure' && self.id === id) continue;
    occupants.push({ offsets: STRUCTURE_FOOTPRINT_OFFSETS[id], anchor: state.structures[id] });
  }
  for (let index = 0; index < state.buildings.length; index++) {
    if (self?.kind === 'building' && self.index === index) continue;
    const placement = state.buildings[index]!;
    occupants.push({
      offsets: BUILDINGS[placement.type].footprintOffsets,
      anchor: placement,
    });
  }
  return occupants;
}

/** `offsets` applied at `anchor` - the absolute tiles a footprint covers. */
function footprintTilesAt(
  offsets: readonly PlotTileCoord[],
  anchor: { col: number; row: number },
): PlotTileCoord[] {
  return offsets.map((offset) => ({
    col: anchor.col + offset.col,
    row: anchor.row + offset.row,
  }));
}

/**
 * Whether the design-space point (x, y) lands inside any PERMANENT object's
 * footprint tile diamond (T3.3s-r1, owner rule: nothing places on top of
 * permanent objects): the farmhouse and notice board footprints at their
 * CURRENT anchors, every placed building's at its own (T4.1), plus the expand
 * sign's while the save is not expanded. The gate `setDecorationTransform`
 * runs on a decoration's ground anchor.
 */
function isPointOnPermanentFootprint(
  state: Pick<GameStateData, 'structures' | 'buildings' | 'expanded'>,
  x: number,
  y: number,
): boolean {
  for (const occupant of permanentFootprints(state)) {
    for (const tile of footprintTilesAt(occupant.offsets, occupant.anchor)) {
      if (pointInTileDiamond(x, y, tile.col, tile.row)) return true;
    }
  }
  if (!state.expanded) {
    for (const tile of EXPAND_SIGN_BLOCKED_TILES) {
      if (pointInTileDiamond(x, y, tile.col, tile.row)) return true;
    }
  }
  return false;
}

/**
 * Whether (col, row) lies under any permanent structure's CURRENT footprint -
 * either fixed structure or, since T4.1, any placed BUILDING. The name is kept
 * (it is on the parse surface); "structure" reads as "permanent standing
 * object", which is exactly the set it now covers.
 */
function isUnderStructure(
  state: Pick<GameStateData, 'structures' | 'buildings'>,
  col: number,
  row: number,
): boolean {
  for (const occupant of permanentFootprints(state)) {
    for (const offset of occupant.offsets) {
      if (occupant.anchor.col + offset.col === col && occupant.anchor.row + offset.row === row) {
        return true;
      }
    }
  }
  return false;
}

/** Structure `id`'s absolute footprint tiles at `anchor` (T3.3s). */
export function structureFootprintTiles(id: StructureId, anchor: StructureAnchor): PlotTileCoord[] {
  return footprintTilesAt(STRUCTURE_FOOTPRINT_OFFSETS[id], anchor);
}

/** Building `type`'s absolute footprint tiles at `anchor` (T4.1) - the
 *  building twin of `structureFootprintTiles`, same shared helper underneath. */
export function buildingFootprintTiles(
  type: BuildingId,
  anchor: { col: number; row: number },
): PlotTileCoord[] {
  return footprintTilesAt(BUILDINGS[type].footprintOffsets, anchor);
}

/**
 * Building `type`'s GROUND point at `anchor` (T4.1) - the building twin of
 * `structureRenderPosition`: the anchor tile's center plus the building's
 * fixed render offset, base-anchored per the T3.27 convention.
 */
export function buildingRenderPosition(
  type: BuildingId,
  anchor: { col: number; row: number },
): { x: number; y: number } {
  const center = gridToIso(anchor.col, anchor.row);
  const offset = BUILDINGS[type].renderOffset;
  return { x: center.x + offset.x, y: center.y + offset.y };
}

/**
 * Structure `id`'s GROUND point at `anchor` (T3.3s; base-anchored since
 * T3.27): the anchor tile's center plus the structure's fixed render offset.
 * This is where the building's base meets the ground, and it is exactly where
 * the scene places the sprite - whose origin is its own base row, so the
 * building stands on this point and its roof (and the restored farmhouse's
 * moon) extend upward from it freely. At the default anchors this reproduces
 * FARMHOUSE_POSITION / NOTICE_BOARD_POSITION exactly (pinned by test).
 */
export function structureRenderPosition(
  id: StructureId,
  anchor: StructureAnchor,
): { x: number; y: number } {
  const center = gridToIso(anchor.col, anchor.row);
  const offset = STRUCTURE_RENDER_OFFSETS[id];
  return { x: center.x + offset.x, y: center.y + offset.y };
}

/**
 * THE structure-placement authority (T3.3s): whether structure `id` may
 * anchor at (col, row) - legal iff EVERY footprint tile at that anchor is
 * inside the placeable domain (the same hidden-grid tile set plots use),
 * free of plots, free of the OTHER structure's footprint, and - while the
 * save is NOT expanded - clear of the expand sign's footprint (T3.3s-r1, PM
 * ruling: a structure parked on the sign buries a tappable progression
 * object; the same pre-expansion gating plot placement already uses - once
 * expanded the sign is gone and those tiles are normal). Decor does not
 * block structures (free-form cosmetic). Both the store's `moveStructure`
 * and the scene's live drag-snap preview go through this one function, so
 * an illegal anchor can never even preview.
 */
export function isStructureAnchorFree(
  state: Pick<GameStateData, 'plots' | 'structures' | 'buildings' | 'expanded' | 'regionsUnlocked'>,
  id: StructureId,
  col: number,
  row: number,
): boolean {
  return isAnchorFree(state, STRUCTURE_FOOTPRINT_OFFSETS[id], col, row, {
    kind: 'structure',
    id,
  });
}

/**
 * THE building-placement authority (T4.1) - the building twin of
 * `isStructureAnchorFree`, over the SAME shared mechanism: legal iff every one
 * of `type`'s footprint tiles at (col, row) is inside the placeable domain,
 * free of plots, free of every OTHER permanent footprint (both structures and
 * every other building), and clear of the expand sign while it stands. Decor
 * does not block buildings, exactly as it does not block structures.
 *
 * `ignoreBuildingIndex` exempts one building from the collision check - a
 * building being MOVED must not be blocked by where it currently stands, the
 * same self-exemption `isStructureAnchorFree` gets implicitly and
 * `isPlotTileFree` takes as `ignorePlotIndex`.
 */
export function isBuildingAnchorFree(
  state: Pick<GameStateData, 'plots' | 'structures' | 'buildings' | 'expanded' | 'regionsUnlocked'>,
  type: BuildingId,
  col: number,
  row: number,
  ignoreBuildingIndex = -1,
): boolean {
  return isAnchorFree(
    state,
    BUILDINGS[type].footprintOffsets,
    col,
    row,
    ignoreBuildingIndex >= 0 ? { kind: 'building', index: ignoreBuildingIndex } : undefined,
  );
}

/**
 * The shared anchor-legality rule (T4.1) behind BOTH
 * `isStructureAnchorFree` and `isBuildingAnchorFree` - byte-for-byte the rules
 * T3.3s/T3.3s-r1 wrote for structures, generalized over an arbitrary footprint
 * and an arbitrary self-exemption so a building is not a special case of
 * anything. `self` is the owner asking (exempted from its own footprint);
 * omitted for a placement that owns no footprint yet.
 */
function isAnchorFree(
  state: Pick<GameStateData, 'plots' | 'structures' | 'buildings' | 'expanded' | 'regionsUnlocked'>,
  offsets: readonly PlotTileCoord[],
  col: number,
  row: number,
  self?: FootprintOwnerRef,
): boolean {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return false;
  const placeableKeys = runtimePlaceableDomain(state.regionsUnlocked).keys;
  const others = permanentFootprints(state, self);
  for (const offset of offsets) {
    const tileCol = col + offset.col;
    const tileRow = row + offset.row;
    if (!placeableKeys.has(plotTileKey(tileCol, tileRow))) return false;
    for (const plot of state.plots) {
      if (plot.col === tileCol && plot.row === tileRow) return false;
    }
    for (const occupant of others) {
      for (const otherOffset of occupant.offsets) {
        if (
          occupant.anchor.col + otherOffset.col === tileCol &&
          occupant.anchor.row + otherOffset.row === tileRow
        ) {
          return false;
        }
      }
    }
    if (!state.expanded && EXPAND_SIGN_BLOCKED_KEYS.has(plotTileKey(tileCol, tileRow))) {
      return false;
    }
  }
  return true;
}

/**
 * Expand sign, blocked only while it stands (`expanded` false - it hides
 * permanently once purchased): SIGN_X/Y (540, 1300) at 240x240 display
 * centered (ui/ExpandSign.ts) -> footprint rect x [420, 660], y [1180, 1420].
 * The sign is NOT movable (T3.3s) - this set stays hardcoded. While the sign
 * stands it blocks BOTH plot placement (isPlotTileFree) and structure
 * anchors (isStructureAnchorFree, T3.3s-r1).
 */
const EXPAND_SIGN_BLOCKED_TILES: readonly PlotTileCoord[] = [
  { col: 3, row: 3 },
  { col: 4, row: 3 },
  { col: 3, row: 4 },
  { col: 4, row: 4 },
  { col: 5, row: 4 },
  { col: 4, row: 5 },
  { col: 5, row: 5 },
];

const EXPAND_SIGN_BLOCKED_KEYS: ReadonlySet<string> = new Set(
  EXPAND_SIGN_BLOCKED_TILES.map((tile) => plotTileKey(tile.col, tile.row)),
);

/**
 * THE tile-collision authority (T3.3a-r): whether a plot may be placed on or
 * moved to (col, row) right now. A tile is free when it is placeable
 * (`placeablePlotTiles`), no OTHER plot occupies it (`ignorePlotIndex`
 * exempts the plot being moved), it is not under a structure footprint
 * (derived LIVE from `state.structures` since T3.3s, so moved structures'
 * footprints follow them; the Expand sign's only counts while the sign
 * still stands), and no
 * decoration's ground anchor (its x/y position) lies inside the tile's
 * diamond - decor stays free-form; this only stops plots from sliding under
 * existing decor (decor-over-plot stays the known nit). Every placement
 * decision - the store's `placePlot`/`movePlot` and the scene's drag snap
 * and free-tile searches - goes through this one function.
 */
export function isPlotTileFree(
  state: Pick<
    GameStateData,
    'plots' | 'decorations' | 'expanded' | 'structures' | 'buildings' | 'regionsUnlocked'
  >,
  col: number,
  row: number,
  ignorePlotIndex = -1,
): boolean {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return false;
  const key = plotTileKey(col, row);
  if (!runtimePlaceableDomain(state.regionsUnlocked).keys.has(key)) return false;
  for (let index = 0; index < state.plots.length; index++) {
    if (index === ignorePlotIndex) continue;
    const plot = state.plots[index]!;
    if (plot.col === col && plot.row === row) return false;
  }
  // T4.1: covers every placed BUILDING's footprint too, not just the two
  // fixed structures - one shared enumeration, see `permanentFootprints`.
  if (isUnderStructure(state, col, row)) return false;
  if (!state.expanded && EXPAND_SIGN_BLOCKED_KEYS.has(key)) return false;
  for (const decoration of state.decorations) {
    if (pointInTileDiamond(decoration.x, decoration.y, col, row)) return false;
  }
  return true;
}

/** The unit grid step from `a` to `b` - (0, +/-1) or (+/-1, 0) - or null for
 * any other displacement (diagonal, a jump, or no move at all). */
function unitStep(a: PlotTileCoord, b: PlotTileCoord): { dc: number; dr: number } | null {
  const dc = b.col - a.col;
  const dr = b.row - a.row;
  return Math.abs(dc) + Math.abs(dr) === 1 ? { dc, dr } : null;
}

/**
 * Whether (col, row) is edge-adjacent (shares a diamond edge - one of the
 * four grid neighbors) to any plot whose CURRENT tile is not in
 * `excludeKeys`. The exclude set carries the session's own placements
 * (T3.3a-r2f3), so "hugging" always means touching the pre-existing farm
 * block, never the strip being built right now.
 */
function isHuggingPlot(
  state: Pick<GameStateData, 'plots'>,
  col: number,
  row: number,
  excludeKeys?: ReadonlySet<string>,
): boolean {
  for (const plot of state.plots) {
    if (excludeKeys?.has(plotTileKey(plot.col, plot.row))) continue;
    if (Math.abs(plot.col - col) + Math.abs(plot.row - row) === 1) return true;
  }
  return false;
}

/**
 * The nearest free placeable tile to the design-space point (x, y)
 * (screen-space distance in the frozen frame), or null when every placeable
 * tile is blocked. With `hugExcludeKeys` given, EXACT distance ties break
 * toward a tile hugging the farm block (edge-adjacent to a plot outside the
 * exclude set; T3.3a-r2f3) - granted plots must never drift away from the
 * block when an equally near hugging tile exists. Remaining ties resolve to
 * enumeration order (row-major from the grid minimum) - stable, if
 * arbitrary. Distances are integer-coordinate sums of squares, so the
 * equality compare is exact.
 */
function nearestFreePlaceableTile(
  state: Pick<
    GameStateData,
    'plots' | 'decorations' | 'expanded' | 'structures' | 'buildings' | 'regionsUnlocked'
  >,
  x: number,
  y: number,
  hugExcludeKeys?: ReadonlySet<string>,
): PlotTileCoord | null {
  let best: PlotTileCoord | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  let bestHugs = false;
  for (const tile of runtimePlaceableDomain(state.regionsUnlocked).tiles) {
    if (!isPlotTileFree(state, tile.col, tile.row)) continue;
    const pos = gridToIso(tile.col, tile.row);
    const distSq = (pos.x - x) ** 2 + (pos.y - y) ** 2;
    const hugs =
      hugExcludeKeys !== undefined && isHuggingPlot(state, tile.col, tile.row, hugExcludeKeys);
    if (distSq < bestDistSq || (distSq === bestDistSq && hugs && !bestHugs)) {
      bestDistSq = distSq;
      best = tile;
      bestHugs = hugs;
    }
  }
  return best;
}

/**
 * Chain placement's next tile (T3.3a-r, direction-aware since T3.3a-r2f):
 * where the next granted plot spawns, given the session's committed
 * placements IN ORDER at their CURRENT tiles (the caller re-reads live
 * positions, so a player dragging a spawned plot re-aims the chain).
 *
 * - History >= 2 whose last step (B - A) is a unit grid step: continue the
 *   line (B + step) - the player drags to steer, and steering outranks
 *   hugging. If that is blocked, start the adjacent PARALLEL line: the
 *   fixed perpendicular (+1 col for a column run, +1 row for a row run)
 *   applied to the current straight run's FIRST tile. If that exact tile is
 *   blocked too, fall through to nearest-free - predictable, not clever.
 * - History of 1 (or a non-unit last step, e.g. after a long drag):
 *   hug-aware (T3.3a-r2f3) - among B's four free neighbors, prefer one
 *   edge-adjacent to a plot NOT placed this session, so the batch keeps
 *   hugging the farm block; ordering (and the no-hug remainder) stays
 *   (B.col, B.row + 1), then (B.col + 1, B.row).
 * - Fallback in all cases: the nearest free placeable tile to B (exact
 *   ties breaking toward a hugging tile); null when every placeable tile
 *   is blocked (or the history is empty).
 */
export function nextChainPlotTile(
  state: Pick<
    GameStateData,
    'plots' | 'decorations' | 'expanded' | 'structures' | 'buildings' | 'regionsUnlocked'
  >,
  history: readonly PlotTileCoord[],
): PlotTileCoord | null {
  const last = history[history.length - 1];
  if (last === undefined) return null;
  const sessionKeys: ReadonlySet<string> = new Set(
    history.map((tile) => plotTileKey(tile.col, tile.row)),
  );
  const prev = history[history.length - 2];
  const step = prev === undefined ? null : unitStep(prev, last);
  if (step !== null) {
    if (isPlotTileFree(state, last.col + step.dc, last.row + step.dr)) {
      return { col: last.col + step.dc, row: last.row + step.dr };
    }
    // The current straight run: the longest history suffix advancing by
    // this same step. A bend earlier in the session starts a new run.
    let runStartIndex = history.length - 2;
    while (runStartIndex > 0) {
      const earlier = unitStep(history[runStartIndex - 1]!, history[runStartIndex]!);
      if (earlier === null || earlier.dc !== step.dc || earlier.dr !== step.dr) break;
      runStartIndex--;
    }
    const runStart = history[runStartIndex]!;
    const parallel =
      step.dc === 0
        ? { col: runStart.col + 1, row: runStart.row }
        : { col: runStart.col, row: runStart.row + 1 };
    if (isPlotTileFree(state, parallel.col, parallel.row)) return parallel;
  } else {
    // Hug pass (T3.3a-r2f3): a free neighbor touching the pre-existing
    // block, in the fixed preference order (down, right, up, left).
    const neighbors: PlotTileCoord[] = [
      { col: last.col, row: last.row + 1 },
      { col: last.col + 1, row: last.row },
      { col: last.col, row: last.row - 1 },
      { col: last.col - 1, row: last.row },
    ];
    for (const neighbor of neighbors) {
      if (
        isPlotTileFree(state, neighbor.col, neighbor.row) &&
        isHuggingPlot(state, neighbor.col, neighbor.row, sessionKeys)
      ) {
        return neighbor;
      }
    }
    if (isPlotTileFree(state, last.col, last.row + 1)) return { col: last.col, row: last.row + 1 };
    if (isPlotTileFree(state, last.col + 1, last.row)) return { col: last.col + 1, row: last.row };
  }
  const origin = gridToIso(last.col, last.row);
  return nearestFreePlaceableTile(state, origin.x, origin.y, sessionKeys);
}

/**
 * Where a freshly granted batch's FIRST plot spawns (T3.3a-r2f3 design
 * correction, superseding r2f's away-from-farm run rule): granted plots
 * EXTEND the farm block like adding a row or column to the grid, hugging
 * its face. Over the existing plots' bounding box, the candidate face
 * strips in priority order are BOTTOM row (maxRow + 1, the owner's
 * preferred face - where the legacy expansion row used to appear;
 * T3.3a-r2f4), LEFT column (minCol - 1), RIGHT column (maxCol + 1), TOP
 * row (minRow - 1). A face
 * qualifies when its LEADING min(shedCount, faceLength) consecutive tiles
 * are free (`isPlotTileFree` - off-rect or blocked tiles disqualify), and
 * the batch starts at the face's first tile (the minRow end for columns,
 * the minCol end for rows). With no qualifying face: the free tile
 * edge-adjacent to any existing plot nearest the plots' center of mass,
 * then the plain nearest-free tile; null only when everything is blocked.
 * With ZERO existing plots (dev cases), the nearest free tile to the
 * design center, as before.
 */
export function bestBatchStartTile(
  state: Pick<
    GameStateData,
    'plots' | 'decorations' | 'expanded' | 'structures' | 'buildings' | 'regionsUnlocked'
  >,
  shedCount: number,
): PlotTileCoord | null {
  if (state.plots.length === 0) {
    return nearestFreePlaceableTile(state, DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
  }
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let sumX = 0;
  let sumY = 0;
  for (const plot of state.plots) {
    minCol = Math.min(minCol, plot.col);
    maxCol = Math.max(maxCol, plot.col);
    minRow = Math.min(minRow, plot.row);
    maxRow = Math.max(maxRow, plot.row);
    const pos = gridToIso(plot.col, plot.row);
    sumX += pos.x;
    sumY += pos.y;
  }
  const centerX = sumX / state.plots.length;
  const centerY = sumY / state.plots.length;
  const columnFace = (col: number): PlotTileCoord[] => {
    const tiles: PlotTileCoord[] = [];
    for (let row = minRow; row <= maxRow; row++) tiles.push({ col, row });
    return tiles;
  };
  const rowFace = (row: number): PlotTileCoord[] => {
    const tiles: PlotTileCoord[] = [];
    for (let col = minCol; col <= maxCol; col++) tiles.push({ col, row });
    return tiles;
  };
  const faces = [
    rowFace(maxRow + 1), // BOTTOM - the owner's preferred face (T3.3a-r2f4)
    columnFace(minCol - 1), // LEFT
    columnFace(maxCol + 1), // RIGHT
    rowFace(minRow - 1), // TOP
  ];
  for (const face of faces) {
    const leading = Math.min(Math.max(shedCount, 1), face.length);
    let leadingFree = true;
    for (let i = 0; i < leading; i++) {
      if (!isPlotTileFree(state, face[i]!.col, face[i]!.row)) {
        leadingFree = false;
        break;
      }
    }
    if (leadingFree) return face[0]!;
  }
  // No qualifying face: the nearest free tile still touching the block.
  let best: PlotTileCoord | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const tile of runtimePlaceableDomain(state.regionsUnlocked).tiles) {
    if (!isPlotTileFree(state, tile.col, tile.row)) continue;
    if (!isHuggingPlot(state, tile.col, tile.row)) continue;
    const pos = gridToIso(tile.col, tile.row);
    const distSq = (pos.x - centerX) ** 2 + (pos.y - centerY) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = tile;
    }
  }
  return best ?? nearestFreePlaceableTile(state, centerX, centerY);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** An integer plot grid coordinate within the static validator bounds
 * (T3.3a-r, data/farm.ts) - negative coordinates are legal. */
function isPlotGridCoord(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= PLOT_GRID_COORD_MIN &&
    value <= PLOT_GRID_COORD_MAX
  );
}

/** A channel volume: a finite number within 0..1. */
function isVolume(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isPlotState(value: unknown): value is PlotState {
  if (!isRecord(value)) return false;
  // Explicit tile (T3.3a): integers within the static validator bounds
  // (T3.3a-r - wider than the placeable set, negative coords included).
  if (!isPlotGridCoord(value.col) || !isPlotGridCoord(value.row)) return false;
  if (value.state === 'empty') return true;
  return (
    value.state === 'growing' &&
    typeof value.cropId === 'string' &&
    value.cropId in CROPS &&
    isFiniteNumber(value.plantedAt)
  );
}

/** No two plots on one tile (T3.3a). Entries must already be shape-proven.
 * String keys (T3.3a-r): the old `row * FARM_COLS + col` arithmetic collides
 * once coordinates go negative or past the legacy grid width. */
function plotsTilesDistinct(plots: readonly PlotState[]): boolean {
  const seen = new Set<string>();
  for (const plot of plots) {
    const key = plotTileKey(plot.col, plot.row);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Crop-keyed count map, e.g. inventory and seeds. */
function isCropCountMap(value: unknown): value is Partial<Record<CropId, number>> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, count]) => key in CROPS && isFiniteNumber(count))
  );
}

/** Good-keyed count map (T4.0), e.g. `goods`. Never mixed with the crop maps. */
function isGoodCountMap(value: unknown): value is Partial<Record<GoodId, number>> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, count]) => key in GOODS && isFiniteNumber(count))
  );
}

function isOrderItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.cropId === 'string' &&
    value.cropId in CROPS &&
    isFiniteNumber(value.count)
  );
}

/**
 * A premium marker: a positive finite moondust amount and a string flavor
 * line, plus an optional `chests` count (T2.23a) - a positive integer when
 * present, absent on older saved premium orders (generated below
 * CHEST_UNLOCK_LEVEL, or before this field existed) - both are valid.
 */
function isOrderPremium(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.moondust) &&
    value.moondust > 0 &&
    typeof value.flavor === 'string' &&
    (value.chests === undefined ||
      (isFiniteNumber(value.chests) && Number.isInteger(value.chests) && value.chests > 0))
  );
}

function isOrder(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.length >= 1 &&
    value.items.length <= 2 &&
    value.items.every(isOrderItem) &&
    isFiniteNumber(value.coinReward) &&
    isFiniteNumber(value.xpReward) &&
    (value.premium === undefined || isOrderPremium(value.premium))
  );
}

function isOrderSlot(value: unknown): value is OrderSlot {
  if (!isRecord(value)) return false;
  if (value.state === 'pending') return true;
  if (value.state === 'cooldown') return isFiniteNumber(value.readyAt);
  return value.state === 'open' && isOrder(value.order);
}

function isOrderSkipsState(value: unknown): value is OrderSkipsState {
  return isRecord(value) && isFiniteNumber(value.count) && isFiniteNumber(value.lastAt);
}

function isDecorationPlacement(value: unknown): value is DecorationPlacement {
  return (
    isRecord(value) &&
    typeof value.frame === 'string' &&
    DECOR_FRAMES.has(value.frame) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.scale) &&
    typeof value.flip === 'boolean'
  );
}

/**
 * The warehouse record (T3.9b): every key a known decor/trophy frame, every
 * value a positive integer count. An empty record is valid (nothing stored).
 */
function isWarehouseRecord(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([frame, count]) =>
        DECOR_FRAMES.has(frame) && isFiniteNumber(count) && Number.isInteger(count) && count > 0,
    )
  );
}

const LONG_QUEST_IDS: ReadonlySet<string> = new Set(LONG_QUESTS.map((quest) => quest.id));
const WEEKLY_QUEST_IDS: ReadonlySet<string> = new Set(WEEKLY_QUESTS.map((quest) => quest.id));

function isQuestsLifetimeState(value: unknown): value is QuestsLifetimeState {
  return (
    isRecord(value) &&
    isCropCountMap(value.harvestsByCrop) &&
    isFiniteNumber(value.totalHarvests) &&
    isFiniteNumber(value.ordersFulfilled) &&
    isFiniteNumber(value.premiumFulfilled) &&
    isFiniteNumber(value.chestsOpened)
  );
}

function isQuestsWeeklyState(value: unknown): value is QuestsWeeklyState {
  return (
    isRecord(value) &&
    isFiniteNumber(value.anchor) &&
    Array.isArray(value.activeIds) &&
    value.activeIds.length === 2 &&
    value.activeIds.every((id) => typeof id === 'string' && WEEKLY_QUEST_IDS.has(id)) &&
    typeof value.featuredCrop === 'string' &&
    value.featuredCrop in CROPS &&
    isFiniteNumber(value.growthTarget) &&
    isFiniteNumber(value.growMinutes) &&
    isFiniteNumber(value.featuredHarvests) &&
    isFiniteNumber(value.orders) &&
    isFiniteNumber(value.radiants) &&
    Array.isArray(value.claimed) &&
    value.claimed.every((id) => typeof id === 'string' && WEEKLY_QUEST_IDS.has(id))
  );
}

function isQuestsState(value: unknown): value is QuestsState {
  return (
    isRecord(value) &&
    isQuestsLifetimeState(value.lifetime) &&
    isQuestsWeeklyState(value.weekly) &&
    Array.isArray(value.longClaimed) &&
    value.longClaimed.every((id) => typeof id === 'string' && LONG_QUEST_IDS.has(id)) &&
    typeof value.introSeen === 'boolean'
  );
}

/** A structure anchor: integer col/row within the static validator bounds,
 * like a plot's tile (T3.3s). */
function isStructureAnchor(value: unknown): value is StructureAnchor {
  return isRecord(value) && isPlotGridCoord(value.col) && isPlotGridCoord(value.row);
}

function isStructuresState(value: unknown): value is StructuresState {
  return (
    isRecord(value) && isStructureAnchor(value.farmhouse) && isStructureAnchor(value.noticeBoard)
  );
}

/**
 * One placed building (T4.1): a KNOWN `BUILDINGS` type plus an integer col/row
 * within the static validator bounds - the same coordinate rule a plot tile
 * and a structure anchor obey. An unknown type is rejected rather than
 * ignored: unlike a stray `regionsUnlocked` id (inert), a building renders and
 * blocks tiles, so a save naming a type this build cannot draw is not a save
 * this build can honour.
 */
function isBuildingPlacement(value: unknown): value is BuildingPlacement {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !isPlotGridCoord(value.col) ||
    !isPlotGridCoord(value.row)
  ) {
    return false;
  }
  const building = findBuilding(value.type);
  if (building === undefined) return false;
  // Batches are capped by the building's OWN slot count (T4.2a) - a save
  // claiming more concurrent batches than the def allows is a save this build
  // cannot honour, exactly like an unknown type. A building with no milling
  // recipe allows zero, so its list must be empty.
  // Unlocked slots (T4.2b-r1) are bounded by the def the same way: at least
  // the one every building is born with, never more than it declares. A
  // recipe-less building carries exactly 1 (it has no slots to open).
  if (
    !Number.isInteger(value.unlockedSlots) ||
    (value.unlockedSlots as number) < 1 ||
    (value.unlockedSlots as number) > (building.milling?.slots ?? 1)
  ) {
    return false;
  }
  return (
    Array.isArray(value.batches) &&
    value.batches.length <= (building.milling?.slots ?? 0) &&
    value.batches.every(isMillBatch)
  );
}

/** One in-flight batch (T4.2a): a finite `startedAt` and nothing else stored. */
function isMillBatch(value: unknown): value is MillBatch {
  return isRecord(value) && isFiniteNumber(value.startedAt);
}

/**
 * `regionsUnlocked` (T3.3b): an array of KNOWN region ids (REGION_IDS), no
 * duplicates. An empty array is valid (nothing purchased).
 */
function isRegionsUnlocked(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== 'string' || !REGION_IDS.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * `restoration` (T3.25): every flag is exactly 0 or 1 - no other number, and
 * no missing key (the v19 -> v20 migration always supplies one).
 */
function isRestorationState(value: unknown): value is RestorationState {
  return isRecord(value) && (value.farmhouse === 0 || value.farmhouse === 1);
}

function isOnboardingState(value: unknown): value is OnboardingState {
  return (
    isRecord(value) &&
    typeof value.completed === 'boolean' &&
    isFiniteNumber(value.step) &&
    isFiniteNumber(value.progress) &&
    isFiniteNumber(value.progressB)
  );
}

/** Structural validation of a (migrated) save against the current schema. */
export function isValidState(raw: unknown, expectedVersion: number): raw is GameStateData {
  if (!isRecord(raw)) return false;
  return (
    raw.version === expectedVersion &&
    isFiniteNumber(raw.coins) &&
    isFiniteNumber(raw.xp) &&
    isFiniteNumber(raw.level) &&
    Array.isArray(raw.plots) &&
    raw.plots.every(isPlotState) &&
    // Entries are shape-proven above, so their col/row are safe to read here.
    plotsTilesDistinct(raw.plots as PlotState[]) &&
    isFiniteNumber(raw.unplacedPlots) &&
    Number.isInteger(raw.unplacedPlots) &&
    raw.unplacedPlots >= 0 &&
    typeof raw.expanded === 'boolean' &&
    isRegionsUnlocked(raw.regionsUnlocked) &&
    typeof raw.twoFingerHintShown === 'boolean' &&
    typeof raw.goalsSeen === 'boolean' &&
    // Total plot entitlement (placed + shed): at least the base grant, at
    // most the region-aware cap (T3.3b - EXPANDED_PLOT_COUNT plus every
    // unlocked region's entitlementIncrease; regionsUnlocked proven above).
    raw.plots.length + raw.unplacedPlots >= BASE_PLOT_COUNT &&
    raw.plots.length + raw.unplacedPlots <= plotEntitlementCap(raw.regionsUnlocked) &&
    isCropCountMap(raw.inventory) &&
    isCropCountMap(raw.seeds) &&
    isGoodCountMap(raw.goods) &&
    isFiniteNumber(raw.moondust) &&
    Array.isArray(raw.orders) &&
    raw.orders.length === ORDER_SLOTS &&
    raw.orders.every(isOrderSlot) &&
    isOrderSkipsState(raw.orderSkips) &&
    isWarehouseRecord(raw.warehouse) &&
    Array.isArray(raw.decorations) &&
    raw.decorations.every(isDecorationPlacement) &&
    // Entries are shape-proven above, so their frames are safe to read here.
    // Purchasable only - trophy frames are exempt from both budgets (T3.17).
    // Split budgets (T3.3a2): non-fence decor and fences cap independently.
    decorOwnedCount(raw.decorations, raw.warehouse) <= MAX_DECOR_ITEMS &&
    fenceOwnedCount(raw.decorations, raw.warehouse) <= MAX_FENCES &&
    isStructuresState(raw.structures) &&
    Array.isArray(raw.buildings) &&
    raw.buildings.every(isBuildingPlacement) &&
    isRestorationState(raw.restoration) &&
    isQuestsState(raw.quests) &&
    isOnboardingState(raw.onboarding) &&
    isRecord(raw.settings) &&
    typeof raw.settings.musicOn === 'boolean' &&
    typeof raw.settings.sfxOn === 'boolean' &&
    isVolume(raw.settings.musicVolume) &&
    isVolume(raw.settings.sfxVolume) &&
    typeof raw.settings.hapticsOn === 'boolean' &&
    isFiniteNumber(raw.createdAt) &&
    isFiniteNumber(raw.lastSavedAt)
  );
}

/** The subset of the Storage API the store needs; injectable for tests. */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage if reachable; null in privacy modes or non-browser contexts. */
function defaultStorage(): SaveStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface GameStateStoreOptions {
  /** Storage backend. Defaults to localStorage; pass null for none. */
  storage?: SaveStorage | null;
  /** Migration list override, for tests. Defaults to MIGRATIONS. */
  migrations?: readonly Migration[];
  /** Randomness source for order generation; injectable for tests. */
  rng?: () => number;
}

export class GameStateStore {
  private state: GameStateData;
  private readonly storage: SaveStorage | null;
  private readonly migrations: readonly Migration[];
  private readonly rng: () => number;
  private autosaveTimer: number | null = null;
  /** Pending level-ups for the scene to celebrate. Transient - never saved. */
  private levelUpQueue: LevelUpEvent[] = [];
  /** Pending Radiant harvest procs for the scene to celebrate. Transient - never saved. */
  private radiantQueue: RadiantEvent[] = [];
  /** Pending chest ceremonies for the scene to celebrate. Transient - never saved. */
  private chestQueue: ChestEvent[] = [];
  /** Pending weekly rollover notices (T3.19) for the scene's panel. Transient - never saved. */
  private weeklyNoticeQueue: WeeklyNoticeEvent[] = [];
  /** Pending plot grants (T3.3a) for the scene's PlotGrantPopup. Transient - never saved. */
  private plotGrantQueue: PlotGrantEvent[] = [];
  /**
   * One-shot flag for the tutorial-complete celebration. Transient - never
   * saved, and set ONLY by chain completion in `advanceOnboardingStep`, so
   * migrations, loads, imports, and dev paths that arrive already-completed
   * never fire it. Lost if the app closes before the scene drains it -
   * accepted, same philosophy as level-up events on import.
   */
  private tutorialCompletePending = false;
  /** Pending "while you were away" summary from the last `load()`. Transient - never saved. */
  private offlineSummary: OfflineSummary | null = null;
  /**
   * Real-clock moment the app last went to the background (T3.20a),
   * in-memory only, never saved or touched by `load()`/`reset()`/
   * `importSave()` - it belongs to the visibility lifecycle, not the save
   * lifecycle. Null until the first `handleBackgrounded()`, and cleared
   * again once `handleForegroundReturn()` consumes it, so a second
   * foreground event with no intervening backgrounding measures nothing.
   */
  private hiddenAt: number | null = null;
  /**
   * Game-clock timestamp when the active onboarding step became active.
   * Drives the `review-order` read-dwell in `autoAdvanceOnboarding`.
   * Deliberately in-memory only, not part of `GameStateData` - a reload
   * mid-review just restarts the read, which is fine.
   */
  private stepEnteredAt = 0;

  constructor(options: GameStateStoreOptions = {}) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.migrations = options.migrations ?? MIGRATIONS;
    this.rng = options.rng ?? Math.random;
    this.state = createDefaultState(this.currentVersion);
    this.stepEnteredAt = now();
  }

  /** Current schema version, derived from the migration list. */
  get currentVersion(): number {
    return this.migrations.length + 1;
  }

  getState(): Readonly<GameStateData> {
    return this.state;
  }

  addCoins(amount: number): void {
    this.state.coins += amount;
  }

  addXp(amount: number): void {
    this.applyXp(amount);
  }

  /** Grant moondust directly (dev tooling, T3.3a-r2z) - the same bare
   *  balance bump the real grant paths apply (quest rewards, premium
   *  orders, chests all do `state.moondust += n`); mirrors `addCoins`. */
  addMoondust(amount: number): void {
    this.state.moondust += amount;
  }

  /** Set the player level directly (dev tooling). Clamped to a minimum of 1. */
  setLevel(level: number): void {
    this.state.level = Math.max(1, Math.floor(level));
  }

  /** Persist the music on/off setting. */
  setMusicOn(on: boolean): void {
    this.state.settings.musicOn = on;
    this.save();
  }

  /** Persist the sound-effects on/off setting. */
  setSfxOn(on: boolean): void {
    this.state.settings.sfxOn = on;
    this.save();
  }

  /** Persist the vibration on/off setting. */
  setHapticsOn(on: boolean): void {
    this.state.settings.hapticsOn = on;
    this.save();
  }

  /** Persist the music channel volume, clamped to 0..1. Non-finite input is ignored. */
  setMusicVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.state.settings.musicVolume = Math.min(1, Math.max(0, volume));
    this.save();
  }

  /** Persist the sfx channel volume, clamped to 0..1. Non-finite input is ignored. */
  setSfxVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.state.settings.sfxVolume = Math.min(1, Math.max(0, volume));
    this.save();
  }

  /**
   * Apply an xp delta and raise the level to match, queuing one
   * `LevelUpEvent` per level gained, in order. Level only ever increases
   * here: if xp implies a level at or below the current one (e.g. after a
   * `setLevel` jump-ahead), nothing changes and no event is queued.
   */
  private applyXp(amount: number): void {
    this.state.xp += amount;
    const newLevel = levelForXp(this.state.xp);
    for (let level = this.state.level + 1; level <= newLevel; level++) {
      const unlockedCropIds = Object.values(CROPS)
        .filter((crop) => crop.unlockLevel === level)
        .map((crop) => crop.id);
      this.levelUpQueue.push({ level, unlockedCropIds });
      this.state.moondust += MOONDUST_PER_LEVEL;
    }
    if (newLevel > this.state.level) this.state.level = newLevel;
  }

  /**
   * Reconcile level to whatever xp implies, without queuing events - used
   * after load/import so a save whose xp implies a higher level than it
   * stores doesn't spam celebrations. Level only ever rises here too.
   */
  private reconcileLevelSilently(): void {
    const implied = levelForXp(this.state.xp);
    if (implied > this.state.level) this.state.level = implied;
  }

  /** Drain and return queued level-up events; the scene polls this on its refresh tick. */
  consumeLevelUpEvents(): LevelUpEvent[] {
    const events = this.levelUpQueue;
    this.levelUpQueue = [];
    return events;
  }

  /** Drain and return queued Radiant harvest events; the scene polls this on its refresh tick. */
  consumeRadiantEvents(): RadiantEvent[] {
    const events = this.radiantQueue;
    this.radiantQueue = [];
    return events;
  }

  /**
   * Drain and return queued chest events; the scene polls this on its
   * refresh tick, deferred while a level-up celebration is active (see
   * FarmScene) so the two ceremonies never fight for the screen.
   */
  consumeChestEvents(): ChestEvent[] {
    const events = this.chestQueue;
    this.chestQueue = [];
    return events;
  }

  /**
   * Drain and return queued weekly rollover notices (T3.19); the scene polls
   * this on its refresh tick, deferred behind the offline summary and
   * celebrations (see FarmScene) - rewards are already granted by then, only
   * the show waits, same philosophy as `consumeChestEvents`.
   */
  consumeWeeklyNotices(): WeeklyNoticeEvent[] {
    const events = this.weeklyNoticeQueue;
    this.weeklyNoticeQueue = [];
    return events;
  }

  /**
   * Drain and return queued plot-grant events (T3.3a); the scene polls this
   * on its refresh tick, deferred behind celebrations and any open modal
   * exactly like `consumeWeeklyNotices` - the plots are already in the shed
   * by then, only the popup waits.
   */
  consumePlotGrantEvents(): PlotGrantEvent[] {
    const events = this.plotGrantQueue;
    this.plotGrantQueue = [];
    return events;
  }

  /**
   * Drain the one-shot tutorial-complete event: true exactly once after the
   * chain's final step completes, false forever after (and false for saves
   * whose `completed` arrived any other way). The scene polls this on its
   * refresh tick, mirroring `consumeLevelUpEvents`.
   */
  consumeTutorialCompleteEvent(): boolean {
    const pending = this.tutorialCompletePending;
    this.tutorialCompletePending = false;
    return pending;
  }

  /** Drain and return the pending offline summary (or null); the scene checks this every tick, both after `load()` and after a foreground resume. */
  consumeOfflineSummary(): OfflineSummary | null {
    const summary = this.offlineSummary;
    this.offlineSummary = null;
    return summary;
  }

  /**
   * Compute the "while you were away" summary measured from `sinceMs`, the
   * moment the session actually ended. Null when away under
   * OFFLINE_SUMMARY_MIN_MS, nothing matured in the gap, or onboarding has
   * not completed (a mid-tutorial return must not get a panel over the
   * guide). Uses the real clock on both sides, deliberately not `now()` (the
   * game clock, which the dev overlay can warp) - a session gap is measured
   * in wall-clock time.
   *
   * `sinceMs` MUST be a moment no live timer refreshes. It defaults to
   * `lastSavedAt` for the `load()` path, where that is safe - a closed app's
   * timers are dead, so `lastSavedAt` truly is the end of the last session.
   * It is NOT safe for a merely-backgrounded tab: the autosave interval
   * keeps firing (throttled but alive) and re-stamps `lastSavedAt` every
   * time, which is exactly why the foreground path (T3.20a) passes the
   * explicit `hiddenAt` timestamp instead.
   */
  private computeOfflineSummary(sinceMs: number = this.state.lastSavedAt): OfflineSummary | null {
    if (!this.state.onboarding.completed) return null;
    const nowMs = Date.now();
    const elapsedMs = nowMs - sinceMs;
    if (elapsedMs < OFFLINE_SUMMARY_MIN_MS) return null;
    const readyCounts: Partial<Record<CropId, number>> = {};
    for (const plot of this.state.plots) {
      if (plot.state !== 'growing') continue;
      const readyAt = plot.plantedAt + CROPS[plot.cropId].growMs;
      if (readyAt > sinceMs && readyAt <= nowMs) {
        readyCounts[plot.cropId] = (readyCounts[plot.cropId] ?? 0) + 1;
      }
    }
    return Object.keys(readyCounts).length > 0 ? { elapsedMs, readyCounts } : null;
  }

  /**
   * Plant a crop on an empty plot, spending its seed cost from coins (the
   * `seeds` field stays reserved in MVP). Returns false without mutating
   * anything if the index is out of range, the plot is occupied, the crop is
   * unknown, the tutorial rails forbid planting it right now, the crop is
   * not unlocked yet, or coins are insufficient.
   */
  plantCrop(plotIndex: number, cropId: CropId): boolean {
    const plot = this.state.plots[plotIndex];
    if (plot === undefined || plot.state !== 'empty') return false;
    // cropId is typed, but console/dev calls can pass arbitrary strings.
    if (!((cropId as string) in CROPS)) return false;
    if (!this.railsAllow('plant', cropId)) return false;
    const crop = CROPS[cropId];
    if (this.state.level < crop.unlockLevel) return false;
    if (this.state.coins < crop.seedCost) return false;
    this.state.coins -= crop.seedCost;
    this.state.plots[plotIndex] = {
      state: 'growing',
      cropId,
      plantedAt: now(),
      col: plot.col,
      row: plot.row,
    };
    this.trackOnboardingPlant(cropId);
    this.save();
    return true;
  }

  /**
   * Harvest a ready plot: the plot returns to empty, the crop goes to the
   * inventory, and its xp accrues (possibly leveling up). Returns false
   * without mutating anything if the plot is not growing, not ready yet, or
   * the tutorial rails are not on a harvest step.
   */
  harvestPlot(plotIndex: number): boolean {
    const plot = this.state.plots[plotIndex];
    if (plot === undefined || plot.state !== 'growing') return false;
    if (!isReady(plot, now())) return false;
    if (!this.railsAllow('harvest')) return false;
    this.state.plots[plotIndex] = { state: 'empty', col: plot.col, row: plot.row };
    // Radiant is a rare bonus-yield proc, suppressed during the tutorial so
    // its scripted economy stays deterministic. A restored farmhouse's
    // Homestead luck perk (T3.25) raises the CHANCE only - the yield and the
    // moondust roll below are unaffected.
    const isRadiant =
      this.state.onboarding.completed &&
      this.rng() < effectiveRadiantChance(RADIANT_CHANCE, this.state.restoration.farmhouse === 1);
    const yieldAmount = isRadiant ? RADIANT_YIELD_MULT : 1;
    this.state.inventory[plot.cropId] = (this.state.inventory[plot.cropId] ?? 0) + yieldAmount;
    if (isRadiant) {
      if (this.rng() < RADIANT_MOONDUST_CHANCE) this.state.moondust += 1;
      this.radiantQueue.push({ plotIndex, cropId: plot.cropId });
    }
    this.trackQuestHarvest(plot.cropId, isRadiant);
    this.applyXp(CROPS[plot.cropId].xp);
    if (plot.cropId === 'sunwheat') {
      // Read the step BEFORE tracking: the harvest that completes
      // harvest-first must not also count toward harvest-rest.
      const active = this.currentOnboardingStep()?.id;
      if (active === 'harvest-first' || active === 'harvest-rest') this.trackOnboarding(active);
    }
    this.save();
    return true;
  }

  /**
   * Replant everything a harvest gesture just reaped, in one all-or-nothing
   * pass. Rejected entirely (returns 0, no mutation) while onboarding is
   * active - the tutorial has no replant step. Filters to entries whose plot
   * is CURRENTLY empty (the player may have hand-planted one since the
   * harvest); if none remain, returns 0. Sums seed cost across that filtered
   * subset and requires coins to cover the whole sum - never a partial
   * replant of just the affordable entries. On success, plants every
   * remaining entry, saves once, and returns the count planted. No onboarding
   * tracking (already gated above); the unlock-level check per crop still
   * applies defensively, though a harvested crop was necessarily unlocked.
   */
  replant(entries: readonly { plotIndex: number; cropId: CropId }[]): number {
    if (!this.state.onboarding.completed) return 0;
    const plantable = entries.filter(
      (entry) =>
        this.state.plots[entry.plotIndex]?.state === 'empty' &&
        this.state.level >= CROPS[entry.cropId].unlockLevel,
    );
    if (plantable.length === 0) return 0;
    const totalCost = plantable.reduce((sum, entry) => sum + CROPS[entry.cropId].seedCost, 0);
    if (this.state.coins < totalCost) return 0;
    for (const entry of plantable) {
      const plot = this.state.plots[entry.plotIndex]!;
      this.state.coins -= CROPS[entry.cropId].seedCost;
      this.state.plots[entry.plotIndex] = {
        state: 'growing',
        cropId: entry.cropId,
        plantedAt: now(),
        col: plot.col,
        row: plot.row,
      };
    }
    this.save();
    return plantable.length;
  }

  /**
   * Purchase the one-time farm expansion (T3.3a rework): charges
   * EXPANSION_COST and flips `expanded` (which retires the Expand sign and
   * its blocked footprint tiles - never geometry since T3.3a-r), then GRANTS
   * the 4 new plots into the shed via `grantPlots` instead of pushing them
   * onto fixed tiles - the player places them wherever they wish. Returns
   * false without mutating anything if already expanded or coins are
   * insufficient. Rejected during the tutorial (belt-and-braces; the sign is
   * already hidden then).
   */
  expandFarm(): boolean {
    if (!this.railsAllow('expand')) return false;
    if (this.state.expanded) return false;
    if (this.state.coins < EXPANSION_COST) return false;
    this.state.coins -= EXPANSION_COST;
    this.state.expanded = true;
    // grantPlots saves (and queues the popup event); its cap can never fail
    // here - an unexpanded save's entitlement is at most 12 before this.
    this.grantPlots(EXPANDED_PLOT_COUNT - BASE_PLOT_COUNT);
    this.save();
    return true;
  }

  /**
   * Purchase a region (T3.3b), modeled on `expandFarm`: refuses (false, no
   * mutation) if `regionId` is unknown, already unlocked, the level is below
   * the region's `levelGate`, or coins are short of `costCoins`. On success it
   * deducts the coins, appends the id to `regionsUnlocked` (which immediately
   * raises the entitlement cap and opens the band to plots/decor/fences/
   * structures via the single placement authorities), grants `plotGrant` plots
   * through the SAME 5C flow the expand sign uses (`grantPlots` - popup event,
   * Edit Layout flash), and saves. The dev-only overgrant edge keeps the same
   * behavior class as `expandFarm`'s: `grantPlots`' cap can only fail if the
   * save was already over-granted, and coins are still spent either way.
   */
  purchaseRegion(regionId: string): boolean {
    const region = findRegion(regionId);
    if (region === undefined) return false;
    if (this.state.regionsUnlocked.includes(regionId)) return false;
    if (this.state.level < region.levelGate) return false;
    if (this.state.coins < region.costCoins) return false;
    this.state.coins -= region.costCoins;
    this.state.regionsUnlocked.push(regionId);
    this.grantPlots(region.plotGrant);
    this.save();
    return true;
  }

  /**
   * Dev-only region unlock (T3.3b): the `purchaseRegion` path minus the level
   * and coin gates - unlocks the region and grants its plots exactly like a
   * real purchase (same `regionsUnlocked` append + `grantPlots` flow, same
   * overgrant behavior class). Returns false for an unknown or already-unlocked
   * id. Wired to `dev.unlockRegion`.
   */
  devUnlockRegion(regionId: string): boolean {
    const region = findRegion(regionId);
    if (region === undefined) return false;
    if (this.state.regionsUnlocked.includes(regionId)) return false;
    this.state.regionsUnlocked.push(regionId);
    this.grantPlots(region.plotGrant);
    this.save();
    return true;
  }

  /**
   * Restore the farmhouse (T3.25) - the one-time, permanent homestead
   * upgrade. Refuses (false, NOTHING mutated) if it is already restored or if
   * either currency is short; on success it deducts BOTH currencies exactly
   * once, flips the flag, and saves. The already-restored check is what makes
   * a double tap (or a double-fired handler) a no-op rather than a second
   * charge, so the guard is the anti-double-spend, not the caller.
   *
   * Deliberately affects nothing but `coins`, `moondust`, and the flag: the
   * farmhouse's anchor, footprint, and movability are untouched - the scene
   * only swaps which frame it draws.
   */
  restoreFarmhouse(): boolean {
    if (this.state.restoration.farmhouse === 1) return false;
    if (this.state.coins < RESTORE_FARMHOUSE_COST.coins) return false;
    if (this.state.moondust < RESTORE_FARMHOUSE_COST.moondust) return false;
    this.state.coins -= RESTORE_FARMHOUSE_COST.coins;
    this.state.moondust -= RESTORE_FARMHOUSE_COST.moondust;
    this.state.restoration.farmhouse = 1;
    this.save();
    return true;
  }

  /** Whether the farmhouse restoration is affordable right now (T3.25) - the
   * single source for the panel's Buy-button enabled state. False once it is
   * already owned, so the button can never re-arm. */
  canAffordFarmhouseRestoration(): boolean {
    return (
      this.state.restoration.farmhouse === 0 &&
      this.state.coins >= RESTORE_FARMHOUSE_COST.coins &&
      this.state.moondust >= RESTORE_FARMHOUSE_COST.moondust
    );
  }

  /**
   * Dev-only restoration toggle (T3.25), mirroring `devUnlockRegion`: flips
   * the farmhouse's flag with NO cost and no gates, in either direction, so
   * the look and the perk can be compared back to back. Returns the new
   * value. Wired to `dev.setFarmhouseRestored`.
   */
  devSetFarmhouseRestored(restored: boolean): boolean {
    this.state.restoration.farmhouse = restored ? 1 : 0;
    this.save();
    return restored;
  }

  /**
   * Mark the one-time two-finger-pan hint (T3.3b) as shown - permanent, never
   * flips back. A no-op (no save) once already shown.
   */
  markTwoFingerHintShown(): void {
    if (this.state.twoFingerHintShown) return;
    this.state.twoFingerHintShown = true;
    this.save();
  }

  /**
   * Grant `count` plots into the shed (T3.3a): increments `unplacedPlots`
   * and queues one `PlotGrantEvent` for the scene's popup. Returns false
   * without mutating anything unless `count` is a positive integer and the
   * total plot entitlement (placed + shed) stays within the region-aware cap
   * (T3.3b - EXPANDED_PLOT_COUNT plus every unlocked region's
   * `entitlementIncrease`): plots can never be granted with nowhere to ever
   * put them. Autosaves, like the decoration mutators.
   */
  grantPlots(count: number): boolean {
    if (!Number.isInteger(count) || count <= 0) return false;
    if (
      this.state.plots.length + this.state.unplacedPlots + count >
      plotEntitlementCap(this.state.regionsUnlocked)
    ) {
      return false;
    }
    this.state.unplacedPlots += count;
    this.plotGrantQueue.push({ count });
    this.save();
    return true;
  }

  /**
   * Place one shed plot onto (col, row) (T3.3a): consumes an unplaced plot
   * into a new empty plot at that tile. Returns the new plot's index (always
   * `plots.length - 1`, placements only ever append - the same contract as
   * `placeFromWarehouse`) so the caller can select it, or false without
   * mutating anything if the shed is empty or the tile is not free
   * (`isPlotTileFree` - placeable, unoccupied, clear of structure footprints
   * and decor anchors; T3.3a-r). Autosaves.
   */
  placePlot(col: number, row: number): number | false {
    if (this.state.unplacedPlots <= 0) return false;
    if (!isPlotTileFree(this.state, col, row)) return false;
    this.state.unplacedPlots--;
    this.state.plots.push({ state: 'empty', col, row });
    this.save();
    return this.state.plots.length - 1;
  }

  /**
   * Relocate an EXISTING plot to (col, row) (T3.3a - the arrange-mode move).
   * Returns false without mutating anything if the index is out of range,
   * the plot is not empty (a growing crop locks its plot in place - harvest
   * first, then move), or the tile is not free for it (`isPlotTileFree` with
   * this plot exempted from the occupancy check; T3.3a-r). A move onto the
   * plot's own tile is always a valid no-op commit - even if a decoration
   * has since been dropped over that tile, putting a plot back where it
   * already stands can never be wrong. Autosaves.
   */
  movePlot(index: number, col: number, row: number): boolean {
    const plot = this.state.plots[index];
    if (plot === undefined || plot.state !== 'empty') return false;
    if (plot.col === col && plot.row === row) {
      this.save();
      return true;
    }
    if (!isPlotTileFree(this.state, col, row, index)) return false;
    plot.col = col;
    plot.row = row;
    this.save();
    return true;
  }

  /**
   * Relocate a movable structure's anchor to (col, row) (T3.3s - the
   * arrange-mode structure move). Legal iff every footprint tile at the new
   * anchor is inside the placeable domain, free of plots, free of the
   * OTHER structure's footprint, and clear of the expand sign's footprint
   * while the sign still stands (`isStructureAnchorFree` - decor does not
   * block structures). Returns false without mutating anything on any
   * violation; one save on success. A move onto the structure's own current
   * anchor passes the same check trivially (its own tiles hold no plots) -
   * a valid no-op commit, mirroring `movePlot`.
   */
  moveStructure(id: StructureId, col: number, row: number): boolean {
    if (!isStructureAnchorFree(this.state, id, col, row)) return false;
    const anchor = this.state.structures[id];
    anchor.col = col;
    anchor.row = row;
    this.save();
    return true;
  }

  /**
   * Buy a building (T4.1), mirroring `purchaseRegion`: refuses - mutating
   * NOTHING - on an unknown type, below the building's `unlockLevel`, short
   * coins, or one of that type already owned. On success it deducts the price,
   * appends a placement at the building's `defaultAnchor`, and saves.
   *
   * The one-per-type guard is a deliberate v1 simplification (one flour mill
   * max), and it doubles as the anti-double-spend a double tap needs - the
   * same role `restoreFarmhouse`'s already-restored check plays. It lives here
   * rather than in a future shop UI so no caller can spend around it.
   *
   * The default anchor is NOT re-validated against live collisions: a bought
   * building lands where the def says, and the player moves it from there
   * (arrange mode) if the spot is crowded - the same "place, then arrange"
   * contract granted plots have. `moveBuilding` is the collision authority.
   */
  buyBuilding(type: BuildingId): boolean {
    const building = findBuilding(type);
    if (building === undefined) return false;
    if (this.state.buildings.some((placed) => placed.type === type)) return false;
    if (this.state.level < building.unlockLevel) return false;
    if (this.state.coins < building.price) return false;
    this.state.coins -= building.price;
    this.appendBuilding(building.id);
    this.save();
    return true;
  }

  /**
   * Dev-only building grant (T4.1), mirroring `devUnlockRegion`: the
   * `buyBuilding` path minus the level and coin gates, so the mill can be
   * placed and exercised before it has a shop entry (T4.2). Keeps the
   * one-per-type guard - a second mill is not a thing this schema supports,
   * dev or not. Returns false for an unknown or already-owned type. Wired to
   * `dev.buildMill`.
   */
  devBuildBuilding(type: BuildingId): boolean {
    const building = findBuilding(type);
    if (building === undefined) return false;
    if (this.state.buildings.some((placed) => placed.type === type)) return false;
    this.appendBuilding(building.id);
    this.save();
    return true;
  }

  /** Append a placement at `type`'s default anchor - the one spot both the
   *  real purchase and the dev grant put a new building, so they cannot drift. */
  private appendBuilding(type: BuildingId): void {
    const { defaultAnchor } = BUILDINGS[type];
    this.state.buildings.push({
      type,
      col: defaultAnchor.col,
      row: defaultAnchor.row,
      batches: [],
      // One usable slot to start (T4.2b-r1); the rest are bought.
      unlockedSlots: 1,
    });
  }

  /**
   * Buy the next production slot on the building at `buildingIndex`
   * (T4.2b-r1), mirroring `buyBuilding`'s guard style. Unlocks are SEQUENTIAL
   * and priced by the recipe's own `slotUnlockCosts`, so slot 3 cannot be
   * bought before slot 2 and no caller can spend around the order.
   *
   * Returns false without mutating anything when the index is out of range,
   * the building has no milling recipe, every slot is already unlocked, or the
   * purse is short of the next slot's cost. One save on success.
   */
  unlockMillSlot(buildingIndex: number): boolean {
    const placement = this.state.buildings[buildingIndex];
    if (placement === undefined) return false;
    const recipe = BUILDINGS[placement.type].milling;
    if (recipe === undefined) return false;
    if (placement.unlockedSlots >= recipe.slots) return false;
    // The costs list prices the slots PAST the first, so the slot being bought
    // (the one at index `unlockedSlots`) is priced at `unlockedSlots - 1`.
    const cost = recipe.slotUnlockCosts[placement.unlockedSlots - 1];
    if (cost === undefined) return false;
    if (this.state.coins < cost) return false;
    this.state.coins -= cost;
    placement.unlockedSlots += 1;
    this.save();
    return true;
  }

  /**
   * Dev-only slot unlock (T4.2b-r1): the `unlockMillSlot` path minus the coin
   * gate, so all three slots are exercisable without grinding 12,500 coins.
   * Keeps the sequential cap - a fourth slot is not a thing the schema
   * supports, dev or not. Wired to `dev.unlockMillSlot`.
   */
  devUnlockMillSlot(buildingIndex: number): boolean {
    const placement = this.state.buildings[buildingIndex];
    if (placement === undefined) return false;
    const recipe = BUILDINGS[placement.type].milling;
    if (recipe === undefined) return false;
    if (placement.unlockedSlots >= recipe.slots) return false;
    placement.unlockedSlots += 1;
    this.save();
    return true;
  }

  /**
   * Start one production batch on the building at `buildingIndex` (T4.2a).
   * The recipe's input crop is consumed AT START, so a batch in flight is
   * already paid for and cannot be refunded by walking away.
   *
   * Returns false without mutating anything when the index is out of range,
   * the building has no milling recipe, every slot is already busy, or the bag
   * holds fewer than `inputCount` of the input crop. One save on success.
   */
  startMilling(buildingIndex: number): boolean {
    const placement = this.state.buildings[buildingIndex];
    if (placement === undefined) return false;
    const recipe = BUILDINGS[placement.type].milling;
    if (recipe === undefined) return false;
    // Capacity is what the player has PAID FOR (T4.2b-r1), not what the def
    // declares - a locked slot is not a slot you can load.
    if (placement.batches.length >= placement.unlockedSlots) return false;
    const held = this.state.inventory[recipe.inputCropId] ?? 0;
    if (held < recipe.inputCount) return false;
    this.state.inventory[recipe.inputCropId] = held - recipe.inputCount;
    placement.batches.push({ startedAt: now() });
    this.save();
    return true;
  }

  /**
   * Collect the finished batch `batchIndex` on the building at `buildingIndex`
   * (T4.2a), granting the recipe's output good and freeing the slot. Collection
   * is MANUAL: a ready batch sits ready indefinitely until this is called.
   *
   * Returns the number of goods granted, or 0 without mutating anything when
   * either index is out of range, the building has no recipe, or the batch is
   * not ready yet. Readiness is derived from `startedAt + batchMs` against the
   * game clock - nothing advanced the batch, so a batch that finished while the
   * game was closed reads ready on the first check after load.
   */
  collectMilling(buildingIndex: number, batchIndex: number): number {
    const placement = this.state.buildings[buildingIndex];
    if (placement === undefined) return 0;
    const recipe = BUILDINGS[placement.type].milling;
    if (recipe === undefined) return 0;
    const batch = placement.batches[batchIndex];
    if (batch === undefined) return 0;
    if (!isMillBatchReady(batch, recipe, now())) return 0;
    placement.batches.splice(batchIndex, 1);
    const goodId = recipe.outputGoodId;
    this.state.goods[goodId] = (this.state.goods[goodId] ?? 0) + recipe.outputCount;
    this.save();
    return recipe.outputCount;
  }

  /**
   * Back-date every batch on every building so all of them read ready right
   * now (dev tooling, T4.2a). The only way to exercise collection - including
   * the offline path - without waiting out a real 20-minute batch. Wired to
   * `dev.finishMilling`.
   */
  devFinishMilling(): void {
    const nowMs = now();
    for (const placement of this.state.buildings) {
      const recipe = BUILDINGS[placement.type].milling;
      if (recipe === undefined) continue;
      for (const batch of placement.batches) batch.startedAt = nowMs - recipe.batchMs;
    }
    this.save();
  }

  /**
   * Relocate a placed building's anchor to (col, row) (T4.1) - the building
   * twin of `moveStructure`, and the arrange-mode building move. Legal iff
   * every footprint tile at the new anchor is inside the placeable domain,
   * free of plots, free of every OTHER permanent footprint (both structures
   * and every other building), and clear of the expand sign while it stands
   * (`isBuildingAnchorFree` - decor does not block buildings, exactly as it
   * does not block structures). Returns false without mutating anything on an
   * out-of-range index or any violation; one save on success. A move onto the
   * building's own current anchor passes trivially - it is exempted from its
   * own footprint - which makes it a valid no-op commit, mirroring
   * `moveStructure` and `movePlot`.
   */
  moveBuilding(index: number, col: number, row: number): boolean {
    const placement = this.state.buildings[index];
    if (placement === undefined) return false;
    if (!isBuildingAnchorFree(this.state, placement.type, col, row, index)) return false;
    placement.col = col;
    placement.row = row;
    this.save();
    return true;
  }

  /**
   * Purchase a decoration (T3.9, reworked into the warehouse in T3.9b):
   * deducts its price from the right currency and increments its warehouse
   * count - nothing is placed on the lawn. Returns false without mutating
   * anything if `itemFrame` is not a known `DECOR_ITEMS` frame, the item's
   * OWN placed+warehoused budget is already full (split budgets, T3.3a2:
   * fences against MAX_FENCES, everything else against MAX_DECOR_ITEMS;
   * trophies exempt, T3.17), the balance is insufficient, or onboarding is
   * still active (the tutorial has no shop step).
   */
  buyDecoration(itemFrame: string): boolean {
    if (!this.railsAllow('decor-shop')) return false;
    const item = DECOR_ITEMS.find((candidate) => candidate.frame === itemFrame);
    if (item === undefined) return false;
    if (item.frame === FENCE_FRAME) {
      if (fenceOwnedCount(this.state.decorations, this.state.warehouse) >= MAX_FENCES) return false;
    } else if (decorOwnedCount(this.state.decorations, this.state.warehouse) >= MAX_DECOR_ITEMS) {
      return false;
    }
    const balance = item.currency === 'coins' ? this.state.coins : this.state.moondust;
    if (balance < item.price) return false;
    if (item.currency === 'coins') this.state.coins -= item.price;
    else this.state.moondust -= item.price;
    this.state.warehouse[item.frame] = (this.state.warehouse[item.frame] ?? 0) + 1;
    this.save();
    return true;
  }

  /**
   * Place one warehoused unit of `frame` onto the lawn (T3.9b), at screen
   * center and its per-item spawn scale (WAREHOUSE_PLACE_X/Y,
   * `decorSpawnScale` - showcase size for DECOR_SIZING items, T3.3a2) so a
   * placed item is immediately visible and ready to drag - shrunk to taste
   * from there via arrange mode. Decrements the warehouse count
   * (removing the key entirely once it hits 0, never leaving a 0 entry),
   * appends the new placement (unmirrored), one save. Returns the new
   * placement's index (always `decorations.length - 1`, since placements
   * only ever append) so the caller can select it, or false if none are
   * owned.
   */
  placeFromWarehouse(frame: string): number | false {
    const owned = this.state.warehouse[frame] ?? 0;
    if (owned <= 0) return false;
    if (owned === 1) delete this.state.warehouse[frame];
    else this.state.warehouse[frame] = owned - 1;
    this.state.decorations.push({
      frame,
      x: WAREHOUSE_PLACE_X,
      y: WAREHOUSE_PLACE_Y,
      scale: decorSpawnScale(frame),
      flip: false,
    });
    this.save();
    return this.state.decorations.length - 1;
  }

  /**
   * Return a placed decoration to the warehouse (T3.9b): removes it from
   * `decorations` and increments its frame's warehouse count, one save.
   * Returns false without mutating anything if `index` is out of range.
   */
  storeDecoration(index: number): boolean {
    const decoration = this.state.decorations[index];
    if (decoration === undefined) return false;
    this.state.decorations.splice(index, 1);
    this.state.warehouse[decoration.frame] = (this.state.warehouse[decoration.frame] ?? 0) + 1;
    this.save();
    return true;
  }

  /**
   * Reposition/rescale/flip a placed decoration (the arrange mode; T3.9a,
   * flip added T3.15). Returns false without mutating anything if `index` is
   * out of range, any of x/y/scale is non-finite, or `flip` is not a
   * boolean; otherwise clamps x/y to the region-aware decoration bounds
   * (`decorClampBounds(regionsUnlocked)`, T3.3b - the base rect UNION every
   * unlocked band) and scale to DECOR_SCALE_MIN..ceiling,
   * applies `flip` unclamped (a plain boolean), one save. The scale ceiling
   * defaults to the item's own `decorMaxScale` (per-item sizing, T3.3a2);
   * T3.27's dev-only decor sizing probe passes a higher dev ceiling while
   * its flag is on so the selected item's arrange-mode Scale +/- buttons can
   * bypass the normal cap - this store method stays the sole clamp authority
   * either way. FENCES are the exception (T3.3a2): their scale is pinned to
   * exactly FENCE_FIXED_SCALE unconditionally - no caller, dev probe
   * included, can resize a fence.
   *
   * T3.3s-r1 (owner rule: nothing places on top of permanent objects): the
   * commit is REFUSED outright (false, no mutation) when the decoration's
   * CLAMPED ground anchor lands inside any permanent-object footprint tile's
   * diamond - the farmhouse/notice board footprints at their current
   * anchors, plus the expand sign's while it still stands
   * (`isPointOnPermanentFootprint`). The clamped point is judged because
   * that is where the commit would actually land.
   */
  setDecorationTransform(
    index: number,
    x: number,
    y: number,
    scale: number,
    flip: boolean,
    scaleCeiling?: number,
  ): boolean {
    const decoration = this.state.decorations[index];
    if (decoration === undefined) return false;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(scale)) return false;
    if (typeof flip !== 'boolean') return false;
    const bounds = decorClampBounds(this.state.regionsUnlocked);
    const clampedX = Math.min(bounds.maxX, Math.max(bounds.minX, x));
    const clampedY = Math.min(bounds.maxY, Math.max(bounds.minY, y));
    if (isPointOnPermanentFootprint(this.state, clampedX, clampedY)) return false;
    decoration.x = clampedX;
    decoration.y = clampedY;
    const ceiling = scaleCeiling ?? decorMaxScale(decoration.frame);
    decoration.scale =
      decoration.frame === FENCE_FRAME
        ? FENCE_FIXED_SCALE
        : Math.min(ceiling, Math.max(DECOR_SCALE_MIN, scale));
    decoration.flip = flip;
    this.save();
    return true;
  }

  /**
   * Sell the entire stack of one crop: coins gain count * sellValue, the
   * stack empties, and the change persists. Returns the coins gained (0
   * without mutating anything if the stack is already empty, or for every
   * crop while the tutorial is active - it has no sell step).
   */
  sellCrop(cropId: CropId): number {
    if (!this.railsAllow('sell')) return 0;
    const count = this.state.inventory[cropId] ?? 0;
    if (count <= 0) return 0;
    const gained = count * CROPS[cropId].sellValue;
    this.state.coins += gained;
    this.state.inventory[cropId] = 0;
    this.save();
    return gained;
  }

  /**
   * Sell the entire stack of one processed good (T4.0): the exact mirror of
   * `sellCrop`, against the separate `goods` map and `GOODS[id].sellValue`.
   * Coins gain count * sellValue, the stack empties, and the change persists.
   * Returns the coins gained (0 without mutating anything if the stack is
   * already empty, or while the tutorial rails are active - the same 'sell'
   * gate crops use).
   */
  sellGood(goodId: GoodId): number {
    if (!this.railsAllow('sell')) return 0;
    const count = this.state.goods[goodId] ?? 0;
    if (count <= 0) return 0;
    const gained = count * GOODS[goodId].sellValue;
    this.state.coins += gained;
    this.state.goods[goodId] = 0;
    this.save();
    return gained;
  }

  /**
   * Grant goods directly (dev tooling, T4.0). Nothing produces a good until
   * the mill ships, so this is the only way to put one in the bag and
   * exercise `sellGood`. Adds to the existing stack and persists.
   */
  devGrantGood(goodId: GoodId, count: number): void {
    this.state.goods[goodId] = (this.state.goods[goodId] ?? 0) + count;
    this.save();
  }

  /**
   * Roll the weekly quest rotation forward when the real clock has passed
   * `anchor + WEEK_MS`, catching up multiple missed weeks (e.g. a long
   * offline gap) in one jump rather than looping week by week. Before
   * anything resets, the expired week's completed-but-unclaimed quests
   * auto-grant their rewards (T3.19, owner decision; no inbox) - judged
   * against the expired week's own counters and growth-target snapshot, and
   * run exactly once even across a multi-week gap, since the counters only
   * ever describe the one expired week. Then advances `anchor` by whole
   * weeks, redraws `activeIds`/`featuredCrop` (level-filtered) via the
   * store's rng (ids may repeat across weeks - only the 2 ids within one
   * week must be distinct), stamps the new week's `growthTarget`, zeroes
   * every weekly counter and `claimed`, and queues one `WeeklyNoticeEvent`
   * if anything was granted (a bare rotation stays silent). Uses
   * `Date.now()` deliberately, not the warpable `now()` - a warped game
   * clock must not skip a week. Called from `load()`, the FarmScene periodic
   * tick, and `handleForegroundReturn()` (visibility resume), like
   * `ensureOrders`; idempotent, a cheap no-op (one clock compare) when the
   * week hasn't turned over.
   */
  ensureWeeklyQuests(): void {
    const nowMs = Date.now();
    const weekly = this.state.quests.weekly;
    if (nowMs < weekly.anchor + WEEK_MS) return;
    // Grant pass: the growth target still holds the EXPIRED week's snapshot
    // here - that is the correct target to judge completion against.
    const granted: WeeklyNoticeEvent['granted'] = [];
    for (const id of weekly.activeIds) {
      const def = WEEKLY_QUESTS.find((quest) => quest.id === id);
      if (def === undefined || weekly.claimed.includes(id)) continue;
      const { current, target } = this.weeklyQuestCurrentAndTarget(def);
      if (current < target) continue;
      // Weekly rewards are only chests/moondust today; grantQuestReward
      // queues chest ceremonies via grantChests, and those surfacing after
      // the rollover is intended.
      this.grantQuestReward(def.reward);
      granted.push({
        name: def.name,
        chests: def.reward.chests ?? 0,
        moondust: def.reward.moondust ?? 0,
      });
    }
    const weeksElapsed = Math.floor((nowMs - weekly.anchor) / WEEK_MS);
    weekly.anchor += weeksElapsed * WEEK_MS;
    const [a, b] = drawWeeklyQuestIds(this.rng);
    weekly.activeIds = [a, b];
    weekly.featuredCrop = drawFeaturedCrop(this.rng, this.state.level);
    weekly.growthTarget = growthTargetForLevel(this.state.level);
    weekly.growMinutes = 0;
    weekly.featuredHarvests = 0;
    weekly.orders = 0;
    weekly.radiants = 0;
    weekly.claimed = [];
    if (granted.length > 0) {
      const nameOf = (id: string): string =>
        WEEKLY_QUESTS.find((quest) => quest.id === id)?.name ?? id;
      this.weeklyNoticeQueue.push({ granted, newQuestNames: [nameOf(a), nameOf(b)] });
    }
    this.save();
  }

  /** The lifetime counter value a long quest's `counter` refers to. */
  private longQuestCounterValue(counter: LongQuestCounter): number {
    const lifetime = this.state.quests.lifetime;
    switch (counter.kind) {
      case 'cropHarvests':
        return lifetime.harvestsByCrop[counter.cropId] ?? 0;
      case 'totalHarvests':
        return lifetime.totalHarvests;
      case 'ordersFulfilled':
        return lifetime.ordersFulfilled;
      case 'premiumFulfilled':
        return lifetime.premiumFulfilled;
      case 'chestsOpened':
        return lifetime.chestsOpened;
    }
  }

  /**
   * The weekly counter value and target a weekly quest's `counter` refers to.
   * weekly_specialist's target comes from `perCropTarget[featuredCrop]` and
   * weekly_growth's from the week's stored `growthTarget` snapshot (T3.19),
   * rather than their (absent) flat `target`.
   */
  private weeklyQuestCurrentAndTarget(def: WeeklyQuestDef): { current: number; target: number } {
    const weekly = this.state.quests.weekly;
    switch (def.counter.kind) {
      case 'growMinutes':
        return { current: weekly.growMinutes, target: weekly.growthTarget };
      case 'featuredHarvests':
        return {
          current: weekly.featuredHarvests,
          target: def.perCropTarget?.[weekly.featuredCrop] ?? def.target ?? 0,
        };
      case 'orders':
        return { current: weekly.orders, target: def.target ?? 0 };
      case 'radiants':
        return { current: weekly.radiants, target: def.target ?? 0 };
    }
  }

  /**
   * A quest's current progress, derived from the counters - never stored.
   * Works for both a LONG_QUESTS id (lifetime counters vs its fixed target)
   * and a WEEKLY_QUESTS id (this week's counters vs its target, meaningful
   * only while the id is actually in `weekly.activeIds` - callers showing a
   * quest board should only call this for active weekly ids). Returns null
   * for an unknown id.
   */
  questProgress(id: string): QuestProgress | null {
    const longDef = LONG_QUESTS.find((quest) => quest.id === id);
    if (longDef !== undefined) {
      const current = this.longQuestCounterValue(longDef.counter);
      return {
        current,
        target: longDef.target,
        complete: current >= longDef.target,
        claimed: this.state.quests.longClaimed.includes(id),
      };
    }
    const weeklyDef = WEEKLY_QUESTS.find((quest) => quest.id === id);
    if (weeklyDef === undefined) return null;
    const { current, target } = this.weeklyQuestCurrentAndTarget(weeklyDef);
    return {
      current,
      target,
      complete: current >= target,
      claimed: this.state.quests.weekly.claimed.includes(id),
    };
  }

  /**
   * Grant a quest's reward: a trophy lands directly in the warehouse with no
   * cap check needed - trophy frames are exempt from the purchasable
   * budgets (MAX_DECOR_ITEMS/MAX_FENCES) BY DEFINITION (T3.17), so the grant and save
   * validation agree and this is not a bypass; chests go through the
   * existing chest-grant path (`grantChests`: rolled contents, instant
   * grant, ceremony event queued); moondust is direct. Any subset may be
   * present (composable rewards).
   */
  private grantQuestReward(reward: { trophy?: string; chests?: number; moondust?: number }): void {
    if (reward.trophy !== undefined) {
      this.state.warehouse[reward.trophy] = (this.state.warehouse[reward.trophy] ?? 0) + 1;
    }
    if (reward.chests !== undefined) this.grantChests(reward.chests);
    if (reward.moondust !== undefined) this.state.moondust += reward.moondust;
  }

  /**
   * Claim a completed, unclaimed quest's reward. Returns false without
   * mutating anything if the tutorial rails forbid claiming (mid-tutorial),
   * the id is unknown, it is not yet complete, it was already claimed, or -
   * weekly quests only - it is not currently in `weekly.activeIds` (a quest
   * that rotated out, even if it happened to be completed, is no longer
   * claimable until it rotates back in and completes again). On success,
   * grants the reward and marks it claimed (longClaimed for a long quest,
   * weekly.claimed for a weekly one), one save.
   */
  claimQuest(id: string): boolean {
    if (!this.railsAllow('quest-claim')) return false;
    const progress = this.questProgress(id);
    if (progress === null || !progress.complete || progress.claimed) return false;
    const longDef = LONG_QUESTS.find((quest) => quest.id === id);
    if (longDef !== undefined) {
      this.grantQuestReward(longDef.reward);
      this.state.quests.longClaimed.push(id);
      this.save();
      return true;
    }
    const weeklyDef = WEEKLY_QUESTS.find((quest) => quest.id === id);
    if (weeklyDef === undefined) return false;
    if (!this.state.quests.weekly.activeIds.includes(id)) return false;
    this.grantQuestReward(weeklyDef.reward);
    this.state.quests.weekly.claimed.push(id);
    this.save();
    return true;
  }

  /**
   * Mark the quest board's first-open explainer (T3.14) dismissed - permanent,
   * never flips back. A no-op (no save) once already seen.
   */
  markQuestsIntroSeen(): void {
    if (this.state.quests.introSeen) return;
    this.state.quests.introSeen = true;
    this.save();
  }

  /**
   * Mark the Goals menu discovered (T3.30) - permanent, never flips back.
   * Called the first time the panel opens; clears the icon's "!" badge and its
   * first-appearance pulse for good. A no-op (no save) once already seen.
   */
  markGoalsSeen(): void {
    if (this.state.goalsSeen) return;
    this.state.goalsSeen = true;
    this.save();
  }

  /**
   * Bring the order board up to date: fill every pending slot with a freshly
   * generated order and reopen cooldown slots whose readyAt has passed.
   * Called on scene create and on the scene's refresh tick - idempotent, and
   * a cheap no-op (no save) when nothing needs generating.
   */
  ensureOrders(): void {
    let changed = false;
    const nowMs = now();
    // No premium orders while the tutorial is running - it has no moondust
    // ceremony (teaser orders were removed entirely in T2.24, so there is no
    // longer a second chance to suppress here).
    const premiumChance = this.state.onboarding.completed ? PREMIUM_CHANCE : 0;
    for (let i = 0; i < this.state.orders.length; i++) {
      const slot = this.state.orders[i]!;
      if (slot.state === 'pending' || (slot.state === 'cooldown' && slot.readyAt <= nowMs)) {
        this.state.orders[i] = {
          state: 'open',
          order: generateOrder(this.state.level, this.rng, premiumChance),
        };
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /**
   * Dev-only (T2.27): overwrite every order slot with a freshly generated
   * order forced premium (premiumChance 1), all open, one save. At
   * CHEST_UNLOCK_LEVEL+ these naturally carry chests, same as any other
   * premium order - below that they're chestless premium, which is correct
   * (not a bug), matching what `generateOrder` would produce for a real
   * premium roll at the player's current level.
   */
  devFillBoardPremium(): void {
    for (let i = 0; i < this.state.orders.length; i++) {
      this.state.orders[i] = {
        state: 'open',
        order: generateOrder(this.state.level, this.rng, 1),
      };
    }
    this.save();
  }

  /**
   * Fulfill an open order: every requested item leaves the inventory, coins
   * gain the order's stored coinReward, xp gains its stored xpReward through
   * the applyXp choke point (so level-ups ride the celebration queue),
   * moondust gains the order's stored premium.moondust if present, a premium
   * order carrying `premium.chests` (generated only at CHEST_UNLOCK_LEVEL+ -
   * see `data/orders.ts`) also grants that many chests immediately (see
   * `grantChests`), and the slot returns to pending for the next
   * `ensureOrders` to refill. Returns false without mutating anything if the
   * slot is not open, the inventory does not cover every item, or the
   * tutorial rails are not on the deliver step (which permits only slot 0 -
   * the scripted ORDER A).
   */
  fulfillOrder(slotIndex: number): boolean {
    if (!this.railsAllow('fulfill', slotIndex)) return false;
    const slot = this.state.orders[slotIndex];
    if (slot === undefined || slot.state !== 'open') return false;
    const { order } = slot;
    const covered = order.items.every(
      (item) => (this.state.inventory[item.cropId] ?? 0) >= item.count,
    );
    if (!covered) return false;
    for (const item of order.items) {
      this.state.inventory[item.cropId] = (this.state.inventory[item.cropId] ?? 0) - item.count;
    }
    this.state.coins += order.coinReward;
    this.applyXp(order.xpReward);
    if (order.premium) {
      this.state.moondust += order.premium.moondust;
      if (order.premium.chests) {
        this.grantChests(order.premium.chests);
        this.state.quests.lifetime.chestsOpened += order.premium.chests;
      }
    }
    this.trackQuestOrderFulfilled(order.premium !== undefined);
    this.state.orders[slotIndex] = { state: 'pending' };
    // During the tutorial the rails guarantee this is the scripted slot-0
    // delivery, so the track always matches; post-tutorial it is a no-op.
    this.trackOnboarding('deliver-sunwheat');
    this.save();
    return true;
  }

  /**
   * Roll `count` chests' worth of contents (each: a coin amount uniform in
   * [CHEST_COINS_MIN, CHEST_COINS_MAX], plus CHEST_MOONDUST_AMOUNT moondust
   * with CHEST_MOONDUST_CHANCE), grant the summed total to state immediately
   * - state-first, so a ceremony lost to an app close before the scene
   * drains `consumeChestEvents` only loses the show, same philosophy as
   * level-ups - and queue the individual per-chest rolls (T2.23b) so the
   * ceremony can show each chest's own loot. Caller (`fulfillOrder`) owns
   * the save.
   */
  private grantChests(count: number): void {
    const contents: { coins: number; moondust: number }[] = [];
    let totalCoins = 0;
    let totalMoondust = 0;
    for (let i = 0; i < count; i++) {
      const coins =
        CHEST_COINS_MIN + Math.floor(this.rng() * (CHEST_COINS_MAX - CHEST_COINS_MIN + 1));
      const moondust = this.rng() < CHEST_MOONDUST_CHANCE ? CHEST_MOONDUST_AMOUNT : 0;
      contents.push({ coins, moondust });
      totalCoins += coins;
      totalMoondust += moondust;
    }
    this.state.coins += totalCoins;
    this.state.moondust += totalMoondust;
    this.chestQueue.push({ contents });
  }

  /**
   * Quest counter hook for `harvestPlot` (T3.10): lifetime harvestsByCrop and
   * totalHarvests always count, tutorial included - the quest system has no
   * tutorial gate of its own. Weekly growMinutes accrues the harvested crop's
   * full growMs (converted to minutes); featuredHarvests counts only when the
   * crop matches this week's featured crop; radiants counts only when this
   * harvest was itself a Radiant proc (already tutorial-suppressed upstream,
   * so no extra gate needed here).
   */
  private trackQuestHarvest(cropId: CropId, isRadiant: boolean): void {
    const { lifetime, weekly } = this.state.quests;
    lifetime.harvestsByCrop[cropId] = (lifetime.harvestsByCrop[cropId] ?? 0) + 1;
    lifetime.totalHarvests++;
    weekly.growMinutes += CROPS[cropId].growMs / 60_000;
    if (cropId === weekly.featuredCrop) weekly.featuredHarvests++;
    if (isRadiant) weekly.radiants++;
  }

  /**
   * Quest counter hook for `fulfillOrder` (T3.10): ordersFulfilled/weekly
   * orders always count, tutorial included; premiumFulfilled counts only a
   * premium order. `chestsOpened` is bumped separately, inline in
   * `fulfillOrder` right where `order.premium.chests` is known, not here.
   */
  private trackQuestOrderFulfilled(isPremium: boolean): void {
    const { lifetime, weekly } = this.state.quests;
    lifetime.ordersFulfilled++;
    weekly.orders++;
    if (isPremium) lifetime.premiumFulfilled++;
  }

  /**
   * Skip an open order: the slot goes on cooldown until now() + an escalating
   * duration (BASE_MS * GROWTH ** streak, capped at MAX_MS), when
   * `ensureOrders` will refill it. The streak counts consecutive skips and
   * resets to 0 first if the previous skip was more than
   * SKIP_STREAK_RESET_MS ago. Returns false without mutating anything if the
   * slot is not open or the tutorial is still active (skipping is never a
   * tutorial action).
   */
  skipOrder(slotIndex: number): boolean {
    if (!this.railsAllow('skip')) return false;
    const slot = this.state.orders[slotIndex];
    if (slot === undefined || slot.state !== 'open') return false;
    const nowMs = now();
    const skips = this.state.orderSkips;
    if (nowMs - skips.lastAt > SKIP_STREAK_RESET_MS) skips.count = 0;
    const cooldownMs = Math.min(
      SKIP_COOLDOWN_BASE_MS * SKIP_COOLDOWN_GROWTH ** skips.count,
      SKIP_COOLDOWN_MAX_MS,
    );
    this.state.orders[slotIndex] = { state: 'cooldown', readyAt: nowMs + cooldownMs };
    skips.count++;
    skips.lastAt = nowMs;
    this.save();
    return true;
  }

  /** The active onboarding step, or null once completed. */
  private currentOnboardingStep(): OnboardingStep | null {
    if (this.state.onboarding.completed) return null;
    return ONBOARDING_STEPS[this.state.onboarding.step] ?? null;
  }

  /**
   * THE tutorial full-rails choke point: while onboarding is active, every
   * gameplay action is rejected unless the current step calls for it; once
   * `completed`, everything is allowed - zero post-tutorial behavior change.
   * `target` is the crop id for 'plant'/'select-seed' and the slot index for
   * 'fulfill'; the other actions ignore it. The store's own mutators and the
   * UI (SeedBar, Hud, OrderBoard) all query this - the rails rules live
   * nowhere else. Blocked actions fail silently (false/0, no shake, no
   * sound), matching the store's fail-silent philosophy.
   */
  railsAllow(action: RailsAction, target?: CropId | number): boolean {
    if (this.state.onboarding.completed) return true;
    const step = this.currentOnboardingStep();
    if (step === null) return true;
    switch (action) {
      case 'plant':
        return this.railsPlantAllowed(step, target);
      case 'select-seed':
        // The seed-select step itself, plus wherever planting that crop is
        // currently allowed.
        if (step.id === 'select-sunwheat') return target === 'sunwheat';
        return this.railsPlantAllowed(step, target);
      case 'harvest':
        return step.id === 'harvest-first' || step.id === 'harvest-rest';
      case 'fulfill':
        // Deliberately only the scripted slot-0 order, never another slot.
        return step.id === 'deliver-sunwheat' && target === 0;
      case 'orders-button':
        return (
          step.id === 'open-orders' ||
          step.id === 'deliver-sunwheat' ||
          step.id === 'review-order' ||
          step.id === 'close-orders'
        );
      case 'sell':
      case 'skip':
      case 'expand':
      case 'bag-button':
      case 'decor-shop':
      case 'quest-claim':
      case 'quest-board':
        // No sell/bag/decor-shop/quest-claim/quest-board steps remain, and
        // skipping or expanding is never a tutorial action.
        return false;
    }
  }

  /**
   * The planting half of the rails: the single-crop plant steps accept only
   * sunwheat; plant-mixed accepts each crop only while its counter is below
   * its goal (a 9th sunwheat or 5th starcorn is rejected outright, no coins
   * spent). Every other step forbids planting entirely.
   */
  private railsPlantAllowed(step: OnboardingStep, cropId?: CropId | number): boolean {
    if (step.id === 'plant-first' || step.id === 'plant-rest') return cropId === 'sunwheat';
    if (step.id !== 'plant-mixed') return false;
    const { progress, progressB } = this.state.onboarding;
    if (cropId === 'sunwheat') return progress < step.goal;
    if (cropId === 'starcorn') return progressB < (step.goalB ?? 0);
    return false;
  }

  /**
   * Count one action toward the active onboarding step. No-op unless the
   * event matches the step. Reaching the goal advances the chain. The
   * dual-counter plant-mixed step never routes through here - it lives in
   * `trackOnboardingPlant`. Returns whether state changed; callers own the
   * save.
   */
  private trackOnboarding(eventId: OnboardingStepId): boolean {
    const step = this.currentOnboardingStep();
    if (step === null || step.id !== eventId) return false;
    const onboarding = this.state.onboarding;
    onboarding.progress++;
    if (onboarding.progress >= step.goal) this.advanceOnboardingStep();
    return true;
  }

  /**
   * Count one planting toward the active onboarding step. The single-counter
   * plant steps only accept sunwheat; plant-mixed keeps two capped counters
   * (progress = sunwheat / goal, progressB = starcorn / goalB) and advances
   * only when BOTH goals are met. Callers own the save.
   */
  private trackOnboardingPlant(cropId: CropId): void {
    const step = this.currentOnboardingStep();
    if (step === null) return;
    if (step.id === 'plant-first' || step.id === 'plant-rest') {
      if (cropId === 'sunwheat') this.trackOnboarding(step.id);
      return;
    }
    if (step.id !== 'plant-mixed') return;
    const onboarding = this.state.onboarding;
    const goalB = step.goalB ?? 0;
    if (cropId === 'sunwheat' && onboarding.progress < step.goal) {
      onboarding.progress++;
    } else if (cropId === 'starcorn' && onboarding.progressB < goalB) {
      onboarding.progressB++;
    } else {
      return;
    }
    if (onboarding.progress >= step.goal && onboarding.progressB >= goalB) {
      this.advanceOnboardingStep();
    }
  }

  /**
   * Advance to the next step (resetting both counters) and apply on-enter
   * side effects: entering `deliver-sunwheat` scripts ORDER A into slot 0;
   * leaving it (entering `review-order`, which only fulfillment can do)
   * replaces the just-vacated slot 0 with ORDER B while the board is still
   * open, so the player reviews the order the plant-mixed step grows toward
   * right there. Passing the last step sets `completed` - permanently: every
   * entry point checks `completed` first, so nothing ever tracks again.
   */
  private advanceOnboardingStep(): void {
    const onboarding = this.state.onboarding;
    onboarding.step++;
    onboarding.progress = 0;
    onboarding.progressB = 0;
    this.stepEnteredAt = now();
    if (onboarding.step >= ONBOARDING_STEPS.length) {
      onboarding.completed = true;
      // Chain completion is the ONLY set-point for the celebration one-shot;
      // migration/load/import set `completed` directly and never pass here.
      this.tutorialCompletePending = true;
      return;
    }
    const enteredId = ONBOARDING_STEPS[onboarding.step]?.id;
    if (enteredId === 'deliver-sunwheat') {
      this.state.orders[0] = { state: 'open', order: cloneOrder(ONBOARDING_ORDER_A) };
    } else if (enteredId === 'review-order') {
      this.state.orders[0] = { state: 'open', order: cloneOrder(ONBOARDING_ORDER_B) };
    }
  }

  /**
   * Read-dwell guard, called on the scene's refresh tick. `review-order`
   * self-advances once its board has been open for `REVIEW_ORDER_DWELL_MS`,
   * giving the player time to read the order even if they never close the
   * board; an early close still advances it sooner via the ordinary
   * `review-order` UI event. Store-side by design - scenes stay logic-free.
   */
  autoAdvanceOnboarding(): void {
    const step = this.currentOnboardingStep();
    if (step?.id !== 'review-order') return;
    if (now() - this.stepEnteredAt < REVIEW_ORDER_DWELL_MS) return;
    this.advanceOnboardingStep();
    this.save();
  }

  /**
   * UI-driven onboarding events (seed selection, opening the order board).
   * Safe to call every refresh tick: it saves only when the event actually
   * advanced the chain, and is a cheap no-op otherwise.
   */
  notifyOnboardingUiEvent(eventId: OnboardingUiEventId): void {
    if (this.trackOnboarding(eventId)) this.save();
  }

  /**
   * Reconcile growing plots whose `plantedAt` is in the future of the real
   * clock (a warped/skewed clock, or a player winding their device clock
   * back) - such a plot would otherwise freeze at stage 0 until wall time
   * catches up. Uses `Date.now()` deliberately, not the warpable `now()` -
   * at load time the in-memory warp offset is always zero, and the point is
   * to reconcile against reality. Growth restarts from now for any clamped
   * plot; the warped "progress" is lost, but the plot can never freeze again.
   *
   * Milling batches (T4.2a) get the identical treatment: a batch whose
   * `startedAt` is in the future would never come ready, so it restarts from
   * now for the same reason and by the same rule.
   */
  private clampFuturePlantedAt(): void {
    const nowMs = Date.now();
    let clampedCount = 0;
    for (const plot of this.state.plots) {
      if (plot.state === 'growing' && plot.plantedAt > nowMs) {
        plot.plantedAt = nowMs;
        clampedCount++;
      }
    }
    for (const placement of this.state.buildings) {
      for (const batch of placement.batches) {
        if (batch.startedAt > nowMs) {
          batch.startedAt = nowMs;
          clampedCount++;
        }
      }
    }
    if (clampedCount > 0) {
      console.info(`littleacres: clamped ${clampedCount} future timestamps`);
    }
  }

  /**
   * Load from storage. A missing save means a fresh install and yields a
   * default state. A corrupt, invalid, or unmigratable save is NEVER
   * destroyed (T3.17): the raw string is stashed to RECOVERY_KEY first, then
   * the last-known-good BACKUP_KEY (refreshed on every successful load) is
   * tried; only if that also fails does the game reset. Never throws.
   */
  load(): void {
    this.levelUpQueue = [];
    this.radiantQueue = [];
    this.chestQueue = [];
    this.weeklyNoticeQueue = [];
    this.plotGrantQueue = [];
    this.tutorialCompletePending = false;
    this.offlineSummary = null;
    let raw: string | null;
    try {
      raw = this.storage?.getItem(SAVE_KEY) ?? null;
    } catch {
      raw = null;
    }
    if (raw === null) {
      this.state = createDefaultState(this.currentVersion);
      this.stepEnteredAt = now();
      return;
    }
    const restored = this.parseAndMigrate(raw);
    if (restored !== null) {
      this.state = restored;
      this.writeBackup();
      this.finishLoad();
      return;
    }
    // The save failed to parse/migrate/validate. Stash it BEFORE anything
    // overwrites SAVE_KEY, so the player's data is never destroyed outright.
    try {
      this.storage?.setItem(RECOVERY_KEY, raw);
    } catch {
      // Best effort - a full/unavailable storage must not block recovery.
    }
    const backup = this.readBackup();
    if (backup !== null) {
      console.warn(
        'littleacres: save was corrupt or invalid; recovered from the last good backup ' +
          `(original save preserved under ${RECOVERY_KEY})`,
      );
      this.state = backup;
      this.save();
      this.finishLoad();
      return;
    }
    console.warn('littleacres: save was corrupt or invalid, starting fresh');
    this.reset();
  }

  /**
   * Post-load pipeline shared by the normal and backup-recovery paths, so a
   * recovered state gets clamping, offline summary, level reconcile, and
   * weekly rollover identically to a normal load.
   */
  private finishLoad(): void {
    this.clampFuturePlantedAt();
    this.offlineSummary = this.computeOfflineSummary();
    this.reconcileLevelSilently();
    this.ensureWeeklyQuests();
    this.stepEnteredAt = now();
  }

  /** Refresh BACKUP_KEY with the current (just-loaded, migrated) state. Never fatal. */
  private writeBackup(): void {
    if (this.storage === null) return;
    try {
      this.storage.setItem(BACKUP_KEY, JSON.stringify(this.state));
    } catch {
      console.warn('littleacres: backup save write failed (storage unavailable or full)');
    }
  }

  /** BACKUP_KEY parsed, migrated, and validated - null if missing or invalid. */
  private readBackup(): GameStateData | null {
    let raw: string | null;
    try {
      raw = this.storage?.getItem(BACKUP_KEY) ?? null;
    } catch {
      return null;
    }
    return raw === null ? null : this.parseAndMigrate(raw);
  }

  /**
   * Parse a save string, migrate it to the current version, and validate it.
   * Returns null on any failure (bad JSON, bad shape, migration throw).
   */
  private parseAndMigrate(json: string): GameStateData | null {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!isRecord(parsed)) return null;
      const version = parsed.version;
      if (!Number.isInteger(version) || typeof version !== 'number') return null;
      if (version < 1 || version > this.currentVersion) return null;
      // Migrations from `version` up to the current one, applied in order.
      const migrated = this.migrations
        .slice(version - 1)
        .reduce<Record<string, unknown>>(
          (acc, migrate, i) => ({ ...migrate(acc, this.rng), version: version + i + 1 }),
          parsed,
        );
      return isValidState(migrated, this.currentVersion) ? migrated : null;
    } catch {
      return null;
    }
  }

  /**
   * Persist to storage. A failed save never crashes the game. An in-memory
   * state that fails validation is warned about but STILL persisted (T3.17) -
   * blocking the write would silently lose progress, and the load-time
   * backup/recovery path is the safety net for an invalid save.
   */
  save(): boolean {
    if (this.storage === null) return false;
    this.state.lastSavedAt = Date.now();
    if (!isValidState(this.state, this.currentVersion)) {
      console.warn('littleacres: persisting a state that fails validation');
    }
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.state));
      return true;
    } catch {
      console.warn('littleacres: save failed (storage unavailable or full)');
      return false;
    }
  }

  /**
   * Discard the current state for a fresh default one, and persist it. Only
   * SAVE_KEY is written - BACKUP_KEY and RECOVERY_KEY are deliberately left
   * untouched (T3.17), so a stashed invalid save survives the reset.
   */
  reset(): void {
    this.levelUpQueue = [];
    this.radiantQueue = [];
    this.chestQueue = [];
    this.weeklyNoticeQueue = [];
    this.plotGrantQueue = [];
    this.tutorialCompletePending = false;
    this.offlineSummary = null;
    this.state = createDefaultState(this.currentVersion);
    this.stepEnteredAt = now();
    this.save();
  }

  /** Debug: the current state as a JSON string. */
  exportSave(): string {
    return JSON.stringify(this.state);
  }

  /**
   * Debug: parse, migrate, and validate a JSON save string; on success apply
   * and persist it. On failure the current state is left untouched.
   */
  importSave(json: string): boolean {
    const restored = this.parseAndMigrate(json);
    if (restored === null) {
      console.warn('littleacres: importSave rejected an invalid save string');
      return false;
    }
    this.levelUpQueue = [];
    this.radiantQueue = [];
    this.chestQueue = [];
    this.weeklyNoticeQueue = [];
    this.plotGrantQueue = [];
    this.tutorialCompletePending = false;
    this.offlineSummary = null;
    this.state = restored;
    this.clampFuturePlantedAt();
    this.reconcileLevelSilently();
    this.stepEnteredAt = now();
    this.save();
    return true;
  }

  /** Autosave on a wall-clock interval and when the tab is hidden. */
  startAutosave(): void {
    if (typeof window === 'undefined' || this.autosaveTimer !== null) return;
    this.autosaveTimer = window.setInterval(() => this.save(), AUTOSAVE_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  stopAutosave(): void {
    if (typeof window === 'undefined' || this.autosaveTimer === null) return;
    window.clearInterval(this.autosaveTimer);
    this.autosaveTimer = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  /**
   * Backgrounding path (T3.20a): stamp the real-clock moment the app went
   * hidden into `hiddenAt`, immune to the autosave interval's later
   * re-stamps of `lastSavedAt` (browsers throttle but do not stop
   * `setInterval` in a backgrounded tab). `atMs` is injectable for tests,
   * same spirit as the store's `rng`/`storage`; production always calls this
   * with no argument.
   */
  handleBackgrounded(atMs: number = Date.now()): void {
    this.hiddenAt = atMs;
    this.save();
  }

  /**
   * Foreground-resume path (T3.20/T3.20a): a still-alive PWA returning from
   * the background gets the same "while you were away" + weekly rollover
   * treatment as a fresh load, without needing a reload. If nothing was
   * recorded as backgrounded (e.g. this fires right after boot, with no
   * prior `handleBackgrounded()`), there is no gap to measure - just roll
   * the week and return. Otherwise, order is still load-bearing - compute
   * the offline summary FIRST, against `hiddenAt`, THEN clear `hiddenAt` and
   * roll the week: `computeOfflineSummary` must run while `hiddenAt` still
   * holds the real backgrounding moment, before this method's own cleanup
   * (or `ensureWeeklyQuests`'s rollover save) touches anything else. Never
   * clobbers an already-pending summary (e.g. queued by load()) with a null
   * result.
   */
  handleForegroundReturn(): void {
    if (this.hiddenAt === null) {
      this.ensureWeeklyQuests();
      return;
    }
    const summary = this.computeOfflineSummary(this.hiddenAt);
    if (summary !== null) this.offlineSummary = summary;
    this.hiddenAt = null;
    this.ensureWeeklyQuests();
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.handleBackgrounded();
    } else {
      this.handleForegroundReturn();
    }
  };
}

/** The one store instance the game uses. */
export const gameState = new GameStateStore();
