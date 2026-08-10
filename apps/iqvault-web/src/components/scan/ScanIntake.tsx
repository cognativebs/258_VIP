"use client";

import { useCallback, useEffect, useState } from "react";
import {
  confirmScanUnit,
  fetchScanBatches,
  fetchScanMeta,
  importScanFolder,
  type ScanBatch,
  type ScanCategory,
  type ScanMeta,
  type ScanUnit,
} from "@/lib/scanApi";

const CATEGORIES: Array<{ id: ScanCategory; label: string }> = [
  { id: "sports", label: "Sports cards" },
  { id: "pokemon", label: "Pokemon TCG" },
  { id: "mtg", label: "Magic: The Gathering" },
];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function fileName(ref: string): string {
  return ref.split(/[\\/]/).pop() ?? ref;
}

export function ScanIntake() {
  const [meta, setMeta] = useState<ScanMeta | null>(null);
  const [batches, setBatches] = useState<ScanBatch[]>([]);
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
        `Imported ${result.fileCount} page(s) from ${result.folder} — ${result.batch.units.length} card unit(s) awaiting confirm.`,
      );
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }, [folder, category, notes, reload]);

  const confirmUnit = useCallback(
    async (unit: ScanUnit, candidateKey: string) => {
      setBusy(true);
      setError(null);
      setStatus(null);
      try {
        const hasDuplicates = (unit.duplicateAlert?.duplicates?.length ?? 0) > 0;
        const result = await confirmScanUnit(unit.id, {
          selectedCandidateKey: candidateKey,
          // Operator sees the duplicate rows before clicking, so the click is
          // the acknowledgement the pipeline requires.
          acknowledgeDuplicates: hasDuplicates,
          quantity: 1,
        });
        setStatus(
          result.outputAction
            ? `Confirmed into inventory — action ${result.outputAction}. ${result.note ?? ""}`
            : "Confirmed into inventory.",
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

  const inboxRoot = meta?.inbox?.root ?? null;

  return (
    <div className="stack">
      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Start / import a scan batch</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Scan on the Ricoh fi-8170 with PaperStream Capture (duplex, output to a watched
          folder). IQVault imports that folder, pairs front/back, and proposes IDs.
          Candidates stay <strong>inferred · unverified</strong> until you confirm.
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
          </p>
        ) : null}
      </section>

      {error ? <div className="error">{error}</div> : null}
      {status ? <div className="panel scan-status">{status}</div> : null}

      <section>
        <h2 className="section-title">Batches ({batches.length})</h2>
        {batches.length === 0 ? (
          <p className="muted">
            No scan batches yet. Import a folder above to create one.
          </p>
        ) : null}

        <div className="stack">
          {batches.map((batch) => (
            <article key={batch.id} className="panel">
              <div className="scan-batch-head">
                <div>
                  <h3 style={{ margin: 0 }}>
                    {batch.categoryHint ?? "uncategorized"} · {batch.units.length} unit(s)
                  </h3>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    {batch.device} · status {batch.status}
                    {batch.notes ? ` · ${batch.notes}` : ""}
                  </p>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Unit</th>
                      <th>Pages</th>
                      <th>Status</th>
                      <th>Top candidates</th>
                      <th>Duplicates</th>
                      <th>Confirm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.units.map((unit) => {
                      const dupes = unit.duplicateAlert?.duplicates ?? [];
                      const confirmed = unit.status === "confirmed";
                      return (
                        <tr key={unit.id}>
                          <td>#{unit.unitIndex + 1}</td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {fileName(unit.frontStorageRef)}
                            {unit.backStorageRef
                              ? ` + ${fileName(unit.backStorageRef)}`
                              : " (front only)"}
                          </td>
                          <td>
                            <span
                              className={
                                confirmed
                                  ? "badge"
                                  : dupes.length
                                    ? "badge badge-warn"
                                    : "badge"
                              }
                            >
                              {unit.status}
                            </span>
                            {unit.decisionAction ? (
                              <div className="muted" style={{ fontSize: 12 }}>
                                {unit.decisionAction}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            {unit.candidates.length === 0 ? (
                              <span className="muted">no match — needs review</span>
                            ) : (
                              <ul className="scan-candidates">
                                {unit.candidates.slice(0, 3).map((c) => (
                                  <li key={c.catalogKey}>
                                    {c.displayName}
                                    <span className="muted">
                                      {" "}
                                      · {pct(c.confidence)} conf
                                      {c.setName ? ` · ${c.setName}` : ""}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td>
                            {dupes.length === 0 ? (
                              <span className="muted">—</span>
                            ) : (
                              <ul className="scan-candidates">
                                {dupes.slice(0, 3).map((d) => (
                                  <li key={d.holdingId}>
                                    {d.assetName}
                                    <span className="muted">
                                      {" "}
                                      · qty {d.quantity} · {d.matchKind}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td>
                            {confirmed ? (
                              <span className="muted">in inventory</span>
                            ) : unit.candidates.length === 0 ? (
                              <span className="muted">—</span>
                            ) : (
                              <button
                                type="button"
                                className="btn-primary"
                                disabled={busy}
                                onClick={() =>
                                  void confirmUnit(unit, unit.candidates[0]!.catalogKey)
                                }
                                title={
                                  dupes.length
                                    ? "Confirms as an additional copy (duplicate acknowledged)"
                                    : "Confirm into inventory"
                                }
                              >
                                {dupes.length ? "Confirm dup" : "Confirm"}
                              </button>
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
