# Little Acres - Shop & Edit Mode UI Overhaul Spec

**Status:** ACTIVE (2026-07-22) - owner-authored spec, adopted as the scope
contract for the U-wave (U1-U4 below). SUPERSEDES T4.14 (paths
reclaim/storage bank): the Shed pipeline IS the no-resale storage system,
generalized to all items. Remove All stays out of scope alongside the
spec's own "sweep all decor" deferral.

**PM sequencing (tasks are cut from this spec; details land in each
task file when it goes ACTIVE):**

- **U1 - Shed pipeline data model** (schema v28 -> v29): derived unified
  catalog, `shedInventory`, buy/place/put-away reducers, migration.
  Model-only, game plays identically. RULING: the spec's suggested
  unified `placedInstances` schema is DECLINED - the existing placed
  arrays (buildings/decorations/paths/structures) already carry
  position+flip and stay the placed representation; only `shedInventory`
  is added. Zero visual migration risk, honors section 8.
- **U2a - Warehouse retires into the Shed** (schema v30; added after the
  U1 review): trophies join the catalog as `purchasable: false` items, the
  v30 migration OVERWRITE-merges warehouse counts into the shed (warehouse
  stayed authoritative after U1's mirror) and DELETES the warehouse field;
  decor buy/store/place reducers cut over to the shed. Player-visible
  behavior unchanged.
- **U2b - Unified Shop, Buildings + Decor tabs**: tabs/cards/stepper/
  locked+owned states, fly-to-Shed feedback + one-time tooltip; REPLACES
  Building Shop + Decor Shop; HUD goes to the two-button layout
  (section 4). The building "in-hand" fast path lands with U3's edit
  scene; until then a bought building places at its default anchor as
  today. The PATHS TAB is deferred to U4 so shop-bought tiles never
  coexist with T4.13's paint-time charging.
- **U3 - Edit scene rework**: contextual Flip/Put-away toolbar, persistent
  bottom bar (Shed/Shop/Undo/Cancel/Save - owner renamed Done to Save,
  2026-07-23), long-press entry (U3c), building
  in-hand placement, resize buttons REMOVED. RULINGS: existing scaled decor
  keeps its saved scale - only the resize UI goes; building slot unlocks
  are per-TYPE state (v32). **OWNER OVERRIDE 2026-07-23: BUILDINGS ARE
  EXEMPT FROM PUT-AWAY** - once placed they move/flip only; the shed holds
  a building only transiently via undo/Cancel, surfaced by shed-panel
  building rows; one-per-type counts shed + placed. CANCEL button added to
  the bottom bar: two-tap confirm, unwinds the whole edit session (LIFO)
  and exits; purchases are not refunded by Cancel. "Remove all decor to
  Shed" promoted from out-of-scope to QUEUED (post-U4).
- **U4 - Paths tab + painting from inventory**: the shop's Paths tab
  ships here; paint draws from Shed counts, erase refunds, gentle
  zero-stop; the T4.13 paint-time coin charge RETIRES (the shop stepper
  purchase replaces it - same coin sink, moved to buy time; balance
  mirror's paths row re-checked).

Owner's spec follows, verbatim.

---

This document describes a full redesign of the shop and layout-editing UI. It replaces the current two-shop structure (Building Shop on the HUD, Decor Shop inside Edit mode) with a single unified shop and a Shed-centered inventory pipeline. Read the whole document before implementing - the sections depend on each other.

## 1. Design goals

1. One shop, one item catalog, one card component. Buildings, paths, and decor are all rows in the same data-driven catalog, differentiated by a `category` field.
2. Players never rebuy anything. Removing an item from the farm returns it to the Shed inventory. Placement is always non-destructive.
3. Buying a building drops the player straight into placement. Buying paths or decor does NOT - those go to the Shed and the shop stays open (supports quantity buying).
4. No punishment, no failure states, no destructive actions. Running out of inventory mid-action stops gently, never errors.
5. One-thumb portrait play. Contextual tools appear near the player's tap point.

## 2. Current state vs. target state

| Area | CURRENT (remove/replace) | TARGET (build) |
|---|---|---|
| Main HUD | "Building Shop" button (flourmill, bakery) with nested "Paths" button; separate "Edit Layout" button | Two buttons: "Shop" and "Edit". Paths button is deleted - paths become a shop tab |
| Shops | Two shops: Building Shop (HUD) and Decor Shop (inside edit scene) | One unified Shop with three tabs: Buildings, Paths, Decor. Reachable from the HUD and from inside Edit mode (same shop, same state) |
| Edit mode Row 1 | Persistent toolbar: + / - resize, Flip, Put Away | DELETED as a persistent row. Flip and Put Away become a contextual toolbar attached to the selected asset. The + / - resize buttons are removed from the game entirely |
| Edit mode Row 2 | Shed, Shop, Done | Persistent bottom bar: Shed (with count badge), Shop, Undo (new), Done (visually prominent confirm) |
| Purchasing flow | Buy from whichever shop, unclear where items go | Everything flows Shop -> Shed -> Farm (see section 3). Buildings get a fast path: buy -> item in hand -> placement |

## 3. Core data model: the Shed pipeline

The Shed is the hub for every item. It has NO world asset - it exists only as a button/menu. All item movement follows this pipeline:

```
Shop --(buy)--> Shed inventory --(place)--> Farm placed instances
                      ^                            |
                      +---------(put away)---------+
```

- **Buy**: decrements currency, increments Shed inventory count for that item.
- **Place**: decrements Shed count, creates a placed instance on the farm (position, flip state).
- **Put away**: deletes the placed instance, increments Shed count. Nothing is ever destroyed or refunded in currency - items round-trip between Shed and Farm forever.
- **Building fast path**: buying a building performs Buy then immediately begins Place (item in hand, edit scene opens). Data-wise it still passes through the Shed - it just skips the "open Shed and select it" step in the UI.

### Suggested item schema (catalog is pure data/config)

```
item {
  id: string
  name: string
  category: "building" | "path" | "decor"
  icon/sprite ref
  currency: "coins" | "moondust"
  price: number            // for paths this is per tile
  unlockLevel: number       // 0 = always available
  allowMultiple: boolean    // buildings may be unique or not
}
```

### Player state additions

```
shedInventory: { [itemId]: count }
placedInstances: [ { instanceId, itemId, x, y, flipped } ]
```

Placement/put-away are pure moves between these two structures. This is also what makes Undo cheap (section 7).

## 4. Main HUD changes

REMOVE: "Building Shop" button, nested "Paths" button.
ADD/KEEP: "Shop" button (opens unified shop), "Edit" button (opens edit scene with nothing in hand).
ADD: long-press on any placed asset also opens the edit scene with that asset pre-selected (contextual toolbar already showing on it).

There are exactly three entrances to the edit scene:
1. Edit button on the HUD (nothing selected).
2. Long-press a placed asset (that asset selected).
3. Automatic entry after buying a building (that building in hand, in placement mode).

All three open the SAME scene. Do not create separate scenes or variants.

## 5. Unified Shop

### Layout
- Portrait panel. Header row: title "Shop", currency balances (coins, moondust), and a small Shed chip showing the current total Shed item count.
- Tab row: Buildings | Paths | Decor. Tabs filter the single catalog by `category`.
- Item grid: 2 columns of item cards.

### Item card anatomy (one component for all categories)
- Item art.
- Item name.
- Price pill: coin styling for coin prices, moondust styling for moondust prices. Path prices display a per-tile suffix (e.g. "10 ea").
- Locked state: if player level < unlockLevel, show the card dimmed with a lock pill reading "Level N" instead of the price. Locked items are VISIBLE, not hidden (aspiration without FOMO - nothing in the game expires). Tapping a locked card does nothing (or a gentle wiggle).
- Owned badge: small "xN" badge showing Shed count + placed count for that item, so players can see what they already have and avoid accidental duplicate buying.

### Category-specific purchase behavior
- **Buildings**: single tap-to-buy. On success: shop closes, edit scene opens, building is in hand for placement. (If a building should be unique and one is already owned, show the card as owned rather than purchasable.)
- **Paths and decor**: card shows a quantity stepper row (- qty + and an "Add to shed" button). Tapping Add to shed: deducts price x qty, adds qty to Shed inventory, shop STAYS OPEN so the player can keep shopping.

### "It went to your Shed" feedback (critical - the Shed has no world asset, so this teaches players where things go)
On Add to shed:
1. The item's icon animates from the card, shrinking and flying to the Shed chip in the shop header (simple tween, ~400ms).
2. The Shed chip does a small scale bounce and its count ticks up.
3. First purchase only: show a one-time tooltip - "Your items live in the Shed - open it in Edit mode to place them."
The Shed button in Edit mode also carries a persistent count badge.

## 6. Edit scene

### Contextual selection toolbar (replaces old persistent Row 1)
- Appears attached to (floating just above) whichever asset is currently selected; hidden when nothing is selected.
- Buttons: **Flip** (mirror the sprite) and **Put away** (remove instance, return to Shed, animate icon flying to the Shed button).
- The + / - resize buttons are REMOVED from the game. Do not carry them over.

### Persistent bottom bar (replaces old Row 2)
- **Shed**: opens the inventory panel. Shows a count badge of total stored items. Tapping an item in the Shed puts it in hand for placement.
- **Shop**: opens the same unified shop from section 5 (identical component/state, optionally pre-selecting the Decor tab).
- **Undo** (NEW): reverts the most recent edit action (see section 7).
- **Done**: exits edit mode. Style as the single visually prominent confirm button in the bar.

### Path placement (drag-to-paint)
Paths are tiles painted from inventory, not individually placed objects:
- Selecting a path from the Shed enters paint mode. Show the remaining tile count near the cursor/finger.
- Dragging paints tiles; each painted tile decrements the count. An eraser/remove pass over a tile refunds the count.
- Hitting zero mid-drag simply stops painting and shows a gentle "Shed's empty" nudge. No error state, no sound sting, no red UI.

### Put away / Shed relationship
Put Away and Shed are two halves of one system (store / retrieve). They must share iconography and language everywhere they appear. The put-away animation (item flying into the Shed button) is what teaches the relationship - keep it.

## 7. Undo

Because nothing is destructive, undo is a replay of inventory moves. Keep a simple action stack for the current edit session:
- place (instance created, shed -1) -> undo: delete instance, shed +1
- put away (instance deleted, shed +1) -> undo: recreate instance at old position/flip, shed -1
- move (position A -> B) -> undo: move back to A
- flip -> undo: flip back
- paint stroke (N tiles) -> undo: remove that stroke's tiles, refund N
Purchases are NOT undoable via this button (they are not edit actions). Stack can be cleared on Done. Single-step undo is acceptable for v1; a multi-step stack is preferred if trivial.

## 8. Migration notes for existing saves

- Any items previously purchasable only from the old Decor Shop or Building Shop map 1:1 into the unified catalog with the appropriate `category`.
- Existing placed assets become `placedInstances` entries; nothing moves visually.
- If the old system had any concept of "stored" assets, migrate those counts into `shedInventory`.
- Players lose no items and no currency in migration.

## 9. Acceptance checklist

- [ ] Main HUD shows exactly two entry buttons: Shop and Edit. Old Building Shop and Paths buttons are gone.
- [ ] Shop has Buildings / Paths / Decor tabs driven by one catalog + one card component.
- [ ] Locked items visible with level pill; owned counts shown on cards.
- [ ] Buying a building closes the shop and enters placement immediately.
- [ ] Buying paths/decor uses a quantity stepper, adds to Shed, keeps the shop open, and plays the fly-to-Shed-chip animation with count tick.
- [ ] First-ever Shed purchase shows the one-time tooltip.
- [ ] Edit scene reachable via Edit button, long-press on an asset, and building purchase - all the same scene.
- [ ] Contextual toolbar (Flip, Put away only) appears on selection, hidden otherwise. No resize buttons anywhere.
- [ ] Bottom bar: Shed (with badge), Shop, Undo, Done (prominent).
- [ ] Put away returns items to Shed; re-placing costs nothing. No rebuy path exists anywhere.
- [ ] Path painting shows live remaining count, refunds on erase, stops gently at zero.
- [ ] Undo reverses the last edit action correctly for place, put away, move, flip, and paint strokes.
- [ ] All feedback uses simple tween animations only; no failure states, sounds stings, or red error UI anywhere in these flows.

## 10. Explicitly out of scope (future ideas, do not build now)

- "Sweep all decor to Shed" bulk button for full redesigns.
- Discrete size variants for decor (small/medium/large as separate authored sprites) - this replaced the removed continuous resize concept and is deferred.
