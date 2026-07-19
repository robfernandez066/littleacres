import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import {
  FARMHOUSE_FRAME,
  FARMHOUSE_RESTORED_FRAME,
  RESTORE_FARMHOUSE_COST,
  RESTORE_PANEL_BLURB,
  RESTORE_PANEL_BUTTON,
  RESTORE_PANEL_OWNED,
  RESTORE_PANEL_PERK,
  RESTORE_PANEL_SHORT,
  RESTORE_PANEL_TITLE,
} from '../data/restoration';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * "Restore the Homestead" (T3.25) - the one-time farmhouse restoration
 * upgrade, opened from the Decor Shop's own Restore button (the farmhouse tap
 * still opens the shop exactly as before).
 *
 * The panel is a before/after: the current farmhouse and the restored one side
 * by side, the perk it grants, and the two-currency price. The Buy button dims
 * and goes inert when either currency is short - the same convention as
 * DecorShop's Buy buttons - and disappears entirely once owned, replaced by
 * the "restored" line. Renders purely from the `GameStateData` passed to
 * `refresh`; the purchase itself and all its rules live in
 * `gameState.restoreFarmhouse`.
 *
 * No timers, no streaks, no countdown: this is a goal to save toward, and it
 * reads the same whether the player buys it today or in three months.
 */

const PANEL_WIDTH = 900;
/**
 * Matches the Decor Shop's own height exactly (DecorShop PANEL_HEIGHT). This
 * panel opens on TOP of the shop and leaves it standing, so anything shorter
 * lets the shop's Arrange Farm button poke out below this panel's bottom edge
 * and read as part of it.
 */
const PANEL_HEIGHT = 1320;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 980;
/**
 * Opened from the Decor Shop, which may itself be elevated above the arrange
 * control row (see DecorShop's ELEVATED_PANEL_DEPTH). This sits above BOTH
 * tiers so it is never opened behind its own parent.
 */
const PANEL_DEPTH = 2320;
const BACKDROP_DEPTH = 2310;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;

const BLURB_Y = -PANEL_HEIGHT / 2 + 150;

/**
 * Before/after pair, scaled to the same WIDTH and standing on the same line -
 * not the same height, which would shrink the restored building to make room
 * for its overhanging moon and misrepresent the upgrade as a size change. See
 * `buildPreview`. PREVIEW_Y is the line they both stand on - their shared
 * building base.
 */
const PREVIEW_Y = -60;
const PREVIEW_X = [-200, 200] as const;
const PREVIEW_WIDTH = 300;
const PREVIEW_LABEL_Y = 10;
const ARROW_Y = -200;

const PERK_Y = 130;

const PRICE_Y = 260;
const PRICE_ICON_NATIVE_SIZE = 96;
const PRICE_ICON_DISPLAY_SIZE = 44;
const PRICE_ICON_SCALE = PRICE_ICON_DISPLAY_SIZE / PRICE_ICON_NATIVE_SIZE;
/** Coin icon, coin amount, moondust icon, moondust amount - one centered row. */
const PRICE_COIN_ICON_X = -230;
const PRICE_COIN_TEXT_X = -185;
const PRICE_DUST_ICON_X = 60;
const PRICE_DUST_TEXT_X = 105;

const BUY_BUTTON_Y = 400;
const BUY_BUTTON_WIDTH = 340;
const BUY_BUTTON_HEIGHT = 100;
const BUY_BUTTON_ENABLED_ALPHA = 1;
const BUY_BUTTON_DISABLED_ALPHA = 0.4;
const STATUS_Y = 490;

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

const BLURB_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  color: '#7a5518',
  align: 'center',
};

const PREVIEW_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  fontStyle: 'bold',
  color: '#7a5518',
};

const ARROW_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '52px',
  fontStyle: 'bold',
  color: '#7a5518',
};

const PERK_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a7a2e',
  align: 'center',
};

const PRICE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '38px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const BUY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const STATUS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  color: '#7a5518',
  align: 'center',
};

const OWNED_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a7a2e',
  align: 'center',
};

export class RestorePanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly buyButton: Phaser.GameObjects.NineSlice;
  private readonly buyText: Phaser.GameObjects.Text;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly ownedText: Phaser.GameObjects.Text;
  private readonly priceObjects: Phaser.GameObjects.GameObject[] = [];
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
    /** Fired after a SUCCESSFUL purchase, for the scene's celebration. */
    private readonly onRestored: () => void,
  ) {
    this.backdrop = new ModalBackdrop(scene, () => {
      this.audio.sfx('tap');
      this.hide();
    });
    this.backdrop.setDepth(BACKDROP_DEPTH);
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
    // Swallow taps on the panel body so they never fall through to the field.
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
    const title = scene.add.text(0, TITLE_Y, RESTORE_PANEL_TITLE, TITLE_STYLE).setOrigin(0.5);
    const closeButton = scene.add
      .text(CLOSE_OFFSET_X, CLOSE_OFFSET_Y, 'X', CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16)
      .setInteractive({ useHandCursor: true });
    closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
    });
    const blurb = scene.add.text(0, BLURB_Y, RESTORE_PANEL_BLURB, BLURB_STYLE).setOrigin(0.5);
    this.container.add([bg, title, closeButton, blurb]);

    this.container.add([
      this.buildPreview(FARMHOUSE_FRAME, PREVIEW_X[0]),
      this.buildPreview(FARMHOUSE_RESTORED_FRAME, PREVIEW_X[1]),
      scene.add.text(PREVIEW_X[0], PREVIEW_LABEL_Y, 'Now', PREVIEW_LABEL_STYLE).setOrigin(0.5),
      scene.add.text(PREVIEW_X[1], PREVIEW_LABEL_Y, 'Restored', PREVIEW_LABEL_STYLE).setOrigin(0.5),
      scene.add.text(0, ARROW_Y, '>', ARROW_STYLE).setOrigin(0.5),
      scene.add.text(0, PERK_Y, RESTORE_PANEL_PERK, PERK_STYLE).setOrigin(0.5),
    ]);

    this.buildPriceRow();

    this.buyButton = scene.add.nineslice(
      0,
      BUY_BUTTON_Y,
      ATLAS_KEY,
      'panel',
      BUY_BUTTON_WIDTH,
      BUY_BUTTON_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    this.buyText = scene.add.text(0, BUY_BUTTON_Y, RESTORE_PANEL_BUTTON, BUY_STYLE).setOrigin(0.5);
    this.buyButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      // Only fires while the button is interactive (affordable, not owned),
      // and `restoreFarmhouse` re-checks everything anyway - so a double tap
      // or a double-fired handler can never double-charge.
      if (!gameState.restoreFarmhouse()) return;
      this.audio.coin();
      this.refresh(gameState.getState());
      this.onRestored();
    });
    this.statusText = scene.add.text(0, STATUS_Y, '', STATUS_STYLE).setOrigin(0.5);
    this.ownedText = scene.add
      .text(0, BUY_BUTTON_Y, RESTORE_PANEL_OWNED, OWNED_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    this.container.add([this.buyButton, this.buyText, this.statusText, this.ownedText]);
  }

  /**
   * One before/after preview. Scaled to a fixed WIDTH, not height: the two
   * frames share a building width by construction (see pack-atlas
   * processRestoredFarmhouse), so equal width means the two buildings read at
   * exactly the same size here, just as they do on the field. Origin sits on
   * the bottom edge of the shared building band so both previews stand on the
   * same line despite the restored frame's taller canvas.
   */
  private buildPreview(frame: string, x: number): Phaser.GameObjects.Image {
    const image = this.scene.add.image(x, PREVIEW_Y, ATLAS_KEY, frame);
    image.setScale(PREVIEW_WIDTH / image.frame.realWidth).setOrigin(0.5, 1);
    return image;
  }

  /** Coin + moondust price on one row, laid out around the panel center. */
  private buildPriceRow(): void {
    const coinIcon = this.scene.add
      .image(PRICE_COIN_ICON_X, PRICE_Y, ATLAS_KEY, 'coin')
      .setScale(PRICE_ICON_SCALE);
    const coinText = this.scene.add
      .text(
        PRICE_COIN_TEXT_X,
        PRICE_Y,
        RESTORE_FARMHOUSE_COST.coins.toLocaleString('en-US'),
        PRICE_STYLE,
      )
      .setOrigin(0, 0.5);
    const dustIcon = this.scene.add
      .image(PRICE_DUST_ICON_X, PRICE_Y, ATLAS_KEY, 'moondust')
      .setScale(PRICE_ICON_SCALE);
    const dustText = this.scene.add
      .text(PRICE_DUST_TEXT_X, PRICE_Y, String(RESTORE_FARMHOUSE_COST.moondust), PRICE_STYLE)
      .setOrigin(0, 0.5);
    this.priceObjects.push(coinIcon, coinText, dustIcon, dustText);
    this.container.add([coinIcon, coinText, dustIcon, dustText]);
  }

  /** Re-derive the buy/owned state from state - the panel's only state read. */
  refresh(state: GameStateData): void {
    const owned = state.restoration.farmhouse === 1;
    const affordable = gameState.canAffordFarmhouseRestoration();

    this.ownedText.setVisible(owned);
    this.buyButton.setVisible(!owned);
    this.buyText.setVisible(!owned);
    for (const object of this.priceObjects) {
      (object as Phaser.GameObjects.Image).setVisible(!owned);
    }

    if (owned) {
      this.buyButton.disableInteractive();
      this.statusText.setText('').setVisible(false);
      return;
    }
    this.buyButton.setAlpha(affordable ? BUY_BUTTON_ENABLED_ALPHA : BUY_BUTTON_DISABLED_ALPHA);
    if (affordable) {
      this.buyButton.setInteractive({ useHandCursor: true });
    } else {
      this.buyButton.disableInteractive();
    }
    this.statusText.setText(affordable ? '' : RESTORE_PANEL_SHORT).setVisible(!affordable);
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(state: GameStateData): void {
    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('restore-homestead', true);
    this.refresh(state);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('restore-homestead', false);
  }
}
