import { describe, expect, it } from 'vitest';

import { formatGrowMs } from './crops';

describe('formatGrowMs', () => {
  it('formats under a minute as seconds', () => {
    expect(formatGrowMs(30_000)).toBe('30 sec');
  });

  it('formats whole minutes without a seconds component', () => {
    expect(formatGrowMs(120_000)).toBe('2 min');
  });

  it('formats a mixed minutes-and-seconds duration', () => {
    expect(formatGrowMs(150_000)).toBe('2 min 30 sec');
  });
});
