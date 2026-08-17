/** Display fields for a Pokémon / TCG row in the Bloomberg terminal. */
export type TcgCardDisplay = {
  cardName: string;
  setName: string;
  number: string;
};

export type TcgNameParts = {
  cardName?: string | null;
  assetName: string;
  series: string;
  issue: string;
};

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
      if (rest) return rest;
    }
  }
  if (asset && set && asset !== set) return asset;
  return named || asset || "Unnamed card";
}

export function tcgCardDisplay(h: TcgNameParts): TcgCardDisplay {
  const cardName = tcgCardName(h);
  return {
    cardName,
    setName: h.series.trim() || "Unknown set",
    number: h.issue.trim(),
  };
}
