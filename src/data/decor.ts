/**
 * Decorations (T3.9): the moondust/coin sink and the game's first
 * self-expression system. All game data lives here, never in scene/UI logic.
 */

export type DecorCurrency = 'coins' | 'moondust';

export interface DecorItemDef {
  /** Atlas frame, also the save's placement/purchase identifier. */
  frame: string;
  /** Display name, shown in the Decor Shop. */
  name: string;
  currency: DecorCurrency;
  /** Cost in `currency` units. */
  price: number;
}

/** The 10 purchasable decorations. Balance numbers are the owner's sheet values. */
export const DECOR_ITEMS: readonly DecorItemDef[] = [
  { frame: 'decor_bench', name: 'Bench', currency: 'coins', price: 400 },
  { frame: 'decor_flowerbed', name: 'Flowerbed', currency: 'coins', price: 600 },
  { frame: 'decor_fence', name: 'Fence', currency: 'coins', price: 250 },
  { frame: 'decor_barrels', name: 'Barrels', currency: 'coins', price: 350 },
  { frame: 'decor_scarecrow', name: 'Scarecrow', currency: 'coins', price: 900 },
  { frame: 'decor_birdbath', name: 'Birdbath', currency: 'coins', price: 1200 },
  { frame: 'decor_well', name: 'Well', currency: 'coins', price: 2000 },
  { frame: 'decor_mushrooms', name: 'Mushrooms', currency: 'moondust', price: 4 },
  { frame: 'decor_gnome', name: 'Gnome', currency: 'moondust', price: 6 },
  { frame: 'decor_lantern', name: 'Lantern', currency: 'moondust', price: 8 },
];

export interface TrophyDef {
  frame: string;
  name: string;
}

/**
 * The 5 trophies: not purchasable in the shop, granted by the quest system
 * (T3.10). Named so the Shed can give each a display row (T3.18) once it
 * lands in the warehouse.
 */
export const TROPHY_ITEMS: readonly TrophyDef[] = [
  { frame: 'trophy_goldscarecrow', name: 'Golden Scarecrow' },
  { frame: 'trophy_starbanner', name: 'Star Banner' },
  { frame: 'trophy_moonwell', name: 'Moonwell' },
  { frame: 'trophy_traderscart', name: "Trader's Cart" },
  { frame: 'trophy_ancientoak', name: 'Ancient Oak' },
];

/** The 5 trophy frames, in `TROPHY_ITEMS` order - kept for callers that only need the frame list. */
export const TROPHY_FRAMES: readonly string[] = TROPHY_ITEMS.map((item) => item.frame);

/** Every frame name a saved decoration placement may legally reference. */
export const DECOR_FRAMES: ReadonlySet<string> = new Set([
  ...DECOR_ITEMS.map((item) => item.frame),
  ...TROPHY_FRAMES,
]);

/** The shop-purchasable frames - the domain of the split placement budgets (T3.3a2). */
export const PURCHASABLE_FRAMES: ReadonlySet<string> = new Set(
  DECOR_ITEMS.map((item) => item.frame),
);

export function findDecorItem(frame: string): DecorItemDef | undefined {
  return DECOR_ITEMS.find((item) => item.frame === frame);
}

/**
 * Owned PURCHASABLE NON-FENCE decorations: placed entries plus warehouse
 * counts whose frame is in PURCHASABLE_FRAMES, excluding the fence (it has
 * its own budget, T3.3a2). Trophy frames never count. Save validation,
 * `buyDecoration`, and the Decor Shop all share this one count, so the cap
 * can never disagree with the trophy grant path (T3.17).
 */
export function decorOwnedCount(
  placed: readonly { frame: string }[],
  warehouse: Record<string, number>,
): number {
  let count = 0;
  for (const placement of placed) {
    if (PURCHASABLE_FRAMES.has(placement.frame) && placement.frame !== FENCE_FRAME) count++;
  }
  for (const [frame, owned] of Object.entries(warehouse)) {
    if (PURCHASABLE_FRAMES.has(frame) && frame !== FENCE_FRAME) count += owned;
  }
  return count;
}

/** Owned fences, placed + warehoused - the domain of MAX_FENCES (T3.3a2). */
export function fenceOwnedCount(
  placed: readonly { frame: string }[],
  warehouse: Record<string, number>,
): number {
  let count = 0;
  for (const placement of placed) {
    if (placement.frame === FENCE_FRAME) count++;
  }
  return count + (warehouse[FENCE_FRAME] ?? 0);
}

/**
 * Split placement budgets (T3.3a2, owner decision, supersedes the single
 * MAX_DECORATIONS=30 cap): non-fence purchasables and fences each have their
 * own cap, placed and warehoused (T3.9b) COMBINED, checked at purchase -
 * neither budget consumes the other. Trophy frames are exempt (T3.17): quest
 * trophies are one-time rewards, not purchases, so they never consume shop
 * capacity and never count toward either cap.
 */
export const MAX_DECOR_ITEMS = 50;
export const MAX_FENCES = 60;

/** `setDecorationTransform` clamp bounds (the arrange mode's drag range). */
export const DECOR_X_MIN = 0;
export const DECOR_X_MAX = 1080;
export const DECOR_Y_MIN = 380;
export const DECOR_Y_MAX = 1520;
export const DECOR_SCALE_MIN = 0.35;
/**
 * The scale ceiling (owner decision 2026-07-13, playtester-requested) for
 * items WITHOUT a DECOR_SIZING entry (T3.3a2) - table items clamp at their
 * own maxScale instead.
 */
export const DECOR_SCALE_MAX = 0.85;
/**
 * `placeFromWarehouse`'s spawn scale for items WITHOUT a DECOR_SIZING entry
 * (T3.3a2) - table items spawn at their own defaultScale instead.
 */
export const DECOR_SPAWN_SCALE = 0.7;

/** The chain-snapping outline piece (T3.3a2) - special-cased throughout. */
export const FENCE_FRAME = 'decor_fence';
/**
 * Fences ALWAYS render, place, and migrate at this exact scale (owner
 * design constant, T3.3a2 - eyeballed to match one plot edge). The arrange
 * Scale controls are inert for fences; `setDecorationTransform` pins any
 * fence's scale here unconditionally.
 */
export const FENCE_FIXED_SCALE = 1.2;

/**
 * Fence chain-snap geometry (T3.3a2), measured by alpha-scanning the
 * 128x128 `decor_fence` atlas frame (Jimp, alpha>127 opaque bounds - the
 * frame has NO horizontal transparent padding; its opaque art spans the
 * full 128px, x 0..127):
 * - high (left) post body: x 9..39, y 7..77
 * - low (right) post body: x 94..118, y 49..119
 * - rails descend left-to-right at ~2:1 iso slope; short connector stubs
 *   poke past both posts to the frame edges.
 * Adjacent same-facing pieces OVERLAP: the next piece's high post lands
 * exactly on the previous piece's low post (left faces and tops aligned:
 * dx = 94-9 = 85, dy = 49-8 = 41), hiding the connector stubs behind the
 * post art - so the chain is seam-tolerant by construction. All values are
 * UNSCALED frame px; multiply by FENCE_FIXED_SCALE for design-space
 * offsets. Verified flush at 1.20 by pixel-compositing (T3.3a2).
 */
export const FENCE_CHAIN_STEP_X = 85;
export const FENCE_CHAIN_STEP_Y = 41;
/**
 * Corner (opposite-facing) junction offsets, for a neighbor at UNMIRRORED
 * facing and a lifted piece at MIRRORED facing - each shares one post pair
 * (derived from the post bounds above, mirrored around the frame center):
 * - high-on-high (top corner):    (9-(128-39),  0) = (-80,   0)
 * - low-on-low   (bottom corner): (94-(128-118),0) = ( 84,   0)
 * - high-on-low  (left corner):   post centers/bottoms aligned = (2, -42)
 * - low-on-high  (right corner):  mirror of the above           = (2,  42)
 * For a MIRRORED neighbor and UNMIRRORED lifted piece, negate each dx.
 */
export const FENCE_CORNER_OFFSETS: readonly (readonly [number, number])[] = [
  [-80, 0],
  [84, 0],
  [2, -42],
  [2, 42],
];
/**
 * Live-snap capture radius (design px): a lifted fence within this distance
 * of a candidate snapped position previews there; outside it follows the
 * finger free-form.
 */
export const FENCE_SNAP_RADIUS = 60;

/**
 * Candidate anchor offsets (design px, FENCE_FIXED_SCALE applied) from a
 * placed fence at facing `neighborFlip` for a lifted fence at facing
 * `liftedFlip` (T3.3a2). Same facing: continue the line either direction.
 * Opposite facing: the four shared-post corner junctions. Flip-aware, so
 * corners and direction changes stay flush.
 */
export function fenceSnapDeltas(
  neighborFlip: boolean,
  liftedFlip: boolean,
): readonly (readonly [number, number])[] {
  const scale = FENCE_FIXED_SCALE;
  if (neighborFlip === liftedFlip) {
    const sign = neighborFlip ? -1 : 1;
    return [
      [sign * FENCE_CHAIN_STEP_X * scale, FENCE_CHAIN_STEP_Y * scale],
      [-sign * FENCE_CHAIN_STEP_X * scale, -FENCE_CHAIN_STEP_Y * scale],
    ];
  }
  const sign = neighborFlip ? -1 : 1;
  return FENCE_CORNER_OFFSETS.map(([dx, dy]) => [sign * dx * scale, dy * scale]);
}

/**
 * Plot-edge snap (T3.3a2-r1): a lifted fence also snaps so its rail runs
 * exactly along one of a plot tile diamond's edges. Derivation, from the
 * same alpha-scanned frame geometry as the chain constants above:
 * - The fence's HIGH post (frame body x 9..39, center x 24; base y 77)
 *   STANDS ON the edge's upper corner - posts sit on the boundary line,
 *   rails run above it. Anchor offset from that post base, unflipped:
 *   ((64 - 24), -(77 - 64)) * FENCE_FIXED_SCALE = (+48, -15.6); flipped
 *   mirrors x to (-48, -15.6).
 * - Unflipped art descends left-to-right (~2:1 iso slope), matching a
 *   diamond's top-right (NE) and bottom-left (SW) edges; flipped art
 *   matches the top-left (NW) and bottom-right (SE) edges. Upper corners
 *   relative to the tile CENTER: NE and NW edges -> top (0, -tileH/2),
 *   SW -> left (-tileW/2, 0), SE -> right (+tileW/2, 0).
 * With the standard 256x128 tile this yields, per flip, exactly two
 * candidates relative to the tile center: unflipped (48, -79.6) and
 * (-80, -15.6); flipped (-48, -79.6) and (80, -15.6). Adjacent same-side
 * tiles then repeat at the (128, 64) corner pitch: the art (76.8px each
 * way from the anchor) overlaps the next piece's post, so junctions stay
 * flush by the same post-overlap principle as the chain step. Verified by
 * pixel-compositing a full 2x2 outline before wiring in (T3.3a2-r1).
 * KNOWN RESIDUE: the post pitch (102, 49.2) is shorter than the edge
 * (128, 64), so a pure edge-snapped outline leaves a ~6.4px stub-tip
 * notch at the block's BOTTOM apex - the one corner no candidate scheme
 * can cover with one candidate per edge.
 */
export const FENCE_EDGE_ANCHOR_DX = (64 - 24) * FENCE_FIXED_SCALE;
export const FENCE_EDGE_ANCHOR_DY = -(77 - 64) * FENCE_FIXED_SCALE;

/**
 * The two flip-compatible plot-edge candidates (T3.3a2-r1) as offsets from
 * a plot tile's CENTER, for a lifted fence at facing `liftedFlip`. Tile
 * dimensions are parameters so this data module stays dependency-free -
 * callers pass TILE_WIDTH/TILE_HEIGHT from systems/iso.
 */
export function fenceEdgeSnapDeltas(
  liftedFlip: boolean,
  tileWidth: number,
  tileHeight: number,
): readonly (readonly [number, number])[] {
  const sign = liftedFlip ? -1 : 1;
  return [
    // Top-corner edge (NE for unflipped, NW for flipped).
    [sign * FENCE_EDGE_ANCHOR_DX, -tileHeight / 2 + FENCE_EDGE_ANCHOR_DY],
    // Side-corner edge (SW/left for unflipped, SE/right for flipped).
    [sign * (FENCE_EDGE_ANCHOR_DX - tileWidth / 2), FENCE_EDGE_ANCHOR_DY],
  ];
}

/**
 * Per-item arrange sizing (T3.3a2, owner-authored): `defaultScale` is the
 * `placeFromWarehouse` spawn scale, `maxScale` the arrange Scale-up ceiling.
 * They are equal by design - items spawn at showcase size and players shrink
 * to taste (the global DECOR_SCALE_MIN floor is unchanged). Catalog items
 * NOT listed here keep DECOR_SPAWN_SCALE/DECOR_SCALE_MAX. The fence is
 * pinned to FENCE_FIXED_SCALE outright (Part 1) - its row here keeps the
 * table exhaustive for migration clamping.
 */
export interface DecorSizing {
  defaultScale: number;
  maxScale: number;
}

export const DECOR_SIZING: Readonly<Record<string, DecorSizing>> = {
  trophy_traderscart: { defaultScale: 1.65, maxScale: 1.65 },
  trophy_goldscarecrow: { defaultScale: 1.15, maxScale: 1.15 },
  trophy_ancientoak: { defaultScale: 2.0, maxScale: 2.0 },
  trophy_moonwell: { defaultScale: 1.15, maxScale: 1.15 },
  decor_well: { defaultScale: 1.15, maxScale: 1.15 },
  decor_flowerbed: { defaultScale: 1.0, maxScale: 1.0 },
  decor_barrels: { defaultScale: 0.95, maxScale: 0.95 },
  decor_birdbath: { defaultScale: 0.9, maxScale: 0.9 },
  decor_scarecrow: { defaultScale: 1.0, maxScale: 1.0 },
  decor_mushrooms: { defaultScale: 0.85, maxScale: 0.85 },
  trophy_starbanner: { defaultScale: 0.95, maxScale: 0.95 },
  decor_gnome: { defaultScale: 0.85, maxScale: 0.85 },
  decor_lantern: { defaultScale: 1.0, maxScale: 1.0 },
  [FENCE_FRAME]: { defaultScale: FENCE_FIXED_SCALE, maxScale: FENCE_FIXED_SCALE },
};

/** `placeFromWarehouse`'s spawn scale for `frame` (T3.3a2). */
export function decorSpawnScale(frame: string): number {
  return DECOR_SIZING[frame]?.defaultScale ?? DECOR_SPAWN_SCALE;
}

/** The arrange-mode scale ceiling for `frame` (T3.3a2). */
export function decorMaxScale(frame: string): number {
  return DECOR_SIZING[frame]?.maxScale ?? DECOR_SCALE_MAX;
}

/**
 * `placeFromWarehouse`'s spawn position (T3.9b): screen center, so a newly
 * placed item is immediately visible and ready to drag.
 */
export const WAREHOUSE_PLACE_X = 540;
export const WAREHOUSE_PLACE_Y = 900;
