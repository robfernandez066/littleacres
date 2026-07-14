import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHEST_COINS_MAX, CHEST_COINS_MIN, CHEST_MOONDUST_AMOUNT } from '../data/chests';
import { type CropId, CROPS } from '../data/crops';
import { BASE_PLOT_COUNT, EXPANDED_PLOT_COUNT, EXPANSION_COST } from '../data/farm';
import { MAX_LEVEL, xpForLevel } from '../data/levels';
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
import { LONG_QUESTS, WEEKLY_QUESTS, WEEK_MS } from '../data/quests';
import {
  createDefaultState,
  type GameStateData,
  GameStateStore,
  isValidState,
  MIGRATIONS,
  type Migration,
  type PlotState,
  PLOT_COUNT,
  SAVE_KEY,
  type SaveStorage,
} from './gameState';
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
    expect(MIGRATIONS).toHaveLength(13);
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
    expect(state.version).toBe(14);
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
    expect(state.version).toBe(14);
    expect(state.orders).toEqual(PENDING_SLOTS);
    // The v1 -> v2 migration did not re-run: moondust kept its value.
    expect(state.moondust).toBe(5);
    expect(state.coins).toBe(99);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a fresh save is created at the current version with moondust 0 and three pending slots', () => {
    const store = new GameStateStore({ storage: null });
    expect(store.currentVersion).toBe(14);
    expect(store.getState().version).toBe(14);
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
    expect(store.getState().version).toBe(14);
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
    expect(store.getState().version).toBe(14);
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
    expect(store.getState().version).toBe(14);
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
    expect(state.version).toBe(14);
    expect(state.inventory).toEqual({ sunwheat: 3, starcorn: 4 });
    expect(state.seeds).toEqual({ starcorn: 2 });
    expect(state.plots[0]).toEqual({ state: 'growing', cropId: 'starcorn', plantedAt: 1_000 });
    expect(state.plots[1]).toEqual({ state: 'growing', cropId: 'sunwheat', plantedAt: 2_000 });
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
    expect(store.getState().version).toBe(14);
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
    expect(store.getState().version).toBe(14);
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
    expect(store.getState().version).toBe(14);
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
    expect(store.getState().version).toBe(14);
    expect(store.getState().decorations).toEqual([]);
    expect(store.getState().warehouse).toEqual({});
    expect(console.warn).not.toHaveBeenCalled();
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
      decorations: Array.from({ length: 31 }, () => ({
        frame: 'decor_bench',
        x: 0,
        y: 0,
        scale: 1,
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

  it('rejects when placed + warehoused exceeds MAX_DECORATIONS, even split across both - accepts exactly at the cap', () => {
    const base = createDefaultState(12);
    const combined = {
      ...base,
      decorations: Array.from({ length: 20 }, () => ({
        frame: 'decor_bench',
        x: 0,
        y: 0,
        scale: 1,
        flip: false,
      })),
      warehouse: { decor_fence: 11 },
    };
    expect(isValidState(combined, 12)).toBe(false);
    combined.warehouse = { decor_fence: 10 };
    expect(isValidState(combined, 12)).toBe(true);
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

  it('fails at MAX_DECORATIONS (placed + warehoused combined), without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1_000_000);
    for (let i = 0; i < 30; i++) {
      expect(store.buyDecoration('decor_fence')).toBe(true);
    }
    expect(store.getState().warehouse).toEqual({ decor_fence: 30 });
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.buyDecoration('decor_fence')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('counts placed decorations toward the same cap as warehoused ones', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(1_000_000);
    for (let i = 0; i < 30; i++) store.buyDecoration('decor_fence');
    for (let i = 0; i < 20; i++) store.placeFromWarehouse('decor_fence');
    expect(store.getState().decorations).toHaveLength(20);
    expect(store.getState().warehouse).toEqual({ decor_fence: 10 });
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.buyDecoration('decor_fence')).toBe(false);
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
    expect(store.setDecorationTransform(0, -500, -500, 0, false)).toBe(true);
    expect(store.getState().decorations[0]).toEqual({
      frame: 'decor_bench',
      x: 0,
      y: 380,
      scale: 0.35,
      flip: false,
    });
    expect(store.setDecorationTransform(0, 5000, 5000, 5, true)).toBe(true);
    expect(store.getState().decorations[0]).toEqual({
      frame: 'decor_bench',
      x: 1080,
      y: 1520,
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
    expect(store.getState().plots[0]).toEqual({ state: 'empty' });
  });

  it('fails when coins are insufficient without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    store.addCoins(-(50 - CROPS.sunwheat.seedCost + 1)); // one coin short
    const coinsBefore = store.getState().coins;
    expect(store.plantCrop(0, 'sunwheat')).toBe(false);
    expect(store.getState().coins).toBe(coinsBefore);
    expect(store.getState().plots[0]).toEqual({ state: 'empty' });
  });

  it('fails when the crop is not unlocked yet without mutation', () => {
    const store = new GameStateStore({ storage: null });
    completeOnboarding(store);
    expect(CROPS.starcorn.unlockLevel).toBeGreaterThan(store.getState().level);
    expect(store.plantCrop(0, 'starcorn')).toBe(false);
    expect(store.getState().coins).toBe(50);
    expect(store.getState().plots[0]).toEqual({ state: 'empty' });
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
    expect(state.plots[0]).toEqual({ state: 'empty' });
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

  it('deducts exactly EXPANSION_COST, appends 4 empty plots, and persists', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
    completeOnboarding(store);
    store.addCoins(EXPANSION_COST - store.getState().coins);
    expect(store.expandFarm()).toBe(true);
    const state = store.getState();
    expect(state.coins).toBe(0);
    expect(state.plots).toHaveLength(EXPANDED_PLOT_COUNT);
    for (let i = BASE_PLOT_COUNT; i < EXPANDED_PLOT_COUNT; i++) {
      expect(state.plots[i]).toEqual({ state: 'empty' });
    }

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().plots).toHaveLength(EXPANDED_PLOT_COUNT);
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

describe('plot-count validation (BASE_PLOT_COUNT / EXPANDED_PLOT_COUNT)', () => {
  const emptyPlot: PlotState = { state: 'empty' };

  it('accepts exactly BASE_PLOT_COUNT or EXPANDED_PLOT_COUNT plots', () => {
    const base = createDefaultState(12);
    expect(isValidState(base, 12)).toBe(true);
    const expanded = {
      ...base,
      plots: [...base.plots, ...Array.from({ length: 4 }, () => ({ ...emptyPlot }))],
    };
    expect(isValidState(expanded, 12)).toBe(true);
  });

  it('rejects 13 or 17 plots', () => {
    const base = createDefaultState(12);
    const thirteen = { ...base, plots: [...base.plots, { ...emptyPlot }] };
    expect(isValidState(thirteen, 12)).toBe(false);
    const seventeen = {
      ...base,
      plots: [...base.plots, ...Array.from({ length: 5 }, () => ({ ...emptyPlot }))],
    };
    expect(isValidState(seventeen, 12)).toBe(false);
  });
});

describe('plantCrop / harvestPlot on an expanded plot', () => {
  it('plants and harvests on index 13, in the new row', () => {
    // rng pinned above RADIANT_CHANCE: completeOnboarding marks onboarding
    // completed directly, so harvestPlot's Radiant roll is live here, and an
    // unseeded rng would flakily yield RADIANT_YIELD_MULT instead of 1.
    const store = new GameStateStore({ storage: null, rng: () => 1 });
    completeOnboarding(store);
    store.addCoins(EXPANSION_COST);
    expect(store.expandFarm()).toBe(true);
    expect(store.plantCrop(13, 'sunwheat')).toBe(true);
    advanceTime(CROPS.sunwheat.growMs);
    expect(store.harvestPlot(13)).toBe(true);
    expect(store.getState().plots[13]).toEqual({ state: 'empty' });
    expect(store.getState().inventory.sunwheat).toBe(1);
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
    expect(store.getState().plots[8]).toEqual({ state: 'empty' });
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
    expect(store.getState().plots[0]).toEqual({ state: 'empty' });
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
    expect(store.getState().plots[0]).toEqual({ state: 'empty' });
    expect(store.plantCrop(1, 'sunwheat')).toBe(true);
    expect(store.getState().onboarding.progress).toBe(1);
  });

  it('rails: harvestPlot rejects a ready plot outside the harvest steps', () => {
    const saved = savedAtStep(stepIndex('open-orders'));
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: now() - CROPS.sunwheat.growMs,
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
    expect(store.getState().plots[0]).toEqual({ state: 'empty' });
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
      expect(store.getState().plots[0]).toEqual({ state: 'empty' });
      expect(console.warn).toHaveBeenCalled();
    }
  });
});

describe('clampFuturePlantedAt (warped or skewed clock on load)', () => {
  it('clamps a future-stamped growing plot to load time; past-stamped plots are untouched', () => {
    const pastPlantedAt = Date.now() - 60_000;
    const saved = createDefaultState(12);
    saved.xp = 1; // veteran save skips the tutorial, so a post-load harvest is unblocked.
    saved.plots[0] = { state: 'growing', cropId: 'sunwheat', plantedAt: Date.now() + 60_000 };
    saved.plots[1] = { state: 'growing', cropId: 'starcorn', plantedAt: pastPlantedAt };
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
    });
    expect(console.info).toHaveBeenCalledWith('littleacres: clamped 1 future crop timestamps');
  });

  it('a save with only past-stamped plots loads byte-identical - no clamping, no log', () => {
    const saved = createDefaultState(14);
    saved.xp = 1;
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: Date.now() - CROPS.sunwheat.growMs - 1,
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
    saved.plots[0] = { state: 'growing', cropId: 'sunwheat', plantedAt: Date.now() + 60_000 };
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
    expect(console.info).toHaveBeenCalledWith('littleacres: clamped 1 future crop timestamps');
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
        { state: 'growing', cropId: 'sunwheat', plantedAt },
        { state: 'growing', cropId: 'sunwheat', plantedAt },
        ...Array.from({ length: 10 }, (): PlotState => ({ state: 'empty' })),
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
        },
        // This one matures inside the window and should be the only count.
        { state: 'growing', cropId: 'starcorn', plantedAt: lastSavedAt + 1_000 },
        ...Array.from({ length: 10 }, (): PlotState => ({ state: 'empty' })),
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
        { state: 'growing', cropId: 'glowberry', plantedAt: Date.now() - 1_000 },
        ...Array.from({ length: 11 }, (): PlotState => ({ state: 'empty' })),
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
        { state: 'growing', cropId: 'sunwheat', plantedAt: lastSavedAt },
        ...Array.from({ length: 11 }, (): PlotState => ({ state: 'empty' })),
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
    saved.plots[0] = { state: 'growing', cropId: 'sunwheat', plantedAt: lastSavedAt + 1_000 };
    const store = loadedStore(saved);
    expect(store.consumeOfflineSummary()).toBeNull();
  });

  it('consumes once - a second call returns null', () => {
    const lastSavedAt = Date.now() - AWAY_MS;
    const saved = completedSave({
      lastSavedAt,
      plots: [
        { state: 'growing', cropId: 'sunwheat', plantedAt: lastSavedAt + 1_000 },
        ...Array.from({ length: 11 }, (): PlotState => ({ state: 'empty' })),
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
        { state: 'growing', cropId: 'sunwheat', plantedAt: lastSavedAt + 1_000 },
        ...Array.from({ length: 11 }, (): PlotState => ({ state: 'empty' })),
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
        { state: 'growing', cropId: 'sunwheat', plantedAt: lastSavedAt + 1_000 },
        ...Array.from({ length: 11 }, (): PlotState => ({ state: 'empty' })),
      ],
    });
    const store = loadedStore(saved);
    // A pending summary exists from load() above; importing must clear it even
    // though the imported save's own gap would otherwise also qualify.
    expect(store.importSave(JSON.stringify(saved))).toBe(true);
    expect(store.consumeOfflineSummary()).toBeNull();
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
    expect(state.version).toBe(14);
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
    expect(store.getState().version).toBe(14);
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
    expect(store.getState().version).toBe(14);
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
    expect(store.getState().version).toBe(14);
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
    expect(store.getState().version).toBe(14);
    expect(store.getState().decorations).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
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
    saved.plots[0] = { state: 'growing', cropId, plantedAt: now() - CROPS[cropId].growMs };
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
    };
    saved.plots[1] = {
      state: 'growing',
      cropId: 'starcorn',
      plantedAt: now() - CROPS.starcorn.growMs,
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

  it('a trophy reward bypasses the warehouse MAX_DECORATIONS cap - claim succeeds even at the cap', () => {
    const saved = completedLongSave('golden_fields');
    saved.warehouse = { decor_fence: 30 }; // already at MAX_DECORATIONS
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.claimQuest('golden_fields')).toBe(true);
    expect(store.getState().warehouse.trophy_goldscarecrow).toBe(1);
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
    // 'weekly_growth'; featured crop floor(0*5)=0 -> 'sunwheat'.
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
