import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_ORDER_A,
  ONBOARDING_ORDER_B,
  ONBOARDING_STEPS,
  orderItemsText,
} from './onboarding';

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
      orderItemsText({ items: [{ cropId: 'starcorn', count: 1 }], coinReward: 0, xpReward: 0 }),
    ).toBe('1 Starcorn');
    expect(
      orderItemsText({ items: [{ cropId: 'glowberry', count: 3 }], coinReward: 0, xpReward: 0 }),
    ).toBe('3 Glowberries');
  });

  it('joins two items with "and"', () => {
    expect(orderItemsText(ONBOARDING_ORDER_B)).toBe('8 Sunwheat and 4 Starcorn');
  });
});
