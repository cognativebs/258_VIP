import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { identifyFromPairedImages } from "./identifyFromImages.js";
import { spansFromTextBlock } from "./ocr/classifyOcr.js";
import { ocrAvailable, type OcrResult } from "./ocr/tesseractOcr.js";
import { isGenericScanFileName } from "./identify.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "pixel-baker");

function ocrFromText(text: string): OcrResult {
  const spans = spansFromTextBlock(text);
  return {
    text,
    confidence: 0.7,
    engine: "test",
    ms: 0,
    spans,
  };
}

describe("identifyFromPairedImages", () => {
  it("treats PaperStream IMG_#### names as non-identity", () => {
    expect(isGenericScanFileName("IMG_0001.jpg")).toBe(true);
    expect(isGenericScanFileName("1986_topps_michael_jordan_57_front.jpg")).toBe(false);
  });

  it("OCRs pixels on generic filenames and produces a base candidate", async () => {
    if (!ocrAvailable()) {
      console.warn("skipping pixel OCR: tesseract not on PATH");
      return;
    }
    process.env.VIP_SCAN_VISION = "off";
    const result = await identifyFromPairedImages({
      frontPath: join(FIXTURE, "IMG_0001.jpg"),
      backPath: join(FIXTURE, "IMG_0002.jpg"),
      frontFileName: "IMG_0001.jpg",
      backFileName: "IMG_0002.jpg",
      categoryHint: "sports",
    });
    expect(result.backOcr.text.length).toBeGreaterThan(8);
    expect(result.candidates[0]?.playerOrCharacter).toMatch(/Mayfield|Baker/i);
    expect(result.candidates[0]?.collectorNumber).toBe("195");
    expect(result.evidence.fused.year.value).toBe("2021");
    expect(result.usedVision).toBe(false);
    expect(result.evidence.debug?.whyWon).toMatch(/structured/i);
    expect(result.evidence.debug?.rawOcr.backSpans.length).toBeGreaterThan(0);
  });

  it("does not promote biography OCR into the player field", async () => {
    process.env.VIP_SCAN_VISION = "off";
    const result = await identifyFromPairedImages({
      frontPath: "/tmp/unused-front.jpg",
      backPath: "/tmp/unused-back.jpg",
      frontFileName: "IMG_0001.jpg",
      backFileName: "IMG_0002.jpg",
      categoryHint: "sports",
      ocrOverride: {
        front: ocrFromText("2021 Panini #0001 Houston Brought In Tyrod"),
        back: ocrFromText("Houston brought in Tyrod Taylor to start the season"),
      },
    });
    expect(result.evidence.fused.playerOrCharacter.value).toBeNull();
    expect(result.evidence.fused.year.value).toBe("2021");
    expect(result.evidence.fused.manufacturer.value).toBe("Panini");
    expect(result.evidence.fused.setName.value).not.toMatch(/Houston|Brought|Tyrod/i);
    expect(result.candidates[0]?.playerOrCharacter ?? null).toBeNull();
    expect(result.evidence.debug?.whyWon).toBeTruthy();
  });

  it("leaves unknown player on garbage OCR instead of using leftover tokens", async () => {
    process.env.VIP_SCAN_VISION = "off";
    const result = await identifyFromPairedImages({
      frontPath: "/tmp/unused-front.jpg",
      frontFileName: "IMG_0008.jpg",
      categoryHint: "sports",
      ocrOverride: {
        front: ocrFromText("2024 #8 Yer Ore Oo Ns"),
        back: ocrFromText("Pmreianm We Kz Ie"),
      },
    });
    expect(result.evidence.fused.playerOrCharacter.value).toBeNull();
    expect(result.evidence.fused.year.value).toBeTruthy();
    expect(result.evidence.debug?.candidatesConsidered).toBeDefined();
  });
});
