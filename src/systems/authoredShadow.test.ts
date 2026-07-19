import { describe, expect, it } from 'vitest';

import overrideJsonRaw from '../../tools/shadow-overrides/farmhouse_shadow.json?raw';
import atlasJsonRaw from '../../assets/atlas.json?raw';
import { SHADOW_PLACEMENT_OVERRIDES, SHADOW_TUCK_RATIO } from '../config';
import { SHADOW_LAB_ENTRIES } from '../generated/shadowLab';
import { FARMHOUSE_FRAME, FARMHOUSE_RESTORED_FRAME, FARMHOUSE_SHADOW_FRAME } from '../data/restoration';

/**
 * Authored building-shadow workflow (T3.28, generalized T3.29). The manifest
 * (tools/shadow-overrides/<b>_shadow.json) is the single source of truth: the
 * anchor is DERIVED (sourceFrameRect + sourceGroundPoint), the runtime table and
 * the lab manifest are GENERATED from it, and the packed atlas frame is measured
 * from the PNG. These tests pin the derivation and prove nothing drifts between
 * the JSON, the generated TypeScript, and the atlas. The farmhouse is the
 * reference authored shadow; per-pixel shape rules are enforced at pack time by
 * tools/shadow-lib.mjs (validateAuthoredImage).
 */
interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
}
interface Manifest {
  building: string;
  frame: string;
  sourceFrame: string;
  variants: string[];
  logicalWidth: number;
  logicalHeight: number;
  sourceFrameRect: { x: number; y: number; width: number; height: number };
  sourceGroundPoint: { x: number; y: number };
  tuckRatio: number;
  previewScale?: number;
}

const manifest = JSON.parse(overrideJsonRaw) as Manifest;
const atlas = JSON.parse(atlasJsonRaw) as { frames: Record<string, AtlasFrame> };
const shadowFrame = atlas.frames.farmhouse_shadow;
if (shadowFrame === undefined) throw new Error('farmhouse_shadow missing from atlas.json');

/** The one anchor derivation - mirrored from tools/shadow-lib.mjs deriveAnchor. */
const derivedAnchor = {
  x: manifest.sourceFrameRect.x + manifest.sourceGroundPoint.x,
  y: manifest.sourceFrameRect.y + manifest.sourceGroundPoint.y,
};

describe('authored building-shadow workflow (T3.29)', () => {
  it('manifest carries a generalized schema (no stored anchor, no 256 assumptions)', () => {
    expect(manifest.building).toBe('farmhouse');
    expect(manifest.frame).toBe('farmhouse_shadow');
    expect(manifest.sourceFrame).toBe('farmhouse');
    expect(manifest.variants).toEqual(['farmhouse_restored']);
    expect(manifest.logicalWidth).toBe(412);
    expect(manifest.logicalHeight).toBe(385);
    expect(manifest.sourceFrameRect).toEqual({ x: 131, y: 24, width: 256, height: 256 });
    expect(manifest.sourceGroundPoint).toEqual({ x: 128, y: 256 });
    expect(manifest.tuckRatio).toBe(0);
    // The anchor is NOT stored - it is derived.
    expect((manifest as unknown as { anchor?: unknown }).anchor).toBeUndefined();
    expect(derivedAnchor).toEqual({ x: 259, y: 280 });
  });

  it('generated runtime table matches the DERIVED anchor (no JSON/TS drift)', () => {
    const runtime = SHADOW_PLACEMENT_OVERRIDES.farmhouse_shadow;
    expect(runtime).toEqual({
      logicalWidth: manifest.logicalWidth,
      logicalHeight: manifest.logicalHeight,
      anchorX: derivedAnchor.x,
      anchorY: derivedAnchor.y,
      tuckRatio: manifest.tuckRatio,
    });
    // The authored shadow uses its own zero tuck, never the global (which still
    // governs every generic shadow and must remain non-zero).
    expect(runtime?.tuckRatio).toBe(0);
    expect(SHADOW_TUCK_RATIO).not.toBe(0);
  });

  it('the override is scoped to the farmhouse only', () => {
    expect(Object.keys(SHADOW_PLACEMENT_OVERRIDES)).toEqual(['farmhouse_shadow']);
  });

  it('generated lab manifest matches the source manifest (variant, anchor, scale)', () => {
    const lab = SHADOW_LAB_ENTRIES.farmhouse;
    expect(lab).toBeDefined();
    if (lab === undefined) throw new Error('farmhouse lab entry missing');
    expect(lab.frame).toBe('farmhouse_shadow');
    expect(lab.sourceFrame).toBe('farmhouse');
    expect(lab.variants).toEqual(['farmhouse_restored']);
    expect(lab.anchorX).toBe(derivedAnchor.x);
    expect(lab.anchorY).toBe(derivedAnchor.y);
    expect(lab.sourceFrameWidth).toBe(256);
    expect(lab.sourceFrameHeight).toBe(256);
    expect(lab.previewScale).toBe(manifest.previewScale);
  });

  it('the packed atlas frame reconstructs the 412x385 logical canvas', () => {
    expect(shadowFrame.trimmed).toBe(true);
    expect(shadowFrame.sourceSize).toEqual({ w: manifest.logicalWidth, h: manifest.logicalHeight });
    // Measured trim of the ground-footprint shadow; y=232 is above the anchor 280.
    expect(shadowFrame.spriteSourceSize.x).toBe(62);
    expect(shadowFrame.spriteSourceSize.y).toBe(232);
    expect(shadowFrame.spriteSourceSize.y).toBeLessThan(derivedAnchor.y);
    expect(shadowFrame.frame.w).toBe(309);
    expect(shadowFrame.frame.h).toBe(98);
  });

  it('both farmhouse looks (incl. the variant) share the one authored shadow frame', () => {
    expect(FARMHOUSE_SHADOW_FRAME).toBe('farmhouse_shadow');
    expect(FARMHOUSE_FRAME).toBe('farmhouse');
    expect(FARMHOUSE_RESTORED_FRAME).toBe('farmhouse_restored');
    expect(manifest.variants).toContain('farmhouse_restored');
    // The variant reuses farmhouse_shadow; it has no _shadow frame of its own.
    expect(atlas.frames.farmhouse_restored_shadow).toBeUndefined();
  });

  it('generic generated shadows are untouched by the authored override', () => {
    const generic = atlas.frames.decor_well_shadow;
    expect(generic).toBeDefined();
    if (generic === undefined) throw new Error('decor_well_shadow missing from atlas.json');
    expect(generic.trimmed).toBe(true);
    expect(generic.sourceSize).not.toEqual({ w: 412, h: 385 });
    for (const name of Object.keys(atlas.frames)) {
      if (name.endsWith('_shadow') && name !== 'farmhouse_shadow') {
        expect(SHADOW_PLACEMENT_OVERRIDES[name]).toBeUndefined();
      }
    }
  });
});
