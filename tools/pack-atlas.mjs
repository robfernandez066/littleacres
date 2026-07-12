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
 * - Crops (15): trimmed, scaled to a per-stage height target (stage 2 = 100%
 *   of the max legal height, stage 1 = 78%, stage 0 = 55% - a glance must
 *   read small -> medium -> full), width still capped at 128, placed on a
 *   128x128 frame horizontally centered (bbox center at x = 64) with the
 *   lowest opaque row on CROP_BASELINE_Y + CROP_SINK - the sprite sinks a
 *   little below the anchored baseline so the mound's visual middle sits on
 *   the diamond center, hugging the tile. Width-limited sprites that miss
 *   their height target are logged.
 * - chest_closed, chest_open: crop treatment with no growth stage - a single
 *   static object placed at the full (stage-2-equivalent) height target.
 * - coin, moondust, bag, scroll, note, pouch: trimmed, fit into 96x96,
 *   centered. `pouch` is packed as a reserved frame - unused in code today.
 * - sign: trimmed, fit into 192x192, centered.
 * - hud_crest, gear_icon, button_push, button_slot, button_close (staged as
 *   xbutton), mere (staged as mere_strip), notice_board, farmhouse,
 *   dirt_path: trimmed, fit into a square frame
 *   (192/128/256/256/96/384/256/256/288), centered - same treatment as the
 *   icons above.
 * - hud_banner, xpbar_frame, xpbar_fill: trimmed, scaled to a fixed 512px
 *   width keeping aspect - no fixed square frame.
 * - panel: 128x128 nine-slice source. The border thickness and corner
 *   radius are measured in packed pixels and a safe slice margin is logged -
 *   PANEL_SLICE in src/config.ts must match it.
 * - plot (T2.21 fix): after the shared tile transform, plot's opaque
 *   footprint is re-cropped and rescaled onto plot_occupied's measured
 *   footprint so the two tiles line up flush in a mixed field. Before/after
 *   extents are logged.
 *
 * Layout is deterministic (fixed frame list, sorted packing order, fixed
 * shelf width), so reruns are byte-stable given identical inputs. Staged
 * files that are not part of the frame list (the app icon, packed
 * separately by tools/pack-icons.mjs) are ignored with a console note.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Jimp } from 'jimp';

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
];
const ICON_NAMES = ['coin', 'moondust', 'bag', 'scroll', 'note', 'pouch'];
const SIGN_NAMES = ['sign'];
/** Single static objects that sit on a tile like a crop, but have no growth stages. */
const CHEST_NAMES = ['chest_closed', 'chest_open'];
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
  dirt_path: 288,
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
};
function sourceFileFor(name) {
  return SOURCE_FILE_OVERRIDES[name] ?? name;
}
const FRAME_NAMES = [
  ...TILE_NAMES,
  ...CROP_NAMES,
  ...ICON_NAMES,
  ...SIGN_NAMES,
  ...CHEST_NAMES,
  ...Object.keys(SQUARE_DOWNSCALE_SIZES),
  ...Object.keys(WIDE_DOWNSCALE_WIDTHS),
  'panel',
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stagingDir = join(repoRoot, 'tools', 'art-staging');
const assetsDir = join(repoRoot, 'assets');

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------

/** Bounding box of pixels with alpha above the threshold, or null if none. */
function opaqueBounds(image) {
  const { width, height, data } = image.bitmap;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
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
    placements.push({ name: sprite.name, image: sprite.image, x, y });
    x += width + PAD;
    shelfHeight = Math.max(shelfHeight, height);
    atlasWidth = Math.max(atlasWidth, x);
  }
  return { placements, width: atlasWidth, height: y + shelfHeight + PAD };
}

function buildAtlasJson(packed) {
  const frames = {};
  for (const { name, image, x, y } of packed.placements) {
    const { width: w, height: h } = image.bitmap;
    frames[name] = {
      frame: { x, y, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
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

const missing = FRAME_NAMES.filter((name) => !stagedNames.has(sourceFileFor(name)));
if (missing.length > 0) {
  console.error(`error: missing staged art for: ${missing.join(', ')}`);
  process.exit(1);
}
const consumedSourceNames = new Set(FRAME_NAMES.map(sourceFileFor));
const ignored = [...stagedNames].filter((name) => !consumedSourceNames.has(name)).sort();
if (ignored.length > 0) {
  console.log(`note: ignoring staged extras (not packed): ${ignored.join(', ')}`);
}

// T2.21: pre-measure plot_occupied's packed footprint so `plot`'s footprint
// fix (below) has a target to align to, regardless of iteration order.
const plotOccupiedRef = await Jimp.read(join(stagingDir, `${sourceFileFor('plot_occupied')}.png`));
const plotOccupiedTargetBounds = opaqueBounds(processTileBase(plotOccupiedRef, 'plot_occupied'));
let plotFootprintBefore = null;

const sprites = [];
// Sorted names = fixed, deterministic packing order.
for (const name of [...FRAME_NAMES].sort()) {
  const image = await Jimp.read(join(stagingDir, `${sourceFileFor(name)}.png`));
  let frame;
  if (name === 'plot') {
    const fixed = processPlotFootprintFix(image, name, plotOccupiedTargetBounds);
    frame = fixed.frame;
    plotFootprintBefore = fixed.before;
  } else if (TILE_NAMES.includes(name)) frame = processTile(image, name);
  else if (CROP_NAMES.includes(name)) frame = processCrop(image, name);
  else if (CHEST_NAMES.includes(name)) frame = processChest(image, name);
  else if (ICON_NAMES.includes(name)) frame = processIcon(image, name, ICON_SIZE);
  else if (SIGN_NAMES.includes(name)) frame = processIcon(image, name, SIGN_SIZE);
  else if (name in SQUARE_DOWNSCALE_SIZES)
    frame = processIcon(image, name, SQUARE_DOWNSCALE_SIZES[name]);
  else if (name in WIDE_DOWNSCALE_WIDTHS)
    frame = processWide(image, name, WIDE_DOWNSCALE_WIDTHS[name]);
  else frame = processPanel(image, name);
  sprites.push({ name, image: frame });
}

const plotSprite = sprites.find((s) => s.name === 'plot');
const plotFootprintAfter = opaqueBounds(plotSprite.image);
const fmtBounds = (b) => `x=${b.x} y=${b.y} w=${b.w} h=${b.h}`;
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
