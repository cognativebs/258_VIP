"use client";

import { useState } from "react";
import { lookupPriceCharting } from "@/lib/toolsApi";

type Product = {
  id: string;
  productName: string;
  consoleName: string;
  prices: Record<string, number | null>;
  provenance: { notes?: string };
};

export function PriceChartingLookup({
  defaultCategory = "tcg",
  onPick,
}: {
  defaultCategory?: string;
  onPick?: (product: Product) => void;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  const [err, setErr] = useState<string | null>(null);
  const [idle, setIdle] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setIdle(null);
    try {
      const res = await lookupPriceCharting(q, category);
      if (res.idle) {
        setIdle(res.emptyReason ?? "PriceCharting idle — set PRICECHARTING_API_TOKEN.");
        setProducts([]);
        return;
      }
      setProducts(res.products ?? []);
      if (!res.products?.length) setIdle(res.emptyReason ?? "No matches.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <article className="panel">
      <h3>PriceCharting lookup</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Valuation only. Guide values are not sold comps. Sports uses the SportsCardsPro host.
      </p>
      <form className="tool-form" onSubmit={(e) => void search(e)}>
        <label>
          Query
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="charizard base set 4" required />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="tcg">TCG / games</option>
            <option value="comics">Comics</option>
            <option value="sports">Sports</option>
            <option value="sealed">Sealed</option>
          </select>
        </label>
        <button type="submit" className="tool-btn">
          Search
        </button>
      </form>
      {idle ? <p className="badge badge-warn">{idle}</p> : null}
      {err ? <div className="error">{err}</div> : null}
      {products.map((p) => (
        <div key={`${p.consoleName}-${p.id}`} className="pc-hit">
          <strong>
            {p.productName} · {p.consoleName}
          </strong>
          <span className="muted"> id {p.id}</span>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            raw {fmt(p.prices.ungraded)} · 7 {fmt(p.prices.grade7)} · 8 {fmt(p.prices.grade8)} · 9{" "}
            {fmt(p.prices.grade9)} · 9.5 {fmt(p.prices.grade95)} · PSA 10 {fmt(p.prices.psa10)}
          </div>
          {p.provenance.notes ? <p className="muted" style={{ fontSize: 12 }}>{p.provenance.notes}</p> : null}
          {onPick ? (
            <button type="button" className="tool-btn ghost" onClick={() => onPick(p)}>
              Use ungraded as a guide (not a sold)
            </button>
          ) : null}
        </div>
      ))}
    </article>
  );
}

function fmt(n: number | null | undefined) {
  return n == null ? "—" : `$${n}`;
}
