# Little Acres - Status

**Updated:** 2026-07-10
**Phase:** Phase 2 - content + polish (post design-review re-cut; see docs/design-review-2026-07-10.md)
**Schema:** v9 · **Tests:** 226 · **Live:** robfernandez066.github.io/littleacres/

## Active

- **T2.28 series close-out** (user): pack:atlas (v2 tufts) -> trio -> look-over (tiles_flat now DEFAULT after owner verdict + depth fix; full-screen ground; owner-baked dressing layout; front-decals capped below UI) -> optional re-place with v2 tufts (send JSON, PM bakes) -> commit (message delivered).
- Dressing workflow ESTABLISHED: owner places in the dev editor, Copy layout, PM bakes JSON into config PM-direct. Ground texture candidates PARKED (verdict: garbage); tiles_flat (pack-time derived seamless face from existing tile art, synthetic rhombus mask) WON.
- Since last status: T2.25, T2.15 (seed info cards), T2.23b+T2.27+T2.23c (multi-chest ceremony, dev buttons, moondust fly-in), T2.26 (music playlist + credits) all DONE committed+pushed. PM-direct fixes this round: background depth -2, ground-layer depth pin, full-screen ground, front-depth 1950, layout bake, v2 tufts in packer/palette, GROUND_MODE=tiles_flat.

## Queue (in order)

1. T2.28 series commit (in flight above)
2. PHASE 2 GATE: external playtest round - 3-5 fresh installs (user-approved), PM triages notes as a mini-gate. PM prep: a short tester brief (what to try, where to send notes)
3. Post-gate: Phase 3 planning (balance-v1.xlsx is the economy source of truth)

## Waiting on user (whenever convenient)

- Blend-batch Sprixen picks: grass_flat, tuft_1/2, stones_1, dirt_wisp (prompts delivered 2026-07-10)
- chest.mp3 (Pixabay: short treasure-chest open, <2s) - ceremony ships without it until staged

## Backlog nits (fold into convenient tasks)

- formatCurrency unit tests (pure function in Hud.ts)
- Move formatAwayDuration to src/data/ so it's unit-testable (currently untestable: imports Phaser)

## Blockers

- None.

## Watch items

- None open. (Resolved history + lessons live in decisions.md.)

## Standing notes

- PM owns docs/; coder never reads docs/. PM maintains this file + decisions.md after every report/decision.
- Every task prompt carries a model recommendation (Fable5/Opus vs Sonnet) and a session marking; /clear is the default.
- Commit flow: PM states testing needed, then supplies git commands in run order; user runs all git; tasks sharing files get one combined commit.
- PM reviews fresh coder work via direct Reads only (sandbox mount corrupts fresh writes - see decisions 2026-07-10 audit entry).
- Coder sessions may leave dev servers on 5177 - kill before starting your own.
- Close stray game tabs during coder sessions (two-tab autosave overwrite).
- Atlas regen script: `npm run pack:atlas`.
