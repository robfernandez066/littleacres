import { describe, expect, it } from 'vitest';

import {
  DECOR_X_MAX,
  DECOR_X_MIN,
  DECOR_Y_MAX,
  DECOR_Y_MIN,
  decorClampBounds,
  FENCE_EDGE_ANCHOR_DX,
  FENCE_EDGE_ANCHOR_DY,
  FENCE_FIXED_SCALE,
  fenceEdgeSnapDeltas,
} from './decor';
import {
  PLOT_PLACEABLE_MAX_X,
  PLOT_PLACEABLE_MAX_Y,
  PLOT_PLACEABLE_MIN_X,
  PLOT_PLACEABLE_MIN_Y,
  REGIONS,
} from './farm';

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

describe('decorClampBounds (T3.3b region-aware decoration clamp)', () => {
  it('base bounds derive from the full base plot-placeable rect (T3.3b widened clamp)', () => {
    // The legacy hand-tuned rect (x 0..1080, y 380..1520) grew to cover the
    // full BASE plot-placeable rect - west edge and south seed-bar dead band
    // respected exactly as the plot rect does. (The west bound was the "mere
    // reserve" until T4.10 absorbed it into the default buildable area; these
    // stay derived, so DECOR_X_MIN moved 20 -> -236 with it.)
    expect(DECOR_X_MIN).toBe(PLOT_PLACEABLE_MIN_X);
    expect(DECOR_X_MAX).toBe(PLOT_PLACEABLE_MAX_X);
    expect(DECOR_Y_MIN).toBe(PLOT_PLACEABLE_MIN_Y);
    expect(DECOR_Y_MAX).toBe(PLOT_PLACEABLE_MAX_Y);
  });

  it('with no region unlocked returns the base bounds', () => {
    expect(decorClampBounds([])).toEqual({
      minX: DECOR_X_MIN,
      maxX: DECOR_X_MAX,
      minY: DECOR_Y_MIN,
      maxY: DECOR_Y_MAX,
    });
  });

  it('unlocking East Meadow extends maxX east to the band edge; other edges unchanged', () => {
    const east = REGIONS.find((region) => region.id === 'east_meadow')!;
    const bounds = decorClampBounds(['east_meadow']);
    expect(bounds.maxX).toBe(east.placeableRect.maxX);
    expect(bounds.maxX).toBeGreaterThan(DECOR_X_MAX);
    // The band's y range equals the base rect's, and its west edge is the base
    // east edge, so only maxX moves.
    expect(bounds.minX).toBe(DECOR_X_MIN);
    expect(bounds.minY).toBe(DECOR_Y_MIN);
    expect(bounds.maxY).toBe(DECOR_Y_MAX);
  });

  it('ignores unknown region ids', () => {
    expect(decorClampBounds(['not_a_region'])).toEqual(decorClampBounds([]));
  });
});
