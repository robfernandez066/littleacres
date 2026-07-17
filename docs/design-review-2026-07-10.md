# Design Review 2026-07-10 (external)

**Status:** ACTIVE (advisory) - one-time external review; triage complete 2026-07-10 (decisions archive carries it); consult at phase gates only, rejected items are settled and never re-litigated.
**Supersede rule:** when a newer design review arrives, mark this file SUPERSEDED at the top and carry forward only items still open in the roadmap.

---

# Little Acres - CEO/Design Review (2026-07-10)

Reviewed: GDD, roadmap, status, decision log, ASSETS.md, all of src/data, gameState schema, atlas contents, audio config. No files changed.

Overall verdict: The foundation is unusually strong - clean architecture, disciplined process, real art and sound, a tested save system. The problem is exactly what the day-3 gate said: the game is too thin, and the current Phase 2 queue is mostly polishing the thin game instead of thickening it. Six of the seven queued tasks (T2.10-T2.15) are UI/UX refinement. None add a reason to play tomorrow.

## 1. Add NOW

- Content depth ahead of polish. 3 crops, 5 levels, 16 plots, 3 order slots. A player exhausts everything in ~1 hour. Pull 2-3 crops from T3.1 (Moonroot, Emberpepper) and extend levels to ~8 forward into Phase 2. This is the direct answer to the gate verdict; T2.11/T2.13/T2.15 can wait behind it.
- Smart replant (T2.2). It's in the GDD's core loop description but not in the active queue. Replanting a full field by hand is the most repeated friction in the game.
- Moondust earning (T2.5) + the rare Radiant variant. The HUD has shown a currency that never moves since T1.6 - a visible broken promise. This is also the only randomness/excitement mechanic (GDD 4.5) anywhere near-term; the current build has zero surprise in it.

## 2. Add SOON

- Max-level UX. Nothing defines what the XP bar does at MAX_LEVEL 5. Players will hit the cap and stare at a dead progress bar. Define it (bank XP, "MAX" state) or raise the cap.
- Reward chests (T3.7). Second-highest item on the GDD's own dopamine priority ranking, currently a full phase away. A minimal chest (occasional big-order reward) would do a lot per unit of work.
- Economy balancing spreadsheet. Scheduled "alongside Phase 3," but balance calls are already being made by feel (Order A 63->95, unit caps, expansion 500). Also: Sunwheat currently beats both Starcorn and Glowberry on coins/min AND xp/min - longer crops are only a convenience play, so an active player optimally spams Sunwheat forever. Build the sheet before adding crops 4-8 on vibes.

## 3. Not on the roadmap but absolutely should be

- Save durability. Saves live in localStorage only until cloud save in Phase 7. Browsers (especially iOS PWA) evict localStorage under storage pressure - a lost save is a lost player. Cheap near-term fixes: navigator.storage.persist(), surface export/import in the Settings panel (currently dev-overlay only), consider an IndexedDB mirror. The two-tab overwrite is logged but this broader risk isn't.
- "Update available" toast. Three separate stale-service-worker incidents fooled the developer; players will silently run old builds for days. vite-plugin-pwa supports an update prompt - a small task that kills a recurring failure class.
- The mere. Pillar 5 is "the farm visibly comes back to life" and the GDD calls the mere "the world's ambient light literally tracks your progress" - yet the mere has no art, no screen presence, and no task before T3.3. Even a static dim-mere backdrop with a per-level brightness step would put the game's signature emotional hook on screen now.
- External playtesters. No outside human plays the game until Phase 8 soft launch. The tutorial needed five fix rounds based on one player. The PWA is public - hand the URL to 3-5 friends after the current queue lands.

## 4. Things that don't make sense

- T2.12 skip-cooldown escalation (up to 10 min) vs. Pillar 2. "The player is never punished" - then a 6-10 minute lockout for using a button we gave them, when with only 3 crops skipping a Glowberry-heavy order is often rational. Recommend capping around 60-120s, or waiting for the T3.6 refresh-token economy. At minimum re-justify it against the pillar.
- GDD/implementation mismatch on order slots. GDD MVP says "order board (5-10 orders)"; the game has 3 and T3.6 grows it to 5. Fine as a decision, but one doc is wrong - reconcile.
- Phase 2 scope creep. Phase 2 was "6-8 tasks"; it's now 15. It's absorbing the content phase's oxygen. Re-cut the queue by value, not by phase number.

Explicitly fine, nothing needed: audio direction and pipeline (post-audit state is strong; remaining work already queued), art workflow (Sprixen + atlas packing working well; only queued nits remain), the PM/coder process itself, the parked Mine and Major Shipments concepts, core architecture (state/timers/pooling match conventions), and monetization posture.

## 5. Tasks for the PM

1. Re-cut the Phase 2 queue by value: promote T2.2 (smart replant) and T2.5 (Moondust + Radiant variant) into the active queue; sequence T2.11/T2.13/T2.15 behind content work.
2. Content injection task: 2-3 new crops from the Phase 3 list + level cap raised to ~8 with unlock reveals, provisional numbers from the new balance sheet.
3. Economy balance spreadsheet as the single source of truth exported into src/data/, including a coins-per-minute / xp-per-minute audit so longer crops have a real niche.
4. Save durability task: navigator.storage.persist(), export/import surfaced in Settings, evaluate IndexedDB mirror; document the eviction risk in the GDD.
5. SW update-available toast via vite-plugin-pwa's update prompt.
6. Mere backdrop art task (Sprixen prompt kit + per-level brightness tint step) - pillar 5 on screen now.
7. Define max-level XP behavior (design decision + small code task).
8. Revisit T2.12 against Pillar 2: cap the escalation low or defer to refresh tokens.
9. Minimal chest v1 attached to large orders (wiggle-tap-burst ceremony can start simple).
10. External playtest round after the current queue: 3-5 fresh-save installs, PM triages notes as a mini-gate.
