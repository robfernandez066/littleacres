/**
 * Chest config (T2.23a rework). Premium orders generated at
 * CHEST_UNLOCK_LEVEL+ advertise 1-2 chests on their card and grant them the
 * instant they're fulfilled - see `data/orders.ts` (generation) and
 * `systems/gameState.ts` (granting). All values provisional.
 */

/** Player level (the cap) at which generated premium orders start carrying chests. */
export const CHEST_UNLOCK_LEVEL = 6;

/**
 * A premium order whose coinReward is at or above this rolls 2 chests instead
 * of 1 (T3.22 - the old raw-unit threshold was only reachable by Sunwheat).
 *
 * T4.11-fix: 1500 -> 1000. Balance Pass v2 cut the deep-crop sell values while
 * raising this, which put the tier out of reach entirely - the richest order
 * the generator can produce pays 1280, so 2 chests could never fire. At 1000
 * the top ~7% of chest-eligible (L6+) premium orders roll 2 (sim-confirmed
 * 6.7%). Pinned by the reachability sweep in data/orders.test.ts.
 */
export const PREMIUM_TWO_CHEST_COIN_VALUE = 1000;

/** Inclusive range for one chest's rolled coin reward. */
export const CHEST_COINS_MIN = 150;
export const CHEST_COINS_MAX = 400;

/** Chance one chest also rolls moondust. */
export const CHEST_MOONDUST_CHANCE = 0.25;

/** Moondust granted when a chest's moondust roll hits. */
export const CHEST_MOONDUST_AMOUNT = 1;
