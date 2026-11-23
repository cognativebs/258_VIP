/**
 * VIP Sources API — Express pattern (services/api/src/app.ts), not Next app router.
 * Backed by @vip/signals SourceRegistry + JSON persistence sibling to signals-feed.
 */
import {
  DEFAULT_SOURCES,
  SourceRegistry,
  defaultSourcesStatePath,
  loadPersistedState,
  setSourceActive,
  type ApiSourceEntry,
} from "@vip/signals";
import { defaultSignalsFeedPath, readSignalsFeed } from "./signalsFeed.js";

function statePath(): string {
  return defaultSourcesStatePath(defaultSignalsFeedPath());
}

/**
 * Feed rows don't always carry sourceId, so news/retail sources are attributed
 * by signal type (a proxy). Any other source has no attribution yet: stats are
 * omitted rather than reported as zero (no fake precision).
 */
const STATS_BY_SIGNAL_TYPE: Record<string, string> = {
  "pokemon-news-rss": "news",
  "retail-drop-watch": "retail",
};

/**
 * Q12 (owner 2026-11-23): which jobs read each toggle through isSourceActive.
 * Keep in step with services/jobs (pokemon-drops.ts, ebay-browse-comps.ts).
 */
export const SOURCE_READERS: Record<string, string[]> = {
  "pokemon-news-rss": ["pokemon-drops"],
  "retail-drop-watch": ["pokemon-drops"],
  "ebay-browse": ["ebay-browse-comps"],
};

export function sourceReaders(sourceId: string): string[] {
  return SOURCE_READERS[sourceId] ?? [];
}

export const SOURCE_STATS_METHOD = "signals-feed signalType proxy@0.1.0";

export function contributionStats(sourceId: string): ApiSourceEntry["stats"] {
  const signalType = STATS_BY_SIGNAL_TYPE[sourceId];
  if (!signalType) return undefined;
  const feed = readSignalsFeed(defaultSignalsFeedPath());
  if (!feed) {
    return {
      signalCount: 0,
      quarantineRate: 0,
      evidenceCount: 0,
      method: `${SOURCE_STATS_METHOD} (signalType=${signalType}; no feed file yet)`,
    };
  }
  const related = feed.signals.filter((s) => s.signalType === signalType);
  const quarantined = related.filter((s) => s.quarantineStatus === "quarantined").length;
  const signalCount = related.length;
  return {
    signalCount,
    quarantineRate: signalCount === 0 ? 0 : quarantined / signalCount,
    evidenceCount: related.filter((s) => s.quarantineStatus === "active").length,
    method: `${SOURCE_STATS_METHOD} (signalType=${signalType})`,
  };
}

export function loadSources(): ApiSourceEntry[] {
  const registry = new SourceRegistry(DEFAULT_SOURCES);
  const persisted = loadPersistedState(statePath());
  return registry.listAll().map((entry) => {
    const overlay = persisted[entry.id];
    const active = overlay?.active ?? entry.active;
    return {
      ...entry,
      active,
      label: entry.name,
      persistedAt: overlay?.persistedAt,
      stats: contributionStats(entry.id),
      readBy: sourceReaders(entry.id),
    };
  });
}

export function updateSourceActive(id: string, active: boolean): ApiSourceEntry | null {
  const registry = new SourceRegistry(DEFAULT_SOURCES);
  const base = registry.get(id);
  if (!base) return null;
  const state = setSourceActive(id, active, statePath());
  return {
    ...base,
    active,
    label: base.name,
    persistedAt: state[id]?.persistedAt,
    stats: contributionStats(id),
    readBy: sourceReaders(id),
  };
}
