import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { mapInventoryRow, type ApiHolding } from "./lib/holdings.js";
import { buildRecommendation } from "./lib/recommendations.js";
import { HUNTS, huntCompletion } from "./seeds/hunts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(name: string): Record<string, unknown>[] {
  const path = join(__dirname, "seeds", name);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>[];
}

const inventory: ApiHolding[] = loadJson("inventory-sample.json").map(mapInventoryRow);
const sellQueue: ApiHolding[] = loadJson("sell-queue-sample.json").map(mapInventoryRow);

const signals = [
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

const watchlist = inventory.slice(0, 8).map((h) => ({
  id: `watch-${h.id}`,
  holdingId: h.id,
  assetName: h.assetName,
  note: "Watch for ask under range low",
  addedAt: "2026-07-10",
}));

const theses = [
  {
    id: "thesis-1",
    claim: "Absolute Universe Cover A first prints remain the completion spine for 2026.",
    horizon: "12 months",
    status: "active",
    linkedAssetNames: ["Absolute Batman #1 Cover A"],
  },
];

const sources = [
  {
    id: "src-clz",
    name: "CLZ Comics export",
    authority: "owner_import",
    accessMethod: "xml_file",
    categoryCoverage: ["comic"],
    notes: "Immutable snapshot via @vip/ingest",
  },
  {
    id: "src-ebay",
    name: "eBay sold comps",
    authority: "market",
    accessMethod: "adapter_pending",
    categoryCoverage: ["comic", "pokemon"],
    notes: "Swappable adapter — not hardcoded scrapers in core",
  },
];

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "vip-api", version: "0.1.0" });
  });

  app.get("/api/inventory", (_req, res) => {
    const totalValue = inventory.reduce((s, h) => s + (h.currentPrice ?? 0) * h.quantity, 0);
    res.json({
      count: inventory.length,
      totalValueEstimate: {
        note: "Sum of currentPrice snapshots — not a verified market range",
        amount: Number(totalValue.toFixed(2)),
        confidence: "low",
      },
      holdings: inventory,
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

  app.get("/api/recommendations", (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 12), 40);
    const items = inventory.slice(0, limit).map((h) => buildRecommendation(h));
    res.json({ count: items.length, recommendations: items });
  });

  app.get("/api/recommendations/:holdingId", (req, res) => {
    const holding = inventory.find((h) => h.id === req.params.holdingId);
    if (!holding) {
      res.status(404).json({ error: "Holding not found" });
      return;
    }
    res.json({ recommendation: buildRecommendation(holding) });
  });

  app.get("/api/signals", (_req, res) => res.json({ signals }));
  app.get("/api/watchlist", (_req, res) => res.json({ watchlist }));
  app.get("/api/theses", (_req, res) => res.json({ theses }));
  app.get("/api/sources", (_req, res) => res.json({ sources }));

  return app;
}
