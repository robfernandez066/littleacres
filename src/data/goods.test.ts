import { describe, expect, it } from 'vitest';

import { CROPS } from './crops';
import { GOOD_IDS, GOODS } from './goods';

describe('GOODS registry (T4.0)', () => {
  it('defines every good, keyed by its own id', () => {
    // RE-PIN (T4.4): 'bread' joined the registry as the bakery's output, the
    // second link in the Sunwheat -> Sunflour -> Bread chain.
    expect(Object.keys(GOODS)).toEqual(['sunflour', 'bread']);
    for (const [key, good] of Object.entries(GOODS)) {
      expect(good.id).toBe(key);
    }
  });

  it('GOOD_IDS matches the registry keys in order', () => {
    expect(GOOD_IDS).toEqual(Object.keys(GOODS));
  });

  it('sunflour is a mass noun with a single atlas frame, a sell value and an order xp', () => {
    const sunflour = GOODS.sunflour;
    expect(sunflour.name).toBe('Sunflour');
    expect(sunflour.pluralName).toBe('Sunflour');
    expect(sunflour.frame).toBe('sunflour');
    // RE-PIN (Balance Pass v2): sellValue 25 -> 40, 5x the 8-coin Sunwheat it
    // is milled from (5 Sunwheat in -> 2 Sunflour out is a +40 margin).
    expect(sunflour.sellValue).toBe(40);
    // RE-PIN (Balance Pass v2): xp 15 -> 25, still between Glowberry (20) and
    // Moonroot (55) so an order for the processed good out-earns its input
    // crop without beating the deep-tier crops.
    expect(sunflour.xp).toBe(25);
  });

  it('every good carries a positive integer order xp (T4.3)', () => {
    for (const good of Object.values(GOODS)) {
      expect(Number.isInteger(good.xp)).toBe(true);
      expect(good.xp).toBeGreaterThan(0);
      // A good is processed from a crop, so it must out-earn that crop's xp.
      expect(good.xp).toBeGreaterThan(CROPS.sunwheat.xp);
    }
  });

  it('every good carries a processing premium over the crop economy it comes from', () => {
    // Sunflour is milled from Sunwheat (8), so its 40 must beat the raw crop -
    // the premium is the whole reason to build the mill. Pinned as a floor,
    // not an exact ratio, so the balance pass can retune the multiplier.
    for (const good of Object.values(GOODS)) {
      expect(good.sellValue).toBeGreaterThan(CROPS.sunwheat.sellValue);
      expect(Number.isFinite(good.sellValue)).toBe(true);
    }
  });

  it('no good id collides with a crop id - the two registries stay disjoint', () => {
    for (const id of GOOD_IDS) {
      expect(id in CROPS).toBe(false);
    }
  });

  it('no user-facing string contains an em dash', () => {
    for (const good of Object.values(GOODS)) {
      expect(good.name).not.toContain('—');
      expect(good.pluralName).not.toContain('—');
    }
  });
});
