# The Mere - Art Direction Brief (v2, "nature-made")

**Status:** PARKED (2026-07-22) - the west mere reserve was absorbed by the T4.10 expansion (see decisions.md 2026-07-21); wake if a pond/mere lands in a future strip or region. The v2 "nature-made" direction stands when it wakes. Supersedes the rejected round-1 small-pond sprite. Archived 2026-07-22.

## The one-line direction

The mere is not an object on the farm - it is the EDGE OF THE WORLD. The
land ends at it; it does not sit in the land.

## What makes water read "nature-made" (design rules)

1. **Never fully visible.** The mere runs the entire western edge of the
   world and bleeds off the frame north, south, and west. No player camera
   position ever shows a far bank or a complete outline. A pond has edges;
   a mere has a horizon.
2. **Irregular shoreline.** Coves, promontories, a reed-choked inlet, a
   gravel shallow, a rocky outcrop - assembled from multiple distinct edge
   pieces so no repetition reads. Absolutely no smooth oval curvature.
3. **Depth gradient.** Translucent pebbly shallows at the bank, deepening
   through blue-green to near-black moonlit deep water toward the frame
   edge. Depth = age = nature.
4. **The land responds to it.** A marshy transition band - darker wet
   grass, cattails, reeds, half-sunk boulders, one leaning willow - so the
   farm's grass never butts straight into water like lawn against a liner.
5. **The magic comes FROM the depths.** The glow emanates up out of the
   deep water (soft moonlight patches, the moondust fiction), not a rim
   light around the edge. This is the layer region-unlocks brighten.
6. **One mystery.** A single distant silhouette in the far water - a
   standing stone or tiny islet, barely visible in the mist. Never
   explained in v1; it is the hook the dock eventually points toward.

## Composite parts (updated)

- **Water band** - the hero piece: full world-height western band (author
  against the final 2880-tall world; the day-one world crops it), depth
  gradient and deep-water darkness baked in.
- **Shoreline edge set** - 4-6 distinct pieces (cove, promontory, reed
  inlet, gravel shallow, rock outcrop) to seam land to water without
  repetition.
- **Glow overlay** - separate sprite(s), moonlight-from-below patches over
  the deep water; tinted brighter per region unlock. Never baked into the
  water band.
- **Shimmer layer** - subtle surface sheen, slow alpha tween in code.
- **Ecology decals** - cattails, reeds, half-sunk boulders, leaning
  willow, marsh tufts, mist wisps; placed along the band like dressing.
- **Mystery silhouette** - one small far-water decal, mist-faded.

## Generation guidance (Sprixen or Scenario)

Prompt vocabulary that fights the pond read: "ancient mere", "glacial
lake edge", "dark deep water", "irregular natural shoreline", "reed beds
and half-sunken boulders", "soft moonlit glow rising from the depths",
"mist on the water", plus the game's standing style anchors (farmhouse
reference, cozy hand-painted). Negative/avoid: "pond", "garden",
"circular", "fountain", "landscaped". Author large and crop; the band can
be generated in overlapping sections and stitched since the shoreline
pieces hide seams by design.

## Resolved: day-one visibility (owner, 2026-07-16)

A sliver of the mere IS visible at the day-one world's western edge - the
game's signature on screen from the first session; the Shore region later
unlocks the usable land beside it.

## Generation sizes (owner asked; author once against the FINAL world)

- Water band: ~640 x 2880 in-world px (full world height; western ~400-500px
  open water). Generate as THREE overlapping vertical sections (~768x1344,
  ~150px overlap), stitch; shoreline pieces cover the seams by design. East
  edge is hidden under shoreline strips, so the band ships opaque.
- Shoreline edge pieces (4-6): ~384-512 x 256-384 target, transparent PNG;
  generate at ~2x and downscale.
- Glow overlay patches (2-3): 256-512px soft alpha blobs, generated DIM -
  the engine additive-blends and tints them (region brightening).
- Shimmer: one ~512x512 alpha sheen, or derive from a glow patch in code.
- Ecology decals: 96-256px transparent PNGs each (decor-master sizing; can
  join the atlas). Mystery silhouette: 192-256px, generated mist-faded.
- Standing rule everywhere: generate at 1.5-2x target, downscale; test every
  piece over a real game screenshot at final size.
