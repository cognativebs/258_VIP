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
  SourceRegistryEntrySchema.parse({
    id: "ebay-browse",
    name: "eBay Browse active listings (ask comps + liquidity proxy)",
    authority: "market",
    historicalAccuracy: 0.4,
    latencyHours: 1,
    categoryCoverage: ["pokemon", "sports", "comic", "tcg"],
    accessMethod: "api",
    terms:
      "buy.browse OAuth; store raw Browse JSON snapshots; asks are inferred · not sold. Swap to sold aggregator behind MarketCompsAdapter when available.",
    active: true,
  }),
  SourceRegistryEntrySchema.parse({
    id: "ebay-sold",
    name: "eBay sold / completed listings",
    authority: "market",
    historicalAccuracy: 0.7,
    latencyHours: 1,
    categoryCoverage: ["comic"],
    accessMethod: "api",
    terms: "Requires EBAY_OAUTH_TOKEN. Sold-ledger preferred; Browse summaries marked unverified until confirmed. Never invent comps when idle.",
    active: true,
  }),
  SourceRegistryEntrySchema.parse({
    id: "tcgplayer-market",
    name: "TCGPlayer market / price history",
    authority: "market",
    historicalAccuracy: 0.75,
    latencyHours: 1,
    categoryCoverage: ["pokemon"],
    accessMethod: "api",
    terms: "Price-history buckets with quantitySold preferred over spot quotes. Adapter-swappable; rate-limit.",
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
