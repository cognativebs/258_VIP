import type { PageChase } from "../lib/binderPageChase.js";
import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import {
  EMERGING_MARKET_SEEDS,
  PRINT_LIFE_WATCHES,
  ResolvePredictionRequestSchema,
  scoreCohenCover,
} from "@vip/intelligence";
import { intelligenceSnapshot } from "../lib/intelligence.js";
import type { IntelligenceStore } from "../lib/intelligenceStore.js";
import {
  IntelligenceStoreUnavailableError,
  createIntelligenceStoreSelector,
  type IntelligenceStoreSelector,
  type StoreResult,
} from "../lib/intelligenceStoreSelect.js";
import type { BinderSummary } from "../lib/binderHoldings.js";
import type { ApiHolding } from "../lib/holdings.js";
import { dogfoodSellQueue, parseSellQueueLimit } from "../lib/sellQueue.js";
import type { Queryable } from "../lib/huntStore.js";
import {
  SELL_QUEUE_DECISION_RULE,
  latestSellQueueDecisions,
  recordSellQueueDecision,
  sellQueueDecisionHistory,
} from "../lib/sellQueueDecisions.js";
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
    pageChase?: PageChase[];
  }>;
  /** Injectable so tests choose the backend (JSON temp file, or Postgres inside a rolled-back transaction). */
  intelligenceStore?: IntelligenceStoreSelector;
  /** Q16 decision log (vault_collection.sell_queue_decision). Absent: marks not loaded, POST 503. */
  decisionsDb?: () => Queryable;
};

/**
 * Guardrail rejections are shown to the operator in the intelligence desk, so
 * flatten zod issues into a sentence instead of echoing raw JSON.
 */
function fail(res: Response, e: unknown): void {
  if (e instanceof IntelligenceStoreUnavailableError) {
    res.status(503).json({ error: e.message });
    return;
  }
  if (e instanceof ZodError) {
    const detail = e.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    res.status(400).json({ error: detail });
    return;
  }
  res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
}

export function registerIntelligenceRoutes(app: Express, deps: IntelligenceDeps): void {
  const stores = deps.intelligenceStore ?? createIntelligenceStoreSelector();

  async function snapshot() {
    const [{ holdings, binders, pageChase }, manual] = await Promise.all([
      deps.loadSnapshotInputs(),
      stores.run(async (s) => ({ doc: await s.load(), due: await s.duePredictions(new Date()) })),
    ]);
    return intelligenceSnapshot(
      new Date(),
      { holdings, binders, pageChase },
      {
        kind: manual.store,
        doc: manual.value.doc,
        due: manual.value.due,
        fallbackReason: manual.fallbackReason,
      },
    );
  }

  /** Run a store call and answer with its result plus which backend took it. */
  async function write(
    res: Response,
    status: number,
    fn: (s: IntelligenceStore) => Promise<Record<string, unknown>>,
  ): Promise<void> {
    try {
      const out: StoreResult<Record<string, unknown>> = await stores.run(fn);
      res.status(status).json({
        ...out.value,
        store: out.store,
        ...(out.fallbackReason ? { fallbackReason: out.fallbackReason } : {}),
      });
    } catch (e) {
      fail(res, e);
    }
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

  /**
   * Predictions whose horizon has passed with no outcome recorded. Postgres
   * mode reads vault_core.prediction_needs_scoring; nothing here resolves.
   */
  app.get("/api/intelligence/predictions/due", async (_req: Request, res: Response) => {
    try {
      const out = await stores.run((s) => s.duePredictions(new Date()));
      res.json({
        ...JSON.parse(JSON.stringify(out.value)),
        ...(out.fallbackReason ? { fallbackReason: out.fallbackReason } : {}),
      });
    } catch (e) {
      if (e instanceof IntelligenceStoreUnavailableError) fail(res, e);
      else res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/intelligence/predictions", (req: Request, res: Response) =>
    write(res, 201, async (s) => ({ prediction: await s.addPrediction(req.body ?? {}) })),
  );

  /** A person records the outcome. Refused before resolvesAt and on an already-resolved row. */
  app.post("/api/intelligence/predictions/:id/resolve", (req: Request, res: Response) => {
    const raw = req.body?.actualPrice;
    if (raw == null || raw === "" || !Number.isFinite(Number(raw))) {
      res.status(400).json({ error: "actualPrice required" });
      return;
    }
    const parsed = ResolvePredictionRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, parsed.error);
      return;
    }
    const body = parsed.data;
    return write(res, 200, async (s) => ({
      prediction: await s.resolvePrediction(String(req.params.id), body.actualPrice, {
        explanation: body.explanation || undefined,
        modelAdjustment: body.modelAdjustment || undefined,
      }),
    }));
  });

  app.post("/api/intelligence/underwriting", (req: Request, res: Response) =>
    write(res, 201, async (s) => ({ underwriting: await s.addUnderwriting(req.body ?? {}) })),
  );

  app.post("/api/intelligence/underwriting/:id/lock", (req: Request, res: Response) =>
    write(res, 200, async (s) => ({ underwriting: await s.lockUnderwriting(String(req.params.id)) })),
  );

  app.post("/api/intelligence/grading", (req: Request, res: Response) =>
    write(res, 201, async (s) => ({ grading: await s.addGrading(req.body ?? {}) })),
  );

  app.post("/api/intelligence/cycle", (req: Request, res: Response) =>
    write(res, 201, async (s) => (await s.addManualCycle(req.body ?? {})) as Record<string, unknown>),
  );

  app.post("/api/intelligence/sessions", (req: Request, res: Response) =>
    write(res, 201, async (s) => ({ session: await s.startFieldSession(req.body ?? {}) })),
  );

  app.post("/api/intelligence/sessions/:id/capture", (req: Request, res: Response) =>
    write(res, 201, async (s) => ({
      capture: await s.captureFieldItem({ ...(req.body ?? {}), sessionId: String(req.params.id) }),
    })),
  );

  app.post("/api/intelligence/cohen-score", (req: Request, res: Response) => {
    try {
      res.json({ score: scoreCohenCover(req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/intelligence/golden-cases", (req: Request, res: Response) =>
    write(res, 201, async (s) => ({ goldenCase: await s.addGoldenCase(req.body ?? {}) })),
  );

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
  app.get("/api/sell-queue/dogfood", async (req: Request, res: Response) => {
    try {
      const { holdings } = await deps.loadSnapshotInputs();
      const queue = await dogfoodSellQueue(holdings, parseSellQueueLimit(req.query.limit));
      if (!deps.decisionsDb) {
        res.json(queue);
        return;
      }
      try {
        const marks = await latestSellQueueDecisions(
          deps.decisionsDb(),
          queue.items.map((i) => i.holdingId),
        );
        res.json({
          ...queue,
          operatorMarks: "recorded",
          items: queue.items.map((i) => {
            const m = marks.get(i.holdingId);
            return {
              ...i,
              latestDecision: m
                ? { decision: m.decision, action: m.action, reason: m.reason, decidedAt: m.decidedAt }
                : null,
            };
          }),
        });
      } catch {
        res.json({ ...queue, operatorMarks: "unavailable" });
      }
    } catch (e) {
      fail(res, e);
    }
  });

  /** Q16: append an operator accept / reject mark. Changes no holding or listing. */
  app.post("/api/sell-queue/decisions", async (req: Request, res: Response) => {
    if (!deps.decisionsDb) {
      res.status(503).json({ error: "Decision log is not configured" });
      return;
    }
    try {
      const decision = await recordSellQueueDecision(deps.decisionsDb(), req.body);
      res.status(201).json({ ok: true, decision, ruleVersion: SELL_QUEUE_DECISION_RULE });
    } catch (e) {
      fail(res, e);
    }
  });

  /** Q16: mark history for one holding (?holdingId=), newest first. */
  app.get("/api/sell-queue/decisions", async (req: Request, res: Response) => {
    const ref = String(req.query.holdingId ?? "").trim();
    if (!ref) {
      res.status(400).json({ error: "expected ?holdingId=<sell-queue item id>" });
      return;
    }
    if (!deps.decisionsDb) {
      res.status(503).json({ error: "Decision log is not configured" });
      return;
    }
    try {
      res.json({ holdingId: ref, decisions: await sellQueueDecisionHistory(deps.decisionsDb(), ref) });
    } catch (e) {
      fail(res, e);
    }
  });
}
