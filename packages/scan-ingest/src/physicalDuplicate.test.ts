import { describe, expect, it } from "vitest";
import { isPhysicalReimport } from "./physicalDuplicate.js";

describe("isPhysicalReimport", () => {
  it("treats a repeated front hash as the same physical scan", () => {
    expect(isPhysicalReimport("abc", ["xyz", "abc"])).toBe(true);
  });

  it("does not treat the same card type as a physical reimport", () => {
    expect(isPhysicalReimport("new-hash", ["other-hash"])).toBe(false);
  });
});
