"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WORKSPACES,
  TABLE_COLUMNS,
  POKEMON_TABLE_COLUMNS,
  DEFAULT_FILTERS,
  RECOMMENDATIONS,
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
} from "@/lib/comicEngine";
import { CollectionSourceBar } from "@/components/CollectionSourceBar";
import {
  fetchComicsInboxStatus,
  loadComicsTerminalData,
  loadPokemonTerminalData,
  patchComicHolding,
  uploadComicsInboxFile,
  waitForComicsInboxDrain,
} from "@/lib/comicsClient";
import { comicsTerminalSourceLabel } from "@/lib/comicsSourceLabel";
import type { ComicFilters, ComicRow, ComicsMeta } from "@/lib/comicTypes";
import {
  CLZ_CLOUD_URL,
  CLZ_COLLECTOR_URL,
  isAcceptedDropFile,
  type InboxStatus,
} from "@/lib/sourceDrop";
import { BINDER_URL } from "@/lib/api";
import { AnalyticsChat } from "./AnalyticsChat";

const PAGE_SIZE = 50;

export function ComicsTerminal({
  vertical = "comics",
}: {
  vertical?: "comics" | "pokemon";
}) {
  const isPokemon = vertical === "pokemon";
  const columns = isPokemon ? POKEMON_TABLE_COLUMNS : TABLE_COLUMNS;
  const [meta, setMeta] = useState<ComicsMeta | null>(null);
  const [inventory, setInventory] = useState<ComicRow[]>([]);
  const [source, setSource] = useState<"comics-api" | "vip-api" | null>(null);
  const [editable, setEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState("all");
  const [filters, setFilters] = useState<ComicFilters>({ ...DEFAULT_FILTERS });
  const [sortKey, setSortKey] = useState(isPokemon ? "Title" : "Current Price");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(!isPokemon);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<"inspector" | "analytics">("inspector");
  const [inbox, setInbox] = useState<InboxStatus | null>(null);
  const [dropBusy, setDropBusy] = useState(false);
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const [dropErr, setDropErr] = useState<string | null>(null);

  const reloadTerminal = useCallback(async () => {
    const data = isPokemon ? await loadPokemonTerminalData() : await loadComicsTerminalData();
    setMeta(data.meta);
    setInventory(data.inventory);
    setSource(data.source);
    setEditable(data.editable);
  }, [isPokemon]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [data, inboxStatus] = await Promise.all([
          isPokemon ? loadPokemonTerminalData() : loadComicsTerminalData(),
          isPokemon ? Promise.resolve(null) : fetchComicsInboxStatus(),
        ]);
        if (cancelled) return;
        setMeta(data.meta);
        setInventory(data.inventory);
        setSource(data.source);
        setInbox(inboxStatus);
        setEditable(data.editable);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load collection");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPokemon]);

  const onInboxFile = useCallback(
    async (file: File) => {
      if (!isAcceptedDropFile(file, ".xml")) {
        setDropErr("Only Comic Collector XML exports (.xml) are accepted");
        return;
      }
      setDropBusy(true);
      setDropErr(null);
      setDropMsg(`Saving ${file.name}…`);
      try {
        const result = await uploadComicsInboxFile(file);
        if (!result.ok) {
          setDropErr(result.error ?? "Upload failed");
          setDropMsg(null);
          return;
        }
        setInbox((prev) =>
          prev
            ? {
                ...prev,
                inbox: result.inbox ?? prev.inbox,
                pendingCount: (prev.pendingCount ?? 0) + 1,
              }
            : prev,
        );
        setDropMsg(
          `Saved ${result.savedAs ?? file.name} → ${result.inbox ?? "inbox"} · syncing…`,
        );
        const drained = await waitForComicsInboxDrain();
        if (drained) setInbox(drained);
        await reloadTerminal();
        setDropMsg(
          drained && (drained.pendingCount ?? 0) === 0
            ? `Inbox processed · ${result.savedAs ?? file.name}`
            : `Saved ${result.savedAs ?? file.name} — sync still running (or run npm run job:clz-sync)`,
        );
      } catch (e) {
        setDropErr(e instanceof Error ? e.message : "Upload failed");
        setDropMsg(null);
      } finally {
        setDropBusy(false);
      }
    },
    [reloadTerminal],
  );

  const publishers = useMemo(() => getUniquePublishers(inventory), [inventory]);

  const filtered = useMemo(() => {
    let rows = filterByWorkspace(inventory, workspace);
    rows = applyComicFilters(rows, filters);
    return sortComics(rows, sortKey, sortDir);
  }, [inventory, workspace, filters, sortKey, sortDir]);

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

  const needsVerification =
    String(selected?.["Needs Verification"] ?? "").toLowerCase() === "yes";
  const ticker = useMemo(
    () => buildTickerItems(filtered.length ? filtered : inventory, meta),
    [filtered, inventory, meta],
  );

  const clzLinks = useMemo(
    () => [
      {
        href: inbox?.clzCloudUrl || CLZ_CLOUD_URL,
        label: "CLZ Cloud",
        title: "Open CLZ Cloud in a new window",
      },
      {
        href: inbox?.clzCollectorUrl || CLZ_COLLECTOR_URL,
        label: "Comic Collector",
        title: "Open Comic Collector on clz.com in a new window",
      },
    ],
    [inbox?.clzCloudUrl, inbox?.clzCollectorUrl],
  );

  const sourceLinks = isPokemon
    ? [
        {
          href: BINDER_URL,
          label: "Binder Vault",
          title: "Open Binder Vault in a new window",
        },
        {
          href: CLZ_CLOUD_URL,
          label: "CLZ Cloud",
          title: "Open CLZ Cloud in a new window",
        },
      ]
    : clzLinks;

  const comicsApiUp = source === "comics-api";
  const dropEnabled = !isPokemon && comicsApiUp;
  const dropDisabledReason = isPokemon
    ? "Pokémon drop-to-inbox is not wired — layout and owned flags live in Binder Vault"
    : comicsApiUp
      ? undefined
      : "Start Comics API (:5200) for CLZ inbox — Launch IQVault or npm run comics. Holding edits still save through VIP.";
  const dropHint = isPokemon
    ? "Drop TCG export here (not wired yet)"
    : inbox?.inbox
      ? `Drop CLZ XML here → ${inbox.inbox}`
      : "Drop CLZ XML here → E:\\ComicArchive\\inbox (or repo clz-inbox)";

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
      if (!selected || !editable) return;
      setSaving(true);
      setSaveError(null);
      try {
        const row = await patchComicHolding(selected.id, patch);
        if (!row) {
          // A failed patch used to be swallowed, which looked identical to
          // success because the panel showed no verification state at all.
          setSaveError("Save failed — Comics API and VIP both rejected the edit.");
          return;
        }
        // Keep the row keyed on the id the grid selected by; the API echoes the
        // holding's source_row_id, and clz_metadata carries a different hash.
        setInventory((prev) =>
          prev.map((r) => (r.id === selected.id ? { ...r, ...row, id: r.id } : r)),
        );
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [selected, editable],
  );

  if (loading) {
    return (
      <div className="bb-terminal bb-terminal-embedded">
        <CollectionSourceBar
          links={sourceLinks}
          drop={{
            acceptHint: dropHint,
            enabled: false,
            disabledReason: isPokemon ? "Loading Pokémon…" : "Loading comics…",
            onFile: () => undefined,
          }}
        />
        <div className="bb-loading">
          {isPokemon ? "Loading Pokémon TCG terminal…" : "Loading comics terminal…"}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bb-terminal bb-error bb-terminal-embedded">
        <CollectionSourceBar
          links={sourceLinks}
          drop={{
            acceptHint: dropHint,
            enabled: dropEnabled,
            disabledReason: dropDisabledReason,
            busy: dropBusy,
            message: dropMsg,
            error: dropErr,
            onFile: (file) => void onInboxFile(file),
          }}
        />
        <p>{error}</p>
        <p className="bb-detail-hint-lg">Start the VIP stack (Launch IQVault starts Comics API :5200):</p>
        <code>npm run api</code>
        <code>npm run comics</code>
      </div>
    );
  }

  return (
    <div className="bb-terminal bb-terminal-embedded">
      <CollectionSourceBar
        links={sourceLinks}
        drop={{
          acceptHint: dropHint,
          enabled: dropEnabled,
          disabledReason: dropDisabledReason,
          busy: dropBusy,
          message: dropMsg,
          error: dropErr,
          onFile: (file) => void onInboxFile(file),
        }}
      >
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
          <span className="bb-dim">{isPokemon ? "POKÉMON TCG TERMINAL" : "COMICS TERMINAL"}</span>
          <span className="bb-dim" style={{ marginLeft: 8 }}>
            ·{" "}
            {isPokemon
              ? meta?.source ?? "VIP inventory"
              : comicsTerminalSourceLabel(source)}
            {meta?.snapshotLabel ? ` · ${meta.snapshotLabel}` : ""}
          </span>
        </div>
        <div className="bb-topbar-stats">
          <span>
            <em>Vault</em> {(meta?.recordCount ?? inventory.length).toLocaleString()}
          </span>
          <span>
            <em>Showing</em> {filtered.length.toLocaleString()}
          </span>
          <span>
            <em>Value</em> {fmtMoney(filteredValue)}
          </span>
          <span>
            <em>Total</em> {fmtMoney(meta?.totalValue)}
          </span>
          <span>
            <em>MUS</em> {dashboardStats.museumCount}
          </span>
        </div>
        <div className="bb-topbar-actions">
          <button
            type="button"
            className="bb-btn bb-btn-ghost"
            onClick={() => setRightPanel("analytics")}
            title="Ask Orchestr8 about the current filter"
          >
            Ask
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
            Workspace: {WORKSPACES.find((w: { id: string }) => w.id === workspace)?.label} ×
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
                {WORKSPACES.map((ws: { id: string; label: string; desc: string }) => (
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
                  {columns.map((col: { id: string; label: string; minWidth?: number; numeric?: boolean }) => (
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
                    <td colSpan={columns.length} className="bb-empty-row">
                      {isPokemon
                        ? "No cards match. Place cards in Binder, then Push to VIP."
                        : "No books match these filters."}
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
                      {columns.map((col: { id: string; numeric?: boolean }) => (
                        <td
                          key={col.id}
                          className={[
                            col.numeric ? "num" : "",
                            col.id === "Title" ? "bb-tcg-name-cell" : "",
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
                          {col.id === "Title" ? (
                            <strong>{String(row.Title && row.Title !== "—" ? row.Title : "—")}</strong>
                          ) : col.id === "Collection Pillar" ? (
                            pillarShort(String(row[col.id] ?? ""))
                          ) : (
                            formatCell(col.id, row[col.id])
                          )}
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
              title="Ask Orchestr8 agents about the current filter"
            >
              Analytics
            </button>
          </div>

          {rightPanel === "analytics" ? (
            <AnalyticsChat
              meta={meta}
              filtered={filtered}
              dashboardStats={dashboardStats}
              filters={filters}
              workspace={workspace}
              selectedComic={selected}
              filteredValue={filteredValue}
              source={source}
            />
          ) : !selected ? (
            <div className="bb-detail-body">
              <p className="bb-dim">Select a row to inspect.</p>
              <p className="bb-detail-hint-lg" style={{ marginTop: 12 }}>
                Or open <strong>Ask</strong> / Analytics to pose questions about the current
                filter — answers can feed Watch / Theses next.
              </p>
            </div>
          ) : (
            <div className="bb-detail-body">
              {selected["Cover Image URL"] ? (
                <div className="bb-cover-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={String(selected["Cover Image URL"])}
                    alt={String(selected.Title || selected.Series || "")}
                    className="bb-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </div>
              ) : (
                <div className="bb-cover-placeholder">No cover image</div>
              )}
              <h3 className="bb-detail-title">
                {isPokemon
                  ? String(
                      selected.Title && selected.Title !== "—"
                        ? selected.Title
                        : "—",
                    )
                  : `${selected.Series} #${selected["Issue Full"] || selected.Issue}`}
              </h3>
              <p className="bb-dim">
                {isPokemon
                  ? [selected.Series, selected["Issue Full"] ? `#${selected["Issue Full"]}` : null, selected["Edition / Variant"]]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  : String(selected["Edition / Variant"] || "—")}
              </p>
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
                  <span className="bb-dim">Verification</span>
                  <div
                    className={
                      needsVerification ? "bb-verify-pending" : "bb-verify-done"
                    }
                  >
                    {needsVerification ? "Needs review" : "Verified"}
                  </div>
                </div>
                <div>
                  <span className="bb-dim">Notes</span>
                  <div>{String(selected["Verification Notes"] || "—")}</div>
                </div>
              </div>
              {saveError ? <p className="bb-detail-error">{saveError}</p> : null}
              {editable ? (
                needsVerification ? (
                  <button
                    type="button"
                    className="bb-btn bb-btn-primary"
                    style={{ marginTop: 12 }}
                    disabled={saving}
                    onClick={() => void saveSelected({ "Needs Verification": "No" })}
                  >
                    {saving ? "Saving…" : "Mark verified"}
                  </button>
                ) : (
                  <div style={{ marginTop: 12 }}>
                    <span className="bb-verify-done">Verified</span>
                    <button
                      type="button"
                      className="bb-btn bb-btn-ghost"
                      style={{ marginLeft: 8 }}
                      disabled={saving}
                      onClick={() => void saveSelected({ "Needs Verification": "Yes" })}
                    >
                      {saving ? "Saving…" : "Undo"}
                    </button>
                  </div>
                )
              ) : (
                <p className="bb-detail-hint-lg" style={{ marginTop: 12 }}>
                  Edits unavailable — Postgres comics inventory did not load. Start VIP API (
                  <code>npm run api</code>) or Launch IQVault.bat.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
      </CollectionSourceBar>
    </div>
  );
}
