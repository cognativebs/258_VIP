const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatUsd(amount: number): string {
  return usd.format(amount);
}

export function formatUsdRange(low: number, high: number): string {
  return `${formatUsd(low)} – ${formatUsd(high)}`;
}

/** Share of the high bound consumed by the spread. Wider ranges score higher. */
export function rangeSpreadRatio(low: number, high: number): number {
  if (high <= 0 || high < low) return 0;
  return (high - low) / high;
}

export function confidenceLabel(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}
