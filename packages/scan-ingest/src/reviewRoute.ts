import {
  DEFAULT_REVIEW_THRESHOLDS,
  type ReviewRoute,
  type ReviewThresholds,
} from "@vip/core-model";

export function thresholdsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReviewThresholds {
  const num = (raw: string | undefined, fallback: number) => {
    if (raw == null || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
  };
  return {
    highMin: num(env.VIP_SCAN_HIGH_MIN, DEFAULT_REVIEW_THRESHOLDS.highMin),
    mediumMin: num(env.VIP_SCAN_MEDIUM_MIN, DEFAULT_REVIEW_THRESHOLDS.mediumMin),
  };
}

/**
 * HIGH / MEDIUM / LOW / CONFLICT. Conflict is never auto-chosen.
 * HIGH still does not invent fields — it only routes.
 */
export function routeReview(input: {
  baseConfidence: number;
  conflict: boolean;
  pairingNeedsReview: boolean;
  thresholds?: ReviewThresholds;
}): ReviewRoute {
  if (input.conflict) return "CONFLICT";
  const t = input.thresholds ?? DEFAULT_REVIEW_THRESHOLDS;
  if (input.pairingNeedsReview) return "LOW";
  if (input.baseConfidence >= t.highMin) return "HIGH";
  if (input.baseConfidence >= t.mediumMin) return "MEDIUM";
  return "LOW";
}
