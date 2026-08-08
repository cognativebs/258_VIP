import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { loadBinderTcg } from "./lib/binderHoldings.js";
import { mapInventoryRow, type ApiHolding } from "./lib/holdings.js";
import { buildRecommendation } from "./lib/recommendations.js";
import { defaultSignalsFeedPath, readSignalsFeed } from "./lib/signalsFeed.js";
import { loadSources, updateSourceActive } from "./lib/sourcesRegistry.js";
import { HUNTS, huntCompletion } from "./seeds/hunts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(name: string): Record<string, unknown>[] {
  const path = join(__dirname, "seeds", name);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>[];
}

const comicsSeedHoldings: ApiHolding[] = loadJson("inventory-sample.json").map(mapInventoryRow);
const pokemonSeedHoldings: ApiHolding[] = loadJson("pokemon-holdings-sample.json").map(
  mapInventoryRow,
);
const sellQueue: ApiHolding[] = loadJson("sell-queue-sample.json").map(mapInventoryRow);

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

const theses = [
  {
    id: "thesis-1",
    claim: "Absolute Universe Cover A first prints remain the completion spine for 2026.",
    horizon: "12 months",
    status: "active",
    linkedAssetNames: ["Absolute Batman #1 Cover A"],
  },
];

function includePokemonSeeds(): boolean {
  return process.env.VIP_INCLUDE_POKEMON_SEEDS === "1";
}

async function buildInventory(): Promise<{
  holdings: ApiHolding[];
  tcgSource: "binder" | "pokemon_seeds" | "binder+seeds" | "none";
  binder: Awaited<ReturnType<typeof loadBinderTcg>>;
}> {
  const binder = await loadBinderTcg();
  const tcgFromBinder = binder.available && binder.holdings.length > 0;
  const seeds = includePokemonSeeds() || !tcgFromBinder ? pokemonSeedHoldings : [];
  const holdings = [...comicsSeedHoldings, ...seeds, ...(tcgFromBinder ? binder.holdings : [])];
  let tcgSource: "binder" | "pokemon_seeds" | "binder+seeds" | "none" = "none";
  if (tcgFromBinder && seeds.length) tcgSource = "binder+seeds";
  else if (tcgFromBinder) tcgSource = "binder";
  else if (seeds.length) tcgSource = "pokemon_seeds";
  return { holdings, tcgSource, binder };
}

export function createApp() {
  const app = express();
  // Reflect request origin so Binder/IQVault on LAN IPs work (not only localhost).
  app.use(
    cors({
      origin: true,
      credentials: false,
    }),
  );
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "vip-api", version: "0.2.0" });
  });

  app.get("/api/inventory", async (_req, res) => {
    const { holdings, tcgSource, binder } = await buildInventory();
    const totalValue = holdings.reduce((s, h) => s + (h.currentPrice ?? 0) * h.quantity, 0);
    res.json({
      count: holdings.length,
      totalValueEstimate: {
        note: "Sum of currentPrice snapshots — not a verified market range",
        amount: Number(totalValue.toFixed(2)),
        confidence: "low",
      },
      tcgSource,
      binderDb: {
        path: binder.dbPath,
        available: binder.available,
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
      error: binder.error ?? null,
      binders: binder.binders,
      filledSlots: binder.holdings.length,
      ownedSlots: binder.holdings.filter((h) => h.pillar?.includes("Owned")).length,
      needSlots: binder.holdings.filter((h) => h.pillar?.includes("Need")).length,
    });
  });

  app.get("/api/sell-queue", (_req, res) => {
    const ranked = [...sellQueue].sort((a, b) => {
      const rank = { High: 0, Medium: 1, Low: 2 } as const;
      return (rank[a.sellPriority ?? "Low"] ?? 3) - (rank[b.sellPriority ?? "Low"] ?? 3);
    });
    res.json({ count: ranked.length, items: ranked });
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
    const { holdings } = await buildInventory();
    const items = holdings.slice(0, limit).map((h) => buildRecommendation(h));
    res.json({ count: items.length, recommendations: items });
  });

  app.get("/api/recommendations/:holdingId", async (req, res) => {
    const { holdings } = await buildInventory();
    const holding = holdings.find((h) => h.id === req.params.holdingId);
    if (!holding) {
      res.status(404).json({ error: "Holding not found" });
      return;
    }
    res.json({ recommendation: buildRecommendation(holding) });
  });

  app.get("/api/signals", (_req, res) => res.json(loadSignalsResponse()));
  app.get("/api/watchlist", async (_req, res) => {
    const { holdings } = await buildInventory();
    const watchlist = holdings.slice(0, 8).map((h) => ({
      id: `watch-${h.id}`,
      holdingId: h.id,
      assetName: h.assetName,
      note: "Watch for ask under range low",
      addedAt: "2026-07-10",
    }));
    res.json({ watchlist });
  });
  app.get("/api/theses", (_req, res) => res.json({ theses }));
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

  return app;
}
