/**
 * Buildings (T4.1): placeable, anchor-based structures the player BUYS, as
 * opposed to the two fixed `structures` (farmhouse / notice board) every save
 * is born with and the free-form, non-blocking `decorations` it dresses the
 * lawn with. A building is bought at a level gate, lives in its own
 * `state.buildings` collection, blocks its footprint tiles like a structure,
 * and moves in arrange mode like one.
 *
 * Unlike the parallel `Record<StructureId, ...>` tables in config.ts, every
 * number for a building is CO-LOCATED in its own def here - a growing roster
 * stays readable when adding a building means adding one object, not editing
 * four tables in lockstep.
 *
 * All gameplay numbers live here, never in scene/system logic.
 */

import type { CropId } from './crops';
import type { GoodId } from './goods';

/** Every building. A union so it extends one entry at a time. */
export type BuildingId = 'flour_mill';

/**
 * A building's production recipe (T4.2a): the crop it eats, the good it makes,
 * how long one batch takes, and how many batches may run at once. Optional -
 * a building without one produces nothing, and `startMilling` refuses on it.
 *
 * Co-located here rather than in gameState/scene logic, like every other
 * building number: adding a second producer means adding one object, and no
 * milling constant ever appears in the store.
 */
export interface MillingRecipe {
  /** Crop consumed at batch START (deducted when the batch begins). */
  inputCropId: CropId;
  inputCount: number;
  /** Good granted on manual collect, once the batch is ready. */
  outputGoodId: GoodId;
  outputCount: number;
  /** Real-clock batch duration. `readyAt` = startedAt + this, never stored. */
  batchMs: number;
  /** Maximum concurrent batches, once every slot has been unlocked. */
  slots: number;
  /**
   * Coin cost to unlock each slot PAST the first (T4.2b-r1) - a building is
   * born with ONE usable slot and the rest are bought, so `length` is
   * `slots - 1` and `slotUnlockCosts[i]` is the price of the (i + 2)th slot.
   * Unlocks are sequential: the store refuses slot 3 before slot 2.
   */
  slotUnlockCosts: number[];
}

export interface BuildingDef {
  id: BuildingId;
  /** Display name (user-facing). */
  name: string;
  /** Single atlas frame - packed structure-class (256 square), like `farmhouse`. */
  frame: string;
  /**
   * Blocked tiles RELATIVE to the building's anchor, the same anchor-relative
   * convention as STRUCTURE_FOOTPRINT_OFFSETS (config.ts). The anchor tile
   * (offset (0,0)) is a pure reference point and need not be in the set.
   */
  footprintOffsets: readonly { col: number; row: number }[];
  /**
   * Pixel delta from the anchor tile's CENTER to the building's GROUND point -
   * where the building's base meets the ground (the T3.27 base-anchored
   * convention STRUCTURE_RENDER_OFFSETS follows).
   */
  renderOffset: { x: number; y: number };
  /** The anchor a freshly bought building is placed at. */
  defaultAnchor: { col: number; row: number };
  price: number;
  currency: 'coins';
  /** Player level required to buy it (below it, the purchase refuses). */
  unlockLevel: number;
  /**
   * Production recipe (T4.2a), if this building makes anything. Absent for a
   * purely decorative/functional building - `startMilling` refuses without it.
   */
  milling?: MillingRecipe;
}

/**
 * The flour mill (T4.1) - the first building. Inert this task: it is placed
 * and moved, but mills nothing (T4.2 adds the milling loop).
 *
 * FLAGGED FOR AN OWNER EYEBALL - `footprintOffsets` and `renderOffset` are a
 * measured starting point, not an art ruling, and the owner refines them the
 * way the structure footprints were refined (Art Studio change request):
 *
 * - footprintOffsets: the farmhouse's Art-Studio-tuned 2x2 block, offsets
 *   (1,0),(2,0),(1,1),(2,1). `flour_mill.png` is staged at the same 512x512 as
 *   `farmhouse.png` and packs through the identical 256-square path, so the
 *   two buildings cover the same ground at the same display height - the 2x2
 *   is the honest baseline until the art is judged live.
 * - renderOffset: DERIVED from that footprint rather than hand-nudged. In the
 *   frozen iso frame (tile centers at 540 + (col-row)*128, 768 + (col+row)*64)
 *   the block's four tile centers sit at anchor-relative (128,64), (256,128),
 *   (0,128) and (128,192); (128, 192) is the FRONT tile's center, i.e. the
 *   ground point lands exactly on the center of footprint tile (2,1). That
 *   satisfies "the base sits on the footprint" by construction (pinned by
 *   test) instead of by measurement luck, which is what the farmhouse's
 *   hand-tuned (137, 219) has to be re-verified for whenever its art moves.
 *
 * `price` and `slotUnlockCosts` are OWNER-SET (T4.2b-r1); unlockLevel and the
 * remaining milling numbers are PROVISIONAL and will be balanced later.
 */
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  flour_mill: {
    id: 'flour_mill',
    name: 'Flour Mill',
    frame: 'flour_mill',
    footprintOffsets: [
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ],
    renderOffset: { x: 128, y: 192 },
    // West of the plot block (plots start at col 0) and clear of the
    // farmhouse (rows -3..-2), the notice board (cols 5..7) and the expand
    // sign: the 2x2 at this anchor is tiles (-2,0), (-1,0), (-2,1), (-1,1),
    // every one of them inside the base placeable rect (pinned by test).
    defaultAnchor: { col: -3, row: 0 },
    price: 500,
    currency: 'coins',
    unlockLevel: 6,
    milling: {
      inputCropId: 'sunwheat',
      inputCount: 5,
      outputGoodId: 'sunflour',
      outputCount: 2,
      // 20 minutes: long enough that a batch is worth coming back for, short
      // enough to finish inside one sitting.
      batchMs: 1_200_000,
      slots: 3,
      // Owner-set: the mill is cheap to build (500) and its capacity is the
      // real coin sink - slot 2 at 2,500, slot 3 at 10,000.
      slotUnlockCosts: [2500, 10_000],
    },
  },
};

/** Every building id, in registry order. */
export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];

/**
 * One level-up celebration card, shaped like `GoalUnlockCard` (data/goals.ts)
 * and `SYSTEM_UNLOCK_CARDS` (data/levels.ts) so LevelUpCelebration can
 * concatenate all three without caring which produced which. `iconScale` is
 * the one addition: a building's `frame` is a 256 structure frame where the
 * others are 128 crop/system frames, so it needs its own scale to sit in the
 * card slot at the same visual size.
 */
export interface BuildingUnlockCard {
  iconFrame: string;
  label: string;
  iconScale: number;
}

/**
 * Half the card icon scale the 128 frames use, so a 256 building frame renders
 * at the same on-card size as a crop icon: 256 * (1.3 / 2) == 128 * 1.3.
 */
export const BUILDING_CARD_ICON_SCALE = 0.65;

/**
 * The celebration cards announcing that a building just became buyable
 * (T4.2d): one per building whose `unlockLevel` is exactly `level`, so it
 * fires on the level-up that opens the gate and on no other level.
 *
 * Derived from BUILDINGS, so a future building announces itself with no new
 * code - the same construction (and the same reason) as
 * `regionUnlockCardsForLevel`. Kept in this Phaser-free data module so it
 * stays directly unit-testable.
 */
export function buildingUnlockCardsForLevel(level: number): BuildingUnlockCard[] {
  return Object.values(BUILDINGS)
    .filter((def) => def.unlockLevel === level)
    .map((def) => ({
      iconFrame: def.frame,
      label: `${def.name} available in the Shop!`,
      iconScale: BUILDING_CARD_ICON_SCALE,
    }));
}

/** The building def for `id`, or undefined if unknown (the validator's arbiter). */
export function findBuilding(id: string): BuildingDef | undefined {
  return Object.prototype.hasOwnProperty.call(BUILDINGS, id)
    ? BUILDINGS[id as BuildingId]
    : undefined;
}
