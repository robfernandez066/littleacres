/**
 * Compact currency display: plain below 1,000; comma-grouped from 1,000 up
 * to 100,000 (e.g. "99,999"); K/M/B abbreviated at and above 100,000 (e.g.
 * "150K", "1.2M", "3.4B") - keeps the currency row's text short and stable
 * regardless of how large coins/moondust grow, so it can't grow into the
 * crest's overhang no matter how long a save has been played. Manual
 * grouping (not `toLocaleString`) for deterministic, locale-independent
 * output.
 */
export function formatCurrency(value: number): string {
  const n = Math.floor(value);
  if (n < 1000) return String(n);
  if (n < 100_000) return groupThousands(n);
  if (n < 1_000_000) return `${Math.floor(n / 1_000)}K`;
  if (n < 1_000_000_000) return `${trimmedDecimal(n / 1_000_000)}M`;
  return `${trimmedDecimal(n / 1_000_000_000)}B`;
}

function groupThousands(n: number): string {
  const digits = String(n);
  let result = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) result += ',';
    result += digits[i];
  }
  return result;
}

/** One decimal place, trimmed to a whole number when it's exact (e.g. "2" not "2.0"). */
function trimmedDecimal(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Owned-count badge label (U3b-r3): a UNIQUE item (`allowMultiple` false - a
 * building today) reads owned-of-max, "1/1", since one is the whole allowance;
 * a stackable (decor, paths, plots) reads "xN". Derived from `allowMultiple`,
 * never from category, so a future unique decoration behaves the same.
 */
export function ownedBadgeLabel(count: number, allowMultiple: boolean): string {
  return allowMultiple ? `x${count}` : `${count}/1`;
}

/** Friendly away duration: largest two units, minutes floored (never rounded up). */
export function formatAwayDuration(elapsedMs: number): string {
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours} Hr ${totalMinutes % 60} min`;
  const days = Math.floor(totalHours / 24);
  return `${days} Day ${totalHours % 24} Hr`;
}
