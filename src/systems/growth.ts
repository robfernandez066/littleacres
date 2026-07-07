import { CROP_STAGES, CROPS } from '../data/crops';
import type { GrowingPlot } from './gameState';

/**
 * Pure growth math. Readiness is always derived from `plantedAt + growMs`
 * against a caller-supplied timestamp - nothing here reads a clock, so tests
 * never need fake timers. Callers pass `now()` from systems/time.ts.
 */

/** Growth progress 0..1, clamped at both ends. */
export function growthFraction(plot: GrowingPlot, nowMs: number): number {
  const { growMs } = CROPS[plot.cropId];
  if (growMs <= 0) return 1;
  const fraction = (nowMs - plot.plantedAt) / growMs;
  return Math.min(1, Math.max(0, fraction));
}

/** A growing plot is ready exactly when the full grow time has elapsed. */
export function isReady(plot: GrowingPlot, nowMs: number): boolean {
  return growthFraction(plot, nowMs) >= 1;
}

/** Visual stage 0..CROP_STAGES-1; a ready crop is always the last stage. */
export function stageIndex(plot: GrowingPlot, nowMs: number): number {
  return Math.min(CROP_STAGES - 1, Math.floor(growthFraction(plot, nowMs) * CROP_STAGES));
}
