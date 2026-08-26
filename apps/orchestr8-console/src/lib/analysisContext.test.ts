import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySlice,
  buildAnalysisContext,
  highlightIdsForComps,
  highlightRowsForComps,
  ANALYSIS_COMPS_CAP,
  MIN_SALES_FOR_MARKET_EVIDENCE,
} from "./analysisContext";
import { bundleFromRecommendations, marketFromRecommendation } from "./marketEvidence";
import type { ComicRow, InventoryBundle } from "./inventoryApi";
import { CATALOG_SNAPSHOT_NOTE } from "../types/analysis";

function row(partial: Partial<ComicRow> & Pick<ComicRow, "id" | "Series" | "Issue Full">): ComicRow {
  return {
    "Current Price": 10,
    "Sell Priority": "High",
    Recommendation: "Sell Duplicate",
    "Liquidity Score": 70,
    ...partial,
  };
}

function bundle(rows: ComicRow[]): InventoryBundle {
  return {
    source: "vip",
    fetchedAt: "2026-08-25T00:00:00.000Z",
    meta: {
      snapshotLabel: "test",
      recordCount: rows.length,
      snapshotTotal: { amount: 0, note: CATALOG_SNAPSHOT_NOTE },
    },
    rows,
    provenance: {
      source: "vip",
      method: "http_get",
      confidence: 0.7,
      verificationStatus: "unverified",
    },
  };
}

describe("analysis comps context", () => {
  it("caps highlight ids and prefers highest catalog snapshot", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({
        id: `h${i}`,
        Series: "X-Men",
        "Issue Full": String(i),
        "Current Price": i,
      })
    );
    const ids = highlightRowsForComps(rows).map((r) => r.id);
    assert.equal(ids.length, ANALYSIS_COMPS_CAP);
    assert.equal(ids[0], "h19");
    assert.ok(!ids.includes("h0"));
  });

  it("attaches adapter market evidence and keeps catalog snapshot labeled unverified", () => {
    const rows = [
      row({ id: "a1", Series: "Batman", "Issue Full": "1", "Current Price": 40 }),
      row({ id: "a2", Series: "Batman", "Issue Full": "2", "Current Price": 12 }),
    ];
    const market = bundleFromRecommendations(
      ["a1", "a2"],
      [
        {
          holdingId: "a1",
          marketRange: {
            low: 30,
            high: 50,
            matchedSales: 4,
            recencyDays: 12,
            confidence: 0.6,
            confidenceBand: "medium",
          },
          insufficientMarketEvidence: false,
          compsSource: "ebay.com/sold",
          compsAdapters: [{ id: "ebay-sold", matched: 4, emptyReason: null }],
          minSalesRequired: 3,
          ruleOrModelVersion: "decision-engine@0.1.0",
        },
        {
          holdingId: "a2",
          marketRange: { low: 0, high: 0, matchedSales: 0, recencyDays: null, confidence: 0 },
          insufficientMarketEvidence: true,
          compsSource: "none",
          compsAdapters: [
            {
              id: "ebay-sold",
              matched: 0,
              emptyReason: "EBAY_OAUTH_TOKEN not set — adapter idle, no fabricated comps",
            },
          ],
        },
      ],
      []
    );

    const ctx = buildAnalysisContext(bundle(rows), "all", market);
    assert.equal(ctx.disclaimer.includes("never live comps"), true);
    assert.equal(ctx.marketEvidence.minSalesRequired, MIN_SALES_FOR_MARKET_EVIDENCE);
    assert.equal(ctx.marketEvidence.holdingsWithSales, 1);
    assert.equal(ctx.activeFilter.matchingValueNote, CATALOG_SNAPSHOT_NOTE);

    const top = ctx.highlights.topByValue[0];
    assert.ok(top);
    assert.equal(top.holdingId, "a1");
    assert.equal(top.catalogSnapshot.note, CATALOG_SNAPSHOT_NOTE);
    assert.equal(top.catalogSnapshot.amount, 40);
    assert.equal(top.market.matchedSales, 4);
    assert.equal(top.market.insufficientMarketEvidence, false);
    assert.deepEqual(top.market.range, {
      low: 30,
      high: 50,
      matchedSales: 4,
      recencyDays: 12,
      confidence: 0.6,
      confidenceBand: "medium",
    });
    assert.equal(top.market.provenance.verificationStatus, "unverified");

    const thin = ctx.highlights.topByValue.find((h) => h && h.holdingId === "a2");
    assert.ok(thin);
    assert.equal(thin.market.insufficientMarketEvidence, true);
    assert.equal(thin.market.range, null);
    assert.equal(thin.market.compsSource, "none");
    assert.equal(ctx.liquidationGate.action, "conditional");
    assert.deepEqual(ctx.liquidationGate.eligibleHoldingIds, ["a1"]);
    assert.equal(ctx.liquidationGate.blocked.some((b) => b.holdingId === "a2"), true);
  });

  it("blocks liquidation when adapters re-run but no holding meets minSalesRequired", () => {
    const market = bundleFromRecommendations(
      ["x"],
      [
        {
          holdingId: "x",
          marketRange: { low: 0, high: 0, matchedSales: 0, recencyDays: null, confidence: 0 },
          insufficientMarketEvidence: true,
          compsSource: "none",
        },
      ],
      [],
      null,
      { configured: false, mode: "idle", environment: "production" }
    );
    const gate = buildAnalysisContext(
      bundle([row({ id: "x", Series: "X", "Issue Full": "1" })]),
      "all",
      market
    ).liquidationGate;
    assert.equal(gate.action, "blocked");
    assert.deepEqual(gate.eligibleHoldingIds, []);
    assert.equal(gate.ebayAuth.configured, false);
  });

  it("does not copy catalog snapshot dollars into a fake market range", () => {
    const rec = marketFromRecommendation(
      {
        holdingId: "x",
        marketRange: { low: 0, high: 0, matchedSales: 0, recencyDays: null, confidence: 0 },
        insufficientMarketEvidence: true,
        compsSource: "none",
      },
      999
    );
    assert.equal(rec.catalogSnapshot.amount, 999);
    assert.equal(rec.range, null);
    assert.equal(rec.matchedSales, 0);
    assert.equal(rec.insufficientMarketEvidence, true);
  });

  it("marks 1–2 sales as insufficient against minSalesRequired", () => {
    const rec = marketFromRecommendation({
      holdingId: "x",
      marketRange: {
        low: 10,
        high: 12,
        matchedSales: 2,
        recencyDays: 5,
        confidence: 0.4,
        confidenceBand: "low",
      },
      insufficientMarketEvidence: false,
      compsSource: "ebay.com/sold",
    });
    assert.equal(rec.matchedSales, 2);
    assert.equal(rec.insufficientMarketEvidence, true);
    assert.ok(rec.range);
  });

  it("slice sellHigh only prices those rows", () => {
    const rows = [
      row({ id: "hi", Series: "A", "Issue Full": "1", "Sell Priority": "High", "Current Price": 5 }),
      row({ id: "lo", Series: "B", "Issue Full": "1", "Sell Priority": "Low", "Current Price": 500 }),
    ];
    assert.deepEqual(
      applySlice(rows, "sellHigh").map((r) => r.id),
      ["hi"]
    );
    assert.deepEqual(highlightIdsForComps(bundle(rows), "sellHigh"), ["hi"]);
  });
});
