import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import {
  GOALS,
  GOALS_PANEL_SUBTITLE,
  GOALS_PANEL_TITLE,
  goalActionLabel,
  goalLockedNote,
  goalViews,
  type GoalDef,
} from '../data/goals';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * The Goals hub (T3.30) - one discoverable place listing the long-horizon
 * objectives a player saves toward, opened from the HUD's goals icon.
 *
 * This is a TRACKING AND LAUNCHER layer, never a shop: no entry buys anything.
 * A restoration row opens the existing RestorePanel (which owns that purchase);
 * a region row closes this panel and glides the camera to the region's on-field
 * sign (which owns that purchase). Every price, perk, gate and grant shown here
 * is read from `data/goals.ts`, which in turn reads `data/restoration.ts` and
 * `data/farm.ts` REGIONS - nothing is restated locally.
 *
 * Renders purely from the `GameStateData` passed to `refresh`; the rows are
 * built once at construction and only their copy/interactivity change, so the
 * panel allocates nothing per tick.
 */

const PANEL_WIDTH = 940;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 780;
/** Same tier as the bag/quest panels: above the seed bar (2000), below flying coins (2200). */
const PANEL_DEPTH = 2100;
const BACKDROP_DEPTH = 2090;

/**
 * The panel is TOP-ANCHORED: the container's origin is the panel's top edge
 * and every constant below is measured down from it. The panel's HEIGHT is not
 * a constant at all - completed goals collapse to a shorter card (see
 * CARD_HEIGHT_DONE), so `layout` re-measures the stack, resizes the background
 * to hug it, and re-centers the whole panel on PANEL_CENTER_Y. Anchoring from
 * the top is what keeps the title/subtitle fixed while the bottom edge moves.
 */
const TITLE_Y = 60;
const SUBTITLE_Y = 118;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = 50;
/** Where the first card's top edge sits, below the subtitle. */
const CARD_STACK_TOP = 180;
const CARD_GAP = 24;
/** Breathing room between the last card's bottom edge and the panel's. */
const PANEL_BOTTOM_MARGIN = 34;

/**
 * One card per goal, stacked. Cards are `panel` nineslices sized directly to
 * their display bounds, so their default interactive area already covers the
 * whole visible card (the arrange-row button convention) and no custom hit
 * area is needed here. Cards are TOP-anchored too, so switching a card between
 * its active and completed heights only moves its bottom edge.
 */
const CARD_WIDTH = PANEL_WIDTH - 90;
/**
 * Active cards come in two heights (T3.30-r1). Both carry title, reward, price
 * and a status line; an ACTIONABLE card then adds the call-to-action button on
 * a row of its own, and a LOCKED one does not. Giving locked cards the taller
 * height too would leave ~120px of empty card under their requirement line -
 * the same dead space the panel's own hug-the-stack sizing exists to avoid.
 *
 * The actionable height covers the tallest case: a TWO-line progress block
 * (T3.30-r2) ending ~243, then the button spanning 248..336, plus the same
 * ~24px bottom margin every card keeps. A locked card's single requirement
 * line ends ~226, so 240 keeps its own margin too.
 */
const CARD_HEIGHT_ACTIONABLE = 360;
const CARD_HEIGHT_LOCKED = 240;
/** A completed card collapses to its past-tense title alone. */
const CARD_HEIGHT_DONE = 92;
/**
 * Locked and completed cards must NOT read the same. Fading both (the first
 * cut did) collapses two opposite meanings into one "disabled" look, so the
 * two states differ in KIND, not just degree:
 * - LOCKED stays at FULL strength. It is a live objective you are working
 *   toward, so it stays legible and present; its soft-red "Locked:" tag (see
 *   CARD_LOCK_LABEL_STYLE) is what says you cannot act on it yet.
 * - COMPLETED is the faded one, plus a green wash (see CARD_DONE_WASH_*). It
 *   is a finished record sitting at the bottom of the list, so it recedes.
 */
const CARD_ENABLED_ALPHA = 1;
const CARD_LOCKED_ALPHA = 1;
const CARD_DONE_ALPHA = 0.55;
/**
 * The completed card's green wash. NineSlice does not implement Phaser's Tint
 * component, so this is a plain filled Rectangle laid over the card rather
 * than a tint. Inset by CARD_DONE_WASH_INSET so it stays INSIDE the panel
 * frame's border and rounded corners instead of squaring them off.
 */
const CARD_DONE_WASH_COLOR = 0x7fb069;
const CARD_DONE_WASH_ALPHA = 0.25;
const CARD_DONE_WASH_INSET = 9;

/** Card-local rows, measured DOWN from the card's own top edge. */
const CARD_TITLE_Y = 44;
const CARD_REWARD_Y = 96;
const CARD_PRICE_Y = 150;
/**
 * The status line's block CENTER (origin y 0.5), so it grows symmetrically as
 * its line count changes (T3.30-r2 - the restoration's progress is now one
 * line per currency). At 210 the two-line block spans ~177..243, clearing the
 * price row above (which ends ~167) and the CTA button below (which starts at
 * 248). A locked card's single line centers on the same 210, which is also
 * where its "Locked:" tag sits.
 */
const CARD_STATUS_Y = 210;
/** The lone title on a collapsed completed card sits centered in its height. */
const CARD_DONE_TITLE_Y = CARD_HEIGHT_DONE / 2;
const CARD_TEXT_LEFT_X = -CARD_WIDTH / 2 + 34;

const PRICE_ICON_NATIVE_SIZE = 96;
const PRICE_ICON_DISPLAY_SIZE = 40;
const PRICE_ICON_SCALE = PRICE_ICON_DISPLAY_SIZE / PRICE_ICON_NATIVE_SIZE;
/** Coin icon, coin amount, then (when the goal costs it) moondust icon + amount. */
const PRICE_COIN_ICON_X = CARD_TEXT_LEFT_X + PRICE_ICON_DISPLAY_SIZE / 2;
const PRICE_COIN_TEXT_X = PRICE_COIN_ICON_X + 32;
const PRICE_DUST_ICON_X = PRICE_COIN_TEXT_X + 210;
const PRICE_DUST_TEXT_X = PRICE_DUST_ICON_X + 32;

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const SUBTITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  color: '#7a5518',
  align: 'center',
};

const CLOSE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const CARD_TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '38px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const CARD_REWARD_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  fontStyle: 'bold',
  color: '#4a7a2e',
};

const CARD_PRICE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const CARD_STATUS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  color: '#7a5518',
};

/**
 * The "Locked:" tag that introduces a level-locked card's requirement. A SOFT
 * red - muted and warm, deliberately not a blood red (#cc0000 and friends):
 * this is a "come back later" note in a cozy game, not an error. Bold at the
 * status line's own size so it reads as a label on the requirement rather than
 * a separate sentence.
 */
const CARD_LOCK_LABEL_TEXT = 'Locked:';
const CARD_LOCK_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  fontStyle: 'bold',
  color: '#c25b4d',
};
/** Gap between the "Locked:" tag and the requirement that follows it. */
const CARD_LOCK_LABEL_GAP = 8;

/**
 * The completed card's "Complete" tag, small and italic on the far right -
 * the counterweight to the past-tense title on the left. Italic and quiet on
 * purpose: it annotates the row rather than competing with its title.
 */
const CARD_DONE_TAG_TEXT = 'Complete';
const CARD_DONE_TAG_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '22px',
  fontStyle: 'italic',
  color: '#4a7a2e',
};
/** Mirrors CARD_TEXT_LEFT_X's inset, measured from the card's right edge. */
const CARD_DONE_TAG_RIGHT_X = CARD_WIDTH / 2 - 34;

/**
 * The call-to-action button on an ACTIONABLE card (T3.30-r1) - "Go There" on a
 * region, "Restore" on the restoration (see `goalActionLabel`). Built like the
 * RestorePanel's Buy button: a `panel` nineslice sized directly to its display
 * bounds (so its default interactive area already covers the whole visible
 * button, per the hit-area rule) with a centered Arial-bold label.
 *
 * This is now the card's ONLY tap target - the card body itself is inert, so
 * a stray tap while reading a goal no longer flings the camera across the farm.
 */
const CTA_BUTTON_WIDTH = 240;
const CTA_BUTTON_HEIGHT = 88;
/** Bottom-right, its right edge inset like the "Complete" tag's. */
const CTA_BUTTON_CENTER_X = CARD_WIDTH / 2 - 34 - CTA_BUTTON_WIDTH / 2;
const CTA_BUTTON_CENTER_Y = 292;
/** Matches RestorePanel's BUY_STYLE. */
const CTA_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/**
 * A completed card's title: the SAME text as an active one, restyled - sized
 * down to fit the collapsed height, in a deep green that carries the achieved
 * feeling without changing a word of the copy.
 */
const CARD_DONE_TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#35601c',
};

/** What the scene does when a row is tapped - both flows already exist. */
export interface GoalsPanelActions {
  /** Open the existing RestorePanel (FarmScene.openRestorePanel). */
  onRestoration: () => void;
  /** Glide the camera to this region's on-field sign, which owns the purchase. */
  onFocusRegion: (regionId: string) => void;
}

/**
 * The per-card objects `refresh` re-derives; built once, never reallocated.
 * A row is permanently bound to ONE goal - only its position and copy change,
 * so reordering the stack never rebuilds anything.
 */
interface GoalRow {
  def: GoalDef;
  card: Phaser.GameObjects.NineSlice;
  container: Phaser.GameObjects.Container;
  title: Phaser.GameObjects.Text;
  reward: Phaser.GameObjects.Text;
  priceObjects: Phaser.GameObjects.GameObject[];
  status: Phaser.GameObjects.Text;
  /** The soft-red "Locked:" tag; shown only on a level-locked card. */
  lockLabel: Phaser.GameObjects.Text;
  /** Where `status` starts when the "Locked:" tag precedes it (measured once). */
  lockedStatusX: number;
  /** The italic "Complete" tag on the card's far right; completed rows only. */
  doneTag: Phaser.GameObjects.Text;
  /** The completed-state green wash; hidden in every other state. */
  wash: Phaser.GameObjects.Rectangle;
  /** The call-to-action button and its label; shown only while actionable. */
  ctaButton: Phaser.GameObjects.NineSlice;
  ctaLabel: Phaser.GameObjects.Text;
  /** Cached so the button's interactivity only toggles on a real change. */
  interactive: boolean;
}

export class GoalsPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly background: Phaser.GameObjects.NineSlice;
  private readonly rows: GoalRow[] = [];
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
    private readonly actions: GoalsPanelActions,
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

    // Top-anchored (origin y 0) so `layout` can grow/shrink the panel downward
    // without moving the title, subtitle or close button.
    const bg = scene.add
      .nineslice(
        0,
        0,
        ATLAS_KEY,
        'panel',
        PANEL_WIDTH,
        CARD_STACK_TOP,
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
    const title = scene.add.text(0, TITLE_Y, GOALS_PANEL_TITLE, TITLE_STYLE).setOrigin(0.5);
    const subtitle = scene.add
      .text(0, SUBTITLE_Y, GOALS_PANEL_SUBTITLE, SUBTITLE_STYLE)
      .setOrigin(0.5);
    const closeButton = scene.add
      .text(CLOSE_OFFSET_X, CLOSE_OFFSET_Y, 'X', CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16)
      .setInteractive({ useHandCursor: true });
    closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
    });
    this.container.add([bg, title, subtitle, closeButton]);

    // One card per registered goal - a future goal appears here purely by
    // joining GOALS. Positions are assigned by `layout`, not here: the stack
    // order depends on which goals are already completed.
    for (const def of GOALS) {
      this.rows.push(this.buildRow(def));
    }
    this.refresh(gameState.getState());
  }

  /**
   * One goal card: title, reward, price row and a status/progress line. The
   * card and its text are TOP-anchored (see CARD_STACK_TOP's comment), and the
   * position is assigned later by `layout`.
   */
  private buildRow(def: GoalDef): GoalRow {
    const container = this.scene.add.container(0, 0);
    const card = this.scene.add
      .nineslice(
        0,
        0,
        ATLAS_KEY,
        'panel',
        CARD_WIDTH,
        CARD_HEIGHT_ACTIONABLE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setOrigin(0.5, 0);
    // Drawn between the card and its text so the wash colours the card face
    // without washing out the title on top of it.
    const wash = this.scene.add
      .rectangle(
        0,
        CARD_DONE_WASH_INSET,
        CARD_WIDTH - CARD_DONE_WASH_INSET * 2,
        CARD_HEIGHT_DONE - CARD_DONE_WASH_INSET * 2,
        CARD_DONE_WASH_COLOR,
        CARD_DONE_WASH_ALPHA,
      )
      .setOrigin(0.5, 0)
      .setVisible(false);
    const title = this.scene.add
      .text(CARD_TEXT_LEFT_X, CARD_TITLE_Y, def.title, CARD_TITLE_STYLE)
      .setOrigin(0, 0.5);
    // Right-aligned (origin x 1) so it hugs the card's right edge, on the same
    // line as the collapsed card's title.
    const doneTag = this.scene.add
      .text(CARD_DONE_TAG_RIGHT_X, CARD_DONE_TITLE_Y, CARD_DONE_TAG_TEXT, CARD_DONE_TAG_STYLE)
      .setOrigin(1, 0.5)
      .setVisible(false);
    const reward = this.scene.add
      .text(CARD_TEXT_LEFT_X, CARD_REWARD_Y, def.reward, CARD_REWARD_STYLE)
      .setOrigin(0, 0.5);
    const lockLabel = this.scene.add
      .text(CARD_TEXT_LEFT_X, CARD_STATUS_Y, CARD_LOCK_LABEL_TEXT, CARD_LOCK_LABEL_STYLE)
      .setOrigin(0, 0.5)
      .setVisible(false);
    // Measured once, from the tag's own rendered width, so the requirement
    // always clears it regardless of font metrics.
    const lockedStatusX = CARD_TEXT_LEFT_X + lockLabel.width + CARD_LOCK_LABEL_GAP;
    const status = this.scene.add
      .text(CARD_TEXT_LEFT_X, CARD_STATUS_Y, '', CARD_STATUS_STYLE)
      .setOrigin(0, 0.5);

    const priceObjects: Phaser.GameObjects.GameObject[] = [
      this.scene.add
        .image(PRICE_COIN_ICON_X, CARD_PRICE_Y, ATLAS_KEY, 'coin')
        .setScale(PRICE_ICON_SCALE),
      this.scene.add
        .text(
          PRICE_COIN_TEXT_X,
          CARD_PRICE_Y,
          def.costCoins.toLocaleString('en-US'),
          CARD_PRICE_STYLE,
        )
        .setOrigin(0, 0.5),
    ];
    if (def.costMoondust > 0) {
      priceObjects.push(
        this.scene.add
          .image(PRICE_DUST_ICON_X, CARD_PRICE_Y, ATLAS_KEY, 'moondust')
          .setScale(PRICE_ICON_SCALE),
        this.scene.add
          .text(PRICE_DUST_TEXT_X, CARD_PRICE_Y, String(def.costMoondust), CARD_PRICE_STYLE)
          .setOrigin(0, 0.5),
      );
    }

    // The call-to-action button - built hidden and inert; `refresh` shows it
    // only while this goal is actionable. The card body gets NO handler: this
    // button is the row's only tap target.
    const ctaButton = this.scene.add
      .nineslice(
        CTA_BUTTON_CENTER_X,
        CTA_BUTTON_CENTER_Y,
        ATLAS_KEY,
        'panel',
        CTA_BUTTON_WIDTH,
        CTA_BUTTON_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setVisible(false);
    const ctaLabel = this.scene.add
      .text(CTA_BUTTON_CENTER_X, CTA_BUTTON_CENTER_Y, goalActionLabel(def), CTA_BUTTON_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    ctaButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.activate(def));

    container.add([
      card,
      wash,
      title,
      doneTag,
      reward,
      status,
      lockLabel,
      ...priceObjects,
      ctaButton,
      ctaLabel,
    ]);
    this.container.add(container);

    return {
      def,
      card,
      container,
      title,
      reward,
      priceObjects,
      status,
      lockLabel,
      lockedStatusX,
      doneTag,
      wash,
      ctaButton,
      ctaLabel,
      interactive: false,
    };
  }

  /**
   * A row's call-to-action tap. Only ever reached while the button is shown
   * and interactive (status 'open' - see `refresh`), and each branch hands
   * straight off to the flow that already owns the purchase: this panel buys
   * nothing itself.
   */
  private activate(def: GoalDef): void {
    this.audio.sfx('tap');
    if (def.kind === 'restoration') {
      // The RestorePanel opens ABOVE this one (its depth tier is well above
      // PANEL_DEPTH), so this panel deliberately stays up behind it - closing
      // the restore panel returns the player to their goals list.
      this.actions.onRestoration();
      return;
    }
    // A region's purchase lives on its on-field sign, so the panel gets out of
    // the way entirely and the camera takes the player there.
    this.hide();
    this.actions.onFocusRegion(def.regionId);
  }

  /**
   * Re-derive every row from state - the panel's only state read.
   *
   * `goalViews` hands back the display order (unfinished first, completed
   * last), so this walks that order, dresses each row for its status, and
   * stacks it. A completed row collapses to its past-tense title alone: a
   * quiet, inert record that the goal is done, not a card still asking to be
   * read. The stack is then measured and the panel resized to hug it.
   */
  refresh(state: GameStateData): void {
    let cursor = CARD_STACK_TOP;
    for (const view of goalViews(state)) {
      const row = this.rows.find((candidate) => candidate.def.id === view.def.id);
      if (row === undefined) continue;
      const done = view.status === 'owned';
      const locked = view.status === 'locked';

      // A completed card keeps its plain title and drops everything that was a
      // call to action (reward, price, progress) along with the card's own
      // height; the italic "Complete" tag on the right says it is done.
      row.title.setStyle(done ? CARD_DONE_TITLE_STYLE : CARD_TITLE_STYLE);
      row.title.setY(done ? CARD_DONE_TITLE_Y : CARD_TITLE_Y);
      row.doneTag.setVisible(done);
      row.reward.setVisible(!done);
      for (const object of row.priceObjects) {
        (object as Phaser.GameObjects.Image).setVisible(!done);
      }
      row.status.setVisible(!done);
      // A locked card reads "Locked: Requires farm level 7" - the soft-red tag
      // is its own object, so the requirement shifts right to sit beside it.
      row.lockLabel.setVisible(!done && locked);
      row.status.setX(locked ? row.lockedStatusX : CARD_TEXT_LEFT_X);
      if (!done) row.status.setText(locked ? goalLockedNote(row.def) : view.progress);

      // Three heights, one per state: collapsed when done, the taller
      // button-bearing height only when actionable, the plain text height when
      // locked. See CARD_HEIGHT_ACTIONABLE's comment.
      let height = CARD_HEIGHT_ACTIONABLE;
      if (done) height = CARD_HEIGHT_DONE;
      else if (locked) height = CARD_HEIGHT_LOCKED;
      row.card.setSize(CARD_WIDTH, height);
      row.container.setY(cursor);
      cursor += height + CARD_GAP;

      // Locked stays full-strength (its soft-red tag carries the meaning);
      // completed fades and washes green. See CARD_ENABLED_ALPHA's comment.
      row.wash.setVisible(done);
      let alpha = CARD_ENABLED_ALPHA;
      if (done) alpha = CARD_DONE_ALPHA;
      else if (locked) alpha = CARD_LOCKED_ALPHA;
      row.container.setAlpha(alpha);

      // Only an ACTIONABLE row offers a button: a locked row cannot be acted
      // on yet and a completed one has nothing left to do, so both show none.
      // Presence AND label are re-derived here, so a row that gains or loses
      // actionability (a level-up opening its gate, a purchase completing it)
      // updates on the next tick without anything being rebuilt.
      const actionable = view.status === 'open';
      row.ctaButton.setVisible(actionable);
      row.ctaLabel.setVisible(actionable).setText(goalActionLabel(row.def));
      if (actionable === row.interactive) continue;
      row.interactive = actionable;
      if (actionable) {
        row.ctaButton.setInteractive({ useHandCursor: true });
      } else {
        row.ctaButton.disableInteractive();
      }
    }
    this.layout(cursor - CARD_GAP + PANEL_BOTTOM_MARGIN);
  }

  /**
   * Resize the background to `height` and re-center the panel on
   * PANEL_CENTER_Y. Because the container is top-anchored, its y is the
   * panel's TOP edge, so centering means offsetting by half the height.
   */
  private layout(height: number): void {
    this.background.setSize(PANEL_WIDTH, height);
    this.container.setY(PANEL_CENTER_Y - height / 2);
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(state: GameStateData): void {
    if (this.visible) {
      this.hide();
      return;
    }
    this.show(state);
  }

  show(state: GameStateData): void {
    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('goals', true);
    // Discovering the menu is exactly "opened it once" (T3.30) - clearing the
    // "!" badge and the icon's attention pulse permanently. Owned here rather
    // than in the HUD's tap handler so any future opener clears it too.
    gameState.markGoalsSeen();
    this.refresh(state);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('goals', false);
  }
}
