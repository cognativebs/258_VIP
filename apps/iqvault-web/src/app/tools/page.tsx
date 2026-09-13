import Link from "next/link";
import { Nav } from "@/components/Nav";
import { loadCatalog } from "@/lib/toolsApi";

const COPY: Record<string, string> = {
  "flip-score": "Stripped IQVault scoring. Ask + solds + pop + grading cost → Buy now / Hold / Pass + target resale range.",
  grading: "Should I grade this? PSA / CGC / BGS lanes, break-even at 7–10, pop red flags.",
  "comp-check": "90 seconds at a table. Source order + the three traps (regrade, doctor, reprint).",
  store: "LGS inventory with reorder triggers, category floors, dead-stock days, sealed vs secondary.",
  course: "Flagship syllabus. Film after the $12–$37 tools have receipts. Toolkit is the bonus.",
};

export default async function ToolsPage() {
  let error: string | null = null;
  let catalog: Awaited<ReturnType<typeof loadCatalog>> | null = null;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    error = e instanceof Error ? e.message : "VIP API is down — start npm run api";
  }

  return (
    <div className="shell">
      <Nav active="/tools" />
      <h1 className="page-title">Dealer kit</h1>
      <p className="page-sub">
        Sellable tools on the same Temper brain. PriceCharting is a valuation adapter
        {catalog ? ` · ${catalog.pricecharting.configured ? "token set" : "idle without PRICECHARTING_API_TOKEN"}` : ""}.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div className="tool-grid">
        {(catalog?.products ?? []).map((p) => (
          <Link key={p.id} href={p.href} className="panel tool-card">
            <div className="tool-price">${p.priceUsd}</div>
            <h3>{p.title}</h3>
            <p className="muted">{COPY[p.id]}</p>
            {p.note ? <p className="badge badge-warn">{p.note}</p> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
