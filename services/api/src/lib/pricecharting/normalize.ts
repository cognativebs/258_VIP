/** Normalize titles for exact_name compares. */
export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[#:'".,()/\\-]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripComicBooksPrefix(consoleName: string | null | undefined): string {
  return (consoleName ?? "").replace(/^comic\s+books\s*/i, "").trim();
}

export function stripPokemonPrefix(consoleName: string | null | undefined): string {
  return (consoleName ?? "").replace(/^pok[eé]mon\s*/i, "").trim();
}

export function normalizeSeriesTitle(value: string | null | undefined): string {
  const stripped = stripComicBooksPrefix(value ?? "");
  return normalizeMatchText(
    stripped
      .replace(/,?\s*vol(?:ume)?\.?\s*\d+/gi, " ")
      .replace(/\(\d{4}\)/g, " ")
      .replace(/\bcomics?\b/g, " "),
  );
}

export function normalizeSetTitle(value: string | null | undefined): string {
  return normalizeMatchText(stripPokemonPrefix(value ?? "").replace(/\(\d{4}\)/g, " "));
}

export function extractIssueNumber(text: string | null | undefined): string | null {
  const raw = text ?? "";
  const hash = raw.match(/#\s*(\d+)/i);
  if (hash?.[1]) return hash[1];
  const trailing = raw.match(/\b(?:issue|no\.?)\s*(\d+)/i);
  return trailing?.[1] ?? null;
}

export function variantTokens(text: string | null | undefined): Set<string> {
  const n = normalizeMatchText(text ?? "");
  const tokens = new Set<string>();
  if (/\bnewsstand\b/.test(n)) tokens.add("newsstand");
  if (/\bdirect\b/.test(n)) tokens.add("direct");
  if (/\bvirgin\b/.test(n)) tokens.add("virgin");
  if (/\bfoil\b/.test(n)) tokens.add("foil");
  if (/\b<unknown>|blank\b/.test(n)) tokens.add("blank");
  const ratio = n.match(/\b1\s+(\d{2,3})\b/);
  if (ratio?.[1]) tokens.add(`1:${ratio[1]}`);
  const cover = n.match(/\bcover\s+([a-z0-9]+)\b/);
  if (cover?.[1] && cover[1] !== "a") tokens.add(`cover:${cover[1]}`);
  const letter = (text ?? "").match(/#\s*\d+([a-z])\b/i);
  if (letter?.[1] && letter[1].toLowerCase() !== "a") tokens.add(`cover:${letter[1].toLowerCase()}`);
  return tokens;
}

export type VariantCompat = "incompatible" | "compatible" | "compatible_review";

/**
 * Directional variant compare.
 * - both plain → compatible (confirmable)
 * - asset plain + vendor tokened → incompatible
 * - vendor plain + asset tokened → compatible_review (not baseline)
 * - both tokened → shared-token compare
 */
export function variantCompatibility(
  assetTokens: Set<string>,
  vendorTokens: Set<string>,
): VariantCompat {
  if (assetTokens.size === 0 && vendorTokens.size === 0) return "compatible";
  if (assetTokens.size === 0 && vendorTokens.size > 0) return "incompatible";
  if (assetTokens.size > 0 && vendorTokens.size === 0) return "compatible_review";
  for (const token of assetTokens) {
    if (vendorTokens.has(token)) return "compatible";
  }
  return "incompatible";
}

export function variantsCompatible(assetTokens: Set<string>, vendorTokens: Set<string>): boolean {
  return variantCompatibility(assetTokens, vendorTokens) !== "incompatible";
}

export function extractVolumeNumber(text: string | null | undefined): number | null {
  const match = (text ?? "").match(/vol(?:ume)?\.?\s*(\d+)/i);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function hasVolumeDesignator(text: string | null | undefined, volume?: number | null): boolean {
  if (extractVolumeNumber(text) != null) return true;
  return volume != null && volume > 1;
}

export function extractComicYear(text: string | null | undefined): number | null {
  const paren = (text ?? "").match(/\((\d{4})\)/);
  if (paren?.[1]) {
    const y = Number(paren[1]);
    if (y >= 1930 && y <= 2030) return y;
  }
  const iso = (text ?? "").match(/^(\d{4})-/);
  if (iso?.[1]) {
    const y = Number(iso[1]);
    if (y >= 1930 && y <= 2030) return y;
  }
  return null;
}

/** Vol 2+ must land in the volume's start window. Vol 1 only rejects earlier-era vendors. */
export function volumeEraMismatch(input: {
  seriesTitle: string | null;
  seriesVolume: number | null;
  yearBegan: number | null;
  vendorProductName: string;
  vendorConsoleName: string | null;
}): boolean {
  if (!hasVolumeDesignator(input.seriesTitle, input.seriesVolume)) return false;
  const ourVol = extractVolumeNumber(input.seriesTitle) ?? (input.seriesVolume != null && input.seriesVolume > 1 ? input.seriesVolume : null);
  const vendorVol = extractVolumeNumber(`${input.vendorProductName} ${input.vendorConsoleName ?? ""}`);
  if (ourVol != null && vendorVol != null && ourVol !== vendorVol) return true;
  const ourYear = input.yearBegan;
  const vendorYear = extractComicYear(input.vendorProductName) ?? extractComicYear(input.vendorConsoleName);
  if (ourYear == null || vendorYear == null) return false;
  if (vendorYear < ourYear - 1) return true;
  if (ourVol != null && ourVol >= 2 && vendorYear > ourYear + 15) return true;
  return false;
}

export function extractCollectorNumber(text: string | null | undefined): string | null {
  const raw = text ?? "";
  const hash = raw.match(/#\s*(\d+[a-z]?)/i);
  if (hash?.[1]) return hash[1].replace(/^0+/, "") || "0";
  const numbered = raw.match(/\b(\d{1,3})\/\d{1,3}\b/);
  if (numbered?.[1]) return numbered[1].replace(/^0+/, "") || "0";
  return null;
}
