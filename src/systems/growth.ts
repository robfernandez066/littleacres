import { CROP_STAGES, CROPS, type CropId } from '../data/crops';
import type { GrowingPlot, PlotState } from './gameState';

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

/**
 * Visual stage 0..CROP_STAGES-1. The last stage is reserved for a ready crop
 * (the mature sprite must mean harvestable) - the growing period divides
 * evenly across the remaining CROP_STAGES-1 earlier stages.
 */
export function stageIndex(plot: GrowingPlot, nowMs: number): number {
  const fraction = growthFraction(plot, nowMs);
  if (fraction >= 1) return CROP_STAGES - 1;
  const growingStages = CROP_STAGES - 1;
  if (growingStages <= 0) return CROP_STAGES - 1;
  return Math.min(growingStages - 1, Math.floor(fraction * growingStages));
}

/**
 * Whole seconds (ceil, floored at 0) until the SOONEST growing plot of
 * `cropId` is ready, or null when none is growing. 0 means at least one is
 * already ready. Drives the onboarding chip's "Sunwheat growing... Ns"
 * countdown.
 */
export function secondsUntilNextReady(
  plots: readonly PlotState[],
  cropId: CropId,
  nowMs: number,
): number | null {
  let soonestMs: number | null = null;
  for (const plot of plots) {
    if (plot.state !== 'growing' || plot.cropId !== cropId) continue;
    const remaining = plot.plantedAt + CROPS[cropId].growMs - nowMs;
    if (soonestMs === null || remaining < soonestMs) soonestMs = remaining;
  }
  return soonestMs === null ? null : Math.max(0, Math.ceil(soonestMs / 1000));
}
