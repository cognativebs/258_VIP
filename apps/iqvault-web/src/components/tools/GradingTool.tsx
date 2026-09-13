"use client";

import { useEffect, useState } from "react";
import { loadFees, scoreGrading, TOOL_EXPORT } from "@/lib/toolsApi";

type Tier = {
  id: string;
  grader: string;
  category: string;
  name: string;
  lane: string;
  feeUsd: number;
  status: string;
  turnaroundBusinessDays: number;
};

type Row = {
  grade: string;
  minSaleToBreakEven: number;
  marketValue: number | null;
  expectedNet: number | null;
  roiPct: number | null;
  coversCosts: boolean | null;
};

export function GradingTool() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    tier: Tier;
    allInBeforeSale: number;
    rows: Row[];
    recommendation: string;
    popRedFlags: string[];
    expectedIncrementalProfit: number | null;
  } | null>(null);

  useEffect(() => {
    void loadFees()
      .then((d) => setTiers(d.tiers as Tier[]))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const f = new FormData(e.currentTarget);
    const grades = ["7", "8", "9", "9.5", "10"].map((grade) => {
      const v = Number(f.get(`v${grade}`));
      return {
        grade,
        marketValue: Number.isFinite(v) && v > 0 ? v : null,
        probability: Number(f.get(`p${grade}`) || 0) || null,
      };
    });
    try {
      const r = await scoreGrading({
        rawCost: Number(f.get("rawCost")),
        grader: String(f.get("grader")),
        category: String(f.get("category")),
        tierId: String(f.get("tierId")),
        shippingCost: Number(f.get("shippingCost") || 0),
        insuranceCost: Number(f.get("insuranceCost") || 0),
        sellingFeePct: Number(f.get("sellingFeePct") || 0.13),
        gradeValues: grades,
      });
      setResult(r as typeof result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="stack">
      <article className="panel">
        <h3>Should I grade this?</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          $19 spreadsheet logic. Min sale to break even at 7 / 8 / 9 / 9.5 / 10, plus expected ROI when you have values.
        </p>
        <form className="tool-form" onSubmit={(e) => void onSubmit(e)}>
          <label>
            Raw cost
            <input name="rawCost" type="number" min={0} step="0.01" required defaultValue={80} />
          </label>
          <label>
            Grader
            <select name="grader" defaultValue="PSA">
              <option>PSA</option>
              <option>CGC</option>
              <option>BGS</option>
            </select>
          </label>
          <label>
            Category
            <select name="category" defaultValue="cards">
              <option value="cards">Cards</option>
              <option value="comics">Comics</option>
            </select>
          </label>
          <label>
            Service tier
            <select name="tierId" defaultValue="psa-cards-standard">
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.grader} {t.category} · {t.name} ${t.feeUsd} ({t.lane}
                  {t.status === "paused" ? ", PAUSED" : ""})
                </option>
              ))}
            </select>
          </label>
          <label>
            Shipping
            <input name="shippingCost" type="number" min={0} step="0.01" defaultValue={15} />
          </label>
          <label>
            Insurance
            <input name="insuranceCost" type="number" min={0} step="0.01" defaultValue={0} />
          </label>
          <label>
            Selling fee %
            <input name="sellingFeePct" type="number" min={0} max={0.5} step="0.01" defaultValue={0.13} />
          </label>
          {["7", "8", "9", "9.5", "10"].map((g) => (
            <label key={g}>
              Market @ {g}
              <input name={`v${g}`} type="number" min={0} step="0.01" placeholder="optional" />
            </label>
          ))}
          <button type="submit" className="tool-btn">
            Calculate break-even
          </button>
        </form>
        {err ? <div className="error">{err}</div> : null}
        {result ? (
          <div style={{ marginTop: 16 }}>
            <p>
              <span className="badge badge-info">{result.recommendation.replaceAll("_", " ")}</span>
              <span className="badge">
                {result.tier.name} · ${result.tier.feeUsd} · {result.tier.turnaroundBusinessDays} bd
              </span>
              All-in before sale <strong>${result.allInBeforeSale}</strong>
              {result.expectedIncrementalProfit != null
                ? ` · EV Δ $${result.expectedIncrementalProfit}`
                : " · add 9 + 10 values for EV"}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th>Min sale</th>
                    <th>Market</th>
                    <th>Net</th>
                    <th>ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.grade}>
                      <td>{row.grade}</td>
                      <td>${row.minSaleToBreakEven}</td>
                      <td>{row.marketValue == null ? "—" : `$${row.marketValue}`}</td>
                      <td>{row.expectedNet == null ? "—" : `$${row.expectedNet}`}</td>
                      <td>
                        {row.roiPct == null ? "—" : `${Math.round(row.roiPct * 100)}%`}
                        {row.coversCosts === false ? " · no" : row.coversCosts ? " · yes" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.popRedFlags.length ? (
              <ul className="muted" style={{ fontSize: 13 }}>
                {result.popRedFlags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </article>
      <article className="panel">
        <h3>Spreadsheet</h3>
        <p className="muted">Google Sheets / Excel — XML Spreadsheet 2003 with Fees + Pop red flags + lane presets.</p>
        <a className="tool-btn" href={TOOL_EXPORT.gradingXls}>
          Download grading-calculator.xls
        </a>
      </article>
    </div>
  );
}
