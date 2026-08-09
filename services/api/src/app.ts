import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { loadBinderTcg } from "./lib/binderHoldings.js";
import {
  BINDER_WRITE_RULE,
  loadDurableBinderHoldings,
  loadDurableWatchlist,
  projectAllBinderSlots,
  projectSlotToVip,
} from "./lib/binderWrite.js";
import {
  loadComicsHoldings,
  type ComicsPayload,
} from "./lib/comicsHoldings.js";
import { mapInventoryRow, type ApiHolding } from "./lib/holdings.js";
import { buildRecommendation } from "./lib/recommendations.js";
import { defaultSignalsFeedPath, readSignalsFeed } from "./lib/signalsFeed.js";
import { loadSources, updateSourceActive } from "./lib/sourcesRegistry.js";
import {
  confirmScanFromApi,
  getScanBatch,
  listScanBatches,
  openScanFromApi,
  scanMeta,
} from "./lib/scanIngest.js";
import { HUNTS, huntCompletion } from "./seeds/hunts.js";
import { markInferred, markObserved } from "@vip/evidence";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(name: string): Record<string, unknown>[] {
  const path = join(__dirname, "seeds", name);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>[];
}

/** Pokémon bridge seeds — used only when Binder SQLite is empty, never for comics. */
const pokemonSeedHoldings: ApiHolding[] = loadJson("pokemon-holdings-sample.json").map(
  mapInventoryRow,
);

const SEED_SIGNALS = [
  {
    id: "sig-1",
    signalType: "market",
    body: "Absolute Batman #1 Cover A comps clustered $20–$25 this week.",
    sourceUrl: null,
    signalDate: "2026-07-18",
    quarantineStatus: "active",
  },
  {
    id: "sig-2",
    signalType: "retail",
    body: "Pokémon 30th sealed restock rumors — treat as unverified until listing proof.",
    sourceUrl: null,
    signalDate: "2026-07-19",
    quarantineStatus: "quarantined",
  },
];

function loadSignalsResponse() {
  const feed = readSignalsFeed(defaultSignalsFeedPath());
  if (feed && feed.signals.length > 0) {
    return {
      signals: feed.signals,
      source: "job_feed" as const,
      feed: {
        writtenAt: feed.writtenAt,
        runId: feed.runId,
        job: feed.job ?? null,
        provenance: feed.provenance,
      },
    };
  }
  return {
    signals: SEED_SIGNALS,
    source: "seed" as const,
    feed: null,
  };
}

function includePokemonSeeds(): boolean {
  return process.env.VIP_INCLUDE_POKEMON_SEEDS === "1";
}

export type AppDeps = {
  loadComics?: () => Promise<ComicsPayload>;
};

type InventoryBundle = {
  holdings: ApiHolding[];
  comics: ComicsPayload;
  tcgSource: "binder" | "pokemon_seeds" | "binder+seeds" | "none";
  binder: Awaited<ReturnType<typeof loadBinderTcg>>;
  comicsSource: "postgres" | "unavailable";
  durableBinderHoldings: number;
};

function durableBinderToApi(
  row: Awaited<ReturnType<typeof loadDurableBinderHoldings>>[number],
): ApiHolding {
  const verified = !row.needsVerification;
  const provenance = verified
    ? markObserved({
        source: "binder_vault",
        ruleOrModelVersion: BINDER_WRITE_RULE,
        confidence: 0.8,
      })
    : markInferred({
        source: "binder_vault",
        ruleOrModelVersion: BINDER_WRITE_RULE,
        notes: "Owned flag from Binder Vault · unverified against physical card",
      });

  return {
    id: row.id,
    assetName: row.assetName,
    series: row.series,
    issue: row.issue,
    publisher: "The Pokémon Company",
    quantity: row.quantity,
    pillar: row.pillar,
    museumScore: null,
    investmentScore: null,
    liquidityScore: null,
    recommendationLabel: row.recommendationLabel,
    sellPriority: row.sellPriority,
    needsGrading: false,
    needsPhoto: false,
    needsVerification: row.needsVerification,
    verificationNotes: row.verificationNotes,
    currentPrice: row.currentPrice,
    assumedGrade: null,
    gradeRating: null,
    coverImageUrl: null,
    externalIds: row.externalIds,
    provenance,
  };
}

async function buildInventory(deps: AppDeps = {}): Promise<InventoryBundle> {
  const loadComics = deps.loadComics ?? loadComicsHoldings;
  const [comics, binder, durableRows] = await Promise.all([
    loadComics(),
    loadBinderTcg(),
    loadDurableBinderHoldings(),
  ]);

  const durableOwned = durableRows.map(durableBinderToApi);
  const durableSlotIds = new Set(durableRows.map((r) => r.sourceRowId));

  // Need pockets still come from Binder layout; owned pockets prefer the
  // durable VIP holding written by the Binder→VIP path (avoids duplicates).
  const needFromBinder = binder.available
    ? binder.holdings.filter((h) => {
        if (!h.pillar?.includes("Need")) return false;
        const slotId = h.id.startsWith("binder-slot-")
          ? h.id.slice("binder-slot-".length)
          : null;
        return !slotId || !durableSlotIds.has(slotId);
      })
    : [];

  // Also surface owned Binder slots that have not been projected yet (pre-push).
  const unprojectedOwned = binder.available
    ? binder.holdings.filter((h) => {
        if (!h.pillar?.includes("Owned")) return false;
        const slotId = h.id.startsWith("binder-slot-")
          ? h.id.slice("binder-slot-".length)
          : null;
        return slotId ? !durableSlotIds.has(slotId) : true;
      })
    : [];

  const tcgLive = [...durableOwned, ...unprojectedOwned, ...needFromBinder];
  const seeds =
    includePokemonSeeds() || tcgLive.length === 0 ? pokemonSeedHoldings : [];

  const comicsHoldings = comics.available ? comics.holdings : [];
  const holdings = [...comicsHoldings, ...seeds, ...tcgLive];

  let tcgSource: InventoryBundle["tcgSource"] = "none";
  if (tcgLive.length && seeds.length) tcgSource = "binder+seeds";
  else if (tcgLive.length) tcgSource = "binder";
  else if (seeds.length) tcgSource = "pokemon_seeds";

  return {
    holdings,
    comics,
    tcgSource,
    binder,
    comicsSource: comics.available ? "postgres" : "unavailable",
    durableBinderHoldings: durableOwned.length,
  };
}

function sellQueueFrom(holdings: ApiHolding[]): ApiHolding[] {
  const rank = { High: 0, Medium: 1, Low: 2 } as const;
  return holdings
    .filter((h) => h.sellPriority === "High" || h.sellPriority === "Medium")
    .sort(
      (a, b) =>
        (rank[a.sellPriority ?? "Low"] ?? 3) - (rank[b.sellPriority ?? "Low"] ?? 3),
    );
}

function watchlistFrom(holdings: ApiHolding[]) {
  // Prefer books that actually need attention — not "first N of the table".
  const candidates = holdings.filter(
    (h) => h.needsVerification || h.needsGrading || h.sellPriority === "High",
  );
  const pool = candidates.length > 0 ? candidates : holdings;
  return pool.slice(0, 12).map((h) => ({
    id: `watch-${h.id}`,
    holdingId: h.id,
    assetName: h.assetName,
    note: h.needsVerification
      ? "Needs verification"
      : h.needsGrading
        ? "Needs grading"
        : h.sellPriority === "High"
          ? "High sell priority"
          : "Review",
    reasons: {
      needsVerification: h.needsVerification,
      needsGrading: h.needsGrading,
      sellPriority: h.sellPriority,
    },
  }));
}

function thesesFrom(holdings: ApiHolding[]) {
  // Derived from live pillars with real counts — not a hardcoded claim list.
  const byPillar = new Map<string, number>();
  for (const h of holdings) {
    if (!h.pillar) continue;
    byPillar.set(h.pillar, (byPillar.get(h.pillar) ?? 0) + h.quantity);
  }
  return [...byPillar.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([pillar, count], i) => ({
      id: `thesis-pillar-${i + 1}`,
      claim: `${pillar} is a live collection pillar (${count} copies in inventory).`,
      horizon: "current holdings",
      status: "active" as const,
      linkedAssetNames: holdings
        .filter((h) => h.pillar === pillar)
        .slice(0, 3)
        .map((h) => h.assetName),
      evidence: {
        method: "derived_from_holdings",
        pillar,
        count,
        note: "Count from live inventory — not a market thesis with comps",
      },
    }));
}

export function createApp(deps: AppDeps = {}) {
  const app = express();
  app.use(
    cors({
      origin: true,
      credentials: false,
    }),
  );
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "vip-api", version: "0.3.0" });
  });

  app.get("/api/inventory", async (_req, res) => {
    const { holdings, comics, tcgSource, binder, comicsSource, durableBinderHoldings } =
      await buildInventory(deps);
    const totalValue = holdings.reduce((s, h) => s + (h.currentPrice ?? 0) * h.quantity, 0);

    // Loud degraded mode: comics unavailable is a first-class response field,
    // never a quiet 120-row sample that looks like a portfolio.
    res.status(200).json({
      count: holdings.length,
      comicsCount: comics.available ? comics.holdings.length : 0,
      comicsSource,
      comicsAvailable: comics.available,
      comicsError: comics.error,
      comicsSnapshot: comics.snapshot,
      durableBinderHoldings,
      totalValueEstimate: {
        note: comics.available
          ? "Sum of currentPrice CLZ snapshots — not a verified market range"
          : "Comics Postgres unavailable — total excludes the real collection",
        amount: Number(totalValue.toFixed(2)),
        confidence: comics.available ? "low" : "none",
      },
      tcgSource,
      binderDb: {
        path: binder.dbPath,
        available: binder.available,
        store: binder.store,
        filledSlots: binder.holdings.length,
        error: binder.error ?? null,
      },
      holdings,
    });
  });

  app.get("/api/tcg/binders", async (_req, res) => {
    const binder = await loadBinderTcg();
    res.json({
      available: binder.available,
      dbPath: binder.dbPath,
      store: binder.store,
      error: binder.error ?? null,
      binders: binder.binders,
      filledSlots: binder.holdings.length,
      ownedSlots: binder.holdings.filter((h) => h.pillar?.includes("Owned")).length,
      needSlots: binder.holdings.filter((h) => h.pillar?.includes("Need")).length,
    });
  });

  app.get("/api/sell-queue", async (_req, res) => {
    const { holdings, comics, comicsSource } = await buildInventory(deps);
    if (!comics.available) {
      res.status(503).json({
        error: "Comics inventory unavailable — sell queue not computed from sample data",
        comicsSource,
        comicsError: comics.error,
        count: 0,
        items: [],
      });
      return;
    }
    const ranked = sellQueueFrom(holdings);
    res.json({
      count: ranked.length,
      comicsSource,
      comicsSnapshot: comics.snapshot,
      items: ranked,
    });
  });

  app.get("/api/hunts", (_req, res) => {
    res.json({
      hunts: HUNTS.map((h) => ({ ...h, metrics: huntCompletion(h) })),
    });
  });

  app.get("/api/hunts/:id", (req, res) => {
    const hunt = HUNTS.find((h) => h.id === req.params.id || h.slug === req.params.id);
    if (!hunt) {
      res.status(404).json({ error: "Hunt not found" });
      return;
    }
    res.json({ hunt: { ...hunt, metrics: huntCompletion(hunt) } });
  });

  app.get("/api/recommendations", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 12), 40);
    const { holdings, comics, comicsSource } = await buildInventory(deps);
    if (!comics.available) {
      res.status(503).json({
        error: "Comics inventory unavailable — recommendations not computed from sample data",
        comicsSource,
        comicsError: comics.error,
        count: 0,
        recommendations: [],
      });
      return;
    }
    const items = await Promise.all(
      holdings.slice(0, limit).map((h) => buildRecommendation(h)),
    );
    res.json({
      count: items.length,
      comicsSource,
      comicsSnapshot: comics.snapshot,
      recommendations: items,
    });
  });

  app.get("/api/recommendations/:holdingId", async (req, res) => {
    const { holdings, comics, comicsSource } = await buildInventory(deps);
    if (!comics.available) {
      res.status(503).json({
        error: "Comics inventory unavailable",
        comicsSource,
        comicsError: comics.error,
      });
      return;
    }
    const holding = holdings.find((h) => h.id === req.params.holdingId);
    if (!holding) {
      res.status(404).json({ error: "Holding not found" });
      return;
    }
    res.json({ recommendation: await buildRecommendation(holding) });
  });

  app.get("/api/signals", (_req, res) => res.json(loadSignalsResponse()));

  app.get("/api/watchlist", async (_req, res) => {
    const { holdings, comics, comicsSource } = await buildInventory(deps);
    const durable = await loadDurableWatchlist();
    // Durable Binder wishlist first; attention-derived comics rows fill the rest.
    const derived =
      comics.available
        ? watchlistFrom(holdings.filter((h) => h.provenance.source === "clz_import"))
        : [];
    res.json({
      comicsSource,
      comicsAvailable: comics.available,
      comicsError: comics.error,
      comicsSnapshot: comics.snapshot,
      source: durable.length ? "durable+derived" : comics.available ? "derived" : "durable",
      watchlist: [...durable, ...derived],
    });
  });

  /** Binder → VIP: project one slot's owned/wishlist flags into durable VIP rows. */
  app.post("/api/tcg/slots/:slotId/project", async (req, res) => {
    try {
      const result = await projectSlotToVip(String(req.params.slotId));
      if (!result.ok) {
        res.status(404).json(result);
        return;
      }
      res.json({ ...result, ruleOrModelVersion: BINDER_WRITE_RULE });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** Binder → VIP: project all filled slots (optional ?binderId=). */
  app.post("/api/tcg/project", async (req, res) => {
    try {
      const binderId =
        typeof req.body?.binderId === "string"
          ? req.body.binderId
          : typeof req.query.binderId === "string"
            ? req.query.binderId
            : undefined;
      const result = await projectAllBinderSlots({ binderId });
      res.json({ ...result, ruleOrModelVersion: BINDER_WRITE_RULE });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/theses", async (_req, res) => {
    const { holdings, comics, comicsSource } = await buildInventory(deps);
    if (!comics.available) {
      res.status(503).json({
        error: "Comics inventory unavailable — theses not served from hardcoded claims",
        comicsSource,
        comicsError: comics.error,
        theses: [],
      });
      return;
    }
    res.json({
      comicsSource,
      comicsSnapshot: comics.snapshot,
      theses: thesesFrom(holdings),
    });
  });

  app.get("/api/sources", (_req, res) => {
    res.json({ sources: loadSources() });
  });
  app.patch("/api/sources/:id", (req, res) => {
    const active = req.body?.active;
    if (typeof active !== "boolean") {
      res.status(400).json({ error: "body.active boolean required" });
      return;
    }
    const updated = updateSourceActive(String(req.params.id), active);
    if (!updated) {
      res.status(404).json({ error: "Source not found" });
      return;
    }
    res.json({ source: updated });
  });

  /**
   * Ricoh fi-8170 intake: scan → ID → duplicate alert → inventory confirm
   * → optional eBay listing draft (idle without developer tokens).
   */
  app.get("/api/scan", (_req, res) => {
    res.json(scanMeta());
  });

  app.get("/api/scan/batches", (_req, res) => {
    res.json({ count: listScanBatches().length, batches: listScanBatches() });
  });

  app.get("/api/scan/batches/:id", (req, res) => {
    const batch = getScanBatch(String(req.params.id));
    if (!batch) {
      res.status(404).json({ error: "Scan batch not found" });
      return;
    }
    res.json({ batch });
  });

  app.post("/api/scan/batches", (req, res) => {
    try {
      const result = openScanFromApi(req.body ?? {});
      res.status(201).json({
        batch: result.batch,
        rawSnapshots: result.rawSnapshots,
        decisionNote:
          "Candidates are inferred · unverified until POST /api/scan/units/:id/confirm",
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/scan/units/:id/confirm", (req, res) => {
    try {
      const result = confirmScanFromApi({
        ...(req.body ?? {}),
        unitId: String(req.params.id),
      });
      if (!result.ok) {
        const status =
          result.code === "DUPLICATE_UNACKNOWLEDGED"
            ? 409
            : result.code === "UNIT_NOT_FOUND"
              ? 404
              : 400;
        res.status(status).json(result);
        return;
      }
      res.json({
        ...result,
        outputAction: result.decisionAction,
        note: "Holding entered inventory; condition remains NM assumed · unverified until grading/museum capture",
      });
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return app;
}
