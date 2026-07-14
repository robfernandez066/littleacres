import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { DECOR_ITEMS, type DecorItemDef, MAX_DECORATIONS } from '../data/decor';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Modal Decor Shop (T3.9), opened by tapping the farmhouse: all 10
 * `DECOR_ITEMS` laid out in two columns of five rows, each row an icon,
 * name, price (currency icon + amount), and a Buy button that dims when
 * unaffordable or at MAX_DECORATIONS - same "row stays for repeat
 * purchases" convention as `InventoryPanel`'s Sell all buttons. Renders
 * purely from the `GameStateData` passed to `refresh`. An "Arrange Farm"
 * button (T3.9a) at the bottom closes the shop and calls `onArrange` - this
 * panel owns no arrange-mode state itself, that all lives in `FarmScene`.
 */

const PANEL_WIDTH = 900;
const PANEL_HEIGHT = 1320;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 980;
/** Above the seed bar (2000), below flying coins (2200) - same tier as the other panels. */
const PANEL_DEPTH = 2100;
/**
 * Elevated depth (T3.16): arrange mode's Shop button opens this same panel
 * without leaving arrange mode, so while open there it must sit above the
 * arrange control row (FarmScene's ARRANGE_UI_DEPTH, 2200) exactly like the
 * Shed panel already does - see FarmScene's WAREHOUSE_PANEL_DEPTH/
 * WAREHOUSE_BACKDROP_DEPTH comment for why. `setElevated` toggles between
 * this and the normal PANEL_DEPTH/ModalBackdrop tier; the farmhouse-tap flow
 * always resets to normal first (`FarmScene.openDecorShop`), since nothing
 * else there needs the panel to render above flying coins.
 */
const ELEVATED_PANEL_DEPTH = 2260;
const ELEVATED_BACKDROP_DEPTH = 2250;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;

/**
 * Two columns of five rows fit all 10 DECOR_ITEMS on one screen with no
 * scrolling - filled column-major (items 0-4 left column top to bottom,
 * 5-9 right column).
 */
const ROWS_PER_COLUMN = 5;
const COLUMN_X = [-215, 215] as const;
const ROW_START_Y = -380;
const ROW_SPACING = 190;

const ICON_OFFSET_X = -165;
const ICON_NATIVE_SIZE = 128;
const ICON_DISPLAY_SIZE = 84;
const ICON_SCALE = ICON_DISPLAY_SIZE / ICON_NATIVE_SIZE;

const NAME_OFFSET_X = -110;
const NAME_OFFSET_Y = -32;

const PRICE_ICON_OFFSET_X = -100;
const PRICE_ICON_OFFSET_Y = 34;
const PRICE_ICON_NATIVE_SIZE = 96;
const PRICE_ICON_DISPLAY_SIZE = 34;
const PRICE_ICON_SCALE = PRICE_ICON_DISPLAY_SIZE / PRICE_ICON_NATIVE_SIZE;
const PRICE_TEXT_OFFSET_X = -78;
const PRICE_TEXT_OFFSET_Y = 34;

const BUY_BUTTON_OFFSET_X = 140;
const BUY_BUTTON_WIDTH = 140;
const BUY_BUTTON_HEIGHT = 90;

/** Owned-count "xN" badge, perched above the icon's top-right corner. */
const OWNED_BADGE_OFFSET_X = -135;
const OWNED_BADGE_OFFSET_Y = -58;

const BUY_BUTTON_ENABLED_ALPHA = 1;
const BUY_BUTTON_DISABLED_ALPHA = 0.4;

/**
 * "Arrange Farm" (T3.9a): bottom of the panel, below the two-column grid
 * (last row center at ROW_START_Y + 4 * ROW_SPACING = 380) with clearance to
 * both the grid above and the panel's own bottom edge (PANEL_HEIGHT / 2 =
 * 660). Tapping it closes the shop and hands off to the scene's arrange mode
 * via `onArrange` - this panel owns no arrange-mode state itself.
 */
const ARRANGE_BUTTON_Y = 560;
const ARRANGE_BUTTON_WIDTH = 320;
const ARRANGE_BUTTON_HEIGHT = 90;

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
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const PRICE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  color: '#7a5518',
};

const BUY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const OWNED_BADGE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '24px',
  fontStyle: 'bold',
  color: '#fff8e1',
  backgroundColor: '#4a3218',
  padding: { left: 8, right: 8, top: 2, bottom: 2 },
};

const ARRANGE_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

interface ShopRow {
  item: DecorItemDef;
  buyButton: Phaser.GameObjects.NineSlice;
  ownedBadge: Phaser.GameObjects.Text;
}

export class DecorShop {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly rows: ShopRow[] = [];
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
    private readonly onArrange: () => void,
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
    const title = scene.add.text(0, TITLE_Y, 'Decor Shop', TITLE_STYLE).setOrigin(0.5);
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

    DECOR_ITEMS.forEach((item, index) => {
      this.rows.push(this.buildRow(item, index));
    });

    const arrangeButton = scene.add
      .nineslice(
        0,
        ARRANGE_BUTTON_Y,
        ATLAS_KEY,
        'panel',
        ARRANGE_BUTTON_WIDTH,
        ARRANGE_BUTTON_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setInteractive({ useHandCursor: true });
    const arrangeText = scene.add
      .text(0, ARRANGE_BUTTON_Y, 'Arrange Farm', ARRANGE_BUTTON_STYLE)
      .setOrigin(0.5);
    arrangeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
      this.onArrange();
    });
    this.container.add([arrangeButton, arrangeText]);
  }

  private buildRow(item: DecorItemDef, index: number): ShopRow {
    const colX = COLUMN_X[Math.floor(index / ROWS_PER_COLUMN)]!;
    const y = ROW_START_Y + (index % ROWS_PER_COLUMN) * ROW_SPACING;

    const icon = this.scene.add
      .image(colX + ICON_OFFSET_X, y, ATLAS_KEY, item.frame)
      .setScale(ICON_SCALE);
    const nameText = this.scene.add
      .text(colX + NAME_OFFSET_X, y + NAME_OFFSET_Y, item.name, NAME_STYLE)
      .setOrigin(0, 0.5);
    const priceIconFrame = item.currency === 'coins' ? 'coin' : 'moondust';
    const priceIcon = this.scene.add
      .image(colX + PRICE_ICON_OFFSET_X, y + PRICE_ICON_OFFSET_Y, ATLAS_KEY, priceIconFrame)
      .setScale(PRICE_ICON_SCALE);
    const priceText = this.scene.add
      .text(colX + PRICE_TEXT_OFFSET_X, y + PRICE_TEXT_OFFSET_Y, String(item.price), PRICE_STYLE)
      .setOrigin(0, 0.5);

    const buyButton = this.scene.add.nineslice(
      colX + BUY_BUTTON_OFFSET_X,
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
    const buyText = this.scene.add
      .text(colX + BUY_BUTTON_OFFSET_X, y, 'Buy', BUY_STYLE)
      .setOrigin(0.5);

    const ownedBadge = this.scene.add
      .text(colX + OWNED_BADGE_OFFSET_X, y + OWNED_BADGE_OFFSET_Y, '', OWNED_BADGE_STYLE)
      .setOrigin(0.5)
      .setVisible(false);

    buyButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      // Only fires when the button is interactive (affordable, under cap),
      // so the tap always accompanies a real purchase - mirrors
      // InventoryPanel's sell button.
      if (!gameState.buyDecoration(item.frame)) return;
      this.audio.coin();
      this.refresh(gameState.getState());
    });

    this.container.add([icon, nameText, priceIcon, priceText, buyButton, buyText, ownedBadge]);

    return { item, buyButton, ownedBadge };
  }

  /** Re-derive every row's owned count and Buy button enabled state from state. */
  refresh(state: GameStateData): void {
    const totalOwned =
      state.decorations.length +
      Object.values(state.warehouse).reduce((sum, count) => sum + count, 0);
    const atCap = totalOwned >= MAX_DECORATIONS;
    for (const row of this.rows) {
      // Placed + warehoused (T3.9b) - a purchase always lands in the
      // warehouse, so a placed-only count would undercount what's owned.
      const owned =
        state.decorations.filter((d) => d.frame === row.item.frame).length +
        (state.warehouse[row.item.frame] ?? 0);
      row.ownedBadge.setText(`x${owned}`).setVisible(owned > 0);

      const balance = row.item.currency === 'coins' ? state.coins : state.moondust;
      const enabled = !atCap && balance >= row.item.price;
      row.buyButton.setAlpha(enabled ? BUY_BUTTON_ENABLED_ALPHA : BUY_BUTTON_DISABLED_ALPHA);
      if (enabled) {
        row.buyButton.setInteractive({ useHandCursor: true });
      } else {
        row.buyButton.disableInteractive();
      }
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** See ELEVATED_PANEL_DEPTH/ELEVATED_BACKDROP_DEPTH above. */
  setElevated(elevated: boolean): void {
    this.container.setDepth(elevated ? ELEVATED_PANEL_DEPTH : PANEL_DEPTH);
    this.backdrop.setDepth(elevated ? ELEVATED_BACKDROP_DEPTH : undefined);
  }

  toggle(state: GameStateData): void {
    this.visible = !this.visible;
    this.container.setVisible(this.visible);
    this.backdrop.setActive(this.visible);
    setPanelOpen('decor-shop', this.visible);
    if (this.visible) this.refresh(state);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('decor-shop', false);
  }
}
