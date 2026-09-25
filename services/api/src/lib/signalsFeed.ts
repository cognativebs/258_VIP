/**
 * Shared path for NormalizedSignal feed written by jobs, read by VIP API.
 * Override with VIP_SIGNALS_FEED env (absolute path).
 * Jobs that must not overwrite each other write a sibling
 * `signals-feed.<job>.json`; readSignalsFeed merges them.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
  /** News source key (vault_core.signals_news_source) when a job sets it. */
  sourceId: z.string().optional(),
  /** Credit line the source's terms require the UI to show, e.g. "Provided by ESPN". */
  attribution: z.string().optional(),
  sport: z.string().optional(),
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

function readOneFeed(path: string): SignalsFeed | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return SignalsFeedSchema.parse(raw);
  } catch {
    return null;
  }
}

/** `signals-feed.json` → `signals-feed.<job>.json` siblings in the same directory. */
function siblingFeedPaths(path: string): string[] {
  const dir = dirname(path);
  const stem = basename(path).replace(/\.json$/i, "");
  if (!existsSync(dir)) return [];
  const prefix = `${stem}.`;
  return readdirSync(dir)
    .filter(
      (name) =>
        name.startsWith(prefix) &&
        name.endsWith(".json") &&
        /^[a-z0-9-]+$/i.test(name.slice(prefix.length, -".json".length)),
    )
    .sort()
    .map((name) => join(dir, name));
}

/**
 * The primary feed plus any sibling job feeds, merged. Provenance and runId
 * come from the primary when it exists; writtenAt is the newest.
 */
export function readSignalsFeed(path: string): SignalsFeed | null {
  const feeds = [path, ...siblingFeedPaths(path)]
    .map(readOneFeed)
    .filter((f): f is SignalsFeed => f !== null);
  if (feeds.length === 0) return null;
  if (feeds.length === 1) return feeds[0]!;
  const [first] = feeds;
  const seen = new Set<string>();
  const signals = feeds
    .flatMap((f) => f.signals)
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  return {
    ...first!,
    writtenAt: feeds.map((f) => f.writtenAt).sort().at(-1)!,
    job: feeds.map((f) => f.job).filter(Boolean).join(" + ") || null,
    signals,
  };
}
