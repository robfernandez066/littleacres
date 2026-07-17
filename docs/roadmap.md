# Little Acres - Implementation Roadmap (forward-looking)

Tech stack: **Phaser 3 + TypeScript + Vite**, web-first PWA, Capacitor wrap in Phase 8.

## How to use this document

Two-agent loop, human as courier: the PM writes self-contained task prompts
(all design context baked in, no `docs/` references), the coder (Claude Code)
implements and files the report template from `CLAUDE.md` (canonical coder
guide; `AGENTS.md` is a pointer stub for non-Claude agents), the human pastes prompts and
reports between them and runs all git. The PM reviews every diff and answers
each report with exactly one verdict: COMMIT / USER TEST / CODER FIX / NEXT
TASK, then keeps `status.md` (snapshot) and `decisions.md` (log, single
source of truth). Full process detail: `private/misc/pm-process.md`.

This file is FORWARD-LOOKING ONLY: current scope, wave/hold status, and dated
pointers into `decisions.md` (or its archives). Task history lives in git and
the decision log. Tasks within a phase are ordered by dependency. After each
phase: play the game; a phase ends with a "play it" gate and the roadmap may
change at every gate - it is a plan, not a contract.

---

## Phase 0 - Skeleton - COMPLETE

Closed 2026-07-07 (T0.1-T0.5: scaffold, PWA + deploy, asset pipeline, GameState store, dev overlay). Task-by-task detail lives in git history and the decisions archive.

---

## Phase 1 - MVP Core Loop - COMPLETE

Closed 2026-07-10 (T1.1-T1.12 + play gate, closed early per decisions - "game too thin" superseded the week-long gate). Task-by-task detail lives in git history and the decisions archive.

---

## Phase 2 - Juice + Quality of Life - COMPLETE

Closed with the content-pivot re-cut delivered in full (T2.1-T2.18 + chest v1 + balance sheet) and the playtest gate, rescoped to one tester, whose positive evidence landed 2026-07-14. Detail: git history, decisions archives (2026-07-10 re-cut; 2026-07-14 gate evidence), docs/design-review-2026-07-10.md.

---

## Phase 3 - Depth Layer 1

**Goal:** the optimization game begins.

- **T3.1** Crops 4-8 - DONE across T2.18/T3.11 (Moonroot, Emberpepper, Dewmelon, Sagesprig; cap 8).
- **T3.2** Storage caps: per-category caps, storage building UI, upgrade tiers; offline production respects caps; overflow harvests auto-sell at a small discount (nothing is ever lost). **WAVE 4 HOLD** - pairs with partial-sell in one inventory-economy package (see decisions archive 2026-07-15).
- **T3.3** Land expansion: regions with coin prices + level gates, overgrowth-clearing reveal, mere glow brightens per region. **WAVE 3 LEAD**, largely shipped: placeable plots, whole-scene placement, world growth, fences + chain snap, movable structures, meadow/shadow era (T3.3a..T3.3s series; see decisions.md + archive). **Remaining: T3.3b regions (R1 East Meadow + owner checkpoint), T3.3c mere composite + Shore.**
- **T3.4** Camera: pinch zoom + pan - SHIPPED 2026-07-15 (T3.4a+b+c package under the owner guardrails; see decisions archive 2026-07-15).
- **T3.5** Crop mastery: per-crop XP, config-driven bonuses, mastery page. **WAVE 4 HOLD** - no demand signal yet (decisions archive 2026-07-15).
- **T3.6** Order board v2: 5 visible orders, rarity tiers, refresh token economy.
- **T3.7** Reward chests - v1 shipped early (wave 2); full chest economy remains here.
- **T3.8** Boost items: 2x growth (30 min), instant-grow single plot, etc.; inventory + activation UI.

**Wave 2 (2026-07-12) - DONE:** T3.9/a/b decorations + arrange + warehouse, T3.10 quests/bounties v1, T3.11 crops + cap 8, T3.12-T3.14 gate polish. T3.9c polish pass parked as a backlog nit (status.md).

**Wave 3 (blessed 2026-07-15; gate evidence positive):**

- Lead: **T3.3 + T3.4 as one package** - camera shipped; land in its final stretch (T3.3b, T3.3c).
- Second: **Restoration chapter v1** - scope contract at docs/design/restoration-boundary.md; prompts only after land/camera ships.
- Small rider: direct arrange-mode entry - SHIPPED (T3.25).
- Deferred to wave 4: T3.5, T3.2 + partial-sell; candidates: layout presets + arrange undo, player-placeable paths (decisions archive 2026-07-15).

---

## Phase 4 - Production Chains (T3.2 storage caps prerequisite; layered recipes per decisions archive 2026-07-12)

- **T4.1** Building placement system on grid (hybrid layout: buildings occupy tiles, movable in edit mode).
- **T4.2** First processors: Mill (Sunwheat -> Sunflour) then Bakery (flour -> bread) as one vertical chain plus one combo recipe (APPROVED sequencing, decisions archive 2026-07-14); Preserve Pot awaits the slice's verdict. Queue-based, timestamp timers, inputs auto-pull from storage. Magical-theming directive applies to all Phase 4 naming/art.
- **T4.3** Processed goods in economy: higher value, requested by orders AND quests; recipe unlock reveals; per-building recipe depth.
- **T4.4** Order board v3: mixed raw + processed orders; premium timed orders (opt-in, bonus-only; quiet expiry). 4+ item-type orders may become a "Major Shipments" system (see parked concepts).
- **T4.5** Building upgrade tiers (speed, queue slots).
- **T4.6** Mystery merchant: occasional visitor with rotating Moondust/coin offers.

---

## Phase 4A - Animal / Creature Farming (after Phase 4's processing intro)

- **T4A.1** Animal building framework: per-type buildings bought with gold; 1 open slot + purchasable locked slots (max per building = owner decision at prompt time).
- **T4A.2** Harvest loop: long timestamp timers per occupied slot; harvest collects + resets; animals persist.
- **T4A.pets** (unscheduled): buyable roaming pets + dog house / cat tree decor - waits on a real sprite-animation pipeline (decisions archive 2026-07-15).
- **T4A.3** Ambient life: static animal sprite near its building, TWEEN JUICE ONLY in v1; true sprite-sheet animation is future polish by owner decision.
- **T4A.4** v1 scope: 2+ animal types; materials enter orders/quests/recipes.

## Phase 5 - Magical Workers

- **T5.1** Worker framework: job types, assignment UI, offline-capable tick simulation.
- **T5.2** Harvest Golem: auto-harvests an assigned region on a cadence.
- **T5.3** Broom Courier: auto-fulfills whitelisted order types.
- **T5.4** Sprout Sprite: auto-replants last crop.
- **T5.5** Worker upgrades + tiny idle animations/pathing.
- **T5.6** Tool upgrades: wider harvest sweep, batch-plant size, etc.

---

## Phase 6 - Meta Systems

- **T6.1** Research tree: branching, config-driven; node-unlock ceremony.
- **T6.2** Weather ambiance v1: visual-only; later hook for surprise buffs.
- **T6.3** Player-level/account perks (or merge into farm level - decision point).
- **T6.4** Quests v2 (v1 shipped wave 2): expanded pool, seasonal specials, processed-goods quests.
- **T6.5** Economy balancing pass with telemetry hooks.

---

## Phase 7 - Comfort + Retention

- **T7.1** Day/night cycle tied to real clock; fireflies near the mere.
- **T7.2** Decorations polish (v1 shipped wave 2): edit-mode juice, sell-back/refund, expanded catalog. Reconcile with the T3.9c backlog-nit list when scheduled.
- **T7.3** Opt-in notifications (light, max 1/day, full settings control).
- **T7.4** Cloud save: anonymous account + sync; newest-wins with manual restore. (Broader save-durability watch item lands here.)
- **T7.5** Accessibility pass: color-blind-safe states, reduced-motion mode, text scaling. Must not absorb present-day usability defects (standing rule, decisions archive 2026-07-14).

---

## Phase 8 - Store Release

- **T8.1** Capacitor wrap: iOS + Android, native haptics, splash/icons.
- **T8.2** Store assets: screenshots, listing copy, privacy policy.
- **T8.3** Device QA matrix + crash reporting (Sentry).
- **T8.4** Soft-launch build + feedback loop.
- **T8.5** Monetization decision point: rewarded ads only at first, bonus-framed, never gating the base loop. Starting input: the owner's parked report in private/misc/ (unread by decision).

---

## Parked concepts (not scheduled; revisit at phase gates)

- **Mine scene**: daily unfailable rapid-mine mini-game feeding materials + mine levels; earliest Phase 6+ (wants buildings, caps, offline framework). Reward-only Mine v1 variant DROPPED (decisions archive 2026-07-14).
- **Player character**: roaming farmhand NPC; spec locked (decisions archive 2026-07-15); waits on the sprite-animation pipeline; way-future customization sub-item.
- **Full-farm rearrangement**: everything movable - own design conversation after land/camera ships (decisions archive 2026-07-15). Structures already movable since T3.3s.
- **Major Shipments**: special-building delivery for 4+ item orders; code dependency: isOrder validator caps items at <= 2 (decisions archive, T2.11 note).
- **Sweep-vs-pan at scale**: PARKED protocol at docs/design/sweep-vs-pan-checkpoint.md - the R1 checkpoint agenda item.

## Sequencing notes

- Phases 3 and 4 can partially interleave; workers (5) hard-depend on buildings (4.1) and storage (3.2).
- Balance spreadsheet: docs/balance-v2.xlsx remains the single source of truth exported into `src/data/` (superseded versions in docs/archive/).
