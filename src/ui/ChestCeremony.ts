import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH } from '../config';
import type { ChestEvent } from '../systems/gameState';
import { gameState } from '../systems/gameState';
import { buzz } from '../systems/haptics';
import type { Hud } from './Hud';
import { ParticleBurst } from './ParticleBurst';

/**
 * Chest ceremony (T2.23a rework - supersedes the T2.23 farm-object flow):
 * fulfilling a premium order with `premium.chests` grants its coins/moondust
 * to state IMMEDIATELY (see `GameStateStore.fulfillOrder`/`grantChests`), and
 * queues a `ChestEvent` this class celebrates on `FarmScene`'s refresh tick.
 * No farm object, no card, no panel - a full-screen theatrical beat: an
 * input-blocking backdrop, a chest scaling in at screen center, opening with
 * a sparkle burst, then fading out AS its loot (coin, and moondust when > 0)
 * pops into the same spot in its place. A tap once everything has landed
 * dismisses it - coins arc to the HUD counter (`Hud.flyChestCoins`, the same
 * mechanism T2.23 introduced), moondust needs no equivalent flight (it has no
 * drift animation anywhere in the HUD, so it already reads correctly from the
 * state `fulfillOrder` already committed), and the next queued event (if any)
 * plays immediately after - modeled on `LevelUpCelebration`'s queue.
 */

/** Same layer as LevelUpCelebration (above flying coins/crops, HUD). */
const CEREMONY_DEPTH = 2300;

const BACKDROP_ALPHA = 0.55;

/** Screen center - both the chest and its loot occupy the same spot in turn. */
const CENTER_X = DESIGN_WIDTH / 2;
const CENTER_Y = DESIGN_HEIGHT / 2;

const CHEST_SCALE_FROM = 0.5;
const CHEST_SCALE_TO = 2.5;
const CHEST_SCALE_IN_MS = 400;
/** Beat between the scale-in landing and the chest swapping open. */
const CHEST_OPEN_BEAT_MS = 300;
const CHEST_FADE_OUT_MS = 250;
const OPEN_BUZZ_MS = 25;

/** Loot pop-in: coin first, moondust (when present) staggered after it. */
const LOOT_POP_MS = 250;
const LOOT_STAGGER_MS = 150;

const REWARD_ICON_SIZE = 76;
const REWARD_ICON_TEXT_GAP = 16;
/** Gap between the coin group and the moondust group when both are shown. */
const REWARD_GROUP_GAP = 56;

const REWARD_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '60px',
  fontStyle: 'bold',
  color: '#fff3c4',
  stroke: '#3a2a10',
  strokeThickness: 8,
};

export class ChestCeremony {
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  private readonly chestImage: Phaser.GameObjects.Image;
  private readonly coinIcon: Phaser.GameObjects.Image;
  private readonly coinText: Phaser.GameObjects.Text;
  private readonly moondustIcon: Phaser.GameObjects.Image;
  private readonly moondustText: Phaser.GameObjects.Text;

  private readonly queue: ChestEvent[] = [];
  private active: ChestEvent | null = null;
  /** True once the loot has fully popped in - the only state a tap acts on. */
  private landed = false;
  private timer: Phaser.Time.TimerEvent | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly particles: ParticleBurst,
    private readonly hud: Hud,
  ) {
    this.backdrop = this.scene.add
      .rectangle(CENTER_X, CENTER_Y, DESIGN_WIDTH, DESIGN_HEIGHT, 0x000000, BACKDROP_ALPHA)
      .setDepth(CEREMONY_DEPTH)
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
        event.stopPropagation();
        this.onTap();
      },
    );

    this.chestImage = this.scene.add
      .image(CENTER_X, CENTER_Y, ATLAS_KEY, 'chest_closed')
      .setDepth(CEREMONY_DEPTH + 1)
      .setVisible(false);
    this.coinIcon = this.scene.add
      .image(CENTER_X, CENTER_Y, ATLAS_KEY, 'coin')
      .setDisplaySize(REWARD_ICON_SIZE, REWARD_ICON_SIZE)
      .setDepth(CEREMONY_DEPTH + 1)
      .setVisible(false);
    this.coinText = this.scene.add
      .text(CENTER_X, CENTER_Y, '', REWARD_TEXT_STYLE)
      .setOrigin(0, 0.5)
      .setDepth(CEREMONY_DEPTH + 1)
      .setVisible(false);
    this.moondustIcon = this.scene.add
      .image(CENTER_X, CENTER_Y, ATLAS_KEY, 'moondust')
      .setDisplaySize(REWARD_ICON_SIZE, REWARD_ICON_SIZE)
      .setDepth(CEREMONY_DEPTH + 1)
      .setVisible(false);
    this.moondustText = this.scene.add
      .text(CENTER_X, CENTER_Y, '', REWARD_TEXT_STYLE)
      .setOrigin(0, 0.5)
      .setDepth(CEREMONY_DEPTH + 1)
      .setVisible(false);
  }

  /** True while a ceremony is queued or playing; callers gate field input on this. */
  isActive(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  /** Queue new chest events; starts playing immediately if nothing else is active. */
  enqueue(events: ChestEvent[]): void {
    if (events.length === 0) return;
    this.queue.push(...events);
    if (this.active === null) this.playNext();
  }

  private onTap(): void {
    if (this.active === null || !this.landed) return;
    this.dismiss();
  }

  private playNext(): void {
    const item = this.queue.shift();
    if (item === undefined) {
      this.active = null;
      this.backdrop.setVisible(false);
      return;
    }
    this.active = item;
    this.landed = false;
    this.backdrop.setVisible(true);
    this.playScaleIn();
  }

  private playScaleIn(): void {
    this.chestImage
      .setFrame('chest_closed')
      .setAlpha(1)
      .setScale(CHEST_SCALE_FROM)
      .setVisible(true);
    this.coinIcon.setVisible(false);
    this.coinText.setVisible(false);
    this.moondustIcon.setVisible(false);
    this.moondustText.setVisible(false);

    this.scene.tweens.add({
      targets: this.chestImage,
      scale: CHEST_SCALE_TO,
      duration: CHEST_SCALE_IN_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.timer?.remove();
        this.timer = this.scene.time.delayedCall(CHEST_OPEN_BEAT_MS, () => this.playOpen());
      },
    });
  }

  private playOpen(): void {
    if (this.active === null) return;
    this.chestImage.setFrame('chest_open');
    this.particles.burst('sparkle', CENTER_X, CENTER_Y);
    buzz(OPEN_BUZZ_MS);

    this.scene.tweens.add({
      targets: this.chestImage,
      alpha: 0,
      duration: CHEST_FADE_OUT_MS,
      ease: 'Sine.easeIn',
      onComplete: () => this.chestImage.setVisible(false),
    });

    this.playLoot(this.active);
  }

  /** Pop the coin (always) and moondust (when > 0) loot lines in, staggered. */
  private playLoot(item: ChestEvent): void {
    const hasMoondust = item.moondust > 0;
    this.coinText.setText(String(item.coins));
    this.moondustText.setText(hasMoondust ? String(item.moondust) : '');
    this.layoutRewardRow(hasMoondust);

    let pendingPops = hasMoondust ? 2 : 1;
    const onPopComplete = (): void => {
      pendingPops--;
      if (pendingPops <= 0) this.landed = true;
    };

    this.coinIcon.setVisible(true).setScale(0);
    this.coinText.setVisible(true).setScale(0);
    this.scene.tweens.add({
      targets: [this.coinIcon, this.coinText],
      scale: 1,
      duration: LOOT_POP_MS,
      ease: 'Back.easeOut',
      onComplete: onPopComplete,
    });

    if (hasMoondust) {
      this.timer?.remove();
      this.timer = this.scene.time.delayedCall(LOOT_STAGGER_MS, () => {
        this.moondustIcon.setVisible(true).setScale(0);
        this.moondustText.setVisible(true).setScale(0);
        this.scene.tweens.add({
          targets: [this.moondustIcon, this.moondustText],
          scale: 1,
          duration: LOOT_POP_MS,
          ease: 'Back.easeOut',
          onComplete: onPopComplete,
        });
      });
    }
  }

  /** Center the coin (+ optional moondust) icon/text pair(s) as one row at screen center. */
  private layoutRewardRow(hasMoondust: boolean): void {
    const coinGroupWidth = REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP + this.coinText.width;
    const moondustGroupWidth = hasMoondust
      ? REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP + this.moondustText.width
      : 0;
    const totalWidth = coinGroupWidth + (hasMoondust ? REWARD_GROUP_GAP + moondustGroupWidth : 0);

    let cursor = CENTER_X - totalWidth / 2;
    this.coinIcon.setPosition(cursor + REWARD_ICON_SIZE / 2, CENTER_Y);
    cursor += REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP;
    this.coinText.setPosition(cursor, CENTER_Y);
    cursor += this.coinText.width;

    if (hasMoondust) {
      cursor += REWARD_GROUP_GAP;
      this.moondustIcon.setPosition(cursor + REWARD_ICON_SIZE / 2, CENTER_Y);
      cursor += REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP;
      this.moondustText.setPosition(cursor, CENTER_Y);
    }
  }

  /**
   * Dismiss: hide the backdrop/loot, fly the already-granted coins to the
   * HUD counter, and start the next queued event (if any). `coinsBefore` is
   * derived from the current state minus this event's own coins - correct
   * regardless of other events queued before or after it, since each event's
   * `coins` is exactly the delta its own grant added (see `ChestEvent`).
   */
  private dismiss(): void {
    if (this.active === null) return;
    const item = this.active;
    this.timer?.remove();
    this.timer = null;
    this.backdrop.setVisible(false);
    this.scene.tweens.killTweensOf([
      this.chestImage,
      this.coinIcon,
      this.coinText,
      this.moondustIcon,
      this.moondustText,
    ]);
    this.chestImage.setVisible(false);
    this.coinIcon.setVisible(false);
    this.coinText.setVisible(false);
    this.moondustIcon.setVisible(false);
    this.moondustText.setVisible(false);

    const coinsBefore = gameState.getState().coins - item.coins;
    this.hud.flyChestCoins(this.coinIcon.x, this.coinIcon.y, coinsBefore, item.coins);

    this.active = null;
    this.playNext();
  }
}
