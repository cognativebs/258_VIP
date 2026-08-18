import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { loadBinderTcg } from "./lib/binderHoldings.js";
import { mapInventoryRow, type ApiHolding } from "./lib/holdings.js";
import { intelligenceSnapshot, SIGNALS_INGESTION } from "./lib/intelligence.js";
import {
  EMERGING_MARKET_SEEDS,
  PRINT_LIFE_WATCHES,
  scoreCohenCover,
} from "@vip/intelligence";
import {
  addGoldenCaseRow,
  addGrading,
  addManualCycle,
  addPrediction,
  addUnderwriting,
  captureFieldItem,
  lockStoredUnderwriting,
  resolveStoredPrediction,
  startFieldSession,
} from "./lib/intelligenceStore.js";
import { buildRecommendation } from "./lib/recommendations.js";
import { dogfoodSellQueue } from "./lib/sellQueue.js";
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
  {
    id: "thesis-cohen-museum",
    claim:
      "Carla Cohen is investable as a 9–18 book museum, not a variant pillar. Early + iconic + true scarcity; buy Ivy #9 cheap; verify Die!Namite LTD 500.",
    horizon: "10–20 years",
    status: "active",
    linkedAssetNames: [
      "Wonder Woman: Black & Gold #1",
      "Department of Truth #11",
      "Die!Namite #1 Red Sonja Virgin",
      "Poison Ivy #9",
    ],
  },
  {
    id: "thesis-one-piece-heroines",
    claim:
      "One Piece hierarchy is still forming. Build Icons (9) + Heroines (Nami/Boa first), prefer OP01/Manga/event over OP-XX chase.",
    horizon: "3–7 years",
    status: "active",
    linkedAssetNames: ["OP01 Nami Parallel", "Nami EB03-053 SP", "Boa Hancock OP07 Manga"],
  },
  {
    id: "thesis-gundam-foundation",
    claim:
      "Gundam TCG may be early: first-era + iconic suits/characters + sealed. $300–$500 experiment, then 6–12 month watch.",
    horizon: "6–12 months review",
    status: "active",
    linkedAssetNames: ["RX-78-2 Gundam", "Char Aznable"],
  },
  {
    id: "thesis-lorcana-first-chapter",
    claim:
      "Lorcana is Disney art collecting. First Chapter Enchanteds (Elsa especially) outrank newer Iconics on history.",
    horizon: "10–20 years",
    status: "active",
    linkedAssetNames: ["Elsa – Spirit of Winter Enchanted"],
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
    res.json(dogfoodSellQueue(sellQueue, 20));
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

  app.get("/api/signals", (_req, res) =>
    res.json({
      ...loadSignalsResponse(),
      signalsIngestion: SIGNALS_INGESTION,
    }),
  );

  async function liveIntelligenceSnapshot() {
    const { holdings, binder } = await buildInventory();
    return intelligenceSnapshot(new Date(), {
      holdings,
      binderPages: binder.pages,
    });
  }

  app.get("/api/intelligence", async (_req, res) => {
    res.json(await liveIntelligenceSnapshot());
  });
  app.get("/api/intelligence/predictions", async (_req, res) => {
    const snap = await liveIntelligenceSnapshot();
    res.json({
      version: snap.version,
      signalsIngestion: snap.signalsIngestion,
      ...snap.predictions,
    });
  });
  app.get("/api/intelligence/recommendations", async (_req, res) => {
    const snap = await liveIntelligenceSnapshot();
    res.json({
      version: snap.version,
      count: snap.recommendations.length,
      recommendations: snap.recommendations,
    });
  });
  app.get("/api/intelligence/underwriting", async (_req, res) => {
    const snap = await liveIntelligenceSnapshot();
    res.json({ version: snap.version, underwriting: snap.underwriting });
  });
  app.get("/api/intelligence/grading", async (_req, res) => {
    const snap = await liveIntelligenceSnapshot();
    res.json({
      version: snap.version,
      grading: snap.grading,
      queue: snap.gradingQueue,
    });
  });
  app.get("/api/intelligence/collection", async (_req, res) => {
    const snap = await liveIntelligenceSnapshot();
    res.json({ version: snap.version, collection: snap.collection });
  });

  app.post("/api/intelligence/predictions", (req, res) => {
    try {
      res.status(201).json({ prediction: addPrediction(req.body ?? {}) });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post("/api/intelligence/predictions/:id/resolve", (req, res) => {
    try {
      const actualPrice = Number(req.body?.actualPrice);
      if (!Number.isFinite(actualPrice)) {
        res.status(400).json({ error: "actualPrice required" });
        return;
      }
      res.json({
        prediction: resolveStoredPrediction(String(req.params.id), actualPrice, req.body?.explanation),
      });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post("/api/intelligence/underwriting", (req, res) => {
    try {
      res.status(201).json({ underwriting: addUnderwriting(req.body ?? {}) });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post("/api/intelligence/underwriting/:id/lock", (req, res) => {
    try {
      res.json({ underwriting: lockStoredUnderwriting(String(req.params.id)) });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post("/api/intelligence/grading", (req, res) => {
    try {
      res.status(201).json({ grading: addGrading(req.body ?? {}) });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post("/api/intelligence/cycle", (req, res) => {
    try {
      res.status(201).json(addManualCycle(req.body ?? {}));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post("/api/intelligence/sessions", (req, res) => {
    try {
      res.status(201).json({ session: startFieldSession(req.body ?? {}) });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post("/api/intelligence/sessions/:id/capture", (req, res) => {
    try {
      res.status(201).json({
        capture: captureFieldItem({ sessionId: String(req.params.id), ...(req.body ?? {}) }),
      });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post("/api/intelligence/cohen-score", (req, res) => {
    try {
      res.json({ score: scoreCohenCover(req.body ?? {}) });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.get("/api/intelligence/print-life", (_req, res) => {
    res.json({
      scoringEnabled: false,
      note: "Manual watch only — Pokémon has no official OOP registry and reprints.",
      watches: PRINT_LIFE_WATCHES,
    });
  });
  app.get("/api/intelligence/emerging-markets", (_req, res) => {
    res.json({
      scoringEnabled: false,
      experimentBudgetUsd: 1000,
      note: "90-day experiment seeds. BUY MORE / HOLD / EXIT stays manual until Signals velocity is live.",
      markets: EMERGING_MARKET_SEEDS,
    });
  });
  app.post("/api/intelligence/golden-cases", (req, res) => {
    try {
      res.status(201).json({ goldenCase: addGoldenCaseRow(req.body ?? {}) });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
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
