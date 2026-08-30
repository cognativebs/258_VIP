"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchScanBatches,
  fetchScanMeta,
  importScanFolder,
  importScanUpload,
  rejectScanUnit,
  resolveScanUnit,
  scanMediaUrl,
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

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
        folder: folder.trim() || undefined,
        categoryHint: category,
        notes: notes.trim() || undefined,
        pairing,
      });
      const t = result.telemetry;
      setStatus(
        result.stagingError
          ? `Imported ${result.fileCount} page(s), but staging failed: ${result.stagingError}`
          : `Staged ${result.staged?.unitCount ?? 0} card(s) from ${result.folder}.` +
              (t
                ? ` HIGH ${t.high} · MEDIUM ${t.medium} · LOW ${t.low} · CONFLICT ${t.conflicts} · ${t.totalMs}ms.`
                : "") +
              " Nothing is in inventory until you confirm.",
      );
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
      const files = await Promise.all(
        uploads.map(async (file) => ({
          fileName: file.name,
          contentBase64: await readFileBase64(file),
        })),
      );
      const result = await importScanUpload({
        files,
        categoryHint: category,
        notes: notes.trim() || undefined,
        pairing,
      });
      setStatus(
        `Uploaded ${result.fileCount} image(s) → ${result.staged?.unitCount ?? 0} card(s). Review exceptions below.`,
      );
      setUploads([]);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
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

  return (
    <div className="stack">
      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Start / import a scan batch</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Scan on the Ricoh fi-8170 with PaperStream profile <strong>004_Cards</strong>{" "}
          (duplex, color, 600 DPI, JPEG/PNG). Drop the folder below or upload the
          images. IQVault copies immutable masters, pairs front/back, fuses both
          sides, and stages draft inventory. Confirm only after review — conflicts
          are never auto-chosen. Batch 001 remains on <a href="/batch/001">/batch/001</a>.
        </p>

        <label className="scan-field">
          <span>Scan folder</span>
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={inboxRoot ?? "data/scan-inbox/ricoh-v1-fixture"}
            disabled={busy}
          />
          <small className="muted">
            {inboxRoot
              ? `Leave blank to use VIP_SCAN_INBOX (${inboxRoot}).`
              : "Set VIP_SCAN_INBOX on the API, or type an absolute PaperStream output path."}
          </small>
        </label>

        <label className="scan-field">
          <span>Or upload images</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/tiff,image/webp,.jpg,.jpeg,.png,.tif,.tiff,.webp"
            multiple
            disabled={busy}
            onChange={(e) => setUploads(Array.from(e.target.files ?? []))}
          />
          <small className="muted">
            {uploads.length
              ? `${uploads.length} file(s) selected`
              : "Select every front and back from the duplex batch."}
          </small>
        </label>

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
            <option value="sequential_duplex">Sequential duplex (ADF order)</option>
          </select>
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

        <div className="scan-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void startBatch()}
            disabled={busy}
          >
            {busy ? "Working…" : "Import scanned batch"}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void startUpload()}
            disabled={busy || uploads.length === 0}
          >
            Upload selected images
          </button>
          <button
            type="button"
            className="btn-link"
            onClick={() => void reload()}
            disabled={busy}
          >
            Refresh
          </button>
        </div>

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
        <h2 className="section-title">Review queue ({batches.length} batch)</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Uncertain cards stay here. Front and back are shown together. Confirm
          writes a draft holding (Dealer Inventory · Sell · NM assumed · unverified).
        </p>
        {batches.length === 0 ? (
          <p className="muted">
            No scan batches staged. Import a folder or upload images above.
          </p>
        ) : null}

        <div className="stack">
          {batches.map((batch) => (
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
              </div>

              {batch.telemetry ? (
                <p className="scan-telemetry">
                  images {batch.telemetry.imagesReceived} · paired {batch.telemetry.cardsPaired} ·
                  fail {batch.telemetry.pairingFailures} · HIGH {batch.telemetry.high} · MEDIUM{" "}
                  {batch.telemetry.medium} · LOW {batch.telemetry.low} · CONFLICT{" "}
                  {batch.telemetry.conflicts} · review {batch.telemetry.needsReview} · dups{" "}
                  {batch.telemetry.duplicateWarnings} · {Math.round(batch.telemetry.totalMs)}ms
                  {batch.telemetry.processingFailures
                    ? ` · errors ${batch.telemetry.processingFailures}`
                    : ""}
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
                              {top ? ` · ${top.adapterId}` : ""}
                            </div>
                            {conflicts.length > 0 ? (
                              <div className="scan-conflict">
                                {conflicts.join("; ")}
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
                              <div className="scan-actions" style={{ margin: 0 }}>
                                <button
                                  type="button"
                                  className="btn-primary"
                                  disabled={busy || !top || unit.reviewRoute === "CONFLICT"}
                                  onClick={() => void confirmUnit(unit, top!.catalogKey)}
                                  title={
                                    unit.reviewRoute === "CONFLICT"
                                      ? "Resolve the front/back conflict before confirming"
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
