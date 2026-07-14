import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import type { AudioManager } from '../systems/audio';
import type { WeeklyNoticeEvent } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Modal "a new week on the farm" panel (T3.19): shown after a weekly quest
 * rollover that auto-granted completed-but-unclaimed rewards. It never grants
 * anything itself - the rewards are already in state by the time the scene
 * shows this (see `GameStateStore.ensureWeeklyQuests`); the panel is pure
 * display, like the chest ceremony. Follows the OfflineSummaryPanel structure
 * (nineslice, backdrop, tap-outside closes, one confirm button).
 */

const PANEL_WIDTH = 900;
/** Tall enough for 2 granted quests (2 lines each) plus the new-quests line. */
const PANEL_HEIGHT = 620;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 780;
/** Above the seed bar (2000), below flying coins (2200) - same tier as OfflineSummaryPanel. */
const PANEL_DEPTH = 2100;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const LINE_START_Y = -PANEL_HEIGHT / 2 + 140;
const LINE_SPACING = 62;
/** Extra gap above the new-quests line, separating it from the granted rows. */
const QUESTS_LINE_GAP = 24;
const MAX_LINE_WIDTH = PANEL_WIDTH - 80;

const CONFIRM_Y = PANEL_HEIGHT / 2 - 80;
const CONFIRM_WIDTH = 320;
const CONFIRM_HEIGHT = 90;

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const LINE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const REWARD_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#7a5a2e',
};

const CONFIRM_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/** "1 Treasure Chest", "2 Treasure Chests", "3 Moondust", or both joined with " + ". */
export function formatRewardLabel(chests: number, moondust: number): string {
  const parts: string[] = [];
  if (chests > 0) parts.push(chests === 1 ? '1 Treasure Chest' : `${chests} Treasure Chests`);
  if (moondust > 0) parts.push(`${moondust} Moondust`);
  return parts.join(' + ');
}

export class WeeklyNoticePanel {
  private readonly scene: Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  /** Per-show content lines, destroyed and rebuilt on every `show`. */
  private lines: Phaser.GameObjects.Text[] = [];
  private visible = false;

  constructor(
    scene: Phaser.Scene,
    private readonly audio: AudioManager,
  ) {
    this.scene = scene;
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

    const title = scene.add.text(0, TITLE_Y, 'A New Week on the Farm', TITLE_STYLE).setOrigin(0.5);

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
    const confirmText = scene.add.text(0, CONFIRM_Y, 'Got it', CONFIRM_STYLE).setOrigin(0.5);
    confirmButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('confirm');
      this.hide();
    });

    this.container.add([bg, title, confirmButton, confirmText]);
  }

  /** Shrink-to-fit so a long quest-name line never overflows the panel. */
  private addLine(y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): void {
    const line = this.scene.add.text(0, y, text, style).setOrigin(0.5);
    line.setScale(Math.min(1, MAX_LINE_WIDTH / line.width));
    this.container.add(line);
    this.lines.push(line);
  }

  /** Populate and show the panel from a weekly rollover notice. */
  show(event: WeeklyNoticeEvent): void {
    for (const line of this.lines) line.destroy();
    this.lines = [];
    let y = LINE_START_Y;
    for (const grant of event.granted) {
      this.addLine(y, `${grant.name} complete - reward claimed!`, LINE_STYLE);
      y += LINE_SPACING;
      this.addLine(y, formatRewardLabel(grant.chests, grant.moondust), REWARD_STYLE);
      y += LINE_SPACING;
    }
    y += QUESTS_LINE_GAP;
    this.addLine(
      y,
      `This week's quests: ${event.newQuestNames[0]} and ${event.newQuestNames[1]}`,
      LINE_STYLE,
    );

    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('weeklyNotice', true);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('weeklyNotice', false);
  }

  isVisible(): boolean {
    return this.visible;
  }
}
