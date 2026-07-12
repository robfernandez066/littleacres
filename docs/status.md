# Little Acres - Status

**Updated:** 2026-07-10
**Phase:** Phase 2 - content + polish (post design-review re-cut; see docs/design-review-2026-07-10.md)
**Schema:** v9 · **Tests:** 226 · **Live:** robfernandez066.github.io/littleacres/

## Active

- **T2.24** (coder, in flight; FOLLOW-UP in the long session): teaser-order removal + bag full-sprite hit box + dev-overlay hitbox visualizer. Report pending.
- **Uncommitted stack awaiting one combined test + commit:** T2.22 (notice board + farmhouse), T2.22a (layout swap + frame-relative hit-area root fix), T2.23/T2.23a (chest rework: card-listed chests, fulfill-time ceremony, v10 reverted), T2.24. Commit only after the user's combined playtest.
- **Session policy note:** current coder session ran 4 tasks (policy drift, corrected) - /clear after T2.24; next task is FRESH.

## Queue (in order)

1. Dirt path placement round (dirt_path.png staged; attempt-then-verdict, mere lesson applies)
2. COMBINED USER TEST of the whole uncommitted stack -> one commit + push (+ Actions green)
3. T2.15 seed info button ("i" on seed buttons: grow time, cost, sell, xp + flavor line; PM writes copy; card pattern reusable for Phase 4 recipes)
4. PHASE 2 GATE: external playtest round - 3-5 fresh installs (user-approved), PM triages notes as a mini-gate
5. Post-gate: Phase 3 planning (balance-v1.xlsx is the economy source of truth)

## Waiting on user (whenever convenient)

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
