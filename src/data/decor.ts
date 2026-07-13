/**
 * Decorations (T3.9): the moondust/coin sink and the game's first
 * self-expression system. All game data lives here, never in scene/UI logic.
 */

export type DecorCurrency = 'coins' | 'moondust';

export interface DecorItemDef {
  /** Atlas frame, also the save's placement/purchase identifier. */
  frame: string;
  /** Display name, shown in the Decor Shop. */
  name: string;
  currency: DecorCurrency;
  /** Cost in `currency` units. */
  price: number;
}

/** The 10 purchasable decorations. Balance numbers are the owner's sheet values. */
export const DECOR_ITEMS: readonly DecorItemDef[] = [
  { frame: 'decor_bench', name: 'Bench', currency: 'coins', price: 400 },
  { frame: 'decor_flowerbed', name: 'Flowerbed', currency: 'coins', price: 600 },
  { frame: 'decor_fence', name: 'Fence', currency: 'coins', price: 250 },
  { frame: 'decor_barrels', name: 'Barrels', currency: 'coins', price: 350 },
  { frame: 'decor_scarecrow', name: 'Scarecrow', currency: 'coins', price: 900 },
  { frame: 'decor_birdbath', name: 'Birdbath', currency: 'coins', price: 1200 },
  { frame: 'decor_well', name: 'Well', currency: 'coins', price: 2000 },
  { frame: 'decor_mushrooms', name: 'Mushrooms', currency: 'moondust', price: 4 },
  { frame: 'decor_gnome', name: 'Gnome', currency: 'moondust', price: 6 },
  { frame: 'decor_lantern', name: 'Lantern', currency: 'moondust', price: 8 },
];

/**
 * The 5 trophy frames: not purchasable in the shop, granted by a future
 * quest system (T3.10). Listed here so the save schema can validate a
 * placement's frame without duplicating the frame list.
 */
export const TROPHY_FRAMES = [
  'trophy_goldscarecrow',
  'trophy_starbanner',
  'trophy_moonwell',
  'trophy_traderscart',
  'trophy_ancientoak',
] as const;

/** Every frame name a saved decoration placement may legally reference. */
export const DECOR_FRAMES: ReadonlySet<string> = new Set([
  ...DECOR_ITEMS.map((item) => item.frame),
  ...TROPHY_FRAMES,
]);

export function findDecorItem(frame: string): DecorItemDef | undefined {
  return DECOR_ITEMS.find((item) => item.frame === frame);
}

/**
 * Total owned decorations (any frame), the shared cap for the farm's decor
 * clutter - placed and warehoused (T3.9b) COMBINED, checked at purchase.
 */
export const MAX_DECORATIONS = 30;

/** `setDecorationTransform` clamp bounds (the arrange mode's drag range). */
export const DECOR_X_MIN = 0;
export const DECOR_X_MAX = 1080;
export const DECOR_Y_MIN = 380;
export const DECOR_Y_MAX = 1520;
export const DECOR_SCALE_MIN = 0.35;
/**
 * The scale CEILING is also `placeFromWarehouse`'s spawn scale (owner rule,
 * 2026-07-12): art ships at its intended size - players can shrink and grow
 * back, never exceed it.
 */
export const DECOR_SCALE_MAX = 0.7;

/**
 * `placeFromWarehouse`'s spawn position (T3.9b): screen center, so a newly
 * placed item is immediately visible and ready to drag.
 */
export const WAREHOUSE_PLACE_X = 540;
export const WAREHOUSE_PLACE_Y = 900;
