import { z } from "zod";
import { markInferred } from "@vip/evidence";
import { clamp, round2 } from "./math.js";
import { INTELLIGENCE_VERSION } from "./version.js";

/** 1–10 component scores. Dilution is a penalty subtracted after the blend. */
export const CohenScoreInputSchema = z.object({
  title: z.string().min(1),
  artistSignificance: z.number().min(1).max(10),
  characterStrength: z.number().min(1).max(10),
  imageIconicity: z.number().min(1).max(10),
  historicalImportance: z.number().min(1).max(10),
  trueScarcity: z.number().min(1).max(10),
  entryPrice: z.number().min(1).max(10),
  variantDilutionPenalty: z.number().min(0).max(5),
});
export type CohenScoreInput = z.infer<typeof CohenScoreInputSchema>;

export const CohenActionSchema = z.enum([
  "buy_cheap",
  "investigate",
  "museum_hold",
  "pass_variant_crowd",
]);
export type CohenAction = z.infer<typeof CohenActionSchema>;

export const CohenScoreResultSchema = z.object({
  title: z.string(),
  artistSignificance: z.number(),
  characterStrength: z.number(),
  imageIconicity: z.number(),
  historicalImportance: z.number(),
  trueScarcity: z.number(),
  entryPrice: z.number(),
  variantDilutionPenalty: z.number(),
  geometricMean: z.number(),
  cohenScore: z.number(),
  action: CohenActionSchema,
  rationale: z.string(),
  provenance: z.object({
    source: z.string(),
    method: z.string(),
    ruleOrModelVersion: z.string(),
    confidence: z.number(),
    verificationStatus: z.string(),
    notes: z.string().optional(),
  }),
});
export type CohenScoreResult = z.infer<typeof CohenScoreResultSchema>;

/**
 * Geometric mean of the six 1–10 factors, minus variant-dilution penalty.
 * Components stay queryable — never a single opaque "buy Cohen" number.
 */
export function scoreCohenCover(raw: CohenScoreInput): CohenScoreResult {
  const input = CohenScoreInputSchema.parse(raw);
  const product =
    input.artistSignificance *
    input.characterStrength *
    input.imageIconicity *
    input.historicalImportance *
    input.trueScarcity *
    input.entryPrice;
  const geometricMean = round2(product ** (1 / 6));
  const cohenScore = round2(clamp(geometricMean - input.variantDilutionPenalty, 0, 10));

  let action: CohenAction = "investigate";
  if (input.trueScarcity <= 4 && input.entryPrice >= 8 && input.imageIconicity >= 8) {
    action = "buy_cheap";
  } else if (input.variantDilutionPenalty >= 3 && input.trueScarcity <= 4) {
    action = "pass_variant_crowd";
  } else if (cohenScore >= 7 && input.trueScarcity >= 7 && input.historicalImportance >= 7) {
    action = "museum_hold";
  } else if (cohenScore < 5) {
    action = "pass_variant_crowd";
  }

  const rationale =
    action === "buy_cheap"
      ? "Gorgeous / recognizable art at a cheap ask — do not chase; buy the $10–$20 copy."
      : action === "museum_hold"
        ? "Early + iconic + documented scarcity — museum-tier, not completionism."
        : action === "pass_variant_crowd"
          ? "Manufactured SKU scarcity (exclusive/virgin/foil permutations). Do not pay $50–100 for the word exclusive."
          : "Investigate print run and sold comps before paying up.";

  return CohenScoreResultSchema.parse({
    ...input,
    geometricMean,
    cohenScore,
    action,
    rationale,
    provenance: markInferred({
      source: "cohen_cover_score",
      ruleOrModelVersion: INTELLIGENCE_VERSION,
      confidence: 0.55,
      notes: "Component scores are opinion · unverified. Print runs and sold comps must be checked before capital.",
    }),
  });
}

/** Conversation fixtures — scores from the 2026-08-15 Cohen thesis, not live comps. */
export const COHEN_IVY9_FIXTURE: CohenScoreInput = {
  title: "Poison Ivy #9 Harley/Ivy",
  artistSignificance: 9,
  characterStrength: 9,
  imageIconicity: 10,
  historicalImportance: 7,
  trueScarcity: 3,
  entryPrice: 10,
  variantDilutionPenalty: 3,
};

export const COHEN_DIENAMITE_FIXTURE: CohenScoreInput = {
  title: "Die!Namite #1 Red Sonja Virgin LTD 500",
  artistSignificance: 8,
  characterStrength: 8,
  imageIconicity: 8,
  historicalImportance: 9,
  trueScarcity: 9,
  entryPrice: 9,
  variantDilutionPenalty: 1,
};
