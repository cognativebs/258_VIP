import { describe, expect, it } from "vitest";
import { SIGNALS_CONTEXT_CAP, SignalsContextSchema } from "./signals-context.js";

describe("SignalsContext", () => {
  it("accepts a compact unverified slice and caps active items", () => {
    expect(SIGNALS_CONTEXT_CAP).toBe(25);
    const parsed = SignalsContextSchema.parse({
      active: [
        {
          id: "sig-1",
          title: "Drop",
          body: "A reprint rumor",
          sourceId: "pokemon-news-rss",
          publishedAt: "2026-08-29T00:00:00.000Z",
          signalType: "news",
          quarantineStatus: "active",
          confidence: 0.4,
          ruleVersion: "signals@0.1.0",
        },
      ],
      quarantinedCount: 2,
      feedKind: "job_feed",
      provenance: {
        source: "signals_feed",
        method: "inferred",
        ruleOrModelVersion: "signals-context@0.1.0",
        verificationStatus: "unverified",
        notes: "News is inferred · unverified RSS; not a market fact.",
      },
    });
    expect(parsed.active).toHaveLength(1);
    expect(parsed.provenance.verificationStatus).toBe("unverified");
  });
});
