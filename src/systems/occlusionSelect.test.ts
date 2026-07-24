import { describe, expect, it } from 'vitest';

import {
  orderByBaseDistance,
  resolveSelection,
  type OcclusionCandidate,
  type SelectionCycle,
} from './occlusionSelect';

/** A candidate factory with sane defaults; overrides win. `opaqueAtPoint`
 *  defaults to true so distance/depth tests exercise a single (opaque) tier. */
function cand(partial: Partial<OcclusionCandidate> & { key: string }): OcclusionCandidate {
  return { baseX: 0, baseY: 0, depth: 0, opaqueAtPoint: true, ...partial };
}

const RADIUS = 30;

describe('orderByBaseDistance', () => {
  it('orders the containment set by ascending distance from the tap to each base', () => {
    // Three overlapping movables (the caller already filtered to those whose
    // hit area contains the tap); only their base ground positions differ.
    const set = [
      cand({ key: 'far', baseX: 100, baseY: 0 }),
      cand({ key: 'near', baseX: 10, baseY: 0 }),
      cand({ key: 'mid', baseX: 40, baseY: 0 }),
    ];
    expect(orderByBaseDistance(set, 0, 0).map((c) => c.key)).toEqual(['near', 'mid', 'far']);
  });

  it('breaks an equal-distance tie toward the frontmost (higher depth)', () => {
    const set = [
      cand({ key: 'back', baseX: 10, baseY: 0, depth: 5 }),
      cand({ key: 'front', baseX: 10, baseY: 0, depth: 9 }),
    ];
    expect(orderByBaseDistance(set, 0, 0).map((c) => c.key)).toEqual(['front', 'back']);
  });

  it('breaks an equal-distance, equal-depth tie by key so the order is deterministic', () => {
    const set = [
      cand({ key: 'b', baseX: 5, baseY: 5, depth: 3 }),
      cand({ key: 'a', baseX: 5, baseY: 5, depth: 3 }),
    ];
    expect(orderByBaseDistance(set, 0, 0).map((c) => c.key)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const set = [cand({ key: 'far', baseX: 100 }), cand({ key: 'near', baseX: 1 })];
    orderByBaseDistance(set, 0, 0);
    expect(set.map((c) => c.key)).toEqual(['far', 'near']);
  });

  describe('alpha tier (U3c-r2)', () => {
    it('an opaque-at-point candidate outranks a NEARER transparent-rect-only one', () => {
      // The owner's case: the farmhouse rect covers the tap and its base is
      // nearer, but the tap landed on the mill's visible pixels. Mill wins.
      const set = [
        cand({ key: 'farmhouse', baseX: 5, baseY: 0, depth: 9, opaqueAtPoint: false }),
        cand({ key: 'mill', baseX: 40, baseY: 0, depth: 2, opaqueAtPoint: true }),
      ];
      expect(orderByBaseDistance(set, 0, 0).map((c) => c.key)).toEqual(['mill', 'farmhouse']);
    });

    it('within the opaque tier, base-distance then depth still decide', () => {
      const set = [
        cand({ key: 'opaque-far', baseX: 80, baseY: 0, opaqueAtPoint: true }),
        cand({ key: 'opaque-near', baseX: 10, baseY: 0, opaqueAtPoint: true }),
        cand({ key: 'transparent-nearest', baseX: 1, baseY: 0, opaqueAtPoint: false }),
      ];
      expect(orderByBaseDistance(set, 0, 0).map((c) => c.key)).toEqual([
        'opaque-near',
        'opaque-far',
        'transparent-nearest',
      ]);
    });

    it('all-transparent (rect-only) falls back to plain base-distance order', () => {
      const set = [
        cand({ key: 'far', baseX: 100, baseY: 0, opaqueAtPoint: false }),
        cand({ key: 'near', baseX: 10, baseY: 0, opaqueAtPoint: false }),
      ];
      expect(orderByBaseDistance(set, 0, 0).map((c) => c.key)).toEqual(['near', 'far']);
    });

    it('cycling walks the combined two-tier list (opaque first, then transparent)', () => {
      const stack = [
        cand({ key: 'opaque', baseX: 30, baseY: 0, opaqueAtPoint: true }),
        cand({ key: 'transparent', baseX: 0, baseY: 0, opaqueAtPoint: false }),
      ];
      const first = resolveSelection(stack, 0, 0, null, RADIUS)!;
      expect(first.selected.key).toBe('opaque'); // opaque tier first, despite farther base
      const second = resolveSelection(stack, 2, 0, first.cycle, RADIUS)!;
      expect(second.selected.key).toBe('transparent'); // cycle reaches the buried rect-only one
    });
  });
});

describe('resolveSelection', () => {
  // The bakery-between-mill-and-farmhouse containment set: all three contain
  // the tap, the bakery's base is nearest, the farmhouse's is farthest.
  const stack = [
    cand({ key: 'bakery', baseX: 0, baseY: 0, depth: 2 }),
    cand({ key: 'mill', baseX: 20, baseY: 0, depth: 4 }),
    cand({ key: 'farmhouse', baseX: 50, baseY: 0, depth: 6 }),
  ];

  it('returns null for an empty containment set', () => {
    expect(resolveSelection([], 0, 0, null, RADIUS)).toBeNull();
  });

  it('a first tap (no prior cycle) selects the nearest-base candidate', () => {
    const res = resolveSelection(stack, 0, 0, null, RADIUS);
    expect(res?.selected.key).toBe('bakery');
    expect(res?.cycle).toEqual({ keys: ['bakery', 'mill', 'farmhouse'], index: 0, x: 0, y: 0 });
  });

  it('a repeat tap within the radius on the same set advances to the next candidate', () => {
    const first = resolveSelection(stack, 0, 0, null, RADIUS)!;
    const second = resolveSelection(stack, 5, 0, first.cycle, RADIUS)!;
    expect(second.selected.key).toBe('mill');
    expect(second.cycle.index).toBe(1);
  });

  it('repeat taps walk every buried asset and wrap around', () => {
    let cycle: SelectionCycle | null = null;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res: { selected: OcclusionCandidate; cycle: SelectionCycle } | null = resolveSelection(
        stack,
        0,
        0,
        cycle,
        RADIUS,
      );
      expect(res).not.toBeNull();
      seen.push(res!.selected.key);
      cycle = res!.cycle;
    }
    // Four taps on a three-deep stack: every asset reached, then wraps to the first.
    expect(seen).toEqual(['bakery', 'mill', 'farmhouse', 'bakery']);
  });

  it('a tap OUTSIDE the cycle radius resets to the nearest-base candidate', () => {
    const first = resolveSelection(stack, 0, 0, null, RADIUS)!;
    // Same set and same base ordering (moved straight down in y, so bakery is
    // still nearest), but past the radius - so it is a new selection, not a
    // cycle advance.
    const far = resolveSelection(stack, 0, RADIUS + 10, first.cycle, RADIUS)!;
    expect(far.selected.key).toBe('bakery');
    expect(far.cycle.index).toBe(0);
  });

  it('a changed containment set resets the cycle even within the radius', () => {
    const first = resolveSelection(stack, 0, 0, null, RADIUS)!;
    // The buried farmhouse is no longer under the finger: a different set.
    const smaller = stack.slice(0, 2);
    const res = resolveSelection(smaller, 3, 0, first.cycle, RADIUS)!;
    expect(res.selected.key).toBe('bakery');
    expect(res.cycle.index).toBe(0);
  });
});
