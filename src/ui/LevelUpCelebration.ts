import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { CROPS } from '../data/crops';
import { regionUnlockCardsForLevel } from '../data/goals';
import { SYSTEM_UNLOCK_CARDS } from '../data/levels';
import type { AudioManager } from '../systems/audio';
import type { LevelUpEvent } from '../systems/gameState';
import { buzz } from '../systems/haptics';
import { ParticleBurst } from './ParticleBurst';

/**
 * Fast, full-screen celebration overlay: a dimmed input-blocking backdrop,
 * a bouncing banner, and follow-up cards. Two kinds ride one queue:
 * level-ups ("Level N!" plus a reveal card per unlocked crop) and the
 * one-shot tutorial completion (its own banner copy, then a single card
 * pointing at the pending order). Queued celebrations play sequentially -
 * one finishes before the next starts.
 *
 * Driven externally: `FarmScene` drains `gameState.consumeLevelUpEvents()`
 * and `gameState.consumeTutorialCompleteEvent()` on its refresh tick and
 * hands the results to `enqueue` / `enqueueTutorialComplete`.
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

/** Banner copy wider than this shrinks to fit instead of overflowing. */
const BANNER_MAX_WIDTH = DESIGN_WIDTH - 80;
/** Wrap width for the multi-line tutorial card copy. */
const CARD_TEXT_WRAP_WIDTH = CARD_WIDTH - 80;

/**
 * Tutorial-complete card geometry: a taller panel with its own vertical
 * layout (icon high, 4-line copy at center, a "Let's Go!" button below).
 * Unlock cards keep the original 700x480 layout untouched - `presentCard`
 * swaps between the two on every show.
 */
const TUTORIAL_CARD_HEIGHT = 620;
const TUTORIAL_CARD_ICON_Y = -190;
const TUTORIAL_CARD_TEXT_Y = -20;
const GO_BUTTON_WIDTH = 320;
const GO_BUTTON_HEIGHT = 90;
const GO_BUTTON_Y = 230;

const TUTORIAL_BANNER_TEXT = 'Little Acres is yours!';
const TUTORIAL_CARD_TEXT =
  "Harvest the field when it's ready and deliver the order. The village is counting on you.";
const GO_BUTTON_TEXT = "Let's Go!";

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

const GO_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/** One queued celebration: a level-up event or the tutorial completion. */
type CelebrationItem = { kind: 'level-up'; event: LevelUpEvent } | { kind: 'tutorial-complete' };

interface ActiveCelebration {
  item: CelebrationItem;
  stage: 'banner' | 'card';
  cardIndex: number;
}

export class LevelUpCelebration {
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  private readonly bannerText: Phaser.GameObjects.Text;
  private readonly cardContainer: Phaser.GameObjects.Container;
  private readonly cardPanel: Phaser.GameObjects.NineSlice;
  private readonly cardIcon: Phaser.GameObjects.Image;
  private readonly cardText: Phaser.GameObjects.Text;
  private readonly goButton: Phaser.GameObjects.NineSlice;
  private readonly goButtonText: Phaser.GameObjects.Text;

  private readonly queue: CelebrationItem[] = [];
  private active: ActiveCelebration | null = null;
  private timer: Phaser.Time.TimerEvent | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly particles: ParticleBurst,
    private readonly audio: AudioManager,
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
    this.cardPanel = this.scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      CARD_WIDTH,
      CARD_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    this.cardIcon = this.scene.add
      .image(0, CARD_ICON_Y, ATLAS_KEY, CROPS.sunwheat.stageFrames[2])
      .setScale(CARD_ICON_SCALE);
    this.cardText = this.scene.add.text(0, CARD_TEXT_Y, '', CARD_TEXT_STYLE).setOrigin(0.5);

    // The tutorial card's "Let's Go!" button - hidden for unlock cards
    // (invisible objects never receive input). Dismissing rides the same
    // path as the backdrop tap; its own stopPropagation keeps the backdrop
    // handler (and anything beneath) from double-handling the tap.
    this.goButton = this.scene.add
      .nineslice(
        0,
        GO_BUTTON_Y,
        ATLAS_KEY,
        'panel',
        GO_BUTTON_WIDTH,
        GO_BUTTON_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    this.goButtonText = this.scene.add
      .text(0, GO_BUTTON_Y, GO_BUTTON_TEXT, GO_BUTTON_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    this.goButton.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        this.audio.sfx('tap');
        this.advanceFromCard();
      },
    );

    this.cardContainer.add([
      this.cardPanel,
      this.cardIcon,
      this.cardText,
      this.goButton,
      this.goButtonText,
    ]);
  }

  /** True while a celebration is queued or playing; callers gate field input on this. */
  isActive(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  /** Queue new level-up events; starts playing immediately if nothing else is active. */
  enqueue(events: LevelUpEvent[]): void {
    if (events.length === 0) return;
    this.queue.push(...events.map((event): CelebrationItem => ({ kind: 'level-up', event })));
    if (this.active === null) this.playNext();
  }

  /** Queue the one-shot tutorial-complete celebration, behind anything already queued. */
  enqueueTutorialComplete(): void {
    this.queue.push({ kind: 'tutorial-complete' });
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
    const item = this.queue.shift();
    if (item === undefined) {
      this.active = null;
      this.hideAll();
      return;
    }
    this.active = { item, stage: 'banner', cardIndex: 0 };
    this.showBanner(item);
  }

  /** Whether this celebration follows its banner with a card stage. */
  private hasCards(item: CelebrationItem): boolean {
    return item.kind === 'tutorial-complete' || this.cardsFor(item.event).length > 0;
  }

  /**
   * Every card a level-up event shows, in order: one per unlocked crop, then
   * one per SYSTEM_UNLOCK_CARDS entry matching this level (e.g. the level-6
   * chest unlock), then one per region whose gate this level opens (T3.30-r1 -
   * derived from REGIONS, so a future region announces itself here with no new
   * code). A level that unlocks several of these shows all of them.
   */
  private cardsFor(event: LevelUpEvent): { iconFrame: string; label: string }[] {
    const cropCards = event.unlockedCropIds.map((cropId) => {
      const crop = CROPS[cropId];
      return { iconFrame: crop.stageFrames[2], label: `${crop.name} seeds unlocked!` };
    });
    const systemCards = SYSTEM_UNLOCK_CARDS.filter((card) => card.level === event.level).map(
      (card) => ({ iconFrame: card.iconFrame, label: card.label }),
    );
    return [...cropCards, ...systemCards, ...regionUnlockCardsForLevel(event.level)];
  }

  private showBanner(item: CelebrationItem): void {
    this.cardContainer.setVisible(false);
    this.backdrop.setVisible(true);
    const copy = item.kind === 'level-up' ? `Level ${item.event.level}!` : TUTORIAL_BANNER_TEXT;
    this.bannerText.setText(copy).setScale(0).setVisible(true);
    // Copy wider than the screen shrinks to fit (the tutorial banner; a
    // "Level N!" always measures under the cap, so its scale stays 1).
    const fitScale = Math.min(1, BANNER_MAX_WIDTH / this.bannerText.width);
    this.scene.tweens.add({
      targets: this.bannerText,
      scale: fitScale,
      duration: BANNER_SCALE_IN_MS,
      ease: 'Back.easeOut',
    });

    this.particles.burst('sparkle', DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
    buzz(BUZZ_MS);
    this.audio.sfx('levelup');

    this.timer?.remove();
    const delay = this.hasCards(item) ? BANNER_TO_CARD_MS : BANNER_AUTO_DISMISS_MS;
    this.timer = this.scene.time.delayedCall(delay, () => this.advanceFromBanner());
  }

  private advanceFromBanner(): void {
    if (this.active === null || this.active.stage !== 'banner') return;
    this.timer?.remove();
    this.timer = null;
    if (this.hasCards(this.active.item)) {
      this.active.stage = 'card';
      this.showCard(0);
    } else {
      this.finishEvent();
    }
  }

  private showCard(index: number): void {
    if (this.active === null) return;
    this.active.cardIndex = index;
    const item = this.active.item;
    if (item.kind === 'tutorial-complete') {
      // The scroll (Orders) icon points at the pending order the player just
      // planted for; no auto-dismiss - the tap lets them read.
      this.presentCard('scroll', TUTORIAL_CARD_TEXT, true);
      return;
    }
    const card = this.cardsFor(item.event)[index];
    if (card === undefined) {
      this.finishEvent();
      return;
    }
    this.presentCard(card.iconFrame, card.label, false);
  }

  /**
   * Shared card presentation: per-kind geometry, icon, copy, scale-in. The
   * tutorial card gets the taller panel with wrapped copy and the button;
   * unlock cards restore the original single-line 700x480 layout exactly.
   */
  private presentCard(iconFrame: string, copy: string, tutorial: boolean): void {
    this.bannerText.setVisible(false);
    this.cardPanel.setSize(CARD_WIDTH, tutorial ? TUTORIAL_CARD_HEIGHT : CARD_HEIGHT);
    this.cardIcon.setFrame(iconFrame).setY(tutorial ? TUTORIAL_CARD_ICON_Y : CARD_ICON_Y);
    this.cardText
      .setWordWrapWidth(tutorial ? CARD_TEXT_WRAP_WIDTH : null)
      .setAlign(tutorial ? 'center' : 'left')
      .setY(tutorial ? TUTORIAL_CARD_TEXT_Y : CARD_TEXT_Y)
      .setText(copy);
    this.goButton.setVisible(tutorial);
    this.goButtonText.setVisible(tutorial);
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
    const item = this.active.item;
    if (item.kind === 'tutorial-complete') {
      // Single card; any tap finishes the celebration.
      this.finishEvent();
      return;
    }
    const next = this.active.cardIndex + 1;
    if (next < this.cardsFor(item.event).length) {
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
