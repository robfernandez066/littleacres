import { describe, expect, it } from 'vitest';

import {
  FENCE_EDGE_ANCHOR_DX,
  FENCE_EDGE_ANCHOR_DY,
  FENCE_FIXED_SCALE,
  fenceEdgeSnapDeltas,
} from './decor';

/** The standard tile diamond (systems/iso TILE_WIDTH/TILE_HEIGHT). */
const TILE_WIDTH = 256;
const TILE_HEIGHT = 128;

describe('fenceEdgeSnapDeltas (plot-edge snap anchors, T3.3a2-r1)', () => {
  it('derives the anchor offsets from the measured high-post geometry at FENCE_FIXED_SCALE', () => {
    // High post: frame body center x 24, base y 77; anchor is the frame
    // center (64, 64) - see the derivation comment in decor.ts.
    expect(FENCE_EDGE_ANCHOR_DX).toBeCloseTo((64 - 24) * FENCE_FIXED_SCALE, 10);
    expect(FENCE_EDGE_ANCHOR_DY).toBeCloseTo(-(77 - 64) * FENCE_FIXED_SCALE, 10);
  });

  it('unflipped: exactly two candidates - the NE (top-corner) and SW (left-corner) edges', () => {
    const deltas = fenceEdgeSnapDeltas(false, TILE_WIDTH, TILE_HEIGHT);
    expect(deltas).toHaveLength(2);
    const [ne, sw] = deltas;
    expect(ne![0]).toBeCloseTo(48, 10);
    expect(ne![1]).toBeCloseTo(-79.6, 10);
    expect(sw![0]).toBeCloseTo(-80, 10);
    expect(sw![1]).toBeCloseTo(-15.6, 10);
  });

  it('flipped: exactly two candidates - the NW (top-corner) and SE (right-corner) edges, x-mirrored', () => {
    const deltas = fenceEdgeSnapDeltas(true, TILE_WIDTH, TILE_HEIGHT);
    expect(deltas).toHaveLength(2);
    const [nw, se] = deltas;
    expect(nw![0]).toBeCloseTo(-48, 10);
    expect(nw![1]).toBeCloseTo(-79.6, 10);
    expect(se![0]).toBeCloseTo(80, 10);
    expect(se![1]).toBeCloseTo(-15.6, 10);
  });

  it('mirror symmetry: flipped candidates are the unflipped ones with x negated', () => {
    const unflipped = fenceEdgeSnapDeltas(false, TILE_WIDTH, TILE_HEIGHT);
    const flipped = fenceEdgeSnapDeltas(true, TILE_WIDTH, TILE_HEIGHT);
    for (let i = 0; i < unflipped.length; i++) {
      expect(flipped[i]![0]).toBeCloseTo(-unflipped[i]![0], 10);
      expect(flipped[i]![1]).toBeCloseTo(unflipped[i]![1], 10);
    }
  });
});
