import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb } from "./db/client.js";
import { loadLocalEnv } from "./lib/loadEnv.js";
import { persistGradingP98Set, calibrationSetFromArbitrage, formatGradingP98Persist } from "./lib/pricecharting/gradingCalibration.js";
import {
  formatMapIntegrityReport,
  formatSuspectIdentity,
  identityFromRow,
  pickLargestNegativeGap,
  runMapIntegrityAudit,
} from "./lib/pricecharting/mapIntegrity.js";
import { formatPersistedComicCoverage, loadPersistedComicCoverage } from "./lib/pricecharting/persistedCoverage.js";
import { loadPhaseDContext } from "./lib/pricecharting/phaseD.js";

loadLocalEnv();

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

async function main() {
  const { report, trips } = await runMapIntegrityAudit();
  console.log(formatMapIntegrityReport(report));
  console.log("");

  const suspect = pickLargestNegativeGap(trips);
  if (suspect) console.log(formatSuspectIdentity(identityFromRow(suspect)));
  console.log("");

  const coverage = await loadPersistedComicCoverage();
  console.log(formatPersistedComicCoverage(coverage, "subscriptionAfterMapIntegrity"));
  console.log("");

  const phaseD = await loadPhaseDContext();
  const set = calibrationSetFromArbitrage(phaseD.gradingArbitrage, new Date());
  const persist = await persistGradingP98Set(set, REPO_ROOT);
  console.log(formatGradingP98Persist({ set, ...persist }));
  console.log(`phase2Enabled=${phaseD.phase2Enabled}`);
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
