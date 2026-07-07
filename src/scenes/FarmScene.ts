import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH } from '../config';
import { CROP_BASELINE_Y, CROP_FRAME_SIZE, CROPS } from '../data/crops';
import { FARM_COLS, FARM_ROWS } from '../data/farm';
import { gameState, PLOT_COUNT } from '../systems/gameState';
import { isReady, stageIndex } from '../systems/growth';
import { gridToIso, TILE_WIDTH } from '../systems/iso';
import { PlotPointerTracker } from '../systems/plotPointer';
import { now } from '../systems/time';
import { SeedBar } from '../ui/SeedBar';

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

/** How often (ms of real time) growth visuals re-derive from state/clock. */
const CROP_REFRESH_INTERVAL_MS = 250;

/** Tint applied to a ready-to-harvest crop, on top of its normal frame. */
const READY_TINT = 0xfff59d;

/**
 * The main farm scene: a FARM_COLS x FARM_ROWS grid of plots in the middle of
 * a grass field, rendered live from `gameState`, plus the seed bar. With a
 * seed selected, tapping or dragging across the field paint-plants empty
 * plots. Harvest input arrives in a later task; `dev.harvest` drives it.
 *
 * Plot index convention (matches `gameState.plots`): index = row * FARM_COLS
 * + col. Any future code mapping a tile tap to a plot must use the same
 * formula (see `indexToGrid` below).
 */
export class FarmScene extends Phaser.Scene {
  /** One reusable crop sprite per plot, indexed like `gameState.plots`. */
  private cropSprites: Phaser.GameObjects.Image[] = [];
  /** Whether the ready-state bounce/glow is currently active, per plot. */
  private readyActive: boolean[] = [];
  private refreshAccumulatorMs = 0;
  private seedBar!: SeedBar;
  /** Dedups plots per drag gesture; shared shape with next task's harvest. */
  private readonly plotTracker = new PlotPointerTracker();

  constructor() {
    super('Farm');
  }

  create(): void {
    this.add.rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, BACKGROUND_COLOR).setOrigin(0, 0);

    this.layGrassField();
    this.layPlots();
    this.createCropSprites();
    this.seedBar = new SeedBar(this);
    this.setupPlantingInput();
    this.refreshCrops();
  }

  override update(_time: number, delta: number): void {
    this.refreshAccumulatorMs += delta;
    if (this.refreshAccumulatorMs < CROP_REFRESH_INTERVAL_MS) return;
    this.refreshAccumulatorMs = 0;
    this.refreshCrops();
    this.seedBar.refresh();
  }

  /**
   * Paint planting: with a seed selected, pointerdown/drag over the field
   * attempts to plant every plot the pointer newly enters (once per gesture,
   * courtesy of PlotPointerTracker). With no seed selected, field input is
   * inert - harvest taps arrive in a later task.
   */
  private setupPlantingInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (this.seedBar.getSelected() === null) return;
      this.tryPlant(this.plotTracker.begin(pointer.worldX, pointer.worldY));
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown || this.seedBar.getSelected() === null) return;
      this.tryPlant(this.plotTracker.move(pointer.worldX, pointer.worldY));
    });
    const endGesture = (): void => {
      this.plotTracker.end();
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, endGesture);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, endGesture);
  }

  /**
   * Attempt to plant the selected crop on a plot. All planting rules live in
   * `gameState.plantCrop`; on failure this only picks the feedback cue -
   * occupied plots stay silent, an unaffordable seed gets a gentle nudge.
   */
  private tryPlant(plotIndex: number | null): void {
    const cropId = this.seedBar.getSelected();
    if (plotIndex === null || cropId === null) return;
    if (gameState.plantCrop(plotIndex, cropId)) {
      this.refreshCrops();
      this.playPlantPop(plotIndex);
      return;
    }
    const state = gameState.getState();
    if (state.plots[plotIndex]?.state !== 'empty') return;
    if (state.coins < CROPS[cropId].seedCost) this.seedBar.flashInsufficientCoins(cropId);
  }

  /** Placeholder "plip" on a fresh plant; real particles come later. */
  private playPlantPop(plotIndex: number): void {
    const sprite = this.cropSprites[plotIndex];
    if (sprite === undefined) return;
    this.tweens.killTweensOf(sprite);
    sprite.setScale(0.5);
    this.tweens.add({ targets: sprite, scale: 1, duration: 120, ease: 'Back.easeOut' });
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

  /** (col, row) for a plot index, inverse of `index = row * FARM_COLS + col`. */
  private indexToGrid(index: number): { col: number; row: number } {
    return { col: index % FARM_COLS, row: Math.floor(index / FARM_COLS) };
  }

  /**
   * Create the 12 crop sprites once, positioned on their plot's tile with the
   * baseline anchoring, hidden until their plot has a growing crop. These
   * sprites are reused for the life of the scene - no per-frame allocation.
   */
  private createCropSprites(): void {
    for (let index = 0; index < PLOT_COUNT; index++) {
      const { col, row } = this.indexToGrid(index);
      const { x, y } = gridToIso(col, row);
      const sprite = this.add
        .image(x, y, ATLAS_KEY, CROPS.sunwheat.stageFrames[0])
        .setOrigin(0.5, CROP_BASELINE_Y / CROP_FRAME_SIZE)
        .setDepth(y)
        .setVisible(false);
      this.cropSprites[index] = sprite;
      this.readyActive[index] = false;
    }
  }

  /**
   * Re-derive every plot's visuals from `gameState` and the game clock:
   * show/hide the sprite, set its growth-stage frame, and start/stop the
   * ready-state bounce and glow. Reads state fresh every call - the scene
   * never caches plot data beyond the sprite objects themselves.
   */
  private refreshCrops(): void {
    const plots = gameState.getState().plots;
    const nowMs = now();
    for (let index = 0; index < PLOT_COUNT; index++) {
      const plot = plots[index];
      const sprite = this.cropSprites[index];
      if (plot === undefined || sprite === undefined) continue;

      if (plot.state === 'empty') {
        sprite.setVisible(false);
        this.stopReadyEffect(index, sprite);
        continue;
      }

      sprite.setVisible(true);
      // stageIndex() is clamped to 0..CROP_STAGES-1, which stageFrames always covers.
      const frame = CROPS[plot.cropId].stageFrames[stageIndex(plot, nowMs)]!;
      if (sprite.frame.name !== frame) sprite.setFrame(frame);

      if (isReady(plot, nowMs)) {
        this.startReadyEffect(index, sprite);
      } else {
        this.stopReadyEffect(index, sprite);
      }
    }
  }

  /** Start the idle bounce + glow tint on a just-ready crop; idempotent. */
  private startReadyEffect(index: number, sprite: Phaser.GameObjects.Image): void {
    if (this.readyActive[index]) return;
    this.readyActive[index] = true;
    sprite.setTint(READY_TINT);
    this.tweens.add({
      targets: sprite,
      scale: 1.06,
      duration: 450,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** Stop the idle bounce + glow tint and restore defaults; idempotent. */
  private stopReadyEffect(index: number, sprite: Phaser.GameObjects.Image): void {
    if (!this.readyActive[index]) return;
    this.readyActive[index] = false;
    this.tweens.killTweensOf(sprite);
    sprite.setScale(1);
    sprite.clearTint();
  }
}
