import type Phaser from 'phaser';

import type { PulseTargetId } from '../data/onboarding';

/**
 * Registry of pulse-highlight targets: each UI owner (SeedBar, Hud,
 * OrderBoard, FarmScene) registers a provider for the screen spots it owns,
 * and `OnboardingGuide` resolves the active step's target through it every
 * refresh tick. Providers return null when their target is currently
 * unavailable (no empty plot, board closed, seed already selected), letting
 * the guide fall back or hide the pulse.
 *
 * Placement note: pure logic with no runtime Phaser dependency (the Phaser
 * import is type-only), so it lives in `src/systems/` like the pool-stats
 * registry. Registering under an existing id replaces the entry, so a scene
 * restart never leaks stale providers.
 */

export interface PulseTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Present only when the provider judges this object safe for the guide to
   * scale-breathe (no owner-managed scale state that would fight it) - the
   * provider owns that judgment. The guide records the scale on attach and
   * restores it exactly on detach; it never tints the object.
   */
  object?: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject;
}

export type PulseTargetProvider = () => PulseTarget | null;

const registry = new Map<PulseTargetId, PulseTargetProvider>();

export function registerPulseTarget(id: PulseTargetId, provider: PulseTargetProvider): void {
  registry.set(id, provider);
}

/** The target's current position and bounds, or null if unregistered or unavailable. */
export function resolvePulseTarget(id: PulseTargetId): PulseTarget | null {
  return registry.get(id)?.() ?? null;
}
