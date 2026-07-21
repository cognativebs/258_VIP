import {
  fmtMoney,
  pillarShort,
  pillarColor,
  comicLabel,
  scoreClass,
  recClass,
} from "../../lib/comicEngine.js";

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`bb-dash-stat ${accent ? "accent" : ""}`}>
      <span className="bb-dash-stat-label">{label}</span>
      <span className="bb-dash-stat-value">{value}</span>
      {sub && <span className="bb-dash-stat-sub">{sub}</span>}
    </div>
  );
}

function BarChart({ items, maxVal, onClickItem, valueKey = "value", labelKey = "name" }) {
  const max = maxVal ?? Math.max(...items.map((i) => i[valueKey]), 1);
  return (
    <div className="bb-bar-chart">
      {items.map((item) => {
        const pct = (item[valueKey] / max) * 100;
        return (
          <button
            key={item[labelKey]}
            type="button"
            className="bb-bar-row"
            onClick={() => onClickItem?.(item)}
            title={`${item[labelKey]}: ${item.count} books · ${fmtMoney(item.value)}`}
          >
            <span className="bb-bar-label">{pillarShort(item[labelKey])}</span>
            <div className="bb-bar-track">
              <div
                className="bb-bar-fill"
                style={{
                  width: `${pct}%`,
                  background: pillarColor(item[labelKey]),
                }}
              />
            </div>
            <span className="bb-bar-meta">{item.count}</span>
            <span className="bb-bar-val">{fmtMoney(item[valueKey])}</span>
          </button>
        );
      })}
    </div>
  );
}

function DonutChart({ segments }) {
  const total = segments.reduce((s, seg) => s + seg.count, 0) || 1;
  let acc = 0;
  const stops = segments.map((seg) => {
    const start = (acc / total) * 100;
    acc += seg.count;
    const end = (acc / total) * 100;
    return `${seg.color} ${start}% ${end}%`;
  });

  return (
    <div className="bb-donut-wrap">
      <div
        className="bb-donut"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
      >
        <div className="bb-donut-hole">
          <span>{total}</span>
          <small>books</small>
        </div>
      </div>
      <div className="bb-donut-legend">
        {segments.map((seg) => (
          <div key={seg.name} className="bb-legend-row">
            <span className="bb-legend-dot" style={{ background: seg.color }} />
            <span className="bb-legend-name">{seg.name.replace("Candidate", "").trim()}</span>
            <span className="bb-legend-count">{seg.count}</span>
            <span className="bb-legend-pct">{seg.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IssueList({ title, items, emptyText, onSelect }) {
  return (
    <div className="bb-dash-list-panel">
      <div className="bb-dash-list-head">{title}</div>
      {items.length === 0 ? (
        <p className="bb-dash-empty">{emptyText}</p>
      ) : (
        <ul className="bb-dash-list">
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" className="bb-dash-list-item" onClick={() => onSelect?.(c)}>
                <span className="bb-dash-list-title">{comicLabel(c)}</span>
                <span className="bb-dash-list-meta">
                  {fmtMoney(c["Current Price"])} · LIQ {c["Liquidity Score"]} · MUS {c["Museum Score"]}
                </span>
                <span className={`bb-dash-rec ${recClass(c.Recommendation)}`}>
                  {c.Recommendation}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const REC_COLORS = {
  "Museum Candidate": "#34d399",
  "Investment Hold / Review": "#ff9900",
  "Inventory Review": "#60a5fa",
  "Sell Duplicate": "#f87171",
  "Sell / Lot Candidate": "#fb923c",
  "Verify then Lot": "#a78bfa",
};

export default function ComicsDashboard({ stats, onBack, onDrillPillar, onDrillRec, onSelectComic }) {
  const donutSegments = stats.byRecommendation.map((r) => ({
    ...r,
    color: REC_COLORS[r.name] ?? "#666",
  }));

  return (
    <div className="bb-dashboard">
      <div className="bb-dash-toolbar">
        <button type="button" className="bb-btn bb-btn-ghost" onClick={onBack}>
          ← Back to grid
        </button>
        <h2 className="bb-dash-title">Filtered collection dashboard</h2>
        <span className="bb-dash-subtitle">
          {stats.count.toLocaleString()} books · {fmtMoney(stats.totalValue)} · snapshot view
        </span>
      </div>

      <div className="bb-dash-stats-row">
        <StatCard label="Filtered books" value={stats.count.toLocaleString()} />
        <StatCard label="Filtered value" value={fmtMoney(stats.totalValue)} accent />
        <StatCard label="Avg liquidity" value={stats.avgLiquidity} sub="move-fast score" />
        <StatCard label="Move now" value={stats.moveNowCount} sub={fmtMoney(stats.moveNowValue)} accent />
        <StatCard label="Museum" value={stats.museumCount} sub={fmtMoney(stats.museumValue)} />
        <StatCard label="Pillar review" value={stats.pillarReviewCount} sub="General inventory" />
        <StatCard label="High sell" value={stats.sellHighCount} />
        <StatCard label="Lot candidates" value={stats.lotCount} />
      </div>

      <div className="bb-dash-grid">
        <div className="bb-dash-card bb-dash-wide">
          <div className="bb-dash-card-head">
            <span>Collection by pillar</span>
            <span className="bb-dash-hint">Click a bar to filter grid</span>
          </div>
          <BarChart
            items={stats.byPillar}
            onClickItem={(item) => onDrillPillar?.(item.name)}
          />
        </div>

        <div className="bb-dash-card">
          <div className="bb-dash-card-head">Recommendation mix</div>
          <DonutChart segments={donutSegments} />
          <div className="bb-rec-quick">
            {stats.byRecommendation.slice(0, 4).map((r) => (
              <button
                key={r.name}
                type="button"
                className="bb-rec-quick-btn"
                onClick={() => onDrillRec?.(r.name)}
              >
                {r.name.split(" ")[0]} ({r.count})
              </button>
            ))}
          </div>
        </div>

        <div className="bb-dash-card bb-dash-wide">
          <div className="bb-dash-card-head">
            <span>⚡ High liquidity — move when timing is right</span>
            <span className="bb-dash-hint">LIQ ≥ 60 · priced · sell/lot/review signals</span>
          </div>
          <IssueList
            title=""
            items={stats.liquidityMovers}
            emptyText="No liquidity movers in this filter set."
            onSelect={onSelectComic}
          />
        </div>

        <div className="bb-dash-card">
          <div className="bb-dash-card-head">🏛 Museum wall (top scores)</div>
          <IssueList
            title=""
            items={stats.topMuseum}
            emptyText="No museum candidates in filter."
            onSelect={onSelectComic}
          />
        </div>

        <div className="bb-dash-card">
          <div className="bb-dash-card-head">⚠ Pillar undetermined</div>
          <p className="bb-dash-blurb">
            {stats.pillarReviewCount} books tagged <strong>General Inventory</strong> ({fmtMoney(stats.pillarReviewValue)}).
            Review and reassign to your 12 collection pillars.
          </p>
          <button
            type="button"
            className="bb-btn bb-btn-primary"
            onClick={() => onDrillPillar?.("General Inventory")}
          >
            Open pillar review in grid
          </button>
        </div>

        <div className="bb-dash-card">
          <div className="bb-dash-card-head">Score averages</div>
          <div className="bb-dash-avg-scores">
            <div className={`bb-avg-score ${scoreClass(stats.avgMuseum)}`}>
              <span>Museum</span>
              <strong>{stats.avgMuseum}</strong>
            </div>
            <div className={`bb-avg-score ${scoreClass(stats.avgInvestment)}`}>
              <span>Investment</span>
              <strong>{stats.avgInvestment}</strong>
            </div>
            <div className={`bb-avg-score ${scoreClass(stats.avgLiquidity)}`}>
              <span>Liquidity</span>
              <strong>{stats.avgLiquidity}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
