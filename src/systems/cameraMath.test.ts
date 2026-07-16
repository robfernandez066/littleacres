import { describe, expect, it } from 'vitest';

import {
  clampScroll,
  clampZoom,
  fitZoom,
  pinchZoom,
  rubberBand,
  scrollForAnchor,
  scrollRange,
  type Viewport,
  type WorldBounds,
} from './cameraMath';

/** The design-resolution viewport and the legacy owned rect that equals it (the home view). */
const VIEWPORT: Viewport = { width: 1080, height: 1920 };
const WORLD: WorldBounds = { x: 0, y: 0, width: 1080, height: 1920 };
/** The day-one world rect (T3.3a-r2): config.ts WORLD_MIN_X/Y + WORLD_WIDTH/HEIGHT. */
const DAY_ONE_WORLD: WorldBounds = { x: -180, y: -320, width: 1440, height: 2560 };
const MAX_IN = 1.6;

/** Phaser's forward camera transform (zoom about the viewport center) - the
 *  ground truth scrollForAnchor must invert. */
const worldAtScreen = (screenX: number, scrollX: number, zoom: number, viewWidth: number): number =>
  scrollX + viewWidth / 2 + (screenX - viewWidth / 2) / zoom;

describe('fitZoom', () => {
  it("is exactly 1 for today's owned land (the 1080x1920 world) in the design viewport", () => {
    expect(fitZoom(WORLD, VIEWPORT)).toBe(1);
  });

  it('fits the larger axis: owned land twice the viewport size fits at 0.5', () => {
    expect(fitZoom({ x: 0, y: 0, width: 2160, height: 3840 }, VIEWPORT)).toBe(0.5);
  });

  it('takes the smaller per-axis fit so the whole bounds is visible', () => {
    // Width fits at 1080/2160 = 0.5, height at 1920/1920 = 1 - the min wins.
    expect(fitZoom({ x: 0, y: 0, width: 2160, height: 1920 }, VIEWPORT)).toBe(0.5);
  });

  it('is exactly 0.75 for the day-one 1440x2560 world - the T3.3a-r2 zoom-out floor', () => {
    // Both axes fit at exactly 3/4: 1080/1440 = 1920/2560 = 0.75.
    expect(fitZoom(DAY_ONE_WORLD, VIEWPORT)).toBe(0.75);
  });
});

describe('clampZoom', () => {
  it('passes values inside [fit, maxIn] through unchanged', () => {
    expect(clampZoom(1.3, 1, MAX_IN)).toBe(1.3);
    expect(clampZoom(1, 1, MAX_IN)).toBe(1);
    expect(clampZoom(1.6, 1, MAX_IN)).toBe(1.6);
  });

  it('clamps zoom-out at fit and zoom-in at maxIn', () => {
    expect(clampZoom(0.4, 1, MAX_IN)).toBe(1);
    expect(clampZoom(9, 1, MAX_IN)).toBe(1.6);
  });

  it('lets the fit bound win if the limits ever cross', () => {
    expect(clampZoom(1.7, 2, 1.6)).toBe(2);
  });
});

describe('scrollRange / clampScroll', () => {
  it("collapses to the single centered scroll (0, 0) at fit zoom 1 for today's world", () => {
    const range = scrollRange(1, WORLD, VIEWPORT);
    expect(range).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
    expect(clampScroll(500, -900, 1, WORLD, VIEWPORT)).toEqual({ scrollX: 0, scrollY: 0 });
  });

  it('pins the exact range at max zoom-in 1.6', () => {
    // Visible rect is 1080/1.6 = 675 wide and 1920/1.6 = 1200 tall, so the
    // scroll can travel +/-(1080-675)/2 = 202.5 and +/-(1920-1200)/2 = 360.
    const range = scrollRange(1.6, WORLD, VIEWPORT);
    expect(range.minX).toBeCloseTo(-202.5, 10);
    expect(range.maxX).toBeCloseTo(202.5, 10);
    expect(range.minY).toBeCloseTo(-360, 10);
    expect(range.maxY).toBeCloseTo(360, 10);
  });

  it('keeps in-range scrolls untouched and clamps out-of-range ones per axis', () => {
    expect(clampScroll(100, -200, 1.6, WORLD, VIEWPORT)).toEqual({ scrollX: 100, scrollY: -200 });
    expect(clampScroll(9999, -9999, 1.6, WORLD, VIEWPORT)).toEqual({
      scrollX: 202.5,
      scrollY: -360,
    });
  });

  it('clamps exactly at the boundary values', () => {
    expect(clampScroll(202.5, 360, 1.6, WORLD, VIEWPORT)).toEqual({ scrollX: 202.5, scrollY: 360 });
    expect(clampScroll(202.6, 360.1, 1.6, WORLD, VIEWPORT)).toEqual({
      scrollX: 202.5,
      scrollY: 360,
    });
  });

  it('centers a collapsed axis on the world bounds, honoring a non-zero bounds origin', () => {
    const shifted: WorldBounds = { x: 100, y: 200, width: 1080, height: 1920 };
    // At zoom 1 the view equals the bounds: the only legal scroll shows it exactly.
    expect(clampScroll(0, 0, 1, shifted, VIEWPORT)).toEqual({ scrollX: 100, scrollY: 200 });
  });

  it('centers below fit zoom too (view larger than the world on both axes)', () => {
    const range = scrollRange(0.5, WORLD, VIEWPORT);
    expect(range.minX).toBe(range.maxX);
    expect(range.minY).toBe(range.maxY);
    expect(range.minX).toBe(0);
    expect(range.minY).toBe(0);
  });

  it('collapses the day-one world to the single centered scroll (0, 0) at the 0.75 floor', () => {
    // The world is centered on the legacy rect, so the fully-zoomed-out view
    // is centered exactly where the home view is: scroll (0, 0).
    const range = scrollRange(0.75, DAY_ONE_WORLD, VIEWPORT);
    expect(range).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });

  it('pins the day-one-world pan range at zoom 1: the full apron each way, home (0, 0) inside', () => {
    // Visible rect at zoom 1 is the 1080x1920 legacy rect; the camera can
    // travel exactly the apron width/height each way.
    const range = scrollRange(1, DAY_ONE_WORLD, VIEWPORT);
    expect(range).toEqual({ minX: -180, maxX: 180, minY: -320, maxY: 320 });
    expect(clampScroll(0, 0, 1, DAY_ONE_WORLD, VIEWPORT)).toEqual({ scrollX: 0, scrollY: 0 });
  });
});

describe('rubberBand', () => {
  const GIVE = 120;

  it('is the identity inside the range, including exactly at the edges', () => {
    expect(rubberBand(0, -202.5, 202.5, GIVE)).toBe(0);
    expect(rubberBand(-202.5, -202.5, 202.5, GIVE)).toBe(-202.5);
    expect(rubberBand(202.5, -202.5, 202.5, GIVE)).toBe(202.5);
  });

  it('diminishes overshoot: past the edge it moves less than asked, monotonically', () => {
    const over50 = rubberBand(252.5, -202.5, 202.5, GIVE);
    const over200 = rubberBand(402.5, -202.5, 202.5, GIVE);
    expect(over50).toBeGreaterThan(202.5);
    expect(over50).toBeLessThan(252.5);
    expect(over200).toBeGreaterThan(over50);
    expect(over200).toBeLessThan(402.5);
  });

  it('never travels more than `give` past either edge, however far the drag goes', () => {
    expect(rubberBand(1e9, 0, 100, GIVE)).toBeLessThanOrEqual(100 + GIVE);
    expect(rubberBand(-1e9, 0, 100, GIVE)).toBeGreaterThanOrEqual(0 - GIVE);
  });

  it('overshoots symmetrically below the min edge', () => {
    const above = rubberBand(302.5, -202.5, 202.5, GIVE) - 202.5;
    const below = -202.5 - rubberBand(-302.5, -202.5, 202.5, GIVE);
    expect(below).toBeCloseTo(above, 10);
  });

  it('rubber-bands around the midpoint of a degenerate (min > max) range', () => {
    // A collapsed axis passed inverted still behaves: both edges at the midpoint.
    expect(rubberBand(5, 10, -10, GIVE)).toBeGreaterThan(0);
    expect(rubberBand(5, 10, -10, GIVE)).toBeLessThan(5);
    expect(rubberBand(0, 10, -10, GIVE)).toBe(0);
  });

  it('degrades to a hard clamp when give is zero or negative', () => {
    expect(rubberBand(500, -202.5, 202.5, 0)).toBe(202.5);
    expect(rubberBand(-500, -202.5, 202.5, -5)).toBe(-202.5);
  });
});

describe('pinchZoom', () => {
  it('scales the start zoom by the finger-distance ratio', () => {
    expect(pinchZoom(1, 200, 300, 1, MAX_IN)).toBeCloseTo(1.5, 10);
    expect(pinchZoom(1.5, 300, 200, 1, MAX_IN)).toBeCloseTo(1, 10);
  });

  it('clamps zoom-in at maxIn and zoom-out at fit', () => {
    expect(pinchZoom(1, 100, 1000, 1, MAX_IN)).toBe(1.6);
    expect(pinchZoom(1.6, 1000, 100, 1, MAX_IN)).toBe(1);
  });

  it('holds the (clamped) start zoom on a degenerate start distance', () => {
    expect(pinchZoom(1.3, 0, 250, 1, MAX_IN)).toBe(1.3);
    expect(pinchZoom(99, 0, 250, 1, MAX_IN)).toBe(1.6);
  });
});

describe('scrollForAnchor', () => {
  it('reduces to world minus screen at zoom 1', () => {
    const { scrollX, scrollY } = scrollForAnchor(700, 900, 300, 400, 1, VIEWPORT);
    expect(scrollX).toBe(400);
    expect(scrollY).toBe(500);
  });

  it('holds the anchor invariant: the world point lands exactly under the screen point', () => {
    for (const zoom of [1, 1.25, 1.6]) {
      for (const [worldX, screenX] of [
        [540, 540],
        [700, 300],
        [123.4, 987.6],
      ] as const) {
        const { scrollX } = scrollForAnchor(worldX, 0, screenX, 0, zoom, VIEWPORT);
        expect(worldAtScreen(screenX, scrollX, zoom, VIEWPORT.width)).toBeCloseTo(worldX, 10);
      }
    }
  });

  it('keeps the viewport center anchored with zero scroll change at any zoom', () => {
    // Zooming around the exact center never pans: world center anchored at
    // screen center yields the same scroll regardless of zoom.
    for (const zoom of [1, 1.3, 1.6]) {
      const { scrollX, scrollY } = scrollForAnchor(540, 960, 540, 960, zoom, VIEWPORT);
      expect(scrollX).toBeCloseTo(0, 10);
      expect(scrollY).toBeCloseTo(0, 10);
    }
  });
});
