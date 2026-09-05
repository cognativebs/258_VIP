/**
 * Independent eBay sell sync jobs.
 * Traffic failures must not break order processing — they are separate commands.
 */
import { createEbaySellService } from "./lib/ebaySell/service.js";
import { createPostgresEbaySellStore } from "./lib/ebaySell/store.js";
import { loadComicsHoldings } from "./lib/comicsHoldings.js";

const cmd = process.argv[2] ?? "order-sync";

async function main() {
  const service = createEbaySellService({ store: createPostgresEbaySellStore() });
  const comics = await loadComicsHoldings();
  const holdings = comics.holdings;
  if (cmd === "listing-sync") {
    const health = await service.connection();
    console.log(JSON.stringify({ job: "listing-sync", ...health }, null, 2));
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
  console.error(`Unknown job: ${cmd}`);
  process.exit(1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
