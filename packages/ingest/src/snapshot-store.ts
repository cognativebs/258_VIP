import { randomUUID } from "node:crypto";
import type { RawSnapshot } from "@vip/core-model";
import { RawSnapshotSchema } from "@vip/core-model";
import { snapshotProvenance } from "./adapters/clz-xml.js";
import type { DerivedCatalogRow, ParseResult } from "./adapters/types.js";

/**
 * In-memory immutable snapshot store for Phase 1 gate tests.
 * Mirrors infra/db rule: no UPDATE of snapshot rows.
 */
export class ImmutableSnapshotStore {
  private readonly byId = new Map<string, RawSnapshot>();
  private readonly byHash = new Map<string, string>();

  insert(
    draft: ParseResult<unknown>["snapshot"],
  ): RawSnapshot {
    const existingId = this.byHash.get(draft.contentHash);
    if (existingId) {
      const existing = this.byId.get(existingId);
      if (!existing) throw new Error("Snapshot index corrupt");
      return existing;
    }

    const now = draft.ingestedAt instanceof Date ? draft.ingestedAt : new Date(draft.ingestedAt);
    const row = RawSnapshotSchema.parse({
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      provenance: snapshotProvenance(draft.source),
      source: draft.source,
      contentHash: draft.contentHash,
      contentType: draft.contentType,
      payload: draft.payload,
      storageRef: draft.storageRef,
      byteLength: draft.byteLength,
      ingestedAt: now,
      recordCount: draft.recordCount,
    });

    this.byId.set(row.id, Object.freeze(row));
    this.byHash.set(row.contentHash, row.id);
    return row;
  }

  /** Forbidden by VIP F-05 — always throws. */
  update(_id: string, _patch: Partial<RawSnapshot>): never {
    throw new Error("raw_snapshots are immutable: UPDATE is forbidden");
  }

  get(id: string): RawSnapshot | undefined {
    return this.byId.get(id);
  }

  getByHash(hash: string): RawSnapshot | undefined {
    const id = this.byHash.get(hash);
    return id ? this.byId.get(id) : undefined;
  }
}

export class DerivedStore {
  private rows: DerivedCatalogRow[] = [];

  replaceAll(next: DerivedCatalogRow[]): void {
    this.rows = structuredClone(next);
  }

  clear(): void {
    this.rows = [];
  }

  list(): DerivedCatalogRow[] {
    return structuredClone(this.rows);
  }
}

/** Stable fingerprint for round-trip equality (ignore object key order in originalFields). */
export function fingerprintDerived(rows: DerivedCatalogRow[]): string {
  const normalized = rows
    .map((r) => ({
      sourceRowId: r.sourceRowId,
      canonicalName: r.canonicalName,
      categoryKind: r.categoryKind,
      gradeRating: r.gradeRating,
      assumedGrade: r.assumedGrade,
      slabStatus: r.slabStatus,
      quantity: r.quantity,
      purchasePrice: r.purchasePrice,
      currentPrice: r.currentPrice,
      gradeInference: r.gradeInference,
      originalFields: r.originalFields,
    }))
    .sort((a, b) => a.sourceRowId.localeCompare(b.sourceRowId));
  return JSON.stringify(normalized);
}
