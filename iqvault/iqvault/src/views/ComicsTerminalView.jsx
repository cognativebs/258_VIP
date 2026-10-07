import { useState, useEffect, useMemo, useCallback } from "react";
import ComicsFilterPanel, { DEFAULT_FILTERS } from "../components/comics/ComicsFilterPanel.jsx";
import ComicsDashboard from "../components/comics/ComicsDashboard.jsx";
import ComicsAnalyticsChat from "../components/comics/ComicsAnalyticsChat.jsx";
import {
  WORKSPACES,
  TABLE_COLUMNS,
  filterByWorkspace,
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
  comicLabel,
} from "../lib/comicEngine.js";

const PAGE_SIZE = 50;

function ScoreBar({ label, value, max = 100 }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="bb-score-row">
      <span className="bb-score-label">{label}</span>
      <div className="bb-score-track">
        <div className={`bb-score-fill ${scoreClass(value)}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="bb-score-num">{Math.round(value)}</span>
    </div>
  );
}

function DetailPanel({ comic, meta, filteredCount }) {
  if (!comic) {
    return (
      <div className="bb-detail bb-detail-empty">
        <div className="bb-panel-head">INSPECTOR</div>
        <div className="bb-detail-body">
          <p className="bb-detail-hint-lg">
            Click any row to inspect cover, scores, and intelligence flags.
          </p>
          <div className="bb-stat-block">
            <span className="bb-stat-label">Filtered set</span>
            <span className="bb-stat-val">{filteredCount?.toLocaleString()} books</span>
          </div>
          <div className="bb-stat-block">
            <span className="bb-stat-label">Full vault</span>
            <span className="bb-stat-val">{meta?.recordCount?.toLocaleString()} books</span>
          </div>
          <div className="bb-stat-block">
            <span className="bb-stat-label">Vault value</span>
            <span className="bb-stat-val bb-orange">{fmtMoney(meta?.totalValue)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bb-detail">
      <div className="bb-panel-head">ISSUE DETAIL</div>
      <div className="bb-detail-body">
        {comic["Cover Image URL"] && (
          <div className="bb-cover-wrap">
            <img src={comic["Cover Image URL"]} alt="" className="bb-cover" loading="lazy" />
          </div>
        )}
        <h3 className="bb-detail-title">{comicLabel(comic)}</h3>
        {comic.Title && <p className="bb-detail-sub">{comic.Title}</p>}
        {comic["Edition / Variant"] && (
          <p className="bb-detail-variant">{comic["Edition / Variant"]}</p>
        )}

        <div className="bb-detail-price">{formatCell("Current Price", comic["Current Price"])}</div>

        <div className="bb-badges">
          <span className="bb-badge">{comic["Collection Pillar"]}</span>
          <span className={`bb-badge ${recClass(comic.Recommendation)}`}>{comic.Recommendation}</span>
          <span className={`bb-badge ${priorityClass(comic["Sell Priority"])}`}>
            Sell: {comic["Sell Priority"]}
          </span>
        </div>

        <ScoreBar label="MUS" value={comic["Museum Score"]} />
        <ScoreBar label="INV" value={comic["Investment Score"]} />
        <ScoreBar label="LIQ" value={comic["Liquidity Score"]} />

        <div className="bb-detail-grid">
          <div><span>LOC</span>{comic.Location || "—"}</div>
          <div><span>SLAB</span>{comic["Slab Status"]} {comic["Assumed Grade"] || comic["Grade Rating"]}</div>
          <div><span>PUB</span>{comic.Publisher}</div>
          <div><span>AGE</span>{comic.Age || "—"}</div>
          <div><span>QTY</span>{comic.Quantity}</div>
          <div><span>REL</span>{comic["Release Date"] || "—"}</div>
        </div>

        {comic["Key Comic Reason"] && (
          <div className="bb-detail-note">
            <span className="bb-note-label">KEY ISSUE</span>
            {comic["Key Comic Reason"]}
          </div>
        )}

        <div className="bb-flags">
          {comic["Needs Grading"] === "Yes" && <span className="bb-flag">NEEDS GRADING</span>}
          {comic.Duplicate === "Yes" && <span className="bb-flag bb-flag-warn">DUPLICATE</span>}
          {comic["Upgrade Candidate"] === "Yes" && <span className="bb-flag bb-flag-good">UPGRADE</span>}
        </div>
      </div>
    </div>
  );
}

function ActiveFilterChips({ filters, onChange, workspace, onClearWorkspace }) {
  const chips = [];

  if (workspace !== "all") {
    const ws = WORKSPACES.find((w) => w.id === workspace);
    chips.push({ key: "ws", label: `Workspace: ${ws?.label}`, clear: onClearWorkspace });
  }
  if (filters.query?.trim()) chips.push({ key: "q", label: `"${filters.query}"`, clear: () => onChange({ ...filters, query: "" }) });
  if (filters.pillar) chips.push({ key: "pillar", label: pillarShort(filters.pillar), clear: () => onChange({ ...filters, pillar: "" }) });
  if (filters.minLiquidity > 0) chips.push({ key: "liq", label: `LIQ ≥ ${filters.minLiquidity}`, clear: () => onChange({ ...filters, minLiquidity: 0 }) });
  if (filters.recommendations?.length) {
    chips.push({
      key: "rec",
      label: `${filters.recommendations.length} rec filter(s)`,
      clear: () => onChange({ ...filters, recommendations: [] }),
    });
  }

  if (!chips.length) return null;

  return (
    <div className="bb-active-chips">
      {chips.map((c) => (
        <button key={c.key} type="button" className="bb-chip" onClick={c.clear}>
          {c.label} ×
        </button>
      ))}
    </div>
  );
}

export default function ComicsTerminalView() {
  const [meta, setMeta] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState("grid");
  const [workspace, setWorkspace] = useState("all");
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [sortKey, setSortKey] = useState("Current Price");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [rightPanel, setRightPanel] = useState("inspector");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [metaRes, invRes] = await Promise.all([
          fetch("/comics/meta.json"),
          fetch("/comics/inventory.json"),
        ]);
        if (!metaRes.ok || !invRes.ok) {
          throw new Error("Comics data not found — run: npm run sync:comics");
        }
        const [metaData, invData] = await Promise.all([metaRes.json(), invRes.json()]);
        if (!cancelled) {
          setMeta(metaData);
          setInventory(invData);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const publishers = useMemo(() => getUniquePublishers(inventory), [inventory]);

  const filtered = useMemo(() => {
    let rows = filterByWorkspace(inventory, workspace);
    rows = applyComicFilters(rows, filters);
    return sortComics(rows, sortKey, sortDir);
  }, [inventory, workspace, filters, sortKey, sortDir]);

  const filteredValue = useMemo(
    () => filtered.reduce((s, r) => s + (r["Current Price"] ?? 0) * (r.Quantity ?? 1), 0),
    [filtered]
  );

  const dashboardStats = useMemo(() => buildDashboardStats(filtered), [filtered]);
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const paged = useMemo(() => paginate(filtered, page, PAGE_SIZE), [filtered, page]);

  const selected = useMemo(
    () => inventory.find((r) => r.id === selectedId) ?? null,
    [inventory, selectedId]
  );

  const ticker = useMemo(() => buildTickerItems(filtered.length ? filtered : inventory, meta), [filtered, inventory, meta]);

  const handleSort = useCallback((colId) => {
    setSortKey((prev) => {
      if (prev === colId) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("desc");
      return colId;
    });
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setWorkspace("all");
    setPage(1);
  }, []);

  const openDashboard = useCallback(() => setViewMode("dashboard"), []);
  const backToGrid = useCallback(() => setViewMode("grid"), []);

  const drillPillar = useCallback((name) => {
    setFilters((f) => ({ ...f, pillar: name }));
    setWorkspace("all");
    setViewMode("grid");
    setPage(1);
  }, []);

  const drillRec = useCallback((name) => {
    setFilters((f) => ({ ...f, recommendations: [name] }));
    setViewMode("grid");
    setPage(1);
  }, []);

  const selectComicFromDash = useCallback((c) => {
    setSelectedId(c.id);
    setViewMode("grid");
  }, []);

  useEffect(() => setPage(1), [workspace, filters, sortKey, sortDir]);

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
      const map = Object.fromEntries(WORKSPACES.map((w) => [w.key, w.id]));
      if (map[e.key]) {
        e.preventDefault();
        setWorkspace(map[e.key]);
      }
      if (e.key === "F10") {
        e.preventDefault();
        setViewMode((m) => (m === "dashboard" ? "grid" : "dashboard"));
      }
      if (e.key === "F11") {
        e.preventDefault();
        setRightPanel((p) => (p === "analytics" ? "inspector" : "analytics"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loading) {
    return (
      <div className="bb-terminal bb-loading">
        <span className="bb-blink">▮</span> Loading comics intelligence…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bb-terminal bb-error">
        <p>{error}</p>
        <code>cd iqvault && npm run sync:comics</code>
      </div>
    );
  }

  if (viewMode === "dashboard") {
    return (
      <div className="bb-terminal">
        <ComicsDashboard
          stats={dashboardStats}
          onBack={backToGrid}
          onDrillPillar={drillPillar}
          onDrillRec={drillRec}
          onSelectComic={selectComicFromDash}
        />
      </div>
    );
  }

  return (
    <div className="bb-terminal">
      <div className="bb-ticker-wrap">
        <div className="bb-ticker">
          {[...ticker, ...ticker].map((item, i) => (
            <span key={i} className={`bb-tick bb-tick-${item.type}`}>{item.text}</span>
          ))}
        </div>
      </div>

      <div className="bb-topbar">
        <div className="bb-topbar-brand">
          <span className="bb-orange">IQVAULT</span>
          <span className="bb-dim">COMICS TERMINAL</span>
        </div>
        <div className="bb-topbar-stats">
          <span><em>Showing</em> {filtered.length.toLocaleString()}</span>
          <span><em>Value</em> {fmtMoney(filteredValue)}</span>
          <span><em>Vault</em> {fmtMoney(meta?.totalValue)}</span>
        </div>
        <div className="bb-topbar-actions">
          <button
            type="button"
            className="bb-btn bb-btn-dashboard"
            onClick={openDashboard}
            title="Build graphic dashboard from current filters (F10)"
          >
            📊 Dashboard
            <span className="bb-btn-sub">{filtered.length.toLocaleString()} books</span>
          </button>
          <button
            type="button"
            className={`bb-btn bb-btn-ghost ${rightPanel === "analytics" ? "bb-btn-active" : ""}`}
            onClick={() => setRightPanel((p) => (p === "analytics" ? "inspector" : "analytics"))}
            title="Conversational analytics on current filter"
          >
            💬 Analytics
          </button>
          <button
            type="button"
            className="bb-btn bb-btn-ghost"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            {filtersOpen ? "Hide" : "Show"} filters
          </button>
        </div>
      </div>

      <div className="bb-command">
        <span className="bb-prompt">Search</span>
        <input
          className="bb-search"
          type="search"
          placeholder="Series, issue, variant, barcode, key note, tag…"
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          spellCheck={false}
        />
        <ActiveFilterChips
          filters={filters}
          onChange={setFilters}
          workspace={workspace}
          onClearWorkspace={() => setWorkspace("all")}
        />
      </div>

      <div className={`bb-layout ${filtersOpen ? "" : "bb-layout-no-filters"}`}>
        {filtersOpen && (
          <ComicsFilterPanel
            filters={filters}
            onChange={setFilters}
            onReset={resetFilters}
            meta={meta}
            publishers={publishers}
            activeFilterCount={activeFilterCount}
            workspace={workspace}
            onWorkspace={setWorkspace}
            workspaces={WORKSPACES}
          />
        )}

        <section className="bb-table-panel">
          <div className="bb-table-scroll">
            <table className="bb-table">
              <thead>
                <tr>
                  {TABLE_COLUMNS.map((col) => (
                    <th
                      key={col.id}
                      style={{ minWidth: col.minWidth }}
                      className={sortKey === col.id ? "sorted" : ""}
                      onClick={() => handleSort(col.id)}
                    >
                      {col.label}
                      {sortKey === col.id && (
                        <span className="bb-sort-arrow">{sortDir === "asc" ? " ▲" : " ▼"}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.rows.length === 0 ? (
                  <tr>
                    <td colSpan={TABLE_COLUMNS.length} className="bb-empty-row">
                      No books match these filters. Try clearing filters or switching workspace.
                    </td>
                  </tr>
                ) : (
                  paged.rows.map((row) => (
                    <tr
                      key={row.id}
                      className={[
                        selectedId === row.id ? "selected" : "",
                        row.Recommendation === "Museum Candidate" ? "museum" : "",
                        row["Collection Pillar"] === "General Inventory" ? "pillar-review" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => setSelectedId(row.id)}
                    >
                      {TABLE_COLUMNS.map((col) => (
                        <td
                          key={col.id}
                          className={[
                            col.numeric ? "num" : "",
                            ["Museum Score", "Investment Score", "Liquidity Score"].includes(col.id)
                              ? scoreClass(row[col.id])
                              : "",
                            col.id === "Sell Priority" ? priorityClass(row[col.id]) : "",
                            col.id === "Recommendation" ? recClass(row[col.id]) : "",
                            col.id === "Current Price" && (row[col.id] || 0) >= 50 ? "bb-price-high" : "",
                          ].filter(Boolean).join(" ")}
                          title={String(row[col.id] ?? "")}
                        >
                          {col.id === "Collection Pillar"
                            ? pillarShort(row[col.id])
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
              ◀ Prev
            </button>
            <span>
              {paged.start}–{paged.end} of {paged.total.toLocaleString()} · Page {paged.page}/{paged.pages}
            </span>
            <button
              type="button"
              disabled={paged.page >= paged.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next ▶
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
            />
          ) : (
            <DetailPanel comic={selected} meta={meta} filteredCount={filtered.length} />
          )}
        </aside>
      </div>

      <footer className="bb-statusbar">
        <span>{meta?.snapshotLabel}</span>
        <span>{filtered.length.toLocaleString()} matching · {activeFilterCount} filters · F1–F8 workspaces</span>
        <span>F10 dashboard · F11 analytics · Click headers to sort</span>
      </footer>
    </div>
  );
}
