import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { identifyFromPairedImages } from "./identifyFromImages.js";
import { ocrAvailable } from "./ocr/tesseractOcr.js";
import { isGenericScanFileName } from "./identify.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "pixel-baker");

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
  });
});
