import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import {
  GUIDE_CONDITION_LOOSE,
  GuidePriceObservationSchema,
  chicagoSnapshotOn,
} from "./market.js";

const now = new Date("2026-09-14T08:00:00.000Z");

function baseRow() {
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    provenance: markInferred({
      source: "pricecharting",
      ruleOrModelVersion: "pricecharting-guide-snapshot@0.1.0",
      confidence: 0.6,
      notes: "vendor_derived · unverified",
    }),
    assetId: randomUUID(),
    holdingId: randomUUID(),
    holdingSourceRowId: "101632-a010f30c",
    pricedUnitId: null,
    conditionKey: GUIDE_CONDITION_LOOSE,
    snapshotOn: "2026-09-14",
    observedAt: now,
    observationKind: "guide_quote" as const,
    source: "pricecharting" as const,
    evidenceClass: "vendor_derived" as const,
    guidePrice: 12.5,
    currency: "USD",
    providerIds: { pricecharting_id: "2314159" },
  };
}

describe("chicagoSnapshotOn", () => {
  it("uses America/Chicago so 03:00 CDT is that calendar day", () => {
    expect(chicagoSnapshotOn(new Date("2026-09-14T08:00:00.000Z"))).toBe("2026-09-14");
    expect(chicagoSnapshotOn(new Date("2026-09-14T04:59:00.000Z"))).toBe("2026-09-13");
  });
});

describe("GuidePriceObservation", () => {
  it("accepts one unverified loose quote per day", () => {
    const row = GuidePriceObservationSchema.parse(baseRow());
    expect(row.conditionKey).toBe("raw_ungraded");
    expect(row.evidenceClass).toBe("vendor_derived");
    expect(row.guidePrice).toBe(12.5);
  });

  it("rejects a quote without a price and an empty with a price", () => {
    expect(() =>
      GuidePriceObservationSchema.parse({ ...baseRow(), guidePrice: null }),
    ).toThrow(/guidePrice/);
    expect(() =>
      GuidePriceObservationSchema.parse({
        ...baseRow(),
        observationKind: "guide_empty",
        guidePrice: 1,
      }),
    ).toThrow(/guide_empty/);
  });
});
