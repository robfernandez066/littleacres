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

## 2026-07-07 - Repo made public for free Pages hosting
**Context:** GitHub Pages was blocked because the repo is private (free plan requires public repo or paid Pro/Enterprise for private Pages). Options: make public (free), Netlify (free, private, needs workflow swap), or GitHub Pro (~$4/mo, private, no changes).
**Decision:** Make the repo public. No secrets in the repo; simplest free path, keeps the existing GitHub Actions deploy workflow unchanged. Source code is now publicly visible - acceptable for a hobby game.
**Trigger:** T0.2 hosting - Pages disabled on private free repo.

## 2026-07-07 - T0.2 deviations accepted
**Context:** T0.2 report (STATUS DONE; all locally verifiable criteria MET; publish + phone-install are USER-VERIFIED after push).
**Decision:** COMMIT. Accepted: placeholder app icons hand-encoded as PNGs via Node zlib (no image lib available; art swappable later with no code change); `injectRegister: false` with manual `registerSW` from `virtual:pwa-register`; theme_color `#3f6b3d` / background_color `#fdf6e3`; dev URL now under base, `http://localhost:5177/littleacres/`. Lighthouse audit skipped due to a Windows chrome-launcher bug (unrelated); manifest/SW/icon checks substituted. Task stays open until user confirms live install on a phone; then NEXT TASK (T0.3). Ran on Sonnet - appropriate; work was clean.
**Trigger:** T0.2 coder report.

## 2026-07-07 - Deploy target: GitHub Pages
**Context:** T0.2 needs a host to publish a URL. Repo already has origin on GitHub (robfernandez066/littleacres, main). Options were GitHub Pages vs Netlify.
**Decision:** GitHub Pages via GitHub Actions. Published URL: https://robfernandez066.github.io/littleacres/. Vite `base` set to `/littleacres/`. User does a one-time enable of Pages (source: GitHub Actions). Coder cannot push (standing rule), so publish + phone-install acceptance become USER TEST steps after commit.
**Trigger:** T0.2 planning.

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
