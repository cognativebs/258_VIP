import { Nav } from "@/components/Nav";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { apiGet, type Holding } from "@/lib/api";

export default async function PortfolioPage() {
  let data: {
    count: number;
    totalValueEstimate: { amount: number; note: string; confidence: string };
    holdings: Holding[];
  } | null = null;
  let error: string | null = null;
  try {
    data = await apiGet("/api/inventory");
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load inventory";
  }

  return (
    <div className="shell">
      <><Nav active="/" />
      <h1 className="page-title">Portfolio</h1>
      <p className="page-sub">
        Inventory from VIP API — derived fields carry provenance. Snapshot totals are labeled,
        not presented as verified market truth.
      </p>

      {error ? (
        <div className="error">
          {error}. Start the API with <code>npm run api</code> (port 8787).
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid-stats">
            <div className="stat">
              <div className="n">{data.count}</div>
              <div className="l">Holdings in sample</div>
            </div>
            <div className="stat">
              <div className="n">${data.totalValueEstimate.amount.toLocaleString()}</div>
              <div className="l">Snapshot sum · {data.totalValueEstimate.confidence} conf</div>
            </div>
            <div className="stat">
              <div className="n">
                {data.holdings.filter((h) => h.needsVerification).length}
              </div>
              <div className="l">Needs verification</div>
            </div>
          </div>
          <p className="muted" style={{ marginTop: -8, marginBottom: 16, fontSize: 13 }}>
            {data.totalValueEstimate.note}
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Pillar</th>
                  <th>Scores</th>
                  <th>Label</th>
                  <th>Provenance</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.slice(0, 40).map((h) => (
                  <tr key={h.id}>
                    <td>
                      <strong>{h.assetName}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {h.publisher}
                        {h.assumedGrade ? ` · ${h.assumedGrade}` : ""}
                        {h.gradeRating == null && h.assumedGrade === "NM"
                          ? " (grade null)"
                          : ""}
                      </div>
                    </td>
                    <td>{h.pillar ?? "—"}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      MUS {h.museumScore ?? "—"} · INV {h.investmentScore ?? "—"} · LIQ{" "}
                      {h.liquidityScore ?? "—"}
                    </td>
                    <td>{h.recommendationLabel ?? "—"}</td>
                    <td>
                      <ProvenanceBadge provenance={h.provenance} />
                      {h.needsVerification ? (
                        <span className="badge badge-warn">needs verification</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      </>
    </div>
  );
}
