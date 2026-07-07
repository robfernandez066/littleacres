import { describe, expect, it } from 'vitest';

import { advanceTime, getTimeOffsetMs, now } from './time';

describe('game clock', () => {
  it('now() advances by the offset applied via advanceTime', () => {
    const offsetBefore = getTimeOffsetMs();
    const before = now();
    advanceTime(5_000);
    expect(getTimeOffsetMs()).toBe(offsetBefore + 5_000);
    expect(now() - before).toBeGreaterThanOrEqual(5_000);
  });

  it('accumulates across multiple calls', () => {
    const offsetBefore = getTimeOffsetMs();
    advanceTime(60_000);
    advanceTime(600_000);
    advanceTime(3_600_000);
    expect(getTimeOffsetMs()).toBe(offsetBefore + 60_000 + 600_000 + 3_600_000);
  });

  it('supports negative offsets (rewind)', () => {
    const offsetBefore = getTimeOffsetMs();
    advanceTime(-1_000);
    expect(getTimeOffsetMs()).toBe(offsetBefore - 1_000);
  });
});
