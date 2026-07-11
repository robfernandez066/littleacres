import { describe, expect, it } from 'vitest';

import { CROPS } from './crops';
import { MAX_LEVEL } from './levels';
import {
  generateOrder,
  ORDER_BASE_UNITS,
  ORDER_COIN_MULTIPLIER,
  ORDER_UNIT_CAPS,
  ORDER_UNITS_PER_LEVEL,
  ORDER_XP_MULTIPLIER,
  PREMIUM_CHANCE,
  PREMIUM_FLAVORS,
  PREMIUM_MOONDUST_MAX,
  PREMIUM_MOONDUST_MIN,
  PREMIUM_UNITS_MULT,
  TEASER_CHANCE,
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

  it('includes at most one teaser (next-unlock) crop; everything else is unlocked', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (const order of sampleOrders(level, 500)) {
        const teaserItems = order.items.filter(
          (item) => CROPS[item.cropId].unlockLevel === level + 1,
        );
        const unlockedItems = order.items.filter((item) => CROPS[item.cropId].unlockLevel <= level);
        expect(teaserItems.length).toBeLessThanOrEqual(1);
        // No item is ever locked beyond the next unlock.
        expect(teaserItems.length + unlockedItems.length).toBe(order.items.length);
      }
    }
  });

  it('teaser orders appear at roughly TEASER_CHANCE when a next unlock exists', () => {
    // At level 1 the teaser is starcorn (unlockLevel 2).
    const orders = sampleOrders(1, 2000);
    const teaserCount = orders.filter((order) =>
      order.items.some((item) => item.cropId === 'starcorn'),
    ).length;
    const fraction = teaserCount / orders.length;
    expect(fraction).toBeGreaterThan(TEASER_CHANCE - 0.07);
    expect(fraction).toBeLessThan(TEASER_CHANCE + 0.07);
    // A teaser order always pairs the teaser with one unlocked crop.
    for (const order of orders) {
      if (order.items.some((item) => item.cropId === 'starcorn')) {
        expect(order.items).toHaveLength(2);
        expect(order.items.some((item) => item.cropId === 'sunwheat')).toBe(true);
      }
    }
  });

  it('a forced teaser roll pairs one unlocked crop with the next unlock', () => {
    // rng stuck at 0: with premium pinned off, teaser roll passes, first
    // picks land on index 0, and the split gives the first item exactly 1
    // unit (starcorn's uncapped).
    const order = generateOrder(1, () => 0, TEASER_CHANCE, 0);
    expect(order.premium).toBeUndefined();
    expect(order.items).toEqual([
      { cropId: 'sunwheat', count: 1 },
      { cropId: 'starcorn', count: 2 },
    ]);
    expect(order.coinReward).toBe(
      Math.ceil((CROPS.sunwheat.sellValue + 2 * CROPS.starcorn.sellValue) * ORDER_COIN_MULTIPLIER),
    );
    expect(order.xpReward).toBe(
      Math.ceil((CROPS.sunwheat.xp + 2 * CROPS.starcorn.xp) * ORDER_XP_MULTIPLIER),
    );
  });

  it('a forced teaser roll at level 2 clamps the glowberry item to its cap', () => {
    // Same rng-stuck-at-0 shape (premium pinned off), one level later: the
    // teaser is glowberry (unlocks at 3), whose pre-clamp split count (3)
    // exceeds its cap (2).
    const order = generateOrder(2, () => 0, TEASER_CHANCE, 0);
    expect(order.items).toEqual([
      { cropId: 'sunwheat', count: 1 },
      { cropId: 'glowberry', count: 2 },
    ]);
    expect(order.coinReward).toBe(
      Math.ceil((CROPS.sunwheat.sellValue + 2 * CROPS.glowberry.sellValue) * ORDER_COIN_MULTIPLIER),
    );
    expect(order.xpReward).toBe(
      Math.ceil((CROPS.sunwheat.xp + 2 * CROPS.glowberry.xp) * ORDER_XP_MULTIPLIER),
    );
  });

  it('a single-item glowberry order (no second item) is still capped', () => {
    // First rng() (0.99) fails the second-item roll; second rng() (0.9)
    // picks index 2 of the 3 unlocked crops at level 5 (glowberry). The
    // single-item count equals totalUnits (7), which the cap clamps to 2.
    const rng = queuedRng([0.99, 0.9]);
    const order = generateOrder(5, rng);
    expect(order.items).toEqual([{ cropId: 'glowberry', count: 2 }]);
    expect(order.coinReward).toBe(Math.ceil(2 * CROPS.glowberry.sellValue * ORDER_COIN_MULTIPLIER));
    expect(order.xpReward).toBe(Math.ceil(2 * CROPS.glowberry.xp * ORDER_XP_MULTIPLIER));
  });

  it('never teases when no crop unlocks at the next level', () => {
    // Nothing unlocks at level 4+, so even a rng that would always take the
    // teaser branch yields fully unlocked orders at level 3 and above.
    for (const level of [3, 4, MAX_LEVEL]) {
      for (const order of sampleOrders(level, 200)) {
        for (const item of order.items) {
          expect(CROPS[item.cropId].unlockLevel).toBeLessThanOrEqual(level);
        }
      }
      const forced = generateOrder(level, () => 0, TEASER_CHANCE, 0);
      for (const item of forced.items) {
        expect(CROPS[item.cropId].unlockLevel).toBeLessThanOrEqual(level);
      }
    }
  });

  it('a teaserChance of 0 suppresses stretch orders even when the roll would hit', () => {
    // At level 2 the teaser is glowberry; rng stuck at 0 always passes a
    // nonzero teaser roll (premium pinned off throughout, so the teaser roll
    // actually runs).
    const withTeaser = generateOrder(2, () => 0, TEASER_CHANCE, 0);
    expect(withTeaser.items.some((item) => item.cropId === 'glowberry')).toBe(true);

    const suppressed = generateOrder(2, () => 0, 0, 0);
    expect(suppressed.items.some((item) => item.cropId === 'glowberry')).toBe(false);
    for (const item of suppressed.items) {
      expect(CROPS[item.cropId].unlockLevel).toBeLessThanOrEqual(2);
    }
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

  it('a forced premium roll (rng stuck at 0) doubles the budget, skips the teaser roll entirely, and rolls min moondust + first flavor', () => {
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

  it('a premium order never also teases, even when the teaser roll would otherwise hit', () => {
    // rng stuck at 0 would take the teaser branch (starcorn) if premium did
    // not skip that roll entirely - the premium roll consumes it first.
    const order = generateOrder(1, () => 0);
    expect(order.premium).toBeDefined();
    expect(order.items.some((item) => item.cropId === 'starcorn')).toBe(false);
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

  it('moondust rolls the max of the range via one rng call', () => {
    // premium roll (0), pick(unlocked) (0, only sunwheat), moondust roll
    // (0.99 -> max), flavor roll (0 -> first).
    const rng = queuedRng([0, 0, 0.99, 0]);
    const order = generateOrder(1, rng);
    expect(order.premium?.moondust).toBe(PREMIUM_MOONDUST_MAX);
  });

  it('a premiumChance of 0 suppresses premium orders even when the roll would hit', () => {
    const order = generateOrder(2, () => 0, TEASER_CHANCE, 0);
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
});
