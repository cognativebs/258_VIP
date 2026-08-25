import { z } from "zod";

/** Live adapter tags from inventoryApi — not the spec's comics_api/vip_fallback names. */
export const InventorySourceSchema = z.enum(["comics", "vip", "none"]);
export type InventorySource = z.infer<typeof InventorySourceSchema>;

export const InventoryProvenanceSchema = z.object({
  source: InventorySourceSchema,
  method: z.enum(["http_get", "fallback_chain"]),
  confidence: z.number().min(0).max(1),
  verificationStatus: z.literal("unverified"),
});
export type InventoryProvenance = z.infer<typeof InventoryProvenanceSchema>;

export const ComicRowSchema = z
  .object({
    id: z.string(),
    Series: z.string(),
    "Issue Full": z.string(),
    "Edition / Variant": z.string().optional(),
    Publisher: z.string().optional(),
    "Collection Pillar": z.string().nullable().optional(),
    "Current Price": z.number().nullable().optional(),
    "Museum Score": z.number().nullable().optional(),
    "Investment Score": z.number().nullable().optional(),
    "Liquidity Score": z.number().nullable().optional(),
    Recommendation: z.string().nullable().optional(),
    "Sell Priority": z.string().nullable().optional(),
    "Assumed Grade": z.string().nullable().optional(),
    "Needs Grading": z.union([z.string(), z.boolean()]).nullable().optional(),
    Duplicate: z.string().nullable().optional(),
    "Slab Status": z.string().nullable().optional(),
  })
  .passthrough();
export type ComicRow = z.infer<typeof ComicRowSchema>;

export const InventoryMetaSchema = z.object({
  snapshotLabel: z.string(),
  /** Row count in this snapshot — not a valuation. */
  recordCount: z.number().int().nonnegative(),
  /**
   * Catalog/snapshot dollars. Never present as live comps.
   * UI and council context must keep the unverified label.
   */
  snapshotTotal: z.object({
    amount: z.number(),
    note: z.literal("catalog snapshot · unverified"),
  }),
  note: z.string().optional(),
});
export type InventoryMeta = z.infer<typeof InventoryMetaSchema>;

export const InventoryBundleSchema = z.object({
  source: InventorySourceSchema,
  fetchedAt: z.string(),
  meta: InventoryMetaSchema,
  rows: z.array(ComicRowSchema),
  provenance: InventoryProvenanceSchema,
});
export type InventoryBundle = z.infer<typeof InventoryBundleSchema>;
