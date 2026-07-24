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
import { ownedBadgeLabel } from '../data/format';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';
import { decorCardTops } from './shopDecorLayout';

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
 *   - DECOR and PATHS (U4): a quantity stepper (1-99) plus an "Add to shed"
 *     button. Add charges `qty * price` once via `buyToShed`, the count lands in
 *     the shed, the shop STAYS OPEN, the card's icon flies into the header's
 *     Shed chip, the chip bounces and its count ticks up. The button renders
 *     disabled (dimmed, never red) when the balance cannot cover the buy or it
 *     would breach a split budget cap - the same cap `buyToShed` itself
 *     enforces (decor-only; paths are uncapped and dirt is free). A path card's
 *     price pill reads per tile ("15 ea"; dirt "Free") and its owned badge is
 *     the SHED count. The Paths tab also carries the "Paint" footer entry into
 *     the persistent paint mode, replacing the pre-U4 stopgap footer button.
 *
 * The first successful Add ever shows a one-time tooltip, backed by the
 * `shedTipSeen` save flag (schema v31). Mirrors `DecorShop`'s elevated-depth
 * support (`setElevated`) so the edit-mode entry can open it above the arrange
 * control row.
 */

/** The three tabs (U4): Buildings | Paths | Decor, in row order. */
type ShopTab = 'building' | 'path' | 'decor';

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
 * The Shed BUTTON (U5-r2): the header's real button that opens the Shed panel -
 * a `panel` nineslice labeled "Shed" with a gold corner count badge, mirroring
 * the arrange bar's Shed button (FarmScene's ARRANGE_SHED_* + badge) 1:1 in its
 * visual language. Its centre is the fly-to-chip target and the bounce pivot; a
 * paired invisible Zone carries the hit test (the ShopPanel pattern), toggled
 * with the panel's open state. Replaces the pre-U5-r2 drawn "Shed N" pill.
 */
const SHED_BTN_X = 250;
const SHED_BTN_WIDTH = 150;
const SHED_BTN_HEIGHT = 60;
/**
 * Count badge pinned to the button's top-right corner - the arrange bar's badge
 * treatment (gold, dark stroke), offset to this button's corner. An overhanging
 * text object, so a 3-digit count never clips.
 */
const SHED_BADGE_OFFSET_X = SHED_BTN_WIDTH / 2 - 8;
const SHED_BADGE_OFFSET_Y = -SHED_BTN_HEIGHT / 2 + 4;

/** Tab row: three tabs since U4 (Buildings | Paths | Decor), evenly spread. */
const TAB_Y = -HALF_H + 190;
const TAB_WIDTH = 280;
const TAB_HEIGHT = 84;
const TAB_BUILDING_X = -300;
const TAB_PATH_X = 0;
const TAB_DECOR_X = 300;
const TAB_ACTIVE_ALPHA = 1;
const TAB_INACTIVE_ALPHA = 0.45;

/** One-time Shed tooltip band, just below the tabs. */
const TOOLTIP_Y = -HALF_H + 268;
const TOOLTIP_WRAP = 640;
const TOOLTIP_HOLD_MS = 3200;
const TOOLTIP_FADE_MS = 500;
const TOOLTIP_TEXT = 'Your items live in the Shed - open it in Edit mode to place them.';

/**
 * Card vertical layout (U2b-r2; TOP-anchored since U3b-r2). A card is a stack of
 * rows, each owning a HEIGHT; the row heights are the only vertical numbers
 * authored and every element's y derives from them. Rows, top to bottom: art
 * (hero icon), name, price/status pill, stepper (- qty +), Add-to-shed button.
 *
 * Cards are TOP-anchored: the container sits at the card's TOP-center and every
 * row Y is measured DOWN from the top (y = 0 at the top edge). A decor card
 * shows only the top three rows COLLAPSED (U3b-r2) and grows the stepper + Add
 * rows below when tapped; a building card is always full height (its bottom two
 * rows sit empty, unchanged from U2b-r2). Because growth is purely downward, the
 * collapsed, expanded, and building faces share identical top rows.
 */
const CARD_WIDTH = 430;
const CARD_PAD_Y = 6;
const ROW_ART_H = 80;
const ROW_NAME_H = 42;
const ROW_PRICE_H = 42;
const ROW_STEPPER_H = 46;
const ROW_ADD_H = 46;
/**
 * COLLAPSED = art + name + price (a decor card's default face). EXPANDED adds
 * the stepper + Add rows. A building card is always full height (EXPANDED), so
 * its layout is unchanged from U2b-r2.
 */
const COLLAPSED_CARD_HEIGHT = CARD_PAD_Y * 2 + ROW_ART_H + ROW_NAME_H + ROW_PRICE_H;
const EXPANDED_CARD_HEIGHT = COLLAPSED_CARD_HEIGHT + ROW_STEPPER_H + ROW_ADD_H;
const BUILDING_CARD_HEIGHT = EXPANDED_CARD_HEIGHT;

// Row tops and centers, top-down from the card's TOP edge (y = 0 at the top).
// These are the ONLY vertical coordinates any card element uses.
const ROW_ART_TOP = CARD_PAD_Y;
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
/**
 * A path card's art is a 256x128 TILE DIAMOND (U4), never a square icon, so it
 * scales by WIDTH alone (the PathsPanel precedent) - 120 wide puts its 60-tall
 * diamond comfortably inside the 80-tall art row.
 */
const PATH_TILE_NATIVE_WIDTH = 256;
const PATH_CARD_ICON_WIDTH = 120;

/** Price group: coin/moondust icon + amount, centred as one group in the price row. */
const CARD_PRICE_ICON_NATIVE = 96;
const CARD_PRICE_ICON_DISPLAY = 34;
const CARD_PRICE_ICON_SCALE = CARD_PRICE_ICON_DISPLAY / CARD_PRICE_ICON_NATIVE;
const CARD_PRICE_GAP = 6;

/** Owned "xN" badge overlays the card's top-right corner - the one intended overlap. */
const CARD_OWNED_BADGE_X = CARD_WIDTH / 2 - 36;
const CARD_OWNED_BADGE_Y = 26;

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
 * Card grid: 2 columns. GRID_TOP_EDGE is the TOP edge of row 0. Buildings keep
 * their U2b-r2 row CENTERS (so the Buildings tab is pixel-identical), hence the
 * top edge is that center minus a full card's half-height. Building rows pack by
 * the full card height; decor rows pack by the collapsed height and reflow when
 * a card expands (see `shopDecorLayout`).
 */
const COLUMN_X = [-232, 232] as const;
const CARD_ROW_GAP = 12;
const BUILDING_ROW_SPACING = BUILDING_CARD_HEIGHT + CARD_ROW_GAP;
const GRID_TOP_EDGE = -HALF_H + 392 - BUILDING_CARD_HEIGHT / 2;

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
/** EXPORTED (U4-r1): the paint bar's tier chips reuse this exact chrome, so
 *  the shop cards and the chips stay one visual language. */
export const STROKE_BROWN = 0x4a3218;
export const CARD_FILL = 0xf7edd6;
const CARD_RADIUS = 20;
const CARD_STROKE_W = 2;
const PILL_STROKE_W = 2;
const BTN_STROKE_W = 2;
const BTN_RADIUS = 14;
/** Neutral pill fill (status, owned, shed) and warm/cool price-pill tints.
 *  PILL_FILL is exported for the paint bar's count pills (U4-r1). */
export const PILL_FILL = 0xeaddbe;
const COIN_PILL_FILL = 0xf4dca6;
const MOONDUST_PILL_FILL = 0xd8def0;
const BTN_FILL = 0xf1e2c0;
/** Horizontal padding from a pill's content to its rounded edge. */
const PILL_PAD_X = 16;
/** Price/status pill half-height - sized to sit inside the card's price row. */
const PILL_HALF_H = 18;
const OWNED_PILL_HALF_H = 18;
const OWNED_PILL_PAD_X = 12;

/**
 * Draw a filled + stroked rounded rect CENTRED on the graphics' own origin,
 * clearing whatever it held - so scaling the graphics pivots on the shape's
 * centre and a redraw is a straight replace. The one drawing primitive all the
 * vector chrome shares (U2b-r1); EXPORTED since U4-r1 so the paint bar's tier
 * chips draw with the identical card language.
 */
export function drawCardRoundRect(
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

/** The "Shed" button label - the arrange bar's brown Arial-bold lettering,
 *  sized to the header button (U5-r2). */
const SHED_BTN_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/**
 * The Shed button's corner count badge (U5-r2): mirrors the arrange bar's
 * ARRANGE_SHED_BADGE_STYLE 1:1 (gold fill, dark stroke) so the two Shed buttons
 * read identically. Kept as its own copy rather than imported from FarmScene:
 * FarmScene imports Hud which imports this file, so importing back would cycle.
 */
const SHED_BADGE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  fontStyle: 'bold',
  color: '#f5c542',
  stroke: '#3a2a10',
  strokeThickness: 5,
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

/**
 * The Paths tab's "Paint" entry (U4): a footer button shown ONLY while the
 * Paths tab is active - it closes the shop and enters the persistent paint
 * mode (tier choice lives in the paint bar's tier row). The successor of the
 * pre-U4 "Paths" stopgap footer button, in its band.
 */
const PAINT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const PAINT_BUTTON_Y = HALF_H - 66;
const PAINT_BUTTON_WIDTH = 260;
const PAINT_BUTTON_HEIGHT = 84;

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
  /** Grid slot within the card's own tab - drives the decor reflow. */
  slot: number;
  container: Phaser.GameObjects.Container;
  /** Drawn card fill+border. */
  cardBg: Phaser.GameObjects.Graphics;
  /** Whole-card tap target for a building card (undefined on a decor card). */
  hitZone?: Phaser.GameObjects.Zone;
  /**
   * Decor-only (U3b-r2): the collapsed-face tap target over the art/name/price
   * rows; tapping it expands the card (or collapses it when already expanded).
   */
  headerZone?: Phaser.GameObjects.Zone;
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
  /**
   * Last owned-count and status label whose pill geometry was drawn. A pill is a
   * WebGL Graphics whose rounded-rect must be re-tessellated on a redraw; refresh
   * runs on the 250ms Hud tick while the shop is open, so redrawing every pill
   * each call hitches the fly/bounce animation. Guard the redraw on these keys so
   * a pill only re-tessellates when its content actually changed (U2b-r4).
   */
  ownedCount: number;
  statusKey: string;
  /**
   * Container origin (top-center) in main-container space, for the fly-to-chip
   * start point. `originY` tracks the reflow, so it moves when a decor card
   * above expands.
   */
  centerX: number;
  originY: number;
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
  private readonly shedButton: Phaser.GameObjects.NineSlice;
  private readonly shedButtonLabel: Phaser.GameObjects.Text;
  private readonly shedBadge: Phaser.GameObjects.Text;

  private readonly buildingTabBg: Phaser.GameObjects.NineSlice;
  private readonly buildingTabText: Phaser.GameObjects.Text;
  private readonly pathTabBg: Phaser.GameObjects.NineSlice;
  private readonly pathTabText: Phaser.GameObjects.Text;
  private readonly decorTabBg: Phaser.GameObjects.NineSlice;
  private readonly decorTabText: Phaser.GameObjects.Text;
  /** The Paths tab's "Paint" entry (U4) - see PAINT_BUTTON_Y. */
  private readonly paintButton: Phaser.GameObjects.NineSlice;
  private readonly paintText: Phaser.GameObjects.Text;

  private readonly tooltipText: Phaser.GameObjects.Text;
  private tooltipTween: Phaser.Tweens.Tween | null = null;

  private readonly cards: Card[] = [];

  /**
   * The one stepper card (decor or path, U4) currently expanded (U3b-r2), or
   * null when all are collapsed. Tapping a collapsed card's header expands it
   * and collapses any other; switching tabs or closing the panel resets it to
   * null.
   */
  private expandedDecorCard: Card | null = null;

  /**
   * Every persistent hit target the panel owns - the body-tap blocker, the X,
   * the three tabs, the Paint button, and each card's zones - toggled with the
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
    /** Close this panel and enter the persistent paint mode (U4) - the Paths
     *  tab's "Paint" footer button. */
    private readonly onEnterPaintMode: () => void,
    /**
     * A building was just bought (U3b): the scene closes the shop, enters
     * arrange mode, and selects the new building "in hand".
     */
    private readonly onBuildingBought: (buildingId: BuildingId) => void,
    /**
     * The header's Shed button (U5-r2): this panel has already hidden itself;
     * the scene enters arrange mode if it is not already active (the U3b
     * entrance, nothing selected) and opens the Shed panel. From the elevated
     * (arrange) context arrange stays and only the panel opens.
     */
    private readonly onOpenShed: () => void,
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
    // The Shed BUTTON (U5-r2): a `panel` nineslice + "Shed" label + gold corner
    // count badge, mirroring the arrange bar's Shed button. Its centre is the
    // fly-to-chip target and the bounce pivot. The nineslice is visual only; a
    // paired invisible Zone (pushed to `interactives`) carries the hit test, so
    // a closed shop holds no live Shed hitbox.
    this.shedButton = scene.add.nineslice(
      SHED_BTN_X,
      HEADER_Y,
      ATLAS_KEY,
      'panel',
      SHED_BTN_WIDTH,
      SHED_BTN_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    this.shedButtonLabel = scene.add
      .text(SHED_BTN_X, HEADER_Y, 'Shed', SHED_BTN_LABEL_STYLE)
      .setOrigin(0.5);
    this.shedBadge = scene.add
      .text(SHED_BTN_X + SHED_BADGE_OFFSET_X, HEADER_Y + SHED_BADGE_OFFSET_Y, '', SHED_BADGE_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    const shedZone = scene.add
      .zone(SHED_BTN_X, HEADER_Y, SHED_BTN_WIDTH, SHED_BTN_HEIGHT)
      .setInteractive({ useHandCursor: true });
    shedZone.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        // Consume the tap so it never leaks through the (about-to-close)
        // backdrop to an arrange control underneath (the U3b-r3 class).
        event.stopPropagation();
        this.audio.sfx('tap');
        this.hide();
        this.onOpenShed();
      },
    );
    this.container.add([
      coinIcon,
      this.coinText,
      moondustIcon,
      this.moondustText,
      this.shedButton,
      this.shedButtonLabel,
      this.shedBadge,
      shedZone,
    ]);
    this.interactives.push(shedZone);

    // Tab row.
    this.buildingTabBg = this.buildButton(TAB_BUILDING_X, TAB_Y, TAB_WIDTH, TAB_HEIGHT);
    this.buildingTabText = scene.add
      .text(TAB_BUILDING_X, TAB_Y, 'Buildings', TAB_STYLE)
      .setOrigin(0.5);
    this.buildingTabBg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.selectTab('building');
    });
    this.pathTabBg = this.buildButton(TAB_PATH_X, TAB_Y, TAB_WIDTH, TAB_HEIGHT);
    this.pathTabText = scene.add.text(TAB_PATH_X, TAB_Y, 'Paths', TAB_STYLE).setOrigin(0.5);
    this.pathTabBg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.selectTab('path');
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
      this.pathTabBg,
      this.pathTabText,
      this.decorTabBg,
      this.decorTabText,
    ]);
    this.interactives.push(this.buildingTabBg, this.pathTabBg, this.decorTabBg);

    // One-time Shed tooltip (hidden until the first Add succeeds).
    this.tooltipText = scene.add
      .text(0, TOOLTIP_Y, TOOLTIP_TEXT, TOOLTIP_STYLE)
      .setOrigin(0.5)
      .setWordWrapWidth(TOOLTIP_WRAP)
      .setVisible(false);
    this.container.add(this.tooltipText);

    // Cards for every tab, filtered to purchasable items (trophies are never
    // sold). Same grid coordinates per tab; only the active tab's cards show.
    for (const item of catalogItemsInCategory('building').filter((i) => i.purchasable)) {
      this.cards.push(this.buildCard(item));
    }
    for (const item of catalogItemsInCategory('path').filter((i) => i.purchasable)) {
      this.cards.push(this.buildCard(item));
    }
    for (const item of catalogItemsInCategory('decor').filter((i) => i.purchasable)) {
      this.cards.push(this.buildCard(item));
    }
    // Every stepper card (path/decor) starts collapsed (U3b-r2): hide the
    // stepper rows and pack the grid at the collapsed height before the first
    // open.
    this.applyDecorExpansionAll();

    // The Paths tab's "Paint" entry (U4) - see PAINT_BUTTON_Y. `refresh` shows
    // it only while the Paths tab is active.
    this.paintButton = this.buildButton(0, PAINT_BUTTON_Y, PAINT_BUTTON_WIDTH, PAINT_BUTTON_HEIGHT);
    this.paintText = scene.add.text(0, PAINT_BUTTON_Y, 'Paint', PAINT_STYLE).setOrigin(0.5);
    this.paintButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
      this.onEnterPaintMode();
    });
    this.container.add([this.paintButton, this.paintText]);
    this.interactives.push(this.paintButton);

    // The panel starts closed, so it must start with no live hitboxes (see
    // `interactives`); `openTo` re-enables them. `refresh` still owns each Add
    // button's enabled/disabled state on top of this.
    this.setInteractivesEnabled(false);

    // DEV-only capture seam (U2b-r2): expose the single panel on the
    // `window.__shop` seam so a headless capture can open it to a given tab and
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
   * Draw a filled + stroked rounded rect CENTRED on the graphics' own origin -
   * a thin delegate onto the module-level `drawCardRoundRect` (exported since
   * U4-r1 for the paint bar's tier chips), kept as a method so the panel's
   * many call sites stay unchanged.
   */
  private drawRoundRect(
    g: Phaser.GameObjects.Graphics,
    halfW: number,
    halfH: number,
    radius: number,
    fill: number,
    strokeW: number,
  ): void {
    drawCardRoundRect(g, halfW, halfH, radius, fill, strokeW);
  }

  /**
   * Draw a card's fill+border to `height` (U3b-r2). TOP-anchored: the graphics
   * sit at the card's vertical centre so the rounded rect spans y in [0, height]
   * within the container - a redraw at a new height just grows the card downward.
   */
  private drawCardBg(g: Phaser.GameObjects.Graphics, height: number): void {
    g.setPosition(0, height / 2);
    this.drawRoundRect(g, CARD_WIDTH / 2, height / 2, CARD_RADIUS, CARD_FILL, CARD_STROKE_W);
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

  /** Build one card (building, path, or decor); its grid slot is its index within its tab. */
  private buildCard(item: CatalogItem): Card {
    const tabItems = catalogItemsInCategory(item.category).filter((i) => i.purchasable);
    const slot = tabItems.findIndex((i) => i.id === item.id);
    const col = slot % 2;
    const rowIndex = Math.floor(slot / 2);
    const centerX = COLUMN_X[col]!;
    // TOP-anchored: the container sits at the card's top edge. Buildings pack
    // by the full card height; path/decor start collapsed and reflow via
    // `layoutStepperGrids`.
    const isBuilding = item.category === 'building';
    const originY = GRID_TOP_EDGE + rowIndex * (isBuilding ? BUILDING_ROW_SPACING : 0);

    const cardContainer = this.scene.add.container(centerX, originY).setVisible(false);

    // Drawn card fill + border (no sprite chrome), drawn to the card's height.
    const cardBg = this.scene.add.graphics();
    this.drawCardBg(cardBg, isBuilding ? BUILDING_CARD_HEIGHT : COLLAPSED_CARD_HEIGHT);

    // A path frame is a wide tile diamond, scaled by width (U4); square
    // building/decor icons scale by their native square size.
    const iconScale =
      item.category === 'path'
        ? PATH_CARD_ICON_WIDTH / PATH_TILE_NATIVE_WIDTH
        : CARD_ICON_DISPLAY / (isBuilding ? BUILDING_ICON_NATIVE : DECOR_ICON_NATIVE);
    const icon = this.scene.add.image(0, CARD_ICON_Y, ATLAS_KEY, item.frame).setScale(iconScale);
    const nameText = this.scene.add.text(0, CARD_NAME_Y, item.name, NAME_STYLE).setOrigin(0.5);

    // Price pill: a drawn pill behind a coin/moondust icon + amount, laid out as
    // a centred group. Static per card, so drawn once here. A path tier's price
    // is PER TILE, so it reads "15 ea"; the free rung (dirt) reads "Free" with
    // no coin icon at all (U4, the PathsPanel convention).
    const pricePill = this.scene.add.graphics().setPosition(0, CARD_PRICE_Y);
    const priceIconFrame = item.currency === 'coins' ? 'coin' : 'moondust';
    const priceIcon = this.scene.add
      .image(0, CARD_PRICE_Y, ATLAS_KEY, priceIconFrame)
      .setScale(CARD_PRICE_ICON_SCALE);
    const freePath = item.category === 'path' && item.price === 0;
    const priceLabel =
      item.category === 'path' ? (freePath ? 'Free' : `${item.price} ea`) : String(item.price);
    const priceText = this.scene.add
      .text(0, CARD_PRICE_Y, priceLabel, PRICE_STYLE)
      .setOrigin(0, 0.5);
    if (freePath) {
      priceIcon.setVisible(false);
      priceText.setOrigin(0.5).setX(0);
      this.drawPill(pricePill, priceText.width, PILL_HALF_H, PILL_PAD_X, COIN_PILL_FILL);
    } else {
      this.layoutPricePill(pricePill, priceIcon, priceText, item.currency);
    }

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
      slot,
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
      ownedCount: -1,
      statusKey: '',
      centerX,
      originY,
      wiggle: null,
    };

    if (item.category === 'building') {
      // The whole card is the tap-to-buy / wiggle target - an invisible Zone
      // over the drawn card (centred on the full card, TOP-anchored).
      card.hitZone = this.makeHitZone(
        cardContainer,
        0,
        BUILDING_CARD_HEIGHT / 2,
        CARD_WIDTH,
        BUILDING_CARD_HEIGHT,
        () => this.onBuildingTap(card),
      );
    } else {
      card.stepper = this.buildStepper(cardContainer, card);
      // The collapsed-face header (art/name/price rows) toggles expansion.
      card.headerZone = this.makeHitZone(
        cardContainer,
        0,
        COLLAPSED_CARD_HEIGHT / 2,
        CARD_WIDTH,
        COLLAPSED_CARD_HEIGHT,
        () => this.onDecorHeaderTap(card),
      );
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

  /**
   * Tap on a decor card's collapsed-face header (U3b-r2): expand it, or collapse
   * it when it is already the expanded one. Exactly one card is ever expanded, so
   * expanding a new card collapses the previous.
   */
  private onDecorHeaderTap(card: Card): void {
    this.audio.sfx('tap');
    this.setDecorExpansion(this.expandedDecorCard === card ? null : card);
  }

  /** Set (or clear) the one expanded decor card, then reflow + re-derive (U3b-r2). */
  private setDecorExpansion(card: Card | null): void {
    this.expandedDecorCard = card;
    this.applyDecorExpansionAll();
    this.refresh(gameState.getState());
  }

  /**
   * Reflow both stepper grids (path + decor, U4) and apply every stepper
   * card's expanded/collapsed visuals from the current `expandedDecorCard`
   * (U3b-r2), WITHOUT re-deriving from state - so the constructor and `hide`
   * can reset to all-collapsed before any refresh (the next `openTo`
   * refreshes).
   */
  private applyDecorExpansionAll(): void {
    this.layoutStepperGrids();
    for (const c of this.cards) {
      if (c.item.category !== 'building') this.applyDecorExpansion(c);
    }
  }

  /**
   * Reposition every stepper card's container top from the reflow (U3b-r2;
   * per-tab since U4 - the path and decor tabs each run their own reflow over
   * the same grid band, since only one tab ever shows). The expanded card's
   * row grows; later rows shift down. `originY` tracks the move so the
   * fly-to-chip start stays correct.
   */
  private layoutStepperGrids(): void {
    for (const category of ['path', 'decor'] as const) {
      const tabCards = this.cards.filter((c) => c.item.category === category);
      const expanded = this.expandedDecorCard;
      const tops = decorCardTops(
        tabCards.length,
        expanded?.item.category === category ? expanded.slot : null,
        GRID_TOP_EDGE,
        COLLAPSED_CARD_HEIGHT,
        EXPANDED_CARD_HEIGHT,
        CARD_ROW_GAP,
      );
      for (const card of tabCards) {
        const top = tops[card.slot]!;
        card.container.setY(top);
        card.originY = top;
      }
    }
  }

  /**
   * Apply a stepper card's expanded/collapsed visuals (U3b-r2): grow/shrink the
   * card BG and show/hide the stepper + Add row. Zone interactivity for the
   * stepper is (re-)derived by `refreshStepperCard` on top of this
   * (affordability), but a collapsed card must carry no live stepper hitboxes
   * regardless.
   */
  private applyDecorExpansion(card: Card): void {
    const stepper = card.stepper;
    if (stepper === undefined) return;
    const expanded = this.expandedDecorCard === card;
    this.drawCardBg(card.cardBg, expanded ? EXPANDED_CARD_HEIGHT : COLLAPSED_CARD_HEIGHT);
    for (const el of [
      stepper.minusG,
      stepper.minusLabel,
      stepper.qtyText,
      stepper.plusG,
      stepper.plusLabel,
      stepper.addG,
      stepper.addText,
    ]) {
      el.setVisible(expanded);
    }
    if (!expanded) {
      stepper.minusZone.disableInteractive();
      stepper.plusZone.disableInteractive();
      stepper.addZone.disableInteractive();
    }
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
    // Owned counts SHED + PLACED (U3b-r1): a stranded shed copy is still owned.
    const owned =
      state.buildings.some((placed) => placed.type === card.item.id) ||
      (state.shedInventory[card.item.id] ?? 0) > 0;
    const unlocked = state.level >= card.item.unlockLevel;
    if (owned || !unlocked) {
      // Inert card - a locked one wiggles, an owned one does nothing.
      if (!unlocked) this.wiggleCard(card);
      return;
    }
    // A building-category catalog id IS a BuildingId (see catalog.ts); the
    // store re-validates it against BUILDINGS regardless.
    const buildingId = card.item.id as BuildingId;
    if (!gameState.buyBuilding(buildingId)) return;
    this.audio.coin();
    // Fast path (U3b): close the shop, then hand the scene the new building so
    // it drops the player into arrange mode with it selected "in hand".
    this.hide();
    this.onBuildingBought(buildingId);
  }

  /** Stepper-card Add (decor or path): charge qty * price into the shed,
   *  animate, keep the shop open. Free dirt charges 0 through the same path. */
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
    // Expanded state resets on a tab switch (U3b-r2); setDecorExpansion refreshes.
    this.setDecorExpansion(null);
  }

  /** Fly a one-off copy of the card icon into the Shed chip, then bounce it. */
  private flyToChip(card: Card): void {
    const startX = card.centerX + card.icon.x;
    const startY = card.originY + card.icon.y;
    const fly = this.scene.add
      .image(startX, startY, ATLAS_KEY, card.item.frame)
      .setScale(card.icon.scaleX);
    this.container.add(fly);
    this.scene.tweens.add({
      targets: fly,
      x: SHED_BTN_X,
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

  /** A small scale pop on the Shed button + badge as its count ticks up. */
  private bounceChip(): void {
    this.scene.tweens.add({
      targets: [this.shedButton, this.shedButtonLabel, this.shedBadge],
      scale: CHIP_BOUNCE_SCALE,
      duration: CHIP_BOUNCE_MS,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.shedButton.setScale(1);
        this.shedButtonLabel.setScale(1);
        this.shedBadge.setScale(1);
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
    // The tooltip is added to the container BEFORE the cards, so it renders
    // BEHIND them and its lower band is occluded by the top card row. Move it to
    // the top of the container on show so it sits above every card, pill, and
    // button (U2b-r4 defect 1).
    this.container.bringToTop(this.tooltipText);
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
    // The Shed button's corner count badge: the live shed total, hidden at 0
    // (the arrange bar's Shed badge convention). Just a text swap - the button
    // nineslice never redraws, so the periodic refresh never hitches the
    // fly/bounce.
    const shedTotal = Object.values(state.shedInventory).reduce((sum, n) => sum + n, 0);
    this.shedBadge.setText(shedTotal > 0 ? String(shedTotal) : '').setVisible(shedTotal > 0);

    const tabAlpha = (tab: ShopTab): number =>
      this.activeTab === tab ? TAB_ACTIVE_ALPHA : TAB_INACTIVE_ALPHA;
    this.buildingTabBg.setAlpha(tabAlpha('building'));
    this.buildingTabText.setAlpha(tabAlpha('building'));
    this.pathTabBg.setAlpha(tabAlpha('path'));
    this.pathTabText.setAlpha(tabAlpha('path'));
    this.decorTabBg.setAlpha(tabAlpha('decor'));
    this.decorTabText.setAlpha(tabAlpha('decor'));

    // The Paint entry belongs to the Paths tab alone (U4): hidden AND
    // hitbox-dead on the other tabs (`setInteractivesEnabled(true)` on open
    // re-arms it blindly, the stepper-zone precedent).
    const onPathTab = this.activeTab === 'path';
    this.paintButton.setVisible(onPathTab);
    this.paintText.setVisible(onPathTab);
    if (onPathTab) {
      this.paintButton.setInteractive({ useHandCursor: true });
    } else {
      this.paintButton.disableInteractive();
    }

    const decorOwned = decorOwnedCount(state.decorations, state.shedInventory);
    const fenceOwned = fenceOwnedCount(state.decorations, state.shedInventory);

    for (const card of this.cards) {
      const onTab = card.item.category === this.activeTab;
      card.container.setVisible(onTab);
      if (!onTab) continue;
      if (card.item.category === 'building') {
        this.refreshBuildingCard(card, state);
      } else {
        this.refreshStepperCard(card, state, decorOwned, fenceOwned);
      }
    }
  }

  /**
   * Set the owned badge + its pill, sized to the count, or hide both. A unique
   * item (`allowMultiple` false - a building) reads "1/1"; a stackable reads
   * "xN" (U3b-r3). The label is derived from `allowMultiple`, never category.
   */
  private setOwnedBadge(card: Card, count: number): void {
    const show = count > 0;
    card.ownedBadge.setText(ownedBadgeLabel(count, card.item.allowMultiple)).setVisible(show);
    card.ownedPill.setVisible(show);
    // Redraw the pill only when the count (hence badge width) changed, so a
    // no-op refresh tick re-tessellates nothing (U2b-r4).
    if (show && count !== card.ownedCount) {
      this.drawPill(
        card.ownedPill,
        card.ownedBadge.width,
        OWNED_PILL_HALF_H,
        OWNED_PILL_PAD_X,
        PILL_FILL,
      );
    }
    card.ownedCount = count;
  }

  private refreshBuildingCard(card: Card, state: GameStateData): void {
    // Owned counts SHED + PLACED (U3b-r1): a stranded shed copy reads Owned.
    const owned =
      state.buildings.some((placed) => placed.type === card.item.id) ||
      (state.shedInventory[card.item.id] ?? 0) > 0;
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
      const statusLabel = owned ? 'Owned' : `Level ${card.item.unlockLevel}`;
      card.statusText.setText(statusLabel);
      // Redraw the status pill only when its label changed (U2b-r4).
      if (statusLabel !== card.statusKey) {
        this.drawPill(card.statusPill, card.statusText.width, PILL_HALF_H, PILL_PAD_X, PILL_FILL);
        card.statusKey = statusLabel;
      }
    }
  }

  /**
   * Re-derive a stepper card (decor or path, U4) from state. A decor card's
   * owned badge counts placed + shed; a PATH card's counts the SHED alone
   * (spec: the badge is the paintable stock, and painted tiles are not stock).
   * The split-budget caps are decor-only - paths are uncapped by design.
   */
  private refreshStepperCard(
    card: Card,
    state: GameStateData,
    decorOwned: number,
    fenceOwned: number,
  ): void {
    const stepper = card.stepper;
    if (stepper === undefined) return;
    card.container.setAlpha(1);
    stepper.qtyText.setText(String(stepper.qty));

    const shed = state.shedInventory[card.item.id] ?? 0;
    const placed =
      card.item.category === 'path'
        ? 0
        : state.decorations.filter((d) => d.frame === card.item.frame).length;
    this.setOwnedBadge(card, placed + shed);

    // A collapsed card hides its stepper, so it must carry no live stepper
    // hitboxes (U3b-r2) - `setInteractivesEnabled(true)` on open re-armed them
    // blindly, so re-drop them here for every card that is not the expanded one.
    if (this.expandedDecorCard !== card) {
      stepper.minusZone.disableInteractive();
      stepper.plusZone.disableInteractive();
      stepper.addZone.disableInteractive();
      return;
    }
    stepper.minusZone.setInteractive({ useHandCursor: true });
    stepper.plusZone.setInteractive({ useHandCursor: true });

    const balance = card.item.currency === 'coins' ? state.coins : state.moondust;
    const affordable = balance >= card.item.price * stepper.qty;
    // Same split-budget cap `buyToShed` enforces - presentation only here, and
    // decor-only (`buyToShed` exempts paths from both budgets).
    const underCap =
      card.item.category === 'path'
        ? true
        : card.item.frame === FENCE_FRAME
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

  /** Open the panel on `tab` (Buildings, Paths, or Decor). */
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
    // Expanded state resets when the panel closes (U3b-r2), so the next open
    // starts calm with every decor card collapsed.
    this.expandedDecorCard = null;
    this.applyDecorExpansionAll();
  }
}
