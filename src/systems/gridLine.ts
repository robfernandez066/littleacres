/**
 * Grid-space line walking (T4.12-r1), for path painting's drag interpolation.
 * Pure logic, no Phaser and no game-state dependency - the paint gesture only
 * receives a pointer sample per move event, and a fast drag's samples can jump
 * several cells at once, so the cells BETWEEN two samples have to be filled in
 * or the run comes out dotted.
 */

export interface GridCell {
  col: number;
  row: number;
}

/**
 * The default cap on a single interpolated span, in cells (Manhattan steps).
 * A continuous stroke across the whole visible field is well under this; a
 * span longer than it is not a real drag continuation but a discontinuity - a
 * finger lifted and re-placed, a camera jump, or a pointer sample from far
 * off-grid - and filling it in would paint a long unwanted streak. See
 * `gridCellLine`'s fallback.
 */
export const GRID_LINE_MAX_CELLS = 64;

/**
 * Every grid cell on the line from `from` to `to`, INCLUSIVE of both ends,
 * in travel order, with no duplicates.
 *
 * The walk is 4-CONNECTED: each step changes col or row by one, never both.
 * That matters for painting - in the iso frame (col+1, row+1) shares only a
 * CORNER with (col, row), so a line allowed to step diagonally would lay
 * tiles that touch at a point and read as a gap. Stepping one axis at a time
 * guarantees consecutive cells share a full edge, so the run is visually
 * contiguous. A line of `dcol`/`drow` therefore has |dcol| + |drow| + 1 cells.
 *
 * When the span exceeds `maxCells` the line is treated as a discontinuity and
 * ONLY `to` is returned - see GRID_LINE_MAX_CELLS.
 */
export function gridCellLine(
  from: GridCell,
  to: GridCell,
  maxCells: number = GRID_LINE_MAX_CELLS,
): GridCell[] {
  const dCol = to.col - from.col;
  const dRow = to.row - from.row;
  const stepCol = Math.sign(dCol);
  const stepRow = Math.sign(dRow);
  let absCol = Math.abs(dCol);
  let absRow = Math.abs(dRow);

  const steps = absCol + absRow;
  if (steps > maxCells) return [{ col: to.col, row: to.row }];

  const cells: GridCell[] = [{ col: from.col, row: from.row }];
  let col = from.col;
  let row = from.row;
  // 4-connected Bresenham: `error` tracks which axis is further behind the
  // ideal line, and each iteration advances exactly the more deserving one.
  // Doubling the deltas keeps the comparison in integers.
  let error = absCol - absRow;
  absCol *= 2;
  absRow *= 2;
  for (let i = 0; i < steps; i++) {
    if (error > 0) {
      col += stepCol;
      error -= absRow;
    } else {
      row += stepRow;
      error += absCol;
    }
    cells.push({ col, row });
  }
  return cells;
}
