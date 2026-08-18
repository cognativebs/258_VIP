"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WORKSPACES,
  TABLE_COLUMNS,
  DEFAULT_FILTERS,
  RECOMMENDATIONS,
  applyComicFilters,
  sortComics,
  paginate,
  countActiveFilters,
  buildDashboardStats,
  getUniquePublishers,
  scoreClass,
  priorityClass,
  recClass,
  formatCell,
  buildTickerItems,
  fmtMoney,
  pillarShort,
} from "@/lib/comicEngine";
import { loadVerticalTerminalData, patchComicHolding } from "@/lib/comicsClient";
import type { ComicFilters, ComicRow, ComicsMeta } from "@/lib/comicTypes";
import { BINDER_URL } from "@/lib/api";
import { getCollectionTab, workspaceChips, type CollectionTabId } from "@/lib/collectionTabs";
import { filterByVerticalWorkspace } from "@/lib/verticalInventory";
import { ComicsAnalyticsChat } from "./ComicsAnalyticsChat";

const PAGE_SIZE = 50;

export function ComicsTerminal({ tabId = "comic" }: { tabId?: CollectionTabId }) {
  const tab = getCollectionTab(tabId);
  const [meta, setMeta] = useState<ComicsMeta | null>(null);
  const [inventory, setInventory] = useState<ComicRow[]>([]);
  const [source, setSource] = useState<"comics-api" | "vip-api" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState("all");
  const [filters, setFilters] = useState<ComicFilters>({ ...DEFAULT_FILTERS });
  const [sortKey, setSortKey] = useState("Current Price");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rightPanel, setRightPanel] = useState<"inspector" | "analytics">("inspector");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setWorkspace("all");
    (async () => {
      try {
        const data = await loadVerticalTerminalData(tab.id);
        if (cancelled) return;
        setMeta(data.meta);
        setInventory(data.inventory);
        setSource(data.source);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : `Failed to load ${tab.label}`);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.id, tab.label]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        setRightPanel((p) => (p === "analytics" ? "inspector" : "analytics"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const publishers = useMemo(() => getUniquePublishers(inventory), [inventory]);

  const workspaceOptions = useMemo(() => {
    if (tab.kind === "comic") return WORKSPACES;
    return workspaceChips(tab).map((c) => ({ id: c.id, label: c.label, desc: c.label }));
  }, [tab]);

  const filtered = useMemo(() => {
    let rows = filterByVerticalWorkspace(inventory, workspace, tab);
    rows = applyComicFilters(rows, filters);
    return sortComics(rows, sortKey, sortDir);
  }, [inventory, workspace, filters, sortKey, sortDir, tab]);

  const filteredValue = useMemo(
    () => filtered.reduce((s: number, r: ComicRow) => s + (Number(r["Current Price"]) || 0) * (Number(r.Quantity) || 1), 0),
    [filtered],
  );

  const dashboardStats = useMemo(() => buildDashboardStats(filtered), [filtered]);
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const paged = useMemo(() => paginate(filtered, page, PAGE_SIZE), [filtered, page]);
  const selected = useMemo(
    () => inventory.find((r) => r.id === selectedId) ?? null,
    [inventory, selectedId],
  );
  const ticker = useMemo(
    () => buildTickerItems(filtered.length ? filtered : inventory, meta),
    [filtered, inventory, meta],
  );

  useEffect(() => {
    setPage(1);
  }, [workspace, filters, sortKey, sortDir]);

  const onSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const saveSelected = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!selected || source !== "comics-api") return;
      setSaving(true);
      try {
        const row = await patchComicHolding(selected.id, patch);
        if (row) {
          setInventory((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...row } : r)));
        }
      } finally {
        setSaving(false);
      }
    },
    [selected, source],
  );

  if (loading) {
    return (
      <div className="bb-terminal bb-terminal-embedded">
        <div className="bb-loading">Loading {tab.terminalLabel.toLowerCase()}…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bb-terminal bb-error bb-terminal-embedded">
        <p>{error}</p>
        <p className="bb-detail-hint-lg">Start VIP API and optionally Comics API:</p>
        <code>npm run api</code>
        <code>python api/comics_server.py</code>
      </div>
    );
  }

  return (
    <div className="bb-terminal bb-terminal-embedded">
      <div className="bb-ticker-wrap">
        <div className="bb-ticker">
          {[...ticker, ...ticker].map((item: { type: string; text: string }, i: number) => (
            <span key={i} className={`bb-tick bb-tick-${item.type}`}>
              {item.text}
            </span>
          ))}
        </div>
      </div>

      <div className="bb-topbar">
        <div className="bb-topbar-brand">
          <span className="bb-orange">IQVAULT</span>
          <span className="bb-dim">{tab.terminalLabel}</span>
          <span className="bb-dim" style={{ marginLeft: 8 }}>
            · {source === "comics-api" ? "Postgres live" : "VIP inventory"}
          </span>
        </div>
        <div className="bb-topbar-stats">
          <span>
            <em>Showing</em> {filtered.length.toLocaleString()}
          </span>
          <span>
            <em>Value</em> {fmtMoney(filteredValue)}
          </span>
          <span>
            <em>Vault</em> {fmtMoney(meta?.totalValue)}
          </span>
          <span>
            <em>MUS</em> {dashboardStats.museumCount}
          </span>
        </div>
        <div className="bb-topbar-actions">
          <button
            type="button"
            className={`bb-btn bb-btn-ghost ${rightPanel === "analytics" ? "bb-btn-active" : ""}`}
            onClick={() => setRightPanel((p) => (p === "analytics" ? "inspector" : "analytics"))}
            title="Conversational analytics on current filter (F11)"
          >
            Analytics
          </button>
          <button
            type="button"
            className="bb-btn bb-btn-ghost"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            {filtersOpen ? "Hide" : "Show"} filters
            {activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
        </div>
      </div>

      <div className="bb-command">
        <span className="bb-prompt">Search</span>
        <input
          className="bb-search"
          type="search"
          placeholder="Series, issue, variant, barcode, key note…"
          value={filters.query}
          onChange={(e) => setFilters({ ...filters, query: e.target.value })}
          spellCheck={false}
        />
        {workspace !== "all" ? (
          <button type="button" className="bb-chip" onClick={() => setWorkspace("all")}>
            Workspace: {workspaceOptions.find((w: { id: string }) => w.id === workspace)?.label} ×
          </button>
        ) : null}
      </div>

      <div className={`bb-layout ${filtersOpen ? "" : "bb-layout-no-filters"}`}>
        {filtersOpen ? (
          <aside className="bb-filter-panel">
            <div className="bb-panel-head">FILTERS</div>
            <div className="bb-filter-active-bar">
              <span>{activeFilterCount} active</span>
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  className="bb-link-btn"
                  onClick={() => setFilters({ ...DEFAULT_FILTERS })}
                >
                  Clear all
                </button>
              ) : null}
            </div>

            <div className="bb-filter-section">
              <div className="bb-filter-section-title">Quick workspaces</div>
              <div className="bb-ws-grid">
                {workspaceOptions.map((ws: { id: string; label: string; desc: string }) => (
                  <button
                    key={ws.id}
                    type="button"
                    className={`bb-ws-chip ${workspace === ws.id ? "active" : ""}`}
                    title={ws.desc}
                    onClick={() => setWorkspace(ws.id)}
                  >
                    {ws.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bb-filter-section">
              <div className="bb-filter-section-title">Recommendation</div>
              <div className="bb-rec-chips">
                {RECOMMENDATIONS.map((rec: string) => (
                  <button
                    key={rec}
                    type="button"
                    className={`bb-rec-chip ${
                      filters.recommendations?.includes(rec) ? "active" : ""
                    }`}
                    onClick={() => {
                      const cur = filters.recommendations ?? [];
                      const next = cur.includes(rec)
                        ? cur.filter((r) => r !== rec)
                        : [...cur, rec];
                      setFilters({ ...filters, recommendations: next });
                    }}
                  >
                    {rec}
                  </button>
                ))}
              </div>
            </div>

            <div className="bb-filter-section">
              <div className="bb-filter-section-title">Pillar</div>
              <select
                className="bb-input bb-input-full"
                value={filters.pillar}
                onChange={(e) => setFilters({ ...filters, pillar: e.target.value })}
              >
                <option value="">All pillars</option>
                {(meta?.pillars ?? []).map((p) => (
                  <option key={p.name} value={p.name}>
                    {pillarShort(p.name)} ({p.count})
                  </option>
                ))}
              </select>
            </div>

            <div className="bb-filter-section">
              <div className="bb-filter-section-title">Publisher</div>
              <select
                className="bb-input bb-input-full"
                value={filters.publisher}
                onChange={(e) => setFilters({ ...filters, publisher: e.target.value })}
              >
                <option value="">All</option>
                {(publishers as string[]).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="bb-filter-section">
              <label className="bb-toggle">
                <input
                  type="checkbox"
                  checked={filters.needsGrading}
                  onChange={(e) => setFilters({ ...filters, needsGrading: e.target.checked })}
                />
                <span>Needs grading</span>
              </label>
              <label className="bb-toggle">
                <input
                  type="checkbox"
                  checked={filters.duplicateOnly}
                  onChange={(e) => setFilters({ ...filters, duplicateOnly: e.target.checked })}
                />
                <span>Duplicates only</span>
              </label>
              <label className="bb-toggle">
                <input
                  type="checkbox"
                  checked={filters.keyOnly}
                  onChange={(e) => setFilters({ ...filters, keyOnly: e.target.checked })}
                />
                <span>Keys only</span>
              </label>
            </div>

            <div className="bb-filter-section">
              <div className="bb-filter-section-title">Min liquidity · {filters.minLiquidity}</div>
              <div className="bb-range-row">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={filters.minLiquidity}
                  onChange={(e) =>
                    setFilters({ ...filters, minLiquidity: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          </aside>
        ) : null}

        <section className="bb-table-panel">
          <div className="bb-table-scroll">
            <table className="bb-table">
              <thead>
                <tr>
                  {TABLE_COLUMNS.map((col: { id: string; label: string; minWidth?: number; numeric?: boolean }) => (
                    <th
                      key={col.id}
                      style={{ minWidth: col.minWidth }}
                      className={sortKey === col.id ? "sorted" : ""}
                      onClick={() => onSort(col.id)}
                    >
                      {col.label}
                      {sortKey === col.id ? (
                        <span className="bb-sort-arrow">{sortDir === "asc" ? " ▲" : " ▼"}</span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.rows.length === 0 ? (
                  <tr>
                    <td colSpan={TABLE_COLUMNS.length} className="bb-empty-row">
                      No {tab.unit} match these filters.
                    </td>
                  </tr>
                ) : (
                  paged.rows.map((row: ComicRow) => (
                    <tr
                      key={row.id}
                      className={[
                        selectedId === row.id ? "selected" : "",
                        row.Recommendation === "Museum Candidate" ? "museum" : "",
                        row["Collection Pillar"] === "General Inventory" ? "pillar-review" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setSelectedId(row.id)}
                    >
                      {TABLE_COLUMNS.map((col: { id: string; numeric?: boolean }) => (
                        <td
                          key={col.id}
                          className={[
                            col.numeric ? "num" : "",
                            ["Museum Score", "Investment Score", "Liquidity Score"].includes(col.id)
                              ? scoreClass(Number(row[col.id]) || 0)
                              : "",
                            col.id === "Sell Priority"
                              ? priorityClass(String(row[col.id] ?? ""))
                              : "",
                            col.id === "Recommendation"
                              ? recClass(String(row[col.id] ?? ""))
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {col.id === "Collection Pillar"
                            ? pillarShort(String(row[col.id] ?? ""))
                            : formatCell(col.id, row[col.id])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="bb-pager">
            <button type="button" disabled={paged.page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <span>
              {paged.start}–{paged.end} of {paged.total}
            </span>
            <button
              type="button"
              disabled={paged.page >= paged.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </section>

        <aside className="bb-right-panel">
          <div className="bb-right-tabs">
            <button
              type="button"
              className={rightPanel === "inspector" ? "active" : ""}
              onClick={() => setRightPanel("inspector")}
            >
              Inspector
            </button>
            <button
              type="button"
              className={rightPanel === "analytics" ? "active" : ""}
              onClick={() => setRightPanel("analytics")}
            >
              Analytics
            </button>
          </div>
          {rightPanel === "analytics" ? (
            <ComicsAnalyticsChat
              meta={meta}
              filtered={filtered}
              dashboardStats={dashboardStats}
              filters={filters}
              workspace={workspace}
              selectedComic={selected}
              filteredValue={filteredValue}
              vertical={tab.id}
              unit={tab.unit}
            />
          ) : !selected ? (
            <div className="bb-detail-body">
              <p className="bb-dim">Select a row to inspect.</p>
              {tab.group === "tcg" ? (
                <p className="bb-detail-hint-lg" style={{ marginTop: 12 }}>
                  TCG layout lives in Binder.{" "}
                  <a href={BINDER_URL} target="_blank" rel="noreferrer">Open Binder ↗</a>
                </p>
              ) : null}
              {tab.group === "sports" && inventory.length === 0 ? (
                <p className="bb-detail-hint-lg" style={{ marginTop: 12 }}>
                  No sports-card holdings in VIP yet. This terminal is live; rows appear when
                  inventory is classified into this vertical (inferred · unverified).
                </p>
              ) : null}
            </div>
          ) : (
            <div className="bb-detail-body">
              {selected["Cover Image URL"] ? (
                <div className="bb-cover-wrap">
                  <img
                    src={String(selected["Cover Image URL"])}
                    alt=""
                    className="bb-cover"
                    loading="lazy"
                  />
                </div>
              ) : null}
              <h3 className="bb-detail-title">
                {selected.Series} #{selected["Issue Full"] || selected.Issue}
              </h3>
              <p className="bb-dim">{String(selected["Edition / Variant"] || "—")}</p>
              <div className="bb-detail-grid">
                <div>
                  <span className="bb-dim">Pillar</span>
                  <div>{String(selected["Collection Pillar"] || "—")}</div>
                </div>
                <div>
                  <span className="bb-dim">Value</span>
                  <div>{formatCell("Current Price", selected["Current Price"])}</div>
                </div>
                <div>
                  <span className="bb-dim">Scores</span>
                  <div>
                    MUS {selected["Museum Score"] ?? "—"} · INV {selected["Investment Score"] ?? "—"}{" "}
                    · LIQ {selected["Liquidity Score"] ?? "—"}
                  </div>
                </div>
                <div>
                  <span className="bb-dim">Recommendation</span>
                  <div className={recClass(String(selected.Recommendation ?? ""))}>
                    {String(selected.Recommendation || "—")}
                  </div>
                </div>
                <div>
                  <span className="bb-dim">Sell priority</span>
                  <div className={priorityClass(String(selected["Sell Priority"] ?? ""))}>
                    {String(selected["Sell Priority"] || "—")}
                  </div>
                </div>
                <div>
                  <span className="bb-dim">Notes</span>
                  <div>{String(selected["Verification Notes"] || "—")}</div>
                </div>
              </div>
              {source === "comics-api" ? (
                <button
                  type="button"
                  className="bb-btn bb-btn-primary"
                  style={{ marginTop: 12 }}
                  disabled={saving}
                  onClick={() => void saveSelected({ "Needs Verification": "No" })}
                >
                  Mark verified
                </button>
              ) : (
                <p className="bb-detail-hint-lg" style={{ marginTop: 12 }}>
                  Read-only on VIP fallback. Start Comics API (:5200) for live edits.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
