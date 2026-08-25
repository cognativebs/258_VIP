import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyMarketBundle, loadMarketEvidence } from "./marketEvidence";

function jsonRes(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response);
}

describe("loadMarketEvidence", () => {
  it("maps VIP recommendations onto a provenance-backed bundle", async () => {
    const bundle = await loadMarketEvidence(["h1", "missing"], (async (input) => {
      const url = String(input);
      assert.match(url, /holdingIds=h1%2Cmissing/);
      return jsonRes(200, {
        recommendations: [
          {
            holdingId: "h1",
            marketRange: {
              low: 8,
              high: 12,
              matchedSales: 3,
              recencyDays: 9,
              confidence: 0.55,
              confidenceBand: "medium",
            },
            insufficientMarketEvidence: false,
            compsSource: "ebay.com/sold",
            compsAdapters: [{ id: "ebay-sold", matched: 3, emptyReason: null }],
            minSalesRequired: 3,
            provenance: {
              source: "ebay.com/sold",
              method: "recommendation",
              ruleOrModelVersion: "decision-engine@0.1.0",
              confidence: 0.55,
              verificationStatus: "unverified",
            },
          },
        ],
        missingHoldingIds: ["missing"],
        minSalesRequired: 3,
      });
    }) as typeof fetch);

    assert.equal(bundle.fetchError, null);
    assert.equal(bundle.holdingsWithSales, 1);
    assert.equal(bundle.byHoldingId.h1?.matchedSales, 3);
    assert.equal(bundle.byHoldingId.h1?.insufficientMarketEvidence, false);
    assert.equal(bundle.byHoldingId.missing?.insufficientMarketEvidence, true);
    assert.deepEqual(bundle.missingHoldingIds, ["missing"]);
    assert.equal(bundle.provenance.verificationStatus, "unverified");
  });

  it("returns honest empty evidence when VIP recommendations are down", async () => {
    const bundle = await loadMarketEvidence(["h1"], (async () =>
      jsonRes(503, { error: "Comics inventory unavailable" })) as typeof fetch);
    assert.equal(bundle.byHoldingId.h1?.insufficientMarketEvidence, true);
    assert.match(bundle.fetchError ?? "", /unavailable|HTTP 503/i);
    assert.equal(bundle.holdingsWithSales, 0);
  });

  it("emptyMarketBundle never fabricates a range from catalog dollars", () => {
    const bundle = emptyMarketBundle(["h1"], "down");
    assert.equal(bundle.byHoldingId.h1?.range, null);
    assert.equal(bundle.byHoldingId.h1?.matchedSales, 0);
    assert.equal(bundle.byHoldingId.h1?.catalogSnapshot.amount, null);
  });
});
