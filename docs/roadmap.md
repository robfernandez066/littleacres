# Little Acres - Implementation Roadmap v0.1 (Claude Code Task Breakdown)

Tech stack: **Phaser 3 + TypeScript + Vite**, web-first PWA, Capacitor wrap in Phase 8.

## How to use this document

- Each task is designed to be a single, self-contained Claude Code session (or one task within a longer session).
- Keep this roadmap and the GDD in the repo (e.g., `docs/`); Claude Code will read them for design context.
- A `CLAUDE.md` at the repo root (created in T0.1) carries the global conventions below, so you never re-paste them.
- Tasks within a phase are ordered by dependency; don't parallelize within a phase unless noted.
- Every task lists **Acceptance criteria** - use these verbatim in the task prompt so the agent knows when it's done.
- After each phase: play the game yourself. If it isn't fun/feeling right, fix before moving on. Juice problems compound.
- Recommended repo hygiene: one branch per task, small PRs, agent writes/updates tests where noted.

### Global conventions (put these in CLAUDE.md at the repo root so Claude Code applies them to every task automatically)

- TypeScript strict mode; no `any` unless justified in a comment.
- All game data (crops, orders, levels, prices) lives in typed JSON/TS config files under `src/data/` - never hardcoded in scene logic.
- Game state is a single serializable object managed by a `GameState` store; scenes render from state, never own it.
- All timers derive from real timestamps (`Date.now()`), never accumulated frame deltas - this makes offline progress free.
- Object pooling for particles, floating text, and coin sprites.
- Target 60fps on mid-range phones; portrait 1080x1920 design resolution with responsive scaling.
- No em dashes in any user-facing text; use regular dashes.

---

## Phase 0 - Skeleton (est. 3-5 tasks)

**Goal:** empty but running game you can open on your phone's browser.

**T0.1 - Project scaffold**
Set up Vite + Phaser 3 + TypeScript project with strict tsconfig, ESLint, Prettier, folder structure (`src/scenes`, `src/systems`, `src/data`, `src/ui`, `assets/`, `docs/`). Boot scene -> Preload scene -> Farm scene displaying a placeholder background at 1080x1920 portrait with FIT scaling. Create `CLAUDE.md` at the repo root containing the Global Conventions from this roadmap, plus pointers to `docs/gdd.md` and `docs/roadmap.md`.
*Acceptance:* `npm run dev` opens a portrait game canvas; `npm run build` produces a deployable bundle; lint passes.

**T0.2 - PWA + deploy pipeline**
Add PWA manifest, service worker (via vite-plugin-pwa), and a GitHub Actions workflow deploying to GitHub Pages (or Netlify) on push to main.
*Acceptance:* pushing to main publishes a URL; opening it on a phone allows "Add to Home Screen"; app launches fullscreen portrait.

**T0.3 - Asset pipeline + placeholder art**
Create a texture-atlas pipeline (free tool or script), load a placeholder isometric tile set: grass tile, dirt plot tile, 3 crop sprites x 3 growth stages, coin icon, simple UI 9-slice panel. Document how to swap the asset pack in `ASSETS.md`.
*Acceptance:* Farm scene renders a 4x3 isometric grid of plots on a grass field; atlas loads via Preload scene with a progress bar.

**T0.4 - GameState store + local save**
Implement `GameState` (coins, xp, level, plots[], inventory, seeds, settings) with save/load to localStorage, autosave every 10s and on visibilitychange, versioned schema with migration hook, and manual export/import (copy-paste JSON string) in a debug menu.
*Acceptance:* state survives refresh; corrupting the save triggers a clean reset without crashing; export/import round-trips.

**T0.5 - Debug/dev overlay**
Toggleable dev overlay: FPS, state inspector, buttons to add coins/XP, reset save, and time-warp (advance all timers by N minutes).
*Acceptance:* overlay toggles with a hidden gesture/key; time-warp visibly matures crops.

---

## Phase 1 - MVP Core Loop (est. 10-12 tasks)

**Goal:** the complete plant -> grow -> harvest -> sell/fulfill -> level loop. Fun test at the end.

**T1.1 - Crop data + plot state machine**
Define `CropDef` config (id, name, seedCost, sellValue, growMs, xp, spriteKey, unlockLevel) with Sunwheat (30s, level 1), Carrot (2m, level 2), Glowberry (5m, level 3). Plot states: empty -> growing(cropId, plantedAt) -> ready. Growth is timestamp-derived.
*Acceptance:* unit tests cover state transitions and growth math including "app closed during growth."

**T1.2 - Grid rendering + growth visuals**
Render 12 plots (4x3) isometric. Show crop sprite per growth stage (3 stages from elapsed fraction). Ready crops get a subtle bounce tween and slight glow tint.
*Acceptance:* planting via debug shows staged growth in real time; ready state is visually obvious at a glance.

**T1.3 - Seed selection UI + paint planting**
Bottom-sheet seed bar showing unlocked seeds with cost. Select seed -> drag finger across empty plots to plant each touched plot (deduct seed cost per plot, spawn plant "plip" placeholder feedback). Tap single plot also works. Insufficient coins = gentle shake + red flash on cost, no error modal.
*Acceptance:* one continuous drag plants 6+ plots; costs deducted correctly; cannot plant on occupied plots; locked seeds show level requirement.

**T1.4 - Sweep harvesting**
Drag across ready crops to harvest each in sequence: crop pops (scale tween), floating "+N" label, item flies to inventory HUD, plot returns to empty. Tap-to-harvest also works. Non-ready crops are ignored by the sweep.
*Acceptance:* sweeping a full ready field harvests everything touched in one gesture at 60fps; inventory counts correct.

**T1.5 - Floating text + particle + coin-arc systems (pooled)**
Reusable pooled systems: FloatingText (arcs up, fades), ParticleBurst (leaf/sparkle presets), CoinArc (sprite flies along a curve to the HUD counter, counter ticks up on arrival).
*Acceptance:* harvesting 12 crops rapidly spawns all effects with zero GC hitches; pool sizes logged in dev overlay.

**T1.6 - HUD + inventory**
Top HUD: coins (animated ticker), farm level + XP progress bar, Moondust slot (icon + count, earns nothing yet - reserved). Inventory panel listing crops with counts and sell-all-per-crop buttons (sell = coin arc + ticker).
*Acceptance:* selling 50 wheat feels good (batched coin arcs, not 50 individual), totals correct.

**T1.7 - XP + farm level system**
XP from harvesting and orders. Level curve in config (levels 1-5 for MVP). Level-up: fast full-screen celebration (burst, chime hook, "Level 3!" banner) + unlock reveal card ("Carrot seeds unlocked!").
*Acceptance:* leveling from 1 to 3 unlocks Carrot then Glowberry in the seed bar with reveal moments.

**T1.8 - Order board**
Order config + generator: 3 visible orders, each requesting 1-2 crop types in quantities scaled to player level, rewarding coins + XP (reward slightly better than raw selling to make orders the smart play). Fulfill button active when inventory covers it: goods fly out, stamp animation, reward burst. Skipped orders refresh after a short cooldown; no deadlines.
*Acceptance:* orders always reference unlocked (or next-unlock teaser) crops; fulfilling and refreshing both work; reward math matches config.

**T1.9 - Quest-driven onboarding**
First-session scripted order chain teaching the loop: "Plant 3 Sunwheat" -> "Harvest your Sunwheat" -> "Deliver 5 Sunwheat" -> "Buy Carrot seeds" etc. Contextual pulse-highlight system: soft pulsing ring on the next relevant button/plot when a tutorial step is active or the player idles 10s+ during onboarding.
*Acceptance:* a fresh save walks a new player to level 2 with zero text walls; pulses point at the correct targets; onboarding never triggers again after completion.

**T1.10 - Plot expansion upgrade**
Shop item: expand 12 -> 16 plots (coin cost from config). New plots appear with an overgrowth-clearing puff.
*Acceptance:* purchase gate works, new plots fully functional, state persists.

**T1.11 - Basic offline growth**
On load, crops resolve growth from timestamps (already free via T1.1). Add a simple "While you were away" panel when >2 min elapsed: lists crops that became ready.
*Acceptance:* close app with growing crops, reopen after grow time, panel shows results and field state is correct.

**T1.12 - Sound hooks + placeholder SFX**
AudioManager with channels (music, sfx), settings toggles, and placeholder sounds wired: harvest pop (with pitch-up on rapid chain), plant plip, coin, order fanfare, level-up chime, UI tap. Lo-fi placeholder music loop.
*Acceptance:* rapid sweep-harvest produces the escalating pitch chain; mute settings persist.

**PHASE 1 GATE: play it for a week. Is the loop fun with placeholder art? If not, iterate here before Phase 2.**

---

## Phase 2 - Juice + Quality of Life (est. 6-8 tasks)

**Goal:** make the MVP *feel* shippable.

- **T2.1** Haptics (Vibration API): light on harvest, medium on order complete, pattern on level-up; settings toggle.
- **T2.2** Smart replant: after harvesting, a brief "replant Sunwheat?" chip appears; one tap replants all just-harvested plots (if affordable).
- **T2.3** Squash/stretch + anticipation pass: all buttons, plots, chests; ready-crop idle bounce tuning; screen-edge glow when any crop is ready.
- **T2.4** Offline summary v2: collect-all button, coins/XP earned display, capped-at line item (future-proofing for storage).
- **T2.5** Moondust earning: awarded on level-up and rare harvest procs (config-driven rare variant: e.g., 2% Radiant crop = 5x value + sparkle burst + Moondust chance). No sinks yet beyond a "coming soon" shop tab.
- **T2.6** Real asset pack integration: purchase/import isometric farm pack, swap placeholders, document palette/scale rules in `ASSETS.md`.
- **T2.7** SFX/music v2: sourced or licensed lo-fi loop + polished big-four SFX.
- **T2.8** Performance pass: profiling on a real mid-range phone, pooling audit, texture memory check.

---

## Phase 3 - Depth Layer 1 (est. 8-10 tasks)

**Goal:** the optimization game begins.

- **T3.1** Crops 4-8 (e.g., Moonroot, Emberpepper, Dewmelon, Sagesprig, Starcorn) with varied time/value curves (config only + art).
- **T3.2** Storage caps: per-category caps (crops), storage building UI, upgrade tiers; offline production respects caps; gentle "storage full" state (never blocks manual harvest into overflow decisions - design detail: harvested crops beyond cap auto-sell at a small discount, so nothing is ever lost).
- **T3.3** Land expansion system: unlock adjacent grid regions with coins + level gates; overgrowth-clearing reveal animation; mere glow brightens per region (global tint/lighting step).
- **T3.4** Camera: pinch zoom + pan within unlocked bounds; snap-back at edges; UI stays fixed.
- **T3.5** Crop mastery: per-crop XP on harvest, mastery levels grant config-driven bonuses (yield/speed/sell); mastery page UI with satisfying progress bars.
- **T3.6** Order board v2: 5 visible orders, rarity tiers (bigger rarer orders grant chests), order refresh token economy.
- **T3.7** Reward chests: chest item + opening ceremony (wiggle, tap, burst, card reveals) granting coins/seeds/Moondust/boost items.
- **T3.8** Boost items: 2x growth speed (30 min), instant-grow single plot, etc.; inventory + activation UI.

---

## Phase 4 - Production Chains (est. 6-8 tasks)

- **T4.1** Building placement system on grid (hybrid layout: buildings occupy tiles, movable in edit mode).
- **T4.2** First processors: Mill (Sunwheat -> Sunflour), Preserve Pot (Glowberry -> Glowjam); queue-based, timestamp timers, collect on tap (no dragging goods - inputs auto-pull from storage).
- **T4.3** Processed goods in economy: higher value, requested by orders; recipe unlock reveals.
- **T4.4** Order board v3: mixed raw + processed orders; premium timed orders (opt-in, bonus-only, clearly marked; expiring quietly replaces them - no failure sting).
- **T4.5** Building upgrade tiers (speed, queue slots).
- **T4.6** Mystery merchant: occasional visitor with rotating Moondust/coin offers (rare seeds, boosts, decorations preview).

---

## Phase 5 - Magical Workers (est. 6-8 tasks)

- **T5.1** Worker framework: worker entities with job types, assignment UI, tick logic that also runs offline (timestamp simulation on load).
- **T5.2** Harvest Golem: auto-harvests ready crops in an assigned region on a cadence.
- **T5.3** Broom Courier: auto-fulfills selected order types when stock allows (player whitelist - automation the player *tunes*).
- **T5.4** Sprout Sprite: auto-replants last crop on harvested plots.
- **T5.5** Worker upgrades (speed/capacity) + tiny idle animations/pathing for life.
- **T5.6** Tool upgrades: wider harvest sweep radius, batch-plant size, etc.

---

## Phase 6 - Meta Systems (est. 5-7 tasks)

- **T6.1** Research tree: research points from orders/mastery; branching config-driven tree (economy, growth, automation branches); node-unlock ceremony.
- **T6.2** Weather ambiance v1: visual-only rain/sun/fireflies; later hook for surprise buffs ("Warm rain! Crops grow 20% faster for 10 min").
- **T6.3** Player-level/account perks (or merge into farm level - decision point).
- **T6.4** Quests/bounties board: rotating goals ("harvest 100 Moonroot this week") with chest rewards.
- **T6.5** Economy balancing pass with telemetry hooks (local analytics log to tune curves).

---

## Phase 7 - Comfort + Retention (est. 5-6 tasks)

- **T7.1** Day/night visual cycle tied to real clock, gentle lighting shifts, firefly particles at night near the mere.
- **T7.2** Decorations: placeable cosmetics purchasable with coins/Moondust; edit mode polish.
- **T7.3** Opt-in notifications (light): only "big order ready" and "storage full," max 1/day, full settings control.
- **T7.4** Cloud save: anonymous account + sync (e.g., Supabase/Firebase), conflict resolution = newest-wins with manual restore.
- **T7.5** Accessibility pass: color-blind-safe ready states, reduced-motion mode, text scaling.

---

## Phase 8 - Store Release (est. 4-6 tasks)

- **T8.1** Capacitor wrap: iOS + Android projects, native haptics upgrade, splash/icons.
- **T8.2** Store assets: screenshots, listing copy, privacy policy.
- **T8.3** Device QA matrix + crash reporting (Sentry).
- **T8.4** Soft-launch build + feedback loop.
- **T8.5** Monetization decision point: if pursued, rewarded ads only at first (chest re-roll, boost extension), designed as bonus - never gating the base loop.

---

## Sequencing Notes

- Phases 3 and 4 can partially interleave; workers (5) hard-depend on buildings (4.1) and storage (3.2).
- Every phase ends with a "play it" gate. The roadmap is allowed to change after each gate - it's a plan, not a contract.
- Balancing spreadsheet (crop values, level curve, upgrade costs) should be built alongside Phase 3 and treated as the single source of truth exported into `src/data/`.
