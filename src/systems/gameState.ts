import { DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME } from '../data/audio';
import { CROPS, type CropId } from '../data/crops';
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
  SKIP_COOLDOWN_BASE_MS,
  SKIP_COOLDOWN_GROWTH,
  SKIP_COOLDOWN_MAX_MS,
  SKIP_STREAK_RESET_MS,
  TEASER_CHANCE,
} from '../data/orders';
import { isReady } from './growth';
import { now } from './time';

/**
 * Game state store: one serializable plain object (no classes, no Phaser
 * refs) persisted to localStorage with versioned migrations. Scenes render
 * from this state and never own it.
 */

/** localStorage key. Stable for the life of the project. */
export const SAVE_KEY = 'littleacres:save';

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

export interface GameSettings {
  musicOn: boolean;
  sfxOn: boolean;
  /** Music channel volume, 0..1. */
  musicVolume: number;
  /** Sound-effects channel volume, 0..1. */
  sfxVolume: number;
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
 * first six mirror the store mutators; the last three are the UI queries
 * (SeedBar seed taps, the HUD's Orders/Bag buttons) so their gating shares
 * the exact same rules instead of duplicating them.
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
  | 'bag-button';

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
  onboarding: OnboardingState;
  settings: GameSettings;
  createdAt: number;
  lastSavedAt: number;
}

/**
 * A migration takes a raw save object at version N and returns it at version
 * N+1. `MIGRATIONS[i]` migrates version i+1 to i+2, so the current schema
 * version is always `migrations.length + 1`.
 */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

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
    onboarding: { completed: false, step: 0, progress: 0, progressB: 0 },
    settings: {
      musicOn: true,
      sfxOn: true,
      musicVolume: DEFAULT_MUSIC_VOLUME,
      sfxVolume: DEFAULT_SFX_VOLUME,
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

function isOrder(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.length >= 1 &&
    value.items.length <= 2 &&
    value.items.every(isOrderItem) &&
    isFiniteNumber(value.coinReward) &&
    isFiniteNumber(value.xpReward)
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
    isOnboardingState(raw.onboarding) &&
    isRecord(raw.settings) &&
    typeof raw.settings.musicOn === 'boolean' &&
    typeof raw.settings.sfxOn === 'boolean' &&
    isVolume(raw.settings.musicVolume) &&
    isVolume(raw.settings.sfxVolume) &&
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
   * Bring the order board up to date: fill every pending slot with a freshly
   * generated order and reopen cooldown slots whose readyAt has passed.
   * Called on scene create and on the scene's refresh tick - idempotent, and
   * a cheap no-op (no save) when nothing needs generating.
   */
  ensureOrders(): void {
    let changed = false;
    const nowMs = now();
    // No stretch (teaser) orders while the tutorial is running - the first
    // session must never see a request it cannot fulfill.
    const teaserChance = this.state.onboarding.completed ? TEASER_CHANCE : 0;
    for (let i = 0; i < this.state.orders.length; i++) {
      const slot = this.state.orders[i]!;
      if (slot.state === 'pending' || (slot.state === 'cooldown' && slot.readyAt <= nowMs)) {
        this.state.orders[i] = {
          state: 'open',
          order: generateOrder(this.state.level, this.rng, teaserChance),
        };
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /**
   * Fulfill an open order: every requested item leaves the inventory, coins
   * gain the order's stored coinReward, xp gains its stored xpReward through
   * the applyXp choke point (so level-ups ride the celebration queue), and
   * the slot returns to pending for the next `ensureOrders` to refill.
   * Returns false without mutating anything if the slot is not open, the
   * inventory does not cover every item, or the tutorial rails are not on
   * the deliver step (which permits only slot 0 - the scripted ORDER A).
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
    this.state.orders[slotIndex] = { state: 'pending' };
    // During the tutorial the rails guarantee this is the scripted slot-0
    // delivery, so the track always matches; post-tutorial it is a no-op.
    this.trackOnboarding('deliver-sunwheat');
    this.save();
    return true;
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
        // No sell/bag steps remain, and skipping or expanding is never a
        // tutorial action.
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
   * default state; a corrupt, invalid, or unmigratable save logs a warning
   * and resets cleanly. Never throws.
   */
  load(): void {
    this.levelUpQueue = [];
    this.radiantQueue = [];
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
    if (restored === null) {
      console.warn('littleacres: save was corrupt or invalid, starting fresh');
      this.reset();
      return;
    }
    this.state = restored;
    this.clampFuturePlantedAt();
    this.offlineSummary = this.computeOfflineSummary();
    this.reconcileLevelSilently();
    this.stepEnteredAt = now();
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
          (acc, migrate, i) => ({ ...migrate(acc), version: version + i + 1 }),
          parsed,
        );
      return isValidState(migrated, this.currentVersion) ? migrated : null;
    } catch {
      return null;
    }
  }

  /** Persist to storage. A failed save never crashes the game. */
  save(): boolean {
    if (this.storage === null) return false;
    this.state.lastSavedAt = Date.now();
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.state));
      return true;
    } catch {
      console.warn('littleacres: save failed (storage unavailable or full)');
      return false;
    }
  }

  /** Discard the current state for a fresh default one, and persist it. */
  reset(): void {
    this.levelUpQueue = [];
    this.radiantQueue = [];
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
    if (document.hidden) this.save();
  };
}

/** The one store instance the game uses. */
export const gameState = new GameStateStore();
