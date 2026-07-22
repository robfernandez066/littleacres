import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PATH_TIER,
  findPathTier,
  PATH_TIER_IDS,
  PATH_TIER_LIST,
  PATH_TIERS,
} from './paths';

describe('path tiers (T4.12/T4.13)', () => {
  it('ships the four-rung coin ladder on its packed frames', () => {
    // Pinned to the T4.13 owner-set prices: dirt free, then 15 / 70 / 350.
    expect(PATH_TIERS.dirt).toEqual({
      id: 'dirt',
      name: 'Dirt',
      frame: 'dirt_path',
      costCoins: 0,
    });
    expect(PATH_TIERS.gravel).toEqual({
      id: 'gravel',
      name: 'Gravel',
      frame: 'gravel_path',
      // Was free in T4.12's single-tier v1; repriced as rung two of the ladder.
      costCoins: 15,
    });
    expect(PATH_TIERS.stone).toEqual({
      id: 'stone',
      name: 'Stone',
      frame: 'stone_path',
      costCoins: 70,
    });
    expect(PATH_TIERS.moonstone).toEqual({
      id: 'moonstone',
      name: 'Moonstone',
      frame: 'moonstone_path',
      costCoins: 350,
    });
  });

  it('lists the tiers cheapest to priciest, with the free rung as the default', () => {
    const costs = PATH_TIER_LIST.map((def) => def.costCoins);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    // The default must be the cheapest rung - a player who has not chosen
    // lands on something they can always afford.
    expect(PATH_TIER_LIST[0]?.id).toBe(DEFAULT_PATH_TIER);
    expect(PATH_TIERS[DEFAULT_PATH_TIER].costCoins).toBe(0);
  });

  it('gives every tier its own atlas frame', () => {
    const frames = PATH_TIER_LIST.map((def) => def.frame);
    expect(new Set(frames).size).toBe(frames.length);
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
