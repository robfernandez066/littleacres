import Phaser from 'phaser';

import { HUD_COIN_POSITION } from '../config';
import { registerPoolStats } from '../systems/pool';
import { PooledArc } from './PooledArc';

/**
 * Coin-flight effect: coin sprites arc from a source point to the HUD coin
 * position. Thin wrapper over the shared `PooledArc` flight/pool mechanics,
 * fixed to the 'coin' frame and the HUD coin target.
 */

/**
 * Hard cap on sprites per `fly` call. Selling a 50-crop stack must read as
 * one satisfying batch, not 50 sprites - `onArrive` still fires once per
 * sprite, so callers count arrivals, not crops.
 */
export const MAX_COINS_PER_FLY = 8;

/** Coin atlas frame is 96x96; start a bit over half size, shrink en route. */
const START_SCALE = 0.6;
const END_SCALE = 0.35;

/** Above everything, including the seed bar (2000) and the panel (2100). */
const COIN_ARC_DEPTH = 2200;

export class CoinArc {
  private readonly arc: PooledArc;

  constructor(scene: Phaser.Scene) {
    this.arc = new PooledArc(scene, {
      targetX: HUD_COIN_POSITION.x,
      targetY: HUD_COIN_POSITION.y,
      depth: COIN_ARC_DEPTH,
      startScale: START_SCALE,
      endScale: END_SCALE,
      maxPerFly: MAX_COINS_PER_FLY,
      defaultFrame: 'coin',
      preallocate: MAX_COINS_PER_FLY,
    });
    registerPoolStats('coin', this.arc);
  }

  /**
   * Fly up to MAX_COINS_PER_FLY coin sprites from (fromX, fromY) to the HUD
   * coin position. `onArrive` fires once per sprite as it lands.
   */
  fly(fromX: number, fromY: number, count: number, onArrive?: () => void): void {
    this.arc.fly(fromX, fromY, count, onArrive);
  }
}
