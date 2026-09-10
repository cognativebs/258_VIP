import { z } from "zod";
import { ScanCategorySchema } from "../schemas.js";

export const LiveGateUnitSchema = z.object({
  unitId: z.string().min(1),
  category: ScanCategorySchema.nullable(),
  displayName: z.string().nullable(),
  adapterId: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  externalSources: z.array(z.string()),
  candidateCount: z.number().int().nonnegative(),
  candidatesWithRequiredId: z.number().int().nonnegative(),
  holdingWritten: z.boolean(),
  confirmedCorrect: z.boolean().nullable(),
});
export type LiveGateUnit = z.infer<typeof LiveGateUnitSchema>;

export const LiveGateSliceSchema = z.object({
  category: ScanCategorySchema,
  requiredExternalSource: z.string().min(1),
  units: z.number().int().nonnegative(),
  withCandidate: z.number().int().nonnegative(),
  top1HasRequiredId: z.number().int().nonnegative(),
  allCandidatesHaveRequiredId: z.number().int().nonnegative(),
  holdingWrites: z.number().int().nonnegative(),
  scoredForAccuracy: z.number().int().nonnegative(),
  top1Correct: z.number().int().nonnegative(),
  top1Accuracy: z.number().min(0).max(1).nullable(),
  minUnits: z.number().int().nonnegative(),
  top1Target: z.number().min(0).max(1),
  passed: z.boolean(),
  blockers: z.array(z.string()),
});
export type LiveGateSlice = z.infer<typeof LiveGateSliceSchema>;

export const LiveIdentificationGateReportSchema = z.object({
  pokemon: LiveGateSliceSchema,
  mtg: LiveGateSliceSchema,
  units: z.array(LiveGateUnitSchema),
});
export type LiveIdentificationGateReport = z.infer<
  typeof LiveIdentificationGateReportSchema
>;

export type LiveGateUnitInput = {
  unitId: string;
  category: "sports" | "pokemon" | "mtg" | null;
  displayName?: string | null;
  adapterId?: string | null;
  confidence?: number | null;
  externalSources?: string[];
  candidateCount?: number;
  candidatesWithRequiredId?: number;
  holdingWritten?: boolean;
  confirmedCorrect?: boolean | null;
};

function ratio(correct: number, total: number): number | null {
  if (total === 0) return null;
  return Number((correct / total).toFixed(4));
}

function scoreSlice(
  category: "pokemon" | "mtg",
  requiredExternalSource: string,
  minUnits: number,
  top1Target: number,
  rows: LiveGateUnitInput[],
): LiveGateSlice {
  const units = rows.filter((row) => row.category === category);
  let withCandidate = 0;
  let top1HasRequiredId = 0;
  let allCandidatesHaveRequiredId = 0;
  let holdingWrites = 0;
  let scoredForAccuracy = 0;
  let top1Correct = 0;

  for (const row of units) {
    const sources = (row.externalSources ?? []).map((s) => s.toLowerCase());
    const candidateCount = row.candidateCount ?? (row.displayName ? 1 : 0);
    const withRequired =
      row.candidatesWithRequiredId ??
      (sources.includes(requiredExternalSource) ? candidateCount : 0);
    if (candidateCount > 0) withCandidate += 1;
    if (sources.includes(requiredExternalSource)) top1HasRequiredId += 1;
    if (candidateCount > 0 && withRequired === candidateCount) {
      allCandidatesHaveRequiredId += 1;
    }
    if (row.holdingWritten) holdingWrites += 1;
    if (row.confirmedCorrect != null) {
      scoredForAccuracy += 1;
      if (row.confirmedCorrect) top1Correct += 1;
    }
  }

  const top1Accuracy = ratio(top1Correct, scoredForAccuracy);
  const blockers: string[] = [];
  if (units.length < minUnits) {
    blockers.push(`need ${minUnits} ${category} scans, have ${units.length}`);
  }
  if (units.length > 0 && allCandidatesHaveRequiredId < units.length) {
    blockers.push(
      `${units.length - allCandidatesHaveRequiredId} ${category} unit(s) missing ${requiredExternalSource} on every candidate`,
    );
  }
  if (top1Accuracy == null) {
    blockers.push(
      `${category} top-1 accuracy is unknown until confirm/correct in Review`,
    );
  } else if (top1Accuracy < top1Target) {
    blockers.push(
      `${category} top-1 ${top1Accuracy} < ${top1Target}`,
    );
  }

  return LiveGateSliceSchema.parse({
    category,
    requiredExternalSource,
    units: units.length,
    withCandidate,
    top1HasRequiredId,
    allCandidatesHaveRequiredId,
    holdingWrites,
    scoredForAccuracy,
    top1Correct,
    top1Accuracy,
    minUnits,
    top1Target,
    passed: blockers.length === 0,
    blockers,
  });
}

/** Score staged scan units against plan 0001 Phase 1 (Pokémon) and Phase 2 (Magic) gates. */
export function scoreLiveIdentificationGate(
  rows: LiveGateUnitInput[],
): LiveIdentificationGateReport {
  const units = rows.map((row) =>
    LiveGateUnitSchema.parse({
      unitId: row.unitId,
      category: row.category,
      displayName: row.displayName ?? null,
      adapterId: row.adapterId ?? null,
      confidence: row.confidence ?? null,
      externalSources: row.externalSources ?? [],
      candidateCount: row.candidateCount ?? (row.displayName ? 1 : 0),
      candidatesWithRequiredId:
        row.candidatesWithRequiredId ??
        ((row.externalSources ?? []).length > 0 && row.displayName ? 1 : 0),
      holdingWritten: row.holdingWritten ?? false,
      confirmedCorrect: row.confirmedCorrect ?? null,
    }),
  );
  return LiveIdentificationGateReportSchema.parse({
    pokemon: scoreSlice("pokemon", "tcgdex", 25, 0.8, rows),
    mtg: scoreSlice("mtg", "scryfall", 25, 0.85, rows),
    units,
  });
}
