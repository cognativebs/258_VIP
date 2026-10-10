/**
 * SportsCardsPro (PriceCharting's sports host) as the sports card catalog — identification
 * only, for the operator's own tooling (ADR 0010 amendment 2026-10-10). Off unless
 * VIP_CATALOG_SPORTSCARDSPRO=1 and a PriceCharting token are set; prices in the response are
 * never used here (they stay in the raw snapshot, as every provider response does).
 *
 * A product reads "Patrick Mahomes II [Silver Prizm] #269" in "Football Cards 2017 Panini Prizm":
 * player, parallel in brackets, card number; sport, year and set in the console name.
 */
import type { CatalogCard } from "../schemas.js";
import type { CatalogAdapter, CatalogQuery, CatalogRawResponse } from "./types.js";

const HOST = "https://www.sportscardspro.com";
const MAX_RESULTS = 10;
/** OCR words that are on the card but not in product titles. */
const QUERY_SKIP = new Set(["rookie", "rc", "card", "cards", "front", "back", "jpg", "jpeg", "png", "trading", "nfl", "nba", "mlb", "the"]);

export type SportsCardsProFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status?: number; text: () => Promise<string>; headers: { get: (n: string) => string | null } }>;

/** "2017 Panini Prizm Patrick Mahomes II #269 Rookie" → "2017 panini prizm patrick mahomes ii 269". */
export function sportsSearchText(query: Pick<CatalogQuery, "text" | "nameHint" | "collectorNumber">): string {
  const number = query.collectorNumber?.replace(/^#/, "").split("/")[0]?.trim();
  const words = `${query.text} ${query.nameHint ?? ""}`
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/#/g, " ")
    .split(/[^a-z0-9.'-]+/)
    .filter((w) => w && !QUERY_SKIP.has(w));
  const unique = [...new Set(words)];
  if (number && !unique.includes(number.toLowerCase())) unique.push(number.toLowerCase());
  return unique.slice(0, 10).join(" ");
}

type Product = { id?: string | number; "product-name"?: string; "console-name"?: string };

export function parseSportsCardsProProducts(raw: CatalogRawResponse, query: CatalogQuery): CatalogCard[] {
  let products: Product[];
  try {
    const parsed = JSON.parse(raw.payload) as { products?: Product[] };
    products = Array.isArray(parsed.products) ? parsed.products : [];
  } catch {
    return [];
  }
  return products.slice(0, query.limit ?? MAX_RESULTS).flatMap((p) => {
    const id = p.id == null ? "" : String(p.id);
    const title = p["product-name"]?.trim();
    if (!id || !title) return [];
    const consoleName = p["console-name"]?.trim() ?? "";
    const number = /#\s*([A-Za-z0-9-]+)\s*$/.exec(title)?.[1] ?? null;
    const parallel = /\[([^\]]+)\]/.exec(title)?.[1] ?? null;
    const player = title.replace(/\[[^\]]*\]/g, " ").replace(/#\s*[A-Za-z0-9-]+\s*$/, " ").replace(/\s+/g, " ").trim();
    const year = /\b(19|20)\d{2}\b/.exec(consoleName)?.[0];
    const setName = consoleName.replace(/^\w+ Cards\s+/i, "").replace(/^(19|20)\d{2}\s+/, "").trim() || null;
    return [
      {
        catalogKey: `sports:sportscardspro:${id}`,
        category: "sports" as const,
        displayName: parallel ? `${player} [${parallel}]` : player,
        setName,
        collectorNumber: number,
        playerOrCharacter: player,
        year: year ? Number(year) : null,
        searchText: `${title} ${consoleName}`,
        externalIds: [{ source: "sportscardspro", value: id }],
      },
    ];
  });
}

export function createSportsCardsProCatalogAdapter(opts: { token: string; fetch?: SportsCardsProFetch }): CatalogAdapter {
  const fetchImpl = opts.fetch ?? fetch;
  const fetchRaw = async (query: CatalogQuery): Promise<CatalogRawResponse | null> => {
    if (query.category && query.category !== "sports") return null;
    const q = sportsSearchText(query);
    if (q.split(" ").length < 2) return null; // a lone token matches thousands of cards
    const params = new URLSearchParams({ t: opts.token, q });
    const res = await fetchImpl(`${HOST}/api/products?${params.toString()}`, { headers: { accept: "application/json" } });
    // Never echo the URL: it carries the token.
    if (!res.ok) throw new Error(`SportsCardsPro HTTP ${res.status ?? "error"}`);
    const payload = await res.text();
    if (/"status"\s*:\s*"error"/.test(payload)) throw new Error("SportsCardsPro returned an error status");
    return { payload, contentType: res.headers.get("content-type") ?? "application/json" };
  };
  return {
    id: "sportscardspro",
    label: "SportsCardsPro (sports, identification only)",
    categories: ["sports"],
    timeoutMs: 8000,
    fetchRaw,
    parseRaw: parseSportsCardsProProducts,
    async search(query) {
      const raw = await fetchRaw(query);
      return raw ? parseSportsCardsProProducts(raw, query) : [];
    },
  };
}
