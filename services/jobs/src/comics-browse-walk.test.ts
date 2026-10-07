import { describe, expect, it } from "vitest";
import {
  EBAY_BROWSE_DAILY_CALL_CEILING,
  formatComicsBrowseWalkReport,
} from "./comics-browse-walk.js";

describe("comics browse walk job", () => {
  it("reports the daily Browse call ceiling", () => {
    expect(EBAY_BROWSE_DAILY_CALL_CEILING).toBe(5000);
    const text = formatComicsBrowseWalkReport({
      mode: "inventory_walk",
      ranAt: "2026-09-20T20:00:00.000Z",
      report: "comics-comps-walk complete",
      exitCode: 0,
      dailyCallCeiling: 5000,
    });
    expect(text).toContain("inventory_walk");
    expect(text).toContain("dailyCallCeiling: 5000");
    expect(text).toContain("nightlyCoverageCap: 5000 holdings");
  });
});
