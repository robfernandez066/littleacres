import { describe, expect, it } from 'vitest';

import { FARM_COLS, FARM_ROWS } from '../data/farm';
import { gridToIso, TILE_HEIGHT, TILE_WIDTH } from './iso';
import { plotIndexAtScreen, PlotPointerTracker } from './plotPointer';

describe('plotIndexAtScreen', () => {
  it('maps every tile center to its plot index (row * FARM_COLS + col)', () => {
    for (let row = 0; row < FARM_ROWS; row++) {
      for (let col = 0; col < FARM_COLS; col++) {
        const { x, y } = gridToIso(col, row);
        expect(plotIndexAtScreen(x, y)).toBe(row * FARM_COLS + col);
      }
    }
  });

  it('maps points inside a tile diamond, not just the exact center', () => {
    const { x, y } = gridToIso(1, 1);
    const index = 1 * FARM_COLS + 1;
    expect(plotIndexAtScreen(x + TILE_WIDTH / 8, y)).toBe(index);
    expect(plotIndexAtScreen(x, y - TILE_HEIGHT / 8)).toBe(index);
  });

  it('rejects tiles outside the farm bounds', () => {
    const left = gridToIso(-1, 0);
    const right = gridToIso(FARM_COLS, 0);
    const below = gridToIso(0, FARM_ROWS);
    expect(plotIndexAtScreen(left.x, left.y)).toBeNull();
    expect(plotIndexAtScreen(right.x, right.y)).toBeNull();
    expect(plotIndexAtScreen(below.x, below.y)).toBeNull();
  });

  it('rejects screen positions far from the field (e.g. the seed bar)', () => {
    expect(plotIndexAtScreen(540, 1700)).toBeNull();
  });
});

describe('PlotPointerTracker', () => {
  it('emits each plot at most once per gesture, even when re-entered', () => {
    const tracker = new PlotPointerTracker();
    const a = gridToIso(0, 0);
    const b = gridToIso(1, 0);
    expect(tracker.begin(a.x, a.y)).toBe(0);
    expect(tracker.move(a.x + 4, a.y)).toBeNull(); // still the same tile
    expect(tracker.move(b.x, b.y)).toBe(1);
    expect(tracker.move(a.x, a.y)).toBeNull(); // re-entered tile 0
    tracker.end();
  });

  it('resets visited plots between gestures', () => {
    const tracker = new PlotPointerTracker();
    const { x, y } = gridToIso(2, 1);
    const index = 1 * FARM_COLS + 2;
    expect(tracker.begin(x, y)).toBe(index);
    tracker.end();
    expect(tracker.begin(x, y)).toBe(index);
  });

  it('ignores moves when no gesture is active', () => {
    const tracker = new PlotPointerTracker();
    const { x, y } = gridToIso(0, 0);
    expect(tracker.move(x, y)).toBeNull();
  });

  it('tracks plots entered later even when the gesture starts off-field', () => {
    const tracker = new PlotPointerTracker();
    expect(tracker.begin(540, 1700)).toBeNull();
    const { x, y } = gridToIso(0, 2);
    expect(tracker.move(x, y)).toBe(2 * FARM_COLS);
  });
});
