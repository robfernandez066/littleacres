import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { MUSIC_TRACKS } from '../data/audio';
import type { AudioManager } from '../systems/audio';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Modal credits panel, opened from Settings: lists every MUSIC_TRACKS entry
 * (title + artist) under a "Music" header, plus a source footer. All text
 * renders FROM the MUSIC_TRACKS config - no credit copy is hardcoded here.
 * Follows the same nineslice/backdrop/X-and-tap-outside conventions as the
 * other modal panels; closing it always returns to the farm, never back to
 * Settings.
 */

const PANEL_WIDTH = 640;
const TRACK_ROW_SPACING = 60;
/** Offsets from the panel's top edge - each element sits this far below it. */
const TITLE_TOP_OFFSET = 60;
const HEADER_TOP_OFFSET = TITLE_TOP_OFFSET + 90;
const ROWS_TOP_OFFSET = HEADER_TOP_OFFSET + 60;
/** Clearance below the footer's baseline to the panel's bottom edge. */
const FOOTER_BOTTOM_MARGIN = 50;
const PANEL_HEIGHT =
  ROWS_TOP_OFFSET + MUSIC_TRACKS.length * TRACK_ROW_SPACING + FOOTER_BOTTOM_MARGIN;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = DESIGN_HEIGHT / 2;
/** Above the seed bar (2000), below flying coins (2200) - same tier as the other panels. */
const PANEL_DEPTH = 2100;

const TITLE_Y = -PANEL_HEIGHT / 2 + TITLE_TOP_OFFSET;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;

const SECTION_HEADER_Y = -PANEL_HEIGHT / 2 + HEADER_TOP_OFFSET;
const TRACK_ROW_START_Y = -PANEL_HEIGHT / 2 + ROWS_TOP_OFFSET;
const FOOTER_Y = TRACK_ROW_START_Y + MUSIC_TRACKS.length * TRACK_ROW_SPACING;

const TEXT_WRAP_WIDTH = PANEL_WIDTH - 100;

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

const SECTION_HEADER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const TRACK_ROW_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  color: '#4a3218',
  align: 'center',
  wordWrap: { width: TEXT_WRAP_WIDTH },
};

const FOOTER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '24px',
  fontStyle: 'italic',
  color: '#4a3218',
  align: 'center',
  wordWrap: { width: TEXT_WRAP_WIDTH },
};

export class CreditsPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private visible = false;

  constructor(
    scene: Phaser.Scene,
    private readonly audio: AudioManager,
  ) {
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

    const title = scene.add.text(0, TITLE_Y, 'Credits', TITLE_STYLE).setOrigin(0.5);
    const closeButton = scene.add
      .text(CLOSE_OFFSET_X, CLOSE_OFFSET_Y, 'X', CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16)
      .setInteractive({ useHandCursor: true });
    closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
    });

    const sectionHeader = scene.add
      .text(0, SECTION_HEADER_Y, 'Music', SECTION_HEADER_STYLE)
      .setOrigin(0.5);

    const trackTexts = MUSIC_TRACKS.map((track, index) =>
      scene.add
        .text(
          0,
          TRACK_ROW_START_Y + index * TRACK_ROW_SPACING,
          `"${track.title}" - ${track.artist}`,
          TRACK_ROW_STYLE,
        )
        .setOrigin(0.5),
    );

    const sources = [...new Set(MUSIC_TRACKS.map((track) => track.source))];
    const footer = scene.add
      .text(0, FOOTER_Y, `All music from ${sources.join(', ')}`, FOOTER_STYLE)
      .setOrigin(0.5);

    this.container.add([bg, title, closeButton, sectionHeader, ...trackTexts, footer]);
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('credits', true);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('credits', false);
  }
}
