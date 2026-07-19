/**
 * Restoration Chapter (T3.25) - one-time, permanent building upgrades bought
 * with coins + moondust. The farmhouse is the first (and so far only) one.
 *
 * A restoration is a pure ART SWAP plus a passive perk: it never moves a
 * structure, changes a footprint, or touches the placement rules. State is one
 * 0/1 flag per structure (`GameStateData.restoration`), so a save is either
 * un-restored (the look every existing player has) or restored, with no
 * in-between and no way back.
 */

/** One restoration upgrade's price. Both currencies are spent together. */
export interface RestorationCost {
  coins: number;
  moondust: number;
}

/**
 * Farmhouse restoration price. Starting values - deliberately a long-horizon
 * goal rather than an early purchase; expected to be tuned once there is real
 * play data on coin/moondust income.
 */
export const RESTORE_FARMHOUSE_COST: RestorationCost = {
  coins: 50000,
  moondust: 20,
};

/**
 * Homestead luck (T3.25): the restored farmhouse's passive perk. Multiplies
 * the Radiant harvest proc chance (data/moondust.ts RADIANT_CHANCE) - 1.25 =
 * radiants land 25% more often. Applies only while
 * `restoration.farmhouse === 1`; always on, with no UI toggle and no timer.
 * The Radiant YIELD and its moondust roll are untouched, so this makes good
 * harvests more frequent, never bigger.
 */
export const HOMESTEAD_LUCK_MULT = 1.25;

/**
 * THE effective Radiant chance (T3.25) - the single place the perk is applied,
 * so the store and its tests can never disagree about it.
 */
export function effectiveRadiantChance(baseChance: number, farmhouseRestored: boolean): number {
  return farmhouseRestored ? baseChance * HOMESTEAD_LUCK_MULT : baseChance;
}

/**
 * Atlas frames for the farmhouse's two looks. The restored frame is packed
 * against the base one (tools/pack-atlas.mjs processRestoredFarmhouse): same
 * width, same building size and base row, taller only by the overhang its
 * floating moon needs. FarmScene renders both at the SAME scale and offsets
 * the restored one up by half the extra height, so the building lands
 * pixel-identically and only the moon sits higher.
 */
export const FARMHOUSE_FRAME = 'farmhouse';
export const FARMHOUSE_RESTORED_FRAME = 'farmhouse_restored';

/**
 * The cast-shadow companion BOTH looks use (T3.25). The restored building has
 * the same base footprint, so it deliberately has no `_shadow` frame of its
 * own - see SHADOWED_FRAME_NAMES in tools/pack-atlas.mjs.
 */
export const FARMHOUSE_SHADOW_FRAME = 'farmhouse_shadow';

/** Copy for the Restore the Homestead panel. No em dashes (house style). */
export const RESTORE_PANEL_TITLE = 'Restore the Homestead';
export const RESTORE_PANEL_BLURB =
  'Bring the old farmhouse back to life - flowers at every window,\nlanterns lit, and a moon that watches over the field.';
export const RESTORE_PANEL_PERK = `Homestead luck: Radiant harvests ${Math.round(
  (HOMESTEAD_LUCK_MULT - 1) * 100,
)}% more often`;
export const RESTORE_PANEL_OWNED = 'Restored - the homestead is flourishing';
export const RESTORE_PANEL_BUTTON = 'Restore';
export const RESTORE_PANEL_ENTRY_BUTTON = 'Restore the Homestead';
/** Shown under the Buy button when the player cannot afford it yet. */
export const RESTORE_PANEL_SHORT = 'Not enough yet - keep farming';
