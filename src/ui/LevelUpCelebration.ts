import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH } from '../config';
import { CROPS } from '../data/crops';
import type { LevelUpEvent } from '../systems/gameState';
import { buzz } from '../systems/haptics';
import { ParticleBurst } from './ParticleBurst';

/**
 * Fast, full-screen level-up celebration: a dimmed input-blocking backdrop,
 * a bouncing "Level N!" banner, and (when the level unlocks a crop) a
 * follow-up reveal card per unlocked crop. Multiple queued level-ups play
 * sequentially - one celebration finishes before the next starts.
 *
 * Driven externally: `FarmScene` drains `gameState.consumeLevelUpEvents()`
 * on its refresh tick and hands the results to `enqueue`.
 */

/** Above everything, including flying coins/crops (2200). */
const CELEBRATION_DEPTH = 2300;

const BACKDROP_ALPHA = 0.55;
const BANNER_SCALE_IN_MS = 300;
/** Delay before the unlock card replaces the banner, when this level unlocks a crop. */
const BANNER_TO_CARD_MS = 600;
/** Auto-dismiss delay when this level unlocks nothing; a tap dismisses sooner. */
const BANNER_AUTO_DISMISS_MS = 1200;
const CARD_SCALE_IN_MS = 200;
const BUZZ_MS = 30;

const CARD_WIDTH = 700;
const CARD_HEIGHT = 480;
const CARD_ICON_Y = -70;
const CARD_ICON_SCALE = 1.3;
const CARD_TEXT_Y = 150;

const BANNER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '110px',
  fontStyle: 'bold',
  color: '#fff3c4',
  stroke: '#3a2a10',
  strokeThickness: 10,
};

const CARD_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};

interface ActiveCelebration {
  event: LevelUpEvent;
  stage: 'banner' | 'card';
  cardIndex: number;
}

export class LevelUpCelebration {
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  private readonly bannerText: Phaser.GameObjects.Text;
  private readonly cardContainer: Phaser.GameObjects.Container;
  private readonly cardIcon: Phaser.GameObjects.Image;
  private readonly cardText: Phaser.GameObjects.Text;

  private readonly queue: LevelUpEvent[] = [];
  private active: ActiveCelebration | null = null;
  private timer: Phaser.Time.TimerEvent | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly particles: ParticleBurst,
  ) {
    this.backdrop = this.scene.add
      .rectangle(
        DESIGN_WIDTH / 2,
        DESIGN_HEIGHT / 2,
        DESIGN_WIDTH,
        DESIGN_HEIGHT,
        0x000000,
        BACKDROP_ALPHA,
      )
      .setDepth(CELEBRATION_DEPTH)
      .setVisible(false)
      .setInteractive();
    this.backdrop.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        // Swallow the dismiss tap: interactive objects below (e.g. a modal
        // panel's tap-outside backdrop) must never react to it.
        event.stopPropagation();
        this.onTap();
      },
    );

    this.bannerText = this.scene.add
      .text(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, '', BANNER_STYLE)
      .setOrigin(0.5)
      .setDepth(CELEBRATION_DEPTH + 1)
      .setVisible(false);

    this.cardContainer = this.scene.add
      .container(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2)
      .setDepth(CELEBRATION_DEPTH + 1)
      .setVisible(false);
    const cardPanel = this.scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      CARD_WIDTH,
      CARD_HEIGHT,
      32,
      32,
      32,
      32,
    );
    this.cardIcon = this.scene.add
      .image(0, CARD_ICON_Y, ATLAS_KEY, CROPS.sunwheat.stageFrames[2])
      .setScale(CARD_ICON_SCALE);
    this.cardText = this.scene.add.text(0, CARD_TEXT_Y, '', CARD_TEXT_STYLE).setOrigin(0.5);
    this.cardContainer.add([cardPanel, this.cardIcon, this.cardText]);
  }

  /** True while a celebration is queued or playing; callers gate field input on this. */
  isActive(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  /** Queue new level-up events; starts playing immediately if nothing else is active. */
  enqueue(events: LevelUpEvent[]): void {
    if (events.length === 0) return;
    this.queue.push(...events);
    if (this.active === null) this.playNext();
  }

  /** Tap anywhere on the backdrop advances the current stage; never reaches the field. */
  private onTap(): void {
    if (this.active === null) return;
    if (this.active.stage === 'banner') {
      this.advanceFromBanner();
    } else {
      this.advanceFromCard();
    }
  }

  private playNext(): void {
    const event = this.queue.shift();
    if (event === undefined) {
      this.active = null;
      this.hideAll();
      return;
    }
    this.active = { event, stage: 'banner', cardIndex: 0 };
    this.showBanner(event);
  }

  private showBanner(event: LevelUpEvent): void {
    this.cardContainer.setVisible(false);
    this.backdrop.setVisible(true);
    this.bannerText.setText(`Level ${event.level}!`).setScale(0).setVisible(true);
    this.scene.tweens.add({
      targets: this.bannerText,
      scale: 1,
      duration: BANNER_SCALE_IN_MS,
      ease: 'Back.easeOut',
    });

    this.particles.burst('sparkle', DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
    buzz(BUZZ_MS);
    // TODO(T1.12): level-up chime

    this.timer?.remove();
    const delay = event.unlockedCropIds.length > 0 ? BANNER_TO_CARD_MS : BANNER_AUTO_DISMISS_MS;
    this.timer = this.scene.time.delayedCall(delay, () => this.advanceFromBanner());
  }

  private advanceFromBanner(): void {
    if (this.active === null || this.active.stage !== 'banner') return;
    this.timer?.remove();
    this.timer = null;
    if (this.active.event.unlockedCropIds.length > 0) {
      this.active.stage = 'card';
      this.showCard(0);
    } else {
      this.finishEvent();
    }
  }

  private showCard(index: number): void {
    if (this.active === null) return;
    this.active.cardIndex = index;
    const cropId = this.active.event.unlockedCropIds[index];
    if (cropId === undefined) {
      this.finishEvent();
      return;
    }
    const crop = CROPS[cropId];
    this.bannerText.setVisible(false);
    this.cardIcon.setFrame(crop.stageFrames[2]);
    this.cardText.setText(`${crop.name} seeds unlocked!`);
    this.cardContainer.setScale(0.7).setVisible(true);
    this.scene.tweens.add({
      targets: this.cardContainer,
      scale: 1,
      duration: CARD_SCALE_IN_MS,
      ease: 'Back.easeOut',
    });
  }

  private advanceFromCard(): void {
    if (this.active === null || this.active.stage !== 'card') return;
    const next = this.active.cardIndex + 1;
    if (next < this.active.event.unlockedCropIds.length) {
      this.showCard(next);
    } else {
      this.finishEvent();
    }
  }

  private finishEvent(): void {
    this.active = null;
    this.hideAll();
    this.playNext();
  }

  /** Reset every display object to hidden/idle so the next celebration starts clean. */
  private hideAll(): void {
    this.timer?.remove();
    this.timer = null;
    this.backdrop.setVisible(false);
    this.scene.tweens.killTweensOf(this.bannerText);
    this.bannerText.setVisible(false).setScale(1);
    this.scene.tweens.killTweensOf(this.cardContainer);
    this.cardContainer.setVisible(false).setScale(1);
  }
}
