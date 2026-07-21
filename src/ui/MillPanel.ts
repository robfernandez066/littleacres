import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { BUILDINGS, type MillingRecipe } from '../data/buildings';
import { CROPS } from '../data/crops';
import { GOODS } from '../data/goods';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData, millSlots, type MillSlotView } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { now } from '../systems/time';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * The mill's face (T4.2b) - where the player loads batches and collects the
 * flour they made. Opened by tapping the mill on the field.
 *
 * This panel OWNS NO MILLING RULE. Every slot it draws comes from the pure
 * `millSlots` derivation, and both buttons hand straight off to
 * `gameState.startMilling` / `gameState.collectMilling`, which already refuse a
 * short bag, a full mill, and an unfinished batch. Every number and name in the
 * copy is read from the building's own `MillingRecipe` and the crop/good
 * registries, so re-balancing the recipe re-words the panel with it - nothing
 * here is a literal.
 *
 * Renders purely from the `GameStateData` passed to `refresh`, which the HUD
 * calls every tick while the panel is visible - that tick is what makes the
 * countdowns and progress bars live.
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
const RECIPE_ROW_Y = 152;
const SUBTITLE_Y = 216;
const ON_HAND_Y = 268;
/** Where the first slot row's top edge sits. */
const ROW_STACK_TOP = 312;
const ROW_GAP = 16;
/** Gap between the last row's bottom edge and the footer's baseline. */
const FOOTER_GAP = 46;
const PANEL_BOTTOM_MARGIN = 34;

/**
 * The recipe line's icons and numbers, laid out around the panel's center.
 * The two icons are sized by DISPLAY size, not scale: a crop frame is 128
 * native and a good icon 96, so a shared scale would render them at different
 * sizes on the same line.
 */
const RECIPE_ICON_DISPLAY_SIZE = 76;
const RECIPE_INPUT_ICON_X = -250;
const RECIPE_INPUT_TEXT_X = RECIPE_INPUT_ICON_X + 62;
const RECIPE_OUTPUT_ICON_X = 120;
const RECIPE_OUTPUT_TEXT_X = RECIPE_OUTPUT_ICON_X + 62;
const RECIPE_ARROW_X = 0;

/** The read-only on-hand counts: input crop on the left, made good on the right. */
const ON_HAND_LEFT_X = -PANEL_WIDTH / 2 + 56;
const ON_HAND_RIGHT_X = PANEL_WIDTH / 2 - 56;

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
/** An empty row has one line only, so it centers instead. */
const ROW_SINGLE_LINE_Y = ROW_HEIGHT / 2;

const ROW_BUTTON_WIDTH = 220;
const ROW_BUTTON_HEIGHT = 84;
const ROW_BUTTON_CENTER_X = ROW_WIDTH / 2 - 34 - ROW_BUTTON_WIDTH / 2;
const ROW_BUTTON_CENTER_Y = ROW_HEIGHT / 2;
const ROW_BUTTON_ENABLED_ALPHA = 1;
const ROW_BUTTON_DISABLED_ALPHA = 0.4;

/**
 * The milling progress bar. It spans the row's full text width because the
 * button is hidden while a batch runs (there is nothing to press until it is
 * ready), so nothing else competes for that space.
 */
const BAR_WIDTH = ROW_WIDTH - 68;
const BAR_HEIGHT = 18;
const BAR_Y = ROW_SECONDARY_Y;
const BAR_TRACK_COLOR = 0xd8c39a;
const BAR_FILL_COLOR = 0x7fb069;

const MILL_BUTTON_LABEL = 'Mill';
const COLLECT_BUTTON_LABEL = 'Collect';
const PANEL_TITLE = 'Flour Mill';
const MILLING_LABEL = 'Milling...';
const READY_LABEL = 'Ready';
const FOOTER_TEXT = "Batches keep milling while you're away.";

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

const RECIPE_COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '44px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const RECIPE_ARROW_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#7a5518',
};

const SUBTITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  color: '#7a5518',
  align: 'center',
};

const ON_HAND_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  fontStyle: 'bold',
  color: '#4a3218',
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

/** `45s` under a minute, `3m 20s` from a minute up - mirrors CropCountdown. */
function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/** The per-slot objects, built once per row and only re-dressed afterwards. */
interface SlotRow {
  container: Phaser.GameObjects.Container;
  card: Phaser.GameObjects.NineSlice;
  primary: Phaser.GameObjects.Text;
  secondary: Phaser.GameObjects.Text;
  timer: Phaser.GameObjects.Text;
  barTrack: Phaser.GameObjects.Rectangle;
  barFill: Phaser.GameObjects.Rectangle;
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
  private readonly inputIcon: Phaser.GameObjects.Image;
  private readonly inputCount: Phaser.GameObjects.Text;
  private readonly outputIcon: Phaser.GameObjects.Image;
  private readonly outputCount: Phaser.GameObjects.Text;
  private readonly subtitle: Phaser.GameObjects.Text;
  private readonly onHandInput: Phaser.GameObjects.Text;
  private readonly onHandOutput: Phaser.GameObjects.Text;
  private readonly footer: Phaser.GameObjects.Text;
  private readonly rows: SlotRow[] = [];
  private visible = false;
  /** Which placed building this panel is showing; null while hidden. */
  private buildingIndex: number | null = null;

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

    const title = scene.add.text(0, TITLE_Y, PANEL_TITLE, TITLE_STYLE).setOrigin(0.5);
    const closeButton = scene.add
      .text(CLOSE_OFFSET_X, CLOSE_OFFSET_Y, 'X', CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16)
      .setInteractive({ useHandCursor: true });
    closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
    });

    // The recipe line's frames and counts are placeholders here - `refresh`
    // sets both (and each icon's display size) from whichever recipe the
    // opened building carries.
    this.inputIcon = scene.add.image(RECIPE_INPUT_ICON_X, RECIPE_ROW_Y, ATLAS_KEY, 'panel');
    this.inputCount = scene.add
      .text(RECIPE_INPUT_TEXT_X, RECIPE_ROW_Y, '', RECIPE_COUNT_STYLE)
      .setOrigin(0, 0.5);
    const arrow = scene.add
      .text(RECIPE_ARROW_X, RECIPE_ROW_Y, '>', RECIPE_ARROW_STYLE)
      .setOrigin(0.5);
    this.outputIcon = scene.add.image(RECIPE_OUTPUT_ICON_X, RECIPE_ROW_Y, ATLAS_KEY, 'panel');
    this.outputCount = scene.add
      .text(RECIPE_OUTPUT_TEXT_X, RECIPE_ROW_Y, '', RECIPE_COUNT_STYLE)
      .setOrigin(0, 0.5);

    this.subtitle = scene.add.text(0, SUBTITLE_Y, '', SUBTITLE_STYLE).setOrigin(0.5);
    this.onHandInput = scene.add
      .text(ON_HAND_LEFT_X, ON_HAND_Y, '', ON_HAND_STYLE)
      .setOrigin(0, 0.5);
    this.onHandOutput = scene.add
      .text(ON_HAND_RIGHT_X, ON_HAND_Y, '', ON_HAND_STYLE)
      .setOrigin(1, 0.5);
    this.footer = scene.add.text(0, 0, FOOTER_TEXT, FOOTER_STYLE).setOrigin(0.5);

    this.container.add([
      bg,
      title,
      closeButton,
      this.inputIcon,
      this.inputCount,
      arrow,
      this.outputIcon,
      this.outputCount,
      this.subtitle,
      this.onHandInput,
      this.onHandOutput,
      this.footer,
    ]);
  }

  /**
   * One slot row, built hidden. Rows are created on demand (see
   * `ensureRows`) rather than up front, because how many a mill has is the
   * RECIPE's business - this panel never assumes a slot count.
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
    const primary = this.scene.add
      .text(ROW_TEXT_LEFT_X, ROW_PRIMARY_Y, '', ROW_PRIMARY_STYLE)
      .setOrigin(0, 0.5);
    const secondary = this.scene.add
      .text(ROW_TEXT_LEFT_X, ROW_SECONDARY_Y, '', ROW_SECONDARY_STYLE)
      .setOrigin(0, 0.5);
    const timer = this.scene.add
      .text(ROW_WIDTH / 2 - 34, ROW_PRIMARY_Y, '', ROW_TIMER_STYLE)
      .setOrigin(1, 0.5);
    // Both bars are LEFT-anchored (origin x 0) so the fill grows rightward from
    // the track's left edge as the batch progresses.
    const barTrack = this.scene.add
      .rectangle(ROW_TEXT_LEFT_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, BAR_TRACK_COLOR)
      .setOrigin(0, 0.5);
    const barFill = this.scene.add
      .rectangle(ROW_TEXT_LEFT_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, BAR_FILL_COLOR)
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
      primary,
      secondary,
      timer,
      barTrack,
      barFill,
      button,
      buttonLabel,
      action: null,
      interactive: false,
    };
    // The handler is bound once; which store call it makes is whatever
    // `refresh` last put in `action`, so a row switching between Mill and
    // Collect never rebinds anything.
    button.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => row.action?.());

    container.add([card, primary, secondary, timer, barTrack, barFill, button, buttonLabel]);
    this.container.add(container);
    return row;
  }

  /** Grow the row pool to `count`; rows are never destroyed, only hidden. */
  private ensureRows(count: number): void {
    while (this.rows.length < count) this.rows.push(this.buildRow());
  }

  /**
   * Re-derive the whole panel from state - the panel's only state read, and
   * the tick that drives its live countdowns.
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

    const crop = CROPS[recipe.inputCropId];
    const good = GOODS[recipe.outputGoodId];
    const held = state.inventory[recipe.inputCropId] ?? 0;
    const made = state.goods[recipe.outputGoodId] ?? 0;

    this.inputIcon
      .setFrame(crop.stageFrames[2])
      .setDisplaySize(RECIPE_ICON_DISPLAY_SIZE, RECIPE_ICON_DISPLAY_SIZE);
    this.inputCount.setText(String(recipe.inputCount));
    this.outputIcon
      .setFrame(good.frame)
      .setDisplaySize(RECIPE_ICON_DISPLAY_SIZE, RECIPE_ICON_DISPLAY_SIZE);
    this.outputCount.setText(String(recipe.outputCount));
    this.subtitle.setText(this.subtitleText(recipe));
    this.onHandInput.setText(`Your ${crop.pluralName}: ${held}`);
    this.onHandOutput.setText(`${good.pluralName}: ${made}`);

    const views = millSlots(placement, recipe, now());
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
      this.dressRow(row, view, recipe, held);
    }
    this.layout(cursor - ROW_GAP);
  }

  /**
   * The recipe's own sentence: "5 Sunwheat makes 2 Sunflour - about 20 min a
   * batch". Every number and name comes off the recipe and the registries, so
   * a re-balance rewrites this line rather than stranding it.
   */
  private subtitleText(recipe: MillingRecipe): string {
    const crop = CROPS[recipe.inputCropId];
    const good = GOODS[recipe.outputGoodId];
    const minutes = Math.round(recipe.batchMs / 60_000);
    return `${recipe.inputCount} ${crop.pluralName} makes ${recipe.outputCount} ${good.pluralName} - about ${minutes} min a batch`;
  }

  /**
   * Dress one row for its slot view. The three states are mutually exclusive
   * and each turns off what the others use, so a row that changes state
   * carries nothing over from the last one.
   */
  private dressRow(row: SlotRow, view: MillSlotView, recipe: MillingRecipe, held: number): void {
    const crop = CROPS[recipe.inputCropId];
    const good = GOODS[recipe.outputGoodId];
    const milling = view.kind === 'milling';
    const ready = view.kind === 'ready';

    row.timer.setVisible(milling);
    row.barTrack.setVisible(milling);
    row.barFill.setVisible(milling);
    row.secondary.setVisible(ready);
    // An empty row says one thing, so its line centers in the card instead of
    // sitting on the two-line grid.
    row.primary.setY(view.kind === 'empty' ? ROW_SINGLE_LINE_Y : ROW_PRIMARY_Y);

    if (view.kind === 'empty') {
      row.primary.setText(`Load ${recipe.inputCount} ${crop.pluralName} to start a batch`);
      // The store is still the authority on whether this succeeds; the button's
      // enabled state only says whether it is worth pressing.
      this.setButton(row, MILL_BUTTON_LABEL, held >= recipe.inputCount, () => this.mill());
      return;
    }
    if (milling) {
      row.primary.setText(MILLING_LABEL);
      row.timer.setText(formatRemaining(view.remainingMs));
      const fraction = Phaser.Math.Clamp(1 - view.remainingMs / recipe.batchMs, 0, 1);
      // Width, not scale: a zero-width rectangle is simply invisible, which is
      // exactly what a batch that just started should look like.
      row.barFill.setSize(BAR_WIDTH * fraction, BAR_HEIGHT);
      this.setButton(row, '', false, null);
      return;
    }
    row.primary.setText(READY_LABEL);
    row.secondary.setText(`${recipe.outputCount} ${good.pluralName}`);
    const { batchIndex } = view;
    this.setButton(row, COLLECT_BUTTON_LABEL, true, () => this.collect(batchIndex));
  }

  /**
   * Set a row's button copy, enabled look and action in one place. A null
   * action hides the button entirely (a milling row has nothing to press);
   * a disabled one stays visible but faded and inert, so the player can see
   * what they are working toward.
   */
  private setButton(
    row: SlotRow,
    label: string,
    enabled: boolean,
    action: (() => void) | null,
  ): void {
    row.action = enabled ? action : null;
    const shown = action !== null;
    row.button
      .setVisible(shown)
      .setAlpha(enabled ? ROW_BUTTON_ENABLED_ALPHA : ROW_BUTTON_DISABLED_ALPHA);
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
   * Size the background to the measured stack and re-center the panel. Because
   * the container is top-anchored, its y is the panel's TOP edge, so centering
   * means offsetting by half the height. The footer rides the stack's bottom.
   */
  private layout(stackBottom: number): void {
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
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('mill', false);
  }
}
