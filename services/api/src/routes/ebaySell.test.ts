import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createEbaySellService } from "../lib/ebaySell/service.js";
import { createMemoryEbaySellStore } from "../lib/ebaySell/store.js";
import { mapInventoryRow } from "../lib/holdings.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function fixtureHoldings() {
  const rows = JSON.parse(
    readFileSync(join(here, "..", "seeds", "inventory-sample.json"), "utf8"),
  ) as Record<string, unknown>[];
  return rows.slice(0, 8).map(mapInventoryRow);
}

async function withSellServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const holdings = fixtureHoldings();
  const app = createApp({
    loadComics: async () => ({
      available: true,
      holdings,
      snapshot: null,
      error: null,
      dsn: "fixture",
    }),
    loadScanHoldings: async () => [],
    ebaySellService: createEbaySellService({ store: createMemoryEbaySellStore() }),
  });
  const server = app.listen(0);
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("eBay sell routes", () => {
  it("reports idle sell health and a dashboard without faking a connection", async () => {
    await withSellServer(async (base) => {
      const health = await fetch(`${base}/api/ebay/sell/health`);
      const body = (await health.json()) as {
        status: { connected: boolean; mode: string };
        canPublish: boolean;
      };
      expect(health.status).toBe(200);
      expect(body.status.connected).toBe(false);
      expect(body.canPublish).toBe(false);

      const dash = await fetch(`${base}/api/ebay/sell/dashboard`);
      const dashBody = (await dash.json()) as { connection: { canPublish: boolean }; cards: { activeListings: number } };
      expect(dash.status).toBe(200);
      expect(dashBody.connection.canPublish).toBe(false);
      expect(dashBody.cards.activeListings).toBe(0);
    });
  });

  it("creates a reviewable draft from a real fixture holding", async () => {
    await withSellServer(async (base) => {
      const inv = await fetch(`${base}/api/inventory`);
      const invBody = (await inv.json()) as { holdings: { id: string }[] };
      const id = invBody.holdings[0]?.id;
      expect(id).toBeTruthy();
      const draft = await fetch(`${base}/api/ebay/sell/item/${id}/draft`, { method: "POST" });
      const body = (await draft.json()) as {
        listing: { status: string; sku: string };
        payload: { publishBlockedReasons: string[] };
      };
      expect(draft.status).toBe(200);
      expect(body.listing.status).toBe("READY_FOR_REVIEW");
      expect(body.listing.sku.startsWith("IQV-")).toBe(true);
    });
  });
});
