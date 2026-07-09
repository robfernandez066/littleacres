import Phaser from 'phaser';

import { ATLAS_KEY } from '../config';
import { BASE_PLOT_COUNT, EXPANSION_COST } from '../data/farm';
import type { GameStateData } from '../systems/gameState';

/**
 * The one-time farm expansion button: a small nineslice sign below the
 * field reading "Expand - <cost>". Visible only before the first expansion
 * and only once onboarding has completed (see `refresh`). Tapping it is
 * wired by the scene, which owns the purchase and the new row's visuals;
 * this class only owns the button's look, visibility, and feedback.
 */

const SIGN_X = 540;
const SIGN_Y = 1300;
const SIGN_WIDTH = 300;
const SIGN_HEIGHT = 90;
/** Above the field and crop sprites, alongside floating text (1900). */
const SIGN_DEPTH = 1900;

const COIN_OFFSET_X = -78;
const COIN_SCALE = 0.4;
const TEXT_OFFSET_X = -50;

const LABEL_COLOR = '#4a3218';
const FLASH_COLOR = '#e03131';
const FLASH_DURATION_MS = 300;
const SHAKE_DISTANCE = 10;
/** Min gap between insufficient-coins nudges so a repeated tap cannot spam them. */
const SHAKE_THROTTLE_MS = 400;

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: LABEL_COLOR,
};

export class ExpandSign {
  private readonly container: Phaser.GameObjects.Container;
  private readonly label: Phaser.GameObjects.Text;
  private lastFlashAt = -Infinity;
  private flashTimer: Phaser.Time.TimerEvent | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    onTap: () => void,
  ) {
    this.container = scene.add.container(SIGN_X, SIGN_Y).setDepth(SIGN_DEPTH).setVisible(false);
    const panel = scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      SIGN_WIDTH,
      SIGN_HEIGHT,
      32,
      32,
      32,
      32,
    );
    const coinIcon = scene.add.image(COIN_OFFSET_X, 0, ATLAS_KEY, 'coin').setScale(COIN_SCALE);
    this.label = scene.add
      .text(TEXT_OFFSET_X, 0, `Expand - ${EXPANSION_COST}`, LABEL_STYLE)
      .setOrigin(0, 0.5);
    this.container.add([panel, coinIcon, this.label]);

    panel.setInteractive({ useHandCursor: true });
    panel.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onTap);
  }

  /**
   * Re-derive visibility from state: only once onboarding has completed and
   * only before the (one-time) expansion has been purchased.
   */
  refresh(state: GameStateData): void {
    this.container.setVisible(state.onboarding.completed && state.plots.length === BASE_PLOT_COUNT);
  }

  /** Gentle insufficient-coins feedback: an x-wiggle + brief red text flash, throttled. */
  flashInsufficientCoins(): void {
    const nowMs = Date.now();
    if (nowMs - this.lastFlashAt < SHAKE_THROTTLE_MS) return;
    this.lastFlashAt = nowMs;

    this.scene.tweens.killTweensOf(this.container);
    this.container.setX(SIGN_X);
    this.scene.tweens.add({
      targets: this.container,
      x: SIGN_X + SHAKE_DISTANCE,
      duration: 40,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => this.container.setX(SIGN_X),
    });

    this.label.setColor(FLASH_COLOR);
    this.flashTimer?.remove();
    this.flashTimer = this.scene.time.delayedCall(FLASH_DURATION_MS, () => {
      this.label.setColor(LABEL_COLOR);
      this.flashTimer = null;
    });
  }
}
