# Little Acres - Status

**Updated:** 2026-07-21
**Phase:** Phase 4 (production buildings). Flour mill + bakery COMPLETE end-to-end (buy -> produce -> sell/order); building flip and a 2-column west starter-area expansion shipped. Economy balance pass v2 shipped (T4.11).
**Schema:** v27 · **Tests:** 722 · **Live:** robfernandez066.github.io/littleacres/

## In flight

- None.

## Queued next

- **Q2 - ORDER_REFRESH_COOLDOWN** (new per-slot lever; small feature task; fixes the day-1 order spike). Next up.
- **Q3 - post-L8 content runway** (coins compound after ~day 12): needs content (more levels / a 2nd region / a recurring sink), not tuning. Deferred.
- Phase 4A creatures (coop + moonhen) and animated windmill blades - art staged in tools/art-staging.

## Completed (newest first)

- T4.11 economy balance pass v2 (crop/good/order/level/moondust/decor/quest retune + onboarding L2 reshape + 2-chest revive) - a9e542b (schema v27 unchanged; balance mirror re-exported)
- T4.10 starter area +2 columns west - 077d6ce (no schema change)
- T4.8 building flip (mill/bakery/farmhouse) - 0bdfdc1, schema v27
- T4.9 unlock levels mill L3 / bakery L4 - 35a4f43
- Balance mirror + contract (docs/balance/*.csv + README) - 5e1816a (+ README expand)
- T4.5 authored bakery shadow / T4.6 milling timer de-flake - 8b34ec4
- T4.4 bakery (Sunflour -> Bread) - 6b7f719
- T4.3 Sunflour orders - 08446e6, schema v26
- T4.2b/c/d mill UI + slots + bag + acquisition - 7122767 / cce75b5 (v25) / 748987b / 105d1d4 / d2462a9
- T4.2a milling model - 8557a33, schema v24
- T4.1 flour mill building + authored shadow - a133b98, schema v23
- T4.0 goods economy foundation (Sunflour, sellGood) - d569c3d, schema v22
- T3.30 Goals hub - fb7788b, schema v21
- Earlier (restoration v1, base-anchor structures, authored-shadow workflow, land+camera, waves 1-3): see docs/decisions.md and docs/archive/.

## Blockers

- None.

## Watch items

- Save durability stays open (T3.17 was corruption-recovery only): browser eviction + cross-device loss wait for the T7.4 save era.
- T4.11 lowered several XP thresholds (L2 900->30, all levels shifted down): loads are RAISE-only (reconcileLevelSilently), so an existing save can only be bumped UP a level, never demoted - confirmed safe, no migration.

## Backlog nits (fold into convenient tasks)

- gameState.test.ts "harvesting queues the same kind of event as addXp": its comment still says the L2 threshold is 900 and over-sizes the loop guard to 1000 - the test passes (L2 is 30, so it exits at ~15) but the derivation is stale; fix next time that file is touched.
- Decorations polish pass (sounds, arrange-mode juice, shop scroll >10 items, decor-over-plot rules).
- Partial crop selling (sell X, not all) - scheduling with owner.
- MAX-level order cards still advertise xp at the cap - de-emphasize.
- Reduced-motion toggle - ride a settings task.
- Dev-only cosmetics: 'Edit dressing' toggle full-width; dev.ts comment re-attachment.

## Open validations (real-device evidence still needed)

- Camera feel on the LIVE site from a real phone (post-deploy).
- T4.11 tutorial on a FRESH save (save backup first): the level-2 celebration + Starcorn reveal should fire on the ORDER A delivery, and plant-mixed should complete with 57 coins. The logic is unit-covered; this is the visual eyeball only.

## Waiting on user

- Local cleanup only the owner can do (PM cannot delete on device): stale review copies + the gitignored _to_delete/ folder.
