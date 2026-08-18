"use client";

import { useMemo, useState } from "react";

export type HuntItem = {
  id: string;
  name: string;
  status: "owned" | "wanted" | "missing";
  priority: string;
  buyUnder: number | null;
  market: number | null;
  notes?: string | null;
};

export type Hunt = {
  id: string;
  name: string;
  description: string;
  status?: string;
  suggestion?: boolean;
  suggestionNote?: string | null;
  category?: string;
  metrics: {
    owned: number;
    wanted: number;
    missing: number;
    total: number;
    completionPct: number;
  };
  sections: { id: string; name: string; items: HuntItem[] }[];
};

function CompletionRing({ pct, size = 56 }: { pct: number; size?: number }) {
  const cls = pct >= 50 ? "high" : pct >= 20 ? "mid" : "low";
  return (
    <div className={`hunt-ring ${cls}`} style={{ width: size, height: size }}>
      <span>{Math.round(pct)}%</span>
    </div>
  );
}

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function HuntsExplorer({ hunts }: { hunts: Hunt[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const hunt = useMemo(
    () => hunts.find((h) => h.id === activeId) ?? null,
    [hunts, activeId],
  );
  const [sectionId, setSectionId] = useState<string | null>(null);

  if (hunt) {
    const section =
      hunt.sections.find((s) => s.id === sectionId) ?? hunt.sections[0] ?? null;
    const remaining = hunt.sections
      .flatMap((s) => s.items)
      .filter((i) => i.status !== "owned")
      .reduce((sum, i) => sum + (i.buyUnder ?? i.market ?? 0), 0);
    const buyTargets = hunt.sections
      .flatMap((s) => s.items)
      .filter((i) => i.status !== "owned")
      .sort((a, b) => {
        const pa = a.priority || "Z";
        const pb = b.priority || "Z";
        if (pa !== pb) return pa.localeCompare(pb);
        return (a.buyUnder ?? 9999) - (b.buyUnder ?? 9999);
      })
      .slice(0, 6);

    return (
      <div className="page-pad">
        <button type="button" className="back-btn" onClick={() => setActiveId(null)}>
          ← All Hunts
        </button>
        <div className="hunt-detail-header">
          <div className="hunt-detail-icon">🎯</div>
          <div>
            <h1 className="page-title">{hunt.name}</h1>
            <p className="page-sub">{hunt.description}</p>
            {hunt.suggestion ? (
              <p className="muted" style={{ fontSize: 13 }}>
                Suggested hunt — not in the 2026-08-15 plan files.
                {hunt.suggestionNote ? ` ${hunt.suggestionNote}` : ""}
              </p>
            ) : null}
          </div>
          <CompletionRing pct={hunt.metrics.completionPct} size={72} />
        </div>

        <div className="grid-stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="stat">
            <div className="n">
              {hunt.metrics.owned}/{hunt.metrics.total}
            </div>
            <div className="l">Owned</div>
          </div>
          <div className="stat">
            <div className="n">{hunt.metrics.wanted}</div>
            <div className="l">Wanted</div>
          </div>
          <div className="stat">
            <div className="n">{hunt.metrics.missing}</div>
            <div className="l">Missing</div>
          </div>
          <div className="stat">
            <div className="n">{money(remaining)}</div>
            <div className="l">Est. remaining</div>
          </div>
        </div>

        {buyTargets.length ? (
          <div className="panel" style={{ marginBottom: 22 }}>
            <h3>Buy targets</h3>
            <ul className="hunt-preview-list">
              {buyTargets.map((t) => (
                <li key={t.id}>
                  <strong>{t.name}</strong> · {t.status} · buy under {money(t.buyUnder)}
                  {t.priority ? ` · ${t.priority}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="hunt-section-tabs">
          {hunt.sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`nav-link ${section?.id === s.id ? "on" : ""}`}
              onClick={() => setSectionId(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>

        {section ? (
          <div className="hunt-gallery" style={{ marginTop: 16 }}>
            {section.items.map((item) => (
              <div key={item.id} className="hunt-tile">
                <div className="hunt-art" aria-hidden />
                <div className="hunt-meta">
                  <div className="name">{item.name}</div>
                  <div className={`status-${item.status}`} style={{ fontSize: 12, marginTop: 4 }}>
                    {item.status.toUpperCase()}
                    {item.buyUnder != null ? ` · buy under ${money(item.buyUnder)}` : ""}
                    {item.market != null ? ` · mkt ${money(item.market)}` : ""}
                  </div>
                  {item.notes ? (
                    <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                      {item.notes}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="page-pad">
      <h1 className="page-title">Collection Hunts</h1>
      <p className="page-sub">
        From VIP API — completion metrics, buy targets, and Owned / Wanted / Missing galleries.
      </p>
      <div className="hunt-grid">
        {hunts.map((h) => (
          <button
            key={h.id}
            type="button"
            className="hunt-card"
            onClick={() => {
              setActiveId(h.id);
              setSectionId(h.sections[0]?.id ?? null);
            }}
          >
            <div className="hunt-card-header">
              <div className="hunt-card-icon">🎯</div>
              <CompletionRing pct={h.metrics.completionPct} />
            </div>
            <h3 className="hunt-card-title">{h.name}</h3>
            {h.suggestion ? <span className="badge badge-warn">suggested</span> : null}
            <p className="hunt-card-desc">{h.description}</p>
            <div className="hunt-card-stats">
              <span>
                {h.metrics.owned}/{h.metrics.total} owned
              </span>
              <span>{h.metrics.completionPct}% complete</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
