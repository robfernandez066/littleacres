import type { ShadowPlacementOverride } from '../config';

/**
 * Place an authored building shadow (T3.28, shared since T3.29).
 *
 * The authored `<building>_shadow` frame carries its own contact geometry, so it
 * ignores the generic SHADOW_TUCK_RATIO / SHADOW_CANVAS_PAD math: its explicit
 * logical anchor (the building's ground point, in logical-canvas pixels) is put
 * directly on the object's ground point, scaled like the building. This is the
 * ONE placement path used by both FarmScene (in-game) and ShadowLabScene (dev
 * preview), so a preview can never diverge from the real render.
 *
 * The shadow's frame `realWidth`/`realHeight` are its full (untrimmed) logical
 * canvas - reconstructed by Phaser from the atlas trim metadata - so origin
 * `anchorX/logicalWidth` lands the anchor exactly regardless of packing.
 */
export function placeAuthoredShadow(
  shadow: Phaser.GameObjects.Image,
  placement: ShadowPlacementOverride,
  opts: {
    x: number;
    baseY: number;
    scaleX: number;
    scaleY: number;
    flipX: boolean;
    depth: number;
  },
): void {
  const canvasW = shadow.frame.realWidth;
  const canvasH = shadow.frame.realHeight;
  if (canvasW !== placement.logicalWidth || canvasH !== placement.logicalHeight) {
    throw new Error(
      `${shadow.frame.name}: runtime logical size ${canvasW}x${canvasH} does not ` +
        `match placement metadata ${placement.logicalWidth}x${placement.logicalHeight}`,
    );
  }
  if (opts.flipX) {
    throw new Error(`${shadow.frame.name}: authored shadow does not support horizontal flipping`);
  }
  shadow
    .setOrigin(placement.anchorX / canvasW, placement.anchorY / canvasH)
    .setPosition(opts.x, opts.baseY - canvasH * opts.scaleY * placement.tuckRatio)
    .setScale(opts.scaleX, opts.scaleY)
    .setFlipX(false)
    .setDepth(opts.depth);
}
