# Little Acres - Status

**Updated:** 2026-07-14
**Phase:** PLAYTEST GATE - RUNNING (integrity cut SHIPPED; P2 batch running)
**Schema:** v15 · **Tests:** 337 · **Live:** robfernandez066.github.io/littleacres/

## Active

- **T3.17 + T3.19 COMMITTED + PUSHED 2026-07-14 - the trophy save-wipe P0 is CLOSED.** User test passed; the button-only-dismiss notice fix (PM-direct) is verified, committed + pushed. Weekly numbers owner-approved: Specialist + Dewmelon 5 / Sagesprig 3; Growing Strong level-scaled snapshot L1-L8 = 240/240/400/600/900/1300/1900/2800.
- **Integrity cut SHIPPED 2026-07-14: T3.17, T3.19, T3.18+a+b all committed + pushed.** Trophy save-wipe P0 closed; weeklies fixed and recalibrated; trophies placeable. Tests 328.
- **T3.20+T3.20a and T3.21 SHIPPED 2026-07-14** (foreground WYWA; staged audio - farm paints before the ~15.8MB of music). **T3.22a PM review passed (buttons cleared, measured live). Owner 30s re-check pending -> one T3.22+a commit closes the clarity batch.**
- Gate context: tester playing since 2026-07-13; T3.12-T3.16 committed + pushed; brief answers + retention signal pending. One-tester results are directional evidence, not broad player validation.

## Queue

1. Owner: premium-card glance -> one T3.22+a commit -> T3.23 seed bar prompt (last coder task of the P2 batch)
2. P2 batch: T3.20 / T3.21 / T3.22 / T3.23 / CI gate (T3.20 unblocked - T3.19 is committed; CI = deploy.yml only, anytime; T3.23 joins the batch - owner, 2026-07-14)
3. Gate wrap-up: tester brief answers + voluntary-return signal
4. Wave 3 cut (owner decision at gate wrap): candidates crop mastery, storage caps, restoration chapter v1 (approved candidate; PM defines its boundary vs T3.3 before it can be scheduled). Reward-only Mine v1 DROPPED (owner, 2026-07-14).

## Open validations (real-player / device evidence still required, not findings that passed)

- Day-1/day-3 voluntary return (the running gate's core question)
- Audio staged-loading feel on a real phone + real network (after T3.21)
- WYWA foreground-summary threshold feel (after T3.20)

## Waiting on user (whenever convenient)

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
- Every USER TEST verdict ships with explicit numbered test steps - exact console pastes, what to tap, what to expect (owner rule, 2026-07-14).
- Test scripts that mutate the save start with backup = dev.exportSave() and end with dev.importSave(backup) (2026-07-14).
- Owner reports any manual art-file edit even if the filename is unchanged - gitignored masters feed the next pack:atlas silently (2026-07-14).
- PM reviews fresh coder work via the owner-generated diff file (see Watch items); direct Reads only for files not freshly written.
- Coder sessions may leave dev servers on 5177 - kill before starting your own.
- Close stray game tabs during coder sessions (two-tab autosave overwrite).
- Atlas regen script: `npm run pack:atlas`.
- Sprixen workflow: one style-reference image per project - emberpepper_2 while generating crops, swap to the farmhouse for structures/decor batches.
