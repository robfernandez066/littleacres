import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../config';
import { FARM_COLS, FARM_ROWS } from '../data/farm';

/**
 * Isometric grid helper.
 *
 * The farm is a classic 2:1 isometric grid. Grid coordinates are (col, row):
 * +col runs toward the lower-right of the screen, +row toward the lower-left.
 * Screen coordinates are in the 1080x1920 design space, and (x, y) always
 * refers to the CENTER of a tile's diamond (tile images use origin 0.5, 0.5).
 */

/** Tile diamond size in pixels. Must match the `grass`/`plot` atlas frames. */
export const TILE_WIDTH = 256;
export const TILE_HEIGHT = 128;

/**
 * Screen position of the center of tile (0, 0), chosen so that the
 * FARM_COLS x rowCount plot grid is centered in the design area (leaving
 * symmetric headroom at top and bottom for the future HUD).
 *
 * Derivation: the average grid cell is ((FARM_COLS-1)/2, (rowCount-1)/2);
 * plugging it into gridToIso and solving for the origin that puts it at the
 * design center gives the offsets below. `rowCount` is the CURRENT number of
 * rows (3 base, 4 once expanded) so the grid recenters as the farm grows.
 */
export function isoOrigin(rowCount: number): { x: number; y: number } {
  return {
    x: DESIGN_WIDTH / 2 - ((FARM_COLS - rowCount) * TILE_WIDTH) / 4,
    y: DESIGN_HEIGHT / 2 - ((FARM_COLS + rowCount - 2) * TILE_HEIGHT) / 4,
  };
}

/**
 * Convert grid coordinates to the screen position of that tile's center.
 * `rowCount` is the CURRENT row count (defaults to the base FARM_ROWS) - pass
 * the expanded row count once the farm has grown, so the whole grid recenters.
 */
export function gridToIso(
  col: number,
  row: number,
  rowCount: number = FARM_ROWS,
): { x: number; y: number } {
  const origin = isoOrigin(rowCount);
  return {
    x: origin.x + ((col - row) * TILE_WIDTH) / 2,
    y: origin.y + ((col + row) * TILE_HEIGHT) / 2,
  };
}

/**
 * Convert a screen position back to (fractional) grid coordinates - the exact
 * inverse of gridToIso for the same `rowCount`. Callers doing tile hit-tests
 * should Math.round both components; the rounded cell is the tile whose
 * diamond contains the point.
 */
export function isoToGrid(
  x: number,
  y: number,
  rowCount: number = FARM_ROWS,
): { col: number; row: number } {
  const origin = isoOrigin(rowCount);
  const dx = (x - origin.x) / (TILE_WIDTH / 2);
  const dy = (y - origin.y) / (TILE_HEIGHT / 2);
  return {
    col: (dx + dy) / 2,
    row: (dy - dx) / 2,
  };
}
