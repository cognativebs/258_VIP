"use client";

import { useCallback, useEffect, useState } from "react";
import {
  discardScanBatch,
  editScanUnit,
  fetchScanBatches,
  fetchScanMeta,
  finishScanUpload,
  importScanFolder,
  rejectScanUnit,
  resolveScanUnit,
  scanMediaUrl,
  startScanUpload,
  swapScanFaces,
  uploadScanFile,
  type ImportScanResult,
  type ScanCategory,
  type ScanMeta,
  type ScanPairing,
  type StagedBatch,
  type StagedUnit,
} from "@/lib/scanApi";

const CATEGORIES: Array<{ id: ScanCategory; label: string }> = [
  { id: "sports", label: "Sports cards" },
  { id: "pokemon", label: "Pokemon TCG" },
  { id: "mtg", label: "Magic: The Gathering" },
];

const BAND_COPY: Record<string, { label: string; className: string }> = {
  auto: { label: "auto-resolvable", className: "badge badge-ok" },
  review: { label: "needs review", className: "badge badge-warn" },
  weak: { label: "weak match", className: "badge badge-danger" },
  none: { label: "no match", className: "badge badge-danger" },
};

const ROUTE_COPY: Record<string, { label: string; className: string }> = {
  HIGH: { label: "HIGH", className: "badge badge-ok" },
  MEDIUM: { label: "MEDIUM", className: "badge badge-warn" },
  LOW: { label: "LOW", className: "badge badge-danger" },
  CONFLICT: { label: "CONFLICT", className: "badge badge-danger" },
};

function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

function fileName(ref: string): string {
  return ref.split(/[\\/]/).pop() ?? ref;
}

/** ADR 0009 / fixture lots — not the operator's Ricoh drop. */
function isLabTestBatch(batch: StagedBatch): boolean {
  const notes = `${batch.notes ?? ""} ${batch.units[0]?.frontStorageRef ?? ""}`.toLowerCase();
  return /adr0009|adr9\/|acceptance fixture|ricoh-v1-fixture|committed ricoh/.test(
    notes,
  );
}

function pairingLabel(method: string | undefined): string | null {
  if (method === "sequential_duplex") return "sequential duplex (face-down)";
  if (method === "sequential_duplex_back_first") {
    return "sequential duplex (face-up / back first)";
  }
  if (method === "filename_front_back") return "filename front/back";
  if (method === "auto") return "auto";
  return null;
}

function formatImportStatus(result: ImportScanResult): string {
  if (result.stagingError) {
    return `Imported ${result.fileCount} page(s), but staging failed: ${result.stagingError}`;
  }
  const cards = result.staged?.unitCount ?? 0;
  const images = result.fileCount;
  const how = pairingLabel(result.pairingMethod);
  const t = result.telemetry;
  const routes = t
    ? ` HIGH ${t.high} · MEDIUM ${t.medium} · LOW ${t.low} · CONFLICT ${t.conflicts} · ${t.totalMs}ms.`
    : "";
  const fallback = result.errorsWarnings?.find((w) =>
    /filenames were not \*_front/i.test(w),
  );
  const unpaired =
    images > 1 && cards === images
      ? " Pairing treated every image as its own card — set Pairing to Sequential duplex and re-import. Do not confirm this batch."
      : "";
  return (
    `Staged ${cards} card(s) from ${images} image(s)` +
    (how ? ` (${how})` : "") +
    `.${routes}` +
    (fallback ? ` ${fallback}.` : "") +
    unpaired +
    " Nothing is in inventory until you confirm."
  );
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      const comma = raw.indexOf(",");
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function ScanIntake() {
  const [meta, setMeta] = useState<ScanMeta | null>(null);
  const [batches, setBatches] = useState<StagedBatch[]>([]);
  const [store, setStore] = useState<"postgres" | "memory" | null>(null);
  const [folder, setFolder] = useState("");
  const [category, setCategory] = useState<ScanCategory>("sports");
  const [pairing, setPairing] = useState<ScanPairing>("auto");
  const [notes, setNotes] = useState("");
  const [uploads, setUploads] = useState<File[]>([]);
  const [hideLabBatches, setHideLabBatches] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    playerOrCharacter: "",
    year: "",
    setName: "",
    collectorNumber: "",
    parallel: "",
  });

  const reload = useCallback(async () => {
    try {
      const data = await fetchScanBatches();
      setBatches(data.batches ?? []);
      setStore(data.store ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load scan batches");
    }
  }, []);

  useEffect(() => {
    void fetchScanMeta()
      .then(setMeta)
      .catch((e) =>
        setError(
          e instanceof Error
            ? `${e.message} — is the VIP API running (npm run api)?`
            : "VIP API unreachable",
        ),
      );
    void reload();
  }, [reload]);

  const startBatch = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await importScanFolder({
        folder: folder.trim().replace(/^["']|["']$/g, "") || undefined,
        categoryHint: category,
        notes: notes.trim() || undefined,
        pairing,
      });
      setStatus(formatImportStatus(result));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }, [folder, category, notes, pairing, reload]);

  const startUpload = useCallback(async () => {
    if (uploads.length === 0) {
      setError("Choose image files or import a folder.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const started = await startScanUpload();
      for (let i = 0; i < uploads.length; i += 1) {
        const file = uploads[i]!;
        setStatus(`Uploading ${i + 1}/${uploads.length}: ${file.name}`);
        await uploadScanFile({
          sessionId: started.sessionId,
          fileName: file.name,
          contentBase64: await readFileBase64(file),
        });
      }
      setStatus(`Pairing and identifying ${uploads.length} image(s)…`);
      const result = await finishScanUpload({
        sessionId: started.sessionId,
        categoryHint: category,
        notes: notes.trim() || undefined,
        pairing,
      });
      setStatus(formatImportStatus(result));
      setUploads([]);
      await reload();
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} — if a single scan is huge, use Same-PC folder import instead.`
          : "Upload failed",
      );
    } finally {
      setBusy(false);
    }
  }, [uploads, category, notes, pairing, reload]);

  const confirmUnit = useCallback(
    async (unit: StagedUnit, catalogKey: string) => {
      setBusy(true);
      setError(null);
      setStatus(null);
      try {
        const result = await resolveScanUnit(unit.id, {
          catalogKey,
          acknowledgeDuplicates: unit.duplicateAcknowledged || unit.physicalReimport,
          quantity: 1,
        });
        setStatus(
          result.alreadyResolved
            ? "Already in inventory — no second holding created."
            : `Draft inventory created (Dealer · Sell). ${result.note ?? ""}`,
        );
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Confirm failed");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const swapFaces = useCallback(
    async (target: { batchId?: string; unitId?: string }) => {
      setBusy(true);
      setError(null);
      setStatus(null);
      try {
        const result = await swapScanFaces(target);
        setStatus(result.note);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Swap faces failed");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const startEdit = useCallback((unit: StagedUnit) => {
    const split = unit.baseVsParallel;
    const top = unit.candidates[0];
    const named = split?.baseDisplayName ?? top?.displayName ?? "";
    setEditingId(unit.id);
    setEditForm({
      playerOrCharacter: named.replace(/^\d{4}\s+/, "").replace(/#\S+/g, "").trim(),
      year: named.match(/\b((?:19|20)\d{2})\b/)?.[1] ?? "",
      setName: top?.setName ?? "",
      collectorNumber: top?.collectorNumber ?? "",
      parallel:
        split?.parallelDisplayName && split.parallelDisplayName !== "unknown"
          ? split.parallelDisplayName
          : "",
    });
  }, []);

  const saveEdit = useCallback(
    async (unit: StagedUnit) => {
      const player = editForm.playerOrCharacter.trim();
      if (!player) {
        setError("Player / character is required to save an edit.");
        return;
      }
      setBusy(true);
      setError(null);
      setStatus(null);
      try {
        const year = editForm.year.trim() ? Number(editForm.year.trim()) : null;
        const result = await editScanUnit(unit.id, {
          playerOrCharacter: player,
          year: year && Number.isFinite(year) ? year : null,
          setName: editForm.setName.trim() || null,
          collectorNumber: editForm.collectorNumber.trim() || null,
          parallel: editForm.parallel.trim() || null,
        });
        setStatus(`Saved edit: ${result.displayName}. Confirm to add it to Collections.`);
        setEditingId(null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Edit failed");
      } finally {
        setBusy(false);
      }
    },
    [editForm, reload],
  );

  const discardBatch = useCallback(
    async (batch: StagedBatch) => {
      const ok = window.confirm(
        `Remove this ${batch.units.length}-card batch from the Scan queue? Confirmed cards stay in Collections. Unconfirmed cards are not added.`,
      );
      if (!ok) return;
      setBusy(true);
      setError(null);
      setStatus(null);
      try {
        const result = await discardScanBatch(batch.id);
        setStatus(
          result.confirmedKept
            ? `Batch removed from the queue. ${result.confirmedKept} confirmed card(s) stay in Collections.`
            : "Batch removed from the queue. Nothing was added to Collections.",
        );
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete batch failed");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const discardUnit = useCallback(
    async (unit: StagedUnit) => {
      setBusy(true);
      setError(null);
      setStatus(null);
      try {
        await rejectScanUnit(unit.id, "operator rejected");
        setStatus("Rejected. The scan and its candidates are kept for a re-run.");
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reject failed");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const inboxRoot = meta?.inbox?.root ?? null;
  const visibleBatches = hideLabBatches
    ? batches.filter((b) => !isLabTestBatch(b))
    : batches;
  const hiddenCount = batches.length - visibleBatches.length;

  function takeFiles(list: FileList | File[] | null) {
    const next = Array.from(list ?? []).filter((f) =>
      /\.(jpe?g|png|tiff?|webp)$/i.test(f.name),
    );
    setUploads(next);
  }

  return (
    <div className="stack">
      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Import a scan folder</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Paste the PaperStream output path and click <strong>Import folder</strong>.
          The folder must exist on this PC (the machine running the VIP API).
        </p>

        <label className="scan-field">
          <span>Scan folder</span>
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!text.trim()) return;
              e.preventDefault();
              setFolder(text.trim().replace(/^["']|["']$/g, ""));
            }}
            placeholder={inboxRoot ?? "D:\\VIP\\scans\\fi8170"}
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
          <small className="muted">
            {inboxRoot
              ? `Paste a path, or leave blank for VIP_SCAN_INBOX (${inboxRoot}).`
              : "Paste the full folder path, e.g. D:\\VIP\\scans\\fi8170"}
          </small>
        </label>

        <div className="scan-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void startBatch()}
            disabled={busy}
          >
            {busy ? "Working…" : "Import folder"}
          </button>
        </div>

        <h3>Or choose image files</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Use this if you do not want to point at a folder. Large 600 DPI lots
          upload one file at a time.
        </p>

        <div
          className={`scan-drop${dragOver ? " scan-drop-active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            takeFiles(e.dataTransfer.files);
          }}
        >
          <input
            id="scan-upload-input"
            type="file"
            accept="image/jpeg,image/png,image/tiff,image/webp,.jpg,.jpeg,.png,.tif,.tiff,.webp"
            multiple
            disabled={busy}
            className="scan-drop-input"
            onChange={(e) => takeFiles(e.target.files)}
          />
          <label htmlFor="scan-upload-input" className="scan-drop-label">
            <strong>Choose front + back images</strong>
            <span>
              {uploads.length
                ? `${uploads.length} file(s) ready — click Process selected images`
                : "Click here or drop files. Pick every *_front and *_back from the lot."}
            </span>
          </label>
        </div>

        <div className="scan-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void startUpload()}
            disabled={busy || uploads.length === 0}
          >
            {busy ? "Working…" : "Process selected images"}
          </button>
          <button
            type="button"
            className="btn-link"
            onClick={() => void reload()}
            disabled={busy}
          >
            Refresh queue
          </button>
        </div>

        <label className="scan-field">
          <span>Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ScanCategory)}
            disabled={busy}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="scan-field">
          <span>Pairing</span>
          <select
            value={pairing}
            onChange={(e) => setPairing(e.target.value as ScanPairing)}
            disabled={busy}
          >
            <option value="auto">Auto (filename labels if present, else sequential duplex)</option>
            <option value="filename_front_back">Filename (*_front / *_back)</option>
            <option value="sequential_duplex">Sequential duplex (face-down ADF)</option>
            <option value="sequential_duplex_back_first">
              Sequential duplex (face-up ADF — back then front)
            </option>
          </select>
          <span className="muted" style={{ fontSize: 12 }}>
            Face-up drop: first file is the downward side (usually the back). Rotate 180°
            in PaperStream before save so pixels are upright, then use Face-up pairing
            or Swap front/back on the batch. Filename mode needs <code>*_front</code> /{" "}
            <code>*_back</code>.
          </span>
        </label>

        <label className="scan-field">
          <span>Notes (optional)</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Show pickup, box 3…"
            disabled={busy}
          />
        </label>

        {meta ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Device {meta.device} · profile {meta.scannerProfileDefault ?? "004_Cards"} ·
            quality {meta.qualityTier} · thresholds HIGH≥
            {meta.reviewThresholds?.highMin ?? "0.8"} / MEDIUM≥
            {meta.reviewThresholds?.mediumMin ?? "0.45"} · eBay drafts{" "}
            {meta.ebayListing.configured ? "configured" : "idle (no tokens)"}
            {store ? ` · staging store: ${store}` : ""}
          </p>
        ) : null}
      </section>

      {error ? <div className="error">{error}</div> : null}
      {status ? <div className="panel scan-status">{status}</div> : null}

      <section>
        <h2 className="section-title">
          Review queue ({visibleBatches.length} batch
          {hiddenCount ? `, ${hiddenCount} lab hidden` : ""})
        </h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Uncertain cards stay here. Front and back are shown together.{" "}
          <strong>Edit</strong> a card if OCR missed the name, then{" "}
          <strong>Confirm</strong> to save a draft holding (Dealer Inventory · Sell ·
          NM assumed · unverified). <strong>Delete batch</strong> clears this queue
          without removing anything already confirmed into Collections.
        </p>
        <label className="scan-hide-lab">
          <input
            type="checkbox"
            checked={hideLabBatches}
            onChange={(e) => setHideLabBatches(e.target.checked)}
          />
          Hide Michael Jordan / ADR 0009 lab batches
        </label>
        {visibleBatches.length === 0 ? (
          <p className="muted">
            No operator batches yet. Choose images above and click Process
            selected images.
          </p>
        ) : null}

        <div className="stack">
          {visibleBatches.map((batch) => (
            <article key={batch.id} className="panel">
              <div className="scan-batch-head">
                <div>
                  <h3 style={{ margin: 0 }}>
                    {batch.categoryHint ?? "uncategorized"} · {batch.units.length} card(s)
                  </h3>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    {batch.source ?? batch.device}
                    {batch.scannerProfile ? ` · ${batch.scannerProfile}` : ""} · {batch.status}
                    {batch.notes ? ` · ${batch.notes}` : ""}
                  </p>
                </div>
                <div className="scan-actions" style={{ margin: 0 }}>
                  {batch.units.some((u) => !u.resolutionMode && u.backStorageRef) ? (
                    <button
                      type="button"
                      className="btn-link"
                      disabled={busy}
                      onClick={() => void swapFaces({ batchId: batch.id })}
                    >
                      Swap front/back
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-link"
                    disabled={busy}
                    onClick={() => void discardBatch(batch)}
                  >
                    Delete batch
                  </button>
                </div>
              </div>

              {batch.telemetry ? (
                <p className="scan-telemetry">
                  images {batch.telemetry.imagesReceived} · cards {batch.units.length} · paired{" "}
                  {batch.telemetry.cardsPaired} · fail {batch.telemetry.pairingFailures} · HIGH{" "}
                  {batch.telemetry.high} · MEDIUM {batch.telemetry.medium} · LOW{" "}
                  {batch.telemetry.low} · CONFLICT {batch.telemetry.conflicts} · review{" "}
                  {batch.telemetry.needsReview} · dups {batch.telemetry.duplicateWarnings} ·{" "}
                  {Math.round(batch.telemetry.totalMs)}ms
                  {batch.telemetry.processingFailures
                    ? ` · errors ${batch.telemetry.processingFailures}`
                    : ""}
                </p>
              ) : null}
              {batch.errorsWarnings?.length ? (
                <p className="muted" style={{ fontSize: 12 }}>
                  {batch.errorsWarnings.filter((w) => !w.startsWith("unit ")).join(" · ") ||
                    `${batch.errorsWarnings.length} unit warning(s)`}
                </p>
              ) : null}

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Front / back</th>
                      <th>Base identity</th>
                      <th>Parallel</th>
                      <th>Confidence</th>
                      <th>State</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.units.map((unit) => {
                      const top = unit.candidates[0];
                      const band = BAND_COPY[unit.confidenceBand ?? "none"] ?? BAND_COPY.none!;
                      const route = unit.reviewRoute
                        ? ROUTE_COPY[unit.reviewRoute]
                        : null;
                      const resolved = unit.resolutionMode != null;
                      const split = unit.baseVsParallel;
                      const conflicts = unit.identityEvidence?.conflictNotes ?? [];
                      return (
                        <tr key={unit.id}>
                          <td>
                            <div className="scan-faces">
                              {unit.frontImageId ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={scanMediaUrl(unit.frontImageId)}
                                  alt={`Front ${fileName(unit.frontStorageRef)}`}
                                />
                              ) : null}
                              {unit.backImageId ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={scanMediaUrl(unit.backImageId)}
                                  alt={`Back ${fileName(unit.backStorageRef ?? "")}`}
                                />
                              ) : null}
                            </div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              #{unit.unitIndex + 1} {fileName(unit.frontStorageRef)}
                              {unit.backStorageRef ? " + back" : " (front only)"}
                              {unit.orientation ? ` · ${unit.orientation}` : ""}
                              {unit.pairingNeedsReview ? " · pairing review" : ""}
                            </div>
                          </td>
                          <td>
                            <strong>
                              {split?.baseDisplayName ?? top?.displayName ?? (
                                <span className="muted">unknown</span>
                              )}
                            </strong>
                            <div className="muted" style={{ fontSize: 12 }}>
                              base {pct(split?.baseConfidence ?? unit.topConfidence)}
                              {top ? ` · ${top.adapterId}` : " · no candidate — click Edit"}
                            </div>
                            {conflicts.length > 0 ? (
                              <div className="scan-conflict">
                                {conflicts.join("; ")}
                              </div>
                            ) : null}
                            {editingId === unit.id ? (
                              <div className="scan-edit">
                                <label>
                                  Player
                                  <input
                                    value={editForm.playerOrCharacter}
                                    onChange={(e) =>
                                      setEditForm((f) => ({
                                        ...f,
                                        playerOrCharacter: e.target.value,
                                      }))
                                    }
                                    disabled={busy}
                                  />
                                </label>
                                <label>
                                  Year
                                  <input
                                    value={editForm.year}
                                    onChange={(e) =>
                                      setEditForm((f) => ({ ...f, year: e.target.value }))
                                    }
                                    disabled={busy}
                                  />
                                </label>
                                <label>
                                  Set
                                  <input
                                    value={editForm.setName}
                                    onChange={(e) =>
                                      setEditForm((f) => ({ ...f, setName: e.target.value }))
                                    }
                                    disabled={busy}
                                  />
                                </label>
                                <label>
                                  Number
                                  <input
                                    value={editForm.collectorNumber}
                                    onChange={(e) =>
                                      setEditForm((f) => ({
                                        ...f,
                                        collectorNumber: e.target.value,
                                      }))
                                    }
                                    disabled={busy}
                                  />
                                </label>
                                <label>
                                  Parallel
                                  <input
                                    value={editForm.parallel}
                                    onChange={(e) =>
                                      setEditForm((f) => ({ ...f, parallel: e.target.value }))
                                    }
                                    disabled={busy}
                                  />
                                </label>
                                <div className="scan-actions" style={{ margin: 0 }}>
                                  <button
                                    type="button"
                                    className="btn-primary"
                                    disabled={busy}
                                    onClick={() => void saveEdit(unit)}
                                  >
                                    Save edit
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-link"
                                    disabled={busy}
                                    onClick={() => setEditingId(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </td>
                          <td>
                            {split?.parallelDisplayName ?? "unknown"}
                            <div className="muted" style={{ fontSize: 12 }}>
                              {pct(split?.parallelConfidence ?? 0)}
                            </div>
                          </td>
                          <td>
                            {route ? (
                              <span className={route.className}>{route.label}</span>
                            ) : (
                              <span className={band.className}>{band.label}</span>
                            )}
                            <div className="muted" style={{ fontSize: 12 }}>
                              {unit.reviewStatus ?? unit.status}
                            </div>
                          </td>
                          <td>
                            {resolved ? (
                              <>
                                <span className="badge badge-ok">
                                  {unit.resolutionMode === "rejected"
                                    ? "rejected"
                                    : "in inventory"}
                                </span>
                                {unit.decisionAction ? (
                                  <div className="muted" style={{ fontSize: 12 }}>
                                    {unit.decisionAction}
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <>
                                <span className="badge">staged</span>
                                {unit.physicalReimport ? (
                                  <div>
                                    <span className="badge badge-warn">same physical scan</span>
                                  </div>
                                ) : null}
                                {unit.duplicateAcknowledged ? (
                                  <div>
                                    <span className="badge badge-warn">same card type held</span>
                                  </div>
                                ) : null}
                              </>
                            )}
                          </td>
                          <td>
                            {resolved ? (
                              <span className="muted">—</span>
                            ) : (
                              <div className="scan-actions" style={{ margin: 0, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  className="btn-primary"
                                  disabled={
                                    busy ||
                                    !top ||
                                    unit.reviewRoute === "CONFLICT" ||
                                    conflicts.length > 0
                                  }
                                  onClick={() => void confirmUnit(unit, top!.catalogKey)}
                                  title={
                                    !top
                                      ? "Click Edit, enter the card, Save edit, then Confirm"
                                      : unit.reviewRoute === "CONFLICT" || conflicts.length > 0
                                        ? "Click Edit to correct the conflict, then Confirm"
                                        : unit.physicalReimport
                                          ? "This is the same physical scan — confirm only if you intend a second copy"
                                          : "Add draft inventory (Dealer · Sell)"
                                  }
                                >
                                  {unit.physicalReimport || unit.duplicateAcknowledged
                                    ? "Add copy"
                                    : "Confirm"}
                                </button>
                                <button
                                  type="button"
                                  className="btn-link"
                                  disabled={busy}
                                  onClick={() => startEdit(unit)}
                                >
                                  Edit
                                </button>
                                {unit.backStorageRef ? (
                                  <button
                                    type="button"
                                    className="btn-link"
                                    disabled={busy}
                                    onClick={() => void swapFaces({ unitId: unit.id })}
                                  >
                                    Swap faces
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="btn-link"
                                  disabled={busy}
                                  onClick={() => void discardUnit(unit)}
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
