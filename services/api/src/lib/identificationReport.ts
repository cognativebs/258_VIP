import { CATALOG_RESOLVER_RULE } from "@vip/scan-ingest";
import type { StagedBatchRow, StagedUnitRow } from "./scanStorePg.js";
import { liveCatalogStatus } from "./catalogLive.js";

export type IdentificationReportUnit = {
  unitId: string;
  unitIndex: number;
  status: string;
  frontFile: string;
  ocrFront: string;
  ocrBack: string;
  whyWon: string;
  catalogSource: string;
  adapterOutcomes: Array<{ adapterId: string; status: string; cardCount?: number }>;
  winner: {
    displayName: string;
    catalogKey: string;
    adapterId: string;
    confidence: number;
    collectorNumber: string | null;
    setName: string | null;
    externalIds: unknown;
  } | null;
  candidates: Array<{
    displayName: string;
    catalogKey: string;
    adapterId: string;
    confidence: number;
    matchReasons: string[];
  }>;
};

export type IdentificationReport = {
  kind: "vip.scan.identification-report";
  version: string;
  exportedAt: string;
  batchId: string;
  categoryHint: string | null;
  notes: string | null;
  unitCount: number;
  catalog: ReturnType<typeof liveCatalogStatus>;
  units: IdentificationReportUnit[];
};

function baseName(ref: string): string {
  return ref.split(/[\\/]/).pop() ?? ref;
}

function debugOf(unit: StagedUnitRow): {
  rawOcr?: { front?: string; back?: string };
  whyWon?: string;
  catalogSource?: string;
  adapterOutcomes?: Array<{ adapterId: string; status: string; cardCount?: number }>;
} {
  const evidence = unit.identityEvidence as
    | { debug?: Record<string, unknown> }
    | null
    | undefined;
  return (evidence?.debug ?? {}) as ReturnType<typeof debugOf>;
}

export function buildIdentificationReport(
  batch: StagedBatchRow,
): IdentificationReport {
  return {
    kind: "vip.scan.identification-report",
    version: CATALOG_RESOLVER_RULE,
    exportedAt: new Date().toISOString(),
    batchId: batch.id,
    categoryHint: batch.categoryHint,
    notes: batch.notes,
    unitCount: batch.units.length,
    catalog: liveCatalogStatus(),
    units: batch.units.map((unit) => {
      const debug = debugOf(unit);
      const top = unit.candidates[0];
      return {
        unitId: unit.id,
        unitIndex: unit.unitIndex,
        status: unit.status,
        frontFile: baseName(unit.frontStorageRef),
        ocrFront: debug.rawOcr?.front ?? "",
        ocrBack: debug.rawOcr?.back ?? "",
        whyWon: debug.whyWon ?? "",
        catalogSource:
          debug.catalogSource ?? top?.adapterId ?? "unknown",
        adapterOutcomes: debug.adapterOutcomes ?? [],
        winner: top
          ? {
              displayName: top.displayName,
              catalogKey: top.catalogKey,
              adapterId: top.adapterId,
              confidence: top.confidence,
              collectorNumber: top.collectorNumber,
              setName: top.setName,
              externalIds: null,
            }
          : null,
        candidates: unit.candidates.slice(0, 5).map((c) => ({
          displayName: c.displayName,
          catalogKey: c.catalogKey,
          adapterId: c.adapterId,
          confidence: c.confidence,
          matchReasons: c.matchReasons,
        })),
      };
    }),
  };
}
