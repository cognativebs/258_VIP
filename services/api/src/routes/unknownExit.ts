import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { postgresUnknownExitStore, type UnknownExitStore } from "../lib/unknownExit.js";

function fail(res: Response, e: unknown): void {
  if (e instanceof ZodError) {
    const detail = e.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    res.status(400).json({ ok: false, error: detail });
    return;
  }
  const message = e instanceof Error ? e.message : String(e);
  const status = message.toLowerCase().includes("no general inventory") ? 400 : 500;
  res.status(status).json({ ok: false, error: message });
}

export function registerUnknownExitRoutes(
  app: Express,
  store: UnknownExitStore = postgresUnknownExitStore(),
): void {
  app.get("/api/comics/unknown-exit", async (_req: Request, res: Response) => {
    try {
      const payload = await store.load();
      res.json({ ok: true, ...payload });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/comics/unknown-exit", async (req: Request, res: Response) => {
    try {
      const payload = await store.create(req.body ?? {});
      res.json({
        ok: true,
        ...payload,
        outputAction: payload.impact?.recommendations[0]?.action ?? "Pass",
        note: "Holdings were not deleted. Titles stay listed. Value is a range, inferred · unverified.",
      });
    } catch (e) {
      fail(res, e);
    }
  });
}
