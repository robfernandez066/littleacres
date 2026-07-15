import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { CROPS, type CropDef, type CropId } from '../data/crops';
import type { AudioManager } from '../systems/audio';
import { gameState } from '../systems/gameState';
import { isModalOpen } from '../systems/modalPanels';
import { registerPulseTarget, type PulseTarget } from '../systems/pulseTargets';
import {
  clampScrollX,
  FULL_SIZE_BUTTONS,
  scrollXToCenter,
  type SeedStripMetrics,
  visibleSeedButtonCount,
} from './seedBarLayout';

/**
 * Layout: primary actions live in the bottom third of the screen (design
 * rule); the bar spans roughly y 1560-1840, inside the 1550-1850 band.
 */
const BAR_CENTER_Y = 1700;
const BUTTON_WIDTH = 196;
const BUTTON_HEIGHT = 280;
const BUTTON_SPACING = 208;
/**
 * Seven-crop refit (T3.11) / scroll refit (T3.23): which crops get a button
 * comes from `visibleSeedButtonCount` (seedBarLayout.ts) - every unlocked
 * crop, exactly one next-locked teaser, further locked crops only as filler
 * up to FULL_SIZE_BUTTONS; unlock order = CROPS order. Five-or-fewer buttons
 * keep the historical fixed layout pixel-for-pixel (the whole tutorial runs
 * there). Past five, every card stays FULL SIZE and the row becomes a
 * horizontally draggable strip: one `scrollX` offset from the centered
 * layout (clamp/center math in seedBarLayout.ts, BAR_SIDE_MARGIN clear at
 * the extremes) is added to every button's world x. The buttons stay
 * individual top-level containers rather than moving into a parent strip
 * container: the onboarding guide scale-breathes them and the coins wiggle
 * nudges them one at a time, and world-space positions keep pulse targets
 * and hit-testing exactly as they were. No mask - the strip overflows the
 * screen and the camera clips it; the partly visible card at an edge IS the
 * scroll affordance.
 */
const BAR_SIDE_MARGIN = 20;
/** Pointer travel (design px) beyond which a press is a scroll, not a tap. */
const TAP_SLOP = 12;
/** Tap-to-select glides the tapped card to screen center (scroll mode). */
const CENTER_TWEEN_MS = 200;
/** Widest name ("Emberpepper") must shrink-to-fit inside the card. */
const NAME_MAX_WIDTH = BUTTON_WIDTH - 24;
/** Above the field and crop sprites (whose depth is their screen y). */
const BAR_DEPTH = 2000;

/** The bar's geometry handed to seedBarLayout's pure scroll math. */
const STRIP_METRICS: SeedStripMetrics = {
  buttonWidth: BUTTON_WIDTH,
  spacing: BUTTON_SPACING,
  viewWidth: DESIGN_WIDTH,
  sideMargin: BAR_SIDE_MARGIN,
};

const ICON_OFFSET_Y = -55;
const NAME_OFFSET_Y = 45;
const COST_OFFSET_Y = 100;
const COIN_OFFSET_X = -24;
const COIN_SCALE = 0.3;
const COST_TEXT_X = -5;

const SELECTED_TINT = 0xffe27a;
const SELECTED_SCALE = 1.06;
const LOCKED_ALPHA = 0.5;
const LOCKED_ICON_TINT = 0x555555;

const NAME_COLOR = '#4a3218';
const COST_COLOR = '#7a5518';
const LOCKED_COLOR = '#4c4c4c';
const FLASH_COLOR = '#e03131';
const FLASH_DURATION_MS = 300;
const SHAKE_DISTANCE = 10;
/** Min gap between insufficient-coins nudges so a drag cannot spam them. */
const SHAKE_THROTTLE_MS = 400;

/**
 * Info badge: a small drawn circle at the button's top-right corner, hanging
 * half off the corner. 30px diameter with a 96px square hit area (T2.15, per
 * CLAUDE.md's hit-area rule; enlarged from 48 in T3.23) - FRAME-RELATIVE to
 * the circle's own 30x30 geometry (0,0 at its top-left), not centered on its
 * display origin. The 96px square reaches 86 + 48 = 134px from the card's
 * center - inside the 208px pitch - and where it does overhang the NEXT
 * card's panel edge (panel starts 110px out, a 24px overlap), that panel
 * sits later in the display list and wins Phaser's top-only hit test, so the
 * badge never eclipses the neighboring button.
 */
const BADGE_RADIUS = 15;
const BADGE_OFFSET_X = BUTTON_WIDTH / 2 - 12;
const BADGE_OFFSET_Y = -BUTTON_HEIGHT / 2 + 12;
const BADGE_HIT_SIZE = 96;
const BADGE_COLOR = 0x4a3218;
const BADGE_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '24px',
  fontStyle: 'italic bold',
  color: '#fff3c4',
};

const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: NAME_COLOR,
};

const COST_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  fontStyle: 'bold',
  color: COST_COLOR,
};

interface SeedButton {
  crop: CropDef;
  container: Phaser.GameObjects.Container;
  panel: Phaser.GameObjects.NineSlice;
  icon: Phaser.GameObjects.Image;
  coinIcon: Phaser.GameObjects.Image;
  costText: Phaser.GameObjects.Text;
  /** Current world x of the card's resting center (strip scroll applied). */
  baseX: number;
  /**
   * Insufficient-coins wiggle displacement, tweened around 0 and ADDED to
   * baseX on every position write - keeping the wiggle its own axis means a
   * scroll or centering tween updating baseX mid-wiggle composes instead of
   * fighting (both funnel through `positionButton`).
   */
  wiggleOffset: number;
  locked: boolean;
  /** Real wall-clock ms of the last nudge; UI throttle, not gameplay time. */
  lastFlashAt: number;
  flashTimer: Phaser.Time.TimerEvent | null;
}

/**
 * A press armed by pointer-down on a panel or badge (scroll mode only):
 * release fires the tap only if the same pointer is still within TAP_SLOP of
 * where it went down and never wandered beyond it (`moved`, maintained by
 * the scene-level move handler, catches an out-and-back drag).
 */
interface ArmedTap {
  kind: 'seed' | 'badge';
  cropId: CropId;
  pointerId: number;
  downX: number;
  downY: number;
  moved: boolean;
}

/**
 * Bottom-anchored seed selection bar: one button per crop showing icon, name
 * and seed cost. Which buttons show comes from the player level via
 * `relayout` (see FULL_SIZE_BUTTONS); past five the full-size cards sit on a
 * horizontally draggable strip and taps fire on an in-slop release instead
 * of on pointer-down (see the strip comment above). Locked crops (player level
 * below unlockLevel) are visible but dimmed with a "Lv N" requirement
 * instead of the cost. At most one seed
 * is selected at a time; tapping the selected seed deselects it - except
 * during the tutorial, where the rails own selection: only the step's crop
 * is selectable (others dim, alpha only), re-taps never deselect, and a seed
 * auto-deselects the moment the rails stop allowing it.
 *
 * The bar only renders from and reads `gameState` - it never owns game data.
 */
export class SeedBar {
  private readonly buttons: SeedButton[] = [];
  private selected: CropId | null = null;
  /** Level the lock visuals were last derived from; -1 forces a first pass. */
  private lastLevel = -1;
  /** How many leading buttons (unlock order) the bar currently shows. */
  private visibleCount = 0;
  /** Whole-bar visibility (arrange mode), ANDed with per-button visibility. */
  private barShown = true;
  /** True past FULL_SIZE_BUTTONS: full-size cards on a draggable strip. */
  private scrollMode = false;
  /** Strip offset from the centered layout (seedBarLayout convention); always 0 in static mode. */
  private scrollX = 0;
  /** Pointer id of the drag currently scrolling the strip, or -1. */
  private dragPointerId = -1;
  private dragStartPointerX = 0;
  private dragStartScrollX = 0;
  /** In-flight tap-to-select centering tween, killed by drags and relayouts. */
  private centerTween: Phaser.Tweens.Tween | null = null;
  /** Pending press that fires as a tap on an in-slop release (scroll mode). */
  private armedTap: ArmedTap | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
    private readonly onInfoTap: (crop: CropDef) => void,
  ) {
    for (const crop of Object.values(CROPS)) {
      this.buttons.push(this.buildButton(crop));
    }
    registerPulseTarget('seed-sunwheat', () => this.seedPulseTarget('sunwheat'));
    registerPulseTarget('seed-starcorn', () => this.seedPulseTarget('starcorn'));
    // Strip scrolling listens at the scene level, not per-object: a drag may
    // start on a card, on the badge, or in a gap between cards, and must
    // keep tracking once the pointer leaves what it went down on. Listeners
    // die with the scene's InputPlugin, matching the bar's own lifetime.
    this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onScenePointerDown, this);
    this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onScenePointerMove, this);
    this.scene.input.on(Phaser.Input.Events.POINTER_UP, this.onScenePointerUp, this);
    this.scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onScenePointerUp, this);
    this.refresh();
  }

  /** The currently selected crop, or null when nothing is selected. */
  getSelected(): CropId | null {
    return this.selected;
  }

  /**
   * Show/hide the whole bar (T3.9b arrange mode, whose control row takes
   * over this same band). Visibility only - `FarmScene`'s arrange-mode
   * hitbox suppression already disables every button's interactivity for
   * the duration and restores it on Done.
   */
  setVisible(visible: boolean): void {
    this.barShown = visible;
    this.buttons.forEach((button, index) => {
      button.container.setVisible(visible && index < this.visibleCount);
    });
  }

  /**
   * Onboarding pulse target for a seed button - null once that seed is
   * already selected, so the guide moves the highlight on to the field. Also
   * null while a modal panel is open: the bar sits below the panels'
   * vertical extent and any part a panel overlaps is untappable, so it is
   * never a valid pulse target then. The container is safe for the guide to
   * scale-breathe precisely because of the selected-null rule (the selected
   * scale state never coexists with the highlight; `refresh` re-asserts it
   * against the one-tick handoff race).
   */
  private seedPulseTarget(cropId: CropId): PulseTarget | null {
    if (isModalOpen() || this.selected === cropId) return null;
    const button = this.buttons.find((b) => b.crop.id === cropId);
    if (button === undefined) return null;
    return {
      // baseX is the button's WORLD x with the strip scroll already applied
      // (the tutorial only ever sees static mode, where it equals the fixed
      // row position, but the offset keeps this correct in general).
      x: button.baseX,
      y: BAR_CENTER_Y,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      object: button.container,
    };
  }

  /**
   * Re-derive lock state from the player level (cheap when nothing changed)
   * and the tutorial rails dimming, on the scene's regular refresh tick.
   * Deselects the current seed if it just became locked.
   */
  refresh(): void {
    this.reassertSelectedScale();
    const level = gameState.getState().level;
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.relayout(level);
      for (const button of this.buttons) {
        button.locked = level < button.crop.unlockLevel;
        this.applyLockVisuals(button);
      }
      const selectedButton = this.buttons.find((b) => b.crop.id === this.selected);
      if (selectedButton?.locked === true) this.setSelected(null);
    }
    this.applyRailsGating();
  }

  /**
   * Re-derive the visible button set and the row layout from the player
   * level. The count rule lives in `visibleSeedButtonCount`: unlocked crops
   * + one next-locked teaser + locked filler up to FULL_SIZE_BUTTONS. A
   * teaser/filler button renders exactly like any locked button (lock
   * treatment, "Lv N" tag, live info badge, silent taps). At
   * FULL_SIZE_BUTTONS or fewer the row renders at the historical fixed
   * layout (scrollX pinned to 0, positions identical to the pre-T3.23
   * formula); more keep full size on the scrollable strip. A relayout
   * preserves the player's scroll re-clamped for the new count - unless a
   * seed is selected, which re-centers it (matching what the tap that
   * selected it did). Ends by re-asserting selection visuals so every
   * container lands on the right scale.
   */
  private relayout(level: number): void {
    const unlockedCount = this.buttons.filter((b) => b.crop.unlockLevel <= level).length;
    this.visibleCount = visibleSeedButtonCount(unlockedCount, this.buttons.length);
    this.scrollMode = this.visibleCount > FULL_SIZE_BUTTONS;
    this.centerTween?.remove();
    this.centerTween = null;
    this.dragPointerId = -1;
    const selectedIndex = this.buttons.findIndex((b) => b.crop.id === this.selected);
    this.scrollX = !this.scrollMode
      ? 0
      : selectedIndex >= 0
        ? scrollXToCenter(selectedIndex, this.visibleCount, STRIP_METRICS)
        : clampScrollX(this.scrollX, this.visibleCount, STRIP_METRICS);
    this.buttons.forEach((button, index) => {
      button.baseX = this.rowSlotX(index) + this.scrollX;
      this.positionButton(button);
      button.container.setVisible(this.barShown && index < this.visibleCount);
    });
    this.setSelected(this.selected);
  }

  /** World x of the strip slot `index` before scrolling - the centered-row
   * position, which IS the historical static layout when scrollX is 0. */
  private rowSlotX(index: number): number {
    return DESIGN_WIDTH / 2 + (index - (this.visibleCount - 1) / 2) * BUTTON_SPACING;
  }

  /** Sole writer of a button container's x - resting spot plus any wiggle. */
  private positionButton(button: SeedButton): void {
    button.container.setX(button.baseX + button.wiggleOffset);
  }

  /** Move the strip: re-derive every button's world x from the new offset. */
  private applyScrollX(value: number): void {
    this.scrollX = value;
    this.buttons.forEach((button, index) => {
      button.baseX = this.rowSlotX(index) + this.scrollX;
      this.positionButton(button);
    });
  }

  /** Glide the strip to `target` (tap-to-select centering, ~200ms). */
  private tweenScrollTo(target: number): void {
    this.centerTween?.remove();
    this.centerTween = null;
    if (target === this.scrollX) return;
    this.centerTween = this.scene.tweens.addCounter({
      from: this.scrollX,
      to: target,
      duration: CENTER_TWEEN_MS,
      ease: 'Sine.easeOut',
      onUpdate: (tween) => {
        const value = tween.getValue();
        if (value !== null) this.applyScrollX(value);
      },
      onComplete: () => {
        this.centerTween = null;
      },
    });
  }

  /**
   * Strip dragging exists only when there is something to scroll (past
   * FULL_SIZE_BUTTONS), the bar is actually shown (arrange mode hides it),
   * and no modal panel is open (the bar sits under open panels and must not
   * scroll behind them). In static mode this leaves the bar's input handling
   * byte-identical to the pre-scroll behavior.
   */
  private scrollInputEnabled(): boolean {
    return this.scrollMode && this.barShown && !isModalOpen();
  }

  private onScenePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.scrollInputEnabled()) return;
    if (Math.abs(pointer.y - BAR_CENTER_Y) > BUTTON_HEIGHT / 2) return;
    this.centerTween?.remove();
    this.centerTween = null;
    this.dragPointerId = pointer.id;
    this.dragStartPointerX = pointer.x;
    this.dragStartScrollX = this.scrollX;
  }

  private onScenePointerMove(pointer: Phaser.Input.Pointer): void {
    const armed = this.armedTap;
    if (
      armed !== null &&
      armed.pointerId === pointer.id &&
      !armed.moved &&
      Math.hypot(pointer.x - armed.downX, pointer.y - armed.downY) > TAP_SLOP
    ) {
      armed.moved = true;
    }
    if (this.dragPointerId !== pointer.id) return;
    // Self-heal a stale drag: if the button is no longer down, the release
    // was swallowed before the plugin-level POINTER_UP could reach
    // onScenePointerUp (a stopPropagation in some up handler cancels
    // processUpEvents early) - never scroll on a buttonless move.
    if (!pointer.isDown) {
      this.dragPointerId = -1;
      return;
    }
    // A modal opening (or arrange mode starting) mid-drag ends the drag.
    if (!this.scrollInputEnabled()) {
      this.dragPointerId = -1;
      return;
    }
    this.applyScrollX(
      clampScrollX(
        this.dragStartScrollX + (pointer.x - this.dragStartPointerX),
        this.visibleCount,
        STRIP_METRICS,
      ),
    );
  }

  /** Runs AFTER the per-object up handlers (Phaser emits those first), so
   * the armed tap is still readable when the release lands on its object. */
  private onScenePointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.dragPointerId === pointer.id) this.dragPointerId = -1;
    if (this.armedTap?.pointerId === pointer.id) this.armedTap = null;
  }

  /**
   * Whether a release on `kind`/`cropId` completes an armed tap: same
   * pointer that armed it, never wandered past TAP_SLOP, and released within
   * TAP_SLOP of the press (belt-and-braces with `moved` - move events are
   * not guaranteed while a modal disables drag tracking).
   */
  private tapWithinSlop(
    kind: ArmedTap['kind'],
    cropId: CropId,
    pointer: Phaser.Input.Pointer,
  ): boolean {
    const armed = this.armedTap;
    if (armed === null || armed.kind !== kind || armed.cropId !== cropId) return false;
    if (armed.pointerId !== pointer.id || armed.moved) return false;
    return Math.hypot(pointer.x - armed.downX, pointer.y - armed.downY) <= TAP_SLOP;
  }

  /**
   * Tutorial rails dimming, re-derived EVERY tick (never behind the level
   * early-out above): the gating changes with the onboarding step and even
   * within one step (plant-mixed's counters filling). The rules come solely
   * from the store's `railsAllow` choke point - alpha dim only, the "Lv N"
   * cost text stays owned by the level lock. Also deselects a seed the
   * moment it stops being selectable (step change, or its plant-mixed
   * counter reaching goal), mirroring the became-locked deselect - a stale
   * selection would otherwise let plot taps reach a step that forbids
   * planting and trip FarmScene's insufficient-coins nudge, which a blocked
   * action must never do. Post-tutorial `railsAllow` is always true, so
   * this pass reduces to the plain locked dim.
   */
  private applyRailsGating(): void {
    for (const button of this.buttons) {
      const dimmed = button.locked || !gameState.railsAllow('select-seed', button.crop.id);
      button.container.setAlpha(dimmed ? LOCKED_ALPHA : 1);
    }
    if (this.selected !== null && !gameState.railsAllow('select-seed', this.selected)) {
      this.setSelected(null);
    }
  }

  /**
   * Keep the selected button at its selected scale every tick. The
   * onboarding guide scale-breathes UNselected seed buttons and restores
   * their base scale when it moves on; a selection made in the same tick the
   * guide detaches would otherwise be left at base scale until the next
   * selection change. The guide never touches a selected button (its
   * provider returns null then), so this never fights the breathing.
   */
  private reassertSelectedScale(): void {
    const button = this.buttons.find((b) => b.crop.id === this.selected);
    if (button !== undefined) button.container.setScale(SELECTED_SCALE);
  }

  /**
   * Gentle insufficient-coins feedback: a small x-wiggle on the button and a
   * brief red flash of its cost text. Never blocks; throttled per button.
   */
  flashInsufficientCoins(cropId: CropId): void {
    const button = this.buttons.find((b) => b.crop.id === cropId);
    if (button === undefined) return;
    const nowMs = Date.now();
    if (nowMs - button.lastFlashAt < SHAKE_THROTTLE_MS) return;
    button.lastFlashAt = nowMs;

    // The wiggle tweens the button's OWN offset, never its absolute x, so a
    // scroll or an in-flight centering tween moving baseX underneath it
    // composes cleanly (positionButton adds the two on every update).
    this.scene.tweens.killTweensOf(button);
    button.wiggleOffset = 0;
    this.positionButton(button);
    this.scene.tweens.add({
      targets: button,
      wiggleOffset: SHAKE_DISTANCE,
      duration: 40,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.positionButton(button),
      onComplete: () => {
        button.wiggleOffset = 0;
        this.positionButton(button);
      },
    });

    button.costText.setColor(FLASH_COLOR);
    button.flashTimer?.remove();
    button.flashTimer = this.scene.time.delayedCall(FLASH_DURATION_MS, () => {
      button.costText.setColor(button.locked ? LOCKED_COLOR : COST_COLOR);
      button.flashTimer = null;
    });
  }

  private buildButton(crop: CropDef): SeedButton {
    // Position, scale and visibility are owned by `relayout` (the first pass
    // runs from the constructor's refresh(), before anything renders).
    const container = this.scene.add.container(0, BAR_CENTER_Y).setDepth(BAR_DEPTH);

    const panel = this.scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      BUTTON_WIDTH,
      BUTTON_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const icon = this.scene.add.image(0, ICON_OFFSET_Y, ATLAS_KEY, crop.stageFrames[2]);
    const nameText = this.scene.add.text(0, NAME_OFFSET_Y, crop.name, NAME_STYLE).setOrigin(0.5);
    // Shrink-to-fit: the 30px face overflows the card on the longest names.
    nameText.setScale(Math.min(1, NAME_MAX_WIDTH / nameText.width));
    const coinIcon = this.scene.add
      .image(COIN_OFFSET_X, COST_OFFSET_Y, ATLAS_KEY, 'coin')
      .setScale(COIN_SCALE);
    const costText = this.scene.add
      .text(COST_TEXT_X, COST_OFFSET_Y, String(crop.seedCost), COST_STYLE)
      .setOrigin(0, 0.5);
    container.add([panel, icon, nameText, coinIcon, costText]);

    panel.setInteractive({ useHandCursor: true });
    // Static mode keeps the historical fire-on-pointer-down feel (the whole
    // tutorial lives there). In scroll mode the down only ARMS the tap and
    // an in-slop release fires it - any farther travel is a strip drag and
    // the release does nothing.
    panel.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!this.scrollMode) {
        this.onTap(crop.id);
        return;
      }
      this.armedTap = {
        kind: 'seed',
        cropId: crop.id,
        pointerId: pointer.id,
        downX: pointer.x,
        downY: pointer.y,
        moved: false,
      };
    });
    panel.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      if (this.scrollMode && this.tapWithinSlop('seed', crop.id, pointer)) this.onTap(crop.id);
    });

    this.buildInfoBadge(container, crop);

    return {
      crop,
      container,
      panel,
      icon,
      coinIcon,
      costText,
      baseX: 0,
      wiggleOffset: 0,
      locked: false,
      lastFlashAt: -Infinity,
      flashTimer: null,
    };
  }

  /**
   * The "i" info badge: present on every button, locked included (info is
   * how you learn what you're working toward), added last so it draws atop
   * the panel. Its own tap stops propagation so it never reaches the panel's
   * seed-selection handler beneath it.
   */
  private buildInfoBadge(container: Phaser.GameObjects.Container, crop: CropDef): void {
    const badge = this.scene.add
      .circle(BADGE_OFFSET_X, BADGE_OFFSET_Y, BADGE_RADIUS, BADGE_COLOR)
      .setInteractive({
        hitArea: new Phaser.Geom.Rectangle(
          (BADGE_RADIUS * 2 - BADGE_HIT_SIZE) / 2,
          (BADGE_RADIUS * 2 - BADGE_HIT_SIZE) / 2,
          BADGE_HIT_SIZE,
          BADGE_HIT_SIZE,
        ),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
    const badgeText = this.scene.add
      .text(BADGE_OFFSET_X, BADGE_OFFSET_Y, 'i', BADGE_TEXT_STYLE)
      .setOrigin(0.5);
    // Same tap-vs-drag split as the panel. stopPropagation on the DOWN phase
    // only: it keeps the badge's press from arming (scroll mode) or firing
    // (static mode) the panel underneath, exactly as the old pointer-down
    // did - a badge tap must never select. The UP phase must NOT stop
    // propagation: in Phaser's InputPlugin the cancelled flag aborts
    // processUpEvents BEFORE the plugin-level POINTER_UP, which would starve
    // onScenePointerUp of the release and leave dragPointerId/armedTap stale
    // (T3.23a stuck-drag bug). Nothing needs the stop there anyway - the
    // panel's up handler only fires via tapWithinSlop('seed', ...), and a
    // badge press arms kind 'badge'.
    badge.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        if (!this.scrollMode) {
          this.onBadgeTap(crop);
          return;
        }
        this.armedTap = {
          kind: 'badge',
          cropId: crop.id,
          pointerId: pointer.id,
          downX: pointer.x,
          downY: pointer.y,
          moved: false,
        };
      },
    );
    badge.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      if (this.scrollMode && this.tapWithinSlop('badge', crop.id, pointer)) {
        this.onBadgeTap(crop);
      }
    });
    container.add([badge, badgeText]);
  }

  /** Inert while onboarding is active - the tutorial owns the player's attention. */
  private onBadgeTap(crop: CropDef): void {
    if (!gameState.getState().onboarding.completed) return;
    this.audio.sfx('tap');
    this.onInfoTap(crop);
  }

  private onTap(cropId: CropId): void {
    const button = this.buttons.find((b) => b.crop.id === cropId);
    if (button === undefined || button.locked) return;
    // Tutorial rails: taps on a seed the current step does not call for are
    // silent no-ops, exactly like locked taps.
    if (!gameState.railsAllow('select-seed', cropId)) return;
    // Re-tapping the selected seed never deselects during the tutorial - the
    // rails would leave nothing actionable selected.
    if (!gameState.getState().onboarding.completed && this.selected === cropId) return;
    // One click per accepted tap, select or deselect; locked taps stay silent.
    this.audio.sfx('tap');
    const next = this.selected === cropId ? null : cropId;
    this.setSelected(next);
    // Selecting glides the card to screen center (clamped at the strip's
    // ends); deselecting leaves the strip where it is.
    if (next !== null && this.scrollMode) {
      const index = this.buttons.findIndex((b) => b.crop.id === next);
      this.tweenScrollTo(scrollXToCenter(index, this.visibleCount, STRIP_METRICS));
    }
  }

  private setSelected(cropId: CropId | null): void {
    this.selected = cropId;
    for (const button of this.buttons) {
      if (button.crop.id === cropId) {
        button.panel.setTint(SELECTED_TINT);
        button.container.setScale(SELECTED_SCALE);
      } else {
        button.panel.clearTint();
        button.container.setScale(1);
      }
    }
  }

  /** Icon tint and cost/level text for the level lock. The container alpha
   * is owned by `applyRailsGating` (locked OR rails-dimmed), never here. */
  private applyLockVisuals(button: SeedButton): void {
    if (button.locked) {
      button.icon.setTint(LOCKED_ICON_TINT);
      button.coinIcon.setVisible(false);
      button.costText
        .setText(`Lv ${button.crop.unlockLevel}`)
        .setColor(LOCKED_COLOR)
        .setOrigin(0.5)
        .setX(0);
    } else {
      button.icon.clearTint();
      button.coinIcon.setVisible(true);
      button.costText
        .setText(String(button.crop.seedCost))
        .setColor(COST_COLOR)
        .setOrigin(0, 0.5)
        .setX(COST_TEXT_X);
    }
  }
}
