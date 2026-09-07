/**
 * OCR is evidence, not identity. Classify lines so biography/stats/rules
 * text never become the name, and HP / power-toughness never become the
 * collector number. Mechanics come from the active OCR profile.
 */

import {
  defaultOcrProfile,
  type OcrProfile,
} from "./profiles.js";

export type OcrRegionKind =
  | "card_number"
  | "title"
  | "copyright"
  | "product"
  | "logo"
  | "body"
  | "unknown";

export type OcrSpan = {
  text: string;
  kind: OcrRegionKind;
  bbox: { x: number; y: number; w: number; h: number } | null;
  confidence: number | null;
};

export type StructuredOcrExtract = {
  player: string | null;
  year: number | null;
  manufacturer: string | null;
  brand: string | null;
  set: string | null;
  number: string | null;
  /** Kinds that contributed a field — for debug. */
  usedKinds: OcrRegionKind[];
};

const YEAR_TOKEN = /\b((?:19|20)\d{2})\b/;

const FAMILY_STOP: Record<OcrProfile["family"], Set<string>> = {
  sports: new Set([
    "football",
    "basketball",
    "baseball",
    "hockey",
    "soccer",
    "card",
    "cards",
    "rookie",
    "official",
    "trading",
  ]),
  tcg: new Set([
    "pokemon",
    "pokémon",
    "magic",
    "mtg",
    "basic",
    "stage",
    "evolved",
    "trainer",
    "energy",
    "item",
    "supporter",
    "stadium",
    "creature",
    "instant",
    "sorcery",
    "enchantment",
    "artifact",
    "land",
    "leader",
    "character",
    "event",
    "common",
    "uncommon",
    "rare",
    "mythic",
    "holo",
    "holofoil",
  ]),
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function letterTokens(text: string, minLen: number): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter((w) => w.length >= minLen);
}

function nameTokens(text: string): string[] {
  const tokens = letterTokens(text, 1);
  return tokens.some((w) => w.length >= 3) ? tokens : [];
}

function profileOf(profile?: OcrProfile): OcrProfile {
  return profile ?? defaultOcrProfile();
}

export function classifyOcrLine(text: string, profile?: OcrProfile): OcrRegionKind {
  const p = profileOf(profile);
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "unknown";
  const words = wordCount(t);

  if (p.copyrightMarkers.test(t) && words <= 8 && !p.bodyMarkers.test(t)) {
    return "copyright";
  }
  if (p.rejectAsNumber.test(t) && !p.labeledNumber.test(t)) {
    if (p.bodyMarkers.test(t) || words >= 8) return "body";
    return "unknown";
  }
  if (p.labeledNumber.test(t) && words <= 8) return "card_number";
  if (p.collectorNumber.test(t) && words <= 4 && p.family === "tcg") return "card_number";
  if (p.bodyMarkers.test(t) || words >= 8) return "body";
  if (p.productTokens.test(t) && words <= 10) return "product";
  if (looksLikeTitle(t, p)) return "title";
  return "unknown";
}

function looksLikeTitle(text: string, profile: OcrProfile): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const { minWords, maxWords, allowSingleWord, allowDigits } = profile.title;
  const floor = allowSingleWord ? 1 : minWords;
  if (words.length < floor || words.length > maxWords) return false;
  if (profile.productTokens.test(text) || profile.bodyMarkers.test(text) || profile.copyrightMarkers.test(text)) {
    return false;
  }
  if (profile.rejectAsNumber.test(text)) return false;
  if (/\d/.test(text) && !allowDigits && !/\b(jr|sr|ii|iii|iv|ex|gx|v|vmax|vstar)\b/i.test(text)) {
    return false;
  }
  const letters = words.map((w) => w.replace(/[^A-Za-z]/g, ""));
  if (letters.some((w) => w.length === 0) && !allowDigits) return false;
  if (!letters.some((w) => w.length >= 3)) return false;
  if (letters.filter((w) => w.length === 1).length > 2) return false;
  const stop = FAMILY_STOP[profile.family];
  if (words.every((w) => stop.has(w.toLowerCase()))) return false;
  return true;
}

export function classifyOcrSpans(
  lines: Array<{
    text: string;
    bbox?: { x: number; y: number; w: number; h: number } | null;
    confidence?: number | null;
  }>,
  profile?: OcrProfile,
): OcrSpan[] {
  const p = profileOf(profile);
  return lines
    .map((line) => {
      const text = line.text.replace(/\s+/g, " ").trim();
      return {
        text,
        kind: classifyOcrLine(text, p),
        bbox: line.bbox ?? null,
        confidence: line.confidence ?? null,
      };
    })
    .filter((s) => s.text.length > 0);
}

function firstYear(spans: OcrSpan[]): number | null {
  for (const span of spans) {
    const m = span.text.match(YEAR_TOKEN);
    if (m) {
      const y = Number(m[1]);
      if (y >= 1933 && y <= 2035) return y;
    }
  }
  return null;
}

function firstCollectorNumber(spans: OcrSpan[], profile: OcrProfile): string | null {
  for (const span of spans) {
    if (profile.rejectAsNumber.test(span.text) && !profile.labeledNumber.test(span.text)) {
      continue;
    }
    const labeled = span.text.match(profile.labeledNumber);
    if (labeled?.[1]) return labeled[1].toUpperCase();
    const raw = span.text.match(profile.collectorNumber);
    if (raw?.[1]) return raw[1].toUpperCase();
  }
  return null;
}

function titleCaseName(words: string[]): string {
  return words
    .map((w) =>
      w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
}

function productTokens(text: string, profile: OcrProfile): {
  manufacturer: string | null;
  brand: string | null;
} {
  const lower = text.toLowerCase();
  let manufacturer: string | null = null;
  let brand: string | null = null;
  if (profile.family === "tcg") {
    if (/\bpokemon|pok[eé]mon|nintendo|the pokemon company\b/.test(lower)) {
      manufacturer = "The Pokémon Company";
      brand = "Pokémon";
    }
    if (/\bwizards|magic the gathering|\bmtg\b/.test(lower)) {
      manufacturer = manufacturer ?? "Wizards of the Coast";
      brand = brand ?? "Magic";
    }
    if (/\bbandai|one piece\b/.test(lower)) {
      manufacturer = manufacturer ?? "Bandai";
      brand = brand ?? "One Piece";
    }
    return { manufacturer, brand };
  }
  if (/\bpanini\b/.test(lower)) manufacturer = "Panini";
  if (/\btopps\b/.test(lower)) manufacturer = manufacturer ?? "Topps";
  if (/\bupper\s*deck\b/.test(lower)) manufacturer = manufacturer ?? "Upper Deck";
  if (/\bfleer\b/.test(lower)) manufacturer = manufacturer ?? "Fleer";
  if (/\bdonruss\b/.test(lower)) brand = "Donruss";
  if (/\bprizm\b/.test(lower)) brand = brand ?? "Prizm";
  if (/\bselect\b/.test(lower)) brand = brand ?? "Select";
  if (/\boptic\b/.test(lower)) brand = brand ?? "Optic";
  if (/\bmosaic\b/.test(lower)) brand = brand ?? "Mosaic";
  if (/\bbowman\b/.test(lower)) brand = brand ?? "Bowman";
  if (/\bscore\b/.test(lower)) brand = brand ?? "Score";
  if (/\bhoops\b/.test(lower)) brand = brand ?? "Hoops";
  if (/\bcontenders\b/.test(lower)) brand = brand ?? "Contenders";
  if (/\bchrome\b/.test(lower)) brand = brand ?? "Chrome";
  if (/\bheritage\b/.test(lower)) brand = brand ?? "Heritage";
  if (/\bmerlin\b/.test(lower)) brand = brand ?? "Merlin";
  if (manufacturer && !brand) brand = manufacturer;
  return { manufacturer, brand };
}

const SPORTS_STRIP =
  /\b(panini|topps|donruss|prizm|select|optic|mosaic|bowman|fleer|score|upper\s*deck|leaf|llc|inc\.|america|company|copyright|©|chrome|contenders|football|basketball|baseball|hockey|soccer|heritage|finest|merlin|stickers?)\b/gi;

const TCG_STRIP =
  /\b(pokemon|pok[eé]mon|nintendo|creatures|game freak|the pokemon company|wizards of the coast|wizards|hasbro|magic the gathering|\bmtg\b|bandai|one piece|llc|inc\.|copyright|©|holo|rare|uncommon|common|mythic)\b/gi;

function stripKnownProduct(text: string, profile: OcrProfile): string {
  const productStrip = profile.family === "tcg" ? TCG_STRIP : SPORTS_STRIP;
  return text
    .replace(YEAR_TOKEN, " ")
    .replace(profile.labeledNumber, " ")
    .replace(profile.collectorNumber, " ")
    .replace(/\b\d{1,4}\b/g, " ")
    .replace(productStrip, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameFromRemainder(text: string, profile: OcrProfile): string | null {
  if (profile.bodyMarkers.test(text)) return null;
  const leftover = stripKnownProduct(text, profile);
  if (!leftover || profile.bodyMarkers.test(leftover)) return null;
  if (!looksLikeTitle(leftover, profile)) return null;
  const tokens = nameTokens(leftover);
  if (!tokens.length) return null;
  return titleCaseName(tokens);
}

function unlabeledNumberAfterIdentity(
  text: string,
  player: string | null,
  profile: OcrProfile,
): string | null {
  if (profile.family === "tcg") return null;
  if (profile.labeledNumber.test(text)) return null;
  if (profile.rejectAsNumber.test(text)) return null;
  let rest = text.replace(YEAR_TOKEN, " ");
  if (player) {
    rest = rest.replace(new RegExp(player.replace(/\s+/g, "\\s+"), "i"), " ");
  }
  rest = rest.replace(SPORTS_STRIP, " ");
  const nums = [...rest.matchAll(/\b(\d{1,4})\b/g)].map((m) => m[1]!);
  if (nums.length === 1) return nums[0]!.toUpperCase();
  return null;
}

/**
 * Product/copyright lines may yield year/brand/set/mfr — player only when the
 * leftover after stripping those tokens is a valid title for this profile.
 */
function productFields(
  spans: OcrSpan[],
  profile: OcrProfile,
): Pick<
  StructuredOcrExtract,
  "year" | "manufacturer" | "brand" | "set" | "player" | "number"
> {
  const text = spans.map((s) => s.text).join(" ");
  const { manufacturer, brand } = productTokens(text, profile);
  const player = nameFromRemainder(text, profile);
  const setBits = stripKnownProduct(text, profile);
  const setOk =
    Boolean(setBits) &&
    setBits.length >= 3 &&
    setBits.length <= 32 &&
    wordCount(setBits) <= 3 &&
    !looksLikeTitle(setBits, profile) &&
    !profile.bodyMarkers.test(setBits);
  const set = setOk
    ? setBits.replace(/\b\w/g, (c) => c.toUpperCase())
    : brand ?? manufacturer;
  return {
    year: firstYear(spans),
    manufacturer,
    brand,
    set: set ?? null,
    player,
    number: unlabeledNumberAfterIdentity(text, player, profile),
  };
}

function titlePlayer(spans: OcrSpan[], profile: OcrProfile): string | null {
  for (const span of spans) {
    if (looksLikeTitle(span.text, profile)) {
      const tokens = nameTokens(span.text);
      if (tokens.length) return titleCaseName(tokens);
    }
  }
  return null;
}

export function extractStructuredFromOcr(
  spans: OcrSpan[],
  profile?: OcrProfile,
): StructuredOcrExtract {
  const p = profileOf(profile);
  const privileged = spans.filter((s) =>
    ["card_number", "title", "copyright", "product", "logo"].includes(s.kind),
  );
  const usedKinds = [...new Set(privileged.map((s) => s.kind))];
  const product = productFields(
    privileged.filter((s) =>
      ["product", "copyright", "card_number"].includes(s.kind),
    ),
    p,
  );
  const player = titlePlayer(privileged.filter((s) => s.kind === "title"), p) ?? product.player;
  return {
    player,
    year: product.year ?? firstYear(privileged),
    manufacturer: product.manufacturer,
    brand: product.brand,
    set: product.set,
    number:
      firstCollectorNumber(
        privileged.filter((s) => s.kind === "card_number"),
        p,
      ) ?? product.number,
    usedKinds,
  };
}

export function privilegedOcrIsComplete(
  extract: StructuredOcrExtract,
  profile?: OcrProfile,
): boolean {
  const rule = profileOf(profile).completeness;
  const nameWords = extract.player ? extract.player.split(/\s+/).length : 0;
  if (rule.requireName && (!extract.player || nameWords < rule.minNameWords)) return false;
  if (rule.requireYear && !extract.year) return false;
  if (rule.requireNumber && !extract.number) return false;
  if (rule.requireBrandOrSet && !(extract.manufacturer || extract.brand || extract.set)) {
    return false;
  }
  return true;
}

export function spansFromTextBlock(text: string, profile?: OcrProfile): OcrSpan[] {
  return classifyOcrSpans(
    text
      .split(/\r?\n/)
      .map((line) => ({ text: line }))
      .filter((l) => l.text.trim().length > 0),
    profile,
  );
}

export const SPORT_STOP = FAMILY_STOP.sports;
