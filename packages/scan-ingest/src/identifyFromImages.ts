import type { CardIdentityEvidence, IdentificationDebug } from "@vip/core-model";
import { field } from "@vip/core-model";
import {
  baseVsParallelFromEvidence,
  fieldsFromStructuredOcr,
  fuseCardEvidence,
  fuseIdentitySides,
  overlayIdentityFields,
  structuredIdentityQuery,
} from "./evidenceFusion.js";
import { identifyUnit, isGenericScanFileName } from "./identify.js";
import {
  extractStructuredFromOcr,
  privilegedOcrIsComplete,
  spansFromTextBlock,
  type OcrSpan,
} from "./ocr/classifyOcr.js";
import { ocrImageFile, type OcrResult } from "./ocr/tesseractOcr.js";
import type { IdentityCandidate, ScanCategory } from "./schemas.js";
import {
  extractVisionEvidence,
  shouldRunVision,
  visionObservedFields,
  type VisionExtract,
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

const EMPTY_OCR: OcrResult = {
  text: "",
  confidence: 0,
  engine: "none",
  ms: 0,
  spans: [],
};

function mergeSpans(primary: OcrSpan[], extraText: string | undefined): OcrSpan[] {
  return [...primary, ...spansFromTextBlock(extraText ?? "")];
}

function applyCatalogFill(
  fused: CardIdentityEvidence["fused"],
  candidate: IdentityCandidate | undefined,
  conflicts: string[],
): CardIdentityEvidence["fused"] {
  if (!candidate || conflicts.length > 0) return fused;
  const yearOk =
    !fused.year.value ||
    candidate.year == null ||
    fused.year.value === String(candidate.year);
  const numberOk =
    !fused.collectorNumber.value ||
    !candidate.collectorNumber ||
    fused.collectorNumber.value.toLowerCase() === candidate.collectorNumber.toLowerCase();
  const playerOk =
    !fused.playerOrCharacter.value ||
    !candidate.playerOrCharacter ||
    fused.playerOrCharacter.value.toLowerCase().includes(
      candidate.playerOrCharacter.toLowerCase(),
    ) ||
    candidate.playerOrCharacter.toLowerCase().includes(
      fused.playerOrCharacter.value.toLowerCase(),
    );
  if (!yearOk || !numberOk || !playerOk) return fused;

  const out = { ...fused };
  if (!out.setName.value && candidate.setName) {
    out.setName = field(candidate.setName, candidate.confidence, "catalog");
  }
  if (!out.year.value && candidate.year) {
    out.year = field(String(candidate.year), candidate.confidence, "catalog");
  }
  if (!out.collectorNumber.value && candidate.collectorNumber) {
    out.collectorNumber = field(candidate.collectorNumber, candidate.confidence, "catalog");
  }
  const catalogRow = Boolean(
    candidate.catalogKey && !candidate.catalogKey.startsWith("sports:parsed:"),
  );
  if (!out.playerOrCharacter.value && candidate.playerOrCharacter && catalogRow) {
    out.playerOrCharacter = field(
      candidate.playerOrCharacter,
      candidate.confidence,
      "catalog",
    );
  }
  return out;
}

function whyWon(
  winner: IdentityCandidate | undefined,
  query: string,
  usedVision: boolean,
): string {
  if (!winner) {
    return query
      ? "structured evidence produced a query but no candidate ranked"
      : "no privileged OCR/vision fields; unknown is valid";
  }
  if (winner.catalogKey.startsWith("sports:parsed:")) {
    return usedVision
      ? "vision observed fields + privileged OCR; sports-parsed candidate from structured query (not a catalog fabrication)"
      : "privileged OCR/filename fields; sports-parsed candidate from structured query (not a catalog fabrication)";
  }
  return `catalog ${winner.catalogKey} agreed with observed year/number/player`;
}

function debugBundle(input: {
  frontOcrText: string;
  backOcrText: string;
  frontSpans: OcrSpan[];
  backSpans: OcrSpan[];
  vision: VisionExtract | null;
  candidates: IdentityCandidate[];
  winner: IdentityCandidate | undefined;
  whyWon: string;
  baseConfidence: number;
  parallelConfidence: number;
}): IdentificationDebug {
  const toDebug = (c: IdentityCandidate) => ({
    catalogKey: c.catalogKey,
    displayName: c.displayName,
    confidence: c.confidence,
    matchReasons: c.matchReasons,
  });
  return {
    rawOcr: {
      front: input.frontOcrText,
      back: input.backOcrText,
      frontSpans: input.frontSpans,
      backSpans: input.backSpans,
    },
    structuredVision: input.vision,
    candidatesConsidered: input.candidates.map(toDebug),
    winningCandidate: input.winner ? toDebug(input.winner) : null,
    whyWon: input.whyWon,
    baseConfidence: input.baseConfidence,
    parallelConfidence: input.parallelConfidence,
  };
}

/**
 * Paired images → structured visual/OCR evidence → candidates → reconcile.
 * Raw OCR is never the identity engine.
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
  /** Test hook — skip file OCR. */
  ocrOverride?: { front: OcrResult; back: OcrResult };
}): Promise<ImageIdResult> {
  const notes: string[] = [];
  const frontOcr = input.ocrOverride?.front ?? (await ocrImageFile(input.frontPath, input.frontHash));
  const backOcr = input.ocrOverride?.back
    ?? (input.backPath
      ? await ocrImageFile(input.backPath, input.backHash)
      : EMPTY_OCR);

  if (frontOcr.engine === "unavailable" && backOcr.engine === "unavailable") {
    notes.push("OCR engine unavailable — install Tesseract-OCR or set VIP_SCAN_TESSERACT");
  }

  const frontName = input.frontFileName ?? input.frontPath;
  const backName = input.backFileName ?? input.backPath ?? "";
  const frontFile = isGenericScanFileName(frontName) ? "" : frontName;
  const backFile = isGenericScanFileName(backName) ? "" : backName;

  const frontSpans = mergeSpans(frontOcr.spans, input.sidecarFront);
  const backSpans = mergeSpans(backOcr.spans, input.sidecarBack);
  const frontExtract = extractStructuredFromOcr(frontSpans);
  const backExtract = extractStructuredFromOcr(backSpans);

  let evidence = fuseIdentitySides({
    front: fieldsFromStructuredOcr(frontExtract, "front_ocr"),
    back: fieldsFromStructuredOcr(backExtract, "back_ocr"),
  });

  const privilegedComplete =
    privilegedOcrIsComplete(frontExtract) ||
    privilegedOcrIsComplete(backExtract);

  let usedVision = false;
  let visionModel = "";
  let estimatedCostUsd = 0;
  let visionExtract: VisionExtract | null = null;

  if (shouldRunVision(privilegedComplete)) {
    try {
      const vision = await extractVisionEvidence({
        frontPath: input.frontPath,
        backPath: input.backPath,
      });
      estimatedCostUsd = vision.estimatedCostUsd;
      visionModel = vision.model;
      if (vision.skipped) notes.push(vision.skipped);
      if (vision.extract) {
        usedVision = true;
        visionExtract = vision.extract;
        const observed = visionObservedFields(vision.extract, "front_vision");
        evidence = {
          ...evidence,
          fused: overlayIdentityFields(
            evidence.fused,
            observed,
            evidence.conflictNotes,
            "vision",
          ),
        };
        notes.push(`${SCAN_NOTE_VISION}${vision.model}`);
      }
    } catch (e) {
      notes.push(`vision failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (privilegedComplete) {
    notes.push("vision skipped: privileged OCR already complete");
  }

  const fileEvidence = fuseCardEvidence({
    frontText: frontFile,
    backText: backFile,
    frontOrigin: "front_text",
    backOrigin: "back_text",
  });
  evidence.conflictNotes.push(...fileEvidence.conflictNotes);
  evidence = {
    ...evidence,
    fused: overlayIdentityFields(
      evidence.fused,
      fileEvidence.fused,
      evidence.conflictNotes,
      "filename",
    ),
  };

  const query = structuredIdentityQuery(evidence.fused);
  const candidates = identifyUnit(
    {
      ocrText: query,
      frontStorageRef: frontName,
      categoryHint: input.categoryHint ?? null,
    },
    { catalog: [], categoryHint: input.categoryHint ?? null },
  );

  evidence = {
    ...evidence,
    fused: applyCatalogFill(evidence.fused, candidates[0], evidence.conflictNotes),
  };

  const split = baseVsParallelFromEvidence(evidence);
  const winner = candidates[0];
  const reason = whyWon(winner, query, usedVision);
  evidence.debug = debugBundle({
    frontOcrText: frontOcr.text,
    backOcrText: backOcr.text,
    frontSpans,
    backSpans,
    vision: visionExtract,
    candidates,
    winner,
    whyWon: reason,
    baseConfidence: split.baseConfidence,
    parallelConfidence: split.parallelConfidence,
  });

  return {
    frontOcr,
    backOcr,
    frontText: frontOcr.text,
    backText: backOcr.text,
    evidence,
    candidates,
    usedVision,
    visionModel,
    estimatedCostUsd,
    notes,
  };
}

const SCAN_NOTE_VISION = "vision:";
