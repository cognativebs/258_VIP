import { describe, expect, it } from "vitest";
import {
  decideDealerDisposition,
  sliceFromCandidate,
  softwareFlagsFor,
} from "./batchPipeline.js";
import { BATCH_001_SPORTS_ROSTER } from "./batch001SportsRoster.js";

describe("Batch 001 sports roster", () => {
  it("is 25 messy dealer cards, not a base-card lot", () => {
    expect(BATCH_001_SPORTS_ROSTER).toHaveLength(25);
    const messy = BATCH_001_SPORTS_ROSTER.filter((r) =>
      r.messFlags.some((f) =>
        /parallel|numbered|auto|relic|insert|die-cut|choice/i.test(f),
      ),
    );
    expect(messy.length).toBeGreaterThanOrEqual(20);
    for (const row of BATCH_001_SPORTS_ROSTER) {
      expect(row.intendedAskBandUsd.low).toBeGreaterThanOrEqual(5);
      expect(row.intendedAskBandUsd.high).toBeLessThanOrEqual(50);
    }
  });
});

describe("decideDealerDisposition", () => {
  it("sells dealer cards that have an identity — never a silent Hold", () => {
    const d = decideDealerDisposition({ hasIdentity: true, confidence: 0.62 });
    expect(d.action).toBe("Sell");
    expect(d.reasonCode).toBe("DEALER_CHURN");
    expect(d.notes).not.toMatch(/\$\d/);
  });

  it("holds when identity is too weak to list", () => {
    const d = decideDealerDisposition({ hasIdentity: false, confidence: null });
    expect(d.action).toBe("Hold");
    expect(d.reasonCode).toBe("IDENTITY_TOO_WEAK");
  });
});

describe("softwareFlagsFor", () => {
  it("flags dropped parallel + missing LIVE as identity/pricing/listing", () => {
    const roster = BATCH_001_SPORTS_ROSTER[0]!;
    const identity = sliceFromCandidate(
      {
        catalogKey: "sports:panini:prizm:2023:wembanyama:136",
        displayName: "2023 Panini Prizm Victor Wembanyama #136",
        year: 2023,
        playerOrCharacter: "Victor Wembanyama",
        collectorNumber: "136",
        confidence: 0.9,
        matchReasons: ["name:Victor Wembanyama"],
      },
      roster.fileStem,
    );
    const flags = softwareFlagsFor(
      roster.expected,
      identity,
      "not fetched",
      "Sell",
      "2023 Panini Prizm Victor Wembanyama #136",
    );
    expect(flags.flags).toContain("identity");
    expect(flags.flags).toContain("pricing");
    expect(flags.flags).toContain("listing");
    expect(flags.notes.join(" ")).toMatch(/parallel/i);
    expect(flags.notes.join(" ")).not.toMatch(/sold/i);
  });
});
