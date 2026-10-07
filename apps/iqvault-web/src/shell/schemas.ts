import { z } from "zod";

/** Fixed concepts. Order is not defined here. */
export const conceptIdSchema = z.enum([
  "ADVISOR",
  "INGEST",
  "OPERATE",
  "SIGNALS",
  "VAULT",
]);
export type ConceptId = z.infer<typeof conceptIdSchema>;

export const roleIdSchema = z.enum(["collector", "dealer", "founder"]);
export type RoleId = z.infer<typeof roleIdSchema>;

export const operateSectionIdSchema = z.enum([
  "catalogs",
  "integrations",
  "jobs",
  "listings",
  "pricing",
  "sell",
  "transactions",
]);
export type OperateSectionId = z.infer<typeof operateSectionIdSchema>;

export const confidenceSchema = z.enum(["high", "medium", "low", "none"]);
export type ConfidenceWord = z.infer<typeof confidenceSchema>;

/**
 * A valuation is a range plus evidence. There is no scalar `value` field.
 * `strict()` rejects a single-number price if a caller tries to pass one.
 */
export const valueRangeSchema = z
  .object({
    low: z.number().nullable(),
    high: z.number().nullable(),
    compCount: z.number().int().nonnegative(),
    recencyDays: z.number().nonnegative().nullable(),
    confidence: confidenceSchema,
    /** Sold comps, or browse listings. Callers must not relabel one as the other. */
    evidenceLabel: z.enum(["comps", "listings"]).default("comps"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.confidence === "none") {
      if (value.low != null || value.high != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "No-comp valuations do not carry a range",
        });
      }
      return;
    }
    if (value.low == null || value.high == null || value.high < value.low) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A valued asset needs a low and a high",
      });
    }
  });
export type ValueRangeProps = z.infer<typeof valueRangeSchema>;

export const verificationSchema = z
  .object({
    verified: z.boolean(),
    /** Required when unverified. Absence of a chip means verified. */
    label: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.verified && !value.label) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unverified condition needs an explicit label",
      });
    }
  });
export type VerificationState = z.infer<typeof verificationSchema>;

export const evidenceActionSchema = z
  .object({
    label: z.string().min(1),
    href: z.string().startsWith("/"),
  })
  .strict();

export const insufficientEvidenceSchema = z
  .object({
    reason: z.string().min(1),
    facts: z.array(z.string().min(1)).min(1),
    actions: z.array(evidenceActionSchema).min(1),
  })
  .strict();
export type InsufficientEvidenceProps = z.infer<typeof insufficientEvidenceSchema>;

export const operateSectionSchema = z
  .object({
    id: operateSectionIdSchema,
    label: z.string().min(1),
  })
  .strict();
export type OperateSection = z.infer<typeof operateSectionSchema>;

export const roleConfigSchema = z
  .object({
    id: roleIdSchema,
    label: z.string().min(1),
    order: z.array(conceptIdSchema).min(3).max(5),
    landing: conceptIdSchema,
    secondary: z
      .object({
        OPERATE: z.array(operateSectionSchema).min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((role, ctx) => {
    if (!role.order.includes(role.landing)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Landing must be one of the role's visible concepts",
      });
    }
  });
export type RoleConfig = z.infer<typeof roleConfigSchema>;
