import { z } from "zod";

export const SPINE_RULE_VERSION = "signals-spine@0.1.0";

export const SpineProvenanceMethodSchema = z.enum([
  "observed",
  "normalized",
  "inferred",
  "opinion",
  "recommendation",
]);

export const SpineVerificationStatusSchema = z.enum([
  "verified",
  "unverified",
  "disputed",
  "superseded",
]);

export const SpineProvenanceSchema = z.object({
  source: z.string().min(1),
  method: SpineProvenanceMethodSchema,
  ruleOrModelVersion: z.string().min(1),
  confidence: z.number().min(0).max(1),
  verificationStatus: SpineVerificationStatusSchema,
  notes: z.string().nullable(),
});
export type SpineProvenance = z.infer<typeof SpineProvenanceSchema>;

export const IngestRunSchema = z
  .object({
    id: z.string().uuid(),
    sourceId: z.string().min(1),
    startedAt: z.coerce.date(),
    finishedAt: z.coerce.date().nullable(),
    status: z.string().min(1),
    documentsFetched: z.number().int().nonnegative(),
    documentsNew: z.number().int().nonnegative(),
    errorText: z.string().nullable(),
  })
  .strict();
export type IngestRun = z.infer<typeof IngestRunSchema>;

export const RawDocumentSchema = z
  .object({
    id: z.string().uuid(),
    sourceId: z.string().min(1),
    fetchedAt: z.coerce.date(),
    sourceUrl: z.string().nullable(),
    urlCanonical: z.string().nullable(),
    contentHash: z.string().min(1),
    httpStatus: z.number().int().nullable(),
    rawPayloadRef: z.string().min(1).max(1024),
    extractionStatus: z.string().min(1),
    ingestRunId: z.string().uuid(),
  })
  .strict();
export type RawDocument = z.infer<typeof RawDocumentSchema>;

export const DocumentSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    rawDocumentId: z.string().uuid(),
    storedAt: z.coerce.date(),
    storageBackend: z.string().min(1),
    storageKey: z.string().min(1).max(1024),
    byteSize: z.number().int().nonnegative(),
    mediaType: z.string().min(1),
  })
  .strict();
export type DocumentSnapshot = z.infer<typeof DocumentSnapshotSchema>;

export const EvidenceRoleSchema = z.enum([
  "PRIMARY",
  "DERIVATIVE",
  "DISCUSSION",
  "UNKNOWN",
]);
export type EvidenceRole = z.infer<typeof EvidenceRoleSchema>;

export const OriginRelationSchema = z.enum([
  "QUOTES",
  "SYNDICATES",
  "LINKS_TO",
  "REWRITES",
]);
export type OriginRelation = z.infer<typeof OriginRelationSchema>;

export const SpineEventSchema = z
  .object({
    id: z.string().uuid(),
    eventKey: z.string().min(1),
    title: z.string().min(1),
    occurredAt: z.coerce.date().nullable(),
    firstSeenAt: z.coerce.date(),
    eventType: z.string().min(1),
    primaryOriginDocumentId: z.string().uuid().nullable(),
    status: z.string().min(1),
    provenance: SpineProvenanceSchema,
  })
  .strict();
export type SpineEvent = z.infer<typeof SpineEventSchema>;

export const EventEvidenceSchema = z
  .object({
    eventId: z.string().uuid(),
    rawDocumentId: z.string().uuid(),
    role: EvidenceRoleSchema,
    independenceGroup: z.string().min(1).nullable(),
    detectedAt: z.coerce.date(),
  })
  .strict()
  .refine((row) => row.role !== "PRIMARY" || row.independenceGroup != null, {
    message: "PRIMARY evidence requires an independence group",
  });
export type EventEvidence = z.infer<typeof EventEvidenceSchema>;

export const OriginLinkSchema = z
  .object({
    fromDocumentId: z.string().uuid(),
    toDocumentId: z.string().uuid(),
    relation: OriginRelationSchema,
    detectedBy: z.string().min(1),
    confidence: z.number().min(0).max(1),
    detectedAt: z.coerce.date(),
    provRuleVersion: z.string().min(1),
    provVerification: SpineVerificationStatusSchema,
  })
  .strict()
  .refine((row) => row.fromDocumentId !== row.toDocumentId, {
    message: "an origin link cannot point at itself",
  });
export type OriginLink = z.infer<typeof OriginLinkSchema>;

/** Codes seeded in 20260920_12. Half-lives are guesses, not measurements. */
export const SpineSignalTypeCodeSchema = z.enum([
  "PLAYER_INJURY",
  "RESTOCK",
  "AUCTION_RESULT",
  "SET_RELEASE",
  "REPRINT",
  "LICENSE_CHANGE",
  "HOF_ANNOUNCEMENT",
  "MACRO_TREND",
  "SUPPLY_CHANGE",
]);
export type SpineSignalTypeCode = z.infer<typeof SpineSignalTypeCodeSchema>;

export const SpineSignalTypeSchema = z
  .object({
    code: SpineSignalTypeCodeSchema,
    displayName: z.string().min(1),
    defaultHalfLifeHours: z.number().int().positive(),
    description: z.string().min(1),
    halfLifeVerified: z.boolean(),
  })
  .strict();
export type SpineSignalType = z.infer<typeof SpineSignalTypeSchema>;

/**
 * Priority is computed at read time from the current weight set (ADR 0013 G-5,
 * option C). weighted_product_v1:
 *   base_confidence^a * base_impact^b * (1 - noise_probability)^c
 * Exponents are data, never code constants. 1/1/1 is the unverified v0 product.
 */
export const WeightedProductExponentsSchema = z
  .object({
    base_confidence: z.number().nonnegative(),
    base_impact: z.number().nonnegative(),
    one_minus_noise: z.number().nonnegative(),
  })
  .strict();
export type WeightedProductExponents = z.infer<typeof WeightedProductExponentsSchema>;

export const ScoreWeightSetSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    weightsJson: z
      .object({
        formula: z.literal("weighted_product_v1"),
        exponents: WeightedProductExponentsSchema,
        stored_inputs: z.array(
          z.enum(["base_confidence", "base_impact", "noise_probability"]),
        ),
        excluded_inputs: z.array(z.string()),
        notes: z.string().min(1),
      })
      .strict(),
    verified: z.boolean(),
    isCurrent: z.boolean(),
  })
  .strict();
export type ScoreWeightSet = z.infer<typeof ScoreWeightSetSchema>;

/**
 * Exactly three stored scores. Priority is not stored: it is computed at read
 * time from the current weight set (vault_signals.signal_priority).
 * scoreWeightSetId records the set that was current when the row was written.
 * .strict() rejects relevance, novelty, magnitude, actionability, source_quality.
 */
export const SpineSignalSchema = z
  .object({
    id: z.string().uuid(),
    signalTypeCode: SpineSignalTypeCodeSchema,
    domain: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    direction: z.string().min(1),
    firstSeenAt: z.coerce.date(),
    lastUpdatedAt: z.coerce.date(),
    eventId: z.string().uuid(),
    baseConfidence: z.number().min(0).max(1),
    baseImpact: z.number().min(0).max(1),
    noiseProbability: z.number().min(0).max(1),
    scoreWeightSetId: z.string().uuid(),
    createdByVersion: z.string().min(1),
    provenance: SpineProvenanceSchema,
  })
  .strict();
export type SpineSignal = z.infer<typeof SpineSignalSchema>;

export const SignalEntitySchema = z
  .object({
    signalId: z.string().uuid(),
    entityRef: z.string().min(1),
    entityKind: z.string().min(1),
    relevance: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type SignalEntity = z.infer<typeof SignalEntitySchema>;

export const AttentionObservationSchema = z
  .object({
    signalId: z.string().uuid().nullable(),
    entityRef: z.string().min(1).nullable(),
    observedAt: z.coerce.date(),
    sourceId: z.string().min(1),
    mentionVolume: z.number().int().nonnegative(),
    volumeDelta: z.number(),
    windowHours: z.number().int().positive(),
    provMethod: SpineProvenanceMethodSchema,
    provRuleVersion: z.string().min(1),
    provVerification: SpineVerificationStatusSchema,
  })
  .strict()
  .refine((row) => row.signalId != null || row.entityRef != null, {
    message: "attention needs a signal or an entity ref",
  });
export type AttentionObservation = z.infer<typeof AttentionObservationSchema>;

export const PREDICTION_MEASUREMENT_HORIZONS_DAYS = [7, 30, 90, 180, 365] as const;

export const PredictionSchema = z
  .object({
    id: z.string().uuid(),
    createdAt: z.coerce.date(),
    createdBy: z.string().min(1),
    subjectRef: z.string().min(1),
    subjectKind: z.string().min(1),
    claimText: z.string().min(1),
    expectedLow: z.number().nullable(),
    expectedHigh: z.number().nullable(),
    expectedUnit: z.string().min(1).nullable(),
    downsideCase: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    horizonDays: z.number().int().positive(),
    expiresAt: z.coerce.date(),
    status: z.string().min(1),
    sourceSignalId: z.string().uuid().nullable(),
    sourceThesisRef: z.string().min(1).nullable(),
    /** Weight set current when the prediction was written. Filled by the DB when omitted. */
    scoreWeightSetId: z.string().uuid().nullable(),
    provenance: SpineProvenanceSchema,
  })
  .strict()
  .refine(
    (row) =>
      row.expectedLow == null ||
      row.expectedHigh == null ||
      row.expectedLow <= row.expectedHigh,
    { message: "expectedLow cannot exceed expectedHigh" },
  );
export type Prediction = z.infer<typeof PredictionSchema>;

export const PredictionMeasurementSchema = z
  .object({
    predictionId: z.string().uuid(),
    dueAt: z.coerce.date(),
    measuredAt: z.coerce.date().nullable(),
    observedValue: z.number().nullable(),
    directionCorrect: z.boolean().nullable(),
    magnitudeError: z.number().nullable(),
    timingError: z.number().nullable(),
    notes: z.string().nullable(),
  })
  .strict();
export type PredictionMeasurement = z.infer<typeof PredictionMeasurementSchema>;

/** A citation is a description of a refused valuation use. The ceiling stays false. */
export const ValuationCitationSchema = z
  .object({
    signalId: z.string().uuid(),
    valuationPath: z.string().min(1),
    mayRaiseValuationCeiling: z.literal(false),
  })
  .strict();
export type ValuationCitation = z.infer<typeof ValuationCitationSchema>;
