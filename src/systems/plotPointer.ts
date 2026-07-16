import { isoToGrid } from './iso';

/**
 * Pointer -> plot hit-testing and per-gesture dedup, shared by paint-planting
 * and sweep-harvesting. Pure logic, no Phaser dependency.
 */

/** The coordinate slice of a plot the hit-test needs (see `gameState.PlotState`). */
export interface PlotTile {
  col: number;
  row: number;
}

/**
 * Hit-test a screen position (design space) to the INDEX of the plot whose
 * tile diamond contains it, or null when the point is off every plot. Since
 * T3.3a plots carry explicit col/row (they can live on any owned tile, moved
 * at will), so this is a coordinate lookup against the plots' actual tiles in
 * the frozen iso frame - never index arithmetic. A tile with no plot on it
 * (unowned land, or an owned tile awaiting a shed plot) misses, exactly like
 * off-grid ground.
 */
export function plotIndexAtScreen(x: number, y: number, plots: readonly PlotTile[]): number | null {
  const { col, row } = isoToGrid(x, y);
  const c = Math.round(col);
  const r = Math.round(row);
  for (let index = 0; index < plots.length; index++) {
    const plot = plots[index]!;
    if (plot.col === c && plot.row === r) return index;
  }
  return null;
}

/**
 * Turns a pointer gesture (down, moves, up) into a stream of newly-entered
 * plot indices: each plot is reported AT MOST ONCE per gesture, no matter how
 * many pointer events land on it or whether acting on it succeeded. Callers
 * feed `begin` on pointerdown, `move` on pointermove, and `end` on pointerup,
 * passing the current plots each time (see `plotIndexAtScreen`).
 */
export class PlotPointerTracker {
  private readonly visited = new Set<number>();
  private active = false;

  /** Start a gesture; returns the plot under the down point, if any. */
  begin(x: number, y: number, plots: readonly PlotTile[]): number | null {
    this.active = true;
    this.visited.clear();
    return this.enter(x, y, plots);
  }

  /** Pointer moved mid-gesture; returns a newly-entered plot or null. */
  move(x: number, y: number, plots: readonly PlotTile[]): number | null {
    if (!this.active) return null;
    return this.enter(x, y, plots);
  }

  /** End the gesture (pointerup or pointer left the canvas). */
  end(): void {
    this.active = false;
    this.visited.clear();
  }

  private enter(x: number, y: number, plots: readonly PlotTile[]): number | null {
    const index = plotIndexAtScreen(x, y, plots);
    if (index === null || this.visited.has(index)) return null;
    this.visited.add(index);
    return index;
  }
}
