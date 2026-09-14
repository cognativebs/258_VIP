/**
 * Retired: eBay Browse asks are not a valuation source (2026-09-14).
 * Comics LIVE uses PriceCharting. This job must not call eBay.
 */
import type { MarketCompsBundle } from "@vip/signals";

export type EbayBrowseCompsJobResult = {
  runId: string;
  ranAt: string;
  query: string;
  bundle: MarketCompsBundle;
  feedPath: string;
  snapshotPath: string | null;
  mode: "live" | "fixture";
};

export async function runEbayBrowseCompsJob(_opts?: {
  query?: string;
  assetRef?: string;
  triggeredBy?: string;
  argv?: string[];
}): Promise<EbayBrowseCompsJobResult> {
  throw new Error("ebay-browse-comps: eBay asks are not a valuation source");
}

export function formatEbayBrowseReport(result: EbayBrowseCompsJobResult): string {
  const { bundle, mode, feedPath } = result;
  return [
    `ebay-browse-comps (${mode})`,
    `  query: ${result.query}`,
    `  asks: ${bundle.matchedAsks} sampled · total listed ${bundle.liquidity.activeListingCount}`,
    `  range: $${bundle.low} – $${bundle.high}` +
      (bundle.mid != null ? ` (mid $${bundle.mid})` : ""),
    `  liquidity proxy: ${bundle.liquidity.band} (${bundle.liquidity.score})`,
    `  confidence: ${bundle.provenance.confidence} · ${bundle.provenance.verificationStatus}`,
    `  feed: ${feedPath}`,
  ].join("\n");
}
