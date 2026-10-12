"use client";

import { useMemo, useState } from "react";
import { apiPatch, apiPost } from "@/lib/api";

/** TARGET → WATCHING → BUY → ORDERED → OWNED, PASS; owned/wanted/missing on older hunts. */
export type HuntItemStatus =
  | "target"
  | "watching"
  | "buy"
  | "ordered"
  | "owned"
  | "pass"
  | "wanted"
  | "missing";

export type HuntItem = {
  id: string;
  name: string;
  status: HuntItemStatus;
  priority: string;
  buyUnder: number | null;
  market: number | null;
  imageUrl?: string | null;
  notes?: string | null;
  details?: { reason?: string };
  ebay?: HuntItemEbay | null;
  /** Comic hunts: copies found on the shelf by series + issue + cover. Inferred, never a status. */
  shelf?: {
    copies: number;
    possibleCopies: number;
    matches: { source: string; kind: "exact" | "possible"; label: string; quantity: number }[];
  };
};

export type HuntShelfSummary = { onShelf: number; possible: number; total: number; pct: number };

export type HuntAlert = {
  id: string;
  band: string;
  askPrice: number;
  title: string | null;
  url: string | null;
  status: "new" | "seen" | "dismissed";
  createdAt: string;
  similarCount?: number;
};

/** Latest "Check eBay now": asking prices only — never market value. */
export type HuntItemEbay = {
  checkedAt: string | null;
  strongCount: number;
  listingCount: number;
  lowStrongAsk: number | null;
  alerts: HuntAlert[];
};

type CheckResult = {
  checked: number;
  listings: number;
  strongListings: number;
  newAlerts: number;
  stoppedReason: string | null;
  errors: { itemId: string; error: string }[];
};

function money2(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function AskLine({ item }: { item: HuntItem }) {
  const e = item.ebay;
  if (!e?.checkedAt) return null;
  const when = new Date(e.checkedAt).toLocaleString();
  return (
    <div className="muted" style={{ fontSize: 11, marginTop: 4 }} title={`Checked ${when}. Asking price is not market value.`}>
      {e.lowStrongAsk != null
        ? `eBay ask from ${money2(e.lowStrongAsk)} · ${e.strongCount} exact of ${e.listingCount} listings`
        : e.listingCount
          ? `eBay: ${e.listingCount} listings, none clearly this cover`
          : "eBay: no listings"}
    </div>
  );
}

export type HuntSet = {
  id: string;
  name: string;
  status: string;
  priority: string;
  progress: {
    owned: number;
    total: number;
    completionPct: number;
    totalPaid: number;
    missing: string[];
  };
};

export type Hunt = {
  id: string;
  /** "vault_hunt" hunts are editable; Need Binder is computed from the collection. */
  source?: string;
  name: string;
  description: string;
  metrics: {
    owned: number;
    wanted: number;
    missing: number;
    total: number;
    completionPct: number;
  };
  sections: { id: string; name: string; items: HuntItem[] }[];
  sets?: HuntSet[];
  shelf?: HuntShelfSummary;
};

function ShelfLine({ item }: { item: HuntItem }) {
  const shelf = item.shelf;
  if (!shelf || (shelf.copies === 0 && shelf.possibleCopies === 0)) return null;
  const exact = shelf.copies > 0;
  return (
    <div
      className="muted"
      style={{ fontSize: 11, marginTop: 4 }}
      title={shelf.matches.map((m) => `${m.kind === "exact" ? "match" : "possible"}: ${m.label}`).join(" | ")}
    >
      {exact
        ? `On shelf ×${shelf.copies} · inferred · unverified${item.status !== "owned" ? " — mark Owned if right" : ""}`
        : `Possibly on shelf ×${shelf.possibleCopies} — cover not recorded, check the book`}
    </div>
  );
}

function HuntAlerts({
  hunt,
  onSet,
}: {
  hunt: Hunt;
  onSet: (alertId: string, status: "seen" | "dismissed") => void;
}) {
  const alerts = hunt.sections
    .flatMap((s) => s.items)
    .flatMap((i) => (i.ebay?.alerts ?? []).map((a) => ({ ...a, itemName: i.name })));
  if (!alerts.length) return null;
  const small = { fontSize: 10, padding: "2px 6px" };
  return (
    <ul className="hunt-preview-list" style={{ marginTop: 10 }}>
      {alerts.map((a) => (
        <li key={a.id}>
          <strong>{a.band.replace("_", " ")}</strong> · {a.itemName} · ask from {money2(a.askPrice)}
          {a.similarCount ? ` · +${a.similarCount} similar listing${a.similarCount === 1 ? "" : "s"}` : ""}
          {a.status === "seen" ? " · seen" : ""}
          {a.url ? (
            <>
              {" · "}
              <a href={a.url} target="_blank" rel="noreferrer">
                listing
              </a>
            </>
          ) : null}
          <div className="muted" style={{ fontSize: 11 }}>
            {a.title}
          </div>
          <span style={{ display: "inline-flex", gap: 4, marginTop: 4 }}>
            {a.status === "new" ? (
              <button type="button" className="nav-link" style={small} onClick={() => onSet(a.id, "seen")}>
                Seen
              </button>
            ) : null}
            <button type="button" className="nav-link" style={small} onClick={() => onSet(a.id, "dismissed")}>
              Dismiss
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The lifecycle the collector moves an item through (PASS = evaluated and declined). */
const LIFECYCLE: HuntItemStatus[] = ["target", "watching", "buy", "ordered", "owned", "pass"];

function StatusButtons({
  item,
  busy,
  onSet,
}: {
  item: HuntItem;
  busy: boolean;
  onSet: (status: HuntItemStatus) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {LIFECYCLE.map((s) => (
        <button
          key={s}
          type="button"
          className={`nav-link ${item.status === s ? "on" : ""}`}
          style={{ fontSize: 10, padding: "2px 6px" }}
          disabled={busy || item.status === s}
          onClick={() => onSet(s)}
        >
          {s.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const stillWanted = (i: HuntItem) => i.status !== "owned" && i.status !== "pass";

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

export function HuntsExplorer({ hunts: initialHunts }: { hunts: Hunt[] }) {
  const [hunts, setHunts] = useState(initialHunts);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);

  const replaceHunt = (updated: Hunt | null) => {
    if (updated) setHunts((all) => all.map((h) => (h.id === updated.id ? updated : h)));
  };

  async function checkEbay(huntId: string) {
    setChecking(true);
    setEditError(null);
    setCheckResult(null);
    try {
      // One eBay search per open item; allow a few minutes for a large hunt.
      const out = await apiPost<{ result: CheckResult; hunt: Hunt | null }>(
        `/api/hunts/${encodeURIComponent(huntId)}/check-ebay`,
        {},
        180_000,
      );
      setCheckResult(out.result);
      replaceHunt(out.hunt);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "eBay check failed");
    } finally {
      setChecking(false);
    }
  }

  async function setAlertStatus(huntId: string, alertId: string, status: "seen" | "dismissed") {
    setEditError(null);
    try {
      const out = await apiPatch<{ hunt: Hunt | null }>(
        `/api/hunts/${encodeURIComponent(huntId)}/alerts/${encodeURIComponent(alertId)}`,
        { status },
      );
      replaceHunt(out.hunt);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Alert update failed");
    }
  }
  const [activeId, setActiveId] = useState<string | null>(null);

  async function setItemStatus(huntId: string, itemId: string, status: HuntItemStatus) {
    setBusyItem(itemId);
    setEditError(null);
    try {
      const { hunt: updated } = await apiPatch<{ hunt: Hunt | null }>(
        `/api/hunts/${encodeURIComponent(huntId)}/items/${encodeURIComponent(itemId)}`,
        { status },
      );
      replaceHunt(updated);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Status change failed");
    } finally {
      setBusyItem(null);
    }
  }
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
      .filter(stillWanted)
      .reduce((sum, i) => sum + (i.buyUnder ?? i.market ?? 0), 0);
    const buyTargets = hunt.sections
      .flatMap((s) => s.items)
      .filter(stillWanted)
      .sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority] ?? 9;
        const pb = PRIORITY_RANK[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
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
          </div>
          <CompletionRing pct={hunt.metrics.completionPct} size={72} />
        </div>

        <div className="grid-stats" style={{ gridTemplateColumns: `repeat(${hunt.shelf ? 5 : 4}, 1fr)` }}>
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
          {hunt.shelf ? (
            <div className="stat" title="Matched from your collection by series + issue + cover. Inferred · unverified.">
              <div className="n">
                {hunt.shelf.onShelf}/{hunt.shelf.total}
              </div>
              <div className="l">
                On shelf · inferred{hunt.shelf.possible ? ` (+${hunt.shelf.possible} possible)` : ""}
              </div>
            </div>
          ) : null}
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

        {editError ? <div className="error" style={{ marginBottom: 12 }}>{editError}</div> : null}

        {hunt.source === "vault_hunt" ? (
          <div className="panel" style={{ marginBottom: 22 }}>
            <h3>eBay asks</h3>
            <p className="muted" style={{ fontSize: 12 }}>
              Runs only when you click: one eBay search per item still wanted. Asking prices are not market value.
            </p>
            <button type="button" className="nav-link" disabled={checking} onClick={() => void checkEbay(hunt.id)}>
              {checking ? "Checking eBay…" : "Check eBay now"}
            </button>
            {checkResult ? (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Checked {checkResult.checked} items · {checkResult.listings} listings ({checkResult.strongListings} exact) ·{" "}
                {checkResult.newAlerts} new alert{checkResult.newAlerts === 1 ? "" : "s"}
                {checkResult.stoppedReason ? ` · stopped: ${checkResult.stoppedReason}` : ""}
                {checkResult.errors.length && !checkResult.stoppedReason ? ` · ${checkResult.errors.length} errors` : ""}
              </div>
            ) : null}
            <HuntAlerts hunt={hunt} onSet={(alertId, status) => void setAlertStatus(hunt.id, alertId, status)} />
          </div>
        ) : null}

        {hunt.sets?.length ? (
          <div className="panel" style={{ marginBottom: 22 }}>
            <h3>Sets</h3>
            <ul className="hunt-preview-list">
              {hunt.sets.map((set) => (
                <li key={set.id}>
                  <strong>{set.name}</strong> · {set.status.toUpperCase()} · {set.progress.owned}/
                  {set.progress.total} ({set.progress.completionPct}%)
                  {set.progress.totalPaid > 0 ? ` · paid ${money(set.progress.totalPaid)}` : ""}
                  {set.progress.missing.length ? (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Missing: {set.progress.missing.join(" · ")}
                    </div>
                  ) : null}
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
            {section.items.length === 0 ? (
              <p className="muted">No still-needed pockets in this section.</p>
            ) : (
              section.items.map((item) => (
                <div key={item.id} className="hunt-tile">
                  {item.imageUrl ? (
                    <img className="hunt-art" src={item.imageUrl} alt="" />
                  ) : (
                    <div className="hunt-art" aria-hidden />
                  )}
                  <div className="hunt-meta">
                    <div className="name">{item.name}</div>
                    <div className={`status-${item.status}`} style={{ fontSize: 12, marginTop: 4 }}>
                      {item.status.toUpperCase()}
                      {item.buyUnder != null ? ` · buy under ${money(item.buyUnder)}` : ""}
                    </div>
                    <ShelfLine item={item} />
                    <AskLine item={item} />
                    {hunt.source === "vault_hunt" ? (
                      <StatusButtons
                        item={item}
                        busy={busyItem === item.id}
                        onSet={(status) => void setItemStatus(hunt.id, item.id, status)}
                      />
                    ) : null}
                    {item.notes ?? item.details?.reason ? (
                      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                        {item.notes ?? item.details?.reason}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
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
            <p className="hunt-card-desc">{h.description}</p>
            <div className="hunt-card-stats">
              <span>
                {h.metrics.owned}/{h.metrics.total} owned
              </span>
              <span>{h.metrics.completionPct}% complete</span>
              {h.shelf ? (
                <span title="Inferred from your collection · unverified">
                  {h.shelf.onShelf}/{h.shelf.total} on shelf
                </span>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
