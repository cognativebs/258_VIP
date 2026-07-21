import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { markInferred, markObserved } from "@vip/evidence";
import { AssetSchema, HoldingSchema, MarketValueSchema } from "./index.js";

const now = new Date();

describe("Asset vs Holding", () => {
  it("keeps catalog identity separate from ownership", () => {
    const assetId = randomUUID();
    const asset = AssetSchema.parse({
      id: assetId,
      createdAt: now,
      updatedAt: now,
      provenance: markObserved({
        source: "manual",
        ruleOrModelVersion: "core-model@0.1.0",
        confidence: 1,
      }),
      categoryId: randomUUID(),
      canonicalName: "Absolute Batman #1 Cover A",
      format: "single",
      tags: [],
      isActive: true,
    });

    const holding = HoldingSchema.parse({
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      provenance: markInferred({
        source: "clz_import",
        ruleOrModelVersion: "clz-adapter@0.1.0",
        notes: "NM assumed · unverified",
      }),
      assetId: asset.id,
      quantity: 1,
      gradeRating: null,
      assumedGrade: "NM",
      slabStatus: "raw",
      source: "clz_import",
      sourceRowId: "abc123",
    });

    expect(holding.assetId).toBe(asset.id);
    expect(holding.gradeRating).toBeNull();
    expect(holding.assumedGrade).toBe("NM");
  });
});

describe("MarketValue", () => {
  it("requires a range with sample size", () => {
    const mv = MarketValueSchema.parse({
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      provenance: markObserved({
        source: "ebay",
        ruleOrModelVersion: "market@0.1.0",
        confidence: 0.7,
      }),
      pricedUnitId: randomUUID(),
      low: 40,
      high: 55,
      sampleSize: 3,
      windowDays: 90,
      computedAt: now,
    });
    expect(mv.low).toBeLessThanOrEqual(mv.high);
    expect(mv.sampleSize).toBeGreaterThan(0);
  });
});
