# Little Acres - Status

**Updated:** 2026-07-13
**Phase:** Wave 2 - content (decorations -> quests -> crops; external playtest gate after wave 2 - see decisions 2026-07-12)
**Schema:** v11 · **Tests:** 283 · **Live:** robfernandez066.github.io/littleacres/

## Active

- **T3.11 Crops + cap 8** - art sitting IN PROGRESS (user, project style reference = emberpepper_2): dewmelon_0/1/2 picked and staged; sagesprig_0/1/2 pending. Coder prompt (T2.18 template: pack, config, thresholds 3500/5500, cap 8, 7-button seed bar refit check) goes out when all six are staged.
- T3.10 series (quests v1: engine + board + progress labels) DONE, committed + pushed 2026-07-12.
- T3.9 series (decorations v1: shop + warehouse + arrange mode + ground shadows) DONE, committed + pushed 2026-07-12.

## Queue (WAVE 2, blessed 2026-07-12; playtest gate after it)

1. T3.11 Crops + cap 8: Dewmelon L7 (45m, 260/500/150, cap 2), Sagesprig L8 (2h, 600/1200/400, cap 1); thresholds 3500/5500
2. PHASE GATE: external playtest round (3-5 fresh installs; PM writes tester brief)
3. Wave 3 candidates: Mine v1 (self-contained), crop mastery, storage caps / Phase 3 roadmap proper (then Phase 4 processing -> Phase 4A animals per the 2026-07-12 roadmap growth)

## Waiting on user (whenever convenient)

- sagesprig_0/1/2 Sprixen picks (prompts delivered)
- chest.mp3 (Pixabay: short treasure-chest open, <2s) - ceremony ships without it until staged
- balance-v2.xlsx re-delivered 2026-07-13: save it as docs/balance-v2.xlsx and move v1 to docs/archive/balance-v1.xlsx (commands provided in chat)

## Backlog nits (fold into convenient tasks)

- T3.9c Decorations polish pass (user-requested placeholder, 2026-07-12): scope TBD from play; candidate list - place/pickup sounds, arrange-mode juice (drop bounce, selection pulse), warehouse panel visual upgrade, sell-back/refund design, smarter Place spawn (avoid stacking at center), shop scroll once items exceed 10, decor-over-plot visual rules. Runs after wave 2's feature tasks.
- src/data/quests.ts header comment still says the board UI is "a follow-up task" - one-line fix in the next quest-area coder prompt (docs-cleanup report §9.1)
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
- Sprixen workflow: one style-reference image per project - emberpepper_2 while generating crops, swap to the farmhouse for structures/decor batches.
