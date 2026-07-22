import { describe, expect, it } from 'vitest';

import { type GridCell, GRID_LINE_MAX_CELLS, gridCellLine } from './gridLine';

/** "col,row" keys, for dupe and adjacency assertions. */
function keys(cells: readonly GridCell[]): string[] {
  return cells.map((c) => `${c.col},${c.row}`);
}

/** Every consecutive pair differs on exactly one axis, by exactly one. */
function isFourConnected(cells: readonly GridCell[]): boolean {
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1]!;
    const b = cells[i]!;
    if (Math.abs(b.col - a.col) + Math.abs(b.row - a.row) !== 1) return false;
  }
  return true;
}

describe('gridCellLine (T4.12-r1 drag interpolation)', () => {
  it('a zero-length span is just that cell', () => {
    expect(gridCellLine({ col: 3, row: 4 }, { col: 3, row: 4 })).toEqual([{ col: 3, row: 4 }]);
  });

  it('adjacent cells yield both ends and nothing between', () => {
    expect(gridCellLine({ col: 0, row: 0 }, { col: 1, row: 0 })).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
  });

  it('a jump from A to a distant C yields the full A..C cell line with no dupes', () => {
    const cells = gridCellLine({ col: 0, row: 0 }, { col: 5, row: 3 });
    // Both ends present, in travel order.
    expect(cells[0]).toEqual({ col: 0, row: 0 });
    expect(cells[cells.length - 1]).toEqual({ col: 5, row: 3 });
    // 4-connected walk: |dcol| + |drow| + 1 cells, each one step from the last.
    expect(cells).toHaveLength(5 + 3 + 1);
    expect(isFourConnected(cells)).toBe(true);
    // No cell repeats - the caller bills once per tile.
    expect(new Set(keys(cells)).size).toBe(cells.length);
  });

  it('is contiguous and dupe-free in every direction, including pure axes', () => {
    const targets: GridCell[] = [
      { col: 7, row: 0 },
      { col: -7, row: 0 },
      { col: 0, row: 6 },
      { col: 0, row: -6 },
      { col: 4, row: 4 },
      { col: -4, row: 4 },
      { col: 4, row: -4 },
      { col: -9, row: -2 },
      { col: 2, row: -11 },
    ];
    for (const to of targets) {
      const cells = gridCellLine({ col: 0, row: 0 }, to);
      expect(cells[0]).toEqual({ col: 0, row: 0 });
      expect(cells[cells.length - 1]).toEqual(to);
      expect(cells).toHaveLength(Math.abs(to.col) + Math.abs(to.row) + 1);
      expect(isFourConnected(cells)).toBe(true);
      expect(new Set(keys(cells)).size).toBe(cells.length);
    }
  });

  it('never steps diagonally - a pure diagonal still goes one axis at a time', () => {
    // (col+1, row+1) shares only a CORNER with (col, row) in the iso frame, so
    // a diagonal step would lay tiles that read as a gap. The walk detours
    // through a shared-edge neighbour instead.
    const cells = gridCellLine({ col: 0, row: 0 }, { col: 3, row: 3 });
    expect(isFourConnected(cells)).toBe(true);
    expect(cells).toHaveLength(7);
  });

  it('reversing a span yields the reverse cell sequence', () => {
    const forward = gridCellLine({ col: 1, row: 2 }, { col: 6, row: 5 });
    const back = gridCellLine({ col: 6, row: 5 }, { col: 1, row: 2 });
    expect(back).toHaveLength(forward.length);
    expect(back[0]).toEqual({ col: 6, row: 5 });
    expect(back[back.length - 1]).toEqual({ col: 1, row: 2 });
    expect(isFourConnected(back)).toBe(true);
  });

  it('treats an over-long span as a discontinuity and returns only the target', () => {
    // A finger lifted and re-placed, a camera jump, or an off-grid sample -
    // filling it in would paint a long unwanted streak.
    const far = { col: GRID_LINE_MAX_CELLS + 10, row: 0 };
    expect(gridCellLine({ col: 0, row: 0 }, far)).toEqual([far]);
    // Exactly at the cap still interpolates in full.
    const atCap = { col: GRID_LINE_MAX_CELLS, row: 0 };
    expect(gridCellLine({ col: 0, row: 0 }, atCap)).toHaveLength(GRID_LINE_MAX_CELLS + 1);
  });

  it('honours a caller-supplied cap', () => {
    expect(gridCellLine({ col: 0, row: 0 }, { col: 3, row: 0 }, 2)).toEqual([{ col: 3, row: 0 }]);
    expect(gridCellLine({ col: 0, row: 0 }, { col: 2, row: 0 }, 2)).toHaveLength(3);
  });
});
