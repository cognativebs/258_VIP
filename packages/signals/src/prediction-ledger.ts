import { randomUUID } from "node:crypto";
import {
  PredictionLedgerEntrySchema,
  type PredictionLedgerEntry,
} from "./types.js";

/** Brier score for a binary outcome (1 = hit, 0 = miss). Lower is better. */
export function brierScore(probability: number, outcome: 0 | 1): number {
  return Number(((probability - outcome) ** 2).toFixed(4));
}

export class PredictionLedger {
  private readonly entries: PredictionLedgerEntry[] = [];

  add(
    input: Omit<PredictionLedgerEntry, "id" | "brierScore" | "outcome"> & {
      id?: string;
      outcome?: PredictionLedgerEntry["outcome"];
    },
  ): PredictionLedgerEntry {
    const row = PredictionLedgerEntrySchema.parse({
      id: input.id ?? randomUUID(),
      claim: input.claim,
      probability: input.probability,
      evidenceRefs: input.evidenceRefs ?? [],
      action: input.action,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      outcome: input.outcome ?? "pending",
      outcomeValue: input.outcomeValue ?? null,
      brierScore: null,
      calibrationNotes: input.calibrationNotes ?? null,
      errorNotes: input.errorNotes ?? null,
    });
    this.entries.push(row);
    return row;
  }

  resolve(
    id: string,
    outcome: "hit" | "miss" | "partial" | "void",
    notes?: string,
  ): PredictionLedgerEntry {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`Prediction not found: ${id}`);
    const prev = this.entries[idx]!;
    const outcomeValue =
      outcome === "hit" ? 1 : outcome === "miss" ? 0 : outcome === "partial" ? 0.5 : null;
    const next = PredictionLedgerEntrySchema.parse({
      ...prev,
      outcome,
      outcomeValue,
      brierScore:
        outcomeValue === 0 || outcomeValue === 1
          ? brierScore(prev.probability, outcomeValue)
          : null,
      errorNotes: notes ?? prev.errorNotes,
      calibrationNotes:
        outcomeValue === 0 || outcomeValue === 1
          ? `Resolved ${outcome}; Brier=${brierScore(prev.probability, outcomeValue)}`
          : prev.calibrationNotes,
    });
    // Ledger rows are conceptually immutable events; we append a resolved copy
    // and keep history by replacing in-memory for v0.1 simplicity with note.
    this.entries[idx] = next;
    return next;
  }

  list(): PredictionLedgerEntry[] {
    return [...this.entries];
  }

  calibrationSummary() {
    const scored = this.entries.filter((e) => e.brierScore != null);
    const avgBrier =
      scored.length === 0
        ? null
        : Number(
            (
              scored.reduce((s, e) => s + (e.brierScore ?? 0), 0) / scored.length
            ).toFixed(4),
          );
    return {
      total: this.entries.length,
      pending: this.entries.filter((e) => e.outcome === "pending").length,
      scored: scored.length,
      averageBrier: avgBrier,
      hits: this.entries.filter((e) => e.outcome === "hit").length,
      misses: this.entries.filter((e) => e.outcome === "miss").length,
    };
  }
}
