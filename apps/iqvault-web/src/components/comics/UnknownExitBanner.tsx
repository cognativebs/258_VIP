"use client";

import { useMemo, useState } from "react";
import { recordUnknownExit } from "@/lib/comicsClient";
import type { ComicsMeta, UnknownExitPayload } from "@/lib/comicTypes";
import { moneyRange, previewUnknownExit } from "@/lib/unknownExitPreview";

const DEFAULT_NOTE =
  "Gifted a large share of bulk books to a school custodian (wife's elementary school). Titles were not recorded.";

export function UnknownExitBanner({
  meta,
  onRecorded,
}: {
  meta: ComicsMeta | null;
  onRecorded: (payload: UnknownExitPayload) => void;
}) {
  const existing = meta?.unknownExit?.event ? meta.unknownExit : null;
  const [open, setOpen] = useState(!existing);
  const [qty, setQty] = useState(existing?.event?.estimatedQty ?? 1000);
  const [note, setNote] = useState(existing?.event?.recipientNote ?? DEFAULT_NOTE);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => existing?.impact ?? previewUnknownExit(meta, qty),
    [existing?.impact, meta, qty],
  );

  const submit = async () => {
    if (!ack) {
      setError("Confirm that titles are unknown — we will not invent a list or delete holdings.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await recordUnknownExit({
        estimatedQty: qty,
        titlesRecorded: false,
        acknowledgeUnknownTitles: true,
        recipientNote: note,
        scope: "general_inventory_bulk",
      });
      if (result.ok === false || !result.event) {
        setError(result.error ?? "Save failed");
        return;
      }
      onRecorded(result);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const range = preview
    ? moneyRange(preview.physicalValueLow, preview.physicalValueHigh)
    : null;

  return (
    <section className={`bb-unknown-exit ${existing ? "is-recorded" : "is-open"}`}>
      <div className="bb-unknown-exit-head">
        <strong>{existing ? "PHYSICAL COUNT UNVERIFIED" : "CLZ LIST ≠ PHYSICAL COUNT"}</strong>
        <span>
          {existing
            ? `~${existing.event?.estimatedQty.toLocaleString()} bulk gifted · titles unknown · holdings still listed`
            : "July snapshot still lists every book. An unrecorded bulk gift does not delete rows."}
        </span>
        {range ? <em>Physical remaining {range}</em> : null}
        <button type="button" className="bb-link-btn" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : existing ? "Update estimate" : "Record giveaway"}
        </button>
      </div>
      {existing?.impact ? (
        <p className="bb-unknown-exit-action">
          <strong>{existing.impact.recommendations[0]?.action}</strong>
          {" · "}
          {existing.impact.recommendations[0]?.notes}
          {" "}
          <strong>{existing.impact.recommendations[1]?.action}</strong>
          {" keys / themed pillars."}
        </p>
      ) : null}
      {open ? (
        <form
          className="bb-unknown-exit-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            Estimated bulk qty
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value) || 0)}
            />
          </label>
          <label className="bb-unknown-exit-note">
            What happened
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className="bb-unknown-exit-ack">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I do not know which titles left. Do not delete holdings or invent a list.
          </label>
          <p className="bb-unknown-exit-hint">
            A new CLZ XML only marks books dropped if Comic Collector itself no longer
            has them. Value change is a range on General Inventory (~$3.6k of the
            catalog), inferred · unverified.
          </p>
          {error ? <p className="bb-unknown-exit-error">{error}</p> : null}
          <button type="submit" className="bb-btn" disabled={busy || !ack}>
            {busy ? "Saving…" : "Record unknown exit"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
