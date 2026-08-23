"use client";

import type { CreditPause } from "@/lib/orchestr8Api";

export function CreditPauseAlert({
  pause,
  runId,
  onResume,
  resuming,
}: {
  pause: CreditPause;
  runId?: string | null;
  onResume?: () => void;
  resuming?: boolean;
}) {
  return (
    <div className="banner error credit-pause" role="alert">
      <div>
        <strong>{pause.headline || "PAUSED — credit / billing limit"}</strong>
        {runId ? <span className="dim"> · {runId}</span> : null}
      </div>
      <dl className="credit-pause-dl">
        <div>
          <dt>Role</dt>
          <dd>
            {pause.role_label || pause.role || "—"}
            {pause.remaining_roles?.length ? ` · retry first` : ""}
          </dd>
        </div>
        <div>
          <dt>Provider / model</dt>
          <dd>
            {pause.provider_label || pause.provider || "—"}
            {pause.model_label ? ` · ${pause.model_label}` : ""}
          </dd>
        </div>
        <div>
          <dt>Provider error</dt>
          <dd className="mono">{pause.detail || "—"}</dd>
        </div>
        <div>
          <dt>Kept (will not re-run)</dt>
          <dd>{pause.completed_roles?.length ? pause.completed_roles.join(", ") : "none yet"}</dd>
        </div>
        <div>
          <dt>Still waiting</dt>
          <dd>{pause.remaining_roles?.length ? pause.remaining_roles.join(" → ") : "—"}</dd>
        </div>
        {typeof pause.spent_usd === "number" ? (
          <div>
            <dt>Spend so far</dt>
            <dd>${pause.spent_usd.toFixed(4)}</dd>
          </div>
        ) : null}
      </dl>
      <p>{pause.instruction}</p>
      <div className="actions" style={{ marginTop: 8 }}>
        {pause.topup_url ? (
          <a className="btn" href={pause.topup_url} target="_blank" rel="noreferrer">
            Open billing
          </a>
        ) : null}
        {onResume ? (
          <button type="button" className="btn btn-primary" disabled={resuming} onClick={onResume}>
            {resuming ? "Resuming…" : "Resume after top-off"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
