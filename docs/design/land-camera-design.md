# T3.3 + T3.4 - Land & Camera: Design FINAL (v3)

**Status:** FINAL (PM, 2026-07-15). All decision points resolved by owner
(round 2 picks: 1A, 2A-with-end-state, 3A-with-shed-spawn, 4 PM order,
5C). Two PM rules embedded below are flagged; owner may veto. T3.4a is
already with the coder.

## Locked decisions

- World 2160x2880; pick A on regions (checkpoint after R1 ships).
- Gesture model v2 approved AS WRITTEN, including the plant-sweep extension
  and arrange-mode pan: a drag does the most specific thing under the finger
  at its start (ready crop = harvest sweep; empty plot + seed = plant sweep),
  otherwise ONE-FINGER PAN; gesture locks at finger-down; pinch anywhere,
  any time, day-one farm included; camera disabled during tutorial rails.
- Two cameras; T3.4a foundation first (in flight); zoom to ~1.6x; tight
  bounds + dimmed visible locked fringe; rubber-band; recenter button;
  default view grows on purchase; wheel for dev.
- Pricing structure as proposed; numbers via balance pass + owner approval
  at prompt time; extensible cost model (future rare-material gating logged).
- Art: composite landmarks (mere = water band + shore strips + glow overlay
  + shimmer + decals); owner generates the batch in parallel, any time.

## Plots: the placement system (owner picks 2, 3, 5 + snap feedback)

**Granted plots spawn in the SHED** (owner direction) - they appear as
placeable items alongside stored decor and use the existing warehouse flow.
No floating counters.

**Region purchase flow (owner pick 5C):** land clears with a quick fade,
then a centered popup with TWO buttons:
- "Confirm" closes the popup; the Edit Layout button FLASHES until every
  granted plot is placed.
- "Place Now" opens Edit Layout immediately with one plot already selected
  and pre-positioned NEAR the existing farm layout (never on an existing
  plot), snapped and ready to drag.
Leaving Edit Layout (Done) with plots still unplaced resumes the flash until
all are placed.

**All plots become movable (owner end-state, pick 2):** existing plots keep
their current default positions in the migration, but any plot can be picked
up and moved in Edit Layout. **PM rule (veto-able): a plot can only be moved
while EMPTY** - no growing crop in it. Moving live timers/crop sprites is
where the bugs live; "harvest it, then move it" is clean and reads fair.
Plots with crops render normally in Edit Layout but do not lift.

**Placing on the Mere Shore is allowed** (owner pick 3): the Shore grants no
plots of its own, but players may place plots there if they wish. Player
freedom wins over region identity.

## Snapping rules (owner feedback, expanded)

- **Plots:** always snap to the iso grid. Adjacency comes free - dragging
  near an existing plot's edge lands cleanly on the neighboring tile. No
  pixel-fiddling possible.
- **Fences (decor_fence):** end-to-end CHAIN SNAP - dragging a fence near an
  existing fence's endpoint snaps it flush to continue the line, flip-aware
  (the snap works out the joining geometry from both pieces' flip states).
  Normalized width = EXACTLY 1 PLOT WIDTH (owner, 2026-07-15): fence lines
  match the plot grid, which is what makes chains useful for framing farms.
  Fences LOSE Scale +/- (size locked) - uniform size is what makes chain
  snapping clean. Existing placed fences migrate to the locked scale.
  **PM rule (veto-able):** fences of different current scales snap after
  being normalized by the migration; any player with a scaled fence sees it
  at standard size after the update.
- **Everything else (trophies, decor):** free-form exactly as today. No snap.

## Task cut FINAL

1. **T3.4a Camera foundation** - IN FLIGHT (dual cameras, zero visible
   change).
2. **T3.4b Gesture model v2** - one-finger pan, pinch, bounds, rubber-band,
   recenter, tutorial gating. Immediate value on today's farm.
3. **T3.3a Plots system** - explicit plot coordinates (schema bump +
   migration), plots as shed items, place/move flow with grid snap,
   empty-only move rule, popup 5C flow (dormant until a region grants
   plots; dev-grant verified).
4. **T3.3a2 Fence chain snap** (small) - end-to-end snapping, flip-aware,
   scale lock + migration. Reuses T3.3a's fresh snap infrastructure.
5. **T3.3b Regions** - region model (extensible costs), dimmed locked land,
   signs, purchase flow wired to the popup + shed grants, camera bounds
   growth. R1 East Meadow first; OWNER CHECKPOINT before R2/R3 lock.
6. **T3.3c Mere composite + Shore** - assemble layered mere, glow steps,
   Shore land (plot placement allowed). Needs the art batch.

Art batch (owner, parallel, any time from now): composite mere parts,
overgrowth tiles, region sign, dock ruined stage-0.

## Open items deliberately NOT in this package

Full-farm rearrangement (structures movable) - parked, designed after this
package ships. Restoration chapter design (perk menu, dock stages) - after
this package ships. Partial sell - deferred by owner, raise at inventory
economy time.
