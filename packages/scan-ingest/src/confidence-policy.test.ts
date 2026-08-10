import { markInferred } from "@vip/evidence";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIDENCE_POLICY,
  assessCandidates,
  policyFromEnv,
  type ConfidencePolicy,
} from "./confidence-policy.js";
import { SCAN_ID_RULE } from "./constants.js";
import type { IdentityCandidate } from "./schemas.js";

function candidate(
  confidence: number,
  matchReasons: string[] = ["token_overlap"],
  catalogKey = `key-${confidence}`,
): IdentityCandidate {
  return {
    catalogKey,
    category: "sports",
    displayName: `Card ${catalogKey}`,
    externalIds: [],
    confidence,
    matchReasons,
    provenance: markInferred({
      source: "scan_id_matcher",
      ruleOrModelVersion: SCAN_ID_RULE,
      confidence,
    }),
  };
}

const AUTO_ON: ConfidencePolicy = {
  ...DEFAULT_CONFIDENCE_POLICY,
  autoResolveEnabled: true,
};

describe("assessCandidates", () => {
  it("never auto resolves while the policy is disabled (the default)", () => {
    const result = assessCandidates(
      [candidate(0.99, ["external_id:cardladder"])],
      { policy: DEFAULT_CONFIDENCE_POLICY },
    );
    expect(result.autoResolve).toBe(false);
    expect(result.blockers).toContain("auto_resolve_disabled");
  });

  it("auto resolves a confident, unambiguous, identity-grade match", () => {
    const result = assessCandidates(
      [candidate(0.97, ["external_id:cardladder"]), candidate(0.4)],
      { policy: AUTO_ON },
    );
    expect(result.autoResolve).toBe(true);
    expect(result.band).toBe("auto");
    expect(result.blockers).toEqual([]);
  });

  it("refuses a high score when a near-tie makes it ambiguous", () => {
    const result = assessCandidates(
      [
        candidate(0.95, ["external_id:a"], "a"),
        candidate(0.93, ["external_id:b"], "b"),
      ],
      { policy: AUTO_ON },
    );
    expect(result.autoResolve).toBe(false);
    expect(result.blockers.some((b) => b.startsWith("margin_below"))).toBe(true);
  });

  it("refuses a high score built only on token overlap", () => {
    const result = assessCandidates([candidate(0.98, ["token_overlap"])], {
      policy: AUTO_ON,
    });
    expect(result.autoResolve).toBe(false);
    expect(result.blockers).toContain("no_identity_grade_match_reason");
  });

  it("refuses to auto resolve into a duplicate", () => {
    const result = assessCandidates(
      [candidate(0.99, ["external_id:cardladder"])],
      {
        policy: AUTO_ON,
        duplicateAlert: {
          unitId: "11111111-1111-4111-8111-111111111111",
          requiresConfirmation: true,
          duplicates: [
            {
              holdingId: "h1",
              assetName: "Card",
              quantity: 1,
              matchKind: "same_external_id",
              confidence: 1,
            },
          ],
          provenance: markInferred({
            source: "scan_duplicate_check",
            ruleOrModelVersion: SCAN_ID_RULE,
          }),
        },
      },
    );
    expect(result.autoResolve).toBe(false);
    expect(result.blockers).toContain("duplicate_alert");
  });

  it("bands an empty candidate list as none, and a poor match as weak", () => {
    expect(assessCandidates([]).band).toBe("none");
    expect(assessCandidates([candidate(0.2)]).band).toBe("weak");
    expect(assessCandidates([candidate(0.8)]).band).toBe("review");
  });

  it("reports margin against the runner-up", () => {
    const result = assessCandidates([candidate(0.9), candidate(0.5)]);
    expect(result.topConfidence).toBe(0.9);
    expect(result.margin).toBeCloseTo(0.4, 3);
  });
});

describe("policyFromEnv", () => {
  it("stays disabled unless explicitly opted in", () => {
    expect(policyFromEnv({}).autoResolveEnabled).toBe(false);
    expect(policyFromEnv({ VIP_SCAN_AUTO_RESOLVE: "0" }).autoResolveEnabled).toBe(false);
    expect(policyFromEnv({ VIP_SCAN_AUTO_RESOLVE: "1" }).autoResolveEnabled).toBe(true);
  });

  it("ignores out-of-range thresholds rather than trusting them", () => {
    const policy = policyFromEnv({ VIP_SCAN_AUTO_RESOLVE_MIN: "7" });
    expect(policy.autoResolveMin).toBe(DEFAULT_CONFIDENCE_POLICY.autoResolveMin);
  });
});
