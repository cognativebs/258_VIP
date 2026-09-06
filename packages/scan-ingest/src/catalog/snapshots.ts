import { createHash, randomUUID } from "node:crypto";
import { CATALOG_SNAPSHOT_RULE } from "../constants.js";

export type ProviderSnapshotInput = {
  source: string;
  payload: string;
  contentType: string;
  recordCount?: number;
};

export type ProviderSnapshotRecord = {
  id: string;
  source: string;
  contentHash: string;
  contentType: string;
  payload: string;
  byteLength: number;
  recordCount: number;
  ruleOrModelVersion: string;
};

export type SnapshotSink = {
  write: (
    input: ProviderSnapshotInput,
  ) => Promise<{ id: string; contentHash: string } | null>;
};

export function hashProviderPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function createMemorySnapshotSink(): SnapshotSink & {
  records: ProviderSnapshotRecord[];
} {
  const records: ProviderSnapshotRecord[] = [];
  return {
    records,
    async write(input) {
      const contentHash = hashProviderPayload(input.payload);
      const existing = records.find((r) => r.contentHash === contentHash);
      if (existing) {
        return { id: existing.id, contentHash: existing.contentHash };
      }
      const record: ProviderSnapshotRecord = {
        id: randomUUID(),
        source: input.source,
        contentHash,
        contentType: input.contentType,
        payload: input.payload,
        byteLength: Buffer.byteLength(input.payload),
        recordCount: input.recordCount ?? 0,
        ruleOrModelVersion: CATALOG_SNAPSHOT_RULE,
      };
      records.push(record);
      return { id: record.id, contentHash };
    },
  };
}

export function catalogSnapshotSource(adapterId: string): string {
  return `catalog:${adapterId}`;
}
