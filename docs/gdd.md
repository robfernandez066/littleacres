# Little Acres - Game Design Document v0.1

**Genre:** Cozy hybrid farming / passive-optimization idle game
**Platform:** Mobile (portrait), web-first PWA, wrapped with Capacitor for iOS/Android later
**Tech:** Phaser 3 + TypeScript
**Monetization:** None at launch. Designed to be fun with zero spending. Rewarded ads or optional purchases may be layered on later without changing core design.

---

## 1. Vision Statement

You've inherited a faded magical farm at the edge of an enchanted village. The glowing mere beside it has gone dim. By growing magical crops, filling villagers' orders, and slowly rebuilding the farm, you bring the light back.

Little Acres is cozy on the surface and an optimization game underneath (target: 6/10 on the cozy-to-spreadsheet scale). There is no punishment, no withering, no hard energy, no fail states. All depth comes from *positive* optimization: better layouts, better crop choices, better worker assignments, better order routing. Every interaction is snappy, juicy, and satisfying.

### Design Pillars

1. **Everything feels good.** Every tap pops. Numbers float. Coins arc into the counter. The harvest sound is the most polished asset in the game.
2. **Pressure-free depth.** The player is never punished, only rewarded more for playing smarter. Passive optimization dopamine, not skill-based or twitch dopamine.
3. **Hands-on early, automated later.** The early game is tactile (plant, harvest, deliver). The late game is a machine you tune (workers, processors, layouts, research).
4. **Respect the player.** No hard energy, no withering, no predatory timers, no nag notifications. Offline progress works. Waiting is never painful in the early game.
5. **The farm visibly comes back to life.** Progression is not just numbers - the world gets brighter, greener, and more alive as you level.

---

## 2. Core Game Loop

### Moment-to-moment (a 1-3 minute check-in)

1. Open app -> offline earnings summary (satisfying "welcome back" moment)
2. Sweep-harvest ready crops (drag finger across field, crops pop in a chain)
3. Collect from buildings/processors
4. Fulfill 1-3 orders on the order board -> coins + XP + occasional chest
5. Replant (paint mode or one-tap "replant same")
6. Optionally: spend coins on an upgrade, start a longer-timer crop/machine
7. Leave. Farm keeps working.

### Session-to-session (the optimization layer, for players who stay)

- Rearrange layout for adjacency bonuses (later phases)
- Assign/upgrade magical workers
- Choose which production chains to run
- Decide which orders to chase vs. skip
- Spend research points, plan next land expansion

### Long-term arc

Restore the farm -> unlock new crops, buildings, machines, workers, land -> village and mere visibly revive -> deeper production chains and research tree.

---

## 3. Player Verbs (what feels good to do)

**Core verbs (must feel amazing):**
- Tap crops to harvest; drag/sweep to harvest many at once
- Hold or paint-drag to plant multiple plots
- Tap buildings to collect goods
- Fulfill customer orders
- Open crates/rewards
- Upgrade plots/buildings
- Assign workers to tasks (later)
- Optimize farm layout (later)
- Complete quests/bounties

**Explicitly avoided (annoying):**
- Dragging goods between buildings
- Merge mechanics
- Any skill/timing-based combo requirement

### Dopamine priority ranking (drives animation/sound/VFX budget, in order)

1. **Harvesting a full field** - the flagship interaction. Chain-pop VFX, escalating pitch on rapid harvests, floating numbers, coins arcing to the HUD.
2. **Completing a big order** - stamp/whoosh animation, villager thanks, reward burst, fanfare.
3. **Opening reward chests** - buildup, burst, item reveal cards.
4. **Leveling up** - full-screen (but fast) celebration, unlock reveal.
5. **Expanding the farm** - fog/overgrowth clears, new land revealed with a bloom of light.

---

## 4. Core Mechanics

### 4.1 Farm layout

- Fixed isometric grid for crops (hybrid model: decorations/buildings placeable in later phases).
- MVP: single non-scrolling screen, 12 plots. Camera scrolling arrives with land expansion.
- Isometric 2D art, portrait orientation, one-hand play.

### 4.2 Planting

- **Paint mode (MVP):** select a seed, drag across empty plots to plant.
- **Smart replant (post-MVP):** after harvest, one-tap "replant same crop."
- No withering, ever. Crops wait patiently once grown.

### 4.3 Timers

- Mixed timers: basic crops fast (seconds to a few minutes), advanced crops/machines/animals longer (minutes to hours).
- Early game has no painful waits - first crops are near-instant gratification.
- Boosts (from rewards, later from research/workers) can speed things up.

### 4.4 Orders

- Order board with 3 active order slots (MVP as shipped; grows to 5 with rarity tiers in Phase 3 T3.6 - reconciled 2026-07-10 per design review, implementation is the decision of record).
- No deadlines early. Timed premium orders introduced later for bonus rewards - always opt-in bonus, never a loss if missed.
- Orders grant coins + XP; bigger orders can grant chests or Moondust.
- Order generation requests only crops the player can actually grow. (Stretch/teaser orders were tried and removed 2026-07-10 - an unfulfillable order reads as a bug, not anticipation. Anticipation lives in the seed bar's visible locked crops instead.)

### 4.5 Randomness (level B: some excitement, mostly predictable)

- Rare crop variants (e.g., a Radiant Glowberry worth 5x)
- Occasional bonus seed drops on harvest
- Random customer orders with better-than-usual rewards
- Mystery merchant (later)
- Weather as pleasant surprise buffs only (later, never punitive)

### 4.6 Offline progress

- Crops keep growing offline (A)
- Machines/workers keep producing offline (B)
- Offline output limited by storage caps once storage exists (C) - creating natural upgrade pressure
- On return: "While you were away" summary screen with a satisfying collect-all button

### 4.7 Energy

- **None.** No hard or soft energy. Pacing comes from timers, storage limits, order refresh, and upgrade costs.

---

## 5. Progression Systems

All of these layers are planned; they roll out across phases (see roadmap):

| Layer | What it does | Phase |
|---|---|---|
| Farm level | Master unlock track: crops, buildings, features, land | MVP |
| Crop unlocks | New seeds gated by farm level | MVP |
| Building upgrades | Plots, storage, processors get better | MVP (plots) -> later |
| Land expansion | New grid regions, clears overgrowth, brightens the mere | Post-MVP |
| Crop mastery | Passive XP per harvest -> permanent per-crop yield/speed/sell bonuses | Post-MVP |
| Player level | Account-wide perks distinct from farm level | Later |
| Worker upgrades | Magical helpers level up, gain speed/capacity | Later |
| Tool upgrades | Better watering, wider harvest sweep, etc. | Later |
| Recipe unlocks | Production chain recipes (flour -> bread, etc.) | Later |
| Research tree | Long-term point-spend meta layer | Later |
| Quality tiers | Silver/gold crops for premium orders | Much later |

### Crop mastery (chosen mechanic: A now, B way later)

- Every harvest of a crop grants that crop mastery XP.
- Mastery levels grant permanent small bonuses (yield %, growth speed %, sell value %).
- Quality tiers (normal/silver/gold) are a far-future layer tied to premium orders.

---

## 6. Economy

### Resources (complex economy, phased in)

- **Coins** - primary soft currency (crops, orders)
- **Moondust** - rare earned-only currency (level-ups, rare harvests, big orders, chests). Slot reserved from day one; never purchasable at launch. Spent on: special boosts, rare seeds, cosmetic decorations, mystery merchant stock. (Shipped sources today: Radiant harvests, premium orders, chests. Shipped sink: decorations. Tap the HUD counter for the in-game explanation - T3.13.)
- **Seeds** - purchased with coins or found
- **Crops** - raw harvest goods
- **Processed goods** - outputs of machines (later)
- **Animal goods** - (later, post-animals)
- **Fertilizer, Water** - consumable boosts (later; water is a boost, not a chore)
- **Tools, Building materials** - upgrade gates (later)
- **Research points** - meta progression (later)

### Coin sinks (in-game spending priority)

More plots -> machines -> storage -> land expansion -> decorations.
(Decorations arrived early - T3.9, 2026-07-12 - as the game's first Moondust sink alongside coins.)

### Balancing principles

- First 30 minutes: player should never wait more than ~60 seconds with nothing to do.
- Every unlock should be visible slightly before it's affordable (anticipation).
- Storage caps (when introduced) should pinch gently ~1-2 sessions before an affordable upgrade.

---

## 7. Theme, Art, and World

### Setting

Whimsical magic farm (A) with light witchy-cottage notes (B): glowberries, mushroom-capped sheds, friendly wisps, herb bundles, moonflowers on the fence line. The enchanted village sits at the screen's edge; the dim **glowing mere** frames the farm and brightens with farm level - the world's ambient light literally tracks your progress. (Two placement attempts parked 2026-07-10 - a pasted-on pond didn't read as landscape; returns with the T3.3 integrated region-art pass. See decisions.)

### Story wrapper (deliberately light)

You inherited the farm from a relative the villagers remember fondly. The village's magic has faded with the mere. Villagers place orders; filling them restores the farm and, region by region, the light. No cutscenes, no dialogue trees - flavor text on orders and unlocks carries it.

### Art direction

- **Style:** Isometric 2D, soft shapes, saturated-but-gentle palette, chunky readable silhouettes sized for a phone screen.
- **Readability rule:** at a glance, the player must distinguish empty plot / growing / ready. "Ready" states glow or bounce subtly.
- **Production plan:** start with a purchased isometric farm asset pack (even if not fantasy-themed) to keep development unblocked -> transition to AI-generated art cleaned up for consistency; if AI art doesn't pan out, commission an artist once the game is proven fun.
- **Workers (later):** magical helpers with job-linked identities - water sprite (waters), harvest golem (harvests), broom courier (delivers), mushroom folk (processing).

### UI/UX

- Portrait, one-hand reachable: primary actions in the bottom third.
- Main screen shows: farm, coin/Moondust/XP HUD (top), order board button, shop button, level progress. (As shipped, orders and the decor shop are on-farm structures - notice board T2.22, farmhouse T3.9 - not HUD buttons; the scroll HUD button is the quest board, T3.10.)
- Contextual hint system: pulsing highlight on the next relevant tappable thing when the player seems stuck; no forced tutorial overlays.
- Onboarding is quest-driven: the first orders teach the loop ("Plant 3 Sunwheat," "Deliver 5 Carrots").

---

## 8. Sound Direction

- **Music:** lo-fi cozy loops; warm, unobtrusive, loopable without fatigue. Track variation by area/level tier later.
- **The Big Four SFX (in polish priority order):**
  1. Harvest pop - THE sound of the game; slight pitch-up on rapid chains
  2. Coin collect / coin arc landing
  3. Order-complete fanfare (short, proud, not obnoxious)
  4. Level-up chime
- Additional: plant "plip," chest open buildup + burst, UI taps, ambient loop (birds, wind chimes, faint water from the mere).
- All audio ducking-aware and instantly responsive - sound latency kills game feel on mobile.

---

## 9. Game Feel / "Juice" Specification

This is a first-class feature, not polish. Every core interaction ships with:

- **Squash & stretch** on tap targets
- **Floating numbers** (+coins, +XP) with slight randomized arcs
- **Particles:** leaves/sparkles on harvest, dust on plant, glow burst on rare drops
- **Chain feedback:** sweep-harvesting builds a visible/audible cascade (visual escalation only - no skill requirement, no combo meter to maintain)
- **Coin arc:** collected coins physically fly to the HUD counter, which ticks up
- **Haptics** (mobile): light tap on harvest, medium on order complete, success pattern on level-up
- **Anticipation:** ready crops idle-bounce; chests wiggle before opening
- 60fps target; object pooling for particles/labels from day one

---

## 10. MVP Definition (Phase 1 target)

One portrait farm screen, 12 plots, fixed camera. Three crops:

| Crop | Unlock | Grow time | Vibe |
|---|---|---|---|
| Sunwheat | Start | ~30s | familiar-but-magic staple |
| Starcorn | Farm level 2 | ~2m | golden corn with star-glint kernels, higher value (replaced Carrot 2026-07-09 - too mundane next to the fantasy crops) |
| Glowberry | Farm level 3 | ~5m | signature fantasy crop, glows when ready |

Included: paint-planting, sweep-harvesting, coins, crop inventory, seed shop, order board (3 slots), farm XP/levels 1-5, plot count upgrade (12 -> 16), floating numbers/particles/sound hooks, local save, basic offline crop growth.

**Save durability note (2026-07-10):** until cloud save (Phase 7), saves live in localStorage only, which browsers - especially iOS PWA - can evict under storage pressure. Near-term mitigations (navigator.storage.persist(), player-facing export/import in Settings) are scheduled as T2.16; treat localStorage as leaky, not permanent.

**Explicitly NOT in MVP:** animals, fishing, combat, seasons, multiplayer, relationships, town map, complex crafting, hundreds of crops, real-money store, daily events, worker AI, procedural maps, storage caps, weather, day/night, cloud saves, notifications.

---

## 11. Feature Rollout Overview (details in roadmap doc)

- **Phase 0:** Project skeleton, tooling, asset pipeline
- **Phase 1:** MVP core loop (above)
- **Phase 2:** Juice pass + smart replant + offline summary + Moondust slot
- **Phase 3:** More crops, storage caps, land expansion + camera scroll, crop mastery; wave 2 (2026-07-12) added decorations + quests/bounties here (T3.9/T3.10)
- **Phase 4:** Buildings & first production chains, chests/reward polish
- **Phase 5:** Magical workers (automation begins), tool upgrades
- **Phase 6:** Research tree, premium timed orders, mystery merchant, weather ambiance
- **Phase 7:** Day/night ambiance, decoration polish, notifications (opt-in), cloud save
- **Phase 8:** Capacitor wrap, store readiness, (optional) monetization decision point

---

## 11a. Parked future concepts

- **Mine scene** (2026-07-10): daily rapid-mine mini-game (unfailable, juice-driven, participation-rewarded per pillar 2 and the avoided-verbs list), mine XP/levels, random material drops, AFK yields scaling with mine level + rare-material odds. Materials feed the building/tool upgrade gates in section 6. Daily cadence is bonus-only - no streaks, no FOMO. Post-Phase-6 candidate; details in roadmap "Parked concepts."

## 12. Open Questions (for future rounds)

- ~~Exact farm-level curve and coin economy numbers~~ - resolved: balance sheet, current version docs/balance-v2.xlsx (blessed 2026-07-12; v1 archived in docs/archive/), exported into src/data/
- Worker acquisition model: found? hatched? built? hired with Moondust?
- Land expansion shape: outward rings vs. distinct themed regions
- Whether player level (account-wide) is worth keeping separate from farm level, or should merge
- ~~Name lock-in~~ - resolved: **Little Acres**
