import { CROPS } from './crops';
import type { Order } from './orders';

/**
 * Quest-driven onboarding config: the ordered step chain that walks a fresh
 * save through one full guided session (plant, harvest, deliver, review the
 * next order, replant mixed), plus the two scripted orders. All tunables
 * live here, never in scene/system logic. While the chain runs, the game is
 * on FULL RAILS: `GameStateStore.railsAllow` silently rejects every action
 * the current step does not call for.
 */

export type OnboardingStepId =
  | 'select-sunwheat'
  | 'plant-first'
  | 'plant-rest'
  | 'harvest-first'
  | 'harvest-rest'
  | 'open-orders'
  | 'deliver-sunwheat'
  | 'review-order'
  | 'close-orders'
  | 'plant-mixed';

/**
 * The subset of steps advanced by UI events (seed selection, the order board
 * opening or closing) via `notifyOnboardingUiEvent`, rather than by store
 * actions. The open/close events are tick-notified from observed panel
 * state, so a panel already in the required state when its step begins still
 * counts. `review-order` also completes the moment the board closes (an
 * early close, before its read-dwell elapses - see `REVIEW_ORDER_DWELL_MS`);
 * the notifier fires `review-order` then `close-orders` back to back on a
 * board-closed observation, so an early close advances both and neither
 * step can ever wedge.
 */
export type OnboardingUiEventId =
  'select-sunwheat' | 'open-orders' | 'review-order' | 'close-orders';

/**
 * Ids in the pulse-target registry (see systems/pulseTargets.ts). SeedBar,
 * Hud, OrderBoard, InventoryPanel, and FarmScene each register the targets
 * they own.
 */
export type PulseTargetId =
  | 'seed-sunwheat'
  | 'seed-starcorn'
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
   * swipe guide instead. Conditional resolution (seed-button fallbacks, the
   * deliver step preferring the open board's Fulfill button, plant-mixed
   * walking sunwheat then starcorn) lives in `OnboardingGuide.resolveTarget`.
   */
  pulseTarget: PulseTargetId | null;
}

/**
 * ORDER A: the scripted delivery placed into slot 0 when `deliver-sunwheat`
 * begins. Rewards are explicit, NOT the generator formula: the 10 tutorial
 * harvests pay 20 xp, so the +10 here lands the fulfillment at exactly the
 * 30 xp level-2 threshold - the celebration and starcorn reveal fire
 * mid-tutorial by design. The 95 coins fund the plant-mixed step with no
 * selling (the rails forbid it): start 50 -> plant 10 sunwheat (-50) -> 0
 * coins -> harvest 10 -> deliver 6 (+95) -> 95 coins, 4 sunwheat held ->
 * plant 8 sunwheat + 4 starcorn (-88) -> tutorial done with 7 coins.
 */
export const ONBOARDING_ORDER_A: Order = {
  items: [{ cropId: 'sunwheat', count: 6 }],
  coinReward: 95,
  xpReward: 10,
};

/**
 * ORDER B: replaces slot 0 the moment ORDER A is fulfilled during
 * onboarding, so the board immediately shows the order the plant-mixed step
 * grows toward. Its item counts ARE that step's goals (8 sunwheat, 4
 * starcorn) and the review-order chip derives its copy from these items.
 * Rewards are the standard generator formula, precomputed:
 * coins ceil((8*8 + 4*20) * 1.3) = 188, xp ceil((8*2 + 4*5) * 1.5) = 54.
 * Fulfilling it post-tutorial lands level 3 (and glowberry) naturally.
 */
export const ONBOARDING_ORDER_B: Order = {
  items: [
    { cropId: 'sunwheat', count: 8 },
    { cropId: 'starcorn', count: 4 },
  ],
  coinReward: 188,
  xpReward: 54,
};

/**
 * User-facing "8 Sunwheat and 4 Starcorn" list for an order's items, using
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
    instruction: 'Once the crops are ready, drag across the field to harvest the rest',
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
    id: 'review-order',
    instruction: `This order needs ${orderItemsText(ONBOARDING_ORDER_B)}`,
    goal: 1,
    pulseTarget: 'order-card-0',
  },
  {
    id: 'close-orders',
    instruction: 'Tap outside the window to close it',
    goal: 1,
    pulseTarget: null,
  },
  {
    id: 'plant-mixed',
    instruction: 'Plant 8 Sunwheat and 4 Starcorn',
    goal: 8,
    goalB: 4,
    pulseTarget: 'empty-plot',
  },
];

/**
 * Shown instead of the harvest-first step's `instruction` while no sunwheat
 * is ready yet; `OnboardingGuide` appends the live " Ns" countdown to the
 * soonest-ready plot. The moment one ripens the chip flips to the step copy.
 */
export const HARVEST_COUNTDOWN_INSTRUCTION = 'Sunwheat growing...';

/**
 * How long the `review-order` step's board must stay open before
 * `GameStateStore.autoAdvanceOnboarding` advances it on its own, giving the
 * player time to read the order. An early close still advances the step
 * immediately via the ordinary `review-order` UI event, whichever comes
 * first.
 */
export const REVIEW_ORDER_DWELL_MS = 3000;
