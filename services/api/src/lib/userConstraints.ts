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
