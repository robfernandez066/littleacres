/**
 * Occluded-movable selection (U3c): the pure ordering + tap-cycling rules for
 * deciding WHICH movable a selection tap or long-press targets when several
 * overlap. Kept off-scene and Phaser-free so the rules are unit-testable (the
 * gesture-classifier precedent - see systems/plotPointer.ts).
 *
 * The scene supplies the CONTAINMENT SET - every movable whose hit area
 * contains the point - each tagged with its BASE ground position and render
 * depth; this module orders that set and advances the cycle. Collecting the
 * set (the hit-area geometry) stays in the scene; everything decidable off a
 * few numbers lives here.
 */

/**
 * One containment-set member. `T` carries the caller's own descriptor fields
 * (which sprite/index this is) through the ordering untouched - the module
 * only ever reads the four geometry fields below.
 */
export interface OcclusionCandidate {
  /** Stable identity for this movable across taps (e.g. "b3", "s:farmhouse"). */
  readonly key: string;
  /** The movable's BASE ground position, world/design px. */
  readonly baseX: number;
  readonly baseY: number;
  /** Render depth - the tiebreaker when two bases sit equidistant. */
  readonly depth: number;
  /**
   * Whether the tap landed on this candidate's VISIBLE (opaque) pixels, not
   * just inside its rectangular hit area (U3c-r2). The primary ordering tier:
   * a candidate the finger is actually touching outranks one whose rect merely
   * covers the point (e.g. the farmhouse's big rect over the mill's roof). The
   * scene computes it via texture alpha at the tap; the helper only ranks by it.
   */
  readonly opaqueAtPoint: boolean;
}

/** The cycle memory the scene threads between taps (null = no live cycle). */
export interface SelectionCycle {
  /** The ordered candidate keys the last resolution saw. */
  readonly keys: readonly string[];
  /** The index (into `keys`) the last tap resolved to. */
  readonly index: number;
  /** Where that tap landed (world px) - the cycle-radius origin. */
  readonly x: number;
  readonly y: number;
}

/**
 * Order candidates into two tiers (U3c-r2): those the tap OPAQUELY hit first,
 * rect-only (transparent-at-point) candidates after - so tapping the mill's
 * visible roof selects the mill even though the farmhouse's rect also covers
 * the point. WITHIN each tier the order is unchanged: ascending distance from
 * the tap to each BASE ground position, ties to the FRONTMOST (higher depth),
 * then by key so the order is total and deterministic (equal candidates must
 * never shuffle between taps, which cycling relies on). Does not mutate input.
 */
export function orderByBaseDistance<T extends OcclusionCandidate>(
  candidates: readonly T[],
  tapX: number,
  tapY: number,
): T[] {
  return [...candidates].sort((a, b) => {
    if (a.opaqueAtPoint !== b.opaqueAtPoint) return a.opaqueAtPoint ? -1 : 1;
    const da = (a.baseX - tapX) ** 2 + (a.baseY - tapY) ** 2;
    const db = (b.baseX - tapX) ** 2 + (b.baseY - tapY) ** 2;
    if (da !== db) return da - db;
    if (a.depth !== b.depth) return b.depth - a.depth;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/**
 * Resolve which candidate a tap/long-press at (tapX,tapY) selects, given the
 * previous cycle memory. A REPEAT tap landing within `cycleRadius` of the last
 * one on the SAME ordered candidate set advances to the next candidate
 * (wrapping) - so tapping the same overlap repeatedly walks every buried
 * asset. Anything else - a first tap, a tap outside the radius, a changed set -
 * resets to the nearest-base candidate. Returns the chosen candidate and the
 * refreshed cycle memory to store, or null when the set is empty.
 */
export function resolveSelection<T extends OcclusionCandidate>(
  candidates: readonly T[],
  tapX: number,
  tapY: number,
  prev: SelectionCycle | null,
  cycleRadius: number,
): { selected: T; cycle: SelectionCycle } | null {
  const ordered = orderByBaseDistance(candidates, tapX, tapY);
  if (ordered.length === 0) return null;
  const keys = ordered.map((c) => c.key);
  const repeat =
    prev !== null &&
    (tapX - prev.x) ** 2 + (tapY - prev.y) ** 2 <= cycleRadius * cycleRadius &&
    sameKeys(prev.keys, keys);
  const index = repeat ? (prev.index + 1) % ordered.length : 0;
  return { selected: ordered[index]!, cycle: { keys, index, x: tapX, y: tapY } };
}

/** Order-sensitive key-array equality (the order is deterministic per set + tap). */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
