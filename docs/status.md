# Little Acres - Status

**Updated:** 2026-07-10
**Phase:** Phase 2 - content + polish (post design-review re-cut; see docs/design-review-2026-07-10.md)
**Schema:** v9 · **Tests:** 226 · **Live:** robfernandez066.github.io/littleacres/

## Active

- **T3.9+T3.9a Decorations v1** - both reviews PASSED (schema v10 decorations, farmhouse-opened shop w/ decor-shop rails action, arrange mode w/ store-authoritative transforms, scene-wide ground-shadow system, 15 art frames + generated shadow blob packed; 240 tests). COMBINED USER TEST + single commit (message delivered). NEXT: T3.10 quest board prompt on push.
- T2.28 series DONE committed+pushed (tiles_flat default, owner dressing layout rev 2 w/ v2 tufts, full-screen ground, front-depth cap).
- Balance sheet v2 BLESSED (weekly quests redesigned: grow-minutes based - see decisions 2026-07-12); decor art sitting COMPLETE (15 pieces staged + packed).

## Queue (WAVE 2, blessed 2026-07-12; playtest gate deferred until after it)

1. PM: balance sheet v2 (decor prices, quest reward tables, Dewmelon/Sagesprig numbers, thresholds 7-8) + decor item list/Sprixen prompts -> user approves/generates
2. T3.9 Decorations v1: decor shop (coins/moondust sink) + player edit-farm mode (dressing-editor tech) + save-persisted placements (schema bump) + decor art pack
3. T3.10 Quests/Bounties v1: scroll icon returns as the quest board; long cumulative quests + weekly harvest quests (real-time weekly reset); rewards: quest-exclusive decor > chests > moondust; persistent counters (schema)
4. T3.11 Crops + cap 8: Dewmelon L7, Sagesprig L8 (sheet numbers, one small Sprixen sitting)
5. PHASE GATE: external playtest round (3-5 fresh installs; PM writes tester brief)
6. Wave 3 candidates: Mine v1 (self-contained), crop mastery, storage caps / Phase 3 roadmap proper

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
