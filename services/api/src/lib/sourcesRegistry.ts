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

function contributionStats(sourceId: string): ApiSourceEntry["stats"] {
  const feed = readSignalsFeed(defaultSignalsFeedPath());
  if (!feed) return { signalCount: 0, quarantineRate: 0, evidenceCount: 0 };
  // Feed rows don't always carry sourceId — count news-ish items as proxy for RSS.
  const related = feed.signals.filter((s) => {
    if (sourceId === "pokemon-news-rss") return s.signalType === "news";
    if (sourceId === "retail-drop-watch") return s.signalType === "retail";
    return false;
  });
  const quarantined = related.filter((s) => s.quarantineStatus === "quarantined").length;
  const signalCount = related.length;
  return {
    signalCount,
    quarantineRate: signalCount === 0 ? 0 : quarantined / signalCount,
    evidenceCount: related.filter((s) => s.quarantineStatus === "active").length,
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
  };
}
