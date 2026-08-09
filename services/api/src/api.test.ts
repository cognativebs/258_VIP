import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { ComicsPayload } from "./lib/comicsHoldings.js";
import { mapInventoryRow } from "./lib/holdings.js";
import { resetScanStoreForTests } from "./lib/scanIngest.js";
import { writeSignalsFeed } from "./lib/signalsFeed.js";

const here = dirname(fileURLToPath(import.meta.url));
const tmpFeed = join(here, "..", ".tmp-test-signals-feed.json");

/** Explicit test fixture — never the runtime serving path. */
function fixtureComics(count = 5): ComicsPayload {
  const rows = JSON.parse(
    readFileSync(join(here, "seeds", "inventory-sample.json"), "utf8"),
  ) as Record<string, unknown>[];
  return {
    available: true,
    holdings: rows.slice(0, count).map(mapInventoryRow),
    snapshot: {
      id: "fixture-snapshot",
      contentHash: "a".repeat(64),
      shortHash: "aaaaaaaaaaaa",
      ingestedAt: "2026-07-04T00:00:00.000Z",
      recordCount: count,
      ageDays: 0,
      label: "CLZ export fixture",
    },
    error: null,
    dsn: "fixture",
  };
}

function unavailableComics(): ComicsPayload {
  return {
    available: false,
    holdings: [],
    snapshot: null,
    error: "connection refused (fixture)",
    dsn: "fixture",
  };
}

afterEach(() => {
  delete process.env.VIP_SIGNALS_FEED;
  delete process.env.VIP_INCLUDE_POKEMON_SEEDS;
  resetScanStoreForTests();
});

async function withServer<T>(
  fn: (base: string) => Promise<T>,
  comics: ComicsPayload = fixtureComics(),
): Promise<T> {
  const app = createApp({ loadComics: async () => comics });
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
  it("serves live comics inventory with provenance — never the sample as truth", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/inventory`);
      const body = (await res.json()) as {
        comicsAvailable: boolean;
        comicsSource: string;
        comicsCount: number;
        comicsSnapshot: { shortHash: string } | null;
        holdings: { provenance: { method: string; source: string } }[];
      };
      expect(res.status).toBe(200);
      expect(body.comicsAvailable).toBe(true);
      expect(body.comicsSource).toBe("postgres");
      expect(body.comicsCount).toBe(5);
      expect(body.comicsSnapshot?.shortHash).toBe("aaaaaaaaaaaa");
      expect(body.holdings[0]?.provenance.method).toBeTruthy();
      expect(body.holdings[0]?.provenance.source).toBe("clz_import");
    });
  });

  it("degrades loudly when comics Postgres is down — no silent sample portfolio", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/inventory`);
      const body = (await res.json()) as {
        comicsAvailable: boolean;
        comicsSource: string;
        comicsCount: number;
        comicsError: string | null;
        totalValueEstimate: { confidence: string; note: string };
        holdings: unknown[];
      };
      expect(body.comicsAvailable).toBe(false);
      expect(body.comicsSource).toBe("unavailable");
      expect(body.comicsCount).toBe(0);
      expect(body.comicsError).toMatch(/connection refused/);
      expect(body.totalValueEstimate.confidence).toBe("none");
      expect(body.totalValueEstimate.note).toMatch(/unavailable/i);
      // Pokémon seeds may still appear; comics must not.
      expect(body.holdings.every((h) => {
        const row = h as { provenance?: { source?: string } };
        return row.provenance?.source !== "clz_import";
      })).toBe(true);
    }, unavailableComics());
  });

  it("sell-queue / recommendations / theses refuse sample data when comics are down", async () => {
    await withServer(async (base) => {
      for (const path of ["/api/sell-queue", "/api/recommendations", "/api/theses"]) {
        const res = await fetch(`${base}${path}`);
        expect(res.status).toBe(503);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/unavailable/i);
      }
      // Watchlist still serves durable Binder wishlist rows when comics are down.
      const watch = await fetch(`${base}/api/watchlist`);
      expect(watch.status).toBe(200);
      const body = (await watch.json()) as { comicsAvailable: boolean; watchlist: unknown[] };
      expect(body.comicsAvailable).toBe(false);
      expect(Array.isArray(body.watchlist)).toBe(true);
    }, unavailableComics());
  });

  it("POST /api/tcg/project projects Binder owned/wishlist into durable VIP rows", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/tcg/slots/slot-test-charizard/project`, {
        method: "POST",
      });
      if (res.status === 404) {
        // Seed missing in this environment — skip without failing CI Node job.
        return;
      }
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        holding: string;
        watchlist: string;
      };
      expect(body.ok).toBe(true);
      expect(body.holding).toBe("upserted");
      expect(body.watchlist).toBe("upserted");

      const inv = await fetch(`${base}/api/inventory`);
      const invBody = (await inv.json()) as {
        durableBinderHoldings: number;
        holdings: { pillar: string | null; externalIds?: { externalValue: string }[] }[];
      };
      expect(invBody.durableBinderHoldings).toBeGreaterThanOrEqual(1);
      expect(
        invBody.holdings.some(
          (h) =>
            h.pillar === "TCG Owned (Binder)" &&
            h.externalIds?.some((e) => e.externalValue === "base1-4"),
        ),
      ).toBe(true);
    });
  });

  it("sell-queue is derived from live holdings, not sell-queue-sample.json", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/sell-queue`);
      const body = (await res.json()) as {
        comicsSource: string;
        items: { sellPriority: string | null }[];
      };
      expect(res.status).toBe(200);
      expect(body.comicsSource).toBe("postgres");
      expect(body.items.every((i) => i.sellPriority === "High" || i.sellPriority === "Medium")).toBe(
        true,
      );
    });
  });

  it("recommendations refuse fabricated comps — insufficient market evidence until adapters land", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/recommendations?limit=3`);
      const body = (await res.json()) as {
        recommendations: {
          supportingEvidence: unknown[];
          opposingEvidence: unknown[];
          marketRange: { matchedSales: number } | null;
          insufficientMarketEvidence: boolean;
          reasonCodes: string[];
          compsSource: string;
        }[];
      };
      const first = body.recommendations[0];
      expect(first).toBeTruthy();
      expect(first?.insufficientMarketEvidence).toBe(true);
      expect(first?.compsSource).toBe("none");
      expect(first?.reasonCodes).toContain("INSUFFICIENT_MARKET_EVIDENCE");
      expect(first?.marketRange?.matchedSales ?? 0).toBe(0);
      // Still emits opposing evidence ("no matched sales") — never invents supporting comps.
      expect(first?.opposingEvidence.length).toBeGreaterThan(0);
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
    process.env.VIP_INCLUDE_POKEMON_SEEDS = "1";
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
      if (body.tcgSource === "pokemon_seeds" || body.tcgSource === "binder+seeds") {
        expect(withExt.some((h) => h.externalIds?.[0]?.externalValue === "base1-4")).toBe(true);
      }
    });
  });

  it("serves /api/tcg/binders summary from Postgres", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/tcg/binders`);
      const body = (await res.json()) as {
        available: boolean;
        binders: unknown[];
        dbPath: string;
        store?: string;
      };
      expect(res.status).toBe(200);
      expect(typeof body.available).toBe("boolean");
      expect(Array.isArray(body.binders)).toBe(true);
      expect(body.dbPath).toBeTruthy();
      expect(body.store).toBe("postgres");
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
    process.env.VIP_SIGNALS_FEED = join(here, "does-not-exist-signals-feed.json");
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/signals`);
      const body = (await res.json()) as { source: string; signals: unknown[] };
      expect(body.source).toBe("seed");
      expect(body.signals.length).toBeGreaterThan(0);
    });
  });

  it("POST /api/scan/batches → confirm unit into inventory with eBay draft idle", async () => {
    await withServer(async (base) => {
      const meta = await fetch(`${base}/api/scan`);
      expect(meta.status).toBe(200);
      const metaBody = (await meta.json()) as { device: string; qualityTier: string };
      expect(metaBody.device).toBe("ricoh_fi8170");
      expect(metaBody.qualityTier).toBe("intake");

      const open = await fetch(`${base}/api/scan/batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryHint: "sports",
          pages: [
            {
              storageRef: "scans/fi8170/j_front.jpg",
              contentHash: "hash-front-jordan",
              ocrText: "1986 Topps Michael Jordan 57",
              face: "front",
            },
            {
              storageRef: "scans/fi8170/j_back.jpg",
              contentHash: "hash-back-jordan",
              face: "back",
            },
          ],
        }),
      });
      expect(open.status).toBe(201);
      const opened = (await open.json()) as {
        batch: {
          id: string;
          units: { id: string; candidates: { catalogKey: string }[] }[];
        };
      };
      const unit = opened.batch.units[0]!;
      expect(unit.candidates[0]?.catalogKey).toBe("sports:topps:1986:jordan:57");

      const confirm = await fetch(`${base}/api/scan/units/${unit.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selectedCandidateKey: "sports:topps:1986:jordan:57",
          queueEbayListingDraft: true,
        }),
      });
      expect(confirm.status).toBe(200);
      const confirmed = (await confirm.json()) as {
        ok: boolean;
        outputAction: string;
        commit: { source: string; assumedGrade: string };
        ebayDraft: { status: string };
      };
      expect(confirmed.ok).toBe(true);
      expect(confirmed.outputAction).toBe("Hold");
      expect(confirmed.commit.source).toBe("ricoh_fi8170");
      expect(confirmed.commit.assumedGrade).toBe("NM");
      expect(confirmed.ebayDraft.status).toBe("pending_credentials");
    });
  });
});
