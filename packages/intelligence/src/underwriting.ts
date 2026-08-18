import { randomUUID } from "node:crypto";
import { markInferred } from "@vip/evidence";
import { round2, round3 } from "./math.js";
import { UnderwritingSchema, type Underwriting } from "./schemas.js";
import { INTELLIGENCE_VERSION } from "./version.js";

export const DEFAULT_COVERAGE_THRESHOLD = 1.3;

export class UnderwritingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnderwritingError";
  }
}

export type UnderwritingInput = {
  id?: string;
  assetId?: string | null;
  lotDescription?: string | null;
  evaluatedAt: Date;
  askingPrice: number;
  offerPrice: number;
  conservativeRawValue: number;
  likelyRawValue?: number | null;
  museumKeepValue?: number | null;
  liquidationValue?: number | null;
  sellingCosts?: number | null;
  expectedDaysToLiquidate?: number | null;
  coverageRatioMinimumThreshold?: number;
  expectedProfit?: number | null;
  capitalAtRisk?: number | null;
  confidence?: number | null;
  linkedRecommendationId?: string | null;
  notes?: string | null;
};

export function coverageRatio(conservativeRawValue: number, offerPrice: number): number {
  if (offerPrice <= 0) {
    throw new UnderwritingError("offerPrice must be > 0");
  }
  return round3(conservativeRawValue / offerPrice);
}

export function underwrite(input: UnderwritingInput): Underwriting {
  const ratio = coverageRatio(input.conservativeRawValue, input.offerPrice);
  const threshold = input.coverageRatioMinimumThreshold ?? DEFAULT_COVERAGE_THRESHOLD;
  const below = ratio < threshold;
  return UnderwritingSchema.parse({
    id: input.id ?? randomUUID(),
    assetId: input.assetId ?? null,
    lotDescription: input.lotDescription ?? null,
    evaluatedAt: input.evaluatedAt,
    askingPrice: input.askingPrice,
    offerPrice: input.offerPrice,
    conservativeRawValue: input.conservativeRawValue,
    likelyRawValue: input.likelyRawValue ?? null,
    museumKeepValue: input.museumKeepValue ?? null,
    liquidationValue: input.liquidationValue ?? null,
    sellingCosts: input.sellingCosts ?? null,
    expectedDaysToLiquidate: input.expectedDaysToLiquidate ?? null,
    acquisitionCoverageRatio: ratio,
    coverageRatioMinimumThreshold: threshold,
    belowThreshold: below,
    blocked: false,
    expectedProfit: input.expectedProfit ?? round2(input.conservativeRawValue - input.offerPrice),
    capitalAtRisk: input.capitalAtRisk ?? input.offerPrice,
    confidence: input.confidence ?? null,
    linkedRecommendationId: input.linkedRecommendationId ?? null,
    completedTransaction: false,
    lockedAt: null,
    notes: input.notes ?? (below ? "Below coverage threshold — flag for human review, do not auto-block" : null),
    provenance: markInferred({
      source: "acquisition_underwriting",
      ruleOrModelVersion: INTELLIGENCE_VERSION,
      confidence: input.confidence ?? 0.7,
      notes: "Coverage ratio is computed; inputs are user-supplied at underwriting time",
    }),
  });
}

export function lockUnderwriting(row: Underwriting, lockedAt: Date): Underwriting {
  if (row.lockedAt) {
    throw new UnderwritingError("Locked underwriting records are immutable");
  }
  return UnderwritingSchema.parse({
    ...row,
    completedTransaction: true,
    lockedAt,
  });
}

export function assertUnderwritingMutable(row: Underwriting): void {
  if (row.completedTransaction && row.lockedAt) {
    throw new UnderwritingError(
      "Underwriting record is immutable once linked to a completed transaction",
    );
  }
}
