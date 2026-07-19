# Authored building-shadow workflow (T3.29)

How to give a major building a hand-authored ground shadow. Small decor keeps the
procedural generated shadow (`generateCastShadow` in `tools/pack-atlas.mjs`); this
workflow is for buildings where that generic cast is not good enough (the
farmhouse is the reference implementation - do not redesign it).

The design in one line: **one PNG plus one JSON per authored shadow, the JSON is
the single source of truth, and the runtime placement is generated from it** so
values can never drift.

## Files per authored shadow

```
tools/shadow-overrides/<building>_shadow.png    the authored shadow (full logical canvas)
tools/shadow-overrides/<building>_shadow.json   the manifest (source of truth)
```

Generated from those manifests (do not hand-edit - `npm run shadow:gen`):

```
src/generated/shadowPlacements.ts   runtime table (SHADOW_PLACEMENT_OVERRIDES), used by the game
src/generated/shadowLab.ts          dev-only preview data, used only by ShadowLabScene
```

## The manifest

```jsonc
{
  "building": "farmhouse",
  "frame": "farmhouse_shadow",          // atlas frame this produces
  "sourceFrame": "farmhouse",           // the packed building frame it is authored against
  "variants": ["farmhouse_restored"],   // other frames that SHARE this one shadow
  "logicalWidth": 412,                  // the PNG is exactly this size
  "logicalHeight": 385,
  "sourceFrameRect": { "x": 131, "y": 24, "width": 256, "height": 256 },
  "sourceGroundPoint": { "x": 128, "y": 256 }, // ground point WITHIN the source frame
  "previewScale": 1.640625,             // dev-lab display scale (matches the game)
  "tuckRatio": 0,                       // authored shadows carry their own contact => 0
  "validation": { "minAlpha": 8, "requireSingleComponent": true, "requireUpperEdgeAboveAnchor": true }
}
```

The anchor is **derived, never stored**:

```
anchor = sourceFrameRect.position + sourceGroundPoint
       = (131 + 128, 24 + 256) = (259, 280)
```

The anchor is the building's ground point in logical-canvas pixels. At runtime the
shadow's origin is set to `anchor / logicalSize` and its position to the sprite's
ground point, so the anchor lands exactly on the building base regardless of atlas
trimming or scale. Nothing here assumes a 256x256 frame or a `+128/+256` offset -
those are just this building's numbers.

## Coordinate model

- The **logical canvas** is the full authored PNG. Phaser reconstructs it from the
  atlas trim metadata (`sourceSize` = logical, `spriteSourceSize` = trim offset),
  so the shadow can be trimmed for packing without moving the anchor.
- The **source frame rect** is where the building's own packed frame conceptually
  sits over the shadow canvas while authoring - it exists only to derive the anchor
  and to draw the registration guide.
- The shadow's **upper edge must sit above the anchor** so the building sprite
  covers it and the shadow reads as emerging from beneath the base.

## Commands

```
npm run shadow:new -- <building> [--source <frame>] [--scale N]
    Scaffold PNG + JSON + a registration guide from the ACTUAL packed source
    frame. Measures the silhouette's real alpha (never the black matte / frame
    box), proposes a canvas with room for a lower-left cast, and sets the ground
    point to the silhouette base-centre. Open <building>_shadow.registration.png
    and draw the shadow against the marked base + anchor.

npm run shadow:shift -- <building> --dx N --dy N
    Move the authored pixels inside the logical canvas losslessly (no resize /
    resample / blur, anchor unchanged). Refuses a shift that would clip.

npm run shadow:validate -- [building]
    Validate one (or all) shadows: dimensions, manifest shape, derived anchor,
    pure-black RGB, non-empty alpha, edge clipping, connected shape, upper-edge-
    above-anchor, and atlas trim consistency (if the atlas is built). Exits
    non-zero on any error.

npm run shadow:gen
    Regenerate src/generated/shadowPlacements.ts + shadowLab.ts from the
    manifests. `npm run pack:atlas` runs this automatically.

npm run shadow:capture -- <building>
    Render the shadow in the REAL Phaser ShadowLabScene (actual atlas, actual
    placeAuthoredShadow, real grass, real scale) and save normal / variant /
    base-zoom / checkerboard / anchor-overlay screenshots + the numeric
    anchorDelta to tools/shadow-debug/<building>/. Requires a chromium for
    playwright-core (`npm i -D playwright-core` and `npx playwright install
    chromium`, or set CHROME_PATH).

npm run pack:atlas
    Runs shadow:gen, then bakes the atlas. Authored overrides win; the generic
    generator stays the fallback for everything else.
```

## Dev preview route

With the dev server running (`npm run dev`), open:

```
http://localhost:5177/littleacres/?shadowlab=<building>
    &variant=<frame>   render a variant frame (e.g. farmhouse_restored)
    &overlay=1         draw the anchor overlay + logical-canvas outline
    &bg=checker        checkerboard background instead of grass
    &zoom=<n>          camera zoom
```

`ShadowLabScene` is dev-only (`import.meta.env.DEV` gated in `src/main.ts`) and
tree-shakes out of production builds. It uses the same `placeAuthoredShadow()`
code as the game, so the preview cannot diverge from the real render.

## Step-by-step for a new building

1. Pack the building's own art so its source frame exists in the atlas.
2. `npm run shadow:new -- <building>` and open the registration guide.
3. Draw the shadow into `<building>_shadow.png` (pure black, authored alpha). A
   simple, soft, slightly-irregular ground shape angled lower-left reads best -
   do not project every roof/chimney/post detail. Extrude the building's actual
   ground footprint, not the full sprite-frame width.
4. `npm run shadow:validate -- <building>` until it passes.
5. `npm run pack:atlas` (regenerates the placement table and bakes the atlas).
6. `npm run shadow:capture -- <building>` and **eyeball base-zoom.png** - a zero
   `anchorDelta` is necessary but NOT sufficient; the shadow must also read as
   grounded. Check the `variant` capture too if the building shares its shadow.
7. Add / update a test if the building needs pinned metadata (see
   `src/systems/authoredShadow.test.ts`).

## Rules

- The JSON manifest is the source of truth; never duplicate anchor values into
  TypeScript by hand (they are generated).
- Do not apply a runtime offset to fix artwork that is internally misplaced - fix
  the pixels (`shadow:shift` or redraw), keep the anchor derived.
- Do not change `SHADOW_TUCK_RATIO`, `SHADOW_CANVAS_PAD`, or the generic decor
  shadows; authored buildings use `tuckRatio: 0` and their own contact geometry.
- Approval requires a REAL Phaser image (`shadow:capture` / the lab route). Never
  approve from an offline Python/PIL/Jimp composite or from `anchorDelta` alone.
