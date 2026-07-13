# Little Acres - Asset Pipeline

Most art ships in a single texture atlas:

- `assets/atlas.png` - packed RGBA sprite sheet
- `assets/atlas.json` - Phaser 3 **JSON hash** atlas data (`load.atlas`)

Both files are **committed** to the repo. The build and CI consume them as-is;
no image tooling runs at build time. They are loaded in the Preload scene under
the texture key `atlas` (see `ATLAS_KEY` in `src/config.ts`) and imported
through Vite, so they are fingerprinted and cached like any other asset.

Two ground textures (T2.28) ship as standalone, non-atlas images instead -
see "Ground textures (standalone, not atlas frames)" below.

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

| Frame                                                                                                                                                                  | Size (px)             | Notes                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `grass`                                                                                                                                                                | 256x160               | tile; diamond top face 256x128, lip below                                                                                                      |
| `grass_flat`                                                                                                                                                           | 256x160               | tile; derived from `grass.png` (T2.28a), flat-fill, no fringe/lip - see "Flat grass tile" below                                                |
| `plot`                                                                                                                                                                 | 256x160               | tile; empty tilled dirt                                                                                                                        |
| `plot_occupied`                                                                                                                                                        | 256x160               | tile; planted soil (growing plots)                                                                                                             |
| `sunwheat_0` .. `sunwheat_2`                                                                                                                                           | 128x128               | growth stages 0 (sprout) - 2 (ready)                                                                                                           |
| `starcorn_0` .. `starcorn_2`                                                                                                                                           | 128x128               | growth stages                                                                                                                                  |
| `glowberry_0` .. `glowberry_2`                                                                                                                                         | 128x128               | growth stages; stage 2 glows                                                                                                                   |
| `moonroot_0` .. `moonroot_2`                                                                                                                                           | 128x128               | growth stages (packed T2.21, wired in T2.18)                                                                                                   |
| `emberpepper_0` .. `emberpepper_2`                                                                                                                                     | 128x128               | growth stages (packed T2.21, wired in T2.18)                                                                                                   |
| `dewmelon_0` .. `dewmelon_2`                                                                                                                                           | 128x128               | growth stages (T3.11)                                                                                                                          |
| `sagesprig_0` .. `sagesprig_2`                                                                                                                                         | 128x128               | growth stages (T3.11)                                                                                                                          |
| `chest_closed`, `chest_open`                                                                                                                                           | 128x128               | crop-style, no growth stage; chest ceremony (`src/ui/ChestCeremony.ts`, T2.23a)                                                                |
| `coin`                                                                                                                                                                 | 96x96                 | currency icon                                                                                                                                  |
| `moondust`                                                                                                                                                             | 96x96                 | currency icon                                                                                                                                  |
| `bag`                                                                                                                                                                  | 96x96                 | HUD bag button icon                                                                                                                            |
| `scroll`                                                                                                                                                               | 96x96                 | HUD quest-board button icon (orders moved to the notice board T2.22; scroll returned as quests T3.10)                                          |
| `note`                                                                                                                                                                 | 96x96                 | reserved, unused (was the audio button; audio behind the gear since T2.13)                                                                     |
| `pouch`                                                                                                                                                                | 96x96                 | reserved, unused                                                                                                                               |
| `sign`                                                                                                                                                                 | 192x192               | ExpandSign signpost                                                                                                                            |
| `panel`                                                                                                                                                                | 128x128               | UI 9-slice source                                                                                                                              |
| `notice_board`                                                                                                                                                         | 256x256               | FarmScene notice board structure (T2.22)                                                                                                       |
| `farmhouse`                                                                                                                                                            | 256x256               | FarmScene decorative farmhouse (T2.22)                                                                                                         |
| `dirt_path`                                                                                                                                                            | 288x288               | FarmScene ground decal, house->field (T2.22b)                                                                                                  |
| `mere`                                                                                                                                                                 | 384x384               | staged as `mere_strip.png`; unwired (T2.21)                                                                                                    |
| `hud_banner`                                                                                                                                                           | 512 wide, keep aspect | HUD banner strip (`src/ui/Hud.ts`, T2.13b)                                                                                                     |
| `hud_crest`                                                                                                                                                            | 192x192               | HUD level crest (`src/ui/Hud.ts`, T2.13b)                                                                                                      |
| `xpbar_frame`                                                                                                                                                          | 512 wide, keep aspect | HUD xp bar frame (`src/ui/Hud.ts`, T2.13b)                                                                                                     |
| `xpbar_fill`                                                                                                                                                           | 512 wide, keep aspect | HUD xp bar fill (`src/ui/Hud.ts`, T2.13b)                                                                                                      |
| `gear_icon`                                                                                                                                                            | 128x128               | corner settings gear (`src/ui/Hud.ts`, T2.13)                                                                                                  |
| `button_push`                                                                                                                                                          | 256x256               | future nineslice source; unwired (T2.21)                                                                                                       |
| `button_slot`                                                                                                                                                          | 256x256               | plain downscale; unwired (T2.21)                                                                                                               |
| `button_close`                                                                                                                                                         | 96x96                 | staged as `xbutton.png`; unwired (T2.21)                                                                                                       |
| `tuft_1`                                                                                                                                                               | 96x96                 | dirt-based ground decal (T2.28)                                                                                                                |
| `tuft_2`                                                                                                                                                               | 96x96                 | grass-based ground decal (T2.28)                                                                                                               |
| `tuft_1v2`                                                                                                                                                             | 96x96                 | tuft variant decal (owner pick, 2026-07-12)                                                                                                    |
| `tuft_2v2`                                                                                                                                                             | 96x96                 | tuft variant decal (owner pick, 2026-07-12)                                                                                                    |
| `dirt_wisp`                                                                                                                                                            | 96x96                 | dirt-based ground decal (T2.28)                                                                                                                |
| `stones_1`                                                                                                                                                             | 128x128               | rock cluster decal (T2.28)                                                                                                                     |
| `stone_a`, `stone_b`, `stone_c`                                                                                                                                        | 64x64                 | single-rock decals (T2.28); packed conditionally - only whichever are staged, `pack-atlas.mjs` logs the count                                  |
| `decor_bench`, `decor_flowerbed`, `decor_fence`, `decor_barrels`, `decor_scarecrow`, `decor_birdbath`, `decor_well`, `decor_mushrooms`, `decor_gnome`, `decor_lantern` | 128x128               | purchasable decorations (T3.9); `src/data/decor.ts` `DECOR_ITEMS`, sold from `src/ui/DecorShop.ts`                                             |
| `trophy_goldscarecrow`, `trophy_moonwell`, `trophy_traderscart`                                                                                                        | 128x128               | quest trophy decorations (T3.9); not purchasable - `src/data/decor.ts` `TROPHY_FRAMES`, granted by quest rewards (`src/data/quests.ts`, T3.10) |
| `trophy_starbanner`                                                                                                                                                    | 192x192               | quest trophy (T3.9), same as above - taller art, packed larger to stay legible                                                                 |
| `trophy_ancientoak`                                                                                                                                                    | 256x256               | quest trophy (T3.9), same as above - tallest/most detailed art, packed larger to stay legible                                                  |
| `ground_shadow`                                                                                                                                                        | 128x64                | **generated, not staged** (T3.9) - see "Ground shadows" below                                                                                  |

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

### Flat grass tile (T2.28a)

`grass`'s art draws each diamond with a scalloped/torn-edge fringe running
the full perimeter (measured ~12px deep on the ~466px-wide staged master,
logged at pack time) plus an asymmetric lip hanging below the diamond's
natural bottom tip. Individually each tile reads fine, but tiled edge to edge
across the field these fringes compound into a visible grid-line pattern -
the actual defect this task addresses, not the "raised lip" 3D look itself.

Insetting toward the fringe does not remove it: the scallop is present at
every radius from the diamond's center (it is not a clean band near the
edge), so cropping inward and rescaling just zooms into the same jagged
pattern, amplifying it. `grass_flat` (`tools/pack-atlas.mjs`
`processTileFlat`) instead decouples the fill texture from the tile's edge
shape entirely:

1. Mirrors the top half (tip -> corner) onto the bottom half, discarding the
   source's own asymmetric lip.
2. Crops a small sample from deep in the interior - `TILE_FLAT_SAMPLE_FRACTION`
   (0.35 of the trimmed source's width/height, centered), comfortably clear of
   the measured fringe on every side - and stretches it to fill the diamond
   bounding box.
3. Stamps a synthetic, mathematically exact rhombus alpha mask
   (`maskToDiamond`) over the stretched sample, with a 1px feather at the
   boundary, instead of keeping the source's own jagged alpha.

The 0.35 sample fraction was chosen by rendering tiled composites at
0.25/0.35/0.45/0.55 and comparing texture repetition against edge cleanliness
(0.25 read as an overly small, repetitive motif; 0.55 started reintroducing
fringe artifacts from the sample's own corners) - same search-and-visually-
compare method as `DIRT_PATH_POSITION`/tileScale below. Same
`TILE_DIAMOND_WIDTH` x `TILE_DIAMOND_HEIGHT` geometry as `grass`, packed into
the same 256x160 frame (bottom 32 rows transparent, no lip), so `'tiles_flat'`
ground mode reuses `FarmScene.layGrassField`'s grid math unchanged - only the
frame name differs from `'tiles'` mode. `GROUND_MODE` in `src/config.ts`
still defaults to `'tiles'`; a dev-overlay button cycles
tiles -> tiles_flat -> texture_a -> texture_b live for the owner's verdict.

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

`mere` (staged as `mere_strip.png`; parked 2026-07-10 - see decisions),
`button_push`, `button_slot`, and `button_close` (staged as `xbutton.png`)
are packed into the atlas but no scene or UI code references them yet - a
later task wires them up. (`hud_banner`, `hud_crest`, `xpbar_frame`,
`xpbar_fill`, and `gear_icon`, originally staged unwired in T2.21, were wired
up by the T2.13 HUD theming series.) Square frames (`hud_crest`,
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

`tuft_1`, `tuft_2`, and `dirt_wisp` (added in T2.28) get the same square
trim-fit-center treatment at 96x96; `stones_1` at 128x128; `stone_a`/`stone_b`/
`stone_c` (and `stone_d` if ever staged) at 64x64. All are scene-dressing
decals placed by `FarmScene.createSceneDressing` from fixed, hand-tuned
placement arrays in `src/config.ts` - see "Scene dressing decals" below.

## Ground textures (standalone, not atlas frames)

`grass_texture_a.png` and `grass_texture_b.png` (T2.28) are an _experimental_
alternative to the grass diamond tiles, toggled live via a dev-overlay button
(`GROUND_MODE` in `src/config.ts`; default stays `'tiles'`, shipped safe).
Unlike every other asset on this page, they are **not** atlas frames: Phaser
`TileSprite`s need a clean, gutter-free image to repeat, and packing them into
the shared atlas would mean the repeat wraps into neighboring frames' padding.
They are committed directly as `assets/grass_texture_a.png` /
`assets/grass_texture_b.png` and imported into Preload the same way the atlas
PNG and the audio files are (a plain Vite asset URL import), loaded with
`this.load.image(...)`.

They are still produced by `tools/pack-atlas.mjs` (run via `npm run
pack:atlas`, same as the atlas) so there is one regeneration command for all
staged art. The staged 512x512 masters (`tools/art-staging/grass_texture_a.png`
/ `_b.png`) are NOT full-bleed square textures - a Jimp opaque-bounds scan
found only a narrow vertical strip is actually opaque (roughly x=120..390 of
512, full height; confirmed on both masters), the rest is transparent
padding. The packer trims each to its own opaque bounds (271x512 and 269x512
at the current staged art) and writes the trimmed result directly - no fixed
frame, no resize, unlike every atlas-packed asset above.

**Seam pre-check** (measured on the trimmed content, not the raw padded
master - comparing the raw master's edges would only compare transparent
pixels to transparent pixels and say nothing about tiling risk):

| texture                          | left-vs-right edge mean channel delta | top-vs-bottom edge mean channel delta | edge-vs-center luminance delta |
| -------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------ |
| `grass_texture_a` (dense blades) | 21.6 /255                             | 49.6 /255                             | 0.35                           |
| `grass_texture_b` (soft mottle)  | 33.0 /255                             | 59.2 /255                             | 2.70                           |

Both textures tile with a visible seam on both axes (nonzero deltas), more so
vertically than horizontally, and more so on `_b` than `_a` on both axes -
`_b` also has an actual vertical brightness gradient baked into the art (not
a vignette; the low edge-vs-center delta after trimming rules that out), which
reads as a repeating horizontal band when tiled. `_a`'s busy, high-frequency
blade pattern visually masks its seam far better than `_b`'s smooth mottle
does at the same numeric delta. Net judgment: `grass_texture_a` is the
lower seam-risk candidate; `grass_texture_b` is noticeably more seam-prone in
both the numbers and the tileScale comparison below.

**tileScale choice.** `FarmScene`'s field-band `TileSprite` was rendered at
tileScale 0.5 and 1.0 for each texture (the Claude-in-Chrome browser extension
was unavailable this session - same situation T2.22b's `DIRT_PATH_POSITION`
hit; a Jimp script rendered static composites of the real trimmed art tiled
with the real iso grid math instead, standing in for in-game screenshots).
`grass_texture_a` ships at **1.0**: it matches the project's "author at 1x"
convention (unlike every other atlas asset, ground textures are not
downscaled into a smaller packed frame - they keep their trimmed native
size), it reads as proportionate "chunky readable" blades next to a plot tile
at that scale, and it halves the seam count per screen width versus 0.5 with
no readability cost (the busy blade pattern already masks the seam well).
`grass_texture_b` ships at **0.5**: at 1.0 only ~2 repeats fit the field band
vertically, so its baked-in vertical gradient (see above) reads as one
glaring light/dark discontinuity right in the middle of the field; at 0.5 the
same gradient repeats twice as often, turning it into higher-frequency
banding that is less jarring, if still visible - the smaller scale is a
lesser-evil mitigation for an art defect, not a fix.
`GROUND_TEXTURE_A_TILE_SCALE`/`GROUND_TEXTURE_B_TILE_SCALE` in `src/config.ts`
hold these values.

## Scene dressing decals

`FarmScene.createSceneDressing` (T2.28, collapsed to one array in T2.28a)
reads a single fixed placement array, `DRESSING` in `src/config.ts` -
dirt-based decals (`tuft_1`, `dirt_wisp`, `stones_1`) hugging the dirt path
plus grass-based decals (`tuft_2`, single rocks) scattered across open grass,
all rendered at one depth (6, just above the path's own depth 5). A
deterministic `{frame, x, y, scale, front?}` array with no runtime
randomness, so the layout is stable across reloads (`front`, added in
T2.28a, is an optional per-decal override that renders above every
y-depth-sorted object instead - see "Dressing editor" below). Commenting out
the single `createSceneDressing()` call in `FarmScene.create` disables all of
it. See git history (pre-T2.28a) for the original measured-placement detail
(Jimp opaque-bounds scans against every plot tile at both field sizes, plus
structures/path/sign) - from T2.28a on, the array is maintained through the
dressing editor below rather than by hand-measurement.

### Dressing editor (T2.28a, dev-only)

A dev-overlay toggle, "Edit dressing" (backtick to open the overlay, same as
every other dev control), turns every placed decal draggable and reveals two
extra rows: a palette (one "+" button per `DRESSING_PALETTE_FRAMES` entry in
`src/config.ts` - `tuft_1`, `tuft_2`, `dirt_wisp`, `stones_1`, `stone_a`,
`stone_b`, `stone_c` - that spawns one at screen center) and an action row
(Scale +/-, Move to front, Delete, Copy layout) acting on whichever decal was
last tapped or spawned (a light-blue tint marks the selection). "Move to
front" toggles that decal's `front` flag so it can be positioned on top of
the farmhouse/notice board/crops instead of always rendering beneath them.
"Copy layout" writes the live array as pretty JSON to the clipboard for the
owner to hand back to be baked into `DRESSING`. While editing, every OTHER
interactive object in the scene (seed bar, HUD, notice board, expand sign,
...) is disabled too, so dragging a decal near them never fires their own tap
handler; toggling off restores everything and re-locks the decals. Editor
state is session-only - it never touches the game save.

## Decorations (T3.9)

`DECOR_ITEMS` (`src/data/decor.ts`) lists the 10 purchasable decorations
(`decor_bench` .. `decor_lantern`, all packed at 128x128, priced in coins or
moondust); `TROPHY_FRAMES` lists the 5 non-purchasable trophy frames, granted
by quest rewards (`src/data/quests.ts`, T3.10). Purchases
(`src/ui/DecorShop.ts`, opened by tapping the farmhouse) go into the save's
`warehouse` (`Record<frame, count>`, T3.9b); placed decorations live in the
save's `decorations` array as `{ frame, x, y, scale }` entries (see
`src/systems/gameState.ts`), which `FarmScene` renders iso-sorted by its own
y like a crop or structure. Placing from the warehouse happens in the player
arrange/edit mode (T3.9a/T3.9b): items spawn at the default size
(`DECOR_SPAWN_SCALE` - also the maximum) and are moved/stored with
store-authoritative transforms.

## Ground shadows (T3.9)

`ground_shadow` (128x64) is the one atlas frame with no staged source - it is
generated directly by `tools/pack-atlas.mjs` (`generateGroundShadow`): a
black radial-gradient ellipse, alpha 0.35 at its center falling linearly to 0
at the ellipse boundary (elliptical, not circular, distance so the gradient's
iso-contours match the frame's own 2:1 aspect). `FarmScene` renders one under
every standing object - the farmhouse, the notice board, and every decoration

- at width = 0.8x the object's display width (`SHADOW_WIDTH_RATIO` in
  `src/config.ts`), height = width x 0.5 (the frame is already 2:1), positioned
  at the object's visual base (the bottom of its display bounds, raised ~8px),
  depth one below the object's own, and alpha `SHADOW_ALPHA` (0.3). This is the
  systemic fix for standing sprites reading as "taped on" to the ground rather
  than resting on it. Dressing decals and the dirt path do not get shadows
  (ground-hugging art, not standing objects).

## Icons

`coin`, `moondust`, `bag`, `scroll`, `note`, and `pouch` are all trimmed and
fitted into 96x96, centered. `bag` is the HUD bag button icon and `scroll` is
the HUD quest-board icon (`src/ui/Hud.ts`; orders moved to the farm's notice
board in T2.22, and the scroll returned as the quest board in T3.10). `note`
(the old audio button; audio moved behind the settings gear in T2.13) and
`pouch` are reserved, unused.

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
