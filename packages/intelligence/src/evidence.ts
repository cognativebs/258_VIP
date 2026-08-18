import { randomUUID } from "node:crypto";
import { markObserved } from "@vip/evidence";
import { addDays, hoursBetween } from "./math.js";
import { uuidFromKey } from "./ids.js";
import {
  EvidenceCardSchema,
  EvidenceSourceSchema,
  RecommendationRecordSchema,
  type EvidenceCard,
  type EvidenceSource,
  type RecommendationAction,
  type RecommendationRecord,
  type SourceSystem,
} from "./schemas.js";
import { INTELLIGENCE_VERSION } from "./version.js";

export class EvidenceEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceEngineError";
  }
}

export type EvidenceCardInput = {
  id?: string;
  evidenceSource: EvidenceSource;
  evidenceTimestamp: Date;
  confidence?: number | null;
  supportingEvidence?: string | null;
  contradictoryEvidence?: string | null;
  missingInformation?: string | null;
  confidenceWouldIncreaseIf?: string | null;
  rawReferenceId?: string | null;
};

export type RecommendationInput = {
  id?: string;
  assetId?: string | null;
  holdingId?: string | null;
  action: RecommendationAction;
  confidence: number;
  rationale?: string | null;
  createdAt: Date;
  expiresAt: Date;
  sourceSystem: SourceSystem;
  evidence: EvidenceCardInput[];
};

function buildCard(
  recommendationId: string,
  input: EvidenceCardInput,
  asOf: Date,
): EvidenceCard {
  return EvidenceCardSchema.parse({
    id: input.id ?? randomUUID(),
    recommendationId,
    evidenceSource: input.evidenceSource,
    evidenceTimestamp: input.evidenceTimestamp,
    freshnessHours: hoursBetween(asOf, input.evidenceTimestamp),
    confidence: input.confidence ?? null,
    supportingEvidence: input.supportingEvidence ?? null,
    contradictoryEvidence: input.contradictoryEvidence ?? null,
    missingInformation: input.missingInformation ?? null,
    confidenceWouldIncreaseIf: input.confidenceWouldIncreaseIf ?? null,
    rawReferenceId: input.rawReferenceId ?? null,
    createdAt: asOf,
    provenance: markObserved({
      source: input.evidenceSource,
      ruleOrModelVersion: INTELLIGENCE_VERSION,
      confidence: input.confidence ?? 0.7,
    }),
  });
}

export function createRecommendation(input: RecommendationInput): RecommendationRecord {
  if (input.evidence.length < 1) {
    throw new EvidenceEngineError(
      "Every recommendation must carry at least one evidence_card — incomplete, not just low-confidence",
    );
  }
  const id = input.id ?? randomUUID();
  const asOf = input.createdAt;
  const evidence = input.evidence.map((e) => buildCard(id, e, asOf));
  return readRecommendation(
    RecommendationRecordSchema.parse({
      id,
      assetId: input.assetId ?? null,
      holdingId: input.holdingId ?? null,
      action: input.action,
      confidence: input.confidence,
      rationale: input.rationale ?? null,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      sourceSystem: input.sourceSystem,
      isStale: input.expiresAt <= asOf,
      evidence,
      provenance: markObserved({
        source: input.sourceSystem,
        ruleOrModelVersion: INTELLIGENCE_VERSION,
        confidence: input.confidence,
      }),
    }),
    asOf,
  );
}

/** Every read path must flag stale — never serve past expiresAt as current. */
export function readRecommendation(
  row: RecommendationRecord,
  asOf: Date,
): RecommendationRecord {
  return RecommendationRecordSchema.parse({
    ...row,
    isStale: row.expiresAt <= asOf,
    evidence: row.evidence.map((card) =>
      EvidenceCardSchema.parse({
        ...card,
        freshnessHours: hoursBetween(asOf, card.evidenceTimestamp),
      }),
    ),
  });
}

const ENGINE_ACTION: Record<string, RecommendationAction> = {
  Buy: "buy",
  Hold: "hold",
  Grade: "grade",
  Sell: "sell",
  Lot: "lot",
  Pass: "pass",
  Watch: "watch",
};

export function wrapEngineRecommendation(input: {
  holdingId: string;
  action: string;
  confidence: number;
  supporting: { summary: string }[];
  opposing: { summary: string }[];
  createdAt?: Date;
  expiresHours?: number;
}): RecommendationRecord {
  const createdAt = input.createdAt ?? new Date();
  const expiresAt = addDays(createdAt, (input.expiresHours ?? 48) / 24);
  const action = ENGINE_ACTION[input.action] ?? "watch";
  const evidence: EvidenceCardInput[] = [];
  for (const s of input.supporting.slice(0, 4)) {
    evidence.push({
      evidenceSource: "sold_comp",
      evidenceTimestamp: createdAt,
      supportingEvidence: s.summary,
    });
  }
  for (const s of input.opposing.slice(0, 2)) {
    evidence.push({
      evidenceSource: "manual",
      evidenceTimestamp: createdAt,
      contradictoryEvidence: s.summary,
    });
  }
  if (evidence.length === 0) {
    evidence.push({
      evidenceSource: "manual",
      evidenceTimestamp: createdAt,
      missingInformation: "Decision engine emitted no evidence summaries",
    });
  }
  return createRecommendation({
    assetId: uuidFromKey(input.holdingId),
    action,
    confidence: input.confidence,
    rationale: `Retrofitted decision-engine rec for holding ${input.holdingId}`,
    createdAt,
    expiresAt,
    sourceSystem: "recommendation_evidence_engine",
    evidence,
  });
}

export { EvidenceSourceSchema };
