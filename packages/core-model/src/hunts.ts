import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";

export const HuntStatusSchema = z.enum([
  "active",
  "paused",
  "completed",
  "coming_soon",
]);

export const HuntPrioritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
]);

export const CollectionHuntSchema = BaseRecordSchema.extend({
  slug: z.string().min(1),
  name: z.string().min(1),
  categoryId: UuidSchema.nullable().optional(),
  status: HuntStatusSchema.default("active"),
  description: z.string().nullable().optional(),
  budget: z.number().nonnegative().nullable().optional(),
  priority: HuntPrioritySchema.default("medium"),
  completionPct: z.number().min(0).max(100).default(0),
  estimatedValue: z.number().nullable().optional(),
  intelligenceScore: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  config: z.record(z.unknown()).default({}),
});
export type CollectionHunt = z.infer<typeof CollectionHuntSchema>;

export const HuntSectionSchema = BaseRecordSchema.extend({
  huntId: UuidSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  sortOrder: z.number().int().default(0),
  metricKey: z.string().nullable().optional(),
});
export type HuntSection = z.infer<typeof HuntSectionSchema>;

export const HuntItemStatusSchema = z.enum(["owned", "wanted", "missing"]);

export const HuntItemSchema = BaseRecordSchema.extend({
  sectionId: UuidSchema,
  assetId: UuidSchema.nullable().optional(),
  name: z.string().min(1),
  status: HuntItemStatusSchema.default("missing"),
  priority: HuntPrioritySchema.default("medium"),
  grade: z.string().nullable().optional(),
  paid: z.number().nullable().optional(),
  marketValue: z.number().nullable().optional(),
  buyUnder: z.number().nullable().optional(),
  msrp: z.number().nullable().optional(),
  storageLocation: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
  sortOrder: z.number().int().default(0),
  lastChecked: z.coerce.date().nullable().optional(),
});
export type HuntItem = z.infer<typeof HuntItemSchema>;
