# ASSETS.md - retired sections (moved 2026-07-17)

Moved intact from ASSETS.md during the owner-directed documentation cleanup.
Historical reference only.

---

## dirt_path (retired in T3.art-1)

`dirt_path` (added in T2.22b) gets the same square trim-fit-center treatment
at 288x288 and is wired up immediately as a non-interactive ground decal
(`FarmScene.createDirtPath`), connecting the farmhouse down toward the plot
grid's upper-right edge. See `DIRT_PATH_POSITION` in `src/config.ts` for how
its placement was measured.

Removed in T3.art-1 together with the placed dressing layout (the new-art era
starts from a blank dressing slate; the dressing editor remains).

---

## The retired placeholder generator

`tools/gen-assets.mjs` drew the original programmatic placeholder art. It is
**retired** and kept only for history - its npm script has been removed; do
not run it directly either, as it would overwrite the atlas with placeholder
art that no longer matches the frame list (no `plot_occupied`, `starcorn_*`,
or `moondust` frames). Use `npm run pack:atlas` instead.
