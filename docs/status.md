# Little Acres - Status

**Updated:** 2026-07-14
**Phase:** WAVE 3 (blessed 2026-07-15): T3.3+T3.4 lead; T3.24 in flight
**Schema:** v15 · **Tests:** 345 · **Live:** robfernandez066.github.io/littleacres/

## Active

- **T3.17 + T3.19 COMMITTED + PUSHED 2026-07-14 - the trophy save-wipe P0 is CLOSED.** User test passed; the button-only-dismiss notice fix (PM-direct) is verified, committed + pushed. Weekly numbers owner-approved: Specialist + Dewmelon 5 / Sagesprig 3; Growing Strong level-scaled snapshot L1-L8 = 240/240/400/600/900/1300/1900/2800.
- **Integrity cut SHIPPED 2026-07-14: T3.17, T3.19, T3.18+a+b all committed + pushed.** Trophy save-wipe P0 closed; weeklies fixed and recalibrated; trophies placeable. Tests 328.
- **T3.20+T3.20a and T3.21 SHIPPED 2026-07-14** (foreground WYWA; staged audio - farm paints before the ~15.8MB of music). **P2 BATCH CLOSED 2026-07-15:** T3.20+a, T3.21, T3.22+a, T3.23+a all SHIPPED; CI gate green on GitHub (Test + Lint before Build); decor_well atlas regen committed. **T3.24 SHIPPED 2026-07-15** (Owned/Value headers, bold counts, value column number-then-coin). **T3.25 SHIPPED 2026-07-15** ('Edit Layout' toggle button - wave 3 rider done). **Restoration boundary APPROVED 2026-07-15** (v1 = farmhouse + mere dock; light per-building perks, PM menu later; structure movability = queued future conversation). **Phone validations PASSED** (seed-bar scroll + staged audio). **T3.26 housekeeping bundle WITH CODER**; PM designing T3.3+T3.4.
- Gate context: brief answers IN (2026-07-14) - voluntary return CONFIRMED, level 8 reached, no stuck points, no perceived defects. Demand signals: bigger farm + pinch zoom (T3.3/T3.4), decorative buildings / farmhouse upgrade (restoration chapter), direct arrange-mode entry (new small-task candidate). One tester = directional evidence, not broad validation.

## Queue

1. T3.26 report -> PM review via diff -> verdict -> commit
2. PM: T3.3+T3.4 design decisions (Word doc for owner review) -> first land/camera coder prompt
3. After land/camera ships: full-farm rearrangement design conversation (owner direction 2026-07-15), then restoration design (incl. PM perk menu)
3. Partial-sell scheduling: DEFERRED by owner 2026-07-15 - raise again when inventory-economy work comes up
4. Wave 3 (owner cut 2026-07-15, picks 1A-5A): LEAD T3.3+T3.4 land + camera (one package, owner guardrails); SECOND restoration chapter v1 (contingent on PM boundary doc); RIDER direct arrange-mode entry. Wave 4: crop mastery, storage caps + partial sell. Reward-only Mine v1 DROPPED (owner, 2026-07-14).

## Open validations (real-player / device evidence still required, not findings that passed)

- WYWA foreground-summary threshold feel (after T3.20)

## Waiting on user (whenever convenient)

- Cleanup on your machine (PM cannot delete files there): the original review copy at C:\Users\robbi\.codex\visualizations\2026\07\14\019f6097-23c6-7490-b19d-e8ea2c92d404\little-acres-mobile-game-review-2026-07-14.md, and the repo's _to_delete\ folder (stale git-lock artifact + the T3.17 review diff)

## Staged future assets (tools/art-staging, NOT packed - owner picks 2026-07-13)

- MERE SPRITE REJECTED (owner 2026-07-15: too small, doesn't fit; already off-screen long ago - packed but unused) - regenerate AFTER the T3.3 design fixes world dimensions, batched with overgrowth/region art + the restoration dock's ruined stage-0.

- Phase 4A: coop.png (magical-bird roost, open-rail run), moonhen.png (first creature; lays Moon Eggs)
- Phase 4: windmill_body.png (hub axle in roof dormer) + windmill_blades.png (face-on symmetric cross, rotates in code around its center; slow always, faster while producing) + windmill_static_backup.png (fallback if the split composite disappoints)
- Naming/frame ids get locked when the features are wired; art generated ahead of design on purpose.

## Backlog nits (fold into convenient tasks)

- T3.9c Decorations polish pass (user-requested placeholder, 2026-07-12): scope TBD from play; candidate list - place/pickup sounds, arrange-mode juice (drop bounce, selection pulse), warehouse panel visual upgrade, sell-back/refund design, smarter Place spawn (avoid stacking at center; 2026-07-14 review adds a ghost-drag-confirm option), shop scroll once items exceed 10, decor-over-plot visual rules. Runs after wave 2's feature tasks.
- Partial crop selling: sell X of a crop instead of all-or-nothing (TESTER demand - attribution corrected 2026-07-15); scheduling decision with owner (wave 3 rider vs wave 4 with caps)
- FarmScene comment re-attachment: enterArrangeMode's doc comment now floats above toggleArrangeMode (T3.25 insertion nit) - fix when T3.3 touches FarmScene
- Seed-bar badge dead zone for drag-start: badge pointer-down stopPropagation means a strip drag cannot start on a badge's 96px hit square (T3.23 review nit, 2026-07-14); fold into a later polish task if players notice
- MAX-level polish: order cards still advertise xp at the cap - de-emphasize or annotate (review nit, 2026-07-14)
- Reduced-motion toggle: explicit earlier candidate (owner, 2026-07-14) - ride a convenient settings task; the T7.5 full accessibility pass must not absorb present-day usability defects (readability/touch targets land with T3.23)

## Blockers

- None.

## Watch items

- Broader save durability stays open after T3.17 (T3.17 is corruption recovery only): browser eviction + cross-device loss wait for later save work (T7.4 era).
- PM environment (two stale-read incidents 2026-07-14): never run git through the device VM; never trust VM-mount reads or same-path restages of fresh writes. Standing review channel for fresh coder work: owner runs `git diff > _to_delete\tNNN-review.diff`, PM stages the new path.

## Standing notes

- PM owns docs/; coder never reads docs/. PM maintains this file + decisions.md after every report/decision.
- Every task prompt carries a model recommendation (Fable5/Opus vs Sonnet) and a session marking; /clear is the default.
- Commit flow: PM states testing needed, then supplies git commands in run order; user runs all git; each green task commits alone (2026-07-14; combined commits only when an intermediate tree would be broken).
- Every USER TEST verdict ships with explicit numbered test steps - exact console pastes, what to tap, what to expect (owner rule, 2026-07-14).
- Test scripts that mutate the save start with backup = dev.exportSave() and end with dev.importSave(backup) (2026-07-14).
- Owner reports any manual art-file edit even if the filename is unchanged - gitignored masters feed the next pack:atlas silently (2026-07-14).
- PM reviews fresh coder work via the owner-generated diff file (see Watch items); direct Reads only for files not freshly written.
- Coder sessions may leave dev servers on 5177 - kill before starting your own.
- Close stray game tabs during coder sessions (two-tab autosave overwrite).
- Atlas regen script: `npm run pack:atlas`.
- Sprixen workflow: one style-reference image per project - emberpepper_2 while generating crops, swap to the farmhouse for structures/decor batches.
