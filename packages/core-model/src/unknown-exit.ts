import { z } from "zod";
import { BaseRecordSchema } from "./base.js";
import { DecisionActionSchema } from "./decisions.js";

/**
 * Collection-level unrecorded exit (gift / donation / lost box).
 * Titles are unknown — never invent which holdings left, never DELETE, never
 * set dropped_at from this event. A later CLZ export that is missing rows is
 * the recorded-exit path (how-to 07).
 */
export const UNKNOWN_EXIT_RULE = "unknown-exit@0.1.0";

export const UnknownExitScopeSchema = z.enum([
  "general_inventory_bulk",
  "dealer_inventory_bulk",
  "operator_named",
]);
export type UnknownExitScope = z.infer<typeof UnknownExitScopeSchema>;

export const UnknownExitStatusSchema = z.enum(["open", "superseded", "resolved_by_clz_sync"]);
export type UnknownExitStatus = z.infer<typeof UnknownExitStatusSchema>;

export const UnknownExitCreateSchema = z
  .object({
    estimatedQty: z.number().int().min(1).max(1_000_000),
    estimatedValueLow: z.number().nonnegative().nullable().optional(),
    estimatedValueHigh: z.number().nonnegative().nullable().optional(),
    scope: UnknownExitScopeSchema.default("general_inventory_bulk"),
    titlesRecorded: z.literal(false),
    acknowledgeUnknownTitles: z.literal(true),
    recipientNote: z.string().max(2000).optional().default(""),
    occurredAt: z.coerce.date().optional(),
  })
  .strict();
export type UnknownExitCreate = z.infer<typeof UnknownExitCreateSchema>;

export const UnknownExitEventSchema = BaseRecordSchema.extend({
  scope: UnknownExitScopeSchema,
  estimatedQty: z.number().int().positive(),
  estimatedValueLow: z.number().nonnegative().nullable(),
  estimatedValueHigh: z.number().nonnegative().nullable(),
  currency: z.string().length(3).default("USD"),
  titlesRecorded: z.literal(false),
  recipientNote: z.string().nullable().optional(),
  occurredAt: z.coerce.date(),
  status: UnknownExitStatusSchema,
  holdingsTouched: z.literal(false),
});
export type UnknownExitEvent = z.infer<typeof UnknownExitEventSchema>;

export const UnknownExitCatalogSliceSchema = z.object({
  catalogHoldings: z.number().int().nonnegative(),
  catalogValue: z.number().nonnegative(),
  scopeName: z.string().min(1),
  scopeHoldings: z.number().int().nonnegative(),
  scopeValue: z.number().nonnegative(),
});
export type UnknownExitCatalogSlice = z.infer<typeof UnknownExitCatalogSliceSchema>;

export const UnknownExitRecommendationSchema = z.object({
  action: DecisionActionSchema,
  appliesTo: z.string().min(1),
  reasonCodes: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  notes: z.string().min(1),
});
export type UnknownExitRecommendation = z.infer<typeof UnknownExitRecommendationSchema>;

export const UnknownExitImpactSchema = z.object({
  catalogHoldings: z.number().int().nonnegative(),
  catalogValue: z.number().nonnegative(),
  scopeName: z.string(),
  scopeHoldings: z.number().int().nonnegative(),
  scopeValue: z.number().nonnegative(),
  estimatedQty: z.number().int().nonnegative(),
  giftedShare: z.number().min(0).max(1),
  unaccountedValueHigh: z.number().nonnegative(),
  physicalHoldingsLow: z.number().int().nonnegative(),
  physicalHoldingsHigh: z.number().int().nonnegative(),
  physicalValueLow: z.number().nonnegative(),
  physicalValueHigh: z.number().nonnegative(),
  holdingsTouched: z.literal(false),
  titlesInvented: z.literal(false),
  verificationStatus: z.literal("unverified"),
  method: z.literal("inferred"),
  ruleOrModelVersion: z.literal(UNKNOWN_EXIT_RULE),
  recommendations: z.array(UnknownExitRecommendationSchema).min(1),
});
export type UnknownExitImpact = z.infer<typeof UnknownExitImpactSchema>;

export const DEFAULT_UNKNOWN_EXIT_SCOPE_NAME = "General Inventory";

/** Share of the scope we treat as possibly gone. Never exceeds 1. */
export function giftedShare(estimatedQty: number, scopeHoldings: number): number {
  if (scopeHoldings <= 0 || estimatedQty <= 0) return 0;
  return Math.min(1, estimatedQty / scopeHoldings);
}

/**
 * Physical remaining is a range. High = CLZ catalog (rows still listed).
 * Low = catalog minus a proportional slice of the bulk pillar — not a pick of
 * specific titles. Inferred · unverified.
 */
export function evaluateUnknownExitImpact(
  slice: UnknownExitCatalogSlice,
  estimatedQty: number,
): UnknownExitImpact {
  const catalog = UnknownExitCatalogSliceSchema.parse(slice);
  const qty = Math.max(0, Math.floor(estimatedQty));
  const share = giftedShare(qty, catalog.scopeHoldings);
  const unaccountedValueHigh = round2(catalog.scopeValue * share);
  const physicalValueLow = round2(Math.max(0, catalog.catalogValue - unaccountedValueHigh));
  const physicalValueHigh = round2(catalog.catalogValue);
  const giftedHoldings = Math.min(qty, catalog.scopeHoldings);

  return UnknownExitImpactSchema.parse({
    catalogHoldings: catalog.catalogHoldings,
    catalogValue: round2(catalog.catalogValue),
    scopeName: catalog.scopeName,
    scopeHoldings: catalog.scopeHoldings,
    scopeValue: round2(catalog.scopeValue),
    estimatedQty: qty,
    giftedShare: share,
    unaccountedValueHigh,
    physicalHoldingsLow: Math.max(0, catalog.catalogHoldings - giftedHoldings),
    physicalHoldingsHigh: catalog.catalogHoldings,
    physicalValueLow,
    physicalValueHigh,
    holdingsTouched: false,
    titlesInvented: false,
    verificationStatus: "unverified",
    method: "inferred",
    ruleOrModelVersion: UNKNOWN_EXIT_RULE,
    recommendations: [
      {
        action: "Pass",
        appliesTo: "general_inventory_bulk",
        reasonCodes: [
          "UNRECORDED_BULK_EXIT",
          "TITLES_UNKNOWN",
          "DO_NOT_DELETE_HOLDINGS",
        ],
        confidence: 0.4,
        notes:
          "Pass on treating General Inventory as physically confirmed sell/lot stock. Titles were not recorded — do not delete or drop holdings.",
      },
      {
        action: "Hold",
        appliesTo: "keys_and_themed_pillars",
        reasonCodes: ["BULK_GIFT_OUTSIDE_KEYS", "STALE_CLZ_SNAPSHOT"],
        confidence: 0.55,
        notes:
          "Hold keys, museum, and themed pillars. The unrecorded gift was bulk; collection value barely moves if General Inventory is the slice.",
      },
    ],
  });
}

export function catalogSliceFromPillars(
  catalogHoldings: number,
  catalogValue: number,
  pillars: { name: string; count: number; value?: number }[],
  scopeName = DEFAULT_UNKNOWN_EXIT_SCOPE_NAME,
): UnknownExitCatalogSlice {
  const pillar = pillars.find((p) => p.name === scopeName);
  return UnknownExitCatalogSliceSchema.parse({
    catalogHoldings,
    catalogValue,
    scopeName,
    scopeHoldings: pillar?.count ?? 0,
    scopeValue: pillar?.value ?? 0,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
