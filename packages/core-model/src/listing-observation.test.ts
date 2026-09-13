import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import {
  CONDITION_KEY_ANY,
  ListingObservationSchema,
  ComicsCompsWalkCursorSchema,
} from "./market.js";

const now = new Date();

function baseObs() {
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    provenance: markInferred({
      source: "ebay_browse",
      ruleOrModelVersion: "ebay-sold@0.1.0",
      notes: "eBay Browse listing · unverified",
    }),
    assetId: randomUUID(),
    holdingId: randomUUID(),
    holdingSourceRowId: "59308-311806ef",
    conditionKey: CONDITION_KEY_ANY,
    observationKind: "browse_listing" as const,
    source: "ebay_browse" as const,
    listingId: "v1|123|0",
    askPrice: 3.59,
    currency: "USD",
    observedAt: now,
    providerIds: { ebay_item_id: "v1|123|0" },
  };
}

describe("ListingObservation", () => {
  it("accepts a Browse listing with explicit any condition", () => {
    const row = ListingObservationSchema.parse(baseObs());
    expect(row.conditionKey).toBe("any");
    expect(row.observationKind).toBe("browse_listing");
    expect(row.provenance.verificationStatus).toBe("unverified");
  });

  it("rejects a null condition key", () => {
    expect(() =>
      ListingObservationSchema.parse({ ...baseObs(), conditionKey: null }),
    ).toThrow();
  });

  it("rejects ask-less browse_listing rows", () => {
    expect(() =>
      ListingObservationSchema.parse({ ...baseObs(), askPrice: null }),
    ).toThrow();
  });

  it("allows browse_empty with a null ask", () => {
    const row = ListingObservationSchema.parse({
      ...baseObs(),
      observationKind: "browse_empty",
      listingId: "empty:59308-311806ef",
      askPrice: null,
      providerIds: {},
    });
    expect(row.askPrice).toBeNull();
  });

  it("does not accept sale as a listing source", () => {
    expect(() =>
      ListingObservationSchema.parse({ ...baseObs(), source: "ebay" }),
    ).toThrow();
  });

  it("accepts a PriceCharting guide quote as unverified, not a sale", () => {
    const row = ListingObservationSchema.parse({
      ...baseObs(),
      observationKind: "guide_quote",
      source: "pricecharting",
      listingId: "pc:2314159:loose",
      askPrice: 12.5,
      providerIds: { pricecharting_id: "2314159" },
      provenance: markInferred({
        source: "pricecharting",
        ruleOrModelVersion: "pricecharting-guide@0.1.0",
        notes: "PriceCharting loose guide · unverified — not a sold ledger row",
      }),
    });
    expect(row.observationKind).toBe("guide_quote");
    expect(row.source).toBe("pricecharting");
    expect(row.provenance.verificationStatus).toBe("unverified");
  });
});

describe("ComicsCompsWalkCursor", () => {
  it("parses a pause/resume cursor", () => {
    const cursor = ComicsCompsWalkCursorSchema.parse({
      job: "comics-comps-walk",
      lastHoldingSourceRowId: "abc",
      processed: 12,
      skippedFresh: 1,
      unmatched: 4,
      wrote: 7,
      errors: [],
      paused: true,
      publishers: ["Marvel", "DC"],
      updatedAt: now.toISOString(),
    });
    expect(cursor.paused).toBe(true);
    expect(cursor.processed).toBe(12);
  });
});
