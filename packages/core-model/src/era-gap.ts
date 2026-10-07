import { z } from "zod";
import { ERA_AUDIT_RULE, ERA_GAP_YEARS } from "./phase-d.js";

export const EraGapVerdictSchema = z.enum(["ok", "era_gap", "unscored"]);
export type EraGapVerdict = z.infer<typeof EraGapVerdictSchema>;

export const EraGapClassificationSchema = z.object({
  verdict: EraGapVerdictSchema,
  yearBegan: z.number().int().nullable(),
  vendorYear: z.number().int().nullable(),
  gap: z.number().int().nullable(),
  direction: z.enum(["vendor_older", "vendor_newer", "same", "unscored"]),
  reason: z.string(),
  ruleOrModelVersion: z.literal(ERA_AUDIT_RULE),
});
export type EraGapClassification = z.infer<typeof EraGapClassificationSchema>;

/**
 * Reprint/original: vendor year is more than ERA_GAP_YEARS before series start.
 * Long-running series (vendor newer than year_began) stay ok.
 */
export function classifyEraGap(yearBegan: number | null, vendorYear: number | null): EraGapClassification {
  if (yearBegan == null || vendorYear == null) {
    return EraGapClassificationSchema.parse({
      verdict: "unscored",
      yearBegan,
      vendorYear,
      gap: null,
      direction: "unscored",
      reason: "missing series.year_began or vendor year",
      ruleOrModelVersion: ERA_AUDIT_RULE,
    });
  }
  const gap = yearBegan - vendorYear;
  const direction = gap > 0 ? "vendor_older" : gap < 0 ? "vendor_newer" : "same";
  if (gap > ERA_GAP_YEARS) {
    return EraGapClassificationSchema.parse({
      verdict: "era_gap",
      yearBegan,
      vendorYear,
      gap,
      direction,
      reason: `series.year_began ${yearBegan} − vendor ${vendorYear} = ${gap} > ${ERA_GAP_YEARS} · reprint/original map`,
      ruleOrModelVersion: ERA_AUDIT_RULE,
    });
  }
  return EraGapClassificationSchema.parse({
    verdict: "ok",
    yearBegan,
    vendorYear,
    gap,
    direction,
    reason:
      direction === "vendor_newer"
        ? "vendor newer than series start · long-running series, not demoted"
        : "era gap within 10 years",
    ruleOrModelVersion: ERA_AUDIT_RULE,
  });
}
