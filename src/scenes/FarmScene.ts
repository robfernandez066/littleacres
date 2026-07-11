import Phaser from 'phaser';

import {
  ATLAS_KEY,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  TILE_DIAMOND_CENTER_Y,
  TILE_FRAME_HEIGHT,
} from '../config';
import { CROP_BASELINE_Y, CROP_FRAME_SIZE, CROPS, type CropId } from '../data/crops';
import { BASE_PLOT_COUNT, EXPANDED_PLOT_COUNT, FARM_COLS } from '../data/farm';
import { AudioManager } from '../systems/audio';
import { registerCoinArcTest } from '../systems/dev';
import { gameState } from '../systems/gameState';
import { isReady, stageIndex } from '../systems/growth';
import { buzz } from '../systems/haptics';
import { gridToIso, TILE_HEIGHT, TILE_WIDTH } from '../systems/iso';
import { isModalOpen } from '../systems/modalPanels';
import { PlotPointerTracker } from '../systems/plotPointer';
import { registerPulseTarget, type PulseTarget } from '../systems/pulseTargets';
import { now } from '../systems/time';
import { CoinArc } from '../ui/CoinArc';
import { ExpandSign } from '../ui/ExpandSign';
import { FloatingText, type FloatingTextOptions } from '../ui/FloatingText';
import { Hud } from '../ui/Hud';
import { LevelUpCelebration } from '../ui/LevelUpCelebration';
import { OfflineSummaryPanel } from '../ui/OfflineSummaryPanel';
import { OnboardingGuide } from '../ui/OnboardingGuide';
import { CropCountdown } from '../ui/CropCountdown';
import { ParticleBurst } from '../ui/ParticleBurst';
import { ReplantChip, type ReplantEntry } from '../ui/ReplantChip';
import { SeedBar } from '../ui/SeedBar';

/** Slightly darker than the grass tiles so the field reads as raised ground. */
const BACKGROUND_COLOR = 0x55913f;

/**
 * Tile sprite origin: x centered, y at the diamond top face's center - the
 * frame is taller than the 2:1 diamond because the art's lip/fringe hangs
 * below it. Positioning stays "tile center at gridToIso(col, row)", so the
 * grid math and hit-testing are untouched by the taller frame.
 */
const TILE_ORIGIN_Y = TILE_DIAMOND_CENTER_Y / TILE_FRAME_HEIGHT;

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
/** Medium haptic pulse on a successful farm expansion. */
const HAPTIC_MEDIUM_MS = 25;

/** Delay before each new plot's tile fade-in starts when the farm expands. */
const EXPAND_REVEAL_STAGGER_MS = 1200;
/** Duration of each new plot's tile fade-in when the farm expands. */
const EXPAND_REVEAL_FADE_MS = 2400;

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
 * Radiant harvest juice: large gold floating text well above the xp-label
 * layer (-70), so it reads even mid-sweep with "+N xp" labels firing all
 * around it.
 */
const RADIANT_LABEL = 'Radiant! x5';
const RADIANT_TEXT_OPTIONS: FloatingTextOptions = { color: '#ffd700', fontSize: 68 };
/** Where the Radiant label spawns relative to a plot's tile center. */
const RADIANT_LABEL_OFFSET_Y = -140;
/** Delay before a Radiant proc's second sparkle burst, for a two-stage pop. */
const RADIANT_SECOND_BURST_DELAY_MS = 150;

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
  private replantChip!: ReplantChip;
  private cropCountdown!: CropCountdown;
  private floatingText!: FloatingText;
  private particles!: ParticleBurst;
  private coinArc!: CoinArc;
  private hud!: Hud;
  private levelUpCelebration!: LevelUpCelebration;
  private onboardingGuide!: OnboardingGuide;
  private expandSign!: ExpandSign;
  private offlineSummaryPanel!: OfflineSummaryPanel;
  private audio!: AudioManager;
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
  /** Plots (and their crop) reaped this gesture, offered to the replant chip on gesture end. */
  private harvestedThisGesture: ReplantEntry[] = [];

  constructor() {
    super('Farm');
  }

  create(): void {
    this.add.rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, BACKGROUND_COLOR).setOrigin(0, 0);

    this.layGrassField();
    this.buildPlotVisuals();
    // Before any UI that plays sounds; startMusic self-defers until the
    // sound system unlocks on the first user gesture.
    this.audio = new AudioManager(this);
    this.audio.startMusic();
    this.floatingText = new FloatingText(this);
    this.particles = new ParticleBurst(this);
    this.coinArc = new CoinArc(this);
    this.seedBar = new SeedBar(this, this.audio);
    this.cropCountdown = new CropCountdown(this);
    this.replantChip = new ReplantChip(this, this.audio, (plantedEntries) =>
      this.handleReplanted(plantedEntries),
    );
    // Fill pending/expired order slots before the HUD's first render.
    gameState.ensureOrders();
    this.hud = new Hud(this, this.coinArc, this.floatingText, this.audio);
    registerPulseTarget('empty-plot', () => this.plotPulseTarget('empty'));
    registerPulseTarget('ready-plot', () => this.plotPulseTarget('ready'));
    this.onboardingGuide = new OnboardingGuide(this);
    this.levelUpCelebration = new LevelUpCelebration(this, this.particles, this.audio);
    this.expandSign = new ExpandSign(this, () => this.tryExpand());
    this.expandSign.refresh(gameState.getState());
    this.setupFieldInput();
    this.refreshCrops();
    this.onboardingGuide.refresh(gameState.getState());

    // Checked once per scene start, after every other panel/backdrop exists -
    // it blocks field input like any modal, via the same isModalOpen() gate.
    this.offlineSummaryPanel = new OfflineSummaryPanel(this, this.audio);
    const offlineSummary = gameState.consumeOfflineSummary();
    if (offlineSummary !== null) this.offlineSummaryPanel.show(offlineSummary);

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
    this.replantChip.refresh(gameState.getState());
    this.cropCountdown.refresh(gameState.getState());
    this.hud.refresh();
    // Onboarding's select-sunwheat step: checked every tick (not just on the
    // tap) so a selection made before the step began still counts. Cheap
    // no-op whenever the step is not active.
    if (this.seedBar.getSelected() === 'sunwheat') {
      gameState.notifyOnboardingUiEvent('select-sunwheat');
    }
    // The review-order read-dwell auto-advance (store-side logic; the scene
    // only provides the tick).
    gameState.autoAdvanceOnboarding();
    this.onboardingGuide.refresh(gameState.getState());
    this.levelUpCelebration.enqueue(gameState.consumeLevelUpEvents());
    if (gameState.consumeTutorialCompleteEvent()) this.levelUpCelebration.enqueueTutorialComplete();
    this.expandSign.refresh(gameState.getState());
    const radiantEvents = gameState.consumeRadiantEvents();
    if (radiantEvents.length > 0) {
      for (const event of radiantEvents) this.playRadiantJuice(event.plotIndex);
      // Once per drained batch, not per event - a multi-proc sweep still buzzes/chimes once.
      buzz(HAPTIC_MEDIUM_MS);
      this.audio.sfx('radiant');
    }
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
      this.harvestedThisGesture = [];
      this.replantChip.hide();
      const plotIndex = this.plotTracker.begin(pointer.worldX, pointer.worldY, this.rowCount());
      this.maybeShowCountdown(plotIndex);
      this.handlePlotEntered(plotIndex);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      this.handlePlotEntered(
        this.plotTracker.move(pointer.worldX, pointer.worldY, this.rowCount()),
      );
    });
    const endGesture = (): void => {
      this.plotTracker.end();
      if (
        this.gestureMode === 'harvest' &&
        this.harvestedThisGesture.length > 0 &&
        gameState.getState().onboarding.completed
      ) {
        this.replantChip.show(this.harvestedThisGesture);
      }
      this.gestureMode = null;
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, endGesture);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, endGesture);
  }

  /** Current row count (3 base, 4 once expanded), derived from saved plot count. */
  private rowCount(): number {
    return gameState.getState().plots.length / FARM_COLS;
  }

  /**
   * Attempt the farm expansion purchase. On success, builds the new row's
   * tiles/sprites (state updates instantly - planting on a still-fading plot
   * is allowed), then fades each new plot's tile in from alpha 0 on a
   * staggered timer - a calm reveal with no particle bursts, timed to the
   * expand fanfare which ducks everything else while it plays; on failure
   * (insufficient coins - the sign is hidden once already expanded, so that
   * is the only failure reachable from a tap) nudges the sign instead.
   */
  private tryExpand(): void {
    if (!gameState.expandFarm()) {
      this.expandSign.flashInsufficientCoins();
      return;
    }
    this.audio.expandFanfare();
    // Expansion adds a row, which recenters the iso origin - reposition every
    // existing plot before building the new row's visuals at the new origin.
    const rowCount = this.rowCount();
    for (let index = 0; index < BASE_PLOT_COUNT; index++) {
      this.repositionPlotVisuals(index, rowCount);
    }
    for (let index = BASE_PLOT_COUNT; index < EXPANDED_PLOT_COUNT; index++) {
      this.createPlotVisuals(index, rowCount);
      const tile = this.plotTiles[index];
      if (tile === undefined) continue;
      tile.setAlpha(0);
      this.tweens.add({
        targets: tile,
        alpha: 1,
        delay: (index - BASE_PLOT_COUNT) * EXPAND_REVEAL_STAGGER_MS,
        duration: EXPAND_REVEAL_FADE_MS,
      });
    }
    buzz(HAPTIC_MEDIUM_MS);
    this.expandSign.refresh(gameState.getState());
  }

  /**
   * A tap's first-contact plot only (never a mid-sweep POINTER_MOVE entry):
   * shows the live countdown when that plot is growing-but-not-ready, the
   * one case where both harvest and plant fall through and a tap would
   * otherwise do nothing. Suppressed while onboarding is active (the
   * tutorial chip owns countdown duty there) or a modal panel is open.
   */
  private maybeShowCountdown(plotIndex: number | null): void {
    if (plotIndex === null || isModalOpen()) return;
    const state = gameState.getState();
    if (!state.onboarding.completed) return;
    const plot = state.plots[plotIndex];
    if (plot?.state !== 'growing' || isReady(plot, now())) return;
    const pos = this.plotPositions[plotIndex];
    if (pos === undefined) return;
    this.cropCountdown.show(plotIndex, pos);
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
        this.audio.harvestPop();
        this.playHarvestPop(plotIndex);
        if (plot?.state === 'growing') {
          this.playHarvestJuice(plotIndex, plot.cropId);
          this.harvestedThisGesture.push({ plotIndex, cropId: plot.cropId });
        }
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
   * Radiant harvest follow-up flourish: a two-stage sparkle burst + gold
   * "Radiant! x5" label above the plot. Drained from the store's event queue
   * on the refresh tick, so it lands ~250ms behind the harvest pop - a
   * deliberate follow-up beat, not a bug. The buzz/chime for the batch this
   * event belongs to are fired by the caller, once per batch.
   */
  private playRadiantJuice(plotIndex: number): void {
    const pos = this.plotPositions[plotIndex];
    if (pos === undefined) return;
    this.particles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
    this.floatingText.show(
      pos.x,
      pos.y + RADIANT_LABEL_OFFSET_Y,
      RADIANT_LABEL,
      RADIANT_TEXT_OPTIONS,
    );
    this.time.delayedCall(RADIANT_SECOND_BURST_DELAY_MS, () => {
      this.particles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
    });
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
      this.audio.sfx('plant');
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

  /**
   * The replant chip's juice callback: the chip owns no scene visuals, so it
   * hands back exactly the plots it actually planted for the usual plant pop
   * + sparkle burst per plot, mirroring `tryPlant`'s success path.
   */
  private handleReplanted(plantedEntries: ReplantEntry[]): void {
    this.refreshCrops();
    for (const { plotIndex } of plantedEntries) {
      this.playPlantPop(plotIndex);
      const pos = this.plotPositions[plotIndex];
      if (pos !== undefined) this.particles.burst('sparkle', pos.x, pos.y + BURST_OFFSET_Y);
    }
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
        this.add.image(x, y, ATLAS_KEY, 'grass').setOrigin(0.5, TILE_ORIGIN_Y);
      }
    }
  }

  /**
   * Build the plot tile + crop sprite for every saved plot (12 on a fresh or
   * unexpanded save, 16 on an expanded one) - so a 16-plot save renders its
   * 4th row, correctly recentered, immediately on load. Also called (per new
   * index) at runtime when `tryExpand` succeeds, so the new row appears
   * without a scene reload.
   */
  private buildPlotVisuals(): void {
    const plotCount = gameState.getState().plots.length;
    const rowCount = plotCount / FARM_COLS;
    for (let index = 0; index < plotCount; index++) {
      this.createPlotVisuals(index, rowCount);
    }
  }

  /** (col, row) for a plot index, inverse of `index = row * FARM_COLS + col`. */
  private indexToGrid(index: number): { col: number; row: number } {
    return { col: index % FARM_COLS, row: Math.floor(index / FARM_COLS) };
  }

  /**
   * Create one plot's tile and crop sprite, positioned on the iso grid (for
   * the given current row count) with the crop's baseline anchoring, hidden
   * until the plot has a growing crop. Sprites are reused for the life of the
   * scene - no per-frame allocation.
   */
  private createPlotVisuals(index: number, rowCount: number): void {
    const { col, row } = this.indexToGrid(index);
    const { x, y } = gridToIso(col, row, rowCount);
    this.plotTiles[index] = this.add.image(x, y, ATLAS_KEY, 'plot').setOrigin(0.5, TILE_ORIGIN_Y);
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

  /**
   * Reposition an already-built plot's tile/sprite for a new row count - used
   * when expansion recenters the whole grid. Depth is re-derived from the new
   * y like at creation, so draw order stays correct after the shift.
   */
  private repositionPlotVisuals(index: number, rowCount: number): void {
    const { col, row } = this.indexToGrid(index);
    const { x, y } = gridToIso(col, row, rowCount);
    this.plotTiles[index]?.setPosition(x, y);
    this.cropSprites[index]?.setPosition(x, y).setDepth(y);
    this.plotPositions[index] = { x, y };
  }

  /**
   * Keep the built tile/sprite set in step with `plots.length`, so a plot
   * count change outside `tryExpand` (a dev reset of an expanded save back
   * to 12 plots, or importing a 16-plot save) renders correctly without a
   * reload: extras are destroyed, missing ones are created, and everything
   * remaining is repositioned for the new grid origin. A cheap length check
   * on the refresh tick; a no-op after `tryExpand`, which builds its own.
   */
  private syncPlotVisuals(plotCount: number): void {
    if (this.plotTiles.length === plotCount) return;
    const rowCount = plotCount / FARM_COLS;
    while (this.plotTiles.length > plotCount) {
      this.plotTiles.pop()?.destroy();
      const sprite = this.cropSprites.pop();
      if (sprite !== undefined) {
        this.tweens.killTweensOf(sprite);
        sprite.destroy();
      }
      this.plotPositions.pop();
      this.readyActive.pop();
      this.popActive.pop();
    }
    for (let index = 0; index < this.plotTiles.length; index++) {
      this.repositionPlotVisuals(index, rowCount);
    }
    while (this.plotTiles.length < plotCount) {
      this.createPlotVisuals(this.plotTiles.length, rowCount);
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
    this.syncPlotVisuals(plots.length);
    const nowMs = now();
    for (let index = 0; index < plots.length; index++) {
      const plot = plots[index];
      const sprite = this.cropSprites[index];
      if (plot === undefined || sprite === undefined) continue;

      // Occupied plots show the planted-soil tile; frame set only on change,
      // same pattern as the crop sprite frames below.
      const tile = this.plotTiles[index];
      const tileFrame = plot.state === 'growing' ? 'plot_occupied' : 'plot';
      if (tile !== undefined && tile.frame.name !== tileFrame) tile.setFrame(tileFrame);

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
   * harvest-ready) plot by index, or null when none qualifies - a null for
   * 'ready' while everything is mid-growth means no highlight, by design.
   * Also null while a modal panel is open: the field is occluded and
   * untappable then, so it is never a valid pulse target. Targets the tile
   * image (safe to scale-breathe), never the crop sprite - ready crops run
   * their own bounce.
   *
   * Index 0 is the TOP corner plot, which is also where the ghost-swipe
   * serpentine begins - so the tutorial's tap steps naturally put the
   * player's finger at the drag demo's start point.
   */
  private plotPulseTarget(kind: 'empty' | 'ready'): PulseTarget | null {
    if (isModalOpen()) return null;
    const plots = gameState.getState().plots;
    const nowMs = now();
    for (let index = 0; index < plots.length; index++) {
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
