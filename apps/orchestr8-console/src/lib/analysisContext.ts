/** Compact collection context for comics_collection_analysis jobs. */

import type { ComicRow, InventoryBundle } from "./inventoryApi";
import type { HighlightMarket, LiquidationGate, MarketEvidenceBundle } from "../types/analysis";
import {
  ANALYSIS_COMPS_CAP,
  CATALOG_SNAPSHOT_NOTE,
  MIN_SALES_FOR_MARKET_EVIDENCE,
} from "../types/analysis";
import { insufficientMarket } from "./marketEvidence";

export type SliceId = "all" | "sellHigh" | "highLiquidity" | "museum" | "lot";

export { ANALYSIS_COMPS_CAP, MIN_SALES_FOR_MARKET_EVIDENCE };

function marketFor(
  row: ComicRow,
  market: MarketEvidenceBundle | null | undefined
): HighlightMarket {
  const hit = market?.byHoldingId[row.id];
  if (hit) {
    return {
      ...hit,
      catalogSnapshot: {
        amount: row["Current Price"] ?? hit.catalogSnapshot.amount,
        note: CATALOG_SNAPSHOT_NOTE,
      },
    };
  }
  return insufficientMarket(
    row.id,
    row["Current Price"] ?? null,
    market?.fetchError ?? "comps not attached for this highlight"
  );
}

function compactBook(r: ComicRow | null | undefined, market?: MarketEvidenceBundle | null) {
  if (!r) return null;
  return {
    holdingId: r.id,
    series: r.Series,
    issue: r["Issue Full"],
    variant: r["Edition / Variant"] || undefined,
    pillar: r["Collection Pillar"] || undefined,
    inventoryBucket: r["Inventory Bucket"] || undefined,
    liveRange: r["Live Range"] || undefined,
    catalogSnapshot: {
      amount: r["Current Price"] ?? null,
      note: CATALOG_SNAPSHOT_NOTE,
    },
    /** @deprecated catalog snapshot point — use catalogSnapshot + market.range */
    value: r["Current Price"] ?? undefined,
    mus: r["Museum Score"] ?? undefined,
    inv: r["Investment Score"] ?? undefined,
    liq: r["Liquidity Score"] ?? undefined,
    rec: r.Recommendation || undefined,
    sellPriority: r["Sell Priority"] || undefined,
    grade: r["Assumed Grade"] || undefined,
    needsGrading: r["Needs Grading"] === "Yes" || r["Needs Grading"] === true ? true : undefined,
    duplicate: r.Duplicate === "Yes" ? true : undefined,
    market: marketFor(r, market),
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

/** Unique slice rows to price, highest catalog snapshot first, capped for adapter fan-out. */
export function highlightRowsForComps(rows: ComicRow[], cap = ANALYSIS_COMPS_CAP): ComicRow[] {
  const sorted = [...rows].sort((a, b) => (b["Current Price"] ?? 0) - (a["Current Price"] ?? 0));
  const extras = [
    ...rows.filter((r) => r["Sell Priority"] === "High"),
    ...rows.filter((r) => (r["Liquidity Score"] ?? 0) >= 60),
    ...rows.filter((r) => r.Recommendation === "Museum Candidate"),
  ];
  const out: ComicRow[] = [];
  const seen = new Set<string>();
  for (const r of [...sorted, ...extras]) {
    if (!r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
    if (out.length >= cap) break;
  }
  return out;
}

export function highlightIdsForComps(bundle: InventoryBundle, slice: SliceId): string[] {
  return highlightRowsForComps(applySlice(bundle.rows, slice)).map((r) => r.id);
}

/** Challenge condition: Sell/Lot/Buy only when adapters re-ran and matchedSales >= 3. */
export function liquidationGateFromMarket(
  market?: MarketEvidenceBundle | null
): LiquidationGate {
  const min = market?.minSalesRequired ?? MIN_SALES_FOR_MARKET_EVIDENCE;
  const eligibleHoldingIds: string[] = [];
  const blocked: { holdingId: string; reason: string }[] = [];
  for (const id of market?.attemptedIds ?? []) {
    const row = market?.byHoldingId[id];
    if (row && !row.insufficientMarketEvidence && row.matchedSales >= min) {
      eligibleHoldingIds.push(id);
    } else {
      const reason = !market
        ? "market adapters not re-run"
        : !row
          ? "no market row after adapter run"
          : row.matchedSales < min
            ? `matchedSales ${row.matchedSales} < minSalesRequired ${min}`
            : row.provenance.notes || "insufficient market evidence";
      blocked.push({ holdingId: id, reason });
    }
  }
  return {
    action: eligibleHoldingIds.length ? "conditional" : "blocked",
    minSalesRequired: min,
    eligibleHoldingIds,
    blocked,
    rule:
      "Sell/Lot/Buy ONLY for eligibleHoldingIds after a live adapter re-run. " +
      "If eligibleHoldingIds is empty, Challenge must reject liquidation (Hold/Pass). " +
      "Do not invent comps to fill the gate.",
    ebayAuth: market?.ebayAuth ?? { configured: false, mode: "unknown" },
    adaptersReRanAt: market?.fetchedAt ?? null,
  };
}

export function buildAnalysisContext(
  bundle: InventoryBundle,
  slice: SliceId,
  market?: MarketEvidenceBundle | null,
  signals?: {
    active?: Array<{ id: string; title?: string; body: string; sourceId?: string }>;
    quarantinedCount?: number;
    feedKind?: string;
    provenance?: { notes?: string; verificationStatus?: string };
  } | null,
) {
  const filtered = applySlice(bundle.rows, slice);
  const sellHigh = filtered.filter((r) => r["Sell Priority"] === "High");
  const museum = filtered.filter((r) => r.Recommendation === "Museum Candidate");
  const highLiq = filtered.filter((r) => (r["Liquidity Score"] ?? 0) >= 60);
  const matchingValue = filtered.reduce((s, r) => s + (r["Current Price"] ?? 0), 0);
  const decisionRows = highlightRowsForComps(filtered);

  return {
    snapshot: bundle.meta.snapshotLabel,
    inventorySource: bundle.source,
    inventoryProvenance: bundle.provenance,
    disclaimer:
      "catalogSnapshot / value / matchingValue are CLZ/VIP list points · unverified — never live comps. " +
      "Per-highlight `market` is adapter comps (range + matchedSales + recencyDays + confidence + provenance). " +
      `Sell/Lot requires market.matchedSales >= ${MIN_SALES_FOR_MARKET_EVIDENCE} and insufficientMarketEvidence=false. ` +
      "Idle adapters (missing tokens) are insufficient evidence — do not invent sales. " +
      "Do not veto solely because catalog snapshots are not live comps when `market` is present — use `market`. " +
      "Do not approve Sell/Lot when market.insufficientMarketEvidence is true. " +
      "Liquidation is gated by liquidationGate — Sell/Lot/Buy only for eligibleHoldingIds " +
      `(matchedSales >= ${MIN_SALES_FOR_MARKET_EVIDENCE} after a live adapter re-run). ` +
      "Empty eligibleHoldingIds → reject liquidation (the Challenge veto is correct).",
    fullVault: {
      snapshotRowCount: bundle.meta.recordCount,
      snapshotTotal: bundle.meta.snapshotTotal,
      note: bundle.meta.note,
    },
    activeFilter: {
      description: `slice=${slice}`,
      matchingRecords: filtered.length,
      matchingValue: Math.round(matchingValue * 100) / 100,
      matchingValueNote: CATALOG_SNAPSHOT_NOTE,
    },
    marketEvidence: {
      attemptedHoldingCount: market?.attemptedIds.length ?? 0,
      holdingsWithSales: market?.holdingsWithSales ?? 0,
      holdingsInsufficient: market?.holdingsInsufficient ?? decisionRows.length,
      missingHoldingIds: market?.missingHoldingIds ?? [],
      adapterIdleNotes: market?.adapterIdleNotes ?? [],
      minSalesRequired: MIN_SALES_FOR_MARKET_EVIDENCE,
      compsCap: ANALYSIS_COMPS_CAP,
      fetchedAt: market?.fetchedAt ?? null,
      fetchError: market?.fetchError ?? "comps not fetched yet",
      provenance: market?.provenance ?? {
        source: "comps_adapters",
        method: "inferred",
        ruleOrModelVersion: "analysis-market-evidence@1.0.0",
        confidence: 0,
        verificationStatus: "unverified",
        notes: "comps not fetched yet",
      },
      note:
        `Live adapter comps attempted for up to ${ANALYSIS_COMPS_CAP} highlight holdings. ` +
        "Empty adapters = insufficient evidence, never fabricated. Aggregates below cover the full slice.",
      ebayAuth: market?.ebayAuth ?? { configured: false, mode: "unknown" },
    },
    liquidationGate: liquidationGateFromMarket(market),
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
      topByValue: decisionRows.map((r) => compactBook(r, market)),
      highSellPrioritySample: sellHigh.slice(0, ANALYSIS_COMPS_CAP).map((r) => compactBook(r, market)),
      liquidityMovers: highLiq.slice(0, ANALYSIS_COMPS_CAP).map((r) => compactBook(r, market)),
      museumCandidates: museum.slice(0, ANALYSIS_COMPS_CAP).map((r) => compactBook(r, market)),
      unusedSliceRows: Math.max(0, filtered.length - decisionRows.length),
    },
    collectionPhilosophy: {
      goals: [
        "Museum = long-term keepers aligned with pillars",
        "Sell/Lot = exit when liquidity is high, timing favors moving inventory, AND market evidence meets minSalesRequired",
        "Grade = raw keys/variants worth slab investment",
        "Liquidation asks must cite market.range + matchedSales + recencyDays + confidence — never catalogSnapshot as fact",
        "Personal Collection is not for routine sale. Investment Vault sells only when intelligence justifies it. Dealer Inventory is churn capital.",
      ],
    },
    signals: signals
      ? {
          active: (signals.active ?? []).slice(0, 25),
          quarantinedCount: signals.quarantinedCount ?? 0,
          feedKind: signals.feedKind ?? "empty",
          provenance: {
            verificationStatus: "unverified",
            notes:
              signals.provenance?.notes ??
              "News is inferred · unverified RSS; not a market fact; do not invent comps from headlines.",
          },
        }
      : undefined,
  };
}

export function contextToJson(ctx: unknown) {
  return JSON.stringify(ctx, null, 2);
}

export const ANALYSIS_PROMPTS = [
  "If I need to liquidate for cash, which books from the priced highlights should I sell or lot first — only where market evidence meets minSalesRequired; otherwise Hold/Pass and name the gap.",
  "Summarize this slice: catalog snapshot vs live comps, risk, and top 3 actions (Sell / Hold / Grade / Lot) with confidence.",
  "Which high-value books look illiquid — hold vs force-sell? Cite matchedSales and recencyDays.",
  "Build a staged sell queue: week 1 / month 1 / park — with confidence and what evidence is missing.",
  "What's worth grading before selling vs selling raw? Do not treat catalogSnapshot as a live ask.",
];
