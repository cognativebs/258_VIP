import { describe, expect, it } from "vitest";
import { BINDER_UNVERSIONED, fromBinderProvenance } from "./binder.js";
import { ProvenanceSchema } from "./provenance.js";

const base = { source: "pokemontcg", modelVersion: "ptcg-v2", confidence: 0.92, verificationStatus: "verified" };

describe("fromBinderProvenance", () => {
  it("a catalog read is observed and keeps its version, confidence and status", () => {
    const p = fromBinderProvenance({ ...base, method: "api" });
    expect(p).toEqual({ source: "pokemontcg", method: "observed", ruleOrModelVersion: "ptcg-v2", confidence: 0.92, verificationStatus: "verified" });
    expect(ProvenanceSchema.safeParse(p).success).toBe(true);
  });

  it("an upload with nothing recorded claims nothing", () => {
    const p = fromBinderProvenance({ method: "user_upload", source: null, modelVersion: null, confidence: null, verificationStatus: null });
    expect(p).toMatchObject({
      source: "binder-vault",
      method: "observed",
      ruleOrModelVersion: BINDER_UNVERSIONED,
      confidence: 0,
      confidenceBand: "low",
      verificationStatus: "unverified",
    });
    expect(p.notes).toMatch(/user_upload/);
    expect(p.notes).toMatch(/confidence not recorded/);
  });

  it("a missing or unknown method is inferred, never observed", () => {
    expect(fromBinderProvenance({ ...base, method: null })).toMatchObject({ method: "inferred", notes: expect.stringMatching(/method not recorded/) });
    expect(fromBinderProvenance({ ...base, method: "scraped" })).toMatchObject({ method: "inferred", notes: expect.stringMatching(/scraped/) });
    expect(fromBinderProvenance({ ...base, method: "inferred" }).method).toBe("inferred");
  });

  it("anything but verified is unverified", () => {
    expect(fromBinderProvenance({ ...base, method: "api", verificationStatus: "disputed" }).verificationStatus).toBe("unverified");
    expect(fromBinderProvenance({ ...base, method: "api", verificationStatus: "Verified" }).verificationStatus).toBe("verified");
  });
});
