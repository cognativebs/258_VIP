import { describe, expect, it } from "vitest";
import {
  VisionExtractSchema,
  shouldRunVision,
  visionObservedFields,
} from "./structuredVision.js";

const observed = (value: string) => ({
  value,
  status: "observed" as const,
  uncertainty: 0.2,
  evidence: "printed on back",
});

const inferred = (value: string) => ({
  value,
  status: "inferred" as const,
  uncertainty: 0.7,
  evidence: "guess",
});

const unknown = {
  value: null,
  status: "unknown" as const,
  uncertainty: 1,
  evidence: null,
};

describe("visionObservedFields", () => {
  it("copies observed fields and drops inferred guesses", () => {
    const extract = VisionExtractSchema.parse({
      playerOrCharacter: observed("Baker Mayfield"),
      year: observed("2021"),
      manufacturer: observed("Panini"),
      brand: observed("Donruss"),
      productSet: inferred("Donruss Rated Rookie"),
      cardNumber: observed("195"),
      team: unknown,
      rookie: inferred("true"),
      insertSubset: unknown,
      possibleParallel: inferred("Silver"),
      serialNumber: unknown,
      autograph: unknown,
      relic: unknown,
      notes: [],
    });
    const fields = visionObservedFields(extract);
    expect(fields.playerOrCharacter.value).toBe("Baker Mayfield");
    expect(fields.year.value).toBe("2021");
    expect(fields.collectorNumber.value).toBe("195");
    expect(fields.setName.value).toBeNull();
    expect(fields.parallel.value).toBeNull();
    expect(fields.rookie.value).toBeNull();
  });
});

describe("shouldRunVision", () => {
  it("skips when privileged OCR is complete in auto mode", () => {
    const prev = process.env.VIP_SCAN_VISION;
    process.env.VIP_SCAN_VISION = "auto";
    expect(shouldRunVision(true)).toBe(false);
    expect(shouldRunVision(false)).toBe(true);
    process.env.VIP_SCAN_VISION = "off";
    expect(shouldRunVision(false)).toBe(false);
    process.env.VIP_SCAN_VISION = "always";
    expect(shouldRunVision(true)).toBe(true);
    process.env.VIP_SCAN_VISION = prev;
  });
});
