import { FARM_COLS, FARM_ROWS } from '../data/farm';
import { isoToGrid } from './iso';

/**
 * Pointer -> plot hit-testing and per-gesture dedup, shared by paint-planting
 * and (next task) sweep-harvesting. Pure logic, no Phaser dependency.
 */

/**
 * Hit-test a screen position (design space) to the plot index whose tile
 * diamond contains it, or null when the point is off the farm grid.
 * Uses the project-wide convention `index = row * FARM_COLS + col`.
 */
export function plotIndexAtScreen(x: number, y: number): number | null {
  const { col, row } = isoToGrid(x, y);
  const c = Math.round(col);
  const r = Math.round(row);
  if (c < 0 || c >= FARM_COLS || r < 0 || r >= FARM_ROWS) return null;
  return r * FARM_COLS + c;
}

/**
 * Turns a pointer gesture (down, moves, up) into a stream of newly-entered
 * plot indices: each plot is reported AT MOST ONCE per gesture, no matter how
 * many pointer events land on it or whether acting on it succeeded. Callers
 * feed `begin` on pointerdown, `move` on pointermove, and `end` on pointerup.
 */
export class PlotPointerTracker {
  private readonly visited = new Set<number>();
  private active = false;

  /** Start a gesture; returns the plot under the down point, if any. */
  begin(x: number, y: number): number | null {
    this.active = true;
    this.visited.clear();
    return this.enter(x, y);
  }

  /** Pointer moved mid-gesture; returns a newly-entered plot or null. */
  move(x: number, y: number): number | null {
    if (!this.active) return null;
    return this.enter(x, y);
  }

  /** End the gesture (pointerup or pointer left the canvas). */
  end(): void {
    this.active = false;
    this.visited.clear();
  }

  private enter(x: number, y: number): number | null {
    const index = plotIndexAtScreen(x, y);
    if (index === null || this.visited.has(index)) return null;
    this.visited.add(index);
    return index;
  }
}
