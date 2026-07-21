import {
  DEFAULT_FILTERS,
  RECOMMENDATIONS,
  pillarShort,
} from "../../lib/comicEngine.js";

function FilterSection({ title, children }) {
  return (
    <div className="bb-filter-section">
      <div className="bb-filter-section-title">{title}</div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="bb-toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export default function ComicsFilterPanel({
  filters,
  onChange,
  onReset,
  meta,
  publishers,
  activeFilterCount,
  workspace,
  onWorkspace,
  workspaces,
}) {
  const set = (patch) => onChange({ ...filters, ...patch });

  const toggleRec = (rec) => {
    const cur = filters.recommendations ?? [];
    const next = cur.includes(rec) ? cur.filter((r) => r !== rec) : [...cur, rec];
    set({ recommendations: next });
  };

  return (
    <aside className="bb-filter-panel">
      <div className="bb-panel-head">FILTERS</div>

      <div className="bb-filter-active-bar">
        <span>{activeFilterCount} active</span>
        {activeFilterCount > 0 && (
          <button type="button" className="bb-link-btn" onClick={onReset}>
            Clear all
          </button>
        )}
      </div>

      <FilterSection title="Quick workspaces">
        <div className="bb-ws-grid">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              className={`bb-ws-chip ${workspace === ws.id ? "active" : ""}`}
              onClick={() => onWorkspace(ws.id)}
              title={ws.desc}
            >
              {ws.label}
            </button>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Recommendation">
        <div className="bb-rec-chips">
          {RECOMMENDATIONS.map((rec) => (
            <button
              key={rec}
              type="button"
              className={`bb-rec-chip ${filters.recommendations?.includes(rec) ? "active" : ""}`}
              onClick={() => toggleRec(rec)}
            >
              {rec.replace(" / ", "/").replace("Candidate", "").trim()}
            </button>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Score minimums">
        <label className="bb-range-row">
          <span>Museum ≥ {filters.minMuseum}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minMuseum}
            onChange={(e) => set({ minMuseum: Number(e.target.value) })}
          />
        </label>
        <label className="bb-range-row">
          <span>Investment ≥ {filters.minInvestment}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minInvestment}
            onChange={(e) => set({ minInvestment: Number(e.target.value) })}
          />
        </label>
        <label className="bb-range-row">
          <span>Liquidity ≥ {filters.minLiquidity}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minLiquidity}
            onChange={(e) => set({ minLiquidity: Number(e.target.value) })}
          />
        </label>
      </FilterSection>

      <FilterSection title="Value range">
        <div className="bb-inline-inputs">
          <input
            type="number"
            placeholder="Min $"
            className="bb-input"
            value={filters.minPrice}
            onChange={(e) => set({ minPrice: e.target.value })}
          />
          <span>—</span>
          <input
            type="number"
            placeholder="Max $"
            className="bb-input"
            value={filters.maxPrice}
            onChange={(e) => set({ maxPrice: e.target.value })}
          />
        </div>
      </FilterSection>

      <FilterSection title="Attributes">
        <Toggle label="Key issues only" checked={filters.keyOnly} onChange={(v) => set({ keyOnly: v })} />
        <Toggle label="Duplicates only" checked={filters.duplicateOnly} onChange={(v) => set({ duplicateOnly: v })} />
        <Toggle label="Needs grading" checked={filters.needsGrading} onChange={(v) => set({ needsGrading: v })} />
        <Toggle label="Upgrade candidates" checked={filters.upgradeOnly} onChange={(v) => set({ upgradeOnly: v })} />
      </FilterSection>

      <FilterSection title="Pillar">
        <select
          className="bb-input bb-input-full"
          value={filters.pillar}
          onChange={(e) => set({ pillar: e.target.value })}
        >
          <option value="">All pillars</option>
          {(meta?.pillars ?? []).map((p) => (
            <option key={p.name} value={p.name}>
              {pillarShort(p.name)} ({p.count})
            </option>
          ))}
        </select>
      </FilterSection>

      <FilterSection title="Publisher">
        <select
          className="bb-input bb-input-full"
          value={filters.publisher}
          onChange={(e) => set({ publisher: e.target.value })}
        >
          <option value="">All publishers</option>
          {publishers.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </FilterSection>

      <FilterSection title="Slab / Sell">
        <select
          className="bb-input bb-input-full"
          value={filters.slabStatus}
          onChange={(e) => set({ slabStatus: e.target.value })}
        >
          <option value="">Raw + Slabbed</option>
          <option value="Raw">Raw only</option>
          <option value="Slabbed">Slabbed only</option>
        </select>
        <select
          className="bb-input bb-input-full"
          value={filters.sellPriority}
          onChange={(e) => set({ sellPriority: e.target.value })}
          style={{ marginTop: 8 }}
        >
          <option value="">Any sell priority</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </FilterSection>

      <FilterSection title="Storage">
        <select
          className="bb-input bb-input-full"
          value={filters.location}
          onChange={(e) => set({ location: e.target.value })}
        >
          <option value="">All locations</option>
          <option value="__unassigned__">Unassigned</option>
          {(meta?.topLocations ?? []).slice(1).map((l) => (
            <option key={l.name} value={l.name}>{l.name} ({l.count})</option>
          ))}
        </select>
      </FilterSection>
    </aside>
  );
}

export { DEFAULT_FILTERS };
