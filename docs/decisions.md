# Little Acres - Decision Log

Chronological record of design and process decisions made during development.
Newest entries at the bottom. One entry per decision.

Format:

## YYYY-MM-DD - Short title
**Context:** why this came up
**Decision:** what was decided
**Trigger:** task/report that prompted it (if any)

---

## 2026-07-07 - PM workflow adopted
**Context:** Development runs through a PM (this agent, owns docs/) and a separate coder (Claude Code, never reads docs/). User relays prompts and reports between them.
**Decision:** PM writes self-contained task prompts. User pastes to Claude Code, pastes reports back. PM responds with exactly one of COMMIT / USER TEST / CODER FIX / NEXT TASK, and maintains status.md and decisions.md after every report.
**Trigger:** PM system setup.

## 2026-07-07 - Dev server pinned to port 5177
**Context:** User runs another project (bloomstead) on the default Vite port 5173. Repeating the port in every task prompt is noise.
**Decision:** Little Acres' Vite dev server runs on port 5177 with strictPort. Recorded as a standing convention in CLAUDE.md so both PM and coder apply it automatically without per-prompt mention.
**Trigger:** User request.

## 2026-07-07 - Model selection per task
**Context:** Coder tasks can run on a stronger model (Fable5/Opus) or a cheaper/faster one (Sonnet). User wants the PM to pick per task rather than default to the strongest.
**Decision:** Every task prompt names a recommended model. Heuristic - use **Fable5/Opus** for tasks with real architectural decisions, subtle correctness (timestamp/offline math, save/migration, GameState design), performance-sensitive systems, or precedent-setting patterns; use **Sonnet** for well-specified, mechanical, low-ambiguity work (config/data entry, UI wiring on an established pattern, straightforward rendering, asset loading, small additive features). When borderline, favor the stronger model for foundational tasks and Sonnet once the pattern exists.
**Trigger:** User request.

## 2026-07-07 - T0.1 deviations accepted
**Context:** T0.1 report (STATUS DONE, all acceptance criteria MET, screenshot-verified).
**Decision:** COMMIT. Accepted as standing conventions: Phaser pinned to 3.x (`^3.90.0`; npm now defaults to Phaser 4); engine config constants live in `src/config.ts` (DESIGN_WIDTH/HEIGHT), distinct from game data in `src/data/`; `docs/` added to `.prettierignore` so tooling never touches the PM folder; build runs `tsc --noEmit` before `vite build`. T0.1 was run on Fable5 - reasonable for foundational scaffolding, though a borderline Sonnet candidate.
**Trigger:** T0.1 coder report.

## 2026-07-07 - T0.1 no longer creates CLAUDE.md
**Context:** Roadmap T0.1 originally had the coder create CLAUDE.md pointing to docs/gdd.md and docs/roadmap.md. New workflow forbids the coder from reading docs/, and the PM now owns CLAUDE.md.
**Decision:** CLAUDE.md is authored and maintained by the PM (created during setup). T0.1's scope drops the "create CLAUDE.md / point to docs" clause; the coder only scaffolds the project. Design context reaches the coder through the PM's task prompts, never through docs/.
**Trigger:** PM system setup.
