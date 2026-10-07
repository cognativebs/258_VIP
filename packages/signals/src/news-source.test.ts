import { describe, expect, it } from "vitest";
import {
  SIGNALS_NEWS_SOURCE_RULE,
  SignalsNewsSourceSchema,
  newsAdapterMayRun,
} from "./news-source.js";

describe("signals news source", () => {
  it("keeps adapters and Phase 2 off, and seed estimates unverified", () => {
    const row = SignalsNewsSourceSchema.parse({
      sourceKey: "comicsbeat_rss",
      displayName: "The Beat (comics)",
      tier: "machine",
      accessMethod: "rss",
      endpoint: "https://www.comicsbeat.com/feed/",
      auth: "none",
      authEnvVar: null,
      verifyBeforeFirstRun: false,
      adapterEnabled: false,
      isActive: false,
      blockedReason: null,
      cadence: "4x daily",
      latencyNotes: "minutes",
      categoryCoverage: ["comics"],
      seedEvidenceClass: "trade_press",
      seedConfidenceCeiling: 0.65,
      authoritySeed: 0.75,
      historicalAccuracySeed: null,
      redistributionAllowed: false,
      mayRaiseValuationCeiling: false,
      terms: "Standard RSS. Metadata and links only.",
      dedupKeys: ["guid", "url_canonical"],
      iqvaultOnly: false,
      whyItEarnsASlot: "Comics news, not a price authority.",
      phase2Enabled: false,
      provenance: {
        source: "signals_news_seed",
        method: "inferred",
        ruleOrModelVersion: SIGNALS_NEWS_SOURCE_RULE,
        verificationStatus: "unverified",
        notes: "authority_seed is a seed estimate · unverified",
      },
    });
    expect(newsAdapterMayRun(row)).toBe(false);
    expect(row.mayRaiseValuationCeiling).toBe(false);
    expect(row.phase2Enabled).toBe(false);
    expect(row.provenance.verificationStatus).toBe("unverified");
  });

  it("blocks newsletters until Gmail inbound is confirmed", () => {
    expect(
      newsAdapterMayRun({
        adapterEnabled: false,
        isActive: false,
        verifyBeforeFirstRun: true,
        blockedReason: "gmail inbound unconfirmed",
      }),
    ).toBe(false);
  });
});
