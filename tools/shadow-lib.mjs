/**
 * Authored building-shadow workflow - shared library (T3.29).
 *
 * ONE source of truth for how an authored `<building>_shadow` PNG + JSON manifest
 * turn into a packed atlas frame and a runtime placement record. Imported by:
 *   - tools/pack-atlas.mjs        (bakes the override frame at pack time)
 *   - tools/gen-shadow-placements.mjs  (generates src/generated/shadowPlacements.ts)
 *   - tools/shadow-{new,validate,shift,capture}.mjs  (the CLI workflow)
 *
 * Design rules (see docs/SHADOW_WORKFLOW.md):
 *   - The JSON manifest is the single source of truth. Nothing here is
 *     farmhouse-specific and nothing assumes a 256x256 frame.
 *   - The anchor is DERIVED, never stored:
 *       anchor = sourceFrameRect.position + sourceGroundPoint
 *   - RGB is forced to pure black; only authored alpha survives.
 *   - Runtime placement values are generated from this same derivation, so JSON
 *     and TypeScript can never drift.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { Jimp } from 'jimp';

/** Default alpha floor for "visible" pixels (a manifest may override per shadow). */
export const DEFAULT_MIN_ALPHA = 8;
/** Smallest blob (px) counted as a "major" connected component. */
export const MAJOR_COMPONENT_MIN_PX = 400;

/** Read + parse a `<building>_shadow.json` manifest and attach its derived anchor. */
export function readManifest(jsonPath) {
  const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const errors = validateManifestShape(raw);
  if (errors.length > 0) {
    throw new Error(`${basename(jsonPath)}: invalid manifest:\n  - ${errors.join('\n  - ')}`);
  }
  return { ...raw, anchor: deriveAnchor(raw), _path: jsonPath };
}

/**
 * The derived anchor - the building's ground point in logical-canvas pixels.
 * Generic: works for any frame size and any ground point (no +128/+256).
 */
export function deriveAnchor(m) {
  return {
    x: m.sourceFrameRect.x + m.sourceGroundPoint.x,
    y: m.sourceFrameRect.y + m.sourceGroundPoint.y,
  };
}

/** Structural validation of the manifest JSON alone (no image needed). */
export function validateManifestShape(m) {
  const errs = [];
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const int = (v) => num(v) && Number.isInteger(v);
  if (typeof m.building !== 'string' || m.building.length === 0) errs.push('building must be a non-empty string');
  if (typeof m.frame !== 'string' || !m.frame.endsWith('_shadow')) errs.push('frame must be a string ending in "_shadow"');
  if (typeof m.sourceFrame !== 'string' || m.sourceFrame.length === 0) errs.push('sourceFrame must be a non-empty string');
  if (m.variants !== undefined && !Array.isArray(m.variants)) errs.push('variants, if present, must be an array of frame names');
  if (!int(m.logicalWidth) || m.logicalWidth <= 0) errs.push('logicalWidth must be a positive integer');
  if (!int(m.logicalHeight) || m.logicalHeight <= 0) errs.push('logicalHeight must be a positive integer');
  const r = m.sourceFrameRect;
  if (!r || !int(r.x) || !int(r.y) || !int(r.width) || !int(r.height)) errs.push('sourceFrameRect needs integer x,y,width,height');
  const g = m.sourceGroundPoint;
  if (!g || !int(g.x) || !int(g.y)) errs.push('sourceGroundPoint needs integer x,y');
  if (!num(m.tuckRatio)) errs.push('tuckRatio must be a number');
  if (errs.length > 0) return errs;
  // Geometry: the registration rect and ground point must sit inside the canvas.
  if (r.x < 0 || r.y < 0 || r.x + r.width > m.logicalWidth || r.y + r.height > m.logicalHeight)
    errs.push(`sourceFrameRect (${r.x},${r.y},${r.width},${r.height}) lies outside the ${m.logicalWidth}x${m.logicalHeight} canvas`);
  if (g.x < 0 || g.x > r.width || g.y < 0 || g.y > r.height)
    errs.push(`sourceGroundPoint (${g.x},${g.y}) lies outside the source frame (${r.width}x${r.height})`);
  const a = deriveAnchor(m);
  if (a.x < 0 || a.x > m.logicalWidth || a.y < 0 || a.y > m.logicalHeight)
    errs.push(`derived anchor (${a.x},${a.y}) lies outside the logical canvas`);
  return errs;
}

/** Opaque bounds (alpha > threshold) of a Jimp image, or null if fully transparent. */
export function opaqueBounds(image, threshold = DEFAULT_MIN_ALPHA) {
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

/** Count connected components (4-neighbour) of alpha>threshold larger than minSize. */
export function majorComponents(image, threshold = DEFAULT_MIN_ALPHA, minSize = MAJOR_COMPONENT_MIN_PX) {
  const { width, height, data } = image.bitmap;
  const seen = new Uint8Array(width * height);
  const stack = [];
  let major = 0;
  for (let i = 0; i < width * height; i++) {
    if (seen[i]) continue;
    seen[i] = 1;
    if (data[i * 4 + 3] <= threshold) continue;
    let size = 0;
    stack.length = 0;
    stack.push(i);
    while (stack.length > 0) {
      const p = stack.pop();
      size++;
      const px = p % width;
      const py = (p - px) / width;
      const neighbours = [
        [px - 1, py],
        [px + 1, py],
        [px, py - 1],
        [px, py + 1],
      ];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (seen[q]) continue;
        seen[q] = 1;
        if (data[q * 4 + 3] > threshold) stack.push(q);
      }
    }
    if (size > minSize) major++;
  }
  return major;
}

/** True if any opaque pixel touches the canvas edge (i.e. the shape would clip). */
export function touchesEdge(image, threshold = DEFAULT_MIN_ALPHA) {
  const b = opaqueBounds(image, threshold);
  if (b === null) return false;
  return b.x <= 0 || b.y <= 0 || b.x + b.w >= image.bitmap.width || b.y + b.h >= image.bitmap.height;
}

/**
 * Validate an authored shadow image against its manifest. Returns
 * { ok, errors[], warnings[], stats }. Applies the manifest's `validation`
 * settings (all optional): minAlpha, requireSingleComponent,
 * requireUpperEdgeAboveAnchor.
 */
export function validateAuthoredImage(image, m) {
  const v = m.validation ?? {};
  const minAlpha = v.minAlpha ?? DEFAULT_MIN_ALPHA;
  const errors = [];
  const warnings = [];
  const { width, height, data } = image.bitmap;
  const anchor = deriveAnchor(m);

  if (width !== m.logicalWidth || height !== m.logicalHeight)
    errors.push(`PNG is ${width}x${height} but manifest says ${m.logicalWidth}x${m.logicalHeight}`);

  let maxAlpha = 0;
  let nonBlack = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a > maxAlpha) maxAlpha = a;
    if (a > 0 && (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0)) nonBlack++;
  }
  if (nonBlack > 0) warnings.push(`${nonBlack} visible pixel(s) are not pure black (the packer will force black)`);

  const bounds = opaqueBounds(image, minAlpha);
  if (bounds === null) {
    errors.push('shadow is empty (no alpha above the minAlpha floor)');
    return { ok: false, errors, warnings, stats: { anchor, maxAlpha, bounds: null, components: 0 } };
  }
  if (touchesEdge(image, minAlpha)) errors.push('shadow clips the logical-canvas edge; enlarge the canvas or shift inward');

  const components = majorComponents(image, minAlpha);
  if ((v.requireSingleComponent ?? false) && components !== 1)
    errors.push(`shadow forms ${components} major components; must be one continuous shape`);

  if ((v.requireUpperEdgeAboveAnchor ?? false) && bounds.y >= anchor.y)
    errors.push(`shadow's upper edge (y=${bounds.y}) is not above its ground anchor (y=${anchor.y}); it would render detached below the building`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: { anchor, maxAlpha, bounds, components },
  };
}

/**
 * Produce the packed frame from an authored shadow: force pure-black RGB, then
 * trim to opaque bounds, returning the trimmed image plus trim metadata in the
 * exact shape pack-atlas.mjs expects (spriteSourceSize / sourceSize).
 */
export function buildPackedOverride(image, m) {
  const minAlpha = m.validation?.minAlpha ?? DEFAULT_MIN_ALPHA;
  const data = image.bitmap.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  }
  const bounds = opaqueBounds(image, minAlpha);
  if (bounds === null) throw new Error(`${m.building}: authored shadow is fully transparent`);
  const trimmed = image.clone().crop(bounds);
  return {
    image: trimmed,
    trim: { x: bounds.x, y: bounds.y, sourceW: m.logicalWidth, sourceH: m.logicalHeight },
  };
}

/** The runtime placement record for a manifest (what the generated TS holds). */
export function placementRecord(m) {
  const anchor = deriveAnchor(m);
  return {
    logicalWidth: m.logicalWidth,
    logicalHeight: m.logicalHeight,
    anchorX: anchor.x,
    anchorY: anchor.y,
    tuckRatio: m.tuckRatio,
  };
}

/** The richer record the dev ShadowLab preview needs (never used by the game). */
export function labRecord(m) {
  const a = deriveAnchor(m);
  return {
    building: m.building,
    frame: m.frame,
    sourceFrame: m.sourceFrame,
    variants: m.variants ?? [],
    logicalWidth: m.logicalWidth,
    logicalHeight: m.logicalHeight,
    sourceFrameWidth: m.sourceFrameRect.width,
    sourceFrameHeight: m.sourceFrameRect.height,
    groundPointX: m.sourceGroundPoint.x,
    groundPointY: m.sourceGroundPoint.y,
    anchorX: a.x,
    anchorY: a.y,
    tuckRatio: m.tuckRatio,
    previewScale: m.previewScale ?? 1,
  };
}

/** Path helpers so every tool agrees on where overrides live. */
export function overrideDir(repoRoot) {
  return join(repoRoot, 'tools', 'shadow-overrides');
}
export function manifestPath(repoRoot, building) {
  return join(overrideDir(repoRoot), `${building}_shadow.json`);
}
export function pngPath(repoRoot, building) {
  return join(overrideDir(repoRoot), `${building}_shadow.png`);
}

/** Load a Jimp image (thin re-export so CLIs don't each import Jimp). */
export async function readImage(path) {
  if (!existsSync(path)) throw new Error(`image not found: ${path}`);
  return Jimp.read(path);
}

/** List every authored building (by manifest) under tools/shadow-overrides. */
export function listBuildings(repoRoot) {
  const dir = overrideDir(repoRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('_shadow.json'))
    .map((f) => f.replace(/_shadow\.json$/, ''))
    .sort();
}

export { Jimp, dirname };
