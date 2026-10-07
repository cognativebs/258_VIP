import { formatCurrency } from "@shared/format.js";

function formatAction(action) {
  return action?.replace(/_/g, " ") ?? "";
}

export default function IntelligenceRunPanel({ run }) {
  if (!run) return null;

  return (
    <div className="intel-panel card card-gold" style={{ marginBottom: 24 }}>
      <div className="intel-panel-head">
        <div>
          <p className="card-title">Intelligence Run</p>
          <h3 className="intel-run-id">{run.run_id}</h3>
          <p className="intel-run-meta">
            {run.run_date} · Release {run.release_date} · Budget {formatCurrency(run.user_profile.budget_usd)}
          </p>
        </div>
        <span className="intel-run-badge">Latest</span>
      </div>

      <p className="intel-summary">{run.executive_summary}</p>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div>
          <p className="card-title">Budget Plan</p>
          {run.budget_plan.map((b) => (
            <div key={b.bucket} className="intel-budget-row">
              <div>
                <strong>{b.bucket}</strong>
                <div className="intel-budget-intended">{b.intended}</div>
              </div>
              <span className="intel-budget-amt">
                {formatCurrency(b.amount_min)}–{formatCurrency(b.amount_max)}
              </span>
            </div>
          ))}
        </div>

        <div>
          <p className="card-title">Predictions</p>
          {run.predictions.map((p, i) => (
            <div key={i} className="intel-prediction">
              <div className="intel-pred-head">
                <span>{p.prediction}</span>
                <span className="intel-pred-pct">{(p.probability * 100).toFixed(0)}%</span>
              </div>
              <div className="intel-pred-bar">
                <div className="intel-pred-fill" style={{ width: `${p.probability * 100}%` }} />
              </div>
              <span className="intel-pred-action">{formatAction(p.action)}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="card-title" style={{ marginTop: 20 }}>Immediate Actions</p>
      <ol className="intel-actions">
        {run.actions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ol>
    </div>
  );
}
