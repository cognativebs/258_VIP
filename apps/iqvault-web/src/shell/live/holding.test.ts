import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Holding } from "@/lib/api";
import {
  assetFromHolding,
  confidenceFromEvidence,
  coverageFromAssets,
  isBridgeSeed,
  rangeFromChip,
  rangeFromHoldingFields,
  verificationFromHolding,
} from "./holding";
import { signalItem } from "./load";

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: "copy-1",
    assetName: "Copy",
    series: "Series",
    issue: "1",
    publisher: "Pub",
    quantity: 1,
    pillar: "Comics",
    museumScore: null,
    investmentScore: null,
    liquidityScore: null,
    recommendationLabel: null,
    sellPriority: null,
    needsGrading: false,
    needsPhoto: false,
    needsVerification: false,
    verificationNotes: null,
    currentPrice: 412,
    assumedGrade: null,
    gradeRating: null,
    provenance: {
      source: "clz_import",
      method: "import",
      confidence: 1,
      verificationStatus: "unverified",
      ruleOrModelVersion: "clz-python-ingest@0.2.0",
    },
    ...overrides,
  };
}

describe("live holding ranges", () => {
  it("does not turn a snapshot currentPrice into a displayed price", () => {
    const asset = assetFromHolding(holding({ currentPrice: 412 }));
    assert.equal(asset.range.confidence, "none");
    assert.equal(asset.range.low, null);
    assert.equal(asset.range.high, null);
    assert.equal(asset.range.compCount, 0);
  });

  it("labels browse chips as listings and refuses High when recency is unknown", () => {
    const ranged = rangeFromChip({
      status: "range",
      low: 8,
      high: 12,
      listingCount: 10,
      recencyDays: 3,
    });
    assert.equal(ranged.evidenceLabel, "listings");
    assert.equal(ranged.confidence, "high");
    assert.equal(confidenceFromEvidence(10, null), "medium");
    assert.equal(confidenceFromEvidence(2, 1), "low");
    assert.equal(confidenceFromEvidence(0, 1), "none");
    const fromColumns = rangeFromHoldingFields({
      liveLow: 8,
      liveHigh: 12,
      liveListingCount: 10,
    });
    assert.equal(fromColumns.evidenceLabel, "listings");
    assert.equal(fromColumns.confidence, "medium");
    assert.equal(fromColumns.recencyDays, null);
  });

  it("shows a condition chip only when the copy is unverified", () => {
    const verified = verificationFromHolding(holding());
    assert.equal(verified.verified, true);
    const chip = verificationFromHolding(
      holding({ needsVerification: true, assumedGrade: "NM", verificationNotes: null }),
    );
    assert.equal(chip.verified, false);
    assert.equal(chip.label, "NM assumed · unverified");
  });

  it("computes coverage by asset and refuses a by-value percent", () => {
    const priced = assetFromHolding(
      holding({ id: "priced", liveLow: 1, liveHigh: 2, liveListingCount: 4, currentPrice: 9 }),
    );
    const empty = assetFromHolding(holding({ id: "empty", currentPrice: 400 }));
    const coverage = coverageFromAssets([priced, empty]);
    assert.equal(coverage.byAssetCovered, 1);
    assert.equal(coverage.byAssetTotal, 2);
    assert.equal(coverage.byAssetPercent, 50);
    assert.match(coverage.byValueNote, /not computed/);
  });

  it("drops bridge seeds and does not invent a valuation for an unlinked signal", () => {
    assert.equal(
      isBridgeSeed(holding({ provenance: { ...holding().provenance, source: "vip_pokemon_seed" } })),
      true,
    );
    assert.equal(isBridgeSeed(holding()), false);
    const item = signalItem(
      {
        id: "s1",
        signalType: "news",
        body: "A note without a price.",
        signalDate: "2026-09-01",
        quarantineStatus: "active",
        assetId: null,
        title: "Headline",
      },
      new Map(),
      {},
    );
    assert.equal(item.linkage.status, "unavailable");
    if (item.linkage.status === "unavailable") {
      assert.match(item.linkage.note, /no holding id/);
    }
    assert.equal("range" in item.linkage, false);
  });
});
