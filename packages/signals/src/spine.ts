/**
 * Pure spine helpers. Half-lives are arguments, never switches on signal type.
 * No network. No vault_market.
 */

import {
  WeightedProductExponentsSchema,
  type WeightedProductExponents,
} from "./schemas/spine.js";

const TRACKING_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "utm_reader",
  "utm_viz_id",
  "utm_pubreferrer",
  "mc_cid",
  "mc_eid",
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "igshid",
  "igsh",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "ml_subscriber",
  "ml_subscriber_hash",
  "email",
  "recipient",
  "subscriber",
  "subscriber_id",
  "subscriberid",
  "e",
  "uid",
  "user_id",
  "user",
  "ref",
  "source_email",
]);

const RECIPIENT_QUERY_PARAMS = new Set([
  "email",
  "recipient",
  "subscriber",
  "subscriber_id",
  "subscriberid",
  "e",
  "uid",
  "user_id",
  "user",
  "source_email",
  "ml_subscriber",
  "ml_subscriber_hash",
]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export type SignalUrlMode = "canonical" | "redact";

/** Mirrors vault_signals.normalize_signal_url. */
export function normalizeSignalUrl(input: string | null, mode: SignalUrlMode): string | null {
  if (input == null || input.trim() === "") return null;
  let v = input.trim().replace(/#.*$/, "");
  v = v.replace(/^(https?:\/\/)[^/@\s]+@/i, "$1");
  const qIndex = v.indexOf("?");
  const base = qIndex === -1 ? v : v.slice(0, qIndex);
  const query = qIndex === -1 ? null : v.slice(qIndex + 1);
  const kept: string[] = [];
  if (query) {
    for (const pair of query.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const val = eq === -1 ? "" : pair.slice(eq + 1);
      const lower = key.toLowerCase();
      if (mode === "canonical" && TRACKING_QUERY_PARAMS.has(lower)) continue;
      if (mode === "redact" && RECIPIENT_QUERY_PARAMS.has(lower)) continue;
      if (EMAIL_RE.test(val)) continue;
      kept.push(`${key}=${val}`);
    }
  }
  kept.sort();
  const out = kept.length > 0 ? `${base}?${kept.join("&")}` : base;
  if (EMAIL_RE.test(out)) {
    throw new Error("recipient email must not be stored in a signals URL");
  }
  return out;
}

export function independentSourceCount(
  rows: ReadonlyArray<{ role: string; independenceGroup: string | null }>,
): number {
  const groups = new Set<string>();
  for (const row of rows) {
    if (row.role === "PRIMARY" && row.independenceGroup) {
      groups.add(row.independenceGroup);
    }
  }
  return groups.size;
}

/**
 * Read-time decay. halfLifeHours comes from the caller (the data table),
 * not from a branch on signal type.
 */
export function signalInfluence(
  priorityScore: number,
  hoursElapsed: number,
  halfLifeHours: number,
): number {
  if (halfLifeHours <= 0) {
    throw new Error("half life must come from the data table and be positive");
  }
  const elapsed = Math.max(0, hoursElapsed);
  return priorityScore * 0.5 ** (elapsed / halfLifeHours);
}

/**
 * Mirrors vault_signals.signal_priority (weighted_product_v1). Exponents come
 * from the current score_weight_set row, never from a constant here.
 */
export function priorityFromScores(
  baseConfidence: number,
  baseImpact: number,
  noiseProbability: number,
  exponents: WeightedProductExponents,
): number {
  const { base_confidence: a, base_impact: b, one_minus_noise: c } =
    WeightedProductExponentsSchema.parse(exponents);
  return round6(baseConfidence ** a * baseImpact ** b * (1 - noiseProbability) ** c);
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export class ValuationFirewallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValuationFirewallError";
  }
}

/**
 * News-derived rows may not enter a valuation path unless the source ceiling
 * is true. Seeded sources are false, so this fails for them.
 */
export function assertMayEnterValuation(mayRaiseValuationCeiling: boolean): void {
  if (mayRaiseValuationCeiling !== true) {
    throw new ValuationFirewallError(
      "valuation firewall: a news-derived signal cannot enter a valuation path (may_raise_valuation_ceiling is not true)",
    );
  }
}
