import type { RawSnapshot } from "@vip/core-model";

/** Shared contract for all source adapters (CLZ, TCG, …). */
export interface SourceAdapter<TRecord = Record<string, unknown>> {
  readonly id: string;
  readonly contentTypes: string[];
  parse(input: { filename: string; bytes: Buffer | string }): Promise<ParseResult<TRecord>>;
}

export interface ParseResult<TRecord> {
  /** Original fields preserved per source row (never drop unknowns). */
  records: TRecord[];
  /** Immutable snapshot of the exact input bytes/string. */
  snapshot: Omit<RawSnapshot, "id" | "createdAt" | "updatedAt" | "provenance"> & {
    provenanceNotes?: string;
  };
}

export interface DerivedCatalogRow {
  sourceRowId: string;
  canonicalName: string;
  categoryKind: "comic" | "pokemon" | "sports" | "mtg" | "other";
  originalFields: Record<string, unknown>;
  /** null when grade was 0.0 / absent — never a fake number */
  gradeRating: number | null;
  assumedGrade: string | null;
  slabStatus: "raw" | "slabbed" | "pending" | null;
  quantity: number;
  purchasePrice: number | null;
  currentPrice: number | null;
  gradeInference:
    | { kind: "none" }
    | { kind: "nm_assumed"; verificationStatus: "unverified" };
}
