import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, VILLAGER_POSITION } from '../config';
import { CROPS } from '../data/crops';
import { type Order, ORDER_SLOTS } from '../data/orders';
import type { GameStateData } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { registerPoolStats } from '../systems/pool';
import { registerPulseTarget } from '../systems/pulseTargets';
import { now } from '../systems/time';
import { ModalBackdrop } from './ModalBackdrop';
import { PooledArc } from './PooledArc';

/**
 * Modal-style order board: three cards, one per order slot. An open card
 * shows the requested items ("have/need", colored by coverage), the stored
 * rewards, and Fulfill/Skip buttons; a cooldown card counts down to its next
 * order. Toggled by the HUD's Orders button; renders purely from the
 * `GameStateData` passed to `refresh` (cooldown seconds derive from `now()`
 * on the scene's 250ms refresh tick).
 *
 * State mutation happens in the HUD's callbacks, never here; this class owns
 * only board visuals, including the fulfilled-goods flight to the villager.
 */

const PANEL_WIDTH = 960;
const PANEL_HEIGHT = 1080;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 960;
/** Same layer as the inventory panel (2100) - the HUD never shows both at once. */
const PANEL_DEPTH = 2100;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;

const CARD_WIDTH = 880;
const CARD_HEIGHT = 280;
const CARD_START_Y = -250;
const CARD_SPACING = 300;

/** Y offsets of the two item rows within a card; a 1-item order uses only row 0. */
const ITEM_ROW_YS = [-85, -20] as const;
const ITEM_ICON_X = -360;
const ITEM_ICON_SCALE = 0.4;
const ITEM_NAME_X = -310;
const ITEM_COUNT_X = -100;

const REWARD_ROW_Y = 60;
const REWARD_COIN_X = -360;
const REWARD_COIN_SCALE = 0.35;
const REWARD_COIN_TEXT_X = -315;
const REWARD_XP_TEXT_X = -150;

const FULFILL_BUTTON_X = 240;
const FULFILL_BUTTON_Y = -60;
const FULFILL_BUTTON_WIDTH = 240;
const FULFILL_BUTTON_HEIGHT = 100;
const SKIP_BUTTON_X = 240;
const SKIP_BUTTON_Y = 55;
const SKIP_BUTTON_WIDTH = 240;
const SKIP_BUTTON_HEIGHT = 80;

const BUTTON_ENABLED_ALPHA = 1;
const BUTTON_DISABLED_ALPHA = 0.4;

/** Onboarding highlight bounds around the close (X) control (padded text). */
const CLOSE_TARGET_SIZE = 90;

/** Item count colors: covered by inventory vs still short. */
const COVERED_COLOR = '#2e7d32';
const SHORT_COLOR = '#b0483a';

/** The "Done!" stamp: quick scale-in, brief hold, fade - one beat. */
const STAMP_IN_MS = 150;
const STAMP_HOLD_MS = 250;
const STAMP_FADE_MS = 250;

/** Villager flights shrink en route like the other arcs. */
const VILLAGER_ARC_DEPTH = 2200;
const VILLAGER_ARC_START_SCALE = 0.5;
const VILLAGER_ARC_END_SCALE = 0.25;
/** Cap per item so a 12-unit request reads as a batch, not a swarm. */
const MAX_GOODS_PER_ITEM = 6;

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const CLOSE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/** Crop names stay in the panel's dark brown - always readable on the cream
 * card; only the have/need count carries the coverage color. */
const ITEM_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const ITEM_COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: COVERED_COLOR,
};

const REWARD_COIN_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const REWARD_XP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  color: '#7a5518',
};

const BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const SKIP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  color: '#4a3218',
};

const COOLDOWN_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  color: '#8a7350',
};

const STAMP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '72px',
  fontStyle: 'bold',
  color: COVERED_COLOR,
  stroke: '#fff8e1',
  strokeThickness: 8,
};

interface ItemRow {
  icon: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  countText: Phaser.GameObjects.Text;
}

interface OrderCard {
  itemRows: ItemRow[];
  rewardCoin: Phaser.GameObjects.Image;
  rewardCoinText: Phaser.GameObjects.Text;
  rewardXpText: Phaser.GameObjects.Text;
  fulfillButton: Phaser.GameObjects.NineSlice;
  fulfillText: Phaser.GameObjects.Text;
  skipButton: Phaser.GameObjects.NineSlice;
  skipText: Phaser.GameObjects.Text;
  cooldownText: Phaser.GameObjects.Text;
  stampText: Phaser.GameObjects.Text;
  /** Static world position of the card center, for arc/label origins. */
  worldX: number;
  worldY: number;
}

export class OrderBoard {
  private readonly container: Phaser.GameObjects.Container;
  private readonly cards: OrderCard[] = [];
  private readonly villagerArc: PooledArc;
  private readonly backdrop: ModalBackdrop;
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onFulfill: (slotIndex: number, worldX: number, worldY: number) => void,
    private readonly onSkip: (slotIndex: number) => void,
  ) {
    this.backdrop = new ModalBackdrop(scene, () => this.hide());
    this.container = scene.add
      .container(PANEL_CENTER_X, PANEL_CENTER_Y)
      .setDepth(PANEL_DEPTH)
      .setVisible(false);

    const bg = scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      PANEL_WIDTH,
      PANEL_HEIGHT,
      32,
      32,
      32,
      32,
    );
    // Swallow taps on the panel body so they never fall through to the field
    // or seed bar beneath - the buttons drawn on top of the bg still receive
    // their own pointer-down first and keep working.
    bg.setInteractive();
    bg.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => event.stopPropagation(),
    );
    const title = scene.add.text(0, TITLE_Y, 'Orders', TITLE_STYLE).setOrigin(0.5);
    const closeButton = scene.add
      .text(CLOSE_OFFSET_X, CLOSE_OFFSET_Y, 'X', CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16)
      .setInteractive({ useHandCursor: true });
    closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.hide());
    this.container.add([bg, title, closeButton]);

    for (let i = 0; i < ORDER_SLOTS; i++) {
      this.cards.push(this.buildCard(i));
    }

    // Onboarding highlight over slot 0's Fulfill button - only while the
    // board is open and that card is showing an open (fulfillable) order.
    // The button nineslice has no owner-managed scale state, so it is safe
    // for the guide to scale-breathe.
    registerPulseTarget('fulfill-slot-0', () => {
      const card = this.cards[0];
      if (!this.visible || card === undefined || !card.fulfillButton.visible) return null;
      return {
        x: PANEL_CENTER_X + FULFILL_BUTTON_X,
        y: PANEL_CENTER_Y + CARD_START_Y + FULFILL_BUTTON_Y,
        width: FULFILL_BUTTON_WIDTH,
        height: FULFILL_BUTTON_HEIGHT,
        object: card.fulfillButton,
      };
    });
    // Onboarding highlight over the close (X) control - only while the board
    // is open; closing it is the deliver step's next action once the board
    // is open but the order isn't covered yet. Halo-only (plain text object).
    registerPulseTarget('orders-close', () => {
      if (!this.visible) return null;
      return {
        x: PANEL_CENTER_X + CLOSE_OFFSET_X,
        y: PANEL_CENTER_Y + CLOSE_OFFSET_Y,
        width: CLOSE_TARGET_SIZE,
        height: CLOSE_TARGET_SIZE,
      };
    });
    // Onboarding highlight over the whole slot-0 card for the review-order
    // step - halo-only (the card is a composite of many objects), live for
    // as long as the board is open regardless of what the slot holds, so the
    // step can never wedge on a fulfilled or replaced card.
    registerPulseTarget('order-card-0', () => {
      if (!this.visible) return null;
      return {
        x: PANEL_CENTER_X,
        y: PANEL_CENTER_Y + CARD_START_Y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      };
    });

    this.villagerArc = new PooledArc(scene, {
      targetX: VILLAGER_POSITION.x,
      targetY: VILLAGER_POSITION.y,
      depth: VILLAGER_ARC_DEPTH,
      startScale: VILLAGER_ARC_START_SCALE,
      endScale: VILLAGER_ARC_END_SCALE,
      maxPerFly: MAX_GOODS_PER_ITEM,
      defaultFrame: CROPS.sunwheat.stageFrames[2],
      preallocate: MAX_GOODS_PER_ITEM * 2,
    });
    registerPoolStats('villager', this.villagerArc);
  }

  private buildCard(slotIndex: number): OrderCard {
    const y = CARD_START_Y + slotIndex * CARD_SPACING;

    const cardBg = this.scene.add.nineslice(
      0,
      y,
      ATLAS_KEY,
      'panel',
      CARD_WIDTH,
      CARD_HEIGHT,
      24,
      24,
      24,
      24,
    );

    const itemRows: ItemRow[] = ITEM_ROW_YS.map((rowY) => ({
      icon: this.scene.add
        .image(ITEM_ICON_X, y + rowY, ATLAS_KEY, CROPS.sunwheat.stageFrames[2])
        .setScale(ITEM_ICON_SCALE)
        .setVisible(false),
      nameText: this.scene.add
        .text(ITEM_NAME_X, y + rowY, '', ITEM_NAME_STYLE)
        .setOrigin(0, 0.5)
        .setVisible(false),
      countText: this.scene.add
        .text(ITEM_COUNT_X, y + rowY, '', ITEM_COUNT_STYLE)
        .setOrigin(0, 0.5)
        .setVisible(false),
    }));

    const rewardCoin = this.scene.add
      .image(REWARD_COIN_X, y + REWARD_ROW_Y, ATLAS_KEY, 'coin')
      .setScale(REWARD_COIN_SCALE);
    const rewardCoinText = this.scene.add
      .text(REWARD_COIN_TEXT_X, y + REWARD_ROW_Y, '', REWARD_COIN_STYLE)
      .setOrigin(0, 0.5);
    const rewardXpText = this.scene.add
      .text(REWARD_XP_TEXT_X, y + REWARD_ROW_Y, '', REWARD_XP_STYLE)
      .setOrigin(0, 0.5);

    const fulfillButton = this.scene.add.nineslice(
      FULFILL_BUTTON_X,
      y + FULFILL_BUTTON_Y,
      ATLAS_KEY,
      'panel',
      FULFILL_BUTTON_WIDTH,
      FULFILL_BUTTON_HEIGHT,
      24,
      24,
      24,
      24,
    );
    const fulfillText = this.scene.add
      .text(FULFILL_BUTTON_X, y + FULFILL_BUTTON_Y, 'Fulfill', BUTTON_STYLE)
      .setOrigin(0.5);

    const skipButton = this.scene.add.nineslice(
      SKIP_BUTTON_X,
      y + SKIP_BUTTON_Y,
      ATLAS_KEY,
      'panel',
      SKIP_BUTTON_WIDTH,
      SKIP_BUTTON_HEIGHT,
      24,
      24,
      24,
      24,
    );
    const skipText = this.scene.add
      .text(SKIP_BUTTON_X, y + SKIP_BUTTON_Y, 'Skip', SKIP_STYLE)
      .setOrigin(0.5);

    const cooldownText = this.scene.add
      .text(0, y, '', COOLDOWN_STYLE)
      .setOrigin(0.5)
      .setVisible(false);

    const stampText = this.scene.add
      .text(0, y, 'Done!', STAMP_STYLE)
      .setOrigin(0.5)
      .setVisible(false);

    const worldX = PANEL_CENTER_X;
    const worldY = PANEL_CENTER_Y + y;
    fulfillButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.onFulfill(slotIndex, worldX, worldY);
    });
    skipButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.onSkip(slotIndex);
    });
    skipButton.setInteractive({ useHandCursor: true });

    this.container.add([
      cardBg,
      ...itemRows.flatMap((row) => [row.icon, row.nameText, row.countText]),
      rewardCoin,
      rewardCoinText,
      rewardXpText,
      fulfillButton,
      fulfillText,
      skipButton,
      skipText,
      cooldownText,
      stampText,
    ]);

    return {
      itemRows,
      rewardCoin,
      rewardCoinText,
      rewardXpText,
      fulfillButton,
      fulfillText,
      skipButton,
      skipText,
      cooldownText,
      stampText,
      worldX,
      worldY,
    };
  }

  /** Re-derive every card from state; cooldown seconds come from `now()`. */
  refresh(state: GameStateData): void {
    const nowMs = now();
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const slot = state.orders[i];
      if (card === undefined || slot === undefined) continue;

      if (slot.state === 'open') {
        this.refreshOpenCard(card, slot.order, state);
        continue;
      }

      this.setOrderElementsVisible(card, false);
      card.cooldownText.setVisible(true);
      if (slot.state === 'cooldown') {
        const seconds = Math.max(0, Math.ceil((slot.readyAt - nowMs) / 1000));
        card.cooldownText.setText(`New order soon... ${seconds}s`);
      } else {
        // Pending: ensureOrders fills it within a tick; show a quiet beat.
        card.cooldownText.setText('...');
      }
    }
  }

  private refreshOpenCard(card: OrderCard, order: Order, state: GameStateData): void {
    this.setOrderElementsVisible(card, true);
    card.cooldownText.setVisible(false);

    let allCovered = true;
    for (let row = 0; row < card.itemRows.length; row++) {
      const itemRow = card.itemRows[row]!;
      const item = order.items[row];
      if (item === undefined) {
        itemRow.icon.setVisible(false);
        itemRow.nameText.setVisible(false);
        itemRow.countText.setVisible(false);
        continue;
      }
      const have = state.inventory[item.cropId] ?? 0;
      const covered = have >= item.count;
      if (!covered) allCovered = false;
      itemRow.icon.setFrame(CROPS[item.cropId].stageFrames[2]).setVisible(true);
      itemRow.nameText.setText(CROPS[item.cropId].name).setVisible(true);
      itemRow.countText
        .setText(`${have}/${item.count}`)
        .setColor(covered ? COVERED_COLOR : SHORT_COLOR)
        .setVisible(true);
    }

    card.rewardCoinText.setText(String(order.coinReward));
    card.rewardXpText.setText(`+${order.xpReward} xp`);

    card.fulfillButton.setAlpha(allCovered ? BUTTON_ENABLED_ALPHA : BUTTON_DISABLED_ALPHA);
    card.fulfillText.setAlpha(allCovered ? BUTTON_ENABLED_ALPHA : BUTTON_DISABLED_ALPHA);
    if (allCovered) {
      card.fulfillButton.setInteractive({ useHandCursor: true });
    } else {
      card.fulfillButton.disableInteractive();
    }
  }

  /** Show/hide everything an open card owns except the cooldown text and stamp. */
  private setOrderElementsVisible(card: OrderCard, visible: boolean): void {
    for (const row of card.itemRows) {
      row.icon.setVisible(visible);
      row.nameText.setVisible(visible);
      row.countText.setVisible(visible);
    }
    card.rewardCoin.setVisible(visible);
    card.rewardCoinText.setVisible(visible);
    card.rewardXpText.setVisible(visible);
    card.fulfillButton.setVisible(visible);
    card.fulfillText.setVisible(visible);
    card.skipButton.setVisible(visible);
    card.skipText.setVisible(visible);
  }

  /**
   * The board-owned half of the fulfill beat: the requested goods arc from
   * the card off screen to the villager, and a "Done!" stamp scales in and
   * fades on the card. Coin arcs, the xp label, and the buzz are the HUD's
   * half - it owns the coin ticker.
   */
  playFulfillJuice(slotIndex: number, order: Order): void {
    const card = this.cards[slotIndex];
    if (card === undefined) return;

    for (const item of order.items) {
      this.villagerArc.fly(
        card.worldX,
        card.worldY,
        item.count,
        undefined,
        CROPS[item.cropId].stageFrames[2],
      );
    }

    const stamp = card.stampText;
    this.scene.tweens.killTweensOf(stamp);
    stamp.setVisible(true).setAlpha(1).setScale(0);
    this.scene.tweens.add({
      targets: stamp,
      scale: 1,
      duration: STAMP_IN_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: stamp,
          alpha: 0,
          delay: STAMP_HOLD_MS,
          duration: STAMP_FADE_MS,
          ease: 'Sine.easeIn',
          onComplete: () => stamp.setVisible(false),
        });
      },
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(state: GameStateData): void {
    this.visible = !this.visible;
    this.container.setVisible(this.visible);
    this.backdrop.setActive(this.visible);
    setPanelOpen('orders', this.visible);
    if (this.visible) this.refresh(state);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('orders', false);
  }
}
