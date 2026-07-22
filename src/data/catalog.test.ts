import { describe, expect, it } from 'vitest';

import { BUILDINGS } from './buildings';
import {
  CATALOG,
  CATALOG_IDS,
  catalogItemsInCategory,
  findCatalogItem,
  type CatalogItem,
} from './catalog';
import { DECOR_ITEMS, TROPHY_ITEMS } from './decor';
import { PATH_TIER_LIST } from './paths';

/**
 * The catalog is DERIVED, so every assertion here compares it against the
 * SOURCE REGISTRY rather than against a hand-copied literal: a price or level
 * changed in `buildings.ts`/`paths.ts`/`decor.ts` must flow through silently,
 * and only a real derivation bug can fail these.
 */
describe('catalog', () => {
  const byId = (id: string): CatalogItem => {
    const item = findCatalogItem(id);
    expect(item, `catalog is missing ${id}`).toBeDefined();
    return item!;
  };

  it('covers every building exactly once, matching the registry', () => {
    const items = catalogItemsInCategory('building');
    expect(items.map((item) => item.id).sort()).toEqual(Object.keys(BUILDINGS).sort());
    for (const def of Object.values(BUILDINGS)) {
      const item = byId(def.id);
      expect(item.name).toBe(def.name);
      expect(item.frame).toBe(def.frame);
      expect(item.price).toBe(def.price);
      expect(item.currency).toBe(def.currency);
      expect(item.unlockLevel).toBe(def.unlockLevel);
      // Today's one-per-type rule, the one `buyBuilding` already enforces.
      expect(item.allowMultiple).toBe(false);
      expect(item.purchasable).toBe(true);
    }
  });

  it('covers every path tier exactly once, priced per tile', () => {
    const items = catalogItemsInCategory('path');
    expect(items.map((item) => item.id)).toEqual(PATH_TIER_LIST.map((def) => def.id));
    for (const def of PATH_TIER_LIST) {
      const item = byId(def.id);
      expect(item.name).toBe(def.name);
      expect(item.frame).toBe(def.frame);
      // Per TILE - a quantity buy multiplies this.
      expect(item.price).toBe(def.costCoins);
      expect(item.currency).toBe('coins');
      // No level gate in `PATH_TIERS`.
      expect(item.unlockLevel).toBe(0);
      expect(item.allowMultiple).toBe(true);
      expect(item.purchasable).toBe(true);
    }
  });

  it('covers every purchasable decoration exactly once, matching the registry', () => {
    // Trophies share the 'decor' category (U2a) and close out the group, so the
    // purchasable decorations are this list minus its trophy tail.
    const items = catalogItemsInCategory('decor').filter((item) => item.purchasable);
    expect(items.map((item) => item.id)).toEqual(DECOR_ITEMS.map((def) => def.frame));
    for (const def of DECOR_ITEMS) {
      const item = byId(def.frame);
      expect(item.name).toBe(def.name);
      // A decoration's frame IS its id.
      expect(item.frame).toBe(def.frame);
      expect(item.price).toBe(def.price);
      expect(item.currency).toBe(def.currency);
      expect(item.unlockLevel).toBe(0);
      expect(item.allowMultiple).toBe(true);
      expect(item.purchasable).toBe(true);
    }
  });

  /**
   * Trophies joined the catalog in U2a so the shed can key them - as decor the
   * player owns but cannot buy. Every field is derived from `TROPHY_ITEMS` or
   * is the inert unpriced default; no literal frame or name is copied here.
   */
  it('includes every trophy as non-purchasable decor', () => {
    for (const def of TROPHY_ITEMS) {
      const item = byId(def.frame);
      expect(item.name).toBe(def.name);
      expect(item.category).toBe('decor');
      // A trophy's frame is its id, exactly as a decoration's is.
      expect(item.frame).toBe(def.frame);
      expect(item.id).toBe(def.frame);
      // Unpriced and ungated - inert, since nothing sells a trophy.
      expect(item.price).toBe(0);
      expect(item.currency).toBe('coins');
      expect(item.unlockLevel).toBe(0);
      expect(item.allowMultiple).toBe(true);
      expect(item.purchasable).toBe(false);
    }
  });

  /** Trophies are the ONLY non-purchasable items - nothing else opted out. */
  it('marks every non-trophy item purchasable', () => {
    const trophyFrames = new Set(TROPHY_ITEMS.map((def) => def.frame));
    for (const item of CATALOG) {
      expect(item.purchasable, `${item.id} purchasability`).toBe(!trophyFrames.has(item.id));
    }
  });

  it('holds exactly the four registries and nothing else', () => {
    expect(CATALOG).toHaveLength(
      Object.keys(BUILDINGS).length +
        PATH_TIER_LIST.length +
        DECOR_ITEMS.length +
        TROPHY_ITEMS.length,
    );
  });

  /**
   * Ids are carried through from their own registries into ONE flat namespace,
   * which is what lets `shedInventory` key a single map by them. A future
   * registry entry colliding with an existing id has to fail loudly here rather
   * than silently merge two items' shed counts.
   */
  it('has globally unique ids', () => {
    expect(CATALOG_IDS.size).toBe(CATALOG.length);
  });

  it('prices every item as a non-negative finite number', () => {
    for (const item of CATALOG) {
      expect(Number.isFinite(item.price)).toBe(true);
      expect(item.price).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(item.unlockLevel)).toBe(true);
      expect(item.unlockLevel).toBeGreaterThanOrEqual(0);
    }
  });

  it('findCatalogItem returns undefined for an unknown id', () => {
    expect(findCatalogItem('not_a_real_item')).toBeUndefined();
  });
});
