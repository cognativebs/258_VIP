import { createHash, randomUUID } from "node:crypto";
import {
  SIGNALS_VERSION,
  StageRecordSchema,
  type PipelineStage,
  type StageRecord,
} from "./types.js";

function hashPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Append-only stage store. Updates are forbidden — emit a new stage instead.
 */
export class AppendOnlyStageStore {
  private readonly rows: StageRecord[] = [];

  append(input: {
    runId: string;
    stage: PipelineStage;
    payload: Record<string, unknown>;
    parentIds?: string[];
    quarantineStatus?: StageRecord["quarantineStatus"];
    noveltyScore?: number | null;
    dedupeKey?: string | null;
    notes?: string;
    createdAt?: Date;
  }): StageRecord {
    const row = StageRecordSchema.parse({
      id: randomUUID(),
      runId: input.runId,
      stage: input.stage,
      createdAt: input.createdAt ?? new Date(),
      parentIds: input.parentIds ?? [],
      payload: input.payload,
      contentHash: hashPayload(input.payload),
      quarantineStatus: input.quarantineStatus ?? "active",
      noveltyScore: input.noveltyScore ?? null,
      dedupeKey: input.dedupeKey ?? null,
      notes: input.notes,
    });
    this.rows.push(Object.freeze(row));
    return row;
  }

  /** Forbidden — stages are immutable. */
  update(_id: string): never {
    throw new Error("Signal pipeline stages are append-only: UPDATE is forbidden");
  }

  listByRun(runId: string): StageRecord[] {
    return this.rows.filter((r) => r.runId === runId);
  }

  listByStage(stage: PipelineStage): StageRecord[] {
    return this.rows.filter((r) => r.stage === stage);
  }

  all(): StageRecord[] {
    return [...this.rows];
  }

  version(): string {
    return SIGNALS_VERSION;
  }
}
