"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { apiGet, apiPost, type Provenance } from "@/lib/api";

type Txn = {
  id: string;
  holdingSourceRowId: string;
  kind: "buy" | "sell" | "transfer_bucket";
  amount: number | null;
  currency: string;
  occurredAt: string;
  inventoryBucket: string;
  notes?: string | null;
  provenance: Provenance;
};

export default function TransactionsPage() {
  const [items, setItems] = useState<Txn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [holdingId, setHoldingId] = useState("");
  const [kind, setKind] = useState<Txn["kind"]>("buy");
  const [amount, setAmount] = useState("");
  const [bucket, setBucket] = useState("dealer_inventory");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const data = await apiGet<{ items: Txn[] }>("/api/transactions");
      setItems(data.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function capture(e: React.FormEvent) {
    e.preventDefault();
    if (!holdingId.trim()) return;
    setBusy(true);
    try {
      await apiPost("/api/transactions", {
        holdingSourceRowId: holdingId.trim(),
        kind,
        amount: amount ? Number(amount) : null,
        inventoryBucket: bucket,
        notes: notes || null,
      });
      setNotes("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <Nav active="/transactions" />
      <h1 className="page-title">Transaction capture</h1>
      <p className="page-sub">
        Operator-captured buy / sell / bucket-transfer events. Not marketplace sold comps
        and never written to <code>vault_market.sale</code>.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <form className="panel" onSubmit={(e) => void capture(e)} style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
          <input
            value={holdingId}
            onChange={(e) => setHoldingId(e.target.value)}
            placeholder="Holding id (CLZ hash)"
          />
          <select value={kind} onChange={(e) => setKind(e.target.value as Txn["kind"])}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
            <option value="transfer_bucket">Transfer bucket</option>
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (optional — a range later, not a fake FMV)"
          />
          <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
            <option value="personal_collection">Personal Collection</option>
            <option value="investment_vault">Investment Vault</option>
            <option value="dealer_inventory">Dealer Inventory</option>
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes / evidence"
          />
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Capture transaction"}
          </button>
        </div>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Holding</th>
              <th>Bucket</th>
              <th>Amount</th>
              <th>Notes</th>
              <th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No captured transactions yet.
                </td>
              </tr>
            ) : (
              items.map((t) => (
                <tr key={t.id}>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {String(t.occurredAt).slice(0, 19)}
                  </td>
                  <td>
                    <span className="badge badge-info">{t.kind}</span>
                  </td>
                  <td>{t.holdingSourceRowId}</td>
                  <td>{t.inventoryBucket}</td>
                  <td>{t.amount != null ? `$${t.amount}` : "—"}</td>
                  <td className="muted">{t.notes ?? "—"}</td>
                  <td>
                    <ProvenanceBadge provenance={t.provenance} />
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
