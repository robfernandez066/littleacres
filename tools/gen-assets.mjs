#!/usr/bin/env node
/**
 * Placeholder art generator for Little Acres.
 *
 * Draws every placeholder sprite programmatically (pure JS, zero dependencies -
 * PNG encoding uses only Node's built-in zlib), shelf-packs them into a single
 * atlas, and writes:
 *
 *   assets/atlas.png   - the packed texture atlas
 *   assets/atlas.json  - Phaser 3 "JSON hash" atlas data
 *
 * The generated files are committed to the repo; this script is a dev-time
 * convenience (`npm run gen:assets`), never a build step. Regenerate after
 * editing, then commit the results. See ASSETS.md for the frame-name
 * convention and how to swap in real art.
 *
 * All drawing is deterministic (seeded PRNG) so reruns are reproducible.
 */

import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Sizes (keep in sync with ASSETS.md and src/systems/iso.ts)
// ---------------------------------------------------------------------------

const TILE_W = 256; // iso tile canvas, 2:1 diamond fills it edge to edge
const TILE_H = 128;
const CROP_SIZE = 128; // crop sprite canvas (square)
const CROP_GROUND_Y = 104; // baseline inside the crop canvas where the plant meets the soil
const COIN_SIZE = 96;
const PANEL_SIZE = 96; // 9-slice source; safe corner margin is 32px
const ATLAS_MAX_WIDTH = 540;
const PAD = 2; // transparent padding between packed frames

// ---------------------------------------------------------------------------
// Tiny raster library (RGBA surfaces + alpha-blended primitives)
// ---------------------------------------------------------------------------

function createSurface(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Alpha-blend a single pixel. `color` is [r,g,b] or [r,g,b,a]; `alpha` scales it 0..1. */
function blendPixel(surface, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  const [r, g, b, a = 255] = color;
  const sa = (a / 255) * alpha;
  if (sa <= 0) return;
  const i = (y * surface.width + x) * 4;
  const d = surface.data;
  const da = d[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  d[i] = Math.round((r * sa + d[i] * da * (1 - sa)) / outA);
  d[i + 1] = Math.round((g * sa + d[i + 1] * da * (1 - sa)) / outA);
  d[i + 2] = Math.round((b * sa + d[i + 2] * da * (1 - sa)) / outA);
  d[i + 3] = Math.round(outA * 255);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Filled ellipse with a ~1px antialiased edge. */
function fillEllipse(surface, cx, cy, rx, ry, color) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1));
  const x1 = Math.min(surface.width - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1));
  const y1 = Math.min(surface.height - 1, Math.ceil(cy + ry + 1));
  const feather = Math.min(rx, ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = Math.sqrt(nx * nx + ny * ny);
      const cover = clamp01((1 - d) * feather + 0.5);
      if (cover > 0) blendPixel(surface, x, y, color, cover);
    }
  }
}

function fillCircle(surface, cx, cy, r, color) {
  fillEllipse(surface, cx, cy, r, r, color);
}

/** Filled capsule (thick line segment), antialiased. Used for stalks and leaves. */
function thickLine(surface, ax, ay, bx, by, width, color) {
  const half = width / 2;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half - 1));
  const x1 = Math.min(surface.width - 1, Math.ceil(Math.max(ax, bx) + half + 1));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - half - 1));
  const y1 = Math.min(surface.height - 1, Math.ceil(Math.max(ay, by) + half + 1));
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = clamp01(((px - ax) * dx + (py - ay) * dy) / lenSq);
      const dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      const cover = clamp01(half - dist + 0.5);
      if (cover > 0) blendPixel(surface, x, y, color, cover);
    }
  }
}

/** Soft radial glow (alpha falls off quadratically to the rim). */
function drawGlow(surface, cx, cy, radius, color, peakAlpha) {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(surface.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(surface.height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
      if (d < 1) blendPixel(surface, x, y, color, peakAlpha * (1 - d) * (1 - d));
    }
  }
}

/** Filled rounded rectangle (SDF-based, antialiased edge). */
function fillRoundedRect(surface, x, y, w, h, r, color) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(surface.height, Math.ceil(y + h)); py++) {
    for (
      let px = Math.max(0, Math.floor(x));
      px < Math.min(surface.width, Math.ceil(x + w));
      px++
    ) {
      const qx = Math.max(Math.abs(px + 0.5 - cx) - (w / 2 - r), 0);
      const qy = Math.max(Math.abs(py + 0.5 - cy) - (h / 2 - r), 0);
      const d = Math.hypot(qx, qy) - r;
      const cover = clamp01(0.5 - d);
      if (cover > 0) blendPixel(surface, px, py, color, cover);
    }
  }
}

/** Deterministic PRNG so regenerated art is byte-for-byte reproducible. */
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Tile sprites (iso diamonds)
// ---------------------------------------------------------------------------

/**
 * Draw a full-canvas 2:1 iso diamond, shaded per pixel by `shade(d, x, y)`
 * where d is 0 at the center and 1 at the diamond edge. Edges are hard (no
 * feather) and overdrawn slightly (d <= 1.02) so adjacent tiles tessellate
 * without hairline seams.
 */
function makeDiamondTile(shade) {
  const s = createSurface(TILE_W, TILE_H);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const d = Math.abs(x + 0.5 - hw) / hw + Math.abs(y + 0.5 - hh) / hh;
      if (d <= 1.02) blendPixel(s, x, y, shade(Math.min(d, 1), x, y));
    }
  }
  return s;
}

/** Scatter small speckle dots inside the diamond (d < 0.88). */
function speckleDiamond(surface, rng, count, colors) {
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  let placed = 0;
  while (placed < count) {
    const x = rng() * TILE_W;
    const y = rng() * TILE_H;
    const d = Math.abs(x - hw) / hw + Math.abs(y - hh) / hh;
    if (d >= 0.88) continue;
    const color = colors[Math.floor(rng() * colors.length)];
    fillCircle(surface, x, y, 1 + rng() * 1.2, color);
    placed++;
  }
}

function makeGrassTile() {
  const BASE = [124, 193, 92];
  const EDGE = [98, 162, 72];
  const tile = makeDiamondTile((d) => (d > 0.92 ? EDGE : BASE));
  speckleDiamond(tile, mulberry32(101), 60, [
    [150, 214, 110],
    [138, 205, 100],
    [104, 170, 78],
  ]);
  return tile;
}

function makePlotTile() {
  const BASE = [158, 113, 74];
  const EDGE = [116, 80, 51];
  const FURROW = [132, 92, 58];
  const tile = makeDiamondTile((d) => {
    if (d > 0.9) return EDGE;
    // Two concentric inset diamond outlines read as tilled furrows.
    if (Math.abs(d - 0.62) < 0.045 || Math.abs(d - 0.32) < 0.045) return FURROW;
    return BASE;
  });
  speckleDiamond(tile, mulberry32(202), 40, [
    [174, 128, 86],
    [124, 86, 55],
  ]);
  return tile;
}

// ---------------------------------------------------------------------------
// Crop sprites (128x128, plant base on the CROP_GROUND_Y baseline)
// ---------------------------------------------------------------------------

function makeSunwheat(stage) {
  const s = createSurface(CROP_SIZE, CROP_SIZE);
  const stalkCount = [3, 5, 6][stage];
  const height = [20, 40, 58][stage];
  const width = [3.5, 4, 4.5][stage];
  const color = [
    [126, 186, 92],
    [196, 200, 84],
    [242, 198, 74],
  ][stage];
  for (let i = 0; i < stalkCount; i++) {
    const bx = CROP_SIZE / 2 + (i - (stalkCount - 1) / 2) * 11;
    const lean = (i % 2 === 0 ? -1 : 1) * (2 + (i % 3));
    const topX = bx + lean;
    const topY = CROP_GROUND_Y - height - (i % 2) * 4;
    thickLine(s, bx, CROP_GROUND_Y, topX, topY, width, color);
    if (stage === 1) fillEllipse(s, topX, topY - 2, 2.5, 5, [216, 216, 110]);
    if (stage === 2) fillEllipse(s, topX, topY - 5, 4, 9, [252, 222, 112]);
  }
  return s;
}

function makeCarrot(stage) {
  const s = createSurface(CROP_SIZE, CROP_SIZE);
  const cx = CROP_SIZE / 2;
  const leafCount = [2, 4, 6][stage];
  const leafLen = [10, 20, 28][stage];
  const leafColor = [
    [100, 175, 80],
    [80, 165, 70],
    [70, 158, 66],
  ][stage];
  for (let i = 0; i < leafCount; i++) {
    // Fan the leaves out symmetrically from the base.
    const angle = -Math.PI / 2 + (i - (leafCount - 1) / 2) * 0.42;
    const tipX = cx + Math.cos(angle) * leafLen;
    const tipY = CROP_GROUND_Y - 2 + Math.sin(angle) * leafLen;
    thickLine(s, cx, CROP_GROUND_Y - 2, tipX, tipY, 3.5, leafColor);
    fillCircle(s, tipX, tipY, stage === 2 ? 4.5 : 3, [
      leafColor[0] + 20,
      leafColor[1] + 18,
      leafColor[2] + 16,
    ]);
  }
  if (stage === 1) fillEllipse(s, cx, CROP_GROUND_Y + 1, 7, 4, [232, 118, 45]);
  if (stage === 2) {
    // Ready: a fat orange shoulder poking out of the soil.
    fillEllipse(s, cx, CROP_GROUND_Y, 13, 8, [238, 122, 42]);
    fillEllipse(s, cx, CROP_GROUND_Y + 6, 8, 5, [224, 104, 34]);
    fillEllipse(s, cx - 5, CROP_GROUND_Y - 2, 4, 2.5, [252, 168, 92]);
  }
  return s;
}

function makeGlowberry(stage) {
  const s = createSurface(CROP_SIZE, CROP_SIZE);
  const cx = CROP_SIZE / 2;
  if (stage === 0) {
    thickLine(s, cx, CROP_GROUND_Y, cx, CROP_GROUND_Y - 12, 3, [110, 140, 90]);
    fillCircle(s, cx, CROP_GROUND_Y - 16, 5, [156, 118, 212]);
    return s;
  }
  const bushColor = stage === 1 ? [74, 112, 88] : [80, 118, 96];
  const bushR = stage === 1 ? 12 : 15;
  const bushY = stage === 1 ? CROP_GROUND_Y - 14 : CROP_GROUND_Y - 18;
  if (stage === 2) drawGlow(s, cx, bushY - 6, 38, [150, 130, 255], 0.5);
  fillCircle(s, cx - 11, bushY + 2, bushR, bushColor);
  fillCircle(s, cx + 11, bushY + 2, bushR, bushColor);
  fillCircle(s, cx, bushY - 8, bushR, bushColor);
  const berryColor = stage === 1 ? [122, 96, 198] : [158, 138, 255];
  const berryR = stage === 1 ? 4 : 5.5;
  const berries =
    stage === 1
      ? [
          [cx - 9, bushY],
          [cx + 8, bushY - 3],
          [cx - 1, bushY + 6],
        ]
      : [
          [cx - 13, bushY + 1],
          [cx + 12, bushY - 1],
          [cx - 3, bushY - 12],
          [cx + 4, bushY + 6],
          [cx - 9, bushY - 7],
          [cx + 9, bushY + 8],
        ];
  for (const [bx, by] of berries) {
    if (stage === 2) drawGlow(s, bx, by, 11, [190, 175, 255], 0.55);
    fillCircle(s, bx, by, berryR, berryColor);
  }
  if (stage === 2) {
    for (const [bx, by] of berries.slice(0, 3)) {
      fillCircle(s, bx - 1.5, by - 1.5, 1.6, [255, 255, 255]);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// UI sprites
// ---------------------------------------------------------------------------

function makeCoin() {
  const s = createSurface(COIN_SIZE, COIN_SIZE);
  const c = COIN_SIZE / 2;
  fillCircle(s, c, c, 42, [206, 144, 38]); // rim
  fillCircle(s, c, c, 35, [244, 196, 72]); // face
  fillCircle(s, c, c, 22, [250, 210, 96]); // inner emboss
  fillEllipse(s, c - 12, c - 14, 10, 6, [255, 232, 150]); // highlight
  return s;
}

function makePanel() {
  const s = createSurface(PANEL_SIZE, PANEL_SIZE);
  const BORDER = 6;
  const RADIUS = 24;
  fillRoundedRect(s, 0, 0, PANEL_SIZE, PANEL_SIZE, RADIUS, [139, 98, 60]);
  fillRoundedRect(
    s,
    BORDER,
    BORDER,
    PANEL_SIZE - BORDER * 2,
    PANEL_SIZE - BORDER * 2,
    RADIUS - BORDER,
    [252, 242, 214],
  );
  return s;
}

// ---------------------------------------------------------------------------
// Shelf packer + atlas composition
// ---------------------------------------------------------------------------

function packSprites(sprites, maxWidth) {
  let x = PAD;
  let y = PAD;
  let shelfHeight = 0;
  let atlasWidth = 0;
  const placements = [];
  for (const sprite of sprites) {
    const { width, height } = sprite.surface;
    if (x + width + PAD > maxWidth && x > PAD) {
      x = PAD;
      y += shelfHeight + PAD;
      shelfHeight = 0;
    }
    placements.push({ name: sprite.name, surface: sprite.surface, x, y });
    x += width + PAD;
    shelfHeight = Math.max(shelfHeight, height);
    atlasWidth = Math.max(atlasWidth, x);
  }
  return { placements, width: atlasWidth, height: y + shelfHeight + PAD };
}

function composeAtlas(packed) {
  const atlas = createSurface(packed.width, packed.height);
  for (const { surface, x, y } of packed.placements) {
    for (let sy = 0; sy < surface.height; sy++) {
      const src = sy * surface.width * 4;
      const dst = ((y + sy) * atlas.width + x) * 4;
      atlas.data.set(surface.data.subarray(src, src + surface.width * 4), dst);
    }
  }
  return atlas;
}

function buildAtlasJson(packed) {
  const frames = {};
  for (const { name, surface, x, y } of packed.placements) {
    const { width: w, height: h } = surface;
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
      app: 'littleacres tools/gen-assets.mjs',
      image: 'atlas.png',
      format: 'RGBA8888',
      size: { w: packed.width, h: packed.height },
      scale: '1',
    },
  };
}

// ---------------------------------------------------------------------------
// PNG encoder (RGBA8, no interlace) - pure JS, only needs node:zlib
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(surface) {
  const { width, height, data } = surface;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // bytes 10-12: compression 0, filter 0, interlace 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const sprites = [
  { name: 'grass', surface: makeGrassTile() },
  { name: 'plot', surface: makePlotTile() },
  { name: 'sunwheat_0', surface: makeSunwheat(0) },
  { name: 'sunwheat_1', surface: makeSunwheat(1) },
  { name: 'sunwheat_2', surface: makeSunwheat(2) },
  { name: 'carrot_0', surface: makeCarrot(0) },
  { name: 'carrot_1', surface: makeCarrot(1) },
  { name: 'carrot_2', surface: makeCarrot(2) },
  { name: 'glowberry_0', surface: makeGlowberry(0) },
  { name: 'glowberry_1', surface: makeGlowberry(1) },
  { name: 'glowberry_2', surface: makeGlowberry(2) },
  { name: 'coin', surface: makeCoin() },
  { name: 'panel', surface: makePanel() },
];

const packed = packSprites(sprites, ATLAS_MAX_WIDTH);
const atlasSurface = composeAtlas(packed);
const atlasJson = buildAtlasJson(packed);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(repoRoot, 'assets');
mkdirSync(assetsDir, { recursive: true });
writeFileSync(join(assetsDir, 'atlas.png'), encodePng(atlasSurface));
writeFileSync(join(assetsDir, 'atlas.json'), JSON.stringify(atlasJson, null, 2) + '\n');

console.log(`atlas: ${packed.width}x${packed.height}, ${packed.placements.length} frames`);
console.log(`frames: ${packed.placements.map((p) => p.name).join(', ')}`);
console.log(`wrote ${join(assetsDir, 'atlas.png')}`);
console.log(`wrote ${join(assetsDir, 'atlas.json')}`);
