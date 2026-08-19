export function round2(n: number): number {
  return Number(n.toFixed(2));
}

export function round3(n: number): number {
  return Number(n.toFixed(3));
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function hoursBetween(later: Date, earlier: Date): number {
  return round2((later.getTime() - earlier.getTime()) / 3_600_000);
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}
