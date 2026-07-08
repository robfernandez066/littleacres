import { CROPS, type CropDef, type CropId } from './crops';

/**
 * Order board tunables and the pure order generator. All order economy
 * numbers live here, never in scene/system logic.
 */

/** Number of order slots on the board. */
export const ORDER_SLOTS = 3;

/** How long a skipped slot stays empty before a new order appears. */
export const SKIP_COOLDOWN_MS = 30_000;

/**
 * Reward multipliers over raw sell value / harvest xp. Both are > 1 so
 * fulfilling an order always beats selling the same crops directly.
 */
export const ORDER_COIN_MULTIPLIER = 1.3;
export const ORDER_XP_MULTIPLIER = 1.5;

/**
 * Chance an order is a "stretch" order teasing the next unlock: one of its
 * items is the crop unlocking at level + 1 (when such a crop exists).
 */
export const TEASER_CHANCE = 0.15;

/**
 * Chance a non-teaser order asks for two distinct crops instead of one
 * (only when at least two crops are unlocked).
 */
export const SECOND_ITEM_CHANCE = 0.45;

/** Total units requested per order: BASE + PER_LEVEL * level, split across items. */
export const ORDER_BASE_UNITS = 2;
export const ORDER_UNITS_PER_LEVEL = 2;

export interface OrderItem {
  cropId: CropId;
  count: number;
}

/**
 * One villager request. Rewards are computed at generation time from the
 * config multipliers and STORED on the order, so what the board displays and
 * what fulfillment pays can never disagree (even across balance patches).
 */
export interface Order {
  /** 1-2 entries, distinct crops, every count >= 1. */
  items: OrderItem[];
  coinReward: number;
  xpReward: number;
}

/** Uniform pick; the clamp guards rng implementations that can return 1. */
function pick<T>(pool: readonly T[], rng: () => number): T {
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
}

/**
 * Generate one order for a player at `level`. Pure: all randomness comes
 * from `rng` (a `Math.random`-like [0, 1) source), so a fixed rng sequence
 * yields a fixed order.
 *
 * Shape rules:
 * - Teaser roll first: with `teaserChance` (and only when a crop unlocks at
 *   exactly level + 1) the order pairs one unlocked crop with that teaser
 *   crop - a stretch order previewing the next unlock. Callers may override
 *   the chance (onboarding passes 0 so the first session never sees an
 *   unfulfillable stretch order).
 * - Otherwise items come from unlocked crops only: two distinct ones with
 *   SECOND_ITEM_CHANCE (when two exist), else one.
 * - Total units are ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL * level, split
 *   randomly across the items with every item getting at least 1.
 */
export function generateOrder(
  level: number,
  rng: () => number = Math.random,
  teaserChance: number = TEASER_CHANCE,
): Order {
  // Level 1 always unlocks at least one crop, so `unlocked` is never empty.
  const effectiveLevel = Math.max(1, Math.floor(level));
  const allCrops = Object.values(CROPS);
  const unlocked = allCrops.filter((crop) => crop.unlockLevel <= effectiveLevel);
  const teasers = allCrops.filter((crop) => crop.unlockLevel === effectiveLevel + 1);

  const chosen: CropDef[] = [];
  if (teasers.length > 0 && rng() < teaserChance) {
    chosen.push(pick(unlocked, rng), pick(teasers, rng));
  } else if (unlocked.length >= 2 && rng() < SECOND_ITEM_CHANCE) {
    const first = pick(unlocked, rng);
    const rest = unlocked.filter((crop) => crop.id !== first.id);
    chosen.push(first, pick(rest, rng));
  } else {
    chosen.push(pick(unlocked, rng));
  }

  const totalUnits = ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL * effectiveLevel;
  // Two-item split: first gets a uniform 1..totalUnits-1, so both items >= 1.
  const firstCount = chosen.length === 2 ? 1 + Math.floor(rng() * (totalUnits - 1)) : totalUnits;
  const counts = chosen.length === 2 ? [firstCount, totalUnits - firstCount] : [firstCount];

  const items: OrderItem[] = chosen.map((crop, i) => ({ cropId: crop.id, count: counts[i]! }));
  const coinBase = items.reduce((sum, item) => sum + item.count * CROPS[item.cropId].sellValue, 0);
  const xpBase = items.reduce((sum, item) => sum + item.count * CROPS[item.cropId].xp, 0);
  return {
    items,
    coinReward: Math.ceil(coinBase * ORDER_COIN_MULTIPLIER),
    xpReward: Math.ceil(xpBase * ORDER_XP_MULTIPLIER),
  };
}
