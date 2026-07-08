import { describe, expect, it } from 'vitest';

import { ONBOARDING_ORDER_B, ONBOARDING_STEPS, orderItemsText } from './onboarding';

describe('onboarding step chain', () => {
  it('is 15 steps with the order-review chain between close-bag and plant-mixed', () => {
    expect(ONBOARDING_STEPS).toHaveLength(15);
    const ids = ONBOARDING_STEPS.map((step) => step.id);
    expect(ids.indexOf('check-orders')).toBe(ids.indexOf('close-bag') + 1);
    expect(ids.indexOf('review-order')).toBe(ids.indexOf('check-orders') + 1);
    expect(ids.indexOf('close-orders-2')).toBe(ids.indexOf('review-order') + 1);
    expect(ids.indexOf('plant-mixed')).toBe(ids.indexOf('close-orders-2') + 1);
  });

  it('derives the review-order chip copy from the ORDER B config', () => {
    const step = ONBOARDING_STEPS.find((s) => s.id === 'review-order');
    expect(step?.instruction).toBe(`This order needs ${orderItemsText(ONBOARDING_ORDER_B)}`);
    expect(step?.instruction).toBe('This order needs 8 Sunwheat and 4 Carrots');
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
      orderItemsText({ items: [{ cropId: 'carrot', count: 1 }], coinReward: 0, xpReward: 0 }),
    ).toBe('1 Carrot');
    expect(
      orderItemsText({ items: [{ cropId: 'glowberry', count: 3 }], coinReward: 0, xpReward: 0 }),
    ).toBe('3 Glowberries');
  });

  it('joins two items with "and"', () => {
    expect(orderItemsText(ONBOARDING_ORDER_B)).toBe('8 Sunwheat and 4 Carrots');
  });
});
