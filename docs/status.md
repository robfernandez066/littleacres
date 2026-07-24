# Little Acres - Status

**Updated:** 2026-07-22
**Phase:** Phase 4 + U-WAVE COMPLETE (2026-07-24): unified Shop (Buildings/Paths/Decor), Shed pipeline (never rebuy), edit-scene rework (contextual toolbar, Undo/Cancel/Save, long-press entry, alpha-aware selection), paths painted from the Shed. Spec: docs/design/shop-edit-ui-spec.md (SHIPPED).
**Schema:** v33 · **Tests:** 861 · **Live:** robfernandez066.github.io/littleacres/

## In flight

- **U-wave: Shop & Edit UI overhaul** (spec: docs/design/shop-edit-ui-spec.md; supersedes T4.14). U-wave + U5 family COMPLETE (794cb14). P-wave open, REORDERED P2 first (direct owner request). **P2 (soft-ellipse decor shadows, pack-time generator, complex) is ACTIVE - run the coder loop.** Then P1 art-contract templates -> P3 Capacitor spike.

## Queued next

- **P1** art-contract templates (footprint diamond + base-contact box baked into generation masters).
- **P3** Capacitor wrap spike (end goal native mobile, decided 2026-07-23).
- **Q3 post-L8 content runway** resurfaces after the P-wave (content, not tuning).
- **Remove-all-decor-to-Shed** (owner request, post-U4; two-step confirm).
- **P-wave (pipeline hardening, after the U-wave):** P1 art-contract templates per category; P2 unified soft-ellipse shadow generator (decor ovals + building default; owner picks from captures first); P3 Capacitor wrap spike (end goal is native mobile - decided 2026-07-23).
- **Q3 - post-L8 content runway** (coins compound after ~day 12): needs content (more levels / a 2nd region / a recurring sink), not tuning. Paths stone/moonstone now absorb part of the coin surplus.
- Phase 4A creatures (coop + moonhen) and animated windmill blades - art staged in tools/art-staging.

## Completed (newest first)

- U5-r2 shop-header Shed button (badge count, opens Shed panel via edit mode) - 794cb14
- U5(+r1) Store All Decorations + Clear All Paths (edit-layout secondary row, one undo group each), path-tile long-press, fresh-placement one-touch drag - 1371d4a, tests 861; owner device pass
- U4(+r1) Paths tab + paint-from-Shed (coin charge -> buy time, erase refunds, stroke undo groups, vector tier chips, PathsPanel deleted) - 09fb2d0, tests 859; owner device pass. **U-WAVE COMPLETE.**
- U3c(+r1,r2) long-press edit entry + alpha-aware occluded selection (topOnly-proof manual collector - fixed latent buried-asset cycling) + paint pinch guard + empty-tap deselect - 7187cdb, tests 858; owner device pass
- U3b-r3 edit-bar tap consumption (seed-bar leak) + arrange guard + unique-building 1/1 badges - 56adff5, tests 836; owner device pass
- V33 dupe-building normalize + refund migration (schema v33; owner refunded + shed deduped, verified live pre-commit) - 06540cf, tests 834
- U3b-r2 shop tap-to-expand decor cards + contextual toolbar column (Flip/Put away/Place; floating Place Next retired) - a4b4e29, tests 828; owner device pass
- U3b(+r1) edit-scene rework: contextual toolbar, Shed/Shop/Undo/Cancel/Save bar, in-hand + building fast path, building put-away exemption, dupe-buy guard, stale-sprite fix, paint-bar leak fix, shed naming sweep - 6c65836, tests 822; owner device pass
- U2b-r4 shop tooltip depth + memoized pill redraws (smooth fly-to-Shed) - 6e24017
- U3a per-TYPE building slot unlocks (v32; shelved buildings keep paid capacity) + edit-session undo stack (model, dormant until U3b) - 5d061cb, tests 818
- U2b unified Shop (tabs, vector chrome, stepper + fly-to-Shed, one-time tip v31; caps into buyToShed; old shops deleted; 3 fix rounds) - a220404, tests 805; owner device pass
- U2a warehouse retired into the Shed (trophies -> catalog purchasable:false, v30 overwrite-merge, delegate reducers) - 3987082, tests 795; owner live-tested the migration
- U1 Shed pipeline model (derived catalog, shedInventory schema v29, buy/place/put-away reducers, warehouse mirrored) - c8d061e, tests 788
- T-DOCS1 code-comment pointers -> docs/ASSETS.md (first task through the file loop) + CLAUDE.md prettier fix - b0cff8a
- Process rework: file-based PM<->Coder loop + one-place docs consolidation + folder cleanup - 8f5c719 + 328606e
- Paths four-tier coin ladder (dirt free / gravel 15 / stone 70 / moonstone 350; T4.13) - own commit, schema v28, tests 754; also fixed a dirt_path atlas name collision (288-square vs path tile)
- Paths v1 (gravel paint, free, cosmetic layer) + farmhouse 2x2 refit - 20eb5d6, schema v28
- Q2 order refresh cooldown (fulfilled slot repopulates after 10 min; fixes the day-1 order spike) - 0b0c6b6 (no schema change; not mirrored)
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

## PM housekeeping

- docs/tasks/progress.md is at ~11 reports - archive the pre-U3b entries to private/to_delete/ on the next healthy-workspace session (byte-exact copy needs the VM; do not hand-reconstruct).

## Watch items

- **RESOLVED same day - /clear mid-loop:** the "unattributed" V33 tree was an owner /clear cutting off the prior coder between verification and the report/diff steps. Preflight caught it; the successor session audits-and-adopts. OWNER RULE going forward: don't /clear a coder session until its done-line is on screen AND the report sentinel (`=== END REPORT <id> ===`) exists in docs/tasks/progress.md.

- Save durability stays open (T3.17 was corruption-recovery only): browser eviction + cross-device loss wait for the T7.4 save era.
- T4.11 lowered several XP thresholds (L2 900->30, all levels shifted down): loads are RAISE-only (reconcileLevelSilently), so an existing save can only be bumped UP a level, never demoted - confirmed safe, no migration.
- **Hidden-panel sweep class (U2b-r3 finding):** any panel left interactive while hidden gets its hitboxes disabled by arrange mode's sweep and never re-enabled. ShopPanel now holds zero live hitboxes while closed; Goals/Paths/Restore are safe only because they are not reachable from arrange - apply the same hygiene to any panel U3b makes arrange-reachable.
- U4 will retire the T4.13 paint-time coin charge (sink moves to shop buy time) - re-check the balance mirror's paths row when U4 ships. Stale "warehouse" naming (FarmScene WAREHOUSE_* constants, 'decor-warehouse' panel key, decor.ts param names) - sweep in U3.

## Backlog nits (fold into convenient tasks)

- Farmhouse fit revisit: the 576 size feel + the clipped base tip (thin grass sliver at the front - real fix is repacking the art so the base is not cut off the 256 frame); sweep the duplicate path-layer comment in FarmScene.ts while there.
- Mill + bakery too small for their 2x2 footprints (mill fills 55%, bakery 78%) - same fit as the farmhouse, each needs its own display height.
- Farmhouse shadow authoring lab still shows the old scale (in-game shadow is correct) - self-fixes on the next atlas/shadow repack.
- gameState.test.ts "harvesting queues the same kind of event as addXp": its comment still says the L2 threshold is 900 and over-sizes the loop guard to 1000 - the test passes (L2 is 30, so it exits at ~15) but the derivation is stale; fix next time that file is touched.
- Path tiles show faint diagonal seams on large stone/moonstone plazas (brick courses don't align across tile edges) - acceptable for the stylized look; revisit only if it bugs the owner.
- Decorations polish pass (sounds, arrange-mode juice, shop scroll >10 items, decor-over-plot rules).
- Partial crop selling (sell X, not all) - scheduling with owner.
- MAX-level order cards still advertise xp at the cap - de-emphasize.
- Reduced-motion toggle - ride a settings task.
- Dev-only cosmetics: 'Edit dressing' toggle full-width; dev.ts comment re-attachment.
- ShopPanel.ts DEV-seam comment references a nonexistent tools/shop-capture.mjs - fix when U3b touches the file.

## Open validations (real-device evidence still needed)

- Camera feel on the LIVE site from a real phone (post-deploy).
- T4.11 tutorial on a FRESH save (save backup first): the level-2 celebration + Starcorn reveal should fire on the ORDER A delivery, and plant-mixed should complete with 57 coins. The logic is unit-covered; this is the visual eyeball only.
- T4.13 paths four-tier ladder: owner did the real-phone paint pass (four rows, floats, no double-charge) before the push - DONE.

## Waiting on user

- Optional owner call, no deadline: back up or drop the art-staging *_raw*/backup PNGs (packer never reads them; provenance only).
- Device Cowork workspace (local Linux VM) still down (failed to start again 2026-07-22); a checksum verification pass is owed once it is healthy, now covering the earlier bridged docs PLUS all 2026-07-22 PM writes: docs/balance/currencies.csv, docs/status.md, docs/decisions.md, .gitignore, docs/tasks/*, docs/private/pm-rules.md, the four re-headered design docs, and CLAUDE.md (after the owner copies it in). Bridge reads looked current today (post-T4.13 content).
