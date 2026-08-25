/** Compact collection context for comics_collection_analysis jobs. */

import type { ComicRow, InventoryBundle } from "./inventoryApi";

export type SliceId = "all" | "sellHigh" | "highLiquidity" | "museum" | "lot";

function compactBook(r: ComicRow | null | undefined) {
  if (!r) return null;
  return {
    series: r.Series,
    issue: r["Issue Full"],
    variant: r["Edition / Variant"] || undefined,
    pillar: r["Collection Pillar"] || undefined,
    value: r["Current Price"] ?? undefined,
    mus: r["Museum Score"] ?? undefined,
    inv: r["Investment Score"] ?? undefined,
    liq: r["Liquidity Score"] ?? undefined,
    rec: r.Recommendation || undefined,
    sellPriority: r["Sell Priority"] || undefined,
    grade: r["Assumed Grade"] || undefined,
    needsGrading: r["Needs Grading"] === "Yes" || r["Needs Grading"] === true ? true : undefined,
    duplicate: r.Duplicate === "Yes" ? true : undefined,
  };
}

function avg(rows: ComicRow[], key: "Museum Score" | "Investment Score" | "Liquidity Score") {
  const nums = rows.map((r) => r[key]).filter((n): n is number => typeof n === "number");
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function countBy(rows: ComicRow[], key: "Collection Pillar" | "Recommendation") {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[key] ?? "Unknown");
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export function applySlice(rows: ComicRow[], slice: SliceId): ComicRow[] {
  switch (slice) {
    case "sellHigh":
      return rows.filter((r) => r["Sell Priority"] === "High");
    case "highLiquidity":
      return rows.filter((r) => (r["Liquidity Score"] ?? 0) >= 60);
    case "museum":
      return rows.filter((r) => r.Recommendation === "Museum Candidate");
    case "lot":
      return rows.filter(
        (r) =>
          String(r.Recommendation || "").toLowerCase().includes("lot") ||
          String(r.Recommendation || "").toLowerCase().includes("sell")
      );
    default:
      return rows;
  }
}

export function buildAnalysisContext(bundle: InventoryBundle, slice: SliceId) {
  const filtered = applySlice(bundle.rows, slice);
  const sorted = [...filtered].sort(
    (a, b) => (b["Current Price"] ?? 0) - (a["Current Price"] ?? 0)
  );
  const sellHigh = filtered.filter((r) => r["Sell Priority"] === "High");
  const museum = filtered.filter((r) => r.Recommendation === "Museum Candidate");
  const highLiq = filtered.filter((r) => (r["Liquidity Score"] ?? 0) >= 60);
  const matchingValue = filtered.reduce((s, r) => s + (r["Current Price"] ?? 0), 0);

  return {
    snapshot: bundle.meta.snapshotLabel,
    inventorySource: bundle.source,
    inventoryProvenance: bundle.provenance,
    disclaimer:
      "Dollar amounts are catalog/snapshot estimates unless stated. Not live comps. No fake precision — prefer ranges + confidence.",
    fullVault: {
      snapshotRowCount: bundle.meta.recordCount,
      snapshotTotal: bundle.meta.snapshotTotal,
      note: bundle.meta.note,
    },
    activeFilter: {
      description: `slice=${slice}`,
      matchingRecords: filtered.length,
      matchingValue: Math.round(matchingValue * 100) / 100,
    },
    aggregates: {
      avgMuseum: avg(filtered, "Museum Score"),
      avgInvestment: avg(filtered, "Investment Score"),
      avgLiquidity: avg(filtered, "Liquidity Score"),
      byPillar: countBy(filtered, "Collection Pillar"),
      byRecommendation: countBy(filtered, "Recommendation"),
      sellHighCount: sellHigh.length,
      museumCount: museum.length,
      highLiquidityCount: highLiq.length,
    },
    highlights: {
      topByValue: sorted.slice(0, 25).map(compactBook),
      highSellPrioritySample: sellHigh.slice(0, 20).map(compactBook),
      liquidityMovers: highLiq.slice(0, 20).map(compactBook),
      museumCandidates: museum.slice(0, 15).map(compactBook),
    },
    collectionPhilosophy: {
      goals: [
        "Museum = long-term keepers aligned with pillars",
        "Sell/Lot = exit when liquidity is high and timing favors moving inventory",
        "Grade = raw keys/variants worth slab investment",
        "Liquidation asks must cite evidence count/recency/confidence — never a single point as fact",
      ],
    },
  };
}

export function contextToJson(ctx: unknown) {
  return JSON.stringify(ctx, null, 2);
}

export const ANALYSIS_PROMPTS = [
  "If I need to liquidate for cash, which 10 books should I sell or lot first from this slice — prioritize liquidity?",
  "Summarize this slice: value, risk, and top 3 actions (Sell / Hold / Grade / Lot).",
  "Which high-value books look illiquid — hold vs force-sell?",
  "Build a staged sell queue: week 1 / month 1 / park — with confidence and what evidence is missing.",
  "What's worth grading before selling vs selling raw?",
];
