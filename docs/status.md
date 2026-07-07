# Little Acres - Status

**Updated:** 2026-07-07
**Phase:** Phase 0 - Skeleton
**Active task:** T0.5 - Debug/dev overlay (prompt out; Sonnet)

## Task states
- T0.1 Project scaffold - DONE, committed
- T0.2 PWA + deploy pipeline - DONE. Live at robfernandez066.github.io/littleacres/; installs on Android, fullscreen portrait confirmed
- T0.3 Asset pipeline + placeholder art - DONE, committed + pushed. Survived a mid-task crash (salvaged, RESUME prompt). Demo crops on 3 plots are temporary atlas-proof; remove when planting lands (T1.2/T1.3)
- T0.4 GameState store + local save - DONE, committed + pushed. 13 Vitest tests; window.dev console hooks until T0.5. Note for Phase 1 balancing: starting coins (50) live in gameState.ts, fold into src/data/ config later
- T0.5 Debug/dev overlay - IN PROGRESS (prompt handed to coder). Time-warp maturation check deferred to T1.2 (no crops yet); introduces now() game-clock in src/systems/time.ts

## Blockers
- None.

## Notes
- PM owns docs/; coder never reads docs/. PM maintains this file + decisions.md.
- Each task prompt carries a model recommendation (Fable5/Opus vs Sonnet).
