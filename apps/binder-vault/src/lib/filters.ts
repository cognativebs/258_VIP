/**
 * Collector-facing rarity chips. Each maps to one or more pokemontcg.io rarity
 * strings used in the `q=` Lucene-style filter.
 */

export type RarityFilter = {
  key: string;
  label: string;
  /** Exact rarity strings accepted by pokemontcg.io /v2/rarities */
  rarities: string[];
};

export const RARITY_FILTERS: RarityFilter[] = [
  { key: "common", label: "Common", rarities: ["Common"] },
  { key: "uncommon", label: "Uncommon", rarities: ["Uncommon"] },
  { key: "rare", label: "Rare", rarities: ["Rare"] },
  { key: "holo", label: "Holo", rarities: ["Rare Holo"] },
  { key: "double", label: "Double Rare", rarities: ["Double Rare"] },
  { key: "ir", label: "IR", rarities: ["Illustration Rare"] },
  { key: "sir", label: "SIR", rarities: ["Special Illustration Rare"] },
  { key: "ur", label: "UR", rarities: ["Ultra Rare"] },
  { key: "hr", label: "HR", rarities: ["Hyper Rare"] },
  { key: "mhr", label: "Mega HR", rarities: ["Mega Hyper Rare"] },
  {
    key: "shiny",
    label: "Shiny",
    rarities: ["Shiny Rare", "Shiny Ultra Rare", "Rare Shiny", "Rare Shiny GX"],
  },
  { key: "ace", label: "ACE SPEC", rarities: ["ACE SPEC Rare", "Rare ACE"] },
  { key: "promo", label: "Promo", rarities: ["Promo"] },
];

export type SetOption = {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
};

export function rarityFilterByKey(key: string): RarityFilter | null {
  return RARITY_FILTERS.find((r) => r.key === key) ?? null;
}

/** Union exact rarity strings for one or more chip keys (deduped, order preserved). */
export function raritiesForKeys(keys: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const filter = rarityFilterByKey(key);
    if (!filter) continue;
    for (const rarity of filter.rarities) {
      const id = rarity.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(rarity);
    }
  }
  return out;
}
