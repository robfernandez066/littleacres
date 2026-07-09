import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { CROPS, type CropDef, type CropId } from '../data/crops';
import type { AudioManager } from '../systems/audio';
import { gameState } from '../systems/gameState';
import { isModalOpen } from '../systems/modalPanels';
import { registerPulseTarget, type PulseTarget } from '../systems/pulseTargets';

/**
 * Layout: primary actions live in the bottom third of the screen (design
 * rule); the bar spans roughly y 1560-1840, inside the 1550-1850 band.
 */
const BAR_CENTER_Y = 1700;
const BUTTON_WIDTH = 300;
const BUTTON_HEIGHT = 280;
const BUTTON_SPACING = 340;
/** Above the field and crop sprites (whose depth is their screen y). */
const BAR_DEPTH = 2000;

const ICON_OFFSET_Y = -55;
const NAME_OFFSET_Y = 45;
const COST_OFFSET_Y = 100;
const COIN_OFFSET_X = -36;
const COIN_SCALE = 0.45;
const COST_TEXT_X = -8;

const SELECTED_TINT = 0xffe27a;
const SELECTED_SCALE = 1.06;
const LOCKED_ALPHA = 0.5;
const LOCKED_ICON_TINT = 0x555555;

const NAME_COLOR = '#4a3218';
const COST_COLOR = '#7a5518';
const LOCKED_COLOR = '#4c4c4c';
const FLASH_COLOR = '#e03131';
const FLASH_DURATION_MS = 300;
const SHAKE_DISTANCE = 10;
/** Min gap between insufficient-coins nudges so a drag cannot spam them. */
const SHAKE_THROTTLE_MS = 400;

const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: NAME_COLOR,
};

const COST_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: COST_COLOR,
};

interface SeedButton {
  crop: CropDef;
  container: Phaser.GameObjects.Container;
  panel: Phaser.GameObjects.NineSlice;
  icon: Phaser.GameObjects.Image;
  coinIcon: Phaser.GameObjects.Image;
  costText: Phaser.GameObjects.Text;
  baseX: number;
  locked: boolean;
  /** Real wall-clock ms of the last nudge; UI throttle, not gameplay time. */
  lastFlashAt: number;
  flashTimer: Phaser.Time.TimerEvent | null;
}

/**
 * Bottom-anchored seed selection bar: one button per crop showing icon, name
 * and seed cost. Locked crops (player level below unlockLevel) are visible
 * but dimmed with a "Lv N" requirement instead of the cost. At most one seed
 * is selected at a time; tapping the selected seed deselects it.
 *
 * The bar only renders from and reads `gameState` - it never owns game data.
 */
export class SeedBar {
  private readonly buttons: SeedButton[] = [];
  private selected: CropId | null = null;
  /** Level the lock visuals were last derived from; -1 forces a first pass. */
  private lastLevel = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
  ) {
    const crops = Object.values(CROPS);
    crops.forEach((crop, index) => {
      this.buttons.push(this.buildButton(crop, index, crops.length));
    });
    registerPulseTarget('seed-sunwheat', () => this.seedPulseTarget('sunwheat'));
    registerPulseTarget('seed-starcorn', () => this.seedPulseTarget('starcorn'));
    this.refresh();
  }

  /** The currently selected crop, or null when nothing is selected. */
  getSelected(): CropId | null {
    return this.selected;
  }

  /**
   * Onboarding pulse target for a seed button - null once that seed is
   * already selected, so the guide moves the highlight on to the field. Also
   * null while a modal panel is open: the bar sits below the panels'
   * vertical extent and any part a panel overlaps is untappable, so it is
   * never a valid pulse target then. The container is safe for the guide to
   * scale-breathe precisely because of the selected-null rule (the selected
   * scale state never coexists with the highlight; `refresh` re-asserts it
   * against the one-tick handoff race).
   */
  private seedPulseTarget(cropId: CropId): PulseTarget | null {
    if (isModalOpen() || this.selected === cropId) return null;
    const button = this.buttons.find((b) => b.crop.id === cropId);
    if (button === undefined) return null;
    return {
      x: button.baseX,
      y: BAR_CENTER_Y,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      object: button.container,
    };
  }

  /**
   * Re-derive lock state from the player level. Cheap when nothing changed,
   * so the scene can call it on its regular refresh tick. Deselects the
   * current seed if it just became locked.
   */
  refresh(): void {
    this.reassertSelectedScale();
    const level = gameState.getState().level;
    if (level === this.lastLevel) return;
    this.lastLevel = level;
    for (const button of this.buttons) {
      button.locked = level < button.crop.unlockLevel;
      this.applyLockVisuals(button);
    }
    const selectedButton = this.buttons.find((b) => b.crop.id === this.selected);
    if (selectedButton?.locked === true) this.setSelected(null);
  }

  /**
   * Keep the selected button at its selected scale every tick. The
   * onboarding guide scale-breathes UNselected seed buttons and restores
   * their base scale when it moves on; a selection made in the same tick the
   * guide detaches would otherwise be left at base scale until the next
   * selection change. The guide never touches a selected button (its
   * provider returns null then), so this never fights the breathing.
   */
  private reassertSelectedScale(): void {
    const button = this.buttons.find((b) => b.crop.id === this.selected);
    if (button !== undefined) button.container.setScale(SELECTED_SCALE);
  }

  /**
   * Gentle insufficient-coins feedback: a small x-wiggle on the button and a
   * brief red flash of its cost text. Never blocks; throttled per button.
   */
  flashInsufficientCoins(cropId: CropId): void {
    const button = this.buttons.find((b) => b.crop.id === cropId);
    if (button === undefined) return;
    const nowMs = Date.now();
    if (nowMs - button.lastFlashAt < SHAKE_THROTTLE_MS) return;
    button.lastFlashAt = nowMs;

    this.scene.tweens.killTweensOf(button.container);
    button.container.setX(button.baseX);
    this.scene.tweens.add({
      targets: button.container,
      x: button.baseX + SHAKE_DISTANCE,
      duration: 40,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => button.container.setX(button.baseX),
    });

    button.costText.setColor(FLASH_COLOR);
    button.flashTimer?.remove();
    button.flashTimer = this.scene.time.delayedCall(FLASH_DURATION_MS, () => {
      button.costText.setColor(button.locked ? LOCKED_COLOR : COST_COLOR);
      button.flashTimer = null;
    });
  }

  private buildButton(crop: CropDef, index: number, count: number): SeedButton {
    const baseX = DESIGN_WIDTH / 2 + (index - (count - 1) / 2) * BUTTON_SPACING;
    const container = this.scene.add.container(baseX, BAR_CENTER_Y).setDepth(BAR_DEPTH);

    const panel = this.scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      BUTTON_WIDTH,
      BUTTON_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const icon = this.scene.add.image(0, ICON_OFFSET_Y, ATLAS_KEY, crop.stageFrames[2]);
    const nameText = this.scene.add.text(0, NAME_OFFSET_Y, crop.name, NAME_STYLE).setOrigin(0.5);
    const coinIcon = this.scene.add
      .image(COIN_OFFSET_X, COST_OFFSET_Y, ATLAS_KEY, 'coin')
      .setScale(COIN_SCALE);
    const costText = this.scene.add
      .text(COST_TEXT_X, COST_OFFSET_Y, String(crop.seedCost), COST_STYLE)
      .setOrigin(0, 0.5);
    container.add([panel, icon, nameText, coinIcon, costText]);

    panel.setInteractive({ useHandCursor: true });
    panel.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.onTap(crop.id));

    return {
      crop,
      container,
      panel,
      icon,
      coinIcon,
      costText,
      baseX,
      locked: false,
      lastFlashAt: -Infinity,
      flashTimer: null,
    };
  }

  private onTap(cropId: CropId): void {
    const button = this.buttons.find((b) => b.crop.id === cropId);
    if (button === undefined || button.locked) return;
    // One click per accepted tap, select or deselect; locked taps stay silent.
    this.audio.sfx('tap');
    this.setSelected(this.selected === cropId ? null : cropId);
  }

  private setSelected(cropId: CropId | null): void {
    this.selected = cropId;
    for (const button of this.buttons) {
      if (button.crop.id === cropId) {
        button.panel.setTint(SELECTED_TINT);
        button.container.setScale(SELECTED_SCALE);
      } else {
        button.panel.clearTint();
        button.container.setScale(1);
      }
    }
  }

  private applyLockVisuals(button: SeedButton): void {
    if (button.locked) {
      button.container.setAlpha(LOCKED_ALPHA);
      button.icon.setTint(LOCKED_ICON_TINT);
      button.coinIcon.setVisible(false);
      button.costText
        .setText(`Lv ${button.crop.unlockLevel}`)
        .setColor(LOCKED_COLOR)
        .setOrigin(0.5)
        .setX(0);
    } else {
      button.container.setAlpha(1);
      button.icon.clearTint();
      button.coinIcon.setVisible(true);
      button.costText
        .setText(String(button.crop.seedCost))
        .setColor(COST_COLOR)
        .setOrigin(0, 0.5)
        .setX(COST_TEXT_X);
    }
  }
}
