import { markInferred } from "@vip/evidence";
import { DISPOSITION_RULE } from "./constants.js";
import type {
  DispositionRecommendation,
  SellingAssetInput,
  SellingDisposition,
} from "./schemas.js";
import { SellingAssetInputSchema } from "./schemas.js";

export type DispositionOverride = {
  disposition: SellingDisposition;
  reasonText: string;
  actor?: "USER" | "ORCHESTR8";
};

/**
 * Rule-based selling disposition. Not a black-box model.
 * Human override always wins and must be logged by the caller.
 */
export function recommendDisposition(
  raw: SellingAssetInput,
  override?: DispositionOverride,
): DispositionRecommendation {
  const asset = SellingAssetInputSchema.parse(raw);
  if (override) {
    return pack(override.disposition, 1, ["USER_OVERRIDE"], override.reasonText, override.actor ?? "USER");
  }

  if (asset.salesPathState === "sold") {
    return pack("HOLD", 0.99, ["ALREADY_SOLD"], "Already sold — do not relist.");
  }
  if (asset.ownershipBucket === "personal_collection" || asset.pcThesis) {
    return pack("PC", 0.9, ["PERSONAL_COLLECTION"], "Personal collection / PC thesis — not for routine sale.");
  }
  if (asset.gradeThesis) {
    return pack("GRADE", 0.78, ["GRADE_THESIS"], "Grade thesis set — hold for slab before any sales path.");
  }
  if (asset.holdThesis) {
    return pack("HOLD", 0.8, ["HOLD_THESIS"], "Hold thesis overrides listing until the operator lifts it.");
  }

  const fmv = asset.fmv?.mid ?? null;
  if (fmv == null) {
    return pack("REVIEW", 0.35, ["FMV_MISSING"], "No FMV range or snapshot — review before any listing path.");
  }

  const demand =
    asset.strongPlayerDemand ||
    asset.playerTier === "star" ||
    asset.rookieFlag ||
    asset.autographFlag;
  const searchable = asset.strongSearchability || Boolean(asset.playerSubject && asset.setName);

  if (fmv < 2) {
    if (asset.relatedLotCount >= 4) {
      return pack(
        "LOT",
        0.82,
        ["FMV_LT_2", "RELATED_INVENTORY"],
        `FMV $${fmv.toFixed(2)} is below $2 — default LOT with related inventory.`,
      );
    }
    return pack(
      "BULK",
      0.74,
      ["FMV_LT_2", "NO_COHERENT_LOT"],
      `FMV $${fmv.toFixed(2)} is below $2 and no coherent lot cluster — BULK.`,
    );
  }

  if (fmv < 5) {
    if (demand && searchable) {
      return pack(
        "SINGLE",
        0.7,
        ["FMV_2_5", "STAR_PLAYER", "HIGH_SEARCHABILITY"],
        `FMV $${fmv.toFixed(2)} is $2–$5 with demand + searchability — consider SINGLE.`,
      );
    }
    return pack(
      "LOT",
      0.76,
      ["FMV_2_5", "LOW_INDIVIDUAL_ECONOMICS"],
      `FMV $${fmv.toFixed(2)} is $2–$5 without strong demand — LOT.`,
    );
  }

  if (fmv < 15) {
    return pack(
      "SINGLE",
      0.8,
      ["FMV_GT_5"],
      `FMV $${fmv.toFixed(2)} is $5–$15 — default SINGLE.`,
    );
  }

  const extras: string[] = ["FMV_GTE_15"];
  if (asset.playerTier === "star") extras.push("STAR_PLAYER");
  if (asset.serialNumber) extras.push("SERIAL_NUMBERED");
  if (asset.autographFlag) extras.push("AUTOGRAPH");
  return pack(
    "SINGLE",
    0.86,
    extras,
    `FMV $${fmv.toFixed(2)} is ≥ $15 — SINGLE unless a HOLD/GRADE/PC thesis is set.`,
  );
}

function pack(
  disposition: SellingDisposition,
  confidence: number,
  reasonCodes: string[],
  reasonText: string,
  recommendedBy: DispositionRecommendation["recommendedBy"] = "RULE",
): DispositionRecommendation {
  return {
    disposition,
    confidence,
    reasonCodes,
    reasonText,
    recommendedBy,
    ruleOrModelVersion: DISPOSITION_RULE,
    provenance: markInferred({
      source: "disposition_engine",
      ruleOrModelVersion: DISPOSITION_RULE,
      confidence,
      notes: reasonText,
    }),
  };
}

export function dispositionToDecisionAction(
  disposition: SellingDisposition,
): "Hold" | "Grade" | "Sell" | "Lot" | "Pass" {
  switch (disposition) {
    case "PC":
    case "HOLD":
    case "LCS_SHOW":
    case "REVIEW":
      return "Hold";
    case "GRADE":
      return "Grade";
    case "SINGLE":
      return "Sell";
    case "LOT":
    case "BULK":
      return "Lot";
    case "DONATE":
      return "Pass";
  }
}
