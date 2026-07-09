import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH } from '../config';
import { CROPS } from '../data/crops';
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
const PANEL_HEIGHT = 620;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 780;
/** Above the seed bar (2000), below flying coins (2200) - same tier as InventoryPanel. */
const PANEL_DEPTH = 2100;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const SUBTITLE_Y = TITLE_Y + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;

const ROW_START_Y = -70;
const ROW_SPACING = 110;
const ROW_ICON_X = -300;
const ROW_ICON_SCALE = 0.5;
const ROW_TEXT_X = -230;

const HINT_Y = PANEL_HEIGHT / 2 - 60;

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const SUBTITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  color: '#7a5518',
};

const ROW_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const HINT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'italic',
  color: '#7a5518',
};

const CLOSE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/** Friendly away duration: largest two units, minutes floored (never rounded up). */
function formatAwayDuration(elapsedMs: number): string {
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`;
  const days = Math.floor(totalHours / 24);
  return `${days}d ${totalHours % 24}h`;
}

export class OfflineSummaryPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly subtitleText: Phaser.GameObjects.Text;
  /** One pooled row per crop type - shown/positioned only for crops with a nonzero ready count. */
  private readonly rowIcons: Phaser.GameObjects.Image[] = [];
  private readonly rowTexts: Phaser.GameObjects.Text[] = [];
  private visible = false;

  constructor(scene: Phaser.Scene) {
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
      32,
      32,
      32,
      32,
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

    const title = scene.add.text(0, TITLE_Y, 'While you were away', TITLE_STYLE).setOrigin(0.5);
    this.subtitleText = scene.add.text(0, SUBTITLE_Y, '', SUBTITLE_STYLE).setOrigin(0.5);
    const hint = scene.add.text(0, HINT_Y, 'Collect them with a sweep!', HINT_STYLE).setOrigin(0.5);
    const closeButton = scene.add
      .text(CLOSE_OFFSET_X, CLOSE_OFFSET_Y, 'X', CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16)
      .setInteractive({ useHandCursor: true });
    closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.hide());

    this.container.add([bg, title, this.subtitleText, hint, closeButton]);

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
    this.subtitleText.setText(`Away ${formatAwayDuration(summary.elapsedMs)}`);
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
      text.setPosition(ROW_TEXT_X, y).setText(`${count} ${label} ready`).setVisible(true);
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
