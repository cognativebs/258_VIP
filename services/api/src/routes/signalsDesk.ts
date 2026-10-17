import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  ArticlesQuerySchema,
  MeasurementPatchSchema,
  ThesisStatusPatchSchema,
  ThesisTransitionError,
  briefRunning,
  listBriefs,
  listPredictions,
  listTheses,
  measurePrediction,
  runSignalsBrief,
  setThesisStatus,
  signalArticles,
  signalsHealth,
  type FetchLike,
  type Queryable,
} from "../lib/signalsDesk.js";
import type { HuntForSignals } from "../lib/signalExposure.js";

/**
 * Signals Desk routes: article feed, daily Orchestr8 briefs, theses, predictions
 * and source health. Thesis status and prediction outcomes change only here, by
 * the operator; the brief writes drafts.
 */
export type SignalsDeskDeps = {
  db: () => Queryable;
  hunts: () => Promise<ReadonlyArray<HuntForSignals>>;
  orchestr8Url?: string;
  /** Injectable so tests never call a model. */
  orchestr8Fetch?: FetchLike;
};

const UuidParam = z.string().uuid();
const BriefRunBodySchema = z.object({ dryRun: z.boolean().optional(), model: z.string().min(1).max(80).optional() }).strict();

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
const unavailable = (res: Response, e: unknown) => res.status(503).json({ error: e instanceof Error ? e.message : "vault_signals unavailable" });

export function registerSignalsDeskRoutes(app: Express, deps: SignalsDeskDeps): void {
  const orchestr8Url = deps.orchestr8Url ?? process.env.ORCHESTR8_URL ?? "http://127.0.0.1:5210";

  app.get("/api/signals/articles", async (req: Request, res: Response) => {
    const parsed = ArticlesQuerySchema.safeParse(req.query);
    if (!parsed.success) return void res.status(400).json({ error: issues(parsed.error) });
    try {
      res.json(await signalArticles(deps.db(), { ...parsed.data, hunts: await deps.hunts() }));
    } catch (e) {
      unavailable(res, e);
    }
  });

  app.get("/api/signals/briefs", async (req: Request, res: Response) => {
    const limit = Math.min(30, Math.max(1, Number(req.query.limit ?? 7) || 7));
    try {
      res.json({ running: briefRunning(), briefs: await listBriefs({ orchestr8Url, fetchImpl: deps.orchestr8Fetch, limit }) });
    } catch (e) {
      res.status(502).json({ running: briefRunning(), briefs: [], error: `Orchestr8 run store unavailable: ${e instanceof Error ? e.message : e}` });
    }
  });

  app.post("/api/signals/briefs/run", async (req: Request, res: Response) => {
    const parsed = BriefRunBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return void res.status(400).json({ error: issues(parsed.error) });
    try {
      const report = await runSignalsBrief(deps.db(), {
        orchestr8Url,
        fetchImpl: deps.orchestr8Fetch,
        dryRun: parsed.data.dryRun,
        model: parsed.data.model ?? process.env.VIP_SIGNALS_BRIEF_MODEL,
        hunts: await deps.hunts(),
      });
      const code = report.status === "failed" ? 502 : report.status === "skipped" && report.reason.includes("already running") ? 409 : 200;
      res.status(code).json(report);
    } catch (e) {
      unavailable(res, e);
    }
  });

  app.get("/api/theses", async (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    try {
      res.json({
        theses: await listTheses(deps.db(), { status }),
        provenance: {
          note: "Drafts come from the daily Orchestr8 brief (inferred · unverified). Only you set active, retired or invalidated. Buy, Sell and Grade wait for market data. Not prices.",
        },
      });
    } catch (e) {
      unavailable(res, e);
    }
  });

  app.patch("/api/theses/:id", async (req: Request, res: Response) => {
    const id = UuidParam.safeParse(req.params.id);
    const body = ThesisStatusPatchSchema.safeParse(req.body ?? {});
    if (!id.success || !body.success) return void res.status(400).json({ error: body.success ? "expected a thesis id" : issues(body.error) });
    try {
      const row = await setThesisStatus(deps.db(), id.data, body.data);
      if (!row) return void res.status(404).json({ error: "thesis not found" });
      res.json({ ok: true, thesis: row });
    } catch (e) {
      if (e instanceof ThesisTransitionError) return void res.status(409).json({ error: e.message });
      unavailable(res, e);
    }
  });

  app.get("/api/signals/predictions", async (_req: Request, res: Response) => {
    try {
      res.json(await listPredictions(deps.db()));
    } catch (e) {
      unavailable(res, e);
    }
  });

  app.patch("/api/signals/predictions/measurements/:id", async (req: Request, res: Response) => {
    const id = UuidParam.safeParse(req.params.id);
    const body = MeasurementPatchSchema.safeParse(req.body ?? {});
    if (!id.success || !body.success) return void res.status(400).json({ error: body.success ? "expected a measurement id" : issues(body.error) });
    try {
      const row = await measurePrediction(deps.db(), id.data, body.data);
      if (!row) return void res.status(409).json({ error: "measurement not found, not due yet, or already measured" });
      res.json({ ok: true, measurement: row });
    } catch (e) {
      unavailable(res, e);
    }
  });

  app.get("/api/signals/health", async (_req: Request, res: Response) => {
    try {
      res.json(await signalsHealth(deps.db()));
    } catch (e) {
      unavailable(res, e);
    }
  });
}
