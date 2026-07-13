import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import type { CurrencyInfoDef } from '../data/currencyInfo';
import type { AudioManager } from '../systems/audio';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Small anchored popup for a currency (T3.13 fix - was a centered modal in
 * the first pass, per owner feedback): drops down from the tapped counter,
 * horizontally centered on it but clamped to stay SCREEN_EDGE_CLAMP inside
 * the screen edges, sized to its own text (title + wrapped body) rather than
 * a fixed full panel size. `ModalBackdrop` renders nothing (a Zone, pure
 * hit-testing) so it was already non-dimming - it stays, just for the
 * tap-anywhere-to-close catch outside the popup's small footprint.
 */

const PANEL_WIDTH = 560;
const PANEL_PADDING_X = 36;
const PANEL_PADDING_TOP = 26;
const PANEL_PADDING_BOTTOM = 30;
const TITLE_BODY_GAP = 8;
const BODY_WRAP_WIDTH = PANEL_WIDTH - PANEL_PADDING_X * 2;
/** Above the seed bar (2000), below flying coins (2200) - same as the other panels. */
const PANEL_DEPTH = 2100;
/** The popup's clamped edges never come closer than this to the screen edge. */
const SCREEN_EDGE_CLAMP = 16;
/** Gap below the anchor (the HUD banner's own bottom edge) before the popup's top edge. */
const DROP_GAP = 10;

const OPEN_DURATION_MS = 120;
/** The popup starts this far above its resting position and slides down into place. */
const SLIDE_DISTANCE = 12;

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const BODY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  color: '#7a5518',
  align: 'center',
  wordWrap: { width: BODY_WRAP_WIDTH },
};

export class CurrencyInfoCard {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly bg: Phaser.GameObjects.NineSlice;
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly bodyText: Phaser.GameObjects.Text;
  private openTween: Phaser.Tweens.Tween | null = null;
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
  ) {
    // Tap sounds live on the user-driven close seams (backdrop and the card
    // body), never in hide() itself - hide() is also called programmatically
    // (opening another panel) and must stay silent then.
    this.backdrop = new ModalBackdrop(scene, () => {
      this.audio.sfx('tap');
      this.hide();
    });
    this.container = scene.add.container(0, 0).setDepth(PANEL_DEPTH).setVisible(false);

    // Origin (0.5, 0): the container's own (x, y) is the popup's top-center
    // anchor, so every child lays out downward from local y=0 - `show()`
    // resizes this to fit each def's text before every display.
    this.bg = scene.add
      .nineslice(
        0,
        0,
        ATLAS_KEY,
        'panel',
        PANEL_WIDTH,
        PANEL_PADDING_TOP + PANEL_PADDING_BOTTOM,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setOrigin(0.5, 0);
    // Tap-anywhere-to-close: the popup's own body also closes it, same as
    // the backdrop around it - stopPropagation so a tap here doesn't also
    // reach the backdrop zone sitting one depth below and double-fire.
    this.bg.setInteractive();
    this.bg.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        this.audio.sfx('tap');
        this.hide();
      },
    );

    this.titleText = scene.add.text(0, PANEL_PADDING_TOP, '', TITLE_STYLE).setOrigin(0.5, 0);
    this.bodyText = scene.add.text(0, 0, '', BODY_STYLE).setOrigin(0.5, 0);

    this.container.add([this.bg, this.titleText, this.bodyText]);
  }

  /**
   * Show anchored below (anchorX, anchorBottomY) - horizontally centered on
   * the tapped counter (clamped on-screen), sized to fit `def`'s title +
   * wrapped body, with a quick fade/slide-down entrance.
   */
  show(def: CurrencyInfoDef, anchorX: number, anchorBottomY: number): void {
    this.titleText.setText(def.title);
    this.bodyText.setText(def.body);
    this.bodyText.setPosition(0, PANEL_PADDING_TOP + this.titleText.height + TITLE_BODY_GAP);

    const panelHeight = this.bodyText.y + this.bodyText.height + PANEL_PADDING_BOTTOM;
    this.bg.setSize(PANEL_WIDTH, panelHeight);
    // Re-derive the default hit area from the just-resized bounds - no
    // custom hitArea was ever set here, so a plain no-arg call is enough.
    this.bg.setInteractive();

    const clampedX = Phaser.Math.Clamp(
      anchorX,
      SCREEN_EDGE_CLAMP + PANEL_WIDTH / 2,
      DESIGN_WIDTH - SCREEN_EDGE_CLAMP - PANEL_WIDTH / 2,
    );
    const restY = anchorBottomY + DROP_GAP;

    this.openTween?.stop();
    this.visible = true;
    this.container
      .setPosition(clampedX, restY - SLIDE_DISTANCE)
      .setAlpha(0)
      .setVisible(true);
    this.openTween = this.scene.tweens.add({
      targets: this.container,
      y: restY,
      alpha: 1,
      duration: OPEN_DURATION_MS,
      ease: 'Sine.easeOut',
    });

    this.backdrop.setActive(true);
    setPanelOpen('currency-info', true);
  }

  hide(): void {
    this.openTween?.stop();
    this.openTween = null;
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('currency-info', false);
  }

  isVisible(): boolean {
    return this.visible;
  }
}
