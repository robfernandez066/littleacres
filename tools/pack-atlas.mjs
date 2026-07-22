#!/usr/bin/env node
/**
 * Real-art atlas packer for Little Acres.
 *
 * Reads the staged source PNGs in `tools/art-staging/` (512px masters,
 * gitignored), normalizes each into its runtime frame, shelf-packs them, and
 * writes:
 *
 *   assets/atlas.png   - the packed texture atlas
 *   assets/atlas.json  - Phaser 3 "JSON hash" atlas data
 *
 * The packed files are committed to the repo; this script is a dev-time
 * convenience (`npm run pack:atlas`), never a build step. It replaces the
 * retired placeholder generator (tools/gen-assets.mjs). See ASSETS.md.
 *
 * Frame conventions enforced here (keep in sync with src/config.ts and
 * src/data/crops.ts):
 *
 * - Tiles (grass, plot, plot_occupied): 256x160 frame. The art has raised
 *   lips/fringes and is drawn at a steeper angle than 2:1, so the source is
 *   trimmed and scaled NON-uniformly so the diamond TOP FACE spans 256x128
 *   with the diamond's center at (128, 64) (TILE_DIAMOND_CENTER_Y); the lip
 *   hangs below into the extra 32 rows. The diamond's left/right corners are
 *   assumed to be the widest opaque points (they mark the face's vertical
 *   center) and its top corner the topmost opaque row.
 * - grass_flat (T2.28a): derived from grass.png (not its own staged file),
 *   same 256x160/256x128 diamond geometry - a flat-fill variant with the
 *   scalloped/torn-edge fringe and lip removed (mirrored top-face + deep-
 *   interior sample + a synthetic diamond alpha mask), for the 'tiles_flat'
 *   ground mode. See processTileFlat.
 * - gravel_path (T4.12): a player-painted path tile - trimmed and resized
 *   non-uniformly onto the exact 256x128 tile diamond (no lip band), so
 *   painted tiles butt flush on the iso grid. See PATH_TILE_NAMES.
 * - Crops (21): trimmed, scaled to a per-stage height target (stage 2 = 100%
 *   of the max legal height, stage 1 = 78%, stage 0 = 55% - a glance must
 *   read small -> medium -> full), width still capped at 128, placed on a
 *   128x128 frame horizontally centered (bbox center at x = 64) with the
 *   lowest opaque row on CROP_BASELINE_Y + CROP_SINK - the sprite sinks a
 *   little below the anchored baseline so the mound's visual middle sits on
 *   the diamond center, hugging the tile. Width-limited sprites that miss
 *   their height target are logged.
 * - chest_closed, chest_open: crop treatment with no growth stage - a single
 *   static object placed at the full (stage-2-equivalent) height target.
 * - coin, moondust, bag, scroll, note, pouch, goals, sunflour: trimmed, fit
 *   into 96x96, centered. `pouch` is packed as a reserved frame - unused in
 *   code today. `sunflour` is the first processed-good icon (T4.0).
 * - sign: trimmed, fit into 192x192, centered.
 * - hud_crest, gear_icon, button_push, button_slot, button_close (staged as
 *   xbutton), mere (staged as mere_strip), notice_board, farmhouse,
 *   flour_mill, dirt_path: trimmed, fit into a square frame
 *   (192/128/256/256/96/384/256/256/256/288), centered - same treatment as the
 *   icons above. `flour_mill` is the first BUILDING (T4.1) - structure-class
 *   art, sized and shadowed exactly like `farmhouse`.
 * - farmhouse_restored (T3.25): the restoration-upgrade farmhouse. It gets its
 *   own processor because its frame is sized AGAINST the packed `farmhouse`
 *   frame rather than to a fixed square, so the restored building renders at
 *   exactly the same on-screen size and base position as the current one and
 *   only the moon sits higher - see processRestoredFarmhouse for the
 *   derivation. Deliberately absent from SHADOWED_FRAME_NAMES: it reuses
 *   `farmhouse_shadow` unchanged. (T3.25-fix: the first staged source was
 *   opaque "fake transparency" and needed a background key-out here; the
 *   shipping source has real alpha, so the packer does no keying.)
 * - hud_banner, xpbar_frame, xpbar_fill: trimmed, scaled to a fixed 512px
 *   width keeping aspect - no fixed square frame.
 * - panel: 128x128 nine-slice source. The border thickness and corner
 *   radius are measured in packed pixels and a safe slice margin is logged -
 *   PANEL_SLICE in src/config.ts must match it.
 * - plot (T2.21 fix): after the shared tile transform, plot's opaque
 *   footprint is re-cropped and rescaled onto plot_occupied's measured
 *   footprint so the two tiles line up flush in a mixed field. Before/after
 *   extents are logged.
 * - tuft_1, tuft_2, dirt_wisp (T2.28): decals, same trim-fit-center square
 *   treatment as the icons above, at 96x96.
 * - stones_1 (T2.28): a decal cluster, same treatment, at 128x128.
 * - stone_a, stone_b, stone_c, and stone_d if staged (T2.28): single-rock
 *   decals, same treatment, at 64x64. Packed conditionally - only whichever
 *   of these are actually staged - and the resulting count is logged.
 * - decor_bench, decor_flowerbed, decor_fence, decor_barrels, decor_scarecrow,
 *   decor_birdbath, decor_well, decor_mushrooms, decor_gnome, decor_lantern
 *   (T3.9): purchasable decorations, same trim-fit-center square treatment as
 *   the icons above, at 128x128.
 * - trophy_goldscarecrow, trophy_moonwell, trophy_traderscart (T3.9): same
 *   square treatment at 128x128. trophy_starbanner at 192x192,
 *   trophy_ancientoak at 256x256 - both taller/more detailed art that reads
 *   too small at 128.
 * - <frame>_shadow companions (T3.3s-r2d): NOT staged - generated directly
 *   by this script (see generateCastShadow) for every SHADOWED_FRAME_NAMES
 *   entry (all decor except decor_fence, T3.art-3, + trophies, farmhouse,
 *   notice_board, sign): a soft
 *   directional cast shadow derived from the packed frame's own alpha mask
 *   (sun fixed at TOP-RIGHT, shadow falls LOWER-LEFT), squashed, sheared,
 *   blurred, and alpha-baked pure black, then trimmed and packed with
 *   proper trim metadata (spriteSourceSize/sourceSize) so the runtime can
 *   align the un-sheared base edge under its object without per-frame
 *   tables. Replaces the retired generated ground_shadow ellipse (T3.9 -
 *   removed from the pack in T3.3s-r2d) and the T3.3s-r2c runtime mirror
 *   silhouettes.
 *
 * Layout is deterministic (fixed frame list, sorted packing order, fixed
 * shelf width), so reruns are byte-stable given identical inputs. Staged
 * files that are not part of the frame list (the app icon, packed
 * separately by tools/pack-icons.mjs) are ignored with a console note.
 *
 * T2.28 also writes two STANDALONE ground-texture images (not atlas frames -
 * TileSprites need clean repeat bounds with no packed-frame padding):
 * `assets/grass_texture_a.png` and `assets/grass_texture_b.png`. The staged
 * 512x512 masters carry large transparent gutters (only a narrow vertical
 * strip is opaque - confirmed by measurement, not assumption), so each is
 * trimmed to its own opaque bounds and written out directly, same
 * "committed, regenerated by this script" contract as the atlas.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Jimp } from 'jimp';

import { buildPackedOverride, readManifest, validateAuthoredImage } from './shadow-lib.mjs';

// ---------------------------------------------------------------------------
// Frame conventions (keep in sync with src/config.ts and src/data/crops.ts)
// ---------------------------------------------------------------------------

const TILE_FRAME_WIDTH = 256; // config.ts TILE_FRAME_WIDTH
const TILE_FRAME_HEIGHT = 160; // config.ts TILE_FRAME_HEIGHT
const TILE_DIAMOND_WIDTH = 256; // iso.ts TILE_WIDTH
const TILE_DIAMOND_HEIGHT = 128; // iso.ts TILE_HEIGHT

const CROP_FRAME_SIZE = 128; // crops.ts CROP_FRAME_SIZE
const CROP_BASELINE_Y = 104; // crops.ts CROP_BASELINE_Y
const CROP_SINK = 14; // crops.ts CROP_SINK
const CROP_FIT_WIDTH = 128;
/** Max legal crop height: bottom row pinned at CROP_BASELINE_Y + CROP_SINK. */
const CROP_MAX_HEIGHT = CROP_BASELINE_Y + CROP_SINK;
/** Per-stage height targets as fractions of CROP_MAX_HEIGHT (small -> medium -> full). */
const CROP_STAGE_HEIGHT_FRACTIONS = [0.55, 0.78, 1.0];

const ICON_SIZE = 96;
const SIGN_SIZE = 192;
const PANEL_SIZE = 128;

/** Alpha above this counts as opaque when trimming / measuring. */
const ALPHA_THRESHOLD = 8;
/** RGB distance above this reads as "a different color" when measuring the panel border. */
const COLOR_DISTANCE_THRESHOLD = 60;
/** Safety padding added to the measured panel slice. */
const PANEL_SLICE_SAFETY = 3;

const ATLAS_MAX_WIDTH = 1040;
const PAD = 2; // transparent padding between packed frames

const TILE_NAMES = ['grass', 'plot', 'plot_occupied'];
/**
 * `grass_flat` (T2.28a): derived from the SAME staged `grass.png` master (see
 * SOURCE_FILE_OVERRIDES below), not its own staged file - a flat-fill variant
 * with the scalloped/torn-edge fringe and the asymmetric lip removed, for the
 * 'tiles_flat' ground mode (see processTileFlat).
 */
const DERIVED_TILE_NAMES = ['grass_flat'];
/**
 * Player-painted path tiles (T4.12). These must tile GAPLESSLY on the frozen
 * iso grid, so they get their own processor instead of the `grass`/`plot`
 * one: the staged masters are bare 512x256 diamonds with no raised lip and no
 * scalloped fringe (measured - `gravel_path`'s opaque bounds fill its master
 * edge to edge), so a path frame is EXACTLY the 256x128 tile diamond - no
 * 160px lip band, no centering slack - and the runtime draws it at origin
 * (0.5, 0.5) straight on `gridToIso`'s tile center. Trimming and then
 * resizing NON-uniformly onto the diamond's exact size is what guarantees
 * adjacent painted tiles butt flush. Only `gravel_path` ships in v1; the
 * staged stone/moonstone masters stay unpacked until their tiers land.
 */
const PATH_TILE_NAMES = ['gravel_path'];
/**
 * processTileFlat's deep-interior sample size, as a fraction of the trimmed
 * source's width/height, centered - stays comfortably clear of the measured
 * scalloped-edge fringe (~12px of the ~466px-wide staged master; logged at
 * pack time) while still capturing enough of the blade-texture detail to
 * read as grass rather than a flat color. Chosen by rendering tiled
 * composites at 0.25/0.35/0.45/0.55 and comparing texture repetition
 * against edge cleanliness (0.25 read as an overly repetitive small motif,
 * 0.55 started reintroducing fringe artifacts at the sample's own corners) -
 * same search-and-visually-compare method as DIRT_PATH_POSITION/tileScale in
 * ASSETS.md.
 */
const TILE_FLAT_SAMPLE_FRACTION = 0.35;
/** How many consecutive px of alpha>=254 counts as "past the fringe" in measureFringeDepth. */
const FRINGE_HOLD_PX = 8;
const CROP_NAMES = [
  'sunwheat_0',
  'sunwheat_1',
  'sunwheat_2',
  'starcorn_0',
  'starcorn_1',
  'starcorn_2',
  'glowberry_0',
  'glowberry_1',
  'glowberry_2',
  'moonroot_0',
  'moonroot_1',
  'moonroot_2',
  'emberpepper_0',
  'emberpepper_1',
  'emberpepper_2',
  'dewmelon_0',
  'dewmelon_1',
  'dewmelon_2',
  'sagesprig_0',
  'sagesprig_1',
  'sagesprig_2',
];
const ICON_NAMES = [
  'coin',
  'moondust',
  'bag',
  'scroll',
  'note',
  'pouch',
  'goals',
  'sunflour',
  // T4.4: bread is a GOOD, packed as a 96px icon exactly like sunflour.
  'bread',
];
const SIGN_NAMES = ['sign'];
/** Single static objects that sit on a tile like a crop, but have no growth stages. */
const CHEST_NAMES = ['chest_closed', 'chest_open'];
/** Decals (T2.28; v2 tufts added 2026-07-12): trim-fit-center square like the icons above, at 96x96. */
const DECAL_NAMES = ['tuft_1', 'tuft_2', 'tuft_1v2', 'tuft_2v2', 'dirt_wisp', 'grass_1'];
const DECAL_SIZE = 96;
/** Decal rock cluster (T2.28), same treatment, at 128x128. */
const STONE_CLUSTER_NAMES = ['stones_1'];
const STONE_CLUSTER_SIZE = 128;
/** Single-rock decal candidates (T2.28): packed conditionally, only whichever are staged. */
const STONE_SINGLE_CANDIDATES = ['stone_a', 'stone_b', 'stone_c', 'stone_d'];
const STONE_SINGLE_SIZE = 64;
/** Ground textures (T2.28): NOT atlas frames - trimmed and written as standalone PNGs, see below. */
const GROUND_TEXTURE_NAMES = ['grass_texture_a', 'grass_texture_b'];
/** Square "plain downscale": trim, fit to `size`, center - same treatment as processIcon. */
const SQUARE_DOWNSCALE_SIZES = {
  hud_crest: 192,
  gear_icon: 128,
  button_push: 256,
  button_slot: 256,
  button_close: 96,
  mere: 384,
  notice_board: 256,
  farmhouse: 256,
  // T4.1: the flour mill is a BUILDING - structure-class art, packed exactly
  // like the farmhouse (same 512x512 staged source, same 256 square), never
  // a 96x96 icon.
  flour_mill: 256,
  // T4.4: the bakery is a BUILDING, packed on the same structure-class path
  // as the mill and farmhouse - a 256 square, never a 96 icon.
  bakery: 256,
  dirt_path: 288,
  decor_bench: 128,
  decor_flowerbed: 128,
  decor_fence: 128,
  decor_barrels: 128,
  decor_scarecrow: 128,
  decor_birdbath: 128,
  decor_well: 128,
  decor_mushrooms: 128,
  decor_gnome: 128,
  decor_lantern: 128,
  trophy_goldscarecrow: 128,
  trophy_starbanner: 192,
  trophy_moonwell: 128,
  trophy_traderscart: 128,
  trophy_ancientoak: 256,
};
/** Wide "plain downscale, keep aspect": trim, scale to a fixed width, no fixed frame. */
const WIDE_DOWNSCALE_WIDTHS = {
  hud_banner: 512,
  xpbar_frame: 512,
  xpbar_fill: 512,
};
/** Frame name -> staged source filename, for frames whose art was staged under a different name. */
const SOURCE_FILE_OVERRIDES = {
  button_close: 'xbutton',
  mere: 'mere_strip',
  grass_flat: 'grass',
};

/**
 * Restoration farmhouse (T3.25) - sized against the packed `farmhouse` frame,
 * so it is neither a square nor a wide downscale. See
 * processRestoredFarmhouse.
 */
const RESTORED_FARMHOUSE_NAME = 'farmhouse_restored';
function sourceFileFor(name) {
  return SOURCE_FILE_OVERRIDES[name] ?? name;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stagingDir = join(repoRoot, 'tools', 'art-staging');
const assetsDir = join(repoRoot, 'assets');
// Authored-shadow overrides (T3.28): a `<name>_shadow.png` + `<name>_shadow.json`
// here replaces the generic generateCastShadow output for that frame.
const shadowOverrideDir = join(repoRoot, 'tools', 'shadow-overrides');

// Only pack whichever single-rock decals are actually staged (T2.28: "possibly stone_d").
const stagedStoneSingleNames = STONE_SINGLE_CANDIDATES.filter((name) =>
  existsSync(join(stagingDir, `${name}.png`)),
);
console.log(
  `note: packing ${stagedStoneSingleNames.length} single-rock decal(s): ${stagedStoneSingleNames.join(', ')}`,
);

const FRAME_NAMES = [
  ...TILE_NAMES,
  ...DERIVED_TILE_NAMES,
  ...PATH_TILE_NAMES,
  ...CROP_NAMES,
  ...ICON_NAMES,
  ...SIGN_NAMES,
  ...CHEST_NAMES,
  ...DECAL_NAMES,
  ...STONE_CLUSTER_NAMES,
  ...stagedStoneSingleNames,
  ...Object.keys(SQUARE_DOWNSCALE_SIZES),
  ...Object.keys(WIDE_DOWNSCALE_WIDTHS),
  RESTORED_FARMHOUSE_NAME,
  'panel',
];

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------

const fmtBounds = (b) => `x=${b.x} y=${b.y} w=${b.w} h=${b.h}`;

/**
 * Bounding box of pixels with alpha above `threshold`, or null if none.
 * `threshold` defaults to ALPHA_THRESHOLD (barely-there pixels count). Pass
 * SOLID_ALPHA_THRESHOLD to measure a SOLID silhouette instead, ignoring soft
 * glow - see its comment.
 */
function opaqueBounds(image, threshold = ALPHA_THRESHOLD) {
  const { width, height, data } = image.bitmap;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Trim transparent margins in place; throws on a fully transparent image. */
function trim(image, name) {
  const bounds = opaqueBounds(image);
  if (bounds === null) throw new Error(`${name}: image is fully transparent`);
  return image.crop(bounds);
}

/** A transparent RGBA canvas. */
function blankFrame(width, height) {
  return new Jimp({ width, height });
}

/** [r, g, b] at (x, y). */
function rgbAt(image, x, y) {
  const i = (y * image.bitmap.width + x) * 4;
  const d = image.bitmap.data;
  return [d[i], d[i + 1], d[i + 2]];
}

function alphaAt(image, x, y) {
  return image.bitmap.data[(y * image.bitmap.width + x) * 4 + 3];
}

/** [r, g, b, a] at (x, y). */
function rgbaAt(image, x, y) {
  const i = (y * image.bitmap.width + x) * 4;
  const d = image.bitmap.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

/** Write [r, g, b, a] at (x, y) in place. */
function setPixel(image, x, y, rgba) {
  const i = (y * image.bitmap.width + x) * 4;
  image.bitmap.data[i] = rgba[0];
  image.bitmap.data[i + 1] = rgba[1];
  image.bitmap.data[i + 2] = rgba[2];
  image.bitmap.data[i + 3] = rgba[3];
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---------------------------------------------------------------------------
// Per-kind processing (each returns the final frame-sized Jimp image)
// ---------------------------------------------------------------------------

/**
 * First row of the widest opaque span - the diamond's left/right corners,
 * i.e. the vertical center of the diamond's top face. The lip's vertical
 * sides keep the max width over a run of rows below the corners, so the
 * run's FIRST row is the true corner row.
 */
function diamondCornerRow(image) {
  const { width, height } = image.bitmap;
  let maxWidth = -1;
  let first = 0;
  for (let y = 0; y < height; y++) {
    let x0 = 0;
    while (x0 < width && alphaAt(image, x0, y) <= ALPHA_THRESHOLD) x0++;
    let x1 = width - 1;
    while (x1 >= 0 && alphaAt(image, x1, y) <= ALPHA_THRESHOLD) x1--;
    const rowWidth = x1 - x0 + 1;
    if (rowWidth > maxWidth) {
      maxWidth = rowWidth;
      first = y;
    }
  }
  return first;
}

/**
 * Tile: the source diamond is steeper than 2:1, so scale x and y
 * independently - x so the widest span (the diamond's left/right corners)
 * becomes exactly TILE_DIAMOND_WIDTH, y so the top face's half-height (top
 * corner row 0 down to the corner row) becomes TILE_DIAMOND_HEIGHT / 2. The
 * topmost row anchors at y = 0, landing the diamond center at
 * (TILE_FRAME_WIDTH / 2, TILE_DIAMOND_CENTER_Y) with the lip hanging below.
 */
function processTileBase(image, name) {
  trim(image, name);
  const cornerRow = diamondCornerRow(image);
  const scaleY = TILE_DIAMOND_HEIGHT / 2 / cornerRow;
  const w = TILE_DIAMOND_WIDTH;
  const h = Math.round(image.bitmap.height * scaleY);
  image.resize({ w, h });
  if (h > TILE_FRAME_HEIGHT) {
    console.warn(
      `note: ${name}: scaled height ${h} exceeds the ${TILE_FRAME_HEIGHT} frame; ` +
        `bottom ${h - TILE_FRAME_HEIGHT}px of lip cropped`,
    );
  }
  const frame = blankFrame(TILE_FRAME_WIDTH, TILE_FRAME_HEIGHT);
  frame.composite(image, Math.round((TILE_FRAME_WIDTH - w) / 2), 0);
  return frame;
}

function processTile(image, name) {
  return processTileBase(image, name);
}

/**
 * Path tile (T4.12): trim, then resize NON-uniformly onto the exact
 * 256x128 tile diamond - see PATH_TILE_NAMES for why this is its own
 * processor rather than the lipped `processTile`.
 */
function processPathTile(image, name) {
  trim(image, name);
  image.resize({ w: TILE_DIAMOND_WIDTH, h: TILE_DIAMOND_HEIGHT });
  return image;
}

/**
 * How many px inward from the opaque boundary, at row `y`, until alpha stays
 * >= 254 for the next FRINGE_HOLD_PX pixels - i.e. past the scalloped/
 * torn-edge fringe (which repeatedly dips back toward transparent as it
 * ripples) into the solid interior fill. Returns the deeper of the left/right
 * measurements at that row.
 */
function measureFringeDepthAtRow(image, y) {
  const { width } = image.bitmap;
  let x0 = 0;
  while (x0 < width && alphaAt(image, x0, y) <= ALPHA_THRESHOLD) x0++;
  let x1 = width - 1;
  while (x1 >= 0 && alphaAt(image, x1, y) <= ALPHA_THRESHOLD) x1--;
  const scan = (from, dir) => {
    let x = from;
    let depth = 0;
    while (x >= 0 && x < width && depth < x1 - x0) {
      let allOpaque = true;
      for (let k = 0; k < FRINGE_HOLD_PX; k++) {
        const xi = x + dir * k;
        if (xi < 0 || xi >= width || alphaAt(image, xi, y) < 254) {
          allOpaque = false;
          break;
        }
      }
      if (allOpaque) return depth;
      x += dir;
      depth++;
    }
    return depth;
  };
  return Math.max(scan(x0, 1), scan(x1, -1));
}

/** Max fringe depth (see measureFringeDepthAtRow) sampled across the whole trimmed image. */
function measureFringeDepth(image) {
  const { height } = image.bitmap;
  let max = 0;
  for (let y = 4; y < height - 4; y += 15) {
    max = Math.max(max, measureFringeDepthAtRow(image, y));
  }
  return max;
}

/**
 * Stamp a mathematically exact rhombus alpha mask over a `w` x `h` image
 * (Manhattan/L1 distance from center, normalized to the half-extents), with a
 * 1px feather at the boundary for smooth (not jagged) anti-aliasing. Used by
 * processTileFlat so grass_flat's edges are a straight diamond instead of the
 * source's scalloped silhouette - the reason adjacent flat tiles butt flush.
 */
function maskToDiamond(image, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const feather = 0.02;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x - cx) / cx + Math.abs(y - cy) / cy;
      const rgba = rgbaAt(image, x, y);
      let alpha;
      if (d <= 1 - feather) alpha = 255;
      else if (d >= 1 + feather) alpha = 0;
      else alpha = Math.round((255 * (1 + feather - d)) / (2 * feather));
      setPixel(image, x, y, [rgba[0], rgba[1], rgba[2], alpha]);
    }
  }
  return image;
}

/**
 * grass_flat (T2.28a): a flat-fill variant of `grass` for the 'tiles_flat'
 * ground mode, derived from the same staged grass.png master. `grass`'s
 * scalloped/torn-edge fringe (measured ~12px deep on the ~466px-wide staged
 * master, logged below) creates visible grid lines when tiled edge to edge -
 * insetting toward it only zooms into the same scallop pattern (amplifying
 * it), so this instead: (1) mirrors the top half (tip -> corner) onto the
 * bottom half, discarding the source's own asymmetric hanging lip entirely;
 * (2) crops a TILE_FLAT_SAMPLE_FRACTION-sized sample from deep in the
 * interior (well clear of the fringe on every side) and stretches it to fill
 * the diamond bounding box, decoupling the flat fill texture from the
 * source's own jagged silhouette; (3) stamps a synthetic, mathematically
 * exact rhombus alpha mask over it (maskToDiamond) instead of keeping the
 * source's alpha. Same TILE_DIAMOND_WIDTH x TILE_DIAMOND_HEIGHT diamond
 * geometry as `grass`, so `tiles_flat` mode reuses `layGrassField`'s grid
 * math unchanged - only the frame name differs.
 */
function processTileFlat(image, name) {
  trim(image, name);
  const cornerRow = diamondCornerRow(image);
  const nativeWidth = image.bitmap.width;
  const fringeDepth = measureFringeDepth(image);

  const topHalf = image.clone().crop({ x: 0, y: 0, w: nativeWidth, h: cornerRow + 1 });
  const bottomHalf = topHalf.clone().flip({ vertical: true });
  const symH = cornerRow * 2 + 1;
  const symmetric = blankFrame(nativeWidth, symH);
  symmetric.composite(topHalf, 0, 0);
  symmetric.composite(bottomHalf, 0, cornerRow);

  const sampleW = Math.round(nativeWidth * TILE_FLAT_SAMPLE_FRACTION);
  const sampleH = Math.round(symH * TILE_FLAT_SAMPLE_FRACTION);
  const sample = symmetric.crop({
    x: Math.round((nativeWidth - sampleW) / 2),
    y: Math.round((symH - sampleH) / 2),
    w: sampleW,
    h: sampleH,
  });
  sample.resize({ w: TILE_DIAMOND_WIDTH, h: TILE_DIAMOND_HEIGHT });
  maskToDiamond(sample, TILE_DIAMOND_WIDTH, TILE_DIAMOND_HEIGHT);

  console.log(
    `${name}: measured fringe depth ${fringeDepth}px (native); sample ${sampleW}x${sampleH} ` +
      `(${Math.round(TILE_FLAT_SAMPLE_FRACTION * 100)}% of ${nativeWidth}x${symH}) clears it`,
  );

  const frame = blankFrame(TILE_FRAME_WIDTH, TILE_FRAME_HEIGHT);
  frame.composite(sample, 0, 0);
  return frame;
}

/**
 * T2.21 art-bug fix: `plot`'s base-transformed footprint doesn't land on the
 * same opaque bounding box as `plot_occupied`, so it visibly sticks out past
 * the grid diamond. Re-crop the base-transformed frame to its own opaque
 * bounds, rescale that crop (independently per axis) onto plot_occupied's
 * measured bounds, and composite at the same offset - this pins `plot`'s
 * footprint to `plot_occupied`'s within a pixel or two.
 */
function processPlotFootprintFix(image, name, targetBounds) {
  const base = processTileBase(image, name);
  const before = opaqueBounds(base);
  if (before === null) throw new Error(`${name}: image is fully transparent after base transform`);
  const cropped = base.crop(before);
  cropped.resize({ w: targetBounds.w, h: targetBounds.h });
  const frame = blankFrame(TILE_FRAME_WIDTH, TILE_FRAME_HEIGHT);
  frame.composite(cropped, targetBounds.x, targetBounds.y);
  return { frame, before };
}

/**
 * Crop sprite: scale the trimmed art to its growth stage's height target
 * (width capped at CROP_FIT_WIDTH), center horizontally (bbox center at
 * x = 64), and bottom-pin the lowest opaque row at CROP_BASELINE_Y +
 * CROP_SINK - sunk below the anchored baseline so the mound's middle sits
 * on the diamond center. Logs any sprite the width cap keeps short of its
 * height target.
 */
/** Shared crop-frame placement: fit trimmed image to `targetH` (width capped at
 * CROP_FIT_WIDTH), center at x = 64, bottom-pin the lowest opaque row at
 * CROP_BASELINE_Y + CROP_SINK. */
function placeOnCropFrame(image, name, targetH) {
  const scale = Math.min(CROP_FIT_WIDTH / image.bitmap.width, targetH / image.bitmap.height);
  const w = Math.max(1, Math.round(image.bitmap.width * scale));
  const h = Math.max(1, Math.round(image.bitmap.height * scale));
  if (h < targetH) {
    console.warn(`note: ${name}: width-limited fit - height ${h}px misses its ${targetH}px target`);
  }
  image.resize({ w, h });
  const frame = blankFrame(CROP_FRAME_SIZE, CROP_FRAME_SIZE);
  frame.composite(
    image,
    Math.round((CROP_FRAME_SIZE - w) / 2),
    CROP_BASELINE_Y + CROP_SINK - h + 1,
  );
  return frame;
}

function processCrop(image, name) {
  trim(image, name);
  const stage = Number(name.at(-1));
  const targetH = Math.round(CROP_MAX_HEIGHT * CROP_STAGE_HEIGHT_FRACTIONS[stage]);
  return placeOnCropFrame(image, name, targetH);
}

/** Chest: a single static object (no growth stages) that sits on a tile like a
 * full-size crop - same baseline convention, full (stage-2-equivalent) height target. */
function processChest(image, name) {
  trim(image, name);
  return placeOnCropFrame(image, name, CROP_MAX_HEIGHT);
}

/** Icon: trim and fit into a `size` x `size` square, centered. */
function processIcon(image, name, size) {
  trim(image, name);
  const scale = Math.min(size / image.bitmap.width, size / image.bitmap.height);
  const w = Math.max(1, Math.round(image.bitmap.width * scale));
  const h = Math.max(1, Math.round(image.bitmap.height * scale));
  image.resize({ w, h });
  const frame = blankFrame(size, size);
  frame.composite(image, Math.round((size - w) / 2), Math.round((size - h) / 2));
  return frame;
}

/**
 * Bounding boxes of 8-connected opaque components, largest (by pixel count)
 * first. Used to isolate the restored farmhouse's BUILDING from its detached
 * floating moon (T3.25).
 */
/**
 * "Solid pixel" cutoff (T3.25). ALPHA_THRESHOLD (8) asks "is anything here at
 * all", which is right for trimming but wrong for MEASURING a building whose
 * art carries soft lantern/moon glow: the glow's faint tail would stretch the
 * bbox and, since that bbox is what the restored farmhouse is scaled by, would
 * silently render the building too small. Half alpha is the silhouette.
 */
const SOLID_ALPHA_THRESHOLD = 127;

function opaqueComponents(image, threshold = ALPHA_THRESHOLD) {
  const { width, height } = image.bitmap;
  const label = new Int32Array(width * height).fill(-1);
  const components = [];
  for (let seed = 0; seed < width * height; seed++) {
    if (label[seed] !== -1) continue;
    const seedX = seed % width;
    const seedY = (seed - seedX) / width;
    if (alphaAt(image, seedX, seedY) <= threshold) continue;
    const id = components.length;
    const stack = [seed];
    label[seed] = id;
    let count = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    while (stack.length > 0) {
      const p = stack.pop();
      const x = p % width;
      const y = (p - x) / width;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of NEIGHBOR_OFFSETS_8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (label[q] !== -1) continue;
        if (alphaAt(image, nx, ny) <= threshold) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    components.push({ count, bounds: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
  }
  components.sort((a, b) => b.count - a.count);
  return components;
}

const NEIGHBOR_OFFSETS_8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Restored farmhouse (T3.25) - THE frame that makes the restoration a pure
 * art swap. The frame is built so the bottom `refSize`-tall band is
 * coordinate-identical to the packed `farmhouse` frame and the moon simply
 * pokes out above it. FarmScene then renders the restored frame at the SAME
 * scale as the current one, offset upward by half the extra height, which
 * leaves the building's on-screen size, base position, and cast shadow
 * (`farmhouse_shadow`, reused unchanged) bit-identical.
 *
 * Derivation of the fit:
 * - WIDTH is the anchor, not height. The moon lies horizontally INSIDE the
 *   building's span in both arts, so the opaque bbox width of each is a
 *   moon-independent measure of the same building - and width is what must be
 *   preserved anyway, since the farmhouse stands on a fixed 2x2 iso footprint.
 *   (Matching height instead would be moon-contaminated on the current art,
 *   whose small moon touches the chimney and so cannot be split off by
 *   component.) The two arts' building aspect ratios differ by a few percent,
 *   so the restored building lands very slightly shorter than the current one
 *   at equal width; the logged numbers report the exact delta.
 * - The restored BUILDING is the largest opaque component (its moon is
 *   detached); scale = ref bbox width / building width.
 * - The scaled art is placed so the building's bbox center-x and BOTTOM row
 *   coincide with the reference bbox's, then the canvas grows upward by
 *   whatever the moon overhangs.
 */
function processRestoredFarmhouse(image, name, ref) {
  const rawBuilding = opaqueComponents(image, SOLID_ALPHA_THRESHOLD)[0];
  if (rawBuilding === undefined) throw new Error(`${name}: no opaque content after key-out`);
  const scale = ref.bounds.w / rawBuilding.bounds.w;
  const rawWidth = image.bitmap.width;
  const rawHeight = image.bitmap.height;
  image.resize({
    w: Math.max(1, Math.round(rawWidth * scale)),
    h: Math.max(1, Math.round(rawHeight * scale)),
  });
  // Map the building's bbox through the resize ARITHMETICALLY rather than
  // re-running component detection on the scaled image: at this downscale the
  // moon's antialiased edge bridges the gap to the roof, so the scaled art is
  // a single component and a re-measure would silently return building+moon.
  const sx = image.bitmap.width / rawWidth;
  const sy = image.bitmap.height / rawHeight;
  const building = {
    x: rawBuilding.bounds.x * sx,
    y: rawBuilding.bounds.y * sy,
    w: rawBuilding.bounds.w * sx,
    h: rawBuilding.bounds.h * sy,
  };
  const content = opaqueBounds(image);
  const refCenterX = ref.bounds.x + ref.bounds.w / 2;
  const refBottomY = ref.bounds.y + ref.bounds.h - 1;
  // Offsets that map the scaled art onto the reference frame's coordinates.
  const dx = Math.round(refCenterX - (building.x + building.w / 2));
  const dy = Math.round(refBottomY - (building.y + building.h - 1));
  const overhang = Math.max(0, -(content.y + dy));
  const frameHeight = ref.size + overhang;
  const frame = blankFrame(ref.size, frameHeight);
  frame.composite(image, dx, dy + overhang);
  const left = content.x + dx;
  const right = content.x + content.w + dx;
  if (left < 0 || right > ref.size) {
    console.warn(
      `note: ${name}: content spans x ${left}..${right} - clipped by the ${ref.size}px frame width`,
    );
  }
  console.log(
    `${name}: building ${rawBuilding.bounds.w}x${rawBuilding.bounds.h} raw -> ` +
      `${building.w.toFixed(1)}x${building.h.toFixed(1)} packed (scale ${scale.toFixed(4)}); ` +
      `reference farmhouse bbox ${fmtBounds(ref.bounds)} (its own small moon included, ` +
      `so only the WIDTH is a like-for-like comparison); ` +
      `placed dx=${dx} dy=${dy}, moon overhang ${overhang}px -> frame ${ref.size}x${frameHeight}`,
  );
  return frame;
}

/** Wide "plain downscale, keep aspect": trim, then scale to exactly `width`, no fixed frame. */
function processWide(image, name, width) {
  trim(image, name);
  const scale = width / image.bitmap.width;
  const h = Math.max(1, Math.round(image.bitmap.height * scale));
  image.resize({ w: width, h });
  return image;
}

/** Panel: trim and scale the nine-slice source to exactly PANEL_SIZE square. */
function processPanel(image, name) {
  trim(image, name);
  image.resize({ w: PANEL_SIZE, h: PANEL_SIZE });
  return image;
}

/**
 * Directional cast shadows (T3.3s-r2d) - the four owner-approved shape
 * numbers. Every SHADOWED_FRAME_NAMES entry gets a generated
 * `<frame>_shadow` companion built from the packed frame's own alpha mask:
 * light comes from a fixed sun at TOP-RIGHT, so the shadow emerges from
 * under the object's base and stretches to the LOWER-LEFT.
 * - SHADOW_SQUASH: the shadow's height as a fraction of the source frame's.
 * - SHADOW_SHEAR: horizontal displacement per px of distance from the base
 *   edge (the row N px from the base displaces SHADOW_SHEAR * N leftward;
 *   the base row is undisplaced).
 * - SHADOW_BLUR_PX: soft-edge blur radius (Jimp's fast `blur` - its
 *   box-blur approximation of a Gaussian; `gaussian` is an order of
 *   magnitude slower for no visible difference at this alpha).
 * - SHADOW_BAKED_ALPHA: baked into the frame's own alpha (pure black
 *   pixels) - the runtime renders the frame with no tint/alpha of its own.
 * SHADOW_BLUR_PAD is transparent canvas padding around the mask before
 * blurring, so blur never clips at an edge - config.ts SHADOW_CANVAS_PAD
 * MUST MATCH it (the runtime uses it to locate the un-sheared base edge
 * inside the trimmed frame).
 */
const SHADOW_SQUASH = 0.27;
const SHADOW_SHEAR = 0.4;
const SHADOW_BLUR_PX = 6;
const SHADOW_BAKED_ALPHA = 0.3;
const SHADOW_BLUR_PAD = SHADOW_BLUR_PX * 2;

/** Every frame that gets a generated `<frame>_shadow` companion (T3.3s-r2d):
 *  all decor + trophy frames, the two structures, the expand sign, and every
 *  building (T4.1). Crops and tiles stay shadowless, as always. decor_fence is deliberately absent
 *  (T3.art-3: fences cast no shadow, owner ruling) - FarmScene.createGroundShadow
 *  tolerates the missing companion frame. */
const SHADOWED_FRAME_NAMES = [
  'decor_bench',
  'decor_flowerbed',
  'decor_barrels',
  'decor_scarecrow',
  'decor_birdbath',
  'decor_well',
  'decor_mushrooms',
  'decor_gnome',
  'decor_lantern',
  'trophy_goldscarecrow',
  'trophy_starbanner',
  'trophy_moonwell',
  'trophy_traderscart',
  'trophy_ancientoak',
  'farmhouse',
  'notice_board',
  'sign',
  // T4.1: buildings cast shadows like the structures they render alongside.
  'flour_mill',
  // T4.4: the bakery takes the GENERIC generated shadow for now - its authored
  // override (tools/shadow-overrides/) is a separate follow-up task.
  'bakery',
];

/**
 * Generate one `<frame>_shadow` companion from a packed frame (T3.3s-r2d):
 * 1. squash the frame's alpha mask to SHADOW_SQUASH of its height;
 * 2. flip it vertically, so the object's BASE edge (the frame's bottom row)
 *    becomes the shadow's top row and the object's silhouette extends
 *    DOWNWARD from it - a shadow cast away from the top-right sun, not a
 *    straight-down reflection;
 * 3. shear: each row displaced SHADOW_SHEAR px leftward per px of distance
 *    from the base edge (base row undisplaced), on a canvas padded by
 *    SHADOW_BLUR_PAD so the next step never clips;
 * 4. blur (SHADOW_BLUR_PX) for the soft edge;
 * 5. bake: pure black, alpha multiplied by SHADOW_BAKED_ALPHA;
 * 6. trim to opaque bounds, RECORDING the trim offset and the untrimmed
 *    canvas size - packed with proper trim metadata so the runtime can
 *    reconstruct where the base edge sits (canvas layout: x
 *    [PAD][shear band][base span = source width][PAD], y [PAD][squashed
 *    mask][PAD]; the base row spans the rightmost source-width columns).
 * Deterministic like every other frame.
 */
function generateCastShadow(frameImage, name) {
  const srcW = frameImage.bitmap.width;
  const srcH = frameImage.bitmap.height;
  const squashH = Math.max(1, Math.round(srcH * SHADOW_SQUASH));
  const squashed = frameImage.clone().resize({ w: srcW, h: squashH });
  squashed.flip({ vertical: true });
  const maxShift = Math.ceil(SHADOW_SHEAR * (squashH - 1));
  const canvasW = srcW + maxShift + SHADOW_BLUR_PAD * 2;
  const canvasH = squashH + SHADOW_BLUR_PAD * 2;
  const canvas = blankFrame(canvasW, canvasH);
  for (let y = 0; y < squashH; y++) {
    // y is the distance from the base edge (row 0 after the flip).
    const shift = Math.round(SHADOW_SHEAR * y);
    for (let x = 0; x < srcW; x++) {
      const alpha = alphaAt(squashed, x, y);
      if (alpha <= 0) continue;
      setPixel(canvas, SHADOW_BLUR_PAD + maxShift + x - shift, SHADOW_BLUR_PAD + y, [
        0,
        0,
        0,
        alpha,
      ]);
    }
  }
  canvas.blur(SHADOW_BLUR_PX);
  const data = canvas.bitmap.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = Math.round(data[i + 3] * SHADOW_BAKED_ALPHA);
  }
  const bounds = opaqueBounds(canvas);
  if (bounds === null) throw new Error(`${name}: cast shadow is fully transparent`);
  canvas.crop(bounds);
  return {
    image: canvas,
    trim: { x: bounds.x, y: bounds.y, sourceW: canvasW, sourceH: canvasH },
  };
}

/**
 * Authored building-shadow override (T3.28, generalized T3.29): if
 * tools/shadow-overrides/<name>_shadow.png (+ .json) exists, use that hand-authored
 * shadow instead of generateCastShadow. The manifest is the single source of truth
 * (logical size, sourceFrameRect, sourceGroundPoint -> derived anchor, per-shadow
 * validation); the loader/validator live in tools/shadow-lib.mjs so the CLI tools,
 * codegen, and packer all agree. Returns null when no override exists, so the
 * generic generator stays the fallback for small decor. Nothing here is
 * farmhouse-specific and no frame size is assumed.
 */
async function loadAuthoredShadowOverride(name) {
  const pngPath = join(shadowOverrideDir, `${name}_shadow.png`);
  const metadataPath = join(shadowOverrideDir, `${name}_shadow.json`);
  if (!existsSync(pngPath)) {
    if (existsSync(metadataPath))
      throw new Error(`${name}: shadow metadata exists without its PNG`);
    return null;
  }
  if (!existsSync(metadataPath))
    throw new Error(`${name}: authored shadow PNG exists without metadata`);
  const manifest = readManifest(metadataPath);
  if (manifest.building !== name || manifest.frame !== `${name}_shadow`) {
    throw new Error(
      `${name}: manifest building/frame (${manifest.building}/${manifest.frame}) does not match`,
    );
  }
  const image = await Jimp.read(pngPath);
  const report = validateAuthoredImage(image, manifest);
  if (!report.ok) {
    throw new Error(
      `${name}: authored shadow failed validation:\n  - ${report.errors.join('\n  - ')}`,
    );
  }
  return buildPackedOverride(image, manifest);
}

/**
 * Ground texture (T2.28): trim only, no resize/no fixed frame - these are
 * standalone TileSprite source images, not atlas frames, so they keep their
 * own native trimmed size. The staged 512x512 masters carry large transparent
 * gutters (measured, not assumed - see the top-of-file note), so trimming is
 * required for clean repeat bounds, not just tidiness.
 */
function processGroundTexture(image, name) {
  trim(image, name);
  return image;
}

/**
 * Measure the packed panel's nine-slice geometry:
 * - border thickness: at mid-height, pixels from the first opaque column
 *   until the color departs from the outermost border color;
 * - corner radius: the x-inset of the first opaque pixel in the topmost
 *   opaque row (the flat top edge starts where the corner arc ends).
 * The safe slice margin must cover both (corners are drawn unscaled).
 */
function measurePanelSlice(panel) {
  const midY = Math.floor(PANEL_SIZE / 2);
  let x0 = 0;
  while (x0 < PANEL_SIZE && alphaAt(panel, x0, midY) <= ALPHA_THRESHOLD) x0++;
  const borderColor = rgbAt(panel, x0, midY);
  let x = x0;
  while (
    x < PANEL_SIZE &&
    alphaAt(panel, x, midY) > ALPHA_THRESHOLD &&
    colorDistance(rgbAt(panel, x, midY), borderColor) < COLOR_DISTANCE_THRESHOLD
  ) {
    x++;
  }
  const borderThickness = x - x0;

  let topY = 0;
  outer: for (; topY < PANEL_SIZE; topY++) {
    for (let px = 0; px < PANEL_SIZE; px++) {
      if (alphaAt(panel, px, topY) > ALPHA_THRESHOLD) break outer;
    }
  }
  let cornerX = 0;
  while (cornerX < PANEL_SIZE && alphaAt(panel, cornerX, topY) <= ALPHA_THRESHOLD) cornerX++;

  const slice = Math.max(borderThickness, cornerX) + PANEL_SLICE_SAFETY;
  return { borderThickness, cornerRadius: cornerX, slice };
}

// ---------------------------------------------------------------------------
// Shelf packer + atlas JSON (same output shape as the retired gen-assets.mjs)
// ---------------------------------------------------------------------------

function packSprites(sprites, maxWidth) {
  let x = PAD;
  let y = PAD;
  let shelfHeight = 0;
  let atlasWidth = 0;
  const placements = [];
  for (const sprite of sprites) {
    const { width, height } = sprite.image.bitmap;
    if (x + width + PAD > maxWidth && x > PAD) {
      x = PAD;
      y += shelfHeight + PAD;
      shelfHeight = 0;
    }
    placements.push({ name: sprite.name, image: sprite.image, trim: sprite.trim, x, y });
    x += width + PAD;
    shelfHeight = Math.max(shelfHeight, height);
    atlasWidth = Math.max(atlasWidth, x);
  }
  return { placements, width: atlasWidth, height: y + shelfHeight + PAD };
}

function buildAtlasJson(packed) {
  const frames = {};
  for (const { name, image, trim, x, y } of packed.placements) {
    const { width: w, height: h } = image.bitmap;
    // Generated cast shadows (T3.3s-r2d) pack their TRIMMED bitmap but keep
    // the untrimmed canvas as the frame's logical size via the standard
    // trim metadata - Phaser re-offsets the texture, so runtime geometry
    // can treat every shadow as its full deterministic canvas.
    frames[name] = {
      frame: { x, y, w, h },
      rotated: false,
      trimmed: trim !== undefined,
      spriteSourceSize: trim === undefined ? { x: 0, y: 0, w, h } : { x: trim.x, y: trim.y, w, h },
      sourceSize: trim === undefined ? { w, h } : { w: trim.sourceW, h: trim.sourceH },
    };
  }
  return {
    frames,
    meta: {
      app: 'littleacres tools/pack-atlas.mjs',
      image: 'atlas.png',
      format: 'RGBA8888',
      size: { w: packed.width, h: packed.height },
      scale: '1',
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!existsSync(stagingDir)) {
  console.error(`error: staging directory not found: ${stagingDir}`);
  process.exit(1);
}

const staged = readdirSync(stagingDir).filter((f) => f.toLowerCase().endsWith('.png'));
const stagedNames = new Set(staged.map((f) => f.replace(/\.png$/i, '')));

const missing = [...FRAME_NAMES, ...GROUND_TEXTURE_NAMES].filter(
  (name) => !stagedNames.has(sourceFileFor(name)),
);
if (missing.length > 0) {
  console.error(`error: missing staged art for: ${missing.join(', ')}`);
  process.exit(1);
}
const consumedSourceNames = new Set([...FRAME_NAMES, ...GROUND_TEXTURE_NAMES].map(sourceFileFor));
const ignored = [...stagedNames].filter((name) => !consumedSourceNames.has(name)).sort();
if (ignored.length > 0) {
  console.log(`note: ignoring staged extras (not packed): ${ignored.join(', ')}`);
}

// T2.21: pre-measure plot_occupied's packed footprint so `plot`'s footprint
// fix (below) has a target to align to, regardless of iteration order.
const plotOccupiedRef = await Jimp.read(join(stagingDir, `${sourceFileFor('plot_occupied')}.png`));
const plotOccupiedTargetBounds = opaqueBounds(processTileBase(plotOccupiedRef, 'plot_occupied'));
let plotFootprintBefore = null;

// T3.25: pre-measure the packed `farmhouse` frame so the restored variant has
// a reference to size itself against regardless of iteration order - same
// pattern as plot_occupied above.
const farmhouseRefSize = SQUARE_DOWNSCALE_SIZES.farmhouse;
const farmhouseRef = {
  size: farmhouseRefSize,
  // SOLID bounds on both sides, so the restored art is measured against the
  // current building like for like - see SOLID_ALPHA_THRESHOLD.
  bounds: opaqueBounds(
    processIcon(
      await Jimp.read(join(stagingDir, `${sourceFileFor('farmhouse')}.png`)),
      'farmhouse',
      farmhouseRefSize,
    ),
    SOLID_ALPHA_THRESHOLD,
  ),
};

const sprites = [];
// Sorted names = fixed, deterministic packing order.
for (const name of [...FRAME_NAMES].sort()) {
  const image = await Jimp.read(join(stagingDir, `${sourceFileFor(name)}.png`));
  let frame;
  if (name === 'plot') {
    const fixed = processPlotFootprintFix(image, name, plotOccupiedTargetBounds);
    frame = fixed.frame;
    plotFootprintBefore = fixed.before;
  } else if (name === RESTORED_FARMHOUSE_NAME) {
    frame = processRestoredFarmhouse(image, name, farmhouseRef);
  } else if (TILE_NAMES.includes(name)) frame = processTile(image, name);
  else if (DERIVED_TILE_NAMES.includes(name)) frame = processTileFlat(image, name);
  else if (PATH_TILE_NAMES.includes(name)) frame = processPathTile(image, name);
  else if (CROP_NAMES.includes(name)) frame = processCrop(image, name);
  else if (CHEST_NAMES.includes(name)) frame = processChest(image, name);
  else if (ICON_NAMES.includes(name)) frame = processIcon(image, name, ICON_SIZE);
  else if (SIGN_NAMES.includes(name)) frame = processIcon(image, name, SIGN_SIZE);
  else if (DECAL_NAMES.includes(name)) frame = processIcon(image, name, DECAL_SIZE);
  else if (STONE_CLUSTER_NAMES.includes(name)) frame = processIcon(image, name, STONE_CLUSTER_SIZE);
  else if (stagedStoneSingleNames.includes(name))
    frame = processIcon(image, name, STONE_SINGLE_SIZE);
  else if (name in SQUARE_DOWNSCALE_SIZES)
    frame = processIcon(image, name, SQUARE_DOWNSCALE_SIZES[name]);
  else if (name in WIDE_DOWNSCALE_WIDTHS)
    frame = processWide(image, name, WIDE_DOWNSCALE_WIDTHS[name]);
  else frame = processPanel(image, name);
  sprites.push({ name, image: frame });
}
// T3.3s-r2d: generated cast-shadow companions - appended after the sorted
// staged frames, themselves in sorted order, so packing stays deterministic.
for (const name of [...SHADOWED_FRAME_NAMES].sort()) {
  const source = sprites.find((sprite) => sprite.name === name);
  if (source === undefined) throw new Error(`${name}: shadowed frame missing from the pack`);
  // T3.28: an authored override wins; the generic generator is the fallback.
  const authored = await loadAuthoredShadowOverride(name);
  const { image, trim } = authored === null ? generateCastShadow(source.image, name) : authored;
  sprites.push({ name: `${name}_shadow`, image, trim });
}

const plotSprite = sprites.find((s) => s.name === 'plot');
const plotFootprintAfter = opaqueBounds(plotSprite.image);
console.log(
  `plot footprint fix: plot_occupied ${fmtBounds(plotOccupiedTargetBounds)}; ` +
    `plot before ${fmtBounds(plotFootprintBefore)}; plot after ${fmtBounds(plotFootprintAfter)}`,
);

if (stagedNames.has('pouch')) {
  console.log('note: pouch packed as a reserved frame (unused in code; a future task wires it up)');
}

const panelSprite = sprites.find((s) => s.name === 'panel');
const { borderThickness, cornerRadius, slice } = measurePanelSlice(panelSprite.image);
console.log(
  `panel: border ${borderThickness}px, corner radius ~${cornerRadius}px ` +
    `-> safe slice margin ${slice}px (PANEL_SLICE in src/config.ts must match)`,
);

const packed = packSprites(sprites, ATLAS_MAX_WIDTH);
const atlas = blankFrame(packed.width, packed.height);
for (const { image, x, y } of packed.placements) {
  atlas.composite(image, x, y);
}

mkdirSync(assetsDir, { recursive: true });
writeFileSync(join(assetsDir, 'atlas.png'), await atlas.getBuffer('image/png'));
writeFileSync(
  join(assetsDir, 'atlas.json'),
  JSON.stringify(buildAtlasJson(packed), null, 2) + '\n',
);

console.log(`atlas: ${packed.width}x${packed.height}, ${packed.placements.length} frames`);
console.log(`frames: ${packed.placements.map((p) => p.name).join(', ')}`);
console.log(`wrote ${join(assetsDir, 'atlas.png')}`);
console.log(`wrote ${join(assetsDir, 'atlas.json')}`);

for (const name of GROUND_TEXTURE_NAMES) {
  const raw = await Jimp.read(join(stagingDir, `${sourceFileFor(name)}.png`));
  const rawSize = `${raw.bitmap.width}x${raw.bitmap.height}`;
  const trimmed = processGroundTexture(raw, name);
  const outPath = join(assetsDir, `${name}.png`);
  writeFileSync(outPath, await trimmed.getBuffer('image/png'));
  console.log(
    `ground texture: ${name} raw ${rawSize} -> trimmed ${trimmed.bitmap.width}x${trimmed.bitmap.height}, wrote ${outPath}`,
  );
}
