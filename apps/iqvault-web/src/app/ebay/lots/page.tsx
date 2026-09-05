"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiGet, apiPost } from "@/lib/api";

type Lot = {
  lotName: string;
  inventoryIds: string[];
  combinedFmv: number;
  recommendedPrice: number;
  estimatedNet: number;
  estimatedLaborMinutes: number;
  netDollarsPerLaborMinute: number;
  confidence: number;
  groupingKey: string;
};

export default function EbayLotsPage() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ proposals: Lot[] }>("/api/ebay/sell/lots")
      .then((d) => setLots(d.proposals ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Lots failed"));
  }, []);

  async function accept(lot: Lot) {
    try {
      await apiPost("/api/ebay/sell/lots/accept", lot);
      setNote(`Accepted proposal: ${lot.lotName}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Accept failed");
    }
  }

  return (
    <div className="shell">
      <Nav active="/ebay" />
      <h1 className="page-title">Low-dollar lot builder</h1>
      <p className="page-sub">
        Proposals only — not auto-committed. PC / HOLD / GRADE cards are excluded. A card in an
        accepted lot cannot also be an active single listing.
      </p>
      <p className="muted">
        <Link href="/ebay">eBay dashboard</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {note ? <p className="muted">{note}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Lot</th>
              <th>Members</th>
              <th>Combined FMV</th>
              <th>Rec price</th>
              <th>Expected net</th>
              <th>Labor</th>
              <th>Conf</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lots.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No coherent low-dollar clusters right now.
                </td>
              </tr>
            ) : (
              lots.map((lot) => (
                <tr key={`${lot.groupingKey}:${lot.inventoryIds.join(",")}`}>
                  <td>
                    <strong>{lot.lotName}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {lot.groupingKey}
                    </div>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {lot.inventoryIds.length} · {lot.inventoryIds.slice(0, 4).join(", ")}
                    {lot.inventoryIds.length > 4 ? "…" : ""}
                  </td>
                  <td>${lot.combinedFmv.toFixed(2)}</td>
                  <td>${lot.recommendedPrice.toFixed(2)}</td>
                  <td>${lot.estimatedNet.toFixed(2)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {lot.estimatedLaborMinutes} min · ${lot.netDollarsPerLaborMinute}/min
                  </td>
                  <td>{lot.confidence.toFixed(2)}</td>
                  <td>
                    <button type="button" onClick={() => void accept(lot)}>
                      Accept
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
