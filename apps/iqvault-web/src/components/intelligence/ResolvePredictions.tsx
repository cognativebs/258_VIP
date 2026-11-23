"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";

/** A prediction past its horizon with no outcome (vault_core.prediction_needs_scoring). */
export type DuePrediction = {
  id: string;
  assetId: string;
  predictedAt: string;
  resolvesAt: string;
  priceAtPrediction: number;
  horizonDays: number;
  probabilityDown: number;
  probabilitySideways: number;
  probabilityUp: number;
  assumptions?: string | null;
  modelVersion: string;
};

const inputStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: 8,
  padding: "8px 10px",
};

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Resolve form for due predictions. A person types the observed price; the API
 * derives direction and error and freezes the row. Nothing here auto-resolves,
 * and a resolved prediction cannot be edited again.
 */
export function ResolvePredictions({
  due,
  source,
  store,
}: {
  due: DuePrediction[];
  source: string;
  store: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function resolve(id: string, form: HTMLFormElement) {
    const f = new FormData(form);
    setBusy(id);
    setErr(null);
    setMsg(null);
    try {
      const out = await apiPost<{
        prediction: { actualDirection: string; forecastError: number };
        store: string;
      }>(`/api/intelligence/predictions/${id}/resolve`, {
        actualPrice: Number(f.get("actualPrice")),
        explanation: String(f.get("explanation") || "") || undefined,
      });
      setMsg(
        `Resolved: actual direction ${out.prediction.actualDirection}, error ${out.prediction.forecastError} (${out.store}). This row is now frozen.`,
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="panel">
      <h3>Predictions due for an outcome · {due.length}</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Past horizon, no outcome recorded. Source <code>{source}</code> ·{" "}
        <span className={`badge ${store === "postgres" ? "badge-ok" : "badge-warn"}`}>{store}</span>{" "}
        Enter the observed price you checked yourself; nothing resolves automatically.
      </p>
      {msg ? <p className="badge badge-ok">{msg}</p> : null}
      {err ? <div className="error">{err}</div> : null}
      {due.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Nothing is waiting for an outcome.</p>
      ) : null}
      {due.map((p) => (
        <form
          key={p.id}
          className="stack"
          style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            void resolve(p.id, e.currentTarget);
          }}
        >
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>${p.priceAtPrediction}</strong> on {day(p.predictedAt)} · {p.horizonDays}d horizon, due{" "}
            {day(p.resolvesAt)} · down {pct(p.probabilityDown)} / sideways {pct(p.probabilitySideways)} / up{" "}
            {pct(p.probabilityUp)} · <span className="badge">{p.modelVersion}</span>
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            asset <code>{p.assetId}</code>
            {p.assumptions ? ` — ${p.assumptions}` : ""}
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              name="actualPrice"
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="Observed price"
              aria-label="Observed price"
              style={inputStyle}
            />
            <input
              name="explanation"
              placeholder="Where the price came from / what happened"
              aria-label="Explanation"
              style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            />
            <button type="submit" className="nav-link on" disabled={busy === p.id}>
              {busy === p.id ? "Recording…" : "Record outcome"}
            </button>
          </div>
        </form>
      ))}
    </article>
  );
}
