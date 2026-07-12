# Little Acres - Status

**Updated:** 2026-07-10
**Phase:** Phase 2 - content + polish (post design-review re-cut; see docs/design-review-2026-07-10.md)
**Schema:** v9 · **Tests:** 226 · **Live:** robfernandez066.github.io/littleacres/

## Active

- **T2.25** (coder, FRESH, Sonnet): chest card simplification - text line out, compact icon into the reward row. Prompt delivered.
- 2026-07-10 mega-stack (T2.22 series, T2.23 series, T2.24) COMMITTED + PUSHED after full combined playtest (all items passed incl. fresh tutorial; dirt path verdict: GOOD, needs blend dressing).

## Queue (in order)

1. T2.25 chest card simplification (chest = the mystery bonus; icon-only advertisement, ceremony pays it off - user + PM aligned)
2. T2.15 seed info button ("i" on seed buttons: grow time, cost, sell, xp + flavor line; PM writes copy; card pattern reusable for Phase 4 recipes)
3. Scene-blend round (art in generation): flat seamless grass tile attempt (kills the taped-on grid lines - predicted in the original art-direction log) + tuft/stone/dirt decals dressing the road edges; MUST re-verify at 16 plots (grid grows toward the road)
4. PHASE 2 GATE: external playtest round - 3-5 fresh installs (user-approved), PM triages notes as a mini-gate
5. Post-gate: Phase 3 planning (balance-v1.xlsx is the economy source of truth)

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
