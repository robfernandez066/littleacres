import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type CropId, CROPS } from '../data/crops';
import { MAX_LEVEL, xpForLevel } from '../data/levels';
import {
  ONBOARDING_ORDER_A,
  ONBOARDING_ORDER_B,
  ONBOARDING_STEPS,
  REVIEW_ORDER_DWELL_MS,
} from '../data/onboarding';
import { type Order, ORDER_SLOTS, SKIP_COOLDOWN_MS } from '../data/orders';
import {
  createDefaultState,
  type GameStateData,
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

/** Deterministic Math.random stand-in (32-bit LCG) for order generation. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
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
    expect(state.orders).toEqual(Array.from({ length: ORDER_SLOTS }, () => ({ state: 'pending' })));
    expect(state.onboarding).toEqual({ completed: false, step: 0, progress: 0, progressB: 0 });
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

describe('real migrations (v1 moondust, v2 orders, v3 onboarding)', () => {
  const PENDING_SLOTS = Array.from({ length: ORDER_SLOTS }, () => ({ state: 'pending' }));

  it('migrates a v1 save through the whole chain to the current version', () => {
    expect(MIGRATIONS).toHaveLength(4);
    const { moondust, orders, onboarding, ...v1Save } = createDefaultState(1);
    void moondust;
    void orders;
    void onboarding;
    const raw = { ...v1Save, coins: 250, xp: 42, level: 3 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(raw) });
    const store = new GameStateStore({ storage });
    store.load();
    const state = store.getState();
    expect(state.version).toBe(5);
    expect(state.moondust).toBe(0);
    expect(state.orders).toEqual(PENDING_SLOTS);
    // A level-3 veteran skips the tutorial permanently.
    expect(state.onboarding).toEqual({ completed: true, step: 0, progress: 0, progressB: 0 });
    // Nothing else was lost in the migration.
    expect(state.coins).toBe(250);
    expect(state.xp).toBe(42);
    expect(state.level).toBe(3);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('migrates a v2 save (no orders) up with three pending slots', () => {
    const { orders, onboarding, ...v2Save } = createDefaultState(2);
    void orders;
    void onboarding;
    const raw = { ...v2Save, coins: 99, moondust: 5 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(raw) });
    const store = new GameStateStore({ storage });
    store.load();
    const state = store.getState();
    expect(state.version).toBe(5);
    expect(state.orders).toEqual(PENDING_SLOTS);
    // The v1 -> v2 migration did not re-run: moondust kept its value.
    expect(state.moondust).toBe(5);
    expect(state.coins).toBe(99);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a fresh save is created at v5 with moondust 0 and three pending slots', () => {
    const store = new GameStateStore({ storage: null });
    expect(store.currentVersion).toBe(5);
    expect(store.getState().version).toBe(5);
    expect(store.getState().moondust).toBe(0);
    expect(store.getState().orders).toEqual(PENDING_SLOTS);
  });

  it('resets cleanly on a save with structurally invalid orders', () => {
    const bad = {
      ...createDefaultState(5),
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
    expect(store.getState().version).toBe(5);
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
      ...createDefaultState(5),
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
  it('adds progressB 0 while preserving the rest of a mid-tutorial save', () => {
    const v4 = createDefaultState(4) as unknown as Record<string, unknown>;
    v4.onboarding = { completed: false, step: 3, progress: 2 };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(v4) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.getState().version).toBe(5);
    expect(store.getState().onboarding).toEqual({
      completed: false,
      step: 3,
      progress: 2,
      progressB: 0,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('resets cleanly on a v5 save whose onboarding is missing progressB', () => {
    const bad = createDefaultState(5) as unknown as Record<string, unknown>;
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

describe('orders', () => {
  /** A hand-built two-crop order with arbitrary stored rewards - fulfillment
   * must pay exactly these, not anything recomputed from crop data. */
  const TEST_ORDER: Order = {
    items: [
      { cropId: 'sunwheat', count: 3 },
      { cropId: 'carrot', count: 2 },
    ],
    coinReward: 123,
    xpReward: 9,
  };

  /** A current-version save with a chosen inventory and TEST_ORDER open in slot 0. */
  function savedStateWithOrder(
    order: Order,
    inventory: Partial<Record<CropId, number>>,
  ): GameStateData {
    const saved = createDefaultState(5);
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

  it('fulfillOrder pays exactly the stored rewards, deducts items, and persists', () => {
    const saved = savedStateWithOrder(TEST_ORDER, { sunwheat: 5, carrot: 2 });
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
    expect(state.inventory.carrot).toBe(0);
    expect(state.orders[0]).toEqual({ state: 'pending' });

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().coins).toBe(state.coins);
    expect(reloaded.getState().orders[0]).toEqual({ state: 'pending' });
  });

  it('fulfillOrder fails without mutation when inventory is short on any item', () => {
    const saved = savedStateWithOrder(TEST_ORDER, { sunwheat: 5, carrot: 1 });
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const snapshot = JSON.parse(store.exportSave()) as unknown;
    expect(store.fulfillOrder(0)).toBe(false);
    expect(JSON.parse(store.exportSave())).toEqual(snapshot);
  });

  it('fulfillOrder fails on non-open slots and bad indices', () => {
    const store = new GameStateStore({ storage: null });
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
    expect(store.consumeLevelUpEvents()).toEqual([{ level: 2, unlockedCropIds: ['carrot'] }]);
  });

  it('skipOrder puts an open slot on a now()-based cooldown and persists', () => {
    const storage = makeStorage();
    const store = new GameStateStore({ storage, rng: seededRng(4) });
    store.ensureOrders();
    const before = now();
    expect(store.skipOrder(0)).toBe(true);
    const slot = store.getState().orders[0];
    expect(slot?.state).toBe('cooldown');
    if (slot?.state === 'cooldown') {
      expect(slot.readyAt).toBeGreaterThanOrEqual(before + SKIP_COOLDOWN_MS);
      expect(slot.readyAt).toBeLessThanOrEqual(now() + SKIP_COOLDOWN_MS);
    }

    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().orders[0]).toEqual(slot);
  });

  it('skipOrder fails on non-open slots and bad indices without mutation', () => {
    const store = new GameStateStore({ storage: null, rng: seededRng(5) });
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
    store.ensureOrders();
    expect(store.skipOrder(0)).toBe(true);
    store.ensureOrders();
    expect(store.getState().orders[0]?.state).toBe('cooldown');
    advanceTime(SKIP_COOLDOWN_MS + 1);
    store.ensureOrders();
    expect(store.getState().orders[0]?.state).toBe('open');
  });
});

describe('onboarding', () => {
  /** Index of a step id in the chain; the walk test asserts against these. */
  function stepIndex(id: string): number {
    return ONBOARDING_STEPS.findIndex((step) => step.id === id);
  }

  /** A current-version save parked at `step` with overrides applied. */
  function savedAtStep(step: number, overrides: Partial<GameStateData> = {}): GameStateData {
    const saved = createDefaultState(5);
    saved.onboarding = { completed: false, step, progress: 0, progressB: 0 };
    return { ...saved, ...overrides };
  }

  it('walks the full 15-step chain with the exact first-session economy', () => {
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

    // 7 deliver-sunwheat: +63 coins, +10 xp -> exactly the 30 xp level-2
    // threshold; the celebration and carrot reveal fire here by design.
    expect(store.fulfillOrder(0)).toBe(true);
    expect(store.getState().coins).toBe(63);
    expect(store.getState().xp).toBe(30);
    expect(store.getState().xp).toBe(xpForLevel(2));
    expect(store.getState().level).toBe(2);
    expect(store.consumeLevelUpEvents()).toEqual([{ level: 2, unlockedCropIds: ['carrot'] }]);
    expect(store.getState().inventory.sunwheat).toBe(4);
    // ORDER B immediately replaces slot 0 - open, never pending.
    expect(store.getState().orders[0]).toEqual({ state: 'open', order: ONBOARDING_ORDER_B });
    expect(onboarding().step).toBe(stepIndex('close-orders'));

    // 8 close-orders (tick-observed panel state).
    store.notifyOnboardingUiEvent('close-orders');
    expect(onboarding().step).toBe(stepIndex('open-bag'));

    // 9 open-bag.
    store.notifyOnboardingUiEvent('open-bag');
    expect(onboarding().step).toBe(stepIndex('sell-rest'));

    // 10 sell-rest: the remaining 4 sunwheat at 8 each -> 95 coins.
    expect(store.sellCrop('sunwheat')).toBe(32);
    expect(store.getState().coins).toBe(95);
    expect(onboarding().step).toBe(stepIndex('close-bag'));

    // 11 close-bag.
    store.notifyOnboardingUiEvent('close-bag');
    expect(onboarding().step).toBe(stepIndex('check-orders'));

    // 12 check-orders: completes when the board opens; the board-close
    // event that will later finish review-order is a no-op here.
    store.notifyOnboardingUiEvent('review-order');
    expect(onboarding().step).toBe(stepIndex('check-orders'));
    store.notifyOnboardingUiEvent('check-orders');
    expect(onboarding().step).toBe(stepIndex('review-order'));

    // 13 review-order: ORDER B still sits in slot 0 for the player to read.
    // Too early: the dwell guard does not advance it yet.
    expect(store.getState().orders[0]).toEqual({ state: 'open', order: ONBOARDING_ORDER_B });
    store.autoAdvanceOnboarding();
    expect(onboarding().step).toBe(stepIndex('review-order'));
    // Once the board has been open for the full read-dwell, it self-advances
    // even though the board is still open.
    advanceTime(REVIEW_ORDER_DWELL_MS);
    store.autoAdvanceOnboarding();
    expect(onboarding().step).toBe(stepIndex('close-orders-2'));

    // 14 close-orders-2: closing the board (still open from the dwell path)
    // advances unconditionally, identically to close-orders.
    store.notifyOnboardingUiEvent('close-orders-2');
    expect(onboarding().step).toBe(stepIndex('plant-mixed'));

    // 15 plant-mixed: 8 sunwheat then 4 carrots -> exactly 7 coins left,
    // and the tutorial completes permanently.
    for (let i = 0; i < 8; i++) expect(store.plantCrop(i, 'sunwheat')).toBe(true);
    expect(onboarding()).toEqual({
      completed: false,
      step: stepIndex('plant-mixed'),
      progress: 8,
      progressB: 0,
    });
    for (let i = 8; i < 12; i++) expect(store.plantCrop(i, 'carrot')).toBe(true);
    expect(store.getState().coins).toBe(7);
    expect(onboarding()).toEqual({
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    });
  });

  it('close steps only advance their own step', () => {
    const storage = makeStorage({
      [SAVE_KEY]: JSON.stringify(savedAtStep(8 /* open-bag */)),
    });
    const store = new GameStateStore({ storage });
    store.load();
    // The board is closed too, but that is not this step's action.
    store.notifyOnboardingUiEvent('close-orders');
    store.notifyOnboardingUiEvent('close-bag');
    store.notifyOnboardingUiEvent('review-order');
    store.notifyOnboardingUiEvent('close-orders-2');
    expect(store.getState().onboarding.step).toBe(8);
    store.notifyOnboardingUiEvent('open-bag');
    expect(store.getState().onboarding.step).toBe(9);
  });

  it('review-order advances immediately on an early board close, without waiting out the dwell', () => {
    const storage = makeStorage({
      [SAVE_KEY]: JSON.stringify(savedAtStep(stepIndex('review-order'))),
    });
    const store = new GameStateStore({ storage });
    store.load();
    // Well under the dwell: the guard alone must not advance it.
    store.autoAdvanceOnboarding();
    expect(store.getState().onboarding.step).toBe(stepIndex('review-order'));
    // The board closes early - the ordinary UI event advances it right away.
    store.notifyOnboardingUiEvent('review-order');
    expect(store.getState().onboarding.step).toBe(stepIndex('close-orders-2'));
    // close-orders-2 completes on the same board-closed observation.
    store.notifyOnboardingUiEvent('close-orders-2');
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
    expect(reloaded.getState().onboarding.step).toBe(stepIndex('close-orders-2'));
  });

  it('sell-rest advances on a sunwheat sale but not on other crops', () => {
    const saved = savedAtStep(9 /* sell-rest */, { inventory: { sunwheat: 4, carrot: 2 } });
    saved.level = 2;
    saved.xp = xpForLevel(2);
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.sellCrop('carrot')).toBeGreaterThan(0);
    expect(store.getState().onboarding.step).toBe(9);
    expect(store.sellCrop('sunwheat')).toBe(4 * CROPS.sunwheat.sellValue);
    expect(store.getState().onboarding.step).toBe(10);
  });

  it('sell-rest auto-advances via the tick guard when no sunwheat is held', () => {
    const storage = makeStorage({
      [SAVE_KEY]: JSON.stringify(savedAtStep(9, { inventory: { sunwheat: 3 } })),
    });
    const store = new GameStateStore({ storage });
    store.load();
    // Sunwheat still held: the guard must not advance.
    store.autoAdvanceOnboarding();
    expect(store.getState().onboarding.step).toBe(9);
    store.getState().inventory.sunwheat = 0;
    store.autoAdvanceOnboarding();
    expect(store.getState().onboarding.step).toBe(10);
  });

  it('the auto-advance guard is a no-op off the sell-rest step', () => {
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(savedAtStep(0)) });
    const store = new GameStateStore({ storage });
    store.load();
    store.autoAdvanceOnboarding();
    expect(store.getState().onboarding.step).toBe(0);
  });

  it('plant-mixed ignores wrong crops and caps each counter at its goal', () => {
    const saved = savedAtStep(14 /* plant-mixed */, { coins: 10_000 });
    saved.level = 3; // glowberry plantable - the "wrong crop" for this step
    saved.xp = xpForLevel(3);
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    const onboarding = () => store.getState().onboarding;

    expect(store.plantCrop(0, 'glowberry')).toBe(true);
    expect(onboarding()).toEqual({ completed: false, step: 14, progress: 0, progressB: 0 });

    // A 9th sunwheat plants fine but the counter holds at the 8 goal.
    for (let i = 1; i <= 9; i++) expect(store.plantCrop(i, 'sunwheat')).toBe(true);
    expect(onboarding()).toEqual({ completed: false, step: 14, progress: 8, progressB: 0 });

    // Carrots still short: not completed until BOTH goals are met.
    expect(store.plantCrop(10, 'carrot')).toBe(true);
    expect(store.plantCrop(11, 'carrot')).toBe(true);
    expect(onboarding()).toEqual({ completed: false, step: 14, progress: 8, progressB: 2 });
  });

  it('plant steps before the mix only count sunwheat', () => {
    const saved = savedAtStep(2 /* plant-rest */, { coins: 10_000 });
    saved.level = 2;
    saved.xp = xpForLevel(2);
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage });
    store.load();
    expect(store.plantCrop(0, 'carrot')).toBe(true); // wrong crop, no progress
    expect(store.getState().onboarding.progress).toBe(0);
    expect(store.plantCrop(1, 'sunwheat')).toBe(true);
    expect(store.getState().onboarding.progress).toBe(1);
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
    const saved = savedAtStep(14 /* plant-mixed */, { coins: 10_000 });
    saved.level = 2;
    saved.xp = xpForLevel(2);
    storage.setItem(SAVE_KEY, JSON.stringify(saved));
    const store = new GameStateStore({ storage });
    store.load();
    store.plantCrop(0, 'sunwheat');
    store.plantCrop(1, 'carrot');
    const reloaded = new GameStateStore({ storage });
    reloaded.load();
    expect(reloaded.getState().onboarding).toEqual({
      completed: false,
      step: 14,
      progress: 1,
      progressB: 1,
    });
  });

  it('never tracks again after completion', () => {
    const saved = createDefaultState(5);
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
    store.notifyOnboardingUiEvent('close-orders');
    store.notifyOnboardingUiEvent('open-bag');
    store.notifyOnboardingUiEvent('close-bag');
    store.notifyOnboardingUiEvent('check-orders');
    store.notifyOnboardingUiEvent('review-order');
    store.notifyOnboardingUiEvent('close-orders-2');
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

  it('suppresses teaser orders while onboarding is active', () => {
    // Mid-tutorial at level 2 (the plant-mixed step after the scripted
    // level-up): suppression follows the flag, not the level.
    const saved = savedAtStep(14 /* plant-mixed */);
    saved.level = 2;
    saved.xp = xpForLevel(2);
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    // rng stuck at 0 would always pass a nonzero teaser roll.
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    store.ensureOrders();
    for (const slot of store.getState().orders) {
      expect(slot.state).toBe('open');
      if (slot.state === 'open') {
        for (const item of slot.order.items) {
          expect(CROPS[item.cropId].unlockLevel).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('teaser orders return once onboarding is completed', () => {
    const saved = createDefaultState(5);
    saved.level = 2;
    saved.xp = xpForLevel(2);
    saved.onboarding = {
      completed: true,
      step: ONBOARDING_STEPS.length,
      progress: 0,
      progressB: 0,
    };
    const storage = makeStorage({ [SAVE_KEY]: JSON.stringify(saved) });
    const store = new GameStateStore({ storage, rng: () => 0 });
    store.load();
    store.ensureOrders();
    // rng 0 always takes the teaser branch: every order teases glowberry.
    for (const slot of store.getState().orders) {
      expect(slot.state).toBe('open');
      if (slot.state === 'open') {
        expect(slot.order.items.some((item) => item.cropId === 'glowberry')).toBe(true);
      }
    }
  });
});

describe('leveling', () => {
  it('queues one event on a single-level gain, and clears on consume', () => {
    const store = new GameStateStore({ storage: null });
    store.addXp(xpForLevel(2));
    expect(store.getState().level).toBe(2);
    const events = store.consumeLevelUpEvents();
    expect(events).toEqual([{ level: 2, unlockedCropIds: ['carrot'] }]);
    expect(store.consumeLevelUpEvents()).toEqual([]);
  });

  it('queues one event per level, in order, on a multi-level jump', () => {
    const store = new GameStateStore({ storage: null });
    store.addXp(xpForLevel(3));
    expect(store.getState().level).toBe(3);
    expect(store.consumeLevelUpEvents()).toEqual([
      { level: 2, unlockedCropIds: ['carrot'] },
      { level: 3, unlockedCropIds: ['glowberry'] },
    ]);
  });

  it('queues an event even for levels with no crop unlock', () => {
    const store = new GameStateStore({ storage: null });
    store.addXp(xpForLevel(MAX_LEVEL));
    expect(store.getState().level).toBe(MAX_LEVEL);
    const events = store.consumeLevelUpEvents();
    expect(events.map((e) => e.level)).toEqual([2, 3, 4, 5]);
    expect(events.find((e) => e.level === 4)?.unlockedCropIds).toEqual([]);
    expect(events.find((e) => e.level === 5)?.unlockedCropIds).toEqual([]);
  });

  it('harvesting queues the same kind of event as addXp', () => {
    const store = new GameStateStore({ storage: null });
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
    expect(store.consumeLevelUpEvents()).toEqual([{ level: 2, unlockedCropIds: ['carrot'] }]);
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
