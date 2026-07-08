import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH } from '../config';
import {
  ONBOARDING_DELIVERY_ORDER,
  ONBOARDING_STEPS,
  type OnboardingStep,
} from '../data/onboarding';
import type { GameStateData } from '../systems/gameState';
import { resolvePulseTarget, type PulseTarget } from '../systems/pulseTargets';

/**
 * Onboarding overlay: a small instruction chip below the xp bar and a soft
 * pulsing ring over the current step's target. No modal, no text wall - the
 * chip and ring never intercept input (nothing here is interactive), and the
 * ring sits below the level-up celebration overlay so it dims with the rest
 * of the scene.
 *
 * Rendered purely from the `GameStateData` passed to `refresh` plus the
 * pulse-target registry; hidden forever once onboarding completes. Per-tick
 * work is allocation-free: the chip, ring, and pulse tween are created once
 * and only retargeted.
 */

const CHIP_X = DESIGN_WIDTH / 2;
const CHIP_Y = 320;
/** Narrow enough to clear the Orders button (left edge x 840) at the same height. */
const CHIP_WIDTH = 580;
const CHIP_HEIGHT = 84;
/** Above the seed bar (2000), below the panels (2100). */
const CHIP_DEPTH = 2050;

/** Above the panels (2100), below arcs (2200) and the celebration (2300). */
const RING_DEPTH = 2150;
const RING_COLOR = 0xffe27a;
const RING_STROKE_WIDTH = 8;
/** One soft pulse: grow-and-fade, then rest - a full cycle every ~2s. */
const PULSE_GROW_SCALE = 1.35;
const PULSE_GROW_MS = 1100;
const PULSE_REST_MS = 900;

const CHIP_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

export class OnboardingGuide {
  private readonly chipContainer: Phaser.GameObjects.Container;
  private readonly chipText: Phaser.GameObjects.Text;
  private readonly ring: Phaser.GameObjects.Arc;
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
      24,
      24,
      24,
      24,
    );
    this.chipText = scene.add.text(0, 0, '', CHIP_TEXT_STYLE).setOrigin(0.5);
    this.chipContainer.add([chipBg, this.chipText]);

    this.ring = scene.add
      .circle(0, 0, 100)
      .setStrokeStyle(RING_STROKE_WIDTH, RING_COLOR)
      .setDepth(RING_DEPTH)
      .setVisible(false);
    // One perpetual pulse loop; hiding the ring is enough to "stop" it.
    scene.tweens.add({
      targets: this.ring,
      scale: { from: 1, to: PULSE_GROW_SCALE },
      alpha: { from: 0.9, to: 0 },
      duration: PULSE_GROW_MS,
      repeat: -1,
      repeatDelay: PULSE_REST_MS,
      ease: 'Sine.easeOut',
    });
  }

  /**
   * Re-derive chip and ring from state; called on the scene's refresh tick.
   * Once onboarding is completed both stay hidden forever.
   */
  refresh(state: GameStateData): void {
    const step = state.onboarding.completed
      ? null
      : (ONBOARDING_STEPS[state.onboarding.step] ?? null);
    if (step === null) {
      this.chipContainer.setVisible(false);
      this.ring.setVisible(false);
      return;
    }

    const text =
      step.goal > 1
        ? `${step.instruction} - ${state.onboarding.progress}/${step.goal}`
        : step.instruction;
    if (text !== this.lastChipText) {
      this.lastChipText = text;
      this.chipText.setText(text);
    }
    this.chipContainer.setVisible(true);

    const target = this.resolveTarget(step, state);
    if (target === null) {
      this.ring.setVisible(false);
      return;
    }
    this.ring.setPosition(target.x, target.y);
    if (this.ring.radius !== target.radius) this.ring.setRadius(target.radius);
    this.ring.setVisible(true);
  }

  /**
   * Where the pulse should sit right now. Steps with conditional targets
   * resolve here; everything else uses the step's nominal target. Seed
   * providers return null once their seed is selected, so the plant-shaped
   * steps naturally walk the pulse from the seed bar onto the field.
   */
  private resolveTarget(step: OnboardingStep, state: GameStateData): PulseTarget | null {
    switch (step.id) {
      case 'plant-sunwheat':
        return resolvePulseTarget('seed-sunwheat') ?? resolvePulseTarget('empty-plot');
      case 'plant-carrot':
        return resolvePulseTarget('seed-carrot') ?? resolvePulseTarget('empty-plot');
      case 'deliver-sunwheat': {
        const covered = ONBOARDING_DELIVERY_ORDER.items.every(
          (item) => (state.inventory[item.cropId] ?? 0) >= item.count,
        );
        if (!covered) {
          // Not enough yet: walk the plant-harvest loop again - harvest
          // anything ready first, otherwise select the seed / plant a plot.
          return (
            resolvePulseTarget('ready-plot') ??
            resolvePulseTarget('seed-sunwheat') ??
            resolvePulseTarget('empty-plot')
          );
        }
        // Enough sunwheat: the board's Fulfill button if it is open, else the
        // Orders button to get there.
        return resolvePulseTarget('fulfill-slot-0') ?? resolvePulseTarget('orders-button');
      }
      default:
        // 'ready-plot' resolves to null while everything is still growing -
        // mid-growth plots are never pulsed.
        return resolvePulseTarget(step.pulseTarget);
    }
  }
}
