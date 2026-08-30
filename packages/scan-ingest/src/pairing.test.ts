import { describe, expect, it } from "vitest";
import { pairPagesForReview } from "./pairing.js";
import type { DevicePage } from "./adapters/types.js";

function page(name: string, hash: string, seq: number): DevicePage {
  return {
    storageRef: `/tmp/${name}`,
    contentHash: hash,
    mimeType: "image/jpeg",
    face: "unknown",
    fileName: name,
    discoveredAt: new Date(),
    sequence: seq,
  };
}

describe("pairPagesForReview", () => {
  it("pairs sequential duplex without guessing a missing back", () => {
    const d = pairPagesForReview(
      [
        page("img001.jpg", "a", 0),
        page("img002.jpg", "b", 1),
        page("img003.jpg", "c", 2),
      ],
      { strategy: "sequential_duplex" },
    );
    expect(d.units).toHaveLength(2);
    expect(d.units[1]?.back).toBeUndefined();
    expect(d.needsReview[1]).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/missing back|odd page/i);
  });

  it("pairs labeled front/back on the same stem", () => {
    const d = pairPagesForReview(
      [
        page("1986_topps_michael_jordan_57_front.jpg", "aa", 0),
        page("1986_topps_michael_jordan_57_back.jpg", "bb", 1),
      ],
      { strategy: "filename_front_back" },
    );
    expect(d.units).toHaveLength(1);
    expect(d.units[0]?.back).toBeTruthy();
    expect(d.needsReview[0]).toBe(false);
    expect(d.pairingConfidence[0]).toBeGreaterThan(0.9);
  });

  it("flags two fronts labeled on the same stem", () => {
    const d = pairPagesForReview(
      [
        page("card_front.jpg", "x", 0),
        page("card_recto.jpg", "y", 1),
      ],
      { strategy: "filename_front_back" },
    );
    expect(d.needsReview[0]).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/two fronts/i);
  });
});
