"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import type { StageStripModel } from "../components/StageStrip";
import { IngestView } from "../views/IngestView";
import { nextScanSelection, selectScan } from "./scanLog";
import type { IngestBatchCard, IngestFlowModel } from "./types";

type ApiBatch = {
  id: string;
  name: string | null;
  lifecycle: string;
  destination: string | null;
  ingestMethod: string | null;
  scanUnits: number;
  ingestRows: number;
  identified: number;
  review: number;
  lastActivityAt: string;
  stale: boolean;
};

type Workspace = {
  destinations: { id: string; label: string }[];
  methods: { key: string; label: string; enabled: boolean; disabledReason?: string }[];
  batches: ApiBatch[];
  binders: { id: string; name: string }[];
  hunts: { id: string; name: string }[];
  presets: { id: string; label: string }[];
};

type Detail = {
  batch: ApiBatch & { subtargetKind?: string | null };
  rows: Array<Record<string, unknown>>;
  stages: StageStripModel;
  batchTotal?: number;
  methodNote: string | null;
};

type CaptureResult =
  | { kind: "rejected"; reason: string }
  | { kind: "duplicate"; rowId: string; gtin14: string; quantity: number }
  | { kind: "known"; rowId: string; gtin14: string; productLabel: string | null; quantity: number; thinComps: boolean }
  | { kind: "unknown"; rowId: string; gtin14: string; quantity: number };

const EMPTY_STAGES: StageStripModel = {
  capture: "waiting",
  identified: 0,
  captured: 0,
  review: 0,
  commitEnabled: false,
  partialAvailable: false,
};

function card(batch: ApiBatch): IngestBatchCard {
  return {
    id: batch.id,
    name: batch.name ?? "Untitled batch",
    destination: batch.destination,
    method: batch.ingestMethod,
    lifecycle: batch.lifecycle,
    captured: batch.scanUnits + batch.ingestRows,
    identified: batch.identified,
    review: batch.review,
    scanUnits: batch.scanUnits,
    lastActivity: batch.lastActivityAt?.slice(0, 10) ?? "",
    stale: batch.stale,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Ingest request failed";
}

export function IngestScreen() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [subtargetKind, setSubtargetKind] = useState<"" | "binder" | "hunt">("");
  const [subtargetId, setSubtargetId] = useState("");
  const [methodKey, setMethodKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pausedNotice, setPausedNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDraft, setConfirmDraft] = useState("");
  const batchIdRef = useRef<string | null>(null);
  const sessionIds = useRef(new Set<string>());
  const followNewest = useRef(true);
  const selectedRef = useRef<string | null>(null);
  const [commitNote, setCommitNote] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [csvPresetId, setCsvPresetId] = useState<string | null>(null);
  const [csv, setCsv] = useState<IngestFlowModel["csv"]>(null);

  const load = useCallback(async (q: string) => {
    const data = await apiGet<Workspace>(`/api/ingest/workspace?q=${encodeURIComponent(q)}`);
    setWorkspace(data);
    return data;
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      load(query).catch((err: unknown) => setError(message(err)));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [load, query]);

  const openBatch = useCallback(async (id: string) => {
    const next = await apiGet<Detail>(`/api/ingest/batches/${id}`);
    if (batchIdRef.current !== id) {
      batchIdRef.current = id;
      sessionIds.current = new Set();
      followNewest.current = true;
      selectedRef.current = null;
    }
    const choice = nextScanSelection({
      rows: next.rows.map((row) => ({ id: String(row.id) })),
      selectedId: selectedRef.current,
      followNewest: followNewest.current,
    });
    followNewest.current = choice.followNewest;
    selectedRef.current = choice.selectedId;
    setSelectedId(choice.selectedId);
    setDetail(next);
    setDestinationId(next.batch.destination);
    setMethodKey(next.batch.ingestMethod);
    return next;
  }, []);

  const destinations = workspace?.destinations ?? [];
  const methods = workspace?.methods ?? [];
  const destination = destinations.find((item) => item.id === destinationId);
  const method = methods.find((item) => item.key === methodKey);
  const batches = (workspace?.batches ?? [])
    .filter((batch) => !destinationId || batch.destination === destinationId || batch.destination == null)
    .map(card);

  const scannerBatch =
    detail?.batch.ingestMethod === "scanner_hid" || detail?.batch.ingestMethod === "scanner_batch";
  const scanRows = (detail?.rows ?? []).map((row) => ({
    id: String(row.id),
    label: scannerBatch
      ? String(row.gtin14 ?? row.raw_code ?? row.product_label ?? "Scan")
      : String(row.product_label ?? row.gtin14 ?? row.raw_code ?? "Unlabeled row"),
    productLabel: row.product_label == null ? null : String(row.product_label),
    quantity: scannerBatch ? Number(row.rollup ?? row.quantity ?? 1) : Number(row.quantity ?? 1),
    review: Boolean(row.needs_review) && !row.committed_at && !row.voided,
    reason: row.review_reason == null ? null : String(row.review_reason),
    voided: Boolean(row.voided),
    createdAt: String(row.created_at ?? "").slice(0, 19),
  }));

  const model: IngestFlowModel = {
    error,
    destinationId,
    destinations,
    subtargetKind,
    subtargetId,
    binders: workspace?.binders ?? [],
    hunts: workspace?.hunts ?? [],
    methodKey,
    methods,
    query,
    batches,
    pausedNotice,
    detail: detail
      ? {
          id: detail.batch.id,
          name: detail.batch.name ?? "Untitled batch",
          destinationLabel: destination?.label ?? detail.batch.destination ?? "Destination not recorded",
          lifecycle: detail.batch.lifecycle,
          methodKey: detail.batch.ingestMethod,
          methodLabel: method?.label ?? detail.batch.ingestMethod ?? "Method not recorded",
          stages: detail.stages ?? EMPTY_STAGES,
          rows: scanRows,
          methodNote: detail.methodNote,
          sessionCount: scanRows.filter((row) => sessionIds.current.has(row.id) && !row.voided).length,
          batchTotal: Number(detail.batchTotal ?? 0),
          selectedId,
        }
      : null,
    captureError,
    duplicateNotice,
    confirmDraft,
    commitNote,
    csvText,
    csvPresetId,
    presets: workspace?.presets ?? [],
    csv,
  };

  return (
    <IngestView
      model={model}
      actions={{
        onDestination: (id) => {
          setDestinationId(id);
          setMethodKey(null);
          setSubtargetKind("");
          setSubtargetId("");
          setDetail(null);
        },
        onSubtargetKind: (kind) => {
          setSubtargetKind(kind);
          setSubtargetId("");
        },
        onSubtargetId: setSubtargetId,
        onMethod: setMethodKey,
        onQuery: setQuery,
        onCreate: () => {
          if (!destinationId || !methodKey) return;
          setError(null);
          apiPost<{ id: string; paused: { notice: string } | null }>("/api/ingest/batches", {
            destination: destinationId,
            subtargetKind: subtargetKind || null,
            subtargetId: subtargetId || null,
            method: methodKey,
          })
            .then(async (created) => {
              setPausedNotice(created.paused?.notice ?? null);
              await load(query);
              await openBatch(created.id);
            })
            .catch((err: unknown) => setError(message(err)));
        },
        onOpen: (id) => {
          setError(null);
          openBatch(id).catch((err: unknown) => setError(message(err)));
        },
        onResume: (id) => {
          setError(null);
          apiPost(`/api/ingest/batches/${id}/lifecycle`, { action: "resume" })
            .then(async () => {
              setPausedNotice("The previous active batch for this destination was paused.");
              await load(query);
              await openBatch(id);
            })
            .catch((err: unknown) => setError(message(err)));
        },
        onAbandon: (id) => {
          setError(null);
          apiPost(`/api/ingest/batches/${id}/lifecycle`, { action: "abandon" })
            .then(async () => {
              await load(query);
              setDetail(null);
            })
            .catch((err: unknown) => setError(message(err)));
        },
        onBack: () => setDetail(null),
        onCapture: (code) => {
          if (!detail) return;
          setCaptureError(null);
          setDuplicateNotice(null);
          apiPost<{ results: CaptureResult[] }>(`/api/ingest/batches/${detail.batch.id}/capture`, { codes: [code] })
            .then(async (body) => {
              applyCapture(body.results);
              await openBatch(detail.batch.id);
            })
            .catch((err: unknown) => setCaptureError(message(err)));
        },
        onPaste: (text) => {
          if (!detail) return;
          const codes = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          setCaptureError(null);
          setDuplicateNotice(null);
          apiPost<{ results: CaptureResult[] }>(`/api/ingest/batches/${detail.batch.id}/capture`, { codes })
            .then(async (body) => {
              applyCapture(body.results);
              await openBatch(detail.batch.id);
            })
            .catch((err: unknown) => setCaptureError(message(err)));
        },
        onSelectScan: (id) => {
          const choice = selectScan(
            (detail?.rows ?? []).map((row) => ({ id: String(row.id) })),
            id,
          );
          followNewest.current = choice.followNewest;
          selectedRef.current = choice.selectedId;
          setSelectedId(choice.selectedId);
        },
        onUndo: () => {
          if (!detail) return;
          apiPost(`/api/ingest/batches/${detail.batch.id}/undo`, {})
            .then(async () => openBatch(detail.batch.id))
            .catch((err: unknown) => setCaptureError(message(err)));
        },
        onConfirmDraft: setConfirmDraft,
        onConfirmUnknown: () => {
          if (!detail || !selectedRef.current) return;
          apiPost(`/api/ingest/batches/${detail.batch.id}/confirm-gtin`, {
            rowId: selectedRef.current,
            productLabel: confirmDraft,
          })
            .then(async () => {
              setConfirmDraft("");
              await openBatch(detail.batch.id);
            })
            .catch((err: unknown) => setError(message(err)));
        },
        onManual: (fields) => {
          if (!detail) return;
          apiPost(`/api/ingest/batches/${detail.batch.id}/manual`, fields)
            .then(async () => openBatch(detail.batch.id))
            .catch((err: unknown) => setError(message(err)));
        },
        onQueue: (names) => {
          if (!detail) return;
          apiPost(`/api/ingest/batches/${detail.batch.id}/queue`, {
            names: names.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          })
            .then(async () => openBatch(detail.batch.id))
            .catch((err: unknown) => setError(message(err)));
        },
        onCommit: (partial) => {
          if (!detail) return;
          apiPost<{ blocked: { reason: string }[]; dealerNote: string | null; partial: boolean }>(
            `/api/ingest/batches/${detail.batch.id}/commit`,
            { partial },
          )
            .then(async (result) => {
              const reasons = result.blocked.map((item) => item.reason).filter(Boolean);
              const note = [result.dealerNote, reasons[0], result.partial ? "Review items stay in the batch." : null]
                .filter(Boolean)
                .join(" ");
              setCommitNote(note || "Committed.");
              await load(query);
              await openBatch(detail.batch.id);
            })
            .catch((err: unknown) => setError(message(err)));
        },
        onCsvText: setCsvText,
        onCsvPreset: setCsvPresetId,
        onCsvPreview: () => {
          apiPost<{
            presetLabel: string | null;
            headers: string[];
            mapped: Record<string, number | null>;
            duplicates: number;
          }>("/api/ingest/csv/preview", { text: csvText, presetId: csvPresetId })
            .then((preview) => {
              setCsv({
                presetLabel: preview.presetLabel ?? "Custom",
                headers: preview.headers,
                mapped: Object.entries(preview.mapped).map(([field, index]) => ({
                  field,
                  column: index == null ? null : (preview.headers[index] ?? null),
                })),
                duplicates: preview.duplicates,
              });
            })
            .catch((err: unknown) => setError(message(err)));
        },
        onCsvStore: () => {
          if (!detail) return;
          apiPost(`/api/ingest/batches/${detail.batch.id}/csv`, { text: csvText, presetId: csvPresetId })
            .then(async () => openBatch(detail.batch.id))
            .catch((err: unknown) => setError(message(err)));
        },
      }}
    />
  );

  function applyCapture(results: CaptureResult[]) {
    for (const result of results) {
      if ("rowId" in result) sessionIds.current.add(result.rowId);
    }
    const rejected = results.find((item) => item.kind === "rejected");
    const duplicate = [...results].reverse().find((item) => item.kind === "duplicate");
    setCaptureError(rejected && rejected.kind === "rejected" ? rejected.reason : null);
    setDuplicateNotice(
      duplicate && duplicate.kind === "duplicate"
        ? `Duplicate ${duplicate.gtin14}. Quantity is now ${duplicate.quantity}.`
        : null,
    );
  }
}
