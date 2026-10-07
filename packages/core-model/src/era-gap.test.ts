import { describe, expect, it } from "vitest";
import { classifyEraGap } from "./era-gap.js";

describe("classifyEraGap", () => {
  it("flags a 2006 reprint mapped to a 1976 original", () => {
    const row = classifyEraGap(2006, 1976);
    expect(row.verdict).toBe("era_gap");
    expect(row.gap).toBe(30);
    expect(row.direction).toBe("vendor_older");
  });

  it("does not flag long-running ASM (1970 series, 1988 issue year)", () => {
    const row = classifyEraGap(1970, 1988);
    expect(row.verdict).toBe("ok");
    expect(row.direction).toBe("vendor_newer");
  });

  it("keeps same-year maps", () => {
    expect(classifyEraGap(1970, 1970).verdict).toBe("ok");
  });

  it("leaves missing years unscored", () => {
    expect(classifyEraGap(null, 2013).verdict).toBe("unscored");
  });
});
