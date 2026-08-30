import { describe, expect, it } from "vitest";
import { formatLiveRangeChip, liveRangeChip } from "./live-range.js";

describe("formatLiveRangeChip", () => {
  it("shows not fetched when the walk has not cached the holding", () => {
    expect(
      formatLiveRangeChip({
        status: "not_fetched",
        low: null,
        high: null,
        listingCount: 0,
        recencyDays: null,
      }),
    ).toBe("not fetched");
  });

  it("never copies a catalog snapshot into the chip", () => {
    expect(
      formatLiveRangeChip({
        status: "empty",
        low: null,
        high: null,
        listingCount: 0,
        recencyDays: null,
      }),
    ).toBe("0 listings · unverified");
  });

  it("formats a Browse range as listings, not sold sales", () => {
    expect(
      formatLiveRangeChip({
        status: "range",
        low: 3.59,
        high: 3.98,
        listingCount: 6,
        recencyDays: 19,
      }),
    ).toBe("$3.59–$3.98 · 6 listings · 19d · unverified");
  });
});

describe("liveRangeChip", () => {
  it("builds a typed chip that stays unverified", () => {
    const chip = liveRangeChip({
      holdingSourceRowId: "clz-1",
      fetched: true,
      listingCount: 6,
      low: 3.59,
      high: 3.98,
      recencyDays: 19.2,
      observedAt: "2026-08-29T00:00:00.000Z",
    });
    expect(chip.status).toBe("range");
    expect(chip.verificationStatus).toBe("unverified");
    expect(chip.observationKind).toBe("browse_listing");
    expect(chip.label).toContain("listings");
    expect(chip.label).not.toMatch(/sold/i);
  });
});
