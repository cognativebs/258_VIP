import type { SourceRegistryEntry } from "./types.js";
import { SourceRegistryEntrySchema } from "./types.js";

export const DEFAULT_SOURCES: SourceRegistryEntry[] = [
  SourceRegistryEntrySchema.parse({
    id: "pokemon-news-rss",
    name: "Pokémon product news (RSS adapter)",
    authority: "news",
    historicalAccuracy: 0.55,
    latencyHours: 6,
    categoryCoverage: ["pokemon"],
    accessMethod: "rss",
    terms: "Respect feed ToS; store raw snapshots; no scrape of blocked surfaces.",
    active: true,
  }),
  SourceRegistryEntrySchema.parse({
    id: "retail-drop-watch",
    name: "Retail drop watchlist",
    authority: "retail",
    historicalAccuracy: 0.45,
    latencyHours: 2,
    categoryCoverage: ["pokemon"],
    accessMethod: "api",
    terms: "Adapter-swappable; rate-limit; quarantine unverified restock rumors.",
    active: true,
  }),
  SourceRegistryEntrySchema.parse({
    id: "clz-import",
    name: "CLZ Comics export",
    authority: "owner_import",
    historicalAccuracy: 0.95,
    latencyHours: 0,
    categoryCoverage: ["comic"],
    accessMethod: "xml_file",
    terms: "Owner data; immutable raw_snapshots.",
    active: true,
  }),
];

export class SourceRegistry {
  private readonly byId = new Map<string, SourceRegistryEntry>();

  constructor(entries: SourceRegistryEntry[] = DEFAULT_SOURCES) {
    for (const e of entries) this.byId.set(e.id, e);
  }

  get(id: string): SourceRegistryEntry | undefined {
    return this.byId.get(id);
  }

  listActive(): SourceRegistryEntry[] {
    return [...this.byId.values()].filter((e) => e.active);
  }

  listAll(): SourceRegistryEntry[] {
    return [...this.byId.values()];
  }
}
