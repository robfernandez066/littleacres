import Phaser from 'phaser';

import { FARM_COLS, FARM_ROWS } from '../data/farm';
import { gridToIso } from '../systems/iso';
import { isModalOpen } from '../systems/modalPanels';
import { ensureGlowTexture } from './glowTexture';

/**
 * Ghost-swipe drag indicator for the onboarding drag steps (plant-rest,
 * harvest-rest): a gold lead dot with a soft under-glow glides a serpentine
 * path through every plot tile center - row 0 left to right, row 1 right to
 * left, row 2 left to right - trailed by staggered smaller, fainter dots so
 * the motion reads as a finger path.
 *
 * Every object is pre-created; steady-state work is position/alpha updates
 * only, driven by one perpetual tween. Dots are plain images that are never
 * made interactive. The whole guide hides per frame while a modal panel is
 * open (same occlusion rule as the pulse-target providers).
 */

/** Above the panels (2100), same layer as the onboarding halo. */
const SWIPE_DEPTH = 2150;
/** One full path traversal. */
const LOOP_MS = 2500;
/** Fade window at each end of the path, so the loop wrap never teleports. */
const WRAP_FADE_MS = 300;
const DOT_TINT = 0xffe27a;
const LEAD_SIZE = 26;
const LEAD_ALPHA = 0.95;
const LEAD_GLOW_SIZE = 72;
const LEAD_GLOW_ALPHA = 0.35;
/** Trail dots stagger behind the lead by this much each, shrinking and fading. */
const TRAIL_SPACING_MS = 110;
const TRAIL_SIZES = [22, 19, 16, 13, 10] as const;
const TRAIL_ALPHAS = [0.5, 0.4, 0.32, 0.24, 0.16] as const;

interface GuideDot {
  image: Phaser.GameObjects.Image;
  /** How far behind the lead this dot runs, as a fraction of the loop. */
  offset: number;
  baseAlpha: number;
}

export class SwipeGuide {
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

    scene.tweens.add({
      targets: this.progress,
      t: 1,
      duration: LOOP_MS,
      repeat: -1,
      ease: 'Linear',
      onUpdate: () => this.apply(),
    });
  }

  /** Show/hide the guide; modal occlusion is applied on top of this per frame. */
  setShown(shown: boolean): void {
    this.shown = shown;
  }

  /**
   * The serpentine polyline through all plot tile centers, with cumulative
   * segment lengths for constant-speed traversal. Built once.
   */
  private buildPath(): void {
    let total = 0;
    for (let row = 0; row < FARM_ROWS; row++) {
      for (let step = 0; step < FARM_COLS; step++) {
        const col = row % 2 === 0 ? step : FARM_COLS - 1 - step;
        const { x, y } = gridToIso(col, row);
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
    if (visible !== this.applied) {
      this.applied = visible;
      for (const dot of this.dots) dot.image.setVisible(visible);
    }
    if (!visible) return;
    for (const dot of this.dots) {
      // Wrapped playhead: a trail dot keeps finishing the previous stroke
      // while the lead has already restarted; the per-dot end fades make the
      // wrap read as the finger lifting and starting a new swipe.
      this.placeDot(dot, (this.progress.t - dot.offset + 1) % 1);
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
