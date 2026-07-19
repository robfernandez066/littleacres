/**
 * shadow:new (T3.29) - scaffold a new authored building shadow from the ACTUAL
 * packed source frame. Generic: works for any frame size (no 256/128/256 assumed).
 *
 * Usage: node tools/shadow-new.mjs <building> [--source <frame>] [--scale N]
 *   Measures the source frame's real alpha (never the black matte / full frame
 *   box), proposes a logical canvas with room for a lower-left cast, and derives
 *   the ground point as the silhouette's base-centre. Writes:
 *     tools/shadow-overrides/<building>_shadow.png            (blank, transparent)
 *     tools/shadow-overrides/<building>_shadow.json           (manifest)
 *     tools/shadow-overrides/<building>_shadow.registration.png (guide overlay)
 *   Refuses to overwrite an existing manifest/PNG.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Jimp, deriveAnchor, manifestPath, opaqueBounds, overrideDir, pngPath } from './shadow-lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const building = process.argv[2];
if (!building || building.startsWith('--')) {
  console.error('usage: node tools/shadow-new.mjs <building> [--source <frame>] [--scale N]');
  process.exit(1);
}
const sourceFrame = arg('--source', building);
const previewScale = Number(arg('--scale', '1')) || 1;

const outJson = manifestPath(repoRoot, building);
const outPng = pngPath(repoRoot, building);
if (existsSync(outJson) || existsSync(outPng)) {
  console.error(`refusing to overwrite existing ${building} shadow. Delete it first if you mean to re-scaffold.`);
  process.exit(1);
}

const atlasJson = JSON.parse(readFileSync(join(repoRoot, 'assets', 'atlas.json'), 'utf8'));
const f = atlasJson.frames[sourceFrame];
if (!f) {
  console.error(`atlas has no frame "${sourceFrame}". Run npm run pack:atlas, or pass --source <frame>.`);
  process.exit(1);
}

// Reconstruct the full (untrimmed) source frame from the atlas.
const atlasImg = await Jimp.read(join(repoRoot, 'assets', 'atlas.png'));
const cut = atlasImg.clone().crop({ x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h });
const srcW = f.sourceSize.w;
const srcH = f.sourceSize.h;
const source = new Jimp({ width: srcW, height: srcH });
source.composite(cut, f.spriteSourceSize?.x ?? 0, f.spriteSourceSize?.y ?? 0);

// Silhouette (real alpha, not the frame box). Ground point = base-centre.
const sil = opaqueBounds(source, 40);
if (!sil) {
  console.error(`${sourceFrame}: source frame is empty`);
  process.exit(1);
}
const groundPoint = { x: Math.round(sil.x + sil.w / 2), y: sil.y + sil.h - 1 };

// Logical canvas: room for a lower-left cast (proportional to the frame).
const castLeft = Math.round(srcW * 0.5);
const marginT = Math.round(srcH * 0.1);
const marginR = Math.round(srcW * 0.1);
const castDown = Math.round(srcH * 0.42);
const rect = { x: castLeft, y: marginT, width: srcW, height: srcH };
const logicalWidth = castLeft + srcW + marginR;
const logicalHeight = marginT + srcH + castDown;

const manifest = {
  building,
  frame: `${building}_shadow`,
  sourceFrame,
  variants: [],
  logicalWidth,
  logicalHeight,
  sourceFrameRect: rect,
  sourceGroundPoint: groundPoint,
  previewScale,
  tuckRatio: 0,
  validation: { minAlpha: 8, requireSingleComponent: true, requireUpperEdgeAboveAnchor: true },
  description: 'Scaffolded by shadow:new. Draw the shadow into the PNG (pure black, authored alpha), then npm run shadow:validate and pack:atlas. Adjust sourceGroundPoint/previewScale if the guide looks off.',
};
const anchor = deriveAnchor(manifest);

// Blank transparent authored canvas.
const png = new Jimp({ width: logicalWidth, height: logicalHeight });
writeFileSync(outPng, await png.getBuffer('image/png'));
writeFileSync(outJson, JSON.stringify(manifest, null, 2) + '\n');

// Registration guide: the dimmed source frame placed at the rect, with the rect
// outline, the ground point, and the derived anchor marked.
const guide = new Jimp({ width: logicalWidth, height: logicalHeight, color: 0x202020ff });
const dim = source.clone();
const dd = dim.bitmap.data;
for (let i = 3; i < dd.length; i += 4) dd[i] = Math.round(dd[i] * 0.6);
guide.composite(dim, rect.x, rect.y);
const gd = guide.bitmap.data;
const setPx = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= logicalWidth || y >= logicalHeight) return;
  const i = (y * logicalWidth + x) * 4;
  gd[i] = r;
  gd[i + 1] = g;
  gd[i + 2] = b;
  gd[i + 3] = 255;
};
const hline = (x0, x1, y, r, g, b) => {
  for (let x = x0; x <= x1; x++) setPx(x, y, r, g, b);
};
const vline = (x, y0, y1, r, g, b) => {
  for (let y = y0; y <= y1; y++) setPx(x, y, r, g, b);
};
// blue rect = source frame registration
hline(rect.x, rect.x + rect.width - 1, rect.y, 40, 130, 255);
hline(rect.x, rect.x + rect.width - 1, rect.y + rect.height - 1, 40, 130, 255);
vline(rect.x, rect.y, rect.y + rect.height - 1, 40, 130, 255);
vline(rect.x + rect.width - 1, rect.y, rect.y + rect.height - 1, 40, 130, 255);
// magenta cross = derived anchor (ground point)
for (let k = -10; k <= 10; k++) {
  setPx(anchor.x + k, anchor.y, 255, 0, 255);
  setPx(anchor.x, anchor.y + k, 255, 0, 255);
}
writeFileSync(join(overrideDir(repoRoot), `${building}_shadow.registration.png`), await guide.getBuffer('image/png'));

console.log(`scaffolded authored shadow for "${building}" (source frame "${sourceFrame}", ${srcW}x${srcH}):`);
console.log(`  logical canvas : ${logicalWidth} x ${logicalHeight}`);
console.log(`  sourceFrameRect: (${rect.x},${rect.y},${rect.width},${rect.height})`);
console.log(`  groundPoint    : (${groundPoint.x},${groundPoint.y})  ->  derived anchor (${anchor.x},${anchor.y})`);
console.log(`  wrote: ${outPng}`);
console.log(`         ${outJson}`);
console.log(`         ${building}_shadow.registration.png  (open this to draw the shadow against the base)`);
console.log(`  next: draw the shadow -> npm run shadow:validate -- ${building} -> npm run shadow:gen -> npm run pack:atlas`);
