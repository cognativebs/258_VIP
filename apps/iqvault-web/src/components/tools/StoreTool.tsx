"use client";

import { useEffect, useState } from "react";
import { scoreStore, TOOL_EXPORT } from "@/lib/toolsApi";

type Row = {
  sku: string;
  name: string;
  category: string;
  marginPct: number | null;
  vsTarget: string;
  daysOfSupply: number | null;
  reorder: boolean;
  deadStock: string;
  listVsSecondary: string;
  seasonalNote: string;
  nextAction: string;
};

export function StoreTool() {
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState({ reorder: 0, liquidate: 0, below: 0 });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void scoreStore()
      .then((d) => {
        setRows(d.rows as Row[]);
        setCounts({ reorder: d.reorderCount, liquidate: d.liquidateCount, below: d.belowMarginCount });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="stack">
      <div className="grid-stats">
        <div className="stat">
          <div className="n">{counts.reorder}</div>
          <div className="l">Reorder today</div>
        </div>
        <div className="stat">
          <div className="n">{counts.liquidate}</div>
          <div className="l">Liquidate</div>
        </div>
        <div className="stat">
          <div className="n">{counts.below}</div>
          <div className="l">Below margin floor</div>
        </div>
      </div>
      {err ? <div className="error">{err}</div> : null}
      <article className="panel">
        <h3>Sample book</h3>
        <p className="muted">This is the Notion/Airtable base, scored. Dead sealed above secondary is the lesson.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Cat</th>
                <th>Dead</th>
                <th>Secondary</th>
                <th>Next</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td>{r.sku}</td>
                  <td>
                    {r.name}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {r.seasonalNote}
                    </div>
                  </td>
                  <td>{r.category}</td>
                  <td>
                    <span className={`badge ${r.deadStock === "liquidate" ? "badge-danger" : r.deadStock === "watch" ? "badge-warn" : "badge-ok"}`}>
                      {r.deadStock}
                    </span>
                    {r.reorder ? <span className="badge badge-info">reorder</span> : null}
                  </td>
                  <td>{r.listVsSecondary}</td>
                  <td style={{ fontSize: 13 }}>{r.nextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
      <article className="panel">
        <h3>Deliverables</h3>
        <a className="tool-btn" href={TOOL_EXPORT.storeNotion}>
          Notion base
        </a>{" "}
        <a className="tool-btn" href={TOOL_EXPORT.sealed}>
          Sealed one-pager
        </a>{" "}
        <a className="tool-btn" href={TOOL_EXPORT.walkthrough}>
          15-min Loom script
        </a>{" "}
        <a className="tool-btn ghost" href="/tools/print/sealed">
          Print sealed
        </a>
      </article>
    </div>
  );
}
