# Little Acres - Status

**Updated:** 2026-07-14
**Phase:** PLAYTEST GATE - RUNNING (P0 closed; T3.18 in flight)
**Schema:** v15 · **Tests:** 325 · **Live:** robfernandez066.github.io/littleacres/

## Active

- **T3.17 + T3.19 COMMITTED + PUSHED 2026-07-14 - the trophy save-wipe P0 is CLOSED.** User test passed with one modification: the weekly notice is now button-only dismiss (PM-direct WeeklyNoticePanel fix in the tree; owner runs trio + 30s re-check + commits). Weekly numbers owner-approved: Specialist + Dewmelon 5 / Sagesprig 3; Growing Strong level-scaled snapshot L1-L8 = 240/240/400/600/900/1300/1900/2800.
- **T3.18 trophy shelf prompt issued** (Sonnet, fresh session) - TROPHY_ITEMS names, Shed 2x8 dynamic grid, gold trophy accent.
- Gate context: tester playing since 2026-07-13; T3.12-T3.16 committed + pushed; brief answers + retention signal pending. One-tester results are directional evidence, not broad player validation.

## Queue

1. Owner: trio + re-check + commit the notice-panel fix -> paste T3.18 to the coder
2. T3.20 / T3.21 / T3.22 / CI gate (T3.20 after T3.19 commits - shares gameState.ts; CI = deploy.yml only, anytime); T3.23 when the owner picks its timing (PM recommends with the P2 batch)
3. Gate wrap-up: tester brief answers + voluntary-return signal
4. Wave 3 cut (owner decision at gate wrap): candidates crop mastery, storage caps, restoration chapter v1 (approved candidate; PM defines its boundary vs T3.3 before it can be scheduled). Reward-only Mine v1 DROPPED (owner, 2026-07-14).

## Open validations (real-player / device evidence still required, not findings that passed)

- Day-1/day-3 voluntary return (the running gate's core question)
- Audio staged-loading feel on a real phone + real network (after T3.21)
- WYWA foreground-summary threshold feel (after T3.20)

## Waiting on user (whenever convenient)

- Approve or reject the T4.2 "one complete vertical chain first" sequencing PROPOSAL (roadmap, Phase 4) - not covered by the cut blessing
- Collect the tester brief answers after 2-3 days (not day one); the voluntary-return signal is the key metric
- Cleanup on your machine (PM cannot delete files there): the original review copy at C:\Users\robbi\.codex\visualizations\2026\07\14\019f6097-23c6-7490-b19d-e8ea2c92d404\little-acres-mobile-game-review-2026-07-14.md, and the repo's _to_delete\ folder (stale git-lock artifact + the T3.17 review diff)

## Staged future assets (tools/art-staging, NOT packed - owner picks 2026-07-13)

- Phase 4A: coop.png (magical-bird roost, open-rail run), moonhen.png (first creature; lays Moon Eggs)
- Phase 4: windmill_body.png (hub axle in roof dormer) + windmill_blades.png (face-on symmetric cross, rotates in code around its center; slow always, faster while producing) + windmill_static_backup.png (fallback if the split composite disappoints)
- Naming/frame ids get locked when the features are wired; art generated ahead of design on purpose.

## Backlog nits (fold into convenient tasks)

- T3.9c Decorations polish pass (user-requested placeholder, 2026-07-12): scope TBD from play; candidate list - place/pickup sounds, arrange-mode juice (drop bounce, selection pulse), warehouse panel visual upgrade, sell-back/refund design, smarter Place spawn (avoid stacking at center; 2026-07-14 review adds a ghost-drag-confirm option), shop scroll once items exceed 10, decor-over-plot visual rules. Runs after wave 2's feature tasks.
- Dead pulse-target id 'sell-sunwheat' (onboarding.ts + InventoryPanel registration): no tutorial step references it since the sell step was cut - remove both ends in a convenient inventory/onboarding task
- formatCurrency unit tests (pure function in Hud.ts)
- Move formatAwayDuration to src/data/ so it's unit-testable (currently untestable: imports Phaser)
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
- PM reviews fresh coder work via the owner-generated diff file (see Watch items); direct Reads only for files not freshly written.
- Coder sessions may leave dev servers on 5177 - kill before starting your own.
- Close stray game tabs during coder sessions (two-tab autosave overwrite).
- Atlas regen script: `npm run pack:atlas`.
- Sprixen workflow: one style-reference image per project - emberpepper_2 while generating crops, swap to the farmhouse for structures/decor batches.
