import { describe, expect, it } from 'vitest';

import { FARM_COLS, FARM_MAX_ROWS, FARM_ROWS } from '../data/farm';
import { gridToIso, TILE_HEIGHT, TILE_WIDTH } from './iso';
import { plotIndexAtScreen, PlotPointerTracker, type PlotTile } from './plotPointer';

/** Plots laid out by the historical index formula (col = i % 4, row = floor(i / 4)). */
function gridPlots(count: number): PlotTile[] {
  return Array.from({ length: count }, (_, i) => ({
    col: i % FARM_COLS,
    row: Math.floor(i / FARM_COLS),
  }));
}

const BASE_PLOTS = gridPlots(FARM_COLS * FARM_ROWS);
const EXPANDED_PLOTS = gridPlots(FARM_COLS * FARM_MAX_ROWS);

describe('plotIndexAtScreen', () => {
  it('maps every tile center to its plot index for a grid-formula layout', () => {
    for (let row = 0; row < FARM_ROWS; row++) {
      for (let col = 0; col < FARM_COLS; col++) {
        const { x, y } = gridToIso(col, row);
        expect(plotIndexAtScreen(x, y, BASE_PLOTS)).toBe(row * FARM_COLS + col);
      }
    }
  });

  it('maps points inside a tile diamond, not just the exact center', () => {
    const { x, y } = gridToIso(1, 1);
    const index = 1 * FARM_COLS + 1;
    expect(plotIndexAtScreen(x + TILE_WIDTH / 8, y, BASE_PLOTS)).toBe(index);
    expect(plotIndexAtScreen(x, y - TILE_HEIGHT / 8, BASE_PLOTS)).toBe(index);
  });

  it('rejects tiles outside the plots, including an owned tile with no plot on it', () => {
    const left = gridToIso(-1, 0);
    const right = gridToIso(FARM_COLS, 0);
    const below = gridToIso(0, FARM_ROWS); // row 3: real grid tile, but no plot in BASE_PLOTS
    expect(plotIndexAtScreen(left.x, left.y, BASE_PLOTS)).toBeNull();
    expect(plotIndexAtScreen(right.x, right.y, BASE_PLOTS)).toBeNull();
    expect(plotIndexAtScreen(below.x, below.y, BASE_PLOTS)).toBeNull();
  });

  it('rejects screen positions far from the field (e.g. the seed bar)', () => {
    expect(plotIndexAtScreen(540, 1780, BASE_PLOTS)).toBeNull();
  });

  it('with 16 plots (expanded farm), accepts the 4th row and rejects past it', () => {
    const newRow = gridToIso(0, FARM_ROWS); // row index 3, the expansion row
    expect(plotIndexAtScreen(newRow.x, newRow.y, EXPANDED_PLOTS)).toBe(FARM_ROWS * FARM_COLS);
    const pastExpanded = gridToIso(0, FARM_MAX_ROWS);
    expect(plotIndexAtScreen(pastExpanded.x, pastExpanded.y, EXPANDED_PLOTS)).toBeNull();
  });

  it('follows a moved plot: hits at its new tile, misses at its old one', () => {
    const plots: PlotTile[] = [...BASE_PLOTS];
    plots[5] = { col: 2, row: 3 }; // moved from its formula tile (1, 1) to the 4th row
    const newTile = gridToIso(2, 3);
    expect(plotIndexAtScreen(newTile.x, newTile.y, plots)).toBe(5);
    const oldTile = gridToIso(1, 1);
    expect(plotIndexAtScreen(oldTile.x, oldTile.y, plots)).toBeNull();
  });

  it('finds a plot on an arbitrary tile regardless of its array position', () => {
    const plots: PlotTile[] = [
      { col: 3, row: 3 },
      { col: 0, row: 2 },
    ];
    const corner = gridToIso(3, 3);
    expect(plotIndexAtScreen(corner.x, corner.y, plots)).toBe(0);
    const other = gridToIso(0, 2);
    expect(plotIndexAtScreen(other.x, other.y, plots)).toBe(1);
  });
});

describe('PlotPointerTracker', () => {
  it('emits each plot at most once per gesture, even when re-entered', () => {
    const tracker = new PlotPointerTracker();
    const a = gridToIso(0, 0);
    const b = gridToIso(1, 0);
    expect(tracker.begin(a.x, a.y, BASE_PLOTS)).toBe(0);
    expect(tracker.move(a.x + 4, a.y, BASE_PLOTS)).toBeNull(); // still the same tile
    expect(tracker.move(b.x, b.y, BASE_PLOTS)).toBe(1);
    expect(tracker.move(a.x, a.y, BASE_PLOTS)).toBeNull(); // re-entered tile 0
    tracker.end();
  });

  it('resets visited plots between gestures', () => {
    const tracker = new PlotPointerTracker();
    const { x, y } = gridToIso(2, 1);
    const index = 1 * FARM_COLS + 2;
    expect(tracker.begin(x, y, BASE_PLOTS)).toBe(index);
    tracker.end();
    expect(tracker.begin(x, y, BASE_PLOTS)).toBe(index);
  });

  it('ignores moves when no gesture is active', () => {
    const tracker = new PlotPointerTracker();
    const { x, y } = gridToIso(0, 0);
    expect(tracker.move(x, y, BASE_PLOTS)).toBeNull();
  });

  it('tracks plots entered later even when the gesture starts off-field', () => {
    const tracker = new PlotPointerTracker();
    expect(tracker.begin(540, 1780, BASE_PLOTS)).toBeNull();
    const { x, y } = gridToIso(0, 2);
    expect(tracker.move(x, y, BASE_PLOTS)).toBe(2 * FARM_COLS);
  });

  it('tracks a moved plot at its live coordinates mid-gesture', () => {
    const tracker = new PlotPointerTracker();
    const plots: PlotTile[] = [...BASE_PLOTS];
    plots[0] = { col: 1, row: 3 };
    const moved = gridToIso(1, 3);
    expect(tracker.begin(moved.x, moved.y, plots)).toBe(0);
    const vacated = gridToIso(0, 0);
    expect(tracker.move(vacated.x, vacated.y, plots)).toBeNull(); // nothing lives there now
    tracker.end();
  });
});
