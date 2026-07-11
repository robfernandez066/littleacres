import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import {
  HARVEST_COUNTDOWN_INSTRUCTION,
  ONBOARDING_STEPS,
  type OnboardingStep,
} from '../data/onboarding';
import type { GameStateData } from '../systems/gameState';
import { secondsUntilNextReady } from '../systems/growth';
import { resolvePulseTarget, type PulseTarget } from '../systems/pulseTargets';
import { now } from '../systems/time';
import { ensureGlowTexture } from './glowTexture';
import { SwipeGuide } from './SwipeGuide';

/**
 * Onboarding overlay: a small instruction chip below the xp bar plus, per
 * step, either a warm glow highlight on the step's target (tap steps) or the
 * ghost-swipe drag indicator (the plant-rest / harvest-rest drag steps). No
 * modal, no text wall - nothing here is interactive.
 *
 * The highlight is a soft additive halo rendered over the target, and, when
 * the resolved target carries a scale-safe `object`, that object breathes in
 * sync with the halo (scale only - tint states belong to their owners). The
 * object's scale is recorded on attach and restored exactly on every
 * retarget/hide, following the stopReadyEffect pattern.
 *
 * Rendered purely from the `GameStateData` passed to `refresh` plus the
 * pulse-target registry; hidden forever once onboarding completes. Per-tick
 * work is allocation-free: the chip, halo, swipe guide, and the one breathing
 * tween are created once and only retargeted.
 */

const CHIP_X = DESIGN_WIDTH / 2;
const CHIP_Y = 320;
/** Narrow enough to clear the Orders button (left edge x 840) at the same height. */
const CHIP_WIDTH = 580;
const CHIP_HEIGHT = 84;
/** Copy longer than this shrinks to fit rather than spilling off the chip. */
const CHIP_TEXT_MAX_WIDTH = CHIP_WIDTH - 40;
/** Above the panels (2100): tutorial instructions must read over whatever they instruct about. Still below the glow halo (2150) and celebration (2300). */
const CHIP_DEPTH = 2125;

/** Above the panels (2100), below arcs (2200) and the celebration (2300). */
const HALO_DEPTH = 2150;
const HALO_TINT = 0xffe27a;
/** Halo bounds relative to the target's (non-uniform for wide targets). */
const HALO_SIZE_FACTOR = 1.4;
/**
 * Continuous breathing, no rest gap: the halo's alpha and the attached
 * object's scale ride one shared 0..1 phase so they always move together.
 */
const HALO_MIN_ALPHA = 0.06;
const HALO_MAX_ALPHA = 0.16;
const TARGET_BREATH_SCALE = 1.06;
const BREATH_HALF_DURATION_MS = 900;

const CHIP_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

export class OnboardingGuide {
  private readonly chipContainer: Phaser.GameObjects.Container;
  private readonly chipText: Phaser.GameObjects.Text;
  private readonly halo: Phaser.GameObjects.Image;
  private readonly swipeGuide: SwipeGuide;
  /** Shared breathing phase (0..1); its tween is never touched on retarget. */
  private readonly breath = { t: 0 };
  /** The object currently scale-breathed, or null. Never tinted. */
  private attached: NonNullable<PulseTarget['object']> | null = null;
  /** The attached object's exact pre-attach scale, restored on detach. */
  private attachedBaseScaleX = 1;
  private attachedBaseScaleY = 1;
  /** Last rendered chip string; setText only on change. */
  private lastChipText = '';

  constructor(scene: Phaser.Scene) {
    this.chipContainer = scene.add.container(CHIP_X, CHIP_Y).setDepth(CHIP_DEPTH).setVisible(false);
    const chipBg = scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      CHIP_WIDTH,
      CHIP_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    this.chipText = scene.add.text(0, 0, '', CHIP_TEXT_STYLE).setOrigin(0.5);
    this.chipContainer.add([chipBg, this.chipText]);

    this.halo = scene.add
      .image(0, 0, ensureGlowTexture(scene))
      .setTint(HALO_TINT)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(HALO_DEPTH)
      .setVisible(false);
    this.swipeGuide = new SwipeGuide(scene);

    // One perpetual breathing loop; hiding the halo (and detaching the
    // object) is enough to "stop" it. Never touched on retarget, so the
    // phase never resets - the breathing never stutters as the highlight
    // walks targets.
    scene.tweens.add({
      targets: this.breath,
      t: 1,
      duration: BREATH_HALF_DURATION_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.applyBreath(),
    });
  }

  /**
   * Re-derive chip, highlight, and swipe guide from state; called on the
   * scene's refresh tick. Once onboarding is completed everything stays
   * hidden forever.
   */
  refresh(state: GameStateData): void {
    const step = state.onboarding.completed
      ? null
      : (ONBOARDING_STEPS[state.onboarding.step] ?? null);
    if (step === null) {
      this.chipContainer.setVisible(false);
      this.swipeGuide.setStep(null, false);
      this.hideHighlight();
      return;
    }

    const text = this.resolveChipText(step, state);
    if (text !== this.lastChipText) {
      this.lastChipText = text;
      this.chipText.setText(text);
      // Long copy shrinks to fit the fixed chip width instead of overflowing.
      this.chipText.setScale(Math.min(1, CHIP_TEXT_MAX_WIDTH / this.chipText.width));
    }
    this.chipContainer.setVisible(true);

    // Drag steps show the ghost swipe instead of the glow highlight; the
    // swipe hides itself per frame while a modal panel is open.
    const isDragStep = step.id === 'plant-rest' || step.id === 'harvest-rest';
    this.swipeGuide.setStep(step.id, isDragStep);
    if (isDragStep) {
      this.hideHighlight();
      return;
    }

    const target = this.resolveTarget(step, state);
    if (target === null) {
      this.hideHighlight();
      return;
    }
    this.halo.setPosition(target.x, target.y);
    this.halo.setDisplaySize(target.width * HALO_SIZE_FACTOR, target.height * HALO_SIZE_FACTOR);
    this.halo.setVisible(true);
    this.attach(target.object ?? null);
  }

  /** Drive the halo's alpha and the attached object's scale from the shared phase. */
  private applyBreath(): void {
    this.halo.setAlpha(HALO_MIN_ALPHA + (HALO_MAX_ALPHA - HALO_MIN_ALPHA) * this.breath.t);
    if (this.attached !== null) {
      const factor = 1 + (TARGET_BREATH_SCALE - 1) * this.breath.t;
      this.attached.setScale(this.attachedBaseScaleX * factor, this.attachedBaseScaleY * factor);
    }
  }

  /**
   * Start scale-breathing a target object, recording its scale first - or
   * stop when `object` is null. Retargeting onto the same object is a no-op,
   * so the breathing phase hands off seamlessly across refresh ticks.
   */
  private attach(object: NonNullable<PulseTarget['object']> | null): void {
    if (object === this.attached) return;
    this.detach();
    if (object === null) return;
    this.attached = object;
    this.attachedBaseScaleX = object.scaleX;
    this.attachedBaseScaleY = object.scaleY;
  }

  /** Restore the attached object's exact recorded scale; idempotent. */
  private detach(): void {
    if (this.attached === null) return;
    this.attached.setScale(this.attachedBaseScaleX, this.attachedBaseScaleY);
    this.attached = null;
  }

  private hideHighlight(): void {
    this.halo.setVisible(false);
    this.detach();
  }

  /**
   * Where the highlight should sit right now. Steps with conditional targets
   * resolve here; everything else uses the step's nominal target (or none).
   * Seed and field providers return null once unavailable (seed selected, or
   * a modal panel open and occluding them), so the plant-shaped steps
   * naturally walk the highlight from the seed bar onto the field. The drag
   * steps never reach here - they show the swipe guide instead. From
   * `deliver-sunwheat` onward the player has already been taught the plot
   * drag, so plots are never glowed again - only seed buttons (or nothing).
   */
  private resolveTarget(step: OnboardingStep, state: GameStateData): PulseTarget | null {
    switch (step.id) {
      case 'plant-first':
        return resolvePulseTarget('seed-sunwheat') ?? resolvePulseTarget('empty-plot');
      case 'deliver-sunwheat':
        // The rails guarantee the 10 harvested sunwheat are still held, so
        // the delivery is always covered: the board's Fulfill button if it
        // is open, else the Orders button to get there.
        return resolvePulseTarget('fulfill-slot-0') ?? resolvePulseTarget('orders-button');
      case 'plant-mixed': {
        // Walk sunwheat first, then starcorn: highlight the needed crop's
        // seed button only, until it is selected - never a plot.
        const needed = state.onboarding.progress < step.goal ? 'seed-sunwheat' : 'seed-starcorn';
        return resolvePulseTarget(needed);
      }
      default:
        // 'ready-plot' resolves to null while everything is still growing -
        // mid-growth plots are never highlighted. Null targets never
        // highlight at all.
        return step.pulseTarget === null ? null : resolvePulseTarget(step.pulseTarget);
    }
  }

  /**
   * The chip string for the current step. harvest-first counts down to the
   * soonest-ready sunwheat while none is ripe; plant-mixed shows both live
   * counters. Everything else is the step's plain instruction (review-order's
   * is derived from the ORDER B config at module init) - including
   * deliver-sunwheat, whose inventory is always covered under the rails.
   */
  private resolveChipText(step: OnboardingStep, state: GameStateData): string {
    switch (step.id) {
      case 'harvest-first': {
        const seconds = secondsUntilNextReady(state.plots, 'sunwheat', now());
        if (seconds !== null && seconds > 0) {
          return `${HARVEST_COUNTDOWN_INSTRUCTION} ${seconds}s`;
        }
        return step.instruction;
      }
      case 'plant-mixed': {
        const { progress, progressB } = state.onboarding;
        return `${step.instruction} - ${progress}/${step.goal}, ${progressB}/${step.goalB ?? 0}`;
      }
      default:
        return step.instruction;
    }
  }
}
