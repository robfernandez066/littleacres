import Phaser from 'phaser';

import { FARM_COLS, FARM_ROWS } from '../data/farm';
import type { OnboardingStepId } from '../data/onboarding';
import { gridToIso } from '../systems/iso';
import { isModalOpen } from '../systems/modalPanels';
import { ensureGlowTexture } from './glowTexture';

/**
 * Ghost-swipe drag indicator for the onboarding drag steps (plant-rest,
 * harvest-rest): a gold lead dot with a soft under-glow glides a serpentine
 * path through every plot tile center - starting at the TOP corner plot,
 * row 0 out to the right corner, row 1 back, row 2 out again - trailed by
 * staggered smaller, fainter dots so the motion reads as a finger path.
 *
 * Every object is pre-created; steady-state work is position/alpha updates
 * only, driven by one perpetual tween. Dots are plain images that are never
 * made interactive. The whole guide hides per frame while a modal panel is
 * open (same occlusion rule as the pulse-target providers), and it demos at
 * most `MAX_DEMO_LOOPS` complete loops per step before hiding itself for the
 * rest of that step - see `setStep`.
 */

/** Above the panels (2100), same layer as the onboarding halo. */
const SWIPE_DEPTH = 2150;
/** One full path traversal. */
const LOOP_MS = 2500;
/** Fade window at each end of the path, so the loop wrap never teleports. */
const WRAP_FADE_MS = 300;
/** Complete demonstrations shown per step before the guide hides itself. */
const MAX_DEMO_LOOPS = 2;
const DOT_TINT = 0xffe27a;
const LEAD_SIZE = 26;
const LEAD_ALPHA = 0.28;
const LEAD_GLOW_SIZE = 72;
const LEAD_GLOW_ALPHA = 0.1;
/** Trail dots stagger behind the lead by this much each, shrinking and fading. */
const TRAIL_SPACING_MS = 110;
const TRAIL_SIZES = [22, 19, 16, 13, 10] as const;
const TRAIL_ALPHAS = [0.14, 0.11, 0.09, 0.07, 0.05] as const;

interface GuideDot {
  image: Phaser.GameObjects.Image;
  /** How far behind the lead this dot runs, as a fraction of the loop. */
  offset: number;
  baseAlpha: number;
}

export class SwipeGuide {
  private loopTween!: Phaser.Tweens.Tween;
  private readonly dots: GuideDot[] = [];
  private readonly pathX: number[] = [];
  private readonly pathY: number[] = [];
  /** Cumulative path length up to each point; the last entry is the total. */
  private readonly pathDist: number[] = [];
  /** Loop playhead (0..1), driven by one perpetual linear tween. */
  private readonly progress = { t: 0 };
  private shown = false;
  /** Last visibility actually applied to the dot images. */
  private applied = false;
  /** The step this guide is currently demoing for; resets the loop count on change. */
  private stepId: OnboardingStepId | null = null;
  /** Complete demo loops shown so far for `stepId`. */
  private loopCount = 0;
  /** Once true, the guide stays hidden for the rest of `stepId`. */
  private demoExhausted = false;
  /**
   * Whether the loop in progress has been shown, uninterrupted, since it
   * started - the condition for counting it on completion. Reset at the
   * start of every loop.
   */
  private loopClean = true;

  constructor(scene: Phaser.Scene) {
    this.buildPath();
    const textureKey = ensureGlowTexture(scene);
    const makeDot = (size: number, baseAlpha: number, offset: number): void => {
      const image = scene.add
        .image(0, 0, textureKey)
        .setDisplaySize(size, size)
        .setTint(DOT_TINT)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(SWIPE_DEPTH)
        .setVisible(false);
      this.dots.push({ image, offset, baseAlpha });
    };
    // Farthest trail dot first, lead dot last, so the lead renders on top
    // within the shared depth.
    for (let i = TRAIL_SIZES.length - 1; i >= 0; i--) {
      makeDot(TRAIL_SIZES[i]!, TRAIL_ALPHAS[i]!, ((i + 1) * TRAIL_SPACING_MS) / LOOP_MS);
    }
    makeDot(LEAD_GLOW_SIZE, LEAD_GLOW_ALPHA, 0);
    makeDot(LEAD_SIZE, LEAD_ALPHA, 0);

    this.loopTween = scene.tweens.add({
      targets: this.progress,
      t: 1,
      duration: LOOP_MS,
      repeat: -1,
      ease: 'Linear',
      onUpdate: () => this.apply(),
      onRepeat: () => this.onLoopComplete(),
    });
  }

  /**
   * Rewind the playhead so a demonstration always begins at the start of the
   * path. Without this, the perpetual tween is mid-loop whenever a step (or
   * a post-interruption reveal) begins, and the first stroke the player sees
   * starts somewhere random.
   */
  private restartLoop(): void {
    this.progress.t = 0;
    this.loopTween.restart();
    this.loopClean = true;
  }

  /**
   * Show/hide the guide for the given step; modal occlusion is applied on
   * top of this per frame. Changing `stepId` resets the demo loop count, so
   * every step gets its own `MAX_DEMO_LOOPS` allowance regardless of how the
   * shared perpetual tween happens to be phased. Once that allowance is used
   * up the guide stays hidden - even if `active` is still true - until the
   * step changes again.
   */
  setStep(stepId: OnboardingStepId | null, active: boolean): void {
    if (stepId !== this.stepId) {
      this.stepId = stepId;
      this.loopCount = 0;
      this.demoExhausted = false;
      this.restartLoop();
    }
    this.shown = active && !this.demoExhausted;
  }

  /**
   * Called each time the perpetual tween wraps back to the start of a loop.
   * The loop that just finished counts toward the step's demo allowance only
   * if it was shown, uninterrupted, for its entire duration - a loop that
   * starts mid-flight (the step just became active) or crosses a modal panel
   * opening does not count.
   */
  private onLoopComplete(): void {
    if (this.loopClean && this.shown) {
      this.loopCount++;
      if (this.loopCount >= MAX_DEMO_LOOPS) {
        this.demoExhausted = true;
        this.shown = false;
      }
    }
    this.loopClean = true;
  }

  /**
   * The serpentine polyline through all plot tile centers, with cumulative
   * segment lengths for constant-speed traversal. Built once. Row-major,
   * starting at the TOP corner plot (col 0, row 0): row 0 runs along the
   * upper-right edge to the right corner, row 1 comes back, row 2 runs out
   * again, descending to the bottom - user-picked path (Option A).
   */
  private buildPath(): void {
    let total = 0;
    for (let row = 0; row < FARM_ROWS; row++) {
      for (let c = 0; c < FARM_COLS; c++) {
        const col = row % 2 === 0 ? c : FARM_COLS - 1 - c;
        const { x, y } = gridToIso(col, row, FARM_ROWS);
        const last = this.pathX.length - 1;
        if (last >= 0) total += Math.hypot(x - this.pathX[last]!, y - this.pathY[last]!);
        this.pathX.push(x);
        this.pathY.push(y);
        this.pathDist.push(total);
      }
    }
  }

  /** Per-frame update: resolve effective visibility, then place every dot. */
  private apply(): void {
    const visible = this.shown && !isModalOpen();
    if (!visible) this.loopClean = false;
    if (visible !== this.applied) {
      this.applied = visible;
      for (const dot of this.dots) dot.image.setVisible(visible);
      // A reveal (step start or post-interruption) always demos from the
      // start of the path - never from wherever the playhead happened to be.
      if (visible) this.restartLoop();
    }
    if (!visible) return;
    for (const dot of this.dots) {
      // Clamped (not wrapped) playhead: at the start of a stroke the trail
      // bunches at the start point and stretches out as the finger moves -
      // wrapping instead would leave the trail strung across the END of the
      // path at loop start, which reads as a phantom stroke.
      this.placeDot(dot, Math.max(0, this.progress.t - dot.offset));
    }
  }

  /** Position one dot at fraction `t` of the path and apply its wrap fade. */
  private placeDot(dot: GuideDot, t: number): void {
    const fadeFraction = WRAP_FADE_MS / LOOP_MS;
    dot.image.setAlpha(dot.baseAlpha * Math.min(1, Math.min(t, 1 - t) / fadeFraction));

    const target = t * this.pathDist[this.pathDist.length - 1]!;
    let i = 1;
    while (i < this.pathDist.length - 1 && this.pathDist[i]! < target) i++;
    const d0 = this.pathDist[i - 1]!;
    const span = this.pathDist[i]! - d0;
    const u = span > 0 ? (target - d0) / span : 0;
    dot.image.setPosition(
      this.pathX[i - 1]! + (this.pathX[i]! - this.pathX[i - 1]!) * u,
      this.pathY[i - 1]! + (this.pathY[i]! - this.pathY[i - 1]!) * u,
    );
  }
}
