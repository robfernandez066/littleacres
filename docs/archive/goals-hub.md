# Goals Hub - Design

Status: SHIPPED (2026-07-20, commit fb7788b, T3.30 + r1 + r2, schema v21). Archived 2026-07-22; the code is the authority, this is the design record.

## Summary

A new HUD menu, "Goals", alongside Quests and Bag: one home for long-horizon,
save-toward objectives. Surfaces the two that already exist as working mechanics
- farmhouse restoration and land-region unlock - as a discoverability /
tracking layer. It adds NO purchase mechanics; it launches the flows that
already ship.

## Why

Restoration (`RestorePanel` + `gameState.restoreFarmhouse`) and region unlock
(`RegionSign` + `gameState.purchaseRegion`) both worked but were hard to find:
restoration was buried in the Decor Shop header, region unlock only showed as an
on-field sign. Players missed them (this feature exists because the owner could
not find restoration in-game). A permanent, visible "Goals" menu fixes
discoverability structurally and gives the whole save-toward category a home as
it grows.

## Distinction from Quests

Quests are active, rotating, rewarded, some weekly (short/medium term). Goals
are a short list of permanent aspirations you save toward - no timer, no reset,
no expiry.

## Name + voice

Menu name: "Goals". Panel subtitle: "Everything you're growing toward." House
style: no em dashes in user-facing text.

## Icon

Star hero (large gold star, slim crescent behind) - owner-drawn,
`tools/art-staging/goals.png`, packed as the `goals` atlas frame (ICON_NAMES,
trim-fit 96x96). Kept distinct from the moondust chip by leaning on one defined
star.

## Entries (data-driven)

The list is assembled in `data/goals.ts` from the owning sources
(`data/restoration.ts`, `data/farm.ts` REGIONS) - single source of truth, no
duplicated prices/gates - and ordered so future entries slot in (restoration
first, then one per region in REGIONS order).

1. **Restore the Homestead** - opens the existing `RestorePanel`. Perk:
   Homestead luck (Radiant +25%). Price 50,000 coins + 20 moondust.
2. **Unlock East Meadow** (`REGIONS['east_meadow']`) - +6 plots, 7,500 coins,
   opens at Level 7. Below the gate: locked. At/above and unowned: actionable.

Row states (`goalStatus`): `open` (actionable), `locked` (gate not met),
`owned` (done). Completed rows sink to the bottom of the list, collapse, fade,
and take a green wash; locked rows stay full strength with a soft-red "Locked:"
tag. Progress reads two lines, one currency each ("n / 50,000 coins" newline
"m / 20 moondust"), no "Saved"/"and".

## Call-to-action (r1)

An actionable row carries one explicit button, its per-kind label from
`goalActionLabel`: **"Go There"** on a region (closes the panel and glides the
camera to the on-field sign, which still owns the purchase) and **"Restore"** on
the homestead (opens the RestorePanel on top, Goals staying behind). The card
body is inert - the button is the only tap target. Locked and completed rows
have no button.

## Level-gate unlock card (r1)

When the player levels into a region's `levelGate`, the level-up celebration
shows an extra card beside the crop unlock: the goals-star icon and
`${region.name} is ready to unlock!`, derived from REGIONS
(`regionUnlockCardsForLevel`) so a future region announces itself with no new
code.

## Visibility + the one-time nudge

The Goals icon appears once onboarding completes, like the other HUD buttons. A
"!" badge (mirroring the quest badge) plus a gentle first-appearance pulse show
until the player first opens the panel; opening it calls `markGoalsSeen`
(schema v21 `goalsSeen`), clearing both permanently. Existing saves migrate to
`goalsSeen: false` so veterans get the discovery nudge too. v1 simplification:
`goalsSeen` is a one-time "discovered the menu" flag; it does NOT re-badge when a
future new goal appears.

## Existing entries kept

The Decor Shop "Restore the Homestead" header button and the on-field
`RegionSign` both stay. Goals adds parallel, discoverable entries; it removes
neither.

## Legacy Expand sign

Left as-is. The one-time Expand sign (500 coins, 12 -> 16 plots) and East Meadow
(7,500, 16 -> 22, Lv7) are a price/level progression, not duplicates. Kept OUT
of the Goals hub (an early cheap buy, not a long-horizon goal). Revisit "two
expansion UIs" only as separate polish if it bothers the owner.

## Known nits (deferred)

A couple of comments in GoalsPanel.ts still say "past-tense title" (leftover
from a reverted idea; the completed card keeps the plain title, restyled). Fix
when a task next touches the file.

## Future (not v1)

Per-goal "new" badging; more restorations; regions beyond East Meadow; whether
the on-field signs eventually defer to the hub.
