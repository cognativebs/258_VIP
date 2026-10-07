import { COMIC_GUIDE_LADDER } from "@vip/core-model";
import { loadLocalEnv } from "./lib/loadEnv.js";
import {
  fetchPokemonVendorsLive,
  formatAssetCoverageReport,
  loadComicAssets,
  loadPokemonSealed,
  loadPokemonSingles,
  loadVendorProducts,
  runAssetCoverageDryRun,
} from "./lib/pricecharting/coverageDryRun.js";

loadLocalEnv();

async function main() {
  console.log("comic guide ladder (Phase B will not collapse graded columns to raw_ungraded):");
  for (const row of COMIC_GUIDE_LADDER) {
    console.log(`  ${row.vendorKey.padEnd(22)} -> ${row.conditionKey.padEnd(14)} ${row.grade}`);
  }
  console.log("");

  const comicAssets = await loadComicAssets();
  const comicVendors = await loadVendorProducts("comic");
  const comics = await runAssetCoverageDryRun({
    vertical: "comic",
    slice: "comics-holdings",
    assets: comicAssets,
    vendors: comicVendors,
  });
  console.log(formatAssetCoverageReport(comics.report));
  console.log("");

  const singles = await loadPokemonSingles();
  const sealed = await loadPokemonSealed();
  const snapshotPokemon = await loadVendorProducts("pokemon");
  const livePokemon =
    singles.length || sealed.length
      ? await fetchPokemonVendorsLive([...singles, ...sealed])
      : [];
  const pokemonVendors = [...snapshotPokemon];
  const seenVendor = new Set(pokemonVendors.map((v) => v.vendorProductId));
  for (const vendor of livePokemon) {
    if (seenVendor.has(vendor.vendorProductId)) continue;
    seenVendor.add(vendor.vendorProductId);
    pokemonVendors.push(vendor);
  }
  const singlesReport = await runAssetCoverageDryRun({
    vertical: "pokemon",
    slice: "pokemon-singles",
    assets: singles,
    vendors: pokemonVendors,
  });
  console.log(formatAssetCoverageReport(singlesReport.report));
  console.log("");
  const sealedReport = await runAssetCoverageDryRun({
    vertical: "pokemon",
    slice: "pokemon-sealed",
    assets: sealed,
    vendors: pokemonVendors,
  });
  console.log(formatAssetCoverageReport(sealedReport.report));
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
