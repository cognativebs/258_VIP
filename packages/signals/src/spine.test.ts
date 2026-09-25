import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NEWSLETTER_FIXTURE_URL,
  SCORE_WEIGHT_SEED,
  SIGNAL_TYPE_SEED,
  SPINE_FIXTURE_DOCUMENTS,
} from "./fixtures/spine-documents.js";
import {
  ScoreWeightSetSchema,
  SpineSignalSchema,
  SpineSignalTypeSchema,
  ValuationCitationSchema,
} from "./schemas/spine.js";
import {
  assertMayEnterValuation,
  independentSourceCount,
  normalizeSignalUrl,
  priorityFromScores,
  signalInfluence,
  ValuationFirewallError,
} from "./spine.js";

function rowsFor(eventKey: string) {
  return SPINE_FIXTURE_DOCUMENTS.filter((doc) => doc.eventKey === eventKey).map((doc) => ({
    role: doc.role ?? "UNKNOWN",
    independenceGroup: doc.independenceGroup,
  }));
}

describe("signals spine fixtures", () => {
  it("covers the press release, derivatives, independents, newsletter, duplicate, and unrelated docs", () => {
    expect(SPINE_FIXTURE_DOCUMENTS.length).toBeGreaterThanOrEqual(12);
    const keys = SPINE_FIXTURE_DOCUMENTS.map((doc) => doc.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "press-release",
        "deriv-1",
        "deriv-2",
        "deriv-3",
        "deriv-4",
        "ind-a",
        "ind-b",
        "newsletter",
        "exact-duplicate",
        "unrelated-1",
        "unrelated-2",
      ]),
    );
  });

  it("counts one independent source when four documents only repeat a press release", () => {
    expect(independentSourceCount(rowsFor("evt-press"))).toBe(1);
  });

  it("counts two independent sources when derivatives sit beside two reports", () => {
    expect(independentSourceCount(rowsFor("evt-two-source"))).toBe(2);
  });

  it("strips newsletter tracking and does not keep a recipient address", () => {
    const canonical = normalizeSignalUrl(NEWSLETTER_FIXTURE_URL, "canonical");
    const redacted = normalizeSignalUrl(NEWSLETTER_FIXTURE_URL, "redact");
    expect(canonical).toBe("https://example.com/brief/2026-09-20?id=42");
    expect(redacted).toBe(
      "https://example.com/brief/2026-09-20?id=42&utm_medium=email&utm_source=newsletter",
    );
    expect(canonical).not.toContain("reader@example.com");
    expect(redacted).not.toContain("reader@example.com");
    expect(canonical).not.toContain("utm_");
  });

  it("treats the same source and content hash as one document", () => {
    const press = SPINE_FIXTURE_DOCUMENTS.find((doc) => doc.key === "press-release");
    const dup = SPINE_FIXTURE_DOCUMENTS.find((doc) => doc.key === "exact-duplicate");
    expect(press?.sourceKey).toBe(dup?.sourceKey);
    expect(press?.contentHash).toBe(dup?.contentHash);
  });
});

describe("signals spine scores", () => {
  it("stores half-lives as unverified seed data, not as code branches", () => {
    for (const row of SIGNAL_TYPE_SEED) {
      expect(SpineSignalTypeSchema.parse(row).halfLifeVerified).toBe(false);
    }
    const injury = SIGNAL_TYPE_SEED.find((row) => row.code === "PLAYER_INJURY");
    const license = SIGNAL_TYPE_SEED.find((row) => row.code === "LICENSE_CHANGE");
    expect(injury?.defaultHalfLifeHours).toBe(48);
    expect(license?.defaultHalfLifeHours).toBe(8760);
    const fn = readFileSync(new URL("./spine.ts", import.meta.url), "utf8");
    expect(fn).not.toContain("PLAYER_INJURY");
    expect(fn).not.toContain("LICENSE_CHANGE");
  });

  it("seeds one current weight set that is unverified and not Section 5", () => {
    const parsed = ScoreWeightSetSchema.parse(SCORE_WEIGHT_SEED);
    expect(parsed.verified).toBe(false);
    expect(parsed.isCurrent).toBe(true);
    expect(parsed.weightsJson.formula).toBe("weighted_product_v1");
    expect(parsed.weightsJson.stored_inputs).toEqual([
      "base_confidence",
      "base_impact",
      "noise_probability",
    ]);
  });

  it("computes priority from the three scores and the weight set, never a stored column", () => {
    const v0 = SCORE_WEIGHT_SEED.weightsJson.exponents;
    expect(priorityFromScores(0.8, 0.5, 0.25, v0)).toBe(0.3);
    expect(
      priorityFromScores(0.8, 0.5, 0.25, { base_confidence: 2, base_impact: 1, one_minus_noise: 1 }),
    ).toBe(0.24);
    expect(() =>
      priorityFromScores(0.8, 0.5, 0.25, { base_confidence: -1, base_impact: 1, one_minus_noise: 1 }),
    ).toThrow();
    const fn = readFileSync(new URL("./spine.ts", import.meta.url), "utf8");
    expect(fn).not.toMatch(/one_minus_noise:\s*\d/);
    const parsed = SpineSignalSchema.safeParse({
      id: "8d0d6b2e-0e3a-4a1c-9c1a-6e5f0b1a2c3d",
      signalTypeCode: "PLAYER_INJURY",
      domain: "sports_cards",
      title: "Injury report",
      summary: "A player may miss time.",
      direction: "unknown",
      firstSeenAt: "2026-09-01T00:00:00.000Z",
      lastUpdatedAt: "2026-09-01T00:00:00.000Z",
      eventId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      baseConfidence: 0.8,
      baseImpact: 0.5,
      noiseProbability: 0.25,
      scoreWeightSetId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      createdByVersion: "signals-spine@0.1.0",
      provenance: {
        source: "fixture",
        method: "inferred",
        ruleOrModelVersion: "signals-spine@0.1.0",
        confidence: 0.4,
        verificationStatus: "unverified",
        notes: "fixture",
      },
      relevance: 0.9,
    });
    expect(parsed.success).toBe(false);
  });

  it("halves a 48-hour signal at one half-life and barely moves a year-long signal", () => {
    const injuryHalf = SIGNAL_TYPE_SEED.find((row) => row.code === "PLAYER_INJURY")!
      .defaultHalfLifeHours;
    const licenseHalf = SIGNAL_TYPE_SEED.find((row) => row.code === "LICENSE_CHANGE")!
      .defaultHalfLifeHours;
    const base = priorityFromScores(0.8, 0.5, 0.25, SCORE_WEIGHT_SEED.weightsJson.exponents);
    expect(signalInfluence(base, injuryHalf, injuryHalf)).toBeCloseTo(base / 2, 6);
    const agedLicense = signalInfluence(base, 48, licenseHalf);
    expect(agedLicense).toBeGreaterThan(base * 0.99);
    expect(agedLicense).toBeLessThanOrEqual(base);
  });

  it("refuses a valuation join when the ceiling flag is false", () => {
    const citation = ValuationCitationSchema.parse({
      signalId: "8d0d6b2e-0e3a-4a1c-9c1a-6e5f0b1a2c3d",
      valuationPath: "vault_market.market_value",
      mayRaiseValuationCeiling: false,
    });
    expect(() => assertMayEnterValuation(citation.mayRaiseValuationCeiling)).toThrow(
      ValuationFirewallError,
    );
    expect(
      ValuationCitationSchema.safeParse({
        signalId: "8d0d6b2e-0e3a-4a1c-9c1a-6e5f0b1a2c3d",
        valuationPath: "vault_market.market_value",
        mayRaiseValuationCeiling: true,
      }).success,
    ).toBe(false);
  });
});
