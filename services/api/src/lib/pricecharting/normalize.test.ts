import { describe, expect, it } from "vitest";
import {
  extractComicYear,
  extractVolumeNumber,
  hasVolumeDesignator,
  variantCompatibility,
  variantTokens,
  variantsCompatible,
  volumeEraMismatch,
} from "./normalize.js";

describe("variantCompatibility", () => {
  it("is directional: vendor-plain/asset-tokened is review, reverse is incompatible", () => {
    expect(variantCompatibility(new Set(), new Set())).toBe("compatible");
    expect(variantCompatibility(new Set(), variantTokens("Absolute Batman #1 Virgin"))).toBe(
      "incompatible",
    );
    expect(variantCompatibility(variantTokens("Cover B"), new Set())).toBe("compatible_review");
    expect(variantsCompatible(variantTokens("Cover B"), new Set())).toBe(true);
    expect(variantCompatibility(variantTokens("Virgin"), variantTokens("Absolute Batman #1 Virgin"))).toBe(
      "compatible",
    );
    expect(variantCompatibility(variantTokens("Virgin"), variantTokens("Newsstand"))).toBe("incompatible");
  });
});

describe("volumeEraMismatch", () => {
  it("demotes a later volume mapped onto an earlier-era vendor year", () => {
    expect(
      volumeEraMismatch({
        seriesTitle: "Action Comics, Vol. 2",
        seriesVolume: 1,
        yearBegan: 2011,
        vendorProductName: "Action Comics #20 (1940)",
        vendorConsoleName: "Comic Books Action Comics",
      }),
    ).toBe(true);
  });

  it("keeps a Vol. 2 issue inside the start window", () => {
    expect(
      volumeEraMismatch({
        seriesTitle: "Action Comics, Vol. 2",
        seriesVolume: 1,
        yearBegan: 2011,
        vendorProductName: "Action Comics #51 (2016)",
        vendorConsoleName: "Comic Books Action Comics",
      }),
    ).toBe(false);
  });

  it("does not flag titles without a volume designator", () => {
    expect(
      volumeEraMismatch({
        seriesTitle: "Spawn",
        seriesVolume: 1,
        yearBegan: 1992,
        vendorProductName: "Spawn #9 (1993)",
        vendorConsoleName: "Comic Books Spawn",
      }),
    ).toBe(false);
  });
});

describe("extractors", () => {
  it("reads volume and year from common catalog strings", () => {
    expect(extractVolumeNumber("Deadpool, Vol. 4")).toBe(4);
    expect(hasVolumeDesignator("Deadpool, Vol. 4", 1)).toBe(true);
    expect(extractComicYear("Action Comics #20 (1940)")).toBe(1940);
  });
});
