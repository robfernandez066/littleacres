import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { BUILDINGS, type BuildingDef } from '../data/buildings';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Modal Building Shop (T4.2d), opened by the HUD's Shop button: every entry in
 * `BUILDINGS` as one row - icon, name, price (coin icon + amount) - with a
 * right-hand action that re-derives from state on every `refresh`:
 *
 *   level < unlockLevel      -> "Unlocks at level N", dimmed, no Buy
 *   unlocked, not owned      -> a Buy button, dimmed when coins are short
 *   already owned            -> "Owned", no Buy
 *
 * Mirrors `DecorShop` throughout (ModalBackdrop, PANEL_DEPTH, per-row Buy
 * calling a store method then refreshing). The store is the SOLE authority on
 * whether a purchase happens: Buy calls `gameState.buyBuilding`, which
 * re-checks unknown/owned/level/coins, and this panel never re-implements a
 * gate - the row states here are presentation only. Renders purely from the
 * `GameStateData` passed to `refresh`.
 *
 * A bought building lands at its `defaultAnchor`; `FarmScene.refreshBuildings`
 * picks the new placement up on its next tick, so nothing here touches the
 * field. (Optional future polish: glide the camera to the new building.)
 */

const PANEL_WIDTH = 900;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 780;
/** Above the seed bar (2000), below flying coins (2200) - same tier as the other panels. */
const PANEL_DEPTH = 2100;

/** Distance from the panel's top edge to the first row's center. */
const ROW_TOP_INSET = 200;
const ROW_SPACING = 200;
/** Space below the last row for the confirmation line and the move hint. */
const ROW_BOTTOM_BAND = 210;
const ROW_COUNT = Object.keys(BUILDINGS).length;
/**
 * DERIVED from the roster rather than hand-tuned, like InventoryPanel's: a
 * second building is one registry entry and the panel grows to fit it.
 */
const PANEL_HEIGHT = ROW_TOP_INSET + (ROW_COUNT - 1) * ROW_SPACING + ROW_BOTTOM_BAND;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;
const ROW_START_Y = -PANEL_HEIGHT / 2 + ROW_TOP_INSET;

/**
 * A building's `frame` is a 256-square structure frame (the crops/decor icons
 * are 128), so it needs its own scale to sit in a row the way a decor icon
 * does - the same size mismatch the level-up card has to correct for.
 */
const ICON_OFFSET_X = -300;
const ICON_NATIVE_SIZE = 256;
const ICON_DISPLAY_SIZE = 120;
const ICON_SCALE = ICON_DISPLAY_SIZE / ICON_NATIVE_SIZE;

const NAME_OFFSET_X = -210;
const NAME_OFFSET_Y = -34;

const PRICE_ICON_OFFSET_X = -195;
const PRICE_ICON_OFFSET_Y = 34;
const PRICE_ICON_NATIVE_SIZE = 96;
const PRICE_ICON_DISPLAY_SIZE = 34;
const PRICE_ICON_SCALE = PRICE_ICON_DISPLAY_SIZE / PRICE_ICON_NATIVE_SIZE;
const PRICE_TEXT_OFFSET_X = -172;
const PRICE_TEXT_OFFSET_Y = 34;

/** Buy button and the locked/owned status label share this column. */
const ACTION_OFFSET_X = 250;
const BUY_BUTTON_WIDTH = 170;
const BUY_BUTTON_HEIGHT = 90;
/** Status copy ("Unlocks at level 6") wraps rather than running past the panel edge. */
const STATUS_WRAP_WIDTH = 260;

const BUY_BUTTON_ENABLED_ALPHA = 1;
const BUY_BUTTON_DISABLED_ALPHA = 0.4;
/** Locked rows read as unavailable at a glance - the locked-crop/region convention. */
const LOCKED_ROW_ALPHA = 0.45;

/**
 * Purchase confirmation, panel-owned rather than a `FloatingText`: floats draw
 * at FLOATING_TEXT_DEPTH (1900), BELOW this panel's 2100, so a pooled float
 * over an open panel is hidden by the panel itself. A label inside the
 * container rises and fades the same way and is actually visible.
 */
const CONFIRM_Y = PANEL_HEIGHT / 2 - 95;
const CONFIRM_RISE = 34;
const CONFIRM_HOLD_MS = 900;
const CONFIRM_FADE_MS = 450;

const HINT_Y = PANEL_HEIGHT / 2 - 45;
const HINT_TEXT = 'Tap Edit Layout to move a building.';

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
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
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const PRICE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  color: '#7a5518',
};

const BUY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const STATUS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  fontStyle: 'bold',
  color: '#7a5518',
  align: 'center',
};

const CONFIRM_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#3f7a35',
};

const HINT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '24px',
  color: '#8a6b3a',
};

interface BuildingRow {
  def: BuildingDef;
  /** Everything but the action column - dimmed as a group while locked. */
  icon: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  priceIcon: Phaser.GameObjects.Image;
  priceText: Phaser.GameObjects.Text;
  buyButton: Phaser.GameObjects.NineSlice;
  buyText: Phaser.GameObjects.Text;
  /** "Unlocks at level N" / "Owned" - shown instead of the Buy button. */
  statusText: Phaser.GameObjects.Text;
}

export class BuildingShop {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly rows: BuildingRow[] = [];
  private readonly confirmText: Phaser.GameObjects.Text;
  private confirmTween: Phaser.Tweens.Tween | null = null;
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
  ) {
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
    // Swallow taps on the panel body so they never fall through to the field beneath.
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
    const title = scene.add.text(0, TITLE_Y, 'Building Shop', TITLE_STYLE).setOrigin(0.5);
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

    Object.values(BUILDINGS).forEach((def, index) => {
      this.rows.push(this.buildRow(def, index));
    });

    this.confirmText = scene.add
      .text(0, CONFIRM_Y, '', CONFIRM_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    const hint = scene.add.text(0, HINT_Y, HINT_TEXT, HINT_STYLE).setOrigin(0.5);
    this.container.add([this.confirmText, hint]);
  }

  private buildRow(def: BuildingDef, index: number): BuildingRow {
    const y = ROW_START_Y + index * ROW_SPACING;

    const icon = this.scene.add.image(ICON_OFFSET_X, y, ATLAS_KEY, def.frame).setScale(ICON_SCALE);
    const nameText = this.scene.add
      .text(NAME_OFFSET_X, y + NAME_OFFSET_Y, def.name, NAME_STYLE)
      .setOrigin(0, 0.5);
    const priceIcon = this.scene.add
      .image(PRICE_ICON_OFFSET_X, y + PRICE_ICON_OFFSET_Y, ATLAS_KEY, 'coin')
      .setScale(PRICE_ICON_SCALE);
    const priceText = this.scene.add
      .text(PRICE_TEXT_OFFSET_X, y + PRICE_TEXT_OFFSET_Y, String(def.price), PRICE_STYLE)
      .setOrigin(0, 0.5);

    const buyButton = this.scene.add.nineslice(
      ACTION_OFFSET_X,
      y,
      ATLAS_KEY,
      'panel',
      BUY_BUTTON_WIDTH,
      BUY_BUTTON_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const buyText = this.scene.add.text(ACTION_OFFSET_X, y, 'Buy', BUY_STYLE).setOrigin(0.5);
    const statusText = this.scene.add
      .text(ACTION_OFFSET_X, y, '', STATUS_STYLE)
      .setOrigin(0.5)
      .setWordWrapWidth(STATUS_WRAP_WIDTH)
      .setVisible(false);

    buyButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      // Only fires when the button is interactive (unlocked, unowned,
      // affordable), but the store re-checks all of it anyway and is what
      // decides - a refused purchase changes nothing and shows nothing.
      if (!gameState.buyBuilding(def.id)) return;
      this.audio.coin();
      this.showConfirm(`${def.name} placed!`);
      this.refresh(gameState.getState());
    });

    this.container.add([icon, nameText, priceIcon, priceText, buyButton, buyText, statusText]);

    return { def, icon, nameText, priceIcon, priceText, buyButton, buyText, statusText };
  }

  /** Re-derive every row's action column and dimming from state. */
  refresh(state: GameStateData): void {
    for (const row of this.rows) {
      const owned = state.buildings.some((placed) => placed.type === row.def.id);
      const unlocked = state.level >= row.def.unlockLevel;
      const affordable = state.coins >= row.def.price;
      const showBuy = unlocked && !owned;

      // The whole row (bar the action column) dims while it is out of reach,
      // the same read a locked crop or region gets.
      const rowAlpha = unlocked ? 1 : LOCKED_ROW_ALPHA;
      row.icon.setAlpha(rowAlpha);
      row.nameText.setAlpha(rowAlpha);
      row.priceIcon.setAlpha(rowAlpha);
      row.priceText.setAlpha(rowAlpha);

      row.buyButton.setVisible(showBuy);
      row.buyText.setVisible(showBuy);
      row.statusText.setVisible(!showBuy);

      if (showBuy) {
        row.buyButton.setAlpha(affordable ? BUY_BUTTON_ENABLED_ALPHA : BUY_BUTTON_DISABLED_ALPHA);
        row.buyText.setAlpha(affordable ? BUY_BUTTON_ENABLED_ALPHA : BUY_BUTTON_DISABLED_ALPHA);
        if (affordable) {
          row.buyButton.setInteractive({ useHandCursor: true });
        } else {
          row.buyButton.disableInteractive();
        }
      } else {
        row.buyButton.disableInteractive();
        row.statusText
          .setText(owned ? 'Owned' : `Unlocks at level ${row.def.unlockLevel}`)
          .setAlpha(owned ? 1 : LOCKED_ROW_ALPHA);
      }
    }
  }

  /** Brief rise-and-fade confirmation inside the panel - see CONFIRM_Y's comment. */
  private showConfirm(message: string): void {
    this.confirmTween?.stop();
    this.confirmText.setText(message).setY(CONFIRM_Y).setAlpha(1).setVisible(true);
    this.confirmTween = this.scene.tweens.add({
      targets: this.confirmText,
      y: CONFIRM_Y - CONFIRM_RISE,
      alpha: 0,
      delay: CONFIRM_HOLD_MS,
      duration: CONFIRM_FADE_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.confirmText.setVisible(false);
        this.confirmTween = null;
      },
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(state: GameStateData): void {
    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('building-shop', true);
    this.refresh(state);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('building-shop', false);
    // A confirmation never survives the panel closing and reopening.
    this.confirmTween?.stop();
    this.confirmTween = null;
    this.confirmText.setVisible(false);
  }
}
