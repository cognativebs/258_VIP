import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";

export const CategoryKindSchema = z.enum([
  "pokemon",
  "sports",
  "mtg",
  "comic",
  "other",
]);
export type CategoryKind = z.infer<typeof CategoryKindSchema>;

export const CategorySchema = BaseRecordSchema.extend({
  kind: CategoryKindSchema,
  displayName: z.string().min(1),
  /** Legacy smallint id from vault_core.categories when synced. */
  legacyId: z.number().int().positive().optional(),
});
export type Category = z.infer<typeof CategorySchema>;

export const AssetFormatSchema = z.enum(["single", "sealed_product", "lot"]);
export type AssetFormat = z.infer<typeof AssetFormatSchema>;

export const AssetSchema = BaseRecordSchema.extend({
  categoryId: UuidSchema,
  format: AssetFormatSchema.default("single"),
  canonicalName: z.string().min(1),
  slug: z.string().min(1).nullable().optional(),
  baseAssetId: UuidSchema.nullable().optional(),
  releaseYear: z.number().int().min(1800).max(2100).nullable().optional(),
  tags: z.array(z.string()).default([]),
  primaryImageUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().default(true),
});
export type Asset = z.infer<typeof AssetSchema>;

export const ExternalIdSchema = BaseRecordSchema.extend({
  assetId: UuidSchema,
  source: z.string().min(1),
  externalValue: z.string().min(1),
  url: z.string().url().nullable().optional(),
  mappingConfidence: z.number().min(0).max(1).default(1),
});
export type ExternalId = z.infer<typeof ExternalIdSchema>;

export const CatalogEntitySchema = BaseRecordSchema.extend({
  name: z.string().min(1),
  kind: z.string().min(1).optional(),
});
export type CatalogEntity = z.infer<typeof CatalogEntitySchema>;

export const AssetEntitySchema = BaseRecordSchema.extend({
  assetId: UuidSchema,
  entityId: UuidSchema,
  role: z.string().min(1),
});
export type AssetEntity = z.infer<typeof AssetEntitySchema>;

export const GradeCompanySchema = BaseRecordSchema.extend({
  code: z.string().min(1),
  name: z.string().min(1),
  legacyId: z.number().int().optional(),
});
export type GradeCompany = z.infer<typeof GradeCompanySchema>;

export const GradeScaleSchema = BaseRecordSchema.extend({
  gradeCompanyId: UuidSchema,
  label: z.string().min(1),
  numericValue: z.number().nullable().optional(),
  normalizedScore: z.number().min(0).max(100).nullable().optional(),
});
export type GradeScale = z.infer<typeof GradeScaleSchema>;

export const PricedUnitSchema = BaseRecordSchema.extend({
  assetId: UuidSchema,
  gradeScaleId: UuidSchema,
});
export type PricedUnit = z.infer<typeof PricedUnitSchema>;
