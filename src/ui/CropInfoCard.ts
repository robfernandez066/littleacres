import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import { formatGrowMs, type CropDef } from '../data/crops';
import type { AudioManager } from '../systems/audio';
import { setPanelOpen } from '../systems/modalPanels';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Reusable modal info card: crop icon, name, flavor line, and a fixed set of
 * stat rows (label left / value right, optional coin icon). One pooled
 * instance, retargeted per `show()` call - future processed goods reuse the
 * same `CropInfoDef` shape via their own mapper, mirroring `cropToInfoDef`.
 */

const PANEL_WIDTH = 640;
const PANEL_HEIGHT = 560;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = DESIGN_HEIGHT / 2;
/** Above the seed bar (2000), below flying coins (2200) - same as the other panels. */
const PANEL_DEPTH = 2100;

const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;

const ICON_Y = -200;
const ICON_DISPLAY_SIZE = 140;
const NAME_Y = -100;
const FLAVOR_Y = -45;
const FLAVOR_WRAP_WIDTH = PANEL_WIDTH - 80;

const ROW_START_Y = 65;
const ROW_SPACING = 55;
const ROW_LABEL_X = -PANEL_WIDTH / 2 + 40;
const ROW_VALUE_RIGHT_X = PANEL_WIDTH / 2 - 40;
/** Gap wide enough to clear a right-aligned 3-digit value at ROW_VALUE_STYLE's size. */
const ROW_ICON_X = ROW_VALUE_RIGHT_X - 95;
const ROW_ICON_SCALE = 0.35;
/** Fixed row count per the design - four stats, always shown in this order. */
const ROW_COUNT = 4;

const CLOSE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '44px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const FLAVOR_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  fontStyle: 'italic',
  color: '#7a5518',
  align: 'center',
  wordWrap: { width: FLAVOR_WRAP_WIDTH },
};

const ROW_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  color: '#4a3218',
};

const ROW_VALUE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '36px',
  fontStyle: 'bold',
  color: '#7a5518',
};

/** One stat row: label left, value right, optional icon (atlas frame name) before the value. */
export interface CropInfoRow {
  label: string;
  icon?: string;
  value: string;
}

/** Generic info-card content - CROPS map into this today; future recipes will too. */
export interface CropInfoDef {
  iconFrame: string;
  name: string;
  flavor: string;
  rows: CropInfoRow[];
}

/** Maps a crop's config data into the card's generic content shape. */
export function cropToInfoDef(crop: CropDef): CropInfoDef {
  return {
    iconFrame: crop.stageFrames[2],
    name: crop.name,
    flavor: crop.flavor,
    rows: [
      { label: 'Grow time', value: formatGrowMs(crop.growMs) },
      { label: 'Seed cost', icon: 'coin', value: String(crop.seedCost) },
      { label: 'Sells for', icon: 'coin', value: String(crop.sellValue) },
      { label: 'Harvest XP', value: `+${crop.xp}` },
    ],
  };
}

interface InfoRowObjects {
  label: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image;
  value: Phaser.GameObjects.Text;
}

export class CropInfoCard {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly flavorText: Phaser.GameObjects.Text;
  private readonly rows: InfoRowObjects[] = [];
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audio: AudioManager,
  ) {
    // Tap sounds live on the user-driven close seams (backdrop and X), never
    // in hide() itself - hide() is also called programmatically (opening
    // another panel) and must stay silent then.
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
    // or seed bar beneath.
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

    this.icon = scene.add
      .image(0, ICON_Y, ATLAS_KEY, 'sunwheat_2')
      .setDisplaySize(ICON_DISPLAY_SIZE, ICON_DISPLAY_SIZE);
    this.nameText = scene.add.text(0, NAME_Y, '', NAME_STYLE).setOrigin(0.5);
    this.flavorText = scene.add.text(0, FLAVOR_Y, '', FLAVOR_STYLE).setOrigin(0.5);

    const closeButton = scene.add
      .text(CLOSE_OFFSET_X, CLOSE_OFFSET_Y, 'X', CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16)
      .setInteractive({ useHandCursor: true });
    closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
    });

    this.container.add([bg, this.icon, this.nameText, this.flavorText, closeButton]);

    for (let i = 0; i < ROW_COUNT; i++) {
      this.rows.push(this.buildRow(i));
    }
  }

  private buildRow(index: number): InfoRowObjects {
    const y = ROW_START_Y + index * ROW_SPACING;
    const label = this.scene.add.text(ROW_LABEL_X, y, '', ROW_LABEL_STYLE).setOrigin(0, 0.5);
    const icon = this.scene.add
      .image(ROW_ICON_X, y, ATLAS_KEY, 'coin')
      .setScale(ROW_ICON_SCALE)
      .setVisible(false);
    const value = this.scene.add.text(ROW_VALUE_RIGHT_X, y, '', ROW_VALUE_STYLE).setOrigin(1, 0.5);
    this.container.add([label, icon, value]);
    return { label, icon, value };
  }

  /** Retarget the pooled card at a new crop (or future good) and show it. */
  show(def: CropInfoDef): void {
    this.icon.setFrame(def.iconFrame);
    this.nameText.setText(def.name);
    this.flavorText.setText(def.flavor);
    def.rows.forEach((row, index) => {
      const objects = this.rows[index];
      if (objects === undefined) return;
      objects.label.setText(row.label);
      objects.value.setText(row.value);
      if (row.icon !== undefined) {
        objects.icon.setFrame(row.icon).setVisible(true);
      } else {
        objects.icon.setVisible(false);
      }
    });

    this.visible = true;
    this.container.setVisible(true);
    this.backdrop.setActive(true);
    setPanelOpen('crop-info', true);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('crop-info', false);
  }

  isVisible(): boolean {
    return this.visible;
  }
}
