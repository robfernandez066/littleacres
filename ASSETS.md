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
platform-specific optional deps to break the lockfile). `appicon` is the one
staged file never packed into the atlas - it is ignored by `pack-atlas.mjs`
with a console note and packed separately (see "App icon" below). `pouch` is
packed into the atlas as a reserved frame - unused in code today, saved for a
future task.

## Frame-name convention

Frame names are a stable API - code refers to them, so replacement art must
keep them.

| Frame                              | Size (px)             | Notes                                         |
| ---------------------------------- | --------------------- | --------------------------------------------- |
| `grass`                            | 256x160               | tile; diamond top face 256x128, lip below     |
| `plot`                             | 256x160               | tile; empty tilled dirt                       |
| `plot_occupied`                    | 256x160               | tile; planted soil (growing plots)            |
| `sunwheat_0` .. `sunwheat_2`       | 128x128               | growth stages 0 (sprout) - 2 (ready)          |
| `starcorn_0` .. `starcorn_2`       | 128x128               | growth stages                                 |
| `glowberry_0` .. `glowberry_2`     | 128x128               | growth stages; stage 2 glows                  |
| `moonroot_0` .. `moonroot_2`       | 128x128               | growth stages (T2.21; not yet wired up)       |
| `emberpepper_0` .. `emberpepper_2` | 128x128               | growth stages (T2.21; not yet wired up)       |
| `chest_closed`, `chest_open`       | 128x128               | crop-style, no growth stage (T2.21; unwired)  |
| `coin`                             | 96x96                 | currency icon                                 |
| `moondust`                         | 96x96                 | currency icon                                 |
| `bag`                              | 96x96                 | HUD bag button icon                           |
| `scroll`                           | 96x96                 | HUD orders button icon                        |
| `note`                             | 96x96                 | HUD audio button icon                         |
| `pouch`                            | 96x96                 | reserved, unused                              |
| `sign`                             | 192x192               | ExpandSign signpost                           |
| `panel`                            | 128x128               | UI 9-slice source                             |
| `notice_board`                     | 256x256               | FarmScene notice board structure (T2.22)      |
| `farmhouse`                        | 256x256               | FarmScene decorative farmhouse (T2.22)        |
| `dirt_path`                        | 288x288               | FarmScene ground decal, house->field (T2.22b) |
| `mere`                             | 384x384               | staged as `mere_strip.png`; unwired (T2.21)   |
| `hud_banner`                       | 512 wide, keep aspect | plain downscale; unwired (T2.21)              |
| `hud_crest`                        | 192x192               | plain downscale; unwired (T2.21)              |
| `xpbar_frame`                      | 512 wide, keep aspect | plain downscale; unwired (T2.21)              |
| `xpbar_fill`                       | 512 wide, keep aspect | plain downscale; unwired (T2.21)              |
| `gear_icon`                        | 128x128               | plain downscale; unwired (T2.21)              |
| `button_push`                      | 256x256               | future nineslice source; unwired (T2.21)      |
| `button_slot`                      | 256x256               | plain downscale; unwired (T2.21)              |
| `button_close`                     | 96x96                 | staged as `xbutton.png`; unwired (T2.21)      |

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

### `plot` footprint fix (T2.21)

`plot`'s art had a known bug: even after the shared tile transform above, its
opaque footprint didn't match `plot_occupied`'s, so it visibly stuck out past
the grid diamond in a mixed field. The packer now re-crops `plot`'s
transformed frame to its own opaque bounds, rescales that crop onto
`plot_occupied`'s measured bounds, and composites it at the same offset, so
the two tiles are always pixel-aligned regardless of source art differences.
Measured at the current staged art: `plot_occupied` footprint `w=256 h=137`;
`plot` was `w=256 h=144` before the fix, `w=256 h=137` after (both frames'
footprint now starts at `x=0 y=0`).

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

`moonroot` and `emberpepper` (added in T2.21) are packed with this exact
convention, sharing `<cropId>_<stage>` naming. `chest_closed`/`chest_open`
(also T2.21) are single static objects with no growth stage, so they get the
same baseline/centering treatment pinned at the full (stage-2-equivalent)
height target instead of a per-stage fraction.

## New UI art staged, not yet wired up (T2.21)

`mere` (staged as `mere_strip.png`), `hud_banner`, `hud_crest`, `xpbar_frame`,
`xpbar_fill`, `gear_icon`, `button_push`, `button_slot`, and `button_close`
(staged as `xbutton.png`) are packed into the atlas but no scene or UI code
references them yet - a later task wires them up. Square frames (`hud_crest`,
`gear_icon`, `button_push`, `button_slot`, `button_close`, `mere`) get the
same trim-fit-center treatment as the icons above, just at their own listed
size. `hud_banner`, `xpbar_frame`, and `xpbar_fill` are trimmed and scaled to
a fixed 512px width keeping their source aspect ratio, with no fixed square
frame (their packed height varies). `button_push` is flagged as a likely
future nineslice source (like `panel`) but is not measured/sliced as one yet.

`notice_board` and `farmhouse` (added in T2.22) get the same square
trim-fit-center treatment at 256x256 and are wired up immediately:
`src/scenes/FarmScene.ts` renders both structures on the farm (the notice
board opens the order board on tap; the farmhouse is decorative).

`dirt_path` (added in T2.22b) gets the same square trim-fit-center treatment
at 288x288 and is wired up immediately as a non-interactive ground decal
(`FarmScene.createDirtPath`), connecting the farmhouse down toward the plot
grid's upper-right edge. See `DIRT_PATH_POSITION` in `src/config.ts` for how
its placement was measured.

## Icons

`coin`, `moondust`, `bag`, `scroll`, `note`, and `pouch` are all trimmed and
fitted into 96x96, centered. `bag`/`scroll`/`note` are the HUD bag/orders/audio
button icons (`src/ui/Hud.ts`), laid out beside their label as a single
horizontally-centered group so button width and label length can vary without
throwing the group off-center.

`sign` is trimmed and fitted into 192x192, centered - the ExpandSign signpost
(`src/ui/ExpandSign.ts`), displayed at a fixed height with the cost text and
coin icon rotated to sit along the plank's angle in the art.

## App icon

The PWA app icon (`public/icon-192.png`, `icon-512.png`,
`icon-512-maskable.png` - see the `manifest.icons` list in `vite.config.ts`)
is generated from `tools/art-staging/appicon.png` by a separate script:

```
npm run pack:icons
```

Runs `tools/pack-icons.mjs`, kept separate from `pack-atlas.mjs` because the
app icon is not an atlas frame - the OS/manifest loads it directly, never
through `ATLAS_KEY`. The master has transparent rounded corners around its
opaque rounded-square background (so OS icon masking, which crops to its own
shape, never shows the art's corners as-is); the script samples the
background color from the opaque square and composites the art over a
full-bleed canvas of that color before exporting each size, so every output
file is opaque edge-to-edge. Commit the results, same as the atlas.

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
