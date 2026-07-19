/**
 * shadow:shift (T3.29) - move an authored shadow's pixels inside its logical
 * canvas without resizing, resampling, blurring, or touching the anchor.
 *
 * Usage: node tools/shadow-shift.mjs <building> --dx N --dy N
 *   dx/dy are integer LOGICAL pixels (dy negative = up). The canvas size, the
 *   manifest, and therefore the derived anchor are all unchanged - only the
 *   pixels move. Vacated pixels become fully transparent. Refuses a shift that
 *   would push visible pixels off the canvas.
 */

import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Jimp, opaqueBounds, pngPath, readManifest, manifestPath } from './shadow-lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const building = process.argv[2];
if (!building || building.startsWith('--')) {
  console.error('usage: node tools/shadow-shift.mjs <building> --dx N --dy N');
  process.exit(1);
}
const dx = Number(arg('--dx', '0'));
const dy = Number(arg('--dy', '0'));
if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
  console.error('--dx and --dy must be integers');
  process.exit(1);
}

const manifest = readManifest(manifestPath(repoRoot, building));
const path = pngPath(repoRoot, building);
const src = await Jimp.read(path);
const W = src.bitmap.width;
const H = src.bitmap.height;
if (W !== manifest.logicalWidth || H !== manifest.logicalHeight) {
  console.error(
    `PNG is ${W}x${H} but manifest says ${manifest.logicalWidth}x${manifest.logicalHeight}`,
  );
  process.exit(1);
}

// Refuse a shift that would clip visible pixels off the canvas.
const before = opaqueBounds(src, 0);
if (before) {
  const nx0 = before.x + dx;
  const ny0 = before.y + dy;
  const nx1 = before.x + before.w - 1 + dx;
  const ny1 = before.y + before.h - 1 + dy;
  if (nx0 < 0 || ny0 < 0 || nx1 >= W || ny1 >= H) {
    console.error(
      `refusing: shift (${dx},${dy}) would push pixels off the ${W}x${H} canvas ` +
        `(content bbox would be x[${nx0},${nx1}] y[${ny0},${ny1}]). Enlarge the canvas first.`,
    );
    process.exit(1);
  }
}

// Exact lossless row/col copy into a fresh transparent canvas - no resample.
const out = new Jimp({ width: W, height: H });
const s = src.bitmap.data;
const d = out.bitmap.data;
for (let y = 0; y < H; y++) {
  const ny = y + dy;
  if (ny < 0 || ny >= H) continue;
  for (let x = 0; x < W; x++) {
    const nx = x + dx;
    if (nx < 0 || nx >= W) continue;
    const si = (y * W + x) * 4;
    const di = (ny * W + nx) * 4;
    d[di] = s[si];
    d[di + 1] = s[si + 1];
    d[di + 2] = s[si + 2];
    d[di + 3] = s[si + 3];
  }
}
const buf = await out.getBuffer('image/png');
const { writeFileSync } = await import('node:fs');
writeFileSync(path, buf);

const after = opaqueBounds(out, manifest.validation?.minAlpha ?? 8);
console.log(
  `shifted ${building} by (${dx},${dy}); anchor unchanged at (${manifest.anchor.x},${manifest.anchor.y}).`,
);
console.log(
  `  new alpha bounds: ${after ? `x${after.x} y${after.y} w${after.w} h${after.h}` : '(empty)'}`,
);
console.log(`  next: npm run shadow:validate -- ${building}   then   npm run pack:atlas`);
