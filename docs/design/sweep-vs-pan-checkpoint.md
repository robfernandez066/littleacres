# Sweep-vs-Pan at Scale - R1 Checkpoint Protocol (PARKED until T3.3b ships R1)

**Status:** PARKED (2026-07-15) - wake when T3.3b ships R1 East Meadow; this file IS that checkpoint's agenda item. Do not act before then except the one adopted scope item below (the two-finger-pan hint, folded into T3.3b). Owner + PM + external input merged.

## The issue (3 sentences)

A one-finger swipe means two things - starting on a ready crop it harvests,
starting anywhere else it pans - decided by what is under the finger at
touch-down. Today that works because empty ground is always reachable; on an
expanded farm, a zoomed-in player whose screen is full of ready crops has
almost nowhere to start a pan (though two-finger panning always works). The
fix candidates trade the harvest sweep's feel against navigation
reliability.

## Decided now (owner-approved 2026-07-15)

- R1 SHIPS WITH THE CURRENT MODEL - an honest baseline, no premature
  redesign.
- ADOPTED into T3.3b scope: a one-time hint at expansion unlock - "Drag with
  two fingers to move across crops" - plus the same line available in
  settings/help. Two-finger panning becomes taught, not hoped-for.
- NOT adopted: a dev toggle shipping all three candidates (building the
  scythe to test the scythe is the premature work this plan avoids).

## The candidates

1. **Zoom-threshold rule** (swipes pan above some zoom): cheap, but it is an
   INVISIBLE MODE SWITCH - the same gesture changes meaning at an unmarked
   camera boundary. Hidden modality; adopt only if testing shows players
   naturally expect it (see decision rule). Demoted from PM lean.
2. **Scythe tool** (explicit harvest mode): intent becomes explicit and
   predictable; costs a tool-selection step, HUD space, mode bugs,
   tutorialization; overlaps the Phase 5 Harvest Golem (automation is the
   roadmap's answer to harvesting-at-scale). External advisor's favorite;
   PM keeps it a candidate, not a favorite.
3. **Keep the model** + taught two-finger pan + future automation: zero new
   modality; depends on two-finger feeling comfortable rather than merely
   possible.

## The hardware test (run at the checkpoint)

Setup: real phone, 24+ plots, ALL crops ready, camera zoomed until no empty
ground is comfortably reachable. Tasks:

1. Pan to the opposite side of the farm.
2. Harvest several crops.
3. Pan again immediately.
4. Alternate harvesting and navigating several times.
5. Repeat one-handed where physically possible.

Record: wrong harvests (tried to pan, harvested), wrong pans (tried to
harvest, panned), hesitation, whether two-finger panning is discovered
WITHOUT prompting, whether the unlock hint is remembered, recovery after a
mistake.

## Decision rule

- KEEP the current model only if players navigate reliably and two-finger
  panning feels comfortable rather than merely possible.
- Choose the SCYTHE if players repeatedly harvest while attempting to pan,
  forget the two-finger gesture, or need dependable one-finger navigation.
- Choose the ZOOM THRESHOLD only if testing shows a clear, naturally
  understood camera state where players consistently expect panning - 
  otherwise reject it as hidden modality.
