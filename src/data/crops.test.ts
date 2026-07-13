import { describe, expect, it } from 'vitest';

import { CROP_STAGES, CROPS, formatGrowMs } from './crops';
import { MAX_LEVEL } from './levels';

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

describe('CROPS sanity (T3.11)', () => {
  it('defines 7 crops, each keyed by its own id', () => {
    expect(Object.keys(CROPS)).toHaveLength(7);
    for (const [key, crop] of Object.entries(CROPS)) {
      expect(crop.id).toBe(key);
    }
  });

  it('stage frames follow the <id>_<stage> atlas naming convention', () => {
    for (const crop of Object.values(CROPS)) {
      expect(crop.stageFrames).toHaveLength(CROP_STAGES);
      crop.stageFrames.forEach((frame, stage) => {
        expect(frame).toBe(`${crop.id}_${stage}`);
      });
    }
  });

  it('every unlock level is within 1..MAX_LEVEL', () => {
    for (const crop of Object.values(CROPS)) {
      expect(crop.unlockLevel).toBeGreaterThanOrEqual(1);
      expect(crop.unlockLevel).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });
});
