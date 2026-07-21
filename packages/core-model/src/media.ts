import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";

export const IdObservationSchema = BaseRecordSchema.extend({
  predictedAssetId: UuidSchema.nullable().optional(),
  predictedConfidence: z.number().min(0).max(1).nullable().optional(),
  confirmedAssetId: UuidSchema.nullable().optional(),
  wasCorrect: z.boolean().nullable().optional(),
  imageUrl: z.string().min(1),
  ocrText: z.string().nullable().optional(),
  storeId: UuidSchema.nullable().optional(),
  captureFrames: z.number().int().positive().default(1),
});
export type IdObservation = z.infer<typeof IdObservationSchema>;

export const CaptureSessionSchema = BaseRecordSchema.extend({
  device: z.string().nullable().optional(),
  calibrationRef: z.string().nullable().optional(),
  modelVersion: z.string().min(1),
  tenantId: UuidSchema.nullable().optional(),
});
export type CaptureSession = z.infer<typeof CaptureSessionSchema>;

export const CaptureImageSchema = BaseRecordSchema.extend({
  sessionId: UuidSchema,
  contentHash: z.string().min(1),
  storageRef: z.string().min(1),
  preprocessingSteps: z.array(z.string()).default([]),
});
export type CaptureImage = z.infer<typeof CaptureImageSchema>;
