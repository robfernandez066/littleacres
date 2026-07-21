import { describe, expect, it } from 'vitest';

import { xpForLevel } from './levels';
import {
  ONBOARDING_ORDER_A,
  ONBOARDING_ORDER_B,
  ONBOARDING_STEPS,
  orderItemsText,
} from './onboarding';
import {
  ORDER_COIN_MULTIPLIER,
  ORDER_XP_MULTIPLIER,
  orderItemSellValue,
  orderItemXp,
} from './orders';

describe('onboarding step chain', () => {
  it('is exactly the 10-step full-rails chain, in order', () => {
    expect(ONBOARDING_STEPS.map((step) => step.id)).toEqual([
      'select-sunwheat',
      'plant-first',
      'plant-rest',
      'harvest-first',
      'harvest-rest',
      'open-orders',
      'deliver-sunwheat',
      'review-order',
      'close-orders',
      'plant-mixed',
    ]);
  });

  it('ORDER A pays the 95 coins that fund the plant-mixed step without selling', () => {
    expect(ONBOARDING_ORDER_A.coinReward).toBe(95);
    expect(ONBOARDING_ORDER_A.xpReward).toBe(10);
  });

  it('ORDER A lands the tutorial exactly on the level-2 threshold', () => {
    // THE onboarding contract (T4.11-fix): the 10 scripted harvests pay
    // CROPS.sunwheat.xp (2) each and ORDER A adds its explicit +10, so the
    // tutorial ends at 30 xp - which must be exactly xpForLevel(2), or step 10
    // (plant-mixed) never gets its Starcorn unlock and the chain wedges.
    expect(10 * 2 + ONBOARDING_ORDER_A.xpReward).toBe(30);
    expect(xpForLevel(2)).toBe(30);
  });

  it('ORDER B carries the live generator formula over its own items', () => {
    // RE-PIN (T4.11-fix): ORDER B's rewards are precomputed, so they are
    // derived here from the SAME multipliers and per-item values the generator
    // uses - this fails the moment a balance pass moves either and leaves the
    // constant stale (which is exactly how the old 1.3-era 188 survived).
    const coinBase = ONBOARDING_ORDER_B.items.reduce(
      (sum, item) => sum + item.count * orderItemSellValue(item),
      0,
    );
    const xpBase = ONBOARDING_ORDER_B.items.reduce(
      (sum, item) => sum + item.count * orderItemXp(item),
      0,
    );
    expect(ONBOARDING_ORDER_B.coinReward).toBe(Math.ceil(coinBase * ORDER_COIN_MULTIPLIER));
    expect(ONBOARDING_ORDER_B.xpReward).toBe(Math.ceil(xpBase * ORDER_XP_MULTIPLIER));
    // Derivation: coins ceil((8*8 + 4*19) * 1.6) = 224 (was 188 at the old 1.3
    // multiplier and Starcorn 20); xp ceil((8*2 + 4*9) * 1.5) = 78, unchanged.
    expect(ONBOARDING_ORDER_B.coinReward).toBe(224);
    expect(ONBOARDING_ORDER_B.xpReward).toBe(78);
  });

  it('derives the review-order chip copy from the ORDER B config', () => {
    const step = ONBOARDING_STEPS.find((s) => s.id === 'review-order');
    expect(step?.instruction).toBe(`This order needs ${orderItemsText(ONBOARDING_ORDER_B)}`);
    expect(step?.instruction).toBe('This order needs 8 Sunwheat and 4 Starcorn');
  });

  it('the drag steps have no pulse target (the ghost swipe shows instead)', () => {
    for (const id of ['plant-rest', 'harvest-rest'] as const) {
      expect(ONBOARDING_STEPS.find((s) => s.id === id)?.pulseTarget).toBeNull();
    }
  });
});

describe('orderItemsText', () => {
  it('uses the singular name for a count of 1 and the plural otherwise', () => {
    expect(
      orderItemsText({
        items: [{ kind: 'crop', cropId: 'starcorn', count: 1 }],
        coinReward: 0,
        xpReward: 0,
      }),
    ).toBe('1 Starcorn');
    expect(
      orderItemsText({
        items: [{ kind: 'crop', cropId: 'glowberry', count: 3 }],
        coinReward: 0,
        xpReward: 0,
      }),
    ).toBe('3 Glowberries');
  });

  it('joins two items with "and"', () => {
    expect(orderItemsText(ONBOARDING_ORDER_B)).toBe('8 Sunwheat and 4 Starcorn');
  });
});
