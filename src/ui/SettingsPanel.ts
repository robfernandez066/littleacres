import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import type { AudioManager } from '../systems/audio';
import { gameState } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Modal audio settings panel: one row per channel (Music / Sound), each with
 * a label, an on/off toggle, and a horizontal volume slider. Opened by the
 * HUD's Audio button. Sliders LIVE-apply while dragging (music volume changes
 * audibly under the finger) and persist through the store setters on release;
 * the sound slider plays a sample tap on release so the new level is heard.
 */

const PANEL_WIDTH = 640;
const PANEL_HEIGHT = 460;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = DESIGN_HEIGHT / 2;
/** Above the seed bar (2000), below flying coins (2200) - same as the other panels. */
const PANEL_DEPTH = 2100;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;

const ROW_MUSIC_Y = -30;
const ROW_SFX_Y = 120;
const ROW_LABEL_X = -PANEL_WIDTH / 2 + 40;

const TOGGLE_X = -105;
const TOGGLE_WIDTH = 100;
const TOGGLE_HEIGHT = 64;
/** Matches the HUD's dimmed-while-off convention. */
const TOGGLE_OFF_ALPHA = 0.45;

const TRACK_CENTER_X = 115;
const TRACK_WIDTH = 320;
const TRACK_HEIGHT = 40;
const TRACK_MIN_X = TRACK_CENTER_X - TRACK_WIDTH / 2;
const HANDLE_WIDTH = 52;
const HANDLE_HEIGHT = 76;
/** Extra hit padding around the handle so a thumb can grab it reliably. */
const HANDLE_HIT_PAD = 20;

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

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const TOGGLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/** One channel row's pieces and behavior hooks. */
interface SliderRow {
  toggleContainer: Phaser.GameObjects.Container;
  toggleText: Phaser.GameObjects.Text;
  handle: Phaser.GameObjects.NineSlice;
  isOn: () => boolean;
  setOn: (on: boolean) => void;
  getVolume: () => number;
  /** Live-apply while the handle moves; not persisted. */
  onDrag: (volume: number) => void;
  /** Persist on release (and any release-time feedback, e.g. the sample tap). */
  onCommit: (volume: number) => void;
}

export class SettingsPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly rows: SliderRow[] = [];
  /** The row whose handle is being dragged, if any. */
  private activeRow: SliderRow | null = null;
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
  ) {
    // Tap sounds live on the user-driven close seams (backdrop and X), never
    // in hide() itself - hide() is also called programmatically (e.g. when
    // the Bag button closes this panel) and must stay silent then.
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
    // beneath - the controls drawn on top still receive their own
    // pointer-down first and keep working.
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
    const title = scene.add.text(0, TITLE_Y, 'Audio', TITLE_STYLE).setOrigin(0.5);
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

    this.rows.push(
      this.buildRow(ROW_MUSIC_Y, 'Music', {
        isOn: () => gameState.getState().settings.musicOn,
        setOn: (on) => this.audio.setMusicOn(on),
        getVolume: () => gameState.getState().settings.musicVolume,
        onDrag: (volume) => this.audio.previewMusicVolume(volume),
        onCommit: (volume) => this.audio.setMusicVolume(volume),
      }),
      this.buildRow(ROW_SFX_Y, 'Sound', {
        isOn: () => gameState.getState().settings.sfxOn,
        setOn: (on) => this.audio.setSfxOn(on),
        getVolume: () => gameState.getState().settings.sfxVolume,
        // Effects are one-shots; there is nothing continuous to live-adjust
        // mid-drag. The release sample below lets the user hear the level.
        onDrag: () => {},
        onCommit: (volume) => {
          this.audio.setSfxVolume(volume);
          this.audio.sfx('tap');
        },
      }),
    );

    // One scene-level move/up pair drives both sliders; registered once and
    // alive for the scene's lifetime, they are cheap no-ops while nothing is
    // being dragged. Scene-level (not object-level) so a drag that leaves the
    // handle - or the panel - keeps tracking until the finger lifts.
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (this.activeRow === null) return;
      const volume = this.volumeFromPointer(pointer);
      this.setHandleFromVolume(this.activeRow, volume);
      this.activeRow.onDrag(volume);
    });
    scene.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      if (this.activeRow === null) return;
      const row = this.activeRow;
      this.activeRow = null;
      const volume = this.volumeFromPointer(pointer);
      this.setHandleFromVolume(row, volume);
      row.onCommit(volume);
    });
  }

  /** Build one channel row: label, on/off toggle, slider track + handle. */
  private buildRow(
    y: number,
    label: string,
    hooks: Pick<SliderRow, 'isOn' | 'setOn' | 'getVolume' | 'onDrag' | 'onCommit'>,
  ): SliderRow {
    const labelText = this.scene.add.text(ROW_LABEL_X, y, label, LABEL_STYLE).setOrigin(0, 0.5);

    const toggleContainer = this.scene.add.container(TOGGLE_X, y);
    const togglePanel = this.scene.add
      .nineslice(
        0,
        0,
        ATLAS_KEY,
        'panel',
        TOGGLE_WIDTH,
        TOGGLE_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setInteractive({ useHandCursor: true });
    const toggleText = this.scene.add.text(0, 0, '', TOGGLE_STYLE).setOrigin(0.5);
    toggleContainer.add([togglePanel, toggleText]);

    const track = this.scene.add
      .nineslice(
        TRACK_CENTER_X,
        y,
        ATLAS_KEY,
        'panel',
        TRACK_WIDTH,
        TRACK_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setInteractive({ useHandCursor: true });
    const handle = this.scene.add.nineslice(
      TRACK_CENTER_X,
      y,
      ATLAS_KEY,
      'panel',
      HANDLE_WIDTH,
      HANDLE_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    handle.setInteractive({
      useHandCursor: true,
      hitArea: new Phaser.Geom.Rectangle(
        -HANDLE_HIT_PAD,
        -HANDLE_HIT_PAD,
        HANDLE_WIDTH + HANDLE_HIT_PAD * 2,
        HANDLE_HEIGHT + HANDLE_HIT_PAD * 2,
      ),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    });

    this.container.add([labelText, toggleContainer, track, handle]);

    const row: SliderRow = { toggleContainer, toggleText, handle, ...hooks };

    togglePanel.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        const on = !row.isOn();
        row.setOn(on);
        this.renderToggle(row);
        // Clicks only when turning ON - a tap that just muted everything
        // should itself be silent (same convention as the old HUD toggles).
        if (on) this.audio.sfx('tap');
      },
    );

    // Both the handle and the track start a drag; grabbing the track jumps
    // the handle straight under the finger, which is the expected touch feel.
    const beginDrag = (
      pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ): void => {
      event.stopPropagation();
      this.activeRow = row;
      const volume = this.volumeFromPointer(pointer);
      this.setHandleFromVolume(row, volume);
      row.onDrag(volume);
    };
    handle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, beginDrag);
    track.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, beginDrag);

    return row;
  }

  /** Slider value under the pointer, clamped to 0..1. */
  private volumeFromPointer(pointer: Phaser.Input.Pointer): number {
    const localX = pointer.worldX - PANEL_CENTER_X;
    return Phaser.Math.Clamp((localX - TRACK_MIN_X) / TRACK_WIDTH, 0, 1);
  }

  private setHandleFromVolume(row: SliderRow, volume: number): void {
    row.handle.x = TRACK_MIN_X + volume * TRACK_WIDTH;
  }

  /** Re-derive a toggle's label and dimming from its setting. */
  private renderToggle(row: SliderRow): void {
    const on = row.isOn();
    row.toggleText.setText(on ? 'On' : 'Off');
    row.toggleContainer.setAlpha(on ? 1 : TOGGLE_OFF_ALPHA);
  }

  /**
   * Re-derive every control from state; called on open and on the scene's
   * refresh tick (so a dev import/reset re-renders it). A row mid-drag keeps
   * its handle under the finger instead of snapping to the saved value.
   */
  refresh(): void {
    if (!this.visible) return;
    for (const row of this.rows) {
      this.renderToggle(row);
      if (row !== this.activeRow) this.setHandleFromVolume(row, row.getVolume());
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.container.setVisible(this.visible);
    this.backdrop.setActive(this.visible);
    setPanelOpen('settings', this.visible);
    if (this.visible) this.refresh();
  }

  hide(): void {
    this.visible = false;
    this.activeRow = null;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('settings', false);
  }
}
