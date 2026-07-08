import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH } from '../config';
import { CROP_BASELINE_Y, CROP_FRAME_SIZE, CROPS, type CropId } from '../data/crops';
import { FARM_COLS } from '../data/farm';
import { registerCoinArcTest } from '../systems/dev';
import { gameState, PLOT_COUNT } from '../systems/gameState';
import { isReady, stageIndex } from '../systems/growth';
import { buzz } from '../systems/haptics';
import { gridToIso, TILE_HEIGHT, TILE_WIDTH } from '../systems/iso';
import { isModalOpen } from '../systems/modalPanels';
import { PlotPointerTracker } from '../systems/plotPointer';
import { registerPulseTarget, type PulseTarget } from '../systems/pulseTargets';
import { now } from '../systems/time';
import { CoinArc } from '../ui/CoinArc';
import { FloatingText, type FloatingTextOptions } from '../ui/FloatingText';
import { Hud } from '../ui/Hud';
import { LevelUpCelebration } from '../ui/LevelUpCelebration';
import { OnboardingGuide } from '../ui/OnboardingGuide';
import { ParticleBurst } from '../ui/ParticleBurst';
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

/** Harvest pop: quick scale-up + fade-out on the reaped sprite. */
const HARVEST_POP_SCALE = 1.25;
const HARVEST_POP_DURATION_MS = 150;

/** Light haptic pulse on a successful harvest or plant. */
const HAPTIC_LIGHT_MS = 12;

/** Where the floating xp label spawns relative to a plot's tile center. */
const XP_LABEL_OFFSET_Y = -70;
/** Where bursts spawn relative to a plot's tile center (at the plant, not the dirt). */
const BURST_OFFSET_Y = -30;

/** Pre-built "+N xp" labels and a shared options object - the harvest path
 * allocates no strings or option objects in steady state. */
const XP_LABELS = Object.fromEntries(
  Object.values(CROPS).map((crop) => [crop.id, `+${crop.xp} xp`]),
) as Record<CropId, string>;
const XP_TEXT_OPTIONS: FloatingTextOptions = { color: '#fff3c4', fontSize: 44 };

/**
 * The main farm scene: a FARM_COLS x FARM_ROWS grid of plots in the middle of
 * a grass field, rendered live from `gameState`, plus the seed bar. One
 * unified field gesture: tapping or sweeping harvests every ready crop the
 * pointer enters, and (with a seed selected) paint-plants empty plots.
 *
 * Plot index convention (matches `gameState.plots`): index = row * FARM_COLS
 * + col. Any future code mapping a tile tap to a plot must use the same
 * formula (see `indexToGrid` below).
 */
export class FarmScene extends Phaser.Scene {
  /** One reusable crop sprite per plot, indexed like `gameState.plots`. */
  private cropSprites: Phaser.GameObjects.Image[] = [];
  /**
   * One tile image per plot, indexed like `gameState.plots`. Kept so the
   * onboarding highlight can breathe the TILE - never the crop sprite, which
   * owns its own ready bounce.
   */
  private readonly plotTiles: Phaser.GameObjects.Image[] = [];
  /** Whether the ready-state bounce/glow is currently active, per plot. */
  private readyActive: boolean[] = [];
  /**
   * Whether a harvest pop is mid-flight, per plot. Keeps `refreshCrops` from
   * hiding the sprite the moment state says the plot is empty again.
   */
  private popActive: boolean[] = [];
  private refreshAccumulatorMs = 0;
  private seedBar!: SeedBar;
  private floatingText!: FloatingText;
  private particles!: ParticleBurst;
  private coinArc!: CoinArc;
  private hud!: Hud;
  private levelUpCelebration!: LevelUpCelebration;
  private onboardingGuide!: OnboardingGuide;
  /** Static screen position of each plot's tile center, precomputed once. */
  private readonly plotPositions: { x: number; y: number }[] = [];
  /** Dedups plots per drag gesture; shared shape with next task's harvest. */
  private readonly plotTracker = new PlotPointerTracker();
  /**
   * Locks the current gesture to whichever action first succeeds, so a sweep
   * cannot both harvest and plant. Null while unlocked (no successful action
   * yet this gesture); reset on gesture start/end.
   */
  private gestureMode: 'harvest' | 'plant' | null = null;

  constructor() {
    super('Farm');
  }

  create(): void {
    this.add.rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, BACKGROUND_COLOR).setOrigin(0, 0);

    this.layGrassField();
    this.layPlots();
    this.createCropSprites();
    this.floatingText = new FloatingText(this);
    this.particles = new ParticleBurst(this);
    this.coinArc = new CoinArc(this);
    this.seedBar = new SeedBar(this);
    // Fill pending/expired order slots before the HUD's first render.
    gameState.ensureOrders();
    this.hud = new Hud(this, this.coinArc, this.floatingText);
    registerPulseTarget('empty-plot', () => this.plotPulseTarget('empty'));
    registerPulseTarget('ready-plot', () => this.plotPulseTarget('ready'));
    this.onboardingGuide = new OnboardingGuide(this);
    this.levelUpCelebration = new LevelUpCelebration(this, this.particles);
    this.setupFieldInput();
    this.refreshCrops();
    this.onboardingGuide.refresh(gameState.getState());

    // Coin arcs are not wired to gameplay until the HUD/sell task; expose a
    // console hook so curved flights can be verified now.
    registerCoinArcTest((n) => this.coinArc.fly(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, n));
  }

  override update(_time: number, delta: number): void {
    this.refreshAccumulatorMs += delta;
    if (this.refreshAccumulatorMs < CROP_REFRESH_INTERVAL_MS) return;
    this.refreshAccumulatorMs = 0;
    gameState.ensureOrders();
    this.refreshCrops();
    this.seedBar.refresh();
    this.hud.refresh();
    // Onboarding's select-sunwheat step: checked every tick (not just on the
    // tap) so a selection made before the step began still counts. Cheap
    // no-op whenever the step is not active.
    if (this.seedBar.getSelected() === 'sunwheat') {
      gameState.notifyOnboardingUiEvent('select-sunwheat');
    }
    // Anti-stuck guard for sell-rest and the review-order read-dwell
    // (store-side logic; the scene only provides the tick).
    gameState.autoAdvanceOnboarding();
    this.onboardingGuide.refresh(gameState.getState());
    this.levelUpCelebration.enqueue(gameState.consumeLevelUpEvents());
  }

  /**
   * Unified field gesture: every plot the pointer newly enters (tap or drag,
   * at most once per gesture courtesy of PlotPointerTracker) is offered to
   * harvest first, then to plant. Harvesting never requires deselecting a
   * seed, and the per-gesture dedup guarantees a just-harvested plot cannot
   * be replanted within the same sweep.
   */
  private setupFieldInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.gestureMode = null;
      this.handlePlotEntered(this.plotTracker.begin(pointer.worldX, pointer.worldY));
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      this.handlePlotEntered(this.plotTracker.move(pointer.worldX, pointer.worldY));
    });
    const endGesture = (): void => {
      this.plotTracker.end();
      this.gestureMode = null;
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, endGesture);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, endGesture);
  }

  /**
   * All harvest/plant rules live in the store: try the harvest first (only a
   * growing-and-ready plot succeeds), otherwise fall through to planting.
   * Growing-but-not-ready plots and empty plots with no seed selected fail
   * both silently. A gesture locks to whichever action first succeeds
   * (`gestureMode`), so a harvest sweep cannot plant empty plots it crosses
   * and a plant sweep cannot harvest ready crops it crosses. A level-up
   * celebration blocks the field entirely - its full-screen backdrop already
   * eats the tap, this just guards the scene-wide pointer listeners too. An
   * open modal panel (order board, inventory) blocks it the same way: field
   * gestures are scene-wide listeners, not per-object hit tests, so panel
   * hit-testing alone never stops a tap from reaching the field beneath it.
   */
  private handlePlotEntered(plotIndex: number | null): void {
    if (plotIndex === null || this.levelUpCelebration.isActive() || isModalOpen()) return;
    if (this.gestureMode !== 'plant') {
      // The crop id must be read before the harvest empties the plot - the
      // floating xp label needs it.
      const plot = gameState.getState().plots[plotIndex];
      if (gameState.harvestPlot(plotIndex)) {
        this.gestureMode = 'harvest';
        this.playHarvestPop(plotIndex);
        if (plot?.state === 'growing') this.playHarvestJuice(plotIndex, plot.cropId);
        return;
      }
      if (this.gestureMode === 'harvest') return;
    }
    this.tryPlant(plotIndex);
  }

  /** Leaf burst + floating "+N xp" + light buzz + a crop flight to the bag. */
  private playHarvestJuice(plotIndex: number, cropId: CropId): void {
    const pos = this.plotPositions[plotIndex];
    if (pos === undefined) return;
    this.particles.burst('leaf', pos.x, pos.y + BURST_OFFSET_Y);
    this.floatingText.show(pos.x, pos.y + XP_LABEL_OFFSET_Y, XP_LABELS[cropId], XP_TEXT_OPTIONS);
    buzz(HAPTIC_LIGHT_MS);
    this.hud.flyCropToBag(pos.x, pos.y + BURST_OFFSET_Y, cropId);
  }

  /**
   * Attempt to plant the selected crop on a plot. All planting rules live in
   * `gameState.plantCrop`; on failure this only picks the feedback cue -
   * occupied plots stay silent, an unaffordable seed gets a gentle nudge.
   */
  private tryPlant(plotIndex: number): void {
    const cropId = this.seedBar.getSelected();
    if (cropId === null) return;
    if (gameState.plantCrop(plotIndex, cropId)) {
      this.gestureMode = 'plant';
      this.refreshCrops();
      this.playPlantPop(plotIndex);
      const pos = this.plotPositions[plotIndex];
      if (pos !== undefined) this.particles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
      buzz(HAPTIC_LIGHT_MS);
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
    // A replant can land while the previous harvest pop is still mid-flight
    // (next gesture within its 150ms); cancel that pop cleanly first.
    this.tweens.killTweensOf(sprite);
    this.popActive[plotIndex] = false;
    sprite.setAlpha(1).setScale(0.5);
    this.tweens.add({ targets: sprite, scale: 1, duration: 120, ease: 'Back.easeOut' });
  }

  /**
   * Placeholder harvest pop: scale up while fading out, then fully reset the
   * pooled sprite (alpha 1, scale 1, hidden, tint cleared). The ready effect
   * stops immediately so nothing glows during the pop; `popActive` keeps the
   * refresh tick from hiding the sprite before the pop finishes.
   */
  private playHarvestPop(plotIndex: number): void {
    const sprite = this.cropSprites[plotIndex];
    if (sprite === undefined) return;
    this.stopReadyEffect(plotIndex, sprite);
    this.tweens.killTweensOf(sprite);
    this.popActive[plotIndex] = true;
    this.tweens.add({
      targets: sprite,
      scale: HARVEST_POP_SCALE,
      alpha: 0,
      duration: HARVEST_POP_DURATION_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.popActive[plotIndex] = false;
        sprite.setVisible(false).setAlpha(1).setScale(1).clearTint();
      },
    });
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

  /** The 4x3 grid of tilled plots, centered by the iso origin; one tile per plot index. */
  private layPlots(): void {
    for (let index = 0; index < PLOT_COUNT; index++) {
      const { col, row } = this.indexToGrid(index);
      const { x, y } = gridToIso(col, row);
      this.plotTiles[index] = this.add.image(x, y, ATLAS_KEY, 'plot');
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
      this.plotPositions[index] = { x, y };
      this.readyActive[index] = false;
      this.popActive[index] = false;
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
        // A mid-pop sprite is already reset-and-hidden by the pop's own
        // completion callback; touching it here would cut the animation.
        if (!this.popActive[index]) {
          sprite.setVisible(false);
          this.stopReadyEffect(index, sprite);
        }
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

  /**
   * Onboarding pulse target on the field: the first empty (or first
   * harvest-ready) plot, or null when none qualifies - a null for 'ready'
   * while everything is mid-growth means no highlight, by design. Also null
   * while a modal panel is open: the field is occluded and untappable then,
   * so it is never a valid pulse target. Targets the tile image (safe to
   * scale-breathe), never the crop sprite - ready crops run their own bounce.
   */
  private plotPulseTarget(kind: 'empty' | 'ready'): PulseTarget | null {
    if (isModalOpen()) return null;
    const plots = gameState.getState().plots;
    const nowMs = now();
    for (let index = 0; index < PLOT_COUNT; index++) {
      const plot = plots[index];
      const pos = this.plotPositions[index];
      const tile = this.plotTiles[index];
      if (plot === undefined || pos === undefined || tile === undefined) continue;
      const matches =
        kind === 'empty'
          ? plot.state === 'empty'
          : plot.state === 'growing' && isReady(plot, nowMs);
      if (matches) {
        return { x: pos.x, y: pos.y, width: TILE_WIDTH, height: TILE_HEIGHT, object: tile };
      }
    }
    return null;
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
