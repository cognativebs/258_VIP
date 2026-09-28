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

/**
 * Mirrors vault_hunt.hunt_item's status CHECK. TARGET → WATCHING → BUY →
 * ORDERED → OWNED, plus PASS (evaluated and deliberately excluded). The
 * original owned/wanted/missing values stay valid for older hunts.
 */
export const HuntItemStatusSchema = z.enum([
  "target",
  "watching",
  "buy",
  "ordered",
  "owned",
  "pass",
  "wanted",
  "missing",
]);
export type HuntItemStatus = z.infer<typeof HuntItemStatusSchema>;
export const HuntLifecycleStatusSchema = z.enum(["target", "watching", "buy", "ordered", "owned", "pass"]);
export type HuntLifecycleStatus = z.infer<typeof HuntLifecycleStatusSchema>;

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
  ownedQuantity: z.number().int().nonnegative().default(0),
  /** Stable key from a hunt definition; lets a definition reload without duplicating. */
  itemKey: z.string().min(1).nullable().optional(),
});
export type HuntItem = z.infer<typeof HuntItemSchema>;

/** Mirrors vault_hunt.hunt_set: a multi-item goal (connecting covers, trios, rainbows). */
export const HuntSetSchema = BaseRecordSchema.extend({
  huntId: UuidSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  status: HuntLifecycleStatusSchema.default("target"),
  priority: HuntPrioritySchema.default("medium"),
  notes: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type HuntSet = z.infer<typeof HuntSetSchema>;

export const HuntSetMemberSchema = z.object({
  setId: UuidSchema,
  huntItemId: UuidSchema,
  position: z.number().int().nonnegative(),
});
export type HuntSetMember = z.infer<typeof HuntSetMemberSchema>;

export const HuntDefinitionCategorySchema = z.enum(["comic", "pokemon", "sports", "mtg", "other"]);

/**
 * Price bands are evaluated in order; the first band the price falls under wins.
 * `inclusive` decides whether a price equal to upTo is inside the band.
 */
export const HuntPriceBandSchema = z
  .object({
    label: z.enum(["HIGH_PRIORITY", "PRIORITY_UP", "BUY", "WATCH"]),
    upTo: z.number().positive(),
    inclusive: z.boolean(),
  })
  .strict();
export type HuntPriceBand = z.infer<typeof HuntPriceBandSchema>;

export function priceBandFor(
  bands: ReadonlyArray<HuntPriceBand>,
  price: number,
): HuntPriceBand["label"] | null {
  for (const band of bands) {
    if (band.inclusive ? price <= band.upTo : price < band.upTo) return band.label;
  }
  return null;
}

const KeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

export const HuntDefinitionItemSchema = z
  .object({
    key: KeySchema,
    section: KeySchema,
    name: z.string().min(1),
    series: z.string().min(1),
    issue: z.string().min(1),
    coverLetter: z.string().min(1).nullable(),
    variantName: z.string().min(1),
    artist: z.string().min(1).nullable(),
    characterFocus: z.string().min(1),
    ratio: z.string().regex(/^1:\d+$/).nullable(),
    publisher: z.string().min(1),
    /** Unknown until a catalog source provides it. Never guessed. */
    upc: z.string().regex(/^\d{12,17}$/).nullable(),
    releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    coverImage: z.string().url().nullable(),
    retailerExclusive: z.boolean(),
    /** Only a verified print run. "Limited to 800" marketing is not verification. */
    printLimitVerified: z.number().int().positive().nullable(),
    /** Operator-set initial target (buy_under). Revisable once sold comps exist. */
    targetPrice: z.number().positive().nullable(),
    priceBands: z.array(HuntPriceBandSchema),
    priority: HuntPrioritySchema,
    reason: z.string().min(1),
  })
  .strict();
export type HuntDefinitionItem = z.infer<typeof HuntDefinitionItemSchema>;

export const HuntDefinitionSchema = z
  .object({
    schema: z.literal("vip_hunt_definition_v1"),
    slug: KeySchema,
    name: z.string().min(1),
    category: HuntDefinitionCategorySchema,
    priority: HuntPrioritySchema,
    description: z.string().min(1),
    source: z
      .object({
        authoredBy: z.string().min(1),
        authoredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        document: z.string().min(1),
        /** Variant facts in a definition are the operator's, not a catalog's. */
        verification: z.literal("unverified"),
      })
      .strict(),
    philosophy: z.string().min(1),
    rankingFactors: z.array(z.string().min(1)).min(1),
    dontChase: z.array(z.string().min(1)),
    marketRules: z.array(z.string().min(1)),
    sections: z
      .array(z.object({ slug: KeySchema, name: z.string().min(1) }).strict())
      .min(1),
    items: z.array(HuntDefinitionItemSchema).min(1),
    sets: z.array(
      z
        .object({
          slug: KeySchema,
          name: z.string().min(1),
          description: z.string().min(1),
          priority: HuntPrioritySchema,
          members: z.array(KeySchema).min(2),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((def, ctx) => {
    const sections = new Set(def.sections.map((s) => s.slug));
    const keys = new Set<string>();
    def.items.forEach((item, i) => {
      if (keys.has(item.key)) {
        ctx.addIssue({ code: "custom", path: ["items", i, "key"], message: `duplicate key ${item.key}` });
      }
      keys.add(item.key);
      if (!sections.has(item.section)) {
        ctx.addIssue({ code: "custom", path: ["items", i, "section"], message: `unknown section ${item.section}` });
      }
    });
    def.sets.forEach((set, i) => {
      set.members.forEach((member, j) => {
        if (!keys.has(member)) {
          ctx.addIssue({ code: "custom", path: ["sets", i, "members", j], message: `unknown item ${member}` });
        }
      });
    });
  });
export type HuntDefinition = z.infer<typeof HuntDefinitionSchema>;

/** Statuses that count toward "still wanted" (not owned, not passed, not missing-only legacy). */
export const HUNT_OPEN_STATUSES: ReadonlyArray<HuntItemStatus> = [
  "target",
  "watching",
  "buy",
  "ordered",
  "wanted",
];

export type SetMemberState = { name: string; status: HuntItemStatus; paid: number | null };

/**
 * Set progress at read time. PASS members are excluded from the total.
 * Costs are what was paid; market value comes from observations, not here.
 */
export function setProgress(members: ReadonlyArray<SetMemberState>) {
  const counted = members.filter((m) => m.status !== "pass");
  const owned = counted.filter((m) => m.status === "owned");
  const total = counted.length;
  return {
    owned: owned.length,
    total,
    completionPct: total === 0 ? 0 : Math.round((owned.length / total) * 1000) / 10,
    totalPaid: owned.reduce((sum, m) => sum + (m.paid ?? 0), 0),
    unpricedOwned: owned.filter((m) => m.paid == null).length,
    missing: counted.filter((m) => m.status !== "owned").map((m) => m.name),
  };
}

/** What a collector may change on a hunt item from the UI. */
export const HuntItemPatchSchema = z
  .object({
    status: HuntItemStatusSchema.optional(),
    paid: z.number().nonnegative().nullable().optional(),
    ownedQuantity: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "empty patch" });
export type HuntItemPatch = z.infer<typeof HuntItemPatchSchema>;

export const HuntSetPatchSchema = z.object({ status: HuntLifecycleStatusSchema }).strict();
export type HuntSetPatch = z.infer<typeof HuntSetPatchSchema>;
