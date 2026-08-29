import { z } from "zod";

/**
 * Capital-intent buckets for IQVault inventory.
 * Distinct from collection_pillar (franchise / theme). Pillars nest inside a bucket.
 *
 * personal_collection — keepers (Spider-Man, Batman, art/female covers, …). Not for routine sale.
 * investment_vault — sell only when price / value intelligence justifies it.
 * dealer_inventory — capital that exists to churn.
 */
export const InventoryBucketSchema = z.enum([
  "personal_collection",
  "investment_vault",
  "dealer_inventory",
]);
export type InventoryBucket = z.infer<typeof InventoryBucketSchema>;

export const InventoryBucketAssignmentSchema = z.enum(["inferred", "operator"]);
export type InventoryBucketAssignment = z.infer<typeof InventoryBucketAssignmentSchema>;

export const INVENTORY_BUCKET_RULE = "inventory-bucket@0.1.0";

export const PERSONAL_COLLECTION_PILLARS = [
  "Batman",
  "Spider-Man",
  "Superman",
  "Absolute Universe",
  "Good Girl / Risqué Covers",
  "Cover Art & Favorite Artists",
  "Sci-Fi",
  "Personal Favorites",
  "X-Men",
] as const;

export const INVESTMENT_VAULT_PILLARS = [
  "Investment Portfolio",
  "First Appearances",
  "Bronze & Silver Age Keys",
] as const;

export const InventoryBucketClassificationInputSchema = z.object({
  pillar: z.string().nullable().optional(),
  recommendation: z.string().nullable().optional(),
  valueLocked: z.boolean().optional(),
});
export type InventoryBucketClassificationInput = z.infer<
  typeof InventoryBucketClassificationInputSchema
>;

export const InventoryBucketClassificationSchema = z.object({
  bucket: InventoryBucketSchema,
  assignment: z.literal("inferred"),
  reasons: z.array(z.string()).min(1),
  ruleOrModelVersion: z.literal(INVENTORY_BUCKET_RULE),
  verificationStatus: z.literal("unverified"),
});
export type InventoryBucketClassification = z.infer<
  typeof InventoryBucketClassificationSchema
>;

export const BucketSellPolicySchema = z.object({
  bucket: InventoryBucketSchema,
  routineSale: z.boolean(),
  sellWhenIntelligenceJustifies: z.boolean(),
  churnCapital: z.boolean(),
  reasonCode: z.string(),
  notes: z.string(),
});
export type BucketSellPolicy = z.infer<typeof BucketSellPolicySchema>;

const PERSONAL = new Set<string>(PERSONAL_COLLECTION_PILLARS);
const INVESTMENT = new Set<string>(INVESTMENT_VAULT_PILLARS);

export function classifyInventoryBucket(
  input: InventoryBucketClassificationInput,
): InventoryBucketClassification {
  const parsed = InventoryBucketClassificationInputSchema.parse(input);
  const pillar = (parsed.pillar ?? "").trim();
  const rec = (parsed.recommendation ?? "").trim();
  const reasons: string[] = [];

  if (parsed.valueLocked) {
    reasons.push("value_locked");
    return pack("personal_collection", reasons.length ? reasons : ["value_locked"]);
  }
  if (rec === "Museum Candidate") {
    reasons.push("recommendation:Museum Candidate");
    return pack("personal_collection", reasons);
  }
  if (pillar && PERSONAL.has(pillar)) {
    reasons.push(`pillar:${pillar}`);
    return pack("personal_collection", reasons);
  }
  if (pillar && INVESTMENT.has(pillar)) {
    reasons.push(`pillar:${pillar}`);
    return pack("investment_vault", reasons);
  }
  if (rec === "Investment Hold / Review") {
    reasons.push("recommendation:Investment Hold / Review");
    return pack("investment_vault", reasons);
  }
  if (pillar === "General Inventory") {
    reasons.push("pillar:General Inventory");
    return pack("dealer_inventory", reasons);
  }
  if (
    rec === "Sell Duplicate" ||
    rec === "Sell / Lot Candidate" ||
    rec === "Verify then Lot"
  ) {
    reasons.push(`recommendation:${rec}`);
    return pack("dealer_inventory", reasons);
  }
  reasons.push(pillar ? `unmapped_pillar:${pillar}` : "no_pillar");
  return pack("dealer_inventory", reasons);
}

function pack(bucket: InventoryBucket, reasons: string[]): InventoryBucketClassification {
  return InventoryBucketClassificationSchema.parse({
    bucket,
    assignment: "inferred",
    reasons,
    ruleOrModelVersion: INVENTORY_BUCKET_RULE,
    verificationStatus: "unverified",
  });
}

export function bucketSellPolicy(bucket: InventoryBucket): BucketSellPolicy {
  switch (bucket) {
    case "personal_collection":
      return {
        bucket,
        routineSale: false,
        sellWhenIntelligenceJustifies: false,
        churnCapital: false,
        reasonCode: "PERSONAL_COLLECTION_NOT_FOR_SALE",
        notes: "Personal collection — not for routine sale. Operator override required to list.",
      };
    case "investment_vault":
      return {
        bucket,
        routineSale: false,
        sellWhenIntelligenceJustifies: true,
        churnCapital: false,
        reasonCode: "INVESTMENT_REQUIRES_INTELLIGENCE",
        notes:
          "Investment vault — Sell only when a live range + evidence count + recency justify it.",
      };
    case "dealer_inventory":
      return {
        bucket,
        routineSale: true,
        sellWhenIntelligenceJustifies: false,
        churnCapital: true,
        reasonCode: "DEALER_CHURN",
        notes:
          "Dealer inventory — capital that exists to churn. LIVE range is evidence, not a listing gate.",
      };
  }
}

export function inventoryBucketLabel(bucket: InventoryBucket): string {
  switch (bucket) {
    case "personal_collection":
      return "Personal Collection";
    case "investment_vault":
      return "Investment Vault";
    case "dealer_inventory":
      return "Dealer Inventory";
  }
}
