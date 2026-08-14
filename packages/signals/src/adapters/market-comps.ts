import type {
  MarketCompsBundle,
  MarketCompsQuery,
  PricingSeamResult,
  RawEbayBrowseSnapshot,
} from "../schemas/ebay-browse.js";

/**
 * Swap seam for live market comps.
 *
 * v0.1: EbayBrowseAdapter — active listings + count as liquidity proxy
 * later: paid sold-comp aggregator (130point, etc.) behind the same interface
 *
 * Contract: fetch → immutable raw snapshot → normalize. Never invent sales.
 * Active asks must stay labeled inferred · not sold.
 */
export interface MarketCompsAdapter {
  readonly id: string;

  /** Live fetch → immutable snapshot on disk. */
  fetchAndSnapshot(query: MarketCompsQuery, now?: Date): Promise<RawEbayBrowseSnapshot>;

  /** Parse snapshot without network — regenerable from raw file alone. */
  parseSnapshot(snapshot: RawEbayBrowseSnapshot): MarketCompsBundle;

  /** Convenience: fetch + normalize in one call. */
  search(query: MarketCompsQuery, now?: Date): Promise<MarketCompsBundle>;
}

/** Map normalized bundle → demo / VaultOS getPricing() contract. */
export function toPricingSeamResult(bundle: MarketCompsBundle): PricingSeamResult {
  const mid = bundle.mid ?? (bundle.matchedAsks > 0 ? (bundle.low + bundle.high) / 2 : 0);
  return {
    marketValue: Number(mid.toFixed(2)),
    low: bundle.low,
    high: bundle.high,
    comps: bundle.asks
      .filter((a) => a.quarantineStatus === "active")
      .slice(0, 8)
      .map((a) => ({
        price: a.price,
        date: `ask · ${a.observedAt.slice(0, 10)}`,
        title: a.title.slice(0, 80),
      })),
    source: bundle.sourceLabel,
    confidence: Math.round(bundle.provenance.confidence * 100),
    liquidityProxy: bundle.liquidity,
    provenance: bundle.provenance,
  };
}
