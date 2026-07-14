import { DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME } from '../data/audio';
import {
  CHEST_COINS_MAX,
  CHEST_COINS_MIN,
  CHEST_MOONDUST_AMOUNT,
  CHEST_MOONDUST_CHANCE,
} from '../data/chests';
import { CROPS, type CropId } from '../data/crops';
import {
  DECOR_FRAMES,
  DECOR_SCALE_MAX,
  DECOR_SCALE_MIN,
  DECOR_SPAWN_SCALE,
  DECOR_X_MAX,
  DECOR_X_MIN,
  DECOR_Y_MAX,
  DECOR_Y_MIN,
  DECOR_ITEMS,
  MAX_DECORATIONS,
  purchasableOwnedCount,
  WAREHOUSE_PLACE_X,
  WAREHOUSE_PLACE_Y,
} from '../data/decor';
import { BASE_PLOT_COUNT, EXPANDED_PLOT_COUNT, EXPANSION_COST } from '../data/farm';
import { levelForXp } from '../data/levels';
import {
  MOONDUST_PER_LEVEL,
  RADIANT_CHANCE,
  RADIANT_MOONDUST_CHANCE,
  RADIANT_YIELD_MULT,
} from '../data/moondust';
import { OFFLINE_SUMMARY_MIN_MS } from '../data/offline';
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
}

export interface GrowingPlot {
  state: 'growing';
  cropId: CropId;
  /** Game-clock timestamp (see systems/time.ts) when the crop was planted. */
  plantedAt: number;
}

/**
 * Discriminated union over `state`. Only `empty` and `growing` are ever
 * stored - "ready" is derived from `plantedAt + growMs`, never saved, so
 * offline growth is free and cannot desync.
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
  inventory: Partial<Record<CropId, number>>;
  seeds: Partial<Record<CropId, number>>;
  /** Reserved currency slot; nothing earns or spends it yet. */
  moondust: number;
  /** The order board, always exactly ORDER_SLOTS entries. */
  orders: OrderSlot[];
  /** Skip-cooldown escalation streak (see `skipOrder`). */
  orderSkips: OrderSkipsState;
  /** Placed decorations (T3.9); purchasable placed+warehoused <= MAX_DECORATIONS, trophies exempt (T3.17). */
  decorations: DecorationPlacement[];
  /**
   * Owned-but-unplaced decorations (T3.9b): frame -> count. A purchase always
   * lands here first (`buyDecoration`); `placeFromWarehouse`/`storeDecoration`
   * move one unit between here and `decorations`. Keys are removed once their
   * count reaches 0, never left at 0 (see `placeFromWarehouse`).
   */
  warehouse: Record<string, number>;
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
];

export function createDefaultState(version: number): GameStateData {
  const now = Date.now();
  return {
    version,
    coins: 50,
    xp: 0,
    level: 1,
    plots: Array.from({ length: PLOT_COUNT }, (): PlotState => ({ state: 'empty' })),
    inventory: {},
    seeds: {},
    moondust: 0,
    orders: createPendingOrderSlots(),
    orderSkips: { count: 0, lastAt: 0 },
    decorations: [],
    warehouse: {},
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A channel volume: a finite number within 0..1. */
function isVolume(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isPlotState(value: unknown): value is PlotState {
  if (!isRecord(value)) return false;
  if (value.state === 'empty') return true;
  return (
    value.state === 'growing' &&
    typeof value.cropId === 'string' &&
    value.cropId in CROPS &&
    isFiniteNumber(value.plantedAt)
  );
}

/** Crop-keyed count map, e.g. inventory and seeds. */
function isCropCountMap(value: unknown): value is Partial<Record<CropId, number>> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, count]) => key in CROPS && isFiniteNumber(count))
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
    (raw.plots.length === BASE_PLOT_COUNT || raw.plots.length === EXPANDED_PLOT_COUNT) &&
    raw.plots.every(isPlotState) &&
    isCropCountMap(raw.inventory) &&
    isCropCountMap(raw.seeds) &&
    isFiniteNumber(raw.moondust) &&
    Array.isArray(raw.orders) &&
    raw.orders.length === ORDER_SLOTS &&
    raw.orders.every(isOrderSlot) &&
    isOrderSkipsState(raw.orderSkips) &&
    isWarehouseRecord(raw.warehouse) &&
    Array.isArray(raw.decorations) &&
    raw.decorations.every(isDecorationPlacement) &&
    // Entries are shape-proven above, so their frames are safe to read here.
    // Purchasable only - trophy frames are exempt from the cap (T3.17).
    purchasableOwnedCount(raw.decorations, raw.warehouse) <= MAX_DECORATIONS &&
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

  /** Drain and return the pending offline summary (or null); the scene checks this once after `load()`. */
  consumeOfflineSummary(): OfflineSummary | null {
    const summary = this.offlineSummary;
    this.offlineSummary = null;
    return summary;
  }

  /**
   * Compute the "while you were away" summary from the just-restored state,
   * before anything else touches it - `lastSavedAt` is still the real-clock
   * end of the last session. Null when away under OFFLINE_SUMMARY_MIN_MS,
   * nothing matured in the gap, or onboarding has not completed (a
   * mid-tutorial return must not get a panel over the guide). Uses the real
   * clock on both sides, deliberately not `now()` (the game clock, which the
   * dev overlay can warp) - a session gap is measured in wall-clock time.
   */
  private computeOfflineSummary(): OfflineSummary | null {
    if (!this.state.onboarding.completed) return null;
    const nowMs = Date.now();
    const elapsedMs = nowMs - this.state.lastSavedAt;
    if (elapsedMs < OFFLINE_SUMMARY_MIN_MS) return null;
    const readyCounts: Partial<Record<CropId, number>> = {};
    for (const plot of this.state.plots) {
      if (plot.state !== 'growing') continue;
      const readyAt = plot.plantedAt + CROPS[plot.cropId].growMs;
      if (readyAt > this.state.lastSavedAt && readyAt <= nowMs) {
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
    this.state.plots[plotIndex] = { state: 'growing', cropId, plantedAt: now() };
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
    this.state.plots[plotIndex] = { state: 'empty' };
    // Radiant is a rare bonus-yield proc, suppressed during the tutorial so
    // its scripted economy stays deterministic.
    const isRadiant = this.state.onboarding.completed && this.rng() < RADIANT_CHANCE;
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
      this.state.coins -= CROPS[entry.cropId].seedCost;
      this.state.plots[entry.plotIndex] = {
        state: 'growing',
        cropId: entry.cropId,
        plantedAt: now(),
      };
    }
    this.save();
    return plantable.length;
  }

  /**
   * Purchase the one-time farm expansion (base 12 plots -> 16). Returns
   * false without mutating anything unless the farm is still at
   * BASE_PLOT_COUNT and coins cover EXPANSION_COST - in particular, a second
   * expansion always fails since plots.length no longer matches. Rejected
   * during the tutorial (belt-and-braces; the sign is already hidden then).
   */
  expandFarm(): boolean {
    if (!this.railsAllow('expand')) return false;
    if (this.state.plots.length !== BASE_PLOT_COUNT) return false;
    if (this.state.coins < EXPANSION_COST) return false;
    this.state.coins -= EXPANSION_COST;
    for (let i = BASE_PLOT_COUNT; i < EXPANDED_PLOT_COUNT; i++) {
      this.state.plots.push({ state: 'empty' });
    }
    this.save();
    return true;
  }

  /**
   * Owned purchasable decorations, placed + warehoused - the shared
   * MAX_DECORATIONS cap (T3.9b, purchasable-only since T3.17). Trophies do
   * not count, so they never consume shop capacity.
   */
  private purchasableOwnedDecorations(): number {
    return purchasableOwnedCount(this.state.decorations, this.state.warehouse);
  }

  /**
   * Purchase a decoration (T3.9, reworked into the warehouse in T3.9b):
   * deducts its price from the right currency and increments its warehouse
   * count - nothing is placed on the lawn. Returns false without mutating
   * anything if `itemFrame` is not a known `DECOR_ITEMS` frame, the combined
   * PURCHASABLE placed+warehoused count is already at MAX_DECORATIONS
   * (trophies exempt, T3.17), the balance is insufficient, or onboarding is
   * still active (the tutorial has no shop step).
   */
  buyDecoration(itemFrame: string): boolean {
    if (!this.railsAllow('decor-shop')) return false;
    const item = DECOR_ITEMS.find((candidate) => candidate.frame === itemFrame);
    if (item === undefined) return false;
    if (this.purchasableOwnedDecorations() >= MAX_DECORATIONS) return false;
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
   * center and its intended art size (WAREHOUSE_PLACE_X/Y, DECOR_SPAWN_SCALE)
   * so a placed item is immediately visible and ready to drag - grown or
   * shrunk from there via arrange mode. Decrements the warehouse count
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
      scale: DECOR_SPAWN_SCALE,
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
   * boolean; otherwise clamps x/y/scale to their legal ranges
   * (DECOR_X_MIN..MAX, DECOR_Y_MIN..MAX, DECOR_SCALE_MIN..MAX), applies
   * `flip` unclamped (a plain boolean), one save.
   */
  setDecorationTransform(
    index: number,
    x: number,
    y: number,
    scale: number,
    flip: boolean,
  ): boolean {
    const decoration = this.state.decorations[index];
    if (decoration === undefined) return false;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(scale)) return false;
    if (typeof flip !== 'boolean') return false;
    decoration.x = Math.min(DECOR_X_MAX, Math.max(DECOR_X_MIN, x));
    decoration.y = Math.min(DECOR_Y_MAX, Math.max(DECOR_Y_MIN, y));
    decoration.scale = Math.min(DECOR_SCALE_MAX, Math.max(DECOR_SCALE_MIN, scale));
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
   * tick, and visibility resume (`onVisibilityChange`), like `ensureOrders`;
   * idempotent, a cheap no-op (one clock compare) when the week hasn't
   * turned over.
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
   * MAX_DECORATIONS cap BY DEFINITION (T3.17), so the grant and save
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
    if (clampedCount > 0) {
      console.info(`littleacres: clamped ${clampedCount} future crop timestamps`);
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

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.save();
    } else {
      // A resumed PWA rolls the weekly rotation over immediately (T3.19)
      // rather than waiting for the scene's next tick.
      this.ensureWeeklyQuests();
    }
  };
}

/** The one store instance the game uses. */
export const gameState = new GameStateStore();
