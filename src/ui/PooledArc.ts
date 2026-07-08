import Phaser from 'phaser';

import { ATLAS_KEY } from '../config';
import { Pool, type PoolStatsProvider } from '../systems/pool';

/**
 * Pooled sprite-flight effect: sprites launch with a small stagger and
 * travel a quadratic curve (random control-point wobble, so no two paths
 * match) to a fixed target, shrinking slightly en route.
 *
 * Shared flight/pool mechanics behind `CoinArc` (coins flying to the HUD
 * counter) and `CropArc` (harvested crops flying to the bag) - the two
 * differ only in target, frame, scale, and depth, which are constructor
 * options here.
 *
 * Placement note: effect classes are display-layer objects owned by a scene,
 * so they live in `src/ui/`; pure pool logic lives in `src/systems/pool.ts`.
 */

const STAGGER_MS = 50;
const FLIGHT_MS = 550;

/** Random spawn scatter so a batch does not launch from a single point. */
const SPAWN_JITTER = 24;
/** Control-point wobble ranges - the "no two arcs alike" variation. */
const WOBBLE_X = 150;
const ARC_LIFT_MIN = 80;
const ARC_LIFT_MAX = 280;

export interface PooledArcOptions {
  targetX: number;
  targetY: number;
  /** Above the UI it flies over; each caller picks its own layer. */
  depth: number;
  startScale: number;
  endScale: number;
  /** Hard cap on sprites per `fly` call. */
  maxPerFly: number;
  /** Atlas frame used when a `fly` call does not override it. */
  defaultFrame: string;
  /** Sprites created up front so steady-state flights never allocate. */
  preallocate: number;
}

interface Flight {
  sprite: Phaser.GameObjects.Image;
  /** Tweened 0..1 curve parameter. */
  t: number;
  fromX: number;
  fromY: number;
  ctrlX: number;
  ctrlY: number;
  startScale: number;
  endScale: number;
  onArrive: (() => void) | null;
}

export class PooledArc implements PoolStatsProvider {
  private readonly pool: Pool<Flight>;

  private readonly onFlightStart = (_tween: Phaser.Tweens.Tween, targets: Flight[]): void => {
    const flight = targets[0];
    if (flight === undefined) return;
    flight.sprite
      .setPosition(flight.fromX, flight.fromY)
      .setScale(flight.startScale)
      .setVisible(true);
  };

  private readonly onFlightUpdate = (_tween: Phaser.Tweens.Tween, flight: Flight): void => {
    const t = flight.t;
    const u = 1 - t;
    // Quadratic bezier: from -> wobbled control point -> the fixed target.
    const x = u * u * flight.fromX + 2 * u * t * flight.ctrlX + t * t * this.options.targetX;
    const y = u * u * flight.fromY + 2 * u * t * flight.ctrlY + t * t * this.options.targetY;
    flight.sprite
      .setPosition(x, y)
      .setScale(flight.startScale + (flight.endScale - flight.startScale) * t);
  };

  private readonly onFlightComplete = (_tween: Phaser.Tweens.Tween, targets: Flight[]): void => {
    const flight = targets[0];
    if (flight === undefined) return;
    const onArrive = flight.onArrive;
    this.pool.release(flight);
    onArrive?.();
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: PooledArcOptions,
  ) {
    this.pool = new Pool(
      (): Flight => ({
        sprite: this.scene.add
          .image(0, 0, ATLAS_KEY, options.defaultFrame)
          .setDepth(options.depth)
          .setVisible(false),
        t: 0,
        fromX: 0,
        fromY: 0,
        ctrlX: 0,
        ctrlY: 0,
        startScale: options.startScale,
        endScale: options.endScale,
        onArrive: null,
      }),
      (flight) => {
        flight.sprite.setVisible(false);
        flight.onArrive = null;
      },
    );
    this.pool.preallocate(options.preallocate);
  }

  get size(): number {
    return this.pool.size;
  }

  get inUse(): number {
    return this.pool.inUse;
  }

  get highWater(): number {
    return this.pool.highWater;
  }

  /**
   * Fly up to `maxPerFly` sprites from (fromX, fromY) to the fixed target.
   * `onArrive` fires once per sprite as it lands. `frame` overrides the
   * default atlas frame for this call (e.g. a specific crop's mature stage).
   */
  fly(fromX: number, fromY: number, count: number, onArrive?: () => void, frame?: string): void {
    const sprites = Math.min(count, this.options.maxPerFly);
    for (let i = 0; i < sprites; i++) {
      const flight = this.pool.acquire();
      flight.sprite.setFrame(frame ?? this.options.defaultFrame);
      flight.t = 0;
      flight.startScale = this.options.startScale;
      flight.endScale = this.options.endScale;
      flight.fromX = fromX + Phaser.Math.Between(-SPAWN_JITTER, SPAWN_JITTER);
      flight.fromY = fromY + Phaser.Math.Between(-SPAWN_JITTER, SPAWN_JITTER);
      flight.ctrlX =
        (flight.fromX + this.options.targetX) / 2 + Phaser.Math.Between(-WOBBLE_X, WOBBLE_X);
      flight.ctrlY =
        Math.min(flight.fromY, this.options.targetY) -
        Phaser.Math.Between(ARC_LIFT_MIN, ARC_LIFT_MAX);
      flight.onArrive = onArrive ?? null;
      this.scene.tweens.add({
        targets: flight,
        t: 1,
        delay: i * STAGGER_MS,
        duration: FLIGHT_MS,
        ease: 'Sine.easeIn',
        onStart: this.onFlightStart,
        onUpdate: this.onFlightUpdate,
        onComplete: this.onFlightComplete,
      });
    }
  }
}
