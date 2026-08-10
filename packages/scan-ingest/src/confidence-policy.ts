import type { DuplicateAlert, IdentityCandidate } from "./schemas.js";

/**
 * Whether a scanned unit may skip human review (ADR 0009).
 *
 * Confidence alone is not evidence of correctness: a small catalog happily
 * returns a high score for the only row that shares a few tokens. So auto
 * resolution also requires a clear margin over the runner-up and a match reason
 * strong enough to be an identity, not a text overlap.
 */

export const CONFIDENCE_POLICY_VERSION = "scan-confidence-policy@0.1.0";

export type ConfidenceBand = "auto" | "review" | "weak" | "none";

export type ConfidencePolicy = {
  /** Auto resolution is opt-in; review is the default for everything. */
  autoResolveEnabled: boolean;
  /** Minimum confidence for the top candidate to auto resolve. */
  autoResolveMin: number;
  /** Top candidate must beat the runner-up by at least this much. */
  autoResolveMargin: number;
  /** Below this, a candidate is too weak to preselect in the UI. */
  weakBelow: number;
  /**
   * Match reasons that identify a card rather than merely overlapping text.
   * An external id or collector number is identity-grade; token overlap is not.
   */
  identityGradeReasonPrefixes: string[];
};

export const DEFAULT_CONFIDENCE_POLICY: ConfidencePolicy = {
  autoResolveEnabled: false,
  autoResolveMin: 0.9,
  autoResolveMargin: 0.15,
  weakBelow: 0.45,
  identityGradeReasonPrefixes: ["external_id:", "collector_number:"],
};

export function policyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ConfidencePolicy {
  const num = (raw: string | undefined, fallback: number): number => {
    if (raw == null || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
  };
  return {
    ...DEFAULT_CONFIDENCE_POLICY,
    autoResolveEnabled: env.VIP_SCAN_AUTO_RESOLVE === "1",
    autoResolveMin: num(
      env.VIP_SCAN_AUTO_RESOLVE_MIN,
      DEFAULT_CONFIDENCE_POLICY.autoResolveMin,
    ),
    autoResolveMargin: num(
      env.VIP_SCAN_AUTO_RESOLVE_MARGIN,
      DEFAULT_CONFIDENCE_POLICY.autoResolveMargin,
    ),
  };
}

export type ConfidenceAssessment = {
  band: ConfidenceBand;
  /** True only when every auto-resolve condition holds. */
  autoResolve: boolean;
  topConfidence: number;
  /** Gap to the runner-up; equals topConfidence when there is only one. */
  margin: number;
  hasIdentityGradeReason: boolean;
  /** Human-readable reasons the unit was not auto resolved. */
  blockers: string[];
  policyVersion: string;
};

function hasIdentityGradeReason(
  candidate: IdentityCandidate,
  policy: ConfidencePolicy,
): boolean {
  return candidate.matchReasons.some((reason) =>
    policy.identityGradeReasonPrefixes.some((prefix) => reason.startsWith(prefix)),
  );
}

export function assessCandidates(
  candidates: IdentityCandidate[],
  opts: {
    policy?: ConfidencePolicy;
    duplicateAlert?: DuplicateAlert | null;
  } = {},
): ConfidenceAssessment {
  const policy = opts.policy ?? DEFAULT_CONFIDENCE_POLICY;
  const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const top = ranked[0];

  if (!top) {
    return {
      band: "none",
      autoResolve: false,
      topConfidence: 0,
      margin: 0,
      hasIdentityGradeReason: false,
      blockers: ["no_candidates"],
      policyVersion: CONFIDENCE_POLICY_VERSION,
    };
  }

  const runnerUp = ranked[1];
  const margin = Number((top.confidence - (runnerUp?.confidence ?? 0)).toFixed(3));
  const identityGrade = hasIdentityGradeReason(top, policy);

  const blockers: string[] = [];
  if (!policy.autoResolveEnabled) blockers.push("auto_resolve_disabled");
  if (top.confidence < policy.autoResolveMin) {
    blockers.push(
      `confidence_below_${policy.autoResolveMin} (${top.confidence.toFixed(3)})`,
    );
  }
  if (margin < policy.autoResolveMargin) {
    blockers.push(
      `margin_below_${policy.autoResolveMargin} (${margin.toFixed(3)})`,
    );
  }
  if (!identityGrade) blockers.push("no_identity_grade_match_reason");
  if (opts.duplicateAlert) blockers.push("duplicate_alert");

  const autoResolve = blockers.length === 0;
  const band: ConfidenceBand = autoResolve
    ? "auto"
    : top.confidence < policy.weakBelow
      ? "weak"
      : "review";

  return {
    band,
    autoResolve,
    topConfidence: top.confidence,
    margin,
    hasIdentityGradeReason: identityGrade,
    blockers,
    policyVersion: CONFIDENCE_POLICY_VERSION,
  };
}
