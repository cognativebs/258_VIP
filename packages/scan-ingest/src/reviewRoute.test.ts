import { describe, expect, it } from "vitest";
import { routeReview } from "./reviewRoute.js";

describe("routeReview", () => {
  it("never auto-resolves a conflict", () => {
    expect(
      routeReview({ baseConfidence: 0.99, conflict: true, pairingNeedsReview: false }),
    ).toBe("CONFLICT");
  });

  it("uses configurable thresholds", () => {
    const t = { highMin: 0.9, mediumMin: 0.5 };
    expect(
      routeReview({
        baseConfidence: 0.82,
        conflict: false,
        pairingNeedsReview: false,
        thresholds: t,
      }),
    ).toBe("MEDIUM");
    expect(
      routeReview({
        baseConfidence: 0.92,
        conflict: false,
        pairingNeedsReview: false,
        thresholds: t,
      }),
    ).toBe("HIGH");
  });
});
