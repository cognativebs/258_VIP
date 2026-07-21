import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";

/**
 * Owned copy-group. Catalog identity lives on Asset — never call a Holding an Asset.
 *
 * Grade 0.0 / raw: gradeRating=null, assumedGrade="NM" with inferred · unverified provenance.
 */
export const HoldingSchema = BaseRecordSchema.extend({
  tenantId: UuidSchema.optional(),
  assetId: UuidSchema,
  quantity: z.number().int().positive().default(1),
  purchasePrice: z.number().nonnegative().nullable().optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  location: z.string().nullable().optional(),
  slabStatus: z.enum(["raw", "slabbed", "pending"]).nullable().optional(),
  /** Inferred label only (e.g. NM) — never a fake numeric grade. */
  assumedGrade: z.string().nullable().optional(),
  /** Observed numeric grade if known; null when unverified / 0.0 raw. */
  gradeRating: z.number().nullable().optional(),
  collectionPillar: z.string().nullable().optional(),
  museumScore: z.number().nullable().optional(),
  investmentScore: z.number().nullable().optional(),
  liquidityScore: z.number().nullable().optional(),
  recommendationLabel: z.string().nullable().optional(),
  sellPriority: z.enum(["High", "Medium", "Low"]).nullable().optional(),
  upgradeCandidate: z.boolean().default(false),
  needsGrading: z.boolean().default(false),
  needsPhoto: z.boolean().default(false),
  needsVerification: z.boolean().default(false),
  verificationNotes: z.string().nullable().optional(),
  valueLocked: z.boolean().default(false),
  currentPriceSnapshot: z.number().nullable().optional(),
  /** Import adapter id, e.g. clz_import */
  source: z.string().min(1),
  sourceRowId: z.string().min(1),
  rawSnapshotId: UuidSchema.optional(),
});
export type Holding = z.infer<typeof HoldingSchema>;
