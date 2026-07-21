import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import {
  BUILDINGS,
  type MillingRecipe,
  recipeInputFrame,
  recipeInputHeld,
} from '../data/buildings';
import { GOODS } from '../data/goods';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData, millSlots, type MillSlotView } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { now } from '../systems/time';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * The mill's face (T4.2b, reworked T4.2b-r1) - where the player loads batches,
 * collects what they made, and buys the mill more capacity. Opened by tapping
 * the mill on the field.
 *
 * SLOTS ONLY. The first cut carried a recipe line and an on-hand readout above
 * the stack; both are gone (T4.2b-r1) because they restated what the slot rows
 * already show. What is left is a title, the slots, and one footer line.
 *
 * This panel OWNS NO MILLING RULE. Every slot it draws comes from the pure
 * `millSlots` derivation, and every button hands straight off to
 * `gameState.startMilling` / `collectMilling` / `unlockMillSlot`, which already
 * refuse a short bag, a locked slot, an unfinished batch, and a short purse.
 *
 * GOOD-AGNOSTIC: nothing here names a crop or a good. The input icon, the
 * output icon and every count are read off the opened building's own
 * `MillingRecipe` and the crop/good registries, so a future producer with a
 * different recipe renders through this file unchanged.
 *
 * Renders purely from the `GameStateData` passed to `refresh`, which the HUD
 * calls every tick while the panel is visible - that tick is what makes the
 * countdowns, the progress bars and the arm timeout live.
 */

const PANEL_WIDTH = 940;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 780;
/** Same tier as the bag/quest/goals panels: above the seed bar, below flying coins. */
const PANEL_DEPTH = 2100;
const BACKDROP_DEPTH = 2090;

/**
 * TOP-ANCHORED like GoalsPanel: the container's origin is the panel's top edge
 * and every constant below measures down from it. The height is not a constant
 * either - it depends on how many slots the recipe has - so `layout` sizes the
 * background to the measured stack and re-centers on PANEL_CENTER_Y.
 */
const TITLE_Y = 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = 50;
/** Where the first slot row's top edge sits - straight under the title now. */
const ROW_STACK_TOP = 126;
const ROW_GAP = 16;
/** Gap between the last row's bottom edge and the footer's baseline. */
const FOOTER_GAP = 46;
const PANEL_BOTTOM_MARGIN = 34;

/**
 * One slot row, a `panel` nineslice sized directly to its display bounds (the
 * card convention - its default interactive area then covers the whole visible
 * card, so no custom hit area is needed). Rows are TOP-anchored inside their
 * own container; only their copy and visibility change per refresh.
 */
const ROW_WIDTH = PANEL_WIDTH - 90;
const ROW_HEIGHT = 136;
const ROW_TEXT_LEFT_X = -ROW_WIDTH / 2 + 34;
/** The two text lines inside a row, measured down from its top edge. */
const ROW_PRIMARY_Y = 46;
const ROW_SECONDARY_Y = 96;
/** A one-line row centers instead of sitting on the two-line grid. */
const ROW_SINGLE_LINE_Y = ROW_HEIGHT / 2;

const ROW_BUTTON_WIDTH = 220;
const ROW_BUTTON_HEIGHT = 84;
const ROW_BUTTON_CENTER_X = ROW_WIDTH / 2 - 34 - ROW_BUTTON_WIDTH / 2;
const ROW_BUTTON_CENTER_Y = ROW_HEIGHT / 2;
const ROW_BUTTON_ENABLED_ALPHA = 1;
const ROW_BUTTON_DISABLED_ALPHA = 0.4;
/**
 * A locked slot greys its CARD AND COPY - that dimness is what reads as "not
 * yours yet", so it applies to every locked slot, affordable or not. The Unlock
 * BUTTON deliberately stays at full brightness (owner call): it is the call to
 * action, and fading it made the row look broken rather than locked. A button
 * the player cannot use yet is held back by being inert, not by being dim.
 */
const ROW_LOCKED_DIM_ALPHA = 0.45;

/**
 * The per-slot RECIPE STRIP (T4.2b-r1): an idle slot shows what a batch costs
 * and yields as icons rather than a sentence - input icon, "x5", an arrow, the
 * output icon, "x2". Icons are sized by DISPLAY size, not scale: a crop frame
 * is 128 native and a good icon 96, so a shared scale would render the two at
 * different sizes on the same line.
 */
const STRIP_ICON_DISPLAY_SIZE = 64;
const STRIP_INPUT_ICON_X = ROW_TEXT_LEFT_X + 32;
const STRIP_INPUT_TEXT_X = STRIP_INPUT_ICON_X + 44;
const STRIP_ARROW_X = STRIP_INPUT_TEXT_X + 78;
const STRIP_OUTPUT_ICON_X = STRIP_ARROW_X + 62;
const STRIP_OUTPUT_TEXT_X = STRIP_OUTPUT_ICON_X + 44;

/** The state icon a milling/ready row leads with - always the made good. */
const STATE_ICON_X = ROW_TEXT_LEFT_X + 32;
const STATE_ICON_DISPLAY_SIZE = 64;
/** Text on a non-idle row starts clear of that icon. */
const ROW_LABEL_X = STATE_ICON_X + 52;

/**
 * The milling progress bar. It spans from the label column to just short of
 * the row's right edge - the button is hidden while a batch runs (there is
 * nothing to press until it is ready), so nothing competes for that space.
 */
const BAR_X = ROW_LABEL_X;
/** From the label column to the row's right inset - the same 34 the card uses. */
const BAR_WIDTH = ROW_WIDTH / 2 - 34 - BAR_X;
const BAR_HEIGHT = 18;
const BAR_Y = ROW_SECONDARY_Y;
const BAR_TRACK_COLOR = 0xd8c39a;
const BAR_FILL_COLOR = 0x7fb069;

const MILL_BUTTON_LABEL = 'Mill';
const COLLECT_BUTTON_LABEL = 'Collect';
/**
 * Placeholder only - the live title is the BUILDING's own name, set every
 * `refresh` (T4.4). This panel serves every production building, so a
 * hardcoded "Flour Mill" would have titled the bakery wrong.
 */
const PANEL_TITLE_FALLBACK = 'Flour Mill';
const MILLING_LABEL = 'Milling...';
const READY_LABEL = 'Ready';
const FOOTER_TEXT = "Batches keep milling while you're away.";

/**
 * How long an armed unlock row stays armed before it disarms itself, and the
 * tint it pulses between while it is - both mirror InventoryPanel's two-tap
 * sell confirm, so "tap once to arm, again to commit" reads the same wherever
 * the player meets it.
 */
const ARM_TIMEOUT_MS = 3000;
const ARM_PULSE_FROM = 0xffd97a;
const ARM_PULSE_TO = 0xffffff;
const ARM_PULSE_HALF_MS = 420;

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

/** The "x5" / "x2" counts flanking the recipe strip's icons. */
const STRIP_COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const STRIP_ARROW_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '38px',
  fontStyle: 'bold',
  color: '#7a5518',
};

const ROW_PRIMARY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const ROW_SECONDARY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  color: '#7a5518',
};

/** The live countdown, right-aligned on the row's first line. */
const ROW_TIMER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#7a5518',
};

const ROW_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const FOOTER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  fontStyle: 'italic',
  color: '#7a5518',
};

/**
 * EXACT remaining time as `mm:ss` (T4.2b-r1) - the owner asked for a real
 * countdown, not the rounded "about 20 min" the first cut showed, so a player
 * can tell at a glance whether a batch is worth waiting out.
 */
function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `2500` -> `2,500` - thousands separators, so a five-figure price stays readable. */
function formatCoins(value: number): string {
  return value.toLocaleString('en-US');
}

/** The per-slot objects, built once per row and only re-dressed afterwards. */
interface SlotRow {
  container: Phaser.GameObjects.Container;
  card: Phaser.GameObjects.NineSlice;
  /** The made good, on milling/ready rows only. */
  stateIcon: Phaser.GameObjects.Image;
  primary: Phaser.GameObjects.Text;
  secondary: Phaser.GameObjects.Text;
  timer: Phaser.GameObjects.Text;
  barTrack: Phaser.GameObjects.Rectangle;
  barFill: Phaser.GameObjects.Rectangle;
  /** The idle row's icon recipe strip - hidden in every other state. */
  stripInputIcon: Phaser.GameObjects.Image;
  stripInputCount: Phaser.GameObjects.Text;
  stripArrow: Phaser.GameObjects.Text;
  stripOutputIcon: Phaser.GameObjects.Image;
  stripOutputCount: Phaser.GameObjects.Text;
  button: Phaser.GameObjects.NineSlice;
  buttonLabel: Phaser.GameObjects.Text;
  /** What the button does right now - re-bound per refresh, read by the handler. */
  action: (() => void) | null;
  /** Cached so interactivity only toggles on a real change. */
  interactive: boolean;
}

export class MillPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly background: Phaser.GameObjects.NineSlice;
  /** Retitled per building on every refresh (T4.4) - see PANEL_TITLE_FALLBACK. */
  private readonly title: Phaser.GameObjects.Text;
  private readonly footer: Phaser.GameObjects.Text;
  private readonly rows: SlotRow[] = [];
  private visible = false;
  /** Which placed building this panel is showing; null while hidden. */
  private buildingIndex: number | null = null;
  /** The one slot index currently armed for an unlock, or null. */
  private armedSlot: number | null = null;
  /** Real wall-clock arm time (UI timer, not game time) - drives ARM_TIMEOUT_MS. */
  private armedAt = -Infinity;
  private armPulseTween: Phaser.Tweens.Tween | null = null;
  private armedButton: Phaser.GameObjects.NineSlice | null = null;
  private readonly armPulsePhase = { t: 0 };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
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

    const bg = scene.add
      .nineslice(
        0,
        0,
        ATLAS_KEY,
        'panel',
        PANEL_WIDTH,
        ROW_STACK_TOP,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setOrigin(0.5, 0);
    this.background = bg;
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

    this.title = scene.add.text(0, TITLE_Y, PANEL_TITLE_FALLBACK, TITLE_STYLE).setOrigin(0.5);
    const closeButton = scene.add
      .text(CLOSE_OFFSET_X, CLOSE_OFFSET_Y, 'X', CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16)
      .setInteractive({ useHandCursor: true });
    closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
    });

    this.footer = scene.add.text(0, 0, FOOTER_TEXT, FOOTER_STYLE).setOrigin(0.5);

    this.container.add([bg, this.title, closeButton, this.footer]);
  }

  /**
   * One slot row, built hidden. Rows are created on demand (see `ensureRows`)
   * rather than up front, because how many a mill has is the RECIPE's
   * business - this panel never assumes a slot count.
   */
  private buildRow(): SlotRow {
    const container = this.scene.add.container(0, 0).setVisible(false);
    const card = this.scene.add
      .nineslice(
        0,
        0,
        ATLAS_KEY,
        'panel',
        ROW_WIDTH,
        ROW_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setOrigin(0.5, 0);
    // Every icon's frame is a placeholder - `dressRow` sets it (and its display
    // size) from whichever recipe the opened building carries.
    const stateIcon = this.scene.add
      .image(STATE_ICON_X, ROW_HEIGHT / 2, ATLAS_KEY, 'panel')
      .setDisplaySize(STATE_ICON_DISPLAY_SIZE, STATE_ICON_DISPLAY_SIZE)
      .setVisible(false);
    const primary = this.scene.add
      .text(ROW_LABEL_X, ROW_PRIMARY_Y, '', ROW_PRIMARY_STYLE)
      .setOrigin(0, 0.5);
    const secondary = this.scene.add
      .text(ROW_LABEL_X, ROW_SECONDARY_Y, '', ROW_SECONDARY_STYLE)
      .setOrigin(0, 0.5);
    const timer = this.scene.add
      .text(ROW_WIDTH / 2 - 34, ROW_PRIMARY_Y, '', ROW_TIMER_STYLE)
      .setOrigin(1, 0.5);
    // Both bars are LEFT-anchored (origin x 0) so the fill grows rightward from
    // the track's left edge as the batch progresses.
    const barTrack = this.scene.add
      .rectangle(BAR_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, BAR_TRACK_COLOR)
      .setOrigin(0, 0.5);
    const barFill = this.scene.add
      .rectangle(BAR_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, BAR_FILL_COLOR)
      .setOrigin(0, 0.5);
    const stripInputIcon = this.scene.add
      .image(STRIP_INPUT_ICON_X, ROW_SINGLE_LINE_Y, ATLAS_KEY, 'panel')
      .setDisplaySize(STRIP_ICON_DISPLAY_SIZE, STRIP_ICON_DISPLAY_SIZE);
    const stripInputCount = this.scene.add
      .text(STRIP_INPUT_TEXT_X, ROW_SINGLE_LINE_Y, '', STRIP_COUNT_STYLE)
      .setOrigin(0, 0.5);
    const stripArrow = this.scene.add
      .text(STRIP_ARROW_X, ROW_SINGLE_LINE_Y, '>', STRIP_ARROW_STYLE)
      .setOrigin(0.5);
    const stripOutputIcon = this.scene.add
      .image(STRIP_OUTPUT_ICON_X, ROW_SINGLE_LINE_Y, ATLAS_KEY, 'panel')
      .setDisplaySize(STRIP_ICON_DISPLAY_SIZE, STRIP_ICON_DISPLAY_SIZE);
    const stripOutputCount = this.scene.add
      .text(STRIP_OUTPUT_TEXT_X, ROW_SINGLE_LINE_Y, '', STRIP_COUNT_STYLE)
      .setOrigin(0, 0.5);
    const button = this.scene.add
      .nineslice(
        ROW_BUTTON_CENTER_X,
        ROW_BUTTON_CENTER_Y,
        ATLAS_KEY,
        'panel',
        ROW_BUTTON_WIDTH,
        ROW_BUTTON_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setVisible(false);
    const buttonLabel = this.scene.add
      .text(ROW_BUTTON_CENTER_X, ROW_BUTTON_CENTER_Y, '', ROW_BUTTON_STYLE)
      .setOrigin(0.5)
      .setVisible(false);

    const row: SlotRow = {
      container,
      card,
      stateIcon,
      primary,
      secondary,
      timer,
      barTrack,
      barFill,
      stripInputIcon,
      stripInputCount,
      stripArrow,
      stripOutputIcon,
      stripOutputCount,
      button,
      buttonLabel,
      action: null,
      interactive: false,
    };
    // The handler is bound once; which store call it makes is whatever
    // `refresh` last put in `action`, so a row switching between Mill, Collect
    // and Unlock never rebinds anything.
    button.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => row.action?.());

    container.add([
      card,
      stateIcon,
      primary,
      secondary,
      timer,
      barTrack,
      barFill,
      stripInputIcon,
      stripInputCount,
      stripArrow,
      stripOutputIcon,
      stripOutputCount,
      button,
      buttonLabel,
    ]);
    this.container.add(container);
    return row;
  }

  /** Grow the row pool to `count`; rows are never destroyed, only hidden. */
  private ensureRows(count: number): void {
    while (this.rows.length < count) this.rows.push(this.buildRow());
  }

  /**
   * Re-derive the whole panel from state - the panel's only state read, and
   * the tick that drives its live countdowns and the arm timeout.
   *
   * Every slot comes from `millSlots`, the one shared derivation the field
   * indicators read too, so panel and field can never disagree about what is
   * ready. Closes itself if the building it was opened on has gone (a dev
   * import or reset can empty the list under it).
   */
  refresh(state: GameStateData): void {
    if (this.buildingIndex === null) return;
    const placement = state.buildings[this.buildingIndex];
    const recipe = placement === undefined ? undefined : BUILDINGS[placement.type].milling;
    if (placement === undefined || recipe === undefined) {
      this.hide();
      return;
    }

    // This panel serves every production building, so it wears the name of
    // whichever one it was opened on (T4.4) - "Flour Mill" or "Bakery".
    this.title.setText(BUILDINGS[placement.type].name);

    // Per kind (T4.4): the mill counts its Sunwheat out of the bag, the bakery
    // counts its Sunflour out of the goods map.
    const held = recipeInputHeld(recipe, state.inventory, state.goods);
    const views = millSlots(placement, recipe, now());
    this.autoDisarm(views, state.coins);

    this.ensureRows(views.length);
    let cursor = ROW_STACK_TOP;
    for (let index = 0; index < this.rows.length; index++) {
      const row = this.rows[index]!;
      const view = views[index];
      if (view === undefined) {
        row.container.setVisible(false);
        continue;
      }
      row.container.setVisible(true).setY(cursor);
      cursor += ROW_HEIGHT + ROW_GAP;
      this.dressRow(row, index, view, views, recipe, held, state.coins);
    }
    this.layout(cursor - ROW_GAP);
  }

  /**
   * Drop an armed unlock when it is no longer legitimate: it timed out, the
   * slot stopped being locked (it was just bought), or the purse fell below
   * the price. Mirrors InventoryPanel's disarm-on-refresh, which exists so a
   * confirm can never sit armed over state that has moved on under it.
   */
  private autoDisarm(views: MillSlotView[], coins: number): void {
    if (this.armedSlot === null) return;
    const view = views[this.armedSlot];
    const timedOut = Date.now() - this.armedAt >= ARM_TIMEOUT_MS;
    if (timedOut || view === undefined || view.kind !== 'locked' || coins < view.cost) {
      this.disarm();
    }
  }

  /**
   * Dress one row for its slot view. The four states are mutually exclusive
   * and each turns off what the others use, so a row that changes state
   * carries nothing over from the last one.
   */
  private dressRow(
    row: SlotRow,
    index: number,
    view: MillSlotView,
    views: MillSlotView[],
    recipe: MillingRecipe,
    held: number,
    coins: number,
  ): void {
    const good = GOODS[recipe.outputGoodId];
    const idle = view.kind === 'empty';
    const milling = view.kind === 'milling';
    const ready = view.kind === 'ready';
    const locked = view.kind === 'locked';

    row.timer.setVisible(milling);
    row.barTrack.setVisible(milling);
    row.barFill.setVisible(milling);
    row.secondary.setVisible(ready);
    row.primary.setVisible(!idle);
    row.stateIcon.setVisible(milling || ready);
    // A locked row is dim; every other state is at full strength. Set both ways
    // round, so a row that has just been bought brightens on the same tick.
    row.card.setAlpha(locked ? ROW_LOCKED_DIM_ALPHA : 1);
    row.primary.setAlpha(locked ? ROW_LOCKED_DIM_ALPHA : 1);
    // With no lock glyph in front of it, a locked row's copy starts at the
    // card's own text inset rather than clear of the state icon.
    row.primary.setX(locked ? ROW_TEXT_LEFT_X : ROW_LABEL_X);
    for (const part of [
      row.stripInputIcon,
      row.stripInputCount,
      row.stripArrow,
      row.stripOutputIcon,
      row.stripOutputCount,
    ]) {
      part.setVisible(idle);
    }
    // A locked or milling row says one thing, so its line centers in the card
    // instead of sitting on the two-line grid.
    row.primary.setY(ready ? ROW_PRIMARY_Y : ROW_SINGLE_LINE_Y);

    if (idle) {
      // The recipe AS ICONS (T4.2b-r1): what a batch eats, what it yields.
      // Both frames come off the recipe, so this row never names a crop.
      row.stripInputIcon
        .setFrame(recipeInputFrame(recipe))
        .setDisplaySize(STRIP_ICON_DISPLAY_SIZE, STRIP_ICON_DISPLAY_SIZE);
      row.stripInputCount.setText(`x${recipe.inputCount}`);
      row.stripOutputIcon
        .setFrame(good.frame)
        .setDisplaySize(STRIP_ICON_DISPLAY_SIZE, STRIP_ICON_DISPLAY_SIZE);
      row.stripOutputCount.setText(`x${recipe.outputCount}`);
      // The store is still the authority on whether this succeeds; the button's
      // enabled state only says whether it is worth pressing.
      this.setButton(row, MILL_BUTTON_LABEL, held >= recipe.inputCount, () => this.mill());
      return;
    }

    if (milling) {
      row.stateIcon
        .setFrame(good.frame)
        .setDisplaySize(STATE_ICON_DISPLAY_SIZE, STATE_ICON_DISPLAY_SIZE);
      row.primary.setText(MILLING_LABEL);
      row.timer.setText(formatRemaining(view.remainingMs));
      const fraction = Phaser.Math.Clamp(1 - view.remainingMs / recipe.batchMs, 0, 1);
      // Width, not scale: a zero-width rectangle is simply invisible, which is
      // exactly what a batch that just started should look like.
      row.barFill.setSize(BAR_WIDTH * fraction, BAR_HEIGHT);
      this.setButton(row, '', false, null);
      return;
    }

    if (ready) {
      row.stateIcon
        .setFrame(good.frame)
        .setDisplaySize(STATE_ICON_DISPLAY_SIZE, STATE_ICON_DISPLAY_SIZE);
      row.primary.setText(READY_LABEL);
      row.secondary.setText(`${recipe.outputCount} ${good.pluralName}`);
      const { batchIndex } = view;
      this.setButton(row, COLLECT_BUTTON_LABEL, true, () => this.collect(batchIndex));
      return;
    }

    // Locked. Only the LOWEST locked slot is buyable - unlocks are sequential,
    // so a later slot shows its price but stays inert until the earlier one is
    // bought. `unlockMillSlot` enforces the same order; this only mirrors it.
    const { cost } = view;
    const next = views.findIndex((candidate) => candidate.kind === 'locked') === index;
    const affordable = coins >= cost;
    const armed = this.armedSlot === index;
    row.primary.setText(
      armed ? `Confirm - pay ${formatCoins(cost)}` : `Unlock - ${formatCoins(cost)} coins`,
    );
    // `false` for dimWhenDisabled: the Unlock button keeps full brightness even
    // when it is not yet pressable (see ROW_LOCKED_DIM_ALPHA).
    const buyable = next && affordable;
    this.setButton(row, armed ? 'Confirm' : 'Unlock', buyable, () => this.tapUnlock(index), false);
  }

  /**
   * Set a row's button copy, enabled look and action in one place. A null
   * action hides the button entirely (a milling row has nothing to press);
   * a disabled one stays visible and inert, so the player can see what they
   * are working toward.
   *
   * `dimWhenDisabled` is what a disabled button LOOKS like. The Mill button
   * fades when the bag is short - the row around it is bright, so the fade is
   * the only signal. A locked slot's Unlock button does not: its whole row is
   * already dimmed, and fading the button on top of that read as broken.
   */
  private setButton(
    row: SlotRow,
    label: string,
    enabled: boolean,
    action: (() => void) | null,
    dimWhenDisabled = true,
  ): void {
    row.action = enabled ? action : null;
    const shown = action !== null;
    row.button
      .setVisible(shown)
      .setAlpha(enabled || !dimWhenDisabled ? ROW_BUTTON_ENABLED_ALPHA : ROW_BUTTON_DISABLED_ALPHA);
    row.buttonLabel.setVisible(shown).setText(label);
    const interactive = shown && enabled;
    if (interactive === row.interactive) return;
    row.interactive = interactive;
    if (interactive) {
      row.button.setInteractive({ useHandCursor: true });
    } else {
      row.button.disableInteractive();
    }
  }

  /**
   * Start a batch. The store re-checks the bag and the slot cap, so a double
   * tap or a stale button can never start one it should not have.
   */
  private mill(): void {
    if (this.buildingIndex === null) return;
    if (!gameState.startMilling(this.buildingIndex)) return;
    this.audio.sfx('tap');
    this.refresh(gameState.getState());
  }

  /**
   * Collect a finished batch. `collectMilling` re-derives readiness itself and
   * returns 0 when the batch is not ready, so nothing is granted on a stale tap.
   */
  private collect(batchIndex: number): void {
    if (this.buildingIndex === null) return;
    if (gameState.collectMilling(this.buildingIndex, batchIndex) === 0) return;
    this.audio.bagpop();
    this.refresh(gameState.getState());
  }

  /**
   * TWO-TAP unlock (T4.2b-r1), InventoryPanel's sell confirm applied to a
   * purchase: the first tap arms the row, the second spends. Real money never
   * leaves on one tap, and `unlockMillSlot` re-checks the price and the order
   * anyway, so an armed row over stale state still cannot overspend.
   */
  private tapUnlock(index: number): void {
    if (this.buildingIndex === null) return;
    if (this.armedSlot !== index) {
      this.armRow(index);
      this.audio.sfx('tap');
      this.refresh(gameState.getState());
      return;
    }
    this.disarm();
    if (!gameState.unlockMillSlot(this.buildingIndex)) {
      this.refresh(gameState.getState());
      return;
    }
    this.audio.bagpop();
    this.refresh(gameState.getState());
  }

  private armRow(index: number): void {
    this.armedSlot = index;
    this.armedAt = Date.now();
  }

  private disarm(): void {
    if (this.armedSlot === null) return;
    this.armedSlot = null;
    this.armedAt = -Infinity;
    this.stopArmedPulse();
  }

  /** "Brighter/pulsing" armed highlight - a tint pulse, InventoryPanel's convention. */
  private startArmedPulse(button: Phaser.GameObjects.NineSlice): void {
    if (this.armedButton === button && this.armPulseTween !== null) return;
    this.stopArmedPulse();
    this.armedButton = button;
    this.armPulsePhase.t = 0;
    this.armPulseTween = this.scene.tweens.add({
      targets: this.armPulsePhase,
      t: 1,
      duration: ARM_PULSE_HALF_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const color = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(ARM_PULSE_FROM),
          Phaser.Display.Color.ValueToColor(ARM_PULSE_TO),
          100,
          Math.round(this.armPulsePhase.t * 100),
        );
        this.armedButton?.setTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
      },
    });
  }

  private stopArmedPulse(): void {
    this.armPulseTween?.stop();
    this.armPulseTween = null;
    this.armedButton?.clearTint();
    this.armedButton = null;
  }

  /**
   * Size the background to the measured stack and re-center the panel. Because
   * the container is top-anchored, its y is the panel's TOP edge, so centering
   * means offsetting by half the height. The footer rides the stack's bottom.
   */
  private layout(stackBottom: number): void {
    // The armed row's pulse is started here rather than in `dressRow` so it
    // survives the per-tick re-dress without being torn down and rebuilt.
    if (this.armedSlot === null) this.stopArmedPulse();
    else {
      const armed = this.rows[this.armedSlot];
      if (armed !== undefined) this.startArmedPulse(armed.button);
    }
    this.footer.setY(stackBottom + FOOTER_GAP);
    const height = stackBottom + FOOTER_GAP + PANEL_BOTTOM_MARGIN;
    this.background.setSize(PANEL_WIDTH, height);
    this.container.setY(PANEL_CENTER_Y - height / 2);
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Open on the building at `index` (the field tap's building). */
  show(state: GameStateData, index: number): void {
    this.buildingIndex = index;
    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('mill', true);
    this.refresh(state);
  }

  hide(): void {
    this.visible = false;
    this.buildingIndex = null;
    // Closing disarms: an armed confirm must never survive to the next open.
    this.disarm();
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('mill', false);
  }
}
