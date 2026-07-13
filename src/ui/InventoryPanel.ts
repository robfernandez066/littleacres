import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { CROPS, type CropDef, type CropId } from '../data/crops';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { registerPulseTarget } from '../systems/pulseTargets';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Modal-style inventory panel: one row per crop showing its icon, name,
 * held count, unit sell value, and a "Sell all" button. Toggled by the HUD's
 * bag button; renders purely from the `GameStateData` passed to `refresh`.
 */

const PANEL_WIDTH = 960;
/** Tall enough for all 7 crop rows (T3.11) with the same 80px clearance below
 * the last row that the 5-row panel had. */
const PANEL_HEIGHT = 900;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 780;
/** Above the seed bar (2000), below flying coins (2200). */
const PANEL_DEPTH = 2100;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;

/**
 * Row columns are fixed, non-overlapping x bands (icon, name, count, unit
 * value, sell button) laid out left to right. Count and unit value are
 * RIGHT-aligned into their band so they grow leftward, away from the sell
 * button, and stay legible up to "x9999" / "9999" without colliding with it -
 * regardless of digit count, not just the values the MVP crops happen to use.
 */
/** 160px below the panel top, same title clearance as before the 7-row refit. */
const ROW_START_Y = -PANEL_HEIGHT / 2 + 160;
/** 10px between 100px-tall sell buttons; 115 was too tall for 7 rows (T3.11). */
const ROW_SPACING = 110;
const ROW_ICON_X = -405;
const ROW_ICON_SCALE = 0.5;
const ROW_NAME_X = -352;
const ROW_COUNT_RIGHT_X = 40;
/** Far enough left of the unit value's band that a 4-digit value (Sagesprig's
 * 1200, T3.11) right-aligned at ROW_UNIT_TEXT_RIGHT_X clears the coin. */
const ROW_UNIT_COIN_X = 78;
const ROW_UNIT_COIN_SCALE = 0.4;
const ROW_UNIT_TEXT_RIGHT_X = 170;
const ROW_SELL_BUTTON_X = 325;
const SELL_BUTTON_WIDTH = 210;
const SELL_BUTTON_HEIGHT = 100;

const SELL_BUTTON_ENABLED_ALPHA = 1;
const SELL_BUTTON_DISABLED_ALPHA = 0.4;

/**
 * Two-tap sell confirm (T3.13): a first tap arms a row (only one row armed
 * at a time), showing the count/total it would sell; a second tap while
 * armed actually sells via the existing `onSell` path. Auto-disarms after
 * ARM_TIMEOUT_MS, when the panel closes, or when a refresh tick sees the
 * armed row's count change out from under it (a harvest landing mid-arm, or
 * the sale itself).
 */
const ARM_TIMEOUT_MS = 3000;
const DEFAULT_SELL_TEXT = 'Sell all';
const SELL_BUTTON_DEFAULT_FONT_SIZE = 32;
/** Shrinks from here down to ARMED_FONT_MIN_SIZE to keep the confirm phrasing inside the button. */
const ARMED_FONT_SIZE = 26;
const ARMED_FONT_MIN_SIZE = 18;
const ARMED_TEXT_MAX_WIDTH = SELL_BUTTON_WIDTH - 30;
/** Tint pulses between these two (gold <-> bright white) while a row is armed - "brighter/pulsing"
 * per the task, done via tint rather than a scale tween since the tutorial's own pulse-target
 * breathing (OnboardingGuide) already owns this button's scale during the sell-sunwheat step. */
const ARMED_TINT_LOW = Phaser.Display.Color.ValueToColor(0xffe27a);
const ARMED_TINT_HIGH = Phaser.Display.Color.ValueToColor(0xffffff);
const ARMED_PULSE_MS = 450;

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

const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  color: '#4a3218',
};

const UNIT_VALUE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  color: '#7a5518',
};

const SELL_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: `${SELL_BUTTON_DEFAULT_FONT_SIZE}px`,
  fontStyle: 'bold',
  color: '#4a3218',
  align: 'center',
};

interface InventoryRow {
  cropId: CropId;
  countText: Phaser.GameObjects.Text;
  sellButton: Phaser.GameObjects.NineSlice;
  sellText: Phaser.GameObjects.Text;
  /** Static world position of the sell button, for the coin-arc origin. */
  worldX: number;
  worldY: number;
}

export class InventoryPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly rows: InventoryRow[] = [];
  private readonly backdrop: ModalBackdrop;
  private visible = false;
  /** Last rendered sunwheat count, for the sell-sunwheat pulse provider. */
  private sunwheatCount = 0;
  /** The one row currently armed (two-tap sell confirm), or null. */
  private armedCropId: CropId | null = null;
  /** Real wall-clock arm time (UI timer, not game time) - drives ARM_TIMEOUT_MS. */
  private armedAt = -Infinity;
  /** Inventory count at the moment of arming; a mismatch on refresh disarms. */
  private armedCount = 0;
  private armPulseTween: Phaser.Tweens.Tween | null = null;
  private armedSellButton: Phaser.GameObjects.NineSlice | null = null;
  private readonly armPulsePhase = { t: 0 };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onSell: (cropId: CropId, worldX: number, worldY: number) => void,
    private readonly audio: AudioManager,
  ) {
    // Tap sounds live on the user-driven close seams (backdrop and X), never
    // in hide() itself - hide() is also called programmatically (e.g. when
    // the Orders button closes this panel) and must stay silent then.
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
    const title = scene.add.text(0, TITLE_Y, 'Inventory', TITLE_STYLE).setOrigin(0.5);
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

    Object.values(CROPS).forEach((crop, index) => {
      this.rows.push(this.buildRow(crop, index));
    });

    // Onboarding highlight over sunwheat's Sell all button - only while the
    // panel is open and there is actually sunwheat to sell. The button
    // nineslice has no owner-managed scale state, so it is safe for the
    // guide to scale-breathe.
    registerPulseTarget('sell-sunwheat', () => {
      const row = this.rows.find((r) => r.cropId === 'sunwheat');
      if (!this.visible || row === undefined || this.sunwheatCount <= 0) return null;
      return {
        x: row.worldX,
        y: row.worldY,
        width: SELL_BUTTON_WIDTH,
        height: SELL_BUTTON_HEIGHT,
        object: row.sellButton,
      };
    });
  }

  private buildRow(crop: CropDef, index: number): InventoryRow {
    const y = ROW_START_Y + index * ROW_SPACING;

    const icon = this.scene.add
      .image(ROW_ICON_X, y, ATLAS_KEY, crop.stageFrames[2])
      .setScale(ROW_ICON_SCALE);
    const nameText = this.scene.add.text(ROW_NAME_X, y, crop.name, NAME_STYLE).setOrigin(0, 0.5);
    const countText = this.scene.add
      .text(ROW_COUNT_RIGHT_X, y, 'x0', COUNT_STYLE)
      .setOrigin(1, 0.5);
    const unitCoin = this.scene.add
      .image(ROW_UNIT_COIN_X, y, ATLAS_KEY, 'coin')
      .setScale(ROW_UNIT_COIN_SCALE);
    const unitText = this.scene.add
      .text(ROW_UNIT_TEXT_RIGHT_X, y, String(crop.sellValue), UNIT_VALUE_STYLE)
      .setOrigin(1, 0.5);

    const sellButton = this.scene.add.nineslice(
      ROW_SELL_BUTTON_X,
      y,
      ATLAS_KEY,
      'panel',
      SELL_BUTTON_WIDTH,
      SELL_BUTTON_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const sellText = this.scene.add
      .text(ROW_SELL_BUTTON_X, y, 'Sell all', SELL_BUTTON_STYLE)
      .setOrigin(0.5);

    // Only fires when the button is interactive (count > 0). First tap arms;
    // second tap (while already armed) sells - see `handleSellTap`.
    sellButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.handleSellTap(crop.id);
    });

    this.container.add([icon, nameText, countText, unitCoin, unitText, sellButton, sellText]);

    return {
      cropId: crop.id,
      countText,
      sellButton,
      sellText,
      worldX: PANEL_CENTER_X + ROW_SELL_BUTTON_X,
      worldY: PANEL_CENTER_Y + y,
    };
  }

  /**
   * Re-derive row counts and sell-button enabled state from state. Also
   * auto-disarms the armed row (if any) on a timeout or a count change - the
   * only two auto-disarm cases that surface on a refresh tick; the panel
   * closing and another row arming are handled at their own call sites.
   */
  refresh(state: GameStateData): void {
    this.sunwheatCount = state.inventory.sunwheat ?? 0;

    if (this.armedCropId !== null) {
      const currentCount = state.inventory[this.armedCropId] ?? 0;
      const timedOut = Date.now() - this.armedAt >= ARM_TIMEOUT_MS;
      if (timedOut || currentCount !== this.armedCount) this.disarm();
    }

    for (const row of this.rows) {
      const count = state.inventory[row.cropId] ?? 0;
      row.countText.setText(`x${count}`);
      const enabled = count > 0;
      row.sellButton.setAlpha(enabled ? SELL_BUTTON_ENABLED_ALPHA : SELL_BUTTON_DISABLED_ALPHA);
      if (enabled) {
        row.sellButton.setInteractive({ useHandCursor: true });
      } else {
        row.sellButton.disableInteractive();
      }
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(state: GameStateData): void {
    this.visible = !this.visible;
    this.container.setVisible(this.visible);
    this.backdrop.setActive(this.visible);
    setPanelOpen('inventory', this.visible);
    if (this.visible) this.refresh(state);
    else this.disarm();
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('inventory', false);
    this.disarm();
  }

  /** First tap on an unarmed row arms it (disarming any other); a second tap while armed sells. */
  private handleSellTap(cropId: CropId): void {
    this.audio.sfx('tap');
    if (this.armedCropId === cropId) {
      const row = this.rows.find((r) => r.cropId === cropId);
      this.disarm();
      if (row !== undefined) this.onSell(cropId, row.worldX, row.worldY);
      return;
    }
    this.armRow(cropId);
  }

  private armRow(cropId: CropId): void {
    const row = this.rows.find((r) => r.cropId === cropId);
    if (row === undefined) return;
    this.armedCropId = cropId;
    this.armedAt = Date.now();
    this.armedCount = gameState.getState().inventory[cropId] ?? 0;
    this.renderArmedRows();
  }

  private disarm(): void {
    if (this.armedCropId === null) return;
    this.armedCropId = null;
    this.armedAt = -Infinity;
    this.armedCount = 0;
    this.renderArmedRows();
  }

  /** Re-derive every row's sell-button text/tint from the armed state - only one row is ever armed. */
  private renderArmedRows(): void {
    this.stopArmedPulse();
    for (const row of this.rows) {
      if (row.cropId === this.armedCropId) {
        const total = this.armedCount * CROPS[row.cropId].sellValue;
        row.sellText.setText(`Sell ${this.armedCount}\nfor ${total}?`);
        this.fitArmedText(row.sellText);
        this.startArmedPulse(row.sellButton);
      } else {
        row.sellText.setText(DEFAULT_SELL_TEXT).setFontSize(SELL_BUTTON_DEFAULT_FONT_SIZE);
      }
    }
  }

  /** Shrinks the armed confirm text down to ARMED_FONT_MIN_SIZE so it never overflows the button. */
  private fitArmedText(text: Phaser.GameObjects.Text): void {
    let size = ARMED_FONT_SIZE;
    text.setFontSize(size);
    while (text.width > ARMED_TEXT_MAX_WIDTH && size > ARMED_FONT_MIN_SIZE) {
      size -= 2;
      text.setFontSize(size);
    }
  }

  /**
   * "Brighter/pulsing" armed-state highlight, via a tint pulse rather than a
   * scale tween: the sell-sunwheat pulse target (OnboardingGuide) already
   * scale-breathes this same button during the tutorial's sell step, and
   * tint states belong to their owners (OnboardingGuide's own convention) -
   * so this never fights that tween over `.scale`.
   */
  private startArmedPulse(sellButton: Phaser.GameObjects.NineSlice): void {
    this.armedSellButton = sellButton;
    this.armPulsePhase.t = 0;
    this.armPulseTween = this.scene.tweens.add({
      targets: this.armPulsePhase,
      t: 1,
      duration: ARMED_PULSE_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const color = Phaser.Display.Color.Interpolate.ColorWithColor(
          ARMED_TINT_LOW,
          ARMED_TINT_HIGH,
          100,
          Math.round(this.armPulsePhase.t * 100),
        );
        this.armedSellButton?.setTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
      },
    });
  }

  private stopArmedPulse(): void {
    this.armPulseTween?.stop();
    this.armPulseTween = null;
    this.armedSellButton?.clearTint();
    this.armedSellButton = null;
  }
}
