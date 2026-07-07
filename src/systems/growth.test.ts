import { describe, expect, it } from 'vitest';

import { CROP_STAGES, CROPS } from '../data/crops';
import type { GrowingPlot } from './gameState';
import { growthFraction, isReady, stageIndex } from './growth';

/** sunwheat: growMs 30_000, so stage boundaries fall at 10s and 20s. */
const GROW = CROPS.sunwheat.growMs;

function plot(plantedAt = 0): GrowingPlot {
  return { state: 'growing', cropId: 'sunwheat', plantedAt };
}

describe('growthFraction', () => {
  it('is 0 at the moment of planting', () => {
    expect(growthFraction(plot(), 0)).toBe(0);
  });

  it('clamps to 0 when nowMs predates plantedAt (clock skew)', () => {
    expect(growthFraction(plot(5_000), 0)).toBe(0);
  });

  it('is 0.5 halfway through', () => {
    expect(growthFraction(plot(), GROW / 2)).toBe(0.5);
  });

  it('is exactly 1 at plantedAt + growMs', () => {
    expect(growthFraction(plot(), GROW)).toBe(1);
  });

  it('clamps to 1 far past growMs (offline overshoot)', () => {
    expect(growthFraction(plot(), GROW * 100)).toBe(1);
  });

  it('uses the growMs of the planted crop', () => {
    const carrot: GrowingPlot = { state: 'growing', cropId: 'carrot', plantedAt: 0 };
    expect(growthFraction(carrot, CROPS.carrot.growMs / 4)).toBe(0.25);
  });
});

describe('isReady', () => {
  it('is false one ms before growMs', () => {
    expect(isReady(plot(), GROW - 1)).toBe(false);
  });

  it('is true at exactly growMs', () => {
    expect(isReady(plot(), GROW)).toBe(true);
  });

  it('is true long after growMs', () => {
    expect(isReady(plot(), GROW * 100)).toBe(true);
  });
});

describe('stageIndex', () => {
  it('is stage 0 from planting until the first boundary', () => {
    expect(stageIndex(plot(), 0)).toBe(0);
    expect(stageIndex(plot(), GROW / 3 - 1)).toBe(0);
  });

  it('advances to stage 1 at one third and holds until two thirds', () => {
    expect(stageIndex(plot(), GROW / 3)).toBe(1);
    expect(stageIndex(plot(), GROW / 2)).toBe(1);
    expect(stageIndex(plot(), (2 * GROW) / 3 - 1)).toBe(1);
  });

  it('reaches the last stage at two thirds', () => {
    expect(stageIndex(plot(), (2 * GROW) / 3)).toBe(CROP_STAGES - 1);
    expect(stageIndex(plot(), GROW - 1)).toBe(CROP_STAGES - 1);
  });

  it('is clamped to the last stage at and far past growMs', () => {
    expect(stageIndex(plot(), GROW)).toBe(CROP_STAGES - 1);
    expect(stageIndex(plot(), GROW * 100)).toBe(CROP_STAGES - 1);
  });
});
