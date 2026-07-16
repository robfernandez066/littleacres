import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import type { AudioManager } from '../systems/audio';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Modal "You've unlocked N more plots!" popup (T3.3a), shown after a
 * `grantPlots` grant (the legacy expansion purchase today; regions later).
 * It never grants anything itself - the plots are already in the shed by the
 * time the scene shows this (see `GameStateStore.grantPlots`); the popup is
 * pure display plus one shortcut. Follows the WeeklyNoticePanel structure
 * (nineslice, swallow-only backdrop that does NOT close it, read-and-confirm
 * dismissal) with two buttons instead of one:
 * - [Confirm] just closes; the Edit Layout flash (driven by FarmScene from
 *   `unplacedPlots`) takes over pointing at the shed.
 * - [Place Now] closes AND hands off to the scene's place-now callback,
 *   which enters arrange mode with one plot auto-taken from the shed.
 */

const PANEL_WIDTH = 900;
const PANEL_HEIGHT = 460;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 780;
/** Above the seed bar (2000), below flying coins (2200) - the shared panel tier. */
const PANEL_DEPTH = 2100;

const TITLE_Y = -PANEL_HEIGHT / 2 + 80;
const MESSAGE_Y = -40;
const MAX_LINE_WIDTH = PANEL_WIDTH - 80;

const BUTTON_Y = PANEL_HEIGHT / 2 - 90;
const BUTTON_HEIGHT = 100;
const CONFIRM_WIDTH = 280;
const PLACE_NOW_WIDTH = 320;
const BUTTON_GAP = 40;
/** The two buttons as one centered row. */
const ROW_WIDTH = CONFIRM_WIDTH + BUTTON_GAP + PLACE_NOW_WIDTH;
const CONFIRM_X = -ROW_WIDTH / 2 + CONFIRM_WIDTH / 2;
const PLACE_NOW_X = ROW_WIDTH / 2 - PLACE_NOW_WIDTH / 2;

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const MESSAGE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

export class PlotGrantPopup {
  private readonly scene: Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly messageText: Phaser.GameObjects.Text;
  private visible = false;

  constructor(
    scene: Phaser.Scene,
    private readonly audio: AudioManager,
    private readonly onPlaceNow: () => void,
  ) {
    this.scene = scene;
    // Swallow-only backdrop: taps outside are eaten but never dismiss the
    // popup - dismissal is the two buttons alone (the WeeklyNoticePanel
    // read-and-confirm convention).
    this.backdrop = new ModalBackdrop(scene, () => undefined);
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

    const title = scene.add.text(0, TITLE_Y, 'More Land to Farm!', TITLE_STYLE).setOrigin(0.5);
    this.messageText = scene.add.text(0, MESSAGE_Y, '', MESSAGE_STYLE).setOrigin(0.5);

    const confirmButton = this.buildButton(CONFIRM_X, CONFIRM_WIDTH, 'Confirm', () => {
      this.audio.sfx('confirm');
      this.hide();
    });
    const placeNowButton = this.buildButton(PLACE_NOW_X, PLACE_NOW_WIDTH, 'Place Now', () => {
      this.audio.sfx('confirm');
      this.hide();
      this.onPlaceNow();
    });

    this.container.add([bg, title, this.messageText, ...confirmButton, ...placeNowButton]);
  }

  /** One panel-nineslice button + centered label, wired to `onTap`. */
  private buildButton(
    x: number,
    width: number,
    label: string,
    onTap: () => void,
  ): [Phaser.GameObjects.NineSlice, Phaser.GameObjects.Text] {
    const button = this.scene.add
      .nineslice(
        x,
        BUTTON_Y,
        ATLAS_KEY,
        'panel',
        width,
        BUTTON_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setInteractive({ useHandCursor: true });
    const text = this.scene.add.text(x, BUTTON_Y, label, BUTTON_STYLE).setOrigin(0.5);
    button.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onTap);
    return [button, text];
  }

  /** Populate and show the popup for `count` freshly granted plots. */
  show(count: number): void {
    this.messageText.setText(
      count === 1 ? "You've unlocked 1 more plot!" : `You've unlocked ${count} more plots!`,
    );
    this.messageText.setScale(Math.min(1, MAX_LINE_WIDTH / this.messageText.width));
    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('plotGrant', true);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('plotGrant', false);
  }

  isVisible(): boolean {
    return this.visible;
  }
}
