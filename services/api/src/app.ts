import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { loadBinderTcg } from "./lib/binderHoldings.js";
import { SIGNALS_INGESTION } from "./lib/intelligence.js";
import { registerIntelligenceRoutes } from "./routes/intelligence.js";
import { liveBinderBySlotId, overlayBinderDisplay } from "./lib/tcgOverlay.js";
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
import {
  COMICS_WRITE_RULE,
  comicHoldingPatchBodySchema,
  updateComicHolding,
  type UpdateComicHoldingResult,
} from "./lib/comicsWrite.js";
import { ebayAuthStatus } from "./lib/comps/ebayAuth.js";
import { ebayDeletionStatus } from "./lib/comps/ebayMarketplaceDeletion.js";
import { registerEbayDeletionRoutes } from "./routes/ebayMarketplaceDeletion.js";
import { classifyInventoryBucket } from "@vip/core-model";
import { mapInventoryRow, type ApiHolding } from "./lib/holdings.js";
import { listListingDrafts, queueListingDrafts } from "./lib/listingQueue.js";
import { createInventoryTransaction, listInventoryTransactions } from "./lib/transactions.js";
import { compactSignalsContext, signalsOutputFromFeed } from "./lib/signalsContext.js";
import { ebayCredsFromEnv } from "@vip/scan-ingest";
import { LIVE_RANGE_COPY, loadAllLiveRanges } from "./lib/liveRange.js";
import {
  buildRecommendation,
  COMPS_HOLDING_CAP,
  MIN_SALES_FOR_MARKET_EVIDENCE,
  parseHoldingIdsQuery,
  selectHoldingsForRecommendations,
} from "./lib/recommendations.js";
import { defaultSignalsFeedPath, readSignalsFeed } from "./lib/signalsFeed.js";
import { loadSources, updateSourceActive } from "./lib/sourcesRegistry.js";
import {
  confirmScanFromApi,
  getScanBatch,
  inventoryLookupFromHoldings,
  listScanBatches,
  openScanFromApi,
  scanMeta,
} from "./lib/scanIngest.js";
import { scanInboxRoot } from "./lib/scanFolder.js";
import {
  discardBatch,
  editStagedUnit,
  getStagedBatch,
  listStagedBatches,
  loadScanHoldings,
  rejectUnit,
  resolveUnit,
  type ScanHoldingRow,
} from "./lib/scanStorePg.js";
import {
  acceptanceRows,
  ingestRicohBatch,
  ingestUploadedFiles,
  finishUploadSession,
  startUploadSession,
  writeUploadFile,
  swapStagedFaces,
  RicohIntakeError,
} from "./lib/ricohIntake.js";
import { sendScanMedia } from "./lib/scanMedia.js";
import {
  inspectBatch001Item,
  loadBatch001,
  runBatch001Sports,
} from "./lib/batchPipeline.js";
import { HUNTS, huntCompletion } from "./seeds/hunts.js";
import { markInferred, markObserved } from "@vip/evidence";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(name: string): Record<string, unknown>[] {
  const path = join(__dirname, "seeds", name);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>[];
}

/** Pokémon bridge seeds — used only when Binder Postgres has no TCG rows, never for comics. */
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
  updateComicHolding?: (
    sourceRowId: string,
    fields: Record<string, unknown>,
  ) => Promise<UpdateComicHoldingResult>;
  /** Injectable so tests do not inherit whatever scans the local DB holds. */
  loadScanHoldings?: () => Promise<ScanHoldingRow[]>;
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
    coverImageUrl: row.coverImageUrl,
    cardName: row.cardName,
    rarity: row.rarity,
    externalIds: row.externalIds,
    provenance,
  };
}

/** Confirmed scan intake row → the shared holding shape. */
function scanHoldingToApi(row: ScanHoldingRow): ApiHolding {
  return {
    id: row.id,
    assetName: row.assetName,
    series: row.assetName,
    issue: "",
    publisher: row.category ? `Scan intake (${row.category})` : "Scan intake",
    quantity: row.quantity,
    pillar: "Scanned Intake",
    inventoryBucket: row.inventoryBucket ?? "dealer_inventory",
    inventoryBucketAssignment: "inferred",
    museumScore: null,
    investmentScore: null,
    liquidityScore: null,
    recommendationLabel: row.recommendation ?? "Sell",
    sellPriority: null,
    needsGrading: false,
    needsPhoto: false,
    needsVerification: row.needsVerification,
    verificationNotes: row.verificationNotes,
    currentPrice: null,
    // Intake never inspects condition — keep the grade explicitly inferred.
    assumedGrade: row.assumedGrade,
    gradeRating: null,
    coverImageUrl: null,
    cardName: row.assetName || null,
    rarity: null,
    externalIds: row.externalIds,
    provenance: markInferred({
      source: "ricoh_fi8170",
      ruleOrModelVersion: "scan-ingest@0.1.0",
      confidence: 0.5,
      notes: `${row.assumedGrade ?? "NM"} assumed · unverified condition (intake scan)`,
    }),
  };
}

async function buildInventory(deps: AppDeps = {}): Promise<InventoryBundle> {
  const loadComics = deps.loadComics ?? loadComicsHoldings;
  const loadScans = deps.loadScanHoldings ?? loadScanHoldings;
  const [comics, binder, durableRows, scanRows] = await Promise.all([
    loadComics(),
    loadBinderTcg(),
    loadDurableBinderHoldings(),
    loadScans().catch(() => [] as ScanHoldingRow[]),
  ]);
  const scanHoldings = scanRows.map(scanHoldingToApi);

  const liveBySlot = liveBinderBySlotId(binder.available ? binder.holdings : []);
  const durableOwned = durableRows.map((row) =>
    overlayBinderDisplay(durableBinderToApi(row), liveBySlot.get(row.sourceRowId)),
  );
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
  const holdings = [...comicsHoldings, ...seeds, ...tcgLive, ...scanHoldings];

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
    .filter((h) => {
      const bucket =
        h.inventoryBucket ??
        classifyInventoryBucket({
          pillar: h.pillar,
          recommendation: h.recommendationLabel,
        }).bucket;
      if (bucket === "personal_collection") return false;
      return h.sellPriority === "High" || h.sellPriority === "Medium";
    })
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

  const healthPayload = () => ({
    ok: true,
    service: "vip-api",
    version: "0.3.0",
    ebayComps: ebayAuthStatus(),
    ebayDeletion: ebayDeletionStatus(),
  });
  registerEbayDeletionRoutes(app);
  app.get("/health", (_req, res) => {
    res.json(healthPayload());
  });
  app.get("/api/health", (_req, res) => {
    res.json(healthPayload());
  });

  registerIntelligenceRoutes(app, {
    loadSnapshotInputs: async () => {
      const { holdings, binder } = await buildInventory(deps);
      return { holdings, binders: binder.available ? binder.binders : [] };
    },
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
    const holdingIds = parseHoldingIdsQuery(req.query.holdingIds);
    const limit = Math.min(Number(req.query.limit ?? COMPS_HOLDING_CAP), 40);
    const { holdings, comics, comicsSource } = await buildInventory(deps);
    // Default list path still refuses when comics are down so a seed/binder
    // mix cannot masquerade as the collection. Targeted holdingIds are an
    // explicit lookup — return those holdings (or missing ids) even if comics
    // Postgres is down, so Analysis can attach honest empty comps.
    if (!holdingIds.length && !comics.available) {
      res.status(503).json({
        error: "Comics inventory unavailable — recommendations not computed from sample data",
        comicsSource,
        comicsError: comics.error,
        count: 0,
        recommendations: [],
        missingHoldingIds: [],
        minSalesRequired: MIN_SALES_FOR_MARKET_EVIDENCE,
        ebayAuth: ebayAuthStatus(),
      });
      return;
    }
    const { selected, missingIds } = selectHoldingsForRecommendations(
      holdings,
      holdingIds,
      limit,
    );
    const items = await Promise.all(selected.map((h) => buildRecommendation(h)));
    res.json({
      count: items.length,
      comicsSource,
      comicsSnapshot: comics.snapshot,
      recommendations: items,
      missingHoldingIds: missingIds,
      minSalesRequired: MIN_SALES_FOR_MARKET_EVIDENCE,
      compsCap: holdingIds.length ? COMPS_HOLDING_CAP : limit,
      ebayAuth: ebayAuthStatus(),
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

  app.get("/api/signals", (_req, res) =>
    res.json({
      ...loadSignalsResponse(),
      signalsIngestion: SIGNALS_INGESTION,
      context: compactSignalsContext(),
      output: signalsOutputFromFeed(),
    }),
  );

  app.get("/api/signals/context", (_req, res) => {
    res.json(compactSignalsContext());
  });

  app.get("/api/signals/output", (_req, res) => {
    res.json(signalsOutputFromFeed());
  });

  app.get("/api/inventory/live-ranges", async (_req, res) => {
    try {
      const map = await loadAllLiveRanges();
      res.json({
        count: map.size,
        note: LIVE_RANGE_COPY,
        ranges: Object.fromEntries([...map.entries()]),
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
        ranges: {},
      });
    }
  });

  app.get("/api/listings", async (_req, res) => {
    try {
      const drafts = await listListingDrafts();
      res.json({ count: drafts.length, drafts, submitReady: false });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
        count: 0,
        drafts: [],
      });
    }
  });

  app.post("/api/listings/queue", async (req, res) => {
    const { holdings, comics, comicsSource } = await buildInventory(deps);
    if (!comics.available) {
      res.status(503).json({
        error: "Comics inventory unavailable — listing queue not computed from sample data",
        comicsSource,
      });
      return;
    }
    const creds = ebayCredsFromEnv();
    const hasEbayCreds = Boolean(
      creds.oauthToken?.trim() || (creds.clientId?.trim() && creds.clientSecret?.trim()),
    );
    try {
      const result = await queueListingDrafts(holdings, req.body, hasEbayCreds);
      if (result.rejected) {
        res.status(400).json({ ok: false, error: result.rejected, drafts: [] });
        return;
      }
      res.json({ ok: true, count: result.drafts.length, drafts: result.drafts });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        drafts: [],
      });
    }
  });

  app.get("/api/transactions", async (_req, res) => {
    try {
      const items = await listInventoryTransactions();
      res.json({ count: items.length, items });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
        count: 0,
        items: [],
      });
    }
  });

  app.post("/api/transactions", async (req, res) => {
    const result = await createInventoryTransaction(req.body);
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }
    res.status(201).json({ ok: true, item: result.row });
  });

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
    const inbox = scanInboxRoot();
    res.json({
      ...scanMeta(),
      inbox: {
        root: inbox,
        configured: Boolean(inbox),
        note: inbox
          ? "POST /api/scan/import-folder starts a batch from this folder"
          : "Set VIP_SCAN_INBOX to your PaperStream output folder to import without a full path",
      },
      intake: {
        sourceDefault: "ricoh_fi8170",
        scannerProfileDefault: "004_Cards",
        upload: "POST /api/scan/import-upload",
        review: "GET /api/scan/batches then IQVault /scan",
      },
    });
  });

  /**
   * Staged batches from Postgres (survive restarts); the in-memory store is
   * only a fallback for a run with no database.
   */
  app.get("/api/scan/batches", async (_req, res) => {
    try {
      const staged = await listStagedBatches();
      res.json({ count: staged.length, batches: staged, store: "postgres" });
    } catch (e) {
      const batches = listScanBatches();
      res.json({
        count: batches.length,
        batches,
        store: "memory",
        storeError: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** Resolve a staged unit into canonical inventory (the ADR 0009 boundary). */
  app.post("/api/scan/units/:id/resolve", async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.catalogKey !== "string" || !body.catalogKey.trim()) {
      res.status(400).json({ ok: false, error: "body.catalogKey required" });
      return;
    }
    const result = await resolveUnit({
      unitId: String(req.params.id),
      catalogKey: body.catalogKey,
      mode: body.mode === "auto_high_confidence" ? "auto_high_confidence" : "operator_confirmed",
      quantity: typeof body.quantity === "number" ? body.quantity : 1,
      acknowledgeDuplicates: body.acknowledgeDuplicates === true,
      assumedGrade: body.assumedGrade ?? null,
      location: body.location ?? null,
    });
    if (!result.ok) {
      res.status(result.status).json(result);
      return;
    }
    res.json(result);
  });

  app.post("/api/scan/units/:id/reject", async (req, res) => {
    const result = await rejectUnit(String(req.params.id), req.body?.reason);
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post("/api/scan/units/:id/edit", async (req, res) => {
    try {
      const body = req.body ?? {};
      const yearRaw = body.year;
      const year =
        yearRaw === "" || yearRaw == null || yearRaw === undefined
          ? null
          : Number(yearRaw);
      const result = await editStagedUnit(String(req.params.id), {
        playerOrCharacter: String(body.playerOrCharacter ?? ""),
        year: Number.isFinite(year) ? year : null,
        brand: body.brand ? String(body.brand) : null,
        setName: body.setName ? String(body.setName) : null,
        collectorNumber: body.collectorNumber ? String(body.collectorNumber) : null,
        parallel: body.parallel ? String(body.parallel) : null,
        team: body.team ? String(body.team) : null,
      });
      if (!result.ok) {
        res.status(result.status).json(result);
        return;
      }
      res.json(result);
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.delete("/api/scan/batches/:id", async (req, res) => {
    const result = await discardBatch(String(req.params.id));
    if (!result.ok) {
      res.status(result.status).json(result);
      return;
    }
    res.json(result);
  });

  app.post("/api/scan/units/:id/swap-faces", async (req, res) => {
    try {
      const result = await swapStagedFaces({ unitId: String(req.params.id) });
      res.json({ ok: true, ...result });
    } catch (e) {
      const status = e instanceof RicohIntakeError ? e.status : 400;
      res.status(status).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/scan/batches/:id/swap-faces", async (req, res) => {
    try {
      const result = await swapStagedFaces({ batchId: String(req.params.id) });
      res.json({ ok: true, ...result });
    } catch (e) {
      const status = e instanceof RicohIntakeError ? e.status : 400;
      res.status(status).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/scan/batches/:id/report", async (req, res) => {
    try {
      const staged = await getStagedBatch(String(req.params.id));
      if (!staged) {
        res.status(404).json({ error: "Scan batch not found" });
        return;
      }
      res.json({
        batchId: staged.id,
        telemetry: staged.telemetry,
        errorsWarnings: staged.errorsWarnings,
        report: acceptanceRows(
          staged.units.map((u) => {
            const split = (u.baseVsParallel ?? {}) as {
              baseDisplayName?: string | null;
              parallelDisplayName?: string | null;
              baseConfidence?: number;
              parallelConfidence?: number;
            };
            return {
              originalFrontRef: u.frontStorageRef,
              pairingNeedsReview: u.pairingNeedsReview,
              pairingConfidence: u.pairingConfidence ?? 0,
              reviewRoute: u.reviewRoute ?? "LOW",
              reviewStatus: u.reviewStatus ?? u.status,
              physicalReimport: u.physicalReimport,
              baseVsParallel: {
                baseDisplayName: split.baseDisplayName ?? null,
                parallelDisplayName: split.parallelDisplayName ?? null,
                baseConfidence: split.baseConfidence ?? 0,
                parallelConfidence: split.parallelConfidence ?? 0,
              },
            };
          }),
        ),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/scan/batches/:id", async (req, res) => {
    try {
      const staged = await getStagedBatch(String(req.params.id));
      if (staged) {
        res.json({ batch: staged, store: "postgres" });
        return;
      }
    } catch {
      /* fall through to in-memory */
    }
    const batch = getScanBatch(String(req.params.id));
    if (!batch) {
      res.status(404).json({ error: "Scan batch not found" });
      return;
    }
    res.json({ batch, store: "memory" });
  });

  app.get("/api/scan/media/:imageId", async (req, res) => {
    try {
      await sendScanMedia(res, String(req.params.imageId));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * Start a batch from the PaperStream drop folder. Preserves masters,
   * pairs front/back, fuses evidence, routes review. Staging only (ADR 0009).
   */
  app.post("/api/scan/import-folder", async (req, res) => {
    try {
      const body = req.body ?? {};
      const holdings = (await buildInventory(deps)).holdings;
      const result = await ingestRicohBatch({
        folder: body.folder ?? null,
        categoryHint: body.categoryHint ?? null,
        notes: body.notes,
        source: body.source,
        scannerProfile: body.scannerProfile,
        pairing: body.pairing ?? "auto",
        holdings,
      });
      res.status(201).json({
        ok: true,
        folder: result.folder,
        fileCount: result.imageCount,
        batchId: result.batchId,
        source: result.source,
        scannerProfile: result.scannerProfile,
        pairingMethod: result.pairingMethod,
        staged: result.staged,
        stagingError: null,
        telemetry: result.telemetry,
        report: acceptanceRows(result.cards),
        errorsWarnings: result.errorsWarnings,
        cards: result.cards,
        decisionNote:
          "Candidates are inferred · unverified. Confirm on /scan. HIGH auto-resolve only when VIP_SCAN_AUTO_RESOLVE=1.",
      });
    } catch (e) {
      const status = e instanceof RicohIntakeError ? e.status : 400;
      res.status(status).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  const uploadJson = express.json({ limit: "20mb" });

  app.post("/api/scan/import-upload/start", async (_req, res) => {
    const started = startUploadSession();
    res.status(201).json({ ok: true, sessionId: started.sessionId });
  });

  app.post("/api/scan/import-upload/file", uploadJson, (req, res) => {
    try {
      const body = req.body ?? {};
      if (typeof body.sessionId !== "string" || typeof body.fileName !== "string") {
        res.status(400).json({ ok: false, error: "sessionId and fileName required" });
        return;
      }
      if (typeof body.contentBase64 !== "string" || !body.contentBase64) {
        res.status(400).json({ ok: false, error: "contentBase64 required" });
        return;
      }
      const written = writeUploadFile(body.sessionId, body.fileName, body.contentBase64);
      res.json({ ok: true, ...written });
    } catch (e) {
      const status = e instanceof RicohIntakeError ? e.status : 400;
      res.status(status).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/scan/import-upload/finish", async (req, res) => {
    try {
      const body = req.body ?? {};
      if (typeof body.sessionId !== "string") {
        res.status(400).json({ ok: false, error: "sessionId required" });
        return;
      }
      const holdings = (await buildInventory(deps)).holdings;
      const result = await finishUploadSession(body.sessionId, {
        categoryHint: body.categoryHint ?? null,
        notes: body.notes,
        source: body.source,
        scannerProfile: body.scannerProfile,
        pairing: body.pairing ?? "auto",
        holdings,
      });
      res.status(201).json({
        ok: true,
        folder: result.folder,
        fileCount: result.imageCount,
        batchId: result.batchId,
        source: result.source,
        scannerProfile: result.scannerProfile,
        pairingMethod: result.pairingMethod,
        staged: result.staged,
        stagingError: null,
        telemetry: result.telemetry,
        report: acceptanceRows(result.cards),
        errorsWarnings: result.errorsWarnings,
        cards: result.cards,
        decisionNote: "Candidates are inferred · unverified. Confirm on /scan.",
      });
    } catch (e) {
      const status = e instanceof RicohIntakeError ? e.status : 400;
      res.status(status).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/scan/import-upload", uploadJson, async (req, res) => {
    try {
      const body = req.body ?? {};
      const files = Array.isArray(body.files) ? body.files : [];
      const holdings = (await buildInventory(deps)).holdings;
      const result = await ingestUploadedFiles(files, {
        categoryHint: body.categoryHint ?? null,
        notes: body.notes,
        source: body.source,
        scannerProfile: body.scannerProfile,
        pairing: body.pairing ?? "auto",
        holdings,
      });
      res.status(201).json({
        ok: true,
        folder: result.folder,
        fileCount: result.imageCount,
        batchId: result.batchId,
        source: result.source,
        scannerProfile: result.scannerProfile,
        pairingMethod: result.pairingMethod,
        staged: result.staged,
        stagingError: null,
        telemetry: result.telemetry,
        report: acceptanceRows(result.cards),
        errorsWarnings: result.errorsWarnings,
        cards: result.cards,
        decisionNote:
          "Candidates are inferred · unverified. Confirm on /scan.",
      });
    } catch (e) {
      const status = e instanceof RicohIntakeError ? e.status : 400;
      res.status(status).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/scan/batches", async (req, res) => {
    try {
      const body = req.body ?? {};
      const inventory =
        Array.isArray(body.inventory) && body.inventory.length > 0
          ? body.inventory
          : inventoryLookupFromHoldings((await buildInventory(deps)).holdings);
      const result = await openScanFromApi({ ...body, inventory });
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

  app.get("/api/batch/001", async (_req, res) => {
    try {
      res.json(await loadBatch001());
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/batch/001/sports/run", async (_req, res) => {
    try {
      const run = await runBatch001Sports();
      res.status(201).json(run);
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/batch/001/items/:slot/inspect", async (req, res) => {
    try {
      const run = await inspectBatch001Item({
        ...(req.body ?? {}),
        slot: Number(req.params.slot),
      });
      res.json(run);
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/scan/units/:id/confirm", async (req, res) => {
    try {
      const body = req.body ?? {};
      const inventory =
        Array.isArray(body.inventory) && body.inventory.length > 0
          ? body.inventory
          : inventoryLookupFromHoldings((await buildInventory(deps)).holdings);
      const result = confirmScanFromApi(
        {
          ...body,
          unitId: String(req.params.id),
        },
        inventory,
      );
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

  /**
   * Comics Terminal edits — same Postgres as Python Comics API :5200.
   * Collector face uses this when :5200 is down so VIP→Postgres is not
   * stuck read-only for operator patches (e.g. Mark verified).
   */
  app.post("/api/comics/holding/:id", async (req, res) => {
    const parsed = comicHoldingPatchBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join("; ") || "Invalid body",
      });
      return;
    }
    const fields =
      "fields" in parsed.data && parsed.data.fields
        ? parsed.data.fields
        : (parsed.data as Record<string, unknown>);
    const patch = deps.updateComicHolding ?? updateComicHolding;
    const result = await patch(String(req.params.id), fields as Record<string, unknown>);
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }
    res.json({
      ok: true,
      row: result.row,
      provenance: result.provenance,
      ruleOrModelVersion: COMICS_WRITE_RULE,
    });
  });

  return app;
}
