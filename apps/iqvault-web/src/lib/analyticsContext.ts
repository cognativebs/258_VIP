/** Build compact LLM context from the active filtered collection slice. */

import {
  WORKSPACES,
  countActiveFilters,
  isHighLiquidity,
  isPillarReview,
  isLotCandidate,
} from "./comicEngine";
import type { ComicFilters, ComicRow, ComicsMeta } from "./comicTypes";

type DashboardStats = {
  avgMuseum: number;
  avgInvestment: number;
  avgLiquidity: number;
  byPillar: { name: string; count: number; value: number; pct: number }[];
  byRecommendation: { name: string; count: number; pct: number }[];
  museumCount: number;
  pillarReviewCount: number;
  sellHighCount: number;
  lotCount: number;
  moveNowCount: number;
  moveNowValue: number;
};

function compactBook(r: ComicRow | null | undefined) {
  if (!r) return null;
  return {
    series: r.Series,
    issue: r["Issue Full"],
    variant: r["Edition / Variant"] || undefined,
    pillar: r["Collection Pillar"],
    value: r["Current Price"],
    mus: r["Museum Score"],
    inv: r["Investment Score"],
    liq: r["Liquidity Score"],
    rec: r.Recommendation,
    sellPriority: r["Sell Priority"],
    key: r["Is Key Comic"] !== "No" ? r["Is Key Comic"] : undefined,
    keyReason: r["Key Comic Reason"] || undefined,
    location: r.Location || undefined,
    slab: r["Slab Status"],
    grade: r["Assumed Grade"] || r["Grade Rating"] || undefined,
    duplicate: r.Duplicate === "Yes" ? true : undefined,
    needsGrading: r["Needs Grading"] === "Yes" ? true : undefined,
  };
}

function describeFilters(filters: ComicFilters, workspace: string): string {
  const ws = (WORKSPACES as { id: string; label: string }[]).find((w) => w.id === workspace);
  const parts: string[] = [];
  if (workspace && workspace !== "all") parts.push(`workspace=${ws?.label ?? workspace}`);
  if (filters.query?.trim()) parts.push(`search="${filters.query.trim()}"`);
  if (filters.pillar) parts.push(`pillar=${filters.pillar}`);
  if (filters.location === "__unassigned__") parts.push("location=unassigned");
  else if (filters.location) parts.push(`location=${filters.location}`);
  if (filters.publisher) parts.push(`publisher=${filters.publisher}`);
  if (filters.slabStatus) parts.push(`slab=${filters.slabStatus}`);
  if (filters.sellPriority) parts.push(`sellPriority=${filters.sellPriority}`);
  if (filters.keyOnly) parts.push("keyIssuesOnly");
  if (filters.duplicateOnly) parts.push("duplicatesOnly");
  if (filters.needsGrading) parts.push("needsGrading");
  if (filters.upgradeOnly) parts.push("upgradeCandidates");
  if (filters.recommendations?.length) {
    parts.push(`recommendations=[${filters.recommendations.join(", ")}]`);
  }
  if (filters.minPrice !== "" && filters.minPrice != null) parts.push(`minPrice=${filters.minPrice}`);
  if (filters.maxPrice !== "" && filters.maxPrice != null) parts.push(`maxPrice=${filters.maxPrice}`);
  if (filters.minMuseum > 0) parts.push(`minMuseum=${filters.minMuseum}`);
  if (filters.minInvestment > 0) parts.push(`minInvestment=${filters.minInvestment}`);
  if (filters.minLiquidity > 0) parts.push(`minLiquidity=${filters.minLiquidity}`);
  return parts.length ? parts.join("; ") : "none (full slice via workspace only)";
}

export function buildAnalyticsContext(args: {
  meta: ComicsMeta | null;
  filtered: ComicRow[];
  dashboardStats: DashboardStats;
  filters: ComicFilters;
  workspace: string;
  selectedComic: ComicRow | null;
  filteredValue: number;
  /** Where the rows came from, so the model never treats fallback data as verified truth. */
  source: "comics-api" | "vip-api" | null;
}) {
  const { meta, filtered, dashboardStats, filters, workspace, selectedComic, filteredValue, source } =
    args;

  const sorted = [...filtered].sort(
    (a, b) => (Number(b["Current Price"]) || 0) - (Number(a["Current Price"]) || 0),
  );

  const pillarReview = filtered.filter((r) => isPillarReview(r));
  const liquidityMove = filtered.filter((r) => isHighLiquidity(r, 60));
  const lotCandidates = filtered.filter((r) => isLotCandidate(r));
  const museum = filtered.filter((r) => r.Recommendation === "Museum Candidate");
  const sellHigh = filtered.filter((r) => r["Sell Priority"] === "High");

  return {
    dataSource:
      source === "comics-api"
        ? "Comics Postgres API (live holdings, editable)"
        : "VIP API → same Postgres collection (read-only)",
    fullVault: {
      records: meta?.recordCount,
      totalValue: meta?.totalValue,
    },
    activeFilter: {
      description: describeFilters(filters, workspace),
      workspace:
        (WORKSPACES as { id: string; label: string }[]).find((w) => w.id === workspace)?.label ??
        "ALL",
      activeFilterCount: countActiveFilters(filters),
      matchingRecords: filtered.length,
      matchingValue: Math.round(filteredValue * 100) / 100,
    },
    aggregates: {
      avgMuseum: dashboardStats.avgMuseum,
      avgInvestment: dashboardStats.avgInvestment,
      avgLiquidity: dashboardStats.avgLiquidity,
      byPillar: dashboardStats.byPillar,
      byRecommendation: dashboardStats.byRecommendation,
      museumCount: dashboardStats.museumCount,
      pillarReviewCount: dashboardStats.pillarReviewCount,
      sellHighCount: dashboardStats.sellHighCount,
      lotCount: dashboardStats.lotCount,
      moveNowCount: dashboardStats.moveNowCount,
      moveNowValue: dashboardStats.moveNowValue,
    },
    highlights: {
      topByValue: sorted.slice(0, 25).map(compactBook),
      liquidityMovers: liquidityMove.slice(0, 20).map(compactBook),
      museumCandidates: museum.slice(0, 15).map(compactBook),
      pillarReviewSample: pillarReview.slice(0, 15).map(compactBook),
      lotCandidatesSample: lotCandidates.slice(0, 15).map(compactBook),
      highSellPrioritySample: sellHigh.slice(0, 15).map(compactBook),
    },
    selectedIssue: compactBook(selectedComic),
    decisionRules: {
      actions: ["Buy", "Hold", "Grade", "Sell", "Lot", "Pass"],
      requirements: [
        "Every recommendation ends in an action with confidence + reasons",
        "Valuations are ranges with evidence count and recency — never a point value as fact",
        "Inferred grades stay labeled unverified (e.g. 'NM assumed · unverified')",
      ],
      goals: [
        "Museum = long-term keepers aligned with pillars",
        "Sell/Lot = exit when liquidity is high and timing favors moving inventory",
        "Pillar review = General Inventory books that need reassignment",
        "Grade = raw keys/variants worth slab investment",
      ],
    },
  };
}

export function contextToJson(ctx: unknown): string {
  return JSON.stringify(ctx, null, 2);
}

export const COMICS_PROMPTS = [
  "What should I sell or lot first from this filter — focus on high liquidity?",
  "Which books look mis-assigned to General Inventory?",
  "Summarize this slice: value, risk, and top 3 actions.",
  "What's worth sending to CGC from what's filtered?",
  "Compare museum keepers vs sell candidates in this set.",
  "If I need $500 fast, which 5 books should I move?",
];

export const TCG_PROMPTS = [
  "What should I sell or hold from this TCG slice — liquidity first?",
  "Which owned cards look like grade candidates vs keep raw?",
  "Summarize this binder slice: value range, gaps, and top 3 actions.",
  "If I need cash this week, which 5 cards should I move?",
  "Compare owned vs still-needed pockets in this filter.",
];

export const SPORTS_PROMPTS = [
  "Any rookies or autos in this slice worth grading?",
  "Summarize this sports-card slice: value, risk, and top 3 actions.",
  "What should I sell first if liquidity is the goal?",
];

/** @deprecated prefer suggestedPrompts(vertical) — comics wording only. */
export const SUGGESTED_PROMPTS = COMICS_PROMPTS;

/** Ask prompts worded for the vertical on screen: books vs cards vs pockets. */
export function suggestedPrompts(vertical: string): string[] {
  if (vertical === "pokemon" || vertical === "mtg") return TCG_PROMPTS;
  if (["football", "soccer", "basketball", "baseball"].includes(vertical)) {
    return SPORTS_PROMPTS;
  }
  return COMICS_PROMPTS;
}
