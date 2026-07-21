# Little Acres - balance (the economy contract)

The design/tuning **source of truth** for the game economy, one CSV per system.
This README is the full contract: read it and you know what every file holds,
which columns you may edit, how the rest recompute, and the invariants the
numbers must satisfy. Generated 2026-07-21 from `src/data/*.ts`.

## Mirror mode

- `src/data/*.ts` is AUTHORITATIVE at runtime. These CSVs MIRROR it; the game
  does not read them.
- The master workbook `little_acres_balance.xlsx` (live Globals formulas) is the
  interactive tuning surface. It is kept OUT of git (binary); its build recipe
  lives in the claudestead project as `balance/build_balance.py`, regenerable
  anytime and re-derives every file below.
- Tuning flows: workbook -> apply the new numbers to `src/data` via a coder task
  -> the PM re-exports these CSVs. A number here that disagrees with `src/data`
  is drift; re-export from source, never hand-edit a single derived cell.

## How to edit

Change only the **INPUT** columns of a file. Then recompute every **DERIVED**
column with the formula given, so the file stays self-consistent (round
coins/xp to whole numbers, rates to 0.1). Preserve every header, column order,
and row identity. Keep the cross-file invariants below true across all files.

## The files

### globals.csv  - `Key, Value, Unit, Notes`
Master levers. INPUT: `Value`. Each row's Notes says REAL (a live code constant
in `src/data`, applies via a code change) or MIRROR-ONLY (a design knob with no
code hook yet; keep at 1.0 unless proposing a new lever). A global cascades into
every sheet - prefer a global over editing many rows when the intent is "scale
everything."

### crops.csv
INPUT: `unlock_level, seed_cost, growth_sec_base, yield_qty, sell_price_base,
xp_base, niche`.
DERIVED:
- `growth_sec_eff = growth_sec_base * GROWTH_TIME_MULT`
- `sell_price_eff = sell_price_base * SELL_PRICE_MULT`
- `xp_eff = xp_base * XP_MULT`
- `revenue_per_harvest = yield_qty * sell_price_eff`
- `profit_per_harvest = revenue_per_harvest - seed_cost`
- `coins_per_hour = profit_per_harvest / (growth_sec_eff/3600)`
- `xp_per_hour = xp_eff / (growth_sec_eff/3600)`
`niche` is a one-line design intent per crop; keep it truthful to the numbers.

### goods.csv  (processed at buildings)
INPUT: `building_id, unlock_level, input1_id, input1_qty, input2_id, input2_qty,
prod_sec_base, output_qty, sell_price_base, xp_base`.
DERIVED:
- `prod_sec_eff = prod_sec_base * PRODUCTION_TIME_MULT`
- `sell_price_eff = sell_price_base * SELL_PRICE_MULT`
- `xp_eff = xp_base * XP_MULT`
- `input_cost = sum over inputs of (input_qty * that input's sell_price_eff)`
  (look the input up in crops.csv if it's a crop, else goods.csv)
- `revenue = output_qty * sell_price_eff`
- `margin = revenue - input_cost`
- `coins_per_hour = margin / (prod_sec_eff/3600)`
- `xp_per_hour = (output_qty * xp_eff) / (prod_sec_eff/3600)`
Goods `xp` is ORDER-PRICING only - goods grant no XP when collected (only crops
grant XP, on harvest).

### buildings.csv
INPUT: `unlock_level, coin_cost, place_sec (0 = instant, keep 0), slots_default
(1), slots_max (3), slot2_cost, slot3_cost, batch_input, batch_output,
batch_sec, notes`. `batch_input/batch_output/batch_sec` are the human-readable
mirror of this building's recipe row in goods.csv and MUST match it.

### progression.csv  - `level, xp_to_reach, cumulative_xp, unlocks`
INPUT: `xp_to_reach` (per-level delta; row 1 is 0). The game stores the
`cumulative_xp` column as its threshold table (levels.ts XP_THRESHOLDS).
DERIVED: `cumulative_xp[n] = cumulative_xp[n-1] + xp_to_reach[n]`.
`unlocks` is descriptive text; keep it consistent with the `unlock_level`s in
crops/goods/buildings. Never exceed MAX_LEVEL = 8 rows.

### orders.csv  (orders are GENERATED, not a fixed list)
Per-item order economics. INPUT: `orderable_from_level, unit_cap`.
MIRRORED (copy from the item's own row, do not set independently):
`unit_sell_value = the crop/good sell_price_base`, `unit_xp = its xp_base`.
DERIVED:
- `order_coins_per_unit = round(unit_sell_value * ORDER_COIN_MULT)`
- `order_xp_per_unit = round(unit_xp * ORDER_XP_MULT)`
`unit_cap` keeps a single order fulfillable given plot counts and batch
throughput - tune it against those, not in isolation.

### decor.csv  - `item_id, name, type, currency, price, notes`
INPUT: `currency, price`. The OPTIONAL coin + moondust sink. Rows with
`type=trophy` are quest rewards (price `-`), never purchasable. Moondust decor
is a primary moondust sink - price it against moondust supply.

### quests.csv  - `scope, id, name, counter, target, reward, notes`
INPUT: `target, reward`. `weekly_growth`'s target is a level-scaled list (L1-8);
`weekly_specialist`'s is per featured crop. Targets must be reachable inside
their window (lifetime for `scope=long`, one week for `scope=weekly`) at the
earn rates the other sheets imply.

### currencies.csv  - `currency, flow, source_or_sink, amount, notes`
A narrative ledger of every coin/moondust source and sink. Update an `amount`
only when the corresponding number changes elsewhere; keep it a faithful index
of the other sheets. This is where source-vs-sink balance is audited.

## Cross-file invariants (keep all true)

- A crop/good/building `unlock_level` is consistent everywhere it appears (its
  own sheet, `orders.orderable_from_level`, `progression.unlocks`) and `<= 8`.
- `orders.unit_sell_value / unit_xp` equal the item's crops/goods base values.
- `goods.input_cost` derives from real input sell values across sheets.
- `buildings.batch_*` mirror the goods recipe; slot costs are the real coin sink.

## Balance invariants (what the NUMBERS must satisfy)

- No crop tops BOTH coins/hr and XP/hr; every crop has a real niche.
- Long-crop plateau: a multi-hour crop must not out-earn active short crops on
  coins/hr. A gentle upward trend by tier is fine; an unbounded climb is not.
- Every production recipe is profitable (`margin > 0`), and each processing step
  pays a premium over selling its inputs raw (good value > input value).
- Orders beat raw selling (`ORDER_COIN_MULT > 1`) without trivializing crops.
- Moondust is SCARCE: lifetime sinks > lifetime sources. Coins stay meaningful
  late-game via sinks (buildings, slots, decor, expansion, regions, farmhouse
  restore).
- The level curve has no wall or skip (no level far longer/shorter in real time
  than its neighbours at the implied earn rates).

## Tuning targets (owner-set: 2026-07-21)

The goals the current balance pass tunes TOWARD. Unlike the invariants above,
these are design choices and can change between passes - update this section
when the owner re-sets them.

- **Progression pace:** L1 -> L8 in roughly 10-14 days of moderate daily play.
  No level is a wall (> ~2.5x the prior level's real time to clear) or a skip
  (< ~0.4x).
- **Player model:** short active sessions (2-5 min) several times a day, plus
  overnight idle. Balance BOTH the active loop and the leave-and-return loop.
- **Currency posture:** coins abundant but always chased by a bigger sink;
  moondust scarce (lifetime sinks > sources).
- **Monetization:** v1 is earn-only (no IAP). Keep every currency earnable;
  leave clean levers (time mults, moondust) for a future paid layer, but assume
  none exists.

Supersedes `docs/balance-v2.xlsx` (retired 2026-07-21).
