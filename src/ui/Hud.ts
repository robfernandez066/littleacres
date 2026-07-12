import Phaser from 'phaser';

import { ATLAS_KEY, BAG_POSITION, DESIGN_WIDTH, HUD_COIN_POSITION } from '../config';
import { CROPS, type CropId } from '../data/crops';
import { MAX_LEVEL, xpForLevel } from '../data/levels';
import type { AudioManager } from '../systems/audio';
import { gameState } from '../systems/gameState';
import { buzz } from '../systems/haptics';
import { registerPulseTarget } from '../systems/pulseTargets';
import { CoinArc, MAX_COINS_PER_FLY } from './CoinArc';
import { CropArc } from './CropArc';
import { FloatingText } from './FloatingText';
import { InventoryPanel } from './InventoryPanel';
import { OrderBoard } from './OrderBoard';
import { SettingsPanel } from './SettingsPanel';

/**
 * Themed top HUD: a full-width wooden banner carrying the level crest, the xp
 * bar, the coin/moondust counters, and the bag/orders button slots, with the
 * gear (settings) icon hanging just below its right edge. Renders purely from
 * `gameState.getState()` - never owns game data.
 *
 * The coin counter is a display value that animates toward the true state
 * value rather than snapping: a steady drift tween on the regular refresh,
 * or a batched per-arrival climb while a sell's coin arcs are in flight.
 */

/** Confined to y < 420 (HUD headroom above the field band). */
const HUD_DEPTH = 2000;

/**
 * Banner nineslice: full design width, native art height, positioned at
 * y ~14..158. T2.13b recomposition - T2.13a stretched this ~144px-native
 * plank art to 240px tall to make room for everything, which visibly
 * smeared the wood grain (and hit a Phaser NineSlice bug in the process:
 * `topHeight=0 && bottomHeight=0` triggers a "3-slice" special case that
 * silently forces the rendered height back to the native frame height
 * regardless of what's requested - see NineSlice.js's `setSlices`, the
 * `is3Slice` branch overwrites `this._height = frame.height`). This version
 * embraces that 3-slice path deliberately instead of fighting it: horizontal
 * slicing only, zero vertical scaling, ever. MEASURED (Jimp scan of the
 * packed `hud_banner` frame, 512x144 native): the left/right vine curls
 * occupy native x 2..51 and 461..510, so a 60px slice on each side keeps the
 * vine + corner post intact while the middle plank (plain wood grain)
 * stretches horizontally to fill the width.
 */
const BANNER_NATIVE_HEIGHT = 144;
const BANNER_TOP_Y = 14;
const BANNER_HEIGHT = BANNER_NATIVE_HEIGHT;
const BANNER_BOTTOM_Y = BANNER_TOP_Y + BANNER_HEIGHT;
const BANNER_CENTER_Y = BANNER_TOP_Y + BANNER_HEIGHT / 2;
const BANNER_SLICE_WIDTH = 60;

/**
 * Crest: centered on the banner at BANNER_CENTER_Y, so it overhangs the
 * strip's top and bottom edges by (CREST_SIZE - BANNER_NATIVE_HEIGHT) / 2
 * each - a medallion pinned to a ribbon. 180 (live-reviewed: with the xp
 * bar's frame tucked only XP_BAR_FRAME_TOP_GAP below the banner, a 180
 * crest's ~18px bottom overhang reached past that gap and visibly cut into
 * the bar's top edge - not the thin tapering point this file's comments
 * used to assume, a real collision) had to come down to 160, so the
 * overhang (8px) stays under the gap (10px) with 2px to spare. MEASURED
 * (Jimp scan of the packed `hud_crest` frame, 192x192 native): the cream
 * medallion circle spans native x 43..148, y 38..142 (center (95.5, 90),
 * diameter ~105) - offset (-0.5, -6) from the frame's own center (96, 96).
 */
const CREST_SIZE = 160;
const CREST_Y = BANNER_CENTER_Y;
const CREST_NATIVE_SIZE = 192;
const CREST_SCALE = CREST_SIZE / CREST_NATIVE_SIZE;
const MEDALLION_OFFSET_Y = -6 * CREST_SCALE;
/** Medallion diameter (measured ~105 native, scaled to the crest) minus a safety margin. */
const LEVEL_TEXT_MAX_WIDTH = 75;
const LEVEL_FONT_SIZE = 64;
const LEVEL_FONT_MIN_SIZE = 40;

/**
 * XP bar: `xpbar_frame` (512x138 native) scaled to 360 wide, centered under
 * the crest, its frame's top edge tucked 10px below the banner's bottom
 * edge (158) - close enough to read as attached trim, per spec's "within
 * ~8px", and (see the crest's own comment) sized so the crest's bottom
 * overhang (8px) clears this gap with 2px to spare - genuinely no overlap,
 * not just a thin one.
 * MEASURED (Jimp scan of the packed frame): the inner cream track well spans
 * native x 39..473, y 35..103 (a symmetric 39px/35px border), so the fill
 * sits inset by that border, scaled the same as the frame.
 */
const XP_BAR_X = DESIGN_WIDTH / 2;
const XP_BAR_FRAME_TOP_GAP = 10;
const XP_BAR_FRAME_NATIVE_WIDTH = 512;
const XP_BAR_FRAME_NATIVE_HEIGHT = 138;
const XP_BAR_FRAME_DISPLAY_WIDTH = 360;
const XP_BAR_SCALE = XP_BAR_FRAME_DISPLAY_WIDTH / XP_BAR_FRAME_NATIVE_WIDTH;
const XP_BAR_FRAME_DISPLAY_HEIGHT = XP_BAR_FRAME_NATIVE_HEIGHT * XP_BAR_SCALE;
const XP_BAR_Y = BANNER_BOTTOM_Y + XP_BAR_FRAME_TOP_GAP + XP_BAR_FRAME_DISPLAY_HEIGHT / 2;
const XP_BAR_TRACK_INSET_X_NATIVE = 39;
const XP_BAR_TRACK_INSET_Y_NATIVE = 35;
const XP_BAR_TRACK_WIDTH =
  XP_BAR_FRAME_DISPLAY_WIDTH - 2 * XP_BAR_TRACK_INSET_X_NATIVE * XP_BAR_SCALE;
const XP_BAR_TRACK_HEIGHT =
  XP_BAR_FRAME_DISPLAY_HEIGHT - 2 * XP_BAR_TRACK_INSET_Y_NATIVE * XP_BAR_SCALE;

const COIN_DRIFT_DURATION_MS = 300;

/**
 * Currency icons: ONE horizontal row inside the slim strip (T2.13a had them
 * stacked in two rows, which only fit a taller banner that's gone now),
 * vertically centered at BANNER_CENTER_Y. The coin icon sits exactly at
 * HUD_COIN_POSITION - the shared constant CoinArc also flies to - so
 * arriving coins land right on the counter. HUD_COIN_POSITION.x is 110, not
 * flush against the left slice boundary (60): live review at coins=100193
 * showed the coin icon visibly overlapping the left vine curl (native x
 * 2..51, unscaled 1:1 in the slice) at x=85 - 110 clears it with a real
 * margin. Layout budget: the crest's left overhang edge sits at
 * 540 - 160/2 = 460, so coin icon + text + gap + moondust icon + text must
 * all land left of that even at a 5-digit coin count (MEASURED live: at
 * coins=100193 the coin text alone reaches ~x=290 at this offset - moondust
 * follows with room to spare assuming a realistic 1-2 digit moondust count).
 */
const CURRENCY_ICON_SIZE = 60;
const CURRENCY_Y = BANNER_CENTER_Y;
const COIN_TEXT_OFFSET_X = 50;
const MOONDUST_X = 345;
/** Matches COIN_TEXT_OFFSET_X so both counts left-align on their first digit. */
const MOONDUST_TEXT_OFFSET_X = 50;

/**
 * Bag: a bare icon (no `button_slot` backing - it read as clutter, per
 * T2.13a), 90px. Positioned right side of the banner, vertically centered at
 * BANNER_CENTER_Y, clear of the crest's right overhang edge (540 + 160/2 =
 * 620 - the bag's own left edge at 834 - 45 = 789 clears it with room to
 * spare) and of the right vine.
 */
const BUTTON_ICON_DISPLAY_SIZE = 90;
/**
 * The bag's hit area (T2.24), per CLAUDE.md's hit-area rule: MEASURED (Jimp
 * opaque-bounds scan of the packed `bag` frame) rather than the old
 * origin-centered guess this used before (BUTTON_HIT_AREA_SIZE, a plain
 * square centered at the object's origin) - that was the same class of bug
 * root-caused in T2.22a: a center-relative rectangle only partially,
 * coincidentally overlaps the true FRAME-relative region Phaser tests
 * against (hitArea is in the texture's own unscaled, top-left-origin local
 * space), so it silently drops taps on part of the visible sprite. The bag's
 * opaque content spans native x=[6,90], y=[0,96] within its 96x96 native
 * frame (packed to ICON_SIZE by tools/pack-atlas.mjs) - full height, ~6px
 * trimmed each side horizontally.
 */
const BAG_OPAQUE_BOUNDS = { x: 6, y: 0, w: 84, h: 96 };
const BAG_ICON_NATIVE_SIZE = 96;
/** Pad beyond BAG_OPAQUE_BOUNDS, in DISPLAY px (converted to native units via
 *  the icon's own display/native scale - hitArea rectangles are unscaled). */
const BAG_HIT_PAD_DISPLAY_PX = 20;

/**
 * Gear (settings) icon, hanging just below the banner's bottom edge (158) -
 * replaces the old Audio button entirely.
 */
const GEAR_X = 1000;
const GEAR_SIZE = 72;
const GEAR_Y = BANNER_BOTTOM_Y + 8 + GEAR_SIZE / 2;

/** Bag bounce on a harvested crop's arrival only - never on harvest start or a timer. */
const BAG_BOUNCE_SCALE = 1.12;
const BAG_BOUNCE_MS = 150;

/** Rails-inert buttons dim like the seed bar's locked buttons (alpha 0.5). */
const BUTTON_INERT_ALPHA = 0.5;

const SELL_HAPTIC_MS = 12;
const SELL_LABEL_OFFSET_Y = -70;

/** Medium buzz for the order-fulfill beat; heavier than the light sell tap. */
const FULFILL_HAPTIC_MS = 24;
const FULFILL_XP_LABEL_OFFSET_Y = -100;

/** Shared by the coin and moondust counters so the two always match. */
const CURRENCY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '44px',
  fontStyle: 'bold',
  color: '#4a3218',
  stroke: '#fff8e1',
  strokeThickness: 4,
};

/** The level number in the crest's medallion - just the number, no "Lv". */
const LEVEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: `${LEVEL_FONT_SIZE}px`,
  fontStyle: 'bold',
  color: '#4a3218',
};

/** Overlaid on the xp bar; empty below the level cap, "MAX" at it. */
const XP_BAR_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '28px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/**
 * Compact currency display: plain below 1,000; comma-grouped from 1,000 up
 * to 100,000 (e.g. "99,999"); K/M/B abbreviated at and above 100,000 (e.g.
 * "150K", "1.2M", "3.4B") - keeps the currency row's text short and stable
 * regardless of how large coins/moondust grow, so it can't grow into the
 * crest's overhang no matter how long a save has been played. Manual
 * grouping (not `toLocaleString`) for deterministic, locale-independent
 * output.
 */
export function formatCurrency(value: number): string {
  const n = Math.floor(value);
  if (n < 1000) return String(n);
  if (n < 100_000) return groupThousands(n);
  if (n < 1_000_000) return `${Math.floor(n / 1_000)}K`;
  if (n < 1_000_000_000) return `${trimmedDecimal(n / 1_000_000)}M`;
  return `${trimmedDecimal(n / 1_000_000_000)}B`;
}

function groupThousands(n: number): string {
  const digits = String(n);
  let result = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) result += ',';
    result += digits[i];
  }
  return result;
}

/** One decimal place, trimmed to a whole number when it's exact (e.g. "2" not "2.0"). */
function trimmedDecimal(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export class Hud {
  private readonly coinText: Phaser.GameObjects.Text;
  private readonly levelText: Phaser.GameObjects.Text;
  private readonly xpBarFill: Phaser.GameObjects.Image;
  private readonly xpBarText: Phaser.GameObjects.Text;
  private readonly moondustText: Phaser.GameObjects.Text;
  private readonly bagContainer: Phaser.GameObjects.Container;
  private readonly bagIcon: Phaser.GameObjects.Image;
  /** Cached rails gating so interactivity/alpha only toggle on change. */
  private bagEnabled = true;
  private readonly cropArc: CropArc;
  private readonly inventoryPanel: InventoryPanel;
  private readonly orderBoard: OrderBoard;

  /** Animated display value; ticks toward `gameState`'s true coin count. */
  private readonly coinDisplay = { value: 0 };
  private coinTween: Phaser.Tweens.Tween | null = null;
  /** While true, the periodic refresh leaves the coin ticker to in-flight coin arcs. */
  private coinArcsAnimating = false;
  /**
   * While true, the periodic refresh leaves the coin ticker alone for a
   * DIFFERENT reason than `coinArcsAnimating`: a chest's coins have already
   * been granted to state (T2.23a - `fulfillOrder` grants instantly) but the
   * ceremony celebrating them hasn't reached its dismiss beat yet, which may
   * be many ticks away (deferred behind a level-up celebration). Kept as its
   * own flag rather than reusing `coinArcsAnimating`: that one is cleared by
   * the ORDER's own coin arc finishing (a few hundred ms after fulfillment),
   * which would otherwise let the drift silently reveal the chest's bonus
   * coins long before its ceremony does. Set synchronously in `fulfillOrder`
   * (same tick as the grant, before any refresh can run) via
   * `holdCoinDisplay`; cleared the instant `flyChestCoins` starts the real
   * fly - `coinArcsAnimating` (already managed by `flyCoinsToCounter`) takes
   * over blocking duty for the fly's own short duration from there.
   */
  private chestPending = false;
  private bagBounceTween: Phaser.Tweens.Tween | null = null;
  private readonly settingsPanel: SettingsPanel;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly coinArc: CoinArc,
    private readonly floatingText: FloatingText,
    private readonly audio: AudioManager,
  ) {
    this.coinDisplay.value = gameState.getState().coins;

    // Banner strip first, so everything else on the banner draws on top of it.
    this.scene.add
      .nineslice(
        DESIGN_WIDTH / 2,
        BANNER_CENTER_Y,
        ATLAS_KEY,
        'hud_banner',
        DESIGN_WIDTH,
        BANNER_HEIGHT,
        BANNER_SLICE_WIDTH,
        BANNER_SLICE_WIDTH,
        0,
        0,
      )
      .setDepth(HUD_DEPTH);

    // Crest: the level number renders inside its cream medallion.
    this.scene.add
      .image(DESIGN_WIDTH / 2, CREST_Y, ATLAS_KEY, 'hud_crest')
      .setDisplaySize(CREST_SIZE, CREST_SIZE)
      .setDepth(HUD_DEPTH);
    this.levelText = this.scene.add
      .text(DESIGN_WIDTH / 2, CREST_Y + MEDALLION_OFFSET_Y, '', LEVEL_STYLE)
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH + 1);

    // XP bar: frame is a fixed decorative scale, fill is inset in its track
    // and clipped horizontally by progress fraction via setCrop - the fill's
    // display height never changes, only how much of its width is revealed.
    this.scene.add
      .image(XP_BAR_X, XP_BAR_Y, ATLAS_KEY, 'xpbar_frame')
      .setScale(XP_BAR_SCALE)
      .setDepth(HUD_DEPTH);
    this.xpBarFill = this.scene.add
      .image(XP_BAR_X - XP_BAR_TRACK_WIDTH / 2, XP_BAR_Y, ATLAS_KEY, 'xpbar_fill')
      .setOrigin(0, 0.5)
      .setDisplaySize(XP_BAR_TRACK_WIDTH, XP_BAR_TRACK_HEIGHT)
      .setDepth(HUD_DEPTH + 1);
    this.xpBarText = this.scene.add
      .text(XP_BAR_X, XP_BAR_Y, '', XP_BAR_TEXT_STYLE)
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH + 2);

    // Currencies: one row, coin then moondust, left side of the banner.
    this.scene.add
      .image(HUD_COIN_POSITION.x, HUD_COIN_POSITION.y, ATLAS_KEY, 'coin')
      .setDisplaySize(CURRENCY_ICON_SIZE, CURRENCY_ICON_SIZE)
      .setDepth(HUD_DEPTH);
    this.coinText = this.scene.add
      .text(
        HUD_COIN_POSITION.x + COIN_TEXT_OFFSET_X,
        HUD_COIN_POSITION.y,
        formatCurrency(this.coinDisplay.value),
        CURRENCY_STYLE,
      )
      .setOrigin(0, 0.5)
      .setDepth(HUD_DEPTH);
    this.scene.add
      .image(MOONDUST_X, CURRENCY_Y, ATLAS_KEY, 'moondust')
      .setDisplaySize(CURRENCY_ICON_SIZE, CURRENCY_ICON_SIZE)
      .setDepth(HUD_DEPTH);
    this.moondustText = this.scene.add
      .text(MOONDUST_X + MOONDUST_TEXT_OFFSET_X, CURRENCY_Y, '0', CURRENCY_STYLE)
      .setOrigin(0, 0.5)
      .setDepth(HUD_DEPTH);

    // Gear (settings) icon, hanging below the banner's right edge - replaces
    // the old Audio button entirely.
    const gearIcon = this.scene.add
      .image(GEAR_X, GEAR_Y, ATLAS_KEY, 'gear_icon')
      .setDisplaySize(GEAR_SIZE, GEAR_SIZE)
      .setDepth(HUD_DEPTH)
      .setInteractive({ useHandCursor: true });
    gearIcon.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.inventoryPanel.hide();
      this.orderBoard.hide();
      this.settingsPanel.toggle();
    });

    // Bag/orders: bare icons (no button_slot backing), each the container's
    // only child - so the bag's arrival bounce (which scales the container)
    // moves just the icon, nothing else.
    this.bagContainer = this.scene.add
      .container(BAG_POSITION.x, BAG_POSITION.y)
      .setDepth(HUD_DEPTH);
    this.bagIcon = this.buildBareIcon('bag');
    this.bagContainer.add(this.bagIcon);
    this.bagIcon.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.orderBoard.hide();
      this.settingsPanel.hide();
      this.inventoryPanel.toggle(gameState.getState());
    });
    // The container is safe for the guide to scale-breathe: its only other
    // scale state is the short arrival bounce. No current step targets the
    // bag; the registration stays for future chains.
    registerPulseTarget('bag-button', () => ({
      x: BAG_POSITION.x,
      y: BAG_POSITION.y,
      width: BUTTON_ICON_DISPLAY_SIZE,
      height: BUTTON_ICON_DISPLAY_SIZE,
      object: this.bagContainer,
    }));

    this.cropArc = new CropArc(this.scene);

    this.inventoryPanel = new InventoryPanel(
      this.scene,
      (cropId, worldX, worldY) => this.sellCrop(cropId, worldX, worldY),
      this.audio,
    );

    this.orderBoard = new OrderBoard(
      this.scene,
      (slotIndex, worldX, worldY) => this.fulfillOrder(slotIndex, worldX, worldY),
      (slotIndex) => this.skipOrder(slotIndex),
      this.audio,
    );

    this.settingsPanel = new SettingsPanel(this.scene, this.audio);

    this.refresh();
  }

  /**
   * Fly a harvested crop's mature sprite from its plot to the bag. The bag's
   * arrival bounce and blub pop are driven exclusively by this flight
   * landing - never by the harvest itself or a timer, and never by coin arcs.
   */
  flyCropToBag(fromX: number, fromY: number, cropId: CropId): void {
    this.cropArc.fly(fromX, fromY, CROPS[cropId].stageFrames[2], () => {
      this.bounceBag();
      this.audio.bagpop();
    });
  }

  /**
   * Open/close the order board from an external trigger (the farm's notice
   * board structure - T2.22, replacing the old HUD orders icon): the exact
   * same panel-exclusivity behavior the old button had, closing
   * inventory/settings first.
   */
  toggleOrderBoard(): void {
    this.audio.sfx('tap');
    this.inventoryPanel.hide();
    this.settingsPanel.hide();
    this.orderBoard.toggle(gameState.getState());
  }

  /**
   * Close every Hud-owned panel (bag/orders/settings) - used when an
   * externally owned modal exclusive with them (the crop info card, T2.15)
   * opens, mirroring the same closing calls `toggleOrderBoard` and the
   * bag/gear handlers already make for each other.
   */
  closePanels(): void {
    this.inventoryPanel.hide();
    this.orderBoard.hide();
    this.settingsPanel.hide();
  }

  /**
   * A bare, centered icon (no background frame, no label - the tutorial's
   * glow teaches it) with a hit area covering its own measured opaque
   * bounds plus a pad - see BAG_OPAQUE_BOUNDS's comment. FRAME-relative
   * (0,0 at the icon's own native top-left), never centered on the object's
   * origin/position - see CLAUDE.md's hit-area rule.
   */
  private buildBareIcon(iconFrame: string): Phaser.GameObjects.Image {
    const scale = BUTTON_ICON_DISPLAY_SIZE / BAG_ICON_NATIVE_SIZE;
    const pad = BAG_HIT_PAD_DISPLAY_PX / scale;
    return this.scene.add
      .image(0, 0, ATLAS_KEY, iconFrame)
      .setDisplaySize(BUTTON_ICON_DISPLAY_SIZE, BUTTON_ICON_DISPLAY_SIZE)
      .setInteractive({
        hitArea: new Phaser.Geom.Rectangle(
          BAG_OPAQUE_BOUNDS.x - pad,
          BAG_OPAQUE_BOUNDS.y - pad,
          BAG_OPAQUE_BOUNDS.w + pad * 2,
          BAG_OPAQUE_BOUNDS.h + pad * 2,
        ),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
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

    this.updateLevelText(state.level);
    this.updateXpBar(state.level, state.xp);
    this.moondustText.setText(formatCurrency(state.moondust));

    if (!this.coinArcsAnimating && !this.chestPending) this.driftCoinsTo(state.coins);

    this.inventoryPanel.refresh(state);
    this.orderBoard.refresh(state);
    // Re-derives its controls from state so a dev import/reset re-renders it.
    this.settingsPanel.refresh();

    this.applyRailsGating();

    // Onboarding's panel steps: observed panel state is notified every tick
    // (not just on the tap), so a panel already in the required state when
    // its step begins still counts - including one closed via the X button
    // during a "tap outside" step. Cheap no-ops whenever the step is not
    // active. On a board-closed observation, review-order fires before
    // close-orders so an early close (ahead of the read-dwell - see
    // REVIEW_ORDER_DWELL_MS) advances both back to back and neither step
    // can wedge.
    if (this.orderBoard.isVisible()) {
      gameState.notifyOnboardingUiEvent('open-orders');
    } else {
      gameState.notifyOnboardingUiEvent('review-order');
      gameState.notifyOnboardingUiEvent('close-orders');
    }
  }

  /**
   * Tutorial rails on the bag button, from the store's railsAllow choke
   * point (no rules here): inert and dimmed for the whole tutorial. The
   * cached flag keeps the per-tick work to one boolean check; interactivity
   * and alpha only change on a transition. Post-tutorial it is always
   * allowed, so this never touches it again. (The Orders button's own rails
   * gating moved to FarmScene in T2.22, alongside the notice board structure
   * it now lives on.)
   */
  private applyRailsGating(): void {
    const bagAllowed = gameState.railsAllow('bag-button');
    if (bagAllowed !== this.bagEnabled) {
      this.bagEnabled = bagAllowed;
      this.bagContainer.setAlpha(bagAllowed ? 1 : BUTTON_INERT_ALPHA);
      if (bagAllowed) {
        // No-arg re-enable, so the enlarged hit area set at construction
        // survives - passing a fresh config here would reset it to the
        // icon's own (smaller) texture-frame bounds.
        this.bagIcon.setInteractive();
      } else {
        this.bagIcon.disableInteractive();
      }
    }
  }

  /** Level number in the crest's medallion, shrunk to fit at 1 or 2 digits. */
  private updateLevelText(level: number): void {
    this.levelText.setText(String(level));
    let size = LEVEL_FONT_SIZE;
    this.levelText.setFontSize(size);
    while (this.levelText.width > LEVEL_TEXT_MAX_WIDTH && size > LEVEL_FONT_MIN_SIZE) {
      size -= 4;
      this.levelText.setFontSize(size);
    }
    this.centerLevelTextOnMedallion();
  }

  /**
   * Optically center the level number on the medallion. `setOrigin(0.5)`
   * only centers the text's LAYOUT box, but a digit's rendered ink isn't
   * always centered within that box (bold serif digits carry different
   * left/right bearings - "3" read visibly off-center at "6"'s position
   * during T2.13 review), so this scans the text's own backing canvas for
   * the tight ink bounding box and nudges the object's position by the gap
   * between that box's center and the canvas's own center. Cheap (a few
   * thousand pixels for a two-digit number) and only runs when the level
   * number (or its shrink-to-fit size) changes.
   */
  private centerLevelTextOnMedallion(): void {
    const targetX = DESIGN_WIDTH / 2;
    const targetY = CREST_Y + MEDALLION_OFFSET_Y;
    const { canvas, context } = this.levelText;
    const { width, height } = canvas;
    if (width === 0 || height === 0) {
      this.levelText.setPosition(targetX, targetY);
      return;
    }
    const { data } = context.getImageData(0, 0, width, height);
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]! > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) {
      // No ink found (shouldn't happen for a digit) - fall back to plain centering.
      this.levelText.setPosition(targetX, targetY);
      return;
    }
    // Canvas pixels -> the text object's own units (matches .width/.height),
    // in case resolution scaling ever makes them differ.
    const scaleX = this.levelText.width / width;
    const scaleY = this.levelText.height / height;
    const inkOffsetX = (width / 2 - (minX + maxX) / 2) * scaleX;
    const inkOffsetY = (height / 2 - (minY + maxY) / 2) * scaleY;
    this.levelText.setPosition(targetX + inkOffsetX, targetY + inkOffsetY);
  }

  private updateXpBar(level: number, xp: number): void {
    if (level >= MAX_LEVEL) {
      this.xpBarFill.setCrop();
      this.xpBarText.setText('MAX');
      return;
    }
    const cur = xpForLevel(level);
    const next = xpForLevel(level + 1);
    const fraction = next > cur ? Phaser.Math.Clamp((xp - cur) / (next - cur), 0, 1) : 1;
    const frame = this.xpBarFill.frame;
    this.xpBarFill.setCrop(0, 0, frame.width * fraction, frame.height);
    this.xpBarText.setText('');
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
      onUpdate: () => this.coinText.setText(formatCurrency(this.coinDisplay.value)),
    });
  }

  /**
   * Suspend the coin display's normal drift-toward-state tween without
   * starting a flight (see `chestPending`'s comment for why this is a
   * separate flag from `coinArcsAnimating`). Called synchronously from
   * `fulfillOrder`, in the same tick `gameState.fulfillOrder` grants a
   * chest's coins to state (T2.23a - chests grant instantly), well before
   * the ceremony celebrating them reaches its dismiss beat and actually
   * flies the coins - without this the periodic refresh would silently
   * drift the counter to the new total in the meantime.
   */
  holdCoinDisplay(): void {
    this.chestPending = true;
  }

  /**
   * Fly a chest's already-granted coins from (worldX, worldY) to the HUD
   * counter, with the same batched arrival ticker as selling/fulfilling.
   * `before` is the coin total immediately prior to the grant (see
   * `holdCoinDisplay`, which must have been called when that grant happened).
   */
  flyChestCoins(worldX: number, worldY: number, before: number, gained: number): void {
    this.chestPending = false;
    if (gained <= 0) {
      this.coinArcsAnimating = false;
      return;
    }
    this.flyCoinsToCounter(worldX, worldY, before, gained);
  }

  /**
   * Batched coin arcs from a world point to the HUD coin, with the equal
   * per-arrival ticker bump and a final true-up to `before + gained`. Shared
   * choreography between selling a stack and fulfilling an order.
   */
  private flyCoinsToCounter(worldX: number, worldY: number, before: number, gained: number): void {
    this.coinTween?.stop();
    this.coinArcsAnimating = true;
    const target = before + gained;
    const arrivals = Math.min(gained, MAX_COINS_PER_FLY);
    const share = Math.floor(gained / arrivals);
    let arrived = 0;

    this.coinArc.fly(worldX, worldY, gained, () => {
      this.audio.coin();
      arrived++;
      this.coinDisplay.value = arrived >= arrivals ? target : this.coinDisplay.value + share;
      this.coinText.setText(formatCurrency(this.coinDisplay.value));
      if (arrived >= arrivals) this.coinArcsAnimating = false;
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

    this.flyCoinsToCounter(worldX, worldY, before, gained);

    this.floatingText.show(worldX, worldY + SELL_LABEL_OFFSET_Y, `+${gained}`, {
      color: '#ffe27a',
      fontSize: 40,
    });
    buzz(SELL_HAPTIC_MS);

    this.inventoryPanel.refresh(gameState.getState());
  }

  /**
   * Fulfill an order: the store validates and pays out, then one beat of
   * juice - goods arc from the card to the villager and the card stamps
   * (both board-owned), coins arc to the HUD counter with the usual ticker
   * choreography, a floating "+N xp" label, and a medium buzz. Level-ups
   * queued by the payout ride the existing celebration flow on the next
   * refresh tick; a chest event (T2.23a - `order.premium.chests`) rides its
   * own ceremony the same way, but must hold the coin display here,
   * synchronously in this same call, before any refresh tick can see the
   * chest's already-granted coins - see `holdCoinDisplay`'s comment.
   */
  private fulfillOrder(slotIndex: number, worldX: number, worldY: number): void {
    const slot = gameState.getState().orders[slotIndex];
    if (slot === undefined || slot.state !== 'open') return;
    const { order } = slot;
    const before = gameState.getState().coins;
    if (!gameState.fulfillOrder(slotIndex)) return;
    if (order.premium?.chests) this.holdCoinDisplay();

    this.orderBoard.playFulfillJuice(slotIndex, order);
    this.flyCoinsToCounter(worldX, worldY, before, order.coinReward);
    this.floatingText.show(worldX, worldY + FULFILL_XP_LABEL_OFFSET_Y, `+${order.xpReward} xp`, {
      color: '#fff3c4',
      fontSize: 44,
    });
    buzz(FULFILL_HAPTIC_MS);

    this.orderBoard.refresh(gameState.getState());
  }

  /** Skip an order: the slot goes on cooldown and the card re-renders at once. */
  private skipOrder(slotIndex: number): void {
    if (gameState.skipOrder(slotIndex)) this.orderBoard.refresh(gameState.getState());
  }
}
