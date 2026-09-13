import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";

/** PC-CORE-01 evidence classes. vendor_derived ceiling 0.75 is load-bearing. */
export const EvidenceClassKeySchema = z.enum([
  "observed",
  "normalized",
  "vendor_derived",
  "inferred",
  "opinion",
]);
export type EvidenceClassKey = z.infer<typeof EvidenceClassKeySchema>;

export const EvidenceClassSchema = z.object({
  evidenceClass: EvidenceClassKeySchema,
  description: z.string().min(1),
  isFactual: z.boolean(),
  confidenceCeiling: z.number().min(0).max(1),
});
export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;

export const EVIDENCE_CLASS_CEILING: Record<EvidenceClassKey, number> = {
  observed: 1.0,
  normalized: 0.95,
  vendor_derived: 0.75,
  inferred: 0.7,
  opinion: 0.6,
};

export function confidenceCeilingFor(classes: EvidenceClassKey[]): number {
  if (classes.length === 0) return EVIDENCE_CLASS_CEILING.opinion;
  return Math.min(...classes.map((c) => EVIDENCE_CLASS_CEILING[c]));
}

export const DataSourceAccessMethodSchema = z.enum([
  "rest_api",
  "bulk_csv",
  "scraper",
  "manual",
]);
export type DataSourceAccessMethod = z.infer<typeof DataSourceAccessMethodSchema>;

export const DataSourceKeySchema = z.enum(["pricecharting", "ebay_browse"]);
export type DataSourceKey = z.infer<typeof DataSourceKeySchema>;

export const DataSourceSchema = z.object({
  dataSourceId: z.number().int().positive(),
  sourceKey: DataSourceKeySchema,
  displayName: z.string().min(1),
  accessMethod: DataSourceAccessMethodSchema,
  defaultEvidenceClass: EvidenceClassKeySchema,
  termsUrl: z.string().url().nullable().optional(),
  redistributionAllowed: z.boolean(),
  latencyMinutes: z.number().int().nonnegative().nullable().optional(),
  categoryCoverage: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  historicalAccuracy: z.number().min(0).max(1).nullable().optional(),
  accuracySampleN: z.number().int().nonnegative().default(0),
  accuracyComputedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type DataSource = z.infer<typeof DataSourceSchema>;

export const VendorMatchMethodSchema = z.enum([
  "upc",
  "exact_name",
  "trgm",
  "manual",
  "unmatched",
]);
export type VendorMatchMethod = z.infer<typeof VendorMatchMethodSchema>;

export const TRGM_MATCH_FLOOR = 0.82;
export const UPC_MATCH_CONFIDENCE = 0.98;
export const EXACT_NAME_MATCH_CONFIDENCE = 0.9;
export const VENDOR_MATCH_RULE = "vendor-product-map@0.1.0";

export const VendorProductMapSchema = BaseRecordSchema.extend({
  dataSourceId: z.number().int().positive(),
  vendorProductId: z.string().min(1),
  vendorProductName: z.string().min(1),
  vendorConsoleName: z.string().nullable().optional(),
  vendorUpc: z.string().nullable().optional(),
  pricedUnitId: UuidSchema.nullable(),
  assetId: UuidSchema.nullable(),
  matchMethod: VendorMatchMethodSchema,
  matchConfidence: z.number().min(0).max(1).nullable(),
  needsReview: z.boolean(),
  confirmedAt: z.coerce.date().nullable().optional(),
  confirmedBy: z.string().nullable().optional(),
  firstSeenAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  providerIds: z.record(z.string()).default({}),
}).superRefine((row, ctx) => {
  if (!row.needsReview && !["upc", "exact_name", "manual"].includes(row.matchMethod)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "needs_review may be false only for upc, exact_name, or manual",
      path: ["needsReview"],
    });
  }
  if (
    row.matchMethod !== "unmatched" &&
    row.pricedUnitId == null &&
    row.assetId == null &&
    row.matchMethod !== "trgm"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "matched rows need pricedUnitId or assetId (trgm may queue without a unit)",
      path: ["pricedUnitId"],
    });
  }
});
export type VendorProductMap = z.infer<typeof VendorProductMapSchema>;
