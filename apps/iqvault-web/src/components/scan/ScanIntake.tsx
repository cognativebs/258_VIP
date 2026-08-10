"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchScanBatches,
  fetchScanMeta,
  importScanFolder,
  rejectScanUnit,
  resolveScanUnit,
  type ScanCategory,
  type ScanMeta,
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

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

function fileName(ref: string): string {
  return ref.split(/[\\/]/).pop() ?? ref;
}

export function ScanIntake() {
  const [meta, setMeta] = useState<ScanMeta | null>(null);
  const [batches, setBatches] = useState<StagedBatch[]>([]);
  const [store, setStore] = useState<"postgres" | "memory" | null>(null);
  const [folder, setFolder] = useState("");
  const [category, setCategory] = useState<ScanCategory>("sports");
  const [notes, setNotes] = useState("");
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
      });
      setStatus(
        result.stagingError
          ? `Imported ${result.fileCount} page(s), but staging failed: ${result.stagingError}`
          : `Staged ${result.staged?.unitCount ?? 0} card(s) with ${
              result.staged?.candidateCount ?? 0
            } candidate identities from ${result.folder}. Nothing is in inventory yet.`,
      );
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }, [folder, category, notes, reload]);

  const confirmUnit = useCallback(
    async (unit: StagedUnit, catalogKey: string) => {
      setBusy(true);
      setError(null);
      setStatus(null);
      try {
        const result = await resolveScanUnit(unit.id, {
          catalogKey,
          // The operator sees the duplicate badge before clicking, so the click
          // is the acknowledgement the pipeline requires.
          acknowledgeDuplicates: unit.duplicateAcknowledged,
          quantity: 1,
        });
        setStatus(
          result.alreadyResolved
            ? "Already in inventory — no second holding created."
            : `Added to inventory as Hold. ${result.note ?? ""}`,
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
          Scan on the Ricoh fi-8170 with PaperStream Capture (duplex, output to a watched
          folder). IQVault imports that folder, pairs front/back, and proposes identities.
          Imported cards sit in <strong>staging</strong> — nothing reaches your collection
          until you confirm.
        </p>

        <label className="scan-field">
          <span>Scan folder</span>
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={inboxRoot ?? "D:\\VIP\\scans\\fi8170"}
            disabled={busy}
          />
          <small className="muted">
            {inboxRoot
              ? `Leave blank to use VIP_SCAN_INBOX (${inboxRoot}).`
              : "Set VIP_SCAN_INBOX on the API to skip typing a full path."}
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
            className="btn-link"
            onClick={() => void reload()}
            disabled={busy}
          >
            Refresh
          </button>
        </div>

        {meta ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Device {meta.device} · quality {meta.qualityTier} · eBay drafts{" "}
            {meta.ebayListing.configured ? "configured" : "idle (no tokens)"}
            {store ? ` · staging store: ${store}` : ""}
          </p>
        ) : null}
      </section>

      {error ? <div className="error">{error}</div> : null}
      {status ? <div className="panel scan-status">{status}</div> : null}

      <section>
        <h2 className="section-title">Review queue ({batches.length} batch)</h2>
        {batches.length === 0 ? (
          <p className="muted">
            No scan batches staged. Import a folder above to create one.
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
                    {batch.device} · {batch.status}
                    {batch.notes ? ` · ${batch.notes}` : ""}
                  </p>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Card</th>
                      <th>Best match</th>
                      <th>Confidence</th>
                      <th>State</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.units.map((unit) => {
                      const top = unit.candidates[0];
                      const band = BAND_COPY[unit.confidenceBand ?? "none"] ?? BAND_COPY.none!;
                      const resolved = unit.resolutionMode != null;
                      return (
                        <tr key={unit.id}>
                          <td className="muted" style={{ fontSize: 12 }}>
                            #{unit.unitIndex + 1} {fileName(unit.frontStorageRef)}
                            {unit.backStorageRef ? " (duplex)" : " (front only)"}
                          </td>
                          <td>
                            {top ? (
                              <>
                                <strong>{top.displayName}</strong>
                                <div className="muted" style={{ fontSize: 12 }}>
                                  {top.matchReasons.join(", ")} · {top.adapterId}
                                </div>
                                {unit.candidates.length > 1 ? (
                                  <div className="muted" style={{ fontSize: 12 }}>
                                    +{unit.candidates.length - 1} other candidate(s)
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <span className="muted">no candidate</span>
                            )}
                          </td>
                          <td>
                            {pct(unit.topConfidence)}
                            <div>
                              <span className={band.className}>{band.label}</span>
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
                                {unit.duplicateAcknowledged ? (
                                  <div>
                                    <span className="badge badge-warn">already owned</span>
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
                                  disabled={busy || !top}
                                  onClick={() => void confirmUnit(unit, top!.catalogKey)}
                                  title={
                                    unit.duplicateAcknowledged
                                      ? "Adds another copy of a card you already own"
                                      : "Add to inventory as Hold"
                                  }
                                >
                                  {unit.duplicateAcknowledged ? "Add copy" : "Confirm"}
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
