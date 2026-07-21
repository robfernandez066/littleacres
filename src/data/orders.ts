import { CHEST_UNLOCK_LEVEL, PREMIUM_TWO_CHEST_COIN_VALUE } from './chests';
import { CROPS, type CropId } from './crops';
import { GOODS, type GoodId } from './goods';

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

/**
 * Per-good cap on a single order item's count (T4.3), the goods counterpart to
 * ORDER_UNIT_CAPS. Kept LOW and separate on purpose: a good is milled in slow
 * batches (20 minutes for 2 Sunflour), so an order asking for a crop-sized
 * pile would sit unfulfillable for hours. Provisional, will be balanced with
 * the mill's throughput.
 */
export const ORDER_GOOD_UNIT_CAPS: Partial<Record<GoodId, number>> = {
  sunflour: 2,
  // Bread (T4.4) is capped at ONE: a loaf is 3 Sunflour plus a 30-minute bake,
  // so it is the slowest thing on the farm to produce and even two would make
  // an order a multi-hour commitment.
  bread: 1,
};

/**
 * One thing an order asks for: a crop out of `inventory`, or a processed good
 * out of `goods` (T4.3). A discriminated union rather than an optional field,
 * so every consumer is forced to say which map it means - the same reason
 * `SellableRef` (ui/InventoryPanel.ts) is shaped this way.
 */
export type OrderItem =
  { kind: 'crop'; cropId: CropId; count: number } | { kind: 'good'; goodId: GoodId; count: number };

/** Coins one UNIT of this item is worth, from whichever registry owns it. */
export function orderItemSellValue(item: OrderItem): number {
  return item.kind === 'crop' ? CROPS[item.cropId].sellValue : GOODS[item.goodId].sellValue;
}

/** Xp one UNIT of this item is worth, from whichever registry owns it. */
export function orderItemXp(item: OrderItem): number {
  return item.kind === 'crop' ? CROPS[item.cropId].xp : GOODS[item.goodId].xp;
}

/** Display name for this item, from whichever registry owns it. */
export function orderItemName(item: OrderItem): string {
  return item.kind === 'crop' ? CROPS[item.cropId].name : GOODS[item.goodId].name;
}

/** Display name for `count` of this item, singular/plural per its own registry. */
export function orderItemCountedName(item: OrderItem, count: number): string {
  const def = item.kind === 'crop' ? CROPS[item.cropId] : GOODS[item.goodId];
  return count === 1 ? def.name : def.pluralName;
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

/**
 * How many of `item` the player holds, read from the map that owns that kind
 * (T4.3) - crops from `inventory`, goods from `goods`. THE one place the
 * per-kind stock lookup lives, so coverage checks and consumption can never
 * disagree about which map to read.
 */
export function orderItemHeld(
  item: OrderItem,
  inventory: Partial<Record<CropId, number>>,
  goods: Partial<Record<GoodId, number>>,
): number {
  return item.kind === 'crop' ? (inventory[item.cropId] ?? 0) : (goods[item.goodId] ?? 0);
}

/**
 * Whether every item an order requests is covered by the player's stock -
 * each item checked against the right map (T4.3).
 */
export function isOrderCoverable(
  order: Order,
  inventory: Partial<Record<CropId, number>>,
  goods: Partial<Record<GoodId, number>> = {},
): boolean {
  return order.items.every((item) => orderItemHeld(item, inventory, goods) >= item.count);
}

/**
 * One thing the generator may request, normalized across the two registries
 * (T4.3) so the shape rules below - the two-item draw, the unit split, the
 * cap clamp, the reward sums - run on ONE descriptor and never branch on kind.
 * `key` is only for the distinctness filter on the second draw; crop ids and
 * good ids are disjoint (pinned by test in data/goods.test.ts).
 */
interface Requestable {
  key: string;
  /** The item this becomes, minus its count. */
  ref:
    | Omit<Extract<OrderItem, { kind: 'crop' }>, 'count'>
    | Omit<Extract<OrderItem, { kind: 'good' }>, 'count'>;
  sellValue: number;
  xp: number;
  /** Per-unit cap from ORDER_UNIT_CAPS / ORDER_GOOD_UNIT_CAPS; undefined = uncapped. */
  cap: number | undefined;
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
 * - Items come from unlocked crops (T2.24: teaser/stretch orders previewing
 *   the next unlock were removed - an order the player cannot yet fulfill read
 *   as a bug, not anticipation; that job belongs to the seed bar's visible
 *   locked crops instead) PLUS `availableGoods` (T4.3 - the goods the player
 *   can currently PRODUCE, i.e. owns a building that makes them). Two distinct
 *   entries with SECOND_ITEM_CHANCE (when two exist), else one. Every
 *   generated crop is at or below the player's level, and a good the player
 *   cannot make never enters the pool, so no order is ever unfulfillable by
 *   construction. Passing no `availableGoods` reproduces the crop-only
 *   behavior exactly, byte for byte, for a given rng sequence.
 * - Total units are ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL * level
 *   (x PREMIUM_UNITS_MULT for a premium order), split randomly across the
 *   items with every item getting at least 1, then each item is clamped to its
 *   own cap if it has one (ORDER_UNIT_CAPS for a crop, ORDER_GOOD_UNIT_CAPS
 *   for a good) - the actual total can end up below the pre-clamp total.
 *   Rewards are computed from the final (post-clamp) items, so they always
 *   match what is displayed/paid.
 * - A premium order's moondust (one rng call, integer in
 *   [PREMIUM_MOONDUST_MIN, PREMIUM_MOONDUST_MAX]) and flavor (one rng call
 *   into PREMIUM_FLAVORS) are rolled last, after items and rewards.
 * - A premium order generated at CHEST_UNLOCK_LEVEL+ also carries
 *   `premium.chests`: 2 when the order's coinReward is >=
 *   PREMIUM_TWO_CHEST_COIN_VALUE, else 1. Deterministic from the
 *   already-computed reward - no extra rng call. Absent below
 *   CHEST_UNLOCK_LEVEL.
 */
export function generateOrder(
  level: number,
  rng: () => number = Math.random,
  premiumChance: number = PREMIUM_CHANCE,
  availableGoods: readonly GoodId[] = [],
): Order {
  // Level 1 always unlocks at least one crop, so the pool is never empty.
  const effectiveLevel = Math.max(1, Math.floor(level));

  // Crops first (registry order, exactly as before), then whichever goods the
  // player can currently PRODUCE - an empty `availableGoods` reproduces the
  // pre-T4.3 crop-only pool identically, which is what keeps a mill-less save
  // from ever seeing a Sunflour order.
  const pool: Requestable[] = [
    ...Object.values(CROPS)
      .filter((crop) => crop.unlockLevel <= effectiveLevel)
      .map<Requestable>((crop) => ({
        key: crop.id,
        ref: { kind: 'crop', cropId: crop.id },
        sellValue: crop.sellValue,
        xp: crop.xp,
        cap: ORDER_UNIT_CAPS[crop.id],
      })),
    ...availableGoods.map<Requestable>((goodId) => ({
      key: goodId,
      ref: { kind: 'good', goodId },
      sellValue: GOODS[goodId].sellValue,
      xp: GOODS[goodId].xp,
      cap: ORDER_GOOD_UNIT_CAPS[goodId],
    })),
  ];

  const isPremium = rng() < premiumChance;

  const chosen: Requestable[] = [];
  if (pool.length >= 2 && rng() < SECOND_ITEM_CHANCE) {
    const first = pick(pool, rng);
    const rest = pool.filter((entry) => entry.key !== first.key);
    chosen.push(first, pick(rest, rng));
  } else {
    chosen.push(pick(pool, rng));
  }

  const totalUnits =
    (ORDER_BASE_UNITS + ORDER_UNITS_PER_LEVEL * effectiveLevel) *
    (isPremium ? PREMIUM_UNITS_MULT : 1);
  // Two-item split: first gets a uniform 1..totalUnits-1, so both items >= 1.
  const firstCount = chosen.length === 2 ? 1 + Math.floor(rng() * (totalUnits - 1)) : totalUnits;
  const counts = chosen.length === 2 ? [firstCount, totalUnits - firstCount] : [firstCount];

  // Clamp each item to its own cap (if any) after the split - clamped units
  // are dropped, never redistributed to the other item.
  const items: OrderItem[] = chosen.map((entry, i) => {
    const count = entry.cap === undefined ? counts[i]! : Math.min(counts[i]!, entry.cap);
    return { ...entry.ref, count };
  });
  const coinBase = items.reduce((sum, item) => sum + item.count * orderItemSellValue(item), 0);
  const xpBase = items.reduce((sum, item) => sum + item.count * orderItemXp(item), 0);
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
      order.premium.chests = order.coinReward >= PREMIUM_TWO_CHEST_COIN_VALUE ? 2 : 1;
    }
  }
  return order;
}
