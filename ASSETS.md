# Little Acres - Asset Pipeline

All art ships in a single texture atlas:

- `assets/atlas.png` - packed RGBA sprite sheet
- `assets/atlas.json` - Phaser 3 **JSON hash** atlas data (`load.atlas`)

Both files are **committed** to the repo. The build and CI consume them as-is;
no image tooling runs at build time. They are loaded in the Preload scene under
the texture key `atlas` (see `ATLAS_KEY` in `src/config.ts`) and imported
through Vite, so they are fingerprinted and cached like any other asset.

## Frame-name convention

Frame names are a stable API - code refers to them, so real art must keep them.

| Frame                          | Size (px) | Notes                                |
| ------------------------------ | --------- | ------------------------------------ |
| `grass`                        | 256x128   | 2:1 iso diamond, fills the canvas    |
| `plot`                         | 256x128   | 2:1 iso diamond, tilled dirt         |
| `sunwheat_0` .. `sunwheat_2`   | 128x128   | growth stages 0 (sprout) - 2 (ready) |
| `carrot_0` .. `carrot_2`       | 128x128   | growth stages                        |
| `glowberry_0` .. `glowberry_2` | 128x128   | growth stages; stage 2 glows         |
| `coin`                         | 96x96     | currency icon                        |
| `panel`                        | 96x96     | UI 9-slice source                    |

Crops follow `<cropId>_<stage>` with stages `0..2`; `src/data/crops.ts` maps
crop ids to their stage frames. New crops should follow the same pattern.

## Tile dimensions and iso projection

- Tile diamond: **256x128** (2:1). Constants: `TILE_WIDTH` / `TILE_HEIGHT` in
  `src/systems/iso.ts`.
- Grid-to-screen conversion lives in `src/systems/iso.ts` (`gridToIso` /
  `isoToGrid`). Screen (x, y) is always the **center** of a tile's diamond;
  tile images render with origin (0.5, 0.5).
- `ISO_ORIGIN_X/Y` is the screen position of tile (0, 0)'s center, derived so
  the `FARM_COLS x FARM_ROWS` plot grid (see `src/data/farm.ts`) is centered
  in the 1080x1920 design area.

### Crop sprite anchoring

Crop frames are 128x128 (`CROP_FRAME_SIZE`) with the plant's base drawn on a
baseline at y = 104 (`CROP_BASELINE_Y`), both in `src/data/crops.ts`. Placing
a crop = position it at the tile's iso center with origin
`(0.5, CROP_BASELINE_Y / CROP_FRAME_SIZE)`. Real crop art must keep the base
of the plant on that baseline.

### UI 9-slice panel

`panel` is authored for Phaser nineslice: 96x96, corner radius 24, border 6.
Use slice margins of **32px** on all sides
(`this.add.nineslice(x, y, 'atlas', 'panel', w, h, 32, 32, 32, 32)`).

## Palette / scale rules

- Style: isometric 2D, soft chunky readable shapes, saturated-but-gentle
  colors. No outlines; shapes read by value contrast.
- Author at 1x against the 1080x1920 portrait design resolution (no @2x
  variants; Phaser scales the whole canvas via Scale.FIT).
- Key placeholder colors: grass `#7CC15C`, dirt `#9E714A`, sunwheat gold
  `#F2C64A`, carrot orange `#EE7A2A`, glowberry violet `#9E8AFF`, coin gold
  `#F4C448`, panel cream `#FCF2D6` with brown border `#8B623C`.
- "Ready" (stage 2) crops must read as clearly more grown and brighter than
  earlier stages at a glance.

## Regenerating the placeholders

```
npm run gen:assets
```

Runs `tools/gen-assets.mjs` - pure JavaScript with **zero dependencies**
(PNG encoding uses only Node's built-in `zlib`), so it works anywhere Node
does, including CI. Drawing is seeded/deterministic: same script, same bytes.
It rewrites `assets/atlas.png` + `assets/atlas.json`; commit the result.
This is a dev-time convenience, **not** a build step - never wire it into
`npm run build`.

## Swapping in a real asset pack

1. Produce sprites at the sizes in the table above (or a uniform multiple,
   e.g. 2x everything - sizes just have to stay consistent with each other and
   with `TILE_WIDTH`/`TILE_HEIGHT` if tiles change).
2. Pack them into a Phaser-compatible atlas (TexturePacker "JSON (Hash)"
   format or equivalent) using the **same frame names**.
3. Replace `assets/atlas.png` and `assets/atlas.json`. Keep `meta.image` set
   to `atlas.png`.
4. No code changes needed. If tile or crop canvas sizes change, update
   `TILE_WIDTH`/`TILE_HEIGHT` (`src/systems/iso.ts`) and
   `CROP_FRAME_SIZE`/`CROP_BASELINE_Y` (`src/data/crops.ts`) to match.
