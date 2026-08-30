import { describe, expect, it } from "vitest";
import { baseVsParallelFromEvidence, fuseCardEvidence } from "./evidenceFusion.js";

describe("fuseCardEvidence", () => {
  it("uses both sides and keeps a weak parallel off the base score", () => {
    const ev = fuseCardEvidence({
      frontText: "2025_prizm_kurtis_rourke_397_silver_front.jpg",
      backText: "2025_prizm_kurtis_rourke_397_back.jpg",
    });
    expect(ev.fused.playerOrCharacter.value).toMatch(/Rourke/i);
    expect(ev.fused.year.value).toBe("2025");
    expect(ev.fused.collectorNumber.value).toBe("397");
    expect(ev.fused.parallel.value).toBe("Silver");
    const split = baseVsParallelFromEvidence(ev);
    expect(split.baseConfidence).toBeGreaterThan(split.parallelConfidence);
    expect(split.baseDisplayName).toMatch(/397/);
  });

  it("flags a year/player conflict instead of choosing a side", () => {
    const ev = fuseCardEvidence({
      frontText: "1986_topps_michael_jordan_57_front.jpg",
      backText: "1993_upper_deck_derek_jeter_449_back.jpg",
    });
    expect(ev.conflictNotes.join(" ")).toMatch(/year|player|number/i);
    expect(ev.fused.year.value).toBeNull();
    expect(ev.fused.playerOrCharacter.value).toBeNull();
  });

  it("prefers a complete back parse over foil-front OCR garbage", () => {
    const ev = fuseCardEvidence({
      frontText: "2025 PRIZM AMERICA FOOTBALL",
      backText: "2025 PANINI PRIZM FOOTBALL NO. 397 KURTIS ROURKE",
      frontOrigin: "front_ocr",
      backOrigin: "back_ocr",
    });
    expect(ev.conflictNotes).toEqual([]);
    expect(ev.fused.playerOrCharacter.value).toMatch(/Kurtis Rourke/i);
    expect(ev.fused.year.value).toBe("2025");
    expect(ev.fused.collectorNumber.value).toBe("397");
    expect(ev.fused.playerOrCharacter.origin).toBe("back_ocr");
    const split = baseVsParallelFromEvidence(ev);
    expect(split.baseDisplayName).toMatch(/Rourke/i);
    expect(split.baseConfidence).toBeGreaterThanOrEqual(0.8);
  });
});
