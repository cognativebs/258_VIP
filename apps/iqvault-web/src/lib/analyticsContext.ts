import { z } from "zod";
import {
  WORKSPACES,
  countActiveFilters,
  isHighLiquidity,
  isPillarReview,
  isLotCandidate,
} from "./comicEngine";
import type { ComicFilters, ComicRow, ComicsMeta } from "./comicTypes";

const compactBookSchema = z.object({
  series: z.string().optional(),
  issue: z.string().optional(),
  variant: z.string().optional(),
  pillar: z.string().optional(),
  value: z.number().nullable().optional(),
  mus: z.number().nullable().optional(),
  inv: z.number().nullable().optional(),
  liq: z.number().nullable().optional(),
  rec: z.string().nullable().optional(),
  sellPriority: z.string().nullable().optional(),
  key: z.string().optional(),
  keyReason: z.string().optional(),
  location: z.string().optional(),
  slab: z.string().nullable().optional(),
  grade: z.string().optional(),
  duplicate: z.boolean().optional(),
  needsGrading: z.boolean().optional(),
});

export const analyticsContextSchema = z.object({
  vertical: z.string(),
  unit: z.string(),
  snapshot: z.string().optional(),
  fullVault: z.object({
    records: z.number().optional(),
    totalValue: z.number().optional(),
  }),
  activeFilter: z.object({
    description: z.string(),
    workspace: z.string(),
    activeFilterCount: z.number(),
    matchingRecords: z.number(),
    matchingValue: z.number(),
  }),
  aggregates: z.record(z.unknown()),
  highlights: z.object({
    topByValue: z.array(compactBookSchema),
    liquidityMovers: z.array(compactBookSchema),
    museumCandidates: z.array(compactBookSchema),
    pillarReviewSample: z.array(compactBookSchema),
    lotCandidatesSample: z.array(compactBookSchema),
    highSellPrioritySample: z.array(compactBookSchema),
  }),
  selectedIssue: compactBookSchema.nullable(),
  collectionPhilosophy: z.object({
    pillars: z.array(z.string()),
    goals: z.array(z.string()),
  }),
  provenance: z.object({
    source: z.string(),
    method: z.literal("derived_slice"),
    verificationStatus: z.literal("unverified"),
    notes: z.string(),
  }),
});

export type AnalyticsContext = z.infer<typeof analyticsContextSchema>;

export type DashboardStats = {
  avgMuseum: number;
  avgInvestment: number;
  avgLiquidity: number;
  byPillar: unknown;
  byRecommendation: unknown;
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
    key: r["Is Key Comic"] && r["Is Key Comic"] !== "No" ? String(r["Is Key Comic"]) : undefined,
    keyReason: r["Key Comic Reason"] || undefined,
    location: r.Location || undefined,
    slab: r["Slab Status"],
    grade: r["Assumed Grade"] || (r["Grade Rating"] != null ? String(r["Grade Rating"]) : undefined),
    duplicate: r.Duplicate === "Yes" ? true : undefined,
    needsGrading: r["Needs Grading"] === "Yes" ? true : undefined,
  };
}

function describeFilters(filters: ComicFilters, workspace: string) {
  const ws = WORKSPACES.find((w: { id: string }) => w.id === workspace);
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
  if (filters.recommendations?.length) parts.push(`recommendations=[${filters.recommendations.join(", ")}]`);
  if (filters.minPrice !== "" && filters.minPrice != null) parts.push(`minPrice=${filters.minPrice}`);
  if (filters.maxPrice !== "" && filters.maxPrice != null) parts.push(`maxPrice=${filters.maxPrice}`);
  if (filters.minMuseum > 0) parts.push(`minMuseum=${filters.minMuseum}`);
  if (filters.minInvestment > 0) parts.push(`minInvestment=${filters.minInvestment}`);
  if (filters.minLiquidity > 0) parts.push(`minLiquidity=${filters.minLiquidity}`);
  return parts.length ? parts.join("; ") : "none (full vault slice via workspace only)";
}

export function buildAnalyticsContext(input: {
  meta: ComicsMeta | null;
  filtered: ComicRow[];
  dashboardStats: DashboardStats;
  filters: ComicFilters;
  workspace: string;
  selectedComic: ComicRow | null;
  filteredValue: number;
  vertical?: string;
  unit?: string;
}): AnalyticsContext {
  const filtered = input.filtered;
  const sorted = [...filtered].sort(
    (a, b) => (Number(b["Current Price"]) || 0) - (Number(a["Current Price"]) || 0),
  );
  const pillarReview = filtered.filter(isPillarReview);
  const liquidityMove = filtered.filter((r) => isHighLiquidity(r, 60));
  const lotCandidates = filtered.filter(isLotCandidate);
  const museum = filtered.filter((r) => r.Recommendation === "Museum Candidate");
  const sellHigh = filtered.filter((r) => r["Sell Priority"] === "High");

  const ctx: AnalyticsContext = {
    vertical: input.vertical ?? "comic",
    unit: input.unit ?? "books",
    snapshot: input.meta?.snapshotLabel,
    fullVault: {
      records: input.meta?.recordCount,
      totalValue: input.meta?.totalValue,
    },
    activeFilter: {
      description: describeFilters(input.filters, input.workspace),
      workspace: WORKSPACES.find((w: { id: string }) => w.id === input.workspace)?.label ?? input.workspace ?? "ALL",
      activeFilterCount: countActiveFilters(input.filters),
      matchingRecords: filtered.length,
      matchingValue: Math.round(input.filteredValue * 100) / 100,
    },
    aggregates: {
      avgMuseum: input.dashboardStats.avgMuseum,
      avgInvestment: input.dashboardStats.avgInvestment,
      avgLiquidity: input.dashboardStats.avgLiquidity,
      byPillar: input.dashboardStats.byPillar,
      byRecommendation: input.dashboardStats.byRecommendation,
      museumCount: input.dashboardStats.museumCount,
      pillarReviewCount: input.dashboardStats.pillarReviewCount,
      sellHighCount: input.dashboardStats.sellHighCount,
      lotCount: input.dashboardStats.lotCount,
      moveNowCount: input.dashboardStats.moveNowCount,
      moveNowValue: input.dashboardStats.moveNowValue,
    },
    highlights: {
      topByValue: sorted.slice(0, 25).flatMap((r) => {
        const c = compactBook(r);
        return c ? [c] : [];
      }),
      liquidityMovers: liquidityMove.slice(0, 20).flatMap((r) => {
        const c = compactBook(r);
        return c ? [c] : [];
      }),
      museumCandidates: museum.slice(0, 15).flatMap((r) => {
        const c = compactBook(r);
        return c ? [c] : [];
      }),
      pillarReviewSample: pillarReview.slice(0, 15).flatMap((r) => {
        const c = compactBook(r);
        return c ? [c] : [];
      }),
      lotCandidatesSample: lotCandidates.slice(0, 15).flatMap((r) => {
        const c = compactBook(r);
        return c ? [c] : [];
      }),
      highSellPrioritySample: sellHigh.slice(0, 15).flatMap((r) => {
        const c = compactBook(r);
        return c ? [c] : [];
      }),
    },
    selectedIssue: compactBook(input.selectedComic),
    collectionPhilosophy: {
      pillars: [
        "Batman",
        "Absolute Universe",
        "Spider-Man",
        "X-Men",
        "Superman",
        "First Appearances",
        "Cover Art & Favorite Artists",
        "Sci-Fi",
        "Bronze & Silver Age Keys",
        "Investment Portfolio",
        "Personal Favorites",
        "General Inventory (needs review)",
        "TCG Owned (Binder)",
        "TCG Need (Binder)",
      ],
      goals: [
        "Museum = long-term keepers aligned with pillars",
        "Sell/Lot = exit when liquidity is high and timing favors moving inventory",
        "Pillar review = General Inventory books that need reassignment",
        "Grade = raw keys/variants worth slab investment",
        "TCG rows from Binder SQLite are layout-owned — inferred until verified",
      ],
    },
    provenance: {
      source: input.meta?.source ?? "unknown",
      method: "derived_slice",
      verificationStatus: "unverified",
      notes: "Filter slice for Orchestr8 — catalog snapshots are not verified market ranges",
    },
  };

  return analyticsContextSchema.parse(ctx);
}

export function contextToJson(ctx: AnalyticsContext): string {
  return JSON.stringify(ctx, null, 2);
}

export const COMICS_PROMPTS = [
  "What should I sell or lot first from this filter — focus on high liquidity?",
  "Which books look mis-assigned to General Inventory?",
  "Summarize this collection slice: value, risk, and top 3 actions.",
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

export function suggestedPrompts(vertical: string): string[] {
  if (vertical === "pokemon" || vertical === "mtg") return TCG_PROMPTS;
  if (["football", "soccer", "basketball", "baseball"].includes(vertical)) return SPORTS_PROMPTS;
  return COMICS_PROMPTS;
}
