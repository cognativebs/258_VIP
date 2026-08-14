import type { EbayListingDraft, ScanBatch } from "./schemas.js";

/**
 * In-memory session store for intake (tests + API without DB).
 * Postgres capture_session migration is the durable path.
 */
export class ScanSessionStore {
  private batches = new Map<string, ScanBatch>();
  private drafts = new Map<string, EbayListingDraft>();

  putBatch(batch: ScanBatch): void {
    this.batches.set(batch.id, batch);
  }

  getBatch(id: string): ScanBatch | undefined {
    return this.batches.get(id);
  }

  listBatches(): ScanBatch[] {
    return [...this.batches.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  updateBatch(id: string, updater: (batch: ScanBatch) => ScanBatch): ScanBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`Unknown scan batch ${id}`);
    const next = updater(current);
    this.batches.set(id, next);
    return next;
  }

  findUnit(
    unitId: string,
  ): { batch: ScanBatch; unitIndex: number } | undefined {
    for (const batch of this.batches.values()) {
      const unitIndex = batch.units.findIndex((u) => u.id === unitId);
      if (unitIndex >= 0) return { batch, unitIndex };
    }
    return undefined;
  }

  putDraft(draft: EbayListingDraft): void {
    this.drafts.set(draft.id, draft);
  }

  getDraft(id: string): EbayListingDraft | undefined {
    return this.drafts.get(id);
  }

  listDrafts(): EbayListingDraft[] {
    return [...this.drafts.values()];
  }

  clear(): void {
    this.batches.clear();
    this.drafts.clear();
  }
}
