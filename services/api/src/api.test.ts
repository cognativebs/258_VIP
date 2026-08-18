import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { writeSignalsFeed } from "./lib/signalsFeed.js";

const tmpFeed = join(dirname(fileURLToPath(import.meta.url)), "..", ".tmp-test-signals-feed.json");
const tmpIntel = join(dirname(fileURLToPath(import.meta.url)), "..", ".tmp-intelligence-state.json");

beforeEach(() => {
  process.env.VIP_INTELLIGENCE_STATE = tmpIntel;
});

afterEach(() => {
  delete process.env.VIP_SIGNALS_FEED;
  delete process.env.VIP_INTELLIGENCE_STATE;
});

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = createApp();
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

describe("VIP API", () => {
  it("serves inventory with provenance on holdings", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/inventory`);
      const body = (await res.json()) as {
        holdings: { provenance: { method: string } }[];
      };
      expect(res.status).toBe(200);
      expect(body.holdings.length).toBeGreaterThan(0);
      expect(body.holdings[0]?.provenance.method).toBeTruthy();
    });
  });

  it("recommendations include range + opposing evidence", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/recommendations?limit=3`);
      const body = (await res.json()) as {
        recommendations: {
          supportingEvidence: unknown[];
          opposingEvidence: unknown[];
          marketRange: unknown;
          evidenceCard: { isStale: boolean; evidence: unknown[] };
        }[];
      };
      expect(body.recommendations[0]?.supportingEvidence.length).toBeGreaterThan(0);
      expect(body.recommendations[0]?.opposingEvidence.length).toBeGreaterThan(0);
      expect(body.recommendations[0]?.marketRange).toBeTruthy();
      expect(body.recommendations[0]?.evidenceCard.evidence.length).toBeGreaterThan(0);
      expect(typeof body.recommendations[0]?.evidenceCard.isStale).toBe("boolean");
    });
  });

  it("hunts include Absolute Batman + Pokémon seeds", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/hunts`);
      const body = (await res.json()) as { hunts: { id: string }[] };
      const ids = body.hunts.map((h) => h.id);
      expect(ids).toContain("absolute-batman");
      expect(ids).toContain("pokemon-30th");
      expect(ids).toContain("carla-cohen");
      expect(ids).toContain("one-piece-female");
      expect(ids).toContain("gundam");
      expect(ids).toContain("lorcana");
      expect(ids).toContain("print-life-swsh");
      expect(ids).toContain("modern-cover-artists");
      const cohen = body.hunts.find((h) => h.id === "carla-cohen") as { name?: string };
      expect(cohen?.name).toMatch(/Museum/);
    });
  });

  it("inventory includes TCG holdings with externalIds (Binder and/or seeds)", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/inventory`);
      const body = (await res.json()) as {
        tcgSource?: string;
        holdings: { externalIds?: { source: string; externalValue: string }[] }[];
      };
      expect(res.status).toBe(200);
      const withExt = body.holdings.filter((h) => (h.externalIds?.length ?? 0) > 0);
      expect(withExt.length).toBeGreaterThanOrEqual(1);
      expect(body.tcgSource).toBeTruthy();
      // Seeds remain available when Binder DB is empty or VIP_INCLUDE_POKEMON_SEEDS=1
      if (body.tcgSource === "pokemon_seeds" || body.tcgSource === "binder+seeds") {
        expect(withExt.some((h) => h.externalIds?.[0]?.externalValue === "base1-4")).toBe(true);
      }
    });
  });

  it("serves /api/tcg/binders summary", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/tcg/binders`);
      const body = (await res.json()) as {
        available: boolean;
        binders: unknown[];
        dbPath: string;
      };
      expect(res.status).toBe(200);
      expect(typeof body.available).toBe("boolean");
      expect(Array.isArray(body.binders)).toBe(true);
      expect(body.dbPath).toBeTruthy();
    });
  });

  it("signals prefer job feed over seeds", async () => {
    mkdirSync(dirname(tmpFeed), { recursive: true });
    writeSignalsFeed(tmpFeed, {
      schema: "vip_signals_feed_v1",
      writtenAt: "2026-08-02T12:00:00.000Z",
      runId: "run-test",
      job: "pokemon-drops",
      provenance: {
        source: "pokemon-drops-job",
        method: "pipeline",
        ruleOrModelVersion: "signals@0.1.0",
        verificationStatus: "unverified",
      },
      signals: [
        {
          id: "from-feed",
          signalType: "retail",
          body: "Feed signal for API test",
          sourceUrl: null,
          signalDate: "2026-08-02",
          quarantineStatus: "active",
        },
      ],
    });
    process.env.VIP_SIGNALS_FEED = tmpFeed;

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/signals`);
      const body = (await res.json()) as {
        source: string;
        signals: { id: string; body: string }[];
      };
      expect(body.source).toBe("job_feed");
      expect(body.signals[0]?.id).toBe("from-feed");
      expect(body.signals[0]?.body).toContain("Feed signal");
    });
  });

  it("GET /api/sources returns @vip/signals registry entries", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/sources`);
      const body = (await res.json()) as {
        sources: { id: string; label: string; active: boolean; stats?: { signalCount?: number } }[];
      };
      expect(res.status).toBe(200);
      expect(body.sources.some((s) => s.id === "pokemon-news-rss")).toBe(true);
      const news = body.sources.find((s) => s.id === "pokemon-news-rss");
      expect(news?.label).toBeTruthy();
      expect(typeof news?.active).toBe("boolean");
      expect(news?.stats).toBeTruthy();
    });
  });

  it("PATCH /api/sources/:id persists active toggle", async () => {
    const statePath = join(dirname(tmpFeed), "sources-state-api-test.json");
    process.env.VIP_SOURCES_STATE = statePath;
    await withServer(async (base) => {
      const patch = await fetch(`${base}/api/sources/pokemon-news-rss`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      expect(patch.status).toBe(200);
      const after = (await (await fetch(`${base}/api/sources`)).json()) as {
        sources: { id: string; active: boolean }[];
      };
      expect(after.sources.find((s) => s.id === "pokemon-news-rss")?.active).toBe(false);
      await fetch(`${base}/api/sources/pokemon-news-rss`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
    });
    delete process.env.VIP_SOURCES_STATE;
  });

  it("GET /api/intelligence serves Phase 1 fixtures and keeps Phase 2 blocked", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/intelligence`);
      const body = (await res.json()) as {
        version: string;
        signalsIngestion: { live: boolean; blocks: string[] };
        predictions: { open: { priceAtPrediction: number }[]; calibration: unknown[] };
        recommendations: { action: string; isStale: boolean; evidence: unknown[] }[];
        underwriting: { acquisitionCoverageRatio: number; blocked: boolean }[];
        grading: { flareon: { recommendation: string } };
        phase2: { scoringEnabled: boolean };
      };
      expect(res.status).toBe(200);
      expect(body.version).toMatch(/^intelligence@/);
      expect(body.signalsIngestion.live).toBe(false);
      expect(body.signalsIngestion.blocks).toContain("market_cycle_detector");
      expect(body.predictions.open[0]?.priceAtPrediction).toBe(230);
      expect(body.predictions.calibration.length).toBeGreaterThan(0);
      expect(body.recommendations[0]?.action).toBe("buy");
      expect(body.recommendations[0]?.evidence.length).toBeGreaterThan(0);
      expect(body.underwriting[0]?.acquisitionCoverageRatio).toBe(1.493);
      expect(body.underwriting[0]?.blocked).toBe(false);
      expect(body.grading.flareon.recommendation).toBe("grade");
      expect(body.phase2.scoringEnabled).toBe(false);
    });
  });

  it("POST /api/intelligence/predictions persists a frozen forecast", async () => {
    await withServer(async (base) => {
      const created = await fetch(`${base}/api/intelligence/predictions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetId: "test-sir",
          priceAtPrediction: 50,
          horizonDays: 30,
          probabilityDown: 0.4,
          probabilitySideways: 0.4,
          probabilityUp: 0.2,
        }),
      });
      expect(created.status).toBe(201);
      const body = (await created.json()) as { prediction: { priceAtPrediction: number } };
      expect(body.prediction.priceAtPrediction).toBe(50);
    });
  });

  it("POST /api/intelligence/cohen-score marks Ivy #9 buy-cheap", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/intelligence/cohen-score`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Poison Ivy #9 Harley/Ivy",
          artistSignificance: 9,
          characterStrength: 9,
          imageIconicity: 10,
          historicalImportance: 7,
          trueScarcity: 3,
          entryPrice: 10,
          variantDilutionPenalty: 3,
        }),
      });
      const body = (await res.json()) as { score: { action: string } };
      expect(res.status).toBe(200);
      expect(body.score.action).toBe("buy_cheap");
    });
  });

  it("GET /api/sell-queue dogfoods grading + evidence freshness", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/sell-queue`);
      const body = (await res.json()) as {
        items: { dogfoodNote: string; gradingRecommendation: string; holding: { id: string } }[];
      };
      expect(res.status).toBe(200);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items[0]?.gradingRecommendation).toBeTruthy();
      expect(body.items[0]?.dogfoodNote).toBeTruthy();
    });
  });

  it("GET /api/signals includes signalsIngestion gate", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/signals`);
      const body = (await res.json()) as {
        signalsIngestion?: { live: boolean; mode: string };
      };
      expect(body.signalsIngestion?.live).toBe(false);
      expect(body.signalsIngestion?.mode).toBe("job_feed_json");
    });
  });

  it("signals fall back to seeds when feed missing", async () => {
    process.env.VIP_SIGNALS_FEED = join(
      dirname(fileURLToPath(import.meta.url)),
      "does-not-exist-signals-feed.json",
    );
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/signals`);
      const body = (await res.json()) as { source: string; signals: unknown[] };
      expect(body.source).toBe("seed");
      expect(body.signals.length).toBeGreaterThan(0);
    });
  });
});
