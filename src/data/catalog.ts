/**
 * The unified item catalog (U1): ONE list covering every placeable thing the
 * player can own - buildings, path tiers, and decorations - so the Shop, the
 * Shed, and the edit mode all read one shape instead of three registries.
 *
 * DERIVED, never authored. Every field here is read at module load out of the
 * per-system registry that already owns it (`BUILDINGS`, `PATH_TIERS`,
 * `DECOR_ITEMS`), so a price, name, level gate, or frame has exactly ONE home
 * and the catalog can never drift from it. Adding a building/tier/decoration to
 * its own registry adds it here with no edit to this file - the same
 * derived-not-restated construction as `buildingUnlockCardsForLevel`.
 *
 * Nothing in here is gameplay LOGIC: legality, collision, and placement rules
 * stay with their existing authorities in `systems/gameState.ts`. This module
 * only answers "what exists, what does it cost, and what may own it".
 */

import { BUILDINGS, type BuildingDef } from './buildings';
import { DECOR_ITEMS, type DecorItemDef } from './decor';
import { PATH_TIER_LIST, type PathTierDef } from './paths';

/** Which registry an item came from - also which placed collection it lands in. */
export type CatalogCategory = 'building' | 'path' | 'decor';

/** The currencies an item can be priced in. Union of every registry's own. */
export type CatalogCurrency = 'coins' | 'moondust';

export interface CatalogItem {
  /**
   * The item's identifier in its OWN registry - a `BuildingId`, a `PathTierId`,
   * or a decoration's atlas frame - carried through unchanged rather than
   * re-keyed, so a catalog id maps straight back to its source with no lookup
   * table to keep in sync. Ids are unique across the whole catalog (pinned by
   * test), which is what lets `shedInventory` key one flat map by them.
   */
  id: string;
  /** Display name, from the source registry. */
  name: string;
  category: CatalogCategory;
  /** Atlas frame, from the source registry. */
  frame: string;
  currency: CatalogCurrency;
  /** Price in `currency`. For a path tier this is the cost of ONE tile. */
  price: number;
  /**
   * Player level required to buy it. 0 where the source registry has no gate
   * (paths and decorations are ungated today), which reads as "always buyable"
   * since the player starts at level 1.
   */
  unlockLevel: number;
  /**
   * Whether the player may own more than one. False for buildings - today's
   * one-per-type rule (`buyBuilding`'s guard) - and true for paths and
   * decorations, which are owned in quantity by design.
   */
  allowMultiple: boolean;
}

/** No gate in the source registry - see `CatalogItem.unlockLevel`. */
const UNGATED = 0;

function buildingToCatalogItem(def: BuildingDef): CatalogItem {
  return {
    id: def.id,
    name: def.name,
    category: 'building',
    frame: def.frame,
    currency: def.currency,
    price: def.price,
    unlockLevel: def.unlockLevel,
    // One per type, exactly as `buyBuilding` already enforces.
    allowMultiple: false,
  };
}

function pathToCatalogItem(def: PathTierDef): CatalogItem {
  return {
    id: def.id,
    name: def.name,
    category: 'path',
    frame: def.frame,
    // Paths are a coin ladder (T4.13); `costCoins` is per TILE, so a quantity
    // buy is qty * this.
    currency: 'coins',
    price: def.costCoins,
    unlockLevel: UNGATED,
    allowMultiple: true,
  };
}

function decorToCatalogItem(def: DecorItemDef): CatalogItem {
  return {
    // A decoration's frame IS its save identifier (see `DecorItemDef.frame`),
    // so it is the id here too.
    id: def.frame,
    name: def.name,
    category: 'decor',
    frame: def.frame,
    currency: def.currency,
    price: def.price,
    unlockLevel: UNGATED,
    allowMultiple: true,
  };
}

/**
 * Every catalog item, grouped by category in registry order within each group.
 * TROPHIES are deliberately absent: they are quest grants, not purchases, and
 * have no price or currency to derive (see `TROPHY_ITEMS`).
 */
export const CATALOG: readonly CatalogItem[] = [
  ...Object.values(BUILDINGS).map(buildingToCatalogItem),
  ...PATH_TIER_LIST.map(pathToCatalogItem),
  ...DECOR_ITEMS.map(decorToCatalogItem),
];

/** Catalog by id - the lookup `shedInventory` reads keys against. */
export const CATALOG_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(
  CATALOG.map((item) => [item.id, item]),
);

/** Every legal catalog id - the save validator's seam, like `PATH_TIER_IDS`. */
export const CATALOG_IDS: ReadonlySet<string> = new Set(CATALOG.map((item) => item.id));

/**
 * The catalog item for `id`, or undefined if unknown - the same
 * `findBuilding`/`findPathTier` shape every registry exposes, and the arbiter
 * the validator and the shed reducers both consult.
 */
export function findCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG_BY_ID.get(id);
}

/** Every item in one category, in catalog order - the Shop's per-tab list. */
export function catalogItemsInCategory(category: CatalogCategory): CatalogItem[] {
  return CATALOG.filter((item) => item.category === category);
}
