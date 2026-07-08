import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type CropId, CROPS } from '../data/crops';
import {
  createDefaultState,
  GameStateStore,
  MIGRATIONS,
  type Migration,
  PLOT_COUNT,
  SAVE_KEY,
  type SaveStorage,
} from './gameState';
import { advanceTime, now } from './time';

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

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    expect(state.settings).toEqual({ musicOn: true, sfxOn: true });
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

describe('real migration v1 -> v2 (moondust)', () => {
  it('loads a v1 save with no moondust field, migrating it to v2 with moondust 0', () => {
    expect(MIGRATIONS).toHaveLength(1);
    const fullSave: Record<string, unknown> = createDefaultState(1);
    const { moondust, ...v1Save } = fullSave;
    void moondust;
    const raw = { ...v1Save, coins: 250, xp: 42, level: 3 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(raw) });
    const store = new GameStateStore({ storage });
    store.load();
    const state = store.getState();
    expect(state.version).toBe(2);
    expect(state.moondust).toBe(0);
    // Nothing else was lost in the migration.
    expect(state.coins).toBe(250);
    expect(state.xp).toBe(42);
    expect(state.level).toBe(3);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a fresh save is created at v2 with moondust 0', () => {
    const store = new GameStateStore({ storage: null });
    expect(store.currentVersion).toBe(2);
    expect(store.getState().version).toBe(2);
    expect(store.getState().moondust).toBe(0);
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
    expect(store.plantCrop(0, 'sunwheat')).toBe(true);
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.plantCrop(0, 'sunwheat')).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('fails on an out-of-range or fractional index without mutation', () => {
    const store = new GameStateStore({ storage: null });
    expect(store.plantCrop(-1, 'sunwheat')).toBe(false);
    expect(store.plantCrop(PLOT_COUNT, 'sunwheat')).toBe(false);
    expect(store.plantCrop(0.5, 'sunwheat')).toBe(false);
    expect(store.getState().coins).toBe(50);
    expect(store.getState().plots.every((p) => p.state === 'empty')).toBe(true);
  });

  it('fails on an unknown crop without mutation', () => {
    const store = new GameStateStore({ storage: null });
    expect(store.plantCrop(0, 'tomato' as CropId)).toBe(false);
    expect(store.getState().coins).toBe(50);
    expect(store.getState().plots[0]).toEqual({ state: 'empty' });
  });

  it('fails when coins are insufficient without mutation', () => {
    const store = new GameStateStore({ storage: null });
    store.addCoins(-(50 - CROPS.sunwheat.seedCost + 1)); // one coin short
    const coinsBefore = store.getState().coins;
    expect(store.plantCrop(0, 'sunwheat')).toBe(false);
    expect(store.getState().coins).toBe(coinsBefore);
    expect(store.getState().plots[0]).toEqual({ state: 'empty' });
  });

  it('fails when the crop is not unlocked yet without mutation', () => {
    const store = new GameStateStore({ storage: null });
    expect(CROPS.carrot.unlockLevel).toBeGreaterThan(store.getState().level);
    expect(store.plantCrop(0, 'carrot')).toBe(false);
    expect(store.getState().coins).toBe(50);
    expect(store.getState().plots[0]).toEqual({ state: 'empty' });
  });
});

describe('harvestPlot', () => {
  it('fails on an empty plot and on an out-of-range index', () => {
    const store = new GameStateStore({ storage: null });
    expect(store.harvestPlot(0)).toBe(false);
    expect(store.harvestPlot(-1)).toBe(false);
    expect(store.harvestPlot(PLOT_COUNT)).toBe(false);
  });

  it('fails on a growing plot that is not ready yet, without mutation', () => {
    const store = new GameStateStore({ storage: null });
    store.plantCrop(0, 'sunwheat');
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.harvestPlot(0)).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('harvests a ready plot after the game clock is warped forward', () => {
    const store = new GameStateStore({ storage: null });
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
    const store = new GameStateStore({ storage: null });
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
    const storage = makeStorage();
    const store = new GameStateStore({ storage });
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
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.sellCrop('sunwheat')).toBe(0);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });
});

describe('offline growth (app closed during growth)', () => {
  it('a growing plot matures across a save/load round-trip', () => {
    const storage = makeStorage();
    const writer = new GameStateStore({ storage });
    expect(writer.plantCrop(0, 'sunwheat')).toBe(true);
    // The app "closes" here; time passes while nothing is running.
    advanceTime(CROPS.sunwheat.growMs + 1);
    const reader = new GameStateStore({ storage });
    reader.load();
    expect(reader.harvestPlot(0)).toBe(true);
    expect(reader.getState().inventory.sunwheat).toBe(1);
  });

  it('a save whose plantedAt long predates load is immediately ready', () => {
    const saved = createDefaultState(1);
    saved.plots[0] = {
      state: 'growing',
      cropId: 'sunwheat',
      plantedAt: now() - CROPS.sunwheat.growMs - 60_000,
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
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
