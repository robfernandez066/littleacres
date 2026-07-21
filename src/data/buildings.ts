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

import { CROPS, type CropId } from './crops';
import { GOODS, type GoodId } from './goods';

/** Every building. A union so it extends one entry at a time. */
export type BuildingId = 'flour_mill' | 'bakery';

/**
 * What a batch EATS (T4.4): a crop out of `inventory`, or a processed good out
 * of `goods`. A union rather than a bare CropId because production chains: the
 * mill turns a crop into a good, and the bakery turns that good into another
 * one. Same discriminated shape as `OrderItem` and `SellableRef`, so every
 * reader is forced to say which map it means.
 */
export type RecipeInput = { kind: 'crop'; cropId: CropId } | { kind: 'good'; goodId: GoodId };

/**
 * A building's production recipe (T4.2a): what it eats, the good it makes, how
 * long one batch takes, and how many batches may run at once. Optional - a
 * building without one produces nothing, and `startMilling` refuses on it.
 *
 * Co-located here rather than in gameState/scene logic, like every other
 * building number: adding a second producer means adding one object, and no
 * milling constant ever appears in the store.
 */
export interface MillingRecipe {
  /** Consumed at batch START (deducted when the batch begins). */
  input: RecipeInput;
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
 * `price`, `slotUnlockCosts` and `unlockLevel` are OWNER-SET (T4.2b-r1,
 * T4.9 - mill L3, bakery L4, both inside the L8 cap so the processing chain
 * comes online early and stays reachable); the remaining milling numbers are
 * PROVISIONAL and will be balanced later.
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
    unlockLevel: 3,
    milling: {
      input: { kind: 'crop', cropId: 'sunwheat' },
      inputCount: 5,
      outputGoodId: 'sunflour',
      outputCount: 2,
      // 20 minutes: long enough that a batch is worth coming back for, short
      // enough to finish inside one sitting.
      batchMs: 1_200_000,
      slots: 3,
      // Owner-set: the mill is cheap to build (500) and its capacity is the
      // real coin sink - slot 2 at 2,000, slot 3 at 6,000.
      slotUnlockCosts: [2000, 6000],
    },
  },
  /**
   * The bakery (T4.4) - the second production building, and the first one that
   * EATS A GOOD: Sunwheat -> (mill) -> Sunflour -> (bakery) -> Bread. That is
   * the whole reason `MillingRecipe.input` is a union.
   *
   * FLAGGED FOR AN OWNER EYEBALL, same as the mill's was:
   * - footprintOffsets: the mill's (and farmhouse's) Art-Studio-tuned 2x2 as
   *   the honest baseline. The bakery art reads WIDER than the mill, so this
   *   is the likeliest thing to want a nudge once it is judged live - it may
   *   deserve a 3-wide footprint.
   * - renderOffset: DERIVED from that footprint exactly as the mill's is - the
   *   FRONT tile's anchor-relative center, i.e. footprint tile (2,1) at
   *   ((2-1)*128, (2+1)*64) = (128, 192). Identical to the mill's only because
   *   the footprint is identical; if the footprint changes this must be
   *   re-derived, and the pinning test enforces that.
   * - defaultAnchor: clear of everything a fresh farm already occupies - the
   *   mill's 2x2 at (-2,0)..(-1,1), the farmhouse at (0,-3)..(1,-2), the
   *   notice board at cols 5..7, the plot block at cols 0..3, and the expand
   *   sign. Its own tiles are (-4,-4), (-3,-4), (-4,-3) and (-3,-3), every one
   *   inside the base placeable rect (pinned by test, like the mill's).
   *
   *   Chosen for VISUAL separation too, not just a legal footprint: in the
   *   frozen iso frame a tile's screen x depends only on (col - row) and its y
   *   only on (col + row), so two buildings on the same (col - row) diagonal
   *   stack in the same screen column however far apart their tiles are. The
   *   first anchor tried here, (-5,-2), was footprint-legal but rendered at
   *   x 284 - the mill's exact column, 256px above it - so the two 256px
   *   sprites overlapped into one blob on a farm that owned both. This anchor
   *   renders at (540, 384) against the mill's (284, 768): a different
   *   diagonal AND a different row. Pinned by test.
   *
   * `unlockLevel` is OWNER-SET (T4.9): level 4, one level after the mill's 3,
   * so the chain's second link opens soon after the first and both sit inside
   * the L8 cap. `price` and every milling number are still PROVISIONAL.
   */
  bakery: {
    id: 'bakery',
    name: 'Bakery',
    frame: 'bakery',
    footprintOffsets: [
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ],
    renderOffset: { x: 128, y: 192 },
    defaultAnchor: { col: -5, row: -4 },
    price: 2000,
    currency: 'coins',
    unlockLevel: 4,
    milling: {
      input: { kind: 'good', goodId: 'sunflour' },
      inputCount: 3,
      outputGoodId: 'bread',
      outputCount: 1,
      // 30 minutes: longer than the mill's 20, since it consumes the mill's
      // own output and sits a step further up the chain.
      batchMs: 1_800_000,
      slots: 3,
      slotUnlockCosts: [4000, 12_000],
    },
  },
};

/** Every building id, in registry order. */
export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];

/**
 * The atlas frame for a recipe's input (T4.4) - a crop's ready stage, or a
 * good's icon. Kept here beside the recipe rather than in the panel, so the
 * two readers (MillPanel's strip, and any future one) cannot disagree.
 */
export function recipeInputFrame(recipe: MillingRecipe): string {
  return recipe.input.kind === 'crop'
    ? CROPS[recipe.input.cropId].stageFrames[2]
    : GOODS[recipe.input.goodId].frame;
}

/** Display name for a recipe's input, from whichever registry owns it. */
export function recipeInputName(recipe: MillingRecipe): string {
  return recipe.input.kind === 'crop'
    ? CROPS[recipe.input.cropId].name
    : GOODS[recipe.input.goodId].name;
}

/**
 * How many of a recipe's input the player holds, read from the map that owns
 * that kind. THE one place the per-kind stock lookup lives, so the panel's
 * "can I mill?" check and `startMilling`'s own gate can never disagree about
 * which map to read - the same role `orderItemHeld` plays for orders.
 */
export function recipeInputHeld(
  recipe: MillingRecipe,
  inventory: Partial<Record<CropId, number>>,
  goods: Partial<Record<GoodId, number>>,
): number {
  return recipe.input.kind === 'crop'
    ? (inventory[recipe.input.cropId] ?? 0)
    : (goods[recipe.input.goodId] ?? 0);
}

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
