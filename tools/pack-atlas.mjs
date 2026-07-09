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
 * - Crops (9): trimmed, scaled to fit 128x120 preserving aspect, placed on a
 *   128x128 frame with the lowest opaque row on the CROP_BASELINE_Y (104)
 *   baseline, horizontally centered. (Bottom-pinned at 104, a sprite taller
 *   than 105 rows cannot fit the frame, so height is effectively capped
 *   there; the cap is logged when it engages.)
 * - coin, moondust: trimmed, fit into 96x96, centered.
 * - panel: 128x128 nine-slice source. The border thickness and corner
 *   radius are measured in packed pixels and a safe slice margin is logged -
 *   PANEL_SLICE in src/config.ts must match it.
 *
 * Layout is deterministic (fixed frame list, sorted packing order, fixed
 * shelf width), so reruns are byte-stable given identical inputs. Staged
 * files that are not part of the frame list (app icon, future UI icons) are
 * ignored with a console note.
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
const CROP_FIT_WIDTH = 128;
const CROP_FIT_HEIGHT = 120;

const ICON_SIZE = 96;
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
];
const ICON_NAMES = ['coin', 'moondust'];
const FRAME_NAMES = [...TILE_NAMES, ...CROP_NAMES, ...ICON_NAMES, 'panel'];

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
function processTile(image, name) {
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

/**
 * Crop sprite: fit into CROP_FIT_WIDTH x CROP_FIT_HEIGHT, then bottom-pin on
 * the baseline. Bottom-pinned, only CROP_BASELINE_Y + 1 rows fit above y = 0,
 * so the effective height cap is min(CROP_FIT_HEIGHT, CROP_BASELINE_Y + 1).
 */
function processCrop(image, name) {
  trim(image, name);
  const maxH = Math.min(CROP_FIT_HEIGHT, CROP_BASELINE_Y + 1);
  if (image.bitmap.height * (CROP_FIT_WIDTH / image.bitmap.width) > CROP_FIT_HEIGHT) {
    // Only reachable for unusually tall art; noted so the cap never surprises.
    console.warn(`note: ${name}: height-limited fit (baseline cap ${maxH}px)`);
  }
  const scale = Math.min(CROP_FIT_WIDTH / image.bitmap.width, maxH / image.bitmap.height);
  const w = Math.max(1, Math.round(image.bitmap.width * scale));
  const h = Math.max(1, Math.round(image.bitmap.height * scale));
  image.resize({ w, h });
  const frame = blankFrame(CROP_FRAME_SIZE, CROP_FRAME_SIZE);
  frame.composite(image, Math.round((CROP_FRAME_SIZE - w) / 2), CROP_BASELINE_Y - h + 1);
  return frame;
}

/** Icon: fit into ICON_SIZE x ICON_SIZE, centered. */
function processIcon(image, name) {
  trim(image, name);
  const scale = Math.min(ICON_SIZE / image.bitmap.width, ICON_SIZE / image.bitmap.height);
  const w = Math.max(1, Math.round(image.bitmap.width * scale));
  const h = Math.max(1, Math.round(image.bitmap.height * scale));
  image.resize({ w, h });
  const frame = blankFrame(ICON_SIZE, ICON_SIZE);
  frame.composite(image, Math.round((ICON_SIZE - w) / 2), Math.round((ICON_SIZE - h) / 2));
  return frame;
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

const missing = FRAME_NAMES.filter((name) => !stagedNames.has(name));
if (missing.length > 0) {
  console.error(`error: missing staged art for: ${missing.join(', ')}`);
  process.exit(1);
}
const ignored = [...stagedNames].filter((name) => !FRAME_NAMES.includes(name)).sort();
if (ignored.length > 0) {
  console.log(`note: ignoring staged extras (not packed): ${ignored.join(', ')}`);
}

const sprites = [];
// Sorted names = fixed, deterministic packing order.
for (const name of [...FRAME_NAMES].sort()) {
  const image = await Jimp.read(join(stagingDir, `${name}.png`));
  let frame;
  if (TILE_NAMES.includes(name)) frame = processTile(image, name);
  else if (CROP_NAMES.includes(name)) frame = processCrop(image, name);
  else if (ICON_NAMES.includes(name)) frame = processIcon(image, name);
  else frame = processPanel(image, name);
  sprites.push({ name, image: frame });
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
