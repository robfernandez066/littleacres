/**
 * Processed goods (T4.0): things the farm MAKES, as opposed to the crops it
 * grows. Deliberately a separate registry from `data/crops.ts` and a separate
 * save map from `inventory` - goods are never CropId-keyed, so the crop
 * economy (inventory, seeds, orders, sellCrop) stays untouched as goods grow.
 *
 * All gameplay numbers live here, never in scene/system logic.
 */

/** Every processed good. A union so it extends one entry at a time. */
export type GoodId = 'sunflour';

export interface GoodDef {
  id: GoodId;
  /** Display name (user-facing). */
  name: string;
  /** Plural display name for counted UI copy ("4 Sunflour"). */
  pluralName: string;
  /**
   * Single atlas frame. A good is made, not grown, so it has no growth
   * stages - one icon covers every use (bag row, sell row, future recipes).
   */
  frame: string;
  /** Coins received per unit when sold. */
  sellValue: number;
}

/**
 * Balance numbers are provisional and will be tuned later.
 *
 * Sunflour's 25 is roughly 3x the 8-coin Sunwheat it is milled from - the
 * processing premium that makes the mill worth building.
 */
export const GOODS: Record<GoodId, GoodDef> = {
  sunflour: {
    id: 'sunflour',
    name: 'Sunflour',
    // Mass-noun plural: "4 Sunflour", never "Sunflours" - like Sunwheat.
    pluralName: 'Sunflour',
    frame: 'sunflour',
    sellValue: 25,
  },
};

/** Every good id, in registry order. */
export const GOOD_IDS = Object.keys(GOODS) as GoodId[];
