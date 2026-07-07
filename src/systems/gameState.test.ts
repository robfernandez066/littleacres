import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultState,
  GameStateStore,
  type Migration,
  PLOT_COUNT,
  SAVE_KEY,
  type SaveStorage,
} from './gameState';

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
    expect(state.version).toBe(1);
    expect(state.coins).toBe(50);
    expect(state.xp).toBe(0);
    expect(state.level).toBe(1);
    expect(state.plots).toHaveLength(PLOT_COUNT);
    expect(state.plots.every((p) => p.state === 'empty')).toBe(true);
    expect(state.inventory).toEqual({});
    expect(state.seeds).toEqual({});
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
    expect(store.getState().version).toBe(1);
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
