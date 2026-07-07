import { CROPS, type CropId } from '../data/crops';
import { FARM_COLS, FARM_ROWS } from '../data/farm';

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

/**
 * Discriminated union over `state`. Today only `empty` exists; a future
 * `growing` variant will carry `cropId` and a `plantedAt` timestamp.
 */
export type PlotState = EmptyPlot;

export interface GameSettings {
  musicOn: boolean;
  sfxOn: boolean;
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

/** The real migration list. Empty while the schema is at version 1. */
export const MIGRATIONS: readonly Migration[] = [];

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
  return isRecord(value) && value.state === 'empty';
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

  /**
   * Load from storage. A missing save means a fresh install and yields a
   * default state; a corrupt, invalid, or unmigratable save logs a warning
   * and resets cleanly. Never throws.
   */
  load(): void {
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
    this.state = restored;
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
