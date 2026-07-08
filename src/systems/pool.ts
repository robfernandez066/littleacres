/**
 * Generic object pool: acquire/release with pre-allocation and grow-on-demand.
 * Pooled objects are never destroyed during play - once created they cycle
 * between the free list and callers forever (standing rule: no allocation in
 * steady-state effect paths after warmup).
 *
 * Placement note: this file is pure logic (no Phaser imports) so it lives in
 * `src/systems/` and is unit-testable; the display-layer effect classes that
 * consume it (FloatingText, CoinArc, ParticleBurst) live in `src/ui/`.
 */

/** Read-only stats snapshot surface, consumed by the dev overlay. */
export interface PoolStatsProvider {
  /** Total objects ever created by the pool (free + in use). */
  readonly size: number;
  /** Objects currently acquired and not yet released. */
  readonly inUse: number;
  /** Most objects simultaneously in use since the pool was created. */
  readonly highWater: number;
}

export class Pool<T> implements PoolStatsProvider {
  private readonly free: T[] = [];
  private created = 0;
  private inUseCount = 0;
  private highWaterMark = 0;

  /**
   * @param create Builds a new pooled object in its idle state (e.g. a hidden
   *   sprite). Called at preallocation and when the pool grows on demand.
   * @param reset Optional hook run when an object is released, returning it
   *   to its idle state (e.g. hide it). Not run on freshly created objects -
   *   the factory is responsible for their initial state.
   */
  constructor(
    private readonly create: () => T,
    private readonly reset?: (item: T) => void,
  ) {}

  get size(): number {
    return this.created;
  }

  get inUse(): number {
    return this.inUseCount;
  }

  get highWater(): number {
    return this.highWaterMark;
  }

  /** Grow the pool until at least `count` objects exist. Never shrinks. */
  preallocate(count: number): void {
    while (this.created < count) {
      this.free.push(this.createNew());
    }
  }

  /** Take an object from the free list, growing the pool if it is empty. */
  acquire(): T {
    const item = this.free.pop() ?? this.createNew();
    this.inUseCount++;
    if (this.inUseCount > this.highWaterMark) this.highWaterMark = this.inUseCount;
    return item;
  }

  /**
   * Return an object to the free list, running `reset` on it. Releasing an
   * object that is already free is ignored (double-release guard; the linear
   * scan is fine at pool sizes of a few dozen).
   */
  release(item: T): void {
    if (this.free.includes(item)) return;
    this.reset?.(item);
    this.free.push(item);
    this.inUseCount = Math.max(0, this.inUseCount - 1);
  }

  private createNew(): T {
    this.created++;
    return this.create();
  }
}

/**
 * Global registry of pool stats for the dev overlay. Registering under an
 * existing name replaces the entry, so a scene restart re-registering its
 * pools never leaks stale providers.
 */
const registry = new Map<string, PoolStatsProvider>();

export function registerPoolStats(name: string, provider: PoolStatsProvider): void {
  registry.set(name, provider);
}

export function getPoolStatsRegistry(): ReadonlyMap<string, PoolStatsProvider> {
  return registry;
}
