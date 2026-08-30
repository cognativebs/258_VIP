import { describe, expect, it } from "vitest";
import { pairPagesForReview, swapUnitFaces } from "./pairing.js";
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

  it("treats ADF order as back then front when face-up pairing is selected", () => {
    const d = pairPagesForReview(
      [
        page("IMG_0001.jpg", "a", 0),
        page("IMG_0002.jpg", "b", 1),
        page("IMG_0003.jpg", "c", 2),
        page("IMG_0004.jpg", "d", 3),
      ],
      { strategy: "sequential_duplex_back_first" },
    );
    expect(d.method).toBe("sequential_duplex_back_first");
    expect(d.units).toHaveLength(2);
    expect(d.units[0]?.front.fileName).toBe("IMG_0002.jpg");
    expect(d.units[0]?.back?.fileName).toBe("IMG_0001.jpg");
    expect(d.units[1]?.front.fileName).toBe("IMG_0004.jpg");
    expect(d.warnings.join(" ")).toMatch(/face-up ADF/i);
  });

  it("swapUnitFaces exchanges sides and does not invent a missing back", () => {
    const paired = pairPagesForReview(
      [page("IMG_0001.jpg", "a", 0), page("IMG_0002.jpg", "b", 1)],
      { strategy: "sequential_duplex" },
    ).units[0]!;
    const swapped = swapUnitFaces(paired);
    expect(swapped.front.contentHash).toBe("b");
    expect(swapped.back?.contentHash).toBe("a");
    expect(swapUnitFaces(swapped).front.contentHash).toBe("a");
    const single = pairPagesForReview([page("IMG_0001.jpg", "a", 0)], {
      strategy: "sequential_duplex",
    }).units[0]!;
    expect(swapUnitFaces(single).back).toBeUndefined();
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

  it("uses sequential duplex under auto when PaperStream names have no face labels", () => {
    const d = pairPagesForReview(
      [
        page("IMG_0001.jpg", "a", 0),
        page("IMG_0002.jpg", "b", 1),
        page("IMG_0003.jpg", "c", 2),
        page("IMG_0004.jpg", "d", 3),
      ],
      { strategy: "auto" },
    );
    expect(d.method).toBe("sequential_duplex");
    expect(d.units).toHaveLength(2);
    expect(d.units[0]?.back?.fileName).toBe("IMG_0002.jpg");
    expect(d.needsReview.every((n) => n === false)).toBe(true);
  });

  it("pairs a 23-card PaperStream lot (46 IMG_#### files) instead of 46 singles", () => {
    const pages = Array.from({ length: 46 }, (_, i) =>
      page(`IMG_${String(i + 1).padStart(4, "0")}.jpg`, `h${i}`, i),
    );
    const d = pairPagesForReview(pages, { strategy: "filename_front_back" });
    expect(d.method).toBe("sequential_duplex");
    expect(d.units).toHaveLength(23);
    expect(d.units.every((u) => u.back)).toBe(true);
    expect(d.needsReview.filter(Boolean)).toHaveLength(0);
  });

  it("falls back to sequential when filenames have no front/back labels", () => {
    const d = pairPagesForReview(
      [
        page("IMG_0001.jpg", "a", 0),
        page("IMG_0002.jpg", "b", 1),
        page("IMG_0003.jpg", "c", 2),
        page("IMG_0004.jpg", "d", 3),
      ],
      { strategy: "filename_front_back" },
    );
    expect(d.method).toBe("sequential_duplex");
    expect(d.units).toHaveLength(2);
    expect(d.units[0]?.back).toBeTruthy();
    expect(d.warnings.join(" ")).toMatch(/sequential duplex/i);
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
