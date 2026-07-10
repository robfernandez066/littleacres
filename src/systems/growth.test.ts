import { describe, expect, it } from 'vitest';

import { CROP_STAGES, CROPS } from '../data/crops';
import type { GrowingPlot, PlotState } from './gameState';
import { growthFraction, isReady, secondsUntilNextReady, stageIndex } from './growth';

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
    const starcorn: GrowingPlot = { state: 'growing', cropId: 'starcorn', plantedAt: 0 };
    expect(growthFraction(starcorn, CROPS.starcorn.growMs / 4)).toBe(0.25);
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
  it('is stage 0 from planting until just under half', () => {
    expect(stageIndex(plot(), 0)).toBe(0);
    expect(stageIndex(plot(), GROW * 0.49)).toBe(0);
  });

  it('advances to stage 1 at half and holds until just under growMs', () => {
    expect(stageIndex(plot(), GROW * 0.5)).toBe(1);
    expect(stageIndex(plot(), GROW * 0.99)).toBe(1);
  });

  it('never reaches the last stage before growMs (mature sprite implies ready)', () => {
    expect(stageIndex(plot(), GROW * 0.99)).toBeLessThan(CROP_STAGES - 1);
  });

  it('reaches the last stage exactly at growMs, coinciding with isReady', () => {
    expect(stageIndex(plot(), GROW)).toBe(CROP_STAGES - 1);
    expect(isReady(plot(), GROW)).toBe(true);
  });

  it('is clamped to the last stage far past growMs', () => {
    expect(stageIndex(plot(), GROW * 100)).toBe(CROP_STAGES - 1);
  });
});

describe('secondsUntilNextReady (onboarding countdown)', () => {
  it('is null when no plot grows the crop', () => {
    const plots: PlotState[] = [{ state: 'empty' }, { state: 'empty' }];
    expect(secondsUntilNextReady(plots, 'sunwheat', 0)).toBeNull();
    const starcornOnly: PlotState[] = [{ state: 'growing', cropId: 'starcorn', plantedAt: 0 }];
    expect(secondsUntilNextReady(starcornOnly, 'sunwheat', 0)).toBeNull();
  });

  it('rounds the remaining time up to whole seconds', () => {
    // 100ms left still reads as 1s - the chip never shows 0s while growing.
    expect(secondsUntilNextReady([plot(0)], 'sunwheat', GROW - 100)).toBe(1);
    expect(secondsUntilNextReady([plot(0)], 'sunwheat', 0)).toBe(GROW / 1000);
  });

  it('tracks the SOONEST growing plot, ignoring other crops', () => {
    const plots: PlotState[] = [
      plot(10_000), // 10s late: ready at GROW + 10_000
      plot(0), // the soonest
      { state: 'growing', cropId: 'starcorn', plantedAt: -CROPS.starcorn.growMs }, // ready, wrong crop
      { state: 'empty' },
    ];
    expect(secondsUntilNextReady(plots, 'sunwheat', GROW - 5_000)).toBe(5);
  });

  it('is 0 (never negative) once the soonest plot is ready', () => {
    expect(secondsUntilNextReady([plot(0)], 'sunwheat', GROW)).toBe(0);
    expect(secondsUntilNextReady([plot(0), plot(GROW)], 'sunwheat', GROW * 10)).toBe(0);
  });
});
