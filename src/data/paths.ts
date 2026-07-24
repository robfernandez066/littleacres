/**
 * Paths (T4.12): player-painted cosmetic ground tiles. All path data lives
 * here, never in scene/UI logic - a new tier is one entry in `PATH_TIERS`
 * plus its packed atlas frame, and the shop row, the paint mode, the cost
 * deduction, and the renderer all pick it up unchanged.
 *
 * Paths are PURELY cosmetic: a painted tile blocks nothing, so there is no
 * legality or collision data here (contrast `decor.ts`'s clamp bounds and
 * `farm.ts`'s placeable rects). One tile carries one tier; repainting a tile
 * replaces its tier rather than stacking.
 */

/** The path tiers, cheapest to priciest (T4.13). */
export type PathTierId = 'dirt' | 'gravel' | 'stone' | 'moonstone';

export interface PathTierDef {
  /** Tier id, also the save's per-tile identifier. */
  id: PathTierId;
  /** Display name, shown in the Paths panel. */
  name: string;
  /** Atlas frame - a 256x128 tile diamond drawn at origin (0.5, 0.5). */
  frame: string;
  /**
   * Coin price per tile, charged at SHOP BUY time - `costCoins` is the
   * catalog price a tier is bought into the shed for (U4 retired the
   * per-tile paint charge; painting now spends a tile from the shed, not
   * coins). Only `dirt` is free - it is the entry rung a player lands on,
   * and the three priced rungs above it are the coin sink (T4.13).
   */
  costCoins: number;
}

/**
 * The coin ladder (T4.13). Insertion order IS the Paths-panel row order and
 * must stay cheapest -> priciest: `PATH_TIER_LIST` derives from it, and the
 * panel's first row is what a player lands on, so `dirt` leads.
 */
export const PATH_TIERS: Readonly<Record<PathTierId, PathTierDef>> = {
  dirt: { id: 'dirt', name: 'Dirt', frame: 'dirt_path', costCoins: 0 },
  gravel: { id: 'gravel', name: 'Gravel', frame: 'gravel_path', costCoins: 15 },
  stone: { id: 'stone', name: 'Stone', frame: 'stone_path', costCoins: 70 },
  moonstone: { id: 'moonstone', name: 'Moonstone', frame: 'moonstone_path', costCoins: 350 },
};

/**
 * The DEFAULT tier - the free rung, so a player who has not chosen lands on
 * something they can always afford. Must stay the cheapest entry in
 * `PATH_TIERS` (pinned by a test in `paths.test.ts`).
 */
export const DEFAULT_PATH_TIER: PathTierId = 'dirt';

/** The tiers in Paths-panel row order. */
export const PATH_TIER_LIST: readonly PathTierDef[] = Object.values(PATH_TIERS);

/** Every tier id a saved path tile may legally reference. */
export const PATH_TIER_IDS: ReadonlySet<string> = new Set(Object.keys(PATH_TIERS));

/** Lookup by id, `undefined` for an unknown tier - the save validator's seam. */
export function findPathTier(id: string): PathTierDef | undefined {
  return PATH_TIER_IDS.has(id) ? PATH_TIERS[id as PathTierId] : undefined;
}
