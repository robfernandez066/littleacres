import { describe, expect, it } from 'vitest';

import { MUSIC_TRACKS, nextTrackIndex } from './audio';

/** Deterministic PRNG (mulberry32) so bag-shuffle tests are reproducible. */
function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_INDICES = MUSIC_TRACKS.map((_, index) => index);

describe('nextTrackIndex', () => {
  it('reshuffles a fresh bag of every track index when the bag is empty', () => {
    const { index, bag } = nextTrackIndex([], null, makeRng(1));
    const drawn = [index, ...bag].sort((a, b) => a - b);
    expect(drawn).toEqual(ALL_INDICES);
  });

  it("the reshuffled bag's first pick never equals lastPlayed", () => {
    for (let seed = 0; seed < 500; seed++) {
      const lastPlayed = seed % MUSIC_TRACKS.length;
      const { index } = nextTrackIndex([], lastPlayed, makeRng(seed));
      expect(index).not.toBe(lastPlayed);
    }
  });

  it('a non-empty bag is drawn from as-is, without reshuffling', () => {
    const { index, bag } = nextTrackIndex([2, 0], 1, makeRng(7));
    expect(index).toBe(2);
    expect(bag).toEqual([0]);
  });

  it('draws every index exactly once before any repeat within a cycle', () => {
    let bag: number[] = [];
    let lastPlayed: number | null = null;
    const seen = new Set<number>();
    for (let i = 0; i < MUSIC_TRACKS.length; i++) {
      const draw = nextTrackIndex(bag, lastPlayed, makeRng(i + 1));
      expect(seen.has(draw.index)).toBe(false);
      seen.add(draw.index);
      bag = draw.bag;
      lastPlayed = draw.index;
    }
    expect(seen.size).toBe(MUSIC_TRACKS.length);
  });

  it('never repeats the same track back to back across a cycle boundary', () => {
    let bag: number[] = [];
    let lastPlayed: number | null = null;
    let previousCycleLast: number | null = null;
    for (let cycle = 0; cycle < 100; cycle++) {
      for (let i = 0; i < MUSIC_TRACKS.length; i++) {
        const draw = nextTrackIndex(bag, lastPlayed, makeRng(cycle * 97 + i + 3));
        if (i === 0 && previousCycleLast !== null) {
          expect(draw.index).not.toBe(previousCycleLast);
        }
        bag = draw.bag;
        lastPlayed = draw.index;
      }
      previousCycleLast = lastPlayed;
    }
  });
});
