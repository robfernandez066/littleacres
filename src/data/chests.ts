/**
 * Chest config (T2.23a rework). Premium orders generated at
 * CHEST_UNLOCK_LEVEL+ advertise 1-2 chests on their card and grant them the
 * instant they're fulfilled - see `data/orders.ts` (generation) and
 * `systems/gameState.ts` (granting). All values provisional.
 */

/** Player level (the cap) at which generated premium orders start carrying chests. */
export const CHEST_UNLOCK_LEVEL = 6;

/** A premium order's total requested units at or above this rolls 2 chests instead of 1. */
export const PREMIUM_TWO_CHEST_UNITS = 12;

/** Inclusive range for one chest's rolled coin reward. */
export const CHEST_COINS_MIN = 150;
export const CHEST_COINS_MAX = 400;

/** Chance one chest also rolls moondust. */
export const CHEST_MOONDUST_CHANCE = 0.5;

/** Moondust granted when a chest's moondust roll hits. */
export const CHEST_MOONDUST_AMOUNT = 1;
