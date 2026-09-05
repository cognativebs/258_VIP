"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { apiGet, apiPost, type Provenance } from "@/lib/api";

type ListingDraft = {
  id: string;
  holdingSourceRowId: string;
  title: string;
  status: string;
  inventoryBucket: string;
  askPrice: number | null;
  liveLow: number | null;
  liveHigh: number | null;
  listingCount: number;
  emptyReason?: string | null;
  listingPayload?: { submitReady?: boolean };
  provenance: Provenance;
};

export default function ListingsPage() {
  const [drafts, setDrafts] = useState<ListingDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ids, setIds] = useState("");
  const [askPrice, setAskPrice] = useState("");
  const [personalOverride, setPersonalOverride] = useState("");
  const [rangeOverride, setRangeOverride] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const data = await apiGet<{ drafts: ListingDraft[] }>("/api/listings");
      setDrafts(data.drafts ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load listing drafts");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function queue(e: React.FormEvent) {
    e.preventDefault();
    const holdingSourceRowIds = ids
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!holdingSourceRowIds.length) return;
    setBusy(true);
    try {
      await apiPost("/api/listings/queue", {
        holdingSourceRowIds,
        action: "Sell",
        askPrice: askPrice ? Number(askPrice) : null,
        personalOverrideNote: personalOverride || null,
        rangeOverrideNote: rangeOverride || null,
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Queue failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <Nav active="/listings" />
      <h1 className="page-title">eBay listing drafts</h1>
      <p className="page-sub">
        Drafts only. submitReady stays false until a human Submit. Personal Collection is
        blocked unless an override note is captured. LIVE ranges are Browse listings ·
        unverified — not sold comps. The closed-loop Inventory API path lives on{" "}
        <a href="/ebay">/ebay</a>.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <form className="panel" onSubmit={(e) => void queue(e)} style={{ marginBottom: 16 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Queue drafts for holdings already marked Sell. Comma-separated holding ids (CLZ
          hash). Personal Collection requires an override note.
        </p>
        <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
          <input
            value={ids}
            onChange={(e) => setIds(e.target.value)}
            placeholder="holding ids, comma-separated"
          />
          <input
            value={askPrice}
            onChange={(e) => setAskPrice(e.target.value)}
            placeholder="Ask price (must sit inside LIVE range)"
          />
          <input
            value={personalOverride}
            onChange={(e) => setPersonalOverride(e.target.value)}
            placeholder="Personal override note (min 8 chars if Personal)"
          />
          <input
            value={rangeOverride}
            onChange={(e) => setRangeOverride(e.target.value)}
            placeholder="Range override note (if ask is outside LIVE)"
          />
          <button type="submit" disabled={busy}>
            {busy ? "Queueing…" : "Queue eBay drafts"}
          </button>
        </div>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Title</th>
              <th>Bucket</th>
              <th>Ask / LIVE</th>
              <th>Why</th>
              <th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {drafts.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No drafts queued yet.
                </td>
              </tr>
            ) : (
              drafts.map((d) => (
                <tr key={d.id}>
                  <td>
                    <span className="badge badge-info">{d.status}</span>
                  </td>
                  <td>
                    <strong>{d.title}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {d.holdingSourceRowId}
                    </div>
                  </td>
                  <td>{d.inventoryBucket}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {d.askPrice != null ? `$${d.askPrice}` : "—"} ·{" "}
                    {d.liveLow != null
                      ? `$${d.liveLow}–$${d.liveHigh} · ${d.listingCount} listings`
                      : "not fetched"}
                    {d.listingPayload?.submitReady ? "" : " · submitReady false"}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {d.emptyReason ?? "—"}
                  </td>
                  <td>
                    <ProvenanceBadge provenance={d.provenance} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
