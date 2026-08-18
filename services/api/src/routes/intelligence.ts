import type { Express, Request, Response } from "express";
import {
  EMERGING_MARKET_SEEDS,
  PRINT_LIFE_WATCHES,
  scoreCohenCover,
} from "@vip/intelligence";
import { intelligenceSnapshot } from "../lib/intelligence.js";
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
} from "../lib/intelligenceStore.js";
import type { BinderSummary } from "../lib/binderHoldings.js";
import type { ApiHolding } from "../lib/holdings.js";
import { dogfoodSellQueue } from "../lib/sellQueue.js";
import { EMERGING_HUNTS } from "../seeds/hunts-emerging.js";
import { huntCompletion } from "../seeds/hunts.js";

/**
 * Intelligence routes live in their own module so app.ts keeps its inventory /
 * comics wiring readable. The snapshot is derived per request from live
 * inventory plus the manual intelligence store — nothing here is cached.
 */
export type IntelligenceDeps = {
  loadSnapshotInputs: () => Promise<{
    holdings: ApiHolding[];
    binders: BinderSummary[];
  }>;
};

function fail(res: Response, e: unknown): void {
  res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
}

function created(res: Response, body: Record<string, unknown>): void {
  res.status(201).json(body);
}

export function registerIntelligenceRoutes(app: Express, deps: IntelligenceDeps): void {
  async function snapshot() {
    const { holdings, binders } = await deps.loadSnapshotInputs();
    return intelligenceSnapshot(new Date(), { holdings, binders });
  }

  app.get("/api/intelligence", async (_req: Request, res: Response) => {
    res.json(await snapshot());
  });

  app.get("/api/intelligence/predictions", async (_req: Request, res: Response) => {
    const snap = await snapshot();
    res.json({
      version: snap.version,
      signalsIngestion: snap.signalsIngestion,
      ...snap.predictions,
    });
  });

  app.get("/api/intelligence/recommendations", async (_req: Request, res: Response) => {
    const snap = await snapshot();
    res.json({
      version: snap.version,
      count: snap.recommendations.length,
      recommendations: snap.recommendations,
    });
  });

  app.get("/api/intelligence/underwriting", async (_req: Request, res: Response) => {
    const snap = await snapshot();
    res.json({ version: snap.version, underwriting: snap.underwriting });
  });

  app.get("/api/intelligence/grading", async (_req: Request, res: Response) => {
    const snap = await snapshot();
    res.json({ version: snap.version, grading: snap.grading, queue: snap.gradingQueue });
  });

  app.get("/api/intelligence/collection", async (_req: Request, res: Response) => {
    const snap = await snapshot();
    res.json({ version: snap.version, collection: snap.collection });
  });

  app.post("/api/intelligence/predictions", (req: Request, res: Response) => {
    try {
      created(res, { prediction: addPrediction(req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/intelligence/predictions/:id/resolve", (req: Request, res: Response) => {
    const actualPrice = Number(req.body?.actualPrice);
    if (!Number.isFinite(actualPrice)) {
      res.status(400).json({ error: "actualPrice required" });
      return;
    }
    try {
      res.json({
        prediction: resolveStoredPrediction(
          String(req.params.id),
          actualPrice,
          req.body?.explanation,
        ),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/intelligence/underwriting", (req: Request, res: Response) => {
    try {
      created(res, { underwriting: addUnderwriting(req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/intelligence/underwriting/:id/lock", (req: Request, res: Response) => {
    try {
      res.json({ underwriting: lockStoredUnderwriting(String(req.params.id)) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/intelligence/grading", (req: Request, res: Response) => {
    try {
      created(res, { grading: addGrading(req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/intelligence/cycle", (req: Request, res: Response) => {
    try {
      created(res, addManualCycle(req.body ?? {}) as Record<string, unknown>);
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/intelligence/sessions", (req: Request, res: Response) => {
    try {
      created(res, { session: startFieldSession(req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/intelligence/sessions/:id/capture", (req: Request, res: Response) => {
    try {
      created(res, {
        capture: captureFieldItem({ sessionId: String(req.params.id), ...(req.body ?? {}) }),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/intelligence/cohen-score", (req: Request, res: Response) => {
    try {
      res.json({ score: scoreCohenCover(req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/intelligence/golden-cases", (req: Request, res: Response) => {
    try {
      created(res, { goldenCase: addGoldenCaseRow(req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  // Manual watch lists: scoring stays off until Signals velocity is live, so
  // these report scoringEnabled:false rather than implying a computed stance.
  app.get("/api/intelligence/print-life", (_req: Request, res: Response) => {
    res.json({
      scoringEnabled: false,
      note: "Manual watch only — Pokémon has no official OOP registry and reprints happen.",
      watches: PRINT_LIFE_WATCHES,
    });
  });

  app.get("/api/intelligence/emerging-markets", (_req: Request, res: Response) => {
    res.json({
      scoringEnabled: false,
      experimentBudgetUsd: 1000,
      note: "90-day experiment seeds. BUY MORE / HOLD / EXIT stays manual until Signals velocity is live.",
      markets: EMERGING_MARKET_SEEDS,
    });
  });

  app.get("/api/hunts/emerging", (_req: Request, res: Response) => {
    res.json({
      note: "Conversation-synthesis hunts — prices and print runs unverified.",
      hunts: EMERGING_HUNTS.map((h) => ({ ...h, metrics: huntCompletion(h) })),
    });
  });

  /**
   * Sell queue ranked by grading EV + evidence freshness. Kept separate from
   * /api/sell-queue, which returns plain holdings the collector face renders.
   */
  app.get("/api/sell-queue/dogfood", async (_req: Request, res: Response) => {
    const { holdings } = await deps.loadSnapshotInputs();
    res.json(await dogfoodSellQueue(holdings, 20));
  });
}
