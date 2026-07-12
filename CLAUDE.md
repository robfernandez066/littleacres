# CLAUDE.md - Little Acres (Developer Guide)

You are the developer on Little Acres, a cozy mobile farming game (Phaser 3 + TypeScript + Vite, web-first PWA). You receive one self-contained task prompt at a time. Everything you need to do a task is in that prompt. Do the task, then file the end-of-task report below.

## Standing rules

1. **Never read the `docs/` folder.** Do not open, read, grep, summarize, or reference anything under `docs/`. It is owned by the project manager and is not part of your context. All design context you need is in the task prompt. If a task seems to require design information you do not have, say so in your report instead of looking in `docs/`.
2. **Never commit or push.** Do not run `git commit`, `git push`, `git tag`, or otherwise write to git history. Leave all changes in the working tree. The PM decides when work is committed. You may run read-only git commands (`git status`, `git diff`) to describe your changes in the report.
3. **One task at a time.** Do only what the current task prompt asks. Do not start the next task, refactor unrelated code, or add features that were not requested.
4. **End every task with the report** in the template below. No exceptions, even for trivial tasks.
5. **Memory hygiene.** Session memories are for environment/tooling/workflow lessons only - never design facts, game data, or task specifics. The current task prompt always overrides memory.
6. **Trust the prompt's file list.** Task prompts name every file the task needs (read AND write). Do not survey the repo beyond that list plus files it directly imports where signatures matter. If the list seems incomplete or contradicts the code, stop and say so in your report (BLOCKED or a question) instead of exploring - a wrong assumption costs more than a question.

## Coding conventions

- **TypeScript strict mode.** No `any` unless justified in an inline comment on the same line.
- **Data lives in config.** All game data (crops, orders, levels, prices) lives in typed JSON/TS files under `src/data/`. Never hardcode game data in scene logic.
- **Single state object.** Game state is one serializable object managed by a `GameState` store. Scenes render from state and never own it.
- **Time from timestamps.** All timers derive from real timestamps (`Date.now()`), never accumulated frame deltas. This keeps offline progress free.
- **Object pooling** for particles, floating text, and coin sprites - from day one.
- **Performance.** Target 60fps on mid-range phones. Portrait 1080x1920 design resolution with responsive scaling.
- **Dev server port.** The Vite dev server MUST run on port **5177** (set `server.port: 5177` and `server.strictPort: true` in `vite.config`). Port 5173 is used by another project; do not use it. This is fixed for the life of the project.
- **Folder structure.** `src/scenes`, `src/systems`, `src/data`, `src/ui`, `assets/`. Keep files in their lane.
- **No em dashes in any user-facing text.** Use regular dashes ( - ). This applies to UI strings, order flavor text, and unlock copy.
- **Hit areas derive from visible art, not texture frames.** Any interactive sprite's hit area must cover the sprite's measured opaque content bounds (alpha-scan the packed frame, e.g. with Jimp as tools/pack-atlas.mjs does) expanded by the pad the task states - never the nominal frame rectangle, which includes invisible padding. Custom hitArea rectangles are FRAME-RELATIVE (0,0 at the frame's own top-left) - Phaser adds displayOrigin before testing, so an origin-centered rectangle silently misses part of the sprite (root-caused in T2.22a). When re-enabling interactivity, use no-arg `setInteractive()` so a custom hit area is preserved (passing a config object silently resets it to texture bounds).
- **Tests where noted.** When a task's acceptance criteria mention tests, write or update them and make them pass.
- **Verify last.** Run `npm test`, `npm run build`, and `npm run lint` as the FINAL step before writing your report - after your last file edit. A verification that ran before your latest change is stale and must be re-run.
- **Lockfile must stay CI-safe.** CI runs `npm ci` on Linux; npm on Windows silently drops other platforms' optional deps when it regenerates the lockfile. After ANY change to dependencies, verify `package-lock.json` still contains top-level `node_modules/@emnapi/core` and `node_modules/@emnapi/runtime` entries (e.g. `findstr "node_modules/@emnapi" package-lock.json`). If they are missing, regenerate with `npm install --package-lock-only` from a clean state (no `node_modules` present) and re-check. Mention the lockfile check result in your report whenever dependencies changed.

## End-of-task report (MANDATORY - paste this back verbatim, filled in)

```
### TASK REPORT: <task id>

STATUS: <DONE | BLOCKED | PARTIAL>

WHAT I DID:
- <bullet per meaningful change>

FILES CHANGED:
- <path> (new|modified|deleted) - <one-line reason>

ACCEPTANCE CRITERIA:
- <criterion from the prompt>: <MET | NOT MET> - <how verified>

HOW TO VERIFY:
- <exact commands the user runs, e.g. `npm run dev`, and what they should see>

TESTS:
- <what tests were added/changed and their pass/fail result, or "none required">

DEVIATIONS / ASSUMPTIONS:
- <anything you changed from the prompt, guessed, or decided; "none" if none>

BLOCKERS / QUESTIONS:
- <anything preventing completion or needing a PM decision; "none" if none>

GIT STATE:
- <output summary of `git status`; confirm nothing was committed or pushed>
```

If STATUS is BLOCKED or PARTIAL, stop and explain in BLOCKERS - do not improvise around missing design info.
