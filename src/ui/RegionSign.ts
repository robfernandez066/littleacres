import Phaser from 'phaser';

import { ATLAS_KEY } from '../config';
import type { RegionDef } from '../data/farm';
import type { GameStateData } from '../systems/gameState';

/**
 * A region's purchase signpost (T3.3b), patterned on ui/ExpandSign.ts: the
 * same `sign` atlas frame, two stacked planks reading the region name / its
 * coin cost, standing in the LOCKED band at the region's `signPosition`.
 * Visible only while its region is locked (and onboarding has completed - it
 * stands in land the tutorial never sends the player to). Tapping it is wired
 * by the scene (which owns the purchase, the level/coin gating, and the dim
 * fade); this class owns only the button's look, visibility, and feedback.
 *
 * Deliberately NOT the expand sign: it stands in locked land, so it carries
 * NO blocked-tile set and never touches the expand-sign placement mirrors.
 */

/** Display height of the `sign` frame; width follows the art's own aspect. Matches ExpandSign. */
const SIGN_DISPLAY_HEIGHT = 240;
/** Must match SIGN_SIZE in tools/pack-atlas.mjs - the packed frame's square side. */
const SIGN_FRAME_SIZE = 192;
const SIGN_SCALE = SIGN_DISPLAY_HEIGHT / SIGN_FRAME_SIZE;

// Plank geometry - measured constants copied verbatim from ui/ExpandSign.ts
// (same packed `sign` frame). See that file for the Jimp derivation; if the
// sign art is repacked these must be re-measured in BOTH files.
const SIGN_ROTATION_DEG = 26.565;
const LINE1_OFFSET_X = 115 - 130;
const LINE1_OFFSET_Y = 99 - 130;
const LINE1_FACE_WIDTH = 165;
const FACE_WIDTH_PADDING = 0.68;
const TITLE_TO_COST_GAP_PX = -4;
const COIN_TEXT_GAP = 4;

/** Above the field and crop sprites, alongside floating text (1900) - matches ExpandSign. */
const SIGN_DEPTH = 1900;

const COIN_SCALE = 0.34;
const TITLE_START_FONT_PX = 34;
const COST_START_FONT_PX = 30;
const MIN_FONT_PX = 16;
const FONT_SHRINK_STEP_PX = 2;

const LABEL_COLOR = '#fdf6e3';
const FLASH_COLOR = '#ff6b6b';
const FLASH_DURATION_MS = 300;
const SHAKE_DISTANCE = 10;
/** Min gap between feedback nudges so a repeated tap cannot spam them. */
const SHAKE_THROTTLE_MS = 400;

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontStyle: 'bold',
  color: LABEL_COLOR,
  stroke: '#4a3218',
  strokeThickness: 3,
};

/** Shrinks a text object's font size in steps until it fits maxWidth (or hits MIN_FONT_PX). */
function shrinkToFit(text: Phaser.GameObjects.Text, startSize: number, maxWidth: number): void {
  let size = startSize;
  while (text.width > maxWidth && size > MIN_FONT_PX) {
    size -= FONT_SHRINK_STEP_PX;
    text.setFontSize(size);
  }
}

export class RegionSign {
  private readonly region: RegionDef;
  private readonly container: Phaser.GameObjects.Container;
  private readonly titleLabel: Phaser.GameObjects.Text;
  private readonly costLabel: Phaser.GameObjects.Text;
  private lastFlashAt = -Infinity;
  private flashTimer: Phaser.Time.TimerEvent | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    region: RegionDef,
    // Receives the pressing pointer so the scene can defer the tap through its
    // shared structure-tap helper (T3.4c), exactly like ExpandSign.
    onTap: (pointer: Phaser.Input.Pointer) => void,
  ) {
    this.region = region;
    this.container = scene.add
      .container(region.signPosition.x, region.signPosition.y)
      .setDepth(SIGN_DEPTH)
      .setVisible(false);
    const signImage = scene.add
      .image(0, 0, ATLAS_KEY, 'sign')
      .setScale(SIGN_SCALE)
      .setInteractive({ useHandCursor: true });

    const plankContent = scene.add.container(0, 0).setAngle(SIGN_ROTATION_DEG);

    const line1X = LINE1_OFFSET_X * SIGN_SCALE;
    const line1Y = LINE1_OFFSET_Y * SIGN_SCALE;
    const line1MaxWidth = LINE1_FACE_WIDTH * FACE_WIDTH_PADDING * SIGN_SCALE;
    this.titleLabel = scene.add
      .text(line1X, line1Y, region.name, { ...LABEL_STYLE, fontSize: `${TITLE_START_FONT_PX}px` })
      .setOrigin(0.5, 0.5);
    shrinkToFit(this.titleLabel, TITLE_START_FONT_PX, line1MaxWidth);

    const line2MaxWidth = line1MaxWidth;
    const coinIcon = scene.add.image(0, 0, ATLAS_KEY, 'coin').setScale(COIN_SCALE);
    this.costLabel = scene.add
      .text(0, 0, `${region.costCoins}`, { ...LABEL_STYLE, fontSize: `${COST_START_FONT_PX}px` })
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

  /** This sign's region id. */
  get regionId(): string {
    return this.region.id;
  }

  /**
   * Re-derive visibility from state: visible only once onboarding has completed
   * and only while this region is still locked (not in `regionsUnlocked`).
   */
  refresh(state: GameStateData): void {
    this.container.setVisible(
      state.onboarding.completed && !state.regionsUnlocked.includes(this.region.id),
    );
  }

  /** A plain refusal wiggle (below the level gate): x-shake only, throttled. */
  wiggle(): void {
    this.shake();
  }

  /** Insufficient-coins feedback: an x-wiggle + brief red text flash, throttled (ExpandSign's). */
  flashInsufficientCoins(): void {
    if (!this.shake()) return;
    this.titleLabel.setColor(FLASH_COLOR);
    this.costLabel.setColor(FLASH_COLOR);
    this.flashTimer?.remove();
    this.flashTimer = this.scene.time.delayedCall(FLASH_DURATION_MS, () => {
      this.titleLabel.setColor(LABEL_COLOR);
      this.costLabel.setColor(LABEL_COLOR);
      this.flashTimer = null;
    });
  }

  /** The shared throttled x-wiggle; returns false when throttled (so callers skip extra feedback). */
  private shake(): boolean {
    const nowMs = Date.now();
    if (nowMs - this.lastFlashAt < SHAKE_THROTTLE_MS) return false;
    this.lastFlashAt = nowMs;
    const baseX = this.region.signPosition.x;
    this.scene.tweens.killTweensOf(this.container);
    this.container.setX(baseX);
    this.scene.tweens.add({
      targets: this.container,
      x: baseX + SHAKE_DISTANCE,
      duration: 40,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => this.container.setX(baseX),
    });
    return true;
  }
}
