import Phaser from 'phaser';

/**
 * Runtime-generated soft radial glow texture: a white core fading to a
 * transparent edge, built once per game from stacked concentric circles
 * (Phaser graphics has no gradient fill). Tinted and blended by its users -
 * the onboarding halo and the ghost-swipe dots. Placeholder until the real
 * art pass.
 */

export const GLOW_TEXTURE_KEY = 'onboarding-glow';

const GLOW_RADIUS = 128;
const GLOW_STEPS = 30;
/** Per-circle alpha; 30 stacked fills reach ~0.79 at the core, ~0.05 at the rim. */
const GLOW_STEP_ALPHA = 0.05;

/** Generate the glow texture if it does not exist yet; returns its key. */
export function ensureGlowTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(GLOW_TEXTURE_KEY)) return GLOW_TEXTURE_KEY;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let i = 0; i < GLOW_STEPS; i++) {
    graphics.fillStyle(0xffffff, GLOW_STEP_ALPHA);
    graphics.fillCircle(GLOW_RADIUS, GLOW_RADIUS, GLOW_RADIUS * (1 - i / GLOW_STEPS));
  }
  graphics.generateTexture(GLOW_TEXTURE_KEY, GLOW_RADIUS * 2, GLOW_RADIUS * 2);
  graphics.destroy();
  return GLOW_TEXTURE_KEY;
}
