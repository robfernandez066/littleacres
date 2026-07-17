# Restoration Chapter v1 - Boundary vs T3.3 Land Expansion

**Status:** ACTIVE - APPROVED (2026-07-15); scope contract for all restoration coder prompts. Wake: restoration design work starts after the land/camera package ships. Amendments resolved below (second structure = mere-edge dock; perks = light and per-building, PM menu at design time; structure movability logged as a future direction, v1 unchanged).

## Why this doc exists

The tester asked for "decorative buildings and/or upgrading the main farm
building." The wave 3 cut approved a Restoration chapter v1 for the second
slot, but T3.3 (land expansion) is the wave lead and both features change
what the farm looks like. Without a hard boundary they bleed into each other
and the coder prompts get muddy. This doc draws the line.

## The one-sentence boundary

**T3.3 makes the farm BIGGER; Restoration makes what you already own NICER.**

## What T3.3 owns (and Restoration must never touch)

- The grid: new regions, their coin prices, their level gates.
- Plot count growth and anything that changes farmable area.
- The overgrowth-clearing reveal moment when a region unlocks.
- The camera-visible world size (with T3.4).
- The mere glow brightening per unlocked region (the game's signature
  progression light).

## What Restoration owns (and T3.3 must never touch)

- Named, ALREADY-VISIBLE structures on land the player owns from day one.
  v1 set (owner pick, 2026-07-15): the FARMHOUSE and the MERE-EDGE DOCK.
  The dock won over the well because it touches the water: it can carry
  future content (fishing, boats, mere events) where the farmhouse is
  purely pride. v1 is deliberately tiny - two structures, no more.
- Multi-stage visual upgrades per structure (suggest 3 stages for the
  farmhouse: weathered -> mended -> flourishing), bought with coins +
  moondust. Art swaps per stage, small celebration on completion.
- A small chapter checklist UI ("Restore the Homestead") showing each
  structure's stages - pride and direction, not pressure. No timers, no
  streaks, no FOMO (GDD rules apply as everywhere).
- Persistence: restoration progress in the save (schema bump when built).

## Explicit non-goals for Restoration v1

- NO new land, tiles, plots, or camera changes (all T3.3/T3.4).
- NO production mechanics - upgraded structures do not produce goods.
  (Production buildings are Phase 4; the farmhouse upgrade must not become
  a proto-Mill.) Perks (owner direction, 2026-07-15): LIGHT and
  PER-BUILDING, thematic to each structure (example floated: farmhouse
  raises the chance of X per restoration stage). PM proposes a researched
  perk menu per structure at restoration design time; owner picks. Perks
  must stay passive and bonus-framed - never a chore, timer, or FOMO hook.
- NO new currencies or materials. Coins + moondust only. (The Mine's
  materials economy stays dropped/parked.)
- NO restorable ruins inside NEW T3.3 regions in v1. That is the natural
  v2 hook (a freshly cleared region reveals a ruin to restore later), and
  writing it down here is where v1 stops.

## Interaction rules where they meet

1. Level gates may reference the same level curve, but neither feature ever
   gates the other: you can restore everything while owning no new land,
   and expand everything while restoring nothing.
2. Both spend the same wallet (coins/moondust). Balance rule of thumb for
   prompt time: a restoration stage should cost less than the cheapest
   unopened land region, so restoration is the "small satisfying purchase"
   between land saves.
3. Visual layering: restoration art replaces structure frames in place;
   it never moves a structure, so T3.3's region geometry and T3.4's camera
   bounds are unaffected.
4. The decor shop and warehouse are untouched by both (T3.9 systems).
   Restoration is not decor: decor is player-placed and movable; restored
   structures are fixed landmarks IN V1. Owner direction (2026-07-15):
   structures should EVENTUALLY become movable - a full-farm rearrangement
   conversation (everything movable: structures, maybe more) is queued as
   its own design topic. It interacts with arrange mode, T3.3 regions, and
   T3.4 camera bounds, so it gets designed after the land/camera package
   ships. v1 restoration builds nothing that blocks it (art swaps in place
   carry over to a movable structure unchanged).

## Art dependency (flag for batching)

Farmhouse stages 2-3 plus any second structure's stages are new Sprixen
art. Per the standing convention, batch them into one generation session
(farmhouse style reference) and stage under tools/art-staging before the
code task is cut.

## What approval unlocks

On owner approval: PM writes the T3.3+T3.4 design decisions first (wave
lead), and restoration coder prompts only get written after the land/camera
package ships, using this boundary as the scope contract.
