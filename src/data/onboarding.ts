import type { Order } from './orders';

/**
 * Quest-driven onboarding config: the ordered step chain that walks a fresh
 * save to level 2, plus the scripted delivery order. All tunables live here,
 * never in scene/system logic.
 */

export type OnboardingStepId =
  | 'select-sunwheat'
  | 'plant-sunwheat'
  | 'harvest-sunwheat'
  | 'open-orders'
  | 'deliver-sunwheat'
  | 'plant-carrot';

/**
 * The subset of steps advanced by UI events (seed selection, opening the
 * order board) via `notifyOnboardingUiEvent`, rather than by store actions.
 */
export type OnboardingUiEventId = 'select-sunwheat' | 'open-orders';

/**
 * Ids in the pulse-target registry (see systems/pulseTargets.ts). SeedBar,
 * Hud, OrderBoard, and FarmScene each register the targets they own.
 */
export type PulseTargetId =
  | 'seed-sunwheat'
  | 'seed-carrot'
  | 'empty-plot'
  | 'ready-plot'
  | 'orders-button'
  | 'fulfill-slot-0'
  | 'orders-close';

export interface OnboardingStep {
  id: OnboardingStepId;
  /** Short imperative instruction; the chip appends " - n/goal" when goal > 1. */
  instruction: string;
  /** Matching actions required to advance past this step. */
  goal: number;
  /**
   * Nominal pulse target. Conditional resolution (no ready plot while crops
   * grow, the deliver step swapping between replant and the order board,
   * seed-button fallbacks) lives in `OnboardingGuide.resolveTarget`.
   */
  pulseTarget: PulseTargetId;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'select-sunwheat',
    instruction: 'Tap the Sunwheat seed',
    goal: 1,
    pulseTarget: 'seed-sunwheat',
  },
  { id: 'plant-sunwheat', instruction: 'Plant 3 Sunwheat', goal: 3, pulseTarget: 'empty-plot' },
  { id: 'harvest-sunwheat', instruction: 'Harvest 3 Sunwheat', goal: 3, pulseTarget: 'ready-plot' },
  {
    id: 'open-orders',
    instruction: 'Open the Orders board',
    goal: 1,
    pulseTarget: 'orders-button',
  },
  {
    id: 'deliver-sunwheat',
    instruction: 'Deliver 5 Sunwheat',
    goal: 1,
    pulseTarget: 'orders-button',
  },
  { id: 'plant-carrot', instruction: 'Plant a Carrot', goal: 1, pulseTarget: 'seed-carrot' },
];

/**
 * Shown instead of the deliver-sunwheat step's `instruction` while the
 * scripted order is not yet covered by inventory; `OnboardingGuide` appends
 * " - n/5". Once covered, the chip switches back to the step's normal
 * "Deliver 5 Sunwheat" instruction.
 */
export const DELIVER_PROGRESS_INSTRUCTION = 'Grow more Sunwheat';

/**
 * The scripted order placed into slot 0 when `deliver-sunwheat` begins.
 * Rewards are explicit, NOT the generator formula: 24 xp on top of the six
 * tutorial harvest xp lands the fulfillment at (or just past) the 30 xp
 * level-2 threshold, so the celebration and carrot reveal fire mid-tutorial
 * by design. Asking for 5 when the player holds 3 forces one more
 * plant-harvest loop - repeating the loop is the lesson.
 */
export const ONBOARDING_DELIVERY_ORDER: Order = {
  items: [{ cropId: 'sunwheat', count: 5 }],
  coinReward: 52,
  xpReward: 24,
};
