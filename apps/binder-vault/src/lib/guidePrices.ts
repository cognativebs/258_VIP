import type { CardResult, Provenance } from "./contracts";
import { VIP_API } from "./vipWrite";

/**
 * Binder prices = the PriceCharting guide VIP stores (vault_market.card_price_history), read through the
 * VIP API (GET /api/pokemon/guide). Owner decision 2026-10-22: PriceCharting replaces TCGplayer, whose
 * price API now refuses Binder (403).
 *
 * The pocket shows the latest ungraded guide value; it is a vendor guide with NM assumed, so provenance
 * stays "unverified", and the range behind it travels in the provenance note. A card VIP has not priced
 * yet stays unpriced: the hourly pokemon-prices pass picks up newly placed cards. Never invents a price.
 */

export const GUIDE_SOURCE = "pricecharting guide via VIP";
export const GUIDE_RULE = "pricecharting-pokemon-cards@0.1.0";

export type GuidePrice = {
  latest: number;
  low: number;
  high: number;
  latestOn: string;
  snapshots: number;
  confidence: number;
  note: string;
};

type GuideRange = {
  condition: string;
  conditionAssumed: boolean;
  low: number;
  high: number;
  latest: number;
  latestOn: string;
  snapshots: number;
  confidence: number;
  note: string;
};

/** The ungraded (NM-assumed) range VIP holds for each id; ids without one are absent. Never throws. */
export async function fetchGuidePrices(
  ids: ReadonlyArray<string>,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Map<string, GuidePrice>> {
  const out = new Map<string, GuidePrice>();
  const unique = [...new Set(ids.filter(Boolean))];
  const fetchImpl = opts.fetchImpl ?? fetch;
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 2000);
    try {
      const res = await fetchImpl(`${VIP_API}/api/pokemon/guide?ids=${encodeURIComponent(chunk.join(","))}`, {
        cache: "no-store",
        signal: ac.signal,
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { cards?: { externalId: string; ranges: GuideRange[] }[] };
      for (const card of body.cards ?? []) {
        const nm = card.ranges.find((r) => r.condition === "NM");
        if (!nm) continue;
        out.set(card.externalId, {
          latest: nm.latest,
          low: nm.low,
          high: nm.high,
          latestOn: nm.latestOn,
          snapshots: nm.snapshots,
          confidence: nm.confidence,
          note: nm.note,
        });
      }
    } catch {
      /* VIP down or slow: the cards stay unpriced, never guessed */
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

export function guideRangeLabel(g: GuidePrice): string {
  const range = g.low === g.high ? `$${g.latest.toFixed(2)}` : `$${g.low.toFixed(2)}–$${g.high.toFixed(2)}`;
  return `${range} · ${g.snapshots} snapshot${g.snapshots === 1 ? "" : "s"} to ${g.latestOn} · NM assumed · unverified`;
}

export function guideProvenance(g: GuidePrice): Provenance {
  return {
    method: "api",
    source: `${GUIDE_SOURCE} (${guideRangeLabel(g)})`,
    modelVersion: GUIDE_RULE,
    confidence: g.confidence,
    verificationStatus: "unverified",
  };
}

/** Fill priceMarket on search results from the guide (one VIP call). Results keep their catalog provenance. */
export async function withGuidePrices(cards: CardResult[], timeoutMs = 1500): Promise<CardResult[]> {
  const ids = cards.filter((c) => c.source === "pokemontcg").map((c) => c.externalId);
  if (!ids.length) return cards;
  const guide = await fetchGuidePrices(ids, { timeoutMs });
  for (const card of cards) {
    const g = card.source === "pokemontcg" ? guide.get(card.externalId) : undefined;
    if (!g) continue;
    card.priceMarket = g.latest;
    card.priceCurrency = "USD";
  }
  return cards;
}
