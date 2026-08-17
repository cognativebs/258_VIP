/** Display fields for a Pokémon / TCG row in the Bloomberg terminal. */
export type TcgCardDisplay = {
  cardName: string;
  setName: string;
  number: string;
  artUrl: string | null;
};

export type TcgNameParts = {
  cardName?: string | null;
  assetName: string;
  series: string;
  issue: string;
  coverImageUrl?: string | null;
  externalIds?: { source: string; externalValue: string }[] | null;
};

/** Official pokemontcg.io image for id `{set}-{number}` (e.g. base1-4). */
export function pokemontcgImageUrl(externalValue: string): string | null {
  const raw = externalValue.trim();
  const dash = raw.indexOf("-");
  if (dash <= 0 || dash === raw.length - 1) return null;
  const set = raw.slice(0, dash).toLowerCase();
  const num = raw.slice(dash + 1);
  if (!/^[a-z0-9]+$/i.test(set)) return null;
  return `https://images.pokemontcg.io/${set}/${encodeURIComponent(num)}.png`;
}

export function tcgArtUrl(h: TcgNameParts): string | null {
  const direct = h.coverImageUrl?.trim();
  if (direct) return direct;
  const tcg = h.externalIds?.find((e) => e.source.toLowerCase() === "pokemontcg");
  if (tcg?.externalValue) return pokemontcgImageUrl(tcg.externalValue);
  return null;
}

/**
 * Printed card name, not the set. Binder stores "Set #n Name" in assetName
 * and the set/number in series/issue — never show only the set as the card.
 */
export function tcgCardName(h: TcgNameParts): string {
  const named = h.cardName?.trim();
  if (named && named.toLowerCase() !== "unnamed card") return named;

  const asset = h.assetName.trim();
  const set = h.series.trim();
  const num = h.issue.trim();
  if (set && num) {
    const prefix = `${set} #${num} `;
    if (asset.toLowerCase().startsWith(prefix.toLowerCase())) {
      const rest = asset.slice(prefix.length).trim();
      if (rest && rest.toLowerCase() !== "unnamed card") return rest;
    }
  }
  if (asset && set && asset !== set && !asset.toLowerCase().endsWith("unnamed card")) {
    return asset;
  }
  return named && named.toLowerCase() !== "unnamed card" ? named : asset && asset !== set ? asset : "—";
}

export function tcgCardDisplay(h: TcgNameParts): TcgCardDisplay {
  return {
    cardName: tcgCardName(h),
    setName: h.series.trim() || "Unknown set",
    number: h.issue.trim(),
    artUrl: tcgArtUrl(h),
  };
}
