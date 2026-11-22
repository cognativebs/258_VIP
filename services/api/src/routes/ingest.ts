import type { Express } from "express";
import { IngestError, captureCodes, commitBatch, confirmGtin, createIngestBatch, addManualRow, getIngestBatch, ingestWorkspace, previewCsv, queueNames, setBatchLifecycle, storeCsv, undoLastScan } from "../lib/ingestStore.js";

function fail(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown) {
  const status = error instanceof IngestError ? error.status : 500;
  res.status(status).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

export function registerIngestRoutes(app: Express) {
  app.get("/api/ingest/workspace", async (req, res) => {
    try {
      res.json(await ingestWorkspace(typeof req.query.q === "string" ? req.query.q : ""));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/ingest/batches/:id", async (req, res) => {
    try {
      res.json(await getIngestBatch(String(req.params.id)));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/ingest/batches", async (req, res) => {
    try {
      const body = req.body ?? {};
      const created = await createIngestBatch({
        destination: String(body.destination ?? ""),
        subtargetKind: body.subtargetKind ?? null,
        subtargetId: body.subtargetId ?? null,
        method: String(body.method ?? ""),
        name: body.name ?? null,
      });
      res.status(201).json(created);
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/ingest/batches/:id/lifecycle", async (req, res) => {
    try {
      const action = String(req.body?.action ?? "");
      if (action !== "pause" && action !== "abandon" && action !== "resume") {
        res.status(400).json({ ok: false, error: "Action must be pause, abandon, or resume." });
        return;
      }
      res.json(await setBatchLifecycle(String(req.params.id), action));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/ingest/batches/:id/capture", async (req, res) => {
    try {
      const body = req.body ?? {};
      const codes = Array.isArray(body.codes)
        ? body.codes.map(String)
        : [String(body.code ?? "")];
      res.json({ results: await captureCodes(String(req.params.id), codes, body) });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/ingest/batches/:id/undo", async (req, res) => {
    try {
      res.json(await undoLastScan(String(req.params.id)));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/ingest/batches/:id/confirm-gtin", async (req, res) => {
    try {
      const body = req.body ?? {};
      res.json(
        await confirmGtin({
          batchId: String(req.params.id),
          rowId: String(body.rowId ?? ""),
          productLabel: String(body.productLabel ?? ""),
          assetId: body.assetId ?? null,
          confirmedBy: body.confirmedBy ?? null,
        }),
      );
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/ingest/batches/:id/manual", async (req, res) => {
    try {
      const body = req.body ?? {};
      res.json(
        await addManualRow({
          batchId: String(req.params.id),
          productLabel: String(body.productLabel ?? ""),
          quantity: Number(body.quantity ?? 1),
          costBasis: body.costBasis == null || body.costBasis === "" ? null : Number(body.costBasis),
          acquiredOn: body.acquiredOn ?? null,
          assumedGrade: body.assumedGrade ?? null,
          assetId: body.assetId ?? null,
        }),
      );
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/ingest/batches/:id/queue", async (req, res) => {
    try {
      const names = Array.isArray(req.body?.names) ? req.body.names.map(String) : [];
      res.json(await queueNames(String(req.params.id), names));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/ingest/csv/preview", async (req, res) => {
    try {
      res.json(
        await previewCsv({
          text: String(req.body?.text ?? ""),
          presetId: req.body?.presetId ?? null,
          columnMap: req.body?.columnMap ?? null,
        }),
      );
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/ingest/batches/:id/csv", async (req, res) => {
    try {
      res.json(
        await storeCsv(String(req.params.id), {
          text: String(req.body?.text ?? ""),
          presetId: req.body?.presetId ?? null,
          columnMap: req.body?.columnMap ?? null,
        }),
      );
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/ingest/batches/:id/commit", async (req, res) => {
    try {
      res.json(await commitBatch(String(req.params.id), req.body?.partial === true));
    } catch (error) {
      fail(res, error);
    }
  });
}
