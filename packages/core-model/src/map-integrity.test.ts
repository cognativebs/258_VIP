import { describe, expect, it } from "vitest";
import { classifyMapIntegrity } from "./map-integrity.js";
import { MAP_INTEGRITY_ASK_MIN, MAP_INTEGRITY_RATIO_HIGH, MAP_INTEGRITY_RATIO_LOW } from "./phase-d.js";

describe("classifyMapIntegrity", () => {
  it("does not flag maps with fewer than 5 asks", () => {
    const row = classifyMapIntegrity({ listingCount: 4, medianAsk: 1, guideRaw: 100 });
    expect(row.verdict).toBe("ok");
    expect(MAP_INTEGRITY_ASK_MIN).toBe(5);
  });

  it("flags the map when median_ask/guide_raw < 0.10", () => {
    const row = classifyMapIntegrity({ listingCount: 5, medianAsk: 3.9, guideRaw: 931 });
    expect(row.verdict).toBe("map_suspect");
    expect(row.ratio).toBeLessThan(MAP_INTEGRITY_RATIO_LOW);
    expect(row.reason).toMatch(/flag map/);
  });

  it("flags the map when median_ask/guide_raw > 10", () => {
    const row = classifyMapIntegrity({ listingCount: 8, medianAsk: 120, guideRaw: 10 });
    expect(row.verdict).toBe("map_suspect");
    expect(row.ratio).toBeGreaterThan(MAP_INTEGRITY_RATIO_HIGH);
  });

  it("leaves in-band ratios alone", () => {
    const row = classifyMapIntegrity({ listingCount: 20, medianAsk: 16, guideRaw: 10 });
    expect(row.verdict).toBe("ok");
    expect(row.ratio).toBe(1.6);
  });
});
