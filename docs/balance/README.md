# Little Acres - balance (CSV mirror)

The design/tuning **source of truth** for the game economy, one CSV per system.
Generated 2026-07-21 from `src/data/*.ts`.

**Mirror mode:** tune numbers in the master workbook, then apply them back to
`src/data/*.ts` (the coder does this). The game code stays authoritative at
runtime - it does NOT read these files yet.

The master workbook (`little_acres_balance.xlsx`, with the live Globals formulas)
is kept OUT of git - it is a binary blob. It is regenerated from these values and
delivered alongside; the CSVs are the diffable record.

Files: `globals`, `crops`, `goods`, `buildings`, `progression`, `orders`,
`decor`, `quests`, `currencies`.

Supersedes `docs/balance-v2.xlsx` (retired 2026-07-21; its Crops/Levels/Orders/
Decor/Quests are all here and current - e.g. weekly Growing Strong is now
level-scaled and Specialist covers Dewmelon/Sagesprig).
