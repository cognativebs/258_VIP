import { Nav } from "@/components/Nav";
import { ConfidenceBadge } from "@/components/ProvenanceBadge";
import { apiGet } from "@/lib/api";

type Rec = {
  holdingId: string;
  assetName: string;
  action: string;
  stance: string;
  confidence: number;
  reasonCodes: string[];
  supportingEvidence: { summary: string }[];
  opposingEvidence: { summary: string }[];
  marketRange: {
    low: number;
    high: number;
    matchedSales: number;
    confidence: number;
    confidenceBand: string;
  } | null;
  ruleOrModelVersion: string;
};

export default async function RecommendationsPage() {
  let rows: Rec[] = [];
  let error: string | null = null;
  try {
    const data = await apiGet<{ recommendations: Rec[] }>("/api/recommendations?limit=10");
    rows = data.recommendations;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load recommendations";
  }

  return (
    <div className="shell">
      <><Nav active="/recommendations" />
      <h1 className="page-title">Recommendations</h1>
      <p className="page-sub">
        Decision engine output: action + range + evidence. Never a bare point price.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div className="stack">
        {rows.map((r) => (
          <article key={r.holdingId} className="panel">
            <h3>
              {r.stance} · {r.assetName}
            </h3>
            <div>
              <ConfidenceBadge
                confidence={r.confidence}
                band={r.marketRange?.confidenceBand}
              />
              <span className="badge">{r.action}</span>
              <span className="badge badge-info">{r.ruleOrModelVersion}</span>
            </div>
            <p style={{ margin: "10px 0 0" }}>
              {r.marketRange ? (
                <>
                  Market range <strong>${r.marketRange.low}</strong>–
                  <strong>${r.marketRange.high}</strong> · {r.marketRange.matchedSales}{" "}
                  matched sales
                </>
              ) : (
                <span className="muted">Insufficient comps</span>
              )}
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Reasons: {r.reasonCodes.join(", ")}
            </p>
            <div className="evidence">
              <div>
                <strong>Supporting</strong>
                <ul>
                  {r.supportingEvidence.map((e, i) => (
                    <li key={i}>{e.summary}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Opposing</strong>
                <ul>
                  {r.opposingEvidence.map((e, i) => (
                    <li key={i}>{e.summary}</li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        ))}
      </div>
      </>
    </div>
  );
}
