import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../app.js";
import type { ComicsPayload } from "../lib/comicsHoldings.js";
import { mapInventoryRow } from "../lib/holdings.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The manual intelligence store writes JSON. Point it at a temp file so a test
 * run never mutates the operator's dev state.
 */
let previousStatePath: string | undefined;

beforeAll(() => {
  previousStatePath = process.env.VIP_INTELLIGENCE_STATE;
  process.env.VIP_INTELLIGENCE_STATE = join(
    mkdtempSync(join(tmpdir(), "vip-intel-")),
    "state.json",
  );
});

afterAll(() => {
  if (previousStatePath === undefined) delete process.env.VIP_INTELLIGENCE_STATE;
  else process.env.VIP_INTELLIGENCE_STATE = previousStatePath;
});

function fixtureComics(count = 5): ComicsPayload {
  const rows = JSON.parse(
    readFileSync(join(here, "..", "seeds", "inventory-sample.json"), "utf8"),
  ) as Record<string, unknown>[];
  return {
    available: true,
    holdings: rows.slice(0, count).map(mapInventoryRow),
    snapshot: null,
    error: null,
    dsn: "fixture",
  };
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const deps: AppDeps = {
    loadComics: async () => fixtureComics(),
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

describe("GET /api/intelligence", () => {
  it("returns a versioned snapshot and never claims signals are live", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/intelligence`);
      const body = (await res.json()) as {
        version: string;
        signalsIngestion: { live: boolean; confirmed: boolean; blocks: string[] };
        phase2: { scoringEnabled: boolean };
        collection: { binder: { pageChaseCompletion: { available: boolean } } };
      };
      expect(res.status).toBe(200);
      expect(body.version).toMatch(/^intelligence@/);
      expect(body.signalsIngestion.live).toBe(false);
      expect(body.signalsIngestion.confirmed).toBe(false);
      expect(body.signalsIngestion.blocks).toContain("market_cycle_detector");
      // Phase 2 scoring must stay off until signals_raw is confirmed live.
      expect(body.phase2.scoringEnabled).toBe(false);
      // Page-level chase completion is unbuilt, and says so rather than faking.
      expect(body.collection.binder.pageChaseCompletion.available).toBe(false);
    });
  });

  it("reports calibration per model version over resolved predictions", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/intelligence/predictions`);
      const body = (await res.json()) as {
        calibration: {
          modelVersion: string;
          resolvedCount: number;
          directionalAccuracyPct: number | null;
        }[];
        needsScoring: unknown[];
      };
      expect(res.status).toBe(200);
      expect(Array.isArray(body.calibration)).toBe(true);
      expect(body.calibration[0]?.resolvedCount).toBeGreaterThan(0);
      expect(Array.isArray(body.needsScoring)).toBe(true);
    });
  });
});

describe("prediction ledger writes", () => {
  it("stores a prediction with a computed resolvesAt and refuses to score it early", async () => {
    await withServer(async (base) => {
      const create = await fetch(`${base}/api/intelligence/predictions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          priceAtPrediction: 230,
          horizonDays: 90,
          probabilityDown: 0.55,
          probabilitySideways: 0.3,
          probabilityUp: 0.15,
          assumptions: "route test",
        }),
      });
      expect(create.status).toBe(201);
      const { prediction } = (await create.json()) as {
        prediction: { id: string; resolvesAt: string; predictedAt: string; resolvedAt: null };
      };
      const horizonMs =
        new Date(prediction.resolvesAt).getTime() -
        new Date(prediction.predictedAt).getTime();
      expect(Math.round(horizonMs / 86_400_000)).toBe(90);
      expect(prediction.resolvedAt).toBeNull();

      // There is deliberately no early-resolve override: a 90-day call cannot be
      // graded today just because the operator wants a number.
      const early = await fetch(
        `${base}/api/intelligence/predictions/${prediction.id}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actualPrice: 180, explanation: "too soon" }),
        },
      );
      expect(early.status).toBe(400);
      expect(((await early.json()) as { error: string }).error).toMatch(/resolvesAt/i);
    });
  });

  it("rejects a probability distribution that does not sum to 1, readably", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/intelligence/predictions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          priceAtPrediction: 10,
          horizonDays: 30,
          probabilityDown: 0.9,
          probabilitySideways: 0.9,
          probabilityUp: 0.9,
        }),
      });
      expect(res.status).toBe(400);
      const { error } = (await res.json()) as { error: string };
      // The desk renders this string; it must not be raw zod JSON.
      expect(error).toMatch(/must sum to ~1\.0 \(got 2\.7\)/);
      expect(error).not.toMatch(/[{[]/);
    });
  });

  it("requires actualPrice to resolve", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/intelligence/predictions/nope/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/actualPrice/);
    });
  });
});

describe("manual watch surfaces", () => {
  it("labels print life and emerging markets as unscored", async () => {
    await withServer(async (base) => {
      for (const path of [
        "/api/intelligence/print-life",
        "/api/intelligence/emerging-markets",
      ]) {
        const res = await fetch(`${base}${path}`);
        const body = (await res.json()) as { scoringEnabled: boolean };
        expect(res.status).toBe(200);
        expect(body.scoringEnabled).toBe(false);
      }
    });
  });

  it("serves emerging hunts flagged as suggestions, separate from /api/hunts", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/hunts/emerging`);
      const body = (await res.json()) as {
        hunts: { id: string; suggestion?: boolean; metrics: unknown }[];
      };
      expect(res.status).toBe(200);
      expect(body.hunts.length).toBeGreaterThan(0);
      expect(body.hunts.some((h) => h.id === "carla-cohen")).toBe(true);
      expect(body.hunts.every((h) => h.metrics != null)).toBe(true);

      // The adopted hunts endpoint must not have absorbed the suggestions.
      const adopted = await fetch(`${base}/api/hunts`);
      const adoptedBody = (await adopted.json()) as { hunts: { id: string }[] };
      expect(adoptedBody.hunts.some((h) => h.id === "carla-cohen")).toBe(false);
    });
  });
});

describe("GET /api/sell-queue/dogfood", () => {
  it("ranks with grading EV and marks stale evidence without touching /api/sell-queue", async () => {
    const prevFixture = process.env.VIP_COMPS_USE_FIXTURE;
    const prevJson = process.env.VIP_COMPS_FIXTURE_JSON;
    process.env.VIP_COMPS_USE_FIXTURE = "1";
    process.env.VIP_COMPS_FIXTURE_JSON = "[]";
    try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/sell-queue/dogfood`);
      const body = (await res.json()) as {
        note: string;
        count: number;
        items: {
          isStale: boolean;
          gradingRecommendation: string;
          compsSource: string;
          dogfoodNote: string;
        }[];
      };
      expect(res.status).toBe(200);
      expect(body.note).toMatch(/not treated as verified/i);
      expect(body.count).toBeGreaterThan(0);
      // Fixture comics have no live comps, so evidence must read as stale.
      expect(body.items[0]?.isStale).toBe(true);
      expect(body.items[0]?.compsSource).toBe("none");
      expect(body.items[0]?.dogfoodNote).toMatch(/stale/i);
    });
    } finally {
      if (prevFixture === undefined) delete process.env.VIP_COMPS_USE_FIXTURE;
      else process.env.VIP_COMPS_USE_FIXTURE = prevFixture;
      if (prevJson === undefined) delete process.env.VIP_COMPS_FIXTURE_JSON;
      else process.env.VIP_COMPS_FIXTURE_JSON = prevJson;
    }
  });
});
