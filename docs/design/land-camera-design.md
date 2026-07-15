# T3.3 + T3.4 - Land Expansion & Camera: Design Decisions

**Status:** DRAFT for owner review (PM, 2026-07-15). The wave 3 lead package.
Decision points are collected at the end; nothing goes to the coder until the
owner picks.

## Where the code is today (verified by fresh reads)

The whole game lives in one fixed 1080x1920 design space (Scale.FIT, no
camera movement anywhere). The farm is a 2:1 iso grid, 256x128 tiles, 4
columns x 3 rows base, with one legacy purchase (500 coins, the ExpandSign)
growing it to 4x4 = 16 plots. A 4x4 grid already spans 1024px of the 1080px
width: THE SCREEN IS FULL. Any real land growth forces the camera to become a
real system - which is why T3.3 and T3.4 ship as one package.

Two more facts that shape everything: single-finger drag is the FARMING
gesture (plots plant/harvest as the finger sweeps across them), so
single-finger camera panning is off the table; and the grid currently
re-centers itself each time it grows (isoOrigin), which stops making sense
once a camera exists - the world should stay put and grow outward.

## The shape of the change

The world becomes 2160 x 2880 design px (2x wide, 1.5x tall). The camera
shows a window into it. The DEFAULT view always fits the player's OWNED land
- so a player who never touches the camera plays exactly like today, one
hand, everything visible. Zooming and panning are optional depth, not
required motion. That is how the "one-hand default" guardrail survives a
bigger farm.

## Regions (the T3.3 content)

Three purchasable regions in wave 3, each a named chunk of the new world:

- **R1 East Meadow** - adds 2 columns: grid 6x4, +8 plots (24 total).
- **R2 South Clearing** - adds 2 rows: grid 6x6, +12 plots (36 total).
- **R3 Mere Shore** - the west band along the new (regenerated) mere:
  NO plots. Open decor ground plus the dock site - this is restoration and
  arrange-mode country, and it keeps one region's identity about beauty
  rather than production.

The legacy 4th-row expansion is absorbed as an already-owned region in the
migration (owners of the old expansion lose nothing). Unpurchased regions are
visible but overgrown (bramble/mist art); each has a sign at its edge - the
existing ExpandSign generalizes. Buying triggers the reveal: a clearing sweep
across the region's tiles with particles and sfx, and the mere glow steps
brighter (the per-region ambience beat, once the new mere art exists).

Region definitions carry geometry and price ONLY - no structure positions
baked in (keeps the future full-farm-rearrangement door open).

## Pricing and gates (proposed, balance-sheet pass before shipping)

- R1 East Meadow: level 6, 5,000 coins
- R2 South Clearing: level 8, 15,000 coins
- R3 Mere Shore: level 9, 30,000 coins + 50 moondust (the beauty region
  taps the beauty currency)

These follow the current curve (top order rewards run hundreds of coins;
level 8 is reachable - the tester got there in two days). Exact numbers get
a balance-sheet v3 pass and your explicit approval in the task prompt that
ships them, same as the weekly quest numbers.

## Camera (the T3.4 content)

**Architecture: two cameras in FarmScene.** The main camera renders the world
and learns to pan/zoom; a new UI camera renders HUD/panels/bars fixed,
exactly as they render today (each camera ignores the other's object list).
This is the riskiest engineering in the package - every UI class keeps its
coordinates, but every world-input site must start asking for WORLD
coordinates (pointer.worldX) instead of screen coordinates. It ships first,
alone, with zero player-facing change, so everything after it composes on a
verified base.

**Gestures, under your guardrails:**

- Two-finger pan, pinch to zoom (pinching also pans - standard map feel).
  Single finger stays 100% farming.
- While 2+ fingers are down, ALL farming input is suppressed, and it stays
  suppressed until every finger lifts (your "pinch suppresses taps").
- Zoom range: from fit-owned-land (the default) in to about 1.6x for detail
  and arranging. You can never zoom OUT past fit-owned - no oceans of dead
  space, bounds stay tight to owned land + a small margin (your guardrail).
- Pan clamps to the same bounds with a soft rubber-band snap-back at edges;
  panning must feel SMOOTH (your 2026-07-12 emphasis).
- A small recenter button appears only when the view is off-default; one tap
  glides back to fit-owned. (Reset/recenter guardrail.)
- Buying a region animates the default view growing to include it.
- Desktop dev convenience: mouse-wheel zoom. Not a player surface.

## Art batch (after Decision 1 fixes the world size)

One Sprixen batch, generated against the approved world dimensions: the new
mere (west edge, sized to 2880px of world height - replaces the rejected
sprite), overgrowth/bramble tiles + mist, region ground variants, the
generalized region sign, and the dock's ruined stage-0 (restoration v1
dependency, placed on the Mere Shore).

## Task cut and order

1. **T3.4a Camera foundation** - dual camera split, world-coordinate input
   audit, no player-facing change. Riskiest first, alone.
2. **T3.4b Gestures + guardrails** - pinch/pan/bounds/suppression/recenter
   at the CURRENT world size (zoom-in only until land grows).
3. **T3.3a Region state** - region model + schema v16 migration absorbing
   the legacy expansion; grid stops re-centering (world origin freezes).
4. **Art batch** - owner generates against approved dimensions; pack atlas.
5. **T3.3b Regions on screen** - overgrowth, signs, purchase flow, reveal
   animation, camera bounds growth, default-fit zoom stepping.

Each is a separate coder task with its own review/test/commit. Restoration
design (perk menu, dock stages) starts after this package ships.

## Decision points (owner)

1. **World growth target.** A (recommended): as written - 3 regions, final
   grid 6x6 = 36 plots + the plotless Mere Shore, world 2160x2880.
   B (smaller): drop R2 for wave 3 (6x4 = 24 plots + Shore), same world size,
   R2 becomes wave 4 content. C: propose different sizes.
2. **Mere Shore identity.** A (recommended): zero plots - pure decor +
   restoration ground. B: add 2-4 plots so it also farms.
3. **Pricing philosophy.** A (recommended): coins for R1/R2, coins + moondust
   for the Shore; exact numbers via balance pass later. B: coins only
   everywhere. (Numbers themselves come back for approval either way.)
4. **Gestures.** A (recommended): two-finger pan + pinch as written.
   B: also allow single-finger pan when the drag STARTS on empty non-plot
   ground (riskier: mis-pans while swipe-farming near edges).
5. **Task cut and order.** A (recommended): the 5-step sequence above.
   B: reorder/merge - say what you'd change.
