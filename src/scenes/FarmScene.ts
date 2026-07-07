import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH } from '../config';
import { CROP_BASELINE_Y, CROP_FRAME_SIZE, CROPS } from '../data/crops';
import { FARM_COLS, FARM_ROWS } from '../data/farm';
import { gridToIso, TILE_WIDTH } from '../systems/iso';

/** Slightly darker than the grass tiles so the field reads as raised ground. */
const BACKGROUND_COLOR = 0x55913f;

/**
 * Vertical band (in design pixels) covered by grass tiles. Everything above
 * and below stays plain background - headroom reserved for the future HUD.
 */
const FIELD_MIN_Y = 420;
const FIELD_MAX_Y = 1500;

/** Grid range scanned when laying grass; wide enough to fill the band above. */
const GRASS_GRID_MIN = -6;
const GRASS_GRID_MAX = 9;

/**
 * The main farm scene: a FARM_COLS x FARM_ROWS grid of plots in the middle of
 * a grass field. Purely visual for now - planting and harvesting come later.
 */
export class FarmScene extends Phaser.Scene {
  constructor() {
    super('Farm');
  }

  create(): void {
    this.add.rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, BACKGROUND_COLOR).setOrigin(0, 0);

    this.layGrassField();
    this.layPlots();
    this.showDemoCrops();
  }

  /** Cover the field band with grass tiles (they also run under the plots). */
  private layGrassField(): void {
    for (let col = GRASS_GRID_MIN; col <= GRASS_GRID_MAX; col++) {
      for (let row = GRASS_GRID_MIN; row <= GRASS_GRID_MAX; row++) {
        const { x, y } = gridToIso(col, row);
        if (y < FIELD_MIN_Y || y > FIELD_MAX_Y) continue;
        if (x < -TILE_WIDTH / 2 || x > DESIGN_WIDTH + TILE_WIDTH / 2) continue;
        this.add.image(x, y, ATLAS_KEY, 'grass');
      }
    }
  }

  /** The 4x3 grid of tilled plots, centered by the iso origin. */
  private layPlots(): void {
    for (let col = 0; col < FARM_COLS; col++) {
      for (let row = 0; row < FARM_ROWS; row++) {
        const { x, y } = gridToIso(col, row);
        this.add.image(x, y, ATLAS_KEY, 'plot');
      }
    }
  }

  /**
   * A few crops on plots purely to prove the atlas frames load; planting
   * logic in a later task replaces this.
   */
  private showDemoCrops(): void {
    this.addCrop(0, 0, CROPS.sunwheat.stageFrames[2]);
    this.addCrop(2, 1, CROPS.carrot.stageFrames[1]);
    this.addCrop(3, 2, CROPS.glowberry.stageFrames[2]);
  }

  /** Place a crop sprite so its baseline sits on the tile's iso center. */
  private addCrop(col: number, row: number, frame: string): void {
    const { x, y } = gridToIso(col, row);
    this.add
      .image(x, y, ATLAS_KEY, frame)
      .setOrigin(0.5, CROP_BASELINE_Y / CROP_FRAME_SIZE)
      .setDepth(y);
  }
}
