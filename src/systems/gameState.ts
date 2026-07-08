import { CROPS, type CropId } from '../data/crops';
import { FARM_COLS, FARM_ROWS } from '../data/farm';
import { levelForXp } from '../data/levels';
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

export interface GameSettings {
  musicOn: boolean;
  sfxOn: boolean;
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

/** The real migration list. */
export const MIGRATIONS: readonly Migration[] = [v1ToV2];

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
    settings: { musicOn: true, sfxOn: true },
    createdAt: now,
    lastSavedAt: now,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
}

export class GameStateStore {
  private state: GameStateData;
  private readonly storage: SaveStorage | null;
  private readonly migrations: readonly Migration[];
  private autosaveTimer: number | null = null;
  /** Pending level-ups for the scene to celebrate. Transient - never saved. */
  private levelUpQueue: LevelUpEvent[] = [];

  constructor(options: GameStateStoreOptions = {}) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.migrations = options.migrations ?? MIGRATIONS;
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
    this.save();
    return gained;
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
