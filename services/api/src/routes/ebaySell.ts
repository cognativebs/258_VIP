import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { SellingDispositionSchema } from "@vip/ebay-sell";
import type { ApiHolding } from "../lib/holdings.js";
import type { EbaySellService } from "../lib/ebaySell/service.js";

export type EbaySellRouteDeps = {
  loadHoldings: () => Promise<ApiHolding[]>;
  service: EbaySellService;
};

function fail(res: Response, e: unknown, status = 400): void {
  if (e instanceof ZodError) {
    res.status(status).json({
      error: e.issues.map((i) => i.message).join("; "),
    });
    return;
  }
  res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
}

async function holdingOr404(
  deps: EbaySellRouteDeps,
  id: string,
  res: Response,
): Promise<ApiHolding | null> {
  const holdings = await deps.loadHoldings();
  const holding = holdings.find((h) => h.id === id || h.holdingUuid === id);
  if (!holding) {
    res.status(404).json({ error: "Holding not found" });
    return null;
  }
  return holding;
}

export function registerEbaySellRoutes(app: Express, deps: EbaySellRouteDeps): void {
  app.get("/api/ebay/sell/health", async (_req, res) => {
    res.json(await deps.service.connection());
  });

  app.get("/api/ebay/sell/auth/start", async (req, res) => {
    const state = String(req.query.state ?? `vip-${Date.now()}`);
    const started = await deps.service.startAuth(state);
    res.json(started);
  });

  app.get("/api/ebay/sell/auth/callback", async (req, res) => {
    try {
      const code = String(req.query.code ?? "");
      if (!code) {
        res.status(400).json({ error: "Missing authorization code" });
        return;
      }
      const status = await deps.service.handleCallback(code);
      res.json({ ok: true, status });
    } catch (e) {
      fail(res, e, 502);
    }
  });

  app.post("/api/ebay/sell/auth/disconnect", async (_req, res) => {
    res.json(await deps.service.disconnect());
  });

  app.get("/api/ebay/sell/dashboard", async (_req, res) => {
    try {
      const holdings = await deps.loadHoldings();
      res.json(await deps.service.dashboard(holdings));
    } catch (e) {
      fail(res, e, 500);
    }
  });

  app.get("/api/ebay/sell/item/:id", async (req, res) => {
    try {
      const holdings = await deps.loadHoldings();
      const detail = await deps.service.itemDetail(holdings, String(req.params.id));
      if (!detail) {
        res.status(404).json({ error: "Holding not found" });
        return;
      }
      res.json(detail);
    } catch (e) {
      fail(res, e, 500);
    }
  });

  app.post("/api/ebay/sell/item/:id/disposition", async (req: Request, res: Response) => {
    try {
      const holding = await holdingOr404(deps, String(req.params.id), res);
      if (!holding) return;
      const override = req.body?.disposition
        ? {
            disposition: SellingDispositionSchema.parse(req.body.disposition),
            reasonText: String(req.body.reasonText ?? "Operator override"),
          }
        : undefined;
      res.json({ recommendation: await deps.service.recommendFor(holding, override) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/ebay/sell/item/:id/draft", async (req, res) => {
    try {
      const holding = await holdingOr404(deps, String(req.params.id), res);
      if (!holding) return;
      res.json(await deps.service.draftFromHolding(holding));
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/ebay/sell/listings/:id/publish", async (req, res) => {
    try {
      const holdings = await deps.loadHoldings();
      const listingId = String(req.params.id);
      const inventoryId = String(req.body?.inventoryId ?? "");
      const holding = holdings.find((h) => h.id === inventoryId);
      if (!holding) {
        res.status(404).json({ error: "Holding not found" });
        return;
      }
      res.json(await deps.service.approveAndPublish(holding, listingId));
    } catch (e) {
      fail(res, e, 502);
    }
  });

  app.get("/api/ebay/sell/queue", async (req, res) => {
    try {
      const holdings = await deps.loadHoldings();
      if (req.query.rebuild === "1") {
        res.json({ items: await deps.service.rebuildQueue(holdings) });
        return;
      }
      const date = new Date().toISOString().slice(0, 10);
      const rebuilt = await deps.service.rebuildQueue(holdings);
      res.json({ date, items: rebuilt });
    } catch (e) {
      fail(res, e, 500);
    }
  });

  app.post("/api/ebay/sell/queue/:id/action", async (req, res) => {
    try {
      const holdings = await deps.loadHoldings();
      const action = String(req.body?.action ?? "");
      const allowed = ["approve", "edit", "defer", "hold", "change_disposition", "reject"] as const;
      if (!allowed.includes(action as (typeof allowed)[number])) {
        res.status(400).json({ error: "Invalid queue action" });
        return;
      }
      res.json(
        await deps.service.actOnQueue(
          holdings,
          String(req.params.id),
          action as (typeof allowed)[number],
          String(req.body?.note ?? ""),
          req.body?.disposition,
        ),
      );
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/ebay/sell/lots", async (_req, res) => {
    try {
      const holdings = await deps.loadHoldings();
      res.json({ proposals: await deps.service.lots(holdings) });
    } catch (e) {
      fail(res, e, 500);
    }
  });

  app.post("/api/ebay/sell/lots/accept", async (req, res) => {
    try {
      res.json({ lot: await deps.service.acceptLot(req.body) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/ebay/sell/lots/:id/reject", async (req, res) => {
    try {
      res.json({ lot: await deps.service.rejectLot(String(req.params.id)) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/ebay/sell/experiments", async (_req, res) => {
    res.json(await deps.service.experiments());
  });

  app.post("/api/ebay/sell/jobs/listing-sync", async (_req, res) => {
    res.json({
      ok: true,
      note: "Listing-state sync uses GET offer per active listing when connected.",
      connection: await deps.service.connection(),
    });
  });

  app.post("/api/ebay/sell/jobs/order-sync", async (_req, res) => {
    try {
      const holdings = await deps.loadHoldings();
      res.json(await deps.service.syncOrders(holdings));
    } catch (e) {
      fail(res, e, 502);
    }
  });

  app.post("/api/ebay/sell/jobs/traffic-sync", async (_req, res) => {
    res.json(await deps.service.syncTraffic());
  });

  app.post("/api/ebay/sell/orders/ingest", async (req, res) => {
    try {
      const holdings = await deps.loadHoldings();
      res.json(await deps.service.ingestOrderLines(holdings, req.body));
    } catch (e) {
      fail(res, e);
    }
  });
}
