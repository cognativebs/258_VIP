/**
 * Periodic eBay Browse comps job — active asks + listing-count liquidity proxy.
 *
 * Env:
 *   EBAY_OAUTH_TOKEN or EBAY_APP_ID + EBAY_CERT_ID
 *   EBAY_ENVIRONMENT=production|sandbox
 *   VIP_EBAY_QUERY — search string (or pass --query=)
 *   VIP_EBAY_FIXTURE — offline JSON path (skips HTTP)
 *   VIP_EBAY_COMPS_FEED — output path (default .state/ebay-comps-feed.json)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EbayBrowseAdapter,
  defaultSourcesStatePath,
  isSourceActive,
  toPricingSeamResult,
  type MarketCompsBundle,
} from "@vip/signals";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", ".state");
const SNAPSHOT_DIR = join(STATE_DIR, "snapshots");
const DEFAULT_FEED = join(STATE_DIR, "ebay-comps-feed.json");
const DEFAULT_FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "packages",
  "signals",
  "src",
  "adapters",
  "fixtures",
  "ebay-browse-charizard-sample.json",
);

export type EbayBrowseCompsJobResult = {
  runId: string;
  ranAt: string;
  query: string;
  bundle: MarketCompsBundle;
  feedPath: string;
  snapshotPath: string | null;
  mode: "live" | "fixture";
};

function parseQuery(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith("--query="));
  if (flag) return flag.slice("--query=".length).trim();
  return (process.env.VIP_EBAY_QUERY ?? "").trim();
}

export async function runEbayBrowseCompsJob(opts?: {
  query?: string;
  assetRef?: string;
  triggeredBy?: string;
  argv?: string[];
}): Promise<EbayBrowseCompsJobResult> {
  const ranAt = new Date().toISOString();
  const runId = `ebay-browse-${ranAt.replace(/[:.]/g, "-")}`;
  const query = (opts?.query ?? parseQuery(opts?.argv ?? process.argv.slice(2))).trim();
  if (!query) {
    throw new Error("ebay-browse-comps: set VIP_EBAY_QUERY or pass --query=\"...\"");
  }

  const feedPath = process.env.VIP_EBAY_COMPS_FEED ?? DEFAULT_FEED;
  const sourcesState = defaultSourcesStatePath(feedPath);
  mkdirSync(dirname(feedPath), { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  if (!isSourceActive("ebay-browse", { defaultActive: true, statePath: sourcesState })) {
    throw new Error("ebay-browse-comps: source ebay-browse is inactive");
  }

  const adapter = EbayBrowseAdapter.fromEnv({
    snapshotDir: SNAPSHOT_DIR,
    rateLimitMs: Number(process.env.VIP_EBAY_RATE_LIMIT_MS ?? 1000),
  });

  const fixturePath = process.env.VIP_EBAY_FIXTURE;
  let bundle: MarketCompsBundle;
  let snapshotPath: string | null = null;
  let mode: "live" | "fixture" = "live";

  if (fixturePath || (!process.env.EBAY_OAUTH_TOKEN && !process.env.EBAY_APP_ID)) {
    const path = fixturePath && existsSync(fixturePath) ? fixturePath : DEFAULT_FIXTURE;
    mode = "fixture";
    const rawJson = readFileSync(path, "utf8");
    const snap = adapter.writeSnapshot({
      url: `fixture://${path}`,
      query,
      assetRef: opts?.assetRef ?? null,
      rawJson,
      now: new Date(ranAt),
    });
    snapshotPath = snap.snapshotPath;
    bundle = adapter.parseSnapshot(snap);
  } else {
    const snap = await adapter.fetchAndSnapshot(
      { query, assetRef: opts?.assetRef },
      new Date(ranAt),
    );
    snapshotPath = snap.snapshotPath;
    bundle = adapter.parseSnapshot(snap);
  }

  const pricing = toPricingSeamResult(bundle);
  const feed = {
    schema: "vip_ebay_comps_feed_v1" as const,
    writtenAt: ranAt,
    runId,
    job: "ebay-browse-comps",
    triggeredBy: opts?.triggeredBy ?? "cli",
    mode,
    query,
    assetRef: bundle.assetRef ?? null,
    pricing,
    liquidity: bundle.liquidity,
    provenance: bundle.provenance,
    matchedAsks: bundle.matchedAsks,
    asks: bundle.asks.filter((a) => a.quarantineStatus === "active").slice(0, 50),
    notes:
      "Active asks from eBay Browse — not Marketplace Insights sold comps. Swap MarketCompsAdapter for sold aggregator later.",
  };

  writeFileSync(feedPath, JSON.stringify(feed, null, 2), "utf8");

  return { runId, ranAt, query, bundle, feedPath, snapshotPath, mode };
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
