import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FARMHOUSE_POSITION, NOTICE_BOARD_POSITION, STRUCTURE_DEFAULT_ANCHORS } from '../config';
import { CHEST_COINS_MAX, CHEST_COINS_MIN, CHEST_MOONDUST_AMOUNT } from '../data/chests';
import { type CropId, CROPS } from '../data/crops';
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
  REGIONS,
} from '../data/farm';
import { GOODS } from '../data/goods';
import { MAX_LEVEL, xpForLevel } from '../data/levels';
import {
  MOONDUST_PER_LEVEL,
  RADIANT_CHANCE,
  RADIANT_MOONDUST_CHANCE,
  RADIANT_YIELD_MULT,
} from '../data/moondust';
import { OFFLINE_SUMMARY_MIN_MS } from '../data/offline';
import {
  effectiveRadiantChance,
  HOMESTEAD_LUCK_MULT,
  RESTORE_FARMHOUSE_COST,
} from '../data/restoration';
import {
  ONBOARDING_ORDER_A,
  ONBOARDING_ORDER_B,
  ONBOARDING_STEPS,
  REVIEW_ORDER_DWELL_MS,
} from '../data/onboarding';
import {
  type Order,
  ORDER_SLOTS,
  SKIP_COOLDOWN_BASE_MS,
  SKIP_COOLDOWN_GROWTH,
  SKIP_COOLDOWN_MAX_MS,
  SKIP_STREAK_RESET_MS,
} from '../data/orders';
import {
  GROWTH_TARGETS_BY_LEVEL,
  growthTargetForLevel,
  LONG_QUESTS,
  WEEKLY_QUESTS,
  WEEK_MS,
} from '../data/quests';
import { DECOR_FRAMES, TROPHY_FRAMES, TROPHY_ITEMS } from '../data/decor';
import { BUILDINGS } from '../data/buildings';
import {
  BACKUP_KEY,
  bestBatchStartTile,
  buildingFootprintTiles,
  buildingRenderPosition,
  createDefaultState,
  type GameStateData,
  GameStateStore,
  isBuildingAnchorFree,
  isMillBatchReady,
  isPlotTileFree,
  isStructureAnchorFree,
  isValidState,
  millBatchReadyAt,
  MIGRATIONS,
  type Migration,
  nextChainPlotTile,
  placeablePlotTiles,
  type PlotState,
  PLOT_COUNT,
  RECOVERY_KEY,
  SAVE_KEY,
  type SaveStorage,
  structureFootprintTiles,
  structureRenderPosition,
  type StructuresState,
} from './gameState';
import { gridToIso, TILE_HEIGHT, TILE_WIDTH } from './iso';
import { advanceTime, getTimeOffsetMs, now } from './time';

/** In-memory Storage stand-in so tests never touch real localStorage. */
function makeStorage(initial: Record<string, string> = {}): SaveStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** Deterministic Math.random stand-in (32-bit LCG) for order generation. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Returns each given value in order, then repeats the last one forever. */
function stubRng(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

/**
 * The tile the historical index formula assigns plot `index` - exactly what
 * `createDefaultState` and the v15 -> v16 migration produce (T3.3a).
 */
function tileOf(index: number): { col: number; row: number } {
  return { col: index % FARM_COLS, row: Math.floor(index / FARM_COLS) };
}

/**
 * Flip a store's save to post-expansion in place (T3.3s-r1 tests): the
 * expand sign is gone, so its footprint tiles stop blocking. Direct state
 * mutation like `completeOnboarding` - buying the real expansion would also
 * grant plots, which these tests do not want.
 */
function markExpanded(store: GameStateStore): void {
  (store.getState() as GameStateData).expanded = true;
}

/** A fresh copy of the default structure anchors (T3.3s) for state slices. */
function defaultStructures(): StructuresState {
  return {
    farmhouse: { ...STRUCTURE_DEFAULT_ANCHORS.farmhouse },
    noticeBoard: { ...STRUCTURE_DEFAULT_ANCHORS.noticeBoard },
  };
}

/**
 * Mark a store's tutorial finished in place. Gameplay tests run
 * post-tutorial by default: the full rails would otherwise silently reject
 * any action the fresh save's current step does not call for.
 */
function completeOnboarding(store: GameStateStore): void {
  const onboarding = store.getState().onboarding;
  onboarding.completed = true;
  onboarding.step = ONBOARDING_STEPS.length;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  // The dev-clock offset is a module-level singleton (see systems/time.ts)
  // that would otherwise accumulate across tests via advanceTime() calls -
  // reset it so each test starts from a clean, real-time-aligned clock.
  advanceTime(-getTimeOffsetMs());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fresh default state', () => {
  it('creates a valid new-player state', () => {
    const store = new GameStateStore({ storage: null });
    const state = store.getState();
    expect(state.version).toBe(store.currentVersion);
    expect(state.coins).toBe(50);
    expect(state.xp).toBe(0);
    expect(state.level).toBe(1);
    expect(state.plots).toHaveLength(PLOT_COUNT);
    expect(state.plots.every((p) => p.state === 'empty')).toBe(true);
    expect(state.inventory).toEqual({});
    expect(state.seeds).toEqual({});
    expect(state.moondust).toBe(0);
    expect(state.orders).toEqual(Array.from({ length: ORDER_SLOTS }, () => ({ state: 'pending' })));
    expect(state.onboarding).toEqual({ completed: false, step: 0, progress: 0, progressB: 0 });
    expect(state.settings).toEqual({
      musicOn: true,
      sfxOn: true,
      musicVolume: 0.2,
      sfxVolume: 0.7,
      hapticsOn: true,
    });
    expect(state.createdAt).toBeLessThanOrEqual(Date.now());
    expect(state.lastSavedAt).toBeLessThanOrEqual(Date.now());
  });

  it('load with no existing save keeps a fresh state and does not warn', () => {
    const store = new GameStateStore({ storage: makeStorage() });
    store.load();
    expect(store.getState().coins).toBe(50);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('save and load', () => {
  it('round-trips state through storage', () => {
    const storage = makeStorage();
    const writer = new GameStateStore({ storage });
    writer.addCoins(25);
    expect(writer.save()).toBe(true);

    const reader = new GameStateStore({ storage });
    reader.load();
    expect(reader.getState()).toEqual(writer.getState());
    expect(reader.getState().coins).toBe(75);
  });

  it('save returns false without crashing when storage throws', () => {
    const storage = makeStorage();
    storage.setItem = () => {
      throw new Error('quota exceeded');
    };
    const store = new GameStateStore({ storage });
    expect(store.save()).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('settings (music/sfx/vibration toggles)', () => {
  it('setMusicOn(false) persists through a save/load round-trip', () => {
    const storage = makeStorage();
    const writer = new GameStateStore({ storage });
    writer.setMusicOn(false);

    const reader = new GameStateStore({ storage });
    reader.load();
    expect(reader.getState().settings).toEqual({
      musicOn: false,
      sfxOn: true,
      musicVolume: 0.2,
      sfxVolume: 0.7,
      hapticsOn: true,
    });
  });

  it('setSfxOn(false) persists through a save/load round-trip', () => {
    const storage = makeStorage();
    const writer = new GameStateStore({ storage });
    writer.setSfxOn(false);

    const reader = new GameStateStore({ storage });
    reader.load();
    expect(reader.getState().settings).toEqual({
      musicOn: true,
      sfxOn: false,
      musicVolume: 0.2,
      sfxVolume: 0.7,
      hapticsOn: true,
    });
  });

  it('setHapticsOn(false) persists through a save/load round-trip', () => {
    const storage = makeStorage();
    const writer = new GameStateStore({ storage });
    writer.setHapticsOn(false);

    const reader = new GameStateStore({ storage });
    reader.load();
    expect(reader.getState().settings).toEqual({
      musicOn: true,
      sfxOn: true,
      musicVolume: 0.2,
      sfxVolume: 0.7,
      hapticsOn: false,
    });
  });

  it('toggling back on persists too', () => {
    const storage = makeStorage();
    const writer = new GameStateStore({ storage });
    writer.setMusicOn(false);
    writer.setSfxOn(false);
    writer.setHapticsOn(false);
    writer.setMusicOn(true);
    writer.setSfxOn(true);
    writer.setHapticsOn(true);

    const reader = new GameStateStore({ storage });
    reader.load();
    expect(reader.getState().settings).toEqual({
      musicOn: true,
      sfxOn: true,
      musicVolume: 0.2,
      sfxVolume: 0.7,
      hapticsOn: true,
    });
  });

  it('setMusicVolume/setSfxVolume clamp to 0..1 and persist through a round-trip', () => {
    const storage = makeStorage();
    const writer = new GameStateStore({ storage });
    writer.setMusicVolume(0.55);
    writer.setSfxVolume(0.35);

    const reader = new GameStateStore({ storage });
    reader.load();
    expect(reader.getState().settings.musicVolume).toBe(0.55);
    expect(reader.getState().settings.sfxVolume).toBe(0.35);

    writer.setMusicVolume(1.5);
    writer.setSfxVolume(-0.2);
    expect(writer.getState().settings.musicVolume).toBe(1);
    expect(writer.getState().settings.sfxVolume).toBe(0);
  });

  it('volume setters ignore non-finite input instead of poisoning the save', () => {
    const store = new GameStateStore({ storage: makeStorage() });
    store.setMusicVolume(Number.NaN);
    store.setSfxVolume(Infinity);
    expect(store.getState().settings.musicVolume).toBe(0.2);
    expect(store.getState().settings.sfxVolume).toBe(0.7);
  });
});

describe('corrupt or invalid saves', () => {
  it('resets cleanly on unparseable JSON', () => {
    const storage = makeStorage({ [SAVE_KEY]: 'not json{{{' });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().coins).toBe(50);
    expect(console.warn).toHaveBeenCalled();
    // The junk was replaced with a valid save.
    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState()).toEqual(store.getState());
  });

  it('resets cleanly on a structurally invalid save', () => {
    const bad = { ...createDefaultState(1), coins: 'lots', plots: [] };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(bad) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().coins).toBe(50);
    expect(store.getState().plots).toHaveLength(PLOT_COUNT);
    expect(console.warn).toHaveBeenCalled();
  });

  it('resets cleanly on a save from the future (version too high)', () => {
    const future = { ...createDefaultState(1), version: 99 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(future) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(store.currentVersion);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('backup and recovery slots (T3.17)', () => {
  it('a successful load writes BACKUP_KEY, and its contents parse and validate at the current version', () => {
    const storage = makeStorage();
    const original = new GameStateStore({ storage });
    completeOnboarding(original);
    original.addCoins(123);
    original.save();

    const store = new GameStateStore({ storage });
    store.load();
    const backupRaw = storage.data.get(BACKUP_KEY);
    expect(backupRaw).toBeDefined();
    const backup = JSON.parse(backupRaw!) as GameStateData;
    expect(isValidState(backup, store.currentVersion)).toBe(true);
    expect(backup.coins).toBe(50 + 123);
  });

  it('recovers from BACKUP_KEY when SAVE_KEY is corrupt: backup state loads, SAVE_KEY is rewritten, RECOVERY_KEY stashes the original', () => {
    const storage = makeStorage();
    const original = new GameStateStore({ storage });
    completeOnboarding(original);
    original.addCoins(500);
    original.save();
    const warmup = new GameStateStore({ storage });
    warmup.load(); // a good load populates BACKUP_KEY
    expect(storage.data.has(BACKUP_KEY)).toBe(true);

    storage.data.set(SAVE_KEY, 'not json');
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().coins).toBe(50 + 500);
    expect(storage.data.get(RECOVERY_KEY)).toBe('not json');
    const rewritten = JSON.parse(storage.data.get(SAVE_KEY)!) as GameStateData;
    expect(rewritten.coins).toBe(50 + 500);
    expect(console.warn).toHaveBeenCalled();
  });

  it('double failure (corrupt save, invalid backup): fresh default state, RECOVERY_KEY still holds the corrupt string after the reset', () => {
    const storage = makeStorage({ [SAVE_KEY]: 'not json', [BACKUP_KEY]: 'also broken{{' });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().coins).toBe(50);
    expect(store.getState().plots).toHaveLength(PLOT_COUNT);
    // The reset overwrote SAVE_KEY with a fresh save but left the stash alone.
    expect(storage.data.get(RECOVERY_KEY)).toBe('not json');
    expect(JSON.parse(storage.data.get(SAVE_KEY)!)).toEqual(JSON.parse(store.exportSave()));
  });

  it('double failure with NO backup: fresh default state, RECOVERY_KEY still stashed', () => {
    const storage = makeStorage({ [SAVE_KEY]: 'not json' });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().coins).toBe(50);
    expect(storage.data.has(BACKUP_KEY)).toBe(false);
    expect(storage.data.get(RECOVERY_KEY)).toBe('not json');
  });
});

describe('migrations', () => {
  const v1toV2: Migration = (raw) => ({ ...raw, coins: (raw.coins as number) + 100 });

  it('runs pending migrations and bumps the version', () => {
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(createDefaultState(1)) });
    const store = new GameStateStore({ storage, migrations: [v1toV2] });
    expect(store.currentVersion).toBe(2);
    store.load();
    expect(store.getState().version).toBe(2);
    expect(store.getState().coins).toBe(150);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('skips migrations for a save already at the current version', () => {
    const spy = vi.fn(v1toV2);
    const saved = { ...createDefaultState(2), coins: 7 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, migrations: [spy] });
    store.load();
    expect(spy).not.toHaveBeenCalled();
    expect(store.getState().coins).toBe(7);
  });

  it('resets cleanly when a migration throws', () => {
    const broken: Migration = () => {
      throw new Error('boom');
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(createDefaultState(1)) });
    const store = new GameStateStore({ storage, migrations: [broken] });
    store.load();
    expect(store.getState().version).toBe(2);
    expect(store.getState().coins).toBe(50);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('real migrations (v1 moondust, v2 orders, v3 onboarding)', () => {
  const PENDING_SLOTS = Array.from({ length: ORDER_SLOTS }, () => ({ state: 'pending' }));

  it('migrates a v1 save through the whole chain to the current version', () => {
    // DELIBERATE RE-PIN (T4.2a): v23ToV24 (milling batches) appended, so the
    // chain is one longer and the current version is migrations.length + 1 = 24.
    expect(MIGRATIONS).toHaveLength(23);
    const { moondust, orders, onboarding, orderSkips, ...v1Save } = createDefaultState(1);
    void moondust;
    void orders;
    void onboarding;
    void orderSkips;
    const raw = { ...v1Save, coins: 250, xp: 42, level: 3 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(raw) });
    const store = new GameStateStore({ storage });
    store.load();
    const state = store.getState();
    expect(state.version).toBe(24);
    expect(state.moondust).toBe(0);
    expect(state.orders).toEqual(PENDING_SLOTS);
    // A level-3 veteran skips the tutorial permanently.
    expect(state.onboarding).toEqual({ completed: true, step: 0, progress: 0, progressB: 0 });
    expect(state.orderSkips).toEqual({ count: 0, lastAt: 0 });
    // Nothing else was lost in the migration.
    expect(state.coins).toBe(250);
    expect(state.xp).toBe(42);
    expect(state.level).toBe(3);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('migrates a v2 save (no orders) up with three pending slots', () => {
    const { orders, onboarding, orderSkips, ...v2Save } = createDefaultState(2);
    void orders;
    void onboarding;
    void orderSkips;
    const raw = { ...v2Save, coins: 99, moondust: 5 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(raw) });
    const store = new GameStateStore({ storage });
    store.load();
    const state = store.getState();
    expect(state.version).toBe(24);
    expect(state.orders).toEqual(PENDING_SLOTS);
    // The v1 -> v2 migration did not re-run: moondust kept its value.
    expect(state.moondust).toBe(5);
    expect(state.coins).toBe(99);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a fresh save is created at the current version with moondust 0 and three pending slots', () => {
    const store = new GameStateStore({ storage: null });
    expect(store.currentVersion).toBe(24);
    expect(store.getState().version).toBe(24);
    expect(store.getState().moondust).toBe(0);
    expect(store.getState().orders).toEqual(PENDING_SLOTS);
  });

  it('resets cleanly on a save with structurally invalid orders', () => {
    const bad = {
      ...createDefaultState(12),
      orders: [
        // An open order must request 1-2 items; an empty list is invalid.
        { state: 'open', order: { items: [], coinReward: 1, xpReward: 1 } },
        { state: 'pending' },
        { state: 'pending' },
      ],
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(bad) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().orders).toEqual(PENDING_SLOTS);
    expect(store.getState().coins).toBe(50);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('real migration v3 -> v4 (onboarding)', () => {
  /** A v3-shaped save (no onboarding field) with overrides. */
  function v3Save(overrides: Record<string, unknown>): string {
    const { onboarding, ...v3 } = createDefaultState(3);
    void onboarding;
    return JSON.stringify({ ...v3, ...overrides });
  }

  it('a fresh-looking v3 save (level 1, no xp) gets an active tutorial', () => {
    const storage = makeStorage({ [SAVE_KEY]: v3Save({}) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().onboarding).toEqual({
      completed: false,
      step: 0,
      progress: 0,
      progressB: 0,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('veteran v3 saves (level above 1, or any xp at all) skip the tutorial', () => {
    for (const overrides of [{ level: 3, xp: 42 }, { xp: 2 }]) {
      const storage = makeStorage({ [SAVE_KEY]: v3Save(overrides) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState().onboarding.completed).toBe(true);
    }
  });

  it('resets cleanly on structurally invalid onboarding', () => {
    const bad = {
      ...createDefaultState(12),
      onboarding: { completed: 'yes', step: 0, progress: 0, progressB: 0 },
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(bad) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().onboarding).toEqual({
      completed: false,
      step: 0,
      progress: 0,
      progressB: 0,
    });
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('real migration v4 -> v5 (onboarding progressB)', () => {
  it('adds progressB 0 while preserving the counters of a mid-tutorial save', () => {
    const v4 = createDefaultState(4) as unknown as Record<string, unknown>;
    v4.onboarding = { completed: false, step: 3, progress: 2 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(v4) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    // progressB arrives via v4 -> v5; the later v7 -> v8 rails migration then
    // marks this mid-chain save completed (its step indices are stale).
    expect(store.getState().onboarding).toEqual({
      completed: true,
      step: 3,
      progress: 2,
      progressB: 0,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('resets cleanly on a current-version save whose onboarding is missing progressB', () => {
    const bad = createDefaultState(12) as unknown as Record<string, unknown>;
    bad.onboarding = { completed: false, step: 0, progress: 0 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(bad) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().onboarding).toEqual({
      completed: false,
      step: 0,
      progress: 0,
      progressB: 0,
    });
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('real migration v5 -> v6 (channel volumes)', () => {
  /** A v5-shaped save: settings has only the on/off flags, no volumes. */
  function v5Save(settings: { musicOn: boolean; sfxOn: boolean }): string {
    const saved = createDefaultState(5) as unknown as Record<string, unknown>;
    saved.settings = settings;
    return JSON.stringify(saved);
  }

  it('existing saves get the new volume defaults (music 0.2, sfx 0.7)', () => {
    const storage = makeStorage({ [SAVE_KEY]: v5Save({ musicOn: true, sfxOn: true }) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().settings).toEqual({
      musicOn: true,
      sfxOn: true,
      musicVolume: 0.2,
      sfxVolume: 0.7,
      hapticsOn: true,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('preserves the on/off flags while adding the volumes', () => {
    const storage = makeStorage({ [SAVE_KEY]: v5Save({ musicOn: false, sfxOn: false }) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().settings).toEqual({
      musicOn: false,
      sfxOn: false,
      musicVolume: 0.2,
      sfxVolume: 0.7,
      hapticsOn: true,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('resets cleanly on out-of-range or non-numeric volumes', () => {
    for (const settings of [
      { musicOn: true, sfxOn: true, musicVolume: 1.5, sfxVolume: 0.7 },
      { musicOn: true, sfxOn: true, musicVolume: 0.2, sfxVolume: -0.1 },
      { musicOn: true, sfxOn: true, musicVolume: 'loud', sfxVolume: 0.7 },
      { musicOn: true, sfxOn: true, musicVolume: 0.2 }, // sfxVolume missing
    ]) {
      const bad = createDefaultState(12) as unknown as Record<string, unknown>;
      bad.settings = settings;
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(bad) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState().settings).toEqual({
        musicOn: true,
        sfxOn: true,
        musicVolume: 0.2,
        sfxVolume: 0.7,
        hapticsOn: true,
      });
      expect(console.warn).toHaveBeenCalled();
    }
  });
});

describe('real migration v6 -> v7 (carrot -> starcorn rename)', () => {
  /** A v6-shaped save speaking 'carrot' everywhere saves store crop ids. */
  function v6CarrotSave(): Record<string, unknown> {
    const saved = createDefaultState(12) as unknown as Record<string, unknown>;
    saved.version = 6;
    saved.coins = 77;
    saved.xp = 31;
    saved.level = 2;
    saved.inventory = { sunwheat: 3, carrot: 4 };
    saved.seeds = { carrot: 2 };
    const plots: Record<string, unknown>[] = Array.from({ length: PLOT_COUNT }, () => ({
      state: 'empty',
    }));
    plots[0] = { state: 'growing', cropId: 'carrot', plantedAt: 1_000 };
    plots[1] = { state: 'growing', cropId: 'sunwheat', plantedAt: 2_000 };
    saved.plots = plots;
    saved.orders = [
      {
        state: 'open',
        order: {
          items: [
            { cropId: 'carrot', count: 2 },
            { cropId: 'sunwheat', count: 1 },
          ],
          coinReward: 66,
          xpReward: 17,
        },
      },
      { state: 'cooldown', readyAt: 9_999 },
      { state: 'pending' },
    ];
    return saved;
  }

  it('renames carrot to starcorn in inventory, seeds, plots, and open orders - nothing else altered', () => {
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(v6CarrotSave()) });
    const store = new GameStateStore({ storage });
    store.load();
    const state = store.getState();
    expect(state.version).toBe(24);
    expect(state.inventory).toEqual({ sunwheat: 3, starcorn: 4 });
    expect(state.seeds).toEqual({ starcorn: 2 });
    expect(state.plots[0]).toEqual({
      state: 'growing',
      cropId: 'starcorn',
      plantedAt: 1_000,
      ...tileOf(0),
    });
    expect(state.plots[1]).toEqual({
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: 2_000,
      ...tileOf(1),
    });
    expect(state.orders[0]).toEqual({
      state: 'open',
      order: {
        items: [
          { cropId: 'starcorn', count: 2 },
          { cropId: 'sunwheat', count: 1 },
        ],
        coinReward: 66,
        xpReward: 17,
      },
    });
    expect(state.orders[1]).toEqual({ state: 'cooldown', readyAt: 9_999 });
    expect(state.orders[2]).toEqual({ state: 'pending' });
    expect(state.coins).toBe(77);
    expect(state.xp).toBe(31);
    expect(state.level).toBe(2);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a carrot-free v6 save migrates untouched apart from the version bump', () => {
    const saved = createDefaultState(12) as unknown as Record<string, unknown>;
    saved.version = 6;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().coins).toBe(50);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a current-version save still speaking carrot resets cleanly (validation, not migration)', () => {
    const bad = createDefaultState(12) as unknown as Record<string, unknown>;
    bad.inventory = { carrot: 3 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(bad) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().inventory).toEqual({});
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('real migration v7 -> v8 (tutorial redesign skips mid-chain saves)', () => {
  /** A v7-shaped save with a chosen onboarding record. */
  function v7Save(onboarding: Record<string, unknown>): string {
    const saved = createDefaultState(12) as unknown as Record<string, unknown>;
    saved.version = 7;
    saved.onboarding = onboarding;
    return JSON.stringify(saved);
  }

  function loadV7(onboarding: Record<string, unknown>): GameStateStore {
    const storage = makeStorage({ [SAVE_KEY]: v7Save(onboarding) });
    const store = new GameStateStore({ storage });
    store.load();
    return store;
  }

  it('a mid-chain save (step > 0) skips the redesigned tutorial permanently', () => {
    const store = loadV7({ completed: false, step: 5, progress: 1, progressB: 0 });
    expect(store.getState().version).toBe(24);
    expect(store.getState().onboarding).toEqual({
      completed: true,
      step: 5,
      progress: 1,
      progressB: 0,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a fresh step-0 save keeps its tutorial', () => {
    const store = loadV7({ completed: false, step: 0, progress: 0, progressB: 0 });
    expect(store.getState().onboarding).toEqual({
      completed: false,
      step: 0,
      progress: 0,
      progressB: 0,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a completed save passes through untouched', () => {
    const store = loadV7({ completed: true, step: 15, progress: 0, progressB: 0 });
    expect(store.getState().onboarding).toEqual({
      completed: true,
      step: 15,
      progress: 0,
      progressB: 0,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('real migration v8 -> v9 (skip-cooldown escalation streak)', () => {
  it('a v8 save (no orderSkips field) gains a zeroed streak and migrates through to current', () => {
    const saved = createDefaultState(12) as unknown as Record<string, unknown>;
    saved.version = 8;
    delete saved.orderSkips; // a genuine v8 save never had this field
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().orderSkips).toEqual({ count: 0, lastAt: 0 });
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('real migration v9 -> v10 (decorations + warehouse)', () => {
  it('a v9 save (no decorations/warehouse fields) gains both empty and migrates through to current', () => {
    const saved = createDefaultState(12) as unknown as Record<string, unknown>;
    saved.version = 9;
    delete saved.decorations; // a genuine v9 save never had this field
    delete saved.warehouse; // nor this one
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().decorations).toEqual([]);
    expect(store.getState().warehouse).toEqual({});
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('TROPHY_ITEMS data consistency (T3.18)', () => {
  it('has exactly 5 entries, each with a non-empty, distinct name', () => {
    expect(TROPHY_ITEMS).toHaveLength(5);
    for (const item of TROPHY_ITEMS) {
      expect(item.name.length).toBeGreaterThan(0);
    }
    expect(new Set(TROPHY_ITEMS.map((item) => item.name)).size).toBe(TROPHY_ITEMS.length);
  });

  it('TROPHY_FRAMES equals TROPHY_ITEMS frames, in order', () => {
    expect(TROPHY_FRAMES).toEqual(TROPHY_ITEMS.map((item) => item.frame));
  });

  it('every trophy frame is a legal decoration frame', () => {
    for (const item of TROPHY_ITEMS) {
      expect(DECOR_FRAMES.has(item.frame)).toBe(true);
    }
  });
});

describe('decorations and warehouse validation and round-trip', () => {
  it('accepts a save with placed decorations (incl. a trophy frame) and warehoused items, and it survives a reload', () => {
    const saved = createDefaultState(14);
    saved.decorations = [
      { frame: 'decor_bench', x: 200, y: 1440, scale: 0.55, flip: false },
      { frame: 'trophy_ancientoak', x: 500, y: 900, scale: 0.8, flip: true },
    ];
    saved.warehouse = { decor_fence: 2, decor_mushrooms: 1 };
    expect(isValidState(saved, 14)).toBe(true);

    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().decorations).toEqual(saved.decorations);
    expect(store.getState().warehouse).toEqual(saved.warehouse);
  });

  it('rejects an unknown frame, a malformed entry, or too many placed decorations', () => {
    const base = createDefaultState(12);
    const unknownFrame = { ...base, decorations: [{ frame: 'not_a_frame', x: 0, y: 0, scale: 1 }] };
    expect(isValidState(unknownFrame, 12)).toBe(false);

    const malformed = {
      ...base,
      decorations: [{ frame: 'decor_bench', x: 'far', y: 0, scale: 1 }],
    };
    expect(isValidState(malformed, 12)).toBe(false);

    const tooMany = {
      ...base,
      // flip present so this genuinely trips the cap check, which now runs
      // after the per-entry shape check (T3.17). 51 non-fence placements:
      // one over MAX_DECOR_ITEMS (T3.3a2).
      decorations: Array.from({ length: 51 }, () => ({
        frame: 'decor_bench',
        x: 0,
        y: 0,
        scale: 1,
        flip: false,
      })),
    };
    expect(isValidState(tooMany, 12)).toBe(false);
  });

  it('rejects a warehouse with an unknown frame, a non-positive/non-integer count, or a malformed record', () => {
    const base = createDefaultState(12);
    expect(isValidState({ ...base, warehouse: { not_a_frame: 1 } }, 12)).toBe(false);
    expect(isValidState({ ...base, warehouse: { decor_bench: 0 } }, 12)).toBe(false);
    expect(isValidState({ ...base, warehouse: { decor_bench: -1 } }, 12)).toBe(false);
    expect(isValidState({ ...base, warehouse: { decor_bench: 1.5 } }, 12)).toBe(false);
    expect(isValidState({ ...base, warehouse: 'nope' }, 12)).toBe(false);
  });

  it('rejects when non-fence placed + warehoused exceeds MAX_DECOR_ITEMS (50), even split across both - accepts exactly at the cap', () => {
    const base = createDefaultState(12);
    const combined = {
      ...base,
      decorations: Array.from({ length: 40 }, () => ({
        frame: 'decor_bench',
        x: 0,
        y: 0,
        scale: 1,
        flip: false,
      })),
      warehouse: { decor_barrels: 11 },
    };
    expect(isValidState(combined, 12)).toBe(false);
    combined.warehouse = { decor_barrels: 10 };
    expect(isValidState(combined, 12)).toBe(true);
  });

  it('budgets are split (T3.3a2): 50 decor + 60 fences validates together, the 61st fence fails, fences never consume decor slots', () => {
    const base = createDefaultState(12);
    const placement = (frame: string) => ({ frame, x: 0, y: 0, scale: 1, flip: false });
    const bothAtCap = {
      ...base,
      // 40 placed decor + 30 placed fences...
      decorations: [
        ...Array.from({ length: 40 }, () => placement('decor_bench')),
        ...Array.from({ length: 30 }, () => placement('decor_fence')),
      ],
      // ...10 warehoused decor + 30 warehoused fences = 50 decor, 60 fences.
      warehouse: { decor_barrels: 10, decor_fence: 30 },
    };
    expect(isValidState(bothAtCap, 12)).toBe(true);
    const extraFence = {
      ...bothAtCap,
      warehouse: { ...bothAtCap.warehouse, decor_fence: 31 },
    };
    expect(isValidState(extraFence, 12)).toBe(false);
  });

  it('exempts trophies from both budgets: 50 decor + all 5 trophies (mixed placed/warehoused) validates, 51 decor does not', () => {
    const base = createDefaultState(12);
    const placement = (frame: string) => ({ frame, x: 0, y: 0, scale: 1, flip: false });
    const atCapWithTrophies = {
      ...base,
      // 40 non-fence purchasable placed + 2 trophies placed...
      decorations: [
        ...Array.from({ length: 40 }, () => placement('decor_bench')),
        placement('trophy_goldscarecrow'),
        placement('trophy_starbanner'),
      ],
      // ...10 purchasable warehoused + 3 trophies warehoused = 50 purchasable, 5 trophies.
      warehouse: {
        decor_barrels: 10,
        trophy_moonwell: 1,
        trophy_traderscart: 1,
        trophy_ancientoak: 1,
      },
    };
    expect(isValidState(atCapWithTrophies, 12)).toBe(true);

    // One purchasable over the cap fails, whichever side it lands on.
    const extraWarehoused = {
      ...atCapWithTrophies,
      warehouse: { ...atCapWithTrophies.warehouse, decor_barrels: 11 },
    };
    expect(isValidState(extraWarehoused, 12)).toBe(false);
    const extraPlaced = {
      ...atCapWithTrophies,
      decorations: [...atCapWithTrophies.decorations, placement('decor_well')],
    };
    expect(isValidState(extraPlaced, 12)).toBe(false);
  });
});

describe('buyDecoration', () => {
  it('deducts coins, increments the warehouse count, and persists (no placement)', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    store.addCoins(400 - store.getState().coins);
    expect(store.buyDecoration('decor_bench')).toBe(true);
    const state = store.getState();
    expect(state.coins).toBe(0);
    expect(state.decorations).toEqual([]);
    expect(state.warehouse).toEqual({ decor_bench: 1 });

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().warehouse).toEqual(state.warehouse);
    expect(reloaded.getState().decorations).toEqual([]);
  });

  it('deducts moondust for a moondust-priced item', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    // decor_mushrooms costs 4 moondust; MOONDUST_PER_LEVEL (1) per level-up
    // is the only way to earn it, so level up 4 times via xp.
    expect(store.buyDecoration('decor_mushrooms')).toBe(false); // 0 moondust yet
    store.addXp(xpForLevel(5));
    expect(store.getState().moondust).toBe(4);
    expect(store.buyDecoration('decor_mushrooms')).toBe(true);
    const state = store.getState();
    expect(state.moondust).toBe(0);
    expect(state.warehouse).toEqual({ decor_mushrooms: 1 });
    expect(state.decorations).toEqual([]);
  });

  it('stacks repeat purchases of the same frame in the warehouse', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1000);
    expect(store.buyDecoration('decor_bench')).toBe(true);
    expect(store.buyDecoration('decor_bench')).toBe(true);
    expect(store.getState().warehouse).toEqual({ decor_bench: 2 });
    expect(store.getState().decorations).toEqual([]);
  });

  it('fails on an unknown item without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.buyDecoration('not_a_real_item')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('fails when the balance is insufficient, without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(-store.getState().coins); // 0 coins
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.buyDecoration('decor_bench')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('fails at MAX_DECOR_ITEMS non-fence purchasable (placed + warehoused combined), without mutation - fences still buyable (T3.3a2)', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1_000_000);
    for (let i = 0; i < 50; i++) {
      expect(store.buyDecoration('decor_bench')).toBe(true);
    }
    expect(store.getState().warehouse).toEqual({ decor_bench: 50 });
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.buyDecoration('decor_bench')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
    // The decor budget being full does not block the fence budget.
    expect(store.buyDecoration('decor_fence')).toBe(true);
  });

  it('fails at MAX_FENCES fences, without mutation - decor still buyable (T3.3a2)', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1_000_000);
    for (let i = 0; i < 60; i++) {
      expect(store.buyDecoration('decor_fence')).toBe(true);
    }
    expect(store.getState().warehouse).toEqual({ decor_fence: 60 });
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.buyDecoration('decor_fence')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
    // The fence budget being full does not block the decor budget.
    expect(store.buyDecoration('decor_bench')).toBe(true);
  });

  it('ignores trophies for the cap: buys at 49 purchasable + all 5 trophies, fails at 50 purchasable', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1_000_000);
    for (const frame of TROPHY_FRAMES) {
      store.getState().warehouse[frame] = 1;
    }
    for (let i = 0; i < 49; i++) {
      expect(store.buyDecoration('decor_bench')).toBe(true);
    }
    // 49 purchasable + 5 trophies: the trophies do not consume shop capacity.
    expect(store.buyDecoration('decor_bench')).toBe(true);
    // 50 purchasable: at the cap regardless of trophies.
    expect(store.buyDecoration('decor_bench')).toBe(false);
    expect(store.getState().warehouse.decor_bench).toBe(50);
  });

  it('counts placed decorations toward the same cap as warehoused ones', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1_000_000);
    for (let i = 0; i < 50; i++) store.buyDecoration('decor_bench');
    for (let i = 0; i < 20; i++) store.placeFromWarehouse('decor_bench');
    expect(store.getState().decorations).toHaveLength(20);
    expect(store.getState().warehouse).toEqual({ decor_bench: 30 });
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.buyDecoration('decor_bench')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('fails without mutation while onboarding is active', () => {
    const store = new GameStateStore({ storage: null });
    store.addCoins(1000);
    // Onboarding left active (not completed).
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.buyDecoration('decor_bench')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });
});

describe('placeFromWarehouse', () => {
  it('decrements the warehouse count, appends a centered spawn-scale unmirrored placement, and returns the new index', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    store.addCoins(1000);
    store.buyDecoration('decor_bench');
    store.buyDecoration('decor_bench');
    expect(store.getState().warehouse).toEqual({ decor_bench: 2 });

    expect(store.placeFromWarehouse('decor_bench')).toBe(0);
    const state = store.getState();
    expect(state.warehouse).toEqual({ decor_bench: 1 });
    expect(state.decorations).toEqual([
      { frame: 'decor_bench', x: 540, y: 900, scale: 0.7, flip: false },
    ]);

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().decorations).toEqual(state.decorations);
    expect(reloaded.getState().warehouse).toEqual(state.warehouse);
  });

  it('removes the key entirely once its count reaches 0 (never leaves a 0 entry)', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1000);
    store.buyDecoration('decor_bench');
    expect(store.placeFromWarehouse('decor_bench')).toBe(0);
    expect(store.getState().warehouse).toEqual({});
  });

  it('returns false without mutation when none are owned', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.placeFromWarehouse('decor_bench')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('appends across multiple placements, indices increasing', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1000);
    store.buyDecoration('decor_bench');
    store.buyDecoration('decor_fence');
    expect(store.placeFromWarehouse('decor_bench')).toBe(0);
    expect(store.placeFromWarehouse('decor_fence')).toBe(1);
    expect(store.getState().decorations.map((d) => d.frame)).toEqual([
      'decor_bench',
      'decor_fence',
    ]);
  });

  it('spawns sizing-table items at their own defaultScale, fences at FENCE_FIXED_SCALE (T3.3a2)', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(10_000);
    store.buyDecoration('decor_well');
    store.buyDecoration('decor_fence');
    store.placeFromWarehouse('decor_well');
    store.placeFromWarehouse('decor_fence');
    expect(store.getState().decorations.map((d) => d.scale)).toEqual([1.15, 1.2]);
  });
});

describe('storeDecoration', () => {
  it('removes a placement, increments its warehouse count, and persists', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    store.addCoins(1000);
    store.buyDecoration('decor_bench');
    store.placeFromWarehouse('decor_bench');
    expect(store.storeDecoration(0)).toBe(true);
    const state = store.getState();
    expect(state.decorations).toEqual([]);
    expect(state.warehouse).toEqual({ decor_bench: 1 });

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().decorations).toEqual([]);
    expect(reloaded.getState().warehouse).toEqual({ decor_bench: 1 });
  });

  it('round-trips place -> store -> place, preserving counts exactly', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1000);
    store.buyDecoration('decor_bench');
    store.buyDecoration('decor_bench');
    store.placeFromWarehouse('decor_bench');
    store.placeFromWarehouse('decor_bench');
    expect(store.getState().decorations).toHaveLength(2);
    expect(store.getState().warehouse).toEqual({});

    expect(store.storeDecoration(0)).toBe(true);
    expect(store.getState().decorations).toHaveLength(1);
    expect(store.getState().warehouse).toEqual({ decor_bench: 1 });

    expect(store.placeFromWarehouse('decor_bench')).toBe(1);
    expect(store.getState().decorations).toHaveLength(2);
    expect(store.getState().warehouse).toEqual({});
  });

  it('fails on an out-of-range index without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1000);
    store.buyDecoration('decor_bench');
    store.placeFromWarehouse('decor_bench');
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.storeDecoration(1)).toBe(false);
    expect(store.storeDecoration(-1)).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('accumulates the warehouse count across multiple stores of the same frame, index shift accounted for', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1000);
    store.buyDecoration('decor_bench');
    store.buyDecoration('decor_bench');
    store.placeFromWarehouse('decor_bench');
    store.placeFromWarehouse('decor_bench');
    expect(store.storeDecoration(0)).toBe(true);
    // The second placement shifted down to index 0 when the first was removed.
    expect(store.storeDecoration(0)).toBe(true);
    expect(store.getState().decorations).toEqual([]);
    expect(store.getState().warehouse).toEqual({ decor_bench: 2 });
  });
});

describe('setDecorationTransform', () => {
  function storeWithOneDecoration(): GameStateStore {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1000);
    store.buyDecoration('decor_bench');
    store.placeFromWarehouse('decor_bench');
    return store;
  }

  it('applies x/y/scale/flip within range and persists', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    store.addCoins(1000);
    store.buyDecoration('decor_bench');
    store.placeFromWarehouse('decor_bench');
    expect(store.setDecorationTransform(0, 600, 900, 0.7, true)).toBe(true);
    expect(store.getState().decorations[0]).toEqual({
      frame: 'decor_bench',
      x: 600,
      y: 900,
      scale: 0.7,
      flip: true,
    });

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().decorations[0]).toEqual({
      frame: 'decor_bench',
      x: 600,
      y: 900,
      scale: 0.7,
      flip: true,
    });
  });

  it('toggling flip back to false persists too (not a one-way mirror)', () => {
    const store = storeWithOneDecoration();
    expect(store.setDecorationTransform(0, 600, 900, 0.7, true)).toBe(true);
    expect(store.getState().decorations[0]?.flip).toBe(true);
    expect(store.setDecorationTransform(0, 600, 900, 0.7, false)).toBe(true);
    expect(store.getState().decorations[0]?.flip).toBe(false);
  });

  it('clamps x/y/scale to their legal ranges, flip unclamped', () => {
    const store = storeWithOneDecoration();
    // T3.3b RE-PIN: the base decor clamp widened to the full base plot rect -
    // x [DECOR_X_MIN 20, DECOR_X_MAX 1240], y [DECOR_Y_MIN -300, DECOR_Y_MAX
    // 2010] (west mere reserve + south seed-bar dead band), superseding the old
    // hand-tuned 0..1080 / 380..1520. Scale range (0.35..bench max 0.85)
    // unchanged. Both clamp corners land on open ground (no permanent object),
    // so the commit succeeds.
    expect(store.setDecorationTransform(0, -5000, -5000, 0, false)).toBe(true);
    expect(store.getState().decorations[0]).toEqual({
      frame: 'decor_bench',
      x: 20,
      y: -300,
      scale: 0.35,
      flip: false,
    });
    expect(store.setDecorationTransform(0, 5000, 5000, 5, true)).toBe(true);
    expect(store.getState().decorations[0]).toEqual({
      frame: 'decor_bench',
      x: 1240,
      y: 2010,
      scale: 0.85,
      flip: true,
    });
  });

  it('fails on an out-of-range index without mutation', () => {
    const store = storeWithOneDecoration();
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.setDecorationTransform(1, 0, 0, 0.5, false)).toBe(false);
    expect(store.setDecorationTransform(-1, 0, 0, 0.5, false)).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('fails on non-finite input without mutation', () => {
    const store = storeWithOneDecoration();
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.setDecorationTransform(0, Number.NaN, 0, 0.5, false)).toBe(false);
    expect(store.setDecorationTransform(0, 0, Infinity, 0.5, false)).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('fails on a non-boolean flip without mutation', () => {
    const store = storeWithOneDecoration();
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    // @ts-expect-error deliberately wrong type, mirrors the non-finite-input test above
    expect(store.setDecorationTransform(0, 600, 900, 0.7, 'yes')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('clamps a sizing-table item at its own maxScale; the global minimum is unchanged (T3.3a2)', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(10_000);
    store.buyDecoration('decor_well');
    store.placeFromWarehouse('decor_well');
    expect(store.setDecorationTransform(0, 600, 900, 5, false)).toBe(true);
    expect(store.getState().decorations[0]?.scale).toBe(1.15);
    expect(store.setDecorationTransform(0, 600, 900, 0, false)).toBe(true);
    expect(store.getState().decorations[0]?.scale).toBe(0.35);
  });

  it('pins a fence at exactly FENCE_FIXED_SCALE - even against an explicit dev ceiling (T3.3a2)', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(10_000);
    store.buyDecoration('decor_fence');
    store.placeFromWarehouse('decor_fence');
    expect(store.getState().decorations[0]?.scale).toBe(1.2);
    expect(store.setDecorationTransform(0, 600, 900, 0.5, true, 3.0)).toBe(true);
    expect(store.getState().decorations[0]).toEqual({
      frame: 'decor_fence',
      x: 600,
      y: 900,
      scale: 1.2,
      flip: true,
    });
  });
});

describe('export and import', () => {
  it('round-trips through exportSave/importSave', () => {
    const source = new GameStateStore({ storage: null });
    source.addCoins(123);
    const exported = source.exportSave();

    const target = new GameStateStore({ storage: makeStorage() });
    expect(target.importSave(exported)).toBe(true);
    const { lastSavedAt: sourceSavedAt, ...sourceRest } = source.getState();
    const { lastSavedAt: targetSavedAt, ...targetRest } = target.getState();
    expect(targetRest).toEqual(sourceRest);
    // importSave persists, which re-stamps lastSavedAt.
    expect(targetSavedAt).toBeGreaterThanOrEqual(sourceSavedAt);
  });

  it('rejects an invalid import and leaves state untouched', () => {
    const store = new GameStateStore({ storage: makeStorage() });
    store.addCoins(10);
    expect(store.importSave('garbage')).toBe(false);
    expect(store.importSave('{"version":1}')).toBe(false);
    expect(store.getState().coins).toBe(60);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('plantCrop', () => {
  it('plants on an empty plot, deducts the seed cost, and persists', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    const before = now();
    expect(store.plantCrop(0, 'sunwheat')).toBe(true);
    const state = store.getState();
    expect(state.coins).toBe(50 - CROPS.sunwheat.seedCost);
    const plot = state.plots[0];
    expect(plot?.state).toBe('growing');
    if (plot?.state === 'growing') {
      expect(plot.cropId).toBe('sunwheat');
      expect(plot.plantedAt).toBeGreaterThanOrEqual(before);
    }

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().plots[0]).toEqual(plot);
  });

  it('fails on an occupied plot without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    expect(store.plantCrop(0, 'sunwheat')).toBe(true);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.plantCrop(0, 'sunwheat')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('fails on an out-of-range or fractional index without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    expect(store.plantCrop(-1, 'sunwheat')).toBe(false);
    expect(store.plantCrop(PLOT_COUNT, 'sunwheat')).toBe(false);
    expect(store.plantCrop(0.5, 'sunwheat')).toBe(false);
    expect(store.getState().coins).toBe(50);
    expect(store.getState().plots.every((p) => p.state === 'empty')).toBe(true);
  });

  it('fails on an unknown crop without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    expect(store.plantCrop(0, 'tomato' as CropId)).toBe(false);
    expect(store.getState().coins).toBe(50);
    expect(store.getState().plots[0]).toEqual({ state: 'empty', ...tileOf(0) });
  });

  it('fails when coins are insufficient without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(-(50 - CROPS.sunwheat.seedCost + 1)); // one coin short
    const coinsBefore = store.getState().coins;
    expect(store.plantCrop(0, 'sunwheat')).toBe(false);
    expect(store.getState().coins).toBe(coinsBefore);
    expect(store.getState().plots[0]).toEqual({ state: 'empty', ...tileOf(0) });
  });

  it('fails when the crop is not unlocked yet without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    expect(CROPS.starcorn.unlockLevel).toBeGreaterThan(store.getState().level);
    expect(store.plantCrop(0, 'starcorn')).toBe(false);
    expect(store.getState().coins).toBe(50);
    expect(store.getState().plots[0]).toEqual({ state: 'empty', ...tileOf(0) });
  });
});

describe('harvestPlot', () => {
  it('fails on an empty plot and on an out-of-range index', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    expect(store.harvestPlot(0)).toBe(false);
    expect(store.harvestPlot(-1)).toBe(false);
    expect(store.harvestPlot(PLOT_COUNT)).toBe(false);
  });

  it('fails on a growing plot that is not ready yet, without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.plantCrop(0, 'sunwheat');
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.harvestPlot(0)).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('harvests a ready plot after the game clock is warped forward', () => {
    // rng pinned above RADIANT_CHANCE - see the index-13 test above.
    const store = new GameStateStore({ storage: null, rng: () => 1 });
    completeOnboarding(store);
    expect(store.plantCrop(0, 'sunwheat')).toBe(true);
    advanceTime(CROPS.sunwheat.growMs);
    expect(store.harvestPlot(0)).toBe(true);
    const state = store.getState();
    expect(state.plots[0]).toEqual({ state: 'empty', ...tileOf(0) });
    expect(state.inventory.sunwheat).toBe(1);
    expect(state.xp).toBe(CROPS.sunwheat.xp);
    // A second harvest of the now-empty plot fails.
    expect(store.harvestPlot(0)).toBe(false);
    expect(state.inventory.sunwheat).toBe(1);
  });

  it('accumulates inventory across harvests', () => {
    // rng pinned above RADIANT_CHANCE - see the index-13 test above.
    const store = new GameStateStore({ storage: null, rng: () => 1 });
    completeOnboarding(store);
    for (let i = 0; i < 2; i++) {
      store.plantCrop(i, 'sunwheat');
      advanceTime(CROPS.sunwheat.growMs);
      expect(store.harvestPlot(i)).toBe(true);
    }
    expect(store.getState().inventory.sunwheat).toBe(2);
    expect(store.getState().xp).toBe(2 * CROPS.sunwheat.xp);
  });
});

describe('sellCrop', () => {
  it('sells the entire stack, adds coins, empties the stack, and persists', () => {
    // rng pinned above RADIANT_CHANCE - see the index-13 test above.
    const storage = makeStorage();
    const store = new GameStateStore({ storage, rng: () => 1 });
    completeOnboarding(store);
    for (let i = 0; i < 3; i++) {
      store.plantCrop(i, 'sunwheat');
      advanceTime(CROPS.sunwheat.growMs);
      store.harvestPlot(i);
    }
    const coinsBefore = store.getState().coins;
    const gained = store.sellCrop('sunwheat');
    expect(gained).toBe(3 * CROPS.sunwheat.sellValue);
    const state = store.getState();
    expect(state.coins).toBe(coinsBefore + gained);
    expect(state.inventory.sunwheat).toBe(0);

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().coins).toBe(state.coins);
    expect(reloaded.getState().inventory.sunwheat).toBe(0);
  });

  it('returns 0 without mutating anything when the stack is empty', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.sellCrop('sunwheat')).toBe(0);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });
});

describe('replant', () => {
  it('replants every entry, deducting total seed cost, in one save', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    const before = now();
    const entries = [
      { plotIndex: 0, cropId: 'sunwheat' as CropId },
      { plotIndex: 1, cropId: 'sunwheat' as CropId },
    ];
    const coinsBefore = store.getState().coins;
    expect(store.replant(entries)).toBe(2);
    const state = store.getState();
    expect(state.coins).toBe(coinsBefore - 2 * CROPS.sunwheat.seedCost);
    for (const { plotIndex } of entries) {
      const plot = state.plots[plotIndex];
      expect(plot?.state).toBe('growing');
      if (plot?.state === 'growing') {
        expect(plot.cropId).toBe('sunwheat');
        expect(plot.plantedAt).toBeGreaterThanOrEqual(before);
      }
    }

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().plots[0]).toEqual(state.plots[0]);
    expect(reloaded.getState().plots[1]).toEqual(state.plots[1]);
  });

  it('replants only the subset still empty, and charges only for that subset', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    // Plot 0 is hand-planted with a different crop since the harvest.
    expect(store.plantCrop(0, 'sunwheat')).toBe(true);
    const coinsBefore = store.getState().coins;
    const entries = [
      { plotIndex: 0, cropId: 'sunwheat' as CropId },
      { plotIndex: 1, cropId: 'sunwheat' as CropId },
    ];
    expect(store.replant(entries)).toBe(1);
    const state = store.getState();
    expect(state.coins).toBe(coinsBefore - CROPS.sunwheat.seedCost);
    expect(state.plots[1]?.state).toBe('growing');
  });

  it('fails all-or-nothing without mutation when coins are insufficient for the total', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    const entries = [
      { plotIndex: 0, cropId: 'sunwheat' as CropId },
      { plotIndex: 1, cropId: 'sunwheat' as CropId },
    ];
    store.addCoins(-(store.getState().coins - CROPS.sunwheat.seedCost)); // covers only 1 of 2
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.replant(entries)).toBe(0);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('returns 0 without mutation while onboarding is active', () => {
    const store = new GameStateStore({ storage: null });
    // Onboarding left active (not completed).
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.replant([{ plotIndex: 0, cropId: 'sunwheat' }])).toBe(0);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('returns 0 without mutation when entries is empty', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.replant([])).toBe(0);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });
});

describe('expandFarm', () => {
  it('fails without enough coins, without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.expandFarm()).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('deducts exactly EXPANSION_COST, flips expanded, grants 4 shed plots, and persists (T3.3a)', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    store.addCoins(EXPANSION_COST - store.getState().coins);
    expect(store.expandFarm()).toBe(true);
    const state = store.getState();
    expect(state.coins).toBe(0);
    // The new plots land in the SHED, not on fixed tiles.
    expect(state.plots).toHaveLength(BASE_PLOT_COUNT);
    expect(state.unplacedPlots).toBe(EXPANDED_PLOT_COUNT - BASE_PLOT_COUNT);
    expect(state.expanded).toBe(true);
    // The Expand sign's blocked footprint tiles free up with the sign gone
    // (T3.3a-r - geometry never changes; the purchase is only a grant).
    expect(isPlotTileFree(state, 4, 4)).toBe(true);
    // The grant queued its popup event.
    expect(store.consumePlotGrantEvents()).toEqual([
      { count: EXPANDED_PLOT_COUNT - BASE_PLOT_COUNT },
    ]);

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().plots).toHaveLength(BASE_PLOT_COUNT);
    expect(reloaded.getState().unplacedPlots).toBe(EXPANDED_PLOT_COUNT - BASE_PLOT_COUNT);
    expect(reloaded.getState().expanded).toBe(true);
    expect(reloaded.getState().coins).toBe(0);
  });

  it('a second expansion is impossible, without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(EXPANSION_COST);
    expect(store.expandFarm()).toBe(true);
    store.addCoins(EXPANSION_COST);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.expandFarm()).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });
});

describe('premium order validation', () => {
  it('accepts a save containing a premium order, and it survives a reload', () => {
    const premiumOrder: Order = {
      items: [{ cropId: 'sunwheat', count: 2 }],
      coinReward: 20,
      xpReward: 4,
      premium: { moondust: 2, flavor: 'A test flavor line' },
    };
    const saved = createDefaultState(12);
    saved.orders[0] = { state: 'open', order: premiumOrder };
    expect(isValidState(saved, 12)).toBe(true);

    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().orders[0]).toEqual({ state: 'open', order: premiumOrder });
  });

  it('accepts an order with no premium field (absence is valid, no version bump)', () => {
    const saved = createDefaultState(12);
    saved.orders[0] = {
      state: 'open',
      order: { items: [{ cropId: 'sunwheat', count: 1 }], coinReward: 8, xpReward: 2 },
    };
    expect(isValidState(saved, 12)).toBe(true);
  });

  it('rejects a malformed premium field: non-positive/non-finite moondust, or a non-string flavor', () => {
    const baseOrder = { items: [{ cropId: 'sunwheat', count: 1 }], coinReward: 8, xpReward: 2 };
    const badPremiums = [
      { moondust: 0, flavor: 'text' },
      { moondust: -1, flavor: 'text' },
      { moondust: Number.NaN, flavor: 'text' },
      { moondust: Infinity, flavor: 'text' },
      { moondust: 2, flavor: 42 },
      { moondust: 2 }, // missing flavor
    ];
    for (const premium of badPremiums) {
      const bad = {
        ...createDefaultState(12),
        orders: [
          { state: 'open', order: { ...baseOrder, premium } },
          { state: 'pending' },
          { state: 'pending' },
        ],
      };
      expect(isValidState(bad, 12)).toBe(false);
    }
  });

  it('accepts a premium.chests of 1 or 2 (T2.23a), and it survives a reload', () => {
    for (const chests of [1, 2]) {
      const premiumOrder: Order = {
        items: [{ cropId: 'sunwheat', count: 2 }],
        coinReward: 20,
        xpReward: 4,
        premium: { moondust: 2, flavor: 'A test flavor line', chests },
      };
      const saved = createDefaultState(12);
      saved.orders[0] = { state: 'open', order: premiumOrder };
      expect(isValidState(saved, 12)).toBe(true);

      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState().orders[0]).toEqual({ state: 'open', order: premiumOrder });
    }
  });

  it('accepts a premium order with no chests field (older saves, or generated below CHEST_UNLOCK_LEVEL)', () => {
    const premiumOrder: Order = {
      items: [{ cropId: 'sunwheat', count: 1 }],
      coinReward: 10,
      xpReward: 2,
      premium: { moondust: 1, flavor: 'A test flavor line' },
    };
    const saved = createDefaultState(12);
    saved.orders[0] = { state: 'open', order: premiumOrder };
    expect(isValidState(saved, 12)).toBe(true);
  });

  it('rejects a malformed premium.chests: zero, negative, non-integer, or non-finite', () => {
    const baseOrder = { items: [{ cropId: 'sunwheat', count: 1 }], coinReward: 8, xpReward: 2 };
    const badChestCounts = [0, -1, 1.5, Number.NaN, Infinity];
    for (const chests of badChestCounts) {
      const bad = {
        ...createDefaultState(12),
        orders: [
          {
            state: 'open',
            order: { ...baseOrder, premium: { moondust: 1, flavor: 'text', chests } },
          },
          { state: 'pending' },
          { state: 'pending' },
        ],
      };
      expect(isValidState(bad, 12)).toBe(false);
    }
  });
});

describe('plot validation (T3.3a: coords, dupes, entitlement range)', () => {
  it('accepts 12 placed, 16 placed, and mid-placement mixes within the entitlement range', () => {
    const base = createDefaultState(16);
    expect(isValidState(base, 16)).toBe(true);
    const expanded = {
      ...base,
      expanded: true,
      plots: [
        ...base.plots,
        ...Array.from({ length: 4 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(12 + i) })),
      ],
    };
    expect(isValidState(expanded, 16)).toBe(true);
    // Mid-placement: 14 placed + 2 still in the shed = 16 total.
    const midPlacement = {
      ...expanded,
      plots: expanded.plots.slice(0, 14),
      unplacedPlots: 2,
    };
    expect(isValidState(midPlacement, 16)).toBe(true);
  });

  it('rejects a total entitlement below 12 or above 16 (placed + shed)', () => {
    const base = createDefaultState(16);
    const eleven = { ...base, plots: base.plots.slice(0, 11) };
    expect(isValidState(eleven, 16)).toBe(false);
    const seventeen = { ...base, unplacedPlots: 5 };
    expect(isValidState(seventeen, 16)).toBe(false);
    const overPlaced = {
      ...base,
      plots: [
        ...base.plots,
        ...Array.from({ length: 5 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(12 + i) })),
      ],
    };
    // 17 placed also needs a 17th distinct tile, which the maximal grid lacks
    // - the dupe test below covers that axis; this one keeps tiles legal.
    overPlaced.plots[16] = { state: 'empty', col: 0, row: 0 };
    expect(isValidState(overPlaced, 16)).toBe(false);
  });

  it('rejects two plots on one tile', () => {
    const base = createDefaultState(16);
    const doubled = { ...base, plots: [...base.plots] };
    doubled.plots[5] = { state: 'empty', ...tileOf(4) };
    expect(isValidState(doubled, 16)).toBe(false);
  });

  it('rejects non-integer or out-of-bounds coordinates (T3.3a-r static validator bounds)', () => {
    const base = createDefaultState(16);
    for (const bad of [
      { col: 0.5, row: 0 },
      { col: PLOT_GRID_COORD_MIN - 1, row: 0 },
      { col: PLOT_GRID_COORD_MAX + 1, row: 0 },
      { col: 0, row: PLOT_GRID_COORD_MIN - 1 },
      { col: 0, row: PLOT_GRID_COORD_MAX + 1 },
      { col: Number.NaN, row: 0 },
    ]) {
      const state = { ...base, plots: [...base.plots] };
      state.plots[0] = { state: 'empty', ...bad };
      expect(isValidState(state, 16)).toBe(false);
    }
  });

  it('accepts negative and wide coordinates at the validator bounds (T3.3a-r loosens v16 - no schema bump)', () => {
    const base = createDefaultState(16);
    const state = { ...base, plots: [...base.plots] };
    state.plots[0] = { state: 'empty', col: PLOT_GRID_COORD_MIN, row: PLOT_GRID_COORD_MAX };
    state.plots[1] = { state: 'empty', col: PLOT_GRID_COORD_MAX, row: PLOT_GRID_COORD_MIN };
    expect(isValidState(state, 16)).toBe(true);
  });

  it('distinct-tile check survives the wide grid: (4, 0) and (0, 1) are distinct (the old row*4+col key collided)', () => {
    const base = createDefaultState(16);
    const state = { ...base, plots: [...base.plots] };
    // base.plots[4] already sits at (0, 1); under the old numeric key both
    // hashed to 4 and this valid layout was wrongly rejected.
    state.plots[0] = { state: 'empty', col: 4, row: 0 };
    expect(isValidState(state, 16)).toBe(true);
  });

  it('rejects a negative, fractional, or missing unplacedPlots and a non-boolean expanded', () => {
    const base = createDefaultState(16);
    expect(isValidState({ ...base, unplacedPlots: -1 }, 16)).toBe(false);
    expect(isValidState({ ...base, unplacedPlots: 1.5 }, 16)).toBe(false);
    expect(isValidState({ ...base, unplacedPlots: undefined }, 16)).toBe(false);
    expect(isValidState({ ...base, expanded: 'yes' }, 16)).toBe(false);
  });
});

describe('plantCrop / harvestPlot on a placed expansion plot (T3.3a)', () => {
  it('plants and harvests on a plot placed on the 4th row', () => {
    // rng pinned above RADIANT_CHANCE: completeOnboarding marks onboarding
    // completed directly, so harvestPlot's Radiant roll is live here, and an
    // unseeded rng would flakily yield RADIANT_YIELD_MULT instead of 1.
    const store = new GameStateStore({ storage: null, rng: () => 1 });
    completeOnboarding(store);
    store.addCoins(EXPANSION_COST);
    expect(store.expandFarm()).toBe(true);
    expect(store.placePlot(1, 3)).toBe(12);
    expect(store.plantCrop(12, 'sunwheat')).toBe(true);
    advanceTime(CROPS.sunwheat.growMs);
    expect(store.harvestPlot(12)).toBe(true);
    expect(store.getState().plots[12]).toEqual({ state: 'empty', col: 1, row: 3 });
    expect(store.getState().inventory.sunwheat).toBe(1);
  });
});

describe('placeablePlotTiles (T3.3a-r placement authority)', () => {
  it('every tile diamond fits inside the placeable rect, in the frozen frame', () => {
    for (const { col, row } of placeablePlotTiles()) {
      const { x, y } = gridToIso(col, row);
      expect(x - TILE_WIDTH / 2).toBeGreaterThanOrEqual(PLOT_PLACEABLE_MIN_X);
      expect(x + TILE_WIDTH / 2).toBeLessThanOrEqual(PLOT_PLACEABLE_MAX_X);
      expect(y - TILE_HEIGHT / 2).toBeGreaterThanOrEqual(PLOT_PLACEABLE_MIN_Y);
      expect(y + TILE_HEIGHT / 2).toBeLessThanOrEqual(PLOT_PLACEABLE_MAX_Y);
    }
  });

  it('pins the derivation: 136 tiles, negative coordinates present, the whole legacy 4x4 included', () => {
    const tiles = placeablePlotTiles();
    expect(tiles).toHaveLength(136);
    // Negative col/row are expected - tile (0, 0) is the legacy grid's top
    // corner, not the scene's.
    expect(tiles).toContainEqual({ col: -5, row: -2 });
    expect(tiles).toContainEqual({ col: 0, row: -1 });
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < FARM_COLS; col++) {
        expect(tiles).toContainEqual({ col, row });
      }
    }
  });

  it('T3.3a-r2 world growth: apron tiles included on three sides, the west mere reserve excluded', () => {
    const tiles = placeablePlotTiles();
    // North apron: center y = -192, above even the old scene top (y 0).
    expect(tiles).toContainEqual({ col: -8, row: -7 });
    // South apron: center y = 1920 (the old scene's bottom edge), far past
    // the old rect's 1540 limit.
    expect(tiles).toContainEqual({ col: 9, row: 9 });
    // T3.3a-r2x seed-bar dead band: the next diagonal row south (center
    // y = 1984, diamond bottom 2048 > 2010) can never scroll clear of the
    // seed-bar band even at max zoom-in, so it is NOT placeable.
    expect(tiles).not.toContainEqual({ col: 10, row: 9 });
    // East strip: center x = 1052, right edge 1180 - past the old 1060 limit.
    expect(tiles).toContainEqual({ col: 4, row: 0 });
    // West mere reserve (x < 20): the next column west (col-row = -4 puts the
    // diamond's left edge at -100) must NOT be placeable.
    expect(tiles).not.toContainEqual({ col: -4, row: 0 });
    for (const { col, row } of tiles) {
      expect(col - row).toBeGreaterThanOrEqual(-3);
    }
  });

  it('the static validator bounds enclose the set with margin (pins the farm.ts derivation)', () => {
    const tiles = placeablePlotTiles();
    const cols = tiles.map((tile) => tile.col);
    const rows = tiles.map((tile) => tile.row);
    expect(Math.min(...cols)).toBe(-9);
    expect(Math.max(...cols)).toBe(11);
    expect(Math.min(...rows)).toBe(-9);
    expect(Math.max(...rows)).toBe(10);
    expect(PLOT_GRID_COORD_MIN).toBeLessThan(-9);
    expect(PLOT_GRID_COORD_MAX).toBeGreaterThan(11);
  });
});

describe('placeablePlotTiles region union + bounds (T3.3b)', () => {
  /** A tile whose diamond fits the East Meadow band but NOT the base rect:
   *  col-row = 7 -> center x = 540 + 7*128 = 1436, diamond x 1308..1564
   *  (inside the band's [1240, 1752], past the base's 1240 east edge);
   *  col+row = 1 -> center y = 768 + 64 = 832, well inside y [-300, 2010]. */
  const BAND_TILE = { col: 4, row: -3 };

  it('with no region unlocked returns exactly the base set (136 tiles)', () => {
    expect(placeablePlotTiles([])).toEqual(placeablePlotTiles());
    expect(placeablePlotTiles([])).toHaveLength(136);
    expect(placeablePlotTiles([])).not.toContainEqual(BAND_TILE);
  });

  it('unlocking east_meadow adds the band AND the seam column (136 -> 204), base tiles preserved', () => {
    // DERIVATION (T3.3b-r1 seam fix): the domain now enumerates over the
    // MERGED rect x [20, 1752] y [-300, 2010] (base and band share the full
    // y-range and touch at x=1240), not the two rects separately. That is the
    // 136 base tiles + the band's own 34 + the 34 tiles whose diamonds straddle
    // x=1240 and so fitted inside NEITHER rect before = 204.
    const base = placeablePlotTiles();
    const withRegion = placeablePlotTiles(['east_meadow']);
    expect(withRegion).toHaveLength(204);
    for (const tile of base) expect(withRegion).toContainEqual(tile);
    expect(withRegion).toContainEqual(BAND_TILE);
  });

  it('THE SEAM FIX (T3.3b-r1): a straddling tile is not placeable base-only but is once east_meadow unlocks', () => {
    // DERIVATION: seam tiles are exactly col-row in {5, 6}. (5,0): col-row = 5
    // -> center x = 540 + 5*128 = 1180, diamond x 1052..1308 - it crosses the
    // shared edge x=1240, so it fits neither the base rect (east edge 1240)
    // nor the band (west edge 1240), and the pre-fix per-rect union dropped it.
    const SEAM_TILE = { col: 5, row: 0 };
    expect(placeablePlotTiles([])).not.toContainEqual(SEAM_TILE);
    expect(placeablePlotTiles(['east_meadow'])).toContainEqual(SEAM_TILE);
    // Continuity: the seam tile's west and east grid neighbors are in the
    // domain too, so base -> seam -> band is an unbroken run of tiles.
    expect(placeablePlotTiles(['east_meadow'])).toContainEqual({ col: 4, row: 0 }); // base side
    expect(placeablePlotTiles(['east_meadow'])).toContainEqual({ col: 6, row: 0 }); // seam (col-row 6)
    expect(placeablePlotTiles(['east_meadow'])).toContainEqual({ col: 7, row: 0 }); // band side
  });

  it('ignores unknown region ids (base set only)', () => {
    expect(placeablePlotTiles(['not_a_region'])).toHaveLength(136);
  });

  it('the static validator bounds enclose the region-union set with >=1 tile margin (T3.3b re-pin)', () => {
    // Base col [-9, 11] / row [-9, 10] UNION the East Meadow band pushes the
    // union to col [-9, 13] and row [-11, 10]; [-12, 14] gives row -11 and
    // col 13 exactly 1 tile of margin, the rest more.
    const union = placeablePlotTiles(REGIONS.map((region) => region.id));
    const cols = union.map((tile) => tile.col);
    const rows = union.map((tile) => tile.row);
    expect(Math.min(...cols)).toBe(-9);
    expect(Math.max(...cols)).toBe(13);
    expect(Math.min(...rows)).toBe(-11);
    expect(Math.max(...rows)).toBe(10);
    expect(PLOT_GRID_COORD_MIN).toBeLessThanOrEqual(-11 - 1);
    expect(PLOT_GRID_COORD_MAX).toBeGreaterThanOrEqual(13 + 1);
  });

  it('every union tile diamond fits the MERGED base+band rect (T3.3b-r1 re-pin)', () => {
    // RE-PIN: was "fits its OWN rect (base or band)". That is exactly the
    // pre-fix rule that dropped the seam column, so it can no longer hold -
    // the merged rect (base west/north/south edges, band east edge) is the
    // domain's real boundary now. Region placeableRects are unchanged; only
    // the tile-domain computation merges.
    const east = findRegion('east_meadow')!;
    for (const { col, row } of placeablePlotTiles(['east_meadow'])) {
      const { x, y } = gridToIso(col, row);
      expect(x - TILE_WIDTH / 2).toBeGreaterThanOrEqual(PLOT_PLACEABLE_MIN_X);
      expect(x + TILE_WIDTH / 2).toBeLessThanOrEqual(east.placeableRect.maxX);
      expect(y - TILE_HEIGHT / 2).toBeGreaterThanOrEqual(PLOT_PLACEABLE_MIN_Y);
      expect(y + TILE_HEIGHT / 2).toBeLessThanOrEqual(PLOT_PLACEABLE_MAX_Y);
    }
    // And the merge is lossless in the other direction: the band's own rect is
    // still edge-adjacent to the base rect on the full shared y-range, which is
    // what makes the combined bounding rect cover exactly their union.
    expect(east.placeableRect.minX).toBe(PLOT_PLACEABLE_MAX_X);
    expect(east.placeableRect.minY).toBe(PLOT_PLACEABLE_MIN_Y);
    expect(east.placeableRect.maxY).toBe(PLOT_PLACEABLE_MAX_Y);
  });

  it('a structure commits onto band tiles across the former seam only once east_meadow is unlocked (T3.3b-r1)', () => {
    // DERIVATION: farmhouse anchor (5,0) -> 2x2 footprint (6,0),(7,0),(6,1),(7,1).
    // By col-row: (6,1)=5 and (6,0)/(7,1)=6 are SEAM tiles, (7,0)=7 is squarely
    // in the band. None of the four is in the base set, so the anchor is
    // illegal with no region and legal with East Meadow - and it straddles the
    // seam, which the pre-fix per-rect domain made impossible.
    const base: Pick<
      GameStateData,
      'plots' | 'structures' | 'buildings' | 'expanded' | 'regionsUnlocked'
    > = {
      plots: [],
      structures: defaultStructures(),
      buildings: [],
      expanded: true,
      regionsUnlocked: [],
    };
    expect(isStructureAnchorFree(base, 'farmhouse', 5, 0)).toBe(false);
    expect(
      isStructureAnchorFree({ ...base, regionsUnlocked: ['east_meadow'] }, 'farmhouse', 5, 0),
    ).toBe(true);
  });
});

describe('plotEntitlementCap (T3.3b)', () => {
  it('is EXPANDED_PLOT_COUNT (16) with no region, 22 with East Meadow', () => {
    expect(plotEntitlementCap([])).toBe(EXPANDED_PLOT_COUNT);
    expect(plotEntitlementCap([])).toBe(16);
    // 16 + East Meadow's entitlementIncrease (6) = 22.
    expect(plotEntitlementCap(['east_meadow'])).toBe(22);
  });

  it('ignores unknown region ids', () => {
    expect(plotEntitlementCap(['not_a_region'])).toBe(16);
  });
});

describe('regionsUnlocked + twoFingerHintShown validation (T3.3b)', () => {
  it('accepts empty and known ids; rejects unknown, duplicate, and non-array region lists', () => {
    const base = createDefaultState(19);
    expect(isValidState(base, 19)).toBe(true);
    expect(isValidState({ ...base, regionsUnlocked: ['east_meadow'] }, 19)).toBe(true);
    expect(isValidState({ ...base, regionsUnlocked: ['not_a_region'] }, 19)).toBe(false);
    expect(isValidState({ ...base, regionsUnlocked: ['east_meadow', 'east_meadow'] }, 19)).toBe(
      false,
    );
    expect(isValidState({ ...base, regionsUnlocked: 'east_meadow' }, 19)).toBe(false);
    expect(isValidState({ ...base, regionsUnlocked: undefined }, 19)).toBe(false);
  });

  it('requires a boolean twoFingerHintShown', () => {
    const base = createDefaultState(19);
    expect(isValidState({ ...base, twoFingerHintShown: undefined }, 19)).toBe(false);
    expect(isValidState({ ...base, twoFingerHintShown: 'yes' }, 19)).toBe(false);
  });

  it('accepts up to the region-raised cap (22 with East Meadow), rejects above it (T3.3b re-pin)', () => {
    // 16 placed + 6 shed = 22 = cap with East Meadow unlocked: valid.
    const base = createDefaultState(19);
    const state = {
      ...base,
      regionsUnlocked: ['east_meadow'],
      expanded: true,
      unplacedPlots: 6,
      plots: [
        ...base.plots,
        ...Array.from({ length: 4 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(12 + i) })),
      ],
    };
    expect(isValidState(state, 19)).toBe(true);
    // 23 total: over the 22 cap.
    expect(isValidState({ ...state, unplacedPlots: 7 }, 19)).toBe(false);
    // The identical 22-total layout WITHOUT the region: over the base 16 cap.
    expect(isValidState({ ...state, regionsUnlocked: [] }, 19)).toBe(false);
  });
});

describe('purchaseRegion (T3.3b)', () => {
  /** A store that can afford and is level-gated for East Meadow (level 7, 7550 coins). */
  function readyStore(): GameStateStore {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.setLevel(7);
    store.addCoins(7500); // 50 default + 7500 = 7550
    return store;
  }

  it('refuses an unknown region id', () => {
    expect(readyStore().purchaseRegion('not_a_region')).toBe(false);
  });

  it('refuses below the level gate, without mutating', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.setLevel(6);
    store.addCoins(10_000);
    const coins = store.getState().coins;
    expect(store.purchaseRegion('east_meadow')).toBe(false);
    expect(store.getState().coins).toBe(coins);
    expect(store.getState().regionsUnlocked).toEqual([]);
    expect(store.getState().unplacedPlots).toBe(0);
  });

  it('refuses with insufficient coins, without mutating', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.setLevel(7); // default 50 coins < 7500
    expect(store.purchaseRegion('east_meadow')).toBe(false);
    expect(store.getState().regionsUnlocked).toEqual([]);
    expect(store.getState().unplacedPlots).toBe(0);
  });

  it('purchases: deducts exactly 7500, unlocks, grants 6 plots, raises the cap to 22', () => {
    const store = readyStore();
    const before = store.getState().coins;
    expect(store.purchaseRegion('east_meadow')).toBe(true);
    expect(store.getState().coins).toBe(before - 7500);
    expect(store.getState().regionsUnlocked).toEqual(['east_meadow']);
    expect(store.getState().unplacedPlots).toBe(6);
    expect(store.consumePlotGrantEvents()).toEqual([{ count: 6 }]);
    // Cap is 22 now: 12 placed + 6 shed = 18, so 4 more grant, a 5th does not.
    expect(store.grantPlots(4)).toBe(true);
    expect(store.grantPlots(1)).toBe(false);
  });

  it('refuses a second purchase of the same region', () => {
    const store = readyStore();
    store.addCoins(7500);
    expect(store.purchaseRegion('east_meadow')).toBe(true);
    expect(store.purchaseRegion('east_meadow')).toBe(false);
  });

  it('opens the band to plot placement on purchase (domain union via the single authority)', () => {
    const store = readyStore();
    // (4,-3) is a band tile: not placeable before, placeable after.
    expect(isPlotTileFree(store.getState(), 4, -3)).toBe(false);
    expect(store.purchaseRegion('east_meadow')).toBe(true);
    expect(isPlotTileFree(store.getState(), 4, -3)).toBe(true);
    expect(store.placePlot(4, -3)).toBe(BASE_PLOT_COUNT);
  });

  it('devUnlockRegion unlocks and grants without the level or coin gates', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store); // level 1, 50 coins - a real purchase would refuse
    expect(store.devUnlockRegion('east_meadow')).toBe(true);
    expect(store.getState().regionsUnlocked).toEqual(['east_meadow']);
    expect(store.getState().unplacedPlots).toBe(6);
    expect(store.getState().coins).toBe(50);
    expect(store.devUnlockRegion('east_meadow')).toBe(false); // already unlocked
    expect(store.devUnlockRegion('not_a_region')).toBe(false);
  });

  it('markTwoFingerHintShown flips the flag once and persists it', () => {
    const store = new GameStateStore({ storage: null });
    expect(store.getState().twoFingerHintShown).toBe(false);
    store.markTwoFingerHintShown();
    expect(store.getState().twoFingerHintShown).toBe(true);
  });
});

describe('isPlotTileFree (T3.3a-r collision rules)', () => {
  /** A minimal state slice: `plots` on the given tiles, optional decor and
   *  buildings (T4.1), unexpanded by default. */
  function slice(
    plots: { col: number; row: number }[],
    options: {
      decorations?: GameStateData['decorations'];
      expanded?: boolean;
      buildings?: GameStateData['buildings'];
    } = {},
  ): Pick<
    GameStateData,
    'plots' | 'decorations' | 'expanded' | 'structures' | 'buildings' | 'regionsUnlocked'
  > {
    return {
      plots: plots.map((tile): PlotState => ({ state: 'empty', ...tile })),
      decorations: options.decorations ?? [],
      expanded: options.expanded ?? false,
      structures: defaultStructures(),
      buildings: options.buildings ?? [],
      regionsUnlocked: [],
    };
  }

  it('rejects a tile occupied by another plot, unless that plot is the exempted mover', () => {
    const state = slice([{ col: 0, row: 3 }]);
    expect(isPlotTileFree(state, 0, 3)).toBe(false);
    expect(isPlotTileFree(state, 0, 3, 0)).toBe(true);
    expect(isPlotTileFree(state, 1, 3)).toBe(true);
  });

  it('rejects structure footprint tiles: farmhouse and notice board, always', () => {
    const state = slice([], { expanded: true });
    // Farmhouse 2x2 footprint (default anchor (-1,-3), render position 933,
    // 521): tiles (0,-3),(1,-3),(0,-2),(1,-2).
    expect(isPlotTileFree(state, 0, -3)).toBe(false);
    expect(isPlotTileFree(state, 1, -2)).toBe(false);
    // RE-PIN (T3.3b-r1): the notice board footprint grew from the single tile
    // (1,0) to the 5-tile diamond (1,0),(1,-1),(1,1),(2,0),(0,0) - the single
    // tile was smaller than the board art, so plots on the covered tiles tucked
    // under/over it. At the default anchor (5,3) those offsets are (6,3),(6,2),
    // (6,4),(7,3),(5,3).
    expect(isPlotTileFree(state, 6, 3)).toBe(false);
    expect(isPlotTileFree(state, 6, 2)).toBe(false);
    expect(isPlotTileFree(state, 6, 4)).toBe(false);
    expect(isPlotTileFree(state, 7, 3)).toBe(false);
    // The board's ANCHOR tile is in its footprint now - a deliberate reversal
    // of the anchor-as-pure-reference convention, for the board only (the art
    // stands on it). The FARMHOUSE anchor keeps the convention and stays free.
    expect(isPlotTileFree(state, 5, 3)).toBe(false);
    expect(isPlotTileFree(state, -1, -3)).toBe(true);
    // Neighbors just outside the 5-tile diamond stay free.
    expect(isPlotTileFree(state, 5, 2)).toBe(true);
    expect(isPlotTileFree(state, 4, 2)).toBe(true);
    expect(isPlotTileFree(state, 7, 4)).toBe(true);
  });

  it('rejects the expand sign tiles only while the sign still stands (unexpanded)', () => {
    expect(isPlotTileFree(slice([]), 3, 3)).toBe(false);
    expect(isPlotTileFree(slice([]), 4, 4)).toBe(false);
    expect(isPlotTileFree(slice([], { expanded: true }), 3, 3)).toBe(true);
    expect(isPlotTileFree(slice([], { expanded: true }), 4, 4)).toBe(true);
  });

  it('rejects a tile whose diamond contains a decoration ground anchor', () => {
    // Tile (0, 3) centers at (156, 960) in the frozen frame.
    const onCenter = slice([], {
      decorations: [{ frame: 'decor_bench', x: 156, y: 960, scale: 0.7, flip: false }],
    });
    expect(isPlotTileFree(onCenter, 0, 3)).toBe(false);
    // On the diamond's edge midpoint (half-width right, half-height up) - inside.
    const onEdge = slice([], {
      decorations: [{ frame: 'decor_bench', x: 156 + 64, y: 960 - 32, scale: 0.7, flip: false }],
    });
    expect(isPlotTileFree(onEdge, 0, 3)).toBe(false);
    // Just past the diamond's right corner - outside, tile stays free.
    const outside = slice([], {
      decorations: [{ frame: 'decor_bench', x: 156 + 130, y: 960, scale: 0.7, flip: false }],
    });
    expect(isPlotTileFree(outside, 0, 3)).toBe(true);
  });

  it('rejects non-placeable and non-integer coordinates', () => {
    const state = slice([]);
    expect(isPlotTileFree(state, 5, 0)).toBe(false); // col-row = 5: diamond off the world's east edge
    expect(isPlotTileFree(state, 0, 4)).toBe(false); // col-row = -4: in the west mere reserve (x < 20)
    expect(isPlotTileFree(state, 99, 99)).toBe(false);
    expect(isPlotTileFree(state, 0.5, 3)).toBe(false);
    expect(isPlotTileFree(state, Number.NaN, 0)).toBe(false);
  });
});

describe('nextChainPlotTile (T3.3a-r chain adjacency preference)', () => {
  function slice(
    plots: { col: number; row: number }[],
    expanded = true,
  ): Pick<
    GameStateData,
    'plots' | 'decorations' | 'expanded' | 'structures' | 'buildings' | 'regionsUnlocked'
  > {
    return {
      plots: plots.map((tile): PlotState => ({ state: 'empty', ...tile })),
      decorations: [],
      expanded,
      structures: defaultStructures(),
      buildings: [],
      regionsUnlocked: [],
    };
  }

  it('single entry: prefers same column next row (col, row + 1)', () => {
    expect(nextChainPlotTile(slice([{ col: 0, row: 0 }]), [{ col: 0, row: 0 }])).toEqual({
      col: 0,
      row: 1,
    });
  });

  it('single entry: falls back to same row next column (col + 1, row) when row + 1 is taken', () => {
    const state = slice([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
    ]);
    expect(nextChainPlotTile(state, [{ col: 0, row: 0 }])).toEqual({ col: 1, row: 0 });
  });

  it('the preference candidates respect blockers, not just occupancy', () => {
    // Unexpanded, from (3, 2): (3, 3) is an expand-sign footprint tile while
    // the sign stands, so the chain skips straight to (4, 2).
    expect(nextChainPlotTile(slice([{ col: 3, row: 2 }], false), [{ col: 3, row: 2 }])).toEqual({
      col: 4,
      row: 2,
    });
  });

  it('continues a column run (T3.3a-r2f direction inference)', () => {
    const history = [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
    ];
    expect(nextChainPlotTile(slice(history), history)).toEqual({ col: 0, row: 2 });
  });

  it('continues a row run - incl. one re-aimed by dragging the second plot beside the first', () => {
    // The caller passes CURRENT tiles, so a second plot dragged to (1, 0)
    // reads as a row step regardless of where it originally spawned.
    const history = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ];
    expect(nextChainPlotTile(slice(history), history)).toEqual({ col: 2, row: 0 });
  });

  it('continues a run UPWARD or LEFTWARD too - direction comes from the history, not a fixed axis', () => {
    // (0, -1) is free: the farmhouse 2x2 footprint (2026-07-17) covers only
    // tiles (0,-3),(1,-3),(0,-2),(1,-2) - rows -3..-2 - so row -1 is clear.
    const upward = [
      { col: 0, row: 1 },
      { col: 0, row: 0 },
    ];
    expect(nextChainPlotTile(slice(upward), upward)).toEqual({ col: 0, row: -1 });
  });

  it('blocked column continuation starts the parallel line at the run start (+1 col)', () => {
    const history = [
      { col: 2, row: 0 },
      { col: 2, row: 1 },
      { col: 2, row: 2 },
    ];
    // (2, 3) blocked by a foreign plot: the next placement opens the
    // adjacent column at the run's FIRST tile - (3, 0).
    const state = slice([...history, { col: 2, row: 3 }]);
    expect(nextChainPlotTile(state, history)).toEqual({ col: 3, row: 0 });
  });

  it('blocked row continuation starts the parallel line at the run start (+1 row)', () => {
    const history = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ];
    const state = slice([...history, { col: 2, row: 0 }]);
    expect(nextChainPlotTile(state, history)).toEqual({ col: 0, row: 1 });
  });

  it('the run starts after the last bend, not at the session start', () => {
    // Row step first, then a column run (1,0) -> (1,2): the current run
    // starts at (1, 0), so the parallel column opens at (2, 0).
    const history = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 1, row: 1 },
      { col: 1, row: 2 },
    ];
    const state = slice([...history, { col: 1, row: 3 }]);
    expect(nextChainPlotTile(state, history)).toEqual({ col: 2, row: 0 });
  });

  it('blocked continuation AND blocked parallel start fall through to nearest-free', () => {
    const history = [
      { col: 2, row: 0 },
      { col: 2, row: 1 },
    ];
    // Continuation (2, 2), parallel start (3, 0), and the 128px-near (1, 0)
    // all blocked: nearest free to (2, 1) is (3, 2) at one tile-height.
    const state = slice([...history, { col: 2, row: 2 }, { col: 3, row: 0 }, { col: 1, row: 0 }]);
    expect(nextChainPlotTile(state, history)).toEqual({ col: 3, row: 2 });
  });

  it('a non-unit last step (a long drag) uses the single-entry rule from the last tile', () => {
    const history = [
      { col: 0, row: 0 },
      { col: 2, row: 2 },
    ];
    expect(nextChainPlotTile(slice(history), history)).toEqual({ col: 2, row: 3 });
  });

  it('hug-aware single entry (T3.3a-r2f3): a neighbor touching an old plot beats plain row + 1', () => {
    // Session plot at (3, 2), pre-existing plot at (3, 0): row + 1 (3, 3) is
    // free but touches nothing old; the up-neighbor (3, 1) hugs (3, 0).
    const state = slice([
      { col: 3, row: 0 },
      { col: 3, row: 2 },
    ]);
    expect(nextChainPlotTile(state, [{ col: 3, row: 2 }])).toEqual({ col: 3, row: 1 });
  });

  it('hug-aware single entry: among several hugging neighbors, row + 1 still leads', () => {
    // Both (1, 2) (touches old (0, 2)) and (2, 1) (touches old (2, 0)) hug;
    // the fixed order keeps row + 1 first.
    const state = slice([
      { col: 2, row: 0 },
      { col: 0, row: 2 },
      { col: 1, row: 1 },
    ]);
    expect(nextChainPlotTile(state, [{ col: 1, row: 1 }])).toEqual({ col: 1, row: 2 });
  });

  it('falls back to the nearest free tile when no neighbor is free or hugging - exact ties break toward hugging', () => {
    // (0, 0)'s row + 1 and col + 1 are taken and no free neighbor touches an
    // old plot; the 128px ring ties (1, 1) against (-1, -1), and (1, 1) wins
    // by hugging (0, 1) (T3.3a-r2f3 tie-break; enumeration order would have
    // picked (-1, -1)).
    const state = slice([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 0 },
    ]);
    expect(nextChainPlotTile(state, [{ col: 0, row: 0 }])).toEqual({ col: 1, row: 1 });
  });

  it('returns null for an empty history or when every placeable tile is blocked', () => {
    expect(nextChainPlotTile(slice([]), [])).toBeNull();
    const full = slice(placeablePlotTiles().map((tile) => ({ ...tile })));
    expect(nextChainPlotTile(full, [{ col: 0, row: 0 }])).toBeNull();
  });
});

describe('bestBatchStartTile (T3.3a-r2f batch-start preference)', () => {
  function slice(
    plots: { col: number; row: number }[],
    decorations: GameStateData['decorations'] = [],
  ): Pick<
    GameStateData,
    'plots' | 'decorations' | 'expanded' | 'structures' | 'buildings' | 'regionsUnlocked'
  > {
    return {
      plots: plots.map((tile): PlotState => ({ state: 'empty', ...tile })),
      decorations,
      expanded: true,
      structures: defaultStructures(),
      buildings: [],
      regionsUnlocked: [],
    };
  }

  /** A decoration anchored exactly on (col, row)'s tile center - blocks that one tile. */
  function decorOn(col: number, row: number): GameStateData['decorations'][number] {
    const { x, y } = gridToIso(col, row);
    return { frame: 'decor_bench', x, y, scale: 0.7, flip: false };
  }

  /** The default 12-plot farm (cols 0..3, rows 0..2) after the expansion purchase. */
  function defaultFarm(
    decorations: GameStateData['decorations'] = [],
  ): Pick<
    GameStateData,
    'plots' | 'decorations' | 'expanded' | 'structures' | 'buildings' | 'regionsUnlocked'
  > {
    return {
      plots: createDefaultState(16).plots,
      decorations,
      expanded: true,
      structures: defaultStructures(),
      buildings: [],
      regionsUnlocked: [],
    };
  }

  /** A 3x3 block (cols/rows 0..2): all four of its faces are fully on the placeable rect. */
  function blockPlots(): { col: number; row: number }[] {
    const tiles: { col: number; row: number }[] = [];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) tiles.push({ col, row });
    return tiles;
  }

  it('starts at the BOTTOM face left end (T3.3a-r2f4 owner scenario: 12-plot farm, 4 grants)', () => {
    expect(bestBatchStartTile(defaultFarm(), 4)).toEqual({ col: 0, row: 3 });
  });

  it('a blocker in the BOTTOM leading run moves the batch to the LEFT face', () => {
    expect(bestBatchStartTile(defaultFarm([decorOn(1, 3)]), 4)).toEqual({ col: -1, row: 0 });
  });

  it('face priority continues RIGHT then TOP as leading runs disqualify', () => {
    // 3x3 block, 3 grants: bottom fails on its leading run's first tile,
    // left on its LAST (partial-face disqualification).
    const right = slice(blockPlots(), [decorOn(0, 3), decorOn(-1, 2)]);
    expect(bestBatchStartTile(right, 3)).toEqual({ col: 3, row: 0 });
    // No farmhouse override needed: the 2x2 footprint (2026-07-17, rows
    // -3..-2) leaves the whole row -1 top face free.
    const top = slice(blockPlots(), [decorOn(0, 3), decorOn(-1, 2), decorOn(3, 1)]);
    expect(bestBatchStartTile(top, 3)).toEqual({ col: 0, row: -1 });
  });

  it('a face longer than the shed count only needs its LEADING tiles free', () => {
    // Bottom face cols 0..3 with (3, 3) blocked: 2 grants only need
    // (0, 3) and (1, 3), so the bottom face still wins...
    expect(bestBatchStartTile(defaultFarm([decorOn(3, 3)]), 2)).toEqual({ col: 0, row: 3 });
    // ...while 4 grants need the whole row and fall through to LEFT.
    expect(bestBatchStartTile(defaultFarm([decorOn(3, 3)]), 4)).toEqual({ col: -1, row: 0 });
  });

  it('a shed count longer than the face: the face still qualifies at its full length', () => {
    // 3-tile bottom face, 5 grants: the leading run caps at the face length.
    expect(bestBatchStartTile(slice(blockPlots()), 5)).toEqual({ col: 0, row: 3 });
  });

  it('no qualifying face: the nearest free tile still touching the block', () => {
    // Default farm, 4 grants, every face's leading tile decor-blocked
    // (T3.3a-r2: the wider placeable rect means RIGHT and TOP no longer
    // auto-fail off-rect, so all four need explicit blockers). The hug
    // fallback picks the nearest block-touching free tile to the plots'
    // center of mass - (3, 3), tied at ~233px with (0, -1), which is now
    // one of the blockers.
    const state = defaultFarm([decorOn(-1, 0), decorOn(0, 3), decorOn(4, 0), decorOn(0, -1)]);
    expect(bestBatchStartTile(state, 4)).toEqual({ col: 3, row: 3 });
  });

  it('no free tile touches the block at all: plain nearest-free to the center of mass', () => {
    // A lone plot with all four neighbors decor-blocked: every face fails,
    // no tile hugs, and the 128px ring's row-major first tile wins.
    const state = slice(
      [{ col: 0, row: 0 }],
      [decorOn(0, 1), decorOn(1, 0), decorOn(0, -1), decorOn(-1, 0)],
    );
    expect(bestBatchStartTile(state, 1)).toEqual({ col: -1, row: -1 });
  });

  it('zero plots (dev case): the nearest free tile to the design center', () => {
    expect(bestBatchStartTile(slice([]), 4)).toEqual({ col: 1, row: 1 });
  });

  it('returns null only when every placeable tile is blocked', () => {
    const full = slice(placeablePlotTiles().map((tile) => ({ ...tile })));
    expect(bestBatchStartTile(full, 4)).toBeNull();
  });

  it('owner scenario end-to-end: 4 grants fill the bottom row rightward, every placement touching the block', () => {
    const original = createDefaultState(16).plots;
    let plots = [...original];
    const state = (): Pick<
      GameStateData,
      'plots' | 'decorations' | 'expanded' | 'structures' | 'buildings' | 'regionsUnlocked'
    > => ({
      plots,
      decorations: [],
      expanded: true,
      structures: defaultStructures(),
      buildings: [],
      regionsUnlocked: [],
    });
    const history: { col: number; row: number }[] = [];
    const place = (tile: { col: number; row: number }): void => {
      plots = [...plots, { state: 'empty', ...tile }];
      history.push(tile);
    };
    const t1 = bestBatchStartTile(state(), 4)!;
    expect(t1).toEqual({ col: 0, row: 3 });
    place(t1);
    // Hug pass: (0, 4) is off the placeable rect, so (1, 3) - touching the
    // old (1, 2) - leads; the two-entry row direction then carries the rest.
    const t2 = nextChainPlotTile(state(), history)!;
    expect(t2).toEqual({ col: 1, row: 3 });
    place(t2);
    const t3 = nextChainPlotTile(state(), history)!;
    expect(t3).toEqual({ col: 2, row: 3 });
    place(t3);
    const t4 = nextChainPlotTile(state(), history)!;
    expect(t4).toEqual({ col: 3, row: 3 });
    place(t4);
    for (const tile of [t1, t2, t3, t4]) {
      const touchesOldBlock = original.some(
        (plot) => Math.abs(plot.col - tile.col) + Math.abs(plot.row - tile.row) === 1,
      );
      expect(touchesOldBlock).toBe(true);
    }
  });
});

describe('grantPlots / placePlot / movePlot (T3.3a)', () => {
  function expandedStore(): GameStateStore {
    const store = new GameStateStore({ storage: null, rng: () => 1 });
    completeOnboarding(store);
    store.addCoins(EXPANSION_COST);
    expect(store.expandFarm()).toBe(true);
    store.consumePlotGrantEvents();
    return store;
  }

  it('grantPlots rejects non-positive or fractional counts, without mutation or events', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.grantPlots(0)).toBe(false);
    expect(store.grantPlots(-2)).toBe(false);
    expect(store.grantPlots(1.5)).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
    expect(store.consumePlotGrantEvents()).toEqual([]);
  });

  it('grantPlots enforces the entitlement cap: 12 placed accepts at most 4, a full save accepts none', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    expect(store.grantPlots(5)).toBe(false);
    expect(store.getState().unplacedPlots).toBe(0);
    expect(store.grantPlots(4)).toBe(true);
    expect(store.getState().unplacedPlots).toBe(4);
    expect(store.grantPlots(1)).toBe(false);
    expect(store.consumePlotGrantEvents()).toEqual([{ count: 4 }]);
  });

  it('placePlot consumes one shed plot onto a free owned tile and returns the new index', () => {
    const store = expandedStore();
    const index = store.placePlot(2, 3);
    expect(index).toBe(12);
    expect(store.getState().plots[12]).toEqual({ state: 'empty', col: 2, row: 3 });
    expect(store.getState().unplacedPlots).toBe(3);
  });

  it('placePlot rejects an occupied tile (double occupancy), without mutation', () => {
    const store = expandedStore();
    expect(store.placePlot(0, 0)).toBe(false); // the base grid's own corner plot
    expect(store.placePlot(0, 3)).toBe(12);
    expect(store.placePlot(0, 3)).toBe(false); // the tile just filled
    expect(store.getState().unplacedPlots).toBe(3);
    expect(store.getState().plots).toHaveLength(13);
  });

  it('placePlot is expansion-independent (T3.3a-r): an unexpanded save places on row 3 and negative tiles', () => {
    const unexpanded = new GameStateStore({ storage: null });
    completeOnboarding(unexpanded);
    expect(unexpanded.grantPlots(2)).toBe(true);
    // Row 3 was unowned pre-expansion under the old zoning; any free
    // placeable tile works now - the purchase only grants plots.
    expect(unexpanded.placePlot(0, 3)).toBe(12);
    expect(unexpanded.placePlot(-2, -1)).toBe(13);
    expect(unexpanded.getState().plots[13]).toEqual({ state: 'empty', col: -2, row: -1 });
  });

  it('placePlot rejects non-placeable tiles, blocked tiles, and non-integer coords', () => {
    const store = expandedStore();
    expect(store.placePlot(5, 0)).toBe(false); // diamond off the world's east edge
    expect(store.placePlot(0, 4)).toBe(false); // west mere reserve (x < 20)
    expect(store.placePlot(0, -2)).toBe(false); // farmhouse footprint
    expect(store.placePlot(6, 3)).toBe(false); // notice-board footprint (5-tile diamond, T3.3b-r1)
    expect(store.placePlot(0.5, 3)).toBe(false);
    expect(store.getState().unplacedPlots).toBe(4);
  });

  it('placePlot rejects the expand sign footprint only while unexpanded', () => {
    const unexpanded = new GameStateStore({ storage: null });
    completeOnboarding(unexpanded);
    expect(unexpanded.grantPlots(1)).toBe(true);
    expect(unexpanded.placePlot(4, 4)).toBe(false); // the sign still stands
    const store = expandedStore();
    expect(store.placePlot(4, 4)).toBe(12); // sign retired by the purchase
  });

  it('placePlot rejects a tile under a decoration ground anchor', () => {
    const store = expandedStore();
    // Anchor a decoration on tile (0, 3)'s center (156, 960).
    store
      .getState()
      .decorations.push({ frame: 'decor_bench', x: 156, y: 960, scale: 0.7, flip: false });
    expect(store.placePlot(0, 3)).toBe(false);
    expect(store.placePlot(1, 3)).toBe(12); // the neighbor stays free
  });

  it('placePlot rejects with an empty shed even on a free owned tile', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.placePlot(0, 0)).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('movePlot relocates an EMPTY plot to a free owned tile and persists its crops-follow identity', () => {
    const store = expandedStore();
    expect(store.movePlot(5, 1, 3)).toBe(true);
    expect(store.getState().plots[5]).toEqual({ state: 'empty', col: 1, row: 3 });
    // The vacated tile is placeable again.
    expect(store.placePlot(...(Object.values(tileOf(5)) as [number, number]))).toBe(12);
  });

  it('movePlot onto its own tile is a valid no-op commit', () => {
    const store = expandedStore();
    const { col, row } = tileOf(5);
    expect(store.movePlot(5, col, row)).toBe(true);
    expect(store.getState().plots[5]).toEqual({ state: 'empty', col, row });
  });

  it('movePlot rejects an occupied target, blocked and non-placeable tiles, and bad coords', () => {
    const store = expandedStore();
    expect(store.movePlot(5, ...(Object.values(tileOf(6)) as [number, number]))).toBe(false);
    expect(store.movePlot(5, 0, -2)).toBe(false); // farmhouse footprint
    expect(store.movePlot(5, 6, 3)).toBe(false); // notice-board footprint
    expect(store.movePlot(5, 5, 0)).toBe(false); // off the world's east edge
    expect(store.movePlot(5, 0, 4)).toBe(false); // west mere reserve (x < 20)
    expect(store.movePlot(5, 1, 3.5)).toBe(false);
    expect(store.getState().plots[5]).toEqual({ state: 'empty', ...tileOf(5) });
  });

  it('movePlot is expansion-independent (T3.3a-r): an unexpanded save moves onto row 3 and negative tiles', () => {
    const unexpanded = new GameStateStore({ storage: null });
    completeOnboarding(unexpanded);
    expect(unexpanded.movePlot(5, 0, 3)).toBe(true);
    expect(unexpanded.movePlot(5, -3, -3)).toBe(true);
    expect(unexpanded.getState().plots[5]).toEqual({ state: 'empty', col: -3, row: -3 });
    // The sign footprint still blocks while the sign stands.
    expect(unexpanded.movePlot(5, 3, 3)).toBe(false);
  });

  it('movePlot refuses a growing plot (harvest first, then move) and an out-of-range index', () => {
    const store = expandedStore();
    expect(store.plantCrop(5, 'sunwheat')).toBe(true);
    expect(store.movePlot(5, 1, 3)).toBe(false);
    expect(store.getState().plots[5]).toMatchObject({ state: 'growing', ...tileOf(5) });
    expect(store.movePlot(99, 1, 3)).toBe(false);
    // Harvested, the same plot moves freely.
    advanceTime(CROPS.sunwheat.growMs);
    expect(store.harvestPlot(5)).toBe(true);
    expect(store.movePlot(5, 1, 3)).toBe(true);
  });

  it('a placed plot round-trips through save/load at its chosen tile', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    store.addCoins(EXPANSION_COST);
    expect(store.expandFarm()).toBe(true);
    expect(store.placePlot(3, 3)).toBe(12);
    expect(store.movePlot(0, 0, 3)).toBe(true);
    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().plots[12]).toEqual({ state: 'empty', col: 3, row: 3 });
    expect(reloaded.getState().plots[0]).toEqual({ state: 'empty', col: 0, row: 3 });
    expect(reloaded.getState().unplacedPlots).toBe(3);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('orders', () => {
  /** A hand-built two-crop order with arbitrary stored rewards - fulfillment
   * must pay exactly these, not anything recomputed from crop data. */
  const TEST_ORDER: Order = {
    items: [
      { cropId: 'sunwheat', count: 3 },
      { cropId: 'starcorn', count: 2 },
    ],
    coinReward: 123,
    xpReward: 9,
  };

  /** A current-version, post-tutorial save with a chosen inventory and
   * TEST_ORDER open in slot 0 (the rails would reject fulfillment mid-chain). */
  function savedStateWithOrder(
    order: Order,
    inventory: Partial<Record<CropId, number>>,
  ): GameStateData {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.inventory = inventory;
    saved.orders[0] = { state: 'open', order };
    return saved;
  }

  it('ensureOrders fills every pending slot with an open order and persists', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage, rng: seededRng(1) });
    expect(store.getState().orders.every((slot) => slot.state === 'pending')).toBe(true);
    store.ensureOrders();
    const orders = store.getState().orders;
    expect(orders).toHaveLength(ORDER_SLOTS);
    expect(orders.every((slot) => slot.state === 'open')).toBe(true);

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().orders).toEqual(orders);
  });

  it('ensureOrders is idempotent - a second call changes nothing', () => {
    const store = new GameStateStore({ storage: null, rng: seededRng(2) });
    store.ensureOrders();
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    store.ensureOrders();
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('generated orders are deterministic under a fixed rng', () => {
    const a = new GameStateStore({ storage: null, rng: seededRng(3) });
    const b = new GameStateStore({ storage: null, rng: seededRng(3) });
    a.ensureOrders();
    b.ensureOrders();
    expect(a.getState().orders).toEqual(b.getState().orders);
  });

  it('ensureOrders never generates a premium order during the tutorial, even with an rng forced to always roll premium', () => {
    const store = new GameStateStore({ storage: null, rng: () => 0 });
    // Onboarding left active (not completed) - the default fresh state.
    store.ensureOrders();
    const orders = store.getState().orders;
    expect(orders.every((slot) => slot.state === 'open' && slot.order.premium === undefined)).toBe(
      true,
    );
  });

  it('ensureOrders can generate premium orders once onboarding is completed', () => {
    const store = new GameStateStore({ storage: null, rng: () => 0 });
    completeOnboarding(store);
    store.ensureOrders();
    const orders = store.getState().orders;
    expect(orders.every((slot) => slot.state === 'open' && slot.order.premium !== undefined)).toBe(
      true,
    );
  });

  it('fulfillOrder pays exactly the stored rewards, deducts items, and persists', () => {
    const saved = savedStateWithOrder(TEST_ORDER, { sunwheat: 5, starcorn: 2 });
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const coinsBefore = store.getState().coins;
    const xpBefore = store.getState().xp;

    expect(store.fulfillOrder(0)).toBe(true);
    const state = store.getState();
    expect(state.coins).toBe(coinsBefore + TEST_ORDER.coinReward);
    expect(state.xp).toBe(xpBefore + TEST_ORDER.xpReward);
    expect(state.inventory.sunwheat).toBe(2);
    expect(state.inventory.starcorn).toBe(0);
    expect(state.orders[0]).toEqual({ state: 'pending' });

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().coins).toBe(state.coins);
    expect(reloaded.getState().orders[0]).toEqual({ state: 'pending' });
  });

  it('fulfillOrder grants premium.moondust to state.moondust when present', () => {
    const premiumOrder: Order = {
      items: [{ cropId: 'sunwheat', count: 1 }],
      coinReward: 10,
      xpReward: 2,
      premium: { moondust: 2, flavor: 'A test flavor line' },
    };
    const saved = savedStateWithOrder(premiumOrder, { sunwheat: 1 });
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const moondustBefore = store.getState().moondust;

    expect(store.fulfillOrder(0)).toBe(true);
    expect(store.getState().moondust).toBe(moondustBefore + 2);

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().moondust).toBe(moondustBefore + 2);
  });

  it('fulfillOrder leaves moondust untouched when the order has no premium field', () => {
    const saved = savedStateWithOrder(TEST_ORDER, { sunwheat: 5, starcorn: 2 });
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const moondustBefore = store.getState().moondust;

    expect(store.fulfillOrder(0)).toBe(true);
    expect(store.getState().moondust).toBe(moondustBefore);
  });

  it('fulfillOrder fails without mutation when inventory is short on any item', () => {
    const saved = savedStateWithOrder(TEST_ORDER, { sunwheat: 5, starcorn: 1 });
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.fulfillOrder(0)).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('fulfillOrder fails on non-open slots and bad indices', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    // All slots are still pending on a fresh store.
    expect(store.fulfillOrder(0)).toBe(false);
    expect(store.fulfillOrder(-1)).toBe(false);
    expect(store.fulfillOrder(ORDER_SLOTS)).toBe(false);
  });

  it('a fulfillment whose xp crosses a threshold queues a level-up event', () => {
    const order: Order = {
      items: [{ cropId: 'sunwheat', count: 1 }],
      coinReward: 10,
      xpReward: xpForLevel(2),
    };
    const saved = savedStateWithOrder(order, { sunwheat: 1 });
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.fulfillOrder(0)).toBe(true);
    expect(store.getState().level).toBe(2);
    expect(store.consumeLevelUpEvents()).toEqual([{ level: 2, unlockedCropIds: ['starcorn'] }]);
  });

  describe('chests (T2.23a)', () => {
    const ONE_CHEST_ORDER: Order = {
      items: [{ cropId: 'sunwheat', count: 1 }],
      coinReward: 10,
      xpReward: 2,
      premium: { moondust: 2, flavor: 'A test flavor line', chests: 1 },
    };
    const TWO_CHEST_ORDER: Order = {
      items: [{ cropId: 'sunwheat', count: 1 }],
      coinReward: 10,
      xpReward: 2,
      premium: { moondust: 2, flavor: 'A test flavor line', chests: 2 },
    };

    it("grants one chest's coins/moondust instantly and queues a matching ChestEvent", () => {
      const saved = savedStateWithOrder(ONE_CHEST_ORDER, { sunwheat: 1 });
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      // fulfillOrder makes no rng calls of its own; grantChests's are the
      // only two for one chest: the first rolls coins, the second the
      // moondust chance. rng()=0 rolls the bottom of the coin range and
      // (0 < CHEST_MOONDUST_CHANCE) hits the moondust bonus.
      const store = new GameStateStore({ storage, rng: stubRng(0, 0) });
      store.load();
      const coinsBefore = store.getState().coins;
      const moondustBefore = store.getState().moondust;

      expect(store.fulfillOrder(0)).toBe(true);
      const state = store.getState();
      // The order's own coinReward, plus the chest's own coin roll - granted together, instantly.
      expect(state.coins).toBe(coinsBefore + ONE_CHEST_ORDER.coinReward + CHEST_COINS_MIN);
      expect(state.moondust).toBe(
        moondustBefore + ONE_CHEST_ORDER.premium!.moondust + CHEST_MOONDUST_AMOUNT,
      );
      const events = store.consumeChestEvents();
      expect(events).toEqual([
        { contents: [{ coins: CHEST_COINS_MIN, moondust: CHEST_MOONDUST_AMOUNT }] },
      ]);
      // Per-chest entries sum to exactly what was granted above.
      expect(events[0]!.contents.reduce((sum, c) => sum + c.coins, 0)).toBe(CHEST_COINS_MIN);
      expect(events[0]!.contents.reduce((sum, c) => sum + c.moondust, 0)).toBe(
        CHEST_MOONDUST_AMOUNT,
      );
    });

    it('rolls and sums two chests worth of contents for a premium.chests: 2 order', () => {
      const saved = savedStateWithOrder(TWO_CHEST_ORDER, { sunwheat: 1 });
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      // Four rng calls: chest 1 coins, chest 1 moondust chance, chest 2
      // coins, chest 2 moondust chance.
      const store = new GameStateStore({ storage, rng: stubRng(0, 0, 0.999999, 1) });
      store.load();
      expect(store.fulfillOrder(0)).toBe(true);
      // chest 1: coins=MIN, moondust=AMOUNT (0 < chance); chest 2: coins=MAX
      // (0.999999), moondust=0 (1 is not < the chance). Individual rolls
      // preserved, not summed.
      const events = store.consumeChestEvents();
      expect(events).toEqual([
        {
          contents: [
            { coins: CHEST_COINS_MIN, moondust: CHEST_MOONDUST_AMOUNT },
            { coins: CHEST_COINS_MAX, moondust: 0 },
          ],
        },
      ]);
      // Per-chest entries sum to exactly what fulfillOrder granted to state.
      expect(events[0]!.contents.reduce((sum, c) => sum + c.coins, 0)).toBe(
        CHEST_COINS_MIN + CHEST_COINS_MAX,
      );
      expect(events[0]!.contents.reduce((sum, c) => sum + c.moondust, 0)).toBe(
        CHEST_MOONDUST_AMOUNT,
      );
    });

    it('does not queue a chest event on a premium order with no chests field', () => {
      const order: Order = {
        items: [{ cropId: 'sunwheat', count: 1 }],
        coinReward: 10,
        xpReward: 2,
        premium: { moondust: 1, flavor: 'text' },
      };
      const saved = savedStateWithOrder(order, { sunwheat: 1 });
      const store = new GameStateStore({
        storage: makeStorage({ [SAVE_KEY]: JSON.stringify(saved) }),
        rng: () => 0,
      });
      store.load();
      expect(store.fulfillOrder(0)).toBe(true);
      expect(store.consumeChestEvents()).toEqual([]);
    });

    it('does not queue a chest event on a non-premium order', () => {
      const saved = savedStateWithOrder(TEST_ORDER, { sunwheat: 3, starcorn: 2 });
      const store = new GameStateStore({
        storage: makeStorage({ [SAVE_KEY]: JSON.stringify(saved) }),
        rng: () => 0,
      });
      store.load();
      expect(store.fulfillOrder(0)).toBe(true);
      expect(store.consumeChestEvents()).toEqual([]);
    });

    it('consumeChestEvents drains once - a second call returns empty', () => {
      const saved = savedStateWithOrder(ONE_CHEST_ORDER, { sunwheat: 1 });
      const store = new GameStateStore({
        storage: makeStorage({ [SAVE_KEY]: JSON.stringify(saved) }),
        rng: () => 0,
      });
      store.load();
      expect(store.fulfillOrder(0)).toBe(true);
      expect(store.consumeChestEvents()).toHaveLength(1);
      expect(store.consumeChestEvents()).toEqual([]);
    });

    it('the chest queue clears on load, reset, and importSave without being drained first', () => {
      const buildStoreWithPendingEvent = (): GameStateStore => {
        const saved = savedStateWithOrder(ONE_CHEST_ORDER, { sunwheat: 1 });
        const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
        const store = new GameStateStore({ storage, rng: () => 0 });
        store.load();
        expect(store.fulfillOrder(0)).toBe(true);
        return store;
      };

      const loadStore = buildStoreWithPendingEvent();
      loadStore.load();
      expect(loadStore.consumeChestEvents()).toEqual([]);

      const resetStore = buildStoreWithPendingEvent();
      resetStore.reset();
      expect(resetStore.consumeChestEvents()).toEqual([]);

      const importStore = buildStoreWithPendingEvent();
      const freshExport = new GameStateStore({ storage: null }).exportSave();
      importStore.importSave(freshExport);
      expect(importStore.consumeChestEvents()).toEqual([]);
    });
  });

  it('skipOrder puts an open slot on a now()-based cooldown and persists', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage, rng: seededRng(4) });
    completeOnboarding(store);
    store.ensureOrders();
    const before = now();
    expect(store.skipOrder(0)).toBe(true);
    const slot = store.getState().orders[0];
    expect(slot?.state).toBe('cooldown');
    if (slot?.state === 'cooldown') {
      // First skip of a fresh streak: the base cooldown, unescalated.
      expect(slot.readyAt).toBeGreaterThanOrEqual(before + SKIP_COOLDOWN_BASE_MS);
      expect(slot.readyAt).toBeLessThanOrEqual(now() + SKIP_COOLDOWN_BASE_MS);
    }
    const orderSkips = store.getState().orderSkips;
    expect(orderSkips.count).toBe(1);
    expect(orderSkips.lastAt).toBeGreaterThanOrEqual(before);

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().orders[0]).toEqual(slot);
    expect(reloaded.getState().orderSkips).toEqual(orderSkips);
  });

  it('skipOrder fails on non-open slots and bad indices without mutation', () => {
    const store = new GameStateStore({ storage: null, rng: seededRng(5) });
    completeOnboarding(store);
    // Pending slot: nothing to skip yet.
    expect(store.skipOrder(0)).toBe(false);
    store.ensureOrders();
    expect(store.skipOrder(1)).toBe(true);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    // Already on cooldown, and out-of-range indices.
    expect(store.skipOrder(1)).toBe(false);
    expect(store.skipOrder(-1)).toBe(false);
    expect(store.skipOrder(ORDER_SLOTS)).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('ensureOrders reopens a skipped slot only after the cooldown elapses', () => {
    const store = new GameStateStore({ storage: null, rng: seededRng(6) });
    completeOnboarding(store);
    store.ensureOrders();
    expect(store.skipOrder(0)).toBe(true);
    store.ensureOrders();
    expect(store.getState().orders[0]?.state).toBe('cooldown');
    advanceTime(SKIP_COOLDOWN_BASE_MS + 1);
    store.ensureOrders();
    expect(store.getState().orders[0]?.state).toBe('open');
  });

  it('escalates consecutive skip cooldowns 3s, 15s, 60s, 60s, then stays capped', () => {
    const store = new GameStateStore({ storage: null, rng: seededRng(7) });
    completeOnboarding(store);
    store.ensureOrders();
    const expectedCooldowns = [
      SKIP_COOLDOWN_BASE_MS,
      SKIP_COOLDOWN_BASE_MS * SKIP_COOLDOWN_GROWTH,
      SKIP_COOLDOWN_MAX_MS,
      SKIP_COOLDOWN_MAX_MS,
    ];
    expect(expectedCooldowns).toEqual([3000, 15_000, 60_000, 60_000]);
    for (const expectedCooldown of expectedCooldowns) {
      const before = now();
      expect(store.skipOrder(0)).toBe(true);
      const slot = store.getState().orders[0];
      expect(slot?.state).toBe('cooldown');
      if (slot?.state === 'cooldown') {
        expect(slot.readyAt).toBe(before + expectedCooldown);
      }
      // Reopen the same slot right as its cooldown elapses, well within the
      // streak-reset window, so the next iteration's skip is the next one
      // in the same escalating streak.
      advanceTime(expectedCooldown);
      store.ensureOrders();
    }
  });

  it('a gap over SKIP_STREAK_RESET_MS resets the streak to the base cooldown', () => {
    const store = new GameStateStore({ storage: null, rng: seededRng(8) });
    completeOnboarding(store);
    store.ensureOrders();
    expect(store.skipOrder(0)).toBe(true); // streak count 0 -> 1
    advanceTime(SKIP_COOLDOWN_BASE_MS * SKIP_COOLDOWN_GROWTH);
    store.ensureOrders();
    expect(store.skipOrder(0)).toBe(true); // streak count 1 -> 2
    expect(store.getState().orderSkips.count).toBe(2);

    // A gap longer than the reset window wipes the streak before the next skip.
    advanceTime(SKIP_STREAK_RESET_MS + 1);
    store.ensureOrders();
    const before = now();
    expect(store.skipOrder(0)).toBe(true);
    const slot = store.getState().orders[0];
    expect(slot?.state).toBe('cooldown');
    if (slot?.state === 'cooldown') {
      expect(slot.readyAt).toBe(before + SKIP_COOLDOWN_BASE_MS);
    }
    expect(store.getState().orderSkips.count).toBe(1);
  });
});

describe('onboarding', () => {
  /** Index of a step id in the chain; the walk test asserts against these. */
  function stepIndex(id: string): number {
    return ONBOARDING_STEPS.findIndex((step) => step.id === id);
  }

  /** A current-version save parked at `step` with overrides applied. */
  function savedAtStep(step: number, overrides: Partial<GameStateData> = {}): GameStateData {
    const saved = createDefaultState(12);
    saved.onboarding = { completed: false, step, progress: 0, progressB: 0 };
    return { ...saved, ...overrides };
  }

  it('walks the full 10-step chain with the exact first-session economy', () => {
    const store = new GameStateStore({ storage: makeStorage(), rng: seededRng(1) });
    store.ensureOrders(); // as the scene does on create
    const onboarding = () => store.getState().onboarding;
    expect(onboarding()).toEqual({ completed: false, step: 0, progress: 0, progressB: 0 });

    // Wrong UI event: no progress.
    store.notifyOnboardingUiEvent('open-orders');
    expect(onboarding().step).toBe(0);

    // 1 select-sunwheat.
    store.notifyOnboardingUiEvent('select-sunwheat');
    expect(onboarding()).toEqual({ completed: false, step: 1, progress: 0, progressB: 0 });

    // 2 plant-first: one sunwheat.
    expect(store.plantCrop(0, 'sunwheat')).toBe(true);
    expect(store.getState().coins).toBe(45);
    expect(onboarding().step).toBe(stepIndex('plant-rest'));

    // 3 plant-rest: nine more; the seed spend lands coins exactly on 0.
    for (let i = 1; i <= 9; i++) expect(store.plantCrop(i, 'sunwheat')).toBe(true);
    expect(store.getState().coins).toBe(0);
    expect(onboarding()).toEqual({
      completed: false,
      step: stepIndex('harvest-first'),
      progress: 0,
      progressB: 0,
    });

    // 4 harvest-first: exactly one harvest advances; it must not leak a
    // count into harvest-rest.
    advanceTime(CROPS.sunwheat.growMs);
    expect(store.harvestPlot(0)).toBe(true);
    expect(onboarding()).toEqual({
      completed: false,
      step: stepIndex('harvest-rest'),
      progress: 0,
      progressB: 0,
    });

    // 5 harvest-rest: nine more -> 10 sunwheat held, 20 xp, still level 1.
    for (let i = 1; i <= 9; i++) expect(store.harvestPlot(i)).toBe(true);
    expect(store.getState().inventory.sunwheat).toBe(10);
    expect(store.getState().xp).toBe(20);
    expect(store.getState().level).toBe(1);
    expect(onboarding().step).toBe(stepIndex('open-orders'));

    // 6 open-orders: ORDER A is scripted into slot 0 as the deliver step begins.
    store.notifyOnboardingUiEvent('open-orders');
    expect(onboarding().step).toBe(stepIndex('deliver-sunwheat'));
    expect(store.getState().orders[0]).toEqual({ state: 'open', order: ONBOARDING_ORDER_A });

    // 7 deliver-sunwheat: +95 coins, +10 xp -> exactly the 30 xp level-2
    // threshold; the celebration and starcorn reveal fire here by design.
    expect(store.fulfillOrder(0)).toBe(true);
    expect(store.getState().coins).toBe(95);
    expect(store.getState().xp).toBe(30);
    expect(store.getState().xp).toBe(xpForLevel(2));
    expect(store.getState().level).toBe(2);
    expect(store.consumeLevelUpEvents()).toEqual([{ level: 2, unlockedCropIds: ['starcorn'] }]);
    expect(store.getState().inventory.sunwheat).toBe(4);
    // ORDER B replaces slot 0 the moment review-order begins - open, never
    // pending - so the player reviews it on the still-open board.
    expect(store.getState().orders[0]).toEqual({ state: 'open', order: ONBOARDING_ORDER_B });
    expect(onboarding().step).toBe(stepIndex('review-order'));

    // 8 review-order: too early, the dwell guard does not advance it yet.
    store.autoAdvanceOnboarding();
    expect(onboarding().step).toBe(stepIndex('review-order'));
    // Once the board has been open for the full read-dwell, it self-advances
    // even though the board is still open.
    advanceTime(REVIEW_ORDER_DWELL_MS);
    store.autoAdvanceOnboarding();
    expect(onboarding().step).toBe(stepIndex('close-orders'));

    // 9 close-orders: closing the board (still open from the dwell path)
    // advances unconditionally.
    store.notifyOnboardingUiEvent('close-orders');
    expect(onboarding().step).toBe(stepIndex('plant-mixed'));

    // 10 plant-mixed: 8 sunwheat then 4 starcorn, affordable WITHOUT selling
    // -> exactly 7 coins left, and the tutorial completes permanently.
    for (let i = 0; i < 8; i++) expect(store.plantCrop(i, 'sunwheat')).toBe(true);
    expect(onboarding()).toEqual({
      completed: false,
      step: stepIndex('plant-mixed'),
      progress: 8,
      progressB: 0,
    });
    // The rails reject a 9th sunwheat outright - no coins spent.
    expect(store.plantCrop(8, 'sunwheat')).toBe(false);
    expect(store.getState().coins).toBe(55);
    expect(store.getState().plots[8]).toEqual({ state: 'empty', ...tileOf(8) });
    for (let i = 8; i < 12; i++) expect(store.plantCrop(i, 'starcorn')).toBe(true);
    expect(store.getState().coins).toBe(7);
    expect(store.getState().inventory.sunwheat).toBe(4);
    expect(store.getState().level).toBe(2);
    expect(store.getState().plots.every((plot) => plot.state === 'growing')).toBe(true);
    expect(onboarding()).toEqual({
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    });
  });

  /** A store loaded from a save parked at `step` (see savedAtStep). */
  function storeAtStep(step: number, overrides: Partial<GameStateData> = {}): GameStateStore {
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(savedAtStep(step, overrides)) });
    const store = new GameStateStore({ storage });
    store.load();
    return store;
  }

  it('board-close events only advance their own step', () => {
    const store = storeAtStep(stepIndex('open-orders'));
    // The board is closed, but that is not this step's action.
    store.notifyOnboardingUiEvent('review-order');
    store.notifyOnboardingUiEvent('close-orders');
    expect(store.getState().onboarding.step).toBe(stepIndex('open-orders'));
    store.notifyOnboardingUiEvent('open-orders');
    expect(store.getState().onboarding.step).toBe(stepIndex('deliver-sunwheat'));
  });

  it('an early board close advances review-order then close-orders back to back', () => {
    const store = storeAtStep(stepIndex('review-order'));
    // Well under the dwell: the guard alone must not advance it.
    store.autoAdvanceOnboarding();
    expect(store.getState().onboarding.step).toBe(stepIndex('review-order'));
    // The board closes early - the notifier fires both events in order, so
    // the close is never lost and neither step can wedge.
    store.notifyOnboardingUiEvent('review-order');
    expect(store.getState().onboarding.step).toBe(stepIndex('close-orders'));
    store.notifyOnboardingUiEvent('close-orders');
    expect(store.getState().onboarding.step).toBe(stepIndex('plant-mixed'));
  });

  it('a reload mid-review-order restarts the read-dwell', () => {
    const storage = makeStorage({
      [SAVE_KEY]: JSON.stringify(savedAtStep(stepIndex('review-order'))),
    });
    const store = new GameStateStore({ storage });
    store.load();
    advanceTime(REVIEW_ORDER_DWELL_MS - 1);
    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    // The in-memory step-entered timestamp reset on load, so the almost-
    // elapsed dwell from before the reload does not carry over.
    reloaded.autoAdvanceOnboarding();
    expect(reloaded.getState().onboarding.step).toBe(stepIndex('review-order'));
    advanceTime(REVIEW_ORDER_DWELL_MS);
    reloaded.autoAdvanceOnboarding();
    expect(reloaded.getState().onboarding.step).toBe(stepIndex('close-orders'));
  });

  it('the auto-advance guard is a no-op off the review-order step', () => {
    const store = storeAtStep(0);
    store.autoAdvanceOnboarding();
    expect(store.getState().onboarding.step).toBe(0);
  });

  it('rails: plantCrop rejects any planting outside the plant steps, with no coin spend', () => {
    const store = storeAtStep(stepIndex('harvest-first'), { coins: 100 });
    expect(store.plantCrop(0, 'sunwheat')).toBe(false);
    expect(store.getState().coins).toBe(100);
    expect(store.getState().plots[0]).toEqual({ state: 'empty', ...tileOf(0) });
  });

  it('rails: the single-crop plant steps reject everything but sunwheat', () => {
    const saved = savedAtStep(stepIndex('plant-rest'), { coins: 10_000 });
    saved.level = 2; // starcorn is unlocked and affordable - only the rails say no
    saved.xp = xpForLevel(2);
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.plantCrop(0, 'starcorn')).toBe(false);
    expect(store.getState().coins).toBe(10_000);
    expect(store.getState().plots[0]).toEqual({ state: 'empty', ...tileOf(0) });
    expect(store.plantCrop(1, 'sunwheat')).toBe(true);
    expect(store.getState().onboarding.progress).toBe(1);
  });

  it('rails: harvestPlot rejects a ready plot outside the harvest steps', () => {
    const saved = savedAtStep(stepIndex('open-orders'));
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: now() - CROPS.sunwheat.growMs,
      ...tileOf(0),
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.harvestPlot(0)).toBe(false);
    expect(store.getState().plots[0]?.state).toBe('growing');
    expect(store.getState().inventory.sunwheat).toBeUndefined();
  });

  it('rails: sellCrop returns 0 for every crop during onboarding, without mutation', () => {
    const saved = savedAtStep(stepIndex('deliver-sunwheat'), {
      inventory: { sunwheat: 10, starcorn: 3 },
    });
    saved.level = 2;
    saved.xp = xpForLevel(2);
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.sellCrop('sunwheat')).toBe(0);
    expect(store.sellCrop('starcorn')).toBe(0);
    expect(store.getState().inventory).toEqual({ sunwheat: 10, starcorn: 3 });
    expect(store.getState().coins).toBe(50);
  });

  it('rails: fulfillOrder permits only slot 0 during deliver-sunwheat', () => {
    const saved = savedAtStep(stepIndex('deliver-sunwheat'), { inventory: { sunwheat: 12 } });
    saved.orders[0] = { state: 'open', order: ONBOARDING_ORDER_A };
    saved.orders[1] = {
      state: 'open',
      order: { items: [{ cropId: 'sunwheat', count: 1 }], coinReward: 5, xpReward: 1 },
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    // Slot 1 is open and covered, but it is not the scripted order.
    expect(store.fulfillOrder(1)).toBe(false);
    expect(store.getState().inventory.sunwheat).toBe(12);
    expect(store.getState().orders[1]?.state).toBe('open');
    expect(store.fulfillOrder(0)).toBe(true);
  });

  it('rails: fulfillOrder rejects a covered order outside the deliver step', () => {
    const saved = savedAtStep(stepIndex('close-orders'), { inventory: { sunwheat: 12 } });
    saved.orders[0] = { state: 'open', order: ONBOARDING_ORDER_A };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.fulfillOrder(0)).toBe(false);
    expect(store.getState().inventory.sunwheat).toBe(12);
    expect(store.getState().orders[0]?.state).toBe('open');
  });

  it('rails: skipOrder is rejected during onboarding', () => {
    const saved = savedAtStep(stepIndex('open-orders'));
    saved.orders[0] = { state: 'open', order: ONBOARDING_ORDER_A };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.skipOrder(0)).toBe(false);
    expect(store.getState().orders[0]?.state).toBe('open');
  });

  it('rails: expandFarm is rejected during onboarding even with the coins', () => {
    const store = storeAtStep(stepIndex('plant-mixed'), { coins: EXPANSION_COST });
    expect(store.expandFarm()).toBe(false);
    expect(store.getState().coins).toBe(EXPANSION_COST);
    expect(store.getState().plots).toHaveLength(BASE_PLOT_COUNT);
  });

  it('plant-mixed rejects wrong crops and overshoots of either counter outright', () => {
    const saved = savedAtStep(stepIndex('plant-mixed'), { coins: 10_000 });
    saved.level = 3; // glowberry plantable by level - the rails still say no
    saved.xp = xpForLevel(3);
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const onboarding = () => store.getState().onboarding;

    // Wrong crop: rejected by the rails, not merely uncounted.
    expect(store.plantCrop(0, 'glowberry')).toBe(false);
    expect(store.getState().plots[0]).toEqual({ state: 'empty', ...tileOf(0) });
    expect(onboarding().progressB).toBe(0);

    // Starcorn caps at its 4 goal: the 5th is rejected with no coin spend.
    for (let i = 0; i < 4; i++) expect(store.plantCrop(i, 'starcorn')).toBe(true);
    const coinsAfterStarcorn = store.getState().coins;
    expect(store.plantCrop(4, 'starcorn')).toBe(false);
    expect(store.getState().coins).toBe(coinsAfterStarcorn);
    expect(onboarding()).toEqual({
      completed: false,
      step: stepIndex('plant-mixed'),
      progress: 0,
      progressB: 4,
    });

    // Not completed until BOTH goals are met; the 8th sunwheat finishes it.
    for (let i = 4; i < 12; i++) expect(store.plantCrop(i, 'sunwheat')).toBe(true);
    expect(onboarding().completed).toBe(true);
  });

  it('resumes at the same step and counters after a reload', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage, rng: seededRng(2) });
    store.notifyOnboardingUiEvent('select-sunwheat');
    store.plantCrop(0, 'sunwheat'); // completes plant-first
    store.plantCrop(1, 'sunwheat'); // one into plant-rest
    expect(store.getState().onboarding).toEqual({
      completed: false,
      step: 2,
      progress: 1,
      progressB: 0,
    });

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().onboarding).toEqual({
      completed: false,
      step: 2,
      progress: 1,
      progressB: 0,
    });
  });

  it('resumes mid-plant-mixed with both counters intact', () => {
    const storage = makeStorage();
    const saved = savedAtStep(stepIndex('plant-mixed'), { coins: 10_000 });
    saved.level = 2;
    saved.xp = xpForLevel(2);
    storage.setItem(SAVE_KEY, JSON.stringify(saved));
    const store = new GameStateStore({ storage });
    store.load();
    store.plantCrop(0, 'sunwheat');
    store.plantCrop(1, 'starcorn');
    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().onboarding).toEqual({
      completed: false,
      step: stepIndex('plant-mixed'),
      progress: 1,
      progressB: 1,
    });
  });

  it('never tracks again after completion', () => {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.inventory = { sunwheat: 10 };
    saved.orders[0] = {
      state: 'open',
      order: { items: [{ cropId: 'sunwheat', count: 5 }], coinReward: 10, xpReward: 1 },
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const done = { ...saved.onboarding };
    store.notifyOnboardingUiEvent('select-sunwheat');
    store.notifyOnboardingUiEvent('open-orders');
    store.notifyOnboardingUiEvent('review-order');
    store.notifyOnboardingUiEvent('close-orders');
    store.autoAdvanceOnboarding();
    expect(store.plantCrop(0, 'sunwheat')).toBe(true);
    advanceTime(CROPS.sunwheat.growMs);
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.fulfillOrder(0)).toBe(true);
    expect(store.sellCrop('sunwheat')).toBeGreaterThan(0);
    expect(store.getState().onboarding).toEqual(done);
    // The fulfilled-during-onboarding hook never fires either: the delivered
    // slot goes back to pending instead of ORDER B.
    expect(store.getState().orders[0]).toEqual({ state: 'pending' });
  });

  it('once completed, every rails gate is open - zero post-tutorial behavior change', () => {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.coins = EXPANSION_COST + 100;
    saved.level = 2;
    saved.xp = xpForLevel(2);
    saved.inventory = { sunwheat: 10 };
    saved.orders[0] = {
      state: 'open',
      order: { items: [{ cropId: 'sunwheat', count: 5 }], coinReward: 10, xpReward: 1 },
    };
    saved.orders[1] = {
      state: 'open',
      order: { items: [{ cropId: 'sunwheat', count: 1 }], coinReward: 5, xpReward: 1 },
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    // Any crop plants, any ready plot harvests, any covered slot fulfills,
    // skipping/selling/expanding all work - the rails never bite again.
    expect(store.plantCrop(0, 'starcorn')).toBe(true);
    expect(store.plantCrop(1, 'sunwheat')).toBe(true);
    advanceTime(CROPS.sunwheat.growMs);
    expect(store.harvestPlot(1)).toBe(true);
    expect(store.fulfillOrder(0)).toBe(true);
    expect(store.skipOrder(1)).toBe(true);
    expect(store.sellCrop('sunwheat')).toBeGreaterThan(0);
    expect(store.expandFarm()).toBe(true);
  });

  it('chain completion arms the tutorial-complete one-shot: true once, then false', () => {
    const saved = savedAtStep(stepIndex('plant-mixed'), { coins: 10_000 });
    saved.level = 2;
    saved.xp = xpForLevel(2);
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    // Nothing pending mid-chain.
    expect(store.consumeTutorialCompleteEvent()).toBe(false);
    for (let i = 0; i < 8; i++) expect(store.plantCrop(i, 'sunwheat')).toBe(true);
    // Still not pending until BOTH goals complete the final step.
    expect(store.consumeTutorialCompleteEvent()).toBe(false);
    for (let i = 8; i < 12; i++) expect(store.plantCrop(i, 'starcorn')).toBe(true);
    expect(store.getState().onboarding.completed).toBe(true);
    expect(store.consumeTutorialCompleteEvent()).toBe(true);
    expect(store.consumeTutorialCompleteEvent()).toBe(false);
  });

  it('a mid-chain save completed via the v7 -> v8 migration never fires the one-shot', () => {
    const saved = createDefaultState(12) as unknown as Record<string, unknown>;
    saved.version = 7;
    saved.onboarding = { completed: false, step: 5, progress: 1, progressB: 0 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().onboarding.completed).toBe(true);
    expect(store.consumeTutorialCompleteEvent()).toBe(false);
  });

  it('loading an already-completed save never fires the one-shot', () => {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.consumeTutorialCompleteEvent()).toBe(false);
  });
});

describe('leveling', () => {
  it('queues one event on a single-level gain, and clears on consume', () => {
    const store = new GameStateStore({ storage: null });
    store.addXp(xpForLevel(2));
    expect(store.getState().level).toBe(2);
    const events = store.consumeLevelUpEvents();
    expect(events).toEqual([{ level: 2, unlockedCropIds: ['starcorn'] }]);
    expect(store.consumeLevelUpEvents()).toEqual([]);
  });

  it('queues one event per level, in order, on a multi-level jump', () => {
    const store = new GameStateStore({ storage: null });
    store.addXp(xpForLevel(3));
    expect(store.getState().level).toBe(3);
    expect(store.consumeLevelUpEvents()).toEqual([
      { level: 2, unlockedCropIds: ['starcorn'] },
      { level: 3, unlockedCropIds: ['glowberry'] },
    ]);
  });

  it('queues an event even for a level that unlocks no crop (6, since the T3.11 cap raise)', () => {
    const store = new GameStateStore({ storage: null });
    store.addXp(xpForLevel(MAX_LEVEL));
    expect(store.getState().level).toBe(MAX_LEVEL);
    const events = store.consumeLevelUpEvents();
    expect(events.map((e) => e.level)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(events.find((e) => e.level === 4)?.unlockedCropIds).toEqual(['moonroot']);
    expect(events.find((e) => e.level === 5)?.unlockedCropIds).toEqual(['emberpepper']);
    expect(events.find((e) => e.level === 6)?.unlockedCropIds).toEqual([]);
    expect(events.find((e) => e.level === 7)?.unlockedCropIds).toEqual(['dewmelon']);
    expect(events.find((e) => e.level === 8)?.unlockedCropIds).toEqual(['sagesprig']);
  });

  it('harvesting queues the same kind of event as addXp', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1000); // enough seed cost for many plantings
    // sunwheat xp is small; plant/warp/harvest enough to cross the level-2 threshold.
    let harvested = 0;
    while (store.getState().level < 2 && harvested < 100) {
      store.plantCrop(0, 'sunwheat');
      advanceTime(CROPS.sunwheat.growMs);
      store.harvestPlot(0);
      harvested++;
    }
    expect(store.getState().level).toBe(2);
    expect(store.consumeLevelUpEvents()).toEqual([{ level: 2, unlockedCropIds: ['starcorn'] }]);
  });

  it('level never decreases, and xp catching up after a setLevel jump-ahead queues nothing', () => {
    const store = new GameStateStore({ storage: null });
    store.setLevel(4);
    expect(store.getState().level).toBe(4);
    // This would be a level-2 gain from scratch, well below the level-4 floor.
    store.addXp(xpForLevel(2));
    expect(store.getState().level).toBe(4);
    expect(store.consumeLevelUpEvents()).toEqual([]);
  });

  it('reconciles level silently on load when xp implies a higher level than stored', () => {
    const saved = { ...createDefaultState(2), xp: xpForLevel(3), level: 1 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().level).toBe(3);
    expect(store.getState().xp).toBe(xpForLevel(3));
    expect(store.consumeLevelUpEvents()).toEqual([]);
  });

  it('reconciles level silently on import when xp implies a higher level than stored', () => {
    const saved = { ...createDefaultState(2), xp: xpForLevel(3), level: 1 };
    const store = new GameStateStore({ storage: makeStorage() });
    expect(store.importSave(JSON.stringify(saved))).toBe(true);
    expect(store.getState().level).toBe(3);
    expect(store.consumeLevelUpEvents()).toEqual([]);
  });

  it('a fresh store never has pending events', () => {
    const store = new GameStateStore({ storage: null });
    expect(store.consumeLevelUpEvents()).toEqual([]);
  });
});

describe('offline growth (app closed during growth)', () => {
  it('a growing plot matures across a save/load round-trip', () => {
    const storage = makeStorage();
    const writer = new GameStateStore({ storage });
    completeOnboarding(writer);
    expect(writer.plantCrop(0, 'sunwheat')).toBe(true);
    // The app "closes" here; time passes while nothing is running.
    advanceTime(CROPS.sunwheat.growMs + 1);
    // rng pinned above RADIANT_CHANCE - see the index-13 test above.
    const reader = new GameStateStore({ storage, rng: () => 1 });
    reader.load();
    expect(reader.harvestPlot(0)).toBe(true);
    expect(reader.getState().inventory.sunwheat).toBe(1);
  });

  it('a save whose plantedAt long predates load is immediately ready', () => {
    const saved = createDefaultState(1);
    // Any xp marks the v1 save a veteran in v3 -> v4, skipping the tutorial -
    // otherwise the rails would block this test's post-load harvest.
    saved.xp = 1;
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: now() - CROPS.sunwheat.growMs - 60_000,
      ...tileOf(0),
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    // rng pinned above RADIANT_CHANCE - see the index-13 test above.
    const store = new GameStateStore({ storage, rng: () => 1 });
    store.load();
    expect(console.warn).not.toHaveBeenCalled();
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().inventory.sunwheat).toBe(1);
  });

  it('rejects growing plots with an unknown crop or bad timestamp', () => {
    for (const badPlot of [
      { state: 'growing', cropId: 'tomato', plantedAt: 0 },
      { state: 'growing', cropId: 'sunwheat', plantedAt: 'yesterday' },
      { state: 'growing', cropId: 'sunwheat', plantedAt: Infinity },
    ]) {
      const saved = { ...createDefaultState(1), plots: [...createDefaultState(1).plots] };
      saved.plots[0] = badPlot as never;
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState().plots[0]).toEqual({ state: 'empty', ...tileOf(0) });
      expect(console.warn).toHaveBeenCalled();
    }
  });
});

describe('clampFuturePlantedAt (warped or skewed clock on load)', () => {
  it('clamps a future-stamped growing plot to load time; past-stamped plots are untouched', () => {
    const pastPlantedAt = Date.now() - 60_000;
    const saved = createDefaultState(12);
    saved.xp = 1; // veteran save skips the tutorial, so a post-load harvest is unblocked.
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: Date.now() + 60_000,
      ...tileOf(0),
    };
    saved.plots[1] = {
      state: 'growing',
      cropId: 'starcorn',
      plantedAt: pastPlantedAt,
      ...tileOf(1),
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    const before = Date.now();
    store.load();
    const after = Date.now();
    const state = store.getState();
    const plot0 = state.plots[0];
    expect(plot0?.state).toBe('growing');
    if (plot0?.state === 'growing') {
      expect(plot0.plantedAt).toBeGreaterThanOrEqual(before);
      expect(plot0.plantedAt).toBeLessThanOrEqual(after);
    }
    // Not yet ready right after clamping - growth restarted from load time.
    expect(store.harvestPlot(0)).toBe(false);
    // The past-stamped plot kept its original timestamp exactly.
    expect(state.plots[1]).toEqual({
      state: 'growing',
      cropId: 'starcorn',
      plantedAt: pastPlantedAt,
      ...tileOf(1),
    });
    // DELIBERATE RE-PIN (T4.2a): the clamp now also counts future milling
    // batch startedAt stamps, so the message dropped the word "crop".
    expect(console.info).toHaveBeenCalledWith('littleacres: clamped 1 future timestamps');
  });

  it('a save with only past-stamped plots loads byte-identical - no clamping, no log', () => {
    // Stamped at the CURRENT schema version so the load performs no migration
    // and the round-trip really is byte-identical (T4.1: 22 -> 23).
    const saved = createDefaultState(24);
    saved.xp = 1;
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: Date.now() - CROPS.sunwheat.growMs - 1,
      ...tileOf(0),
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState()).toEqual(saved);
    expect(console.info).not.toHaveBeenCalled();
  });

  it('importSave clamps a future-stamped plot the same way', () => {
    const saved = createDefaultState(12);
    saved.xp = 1;
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: Date.now() + 60_000,
      ...tileOf(0),
    };
    const store = new GameStateStore({ storage: makeStorage() });
    const before = Date.now();
    expect(store.importSave(JSON.stringify(saved))).toBe(true);
    const after = Date.now();
    const plot0 = store.getState().plots[0];
    expect(plot0?.state).toBe('growing');
    if (plot0?.state === 'growing') {
      expect(plot0.plantedAt).toBeGreaterThanOrEqual(before);
      expect(plot0.plantedAt).toBeLessThanOrEqual(after);
    }
    // DELIBERATE RE-PIN (T4.2a): same message change as above - the clamp now
    // covers milling batches too, so it no longer says "crop".
    expect(console.info).toHaveBeenCalledWith('littleacres: clamped 1 future timestamps');
  });
});

describe('consumeOfflineSummary ("while you were away")', () => {
  /** Comfortably over OFFLINE_SUMMARY_MIN_MS. */
  const AWAY_MS = OFFLINE_SUMMARY_MIN_MS + 60_000;

  /** A current-version, onboarding-completed save with the given overrides. */
  function completedSave(overrides: Partial<GameStateData> = {}): GameStateData {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    return { ...saved, ...overrides };
  }

  function loadedStore(saved: GameStateData): GameStateStore {
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    return store;
  }

  it('counts a plot that became ready during the away window, per crop', () => {
    const lastSavedAt = Date.now() - AWAY_MS;
    // Ready well inside the window: plantedAt + growMs is between lastSavedAt and now.
    const plantedAt = lastSavedAt + 5_000;
    const saved = completedSave({
      lastSavedAt,
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt, ...tileOf(0) },
        { state: 'growing', cropId: 'sunwheat', plantedAt, ...tileOf(1) },
        ...Array.from({ length: 10 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 2) })),
      ],
    });
    const store = loadedStore(saved);
    const summary = store.consumeOfflineSummary();
    expect(summary?.readyCounts).toEqual({ sunwheat: 2 });
    expect(summary?.elapsedMs).toBeGreaterThanOrEqual(AWAY_MS);
  });

  it('excludes a plot that was already ready before lastSavedAt', () => {
    const lastSavedAt = Date.now() - AWAY_MS;
    const saved = completedSave({
      lastSavedAt,
      plots: [
        // Matured long before the session even ended - not a while-away event.
        {
          state: 'growing',
          cropId: 'sunwheat',
          plantedAt: lastSavedAt - CROPS.sunwheat.growMs - 1,
          ...tileOf(0),
        },
        // This one matures inside the window and should be the only count.
        { state: 'growing', cropId: 'starcorn', plantedAt: lastSavedAt + 1_000, ...tileOf(1) },
        ...Array.from({ length: 10 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 2) })),
      ],
    });
    const store = loadedStore(saved);
    expect(store.consumeOfflineSummary()?.readyCounts).toEqual({ starcorn: 1 });
  });

  it('excludes a plot that is still growing (not yet ready)', () => {
    const lastSavedAt = Date.now() - AWAY_MS;
    const saved = completedSave({
      lastSavedAt,
      plots: [
        // Planted just before load - growMs has not elapsed even now.
        { state: 'growing', cropId: 'glowberry', plantedAt: Date.now() - 1_000, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('is null when away under OFFLINE_SUMMARY_MIN_MS, even with a matured crop', () => {
    const lastSavedAt = Date.now() - (OFFLINE_SUMMARY_MIN_MS - 5_000);
    const saved = completedSave({
      lastSavedAt,
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt: lastSavedAt, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('is null when away long enough but nothing became ready', () => {
    const saved = completedSave({ lastSavedAt: Date.now() - AWAY_MS });
    const store = loadedStore(saved);
    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('is null while onboarding has not completed, even with a matured crop', () => {
    const lastSavedAt = Date.now() - AWAY_MS;
    const saved = createDefaultState(12);
    saved.lastSavedAt = lastSavedAt;
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: lastSavedAt + 1_000,
      ...tileOf(0),
    };
    const store = loadedStore(saved);
    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('consumes once - a second call returns null', () => {
    const lastSavedAt = Date.now() - AWAY_MS;
    const saved = completedSave({
      lastSavedAt,
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt: lastSavedAt + 1_000, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    expect(store.consumeOfflineSummary()).not.toBeNull();
    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('reset clears any pending summary', () => {
    const lastSavedAt = Date.now() - AWAY_MS;
    const saved = completedSave({
      lastSavedAt,
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt: lastSavedAt + 1_000, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    store.reset();
    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('importSave never produces a summary and clears any pending one', () => {
    const lastSavedAt = Date.now() - AWAY_MS;
    const saved = completedSave({
      lastSavedAt,
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt: lastSavedAt + 1_000, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    // A pending summary exists from load() above; importing must clear it even
    // though the imported save's own gap would otherwise also qualify.
    expect(store.importSave(JSON.stringify(saved))).toBe(true);
    expect(store.consumeOfflineSummary()).toBeNull();
  });
});

describe('handleBackgrounded / handleForegroundReturn (T3.20a hiddenAt anchor)', () => {
  /** Comfortably over OFFLINE_SUMMARY_MIN_MS. */
  const AWAY_MS = OFFLINE_SUMMARY_MIN_MS + 60_000;

  /** A current-version, onboarding-completed save with the given overrides. */
  function completedSave(overrides: Partial<GameStateData> = {}): GameStateData {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    return { ...saved, ...overrides };
  }

  function loadedStore(saved: GameStateData): GameStateStore {
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    return store;
  }

  it('queues a summary for a qualifying hidden gap; a second consume returns null', () => {
    const hiddenAt = Date.now() - AWAY_MS;
    const plantedAt = hiddenAt + 5_000; // matures inside the gap
    const saved = completedSave({
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    // Drain whatever load() itself queued (the save's own lastSavedAt is recent, so
    // this is expected null) so this test isolates the foreground path.
    store.consumeOfflineSummary();

    store.handleBackgrounded(hiddenAt);
    store.handleForegroundReturn();

    const summary = store.consumeOfflineSummary();
    expect(summary?.readyCounts).toEqual({ sunwheat: 1 });
    expect(summary?.elapsedMs).toBeGreaterThanOrEqual(AWAY_MS);
    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('THE REGRESSION: survives repeated background autosaves re-stamping lastSavedAt', () => {
    const hiddenAt = Date.now() - AWAY_MS;
    const plantedAt = hiddenAt + 5_000;
    const saved = completedSave({
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    store.consumeOfflineSummary();

    store.handleBackgrounded(hiddenAt);
    // The browser throttles but does not kill setInterval in a backgrounded tab -
    // simulate a few autosave ticks firing while still hidden, each re-stamping
    // lastSavedAt. Before T3.20a this would zero out the measured gap entirely.
    store.save();
    store.save();
    store.save();

    store.handleForegroundReturn();

    const summary = store.consumeOfflineSummary();
    expect(summary?.readyCounts).toEqual({ sunwheat: 1 });
    expect(summary?.elapsedMs).toBeGreaterThanOrEqual(AWAY_MS);
  });

  it('queues nothing when the hidden gap is below OFFLINE_SUMMARY_MIN_MS', () => {
    const hiddenAt = Date.now() - (OFFLINE_SUMMARY_MIN_MS - 5_000);
    const saved = completedSave({
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt: hiddenAt, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    store.consumeOfflineSummary();

    store.handleBackgrounded(hiddenAt);
    store.handleForegroundReturn();

    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('queues nothing when the hidden gap is long but nothing matured inside it', () => {
    const hiddenAt = Date.now() - AWAY_MS;
    const saved = completedSave(); // default plots are all empty
    const store = loadedStore(saved);
    store.consumeOfflineSummary();

    store.handleBackgrounded(hiddenAt);
    store.handleForegroundReturn();

    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('with no prior handleBackgrounded, queues no summary but still rolls over an expired week', () => {
    const saved = completedSave();
    const store = loadedStore(saved);
    store.consumeOfflineSummary(); // drain whatever load() itself queued (expected null)
    // Expire the week only after load(), so load()'s own rollover does not consume
    // it first - this isolates the "fresh hiddenAt" foreground path.
    const expiredAnchor = Date.now() - WEEK_MS - 1000;
    (store.getState() as unknown as GameStateData).quests.weekly.anchor = expiredAnchor;

    store.handleForegroundReturn();

    expect(store.consumeOfflineSummary()).toBeNull();
    expect(store.getState().quests.weekly.anchor).toBe(expiredAnchor + WEEK_MS);
  });

  it('clears hiddenAt after a foreground return - a second call with no new handleBackgrounded queues nothing', () => {
    const hiddenAt = Date.now() - AWAY_MS;
    const plantedAt = hiddenAt + 5_000;
    const saved = completedSave({
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    store.consumeOfflineSummary();

    store.handleBackgrounded(hiddenAt);
    store.handleForegroundReturn();
    expect(store.consumeOfflineSummary()).not.toBeNull();

    store.handleForegroundReturn(); // no new handleBackgrounded call
    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('never clobbers an already-pending summary with a null result', () => {
    const hiddenAt = Date.now() - AWAY_MS;
    const plantedAt = hiddenAt + 5_000;
    const saved = completedSave({
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    store.consumeOfflineSummary();
    store.handleBackgrounded(hiddenAt);
    store.handleForegroundReturn();
    // A summary is now pending (deliberately not drained). Simulate a second,
    // too-short background dip that produces no summary of its own.
    store.handleBackgrounded(Date.now() - 5_000);
    store.handleForegroundReturn();

    const summary = store.consumeOfflineSummary();
    expect(summary?.readyCounts).toEqual({ sunwheat: 1 });
  });

  it('computes the summary before the weekly rollover, so elapsedMs survives a same-call rollover save', () => {
    const hiddenAt = Date.now() - AWAY_MS;
    const plantedAt = hiddenAt + 5_000;
    const saved = completedSave({
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt, ...tileOf(0) },
        ...Array.from({ length: 11 }, (_, i): PlotState => ({ state: 'empty', ...tileOf(i + 1) })),
      ],
    });
    const store = loadedStore(saved);
    store.consumeOfflineSummary(); // drain whatever load() itself queued
    // Expire the week right before the foreground call, so ensureWeeklyQuests()
    // rolls over (and saves) inside the same handleForegroundReturn() call.
    const expiredAnchor = Date.now() - WEEK_MS - 1000;
    (store.getState() as unknown as GameStateData).quests.weekly.anchor = expiredAnchor;

    store.handleBackgrounded(hiddenAt);
    store.handleForegroundReturn();

    const summary = store.consumeOfflineSummary();
    expect(summary?.readyCounts).toEqual({ sunwheat: 1 });
    expect(summary?.elapsedMs).toBeGreaterThanOrEqual(AWAY_MS);
    expect(store.getState().quests.weekly.anchor).toBe(expiredAnchor + WEEK_MS);
  });
});

describe('moondust from level-ups', () => {
  it('grants MOONDUST_PER_LEVEL for a single level gained', () => {
    const store = new GameStateStore({ storage: null });
    const before = store.getState().moondust;
    store.addXp(xpForLevel(2));
    expect(store.getState().level).toBe(2);
    expect(store.getState().moondust).toBe(before + MOONDUST_PER_LEVEL);
  });

  it('grants MOONDUST_PER_LEVEL per level on a multi-level jump', () => {
    const store = new GameStateStore({ storage: null });
    store.addXp(xpForLevel(3)); // level 1 -> 3 in one jump: 2 levels gained
    expect(store.getState().level).toBe(3);
    expect(store.getState().moondust).toBe(2 * MOONDUST_PER_LEVEL);
  });

  it('a silent reconcile on load grants no moondust', () => {
    const saved = createDefaultState(12);
    saved.xp = xpForLevel(3);
    saved.level = 1;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().level).toBe(3);
    expect(store.getState().moondust).toBe(0);
    expect(store.consumeLevelUpEvents()).toEqual([]);
  });

  it('a silent reconcile on import grants no moondust', () => {
    const saved = createDefaultState(12);
    saved.xp = xpForLevel(3);
    saved.level = 1;
    const store = new GameStateStore({ storage: makeStorage() });
    expect(store.importSave(JSON.stringify(saved))).toBe(true);
    expect(store.getState().level).toBe(3);
    expect(store.getState().moondust).toBe(0);
  });
});

describe('Radiant harvest proc', () => {
  /** A post-tutorial store with one ready sunwheat plot at index 0. */
  function readyStore(rng: () => number): GameStateStore {
    const store = new GameStateStore({ storage: null, rng });
    completeOnboarding(store);
    expect(store.plantCrop(0, 'sunwheat')).toBe(true);
    advanceTime(CROPS.sunwheat.growMs);
    return store;
  }

  it('yields RADIANT_YIELD_MULT units and no moondust when the moondust roll fails', () => {
    const store = readyStore(stubRng(0, RADIANT_MOONDUST_CHANCE));
    const moondustBefore = store.getState().moondust;
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().inventory.sunwheat).toBe(RADIANT_YIELD_MULT);
    expect(store.getState().moondust).toBe(moondustBefore);
    expect(store.consumeRadiantEvents()).toEqual([{ plotIndex: 0, cropId: 'sunwheat' }]);
  });

  it('yields RADIANT_YIELD_MULT units and +1 moondust when the moondust roll succeeds', () => {
    const store = readyStore(stubRng(0, 0));
    const moondustBefore = store.getState().moondust;
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().inventory.sunwheat).toBe(RADIANT_YIELD_MULT);
    expect(store.getState().moondust).toBe(moondustBefore + 1);
  });

  it('does not proc when the roll lands at or above RADIANT_CHANCE', () => {
    const store = readyStore(stubRng(RADIANT_CHANCE));
    const moondustBefore = store.getState().moondust;
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().inventory.sunwheat).toBe(1);
    expect(store.getState().moondust).toBe(moondustBefore);
    expect(store.consumeRadiantEvents()).toEqual([]);
  });

  it('never procs during onboarding, even with an always-proc rng', () => {
    const saved = createDefaultState(12);
    const stepIdx = ONBOARDING_STEPS.findIndex((step) => step.id === 'harvest-first');
    saved.onboarding = { completed: false, step: stepIdx, progress: 0, progressB: 0 };
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: now() - CROPS.sunwheat.growMs,
      ...tileOf(0),
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: stubRng(0, 0) });
    store.load();
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().inventory.sunwheat).toBe(1);
    expect(store.consumeRadiantEvents()).toEqual([]);
  });

  it('consumeRadiantEvents drains the queue once, then returns empty', () => {
    const store = readyStore(stubRng(0, 0));
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.consumeRadiantEvents()).toEqual([{ plotIndex: 0, cropId: 'sunwheat' }]);
    expect(store.consumeRadiantEvents()).toEqual([]);
  });
});

describe('reset', () => {
  it('returns to defaults and persists them', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    store.addCoins(500);
    store.save();
    store.reset();
    expect(store.getState().coins).toBe(50);

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().coins).toBe(50);
  });
});

describe('real migration v10 -> v11 (quest system)', () => {
  it('a v10 save (no quests field) gains zeroed lifetime and a drawn weekly rotation, migrates through to current', () => {
    const saved = createDefaultState(12) as unknown as Record<string, unknown>;
    saved.version = 10;
    delete saved.quests; // a genuine v10 save never had this field
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    // drawWeeklyQuestIds: pool [growth, specialist, trader, radiance].
    // rng()=0 -> index 0 'weekly_growth'; remaining [specialist, trader,
    // radiance], rng()=0 -> index 0 'weekly_specialist'. Then featured crop:
    // rng()=0 -> index 0 of Object.keys(CROPS), 'sunwheat'.
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    const state = store.getState();
    expect(state.version).toBe(24);
    expect(state.quests.lifetime).toEqual({
      harvestsByCrop: {},
      totalHarvests: 0,
      ordersFulfilled: 0,
      premiumFulfilled: 0,
      chestsOpened: 0,
    });
    expect(state.quests.weekly.activeIds).toEqual(['weekly_growth', 'weekly_specialist']);
    expect(state.quests.weekly.featuredCrop).toBe('sunwheat');
    expect(state.quests.weekly.growMinutes).toBe(0);
    expect(state.quests.weekly.claimed).toEqual([]);
    expect(state.quests.weekly.anchor).toBeGreaterThan(0);
    expect(state.quests.longClaimed).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('real migration v11 -> v12 (vibration toggle)', () => {
  it('a v11 save (no hapticsOn field) gains hapticsOn true and migrates through to current', () => {
    const saved = createDefaultState(12) as unknown as Record<string, unknown>;
    saved.version = 11;
    const settings = saved.settings as Record<string, unknown>;
    delete settings.hapticsOn; // a genuine v11 save never had this field
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().settings.hapticsOn).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('resets cleanly on a current-version save whose hapticsOn is missing or non-boolean', () => {
    for (const hapticsOn of [undefined, 'yes', 1]) {
      const bad = createDefaultState(12) as unknown as Record<string, unknown>;
      const settings = bad.settings as Record<string, unknown>;
      if (hapticsOn === undefined) delete settings.hapticsOn;
      else settings.hapticsOn = hapticsOn;
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(bad) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState().settings.hapticsOn).toBe(true);
      expect(console.warn).toHaveBeenCalled();
    }
  });
});

describe('real migration v12 -> v13 (quest board intro explainer)', () => {
  it('a v12 save (no introSeen field) gains introSeen false and migrates through to current', () => {
    const saved = createDefaultState(14) as unknown as Record<string, unknown>;
    saved.version = 12;
    const quests = saved.quests as Record<string, unknown>;
    delete quests.introSeen; // a genuine v12 save never had this field
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().quests.introSeen).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('resets cleanly on a current-version save whose introSeen is missing or non-boolean', () => {
    for (const introSeen of [undefined, 'yes', 1]) {
      const bad = createDefaultState(14) as unknown as Record<string, unknown>;
      const quests = bad.quests as Record<string, unknown>;
      if (introSeen === undefined) delete quests.introSeen;
      else quests.introSeen = introSeen;
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(bad) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState().quests.introSeen).toBe(false);
      expect(console.warn).toHaveBeenCalled();
    }
  });
});

describe('real migration v13 -> v14 (decoration flip)', () => {
  it('a v13 save (placements with no flip field) gains flip false on every placement and migrates through to current', () => {
    const saved = createDefaultState(14) as unknown as Record<string, unknown>;
    saved.version = 13;
    saved.decorations = [
      { frame: 'decor_bench', x: 200, y: 1440, scale: 0.55 },
      { frame: 'trophy_ancientoak', x: 500, y: 900, scale: 0.8 },
    ]; // genuine v13 placements never had a flip field
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().decorations).toEqual([
      { frame: 'decor_bench', x: 200, y: 1440, scale: 0.55, flip: false },
      { frame: 'trophy_ancientoak', x: 500, y: 900, scale: 0.8, flip: false },
    ]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a v13 save with no decorations at all still migrates cleanly', () => {
    const saved = createDefaultState(14) as unknown as Record<string, unknown>;
    saved.version = 13;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().decorations).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('real migration v14 -> v15 (level-scaled weekly growth target, T3.19)', () => {
  it('a v14 save (no growthTarget field) gains the snapshot matching its level and migrates through to current', () => {
    const saved = createDefaultState(15) as unknown as Record<string, unknown>;
    saved.version = 14;
    saved.level = 5;
    const weekly = (saved.quests as Record<string, unknown>).weekly as Record<string, unknown>;
    delete weekly.growthTarget; // a genuine v14 save never had this field
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().quests.weekly.growthTarget).toBe(growthTargetForLevel(5));
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a full-chain migration from v10 (no quests field at all) lands valid at current with a level-matched target', () => {
    const saved = createDefaultState(15) as unknown as Record<string, unknown>;
    saved.version = 10;
    saved.level = 3;
    delete saved.quests; // a genuine v10 save never had this field
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    // v10ToV11 seeded the weekly state (level-agnostic); v14ToV15 then
    // stamped the target from the save's own level.
    expect(store.getState().version).toBe(24);
    expect(store.getState().quests.weekly.growthTarget).toBe(growthTargetForLevel(3));
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('real migration v15 -> v16 (placeable plots, T3.3a)', () => {
  /** A genuine v15 save: plots have no col/row, no unplacedPlots/expanded fields. */
  function v15Save(plotCount: number): Record<string, unknown> {
    const saved = createDefaultState(16) as unknown as Record<string, unknown>;
    saved.version = 15;
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.plots = Array.from({ length: plotCount }, (_, i) =>
      i === 1
        ? { state: 'growing', cropId: 'sunwheat', plantedAt: Date.now() - 1_000 }
        : { state: 'empty' },
    );
    delete saved.unplacedPlots;
    delete saved.expanded;
    return saved;
  }

  it('maps a 12-plot save: exact col/row per index, unplacedPlots 0, unexpanded', () => {
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(v15Save(12)) });
    const store = new GameStateStore({ storage });
    store.load();
    const state = store.getState();
    expect(state.version).toBe(24);
    expect(state.plots).toHaveLength(12);
    for (let i = 0; i < 12; i++) {
      expect(state.plots[i]).toMatchObject({ col: i % FARM_COLS, row: Math.floor(i / FARM_COLS) });
    }
    // The growing plot kept its crop and timestamp alongside its new tile.
    expect(state.plots[1]).toMatchObject({ state: 'growing', cropId: 'sunwheat' });
    expect(state.unplacedPlots).toBe(0);
    expect(state.expanded).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('maps a 16-plot save: all 16 tiles in index order, unplacedPlots 0, expanded', () => {
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(v15Save(16)) });
    const store = new GameStateStore({ storage });
    store.load();
    const state = store.getState();
    expect(state.version).toBe(24);
    expect(state.plots).toHaveLength(16);
    for (let i = 0; i < 16; i++) {
      expect(state.plots[i]).toMatchObject({ col: i % FARM_COLS, row: Math.floor(i / FARM_COLS) });
    }
    expect(state.unplacedPlots).toBe(0);
    expect(state.expanded).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('real migration v16 -> v17 (fence normalization + per-item sizing, T3.3a2)', () => {
  /** MIGRATIONS[i] migrates version i+1 to i+2, so v16 -> v17 is index 15. */
  const v16ToV17 = MIGRATIONS[15]!;
  const rng = () => 0.5;
  const placement = (frame: string, scale: number) => ({
    frame,
    x: 321,
    y: 987,
    scale,
    flip: true,
  });

  /** A genuine v16 save: current shape, decorations at pre-v17 scales. */
  function v16Save(decorations: unknown[]): Record<string, unknown> {
    const saved = createDefaultState(17) as unknown as Record<string, unknown>;
    saved.version = 16;
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.decorations = decorations;
    return saved;
  }

  it('round-trips a v16 save with an oversized fence and an oversized table item: both normalize, everything else identical', () => {
    const saved = v16Save([
      placement('decor_fence', 2.0),
      placement('trophy_ancientoak', 2.5),
      placement('decor_bench', 0.55),
    ]);
    saved.coins = 777;
    saved.warehouse = { decor_gnome: 2 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState()).toEqual({
      ...saved,
      // DELIBERATE RE-PIN (T4.1): the chain now ends at v23 (buildings).
      version: 24,
      decorations: [
        // Fence normalized to exactly 1.2, position/flip untouched.
        placement('decor_fence', 1.2),
        // Table item clamped down to its own maxScale.
        placement('trophy_ancientoak', 2.0),
        // Non-table item passes through untouched.
        placement('decor_bench', 0.55),
      ],
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('normalizes every fence to exactly FENCE_FIXED_SCALE, above or below', () => {
    const migrated = v16ToV17(
      { decorations: [placement('decor_fence', 0.7), placement('decor_fence', 1.2)] },
      rng,
    );
    expect(migrated.decorations).toEqual([
      placement('decor_fence', 1.2),
      placement('decor_fence', 1.2),
    ]);
  });

  it('clamps a table item above its maxScale down to it', () => {
    const migrated = v16ToV17({ decorations: [placement('decor_gnome', 3.0)] }, rng);
    expect(migrated.decorations).toEqual([placement('decor_gnome', 0.85)]);
  });

  it('leaves a table item at or below its maxScale untouched', () => {
    const atMax = placement('decor_well', 1.15);
    const belowMax = placement('decor_mushrooms', 0.4);
    const migrated = v16ToV17({ decorations: [atMax, belowMax] }, rng);
    // Same entry OBJECTS pass through - not merely equal values.
    expect((migrated.decorations as unknown[])[0]).toBe(atMax);
    expect((migrated.decorations as unknown[])[1]).toBe(belowMax);
  });

  it('passes an unknown frame or a malformed entry through untouched for validation to judge', () => {
    const unknown = placement('mystery_item', 9);
    const malformed = { frame: 'decor_gnome', scale: 'huge' };
    const migrated = v16ToV17({ decorations: [unknown, malformed, 'garbage'] }, rng);
    expect((migrated.decorations as unknown[])[0]).toBe(unknown);
    expect((migrated.decorations as unknown[])[1]).toBe(malformed);
    expect((migrated.decorations as unknown[])[2]).toBe('garbage');
  });

  it('passes a save with no decorations array through untouched', () => {
    const migrated = v16ToV17({ decorations: 'nope' }, rng);
    expect(migrated.decorations).toBe('nope');
  });
});

describe('real migration v17 -> v18 (movable structures, T3.3s)', () => {
  it('a v17 save (no structures field) gains the default anchors and round-trips otherwise untouched', () => {
    const saved = createDefaultState(18) as unknown as Record<string, unknown>;
    saved.version = 17;
    delete saved.structures; // a genuine v17 save never had this field
    saved.coins = 444;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState()).toEqual({
      ...saved,
      // DELIBERATE RE-PIN (T4.1): the chain now ends at v23 (buildings).
      version: 24,
      structures: defaultStructures(),
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('PIXEL IDENTITY: the default anchors reproduce the canonical render positions exactly', () => {
    // DELIBERATE RE-PIN (T3.27): structures are BASE-anchored now, so
    // `structureRenderPosition` returns the building's GROUND point instead of
    // its sprite centre, and both canonical constants moved down by half their
    // structure's display height. The ART did not move - the sprite's origin
    // moved from its centre to its base row by the same amount.
    //
    //   farmhouse:   gridToIso(-1,-3) = (540 + (-1 - -3) * 128, 768 + (-1 + -3) * 64)
    //                                 = (796, 512)
    //                + STRUCTURE_RENDER_OFFSETS.farmhouse (137, 219)
    //                = (933, 731)          [was (933, 521); 219 = 9 + 420/2]
    //   noticeBoard: gridToIso(5,3)   = (540 + (5 - 3) * 128, 768 + (5 + 3) * 64)
    //                                 = (796, 1280)
    //                + STRUCTURE_RENDER_OFFSETS.noticeBoard (116, 109)
    //                = (912, 1389)         [was (912, 1269); 109 = -11 + 240/2]
    //
    // Asserted against literals, not just the constants, so an accidental edit
    // to STRUCTURE_RENDER_OFFSETS cannot move both sides at once and pass.
    expect(structureRenderPosition('farmhouse', STRUCTURE_DEFAULT_ANCHORS.farmhouse)).toEqual({
      x: 933,
      y: 731,
    });
    expect(structureRenderPosition('noticeBoard', STRUCTURE_DEFAULT_ANCHORS.noticeBoard)).toEqual({
      x: 912,
      y: 1389,
    });
    expect(FARMHOUSE_POSITION).toEqual({ x: 933, y: 731 });
    expect(NOTICE_BOARD_POSITION).toEqual({ x: 912, y: 1389 });
  });

  it('the default anchors reproduce the pinned blocked-tile sets tile for tile', () => {
    // DELIBERATE RE-PIN (Art Studio owner ruling 2026-07-17): the farmhouse
    // footprint is DESIGN-CHOSEN - an Art-Studio-tuned 2x2 block (offsets
    // (1,0),(2,0),(1,1),(2,1)), superseding the T3.3s-r2c symmetric 3x3. At
    // the default anchor (-1,-3) that is tiles (0,-3),(1,-3),(0,-2),(1,-2),
    // in offset order. The notice board is ALSO DESIGN-CHOSEN by the same
    // ruling: a SINGLE-tile footprint at offset (1,0) -> tile (6,3) at anchor
    // (5,3), superseding the old 4-tile measured set.
    //
    // DELIBERATE RE-PIN (owner hand-edit, T3.3b-r1): the board footprint is now
    // the 5-tile diamond, offsets (1,0),(1,-1),(1,1),(2,0),(0,0) - the single
    // tile was smaller than the board art. At the default anchor (5,3), in
    // offset order, that is (6,3),(6,2),(6,4),(7,3),(5,3). Note offset (0,0):
    // the board INCLUDES its anchor tile, reversing the anchor-as-pure-
    // reference convention for the board only. The FARMHOUSE keeps it (its 2x2
    // still excludes (0,0)). See STRUCTURE_FOOTPRINT_OFFSETS in config.ts.
    expect(structureFootprintTiles('farmhouse', STRUCTURE_DEFAULT_ANCHORS.farmhouse)).toEqual([
      { col: 0, row: -3 },
      { col: 1, row: -3 },
      { col: 0, row: -2 },
      { col: 1, row: -2 },
    ]);
    expect(structureFootprintTiles('noticeBoard', STRUCTURE_DEFAULT_ANCHORS.noticeBoard)).toEqual([
      { col: 6, row: 3 },
      { col: 6, row: 2 },
      { col: 6, row: 4 },
      { col: 7, row: 3 },
      { col: 5, row: 3 },
    ]);
  });

  it('validation rejects missing, malformed, or out-of-bounds structures', () => {
    expect(isValidState(createDefaultState(18), 18)).toBe(true);
    const missing = createDefaultState(18) as unknown as Record<string, unknown>;
    delete missing.structures;
    expect(isValidState(missing, 18)).toBe(false);
    const fractional = createDefaultState(18);
    fractional.structures.farmhouse.col = 0.5;
    expect(isValidState(fractional, 18)).toBe(false);
    const outOfBounds = createDefaultState(18);
    outOfBounds.structures.noticeBoard.col = PLOT_GRID_COORD_MAX + 1;
    expect(isValidState(outOfBounds, 18)).toBe(false);
    const wrongShape = createDefaultState(18) as unknown as Record<string, unknown>;
    wrongShape.structures = { farmhouse: { col: 0, row: 0 } }; // noticeBoard missing
    expect(isValidState(wrongShape, 18)).toBe(false);
  });

  it('a full-chain v1 save lands at version 19 with the default anchors', () => {
    const { moondust, orders, onboarding, orderSkips, ...v1Save } = createDefaultState(1);
    void moondust;
    void orders;
    void onboarding;
    void orderSkips;
    const raw = v1Save as unknown as Record<string, unknown>;
    delete raw.structures; // a genuine v1 save never had this field either
    // Genuine pre-v19 saves never had these region fields either.
    delete raw.regionsUnlocked;
    delete raw.twoFingerHintShown;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(raw) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().structures).toEqual(defaultStructures());
    expect(store.getState().regionsUnlocked).toEqual([]);
    expect(store.getState().twoFingerHintShown).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('real migration v19 -> v20 (restoration chapter, T3.25)', () => {
  it('a v19 save (no restoration field) gains restoration.farmhouse 0, no warnings', () => {
    const saved = createDefaultState(20) as unknown as Record<string, unknown>;
    saved.version = 19;
    delete saved.restoration; // a genuine v19 save never had this field
    saved.coins = 4321;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState()).toEqual({
      ...saved,
      // DELIBERATE RE-PIN (T4.1): the chain now ends at v23 (buildings).
      version: 24,
      restoration: { farmhouse: 0 },
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a full-chain v1 save lands at version 20 un-restored', () => {
    const saved = createDefaultState(1) as unknown as Record<string, unknown>;
    delete saved.restoration;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().restoration).toEqual({ farmhouse: 0 });
  });

  it('a fresh save starts un-restored', () => {
    expect(createDefaultState(20).restoration).toEqual({ farmhouse: 0 });
  });

  it('validation rejects a missing, non-binary, or wrong-shaped restoration flag', () => {
    expect(isValidState(createDefaultState(20), 20)).toBe(true);
    const missing = createDefaultState(20) as unknown as Record<string, unknown>;
    delete missing.restoration;
    expect(isValidState(missing, 20)).toBe(false);
    const outOfRange = createDefaultState(20) as unknown as Record<string, unknown>;
    outOfRange.restoration = { farmhouse: 2 };
    expect(isValidState(outOfRange, 20)).toBe(false);
    const wrongType = createDefaultState(20) as unknown as Record<string, unknown>;
    wrongType.restoration = { farmhouse: true };
    expect(isValidState(wrongType, 20)).toBe(false);
    const wrongShape = createDefaultState(20) as unknown as Record<string, unknown>;
    wrongShape.restoration = 0;
    expect(isValidState(wrongShape, 20)).toBe(false);
  });
});

describe('real migration v20 -> v21 (goals hub, T3.30)', () => {
  it('a v20 save (no goalsSeen field) gains goalsSeen false, no warnings', () => {
    const saved = createDefaultState(22) as unknown as Record<string, unknown>;
    saved.version = 20;
    delete saved.goalsSeen; // a genuine v20 save never had this field
    saved.coins = 4321;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState()).toEqual({ ...saved, version: 24, goalsSeen: false });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a full-chain v1 save lands at version 22 having not seen the goals menu', () => {
    const saved = createDefaultState(1) as unknown as Record<string, unknown>;
    delete saved.goalsSeen;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().goalsSeen).toBe(false);
  });

  it('a fresh save has not seen the goals menu either', () => {
    expect(createDefaultState(22).goalsSeen).toBe(false);
  });

  it('validation rejects a missing or non-boolean goalsSeen', () => {
    expect(isValidState(createDefaultState(22), 22)).toBe(true);
    const missing = createDefaultState(22) as unknown as Record<string, unknown>;
    delete missing.goalsSeen;
    expect(isValidState(missing, 22)).toBe(false);
    const wrongType = createDefaultState(22) as unknown as Record<string, unknown>;
    wrongType.goalsSeen = 1;
    expect(isValidState(wrongType, 22)).toBe(false);
  });
});

describe('real migration v21 -> v22 (goods economy foundation, T4.0)', () => {
  it('a v21 save (no goods field) gains an empty goods map, no warnings', () => {
    const saved = createDefaultState(22) as unknown as Record<string, unknown>;
    saved.version = 21;
    delete saved.goods; // a genuine v21 save never had this field
    saved.coins = 1234;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState()).toEqual({ ...saved, version: 24, goods: {} });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a full-chain v1 save lands at version 22 with an empty goods map', () => {
    const saved = createDefaultState(1) as unknown as Record<string, unknown>;
    delete saved.goods;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(24);
    expect(store.getState().goods).toEqual({});
  });

  it('a fresh save starts with no goods either', () => {
    expect(createDefaultState(22).goods).toEqual({});
  });

  it('the migration leaves the crop maps entirely alone', () => {
    const saved = createDefaultState(22) as unknown as Record<string, unknown>;
    saved.version = 21;
    delete saved.goods;
    saved.inventory = { sunwheat: 3 };
    saved.seeds = { starcorn: 2 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().inventory).toEqual({ sunwheat: 3 });
    expect(store.getState().seeds).toEqual({ starcorn: 2 });
  });

  it('validation rejects a missing goods map, a non-GOODS key, or a non-numeric count', () => {
    expect(isValidState(createDefaultState(22), 22)).toBe(true);
    const missing = createDefaultState(22) as unknown as Record<string, unknown>;
    delete missing.goods;
    expect(isValidState(missing, 22)).toBe(false);
    // A CROP id is not a good id - the two registries are disjoint.
    const cropKey = createDefaultState(22) as unknown as Record<string, unknown>;
    cropKey.goods = { sunwheat: 1 };
    expect(isValidState(cropKey, 22)).toBe(false);
    const unknownKey = createDefaultState(22) as unknown as Record<string, unknown>;
    unknownKey.goods = { mysteryjam: 1 };
    expect(isValidState(unknownKey, 22)).toBe(false);
    const badCount = createDefaultState(22) as unknown as Record<string, unknown>;
    badCount.goods = { sunflour: 'lots' };
    expect(isValidState(badCount, 22)).toBe(false);
    const populated = createDefaultState(22) as unknown as Record<string, unknown>;
    populated.goods = { sunflour: 4 };
    expect(isValidState(populated, 22)).toBe(true);
  });
});

describe('sellGood / devGrantGood (T4.0)', () => {
  /** A post-tutorial store (the 'sell' rail is closed while onboarding runs). */
  function sellingStore(storage: SaveStorage = makeStorage()): GameStateStore {
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    return store;
  }

  it('devGrantGood adds to the stack and persists', () => {
    const storage = makeStorage();
    const store = sellingStore(storage);
    store.devGrantGood('sunflour', 3);
    store.devGrantGood('sunflour', 2);
    expect(store.getState().goods.sunflour).toBe(5);
    const persisted = JSON.parse(storage.data.get(SAVE_KEY) as string) as {
      goods: Record<string, number>;
    };
    expect(persisted.goods.sunflour).toBe(5);
  });

  it('sells the whole stack for count * sellValue, zeroes it, and saves', () => {
    const storage = makeStorage();
    const store = sellingStore(storage);
    const before = store.getState().coins;
    store.devGrantGood('sunflour', 4);
    // 4 * GOODS.sunflour.sellValue (25) = 100.
    expect(store.sellGood('sunflour')).toBe(4 * GOODS.sunflour.sellValue);
    expect(store.getState().coins).toBe(before + 100);
    expect(store.getState().goods.sunflour).toBe(0);
    const persisted = JSON.parse(storage.data.get(SAVE_KEY) as string) as {
      goods: Record<string, number>;
      coins: number;
    };
    expect(persisted.goods.sunflour).toBe(0);
    expect(persisted.coins).toBe(before + 100);
  });

  it('an empty (or never-granted) stack sells for 0 and mutates nothing', () => {
    const store = sellingStore();
    const before = store.getState().coins;
    expect(store.sellGood('sunflour')).toBe(0);
    expect(store.getState().coins).toBe(before);
    expect(store.getState().goods).toEqual({});
    store.devGrantGood('sunflour', 1);
    store.sellGood('sunflour');
    expect(store.sellGood('sunflour')).toBe(0);
    expect(store.getState().goods.sunflour).toBe(0);
  });

  it('is gated by the same sell rail as sellCrop - no sale during the tutorial', () => {
    const store = new GameStateStore({ storage: null }); // onboarding still running
    store.devGrantGood('sunflour', 2);
    const before = store.getState().coins;
    expect(store.sellGood('sunflour')).toBe(0);
    expect(store.getState().coins).toBe(before);
    expect(store.getState().goods.sunflour).toBe(2);
  });

  it('selling a good never touches the crop inventory', () => {
    const store = sellingStore();
    (store.getState() as GameStateData).inventory.sunwheat = 6;
    store.devGrantGood('sunflour', 2);
    store.sellGood('sunflour');
    expect(store.getState().inventory.sunwheat).toBe(6);
  });

  it('a granted good survives a save/reload round-trip', () => {
    const storage = makeStorage();
    const store = sellingStore(storage);
    store.devGrantGood('sunflour', 7);
    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().goods.sunflour).toBe(7);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('markGoalsSeen (T3.30)', () => {
  it('flips goalsSeen true and persists it', () => {
    const storage = makeStorage({});
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().goalsSeen).toBe(false);
    store.markGoalsSeen();
    expect(store.getState().goalsSeen).toBe(true);
    const persisted = JSON.parse(storage.data.get(SAVE_KEY) as string) as { goalsSeen: boolean };
    expect(persisted.goalsSeen).toBe(true);
  });

  it('is a no-op (no extra save) once already seen', () => {
    const storage = makeStorage({});
    const store = new GameStateStore({ storage });
    store.load();
    store.markGoalsSeen();
    // Count writes only from here, so the first (real) save is not counted.
    const setItem = vi.spyOn(storage, 'setItem');
    store.markGoalsSeen();
    expect(store.getState().goalsSeen).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('never flips back', () => {
    const store = new GameStateStore({ storage: null });
    store.markGoalsSeen();
    store.markGoalsSeen();
    expect(store.getState().goalsSeen).toBe(true);
  });
});

describe('farmhouse restoration purchase (T3.25)', () => {
  /** A post-tutorial store holding exactly the restoration price. */
  function affordingStore(): GameStateStore {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    const state = store.getState() as GameStateData;
    state.coins = RESTORE_FARMHOUSE_COST.coins;
    state.moondust = RESTORE_FARMHOUSE_COST.moondust;
    return store;
  }

  it('deducts both currencies exactly once and sets the flag', () => {
    const store = affordingStore();
    expect(store.restoreFarmhouse()).toBe(true);
    expect(store.getState().coins).toBe(0);
    expect(store.getState().moondust).toBe(0);
    expect(store.getState().restoration.farmhouse).toBe(1);
  });

  it('refuses a second purchase - no double-spend', () => {
    const store = affordingStore();
    const state = store.getState() as GameStateData;
    // Twice the price, so only the already-restored guard can stop the second.
    state.coins = RESTORE_FARMHOUSE_COST.coins * 2;
    state.moondust = RESTORE_FARMHOUSE_COST.moondust * 2;
    expect(store.restoreFarmhouse()).toBe(true);
    expect(store.restoreFarmhouse()).toBe(false);
    expect(store.getState().coins).toBe(RESTORE_FARMHOUSE_COST.coins);
    expect(store.getState().moondust).toBe(RESTORE_FARMHOUSE_COST.moondust);
    expect(store.getState().restoration.farmhouse).toBe(1);
  });

  it('refuses and mutates nothing when either currency is one short', () => {
    const shortOnCoins = affordingStore();
    (shortOnCoins.getState() as GameStateData).coins = RESTORE_FARMHOUSE_COST.coins - 1;
    expect(shortOnCoins.restoreFarmhouse()).toBe(false);
    expect(shortOnCoins.getState().coins).toBe(RESTORE_FARMHOUSE_COST.coins - 1);
    expect(shortOnCoins.getState().moondust).toBe(RESTORE_FARMHOUSE_COST.moondust);
    expect(shortOnCoins.getState().restoration.farmhouse).toBe(0);

    const shortOnDust = affordingStore();
    (shortOnDust.getState() as GameStateData).moondust = RESTORE_FARMHOUSE_COST.moondust - 1;
    expect(shortOnDust.restoreFarmhouse()).toBe(false);
    expect(shortOnDust.getState().coins).toBe(RESTORE_FARMHOUSE_COST.coins);
    expect(shortOnDust.getState().restoration.farmhouse).toBe(0);
  });

  it('canAffordFarmhouseRestoration tracks both currencies and goes false once owned', () => {
    const store = affordingStore();
    expect(store.canAffordFarmhouseRestoration()).toBe(true);
    expect(store.restoreFarmhouse()).toBe(true);
    expect(store.canAffordFarmhouseRestoration()).toBe(false);
  });

  it('survives a save/reload round-trip', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    const state = store.getState() as GameStateData;
    state.coins = RESTORE_FARMHOUSE_COST.coins;
    state.moondust = RESTORE_FARMHOUSE_COST.moondust;
    expect(store.restoreFarmhouse()).toBe(true);
    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().restoration.farmhouse).toBe(1);
  });

  it('devSetFarmhouseRestored flips the flag for free, both ways', () => {
    const store = new GameStateStore({ storage: null });
    const coinsBefore = store.getState().coins;
    expect(store.devSetFarmhouseRestored(true)).toBe(true);
    expect(store.getState().restoration.farmhouse).toBe(1);
    expect(store.getState().coins).toBe(coinsBefore);
    expect(store.devSetFarmhouseRestored(false)).toBe(false);
    expect(store.getState().restoration.farmhouse).toBe(0);
  });

  it('leaves the farmhouse structure anchor untouched', () => {
    const store = affordingStore();
    const anchorBefore = { ...store.getState().structures.farmhouse };
    expect(store.restoreFarmhouse()).toBe(true);
    expect(store.getState().structures.farmhouse).toEqual(anchorBefore);
  });
});

describe('Homestead luck perk (T3.25)', () => {
  /** A post-tutorial store with one ready sunwheat plot at index 0. */
  function readyStore(rng: () => number, restored: boolean): GameStateStore {
    const store = new GameStateStore({ storage: null, rng });
    completeOnboarding(store);
    store.devSetFarmhouseRestored(restored);
    expect(store.plantCrop(0, 'sunwheat')).toBe(true);
    advanceTime(CROPS.sunwheat.growMs);
    return store;
  }

  /**
   * DERIVATION: a roll in [RADIANT_CHANCE, RADIANT_CHANCE * HOMESTEAD_LUCK_MULT)
   * is exactly the band the perk opens up - it misses the base chance and hits
   * the boosted one. Midpoint of that band, so neither endpoint's strictness
   * matters.
   */
  const BAND_ROLL = (RADIANT_CHANCE + RADIANT_CHANCE * HOMESTEAD_LUCK_MULT) / 2;

  it('a roll in the perk band procs when restored', () => {
    const store = readyStore(stubRng(BAND_ROLL, 1), true);
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().inventory.sunwheat).toBe(RADIANT_YIELD_MULT);
    expect(store.consumeRadiantEvents()).toEqual([{ plotIndex: 0, cropId: 'sunwheat' }]);
  });

  it('the same roll does NOT proc while un-restored', () => {
    const store = readyStore(stubRng(BAND_ROLL, 1), false);
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().inventory.sunwheat).toBe(1);
    expect(store.consumeRadiantEvents()).toEqual([]);
  });

  it('does not proc when the roll clears even the boosted chance', () => {
    const store = readyStore(stubRng(RADIANT_CHANCE * HOMESTEAD_LUCK_MULT, 1), true);
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().inventory.sunwheat).toBe(1);
  });

  it('boosts only the chance, never the yield', () => {
    const store = readyStore(stubRng(0, 1), true);
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().inventory.sunwheat).toBe(RADIANT_YIELD_MULT);
  });

  it('effectiveRadiantChance applies the multiplier only when restored', () => {
    expect(effectiveRadiantChance(RADIANT_CHANCE, false)).toBe(RADIANT_CHANCE);
    expect(effectiveRadiantChance(RADIANT_CHANCE, true)).toBe(RADIANT_CHANCE * HOMESTEAD_LUCK_MULT);
  });
});

describe('real migration v18 -> v19 (purchasable regions, T3.3b)', () => {
  it('a v18 save (no region fields) gains regionsUnlocked [] and twoFingerHintShown false, no warnings', () => {
    const saved = createDefaultState(19) as unknown as Record<string, unknown>;
    saved.version = 18;
    delete saved.regionsUnlocked; // a genuine v18 save never had these fields
    delete saved.twoFingerHintShown;
    saved.coins = 321;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState()).toEqual({
      ...saved,
      // DELIBERATE RE-PIN (T4.1): the chain now ends at v23 (buildings).
      version: 24,
      regionsUnlocked: [],
      twoFingerHintShown: false,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a purchased region survives a save/reload round-trip (band stays clear, cap stays 22)', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    store.setLevel(7);
    store.addCoins(7500);
    expect(store.purchaseRegion('east_meadow')).toBe(true);
    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().regionsUnlocked).toEqual(['east_meadow']);
    expect(plotEntitlementCap(reloaded.getState().regionsUnlocked)).toBe(22);
    // The band is still in the placement domain after reload.
    expect(isPlotTileFree(reloaded.getState(), 4, -3)).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('moveStructure (T3.3s legality matrix)', () => {
  function makeStore(storage: SaveStorage = makeStorage()): GameStateStore {
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    return store;
  }

  it('happy path: the farmhouse moves to an open legal anchor and the move persists', () => {
    const storage = makeStorage();
    const store = makeStore(storage);
    // (6, 7): the 2x2 footprint - tiles (7,7),(8,7),(7,8),(8,8) - sits in the
    // open south field, clear of plots, the board, the sign, and the domain edge.
    expect(store.moveStructure('farmhouse', 6, 7)).toBe(true);
    expect(store.getState().structures.farmhouse).toEqual({ col: 6, row: 7 });
    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().structures.farmhouse).toEqual({ col: 6, row: 7 });
  });

  it('a move onto its own current anchor is a valid no-op commit', () => {
    const store = makeStore();
    expect(store.moveStructure('farmhouse', -1, -3)).toBe(true);
    expect(store.getState().structures.farmhouse).toEqual({ col: -1, row: -3 });
  });

  it('refuses an anchor whose footprint overlaps a plot', () => {
    const store = makeStore();
    // Default plots fill cols 0..3, rows 0..2. Anchor (2, 1) puts the 2x2
    // footprint (3,1),(4,1),(3,2),(4,2) partly onto them - (3,1) and (3,2)
    // are plots (the col-4 tiles clear the plot block).
    expect(store.moveStructure('farmhouse', 2, 1)).toBe(false);
    // A single-tile graze refuses too: anchor (-2, -1) reaches plot (0, 0)
    // via footprint tile (0,0); its other three tiles ((-1,-1),(0,-1),(-1,0))
    // are clear of plots, the sign, the board, and the domain edge.
    expect(store.moveStructure('farmhouse', -2, -1)).toBe(false);
  });

  it("refuses an anchor overlapping the OTHER structure's footprint - tracked at its LIVE anchor", () => {
    const store = makeStore();
    // Expanded, so the sign footprint can never mask the structure-structure
    // rule (keeps the board collision the sole isolated refusal cause).
    markExpanded(store);
    // RE-DERIVED for the T3.3b-r1 5-tile board footprint (offsets
    // (1,0),(1,-1),(1,1),(2,0),(0,0)); the board blocks more ground now, so the
    // farmhouse-vs-board overlaps widen.
    // Farmhouse anchor (5, 3): its 2x2 footprint (6,3),(7,3),(6,4),(7,4)
    // meets three of the board's default tiles ((6,3),(7,3),(6,4) at anchor
    // (5,3)). All four farmhouse tiles are in-domain, so the board is the sole
    // refusal.
    expect(store.moveStructure('farmhouse', 5, 3)).toBe(false);
    // Move the board to (8, 6) - footprint (9,6),(9,5),(9,7),(10,6),(8,6), all
    // in-domain and clear of plots, the farmhouse default, and the sign. Its
    // old tiles stop blocking...
    expect(store.moveStructure('noticeBoard', 8, 6)).toBe(true);
    expect(store.moveStructure('farmhouse', 5, 3)).toBe(true);
    // ...and its new footprint blocks instead: farmhouse (7, 6) footprint
    // (8,6),(9,6),(8,7),(9,7) meets the board's (8,6),(9,6),(9,7). All four
    // farmhouse tiles are in-domain.
    expect(store.moveStructure('farmhouse', 7, 6)).toBe(false);
  });

  it('refuses anchors whose footprint leaves the placeable domain, and non-integer coordinates', () => {
    const store = makeStore();
    // Board at (11, 10): its 5-tile footprint reaches (12,10),(12,9),(12,11),
    // (13,10),(11,10), all past the base placeable domain's south-east limit
    // (col+row >= 21; the domain's max col+row is 18, and col 12/13 exceed the
    // max placeable col of 11 as well).
    expect(store.moveStructure('noticeBoard', 11, 10)).toBe(false);
    // The farmhouse 2x2 footprint reaches col+2 / row+1 from the anchor
    // (2026-07-17), so anchor (10, 0) pushes footprint tile (12, 0) past the
    // placeable domain's east edge (max placeable col 11) - refused. (Note
    // anchor (-8,-8) is now LEGAL: its footprint (-7,-8)..(-6,-7) shifted
    // down-right and stays in-domain, unlike the old symmetric 3x3.)
    expect(store.moveStructure('farmhouse', 10, 0)).toBe(false);
    // Deep off-grid.
    expect(store.moveStructure('farmhouse', 99, 99)).toBe(false);
    expect(store.moveStructure('farmhouse', 0.5, 5)).toBe(false);
    expect(store.moveStructure('farmhouse', Number.NaN, 5)).toBe(false);
  });

  it('a refused move mutates nothing (verified via the exported save)', () => {
    const store = makeStore();
    const before = store.exportSave();
    expect(store.moveStructure('farmhouse', 2, 1)).toBe(false); // plots
    expect(store.moveStructure('farmhouse', 5, 3)).toBe(false); // other structure (board tiles (6,3),(7,3),(6,4))
    expect(store.moveStructure('noticeBoard', 11, 10)).toBe(false); // out of domain
    expect(store.moveStructure('farmhouse', 0.5, 5)).toBe(false); // non-integer
    expect(store.exportSave()).toBe(before);
  });

  it('isPlotTileFree derives footprints dynamically: old tiles free, new tiles blocked after a move', () => {
    const store = makeStore();
    expect(isPlotTileFree(store.getState(), 0, -2)).toBe(false);
    expect(isPlotTileFree(store.getState(), 1, -3)).toBe(false);
    expect(store.moveStructure('farmhouse', 6, 7)).toBe(true);
    // The vacated default footprint frees up...
    expect(isPlotTileFree(store.getState(), 0, -2)).toBe(true);
    expect(isPlotTileFree(store.getState(), 1, -3)).toBe(true);
    // ...and the new 2x2 footprint (7,7),(8,7),(7,8),(8,8) blocks instead.
    // The anchor tile (6,7) itself stays FREE (2026-07-17: the anchor is not
    // part of the footprint).
    expect(isPlotTileFree(store.getState(), 7, 7)).toBe(false);
    expect(isPlotTileFree(store.getState(), 8, 8)).toBe(false);
    expect(isPlotTileFree(store.getState(), 6, 7)).toBe(true);
  });

  it('placePlot respects MOVED footprints: plots go where the farmhouse was, never where it now is', () => {
    const store = makeStore();
    expect(store.grantPlots(1)).toBe(true);
    store.consumePlotGrantEvents();
    expect(store.placePlot(0, -2)).toBe(false); // still under the farmhouse footprint
    expect(store.moveStructure('farmhouse', 6, 7)).toBe(true);
    expect(store.placePlot(0, -2)).toBe(BASE_PLOT_COUNT); // vacated - appends as plot 12
    expect(store.grantPlots(1)).toBe(true);
    expect(store.placePlot(7, 7)).toBe(false); // under the moved farmhouse footprint
  });

  it('isStructureAnchorFree matches moveStructure verdicts (the scene preview shares the rule)', () => {
    const store = makeStore();
    const state = store.getState();
    expect(isStructureAnchorFree(state, 'farmhouse', 6, 7)).toBe(true);
    expect(isStructureAnchorFree(state, 'farmhouse', 2, 1)).toBe(false);
    // (5,3): farmhouse footprint (6,3),(7,3),(6,4),(7,4) hits the board's
    // 5-tile default footprint at (6,3),(7,3),(6,4) (T3.3b-r1 re-derivation).
    expect(isStructureAnchorFree(state, 'farmhouse', 5, 3)).toBe(false);
    expect(isStructureAnchorFree(state, 'noticeBoard', 11, 10)).toBe(false);
    // The current anchor is always a legal preview (snap-back home).
    expect(isStructureAnchorFree(state, 'farmhouse', -1, -3)).toBe(true);
  });

  it('refuses anchors overlapping the expand sign footprint pre-expansion; the same anchors are legal once expanded (T3.3s-r1)', () => {
    // Sign-gating isolation under the 2026-07-17 footprints: both anchors
    // touch the sign but are otherwise clear (plots, the other structure at
    // its default, the domain edge), so the SIGN is the sole pre-expansion
    // refusal cause and each turns legal once the sign retires.
    //   Farmhouse anchor (4, 5): 2x2 footprint (5,5),(6,5),(5,6),(6,6); only
    //   (5,5) is a sign tile. RE-DERIVED for the T3.3b-r1 5-tile board: the
    //   board's default footprint is (6,3),(6,2),(6,4),(7,3),(5,3), none of
    //   which the farmhouse touches here, so the sign stays the sole cause.
    //   Notice board anchor (4, 4): 5-tile footprint (5,4),(5,3),(5,5),(6,4),
    //   (4,4); three of those - (5,4),(5,5),(4,4) - are sign tiles (see
    //   EXPAND_SIGN_BLOCKED_TILES in gameState.ts). All five are in-domain and
    //   clear of plots and the farmhouse's default footprint, so once the sign
    //   retires the anchor is legal.
    const farmhouseStore = makeStore();
    expect(farmhouseStore.moveStructure('farmhouse', 4, 5)).toBe(false);
    expect(farmhouseStore.moveStructure('noticeBoard', 4, 4)).toBe(false);
    markExpanded(farmhouseStore);
    expect(farmhouseStore.moveStructure('farmhouse', 4, 5)).toBe(true);
    expect(farmhouseStore.getState().structures.farmhouse).toEqual({ col: 4, row: 5 });
    const boardStore = makeStore();
    markExpanded(boardStore);
    expect(boardStore.moveStructure('noticeBoard', 4, 4)).toBe(true);
    expect(boardStore.getState().structures.noticeBoard).toEqual({ col: 4, row: 4 });
  });

  it('the farmhouse anchor tile itself is placeable (2026-07-17: the anchor is not a footprint tile)', () => {
    const store = makeStore();
    expect(store.grantPlots(1)).toBe(true);
    store.consumePlotGrantEvents();
    // (-1,-3) is the farmhouse DEFAULT anchor; its 2x2 footprint is
    // (0,-3),(1,-3),(0,-2),(1,-2), so the anchor tile itself is free ground -
    // a plot places there and appends as plot 12.
    expect(store.placePlot(-1, -3)).toBe(BASE_PLOT_COUNT);
  });

  it('the notice board anchor tile is NOT placeable (T3.3b-r1: the board deliberately includes its anchor)', () => {
    const store = makeStore();
    expect(store.grantPlots(1)).toBe(true);
    store.consumePlotGrantEvents();
    // FLIPPED RE-PIN: this test previously asserted placePlot(5,3) succeeded,
    // when the board footprint was the single tile (6,3). The 5-tile diamond
    // includes offset (0,0), so the DEFAULT anchor (5,3) is itself a footprint
    // tile and a plot can no longer be placed there.
    expect(store.placePlot(5, 3)).toBe(false);
    // The board's anchor moves with it: park it away and (5,3) frees up.
    expect(store.moveStructure('noticeBoard', 8, 6)).toBe(true);
    expect(store.placePlot(5, 3)).toBe(BASE_PLOT_COUNT);
  });

  it('isStructureAnchorFree ignores the anchor tile occupancy (2026-07-17): a plot on the anchor does not block', () => {
    const store = makeStore();
    markExpanded(store);
    const state = store.getState();
    // Put a plot on the tile the farmhouse would anchor to at (6,7), leaving
    // its four footprint tiles ((7,7),(8,7),(7,8),(8,8)) clear.
    state.plots.push({ state: 'empty', col: 6, row: 7 });
    // isStructureAnchorFree inspects only the footprint, never the anchor, so
    // the plot on the anchor tile does not make the anchor illegal.
    expect(isStructureAnchorFree(state, 'farmhouse', 6, 7)).toBe(true);
    // Sanity: a plot ON a footprint tile DOES block.
    state.plots.push({ state: 'empty', col: 7, row: 7 });
    expect(isStructureAnchorFree(state, 'farmhouse', 6, 7)).toBe(false);
  });
});

describe('setDecorationTransform vs permanent objects (T3.3s-r1 mutual exclusion)', () => {
  /** A post-tutorial store with one decoration parked on open ground. */
  function makeStoreWithDecor(): GameStateStore {
    const store = new GameStateStore({ storage: makeStorage() });
    completeOnboarding(store);
    store
      .getState()
      .decorations.push({ frame: 'decor_bench', x: 200, y: 1440, scale: 0.55, flip: false });
    return store;
  }

  it('refuses a commit whose anchor lands inside a farmhouse/board/sign footprint tile diamond - mutating nothing', () => {
    const store = makeStoreWithDecor();
    const before = store.exportSave();
    // Farmhouse footprint tile (0,-2): center (796, 640), and that diamond's
    // edge midpoint (860, 608) - both inside. (The anchor tile (-1,-3) is NOT
    // a footprint tile since 2026-07-17, so it is deliberately not used here.)
    expect(store.setDecorationTransform(0, 796, 640, 0.55, false)).toBe(false);
    expect(store.setDecorationTransform(0, 860, 608, 0.55, false)).toBe(false);
    // Notice board footprint tile (6, 3): center (924, 1344). RE-PIN
    // (T3.3b-r1): the board's ANCHOR tile (5,3), center (796, 1280), is a
    // footprint tile now (offset (0,0) is in the 5-tile set), so it is refused
    // too - the previous version of this test deliberately avoided it.
    expect(store.setDecorationTransform(0, 924, 1344, 0.55, false)).toBe(false);
    expect(store.setDecorationTransform(0, 796, 1280, 0.55, false)).toBe(false);
    // Expand sign tile (4, 4): center (540, 1280), pre-expansion.
    expect(store.setDecorationTransform(0, 540, 1280, 0.55, false)).toBe(false);
    expect(store.getState().decorations[0]).toEqual({
      frame: 'decor_bench',
      x: 200,
      y: 1440,
      scale: 0.55,
      flip: false,
    });
    expect(store.exportSave()).toBe(before);
  });

  it('accepts an anchor just outside the footprint diamonds', () => {
    const store = makeStoreWithDecor();
    // (666, 640) sits inside tile (-1,-1)'s diamond - a NON-footprint
    // neighbor just outside the farmhouse 2x2 footprint. Its nearest
    // footprint tile (0,-2) has center (796,640) and thus a west corner at
    // (668,640); (666,640) is 2px past that corner, so it clears every
    // footprint diamond (2026-07-17 re-pin).
    expect(store.setDecorationTransform(0, 666, 640, 0.55, false)).toBe(true);
    expect(store.getState().decorations[0]).toMatchObject({ x: 666, y: 640 });
  });

  it('accepts anchors on sign tiles post-expansion (the sign is gone)', () => {
    const store = makeStoreWithDecor();
    markExpanded(store);
    expect(store.setDecorationTransform(0, 540, 1280, 0.55, false)).toBe(true);
    expect(store.getState().decorations[0]).toMatchObject({ x: 540, y: 1280 });
  });

  it('tracks structure footprints at their LIVE anchors: a moved farmhouse blocks its new tiles and frees its old ones', () => {
    const store = makeStoreWithDecor();
    markExpanded(store);
    expect(store.moveStructure('farmhouse', 4, 5)).toBe(true);
    // New footprint tile (5, 5): center (540, 1408) - refused. (The new
    // anchor tile (4,5) itself would NOT be refused - it is not a footprint
    // tile since 2026-07-17.)
    expect(store.setDecorationTransform(0, 540, 1408, 0.55, false)).toBe(false);
    // A vacated default footprint tile (0,-2), center (796, 640) - accepted now.
    expect(store.setDecorationTransform(0, 796, 640, 0.55, false)).toBe(true);
    expect(store.getState().decorations[0]).toMatchObject({ x: 796, y: 640 });
  });
});

describe('fresh quests state', () => {
  it('starts with zeroed lifetime counters and a deterministic starting weekly rotation (no rng spent)', () => {
    const store = new GameStateStore({ storage: null });
    const quests = store.getState().quests;
    expect(quests.lifetime).toEqual({
      harvestsByCrop: {},
      totalHarvests: 0,
      ordersFulfilled: 0,
      premiumFulfilled: 0,
      chestsOpened: 0,
    });
    expect(quests.weekly.activeIds).toEqual([WEEKLY_QUESTS[0]!.id, WEEKLY_QUESTS[1]!.id]);
    expect(quests.weekly.featuredCrop).toBe('sunwheat');
    expect(quests.weekly.growthTarget).toBe(growthTargetForLevel(1));
    expect(quests.weekly.growMinutes).toBe(0);
    expect(quests.weekly.featuredHarvests).toBe(0);
    expect(quests.weekly.orders).toBe(0);
    expect(quests.weekly.radiants).toBe(0);
    expect(quests.weekly.claimed).toEqual([]);
    expect(quests.weekly.anchor).toBeLessThanOrEqual(Date.now());
    expect(quests.longClaimed).toEqual([]);
  });
});

describe('quests validation and round-trip', () => {
  it('a customized valid quests state round-trips through save/load', () => {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.lifetime.harvestsByCrop.sunwheat = 42;
    saved.quests.lifetime.totalHarvests = 100;
    saved.quests.longClaimed = ['golden_fields'];
    saved.quests.weekly.claimed = ['weekly_trader'];
    expect(isValidState(saved, 12)).toBe(true);

    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().quests).toEqual(saved.quests);
  });

  it('rejects malformed lifetime, weekly, or longClaimed shapes', () => {
    const base = createDefaultState(12);
    expect(
      isValidState(
        {
          ...base,
          quests: { ...base.quests, lifetime: { ...base.quests.lifetime, totalHarvests: 'lots' } },
        },
        12,
      ),
    ).toBe(false);
    expect(
      isValidState(
        {
          ...base,
          quests: {
            ...base.quests,
            weekly: { ...base.quests.weekly, activeIds: ['weekly_trader'] },
          },
        },
        12,
      ),
    ).toBe(false);
    expect(
      isValidState(
        {
          ...base,
          quests: {
            ...base.quests,
            weekly: { ...base.quests.weekly, activeIds: ['not_a_quest', 'weekly_trader'] },
          },
        },
        12,
      ),
    ).toBe(false);
    expect(
      isValidState(
        {
          ...base,
          quests: { ...base.quests, weekly: { ...base.quests.weekly, featuredCrop: 'tomato' } },
        },
        12,
      ),
    ).toBe(false);
    expect(
      isValidState(
        {
          ...base,
          quests: { ...base.quests, weekly: { ...base.quests.weekly, claimed: ['not_a_quest'] } },
        },
        12,
      ),
    ).toBe(false);
    expect(
      isValidState({ ...base, quests: { ...base.quests, longClaimed: ['not_a_quest'] } }, 12),
    ).toBe(false);
    expect(isValidState({ ...base, quests: 'nope' }, 12)).toBe(false);
  });
});

describe('quest counters from harvestPlot', () => {
  /** A completed-onboarding save with a single ready plot at index 0. */
  function readySave(cropId: CropId): GameStateData {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.plots[0] = {
      state: 'growing',
      cropId,
      plantedAt: now() - CROPS[cropId].growMs,
      ...tileOf(0),
    };
    return saved;
  }

  it('increments lifetime harvestsByCrop/totalHarvests and weekly growMinutes', () => {
    const saved = readySave('sunwheat');
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    // rng pinned above RADIANT_CHANCE - no Radiant noise.
    const store = new GameStateStore({ storage, rng: () => 1 });
    store.load();
    expect(store.harvestPlot(0)).toBe(true);
    const state = store.getState();
    expect(state.quests.lifetime.harvestsByCrop.sunwheat).toBe(1);
    expect(state.quests.lifetime.totalHarvests).toBe(1);
    expect(state.quests.weekly.growMinutes).toBeCloseTo(CROPS.sunwheat.growMs / 60_000);

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().quests.lifetime).toEqual(state.quests.lifetime);
  });

  it('counts toward quest counters even during the tutorial', () => {
    const stepIdx = ONBOARDING_STEPS.findIndex((step) => step.id === 'harvest-first');
    const saved = createDefaultState(12);
    saved.onboarding = { completed: false, step: stepIdx, progress: 0, progressB: 0 };
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: now() - CROPS.sunwheat.growMs,
      ...tileOf(0),
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 1 });
    store.load();
    expect(store.harvestPlot(0)).toBe(true);
    const state = store.getState();
    expect(state.quests.lifetime.totalHarvests).toBe(1);
    expect(state.quests.weekly.growMinutes).toBeCloseTo(CROPS.sunwheat.growMs / 60_000);
  });

  it("increments weekly featuredHarvests only when the harvested crop matches this week's featured crop", () => {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.weekly.featuredCrop = 'starcorn';
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: now() - CROPS.sunwheat.growMs,
      ...tileOf(0),
    };
    saved.plots[1] = {
      state: 'growing',
      cropId: 'starcorn',
      plantedAt: now() - CROPS.starcorn.growMs,
      ...tileOf(1),
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 1 });
    store.load();
    expect(store.harvestPlot(0)).toBe(true); // sunwheat, not featured
    expect(store.harvestPlot(1)).toBe(true); // starcorn, featured
    expect(store.getState().quests.weekly.featuredHarvests).toBe(1);
  });

  it('increments weekly radiants only on an actual Radiant proc', () => {
    const saved = readySave('sunwheat');
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    // stubRng(0, RADIANT_MOONDUST_CHANCE): 0 < RADIANT_CHANCE procs Radiant.
    const store = new GameStateStore({ storage, rng: stubRng(0, RADIANT_MOONDUST_CHANCE) });
    store.load();
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().quests.weekly.radiants).toBe(1);
  });

  it('does not increment weekly radiants on a non-Radiant harvest', () => {
    const saved = readySave('sunwheat');
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    // RADIANT_CHANCE itself is not < RADIANT_CHANCE - no proc.
    const store = new GameStateStore({ storage, rng: stubRng(RADIANT_CHANCE) });
    store.load();
    expect(store.harvestPlot(0)).toBe(true);
    expect(store.getState().quests.weekly.radiants).toBe(0);
  });
});

describe('quest counters from fulfillOrder', () => {
  /** A completed-onboarding save with `order` open in slot 0 and given inventory. */
  function savedStateWithOpenOrder(
    order: Order,
    inventory: Partial<Record<CropId, number>>,
  ): GameStateData {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.inventory = inventory;
    saved.orders[0] = { state: 'open', order };
    return saved;
  }

  it('increments lifetime ordersFulfilled and weekly orders on any fulfillment', () => {
    const order: Order = { items: [{ cropId: 'sunwheat', count: 1 }], coinReward: 10, xpReward: 2 };
    const saved = savedStateWithOpenOrder(order, { sunwheat: 1 });
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.fulfillOrder(0)).toBe(true);
    const state = store.getState();
    expect(state.quests.lifetime.ordersFulfilled).toBe(1);
    expect(state.quests.weekly.orders).toBe(1);
    expect(state.quests.lifetime.premiumFulfilled).toBe(0);
  });

  it('increments premiumFulfilled for a premium order, and chestsOpened by exactly the chests granted', () => {
    const order: Order = {
      items: [{ cropId: 'sunwheat', count: 1 }],
      coinReward: 10,
      xpReward: 2,
      premium: { moondust: 2, flavor: 'A test flavor line', chests: 2 },
    };
    const saved = savedStateWithOpenOrder(order, { sunwheat: 1 });
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    expect(store.fulfillOrder(0)).toBe(true);
    const state = store.getState();
    expect(state.quests.lifetime.premiumFulfilled).toBe(1);
    expect(state.quests.lifetime.chestsOpened).toBe(2);
  });

  it('does not increment chestsOpened for a premium order with no chests field', () => {
    const order: Order = {
      items: [{ cropId: 'sunwheat', count: 1 }],
      coinReward: 10,
      xpReward: 2,
      premium: { moondust: 1, flavor: 'A test flavor line' },
    };
    const saved = savedStateWithOpenOrder(order, { sunwheat: 1 });
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.fulfillOrder(0)).toBe(true);
    expect(store.getState().quests.lifetime.chestsOpened).toBe(0);
    expect(store.getState().quests.lifetime.premiumFulfilled).toBe(1);
  });

  it('counts toward quest counters during the tutorial too (the scripted deliver-sunwheat step)', () => {
    const stepIdx = ONBOARDING_STEPS.findIndex((step) => step.id === 'deliver-sunwheat');
    const saved = createDefaultState(12);
    saved.onboarding = { completed: false, step: stepIdx, progress: 0, progressB: 0 };
    saved.inventory = { sunwheat: 6 };
    saved.orders[0] = { state: 'open', order: ONBOARDING_ORDER_A };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.fulfillOrder(0)).toBe(true);
    expect(store.getState().quests.lifetime.ordersFulfilled).toBe(1);
    expect(store.getState().quests.weekly.orders).toBe(1);
  });
});

describe('ensureWeeklyQuests (weekly rotation)', () => {
  /** A completed-onboarding, current-version save. */
  function completedSave(): GameStateData {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    return saved;
  }

  it('does not roll over before anchor + WEEK_MS', () => {
    const saved = completedSave();
    const anchor = Date.now() - (WEEK_MS - 60_000);
    saved.quests.weekly.anchor = anchor;
    saved.quests.weekly.orders = 5;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().quests.weekly.anchor).toBe(anchor);
    expect(store.getState().quests.weekly.orders).toBe(5);
  });

  it('rolls over once anchor + WEEK_MS has passed: advances anchor, resets counters/claimed, redraws activeIds/featuredCrop, persists', () => {
    const saved = completedSave();
    const oldAnchor = Date.now() - WEEK_MS - 1000;
    saved.quests.weekly = {
      anchor: oldAnchor,
      activeIds: ['weekly_trader', 'weekly_radiance'],
      featuredCrop: 'glowberry',
      growthTarget: growthTargetForLevel(1),
      growMinutes: 123,
      featuredHarvests: 4,
      orders: 12,
      radiants: 2,
      claimed: ['weekly_trader'],
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    const weekly = store.getState().quests.weekly;
    expect(weekly.anchor).toBe(oldAnchor + WEEK_MS);
    expect(weekly.growMinutes).toBe(0);
    expect(weekly.featuredHarvests).toBe(0);
    expect(weekly.orders).toBe(0);
    expect(weekly.radiants).toBe(0);
    expect(weekly.claimed).toEqual([]);
    expect(weekly.activeIds).toEqual(['weekly_growth', 'weekly_specialist']);
    expect(weekly.featuredCrop).toBe('sunwheat');

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().quests.weekly.anchor).toBe(oldAnchor + WEEK_MS);
  });

  it('catches up multiple missed weeks in one jump, not one redraw per missed week', () => {
    const saved = completedSave();
    const oldAnchor = Date.now() - WEEK_MS * 3 - 1000;
    saved.quests.weekly.anchor = oldAnchor;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    expect(store.getState().quests.weekly.anchor).toBe(oldAnchor + WEEK_MS * 3);
  });

  it('is idempotent - calling it again immediately after a rollover changes nothing further', () => {
    const saved = completedSave();
    saved.quests.weekly.anchor = Date.now() - WEEK_MS - 1000;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    store.ensureWeeklyQuests();
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });
});

describe('questProgress', () => {
  it('returns null for an unknown quest id', () => {
    const store = new GameStateStore({ storage: null });
    expect(store.questProgress('not_a_quest')).toBeNull();
  });

  it("derives a long quest's progress from its lifetime counter", () => {
    const goldenFields = LONG_QUESTS.find((quest) => quest.id === 'golden_fields')!;
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.lifetime.harvestsByCrop.sunwheat = 250;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.questProgress('golden_fields')).toEqual({
      current: 250,
      target: goldenFields.target,
      complete: false,
      claimed: false,
    });
  });

  it('marks a long quest complete once its counter reaches target, and claimed once in longClaimed', () => {
    const treasureHunter = LONG_QUESTS.find((quest) => quest.id === 'treasure_hunter')!;
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.lifetime.chestsOpened = treasureHunter.target;
    saved.quests.longClaimed = ['treasure_hunter'];
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.questProgress('treasure_hunter')).toEqual({
      current: treasureHunter.target,
      target: treasureHunter.target,
      complete: true,
      claimed: true,
    });
  });

  it("derives weekly_specialist's target from perCropTarget keyed by the featured crop", () => {
    const specialist = WEEKLY_QUESTS.find((quest) => quest.id === 'weekly_specialist')!;
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.weekly.featuredCrop = 'moonroot';
    saved.quests.weekly.featuredHarvests = 5;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.questProgress('weekly_specialist')).toEqual({
      current: 5,
      target: specialist.perCropTarget!.moonroot,
      complete: false,
      claimed: false,
    });
  });

  it("derives a flat-target weekly quest's progress (weekly_trader: orders vs its target)", () => {
    const trader = WEEKLY_QUESTS.find((quest) => quest.id === 'weekly_trader')!;
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.weekly.orders = trader.target!;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.questProgress('weekly_trader')).toEqual({
      current: trader.target,
      target: trader.target,
      complete: true,
      claimed: false,
    });
  });
});

describe('claimQuest', () => {
  /** A completed-onboarding save with `questId`'s lifetime counter already at target. */
  function completedLongSave(questId: string): GameStateData {
    const def = LONG_QUESTS.find((quest) => quest.id === questId)!;
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    switch (def.counter.kind) {
      case 'cropHarvests':
        saved.quests.lifetime.harvestsByCrop[def.counter.cropId] = def.target;
        break;
      case 'totalHarvests':
        saved.quests.lifetime.totalHarvests = def.target;
        break;
      case 'ordersFulfilled':
        saved.quests.lifetime.ordersFulfilled = def.target;
        break;
      case 'premiumFulfilled':
        saved.quests.lifetime.premiumFulfilled = def.target;
        break;
      case 'chestsOpened':
        saved.quests.lifetime.chestsOpened = def.target;
        break;
    }
    return saved;
  }

  it('rejects claims while onboarding is active, even if complete, without mutation', () => {
    const saved = completedLongSave('golden_fields');
    saved.onboarding = { completed: false, step: 0, progress: 0, progressB: 0 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.claimQuest('golden_fields')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('rejects an unknown quest id, and a quest that is not yet complete', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    expect(store.claimQuest('not_a_quest')).toBe(false);
    expect(store.claimQuest('golden_fields')).toBe(false); // fresh save, 0 harvests
  });

  it('claims a trophy-reward long quest: grants the trophy into the warehouse (no cap check), marks longClaimed, one-time', () => {
    const saved = completedLongSave('golden_fields');
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.claimQuest('golden_fields')).toBe(true);
    const state = store.getState();
    expect(state.warehouse.trophy_goldscarecrow).toBe(1);
    expect(state.quests.longClaimed).toEqual(['golden_fields']);
    // One-time: a second claim fails without granting a second trophy.
    expect(store.claimQuest('golden_fields')).toBe(false);
    expect(store.getState().warehouse.trophy_goldscarecrow).toBe(1);

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().warehouse.trophy_goldscarecrow).toBe(1);
    expect(reloaded.getState().quests.longClaimed).toEqual(['golden_fields']);
  });

  it('claiming a trophy at the purchasable cap survives a reload - the farm is intact, not reset (T3.17 regression)', () => {
    const saved = completedLongSave('golden_fields');
    saved.warehouse = { decor_fence: 30 }; // already at the purchasable cap
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const coinsBefore = store.getState().coins;
    const levelBefore = store.getState().level;
    expect(store.claimQuest('golden_fields')).toBe(true);
    expect(store.getState().warehouse.trophy_goldscarecrow).toBe(1);

    // The save-destroying bug: this 30-purchasable + 1-trophy save used to
    // fail validation on the next launch and reset the farm. It must load
    // intact now.
    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    const state = reloaded.getState();
    expect(state.warehouse.trophy_goldscarecrow).toBe(1);
    expect(state.warehouse.decor_fence).toBe(30);
    expect(state.quests.longClaimed).toEqual(['golden_fields']);
    expect(state.coins).toBe(coinsBefore);
    expect(state.level).toBe(levelBefore);
  });

  it('claims a chests-reward long quest (village_favorite): grants coins/moondust instantly and queues a matching ChestEvent', () => {
    const saved = completedLongSave('village_favorite'); // reward: { chests: 2 }
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: stubRng(0, 0, 0.999999, 1) });
    store.load();
    const coinsBefore = store.getState().coins;
    const moondustBefore = store.getState().moondust;
    expect(store.claimQuest('village_favorite')).toBe(true);
    const state = store.getState();
    expect(state.coins).toBe(coinsBefore + CHEST_COINS_MIN + CHEST_COINS_MAX);
    expect(state.moondust).toBe(moondustBefore + CHEST_MOONDUST_AMOUNT);
    const events = store.consumeChestEvents();
    expect(events).toEqual([
      {
        contents: [
          { coins: CHEST_COINS_MIN, moondust: CHEST_MOONDUST_AMOUNT },
          { coins: CHEST_COINS_MAX, moondust: 0 },
        ],
      },
    ]);
  });

  it('claims a moondust-only weekly quest (weekly_trader): ticks moondust directly, no chest event', () => {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.weekly.activeIds = ['weekly_trader', 'weekly_radiance'];
    saved.quests.weekly.orders = WEEKLY_QUESTS.find(
      (quest) => quest.id === 'weekly_trader',
    )!.target!;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const moondustBefore = store.getState().moondust;
    expect(store.claimQuest('weekly_trader')).toBe(true);
    expect(store.getState().moondust).toBe(moondustBefore + 3);
    expect(store.consumeChestEvents()).toEqual([]);
    expect(store.getState().quests.weekly.claimed).toEqual(['weekly_trader']);
  });

  it('claims a composable chests+moondust weekly quest (weekly_specialist)', () => {
    const specialist = WEEKLY_QUESTS.find((quest) => quest.id === 'weekly_specialist')!;
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.weekly.featuredCrop = 'emberpepper';
    saved.quests.weekly.featuredHarvests = specialist.perCropTarget!.emberpepper!;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    // grantChests(1) rolls: coins=MIN (rng 0), moondust chance rng 1 (fails).
    const store = new GameStateStore({ storage, rng: stubRng(0, 1) });
    store.load();
    const coinsBefore = store.getState().coins;
    const moondustBefore = store.getState().moondust;
    expect(store.claimQuest('weekly_specialist')).toBe(true);
    const state = store.getState();
    expect(state.coins).toBe(coinsBefore + CHEST_COINS_MIN);
    expect(state.moondust).toBe(moondustBefore + 2); // reward moondust only - chest roll missed
    expect(store.consumeChestEvents()).toHaveLength(1);
  });

  it('rejects claiming a weekly quest that is complete but currently rotated out of activeIds, without mutation', () => {
    const trader = WEEKLY_QUESTS.find((quest) => quest.id === 'weekly_trader')!;
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.weekly.activeIds = ['weekly_growth', 'weekly_radiance']; // trader not active
    saved.quests.weekly.orders = trader.target!; // complete anyway
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.claimQuest('weekly_trader')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('rejects a double-claim of the same weekly quest within the same week', () => {
    const trader = WEEKLY_QUESTS.find((quest) => quest.id === 'weekly_trader')!;
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.weekly.activeIds = ['weekly_trader', 'weekly_radiance'];
    saved.quests.weekly.orders = trader.target!;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.claimQuest('weekly_trader')).toBe(true);
    expect(store.claimQuest('weekly_trader')).toBe(false);
    expect(store.getState().quests.weekly.claimed).toEqual(['weekly_trader']);
  });

  it('a rollover clears a previously-claimed weekly id and its counter - the old claim cannot leak into the new week', () => {
    const trader = WEEKLY_QUESTS.find((quest) => quest.id === 'weekly_trader')!;
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.weekly.activeIds = ['weekly_trader', 'weekly_radiance'];
    saved.quests.weekly.orders = trader.target!;
    saved.quests.weekly.claimed = ['weekly_trader'];
    saved.quests.weekly.anchor = Date.now() - WEEK_MS - 1000;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    // Redraw: first pick floor(0.5*4)=2 -> 'weekly_trader'; second pick from
    // the remaining 3 (growth, specialist, radiance), floor(0*3)=0 ->
    // 'weekly_growth'; featured crop from the level-1 unlocked pool
    // ([sunwheat] only), floor(0*1)=0 -> 'sunwheat'.
    const store = new GameStateStore({ storage, rng: stubRng(0.5, 0, 0) });
    store.load();
    const weekly = store.getState().quests.weekly;
    expect(weekly.activeIds).toEqual(['weekly_trader', 'weekly_growth']);
    expect(weekly.orders).toBe(0);
    expect(weekly.claimed).toEqual([]);
    // The stale claim and progress are gone - claiming now fails until re-earned.
    expect(store.claimQuest('weekly_trader')).toBe(false);

    // Re-earning it fresh this week can be claimed again - the old claim did
    // not carry over and does not block a new one.
    store.getState().quests.weekly.orders = trader.target!;
    expect(store.claimQuest('weekly_trader')).toBe(true);
    expect(store.getState().quests.weekly.claimed).toEqual(['weekly_trader']);
  });
});

describe('featured crop draws from unlocked crops only (T3.19)', () => {
  /**
   * Force a rollover at `level` with the featured-crop draw fed `r`. No
   * weekly is complete in the fixture, so the rng calls inside
   * ensureWeeklyQuests are exactly: 2 id draws, then the featured-crop draw.
   */
  function featuredCropAfterRollover(level: number, r: number): CropId {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.level = level;
    saved.quests.weekly.anchor = Date.now() - WEEK_MS - 1000;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: stubRng(0, 0, r) });
    store.load();
    return store.getState().quests.weekly.featuredCrop;
  }

  /** rng sweep dense enough to hit every bucket of a 7-crop uniform pick. */
  const RNG_SWEEP = Array.from({ length: 20 }, (_, i) => i / 20);

  it('at level 3, only sunwheat/starcorn/glowberry can be featured', () => {
    const drawn = new Set(RNG_SWEEP.map((r) => featuredCropAfterRollover(3, r)));
    expect([...drawn].sort()).toEqual(['glowberry', 'starcorn', 'sunwheat']);
  });

  it('at level 8, all 7 crops are possible', () => {
    const drawn = new Set(RNG_SWEEP.map((r) => featuredCropAfterRollover(8, r)));
    expect(drawn.size).toBe(Object.keys(CROPS).length);
  });
});

describe('weekly_specialist per-crop targets are exhaustive (T3.19)', () => {
  it('every crop has a positive target; dewmelon is 5, sagesprig is 3', () => {
    const specialist = WEEKLY_QUESTS.find((quest) => quest.id === 'weekly_specialist')!;
    for (const cropId of Object.keys(CROPS) as CropId[]) {
      expect(specialist.perCropTarget![cropId]).toBeGreaterThan(0);
    }
    expect(specialist.perCropTarget!.dewmelon).toBe(5);
    expect(specialist.perCropTarget!.sagesprig).toBe(3);
  });
});

describe('growthTargetForLevel (T3.19)', () => {
  it('matches the owner-approved table exactly for levels 1..8', () => {
    expect(GROWTH_TARGETS_BY_LEVEL).toEqual([240, 240, 400, 600, 900, 1300, 1900, 2800]);
    for (let level = 1; level <= 8; level++) {
      expect(growthTargetForLevel(level)).toBe(GROWTH_TARGETS_BY_LEVEL[level - 1]);
    }
  });

  it('clamps below 1 to the first entry and above 8 to the last', () => {
    expect(growthTargetForLevel(0)).toBe(240);
    expect(growthTargetForLevel(-3)).toBe(240);
    expect(growthTargetForLevel(9)).toBe(2800);
    expect(growthTargetForLevel(99)).toBe(2800);
  });
});

describe('growth target snapshot at rollover (T3.19)', () => {
  /** A completed-onboarding save at `level` whose week has expired. */
  function expiredSave(level: number): GameStateData {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.level = level;
    saved.quests.weekly.anchor = Date.now() - WEEK_MS - 1000;
    return saved;
  }

  it('a rollover at level 8 stamps 2800 as the new week growthTarget', () => {
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(expiredSave(8)) });
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    expect(store.getState().quests.weekly.growthTarget).toBe(2800);
  });

  it('gaining a level mid-week does not move the active target, and a quest completed before the level-up stays complete', () => {
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(expiredSave(3)) });
    // rng () => 0 redraws activeIds as [weekly_growth, weekly_specialist].
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    expect(store.getState().quests.weekly.growthTarget).toBe(400);
    store.getState().quests.weekly.growMinutes = 400;
    expect(store.questProgress('weekly_growth')).toEqual({
      current: 400,
      target: 400,
      complete: true,
      claimed: false,
    });

    store.setLevel(4); // level 4 would mean 600 if the target were re-derived
    expect(store.questProgress('weekly_growth')).toEqual({
      current: 400,
      target: 400,
      complete: true,
      claimed: false,
    });
  });
});

describe('weekly rollover auto-grant of completed-unclaimed rewards (T3.19)', () => {
  /** A completed-onboarding save whose week expired `weeks` weeks ago. */
  function expiredSave(weeks = 1): GameStateData {
    const saved = createDefaultState(12);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    saved.quests.weekly.anchor = Date.now() - WEEK_MS * weeks - 1000;
    return saved;
  }

  it('grants a completed-unclaimed weekly_trader exactly once and queues one notice naming it and the new quests', () => {
    const saved = expiredSave();
    saved.quests.weekly.activeIds = ['weekly_trader', 'weekly_radiance'];
    saved.quests.weekly.orders = 12; // complete, unclaimed
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    // rng () => 0: no rng in the moondust-only grant; redraw picks
    // [weekly_growth, weekly_specialist] and sunwheat.
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    expect(store.getState().moondust).toBe(3);
    expect(store.consumeWeeklyNotices()).toEqual([
      {
        granted: [{ name: 'Weekly Trader', chests: 0, moondust: 3 }],
        newQuestNames: ['Growing Strong', 'Specialist'],
      },
    ]);
    // Exactly once: the anchor advanced, so another pass is a no-op.
    store.ensureWeeklyQuests();
    expect(store.getState().moondust).toBe(3);
    expect(store.consumeWeeklyNotices()).toEqual([]);
  });

  it('does not re-grant an already-claimed quest, does not grant an incomplete one, and a bare rotation queues no notice', () => {
    const saved = expiredSave();
    saved.quests.weekly.activeIds = ['weekly_trader', 'weekly_radiance'];
    saved.quests.weekly.orders = 12;
    saved.quests.weekly.claimed = ['weekly_trader']; // already claimed mid-week
    // weekly_radiance is incomplete (radiants 0/2).
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    expect(store.getState().moondust).toBe(0);
    expect(store.consumeChestEvents()).toEqual([]);
    expect(store.consumeWeeklyNotices()).toEqual([]);
  });

  it('banks a completed weekly_growth as chest contents instantly, queuing a ChestEvent plus the notice', () => {
    const saved = expiredSave();
    saved.quests.weekly.activeIds = ['weekly_growth', 'weekly_radiance'];
    // Complete against the expired week's own snapshot target.
    saved.quests.weekly.growMinutes = saved.quests.weekly.growthTarget;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    // grantChests(1) rolls coins (0 -> MIN) then the moondust chance
    // (1 -> miss); the redraw then consumes the remaining values.
    const store = new GameStateStore({ storage, rng: stubRng(0, 1, 0, 0, 0) });
    store.load();
    expect(store.getState().coins).toBe(50 + CHEST_COINS_MIN);
    expect(store.consumeChestEvents()).toEqual([
      { contents: [{ coins: CHEST_COINS_MIN, moondust: 0 }] },
    ]);
    const notices = store.consumeWeeklyNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]!.granted).toEqual([{ name: 'Growing Strong', chests: 1, moondust: 0 }]);
  });

  it('a multi-week gap runs the grant pass once and the anchor catches up in one jump', () => {
    const saved = expiredSave(4);
    const oldAnchor = saved.quests.weekly.anchor;
    saved.quests.weekly.activeIds = ['weekly_trader', 'weekly_radiance'];
    saved.quests.weekly.orders = 12;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    expect(store.getState().quests.weekly.anchor).toBe(oldAnchor + WEEK_MS * 4);
    expect(store.getState().moondust).toBe(3); // once, not once per missed week
    expect(store.consumeWeeklyNotices()).toHaveLength(1);
  });

  it('the notice queue is cleared by load() like the other transient queues', () => {
    const saved = expiredSave();
    saved.quests.weekly.activeIds = ['weekly_trader', 'weekly_radiance'];
    saved.quests.weekly.orders = 12;
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load(); // queues one notice via the load-time rollover
    // A reload clears the un-drained queue first; the already-advanced
    // anchor queues nothing new.
    store.load();
    expect(store.consumeWeeklyNotices()).toEqual([]);
  });
});

describe('buildings (T4.1, schema v23)', () => {
  const MILL = BUILDINGS.flour_mill;

  /** A store past the tutorial, at the mill's unlock level with its price in hand. */
  function millReadyStore(): GameStateStore {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.setLevel(MILL.unlockLevel);
    store.addCoins(MILL.price);
    return store;
  }

  describe('buyBuilding gates', () => {
    it('refuses below the unlock level, mutating nothing', () => {
      const store = millReadyStore();
      store.setLevel(MILL.unlockLevel - 1);
      const coins = store.getState().coins;
      expect(store.buyBuilding('flour_mill')).toBe(false);
      expect(store.getState().buildings).toEqual([]);
      expect(store.getState().coins).toBe(coins);
    });

    it('refuses when coins are short by one, mutating nothing', () => {
      const store = new GameStateStore({ storage: null });
      completeOnboarding(store);
      store.setLevel(MILL.unlockLevel);
      store.addCoins(MILL.price - 1 - store.getState().coins);
      expect(store.getState().coins).toBe(MILL.price - 1);
      expect(store.buyBuilding('flour_mill')).toBe(false);
      expect(store.getState().buildings).toEqual([]);
      expect(store.getState().coins).toBe(MILL.price - 1);
    });

    it('refuses an unknown building type', () => {
      const store = millReadyStore();
      // The gate is `findBuilding`, so an off-registry id never reaches the
      // coin deduction - cast because the id is deliberately not a BuildingId.
      expect(store.buyBuilding('barn' as 'flour_mill')).toBe(false);
      expect(store.getState().buildings).toEqual([]);
    });

    it('refuses a SECOND mill and never double-charges (v1: one per type)', () => {
      const store = millReadyStore();
      store.addCoins(MILL.price); // enough for two, if the guard were missing
      expect(store.buyBuilding('flour_mill')).toBe(true);
      const afterFirst = store.getState().coins;
      expect(store.buyBuilding('flour_mill')).toBe(false);
      expect(store.getState().buildings).toHaveLength(1);
      expect(store.getState().coins).toBe(afterFirst);
    });

    it('on success deducts the price, appends at the default anchor, and saves', () => {
      const storage = makeStorage();
      const store = new GameStateStore({ storage });
      completeOnboarding(store);
      store.setLevel(MILL.unlockLevel);
      store.addCoins(MILL.price);
      const before = store.getState().coins;
      expect(store.buyBuilding('flour_mill')).toBe(true);
      expect(store.getState().coins).toBe(before - MILL.price);
      expect(store.getState().buildings).toEqual([
        {
          type: 'flour_mill',
          col: MILL.defaultAnchor.col,
          row: MILL.defaultAnchor.row,
          batches: [],
        },
      ]);
      // Persisted, not just in memory.
      const reloaded = new GameStateStore({ storage });
      reloaded.load();
      expect(reloaded.getState().buildings).toEqual(store.getState().buildings);
    });

    it('devBuildBuilding skips the level and coin gates but keeps the one-per-type guard', () => {
      const store = new GameStateStore({ storage: null });
      completeOnboarding(store);
      const coins = store.getState().coins;
      expect(store.getState().level).toBeLessThan(MILL.unlockLevel);
      expect(coins).toBeLessThan(MILL.price);
      expect(store.devBuildBuilding('flour_mill')).toBe(true);
      expect(store.getState().buildings).toHaveLength(1);
      expect(store.getState().coins).toBe(coins); // free
      expect(store.devBuildBuilding('flour_mill')).toBe(false);
      expect(store.getState().buildings).toHaveLength(1);
    });

    it('the default anchor of the mill is legal on a fresh farm', () => {
      // Otherwise a bought mill would land on blocked ground with no way to
      // notice until the player tried to move it.
      const store = millReadyStore();
      expect(
        isBuildingAnchorFree(
          store.getState(),
          'flour_mill',
          MILL.defaultAnchor.col,
          MILL.defaultAnchor.row,
        ),
      ).toBe(true);
    });
  });

  describe('moveBuilding', () => {
    /** A store owning one mill, expanded so the sign's tiles are normal ground. */
    function storeWithMill(): GameStateStore {
      const store = new GameStateStore({ storage: null });
      completeOnboarding(store);
      markExpanded(store);
      expect(store.devBuildBuilding('flour_mill')).toBe(true);
      return store;
    }

    it('refuses an out-of-range index', () => {
      const store = storeWithMill();
      expect(store.moveBuilding(1, -3, 0)).toBe(false);
      expect(store.moveBuilding(-1, -3, 0)).toBe(false);
    });

    it('refuses a footprint that would overlap a plot', () => {
      const store = storeWithMill();
      const before = { ...store.getState().buildings[0]! };
      // The default farm holds plots at cols 0..3, rows 0..2. Anchor (-1, 0)
      // puts footprint offset (1,0) on tile (0,0) - plot index 0's tile.
      expect(store.getState().plots[0]).toMatchObject({ col: 0, row: 0 });
      expect(store.moveBuilding(0, -1, 0)).toBe(false);
      expect(store.getState().buildings[0]).toEqual(before);
    });

    it('refuses a footprint that would overlap the farmhouse footprint', () => {
      const store = storeWithMill();
      const farmhouse = store.getState().structures.farmhouse;
      // Same anchor as the farmhouse = the identical 2x2 block (the mill's
      // footprint IS the farmhouse's), so every tile collides.
      expect(store.moveBuilding(0, farmhouse.col, farmhouse.row)).toBe(false);
    });

    it('refuses a non-integer anchor', () => {
      const store = storeWithMill();
      expect(store.moveBuilding(0, -3.5, 0)).toBe(false);
    });

    it('accepts a free anchor, persists it, and re-derives the render position', () => {
      const storage = makeStorage();
      const store = new GameStateStore({ storage });
      completeOnboarding(store);
      markExpanded(store);
      expect(store.devBuildBuilding('flour_mill')).toBe(true);
      // (-4, -1) - one step north-west of the default anchor (-3, 0). Its 2x2
      // block is (-3,-1),(-2,-1),(-3,0),(-2,0): all inside the base placeable
      // rect, clear of the plots (cols 0..3) and of both structures.
      expect(store.moveBuilding(0, -4, -1)).toBe(true);
      expect(store.getState().buildings[0]).toEqual({
        type: 'flour_mill',
        col: -4,
        row: -1,
        batches: [],
      });
      const reloaded = new GameStateStore({ storage });
      reloaded.load();
      expect(reloaded.getState().buildings[0]).toEqual({
        type: 'flour_mill',
        col: -4,
        row: -1,
        batches: [],
      });
      // Render position derives from the NEW anchor, never a stored pixel value.
      expect(buildingRenderPosition('flour_mill', { col: -4, row: -1 })).toEqual({
        x: gridToIso(-4, -1).x + MILL.renderOffset.x,
        y: gridToIso(-4, -1).y + MILL.renderOffset.y,
      });
    });

    it('a move onto its OWN current anchor is a valid no-op commit', () => {
      // The self-exemption: a building must not be blocked by where it already
      // stands, mirroring moveStructure and movePlot.
      const store = storeWithMill();
      const anchor = { ...store.getState().buildings[0]! };
      expect(store.moveBuilding(0, anchor.col, anchor.row)).toBe(true);
      expect(store.getState().buildings[0]).toEqual(anchor);
    });
  });

  describe('the shared structures+buildings footprint mechanism', () => {
    it('a building footprint blocks plot placement on every one of its tiles', () => {
      const store = new GameStateStore({ storage: null });
      completeOnboarding(store);
      markExpanded(store);
      expect(store.devBuildBuilding('flour_mill')).toBe(true);
      const placement = store.getState().buildings[0]!;
      const tiles = buildingFootprintTiles('flour_mill', placement);
      expect(tiles).toHaveLength(MILL.footprintOffsets.length);
      for (const tile of tiles) {
        expect(isPlotTileFree(store.getState(), tile.col, tile.row)).toBe(false);
      }
      // And placePlot - the store path - refuses on the same tiles.
      expect(store.grantPlots(1)).toBe(true);
      expect(store.placePlot(tiles[0]!.col, tiles[0]!.row)).toBe(false);
      expect(store.getState().unplacedPlots).toBe(1);
    });

    it('a building footprint blocks a STRUCTURE anchor, and moves with the building', () => {
      const store = new GameStateStore({ storage: null });
      completeOnboarding(store);
      markExpanded(store);
      expect(store.devBuildBuilding('flour_mill')).toBe(true);
      const anchor = { ...store.getState().buildings[0]! };
      // The farmhouse's footprint is the mill's, so the mill's own anchor is
      // exactly the anchor that would make the two blocks coincide.
      expect(isStructureAnchorFree(store.getState(), 'farmhouse', anchor.col, anchor.row)).toBe(
        false,
      );
      // Move the mill clear across the farm; the previously blocked anchor
      // frees up, which is what "derived live, never cached" means. (6, 6) is
      // east of everything: its 2x2 block is (7,6),(8,6),(7,7),(8,7).
      expect(store.moveBuilding(0, 6, 6)).toBe(true);
      expect(isStructureAnchorFree(store.getState(), 'farmhouse', anchor.col, anchor.row)).toBe(
        true,
      );
    });

    it('two buildings block each other (no mill special-casing)', () => {
      // The one-per-type purchase guard is a PURCHASE rule, not a placement
      // rule - the footprint mechanism is written for N buildings, so it is
      // exercised here with a hand-placed second instance.
      const store = new GameStateStore({ storage: null });
      completeOnboarding(store);
      markExpanded(store);
      store
        .getState()
        .buildings.push(
          { type: 'flour_mill', col: -3, row: 0, batches: [] },
          { type: 'flour_mill', col: 6, row: 6, batches: [] },
        );
      // Index 1 may not move onto index 0's anchor...
      expect(store.moveBuilding(1, -3, 0)).toBe(false);
      // ...but may still move onto its own (the self-exemption).
      expect(store.moveBuilding(1, 6, 6)).toBe(true);
      // ...and index 0 is symmetrically blocked by index 1.
      expect(store.moveBuilding(0, 6, 6)).toBe(false);
    });

    it('a building may not straddle the edge of the placeable domain', () => {
      const store = new GameStateStore({ storage: null });
      completeOnboarding(store);
      markExpanded(store);
      expect(store.devBuildBuilding('flour_mill')).toBe(true);
      // Far outside the base placeable rect (and no region unlocked).
      expect(store.moveBuilding(0, PLOT_GRID_COORD_MIN, PLOT_GRID_COORD_MIN)).toBe(false);
    });
  });

  describe('schema v22 -> v23 migration', () => {
    it('a v22 save (no buildings field) gains an empty buildings list, no warnings', () => {
      const saved = createDefaultState(24) as unknown as Record<string, unknown>;
      saved.version = 22;
      delete saved.buildings; // a genuine v22 save never had this field
      saved.coins = 2468;
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState()).toEqual({ ...saved, version: 24, buildings: [] });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('a full-chain v1 save lands at version 24 with no buildings', () => {
      const saved = createDefaultState(1) as unknown as Record<string, unknown>;
      delete saved.buildings;
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState().version).toBe(24);
      expect(store.getState().buildings).toEqual([]);
    });

    it('a fresh save starts with no buildings either', () => {
      expect(createDefaultState(24).buildings).toEqual([]);
    });

    it('the migration leaves structures, decorations and plots alone', () => {
      const saved = createDefaultState(24) as unknown as Record<string, unknown>;
      saved.version = 22;
      delete saved.buildings;
      const before = {
        structures: JSON.parse(JSON.stringify(saved.structures)) as unknown,
        decorations: JSON.parse(JSON.stringify(saved.decorations)) as unknown,
        plots: JSON.parse(JSON.stringify(saved.plots)) as unknown,
      };
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState().structures).toEqual(before.structures);
      expect(store.getState().decorations).toEqual(before.decorations);
      expect(store.getState().plots).toEqual(before.plots);
    });
  });

  describe('validation', () => {
    it('accepts a fresh state and a state holding a legal placement', () => {
      expect(isValidState(createDefaultState(24), 24)).toBe(true);
      const withMill = createDefaultState(24);
      withMill.buildings = [{ type: 'flour_mill', col: -3, row: 0, batches: [] }];
      expect(isValidState(withMill, 24)).toBe(true);
    });

    it('rejects a missing or non-array buildings field', () => {
      const missing = createDefaultState(24) as unknown as Record<string, unknown>;
      delete missing.buildings;
      expect(isValidState(missing, 24)).toBe(false);
      const wrongType = createDefaultState(24) as unknown as Record<string, unknown>;
      wrongType.buildings = {};
      expect(isValidState(wrongType, 24)).toBe(false);
    });

    it('rejects a placement with an unknown type or out-of-bounds coordinates', () => {
      const badType = createDefaultState(24) as unknown as Record<string, unknown>;
      badType.buildings = [{ type: 'barn', col: 0, row: 0, batches: [] }];
      expect(isValidState(badType, 24)).toBe(false);

      const badCol = createDefaultState(24) as unknown as Record<string, unknown>;
      badCol.buildings = [
        { type: 'flour_mill', col: PLOT_GRID_COORD_MAX + 1, row: 0, batches: [] },
      ];
      expect(isValidState(badCol, 24)).toBe(false);

      const fractional = createDefaultState(24) as unknown as Record<string, unknown>;
      fractional.buildings = [{ type: 'flour_mill', col: 0.5, row: 0, batches: [] }];
      expect(isValidState(fractional, 24)).toBe(false);

      const missingRow = createDefaultState(24) as unknown as Record<string, unknown>;
      missingRow.buildings = [{ type: 'flour_mill', col: 0, batches: [] }];
      expect(isValidState(missingRow, 24)).toBe(false);
    });

    it('rejects an over-cap batches array and a malformed batch (T4.2a)', () => {
      const overCap = createDefaultState(24) as unknown as Record<string, unknown>;
      // slots is 3, so a fourth concurrent batch is a save this build cannot honour.
      overCap.buildings = [
        {
          type: 'flour_mill',
          col: -3,
          row: 0,
          batches: Array.from({ length: RECIPE.slots + 1 }, () => ({ startedAt: 0 })),
        },
      ];
      expect(isValidState(overCap, 24)).toBe(false);

      const malformed = createDefaultState(24) as unknown as Record<string, unknown>;
      malformed.buildings = [
        { type: 'flour_mill', col: -3, row: 0, batches: [{ startedAt: 'soon' }] },
      ];
      expect(isValidState(malformed, 24)).toBe(false);

      const nonFinite = createDefaultState(24) as unknown as Record<string, unknown>;
      nonFinite.buildings = [
        { type: 'flour_mill', col: -3, row: 0, batches: [{ startedAt: Number.NaN }] },
      ];
      expect(isValidState(nonFinite, 24)).toBe(false);

      const missingBatches = createDefaultState(24) as unknown as Record<string, unknown>;
      missingBatches.buildings = [{ type: 'flour_mill', col: -3, row: 0 }];
      expect(isValidState(missingBatches, 24)).toBe(false);
    });
  });

  describe('schema v23 -> v24 migration (milling batches)', () => {
    it('an EXISTING placement gains batches: [] (whole-state re-pin)', () => {
      // The owner's live save carries a dev-placed mill, so the migration has
      // to upgrade a real placement, not just an empty list.
      const saved = createDefaultState(24) as unknown as Record<string, unknown>;
      saved.version = 23;
      // A genuine v23 placement: anchor only, no batches field.
      saved.buildings = [{ type: 'flour_mill', col: -3, row: 0 }];
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState()).toEqual({
        ...saved,
        version: 24,
        buildings: [{ type: 'flour_mill', col: -3, row: 0, batches: [] }],
      });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('an empty buildings list migrates to an empty list', () => {
      const saved = createDefaultState(24) as unknown as Record<string, unknown>;
      saved.version = 23;
      saved.buildings = [];
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState()).toEqual({ ...saved, version: 24, buildings: [] });
    });

    it('a full-chain v1 save lands at version 24 with no buildings', () => {
      const saved = createDefaultState(1) as unknown as Record<string, unknown>;
      delete saved.buildings;
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState().version).toBe(24);
      expect(store.getState().buildings).toEqual([]);
    });
  });
});

/** The flour mill's recipe - every milling test reads its numbers from the def. */
const RECIPE = BUILDINGS.flour_mill.milling!;

/**
 * A post-tutorial store with a placed mill and `wheat` Sunwheat in the bag.
 * Storage is real (in-memory) so the save/load round trip can be exercised.
 */
function millStore(wheat: number, storage: SaveStorage | null = null): GameStateStore {
  const store = new GameStateStore({ storage });
  completeOnboarding(store);
  expect(store.devBuildBuilding('flour_mill')).toBe(true);
  store.getState().inventory[RECIPE.inputCropId] = wheat;
  return store;
}

describe('milling (T4.2a)', () => {
  describe('startMilling', () => {
    it('deducts exactly inputCount and adds one batch stamped with the game clock', () => {
      const store = millStore(RECIPE.inputCount + 3);
      const before = now();
      expect(store.startMilling(0)).toBe(true);
      const after = now();
      const state = store.getState();
      expect(state.inventory[RECIPE.inputCropId]).toBe(3);
      expect(state.buildings[0]!.batches).toHaveLength(1);
      const { startedAt } = state.buildings[0]!.batches[0]!;
      expect(startedAt).toBeGreaterThanOrEqual(before);
      expect(startedAt).toBeLessThanOrEqual(after);
      // Readiness is DERIVED, never stored - the batch carries startedAt alone.
      expect(Object.keys(state.buildings[0]!.batches[0]!)).toEqual(['startedAt']);
    });

    it('refuses (unmutated) when the bag holds fewer than inputCount', () => {
      const store = millStore(RECIPE.inputCount - 1);
      expect(store.startMilling(0)).toBe(false);
      expect(store.getState().inventory[RECIPE.inputCropId]).toBe(RECIPE.inputCount - 1);
      expect(store.getState().buildings[0]!.batches).toEqual([]);
    });

    it('refuses (unmutated) when every slot is busy', () => {
      // Enough wheat for one MORE batch than there are slots, so the refusal
      // can only be the slot cap.
      const store = millStore(RECIPE.inputCount * (RECIPE.slots + 1));
      for (let i = 0; i < RECIPE.slots; i++) expect(store.startMilling(0)).toBe(true);
      expect(store.getState().buildings[0]!.batches).toHaveLength(RECIPE.slots);
      const wheatLeft = store.getState().inventory[RECIPE.inputCropId];
      expect(store.startMilling(0)).toBe(false);
      expect(store.getState().buildings[0]!.batches).toHaveLength(RECIPE.slots);
      expect(store.getState().inventory[RECIPE.inputCropId]).toBe(wheatLeft);
    });

    it('refuses (unmutated) on an out-of-range index and a building with no recipe', () => {
      const store = millStore(RECIPE.inputCount * 2);
      expect(store.startMilling(1)).toBe(false);
      expect(store.startMilling(-1)).toBe(false);
      expect(store.getState().buildings[0]!.batches).toEqual([]);
      expect(store.getState().inventory[RECIPE.inputCropId]).toBe(RECIPE.inputCount * 2);

      // A recipe-less building refuses too. The registry has only the mill
      // today, so the no-recipe branch is exercised by stripping the recipe -
      // which is exactly the shape a future decorative building will have.
      const recipeless = millStore(RECIPE.inputCount * 2);
      const spy = vi.spyOn(BUILDINGS, 'flour_mill', 'get').mockReturnValue({
        ...BUILDINGS.flour_mill,
        milling: undefined,
      });
      expect(recipeless.startMilling(0)).toBe(false);
      expect(recipeless.getState().buildings[0]!.batches).toEqual([]);
      expect(recipeless.getState().inventory[RECIPE.inputCropId]).toBe(RECIPE.inputCount * 2);
      spy.mockRestore();
    });
  });

  describe('collectMilling', () => {
    it('refuses (returns 0, unmutated) before the batch is ready', () => {
      const store = millStore(RECIPE.inputCount);
      expect(store.startMilling(0)).toBe(true);
      // One millisecond short of ready.
      advanceTime(RECIPE.batchMs - 1);
      expect(store.collectMilling(0, 0)).toBe(0);
      expect(store.getState().buildings[0]!.batches).toHaveLength(1);
      expect(store.getState().goods[RECIPE.outputGoodId]).toBeUndefined();
    });

    it('grants exactly outputCount and frees the slot once ready', () => {
      const store = millStore(RECIPE.inputCount);
      expect(store.startMilling(0)).toBe(true);
      advanceTime(RECIPE.batchMs);
      expect(store.collectMilling(0, 0)).toBe(RECIPE.outputCount);
      expect(store.getState().buildings[0]!.batches).toEqual([]);
      expect(store.getState().goods[RECIPE.outputGoodId]).toBe(RECIPE.outputCount);
      // The slot really is free: a fresh batch fits.
      store.getState().inventory[RECIPE.inputCropId] = RECIPE.inputCount;
      expect(store.startMilling(0)).toBe(true);
    });

    it('collects one batch out of several, leaving the rest in flight', () => {
      const store = millStore(RECIPE.inputCount * RECIPE.slots);
      expect(store.startMilling(0)).toBe(true);
      advanceTime(RECIPE.batchMs);
      // Batch 0 is ready; batches 1 and 2 start now, so they are not.
      expect(store.startMilling(0)).toBe(true);
      expect(store.startMilling(0)).toBe(true);
      expect(store.collectMilling(0, 0)).toBe(RECIPE.outputCount);
      expect(store.getState().buildings[0]!.batches).toHaveLength(2);
      // The two survivors are the ones that were NOT ready.
      expect(store.collectMilling(0, 0)).toBe(0);
      expect(store.collectMilling(0, 1)).toBe(0);
    });

    it('adds to an existing Sunflour stack rather than replacing it', () => {
      const store = millStore(RECIPE.inputCount);
      store.devGrantGood(RECIPE.outputGoodId, 7);
      expect(store.startMilling(0)).toBe(true);
      advanceTime(RECIPE.batchMs);
      expect(store.collectMilling(0, 0)).toBe(RECIPE.outputCount);
      expect(store.getState().goods[RECIPE.outputGoodId]).toBe(7 + RECIPE.outputCount);
    });

    it('returns 0 on an out-of-range building or batch index', () => {
      const store = millStore(RECIPE.inputCount);
      expect(store.startMilling(0)).toBe(true);
      advanceTime(RECIPE.batchMs);
      expect(store.collectMilling(1, 0)).toBe(0);
      expect(store.collectMilling(0, 1)).toBe(0);
      expect(store.collectMilling(0, -1)).toBe(0);
      expect(store.getState().buildings[0]!.batches).toHaveLength(1);
    });
  });

  describe('readiness helpers', () => {
    it('millBatchReadyAt is startedAt + batchMs, and isMillBatchReady straddles it', () => {
      const batch = { startedAt: 1_000_000 };
      expect(millBatchReadyAt(batch, RECIPE)).toBe(1_000_000 + RECIPE.batchMs);
      expect(isMillBatchReady(batch, RECIPE, 1_000_000 + RECIPE.batchMs - 1)).toBe(false);
      // Ready AT the boundary, not one tick after it.
      expect(isMillBatchReady(batch, RECIPE, 1_000_000 + RECIPE.batchMs)).toBe(true);
      expect(isMillBatchReady(batch, RECIPE, 1_000_000 + RECIPE.batchMs + 1)).toBe(true);
    });
  });

  describe('offline milling', () => {
    it('a batch started, saved, and reloaded past batchMs reads ready and collects', () => {
      // THE offline guarantee: nothing ticked the batch forward while the game
      // was closed, and it still comes ready, because readiness is derived from
      // the stored startedAt on every read.
      const storage = makeStorage();
      const store = millStore(RECIPE.inputCount, storage);
      expect(store.startMilling(0)).toBe(true);
      const startedAt = store.getState().buildings[0]!.batches[0]!.startedAt;

      // A fresh store over the same storage - a page reload, not a live object.
      const reloaded = new GameStateStore({ storage });
      reloaded.load();
      expect(reloaded.getState().buildings[0]!.batches).toEqual([{ startedAt }]);
      // Not ready the instant it loads...
      expect(reloaded.collectMilling(0, 0)).toBe(0);
      // ...but ready once the clock has passed batchMs, with no tick in between.
      advanceTime(RECIPE.batchMs);
      expect(isMillBatchReady({ startedAt }, RECIPE, now())).toBe(true);
      expect(reloaded.collectMilling(0, 0)).toBe(RECIPE.outputCount);
      expect(reloaded.getState().goods[RECIPE.outputGoodId]).toBe(RECIPE.outputCount);
    });

    it('batches survive a save/load round trip untouched', () => {
      const storage = makeStorage();
      const store = millStore(RECIPE.inputCount * 2, storage);
      expect(store.startMilling(0)).toBe(true);
      expect(store.startMilling(0)).toBe(true);
      const before = JSON.parse(JSON.stringify(store.getState().buildings)) as unknown;
      const reloaded = new GameStateStore({ storage });
      reloaded.load();
      expect(reloaded.getState().buildings).toEqual(before);
    });
  });

  describe('anti-rollback clamp', () => {
    it('a batch startedAt in the future of the real clock is clamped down on load', () => {
      const saved = createDefaultState(24) as unknown as Record<string, unknown>;
      const future = Date.now() + 60 * 60 * 1000;
      saved.buildings = [{ type: 'flour_mill', col: -3, row: 0, batches: [{ startedAt: future }] }];
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      const store = new GameStateStore({ storage });
      const before = Date.now();
      store.load();
      const after = Date.now();
      const clamped = store.getState().buildings[0]!.batches[0]!.startedAt;
      expect(clamped).toBeGreaterThanOrEqual(before);
      expect(clamped).toBeLessThanOrEqual(after);
      expect(console.info).toHaveBeenCalledWith('littleacres: clamped 1 future timestamps');
    });

    it('a past-stamped batch is left exactly alone', () => {
      const saved = createDefaultState(24) as unknown as Record<string, unknown>;
      const past = Date.now() - 5 * 60 * 1000;
      saved.buildings = [{ type: 'flour_mill', col: -3, row: 0, batches: [{ startedAt: past }] }];
      const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
      const store = new GameStateStore({ storage });
      store.load();
      expect(store.getState().buildings[0]!.batches[0]!.startedAt).toBe(past);
      expect(console.info).not.toHaveBeenCalled();
    });
  });

  describe('devFinishMilling', () => {
    it('back-dates every batch so all of them read ready immediately', () => {
      const store = millStore(RECIPE.inputCount * RECIPE.slots);
      for (let i = 0; i < RECIPE.slots; i++) expect(store.startMilling(0)).toBe(true);
      store.devFinishMilling();
      const nowMs = now();
      for (const batch of store.getState().buildings[0]!.batches) {
        expect(isMillBatchReady(batch, RECIPE, nowMs)).toBe(true);
      }
      // And every one of them actually collects, freeing the whole mill.
      for (let i = RECIPE.slots - 1; i >= 0; i--) {
        expect(store.collectMilling(0, i)).toBe(RECIPE.outputCount);
      }
      expect(store.getState().buildings[0]!.batches).toEqual([]);
      expect(store.getState().goods[RECIPE.outputGoodId]).toBe(RECIPE.outputCount * RECIPE.slots);
    });
  });
});
