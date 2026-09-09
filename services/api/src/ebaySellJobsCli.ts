/**
 * Independent eBay sell sync jobs.
 * Traffic failures must not break order processing — they are separate commands.
 */
import type { SellPreflightReport } from "@vip/ebay-sell";
import { createEbaySellService } from "./lib/ebaySell/service.js";
import { createPostgresEbaySellStore } from "./lib/ebaySell/store.js";
import { loadComicsHoldings } from "./lib/comicsHoldings.js";

const cmd = process.argv[2] ?? "order-sync";

const MARK: Record<SellPreflightReport["checks"][number]["status"], string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  skip: "SKIP",
};

export function formatPreflight(report: SellPreflightReport): string {
  const lines = [
    `eBay Sell preflight · ${report.environment} · ${report.marketplaceId} · ${report.ranAt.toISOString()}`,
    "",
  ];
  for (const check of report.checks) {
    lines.push(`[${MARK[check.status]}] ${check.label}`);
    lines.push(`       ${check.detail}`);
    if (check.fix && check.status !== "pass") lines.push(`       fix: ${check.fix}`);
  }
  lines.push("");
  lines.push(
    report.ok
      ? `READY — ${report.warnings} warning(s), ${report.skipped} unverified.`
      : `BLOCKED — ${report.failures} failure(s), ${report.warnings} warning(s), ${report.skipped} unverified.`,
  );
  return lines.join("\n");
}

async function main() {
  const service = createEbaySellService({ store: createPostgresEbaySellStore() });
  const comics = await loadComicsHoldings();
  const holdings = comics.holdings;
  if (cmd === "listing-sync") {
    const result = await service.syncListingStates();
    console.log(JSON.stringify({ job: "listing-sync", ...result }, null, 2));
    return;
  }
  if (cmd === "order-sync") {
    const result = await service.syncOrders(holdings);
    console.log(JSON.stringify({ job: "order-sync", ...result }, null, 2));
    return;
  }
  if (cmd === "traffic-sync") {
    const result = await service.syncTraffic();
    console.log(JSON.stringify({ job: "traffic-sync", ...result }, null, 2));
    return;
  }
  if (cmd === "preflight") {
    const report = await service.preflight(holdings, process.argv[3] ?? null);
    console.log(formatPreflight(report));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  console.error(`Unknown job: ${cmd}`);
  process.exit(1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
