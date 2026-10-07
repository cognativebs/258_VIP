import { z } from "zod";
import {
  MAP_INTEGRITY_ASK_MIN,
  MAP_INTEGRITY_RATIO_HIGH,
  MAP_INTEGRITY_RATIO_LOW,
  MAP_INTEGRITY_RULE,
} from "./phase-d.js";

export const MapIntegrityVerdictSchema = z.enum(["ok", "map_suspect"]);
export type MapIntegrityVerdict = z.infer<typeof MapIntegrityVerdictSchema>;

export const MapIntegrityInputSchema = z.object({
  listingCount: z.number().int().nonnegative(),
  medianAsk: z.number().nonnegative(),
  guideRaw: z.number().nonnegative(),
});
export type MapIntegrityInput = z.infer<typeof MapIntegrityInputSchema>;

export const MapIntegrityClassificationSchema = z.object({
  verdict: MapIntegrityVerdictSchema,
  ratio: z.number().nullable(),
  reason: z.string(),
  ruleOrModelVersion: z.literal(MAP_INTEGRITY_RULE),
});
export type MapIntegrityClassification = z.infer<typeof MapIntegrityClassificationSchema>;

/** Flags the vendor map, never the listing price. n<5 is not enough evidence. */
export function classifyMapIntegrity(input: MapIntegrityInput): MapIntegrityClassification {
  const row = MapIntegrityInputSchema.parse(input);
  if (row.listingCount < MAP_INTEGRITY_ASK_MIN || row.guideRaw <= 0 || row.medianAsk <= 0) {
    return MapIntegrityClassificationSchema.parse({
      verdict: "ok",
      ratio: row.guideRaw > 0 && row.medianAsk > 0 ? row.medianAsk / row.guideRaw : null,
      reason: "n<5 or missing ask/guide · map not scored",
      ruleOrModelVersion: MAP_INTEGRITY_RULE,
    });
  }
  const ratio = row.medianAsk / row.guideRaw;
  if (ratio < MAP_INTEGRITY_RATIO_LOW || ratio > MAP_INTEGRITY_RATIO_HIGH) {
    return MapIntegrityClassificationSchema.parse({
      verdict: "map_suspect",
      ratio,
      reason:
        ratio < MAP_INTEGRITY_RATIO_LOW
          ? `median_ask/guide_raw=${ratio.toFixed(4)} < ${MAP_INTEGRITY_RATIO_LOW} · flag map`
          : `median_ask/guide_raw=${ratio.toFixed(4)} > ${MAP_INTEGRITY_RATIO_HIGH} · flag map`,
      ruleOrModelVersion: MAP_INTEGRITY_RULE,
    });
  }
  return MapIntegrityClassificationSchema.parse({
    verdict: "ok",
    ratio,
    reason: "ask/guide inside [0.10, 10.0]",
    ruleOrModelVersion: MAP_INTEGRITY_RULE,
  });
}
