/**
 * Processed goods (T4.0): things the farm MAKES, as opposed to the crops it
 * grows. Deliberately a separate registry from `data/crops.ts` and a separate
 * save map from `inventory` - goods are never CropId-keyed, so the crop
 * economy (inventory, seeds, orders, sellCrop) stays untouched as goods grow.
 *
 * All gameplay numbers live here, never in scene/system logic.
 */

/** Every processed good. A union so it extends one entry at a time. */
export type GoodId = 'sunflour' | 'bread';

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
  /**
   * Xp per unit, the counterpart to `CropDef.xp` (T4.3). Crops earn theirs on
   * harvest; a good is never "harvested", so this exists purely so an ORDER
   * asking for the good can price its xp reward the same way it prices a
   * crop's - see `orderItemXp` in data/orders.ts.
   */
  xp: number;
}

/**
 * Balance Pass v2 (owner-approved, simulation-verified).
 *
 * Sunflour's 40 is 5x the 8-coin Sunwheat it is milled from - the processing
 * premium that makes the mill worth building. One batch eats 5 Sunwheat
 * (40 coins) and makes 2 Sunflour (80 coins), a +40 margin.
 */
export const GOODS: Record<GoodId, GoodDef> = {
  sunflour: {
    id: 'sunflour',
    name: 'Sunflour',
    // Mass-noun plural: "4 Sunflour", never "Sunflours" - like Sunwheat.
    pluralName: 'Sunflour',
    frame: 'sunflour',
    sellValue: 40,
    // Above Sunwheat's 2 and between Glowberry (20) and Moonroot (55) - a
    // processed good is worth more than the crop it eats, but an order for it
    // should not out-earn the deep-tier crops.
    xp: 25,
  },
  /**
   * Bread (T4.4): the second link in the production chain - the bakery bakes
   * it from Sunflour, which the mill milled from Sunwheat. Its numbers sit
   * above Sunflour's for the same reason Sunflour's sit above Sunwheat's: each
   * processing step costs time and capacity, so each must pay better.
   * Provisional, to be balanced with the bakery's throughput.
   */
  bread: {
    id: 'bread',
    name: 'Bread',
    // A count noun, unlike the two mass nouns above: "3 Loaves", not "3 Bread".
    pluralName: 'Loaves',
    frame: 'bread',
    /**
     * The bakery eats 3 Sunflour (3 x 40 = 120 coins of input) per loaf, so the
     * loaf must clear 120 or baking would destroy value and no player should
     * ever do it. 200 leaves a +80 margin - the second link's processing
     * premium, twice the mill's own +40 for a step that takes 30 minutes and
     * consumes the mill's output. The sweep test 'EVERY production building is
     * profitable' pins the invariant rather than this exact figure.
     */
    sellValue: 200,
    /** Raised with sellValue for the same reason: 3 x 25 = 75 xp of input in. */
    xp: 90,
  },
};

/** Every good id, in registry order. */
export const GOOD_IDS = Object.keys(GOODS) as GoodId[];
