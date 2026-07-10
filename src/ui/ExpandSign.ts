import Phaser from 'phaser';

import { ATLAS_KEY } from '../config';
import { BASE_PLOT_COUNT, EXPANSION_COST } from '../data/farm';
import type { GameStateData } from '../systems/gameState';

/**
 * The one-time farm expansion button: a wooden signpost below the field
 * reading "Expand - <cost>". Visible only before the first expansion and
 * only once onboarding has completed (see `refresh`). Tapping it is wired by
 * the scene, which owns the purchase and the new row's visuals; this class
 * only owns the button's look, visibility, and feedback.
 */

const SIGN_X = 540;
const SIGN_Y = 1300;
/** Display height of the `sign` frame; width follows the art's own aspect. */
const SIGN_DISPLAY_HEIGHT = 200;
/** Must match SIGN_SIZE in tools/pack-atlas.mjs - the packed frame's square side. */
const SIGN_FRAME_SIZE = 192;
const SIGN_SCALE = SIGN_DISPLAY_HEIGHT / SIGN_FRAME_SIZE;
/** The plank tilts down to the right in the art; text/coin follow that angle. */
const SIGN_ROTATION_DEG = -6;
/** Vertical offset from the sign's center to the plank board the text sits on. */
const PLANK_OFFSET_Y = 35;
/** Above the field and crop sprites, alongside floating text (1900). */
const SIGN_DEPTH = 1900;

const COIN_OFFSET_X = -58;
const COIN_OFFSET_Y = -4;
const COIN_SCALE = 0.4;
const TEXT_OFFSET_X = -28;
const TEXT_OFFSET_Y = -4;

/** Cream text so the label reads clearly on the wood plank. */
const LABEL_COLOR = '#fdf6e3';
/** A deeper red than the old flash color - the light one washed out on wood. */
const FLASH_COLOR = '#ff6b6b';
const FLASH_DURATION_MS = 300;
const SHAKE_DISTANCE = 10;
/** Min gap between insufficient-coins nudges so a repeated tap cannot spam them. */
const SHAKE_THROTTLE_MS = 400;

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: LABEL_COLOR,
  stroke: '#4a3218',
  strokeThickness: 3,
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
    const signImage = scene.add
      .image(0, 0, ATLAS_KEY, 'sign')
      .setScale(SIGN_SCALE)
      .setInteractive({ useHandCursor: true });

    // Coin + label sit as a group rotated to follow the plank's angle in the art.
    const plankContent = scene.add.container(0, PLANK_OFFSET_Y).setAngle(SIGN_ROTATION_DEG);
    const coinIcon = scene.add
      .image(COIN_OFFSET_X, COIN_OFFSET_Y, ATLAS_KEY, 'coin')
      .setScale(COIN_SCALE);
    this.label = scene.add
      .text(TEXT_OFFSET_X, TEXT_OFFSET_Y, `Expand - ${EXPANSION_COST}`, LABEL_STYLE)
      .setOrigin(0, 0.5);
    plankContent.add([coinIcon, this.label]);

    this.container.add([signImage, plankContent]);

    signImage.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onTap);
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
