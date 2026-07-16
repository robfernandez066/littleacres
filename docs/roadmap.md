# Little Acres - Implementation Roadmap v0.1 (Claude Code Task Breakdown)

Tech stack: **Phaser 3 + TypeScript + Vite**, web-first PWA, Capacitor wrap in Phase 8.

## How to use this document

This project runs through a two-agent workflow with you (the human) in the loop as courier:

- **The PM (project manager agent)** owns `docs/` - this roadmap, the GDD, `status.md`, and `decisions.md` - and turns roadmap tasks into self-contained prompts.
- **The coder (Claude Code)** does the implementation. It never reads `docs/`; every piece of design context it needs is baked into the task prompt the PM writes.
- **You** paste the PM's task prompt into Claude Code, then paste Claude Code's end-of-task report back to the PM.

The loop for each task:

1. **PM writes a self-contained task prompt** for the next task (all design context, acceptance criteria verbatim, no reference to `docs/`).
2. **You paste it into Claude Code.** Claude Code implements it and returns its end-of-task report (template in `CLAUDE.md`). It does not commit or push.
3. **You paste the report back to the PM.**
4. **The PM interprets the report and responds with exactly one of:**
   - **COMMIT** - report checks out and acceptance is met; commit the working tree as-is (the PM supplies a commit message).
   - **USER TEST** - acceptance needs human play/feel testing; the PM tells you what to try, and you report back before it decides.
   - **CODER FIX** - a gap, bug, or unmet criterion; the PM issues a follow-up fix prompt for Claude Code.
   - **NEXT TASK** - this task is fully resolved; the PM hands over the next task's prompt.
5. **The PM updates `status.md` and `decisions.md` itself after every report.** You never edit those.

Conventions and process notes:

- `CLAUDE.md` at the repo root is **authored and maintained by the PM** (not created in T0.1). It carries the global conventions below plus the standing rules (never read `docs/`, never commit/push) and the mandatory report template.
- Tasks within a phase are ordered by dependency; don't parallelize within a phase unless noted.
- Every task lists **Acceptance criteria** - the PM copies these verbatim into the prompt so the coder knows when it's done.
- After each phase: play the game yourself. If it isn't fun/feeling right, tell the PM before moving on. Juice problems compound.

### Global conventions (mirrored into CLAUDE.md so the coder applies them to every task automatically)

- TypeScript strict mode; no `any` unless justified in a comment.
- All game data (crops, orders, levels, prices) lives in typed JSON/TS config files under `src/data/` - never hardcoded in scene logic.
- Game state is a single serializable object managed by a `GameState` store; scenes render from state, never own it.
- All timers derive from real timestamps (`Date.now()`), never accumulated frame deltas - this makes offline progress free.
- Object pooling for particles, floating text, and coin sprites.
- Target 60fps on mid-range phones; portrait 1080x1920 design resolution with responsive scaling.
- No em dashes in any user-facing text; use regular dashes.

---

## Phase 0 - Skeleton - COMPLETE

Closed 2026-07-07 (T0.1-T0.5: scaffold, PWA + deploy, asset pipeline, GameState store, dev overlay). Task-by-task detail lives in git history and decisions.md.

---

## Phase 1 - MVP Core Loop - COMPLETE

Closed 2026-07-10 (T1.1-T1.12 + play gate, closed early per decisions - "game too thin" superseded the week-long gate). Task-by-task detail lives in git history and decisions.md.

---

## Phase 2 - Juice + Quality of Life (originally est. 6-8 tasks; grew to ~18 in the 2026-07-10 re-cut)

**Goal:** make the MVP *feel* shippable.

**RE-CUT 2026-07-10 (design-review triage; see docs/design-review-2026-07-10.md + decisions.md):** the gate verdict was "too thin," so content now outranks polish. Phase 2 absorbs a content wave: T2.2 and T2.5 promoted to the active queue; new tasks T2.16 (save durability), T2.17 (SW update toast), T2.18 (content injection: 2 crops + level cap raise + max-level UX, numbers from the balance sheet); the balance spreadsheet moves from "alongside Phase 3" to NOW (PM-built, before T2.18); T2.13's art sitting expands to include the mere backdrop and the plot-tile footprint fix; chest v1 pulled forward from T3.7 (after T2.5); T2.12's escalation cap reduced 10min -> 60s (Pillar 2); Phase 2 closes with an external playtest mini-gate (3-5 fresh installs). Sequencing exploits the two tracks: PM spreadsheet + user Sprixen art run in parallel with small coder tasks, so polish fills coder idle time instead of delaying content. Current order lives in status.md.

- **T2.1** Haptics (Vibration API): light on harvest, medium on order complete, pattern on level-up; settings toggle.
- **T2.2** Smart replant: after harvesting, a brief "replant Sunwheat?" chip appears; one tap replants all just-harvested plots (if affordable).
- **T2.3** Squash/stretch + anticipation pass: all buttons, plots, chests; ready-crop idle bounce tuning; screen-edge glow when any crop is ready.
- **T2.4** Offline summary v2: collect-all button, coins/XP earned display, capped-at line item (future-proofing for storage).
- **T2.5** Moondust earning: awarded on level-up and rare harvest procs (config-driven rare variant: e.g., 2% Radiant crop = 5x value + sparkle burst + Moondust chance). No sinks yet beyond a "coming soon" shop tab.
- **T2.6** Real asset pack integration: purchase/import isometric farm pack, swap placeholders, document palette/scale rules in `ASSETS.md`. Include an occupied-plot tile variant: empty plots keep the tilled multi-square look, but a plot with something planted should read differently (gradient or solid brown dirt). Requires a new atlas frame (e.g. `plot_occupied`) and a one-line render switch in FarmScene keyed on plot state (user request, 2026-07-07). Also needs a dedicated `moondust` icon frame - the HUD currently flat-tints the coin frame blue as a placeholder (user request, 2026-07-08).
- **T2.7** SFX/music v2: sourced or licensed lo-fi loop + polished big-four SFX. Coin fly-in sound flagged weak in the Phase 1 gate notes - replacement chosen by user audition (standing method).
- **T2.8** Performance pass: profiling on a real mid-range phone, pooling audit, texture memory check.
- **T2.9** Tutorial rails (from Phase 1 gate notes): full lock - only the current step's action works; sell/bag steps removed; chain 15 -> 10; Order A reward 63 -> 95; plant-mixed per-crop caps; v8 migration.
- **T2.10** "While you were away" redesign (gate notes): "While You Were Away for X Hr Y min" title, per-crop "n Crop Ready" lines, Confirm button, sweep-hint line removed.
- **T2.11** Dynamic order-card layout (gate notes): 1 item type = large centered, 2 = centered pair, 3 = smaller single row.
- **T2.12** Order-skip cooldown escalation (gate notes; MODIFIED 2026-07-10 per design review vs Pillar 2): 3s base, ~5x per skip, cap reduced to 60s (was 10min - a multi-minute lockout for a button we provide punishes, and skipping is often rational with few crops), counter resets when last skip >6h old; all config; schema bump for persisted skip state. Revisit against refresh tokens at T3.6.
- **T2.13** HUD theming pass (user note 2026-07-10; EXPANDED by design-review triage): unify the top UI into a themed holder (currently a loose assortment - coin, moondust, Audio, Bag, Orders as mismatched floating panels) and re-skin the level number + xp bar to match. Audio demotes to a corner settings gear. The art sitting now ALSO covers: the mere backdrop (dim glowing lake framing the field + a per-level brightness tint step - Pillar 5, pulled from T3.3's ambience; NOT currently on screen - removed long ago, and the old sprite is REJECTED by owner 2026-07-15 as too small; regenerate only after T3.3 fixes the expanded world dimensions, in the land-era art batch), the empty-plot tile footprint fix, a dedicated moondust icon if still missing, and the T2.18 crop sprites - ONE combined Sprixen batch to respect the user's generation time. PM mockups first, user auditions art before the code tasks. DECOUPLING RULE (user directive 2026-07-10): if the T2.13 code task slips for any reason, the mere backdrop + brightness step breaks out as its own task immediately - the game's signature hook must not slide with a HUD reskin.
- **T2.14** Crop tap countdown (user note 2026-07-10): tapping a growing-but-not-ready crop shows a big readable live countdown above that plot; pooled, one active at a time, auto-hides. Fills the currently-silent tap on unready plots.
- **T2.15** Seed info button (user note 2026-07-10): "i" on seed bar buttons opens an info card with grow time, seed cost, sell value, xp, and a flavor line (new CropDef field; PM writes copy, user approves). Card pattern designed to be reused by Phase 4 processed goods/recipes.
- **T2.16** Save durability (design review): call navigator.storage.persist() at boot; surface export/import save in the Settings panel (currently dev-overlay only). IndexedDB mirror evaluated and REJECTED for now (marginal over persist+export until cloud save T7.4). Eviction risk documented in GDD section 10.
- **T2.17** SW update-available toast (design review): vite-plugin-pwa onNeedRefresh -> small in-game "Update available - tap to restart" toast. Kills the recurring stale-SW failure class (three logged incidents).
- **T2.18** Content injection (design review + gate verdict): 2 new crops from the Phase 3 list (Moonroot + Emberpepper; art via the user's Sprixen batch) + level cap raised (target ~7-8) with unlock reveals + max-level UX (bar full with "MAX" label, xp keeps accruing in state so later cap raises reconcile naturally). All numbers from the PM balance spreadsheet, approved by the user first. T3.1 shrinks accordingly (Dewmelon, Sagesprig, Moonroot/Emberpepper promoted out).
- **Chest v1** (pulled forward from T3.7, after T2.5): large orders occasionally grant a chest - wiggle, tap, burst, reveal card granting coins/seeds/Moondust. Minimal ceremony, config-driven contents; the full chest economy stays T3.7.
- **Balance spreadsheet** (moved from Phase 3 note): PM builds the xlsx (coins/min + xp/min audit per crop, level thresholds 1-8, new-crop numbers, order/expansion sanity), user approves, values export into src/data/. Precedes T2.18. Known finding to fix: Sunwheat currently dominates both coins/min AND xp/min; longer crops keep the AFK niche but need order-demand and xp compensation so active play isn't pure Sunwheat spam.
- **PHASE 2 GATE (new): external playtest round** - hand the public PWA URL to 3-5 fresh players after the content wave lands; PM triages their notes as a mini-gate. First outside humans before Phase 3.

---

## Phase 3 - Depth Layer 1 (est. 8-10 tasks)

**Goal:** the optimization game begins.

- **T3.1** Crops 4-8 (e.g., Moonroot, Emberpepper, Dewmelon, Sagesprig - Starcorn was promoted to the MVP level-2 crop, replacing Carrot) with varied time/value curves (config only + art).
- **T3.2** Storage caps: per-category caps (crops), storage building UI, upgrade tiers; offline production respects caps; gentle "storage full" state (never blocks manual harvest into overflow decisions - design detail: harvested crops beyond cap auto-sell at a small discount, so nothing is ever lost). **WAVE 4 HOLD (owner 2026-07-15):** pairs with the owner's partial-sell idea (sell X of a crop, not all-or-nothing) in one inventory-economy package - caps without partial selling would be actively annoying.
- **T3.3** Land expansion system: unlock adjacent grid regions with coins + level gates; overgrowth-clearing reveal animation; mere glow brightens per region (global tint/lighting step). **WAVE 3 LEAD (owner 2026-07-15):** strongest demand signal on record - the playtest tester and the external review both asked for a bigger farm.
- **T3.4** Camera: pinch zoom + pan within unlocked bounds; snap-back at edges; UI stays fixed. (Owner emphasis 2026-07-12: panning must be SMOOTH, and bounds tight - enough room to arrange decor/buildings, never oceans of dead space. Positioned late-roadmap as a package with land expansion T3.3 - whichever moves first pulls the other.) **WAVE 3 with T3.3 (owner 2026-07-15), under the owner's 2026-07-14 guardrails:** HUD stays fixed, tight bounds, pinch suppresses taps, one-hand play remains the default, reset/recenter control; readability baseline landed separately with T3.23.
- **T3.5** Crop mastery: per-crop XP on harvest, mastery levels grant config-driven bonuses (yield/speed/sell); mastery page UI with satisfying progress bars. **WAVE 4 HOLD (owner 2026-07-15):** no player demand signal yet; competes with land/restoration for the same retention slot.
- **T3.6** Order board v2: 5 visible orders, rarity tiers (bigger rarer orders grant chests), order refresh token economy.
- **T3.7** Reward chests: chest item + opening ceremony (wiggle, tap, burst, card reveals) granting coins/seeds/Moondust/boost items.
- **T3.8** Boost items: 2x growth speed (30 min), instant-grow single plot, etc.; inventory + activation UI.

**WAVE 2 (blessed 2026-07-12, pulled ahead of T3.1-T3.8; see decisions):**

- **T3.9** Decorations v1 (DONE): decor shop opened from the farmhouse (coins/moondust - THE moondust sink), save-persisted placements (schema v10), ground-shadow system, decor art pack; **T3.9a** player arrange mode (store-authoritative transforms); **T3.9b** warehouse model (purchases go to a warehouse, placed from arrange mode at fixed default/max size); **T3.9c** polish pass parked as a backlog nit.
- **T3.10** Quests/Bounties v1 (DONE): scroll icon returns as the quest board; 7 long cumulative quests + weekly quests (real-clock weekly reset; Weekly Growth is grow-minutes based to resist sunwheat spam); rewards: quest-exclusive trophy decor > chests > moondust; persistent counters (schema v11).
- **T3.11** Crops + cap 8 (DONE 2026-07-13): Dewmelon L7, Sagesprig L8 (balance sheet v2 numbers; thresholds 3500/5500); seed bar next-locked-teaser rule.
- **PHASE GATE (ACTIVE, rescoped to 1 tester - see decisions):** running since 2026-07-13; first observed session triaged into T3.12-T3.14.
- **T3.12** Pre-gate polish (DONE 2026-07-13): vibration settings toggle (schema v12), tutorial structures stay opaque, coin sfx phone-audible.
- **T3.13** Economy clarity (DONE 2026-07-13): plant cost floats, anchored currency info popups, two-tap sell confirm.
- **T3.14** Tutorial + quest board guidance (DONE 2026-07-13): notice-board step structure pulse + "!" bounce, quest Claim hidden until claimable, first-open quest explainer (schema v13).

**WAVE 3 (blessed 2026-07-15 at the playtest-gate wrap; gate evidence: voluntary return CONFIRMED, level 8, no stuck points):**

- **Lead: T3.3 + T3.4 as one package** (land expansion + camera; see their entries above for the owner's guardrails). Whichever task moves first pulls the other, per the standing note.
- **Second: Restoration chapter v1** (decorative buildings / farmhouse upgrade territory; direct tester demand). CONTINGENT on a PM boundary doc vs T3.3 - what is "new land" (T3.3) vs "restoring what is already there" (this chapter) - which the owner reviews BEFORE any coder prompt exists.
- **Small rider: direct arrange-mode entry** (tester wish: edit the layout without going through the shop) - runs between features like T3.24 did.
- Deferred to wave 4: T3.5 crop mastery, T3.2 storage caps (+ partial-sell pairing) - see their entries. Wave 4 candidates from the 2026-07-15 owner batch: layout presets + arrange-session undo (interacts with the parked full-farm rearrangement); player-placeable stone/dirt paths (terrain decals, free-ish, generous soft caps, maybe a shared fence budget - needs design).
- In flight at cut time: T3.24 inventory column labels (tester usability find).

---

## Phase 4 - Production Chains (est. 6-8 tasks; REFINED 2026-07-12 per owner direction - layered recipes + quest integration; T3.2 storage caps are the prerequisite since inputs auto-pull from storage)

- **T4.1** Building placement system on grid (hybrid layout: buildings occupy tiles, movable in edit mode).
- **T4.2** First processors: Mill (Sunwheat -> Sunflour), Preserve Pot (Glowberry -> Glowjam); queue-based, timestamp timers, collect on tap (no dragging goods - inputs auto-pull from storage).
- **T4.3** Processed goods in economy: higher value, requested by orders; recipe unlock reveals. LAYERED RECIPES (owner spec 2026-07-12): products chain by building complexity - e.g. wheat -> flour (Mill), flour -> bread (Bakery), flour + other ingredients -> cake; depth varies per building. Orders AND quests updated to request processed items (extends T4.4 and the quest pool).
- **T4.4** Order board v3: mixed raw + processed orders; premium timed orders (opt-in, bonus-only, clearly marked; expiring quietly replaces them - no failure sting). Concept from Phase 1 gate notes: orders with 4+ item types don't fit the card layout - consider a separate "Major Shipments" system delivered by a special building (magical delivery balloon/train) instead of cramming the board.
- **T4.5** Building upgrade tiers (speed, queue slots).
- **T4.6** Mystery merchant: occasional visitor with rotating Moondust/coin offers (rare seeds, boosts, decorations preview).

---

## Phase 4A - Animal / Creature Farming (owner spec 2026-07-12; est. 5-7 tasks; after Phase 4's processing intro)

- **T4A.1** Animal building framework: each animal TYPE has its own building placed on the farm layout, purchased with gold (v1; "rebuild with materials" variant becomes available once the Mine supplies materials). Inside: 1 open animal slot + additional locked slots purchasable with gold (max per building TBD at prompt time - owner decision).
- **T4A.2** Harvest loop: each occupied slot produces that animal's material on a LONG timer (timestamp-derived, offline-friendly); harvesting collects and resets the timer; the animal persists (never re-acquired).
- **T4A.pets** (owner, 2026-07-15, unscheduled annotation): buyable companion pets (dogs/cats) that roam the farm + dog house / cat tree decor (gold variants gated on achievements, trophy precedent). Same roaming/animation dependency as T4A.3's future polish - schedule only when a real sprite-animation pipeline exists.
- **T4A.3** Ambient life: an animal sprite idles NEAR its building (separate sprite from the building; e.g. eating in front of it), animated in v1 with TWEEN JUICE ONLY (bob/hop/peck loops - the established pattern). True sprite-sheet animation is a future polish item by owner decision (2026-07-12) - no spike, no thought spent until then.
- **T4A.4** v1 scope: at least 2 animal types = 2 building sprites + 2 static animal sprites; materials enter the economy (orders/quests/recipes per Phase 4 patterns).

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
- **T6.4** Quests/bounties v2 (v1 shipped early as T3.10 - wave 2, 2026-07-12): expand the pool, seasonal/rotating specials, processed-goods quests once Phase 4 lands.
- **T6.5** Economy balancing pass with telemetry hooks (local analytics log to tune curves).

---

## Phase 7 - Comfort + Retention (est. 5-6 tasks)

- **T7.1** Day/night visual cycle tied to real clock, gentle lighting shifts, firefly particles at night near the mere.
- **T7.2** Decorations polish (v1 shipped early as T3.9/T3.9a/T3.9b - wave 2, 2026-07-12): edit-mode juice, sell-back/refund, expanded catalog. Overlaps the T3.9c backlog-nit list - reconcile scopes when scheduled.
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

## Parked concepts (not scheduled; revisit at phase gates)

- **Mine scene** (user pitch, 2026-07-10) - **reward-only Mine v1 variant DROPPED by owner 2026-07-14 (audit reconciliation); the full parked concept below is unaffected:** a second scene with a daily rapid-mine mini-game (simple, satisfying, deliberately UNFAILABLE - GDD forbids skill/timing requirements; rewards scale with participation, not performance). Grants mine XP + random materials; mine levels raise AFK material yields and rare-material odds. Materials become the supply for building/tool upgrade gates already reserved in the GDD economy. Daily cadence must be bonus-framed: no streaks, no loss for missed days. Earliest sensible slot: Phase 6+ (wants buildings, storage caps, and the offline-production framework to exist first).
- **Player character** (owner, 2026-07-15): an NPC avatar that walks the farm, never entering/overlapping structures or decor - needs walk-cycle animation + light pathing, so it waits on the same sprite-animation pipeline as Phase 4A's future polish. Way-future sub-item: clothing/accessory customization, preceded by a research task on AI-generating customizable animated sprites. CHARACTER SPEC LOCKED (owner, 2026-07-15): young adult male farmhand, magical straw farming hat (suggested realization: soft moonlight glow at the brim, tying to the mere/moondust fiction), blue-jean overalls over a white long-sleeve shirt, brown farming boots. Owner is experimenting with Scenario (scenario.com) for the base front-facing sprite; pipeline convention: flat-grey background generations, seed/model/prompt metadata saved, output staged in tools/art-staging, base sprite feeds a future custom character model (Scenario's 5-15-reference training) for animation frames.
- **Full-farm rearrangement** (owner direction, 2026-07-15, from the restoration boundary review): eventually EVERYTHING on the farm should be movable, structures included. Its own design conversation after the T3.3+T3.4 land/camera package ships - interacts with arrange mode (T3.9a), region geometry (T3.3), and camera bounds (T3.4). Restoration v1 stays fixed-landmark and must build nothing that blocks this (in-place art swaps carry over to movable structures unchanged).
- **Major Shipments** - see T4.4 note. Known code dependency (found in T2.11): gameState.ts's isOrder save-validator hard-caps order items at <= 2 - must be raised when orders ever carry 3+ item types. The order-card UI already renders up to 3 (CLUSTER_TIERS).

## Sequencing Notes

- Phases 3 and 4 can partially interleave; workers (5) hard-depend on buildings (4.1) and storage (3.2).
- Every phase ends with a "play it" gate. The roadmap is allowed to change after each gate - it's a plan, not a contract.
- Balancing spreadsheet: BUILT - docs/balance-v2.xlsx (v1 blessed 2026-07-10, v2 blessed 2026-07-12; superseded versions live in docs/archive/); remains the single source of truth exported into `src/data/`. (Originally planned "alongside Phase 3"; moved to NOW by the 2026-07-10 re-cut.)
