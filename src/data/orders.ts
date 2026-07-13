import { CHEST_UNLOCK_LEVEL, PREMIUM_TWO_CHEST_UNITS } from './chests';
import { CROPS, type CropDef, type CropId } from './crops';

/**
 * Order board tunables and the pure order generator. All order economy
 * numbers live here, never in scene/system logic.
 */

/** Number of order slots on the board. */
export const ORDER_SLOTS = 3;

/**
 * Skip-cooldown escalation (see `GameStateStore.skipOrder`): each consecutive
 * skip's cooldown is BASE_MS * GROWTH ** streakCount, capped at MAX_MS - the
 * sequence is 3s, 15s, 60s, 60s... A gap longer than STREAK_RESET_MS since the
 * previous skip starts the streak over at 0. Escalation is deliberately mild
 * and capped low: this game never punishes, it only gently discourages
 * skip-spamming the board for easy orders.
 */
export const SKIP_COOLDOWN_BASE_MS = 3000;
export const SKIP_COOLDOWN_GROWTH = 5;
export const SKIP_COOLDOWN_MAX_MS = 60_000;
export const SKIP_STREAK_RESET_MS = 6 * 60 * 60 * 1000;

/**
 * Reward multipliers over raw sell value / harvest xp. Both are > 1 so
 * fulfilling an order always beats selling the same crops directly.
 */
export const ORDER_COIN_MULTIPLIER = 1.3;
export const ORDER_XP_MULTIPLIER = 1.5;

/**
 * Chance an order asks for two distinct crops instead of one (only when at
 * least two crops are unlocked).
 */
export const SECOND_ITEM_CHANCE = 0.45;

/**
 * Chance an order is "premium": a rarity-tier order with a doubled unit
 * budget, a flavor line, and a moondust reward on top of the usual coins/xp.
 */
export const PREMIUM_CHANCE = 0.1;

/** Premium orders multiply the usual per-level unit budget by this much. */
export const PREMIUM_UNITS_MULT = 2;

/** Inclusive range for a premium order's moondust reward. */
export const PREMIUM_MOONDUST_MIN = 1;
export const PREMIUM_MOONDUST_MAX = 2;

/** Flavor line pool for premium orders - PM-authored copy, no em dashes. */
export const PREMIUM_FLAVORS: readonly string[] = [
  "The mayor's feast calls for your finest",
  'A traveling merchant pays in stardust',
  "For the harvest festival's grand table",
  'The healer needs these before moonrise',
  'A wedding by the mere needs provisions',
  'The night market opens at dusk',
];

/** Total units requested per order: BASE + PER_LEVEL * level, split across items. */
export const ORDER_BASE_UNITS = 2;
export const ORDER_UNITS_PER_LEVEL = 1;

/**
 * Per-crop cap on a single order item's count, applied after the split. An
 * item exceeding its crop's cap is clamped down to it - the order simply asks
 * for less overall; the clamped units are never redistributed to the other
 * item. Crops with no entry are uncapped.
 */
export const ORDER_UNIT_CAPS: Partial<Record<CropId, number>> = {
  starcorn: 5,
  glowberry: 2,
  moonroot: 3,
  emberpepper: 2,
  dewmelon: 2,
  sagesprig: 1,
};

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
  /**
   * Present only on the ~1-in-10 "premium" orders (see PREMIUM_CHANCE).
   * `chests` (T2.23a) is present only when the order was generated at
   * CHEST_UNLOCK_LEVEL+ - 1 or 2 chests, granted the instant the order is
   * fulfilled (see `systems/gameState.ts`'s `fulfillOrder`/`grantChests`).
   */
  premium?: { moondust: number; flavor: string; chests?: number };
}

/** Whether every item an order requests is covered by the given inventory counts. */
export function isOrderCoverable(
  order: Order,
  inventory: Partial<Record<CropId, number>>,
): boolean {
  return order.items.every((item) => (inventory[item.cropId] ?? 0) >= item.count);
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
 * - Premium roll first: with `premiumChance` the order becomes "premium" - a
 *   doubled unit budget plus a moondust reward and flavor line (see
 *   `Order.premium`).
 * - Items come from unlocked crops only (T2.24: teaser/stretch orders
 *   previewing the next unlock were removed - an order the player cannot yet
 *   fulfill read as a bug, not anticipation; that job belongs to the seed
 *   bar's visible locked crops instead): two distinct ones with
 *   SECOND_ITEM_CHANCE (when two exist), else one. Every generated item's
 *   crop is always at or below the player's level.
 * - Total units are ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL * level
 *   (x PREMIUM_UNITS_MULT for a premium order), split randomly across the
 *   items with every item getting at least 1, then each item is clamped to
 *   its crop's ORDER_UNIT_CAPS entry (if any) - the actual total can end up
 *   below the pre-clamp total. Rewards are computed from the final
 *   (post-clamp) items, so they always match what is displayed/paid.
 * - A premium order's moondust (one rng call, integer in
 *   [PREMIUM_MOONDUST_MIN, PREMIUM_MOONDUST_MAX]) and flavor (one rng call
 *   into PREMIUM_FLAVORS) are rolled last, after items and rewards.
 * - A premium order generated at CHEST_UNLOCK_LEVEL+ also carries
 *   `premium.chests`: 2 when the order's total requested units (summed
 *   across its final, post-clamp items) is >= PREMIUM_TWO_CHEST_UNITS, else
 *   1. Deterministic from the already-rolled items - no extra rng call.
 *   Absent below CHEST_UNLOCK_LEVEL.
 */
export function generateOrder(
  level: number,
  rng: () => number = Math.random,
  premiumChance: number = PREMIUM_CHANCE,
): Order {
  // Level 1 always unlocks at least one crop, so `unlocked` is never empty.
  const effectiveLevel = Math.max(1, Math.floor(level));
  const allCrops = Object.values(CROPS);
  const unlocked = allCrops.filter((crop) => crop.unlockLevel <= effectiveLevel);

  const isPremium = rng() < premiumChance;

  const chosen: CropDef[] = [];
  if (unlocked.length >= 2 && rng() < SECOND_ITEM_CHANCE) {
    const first = pick(unlocked, rng);
    const rest = unlocked.filter((crop) => crop.id !== first.id);
    chosen.push(first, pick(rest, rng));
  } else {
    chosen.push(pick(unlocked, rng));
  }

  const totalUnits =
    (ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL * effectiveLevel) *
    (isPremium ? PREMIUM_UNITS_MULT : 1);
  // Two-item split: first gets a uniform 1..totalUnits-1, so both items >= 1.
  const firstCount = chosen.length === 2 ? 1 + Math.floor(rng() * (totalUnits - 1)) : totalUnits;
  const counts = chosen.length === 2 ? [firstCount, totalUnits - firstCount] : [firstCount];

  // Clamp each item to its crop's cap (if any) after the split - clamped
  // units are dropped, never redistributed to the other item.
  const items: OrderItem[] = chosen.map((crop, i) => {
    const cap = ORDER_UNIT_CAPS[crop.id];
    const count = cap === undefined ? counts[i]! : Math.min(counts[i]!, cap);
    return { cropId: crop.id, count };
  });
  const coinBase = items.reduce((sum, item) => sum + item.count * CROPS[item.cropId].sellValue, 0);
  const xpBase = items.reduce((sum, item) => sum + item.count * CROPS[item.cropId].xp, 0);
  const order: Order = {
    items,
    coinReward: Math.ceil(coinBase * ORDER_COIN_MULTIPLIER),
    xpReward: Math.ceil(xpBase * ORDER_XP_MULTIPLIER),
  };
  if (isPremium) {
    const moondust =
      PREMIUM_MOONDUST_MIN + Math.floor(rng() * (PREMIUM_MOONDUST_MAX - PREMIUM_MOONDUST_MIN + 1));
    const flavor = pick(PREMIUM_FLAVORS, rng);
    order.premium = { moondust, flavor };
    if (effectiveLevel >= CHEST_UNLOCK_LEVEL) {
      const totalRequested = items.reduce((sum, item) => sum + item.count, 0);
      order.premium.chests = totalRequested >= PREMIUM_TWO_CHEST_UNITS ? 2 : 1;
    }
  }
  return order;
}
