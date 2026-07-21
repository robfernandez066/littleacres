# Paths / Roads - design (in progress)

Status: ACTIVE - shape being locked with the owner one fork at a time; not yet a coder task. First build uses the single dirt texture.

## Model

Player paints roads onto the frozen iso tile grid (col,row diamonds, 256x128) - not free sprites, because a path only reads as a path when it snaps to the grid and connects. One tile is the atomic unit; the material texture fills the diamond. Width is emergent: paint parallel tiles for wider roads or plazas. Dirt-type textures abut and read continuous, so NO autotile/corner set is needed to start - that only matters later for crisp paved edges.

## Placement (proposed)

A "Path" tool in arrange/edit mode. Tap a tile to lay one, or drag across tiles to lay a run - reuses the existing drag-across-field gesture (plant/harvest) and tile-picking (plotPointer). Erase pulls a tile back up (see Open forks).

## Layer (proposed, not yet confirmed)

Cosmetic ground-decal layer: paths render UNDER crops/structures/characters (same depth as the grass_1 dressing decal), block nothing, paint anywhere in the owned area, and a plot can sit on a path tile. Simplest and most forgiving - no collision rules. The alternative (tile-exclusive: a path tile can't be farmed) adds placement rules and a spatial tradeoff; deferred unless wanted.

## Material tiers + pricing (pay-per-tile, provisional)

Bought per tile as painted, like planting - can't afford it, the tile doesn't lay. Paths are bought in BULK, so price through "what does a route (~20 tiles) or a plaza (~100 tiles) cost", not per-tile in isolation.

| tier | currency | ~price/tile | role |
|---|---|---|---|
| Dirt | coins | ~2 | near-free default, available from the start |
| Gravel | coins | ~15 | light coin sink |
| Stone | coins | ~70 | real investment; a plaza runs into the thousands |
| Moonstone | coins | ~300-400 | top prestige tier + endgame COIN sink |

All four are COIN tiers, so paths form a pure coin-sink ladder - directly helpful for the Q3 late-game coin surplus (stone and moonstone especially). Consequence: paths add NO moondust sink, so thin moondust sinks remain a separate open item.

## Decisions locked

- 2026-07-21: Moonstone = COIN sink, not moondust. It is the bulk endgame flex/sink, so it must be priced high enough to bite the late surplus (~300-400/tile provisional, PM to sim-check). Consequence noted above: no moondust sink from paths.

## Open forks

- Layer: cosmetic ground-decal (leaning) vs tile-exclusive.
- Tier unlocks: level-gated (e.g. dirt start / gravel L3 / stone L5 / moonstone L7-8) vs price-gated like decor.
- Erase: no refund (leaning - blocks buy/sell churn).
- Exact coin prices per tier: PM to pressure-test the ladder against the balance sim once the shape is set, so stone/moonstone actually bite the surplus without being unreachable.

## Art (staged 2026-07-21, rework pending)

Owner staged 4 tier raws (tools/art-staging/{dirt,gravel,stone,moonstone}_path_raw.png), all 1024x1024, fully opaque. Style + tier progression are excellent (rustic dirt -> sparkling premium moonstone). BUT each is composed as a straight VERTICAL road strip with GRASS EDGES baked into both sides - a "road segment" format, not the per-tile diamond MATERIAL the model needs. The baked grass edges are the blocker: a paintable tile must be material-only (the game's real grass shows around a path naturally), or a 2-wide road / junction / moonstone plaza gets grass stripes through its middle - and wide paving is exactly what makes stone/moonstone a real coin sink. They are also screen-vertical rectangles, not 256x128 diamonds (an iso run goes diagonally). The grass-free CENTER band of each raw IS the usable material. RESOLUTION PENDING (owner): re-export edgeless seamless square swatches (ideal) OR crop the centers from these and mask to the diamond. Note: the laid-block tiers (stone, moonstone) have directional courses that may seam/misalign when masked to diamonds and tiled across neighbors - dirt/gravel are safest; the block tiers may want a seamless or omnidirectional version.

## Storage

Per-tile `{ col, row, tier }` in save state (a schema addition when built). Each tier is its own diamond texture; extends straight to the owner's other path textures.
