import { readFileSync } from "node:fs";
import type { CatalogCard } from "../schemas.js";
import type { CatalogAdapter, CatalogQuery } from "./types.js";

export type MtgjsonIdentifiers = {
  scryfallId?: string;
  scryfallOracleId?: string;
  mtgjsonV4Id?: string;
};

export type MtgjsonMirrorCard = {
  name: string;
  setCode?: string;
  setName?: string;
  number?: string;
  identifiers?: MtgjsonIdentifiers;
};

export type MtgjsonMirrorPayload = {
  cards?: MtgjsonMirrorCard[];
  data?: Record<
    string,
    {
      name?: string;
      cards?: Array<{
        name?: string;
        number?: string;
        identifiers?: MtgjsonIdentifiers;
      }>;
    }
  >;
};

/** Compact Lightning Bolt + Black Lotus slice for tests / optional demo path. */
export const MTGJSON_MIRROR_SAMPLE: MtgjsonMirrorPayload = {
  cards: [
    {
      name: "Lightning Bolt",
      setCode: "lea",
      setName: "Limited Edition Alpha",
      number: "161",
      identifiers: {
        scryfallId: "e3285e6b-3e79-4d4d-9025-9a4c73772a36",
        scryfallOracleId: "e3285e6b-3e79-4d4d-9025-9a4c73772a36",
      },
    },
    {
      name: "Black Lotus",
      setCode: "lea",
      setName: "Limited Edition Alpha",
      number: "232",
      identifiers: {
        scryfallId: "bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd",
      },
    },
  ],
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9/#.\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function flattenMtgjsonMirror(payload: MtgjsonMirrorPayload): MtgjsonMirrorCard[] {
  if (Array.isArray(payload.cards) && payload.cards.length > 0) {
    return payload.cards.filter((card) => card.name);
  }
  const out: MtgjsonMirrorCard[] = [];
  for (const [setCode, set] of Object.entries(payload.data ?? {})) {
    for (const card of set.cards ?? []) {
      if (!card.name) continue;
      out.push({
        name: card.name,
        setCode,
        setName: set.name,
        number: card.number,
        identifiers: card.identifiers,
      });
    }
  }
  return out;
}

export function mtgjsonCardsToCatalog(
  cards: MtgjsonMirrorCard[],
  query: CatalogQuery,
): CatalogCard[] {
  const limit = query.limit ?? 5;
  const q = normalize(query.text);
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  if (tokens.length === 0 && (query.externalIds?.length ?? 0) === 0) return [];

  const mapped = cards.map((card) => {
    const scryfallId = card.identifiers?.scryfallId;
    const oracleId = card.identifiers?.scryfallOracleId;
    const mtgjsonId = card.identifiers?.mtgjsonV4Id;
    return {
      catalogKey: `mtg:mtgjson:${card.setCode ?? "unk"}:${card.number ?? card.name}`,
      category: "mtg" as const,
      displayName: card.name,
      setName: card.setName ?? card.setCode ?? null,
      collectorNumber: card.number ?? null,
      playerOrCharacter: card.name,
      year: null,
      searchText: `${card.name} ${card.setName ?? ""} ${card.setCode ?? ""} ${card.number ?? ""}`,
      externalIds: [
        ...(scryfallId ? [{ source: "scryfall", value: scryfallId }] : []),
        ...(oracleId ? [{ source: "scryfall_oracle", value: oracleId }] : []),
        ...(mtgjsonId ? [{ source: "mtgjson", value: mtgjsonId }] : []),
      ],
    } satisfies CatalogCard;
  });

  if (query.externalIds?.length) {
    const hits = mapped.filter((card) =>
      card.externalIds.some((ext) =>
        query.externalIds!.some(
          (want) =>
            want.source.toLowerCase() === ext.source.toLowerCase() &&
            want.value.toLowerCase() === ext.value.toLowerCase(),
        ),
      ),
    );
    if (hits.length > 0) return hits.slice(0, limit);
  }

  return mapped
    .filter((card) => {
      const hay = normalize(card.searchText);
      return tokens.some((token) => hay.includes(token));
    })
    .slice(0, limit);
}

export function loadMtgjsonMirror(path: string): MtgjsonMirrorCard[] {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as MtgjsonMirrorPayload;
  return flattenMtgjsonMirror(parsed);
}

/**
 * Offline Magic catalog from a local MTGJSON dump (AllPrintings subset or
 * compact `{ cards: [...] }`). Prefer this over Scryfall when the file exists
 * (plan 0001 Phase 2). Empty when no path/cards — Scryfall is the fallback.
 */
export function createMtgjsonCatalogAdapter(opts: {
  path?: string | null;
  cards?: MtgjsonMirrorCard[];
  payload?: MtgjsonMirrorPayload;
} = {}): CatalogAdapter {
  let cards: MtgjsonMirrorCard[] = opts.cards ?? [];
  if (opts.payload) cards = flattenMtgjsonMirror(opts.payload);
  if (opts.path) {
    try {
      cards = loadMtgjsonMirror(opts.path);
    } catch {
      cards = [];
    }
  }

  return {
    id: "mtgjson",
    label: "MTGJSON local mirror (mtg)",
    categories: ["mtg"],
    timeoutMs: 400,
    async search(query: CatalogQuery): Promise<CatalogCard[]> {
      if (query.category && query.category !== "mtg") return [];
      return mtgjsonCardsToCatalog(cards, query);
    },
  };
}
