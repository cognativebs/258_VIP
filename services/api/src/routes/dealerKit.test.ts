import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../app.js";
import type { ComicsPayload } from "../lib/comicsHoldings.js";

function emptyComics(): ComicsPayload {
  return { available: true, holdings: [], snapshot: null, error: null, dsn: "fixture" };
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const deps: AppDeps = {
    loadComics: async () => emptyComics(),
    loadScanHoldings: async () => [],
  };
  const app = createApp(deps);
  const server = app.listen(0);
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  try {
    return await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const previousToken = process.env.PRICECHARTING_API_TOKEN;

beforeAll(() => {
  delete process.env.PRICECHARTING_API_TOKEN;
});

afterAll(() => {
  if (previousToken === undefined) delete process.env.PRICECHARTING_API_TOKEN;
  else process.env.PRICECHARTING_API_TOKEN = previousToken;
});

describe("dealer kit routes", () => {
  it("lists the five products and idle PriceCharting", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/tools/catalog`);
      const body = (await res.json()) as {
        version: string;
        pricecharting: { configured: boolean };
        products: { id: string; priceUsd: number }[];
      };
      expect(res.status).toBe(200);
      expect(body.version).toMatch(/^dealer-kit@/);
      expect(body.pricecharting.configured).toBe(false);
      expect(body.products.map((p) => p.id)).toEqual([
        "flip-score",
        "grading",
        "comp-check",
        "store",
        "course",
      ]);
      expect(body.products.map((p) => p.priceUsd)).toEqual([37, 19, 12, 147, 197]);
    });
  });

  it("scores a flip deal without inventing comps", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/tools/flip-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetName: "Test",
          ageYears: 20,
          popCount: 100,
          listingPrice: 50,
          asOf: "2026-09-13T15:00:00Z",
          comps: [
            { price: 90, saleDate: "2026-09-01", source: "ebay-sold" },
            { price: 95, saleDate: "2026-08-20", source: "ebay-sold" },
            { price: 88, saleDate: "2026-08-12", source: "ebay-sold" },
          ],
        }),
      });
      const body = (await res.json()) as { action: string; targetResaleLow: number; provenance: { verificationStatus: string } };
      expect(res.status).toBe(200);
      expect(body.action).toBe("buy_now");
      expect(body.targetResaleLow).toBeGreaterThan(0);
      expect(body.provenance.verificationStatus).toBe("unverified");
    });
  });

  it("returns ten example decisions", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/tools/flip-score/examples`);
      const body = (await res.json()) as { examples: unknown[] };
      expect(body.examples).toHaveLength(10);
    });
  });

  it("keeps PriceCharting idle without a token", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/tools/pricecharting?q=charizard`);
      const body = (await res.json()) as { idle: boolean; emptyReason: string; products: unknown[] };
      expect(res.status).toBe(200);
      expect(body.idle).toBe(true);
      expect(body.emptyReason).toMatch(/PRICECHARTING_API_TOKEN/);
      expect(body.products).toEqual([]);
    });
  });

  it("exports the grading spreadsheet", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/tools/export/grading-calculator.xls`);
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(text).toContain("Excel.Sheet");
      expect(text).toContain("PSA");
      expect(text).toContain("CGC");
      expect(text).toContain("BGS");
    });
  });
});
