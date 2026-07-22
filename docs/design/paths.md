# Paths / Roads - design

Status: ACTIVE. v1 (gravel, free) shipped 2026-07-22 (T4.12, commit 20eb5d6): the paint system, the cosmetic ground layer, and the per-tile model. The FOUR-TIER COIN LADDER shipped 2026-07-22 (T4.13): dirt (free, default) / gravel 15 / stone 70 / moonstone 350, all COIN sinks, with their edgeless-diamond tile art. NEXT (decided, not built): T4.14 tile reclaim - a per-tier storage bank + Remove All.

## Model

Player paints roads onto the frozen iso tile grid (col,row diamonds, 256x128) - not free sprites, because a path only reads as a path when it snaps to the grid and connects. One tile is the atomic unit; the material texture fills the diamond. Width is emergent: paint parallel tiles for wider roads or plazas. Dirt-type textures abut and read continuous, so NO autotile/corner set is needed.

## Placement (SHIPPED)

A "Paths" panel (HUD Shop -> Building Shop -> Paths) enters a PERSISTENT paint mode. Tap a tile to lay one, or drag across tiles to lay a run - grid-line interpolated (4-connected, no diagonal so adjacent tiles share an edge, no gaps on a fast drag) and rendered incrementally per tile so a large area never lags. Erase pulls a tile back up. A per-tile deterministic mirror (hash of col,row) breaks up obvious repetition in a long run.

## Layer (SHIPPED)

Cosmetic ground-decal layer: paths render UNDER crops/structures/characters (same band as the grass_1 dressing decal), block nothing, paint anywhere in the owned area, and a plot can sit on a path tile. No collision rules. The tile-exclusive alternative (a path tile can't be farmed) was not taken.

## Material tiers + pricing (SHIPPED, T4.13)

Bought per tile as painted, like planting - can't afford it, the tile doesn't lay. Priced by what a route (~20 tiles) or a plaza (~100 tiles) costs, anchored to the existing sink ladder (East Meadow 7,500; farmhouse restore 50k), NOT a fresh sim run - paths are OPTIONAL cosmetic spend the sim does not model demand for.

| tier | currency | price/tile | route ~20 | plaza ~100 | role |
|---|---|---|---|---|---|
| Dirt | coins | 0 (free) | 0 | 0 | the free default a player lands on |
| Gravel | coins | 15 | 300 | 1,500 | light coin sink |
| Stone | coins | 70 | 1,400 | 7,000 | real investment (~one East Meadow at plaza scale) |
| Moonstone | coins | 350 | 7,000 | 35,000 | top prestige tier + endgame COIN sink (~farmhouse scale) |

All four are COIN tiers, so paths form a pure coin-sink ladder - directly helpful for the Q3 late-game coin surplus (stone and moonstone especially). Consequence: paths add NO moondust sink, so thin moondust sinks remain a separate open item. `DEFAULT_PATH_TIER = 'dirt'` (the free rung a player lands on).

## Decisions locked

- 2026-07-21: Moonstone = COIN sink, not moondust. The bulk endgame flex/sink, priced high enough to bite the late surplus.
- 2026-07-22 (T4.13): Four-tier ladder dirt 0 / gravel 15 / stone 70 / moonstone 350. Gravel repriced 0 -> 15 (reverses the v1 gravel-free stopgap now that dirt is the free default). NO level gates - coin-gated only; the high moonstone price is its own gate. Dirt is the default tier.
- 2026-07-22 (T4.14, decided - not built): reclaim / storage model (see below). This SUPERSEDES the earlier "erase = no refund" fork - erase now banks the tile into storage instead of destroying it.

## Reclaim / storage bank (T4.14 - DECIDED, NOT YET BUILT)

Coins MINT a tile of a tier that the player then OWNS. Placing draws from a per-tier storage bank first (free); coins are charged only when that tier's storage is empty (minting a new one). ANY removal - single Erase AND a new "Remove All" button - returns the tile to storage (storage++), never to coins (no resale, so no coin churn). Net invariant: a player can place at most as many tiles of a tier as they've minted; coins only ever leave via paths, never come back.

- State: `pathBank: Record<PathTierId, number>`; schema bump v28 -> v29 (additive, zeros).
- Panel shows per-tier stored counts; a tier is placeable if storage > 0 OR coins >= cost (coin-gated, never hidden).
- Remove All: two-step confirm tap (no blocking modal); disabled when nothing is placed.
- The "-N" coin float fires only on ACTUAL coin spend (minting), not on free placement from storage.
- Upgrading a tile in place banks the replaced tile (never destroys it).
- Sequenced AFTER the incoming UI rework (which reshapes these panels); coder prompt written and ON HOLD.

## Art (SHIPPED, T4.13)

Four tier masters at tools/art-staging/{dirt,gravel,stone,moonstone}_path.png, each a 512x256 iso diamond (transparent corners, alpha reaching all four edge midpoints) so pack-atlas's processPathTile trims to a no-op and packs each as a 256x128 tile that butts flush on the iso grid. Sourced by cropping the grass-free CENTER band out of the owner's road-strip raws (the raws are vertical strips with grass baked into both sides). Dirt was authored - a clean flat base plus scattered pebble stamps, with the edge vignette flattened - so it tiles seamlessly without dark edge seams (an early tight center crop looked blank; the wide crop grabbed the pebbles). Known: the laid-brick tiers (stone, moonstone) show faint diagonal seams on large plazas where courses don't align across tile edges - acceptable for the stylized look; revisit only if wanted. Packing found + fixed a name collision: `dirt_path` was double-registered (a 288 square in SQUARE_DOWNSCALE_SIZES AND a path tile) which dropped one copy - the unreferenced square was removed.

## Storage (save)

Per-tile `{ col, row, tier }` in `paths: PathTile[]` (schema v28). T4.14 adds `pathBank: Record<PathTierId, number>` (schema v29).
