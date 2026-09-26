import { describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../app.js";
import { memoryUnknownExitStore } from "../lib/unknownExit.js";
import type { ComicsPayload } from "../lib/comicsHoldings.js";

function emptyComics(): ComicsPayload {
  return { available: true, holdings: [], snapshot: null, error: null, dsn: "fixture" };
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const deps: AppDeps = {
    loadComics: async () => emptyComics(),
    loadScanHoldings: async () => [],
    unknownExitStore: memoryUnknownExitStore(),
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

describe("unknown-exit routes", () => {
  it("starts with no event and a catalog range preview", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/comics/unknown-exit`);
      const body = (await res.json()) as {
        ok: boolean;
        event: null;
        catalog: { scopeHoldings: number; scopeValue: number };
      };
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.event).toBeNull();
      expect(body.catalog.scopeHoldings).toBe(1044);
      expect(body.catalog.scopeValue).toBe(3640);
    });
  });

  it("records an inferred giveaway without inventing titles", async () => {
    await withServer(async (base) => {
      const bad = await fetch(`${base}/api/comics/unknown-exit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estimatedQty: 1000,
          titlesRecorded: true,
          acknowledgeUnknownTitles: true,
        }),
      });
      expect(bad.status).toBe(400);

      const res = await fetch(`${base}/api/comics/unknown-exit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estimatedQty: 1000,
          titlesRecorded: false,
          acknowledgeUnknownTitles: true,
          recipientNote: "School custodian gift",
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        outputAction: string;
        event: { titlesRecorded: boolean; holdingsTouched: boolean; estimatedQty: number };
        impact: {
          physicalValueLow: number;
          physicalValueHigh: number;
          titlesInvented: boolean;
          recommendations: { action: string }[];
        };
      };
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.outputAction).toBe("Pass");
      expect(body.event.titlesRecorded).toBe(false);
      expect(body.event.holdingsTouched).toBe(false);
      expect(body.event.estimatedQty).toBe(1000);
      expect(body.impact.titlesInvented).toBe(false);
      expect(body.impact.physicalValueHigh).toBe(24238);
      expect(body.impact.physicalValueLow).toBeLessThan(24238);
      expect(body.impact.recommendations.map((r) => r.action)).toEqual(["Pass", "Hold"]);
    });
  });
});
