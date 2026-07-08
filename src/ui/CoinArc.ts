import Phaser from 'phaser';

import { ATLAS_KEY, HUD_COIN_POSITION } from '../config';
import { Pool, registerPoolStats } from '../systems/pool';

/**
 * Pooled coin-flight effect: coin sprites launch with a small stagger and
 * travel a quadratic curve (random control-point wobble, so no two paths
 * match) to the HUD coin position, shrinking slightly en route.
 *
 * Each flight is a pooled wrapper object holding its sprite plus per-flight
 * curve data; the tween animates the wrapper's `t` from 0 to 1 and shared
 * instance callbacks do the curve math - no per-coin closures.
 *
 * Placement note: effect classes are display-layer objects owned by a scene,
 * so they live in `src/ui/`; pure pool logic lives in `src/systems/pool.ts`.
 */

/**
 * Hard cap on sprites per `fly` call. Selling a 50-crop stack must read as
 * one satisfying batch, not 50 sprites - `onArrive` still fires once per
 * sprite, so callers count arrivals, not crops.
 */
const MAX_COINS_PER_FLY = 8;

const STAGGER_MS = 50;
const FLIGHT_MS = 550;

/** Coin atlas frame is 96x96; start a bit over half size, shrink en route. */
const START_SCALE = 0.6;
const END_SCALE = 0.35;

/** Random spawn scatter so a batch does not launch from a single point. */
const SPAWN_JITTER = 24;
/** Control-point wobble ranges - the "no two arcs alike" variation. */
const WOBBLE_X = 150;
const ARC_LIFT_MIN = 80;
const ARC_LIFT_MAX = 280;

/** Above everything, including the seed bar (2000) - coins fly over the UI. */
const COIN_ARC_DEPTH = 2200;

interface CoinFlight {
  sprite: Phaser.GameObjects.Image;
  /** Tweened 0..1 curve parameter. */
  t: number;
  fromX: number;
  fromY: number;
  ctrlX: number;
  ctrlY: number;
  onArrive: (() => void) | null;
}

export class CoinArc {
  private readonly pool: Pool<CoinFlight>;

  private readonly onFlightStart = (_tween: Phaser.Tweens.Tween, targets: CoinFlight[]): void => {
    const flight = targets[0];
    if (flight === undefined) return;
    flight.sprite.setPosition(flight.fromX, flight.fromY).setScale(START_SCALE).setVisible(true);
  };

  private readonly onFlightUpdate = (_tween: Phaser.Tweens.Tween, flight: CoinFlight): void => {
    const t = flight.t;
    const u = 1 - t;
    // Quadratic bezier: from -> wobbled control point -> HUD coin position.
    const x = u * u * flight.fromX + 2 * u * t * flight.ctrlX + t * t * HUD_COIN_POSITION.x;
    const y = u * u * flight.fromY + 2 * u * t * flight.ctrlY + t * t * HUD_COIN_POSITION.y;
    flight.sprite.setPosition(x, y).setScale(START_SCALE + (END_SCALE - START_SCALE) * t);
  };

  private readonly onFlightComplete = (
    _tween: Phaser.Tweens.Tween,
    targets: CoinFlight[],
  ): void => {
    const flight = targets[0];
    if (flight === undefined) return;
    const onArrive = flight.onArrive;
    this.pool.release(flight);
    onArrive?.();
  };

  constructor(private readonly scene: Phaser.Scene) {
    this.pool = new Pool(
      (): CoinFlight => ({
        sprite: this.scene.add
          .image(0, 0, ATLAS_KEY, 'coin')
          .setDepth(COIN_ARC_DEPTH)
          .setVisible(false),
        t: 0,
        fromX: 0,
        fromY: 0,
        ctrlX: 0,
        ctrlY: 0,
        onArrive: null,
      }),
      (flight) => {
        flight.sprite.setVisible(false);
        flight.onArrive = null;
      },
    );
    this.pool.preallocate(MAX_COINS_PER_FLY);
    registerPoolStats('coin', this.pool);
  }

  /**
   * Fly up to MAX_COINS_PER_FLY coin sprites from (fromX, fromY) to the HUD
   * coin position. `onArrive` fires once per sprite as it lands.
   */
  fly(fromX: number, fromY: number, count: number, onArrive?: () => void): void {
    const coins = Math.min(count, MAX_COINS_PER_FLY);
    for (let i = 0; i < coins; i++) {
      const flight = this.pool.acquire();
      flight.t = 0;
      flight.fromX = fromX + Phaser.Math.Between(-SPAWN_JITTER, SPAWN_JITTER);
      flight.fromY = fromY + Phaser.Math.Between(-SPAWN_JITTER, SPAWN_JITTER);
      flight.ctrlX =
        (flight.fromX + HUD_COIN_POSITION.x) / 2 + Phaser.Math.Between(-WOBBLE_X, WOBBLE_X);
      flight.ctrlY =
        Math.min(flight.fromY, HUD_COIN_POSITION.y) -
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
