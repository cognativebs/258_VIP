import { markInferred } from "@vip/evidence";
import type { IdentityCandidate } from "./schemas.js";

export const SPORTS_PARSE_RULE = "sports-identity-parse@0.1.0";

const BRANDS: Array<{ token: string; label: string }> = [
  { token: "upper deck", label: "Upper Deck" },
  { token: "stadium club", label: "Stadium Club" },
  { token: "panini prizm", label: "Panini Prizm" },
  { token: "prizm", label: "Prizm" },
  { token: "topps chrome", label: "Topps Chrome" },
  { token: "topps", label: "Topps" },
  { token: "bowman", label: "Bowman" },
  { token: "panini", label: "Panini" },
  { token: "fleer", label: "Fleer" },
  { token: "donruss", label: "Donruss" },
  { token: "select", label: "Select" },
  { token: "mosaic", label: "Mosaic" },
  { token: "optic", label: "Optic" },
  { token: "heritage", label: "Heritage" },
  { token: "finest", label: "Finest" },
  { token: "hoops", label: "Hoops" },
];

const STOP = new Set([
  "front",
  "back",
  "jpg",
  "jpeg",
  "png",
  "tif",
  "tiff",
  "card",
  "rookie",
  "holo",
  "auto",
  "autograph",
  "psa",
  "bgs",
  "cgc",
  "rc",
  "the",
  "and",
]);

export type SportsParsedIdentity = {
  year: number | null;
  brand: string | null;
  player: string | null;
  collectorNumber: string | null;
  displayName: string;
  setName: string | null;
  confidence: number;
  matchReasons: string[];
};

export function parseSportsIdentity(raw: string): SportsParsedIdentity | null {
  const text = normalize(raw);
  if (!text) return null;

  const yearMatch = text.match(/\b((?:19|20)\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  let brand: string | null = null;
  for (const b of BRANDS) {
    if (text.includes(b.token)) {
      brand = b.label;
      break;
    }
  }

  const hashNum = text.match(/#\s*(\d{1,4})\b/);
  const otherNums = [...text.matchAll(/\b(\d{1,4})\b/g)]
    .map((m) => m[1]!)
    .filter((n) => !(year && n === String(year)));
  const collectorNumber = hashNum?.[1] ?? otherNums[0] ?? null;

  const stripped = text
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/#\s*\d{1,4}\b/g, " ");
  let remainder = stripped;
  if (brand) remainder = remainder.replace(normalize(brand), " ");
  for (const b of BRANDS) remainder = remainder.replace(b.token, " ");

  const playerTokens = remainder
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
  const player = playerTokens.length ? titleCase(playerTokens.join(" ")) : null;

  if (!year && !brand) return null;
  if (!player && !collectorNumber) return null;

  const reasons: string[] = [];
  if (year) reasons.push(`year:${year}`);
  if (brand) reasons.push(`brand:${brand}`);
  if (player) reasons.push(`player:${player}`);
  if (collectorNumber) reasons.push(`collector_number:${collectorNumber}`);

  let confidence = 0.2;
  if (year) confidence += 0.15;
  if (brand) confidence += 0.15;
  if (player) confidence += 0.2;
  if (collectorNumber) confidence += 0.12;
  confidence = Math.min(0.72, Number(confidence.toFixed(3)));

  const setName = [year, brand].filter(Boolean).join(" ") || null;
  const displayName = [year, brand, player, collectorNumber && `#${collectorNumber}`]
    .filter(Boolean)
    .join(" ");

  return {
    year,
    brand,
    player,
    collectorNumber,
    displayName: displayName || "Sports card (parsed · unverified)",
    setName,
    confidence,
    matchReasons: reasons,
  };
}

export function sportsParsedCandidate(raw: string): IdentityCandidate | null {
  const parsed = parseSportsIdentity(raw);
  if (!parsed) return null;
  const keyParts = [
    "sports",
    "parsed",
    parsed.year ?? "year",
    (parsed.brand ?? "brand").toLowerCase().replace(/\s+/g, "-"),
    (parsed.player ?? "player").toLowerCase().replace(/\s+/g, "-"),
    parsed.collectorNumber ?? "n",
  ];
  return {
    assetId: null,
    catalogKey: keyParts.join(":"),
    category: "sports",
    displayName: parsed.displayName,
    setName: parsed.setName,
    collectorNumber: parsed.collectorNumber,
    playerOrCharacter: parsed.player,
    year: parsed.year,
    externalIds: [
      { source: "sports_parsed", value: keyParts.slice(2).join("-") },
    ],
    confidence: parsed.confidence,
    matchReasons: parsed.matchReasons,
    provenance: markInferred({
      source: "sports_identity_parse",
      ruleOrModelVersion: SPORTS_PARSE_RULE,
      confidence: parsed.confidence,
      notes:
        "Parsed year/brand/player/number from filename or OCR · unverified until operator confirm. Not a catalog identity.",
    }),
  };
}

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
