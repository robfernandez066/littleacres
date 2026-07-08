import { CROPS, type CropId } from '../data/crops';
import { FARM_COLS, FARM_ROWS } from '../data/farm';
import { levelForXp } from '../data/levels';
import {
  ONBOARDING_ORDER_A,
  ONBOARDING_ORDER_B,
  ONBOARDING_STEPS,
  type OnboardingStep,
  type OnboardingStepId,
  type OnboardingUiEventId,
} from '../data/onboarding';
import {
  generateOrder,
  type Order,
  ORDER_SLOTS,
  SKIP_COOLDOWN_MS,
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

export const PLOT_COUNT = FARM_COLS * FARM_ROWS;

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
}

/**
 * First-session tutorial progress. `step` indexes ONBOARDING_STEPS and
 * `progress` counts matching actions within the current step (reset to 0 on
 * every advance). `progressB` is the second counter for the dual-goal
 * plant-mixed step (progress = sunwheat, progressB = carrots); 0 everywhere
 * else. Once `completed` is true it never flips back.
 */
export interface OnboardingState {
  completed: boolean;
  step: number;
  progress: number;
  progressB: number;
}

/** One level gained, and any crops newly unlocked at exactly that level. */
export interface LevelUpEvent {
  level: number;
  unlockedCropIds: CropId[];
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

/** The real migration list. */
export const MIGRATIONS: readonly Migration[] = [v1ToV2, v2ToV3, v3ToV4, v4ToV5];

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
    onboarding: { completed: false, step: 0, progress: 0, progressB: 0 },
    settings: { musicOn: true, sfxOn: true },
    createdAt: now,
    lastSavedAt: now,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
    raw.plots.length === PLOT_COUNT &&
    raw.plots.every(isPlotState) &&
    isCropCountMap(raw.inventory) &&
    isCropCountMap(raw.seeds) &&
    isFiniteNumber(raw.moondust) &&
    Array.isArray(raw.orders) &&
    raw.orders.length === ORDER_SLOTS &&
    raw.orders.every(isOrderSlot) &&
    isOnboardingState(raw.onboarding) &&
    isRecord(raw.settings) &&
    typeof raw.settings.musicOn === 'boolean' &&
    typeof raw.settings.sfxOn === 'boolean' &&
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

  constructor(options: GameStateStoreOptions = {}) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.migrations = options.migrations ?? MIGRATIONS;
    this.rng = options.rng ?? Math.random;
    this.state = createDefaultState(this.currentVersion);
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

  /**
   * Plant a crop on an empty plot, spending its seed cost from coins (the
   * `seeds` field stays reserved in MVP). Returns false without mutating
   * anything if the index is out of range, the plot is occupied, the crop is
   * unknown, the crop is not unlocked yet, or coins are insufficient.
   */
  plantCrop(plotIndex: number, cropId: CropId): boolean {
    const plot = this.state.plots[plotIndex];
    if (plot === undefined || plot.state !== 'empty') return false;
    // cropId is typed, but console/dev calls can pass arbitrary strings.
    if (!((cropId as string) in CROPS)) return false;
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
   * without mutating anything if the plot is not growing or not ready yet.
   */
  harvestPlot(plotIndex: number): boolean {
    const plot = this.state.plots[plotIndex];
    if (plot === undefined || plot.state !== 'growing') return false;
    if (!isReady(plot, now())) return false;
    this.state.plots[plotIndex] = { state: 'empty' };
    this.state.inventory[plot.cropId] = (this.state.inventory[plot.cropId] ?? 0) + 1;
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
   * Sell the entire stack of one crop: coins gain count * sellValue, the
   * stack empties, and the change persists. Returns the coins gained (0
   * without mutating anything if the stack is already empty).
   */
  sellCrop(cropId: CropId): number {
    const count = this.state.inventory[cropId] ?? 0;
    if (count <= 0) return 0;
    const gained = count * CROPS[cropId].sellValue;
    this.state.coins += gained;
    this.state.inventory[cropId] = 0;
    // A sunwheat sale is the sell-rest step's action; a no-op otherwise.
    if (cropId === 'sunwheat') this.trackOnboarding('sell-rest');
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
   * Returns false without mutating anything if the slot is not open or the
   * inventory does not cover every item.
   */
  fulfillOrder(slotIndex: number): boolean {
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
    // Any successful delivery during the deliver step counts - the mechanic
    // is learned even if the player fulfills a non-scripted order.
    this.trackOnboarding('deliver-sunwheat');
    this.save();
    return true;
  }

  /**
   * Skip an open order: the slot goes on cooldown until now() +
   * SKIP_COOLDOWN_MS, when `ensureOrders` will refill it. Returns false
   * without mutating anything if the slot is not open.
   */
  skipOrder(slotIndex: number): boolean {
    const slot = this.state.orders[slotIndex];
    if (slot === undefined || slot.state !== 'open') return false;
    this.state.orders[slotIndex] = { state: 'cooldown', readyAt: now() + SKIP_COOLDOWN_MS };
    this.save();
    return true;
  }

  /** The active onboarding step, or null once completed. */
  private currentOnboardingStep(): OnboardingStep | null {
    if (this.state.onboarding.completed) return null;
    return ONBOARDING_STEPS[this.state.onboarding.step] ?? null;
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
   * (progress = sunwheat / goal, progressB = carrots / goalB) and advances
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
    } else if (cropId === 'carrot' && onboarding.progressB < goalB) {
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
   * leaving it (entering `close-orders`, which only fulfillment can do)
   * replaces the just-vacated slot 0 with ORDER B, so the board immediately
   * shows what the plant-mixed step grows toward. Passing the last step sets
   * `completed` - permanently: every entry point checks `completed` first,
   * so nothing ever tracks again.
   */
  private advanceOnboardingStep(): void {
    const onboarding = this.state.onboarding;
    onboarding.step++;
    onboarding.progress = 0;
    onboarding.progressB = 0;
    if (onboarding.step >= ONBOARDING_STEPS.length) {
      onboarding.completed = true;
      return;
    }
    const enteredId = ONBOARDING_STEPS[onboarding.step]?.id;
    if (enteredId === 'deliver-sunwheat') {
      this.state.orders[0] = { state: 'open', order: cloneOrder(ONBOARDING_ORDER_A) };
    } else if (enteredId === 'close-orders') {
      this.state.orders[0] = { state: 'open', order: cloneOrder(ONBOARDING_ORDER_B) };
    }
  }

  /**
   * Anti-stuck guard, called on the scene's refresh tick: if sell-rest is
   * active but no sunwheat is left to sell (it was all delivered some other
   * way), the step self-advances so the tutorial can never park on an
   * impossible instruction. Store-side by design - scenes stay logic-free.
   */
  autoAdvanceOnboarding(): void {
    const step = this.currentOnboardingStep();
    if (step?.id !== 'sell-rest') return;
    if ((this.state.inventory.sunwheat ?? 0) > 0) return;
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
   * Load from storage. A missing save means a fresh install and yields a
   * default state; a corrupt, invalid, or unmigratable save logs a warning
   * and resets cleanly. Never throws.
   */
  load(): void {
    this.levelUpQueue = [];
    let raw: string | null;
    try {
      raw = this.storage?.getItem(SAVE_KEY) ?? null;
    } catch {
      raw = null;
    }
    if (raw === null) {
      this.state = createDefaultState(this.currentVersion);
      return;
    }
    const restored = this.parseAndMigrate(raw);
    if (restored === null) {
      console.warn('littleacres: save was corrupt or invalid, starting fresh');
      this.reset();
      return;
    }
    this.state = restored;
    this.reconcileLevelSilently();
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
    this.state = createDefaultState(this.currentVersion);
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
    this.state = restored;
    this.reconcileLevelSilently();
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
