import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CardResult } from "./contracts";
import { raritiesForKeys, type SetOption } from "./filters";
import { mergeSets, SEED_SETS } from "./set-catalog";

/**
 * Swappable data-source adapters (AGENTS.md rule 5).
 *
 * Rarity ("type") filters are intentionally exact and mostly client-side:
 * pokemontcg.io fuzzy-matches rarity strings (IR ⊆ SIR) and often 500s when
 * rarity is combined with set/name. We paginate the safe query, then exact-match.
 */

const TCGDEX_BASE = "https://api.tcgdex.net/v2/en";
const POKEMONTCG_BASE = "https://api.pokemontcg.io/v2";

export type SearchFilters = {
  setId?: string | null;
  /** Chip keys — multiple means OR across their exact rarity strings. */
  rarityKeys: string[];
};

type BriefTcgdexCard = { id: string; localId?: string; name: string; image?: string };

type PokemonTcgCard = {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  set?: { id?: string; name?: string };
  images?: { small?: string; large?: string };
  tcgplayer?: {
    url?: string;
    prices?: Record<string, { market?: number | null } | undefined>;
  };
};

function ptcgHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;
  return headers;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPokemonPage(
  q: string,
  page: number,
  pageSize: number,
  /** Pass null to omit orderBy (more reliable for set.id browse). */
  orderBy: string | null = "-set.releaseDate",
): Promise<{ data: PokemonTcgCard[]; totalCount: number }> {
  let url =
    `${POKEMONTCG_BASE}/cards?q=${encodeURIComponent(q)}` +
    `&pageSize=${pageSize}&page=${page}`;
  if (orderBy) url += `&orderBy=${encodeURIComponent(orderBy)}`;

  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: ptcgHeaders() });
    lastStatus = res.status;
    if (res.ok) {
      const body = (await res.json()) as {
        data?: PokemonTcgCard[];
        totalCount?: number;
      };
      return { data: body.data ?? [], totalCount: body.totalCount ?? 0 };
    }
    if (res.status < 500) break;
    await sleep(250 * (attempt + 1));
  }
  throw new Error(`pokemontcg ${lastStatus}`);
}

/** Paginate a safe upstream query (no rarity+set/name combo). */
async function fetchPokemonPages(
  q: string,
  opts: { maxCards: number; maxPages?: number; orderBy?: string | null },
): Promise<PokemonTcgCard[]> {
  const pageSize = 250;
  const maxPages = opts.maxPages ?? 8;
  // undefined → default sort; null → omit (set browse).
  const orderBy = opts.orderBy === undefined ? "-set.releaseDate" : opts.orderBy;
  const out: PokemonTcgCard[] = [];
  let totalCount = Infinity;
  for (let page = 1; page <= maxPages && out.length < opts.maxCards && out.length < totalCount; page++) {
    try {
      const { data, totalCount: total } = await fetchPokemonPage(q, page, pageSize, orderBy);
      if (total > 0) totalCount = total;
      out.push(...data);
      if (data.length < pageSize) break;
    } catch (err) {
      // pokemontcg.io intermittently 500s on later pages — keep what we have.
      if (out.length) break;
      throw err;
    }
  }
  return out;
}

function exactRarity(card: PokemonTcgCard, allow: Set<string>): boolean {
  return !!card.rarity && allow.has(card.rarity.toLowerCase());
}

function nameMatches(card: PokemonTcgCard, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  return card.name.toLowerCase().includes(n);
}

/**
 * Pull cards for each exact rarity string until we have enough exact matches.
 * Upstream fuzzy-matching is stripped by the exact filter.
 */
async function fetchByExactRarities(
  rarityValues: string[],
  want: number,
): Promise<PokemonTcgCard[]> {
  const allow = new Set(rarityValues.map((r) => r.toLowerCase()));
  const out: PokemonTcgCard[] = [];
  const seen = new Set<string>();

  for (const rarity of rarityValues) {
    if (out.length >= want) break;
    const q = `rarity:${quote(rarity)}`;
    // Walk pages until we gather enough *exact* matches for this rarity.
    for (let page = 1; page <= 10 && out.length < want; page++) {
      const { data } = await fetchPokemonPage(q, page, 250);
      for (const c of data) {
        if (!exactRarity(c, allow) || seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
        if (out.length >= want) break;
      }
      if (data.length < 250) break;
    }
  }
  return out;
}

function toCardResult(c: PokemonTcgCard): CardResult {
  const market = pickMarketPrice(c);
  return {
    source: "pokemontcg",
    externalId: c.id,
    name: c.name,
    setName: c.set?.name ?? null,
    number: c.number ?? null,
    rarity: c.rarity ?? null,
    imageSmall: c.images?.small ?? null,
    imageHigh: c.images?.large ?? null,
    priceMarket: market,
    priceCurrency: market != null ? "USD" : null,
    provenance: {
      method: "api",
      source: "pokemontcg.io/v2",
      modelVersion: "ptcg-v2",
      confidence: 0.92,
      verificationStatus: "verified",
    },
  };
}

function pickMarketPrice(card: PokemonTcgCard): number | null {
  const prices = card.tcgplayer?.prices;
  if (!prices) return null;
  const order = ["holofoil", "reverseHolofoil", "normal", "1stEditionHolofoil"];
  for (const key of order) {
    const m = prices[key]?.market;
    if (typeof m === "number") return m;
  }
  for (const v of Object.values(prices)) {
    if (typeof v?.market === "number") return v.market;
  }
  return null;
}

/** In-process cache — Mega sets need TCGPlayer fallback on every search/place. */
const marketPriceCache = new Map<string, { price: number | null; at: number }>();
const MARKET_PRICE_TTL_MS = 60 * 60 * 1000;

function cachedMarketPrice(externalId: string): number | null | undefined {
  const hit = marketPriceCache.get(externalId);
  if (!hit) return undefined;
  if (Date.now() - hit.at > MARKET_PRICE_TTL_MS) {
    marketPriceCache.delete(externalId);
    return undefined;
  }
  return hit.price;
}

function rememberMarketPrice(externalId: string, price: number | null) {
  marketPriceCache.set(externalId, { price, at: Date.now() });
}

/**
 * Fetch a single card's market price.
 * Mega / new sets often have no embedded tcgplayer.prices, and /cards/{id}
 * intermittently 500s — always fall through to the TCGPlayer redirect path.
 * Never throws (place/sync treat null as "unpriced").
 */
export async function fetchCardMarketPrice(
  externalId: string,
): Promise<{
  priceMarket: number | null;
  priceCurrency: string | null;
  rarity: string | null;
  priceSource: string;
}> {
  const cached = cachedMarketPrice(externalId);
  if (cached !== undefined) {
    return {
      priceMarket: cached,
      priceCurrency: cached != null ? "USD" : null,
      rarity: null,
      priceSource: cached != null ? "tcgplayer.com" : "none",
    };
  }

  let rarity: string | null = null;

  try {
    const url = `${POKEMONTCG_BASE}/cards/${encodeURIComponent(externalId)}`;
    let res = await fetch(url, { headers: ptcgHeaders() });
    if (!res.ok && res.status >= 500) {
      await sleep(250);
      res = await fetch(url, { headers: ptcgHeaders() });
    }
    if (res.ok) {
      const body = (await res.json()) as { data?: PokemonTcgCard };
      const card = body.data;
      if (card) {
        rarity = card.rarity ?? null;
        const embedded = pickMarketPrice(card);
        if (embedded != null) {
          rememberMarketPrice(externalId, embedded);
          return {
            priceMarket: embedded,
            priceCurrency: "USD",
            rarity,
            priceSource: "pokemontcg.io/tcgplayer",
          };
        }
      }
    }
  } catch {
    // Fall through — redirect path does not need a healthy card GET.
  }

  // Newer Mega Evolution sets ship without embedded prices; also used when
  // pokemontcg.io /cards/{id} 500s. prices.pokemontcg.io → TCGPlayer product.
  const fallback = await fetchTcgplayerMarketViaRedirect(externalId);
  return {
    priceMarket: fallback,
    priceCurrency: fallback != null ? "USD" : null,
    rarity,
    priceSource: fallback != null ? "tcgplayer.com" : "none",
  };
}

/**
 * Fill null priceMarket on search results via TCGPlayer (cached, concurrent).
 * Skips pokemontcg /cards/{id} — search already proved embedded prices are absent,
 * and that endpoint 500s often on Mega sets.
 */
async function enrichMissingPrices(
  cards: CardResult[],
  concurrency = 8,
): Promise<CardResult[]> {
  const need = cards.filter(
    (c) => c.source === "pokemontcg" && c.priceMarket == null && c.externalId,
  );
  if (!need.length) return cards;

  for (let i = 0; i < need.length; i += concurrency) {
    const batch = need.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (card) => {
        const price = await fetchTcgplayerMarketViaRedirect(card.externalId);
        if (price == null) return;
        card.priceMarket = price;
        card.priceCurrency = "USD";
        card.provenance = {
          ...card.provenance,
          source: "tcgplayer.com",
          method: "api",
          verificationStatus: "verified",
          confidence: 0.85,
        };
      }),
    );
  }
  return cards;
}

async function fetchTcgplayerMarketViaRedirect(externalId: string): Promise<number | null> {
  const cached = cachedMarketPrice(externalId);
  if (cached !== undefined) return cached;

  const productId = await resolveTcgplayerProductId(externalId);
  if (!productId) {
    rememberMarketPrice(externalId, null);
    return null;
  }

  const priceUrl = `https://infinite-api.tcgplayer.com/price/history/${productId}/detailed?range=quarter`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(priceUrl, {
        headers: { accept: "application/json", "user-agent": "BinderVault/0.1" },
      });
      if (!res.ok) {
        if (res.status >= 500) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        rememberMarketPrice(externalId, null);
        return null;
      }
      const body = (await res.json()) as {
        result?: Array<{
          condition?: string;
          variant?: string;
          buckets?: Array<{ marketPrice?: string | number }>;
        }>;
      };
      const rows = body.result ?? [];
      const prefer = (cond: string, variant?: string) =>
        rows.find(
          (r) =>
            (r.condition ?? "").toLowerCase() === cond.toLowerCase() &&
            (!variant || (r.variant ?? "").toLowerCase() === variant.toLowerCase()) &&
            r.buckets?.[0]?.marketPrice != null &&
            Number(r.buckets[0].marketPrice) > 0,
        );

      const pick =
        prefer("Near Mint", "Holofoil") ||
        prefer("Near Mint", "Normal") ||
        prefer("Near Mint", "Reverse Holofoil") ||
        prefer("Near Mint") ||
        rows.find(
          (r) => r.buckets?.[0]?.marketPrice != null && Number(r.buckets[0].marketPrice) > 0,
        );

      const raw = pick?.buckets?.[0]?.marketPrice;
      const n = typeof raw === "number" ? raw : Number(raw);
      const price = Number.isFinite(n) && n > 0 ? n : null;
      rememberMarketPrice(externalId, price);
      return price;
    } catch {
      await sleep(300 * (attempt + 1));
    }
  }
  rememberMarketPrice(externalId, null);
  return null;
}

function extractTcgplayerProductId(text: string): string | null {
  if (!text) return null;
  // Affiliate redirects often look like:
  // tcgplayer.pxf.io/scrydex?u=https://tcgplayer.com/product/693516
  // or with a URL-encoded nested target.
  const candidates = [text];
  try {
    candidates.push(decodeURIComponent(text));
  } catch {
    /* ignore malformed encoding */
  }
  for (const c of candidates) {
    const m = c.match(/product\/(\d+)/i);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Alternate ids when prices.pokemontcg.io 404s (e.g. sm12-143a → sm12-143). */
function priceIdCandidates(externalId: string): string[] {
  const out = [externalId];
  const m = externalId.match(/^(.+-)(\d+)([a-z]+)$/i);
  if (m) out.push(`${m[1]}${m[2]}`);
  return out;
}

async function resolveTcgplayerProductId(externalId: string): Promise<string | null> {
  for (const id of priceIdCandidates(externalId)) {
    const found = await resolveOneTcgplayerProductId(id);
    if (found) return found;
  }
  return null;
}

async function resolveOneTcgplayerProductId(externalId: string): Promise<string | null> {
  const url = `https://prices.pokemontcg.io/tcgplayer/${encodeURIComponent(externalId)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": "BinderVault/0.1" },
      });
      const loc = res.headers.get("location") || "";
      const fromLoc = extractTcgplayerProductId(loc);
      if (fromLoc) return fromLoc;

      const html = await res.text().catch(() => "");
      const fromHtml = extractTcgplayerProductId(html);
      if (fromHtml) return fromHtml;

      if (res.status >= 500) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      return null;
    } catch {
      await sleep(250 * (attempt + 1));
    }
  }
  return null;
}

async function searchTcgdex(
  query: string,
  limit: number,
  filters: SearchFilters,
): Promise<CardResult[]> {
  // No reliable rarity on brief cards — skip when rarity filter is on.
  if (filters.rarityKeys.length) return [];
  // Set dropdown IDs come from pokemontcg.io; TCGdex uses different set ids
  // (e.g. sv08 vs sv8) and 404s on the pokemontcg id — skip set-scoped searches.
  if (filters.setId) return [];

  const q = query.trim();
  if (!q) return [];

  const url = `${TCGDEX_BASE}/cards?name=eq:${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`tcgdex ${res.status}`);
  const json = await res.json();

  let rows: BriefTcgdexCard[] = [];
  if (Array.isArray(json)) rows = json as BriefTcgdexCard[];
  else if (json && Array.isArray(json.cards)) rows = json.cards as BriefTcgdexCard[];

  return rows.slice(0, limit).map((c) => {
    const setId = c.id.includes("-") ? c.id.split("-")[0]! : null;
    return {
      source: "tcgdex" as const,
      externalId: c.id,
      name: c.name,
      setName: setId,
      number: c.localId ?? null,
      rarity: null,
      imageSmall: c.image ? `${c.image}/low.webp` : null,
      imageHigh: c.image ? `${c.image}/high.png` : null,
      priceMarket: null,
      priceCurrency: null,
      provenance: {
        method: "api" as const,
        source: "tcgdex.net/v2",
        modelVersion: "tcgdex-v2",
        confidence: 0.9,
        verificationStatus: "verified" as const,
      },
    };
  });
}

/** Pull the first integer from a collector number (handles SM01, SWSH045, 123/185). */
function collectorNumber(n: string | undefined): number {
  if (!n) return Number.POSITIVE_INFINITY;
  const m = n.match(/(\d+)/);
  return m ? Number.parseInt(m[1]!, 10) : Number.POSITIVE_INFINITY;
}

/** Sort set browse by collector number (numeric when possible). */
function byCardNumber(a: PokemonTcgCard, b: PokemonTcgCard): number {
  const an = collectorNumber(a.number);
  const bn = collectorNumber(b.number);
  if (an !== bn) return an - bn;
  return (a.number ?? "").localeCompare(b.number ?? "", undefined, { numeric: true });
}

/**
 * Reliable pokemontcg search with exact rarity filtering.
 *
 * Strategies (never send rarity+set or rarity+name upstream together):
 *  - set present → fetch whole set, filter name/rarity locally
 *  - rarity only → paginate each rarity string, exact-match
 *  - name + rarity → paginate name hits, exact-match rarity; fallback rarity→name
 *  - name only → normal name query
 */
async function searchPokemonTcg(
  query: string,
  limit: number,
  filters: SearchFilters,
): Promise<CardResult[]> {
  const name = query.trim();
  const setId = filters.setId?.trim() || null;
  const rarityValues = filters.rarityKeys?.length
    ? raritiesForKeys(filters.rarityKeys)
    : [];
  const allow = rarityValues.length
    ? new Set(rarityValues.map((r) => r.toLowerCase()))
    : null;

  let rows: PokemonTcgCard[] = [];

  if (setId) {
    // Full set pull — promo sets can exceed 250; paginate + filter locally.
    // Rarity/name filters must NOT truncate the upstream set fetch.
    // Omit orderBy for set browse — releaseDate sort is useless in-set and 500s more.
    rows = await fetchPokemonPages(`set.id:${setId}`, {
      maxCards: 1000,
      maxPages: 5,
      orderBy: null,
    });
    rows.sort(byCardNumber);
    if (name) rows = rows.filter((c) => nameMatches(c, name));
    if (allow) rows = rows.filter((c) => exactRarity(c, allow));
  } else if (allow && name) {
    // Name first (paginate), then exact rarity.
    rows = await fetchPokemonPages(`name:${quote(name + "*")}`, {
      maxCards: 500,
      maxPages: 4,
    });
    rows = rows.filter((c) => exactRarity(c, allow));

    // Fallback if the name page didn't include the chase printings.
    if (rows.length < Math.min(limit, 4)) {
      const fromRarity = await fetchByExactRarities(rarityValues, Math.max(limit * 8, 80));
      const extra = fromRarity.filter((c) => nameMatches(c, name));
      const seen = new Set(rows.map((c) => c.id));
      for (const c of extra) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        rows.push(c);
      }
    }
  } else if (allow) {
    rows = await fetchByExactRarities(rarityValues, Math.max(limit, 24));
  } else if (name) {
    rows = await fetchPokemonPages(`name:${quote(name + "*")}`, {
      maxCards: limit,
      maxPages: 1,
    });
  } else {
    return [];
  }

  // Mega / new sets return tcgplayer.url with no prices — fill via TCGPlayer.
  return enrichMissingPrices(rows.slice(0, limit).map(toCardResult));
}

export type CardSource = "all" | "tcgdex" | "pokemontcg";

export async function searchCards(
  query: string,
  opts: {
    source?: CardSource;
    limit?: number;
    setId?: string | null;
    /** Single key, comma-separated keys, or array of chip keys. */
    rarityKeys?: string | string[] | null;
  } = {},
): Promise<{ results: CardResult[]; errors: string[]; queryUsed: string }> {
  const q = query.trim();
  const rarityKeys = normalizeRarityKeys(opts.rarityKeys);
  const filters: SearchFilters = {
    setId: opts.setId?.trim() || null,
    rarityKeys,
  };
  const hasFilters = !!(filters.setId || filters.rarityKeys.length);
  if (!q && !hasFilters) return { results: [], errors: [], queryUsed: "" };

  const limit = opts.limit ?? 24;
  const source = opts.source ?? "all";
  const errors: string[] = [];

  // Set IDs + rarity chips both need pokemontcg — TCGdex set ids don't match.
  const effectiveSource: CardSource =
    filters.rarityKeys.length || filters.setId ? "pokemontcg" : source;

  // Set-scoped search always returns the full filtered set (promo sets ~250–400).
  // Name search stays at the caller limit. Rarity is applied locally after fetch.
  const effectiveLimit = filters.setId ? Math.max(limit, 500) : limit;

  const tasks: Promise<CardResult[]>[] = [];
  if (effectiveSource === "all" || effectiveSource === "pokemontcg") {
    tasks.push(
      searchPokemonTcg(q, effectiveLimit, filters).catch((e) => (errors.push(String(e)), [])),
    );
  }
  if (effectiveSource === "all" || effectiveSource === "tcgdex") {
    tasks.push(
      searchTcgdex(q, effectiveLimit, filters).catch((e) => (errors.push(String(e)), [])),
    );
  }

  const settled = await Promise.all(tasks);
  const merged = settled.flat();
  const seen = new Map<string, CardResult>();
  for (const c of merged) {
    const dedupeKey = `${c.name.toLowerCase()}::${c.number ?? ""}::${(c.setName ?? "").toLowerCase()}`;
    const existing = seen.get(dedupeKey);
    if (!existing || (existing.source === "tcgdex" && c.source === "pokemontcg")) {
      seen.set(dedupeKey, c);
    }
  }

  const queryUsed = [
    q ? `name:${quote(q + "*")}` : null,
    filters.setId ? `set.id:${filters.setId}` : null,
    filters.rarityKeys.length ? `rarityExact:${filters.rarityKeys.join(",")}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    results: [...seen.values()].slice(0, effectiveLimit),
    errors,
    queryUsed,
  };
}

function normalizeRarityKeys(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(",");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const key = part.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

const SETS_CACHE_PATH = join(process.cwd(), ".data", "sets-cache.json");

function readSetsCache(): SetOption[] {
  try {
    const raw = readFileSync(SETS_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { sets?: SetOption[] };
    return Array.isArray(parsed.sets) ? parsed.sets : [];
  } catch {
    return [];
  }
}

function writeSetsCache(sets: SetOption[]) {
  try {
    mkdirSync(dirname(SETS_CACHE_PATH), { recursive: true });
    writeFileSync(
      SETS_CACHE_PATH,
      JSON.stringify({ savedAt: Date.now(), sets }, null, 0),
      "utf8",
    );
  } catch {
    /* cache is best-effort */
  }
}

async function fetchPokemonSetsPage(pageSize: number): Promise<SetOption[]> {
  // Smaller pages are less likely to 500 on pokemontcg's flaky /sets endpoint.
  const size = Math.min(Math.max(pageSize, 20), 100);
  const url = `${POKEMONTCG_BASE}/sets?orderBy=-releaseDate&pageSize=${size}`;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: ptcgHeaders() });
    lastStatus = res.status;
    if (res.ok) {
      const body = (await res.json()) as {
        data?: Array<{ id: string; name: string; series?: string; releaseDate?: string }>;
      };
      return (body.data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        series: s.series ?? "",
        releaseDate: s.releaseDate ?? "",
      }));
    }
    if (res.status < 500) break;
    await sleep(200 * (attempt + 1));
  }
  throw new Error(`pokemontcg sets ${lastStatus}`);
}

/**
 * Always returns a usable list. Seed catalog is instant; live API + disk cache
 * expand it when pokemontcg cooperates (their /sets endpoint 500s often).
 */
export async function listSets(limit = 250): Promise<SetOption[]> {
  const cached = readSetsCache();
  let remote: SetOption[] = [];
  try {
    remote = await fetchPokemonSetsPage(Math.min(limit, 100));
    if (remote.length) writeSetsCache(mergeSets(remote, cached, SEED_SETS));
  } catch {
    /* fall through to cache + seed */
  }
  const merged = mergeSets(remote, cached, SEED_SETS);
  return merged.slice(0, Math.min(limit, 400));
}
