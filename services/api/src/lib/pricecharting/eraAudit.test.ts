import { describe, expect, it } from "vitest";
import { classifyEraGap } from "@vip/core-model";
import { formatEraAuditReport, type EraAuditReport } from "./eraAudit.js";

describe("era audit report", () => {
  it("reports reprint/original trips and not Phase 2", () => {
    const report: EraAuditReport = {
      version: "map-era-gap@0.1.0",
      confirmedMaps: 1009,
      scored: 1000,
      unscored: 9,
      trips: 4,
      vendorYearMissing: 9,
      longRunningNotDemoted: 60,
      mapsDemoted: 4,
      mapsConfirmedBlocked: 0,
      observationsIneligible: 8,
      valueConfirmed: 9900,
      valueTripped: 28,
      valueWeightedImpact: 28 / 9900,
      samples: [
        {
          canonicalName: "American Splendor #1 (First Printing)",
          yearBegan: 2006,
          vendorYear: 1976,
          vendorProductName: "American Splendor #1 (1976)",
          clzValue: 28,
        },
      ],
    };
    const text = formatEraAuditReport(report);
    expect(text).toMatch(/trips=4/);
    expect(text).toMatch(/vendorYearMissing=9/);
    expect(text).toMatch(/longRunningNotDemoted=60/);
    expect(classifyEraGap(2014, 1975).verdict).toBe("era_gap");
  });
});
