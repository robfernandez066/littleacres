import { describe, expect, it } from 'vitest';

import { findPathTier, PATH_TIER_IDS, PATH_TIER_LIST, PATH_TIERS } from './paths';

describe('path tiers (T4.12)', () => {
  it('ships gravel as a free tier on the packed gravel_path frame', () => {
    expect(PATH_TIERS.gravel).toEqual({
      id: 'gravel',
      name: 'Gravel',
      frame: 'gravel_path',
      // FREE this pass (owner decision) - paint mode still runs the full
      // deduct-and-float path so a priced tier needs no new flow.
      costCoins: 0,
    });
  });

  it('every tier is keyed by its own id, non-empty, and non-negative', () => {
    for (const [key, def] of Object.entries(PATH_TIERS)) {
      expect(def.id).toBe(key);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.frame.length).toBeGreaterThan(0);
      expect(def.costCoins).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(def.costCoins)).toBe(true);
    }
  });

  it('no tier name uses an em dash (CLAUDE.md: user-facing copy)', () => {
    for (const def of PATH_TIER_LIST) {
      expect(def.name).not.toContain('—');
    }
  });

  it('the derived list and id set cover the registry exactly', () => {
    expect(PATH_TIER_LIST).toEqual(Object.values(PATH_TIERS));
    expect([...PATH_TIER_IDS].sort()).toEqual(Object.keys(PATH_TIERS).sort());
  });

  it('findPathTier resolves a known tier and rejects an unknown one', () => {
    expect(findPathTier('gravel')).toBe(PATH_TIERS.gravel);
    expect(findPathTier('obsidian')).toBeUndefined();
    // Must not resolve inherited Object.prototype keys - the save validator
    // leans on this returning undefined for anything not a real tier.
    expect(findPathTier('toString')).toBeUndefined();
    expect(findPathTier('constructor')).toBeUndefined();
  });
});
