import { ProvenanceSchema } from "@vip/evidence";
import { describe, expect, it } from "vitest";
import { BINDER_UNVERSIONED, cardResultSchema, provenanceSchema, toEvidenceProvenance } from "./contracts";

describe("Binder provenance on @vip/evidence", () => {
  it("accepts and rejects exactly what the local shape did", () => {
    expect(provenanceSchema.parse({ method: "api", source: "pokemontcg", verificationStatus: "verified" })).toEqual({
      method: "api",
      source: "pokemontcg",
      modelVersion: null,
      confidence: null,
      verificationStatus: "verified",
    });
    expect(provenanceSchema.safeParse({ method: "observed", source: "x", verificationStatus: "verified" }).success).toBe(false);
    // The shared enum has disputed / superseded; Binder keeps its two statuses.
    expect(provenanceSchema.safeParse({ method: "api", source: "x", verificationStatus: "disputed" }).success).toBe(false);
    expect(provenanceSchema.safeParse({ method: "api", source: "x", verificationStatus: "unverified", confidence: 1.2 }).success).toBe(false);
    expect(
      cardResultSchema.safeParse({
        source: "pokemontcg",
        externalId: "base1-4",
        name: "Charizard",
        provenance: { method: "api", source: "pokemontcg", modelVersion: "ptcg-v2", confidence: 0.92, verificationStatus: "verified" },
      }).success,
    ).toBe(true);
  });

  it("maps a catalog read onto the shared contract", () => {
    const p = toEvidenceProvenance({ method: "api", source: "pokemontcg", modelVersion: "ptcg-v2", confidence: 0.92, verificationStatus: "verified" });
    expect(p).toEqual({ source: "pokemontcg", method: "observed", ruleOrModelVersion: "ptcg-v2", confidence: 0.92, verificationStatus: "verified" });
    expect(ProvenanceSchema.safeParse(p).success).toBe(true);
  });

  it("an upload with no version or confidence claims none", () => {
    const p = toEvidenceProvenance({ method: "user_upload", source: "local-file", modelVersion: null, confidence: null, verificationStatus: "unverified" });
    expect(p).toMatchObject({
      method: "observed",
      ruleOrModelVersion: BINDER_UNVERSIONED,
      confidence: 0,
      confidenceBand: "low",
      verificationStatus: "unverified",
    });
    expect(p.notes).toMatch(/user_upload/);
    expect(p.notes).toMatch(/confidence not recorded/);
  });

  it("inferred stays inferred", () => {
    expect(toEvidenceProvenance({ method: "inferred", source: "", modelVersion: "r@1", confidence: 0.3, verificationStatus: "unverified" })).toMatchObject({
      method: "inferred",
      source: "binder-vault",
    });
  });
});
