import { describe, expect, it } from "vitest";
import { chipFromObservationAgg } from "./liveRange.js";

describe("chipFromObservationAgg", () => {
  it("returns not fetched when the holding is absent from cache", () => {
    const chip = chipFromObservationAgg("clz-missing", undefined);
    expect(chip.status).toBe("not_fetched");
    expect(chip.label).toBe("not fetched");
    expect(chip.low).toBeNull();
  });

  it("formats a cached Browse range without saying sold", () => {
    const asOf = new Date("2026-08-29T00:00:00.000Z");
    const chip = chipFromObservationAgg(
      "clz-1",
      {
        holding_source_row_id: "clz-1",
        listing_count: 6,
        live_low: 3.59,
        live_high: 3.98,
        latest_observed: "2026-08-10T00:00:00.000Z",
      },
      asOf,
    );
    expect(chip.status).toBe("range");
    expect(chip.label).toBe("$3.59–$3.98 · 6 listings · 19d · unverified");
    expect(chip.label).not.toMatch(/sold/i);
    expect(chip.verificationStatus).toBe("unverified");
  });
});
