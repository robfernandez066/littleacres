import Phaser from 'phaser';

import { HUD_MOONDUST_POSITION } from '../config';
import { registerPoolStats } from '../systems/pool';
import { PooledArc } from './PooledArc';

/**
 * Moondust-flight effect: moondust sprites arc from a source point to the HUD
 * moondust position. Thin wrapper over the shared `PooledArc` flight/pool
 * mechanics, fixed to the 'moondust' frame and the HUD moondust target -
 * exactly CoinArc's pattern (T2.23c).
 */

/**
 * Hard cap on sprites per `fly` call, same guard CoinArc applies - moondust
 * grants are always small (1-2 per chest/order today) so this never actually
 * triggers, but nothing should scale unboundedly if that ever changes.
 */
export const MAX_MOONDUST_PER_FLY = 8;

/** Moondust atlas frame is 96x96; start a bit over half size, shrink en route. */
const START_SCALE = 0.6;
const END_SCALE = 0.35;

/** Above everything, including the seed bar (2000) and the panel (2100). */
const MOONDUST_ARC_DEPTH = 2200;

export class MoondustArc {
  private readonly arc: PooledArc;

  constructor(scene: Phaser.Scene) {
    this.arc = new PooledArc(scene, {
      targetX: HUD_MOONDUST_POSITION.x,
      targetY: HUD_MOONDUST_POSITION.y,
      depth: MOONDUST_ARC_DEPTH,
      startScale: START_SCALE,
      endScale: END_SCALE,
      maxPerFly: MAX_MOONDUST_PER_FLY,
      defaultFrame: 'moondust',
      preallocate: MAX_MOONDUST_PER_FLY,
    });
    registerPoolStats('moondust', this.arc);
  }

  /**
   * Fly up to MAX_MOONDUST_PER_FLY moondust sprites from (fromX, fromY) to
   * the HUD moondust position. `onArrive` fires once per sprite as it lands.
   */
  fly(fromX: number, fromY: number, count: number, onArrive?: () => void): void {
    this.arc.fly(fromX, fromY, count, onArrive);
  }
}
