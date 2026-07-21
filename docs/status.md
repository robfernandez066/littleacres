# Little Acres - Status

**Updated:** 2026-07-21
**Phase:** Phase 4 (production buildings). Flour mill + bakery COMPLETE end-to-end (buy -> produce -> sell/order); building flip and a 2-column west starter-area expansion shipped. Applying the economy balance pass v2 (T4.11).
**Schema:** v27 · **Tests:** 720 · **Live:** robfernandez066.github.io/littleacres/

## In flight

- **T4.11 - economy balance pass v2 APPLY (not yet committed).** Full crop/good/order/level/moondust/decor/quest retune from a simulation-expert agent, PM-verified (11.45d L1->L8, 21/21 invariants, sim re-run in-sandbox). Fixes the flat-coins/hr dead-tier via session-gap-matched crops + sublinear payoff. Owner calls: growth re-spacing accepted (Q1), Sagesprig 9h->7h (Q5), farmhouse 50k->100k (Q4). Coder task written = data-only across ~11 src/data files + broad test re-pins; XP thresholds jump hard (config not schema; stored level only increases; SAVE BACKUP first). After it commits, PM re-exports docs/balance/*.csv from src/data.

## Queued next

- **Q2 - ORDER_REFRESH_COOLDOWN** (new per-slot lever; small feature task; fixes the day-1 order spike). Runs after T4.11.
- **Q3 - post-L8 content runway** (coins compound after ~day 12): needs content (more levels / a 2nd region / a recurring sink), not tuning. Deferred.
- Phase 4A creatures (coop + moonhen) and animated windmill blades - art staged in tools/art-staging.

## Completed (newest first)

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
- Applying T4.11's XP-threshold jump: confirm no existing save is demoted (stored level only increases, T1.7).

## Backlog nits (fold into convenient tasks)

- Decorations polish pass (sounds, arrange-mode juice, shop scroll >10 items, decor-over-plot rules).
- Partial crop selling (sell X, not all) - scheduling with owner.
- MAX-level order cards still advertise xp at the cap - de-emphasize.
- Reduced-motion toggle - ride a settings task.
- Dev-only cosmetics: 'Edit dressing' toggle full-width; dev.ts comment re-attachment.

## Open validations (real-device evidence still needed)

- Camera feel on the LIVE site from a real phone (post-deploy).

## Waiting on user

- Local cleanup only the owner can do (PM cannot delete on device): stale review copies + the gitignored _to_delete/ folder.
