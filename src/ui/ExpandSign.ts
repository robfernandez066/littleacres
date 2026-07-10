import Phaser from 'phaser';

import { ATLAS_KEY } from '../config';
import { BASE_PLOT_COUNT, EXPANSION_COST } from '../data/farm';
import type { GameStateData } from '../systems/gameState';

/**
 * The one-time farm expansion button: a wooden signpost below the field
 * reading "Expand" / "<coin> <cost>" on its two planks. Visible only before
 * the first expansion and only once onboarding has completed (see
 * `refresh`). Tapping it is wired by the scene, which owns the purchase and
 * the new row's visuals; this class only owns the button's look, visibility,
 * and feedback.
 */

const SIGN_X = 540;
const SIGN_Y = 1300;
/** Display height of the `sign` frame; width follows the art's own aspect. Scaled up from the
 *  original 200px so the two stacked text lines stay legible. */
const SIGN_DISPLAY_HEIGHT = 240;
/** Must match SIGN_SIZE in tools/pack-atlas.mjs - the packed frame's square side. */
const SIGN_FRAME_SIZE = 192;
const SIGN_SCALE = SIGN_DISPLAY_HEIGHT / SIGN_FRAME_SIZE;

/**
 * MEASURED CONSTANTS - taken directly from the packed `sign` frame in assets/atlas.png (the
 * 192x192 region at atlas.json's "sign" rect, matching SIGN_FRAME_SIZE exactly). If the sign art
 * is repacked/redrawn, these must be re-measured (a Jimp script), not eyeballed:
 *
 * - Plank tilt: scanned the top edge of the upper plank column-by-column (alpha > 10) on the
 *   *unrotated* source art in two straight runs clear of corner rounding and the post's peg.
 *   Both runs gave an exact +0.5 px/px slope (down-to-the-right), i.e. a rotation of
 *   atan(0.5) = 26.565 degrees clockwise in screen space - not the ~-6 degrees the art was
 *   previously assumed to use.
 * - Upper plank center/width: rotated the packed 192x192 `sign` frame by +26.565 degrees about
 *   its own exact center (96, 96) - Jimp expands the canvas to 260x260 to fit, keeping the same
 *   center at its new midpoint (130, 130) - so the plank lay flat. Found its nail (a tight
 *   cluster of low-saturation grey pixels) at centroid (101.1, 99.2); at that row the opaque
 *   silhouette's left/right extent is x=[33,197] (center 115, width 165). LINE1_OFFSET_X/Y are
 *   that point minus the (130,130) pivot, so they're already in frame-192 units, local to
 *   `plankContent` before its rotation is applied (same pivot).
 *
 * The cost line ("<coin> 500") is NOT independently plank-measured (see T2.6f) - it's pinned
 * directly under the title instead, since centering it on the lower plank's own nail row covered
 * that nail. It lands on the upper plank's lower half / the planks' junction, which is the
 * combined shape's widest cross-section (~160+ frame units per the row scan above), so it reuses
 * the upper plank's width budget below.
 */
const SIGN_ROTATION_DEG = 26.565;
/** Upper plank (title line) center, in frame-192 units, local to `plankContent`. */
const LINE1_OFFSET_X = 115 - 130;
const LINE1_OFFSET_Y = 99 - 130;
/** Upper plank's opaque width at the nail's row, in frame-192 units. */
const LINE1_FACE_WIDTH = 165;
/** Shrink each line's usable width from the measured face width so text clears the plank's
 *  wavy/curled edge detail and any drift between the measured row and the text's own vertical
 *  footprint (the board's cross-section isn't a perfect rectangle). */
const FACE_WIDTH_PADDING = 0.68;
/** Vertical gap, in final display px, between the title's bottom and the cost line's top. Text
 *  objects carry extra vertical padding beyond the glyphs, so this is negative to pull the cost
 *  line up snug against the title. */
const TITLE_TO_COST_GAP_PX = -4;

/** Gap in px (frame-192 units) between the coin icon and the cost text on the second line. */
const COIN_TEXT_GAP = 4;
/** Above the field and crop sprites, alongside floating text (1900). */
const SIGN_DEPTH = 1900;

const COIN_SCALE = 0.34;
const TITLE_START_FONT_PX = 34;
const COST_START_FONT_PX = 30;
const MIN_FONT_PX = 16;
const FONT_SHRINK_STEP_PX = 2;

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
  fontStyle: 'bold',
  color: LABEL_COLOR,
  stroke: '#4a3218',
  strokeThickness: 3,
};

/** Shrinks a text object's font size in steps, from startSize, until it fits maxWidth (or hits
 *  MIN_FONT_PX). */
function shrinkToFit(text: Phaser.GameObjects.Text, startSize: number, maxWidth: number): void {
  let size = startSize;
  while (text.width > maxWidth && size > MIN_FONT_PX) {
    size -= FONT_SHRINK_STEP_PX;
    text.setFontSize(size);
  }
}

export class ExpandSign {
  private readonly container: Phaser.GameObjects.Container;
  private readonly titleLabel: Phaser.GameObjects.Text;
  private readonly costLabel: Phaser.GameObjects.Text;
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

    // Both lines are rotated together about the frame's center to follow the plank's measured
    // tilt. The title is positioned/sized against the measured upper plank; the cost line is
    // then pinned directly under the title (see T2.6f) rather than independently plank-measured,
    // so it never covers the lower plank's nail.
    const plankContent = scene.add.container(0, 0).setAngle(SIGN_ROTATION_DEG);

    const line1X = LINE1_OFFSET_X * SIGN_SCALE;
    const line1Y = LINE1_OFFSET_Y * SIGN_SCALE;
    const line1MaxWidth = LINE1_FACE_WIDTH * FACE_WIDTH_PADDING * SIGN_SCALE;
    this.titleLabel = scene.add
      .text(line1X, line1Y, 'Expand', { ...LABEL_STYLE, fontSize: `${TITLE_START_FONT_PX}px` })
      .setOrigin(0.5, 0.5);
    shrinkToFit(this.titleLabel, TITLE_START_FONT_PX, line1MaxWidth);

    // Same width budget as the title - the cost line lands on the planks' widest cross-section
    // (the junction just below the upper plank), not a separately measured spot.
    const line2MaxWidth = line1MaxWidth;
    const coinIcon = scene.add.image(0, 0, ATLAS_KEY, 'coin').setScale(COIN_SCALE);
    this.costLabel = scene.add
      .text(0, 0, `${EXPANSION_COST}`, { ...LABEL_STYLE, fontSize: `${COST_START_FONT_PX}px` })
      .setOrigin(0, 0.5);
    const coinTextGapPx = COIN_TEXT_GAP * SIGN_SCALE;
    shrinkToFit(
      this.costLabel,
      COST_START_FONT_PX,
      line2MaxWidth - coinIcon.displayWidth - coinTextGapPx,
    );
    const line2Width = coinIcon.displayWidth + coinTextGapPx + this.costLabel.width;
    const line2Left = line1X - line2Width / 2;
    const line2Y =
      line1Y + this.titleLabel.height / 2 + TITLE_TO_COST_GAP_PX + this.costLabel.height / 2;
    coinIcon.setPosition(line2Left + coinIcon.displayWidth / 2, line2Y);
    this.costLabel.setPosition(coinIcon.x + coinIcon.displayWidth / 2 + coinTextGapPx, line2Y);

    plankContent.add([this.titleLabel, coinIcon, this.costLabel]);

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

    this.titleLabel.setColor(FLASH_COLOR);
    this.costLabel.setColor(FLASH_COLOR);
    this.flashTimer?.remove();
    this.flashTimer = this.scene.time.delayedCall(FLASH_DURATION_MS, () => {
      this.titleLabel.setColor(LABEL_COLOR);
      this.costLabel.setColor(LABEL_COLOR);
      this.flashTimer = null;
    });
  }
}
