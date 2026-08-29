import { describe, expect, it } from "vitest";
import { markObserved } from "@vip/evidence";
import { decideListingDraft } from "./listingQueue.js";
import type { ApiHolding } from "./holdings.js";

function holding(over: Partial<ApiHolding> = {}): ApiHolding {
  return {
    id: "clz-1",
    assetName: "Batman #1",
    series: "Batman",
    issue: "1",
    publisher: "DC",
    quantity: 1,
    pillar: "Batman",
    inventoryBucket: "personal_collection",
    inventoryBucketAssignment: "inferred",
    museumScore: 80,
    investmentScore: 40,
    liquidityScore: 50,
    recommendationLabel: "Museum Candidate",
    sellPriority: "Low",
    needsGrading: false,
    needsPhoto: false,
    needsVerification: true,
    verificationNotes: null,
    currentPrice: 46,
    assumedGrade: "NM",
    gradeRating: null,
    coverImageUrl: null,
    cardName: null,
    rarity: null,
    externalIds: [],
    provenance: markObserved({ source: "clz_import", ruleOrModelVersion: "test@1", confidence: 0.8 }),
    ...over,
  };
}

const sellBody = {
  holdingSourceRowIds: ["clz-1"],
  action: "Sell" as const,
};

describe("decideListingDraft", () => {
  it("blocks routine personal-collection drafts without an override note", () => {
    const draft = decideListingDraft({
      holding: holding(),
      body: sellBody,
      listingCount: 6,
      liveLow: 3.59,
      liveHigh: 3.98,
      hasEbayCreds: true,
    });
    expect(draft.status).toBe("blocked_personal");
    expect(draft.listingPayload.submitReady).toBe(false);
  });

  it("allows a personal override and still keeps submitReady false", () => {
    const draft = decideListingDraft({
      holding: holding(),
      body: { ...sellBody, personalOverrideNote: "Operator moving a duplicate" },
      listingCount: 6,
      liveLow: 3.59,
      liveHigh: 3.98,
      hasEbayCreds: true,
    });
    expect(draft.status).toBe("draft_ready");
    expect(draft.listingPayload.submitReady).toBe(false);
  });

  it("blocks investment vault without enough live listings", () => {
    const draft = decideListingDraft({
      holding: holding({
        pillar: "Investment Portfolio",
        inventoryBucket: "investment_vault",
        recommendationLabel: "Investment Hold / Review",
      }),
      body: sellBody,
      listingCount: 1,
      liveLow: 10,
      liveHigh: 12,
      hasEbayCreds: true,
    });
    expect(draft.status).toBe("blocked_insufficient_range");
  });

  it("drafts dealer inventory when credentials are missing as pending_credentials", () => {
    const draft = decideListingDraft({
      holding: holding({
        pillar: "General Inventory",
        inventoryBucket: "dealer_inventory",
        recommendationLabel: "Sell Duplicate",
      }),
      body: { ...sellBody, askPrice: 8 },
      listingCount: 4,
      liveLow: 6,
      liveHigh: 10,
      hasEbayCreds: false,
    });
    expect(draft.status).toBe("pending_credentials");
  });
});
