import Phaser from 'phaser';

import { Pool, registerPoolStats } from '../systems/pool';

/**
 * Pooled floating text ("+2 xp" and friends): rises 80-120px with a slight
 * random x-drift while fading out, then returns to the pool.
 *
 * Placement note: effect classes are display-layer objects owned by a scene,
 * so they live in `src/ui/`; the pure pool logic they share lives in
 * `src/systems/pool.ts`.
 */

/** Above the field and crop sprites (depth = screen y, <= ~1500), below the seed bar (2000). */
const FLOATING_TEXT_DEPTH = 1900;

const RISE_MIN = 80;
const RISE_MAX = 120;
const DRIFT_MAX = 30;
const DURATION_MS = 700;

const DEFAULT_COLOR = '#ffffff';
const DEFAULT_FONT_SIZE = 40;
/** Pre-allocated at scene create: one label per plot covers a full-field sweep. */
const PREALLOCATE = 12;

const BASE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontStyle: 'bold',
  stroke: '#3a2a10',
  strokeThickness: 6,
};

export interface FloatingTextOptions {
  color?: string;
  fontSize?: number;
}

export class FloatingText {
  private readonly pool: Pool<Phaser.GameObjects.Text>;

  /** Shared tween callback - no per-show closure allocation. */
  private readonly onFloatComplete = (
    _tween: Phaser.Tweens.Tween,
    targets: Phaser.GameObjects.Text[],
  ): void => {
    const text = targets[0];
    if (text !== undefined) this.pool.release(text);
  };

  constructor(private readonly scene: Phaser.Scene) {
    this.pool = new Pool(
      () =>
        this.scene.add
          .text(0, 0, '', BASE_STYLE)
          .setOrigin(0.5)
          .setDepth(FLOATING_TEXT_DEPTH)
          .setVisible(false),
      (text) => text.setVisible(false),
    );
    this.pool.preallocate(PREALLOCATE);
    registerPoolStats('text', this.pool);
  }

  show(x: number, y: number, text: string, options?: FloatingTextOptions): void {
    const label = this.pool.acquire();
    label
      .setText(text)
      .setColor(options?.color ?? DEFAULT_COLOR)
      .setFontSize(options?.fontSize ?? DEFAULT_FONT_SIZE)
      .setPosition(x, y)
      .setAlpha(1)
      .setVisible(true);
    this.scene.tweens.add({
      targets: label,
      y: y - Phaser.Math.Between(RISE_MIN, RISE_MAX),
      x: x + Phaser.Math.Between(-DRIFT_MAX, DRIFT_MAX),
      alpha: 0,
      duration: DURATION_MS,
      ease: 'Sine.easeOut',
      onComplete: this.onFloatComplete,
    });
  }
}
