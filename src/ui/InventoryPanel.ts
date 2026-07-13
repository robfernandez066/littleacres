import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { CROPS, type CropDef, type CropId } from '../data/crops';
import type { AudioManager } from '../systems/audio';
import type { GameStateData } from '../systems/gameState';
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
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

interface InventoryRow {
  cropId: CropId;
  countText: Phaser.GameObjects.Text;
  sellButton: Phaser.GameObjects.NineSlice;
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

    sellButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      // Only fires when the button is interactive (count > 0), so the tap
      // always accompanies a real sale.
      this.audio.sfx('tap');
      this.onSell(crop.id, PANEL_CENTER_X + ROW_SELL_BUTTON_X, PANEL_CENTER_Y + y);
    });

    this.container.add([icon, nameText, countText, unitCoin, unitText, sellButton, sellText]);

    return {
      cropId: crop.id,
      countText,
      sellButton,
      worldX: PANEL_CENTER_X + ROW_SELL_BUTTON_X,
      worldY: PANEL_CENTER_Y + y,
    };
  }

  /** Re-derive row counts and sell-button enabled state from state. */
  refresh(state: GameStateData): void {
    this.sunwheatCount = state.inventory.sunwheat ?? 0;
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
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('inventory', false);
  }
}
