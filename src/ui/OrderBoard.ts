import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE, VILLAGER_POSITION } from '../config';
import { CROP_BASELINE_Y, CROP_FRAME_SIZE, CROPS } from '../data/crops';
import { type Order, ORDER_SLOTS } from '../data/orders';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
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
 * on the scene's 250ms refresh tick), plus the store's tutorial-rails
 * `railsAllow` query for the Skip buttons' dim/inert state.
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

/**
 * Requested items render as up to 3 "clusters" on one horizontal band,
 * vertically where the old two stacked item rows used to sit: icon + count
 * side by side (centered as a pair on the cluster's x), crop name centered
 * underneath. Size and x spread shrink as item-type count grows so 1, 2, or
 * 3 types all read clearly. The band is anchored left of card center (not
 * true center) because the Fulfill/Skip buttons own the right column (left
 * edge at local x 120, see FULFILL_BUTTON_X/WIDTH below) - every tier's
 * positions are chosen so the icon+count pair's measured width still clears
 * that edge with margin, and clears the card's left/top edges too.
 *
 * Icons are baseline-anchored (setOrigin(0.5, CROP_BASELINE_Y /
 * CROP_FRAME_SIZE), same convention FarmScene uses for planted crops) rather
 * than center-anchored, because the ready-stage art is packed with a fixed
 * baseline row but each crop's opaque content sits at a different height
 * within the frame - center-anchoring made crops of different silhouettes
 * render at visibly different heights. Baseline-anchoring puts every crop's
 * ready-stage frame (measured directly from assets/atlas.png: opaque pixels
 * span rows 1-118 of the 128px frame for all 3 crops today, content center
 * at row 59.5) on one shared ground line, all crops equal.
 */
const CLUSTER_BASELINE_Y = -35;
/**
 * Rows (unscaled frame space) from the baseline anchor (row CROP_BASELINE_Y
 * = 104) up to the visual content center (row 59.5, measured as above):
 * 104 - 59.5 = 44.5. Scaled by each tier's iconScale to vertically center
 * the count text on the icon's rendered content, not its padded frame.
 */
const CLUSTER_ICON_CONTENT_OFFSET = 44.5;
/** Gap between the icon's rendered bottom edge and the name text below it. */
const CLUSTER_NAME_GAP = 10;
/** Approximates half a single line's rendered height for Arial bold. */
const CLUSTER_NAME_HALF_HEIGHT_FACTOR = 0.55;

interface ClusterTier {
  iconScale: number;
  countFontSize: number;
  nameFontSize: number;
  /** Horizontal gap between the icon and the count text. */
  gap: number;
  /** Cluster center x per item-type count - one entry per cluster in this tier. */
  positions: readonly number[];
}

/** Indexed by item-type count - 1. Order generates 1-2 types today; the
 * 3-tier is future-proofing for a later "Major Shipments" system. */
const CLUSTER_TIERS: readonly ClusterTier[] = [
  { iconScale: 0.8, countFontSize: 44, nameFontSize: 30, gap: 12, positions: [-170] },
  { iconScale: 0.72, countFontSize: 40, nameFontSize: 26, gap: 10, positions: [-300, -60] },
  { iconScale: 0.45, countFontSize: 30, nameFontSize: 22, gap: 8, positions: [-350, -170, 10] },
];
/** More than 3 item types (not generated today) renders only the first 3. */
const MAX_CLUSTERS = 3;

const REWARD_ROW_Y = 62;
const REWARD_COIN_X = -360;
const REWARD_COIN_SCALE = 0.45;
const REWARD_COIN_TEXT_X = -305;
const REWARD_XP_TEXT_X = -130;

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
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const ITEM_COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: COVERED_COLOR,
};

const REWARD_COIN_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '38px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const REWARD_XP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
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

interface ItemCluster {
  icon: Phaser.GameObjects.Image;
  countText: Phaser.GameObjects.Text;
  nameText: Phaser.GameObjects.Text;
}

interface OrderCard {
  clusters: ItemCluster[];
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
    private readonly audio: AudioManager,
  ) {
    // Tap sounds live on the user-driven close seams (backdrop and X), never
    // in hide() itself - hide() is also called programmatically (e.g. when
    // the Bag button closes this board) and must stay silent then.
    this.backdrop = new ModalBackdrop(scene, () => {
      this.audio.sfx('tap');
      this.hide();
    });
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
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
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
    closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
    });
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
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );

    // Icon y is fixed regardless of tier (CLUSTER_BASELINE_Y is shared), so
    // it is set once here; countText/nameText y depend on the tier's
    // iconScale and are repositioned every refresh.
    const clusters: ItemCluster[] = Array.from({ length: MAX_CLUSTERS }, () => ({
      icon: this.scene.add
        .image(0, y + CLUSTER_BASELINE_Y, ATLAS_KEY, CROPS.sunwheat.stageFrames[2])
        .setOrigin(0.5, CROP_BASELINE_Y / CROP_FRAME_SIZE)
        .setVisible(false),
      countText: this.scene.add
        .text(0, y + CLUSTER_BASELINE_Y, '', ITEM_COUNT_STYLE)
        .setOrigin(0, 0.5)
        .setVisible(false),
      nameText: this.scene.add.text(0, y, '', ITEM_NAME_STYLE).setOrigin(0.5).setVisible(false),
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
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
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
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
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
      // Only interactive while the order is covered, so this tap always
      // accompanies a real fulfillment (whose fanfare rides playFulfillJuice).
      this.audio.sfx('tap');
      this.onFulfill(slotIndex, worldX, worldY);
    });
    skipButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.onSkip(slotIndex);
    });
    skipButton.setInteractive({ useHandCursor: true });

    this.container.add([
      cardBg,
      ...clusters.flatMap((cluster) => [cluster.icon, cluster.countText, cluster.nameText]),
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
      clusters,
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

    // Defensive: > 3 item types (not generated today) reuses the 3-tier and
    // only the first 3 clusters render - see MAX_CLUSTERS.
    const tier = CLUSTER_TIERS[Math.min(Math.max(order.items.length, 1), MAX_CLUSTERS) - 1]!;
    let allCovered = true;
    for (let i = 0; i < card.clusters.length; i++) {
      const cluster = card.clusters[i]!;
      const item = order.items[i];
      if (item === undefined) {
        cluster.icon.setVisible(false);
        cluster.countText.setVisible(false);
        cluster.nameText.setVisible(false);
        continue;
      }
      const have = state.inventory[item.cropId] ?? 0;
      const covered = have >= item.count;
      if (!covered) allCovered = false;

      const clusterX = tier.positions[i] ?? 0;
      cluster.icon
        .setFrame(CROPS[item.cropId].stageFrames[2])
        .setScale(tier.iconScale)
        .setVisible(true);
      // Vertically center the count on the icon's rendered content (not its
      // padded frame) - see CLUSTER_ICON_CONTENT_OFFSET.
      cluster.countText
        .setFontSize(tier.countFontSize)
        .setText(`${have}/${item.count}`)
        .setColor(covered ? COVERED_COLOR : SHORT_COLOR)
        .setY(cluster.icon.y - CLUSTER_ICON_CONTENT_OFFSET * tier.iconScale)
        .setVisible(true);
      // Name sits below the icon's actual rendered bottom edge (frame row
      // CROP_FRAME_SIZE scaled from the baseline), not a fixed offset, so it
      // never collides with a larger tier's icon.
      const iconBottomY = cluster.icon.y + (CROP_FRAME_SIZE - CROP_BASELINE_Y) * tier.iconScale;
      cluster.nameText
        .setFontSize(tier.nameFontSize)
        .setText(CROPS[item.cropId].name)
        .setX(clusterX)
        .setY(iconBottomY + CLUSTER_NAME_GAP + tier.nameFontSize * CLUSTER_NAME_HALF_HEIGHT_FACTOR)
        .setVisible(true);

      // Center the icon+count pair on clusterX: pairWidth is measured (not
      // estimated) so it stays exact regardless of digit count in "have/need".
      const pairWidth = cluster.icon.displayWidth + tier.gap + cluster.countText.width;
      cluster.icon.setX(clusterX - pairWidth / 2 + cluster.icon.displayWidth / 2);
      cluster.countText.setX(cluster.icon.x + cluster.icon.displayWidth / 2 + tier.gap);
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

    // Tutorial rails: skipping is never a tutorial action, so the Skip
    // buttons dim and go inert for the whole run (the store rejects the
    // mutation too - this is only the visual half).
    const skipAllowed = gameState.railsAllow('skip');
    card.skipButton.setAlpha(skipAllowed ? BUTTON_ENABLED_ALPHA : BUTTON_DISABLED_ALPHA);
    card.skipText.setAlpha(skipAllowed ? BUTTON_ENABLED_ALPHA : BUTTON_DISABLED_ALPHA);
    if (skipAllowed) {
      card.skipButton.setInteractive({ useHandCursor: true });
    } else {
      card.skipButton.disableInteractive();
    }
  }

  /** Show/hide everything an open card owns except the cooldown text and stamp. */
  private setOrderElementsVisible(card: OrderCard, visible: boolean): void {
    for (const cluster of card.clusters) {
      cluster.icon.setVisible(visible);
      cluster.countText.setVisible(visible);
      cluster.nameText.setVisible(visible);
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

    this.audio.sfx('fanfare');

    for (let i = 0; i < order.items.length && i < MAX_CLUSTERS; i++) {
      const item = order.items[i]!;
      const cluster = card.clusters[i]!;
      this.villagerArc.fly(
        PANEL_CENTER_X + cluster.icon.x,
        PANEL_CENTER_Y + cluster.icon.y,
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
