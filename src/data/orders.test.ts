import { describe, expect, it } from 'vitest';

import { CHEST_UNLOCK_LEVEL, PREMIUM_TWO_CHEST_UNITS } from './chests';
import { CROPS } from './crops';
import { MAX_LEVEL } from './levels';
import {
  generateOrder,
  isOrderCoverable,
  ORDER_BASE_UNITS,
  ORDER_COIN_MULTIPLIER,
  ORDER_UNIT_CAPS,
  ORDER_UNITS_PER_LEVEL,
  ORDER_XP_MULTIPLIER,
  type Order,
  PREMIUM_CHANCE,
  PREMIUM_FLAVORS,
  PREMIUM_MOONDUST_MAX,
  PREMIUM_MOONDUST_MIN,
  PREMIUM_UNITS_MULT,
} from './orders';

/** Deterministic Math.random stand-in (32-bit LCG). */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Many orders per level from one continuous rng stream. */
function sampleOrders(level: number, count: number, seed = 42): ReturnType<typeof generateOrder>[] {
  const rng = seededRng(seed);
  return Array.from({ length: count }, () => generateOrder(level, rng));
}

/** A fixed sequence of rng() results, repeating its last value past the end. */
function queuedRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

describe('generateOrder', () => {
  it('is deterministic under a fixed rng sequence', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(sampleOrders(level, 20, 7)).toEqual(sampleOrders(level, 20, 7));
    }
  });

  it('requests 1-2 distinct crops with every count >= 1', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (const order of sampleOrders(level, 200)) {
        expect(order.items.length).toBeGreaterThanOrEqual(1);
        expect(order.items.length).toBeLessThanOrEqual(2);
        const ids = order.items.map((item) => item.cropId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const item of order.items) {
          expect(item.count).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(item.count)).toBe(true);
        }
      }
    }
  });

  it("total units are at most the per-level formula (doubled for premium), and each item respects its crop's unit cap", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (const order of sampleOrders(level, 200)) {
        const total = order.items.reduce((sum, item) => sum + item.count, 0);
        const budget =
          (ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL * level) *
          (order.premium ? PREMIUM_UNITS_MULT : 1);
        expect(total).toBeLessThanOrEqual(budget);
        for (const item of order.items) {
          const cap = ORDER_UNIT_CAPS[item.cropId];
          if (cap !== undefined) expect(item.count).toBeLessThanOrEqual(cap);
        }
      }
    }
  });

  it('stored rewards are the config multipliers over sell value and xp, rounded up', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (const order of sampleOrders(level, 200)) {
        const coinBase = order.items.reduce(
          (sum, item) => sum + item.count * CROPS[item.cropId].sellValue,
          0,
        );
        const xpBase = order.items.reduce(
          (sum, item) => sum + item.count * CROPS[item.cropId].xp,
          0,
        );
        expect(order.coinReward).toBe(Math.ceil(coinBase * ORDER_COIN_MULTIPLIER));
        expect(order.xpReward).toBe(Math.ceil(xpBase * ORDER_XP_MULTIPLIER));
        // Orders always beat selling the same crops raw.
        expect(order.coinReward).toBeGreaterThan(coinBase);
      }
    }
  });

  it('requests only crops at or below the player level, across levels 1-6 and a spread of rng streams (T2.24 - teaser removal invariant)', () => {
    // The teaser/stretch-order path (an item from the NEXT level's unlock)
    // was removed entirely in T2.24 - an order the player cannot yet fulfill
    // read as a bug, not anticipation. This is the invariant that removal
    // guarantees: no generated order, at any level or rng stream, ever asks
    // for a crop above the player's current level.
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (let seed = 1; seed <= 20; seed++) {
        for (const order of sampleOrders(level, 50, seed)) {
          for (const item of order.items) {
            expect(CROPS[item.cropId].unlockLevel).toBeLessThanOrEqual(level);
          }
        }
      }
    }
  });

  it('a single-item glowberry order (no second item) is still capped', () => {
    // First rng() (0.99) fails premium; second (0.99) fails the second-item
    // roll; third (0.9) picks index 2 of the 3 unlocked crops at level 3
    // (glowberry). The single-item count equals totalUnits (5), which the
    // cap clamps to 2.
    const rng = queuedRng([0.99, 0.99, 0.9]);
    const order = generateOrder(3, rng);
    expect(order.items).toEqual([{ cropId: 'glowberry', count: 2 }]);
    expect(order.coinReward).toBe(Math.ceil(2 * CROPS.glowberry.sellValue * ORDER_COIN_MULTIPLIER));
    expect(order.xpReward).toBe(Math.ceil(2 * CROPS.glowberry.xp * ORDER_XP_MULTIPLIER));
  });

  it('a single-item moonroot order (no second item) is still capped', () => {
    // Level 4 unlocks moonroot; totalUnits = 2 + 1*4 = 6, capped to 3. First
    // rng() (0.99) fails premium; second (0.99) fails the second-item roll;
    // third (0.9) picks index 3 of the 4 unlocked crops (moonroot).
    const rng = queuedRng([0.99, 0.99, 0.9]);
    const order = generateOrder(4, rng);
    expect(order.items).toEqual([{ cropId: 'moonroot', count: 3 }]);
    expect(order.coinReward).toBe(Math.ceil(3 * CROPS.moonroot.sellValue * ORDER_COIN_MULTIPLIER));
    expect(order.xpReward).toBe(Math.ceil(3 * CROPS.moonroot.xp * ORDER_XP_MULTIPLIER));
  });

  it('a single-item emberpepper order (no second item) is still capped', () => {
    // Level 5; totalUnits = 2 + 1*5 = 7, capped to 2. First rng() (0.99)
    // fails premium; second (0.99) fails the second-item roll; third (0.9)
    // picks index 4 of the 5 unlocked crops (emberpepper).
    const rng = queuedRng([0.99, 0.99, 0.9]);
    const order = generateOrder(5, rng);
    expect(order.items).toEqual([{ cropId: 'emberpepper', count: 2 }]);
    expect(order.coinReward).toBe(
      Math.ceil(2 * CROPS.emberpepper.sellValue * ORDER_COIN_MULTIPLIER),
    );
    expect(order.xpReward).toBe(Math.ceil(2 * CROPS.emberpepper.xp * ORDER_XP_MULTIPLIER));
  });

  it('a single-item dewmelon order (no second item) is still capped (T3.11)', () => {
    // Level 7 unlocks dewmelon; totalUnits = 2 + 1*7 = 9, capped to 2. First
    // rng() (0.99) fails premium; second (0.99) fails the second-item roll;
    // third (0.9) picks index 5 of the 6 unlocked crops (dewmelon).
    const rng = queuedRng([0.99, 0.99, 0.9]);
    const order = generateOrder(7, rng);
    expect(order.items).toEqual([{ cropId: 'dewmelon', count: 2 }]);
    expect(order.coinReward).toBe(Math.ceil(2 * CROPS.dewmelon.sellValue * ORDER_COIN_MULTIPLIER));
    expect(order.xpReward).toBe(Math.ceil(2 * CROPS.dewmelon.xp * ORDER_XP_MULTIPLIER));
  });

  it('a single-item sagesprig order (no second item) is still capped (T3.11)', () => {
    // Level 8 unlocks sagesprig; totalUnits = 2 + 1*8 = 10, capped to 1.
    // First rng() (0.99) fails premium; second (0.99) fails the second-item
    // roll; third (0.95) picks index 6 of the 7 unlocked crops (sagesprig).
    const rng = queuedRng([0.99, 0.99, 0.95]);
    const order = generateOrder(8, rng);
    expect(order.items).toEqual([{ cropId: 'sagesprig', count: 1 }]);
    expect(order.coinReward).toBe(Math.ceil(1 * CROPS.sagesprig.sellValue * ORDER_COIN_MULTIPLIER));
    expect(order.xpReward).toBe(Math.ceil(1 * CROPS.sagesprig.xp * ORDER_XP_MULTIPLIER));
  });

  it('clamps a sub-1 level to level 1 rules', () => {
    const order = generateOrder(0, () => 0.99);
    expect(order.items).toEqual([
      { cropId: 'sunwheat', count: ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL },
    ]);
  });
});

describe('generateOrder premium orders', () => {
  it('a non-premium roll (rng above PREMIUM_CHANCE) has no premium field', () => {
    const order = generateOrder(5, () => 0.5);
    expect(order.premium).toBeUndefined();
  });

  it('a forced premium roll (rng stuck at 0) doubles the budget and rolls min moondust + first flavor', () => {
    // At level 1 only sunwheat is unlocked, so the second-item roll never
    // fires; the sequence is premium roll, pick(unlocked), moondust, flavor.
    const order = generateOrder(1, () => 0);
    expect(order.items).toEqual([
      {
        cropId: 'sunwheat',
        count: (ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL) * PREMIUM_UNITS_MULT,
      },
    ]);
    expect(order.premium).toEqual({ moondust: PREMIUM_MOONDUST_MIN, flavor: PREMIUM_FLAVORS[0] });
  });

  it('a premium order at level 2 doubles the budget, picks two items, and stores rewards over the bigger items', () => {
    const order = generateOrder(2, () => 0);
    expect(order.items).toEqual([
      { cropId: 'sunwheat', count: 1 },
      { cropId: 'starcorn', count: 5 }, // pre-clamp split (7) capped to 5
    ]);
    expect(order.premium).toEqual({ moondust: PREMIUM_MOONDUST_MIN, flavor: PREMIUM_FLAVORS[0] });
    expect(order.coinReward).toBe(
      Math.ceil((CROPS.sunwheat.sellValue + 5 * CROPS.starcorn.sellValue) * ORDER_COIN_MULTIPLIER),
    );
    expect(order.xpReward).toBe(
      Math.ceil((CROPS.sunwheat.xp + 5 * CROPS.starcorn.xp) * ORDER_XP_MULTIPLIER),
    );
  });

  it('a premium order at level 5 still clamps emberpepper to its cap despite the doubled budget', () => {
    // Premium roll (0) hits; second-item roll (0.99) fails; pick(unlocked)
    // (0.9) lands on emberpepper (index 4 of 5); doubled budget (2 + 5) * 2
    // = 14 clamps to the cap of 2; moondust (0) rolls the min, flavor (0)
    // rolls the first.
    const rng = queuedRng([0, 0.99, 0.9, 0, 0]);
    const order = generateOrder(5, rng);
    expect(order.items).toEqual([{ cropId: 'emberpepper', count: 2 }]);
    expect(order.premium).toEqual({ moondust: PREMIUM_MOONDUST_MIN, flavor: PREMIUM_FLAVORS[0] });
    expect(order.coinReward).toBe(
      Math.ceil(2 * CROPS.emberpepper.sellValue * ORDER_COIN_MULTIPLIER),
    );
    expect(order.xpReward).toBe(Math.ceil(2 * CROPS.emberpepper.xp * ORDER_XP_MULTIPLIER));
  });

  it('moondust rolls the max of the range via one rng call', () => {
    // premium roll (0), pick(unlocked) (0, only sunwheat), moondust roll
    // (0.99 -> max), flavor roll (0 -> first).
    const rng = queuedRng([0, 0, 0.99, 0]);
    const order = generateOrder(1, rng);
    expect(order.premium?.moondust).toBe(PREMIUM_MOONDUST_MAX);
  });

  it('a premiumChance of 0 suppresses premium orders even when the roll would hit', () => {
    const order = generateOrder(2, () => 0, 0);
    expect(order.premium).toBeUndefined();
  });

  it('moondust is always an integer in range and flavor is always from the pool', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (const order of sampleOrders(level, 300)) {
        if (order.premium === undefined) continue;
        expect(Number.isInteger(order.premium.moondust)).toBe(true);
        expect(order.premium.moondust).toBeGreaterThanOrEqual(PREMIUM_MOONDUST_MIN);
        expect(order.premium.moondust).toBeLessThanOrEqual(PREMIUM_MOONDUST_MAX);
        expect(PREMIUM_FLAVORS).toContain(order.premium.flavor);
      }
    }
  });

  it('premium orders appear at roughly PREMIUM_CHANCE', () => {
    const orders = sampleOrders(3, 3000);
    const fraction = orders.filter((order) => order.premium !== undefined).length / orders.length;
    expect(fraction).toBeGreaterThan(PREMIUM_CHANCE - 0.05);
    expect(fraction).toBeLessThan(PREMIUM_CHANCE + 0.05);
  });

  describe('premium.chests (T2.23a)', () => {
    it('is absent below CHEST_UNLOCK_LEVEL, even when the total requested would be >= PREMIUM_TWO_CHEST_UNITS', () => {
      expect(CHEST_UNLOCK_LEVEL).toBeGreaterThan(4);
      const level = CHEST_UNLOCK_LEVEL - 1;
      // premium roll (0), second-item roll fails (0.99), pick(unlocked)
      // lands on sunwheat (0, uncapped) - single-item budget
      // (ORDER_BASE_UNITS + level) * PREMIUM_UNITS_MULT is >= 12 at this
      // level, proving the level gate applies regardless of the total.
      const rng = queuedRng([0, 0.99, 0]);
      const order = generateOrder(level, rng);
      const total = order.items.reduce((sum, item) => sum + item.count, 0);
      expect(total).toBeGreaterThanOrEqual(PREMIUM_TWO_CHEST_UNITS);
      expect(order.premium).toBeDefined();
      expect(order.premium?.chests).toBeUndefined();
    });

    it('is 1 at/above CHEST_UNLOCK_LEVEL when the total requested is below PREMIUM_TWO_CHEST_UNITS', () => {
      // premium roll (0), second-item roll fails (0.99), pick(unlocked)
      // lands on starcorn (index 1 of 5 - 0.2*5=1) whose ORDER_UNIT_CAPS
      // entry (5) clamps the doubled single-item budget well under
      // PREMIUM_TWO_CHEST_UNITS.
      const rng = queuedRng([0, 0.99, 0.2]);
      const order = generateOrder(CHEST_UNLOCK_LEVEL, rng);
      const total = order.items.reduce((sum, item) => sum + item.count, 0);
      expect(total).toBeLessThan(PREMIUM_TWO_CHEST_UNITS);
      expect(order.premium?.chests).toBe(1);
    });

    it('is 2 at/above CHEST_UNLOCK_LEVEL when the total requested is >= PREMIUM_TWO_CHEST_UNITS', () => {
      // premium roll (0), second-item roll fails (0.99), pick(unlocked)
      // lands on sunwheat (0, uncapped) - nothing clamps the doubled
      // single-item budget below PREMIUM_TWO_CHEST_UNITS at this level.
      const rng = queuedRng([0, 0.99, 0]);
      const order = generateOrder(CHEST_UNLOCK_LEVEL, rng);
      const total = order.items.reduce((sum, item) => sum + item.count, 0);
      expect(total).toBeGreaterThanOrEqual(PREMIUM_TWO_CHEST_UNITS);
      expect(order.premium?.chests).toBe(2);
    });

    it('chests is always 1 or 2 (never another value) whenever present across many samples', () => {
      for (const order of sampleOrders(CHEST_UNLOCK_LEVEL, 500)) {
        if (order.premium?.chests === undefined) continue;
        expect([1, 2]).toContain(order.premium.chests);
      }
    });
  });
});

describe('isOrderCoverable', () => {
  const singleItemOrder: Order = {
    items: [{ cropId: 'sunwheat', count: 3 }],
    coinReward: 10,
    xpReward: 5,
  };
  const twoItemOrder: Order = {
    items: [
      { cropId: 'sunwheat', count: 2 },
      { cropId: 'starcorn', count: 1 },
    ],
    coinReward: 20,
    xpReward: 10,
  };

  it('is true when inventory meets every item exactly', () => {
    expect(isOrderCoverable(singleItemOrder, { sunwheat: 3 })).toBe(true);
    expect(isOrderCoverable(twoItemOrder, { sunwheat: 2, starcorn: 1 })).toBe(true);
  });

  it('is true when inventory exceeds every item', () => {
    expect(isOrderCoverable(singleItemOrder, { sunwheat: 10 })).toBe(true);
    expect(isOrderCoverable(twoItemOrder, { sunwheat: 5, starcorn: 4 })).toBe(true);
  });

  it('is false when any single item is short', () => {
    expect(isOrderCoverable(singleItemOrder, { sunwheat: 2 })).toBe(false);
    expect(isOrderCoverable(twoItemOrder, { sunwheat: 2, starcorn: 0 })).toBe(false);
    expect(isOrderCoverable(twoItemOrder, { sunwheat: 1, starcorn: 5 })).toBe(false);
  });

  it('is false when the inventory is missing an item entirely (undefined, not 0)', () => {
    expect(isOrderCoverable(singleItemOrder, {})).toBe(false);
    expect(isOrderCoverable(twoItemOrder, { sunwheat: 2 })).toBe(false);
  });

  it('ignores extra inventory crops the order does not ask for', () => {
    expect(isOrderCoverable(singleItemOrder, { sunwheat: 3, glowberry: 99 })).toBe(true);
  });
});
