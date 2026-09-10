import {
  IdObservationRecordSchema,
  type IdObservationRecord,
} from "./resolver-schemas.js";
import type { IdentityCandidate } from "../schemas.js";

/**
 * Build the `vault_market.id_observation` row written on resolve.
 *
 * `was_correct` stays null when the top candidate had no asset id yet —
 * creating an asset on confirm is not evidence the prediction was right.
 */
export function buildIdObservation(input: {
  predicted: IdentityCandidate | null | undefined;
  confirmedAssetId: string;
  imageUrl: string;
  ocrText?: string | null;
}): IdObservationRecord {
  const predictedAssetId = input.predicted?.assetId ?? null;
  const predictedConfidence =
    input.predicted != null ? input.predicted.confidence : null;
  const wasCorrect =
    predictedAssetId != null
      ? predictedAssetId === input.confirmedAssetId
      : null;

  return IdObservationRecordSchema.parse({
    predictedAssetId,
    predictedConfidence,
    confirmedAssetId: input.confirmedAssetId,
    wasCorrect,
    imageUrl: input.imageUrl || `scan-unit:${input.confirmedAssetId}`,
    ocrText: input.ocrText ?? null,
  });
}
