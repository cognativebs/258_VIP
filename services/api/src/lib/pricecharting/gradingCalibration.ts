/**
 * First P(9.8) calibration set. Frozen inputs; outcome columns stay empty
 * until returned grades are scored later. Not signals_normalized. Phase 2 off.
 */
import {
  GRADING_P98_SET_KEY,
  GRADING_P98_SET_RULE,
  GradingP98CalibrationSetSchema,
  PHASE_D_P_98_UNVERIFIED,
  type GradingP98CalibrationRec,
  type GradingP98CalibrationSet,
  type GradingP98Removal,
  type PhaseDEvidenceBundle,
} from "@vip/core-model";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "../../db/client.js";

export const GRADING_P98_JSON_REL = "data/calibration/2026-09-20_p98_set_001.json";

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function calibrationSetFromArbitrage(
  bundles: PhaseDEvidenceBundle[],
  frozenAt: Date,
): GradingP98CalibrationSet {
  const records: GradingP98CalibrationRec[] = bundles
    .filter((row) => row.emitterKey === "grading_arbitrage")
    .map((row) => {
      const ev = row.evidence;
      const flags = [
        ev.vendorDerivedMultiple ? "vendor_derived 9.8 multiple · confidence ≤ 0.75" : null,
        ev.p98Assumed ? `P(9.8)=${ev.p98 ?? PHASE_D_P_98_UNVERIFIED} assumed · unverified` : null,
        ev.pre1975PressRestorationRisk ? "pre-1975 press/restoration risk" : null,
      ].filter((flag): flag is string => Boolean(flag));
      return {
        assetId: row.assetId,
        holdingId: null,
        canonicalName: ev.canonicalName == null ? null : String(ev.canonicalName),
        rawUngraded: num(ev.rawUngraded),
        highGrade: num(ev.highGrade),
        highKey: String(ev.highKey ?? row.conditionKey),
        ratio: num(ev.ratio),
        profitAtP10: num(ev.profitAtP10),
        profitAtP20: num(ev.profitAtP20),
        profitAtP30: num(ev.profitAtP30),
        expectedIncrementalProfit: num(ev.expectedIncrementalProfit),
        expectedGradingValue: num(ev.expectedValue),
        gradingOpportunityScore: num(ev.gradingOpportunityScore),
        recommendation: String(ev.recommendation ?? "inspect_further"),
        p98Assumed: num(ev.p98, PHASE_D_P_98_UNVERIFIED),
        vendorDerivedMultiple: true as const,
        pre1975PressRestorationRisk: Boolean(ev.pre1975PressRestorationRisk),
        yearBegan: ev.yearBegan == null ? null : Number(ev.yearBegan),
        flags,
        evidence: ev,
      };
    });
  return GradingP98CalibrationSetSchema.parse({
    setKey: GRADING_P98_SET_KEY,
    setFrozenAt: frozenAt.toISOString(),
    ruleOrModelVersion: GRADING_P98_SET_RULE,
    p98AssumedDefault: PHASE_D_P_98_UNVERIFIED,
    phase2Enabled: false,
    recordCount: records.length,
    records,
    removed: [],
    provenance: {
      source: "grading_p98_calibration",
      method: "inferred",
      ruleOrModelVersion: GRADING_P98_SET_RULE,
      verificationStatus: "unverified",
      notes:
        "First P(9.8) calibration set. Intersection of positive EV at 0.10/0.20/0.30. " +
        "Returned grades score against these frozen inputs. Not signals_normalized. Phase 2 off.",
    },
  });
}

export async function persistGradingP98Set(
  set: GradingP98CalibrationSet,
  repoRoot: string,
): Promise<{ jsonPath: string; inserted: number; alreadyFrozen: number }> {
  const jsonPath = path.join(repoRoot, GRADING_P98_JSON_REL);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(set, null, 2)}\n`, "utf8");

  const db = getDb();
  let inserted = 0;
  let alreadyFrozen = 0;
  for (const rec of set.records) {
    const result = await db.execute(sql`
      INSERT INTO vault_core.grading_p98_calibration (
        set_key, set_frozen_at, asset_id, holding_id, canonical_name,
        raw_ungraded, high_grade, high_key, ratio,
        profit_at_p10, profit_at_p20, profit_at_p30,
        expected_incremental_profit, expected_grading_value,
        grading_opportunity_score, recommendation,
        p98_assumed, vendor_derived_multiple, pre1975_press_restoration_risk,
        year_began, flags, evidence,
        provider_ids, prov_source, prov_method, prov_rule_version,
        prov_confidence, prov_verification, prov_notes
      ) VALUES (
        ${set.setKey},
        ${set.setFrozenAt}::timestamptz,
        ${rec.assetId}::uuid,
        ${rec.holdingId}::uuid,
        ${rec.canonicalName},
        ${rec.rawUngraded},
        ${rec.highGrade},
        ${rec.highKey},
        ${rec.ratio},
        ${rec.profitAtP10},
        ${rec.profitAtP20},
        ${rec.profitAtP30},
        ${rec.expectedIncrementalProfit},
        ${rec.expectedGradingValue},
        ${rec.gradingOpportunityScore},
        ${rec.recommendation},
        ${rec.p98Assumed},
        ${rec.vendorDerivedMultiple},
        ${rec.pre1975PressRestorationRisk},
        ${rec.yearBegan},
        ${rec.flags.join(" · ")},
        ${JSON.stringify(rec.evidence)}::jsonb,
        '{}'::jsonb,
        ${set.provenance.source},
        'inferred',
        ${GRADING_P98_SET_RULE},
        0.750,
        'unverified',
        ${set.provenance.notes}
      )
      ON CONFLICT (set_key, asset_id) DO NOTHING
    `);
    const count = result.rowCount ?? 0;
    inserted += count;
    if (count === 0) alreadyFrozen += 1;
  }
  return { jsonPath, inserted, alreadyFrozen };
}

export async function loadFrozenP98Set(repoRoot: string): Promise<GradingP98CalibrationSet> {
  const jsonPath = path.join(repoRoot, GRADING_P98_JSON_REL);
  const raw = JSON.parse(await readFile(jsonPath, "utf8"));
  return GradingP98CalibrationSetSchema.parse(raw);
}

export async function refreezeP98Set(
  repoRoot: string,
  removals: GradingP98Removal[],
  frozenAt = new Date(),
): Promise<{ set: GradingP98CalibrationSet; jsonPath: string; deleted: number }> {
  const current = await loadFrozenP98Set(repoRoot);
  const pullIds = new Set(removals.map((row) => row.assetId));
  const records = current.records.filter((row) => !pullIds.has(row.assetId));
  const removed = [...(current.removed ?? []), ...removals];
  const notes = [
    "First P(9.8) calibration set. Intersection of positive EV at 0.10/0.20/0.30.",
    `Re-frozen ${frozenAt.toISOString()} after removing ${removals.length} reprint/original mismatch(es): ${removals.map((r) => r.canonicalName ?? r.assetId).join("; ")}.`,
    "Returned grades score against these frozen inputs. Not signals_normalized. Phase 2 off.",
  ].join(" ");
  const set = GradingP98CalibrationSetSchema.parse({
    ...current,
    setFrozenAt: frozenAt.toISOString(),
    recordCount: records.length,
    records,
    removed,
    provenance: {
      ...current.provenance,
      notes,
    },
  });
  const jsonPath = path.join(repoRoot, GRADING_P98_JSON_REL);
  await writeFile(jsonPath, `${JSON.stringify(set, null, 2)}\n`, "utf8");
  const db = getDb();
  let deleted = 0;
  for (const row of removals) {
    const result = await db.execute(sql`
      DELETE FROM vault_core.grading_p98_calibration
       WHERE set_key = ${GRADING_P98_SET_KEY}
         AND asset_id = ${row.assetId}::uuid
    `);
    deleted += result.rowCount ?? 0;
  }
  await db.execute(sql`
    UPDATE vault_core.grading_p98_calibration
       SET set_frozen_at = ${set.setFrozenAt}::timestamptz,
           prov_notes = ${notes}
     WHERE set_key = ${GRADING_P98_SET_KEY}
  `);
  return { set, jsonPath, deleted };
}

export function formatGradingP98Persist(args: {
  set: GradingP98CalibrationSet;
  jsonPath: string;
  inserted: number;
  alreadyFrozen: number;
}): string {
  const lines = args.set.records.map(
    (rec) =>
      `  ${rec.canonicalName ?? rec.assetId} raw=$${rec.rawUngraded.toFixed(2)} high=$${rec.highGrade.toFixed(2)} p10=$${rec.profitAtP10.toFixed(2)} flags=${rec.flags.join(" | ")}`,
  );
  const removed = (args.set.removed ?? []).map(
    (row) => `  REMOVED ${row.canonicalName ?? row.assetId} — ${row.reason}`,
  );
  return [
    `${GRADING_P98_SET_RULE} ${args.set.setKey} records=${args.set.recordCount} removed=${args.set.removed?.length ?? 0} phase2Enabled=${args.set.phase2Enabled}`,
    `json=${args.jsonPath} inserted=${args.inserted} alreadyFrozen=${args.alreadyFrozen}`,
    ...lines,
    ...removed,
  ].join("\n");
}
