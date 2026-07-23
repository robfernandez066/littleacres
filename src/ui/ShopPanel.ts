import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import type { BuildingId } from '../data/buildings';
import { type CatalogItem, catalogItemsInCategory } from '../data/catalog';
import {
  decorOwnedCount,
  fenceOwnedCount,
  FENCE_FRAME,
  MAX_DECOR_ITEMS,
  MAX_FENCES,
} from '../data/decor';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * The unified Shop (U2b): ONE tabbed panel that replaces the old Building Shop
 * and Decor Shop. The HUD Shop button opens it on the Buildings tab; the
 * edit-mode / farmhouse entries open it on the Decor tab (via `Hud`).
 *
 * CATALOG-DRIVEN: each tab renders `catalogItemsInCategory` filtered to
 * `purchasable` items through the SAME card component - so a new building or
 * decoration in its own registry appears here with no edit to this file. The
 * store stays the sole purchase authority: a building card calls
 * `gameState.buyBuilding` and a decor card `gameState.buyToShed`, each of which
 * re-checks every gate; the per-card render is presentation only.
 *
 * Two interactions, one card:
 *   - BUILDINGS: single tap-to-buy on the whole card. On success the building
 *     lands at its default anchor (FarmScene's tick renders it) and the shop
 *     CLOSES. A unique building already owned is an inert "Owned" card; a locked
 *     one (level < unlockLevel) dims and reads "Level N", its tap only wiggling.
 *   - DECOR: a quantity stepper (1-99) plus an "Add to shed" button. Add charges
 *     `qty * price` once via `buyToShed`, the count lands in the shed, the shop
 *     STAYS OPEN, the card's icon flies into the header's Shed chip, the chip
 *     bounces and its count ticks up. The button renders disabled (dimmed, never
 *     red) when the balance cannot cover the buy or it would breach a split
 *     budget cap - the same cap `buyToShed` itself enforces.
 *
 * The first successful Add ever shows a one-time tooltip, backed by the
 * `shedTipSeen` save flag (schema v31). Mirrors `DecorShop`'s elevated-depth
 * support (`setElevated`) so the edit-mode entry can open it above the arrange
 * control row.
 */

/** The two tabs the unified Shop ships this task (Paths joins in U4). */
type ShopTab = 'building' | 'decor';

const PANEL_WIDTH = 940;
const PANEL_HEIGHT = 1780;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 950;
/** Above the seed bar (2000), below flying coins (2200) - the panel tier. */
const PANEL_DEPTH = 2100;
/**
 * Elevated depth for the arrange-mode entry (mirrors the old DecorShop's
 * ELEVATED_* tier, T3.16): opened from arrange mode the panel must sit above
 * the arrange control row (FarmScene ARRANGE_UI_DEPTH 2200), so a tap outside
 * its body closes it rather than reaching a control underneath.
 */
const ELEVATED_PANEL_DEPTH = 2260;
const ELEVATED_BACKDROP_DEPTH = 2250;

const HALF_H = PANEL_HEIGHT / 2;

const TITLE_Y = -HALF_H + 54;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -HALF_H + 54;

/** Header balances + Shed chip row. */
const HEADER_Y = -HALF_H + 116;
const COIN_ICON_X = -330;
const COIN_TEXT_X = -304;
const MOONDUST_ICON_X = -120;
const MOONDUST_TEXT_X = -94;
const BALANCE_ICON_NATIVE = 96;
const BALANCE_ICON_DISPLAY = 36;
const BALANCE_ICON_SCALE = BALANCE_ICON_DISPLAY / BALANCE_ICON_NATIVE;
/**
 * The Shed chip is a DRAWN pill reading "Shed N" (U2b-r1) - the treasure-chest
 * sprite it replaced collided with the premium-order chest concept. Its centre
 * is the fly-to-chip target and the bounce pivot.
 */
const SHED_PILL_X = 250;
const SHED_PILL_HALF_H = 24;

/** Tab row. */
const TAB_Y = -HALF_H + 190;
const TAB_WIDTH = 300;
const TAB_HEIGHT = 84;
const TAB_BUILDING_X = -160;
const TAB_DECOR_X = 160;
const TAB_ACTIVE_ALPHA = 1;
const TAB_INACTIVE_ALPHA = 0.45;

/** One-time Shed tooltip band, just below the tabs. */
const TOOLTIP_Y = -HALF_H + 268;
const TOOLTIP_WRAP = 640;
const TOOLTIP_HOLD_MS = 3200;
const TOOLTIP_FADE_MS = 500;
const TOOLTIP_TEXT = 'Your items live in the Shed - open it in Edit mode to place them.';

/**
 * Card vertical layout (U2b-r2). A card is a fixed stack of rows, each owning a
 * HEIGHT; CARD_HEIGHT is their sum plus top/bottom padding, and every element
 * sits at the CENTER of its row. This block is the SINGLE source of truth for
 * card geometry - the row heights are the only vertical numbers authored; every
 * element's y, plus CARD_HEIGHT, the grid spacing, and the panel fit, derive
 * from them. Change a row height and the rest follows.
 *
 * Rows, top to bottom: art (hero icon), name, price/status pill, stepper
 * (- qty +), Add-to-shed button. A building card populates only the first three
 * rows; a decor card adds the stepper and Add rows. Ten decorations = five rows
 * that must ALL stay visible above the Paths footer with no scroll, which caps
 * the card height and so keeps the hero icon compact.
 */
const CARD_WIDTH = 430;
const CARD_PAD_Y = 6;
const ROW_ART_H = 80;
const ROW_NAME_H = 42;
const ROW_PRICE_H = 42;
const ROW_STEPPER_H = 46;
const ROW_ADD_H = 46;
const CARD_HEIGHT =
  CARD_PAD_Y * 2 + ROW_ART_H + ROW_NAME_H + ROW_PRICE_H + ROW_STEPPER_H + ROW_ADD_H;
const CARD_HALF_H = CARD_HEIGHT / 2;

// Row tops and centers, derived top-down from the card's top edge. These row
// centers are the ONLY vertical coordinates any card element uses.
const ROW_ART_TOP = -CARD_HALF_H + CARD_PAD_Y;
const CARD_ICON_Y = ROW_ART_TOP + ROW_ART_H / 2;
const ROW_NAME_TOP = ROW_ART_TOP + ROW_ART_H;
const CARD_NAME_Y = ROW_NAME_TOP + ROW_NAME_H / 2;
const ROW_PRICE_TOP = ROW_NAME_TOP + ROW_NAME_H;
const CARD_PRICE_Y = ROW_PRICE_TOP + ROW_PRICE_H / 2;
const CARD_STATUS_Y = CARD_PRICE_Y;
const ROW_STEPPER_TOP = ROW_PRICE_TOP + ROW_PRICE_H;
const STEPPER_Y = ROW_STEPPER_TOP + ROW_STEPPER_H / 2;
const ROW_ADD_TOP = ROW_STEPPER_TOP + ROW_STEPPER_H;
const ADD_Y = ROW_ADD_TOP + ROW_ADD_H / 2;

/** Hero icon: sized to sit inside the art row with a little breathing room. */
const BUILDING_ICON_NATIVE = 256;
const DECOR_ICON_NATIVE = 128;
const CARD_ICON_DISPLAY = 74;

/** Price group: coin/moondust icon + amount, centred as one group in the price row. */
const CARD_PRICE_ICON_NATIVE = 96;
const CARD_PRICE_ICON_DISPLAY = 34;
const CARD_PRICE_ICON_SCALE = CARD_PRICE_ICON_DISPLAY / CARD_PRICE_ICON_NATIVE;
const CARD_PRICE_GAP = 6;

/** Owned "xN" badge overlays the card's top-right corner - the one intended overlap. */
const CARD_OWNED_BADGE_X = CARD_WIDTH / 2 - 36;
const CARD_OWNED_BADGE_Y = -CARD_HALF_H + 26;

/** Decor stepper geometry: horizontal placement only; row heights come from above. */
const STEPPER_MINUS_X = -104;
const STEPPER_QTY_X = 0;
const STEPPER_PLUS_X = 104;
const STEPPER_BTN_WIDTH = 68;
const STEPPER_BTN_HEIGHT = 42;
const ADD_WIDTH = 300;
const ADD_HEIGHT = 40;
const QTY_MIN = 1;
const QTY_MAX = 99;

/**
 * Card grid: 2 columns. ROW_SPACING derives from the card height (plus a fixed
 * gap) and GRID_TOP is placed so all five decor rows clear the tab row above
 * and the Paths footer below - the panel shows every row with no scroll.
 */
const COLUMN_X = [-232, 232] as const;
const CARD_ROW_GAP = 12;
const ROW_SPACING = CARD_HEIGHT + CARD_ROW_GAP;
const GRID_TOP = -HALF_H + 392;

const ENABLED_ALPHA = 1;
const DISABLED_ALPHA = 0.4;
/** Locked/inert cards read as unavailable at a glance - the locked-crop convention. */
const LOCKED_ALPHA = 0.45;

/** Fly-to-chip animation (~400ms simple tween of a one-off image). */
const FLY_MS = 400;
const FLY_END_SCALE = 0.16;
const CHIP_BOUNCE_MS = 140;
const CHIP_BOUNCE_SCALE = 1.35;

/**
 * Vector chrome (U2b-r1): all card/stepper/button/chip chrome is drawn with
 * Phaser Graphics rounded rects instead of atlas sprites, matching the panel
 * language (parchment fill, thin dark-brown rounded stroke). Item art and the
 * coin/moondust icons stay sprites. Colours are subtle - the coin pill leans
 * warm and the moondust pill cool, nothing saturated.
 */
const STROKE_BROWN = 0x4a3218;
const CARD_FILL = 0xf7edd6;
const CARD_RADIUS = 20;
const CARD_STROKE_W = 2;
const PILL_STROKE_W = 2;
const BTN_STROKE_W = 2;
const BTN_RADIUS = 14;
/** Neutral pill fill (status, owned, shed) and warm/cool price-pill tints. */
const PILL_FILL = 0xeaddbe;
const COIN_PILL_FILL = 0xf4dca6;
const MOONDUST_PILL_FILL = 0xd8def0;
const BTN_FILL = 0xf1e2c0;
/** Horizontal padding from a pill's content to its rounded edge. */
const PILL_PAD_X = 16;
/** Price/status pill half-height - sized to sit inside the card's price row. */
const PILL_HALF_H = 18;
const OWNED_PILL_HALF_H = 18;
const OWNED_PILL_PAD_X = 12;

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

const BALANCE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const SHED_CHIP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const TAB_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const TOOLTIP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  fontStyle: 'bold',
  color: '#fff8e1',
  backgroundColor: '#4a3218',
  padding: { left: 16, right: 16, top: 10, bottom: 10 },
  align: 'center',
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

const STATUS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  fontStyle: 'bold',
  color: '#7a5518',
  align: 'center',
};

const OWNED_BADGE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '24px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const STEPPER_SYMBOL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const QTY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const ADD_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const PATHS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const PATHS_BUTTON_Y = HALF_H - 66;
const PATHS_BUTTON_WIDTH = 260;
const PATHS_BUTTON_HEIGHT = 84;

/**
 * Decor-card stepper controls; absent on a building card. The `-`/`+`/Add
 * visuals are drawn Graphics (U2b-r1); a paired invisible Zone carries the
 * hit test so the rounded art needs no frame-relative hitArea maths.
 */
interface CardStepper {
  minusG: Phaser.GameObjects.Graphics;
  minusZone: Phaser.GameObjects.Zone;
  minusLabel: Phaser.GameObjects.Text;
  plusG: Phaser.GameObjects.Graphics;
  plusZone: Phaser.GameObjects.Zone;
  plusLabel: Phaser.GameObjects.Text;
  qtyText: Phaser.GameObjects.Text;
  addG: Phaser.GameObjects.Graphics;
  addZone: Phaser.GameObjects.Zone;
  addText: Phaser.GameObjects.Text;
  qty: number;
}

interface Card {
  item: CatalogItem;
  container: Phaser.GameObjects.Container;
  /** Drawn card fill+border. */
  cardBg: Phaser.GameObjects.Graphics;
  /** Whole-card tap target for a building card (undefined on a decor card). */
  hitZone?: Phaser.GameObjects.Zone;
  icon: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  pricePill: Phaser.GameObjects.Graphics;
  priceIcon: Phaser.GameObjects.Image;
  priceText: Phaser.GameObjects.Text;
  statusPill: Phaser.GameObjects.Graphics;
  /** "Owned" / "Level N" - shown instead of the price on a building card. */
  statusText: Phaser.GameObjects.Text;
  ownedPill: Phaser.GameObjects.Graphics;
  ownedBadge: Phaser.GameObjects.Text;
  /** Card-center in main-container space, for the fly-to-chip start point. */
  centerX: number;
  centerY: number;
  stepper?: CardStepper;
  wiggle: Phaser.Tweens.Tween | null;
}

export class ShopPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private visible = false;
  private activeTab: ShopTab = 'building';

  private readonly coinText: Phaser.GameObjects.Text;
  private readonly moondustText: Phaser.GameObjects.Text;
  private readonly shedPill: Phaser.GameObjects.Graphics;
  private readonly shedChipText: Phaser.GameObjects.Text;

  private readonly buildingTabBg: Phaser.GameObjects.NineSlice;
  private readonly buildingTabText: Phaser.GameObjects.Text;
  private readonly decorTabBg: Phaser.GameObjects.NineSlice;
  private readonly decorTabText: Phaser.GameObjects.Text;

  private readonly tooltipText: Phaser.GameObjects.Text;
  private tooltipTween: Phaser.Tweens.Tween | null = null;

  private readonly cards: Card[] = [];

  /**
   * Every persistent hit target the panel owns - the body-tap blocker, the X,
   * both tabs, the Paths button, and each card's zones - toggled with the
   * panel's open/closed state (`setInteractivesEnabled`). A CLOSED shop holds
   * NO live hitboxes: without this, arrange mode's "disable every other
   * interactive object" sweep (FarmScene.setOtherHitboxesEnabled) captures the
   * still-interactive-but-hidden body blocker and leaves it dead when the shop
   * is later opened ELEVATED from arrange mode - so body taps fell through to
   * the backdrop and closed the panel (U2b-r3).
   */
  private readonly interactives: Phaser.GameObjects.GameObject[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
    /** Close this panel and open the Paths panel (stopgap until U4). */
    private readonly onOpenPaths: () => void,
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
    const title = scene.add.text(0, TITLE_Y, 'Shop', TITLE_STYLE).setOrigin(0.5);
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
    this.interactives.push(bg, closeButton);

    // Header balances + Shed chip.
    const coinIcon = scene.add
      .image(COIN_ICON_X, HEADER_Y, ATLAS_KEY, 'coin')
      .setScale(BALANCE_ICON_SCALE);
    this.coinText = scene.add.text(COIN_TEXT_X, HEADER_Y, '0', BALANCE_STYLE).setOrigin(0, 0.5);
    const moondustIcon = scene.add
      .image(MOONDUST_ICON_X, HEADER_Y, ATLAS_KEY, 'moondust')
      .setScale(BALANCE_ICON_SCALE);
    this.moondustText = scene.add
      .text(MOONDUST_TEXT_X, HEADER_Y, '0', BALANCE_STYLE)
      .setOrigin(0, 0.5);
    // The Shed chip: a drawn "Shed N" pill (redrawn to fit its count in
    // `refresh`), its centre the fly-to-chip target and bounce pivot.
    this.shedPill = scene.add.graphics().setPosition(SHED_PILL_X, HEADER_Y);
    this.shedChipText = scene.add
      .text(SHED_PILL_X, HEADER_Y, 'Shed 0', SHED_CHIP_STYLE)
      .setOrigin(0.5);
    this.container.add([
      coinIcon,
      this.coinText,
      moondustIcon,
      this.moondustText,
      this.shedPill,
      this.shedChipText,
    ]);

    // Tab row.
    this.buildingTabBg = this.buildButton(TAB_BUILDING_X, TAB_Y, TAB_WIDTH, TAB_HEIGHT);
    this.buildingTabText = scene.add
      .text(TAB_BUILDING_X, TAB_Y, 'Buildings', TAB_STYLE)
      .setOrigin(0.5);
    this.buildingTabBg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.selectTab('building');
    });
    this.decorTabBg = this.buildButton(TAB_DECOR_X, TAB_Y, TAB_WIDTH, TAB_HEIGHT);
    this.decorTabText = scene.add.text(TAB_DECOR_X, TAB_Y, 'Decor', TAB_STYLE).setOrigin(0.5);
    this.decorTabBg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.selectTab('decor');
    });
    this.container.add([
      this.buildingTabBg,
      this.buildingTabText,
      this.decorTabBg,
      this.decorTabText,
    ]);
    this.interactives.push(this.buildingTabBg, this.decorTabBg);

    // One-time Shed tooltip (hidden until the first Add succeeds).
    this.tooltipText = scene.add
      .text(0, TOOLTIP_Y, TOOLTIP_TEXT, TOOLTIP_STYLE)
      .setOrigin(0.5)
      .setWordWrapWidth(TOOLTIP_WRAP)
      .setVisible(false);
    this.container.add(this.tooltipText);

    // Cards for both tabs, filtered to purchasable items (trophies are never
    // sold). Same grid coordinates per tab; only the active tab's cards show.
    for (const item of catalogItemsInCategory('building').filter((i) => i.purchasable)) {
      this.cards.push(this.buildCard(item));
    }
    for (const item of catalogItemsInCategory('decor').filter((i) => i.purchasable)) {
      this.cards.push(this.buildCard(item));
    }

    // Paths stopgap (U4): a plain button opening the existing PathsPanel
    // unchanged, until U4 ships the Paths tab and retires this.
    const pathsButton = this.buildButton(
      0,
      PATHS_BUTTON_Y,
      PATHS_BUTTON_WIDTH,
      PATHS_BUTTON_HEIGHT,
    );
    const pathsText = scene.add.text(0, PATHS_BUTTON_Y, 'Paths', PATHS_STYLE).setOrigin(0.5);
    pathsButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
      this.onOpenPaths();
    });
    this.container.add([pathsButton, pathsText]);
    this.interactives.push(pathsButton);

    // The panel starts closed, so it must start with no live hitboxes (see
    // `interactives`); `openTo` re-enables them. `refresh` still owns each Add
    // button's enabled/disabled state on top of this.
    this.setInteractivesEnabled(false);

    // DEV-only capture seam (U2b-r2): expose the single panel so a headless
    // Playwright capture (tools/shop-capture.mjs) can open it to a given tab and
    // screenshot the real render without first completing onboarding. Mirrors
    // main.ts's `window.__shadowLab` route; `import.meta.env.DEV` folds this out
    // of production builds entirely.
    if (import.meta.env.DEV) {
      (window as unknown as { __shop?: ShopPanel }).__shop = this;
    }
  }

  /** A plain `panel`-nineslice button, interactive with the hand cursor. */
  private buildButton(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Phaser.GameObjects.NineSlice {
    return this.scene.add
      .nineslice(
        x,
        y,
        ATLAS_KEY,
        'panel',
        width,
        height,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setInteractive({ useHandCursor: true });
  }

  /**
   * Draw a filled + stroked rounded rect CENTRED on the graphics' own origin,
   * clearing whatever it held - so scaling the graphics pivots on the shape's
   * centre and a redraw is a straight replace. The one drawing primitive all the
   * vector chrome shares (U2b-r1).
   */
  private drawRoundRect(
    g: Phaser.GameObjects.Graphics,
    halfW: number,
    halfH: number,
    radius: number,
    fill: number,
    strokeW: number,
  ): void {
    g.clear();
    g.fillStyle(fill, 1);
    g.fillRoundedRect(-halfW, -halfH, halfW * 2, halfH * 2, radius);
    g.lineStyle(strokeW, STROKE_BROWN, 1);
    g.strokeRoundedRect(-halfW, -halfH, halfW * 2, halfH * 2, radius);
  }

  /** Redraw a fully-rounded pill sized to enclose `contentWidth` with padding. */
  private drawPill(
    g: Phaser.GameObjects.Graphics,
    contentWidth: number,
    halfH: number,
    padX: number,
    fill: number,
  ): void {
    this.drawRoundRect(g, contentWidth / 2 + padX, halfH, halfH, fill, PILL_STROKE_W);
  }

  /**
   * An invisible interactive Zone at (x, y) sized (w, h) - the hit target paired
   * with a drawn button, so the rounded art never needs a frame-relative
   * hitArea. Zones default to a centred origin, so (x, y) is the centre.
   */
  private makeHitZone(
    parent: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    h: number,
    onDown: () => void,
  ): Phaser.GameObjects.Zone {
    const zone = this.scene.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onDown);
    parent.add(zone);
    // Every card zone (building tap target, decor -/+/Add) is a persistent hit
    // target toggled with the panel's open state - see `interactives`.
    this.interactives.push(zone);
    return zone;
  }

  /** Build one card (building or decor); its grid slot is its index within its tab. */
  private buildCard(item: CatalogItem): Card {
    const tabItems =
      item.category === 'building'
        ? catalogItemsInCategory('building').filter((i) => i.purchasable)
        : catalogItemsInCategory('decor').filter((i) => i.purchasable);
    const slot = tabItems.findIndex((i) => i.id === item.id);
    const col = slot % 2;
    const rowIndex = Math.floor(slot / 2);
    const centerX = COLUMN_X[col]!;
    const centerY = GRID_TOP + rowIndex * ROW_SPACING;

    const cardContainer = this.scene.add.container(centerX, centerY).setVisible(false);

    // Drawn card fill + border (no sprite chrome).
    const cardBg = this.scene.add.graphics();
    this.drawRoundRect(cardBg, CARD_WIDTH / 2, CARD_HALF_H, CARD_RADIUS, CARD_FILL, CARD_STROKE_W);

    const iconNative = item.category === 'building' ? BUILDING_ICON_NATIVE : DECOR_ICON_NATIVE;
    const icon = this.scene.add
      .image(0, CARD_ICON_Y, ATLAS_KEY, item.frame)
      .setScale(CARD_ICON_DISPLAY / iconNative);
    const nameText = this.scene.add.text(0, CARD_NAME_Y, item.name, NAME_STYLE).setOrigin(0.5);

    // Price pill: a drawn pill behind a coin/moondust icon + amount, laid out as
    // a centred group. Static per card, so drawn once here.
    const pricePill = this.scene.add.graphics().setPosition(0, CARD_PRICE_Y);
    const priceIconFrame = item.currency === 'coins' ? 'coin' : 'moondust';
    const priceIcon = this.scene.add
      .image(0, CARD_PRICE_Y, ATLAS_KEY, priceIconFrame)
      .setScale(CARD_PRICE_ICON_SCALE);
    const priceText = this.scene.add
      .text(0, CARD_PRICE_Y, String(item.price), PRICE_STYLE)
      .setOrigin(0, 0.5);
    this.layoutPricePill(pricePill, priceIcon, priceText, item.currency);

    const statusPill = this.scene.add.graphics().setPosition(0, CARD_STATUS_Y).setVisible(false);
    const statusText = this.scene.add
      .text(0, CARD_STATUS_Y, '', STATUS_STYLE)
      .setOrigin(0.5)
      .setVisible(false);

    const ownedPill = this.scene.add
      .graphics()
      .setPosition(CARD_OWNED_BADGE_X, CARD_OWNED_BADGE_Y)
      .setVisible(false);
    const ownedBadge = this.scene.add
      .text(CARD_OWNED_BADGE_X, CARD_OWNED_BADGE_Y, '', OWNED_BADGE_STYLE)
      .setOrigin(0.5)
      .setVisible(false);

    cardContainer.add([
      cardBg,
      pricePill,
      priceIcon,
      priceText,
      statusPill,
      statusText,
      icon,
      nameText,
      ownedPill,
      ownedBadge,
    ]);

    const card: Card = {
      item,
      container: cardContainer,
      cardBg,
      icon,
      nameText,
      pricePill,
      priceIcon,
      priceText,
      statusPill,
      statusText,
      ownedPill,
      ownedBadge,
      centerX,
      centerY,
      wiggle: null,
    };

    if (item.category === 'building') {
      // The whole card is the tap-to-buy / wiggle target - an invisible Zone
      // over the drawn card.
      card.hitZone = this.makeHitZone(cardContainer, 0, 0, CARD_WIDTH, CARD_HEIGHT, () =>
        this.onBuildingTap(card),
      );
    } else {
      card.stepper = this.buildStepper(cardContainer, card);
    }

    this.container.add(cardContainer);
    return card;
  }

  /** Centre the coin/moondust icon + amount as one group and draw the price pill. */
  private layoutPricePill(
    g: Phaser.GameObjects.Graphics,
    icon: Phaser.GameObjects.Image,
    text: Phaser.GameObjects.Text,
    currency: CatalogItem['currency'],
  ): void {
    const groupW = CARD_PRICE_ICON_DISPLAY + CARD_PRICE_GAP + text.width;
    icon.setX(-groupW / 2 + CARD_PRICE_ICON_DISPLAY / 2);
    text.setX(-groupW / 2 + CARD_PRICE_ICON_DISPLAY + CARD_PRICE_GAP);
    const fill = currency === 'coins' ? COIN_PILL_FILL : MOONDUST_PILL_FILL;
    this.drawPill(g, groupW, PILL_HALF_H, PILL_PAD_X, fill);
  }

  /** The decor card's quantity stepper + Add button, all drawn chrome. */
  private buildStepper(parent: Phaser.GameObjects.Container, card: Card): CardStepper {
    const minusG = this.scene.add.graphics().setPosition(STEPPER_MINUS_X, STEPPER_Y);
    this.drawRoundRect(
      minusG,
      STEPPER_BTN_WIDTH / 2,
      STEPPER_BTN_HEIGHT / 2,
      BTN_RADIUS,
      BTN_FILL,
      BTN_STROKE_W,
    );
    const minusLabel = this.scene.add
      .text(STEPPER_MINUS_X, STEPPER_Y - 2, '-', STEPPER_SYMBOL_STYLE)
      .setOrigin(0.5);
    const qtyText = this.scene.add.text(STEPPER_QTY_X, STEPPER_Y, '1', QTY_STYLE).setOrigin(0.5);
    const plusG = this.scene.add.graphics().setPosition(STEPPER_PLUS_X, STEPPER_Y);
    this.drawRoundRect(
      plusG,
      STEPPER_BTN_WIDTH / 2,
      STEPPER_BTN_HEIGHT / 2,
      BTN_RADIUS,
      BTN_FILL,
      BTN_STROKE_W,
    );
    const plusLabel = this.scene.add
      .text(STEPPER_PLUS_X, STEPPER_Y - 2, '+', STEPPER_SYMBOL_STYLE)
      .setOrigin(0.5);
    const addG = this.scene.add.graphics().setPosition(0, ADD_Y);
    this.drawRoundRect(addG, ADD_WIDTH / 2, ADD_HEIGHT / 2, BTN_RADIUS, BTN_FILL, BTN_STROKE_W);
    const addText = this.scene.add.text(0, ADD_Y, 'Add to shed', ADD_STYLE).setOrigin(0.5);

    parent.add([minusG, minusLabel, qtyText, plusG, plusLabel, addG, addText]);

    // Hit zones over each drawn button (added last, so they sit on top).
    const minusZone = this.makeHitZone(
      parent,
      STEPPER_MINUS_X,
      STEPPER_Y,
      STEPPER_BTN_WIDTH,
      STEPPER_BTN_HEIGHT,
      () => this.stepQty(card, -1),
    );
    const plusZone = this.makeHitZone(
      parent,
      STEPPER_PLUS_X,
      STEPPER_Y,
      STEPPER_BTN_WIDTH,
      STEPPER_BTN_HEIGHT,
      () => this.stepQty(card, +1),
    );
    const addZone = this.makeHitZone(parent, 0, ADD_Y, ADD_WIDTH, ADD_HEIGHT, () =>
      this.onDecorAdd(card),
    );

    return {
      minusG,
      minusZone,
      minusLabel,
      plusG,
      plusZone,
      plusLabel,
      qtyText,
      addG,
      addZone,
      addText,
      qty: QTY_MIN,
    };
  }

  /** Nudge a decor card's quantity within [QTY_MIN, QTY_MAX] and re-derive it. */
  private stepQty(card: Card, delta: number): void {
    const stepper = card.stepper;
    if (stepper === undefined) return;
    const next = Math.min(QTY_MAX, Math.max(QTY_MIN, stepper.qty + delta));
    if (next === stepper.qty) return;
    this.audio.sfx('tap');
    stepper.qty = next;
    this.refresh(gameState.getState());
  }

  /** Building tap: buy through the store (which decides), then close on success. */
  private onBuildingTap(card: Card): void {
    const state = gameState.getState();
    const owned = state.buildings.some((placed) => placed.type === card.item.id);
    const unlocked = state.level >= card.item.unlockLevel;
    if (owned || !unlocked) {
      // Inert card - a locked one wiggles, an owned one does nothing.
      if (!unlocked) this.wiggleCard(card);
      return;
    }
    // A building-category catalog id IS a BuildingId (see catalog.ts); the
    // store re-validates it against BUILDINGS regardless.
    if (!gameState.buyBuilding(card.item.id as BuildingId)) return;
    this.audio.coin();
    // The building lands at its default anchor; FarmScene's tick renders it.
    this.hide();
  }

  /** Decor Add: charge qty * price into the shed, animate, keep the shop open. */
  private onDecorAdd(card: Card): void {
    const stepper = card.stepper;
    if (stepper === undefined) return;
    const firstEver = !gameState.getState().shedTipSeen;
    if (!gameState.buyToShed(card.item.id, stepper.qty)) return;
    this.audio.coin();
    this.flyToChip(card);
    if (firstEver) {
      gameState.markShedTipSeen();
      this.showTooltip();
    }
    this.refresh(gameState.getState());
  }

  /** Switch tabs, re-render the grid, and re-derive from state. */
  private selectTab(tab: ShopTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.refresh(gameState.getState());
  }

  /** Fly a one-off copy of the card icon into the Shed chip, then bounce it. */
  private flyToChip(card: Card): void {
    const startX = card.centerX + card.icon.x;
    const startY = card.centerY + card.icon.y;
    const fly = this.scene.add
      .image(startX, startY, ATLAS_KEY, card.item.frame)
      .setScale(card.icon.scaleX);
    this.container.add(fly);
    this.scene.tweens.add({
      targets: fly,
      x: SHED_PILL_X,
      y: HEADER_Y,
      scale: FLY_END_SCALE,
      alpha: 0.2,
      duration: FLY_MS,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        fly.destroy();
        this.bounceChip();
      },
    });
  }

  /** A small scale pop on the Shed pill as its count ticks up. */
  private bounceChip(): void {
    this.scene.tweens.add({
      targets: [this.shedPill, this.shedChipText],
      scale: CHIP_BOUNCE_SCALE,
      duration: CHIP_BOUNCE_MS,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.shedPill.setScale(1);
        this.shedChipText.setScale(1);
      },
    });
  }

  /** Brief locked-card wiggle - the "tap does nothing" feedback. */
  private wiggleCard(card: Card): void {
    card.wiggle?.stop();
    card.container.setAngle(0);
    card.wiggle = this.scene.tweens.add({
      targets: card.container,
      angle: { from: -3, to: 3 },
      duration: 60,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        card.container.setAngle(0);
        card.wiggle = null;
      },
    });
  }

  /** Show the one-time Shed tooltip, then fade it out. */
  private showTooltip(): void {
    this.tooltipTween?.stop();
    this.tooltipText.setAlpha(1).setVisible(true);
    this.tooltipTween = this.scene.tweens.add({
      targets: this.tooltipText,
      alpha: 0,
      delay: TOOLTIP_HOLD_MS,
      duration: TOOLTIP_FADE_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.tooltipText.setVisible(false);
        this.tooltipTween = null;
      },
    });
  }

  /** Re-derive the header, tabs, and every visible card from state. */
  refresh(state: GameStateData): void {
    this.coinText.setText(String(state.coins));
    this.moondustText.setText(String(state.moondust));
    const shedTotal = Object.values(state.shedInventory).reduce((sum, n) => sum + n, 0);
    this.shedChipText.setText(`Shed ${shedTotal}`);
    this.drawPill(this.shedPill, this.shedChipText.width, SHED_PILL_HALF_H, PILL_PAD_X, PILL_FILL);

    const buildingActive = this.activeTab === 'building';
    this.buildingTabBg.setAlpha(buildingActive ? TAB_ACTIVE_ALPHA : TAB_INACTIVE_ALPHA);
    this.buildingTabText.setAlpha(buildingActive ? TAB_ACTIVE_ALPHA : TAB_INACTIVE_ALPHA);
    this.decorTabBg.setAlpha(buildingActive ? TAB_INACTIVE_ALPHA : TAB_ACTIVE_ALPHA);
    this.decorTabText.setAlpha(buildingActive ? TAB_INACTIVE_ALPHA : TAB_ACTIVE_ALPHA);

    const decorOwned = decorOwnedCount(state.decorations, state.shedInventory);
    const fenceOwned = fenceOwnedCount(state.decorations, state.shedInventory);

    for (const card of this.cards) {
      const onTab = card.item.category === this.activeTab;
      card.container.setVisible(onTab);
      if (!onTab) continue;
      if (card.item.category === 'building') {
        this.refreshBuildingCard(card, state);
      } else {
        this.refreshDecorCard(card, state, decorOwned, fenceOwned);
      }
    }
  }

  /** Set the "xN" owned badge + its pill, sized to the count, or hide both. */
  private setOwnedBadge(card: Card, count: number): void {
    const show = count > 0;
    card.ownedBadge.setText(`x${count}`).setVisible(show);
    card.ownedPill.setVisible(show);
    if (show) {
      this.drawPill(
        card.ownedPill,
        card.ownedBadge.width,
        OWNED_PILL_HALF_H,
        OWNED_PILL_PAD_X,
        PILL_FILL,
      );
    }
  }

  private refreshBuildingCard(card: Card, state: GameStateData): void {
    const owned = state.buildings.some((placed) => placed.type === card.item.id);
    const unlocked = state.level >= card.item.unlockLevel;
    const affordable = state.coins >= card.item.price;
    const buyable = unlocked && !owned;

    // The card dims while locked, the same read a locked crop gets.
    card.container.setAlpha(unlocked ? 1 : LOCKED_ALPHA);

    // Owned count badge: shed + placed (a building's placement is its own count).
    const placed = state.buildings.filter((b) => b.type === card.item.id).length;
    const shed = state.shedInventory[card.item.id] ?? 0;
    this.setOwnedBadge(card, placed + shed);

    card.pricePill.setVisible(buyable);
    card.priceIcon.setVisible(buyable);
    card.priceText.setVisible(buyable);
    card.statusPill.setVisible(!buyable);
    card.statusText.setVisible(!buyable);
    if (buyable) {
      // Dim the price when unaffordable; the store refuses either way, but the
      // dim communicates it. The card stays interactive so a locked-vs-poor tap
      // still feels alive (no wiggle here - it is unlocked, just short of coins).
      const alpha = affordable ? ENABLED_ALPHA : DISABLED_ALPHA;
      card.pricePill.setAlpha(alpha);
      card.priceIcon.setAlpha(alpha);
      card.priceText.setAlpha(alpha);
    } else {
      card.statusText.setText(owned ? 'Owned' : `Level ${card.item.unlockLevel}`);
      this.drawPill(card.statusPill, card.statusText.width, PILL_HALF_H, PILL_PAD_X, PILL_FILL);
    }
  }

  private refreshDecorCard(
    card: Card,
    state: GameStateData,
    decorOwned: number,
    fenceOwned: number,
  ): void {
    const stepper = card.stepper;
    if (stepper === undefined) return;
    card.container.setAlpha(1);
    stepper.qtyText.setText(String(stepper.qty));

    const placed = state.decorations.filter((d) => d.frame === card.item.frame).length;
    const shed = state.shedInventory[card.item.id] ?? 0;
    this.setOwnedBadge(card, placed + shed);

    const balance = card.item.currency === 'coins' ? state.coins : state.moondust;
    const affordable = balance >= card.item.price * stepper.qty;
    // Same split-budget cap `buyToShed` enforces - presentation only here.
    const underCap =
      card.item.frame === FENCE_FRAME
        ? fenceOwned + stepper.qty <= MAX_FENCES
        : decorOwned + stepper.qty <= MAX_DECOR_ITEMS;
    const enabled = affordable && underCap;

    const alpha = enabled ? ENABLED_ALPHA : DISABLED_ALPHA;
    stepper.addG.setAlpha(alpha);
    stepper.addText.setAlpha(alpha);
    if (enabled) {
      stepper.addZone.setInteractive({ useHandCursor: true });
    } else {
      stepper.addZone.disableInteractive();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Enable or disable every persistent hit target the panel owns (see
   * `interactives`). Called from `openTo`/`hide` so a closed shop carries no
   * live hitboxes. No-arg `setInteractive()` preserves each object's own hit
   * area (this project's hit-area convention), the same restore pattern
   * FarmScene's arrange sweep uses.
   */
  private setInteractivesEnabled(enabled: boolean): void {
    for (const obj of this.interactives) {
      if (enabled) obj.setInteractive();
      else obj.disableInteractive();
    }
  }

  /** See ELEVATED_PANEL_DEPTH/ELEVATED_BACKDROP_DEPTH. */
  setElevated(elevated: boolean): void {
    this.container.setDepth(elevated ? ELEVATED_PANEL_DEPTH : PANEL_DEPTH);
    this.backdrop.setDepth(elevated ? ELEVATED_BACKDROP_DEPTH : undefined);
  }

  /** Open the panel on `tab` (Buildings or Decor). */
  openTo(tab: ShopTab, state: GameStateData): void {
    this.activeTab = tab;
    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('shop', true);
    // Re-arm every hit target (the body blocker especially) BEFORE refresh, so
    // an open shop always blocks body taps even when it was opened elevated
    // from arrange mode, whose sweep had disabled them while it was closed.
    // refresh then re-derives each Add button's own enabled/disabled state.
    this.setInteractivesEnabled(true);
    this.refresh(state);
  }

  /** Open on `tab` if closed, close if already open (the farmhouse/edit toggle). */
  toggleTo(tab: ShopTab, state: GameStateData): void {
    if (this.visible) {
      this.hide();
    } else {
      this.openTo(tab, state);
    }
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('shop', false);
    // Drop every hit target so a closed shop holds no live hitboxes (see
    // `interactives`) - keeps arrange mode's sweep from grabbing them.
    this.setInteractivesEnabled(false);
    this.tooltipTween?.stop();
    this.tooltipTween = null;
    this.tooltipText.setVisible(false);
  }
}
