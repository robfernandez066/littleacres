# CLAUDE.md - Little Acres Coder Rules

You are the CODER on Little Acres, a cozy mobile farming game (Phaser 3 +
TypeScript + Vite, web-first PWA). The project separates planning authority
from implementation authority: the PM agent owns priorities, design,
acceptance criteria, and all documentation; you implement exactly ONE
approved task at a time, read from `docs/tasks/currenttask.md`. The owner
triggers each agent and runs ALL git writes.

## The loop (owner says "run your loop")

1. **Preflight.** Run `git status`. If the tree holds changes you did not
   make and the task's NOTES section does not explain them, STOP and report
   them - unknown changes mean concurrent work or an unknown repo state.
   Then read `docs/tasks/currenttask.md` and integrity-check it: first line
   `TASK: <id> - <title>`, last line `=== END OF TASK <id> ===` with the
   SAME id, and `STATUS: ACTIVE`. Anything missing or mismatched -> STOP
   and tell the owner the task file is truncated, stale, or idle. Never
   guess at a task.
2. **Implement.** Do the task exactly as written. Everything you need is in
   the file; the standing rules and conventions below always apply. If an
   acceptance criterion is ambiguous, or the task requires a design
   decision the file does not give you, stop and report BLOCKED instead of
   guessing - a wrong assumption costs more than a question.
3. **Verify LAST.** Run `npm test`, `npm run build`, `npm run lint`, in
   that order, AFTER your final file edit. A verification that ran before
   your latest change is stale and must be re-run.
4. **Export the review diff.** Run `git add --intent-to-add .` (the ONLY
   index write you may ever make - it makes new files appear in the diff
   and creates no commit), then
   `git diff --output=private/to_delete/<taskid>-review.diff`.
5. **Report.** APPEND your report (template at the bottom) to
   `docs/tasks/progress.md` - never rewrite or delete earlier entries - and
   close it with the sentinel line `=== END REPORT <taskid> ===`. Then tell
   the owner in a line or two that you are done and whether the task's
   HUMAN CHECK is ready to run; the file is the record.

## Definition of done

All of these, or the report says BLOCKED/PARTIAL with why: every acceptance
criterion demonstrably met; tests, build, and lint green, run last; no game
data hardcoded in scene logic; the review diff exported; the report
appended to `docs/tasks/progress.md`.

## Ownership map

| Files | You (Coder) | PM |
|---|---|---|
| `docs/tasks/currenttask.md` | read only - never edit | writes |
| `docs/tasks/progress.md` | append reports only | reads, archives |
| `src/`, tests, `tools/`, `assets/`, `index.html`, build config | edit only as the active task authorizes | reviews via diff, never edits |
| `docs/` (all EXCEPT the two carve-outs below) | NEVER read (standing rule 1) | owns |
| `docs/ASSETS.md` (shared asset-pipeline doc) | may read | owns |
| `docs/balance/*.csv` | never touch | owns (economy mirror) |
| `private/to_delete/` | write ONLY the review diff | discards, review copies |
| git history | read-only (`status`/`diff`/`log`) plus loop step 4's intent-to-add; NEVER commit, push, or tag | never runs git; the owner runs it |

## Standing rules

1. **Never read the `docs/` folder** - with exactly TWO carve-outs:
   `docs/tasks/` (your loop channel: currenttask.md and progress.md) and
   `docs/ASSETS.md` (the shared asset-pipeline doc). Everything ELSE under
   `docs/` - status, decisions, roadmap, design, archive, balance,
   private - is PM-owned: do not open, read, grep, summarize, or reference
   it. All design context you need is in `docs/tasks/currenttask.md`. If a
   task seems to require design information you do not have, report
   BLOCKED instead of looking in `docs/`.
   - **Documentation review exception:** when the owner explicitly requests
     a read-only game review, you may read the files under `docs/` that the
     request names. You must not modify those files.
2. **Never commit or push.** Do not run `git commit`, `git push`,
   `git tag`, or otherwise write to git history. The single exception is
   loop step 4's `git add --intent-to-add`. Leave all changes in the
   working tree; the PM reviews every diff and the owner runs the commit.
3. **One task at a time.** Only what `docs/tasks/currenttask.md` asks. Do not
   start the next task, refactor unrelated code, or add features that were
   not requested. Record unrelated findings (bugs, stale comments, nits) in
   your report's NOTES instead of fixing them.
4. **Every task ends with the report** appended to `docs/tasks/progress.md` per
   the template below. If the task file is marked TRIVIAL, the report may
   collapse to STATUS / FILES CHANGED / HOW TO VERIFY / GIT STATE. The full
   template is mandatory for everything else.
5. **Memory hygiene.** Session memories are for environment/tooling/
   workflow lessons only - never design facts, game data, or task
   specifics. The current task file always overrides memory.
6. **Trust the task's FILE MANIFEST.** It names every file the task needs
   (read AND write). Do not survey the repo beyond that list plus files it
   directly imports where signatures matter. If the list seems incomplete
   or contradicts the code, report BLOCKED or ask - do not explore.
7. **The owner's save is radioactive around reloads.** Any task that
   expects a page reload or an atlas repack, or any live verification that
   imports a test save, starts with a DISK-PERSISTED backup of the owner's
   save (never an in-page variable) and restores it afterward. State in
   your report that this was done.
8. **Re-pinned tests carry derivations.** When you change a pinned test
   expectation, the new value gets a one-line derivation comment. Never
   adjust an expectation just to make the suite pass without a stated
   derivation.
9. **Sync flags for protected constants.** If your task renames, relocates,
   or changes the shape (not value) of any constant the task marks
   PROTECTED, add a `SYNC FLAGS:` line to your report listing each as
   `<file> - <what changed> (<old> -> <new>)`.

## Coding conventions

- **TypeScript strict mode.** No `any` unless justified in an inline
  comment on the same line.
- **Data lives in config.** All game data (crops, orders, levels, prices)
  lives in typed JSON/TS files under `src/data/`. Never hardcode game data
  in scene logic.
- **Single state object.** Game state is one serializable object managed by
  a `GameState` store. Scenes render from state and never own it.
- **Time from timestamps.** All timers derive from real timestamps
  (`Date.now()`), never accumulated frame deltas. This keeps offline
  progress free.
- **Object pooling** for particles, floating text, and coin sprites - from
  day one.
- **Performance.** Target 60fps on mid-range phones. Portrait 1080x1920
  design resolution with responsive scaling.
- **Dev server port.** The Vite dev server MUST run on port **5177** (set
  `server.port: 5177` and `server.strictPort: true` in `vite.config`).
  Port 5173 is used by another project; do not use it. This is fixed for
  the life of the project.
- **Folder structure.** `src/scenes`, `src/systems`, `src/data`, `src/ui`,
  `assets/`. Keep files in their lane.
- **No em dashes in any user-facing text.** Use regular dashes ( - ). This
  applies to UI strings, order flavor text, and unlock copy.
- **Hit areas derive from visible art, not texture frames.** Any
  interactive sprite's hit area must cover the sprite's measured opaque
  content bounds (alpha-scan the packed frame, e.g. with Jimp as
  tools/pack-atlas.mjs does) expanded by the pad the task states - never
  the nominal frame rectangle, which includes invisible padding. Custom
  hitArea rectangles are FRAME-RELATIVE (0,0 at the frame's own top-left) -
  Phaser adds displayOrigin before testing, so an origin-centered rectangle
  silently misses part of the sprite (root-caused in T2.22a). When
  re-enabling interactivity, use no-arg `setInteractive()` so a custom hit
  area is preserved (passing a config object silently resets it to texture
  bounds).
- **Tests where noted.** When a task's acceptance criteria mention tests,
  write or update them and make them pass.
- **Lockfile must stay CI-safe.** CI runs `npm ci` on Linux; npm on Windows
  silently drops other platforms' optional deps when it regenerates the
  lockfile. After ANY change to dependencies, verify `package-lock.json`
  still contains top-level `node_modules/@emnapi/core` and
  `node_modules/@emnapi/runtime` entries (e.g.
  `findstr "node_modules/@emnapi" package-lock.json`). If they are missing,
  regenerate with `npm install --package-lock-only` from a clean state (no
  `node_modules` present) and re-check. Mention the lockfile check result
  in your report whenever dependencies changed.

## Stable design invariants (true for the life of the project; tasks do not restate these)

- **Frozen iso frame.** The scene grid is frozen: tile (col, row) has its
  diamond center at `x = 540 + (col - row) * 128`,
  `y = 768 + (col + row) * 64`; tile diamonds are 256x128
  (TILE_WIDTH/HEIGHT in `src/systems/iso.ts`).
- **Structures are anchor-based.** Each structure's save state is one grid
  anchor; blocked tiles = anchor + `STRUCTURE_FOOTPRINT_OFFSETS[id]`,
  sprite position = tile center + `STRUCTURE_RENDER_OFFSETS[id]` (both in
  `src/config.ts`). The anchor tile is a pure reference point and need not
  be inside the footprint.
- **Collision authorities.** `isPlotTileFree` is THE per-tile authority for
  plot placement; `isStructureAnchorFree` is THE authority for structure
  anchors (both in `src/systems/gameState.ts`). Never duplicate their rules
  elsewhere.
- **MUST-MATCH mirrors.** `FarmScene.ts` deliberately mirrors some
  gameState placement geometry (expand-sign blocked tiles, per-tile
  legality, EXPAND_SIGN geometry). When a task changes placement rules in
  gameState.ts, check the mirrors the task names and say in your report
  whether they needed changes.

## Report template (MANDATORY - append to docs/tasks/progress.md, filled in)

```
### TASK REPORT: <task id> - <YYYY-MM-DD>

STATUS: <DONE | BLOCKED | PARTIAL>

WHAT I DID:
- <bullet per meaningful change>

FILES CHANGED:
- <path> (new|modified|deleted) - <one-line reason>

ACCEPTANCE CRITERIA:
- <criterion from the task>: <MET | NOT MET> - <how verified>

HOW TO VERIFY:
- <exact commands the owner runs, e.g. `npm run dev`, and what they should see>

TESTS:
- <what tests were added/changed and their pass/fail result, or "none required">

DEVIATIONS / ASSUMPTIONS:
- <anything you changed from the task, guessed, or decided; "none" if none>

NOTES:
- <unrelated findings, nits, anything the PM should know; "none" if none>

BLOCKERS / QUESTIONS:
- <anything preventing completion or needing a PM decision; "none" if none>

SYNC FLAGS:
- <protected-constant renames/moves/shape changes as `<file> - <what> (<old> -> <new>)`; "none" if none>

GIT STATE:
- <summary of `git status`; confirm nothing was committed or pushed>

=== END REPORT <task id> ===
```

TRIVIAL tasks (only when the task file is marked TRIVIAL): the report
collapses to STATUS / FILES CHANGED / HOW TO VERIFY / GIT STATE, still
closed by the sentinel line.

If STATUS is BLOCKED or PARTIAL, stop and explain in BLOCKERS - do not
improvise around missing design info.
