import { describe, expect, it } from 'vitest';

import { getPoolStatsRegistry, Pool, registerPoolStats } from './pool';

interface Item {
  id: number;
  reset: number;
}

function makePool(): { pool: Pool<Item>; created: Item[] } {
  const created: Item[] = [];
  const pool = new Pool<Item>(
    () => {
      const item = { id: created.length, reset: 0 };
      created.push(item);
      return item;
    },
    (item) => {
      item.reset++;
    },
  );
  return { pool, created };
}

describe('Pool', () => {
  it('starts empty with zeroed stats', () => {
    const { pool } = makePool();
    expect(pool.size).toBe(0);
    expect(pool.inUse).toBe(0);
    expect(pool.highWater).toBe(0);
  });

  it('preallocate creates exactly N idle objects', () => {
    const { pool, created } = makePool();
    pool.preallocate(5);
    expect(created).toHaveLength(5);
    expect(pool.size).toBe(5);
    expect(pool.inUse).toBe(0);
    expect(pool.highWater).toBe(0);
  });

  it('preallocate never shrinks and never re-creates existing objects', () => {
    const { pool, created } = makePool();
    pool.preallocate(4);
    pool.preallocate(2);
    expect(created).toHaveLength(4);
    pool.preallocate(6);
    expect(created).toHaveLength(6);
    expect(pool.size).toBe(6);
  });

  it('acquire serves preallocated objects without creating new ones', () => {
    const { pool, created } = makePool();
    pool.preallocate(2);
    const a = pool.acquire();
    const b = pool.acquire();
    expect(created).toHaveLength(2);
    expect(a).not.toBe(b);
    expect(pool.inUse).toBe(2);
  });

  it('grows on demand when the free list is empty', () => {
    const { pool, created } = makePool();
    pool.preallocate(1);
    pool.acquire();
    pool.acquire();
    expect(created).toHaveLength(2);
    expect(pool.size).toBe(2);
    expect(pool.inUse).toBe(2);
  });

  it('release returns the same object for reuse and runs the reset hook', () => {
    const { pool, created } = makePool();
    const item = pool.acquire();
    pool.release(item);
    expect(item.reset).toBe(1);
    expect(pool.inUse).toBe(0);
    expect(pool.acquire()).toBe(item);
    expect(created).toHaveLength(1);
  });

  it('a warmed-up pool never grows under repeated acquire/release cycles', () => {
    const { pool, created } = makePool();
    pool.preallocate(3);
    for (let cycle = 0; cycle < 10; cycle++) {
      const items = [pool.acquire(), pool.acquire(), pool.acquire()];
      for (const item of items) pool.release(item);
    }
    expect(created).toHaveLength(3);
    expect(pool.size).toBe(3);
    expect(pool.highWater).toBe(3);
  });

  it('tracks the high-water mark across acquire/release churn', () => {
    const { pool } = makePool();
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    expect(pool.highWater).toBe(3);
    pool.release(a);
    pool.release(b);
    pool.release(c);
    expect(pool.highWater).toBe(3);
    pool.acquire();
    expect(pool.inUse).toBe(1);
    expect(pool.highWater).toBe(3);
  });

  it('ignores a double release', () => {
    const { pool } = makePool();
    const item = pool.acquire();
    pool.release(item);
    pool.release(item);
    expect(item.reset).toBe(1);
    expect(pool.inUse).toBe(0);
    const first = pool.acquire();
    const second = pool.acquire();
    expect(first).not.toBe(second);
    expect(pool.size).toBe(2);
  });
});

describe('pool stats registry', () => {
  it('exposes registered pools and replaces entries by name', () => {
    const { pool } = makePool();
    registerPoolStats('test-pool', pool);
    expect(getPoolStatsRegistry().get('test-pool')).toBe(pool);

    const { pool: replacement } = makePool();
    registerPoolStats('test-pool', replacement);
    expect(getPoolStatsRegistry().get('test-pool')).toBe(replacement);
  });
});
