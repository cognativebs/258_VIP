import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { writeSignalsFeed } from "./lib/signalsFeed.js";

const tmpFeed = join(dirname(fileURLToPath(import.meta.url)), "..", ".tmp-test-signals-feed.json");

afterEach(() => {
  delete process.env.VIP_SIGNALS_FEED;
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
        }[];
      };
      expect(body.recommendations[0]?.supportingEvidence.length).toBeGreaterThan(0);
      expect(body.recommendations[0]?.opposingEvidence.length).toBeGreaterThan(0);
      expect(body.recommendations[0]?.marketRange).toBeTruthy();
    });
  });

  it("hunts include Absolute Batman + Pokémon seeds", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/hunts`);
      const body = (await res.json()) as { hunts: { id: string }[] };
      const ids = body.hunts.map((h) => h.id);
      expect(ids).toContain("absolute-batman");
      expect(ids).toContain("pokemon-30th");
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
