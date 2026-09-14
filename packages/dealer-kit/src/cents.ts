/** PriceCharting encodes money as integer pennies. Null/0 stay null — never invent $0. */
export function centsToDollars(cents: unknown): number | null {
  if (cents == null) return null;
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) return null;
  return Math.round(cents) / 100;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}
