import { describe, expect, it } from 'vitest';

import { formatAwayDuration, formatCurrency, ownedBadgeLabel } from './format';

describe('formatCurrency', () => {
  it('renders plain below 1000', () => {
    expect(formatCurrency(500)).toBe('500');
    expect(formatCurrency(0)).toBe('0');
  });

  it('comma-groups thousands', () => {
    expect(formatCurrency(1234)).toBe('1,234');
    expect(formatCurrency(99_999)).toBe('99,999');
  });

  it('abbreviates the K tier', () => {
    expect(formatCurrency(123_456)).toBe('123K');
  });

  it('abbreviates the M tier, trimming an exact decimal', () => {
    expect(formatCurrency(1_500_000)).toBe('1.5M');
    expect(formatCurrency(12_000_000)).toBe('12M');
  });

  it('abbreviates the B tier', () => {
    expect(formatCurrency(2_500_000_000)).toBe('2.5B');
  });

  it('holds the exact boundary values', () => {
    expect(formatCurrency(999)).toBe('999');
    expect(formatCurrency(1000)).toBe('1,000');
    expect(formatCurrency(99_999)).toBe('99,999');
    expect(formatCurrency(100_000)).toBe('100K');
    expect(formatCurrency(999_999)).toBe('999K');
    expect(formatCurrency(1_000_000)).toBe('1M');
  });
});

describe('ownedBadgeLabel', () => {
  it('reads owned-of-max for a unique item (allowMultiple false)', () => {
    expect(ownedBadgeLabel(1, false)).toBe('1/1');
  });

  it('reads "xN" for a stackable item (allowMultiple true)', () => {
    expect(ownedBadgeLabel(1, true)).toBe('x1');
    expect(ownedBadgeLabel(9, true)).toBe('x9');
  });
});

describe('formatAwayDuration', () => {
  it('renders minutes only under an hour', () => {
    expect(formatAwayDuration(0)).toBe('0 min');
    expect(formatAwayDuration(5 * 60_000)).toBe('5 min');
    expect(formatAwayDuration(59 * 60_000)).toBe('59 min');
  });

  it('renders hours and minutes under a day', () => {
    expect(formatAwayDuration(90 * 60_000)).toBe('1 Hr 30 min');
    expect(formatAwayDuration((23 * 60 + 59) * 60_000)).toBe('23 Hr 59 min');
  });

  it('renders days and hours at and beyond 24 hours', () => {
    expect(formatAwayDuration(25 * 60 * 60_000)).toBe('1 Day 1 Hr');
    expect(formatAwayDuration(3 * 24 * 60 * 60_000)).toBe('3 Day 0 Hr');
  });

  it('holds the exact boundary values', () => {
    expect(formatAwayDuration(59 * 60_000 + 59_999)).toBe('59 min');
    expect(formatAwayDuration(60 * 60_000)).toBe('1 Hr 0 min');
    expect(formatAwayDuration(24 * 60 * 60_000 - 1)).toBe('23 Hr 59 min');
    expect(formatAwayDuration(24 * 60 * 60_000)).toBe('1 Day 0 Hr');
  });
});
