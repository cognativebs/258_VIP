import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb } from "./db/client.js";
import { loadLocalEnv } from "./lib/loadEnv.js";
import { formatEraAuditReport, runEraGapAudit, type EraAuditRow } from "./lib/pricecharting/eraAudit.js";
import { formatGradingP98Persist, loadFrozenP98Set, refreezeP98Set } from "./lib/pricecharting/gradingCalibration.js";
import { formatPersistedComicCoverage, loadPersistedComicCoverage } from "./lib/pricecharting/persistedCoverage.js";

loadLocalEnv();

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function removalFromRow(row: EraAuditRow, removedAt: string) {
  return {
    assetId: row.assetId,
    canonicalName: row.canonicalName,
    reason: row.reason,
    removedAt,
    yearBegan: row.yearBegan,
    vendorProductName: row.vendorProductName,
    vendorYear: row.vendorYear,
  };
}

async function main() {
  const { report, trips } = await runEraGapAudit();
  console.log(formatEraAuditReport(report));
  console.log("");

  const coverage = await loadPersistedComicCoverage();
  console.log(formatPersistedComicCoverage(coverage, "subscriptionAfterEraAudit"));
  console.log("");

  const frozen = await loadFrozenP98Set(REPO_ROOT);
  const tripByAsset = new Map(trips.map((row) => [row.assetId, row]));
  const pulled = frozen.records
    .map((rec) => tripByAsset.get(rec.assetId))
    .filter((row): row is EraAuditRow => row != null);
  const remainingChecked = frozen.records.filter((rec) => !tripByAsset.has(rec.assetId));
  console.log("p98 remaining identity check:");
  for (const rec of remainingChecked) {
    console.log(`  KEEP ${rec.canonicalName ?? rec.assetId} year_began=${rec.yearBegan ?? "?"}`);
  }
  for (const row of pulled) {
    console.log(`  PULL ${row.canonicalName ?? row.assetId} ${row.reason}`);
  }

  const removedAt = new Date().toISOString();
  const { set, jsonPath, deleted } = await refreezeP98Set(
    REPO_ROOT,
    pulled.map((row) => removalFromRow(row, removedAt)),
  );
  console.log("");
  console.log(
    formatGradingP98Persist({
      set,
      jsonPath,
      inserted: 0,
      alreadyFrozen: set.recordCount,
    }),
  );
  console.log(`p98 db rows deleted=${deleted} phase2Enabled=false`);
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
