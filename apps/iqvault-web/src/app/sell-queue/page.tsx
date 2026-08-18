import { Nav } from "@/components/Nav";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { apiGet, type Holding } from "@/lib/api";

type DogfoodRow = {
  holding: Holding;
  action: string;
  stance: string;
  isStale: boolean;
  gradingRecommendation: string;
  gradingOpportunityScore: number;
  expectedIncrementalProfit: number;
  dogfoodNote: string;
};

export default async function SellQueuePage() {
  let rows: DogfoodRow[] = [];
  let note: string | null = null;
  let error: string | null = null;
  try {
    const data = await apiGet<{ items: DogfoodRow[]; note?: string }>("/api/sell-queue");
    rows = data.items;
    note = data.note ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load sell queue";
  }

  return (
    <div className="shell">
      <Nav active="/sell-queue" />
      <h1 className="page-title">Sell queue</h1>
      <p className="page-sub">
        Dogfood ranking: grading optimizer + evidence freshness. CLZ labels are not verified
        market truth.
      </p>
      {note ? <p className="muted">{note}</p> : null}
      {error ? <div className="error">{error}</div> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Asset</th>
              <th>Engine</th>
              <th>Grading</th>
              <th>Evidence</th>
              <th>Note</th>
              <th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.holding.id}>
                <td>
                  <span
                    className={`badge ${
                      r.holding.sellPriority === "High" ? "badge-danger" : "badge-warn"
                    }`}
                  >
                    {r.holding.sellPriority ?? "—"}
                  </span>
                </td>
                <td>
                  <strong>{r.holding.assetName}</strong>
                </td>
                <td>
                  <span className="badge">{r.action}</span>
                  <span className="badge badge-info">{r.stance}</span>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {r.gradingRecommendation} · {r.gradingOpportunityScore} · Δ $
                  {r.expectedIncrementalProfit}
                </td>
                <td>
                  <span className={`badge ${r.isStale ? "badge-warn" : "badge-ok"}`}>
                    {r.isStale ? "stale" : "fresh"}
                  </span>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {r.dogfoodNote}
                </td>
                <td>
                  <ProvenanceBadge provenance={r.holding.provenance} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
