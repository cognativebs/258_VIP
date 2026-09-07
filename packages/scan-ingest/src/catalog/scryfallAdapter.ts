import type { CatalogCard } from "../schemas.js";
import type {
  CatalogAdapter,
  CatalogQuery,
  CatalogRawResponse,
} from "./types.js";

const SCRYFALL = "https://api.scryfall.com/cards/search";
const DEFAULT_USER_AGENT =
  "VIP-IQVault-Catalog/0.1 (internal identification; +https://github.com/cognativebs/258_vip)";
const DEFAULT_MIN_INTERVAL_MS = 75;

export type ScryfallFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
}>;

type ScryfallCard = {
  id?: string;
  oracle_id?: string;
  name?: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  released_at?: string;
};

type ScryfallList = {
  object?: string;
  data?: ScryfallCard[];
};

export function parseScryfallCards(
  raw: CatalogRawResponse,
  query: CatalogQuery,
): CatalogCard[] {
  let body: ScryfallList;
  try {
    body = JSON.parse(raw.payload) as ScryfallList;
  } catch {
    return [];
  }
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.slice(0, query.limit ?? 5).map((row) => {
    const year = row.released_at ? Number(row.released_at.slice(0, 4)) : null;
    return {
      catalogKey: `mtg:scryfall:${row.id ?? row.name}`,
      category: "mtg" as const,
      displayName: row.name ?? "Unknown",
      setName: row.set_name ?? row.set ?? null,
      collectorNumber: row.collector_number ?? null,
      playerOrCharacter: row.name ?? null,
      year: Number.isFinite(year) ? year : null,
      searchText: `${row.name ?? ""} ${row.set_name ?? ""} ${row.set ?? ""} ${row.collector_number ?? ""}`,
      externalIds: [
        ...(row.id ? [{ source: "scryfall", value: row.id }] : []),
        ...(row.oracle_id
          ? [{ source: "scryfall_oracle", value: row.oracle_id }]
          : []),
      ],
    };
  });
}

function searchQuery(text: string): string {
  return text.trim().split(/\s+/).slice(0, 8).join(" ");
}

export async function fetchScryfallRaw(
  query: CatalogQuery,
  opts: {
    fetch?: ScryfallFetch;
    userAgent?: string;
    throttle?: () => Promise<void>;
  } = {},
): Promise<CatalogRawResponse | null> {
  const q = searchQuery(query.text);
  if (!q) return null;
  if (query.category && query.category !== "mtg") return null;
  if (opts.throttle) await opts.throttle();
  const fetchImpl = opts.fetch ?? fetch;
  const url = `${SCRYFALL}?q=${encodeURIComponent(q)}&unique=prints`;
  const res = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
    },
  });
  if (res.status === 404) return null;
  if (res.status === 429) {
    throw new Error(
      `scryfall rate-limited (429)${res.headers.get("retry-after") ? ` retry-after=${res.headers.get("retry-after")}` : ""}`,
    );
  }
  if (!res.ok) return null;
  const payload = await res.text();
  return {
    payload,
    contentType: res.headers.get("content-type") ?? "application/json",
  };
}

function createThrottle(minIntervalMs: number): () => Promise<void> {
  let lastAt = 0;
  return async () => {
    const wait = lastAt + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  };
}

/**
 * Magic catalog via Scryfall search. Free, no key.
 * Honour their 50–100ms guidance and identify the app (ADR 0010 / plan 0001 Phase 2).
 * Catalog truth only — never a valuation (rule 4).
 */
export function createScryfallCatalogAdapter(
  opts: {
    fetch?: ScryfallFetch;
    userAgent?: string;
    minIntervalMs?: number;
  } = {},
): CatalogAdapter {
  const throttle = createThrottle(opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
  const fetchRaw = (query: CatalogQuery) =>
    fetchScryfallRaw(query, {
      fetch: opts.fetch,
      userAgent: opts.userAgent,
      throttle,
    });
  return {
    id: "scryfall",
    label: "Scryfall (mtg)",
    categories: ["mtg"],
    timeoutMs: 2000,
    fetchRaw,
    parseRaw: parseScryfallCards,
    async search(query: CatalogQuery): Promise<CatalogCard[]> {
      const raw = await fetchRaw(query);
      if (!raw) return [];
      return parseScryfallCards(raw, query);
    },
  };
}
