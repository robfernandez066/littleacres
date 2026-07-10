#!/usr/bin/env node
/**
 * PWA app icon generator for Little Acres.
 *
 * Reads `tools/art-staging/appicon.png` (512px master, gitignored) and
 * writes the icon files the PWA manifest declares (see vite.config.ts):
 *
 *   public/icon-192.png
 *   public/icon-512.png
 *   public/icon-512-maskable.png
 *
 * The master has transparent rounded corners around its rounded-square
 * background, so OS icon masking (which crops to its own shape, not the
 * art's) would show the transparent corners as white/black on some
 * launchers. This script fills them first: it samples the background color
 * from the opaque square itself, then composites the art over a full-bleed
 * canvas of that color so every exported size is fully opaque edge-to-edge.
 *
 * Separate from `pack-atlas.mjs` on purpose: the app icon is not an atlas
 * frame (it is loaded by the OS/manifest, never through `ATLAS_KEY`), and
 * `pack-atlas.mjs` explicitly ignores `appicon` as a staged extra.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Jimp } from 'jimp';

const ALPHA_THRESHOLD = 8;

/** Manifest icon files to emit: [filename, size]. Keep in sync with vite.config.ts. */
const ICON_TARGETS = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-512-maskable.png', 512],
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stagingDir = join(repoRoot, 'tools', 'art-staging');
const publicDir = join(repoRoot, 'public');
const masterPath = join(stagingDir, 'appicon.png');

function alphaAt(image, x, y) {
  return image.bitmap.data[(y * image.bitmap.width + x) * 4 + 3];
}

function rgbAt(image, x, y) {
  const i = (y * image.bitmap.width + x) * 4;
  const d = image.bitmap.data;
  return { r: d[i], g: d[i + 1], b: d[i + 2] };
}

/** First opaque pixel scanning down the center column - inside the rounded square's flat top edge. */
function sampleBackgroundColor(image) {
  const { width, height } = image.bitmap;
  const x = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    if (alphaAt(image, x, y) > ALPHA_THRESHOLD) {
      return rgbAt(image, x, y + 2);
    }
  }
  throw new Error('appicon: image is fully transparent');
}

if (!existsSync(masterPath)) {
  console.error(`error: staged app icon not found: ${masterPath}`);
  process.exit(1);
}

const master = await Jimp.read(masterPath);
const bg = sampleBackgroundColor(master);
console.log(
  `app icon: filling transparent corners with sampled background rgb(${bg.r}, ${bg.g}, ${bg.b})`,
);

// Jimp's `color` option is packed RGBA (0xRRGGBBAA); build fully opaque.
const bgColor = ((bg.r << 24) | (bg.g << 16) | (bg.b << 8) | 0xff) >>> 0;
const bled = new Jimp({ width: master.bitmap.width, height: master.bitmap.height, color: bgColor });
bled.composite(master, 0, 0);

mkdirSync(publicDir, { recursive: true });
for (const [filename, size] of ICON_TARGETS) {
  const resized = bled.clone().resize({ w: size, h: size });
  writeFileSync(join(publicDir, filename), await resized.getBuffer('image/png'));
  console.log(`wrote ${join(publicDir, filename)} (${size}x${size})`);
}
