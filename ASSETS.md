# Little Acres - Asset Pipeline

All art ships in a single texture atlas:

- `assets/atlas.png` - packed RGBA sprite sheet
- `assets/atlas.json` - Phaser 3 **JSON hash** atlas data (`load.atlas`)

Both files are **committed** to the repo. The build and CI consume them as-is;
no image tooling runs at build time. They are loaded in the Preload scene under
the texture key `atlas` (see `ATLAS_KEY` in `src/config.ts`) and imported
through Vite, so they are fingerprinted and cached like any other asset.

## The art-staging workflow

Source art lives in `tools/art-staging/` as 512px PNG masters, one file per
frame, named `<frame>.png`. The folder is **gitignored** (masters are large
and churn often); only the packed atlas is committed.

```
npm run pack:atlas
```

Runs `tools/pack-atlas.mjs` (dev-time tool, **never** a build step): it reads
the staging folder, normalizes every source into its runtime frame (trim,
scale, anchor - the conventions below are enforced by the script, not by
hand), shelf-packs the atlas, and rewrites `assets/atlas.png` +
`assets/atlas.json`. Commit the results. Layout is deterministic (fixed frame
list, sorted packing order), so reruns are byte-stable given identical inputs.

The only dependency is `jimp` (pure JS - deliberately not sharp: no
platform-specific optional deps to break the lockfile). Staged files that are
not in the frame list are ignored with a console note; the current extras
(`appicon`, `bag`, `scroll`, `sign`, `note`, `pouch`) are **reserved for the
upcoming icon tasks**.

## Frame-name convention

Frame names are a stable API - code refers to them, so replacement art must
keep them.

| Frame                          | Size (px) | Notes                                     |
| ------------------------------ | --------- | ----------------------------------------- |
| `grass`                        | 256x160   | tile; diamond top face 256x128, lip below |
| `plot`                         | 256x160   | tile; empty tilled dirt                   |
| `plot_occupied`                | 256x160   | tile; planted soil (growing plots)        |
| `sunwheat_0` .. `sunwheat_2`   | 128x128   | growth stages 0 (sprout) - 2 (ready)      |
| `starcorn_0` .. `starcorn_2`   | 128x128   | growth stages                             |
| `glowberry_0` .. `glowberry_2` | 128x128   | growth stages; stage 2 glows              |
| `coin`                         | 96x96     | currency icon                             |
| `moondust`                     | 96x96     | currency icon                             |
| `panel`                        | 128x128   | UI 9-slice source                         |

Crops follow `<cropId>_<stage>` with stages `0..2`; `src/data/crops.ts` maps
crop ids to their stage frames. New crops should follow the same pattern.
(Starcorn replaced Carrot in T2.6; saves migrate the crop id automatically.)

## Tiles: diamond-center anchoring

The tile art has raised lips/fringes, so tile frames are **256x160** - taller
than the 2:1 diamond. Inside the frame, the diamond TOP FACE spans exactly
256x128 (`TILE_WIDTH`/`TILE_HEIGHT` in `src/systems/iso.ts`) with the
diamond's center at **(128, 64)** - `TILE_FRAME_WIDTH / 2` and
`TILE_DIAMOND_CENTER_Y` in `src/config.ts`; the lip hangs below into the
extra 32 rows.

- Grid-to-screen conversion lives in `src/systems/iso.ts` (`gridToIso` /
  `isoToGrid`). Screen (x, y) is still the **center of the diamond**; tile
  sprites render with origin `(0.5, TILE_DIAMOND_CENTER_Y /
TILE_FRAME_HEIGHT)`, so grid math and hit-testing never see the taller
  frame.
- The packer measures the source's diamond (widest row = left/right corners,
  topmost row = top corner) and scales non-uniformly to hit the 256x128 face,
  so masters do not need to be drawn at exactly 2:1.

## Crop sprite anchoring

Crop frames are 128x128 (`CROP_FRAME_SIZE`), anchored on the baseline y = 104
(`CROP_BASELINE_Y`): placing a crop = position it at the tile's iso center
with origin `(0.5, CROP_BASELINE_Y / CROP_FRAME_SIZE)`. The packed art's
lowest opaque row sits at `CROP_BASELINE_Y + CROP_SINK` (104 + 14) - sunk
below the anchored baseline so the mound's visual middle lands on the diamond
center, hugging the tile. All three constants live in `src/data/crops.ts`.

The packer enforces the convention: trim, center horizontally (bbox center at
x = 64), scale to the growth stage's height target - stage 2 = 100% of the
max legal height (`CROP_BASELINE_Y + CROP_SINK` = 118), stage 1 = 78%,
stage 0 = 55%, so stages read small -> medium -> full at a glance - with
width capped at 128 (a width-limited sprite that misses its height target is
logged), then bottom-pin at 104 + 14. Masters just need the plant to touch
the bottom of its opaque bounds.

## Icons

`coin` and `moondust` are trimmed and fitted into 96x96, centered.

## UI 9-slice panel

`panel` is packed at 128x128. Use `PANEL_SLICE` from `src/config.ts` as the
slice margin on **all four sides of every nineslice call**
(`this.add.nineslice(x, y, ATLAS_KEY, 'panel', w, h, PANEL_SLICE,
PANEL_SLICE, PANEL_SLICE, PANEL_SLICE)`) - the art has one border width, so
there is one constant. The packer measures the packed border thickness and
corner radius and logs the safe margin; keep `PANEL_SLICE` in sync with that
log line whenever the panel art changes.

## Palette / scale rules

- Style: isometric 2D, soft chunky readable shapes, saturated-but-gentle
  colors.
- Author at 1x against the 1080x1920 portrait design resolution (no @2x
  variants; Phaser scales the whole canvas via Scale.FIT). Masters are staged
  at 512px and downscaled by the packer.
- "Ready" (stage 2) crops must read as clearly more grown and brighter than
  earlier stages at a glance.

## The retired placeholder generator

`tools/gen-assets.mjs` drew the original programmatic placeholder art. It is
**retired** and kept only for history - its npm script has been removed; do
not run it directly either, as it would overwrite the atlas with placeholder
art that no longer matches the frame list (no `plot_occupied`, `starcorn_*`,
or `moondust` frames). Use `npm run pack:atlas` instead.
