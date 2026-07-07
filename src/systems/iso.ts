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
 * FARM_COLS x FARM_ROWS plot grid is centered in the design area (leaving
 * symmetric headroom at top and bottom for the future HUD).
 *
 * Derivation: the average grid cell is ((FARM_COLS-1)/2, (FARM_ROWS-1)/2);
 * plugging it into gridToIso and solving for the origin that puts it at the
 * design center gives the offsets below.
 */
export const ISO_ORIGIN_X = DESIGN_WIDTH / 2 - ((FARM_COLS - FARM_ROWS) * TILE_WIDTH) / 4;
export const ISO_ORIGIN_Y = DESIGN_HEIGHT / 2 - ((FARM_COLS + FARM_ROWS - 2) * TILE_HEIGHT) / 4;

/** Convert grid coordinates to the screen position of that tile's center. */
export function gridToIso(col: number, row: number): { x: number; y: number } {
  return {
    x: ISO_ORIGIN_X + ((col - row) * TILE_WIDTH) / 2,
    y: ISO_ORIGIN_Y + ((col + row) * TILE_HEIGHT) / 2,
  };
}

/**
 * Convert a screen position back to (fractional) grid coordinates - the exact
 * inverse of gridToIso. Callers doing tile hit-tests should Math.round both
 * components; the rounded cell is the tile whose diamond contains the point.
 */
export function isoToGrid(x: number, y: number): { col: number; row: number } {
  const dx = (x - ISO_ORIGIN_X) / (TILE_WIDTH / 2);
  const dy = (y - ISO_ORIGIN_Y) / (TILE_HEIGHT / 2);
  return {
    col: (dx + dy) / 2,
    row: (dy - dx) / 2,
  };
}
