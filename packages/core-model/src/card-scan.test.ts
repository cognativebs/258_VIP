import { describe, expect, it } from "vitest";
import {
  CardScanObjectSchema,
  DEFAULT_REVIEW_THRESHOLDS,
  ReviewRouteSchema,
  field,
  unknownField,
} from "./card-scan.js";

describe("card-scan contracts", () => {
  it("keeps unknown preferable to a fabricated value", () => {
    const f = unknownField("back_text");
    expect(f.value).toBeNull();
    expect(f.notes).toBe("unknown");
    expect(unknownField("operator").origin).toBe("operator");
  });

  it("separates base identity from parallel on a CardScanObject", () => {
    const empty = unknownField();
    const obj = CardScanObjectSchema.parse({
      cardScanId: "u1",
      batchId: "b1",
      frontImageId: null,
      backImageId: null,
      originalFrontRef: "/tmp/a_front.jpg",
      originalBackRef: "/tmp/a_back.jpg",
      normalizedFrontRef: "/tmp/a_front.jpg",
      normalizedBackRef: "/tmp/a_back.jpg",
      source: "ricoh_fi8170",
      pairingMethod: "filename_front_back",
      pairingConfidence: 0.95,
      pairingNeedsReview: false,
      orientation: "portrait",
      processingStatus: "identified",
      identificationStatus: "inferred",
      reviewStatus: "needs_review",
      reviewRoute: "MEDIUM",
      evidence: {
        front: {
          category: empty,
          playerOrCharacter: field("Kurtis Rourke", 0.7, "front_text"),
          year: field("2025", 0.7, "front_text"),
          manufacturer: empty,
          brand: field("Prizm", 0.6, "front_text"),
          setName: empty,
          subsetInsert: empty,
          collectorNumber: field("397", 0.7, "front_text"),
          team: empty,
          rookie: empty,
          parallel: field("Silver", 0.4, "front_text"),
          serialNumber: empty,
          autograph: empty,
          relic: empty,
        },
        back: {
          category: empty,
          playerOrCharacter: field("Kurtis Rourke", 0.8, "back_text"),
          year: field("2025", 0.8, "back_text"),
          manufacturer: field("Panini", 0.7, "back_text"),
          brand: field("Prizm", 0.6, "back_text"),
          setName: empty,
          subsetInsert: empty,
          collectorNumber: field("397", 0.8, "back_text"),
          team: empty,
          rookie: empty,
          parallel: empty,
          serialNumber: empty,
          autograph: empty,
          relic: empty,
        },
        fused: {
          category: field("sports", 0.5, "inference"),
          playerOrCharacter: field("Kurtis Rourke", 0.85, "back_text"),
          year: field("2025", 0.85, "back_text"),
          manufacturer: field("Panini", 0.7, "back_text"),
          brand: field("Prizm", 0.6, "front_text"),
          setName: empty,
          subsetInsert: empty,
          collectorNumber: field("397", 0.85, "back_text"),
          team: empty,
          rookie: empty,
          parallel: field("Silver", 0.4, "front_text"),
          serialNumber: empty,
          autograph: empty,
          relic: empty,
        },
        conflictNotes: [],
      },
      baseVsParallel: {
        baseDisplayName: "2025 Panini Prizm #397 Kurtis Rourke",
        baseConfidence: 0.85,
        parallelDisplayName: "Silver",
        parallelConfidence: 0.4,
        notes: "Weak parallel does not invalidate base identity",
      },
      physicalReimport: false,
      identityDuplicate: false,
      createdAt: "2026-08-30T00:00:00.000Z",
    });
    expect(obj.baseVsParallel.baseConfidence).toBeGreaterThan(
      obj.baseVsParallel.parallelConfidence,
    );
    expect(ReviewRouteSchema.options).toContain("CONFLICT");
    expect(DEFAULT_REVIEW_THRESHOLDS.highMin).toBeGreaterThan(
      DEFAULT_REVIEW_THRESHOLDS.mediumMin,
    );
  });
});
