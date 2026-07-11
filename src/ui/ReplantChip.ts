import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { CROPS, type CropId } from '../data/crops';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData } from '../systems/gameState';
import { buzz } from '../systems/haptics';
import { isModalOpen } from '../systems/modalPanels';

/** One harvested plot a gesture just reaped, offered back for replanting. */
export interface ReplantEntry {
  plotIndex: number;
  cropId: CropId;
}

/** Real wall-clock lifetime of the chip once shown; a UI timer, not game time. */
const REPLANT_CHIP_TTL_MS = 8000;

const CHIP_WIDTH = 520;
const CHIP_HEIGHT = 96;
const CHIP_CENTER_X = DESIGN_WIDTH / 2;
const CHIP_CENTER_Y = 1470;
/** Above the field/crops, same layer as the seed bar it sits over. */
const CHIP_DEPTH = 2000;

/** Composed-contents budget: copy longer than this shrinks to fit. */
const CHIP_INNER_WIDTH = CHIP_WIDTH - 40;
/** Gap from the label's measured right edge to the coin icon's left edge. */
const LABEL_COIN_GAP = 14;
/** Gap from the coin icon's right edge to the cost text's left edge. */
const COIN_COST_GAP = 8;
const COIN_SCALE = 0.5;

const DIMMED_ALPHA = 0.5;
/** Light haptic pulse on a successful replant, matching FarmScene's plant/harvest buzz. */
const HAPTIC_LIGHT_MS = 12;

const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const COST_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#7a5518',
};

/**
 * Post-harvest "Replant" chip: after a harvest sweep, offers to replant every
 * plot it just emptied with one tap. Auto-hides after REPLANT_CHIP_TTL_MS,
 * shrinks its offer to whatever subset of plots is still empty, and renders
 * dimmed when coins fall short of the total cost. Owns no scene juice -
 * FarmScene plays the plant pop/sparkle for each replanted plot via
 * `onReplanted`.
 */
export class ReplantChip {
  private readonly container: Phaser.GameObjects.Container;
  private readonly panel: Phaser.GameObjects.NineSlice;
  private readonly label: Phaser.GameObjects.Text;
  private readonly coinIcon: Phaser.GameObjects.Image;
  private readonly costText: Phaser.GameObjects.Text;
  private entries: readonly ReplantEntry[] = [];
  private shownAt = -Infinity;
  private visible = false;

  constructor(
    scene: Phaser.Scene,
    private readonly audio: AudioManager,
    private readonly onReplanted: (plantedEntries: ReplantEntry[]) => void,
    /** Fired exactly once per visible-to-hidden transition (never on an already-hidden hide()). */
    private readonly onHide: () => void,
  ) {
    this.container = scene.add
      .container(CHIP_CENTER_X, CHIP_CENTER_Y)
      .setDepth(CHIP_DEPTH)
      .setVisible(false);
    this.panel = scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      CHIP_WIDTH,
      CHIP_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    // Positions are placeholders - `layoutContents` composes the real ones
    // from measured widths the moment the copy is first set.
    this.label = scene.add.text(0, 0, '', TEXT_STYLE).setOrigin(0, 0.5);
    this.coinIcon = scene.add.image(0, 0, ATLAS_KEY, 'coin').setScale(COIN_SCALE);
    this.costText = scene.add.text(0, 0, '', COST_STYLE).setOrigin(0, 0.5);
    this.container.add([this.panel, this.label, this.coinIcon, this.costText]);

    this.panel.setInteractive({ useHandCursor: true });
    this.panel.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        // Swallow the tap so it never reaches the field beneath the chip.
        event.stopPropagation();
        this.onTap();
      },
    );
  }

  /** Show the chip for the just-harvested entries and (re)start its TTL. */
  show(entries: readonly ReplantEntry[]): void {
    this.entries = entries;
    this.shownAt = Date.now();
    this.visible = true;
    this.container.setVisible(true);
    this.refresh(gameState.getState());
  }

  /**
   * Re-derive the still-empty subset of the stored entries and its total
   * cost, called every scene tick. Hides when the subset is empty, the TTL
   * has elapsed, or a modal panel is open; otherwise updates the copy/cost
   * and dims (alpha DIMMED_ALPHA) when coins fall short - `onTap` then
   * no-ops via the store's own insufficient-coins rejection.
   */
  refresh(state: GameStateData): void {
    if (!this.visible) return;
    const remaining = this.entries.filter(
      (entry) => state.plots[entry.plotIndex]?.state === 'empty',
    );
    if (
      remaining.length === 0 ||
      Date.now() - this.shownAt >= REPLANT_CHIP_TTL_MS ||
      isModalOpen()
    ) {
      this.hide();
      return;
    }
    this.entries = remaining;
    const totalCost = remaining.reduce((sum, entry) => sum + CROPS[entry.cropId].seedCost, 0);
    const label = this.copyFor(remaining);
    const cost = String(totalCost);
    if (label !== this.label.text || cost !== this.costText.text) {
      this.label.setText(label);
      this.costText.setText(cost);
      this.layoutContents();
    }
    this.container.setAlpha(state.coins < totalCost ? DIMMED_ALPHA : 1);
  }

  /**
   * Hide immediately - TTL expiry, a modal opening, a successful replant, or
   * FarmScene dismissing the offer on a successful manual plant. `onHide`
   * fires only on an actual visible-to-hidden transition, which is also the
   * single point FarmScene clears its accumulated `pendingReplant` list.
   */
  hide(): void {
    const wasVisible = this.visible;
    this.visible = false;
    this.entries = [];
    this.container.setVisible(false);
    if (wasVisible) this.onHide();
  }

  /**
   * Compose label + coin + cost left-to-right by measured widths and center
   * the group in the chip. If the composed width would exceed
   * CHIP_INNER_WIDTH, only the label shrinks (coin and cost stay full size)
   * - same shrink-to-fit approach as OnboardingGuide's chip.
   */
  private layoutContents(): void {
    this.label.setScale(1);
    const rawLabelWidth = this.label.width;
    const coinWidth = this.coinIcon.displayWidth;
    const costWidth = this.costText.width;
    const fixedWidth = LABEL_COIN_GAP + coinWidth + COIN_COST_GAP + costWidth;
    const labelScale = Math.min(1, Math.max(0, (CHIP_INNER_WIDTH - fixedWidth) / rawLabelWidth));
    this.label.setScale(labelScale);
    const labelWidth = rawLabelWidth * labelScale;
    const totalWidth = labelWidth + fixedWidth;
    const startX = -totalWidth / 2;
    this.label.setPosition(startX, 0);
    const coinX = startX + labelWidth + LABEL_COIN_GAP + coinWidth / 2;
    this.coinIcon.setPosition(coinX, 0);
    this.costText.setPosition(coinX + coinWidth / 2 + COIN_COST_GAP, 0);
  }

  private copyFor(entries: readonly ReplantEntry[]): string {
    const distinctCropIds = new Set(entries.map((entry) => entry.cropId));
    if (distinctCropIds.size === 1) {
      const cropId = entries[0]!.cropId;
      return `Replant ${entries.length} ${CROPS[cropId].pluralName}`;
    }
    return `Replant ${entries.length} crops`;
  }

  private onTap(): void {
    if (!this.visible || this.entries.length === 0) return;
    const candidates = this.entries;
    const planted = gameState.replant(candidates);
    if (planted <= 0) return;
    this.audio.sfx('plant');
    buzz(HAPTIC_LIGHT_MS);
    const stateAfter = gameState.getState();
    const plantedEntries = candidates.filter(
      (entry) => stateAfter.plots[entry.plotIndex]?.state === 'growing',
    );
    this.hide();
    this.onReplanted(plantedEntries);
  }
}
