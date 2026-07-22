import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { PATH_TIER_LIST, type PathTierDef, type PathTierId } from '../data/paths';
import type { AudioManager } from '../systems/audio';
import type { GameStateData } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Modal Paths panel (T4.12), reached from the HUD's Shop button via the
 * Building Shop's "Paths" button: every entry in `PATH_TIERS` as one row -
 * a tile-diamond preview, name, and cost ("Free" at 0 coins, a coin icon and
 * amount otherwise) - with a "Paint" button on the right.
 *
 * Unlike `BuildingShop`, choosing a row is NOT a purchase: it closes this
 * panel and enters a PERSISTENT paint mode (`onSelectTier`), where the player
 * lays tile after tile until they leave. The per-tile coin cost is charged by
 * `gameState.paintPath` on each placement, never here - so this panel never
 * deducts anything and a row is never "owned" or "sold out".
 *
 * Affordability dimming is presentation only, exactly as in `BuildingShop`:
 * a player short on coins may still ENTER paint mode (they might sell a crop
 * mid-paint), and the store refuses the individual tiles.
 *
 * Mirrors `BuildingShop` throughout (ModalBackdrop, PANEL_DEPTH, per-row
 * action button, renders purely from the `GameStateData` passed to `refresh`).
 */

const PANEL_WIDTH = 900;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 780;
/** The same tier as the other modal panels - see BuildingShop's PANEL_DEPTH. */
const PANEL_DEPTH = 2100;

const ROW_TOP_INSET = 200;
const ROW_SPACING = 200;
/** Space below the last row for the mode hint. */
const ROW_BOTTOM_BAND = 170;
const ROW_COUNT = PATH_TIER_LIST.length;
/** DERIVED from the tier registry, like BuildingShop's - a new tier grows the panel. */
const PANEL_HEIGHT = ROW_TOP_INSET + (ROW_COUNT - 1) * ROW_SPACING + ROW_BOTTOM_BAND;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;
const ROW_START_Y = -PANEL_HEIGHT / 2 + ROW_TOP_INSET;

/**
 * A tier's frame is a 256x128 TILE DIAMOND (never a 128 icon or a 256
 * structure square), so the preview is scaled by width alone - the row shows
 * the actual painted tile, at a size that sits in the row like a decor icon.
 */
const ICON_OFFSET_X = -300;
const ICON_NATIVE_WIDTH = 256;
const ICON_DISPLAY_WIDTH = 150;
const ICON_SCALE = ICON_DISPLAY_WIDTH / ICON_NATIVE_WIDTH;

const NAME_OFFSET_X = -190;
const NAME_OFFSET_Y = -34;

const PRICE_ICON_OFFSET_X = -175;
const PRICE_ICON_OFFSET_Y = 34;
const PRICE_ICON_NATIVE_SIZE = 96;
const PRICE_ICON_DISPLAY_SIZE = 34;
const PRICE_ICON_SCALE = PRICE_ICON_DISPLAY_SIZE / PRICE_ICON_NATIVE_SIZE;
const PRICE_TEXT_OFFSET_X = -152;
const PRICE_TEXT_OFFSET_Y = 34;
/** A free tier shows the word, not a coin icon and a zero. */
const FREE_TEXT_OFFSET_X = -190;

const ACTION_OFFSET_X = 250;
const PAINT_BUTTON_WIDTH = 190;
const PAINT_BUTTON_HEIGHT = 90;

const BUTTON_ENABLED_ALPHA = 1;
const BUTTON_DISABLED_ALPHA = 0.4;

const HINT_Y = PANEL_HEIGHT / 2 - 55;
const HINT_TEXT = 'Drag across the ground to lay a path. Tap Done when finished.';
const HINT_WRAP_WIDTH = PANEL_WIDTH - 120;

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

const PAINT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const HINT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '24px',
  color: '#8a6b3a',
  align: 'center',
};

interface PathRow {
  def: PathTierDef;
  paintButton: Phaser.GameObjects.NineSlice;
  paintText: Phaser.GameObjects.Text;
}

export class PathsPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly rows: PathRow[] = [];
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
    /** Enter the persistent paint mode for `tier` - see the class comment. */
    private readonly onSelectTier: (tier: PathTierId) => void,
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
    const title = scene.add.text(0, TITLE_Y, 'Paths', TITLE_STYLE).setOrigin(0.5);
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

    PATH_TIER_LIST.forEach((def, index) => {
      this.rows.push(this.buildRow(def, index));
    });

    const hint = scene.add
      .text(0, HINT_Y, HINT_TEXT, HINT_STYLE)
      .setOrigin(0.5)
      .setWordWrapWidth(HINT_WRAP_WIDTH);
    this.container.add(hint);
  }

  private buildRow(def: PathTierDef, index: number): PathRow {
    const y = ROW_START_Y + index * ROW_SPACING;

    const icon = this.scene.add
      .image(ICON_OFFSET_X, y, ATLAS_KEY, def.frame)
      .setOrigin(0.5)
      .setScale(ICON_SCALE);
    const nameText = this.scene.add
      .text(NAME_OFFSET_X, y + NAME_OFFSET_Y, def.name, NAME_STYLE)
      .setOrigin(0, 0.5);

    const rowObjects: Phaser.GameObjects.GameObject[] = [icon, nameText];
    if (def.costCoins > 0) {
      rowObjects.push(
        this.scene.add
          .image(PRICE_ICON_OFFSET_X, y + PRICE_ICON_OFFSET_Y, ATLAS_KEY, 'coin')
          .setScale(PRICE_ICON_SCALE),
        this.scene.add
          .text(PRICE_TEXT_OFFSET_X, y + PRICE_TEXT_OFFSET_Y, `${def.costCoins} each`, PRICE_STYLE)
          .setOrigin(0, 0.5),
      );
    } else {
      rowObjects.push(
        this.scene.add
          .text(FREE_TEXT_OFFSET_X, y + PRICE_TEXT_OFFSET_Y, 'Free', PRICE_STYLE)
          .setOrigin(0, 0.5),
      );
    }

    const paintButton = this.scene.add.nineslice(
      ACTION_OFFSET_X,
      y,
      ATLAS_KEY,
      'panel',
      PAINT_BUTTON_WIDTH,
      PAINT_BUTTON_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const paintText = this.scene.add.text(ACTION_OFFSET_X, y, 'Paint', PAINT_STYLE).setOrigin(0.5);

    paintButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      // Selecting a tier is not a purchase: close and hand the scene the
      // persistent paint mode. Coins are charged per tile, by the store.
      this.hide();
      this.onSelectTier(def.id);
    });

    this.container.add([...rowObjects, paintButton, paintText]);
    return { def, paintButton, paintText };
  }

  /**
   * Re-derive each row's affordability dimming from state. A dimmed row is
   * still selectable - see the class comment.
   */
  refresh(state: GameStateData): void {
    for (const row of this.rows) {
      const affordable = state.coins >= row.def.costCoins;
      const alpha = affordable ? BUTTON_ENABLED_ALPHA : BUTTON_DISABLED_ALPHA;
      row.paintButton.setAlpha(alpha);
      row.paintText.setAlpha(alpha);
      row.paintButton.setInteractive({ useHandCursor: true });
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(state: GameStateData): void {
    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('paths-panel', true);
    this.refresh(state);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('paths-panel', false);
  }
}
