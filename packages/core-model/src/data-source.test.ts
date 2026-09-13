import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import {
  DataSourceSchema,
  EvidenceClassSchema,
  VendorProductMapSchema,
  confidenceCeilingFor,
} from "./data-source.js";

const now = new Date();

describe("evidence_class", () => {
  it("caps vendor_derived at 0.75 and never treats it as factual", () => {
    const row = EvidenceClassSchema.parse({
      evidenceClass: "vendor_derived",
      description: "A third-party vendor estimate with opaque methodology",
      isFactual: false,
      confidenceCeiling: 0.75,
    });
    expect(row.isFactual).toBe(false);
    expect(confidenceCeilingFor(["observed", "vendor_derived"])).toBe(0.75);
  });
});

describe("data_source", () => {
  it("seeds PriceCharting as non-redistributable vendor_derived", () => {
    const row = DataSourceSchema.parse({
      dataSourceId: 1,
      sourceKey: "pricecharting",
      displayName: "PriceCharting Legendary",
      accessMethod: "rest_api",
      defaultEvidenceClass: "vendor_derived",
      termsUrl: "https://www.pricecharting.com/api-documentation",
      redistributionAllowed: false,
      latencyMinutes: 1440,
      categoryCoverage: ["comics", "sports_cards"],
      isActive: true,
      accuracySampleN: 0,
      createdAt: now,
    });
    expect(row.redistributionAllowed).toBe(false);
    expect(row.historicalAccuracy).toBeUndefined();
  });
});

describe("vendor_product_map", () => {
  it("rejects auto-confirm on a trgm match", () => {
    expect(() =>
      VendorProductMapSchema.parse({
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        provenance: markInferred({
          source: "pricecharting",
          ruleOrModelVersion: "vendor-product-map@0.1.0",
        }),
        dataSourceId: 1,
        vendorProductId: "2314159",
        vendorProductName: "Action Comics #900 (2011)",
        pricedUnitId: randomUUID(),
        assetId: null,
        matchMethod: "trgm",
        matchConfidence: 0.88,
        needsReview: false,
        firstSeenAt: now,
        lastSeenAt: now,
        providerIds: { pricecharting_id: "2314159" },
      }),
    ).toThrow(/needs_review/);
  });

  it("accepts an upc match onto an asset when priced_unit is still missing", () => {
    const row = VendorProductMapSchema.parse({
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      provenance: markInferred({
        source: "pricecharting",
        ruleOrModelVersion: "vendor-product-map@0.1.0",
      }),
      dataSourceId: 1,
      vendorProductId: "9",
      vendorProductName: "Example",
      pricedUnitId: null,
      assetId: randomUUID(),
      matchMethod: "upc",
      matchConfidence: 0.98,
      needsReview: false,
      firstSeenAt: now,
      lastSeenAt: now,
      providerIds: { pricecharting_id: "9" },
    });
    expect(row.pricedUnitId).toBeNull();
    expect(row.needsReview).toBe(false);
  });
});
