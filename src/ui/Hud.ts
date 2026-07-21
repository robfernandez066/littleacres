import Phaser from 'phaser';

import {
  ATLAS_KEY,
  BAG_POSITION,
  DESIGN_WIDTH,
  GOALS_ICON_POSITION,
  HUD_COIN_POSITION,
  HUD_MOONDUST_POSITION,
  PANEL_SLICE,
  QUEST_ICON_POSITION,
} from '../config';
import { CROPS, type CropId } from '../data/crops';
import { CURRENCY_INFO, type CurrencyId } from '../data/currencyInfo';
import { formatCurrency } from '../data/format';
import { MAX_LEVEL, xpForLevel } from '../data/levels';
import { LONG_QUESTS } from '../data/quests';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
import { buzz } from '../systems/haptics';
import { registerPulseTarget } from '../systems/pulseTargets';
import { CoinArc, MAX_COINS_PER_FLY } from './CoinArc';
import { CropArc } from './CropArc';
import { CurrencyInfoCard } from './CurrencyInfoCard';
import { FloatingText } from './FloatingText';
import type { GoalsPanel } from './GoalsPanel';
import type { MillPanel } from './MillPanel';
import { InventoryPanel } from './InventoryPanel';
import { MAX_MOONDUST_PER_FLY, MoondustArc } from './MoondustArc';
import { OrderBoard } from './OrderBoard';
import type { QuestBoard } from './QuestBoard';
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
 * HUD_COIN_POSITION and the moondust icon at HUD_MOONDUST_POSITION - the
 * shared constants CoinArc/MoondustArc also fly to (T2.23c) - so arriving
 * coins/moondust land right on their counters. HUD_COIN_POSITION.x is 110,
 * not flush against the left slice boundary (60): live review at
 * coins=100193 showed the coin icon visibly overlapping the left vine curl
 * (native x 2..51, unscaled 1:1 in the slice) at x=85 - 110 clears it with a
 * real margin. Layout budget: the crest's left overhang edge sits at
 * 540 - 160/2 = 460, so coin icon + text + gap + moondust icon + text must
 * all land left of that even at a 5-digit coin count (MEASURED live: at
 * coins=100193 the coin text alone reaches ~x=290 at this offset - moondust
 * follows with room to spare assuming a realistic 1-2 digit moondust count).
 */
const CURRENCY_ICON_SIZE = 60;
const COIN_TEXT_OFFSET_X = 50;
/** Matches COIN_TEXT_OFFSET_X so both counts left-align on their first digit. */
const MOONDUST_TEXT_OFFSET_X = 50;

/**
 * Tap targets for the coin/moondust counters (T3.13): a Zone per currency,
 * not a hitArea on the icon/text objects themselves - the text's width
 * changes with the currency's digit count, so a static hitArea on it would
 * go stale as it grows or shrinks. Each zone spans from its icon's left edge
 * (minus a pad) to just short of the next landmark on its right - the other
 * currency's icon for coins, the crest's left overhang edge (see this file's
 * own layout-budget comment above) for moondust - so neither zone can
 * swallow a tap meant for its neighbor.
 */
const CURRENCY_HIT_PAD = 15;
const CURRENCY_HIT_HEIGHT = CURRENCY_ICON_SIZE + CURRENCY_HIT_PAD * 2;
const COIN_HIT_LEFT = HUD_COIN_POSITION.x - CURRENCY_ICON_SIZE / 2 - CURRENCY_HIT_PAD;
const COIN_HIT_RIGHT = HUD_MOONDUST_POSITION.x - CURRENCY_ICON_SIZE / 2 - CURRENCY_HIT_PAD;
const MOONDUST_HIT_LEFT = COIN_HIT_RIGHT;
const MOONDUST_HIT_RIGHT = 450;

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
 * Scroll (Quests) icon (T3.10a - the scroll's reserved purpose since T2.22):
 * a bare icon at QUEST_ICON_POSITION, same size/hit-area convention as the
 * bag (`buildBareIcon` reuses BAG_OPAQUE_BOUNDS/BAG_HIT_PAD_DISPLAY_PX since
 * `scroll`, like `bag`, is a 96x96-native square icon with a few px of
 * transparent padding on the same edges).
 */
const QUEST_BADGE_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#f5c542',
  stroke: '#3a2a10',
  strokeThickness: 5,
};
/** Top-right corner of the icon (half its display size), nudged out a touch. */
const QUEST_BADGE_OFFSET = BUTTON_ICON_DISPLAY_SIZE / 2 + 6;
/** Gentle perpetual bounce, matching the notice board's "!" badge (FarmScene). */
const QUEST_BADGE_BOUNCE_OFFSET_Y = -8;
const QUEST_BADGE_BOUNCE_HALF_MS = 500;

/**
 * Goals icon (T3.30): the same bare-icon convention as the bag and scroll, at
 * GOALS_ICON_POSITION. It needs its OWN opaque bounds rather than reusing
 * BAG_OPAQUE_BOUNDS: MEASURED (Jimp opaque-bounds scan of the packed `goals`
 * frame, 96x96 native) the art spans x=[2,93], y=[0,95] - wider than the bag's
 * x=[6,89], so the bag's rectangle would clip ~4px of live art off each side.
 * (The scroll, being NARROWER than the bag, can safely keep sharing the bag's
 * bounds - a superset only ever adds slack.) See CLAUDE.md's hit-area rule.
 */
const GOALS_OPAQUE_BOUNDS = { x: 2, y: 0, w: 92, h: 96 };
/**
 * One-time discovery nudge (T3.30): a "!" badge styled and bobbed exactly like
 * the quest badge, plus a gentle scale breathe on the icon itself. Both are
 * derived from `state.goalsSeen` every tick, so opening the panel once (which
 * calls `markGoalsSeen`) clears them permanently rather than for this session.
 */
const GOALS_PULSE_SCALE = 1.12;
const GOALS_PULSE_HALF_MS = 620;

/**
 * Gear (settings) icon, hanging just below the banner's bottom edge (158) -
 * replaces the old Audio button entirely.
 */
const GEAR_X = 1000;
const GEAR_SIZE = 72;
const GEAR_Y = BANNER_BOTTOM_Y + 8 + GEAR_SIZE / 2;

/**
 * "Edit Layout" button (T3.25): one-tap toggle for arrange mode - opens it
 * from the farm, closes it while arranging (it is exempt from FarmScene's
 * arrange-mode hitbox sweep for exactly that reason) - hanging below the
 * banner left of the gear, at the gear's own y (both are
 * GEAR_SIZE display px tall). Same construction convention as the arrange
 * control rows (FarmScene.createArrangeControls): a `panel` nineslice sized
 * directly to its display bounds - so its default interactive hit area
 * already covers the full visible rectangle, satisfying the hit-area rule -
 * with a centered Arial-bold label. A custom hit area only pads the 72px
 * height out to a 96px-tall touch target (width is already well past 96).
 */
const EDIT_LAYOUT_TEXT = 'Edit Layout';
const EDIT_LAYOUT_WIDTH = 190;
const EDIT_LAYOUT_HEIGHT = 60;
/** Optical centering: the label reads a touch high in the panel without it. */
const EDIT_LAYOUT_LABEL_OFFSET_Y = 3;
/**
 * Centered between the xp bar frame's right edge and the gear's left edge,
 * so the gap to each neighbor is the same (~27px).
 */
const EDIT_LAYOUT_X = (XP_BAR_X + XP_BAR_FRAME_DISPLAY_WIDTH / 2 + GEAR_X - GEAR_SIZE / 2) / 2;
const EDIT_LAYOUT_HIT_HEIGHT = 96;
/**
 * A second tap inside this window is swallowed rather than toggling arrange
 * mode straight back: a phone tap can register as an accidental double
 * click, which would open-and-instantly-close the mode.
 */
const EDIT_LAYOUT_TOGGLE_GRACE_MS = 350;
/** Arrange-row button lettering (ARRANGE_BUTTON_STYLE), sized down for the smaller button. */
const EDIT_LAYOUT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  fontStyle: 'bold',
  color: '#4a3218',
};

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
  private readonly questContainer: Phaser.GameObjects.Container;
  private readonly questIcon: Phaser.GameObjects.Image;
  private readonly questBadge: Phaser.GameObjects.Text;
  /** Cached rails gating, mirrors `bagEnabled`. */
  private questIconEnabled = true;
  private readonly goalsContainer: Phaser.GameObjects.Container;
  private readonly goalsIcon: Phaser.GameObjects.Image;
  private readonly goalsBadge: Phaser.GameObjects.Text;
  /**
   * Cached onboarding gating for the goals icon. Unlike the bag/quest icons
   * (which stay visible but dimmed through the tutorial), this one is HIDDEN
   * outright until onboarding completes - the tutorial never mentions it and a
   * dimmed unknown icon with a "!" on it would read as a bug.
   */
  private goalsVisible = false;
  /** The unseen-menu attention breathe - see GOALS_PULSE_SCALE. Null while off. */
  private goalsPulseTween: Phaser.Tweens.Tween | null = null;
  /**
   * The Goals panel (T3.30): built by `FarmScene` (it needs scene-owned
   * callbacks - the RestorePanel opener and the camera glide) and handed in via
   * `setGoalsPanel`, exactly like `questBoard`. Null only in the window between
   * this constructor and that call; every use guards on it.
   */
  private goalsPanel: GoalsPanel | null = null;
  /**
   * The mill panel (T4.2b), handed in via `setMillPanel` exactly like
   * `goalsPanel`. Nothing in the HUD OPENS it - the mill on the field does
   * (`FarmScene.openMillPanel`) - but it joins the panel-exclusivity set here
   * so opening any HUD panel closes it, and it refreshes on the tick while
   * visible, which is what makes its countdowns live.
   */
  private millPanel: MillPanel | null = null;
  private readonly arrangeContainer: Phaser.GameObjects.Container;
  private readonly arrangeButton: Phaser.GameObjects.NineSlice;
  /** Cached rails gating, mirrors `bagEnabled`. */
  private arrangeEnabled = true;
  /** Timestamp of the last accepted "Edit Layout" tap - see EDIT_LAYOUT_TOGGLE_GRACE_MS. */
  private lastArrangeToggleAt = 0;
  /** The "plots waiting in the shed" pulse (T3.3a) - see `setArrangeFlash`. Null while off. */
  private arrangeFlashTween: Phaser.Tweens.Tween | null = null;
  /**
   * The Quest Board panel (T3.10a): constructed by `FarmScene` (it needs a
   * `Hud` reference for its own claim-reward juice - see `flyQuestReward`)
   * and handed in via `setQuestBoard` once both exist, mirroring how
   * `ChestCeremony` receives `Hud` the other direction. Null only in the
   * brief window between this class's own constructor (which calls
   * `refresh()` once) and `FarmScene` calling `setQuestBoard` right after -
   * every method here guards on it defensively.
   */
  private questBoard: QuestBoard | null = null;
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

  /**
   * Animated display value; ticks toward `gameState`'s true moondust count -
   * mirrors `coinDisplay` exactly (T2.23c).
   */
  private readonly moondustDisplay = { value: 0 };
  private moondustTween: Phaser.Tweens.Tween | null = null;
  /** While true, the periodic refresh leaves the moondust ticker to in-flight moondust arcs. */
  private moondustArcsAnimating = false;
  /**
   * Same hold-during-a-deferred-ceremony gate as `chestPending`, for
   * moondust: a chest's bonus moondust is granted to state instantly at
   * fulfillment but its arc doesn't fly until the ceremony's dismiss beat,
   * which may be many ticks away. Set synchronously in `fulfillOrder`
   * alongside `chestPending` via `holdMoondustDisplay`; cleared the instant
   * `flyChestMoondust` runs.
   */
  private moondustPending = false;

  private bagBounceTween: Phaser.Tweens.Tween | null = null;
  private readonly settingsPanel: SettingsPanel;
  private readonly currencyInfoCard: CurrencyInfoCard;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly coinArc: CoinArc,
    private readonly moondustArc: MoondustArc,
    private readonly floatingText: FloatingText,
    private readonly audio: AudioManager,
    private readonly onToggleArrange: () => void,
  ) {
    this.coinDisplay.value = gameState.getState().coins;
    this.moondustDisplay.value = gameState.getState().moondust;

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
      .image(HUD_MOONDUST_POSITION.x, HUD_MOONDUST_POSITION.y, ATLAS_KEY, 'moondust')
      .setDisplaySize(CURRENCY_ICON_SIZE, CURRENCY_ICON_SIZE)
      .setDepth(HUD_DEPTH);
    this.moondustText = this.scene.add
      .text(
        HUD_MOONDUST_POSITION.x + MOONDUST_TEXT_OFFSET_X,
        HUD_MOONDUST_POSITION.y,
        formatCurrency(this.moondustDisplay.value),
        CURRENCY_STYLE,
      )
      .setOrigin(0, 0.5)
      .setDepth(HUD_DEPTH);

    // Currency info cards (T3.13): each counter (icon + text) is a tap
    // target opening its CurrencyInfoCard.
    this.currencyInfoCard = new CurrencyInfoCard(this.scene, this.audio);
    this.buildCurrencyHitZone(COIN_HIT_LEFT, COIN_HIT_RIGHT, 'coins');
    this.buildCurrencyHitZone(MOONDUST_HIT_LEFT, MOONDUST_HIT_RIGHT, 'moondust');

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
      this.questBoard?.hide();
      this.goalsPanel?.hide();
      this.millPanel?.hide();
      this.currencyInfoCard.hide();
      this.settingsPanel.toggle();
    });

    // "Edit Layout" button (T3.25): toggles arrange mode - opens it directly
    // (skipping the farmhouse -> Decor Shop -> "Arrange Farm" path, which
    // stays), and closes it again while arranging (FarmScene exempts it from
    // the arrange-mode hitbox sweep so it stays tappable there).
    // Rails-gated on 'decor-shop' like the shop itself (see applyRailsGating).
    // Container so rails dimming fades the panel and its label together.
    this.arrangeContainer = this.scene.add.container(EDIT_LAYOUT_X, GEAR_Y).setDepth(HUD_DEPTH);
    this.arrangeButton = this.scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      EDIT_LAYOUT_WIDTH,
      EDIT_LAYOUT_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    // Local-space hit area (0,0 at the nineslice's own top-left): full width,
    // padded symmetrically past the 72px art to a 96px-tall touch target.
    this.arrangeButton.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(
        0,
        -(EDIT_LAYOUT_HIT_HEIGHT - EDIT_LAYOUT_HEIGHT) / 2,
        EDIT_LAYOUT_WIDTH,
        EDIT_LAYOUT_HIT_HEIGHT,
      ),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    const arrangeLabel = this.scene.add
      .text(0, EDIT_LAYOUT_LABEL_OFFSET_Y, EDIT_LAYOUT_TEXT, EDIT_LAYOUT_STYLE)
      .setOrigin(0.5);
    this.arrangeContainer.add([this.arrangeButton, arrangeLabel]);
    this.arrangeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      // Swallow the second half of an accidental double tap (real timestamp,
      // per the time-from-timestamps rule) instead of instantly re-toggling.
      const now = Date.now();
      if (now - this.lastArrangeToggleAt < EDIT_LAYOUT_TOGGLE_GRACE_MS) return;
      this.lastArrangeToggleAt = now;
      this.audio.sfx('tap');
      this.closePanels();
      this.onToggleArrange();
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
      this.questBoard?.hide();
      this.goalsPanel?.hide();
      this.millPanel?.hide();
      this.currencyInfoCard.hide();
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

    // Scroll (Quests) icon (T3.10a): same bare-icon convention as the bag,
    // left of it on the banner. Fully tutorial-inert (`railsAllow`'s
    // 'quest-board' case is always false pre-completion, like 'decor-shop'),
    // so unlike the bag it registers no pulse target - the tutorial never
    // has a step that could point at it.
    this.questContainer = this.scene.add
      .container(QUEST_ICON_POSITION.x, QUEST_ICON_POSITION.y)
      .setDepth(HUD_DEPTH);
    this.questIcon = this.buildBareIcon('scroll');
    this.questContainer.add(this.questIcon);
    this.questIcon.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.inventoryPanel.hide();
      this.orderBoard.hide();
      this.settingsPanel.hide();
      this.currencyInfoCard.hide();
      this.questBoard?.toggle(gameState.getState());
    });
    // Claimable "!" badge (T3.10a): gold Georgia bold, stroked, bobbing at
    // the icon's top-right corner - mirrors the notice board's "!" badge
    // (FarmScene.createNoticeBoard) exactly, styling and bounce alike.
    // Visibility is re-derived every refresh tick (`anyQuestClaimable`), not
    // toggled here.
    this.questBadge = this.scene.add
      .text(
        QUEST_ICON_POSITION.x + QUEST_BADGE_OFFSET,
        QUEST_ICON_POSITION.y - QUEST_BADGE_OFFSET,
        '!',
        QUEST_BADGE_TEXT_STYLE,
      )
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH + 1)
      .setVisible(false);
    this.scene.tweens.add({
      targets: this.questBadge,
      y: QUEST_ICON_POSITION.y - QUEST_BADGE_OFFSET + QUEST_BADGE_BOUNCE_OFFSET_Y,
      duration: QUEST_BADGE_BOUNCE_HALF_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Goals icon (T3.30): the third bare icon on the banner row, right of the
    // bag. Hidden until onboarding completes (see `goalsVisible`), so it is
    // built invisible and inert and `applyGoalsVisibility` turns it on.
    this.goalsContainer = this.scene.add
      .container(GOALS_ICON_POSITION.x, GOALS_ICON_POSITION.y)
      .setDepth(HUD_DEPTH)
      .setVisible(false);
    this.goalsIcon = this.buildBareIcon('goals', GOALS_OPAQUE_BOUNDS);
    this.goalsIcon.disableInteractive();
    this.goalsContainer.add(this.goalsIcon);
    this.goalsIcon.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.inventoryPanel.hide();
      this.orderBoard.hide();
      this.settingsPanel.hide();
      this.questBoard?.hide();
      this.millPanel?.hide();
      this.currencyInfoCard.hide();
      // Deliberately does NOT hide itself first (unlike the other panels this
      // closes): that would turn a second tap into a re-open instead of a
      // close. `show` (inside toggle) is what calls markGoalsSeen - the badge
      // and pulse then clear on the very next refresh tick.
      this.goalsPanel?.toggle(gameState.getState());
    });
    // Discovery "!" badge: same style, corner offset and bob as the quest
    // badge above. Visibility is re-derived every tick from `goalsSeen`.
    this.goalsBadge = this.scene.add
      .text(
        GOALS_ICON_POSITION.x + QUEST_BADGE_OFFSET,
        GOALS_ICON_POSITION.y - QUEST_BADGE_OFFSET,
        '!',
        QUEST_BADGE_TEXT_STYLE,
      )
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH + 1)
      .setVisible(false);
    this.scene.tweens.add({
      targets: this.goalsBadge,
      y: GOALS_ICON_POSITION.y - QUEST_BADGE_OFFSET + QUEST_BADGE_BOUNCE_OFFSET_Y,
      duration: QUEST_BADGE_BOUNCE_HALF_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

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
    this.questBoard?.hide();
    this.goalsPanel?.hide();
    this.millPanel?.hide();
    this.currencyInfoCard.hide();
    this.orderBoard.toggle(gameState.getState());
  }

  /**
   * Close every Hud-owned panel (bag/orders/settings/quests) - used when an
   * externally owned modal exclusive with them (the crop info card, T2.15;
   * the Decor Shop, T3.9) opens, mirroring the same closing calls
   * `toggleOrderBoard` and the bag/gear/quest handlers already make for
   * each other.
   */
  closePanels(): void {
    this.inventoryPanel.hide();
    this.orderBoard.hide();
    this.settingsPanel.hide();
    this.questBoard?.hide();
    this.goalsPanel?.hide();
    this.millPanel?.hide();
    this.currencyInfoCard.hide();
  }

  /**
   * Wire the Quest Board panel (T3.10a): `FarmScene` constructs it (it needs
   * a `Hud` reference of its own for claim-reward juice, so it cannot be
   * built inside this constructor without a cycle) and hands the instance in
   * right after, before the scene's first refresh tick. From here on the
   * scroll icon's toggle, the claimable badge, and `refresh`'s per-tick
   * `questBoard.refresh` all go through this reference.
   */
  setQuestBoard(panel: QuestBoard): void {
    this.questBoard = panel;
  }

  /**
   * Wire the Goals panel (T3.30) - same handoff as `setQuestBoard`: `FarmScene`
   * builds it (it needs the scene's own RestorePanel opener and camera glide)
   * and hands it in right after this constructor, before the first refresh tick.
   */
  setGoalsPanel(panel: GoalsPanel): void {
    this.goalsPanel = panel;
  }

  /**
   * Wire the Mill panel (T4.2b) - same handoff as `setGoalsPanel`. The panel is
   * opened by the mill on the field, never by a HUD control; the HUD holds it
   * only to keep panel exclusivity honest and to tick its countdowns.
   */
  setMillPanel(panel: MillPanel): void {
    this.millPanel = panel;
  }

  /**
   * The "Edit Layout" toggle's interactive object, for FarmScene's
   * arrange-mode exempt list: unlike every other HUD control, this one must
   * stay tappable WHILE arranging - it is the close control too.
   */
  getArrangeToggleButton(): Phaser.GameObjects.GameObject {
    return this.arrangeButton;
  }

  /**
   * Pulse the "Edit Layout" button while plots wait in the shed (T3.3a): a
   * gentle perpetual alpha breathe on the whole container, the same
   * yoyo-tween pattern as the ready-crop bounce and badge bobs. FarmScene
   * drives this from state on its refresh tick (on while `unplacedPlots > 0`
   * and neither the grant popup nor arrange mode is up); idempotent - repeat
   * calls with the same value are no-ops. Turning it off restores the
   * rails-gated resting alpha.
   */
  setArrangeFlash(flashing: boolean): void {
    if (flashing === (this.arrangeFlashTween !== null)) return;
    if (flashing) {
      this.arrangeFlashTween = this.scene.tweens.add({
        targets: this.arrangeContainer,
        alpha: 0.35,
        duration: 450,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      this.arrangeFlashTween?.stop();
      this.arrangeFlashTween = null;
      this.arrangeContainer.setAlpha(this.arrangeEnabled ? 1 : BUTTON_INERT_ALPHA);
    }
  }

  /**
   * Fly a quest reward's moondust from the claiming row's world position to
   * the HUD counter (T3.10a) - `gameState.claimQuest` grants it to state
   * instantly with no animation of its own (a chest reward rides the
   * existing ceremony queue instead; a trophy flashes locally on its row),
   * so `QuestBoard` calls this the same way `ChestCeremony` calls
   * `flyChestCoins`/`flyChestMoondust`.
   */
  flyQuestReward(worldX: number, worldY: number, before: number, gained: number): void {
    this.flyMoondustToCounter([{ x: worldX, y: worldY, count: gained }], before, gained);
  }

  /**
   * A bare, centered icon (no background frame, no label - the tutorial's
   * glow teaches it) with a hit area covering its own measured opaque
   * bounds plus a pad - see BAG_OPAQUE_BOUNDS's comment. FRAME-relative
   * (0,0 at the icon's own native top-left), never centered on the object's
   * origin/position - see CLAUDE.md's hit-area rule.
   */
  private buildBareIcon(
    iconFrame: string,
    /** This frame's own MEASURED opaque bounds; defaults to the bag's, which
     *  the (narrower) scroll safely shares - see GOALS_OPAQUE_BOUNDS. */
    bounds: { x: number; y: number; w: number; h: number } = BAG_OPAQUE_BOUNDS,
  ): Phaser.GameObjects.Image {
    const scale = BUTTON_ICON_DISPLAY_SIZE / BAG_ICON_NATIVE_SIZE;
    const pad = BAG_HIT_PAD_DISPLAY_PX / scale;
    return this.scene.add
      .image(0, 0, ATLAS_KEY, iconFrame)
      .setDisplaySize(BUTTON_ICON_DISPLAY_SIZE, BUTTON_ICON_DISPLAY_SIZE)
      .setInteractive({
        hitArea: new Phaser.Geom.Rectangle(
          bounds.x - pad,
          bounds.y - pad,
          bounds.w + pad * 2,
          bounds.h + pad * 2,
        ),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
  }

  /** A tap target Zone covering a currency counter's icon + text; opens its info card on tap. */
  private buildCurrencyHitZone(left: number, right: number, id: CurrencyId): void {
    const anchorX = (left + right) / 2;
    const zone = this.scene.add
      .zone(left, HUD_COIN_POSITION.y, right - left, CURRENCY_HIT_HEIGHT)
      .setOrigin(0, 0.5)
      .setDepth(HUD_DEPTH + 1)
      .setInteractive({ useHandCursor: true });
    zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.openCurrencyCard(id, anchorX));
  }

  /**
   * Open a currency's info card, closing the other Hud panels first (same
   * exclusivity convention as the bag/gear/quest icons). Inert during the
   * tutorial rails - simplest correct behavior per T3.13, no new rails action.
   * `anchorX` (this counter's own hit zone's center) and `BANNER_BOTTOM_Y`
   * (the HUD banner's own bottom edge) anchor the popup directly below the
   * tapped counter.
   */
  private openCurrencyCard(id: CurrencyId, anchorX: number): void {
    if (!gameState.getState().onboarding.completed) return;
    this.audio.sfx('tap');
    this.closePanels();
    this.currencyInfoCard.show(CURRENCY_INFO[id], anchorX, BANNER_BOTTOM_Y);
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

    if (!this.coinArcsAnimating && !this.chestPending) this.driftCoinsTo(state.coins);
    if (!this.moondustArcsAnimating && !this.moondustPending) this.driftMoondustTo(state.moondust);

    this.inventoryPanel.refresh(state);
    this.orderBoard.refresh(state);
    this.questBoard?.refresh(state);
    this.goalsPanel?.refresh(state);
    // Only while visible: this is the tick that counts its batches down, and a
    // hidden mill panel has no building bound to refresh from.
    if (this.millPanel?.isVisible() === true) this.millPanel.refresh(state);
    // Re-derives its controls from state so a dev import/reset re-renders it.
    this.settingsPanel.refresh();

    this.questBadge.setVisible(this.anyQuestClaimable(state));

    this.applyGoalsVisibility(state);
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
    const questAllowed = gameState.railsAllow('quest-board');
    if (questAllowed !== this.questIconEnabled) {
      this.questIconEnabled = questAllowed;
      this.questContainer.setAlpha(questAllowed ? 1 : BUTTON_INERT_ALPHA);
      if (questAllowed) {
        this.questIcon.setInteractive();
      } else {
        this.questIcon.disableInteractive();
      }
    }
    const arrangeAllowed = gameState.railsAllow('decor-shop');
    if (arrangeAllowed !== this.arrangeEnabled) {
      this.arrangeEnabled = arrangeAllowed;
      this.arrangeContainer.setAlpha(arrangeAllowed ? 1 : BUTTON_INERT_ALPHA);
      if (arrangeAllowed) {
        // No-arg re-enable so the padded 96px-tall hit area survives - same
        // rationale as the bag above.
        this.arrangeButton.setInteractive();
      } else {
        this.arrangeButton.disableInteractive();
      }
    }
  }

  /**
   * The goals icon's per-tick gating (T3.30): the button (and therefore its
   * panel) exists only after onboarding completes, and the discovery nudge -
   * "!" badge plus attention breathe - runs only while the menu is unseen.
   * Both are re-derived from state rather than toggled at the tap, so the
   * `markGoalsSeen` write clears them permanently and a dev reset re-arms them.
   */
  private applyGoalsVisibility(state: GameStateData): void {
    const visible = state.onboarding.completed;
    if (visible !== this.goalsVisible) {
      this.goalsVisible = visible;
      this.goalsContainer.setVisible(visible);
      if (visible) {
        // No-arg re-enable so the measured hit area set at construction
        // survives - same rationale as the bag's in `applyRailsGating`.
        this.goalsIcon.setInteractive();
      } else {
        this.goalsIcon.disableInteractive();
        this.goalsPanel?.hide();
      }
    }
    const nudging = visible && !state.goalsSeen;
    this.goalsBadge.setVisible(nudging);
    this.setGoalsPulse(nudging);
  }

  /** The unseen-menu attention breathe; idempotent, and restores scale 1 when off. */
  private setGoalsPulse(pulsing: boolean): void {
    if (pulsing === (this.goalsPulseTween !== null)) return;
    if (pulsing) {
      this.goalsPulseTween = this.scene.tweens.add({
        targets: this.goalsContainer,
        scale: GOALS_PULSE_SCALE,
        duration: GOALS_PULSE_HALF_MS,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      this.goalsPulseTween?.stop();
      this.goalsPulseTween = null;
      this.goalsContainer.setScale(1);
    }
  }

  /**
   * Whether the "!" badge should show: any LONG_QUESTS def complete and
   * unclaimed, or any currently-active weekly quest complete and unclaimed -
   * hidden outright during the tutorial (mirrors the notice board badge's
   * own `onboarding.completed` gate) since the board itself is tutorial-inert.
   */
  private anyQuestClaimable(state: GameStateData): boolean {
    if (!state.onboarding.completed) return false;
    for (const def of LONG_QUESTS) {
      const progress = gameState.questProgress(def.id);
      if (progress?.complete && !progress.claimed) return true;
    }
    for (const id of state.quests.weekly.activeIds) {
      const progress = gameState.questProgress(id);
      if (progress?.complete && !progress.claimed) return true;
    }
    return false;
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

  /** Tween the moondust display toward `target`; a no-op if already there. Mirrors `driftCoinsTo`. */
  private driftMoondustTo(target: number): void {
    if (Math.round(this.moondustDisplay.value) === target) return;
    this.moondustTween?.stop();
    this.moondustTween = this.scene.tweens.add({
      targets: this.moondustDisplay,
      value: target,
      duration: COIN_DRIFT_DURATION_MS,
      ease: 'Sine.easeOut',
      onUpdate: () => this.moondustText.setText(formatCurrency(this.moondustDisplay.value)),
    });
  }

  /**
   * Suspend the moondust display's normal drift-toward-state tween without
   * starting a flight - mirrors `holdCoinDisplay` exactly (T2.23c), for the
   * same reason: a chest's bonus moondust grants to state instantly at
   * fulfillment (see `gameState.fulfillOrder`/`grantChests`), well before the
   * ceremony celebrating it reaches its dismiss beat and actually flies it.
   */
  holdMoondustDisplay(): void {
    this.moondustPending = true;
  }

  /**
   * Fly a multi-chest event's already-granted moondust to the HUD counter.
   * Unlike `flyChestCoins` (one combined arc - the ceremony sums every
   * chest's coins into a single launch point), each chest shows its own
   * moondust icon, so `origins` carries one launch point + count per chest
   * that actually rolled moondust > 0; every arrival across every origin
   * shares one ticker and one final true-up to `before + totalGained`.
   * `before` is the moondust total immediately prior to the chest grant (see
   * `holdMoondustDisplay`, which must have been called when that grant
   * happened).
   */
  flyChestMoondust(
    origins: readonly { x: number; y: number; count: number }[],
    before: number,
    totalGained: number,
  ): void {
    this.moondustPending = false;
    if (totalGained <= 0) {
      this.moondustArcsAnimating = false;
      return;
    }
    this.flyMoondustToCounter(origins, before, totalGained);
  }

  /**
   * Batched moondust arcs from one or more origins to the HUD moondust
   * counter, with an equal per-arrival ticker bump shared across every
   * origin and a final true-up to `before + totalGained` on the very last
   * arrival - mirrors `flyCoinsToCounter`, generalized to more than one
   * launch point.
   */
  private flyMoondustToCounter(
    origins: readonly { x: number; y: number; count: number }[],
    before: number,
    totalGained: number,
  ): void {
    this.moondustTween?.stop();
    this.moondustArcsAnimating = true;
    const target = before + totalGained;
    const arrivals = origins.reduce(
      (sum, origin) => sum + Math.min(Math.max(origin.count, 0), MAX_MOONDUST_PER_FLY),
      0,
    );
    const share = Math.floor(totalGained / arrivals);
    let arrived = 0;

    for (const origin of origins) {
      if (origin.count <= 0) continue;
      this.moondustArc.fly(origin.x, origin.y, origin.count, () => {
        arrived++;
        this.moondustDisplay.value =
          arrived >= arrivals ? target : this.moondustDisplay.value + share;
        this.moondustText.setText(formatCurrency(this.moondustDisplay.value));
        if (arrived >= arrivals) this.moondustArcsAnimating = false;
      });
    }
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
   * choreography, a premium order's own moondust reward arcs there too
   * (T2.23c - from the same world point the coins launch from), a floating
   * "+N xp" label, and a medium buzz. Level-ups queued by the payout ride the
   * existing celebration flow on the next refresh tick; a chest event
   * (T2.23a - `order.premium.chests`) rides its own ceremony the same way -
   * its bonus coins AND moondust - but must hold both displays here,
   * synchronously in this same call, before any refresh tick can see the
   * chest's already-granted totals - see `holdCoinDisplay`/
   * `holdMoondustDisplay`'s comments. The order's OWN moondust reward is
   * never held, even when chests are present: it flies immediately here,
   * exactly like the order's own coinReward - only the chest's bonus on top
   * of it is deferred.
   */
  private fulfillOrder(slotIndex: number, worldX: number, worldY: number): void {
    const slot = gameState.getState().orders[slotIndex];
    if (slot === undefined || slot.state !== 'open') return;
    const { order } = slot;
    const coinsBefore = gameState.getState().coins;
    const moondustBefore = gameState.getState().moondust;
    if (!gameState.fulfillOrder(slotIndex)) return;
    if (order.premium?.chests) {
      this.holdCoinDisplay();
      this.holdMoondustDisplay();
    }

    this.orderBoard.playFulfillJuice(slotIndex, order);
    this.flyCoinsToCounter(worldX, worldY, coinsBefore, order.coinReward);
    if (order.premium) {
      this.flyMoondustToCounter(
        [{ x: worldX, y: worldY, count: order.premium.moondust }],
        moondustBefore,
        order.premium.moondust,
      );
    }
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
