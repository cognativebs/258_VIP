import { closeDb } from "./db/client.js";
import { loadLocalEnv } from "./lib/loadEnv.js";
import { classifyComicMatches } from "./lib/pricecharting/phaseBWrite.js";
import { formatPhaseDContext, loadPhaseDContext } from "./lib/pricecharting/phaseD.js";
import {
  formatAssetCoverageReport,
  loadComicAssets,
  loadVendorProducts,
  runAssetCoverageDryRun,
} from "./lib/pricecharting/coverageDryRun.js";
import { formatVolumeAuditReport, runVolumeCollapseAudit } from "./lib/pricecharting/volumeAudit.js";

loadLocalEnv();

async function main() {
  const audit = await runVolumeCollapseAudit();
  console.log(formatVolumeAuditReport(audit));
  console.log("");

  const comicAssets = await loadComicAssets();
  const comicVendors = await loadVendorProducts("comic");
  const comics = await runAssetCoverageDryRun({
    vertical: "comic",
    slice: "comics-holdings-variant-rerun",
    assets: comicAssets,
    vendors: comicVendors,
  });
  const split = classifyComicMatches(comics.matches);
  console.log(formatAssetCoverageReport(comics.report));
  console.log(
    `variantSplit unambiguous=${split.unambiguous.length} ambiguous=${split.ambiguous.length} unmatched=${split.unmatched.length} afterIssue21Plus=${split.afterIssue21Plus.length}`,
  );
  console.log("");

  const phaseD = await loadPhaseDContext();
  console.log(formatPhaseDContext(phaseD));
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
