import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConstraints } from "@vip/core-model";

/**
 * Per-user decision constraints. Never hardcode budget/risk on the recommend path —
 * that stamped every recommendation with the same invented profile.
 *
 * Load order:
 *   1. VIP_USER_CONSTRAINTS_PATH JSON file, if set and present
 *   2. services/api/user-constraints.json next to the package, if present
 *   3. empty defaults (null budget / risk) — engine must still run honestly
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const EMPTY: UserConstraints = {
  collectionGoals: [],
  budget: null,
  riskTolerance: null,
  timeHorizon: null,
  premiumTolerance: null,
};

function parseConstraints(raw: unknown): UserConstraints {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const o = raw as Record<string, unknown>;
  return {
    collectionGoals: Array.isArray(o.collectionGoals)
      ? o.collectionGoals.map(String)
      : [],
    budget: typeof o.budget === "number" ? o.budget : null,
    riskTolerance:
      o.riskTolerance === "low" ||
      o.riskTolerance === "medium" ||
      o.riskTolerance === "high"
        ? o.riskTolerance
        : null,
    timeHorizon: typeof o.timeHorizon === "string" ? o.timeHorizon : null,
    premiumTolerance: typeof o.premiumTolerance === "number" ? o.premiumTolerance : null,
  };
}

export function loadUserConstraints(): UserConstraints {
  const candidates = [
    process.env.VIP_USER_CONSTRAINTS_PATH,
    join(__dirname, "..", "..", "user-constraints.json"),
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return parseConstraints(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      // Fall through — a corrupt file must not invent a profile.
    }
  }
  return { ...EMPTY };
}

/** Merge holding-specific goals (pillar) onto the user profile without inventing risk/budget. */
export function constraintsForHolding(
  base: UserConstraints,
  pillar: string | null | undefined,
): UserConstraints {
  const goals = [...base.collectionGoals];
  if (pillar && !goals.includes(pillar)) goals.push(pillar);
  return { ...base, collectionGoals: goals };
}

/**
 * Grading cost per book used by the sell-queue grading-EV check.
 *
 * Load order: VIP_GRADING_COST_USD env > `gradingCostUsd` in the same user
 * constraints JSON > DEFAULT_GRADING_COST_USD. The default is an assumption
 * (rough PSA/CGC economy tier, no shipping or insurance) and is labelled
 * unverified everywhere it surfaces. None of the three is a verified quote.
 */
export const DEFAULT_GRADING_COST_USD = 25;

export type GradingCostAssumption = {
  usd: number;
  source: "env" | "user_constraints" | "default_assumption";
  verificationStatus: "unverified";
  note: string;
};

function positiveNumber(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export function loadGradingCostAssumption(env: NodeJS.ProcessEnv = process.env): GradingCostAssumption {
  const fromEnv = positiveNumber(env.VIP_GRADING_COST_USD);
  if (fromEnv != null) {
    return {
      usd: fromEnv,
      source: "env",
      verificationStatus: "unverified",
      note: "VIP_GRADING_COST_USD (operator-set, not a grader quote)",
    };
  }
  const candidates = [
    env.VIP_USER_CONSTRAINTS_PATH,
    join(__dirname, "..", "..", "user-constraints.json"),
  ].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const usd = positiveNumber(raw?.gradingCostUsd);
      if (usd != null) {
        return {
          usd,
          source: "user_constraints",
          verificationStatus: "unverified",
          note: "gradingCostUsd from user constraints (operator-set, not a grader quote)",
        };
      }
    } catch {
      // Corrupt file: fall through to the labelled default.
    }
  }
  return {
    usd: DEFAULT_GRADING_COST_USD,
    source: "default_assumption",
    verificationStatus: "unverified",
    note: `Default ${DEFAULT_GRADING_COST_USD} USD per book is an assumption · unverified (no shipping, insurance or tier quote)`,
  };
}
