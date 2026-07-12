import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE, VILLAGER_POSITION } from '../config';
import { CROP_BASELINE_Y, CROP_FRAME_SIZE, CROPS } from '../data/crops';
import { type Order, ORDER_SLOTS } from '../data/orders';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { registerPoolStats } from '../systems/pool';
import { registerPulseTarget } from '../systems/pulseTargets';
import { now } from '../systems/time';
import { ModalBackdrop } from './ModalBackdrop';
import { PooledArc } from './PooledArc';

/**
 * Modal-style order board: three cards, one per order slot. An open card
 * shows the requested items ("have/need", colored by coverage), the stored
 * rewards, and Fulfill/Skip buttons; a cooldown card counts down to its next
 * order. Toggled by the HUD's Orders button; renders purely from the
 * `GameStateData` passed to `refresh` (cooldown seconds derive from `now()`
 * on the scene's 250ms refresh tick), plus the store's tutorial-rails
 * `railsAllow` query for the Skip buttons' dim/inert state.
 *
 * State mutation happens in the HUD's callbacks, never here; this class owns
 * only board visuals, including the fulfilled-goods flight to the villager.
 */

const PANEL_WIDTH = 960;
/**
 * Grown from 1080 (+240, matching CARD_HEIGHT's +80 x 3 cards) alongside the
 * card layout below - see CARD_HEIGHT for why. Title/margin gaps are
 * preserved exactly: CARD_START_Y and CARD_SPACING grew by the same amount.
 */
const PANEL_HEIGHT = 1320;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 960;
/** Same layer as the inventory panel (2100) - the HUD never shows both at once. */
const PANEL_DEPTH = 2100;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;

const CARD_WIDTH = 880;
/**
 * Grown from 280 (+80, see T2.20) to fit the "Reward:" label between the
 * item-cluster band and the reward row (all cards) and to let the reward row
 * sit near the card's bottom border (REWARD_ROW_Y) without crowding the
 * relocated buttons - see REWARD_ROW_Y and FULFILL_BUTTON_Y/SKIP_BUTTON_Y.
 */
const CARD_HEIGHT = 360;
const CARD_START_Y = -380;
const CARD_SPACING = 380;

/**
 * Requested items render as up to 3 "clusters" on one horizontal band,
 * vertically where the old two stacked item rows used to sit: icon + count
 * side by side (as a pair), crop name centered underneath. Size shrinks as
 * item-type count grows so 1, 2, or 3 types all read clearly.
 *
 * Left-flow layout (T2.20e): clusters no longer sit at fixed centers. The
 * first cluster's measured visual left edge - whichever of the icon+count
 * pair or the name text is wider, they're both centered on the same x -
 * aligns to CLUSTER_LEFT_MARGIN, the same content margin the premium tag
 * uses. Each subsequent cluster's left edge sits CLUSTER_ROW_GAP past the
 * previous cluster's measured right edge. This is all computed from actual
 * rendered widths every refresh (pairWidth/nameWidth below), never guessed,
 * so it stays correct regardless of digit count or crop name length. See
 * T2.20e's measured-bounds report for the button-clearance verification.
 *
 * Icons are baseline-anchored (setOrigin(0.5, CROP_BASELINE_Y /
 * CROP_FRAME_SIZE), same convention FarmScene uses for planted crops) rather
 * than center-anchored, because the ready-stage art is packed with a fixed
 * baseline row but each crop's opaque content sits at a different height
 * within the frame - center-anchoring made crops of different silhouettes
 * render at visibly different heights. Baseline-anchoring puts every crop's
 * ready-stage frame (measured directly from assets/atlas.png: opaque pixels
 * span rows 1-118 of the 128px frame for all 3 crops today, content center
 * at row 59.5) on one shared ground line, all crops equal.
 *
 * CLUSTER_BASELINE_Y moved down from -35 (T2.20d) to clear the premium tag
 * above it, which itself moved down to clear the card frame's painted rim -
 * see PREMIUM_TAG_TOP_MARGIN and T2.20d's measured-bounds report for the
 * pixel-scanned verification (tier-1's icon top vs. the tag's bottom).
 */
const CLUSTER_BASELINE_Y = -12;
/**
 * Rows (unscaled frame space) from the baseline anchor (row CROP_BASELINE_Y
 * = 104) up to the visual content center (row 59.5, measured as above):
 * 104 - 59.5 = 44.5. Scaled by each tier's iconScale to vertically center
 * the count text on the icon's rendered content, not its padded frame.
 */
const CLUSTER_ICON_CONTENT_OFFSET = 44.5;
/** Gap between the icon's rendered bottom edge and the name text below it. */
const CLUSTER_NAME_GAP = 10;
/** Approximates half a single line's rendered height for Arial bold. */
const CLUSTER_NAME_HALF_HEIGHT_FACTOR = 0.55;

interface ClusterTier {
  iconScale: number;
  countFontSize: number;
  nameFontSize: number;
  /** Horizontal gap between the icon and the count text within one cluster. */
  gap: number;
}

/** Indexed by item-type count - 1. Order generates 1-2 types today; the
 * 3-tier is future-proofing for a later "Major Shipments" system. */
const CLUSTER_TIERS: readonly ClusterTier[] = [
  { iconScale: 0.8, countFontSize: 44, nameFontSize: 30, gap: 12 },
  { iconScale: 0.72, countFontSize: 40, nameFontSize: 26, gap: 10 },
  { iconScale: 0.45, countFontSize: 30, nameFontSize: 22, gap: 8 },
];
/**
 * Gap between one cluster's measured right edge and the next's measured left
 * edge, indexed by item-type count - 1 (tier 0/single-item never has a next
 * cluster, so its entry is unused). Starting values 48/32 per T2.20e,
 * pixel/metric-verified to still clear the button column - see the
 * measured-bounds report.
 */
const CLUSTER_ROW_GAP: readonly number[] = [0, 48, 32];
/** More than 3 item types (not generated today) renders only the first 3. */
const MAX_CLUSTERS = 3;

/**
 * Reward row: three FIXED columns, left to right [xp] [coin] [moondust], so
 * the two currencies sit adjacent and nothing re-arranges when moondust is
 * absent (its column just hides) - see T2.20a. Y moved down (was 90) so the
 * row's bottom edge (the coin icon's, the tallest element) clears the card's
 * bottom border (CARD_HEIGHT / 2 = 180) by ~24px: 180 - 21.6 - 134 = 24.4.
 * X positions are measured-verified against the widest realistic values (a
 * 4-digit coin reward, "9999" at REWARD_COIN_STYLE's 38px bold - about 92px)
 * so no column ever overlaps its neighbor or the relocated button column
 * (left edge at local x 176, see FULFILL_BUTTON_X/WIDTH below):
 *   xp   -360 .. ~-170  (up to "+9999 xp", ~190px)
 *   coin icon -140 (±21.6), text -105 .. ~-13  ("9999", ~92px)
 *   moondust icon 30 (±19.2), text 58 .. ~130  ("+99", generous)
 * leaving >45px clearance to the button column in the worst case.
 */
const REWARD_ROW_Y = 134;
const REWARD_XP_TEXT_X = -360;
const REWARD_COIN_ICON_X = -140;
const REWARD_COIN_SCALE = 0.45;
const REWARD_COIN_TEXT_X = -105;
const REWARD_MOONDUST_SCALE = 0.4;
const REWARD_MOONDUST_ICON_X = 30;
const REWARD_MOONDUST_TEXT_X = 58;

/** Left-aligned above the reward row's leftmost column (xp), on every card. */
const REWARD_LABEL_CLEARANCE = 6;

/**
 * Chest reward line (T2.23a): on a chest-carrying premium card only, a
 * chest_closed icon + "N Treasure Chest(s)" beneath the reward row. The
 * whole reward row (and its "Reward:" label) shifts up by CHEST_LINE_NUDGE_Y
 * on such cards ONLY, to make room below - MEASURED and live-verified
 * against TWO competing clearances (a taller nudge helps one and hurts the
 * other, so both the nudge and the chest line's own footprint had to move):
 * - Bottom: the card's own border (CARD_HEIGHT / 2 = 180 from center) below
 *   the chest line.
 * - Top: the single-item cluster's name text (e.g. "Sunwheat", bottom edge
 *   ~50 from center) below the nudged "Reward:" label - too tall a nudge
 *   pushes the row (and its label, which tracks it at a fixed
 *   REWARD_LABEL_CLEARANCE gap) up into that name text instead.
 * A first pass (nudge 30, full-size chest icon/gap) left the bottom too
 * tight; nudging further to clear it (46) then crowded the top instead - the
 * two constraints don't overlap at the original chest-line size at all.
 * Shrinking the chest line itself (icon scale 0.3 -> 0.24, gap 10 -> 6) freed
 * enough room that nudge 20 clears both, confirmed live.
 */
const CHEST_LINE_NUDGE_Y = 20;
const CHEST_LINE_GAP = 6;
const CHEST_ICON_SCALE = 0.24;
const CHEST_LINE_ICON_TEXT_GAP = 10;

/** Premium signal: the card's own bg nineslice tints light moondust blue
 * (cleared on non-premium/cooldown/pending) plus a small "Premium Order" tag
 * where the (now-removed) flavor line used to sit. */
const PREMIUM_BG_TINT = 0xdce8ff;
/**
 * Tag top margin from the card's own top edge and left inset from the card's
 * left edge - verified against RENDERED PIXELS (T2.20d), not PANEL_SLICE:
 * the nineslice frame's painted dark rim extends past the slice inset, so
 * slice-based math alone under-clears it. See T2.20d's measured-bounds
 * report for the final pixel-verified values and how they were checked.
 */
const PREMIUM_TAG_TOP_MARGIN = 44;
const PREMIUM_TAG_LEFT_INSET = 36;

/**
 * The item-cluster band's left-flow anchor (T2.20e) - the same content
 * margin the premium tag uses, so a single-item order's cluster sits
 * directly under the tag position on every card, premium or not.
 */
const CLUSTER_LEFT_MARGIN = -CARD_WIDTH / 2 + PREMIUM_TAG_LEFT_INSET;

/** Right edge sits ~24px inside the card's right border (440): 440-24-120. */
const FULFILL_BUTTON_X = 296;
const FULFILL_BUTTON_Y = -60;
const FULFILL_BUTTON_WIDTH = 240;
const FULFILL_BUTTON_HEIGHT = 100;
const SKIP_BUTTON_X = 296;
/** 24px below fulfillButton's bottom edge (-10): 14 (skip top) + 40 (half height). */
const SKIP_BUTTON_Y = 54;
const SKIP_BUTTON_WIDTH = 240;
const SKIP_BUTTON_HEIGHT = 80;

const BUTTON_ENABLED_ALPHA = 1;
const BUTTON_DISABLED_ALPHA = 0.4;

/** Onboarding highlight bounds around the close (X) control (padded text). */
const CLOSE_TARGET_SIZE = 90;

/** Item count colors: covered by inventory vs still short. */
const COVERED_COLOR = '#2e7d32';
const SHORT_COLOR = '#b0483a';

/** The "Done!" stamp: quick scale-in, brief hold, fade - one beat. */
const STAMP_IN_MS = 150;
const STAMP_HOLD_MS = 250;
const STAMP_FADE_MS = 250;

/** Villager flights shrink en route like the other arcs. */
const VILLAGER_ARC_DEPTH = 2200;
const VILLAGER_ARC_START_SCALE = 0.5;
const VILLAGER_ARC_END_SCALE = 0.25;
/** Cap per item so a 12-unit request reads as a batch, not a swarm. */
const MAX_GOODS_PER_ITEM = 6;

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

/** Crop names stay in the panel's dark brown - always readable on the cream
 * card; only the have/need count carries the coverage color. */
const ITEM_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const ITEM_COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: COVERED_COLOR,
};

const REWARD_COIN_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '38px',
  fontStyle: 'bold',
  color: '#4a3218',
};

// Identical to the coin value's style: the reward row reads as one matched
// pair, not a primary and an afterthought (user calls, 2026-07-10).
const REWARD_XP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '38px',
  fontStyle: 'bold',
  color: '#4a3218',
};

// Same style family as the coin/xp reward values (see REWARD_COIN_STYLE) -
// the moondust value reads as a third matched peer, not an afterthought.
const REWARD_MOONDUST_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '38px',
  fontStyle: 'bold',
  color: '#4a3218',
};

// Distinct display voice against the game's Arial UI - no webfont loading,
// Georgia is a system serif available everywhere.
const PREMIUM_TAG_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '30px',
  fontStyle: 'bold italic',
  color: '#3a4a8a',
};

// Same Georgia voice as the premium tag (T2.23a), non-italic so "N Treasure
// Chest(s)" reads as a reward line, not another decorative label.
const CHEST_LINE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const REWARD_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  fontStyle: 'italic',
  color: '#7a5518',
};

const BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const SKIP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  color: '#4a3218',
};

const COOLDOWN_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  color: '#8a7350',
};

const STAMP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '72px',
  fontStyle: 'bold',
  color: COVERED_COLOR,
  stroke: '#fff8e1',
  strokeThickness: 8,
};

interface ItemCluster {
  icon: Phaser.GameObjects.Image;
  countText: Phaser.GameObjects.Text;
  nameText: Phaser.GameObjects.Text;
}

interface OrderCard {
  /** Card body nineslice - tinted PREMIUM_BG_TINT on premium, clearTint otherwise. */
  cardBg: Phaser.GameObjects.NineSlice;
  /** "Premium Order" tag, top of card, where the flavor line used to sit. */
  premiumTag: Phaser.GameObjects.Text;
  clusters: ItemCluster[];
  /** "Reward:" caption above the reward row, shown on every open card. */
  rewardLabel: Phaser.GameObjects.Text;
  rewardXpText: Phaser.GameObjects.Text;
  rewardCoin: Phaser.GameObjects.Image;
  rewardCoinText: Phaser.GameObjects.Text;
  /** Third reward column, right of coin - premium orders only. */
  rewardMoondustIcon: Phaser.GameObjects.Image;
  rewardMoondustText: Phaser.GameObjects.Text;
  /** Chest reward line (T2.23a) - visible only on a chest-carrying premium order. */
  chestIcon: Phaser.GameObjects.Image;
  chestText: Phaser.GameObjects.Text;
  fulfillButton: Phaser.GameObjects.NineSlice;
  fulfillText: Phaser.GameObjects.Text;
  skipButton: Phaser.GameObjects.NineSlice;
  skipText: Phaser.GameObjects.Text;
  cooldownText: Phaser.GameObjects.Text;
  stampText: Phaser.GameObjects.Text;
  /** Static world position of the card center, for arc/label origins. */
  worldX: number;
  worldY: number;
  /** The card's own local y offset within the container (CARD_START_Y + slotIndex * CARD_SPACING) -
   *  needed to reposition the reward row/label on the CHEST_LINE_NUDGE_Y toggle every refresh. */
  cardY: number;
}

export class OrderBoard {
  private readonly container: Phaser.GameObjects.Container;
  private readonly cards: OrderCard[] = [];
  private readonly villagerArc: PooledArc;
  private readonly backdrop: ModalBackdrop;
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onFulfill: (slotIndex: number, worldX: number, worldY: number) => void,
    private readonly onSkip: (slotIndex: number) => void,
    private readonly audio: AudioManager,
  ) {
    // Tap sounds live on the user-driven close seams (backdrop and X), never
    // in hide() itself - hide() is also called programmatically (e.g. when
    // the Bag button closes this board) and must stay silent then.
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
    const title = scene.add.text(0, TITLE_Y, 'Orders', TITLE_STYLE).setOrigin(0.5);
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

    for (let i = 0; i < ORDER_SLOTS; i++) {
      this.cards.push(this.buildCard(i));
    }

    // Onboarding highlight over slot 0's Fulfill button - only while the
    // board is open and that card is showing an open (fulfillable) order.
    // The button nineslice has no owner-managed scale state, so it is safe
    // for the guide to scale-breathe.
    registerPulseTarget('fulfill-slot-0', () => {
      const card = this.cards[0];
      if (!this.visible || card === undefined || !card.fulfillButton.visible) return null;
      return {
        x: PANEL_CENTER_X + FULFILL_BUTTON_X,
        y: PANEL_CENTER_Y + CARD_START_Y + FULFILL_BUTTON_Y,
        width: FULFILL_BUTTON_WIDTH,
        height: FULFILL_BUTTON_HEIGHT,
        object: card.fulfillButton,
      };
    });
    // Onboarding highlight over the close (X) control - only while the board
    // is open; closing it is the deliver step's next action once the board
    // is open but the order isn't covered yet. Halo-only (plain text object).
    registerPulseTarget('orders-close', () => {
      if (!this.visible) return null;
      return {
        x: PANEL_CENTER_X + CLOSE_OFFSET_X,
        y: PANEL_CENTER_Y + CLOSE_OFFSET_Y,
        width: CLOSE_TARGET_SIZE,
        height: CLOSE_TARGET_SIZE,
      };
    });
    // Onboarding highlight over the whole slot-0 card for the review-order
    // step - halo-only (the card is a composite of many objects), live for
    // as long as the board is open regardless of what the slot holds, so the
    // step can never wedge on a fulfilled or replaced card.
    registerPulseTarget('order-card-0', () => {
      if (!this.visible) return null;
      return {
        x: PANEL_CENTER_X,
        y: PANEL_CENTER_Y + CARD_START_Y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      };
    });

    this.villagerArc = new PooledArc(scene, {
      targetX: VILLAGER_POSITION.x,
      targetY: VILLAGER_POSITION.y,
      depth: VILLAGER_ARC_DEPTH,
      startScale: VILLAGER_ARC_START_SCALE,
      endScale: VILLAGER_ARC_END_SCALE,
      maxPerFly: MAX_GOODS_PER_ITEM,
      defaultFrame: CROPS.sunwheat.stageFrames[2],
      preallocate: MAX_GOODS_PER_ITEM * 2,
    });
    registerPoolStats('villager', this.villagerArc);
  }

  private buildCard(slotIndex: number): OrderCard {
    const y = CARD_START_Y + slotIndex * CARD_SPACING;

    const cardBg = this.scene.add.nineslice(
      0,
      y,
      ATLAS_KEY,
      'panel',
      CARD_WIDTH,
      CARD_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );

    // Where the (now-removed) flavor line used to sit - the only premium
    // signal left besides cardBg's tint. Flush with the card's own inner
    // content edge (PREMIUM_TAG_LEFT_INSET), left of the "Reward:" indent.
    const premiumTag = this.scene.add
      .text(
        -CARD_WIDTH / 2 + PREMIUM_TAG_LEFT_INSET,
        y - CARD_HEIGHT / 2 + PREMIUM_TAG_TOP_MARGIN,
        'Premium Order',
        PREMIUM_TAG_STYLE,
      )
      .setOrigin(0, 0)
      .setLetterSpacing(2)
      .setVisible(false);

    // Icon y is fixed regardless of tier (CLUSTER_BASELINE_Y is shared), so
    // it is set once here; countText/nameText y depend on the tier's
    // iconScale and are repositioned every refresh.
    const clusters: ItemCluster[] = Array.from({ length: MAX_CLUSTERS }, () => ({
      icon: this.scene.add
        .image(0, y + CLUSTER_BASELINE_Y, ATLAS_KEY, CROPS.sunwheat.stageFrames[2])
        .setOrigin(0.5, CROP_BASELINE_Y / CROP_FRAME_SIZE)
        .setVisible(false),
      countText: this.scene.add
        .text(0, y + CLUSTER_BASELINE_Y, '', ITEM_COUNT_STYLE)
        .setOrigin(0, 0.5)
        .setVisible(false),
      nameText: this.scene.add.text(0, y, '', ITEM_NAME_STYLE).setOrigin(0.5).setVisible(false),
    }));

    // Reward row, left to right: xp, coin (icon + value), moondust (icon +
    // value, premium only) - all at fixed x, see REWARD_ROW_Y's comment.
    const rewardXpText = this.scene.add
      .text(REWARD_XP_TEXT_X, y + REWARD_ROW_Y, '', REWARD_XP_STYLE)
      .setOrigin(0, 0.5);
    const rewardCoin = this.scene.add
      .image(REWARD_COIN_ICON_X, y + REWARD_ROW_Y, ATLAS_KEY, 'coin')
      .setScale(REWARD_COIN_SCALE);
    const rewardCoinText = this.scene.add
      .text(REWARD_COIN_TEXT_X, y + REWARD_ROW_Y, '', REWARD_COIN_STYLE)
      .setOrigin(0, 0.5);
    const rewardMoondustIcon = this.scene.add
      .image(REWARD_MOONDUST_ICON_X, y + REWARD_ROW_Y, ATLAS_KEY, 'moondust')
      .setScale(REWARD_MOONDUST_SCALE)
      .setVisible(false);
    const rewardMoondustText = this.scene.add
      .text(REWARD_MOONDUST_TEXT_X, y + REWARD_ROW_Y, '', REWARD_MOONDUST_STYLE)
      .setOrigin(0, 0.5)
      .setVisible(false);
    // Positioned once (fixed relative to the reward row, independent of
    // order content) with measured clearance from the coin icon's actual
    // rendered top edge (the row's tallest element), not a guessed offset.
    const rewardLabel = this.scene.add
      .text(
        REWARD_XP_TEXT_X,
        rewardCoin.y - rewardCoin.displayHeight / 2 - REWARD_LABEL_CLEARANCE,
        'Reward:',
        REWARD_LABEL_STYLE,
      )
      .setOrigin(0, 1)
      .setVisible(false);

    // Chest reward line (T2.23a): icon + text positioned every refresh
    // (see refreshOpenCard), since their y tracks the reward row's own
    // CHEST_LINE_NUDGE_Y toggle - the y given here is just a safe initial
    // value before the first refresh.
    const chestIcon = this.scene.add
      .image(REWARD_XP_TEXT_X, y + REWARD_ROW_Y, ATLAS_KEY, 'chest_closed')
      .setOrigin(0, 0.5)
      .setScale(CHEST_ICON_SCALE)
      .setVisible(false);
    const chestText = this.scene.add
      .text(REWARD_XP_TEXT_X, y + REWARD_ROW_Y, '', CHEST_LINE_STYLE)
      .setOrigin(0, 0.5)
      .setVisible(false);

    const fulfillButton = this.scene.add.nineslice(
      FULFILL_BUTTON_X,
      y + FULFILL_BUTTON_Y,
      ATLAS_KEY,
      'panel',
      FULFILL_BUTTON_WIDTH,
      FULFILL_BUTTON_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const fulfillText = this.scene.add
      .text(FULFILL_BUTTON_X, y + FULFILL_BUTTON_Y, 'Fulfill', BUTTON_STYLE)
      .setOrigin(0.5);

    const skipButton = this.scene.add.nineslice(
      SKIP_BUTTON_X,
      y + SKIP_BUTTON_Y,
      ATLAS_KEY,
      'panel',
      SKIP_BUTTON_WIDTH,
      SKIP_BUTTON_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const skipText = this.scene.add
      .text(SKIP_BUTTON_X, y + SKIP_BUTTON_Y, 'Skip', SKIP_STYLE)
      .setOrigin(0.5);

    const cooldownText = this.scene.add
      .text(0, y, '', COOLDOWN_STYLE)
      .setOrigin(0.5)
      .setVisible(false);

    const stampText = this.scene.add
      .text(0, y, 'Done!', STAMP_STYLE)
      .setOrigin(0.5)
      .setVisible(false);

    const worldX = PANEL_CENTER_X;
    const worldY = PANEL_CENTER_Y + y;
    fulfillButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      // Only interactive while the order is covered, so this tap always
      // accompanies a real fulfillment (whose fanfare rides playFulfillJuice).
      this.audio.sfx('tap');
      this.onFulfill(slotIndex, worldX, worldY);
    });
    skipButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.onSkip(slotIndex);
    });
    skipButton.setInteractive({ useHandCursor: true });

    this.container.add([
      cardBg,
      premiumTag,
      ...clusters.flatMap((cluster) => [cluster.icon, cluster.countText, cluster.nameText]),
      rewardLabel,
      rewardXpText,
      rewardCoin,
      rewardCoinText,
      rewardMoondustIcon,
      rewardMoondustText,
      chestIcon,
      chestText,
      fulfillButton,
      fulfillText,
      skipButton,
      skipText,
      cooldownText,
      stampText,
    ]);

    return {
      cardBg,
      premiumTag,
      clusters,
      rewardLabel,
      rewardXpText,
      rewardCoin,
      rewardCoinText,
      rewardMoondustIcon,
      rewardMoondustText,
      chestIcon,
      chestText,
      fulfillButton,
      fulfillText,
      skipButton,
      skipText,
      cooldownText,
      stampText,
      worldX,
      worldY,
      cardY: y,
    };
  }

  /** Re-derive every card from state; cooldown seconds come from `now()`. */
  refresh(state: GameStateData): void {
    const nowMs = now();
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const slot = state.orders[i];
      if (card === undefined || slot === undefined) continue;

      if (slot.state === 'open') {
        this.refreshOpenCard(card, slot.order, state);
        continue;
      }

      this.setOrderElementsVisible(card, false);
      card.cooldownText.setVisible(true);
      if (slot.state === 'cooldown') {
        const seconds = Math.max(0, Math.ceil((slot.readyAt - nowMs) / 1000));
        card.cooldownText.setText(`New order soon... ${seconds}s`);
      } else {
        // Pending: ensureOrders fills it within a tick; show a quiet beat.
        card.cooldownText.setText('...');
      }
    }
  }

  private refreshOpenCard(card: OrderCard, order: Order, state: GameStateData): void {
    this.setOrderElementsVisible(card, true);
    card.cooldownText.setVisible(false);

    // Defensive: > 3 item types (not generated today) reuses the 3-tier and
    // only the first 3 clusters render - see MAX_CLUSTERS.
    const tierIndex = Math.min(Math.max(order.items.length, 1), MAX_CLUSTERS) - 1;
    const tier = CLUSTER_TIERS[tierIndex]!;
    const rowGap = CLUSTER_ROW_GAP[tierIndex] ?? 0;
    let allCovered = true;
    // Left-flow: each cluster's left edge starts where the previous one's
    // measured right edge (plus rowGap) left off - see the block comment
    // above CLUSTER_BASELINE_Y.
    let nextLeftX = CLUSTER_LEFT_MARGIN;
    for (let i = 0; i < card.clusters.length; i++) {
      const cluster = card.clusters[i]!;
      const item = order.items[i];
      if (item === undefined) {
        cluster.icon.setVisible(false);
        cluster.countText.setVisible(false);
        cluster.nameText.setVisible(false);
        continue;
      }
      const have = state.inventory[item.cropId] ?? 0;
      const covered = have >= item.count;
      if (!covered) allCovered = false;

      cluster.icon
        .setFrame(CROPS[item.cropId].stageFrames[2])
        .setScale(tier.iconScale)
        .setVisible(true);
      // Vertically center the count on the icon's rendered content (not its
      // padded frame) - see CLUSTER_ICON_CONTENT_OFFSET.
      cluster.countText
        .setFontSize(tier.countFontSize)
        .setText(`${have}/${item.count}`)
        .setColor(covered ? COVERED_COLOR : SHORT_COLOR)
        .setY(cluster.icon.y - CLUSTER_ICON_CONTENT_OFFSET * tier.iconScale)
        .setVisible(true);
      // Name sits below the icon's actual rendered bottom edge (frame row
      // CROP_FRAME_SIZE scaled from the baseline), not a fixed offset, so it
      // never collides with a larger tier's icon.
      const iconBottomY = cluster.icon.y + (CROP_FRAME_SIZE - CROP_BASELINE_Y) * tier.iconScale;
      cluster.nameText
        .setFontSize(tier.nameFontSize)
        .setText(CROPS[item.cropId].name)
        .setY(iconBottomY + CLUSTER_NAME_GAP + tier.nameFontSize * CLUSTER_NAME_HALF_HEIGHT_FACTOR)
        .setVisible(true);

      // This cluster's overall visual width is whichever of the icon+count
      // pair or the name text is wider - both measured (not estimated) and
      // centered on the same clusterCenterX, so the cluster's bounding box
      // is symmetric and its true left/right edges are exact regardless of
      // digit count in "have/need" or crop name length.
      const pairWidth = cluster.icon.displayWidth + tier.gap + cluster.countText.width;
      const nameWidth = cluster.nameText.width;
      const clusterWidth = Math.max(pairWidth, nameWidth);
      const clusterCenterX = nextLeftX + clusterWidth / 2;

      cluster.icon.setX(clusterCenterX - pairWidth / 2 + cluster.icon.displayWidth / 2);
      cluster.countText.setX(cluster.icon.x + cluster.icon.displayWidth / 2 + tier.gap);
      cluster.nameText.setX(clusterCenterX);

      nextLeftX = clusterCenterX + clusterWidth / 2 + rowGap;
    }

    card.rewardCoinText.setText(String(order.coinReward));
    card.rewardXpText.setText(`+${order.xpReward} xp`);

    // Premium signal: tint the card body itself (cleared on non-premium) plus
    // a small tag where the flavor line used to sit. Moondust column is at a
    // fixed x (see REWARD_ROW_Y's comment) - only its visibility toggles, so
    // the xp/coin columns never move when it appears or disappears.
    const isPremium = order.premium !== undefined;
    if (isPremium) {
      card.cardBg.setTint(PREMIUM_BG_TINT);
    } else {
      card.cardBg.clearTint();
    }
    card.premiumTag.setVisible(isPremium);
    card.rewardMoondustIcon.setVisible(isPremium);
    card.rewardMoondustText.setVisible(isPremium);
    if (isPremium) {
      card.rewardMoondustText.setText(`+${order.premium!.moondust}`);
    }

    // Chest reward line (T2.23a): the whole reward row (+ its label) shifts
    // up by CHEST_LINE_NUDGE_Y on a chest-carrying card only - see that
    // constant's comment for the measured clearance math.
    const chests = order.premium?.chests;
    const hasChests = chests !== undefined && chests > 0;
    const rowY = card.cardY + REWARD_ROW_Y - (hasChests ? CHEST_LINE_NUDGE_Y : 0);
    card.rewardXpText.setY(rowY);
    card.rewardCoin.setY(rowY);
    card.rewardCoinText.setY(rowY);
    card.rewardMoondustIcon.setY(rowY);
    card.rewardMoondustText.setY(rowY);
    card.rewardLabel.setY(rowY - card.rewardCoin.displayHeight / 2 - REWARD_LABEL_CLEARANCE);
    card.chestIcon.setVisible(hasChests);
    card.chestText.setVisible(hasChests);
    if (hasChests) {
      const chestLineY =
        rowY +
        card.rewardCoin.displayHeight / 2 +
        CHEST_LINE_GAP +
        card.chestIcon.displayHeight / 2;
      card.chestIcon.setY(chestLineY).setX(REWARD_XP_TEXT_X);
      card.chestText
        .setY(chestLineY)
        .setX(card.chestIcon.x + card.chestIcon.displayWidth + CHEST_LINE_ICON_TEXT_GAP)
        .setText(`${chests} Treasure Chest${chests! > 1 ? 's' : ''}`);
    }

    card.fulfillButton.setAlpha(allCovered ? BUTTON_ENABLED_ALPHA : BUTTON_DISABLED_ALPHA);
    card.fulfillText.setAlpha(allCovered ? BUTTON_ENABLED_ALPHA : BUTTON_DISABLED_ALPHA);
    if (allCovered) {
      card.fulfillButton.setInteractive({ useHandCursor: true });
    } else {
      card.fulfillButton.disableInteractive();
    }

    // Tutorial rails: skipping is never a tutorial action, so the Skip
    // buttons dim and go inert for the whole run (the store rejects the
    // mutation too - this is only the visual half).
    const skipAllowed = gameState.railsAllow('skip');
    card.skipButton.setAlpha(skipAllowed ? BUTTON_ENABLED_ALPHA : BUTTON_DISABLED_ALPHA);
    card.skipText.setAlpha(skipAllowed ? BUTTON_ENABLED_ALPHA : BUTTON_DISABLED_ALPHA);
    if (skipAllowed) {
      card.skipButton.setInteractive({ useHandCursor: true });
    } else {
      card.skipButton.disableInteractive();
    }
  }

  /** Show/hide everything an open card owns except the cooldown text and stamp. */
  private setOrderElementsVisible(card: OrderCard, visible: boolean): void {
    for (const cluster of card.clusters) {
      cluster.icon.setVisible(visible);
      cluster.countText.setVisible(visible);
      cluster.nameText.setVisible(visible);
    }
    card.rewardLabel.setVisible(visible);
    card.rewardCoin.setVisible(visible);
    card.rewardCoinText.setVisible(visible);
    card.rewardXpText.setVisible(visible);
    card.fulfillButton.setVisible(visible);
    card.fulfillText.setVisible(visible);
    card.skipButton.setVisible(visible);
    card.skipText.setVisible(visible);
    if (!visible) {
      // Premium-only elements: refreshOpenCard decides their state per
      // order, but a card leaving the open state (cooldown/pending) must
      // clear them unconditionally.
      card.cardBg.clearTint();
      card.premiumTag.setVisible(false);
      card.rewardMoondustIcon.setVisible(false);
      card.rewardMoondustText.setVisible(false);
      card.chestIcon.setVisible(false);
      card.chestText.setVisible(false);
    }
  }

  /**
   * The board-owned half of the fulfill beat: the requested goods arc from
   * the card off screen to the villager, and a "Done!" stamp scales in and
   * fades on the card. Coin arcs, the xp label, and the buzz are the HUD's
   * half - it owns the coin ticker.
   */
  playFulfillJuice(slotIndex: number, order: Order): void {
    const card = this.cards[slotIndex];
    if (card === undefined) return;

    this.audio.sfx('fanfare');

    for (let i = 0; i < order.items.length && i < MAX_CLUSTERS; i++) {
      const item = order.items[i]!;
      const cluster = card.clusters[i]!;
      this.villagerArc.fly(
        PANEL_CENTER_X + cluster.icon.x,
        PANEL_CENTER_Y + cluster.icon.y,
        item.count,
        undefined,
        CROPS[item.cropId].stageFrames[2],
      );
    }

    const stamp = card.stampText;
    this.scene.tweens.killTweensOf(stamp);
    stamp.setVisible(true).setAlpha(1).setScale(0);
    this.scene.tweens.add({
      targets: stamp,
      scale: 1,
      duration: STAMP_IN_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: stamp,
          alpha: 0,
          delay: STAMP_HOLD_MS,
          duration: STAMP_FADE_MS,
          ease: 'Sine.easeIn',
          onComplete: () => stamp.setVisible(false),
        });
      },
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(state: GameStateData): void {
    this.visible = !this.visible;
    this.container.setVisible(this.visible);
    this.backdrop.setActive(this.visible);
    setPanelOpen('orders', this.visible);
    if (this.visible) this.refresh(state);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('orders', false);
  }
}
