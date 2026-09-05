"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiGet, apiPost } from "@/lib/api";

type QueueItem = {
  id: string;
  inventoryId: string;
  priorityScore: number;
  bucket: string;
  recommendedFormat: string;
  recommendedPrice: number | null;
  estimatedNet: number | null;
  disposition: string;
  reason: string;
  confidence: number;
};

export default function EbayQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    const data = await apiGet<{ items: QueueItem[] }>("/api/ebay/sell/queue?rebuild=1");
    setItems(data.items ?? []);
  }

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Queue failed"));
  }, []);

  async function act(id: string, action: string) {
    setBusy(id);
    try {
      await apiPost(`/api/ebay/sell/queue/${id}/action`, {
        action,
        note: `Operator ${action} from listing queue`,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="shell">
      <Nav active="/ebay" />
      <h1 className="page-title">Daily listing queue</h1>
      <p className="page-sub">
        Ranked, not a bulk dump. Target ~20–25. Approve creates a reviewable draft — it does not
        auto-publish. High-value cards stay blocked until explicitly enabled.
      </p>
      <p className="muted">
        <Link href="/ebay">eBay dashboard</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Card</th>
              <th>FMV / rec price</th>
              <th>Disposition</th>
              <th>Format</th>
              <th>Expected net</th>
              <th>Reason</th>
              <th>Conf</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No ranked items. Need sellable dealer holdings with an FMV range or snapshot.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link href={`/ebay/item/${item.inventoryId}`}>{item.inventoryId}</Link>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {item.bucket} · {item.priorityScore}
                    </div>
                  </td>
                  <td>{item.recommendedPrice != null ? `$${item.recommendedPrice}` : "—"}</td>
                  <td>
                    <span className="badge badge-info">{item.disposition}</span>
                  </td>
                  <td>{item.recommendedFormat}</td>
                  <td>{item.estimatedNet != null ? `$${item.estimatedNet}` : "—"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {item.reason}
                  </td>
                  <td>{item.confidence.toFixed(2)}</td>
                  <td>
                    <button type="button" disabled={busy === item.id} onClick={() => void act(item.id, "approve")}>
                      Approve
                    </button>{" "}
                    <button type="button" disabled={busy === item.id} onClick={() => void act(item.id, "defer")}>
                      Defer
                    </button>{" "}
                    <button type="button" disabled={busy === item.id} onClick={() => void act(item.id, "hold")}>
                      Hold
                    </button>
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
