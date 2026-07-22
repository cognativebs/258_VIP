import { Nav } from "@/components/Nav";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { apiGet, type Holding } from "@/lib/api";

export default async function SellQueuePage() {
  let items: Holding[] = [];
  let error: string | null = null;
  try {
    const data = await apiGet<{ items: Holding[] }>("/api/sell-queue");
    items = data.items;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load sell queue";
  }

  return (
    <>
      <Nav active="/sell-queue" />
      <h1 className="page-title">Sell queue</h1>
      <p className="page-sub">
        CLZ-derived queue with Museum / Investment / Liquidity scores, sell priority, and
        grading / photo / verification flags.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Asset</th>
              <th>MUS / INV / LIQ</th>
              <th>Flags</th>
              <th>Label</th>
              <th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.id}>
                <td>
                  <span
                    className={`badge ${
                      h.sellPriority === "High" ? "badge-danger" : "badge-warn"
                    }`}
                  >
                    {h.sellPriority ?? "—"}
                  </span>
                </td>
                <td>
                  <strong>{h.assetName}</strong>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {h.museumScore ?? "—"} / {h.investmentScore ?? "—"} /{" "}
                  {h.liquidityScore ?? "—"}
                </td>
                <td>
                  {h.needsGrading ? <span className="badge">grading</span> : null}
                  {h.needsPhoto ? <span className="badge">photo</span> : null}
                  {h.needsVerification ? (
                    <span className="badge badge-warn">verify</span>
                  ) : null}
                </td>
                <td>{h.recommendationLabel ?? "—"}</td>
                <td>
                  <ProvenanceBadge provenance={h.provenance} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
