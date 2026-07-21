import { describe, expect, it } from 'vitest';

import { CHEST_UNLOCK_LEVEL, PREMIUM_TWO_CHEST_COIN_VALUE } from './chests';
import { CROPS } from './crops';
import { MAX_LEVEL } from './levels';
import { GOODS } from './goods';
import {
  generateOrder,
  isOrderCoverable,
  ORDER_BASE_UNITS,
  ORDER_COIN_MULTIPLIER,
  ORDER_GOOD_UNIT_CAPS,
  ORDER_UNIT_CAPS,
  ORDER_UNITS_PER_LEVEL,
  ORDER_XP_MULTIPLIER,
  type Order,
  orderItemSellValue,
  orderItemXp,
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
        const ids = order.items.map((item) => (item.kind === 'crop' ? item.cropId : item.goodId));
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
          const cap =
            item.kind === 'crop' ? ORDER_UNIT_CAPS[item.cropId] : ORDER_GOOD_UNIT_CAPS[item.goodId];
          if (cap !== undefined) expect(item.count).toBeLessThanOrEqual(cap);
        }
      }
    }
  });

  it('stored rewards are the config multipliers over sell value and xp, rounded up', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (const order of sampleOrders(level, 200)) {
        const coinBase = order.items.reduce(
          (sum, item) => sum + item.count * orderItemSellValue(item),
          0,
        );
        const xpBase = order.items.reduce((sum, item) => sum + item.count * orderItemXp(item), 0);
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
            // Crop-only pool here: sampleOrders passes no availableGoods.
            expect(item.kind).toBe('crop');
            if (item.kind === 'crop') {
              expect(CROPS[item.cropId].unlockLevel).toBeLessThanOrEqual(level);
            }
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
    expect(order.items).toEqual([{ kind: 'crop', cropId: 'glowberry', count: 2 }]);
    expect(order.coinReward).toBe(Math.ceil(2 * CROPS.glowberry.sellValue * ORDER_COIN_MULTIPLIER));
    expect(order.xpReward).toBe(Math.ceil(2 * CROPS.glowberry.xp * ORDER_XP_MULTIPLIER));
  });

  it('a single-item moonroot order (no second item) is still capped', () => {
    // Level 4 unlocks moonroot; totalUnits = 2 + 1*4 = 6, capped to 3. First
    // rng() (0.99) fails premium; second (0.99) fails the second-item roll;
    // third (0.9) picks index 3 of the 4 unlocked crops (moonroot).
    const rng = queuedRng([0.99, 0.99, 0.9]);
    const order = generateOrder(4, rng);
    expect(order.items).toEqual([{ kind: 'crop', cropId: 'moonroot', count: 3 }]);
    expect(order.coinReward).toBe(Math.ceil(3 * CROPS.moonroot.sellValue * ORDER_COIN_MULTIPLIER));
    expect(order.xpReward).toBe(Math.ceil(3 * CROPS.moonroot.xp * ORDER_XP_MULTIPLIER));
  });

  it('a single-item emberpepper order (no second item) is still capped', () => {
    // Level 5; totalUnits = 2 + 1*5 = 7, capped to 2. First rng() (0.99)
    // fails premium; second (0.99) fails the second-item roll; third (0.9)
    // picks index 4 of the 5 unlocked crops (emberpepper).
    const rng = queuedRng([0.99, 0.99, 0.9]);
    const order = generateOrder(5, rng);
    expect(order.items).toEqual([{ kind: 'crop', cropId: 'emberpepper', count: 2 }]);
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
    expect(order.items).toEqual([{ kind: 'crop', cropId: 'dewmelon', count: 2 }]);
    expect(order.coinReward).toBe(Math.ceil(2 * CROPS.dewmelon.sellValue * ORDER_COIN_MULTIPLIER));
    expect(order.xpReward).toBe(Math.ceil(2 * CROPS.dewmelon.xp * ORDER_XP_MULTIPLIER));
  });

  it('a single-item sagesprig order (no second item) is still capped (T3.11)', () => {
    // Level 8 unlocks sagesprig; totalUnits = 2 + 1*8 = 10, capped to 1.
    // First rng() (0.99) fails premium; second (0.99) fails the second-item
    // roll; third (0.95) picks index 6 of the 7 unlocked crops (sagesprig).
    const rng = queuedRng([0.99, 0.99, 0.95]);
    const order = generateOrder(8, rng);
    expect(order.items).toEqual([{ kind: 'crop', cropId: 'sagesprig', count: 1 }]);
    expect(order.coinReward).toBe(Math.ceil(1 * CROPS.sagesprig.sellValue * ORDER_COIN_MULTIPLIER));
    expect(order.xpReward).toBe(Math.ceil(1 * CROPS.sagesprig.xp * ORDER_XP_MULTIPLIER));
  });

  it('clamps a sub-1 level to level 1 rules', () => {
    const order = generateOrder(0, () => 0.99);
    expect(order.items).toEqual([
      { kind: 'crop', cropId: 'sunwheat', count: ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL },
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
        kind: 'crop',
        cropId: 'sunwheat',
        count: (ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL) * PREMIUM_UNITS_MULT,
      },
    ]);
    expect(order.premium).toEqual({ moondust: PREMIUM_MOONDUST_MIN, flavor: PREMIUM_FLAVORS[0] });
  });

  it('a premium order at level 2 doubles the budget, picks two items, and stores rewards over the bigger items', () => {
    const order = generateOrder(2, () => 0);
    expect(order.items).toEqual([
      { kind: 'crop', cropId: 'sunwheat', count: 1 },
      { kind: 'crop', cropId: 'starcorn', count: 5 }, // pre-clamp split (7) capped to 5
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
    expect(order.items).toEqual([{ kind: 'crop', cropId: 'emberpepper', count: 2 }]);
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

  describe('premium.chests (T2.23a, value-tiered T3.22)', () => {
    it('a Sunwheat-only max-budget premium at level 8 carries 1 chest, not 2 (the Sunwheat-bias fix)', () => {
      // premium roll (0), second-item roll fails (0.99), pick(unlocked)
      // lands on sunwheat (0, first of 7 unlocked crops, uncapped) - the
      // doubled single-item budget at MAX_LEVEL (20 units) used to trigger
      // the old raw-unit threshold every time, purely because Sunwheat has
      // no ORDER_UNIT_CAPS entry. Its low sell value keeps coinReward well
      // under the new value-based threshold.
      const rng = queuedRng([0, 0.99, 0]);
      const order = generateOrder(MAX_LEVEL, rng);
      expect(order.items).toEqual([{ kind: 'crop', cropId: 'sunwheat', count: 20 }]);
      expect(order.coinReward).toBeLessThan(PREMIUM_TWO_CHEST_COIN_VALUE);
      expect(order.premium?.chests).toBe(1);
    });

    it('a high-value premium (coinReward >= the threshold) carries 2 chests despite requesting very few units', () => {
      // premium roll (0), second-item roll fails (0.99), pick(unlocked)
      // lands on sagesprig (index 6 of 7 unlocked at MAX_LEVEL); the doubled
      // budget (20) clamps to sagesprig's cap of 1, but its high sell value
      // alone crosses PREMIUM_TWO_CHEST_COIN_VALUE.
      const rng = queuedRng([0, 0.99, 0.95, 0, 0]);
      const order = generateOrder(MAX_LEVEL, rng);
      expect(order.items).toEqual([{ kind: 'crop', cropId: 'sagesprig', count: 1 }]);
      expect(order.coinReward).toBeGreaterThanOrEqual(PREMIUM_TWO_CHEST_COIN_VALUE);
      expect(order.premium?.chests).toBe(2);
    });

    it('the threshold is inclusive at the tightest achievable margin', () => {
      // No integer combination of crop sell values lands coinReward exactly
      // on PREMIUM_TWO_CHEST_COIN_VALUE (every crop but Glowberry has an
      // even sell value, and no reachable combination sums to the one odd
      // coinBase - 461 - that would ceil to it). These two orders differ by
      // exactly one Sunwheat unit and are the closest achievable pair
      // straddling the threshold: 598 (below) still rolls 1 chest, 609 (the
      // next reachable value, at/above) rolls 2 - proving the comparison is
      // >=, not >.
      const belowRng = queuedRng([0, 0, 0, 0.9, 0.3, 0, 0]);
      const below = generateOrder(CHEST_UNLOCK_LEVEL, belowRng);
      expect(below.items).toEqual([
        { kind: 'crop', cropId: 'sunwheat', count: 5 },
        { kind: 'crop', cropId: 'emberpepper', count: 2 },
      ]);
      expect(below.coinReward).toBe(598);
      expect(below.premium?.chests).toBe(1);

      const atRng = queuedRng([0, 0, 0, 0.9, 0.35, 0, 0]);
      const at = generateOrder(CHEST_UNLOCK_LEVEL, atRng);
      expect(at.items).toEqual([
        { kind: 'crop', cropId: 'sunwheat', count: 6 },
        { kind: 'crop', cropId: 'emberpepper', count: 2 },
      ]);
      expect(at.coinReward).toBe(609);
      expect(at.coinReward).toBeGreaterThanOrEqual(PREMIUM_TWO_CHEST_COIN_VALUE);
      expect(at.premium?.chests).toBe(2);
    });

    it('is absent below CHEST_UNLOCK_LEVEL, even when the coinReward would clear the threshold', () => {
      expect(CHEST_UNLOCK_LEVEL).toBeGreaterThan(1);
      const level = CHEST_UNLOCK_LEVEL - 1;
      // Same Sunwheat + Emberpepper shape as the boundary test above (still
      // well clear of the threshold at this level's smaller budget), proving
      // the level gate applies regardless of value.
      const rng = queuedRng([0, 0, 0, 0.9, 0.4, 0, 0]);
      const order = generateOrder(level, rng);
      expect(order.items).toEqual([
        { kind: 'crop', cropId: 'sunwheat', count: 6 },
        { kind: 'crop', cropId: 'emberpepper', count: 2 },
      ]);
      expect(order.coinReward).toBeGreaterThanOrEqual(PREMIUM_TWO_CHEST_COIN_VALUE);
      expect(order.premium).toBeDefined();
      expect(order.premium?.chests).toBeUndefined();
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
    items: [{ kind: 'crop', cropId: 'sunwheat', count: 3 }],
    coinReward: 10,
    xpReward: 5,
  };
  const twoItemOrder: Order = {
    items: [
      { kind: 'crop', cropId: 'sunwheat', count: 2 },
      { kind: 'crop', cropId: 'starcorn', count: 1 },
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

describe('goods in orders (T4.3)', () => {
  const MILL_GOODS = ['sunflour'] as const;

  /** Every item across many generated orders, at a level where all crops exist. */
  function sampleItems(availableGoods: readonly 'sunflour'[], count = 400, seed = 11) {
    const rng = seededRng(seed);
    return Array.from({ length: count }, () =>
      generateOrder(MAX_LEVEL, rng, 0, availableGoods),
    ).flatMap((order) => order.items);
  }

  it('never requests a good when the player owns no building that makes one', () => {
    // The whole gate: an empty availableGoods keeps goods out of the pool, so
    // a mill-less save can never draw a Sunflour order at any level or seed.
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (let seed = 1; seed <= 15; seed++) {
        const rng = seededRng(seed);
        for (let i = 0; i < 40; i++) {
          for (const item of generateOrder(level, rng, 0, []).items) {
            expect(item.kind).toBe('crop');
          }
        }
      }
    }
  });

  it('requests the good once it is available, and only ones that were passed in', () => {
    const items = sampleItems(MILL_GOODS);
    expect(items.some((item) => item.kind === 'good')).toBe(true);
    for (const item of items) {
      if (item.kind === 'good') expect(MILL_GOODS).toContain(item.goodId);
    }
  });

  it('clamps a good item to its own low cap, never the crop caps', () => {
    for (const item of sampleItems(MILL_GOODS)) {
      if (item.kind !== 'good') continue;
      expect(item.count).toBeGreaterThanOrEqual(1);
      expect(item.count).toBeLessThanOrEqual(ORDER_GOOD_UNIT_CAPS[item.goodId]!);
    }
  });

  it('prices a good item from GOODS, not CROPS', () => {
    const sunflour = { kind: 'good', goodId: 'sunflour', count: 2 } as const;
    expect(orderItemSellValue(sunflour)).toBe(GOODS.sunflour.sellValue);
    expect(orderItemXp(sunflour)).toBe(GOODS.sunflour.xp);
  });

  it("a good order's stored rewards are the same multipliers over the good's own numbers", () => {
    const rng = seededRng(3);
    for (let i = 0; i < 300; i++) {
      const order = generateOrder(MAX_LEVEL, rng, 0, MILL_GOODS);
      if (!order.items.some((item) => item.kind === 'good')) continue;
      const coinBase = order.items.reduce((sum, i2) => sum + i2.count * orderItemSellValue(i2), 0);
      const xpBase = order.items.reduce((sum, i2) => sum + i2.count * orderItemXp(i2), 0);
      expect(order.coinReward).toBe(Math.ceil(coinBase * ORDER_COIN_MULTIPLIER));
      expect(order.xpReward).toBe(Math.ceil(xpBase * ORDER_XP_MULTIPLIER));
    }
  });

  it('an order never asks for the same thing twice, crops and goods sharing one pool', () => {
    const rng = seededRng(5);
    for (let i = 0; i < 400; i++) {
      const order = generateOrder(MAX_LEVEL, rng, 0, MILL_GOODS);
      const keys = order.items.map((item) => (item.kind === 'crop' ? item.cropId : item.goodId));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('passing no availableGoods reproduces the pre-T4.3 crop-only stream exactly', () => {
    // The compatibility guarantee: the goods pool must not perturb the rng
    // sequence when it is empty, or every existing pinned order would shift.
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const a = Array.from({ length: 30 }, () => generateOrder(level, seededRng(9), 0.5));
      const b = Array.from({ length: 30 }, () => generateOrder(level, seededRng(9), 0.5, []));
      expect(a).toEqual(b);
    }
  });
});

describe('isOrderCoverable with goods (T4.3)', () => {
  const goodOrder: Order = {
    items: [{ kind: 'good', goodId: 'sunflour', count: 2 }],
    coinReward: 65,
    xpReward: 45,
  };
  const mixedOrder: Order = {
    items: [
      { kind: 'crop', cropId: 'sunwheat', count: 3 },
      { kind: 'good', goodId: 'sunflour', count: 1 },
    ],
    coinReward: 100,
    xpReward: 50,
  };

  it('checks a good item against goods, not inventory', () => {
    expect(isOrderCoverable(goodOrder, {}, { sunflour: 2 })).toBe(true);
    expect(isOrderCoverable(goodOrder, {}, { sunflour: 1 })).toBe(false);
    expect(isOrderCoverable(goodOrder, {}, {})).toBe(false);
  });

  it('never pays a good item out of the crop inventory (the maps stay separate)', () => {
    // A bag full of Sunwheat covers nothing a mill was supposed to make.
    expect(isOrderCoverable(goodOrder, { sunwheat: 999 }, {})).toBe(false);
  });

  it('requires BOTH maps to cover a mixed order', () => {
    expect(isOrderCoverable(mixedOrder, { sunwheat: 3 }, { sunflour: 1 })).toBe(true);
    expect(isOrderCoverable(mixedOrder, { sunwheat: 2 }, { sunflour: 1 })).toBe(false);
    expect(isOrderCoverable(mixedOrder, { sunwheat: 3 }, { sunflour: 0 })).toBe(false);
  });

  it('defaults goods to empty, so a crop-only call behaves exactly as before', () => {
    const cropOnly: Order = {
      items: [{ kind: 'crop', cropId: 'sunwheat', count: 3 }],
      coinReward: 10,
      xpReward: 5,
    };
    expect(isOrderCoverable(cropOnly, { sunwheat: 3 })).toBe(true);
    expect(isOrderCoverable(goodOrder, {})).toBe(false);
  });
});
