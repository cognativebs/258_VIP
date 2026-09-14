"use client";

import { useEffect, useState } from "react";
import { loadFlipExamples, scoreFlip, TOOL_EXPORT } from "@/lib/toolsApi";
import { PriceChartingLookup } from "./PriceChartingLookup";

type Result = {
  assetName: string;
  flipScore: number;
  action: string;
  actionLabel: string;
  confidence: number;
  targetResaleLow: number | null;
  targetResaleHigh: number | null;
  targetResaleMid: number | null;
  maxBuy: number | null;
  buyBasis: number;
  expectedNetProfit: number | null;
  marginPct: number | null;
  matchedComps: number;
  supporting: string[];
  opposing: string[];
  howToRead: string;
  provenance: { notes?: string; ruleOrModelVersion: string };
};

export function FlipScoreTool() {
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [examples, setExamples] = useState<{ example: Record<string, unknown>; result: Result }[]>([]);

  useEffect(() => {
    void loadFlipExamples()
      .then((d) => setExamples(d.examples as { example: Record<string, unknown>; result: Result }[]))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const f = new FormData(e.currentTarget);
    const comps = [1, 2, 3, 4]
      .map((i) => Number(f.get(`comp${i}`)))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((price, i) => ({
        price,
        saleDate: new Date(Date.now() - (i + 1) * 14 * 86400000).toISOString(),
        source: "manual",
      }));
    try {
      const r = (await scoreFlip({
        assetName: String(f.get("assetName")),
        category: String(f.get("category")),
        ageYears: Number(f.get("ageYears")),
        popCount: String(f.get("popCount")) === "" ? null : Number(f.get("popCount")),
        listingPrice: Number(f.get("listingPrice")),
        gradingCost: Number(f.get("gradingCost") || 0),
        shippingCost: Number(f.get("shippingCost") || 0),
        comps,
      })) as Result;
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="stack">
      <article className="panel">
        <h3>Deal sheet</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          $37 tool. Plug the ask + solds. Get Buy now / Hold / Pass and a target resale <em>range</em>.
        </p>
        <form className="tool-form" onSubmit={(e) => void onSubmit(e)}>
          <label>
            Item
            <input name="assetName" required placeholder="Base Set Charizard #4 unlimited raw" />
          </label>
          <label>
            Category
            <select name="category" defaultValue="tcg">
              <option value="tcg">TCG</option>
              <option value="sports">Sports</option>
              <option value="comics">Comics</option>
              <option value="sealed">Sealed</option>
            </select>
          </label>
          <label>
            Age (years)
            <input name="ageYears" type="number" min={0} step="1" required defaultValue={27} />
          </label>
          <label>
            Pop count (blank = unknown)
            <input name="popCount" type="number" min={0} step="1" />
          </label>
          <label>
            Listing price
            <input name="listingPrice" type="number" min={0} step="0.01" required />
          </label>
          <label>
            Grading cost
            <input name="gradingCost" type="number" min={0} step="0.01" defaultValue={0} />
          </label>
          <label>
            Ship / ins
            <input name="shippingCost" type="number" min={0} step="0.01" defaultValue={15} />
          </label>
          <label>
            Sold 1
            <input name="comp1" type="number" min={0} step="0.01" />
          </label>
          <label>
            Sold 2
            <input name="comp2" type="number" min={0} step="0.01" />
          </label>
          <label>
            Sold 3
            <input name="comp3" type="number" min={0} step="0.01" />
          </label>
          <label>
            Sold 4
            <input name="comp4" type="number" min={0} step="0.01" />
          </label>
          <button type="submit" className="tool-btn">
            Score this deal
          </button>
        </form>
        {err ? <div className="error">{err}</div> : null}
        {result ? <FlipResult result={result} /> : null}
      </article>

      <PriceChartingLookup defaultCategory="tcg" />

      <article className="panel">
        <h3>Downloads</h3>
        <p className="muted">
          Notion template + 1-page score guide + the 10 example rows.
        </p>
        <p>
          <a className="tool-btn" href={TOOL_EXPORT.flipNotion}>
            Notion template
          </a>{" "}
          <a className="tool-btn" href={TOOL_EXPORT.flipGuide}>
            How to read (HTML/PDF)
          </a>{" "}
          <a className="tool-btn" href={TOOL_EXPORT.flipExamples}>
            Examples CSV
          </a>{" "}
          <a className="tool-btn ghost" href="/tools/print/flip-guide">
            Print view
          </a>
        </p>
      </article>

      <article className="panel">
        <h3>10 pre-filled decisions</h3>
        <p className="muted">
          Teaching snapshots · unverified. PriceCharting ids are real; sold dollars are not live API prints.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Ask</th>
                <th>Score</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((row) => {
                const ex = row.example as { headline: string; input: { listingPrice: number } };
                const r = row.result;
                return (
                  <tr key={ex.headline}>
                    <td>{ex.headline}</td>
                    <td>${ex.input.listingPrice}</td>
                    <td>{r.flipScore}</td>
                    <td>
                      <span className={`badge ${badgeFor(r.action)}`}>{r.actionLabel}</span>
                    </td>
                    <td>
                      {r.targetResaleLow != null
                        ? `$${r.targetResaleLow}–$${r.targetResaleHigh}`
                        : "insufficient"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

function FlipResult({ result }: { result: Result }) {
  return (
    <div className={`flip-result ${result.action}`}>
      <div className="flip-score">{Math.round(result.flipScore)}</div>
      <div>
        <div className={`badge ${badgeFor(result.action)}`}>{result.actionLabel}</div>
        <span className="badge">{Math.round(result.confidence * 100)}% confidence</span>
        <p style={{ margin: "8px 0 0" }}>
          Target resale{" "}
          {result.targetResaleLow != null
            ? `$${result.targetResaleLow}–$${result.targetResaleHigh}`
            : "insufficient comps"}
          {result.maxBuy != null ? ` · max buy $${result.maxBuy}` : ""}
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          {result.howToRead}
        </p>
        <ul className="muted" style={{ fontSize: 13 }}>
          {result.supporting.slice(0, 3).map((s) => (
            <li key={s}>+ {s}</li>
          ))}
          {result.opposing.slice(0, 3).map((s) => (
            <li key={s}>− {s}</li>
          ))}
        </ul>
        <p className="muted" style={{ fontSize: 12 }}>
          {result.provenance.ruleOrModelVersion}. {result.provenance.notes}
        </p>
      </div>
    </div>
  );
}

function badgeFor(action: string) {
  if (action === "buy_now") return "badge-ok";
  if (action === "pass") return "badge-danger";
  return "badge-warn";
}
