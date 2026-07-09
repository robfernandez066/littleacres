import { describe, expect, it } from 'vitest';

import { FARM_COLS, FARM_ROWS } from '../data/farm';
import { gridToIso, TILE_HEIGHT, TILE_WIDTH } from './iso';
import { plotIndexAtScreen, PlotPointerTracker } from './plotPointer';

describe('plotIndexAtScreen', () => {
  it('maps every tile center to its plot index (row * FARM_COLS + col)', () => {
    for (let row = 0; row < FARM_ROWS; row++) {
      for (let col = 0; col < FARM_COLS; col++) {
        const { x, y } = gridToIso(col, row);
        expect(plotIndexAtScreen(x, y, FARM_ROWS)).toBe(row * FARM_COLS + col);
      }
    }
  });

  it('maps points inside a tile diamond, not just the exact center', () => {
    const { x, y } = gridToIso(1, 1);
    const index = 1 * FARM_COLS + 1;
    expect(plotIndexAtScreen(x + TILE_WIDTH / 8, y, FARM_ROWS)).toBe(index);
    expect(plotIndexAtScreen(x, y - TILE_HEIGHT / 8, FARM_ROWS)).toBe(index);
  });

  it('rejects tiles outside the farm bounds', () => {
    const left = gridToIso(-1, 0);
    const right = gridToIso(FARM_COLS, 0);
    const below = gridToIso(0, FARM_ROWS);
    expect(plotIndexAtScreen(left.x, left.y, FARM_ROWS)).toBeNull();
    expect(plotIndexAtScreen(right.x, right.y, FARM_ROWS)).toBeNull();
    expect(plotIndexAtScreen(below.x, below.y, FARM_ROWS)).toBeNull();
  });

  it('rejects screen positions far from the field (e.g. the seed bar)', () => {
    expect(plotIndexAtScreen(540, 1700, FARM_ROWS)).toBeNull();
  });

  it('with rowCount 4 (expanded farm), accepts the new row and rejects past it', () => {
    const newRow = gridToIso(0, FARM_ROWS); // row index 3, the expansion row
    expect(plotIndexAtScreen(newRow.x, newRow.y, 4)).toBe(FARM_ROWS * FARM_COLS);
    const pastExpanded = gridToIso(0, 4);
    expect(plotIndexAtScreen(pastExpanded.x, pastExpanded.y, 4)).toBeNull();
  });
});

describe('PlotPointerTracker', () => {
  it('emits each plot at most once per gesture, even when re-entered', () => {
    const tracker = new PlotPointerTracker();
    const a = gridToIso(0, 0);
    const b = gridToIso(1, 0);
    expect(tracker.begin(a.x, a.y, FARM_ROWS)).toBe(0);
    expect(tracker.move(a.x + 4, a.y, FARM_ROWS)).toBeNull(); // still the same tile
    expect(tracker.move(b.x, b.y, FARM_ROWS)).toBe(1);
    expect(tracker.move(a.x, a.y, FARM_ROWS)).toBeNull(); // re-entered tile 0
    tracker.end();
  });

  it('resets visited plots between gestures', () => {
    const tracker = new PlotPointerTracker();
    const { x, y } = gridToIso(2, 1);
    const index = 1 * FARM_COLS + 2;
    expect(tracker.begin(x, y, FARM_ROWS)).toBe(index);
    tracker.end();
    expect(tracker.begin(x, y, FARM_ROWS)).toBe(index);
  });

  it('ignores moves when no gesture is active', () => {
    const tracker = new PlotPointerTracker();
    const { x, y } = gridToIso(0, 0);
    expect(tracker.move(x, y, FARM_ROWS)).toBeNull();
  });

  it('tracks plots entered later even when the gesture starts off-field', () => {
    const tracker = new PlotPointerTracker();
    expect(tracker.begin(540, 1700, FARM_ROWS)).toBeNull();
    const { x, y } = gridToIso(0, 2);
    expect(tracker.move(x, y, FARM_ROWS)).toBe(2 * FARM_COLS);
  });

  it('respects a larger rowCount on an expanded farm', () => {
    const tracker = new PlotPointerTracker();
    const { x, y } = gridToIso(1, 3); // the new row, only valid with rowCount 4
    expect(tracker.begin(x, y, FARM_ROWS)).toBeNull();
    tracker.end();
    expect(tracker.begin(x, y, 4)).toBe(3 * FARM_COLS + 1);
  });
});
