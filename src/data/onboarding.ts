import { CROPS } from './crops';
import type { Order } from './orders';

/**
 * Quest-driven onboarding config: the ordered step chain that walks a fresh
 * save through one full guided session (plant, harvest, deliver, sell,
 * review the next order, replant mixed), plus the two scripted orders. All
 * tunables live here, never in scene/system logic.
 */

export type OnboardingStepId =
  | 'select-sunwheat'
  | 'plant-first'
  | 'plant-rest'
  | 'harvest-first'
  | 'harvest-rest'
  | 'open-orders'
  | 'deliver-sunwheat'
  | 'close-orders'
  | 'open-bag'
  | 'sell-rest'
  | 'close-bag'
  | 'check-orders'
  | 'review-order'
  | 'plant-mixed';

/**
 * The subset of steps advanced by UI events (seed selection, panels opening
 * or closing) via `notifyOnboardingUiEvent`, rather than by store actions.
 * The open/close events are tick-notified from observed panel state, so a
 * panel already in the required state when its step begins still counts.
 * `check-orders` completes when the order board opens (like `open-orders`)
 * and `review-order` when it closes (like `close-orders`), unconditionally -
 * the step can never wedge on the card's contents.
 */
export type OnboardingUiEventId =
  | 'select-sunwheat'
  | 'open-orders'
  | 'close-orders'
  | 'open-bag'
  | 'close-bag'
  | 'check-orders'
  | 'review-order';

/**
 * Ids in the pulse-target registry (see systems/pulseTargets.ts). SeedBar,
 * Hud, OrderBoard, InventoryPanel, and FarmScene each register the targets
 * they own.
 */
export type PulseTargetId =
  | 'seed-sunwheat'
  | 'seed-carrot'
  | 'empty-plot'
  | 'ready-plot'
  | 'orders-button'
  | 'bag-button'
  | 'fulfill-slot-0'
  | 'orders-close'
  | 'order-card-0'
  | 'sell-sunwheat';

export interface OnboardingStep {
  id: OnboardingStepId;
  /** Short imperative instruction shown on the chip. */
  instruction: string;
  /** Matching actions required to advance past this step (`progress`). */
  goal: number;
  /** Second goal for the dual-counter plant-mixed step (`progressB`). */
  goalB?: number;
  /**
   * Nominal pulse target; null means the step never shows the glow
   * highlight - the drag steps (plant-rest, harvest-rest) show the ghost
   * swipe guide instead. Conditional resolution (the deliver step swapping
   * between replant and the order board, seed-button fallbacks, plant-mixed
   * walking sunwheat then carrot) lives in `OnboardingGuide.resolveTarget`.
   */
  pulseTarget: PulseTargetId | null;
}

/**
 * ORDER A: the scripted delivery placed into slot 0 when `deliver-sunwheat`
 * begins. Rewards are explicit, NOT the generator formula: the 10 tutorial
 * harvests pay 20 xp, so the +10 here lands the fulfillment at exactly the
 * 30 xp level-2 threshold - the celebration and carrot reveal fire
 * mid-tutorial by design. Asking for 6 of the 10 held leaves 4 for the
 * sell-rest step.
 */
export const ONBOARDING_ORDER_A: Order = {
  items: [{ cropId: 'sunwheat', count: 6 }],
  coinReward: 63,
  xpReward: 10,
};

/**
 * ORDER B: replaces slot 0 the moment ORDER A is fulfilled during
 * onboarding, so the board immediately shows the order the plant-mixed step
 * grows toward. Its item counts ARE that step's goals (8 sunwheat, 4
 * carrots) and the review-order chip derives its copy from these items.
 * Rewards are the standard generator formula, precomputed:
 * coins ceil((8*8 + 4*20) * 1.3) = 188, xp ceil((8*2 + 4*5) * 1.5) = 54.
 * Fulfilling it post-tutorial lands level 3 (and glowberry) naturally.
 */
export const ONBOARDING_ORDER_B: Order = {
  items: [
    { cropId: 'sunwheat', count: 8 },
    { cropId: 'carrot', count: 4 },
  ],
  coinReward: 188,
  xpReward: 54,
};

/**
 * User-facing "8 Sunwheat and 4 Carrots" list for an order's items, using
 * each crop's configured plural name. The review-order chip derives its copy
 * through this so it always matches the ORDER B config, never a hardcoded
 * string.
 */
export function orderItemsText(order: Order): string {
  return order.items
    .map((item) => {
      const crop = CROPS[item.cropId];
      return `${item.count} ${item.count === 1 ? crop.name : crop.pluralName}`;
    })
    .join(' and ');
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'select-sunwheat',
    instruction: 'Tap the Sunwheat seed',
    goal: 1,
    pulseTarget: 'seed-sunwheat',
  },
  { id: 'plant-first', instruction: 'Tap a plot to plant', goal: 1, pulseTarget: 'empty-plot' },
  {
    id: 'plant-rest',
    instruction: 'Drag across empty plots to plant the rest',
    goal: 9,
    // Drag step: the ghost swipe guide shows instead of the glow highlight.
    pulseTarget: null,
  },
  {
    id: 'harvest-first',
    instruction: 'Tap a ripe Sunwheat to harvest',
    goal: 1,
    pulseTarget: 'ready-plot',
  },
  {
    id: 'harvest-rest',
    instruction: 'Drag across the field to harvest the rest',
    goal: 9,
    // Drag step: the ghost swipe guide shows instead of the glow highlight.
    pulseTarget: null,
  },
  {
    id: 'open-orders',
    instruction: 'Open the Orders board',
    goal: 1,
    pulseTarget: 'orders-button',
  },
  {
    id: 'deliver-sunwheat',
    instruction: 'Deliver 6 Sunwheat',
    goal: 1,
    pulseTarget: 'orders-button',
  },
  {
    id: 'close-orders',
    instruction: 'Tap outside the window to close it',
    goal: 1,
    pulseTarget: null,
  },
  { id: 'open-bag', instruction: 'Open your Bag', goal: 1, pulseTarget: 'bag-button' },
  {
    id: 'sell-rest',
    instruction: 'Sell your remaining Sunwheat',
    goal: 1,
    pulseTarget: 'sell-sunwheat',
  },
  { id: 'close-bag', instruction: 'Tap outside to close', goal: 1, pulseTarget: null },
  {
    id: 'check-orders',
    instruction: 'Check your Orders again',
    goal: 1,
    pulseTarget: 'orders-button',
  },
  {
    id: 'review-order',
    instruction: `This order needs ${orderItemsText(ONBOARDING_ORDER_B)}`,
    goal: 1,
    pulseTarget: 'order-card-0',
  },
  {
    id: 'plant-mixed',
    instruction: 'Plant 8 Sunwheat and 4 Carrots',
    goal: 8,
    goalB: 4,
    pulseTarget: 'empty-plot',
  },
];

/**
 * Shown instead of the deliver-sunwheat step's `instruction` while ORDER A is
 * not yet covered by inventory; `OnboardingGuide` appends " - n/6". Once
 * covered, the chip switches back to the step's normal instruction.
 */
export const DELIVER_PROGRESS_INSTRUCTION = 'Grow more Sunwheat';

/**
 * Shown instead of the harvest-first step's `instruction` while no sunwheat
 * is ready yet; `OnboardingGuide` appends the live " Ns" countdown to the
 * soonest-ready plot. The moment one ripens the chip flips to the step copy.
 */
export const HARVEST_COUNTDOWN_INSTRUCTION = 'Sunwheat growing...';
