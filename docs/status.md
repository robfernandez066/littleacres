# Little Acres - Status

**Updated:** 2026-07-10
**Phase:** Phase 2 - polish from play notes
**Active task:** T1.12c (audio swaps + slow expansion reveal) - prompt delivered, FRESH session, Sonnet; awaiting coder report. T1.12b DONE (review + user ear test passed, commit message delivered). PENDING CONFIRMATION: Actions green on the T2.9 and T1.12b pushes. NOTE: PM sandbox mount served corrupt copies of ALL fresh coder writes during review (T0.3 precedent, sharper diagnosis this time): the mount clips fresh content to each file's OLD byte length - NUL-padded when the new file is shorter, silently truncated when longer, and byte counts alone cannot detect the latter. PM ran a partial verification in a repaired scratch copy (63/63 tests pass across 7 files incl. the new onboarding chain tests; gameState.test.ts and 4 src files unverifiable there). Direct Read of every affected file confirmed the repo itself is intact. Authoritative test/build/lint run belongs to the user's machine. Standing PM rule: review fresh coder work via direct reads only; the outputs-folder bridge works for NEW files if sandbox execution is ever essential.

## Play-notes queue (from the 2026-07-10 gate notes, in order)
- T2.9 Tutorial rails: full lock (only the current step's action works), sell/bag steps removed, chain 15 -> 10, Order A 63 -> 95 coins, plant-mixed per-crop caps, v8 migration. ACTIVE
- T2.10 While You Were Away redesign: title "While You Were Away for X Hr Y min", one "n <Crop> Ready" line per crop, remove "Collect them with a sweep!", add Confirm button
- T2.11 Dynamic order-card layout: 1 item type = large centered icon/text, 2 = centered pair, 3 = single smaller row (generator emits max 2 today; 3 is future-proofing)
- T2.12 Order-skip cooldown escalation: 3s base, ~5x per skip (3s/15s/75s/~6min/10min cap), skip counter resets when the last skip is >6h old; all config; needs schema bump (persist skip count + last-skip timestamp)
- T2.14 Crop tap countdown (user note 2026-07-10): tapping a growing-but-not-ready crop shows a big readable countdown above that plot (live-updating, pooled, one active at a time - last tap wins; auto-hides after a few seconds or when the crop ripens). Tap already fails silently on these plots today, so this fills dead input with information
- T2.15 Seed info button (user note 2026-07-10): small "i" on each seed bar button opening an info card - grow time, seed cost, sell value, xp, plus a flavor line per crop (PM writes flavor copy, user approves; new field in CropDef, i.e. data-driven). Pattern must be reusable for future processed goods/recipes (bread, flour - Phase 4)
- T2.13 HUD theming pass (user note 2026-07-10): top UI needs a cohesive holder instead of loose buttons; level number + xp bar must match the wood/panel theme. DECIDED: the Audio button leaves the top-level HUD - it becomes a small settings gear in a corner (it is not gameplay and does not belong stacked under the currencies). Art-first workflow: PM shows 2-3 layout mockups (pictures, per the spatial rule), then supplies Sprixen prompts for the new frames (HUD banner/plaque, xp bar frame + fill, gear icon), user generates and auditions, then the code task lands the swap
- T1.12c Audio swap + slow expansion reveal (user picks delivered 2026-07-10 into tools/audio-staging/): coin1.mp3 -> coin.mp3 (replaces coin.ogg), farm_expand.mp3 -> expand.mp3 (new 'expand' sfx + redesigned 6s staggered plot fade-in reveal), ambient_loop.mp3 -> ambient.mp3 (loops on the music channel, no third slider). Runs AFTER T1.12b. confirm.mp3 stays in staging until T2.10 wires its button. Tutorial-complete jingle: user chose to keep the levelup reuse. SFX audit otherwise closed (skip/panel tap reuse is deliberate). Sources for future hunts: Kenney CC0 (kenney.nl) + Pixabay (pixabay.com/sound-effects; music id 551390)
- Logged, not scheduled: "Major Shipments" concept for 4+ item orders via a special delivery building (roadmap Phase 4 note)

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
- PHASE 1 GATE - CLOSED EARLY (2026-07-10, day 3): user judged the game too thin for a full week of play; day-3 notes accepted as the gate output and turned into the play-notes queue above
- T2.9 + T2.9a + T2.9b Tutorial rails + completion celebration - DONE, committed 2026-07-10 (user playtest passed; 170 tests; v8 schema). Full rails choke point, 10-step chain, Order A 95, "Little Acres is yours!" ending with Let's Go button

## Blockers
- None.

## Watch items
- 2026-07-10: user saw frozen crop growth on the deployed build (warp didn't mature them; resumed spontaneously ~while toggling the orders board). Leading hypothesis: the T1.1-logged dev artifact - warp + plant + refresh leaves plantedAt in the future of the real clock (warp offset is in-memory, never saved), crops freeze until wall clock catches up; panel timing coincidental. No task. If it recurs: dev overlay state inspector, check the frozen plot's plantedAt vs current time; if plantedAt is NOT in the future, export the save immediately and give it to the PM - that would be a real bug.

## Notes
- PM owns docs/; coder never reads docs/. PM maintains this file + decisions.md.
- Each task prompt carries a model recommendation (Fable5/Opus vs Sonnet).
