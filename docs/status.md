# Little Acres - Status

**Updated:** 2026-07-07
**Phase:** Phase 1 - MVP Core Loop
**Active task:** T1.12 - AudioManager + real sound assets (prompt out; Fable5/Opus). T1.10 and T1.11 committed. Kenney CC0 SFX + Pixabay farm track approved by user; LAST task before the Phase 1 play-gate

## Task states
- T0.1 Project scaffold - DONE, committed
- T0.2 PWA + deploy pipeline - DONE. Live at robfernandez066.github.io/littleacres/; installs on Android, fullscreen portrait confirmed
- T0.3 Asset pipeline + placeholder art - DONE, committed + pushed. Survived a mid-task crash (salvaged, RESUME prompt). Demo crops on 3 plots are temporary atlas-proof; remove when planting lands (T1.2/T1.3)
- T0.4 GameState store + local save - DONE, committed + pushed. 13 Vitest tests; window.dev console hooks until T0.5. Note for Phase 1 balancing: starting coins (50) live in gameState.ts, fold into src/data/ config later
- T1.9 Onboarding - DONE through five rounds (T1.9 base, a: modal input blocking + occlusion, b: 12-step redesign, c: glow/swipe/review steps, d: polish, e: PM-direct phantom-trail root-cause fix + path restore). Final: 15-step guided first session, ghost-swipe demos, glow highlights, tap-outside panel closing, two scripted orders. User confirmed and committed
- T0.5 Debug/dev overlay - DONE, committed + pushed. Overlay confirmed working on PC and mobile (installed app + URL)
- T0.5a Lockfile CI fix - DONE (PM-direct fix, user-approved). Deploy green again; CLAUDE.md lockfile guard rule added
- PHASE 0 COMPLETE
- T1.1 Crop data + plot state machine - DONE, committed + pushed, deploy green. 42 tests; ready is derived, never stored; provisional economy numbers (placeholder until balancing spreadsheet)
- T1.2 Grid rendering + growth visuals - DONE (user visual test passed, committed). Deferred T0.5 time-warp check closed. Art-pass note: occupied plots need a distinct tile variant (see roadmap T2.6)
- T1.3 Seed bar + paint planting - DONE (committed, deploy green, phone thumb-feel test passed). PlotPointerTracker is the shared gesture pattern
- T1.4 Sweep harvesting - DONE incl. T1.4a gesture mode latch (user feel test passed, committed)
- T1.5 Pooled juice systems - DONE (user phone test passed incl. haptics, committed). Pool<T> pattern + stats registry is the standard for all future effects
- T1.6 HUD + inventory + selling - DONE after four follow-ups: T1.6a (layout + crop-to-bag flights), T1.6b (CI type error, PM fix), T1.6c (spacing/moondust/font polish, PM fixes). Live v1->v2 migration confirmed on user's real save. All green
- T1.7 XP + farm level - DONE (committed, deploy green, user played 1->3 with celebrations after clearing SW cache). "Stuck at level 1" report was the stale service-worker build - third SW-cache incident; build stamp in dev overlay queued as a small backlog item

## Blockers
- None.

## Notes
- PM owns docs/; coder never reads docs/. PM maintains this file + decisions.md.
- Each task prompt carries a model recommendation (Fable5/Opus vs Sonnet).
