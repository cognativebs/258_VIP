import { COMIC_GUIDE_LADDER } from "@vip/core-model";
import { closeDb } from "./db/client.js";
import { loadLocalEnv } from "./lib/loadEnv.js";
import {
  formatAssetCoverageReport,
  fetchPokemonVendorsLive,
  loadPokemonSealed,
  loadVendorProducts,
  runAssetCoverageDryRun,
} from "./lib/pricecharting/coverageDryRun.js";
import { formatPhaseBWriteReport, runPhaseBWrite } from "./lib/pricecharting/phaseBWrite.js";
import { formatSealedIngestReport, ingestOwnedSealed } from "./lib/pricecharting/sealedIngest.js";

loadLocalEnv();

async function main() {
  console.log("comic guide ladder CONFIRMED vs official API docs + public site:");
  for (const row of COMIC_GUIDE_LADDER) {
    console.log(`  ${row.vendorKey.padEnd(22)} -> ${row.conditionKey.padEnd(14)} ${row.grade}`);
  }
  console.log("");

  const write = await runPhaseBWrite((msg) => console.log(msg));
  console.log(formatPhaseBWriteReport(write));
  console.log("");

  const sealedIngest = await ingestOwnedSealed();
  console.log(formatSealedIngestReport(sealedIngest));
  console.log("");

  const sealed = await loadPokemonSealed();
  const snapshotPokemon = await loadVendorProducts("pokemon");
  const livePokemon = sealed.length ? await fetchPokemonVendorsLive(sealed) : [];
  const pokemonVendors = [...snapshotPokemon];
  const seen = new Set(pokemonVendors.map((v) => v.vendorProductId));
  for (const vendor of livePokemon) {
    if (seen.has(vendor.vendorProductId)) continue;
    seen.add(vendor.vendorProductId);
    pokemonVendors.push(vendor);
  }
  const sealedReport = await runAssetCoverageDryRun({
    vertical: "pokemon",
    slice: "pokemon-sealed",
    assets: sealed,
    vendors: pokemonVendors,
  });
  console.log(formatAssetCoverageReport(sealedReport.report));
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
