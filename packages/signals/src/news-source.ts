import { z } from "zod";

export const SIGNALS_NEWS_SOURCE_RULE = "signals-news-source@0.1.0";

export const SignalsNewsTierSchema = z.enum(["machine", "newsletter"]);
export type SignalsNewsTier = z.infer<typeof SignalsNewsTierSchema>;

export const SignalsNewsAccessMethodSchema = z.enum([
  "rest_api",
  "rss",
  "rss_or_scrape_check",
  "published_file_check",
  "gmail_label_poll",
]);
export type SignalsNewsAccessMethod = z.infer<typeof SignalsNewsAccessMethodSchema>;

/**
 * News taxonomy from the 2026-09-20 bookmark seed.
 * Not vault_core.evidence_class — those classes must not raise a valuation ceiling.
 */
export const SignalsNewsSeedEvidenceClassSchema = z.enum([
  "third_party_narrative",
  "official_statistic",
  "primary_disclosure",
  "trade_press",
  "publisher_primary",
  "benchmark_price",
  "expert_analysis",
  "aggregator",
]);
export type SignalsNewsSeedEvidenceClass = z.infer<typeof SignalsNewsSeedEvidenceClassSchema>;

export const SignalsNewsSourceSchema = z.object({
  sourceKey: z.string().min(1),
  displayName: z.string().min(1),
  tier: SignalsNewsTierSchema,
  accessMethod: SignalsNewsAccessMethodSchema,
  endpoint: z.string().nullable(),
  auth: z.string().min(1),
  authEnvVar: z.string().nullable(),
  verifyBeforeFirstRun: z.boolean(),
  adapterEnabled: z.literal(false).or(z.boolean()),
  isActive: z.boolean(),
  blockedReason: z.string().nullable(),
  cadence: z.string().nullable(),
  latencyNotes: z.string().nullable(),
  categoryCoverage: z.array(z.string()),
  seedEvidenceClass: SignalsNewsSeedEvidenceClassSchema,
  seedConfidenceCeiling: z.number().min(0).max(1),
  authoritySeed: z.number().min(0).max(1).nullable(),
  historicalAccuracySeed: z.number().min(0).max(1).nullable(),
  redistributionAllowed: z.literal(false),
  mayRaiseValuationCeiling: z.literal(false),
  terms: z.string().min(1),
  dedupKeys: z.array(z.string()),
  iqvaultOnly: z.boolean(),
  whyItEarnsASlot: z.string().nullable(),
  phase2Enabled: z.literal(false),
  provenance: z.object({
    source: z.literal("signals_news_seed"),
    method: z.literal("inferred"),
    ruleOrModelVersion: z.literal(SIGNALS_NEWS_SOURCE_RULE),
    verificationStatus: z.literal("unverified"),
    notes: z.string(),
  }),
});
export type SignalsNewsSource = z.infer<typeof SignalsNewsSourceSchema>;

/** Jobs must call this. Seeded rows never pass. */
export function newsAdapterMayRun(row: Pick<SignalsNewsSource, "adapterEnabled" | "isActive" | "verifyBeforeFirstRun" | "blockedReason">): boolean {
  return (
    row.adapterEnabled === true &&
    row.isActive === true &&
    row.verifyBeforeFirstRun === false &&
    row.blockedReason == null
  );
}
