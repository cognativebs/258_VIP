import { describe, expect, it } from "vitest";
import { assertVerified, markInferred, markObserved, ProvenanceError } from "./helpers.js";

describe("markInferred", () => {
  it("labels NM-style assumptions as inferred · unverified", () => {
    const p = markInferred({
      source: "clz_import",
      ruleOrModelVersion: "clz-adapter@0.1.0",
      notes: "NM assumed · unverified",
    });
    expect(p.method).toBe("inferred");
    expect(p.verificationStatus).toBe("unverified");
    expect(p.confidenceBand).toBe("low");
  });
});

describe("assertVerified", () => {
  it("passes observed verified provenance", () => {
    expect(() =>
      assertVerified(
        markObserved({
          source: "ebay",
          ruleOrModelVersion: "sale-match@0.1.0",
          confidence: 0.92,
        }),
      ),
    ).not.toThrow();
  });

  it("rejects inferred provenance", () => {
    expect(() =>
      assertVerified(
        markInferred({
          source: "clz_import",
          ruleOrModelVersion: "clz-adapter@0.1.0",
        }),
      ),
    ).toThrow(ProvenanceError);
  });
});
