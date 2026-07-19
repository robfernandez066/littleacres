import { describe, expect, it } from 'vitest';

import overrideJsonRaw from '../../tools/shadow-overrides/farmhouse_shadow.json?raw';
import atlasJsonRaw from '../../assets/atlas.json?raw';
import { SHADOW_PLACEMENT_OVERRIDES, SHADOW_TUCK_RATIO } from '../config';
import { FARMHOUSE_FRAME, FARMHOUSE_RESTORED_FRAME, FARMHOUSE_SHADOW_FRAME } from '../data/restoration';

/**
 * Authored farmhouse cast-shadow (T3.28). The farmhouse shadow is hand-authored
 * (tools/shadow-overrides/farmhouse_shadow.png/.json) instead of generated, and
 * placed by an explicit anchor with zero runtime tuck. These tests pin the
 * registration contract: the authored metadata, the runtime placement table,
 * and the PACKED atlas entry must all agree. The atlas entry is the packer's
 * measurement of the PNG, so `sourceSize` proves the logical canvas size and
 * `spriteSourceSize.y` proves the shadow's alpha begins above the ground anchor.
 * The practical shape rules (upper edge above the anchor + one connected mass)
 * are enforced at pack time by loadAuthoredShadowOverride, which throws otherwise.
 */
interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
}

const meta = JSON.parse(overrideJsonRaw) as {
  frame: string;
  logicalWidth: number;
  logicalHeight: number;
  sourceFrameRect: { x: number; y: number; width: number; height: number };
  anchor: { x: number; y: number };
  tuckRatio: number;
};
const atlas = JSON.parse(atlasJsonRaw) as { frames: Record<string, AtlasFrame> };
const shadowFrame = atlas.frames.farmhouse_shadow;
if (shadowFrame === undefined) throw new Error('farmhouse_shadow missing from atlas.json');

describe('authored farmhouse shadow (T3.28)', () => {
  it('metadata pins the 412x385 canvas, the (259,280) anchor, and zero tuck', () => {
    expect(meta.frame).toBe('farmhouse_shadow');
    expect(meta.logicalWidth).toBe(412);
    expect(meta.logicalHeight).toBe(385);
    expect(meta.anchor).toEqual({ x: 259, y: 280 });
    expect(meta.sourceFrameRect).toEqual({ x: 131, y: 24, width: 256, height: 256 });
    expect(meta.tuckRatio).toBe(0);
    // Anchor is the registration frame's bottom-center.
    expect(meta.anchor.x).toBe(meta.sourceFrameRect.x + 128);
    expect(meta.anchor.y).toBe(meta.sourceFrameRect.y + 256);
  });

  it('runtime placement table matches the authored metadata and uses zero tuck', () => {
    const runtime = SHADOW_PLACEMENT_OVERRIDES.farmhouse_shadow;
    expect(runtime).toEqual({
      logicalWidth: 412,
      logicalHeight: 385,
      anchorX: 259,
      anchorY: 280,
      tuckRatio: 0,
    });
    // The authored branch drives placement off this table's zero tuckRatio, never
    // the global SHADOW_TUCK_RATIO (which still governs every generic shadow).
    expect(runtime?.tuckRatio).toBe(0);
    expect(SHADOW_TUCK_RATIO).not.toBe(0);
    // Table agrees with the packer-side metadata sidecar.
    expect(runtime?.logicalWidth).toBe(meta.logicalWidth);
    expect(runtime?.logicalHeight).toBe(meta.logicalHeight);
    expect(runtime?.anchorX).toBe(meta.anchor.x);
    expect(runtime?.anchorY).toBe(meta.anchor.y);
  });

  it('the override is scoped to the farmhouse only', () => {
    expect(Object.keys(SHADOW_PLACEMENT_OVERRIDES)).toEqual(['farmhouse_shadow']);
  });

  it('the packed atlas entry reconstructs the 412x385 logical canvas with trim y=232', () => {
    expect(shadowFrame).toBeDefined();
    expect(shadowFrame.trimmed).toBe(true);
    // sourceSize = logical canvas (== PNG dimensions == metadata).
    expect(shadowFrame.sourceSize).toEqual({ w: meta.logicalWidth, h: meta.logicalHeight });
    // spriteSourceSize = the packer's measured opaque top-left. y=232 is ABOVE
    // the ground anchor (280) - the ground-footprint shadow's upper edge tucks
    // under the building base; the whole shape trims to 309x98.
    expect(shadowFrame.spriteSourceSize.x).toBe(62);
    expect(shadowFrame.spriteSourceSize.y).toBe(232);
    expect(shadowFrame.spriteSourceSize.y).toBeLessThan(meta.anchor.y);
    expect(shadowFrame.frame.w).toBe(309);
    expect(shadowFrame.frame.h).toBe(98);
    // frame.x / frame.y are shelf-dependent and deliberately not asserted.
  });

  it('both farmhouse looks share the one authored shadow frame', () => {
    expect(FARMHOUSE_SHADOW_FRAME).toBe('farmhouse_shadow');
    expect(FARMHOUSE_FRAME).toBe('farmhouse');
    expect(FARMHOUSE_RESTORED_FRAME).toBe('farmhouse_restored');
    // The restored building reuses farmhouse_shadow; it has no _shadow of its own.
    expect(atlas.frames.farmhouse_restored_shadow).toBeUndefined();
  });

  it('generic generated shadows are untouched by the override', () => {
    // A representative generic shadow still exists and is NOT the authored canvas.
    const generic = atlas.frames.decor_well_shadow;
    expect(generic).toBeDefined();
    if (generic === undefined) throw new Error('decor_well_shadow missing from atlas.json');
    expect(generic.trimmed).toBe(true);
    expect(generic.sourceSize).not.toEqual({ w: 412, h: 385 });
    // Only the farmhouse carries an authored placement override.
    for (const name of Object.keys(atlas.frames)) {
      if (name.endsWith('_shadow') && name !== 'farmhouse_shadow') {
        expect(SHADOW_PLACEMENT_OVERRIDES[name]).toBeUndefined();
      }
    }
  });
});
