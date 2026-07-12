import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH } from '../config';
import type { ChestEvent } from '../systems/gameState';
import { gameState } from '../systems/gameState';
import { buzz } from '../systems/haptics';
import type { Hud } from './Hud';
import { ParticleBurst } from './ParticleBurst';

/**
 * Chest ceremony (T2.23a rework, per-chest multi-chest layout added in
 * T2.23b): fulfilling a premium order with `premium.chests` grants its
 * coins/moondust to state IMMEDIATELY (see
 * `GameStateStore.fulfillOrder`/`grantChests`), and queues a `ChestEvent`
 * (one entry per chest, its own individual roll) this class celebrates on
 * `FarmScene`'s refresh tick. No farm object, no card, no panel - a
 * full-screen theatrical beat: an input-blocking backdrop, one chest sprite
 * per `contents` entry scaling in TOGETHER at screen center (side by side
 * when there is more than one), opening on the same beat with one shared
 * sparkle burst + buzz, then each chest fades out AS its own loot (its coins,
 * its moondust only when > 0) pops into place - at screen center for a
 * single chest (unchanged from T2.23a), or in its own column beneath its own
 * position for two or more. A tap once everything has landed dismisses it -
 * one combined coin arc (the sum across every chest) flies to the HUD
 * counter (`Hud.flyChestCoins`), moondust needs no equivalent flight (it has
 * no drift animation anywhere in the HUD, so it already reads correctly from
 * the state `fulfillOrder` already committed), and the next queued event (if
 * any) plays immediately after - modeled on `LevelUpCelebration`'s queue.
 */

/** Same layer as LevelUpCelebration (above flying coins/crops, HUD). */
const CEREMONY_DEPTH = 2300;

const BACKDROP_ALPHA = 0.55;

/** Screen center - the shared anchor every chest position is offset from. */
const CENTER_X = DESIGN_WIDTH / 2;
const CENTER_Y = DESIGN_HEIGHT / 2;

const CHEST_SCALE_FROM = 0.5;
/** Single-chest scale target - unchanged from T2.23a. */
const CHEST_SCALE_TO = 2.5;
/**
 * Multi-chest scale target (T2.23b), reduced so a side-by-side pair fits
 * comfortably at CHEST_SPACING_X apart: at 128px frames, 1.6 -> 204.8px
 * display width per chest, leaving a 155px edge-to-edge gap between the two
 * (360 - 204.8) and ~258px clearance to each screen edge for a 2-chest row.
 */
const CHEST_SCALE_TO_MULTI = 1.6;
/** Horizontal distance between adjacent chest centers when there is more
 * than one - e.g. two chests sit at CENTER_X ± 180. */
const CHEST_SPACING_X = 360;
const CHEST_SCALE_IN_MS = 400;
/** Beat between the scale-in landing and the chest(s) swapping open. */
const CHEST_OPEN_BEAT_MS = 300;
const CHEST_FADE_OUT_MS = 250;
const OPEN_BUZZ_MS = 25;

/** Loot pop-in: coin first, moondust (when present) staggered after it. */
const LOOT_POP_MS = 250;
const LOOT_STAGGER_MS = 150;

const REWARD_ICON_SIZE = 76;
const REWARD_ICON_TEXT_GAP = 16;
/** Gap between the coin group and the moondust group in the single-chest row. */
const REWARD_GROUP_GAP = 56;

/**
 * Multi-chest column layout (T2.23b): each chest's loot sits beneath its own
 * position instead of replacing the chest in place. Row 1 (coins) clears the
 * multi-chest sprite's rendered bottom edge (CENTER_Y + 128 * 1.6 / 2 =
 * CENTER_Y + 102.4) by ~30px; row 2 (moondust) sits below row 1 by the
 * reward icon's own height plus a small gap.
 */
const LOOT_COLUMN_ROW1_Y = CENTER_Y + 170;
const LOOT_COLUMN_ROW_GAP = 20;
const LOOT_COLUMN_ROW2_Y = LOOT_COLUMN_ROW1_Y + REWARD_ICON_SIZE + LOOT_COLUMN_ROW_GAP;

const REWARD_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '60px',
  fontStyle: 'bold',
  color: '#fff3c4',
  stroke: '#3a2a10',
  strokeThickness: 8,
};

/** One chest's full visual set: its sprite plus its own coin/moondust loot pair. */
interface ChestSlot {
  chestImage: Phaser.GameObjects.Image;
  coinIcon: Phaser.GameObjects.Image;
  coinText: Phaser.GameObjects.Text;
  moondustIcon: Phaser.GameObjects.Image;
  moondustText: Phaser.GameObjects.Text;
}

export class ChestCeremony {
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  /** Grown lazily to the widest `contents` seen so far (see `ensureSlots`) -
   * supports any chest count without rework, though only 1-2 are generated today. */
  private readonly slots: ChestSlot[] = [];

  private readonly queue: ChestEvent[] = [];
  private active: ChestEvent | null = null;
  /** True once all loot has fully popped in - the only state a tap acts on. */
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

  private createSlot(): ChestSlot {
    const chestImage = this.scene.add
      .image(CENTER_X, CENTER_Y, ATLAS_KEY, 'chest_closed')
      .setDepth(CEREMONY_DEPTH + 1)
      .setVisible(false);
    const coinIcon = this.scene.add
      .image(CENTER_X, CENTER_Y, ATLAS_KEY, 'coin')
      .setDisplaySize(REWARD_ICON_SIZE, REWARD_ICON_SIZE)
      .setDepth(CEREMONY_DEPTH + 1)
      .setVisible(false);
    const coinText = this.scene.add
      .text(CENTER_X, CENTER_Y, '', REWARD_TEXT_STYLE)
      .setOrigin(0, 0.5)
      .setDepth(CEREMONY_DEPTH + 1)
      .setVisible(false);
    const moondustIcon = this.scene.add
      .image(CENTER_X, CENTER_Y, ATLAS_KEY, 'moondust')
      .setDisplaySize(REWARD_ICON_SIZE, REWARD_ICON_SIZE)
      .setDepth(CEREMONY_DEPTH + 1)
      .setVisible(false);
    const moondustText = this.scene.add
      .text(CENTER_X, CENTER_Y, '', REWARD_TEXT_STYLE)
      .setOrigin(0, 0.5)
      .setDepth(CEREMONY_DEPTH + 1)
      .setVisible(false);
    return { chestImage, coinIcon, coinText, moondustIcon, moondustText };
  }

  /** Grow the slot pool to at least `count`, reusing every slot already built. */
  private ensureSlots(count: number): void {
    while (this.slots.length < count) {
      this.slots.push(this.createSlot());
    }
  }

  /** This chest's x position among `total` chests, evenly spread around CENTER_X. */
  private chestX(index: number, total: number): number {
    return CENTER_X + (index - (total - 1) / 2) * CHEST_SPACING_X;
  }

  private playScaleIn(): void {
    const item = this.active;
    if (item === null) return;
    const n = item.contents.length;
    this.ensureSlots(n);
    const scaleTo = n === 1 ? CHEST_SCALE_TO : CHEST_SCALE_TO_MULTI;

    const scaleTargets: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < n; i++) {
      const slot = this.slots[i]!;
      slot.chestImage
        .setFrame('chest_closed')
        .setAlpha(1)
        .setScale(CHEST_SCALE_FROM)
        .setPosition(this.chestX(i, n), CENTER_Y)
        .setVisible(true);
      slot.coinIcon.setVisible(false);
      slot.coinText.setVisible(false);
      slot.moondustIcon.setVisible(false);
      slot.moondustText.setVisible(false);
      scaleTargets.push(slot.chestImage);
    }

    // One tween over every active chest sprite: they scale in simultaneously
    // and its single onComplete is the shared open beat.
    this.scene.tweens.add({
      targets: scaleTargets,
      scale: scaleTo,
      duration: CHEST_SCALE_IN_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.timer?.remove();
        this.timer = this.scene.time.delayedCall(CHEST_OPEN_BEAT_MS, () => this.playOpen());
      },
    });
  }

  private playOpen(): void {
    const item = this.active;
    if (item === null) return;
    const n = item.contents.length;

    const fadeTargets: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < n; i++) {
      const chestImage = this.slots[i]!.chestImage;
      chestImage.setFrame('chest_open');
      fadeTargets.push(chestImage);
    }
    // One shared burst + sound moment, regardless of chest count.
    this.particles.burst('sparkle', CENTER_X, CENTER_Y);
    buzz(OPEN_BUZZ_MS);

    this.scene.tweens.add({
      targets: fadeTargets,
      alpha: 0,
      duration: CHEST_FADE_OUT_MS,
      ease: 'Sine.easeIn',
      onComplete: () => fadeTargets.forEach((img) => img.setVisible(false)),
    });

    this.playLoot(item);
  }

  /**
   * Pop each chest's own coin (always) and moondust (when > 0) loot in,
   * staggered per chest exactly as the single-chest case always has been.
   * `landed` flips once every group across every chest has popped.
   */
  private playLoot(item: ChestEvent): void {
    const n = item.contents.length;
    const isSingle = n === 1;
    let moondustCount = 0;

    for (let i = 0; i < n; i++) {
      const slot = this.slots[i]!;
      const { coins, moondust } = item.contents[i]!;
      const hasMoondust = moondust > 0;
      if (hasMoondust) moondustCount++;
      slot.coinText.setText(String(coins));
      slot.moondustText.setText(hasMoondust ? String(moondust) : '');
      if (isSingle) {
        this.layoutSingleRow(slot, hasMoondust);
      } else {
        this.layoutColumn(slot, this.chestX(i, n), hasMoondust);
      }
    }

    let pendingPops = n + moondustCount;
    const onGroupsComplete = (groups: number): void => {
      pendingPops -= groups;
      if (pendingPops <= 0) this.landed = true;
    };

    const coinTargets: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[] = [];
    for (let i = 0; i < n; i++) {
      const slot = this.slots[i]!;
      slot.coinIcon.setVisible(true).setScale(0);
      slot.coinText.setVisible(true).setScale(0);
      coinTargets.push(slot.coinIcon, slot.coinText);
    }
    this.scene.tweens.add({
      targets: coinTargets,
      scale: 1,
      duration: LOOT_POP_MS,
      ease: 'Back.easeOut',
      onComplete: () => onGroupsComplete(n),
    });

    if (moondustCount > 0) {
      this.timer?.remove();
      this.timer = this.scene.time.delayedCall(LOOT_STAGGER_MS, () => {
        const moondustTargets: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[] = [];
        for (let i = 0; i < n; i++) {
          if (item.contents[i]!.moondust <= 0) continue;
          const slot = this.slots[i]!;
          slot.moondustIcon.setVisible(true).setScale(0);
          slot.moondustText.setVisible(true).setScale(0);
          moondustTargets.push(slot.moondustIcon, slot.moondustText);
        }
        this.scene.tweens.add({
          targets: moondustTargets,
          scale: 1,
          duration: LOOT_POP_MS,
          ease: 'Back.easeOut',
          onComplete: () => onGroupsComplete(moondustCount),
        });
      });
    }
  }

  /** Single-chest layout (unchanged from T2.23a): one row centered at screen center. */
  private layoutSingleRow(slot: ChestSlot, hasMoondust: boolean): void {
    const coinGroupWidth = REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP + slot.coinText.width;
    const moondustGroupWidth = hasMoondust
      ? REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP + slot.moondustText.width
      : 0;
    const totalWidth = coinGroupWidth + (hasMoondust ? REWARD_GROUP_GAP + moondustGroupWidth : 0);

    let cursor = CENTER_X - totalWidth / 2;
    slot.coinIcon.setPosition(cursor + REWARD_ICON_SIZE / 2, CENTER_Y);
    cursor += REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP;
    slot.coinText.setPosition(cursor, CENTER_Y);
    cursor += slot.coinText.width;

    if (hasMoondust) {
      cursor += REWARD_GROUP_GAP;
      slot.moondustIcon.setPosition(cursor + REWARD_ICON_SIZE / 2, CENTER_Y);
      cursor += REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP;
      slot.moondustText.setPosition(cursor, CENTER_Y);
    }
  }

  /** Multi-chest layout (T2.23b): this chest's own loot column, beneath its own x. */
  private layoutColumn(slot: ChestSlot, x: number, hasMoondust: boolean): void {
    const coinGroupWidth = REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP + slot.coinText.width;
    let cursor = x - coinGroupWidth / 2;
    slot.coinIcon.setPosition(cursor + REWARD_ICON_SIZE / 2, LOOT_COLUMN_ROW1_Y);
    cursor += REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP;
    slot.coinText.setPosition(cursor, LOOT_COLUMN_ROW1_Y);

    if (hasMoondust) {
      const moondustGroupWidth = REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP + slot.moondustText.width;
      let mCursor = x - moondustGroupWidth / 2;
      slot.moondustIcon.setPosition(mCursor + REWARD_ICON_SIZE / 2, LOOT_COLUMN_ROW2_Y);
      mCursor += REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP;
      slot.moondustText.setPosition(mCursor, LOOT_COLUMN_ROW2_Y);
    }
  }

  /**
   * Dismiss: hide the backdrop/loot, fly the ALREADY-GRANTED totals to the
   * HUD counters, and start the next queued event (if any). `coinsBefore`/
   * `moondustBefore` are derived from the current state minus this event's
   * own totals - correct regardless of other events queued before or after
   * it, since each event's contents are exactly the delta its own grant
   * added (see `ChestEvent`). Coins fly as one combined arc, originating from
   * the single coin icon's position for a 1-chest event (unchanged from
   * T2.23a) or screen center for 2+. Moondust (T2.23c) flies differently:
   * each chest that actually rolled moondust > 0 launches its own arc from
   * its own moondust icon's position (there is no "screen center" case to
   * mirror - a chest with no moondust simply contributes no arc).
   */
  private dismiss(): void {
    if (this.active === null) return;
    const item = this.active;
    this.timer?.remove();
    this.timer = null;
    this.backdrop.setVisible(false);

    const n = item.contents.length;
    const activeSlots = this.slots.slice(0, n);
    this.scene.tweens.killTweensOf(
      activeSlots.flatMap((slot) => [
        slot.chestImage,
        slot.coinIcon,
        slot.coinText,
        slot.moondustIcon,
        slot.moondustText,
      ]),
    );
    for (const slot of activeSlots) {
      slot.chestImage.setVisible(false);
      slot.coinIcon.setVisible(false);
      slot.coinText.setVisible(false);
      slot.moondustIcon.setVisible(false);
      slot.moondustText.setVisible(false);
    }

    const totalCoins = item.contents.reduce((sum, c) => sum + c.coins, 0);
    const coinsBefore = gameState.getState().coins - totalCoins;
    const isSingle = n === 1;
    const originX = isSingle ? activeSlots[0]!.coinIcon.x : CENTER_X;
    const originY = isSingle ? activeSlots[0]!.coinIcon.y : CENTER_Y;
    this.hud.flyChestCoins(originX, originY, coinsBefore, totalCoins);

    const totalMoondust = item.contents.reduce((sum, c) => sum + c.moondust, 0);
    const moondustBefore = gameState.getState().moondust - totalMoondust;
    const moondustOrigins = activeSlots
      .map((slot, i) => ({
        x: slot.moondustIcon.x,
        y: slot.moondustIcon.y,
        count: item.contents[i]!.moondust,
      }))
      .filter((origin) => origin.count > 0);
    this.hud.flyChestMoondust(moondustOrigins, moondustBefore, totalMoondust);

    this.active = null;
    this.playNext();
  }
}
