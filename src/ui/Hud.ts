import Phaser from 'phaser';

import { ATLAS_KEY, BAG_POSITION, DESIGN_WIDTH, HUD_COIN_POSITION } from '../config';
import { CROPS, type CropId } from '../data/crops';
import { MAX_LEVEL, xpForLevel } from '../data/levels';
import { gameState } from '../systems/gameState';
import { buzz } from '../systems/haptics';
import { CoinArc, MAX_COINS_PER_FLY } from './CoinArc';
import { CropArc } from './CropArc';
import { FloatingText } from './FloatingText';
import { InventoryPanel } from './InventoryPanel';

/**
 * Top HUD: coins (top-left), level + xp bar (top-center), moondust
 * (top-right), and the inventory bag button below it. Renders purely from
 * `gameState.getState()` - never owns game data.
 *
 * The coin counter is a display value that animates toward the true state
 * value rather than snapping: a steady drift tween on the regular refresh,
 * or a batched per-arrival climb while a sell's coin arcs are in flight.
 */

/** Confined to y < 420 (HUD headroom above the field band). */
const HUD_DEPTH = 2000;

const COIN_TEXT_OFFSET_X = 60;
const COIN_DRIFT_DURATION_MS = 300;

const LEVEL_TEXT_Y = 90;
const XP_BAR_Y = 140;
const XP_BAR_WIDTH = 340;
const XP_BAR_HEIGHT = 28;
const XP_BAR_PADDING = 4;

/**
 * Stacked under the coin counter, top-left; keeps the bag isolated top-right.
 * Icons are 96px, so y must differ from the coin's (120) by > 96 + a gap.
 */
const MOONDUST_X = 140;
const MOONDUST_Y = 230;
/** Matches COIN_TEXT_OFFSET_X so both counts left-align on their first digit. */
const MOONDUST_TEXT_OFFSET_X = 60;
/**
 * Placeholder moondust look: flat blue via setTintFill - a multiplicative
 * setTint can only darken the gold coin (reads brown, never blue). Real
 * moondust icon frame arrives with the T2.6 asset pack.
 */
const MOONDUST_TINT_FILL = 0x5b8bf5;

const BAG_BUTTON_WIDTH = 200;
const BAG_BUTTON_HEIGHT = 90;
/** Bag bounce on a harvested crop's arrival only - never on harvest start or a timer. */
const BAG_BOUNCE_SCALE = 1.12;
const BAG_BOUNCE_MS = 150;

const SELL_HAPTIC_MS = 12;
const SELL_LABEL_OFFSET_Y = -70;

/** Shared by the coin and moondust counters so the two always match. */
const CURRENCY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '44px',
  fontStyle: 'bold',
  color: '#4a3218',
  stroke: '#fff8e1',
  strokeThickness: 4,
};

const LEVEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const BAG_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

export class Hud {
  private readonly coinText: Phaser.GameObjects.Text;
  private readonly levelText: Phaser.GameObjects.Text;
  private readonly xpBarFill: Phaser.GameObjects.Rectangle;
  private readonly moondustText: Phaser.GameObjects.Text;
  private readonly bagContainer: Phaser.GameObjects.Container;
  private readonly cropArc: CropArc;
  private readonly inventoryPanel: InventoryPanel;

  /** Animated display value; ticks toward `gameState`'s true coin count. */
  private readonly coinDisplay = { value: 0 };
  private coinTween: Phaser.Tweens.Tween | null = null;
  /** While true, the periodic refresh leaves the coin ticker to the sell animation. */
  private sellAnimating = false;
  private bagBounceTween: Phaser.Tweens.Tween | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly coinArc: CoinArc,
    private readonly floatingText: FloatingText,
  ) {
    this.coinDisplay.value = gameState.getState().coins;

    this.scene.add
      .image(HUD_COIN_POSITION.x, HUD_COIN_POSITION.y, ATLAS_KEY, 'coin')
      .setDepth(HUD_DEPTH);
    this.coinText = this.scene.add
      .text(
        HUD_COIN_POSITION.x + COIN_TEXT_OFFSET_X,
        HUD_COIN_POSITION.y,
        String(this.coinDisplay.value),
        CURRENCY_STYLE,
      )
      .setOrigin(0, 0.5)
      .setDepth(HUD_DEPTH);

    this.levelText = this.scene.add
      .text(DESIGN_WIDTH / 2, LEVEL_TEXT_Y, '', LEVEL_STYLE)
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH);
    this.scene.add
      .rectangle(DESIGN_WIDTH / 2, XP_BAR_Y, XP_BAR_WIDTH, XP_BAR_HEIGHT, 0x2e4a1f)
      .setDepth(HUD_DEPTH);
    this.xpBarFill = this.scene.add
      .rectangle(
        DESIGN_WIDTH / 2 - XP_BAR_WIDTH / 2 + XP_BAR_PADDING,
        XP_BAR_Y,
        XP_BAR_WIDTH - XP_BAR_PADDING * 2,
        XP_BAR_HEIGHT - XP_BAR_PADDING * 2,
        0xf7d154,
      )
      .setOrigin(0, 0.5)
      .setDepth(HUD_DEPTH);

    this.scene.add
      .image(MOONDUST_X, MOONDUST_Y, ATLAS_KEY, 'coin')
      .setTintFill(MOONDUST_TINT_FILL)
      .setDepth(HUD_DEPTH);
    this.moondustText = this.scene.add
      .text(MOONDUST_X + MOONDUST_TEXT_OFFSET_X, MOONDUST_Y, '0', CURRENCY_STYLE)
      .setOrigin(0, 0.5)
      .setDepth(HUD_DEPTH);

    this.bagContainer = this.scene.add
      .container(BAG_POSITION.x, BAG_POSITION.y)
      .setDepth(HUD_DEPTH);
    const bagPanel = this.scene.add
      .nineslice(0, 0, ATLAS_KEY, 'panel', BAG_BUTTON_WIDTH, BAG_BUTTON_HEIGHT, 24, 24, 24, 24)
      .setInteractive({ useHandCursor: true });
    const bagText = this.scene.add.text(0, 0, 'Bag', BAG_STYLE).setOrigin(0.5);
    this.bagContainer.add([bagPanel, bagText]);
    bagPanel.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.inventoryPanel.toggle(gameState.getState());
    });

    this.cropArc = new CropArc(this.scene);

    this.inventoryPanel = new InventoryPanel(this.scene, (cropId, worldX, worldY) =>
      this.sellCrop(cropId, worldX, worldY),
    );

    this.refresh();
  }

  /**
   * Fly a harvested crop's mature sprite from its plot to the bag. The bag's
   * arrival bounce is driven exclusively by this flight landing - never by
   * the harvest itself or a timer, and never by coin arcs.
   */
  flyCropToBag(fromX: number, fromY: number, cropId: CropId): void {
    this.cropArc.fly(fromX, fromY, CROPS[cropId].stageFrames[2], () => this.bounceBag());
  }

  /** Small scale bounce on the bag button; restart-safe so rapid arrivals never compound. */
  private bounceBag(): void {
    this.bagBounceTween?.stop();
    this.bagContainer.setScale(1);
    this.bagBounceTween = this.scene.tweens.add({
      targets: this.bagContainer,
      scale: BAG_BOUNCE_SCALE,
      duration: BAG_BOUNCE_MS / 2,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }

  /** Re-derive every HUD element from state; called on the scene's refresh tick. */
  refresh(): void {
    const state = gameState.getState();

    this.levelText.setText(`Lv ${state.level}`);
    this.updateXpBar(state.level, state.xp);
    this.moondustText.setText(String(state.moondust));

    if (!this.sellAnimating) this.driftCoinsTo(state.coins);

    this.inventoryPanel.refresh(state);
  }

  private updateXpBar(level: number, xp: number): void {
    if (level >= MAX_LEVEL) {
      this.xpBarFill.setScale(1, 1);
      return;
    }
    const cur = xpForLevel(level);
    const next = xpForLevel(level + 1);
    const fraction = next > cur ? Phaser.Math.Clamp((xp - cur) / (next - cur), 0, 1) : 1;
    this.xpBarFill.setScale(fraction, 1);
  }

  /** Tween the coin display toward `target`; a no-op if already there. */
  private driftCoinsTo(target: number): void {
    if (Math.round(this.coinDisplay.value) === target) return;
    this.coinTween?.stop();
    this.coinTween = this.scene.tweens.add({
      targets: this.coinDisplay,
      value: target,
      duration: COIN_DRIFT_DURATION_MS,
      ease: 'Sine.easeOut',
      onUpdate: () => this.coinText.setText(String(Math.round(this.coinDisplay.value))),
    });
  }

  /**
   * Sell an entire crop stack: batched coin arcs from the sell button to the
   * HUD coin, an equal per-arrival ticker bump with a final true-up, a
   * floating "+N" label, and a light haptic buzz.
   */
  private sellCrop(cropId: CropId, worldX: number, worldY: number): void {
    const before = gameState.getState().coins;
    const gained = gameState.sellCrop(cropId);
    if (gained <= 0) return;

    this.coinTween?.stop();
    this.sellAnimating = true;
    const target = before + gained;
    const arrivals = Math.min(gained, MAX_COINS_PER_FLY);
    const share = Math.floor(gained / arrivals);
    let arrived = 0;

    this.coinArc.fly(worldX, worldY, gained, () => {
      arrived++;
      this.coinDisplay.value = arrived >= arrivals ? target : this.coinDisplay.value + share;
      this.coinText.setText(String(Math.round(this.coinDisplay.value)));
      if (arrived >= arrivals) this.sellAnimating = false;
    });

    this.floatingText.show(worldX, worldY + SELL_LABEL_OFFSET_Y, `+${gained}`, {
      color: '#ffe27a',
      fontSize: 40,
    });
    buzz(SELL_HAPTIC_MS);

    this.inventoryPanel.refresh(gameState.getState());
  }
}
