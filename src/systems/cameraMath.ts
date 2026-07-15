/**
 * Camera gesture math (T3.4b): every pan/pinch/zoom number the FarmScene
 * camera needs, parameterized by plain objects so it stays Phaser-free and
 * unit-testable (seedBarLayout.ts precedent).
 *
 * Coordinate conventions (matching Phaser's Camera exactly):
 * - `scrollX/scrollY` are Phaser camera scroll values: the camera's world
 *   center sits at (scrollX + viewport.width / 2, scrollY + viewport.height / 2)
 *   and zoom scales around that center.
 * - The visible world rect at zoom z is therefore viewport.width / z wide,
 *   centered on that point.
 * - "Screen" coordinates are design-resolution pixels (what Phaser pointers
 *   report), world coordinates are design pixels in the farm's own space.
 */

export interface Viewport {
  width: number;
  height: number;
}

export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScrollPoint {
  scrollX: number;
  scrollY: number;
}

/** Legal scroll range at a given zoom; min > max never escapes this module
 *  (a collapsed axis clamps to its centered midpoint instead). */
export interface ScrollRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The zoom that exactly fits the owned land inside the viewport - the
 * gesture zoom-out limit. min of the two per-axis fits, so the WHOLE owned
 * bounds is visible (the shorter axis letterboxes against the world edge and
 * clampScroll centers it). Today owned land IS the 1080x1920 world and the
 * viewport is the same 1080x1920 design resolution, so this is exactly 1.
 */
export function fitZoom(ownedBounds: WorldBounds, viewport: Viewport): number {
  return Math.min(viewport.width / ownedBounds.width, viewport.height / ownedBounds.height);
}

/**
 * Clamp a desired zoom to the legal gesture range [fit, maxIn]. If the two
 * limits ever cross (a huge farm whose fit zoom exceeds the max zoom-in),
 * the fit bound wins - the player can always see their whole farm.
 */
export function clampZoom(desired: number, fit: number, maxIn: number): number {
  return Math.min(Math.max(desired, fit), Math.max(maxIn, fit));
}

/**
 * The scroll range that keeps the visible world rect inside `worldBounds` at
 * `zoom`. When the visible rect is at least as large as the bounds on an
 * axis (zoom at or below that axis's fit), the axis collapses to the single
 * centered value.
 */
export function scrollRange(
  zoom: number,
  worldBounds: WorldBounds,
  viewport: Viewport,
): ScrollRange {
  const halfW = viewport.width / 2;
  const halfH = viewport.height / 2;
  const visibleHalfW = viewport.width / (2 * zoom);
  const visibleHalfH = viewport.height / (2 * zoom);
  let minX = worldBounds.x + visibleHalfW - halfW;
  let maxX = worldBounds.x + worldBounds.width - visibleHalfW - halfW;
  let minY = worldBounds.y + visibleHalfH - halfH;
  let maxY = worldBounds.y + worldBounds.height - visibleHalfH - halfH;
  if (minX > maxX) {
    minX = maxX = worldBounds.x + worldBounds.width / 2 - halfW;
  }
  if (minY > maxY) {
    minY = maxY = worldBounds.y + worldBounds.height / 2 - halfH;
  }
  return { minX, maxX, minY, maxY };
}

/** Hard-clamp a scroll position into the legal range at `zoom` (see scrollRange). */
export function clampScroll(
  scrollX: number,
  scrollY: number,
  zoom: number,
  worldBounds: WorldBounds,
  viewport: Viewport,
): ScrollPoint {
  const range = scrollRange(zoom, worldBounds, viewport);
  return {
    scrollX: Math.min(Math.max(scrollX, range.minX), range.maxX),
    scrollY: Math.min(Math.max(scrollY, range.minY), range.maxY),
  };
}

/**
 * Soft edge overshoot for a live drag: linear inside [min, max], diminishing
 * returns outside - the overshoot maps through tanh so it approaches (never
 * reaches) `give` px past the edge, and its slope at the edge is exactly 1,
 * so crossing the boundary mid-drag has no visible kink. The release
 * snap-back tween (scene-side) returns to the hard-clamped value. A
 * non-positive `give` degrades to a hard clamp.
 */
export function rubberBand(desired: number, min: number, max: number, give: number): number {
  if (min > max) {
    const mid = (min + max) / 2;
    min = mid;
    max = mid;
  }
  if (give <= 0) return Math.min(Math.max(desired, min), max);
  if (desired < min) return min - give * Math.tanh((min - desired) / give);
  if (desired > max) return max + give * Math.tanh((desired - max) / give);
  return desired;
}

/**
 * Pinch zoom: scale the gesture-start zoom by the finger-distance ratio,
 * clamped to [fit, maxIn]. A degenerate start distance (both touches at one
 * point) holds the start zoom rather than dividing by zero.
 */
export function pinchZoom(
  startZoom: number,
  startDist: number,
  currentDist: number,
  fit: number,
  maxIn: number,
): number {
  if (startDist <= 0) return clampZoom(startZoom, fit, maxIn);
  return clampZoom((startZoom * currentDist) / startDist, fit, maxIn);
}

/**
 * The scroll that puts world point (worldX, worldY) exactly under screen
 * point (screenX, screenY) at `zoom` - the anchor invariant behind both
 * pinch (the world point under the pinch midpoint stays under the midpoint)
 * and wheel zoom (the world point under the cursor stays under the cursor).
 * Unclamped by design: callers clamp the result via clampScroll.
 *
 * Derivation from Phaser's camera transform (zoom about the viewport
 * center): worldX = scrollX + vw/2 + (screenX - vw/2) / zoom, solved for
 * scrollX.
 */
export function scrollForAnchor(
  worldX: number,
  worldY: number,
  screenX: number,
  screenY: number,
  zoom: number,
  viewport: Viewport,
): ScrollPoint {
  return {
    scrollX: worldX - viewport.width / 2 + (viewport.width / 2 - screenX) / zoom,
    scrollY: worldY - viewport.height / 2 + (viewport.height / 2 - screenY) / zoom,
  };
}
