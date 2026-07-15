import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { CROPS } from '../data/crops';
import { formatAwayDuration } from '../data/format';
import type { AudioManager } from '../systems/audio';
import type { OfflineSummary } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Modal "while you were away" panel: reports crops that matured while the
 * app was closed. It never harvests anything itself - the player sweeps the
 * field to collect, same as any other ready crop. Follows the InventoryPanel
 * structure (nineslice, backdrop, X button, tap-outside closes).
 */

const PANEL_WIDTH = 900;
/** Tall enough for all 7 crop rows (T3.11) to clear the Confirm button. */
const PANEL_HEIGHT = 780;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 780;
/** Above the seed bar (2000), below flying coins (2200) - same tier as InventoryPanel. */
const PANEL_DEPTH = 2100;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;
/** Minimum gap (px) the title's shrink-to-fit must leave clear of the close X. */
const TITLE_CLOSE_CLEARANCE_PX = 16;

/** 140px below the panel top, same title clearance as before the 7-row refit (T3.11). */
const ROW_START_Y = -PANEL_HEIGHT / 2 + 140;
const ROW_SPACING = 75;
const ROW_ICON_X = -300;
const ROW_ICON_SCALE = 0.5;
const ROW_TEXT_X = -230;

const CONFIRM_Y = PANEL_HEIGHT / 2 - 80;
const CONFIRM_WIDTH = 320;
const CONFIRM_HEIGHT = 90;

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const ROW_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const CLOSE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const CONFIRM_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

export class OfflineSummaryPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly closeButton: Phaser.GameObjects.Text;
  /** One pooled row per crop type - shown/positioned only for crops with a nonzero ready count. */
  private readonly rowIcons: Phaser.GameObjects.Image[] = [];
  private readonly rowTexts: Phaser.GameObjects.Text[] = [];
  private visible = false;

  constructor(
    scene: Phaser.Scene,
    private readonly audio: AudioManager,
  ) {
    this.backdrop = new ModalBackdrop(scene, () => this.hide());
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
    // Swallow taps on the panel body so they never fall through to the field beneath.
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

    this.titleText = scene.add.text(0, TITLE_Y, '', TITLE_STYLE).setOrigin(0.5);
    this.closeButton = scene.add
      .text(CLOSE_OFFSET_X, CLOSE_OFFSET_Y, 'X', CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16)
      .setInteractive({ useHandCursor: true });
    this.closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.hide());

    const confirmButton = scene.add
      .nineslice(
        0,
        CONFIRM_Y,
        ATLAS_KEY,
        'panel',
        CONFIRM_WIDTH,
        CONFIRM_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setInteractive({ useHandCursor: true });
    const confirmText = scene.add.text(0, CONFIRM_Y, 'Confirm', CONFIRM_STYLE).setOrigin(0.5);
    confirmButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('confirm');
      this.hide();
    });

    this.container.add([bg, this.titleText, this.closeButton, confirmButton, confirmText]);

    Object.values(CROPS).forEach((crop, index) => {
      const y = ROW_START_Y + index * ROW_SPACING;
      const icon = scene.add
        .image(ROW_ICON_X, y, ATLAS_KEY, crop.stageFrames[2])
        .setScale(ROW_ICON_SCALE)
        .setVisible(false);
      const text = scene.add.text(ROW_TEXT_X, y, '', ROW_STYLE).setOrigin(0, 0.5).setVisible(false);
      this.container.add([icon, text]);
      this.rowIcons.push(icon);
      this.rowTexts.push(text);
    });
  }

  /** Populate and show the panel from a computed offline summary. */
  show(summary: OfflineSummary): void {
    this.titleText.setText(`While You Were Away for ${formatAwayDuration(summary.elapsedMs)}`);
    // The title is centered on the panel (origin 0.5, x=0), so its scaled
    // half-width must clear the close button's left edge by the clearance -
    // capped at the old flat width too, for a short duration's title.
    const closeLeftEdge = CLOSE_OFFSET_X - this.closeButton.width / 2;
    const maxTitleWidth = Math.min(
      PANEL_WIDTH - 80,
      (closeLeftEdge - TITLE_CLOSE_CLEARANCE_PX) * 2,
    );
    this.titleText.setScale(Math.min(1, maxTitleWidth / this.titleText.width));
    const readyCrops = Object.values(CROPS).filter(
      (crop) => (summary.readyCounts[crop.id] ?? 0) > 0,
    );
    this.rowIcons.forEach((icon, index) => {
      const text = this.rowTexts[index];
      const crop = readyCrops[index];
      if (text === undefined) return;
      if (crop === undefined) {
        icon.setVisible(false);
        text.setVisible(false);
        return;
      }
      const count = summary.readyCounts[crop.id] ?? 0;
      const y = ROW_START_Y + index * ROW_SPACING;
      const label = count > 1 ? crop.pluralName : crop.name;
      icon.setPosition(ROW_ICON_X, y).setFrame(crop.stageFrames[2]).setVisible(true);
      text.setPosition(ROW_TEXT_X, y).setText(`${count} ${label} Ready`).setVisible(true);
    });

    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('offline', true);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('offline', false);
  }

  isVisible(): boolean {
    return this.visible;
  }
}
