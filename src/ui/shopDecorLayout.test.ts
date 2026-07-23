import { describe, expect, it } from 'vitest';

import { decorCardTops } from './shopDecorLayout';

// Round numbers so the expected tops are obvious to read (the real panel uses
// COLLAPSED 176 / EXPANDED 268 / gap 12, but the geometry is identical).
const TOP = 0;
const COLLAPSED = 100;
const EXPANDED = 160;
const GAP = 10;

describe('decorCardTops (U3b-r2 tap-to-expand reflow)', () => {
  it('packs every row at the collapsed height when nothing is expanded', () => {
    // 6 slots = 3 rows; each row is COLLAPSED + GAP below the last.
    const tops = decorCardTops(6, null, TOP, COLLAPSED, EXPANDED, GAP);
    expect(tops).toEqual([0, 0, 110, 110, 220, 220]);
  });

  it('top-aligns the two cards in a row (they share a top)', () => {
    const tops = decorCardTops(4, null, TOP, COLLAPSED, EXPANDED, GAP);
    expect(tops[0]).toBe(tops[1]);
    expect(tops[2]).toBe(tops[3]);
  });

  it('grows the expanded card row and pushes every later row down by the delta', () => {
    // Expand slot 2 (row 1): rows 0 unchanged, row 1 top unchanged, row 2 down
    // by EXPANDED - COLLAPSED = 60.
    const tops = decorCardTops(6, 2, TOP, COLLAPSED, EXPANDED, GAP);
    expect(tops).toEqual([0, 0, 110, 110, 280, 280]);
  });

  it('expanding a card in the last row shifts nothing (no rows below it)', () => {
    const base = decorCardTops(6, null, TOP, COLLAPSED, EXPANDED, GAP);
    const lastExpanded = decorCardTops(6, 4, TOP, COLLAPSED, EXPANDED, GAP);
    expect(lastExpanded).toEqual(base);
  });

  it('expanding either card in a row reflows identically (the row grows, not the card)', () => {
    expect(decorCardTops(6, 2, TOP, COLLAPSED, EXPANDED, GAP)).toEqual(
      decorCardTops(6, 3, TOP, COLLAPSED, EXPANDED, GAP),
    );
  });

  it('handles an odd final slot (a lone card in the last row)', () => {
    const tops = decorCardTops(5, 0, TOP, COLLAPSED, EXPANDED, GAP);
    // Row 0 expanded (height 160): row 1 top = 160+10 = 170, row 2 top =
    // 170+100+10 = 280; slot 4 is alone in row 2.
    expect(tops).toEqual([0, 0, 170, 170, 280]);
  });
});
