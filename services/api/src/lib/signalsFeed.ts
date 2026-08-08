/**
 * Shared path for NormalizedSignal feed written by jobs, read by VIP API.
 * Override with VIP_SIGNALS_FEED env (absolute path).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const FeedSignalSchema = z.object({
  id: z.string().min(1),
  signalType: z.enum(["news", "market", "supply", "retail", "reprint", "auction"]),
  body: z.string().min(1),
  sourceUrl: z.string().nullable().optional(),
  signalDate: z.string().min(1),
  noveltyScore: z.number().min(0).max(1).nullable().optional(),
  quarantineStatus: z.enum(["active", "quarantined", "rejected"]).default("active"),
  assetId: z.string().nullable().optional(),
  title: z.string().optional(),
});

export const SignalsFeedSchema = z.object({
  schema: z.literal("vip_signals_feed_v1"),
  writtenAt: z.string(),
  runId: z.string().nullable(),
  job: z.string().nullable().optional(),
  provenance: z.object({
    source: z.string(),
    method: z.string(),
    ruleOrModelVersion: z.string(),
    verificationStatus: z.enum(["verified", "unverified"]),
    notes: z.string().optional(),
  }),
  signals: z.array(FeedSignalSchema),
});

export type FeedSignal = z.infer<typeof FeedSignalSchema>;
export type SignalsFeed = z.infer<typeof SignalsFeedSchema>;

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default: services/jobs/.state/signals-feed.json (from services/api/src/lib → ../../jobs/.state). */
export function defaultSignalsFeedPath(): string {
  if (process.env.VIP_SIGNALS_FEED) return process.env.VIP_SIGNALS_FEED;
  return join(__dirname, "..", "..", "..", "jobs", ".state", "signals-feed.json");
}

export function writeSignalsFeed(path: string, feed: SignalsFeed): void {
  const parsed = SignalsFeedSchema.parse(feed);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(parsed, null, 2), "utf8");
}

export function readSignalsFeed(path: string): SignalsFeed | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return SignalsFeedSchema.parse(raw);
  } catch {
    return null;
  }
}
