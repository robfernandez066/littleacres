/**
 * shadow:validate (T3.29) - validate one (or all) authored building shadow(s).
 *
 * Usage: node tools/shadow-validate.mjs [building]
 *   With no argument, validates every authored shadow. Checks: manifest shape,
 *   derived anchor, PNG dimensions vs manifest, pure-black RGB, non-empty alpha,
 *   edge clipping, connected shape, upper-edge-above-anchor, and - if
 *   assets/atlas.json exists - that the packed atlas frame's trim metadata is
 *   consistent with the authored PNG. Exits non-zero on any error.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildPackedOverride,
  deriveAnchor,
  listBuildings,
  manifestPath,
  opaqueBounds,
  pngPath,
  readImage,
  readManifest,
  validateAuthoredImage,
} from './shadow-lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const atlasJsonPath = join(repoRoot, 'assets', 'atlas.json');
const atlas = existsSync(atlasJsonPath) ? JSON.parse(readFileSync(atlasJsonPath, 'utf8')) : null;

async function validateOne(building) {
  const errors = [];
  const warnings = [];
  const mp = manifestPath(repoRoot, building);
  const pp = pngPath(repoRoot, building);
  if (!existsSync(mp)) return { building, errors: [`missing manifest ${mp}`], warnings };
  if (!existsSync(pp)) return { building, errors: [`missing PNG ${pp}`], warnings };

  const manifest = readManifest(mp); // throws on structural manifest errors
  const anchor = deriveAnchor(manifest);
  const image = await readImage(pp);
  const report = validateAuthoredImage(image, manifest);
  errors.push(...report.errors);
  warnings.push(...report.warnings);

  // Atlas trim consistency: recompute the trim the packer would emit and compare
  // to the packed frame (if the atlas has been built). Positions (frame.x/y) are
  // shelf placement and are NOT checked.
  if (atlas && report.ok) {
    const frame = atlas.frames?.[manifest.frame];
    if (!frame) {
      warnings.push(`atlas has no "${manifest.frame}" frame yet (run npm run pack:atlas)`);
    } else {
      const cloned = image.clone();
      const packed = buildPackedOverride(cloned, manifest);
      const expect = {
        sourceSize: { w: packed.trim.sourceW, h: packed.trim.sourceH },
        spriteSourceSize: {
          x: packed.trim.x,
          y: packed.trim.y,
          w: packed.image.bitmap.width,
          h: packed.image.bitmap.height,
        },
        frame: { w: packed.image.bitmap.width, h: packed.image.bitmap.height },
      };
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      if (!same(frame.sourceSize, expect.sourceSize)) errors.push(`atlas sourceSize ${JSON.stringify(frame.sourceSize)} != expected ${JSON.stringify(expect.sourceSize)}`);
      if (!same(frame.spriteSourceSize, expect.spriteSourceSize)) errors.push(`atlas spriteSourceSize ${JSON.stringify(frame.spriteSourceSize)} != expected ${JSON.stringify(expect.spriteSourceSize)}`);
      if (frame.frame.w !== expect.frame.w || frame.frame.h !== expect.frame.h) errors.push(`atlas frame ${frame.frame.w}x${frame.frame.h} != expected ${expect.frame.w}x${expect.frame.h}`);
    }
  }

  const bounds = opaqueBounds(image, manifest.validation?.minAlpha ?? 8);
  return {
    building,
    anchor,
    stats: report.stats,
    bounds,
    errors,
    warnings,
  };
}

const target = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const buildings = target ? [target] : listBuildings(repoRoot);
if (buildings.length === 0) {
  console.log('no authored shadows found under tools/shadow-overrides/');
  process.exit(0);
}

let failed = 0;
for (const b of buildings) {
  const r = await validateOne(b);
  const ok = r.errors.length === 0;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${b}`);
  if (r.anchor) console.log(`  derived anchor: (${r.anchor.x}, ${r.anchor.y})`);
  if (r.stats) console.log(`  alpha bounds: ${r.stats.bounds ? `x${r.stats.bounds.x} y${r.stats.bounds.y} w${r.stats.bounds.w} h${r.stats.bounds.h}` : '(empty)'}  maxAlpha ${r.stats.maxAlpha}  components ${r.stats.components}`);
  for (const w of r.warnings) console.log(`  warn: ${w}`);
  for (const e of r.errors) console.log(`  error: ${e}`);
  if (!ok) failed++;
}
console.log('');
if (failed > 0) {
  console.error(`${failed} authored shadow(s) failed validation.`);
  process.exit(1);
}
console.log('all authored shadows valid.');
