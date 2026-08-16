import type { Provenance } from "./provenance.js";

export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceError";
  }
}

/**
 * Throws unless the provenance block is verified and not superseded.
 * Use before treating a derived value as ground truth.
 */
export function assertVerified(provenance: Provenance): void {
  if (provenance.verificationStatus === "superseded") {
    throw new ProvenanceError(
      `Provenance superseded${provenance.supersededBy ? ` by ${provenance.supersededBy}` : ""}`,
    );
  }
  if (provenance.verificationStatus === "disputed") {
    throw new ProvenanceError("Provenance is disputed — do not treat as verified fact");
  }
  if (provenance.verificationStatus !== "verified") {
    throw new ProvenanceError(
      `Expected verified provenance, got ${provenance.verificationStatus} (method=${provenance.method})`,
    );
  }
  if (provenance.method === "inferred") {
    throw new ProvenanceError(
      "Inferred values cannot pass assertVerified — verify or keep labeled as inferred",
    );
  }
}

/**
 * Mark a value as inferred · unverified (e.g. CLZ grade 0.0 → NM assumed).
 * Never store inferred numbers as if they were observed grades.
 */
export function markInferred(
  partial: Pick<Provenance, "source" | "ruleOrModelVersion"> &
    Partial<Omit<Provenance, "source" | "ruleOrModelVersion" | "method" | "verificationStatus">>,
): Provenance {
  return {
    source: partial.source,
    method: "inferred",
    ruleOrModelVersion: partial.ruleOrModelVersion,
    confidence: partial.confidence ?? 0.4,
    confidenceBand: partial.confidenceBand ?? "low",
    verificationStatus: "unverified",
    supersededBy: partial.supersededBy ?? null,
    notes: partial.notes,
  };
}

/**
 * Mark a value the provider computed rather than witnessed — e.g. a TCGplayer
 * market price published on a day with zero sales. Not observed evidence, but
 * not our inference either, so it stays unverified without pretending to be a
 * trade.
 */
export function markNormalized(
  partial: Pick<Provenance, "source" | "ruleOrModelVersion"> &
    Partial<Omit<Provenance, "source" | "ruleOrModelVersion" | "method">>,
): Provenance {
  return {
    source: partial.source,
    method: "normalized",
    ruleOrModelVersion: partial.ruleOrModelVersion,
    confidence: partial.confidence ?? 0.6,
    confidenceBand: partial.confidenceBand,
    verificationStatus: partial.verificationStatus ?? "unverified",
    supersededBy: partial.supersededBy ?? null,
    notes: partial.notes,
  };
}

export function markObserved(
  partial: Pick<Provenance, "source" | "ruleOrModelVersion" | "confidence"> &
    Partial<Omit<Provenance, "source" | "ruleOrModelVersion" | "confidence" | "method">>,
): Provenance {
  return {
    source: partial.source,
    method: "observed",
    ruleOrModelVersion: partial.ruleOrModelVersion,
    confidence: partial.confidence,
    confidenceBand: partial.confidenceBand,
    verificationStatus: partial.verificationStatus ?? "verified",
    supersededBy: partial.supersededBy ?? null,
    notes: partial.notes,
  };
}
