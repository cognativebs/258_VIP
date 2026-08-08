import { z } from "zod";

export const RSS_ADAPTER_VERSION = "signals@rss-v1" as const;

export const RawRssSnapshotSchema = z.object({
  url: z.string(),
  fetchedAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  rawXml: z.string(),
  snapshotPath: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
});
export type RawRssSnapshot = z.infer<typeof RawRssSnapshotSchema>;

export const RssAdapterConfigSchema = z.object({
  feedUrl: z.string(),
  sourceId: z.string().min(1).default("pokemon-news-rss"),
  rateLimitMs: z.number().int().nonnegative().default(1000),
  /** Directory for immutable raw snapshots (sibling to job state preferred). */
  snapshotDir: z.string().min(1),
});
export type RssAdapterConfig = z.infer<typeof RssAdapterConfigSchema>;

export const SignalProvenanceSchema = z.object({
  source: z.string().min(1),
  method: z.string().min(1),
  modelVersion: z.literal(RSS_ADAPTER_VERSION),
  confidence: z.number().min(0).max(1),
  verificationStatus: z.enum(["inferred", "verified", "quarantined"]),
});
export type SignalProvenance = z.infer<typeof SignalProvenanceSchema>;

/** Adapter output — maps into pipeline IngestEvent; inferred · unverified by default. */
export const NormalizedSignalFromRssSchema = z.object({
  id: z.string().min(1),
  guid: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  sourceUrl: z.string().nullable(),
  signalDate: z.string().min(1),
  signalType: z.literal("news"),
  quarantineStatus: z.enum(["active", "quarantined", "rejected"]),
  provenance: SignalProvenanceSchema,
});
export type NormalizedSignalFromRss = z.infer<typeof NormalizedSignalFromRssSchema>;
