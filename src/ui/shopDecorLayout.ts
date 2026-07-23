/**
 * Decor grid vertical reflow (U3b-r2). The Shop's Decor tab is a 2-column grid
 * of COLLAPSED cards; tapping one expands it in place, growing that card's row
 * to the taller expanded height and pushing every later row down. Exactly one
 * card is expanded at a time, so at most one row is tall.
 *
 * Returns each slot's container TOP Y. Slots fill left-to-right, top-to-bottom
 * (slot 0 and 1 share row 0, slots 2 and 3 share row 1, ...), so the two cards
 * in a row share a top; the shorter (collapsed) sibling of an expanded card is
 * top-aligned with it. Pure geometry so the reflow is unit-testable in
 * isolation from Phaser (mirrors `seedBarLayout`).
 */
export function decorCardTops(
  count: number,
  expandedSlot: number | null,
  gridTopEdge: number,
  collapsedHeight: number,
  expandedHeight: number,
  rowGap: number,
): number[] {
  const expandedRow = expandedSlot === null ? -1 : Math.floor(expandedSlot / 2);
  const rowCount = Math.ceil(count / 2);
  const rowTop: number[] = [];
  let y = gridTopEdge;
  for (let row = 0; row < rowCount; row++) {
    rowTop[row] = y;
    const height = row === expandedRow ? expandedHeight : collapsedHeight;
    y += height + rowGap;
  }
  const tops: number[] = [];
  for (let slot = 0; slot < count; slot++) {
    tops[slot] = rowTop[Math.floor(slot / 2)]!;
  }
  return tops;
}
