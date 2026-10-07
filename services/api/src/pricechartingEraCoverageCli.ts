import { closeDb } from "./db/client.js";
import { loadLocalEnv } from "./lib/loadEnv.js";
import {
  formatVendorYearCoverage,
  loadConfirmedEraMaps,
  summarizeVendorYearCoverage,
} from "./lib/pricecharting/eraAudit.js";

loadLocalEnv();

async function main() {
  const rows = await loadConfirmedEraMaps();
  console.log(formatVendorYearCoverage(summarizeVendorYearCoverage(rows)));
  console.log("phase2Enabled=false");
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
