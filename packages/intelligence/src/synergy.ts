import { randomUUID } from "node:crypto";
import { markInferred } from "@vip/evidence";
import { clamp, round2 } from "./math.js";
import { SynergyScoreSchema, type SynergyScore } from "./schemas.js";
import { INTELLIGENCE_VERSION } from "./version.js";

export type SynergyInput = {
  id?: string;
  holdingId: string;
  evaluatedAt: Date;
  marketAttractiveness: number;
  museumImportance: number;
  investmentScore: number;
  liquidityScore: number;
  contributingGoalIds: string[];
  notes?: string | null;
};

/**
 * Composite is a weighted blend — components stay independently queryable.
 * Dual-goal contribution (e.g. Blastoise Master + Tag Team Master) raises
 * the goal term; it is never silently folded into a single opaque number.
 */
export function compositeSynergyScore(input: {
  marketAttractiveness: number;
  museumImportance: number;
  investmentScore: number;
  liquidityScore: number;
  contributingGoalIds: string[];
}): number {
  const goalTerm = clamp(40 + 30 * input.contributingGoalIds.length, 0, 100);
  return round2(
    input.marketAttractiveness * 0.2 +
      input.museumImportance * 0.25 +
      input.investmentScore * 0.2 +
      input.liquidityScore * 0.15 +
      goalTerm * 0.2,
  );
}

/** Quality / capital — components stay visible; not an auto-sell signal. */
export function collectionQualityDensity(input: {
  museumImportance: number;
  investmentScore: number;
  liquidityScore: number;
  collectionSynergyScore: number;
  capitalDeployed: number;
}): {
  museumImportance: number;
  investmentScore: number;
  liquidityScore: number;
  collectionSynergyScore: number;
  capitalDeployed: number;
  qualityBlend: number;
  collectionQualityDensity: number;
} {
  const qualityBlend = round2(
    (input.museumImportance +
      input.investmentScore +
      input.liquidityScore +
      input.collectionSynergyScore) /
      4,
  );
  const capital = Math.max(input.capitalDeployed, 1);
  return {
    ...input,
    qualityBlend,
    collectionQualityDensity: round2(qualityBlend / (capital / 100)),
  };
}

export function scoreSynergy(input: SynergyInput): SynergyScore {
  const collectionSynergyScore = compositeSynergyScore(input);
  return SynergyScoreSchema.parse({
    id: input.id ?? randomUUID(),
    holdingId: input.holdingId,
    evaluatedAt: input.evaluatedAt,
    marketAttractiveness: input.marketAttractiveness,
    museumImportance: input.museumImportance,
    investmentScore: input.investmentScore,
    liquidityScore: input.liquidityScore,
    collectionSynergyScore,
    contributingGoalIds: input.contributingGoalIds,
    notes: input.notes ?? null,
    provenance: markInferred({
      source: "museum_synergy_score",
      ruleOrModelVersion: INTELLIGENCE_VERSION,
      confidence: 0.6,
      notes: "Component scores remain the source of truth; composite is a convenience blend",
    }),
  });
}
