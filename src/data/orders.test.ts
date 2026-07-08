import { describe, expect, it } from 'vitest';

import { CROPS } from './crops';
import { MAX_LEVEL } from './levels';
import {
  generateOrder,
  ORDER_BASE_UNITS,
  ORDER_COIN_MULTIPLIER,
  ORDER_UNITS_PER_LEVEL,
  ORDER_XP_MULTIPLIER,
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

  it('total units scale with level per the config parameters', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (const order of sampleOrders(level, 200)) {
        const total = order.items.reduce((sum, item) => sum + item.count, 0);
        expect(total).toBe(ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL * level);
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
    // At level 1 the teaser is carrot (unlockLevel 2).
    const orders = sampleOrders(1, 2000);
    const teaserCount = orders.filter((order) =>
      order.items.some((item) => item.cropId === 'carrot'),
    ).length;
    const fraction = teaserCount / orders.length;
    expect(fraction).toBeGreaterThan(TEASER_CHANCE - 0.07);
    expect(fraction).toBeLessThan(TEASER_CHANCE + 0.07);
    // A teaser order always pairs the teaser with one unlocked crop.
    for (const order of orders) {
      if (order.items.some((item) => item.cropId === 'carrot')) {
        expect(order.items).toHaveLength(2);
        expect(order.items.some((item) => item.cropId === 'sunwheat')).toBe(true);
      }
    }
  });

  it('a forced teaser roll pairs one unlocked crop with the next unlock', () => {
    // rng stuck at 0: teaser roll passes, first picks land on index 0,
    // and the split gives the first item exactly 1 unit.
    const order = generateOrder(1, () => 0);
    expect(order.items).toEqual([
      { cropId: 'sunwheat', count: 1 },
      { cropId: 'carrot', count: 3 },
    ]);
    expect(order.coinReward).toBe(
      Math.ceil((CROPS.sunwheat.sellValue + 3 * CROPS.carrot.sellValue) * ORDER_COIN_MULTIPLIER),
    );
    expect(order.xpReward).toBe(
      Math.ceil((CROPS.sunwheat.xp + 3 * CROPS.carrot.xp) * ORDER_XP_MULTIPLIER),
    );
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
      const forced = generateOrder(level, () => 0);
      for (const item of forced.items) {
        expect(CROPS[item.cropId].unlockLevel).toBeLessThanOrEqual(level);
      }
    }
  });

  it('clamps a sub-1 level to level 1 rules', () => {
    const order = generateOrder(0, () => 0.99);
    expect(order.items).toEqual([
      { cropId: 'sunwheat', count: ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL },
    ]);
  });
});
