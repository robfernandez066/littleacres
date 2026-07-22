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

/** The path tiers. v1 ships gravel only; stone/moonstone slot in here. */
export type PathTierId = 'gravel';

export interface PathTierDef {
  /** Tier id, also the save's per-tile identifier. */
  id: PathTierId;
  /** Display name, shown in the Paths panel. */
  name: string;
  /** Atlas frame - a 256x128 tile diamond drawn at origin (0.5, 0.5). */
  frame: string;
  /**
   * Coins deducted per painted tile. Gravel is FREE this pass (owner
   * decision), but paint mode still runs the full deduct-and-float path so a
   * priced tier needs no new flow - see `GameStateStore.paintPath`.
   */
  costCoins: number;
}

export const PATH_TIERS: Readonly<Record<PathTierId, PathTierDef>> = {
  gravel: { id: 'gravel', name: 'Gravel', frame: 'gravel_path', costCoins: 0 },
};

/** The tiers in Paths-panel row order. */
export const PATH_TIER_LIST: readonly PathTierDef[] = Object.values(PATH_TIERS);

/** Every tier id a saved path tile may legally reference. */
export const PATH_TIER_IDS: ReadonlySet<string> = new Set(Object.keys(PATH_TIERS));

/** Lookup by id, `undefined` for an unknown tier - the save validator's seam. */
export function findPathTier(id: string): PathTierDef | undefined {
  return PATH_TIER_IDS.has(id) ? PATH_TIERS[id as PathTierId] : undefined;
}
