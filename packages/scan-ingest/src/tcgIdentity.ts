import { markInferred } from "@vip/evidence";
import type { IdentityCandidate, ScanCategory } from "./schemas.js";
import type { OcrProfile, ScanVertical } from "./ocr/profiles.js";
import { getOcrProfile } from "./ocr/profiles.js";

export const TCG_PARSE_RULE = "tcg-identity-parse@1.0.0";

export type TcgParsedIdentity = {
  name: string | null;
  setName: string | null;
  collectorNumber: string | null;
  year: number | null;
  manufacturer: string | null;
  brand: string | null;
  displayName: string;
  confidence: number;
  matchReasons: string[];
  category: ScanCategory;
  vertical: ScanVertical;
};

const POKEMON_NAME_STOP = new Set([
  "pokemon",
  "pokémon",
  "basic",
  "stage",
  "trainer",
  "energy",
  "item",
  "supporter",
  "stadium",
  "holo",
  "rare",
  "promo",
  "hp",
  "weakness",
  "resistance",
  "retreat",
]);

const MTG_NAME_STOP = new Set([
  "magic",
  "mtg",
  "creature",
  "instant",
  "sorcery",
  "enchantment",
  "artifact",
  "land",
  "planeswalker",
  "mythic",
  "rare",
  "uncommon",
  "common",
  "legendary",
]);

const OP_NAME_STOP = new Set([
  "leader",
  "character",
  "event",
  "stage",
  "don",
  "life",
  "power",
  "bandai",
  "piece",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9/#.\s-]+/g, " ")
    .replace(/[_./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1] ? m[1].toUpperCase() : null;
}

function yearOf(text: string): number | null {
  const m = text.match(/\b((?:19|20)\d{2})\b/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1933 && y <= 2035 ? y : null;
}

function nameFrom(text: string, stop: Set<string>, profile: OcrProfile): string | null {
  const stripped = text
    .replace(profile.labeledNumber, " ")
    .replace(profile.collectorNumber, " ")
    .replace(/\b((?:19|20)\d{2})\b/g, " ")
    .replace(/\b\d{1,3}\s*hp\b/gi, " ")
    .replace(profile.productTokens, " ")
    .replace(profile.copyrightMarkers, " ");
  const tokens = normalize(stripped)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !stop.has(t) && !/^\d+$/.test(t));
  if (!tokens.length) return null;
  const max = profile.title.maxWords;
  const picked = tokens.slice(0, max);
  if (picked.length < (profile.title.allowSingleWord ? 1 : 2)) return null;
  if (picked.every((t) => t.length < 3)) return null;
  return titleCase(picked.join(" "));
}

function parsePokemon(raw: string): TcgParsedIdentity | null {
  const profile = getOcrProfile("pokemon");
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const number =
    firstMatch(text, profile.labeledNumber) ??
    firstMatch(text, profile.collectorNumber);
  if (number && profile.rejectAsNumber.test(number)) return null;
  const name = nameFrom(text, POKEMON_NAME_STOP, profile);
  const year = yearOf(text);
  if (!name && !number) return null;
  if (!/pokemon|pok[eé]mon|hp|the pokemon company|nintendo/i.test(text) && !number) {
    return null;
  }
  const reasons: string[] = [];
  if (name) reasons.push(`name:${name}`);
  if (number) reasons.push(`collector_number:${number}`);
  if (year) reasons.push(`year:${year}`);
  const complete = Boolean(name && number);
  const confidence = complete ? 0.78 : name || number ? 0.52 : 0.2;
  return {
    name,
    setName: null,
    collectorNumber: number,
    year,
    manufacturer: "The Pokémon Company",
    brand: "Pokémon",
    displayName: [name, number].filter(Boolean).join(" ") || "Pokémon card (parsed · unverified)",
    confidence,
    matchReasons: reasons,
    category: "pokemon",
    vertical: "pokemon",
  };
}

function parseMtg(raw: string): TcgParsedIdentity | null {
  const profile = getOcrProfile("mtg");
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  let number =
    firstMatch(text, profile.labeledNumber) ??
    firstMatch(text, profile.collectorNumber);
  if (number && profile.rejectAsNumber.test(number)) number = null;
  const name = nameFrom(text, MTG_NAME_STOP, profile);
  const year = yearOf(text);
  if (!name && !number) return null;
  if (!/magic|mtg|wizards|planeswalker/i.test(text) && !number) return null;
  const reasons: string[] = [];
  if (name) reasons.push(`name:${name}`);
  if (number) reasons.push(`collector_number:${number}`);
  if (year) reasons.push(`year:${year}`);
  const complete = Boolean(name && number);
  return {
    name,
    setName: null,
    collectorNumber: number,
    year,
    manufacturer: "Wizards of the Coast",
    brand: "Magic",
    displayName: [name, number].filter(Boolean).join(" ") || "Magic card (parsed · unverified)",
    confidence: complete ? 0.76 : 0.5,
    matchReasons: reasons,
    category: "mtg",
    vertical: "mtg",
  };
}

function parseOnePiece(raw: string): TcgParsedIdentity | null {
  const profile = getOcrProfile("one_piece");
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const number =
    firstMatch(text, profile.labeledNumber) ??
    firstMatch(text, profile.collectorNumber);
  const name = nameFrom(text, OP_NAME_STOP, profile);
  if (!name && !number) return null;
  if (!/one piece|bandai|op\d{2}-|st\d{2}-/i.test(text) && !number) return null;
  const reasons: string[] = [];
  if (name) reasons.push(`name:${name}`);
  if (number) reasons.push(`collector_number:${number}`);
  const complete = Boolean(name && number);
  return {
    name,
    setName: null,
    collectorNumber: number,
    year: yearOf(text),
    manufacturer: "Bandai",
    brand: "One Piece",
    displayName: [name, number].filter(Boolean).join(" ") || "One Piece card (parsed · unverified)",
    confidence: complete ? 0.8 : 0.52,
    matchReasons: reasons,
    category: "one_piece",
    vertical: "one_piece",
  };
}

export function parseTcgIdentity(
  raw: string,
  vertical: ScanVertical | "tcg_generic" | null,
): TcgParsedIdentity | null {
  if (vertical === "pokemon") return parsePokemon(raw);
  if (vertical === "mtg") return parseMtg(raw);
  if (vertical === "one_piece") return parseOnePiece(raw);
  return parsePokemon(raw) ?? parseMtg(raw) ?? parseOnePiece(raw);
}

export function tcgParsedCandidate(
  raw: string,
  vertical: ScanVertical | "tcg_generic" | null,
): IdentityCandidate | null {
  const parsed = parseTcgIdentity(raw, vertical);
  if (!parsed) return null;
  const keyParts = [
    parsed.category,
    "parsed",
    (parsed.name ?? "name").toLowerCase().replace(/\s+/g, "-"),
    parsed.collectorNumber ?? "n",
  ];
  return {
    assetId: null,
    catalogKey: keyParts.join(":"),
    category: parsed.category,
    displayName: parsed.displayName,
    setName: parsed.setName,
    collectorNumber: parsed.collectorNumber,
    playerOrCharacter: parsed.name,
    year: parsed.year,
    externalIds: [{ source: `${parsed.category}_parsed`, value: keyParts.slice(2).join("-") }],
    confidence: parsed.confidence,
    matchReasons: parsed.matchReasons,
    provenance: markInferred({
      source: "tcg_identity_parse",
      ruleOrModelVersion: TCG_PARSE_RULE,
      confidence: parsed.confidence,
      notes:
        `Parsed ${parsed.vertical} name/number from image OCR or filename · unverified until operator confirm.`,
    }),
  };
}
