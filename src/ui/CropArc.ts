import Phaser from 'phaser';

import { BAG_POSITION } from '../config';
import { CROPS } from '../data/crops';
import { FARM_COLS, FARM_ROWS } from '../data/farm';
import { registerPoolStats } from '../systems/pool';
import { PooledArc } from './PooledArc';

/**
 * Harvest-flight effect: a harvested crop's mature sprite arcs from its plot
 * to the HUD bag position. Thin wrapper over the shared `PooledArc` flight/
 * pool mechanics, fixed to the bag target; the frame varies per flight since
 * each crop has its own mature stage frame.
 */

const START_SCALE = 0.55;
const END_SCALE = 0.25;

/** Above everything, including the seed bar (2000) and the panel (2100). */
const CROP_ARC_DEPTH = 2200;

/** One flight per plot; a full-field sweep must never grow the pool mid-flight. */
const PREALLOCATE = FARM_COLS * FARM_ROWS;

export class CropArc {
  private readonly arc: PooledArc;

  constructor(scene: Phaser.Scene) {
    this.arc = new PooledArc(scene, {
      targetX: BAG_POSITION.x,
      targetY: BAG_POSITION.y,
      depth: CROP_ARC_DEPTH,
      startScale: START_SCALE,
      endScale: END_SCALE,
      maxPerFly: 1,
      defaultFrame: CROPS.sunwheat.stageFrames[2],
      preallocate: PREALLOCATE,
    });
    registerPoolStats('bag', this.arc);
  }

  /** Fly one crop sprite from (fromX, fromY) to the bag; `onArrive` fires on landing. */
  fly(fromX: number, fromY: number, frame: string, onArrive?: () => void): void {
    this.arc.fly(fromX, fromY, 1, onArrive, frame);
  }
}
