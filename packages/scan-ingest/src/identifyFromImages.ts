import type { CardIdentityEvidence } from "@vip/core-model";
import { fuseCardEvidence, baseVsParallelFromEvidence } from "./evidenceFusion.js";
import { identifyUnit, isGenericScanFileName } from "./identify.js";
import { ocrImageFile, type OcrResult } from "./ocr/tesseractOcr.js";
import type { IdentityCandidate, ScanCategory } from "./schemas.js";
import {
  extractVisionEvidence,
  shouldEscalateToVision,
} from "./vision/structuredVision.js";

export type ImageIdResult = {
  frontOcr: OcrResult;
  backOcr: OcrResult;
  frontText: string;
  backText: string;
  evidence: CardIdentityEvidence;
  candidates: IdentityCandidate[];
  usedVision: boolean;
  visionModel: string;
  estimatedCostUsd: number;
  notes: string[];
};

function identityText(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * OCR both faces, optionally escalate to structured vision, then fuse + candidate.
 * Generic PaperStream filenames are never treated as identity evidence.
 */
export async function identifyFromPairedImages(input: {
  frontPath: string;
  backPath?: string | null;
  frontHash?: string;
  backHash?: string;
  sidecarFront?: string;
  sidecarBack?: string;
  frontFileName?: string;
  backFileName?: string;
  categoryHint?: ScanCategory | null;
}): Promise<ImageIdResult> {
  const notes: string[] = [];
  const frontOcr = await ocrImageFile(input.frontPath, input.frontHash);
  const backOcr = input.backPath
    ? await ocrImageFile(input.backPath, input.backHash)
    : { text: "", confidence: 0, engine: "none", ms: 0 };

  if (frontOcr.engine === "unavailable" && backOcr.engine === "unavailable") {
    notes.push("OCR engine unavailable — install Tesseract-OCR or set VIP_SCAN_TESSERACT");
  }

  const frontName = input.frontFileName ?? input.frontPath;
  const backName = input.backFileName ?? input.backPath ?? "";
  const frontFile = isGenericScanFileName(frontName) ? "" : frontName;
  const backFile = isGenericScanFileName(backName) ? "" : backName;

  let frontText = identityText([frontOcr.text, input.sidecarFront, frontFile]);
  let backText = identityText([backOcr.text, input.sidecarBack, backFile]);

  let evidence = fuseCardEvidence({
    frontText,
    backText,
    frontOrigin: frontOcr.text ? "front_ocr" : "front_text",
    backOrigin: backOcr.text ? "back_ocr" : "back_text",
  });
  let usedVision = false;
  let visionModel = "";
  let estimatedCostUsd = 0;

  const firstBase = baseVsParallelFromEvidence(evidence);
  if (shouldEscalateToVision(firstBase.baseConfidence, evidence.fused.playerOrCharacter.value)) {
    try {
      const vision = await extractVisionEvidence({
        frontPath: input.frontPath,
        backPath: input.backPath,
      });
      estimatedCostUsd = vision.estimatedCostUsd;
      visionModel = vision.model;
      if (vision.skipped) notes.push(vision.skipped);
      if (vision.textFront || vision.textBack) {
        usedVision = true;
        frontText = identityText([frontText, vision.textFront]);
        backText = identityText([backText, vision.textBack]);
        evidence = fuseCardEvidence({
          frontText,
          backText,
          frontOrigin: vision.textFront ? "front_vision" : "front_ocr",
          backOrigin: vision.textBack ? "back_vision" : "back_ocr",
        });
        notes.push(`${SCAN_NOTE_VISION}${vision.model}`);
      }
    } catch (e) {
      notes.push(`vision failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const candidates = identifyUnit(
    {
      ocrText: identityText([frontText, backText]),
      frontStorageRef: frontName,
      categoryHint: input.categoryHint ?? null,
    },
    { catalog: [], categoryHint: input.categoryHint ?? null },
  );

  return {
    frontOcr,
    backOcr,
    frontText,
    backText,
    evidence,
    candidates,
    usedVision,
    visionModel,
    estimatedCostUsd,
    notes,
  };
}

const SCAN_NOTE_VISION = "vision:";
