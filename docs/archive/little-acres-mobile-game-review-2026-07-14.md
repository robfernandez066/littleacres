# Little Acres Mobile Game Review

**Review date:** July 14, 2026  
**Overall verdict:** Strong, polished vertical slice with a good farming-game foundation. It is not yet a full mobile farming game because progression adds rewards without substantially changing how the player thinks, plays, or sees the world evolve.

## Review basis

This review included:

- The implementation, gameplay data, tests, PWA configuration, assets, and authorized design documentation.
- A clean-save playthrough of the complete tutorial before using developer controls.
- Early game, expansion, inventory, quests, premium orders, currencies, decoration purchase and arrangement, and the level-8 cap.
- Live-build tests at 390x844 and 360x740.
- A browser-console check after the playtest, with no warnings or errors recorded.
- Separate consideration of the live schema-13 build and the newer, actively changing working tree.

The balance workbook could not be opened by the available workbook reader. All exported balance values in src/data/ were inspected directly instead.

## Executive diagnosis

Little Acres already has a good first-session promise:

- Planting and sweep harvesting are direct and satisfying.
- The tutorial is structured, understandable, and brief.
- Art direction is cohesive and immediately readable.
- Offline growth, no energy, no withering, and forgiving order refreshes support the intended respectful tone.
- Premium orders, Radiants, Moondust, chests, quests, and decoration placement give the foundation some surprise and collection value.
- Expansion, unlock cards, currency explanations, export/import, settings, and the returning-player summary are thoughtfully presented.

The weakness is the day-three promise. At level 8, the player is still performing essentially the same loop as at level 2:

> Plant crops, wait, harvest, fill one of three orders, buy decorations.

The stated fantasy is rebuilding a magical farm and bringing its surroundings back to life. The current game improves counters, crop variety, and reward panels, but the farm itself barely changes. The intended optimization layer - storage, processors, layout decisions, workers, upgrades, research, and production routing - has not begun. This gap is visible between the design pillars in [docs/gdd.md](C:/Users/robbi/Documents/Projects/littleacres/docs/gdd.md:16) and the future systems in [docs/roadmap.md](C:/Users/robbi/Documents/Projects/littleacres/docs/roadmap.md:86).

## Current content envelope

| Area | Current scope |
|---|---|
| Progression | 8 levels, cap at 5,500 XP |
| Crops | 7 crops, from 30-second Sunwheat to 120-minute Sagesprig |
| Land | 12 plots, one 500-coin expansion to 16 |
| Orders | 3 slots, 10% premium chance |
| Quests | 7 lifetime quests, 4 weekly templates, 2 active each week |
| Collection | 10 purchasable decorations and 5 quest trophies |
| Special rewards | Radiants, Moondust, premium orders, chests from level 6 |
| Customization | Shop, Shed, placement, movement, scaling, and mirroring in current source |
| Persistence | Local storage, autosave, export/import, and migrations |
| Returning play | Offline-ready summary on load |

This is enough for a credible public prototype. It is not enough for sustained midgame retention.

## Findings that must be addressed

### P0 - A legitimate trophy claim can erase the farm on the next launch

This is the most serious issue found.

The game permits at most 30 placed plus warehoused decorations during validation. Purchases honor that cap, but trophy quest rewards intentionally bypass it. If a player owns 30 decorations and claims a trophy:

1. The state becomes 31 owned decorations.
2. That state is saved.
3. The next load rejects it as invalid.
4. The game automatically resets to a fresh farm.

Evidence:

- The cap is enforced during validation at [gameState.ts:769](C:/Users/robbi/Documents/Projects/littleacres/src/systems/gameState.ts:769).
- Trophy rewards bypass the cap at [gameState.ts:1320](C:/Users/robbi/Documents/Projects/littleacres/src/systems/gameState.ts:1320).
- Invalid saves are reset at [gameState.ts:1758](C:/Users/robbi/Documents/Projects/littleacres/src/systems/gameState.ts:1758).
- The existing test verifies the bypass but does not reload the resulting save at [gameState.test.ts:3477](C:/Users/robbi/Documents/Projects/littleacres/src/systems/gameState.test.ts:3477).

Recommended resolution:

- Exclude trophies from the purchasable-decoration cap, or reserve dedicated trophy capacity.
- Make reward, purchase, and validation logic share one definition of a valid state.
- Add a reload regression test.
- Never overwrite the sole invalid save. Preserve a recovery copy and offer restoration.

### P1 - Trophy rewards currently cannot be placed

Quest trophies are awarded into the warehouse, but the Shed builds its player-facing rows only from the ten purchasable decoration definitions. The five trophies therefore become invisible inventory entries with no placement path. See [FarmScene.ts:1958](C:/Users/robbi/Documents/Projects/littleacres/src/scenes/FarmScene.ts:1958).

This breaks the most prestigious long-term rewards. Add a Trophy or Achievements section to the Shed and a visible trophy-display area on the farm.

### P1 - Weekly Specialist can be impossible or instantly complete

The featured crop is drawn from all seven crops without considering the player's level. A new player can receive a full-week objective for a locked crop.

The Specialist target table also omits Dewmelon and Sagesprig. Missing targets fall back to zero, so those weeks complete immediately at 0/0.

Evidence:

- Featured-crop selection: [gameState.ts:452](C:/Users/robbi/Documents/Projects/littleacres/src/systems/gameState.ts:452)
- Incomplete target table: [quests.ts:151](C:/Users/robbi/Documents/Projects/littleacres/src/data/quests.ts:151)
- Zero fallback: [gameState.ts:1272](C:/Users/robbi/Documents/Projects/littleacres/src/systems/gameState.ts:1272)

Select only unlocked crops and require an exhaustive positive target for every eligible crop.

### P1 - Weekly rollover can become stale and can delete earned rewards

Weekly rollover is checked during load, but not by the live FarmScene refresh loop. A long-running or background-resumed PWA can remain on the expired week at "0d 0h" until reloaded. Compare [gameState.ts:1222](C:/Users/robbi/Documents/Projects/littleacres/src/systems/gameState.ts:1222) with the live refresh at [FarmScene.ts:679](C:/Users/robbi/Documents/Projects/littleacres/src/scenes/FarmScene.ts:679).

Rollover also clears counters and claims without banking completed but unclaimed rewards. This contradicts the game's no-punishment philosophy.

Recommended resolution:

- Check rollover on foreground/resume and periodically during play.
- Auto-claim completed rewards or place them in a reward inbox.
- Announce the new weekly rotation clearly.

### P1 - Save durability remains too fragile for a long-term mobile game

The primary save is still one local-storage value. Save failure is only logged to the console, and invalid state can be replaced without recovery. Export/import is a good interim feature, but most players will not proactively export.

Before asking players to invest weeks:

- Keep last-known-good and previous-session backups.
- Use IndexedDB as primary local persistence.
- Surface save success/failure in the UI.
- Add cloud backup before store release.
- Provide manual conflict recovery rather than silently choosing a destructive outcome.

Relevant behavior is visible at [gameState.ts:1748](C:/Users/robbi/Documents/Projects/littleacres/src/systems/gameState.ts:1748) and [gameState.ts:1796](C:/Users/robbi/Documents/Projects/littleacres/src/systems/gameState.ts:1796).

## Mobile and usability findings

### The fixed canvas visibly wastes phone screens

The game renders a fixed 1080x1920 canvas using FIT over a black page. See [main.ts:46](C:/Users/robbi/Documents/Projects/littleacres/src/main.ts:46) and [index.html:11](C:/Users/robbi/Documents/Projects/littleacres/index.html:11).

Observed results:

- At 390x844, the farm occupied about 390x693 with roughly 75-pixel black bars above and below.
- At 360x740, it occupied 360x640 with roughly 50-pixel bars.

The farm itself remained attractive and centered, but it felt like a letterboxed web game rather than a native mobile presentation.

Use a full-screen background or ground overscan layer while keeping critical gameplay and UI inside a protected 9:16 safe zone. Respect device safe-area insets.

### The seven-crop seed bar is too small

At level 8, all seven cards are squeezed into one row. Crop names, costs, locked-state information, and the small information buttons become difficult to read or reliably tap. The viewport also disables user zoom.

Recommended redesign:

- Show four or five full-size cards with horizontal scrolling.
- Keep the selected card centered.
- Preserve the next locked crop as a teaser.
- Guarantee 44-48 CSS-pixel targets after scaling.
- Keep body text near 14-16 CSS pixels.

The current automatic shrinking behavior is in [SeedBar.ts:215](C:/Users/robbi/Documents/Projects/littleacres/src/ui/SeedBar.ts:215).

### Accessibility needs to move forward in the roadmap

The settings panel provides music, sound, vibration, export/import, and credits, but lacks:

- Reduced motion
- Text scaling
- High-contrast or color-safe ready states
- Screen-reader semantics
- Keyboard or switch-navigation support
- A way to restore pinch zoom

The current game is canvas-only, while accessibility is postponed until Phase 7. It should receive a basic pass before wider external testing.

### Initial loading is heavier than necessary

The preload scene blocks farm entry while loading all effects, ambient audio, and all three music tracks. The 14 audio files total approximately 16.8 MB before the atlas and JavaScript. See [PreloadScene.ts:97](C:/Users/robbi/Documents/Projects/littleacres/src/scenes/PreloadScene.ts:97).

Load the atlas and first-session sounds first, start the farm, then stream music and secondary effects in the background.

### Decoration placement needs a smarter initial position

A fence placed from the warehouse appeared directly over the crop field before being moved. That matches the hardcoded central spawn position at [decor.ts:80](C:/Users/robbi/Documents/Projects/littleacres/src/data/decor.ts:80).

Place new items on the nearest valid open lawn position, or begin with a draggable ghost requiring confirmation. Prevent or clearly warn about plot and structure overlap.

### Resume behavior is incomplete

The offline summary works after a full reload and made a good returning-player first impression. A still-alive PWA resumed from the background does not recompute or show it. Add an app-foreground check so mobile multitasking behaves like a real return.

## Progression and economy diagnosis

### A focused player can exhaust progression quickly

With 16 plots, Starcorn yields:

- 16 x 9 XP every 2 minutes
- 72 XP per minute before order bonuses

The 5,500-XP cap therefore represents roughly 76 minutes of ideal Starcorn cycling. Unlock ramp, coin needs, and normal play extend that, but a focused player can plausibly reach the current cap in approximately one to two hours.

At max level:

- The HUD says "MAX."
- XP continues accumulating internally.
- Orders still prominently advertise XP rewards.

That makes a large portion of every later order feel dead. Convert post-cap XP into crop mastery, restoration progress, research, or a capped overflow currency.

### The economy loses meaningful sinks at the same time it opens up

The full unique coin-decoration catalog costs 5,700 coins. All unique Moondust decorations total only 18 Moondust.

Once a player can fund a complete Sagesprig field:

- Seed cost: 9,600 coins
- Sale value: 19,200 coins
- Net profit: 9,600 coins

One field therefore produces more profit than the entire unique coin-decoration catalog costs. The only other permanent coin sink is the 500-coin plot expansion.

Do not add another direct coin or Moondust source until storage, land, buildings, recipe slots, upgrades, and rotating stock create durable spending decisions.

### Weekly objectives are not calibrated as weekly play

At 16 plots:

- One Dewmelon field represents 720 grow-minutes.
- One Sagesprig field represents 1,920 grow-minutes.
- Either immediately clears the 400-minute Growing Strong objective.
- Sunwheat clears it in about 25 minutes of continuous full-field cycling.
- Specialist objectives take approximately 2-20 minutes across the five crops currently configured.

These are starter achievements, not week-shaped goals. Calibrate weekly targets around roughly 6-10 ordinary check-ins for each player tier.

Weekly Radiance has the opposite problem: at a 2% Radiant chance, two procs require an expected 100 individual harvests but can vary wildly. Add a pity counter or deterministic radiant-energy meter.

### Two-chest orders are unintentionally biased toward Sunwheat

Two chests require 12 requested units. Every crop except Sunwheat has a low per-order cap, and no non-Sunwheat combination can reach 12. See [orders.ts:61](C:/Users/robbi/Documents/Projects/littleacres/src/data/orders.ts:61) and [chests.ts:8](C:/Users/robbi/Documents/Projects/littleacres/src/data/chests.ts:8).

Use normalized order effort or total order value for chest tiering rather than raw requested units.

### Level 6 does not announce its real unlock

Chest-bearing premium orders begin at level 6, but level-up cards primarily explain new crops. Level 6 therefore feels like an empty level despite unlocking a new reward system.

Level-up events should list:

- Newly unlocked crops
- New systems
- Moondust or other level rewards
- New order or chest behavior

## Story and identity

The order board is mechanically clear but nearly characterless.

Six premium-order flavor lines already exist in [orders.ts:51](C:/Users/robbi/Documents/Projects/littleacres/src/data/orders.ts:51), but the UI intentionally replaces them with the generic label "Premium Order" at [OrderBoard.ts:193](C:/Users/robbi/Documents/Projects/littleacres/src/ui/OrderBoard.ts:193).

Introduce a small recurring cast:

- Mayor
- Baker
- Healer
- Traveling merchant
- Festival organizer
- Night-market keeper

Each needs only a portrait, name, one-line request, and short delivery reaction. Repeated residents provide continuity and attachment without requiring dialogue trees, romance, or a large narrative system.

The same principle applies to the world. The farmhouse, path, field, and notice board are attractive, but level 8 does not look meaningfully more restored than level 2. The glowing mere and visibly reviving surroundings should become the emotional progression track promised by the design.

## Recommended development sequence

### 1. Integrity and mobile foundation

Complete before adding major content:

- Repair the trophy save-reset path.
- Make trophies visible and placeable.
- Fix weekly eligibility, targets, rollover, and reward banking.
- Add save backups and recovery.
- Fix narrow-phone readability and letterboxing.
- Stage-load audio.
- Add CI test and lint gates. The current Pages workflow only installs and builds at [deploy.yml:30](C:/Users/robbi/Documents/Projects/littleacres/.github/workflows/deploy.yml:30).

### 2. Restoration Chapter 1

Make progression visibly change the world:

- Add an integrated mere or restoration region with 3-4 visual states.
- Introduce a Restoration Ledger with clear chapter goals.
- Let the player choose which landmark to restore first, such as Mill or Bakery.
- Add permanent visual responses: brighter water, repaired path, lanterns, wildlife, village visitors, and seasonal vegetation.

This should be the next major player-facing hook.

### 3. Optimization foundation

Add decisions rather than another reward panel:

- Crop mastery per crop
- Farm Almanac and discovery collection
- Storage upgrades with pressure-free overflow
- Multiple land regions
- Five-order board with pin and refresh controls
- Crop or building adjacency only when the player has enough land to make layout meaningful

A roadside stall that sells overflow at normal base value would preserve the no-loss philosophy better than automatically selling it at a penalty.

### 4. One complete production chain

Build a full vertical slice before adding many processors:

- Mill: Sunwheat to flour
- Bakery: flour to bread
- One second recipe using flour plus another crop
- Processor queues and upgrades
- Recipe discovery pages
- Raw and processed orders
- One Major Shipment requiring several categories

This changes the player's decisions from "which crop pays best?" to "what should I grow, process, reserve, and deliver?"

### 5. Cozy life and automation

After production has a purpose:

- Two animal types with long, offline-friendly timers
- Animal products feeding recipes and orders
- A harvest helper
- A replant helper
- A courier with a player-controlled order whitelist
- Worker upgrades tied to restoration rather than another generic level bar

This fulfills the promised "hands-on early, automated later" arc.

### 6. Long-tail content

Once the foundation has depth:

- Mystery merchant with rotating stock
- Positive weather bonuses only
- Seasonal crops and festivals
- Themed decoration collections
- Ambient collection rewards such as butterflies, fireflies, music variations, or visiting animals
- Research branches that modify already-existing production and workers

## Return hooks by cadence

| Cadence | Recommended hook | Player value |
|---|---|---|
| Next few minutes | Pinned order, next-completion display, quick replant plan | Gives the current session a clear intention |
| Next return | Rested-magic bonus on the first few harvests after absence | Rewards leaving without punishing missed play |
| Daily | Three flexible goals with carryover, rotating resident, merchant stock | A fresh reason to visit without streak anxiety |
| Weekly | Tier-scaled contracts, banked rewards, village restoration contribution | Creates a medium-term target |
| Long term | Restoration chapters, mastery pages, recipes, workers, trophy display | Builds ownership and visible history |
| Seasonal | Festival construction, themed crops and decor, positive weather | Refreshes content without invalidating old progress |

Avoid punitive streak resets. If a streak-like structure is used, make missed days preserve progress or convert into rested bonuses.

## Features not to prioritize yet

### Do not lead with a self-contained Mine that pays coins, Moondust, and chests

That would:

- Duplicate existing reward sources
- Accelerate an already shallow economy
- Pull attention away from the farm
- Arrive before its building-material outputs have a purpose

When introduced, the Mine should primarily supply materials for building, tool, and land upgrades after storage and production exist.

### Do not solve depth by adding more crops alone

Seven crops already cover active and offline timer bands. Additional crops should arrive with recipes, mastery, seasonal availability, or regional identity.

### Do not add another generic player-level bar

Use restoration chapters, crop mastery, recipes, worker development, and research. Each communicates what the player is progressing toward more clearly than another XP counter.

## Recommended validation before the next major phase

Run at least five fresh-player sessions across:

1. Clean first session
2. First voluntary return
3. Level 3 expansion and quests
4. Level 6 chest unlock
5. Level 8 cap and post-cap loop

Track:

- Tutorial completion
- First order completion
- First expansion timing
- Day-1 and day-3 voluntary return
- Time to level cap
- Weekly quest completion and claim rate
- Feature usage for inventory, quests, decor, and premium orders
- Save failures and recovery actions

Add regression coverage for:

- Trophy claim at the 30-decoration cap followed by reload
- Every possible Specialist crop at every level
- Weekly rollover during an open session
- Completed unclaimed weekly rewards at rollover
- Quest-awarded chests and Treasure Hunter progress
- Background resume and offline summary
- Visual snapshots at 390x844 and 360x740

## Final recommendation

The best next version is not "Little Acres with more rewards." It is:

> Little Acres where the farm visibly changes, harvested goods feed real production choices, and the player begins building a machine they can personalize and optimize.

The three highest-value investments are:

1. Fix save, trophy, and weekly-quest integrity.
2. Make the mobile presentation responsive and persistence trustworthy.
3. Ship one visible restoration chapter tied to a complete Mill-to-Bakery production chain.

That sequence protects existing players, fulfills the game's signature fantasy, and creates a genuine reason to return.
