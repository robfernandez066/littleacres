import Phaser from 'phaser';

import { registerPoolStats, type PoolStatsProvider } from '../systems/pool';

/**
 * One-shot particle bursts: `leaf` on harvest (green/gold flecks arcing out
 * under gravity) and `sparkle` on plant (quick bright radial puff).
 *
 * Phaser particle emitters are inherently pooled (dead particles are reused),
 * so this class pre-creates ONE emitter per preset at scene create and reuses
 * it via `explode(count, x, y)` - never an emitter per burst.
 *
 * Placement note: effect classes are display-layer objects owned by a scene,
 * so they live in `src/ui/`; pure pool logic lives in `src/systems/pool.ts`.
 */

export type BurstPreset = 'leaf' | 'sparkle';

/**
 * Runtime-generated soft white dot, tinted per preset. There are no particle
 * frames in the atlas yet; real art replaces this in a later pass.
 */
const PARTICLE_TEXTURE_KEY = 'fx-particle';
const PARTICLE_SIZE = 16;

/** Above the field and crop sprites, below floating text (1900) and the bar (2000). */
const PARTICLE_DEPTH = 1850;

const LEAF_COUNT = 7;
const SPARKLE_COUNT = 10;

/** Tracks a Phaser emitter's internal particle pool for the dev overlay. */
class EmitterStats implements PoolStatsProvider {
  private highWaterMark = 0;

  constructor(private readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter) {}

  get size(): number {
    return this.emitter.getParticleCount();
  }

  get inUse(): number {
    return this.emitter.getAliveParticleCount();
  }

  get highWater(): number {
    return this.highWaterMark;
  }

  /** Call right after an explode, when the alive count has just peaked. */
  bump(): void {
    const alive = this.emitter.getAliveParticleCount();
    if (alive > this.highWaterMark) this.highWaterMark = alive;
  }
}

export class ParticleBurst {
  private readonly leaf: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparkle: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly leafStats: EmitterStats;
  private readonly sparkleStats: EmitterStats;

  constructor(scene: Phaser.Scene) {
    ensureParticleTexture(scene);

    this.leaf = scene.add
      .particles(0, 0, PARTICLE_TEXTURE_KEY, {
        speed: { min: 120, max: 260 },
        angle: { min: 220, max: 320 },
        gravityY: 600,
        lifespan: { min: 500, max: 750 },
        scale: { start: 1.1, end: 0.2 },
        alpha: { start: 1, end: 0 },
        tint: [0x5da838, 0x8bc34a, 0xd9a834],
        emitting: false,
      })
      .setDepth(PARTICLE_DEPTH);

    this.sparkle = scene.add
      .particles(0, 0, PARTICLE_TEXTURE_KEY, {
        speed: { min: 180, max: 340 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 250, max: 420 },
        scale: { start: 0.9, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xffffff, 0xfff59d, 0xaef3ff],
        emitting: false,
      })
      .setDepth(PARTICLE_DEPTH);

    this.leafStats = new EmitterStats(this.leaf);
    this.sparkleStats = new EmitterStats(this.sparkle);
    registerPoolStats('leaf', this.leafStats);
    registerPoolStats('sparkle', this.sparkleStats);
  }

  burst(preset: BurstPreset, x: number, y: number): void {
    if (preset === 'leaf') {
      this.leaf.explode(LEAF_COUNT, x, y);
      this.leafStats.bump();
    } else {
      this.sparkle.explode(SPARKLE_COUNT, x, y);
      this.sparkleStats.bump();
    }
  }
}

/** Generate the shared particle texture once per game (idempotent). */
function ensureParticleTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(PARTICLE_TEXTURE_KEY)) return;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(PARTICLE_SIZE / 2, PARTICLE_SIZE / 2, PARTICLE_SIZE / 2);
  graphics.generateTexture(PARTICLE_TEXTURE_KEY, PARTICLE_SIZE, PARTICLE_SIZE);
  graphics.destroy();
}
