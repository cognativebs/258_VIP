import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  SourceRegistryPersistedSchema,
  type SourceRegistryPersisted,
} from "../schemas/source-registry.js";

/**
 * Persist SourceRegistry active toggles next to the signals feed by default.
 * Override with VIP_SOURCES_STATE (absolute path).
 */
export function defaultSourcesStatePath(signalsFeedPath?: string): string {
  if (process.env.VIP_SOURCES_STATE) return process.env.VIP_SOURCES_STATE;
  if (signalsFeedPath) {
    return signalsFeedPath.replace(/signals-feed\.json$/i, "sources-state.json");
  }
  return "sources-state.json";
}

export function loadPersistedState(path: string): SourceRegistryPersisted {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return SourceRegistryPersistedSchema.parse(raw);
  } catch {
    return {};
  }
}

export function savePersistedState(path: string, state: SourceRegistryPersisted): void {
  const parsed = SourceRegistryPersistedSchema.parse(state);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(parsed, null, 2), "utf8");
}

export function isSourceActive(
  sourceId: string,
  opts: { defaultActive: boolean; statePath: string },
): boolean {
  const state = loadPersistedState(opts.statePath);
  const entry = state[sourceId];
  if (entry == null) return opts.defaultActive;
  return entry.active;
}

export function setSourceActive(
  sourceId: string,
  active: boolean,
  statePath: string,
): SourceRegistryPersisted {
  const state = loadPersistedState(statePath);
  state[sourceId] = {
    active,
    persistedAt: new Date().toISOString(),
  };
  savePersistedState(statePath, state);
  return state;
}
