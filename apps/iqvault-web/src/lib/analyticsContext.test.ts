import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FILTERS } from "./comicEngine.ts";
import { buildAnalyticsContext, suggestedPrompts } from "./analyticsContext.ts";
import type { ComicRow } from "./comicTypes.ts";

const stats = {
  avgMuseum: 10,
  avgInvestment: 10,
  avgLiquidity: 80,
  byPillar: { Batman: 1 },
  byRecommendation: { "Sell / Lot Candidate": 1 },
  museumCount: 0,
  pillarReviewCount: 0,
  sellHighCount: 1,
  lotCount: 1,
  moveNowCount: 1,
  moveNowValue: 40,
};

test("analytics context is a derived unverified slice", () => {
  const row: ComicRow = {
    id: "1",
    Series: "Batman",
    "Issue Full": "1",
    "Current Price": 40,
    "Liquidity Score": 80,
    Recommendation: "Sell / Lot Candidate",
    "Sell Priority": "High",
    "Collection Pillar": "Batman",
  };
  const ctx = buildAnalyticsContext({
    meta: { recordCount: 1, totalValue: 40, source: "comics-api", snapshotLabel: "test" },
    filtered: [row],
    dashboardStats: stats,
    filters: { ...DEFAULT_FILTERS },
    workspace: "all",
    selectedComic: row,
    filteredValue: 40,
    vertical: "comic",
    unit: "books",
  });
  assert.equal(ctx.provenance.verificationStatus, "unverified");
  assert.equal(ctx.provenance.method, "derived_slice");
  assert.equal(ctx.highlights.topByValue[0]?.series, "Batman");
  assert.equal(ctx.activeFilter.matchingRecords, 1);
});

test("suggested prompts follow the vertical", () => {
  assert.ok(suggestedPrompts("comic")[0].includes("sell or lot"));
  assert.ok(suggestedPrompts("pokemon")[0].includes("TCG"));
  assert.ok(suggestedPrompts("football")[0].toLowerCase().includes("rookie"));
});
